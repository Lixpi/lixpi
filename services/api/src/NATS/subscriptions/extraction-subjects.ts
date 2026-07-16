'use strict'

import { info, err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import {
    NATS_SUBJECTS,
    getAiInteractionCanonicalResponseSubject,
    getAiInteractionResponseSubject,
    type ProviderName,
} from '@lixpi/constants'
import ExtractionRun from '../../models/extraction-run.ts'
import AssetModel from '../../models/asset.ts'
import BlobModel from '../../models/blob.ts'
import Workspace from '../../models/workspace.ts'
import AiModel from '../../models/ai-model.ts'
import type { LlmModule } from '../../llm/index.ts'
import { ensureAiInteractionEventRelay } from '../../services/ai-interaction-event-relay.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'

const { FEATURE_EXTRACT } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

let _llmModule: LlmModule | undefined
export const setExtractionLlmModule = (mod: LlmModule): void => { _llmModule = mod }
const getLlmModule = (): LlmModule => { if (!_llmModule) throw new Error('LLM module not initialized'); return _llmModule }

const canEditWorkspace = (workspace: Exclude<Awaited<ReturnType<typeof Workspace.getWorkspace>>, { error: string }>, userId: string): boolean =>
    !workspace.deletingAt
    && workspace.accessList.some((entry) => entry.userId === userId && (entry.accessLevel === 'owner' || entry.accessLevel === 'editor'))

const resolveExtractionAssetMessages = async ({
    messages,
    userId,
    organizationId,
}: {
    messages: any[]
    userId: string
    organizationId: string
}): Promise<{ messages: any[]; sourceAssetIds: string[] }> => {
    if (!Array.isArray(messages)) throw new Error('INVALID_EXTRACTION_MESSAGES')
    const requester = await getAssetRequesterContext(userId)
    const sourceAssetIds: string[] = []
    const resolvedMessages = await Promise.all(messages.map(async (message) => {
        if (!Array.isArray(message?.content)) return message
        const content = await Promise.all(message.content.map(async (block: any) => {
            if (block?.type !== 'input_image') return block
            const match = typeof block.image_url === 'string'
                ? /^asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(block.image_url)
                : null
            if (!match) throw new Error('EXTRACTION_IMAGE_ASSET_URL_REQUIRED')
            const assetId = match[1]!
            sourceAssetIds.push(assetId)
            const asset = await AssetModel.get({ assetId, requester })
            if ('error' in asset
                || asset.organizationId !== organizationId
                || asset.media?.kind !== 'image') throw new Error(`EXTRACTION_IMAGE_ASSET_NOT_FOUND:${assetId}`)
            const rendition = asset.media.renditions.canonical?.status === 'ready'
                ? asset.media.renditions.canonical
                : asset.media.modelSafe && asset.media.renditions.original?.status === 'ready'
                    ? asset.media.renditions.original
                    : undefined
            if (!rendition?.blobHash) throw new Error(`EXTRACTION_IMAGE_ASSET_NOT_READY:${assetId}`)
            const blob = await BlobModel.get({ organizationId, blobHash: rendition.blobHash })
            if (!blob) throw new Error(`EXTRACTION_IMAGE_BLOB_NOT_FOUND:${assetId}`)
            return { ...block, image_url: `nats-obj://${blob.bucketName}/${blob.objectKey}` }
        }))
        return { ...message, content }
    }))
    return { messages: resolvedMessages, sourceAssetIds }
}

// Optional intent string the user may have typed in the extraction tab.
// We look at the LAST user message because it carries the submitted user-text
// after any prior thread context was prepended by the client.
const extractIntentFromMessages = (messages: any[]): string | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.role !== 'user') continue
        if (typeof message.content === 'string' && message.content.trim()) return message.content.trim()
        if (Array.isArray(message.content)) {
            for (const block of message.content) {
                if (block?.type === 'input_text' && typeof block.text === 'string' && block.text.trim()) return block.text.trim()
            }
        }
    }
    return undefined
}

