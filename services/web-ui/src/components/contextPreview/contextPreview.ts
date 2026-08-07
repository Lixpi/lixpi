import type {
    Asset,
    CapabilityArtifactCanvasNode,
    CanvasNode,
    DocumentCanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'
import { createHelpTooltip, type HelpTooltipInstance } from '@lixpi/ui-kit/components/help-tooltip'
import { extractContentFromProseMirror } from '$src/utils/prosemirrorText.ts'
import { documentIcon, videoPlayGlyphIcon } from '@lixpi/ui-kit/svg'
import { getCapabilityArtifactIcon } from '$src/installed-capabilities.ts'
import { applyStyle, html } from '$src/utils/domTemplates.ts'
import {
    buildAssetRenditionPath,
    resolveAuthenticatedMediaUrl,
    resolveMediaUrl,
} from '$src/utils/mediaUrls.ts'
import { InteractivePreviewPopover } from './interactivePreviewPopover.ts'

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
    getApiBaseUrl: () => string
    getAuthToken: () => Promise<string>
}

export type ContextPreviewTileInstance = {
    dom: HTMLElement
    destroy: () => void
}

export type ContextPreviewPopoverPlacement = 'top' | 'bottom' | 'left' | 'right'

export type ContextPreviewPopoverContent = {
    accessibleLabel: string
    content: HTMLElement
    contentClassName: string
}

export type ContextPreviewPopoverInstance = ContextPreviewTileInstance & {
    updateContent: (content: ContextPreviewPopoverContent) => void
}

