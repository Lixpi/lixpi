import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { html } from '$src/utils/domTemplates.ts'
import { BubbleMenu, type BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'
import { createHelpTooltip } from '$src/components/helpTooltip/index.ts'
import { atomIcon } from '$src/svgIcons/index.ts'
import { settings, type AiPromptInputModelMenuSettings } from '$src/settings.ts'

export const aiPromptInputNodeType = 'aiPromptInput'

export function parseAiModelSelectionAttr(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    }

    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
            return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        }
    } catch {
        return []
    }

    return []
}

export function serializeAiModelSelectionAttr(models: readonly string[]): string {
    const uniqueModels = Array.from(new Set(models.filter((model) => model.trim().length > 0)))
    return uniqueModels.length > 0 ? JSON.stringify(uniqueModels) : ''
}

function normalizeAiModelSelectionAttr(value: unknown): string {
    return serializeAiModelSelectionAttr(parseAiModelSelectionAttr(value))
}

export const aiPromptInputNodeSpec = {
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    selectable: false,
    isolating: true,
    attrs: {
        aiModel: { default: '' },
        aiModels: { default: '' },
        aiImageModel: { default: '' },
        aiImageModels: { default: '' },
        imageGenerationSize: { default: 'auto' },
        aiVideoModel: { default: '' },
        aiVideoModels: { default: '' },
        videoAspectRatio: { default: '' },
        videoResolution: { default: '' },
        videoDuration: { default: '' },
    },
    parseDOM: [
        {
            tag: 'div.ai-prompt-input-wrapper',
            getAttrs: (dom: HTMLElement) => ({
                aiModel: dom.getAttribute('data-ai-model') || '',
                aiModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-models')),
                aiImageModel: dom.getAttribute('data-ai-image-model') || '',
                aiImageModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-image-models')),
                imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                aiVideoModel: dom.getAttribute('data-ai-video-model') || '',
                aiVideoModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-video-models')),
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
                'data-ai-models': normalizeAiModelSelectionAttr(node.attrs.aiModels),
                'data-ai-image-model': node.attrs.aiImageModel,
                'data-ai-image-models': normalizeAiModelSelectionAttr(node.attrs.aiImageModels),
                'data-image-generation-size': node.attrs.imageGenerationSize,
                'data-ai-video-model': node.attrs.aiVideoModel,
                'data-ai-video-models': normalizeAiModelSelectionAttr(node.attrs.aiVideoModels),
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
    getCurrentImageModel?: () => string
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
    getControlLabel?: () => string
}

type ModelControlItem = {
    label: string | HTMLElement
    control: HTMLElement
}

type ModelControlSection = {
    title: string
    helpText: string
    controls: ModelControlItem[]
}

type ModelMenuSectionView = {
    dom: HTMLElement
    destroy: () => void
}

type ModelMenuContentView = {
    dom: HTMLElement
    destroy: () => void
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

const modelMenuCssVariables: Array<[string, keyof AiPromptInputModelMenuSettings]> = [
    ['--ai-prompt-model-menu-open-prompt-z-index', 'openPromptZIndex'],
    ['--ai-prompt-model-menu-info-bubble-z-index', 'infoBubbleZIndex'],
    ['--ai-prompt-model-menu-trigger-size', 'triggerSize'],
    ['--ai-prompt-model-menu-trigger-icon-size', 'triggerIconSize'],
    ['--ai-prompt-model-menu-trigger-color', 'triggerColor'],
    ['--ai-prompt-model-menu-trigger-active-color', 'triggerActiveColor'],
    ['--ai-prompt-model-menu-trigger-active-background', 'triggerActiveBackground'],
    ['--ai-prompt-model-menu-trigger-focus-outline', 'triggerFocusOutline'],
    ['--ai-prompt-model-menu-trigger-focus-outline-offset', 'triggerFocusOutlineOffset'],
    ['--ai-prompt-model-menu-trigger-transition', 'triggerTransition'],
    ['--ai-prompt-model-menu-info-bubble-width', 'infoBubbleWidth'],
    ['--ai-prompt-model-menu-info-bubble-max-width', 'infoBubbleMaxWidth'],
    ['--ai-prompt-model-menu-info-bubble-mobile-max-width', 'infoBubbleMobileMaxWidth'],
    ['--ai-prompt-model-menu-info-bubble-padding', 'infoBubblePadding'],
    ['--ai-prompt-model-menu-info-bubble-border-radius', 'infoBubbleBorderRadius'],
    ['--ai-prompt-model-menu-info-bubble-background', 'infoBubbleBackground'],
    ['--ai-prompt-model-menu-info-bubble-box-shadow', 'infoBubbleBoxShadow'],
    ['--ai-prompt-model-menu-info-bubble-color', 'infoBubbleColor'],
    ['--ai-prompt-model-menu-content-gap', 'contentGap'],
    ['--ai-prompt-model-menu-section-gap', 'sectionGap'],
    ['--ai-prompt-model-menu-section-divider-padding-top', 'sectionDividerPaddingTop'],
    ['--ai-prompt-model-menu-section-divider-width', 'sectionDividerWidth'],
    ['--ai-prompt-model-menu-section-divider-height', 'sectionDividerHeight'],
    ['--ai-prompt-model-menu-section-divider-gradient', 'sectionDividerGradient'],
    ['--ai-prompt-model-menu-section-divider-border-radius', 'sectionDividerBorderRadius'],
    ['--ai-prompt-model-menu-section-heading-gap', 'sectionHeadingGap'],
    ['--ai-prompt-model-menu-section-heading-justify-content', 'sectionHeadingJustifyContent'],
    ['--ai-prompt-model-menu-section-title-color', 'sectionTitleColor'],
    ['--ai-prompt-model-menu-section-title-font-size', 'sectionTitleFontSize'],
    ['--ai-prompt-model-menu-section-title-font-weight', 'sectionTitleFontWeight'],
    ['--ai-prompt-model-menu-section-title-line-height', 'sectionTitleLineHeight'],
    ['--ai-prompt-model-menu-controls-grid-template-columns', 'controlsGridTemplateColumns'],
    ['--ai-prompt-model-menu-controls-mobile-grid-template-columns', 'controlsMobileGridTemplateColumns'],
    ['--ai-prompt-model-menu-controls-gap', 'controlsGap'],
    ['--ai-prompt-model-menu-controls-max-width', 'controlsMaxWidth'],
    ['--ai-prompt-model-menu-controls-mobile-max-width', 'controlsMobileMaxWidth'],
    ['--ai-prompt-model-menu-control-gap', 'controlGap'],
    ['--ai-prompt-model-menu-control-label-color', 'controlLabelColor'],
    ['--ai-prompt-model-menu-control-label-inset', 'controlLabelInset'],
    ['--ai-prompt-model-menu-control-label-font-size', 'controlLabelFontSize'],
    ['--ai-prompt-model-menu-control-label-font-weight', 'controlLabelFontWeight'],
    ['--ai-prompt-model-menu-control-label-line-height', 'controlLabelLineHeight'],
    ['--ai-prompt-model-menu-dropdown-button-max-width', 'dropdownButtonMaxWidth'],
    ['--ai-prompt-model-menu-dropdown-button-mobile-max-width', 'dropdownButtonMobileMaxWidth'],
    ['--ai-prompt-model-menu-nested-dropdown-gap', 'nestedDropdownGap'],
    ['--help-tooltip-trigger-size', 'helpTooltipTriggerSize'],
    ['--help-tooltip-trigger-border', 'helpTooltipTriggerBorder'],
    ['--help-tooltip-trigger-background', 'helpTooltipTriggerBackground'],
    ['--help-tooltip-trigger-color', 'helpTooltipTriggerColor'],
    ['--help-tooltip-trigger-hover-background', 'helpTooltipTriggerHoverBackground'],
    ['--help-tooltip-trigger-hover-color', 'helpTooltipTriggerHoverColor'],
    ['--help-tooltip-icon-size', 'helpTooltipIconSize'],
    ['--help-tooltip-trigger-focus-outline', 'helpTooltipTriggerFocusOutline'],
    ['--help-tooltip-trigger-focus-outline-offset', 'helpTooltipTriggerFocusOutlineOffset'],
    ['--help-tooltip-offset', 'helpTooltipOffset'],
    ['--help-tooltip-viewport-margin', 'helpTooltipViewportMargin'],
    ['--help-tooltip-width', 'helpTooltipWidth'],
    ['--help-tooltip-max-width', 'helpTooltipMaxWidth'],
    ['--help-tooltip-padding', 'helpTooltipPadding'],
    ['--help-tooltip-background', 'helpTooltipBackground'],
    ['--help-tooltip-border', 'helpTooltipBorder'],
    ['--help-tooltip-border-radius', 'helpTooltipBorderRadius'],
    ['--help-tooltip-box-shadow', 'helpTooltipBoxShadow'],
    ['--help-tooltip-color', 'helpTooltipColor'],
    ['--help-tooltip-font-size', 'helpTooltipFontSize'],
    ['--help-tooltip-font-weight', 'helpTooltipFontWeight'],
    ['--help-tooltip-line-height', 'helpTooltipLineHeight'],
    ['--help-tooltip-content-z-index', 'helpTooltipContentZIndex'],
]

function applyModelMenuStyleSettings(element: HTMLElement): void {
    const modelMenuSettings = settings.aiPromptInput.modelMenu
    for (const [propertyName, settingKey] of modelMenuCssVariables) {
        element.style.setProperty(propertyName, modelMenuSettings[settingKey])
    }
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

function createModelMenuControl(item: ModelControlItem): HTMLElement {
    const label = typeof item.label === 'string'
        ? html`<span className="ai-prompt-model-menu-control-label">${item.label}</span>` as HTMLElement
        : item.label

    return html`
        <label className="ai-prompt-model-menu-control">
            ${label}
            <span className="ai-prompt-model-menu-control-field">${item.control}</span>
        </label>
    ` as HTMLElement
}

function createModelMenuSection(section: ModelControlSection): ModelMenuSectionView {
    const helpTooltip = createHelpTooltip({
        label: `${section.title} help`,
        text: section.helpText,
        className: 'ai-prompt-model-menu-section-help',
    })

    const dom = html`
        <section className="ai-prompt-model-menu-section">
            <div className="ai-prompt-model-menu-section-heading">
                <div className="ai-prompt-model-menu-section-title">${section.title}</div>
                ${helpTooltip.dom}
            </div>
            <div className="ai-prompt-model-menu-section-controls">
                ${section.controls.map(createModelMenuControl)}
            </div>
        </section>
    ` as HTMLElement

    return {
        dom,
        destroy: () => helpTooltip.destroy(),
    }
}

function createModelMenuContent(sections: ModelControlSection[]): ModelMenuContentView {
    const sectionViews = sections.map(createModelMenuSection)
    const dom = html`
        <div className="ai-prompt-model-menu-content" contenteditable="false">
            ${sectionViews.map(sectionView => sectionView.dom)}
        </div>
    ` as HTMLElement

    return {
        dom,
        destroy: () => {
            for (const sectionView of sectionViews) {
                sectionView.destroy()
            }
        },
    }
}

function createModelMenuTrigger(onClick: (event: MouseEvent) => void): HTMLButtonElement {
    const handleMouseDown = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
    }

    return html`
        <button
            type="button"
            className="ai-prompt-model-menu-trigger"
            title="Model settings"
            aria-label="Model settings"
            aria-expanded="false"
            contenteditable="false"
            onmousedown=${handleMouseDown}
            onclick=${onClick}
        >
            <span className="ai-prompt-model-menu-trigger-icon" innerHTML=${atomIcon}></span>
        </button>
    ` as HTMLButtonElement
}

export function createAiPromptInputNodeView(options: AiPromptInputNodeViewOptions) {
    return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => {
        const dom = html`<div className="ai-prompt-input-wrapper"></div>` as HTMLDivElement
        const contentDOM = html`<div className="ai-prompt-input-content"></div>` as HTMLDivElement
        const controlsEl = html`<div className="ai-prompt-input-controls"></div>` as HTMLDivElement
        applyModelMenuStyleSettings(dom)

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
            getCurrentImageModel: () => getNodeAttr(view, getPos, 'aiImageModel') || '',
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

        const modelDropdowns = [
            modelDropdown,
            imageModelDropdown,
            imageSizeDropdown,
            videoModelDropdown,
            videoAspectDropdown,
            videoResolutionDropdown,
            videoDurationDropdown,
        ]

        const imageSizeControlLabel = html`<span className="ai-prompt-model-menu-control-label"></span>` as HTMLElement
        const updateImageSizeControlLabel = (): void => {
            imageSizeControlLabel.textContent = imageSizeDropdown.getControlLabel?.() ?? 'Image option'
        }

        const updateModelDropdowns = (): void => {
            for (const dropdown of modelDropdowns) {
                dropdown.update()
            }
            updateImageSizeControlLabel()
        }

        updateImageSizeControlLabel()

        const modelMenuContent = createModelMenuContent([
            {
                title: 'Reasoning model',
                helpText: 'This model works on your message before anything is made. It looks at what you wrote and any images or notes you selected, then turns that into a clearer prompt for the image or video model.',
                controls: [
                    { label: 'Model', control: modelDropdown.dom },
                ],
            },
            {
                title: 'Image model',
                helpText: 'Use this when you want a picture. The model choice decides which image generator will draw it. The second option controls the shape or exact size of the image, depending on what that model supports.',
                controls: [
                    { label: 'Model', control: imageModelDropdown.dom },
                    { label: imageSizeControlLabel, control: imageSizeDropdown.dom },
                ],
            },
            {
                title: 'Video model',
                helpText: 'Use this when you want a short video instead of a still image. These options choose the video generator, the frame shape, the output quality, and how long the clip should be.',
                controls: [
                    { label: 'Model', control: videoModelDropdown.dom },
                    { label: 'Aspect ratio', control: videoAspectDropdown.dom },
                    { label: 'Resolution', control: videoResolutionDropdown.dom },
                    { label: 'Duration', control: videoDurationDropdown.dom },
                ],
            },
        ])

        let modelMenu: BubbleMenu | null = null

        const toggleModelMenu = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()

            if (!modelMenu) return

            if (modelMenu.isVisible) {
                modelMenu.hide()
                return
            }

            updateModelDropdowns()
            modelMenu.show('modelSettings', {
                targetRect: modelMenuTrigger.getBoundingClientRect(),
                placement: 'above',
                horizontalAlignment: 'end',
                clampToParent: false,
            })
        }

        const modelMenuTrigger = createModelMenuTrigger(toggleModelMenu)

        controlsEl.appendChild(modelMenuTrigger)
        controlsEl.appendChild(submitButton)

        dom.appendChild(contentDOM)
        dom.appendChild(controlsEl)

        const modelMenuItems: BubbleMenuItem[] = [
            {
                element: modelMenuContent.dom,
                context: ['modelSettings'],
                update: updateModelDropdowns,
            },
        ]

        modelMenu = new BubbleMenu({
            parentEl: controlsEl,
            items: modelMenuItems,
            onShow: () => {
                modelMenuTrigger.classList.add('is-active')
                modelMenuTrigger.setAttribute('aria-expanded', 'true')
            },
            onHide: () => {
                modelMenuTrigger.classList.remove('is-active')
                modelMenuTrigger.setAttribute('aria-expanded', 'false')
            },
        })
        modelMenu.element.classList.add('ai-prompt-model-menu-info-bubble')
        modelMenu.element.style.zIndex = settings.aiPromptInput.modelMenu.infoBubbleZIndex
        modelMenu.element.setAttribute('aria-label', 'Model settings')

        const handleDocumentMouseDown = (event: MouseEvent): void => {
            const target = event.target as Node
            if (controlsEl.contains(target)) return
            modelMenu?.hide()
        }
        document.addEventListener('mousedown', handleDocumentMouseDown, true)

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
                updateModelDropdowns()
                return true
            },
            destroy: () => {
                clearInterval(receivingPollInterval)
                document.removeEventListener('mousedown', handleDocumentMouseDown, true)
                modelMenuContent.destroy()
                modelMenu?.destroy()
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