export const extractionSubjects = [
    {
        subject: FEATURE_EXTRACT.START, type: 'subscribe', queue: 'extraction', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.START] }, sub: { allow: [`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.{userIdToken}.>`] } },
        handler: async (data: any) => {
            const {
                user: { userId },
                workspaceId,
                extractionRunId,
                messages,
                sourceContextSnapshot,
            } = data
            const analysisModelId = data.analysisModelId || data.featureExtractionConfig?.analysisModelId || data.aiModel
            const mediaModelId = data.mediaModelId || data.featureExtractionConfig?.mediaModelId || data.aiImageModel
            const modelConfig = {
                ...(analysisModelId ? { analysisModelId } : {}),
                ...(mediaModelId ? { mediaModelId } : {}),
            }
            const natsService = NATS_Service.getInstance()
            const responseSubject = getAiInteractionCanonicalResponseSubject(workspaceId, extractionRunId)
            const userResponseSubject = getAiInteractionResponseSubject(userId, workspaceId, extractionRunId)

            try {
                const workspace = await Workspace.getWorkspace({ userId, workspaceId })
                if (!workspace || 'error' in workspace) {
                    natsService?.publish(userResponseSubject, {
                        error: workspace?.error || 'WORKSPACE_NOT_FOUND',
                    })
                    return
                }
                if (!canEditWorkspace(workspace, userId)) {
                    natsService?.publish(userResponseSubject, {
                        error: 'PERMISSION_DENIED',
                    })
                    return
                }
                ensureAiInteractionEventRelay({ userId, scopeId: workspaceId, pipelineId: extractionRunId })

                const organizationId = workspace.organizationId
                const resolvedExtraction = await resolveExtractionAssetMessages({
                    messages,
                    userId,
                    organizationId,
                })

                const userText = extractIntentFromMessages(messages)
                // Always create/upsert the run record — client sends pre-generated ID
                await ExtractionRun.createRun({
                    extractionRunId,
                    workspaceId,
                    userId,
                    userText,
                    sourceContextSnapshot,
                    modelConfig,
                })
                await ExtractionRun.updateStatus({ extractionRunId, workspaceId, status: 'analyzing' })

                if (!analysisModelId) {
                    const message = 'Feature extraction could not start: no analysis model was selected.'
                    await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: message })
                    natsService?.publish(responseSubject, { error: message })
                    return
                }

                const [provider, model] = (analysisModelId as string).split(':')
                const aiModelMetaInfo = await AiModel.getAiModel({ provider: provider!, model: model!, omitPricing: false })
                if (!aiModelMetaInfo) {
                    const message = `AI model not found: ${analysisModelId}`
                    err('AI model not found', { aiModel: analysisModelId })
                    await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: message })
                    natsService?.publish(responseSubject, { error: message })
                    return
                }

                let imageModelMetaInfo: any = undefined
                let imageProvider: ProviderName | undefined = undefined
                if (mediaModelId) {
                    const [ip, im] = (mediaModelId as string).split(':')
                    imageModelMetaInfo = await AiModel.getAiModel({ provider: ip!, model: im!, omitPricing: false })
                    if (!imageModelMetaInfo) {
                        const message = `Media model not found: ${mediaModelId}`
                        err('Media model not found', { aiModel: mediaModelId })
                        await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: message })
                        natsService?.publish(responseSubject, { error: message })
                        return
                    }
                    imageProvider = ip as ProviderName
                }

                info(`Starting feature extraction run ${extractionRunId} via dedicated 6-stage pipeline`)
                getLlmModule().processExtraction({
                    extractionRunId,
                    workspaceId,
                    userId,
                    organizationId,
                    intent: userText,
                    messages: resolvedExtraction.messages,
                    sourceAssetIds: resolvedExtraction.sourceAssetIds,
                    analysisProvider: provider as ProviderName,
                    analysisModel: aiModelMetaInfo,
                    imageProvider,
                    imageModel: imageModelMetaInfo,
                }).then(async (result) => {
                    if (!result.success) {
                        err(`Extraction pipeline returned failure for ${extractionRunId}: ${result.error}`)
                    }
                }).catch(async (e: Error) => {
                    err(`Extraction pipeline crashed for ${extractionRunId}:`, e)
                    await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: e.message }).catch(() => {})
                    natsService?.publish(responseSubject, { error: e.message })
                })
            } catch (error: any) {
                err('Extraction START handler error:', error)
                await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: error?.message ?? String(error) }).catch(() => {})
                natsService?.publish(responseSubject, { error: error?.message ?? String(error) })
            }
        },
    },
    {
        subject: FEATURE_EXTRACT.STATUS, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.STATUS] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const { workspaceId, extractionRunId } = data
            const workspace = await Workspace.getWorkspace({ userId: data.user.userId, workspaceId })
            if (!workspace || 'error' in workspace) return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            return await ExtractionRun.getRun({ extractionRunId, workspaceId })
        },
    },
    {
        subject: FEATURE_EXTRACT.LIST_BY_WORKSPACE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.LIST_BY_WORKSPACE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const workspace = await Workspace.getWorkspace({ userId: data.user.userId, workspaceId: data.workspaceId })
            if (!workspace || 'error' in workspace) return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            return await ExtractionRun.listWorkspaceRuns({ workspaceId: data.workspaceId })
        },
    },
    {
        subject: FEATURE_EXTRACT.DELETE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.DELETE] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const workspace = await Workspace.getWorkspace({ userId: data.user.userId, workspaceId: data.workspaceId })
            if (!workspace || 'error' in workspace) return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            if (!canEditWorkspace(workspace, data.user.userId)) return { error: 'PERMISSION_DENIED' }
            await ExtractionRun.deleteRun({ extractionRunId: data.extractionRunId, workspaceId: data.workspaceId })
            return { success: true, extractionRunId: data.extractionRunId }
        },
    },
]
