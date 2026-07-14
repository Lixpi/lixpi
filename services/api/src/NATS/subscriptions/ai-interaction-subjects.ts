'use strict'

import chalk from 'chalk'

import NATS_Service from '@lixpi/nats-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'
import {
    NATS_SUBJECTS,
    type AiInteractionChatSendMessagePayload,
    type ProviderName,
} from '@lixpi/constants'

import AiModel from '../../models/ai-model.ts'
import Organization from '../../models/organization.ts'
import type { LlmModule } from '../../llm/index.ts'
import Workspace from '../../models/workspace.ts'
import { PipelineEventLog } from '../../llm/graph/pipeline-event-log.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS
const PIPELINE_EVENT_STREAM_SUBJECT = `${AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_EVENTS}.>`

type PipelineResumePayload = {
    user: { userId: string }
    workspaceId: string
    aiChatThreadId?: string
    pipelineId?: string
    localStreamSeq?: number
    maxMessages?: number
}

let _llmModule: LlmModule | undefined

// Set by server.ts after createLlmModule is built — subscriptions are registered before the module exists.
export const setLlmModule = (mod: LlmModule): void => {
    _llmModule = mod
}

const getLlmModule = (): LlmModule => {
    if (!_llmModule) throw new Error('LLM module not initialized')
    return _llmModule
}

const normalizeModelOption = (
    requested: string | number | undefined,
    options: Array<{ value?: string; label?: string }> | undefined,
): string | undefined => {
    const requestedValue = requested == null ? '' : String(requested)
    if (!Array.isArray(options) || options.length === 0) return requestedValue || undefined

    const values = options
        .map(option => option.value)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (values.length === 0) return requestedValue || undefined
    if (requestedValue && values.includes(requestedValue)) return requestedValue
    return values[0]
}

const resolveUserOrganizationId = async (userId: string): Promise<string | undefined> => {
    try {
        const organizations = await Organization.getUserOrganizations({ userId })
        return organizations[0]?.organizationId
    } catch (e) {
        err(`Failed to resolve organization for AI interaction user ${userId}:`, e)
        return undefined
    }
}

