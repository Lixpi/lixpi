import { createMediaGenerationProgress } from '@lixpi/canvas-components-lixpi-specific/frontend/progress'
import {
    type WorkspaceAssetDetailsPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'
import {
    type WorkspaceLibraryPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/library'
import {
    type CapabilityArtifactCanvasNode,
    type ImageCanvasNode,
    type MediaDescriptor,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type WorkspaceCanvasContext,
} from './workspace-canvas-context.ts'
import {
    type WorkspaceCanvasEditors,
} from './workspace-canvas-editors.ts'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

export type WorkspaceCanvasAssetsPorts = {
    host: WorkspaceCanvasHost
    document: Document
    editors: WorkspaceCanvasEditors
    context: WorkspaceCanvasContext
    getWorkspaceId: () => string
    refreshChrome: () => void
    reportError: (message: string, error: unknown) => void
}

export class WorkspaceCanvasAssets {
    constructor(private readonly ports: WorkspaceCanvasAssetsPorts) {}

    getDescriptor = (node: ImageCanvasNode | VideoCanvasNode): MediaDescriptor | undefined => {
        return this.ports.host.assets.read(node.assetId)?.descriptor as MediaDescriptor | undefined
    }

    getArtifactProvenance = (node: CapabilityArtifactCanvasNode): Record<string, any> => {
        const document = this.ports.host.assets.readDocument(node.assetId, 'provenance')?.doc
        const text = document ? this.ports.host.extractText(document) : ''
        if (text) {
            try {
                const parsed = JSON.parse(text)
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
            } catch {
                // Older provenance documents can be plain text. Canvas metadata
                // remains the replay fallback for those records.
            }
        }
        return {
            input: node.generatedBy?.input ?? {},
            variant: { reasoningModelId: node.generatedBy?.reasoningModelId ?? '' },
        }
    }

    createViewPorts = (): WorkspaceAssetDetailsPorts => {
        const host = this.ports.host
        return {
            document: this.ports.document,
            workspaceId: this.ports.getWorkspaceId(),
            userId: host.workspace.userId(),
            tooltipHideDelayMs: host.settings.helpTooltip.interactiveHideDelayMs,
            getAsset: assetId => host.assets.read(assetId),
            getContentDocument: assetId => {
                const snapshot = host.assets.readDocument(assetId, 'content')
                return snapshot ? { doc: snapshot.doc as ProseMirrorJsonNode, version: snapshot.version } : undefined
            },
            mountEditor: this.ports.editors.mountAsset,
            updateMetadata: async (assetId, revision, patch) => {
                const updated = await host.assets.updateMetadata(assetId, revision, patch)
                if (!('error' in updated)) host.assets.upsert(updated)
                return updated
            },
            changeScope: async (assetId, revision, scope, ownerId) => {
                const updated = await host.assets.changeScope(assetId, revision, scope, ownerId)
                if (!('error' in updated)) host.assets.upsert(updated)
                return updated
            },
            attestSubjectIdentity: async (assetId, revision, classification) => {
                const updated = await host.assets.attestSubjectIdentity(assetId, revision, classification)
                if (!('error' in updated)) host.assets.upsert(updated)
                return updated
            },
            onChanged: this.ports.refreshChrome,
            onError: error => this.ports.reportError('Canvas Asset update failed:', error),
        }
    }

    createLibraryPorts = (): WorkspaceLibraryPorts => {
        const host = this.ports.host
        return {
            document: this.ports.document,
            workspaceId: this.ports.getWorkspaceId(),
            userId: host.workspace.userId() as string,
            assets: {
                list: query => host.assets.list(query),
                get: async (assetId, workspaceId) => {
                    const asset = await host.assets.get(assetId, workspaceId)
                    if (!('error' in asset)) host.assets.upsert(asset)
                    return asset
                },
                refresh: (assetId, workspaceId) => host.assets.refresh(assetId, workspaceId),
                updateMetadata: (assetId, revision, patch) => host.assets.updateMetadata(assetId, revision, patch),
                changeScope: (assetId, revision, scope, ownerId) => host.assets.changeScope(assetId, revision, scope, ownerId),
                resumeDocument: coordinate => host.assets.resumeDocument(coordinate),
                getDocument: (assetId, role) => host.assets.readDocument(assetId, role),
            },
            mountHistory: ({ host: mount, asset, content }) =>
                this.ports.editors.mountHistory({
                    mount,
                    content: content as never,
                    threadId: asset.lineage?.sourceConversationAssetId ?? asset.assetId,
                    documentType: 'assetProvenance',
                    contextPreview: this.ports.context.getAiUserMessagePreviewRenderer(),
                    promptReferencePreviewRenderer: this.ports.context.getPromptReferencePreviewRenderer(),
                    mediaGenerationProgress: ({ id, state, showSummaryWhenCollapsedItemIds }) =>
                        createMediaGenerationProgress({
                            id: `provenance:${asset.assetId}:${id}`,
                            state,
                            defaultExpanded: true,
                            showSummaryWhenCollapsedItemIds,
                            ...host.traceDetail({ previewRenderer: this.ports.context.getPromptReferencePreviewRenderer() }),
                        }),
                }),
            onError: error => this.ports.reportError('Workspace library failed:', error),
        }
    }
}
