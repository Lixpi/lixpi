'use strict'

import { info, err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type ProviderName } from '@lixpi/constants'
import ExtractionRun from '../../models/extraction-run.ts'
import Workspace from '../../models/workspace.ts'
import AiModel from '../../models/ai-model.ts'
import type { LlmModule } from '../../llm/index.ts'

const { FEATURE_EXTRACT } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

let _llmModule: LlmModule | undefined
export const setExtractionLlmModule = (mod: LlmModule): void => { _llmModule = mod }
const getLlmModule = (): LlmModule => { if (!_llmModule) throw new Error('LLM module not initialized'); return _llmModule }

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
        permissions: { pub: { allow: [FEATURE_EXTRACT.START] }, sub: { allow: [`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.>`] } },
        handler: async (data: any) => {
            const {
                user: { userId },
                workspaceId,
                organizationId,
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

            try {
                const workspace = await Workspace.getWorkspace({ userId, workspaceId })
                if (!workspace || 'error' in workspace) {
                    natsService?.publish(`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`, {
                        error: workspace?.error || 'WORKSPACE_NOT_FOUND',
                    })
                    return
                }

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
                    natsService?.publish(`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`, { error: message })
                    return
                }

                const [provider, model] = (analysisModelId as string).split(':')
                const aiModelMetaInfo = await AiModel.getAiModel({ provider: provider!, model: model!, omitPricing: false })
                if (!aiModelMetaInfo) {
                    const message = `AI model not found: ${analysisModelId}`
                    err('AI model not found', { aiModel: analysisModelId })
                    await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: message })
                    natsService?.publish(`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`, { error: message })
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
                        natsService?.publish(`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`, { error: message })
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
                    messages,
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
                    natsService?.publish(`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`, { error: e.message })
                })
            } catch (error: any) {
                err('Extraction START handler error:', error)
                await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: error?.message ?? String(error) }).catch(() => {})
            }
        },
    },
    {
        subject: FEATURE_EXTRACT.STOP, type: 'subscribe', queue: 'extraction', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.STOP] } },
        handler: async (_data: any) => {
            // Stop is not wired through the new orchestrator yet — abort signals will be added
            // once the real (non-stub) stages are in place; current stub stages are short-lived.
        },
    },
    {
        subject: FEATURE_EXTRACT.STATUS, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.STATUS] }, sub: { allow: [FEATURE_EXTRACT.STATUS] } },
        handler: async (data: any) => {
            const { workspaceId, extractionRunId } = data
            const workspace = await Workspace.getWorkspace({ userId: data.user.userId, workspaceId })
            if (!workspace || 'error' in workspace) return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            return await ExtractionRun.getRun({ extractionRunId, workspaceId })
        },
    },
    {
        subject: FEATURE_EXTRACT.LIST_BY_WORKSPACE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.LIST_BY_WORKSPACE] }, sub: { allow: [FEATURE_EXTRACT.LIST_BY_WORKSPACE] } },
        handler: async (data: any) => {
            const workspace = await Workspace.getWorkspace({ userId: data.user.userId, workspaceId: data.workspaceId })
            if (!workspace || 'error' in workspace) return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            return await ExtractionRun.listWorkspaceRuns({ workspaceId: data.workspaceId })
        },
    },
    {
        subject: FEATURE_EXTRACT.DELETE, type: 'reply', payloadType: 'json',
        permissions: { pub: { allow: [FEATURE_EXTRACT.DELETE] }, sub: { allow: [FEATURE_EXTRACT.DELETE] } },
        handler: async (data: any) => {
            const workspace = await Workspace.getWorkspace({ userId: data.user.userId, workspaceId: data.workspaceId })
            if (!workspace || 'error' in workspace) return { error: workspace?.error || 'WORKSPACE_NOT_FOUND' }
            await ExtractionRun.deleteRun({ extractionRunId: data.extractionRunId, workspaceId: data.workspaceId })
            return { success: true, extractionRunId: data.extractionRunId }
        },
    },
]
