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
    createMediaGenerationConfigMatrixView,
    transformModelsToOptions,
    type AiModelDropdownOption,
} from '$src/components/proseMirror/plugins/primitives/aiControls/aiControls.ts'
import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'

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

export function parseMediaGenerationConfigSelectionAttr(value: unknown): MediaGenerationConfigSelectionGroup[] {
    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.flatMap((entry): MediaGenerationConfigSelectionGroup[] => {
            if (!entry || typeof entry !== 'object') return []
            const candidate = entry as Record<string, unknown>
            if (typeof candidate.groupId !== 'string' || !candidate.groupId) return []
            if (!Array.isArray(candidate.modelIds)) return []

            const modelIds = candidate.modelIds
                .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
            const rawValues = candidate.values && typeof candidate.values === 'object'
                ? candidate.values as Record<string, unknown>
                : {}
            const values = Object.fromEntries(
                Object.entries(rawValues)
                    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
            )

            return [{
                groupId: candidate.groupId,
                modelIds: modelIds as MediaGenerationConfigSelectionGroup['modelIds'],
                values,
            }]
        })
    } catch {
        return []
    }
}

export function serializeMediaGenerationConfigSelectionAttr(groups: readonly MediaGenerationConfigSelectionGroup[]): string {
    const normalizedGroups = groups
        .map(group => ({
            groupId: group.groupId,
            modelIds: Array.from(new Set(group.modelIds.filter(modelId => modelId.trim().length > 0))),
            values: Object.fromEntries(
                Object.entries(group.values)
                    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
            ),
        }))
        .filter(group => group.groupId && group.modelIds.length > 0)

    return normalizedGroups.length > 0 ? JSON.stringify(normalizedGroups) : ''
}

function normalizeAiModelSelectionAttr(value: unknown): string {
    return serializeAiModelSelectionAttr(parseAiModelSelectionAttr(value))
}

