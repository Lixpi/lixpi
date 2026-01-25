import { gptAvatarIcon } from '$src/svgIcons/index.ts'
import { html } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'

export const aiGeneratedImageNodeType = 'aiGeneratedImage'

export const aiGeneratedImageNodeSpec = {
    attrs: {
        imageData: { default: '' },
        fileId: { default: '' },
        revisedPrompt: { default: '' },
        responseId: { default: '' },
        aiModel: { default: '' },
        isPartial: { default: true },
        partialIndex: { default: 0 },
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
                    revisedPrompt: dom.getAttribute('data-revised-prompt') || '',
                    responseId: dom.getAttribute('data-response-id') || '',
                    aiModel: dom.getAttribute('data-ai-model') || '',
                    isPartial: dom.getAttribute('data-is-partial') === 'true',
                    partialIndex: parseInt(dom.getAttribute('data-partial-index') || '0', 10),
                }
            },
        },
    ],
    toDOM(node: any) {
        return ['div', {
            class: 'ai-generated-image',
            'data-image-data': node.attrs.imageData,
            'data-file-id': node.attrs.fileId,
            'data-revised-prompt': node.attrs.revisedPrompt,
            'data-response-id': node.attrs.responseId,
            'data-ai-model': node.attrs.aiModel,
            'data-is-partial': String(node.attrs.isPartial),
            'data-partial-index': String(node.attrs.partialIndex),
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
}

let globalCallbacks: AiGeneratedImageCallbacks = {}

export function setAiGeneratedImageCallbacks(callbacks: AiGeneratedImageCallbacks) {
    globalCallbacks = callbacks
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
        </div>
    `

    const container = wrapper.querySelector('.ai-generated-image-container') as HTMLElement
    const spinnerElement = wrapper.querySelector('.ai-generated-image-spinner') as HTMLElement
    const imageElement = wrapper.querySelector('.ai-generated-image-content') as HTMLImageElement

    const updateDisplay = async () => {
        const { imageData, revisedPrompt, responseId, aiModel, isPartial } = node.attrs
        console.log('🖼️ [IMAGE_NODE] updateDisplay called:', { imageData, isPartial })

        if (!imageData) {
            console.log('🖼️ [IMAGE_NODE] no imageData, showing spinner')
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
            // URL path - needs auth token appended as query param
            const token = await AuthService.getTokenSilently()
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            imageSrc = `${API_BASE_URL}${imageData}?token=${token}`
            console.log('🖼️ [IMAGE_NODE] built image URL:', imageSrc)
        } else if (imageData.startsWith('http')) {
            // Full URL (already has token)
            imageSrc = imageData
        } else {
            // Legacy base64 data
            imageSrc = `data:image/png;base64,${imageData}`
        }

        console.log('🖼️ [IMAGE_NODE] setting imageElement.src to:', imageSrc.substring(0, 100))
        if (imageElement.src !== imageSrc) {
            imageElement.src = imageSrc
        }

        if (isPartial) {
            container.classList.add('is-partial')
        } else {
            container.classList.remove('is-partial')
        }
    }

    updateDisplay()

    return {
        dom: wrapper,
        update: (updatedNode: any) => {
            if (updatedNode.type.name !== aiGeneratedImageNodeType) {
                return false
            }

            node = updatedNode
            updateDisplay()
            return true
        },
        destroy: () => {},
        stopEvent: (event: Event) => {
            return false
        },
    }
}