export const aiInteractionSubjects = [
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE] },
            sub: { allow: [`${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.>`] },
        },
        handler: async (data: any, _msg: any) => {
            const {
                user: { userId, stripeCustomerId },
                messages,
                aiReasoningModels,
                aiImageModels,
                aiVideoModels,
                workspaceId,
                aiChatThreadId,
                enableImageGeneration,
                imageSize,
                videoAspectRatio,
                videoResolution,
                videoDuration,
                videoSourceForExtension,
                referencedFeatureIds,
                mediaBranchCandidateSnapshot,
                workspaceContextSnapshot,
                canvasVisibleArea,
                proseMirrorInitialDoc,
                proseMirrorBaseVersion,
                mediaGenerationRequest,
            } = data as {
                user: { userId: string; stripeCustomerId: string }
                workspaceId: string
                aiChatThreadId: string
                organizationId?: string
                enableImageGeneration?: boolean
                imageSize?: string
                aiImageModels?: string[]
                aiVideoModels?: string[]
                videoAspectRatio?: string
                videoResolution?: string
                videoDuration?: number | string
                videoSourceForExtension?: string
                proseMirrorInitialDoc?: object
                proseMirrorBaseVersion?: number
            } & AiInteractionChatSendMessagePayload

            // The selection is an ordered model-id array; the legacy single-model
            // path below operates on the first model of each section.
            const aiModel = aiReasoningModels?.[0]
            const aiImageModel = aiImageModels?.[0]
            const aiVideoModel = aiVideoModels?.[0]

            const natsService = await NATS_Service.getInstance()
            const organizationId = referencedFeatureIds?.length ? await resolveUserOrganizationId(userId) : undefined

            // Org keys metrics spend. Prefer the org resolved for feature access;
            // otherwise use the client-supplied one from the payload. Never resolve
            // it unconditionally — that would add a lookup on every message.
            const eventOrganizationId = organizationId ?? (data.organizationId as string | undefined)

            if (mediaGenerationRequest) {
                infoStr([
                    chalk.cyan('🧬 [AI_INTERACTION]'),
                    ' :: Invoking media generation matrix',
                    ' :: generationRequestId:',
                    chalk.yellow(mediaGenerationRequest.generationRequestId),
                    ' :: reasoningCount:',
                    chalk.green(String(mediaGenerationRequest.reasoningModelIds.length)),
                ])

                const runMediaGenerationMatrix = async (): Promise<void> => {
                    try {
                        await getLlmModule().processMediaGenerationMatrix({
                            ...data,
                            workspaceId,
                            aiChatThreadId,
                            organizationId: eventOrganizationId,
                            mediaGenerationRequest,
                            eventMeta: {
                                userId,
                                stripeCustomerId,
                                organizationId: eventOrganizationId,
                                workspaceId,
                                aiChatThreadId,
                            },
                        })
                    } catch (e) {
                        err(`Media generation matrix failed for ${workspaceId}:${aiChatThreadId}:`, e)
                        natsService!.publish(
                            `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`,
                            { error: e instanceof Error ? e.message : String(e) },
                        )
                    }
                }
                void runMediaGenerationMatrix()
                return
            }

            const [provider, model] = (aiModel as string).split(':')

            try {
                const aiModelMetaInfo = await AiModel.getAiModel({
                    provider: provider!,
                    model: model!,
                    omitPricing: false,
                })
                if (!aiModelMetaInfo || !aiModelMetaInfo.modelVersion) {
                    err('AI model meta info not found in the database', { aiModel })
                    natsService!.publish(
                        `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`,
                        { error: `AI model not found: ${aiModel}` },
                    )
                    return
                }

                let imageModelMetaInfo: any = null
                if (aiImageModel) {
                    const [imageProvider, imageModel] = (aiImageModel as string).split(':')
                    imageModelMetaInfo = await AiModel.getAiModel({
                        provider: imageProvider!,
                        model: imageModel!,
                        omitPricing: false,
                    })
                    if (imageModelMetaInfo) {
                        info(`Image model resolved: ${imageProvider}:${imageModel}`)
                    } else {
                        warn(`Image model not found: ${aiImageModel}, proceeding without image routing`)
                    }
                }

                let videoModelMetaInfo: any = null
                if (aiVideoModel) {
                    const [videoProvider, videoModel] = (aiVideoModel as string).split(':')
                    videoModelMetaInfo = await AiModel.getAiModel({
                        provider: videoProvider!,
                        model: videoModel!,
                        omitPricing: false,
                    })
                    if (videoModelMetaInfo) {
                        info(`Video model resolved: ${videoProvider}:${videoModel}`)
                    } else {
                        warn(`Video model not found: ${aiVideoModel}, proceeding without video routing`)
                    }
                }

                const normalizedVideoAspectRatio = normalizeModelOption(videoAspectRatio, videoModelMetaInfo?.videoAspectRatios)
                const normalizedVideoResolution = normalizeModelOption(videoResolution, videoModelMetaInfo?.videoResolutions)
                const normalizedVideoDuration = normalizeModelOption(videoDuration, videoModelMetaInfo?.videoDurations)

                const instanceKey = `${workspaceId}:${aiChatThreadId}`

                infoStr([
                    chalk.cyan('🚀 [AI_INTERACTION]'),
                    ' :: Invoking LLM module in-process',
                    ' :: instanceKey:',
                    chalk.yellow(instanceKey),
                    ' :: provider:',
                    chalk.green(provider!),
                ])

                // Fire-and-forget: the LLM module publishes streaming events
                // directly to NATS as it runs. We do not await here because
                // NATS message handlers should return quickly so the queue
                // worker can pick up the next request.
                const runLlmProcess = async (): Promise<void> => {
                    try {
                        await getLlmModule().process(instanceKey, provider as ProviderName, {
                            messages,
                            aiModelMetaInfo,
                            imageModelMetaInfo,
                            videoModelMetaInfo,
                            workspaceId,
                            aiChatThreadId,
                            enableImageGeneration,
                            imageSize,
                            videoAspectRatio: normalizedVideoAspectRatio,
                            videoResolution: normalizedVideoResolution,
                            videoDurationSeconds: normalizedVideoDuration ? Number(normalizedVideoDuration) : undefined,
                            videoSourceForExtension,
                            referencedFeatureIds,
                            mediaBranchCandidateSnapshot,
                            workspaceContextSnapshot,
                            canvasVisibleArea,
                            proseMirrorInitialDoc,
                            proseMirrorBaseVersion,
                            eventMeta: {
                                userId,
                                stripeCustomerId,
                                organizationId: eventOrganizationId,
                                workspaceId,
                                aiChatThreadId,
                            },
                        })
                    } catch (e) {
                        err(`LLM module process failed for ${instanceKey}:`, e)
                        natsService!.publish(
                            `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`,
                            { error: e instanceof Error ? e.message : String(e) },
                        )
                    }
                }
                void runLlmProcess()
            } catch (error) {
                err('❌ [AI_INTERACTION] handler error:', error)
                natsService!.publish(
                    `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`,
                    { error: error instanceof Error ? error.message : String(error) },
                )
            }
        },
    },

    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME,
        type: 'reply',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME] },
            sub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME, PIPELINE_EVENT_STREAM_SUBJECT] },
        },
        handler: async (data: PipelineResumePayload, _msg: any) => {
            const { workspaceId } = data
            const userId = data.user.userId
            const pipelineId = data.pipelineId ?? data.aiChatThreadId
            if (!pipelineId) {
                return { error: 'PIPELINE_ID_REQUIRED' }
            }

            const workspace = await Workspace.getWorkspace({ userId, workspaceId })
            if (!workspace || 'error' in workspace) {
                return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            }

            const localStreamSeq = typeof data.localStreamSeq === 'number' ? data.localStreamSeq : 0
            const maxMessages = typeof data.maxMessages === 'number' ? data.maxMessages : 1000
            const result = await PipelineEventLog.fromSingleton().replayPipelineEvents({
                workspaceId,
                pipelineId,
                startStreamSeq: Math.max(1, localStreamSeq + 1),
                maxMessages,
            })

            return {
                ...result,
                events: result.events.filter(event => event.streamSequence > localStreamSeq),
            }
        },
    },

    // Stop AI message streaming
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
        type: 'reply',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE] },
            sub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE] },
        },
        handler: async (data: any, _msg: any) => {
            const { workspaceId, aiChatThreadId, generationRequestId } = data as {
                user: { userId: string }
                workspaceId: string
                aiChatThreadId: string
                generationRequestId?: string
            }

            const instanceKey = `${workspaceId}:${aiChatThreadId}`

            infoStr([
                chalk.yellow('🛑 [AI_INTERACTION]'),
                ' :: Stopping LLM workflow',
                ' :: instanceKey:',
                chalk.red(instanceKey),
            ])

            try {
                await getLlmModule().stop(instanceKey)
                await getLlmModule().stopMediaGenerationMatrix({
                    workspaceId,
                    aiChatThreadId,
                    generationRequestId,
                })
                return {
                    status: 'stopped',
                    ...(generationRequestId ? { generationRequestId } : {}),
                }
            } catch (e) {
                err(`Failed to stop ${instanceKey}:`, e)
                return { error: e instanceof Error ? e.message : String(e) }
            }
        },
    },
]