export function normalizeMediaGenerationConfigSelectionAttr(value: unknown): string {
    return serializeMediaGenerationConfigSelectionAttr(parseMediaGenerationConfigSelectionAttr(value))
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
        imageGenerationConfigGroups: { default: '' },
        aiVideoModel: { default: '' },
        aiVideoModels: { default: '' },
        videoAspectRatio: { default: '' },
        videoResolution: { default: '' },
        videoDuration: { default: '' },
        videoGenerationConfigGroups: { default: '' },
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
                const useMultipleReasoningModels = dom.getAttribute('data-use-multiple-reasoning-models') === 'true' || useLegacyModeFallback
                const useMultipleImageModels = dom.getAttribute('data-use-multiple-image-models') === 'true' || useLegacyModeFallback
                const useMultipleVideoModels = dom.getAttribute('data-use-multiple-video-models') === 'true' || useLegacyModeFallback
                const aiModel = dom.getAttribute('data-ai-model') || ''
                const aiImageModel = dom.getAttribute('data-ai-image-model') || ''
                const aiVideoModel = dom.getAttribute('data-ai-video-model') || ''
                return {
                    aiModel,
                    aiModels: useMultipleReasoningModels
                        ? normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-models'))
                        : serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
                    useMultipleModels: legacyUseMultipleModels,
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    aiImageModel,
                    aiImageModels: useMultipleImageModels
                        ? normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-image-models'))
                        : serializeAiModelSelectionAttr(aiImageModel ? [aiImageModel] : []),
                    imageGenerationSize: dom.getAttribute('data-image-generation-size') || 'auto',
                    imageGenerationConfigGroups: useMultipleImageModels
                        ? normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-image-generation-config-groups'))
                        : '',
                    aiVideoModel,
                    aiVideoModels: useMultipleVideoModels
                        ? normalizeAiModelSelectionAttr(dom.getAttribute('data-ai-video-models'))
                        : serializeAiModelSelectionAttr(aiVideoModel ? [aiVideoModel] : []),
                    videoAspectRatio: dom.getAttribute('data-video-aspect-ratio') || '',
                    videoResolution: dom.getAttribute('data-video-resolution') || '',
                    videoDuration: dom.getAttribute('data-video-duration') || '',
                    videoGenerationConfigGroups: useMultipleVideoModels
                        ? normalizeMediaGenerationConfigSelectionAttr(dom.getAttribute('data-video-generation-config-groups'))
                        : '',
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
        const aiModel = node.attrs.aiModel || ''
        const aiImageModel = node.attrs.aiImageModel || ''
        const aiVideoModel = node.attrs.aiVideoModel || ''
        return [
            'div',
            {
                class: 'ai-prompt-input-wrapper',
                'data-ai-model': aiModel,
                'data-ai-models': useMultipleReasoningModels
                    ? normalizeAiModelSelectionAttr(node.attrs.aiModels)
                    : serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
                'data-use-multiple-models': String(useMultipleReasoningModels || useMultipleImageModels || useMultipleVideoModels),
                'data-use-multiple-reasoning-models': String(useMultipleReasoningModels),
                'data-use-multiple-image-models': String(useMultipleImageModels),
                'data-use-multiple-video-models': String(useMultipleVideoModels),
                'data-ai-image-model': aiImageModel,
                'data-ai-image-models': useMultipleImageModels
                    ? normalizeAiModelSelectionAttr(node.attrs.aiImageModels)
                    : serializeAiModelSelectionAttr(aiImageModel ? [aiImageModel] : []),
                'data-image-generation-size': node.attrs.imageGenerationSize,
                'data-image-generation-config-groups': useMultipleImageModels
                    ? normalizeMediaGenerationConfigSelectionAttr(node.attrs.imageGenerationConfigGroups)
                    : '',
                'data-ai-video-model': aiVideoModel,
                'data-ai-video-models': useMultipleVideoModels
                    ? normalizeAiModelSelectionAttr(node.attrs.aiVideoModels)
                    : serializeAiModelSelectionAttr(aiVideoModel ? [aiVideoModel] : []),
                'data-video-aspect-ratio': node.attrs.videoAspectRatio,
                'data-video-resolution': node.attrs.videoResolution,
                'data-video-duration': node.attrs.videoDuration,
                'data-video-generation-config-groups': useMultipleVideoModels
                    ? normalizeMediaGenerationConfigSelectionAttr(node.attrs.videoGenerationConfigGroups)
                    : '',
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
    ['--ai-prompt-model-menu-info-bubble-width', 'infoBubbleWidth'],
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

function setNodeAttrs(view: EditorView, getPos: () => number | undefined, attrs: Record<string, unknown>): void {
    const pos = getNodeViewPos(getPos)
    if (pos === undefined) return
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== aiPromptInputNodeType) return

    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        ...attrs,
    })
    view.dispatch(tr)
}

function getNodeAttr(view: EditorView, getPos: () => number | undefined, attrName: string): any {
    const pos = getNodeViewPos(getPos)
    if (pos === undefined) return undefined
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== aiPromptInputNodeType) return undefined
    return node.attrs?.[attrName]
}

