import {
    sendIcon,
    chevronDownIcon,
    gptAvatarIcon,
    claudeIcon,
    geminiIcon,
    stabilityIcon,
    bytedanceIcon,
    imageIcon,
    appendSvgPathIcon,
} from '@lixpi/ui-kit/svg'

// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { html } from '$src/utils/domTemplates.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import {
    createSlidingDropdown,
    type SlidingDropdownInstance,
    type SlidingDropdownOptionRenderInstance,
    type SlidingDropdownOptionRenderState,
} from '@lixpi/ui-kit/components/sliding-dropdown'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
} from '@lixpi/ui-kit/components/sliding-switch'
import { createToggleSwitch } from '@lixpi/ui-kit/components/toggle-switch'
import {
    createHelpTooltip,
    type HelpTooltipInstance,
} from '@lixpi/ui-kit/components/help-tooltip'
import { settings } from '$src/settings.ts'
import { createModelConfigurationRow } from '$src/components/aiModelControls/modelConfigurationRow.ts'

import {
    GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT,
    MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT,
    type DefaultAiModelCapability,
    type MediaGenerationConfigControl,
    type MediaGenerationConfigControlKey,
    type MediaGenerationConfigGroup,
    type MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'

export type AiModelDropdownOption = {
    title: string
    icon: string
    color: string
    aiModel: string
    provider: string
    providerTitle: string
    model: string
    tags: string[]
}

type AiModelControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
    getUnavailableAiModels?: () => string[]
}

type SubmitControls = {
    onSubmit: () => void
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
    getUnavailableImageModels?: () => string[]
}

type VideoModelControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
    getUnavailableVideoModels?: () => string[]
}

// Shared shape for the three video option dropdowns (aspect / resolution /
// duration) — same generator pattern as image size but reading a different
// option list off the selected video model.
type VideoOptionControls = {
    getValue: () => string
    setValue: (value: string) => void
    getProvider?: () => string
    getCurrentVideoModel?: () => string
}

export type MediaGenerationConfigMatrixControls = {
    mediaType: 'image' | 'video'
    getSelectedModelIds: () => string[]
    setSelectedModelIds: (modelIds: string[]) => void
    getConfigGroups: () => MediaGenerationConfigSelectionGroup[]
    setConfigGroups: (groups: MediaGenerationConfigSelectionGroup[]) => void
    createModelDropdown: (modelIndex: number) => {
        dom: HTMLElement
        update: () => void
        destroy?: () => void
    }
}

export type MediaGenerationConfigMatrixViewInstance = {
    dom: HTMLElement
    update: () => void
    destroy: () => void
}

type RenderedMediaConfigGroup = MediaGenerationConfigGroup & {
    selectedModelIds: string[]
}

type PendingMediaConfigModelDropdown = {
    host: HTMLElement
    modelIndex: number
}

type MountedMediaConfigControl = {
    groupId: string
    modelId: string
    control: MediaGenerationConfigControl
    setValue: (value: string) => void
    destroy: () => void
}

type PendingMediaConfigSvgControl = {
    host: HTMLElement
    group: RenderedMediaConfigGroup
    control: MediaGenerationConfigControl
    selectedValue: string
}

const MEDIA_CONFIG_SEGMENTED_CONTROL_HEIGHT = 40
const MEDIA_CONFIG_CONTROL_FALLBACK_WIDTH = 320
const MEDIA_CONFIG_HELP_TRIGGER_SIZE = 12
const MEDIA_CONFIG_OPTION_HELP_GAP = 4
const MEDIA_CONFIG_OPTION_FALLBACK_CHARACTER_WIDTH_RATIO = 0.6
const MEDIA_CONFIG_TOGGLE_DIMENSIONS = {
    width: 30,
    height: 18,
    svgWidth: 34,
    svgHeight: 22,
}

function isAspectRatioValue(value: string): boolean {
    return /^\d+:\d+$/.test(value)
}

function isPixelDimensionsValue(value: string): boolean {
    return /^\d+\s*[x×]\s*\d+$/i.test(value)
}

function isDimensionValueControl(control: MediaGenerationConfigControl): boolean {
    if (control.kind === 'aspect-ratio' || control.key === 'aspectRatio' || control.key === 'resolution') return true
    if (control.key !== 'imageSize') return false
    return control.options.some(option => (
        isAspectRatioValue(option.value) || isPixelDimensionsValue(option.value)
    ))
}

function usesSlidingDropdown(control: MediaGenerationConfigControl): boolean {
    return isDimensionValueControl(control) || control.kind === 'duration' || control.key === 'duration'
}

function rendersDimensionGlyph(
    mediaType: MediaGenerationConfigMatrixControls['mediaType'],
    control: MediaGenerationConfigControl,
): boolean {
    return isDimensionValueControl(control)
        && !(mediaType === 'video' && control.key === 'resolution')
}

function slidingDropdownOptions(control: MediaGenerationConfigControl): MediaGenerationConfigControl['options'] {
    return control.options.map(option => ({
        ...option,
        label: option.label || option.value,
    }))
}

function optionHelpText(
    group: RenderedMediaConfigGroup,
    control: MediaGenerationConfigControl,
    option: MediaGenerationConfigControl['options'][number],
): string | undefined {
    const description = option.description?.trim()
    if (description) return description
    if (group.provider !== 'Google') return undefined
    return GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT[control.key]?.[option.value]
}

class MediaDimensionsDropdownOptionView implements SlidingDropdownOptionRenderInstance<string> {
    private readonly group: any
    private readonly glyph: any
    private readonly adaptiveLabel: any
    private readonly label: any
    private readonly helpTooltip: HelpTooltipInstance | null
    private readonly helpTooltipHost: any | null
    private value = ''
    private optionHeight = 0
    private labelText = ''

