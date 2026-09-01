import {
    type Asset,
    type CapabilityArtifactCanvasNode,
    type CanvasNode,
    type DocumentCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    documentIcon,
    videoPlayGlyphIcon,
} from '@lixpi/ui-kit/svg'
import {
    createDocumentHtml,
    getElementScale,
} from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    createContextPreviewPopover,
    type ContextPreviewPopoverPlacement,
    type ContextPreviewPopoverContent,
    type ContextPreviewPopoverInstance,
    type ContextPreviewPortal,
} from '@lixpi/ui-kit/components/preview'

export type ContextPreviewDocumentSource = {
    documentId: string
    title?: string
    content?: string | object
}

export type ContextPreviewThreadSource = {
    threadId: string
    title?: string
    content?: string | object
}

export type ContextPreviewEnvironment = {
    getDocuments: () => ContextPreviewDocumentSource[]
    getThreads: () => ContextPreviewThreadSource[]
    getAsset?: (assetId: string) => Asset | undefined
    document: Document
    tooltipHideDelayMs: number
    getArtifactIcon: (artifactTypeId: string) => string
    extractDocumentText: (content: string | object) => string
    initialRenditionUrl: (assetId: string, rendition: string) => string
    resolveRenditionUrl: (assetId: string, rendition: string, signal: AbortSignal) => Promise<string>
    onError: (error: unknown) => void
}

export type ContextPreviewTileInstance = {
    dom: HTMLElement
    destroy: () => void
}

export type CreateContextPreviewTileOptions = {
    node: CanvasNode
    getNode?: () => CanvasNode | undefined
    environment: ContextPreviewEnvironment
    preferredPlacement?: ContextPreviewPopoverPlacement
    triggerContent?: HTMLElement
    titleOverride?: string
    // When true, canvas hover cards are projected to the owning pane while open and
    // receive the viewport scale. Non-canvas cards stay inline. This preserves canvas
    // sizing without trapping the card inside clamped node text or node stacking.
    inlinePopover?: boolean
}

type ContextPreviewPopoverOrientation = 'landscape' | 'portrait'

export const CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES = [
    '--context-preview-tooltip-background',
    '--context-preview-tooltip-border',
    '--context-preview-tooltip-border-radius',
    '--context-preview-tooltip-box-shadow',
    '--context-preview-tooltip-color',
    '--context-preview-border-radius',
    '--context-preview-video-background',
    '--context-preview-video-glyph-background',
    '--context-preview-video-glyph-color',
    '--context-preview-document-color',
    '--context-preview-document-icon-color',
    '--context-preview-document-text-color',
    '--context-preview-popover-title-color',
    '--context-preview-popover-text-color',
]

function getContextChipLabel(node: CanvasNode): string {
    switch (node.type) {
        case 'document':
            return 'Document'
        case 'audio':
            return 'Audio'
        case 'image':
        case 'video':
            return ''
        case 'capabilityArtifact':
            return 'Artifact'
        default:
            return node.type
    }
}

function getContextPreviewTitle(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    if ('assetId' in node && node.assetId) {
        const assetTitle = environment.getAsset?.(node.assetId)?.title?.trim()
        if (assetTitle) return assetTitle
    }
    if (node.type === 'document') {
        const document = environment.getDocuments().find((item) => item.documentId === node.assetId)
        const title = document?.title?.trim()
        if (title) return title
    }
    if (node.type === 'image' || node.type === 'video') return ''
    return getContextChipLabel(node)
}

function resolveContextPreviewTitle(
    node: CanvasNode,
    environment: ContextPreviewEnvironment,
    titleOverride?: string,
): string {
    return getContextPreviewTitle(node, environment) || titleOverride?.trim() || ''
}

function getContextPreviewText(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    const asset = 'assetId' in node && node.assetId ? environment.getAsset?.(node.assetId) : undefined
    const descriptor = asset?.descriptor?.status === 'ready'
        ? asset.descriptor.summary.trim()
        : ''
    if (descriptor) return descriptor

    if (node.type === 'document') {
        const document = environment.getDocuments().find((item) => item.documentId === node.assetId)
        return environment.extractDocumentText(document?.content ?? '').trim()
    }

    return ''
}

function getContextPreviewTypeLabel(node: CanvasNode): string {
    switch (node.type) {
        case 'document':
            return 'Document'
        case 'image':
            return 'Image'
        case 'video':
            return 'Video'
        case 'audio':
            return 'Audio'
        default:
            return node.type
    }
}

export function getContextPreviewAccessibleLabel(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    return getContextPreviewTitle(node, environment) || getContextPreviewTypeLabel(node)
}

class ContextPreviewVisual {
    private readonly lifetime = new Lifetime()
    private readonly html: ReturnType<typeof createDocumentHtml>

    constructor(private readonly environment: ContextPreviewEnvironment) {
        this.html = createDocumentHtml(environment.document)
    }

