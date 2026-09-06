import {
    MEDIA_DESCRIPTOR_VERSION,
    type Asset,
    type CanvasState,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type CapabilityArtifactCanvasNode,
    type MediaDescriptor,
} from '@lixpi/constants'
import {
    applyStyle,
    createDocumentHtml,
} from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeToScreenForZoom,
    type CanvasEngineRect,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'
import {
    getGeneratedMediaModelId,
    getGeneratedMediaModelProvider,
    splitAiModelId,
    isGeneratedOutputAcceptedForCanvas,
    isGeneratedOutputReadyForReview,
    isGeneratedOutputRejectableForCanvas,
    type GeneratedOutputCanvasNode,
} from '../../shared/index.ts'
import {
    GeneratedOutputNodeChrome,
    type GeneratedOutputNodeChromeOptions,
} from './generated-output-node-chrome.ts'
import {
    type WorkspaceVideoChrome,
} from './workspace-video-chrome.ts'

type MediaNode = ImageCanvasNode | VideoCanvasNode

export type WorkspaceOutputChromePorts = {
    document: Document
    settings: GeneratedOutputNodeChromeOptions['settings']
    getState: () => CanvasState | null
    getViewport: () => CanvasViewport
    getBounds: (
        node: GeneratedOutputCanvasNode,
        nodesById: Map<string, CanvasNode>,
    ) => CanvasEngineRect
    getPendingBounds: (
        nodeId: string,
        bounds: CanvasEngineRect,
    ) => CanvasEngineRect | null
    getPendingNodeIds: () => ReadonlySet<string>
    getAsset: (assetId: string) => Asset | undefined
    getDocumentVersion: (
        assetId: string,
        role: 'capabilityArtifact' | 'provenance',
    ) => number | undefined
    getDescriptor: (node: MediaNode) => MediaDescriptor | undefined
    getTraceStatus: (node: MediaNode) => string | undefined
    isProgressActive: (node: GeneratedOutputCanvasNode) => boolean
    isSelected: (nodeId: string) => boolean
    getVideo: (nodeId: string) => HTMLVideoElement | null | undefined
    video: Pick<WorkspaceVideoChrome, 'sync' | 'update' | 'outsideOffsetScreen'>
    createModelBadge: (options: {
        modelId: string
        modelProvider: string
        iconOnly: boolean
    }) => HTMLElement | null
    mountTitle: (
        node: GeneratedOutputCanvasNode,
        host: HTMLElement,
    ) => () => void
    queueAnalysis: (node: MediaNode) => void
    onOpenDetails: (nodeId: string) => void
    onAccept: (nodeId: string) => void
    onReject: (nodeId: string) => void
    onRegenerate: (node: GeneratedOutputCanvasNode) => void
    requestFrame: (callback: FrameRequestCallback) => number
    cancelFrame: (handle: number) => void
    onError: (error: unknown) => void
    onSync?: (event: {
        rebuilt: boolean
        mediaCount: number
        pendingCount: number
        videoCount: number
    }) => void
}

export class WorkspaceOutputChrome {
    readonly element: HTMLDivElement
    readonly pendingElement: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private content = new Lifetime()
    private readonly footers = new Map<string, GeneratedOutputNodeChrome>()
    private readonly pendingIcons = new Map<string, HTMLElement>()
    private syncKey: string | null = null
    private frame: number | null = null
    private frameVersion = 0

    constructor(private readonly ports: WorkspaceOutputChromePorts) {
        const html = createDocumentHtml(ports.document)
        this.element = html`<div className="workspace-generated-media-chrome-layer"></div>` as HTMLDivElement
        this.pendingElement = html`<div className="workspace-generated-media-pending-icon-layer"></div>` as HTMLDivElement
        this.lifetime.own(() => this.element.remove())
        this.lifetime.own(() => this.pendingElement.remove())
        this.lifetime.own(() => this.clear())
    }

    invalidate(): void {
        this.syncKey = null
    }

    schedule(): void {
        if (
            this.lifetime.signal.aborted
            || this.frame !== null
        )
            return

        const version = this.frameVersion
        this.frame = this.ports.requestFrame(() => {
            if (version !== this.frameVersion)
                return

            this.frame = null

            if (this.lifetime.signal.aborted)
                return

            try {
                this.sync()
            } catch (error) {
                this.ports.onError(error)
            }
        })
    }

