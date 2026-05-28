import { brokenImageIcon } from '$src/svgIcons/index.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'
import { NodeSelection } from 'prosemirror-state'
import type { ImageBranchVlmResolution, VideoGenerationTrace } from '@lixpi/constants'

// Sibling of aiGeneratedImageNode.ts. The in-chat representation of a generated
// video. While VIDEO_PENDING is the active state, the node renders a placeholder
// (matching the canvas placeholder style — no DOM spinner per PR #202). On
// VIDEO_COMPLETE the node swaps to a poster + <video> element with controls;
// because the workspace canvas owns inline playback, this in-chat player is
// intentionally controls-based and small.

export const aiGeneratedVideoNodeType = 'aiGeneratedVideo'

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
    }) => void
    onVideoGeneratingToCanvas?: (data: {
        threadId: string
        aiProvider: string
    }) => void
    onVideoCompleteToCanvas?: (data: {
        threadId: string
        videoUrl: string
        fileId: string
        workspaceId: string
        posterUrl: string
        posterFileId: string
        durationSeconds: number
        aspectRatio: number
        hasAudio: boolean
        responseId: string
        revisedPrompt: string
        videoModel: string
        videoModelProvider: string
        responseMessageId: string
    }) => void
    onVideoErrorToCanvas?: (data: {
        threadId: string
        error: string
    }) => void
    // The structured VLM resolver is shared with images; video uses the same
    // resolution payload, so the resolved/error callbacks are reused from the
    // image callback surface rather than duplicated here.
    onVideoBranchResolvedToCanvas?: (data: {
        threadId: string
        resolution: ImageBranchVlmResolution
    }) => void
    onVideoGenerationTrace?: (data: {
        threadId: string
        videoGenerationTrace: VideoGenerationTrace
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
    const wrapper = html`
        <div className="ai-generated-video-wrapper">
            <div className="ai-generated-video-container">
                <div className="ai-generated-video-placeholder">
                    <span className="placeholder-text">Generating video…</span>
                </div>
                <video className="ai-generated-video-content" controls preload="metadata" playsinline crossorigin="anonymous"></video>
            </div>
        </div>
    `

    const container = wrapper.querySelector('.ai-generated-video-container') as HTMLElement
    const placeholderElement = wrapper.querySelector('.ai-generated-video-placeholder') as HTMLElement
    const placeholderText = wrapper.querySelector('.ai-generated-video-placeholder .placeholder-text') as HTMLElement
    const videoElement = wrapper.querySelector('.ai-generated-video-content') as HTMLVideoElement

    applyStyle(videoElement, { display: 'none' })

    const handleClick = (event: MouseEvent) => {
        // Don't intercept clicks on the video controls themselves
        if ((event.target as HTMLElement).tagName === 'VIDEO') return

        event.preventDefault()
        event.stopPropagation()

        const pos = getPos()
        if (pos === undefined) return

        const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
        view.dispatch(tr)
        view.focus()
    }

    wrapper.addEventListener('click', handleClick)

    const updateDisplay = async () => {
        const { videoUrl, posterUrl, isPending, errorMessage } = node.attrs

        if (errorMessage) {
            applyStyle(videoElement, { display: 'none' })
            placeholderElement.classList.remove('is-active')
            if (!container.querySelector('.video-error-placeholder')) {
                container.appendChild(html`
                    <div className="video-error-placeholder"><span innerHTML=${brokenImageIcon}></span><span>${errorMessage}</span></div>
                `)
            }
            return
        }

        if (isPending || !videoUrl) {
            applyStyle(videoElement, { display: 'none' })
            placeholderElement.classList.add('is-active')
            placeholderText.textContent = 'Generating video…'
            return
        }

        placeholderElement.classList.remove('is-active')
        applyStyle(videoElement, { display: 'block' })

        const resolvedVideoSrc = await buildAuthenticatedUrl(videoUrl)
        const resolvedPosterSrc = posterUrl ? await buildAuthenticatedUrl(posterUrl) : ''

        if (videoElement.src !== resolvedVideoSrc) {
            videoElement.src = resolvedVideoSrc
        }
        if (resolvedPosterSrc && videoElement.poster !== resolvedPosterSrc) {
            videoElement.poster = resolvedPosterSrc
        }
    }

    videoElement.onerror = () => {
        applyStyle(videoElement, { display: 'none' })
        if (!container.querySelector('.video-error-placeholder')) {
            container.appendChild(html`
                <div className="video-error-placeholder"><span innerHTML=${brokenImageIcon}></span><span>Video unavailable</span></div>
            `)
        }
    }

    updateDisplay().catch(() => {})

    return {
        dom: wrapper,
        update: (updatedNode: any) => {
            if (updatedNode.type.name !== aiGeneratedVideoNodeType) {
                return false
            }

            node = updatedNode
            updateDisplay().catch(() => {})
            return true
        },
        destroy: () => {
            wrapper.removeEventListener('click', handleClick)
            try {
                videoElement.pause()
                videoElement.removeAttribute('src')
                videoElement.load()
            } catch {
                // Pause/teardown is best-effort during ProseMirror destroy.
            }
        },
        stopEvent: (_event: Event) => {
            return false
        },
    }
}
