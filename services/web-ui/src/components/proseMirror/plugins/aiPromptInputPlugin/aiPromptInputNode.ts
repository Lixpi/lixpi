import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { html } from '$src/utils/domTemplates.ts'
import { BubbleMenu, type BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'
import { createHelpTooltip } from '$src/components/helpTooltip/index.ts'
import { createToggleSwitch } from '$src/components/toggleSwitch/index.ts'
import { createTagPill, type TagPillInstance } from '$src/components/tagPill/index.ts'
import { atomIcon } from '$src/svgIcons/index.ts'
import { settings, type AiPromptInputModelMenuSettings } from '$src/settings.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    transformModelsToOptions,
    type AiModelDropdownOption,
} from '$src/components/proseMirror/plugins/primitives/aiControls/aiControls.ts'

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

function parseBooleanAttr(value: unknown): boolean {
    return value === true || value === 'true'
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
        useMultipleModels: { default: false },
        useMultipleReasoningModels: { default: false },
        useMultipleImageModels: { default: false },
        useMultipleVideoModels: { default: false },
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
            getAttrs: (dom: HTMLElement) => {
                const legacyUseMultipleModels = dom.getAttribute('data-use-multiple-models') === 'true'
                const hasSectionModeAttrs = dom.hasAttribute('data-use-multiple-reasoning-models')
                    || dom.hasAttribute('data-use-multiple-image-models')
                    || dom.hasAttribute('data-use-multiple-video-models')
                const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionModeAttrs
                return {
                    aiModel: dom.getAttribute('data-ai-model') || '',
                    aiModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-models')),
                    useMultipleModels: legacyUseMultipleModels,
                    useMultipleReasoningModels: dom.getAttribute('data-use-multiple-reasoning-models') === 'true' || useLegacyModeFallback,
                    useMultipleImageModels: dom.getAttribute('data-use-multiple-image-models') === 'true' || useLegacyModeFallback,
                    useMultipleVideoModels: dom.getAttribute('data-use-multiple-video-models') === 'true' || useLegacyModeFallback,
                    aiImageModel: dom.getAttribute('data-ai-image-model') || '',
                    aiImageModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-image-models')),
                    imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                    aiVideoModel: dom.getAttribute('data-ai-video-model') || '',
                    aiVideoModels: normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-video-models')),
                    videoAspectRatio: dom.getAttribute('data-video-aspect-ratio') || '',
                    videoResolution: dom.getAttribute('data-video-resolution') || '',
                    videoDuration: dom.getAttribute('data-video-duration') || '',
                }
            }
        },
    ],
    toDOM(node: ProseMirrorNode) {
        const legacyUseMultipleModels = parseBooleanAttr(node.attrs.useMultipleModels)
        const hasSectionMode = parseBooleanAttr(node.attrs.useMultipleReasoningModels)
            || parseBooleanAttr(node.attrs.useMultipleImageModels)
            || parseBooleanAttr(node.attrs.useMultipleVideoModels)
        const useLegacyModeFallback = legacyUseMultipleModels && !hasSectionMode
        const useMultipleReasoningModels = parseBooleanAttr(node.attrs.useMultipleReasoningModels) || useLegacyModeFallback
        const useMultipleImageModels = parseBooleanAttr(node.attrs.useMultipleImageModels) || useLegacyModeFallback
        const useMultipleVideoModels = parseBooleanAttr(node.attrs.useMultipleVideoModels) || useLegacyModeFallback
        return [
            'div',
            {
                class: 'ai-prompt-input-wrapper',
                'data-ai-model': node.attrs.aiModel,
                'data-ai-models': normalizeAiModelSelectionAttr(node.attrs.aiModels),
                'data-use-multiple-models': String(useMultipleReasoningModels || useMultipleImageModels || useMultipleVideoModels),
                'data-use-multiple-reasoning-models': String(useMultipleReasoningModels),
                'data-use-multiple-image-models': String(useMultipleImageModels),
                'data-use-multiple-video-models': String(useMultipleVideoModels),
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
    getCurrentAiModels?: () => string[]
    setAiModels?: (aiModels: string[]) => void
}

type MultipleModelModeControls = {
    getUseMultipleModels: () => boolean
    setUseMultipleModels: (useMultipleModels: boolean) => void
}

type SelectedModelTagsControls = {
    getUseMultipleModels: () => boolean
    getSelectedModelIds: () => string[]
    setSelectedModelIds: (modelIds: string[]) => void
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
    getCurrentImageModels?: () => string[]
    setImageModels?: (aiModels: string[]) => void
}

type VideoModelControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
    getCurrentVideoModels?: () => string[]
    setVideoModels?: (aiModels: string[]) => void
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
    headingControl?: HTMLElement
    selectedModelTags?: HTMLElement
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
    placeholderText?: string
    createContextTray?: () => HTMLElement | null
    createModelDropdown: (controls: AiModelControls, dropdownId: string) => DropdownView
    createModelMultiSelect?: (controls: AiModelControls, dropdownId: string) => DropdownView
    createImageModelDropdown: (controls: ImageModelControls, dropdownId: string) => DropdownView
    createImageModelMultiSelect?: (controls: ImageModelControls, dropdownId: string) => DropdownView
    createImageSizeDropdown: (controls: ImageSizeControls, dropdownId: string) => DropdownView
    createVideoModelDropdown: (controls: VideoModelControls, dropdownId: string) => DropdownView
    createVideoModelMultiSelect?: (controls: VideoModelControls, dropdownId: string) => DropdownView
    createVideoAspectDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createVideoResolutionDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createVideoDurationDropdown: (controls: VideoOptionControls, dropdownId: string) => DropdownView
    createSubmitButton: (controls: SubmitControls) => HTMLElement
}

type AiPromptInputModelMenuStyleSettings = AiPromptInputModelMenuSettings['styles']

const modelMenuCssVariables: Array<[string, keyof AiPromptInputModelMenuStyleSettings]> = [
    ['--ai-prompt-model-menu-trigger-color', 'triggerColor'],
    ['--ai-prompt-model-menu-trigger-active-color', 'triggerActiveColor'],
    ['--ai-prompt-model-menu-trigger-active-background', 'triggerActiveBackground'],
    ['--ai-prompt-model-menu-trigger-focus-outline', 'triggerFocusOutline'],
    ['--ai-prompt-model-menu-info-bubble-border-radius', 'infoBubbleBorderRadius'],
    ['--ai-prompt-model-menu-info-bubble-background', 'infoBubbleBackground'],
    ['--ai-prompt-model-menu-info-bubble-box-shadow', 'infoBubbleBoxShadow'],
    ['--ai-prompt-model-menu-info-bubble-color', 'infoBubbleColor'],
    ['--ai-prompt-model-menu-section-divider-height', 'sectionDividerHeight'],
    ['--ai-prompt-model-menu-section-divider-gradient', 'sectionDividerGradient'],
    ['--ai-prompt-model-menu-section-divider-border-radius', 'sectionDividerBorderRadius'],
    ['--ai-prompt-model-menu-section-title-color', 'sectionTitleColor'],
    ['--ai-prompt-model-menu-control-label-color', 'controlLabelColor'],
    ['--help-tooltip-trigger-border', 'helpTooltipTriggerBorder'],
    ['--help-tooltip-trigger-background', 'helpTooltipTriggerBackground'],
    ['--help-tooltip-trigger-color', 'helpTooltipTriggerColor'],
    ['--help-tooltip-trigger-hover-background', 'helpTooltipTriggerHoverBackground'],
    ['--help-tooltip-trigger-hover-color', 'helpTooltipTriggerHoverColor'],
    ['--help-tooltip-trigger-focus-outline', 'helpTooltipTriggerFocusOutline'],
    ['--help-tooltip-background', 'helpTooltipBackground'],
    ['--help-tooltip-border', 'helpTooltipBorder'],
    ['--help-tooltip-border-radius', 'helpTooltipBorderRadius'],
    ['--help-tooltip-box-shadow', 'helpTooltipBoxShadow'],
    ['--help-tooltip-color', 'helpTooltipColor'],
]

const modelMenuToggleDimensions = {
    width: 30,
    height: 18,
    svgWidth: 34,
    svgHeight: 22,
}

function applyModelMenuStyleSettings(element: HTMLElement): void {
    const modelMenuStyleSettings = settings.aiPromptInput.modelMenu.styles
    for (const [propertyName, settingKey] of modelMenuCssVariables) {
        element.style.setProperty(propertyName, modelMenuStyleSettings[settingKey])
    }
}

function uniqueNonEmptyValues(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
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

function setNodeAttrs(view: EditorView, getPos: () => number | undefined, attrs: Record<string, unknown>): void {
    const pos = getPos()
    if (pos === undefined) return
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...view.state.doc.nodeAt(pos)?.attrs,
        ...attrs,
    })
    view.dispatch(tr)
}