    constructor(
        parent: any,
        state: SlidingDropdownOptionRenderState<string>,
        private readonly getFallbackProportionValue: () => string,
        description: string | undefined,
    ) {
        const dropdownStyles = settings.aiModelControls.styles.dimensionsDropdown
        const glyphStyles = settings.aiModelControls.styles.dimensionsGlyph
        this.group = parent.append('g')
            .attr('class', 'ai-media-config-dimensions-dropdown-option')
            .attr('pointer-events', 'none')
        this.glyph = this.group.append('rect')
            .attr('class', 'ai-media-config-dimensions-dropdown-glyph')
            .attr('fill', 'none')
            .attr('rx', glyphStyles.cornerRadius)
            .attr('ry', glyphStyles.cornerRadius)
            .attr('stroke-width', glyphStyles.strokeWidth)
        this.adaptiveLabel = this.group.append('text')
            .attr('class', 'ai-media-config-dimensions-dropdown-adaptive-label')
            .attr('font-size', glyphStyles.adaptiveLabelFontSize)
            .attr('font-weight', glyphStyles.adaptiveLabelFontWeight)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text('A')
        this.label = this.group.append('text')
            .attr('class', 'ai-media-config-dimensions-dropdown-label')
            .attr('font-size', dropdownStyles.valueFontSize)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')

        if (description) {
            this.helpTooltip = createHelpTooltip({
                label: `${state.option.label} details`,
                text: description,
                className: 'ai-media-config-option-help',
                triggerSize: MEDIA_CONFIG_HELP_TRIGGER_SIZE,
            })
            this.helpTooltipHost = this.group.append('foreignObject')
                .attr('class', 'ai-media-config-option-help-host')
                .attr('width', MEDIA_CONFIG_HELP_TRIGGER_SIZE)
                .attr('height', MEDIA_CONFIG_HELP_TRIGGER_SIZE)
                .attr('overflow', 'visible')
                .attr('pointer-events', 'all')
            this.helpTooltipHost.append(() => this.helpTooltip!.dom)
        } else {
            this.helpTooltip = null
            this.helpTooltipHost = null
        }

        this.render(state)
    }

    private measuredLabelWidth(): number {
        try {
            const width = this.label.node?.()?.getComputedTextLength?.() ?? 0
            if (Number.isFinite(width) && width > 0) return width
        } catch {
            // Detached and non-rendering SVG environments cannot expose text geometry.
        }

        return this.labelText.length
            * settings.aiModelControls.styles.dimensionsDropdown.valueFontSize
            * MEDIA_CONFIG_OPTION_FALLBACK_CHARACTER_WIDTH_RATIO
    }

    private proportionFor(value: string): number | null {
        const separator = isAspectRatioValue(value) ? ':' : isPixelDimensionsValue(value) ? /[x×]/i : null
        if (!separator) return null
        const [widthValue, heightValue] = value.split(separator).map(Number)
        if (!widthValue || !heightValue) return null
        return widthValue / heightValue
    }

    private glyphSize(value: string): { width: number; height: number; adaptive: boolean } {
        const glyphStyles = settings.aiModelControls.styles.dimensionsGlyph
        const adaptive = value === 'adaptive' || value === 'auto'
        if (adaptive) {
            return {
                width: glyphStyles.adaptiveSize,
                height: glyphStyles.adaptiveSize,
                adaptive,
            }
        }

        const ratio = this.proportionFor(value)
            ?? this.proportionFor(this.getFallbackProportionValue())
            ?? 1
        const width = Math.sqrt(glyphStyles.targetArea * ratio)
        const height = width / ratio
        const scale = Math.min(1, glyphStyles.maxDimension / Math.max(width, height))

        return {
            width: width * scale,
            height: height * scale,
            adaptive,
        }
    }

    resize(x: number, y: number, width: number, height = this.optionHeight): void {
        this.optionHeight = height
        const dropdownStyles = settings.aiModelControls.styles.dimensionsDropdown
        const glyphStyles = settings.aiModelControls.styles.dimensionsGlyph
        const contentCenterY = y + height * dropdownStyles.contentCenterYRatio
        const size = this.glyphSize(this.value)
        const availableColumnWidth = Math.max(0, width - dropdownStyles.horizontalPadding * 2)
        const glyphColumnWidth = Math.min(dropdownStyles.glyphColumnWidth, availableColumnWidth)
        const glyphStrokeInset = glyphStyles.strokeWidth / 2
        const glyphColumnStartX = x + dropdownStyles.horizontalPadding + glyphStrokeInset
        const glyphCenterX = glyphColumnStartX + glyphColumnWidth / 2
        const labelX = glyphColumnStartX
            + glyphColumnWidth
            + glyphStrokeInset
            + dropdownStyles.glyphValueGap

        this.glyph
            .attr('x', glyphCenterX - size.width / 2)
            .attr('y', contentCenterY - size.height / 2)
            .attr('width', size.width)
            .attr('height', size.height)
        this.adaptiveLabel
            .attr('x', glyphCenterX)
            .attr('y', contentCenterY)
        this.label
            .attr('x', labelX)
            .attr('y', contentCenterY)
            .attr('text-anchor', 'start')
        this.helpTooltipHost
            ?.attr('x', labelX + this.measuredLabelWidth() + MEDIA_CONFIG_OPTION_HELP_GAP)
            .attr('y', contentCenterY - MEDIA_CONFIG_HELP_TRIGGER_SIZE / 2)
    }

    render(state: SlidingDropdownOptionRenderState<string>): void {
        const optionStyles = settings.slidingDropdown.styles.option
        const color = state.disabled
            ? optionStyles.disabledTextColor
            : state.selected || state.hovered ? optionStyles.activeTextColor : optionStyles.textColor
        const size = this.glyphSize(state.option.value)
        this.value = state.option.value
        this.glyph
            .attr('stroke', color)
            .attr('stroke-dasharray', size.adaptive ? '3 2' : null)
        this.adaptiveLabel
            .attr('display', size.adaptive ? null : 'none')
            .attr('fill', color)
        this.labelText = state.option.label
        this.label
            .attr('fill', color)
            .attr('font-weight', state.selected ? optionStyles.selectedFontWeight : optionStyles.fontWeight)
            .text(this.labelText)
        this.resize(state.x, state.y, state.width, state.height)
    }

    destroy(): void {
        this.helpTooltip?.destroy()
        this.group.remove()
    }
}

class MediaTextDropdownOptionView implements SlidingDropdownOptionRenderInstance<string> {
    private readonly group: any
    private readonly label: any
    private readonly helpTooltip: HelpTooltipInstance | null
    private readonly helpTooltipHost: any | null
    private optionHeight = 0
    private labelText = ''

    constructor(
        parent: any,
        state: SlidingDropdownOptionRenderState<string>,
        description: string | undefined,
    ) {
        const dropdownStyles = settings.aiModelControls.styles.dimensionsDropdown
        this.group = parent.append('g')
            .attr('class', 'ai-media-config-text-dropdown-option')
            .attr('pointer-events', 'none')
        this.label = this.group.append('text')
            .attr('class', 'ai-media-config-text-dropdown-label')
            .attr('font-size', dropdownStyles.valueFontSize)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'central')

        if (description) {
            this.helpTooltip = createHelpTooltip({
                label: `${state.option.label} details`,
                text: description,
                className: 'ai-media-config-option-help',
                triggerSize: MEDIA_CONFIG_HELP_TRIGGER_SIZE,
            })
            // The shared tooltip is HTML-backed. Keeping its trigger in the SVG option through
            // foreignObject makes it follow the sliding dropdown when that SVG is portaled.
            this.helpTooltipHost = this.group.append('foreignObject')
                .attr('class', 'ai-media-config-option-help-host')
                .attr('width', MEDIA_CONFIG_HELP_TRIGGER_SIZE)
                .attr('height', MEDIA_CONFIG_HELP_TRIGGER_SIZE)
                .attr('overflow', 'visible')
                .attr('pointer-events', 'all')
            this.helpTooltipHost.append(() => this.helpTooltip!.dom)
        } else {
            this.helpTooltip = null
            this.helpTooltipHost = null
        }