    private async hydrateMedia(element: HTMLImageElement | HTMLVideoElement, assetId: string, rendition: string, attribute: 'src' | 'poster' = 'src'): Promise<void> {
        try {
            const source = await this.environment.resolveRenditionUrl(assetId, rendition, this.lifetime.signal)
            if (this.lifetime.signal.aborted || !source || !element.isConnected) return
            if (attribute === 'poster') (element as HTMLVideoElement).poster = source
            else element.src = source
        } catch (error) {
            if (!this.lifetime.signal.aborted) this.environment.onError(error)
        }
    }

    private setContextPreviewVideoSources(videoEl: HTMLVideoElement, node: VideoCanvasNode, environment: ContextPreviewEnvironment): void {
        this.lifetime.own(() => {
            videoEl.pause()
            videoEl.removeAttribute('src')
            videoEl.removeAttribute('poster')
            videoEl.load()
        })
        const videoUrl = 'original'
        const posterUrl = 'poster'
        const initialSrc = environment.initialRenditionUrl(node.assetId, videoUrl)
        const initialPoster = environment.initialRenditionUrl(node.assetId, posterUrl)
        if (initialSrc) videoEl.src = initialSrc
        if (initialPoster) videoEl.poster = initialPoster
        void this.hydrateMedia(videoEl, node.assetId, videoUrl)
        void this.hydrateMedia(videoEl, node.assetId, posterUrl, 'poster')
    }

    private renderContextImagePreview(node: ImageCanvasNode, label: string, environment: ContextPreviewEnvironment, size: 'mini' | 'large'): HTMLElement {
        const previewUrl = 'preview'
        const imageEl = this.html`<img
            className=${`context-preview-image context-preview-image-${size}`}
            src=${environment.initialRenditionUrl(node.assetId, previewUrl)}
            alt=""
            aria-label=${label}
            loading="lazy"
        />` as HTMLImageElement
        void this.hydrateMedia(imageEl, node.assetId, previewUrl)
        return imageEl
    }

    private renderContextVideoPreview(node: VideoCanvasNode, label: string, environment: ContextPreviewEnvironment, size: 'mini' | 'large'): HTMLElement {
        if (size === 'large') {
            const previewEl = this.html`<div className="context-preview-video context-preview-video-large">
                <video
                    muted="true"
                    playsinline="true"
                    preload="metadata"
                    controls="true"
                    aria-label=${label}
                ></video>
                <span className="context-preview-video-glyph" innerHTML=${videoPlayGlyphIcon}></span>
            </div>` as HTMLElement
            const videoEl = previewEl.querySelector('video')
            if (videoEl) this.setContextPreviewVideoSources(videoEl, node, environment)
            return previewEl
        }

        const previewEl = this.html`<div className="context-preview-video context-preview-video-mini">
            <video
                muted="true"
                playsinline="true"
                preload="metadata"
                aria-label=${label}
            ></video>
            <span className="context-preview-video-glyph" innerHTML=${videoPlayGlyphIcon}></span>
        </div>` as HTMLElement
        const videoEl = previewEl.querySelector('video')
        if (videoEl) this.setContextPreviewVideoSources(videoEl, node, environment)
        return previewEl
    }

    private renderContextDocumentPreview(
        node: DocumentCanvasNode,
        title: string,
        text: string,
        size: 'mini' | 'large',
    ): HTMLElement {
        if (size === 'mini') {
            return this.html`<div className="context-preview-document context-preview-document-mini">
                <span className="context-preview-document-icon" innerHTML=${documentIcon}></span>
                <span className="context-preview-document-skeleton" aria-label=${title}>
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            </div>` as HTMLElement
        }

        return this.html`<div className=${`context-preview-document context-preview-document-${size}`}>
            <span className="context-preview-document-icon" innerHTML=${documentIcon}></span>
            <span className="context-preview-document-lines">
                <span className="context-preview-document-title">${title}</span>
                <span className="context-preview-document-text">${text || getContextPreviewTypeLabel(node)}</span>
            </span>
        </div>` as HTMLElement
    }

    private renderContextArtifactPreview(
        node: CapabilityArtifactCanvasNode,
        title: string,
        size: 'mini' | 'large',
    ): HTMLElement {
        return this.html`<div className=${`context-preview-artifact context-preview-artifact-${size}`}>
            <span className="context-preview-artifact-icon" innerHTML=${this.environment.getArtifactIcon(node.artifactTypeId)}></span>
            ${
            size === 'large'
                ? this.html`<span className="context-preview-artifact-title">${title || 'Artifact'}</span>`
                : ''
        }
        </div>` as HTMLElement
    }

    renderContextPreviewVisual(
        node: CanvasNode,
        title: string,
        text: string,
        environment: ContextPreviewEnvironment,
        size: 'mini' | 'large',
    ): HTMLElement {
        if (node.type === 'image') return this.renderContextImagePreview(node, title, environment, size)
        if (node.type === 'video') return this.renderContextVideoPreview(node, title, environment, size)
        if (node.type === 'document') return this.renderContextDocumentPreview(node, title, text, size)
        if (node.type === 'capabilityArtifact') return this.renderContextArtifactPreview(node, title, size)
        return this.html`<div className="context-preview-document">${title}</div>` as HTMLElement
    }

