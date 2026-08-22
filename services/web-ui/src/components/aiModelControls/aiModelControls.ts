import {
    sendIcon,
    chevronDownIcon,
    gptAvatarIcon,
    claudeIcon,
    geminiIcon,
    stabilityIcon,
    bytedanceIcon,
    imageIcon
} from '@lixpi/ui-kit/svg'

// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { html } from '$src/utils/domTemplates.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import { createSlider, type SliderInstance } from '@lixpi/ui-kit/components/slider'
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
import { createTagPill as createSvgTagPill, type TagPillInstance } from '@lixpi/ui-kit/components/tag-pill'
import { settings } from '$src/settings.ts'

import type {
    DefaultAiModelCapability,
    MediaGenerationConfigControl,
    MediaGenerationConfigControlKey,
    MediaGenerationConfigGroup,
    MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'

export type AiModelDropdownOption = {
    title: string
    icon: string
    color: string
    aiModel: string
    provider: string
    model: string
    tags: string[]
}

type AiModelControls = {
    getCurrentAiModel: () => string
    setAiModel: (aiModel: string) => void
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
}

type VideoModelControls = {
    getCurrentVideoModel: () => string
    setVideoModel: (aiModel: string) => void
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
    getUseMultipleModels: () => boolean
    getSelectedModelIds: () => string[]
    setSelectedModelIds: (modelIds: string[]) => void
    getConfigGroups: () => MediaGenerationConfigSelectionGroup[]
    setConfigGroups: (groups: MediaGenerationConfigSelectionGroup[]) => void
}

export type MediaGenerationConfigMatrixViewInstance = {
    dom: HTMLElement
    update: () => void
    destroy: () => void
}

type RenderedMediaConfigGroup = MediaGenerationConfigGroup & {
    selectedModelIds: string[]
}

type PendingMediaConfigTagHost = {
    host: HTMLElement
    modelId: string
}

type MountedMediaConfigControl = {
    groupId: string
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
const MEDIA_CONFIG_SLIDER_HEIGHT = 66
const MEDIA_CONFIG_CONTROL_FALLBACK_WIDTH = 320
const MEDIA_DIMENSIONS_GLYPH_MAX_WIDTH = 28
const MEDIA_DIMENSIONS_GLYPH_MAX_HEIGHT = 15
const MEDIA_DIMENSIONS_GLYPH_ADAPTIVE_SIZE = 15
const MEDIA_DIMENSIONS_GLYPH_STROKE_WIDTH = 1.5

function isAspectRatioValue(value: string): boolean {
    return /^\d+:\d+$/.test(value)
}

function isPixelDimensionsValue(value: string): boolean {
    return /^\d+\s*[x×]\s*\d+$/i.test(value)
}

function usesDimensionsDropdown(control: MediaGenerationConfigControl): boolean {
    if (control.kind === 'aspect-ratio' || control.key === 'aspectRatio' || control.key === 'resolution') return true
    if (control.key !== 'imageSize') return false
    return control.options.some(option => (
        isAspectRatioValue(option.value) || isPixelDimensionsValue(option.value)
    ))
}

function dimensionDropdownOptions(control: MediaGenerationConfigControl): MediaGenerationConfigControl['options'] {
    return control.options.map(option => ({
        ...option,
        label: option.value === 'auto' || option.value === 'adaptive' ? option.label : option.value,
    }))
}

class MediaDimensionsDropdownOptionView implements SlidingDropdownOptionRenderInstance<string> {
    private readonly group: any
    private readonly glyph: any
    private readonly adaptiveLabel: any
    private readonly label: any
    private value = ''
    private optionHeight = 0

    constructor(
        parent: any,
        state: SlidingDropdownOptionRenderState<string>,
        private readonly getFallbackProportionValue: () => string,
    ) {
        this.group = parent.append('g')
            .attr('class', 'ai-media-config-dimensions-dropdown-option')
            .attr('pointer-events', 'none')
        this.glyph = this.group.append('rect')
            .attr('class', 'ai-media-config-dimensions-dropdown-glyph')
            .attr('fill', 'none')
            .attr('rx', 2)
            .attr('ry', 2)
            .attr('stroke-width', MEDIA_DIMENSIONS_GLYPH_STROKE_WIDTH)
        this.adaptiveLabel = this.group.append('text')
            .attr('class', 'ai-media-config-dimensions-dropdown-adaptive-label')
            .attr('font-size', 8)
            .attr('font-weight', 700)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .text('A')
        this.label = this.group.append('text')
            .attr('class', 'ai-media-config-dimensions-dropdown-label')
            .attr('font-size', 12)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
        this.render(state)
    }

    private proportionFor(value: string): number | null {
        const separator = isAspectRatioValue(value) ? ':' : isPixelDimensionsValue(value) ? /[x×]/i : null
        if (!separator) return null
        const [widthValue, heightValue] = value.split(separator).map(Number)
        if (!widthValue || !heightValue) return null
        return widthValue / heightValue
    }

    private glyphSize(value: string): { width: number; height: number; adaptive: boolean } {
        const adaptive = value === 'adaptive' || value === 'auto'
        if (adaptive) {
            return {
                width: MEDIA_DIMENSIONS_GLYPH_ADAPTIVE_SIZE,
                height: MEDIA_DIMENSIONS_GLYPH_ADAPTIVE_SIZE,
                adaptive,
            }
        }

        const ratio = this.proportionFor(value)
            ?? this.proportionFor(this.getFallbackProportionValue())
            ?? 1
        if (ratio >= 1) {
            return {
                width: MEDIA_DIMENSIONS_GLYPH_MAX_WIDTH,
                height: MEDIA_DIMENSIONS_GLYPH_MAX_WIDTH / ratio,
                adaptive,
            }
        }
        return {
            width: MEDIA_DIMENSIONS_GLYPH_MAX_HEIGHT * ratio,
            height: MEDIA_DIMENSIONS_GLYPH_MAX_HEIGHT,
            adaptive,
        }
    }

    resize(x: number, y: number, width: number, height = this.optionHeight): void {
        this.optionHeight = height
        const optionCenterX = x + width / 2
        const glyphCenterY = y + height * 0.37
        const labelY = y + height * 0.72
        const size = this.glyphSize(this.value)

        this.glyph
            .attr('x', optionCenterX - size.width / 2)
            .attr('y', glyphCenterY - size.height / 2)
            .attr('width', size.width)
            .attr('height', size.height)
        this.adaptiveLabel
            .attr('x', optionCenterX)
            .attr('y', glyphCenterY)
        this.label
            .attr('x', optionCenterX)
            .attr('y', labelY)
    }

    render(state: SlidingDropdownOptionRenderState<string>): void {
        const color = state.disabled
            ? 'rgba(49, 59, 78, 0.3)'
            : state.selected || state.hovered ? '#1a2744' : 'rgba(49, 59, 78, 0.68)'
        const size = this.glyphSize(state.option.value)
        this.value = state.option.value
        this.glyph
            .attr('stroke', color)
            .attr('stroke-dasharray', size.adaptive ? '3 2' : null)
        this.adaptiveLabel
            .attr('display', size.adaptive ? null : 'none')
            .attr('fill', color)
        this.label
            .attr('fill', color)
            .attr('font-weight', state.selected ? 700 : 400)
            .text(state.option.label)
        this.resize(state.x, state.y, state.width, state.height)
    }

    destroy(): void {
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
        model: aiModel.model,
        tags: aiModel.modalities?.map((m: any) => m.shortTitle) || []
    }))
}

