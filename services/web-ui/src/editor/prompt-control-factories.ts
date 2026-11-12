import {
    type PromptControlFactories,
} from '@lixpi/prosemirror/frontend/editor'
import {
    createGenericAiModelDropdown,
    createGenericAiModelMultiSelect,
    createGenericSubmitButton,
    createGenericImageSizeDropdown,
    createGenericImageModelDropdown,
    createGenericImageModelMultiSelect,
    createGenericVideoModelDropdown,
    createGenericVideoModelMultiSelect,
    createGenericVideoAspectDropdown,
    createGenericVideoResolutionDropdown,
    createGenericVideoDurationDropdown,
} from '$src/components/aiModelControls/index.ts'
import { createInstalledCapabilityControls } from '$src/installed-capabilities.ts'

export type { PromptControlFactories }

// The web UI's model, size, submit and Capability controls for the prompt
// input.
export const createDefaultPromptControlFactories = (): PromptControlFactories => {
    return {
        createModelDropdown: createGenericAiModelDropdown,
        createModelMultiSelect: createGenericAiModelMultiSelect,
        createImageModelDropdown: createGenericImageModelDropdown,
        createImageModelMultiSelect: createGenericImageModelMultiSelect,
        createImageSizeDropdown: createGenericImageSizeDropdown,
        createVideoModelDropdown: createGenericVideoModelDropdown,
        createVideoModelMultiSelect: createGenericVideoModelMultiSelect,
        createVideoAspectDropdown: createGenericVideoAspectDropdown,
        createVideoResolutionDropdown: createGenericVideoResolutionDropdown,
        createVideoDurationDropdown: createGenericVideoDurationDropdown,
        createSubmitButton: createGenericSubmitButton,
        createCapabilityControls: createInstalledCapabilityControls,
    }
}