    private renderContextPreviewPopoverMeta(title: string, text: string): HTMLElement {
        return this.html`<div className="context-preview-popover-meta">
            ${title ? this.html`<span className="context-preview-popover-title">${title}</span>` : ''}
            ${text ? this.html`<span className="context-preview-popover-text">${text}</span>` : ''}
        </div>` as HTMLElement
    }

    renderContextPreviewPopoverContent(
        node: CanvasNode,
        title: string,
        text: string,
        accessibleLabel: string,
        environment: ContextPreviewEnvironment,
    ): HTMLElement {
        if (node.type !== 'image' && node.type !== 'video') {
            return this.renderContextPreviewVisual(node, accessibleLabel, text, environment, 'large')
        }

        const hasPopoverMeta = Boolean(title || text)
        const orientation = hasPopoverMeta ? getContextPreviewPopoverOrientation(node) : 'landscape'
        return this.html`<div className=${`context-preview-popover-body context-preview-popover-body-${orientation}`}>
            <div className="context-preview-popover-media">
                ${this.renderContextPreviewVisual(node, accessibleLabel, text, environment, 'large')}
            </div>
            ${hasPopoverMeta ? this.renderContextPreviewPopoverMeta(title, text) : ''}
        </div>` as HTMLElement
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

function getContextPreviewPopoverOrientation(node: ImageCanvasNode | VideoCanvasNode): ContextPreviewPopoverOrientation {
    return node.dimensions.height > node.dimensions.width ? 'portrait' : 'landscape'
}

function getContextPreviewPopoverClassName(node: CanvasNode, hasPopoverMeta: boolean): string {
    const baseClassName = 'context-preview-popover'
    if ((node.type !== 'image' && node.type !== 'video') || !hasPopoverMeta) return baseClassName
    return `${baseClassName} ${baseClassName}-${getContextPreviewPopoverOrientation(node)}`
}

export function getContextPreviewCanvasPortal(dom: HTMLElement): ContextPreviewPortal | null {
    const pane = dom.closest<HTMLElement>('.workspace-pane')
    if (!pane) return null
    const viewport = dom.closest<HTMLElement>('.workspace-viewport')
    return {
        root: pane,
        scale: viewport ? getElementScale(viewport) : 1,
    }
}

class ContextPreviewTile implements ContextPreviewTileInstance {
    readonly dom: HTMLElement
    private readonly lifetime = new Lifetime()
    private readonly popover: ContextPreviewPopoverInstance
    private content: ContextPreviewVisual | null = null

    constructor(private readonly options: CreateContextPreviewTileOptions) {
        const { environment, triggerContent, preferredPlacement = 'top', inlinePopover = false } = options
        this.lifetime.own(() => this.content?.destroy())
        try {
            const initialState = this.renderState()
            const trigger = new ContextPreviewVisual(environment)
            this.lifetime.own(() => trigger.destroy())
            this.popover = createContextPreviewPopover({
                getPortal: getContextPreviewCanvasPortal,
                contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
                hideDelayMs: environment.tooltipHideDelayMs,
                ...initialState,
                triggerContent: triggerContent ?? trigger.renderContextPreviewVisual(initialState.latestNode, initialState.accessibleLabel, initialState.text, environment, 'mini'),
                preferredPlacement,
                inlinePopover,
                inlineLabelTrigger: !inlinePopover && Boolean(triggerContent),
                beforeOpen: () => {
                    if (!this.lifetime.signal.aborted) this.popover.updateContent(this.renderState())
                },
            })
            this.lifetime.own(() => this.popover.destroy())
            this.dom = this.popover.dom
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    private renderState(): ContextPreviewPopoverContent & { latestNode: CanvasNode; text: string } {
        const { environment, titleOverride } = this.options
        const latestNode = this.options.getNode?.() ?? this.options.node
        const title = resolveContextPreviewTitle(latestNode, environment, titleOverride)
        const text = getContextPreviewText(latestNode, environment)
        const accessibleLabel = title || getContextPreviewTypeLabel(latestNode)
        const content = new ContextPreviewVisual(environment)
        try {
            const state = {
                accessibleLabel,
                content: content.renderContextPreviewPopoverContent(latestNode, title, text, accessibleLabel, environment),
                contentClassName: getContextPreviewPopoverClassName(latestNode, Boolean(title || text)),
                latestNode,
                text,
            }
            this.content?.destroy()
            this.content = content
            return state
        } catch (error) {
            content.destroy()
            throw error
        }
    }

    destroy = (): void => {
        this.lifetime.destroy()
    }
}

export function createContextPreviewTile(options: CreateContextPreviewTileOptions): ContextPreviewTileInstance {
    return new ContextPreviewTile(options)
}