        this.render(state)
    }

    private measuredLabelWidth(): number {
        try {
            const width = this.label.node?.()?.getComputedTextLength?.() ?? 0
            if (Number.isFinite(width) && width > 0) return width
        } catch {
            // Detached and non-rendering SVG environments cannot expose text geometry.
        }

        return this.labelText.length
            * settings.aiModelControls.styles.dimensionsDropdown.valueFontSize
            * MEDIA_CONFIG_OPTION_FALLBACK_CHARACTER_WIDTH_RATIO
    }

    resize(x: number, y: number, _width: number, height = this.optionHeight): void {
        this.optionHeight = height
        const dropdownStyles = settings.aiModelControls.styles.dimensionsDropdown
        const contentX = x + dropdownStyles.horizontalPadding
        const centerY = y + height * dropdownStyles.contentCenterYRatio
        this.label
            .attr('x', contentX)
            .attr('y', centerY)
        this.helpTooltipHost
            ?.attr('x', contentX + this.measuredLabelWidth() + MEDIA_CONFIG_OPTION_HELP_GAP)
            .attr('y', centerY - MEDIA_CONFIG_HELP_TRIGGER_SIZE / 2)
    }

    render(state: SlidingDropdownOptionRenderState<string>): void {
        const optionStyles = settings.slidingDropdown.styles.option
        const color = state.disabled
            ? optionStyles.disabledTextColor
            : state.selected || state.hovered ? optionStyles.activeTextColor : optionStyles.textColor
        this.labelText = state.option.label
        this.label
            .attr('fill', color)
            .attr('font-weight', state.selected ? optionStyles.selectedFontWeight : optionStyles.fontWeight)
            .text(this.labelText)
        this.resize(state.x, state.y, state.width, state.height)
    }

    destroy(): void {
        this.helpTooltip?.destroy()
        this.group.remove()
    }
}

function findMatrixControlForModel(
    mediaType: 'image' | 'video',
    modelId: string | undefined,
    controlKey: MediaGenerationConfigControlKey,
): MediaGenerationConfigControl | undefined {
    if (!modelId) return undefined
    const matrix = aiModelsStore.getMediaGenerationConfigMatrix()
    const group = matrix.groups.find(candidate =>
        candidate.mediaType === mediaType && candidate.modelIds.some(candidateModelId => candidateModelId === modelId)
    )
    return group?.controls.find(control => control.key === controlKey)
}

function matrixControlOptions(
    control: MediaGenerationConfigControl | undefined,
    fallbackTitle: string,
    fallbackValue = '',
): Array<{ title: string; value: string }> {
    const options = control?.options.map(option => ({
        title: option.label,
        value: option.value,
    })) ?? []
    return options.length > 0 ? options : [{ title: fallbackTitle, value: fallbackValue }]
}

const AI_AVATAR_ICONS: Record<string, string> = {
    gptAvatarIcon,
    claudeIcon,
    geminiIcon,
    stabilityIcon,
    bytedanceIcon,
}

// Picks the option matching the API-configured default model for a capability.
// The API owns the default value (and its fallback) — the UI only renders it, so
// there is no UI-side fallback here. Returns undefined when the API default is not
// present in the available options.
function pickDefaultModelOption(
    options: AiModelDropdownOption[],
    capability: DefaultAiModelCapability,
): AiModelDropdownOption | undefined {
    const defaultModelId = aiModelsStore.getDefaultModelId(capability)
    return options.find(option => option.aiModel === defaultModelId)
}

export function transformModelsToOptions(models: any[]): AiModelDropdownOption[] {
    return models.map((aiModel: any) => ({
        title: aiModel.shortTitle,
        icon: AI_AVATAR_ICONS[aiModel.iconName],
        color: aiModel.color,
        aiModel: `${aiModel.provider}:${aiModel.model}`,
        provider: aiModel.provider,
        providerTitle: aiModel.providerTitle ?? aiModel.provider,
        model: aiModel.model,
        tags: aiModel.modalities?.map((m: any) => m.shortTitle) || []
    }))
}

function getModelOptionsSignature(models: any[]): string {
    return JSON.stringify(models.map(model => ({
        provider: model.provider,
        providerTitle: model.providerTitle,
        model: model.model,
        shortTitle: model.shortTitle,
        iconName: model.iconName,
        color: model.color,
        sortingPosition: model.sortingPosition,
        modalities: model.modalities,
    })))
}

function modelHasGenerationModality(
    model: any,
    modality: 'image_generation' | 'video_generation',
): boolean {
    return model.modalities?.some((entry: any) => (entry.modality || entry) === modality) ?? false
}

export function getModelOptionsForCapability(
    models: any[],
    capability: DefaultAiModelCapability,
): AiModelDropdownOption[] {
    const filteredModels = models.filter((model: any) => {
        const generatesImages = modelHasGenerationModality(model, 'image_generation')
        const generatesVideo = modelHasGenerationModality(model, 'video_generation')
        if (capability === 'image') return generatesImages
        if (capability === 'video') return generatesVideo
        return !generatesImages && !generatesVideo
    })
    return transformModelsToOptions(filteredModels)
}

function modelSelectorLabel(option: AiModelDropdownOption): string {
    if (!option.providerTitle) return option.title
    if (!option.title) return option.providerTitle
    return `${option.providerTitle}: ${option.title}`
}

type ModelSlidingDropdownControls = {
    getCurrentModel: () => string
    setModel: (modelId: string) => void
    getUnavailableModelIds: () => string[]
}

type ModelSlidingDropdownConfig = {
    id: string
    ariaLabel: string
    capability: DefaultAiModelCapability
    placeholderTitle: string
    placeholderIcon: string
    controls: ModelSlidingDropdownControls
}

class ModelSlidingDropdownOptionView implements SlidingDropdownOptionRenderInstance<string> {
    private readonly group: any
    private readonly iconGroup: any
    private readonly label: any
    private readonly providerLabel: any
    private readonly modelLabel: any
    private readonly hasIcon: boolean
    private optionHeight = 0

