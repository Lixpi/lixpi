import {
    type createAiPromptInputNodeView,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
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

type NodeViewOptions = Parameters<typeof createAiPromptInputNodeView>[0]
export type PromptControlFactories = {
    createContextTray?: NodeViewOptions['createContextTray']
    mountMediaModeSwitch?: NodeViewOptions['mountMediaModeSwitch']
    mountModelMenuControl?: NodeViewOptions['mountModelMenuControl']
    createModelDropdown: NodeViewOptions['createModelDropdown']
    createModelMultiSelect?: NodeViewOptions['createModelMultiSelect']
    createImageModelDropdown: NodeViewOptions['createImageModelDropdown']
    createImageModelMultiSelect?: NodeViewOptions['createImageModelMultiSelect']
    createImageSizeDropdown: NodeViewOptions['createImageSizeDropdown']
    createVideoModelDropdown: NodeViewOptions['createVideoModelDropdown']
    createVideoModelMultiSelect?: NodeViewOptions['createVideoModelMultiSelect']
    createVideoAspectDropdown: NodeViewOptions['createVideoAspectDropdown']
    createVideoResolutionDropdown: NodeViewOptions['createVideoResolutionDropdown']
    createVideoDurationDropdown: NodeViewOptions['createVideoDurationDropdown']
    createSubmitButton: NodeViewOptions['createSubmitButton']
    createCapabilityControls?: NodeViewOptions['createCapabilityControls']
}

export function createDefaultPromptControlFactories(): PromptControlFactories {
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
