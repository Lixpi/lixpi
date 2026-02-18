import {
    sendIcon,
    pauseIcon,
    chevronDownIcon,
    gptAvatarIcon,
    claudeIcon
} from '$src/svgIcons/index.ts'

import { html } from '$src/utils/domTemplates.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import { createPureDropdown } from '$src/components/proseMirror/plugins/primitives/dropdown/index.ts'
import { webUiSettings } from '$src/webUiSettings.ts'

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
}

const AI_AVATAR_ICONS: Record<string, string> = {
    gptAvatarIcon,
    claudeIcon,
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

function extractAvailableTags(models: any[]) {
    const allTags = new Set<string>()
    models.forEach(aiModel => {
        aiModel.modalities?.forEach((m: any) => allTags.add(m.shortTitle))
    })
    return Array.from(allTags).sort()
}

function buildDropdownData(models: any[]) {
    return {
        options: transformModelsToOptions(models),
        tags: extractAvailableTags(models)
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
        enableTagFilter: webUiSettings.useModalityFilterOnModelSelectorDropdown,
        availableTags: webUiSettings.useModalityFilterOnModelSelectorDropdown ? availableTags : [],
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
    const IMAGE_SIZES = [
        { title: '1:1', value: '1024x1024' },
        { title: '3:2', value: '1536x1024' },
        { title: '2:3', value: '1024x1536' },
        { title: 'Auto', value: 'auto' },
    ]

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
        const currentSize = controls.getImageGenerationSize()
        const matched = IMAGE_SIZES.find(s => s.value === currentSize)
        if (matched) {
            dropdown.update(matched)
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