    constructor(
        parent: any,
        state: SlidingDropdownOptionRenderState<string>,
        private readonly option: AiModelDropdownOption,
    ) {
        const styles = settings.aiModelControls.styles.modelDropdown
        this.group = parent.append('g')
            .attr('class', 'ai-model-sliding-dropdown-option')
            .attr('pointer-events', 'none')
        this.iconGroup = this.group.append('g')
            .attr('class', 'ai-model-sliding-dropdown-option-icon')
        this.hasIcon = Boolean(option.icon)
        if (option.icon) {
            appendSvgPathIcon(this.iconGroup, option.icon, {
                x: 0,
                y: 0,
                size: styles.iconSize,
                fill: settings.slidingDropdown.styles.option.textColor,
            })
        }
        this.label = this.group.append('text')
            .attr('class', 'ai-model-sliding-dropdown-option-label')
            .attr('font-size', styles.valueFontSize)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'central')
        this.providerLabel = this.label.append('tspan')
            .attr('class', 'ai-model-sliding-dropdown-option-provider')
        this.modelLabel = this.label.append('tspan')
            .attr('class', 'ai-model-sliding-dropdown-option-model')
        this.render(state)
    }

    resize(x: number, y: number, _width: number, height = this.optionHeight): void {
        this.optionHeight = height
        const styles = settings.aiModelControls.styles.modelDropdown
        const contentX = x + styles.horizontalPadding
        const centerY = y + height / 2
        this.iconGroup.attr(
            'transform',
            `translate(${contentX}, ${centerY - styles.iconSize / 2})`,
        )
        this.label
            .attr('x', contentX + (this.hasIcon ? styles.iconSize + styles.iconLabelGap : 0))
            .attr('y', centerY)
    }

    render(state: SlidingDropdownOptionRenderState<string>): void {
        const optionStyles = settings.slidingDropdown.styles.option
        const iconColor = state.disabled
            ? optionStyles.disabledTextColor
            : state.selected || state.hovered ? optionStyles.activeTextColor : optionStyles.textColor
        const providerColor = state.disabled
            ? optionStyles.disabledTextColor
            : optionStyles.textColor
        const modelColor = state.disabled
            ? optionStyles.disabledTextColor
            : optionStyles.activeTextColor
        this.iconGroup
            .attr('display', this.hasIcon ? null : 'none')
            .selectAll('path')
            .attr('fill', iconColor)
        this.label
            .attr('font-weight', state.selected ? optionStyles.selectedFontWeight : optionStyles.fontWeight)
        this.providerLabel
            .attr('display', this.option.providerTitle ? null : 'none')
            .attr('fill', providerColor)
            .text(this.option.providerTitle ? `${this.option.providerTitle}:` : '')
        this.modelLabel
            .attr('fill', modelColor)
            .text(`${this.option.providerTitle ? ' ' : ''}${this.option.title}`)
        this.resize(state.x, state.y, state.width, state.height)
    }

    destroy(): void {
        this.group.remove()
    }
}

class ModelSlidingDropdownView {
    readonly dom: HTMLElement

    private readonly unsubscribe: () => void
    private dropdown: SlidingDropdownInstance<string> | null = null
    private modelOptions: AiModelDropdownOption[] = []
    private modelOptionsById = new Map<string, AiModelDropdownOption>()
    private renderedOptionsSignature = ''
    private defaultSelectionTimer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly config: ModelSlidingDropdownConfig) {
        this.dom = html`<span className="ai-model-sliding-dropdown-host" contenteditable="false"></span>` as HTMLElement
        this.syncModels(aiModelsStore.getData())
        this.mountDropdown()
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            const nextSignature = getModelOptionsSignature(storeState.data)
            if (nextSignature === this.renderedOptionsSignature) return
            this.syncModels(storeState.data)
            this.mountDropdown()
        })
    }

    private syncModels(models: any[]): void {
        this.renderedOptionsSignature = getModelOptionsSignature(models)
        this.modelOptions = getModelOptionsForCapability(models, this.config.capability)
        this.modelOptionsById = new Map(this.modelOptions.map(option => [option.aiModel, option]))
    }

    private selectedOption(): AiModelDropdownOption {
        const currentModel = this.config.controls.getCurrentModel()
        const currentOption = this.modelOptionsById.get(currentModel)
        if (currentOption) return currentOption
        if (!currentModel) {
            const defaultOption = pickDefaultModelOption(this.modelOptions, this.config.capability)
            if (defaultOption) {
                this.scheduleDefaultSelection(defaultOption.aiModel)
                return defaultOption
            }
        }
        return {
            title: this.config.placeholderTitle,
            icon: this.config.placeholderIcon,
            color: '',
            aiModel: '',
            provider: '',
            providerTitle: '',
            model: '',
            tags: [],
        }
    }

    private scheduleDefaultSelection(modelId: string): void {
        if (this.defaultSelectionTimer !== null) return
        this.defaultSelectionTimer = setTimeout(() => {
            this.defaultSelectionTimer = null
            if (!this.config.controls.getCurrentModel()) this.config.controls.setModel(modelId)
        }, 0)
    }

    private dropdownOptions(selectedOption: AiModelDropdownOption) {
        const unavailableModelIds = new Set(this.config.controls.getUnavailableModelIds())
        const options = this.modelOptions.map(option => ({
            label: modelSelectorLabel(option),
            value: option.aiModel,
            disabled: unavailableModelIds.has(option.aiModel) && option.aiModel !== selectedOption.aiModel,
            ariaLabel: modelSelectorLabel(option),
        }))
        if (selectedOption.aiModel) return options
        return [{
            label: modelSelectorLabel(selectedOption),
            value: '',
            ariaLabel: modelSelectorLabel(selectedOption),
        }, ...options]
    }

    private mountDropdown(): void {
        this.dropdown?.destroy()
        this.dropdown = null
        this.dom.replaceChildren()

        const selectedOption = this.selectedOption()
        const optionData = new Map(this.modelOptionsById)
        if (!selectedOption.aiModel) optionData.set('', selectedOption)
        const options = this.dropdownOptions(selectedOption)
        if (options.length === 0) return

        const styles = settings.aiModelControls.styles.modelDropdown
        const svg = select(this.dom)
            .append('svg')
            .attr('class', 'ai-model-sliding-dropdown-svg')
        this.dropdown = createSlidingDropdown(svg, {
            id: this.config.id,
            x: 0,
            y: 0,
            width: styles.width,
            height: styles.height,
            optionHorizontalPadding: styles.horizontalPadding,
            options,
            selectedValue: selectedOption.aiModel,
            ariaLabel: this.config.ariaLabel,
            observeParentResize: false,
            renderOption: (parent, state) => new ModelSlidingDropdownOptionView(
                parent,
                state,
                optionData.get(state.option.value) ?? selectedOption,
            ),
            onChange: value => {
                if (value) this.config.controls.setModel(value)
            },
        })
    }

    update(): void {
        const selectedOption = this.selectedOption()
        const unavailableSignature = this.config.controls.getUnavailableModelIds().toSorted().join('|')
        const nextSignature = `${this.renderedOptionsSignature}:${unavailableSignature}`
        if (this.dom.dataset.optionsSignature !== nextSignature
            || !this.dropdown
            || !selectedOption.aiModel
            || !this.modelOptionsById.has(selectedOption.aiModel)) {
            this.dom.dataset.optionsSignature = nextSignature
            this.mountDropdown()
            return
        }
        this.dropdown.setValue(selectedOption.aiModel)
        this.dropdown.render()
    }

    destroy(): void {
        if (this.defaultSelectionTimer !== null) clearTimeout(this.defaultSelectionTimer)
        this.unsubscribe()
        this.dropdown?.destroy()
        this.dom.remove()
    }
}

