import { brokenImageIcon } from '$src/svgIcons/index.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'
import { NodeSelection } from 'prosemirror-state'
import type { ImageBranchVlmResolution, MediaBranchLineagePlan, MediaGenerationRunMeta, WorkspaceContextResolution } from '@lixpi/constants'

export const aiGeneratedImageNodeType = 'aiGeneratedImage'

function parseVariantIndex(value: string | null): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function formatModelLabel(modelId: string): string {
    if (!modelId) return ''
    const parts = String(modelId).split(':')
    return parts[1] || parts[0] || ''
}

function formatVariantLabel(variantIndex: number | null): string {
    if (variantIndex == null || !Number.isFinite(Number(variantIndex))) return ''
    return `Variant ${Number(variantIndex) + 1}`
}

export const aiGeneratedImageNodeSpec = {
    attrs: {
        imageData: { default: '' },
        fileId: { default: '' },
        workspaceId: { default: '' },
        revisedPrompt: { default: '' },
        responseId: { default: '' },
        aiModel: { default: '' },
        isPartial: { default: true },
        partialIndex: { default: 0 },
        generationRequestId: { default: '' },
        reasoningRunId: { default: '' },
        mediaRunId: { default: '' },
        reasoningModelId: { default: '' },
        mediaModelId: { default: '' },
        mediaType: { default: '' },
        variantIndex: { default: null },
        // Image display attributes (same as regular image node)
        width: { default: null },
        alignment: { default: 'left' },
        textWrap: { default: 'none' },
    },
    group: 'block',
    draggable: false,
    atom: true,
    parseDOM: [
        {
            tag: 'div.ai-generated-image',
            getAttrs(dom: HTMLElement) {
                return {
                    imageData: dom.getAttribute('data-image-data') || '',
                    fileId: dom.getAttribute('data-file-id') || '',
                    workspaceId: dom.getAttribute('data-workspace-id') || '',
                    revisedPrompt: dom.getAttribute('data-revised-prompt') || '',
                    responseId: dom.getAttribute('data-response-id') || '',
                    aiModel: dom.getAttribute('data-ai-model') || '',
                    isPartial: dom.getAttribute('data-is-partial') === 'true',
                    partialIndex: parseInt(dom.getAttribute('data-partial-index') || '0', 10),
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
            class: 'ai-generated-image',
            'data-image-data': node.attrs.imageData,
            'data-file-id': node.attrs.fileId,
            'data-workspace-id': node.attrs.workspaceId,
            'data-revised-prompt': node.attrs.revisedPrompt,
            'data-response-id': node.attrs.responseId,
            'data-ai-model': node.attrs.aiModel,
            'data-is-partial': String(node.attrs.isPartial),
            'data-partial-index': String(node.attrs.partialIndex),
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

export type AiGeneratedImageCallbacks = {
    onAddToCanvas?: (data: {
        imageUrl: string
        fileId: string
        responseId: string
        revisedPrompt: string
        aiModel: string
    }) => void
    onEditInNewThread?: (responseId: string) => void
    onImagePartialToCanvas?: (data: {
        threadId: string
        imageUrl: string
        fileId: string
        workspaceId: string
        partialIndex: number
        aiProvider: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onImageCompleteToCanvas?: (data: {
        threadId: string
        imageUrl: string
        fileId: string
        workspaceId: string
        responseId: string
        revisedPrompt: string
        aiModel: string
        imageModelProvider: string
        responseMessageId: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onImageGenerationTraceToCanvas?: (data: {
        threadId: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onImageBranchResolvedToCanvas?: (data: {
        threadId: string
        resolution: ImageBranchVlmResolution
        generationRun?: MediaGenerationRunMeta
    }) => void
    onMediaLineagePlannedToCanvas?: (data: {
        threadId: string
        lineagePlan: MediaBranchLineagePlan
        generationRun?: MediaGenerationRunMeta
    }) => void
    onWorkspaceContextResolvedToCanvas?: (data: {
        threadId: string
        resolution: WorkspaceContextResolution
        generationRun?: MediaGenerationRunMeta
    }) => void
    onImageBranchResolutionErrorToCanvas?: (data: {
        threadId: string
        error: string
        generationRun?: MediaGenerationRunMeta
    }) => void
    onImageErrorToCanvas?: (data: {
        threadId: string
        error: string
        generationRun?: MediaGenerationRunMeta
    }) => void
}

let globalCallbacks: AiGeneratedImageCallbacks = {}

export function setAiGeneratedImageCallbacks(callbacks: AiGeneratedImageCallbacks) {
    globalCallbacks = callbacks
}

export function getAiGeneratedImageCallbacks(): AiGeneratedImageCallbacks {
    return globalCallbacks
}

export const aiGeneratedImageNodeView = (node: any, view: any, getPos: () => number | undefined) => {
    const wrapper = html`
        <div className="ai-generated-image-wrapper">
            <div className="ai-generated-image-container">
                <div className="ai-generated-image-spinner">
                    <div className="spinner-ring"></div>
                    <span className="spinner-text">Generating image...</span>
                </div>
                <img className="ai-generated-image-content" alt="" />
            </div>
            <div className="ai-generated-media-run-meta"></div>
        </div>
    `

    const container = wrapper.querySelector('.ai-generated-image-container') as HTMLElement
    const spinnerElement = wrapper.querySelector('.ai-generated-image-spinner') as HTMLElement
    const imageElement = wrapper.querySelector('.ai-generated-image-content') as HTMLImageElement
    const runMetaElement = wrapper.querySelector('.ai-generated-media-run-meta') as HTMLElement

    // Click handler to select the node (needed for bubble menu)
    const handleClick = (event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()

        const pos = getPos()
        if (pos === undefined) return

        const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
        view.dispatch(tr)
        view.focus()
    }

    wrapper.addEventListener('click', handleClick)

    const updateRunMeta = () => {
        const mediaLabel = formatModelLabel(node.attrs.mediaModelId)
        const variantLabel = formatVariantLabel(node.attrs.variantIndex)
        runMetaElement.replaceChildren()

        if (mediaLabel) {
            const modelPill = html`<span className="ai-generated-media-run-pill" title=${node.attrs.mediaModelId}>${mediaLabel}</span>` as HTMLElement
            runMetaElement.appendChild(modelPill)
        }

        if (variantLabel) {
            const variantPill = html`<span className="ai-generated-media-run-pill is-variant">${variantLabel}</span>` as HTMLElement
            runMetaElement.appendChild(variantPill)
        }

        runMetaElement.hidden = runMetaElement.childElementCount === 0
    }

    const updateDisplay = async () => {
        const { imageData, revisedPrompt, responseId, aiModel, isPartial } = node.attrs

        if (!imageData) {
            spinnerElement.classList.add('is-active')
            imageElement.classList.remove('is-visible')
            return
        }

        spinnerElement.classList.remove('is-active')
        imageElement.classList.add('is-visible')

        // imageData is now a URL path like /api/images/workspaceId/fileId
        // It can also be a data URL or base64 for backwards compatibility
        let imageSrc: string
        if (imageData.startsWith('data:')) {
            imageSrc = imageData
        } else if (imageData.startsWith('/api/')) {
            const token = await AuthService.getTokenSilently()
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            imageSrc = `${API_BASE_URL}${imageData}${token ? `?token=${token}` : ''}`
        } else if (imageData.startsWith('http')) {
            // Full URL — strip any stale token and re-apply a fresh one
            const stripped = imageData.replace(/[?&]token=[^&]+/, '')
            if (stripped.includes('/api/images/')) {
                const token = await AuthService.getTokenSilently()
                imageSrc = `${stripped}${token ? `?token=${token}` : ''}`
            } else {
                imageSrc = imageData
            }
        } else {
            // Legacy base64 data
            imageSrc = `data:image/png;base64,${imageData}`
        }

        if (imageElement.src !== imageSrc) {
            imageElement.src = imageSrc
        }

        if (isPartial) {
            container.classList.add('is-partial')
        } else {
            container.classList.remove('is-partial')
        }
    }

    imageElement.onerror = () => {
        applyStyle(imageElement, { display: 'none' })
        if (!container.querySelector('.image-error-placeholder')) {
            container.appendChild(html`
                <div className="image-error-placeholder"><span innerHTML=${brokenImageIcon}></span><span>Image unavailable</span></div>
            `)
        }
    }

    updateDisplay().catch(() => {})
    updateRunMeta()

    return {
        dom: wrapper,
        update: (updatedNode: any) => {
            if (updatedNode.type.name !== aiGeneratedImageNodeType) {
                return false
            }

            node = updatedNode
            updateDisplay()
            updateRunMeta()
            return true
        },
        destroy: () => {
            wrapper.removeEventListener('click', handleClick)
        },
        stopEvent: (event: Event) => {
            return false
        },
    }
}
