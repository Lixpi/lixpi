import {
    sendIcon,
    pauseIcon,
    chevronDownIcon,
    gptAvatarIcon,
    claudeIcon,
    geminiIcon,
    stabilityIcon,
    imageIcon
} from '$src/svgIcons/index.ts'

import { html } from '$src/utils/domTemplates.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { createPureDropdown } from '$src/components/dropdown/index.ts'
import { settings } from '$src/settings.ts'

import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

type AiModelDropdownOption = {
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

// Shared shape for the three video option dropdowns (aspect / resolution /
// duration) — same generator pattern as image size but reading a different
// option list off the selected video model.
type VideoOptionControls = {
    getValue: () => string
    setValue: (value: string) => void
    getProvider?: () => string
    getCurrentVideoModel?: () => string
}

const AI_AVATAR_ICONS: Record<string, string> = {
    gptAvatarIcon,
    claudeIcon,
    geminiIcon,
    stabilityIcon,
}

function transformModelsToOptions(models: any[]): AiModelDropdownOption[] {
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

function isResolutionValue(value: string): boolean {
    return /^\d+x\d+$/i.test(value)
}

function isAspectRatioValue(value: string): boolean {
    return /^\d+:\d+$/.test(value)
}

function getImageSizeMode(model: any | undefined): 'resolution' | 'aspectRatio' | 'size' {
    if (model?.imageSizeMode === 'resolution' || model?.imageSizeMode === 'aspectRatio') {
        return model.imageSizeMode
    }

    const values = (model?.imageSizes ?? [])
        .map((option: any) => option.value)
        .filter((value: unknown): value is string => typeof value === 'string' && value !== 'auto')

    if (values.some(isResolutionValue)) return 'resolution'
    if (values.some(isAspectRatioValue)) return 'aspectRatio'
    return 'size'
}

function getImageSizeControlLabel(model: any | undefined): string {
    const mode = getImageSizeMode(model)
    if (mode === 'resolution') return 'Resolution'
    if (mode === 'aspectRatio') return 'Aspect ratio'
    return 'Image option'
}

function findImageSizeModel(models: any[], aiModelId: string | undefined, provider: string | undefined): any | undefined {
    if (aiModelId) {
        const selectedModel = models.find((model: any) => `${model.provider}:${model.model}` === aiModelId && model.imageSizes?.length)
        if (selectedModel) return selectedModel
    }

    if (provider) {
        return models.find((model: any) => model.provider === provider && model.imageSizes?.length)
    }

    return models.find((model: any) => model.imageSizes?.length)
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

    const selectedValue: AiModelDropdownOption =
        aiModelsSelectorDropdownOptions.find(model => model.aiModel === currentAiModel)
        || aiModelsSelectorDropdownOptions[0]
        || placeholderValue

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
        }
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
        if (!current && options.length > 0) {
            const first = options[0]
            controls.setAiModel(first.aiModel)
            dropdown.update(first)
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

        if (controls.isReceiving()) {
            controls.onStop()
            return
        }

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
            <div className="button-receiving">
                <span className="stop-icon" innerHTML=${pauseIcon}></span>
            </div>
        </div>
    `
}

export function createGenericImageSizeDropdown(
    controls: ImageSizeControls,
    dropdownId: string
) {
    const getImageSizeModel = () => {
        const models: any[] = aiModelsStore.getData()
        return findImageSizeModel(
            models,
            controls.getCurrentImageModel?.(),
            controls.getProvider?.(),
        )
    }

    const getSizesForSelectedModel = () => {
        const model = getImageSizeModel()
        const sizes = model?.imageSizes ?? [{ value: 'auto', label: 'Auto' }]
        const mode = getImageSizeMode(model)
        return sizes.map((s: any) => ({
            title: mode === 'resolution' && isResolutionValue(s.value) ? s.value : s.label,
            value: s.value,
        }))
    }

    const getSizeContextKey = () => controls.getCurrentImageModel?.() || controls.getProvider?.() || ''
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
        getControlLabel: () => getImageSizeControlLabel(getImageSizeModel()),
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

    const selectedValue: AiModelDropdownOption =
        options.find(m => m.aiModel === currentImageModel)
        || options[0]
        || placeholderValue

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
        }
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
        if (!current && options.length > 0) {
            controls.setImageModel(options[0].aiModel)
            dropdown.update(options[0])
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

    const selectedValue: AiModelDropdownOption =
        options.find(m => m.aiModel === currentVideoModel)
        || placeholderValue

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

    // Unlike the image model dropdown, do NOT auto-select the first video model.
    // Video generation is opt-in (a single send with image vs video vs neither
    // is a user choice), so leaving the placeholder visible until the user picks
    // keeps `aiVideoModel` empty and `generate_video` un-injected by default.

    let lastProcessedCount = aiModelsData.length

    const updateSelection = () => {
        const current = controls.getCurrentVideoModel()
        const matched = options.find(m => m.aiModel === current)
        if (matched) {
            dropdown.update(matched)
        } else if (!current) {
            dropdown.update(placeholderValue)
        }
    }

    const unsubscribe = aiModelsStore.subscribe((storeState: any) => {
        const newModelsData = storeState.data
        if (newModelsData.length === 0 || newModelsData.length === lastProcessedCount) return

        lastProcessedCount = newModelsData.length
        aiModelsData = newModelsData

        videoModels = filterVideoModels(aiModelsData)
        options = transformModelsToOptions(videoModels)

        dropdown.setOptions({ options })

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
// duration). The option list is read off the currently-selected video model's
// `videoAspectRatios` | `videoResolutions` | `videoDurations` field — the same
// shape (ImageSizeOption[]) the image size dropdown already consumes.
type VideoOptionListKey = 'videoAspectRatios' | 'videoResolutions' | 'videoDurations'

function createGenericVideoOptionDropdown(
    controls: VideoOptionControls,
    dropdownId: string,
    listKey: VideoOptionListKey,
    fallbackLabel: string,
) {
    const getOptionsForModel = (videoAiModel: string) => {
        const [provider, modelId] = (videoAiModel || '').split(':')
        const models: any[] = aiModelsStore.getData()
        let model: any = models.find((m: any) => m.provider === provider && m.model === modelId && Array.isArray(m[listKey]) && m[listKey].length > 0)
        if (!model) {
            model = models.find((m: any) => m.provider === provider && Array.isArray(m[listKey]) && m[listKey].length > 0)
        }
        if (!model) {
            model = models.find((m: any) => Array.isArray(m[listKey]) && m[listKey].length > 0)
        }
        const list = model?.[listKey] ?? [{ value: '', label: fallbackLabel }]
        return list.map((s: any) => ({ title: s.label, value: s.value }))
    }

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