export function createGenericAiModelDropdown(
    controls: AiModelControls,
    dropdownId: string
) {
    return new ModelSlidingDropdownView({
        id: dropdownId,
        ariaLabel: 'Reasoning model',
        capability: 'reasoning',
        placeholderTitle: 'Select model',
        placeholderIcon: '',
        controls: {
            getCurrentModel: controls.getCurrentAiModel,
            setModel: controls.setAiModel,
            getUnavailableModelIds: controls.getUnavailableAiModels ?? (() => []),
        },
    })
}

export function createGenericSubmitButton(controls: SubmitControls) {
    const handleClick = (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        controls.onSubmit()
    }

    return html`
        <div
            className="ai-submit-button"
            onclick=${handleClick}
            style=${{ pointerEvents: 'auto', cursor: 'pointer' }}
        >
            <div className="button-default">
                <span className="send-icon" innerHTML=${sendIcon}></span>
            </div>
            <div className="button-hover">
                <span className="send-icon" innerHTML=${sendIcon}></span>
            </div>
        </div>
    `
}

export function createGenericImageSizeDropdown(
    controls: ImageSizeControls,
    dropdownId: string
) {
    const getImageControl = () => findMatrixControlForModel('image', controls.getCurrentImageModel?.(), 'imageSize')
    const getSizesForSelectedModel = () => matrixControlOptions(getImageControl(), 'Auto', 'auto')
    const getSizeContextKey = () => controls.getCurrentImageModel?.() || ''
    const getOptionsSignature = (options: Array<{ title: string; value: string }>) =>
        options.map(option => `${option.value}:${option.title}`).join('|')

    let lastSizeContextKey = getSizeContextKey()
    let IMAGE_SIZES = getSizesForSelectedModel()
    let lastImageSizesSignature = getOptionsSignature(IMAGE_SIZES)

    const currentSize = controls.getImageGenerationSize()
    const selectedValue = IMAGE_SIZES.find(s => s.value === currentSize) || IMAGE_SIZES[0]

    const dropdown = createPureDropdown({
        id: dropdownId,
        selectedValue,
        options: IMAGE_SIZES,
        theme: 'dark',
        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: true,
        renderIconForSelectedValue: false,
        renderIconForOptions: false,
        mountToBody: false,
        disableAutoPositioning: true,
        onSelect: (option: any) => {
            controls.setImageGenerationSize(option.value)
        }
    })

    const updateSelection = () => {
        const currentSizeContextKey = getSizeContextKey()
        const nextImageSizes = getSizesForSelectedModel()
        const nextImageSizesSignature = getOptionsSignature(nextImageSizes)
        if (currentSizeContextKey !== lastSizeContextKey || nextImageSizesSignature !== lastImageSizesSignature) {
            lastSizeContextKey = currentSizeContextKey
            lastImageSizesSignature = nextImageSizesSignature
            IMAGE_SIZES = nextImageSizes
            const currentSize = controls.getImageGenerationSize()
            const matched = IMAGE_SIZES.find(s => s.value === currentSize)
            if (!matched) {
                controls.setImageGenerationSize(IMAGE_SIZES[0].value)
            }
            dropdown.setOptions({
                options: IMAGE_SIZES,
                selectedValue: matched || IMAGE_SIZES[0],
            })
        } else {
            const currentSize = controls.getImageGenerationSize()
            const matched = IMAGE_SIZES.find(s => s.value === currentSize)
            if (matched) {
                dropdown.update(matched)
            }
        }
    }

    return {
        dom: dropdown.dom,
        getControlLabel: () => getImageControl()?.label ?? 'Image option',
        destroy: () => {
            dropdown.destroy?.()
        },
        update: updateSelection,
    }
}

export function createGenericImageModelDropdown(
    controls: ImageModelControls,
    dropdownId: string
) {
    return new ModelSlidingDropdownView({
        id: dropdownId,
        ariaLabel: 'Image model',
        capability: 'image',
        placeholderTitle: 'Image model',
        placeholderIcon: imageIcon,
        controls: {
            getCurrentModel: controls.getCurrentImageModel,
            setModel: controls.setImageModel,
            getUnavailableModelIds: controls.getUnavailableImageModels ?? (() => []),
        },
    })
}

function normalizeControlValue(control: MediaGenerationConfigControl, value: string | undefined): string {
    const optionValues = new Set(control.options.map(option => option.value))
    if (value && optionValues.has(value)) return value
    return control.defaultValue || control.options[0]?.value || ''
}

function getSelectedMatrixGroups(
    matrixGroups: MediaGenerationConfigGroup[],
    mediaType: 'image' | 'video',
    selectedModelIds: string[],
): RenderedMediaConfigGroup[] {
    const mediaGroups = matrixGroups.filter(group => group.mediaType === mediaType)
    return selectedModelIds.flatMap((modelId): RenderedMediaConfigGroup[] => {
        const group = mediaGroups.find(candidate => candidate.modelIds.includes(modelId))
        if (!group) return []
        return [{ ...group, selectedModelIds: [modelId] }]
    })
}

class MediaGenerationConfigMatrixView implements MediaGenerationConfigMatrixViewInstance {
    readonly dom: HTMLElement

    private readonly unsubscribe: () => void
    private readonly mountedModelDropdowns: Array<{
        update: () => void
        destroy?: () => void
    }> = []
    private readonly mountedControls: MountedMediaConfigControl[] = []
    private readonly mountedHelpTooltips: HelpTooltipInstance[] = []
    private renderedStructureSignature = ''
    private builtConnected = false

