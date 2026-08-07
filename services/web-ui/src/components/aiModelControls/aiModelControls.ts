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
        mountToBody: false,
        disableAutoPositioning: true,
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
    let lastProcessedCount = aiModelsData.length

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
        if (newModelsData.length === 0 || newModelsData.length === lastProcessedCount) return

        lastProcessedCount = newModelsData.length
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
        mountToBody: false,
        disableAutoPositioning: true,
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

    let lastProcessedCount = aiModelsData.length

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
        if (newModelsData.length === 0 || newModelsData.length === lastProcessedCount) return

        lastProcessedCount = newModelsData.length
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
    const optionValues = new Set(control.options.map(option => option.value))
    if (value && optionValues.has(value)) return value
    return control.defaultValue || control.options[0]?.value || ''
}

function toDomSafeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '-')
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
    private readonly dropdowns: Array<{ destroy?: () => void }> = []
    private readonly tagPills: TagPillInstance[] = []
    private modelLabelsById = new Map<string, string>()
    private modelIconsById = new Map<string, string>()
    private renderedSignature = ''
    private builtConnected = false

    constructor(private readonly controls: MediaGenerationConfigMatrixControls) {
        this.dom = html`<div className="ai-media-config-matrix" data-media-type=${controls.mediaType} data-visible="false" contenteditable="false"></div>` as HTMLElement
        this.syncModelLabels(aiModelsStore.getData())
        this.unsubscribe = aiModelsStore.subscribe((storeState: any) => {
            this.syncModelLabels(storeState.data)
            this.renderedSignature = ''
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
        if (!this.controls.getUseMultipleModels()) return []

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

    private destroyDropdowns(): void {
        for (const dropdown of this.dropdowns) {
            dropdown.destroy?.()
        }
        this.dropdowns.length = 0
    }

    private destroyTagPills(): void {
        for (const tagPill of this.tagPills) {
            tagPill.destroy()
        }
        this.tagPills.length = 0
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
        this.renderedSignature = ''
        this.update()
    }

    private removeModel(modelId: string): void {
        const nextModelIds = this.controls.getSelectedModelIds()
            .filter((selectedModelId) => selectedModelId !== modelId)
        this.controls.setSelectedModelIds(nextModelIds)
        this.renderedSignature = ''
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
            closable: true,
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

    private createControlDropdown(
        group: RenderedMediaConfigGroup,
        control: MediaGenerationConfigControl,
        selectionGroup: MediaGenerationConfigSelectionGroup | undefined,
    ): HTMLElement {
        const options = control.options.map(option => ({
            title: option.label,
            value: option.value,
        }))
        const selectedValue = normalizeControlValue(control, selectionGroup?.values?.[control.key])
        const selectedOption = options.find(option => option.value === selectedValue) || options[0] || { title: '', value: '' }
        const dropdown = createPureDropdown({
            id: `ai-media-config-${this.controls.mediaType}-${toDomSafeId(group.groupId)}-${control.key}`,
            selectedValue: selectedOption,
            options,
            theme: 'dark',
            buttonIcon: chevronDownIcon,
            ignoreColorValuesForOptions: true,
            ignoreColorValuesForSelectedValue: true,
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            mountToBody: false,
            disableAutoPositioning: true,
            onSelect: (option: any) => this.setGroupControlValue(group, control, option.value),
        })
        this.dropdowns.push(dropdown)

        return html`
            <div className="ai-media-config-control">
                <span className="ai-prompt-model-menu-control-label">${control.label}</span>
                ${dropdown.dom}
            </div>
        ` as HTMLElement
    }

    private renderGroup(
        group: RenderedMediaConfigGroup,
        selectionGroups: MediaGenerationConfigSelectionGroup[],
        pendingTagHosts: PendingMediaConfigTagHost[],
    ): HTMLElement {
        const selectionGroup = this.getSelectionForGroup(selectionGroups, group.groupId)
        const modelTags = this.renderModelTags(group.selectedModelIds, pendingTagHosts)
        const controlEls = group.controls.map(control => this.createControlDropdown(group, control, selectionGroup))

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
        const groups = this.getMatrixGroups()
        const selectionGroups = this.normalizeSelectionGroups(groups)
        const signature = JSON.stringify({ groups, selectionGroups })
        const connected = this.dom.isConnected
        if (signature === this.renderedSignature && (this.builtConnected || !connected)) return
        this.renderedSignature = signature
        this.builtConnected = connected || groups.length === 0

        this.destroyDropdowns()
        this.destroyTagPills()
        if (groups.length === 0) {
            this.dom.dataset.visible = 'false'
            this.dom.replaceChildren()
            return
        }

        this.dom.dataset.visible = 'true'
        const pendingTagHosts: PendingMediaConfigTagHost[] = []
        this.dom.replaceChildren(...groups.map(group => this.renderGroup(group, selectionGroups, pendingTagHosts)))
        for (const pendingTagHost of pendingTagHosts) {
            this.createTagPill(pendingTagHost.host, pendingTagHost.modelId)
        }
    }

    destroy(): void {
        this.unsubscribe()
        this.destroyDropdowns()
        this.destroyTagPills()
        this.dom.remove()
    }
}

export function createMediaGenerationConfigMatrixView(
    controls: MediaGenerationConfigMatrixControls,
): MediaGenerationConfigMatrixViewInstance {
    return new MediaGenerationConfigMatrixView(controls)
}

// Filters models that expose the `video_generation` modality. Mirrors the
// image-model dropdown so the prompt input gets a parallel Video selector that
// can coexist with the image selector — the text model decides between
// generate_image and generate_video based on user intent.
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
        mountToBody: false,
        disableAutoPositioning: true,
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

    let lastProcessedCount = aiModelsData.length

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
        if (newModelsData.length === 0 || newModelsData.length === lastProcessedCount) return

        lastProcessedCount = newModelsData.length
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
