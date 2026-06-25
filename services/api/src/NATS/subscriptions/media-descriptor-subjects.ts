'use strict'

import { err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type AiModelId, type ProviderName } from '@lixpi/constants'

import Workspace from '../../models/workspace.ts'
import AiModel from '../../models/ai-model.ts'
import { describeMediaStill, describeTextContent } from '../../llm/media-descriptor.ts'
import { settings } from '../../settings.ts'

const { MEDIA_DESCRIBE } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

// Reply subject: describe a single context-bearing node on demand. Two shapes:
//   - media: the client passes the `fileId` of a representative still (an image's
//     own file, or a video's mid-frame / poster) → one VLM caption. The MP4 is
//     never sent.
//   - text: the client passes `text` (+ optional `title`) flattened from a
//     document / chat-thread node → a text summary, no pixels.
// Media stills use the API-owned media descriptor VLM setting. Text descriptors
// still use the caller's selected model because those are lightweight summaries
// of user-authored text, not media analysis.
export const mediaDescriptorSubjects = [
    {
        subject: MEDIA_DESCRIBE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [MEDIA_DESCRIBE] },
            sub: { allow: [MEDIA_DESCRIBE] },
        },
        handler: async (data: any) => {
            const { user: { userId }, workspaceId, fileId, text, title, aiModel } = data as {
                user: { userId: string }
                workspaceId: string
                fileId?: string
                text?: string
                title?: string
                aiModel?: string
            }

            const hasText = typeof text === 'string' && text.trim().length > 0

            if (!workspaceId || (!fileId && !hasText) || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            const descriptorModelId = (hasText ? aiModel : settings.mediaDescriptor.defaultVlmModelId) as AiModelId | undefined
            if (!descriptorModelId || !descriptorModelId.includes(':')) {
                return { error: 'AI_MODEL_REQUIRED' }
            }

            const [provider, modelVersion] = descriptorModelId.split(':')
            const aiModelMetaInfo = await AiModel.getAiModel({ provider: provider!, model: modelVersion!, omitPricing: true })
            const maxTokens = aiModelMetaInfo?.maxCompletionSize || (!hasText ? settings.mediaDescriptor.defaultVlmMaxTokens : undefined)
            if (!maxTokens) {
                return { error: `AI_MODEL_NOT_FOUND:${descriptorModelId}` }
            }

            const natsService = NATS_Service.getInstance()
            if (!natsService) {
                return { error: 'NATS_UNAVAILABLE' }
            }

            try {
                const descriptor = hasText
                    ? await describeTextContent({
                        provider: provider as ProviderName,
                        modelVersion: modelVersion!,
                        text: text!,
                        title,
                        natsService,
                        maxTokens,
                    })
                    : await describeMediaStill({
                        provider: provider as ProviderName,
                        modelVersion: modelVersion!,
                        imageUrl: `nats-obj://workspace-${workspaceId}-files/${fileId}`,
                        natsService,
                        maxTokens,
                    })
                if (!hasText && !descriptor.summary?.trim()) {
                    err(`media describe returned empty summary for workspace ${workspaceId} file ${fileId}`)
                    return { error: 'MEDIA_DESCRIPTOR_EMPTY' }
                }
                return { ...descriptor }
            } catch (error: any) {
                const message = error?.message ?? String(error)
                err(`media describe failed for workspace ${workspaceId} ${hasText ? 'text node' : `file ${fileId}`}: ${message}`)
                return { error: message }
            }
        },
    },
]