    sync(state = this.ports.getState()): void {
        if (this.lifetime.signal.aborted)
            return

        const nodes = state?.nodes ?? []
        const pendingIds = this.ports.getPendingNodeIds()
        const media = nodes.filter(
            (node): node is MediaNode => (node.type === 'image' || node.type === 'video') && Boolean(
                this.ports.getAsset(node.assetId) || node.generatedBy || node.generationProgress?.mediaModelId,
            ),
        )
        const artifacts = nodes.filter(
            (node): node is CapabilityArtifactCanvasNode => node.type === 'capabilityArtifact' && Boolean(
                this.ports.getAsset(node.assetId),
            ),
        )
        const pending = nodes.filter((node): node is MediaNode => (node.type === 'image' || node.type === 'video') && pendingIds.has(node.nodeId))
        const videos = nodes.filter(
            (node): node is VideoCanvasNode =>
                node.type === 'video' && this.ports.getAsset(node.assetId)?.media?.renditions.original?.status === 'ready',
        )

        for (const node of media) {
            const descriptor = this.ports.getDescriptor(node)

            if (
                descriptor?.status === 'ready'
                && descriptor.version !== MEDIA_DESCRIPTOR_VERSION
            )
                this.ports.queueAnalysis(node)
        }

        const key = [
            media.map(node => this.mediaKey(node)).join('\u001e'),
            artifacts.map(node => this.artifactKey(node)).join('\u001e'),
            pending.map(
                node => [node.nodeId, node.type, node.assetId, getGeneratedMediaModelId(node), getGeneratedMediaModelProvider(
                    node,
                    getGeneratedMediaModelId(node),
                ), node.generationProgress?.status ?? ''].join('\u001f'),
            ).join('\u001e'),
            videos.map(node => {
                const video = this.ports.getVideo(node.nodeId)

                return [node.nodeId, node.assetId, video ? 'video-element-ready' : 'video-element-missing', video?.currentSrc || video?.src || ''].join('\u001f')
            }).join('\u001e'),
        ].join('\u001d')
        this.ports.onSync?.({
            rebuilt: key !== this.syncKey,
            mediaCount: media.length,
            pendingCount: pending.length,
            videoCount: videos.length,
        })

        if (key === this.syncKey) {
            this.updateState(state)
            this.layout(
                this.ports.getViewport(),
                state,
            )

            return
        }

        this.clear()

        try {
            this.ports.video.sync(videos)

            for (const node of pending) this.mountPendingIcon(node)

            for (const node of [...media, ...artifacts]) this.mountFooter(
                node,
                state,
                pendingIds.has(node.nodeId),
            )

            this.layout(
                this.ports.getViewport(),
                state,
            )
            this.syncKey = key
        } catch (error) {
            try {
                this.clear()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Output chrome mounting failed')
            }

            throw error
        }
    }

    updateState(state = this.ports.getState()): void {
        if (this.lifetime.signal.aborted)
            return

        for (const node of state?.nodes ?? []) {
            if (
                node.type !== 'image'
                && node.type !== 'video'
                && node.type !== 'capabilityArtifact'
            )
                continue

            this.footers.get(node.nodeId)?.update({
                progressActive: this.ports.isProgressActive(node),
                selected: this.ports.isSelected(node.nodeId),
            })
        }
    }

    layout(
        viewport = this.ports.getViewport(),
        state = this.ports.getState(),
    ): void {
        if (this.lifetime.signal.aborted)
            return

        const nodesById = new Map(
            (state?.nodes ?? []).map(node => [node.nodeId, node]),
        )

        for (const node of state?.nodes ?? []) {
            if (
                node.type !== 'image'
                && node.type !== 'video'
                && node.type !== 'capabilityArtifact'
            )
                continue

            this.update(
                node.nodeId,
                this.ports.getBounds(node, nodesById),
                viewport,
            )
        }
    }

    update(
        nodeId: string,
        bounds: CanvasEngineRect,
        viewport: CanvasViewport,
    ): void {
        if (this.lifetime.signal.aborted)
            return

        this.footers.get(nodeId)?.setGeometry(
            this.ports.getPendingBounds(nodeId, bounds) ?? bounds,
            viewport,
            this.ports.video.outsideOffsetScreen(nodeId, viewport),
        )
        const icon = this.pendingIcons.get(nodeId)

        if (icon) {
            const zoom = Number.isFinite(viewport.zoom) ? Math.max(viewport.zoom, 0.01) : 1
            const scale = scaleCanvasChromeToScreenForZoom(
                1,
                zoom,
                getAdaptiveBoundedZoomScalingOptions(this.ports.settings.zoomScaling),
            )
            applyStyle(
                icon,
                {
                    left: `${viewport.x + (bounds.x + bounds.width / 2) * zoom}px`,
                    top: `${viewport.y + (bounds.y + bounds.height / 2) * zoom}px`,
                    transformOrigin: 'center',
                    transform: `translate(-50%, -50%) scale(${scale})`,
                },
            )
        }

        this.ports.video.update(
            nodeId,
            bounds,
            viewport,
        )
    }

