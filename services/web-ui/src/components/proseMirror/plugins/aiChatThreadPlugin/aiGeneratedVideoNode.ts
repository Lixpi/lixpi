import { brokenImageIcon } from '$src/svgIcons/index.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { NodeSelection } from 'prosemirror-state'
import type { ImageBranchVlmResolution, MediaGenerationRunMeta } from '@lixpi/constants'
// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { applyVideoControlsHostStyleProperties, createVideoControls, type VideoControlsInstance } from '$src/components/videoControls/index.ts'
import { applyMediaModelBadgeStyleProperties, createMediaModelBadge } from '$src/components/mediaModelBadge.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'

// Sibling of aiGeneratedImageNode.ts. The in-chat representation of a generated
// video. While VIDEO_PENDING is the active state, the node renders a placeholder
// (matching the canvas placeholder style — no DOM spinner per PR #202). On
// VIDEO_COMPLETE the node swaps to a poster + controls-less <video> element,
// then mounts the shared SVG videoControls bar as an external row below it.

export const aiGeneratedVideoNodeType = 'aiGeneratedVideo'

function parseVariantIndex(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

export const aiGeneratedVideoNodeSpec = {
    attrs: {
        videoUrl: { default: '' },
        fileId: { default: '' },
        workspaceId: { default: '' },
        posterUrl: { default: '' },
        posterFileId: { default: '' },
        durationSeconds: { default: 0 },
        aspectRatio: { default: 1.777 },
        hasAudio: { default: true },
        revisedPrompt: { default: '' },
        responseId: { default: '' },
        videoModel: { default: '' },
        isPending: { default: true },
        errorMessage: { default: '' },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        variantIndex: { default: null },
        // Display attributes (mirror the image node)
        width: { default: null },
        alignment: { default: 'left' },
        textWrap: { default: 'none' },
    },
    group: 'block',
    draggable: false,
    atom: true,
    parseDOM: [
        {
            tag: 'div.ai-generated-video',
            getAttrs(dom: HTMLElement) {
                return {
                    videoUrl: dom.getAttribute('data-video-url') || '',
                    fileId: dom.getAttribute('data-file-id') || '',
                    workspaceId: dom.getAttribute('data-workspace-id') || '',
                    posterUrl: dom.getAttribute('data-poster-url') || '',
                    posterFileId: dom.getAttribute('data-poster-file-id') || '',
                    durationSeconds: Number(dom.getAttribute('data-duration-seconds') || 0),
                    aspectRatio: Number(dom.getAttribute('data-aspect-ratio') || 1.777),
                    hasAudio: dom.getAttribute('data-has-audio') === 'true',
                    revisedPrompt: dom.getAttribute('data-revised-prompt') || '',
                    responseId: dom.getAttribute('data-response-id') || '',
                    videoModel: dom.getAttribute('data-video-model') || '',
                    isPending: dom.getAttribute('data-is-pending') === 'true',
                    errorMessage: dom.getAttribute('data-error-message') || '',
                    generationRequestId: dom.getAttribute('data-generation-request-id') || '',
                    reasoningRunId: dom.getAttribute('data-reasoning-run-id') || '',
                    mediaRunId: dom.getAttribute('data-media-run-id') || '',
                    reasoningModelId: dom.getAttribute('data-reasoning-model-id') || '',
                    mediaModelId: dom.getAttribute('data-media-model-id') || '',
                    mediaType: dom.getAttribute('data-media-type') || '',
                    variantIndex: parseVariantIndex(dom.getAttribute('data-variant-index')),
                    width: dom.getAttribute('data-width') || null,
                    alignment: dom.getAttribute('data-alignment') || 'left',
                    textWrap: dom.getAttribute('data-text-wrap') || 'none',
                }
            },
        },
    ],
    toDOM(node: any) {
        return ['div', {
            class: 'ai-generated-video',
            'data-video-url': node.attrs.videoUrl,
            'data-file-id': node.attrs.fileId,
            'data-workspace-id': node.attrs.workspaceId,
            'data-poster-url': node.attrs.posterUrl,
            'data-poster-file-id': node.attrs.posterFileId,
            'data-duration-seconds': String(node.attrs.durationSeconds),
            'data-aspect-ratio': String(node.attrs.aspectRatio),
            'data-has-audio': String(node.attrs.hasAudio),
            'data-revised-prompt': node.attrs.revisedPrompt,
            'data-response-id': node.attrs.responseId,
            'data-video-model': node.attrs.videoModel,
            'data-is-pending': String(node.attrs.isPending),
            'data-error-message': node.attrs.errorMessage,
            'data-generation-request-id': node.attrs.generationRequestId,
            'data-reasoning-run-id': node.attrs.reasoningRunId,
            'data-media-run-id': node.attrs.mediaRunId,
            'data-reasoning-model-id': node.attrs.reasoningModelId,
            'data-media-model-id': node.attrs.mediaModelId,
            'data-media-type': node.attrs.mediaType,
            'data-variant-index': node.attrs.variantIndex == null ? '' : String(node.attrs.variantIndex),
            'data-width': node.attrs.width || '',
            'data-alignment': node.attrs.alignment || 'left',
            'data-text-wrap': node.attrs.textWrap || 'none',
        }]
    },
}

export type AiGeneratedVideoCallbacks = {
    onAddToCanvas?: (data: {
        videoUrl: string
        fileId: string
        posterUrl: string
        posterFileId: string
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModel: string
    }) => void
    onEditInNewThread?: (responseId: string) => void
    onVideoPendingToCanvas?: (data: {
        threadId: string
        aiProvider: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onVideoGeneratingToCanvas?: (data: {
        threadId: string
        aiProvider: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onVideoCompleteToCanvas?: (data: {
        threadId: string
        videoUrl: string
        fileId: string
        workspaceId: string
        posterUrl: string
        posterFileId: string
        frameUrl: string
        frameFileId: string
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModel: string
        videoModelProvider: string
        responseMessageId: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onVideoGenerationTraceToCanvas?: (data: {
        threadId: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onVideoErrorToCanvas?: (data: {
        threadId: string
        error: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    // The structured VLM resolver is shared with images; video uses the same
    // resolution payload, so the resolved/error callbacks are reused from the
    // image callback surface rather than duplicated here.
    onVideoBranchResolvedToCanvas?: (data: {
        threadId: string
        resolution: ImageBranchVlmResolution
        generationRun?: MediaGenerationRunMeta
    }) => void
}

let globalCallbacks: AiGeneratedVideoCallbacks = {}

export function setAiGeneratedVideoCallbacks(callbacks: AiGeneratedVideoCallbacks) {
    globalCallbacks = callbacks
}

export function getAiGeneratedVideoCallbacks(): AiGeneratedVideoCallbacks {
    return globalCallbacks
}

// Resolves a path like /api/videos/{ws}/{fileId} or /api/images/... to a full
// authenticated URL. Mirrors the helper inlined in aiGeneratedImageNode.ts so
// the same auth-token attachment logic applies to both video and poster URLs.
const buildAuthenticatedUrl = async (url: string): Promise<string> => {
    if (!url) return ''
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    if (url.startsWith('/api/')) {
        const token = await AuthService.getTokenSilently()
        const API_BASE_URL = import.meta.env.VITE_API_URL || ''
        return `${API_BASE_URL}${url}${token ? `?token=${token}` : ''}`
    }
    if (url.startsWith('http')) {
        const stripped = url.replace(/[?&]token=[^&]+/, '')
        if (stripped.includes('/api/videos/') || stripped.includes('/api/images/')) {
            const token = await AuthService.getTokenSilently()
            return `${stripped}${token ? `?token=${token}` : ''}`
        }
        return url
    }
    return url
}

export const aiGeneratedVideoNodeView = (node: any, view: any, getPos: () => number | undefined) => {
    const normalizeScale = (value: number): number => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1
    const controlsScale = normalizeScale(settings.videoControls.chat.controlsScale)
    const controlsSvgHeight = settings.videoControls.height
    const controlsHeight = controlsSvgHeight * controlsScale
    const controlsStyles = settings.videoControls.styles
    const containerStyle = {
        position: 'relative' as const,
        overflow: 'hidden' as const,
        aspectRatio: String(Number(node.attrs.aspectRatio) || 1.777),
    }
    const controlsHostStyle = {
        height: `${controlsHeight}px`,
        margin: `${settings.videoControls.chat.bottomInset}px ${settings.videoControls.chat.horizontalInset}px 0`,
        pointerEvents: 'auto' as const,
        borderRadius: controlsStyles.hostBorderRadius,
        filter: controlsStyles.hostDropShadow,
        backdropFilter: controlsStyles.hostBackdropFilter,
        webkitBackdropFilter: controlsStyles.hostBackdropFilter,
        overflow: 'hidden' as const,
        display: 'none',
    }
    const wrapper = html`
        <div className="ai-generated-video-wrapper">
            <div className="ai-generated-video-container" style=${containerStyle}>
                <div className="ai-generated-video-placeholder">
                    <span className="placeholder-text">Generating video…</span>
                </div>
                <video className="ai-generated-video-content" preload="metadata" playsinline crossorigin="anonymous"></video>
            </div>
            <div className="ai-generated-video-controls-host nopan" style=${controlsHostStyle}></div>
            <div className="ai-generated-video-model-chrome ai-generated-media-run-meta"></div>
        </div>
    `

    const container = wrapper.querySelector('.ai-generated-video-container') as HTMLElement
    const placeholderElement = wrapper.querySelector('.ai-generated-video-placeholder') as HTMLElement
    const placeholderText = wrapper.querySelector('.ai-generated-video-placeholder .placeholder-text') as HTMLElement
    const videoElement = wrapper.querySelector('.ai-generated-video-content') as HTMLVideoElement
    const controlsHost = wrapper.querySelector('.ai-generated-video-controls-host') as HTMLDivElement
    const modelChromeElement = wrapper.querySelector('.ai-generated-video-model-chrome') as HTMLElement
    applyVideoControlsHostStyleProperties(controlsHost)
    applyMediaModelBadgeStyleProperties(wrapper, { scale: settings.videoControls.chat.modelBadgeScale })
    let videoControls: VideoControlsInstance | null = null
    let controlsSvg: any = null
    let resizeObserver: ResizeObserver | null = null
    let unsubscribeAiModelsStore: (() => void) | null = null

    applyStyle(videoElement, { display: 'none' })

    const syncContainerGeometry = (): void => {
        applyStyle(container, {
            aspectRatio: String(Number(node.attrs.aspectRatio) || 1.777),
        })
    }

    const handleClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement
        if (target.closest('.ai-generated-video-controls-host') || target.tagName === 'VIDEO') return

        event.preventDefault()
        event.stopPropagation()
        if (!view.editable) return

        const pos = getPos()
        if (pos === undefined) return

        const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
        view.dispatch(tr)
        view.focus()
    }

    wrapper.addEventListener('click', handleClick)

    const updateModelChrome = (): void => {
        const modelBadge = createMediaModelBadge({
            modelId: node.attrs.mediaModelId || node.attrs.videoModel,
        })

        modelChromeElement.replaceChildren()
        if (modelBadge) {
            modelChromeElement.appendChild(modelBadge)
        }
        modelChromeElement.hidden = !modelBadge
    }

    const clearErrorPlaceholder = (): void => {
        container.querySelector('.video-error-placeholder')?.remove()
    }

    const getControlsWidth = (): number => {
        return Math.max(settings.videoControls.chat.minWidth / controlsScale, getControlsVisualWidth() / controlsScale)
    }

    const getControlsVisualWidth = (): number => {
        const measuredWidth = controlsHost.getBoundingClientRect().width || controlsHost.clientWidth
        return Math.max(settings.videoControls.chat.minWidth, measuredWidth || settings.videoControls.chat.fallbackWidth)
    }

    const syncControlsGeometry = (): void => {
        if (!videoControls || !controlsSvg) return
        const width = getControlsWidth()
        controlsSvg
            .attr('viewBox', `0 0 ${width} ${controlsSvgHeight}`)
            .attr('width', `${100 / controlsScale}%`)
            .attr('height', String(controlsSvgHeight))
        videoControls.resize(0, 0, width, getControlsVisualWidth())
    }

    const destroyVideoControls = (): void => {
        videoControls?.destroy()
        videoControls = null
        controlsSvg = null
        controlsHost.replaceChildren()
    }

    const ensureVideoControls = (): void => {
        if (videoControls) {
            syncControlsGeometry()
            return
        }

        const width = getControlsWidth()
        controlsSvg = select(controlsHost)
            .append('svg')
            .attr('class', 'ai-generated-video-controls-svg')
            .attr('width', `${100 / controlsScale}%`)
            .attr('height', String(controlsSvgHeight))
            .attr('viewBox', `0 0 ${width} ${controlsSvgHeight}`)
            .style('display', 'block')
            .style('overflow', 'visible')
            .style('pointer-events', 'none')
            .style('transform-origin', '0 0')
            .style('transform', `scale(${controlsScale})`)

        videoControls = createVideoControls(controlsSvg, {
            id: String(node.attrs.responseId || node.attrs.fileId || 'chat-video'),
            x: 0,
            y: 0,
            width,
            height: controlsSvgHeight,
            responsiveWidth: getControlsVisualWidth(),
            videoEl: videoElement,
            className: 'ai-generated-video-controls',
        })

        if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(syncControlsGeometry)
            resizeObserver.observe(controlsHost)
        }
    }

    const updateDisplay = async () => {
        const { videoUrl, posterUrl, isPending, errorMessage } = node.attrs

        if (errorMessage) {
            clearErrorPlaceholder()
            applyStyle(videoElement, { display: 'none' })
            applyStyle(controlsHost, { display: 'none' })
            destroyVideoControls()
            placeholderElement.classList.remove('is-active')
            container.appendChild(html`
                <div className="video-error-placeholder"><span innerHTML=${brokenImageIcon}></span><span>${errorMessage}</span></div>
            `)
            return
        }

        if (isPending || !videoUrl) {
            clearErrorPlaceholder()
            applyStyle(videoElement, { display: 'none' })
            applyStyle(controlsHost, { display: 'none' })
            destroyVideoControls()
            placeholderElement.classList.add('is-active')
            placeholderText.textContent = 'Generating video…'
            return
        }

        clearErrorPlaceholder()
        placeholderElement.classList.remove('is-active')
        applyStyle(videoElement, { display: 'block' })
        applyStyle(controlsHost, { display: 'block' })

        const resolvedVideoSrc = await buildAuthenticatedUrl(videoUrl)
        const resolvedPosterSrc = posterUrl ? await buildAuthenticatedUrl(posterUrl) : ''

        if (videoElement.src !== resolvedVideoSrc) {
            videoElement.src = resolvedVideoSrc
        }
        if (resolvedPosterSrc && videoElement.poster !== resolvedPosterSrc) {
            videoElement.poster = resolvedPosterSrc
        }
        ensureVideoControls()
    }

    videoElement.onerror = () => {
        clearErrorPlaceholder()
        applyStyle(videoElement, { display: 'none' })
        applyStyle(controlsHost, { display: 'none' })
        destroyVideoControls()
        container.appendChild(html`
            <div className="video-error-placeholder"><span innerHTML=${brokenImageIcon}></span><span>Video unavailable</span></div>
        `)
    }

    updateDisplay().catch(() => {})
    unsubscribeAiModelsStore = aiModelsStore.subscribe(() => updateModelChrome())
    syncContainerGeometry()

    return {
        dom: wrapper,
        update: (updatedNode: any) => {
            if (updatedNode.type.name !== aiGeneratedVideoNodeType) {
                return false
            }

            node = updatedNode
            syncContainerGeometry()
            updateDisplay().catch(() => {})
            updateModelChrome()
            return true
        },
        destroy: () => {
            wrapper.removeEventListener('click', handleClick)
            unsubscribeAiModelsStore?.()
            unsubscribeAiModelsStore = null
            resizeObserver?.disconnect()
            resizeObserver = null
            destroyVideoControls()
            try {
                videoElement.pause()
                videoElement.removeAttribute('src')
                videoElement.load()
            } catch {
                // Pause/teardown is best-effort during ProseMirror destroy.
            }
        },
        stopEvent: (event: Event) => {
            const target = event.target as HTMLElement | null
            return Boolean(target?.closest('.ai-generated-video-controls-host') || target === videoElement)
        },
    }
}
