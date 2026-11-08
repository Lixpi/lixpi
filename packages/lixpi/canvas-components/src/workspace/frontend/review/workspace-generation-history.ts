import {
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type ImageGenerationTraceReference,
    type MediaGenerationProgressState,
} from '@lixpi/constants'
import {
    type AiLineageProjectionScope,
} from '@lixpi/prosemirror'
import { buildGeneratedMediaTurnProjectionFromThreadContent } from '@lixpi/prosemirror/shared/generated-media-turn-projection'
import { getGeneratedMediaProjectionLocator } from '../../shared/review/workspace-history.ts'
export { getGeneratedMediaProjectionLocator } from '../../shared/review/workspace-history.ts'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { resolveMediaGenerationHistoryProgress } from '../../shared/index.ts'
import {
    createContextPreviewTile,
    type ContextPreviewEnvironment,
} from '../context/index.ts'
import {
    createMediaGenerationProgress,
    type MediaGenerationProgressInstance,
    type MediaGenerationProgressOptions,
} from '../progress/index.ts'

type MediaNode = ImageCanvasNode | VideoCanvasNode
export type WorkspaceHistoryProjection = {
    threadId: string
    content: ProseMirrorJsonNode
}
export type WorkspaceHistoryProgressRequest = {
    id: string
    state: MediaGenerationProgressState
    showSummaryWhenCollapsedItemIds: readonly string[]
}
export type WorkspaceHistoryEditorRequest = {
    mount: HTMLElement
    content: ProseMirrorJsonNode
    threadId: string
    className: string
    signal: AbortSignal
    traceDetailsOptions: {
        className: string
        hideToolPrompt: boolean
        getAdditionalReferenceImageSources: (reference: ImageGenerationTraceReference) => string[]
        renderReferenceTile: (reference: ImageGenerationTraceReference) => HTMLElement | null
    }
    mediaGenerationProgress?: (request: WorkspaceHistoryProgressRequest) => MediaGenerationProgressInstance
}

export type WorkspaceGenerationHistoryPorts = {
    getNode: (nodeId: string) => CanvasNode | undefined
    getContextEnvironment: () => ContextPreviewEnvironment
    renditionPath: (
        assetId: string,
        rendition: string,
    ) => string
    getMediaContent: (node: MediaNode) => unknown
    getProgress: (node: MediaNode) => MediaGenerationProgressState | null
    mountEditor: (request: WorkspaceHistoryEditorRequest) => { destroy: () => void }
    createReasoningBadge: (modelId: string) => HTMLElement | null
    styleReasoningHeader: (header: HTMLElement) => void
    progressDetails: Pick<MediaGenerationProgressOptions, 'renderItemDetail' | 'getItemDetailKey'>
    onError: (error: unknown) => void
}

export type WorkspaceGenerationHistoryOptions = {
    host: HTMLElement
    projection: WorkspaceHistoryProjection
    signal?: AbortSignal
    media?: {
        node: MediaNode
        limitToSelectedMedia: boolean
        onProgress: (progress: MediaGenerationProgressInstance) => void
    }
}

export const mountWorkspaceMediaHistory = (
    request: {
        host: HTMLElement
        node: MediaNode
        lineageProjectionScope: AiLineageProjectionScope
        limitToSelectedMedia: boolean
        signal?: AbortSignal
        onProgress: (progress: MediaGenerationProgressInstance) => void
    },
    ports: WorkspaceGenerationHistoryPorts,
): WorkspaceGenerationHistory | null => {
    if (
        request.signal?.aborted
        || !request.node.generatedBy
    )
        return null

    const locator = getGeneratedMediaProjectionLocator(request.node)

    if (!locator)
        return null

    const projection = buildGeneratedMediaTurnProjectionFromThreadContent(
        ports.getMediaContent(request.node),
        locator,
        {
            threadId: request.node.generatedBy.conversationAssetId,
            forceGenerationDetailsOpen: true,
            limitToLocatorMedia: request.limitToSelectedMedia,
            lineageProjectionScope: request.lineageProjectionScope,
            includeGenerationProgressTimeline: true,
        },
    )

    return projection
        ? new WorkspaceGenerationHistory(
            {
                host: request.host,
                projection,
                signal: request.signal,
                media: {
                    node: request.node,
                    limitToSelectedMedia: request.limitToSelectedMedia,
                    onProgress: request.onProgress,
                },
            },
            ports,
        )
        : null
}

// A history projection owns the editor, trace previews and timeline instances.
export class WorkspaceGenerationHistory {
    private readonly lifetime = new Lifetime()

