import type {
    Asset,
    CanvasNode,
    DocumentCanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'
import { createHelpTooltip, type HelpTooltipInstance } from '$src/components/helpTooltip/index.ts'
import { extractContentFromProseMirror } from '$src/utils/prosemirrorText.ts'
import { documentIcon, videoPlayGlyphIcon } from '$src/svgIcons/index.ts'
import { html } from '$src/utils/domTemplates.ts'
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
    // When true the hover card is kept as a DOM descendant of the tile (shown via a
    // CSS class on hover) instead of being portaled to document.body. This makes the
    // card live inside its surrounding context and scale with any CSS zoom transform
    // applied to an ancestor (e.g. the zoomable canvas AI chat thread projection).
    inlinePopover?: boolean
}

type ContextPreviewPopoverOrientation = 'landscape' | 'portrait'

const TRANSPARENT_PIXEL_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

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

function getContextChipLabel(node: CanvasNode): string {
    switch (node.type) {
        case 'document': return 'Document'
        case 'image':
        case 'video': return ''
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

// Inline variant: the hover card stays a DOM descendant of the tile so it inherits
// any ancestor CSS zoom transform and lives inside its context (used on the zoomable
// canvas). Shown by toggling `is-open` on hover/focus instead of body-portaling.
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

    const syncLatestContent = (): void => {
        const next = renderState()
        popover.className = getInlinePopoverClassName(next.latestNode, Boolean(next.title || next.text), dom.classList.contains('is-open'))
        popover.replaceChildren(renderContextPreviewPopoverContent(next.latestNode, next.title, next.text, next.accessibleLabel, environment))
        trigger.setAttribute('aria-label', next.accessibleLabel)
    }
    const open = (): void => {
        syncLatestContent()
        dom.classList.add('is-open')
        popover.classList.add('is-open')
    }
    const close = (): void => {
        dom.classList.remove('is-open')
        popover.classList.remove('is-open')
    }

    dom.addEventListener('pointerenter', open)
    dom.addEventListener('pointerleave', close)
    dom.addEventListener('focusin', open)
    dom.addEventListener('focusout', close)

    return {
        dom,
        destroy: () => {
            dom.removeEventListener('pointerenter', open)
            dom.removeEventListener('pointerleave', close)
            dom.removeEventListener('focusin', open)
            dom.removeEventListener('focusout', close)
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
