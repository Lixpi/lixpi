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
        aiVideoModel: { default: '' },
        videoAspectRatio: { default: '' },
        videoResolution: { default: '' },
        videoDuration: { default: '' },
    },
    parseDOM: [
        {
            tag: 'div.ai-prompt-input-wrapper',
            getAttrs: (dom: HTMLElement) => ({
                aiModel: dom.getAttribute('data-ai-model') || '',
                aiImageModel: dom.getAttribute('data-ai-image-model') || '',
                imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                aiVideoModel: dom.getAttribute('data-ai-video-model') || '',
                videoAspectRatio: dom.getAttribute('data-video-aspect-ratio') || '',
                videoResolution: dom.getAttribute('data-video-resolution') || '',
                videoDuration: dom.getAttribute('data-video-duration') || '',
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
                'data-ai-video-model': node.attrs.aiVideoModel,
                'data-video-aspect-ratio': node.attrs.videoAspectRatio,
                'data-video-resolution': node.attrs.videoResolution,
                'data-video-duration': node.attrs.videoDuration,
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

type VideoModelControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
}

type VideoOptionControls = {
    getValue: () => string
    setValue: (value: string) => void
    getCurrentVideoModel?: () => string
}

type DropdownView = {
    dom: HTMLElement
    destroy?: () => void
    update: () => void
}

type AiPromptInputNodeViewOptions = {
    onSubmit: () => void
    onStop: () => void
    isReceiving: () => boolean
    createModelDropdown: (controls: AiModelControls, dropdownId: string) => DropdownView
    createImageModelDropdown: (controls: ImageModelControls, dropdownId: string) => DropdownView
    createImageSizeDropdown: (controls: ImageSizeControls, dropdownId: string) => DropdownView
    createVideoModelDropdown: (controls: VideoModelControls, dropdownId: string) => DropdownView
    createVideoAspectDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createVideoResolutionDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createVideoDurationDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
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

        const videoModelControls: VideoModelControls = {
            getCurrentVideoModel: () => getNodeAttr(view, getPos, 'aiVideoModel') || '',
            setVideoModel: (aiModel: string) => setNodeAttr(view, getPos, 'aiVideoModel', aiModel),
        }

        const videoAspectControls: VideoOptionControls = {
            getValue: () => getNodeAttr(view, getPos, 'videoAspectRatio') || '',
            setValue: (value: string) => setNodeAttr(view, getPos, 'videoAspectRatio', value),
            getCurrentVideoModel: () => getNodeAttr(view, getPos, 'aiVideoModel') || '',
        }

        const videoResolutionControls: VideoOptionControls = {
            getValue: () => getNodeAttr(view, getPos, 'videoResolution') || '',
            setValue: (value: string) => setNodeAttr(view, getPos, 'videoResolution', value),
            getCurrentVideoModel: () => getNodeAttr(view, getPos, 'aiVideoModel') || '',
        }

        const videoDurationControls: VideoOptionControls = {
            getValue: () => getNodeAttr(view, getPos, 'videoDuration') || '',
            setValue: (value: string) => setNodeAttr(view, getPos, 'videoDuration', value),
            getCurrentVideoModel: () => getNodeAttr(view, getPos, 'aiVideoModel') || '',
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
        const videoModelDropdown = options.createVideoModelDropdown(videoModelControls, 'ai-video-model')
        const videoAspectDropdown = options.createVideoAspectDropdown(videoAspectControls, 'ai-video-aspect')
        const videoResolutionDropdown = options.createVideoResolutionDropdown(videoResolutionControls, 'ai-video-resolution')
        const videoDurationDropdown = options.createVideoDurationDropdown(videoDurationControls, 'ai-video-duration')
        const submitButton = options.createSubmitButton(submitControls)

        controlsEl.appendChild(modelDropdown.dom)
        controlsEl.appendChild(imageModelDropdown.dom)
        controlsEl.appendChild(imageSizeDropdown.dom)
        controlsEl.appendChild(videoModelDropdown.dom)
        controlsEl.appendChild(videoAspectDropdown.dom)
        controlsEl.appendChild(videoResolutionDropdown.dom)
        controlsEl.appendChild(videoDurationDropdown.dom)
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
                videoModelDropdown.update()
                videoAspectDropdown.update()
                videoResolutionDropdown.update()
                videoDurationDropdown.update()
                return true
            },
            destroy: () => {
                clearInterval(receivingPollInterval)
                modelDropdown.destroy?.()
                imageModelDropdown.destroy?.()
                imageSizeDropdown.destroy?.()
                videoModelDropdown.destroy?.()
                videoAspectDropdown.destroy?.()
                videoResolutionDropdown.destroy?.()
                videoDurationDropdown.destroy?.()
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