function getModelOptionsSignature(models: any[]): string {
    return JSON.stringify(models.map(model => ({
        provider: model.provider,
        model: model.model,
        shortTitle: model.shortTitle,
        iconName: model.iconName,
        color: model.color,
        sortingPosition: model.sortingPosition,
        modalities: model.modalities,
    })))
}

function extractAvailableTags(models: any[]) {
    const allTags = new Set<string>()
    models.forEach(aiModel => {
        aiModel.modalities?.forEach((m: any) => allTags.add(m.shortTitle))
    })
    return Array.from(allTags).sort()
}

function buildDropdownData(models: any[]) {
    const textModels = models.filter((m: any) =>
        !m.modalities?.some((mod: any) => {
            const modality = mod.modality || mod
            return modality === 'image_generation' || modality === 'video_generation'
        })
    )
    return {
        options: transformModelsToOptions(textModels),
        tags: extractAvailableTags(textModels)
    }
}

export function createGenericAiModelDropdown(
    controls: AiModelControls,
    dropdownId: string
) {
    let aiModelsData: any[] = aiModelsStore.getData()
    const currentAiModel = controls.getCurrentAiModel()

    let { options: aiModelsSelectorDropdownOptions, tags: availableTags } = buildDropdownData(aiModelsData)

    const placeholderValue: AiModelDropdownOption = {
        title: 'Select Model',
        icon: '',
        color: '',
        aiModel: '',
        provider: '',
        model: '',
        tags: []
    }

    const selectedValue: AiModelDropdownOption = currentAiModel
        ? aiModelsSelectorDropdownOptions.find(model => model.aiModel === currentAiModel) ?? placeholderValue
        : pickDefaultModelOption(aiModelsSelectorDropdownOptions, 'reasoning') ?? placeholderValue

    const dropdown = createPureDropdown({
        id: dropdownId,
        selectedValue,
        options: aiModelsSelectorDropdownOptions,
        theme: 'dark',
        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: false,
        renderIconForSelectedValue: false,
        renderIconForOptions: true,
        enableTagFilter: settings.modelSelectorDropdown.useModalityFilter,
        availableTags: settings.modelSelectorDropdown.useModalityFilter ? availableTags : [],
        mountToBody: true,
        disableAutoPositioning: false,
        popoverClassName: 'ai-model-selector-popover',
        onSelect: (option: any) => {
            const selected = option as AiModelDropdownOption
            controls.setAiModel(selected.aiModel)
        }
    })

    // Auto-select first model if none set
    if (!controls.getCurrentAiModel() && selectedValue.aiModel) {
        setTimeout(() => {
            const current = controls.getCurrentAiModel()
            if (!current) {
                controls.setAiModel(selectedValue.aiModel)
            }
        }, 0)
    }

    let currentOptions = aiModelsSelectorDropdownOptions
    let lastProcessedSignature = getModelOptionsSignature(aiModelsData)

    const updateSelection = () => {
        const currentAiModel = controls.getCurrentAiModel()
        const matched = currentOptions.find(model => model.aiModel === currentAiModel)
        if (matched) {
            dropdown.update(matched)
            return
        }

        if (!currentAiModel) {
            const defaultOption = pickDefaultModelOption(currentOptions, 'reasoning')
            if (defaultOption) {
                controls.setAiModel(defaultOption.aiModel)
                dropdown.update(defaultOption)
                return
            }
        }

        dropdown.update(placeholderValue)
    }

    const unsubscribe = aiModelsStore.subscribe((storeState: any) => {
        const newModelsData = storeState.data
        const nextSignature = getModelOptionsSignature(newModelsData)
        if (newModelsData.length === 0 || nextSignature === lastProcessedSignature) return

        lastProcessedSignature = nextSignature
        aiModelsData = newModelsData

        const { options, tags } = buildDropdownData(aiModelsData)
        currentOptions = options

        dropdown.setOptions({
            options,
            availableTags: tags,
        })

        const current = controls.getCurrentAiModel()
        if (!current) {
            const defaultOption = pickDefaultModelOption(options, 'reasoning')
            if (defaultOption) {
                controls.setAiModel(defaultOption.aiModel)
                dropdown.update(defaultOption)
            }
            return
        }

        updateSelection()
    })

    return {
        dom: dropdown.dom,
        destroy: () => {
            unsubscribe()
            dropdown.destroy?.()
        },
        update: updateSelection
    }
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
    let aiModelsData: any[] = aiModelsStore.getData()

    const filterImageModels = (models: any[]) => {
        return models.filter((m: any) =>
            m.modalities?.some((mod: any) =>
                (mod.modality || mod) === 'image_generation'
            )
        )
    }

    let imageModels = filterImageModels(aiModelsData)
    const currentImageModel = controls.getCurrentImageModel()

    let options = transformModelsToOptions(imageModels)

    const placeholderValue: AiModelDropdownOption = {
        title: 'Image Model',
        icon: imageIcon,
        color: '',
        aiModel: '',
        provider: '',
        model: '',
        tags: []
    }

    const selectedValue: AiModelDropdownOption = currentImageModel
        ? options.find(model => model.aiModel === currentImageModel) ?? placeholderValue
        : pickDefaultModelOption(options, 'image') ?? placeholderValue

    const dropdown = createPureDropdown({
        id: dropdownId,
        selectedValue,
        options,
        theme: 'dark',
        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: false,
        renderIconForSelectedValue: false,
        renderIconForOptions: true,
        mountToBody: true,
        disableAutoPositioning: false,
        popoverClassName: 'ai-model-selector-popover',
        onSelect: (option: any) => {
            const selected = option as AiModelDropdownOption
            controls.setImageModel(selected.aiModel)
        }
    })

    // Auto-select first image model if none set
    if (!currentImageModel && selectedValue.aiModel) {
        setTimeout(() => {
            if (!controls.getCurrentImageModel()) {
                controls.setImageModel(selectedValue.aiModel)
            }
        }, 0)
    }

    let lastProcessedSignature = getModelOptionsSignature(aiModelsData)

    const updateSelection = () => {
        const current = controls.getCurrentImageModel()
        const matched = options.find(m => m.aiModel === current)
        if (matched) {
            dropdown.update(matched)
            return
        }

        if (!current) {
            const defaultOption = pickDefaultModelOption(options, 'image')
            if (defaultOption) {
                controls.setImageModel(defaultOption.aiModel)
                dropdown.update(defaultOption)
                return
            }
        }

        dropdown.update(placeholderValue)
    }

    const unsubscribe = aiModelsStore.subscribe((storeState: any) => {
        const newModelsData = storeState.data
        const nextSignature = getModelOptionsSignature(newModelsData)
        if (newModelsData.length === 0 || nextSignature === lastProcessedSignature) return

        lastProcessedSignature = nextSignature
        aiModelsData = newModelsData

        imageModels = filterImageModels(aiModelsData)
        options = transformModelsToOptions(imageModels)

        dropdown.setOptions({ options })

        const current = controls.getCurrentImageModel()
        if (!current) {
            const defaultOption = pickDefaultModelOption(options, 'image')
            if (defaultOption) {
                controls.setImageModel(defaultOption.aiModel)
                dropdown.update(defaultOption)
            }
            return
        }

        updateSelection()
    })

    return {
        dom: dropdown.dom,
        destroy: () => {
            unsubscribe()
            dropdown.destroy?.()
        },
        update: updateSelection
    }
}

