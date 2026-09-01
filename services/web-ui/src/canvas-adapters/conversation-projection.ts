import {
    type WorkspaceConversationProjectionPorts,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import type AssetService from '$src/services/asset-service.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import {
    type WorkspaceCanvasConversation,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'

export function createConversationProjectionFetch(assetService: AssetService): WorkspaceConversationProjectionPorts<WorkspaceCanvasConversation>['fetchThread'] {
    return async ({ workspaceId, threadId }) => {
        const asset = await assetService.get(threadId, workspaceId)
        if ('error' in asset || !asset.documents.conversation) return null
        await assetService.resumeDocument({ organizationId: asset.organizationId, assetId: asset.assetId, role: 'conversation' })
        const snapshot = assetDocumentsStore.get(asset.assetId, 'conversation')
        if (!snapshot) return null
        return {
            threadId: asset.assetId,
            assetId: asset.assetId,
            organizationId: asset.organizationId,
            revision: asset.revision,
            workspaceId,
            title: asset.title,
            content: snapshot.doc,
            proseMirrorVersion: snapshot.version,
            status: asset.states.conversation === 'none' ? 'idle' : asset.states.conversation,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            aiModel: '',
        }
    }
}
