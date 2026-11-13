import {
    type DefaultAiModelCapability,
    type MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'

// The model controls the prompt input mounts. The host builds them from its
// own model catalog and dropdown components.

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

export type MediaGenerationConfigMatrixControls = {
    mediaType: 'reasoning' | 'image' | 'video'
    getSelectedModelIds: () => string[]
    setSelectedModelIds: (modelIds: string[]) => void
    getConfigGroups: () => MediaGenerationConfigSelectionGroup[]
    setConfigGroups: (groups: MediaGenerationConfigSelectionGroup[]) => void
    createModelDropdown: (modelIndex: number) => {
        dom: HTMLElement
        update: () => void
        destroy?: () => void
        closeMenus?: () => void
    }
}

export type MediaGenerationConfigMatrixViewInstance = {
    dom: HTMLElement
    update: () => void
    closeMenus: () => void
    destroy: () => void
}

export type AiModelMenuContentView = {
    dom: HTMLElement
    update: () => void
    destroy: () => void
}

export type AiModelMenuControlItem = {
    label: string | HTMLElement
    control: HTMLElement
    getVisible?: () => boolean
}

export type AiModelMenuSectionConfig = {
    title: string
    helpText: string
    getVisible?: () => boolean
    headingControl?: HTMLElement
    selectedModelTags?: HTMLElement
    controls: AiModelMenuControlItem[]
}

export type PromptModelControlHelpers = {
    applyAiModelMenuStyleSettings: (element: HTMLElement) => void
    createAiModelMenuContent: (sections: AiModelMenuSectionConfig[]) => AiModelMenuContentView
    createMediaGenerationConfigMatrixView: (controls: MediaGenerationConfigMatrixControls) => MediaGenerationConfigMatrixViewInstance
    getModelOptionsForCapability: (
        models: unknown[],
        capability: DefaultAiModelCapability,
    ) => AiModelDropdownOption[]
    transformModelsToOptions: (models: unknown[]) => AiModelDropdownOption[]
}