    constructor(private readonly controls: MediaGenerationConfigMatrixControls) {
        this.dom = html`<div className="ai-model-config-row-collection ai-media-config-matrix" data-media-type=${controls.mediaType} data-visible="false" contenteditable="false"></div>` as HTMLElement
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            void storeState
            this.renderedStructureSignature = ''
            this.builtConnected = false
            this.update()
        })
        this.update()
    }

    private getMatrixGroups(): RenderedMediaConfigGroup[] {
        const matrix = aiModelsStore.getMediaGenerationConfigMatrix()
        const selectedModelIds = this.controls.getSelectedModelIds()
        const defaultModelId = aiModelsStore.getDefaultModelId(this.controls.mediaType)
        return getSelectedMatrixGroups(
            matrix.groups,
            this.controls.mediaType,
            selectedModelIds.length > 0
                ? selectedModelIds
                : defaultModelId ? [defaultModelId] : [],
        )
    }

    private normalizeSelectionGroups(groups: RenderedMediaConfigGroup[]): MediaGenerationConfigSelectionGroup[] {
        const currentGroups = this.controls.getConfigGroups()
        return groups.map((group) => {
            const modelId = group.selectedModelIds[0] ?? ''
            const currentGroup = currentGroups.find(candidate => (
                candidate.groupId === group.groupId && candidate.modelIds.includes(modelId)
            ))
            const values = group.controls.reduce<Partial<Record<MediaGenerationConfigControlKey, string>>>((nextValues, control) => {
                const value = normalizeControlValue(control, currentGroup?.values?.[control.key])
                if (value) nextValues[control.key] = value
                return nextValues
            }, {})

            return {
                groupId: group.groupId,
                modelIds: [modelId] as MediaGenerationConfigSelectionGroup['modelIds'],
                values,
            }
        })
    }

    private destroyModelDropdowns(): void {
        for (const dropdown of this.mountedModelDropdowns) {
            dropdown.destroy?.()
        }
        this.mountedModelDropdowns.length = 0
    }

    private destroyMountedControls(): void {
        for (const control of this.mountedControls) {
            control.destroy()
        }
        this.mountedControls.length = 0
        for (const helpTooltip of this.mountedHelpTooltips) {
            helpTooltip.destroy()
        }
        this.mountedHelpTooltips.length = 0
    }

    private syncMountedControls(selectionGroups: MediaGenerationConfigSelectionGroup[]): void {
        for (const mountedControl of this.mountedControls) {
            const selectionGroup = this.getSelectionForGroup(
                selectionGroups,
                mountedControl.groupId,
                mountedControl.modelId,
            )
            mountedControl.setValue(normalizeControlValue(
                mountedControl.control,
                selectionGroup?.values?.[mountedControl.control.key],
            ))
        }
        for (const dropdown of this.mountedModelDropdowns) dropdown.update()
    }

    private getSelectionForGroup(
        selectionGroups: MediaGenerationConfigSelectionGroup[],
        groupId: string,
        modelId: string,
    ): MediaGenerationConfigSelectionGroup | undefined {
        return selectionGroups.find(group => group.groupId === groupId && group.modelIds.includes(modelId))
    }

    private setGroupControlValue(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        value: string,
    ): void {
        const modelId = group.selectedModelIds[0] ?? ''
        const renderedGroups = this.getMatrixGroups()
        const nextGroups = this.normalizeSelectionGroups(renderedGroups).map((selectionGroup) => {
            if (selectionGroup.groupId !== group.groupId || !selectionGroup.modelIds.includes(modelId)) {
                return selectionGroup
            }
            return {
                ...selectionGroup,
                values: {
                    ...selectionGroup.values,
                    [control.key]: value,
                },
            }
        })
        this.controls.setConfigGroups(nextGroups)
        this.update()
    }

    private removeModel(modelId: string): void {
        const selectedModelIds = this.controls.getSelectedModelIds()
        if (selectedModelIds.length <= 1) return
        const nextModelIds = this.controls.getSelectedModelIds()
            .filter((selectedModelId) => selectedModelId !== modelId)
        this.controls.setSelectedModelIds(nextModelIds)
        this.update()
    }

    private createSvgControlHost(
        className:
            | 'ai-media-config-sliding-dropdown-host'
            | 'ai-media-config-sliding-switch-host',
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        selectedValue: string,
        pendingControls: PendingMediaConfigSvgControl[],
    ): HTMLElement {
        const host = html`<div className=${className}></div>` as HTMLElement
        pendingControls.push({ host, group, control, selectedValue })
        return host
    }

    private mountedControlWidth(host: HTMLElement): number {
        return host.clientWidth || host.getBoundingClientRect().width || MEDIA_CONFIG_CONTROL_FALLBACK_WIDTH
    }

    private getGroupAspectRatioValue(group: RenderedMediaConfigGroup): string {
        const aspectRatioControl = group.controls.find(control => control.key === 'aspectRatio')
        if (!aspectRatioControl) return ''
        const modelId = group.selectedModelIds[0] ?? ''
        const selectionGroup = this.getSelectionForGroup(this.controls.getConfigGroups(), group.groupId, modelId)
        return normalizeControlValue(aspectRatioControl, selectionGroup?.values.aspectRatio)
    }

    private mountSlidingDropdownControl(pendingControl: PendingMediaConfigSvgControl): void {
        const { host, group, control, selectedValue } = pendingControl
        const dropdownStyles = settings.aiModelControls.styles.dimensionsDropdown
        const svg = select(host).append('svg')
        const rendersGlyph = rendersDimensionGlyph(this.controls.mediaType, control)
        const rendersOptionHelp = control.options.some(option => Boolean(optionHelpText(group, control, option)))
        const renderOption = rendersGlyph
            ? (parent: any, state: SlidingDropdownOptionRenderState<string>) => new MediaDimensionsDropdownOptionView(
                parent,
                state,
                () => this.getGroupAspectRatioValue(group),
                optionHelpText(
                    group,
                    control,
                    control.options.find(option => option.value === state.option.value) ?? state.option,
                ),
            )
            : rendersOptionHelp
                ? (parent: any, state: SlidingDropdownOptionRenderState<string>) => new MediaTextDropdownOptionView(
                    parent,
                    state,
                    optionHelpText(
                        group,
                        control,
                        control.options.find(option => option.value === state.option.value) ?? state.option,
                    ),
                )
                : undefined
        const slidingDropdown: SlidingDropdownInstance<string> = createSlidingDropdown(svg, {
            id: `${group.groupId}:${group.selectedModelIds[0] ?? ''}:${control.key}`,
            x: 0,
            y: 0,
            width: dropdownStyles.width,
            height: dropdownStyles.height,
            optionHorizontalPadding: dropdownStyles.horizontalPadding,
            options: slidingDropdownOptions(control),
            selectedValue,
            ariaLabel: control.label,
            renderOption,
            onChange: value => this.setGroupControlValue(group, control, value),
        })
        this.mountedControls.push({
            groupId: group.groupId,
            modelId: group.selectedModelIds[0] ?? '',
            control,
            setValue: value => slidingDropdown.setValue(value),
            destroy: () => slidingDropdown.destroy(),
        })
    }

    private mountSlidingSwitchControl(pendingControl: PendingMediaConfigSvgControl): void {
        const { host, group, control, selectedValue } = pendingControl
        const svg = select(host)
            .append('svg')
            .attr('class', 'ai-media-config-sliding-switch-svg')
        const slidingSwitch: SlidingSwitchInstance<string> = createSlidingSwitch(svg, {
            id: `${group.groupId}:${group.selectedModelIds[0] ?? ''}:${control.key}`,
            x: 0,
            y: 0,
            width: this.mountedControlWidth(host),
            height: MEDIA_CONFIG_SEGMENTED_CONTROL_HEIGHT,
            options: control.options,
            selectedValue,
            observeParentResize: true,
            visualOverflowPadding: { top: 0, right: 0, bottom: 0, left: 0 },
            indicatorBoxShadow: settings.slidingSwitch.styles.indicatorBoxShadow,
            indicatorInsetShadow: settings.slidingSwitch.styles.indicatorInsetShadow,
            onChange: value => this.setGroupControlValue(group, control, value),
        })
        this.mountedControls.push({
            groupId: group.groupId,
            modelId: group.selectedModelIds[0] ?? '',
            control,
            setValue: value => slidingSwitch.setValue(value),
            destroy: () => slidingSwitch.destroy(),
        })
    }

    private mountSvgControl(pendingControl: PendingMediaConfigSvgControl): void {
        if (usesSlidingDropdown(pendingControl.control)) {
            this.mountSlidingDropdownControl(pendingControl)
            return
        }
        this.mountSlidingSwitchControl(pendingControl)
    }

    private createToggleControl(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        selectedValue: string,
    ): HTMLElement {
        const checked = selectedValue === 'true'
        const svgHost = html`<span className="ai-media-config-toggle-svg-host" aria-hidden="true"></span>` as HTMLElement
        const svgEl = select(svgHost)
            .append('svg')
            .attr('class', 'ai-media-config-toggle-svg')
            .attr('width', MEDIA_CONFIG_TOGGLE_DIMENSIONS.svgWidth)
            .attr('height', MEDIA_CONFIG_TOGGLE_DIMENSIONS.svgHeight)
            .attr('viewBox', `0 0 ${MEDIA_CONFIG_TOGGLE_DIMENSIONS.svgWidth} ${MEDIA_CONFIG_TOGGLE_DIMENSIONS.svgHeight}`)
            .node() as SVGSVGElement
        const button = html`
            <button
                type="button"
                className="ai-media-config-toggle"
                aria-label=${control.label}
                aria-pressed=${String(checked)}
            >
                ${svgHost}
            </button>
        ` as HTMLButtonElement

        const toggleSwitch = createToggleSwitch(select(svgEl), {
            id: `${group.groupId}:${group.selectedModelIds[0] ?? ''}:${control.key}`,
            x: 2,
            y: 2,
            width: MEDIA_CONFIG_TOGGLE_DIMENSIONS.width,
            height: MEDIA_CONFIG_TOGGLE_DIMENSIONS.height,
            checked,
            onChange: (nextChecked) => {
                button.setAttribute('aria-pressed', String(nextChecked))
                this.setGroupControlValue(group, control, String(nextChecked))
            },
        })
        const syncValue = (value: string): void => {
            const nextChecked = value === 'true'
            button.setAttribute('aria-pressed', String(nextChecked))
            if (toggleSwitch.getChecked() !== nextChecked) {
                toggleSwitch.setChecked(nextChecked)
            }
        }
        button.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const nextChecked = !toggleSwitch.getChecked()
            toggleSwitch.setChecked(nextChecked)
            button.setAttribute('aria-pressed', String(nextChecked))
            this.setGroupControlValue(group, control, String(nextChecked))
        })
        this.mountedControls.push({
            groupId: group.groupId,
            modelId: group.selectedModelIds[0] ?? '',
            control,
            setValue: syncValue,
            destroy: () => toggleSwitch.destroy(),
        })
        return button
    }

    private createControlLabel(control: MediaGenerationConfigControl): HTMLElement {
        const tooltipText = control.kind === 'toggle'
            ? control.description?.trim() || MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT[control.key]
            : undefined
        if (!tooltipText) {
            return html`<span className="ai-prompt-model-menu-control-label">${control.label}</span>` as HTMLElement
        }

        const helpTooltip = createHelpTooltip({
            label: `${control.label} details`,
            text: tooltipText,
            className: 'ai-media-config-control-help',
            triggerSize: MEDIA_CONFIG_HELP_TRIGGER_SIZE,
        })
        this.mountedHelpTooltips.push(helpTooltip)

        return html`
            <span className="ai-media-config-control-label">
                <span className="ai-prompt-model-menu-control-label">${control.label}</span>
                ${helpTooltip.dom}
            </span>
        ` as HTMLElement
    }

    private createControl(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        selectionGroup: MediaGenerationConfigSelectionGroup | undefined,
        pendingControls: PendingMediaConfigSvgControl[],
    ): HTMLElement {
        const selectedValue = normalizeControlValue(control, selectionGroup?.values?.[control.key])
        const rendersDescriptionInLabel = control.kind === 'toggle' && Boolean(
            control.description?.trim()
                || MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT[control.key],
        )
        const field = control.readOnly || control.kind === 'fixed'
            ? html`<div className="ai-media-config-fixed-value">${control.options.find(option => option.value === selectedValue)?.label ?? selectedValue}</div>` as HTMLElement
            : usesSlidingDropdown(control)
                ? this.createSvgControlHost('ai-media-config-sliding-dropdown-host', group, control, selectedValue, pendingControls)
                : control.kind === 'toggle'
                    ? this.createToggleControl(group, control, selectedValue)
                    : this.createSvgControlHost('ai-media-config-sliding-switch-host', group, control, selectedValue, pendingControls)

        return html`
            <div className="ai-media-config-control" data-control-kind=${control.kind} data-control-key=${control.key}>
                ${this.createControlLabel(control)}
                <div className="ai-media-config-control-field">${field}</div>
                ${control.description
                    && !usesSlidingDropdown(control)
                    && !rendersDescriptionInLabel
                    ? html`<span className="ai-media-config-description">${control.description}</span>`
                    : undefined}
            </div>
        ` as HTMLElement
    }

    private renderGroup(
        group: RenderedMediaConfigGroup,
        modelIndex: number,
        selectionGroups: MediaGenerationConfigSelectionGroup[],
        pendingModelDropdowns: PendingMediaConfigModelDropdown[],
        pendingControls: PendingMediaConfigSvgControl[],
    ): HTMLElement {
        const modelId = group.selectedModelIds[0] ?? ''
        const selectionGroup = this.getSelectionForGroup(selectionGroups, group.groupId, modelId)
        const renderedControls = group.controls.map(control => ({
            control,
            dom: this.createControl(group, control, selectionGroup, pendingControls),
        }))
        const inlineImageSizeControl = this.controls.mediaType === 'image'
            ? renderedControls.find(({ control }) => control.key === 'imageSize')
            : undefined
        const remainingControlEls = renderedControls
            .filter(renderedControl => renderedControl !== inlineImageSizeControl)
            .map(({ dom }) => dom)
        const modelDropdownHost = html`<span></span>` as HTMLElement
        pendingModelDropdowns.push({ host: modelDropdownHost, modelIndex })
        const canRemove = this.controls.getSelectedModelIds().length > 1

        return createModelConfigurationRow({
            modelDropdownHost,
            inlineControl: inlineImageSizeControl?.dom,
            controls: remainingControlEls,
            canRemove,
            onRemove: () => this.removeModel(modelId),
            className: 'ai-media-config-group',
            data: {
                groupId: group.groupId,
                modelId,
            },
        }).dom
    }

    update(): void {
        const groups = this.getMatrixGroups()
        const selectionGroups = this.normalizeSelectionGroups(groups)
        const structureSignature = JSON.stringify(groups)
        const connected = this.dom.isConnected
        if (structureSignature === this.renderedStructureSignature && (this.builtConnected || !connected)) {
            this.syncMountedControls(selectionGroups)
            return
        }
        this.renderedStructureSignature = structureSignature
        this.builtConnected = connected || groups.length === 0

        this.destroyModelDropdowns()
        this.destroyMountedControls()
        if (groups.length === 0) {
            this.dom.dataset.visible = 'false'
            this.dom.replaceChildren()
            return
        }

        this.dom.dataset.visible = 'true'
        const pendingModelDropdowns: PendingMediaConfigModelDropdown[] = []
        const pendingControls: PendingMediaConfigSvgControl[] = []
        this.dom.replaceChildren(...groups.map((group, modelIndex) => this.renderGroup(
            group,
            modelIndex,
            selectionGroups,
            pendingModelDropdowns,
            pendingControls,
        )))
        for (const pendingModelDropdown of pendingModelDropdowns) {
            const dropdown = this.controls.createModelDropdown(pendingModelDropdown.modelIndex)
            pendingModelDropdown.host.replaceChildren(dropdown.dom)
            this.mountedModelDropdowns.push(dropdown)
            if (this.dom.isConnected) dropdown.update()
        }
        for (const pendingControl of pendingControls) {
            this.mountSvgControl(pendingControl)
        }
    }

    destroy(): void {
        this.unsubscribe()
        this.destroyModelDropdowns()
        this.destroyMountedControls()
        this.dom.remove()
    }
}

