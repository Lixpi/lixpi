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
import type { LlmModule } from '../../llm/index.ts'

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS

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
                aiModel,
                aiImageModel,
                aiVideoModel,
                workspaceId,
                aiChatThreadId,
                organizationId,
                enableImageGeneration,
                imageSize,
                videoAspectRatio,
                videoResolution,
                videoDuration,
                videoSourceForExtension,
                referencedFeatureIds,
                imageBranchCandidateSnapshot,
                workspaceContextSnapshot,
            } = data as {
                user: { userId: string; stripeCustomerId: string }
                workspaceId: string
                aiChatThreadId: string
                organizationId: string
                enableImageGeneration?: boolean
                imageSize?: string
                aiImageModel?: string
                aiVideoModel?: string
                videoAspectRatio?: string
                videoResolution?: string
                videoDuration?: number | string
                videoSourceForExtension?: string
            } & AiInteractionChatSendMessagePayload

            const [provider, model] = (aiModel as string).split(':')
            const natsService = await NATS_Service.getInstance()

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
                getLlmModule()
                    .process(instanceKey, provider as ProviderName, {
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
                        imageBranchCandidateSnapshot,
                        workspaceContextSnapshot,
                        eventMeta: {
                            userId,
                            stripeCustomerId,
                            organizationId,
                            workspaceId,
                            aiChatThreadId,
                        },
                    })
                    .catch(e => {
                        err(`LLM module process failed for ${instanceKey}:`, e)
                        natsService!.publish(
                            `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`,
                            { error: e instanceof Error ? e.message : String(e) },
                        )
                    })
            } catch (error) {
                err('❌ [AI_INTERACTION] handler error:', error)
                natsService!.publish(
                    `${AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${aiChatThreadId}`,
                    { error: error instanceof Error ? error.message : String(error) },
                )
            }
        },
    },

    // Stop AI message streaming
    {
        subject: AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE,
        type: 'subscribe',
        queue: 'aiInteraction',
        payloadType: 'json',
        permissions: {
            pub: { allow: [AI_INTERACTION_SUBJECTS.CHAT_STOP_MESSAGE] },
        },
        handler: async (data: any, _msg: any) => {
            const { workspaceId, aiChatThreadId } = data as {
                user: { userId: string }
                workspaceId: string
                aiChatThreadId: string
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
            } catch (e) {
                err(`Failed to stop ${instanceKey}:`, e)
            }
        },
    },
]