    constructor(
        private readonly options: WorkspaceGenerationHistoryOptions,
        private readonly ports: WorkspaceGenerationHistoryPorts,
    ) {
        const html = createDocumentHtml(options.host.ownerDocument)

        if (options.signal?.aborted) {
            this.lifetime.destroy()

            return
        }

        const abort = () => {
            try {
                this.destroy()
            } catch (error) {
                ports.onError(error)
            }
        }
        options.signal?.addEventListener(
            'abort',
            abort,
            { once: true },
        )
        this.lifetime.own(() => options.signal?.removeEventListener('abort', abort))

        try {
            const reasoningModelId = options.media?.node.generatedBy?.reasoningModelId

            if (reasoningModelId) {
                const header = html`
                    <div className="canvas-generated-media-reasoning-model">
                    <span className="canvas-generated-media-reasoning-model-caption">Reasoning model:</span>
                    ${ports.createReasoningBadge(reasoningModelId)}
                </div>
                ` as HTMLElement
                this.lifetime.own(() => header.remove())
                ports.styleReasoningHeader(header)
                options.host.appendChild(header)
            }

            const mount = html`<div className="canvas-generated-media-projection"></div>` as HTMLElement
            this.lifetime.own(() => mount.remove())
            options.host.appendChild(mount)
            const editor = ports.mountEditor({
                mount,
                content: options.projection.content,
                threadId: options.projection.threadId,
                signal: this.lifetime.signal,
                className: 'canvas-generated-media-projection-editor workspace-ai-chat-panel-projection-editor',
                traceDetailsOptions: {
                    className: 'canvas-generated-media-trace-details workspace-ai-chat-panel-trace-details',
                    hideToolPrompt: Boolean(options.media),
                    getAdditionalReferenceImageSources: reference => this.referenceSources(reference),
                    renderReferenceTile: reference => this.referenceTile(reference),
                },
                mediaGenerationProgress: options.media ? request => this.createProgress(request) : undefined,
            })
            this.lifetime.own(() => editor.destroy())
        } catch (error) {
            try {
                this.lifetime.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'History projection mounting failed')
            }

            throw error
        }
    }

    destroy = (): void => void this.lifetime.destroy()

    private referenceSources(reference: ImageGenerationTraceReference): string[] {
        if (
            this.lifetime.signal.aborted
            || !reference.nodeId
        )
            return []

        const node = this.ports.getNode(reference.nodeId)

        if (node?.type === 'image')
            return [this.ports.renditionPath(node.assetId, 'preview')]

        if (node?.type === 'video')
            return [this.ports.renditionPath(node.assetId, 'representativeFrame'), this.ports.renditionPath(node.assetId, 'poster')]

        return []
    }

    private referenceTile(reference: ImageGenerationTraceReference): HTMLElement | null {
        if (
            this.lifetime.signal.aborted
            || !reference.nodeId
        )
            return null

        const node = this.ports.getNode(reference.nodeId)

        if (!node)
            return null

        const tile = createContextPreviewTile({
            node,
            getNode: () => this.ports.getNode(reference.nodeId!) ?? node,
            environment: this.ports.getContextEnvironment(),
            preferredPlacement: 'bottom',
            inlinePopover: true,
        })
        this.lifetime.own(() => tile.destroy())

        return tile.dom
    }

    private createProgress(request: WorkspaceHistoryProgressRequest): MediaGenerationProgressInstance {
        if (this.lifetime.signal.aborted)
            throw new Error('History projection is disposed')

        const media = this.options.media!
        const liveState = this.ports.getProgress(media.node)
        const liveRunId = liveState?.mediaRunId ?? liveState?.lineageAssignment?.mediaRunId
        const projectedRunId = request.state.mediaRunId ?? request.state.lineageAssignment?.mediaRunId
        const matchesLiveTarget = Boolean(liveState && (media.limitToSelectedMedia || (liveRunId && liveRunId === projectedRunId)))
        const progress = createMediaGenerationProgress({
            id: `history:${media.node.nodeId}:${request.id}`,
            state: resolveMediaGenerationHistoryProgress({
                projectedState: request.state,
                liveState,
                matchesLiveTarget,
            }),
            className: 'workspace-media-generation-sidebar-progress',
            defaultExpanded: true,
            showSummaryWhenCollapsedItemIds: request.showSummaryWhenCollapsedItemIds,
            ...this.ports.progressDetails,
        })
        const destroy = this.lifetime.own(() => progress.destroy())
        const view: MediaGenerationProgressInstance = {
            element: progress.element,
            update: state => progress.update(state),
            destroy,
        }

        if (matchesLiveTarget)
            media.onProgress(view)

        return view
    }
}