export function createMediaGenerationConfigMatrixView(
    controls: MediaGenerationConfigMatrixControls,
): MediaGenerationConfigMatrixViewInstance {
    return new MediaGenerationConfigMatrixView(controls)
}

// Filters models that expose the `video_generation` modality. The composer mode
// switch decides whether this selector or the image selector is authoritative.
export function createGenericVideoModelDropdown(
    controls: VideoModelControls,
    dropdownId: string
) {
    return new ModelSlidingDropdownView({
        id: dropdownId,
        ariaLabel: 'Video model',
        capability: 'video',
        placeholderTitle: 'Video model',
        placeholderIcon: '',
        controls: {
            getCurrentModel: controls.getCurrentVideoModel,
            setModel: controls.setVideoModel,
            getUnavailableModelIds: controls.getUnavailableVideoModels ?? (() => []),
        },
    })
}

// Generic factory for the three video option dropdowns (aspect / resolution /
// duration). The option list is read from the API-authored media config matrix.
type VideoOptionListKey = 'videoAspectRatios' | 'videoResolutions' | 'videoDurations'

const videoOptionControlKeyByListKey: Record<VideoOptionListKey, MediaGenerationConfigControlKey> = {
    videoAspectRatios: 'aspectRatio',
    videoResolutions: 'resolution',
    videoDurations: 'duration',
}