function normalizeControlValue(control: MediaGenerationConfigControl, value: string | undefined): string {
    if ((control.kind === 'number' || control.kind === 'text') && value !== undefined) return value
    const optionValues = new Set(control.options.map(option => option.value))
    if (value && optionValues.has(value)) return value
    return control.defaultValue || control.options[0]?.value || ''
}

function getSelectedMatrixGroups(
    matrixGroups: MediaGenerationConfigGroup[],
    mediaType: 'image' | 'video',
    selectedModelIds: string[],
): RenderedMediaConfigGroup[] {
    const selectedModelIdSet = new Set(selectedModelIds)
    return matrixGroups
        .filter(group => group.mediaType === mediaType)
        .map(group => ({
            ...group,
            selectedModelIds: group.modelIds.filter(modelId => selectedModelIdSet.has(modelId)),
        }))
        .filter(group => group.selectedModelIds.length > 0)
}

class MediaGenerationConfigMatrixView implements MediaGenerationConfigMatrixViewInstance {
    readonly dom: HTMLElement

    private readonly unsubscribe: () => void
    private readonly tagPills: TagPillInstance[] = []
    private readonly mountedControls: MountedMediaConfigControl[] = []
    private modelLabelsById = new Map<string, string>()
    private modelIconsById = new Map<string, string>()
    private renderedStructureSignature = ''
    private builtConnected = false

