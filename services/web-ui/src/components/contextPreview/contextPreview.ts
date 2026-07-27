import type {
    Asset,
    CapabilityArtifactCanvasNode,
    CanvasNode,
    DocumentCanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'
import { createHelpTooltip, type HelpTooltipInstance } from '$src/components/helpTooltip/index.ts'
import { extractContentFromProseMirror } from '$src/utils/prosemirrorText.ts'
import { documentIcon, videoPlayGlyphIcon } from '$src/svgIcons/index.ts'
import { getCapabilityArtifactIcon } from '$src/installed-capabilities.ts'
import { applyStyle, html } from '$src/utils/domTemplates.ts'
import {
    buildAssetRenditionPath,
    resolveAuthenticatedMediaUrl,
    resolveMediaUrl,
} from '$src/utils/mediaUrls.ts'

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

export type CreateContextPreviewTileOptions = {
    node: CanvasNode
    getNode?: () => CanvasNode | undefined
    environment: ContextPreviewEnvironment
    preferredPlacement?: 'top' | 'bottom' | 'left' | 'right'
    triggerContent?: HTMLElement
    titleOverride?: string
    // When true, canvas hover cards are projected to the owning pane while open and
    // receive the viewport scale. Non-canvas cards stay inline. This preserves canvas
    // sizing without trapping the card inside clamped node text or node stacking.
    inlinePopover?: boolean
}

type ContextPreviewPopoverOrientation = 'landscape' | 'portrait'
type ContextPreviewPlacement = NonNullable<CreateContextPreviewTileOptions['preferredPlacement']>

type ContextPreviewCanvasPortal = {
    pane: HTMLElement
    scale: number
}

const TRANSPARENT_PIXEL_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const CONTEXT_PREVIEW_POPOVER_GAP = 10
const CONTEXT_PREVIEW_POPOVER_CLOSE_DELAY_MS = 80

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

// The compact trigger stays inline. On canvas surfaces its hover card moves to the
// pane-level overlay and receives the viewport scale, escaping node text clipping
// and sibling chrome stacking without changing its visual canvas size.
function createInlineContextPreviewTile({
    node,
    getNode,
    environment,
    preferredPlacement = 'top',
    triggerContent,
    titleOverride,
}: CreateContextPreviewTileOptions): ContextPreviewTileInstance {
    const resolveNode = (): CanvasNode => getNode?.() ?? node
    const renderState = () => {
        const latestNode = resolveNode()
        const title = resolveContextPreviewTitle(latestNode, environment, titleOverride)
        const text = getContextPreviewText(latestNode, environment)
        const accessibleLabel = title || getContextPreviewTypeLabel(latestNode)
        return { latestNode, title, text, accessibleLabel }
    }

    const { latestNode, title, text, accessibleLabel } = renderState()
    const getInlinePopoverClassName = (popoverNode: CanvasNode, hasPopoverMeta: boolean, isOpen: boolean): string => [
        getContextPreviewPopoverClassName(popoverNode, hasPopoverMeta),
        'context-preview-inline-popover',
        `context-preview-inline-popover-${preferredPlacement}`,
        isOpen ? 'is-open' : '',
    ].filter(Boolean).join(' ')
    const trigger = html`<div
        className="workspace-ai-chat-panel-context-preview-trigger context-preview-inline-trigger"
        tabindex="0"
        aria-label=${accessibleLabel}
    >${triggerContent ?? renderContextPreviewVisual(latestNode, accessibleLabel, text, environment, 'mini')}</div>` as HTMLElement
    const popover = html`<div className=${getInlinePopoverClassName(latestNode, Boolean(title || text), false)} role="tooltip">
        ${renderContextPreviewPopoverContent(latestNode, title, text, accessibleLabel, environment)}
    </div>` as HTMLElement
    const dom = html`<div className="workspace-ai-chat-panel-context-preview-main context-preview-inline">
        ${trigger}
        ${popover}
    </div>` as HTMLElement
    let portal: ContextPreviewCanvasPortal | null = null
    let portalPositionFrame: number | null = null
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    const syncLatestContent = (): void => {
        const next = renderState()
        const isPortaled = popover.classList.contains('context-preview-inline-popover-portaled')
        popover.className = getInlinePopoverClassName(next.latestNode, Boolean(next.title || next.text), dom.classList.contains('is-open'))
        popover.classList.toggle('context-preview-inline-popover-portaled', isPortaled)
        popover.replaceChildren(renderContextPreviewPopoverContent(next.latestNode, next.title, next.text, next.accessibleLabel, environment))
        trigger.setAttribute('aria-label', next.accessibleLabel)
    }
    const stopPortalPositionSync = (): void => {
        if (portalPositionFrame === null) return
        cancelAnimationFrame(portalPositionFrame)
        portalPositionFrame = null
    }
    const cancelScheduledClose = (): void => {
        if (closeTimer === null) return
        clearTimeout(closeTimer)
        closeTimer = null
    }
    const restorePopoverToTile = (): void => {
        stopPortalPositionSync()
        portal = null
        popover.classList.remove('context-preview-inline-popover-portaled')
        popover.removeAttribute('style')
        if (dom.isConnected) {
            dom.appendChild(popover)
            return
        }
        popover.remove()
    }
    const syncPortalPosition = (): void => {
        if (!portal || !dom.isConnected) return
        portal = getContextPreviewCanvasPortal(dom) ?? portal
        positionContextPreviewCanvasPopover(trigger, popover, portal, preferredPlacement)
    }
    const startPortalPositionSync = (): void => {
        stopPortalPositionSync()
        const update = (): void => {
            if (!dom.isConnected) {
                restorePopoverToTile()
                return
            }
            syncPortalPosition()
            portalPositionFrame = requestAnimationFrame(update)
        }
        portalPositionFrame = requestAnimationFrame(update)
    }
    const portalPopoverToCanvasPane = (): void => {
        const nextPortal = getContextPreviewCanvasPortal(dom)
        if (!nextPortal) return
        portal = nextPortal
        copyContextPreviewPortalCssVariables(dom, popover)
        popover.classList.add('context-preview-inline-popover-portaled')
        nextPortal.pane.appendChild(popover)
        syncPortalPosition()
        startPortalPositionSync()
    }
    const open = (): void => {
        cancelScheduledClose()
        syncLatestContent()
        dom.classList.add('is-open')
        popover.classList.add('is-open')
        portalPopoverToCanvasPane()
    }
    const close = (): void => {
        cancelScheduledClose()
        dom.classList.remove('is-open')
        popover.classList.remove('is-open')
        if (popover.parentElement !== dom) restorePopoverToTile()
    }
    const scheduleCloseUnlessMovingBetweenTileAndPopover = (event: PointerEvent | FocusEvent): void => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && (dom.contains(nextTarget) || popover.contains(nextTarget))) return
        cancelScheduledClose()
        closeTimer = setTimeout(close, CONTEXT_PREVIEW_POPOVER_CLOSE_DELAY_MS)
    }

    dom.addEventListener('pointerenter', open)
    dom.addEventListener('pointerleave', scheduleCloseUnlessMovingBetweenTileAndPopover)
    dom.addEventListener('focusin', open)
    dom.addEventListener('focusout', scheduleCloseUnlessMovingBetweenTileAndPopover)
    popover.addEventListener('pointerenter', cancelScheduledClose)
    popover.addEventListener('focusin', cancelScheduledClose)
    popover.addEventListener('pointerleave', scheduleCloseUnlessMovingBetweenTileAndPopover)
    popover.addEventListener('focusout', scheduleCloseUnlessMovingBetweenTileAndPopover)

    return {
        dom,
        destroy: () => {
            cancelScheduledClose()
            stopPortalPositionSync()
            dom.removeEventListener('pointerenter', open)
            dom.removeEventListener('pointerleave', scheduleCloseUnlessMovingBetweenTileAndPopover)
            dom.removeEventListener('focusin', open)
            dom.removeEventListener('focusout', scheduleCloseUnlessMovingBetweenTileAndPopover)
            popover.removeEventListener('pointerenter', cancelScheduledClose)
            popover.removeEventListener('focusin', cancelScheduledClose)
            popover.removeEventListener('pointerleave', scheduleCloseUnlessMovingBetweenTileAndPopover)
            popover.removeEventListener('focusout', scheduleCloseUnlessMovingBetweenTileAndPopover)
            popover.remove()
            dom.remove()
        },
    }
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
    if (inlinePopover) {
        return createInlineContextPreviewTile({
            node,
            getNode,
            environment,
            preferredPlacement,
            triggerContent,
            titleOverride,
        })
    }

    const resolveNode = (): CanvasNode => getNode?.() ?? node
    const currentNode = resolveNode()
    const title = resolveContextPreviewTitle(currentNode, environment, titleOverride)
    const text = getContextPreviewText(currentNode, environment)
    const accessibleLabel = title || getContextPreviewTypeLabel(currentNode)
    const popoverContent = renderContextPreviewPopoverContent(currentNode, title, text, accessibleLabel, environment)
    const usesInlineLabelTrigger = Boolean(triggerContent)
    const previewTooltip: HelpTooltipInstance = createHelpTooltip({
        label: accessibleLabel,
        triggerContent: triggerContent ?? renderContextPreviewVisual(currentNode, accessibleLabel, text, environment, 'mini'),
        content: popoverContent,
        preferredPlacement,
        className: [
            'workspace-ai-chat-panel-context-preview-tooltip',
            usesInlineLabelTrigger ? 'workspace-ai-chat-panel-context-preview-tooltip-inline-label' : '',
        ].filter(Boolean).join(' '),
        triggerClassName: [
            'workspace-ai-chat-panel-context-preview-trigger',
            usesInlineLabelTrigger ? 'workspace-ai-chat-panel-context-preview-trigger-inline-label' : '',
        ].filter(Boolean).join(' '),
        contentClassName: getContextPreviewPopoverClassName(currentNode, Boolean(title || text)),
        contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
        interactive: true,
    })
    const tooltipContent = previewTooltip.dom.querySelector<HTMLElement>('.help-tooltip-content')
    const trigger = previewTooltip.dom.querySelector<HTMLElement>('.help-tooltip-trigger')
    const syncLatestContent = (): void => {
        const latestNode = resolveNode()
        const latestTitle = resolveContextPreviewTitle(latestNode, environment, titleOverride)
        const latestText = getContextPreviewText(latestNode, environment)
        const latestAccessibleLabel = latestTitle || getContextPreviewTypeLabel(latestNode)
        const latestContent = renderContextPreviewPopoverContent(latestNode, latestTitle, latestText, latestAccessibleLabel, environment)
        tooltipContent?.replaceChildren(latestContent)
        if (tooltipContent) {
            const isVisible = tooltipContent.classList.contains('is-visible')
            tooltipContent.className = [
                'help-tooltip-content',
                getContextPreviewPopoverClassName(latestNode, Boolean(latestTitle || latestText)),
                'help-tooltip-content-interactive',
                isVisible ? 'is-visible' : '',
            ].filter(Boolean).join(' ')
        }
        trigger?.setAttribute('aria-label', latestAccessibleLabel)
    }
    trigger?.addEventListener('pointerenter', syncLatestContent, true)
    trigger?.addEventListener('focusin', syncLatestContent, true)
    const dom = usesInlineLabelTrigger
        ? previewTooltip.dom
        : html`<div className="workspace-ai-chat-panel-context-preview-main">${previewTooltip.dom}</div>` as HTMLElement
    return {
        dom,
        destroy: () => {
            trigger?.removeEventListener('pointerenter', syncLatestContent, true)
            trigger?.removeEventListener('focusin', syncLatestContent, true)
            previewTooltip.destroy()
        },
    }
}
