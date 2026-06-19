import type {
    AiChatThreadCanvasNode,
    CanvasNode,
    DocumentCanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'
import { createHelpTooltip, type HelpTooltipInstance } from '$src/components/helpTooltip/index.ts'
import { extractContentFromProseMirror } from '$src/services/ai-chat-thread-service.ts'
import { documentIcon, videoPlayGlyphIcon } from '$src/svgIcons/index.ts'
import { html } from '$src/utils/domTemplates.ts'

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
    const descriptor = 'descriptor' in node ? node.descriptor : undefined
    const summary = descriptor && descriptor.status === 'ready' ? descriptor.summary : ''
    const trimmed = summary.trim()
    if (trimmed) return trimmed
    switch (node.type) {
        case 'document': return 'Document'
        case 'aiChatThread': return 'Chat'
        case 'image':
        case 'video': return ''
        default: return node.type
    }
}

function getContextPreviewTitle(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    if (node.type === 'document') {
        const document = environment.getDocuments().find((item) => item.documentId === node.referenceId)
        const title = document?.title?.trim()
        if (title) return title
    }
    if (node.type === 'aiChatThread') {
        const thread = environment.getThreads().find((item) => item.threadId === node.referenceId)
        const title = thread?.title?.trim()
        if (title) return title
    }
    if (node.type === 'image' || node.type === 'video') return ''
    return getContextChipLabel(node)
}

function getContextPreviewText(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    const descriptor = 'descriptor' in node && node.descriptor?.status === 'ready'
        ? node.descriptor.summary.trim()
        : ''
    if (descriptor) return descriptor

    if (node.type === 'document') {
        const document = environment.getDocuments().find((item) => item.documentId === node.referenceId)
        const { text } = extractContentFromProseMirror((document?.content ?? '') as string | object)
        return text.trim()
    }

    if (node.type === 'aiChatThread') {
        const thread = environment.getThreads().find((item) => item.threadId === node.referenceId)
        const { text } = extractContentFromProseMirror((thread?.content ?? '') as string | object)
        return text.trim()
    }

    return ''
}

function getContextPreviewTypeLabel(node: CanvasNode): string {
    switch (node.type) {
        case 'document': return 'Document'
        case 'image': return 'Image'
        case 'video': return 'Video'
        case 'aiChatThread': return 'Chat'
        default: return node.type
    }
}

export function getContextPreviewAccessibleLabel(node: CanvasNode, environment: ContextPreviewEnvironment): string {
    return getContextPreviewTitle(node, environment) || getContextPreviewTypeLabel(node)
}

