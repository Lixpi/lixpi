import { brokenImageIcon } from '$src/svgIcons/index.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import AuthService from '$src/services/auth-service.ts'
import { settings } from '$src/settings.ts'
import { applyMediaModelBadgeStyleProperties, renderMediaModelBadge } from '$src/components/mediaModelBadge.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { NodeSelection } from 'prosemirror-state'
import type { ImageBranchVlmResolution, MediaBranchLineagePlan, MediaGenerationRunMeta, WorkspaceContextResolution } from '@lixpi/constants'
import {
    aiGeneratedImageNodeSpec,
    aiGeneratedImageNodeType,
} from '@lixpi/prosemirror'

export {
    aiGeneratedImageNodeSpec,
    aiGeneratedImageNodeType,
}

export type AiGeneratedImageCallbacks = {
    onAddToCanvas?: (data: {
        imageUrl: string
        fileId: string
        responseId: string
        revisedPrompt: string
        aiModel: string
    }) => void
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
        imageModelId?: string
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
        <div className="ai-generated-image-wrapper ai-generated-media-node">
            <div className="ai-generated-media-section-title">Final generated image</div>
            <div className="ai-generated-image-container">
                <div className="ai-generated-image-spinner">
                    <div className="spinner-ring"></div>
                    <span className="spinner-text">Generating image...</span>
                </div>
                <img className="ai-generated-image-content" alt="" />
            </div>
            <div className="ai-generated-media-model-chrome ai-generated-media-run-meta"></div>
        </div>
    `

    const container = wrapper.querySelector('.ai-generated-image-container') as HTMLElement
    const titleElement = wrapper.querySelector('.ai-generated-media-section-title') as HTMLElement
    const spinnerElement = wrapper.querySelector('.ai-generated-image-spinner') as HTMLElement
    const imageElement = wrapper.querySelector('.ai-generated-image-content') as HTMLImageElement
    const modelChromeElement = wrapper.querySelector('.ai-generated-media-model-chrome') as HTMLElement
    titleElement.hidden = true
    applyMediaModelBadgeStyleProperties(wrapper, { scale: settings.mediaNode.generatedMediaChrome.chatScale })
    let unsubscribeAiModelsStore: (() => void) | null = null

    // Click handler to select the node (needed for bubble menu)
    const handleClick = (event: MouseEvent) => {
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
        renderMediaModelBadge(modelChromeElement, {
            modelId: node.attrs.mediaModelId,
        })
    }

    const updateDisplay = async () => {
        const { imageData, isPartial } = node.attrs

        if (!imageData) {
            titleElement.hidden = true
            spinnerElement.classList.add('is-active')
            imageElement.classList.remove('is-visible')
            return
        }

        titleElement.hidden = Boolean(isPartial)
        spinnerElement.classList.remove('is-active')
        imageElement.classList.add('is-visible')

        // imageData is now a URL path like /api/files/workspaceId/fileId
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
            if (stripped.includes('/api/files/')) {
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
        titleElement.hidden = true
        applyStyle(imageElement, { display: 'none' })
        if (!container.querySelector('.image-error-placeholder')) {
            container.appendChild(html`
                <div className="image-error-placeholder"><span innerHTML=${brokenImageIcon}></span><span>Image unavailable</span></div>
            `)
        }
    }

    updateDisplay().catch(() => {})
    unsubscribeAiModelsStore = aiModelsStore.subscribe(() => updateModelChrome())

    return {
        dom: wrapper,
        update: (updatedNode: any) => {
            if (updatedNode.type.name !== aiGeneratedImageNodeType) {
                return false
            }

            node = updatedNode
            updateDisplay()
            updateModelChrome()
            return true
        },
        destroy: () => {
            wrapper.removeEventListener('click', handleClick)
            unsubscribeAiModelsStore?.()
            unsubscribeAiModelsStore = null
        },
        stopEvent: (event: Event) => {
            return false
        },
    }
}
