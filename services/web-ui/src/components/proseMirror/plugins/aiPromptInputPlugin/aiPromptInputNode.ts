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
        imageGenerationEnabled: { default: false },
        imageGenerationSize: { default: '1024x1024' },
    },
    parseDOM: [
        {
            tag: 'div.ai-prompt-input-wrapper',
            getAttrs: (dom: HTMLElement) => ({
                aiModel: dom.getAttribute('data-ai-model') || '',
                imageGenerationEnabled: dom.getAttribute('data-image-generation-enabled') === 'true',
                imageGenerationSize: dom.getAttribute('data-image-generation-size') || '1024x1024',
            })
        },
    ],
    toDOM(node: ProseMirrorNode) {
        return [
            'div',
            {
                class: 'ai-prompt-input-wrapper',
                'data-ai-model': node.attrs.aiModel,
                'data-image-generation-enabled': node.attrs.imageGenerationEnabled,
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

type ImageToggleControls = {
    getImageGenerationEnabled: () => boolean
    getImageGenerationSize: () => string
    setImageGenerationEnabled: (enabled: boolean) => void
    setImageGenerationSize: (size: string) => void
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
    createImageToggle: (controls: ImageToggleControls) => {
        dom: HTMLElement
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

        const imageControls: ImageToggleControls = {
            getImageGenerationEnabled: () => Boolean(getNodeAttr(view, getPos, 'imageGenerationEnabled')),
            getImageGenerationSize: () => getNodeAttr(view, getPos, 'imageGenerationSize') || '1024x1024',
            setImageGenerationEnabled: (enabled: boolean) => setNodeAttr(view, getPos, 'imageGenerationEnabled', enabled),
            setImageGenerationSize: (size: string) => setNodeAttr(view, getPos, 'imageGenerationSize', size),
        }

        const submitControls: SubmitControls = {
            onSubmit: options.onSubmit,
            onStop: options.onStop,
            isReceiving: options.isReceiving,
        }

        // Mount controls using adapters
        const modelDropdown = options.createModelDropdown(modelControls, 'ai-prompt-input')
        const imageToggle = options.createImageToggle(imageControls)
        const submitButton = options.createSubmitButton(submitControls)

        controlsEl.appendChild(modelDropdown.dom)
        controlsEl.appendChild(imageToggle.dom)
        controlsEl.appendChild(submitButton)

        dom.appendChild(contentDOM)
        dom.appendChild(controlsEl)

        const syncEmptyState = (n: ProseMirrorNode) => {
            const empty = n.textContent.trim() === ''
            dom.setAttribute('data-empty', String(empty))
        }

        syncEmptyState(node)

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
                modelDropdown.update()
                imageToggle.update()
                return true
            },
            destroy: () => {
                modelDropdown.destroy?.()
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