function buildContextPreviewInitialMediaSrc(mediaUrl: string): string {
    if (!mediaUrl) return TRANSPARENT_PIXEL_SRC
    if (mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:')) return mediaUrl
    if (mediaUrl.startsWith('/api/') || mediaUrl.startsWith('http')) return mediaUrl
    return `data:image/png;base64,${mediaUrl}`
}

function setContextPreviewMediaTokenParam(mediaUrl: string, token: string): string {
    if (!token) return mediaUrl
    const isAbsoluteUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(mediaUrl)
    try {
        const url = isAbsoluteUrl ? new URL(mediaUrl) : new URL(mediaUrl, window.location.origin)
        url.searchParams.set('token', token)
        if (isAbsoluteUrl) return url.toString()
        return `${url.pathname}${url.search}${url.hash}`
    } catch {
        const separator = mediaUrl.includes('?') ? '&' : '?'
        return `${mediaUrl}${separator}token=${encodeURIComponent(token)}`
    }
}

async function buildContextPreviewAuthenticatedMediaSrc(mediaUrl: string, environment: ContextPreviewEnvironment): Promise<string> {
    if (!mediaUrl) return TRANSPARENT_PIXEL_SRC
    if (mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:')) return mediaUrl
    if (mediaUrl.startsWith('/api/')) {
        const token = await environment.getAuthToken()
        const apiBaseUrl = environment.getApiBaseUrl().replace(/\/$/, '')
        const sourceUrl = apiBaseUrl ? `${apiBaseUrl}${mediaUrl}` : mediaUrl
        return setContextPreviewMediaTokenParam(sourceUrl, token)
    }
    if (mediaUrl.startsWith('http')) {
        if (mediaUrl.includes('/api/videos/') || mediaUrl.includes('/api/images/')) {
            const token = await environment.getAuthToken()
            return setContextPreviewMediaTokenParam(mediaUrl, token)
        }
        return mediaUrl
    }
    return `data:image/png;base64,${mediaUrl}`
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
    const initialSrc = buildContextPreviewInitialMediaSrc(node.src)
    const initialPoster = buildContextPreviewInitialMediaSrc(node.posterSrc)
    if (initialSrc) videoEl.src = initialSrc
    if (initialPoster) videoEl.poster = initialPoster
    hydrateContextPreviewMedia(videoEl, node.src, environment)
    hydrateContextPreviewMedia(videoEl, node.posterSrc, environment, 'poster')
}

function renderContextImagePreview(node: ImageCanvasNode, label: string, environment: ContextPreviewEnvironment, size: 'mini' | 'large'): HTMLElement {
    const imageEl = html`<img
        className=${`workspace-ai-chat-panel-context-preview-image workspace-ai-chat-panel-context-preview-image-${size}`}
        src=${buildContextPreviewInitialMediaSrc(node.src)}
        alt=""
        loading="lazy"
    />` as HTMLImageElement
    imageEl.setAttribute('aria-label', label)
    hydrateContextPreviewMedia(imageEl, node.src, environment)
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
    node: DocumentCanvasNode | AiChatThreadCanvasNode,
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
    if (node.type === 'document' || node.type === 'aiChatThread') return renderContextDocumentPreview(node, title, text, size)
    return html`<div className="workspace-ai-chat-panel-context-preview-document">${title}</div>` as HTMLElement
}

function getContextPreviewPopoverOrientation(node: ImageCanvasNode | VideoCanvasNode): ContextPreviewPopoverOrientation {
    if (Number.isFinite(node.aspectRatio) && node.aspectRatio > 0) {
        return node.aspectRatio < 1 ? 'portrait' : 'landscape'
    }
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

export function createContextPreviewTile({
    node,
    getNode,
    environment,
    preferredPlacement = 'top',
}: CreateContextPreviewTileOptions): ContextPreviewTileInstance {
    const resolveNode = (): CanvasNode => getNode?.() ?? node
    const currentNode = resolveNode()
    const title = getContextPreviewTitle(currentNode, environment)
    const text = getContextPreviewText(currentNode, environment)
    const accessibleLabel = getContextPreviewAccessibleLabel(currentNode, environment)
    const popoverContent = renderContextPreviewPopoverContent(currentNode, title, text, accessibleLabel, environment)
    const previewTooltip: HelpTooltipInstance = createHelpTooltip({
        label: accessibleLabel,
        triggerContent: renderContextPreviewVisual(currentNode, accessibleLabel, text, environment, 'mini'),
        content: popoverContent,
        preferredPlacement,
        className: 'workspace-ai-chat-panel-context-preview-tooltip',
        triggerClassName: 'workspace-ai-chat-panel-context-preview-trigger',
        contentClassName: getContextPreviewPopoverClassName(currentNode, Boolean(title || text)),
        contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
        interactive: true,
    })
    const tooltipContent = previewTooltip.dom.querySelector<HTMLElement>('.help-tooltip-content')
    const trigger = previewTooltip.dom.querySelector<HTMLElement>('.help-tooltip-trigger')
    const syncLatestContent = (): void => {
        const latestNode = resolveNode()
        const latestTitle = getContextPreviewTitle(latestNode, environment)
        const latestText = getContextPreviewText(latestNode, environment)
        const latestAccessibleLabel = getContextPreviewAccessibleLabel(latestNode, environment)
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
    const dom = html`<div className="workspace-ai-chat-panel-context-preview-main">${previewTooltip.dom}</div>` as HTMLElement
    return {
        dom,
        destroy: () => {
            trigger?.removeEventListener('pointerenter', syncLatestContent, true)
            trigger?.removeEventListener('focusin', syncLatestContent, true)
            previewTooltip.destroy()
        },
    }
}
