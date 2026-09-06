import {
    type AiModel,
    type AiModelInputKind,
} from '@lixpi/constants'

// Shape rules a merged model must satisfy before it reaches DynamoDB. These are
// checks, not data, which is why they stay in code while every value they check
// lives in the catalog tree.

const IMAGE_REFERENCE_CONDITIONING_MODES = new Set([
    'edit',
    'identity',
    'style',
    'structure',
    'pose',
])

const AI_MODEL_INPUT_KINDS = new Set<AiModelInputKind>([
    'image',
    'video-frame',
    'audio',
    'document-text',
])

const REQUIRED_FIELDS = [
    'provider',
    'model',
    'modelVersion',
    'title',
    'sortingPosition',
    'color',
    'iconName',
    'modalities',
    'contextWindow',
    'maxCompletionSize',
    'defaultTemperature',
    'inferenceCapabilities',
    'pricing',
] as const

export const assertRequiredFields = (model: AiModel): AiModel => {
    const missing = REQUIRED_FIELDS.filter(field => model[field] === undefined)

    if (missing.length > 0)
        throw new Error(`MODEL_FIELDS_MISSING:${model.provider}:${model.model}:${missing.join(',')}`)

    if (
        !Array.isArray(model.modalities)
        || model.modalities.length === 0
    )
        throw new Error(`MODEL_MODALITIES_INVALID:${model.provider}:${model.model}`)

    if (!model.pricing.currency)
        throw new Error(`MODEL_PRICING_INVALID:${model.provider}:${model.model}`)

    return model
}

export const assertValidInferenceCapabilities = (model: AiModel): AiModel => {
    const profile = model.inferenceCapabilities

    if (!profile)
        throw new Error(`INFERENCE_CAPABILITIES_REQUIRED:${model.provider}:${model.model}`)

    if (
        typeof profile.requiresAutoToolChoiceWithThinking !== 'boolean'
        || typeof profile.supportsTemperature !== 'boolean'
        || typeof profile.supportsSystemPrompt !== 'boolean'
        || typeof profile.requiresClosedJsonSchema !== 'boolean'
    )
        throw new Error(`INFERENCE_CAPABILITIES_FLAGS_INVALID:${model.provider}:${model.model}`)

    if (
        profile.supportedInputKinds.length === 0
        || new Set(profile.supportedInputKinds).size !== profile.supportedInputKinds.length
        || profile.supportedInputKinds.some(kind => !AI_MODEL_INPUT_KINDS.has(kind))
    )
        throw new Error(`INFERENCE_CAPABILITIES_INPUTS_INVALID:${model.provider}:${model.model}`)

    const anthropicThinking = profile.thinkingMode === 'anthropic-manual'
        || profile.thinkingMode === 'anthropic-adaptive'
    const googleThinking = profile.thinkingMode === 'google-budget'
        || profile.thinkingMode === 'google-level'

    if (
        (anthropicThinking && model.provider !== 'Anthropic')
        || (googleThinking && model.provider !== 'Google')
        || profile.requiresAutoToolChoiceWithThinking !== anthropicThinking
    )
        throw new Error(`INFERENCE_CAPABILITIES_THINKING_INVALID:${model.provider}:${model.model}`)

    return model
}

export const assertValidImageReferenceCapabilities = (model: AiModel): AiModel => {
    const supportsImageGeneration = model.modalities.some(({ modality }) => modality === 'image_generation')
    const profile = model.imageReferenceCapabilities

    if (!supportsImageGeneration) {
        if (profile)
            throw new Error(`IMAGE_REFERENCE_CAPABILITIES_UNEXPECTED:${model.provider}:${model.model}`)

        return model
    }

    if (!profile)
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_REQUIRED:${model.provider}:${model.model}`)

    if (
        !Number.isInteger(profile.maxReferenceImages)
        || profile.maxReferenceImages < 0
        || !Number.isInteger(profile.maxIdentityReferenceImages)
        || profile.maxIdentityReferenceImages < 0
        || profile.maxIdentityReferenceImages > profile.maxReferenceImages
    )
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_LIMITS_INVALID:${model.provider}:${model.model}`)

    if (
        profile.conditioningModes.length === 0
        || new Set(profile.conditioningModes).size !== profile.conditioningModes.length
        || profile.conditioningModes.some(mode => !IMAGE_REFERENCE_CONDITIONING_MODES.has(mode))
    )
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_MODES_INVALID:${model.provider}:${model.model}`)

    if (
        !['provider-managed', 'standard', 'high'].includes(profile.inputFidelity)
        || !Number.isInteger(profile.maxOutputPixels)
        || profile.maxOutputPixels <= 0
        || profile.supportedAspectRatios.length === 0
        || profile.supportedAspectRatios.some(ratio => !/^\d+:\d+$/u.test(ratio))
    )
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_PROFILE_INVALID:${model.provider}:${model.model}`)

    if (
        profile.maxIdentityReferenceImages > 0
        && !profile.conditioningModes.includes('identity')
    )
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_IDENTITY_INVALID:${model.provider}:${model.model}`)

    if (
        profile.supportsStructureControl !== profile.conditioningModes.includes('structure')
        || profile.supportsPoseControl !== profile.conditioningModes.includes('pose')
    )
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_CONTROLS_INVALID:${model.provider}:${model.model}`)

    return model
}

export const assertValidVideoGenerationControls = (model: AiModel): AiModel => {
    const supportsVideoGeneration = model.modalities.some(({ modality }) => modality === 'video_generation')
    const controls = model.videoGenerationControls

    if (!supportsVideoGeneration) {
        if (controls?.length)
            throw new Error(`VIDEO_GENERATION_CONTROLS_UNEXPECTED:${model.provider}:${model.model}`)

        return model
    }

    if (!controls?.length)
        throw new Error(`VIDEO_GENERATION_CONTROLS_REQUIRED:${model.provider}:${model.model}`)

    if (new Set(
        controls.map(control => control.key),
    ).size !== controls.length)
        throw new Error(`VIDEO_GENERATION_CONTROL_KEYS_INVALID:${model.provider}:${model.model}`)

    for (const control of controls) {
        const optionValues = control.options.map(option => option.value)

        if (
            !control.label
            || new Set(optionValues).size !== optionValues.length
            || (control.kind !== 'number' && control.kind !== 'text' && optionValues.length === 0)
            || (control.defaultValue !== undefined && control.kind !== 'number' && control.kind !== 'text' && !optionValues.includes(control.defaultValue))
            || (control.kind === 'fixed' && control.readOnly !== true)
        )
            throw new Error(`VIDEO_GENERATION_CONTROL_INVALID:${model.provider}:${model.model}:${control.key}`)
    }

    return model
}

export const validateModel = (model: AiModel): AiModel => assertValidVideoGenerationControls(
    assertValidImageReferenceCapabilities(
        assertValidInferenceCapabilities(
            assertRequiredFields(model),
        ),
    ),
)