export type CreateContextPreviewPopoverOptions = ContextPreviewPopoverContent & {
    triggerContent: HTMLElement
    preferredPlacement?: ContextPreviewPopoverPlacement
    inlinePopover?: boolean
    inlineLabelTrigger?: boolean
    beforeOpen?: () => void
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
type ContextPreviewPlacement = ContextPreviewPopoverPlacement

type ContextPreviewCanvasPortal = {
    pane: HTMLElement
    scale: number
}

const TRANSPARENT_PIXEL_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const CONTEXT_PREVIEW_POPOVER_GAP = 10

export const CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES = [
    '--workspace-ai-chat-panel-context-preview-tooltip-background',
    '--workspace-ai-chat-panel-context-preview-tooltip-border',
    '--workspace-ai-chat-panel-context-preview-tooltip-border-radius',
    '--workspace-ai-chat-panel-context-preview-tooltip-box-shadow',
    '--workspace-ai-chat-panel-context-preview-tooltip-color',
    '--workspace-ai-chat-panel-context-preview-border-radius',
    '--workspace-ai-chat-panel-context-preview-video-background',
    '--workspace-ai-chat-panel-context-preview-video-glyph-background',
    '--workspace-ai-chat-panel-context-preview-video-glyph-color',
    '--workspace-ai-chat-panel-context-preview-document-color',
    '--workspace-ai-chat-panel-context-preview-document-icon-color',
    '--workspace-ai-chat-panel-context-preview-document-text-color',
    '--workspace-ai-chat-panel-context-preview-popover-title-color',
    '--workspace-ai-chat-panel-context-preview-popover-text-color',
]

const CONTEXT_PREVIEW_PORTAL_CSS_VARIABLES = [
    ...CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
    '--help-tooltip-width',
    '--help-tooltip-max-width',
    '--help-tooltip-padding',
    '--help-tooltip-background',
    '--help-tooltip-border-radius',
    '--help-tooltip-box-shadow',
    '--help-tooltip-color',
    '--help-tooltip-content-z-index',
]

function getContextChipLabel(node: CanvasNode): string {
    switch (node.type) {
        case 'document': return 'Document'
        case 'audio': return 'Audio'
        case 'image':
        case 'video': return ''
        case 'capabilityArtifact': return 'Artifact'
        default: return node.type
    }
}

function getContextPreviewTitle(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    if ('assetId' in node) {
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
    const asset = 'assetId' in node ? environment.getAsset?.(node.assetId) : undefined
    const descriptor = asset?.descriptor?.status === 'ready'
        ? asset.descriptor.summary.trim()
        : ''
    if (descriptor) return descriptor

    if (node.type === 'document') {
        const document = environment.getDocuments().find((item) => item.documentId === node.assetId)
        const { text } = extractContentFromProseMirror((document?.content ?? '') as string | object)
        return text.trim()
    }

    return ''
}

function getContextPreviewTypeLabel(node: CanvasNode): string {
    switch (node.type) {
        case 'document': return 'Document'
        case 'image': return 'Image'
        case 'video': return 'Video'
        case 'audio': return 'Audio'
        default: return node.type
    }
}

export function getContextPreviewAccessibleLabel(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    return getContextPreviewTitle(node, environment) || getContextPreviewTypeLabel(node)
}

function buildContextPreviewInitialMediaSrc(mediaUrl: string): string {
    return resolveMediaUrl(mediaUrl, {
        base64MimeType: 'image/png',
        emptyFallback: TRANSPARENT_PIXEL_SRC,
    })
}

async function buildContextPreviewAuthenticatedMediaSrc(mediaUrl: string, environment: ContextPreviewEnvironment): Promise<string> {
    return resolveAuthenticatedMediaUrl(mediaUrl, {
        apiBaseUrl: environment.getApiBaseUrl(),
        base64MimeType: 'image/png',
        emptyFallback: TRANSPARENT_PIXEL_SRC,
        getAuthToken: environment.getAuthToken,
    })
}

function hydrateContextPreviewMedia(
    el: HTMLImageElement | HTMLVideoElement,
    mediaUrl: string,
    environment: ContextPreviewEnvironment,
    attr: 'src' | 'poster' = 'src',
): void {
    if (!mediaUrl) return
    void (async () => {
        try {
            const src = await buildContextPreviewAuthenticatedMediaSrc(mediaUrl, environment)
            if (!src || !el.isConnected) return
            if (attr === 'poster' && el instanceof HTMLVideoElement) {
                el.poster = src
                return
            }
            el.src = src
        } catch (error) {
            console.warn('Failed to resolve context preview media URL:', error)
        }
    })()
}

function setContextPreviewVideoSources(videoEl: HTMLVideoElement, node: VideoCanvasNode, environment: ContextPreviewEnvironment): void {
    const videoUrl = buildAssetRenditionPath(node.assetId, 'original')
    const posterUrl = buildAssetRenditionPath(node.assetId, 'poster')
    const initialSrc = buildContextPreviewInitialMediaSrc(videoUrl)
    const initialPoster = buildContextPreviewInitialMediaSrc(posterUrl)
    if (initialSrc) videoEl.src = initialSrc
    if (initialPoster) videoEl.poster = initialPoster
    hydrateContextPreviewMedia(videoEl, videoUrl, environment)
    hydrateContextPreviewMedia(videoEl, posterUrl, environment, 'poster')
}

function renderContextImagePreview(node: ImageCanvasNode, label: string, environment: ContextPreviewEnvironment, size: 'mini' | 'large'): HTMLElement {
    const previewUrl = buildAssetRenditionPath(node.assetId, 'preview')
    const imageEl = html`<img
        className=${`workspace-ai-chat-panel-context-preview-image workspace-ai-chat-panel-context-preview-image-${size}`}
        src=${buildContextPreviewInitialMediaSrc(previewUrl)}
        alt=""
        loading="lazy"
    />` as HTMLImageElement
    imageEl.setAttribute('aria-label', label)
    hydrateContextPreviewMedia(imageEl, previewUrl, environment)
    return imageEl
}

function renderContextVideoPreview(node: VideoCanvasNode, label: string, environment: ContextPreviewEnvironment, size: 'mini' | 'large'): HTMLElement {
    if (size === 'large') {
        const previewEl = html`<div className="workspace-ai-chat-panel-context-preview-video workspace-ai-chat-panel-context-preview-video-large">
            <video
                muted="true"
                playsinline="true"
                preload="metadata"
                controls="true"
                aria-label=${label}
            ></video>
            <span className="workspace-ai-chat-panel-context-preview-video-glyph" innerHTML=${videoPlayGlyphIcon}></span>
        </div>` as HTMLElement
        const videoEl = previewEl.querySelector('video')
        if (videoEl) setContextPreviewVideoSources(videoEl, node, environment)
        return previewEl
    }

    const previewEl = html`<div className="workspace-ai-chat-panel-context-preview-video workspace-ai-chat-panel-context-preview-video-mini">
        <video
            muted="true"
            playsinline="true"
            preload="metadata"
            aria-label=${label}
        ></video>
        <span className="workspace-ai-chat-panel-context-preview-video-glyph" innerHTML=${videoPlayGlyphIcon}></span>
    </div>` as HTMLElement
    const videoEl = previewEl.querySelector('video')
    if (videoEl) setContextPreviewVideoSources(videoEl, node, environment)
    return previewEl
}

function renderContextDocumentPreview(
    node: DocumentCanvasNode,
    title: string,
    text: string,
    size: 'mini' | 'large',
): HTMLElement {
    if (size === 'mini') {
        return html`<div className="workspace-ai-chat-panel-context-preview-document workspace-ai-chat-panel-context-preview-document-mini">
            <span className="workspace-ai-chat-panel-context-preview-document-icon" innerHTML=${documentIcon}></span>
            <span className="workspace-ai-chat-panel-context-preview-document-skeleton" aria-label=${title}>
                <span></span>
                <span></span>
                <span></span>
            </span>
        </div>` as HTMLElement
    }

    return html`<div className=${`workspace-ai-chat-panel-context-preview-document workspace-ai-chat-panel-context-preview-document-${size}`}>
        <span className="workspace-ai-chat-panel-context-preview-document-icon" innerHTML=${documentIcon}></span>
        <span className="workspace-ai-chat-panel-context-preview-document-lines">
            <span className="workspace-ai-chat-panel-context-preview-document-title">${title}</span>
            <span className="workspace-ai-chat-panel-context-preview-document-text">${text || getContextPreviewTypeLabel(node)}</span>
        </span>
    </div>` as HTMLElement
}

function renderContextArtifactPreview(
    node: CapabilityArtifactCanvasNode,
    title: string,
    size: 'mini' | 'large',
): HTMLElement {
    return html`<div className=${`workspace-ai-chat-panel-context-preview-artifact workspace-ai-chat-panel-context-preview-artifact-${size}`}>
        <span className="workspace-ai-chat-panel-context-preview-artifact-icon" innerHTML=${getCapabilityArtifactIcon(node.artifactTypeId)}></span>
        ${size === 'large'
            ? html`<span className="workspace-ai-chat-panel-context-preview-artifact-title">${title || 'Artifact'}</span>`
            : ''}
    </div>` as HTMLElement
}

function renderContextPreviewVisual(
    node: CanvasNode,
    title: string,
    text: string,
    environment: ContextPreviewEnvironment,
    size: 'mini' | 'large',
): HTMLElement {
    if (node.type === 'image') return renderContextImagePreview(node, title, environment, size)
    if (node.type === 'video') return renderContextVideoPreview(node, title, environment, size)
    if (node.type === 'document') return renderContextDocumentPreview(node, title, text, size)
    if (node.type === 'capabilityArtifact') return renderContextArtifactPreview(node, title, size)
    return html`<div className="workspace-ai-chat-panel-context-preview-document">${title}</div>` as HTMLElement
}

function getContextPreviewPopoverOrientation(node: ImageCanvasNode | VideoCanvasNode): ContextPreviewPopoverOrientation {
    return node.dimensions.height > node.dimensions.width ? 'portrait' : 'landscape'
}

function renderContextPreviewPopoverMeta(title: string, text: string): HTMLElement {
    return html`<div className="workspace-ai-chat-panel-context-preview-popover-meta">
        ${title ? html`<span className="workspace-ai-chat-panel-context-preview-popover-title">${title}</span>` : ''}
        ${text ? html`<span className="workspace-ai-chat-panel-context-preview-popover-text">${text}</span>` : ''}
    </div>` as HTMLElement
}

function renderContextPreviewPopoverContent(
    node: CanvasNode,
    title: string,
    text: string,
    accessibleLabel: string,
    environment: ContextPreviewEnvironment,
): HTMLElement {
    if (node.type !== 'image' && node.type !== 'video') {
        return renderContextPreviewVisual(node, accessibleLabel, text, environment, 'large')
    }

    const hasPopoverMeta = Boolean(title || text)
    const orientation = hasPopoverMeta ? getContextPreviewPopoverOrientation(node) : 'landscape'
    return html`<div className=${`workspace-ai-chat-panel-context-preview-popover-body workspace-ai-chat-panel-context-preview-popover-body-${orientation}`}>
        <div className="workspace-ai-chat-panel-context-preview-popover-media">
            ${renderContextPreviewVisual(node, accessibleLabel, text, environment, 'large')}
        </div>
        ${hasPopoverMeta ? renderContextPreviewPopoverMeta(title, text) : ''}
    </div>` as HTMLElement
}

function getContextPreviewPopoverClassName(node: CanvasNode, hasPopoverMeta: boolean): string {
    const baseClassName = 'workspace-ai-chat-panel-context-preview-popover'
    if ((node.type !== 'image' && node.type !== 'video') || !hasPopoverMeta) return baseClassName
    return `${baseClassName} ${baseClassName}-${getContextPreviewPopoverOrientation(node)}`
}

function parseContextPreviewScale(transform: string): number {
    const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/u)
    if (matrixMatch?.[1]) {
        const values = matrixMatch[1].split(',').map(value => Number.parseFloat(value.trim()))
        const scale = Math.hypot(values[0] ?? 1, values[1] ?? 0)
        if (Number.isFinite(scale) && scale > 0) return scale
    }

    const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/u)
    if (matrix3dMatch?.[1]) {
        const values = matrix3dMatch[1].split(',').map(value => Number.parseFloat(value.trim()))
        const scale = Math.hypot(values[0] ?? 1, values[1] ?? 0)
        if (Number.isFinite(scale) && scale > 0) return scale
    }

    const scaleMatch = transform.match(/scale\(\s*([\d.+-]+)/u)
    const scale = scaleMatch?.[1] ? Number.parseFloat(scaleMatch[1]) : 1
    return Number.isFinite(scale) && scale > 0 ? scale : 1
}

function getContextPreviewCanvasPortal(dom: HTMLElement): ContextPreviewCanvasPortal | null {
    const pane = dom.closest<HTMLElement>('.workspace-pane')
    if (!pane) return null
    const viewport = dom.closest<HTMLElement>('.workspace-viewport')
    const transform = viewport
        ? getComputedStyle(viewport).transform || viewport.style.transform
        : ''
    return {
        pane,
        scale: parseContextPreviewScale(transform),
    }
}

function copyContextPreviewPortalCssVariables(source: HTMLElement, popover: HTMLElement): void {
    const styles = getComputedStyle(source)
    for (const name of CONTEXT_PREVIEW_PORTAL_CSS_VARIABLES) {
        const value = styles.getPropertyValue(name).trim()
        if (value) popover.style.setProperty(name, value)
    }
}

function positionContextPreviewCanvasPopover(
    trigger: HTMLElement,
    popover: HTMLElement,
    portal: ContextPreviewCanvasPortal,
    placement: ContextPreviewPlacement,
): void {
    const triggerRect = trigger.getBoundingClientRect()
    const paneRect = portal.pane.getBoundingClientRect()
    const triggerLeft = triggerRect.left - paneRect.left
    const triggerTop = triggerRect.top - paneRect.top
    const triggerRight = triggerRect.right - paneRect.left
    const triggerBottom = triggerRect.bottom - paneRect.top
    const scaledGap = `${CONTEXT_PREVIEW_POPOVER_GAP}px`
    const positionByPlacement: Record<ContextPreviewPlacement, {
        left: string
        top: string
        transform: string
    }> = {
        top: {
            left: `${triggerLeft}px`,
            top: `${triggerTop}px`,
            transform: `scale(${portal.scale}) translateY(calc(-100% - ${scaledGap}))`,
        },
        bottom: {
            left: `${triggerLeft}px`,
            top: `${triggerBottom}px`,
            transform: `scale(${portal.scale}) translateY(${scaledGap})`,
        },
        left: {
            left: `${triggerLeft}px`,
            top: `${triggerTop}px`,
            transform: `scale(${portal.scale}) translateX(calc(-100% - ${scaledGap}))`,
        },
        right: {
            left: `${triggerRight}px`,
            top: `${triggerTop}px`,
            transform: `scale(${portal.scale}) translateX(${scaledGap})`,
        },
    }
    applyStyle(popover, {
        ...positionByPlacement[placement],
        right: 'auto',
        bottom: 'auto',
        transformOrigin: 'top left',
    })
}

// Media and Capability references both use this shell. App surfaces use the
// viewport-clamped HelpTooltip portal. Canvas surfaces keep the trigger inline,
// then move the open card to the pane and preserve the viewport scale.
class ContextPreviewPopover implements ContextPreviewPopoverInstance {
    readonly dom: HTMLElement

    private readonly trigger: HTMLElement
    private readonly popover: HTMLElement
    private readonly helpTooltip: HelpTooltipInstance | null
    private readonly inlineController: InteractivePreviewPopover | null
    private readonly preferredPlacement: ContextPreviewPopoverPlacement
    private portal: ContextPreviewCanvasPortal | null = null
    private portalPositionFrame: number | null = null

    constructor(private readonly options: CreateContextPreviewPopoverOptions) {
        this.preferredPlacement = options.preferredPlacement ?? 'top'
        if (options.inlinePopover) {
            const rootClassName = [
                'workspace-ai-chat-panel-context-preview-main',
                'context-preview-inline',
                options.inlineLabelTrigger ? 'context-preview-inline-label' : '',
            ].filter(Boolean).join(' ')
            this.trigger = html`<div
                className="workspace-ai-chat-panel-context-preview-trigger context-preview-inline-trigger"
                tabindex="0"
                aria-label=${options.accessibleLabel}
                aria-expanded="false"
            >${options.triggerContent}</div>` as HTMLElement
            this.popover = html`<div className=${this.getInlinePopoverClassName(options.contentClassName, false)} role="tooltip">
                ${options.content}
            </div>` as HTMLElement
            this.dom = html`<div className=${rootClassName}>${this.trigger}${this.popover}</div>` as HTMLElement
            this.helpTooltip = null
            this.inlineController = new InteractivePreviewPopover({
                root: this.dom,
                trigger: this.trigger,
                popover: this.popover,
                beforeOpen: options.beforeOpen,
                afterOpen: this.portalPopoverToCanvasPane,
                afterClose: () => {
                    if (this.popover.parentElement !== this.dom) this.restorePopoverToTile()
                },
            })
            return
        }

        const usesInlineLabelTrigger = options.inlineLabelTrigger ?? false
        this.helpTooltip = createHelpTooltip({
            label: options.accessibleLabel,
            triggerContent: options.triggerContent,
            content: options.content,
            preferredPlacement: this.preferredPlacement,
            className: [
                'workspace-ai-chat-panel-context-preview-tooltip',
                usesInlineLabelTrigger ? 'workspace-ai-chat-panel-context-preview-tooltip-inline-label' : '',
            ].filter(Boolean).join(' '),
            triggerClassName: [
                'workspace-ai-chat-panel-context-preview-trigger',
                usesInlineLabelTrigger ? 'workspace-ai-chat-panel-context-preview-trigger-inline-label' : '',
            ].filter(Boolean).join(' '),
            contentClassName: options.contentClassName,
            contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
            interactive: true,
        })
        this.trigger = this.helpTooltip.dom.querySelector<HTMLElement>('.help-tooltip-trigger') as HTMLElement
        this.popover = this.helpTooltip.dom.querySelector<HTMLElement>('.help-tooltip-content') as HTMLElement
        this.dom = usesInlineLabelTrigger
            ? this.helpTooltip.dom
            : html`<div className="workspace-ai-chat-panel-context-preview-main">${this.helpTooltip.dom}</div>` as HTMLElement
        this.inlineController = null
        this.trigger.addEventListener('pointerenter', this.handleBeforeOpen, true)
        this.trigger.addEventListener('focusin', this.handleBeforeOpen, true)
    }

    updateContent = ({ accessibleLabel, content, contentClassName }: ContextPreviewPopoverContent): void => {
        this.popover.replaceChildren(content)
        this.trigger.setAttribute('aria-label', accessibleLabel)
        if (this.options.inlinePopover) {
            const isPortaled = this.popover.classList.contains('context-preview-inline-popover-portaled')
            this.popover.className = this.getInlinePopoverClassName(contentClassName, this.dom.classList.contains('is-open'))
            this.popover.classList.toggle('context-preview-inline-popover-portaled', isPortaled)
            return
        }

        const isVisible = this.popover.classList.contains('is-visible')
        this.popover.className = [
            'help-tooltip-content',
            contentClassName,
            'help-tooltip-content-interactive',
            isVisible ? 'is-visible' : '',
        ].filter(Boolean).join(' ')
    }

    destroy = (): void => {
        this.stopPortalPositionSync()
        if (this.helpTooltip) {
            this.trigger.removeEventListener('pointerenter', this.handleBeforeOpen, true)
            this.trigger.removeEventListener('focusin', this.handleBeforeOpen, true)
            this.helpTooltip.destroy()
            this.dom.remove()
            return
        }
        this.inlineController?.destroy()
    }

    private getInlinePopoverClassName(contentClassName: string, isOpen: boolean): string {
        return [
            contentClassName,
            'context-preview-inline-popover',
            `context-preview-inline-popover-${this.preferredPlacement}`,
            isOpen ? 'is-open' : '',
        ].filter(Boolean).join(' ')
    }

    private handleBeforeOpen = (): void => {
        this.options.beforeOpen?.()
    }

    private stopPortalPositionSync(): void {
        if (this.portalPositionFrame === null) return
        cancelAnimationFrame(this.portalPositionFrame)
        this.portalPositionFrame = null
    }

    private restorePopoverToTile(): void {
        this.stopPortalPositionSync()
        this.portal = null
        this.popover.classList.remove('context-preview-inline-popover-portaled')
        this.popover.removeAttribute('style')
        if (this.dom.isConnected) {
            this.dom.appendChild(this.popover)
            return
        }
        this.popover.remove()
    }

    private syncPortalPosition(): void {
        if (!this.portal || !this.dom.isConnected) return
        this.portal = getContextPreviewCanvasPortal(this.dom) ?? this.portal
        positionContextPreviewCanvasPopover(this.trigger, this.popover, this.portal, this.preferredPlacement)
    }

    private startPortalPositionSync(): void {
        this.stopPortalPositionSync()
        const update = (): void => {
            if (!this.dom.isConnected) {
                this.restorePopoverToTile()
                return
            }
            this.syncPortalPosition()
            this.portalPositionFrame = requestAnimationFrame(update)
        }
        this.portalPositionFrame = requestAnimationFrame(update)
    }

    private portalPopoverToCanvasPane = (): void => {
        const nextPortal = getContextPreviewCanvasPortal(this.dom)
        if (!nextPortal) return
        this.portal = nextPortal
        copyContextPreviewPortalCssVariables(this.dom, this.popover)
        this.popover.classList.add('context-preview-inline-popover-portaled')
        nextPortal.pane.appendChild(this.popover)
        this.syncPortalPosition()
        this.startPortalPositionSync()
    }
}

export function createContextPreviewPopover(
    options: CreateContextPreviewPopoverOptions,
): ContextPreviewPopoverInstance {
    return new ContextPreviewPopover(options)
}

export function createContextPreviewTile({
    node,
    getNode,
    environment,
    preferredPlacement = 'top',
    inlinePopover = false,
    triggerContent,
    titleOverride,
}: CreateContextPreviewTileOptions): ContextPreviewTileInstance {
    const resolveNode = (): CanvasNode => getNode?.() ?? node
    const renderState = (): ContextPreviewPopoverContent & {
        latestNode: CanvasNode
        text: string
    } => {
        const latestNode = resolveNode()
        const title = resolveContextPreviewTitle(latestNode, environment, titleOverride)
        const text = getContextPreviewText(latestNode, environment)
        const accessibleLabel = title || getContextPreviewTypeLabel(latestNode)
        return {
            accessibleLabel,
            content: renderContextPreviewPopoverContent(latestNode, title, text, accessibleLabel, environment),
            contentClassName: getContextPreviewPopoverClassName(latestNode, Boolean(title || text)),
            latestNode,
            text,
        }
    }
    const initialState = renderState()
    let previewPopover: ContextPreviewPopoverInstance
    const syncLatestContent = (): void => {
        previewPopover.updateContent(renderState())
    }
    previewPopover = createContextPreviewPopover({
        ...initialState,
        triggerContent: triggerContent
            ?? renderContextPreviewVisual(initialState.latestNode, initialState.accessibleLabel, initialState.text, environment, 'mini'),
        preferredPlacement,
        inlinePopover,
        inlineLabelTrigger: !inlinePopover && Boolean(triggerContent),
        beforeOpen: syncLatestContent,
    })
    return previewPopover
}
