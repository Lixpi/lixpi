'use strict'

import { err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { NATS_SUBJECTS, type ProviderName } from '@lixpi/constants'

import Workspace from '../../models/workspace.ts'
import AiModel from '../../models/ai-model.ts'
import { describeMediaStill } from '../../llm/media-descriptor.ts'

const { MEDIA_DESCRIBE } = NATS_SUBJECTS.AI_INTERACTION_SUBJECTS

const verifyWorkspaceAccess = async (userId: string, workspaceId: string): Promise<boolean> => {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace)
}

// Reply subject: caption a single media still on demand. The client passes the
// fileId of a representative still (an image's own file, or a video's mid-frame
// / poster) plus the user's currently-selected aiModel — the same VLM-capable
// model the chat uses — so we never hardcode a model. The MP4 is never sent.
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
            const { user: { userId }, workspaceId, fileId, aiModel } = data as {
                user: { userId: string }
                workspaceId: string
                fileId: string
                aiModel: string
            }

            if (!workspaceId || !fileId || !(await verifyWorkspaceAccess(userId, workspaceId))) {
                return { error: 'WORKSPACE_ACCESS_DENIED' }
            }
            if (!aiModel || !aiModel.includes(':')) {
                return { error: 'AI_MODEL_REQUIRED' }
            }

            const [provider, modelVersion] = aiModel.split(':')
            const aiModelMetaInfo = await AiModel.getAiModel({ provider: provider!, model: modelVersion!, omitPricing: true })
            if (!aiModelMetaInfo) {
                return { error: `AI_MODEL_NOT_FOUND:${aiModel}` }
            }

            const natsService = NATS_Service.getInstance()
            if (!natsService) {
                return { error: 'NATS_UNAVAILABLE' }
            }

            try {
                const descriptor = await describeMediaStill({
                    provider: provider as ProviderName,
                    modelVersion: modelVersion!,
                    imageUrl: `nats-obj://workspace-${workspaceId}-files/${fileId}`,
                    natsService,
                    maxTokens: aiModelMetaInfo.maxCompletionSize,
                })
                return { ...descriptor }
            } catch (error: any) {
                const message = error?.message ?? String(error)
                err(`media describe failed for workspace ${workspaceId} file ${fileId}: ${message}`)
                return { error: message }
            }
        },
    },
]