function createGenericVideoOptionDropdown(
    controls: VideoOptionControls,
    dropdownId: string,
    listKey: VideoOptionListKey,
    fallbackLabel: string,
) {
    const controlKey = videoOptionControlKeyByListKey[listKey]
    const getOptionsForModel = (videoAiModel: string) =>
        matrixControlOptions(findMatrixControlForModel('video', videoAiModel, controlKey), fallbackLabel)

    let lastVideoModel = controls.getCurrentVideoModel?.() || ''
    let VIDEO_OPTIONS = getOptionsForModel(lastVideoModel)

    const currentValue = controls.getValue()
    const selectedValue = VIDEO_OPTIONS.find((s: any) => s.value === currentValue) || VIDEO_OPTIONS[0]

    const dropdown = createPureDropdown({
        id: dropdownId,
        selectedValue,
        options: VIDEO_OPTIONS,
        theme: 'dark',
        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: true,
        renderIconForSelectedValue: false,
        renderIconForOptions: false,
        mountToBody: false,
        disableAutoPositioning: true,
        onSelect: (option: any) => {
            controls.setValue(option.value)
        }
    })

    const updateSelection = () => {
        const nextModel = controls.getCurrentVideoModel?.() || ''
        if (nextModel !== lastVideoModel) {
            lastVideoModel = nextModel
            VIDEO_OPTIONS = getOptionsForModel(nextModel)
            const currentValue = controls.getValue()
            const matched = VIDEO_OPTIONS.find((s: any) => s.value === currentValue)
            if (!matched && VIDEO_OPTIONS[0]) {
                controls.setValue(VIDEO_OPTIONS[0].value)
            }
            dropdown.setOptions({
                options: VIDEO_OPTIONS,
                selectedValue: matched || VIDEO_OPTIONS[0],
            })
        } else {
            const currentValue = controls.getValue()
            const matched = VIDEO_OPTIONS.find((s: any) => s.value === currentValue)
            if (matched) dropdown.update(matched)
        }
    }

    return {
        dom: dropdown.dom,
        destroy: () => {
            dropdown.destroy?.()
        },
        update: updateSelection,
    }
}

export function createGenericVideoAspectDropdown(controls: VideoOptionControls, dropdownId: string) {
    return createGenericVideoOptionDropdown(controls, dropdownId, 'videoAspectRatios', 'Aspect')
}

export function createGenericVideoResolutionDropdown(controls: VideoOptionControls, dropdownId: string) {
    return createGenericVideoOptionDropdown(controls, dropdownId, 'videoResolutions', 'Resolution')
}

export function createGenericVideoDurationDropdown(controls: VideoOptionControls, dropdownId: string) {
    return createGenericVideoOptionDropdown(controls, dropdownId, 'videoDurations', 'Duration')
}