    clear(): void {
        this.frameVersion += 1

        if (this.frame !== null)
            this.ports.cancelFrame(this.frame)

        this.frame = null
        this.syncKey = null
        this.footers.clear()
        this.pendingIcons.clear()
        const previous = this.content
        this.content = new Lifetime()

        try {
            previous.destroy()
        } finally {
            this.element.replaceChildren()
            this.pendingElement.replaceChildren()
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }

    private mountPendingIcon(node: MediaNode): void {
        const modelId = getGeneratedMediaModelId(node)
        const badge = this.ports.createModelBadge({
            modelId,
            modelProvider: getGeneratedMediaModelProvider(node, modelId),
            iconOnly: true,
        })
        const html = createDocumentHtml(this.ports.document)
        const icon = html`
            <div
                className="workspace-generated-media-pending-icon"
                data=${{ pendingMediaIconNodeId: node.nodeId }}
            >${badge}</div>
        ` as HTMLElement
        this.pendingIcons.set(node.nodeId, icon)
        this.pendingElement.appendChild(icon)
    }

    private mountFooter(
        node: GeneratedOutputCanvasNode,
        state: CanvasState | null,
        pending: boolean,
    ): void {
        const asset = this.ports.getAsset(node.assetId)
        const media = node.type !== 'capabilityArtifact'
        const modelId = media ? getGeneratedMediaModelId(node) : String(node.generatedBy?.reasoningModelId ?? '')
        const modelProvider = media ? getGeneratedMediaModelProvider(node, modelId) : splitAiModelId(modelId).provider
        const reviewContext = {
            node,
            asset,
            nodes: state?.nodes ?? [],
            edges: state?.edges ?? [],
        }
        const chrome = new GeneratedOutputNodeChrome({
            document: this.ports.document,
            nodeId: node.nodeId,
            kind: media ? 'media' : 'artifact',
            state: {
                pendingBeforeFrame: pending,
                generated: Boolean(node.generatedBy),
                hasAsset: Boolean(asset),
                accepted: isGeneratedOutputAcceptedForCanvas(reviewContext),
                superseded: asset?.generatedOutputReview?.status === 'superseded',
                reviewReady: isGeneratedOutputReadyForReview(node, asset),
                rejectable: media && isGeneratedOutputRejectableForCanvas(reviewContext),
                analyzing: media && this.ports.getDescriptor(node)?.status === 'analyzing',
                progressActive: this.ports.isProgressActive(node),
                selected: this.ports.isSelected(node.nodeId),
            },
            modelBadge: pending ? null : this.ports.createModelBadge({
                modelId,
                modelProvider,
                iconOnly: false,
            }),
            settings: this.ports.settings,
            mountTitle: host => this.ports.mountTitle(node, host),
            onOpenDetails: () => this.ports.onOpenDetails(node.nodeId),
            onAccept: () => this.ports.onAccept(node.nodeId),
            onReject: () => this.ports.onReject(node.nodeId),
            onRegenerate: () => this.ports.onRegenerate(node),
        })
        this.content.own(() => chrome.destroy())
        this.footers.set(node.nodeId, chrome)
        this.element.appendChild(chrome.element)
    }

    private mediaKey(node: MediaNode): string {
        const asset = this.ports.getAsset(node.assetId)
        const descriptor = this.ports.getDescriptor(node)
        const descriptorKey = descriptor ? [descriptor.status ?? '', descriptor.source ?? '', descriptor.summary ?? '', ...(descriptor.entityTags ?? []), ...(descriptor.styleTags ?? []), String(
            descriptor.version ?? '',
        )].join('\u001f') : ''

        return [
            node.nodeId,
            node.type,
            node.assetId,
            getGeneratedMediaModelId(node),
            node.generatedBy?.reasoningModelId ?? '',
            node.generatedBy?.generationRequestId ?? '',
            node.generatedBy?.branchId ?? '',
            node.generatedBy?.lineageParentNodeId ?? '',
            node.generatedBy?.branchOriginNodeId ?? '',
            node.generatedBy?.branchForkNodeId ?? '',
            node.generatedBy?.branchLineNodeId ?? '',
            node.mediaGenerationPhase ?? '',
            this.ports.getTraceStatus(node) ?? '',
            descriptorKey,
            asset?.revision ?? '',
            asset?.title ?? '',
            asset?.scope ?? '',
            asset?.states.provenance ?? '',
            asset?.media?.renditions.original?.status ?? '',
            asset?.generatedOutputReview?.status ?? '',
        ].join('\u001f')
    }

    private artifactKey(node: CapabilityArtifactCanvasNode): string {
        const asset = this.ports.getAsset(node.assetId)

        return [
            node.nodeId,
            node.assetId,
            node.artifactTypeId,
            node.generatedBy?.reasoningModelId ?? '',
            asset?.revision ?? '',
            asset?.title ?? '',
            asset?.scope ?? '',
            this.ports.getDocumentVersion(node.assetId, 'capabilityArtifact') ?? '',
            this.ports.getDocumentVersion(node.assetId, 'provenance') ?? '',
        ].join('\u001f')
    }
}