    constructor(private readonly controls: MediaGenerationConfigMatrixControls) {
        this.dom = html`<div className="ai-media-config-matrix" data-media-type=${controls.mediaType} data-visible="false" contenteditable="false"></div>` as HTMLElement
        this.syncModelLabels(aiModelsStore.getData())
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            this.syncModelLabels(storeState.data)
            this.renderedStructureSignature = ''
            this.builtConnected = false
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

    private getMatrixGroups(): RenderedMediaConfigGroup[] {
        const matrix = aiModelsStore.getMediaGenerationConfigMatrix()
        return getSelectedMatrixGroups(
            matrix.groups,
            this.controls.mediaType,
            this.controls.getSelectedModelIds(),
        )
    }

    private normalizeSelectionGroups(groups: RenderedMediaConfigGroup[]): MediaGenerationConfigSelectionGroup[] {
        const currentGroups = this.controls.getConfigGroups()
        return groups.map((group) => {
            const currentGroup = currentGroups.find(candidate => candidate.groupId === group.groupId)
            const values = group.controls.reduce<Partial<Record<MediaGenerationConfigControlKey, string>>>((nextValues, control) => {
                const value = normalizeControlValue(control, currentGroup?.values?.[control.key])
                if (value) nextValues[control.key] = value
                return nextValues
            }, {})

            return {
                groupId: group.groupId,
                modelIds: group.selectedModelIds as MediaGenerationConfigSelectionGroup['modelIds'],
                values,
            }
        })
    }

    private destroyTagPills(): void {
        for (const tagPill of this.tagPills) {
            tagPill.destroy()
        }
        this.tagPills.length = 0
    }

    private destroyMountedControls(): void {
        for (const control of this.mountedControls) {
            control.destroy()
        }
        this.mountedControls.length = 0
    }

    private syncMountedControls(selectionGroups: MediaGenerationConfigSelectionGroup[]): void {
        for (const mountedControl of this.mountedControls) {
            const selectionGroup = this.getSelectionForGroup(selectionGroups, mountedControl.groupId)
            mountedControl.setValue(normalizeControlValue(
                mountedControl.control,
                selectionGroup?.values?.[mountedControl.control.key],
            ))
        }
    }

    private getSelectionForGroup(
        selectionGroups: MediaGenerationConfigSelectionGroup[],
        groupId: string,
    ): MediaGenerationConfigSelectionGroup | undefined {
        return selectionGroups.find(group => group.groupId === groupId)
    }

    private setGroupControlValue(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        value: string,
    ): void {
        const renderedGroups = this.getMatrixGroups()
        const nextGroups = this.normalizeSelectionGroups(renderedGroups).map((selectionGroup) => {
            if (selectionGroup.groupId !== group.groupId) return selectionGroup
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
        const nextModelIds = this.controls.getSelectedModelIds()
            .filter((selectedModelId) => selectedModelId !== modelId)
        this.controls.setSelectedModelIds(nextModelIds)
        this.update()
    }

    private createTagHost(): HTMLElement {
        return html`<span className="ai-media-config-model-tag"></span>` as HTMLElement
    }

    private createTagPill(tagHost: HTMLElement, modelId: string): void {
        const label = this.getModelLabel(modelId)
        const svgEl = select(tagHost)
            .append('svg')
            .attr('class', 'ai-media-config-model-tag-svg ai-prompt-selected-model-tag-svg')
            .node() as SVGSVGElement

        const tagStyles = settings.aiPromptInput.modelMenu.styles
        const tagPill = createSvgTagPill(select(svgEl), {
            id: modelId,
            x: 0,
            y: 0,
            label,
            icon: this.getModelIcon(modelId),
            iconColor: tagStyles.selectedModelTagIconColor,
            textColor: tagStyles.selectedModelTagTextColor,
            selected: true,
            closable: this.controls.getUseMultipleModels(),
            className: 'ai-prompt-selected-model-tag-pill',
            closeAriaLabel: `Remove ${label}`,
            onClose: () => this.removeModel(modelId),
        })
        this.tagPills.push(tagPill)
    }

    private renderModelTags(
        modelIds: string[],
        pendingTagHosts: PendingMediaConfigTagHost[],
    ): HTMLElement {
        const tagHosts = modelIds.map((modelId) => {
            const host = this.createTagHost()
            pendingTagHosts.push({ host, modelId })
            return host
        })
        const tagsEl = html`
            <div className="ai-media-config-model-tags">
                ${tagHosts}
            </div>
        ` as HTMLElement

        return tagsEl
    }

    private createSvgControlHost(
        className:
            | 'ai-media-config-sliding-dropdown-host'
            | 'ai-media-config-sliding-switch-host'
            | 'ai-media-config-slider-host',
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
        const selectionGroup = this.getSelectionForGroup(this.controls.getConfigGroups(), group.groupId)
        return normalizeControlValue(aspectRatioControl, selectionGroup?.values.aspectRatio)
    }

    private mountSlidingDropdownControl(pendingControl: PendingMediaConfigSvgControl): void {
        const { host, group, control, selectedValue } = pendingControl
        const svg = select(host).append('svg')
        const slidingDropdown: SlidingDropdownInstance<string> = createSlidingDropdown(svg, {
            id: `${group.groupId}:${control.key}`,
            x: 0,
            y: 0,
            options: dimensionDropdownOptions(control),
            selectedValue,
            ariaLabel: control.label,
            renderOption: (parent, state) => new MediaDimensionsDropdownOptionView(
                parent,
                state,
                () => this.getGroupAspectRatioValue(group),
            ),
            onChange: value => this.setGroupControlValue(group, control, value),
        })
        this.mountedControls.push({
            groupId: group.groupId,
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
            id: `${group.groupId}:${control.key}`,
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
            control,
            setValue: value => slidingSwitch.setValue(value),
            destroy: () => slidingSwitch.destroy(),
        })
    }

    private mountSliderControl(pendingControl: PendingMediaConfigSvgControl): void {
        const { host, group, control, selectedValue } = pendingControl
        const svg = select(host)
            .append('svg')
            .attr('class', 'ai-media-config-slider-svg')
        const slider: SliderInstance<string> = createSlider(svg, {
            id: `${group.groupId}:${control.key}`,
            x: 0,
            y: 0,
            width: this.mountedControlWidth(host),
            height: MEDIA_CONFIG_SLIDER_HEIGHT,
            options: control.options,
            selectedValue,
            observeParentResize: true,
            onChange: value => this.setGroupControlValue(group, control, value),
        })
        this.mountedControls.push({
            groupId: group.groupId,
            control,
            setValue: value => slider.setValue(value),
            destroy: () => slider.destroy(),
        })
    }

    private mountSvgControl(pendingControl: PendingMediaConfigSvgControl): void {
        if (pendingControl.control.kind === 'duration') {
            this.mountSliderControl(pendingControl)
            return
        }
        if (usesDimensionsDropdown(pendingControl.control)) {
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
        const button = html`
            <button
                type="button"
                className="ai-media-config-toggle"
                role="switch"
                aria-checked=${String(selectedValue === 'true')}
                data-checked=${String(selectedValue === 'true')}
            >
                <span className="ai-media-config-toggle-track"><span className="ai-media-config-toggle-thumb"></span></span>
                <span className="ai-media-config-toggle-label">${selectedValue === 'true' ? 'On' : 'Off'}</span>
            </button>
        ` as HTMLButtonElement
        const label = button.querySelector('.ai-media-config-toggle-label') as HTMLElement
        const syncValue = (value: string): void => {
            const checked = value === 'true'
            button.dataset.checked = String(checked)
            button.ariaChecked = String(checked)
            label.textContent = checked ? 'On' : 'Off'
        }
        button.addEventListener('click', () => {
            this.setGroupControlValue(group, control, button.dataset.checked === 'true' ? 'false' : 'true')
        })
        this.mountedControls.push({
            groupId: group.groupId,
            control,
            setValue: syncValue,
            destroy: () => undefined,
        })
        return button
    }

    private createInputControl(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        selectedValue: string,
    ): HTMLElement {
        const input = html`
            <input
                className="ai-media-config-input"
                type=${control.kind === 'number' ? 'number' : 'text'}
                value=${selectedValue}
                placeholder=${control.placeholder ?? ''}
                aria-label=${control.label}
            />
        ` as HTMLInputElement
        if (control.min !== undefined) input.min = String(control.min)
        if (control.max !== undefined) input.max = String(control.max)
        if (control.step !== undefined) input.step = String(control.step)
        input.addEventListener('change', () => this.setGroupControlValue(group, control, input.value.trim()))
        this.mountedControls.push({
            groupId: group.groupId,
            control,
            setValue: value => {
                if (input.value !== value) input.value = value
            },
            destroy: () => undefined,
        })
        return input
    }

    private createControl(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        selectionGroup: MediaGenerationConfigSelectionGroup | undefined,
        pendingControls: PendingMediaConfigSvgControl[],
    ): HTMLElement {
        const selectedValue = normalizeControlValue(control, selectionGroup?.values?.[control.key])
        const field = control.readOnly || control.kind === 'fixed'
            ? html`<div className="ai-media-config-fixed-value">${control.options.find(option => option.value === selectedValue)?.label ?? selectedValue}</div>` as HTMLElement
            : usesDimensionsDropdown(control)
                ? this.createSvgControlHost('ai-media-config-sliding-dropdown-host', group, control, selectedValue, pendingControls)
                : control.kind === 'duration'
                    ? this.createSvgControlHost('ai-media-config-slider-host', group, control, selectedValue, pendingControls)
                    : control.kind === 'toggle'
                        ? this.createToggleControl(group, control, selectedValue)
                        : control.kind === 'number' || control.kind === 'text'
                            ? this.createInputControl(group, control, selectedValue)
                            : this.createSvgControlHost('ai-media-config-sliding-switch-host', group, control, selectedValue, pendingControls)

        return html`
            <div className="ai-media-config-control" data-control-kind=${control.kind}>
                <span className="ai-prompt-model-menu-control-label">${control.label}</span>
                ${field}
                ${control.description ? html`<span className="ai-media-config-description">${control.description}</span>` : undefined}
            </div>
        ` as HTMLElement
    }

    private renderGroup(
        group: RenderedMediaConfigGroup,
        selectionGroups: MediaGenerationConfigSelectionGroup[],
        pendingTagHosts: PendingMediaConfigTagHost[],
        pendingControls: PendingMediaConfigSvgControl[],
    ): HTMLElement {
        const selectionGroup = this.getSelectionForGroup(selectionGroups, group.groupId)
        const modelTags = this.renderModelTags(group.selectedModelIds, pendingTagHosts)
        const controlEls = group.controls.map(control => this.createControl(group, control, selectionGroup, pendingControls))

        return html`
            <div className="ai-media-config-group" data-group-id=${group.groupId}>
                <div className="ai-media-config-group-row">
                    <div className="ai-media-config-group-models">
                        <div className="ai-media-config-group-title">
                            <span className="ai-media-config-provider-title">${group.title}</span>
                            <span className="ai-prompt-model-menu-control-label ai-media-config-models-label">models</span>
                        </div>
                        ${modelTags}
                    </div>
                    <div className="ai-media-config-group-controls">
                        ${controlEls}
                    </div>
                </div>
            </div>
        ` as HTMLElement
    }

    update(): void {
        const groups = this.controls.getUseMultipleModels()
            ? this.getMatrixGroups()
            : []
        const selectionGroups = this.normalizeSelectionGroups(groups)
        const structureSignature = JSON.stringify(groups)
        const connected = this.dom.isConnected
        if (structureSignature === this.renderedStructureSignature && (this.builtConnected || !connected)) {
            this.syncMountedControls(selectionGroups)
            return
        }
        this.renderedStructureSignature = structureSignature
        this.builtConnected = connected || groups.length === 0

        this.destroyTagPills()
        this.destroyMountedControls()
        if (groups.length === 0) {
            this.dom.dataset.visible = 'false'
            this.dom.replaceChildren()
            return
        }

        this.dom.dataset.visible = 'true'
        const pendingTagHosts: PendingMediaConfigTagHost[] = []
        const pendingControls: PendingMediaConfigSvgControl[] = []
        this.dom.replaceChildren(...groups.map(group => this.renderGroup(
            group,
            selectionGroups,
            pendingTagHosts,
            pendingControls,
        )))
        for (const pendingTagHost of pendingTagHosts) {
            this.createTagPill(pendingTagHost.host, pendingTagHost.modelId)
        }
        for (const pendingControl of pendingControls) {
            this.mountSvgControl(pendingControl)
        }
    }

    destroy(): void {
        this.unsubscribe()
        this.destroyTagPills()
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
    let aiModelsData: any[] = aiModelsStore.getData()

    const filterVideoModels = (models: any[]) => {
        return models.filter((m: any) =>
            m.modalities?.some((mod: any) =>
                (mod.modality || mod) === 'video_generation'
            )
        )
    }

    let videoModels = filterVideoModels(aiModelsData)
    const currentVideoModel = controls.getCurrentVideoModel()

    let options = transformModelsToOptions(videoModels)

    const placeholderValue: AiModelDropdownOption = {
        title: 'Video Model',
        icon: '',
        color: '',
        aiModel: '',
        provider: '',
        model: '',
        tags: []
    }

    const selectedValue: AiModelDropdownOption = currentVideoModel
        ? options.find(model => model.aiModel === currentVideoModel) ?? placeholderValue
        : pickDefaultModelOption(options, 'video') ?? placeholderValue

    const dropdown = createPureDropdown({
        id: dropdownId,
        selectedValue,
        options,
        theme: 'dark',
        buttonIcon: chevronDownIcon,
        ignoreColorValuesForOptions: true,
        ignoreColorValuesForSelectedValue: false,
        renderIconForSelectedValue: false,
        renderIconForOptions: true,
        mountToBody: true,
        disableAutoPositioning: false,
        popoverClassName: 'ai-model-selector-popover',
        onSelect: (option: any) => {
            const selected = option as AiModelDropdownOption
            controls.setVideoModel(selected.aiModel)
        }
    })

    // Auto-select the API-configured default video model when none is set, so the
    // video selector defaults to the configured model instead of staying empty.
    if (!currentVideoModel && selectedValue.aiModel) {
        setTimeout(() => {
            if (!controls.getCurrentVideoModel()) {
                controls.setVideoModel(selectedValue.aiModel)
            }
        }, 0)
    }

    let lastProcessedSignature = getModelOptionsSignature(aiModelsData)

    const updateSelection = () => {
        const current = controls.getCurrentVideoModel()
        const matched = options.find(m => m.aiModel === current)
        if (matched) {
            dropdown.update(matched)
            return
        }

        if (!current) {
            const defaultOption = pickDefaultModelOption(options, 'video')
            if (defaultOption) {
                controls.setVideoModel(defaultOption.aiModel)
                dropdown.update(defaultOption)
                return
            }
        }

        dropdown.update(placeholderValue)
    }

    const unsubscribe = aiModelsStore.subscribe((storeState: any) => {
        const newModelsData = storeState.data
        const nextSignature = getModelOptionsSignature(newModelsData)
        if (newModelsData.length === 0 || nextSignature === lastProcessedSignature) return

        lastProcessedSignature = nextSignature
        aiModelsData = newModelsData

        videoModels = filterVideoModels(aiModelsData)
        options = transformModelsToOptions(videoModels)

        dropdown.setOptions({ options })

        const current = controls.getCurrentVideoModel()
        if (!current) {
            const defaultOption = pickDefaultModelOption(options, 'video')
            if (defaultOption) {
                controls.setVideoModel(defaultOption.aiModel)
                dropdown.update(defaultOption)
            }
            return
        }

        updateSelection()
    })

    return {
        dom: dropdown.dom,
        destroy: () => {
            unsubscribe()
            dropdown.destroy?.()
        },
        update: updateSelection
    }
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
