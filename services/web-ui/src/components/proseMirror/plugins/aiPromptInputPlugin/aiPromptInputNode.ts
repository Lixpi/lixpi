import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { html } from '$src/utils/domTemplates.ts'

export const aiPromptInputNodeType = 'aiPromptInput'

export const aiPromptInputNodeSpec = {
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    selectable: false,
    isolating: true,
    attrs: {
        aiModel: { default: '' },
        aiImageModel: { default: '' },
        imageGenerationSize: { default: 'auto' },
    },
    parseDOM: [
        {
            tag: 'div.ai-prompt-input-wrapper',
            getAttrs: (dom: HTMLElement) => ({
                aiModel: dom.getAttribute('data-ai-model') || '',
                aiImageModel: dom.getAttribute('data-ai-image-model') || '',
                imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
            })
        },
    ],
    toDOM(node: ProseMirrorNode) {
        return [
            'div',
            {
                class: 'ai-prompt-input-wrapper',
                'data-ai-model': node.attrs.aiModel,
                'data-ai-image-model': node.attrs.aiImageModel,
                'data-image-generation-size': node.attrs.imageGenerationSize,
            },
            0,
        ]
    },
}

type AiModelControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
}

type SubmitControls = {
    onSubmit: () => void
    onStop: () => void
    isReceiving: () => boolean
}

type ImageSizeControls = {
    getImageGenerationSize: () => string
    setImageGenerationSize: (size: string) => void
    getProvider?: () => string
}

type ImageModelControls = {
    getCurrentImageModel: () => string
    setImageModel: (aiModel: string) => void
}

type AiPromptInputNodeViewOptions = {
    onSubmit: () => void
    onStop: () => void
    isReceiving: () => boolean
    createModelDropdown: (controls: AiModelControls, dropdownId: string) => {
        dom: HTMLElement
        destroy?: () => void
        update: () => void
    }
    createImageModelDropdown: (controls: ImageModelControls, dropdownId: string) => {
        dom: HTMLElement
        destroy?: () => void
        update: () => void
    }
    createImageSizeDropdown: (controls: ImageSizeControls, dropdownId: string) => {
        dom: HTMLElement
        destroy?: () => void
        update: () => void
    }
    createSubmitButton: (controls: SubmitControls) => HTMLElement
}

function setNodeAttr(view: EditorView, getPos: () => number | undefined, attrName: string, value: any) {
    const pos = getPos()
    if (pos === undefined) return
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...view.state.doc.nodeAt(pos)?.attrs,
        [attrName]: value,
    })
    view.dispatch(tr)
}

function getNodeAttr(view: EditorView, getPos: () => number | undefined, attrName: string): any {
    const pos = getPos()
    if (pos === undefined) return undefined
    return view.state.doc.nodeAt(pos)?.attrs?.[attrName]
}

export function createAiPromptInputNodeView(options: AiPromptInputNodeViewOptions) {
    return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => {
        const dom = document.createElement('div')
        dom.className = 'ai-prompt-input-wrapper'

        const contentDOM = document.createElement('div')
        contentDOM.className = 'ai-prompt-input-content'

        const controlsEl = document.createElement('div')
        controlsEl.className = 'ai-prompt-input-controls'

        // Build controls adapters that read/write ProseMirror node attrs
        const modelControls: AiModelControls = {
            getCurrentAiModel: () => getNodeAttr(view, getPos, 'aiModel') || '',
            setAiModel: (aiModel: string) => setNodeAttr(view, getPos, 'aiModel', aiModel),
        }

        const imageModelControls: ImageModelControls = {
            getCurrentImageModel: () => getNodeAttr(view, getPos, 'aiImageModel') || '',
            setImageModel: (aiModel: string) => setNodeAttr(view, getPos, 'aiImageModel', aiModel),
        }

        const imageControls: ImageSizeControls = {
            getImageGenerationSize: () => getNodeAttr(view, getPos, 'imageGenerationSize') || 'auto',
            setImageGenerationSize: (size: string) => setNodeAttr(view, getPos, 'imageGenerationSize', size),
            getProvider: () => (getNodeAttr(view, getPos, 'aiImageModel') || getNodeAttr(view, getPos, 'aiModel') || '').split(':')[0] || '',
        }

        const submitControls: SubmitControls = {
            onSubmit: options.onSubmit,
            onStop: options.onStop,
            isReceiving: options.isReceiving,
        }

        // Mount controls using adapters
        const modelDropdown = options.createModelDropdown(modelControls, 'ai-prompt-input')
        const imageModelDropdown = options.createImageModelDropdown(imageModelControls, 'ai-image-model')
        const imageSizeDropdown = options.createImageSizeDropdown(imageControls, 'ai-image-size')
        const submitButton = options.createSubmitButton(submitControls)

        controlsEl.appendChild(modelDropdown.dom)
        controlsEl.appendChild(imageModelDropdown.dom)
        controlsEl.appendChild(imageSizeDropdown.dom)
        controlsEl.appendChild(submitButton)

        dom.appendChild(contentDOM)
        dom.appendChild(controlsEl)

        const syncEmptyState = (n: ProseMirrorNode) => {
            const empty = n.textContent.trim() === ''
            dom.setAttribute('data-empty', String(empty))
        }

        const syncReceivingState = () => {
            const receiving = options.isReceiving()
            controlsEl.classList.toggle('receiving', receiving)
        }

        syncEmptyState(node)
        syncReceivingState()

        const receivingPollInterval = setInterval(syncReceivingState, 200)

        return {
            dom,
            contentDOM,
            ignoreMutation: (mutation: MutationRecord) => {
                if (mutation.target === controlsEl || controlsEl.contains(mutation.target as Node)) {
                    return true
                }
                return false
            },
            update: (updatedNode: ProseMirrorNode) => {
                if (updatedNode.type.name !== aiPromptInputNodeType) return false
                node = updatedNode
                syncEmptyState(updatedNode)
                syncReceivingState()
                modelDropdown.update()
                imageModelDropdown.update()
                imageSizeDropdown.update()
                return true
            },
            destroy: () => {
                clearInterval(receivingPollInterval)
                modelDropdown.destroy?.()
                imageModelDropdown.destroy?.()
                imageSizeDropdown.destroy?.()
            },
            stopEvent: (e: Event) => {
                // Prevent ProseMirror from stealing focus/clicks from controls
                const isControl = controlsEl.contains(e.target as Node)
                if (isControl) {
                    return true
                }
                return false
            },
        }
    }
}
