'use strict'

import { info, err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type ProviderName } from '@lixpi/constants'
import ExtractionRun from '../../models/extraction-run.ts'
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
            const { user: { userId, stripeCustomerId }, workspaceId, organizationId, extractionRunId, messages, aiModel, aiImageModel } = data
            const natsService = NATS_Service.getInstance()

            try {
                // Always create/upsert the run record — client sends pre-generated ID
                await ExtractionRun.createRun({ extractionRunId, workspaceId, userId })
                await ExtractionRun.updateStatus({ extractionRunId, workspaceId, status: 'analyzing' })

                const [provider, model] = (aiModel as string).split(':')
                const aiModelMetaInfo = await AiModel.getAiModel({ provider: provider!, model: model!, omitPricing: false })
                if (!aiModelMetaInfo) {
                    const message = `AI model not found: ${aiModel}`
                    err('AI model not found', { aiModel })
                    await ExtractionRun.markFailed({ extractionRunId, workspaceId, error: message })
                    natsService?.publish(`${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`, { error: message })
                    return
                }

                let imageModelMetaInfo: any = undefined
                let imageProvider: ProviderName | undefined = undefined
                if (aiImageModel) {
                    const [ip, im] = (aiImageModel as string).split(':')
                    imageModelMetaInfo = await AiModel.getAiModel({ provider: ip!, model: im!, omitPricing: false })
                    imageProvider = ip as ProviderName
                }

                info(`Starting feature extraction run ${extractionRunId} via dedicated 6-stage pipeline`)
                getLlmModule().processExtraction({
                    extractionRunId,
                    workspaceId,
                    userId,
                    organizationId,
                    intent: extractIntentFromMessages(messages),
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
            return await ExtractionRun.getRun({ extractionRunId, workspaceId })
        },
    },
]