function getNodeViewPos(getPos: () => number | undefined): number | undefined {
    try {
        return getPos()
    } catch {
        return undefined
    }
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
    private modelIconsById = new Map<string, string>()
    private currentSignature = ''
    private builtConnected = false

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
        this.modelIconsById = new Map(options.map((option: AiModelDropdownOption) => [option.aiModel, option.icon]))
    }

    private getModelLabel(modelId: string): string {
        return this.modelLabelsById.get(modelId) ?? modelId.split(':').at(-1) ?? modelId
    }

    private getModelIcon(modelId: string): string {
        return this.modelIconsById.get(modelId) ?? ''
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
        const tagStyles = settings.aiPromptInput.modelMenu.styles
        const tagPill = createTagPill(tagSvg, {
            id: modelId,
            x: 0,
            y: 0,
            label,
            icon: this.getModelIcon(modelId),
            iconColor: tagStyles.selectedModelTagIconColor,
            textColor: tagStyles.selectedModelTagTextColor,
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
        const connected = this.dom.isConnected
        // Rebuild when the selection changes, or when an earlier build happened while
        // the row was detached. Auto-sized pills measure the rendered label, which
        // only reports a real width once the row is attached to the document.
        if (nextSignature === this.currentSignature && (this.builtConnected || !connected)) return
        this.currentSignature = nextSignature
        this.builtConnected = connected || modelIds.length === 0

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

        const getConfigSelectionGroups = (attrName: 'imageGenerationConfigGroups' | 'videoGenerationConfigGroups'): MediaGenerationConfigSelectionGroup[] => {
            return parseMediaGenerationConfigSelectionAttr(getNodeAttr(view, getPos, attrName))
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

        const setImageConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            const firstImageModel = getSelectedModelIdsForMode('aiImageModels', 'aiImageModel')[0]
            const firstImageGroup = groups.find(group => firstImageModel && group.modelIds.includes(firstImageModel))
            setNodeAttrs(view, getPos, {
                imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                ...(firstImageGroup?.values.imageSize ? { imageGenerationSize: firstImageGroup.values.imageSize } : {}),
            })
        }

        const setVideoConfigSelectionGroups = (groups: MediaGenerationConfigSelectionGroup[]): void => {
            const firstVideoModel = getSelectedModelIdsForMode('aiVideoModels', 'aiVideoModel')[0]
            const firstVideoGroup = groups.find(group => firstVideoModel && group.modelIds.includes(firstVideoModel))
            setNodeAttrs(view, getPos, {
                videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(groups),
                ...(firstVideoGroup?.values.aspectRatio ? { videoAspectRatio: firstVideoGroup.values.aspectRatio } : {}),
                ...(firstVideoGroup?.values.resolution ? { videoResolution: firstVideoGroup.values.resolution } : {}),
                ...(firstVideoGroup?.values.duration ? { videoDuration: firstVideoGroup.values.duration } : {}),
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
            scalarAttrName: 'aiModel' | 'aiImageModel' | 'aiVideoModel',
            clearAttrsWhenDisabled: Record<string, unknown> = {},
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
                    [selectionAttrName]: useMultipleModels
                        ? getSerializedSelectionForMode(selectionAttrName, scalarAttrName)
                        : serializeAiModelSelectionAttr(uniqueNonEmptyValues([getNodeAttr(view, getPos, scalarAttrName) || ''])),
                    ...(!useMultipleModels ? clearAttrsWhenDisabled : {}),
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
            'aiImageModel',
            { imageGenerationConfigGroups: '' },
        )
        const videoMultipleModelsControls = createMultipleModelModeControls(
            'useMultipleVideoModels',
            'aiVideoModels',
            'aiVideoModel',
            { videoGenerationConfigGroups: '' },
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
                if (getUseMultipleReasoningModels()) return []
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
                if (getUseMultipleImageModels()) return []
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

        const videoModelControls: VideoModelControls = {
            getCurrentVideoModel: () => getNodeAttr(view, getPos, 'aiVideoModel') || '',
            setVideoModel: (aiModel: string) => setNodeAttrs(view, getPos, {
                aiVideoModel: aiModel,
                aiVideoModels: serializeAiModelSelectionAttr(aiModel ? [aiModel] : []),
            }),
            getCurrentVideoModels: () => {
                const selectedModels = parseAiModelSelectionAttr(getNodeAttr(view, getPos, 'aiVideoModels'))
                if (selectedModels.length > 0) return selectedModels
                if (getUseMultipleVideoModels()) return []
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
        const imageConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'image',
            getUseMultipleModels: imageMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIdsForMode('aiImageModels', 'aiImageModel'),
            setSelectedModelIds: (modelIds) => setSelectedModelIdsForMode('aiImageModels', 'aiImageModel', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('imageGenerationConfigGroups'),
            setConfigGroups: setImageConfigSelectionGroups,
        })
        const videoModelDropdown = createModeAwareModelSelector(
            videoMultipleModelsControls,
            () => options.createVideoModelDropdown(videoModelControls, 'ai-video-model'),
            () => options.createVideoModelMultiSelect?.(videoModelControls, 'ai-video-model')
                ?? options.createVideoModelDropdown(videoModelControls, 'ai-video-model')
        )
        const videoConfigMatrix = createMediaGenerationConfigMatrixView({
            mediaType: 'video',
            getUseMultipleModels: videoMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIdsForMode('aiVideoModels', 'aiVideoModel'),
            setSelectedModelIds: (modelIds) => setSelectedModelIdsForMode('aiVideoModels', 'aiVideoModel', modelIds),
            getConfigGroups: () => getConfigSelectionGroups('videoGenerationConfigGroups'),
            setConfigGroups: setVideoConfigSelectionGroups,
        })
        const submitButton = options.createSubmitButton(submitControls)
        const reasoningSelectedModelTags = new SelectedModelTagsRow({
            getUseMultipleModels: reasoningMultipleModelsControls.getUseMultipleModels,
            getSelectedModelIds: () => getSelectedModelIdsForMode('aiModels', 'aiModel'),
            setSelectedModelIds: (modelIds) => setSelectedModelIdsForMode('aiModels', 'aiModel', modelIds),
        })

        const modelDropdowns = [
            reasoningMultipleModelsToggle,
            imageMultipleModelsToggle,
            videoMultipleModelsToggle,
            reasoningSelectedModelTags,
            modelDropdown,
            imageModelDropdown,
            imageConfigMatrix,
            videoModelDropdown,
            videoConfigMatrix,
        ]

        const modelLabelUpdaters: Array<() => void> = []
        const createModeAwareModelControlLabel = (controls: MultipleModelModeControls): HTMLElement => {
            const label = html`<span className="ai-prompt-model-menu-control-label"></span>` as HTMLElement
            const updateLabel = (): void => {
                label.textContent = controls.getUseMultipleModels() ? 'Models' : 'Model'
            }
            updateLabel()
            modelLabelUpdaters.push(updateLabel)
            return label
        }

        const reasoningModelLabel = createModeAwareModelControlLabel(reasoningMultipleModelsControls)
        const imageModelLabel = createModeAwareModelControlLabel(imageMultipleModelsControls)
        const videoModelLabel = createModeAwareModelControlLabel(videoMultipleModelsControls)

        let modelMenu: BubbleMenu | null = null
        let modelMenuTrigger: HTMLButtonElement | null = null
        const getModelMenuPosition = () => {
            if (!modelMenuTrigger) return null
            return {
                targetRect: modelMenuTrigger.getBoundingClientRect(),
                placement: 'above' as const,
                horizontalAlignment: 'end' as const,
                clampToParent: false,
            }
        }
        const scheduleModelMenuReposition = (): void => {
            if (!modelMenu?.isVisible) return
            const reposition = (): void => {
                if (!modelMenu?.isVisible) return
                const position = getModelMenuPosition()
                if (!position) return
                modelMenu.reposition(position)
            }
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(reposition)
                return
            }
            reposition()
        }

        const updateModelDropdowns = (): void => {
            for (const dropdown of modelDropdowns) {
                dropdown.update()
            }
            for (const updateLabel of modelLabelUpdaters) {
                updateLabel()
            }
            scheduleModelMenuReposition()
        }

        const modelMenuContent = createModelMenuContent([
            {
                title: 'Reasoning model',
                helpText: 'Reasoning model works on your prompt, resolves the most relevant items on canvas, crafts a detailed prompt for media model and passed it to the media model with the reference items included.',
                headingControl: reasoningMultipleModelsToggle.dom,
                selectedModelTags: reasoningSelectedModelTags.dom,
                controls: [
                    { label: reasoningModelLabel, control: modelDropdown.dom },
                ],
            },
            {
                title: 'Image model',
                helpText: 'In this section you can configure image generation options. The model choice decides which image generator will draw it. The second option controls the shape or exact size of the image, depending on what that model supports.',
                headingControl: imageMultipleModelsToggle.dom,
                controls: [
                    { label: imageModelLabel, control: imageModelDropdown.dom },
                    { label: '', control: imageConfigMatrix.dom },
                ],
            },
            {
                title: 'Video model',
                helpText: 'In this section you can configure video generation options. These options choose the video generator, the frame shape, the output quality, and how long the clip should be.',
                headingControl: videoMultipleModelsToggle.dom,
                controls: [
                    { label: videoModelLabel, control: videoModelDropdown.dom },
                    { label: '', control: videoConfigMatrix.dom },
                ],
            },
        ])

        const toggleModelMenu = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()

            if (!modelMenu) return

            if (modelMenu.isVisible) {
                modelMenu.hide()
                return
            }

            updateModelDropdowns()
            const position = getModelMenuPosition()
            if (!position) return
            modelMenu.show('modelSettings', position)
        }

        modelMenuTrigger = createModelMenuTrigger(toggleModelMenu)

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
                modelDropdown.destroy?.()
                imageModelDropdown.destroy?.()
                imageConfigMatrix.destroy?.()
                videoModelDropdown.destroy?.()
                videoConfigMatrix.destroy?.()
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