function getNodeAttr(view: EditorView, getPos: () => number | undefined, attrName: string): any {
    const pos = getPos()
    if (pos === undefined) return undefined
    return view.state.doc.nodeAt(pos)?.attrs?.[attrName]
}

function createModelMenuControl(item: ModelControlItem): HTMLElement {
    const label = item.label === ''
        ? null
        : typeof item.label === 'string'
        ? html`<span className="ai-prompt-model-menu-control-label">${item.label}</span>` as HTMLElement
        : item.label

    return html`
        <div className="ai-prompt-model-menu-control">
            ${label}
            <span className="ai-prompt-model-menu-control-field">${item.control}</span>
        </div>
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
                <div className="ai-prompt-model-menu-section-heading-main">
                    <div className="ai-prompt-model-menu-section-title">${section.title}</div>
                    ${helpTooltip.dom}
                </div>
                <div className="ai-prompt-model-menu-section-heading-action">${section.headingControl ?? null}</div>
            </div>
            <div className="ai-prompt-model-menu-section-controls">
                ${section.controls.map(createModelMenuControl)}
            </div>
            ${section.selectedModelTags ?? null}
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

class ModeAwareModelSelector implements DropdownView {
    readonly dom: HTMLElement

    private activeDropdown: DropdownView | null = null
    private activeMultipleMode: boolean | null = null

    constructor(
        private readonly controls: MultipleModelModeControls,
        private readonly createSingleDropdown: () => DropdownView,
        private readonly createMultiDropdown: () => DropdownView
    ) {
        this.dom = html`<span className="ai-prompt-model-selector-host" contenteditable="false"></span>` as HTMLElement
        this.mountDropdown()
    }

    private mountDropdown(): void {
        const useMultipleModels = this.controls.getUseMultipleModels()
        this.activeDropdown?.destroy?.()
        this.activeDropdown = useMultipleModels
            ? this.createMultiDropdown()
            : this.createSingleDropdown()
        this.activeMultipleMode = useMultipleModels
        this.dom.replaceChildren(this.activeDropdown.dom)
    }

    update(): void {
        if (this.activeMultipleMode !== this.controls.getUseMultipleModels()) {
            this.mountDropdown()
            return
        }

        this.activeDropdown?.update()
    }

    destroy(): void {
        this.activeDropdown?.destroy?.()
    }
}

function createModeAwareModelSelector(
    controls: MultipleModelModeControls,
    createSingleDropdown: () => DropdownView,
    createMultiDropdown: () => DropdownView
): DropdownView {
    return new ModeAwareModelSelector(controls, createSingleDropdown, createMultiDropdown)
}

function createUseMultipleModelsToggle(
    controls: MultipleModelModeControls,
    toggleId: string,
    ariaLabel: string
): DropdownView {
    const handleMouseDown = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
    }
    const svgHostStyle = {
        width: `${modelMenuToggleDimensions.svgWidth}px`,
        height: `${modelMenuToggleDimensions.svgHeight}px`,
        flexBasis: `${modelMenuToggleDimensions.svgWidth}px`,
    }
    const svgHost = html`<span className="ai-prompt-model-menu-toggle-svg-host" aria-hidden="true" style=${svgHostStyle}></span>` as HTMLElement
    const svgEl = select(svgHost)
        .append('svg')
        .attr('class', 'ai-prompt-model-menu-toggle-svg')
        .attr('width', modelMenuToggleDimensions.svgWidth)
        .attr('height', modelMenuToggleDimensions.svgHeight)
        .attr('viewBox', `0 0 ${modelMenuToggleDimensions.svgWidth} ${modelMenuToggleDimensions.svgHeight}`)
        .node() as SVGSVGElement
    const button = html`
        <button
            type="button"
            className="ai-prompt-model-menu-toggle"
            aria-label=${ariaLabel}
            aria-pressed=${String(controls.getUseMultipleModels())}
            contenteditable="false"
            onmousedown=${handleMouseDown}
        >
            <span className="ai-prompt-model-menu-toggle-text">Use multiple models</span>
            ${svgHost}
        </button>
    ` as HTMLButtonElement

    let toggleSwitch: ReturnType<typeof createToggleSwitch>
    const syncButtonState = (): void => {
        const checked = controls.getUseMultipleModels()
        button.setAttribute('aria-pressed', String(checked))
        if (toggleSwitch.getChecked() !== checked) {
            toggleSwitch.setChecked(checked)
        }
    }
    const setMode = (checked: boolean): void => {
        controls.setUseMultipleModels(checked)
        button.setAttribute('aria-pressed', String(checked))
    }

    toggleSwitch = createToggleSwitch(select(svgEl), {
        id: toggleId,
        x: 2,
        y: 2,
        width: modelMenuToggleDimensions.width,
        height: modelMenuToggleDimensions.height,
        checked: controls.getUseMultipleModels(),
        onChange: (checked) => setMode(checked),
    })

    button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const checked = !controls.getUseMultipleModels()
        setMode(checked)
        toggleSwitch.setChecked(checked)
    })

    return {
        dom: button,
        destroy: () => toggleSwitch.destroy(),
        update: syncButtonState,
    }
}

class SelectedModelTagsRow implements DropdownView {
    readonly dom: HTMLElement

    private readonly tagPills: TagPillInstance[] = []
    private readonly unsubscribe: () => void
    private modelLabelsById = new Map<string, string>()
    private currentSignature = ''

    constructor(private readonly controls: SelectedModelTagsControls) {
        this.dom = html`<div className="ai-prompt-selected-model-tags-row" data-visible="false" contenteditable="false"></div>` as HTMLElement
        this.syncModelLabels(aiModelsStore.getData())
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            this.syncModelLabels(storeState.data)
            this.currentSignature = ''
            this.update()
        })
        this.update()
    }

    private syncModelLabels(models: any[]): void {
        const options = transformModelsToOptions(models)
        this.modelLabelsById = new Map(options.map((option: AiModelDropdownOption) => [option.aiModel, option.title]))
    }

    private getModelLabel(modelId: string): string {
        return this.modelLabelsById.get(modelId) ?? modelId.split(':').at(-1) ?? modelId
    }

    private destroyTagPills(): void {
        for (const tagPill of this.tagPills) {
            tagPill.destroy()
        }
        this.tagPills.length = 0
    }

    private createTagHost(): HTMLElement {
        return html`<span className="ai-prompt-selected-model-tag"></span>` as HTMLElement
    }

    private createTagPill(tagHost: HTMLElement, modelId: string, label: string): void {
        const svgEl = select(tagHost)
            .append('svg')
            .attr('class', 'ai-prompt-selected-model-tag-svg')
            .node() as SVGSVGElement

        const tagSvg = select(svgEl)
        const tagPill = createTagPill(tagSvg, {
            id: modelId,
            x: 0,
            y: 0,
            label,
            selected: true,
            closable: true,
            className: 'ai-prompt-selected-model-tag-pill',
            closeAriaLabel: `Remove ${label}`,
            onClose: () => {
                const nextModelIds = this.controls.getSelectedModelIds()
                    .filter((selectedModelId) => selectedModelId !== modelId)
                this.controls.setSelectedModelIds(nextModelIds)
            },
        })
        this.tagPills.push(tagPill)
    }

    update(): void {
        const modelIds = this.controls.getUseMultipleModels()
            ? uniqueNonEmptyValues(this.controls.getSelectedModelIds())
            : []
        const labels = modelIds.map((modelId) => this.getModelLabel(modelId))
        const nextSignature = JSON.stringify({ modelIds, labels })
        if (nextSignature === this.currentSignature) return
        this.currentSignature = nextSignature

        this.destroyTagPills()
        if (modelIds.length === 0) {
            this.dom.setAttribute('data-visible', 'false')
            this.dom.replaceChildren()
            return
        }

        const tagHosts = modelIds.map(() => this.createTagHost())
        this.dom.setAttribute('data-visible', 'true')
        this.dom.replaceChildren(...tagHosts)
        for (const [index, modelId] of modelIds.entries()) {
            this.createTagPill(tagHosts[index]!, modelId, labels[index] ?? modelId)
        }
    }

    destroy(): void {
        this.unsubscribe()
        this.destroyTagPills()
        this.dom.remove()
    }
}

export function createAiPromptInputNodeView(options: AiPromptInputNodeViewOptions) {
    return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => {
        const dom = html`<div className="ai-prompt-input-wrapper"></div>` as HTMLDivElement
        const contextTrayEl = options.createContextTray?.() ?? null
        const contentDOM = html`<div className="ai-prompt-input-content"></div>` as HTMLDivElement
        const controlsEl = html`<div className="ai-prompt-input-controls"></div>` as HTMLDivElement
        contentDOM.setAttribute('data-placeholder', options.placeholderText ?? '')
        applyModelMenuStyleSettings(dom)

        // Build controls adapters that read/write ProseMirror node attrs
        const getSelectedModelIdsForMode = (selectionAttrName: string, scalarAttrName: string): string[] => {
            const selectedModels = parseAiModelSelectionAttr(getNodeAttr(view, getPos, selectionAttrName))
            if (selectedModels.length > 0) return selectedModels

            const scalarModel = getNodeAttr(view, getPos, scalarAttrName) || ''
            return scalarModel ? [scalarModel] : []
        }

        const getSerializedSelectionForMode = (selectionAttrName: string, scalarAttrName: string): string => {
            return serializeAiModelSelectionAttr(getSelectedModelIdsForMode(selectionAttrName, scalarAttrName))
        }

        const setSelectedModelIdsForMode = (
            selectionAttrName: 'aiModels' | 'aiImageModels' | 'aiVideoModels',
            scalarAttrName: 'aiModel' | 'aiImageModel' | 'aiVideoModel',
            modelIds: string[]
        ): void => {
            setNodeAttrs(view, getPos, {
                [scalarAttrName]: modelIds[0] ?? '',
                [selectionAttrName]: serializeAiModelSelectionAttr(uniqueNonEmptyValues(modelIds)),
            })
        }

        const hasEnabledSectionModelMode = (): boolean => {
            return parseBooleanAttr(getNodeAttr(view, getPos, 'useMultipleReasoningModels'))
                || parseBooleanAttr(getNodeAttr(view, getPos, 'useMultipleImageModels'))
                || parseBooleanAttr(getNodeAttr(view, getPos, 'useMultipleVideoModels'))
        }

        const createMultipleModelModeControls = (
            modeAttrName: 'useMultipleReasoningModels' | 'useMultipleImageModels' | 'useMultipleVideoModels',
            selectionAttrName: 'aiModels' | 'aiImageModels' | 'aiVideoModels',
            scalarAttrName: 'aiModel' | 'aiImageModel' | 'aiVideoModel'
        ): MultipleModelModeControls => {
            const getModeAttrs = (useMultipleModels: boolean) => {
                const useMultipleReasoningModels = modeAttrName === 'useMultipleReasoningModels'
                    ? useMultipleModels
                    : getUseMultipleReasoningModels()
                const useMultipleImageModels = modeAttrName === 'useMultipleImageModels'
                    ? useMultipleModels
                    : getUseMultipleImageModels()
                const useMultipleVideoModels = modeAttrName === 'useMultipleVideoModels'
                    ? useMultipleModels
                    : getUseMultipleVideoModels()
                return {
                    useMultipleModels: useMultipleReasoningModels || useMultipleImageModels || useMultipleVideoModels,
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                }
            }

            return {
                getUseMultipleModels: () => parseBooleanAttr(getNodeAttr(view, getPos, modeAttrName))
                    || (parseBooleanAttr(getNodeAttr(view, getPos, 'useMultipleModels')) && !hasEnabledSectionModelMode()),
                setUseMultipleModels: (useMultipleModels: boolean) => setNodeAttrs(view, getPos, {
                    ...getModeAttrs(useMultipleModels),
                    [selectionAttrName]: getSerializedSelectionForMode(selectionAttrName, scalarAttrName),
                }),
            }
        }

        const reasoningMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleReasoningModels',
            'aiModels',
            'aiModel'
        )
        const imageMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleImageModels',
            'aiImageModels',
            'aiImageModel'
        )
        const videoMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleVideoModels',
            'aiVideoModels',
            'aiVideoModel'
        )

        const getUseMultipleReasoningModels = (): boolean => reasoningMultipleModelsControls.getUseMultipleModels()
        const getUseMultipleImageModels = (): boolean => imageMultipleModelsControls.getUseMultipleModels()
        const getUseMultipleVideoModels = (): boolean => videoMultipleModelsControls.getUseMultipleModels()

        const modelControls: AiModelControls = {
            getCurrentAiModel: () => getNodeAttr(view, getPos, 'aiModel') || '',
            setAiModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiModel,
                aiModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentAiModels: () => {
                const selectedModels = parseAiModelSelectionAttr(getNodeAttr(view, getPos, 'aiModels'))
                if (selectedModels.length > 0) return selectedModels
                const aiModel = getNodeAttr(view, getPos, 'aiModel') || ''
                return aiModel ? [aiModel] : []
            },
            setAiModels: (aiModels: string[]) => setNodeAttrs(view, getPos, {
                aiModel: aiModels[0] ?? '',
                aiModels: serializeAiModelSelectionAttr(aiModels),
                useMultipleModels: true,
                useMultipleReasoningModels: true,
            }),
        }

        const imageModelControls: ImageModelControls = {
            getCurrentImageModel: () => getNodeAttr(view, getPos, 'aiImageModel') || '',
            setImageModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiImageModel: aiModel,
                aiImageModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentImageModels: () => {
                const selectedModels = parseAiModelSelectionAttr(getNodeAttr(view, getPos, 'aiImageModels'))
                if (selectedModels.length > 0) return selectedModels
                const aiModel = getNodeAttr(view, getPos, 'aiImageModel') || ''
                return aiModel ? [aiModel] : []
            },
            setImageModels: (aiModels: string[]) => setNodeAttrs(view, getPos, {
                aiImageModel: aiModels[0] ?? '',
                aiImageModels: serializeAiModelSelectionAttr(aiModels),
                useMultipleModels: true,
                useMultipleImageModels: true,
            }),
        }

        const imageControls: ImageSizeControls = {
            getImageGenerationSize: () => getNodeAttr(view, getPos, 'imageGenerationSize') || 'auto',
            setImageGenerationSize: (size: string) => setNodeAttr(view, getPos, 'imageGenerationSize', size),
            getProvider: () => (getNodeAttr(view, getPos, 'aiImageModel') || getNodeAttr(view, getPos, 'aiModel') || '').split(':')[0] || '',
            getCurrentImageModel: () => getNodeAttr(view, getPos, 'aiImageModel') || '',
        }

        const videoModelControls: VideoModelControls = {
            getCurrentVideoModel: () => getNodeAttr(view, getPos, 'aiVideoModel') || '',
            setVideoModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiVideoModel: aiModel,
                aiVideoModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentVideoModels: () => {
                const selectedModels = parseAiModelSelectionAttr(getNodeAttr(view, getPos, 'aiVideoModels'))
                if (selectedModels.length > 0) return selectedModels
                const aiModel = getNodeAttr(view, getPos, 'aiVideoModel') || ''
                return aiModel ? [aiModel] : []
            },
            setVideoModels: (aiModels: string[]) => setNodeAttrs(view, getPos, {
                aiVideoModel: aiModels[0] ?? '',
                aiVideoModels: serializeAiModelSelectionAttr(aiModels),
                useMultipleModels: true,
                useMultipleVideoModels: true,
            }),
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

        const reasoningMultipleModelsToggle = createUseMultipleModelsToggle(
            reasoningMultipleModelsControls,
            'ai-prompt-use-multiple-reasoning-models',
            'Use multiple reasoning models'
        )
        const imageMultipleModelsToggle = createUseMultipleModelsToggle(
            imageMultipleModelsControls,
            'ai-prompt-use-multiple-image-models',
            'Use multiple image models'
        )
        const videoMultipleModelsToggle = createUseMultipleModelsToggle(
            videoMultipleModelsControls,
            'ai-prompt-use-multiple-video-models',
            'Use multiple video models'
        )
        const modelDropdown = createModeAwareModelSelector(
            reasoningMultipleModelsControls,
            () => options.createModelDropdown(modelControls, 'ai-prompt-input'),
            () => options.createModelMultiSelect?.(modelControls, 'ai-prompt-input')
                ?? options.createModelDropdown(modelControls, 'ai-prompt-input')
        )
        const imageModelDropdown = createModeAwareModelSelector(
            imageMultipleModelsControls,
            () => options.createImageModelDropdown(imageModelControls, 'ai-image-model'),
            () => options.createImageModelMultiSelect?.(imageModelControls, 'ai-image-model')
                ?? options.createImageModelDropdown(imageModelControls, 'ai-image-model')
        )
        const imageSizeDropdown = options.createImageSizeDropdown(imageControls, 'ai-image-size')
        const videoModelDropdown = createModeAwareModelSelector(
            videoMultipleModelsControls,
            () => options.createVideoModelDropdown(videoModelControls, 'ai-video-model'),
            () => options.createVideoModelMultiSelect?.(videoModelControls, 'ai-video-model')
                ?? options.createVideoModelDropdown(videoModelControls, 'ai-video-model')
        )
        const videoAspectDropdown = options.createVideoAspectDropdown(videoAspectControls, 'ai-video-aspect')
        const videoResolutionDropdown = options.createVideoResolutionDropdown(videoResolutionControls, 'ai-video-resolution')
        const videoDurationDropdown = options.createVideoDurationDropdown(videoDurationControls, 'ai-video-duration')
        const submitButton = options.createSubmitButton(submitControls)
        const reasoningSelectedModelTags = new SelectedModelTagsRow({
            getUseMultipleModels: reasoningMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIdsForMode('aiModels', 'aiModel'),
            setSelectedModelIds: (modelIds) => setSelectedModelIdsForMode('aiModels', 'aiModel', modelIds),
        })
        const imageSelectedModelTags = new SelectedModelTagsRow({
            getUseMultipleModels: imageMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIdsForMode('aiImageModels', 'aiImageModel'),
            setSelectedModelIds: (modelIds) => setSelectedModelIdsForMode('aiImageModels', 'aiImageModel', modelIds),
        })
        const videoSelectedModelTags = new SelectedModelTagsRow({
            getUseMultipleModels: videoMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIdsForMode('aiVideoModels', 'aiVideoModel'),
            setSelectedModelIds: (modelIds) => setSelectedModelIdsForMode('aiVideoModels', 'aiVideoModel', modelIds),
        })

        const modelDropdowns = [
            reasoningMultipleModelsToggle,
            imageMultipleModelsToggle,
            videoMultipleModelsToggle,
            reasoningSelectedModelTags,
            imageSelectedModelTags,
            videoSelectedModelTags,
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
                headingControl: reasoningMultipleModelsToggle.dom,
                selectedModelTags: reasoningSelectedModelTags.dom,
                controls: [
                    { label: 'Model', control: modelDropdown.dom },
                ],
            },
            {
                title: 'Image model',
                helpText: 'Use this when you want a picture. The model choice decides which image generator will draw it. The second option controls the shape or exact size of the image, depending on what that model supports.',
                headingControl: imageMultipleModelsToggle.dom,
                selectedModelTags: imageSelectedModelTags.dom,
                controls: [
                    { label: 'Model', control: imageModelDropdown.dom },
                    { label: imageSizeControlLabel, control: imageSizeDropdown.dom },
                ],
            },
            {
                title: 'Video model',
                helpText: 'Use this when you want a short video instead of a still image. These options choose the video generator, the frame shape, the output quality, and how long the clip should be.',
                headingControl: videoMultipleModelsToggle.dom,
                selectedModelTags: videoSelectedModelTags.dom,
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

        if (contextTrayEl) dom.appendChild(contextTrayEl)
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
                if (contextTrayEl && (mutation.target === contextTrayEl || contextTrayEl.contains(mutation.target as Node))) {
                    return true
                }
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
                reasoningMultipleModelsToggle.destroy?.()
                imageMultipleModelsToggle.destroy?.()
                videoMultipleModelsToggle.destroy?.()
                reasoningSelectedModelTags.destroy?.()
                imageSelectedModelTags.destroy?.()
                videoSelectedModelTags.destroy?.()
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
                const target = e.target as Node
                const isControl = controlsEl.contains(target)
                const isContextTray = Boolean(contextTrayEl?.contains(target))
                if (isControl) {
                    return true
                }
                if (isContextTray) return true
                return false
            },
        }
    }
}
