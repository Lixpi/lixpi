'use strict'

import process from 'process'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { fromSSO } from '@aws-sdk/credential-providers'
import DynamoDBService, { marshall, unmarshall } from '@lixpi/dynamodb-service'

//INFO: do not remove unused imports!
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import {
    GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT,
    getDynamoDbTableStageName,
    MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT,
    type AiModel,
    type AiModelId,
    type AiModelInferenceCapabilities,
    type AiModelInputKind,
    type DefaultAiModelCapability,
    type ImageReferenceCapabilities,
    type ImageSizeMode,
    type ImageSizeOption,
    type MediaGenerationConfigControl,
} from '@lixpi/constants'
import type { PartialDeep } from 'type-fest'

// Modality metadata constants
const MODALITY_METADATA = {
    text: { title: 'Text', shortTitle: 'TXT' },
    image: { title: 'Image', shortTitle: 'IMG' },
    image_generation: { title: 'Image Generation', shortTitle: 'IMG GEN' },
    audio: { title: 'Audio', shortTitle: 'AUDIO' },
    voice: { title: 'Voice', shortTitle: 'VOICE' },
    video: { title: 'Video', shortTitle: 'VID' },
    video_generation: { title: 'Video Generation', shortTitle: 'VID GEN' }
} as const

// Helper function to generate modalities with metadata from modalities array
function generateModalitiesWithMetadata(modalities: string[]): Array<{ modality: string; title: string; shortTitle: string }> {
    return modalities.map(modality => {
        const metadata = MODALITY_METADATA[modality as keyof typeof MODALITY_METADATA]
        return {
            modality,
            title: metadata?.title || modality.charAt(0).toUpperCase() + modality.slice(1),
            shortTitle: metadata?.shortTitle || modality.toUpperCase()
        }
    })
}

// Brand display names per provider key. The provider field stays the internal key
// (DynamoDB partition key / API routing); this maps it to the brand shown to users —
// e.g. BytePlus models are branded ByteDance. Stored per model as providerTitle so
// consumers can use the brand alone or concatenate it with the title themselves.
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    OpenAI: 'OpenAI',
    Anthropic: 'Anthropic',
    Google: 'Google',
    Stability: 'Stability',
    BytePlus: 'ByteDance',
}

const greatestCommonDivisor = (left: number, right: number): number => {
    let dividend = Math.abs(left)
    let divisor = Math.abs(right)

    while (divisor !== 0) {
        const remainder = dividend % divisor
        dividend = divisor
        divisor = remainder
    }

    return dividend
}

// Some image providers accept fixed pixel resolutions even though each option
// represents an aspect-ratio choice in the UI. Keep the provider value intact
// and store the reduced ratio in the persisted display label. Video resolution
// controls are separate metadata and never pass through this mapper.
export const mapResolutionOptionsToAspectRatioLabels = (
    options: ImageSizeOption[],
): ImageSizeOption[] => options.map((option) => {
    const dimensions = option.value.match(/^(\d+)\s*[x×]\s*(\d+)$/i)
    if (!dimensions) return { ...option }

    const width = Number(dimensions[1])
    const height = Number(dimensions[2])
    if (width === 0 || height === 0) return { ...option }

    const divisor = greatestCommonDivisor(width, height)

    return {
        ...option,
        label: `${width / divisor}:${height / divisor}`,
    }
})

const OPENAI_IMAGE_SIZES = mapResolutionOptionsToAspectRatioLabels([
    { value: '1024x1024', label: '1024x1024' },
    { value: '1536x1024', label: '1536x1024' },
    { value: '1024x1536', label: '1024x1536' },
    { value: 'auto', label: 'Auto' },
])

// VEO video-generation option lists. Reuse the ImageSizeOption { value, label }
// shape across every synchronized media-generation control.
const VEO_ASPECT_RATIOS: ImageSizeOption[] = [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
]
const VEO_RESOLUTIONS: ImageSizeOption[] = [
    { value: '720p', label: '720p' },
    {
        value: '1080p',
        label: '1080p',
        description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.resolution?.['1080p'],
    },
]
const VEO_31_RESOLUTIONS: ImageSizeOption[] = [
    ...VEO_RESOLUTIONS,
    {
        value: '4k',
        label: '4K',
        description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.resolution?.['4k'],
    },
]
const VEO_DURATIONS: ImageSizeOption[] = [
    { value: '4', label: '4s' },
    { value: '6', label: '6s' },
    {
        value: '8',
        label: '8s',
        description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.duration?.['8'],
    },
]
const VEO_3_DURATIONS: ImageSizeOption[] = [
    {
        value: '8',
        label: '8s',
        description: GOOGLE_VIDEO_CONFIG_OPTION_HELP_TEXT.duration?.['8'],
    },
]

// Seedance 2.0 (BytePlus ModelArk) option lists. Standard supports up to 4K;
// Fast supports 480p/720p. Both support adaptive aspect ratio and intelligent
// duration selection.
const SEEDANCE_ASPECT_RATIOS: ImageSizeOption[] = [
    { value: '16:9', label: '16:9' },
    { value: '4:3', label: '4:3' },
    { value: '1:1', label: '1:1' },
    { value: '3:4', label: '3:4' },
    { value: '9:16', label: '9:16' },
    { value: '21:9', label: '21:9' },
    { value: 'adaptive', label: 'Auto' },
]
const SEEDANCE_STANDARD_RESOLUTIONS: ImageSizeOption[] = [
    { value: '480p', label: '480p' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '4k', label: '4K' },
]
const SEEDANCE_FAST_RESOLUTIONS: ImageSizeOption[] = [
    { value: '480p', label: '480p' },
    { value: '720p', label: '720p' },
]
const SEEDANCE_DURATIONS: ImageSizeOption[] = [
    {
        value: '-1',
        label: 'Smart length',
        description: 'Smart length lets Seedance choose any duration from 4 to 15 seconds.',
    },
    { value: '4', label: '4s' },
    { value: '5', label: '5s' },
    { value: '6', label: '6s' },
    { value: '7', label: '7s' },
    { value: '8', label: '8s' },
    { value: '9', label: '9s' },
    { value: '10', label: '10s' },
    { value: '11', label: '11s' },
    { value: '12', label: '12s' },
    { value: '13', label: '13s' },
    { value: '14', label: '14s' },
    { value: '15', label: '15s' },
]

const toggleControl = (
    key: MediaGenerationConfigControl['key'],
    label: string,
    defaultValue: 'true' | 'false',
    description?: string,
): MediaGenerationConfigControl => ({
    key,
    label,
    kind: 'toggle',
    options: [
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
    ],
    defaultValue,
    ...(description ? { description } : {}),
})

const buildVeoControls = (
    resolutions: ImageSizeOption[],
    durations: ImageSizeOption[] = VEO_DURATIONS,
): MediaGenerationConfigControl[] => [
    {
        key: 'aspectRatio',
        label: 'Aspect ratio',
        kind: 'aspect-ratio',
        options: VEO_ASPECT_RATIOS,
        defaultValue: '16:9',
    },
    {
        key: 'resolution',
        label: 'Resolution',
        kind: 'segmented',
        options: resolutions,
        defaultValue: '720p',
    },
    {
        key: 'duration',
        label: 'Duration',
        kind: 'duration',
        options: durations,
        defaultValue: '8',
    },
    {
        key: 'seed',
        label: 'Seed',
        kind: 'number',
        options: [],
        placeholder: 'Random',
        min: 0,
        max: 4294967295,
        step: 1,
        description: 'Use the same seed to improve consistency between generations.',
    },
]

const buildSeedanceControls = (resolutions: ImageSizeOption[]): MediaGenerationConfigControl[] => [
    {
        key: 'aspectRatio',
        label: 'Aspect ratio',
        kind: 'aspect-ratio',
        options: SEEDANCE_ASPECT_RATIOS,
        defaultValue: '16:9',
    },
    {
        key: 'resolution',
        label: 'Resolution',
        kind: 'segmented',
        options: resolutions,
        defaultValue: '720p',
    },
    {
        key: 'duration',
        label: 'Duration',
        kind: 'duration',
        options: SEEDANCE_DURATIONS,
        defaultValue: '-1',
    },
    {
        key: 'seed',
        label: 'Seed',
        kind: 'number',
        options: [],
        placeholder: 'Random',
        step: 1,
    },
    toggleControl(
        'cameraFixed',
        'Fixed camera',
        'false',
        MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT.cameraFixed,
    ),
    toggleControl(
        'watermark',
        'Watermark',
        'false',
        MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT.watermark,
    ),
    toggleControl(
        'returnLastFrame',
        'Return last frame',
        'false',
        MEDIA_GENERATION_CONFIG_TOGGLE_HELP_TEXT.returnLastFrame,
    ),
]

const VEO_CONTROLS = buildVeoControls(VEO_31_RESOLUTIONS)
const VEO_LITE_CONTROLS = buildVeoControls(VEO_RESOLUTIONS)
const VEO_3_CONTROLS = buildVeoControls(VEO_RESOLUTIONS, VEO_3_DURATIONS)
const SEEDANCE_STANDARD_CONTROLS = buildSeedanceControls(SEEDANCE_STANDARD_RESOLUTIONS)
const SEEDANCE_FAST_CONTROLS = buildSeedanceControls(SEEDANCE_FAST_RESOLUTIONS)

const OPENAI_PROVIDER_MANAGED_IMAGE_REFERENCES: ImageReferenceCapabilities = {
    maxReferenceImages: 16,
    maxIdentityReferenceImages: 5,
    conditioningModes: ['edit', 'identity', 'style'],
    inputFidelity: 'provider-managed',
    supportsIterativeEdit: true,
    supportsMask: true,
    supportsStructureControl: false,
    supportsPoseControl: false,
    supportsDeterministicSeed: false,
    maxOutputPixels: 1572864,
    supportedAspectRatios: ['1:1', '3:2', '2:3'],
}

const OPENAI_HIGH_IMAGE_REFERENCES: ImageReferenceCapabilities = {
    ...OPENAI_PROVIDER_MANAGED_IMAGE_REFERENCES,
    inputFidelity: 'high',
}

const OPENAI_STANDARD_IMAGE_REFERENCES: ImageReferenceCapabilities = {
    ...OPENAI_PROVIDER_MANAGED_IMAGE_REFERENCES,
    inputFidelity: 'standard',
}

const GOOGLE_IMAGE_REFERENCES: ImageReferenceCapabilities = {
    maxReferenceImages: 14,
    maxIdentityReferenceImages: 5,
    conditioningModes: ['edit', 'identity', 'style', 'structure', 'pose'],
    inputFidelity: 'provider-managed',
    supportsIterativeEdit: true,
    supportsMask: false,
    supportsStructureControl: true,
    supportsPoseControl: true,
    supportsDeterministicSeed: false,
    maxOutputPixels: 4194304,
    supportedAspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '21:9'],
}

const STABILITY_IMAGE_REFERENCES: ImageReferenceCapabilities = {
    maxReferenceImages: 2,
    maxIdentityReferenceImages: 0,
    conditioningModes: ['edit', 'style', 'structure'],
    inputFidelity: 'standard',
    supportsIterativeEdit: true,
    supportsMask: false,
    supportsStructureControl: true,
    supportsPoseControl: false,
    supportsDeterministicSeed: true,
    maxOutputPixels: 4194304,
    supportedAspectRatios: ['1:1', '21:9', '16:9', '3:2', '5:4', '4:5', '2:3', '9:16', '9:21'],
}

const OPENAI_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: true,
    supportedInputKinds: ['image', 'video-frame', 'document-text'],
}

const OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    ...OPENAI_INFERENCE_CAPABILITIES,
    supportsTemperature: false,
}

const ANTHROPIC_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['image', 'video-frame', 'document-text'],
}

const ANTHROPIC_MANUAL_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    ...ANTHROPIC_INFERENCE_CAPABILITIES,
    thinkingMode: 'anthropic-manual',
    requiresAutoToolChoiceWithThinking: true,
}

const ANTHROPIC_ADAPTIVE_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    ...ANTHROPIC_INFERENCE_CAPABILITIES,
    thinkingMode: 'anthropic-adaptive',
    requiresAutoToolChoiceWithThinking: true,
}

const ANTHROPIC_ADAPTIVE_NO_TEMPERATURE_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    ...ANTHROPIC_ADAPTIVE_INFERENCE_CAPABILITIES,
    supportsTemperature: false,
}

const GOOGLE_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: true,
    supportsSystemPrompt: true,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['image', 'video-frame', 'audio', 'document-text'],
}

const GOOGLE_BUDGET_THINKING_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    ...GOOGLE_INFERENCE_CAPABILITIES,
    thinkingMode: 'google-budget',
}

const GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    ...GOOGLE_INFERENCE_CAPABILITIES,
    thinkingMode: 'google-level',
}

const NON_REASONING_INFERENCE_CAPABILITIES: AiModelInferenceCapabilities = {
    thinkingMode: 'none',
    requiresAutoToolChoiceWithThinking: false,
    supportsTemperature: false,
    supportsSystemPrompt: false,
    requiresClosedJsonSchema: false,
    supportedInputKinds: ['document-text'],
}

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

export function assertValidInferenceCapabilities(model: AiModel): AiModel {
    const profile = model.inferenceCapabilities
    if (!profile) throw new Error(`INFERENCE_CAPABILITIES_REQUIRED:${model.provider}:${model.model}`)
    if (typeof profile.requiresAutoToolChoiceWithThinking !== 'boolean'
        || typeof profile.supportsTemperature !== 'boolean'
        || typeof profile.supportsSystemPrompt !== 'boolean'
        || typeof profile.requiresClosedJsonSchema !== 'boolean') {
        throw new Error(`INFERENCE_CAPABILITIES_FLAGS_INVALID:${model.provider}:${model.model}`)
    }
    if (profile.supportedInputKinds.length === 0
        || new Set(profile.supportedInputKinds).size !== profile.supportedInputKinds.length
        || profile.supportedInputKinds.some(kind => !AI_MODEL_INPUT_KINDS.has(kind))) {
        throw new Error(`INFERENCE_CAPABILITIES_INPUTS_INVALID:${model.provider}:${model.model}`)
    }
    const anthropicThinking = profile.thinkingMode === 'anthropic-manual'
        || profile.thinkingMode === 'anthropic-adaptive'
    const googleThinking = profile.thinkingMode === 'google-budget'
        || profile.thinkingMode === 'google-level'
    if ((anthropicThinking && model.provider !== 'Anthropic')
        || (googleThinking && model.provider !== 'Google')
        || profile.requiresAutoToolChoiceWithThinking !== anthropicThinking) {
        throw new Error(`INFERENCE_CAPABILITIES_THINKING_INVALID:${model.provider}:${model.model}`)
    }
    return model
}

export function assertValidImageReferenceCapabilities(model: AiModel): AiModel {
    const supportsImageGeneration = model.modalities.some(({ modality }) => modality === 'image_generation')
    const profile = model.imageReferenceCapabilities
    if (!supportsImageGeneration) {
        if (profile) throw new Error(`IMAGE_REFERENCE_CAPABILITIES_UNEXPECTED:${model.provider}:${model.model}`)
        return model
    }
    if (!profile) throw new Error(`IMAGE_REFERENCE_CAPABILITIES_REQUIRED:${model.provider}:${model.model}`)
    if (!Number.isInteger(profile.maxReferenceImages) || profile.maxReferenceImages < 0
        || !Number.isInteger(profile.maxIdentityReferenceImages) || profile.maxIdentityReferenceImages < 0
        || profile.maxIdentityReferenceImages > profile.maxReferenceImages) {
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_LIMITS_INVALID:${model.provider}:${model.model}`)
    }
    if (profile.conditioningModes.length === 0
        || new Set(profile.conditioningModes).size !== profile.conditioningModes.length
        || profile.conditioningModes.some(mode => !IMAGE_REFERENCE_CONDITIONING_MODES.has(mode))) {
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_MODES_INVALID:${model.provider}:${model.model}`)
    }
    if (!['provider-managed', 'standard', 'high'].includes(profile.inputFidelity)
        || !Number.isInteger(profile.maxOutputPixels) || profile.maxOutputPixels <= 0
        || profile.supportedAspectRatios.length === 0
        || profile.supportedAspectRatios.some(ratio => !/^\d+:\d+$/u.test(ratio))) {
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_PROFILE_INVALID:${model.provider}:${model.model}`)
    }
    if (profile.maxIdentityReferenceImages > 0 && !profile.conditioningModes.includes('identity')) {
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_IDENTITY_INVALID:${model.provider}:${model.model}`)
    }
    if (profile.supportsStructureControl !== profile.conditioningModes.includes('structure')
        || profile.supportsPoseControl !== profile.conditioningModes.includes('pose')) {
        throw new Error(`IMAGE_REFERENCE_CAPABILITIES_CONTROLS_INVALID:${model.provider}:${model.model}`)
    }
    return model
}

export function assertValidVideoGenerationControls(model: AiModel): AiModel {
    const supportsVideoGeneration = model.modalities.some(({ modality }) => modality === 'video_generation')
    const controls = model.videoGenerationControls
    if (!supportsVideoGeneration) {
        if (controls?.length) throw new Error(`VIDEO_GENERATION_CONTROLS_UNEXPECTED:${model.provider}:${model.model}`)
        return model
    }
    if (!controls?.length) throw new Error(`VIDEO_GENERATION_CONTROLS_REQUIRED:${model.provider}:${model.model}`)
    if (new Set(controls.map(control => control.key)).size !== controls.length) {
        throw new Error(`VIDEO_GENERATION_CONTROL_KEYS_INVALID:${model.provider}:${model.model}`)
    }
    for (const control of controls) {
        const optionValues = control.options.map(option => option.value)
        if (!control.label
            || new Set(optionValues).size !== optionValues.length
            || (control.kind !== 'number' && control.kind !== 'text' && optionValues.length === 0)
            || (control.defaultValue !== undefined
                && control.kind !== 'number'
                && control.kind !== 'text'
                && !optionValues.includes(control.defaultValue))
            || (control.kind === 'fixed' && control.readOnly !== true)) {
            throw new Error(`VIDEO_GENERATION_CONTROL_INVALID:${model.provider}:${model.model}:${control.key}`)
        }
    }
    return model
}

// OpenAI API types (using SDK types)
type OpenAIModel = OpenAI.Models.Model
type AnthropicModel = {
    id: string
    display_name?: string
    created_at?: string
    type?: string
}

type GoogleModel = {
    name: string
    displayName?: string
    description?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
}

// Blacklist rules per provider: exact, prefix, and contains (partial-name) patterns
type ProviderBlacklist = {
    exact: string[]
    prefix: string[]
    contains: string[]
}

// Default model capability/settings per provider.
type ModelDefaults = Pick<
    AiModel,
    'contextWindow' | 'maxCompletionSize' | 'defaultTemperature' | 'inferenceCapabilities' | 'modalities' | 'pricing' | 'color' | 'iconName' | 'colorIconName' | 'imageReferenceCapabilities'
> & {
    imagePromptMaxChars?: number
    imageSizeMode?: ImageSizeMode
    imageSizes?: ImageSizeOption[]
    videoAspectRatios?: ImageSizeOption[]
    videoResolutions?: ImageSizeOption[]
    videoDurations?: ImageSizeOption[]
    videoGenerationControls?: MediaGenerationConfigControl[]
    videoMaxReferenceImages?: number
    // Not part of AiModel, used only for provider-grouped sorting
    starSortingPosition: number
    // Transform functions for model properties
    transforms?: {
        [key: string]: (...args: any[]) => any
    }
}

type ProviderModelDefaults = {
    exact: Record<string, PartialDeep<ModelDefaults>>
    prefix: Array<{ prefix: string; values: PartialDeep<ModelDefaults> }>
    contains: Array<{ includes: string; values: PartialDeep<ModelDefaults> }>
    fallback?: ModelDefaults
}

export type AiModelsSyncOptions = {
    dynamoDBService?: DynamoDBService
    openaiApiKey?: string
    anthropicApiKey?: string
    googleApiKey?: string
    stabilityApiKey?: string
}

export type AiModelsSyncResult = {
    openAI: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    anthropic: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    google: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    stability: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    byteplus: {
        processed: number
        newModels: number
        updatedModels: number
        deletedModels: number
    }
    totalProcessed: number
    totalNew: number
    totalUpdated: number
    totalDeleted: number
}

export class AiModelsSync {
    private readonly dynamoDBService: DynamoDBService
    private readonly openai: OpenAI
    private readonly anthropic: Anthropic
    // When the API routes Anthropic inference through AWS Bedrock there may be no Anthropic
    // API key at all, so the catalog is sourced from the Bedrock foundation-model list instead.
    private readonly useBedrockForAnthropic: boolean
    private readonly google: GoogleGenAI
    private readonly aiModelsListTableName: string
    private readonly serviceName: string

    constructor(options: AiModelsSyncOptions = {}) {
        const env = process.env

        // Use provided DynamoDB service or create a new one
        this.dynamoDBService = options.dynamoDBService || new DynamoDBService({
            region: env.AWS_REGION,
            ssoProfile: env.AWS_PROFILE,
            ...(env.DYNAMODB_ENDPOINT && { endpoint: env.DYNAMODB_ENDPOINT }),    // For local development only
        })

        this.openai = new OpenAI({
            apiKey: options.openaiApiKey || env.OPENAI_API_KEY,
        })

        this.anthropic = new Anthropic({
            apiKey: options.anthropicApiKey || env.ANTHROPIC_API_KEY,
        })
        this.useBedrockForAnthropic = env.ANTHROPIC_USE_AWS_BEDROCK_INFERENCE?.trim().toLowerCase() === 'true'

        this.google = new GoogleGenAI({
            apiKey: options.googleApiKey || env.GOOGLE_API_KEY,
        })

        this.aiModelsListTableName = getDynamoDbTableStageName('AI_MODELS_LIST', env.ORG_NAME!, env.STAGE!)
        this.serviceName = 'ai-models-sync-service'
    }

    // Default model selection per capability, projected to the UI via the catalog.
    // The matching synced model is flagged with `isDefaultFor` so the API can derive
    // AiModelsCatalogResponse.defaultModels. Keep each id (`provider:model`) present
    // in the synced catalog and out of the blacklist above.
    private static readonly DEFAULT_MODELS: Record<DefaultAiModelCapability, AiModelId> = {
        // Anthropic Claude Haiku — default reasoning/chat model.
        reasoning: 'Anthropic:claude-haiku-4-5',
        // Google Gemini 2.5 Flash Image — default image generation model.
        image: 'Google:gemini-2.5-flash-image',
        // Google Veo 3.1 Lite — default video generation model.
        video: 'Google:veo-3.1-lite-generate-preview',
    }

    // Tag a mapped model with the capabilities it is the catalog default for.
    private applyDefaultModelFlags(model: AiModel): AiModel {
        const modelId = `${model.provider}:${model.model}` as AiModelId
        const isDefaultFor = (Object.keys(AiModelsSync.DEFAULT_MODELS) as DefaultAiModelCapability[])
            .filter(capability => AiModelsSync.DEFAULT_MODELS[capability] === modelId)
        if (isDefaultFor.length > 0) {
            model.isDefaultFor = isDefaultFor
        }
        return model
    }

    // Blacklist rules per provider: exact, prefix, and contains (partial-name) patterns
    private static readonly MODELS_BLACKLIST: { OpenAI: ProviderBlacklist; Anthropic: ProviderBlacklist; Google: ProviderBlacklist; Stability: ProviderBlacklist; BytePlus: ProviderBlacklist } = {
        OpenAI: {
            // Exact matches (use for cases like 'gpt-4' to avoid excluding 'gpt-4o')
            exact: [
                'gpt-4',
                'gpt-4o',
                'gpt-5',
            ],
            // Prefix matches (legacy families)
            prefix: [
                'gpt-3.5',
                'gpt-4-',
                'gpt-4-turbo',
                'gpt-4.1',
                'gpt-4o',
                'gpt-5-',
                'gpt-5.1',
                'gpt-5.2',
                'gpt-5.3',
                'o1',
                'text-',
                'code-',
                'davinci',
                'curie',
                'babbage',
                'ada',
                'dall-e',
                'tts',
                'whisper'
            ],
            // Contains (partial-name) matches
            contains: [
                '-mini',
                '-nano',
                '-codex',
                '-realtime',
                '-audio',
                '-transcribe',
                'chatgpt',
            ]
        },
        Anthropic: {
            exact: [],
            prefix: [
                'claude-3-opus',
                'claude-3-5-sonnet',
                'claude-3-7',
                'claude-sonnet-4-5',
                'claude-sonnet-4-20',
                'claude-opus-4-5',
                'claude-opus-4-1',
                'claude-opus-4-20',
            ],
            contains: []
        },
        Google: {
            exact: [],
            prefix: [
                'gemini-1.0',
                'gemini-1.5',
                'gemini-2.0',
                'gemini-2.5',
                'gemini-3-flash',
                'gemini-3-pro',
                'gemini-3.1-flash-lite',
                'gemini-3.1-pro',
                'gemini-flash-lite',
                'gemini-embedding',
                'gemma',
                'text-embedding',
                'embedding',
                'aqa',
                'deep-research',
                'nano-banana',
            ],
            contains: [
                '-tts-',
                '-live-',
                '-native-audio-',
                '-robotics-',
                '-computer-use-',
                'imagen',
                'lyria',
            ]
        },
        Stability: {
            exact: [],
            prefix: [],
            contains: []
        },
        // BytePlus models are a fixed static list (no list-models API), so nothing
        // needs blacklisting — kept for shape parity with the other providers.
        BytePlus: {
            exact: [],
            prefix: [],
            contains: []
        }
    }

    // Default model capability/settings per provider.
    private static readonly MODELS_DEFAULTS: { OpenAI: ProviderModelDefaults; Anthropic: ProviderModelDefaults; Google: ProviderModelDefaults; Stability: ProviderModelDefaults; BytePlus: ProviderModelDefaults } = {
        // OpenAI model defaults sourced from offline docs provided in temp-openai-models-info/.
        // Only differences from fallback are specified; remaining fields inherit via mergeWithFallback.
        OpenAI: {
            exact: {
                // ChatGPT-4o alias page shows 128k context, 16,384 max output tokens
                'chatgpt-4o-latest': { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '15.00' } } } } },
                // GPT-5 Chat latest explicit alias
                'gpt-5-chat-latest': { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } },
            },
            prefix: [
                {
                    prefix: 'gpt-5', values: {
                    contextWindow: 400000,
                    maxCompletionSize: 128000,
                    modalities: ['text', 'image'],
                    defaultTemperature: 1,    // Supports only default value 1.
                    inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES,
                    pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } }
                },
                // GPT-5 Chat family: 128k context, 16,384 max output
                { prefix: 'gpt-5-chat', values: { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } } },
                // GPT-4.1 family: ~1M context window, 32,768 max output
                { prefix: 'gpt-4.1', values: { contextWindow: 1047576, maxCompletionSize: 32768, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.00', completion: '8.00' } } } } } },
                // GPT-4o (chat) family: 128k context, 16,384 max output
                { prefix: 'gpt-4o', values: { contextWindow: 128000, maxCompletionSize: 16384, modalities: ['text', 'image'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.50', completion: '10.00' } } } } } },
                // GPT-4o Realtime family: 32k context, 4,096 max output; supports audio
                { prefix: 'gpt-4o-realtime', values: { contextWindow: 32000, maxCompletionSize: 4096, modalities: ['text', 'image', 'audio'], pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '20.00' } } }, audio: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '40.00', completion: '80.00' } } } },
                // O3 Deep Research: 200k context, 100k max output
                { prefix: 'o3-deep-research', values: { contextWindow: 200000, maxCompletionSize: 100000, modalities: ['text'], inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '10.00', completion: '40.00' } } } } } },
                // O4 Mini Deep Research: 200k context, 100k max output (per page)
                { prefix: 'o4-mini-deep-research', values: { contextWindow: 200000, maxCompletionSize: 100000, modalities: ['text'], inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.00', completion: '8.00' } } } } } },
                { prefix: 'o1', values: { inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES } },
                { prefix: 'o3', values: { inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES } },
                { prefix: 'o4', values: { inferenceCapabilities: OPENAI_NO_TEMPERATURE_INFERENCE_CAPABILITIES } },
                // GPT Image family: image generation models
                { prefix: 'gpt-image-2', values: { modalities: ['text', 'image', 'image_generation'], imageReferenceCapabilities: OPENAI_PROVIDER_MANAGED_IMAGE_REFERENCES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '10.00' } } }, image: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '8.00', completion: '32.00' } } } },
                { prefix: 'gpt-image-1.5', values: { modalities: ['text', 'image', 'image_generation'], imageReferenceCapabilities: OPENAI_HIGH_IMAGE_REFERENCES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '10.00' } } }, image: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '8.00', completion: '32.00' } } } },
                { prefix: 'gpt-image-1-mini', values: { modalities: ['text', 'image', 'image_generation'], imageReferenceCapabilities: OPENAI_STANDARD_IMAGE_REFERENCES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.00', completion: '0.00' } } }, image: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '2.50', completion: '8.00' } } } },
                { prefix: 'gpt-image-1', values: { modalities: ['text', 'image', 'image_generation'], imageReferenceCapabilities: OPENAI_HIGH_IMAGE_REFERENCES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '0.00' } } }, image: { measuringUnit: 'tokens', pricePer: '1000000', prompt: '10.00', completion: '40.00' } } } },
            ],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                inferenceCapabilities: OPENAI_INFERENCE_CAPABILITIES,
                modalities: ['text'],
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',    // for example set to 1.2 to add 20% margin
                    text: {
                        measuringUnit: 'tokens',
                        pricePer: '1000000',
                        tiers: { default: { prompt: '0.00', completion: '0.00' } }
                    }
                },
                // Provider UI defaults
                color: '#56967c',
                iconName: 'gptAvatarIcon',
                imageSizeMode: 'aspectRatio',
                imageSizes: OPENAI_IMAGE_SIZES,
                // Base offset for sorting; used to group providers
                starSortingPosition: 200,
                transforms: {
                    title: (modelId: string) => {
                        return modelId
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gpt') return 'GPT'
                                if (part.toLowerCase() === 'o1') return 'O1'
                                if (part.toLowerCase() === 'o3') return 'O3'
                                if (part.toLowerCase() === 'o4') return 'O4'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                    },
                    shortTitle: (modelId: string) => {
                        const title = modelId
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gpt') return 'GPT'
                                if (part.toLowerCase() === 'o1') return 'O1'
                                if (part.toLowerCase() === 'o3') return 'O3'
                                if (part.toLowerCase() === 'o4') return 'O4'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                        // Remove "Latest" suffix if present
                        return title.replace(/\s+Latest$/i, '')
                    }
                }
            }
        },
        // Anthropic model defaults sourced from the official Models overview.
        // Claude 5 uses its full 1M context window and 128k synchronous output limit.
        Anthropic: {
            exact: {},
            prefix: [
                { prefix: 'claude-opus-5', values: { contextWindow: 1000000, maxCompletionSize: 128000, inferenceCapabilities: ANTHROPIC_ADAPTIVE_NO_TEMPERATURE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '5.00', completion: '25.00' } } } } } },
                { prefix: 'claude-sonnet-5', values: { contextWindow: 1000000, maxCompletionSize: 128000, inferenceCapabilities: ANTHROPIC_ADAPTIVE_NO_TEMPERATURE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '2.00', completion: '10.00' } } } } } },
                { prefix: 'claude-opus-4-7', values: { contextWindow: 200000, maxCompletionSize: 32000, inferenceCapabilities: ANTHROPIC_ADAPTIVE_NO_TEMPERATURE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '15.00', completion: '75.00' } } } } } },
                { prefix: 'claude-opus-4-6', values: { contextWindow: 200000, maxCompletionSize: 32000, inferenceCapabilities: ANTHROPIC_ADAPTIVE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '15.00', completion: '75.00' } } } } } },
                { prefix: 'claude-sonnet-4-6', values: { contextWindow: 200000, maxCompletionSize: 64000, inferenceCapabilities: ANTHROPIC_ADAPTIVE_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '3.00', completion: '15.00' } } } } } },
                { prefix: 'claude-opus-4-1', values: { contextWindow: 200000, maxCompletionSize: 32000, inferenceCapabilities: ANTHROPIC_MANUAL_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '15.00', completion: '75.00' } } } } } },
                { prefix: 'claude-opus-4', values: { contextWindow: 200000, maxCompletionSize: 32000, inferenceCapabilities: ANTHROPIC_MANUAL_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '15.00', completion: '75.00' } } } } } },
                { prefix: 'claude-sonnet-4', values: { contextWindow: 200000, maxCompletionSize: 64000, inferenceCapabilities: ANTHROPIC_MANUAL_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '3.00', completion: '15.00' } } } } } },
                { prefix: 'claude-haiku-4', values: { contextWindow: 200000, maxCompletionSize: 8192, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.00', completion: '5.00' } } } } } },
                { prefix: 'claude-3-7-sonnet', values: { contextWindow: 200000, maxCompletionSize: 64000, inferenceCapabilities: ANTHROPIC_MANUAL_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '3.00', completion: '15.00' } } } } } },
                { prefix: 'claude-3-5-haiku', values: { contextWindow: 200000, maxCompletionSize: 8192, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.00', completion: '5.00' } } } } } },
                { prefix: 'claude-3-haiku', values: { contextWindow: 200000, maxCompletionSize: 4096, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.00', completion: '5.00' } } } } } },
                { prefix: 'claude-mythos', values: { inferenceCapabilities: ANTHROPIC_ADAPTIVE_INFERENCE_CAPABILITIES } },
            ],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                inferenceCapabilities: ANTHROPIC_INFERENCE_CAPABILITIES,
                modalities: ['text', 'image'],
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',
                    text: {
                        measuringUnit: 'tokens',
                        pricePer: '1000000',
                        tiers: { default: { prompt: '0.00', completion: '0.00' } }
                    }
                },
                color: '#D97757',
                iconName: 'claudeIcon',
                starSortingPosition: 100,
                transforms: {
                    title: (modelId: string, displayName?: string) => {
                        return displayName || modelId
                            .split('-')
                            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                            .join(' ')
                    },
                    shortTitle: (modelId: string, displayName?: string) => {
                        const fullTitle = displayName || modelId
                            .split('-')
                            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                            .join(' ')
                        // Remove "Claude " prefix if present
                        return fullTitle.replace(/^Claude\s+/i, '')
                    }
                }
            }
        },
        Google: {
            exact: {
                'gemini-2.5-flash-preview-image-generation': {
                    contextWindow: 1048576,
                    maxCompletionSize: 65536,
                    modalities: ['text', 'image', 'image_generation'],
                    inferenceCapabilities: GOOGLE_BUDGET_THINKING_INFERENCE_CAPABILITIES,
                    imageReferenceCapabilities: GOOGLE_IMAGE_REFERENCES,
                    pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } }
                },
                'gemini-2.5-flash-image': {
                    contextWindow: 1048576,
                    maxCompletionSize: 65536,
                    modalities: ['text', 'image', 'image_generation'],
                    inferenceCapabilities: GOOGLE_BUDGET_THINKING_INFERENCE_CAPABILITIES,
                    imageReferenceCapabilities: GOOGLE_IMAGE_REFERENCES,
                    pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } }
                },
            },
            prefix: [
                // Gemini 2.5 Pro family (text-only)
                { prefix: 'gemini-2.5-pro', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], inferenceCapabilities: GOOGLE_BUDGET_THINKING_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } } },
                // Gemini 2.5 Flash family (text-only, image generation only in gemini-2.5-flash-image)
                { prefix: 'gemini-2.5-flash', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], inferenceCapabilities: GOOGLE_BUDGET_THINKING_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } } } } },
                // Gemini 3 Pro Image (Nano Banana Pro)
                { prefix: 'gemini-3-pro-image', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text', 'image', 'image_generation'], inferenceCapabilities: GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES, imageReferenceCapabilities: GOOGLE_IMAGE_REFERENCES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '5.00' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } } } },
                // Gemini 3.1 Flash Image (Nano Banana 2)
                { prefix: 'gemini-3.1-flash-image', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text', 'image', 'image_generation'], inferenceCapabilities: GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES, imageReferenceCapabilities: GOOGLE_IMAGE_REFERENCES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } }, image: { measuringUnit: 'images', pricePer: '1', prompt: '0.00', completion: '0.039' } } } },
                // Gemini 3.1 Pro
                { prefix: 'gemini-3.1-pro', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], inferenceCapabilities: GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '1.25', completion: '10.00' } } } } } },
                // Gemini 3.1 Flash
                { prefix: 'gemini-3.1-flash', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], inferenceCapabilities: GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } } } } },
                // Gemini 3 Flash
                { prefix: 'gemini-3-flash', values: { contextWindow: 1048576, maxCompletionSize: 65536, modalities: ['text'], inferenceCapabilities: GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES, pricing: { text: { measuringUnit: 'tokens', pricePer: '1000000', tiers: { default: { prompt: '0.15', completion: '0.60' } } } } } },
                { prefix: 'gemini-3.', values: { inferenceCapabilities: GOOGLE_LEVEL_THINKING_INFERENCE_CAPABILITIES } },
                // VEO 3 / 3.1 video generation models (billed per second of video).
                // Prices are placeholders to reconcile against https://ai.google.dev/gemini-api/docs/pricing.
                // More-specific prefixes (fast/lite) must precede the general prefix so resolveModelDefaults matches them first.
                { prefix: 'veo-3.0-fast', values: { modalities: ['video', 'video_generation'], inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES, videoAspectRatios: VEO_ASPECT_RATIOS, videoResolutions: VEO_RESOLUTIONS, videoDurations: VEO_3_DURATIONS, videoGenerationControls: VEO_3_CONTROLS, pricing: { video: { measuringUnit: 'seconds', pricePer: '1', price: '0.15' } } } },
                { prefix: 'veo-3.0', values: { modalities: ['video', 'video_generation'], inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES, videoAspectRatios: VEO_ASPECT_RATIOS, videoResolutions: VEO_RESOLUTIONS, videoDurations: VEO_3_DURATIONS, videoGenerationControls: VEO_3_CONTROLS, pricing: { video: { measuringUnit: 'seconds', pricePer: '1', price: '0.40' } } } },
                { prefix: 'veo-3.1-fast', values: { modalities: ['video', 'video_generation'], inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES, videoAspectRatios: VEO_ASPECT_RATIOS, videoResolutions: VEO_31_RESOLUTIONS, videoDurations: VEO_DURATIONS, videoGenerationControls: VEO_CONTROLS, pricing: { video: { measuringUnit: 'seconds', pricePer: '1', price: '0.15' } } } },
                { prefix: 'veo-3.1-lite', values: { modalities: ['video', 'video_generation'], inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES, videoAspectRatios: VEO_ASPECT_RATIOS, videoResolutions: VEO_RESOLUTIONS, videoDurations: VEO_DURATIONS, videoGenerationControls: VEO_LITE_CONTROLS, pricing: { video: { measuringUnit: 'seconds', pricePer: '1', price: '0.10' } } } },
                { prefix: 'veo-3.1', values: { modalities: ['video', 'video_generation'], inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES, videoAspectRatios: VEO_ASPECT_RATIOS, videoResolutions: VEO_31_RESOLUTIONS, videoDurations: VEO_DURATIONS, videoGenerationControls: VEO_CONTROLS, pricing: { video: { measuringUnit: 'seconds', pricePer: '1', price: '0.40' } } } },
            ],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                inferenceCapabilities: GOOGLE_INFERENCE_CAPABILITIES,
                modalities: ['text'],
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',
                    text: {
                        measuringUnit: 'tokens',
                        pricePer: '1000000',
                        tiers: { default: { prompt: '0.00', completion: '0.00' } }
                    }
                },
                color: '#4285F4',
                iconName: 'geminiIcon',
                colorIconName: 'geminiColorIcon',
                imageSizeMode: 'aspectRatio',
                imageSizes: [
                    { value: '1:1', label: '1:1' },
                    { value: '3:2', label: '3:2' },
                    { value: '2:3', label: '2:3' },
                    { value: '16:9', label: '16:9' },
                    { value: '9:16', label: '9:16' },
                    { value: '4:3', label: '4:3' },
                    { value: '3:4', label: '3:4' },
                    { value: '4:5', label: '4:5' },
                    { value: '5:4', label: '5:4' },
                    { value: '21:9', label: '21:9' },
                    { value: 'auto', label: 'Auto' },
                ],
                starSortingPosition: 150,
                transforms: {
                    title: (modelId: string) => {
                        // Map well-known image models to Nano Banana names and VEO models to friendly names
                        const nanoBananaNames: Record<string, string> = {
                            'gemini-2.5-flash-preview-image-generation': 'Nano Banana',
                            'gemini-3-pro-image-preview': 'Nano Banana Pro',
                            'gemini-3.1-flash-image-preview': 'Nano Banana 2',
                            'veo-3.0-generate-001': 'Veo 3',
                            'veo-3.0-fast-generate-001': 'Veo 3 Fast',
                            'veo-3.1-generate-preview': 'Veo 3.1',
                            'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast',
                            'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite',
                        }
                        if (nanoBananaNames[modelId]) return nanoBananaNames[modelId]

                        return modelId
                            .replace(/^models\//, '')
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gemini') return 'Gemini'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                    },
                    shortTitle: (modelId: string) => {
                        const nanoBananaNames: Record<string, string> = {
                            'gemini-2.5-flash-preview-image-generation': 'Nano Banana',
                            'gemini-3-pro-image-preview': 'Nano Banana Pro',
                            'gemini-3.1-flash-image-preview': 'Nano Banana 2',
                            'veo-3.0-generate-001': 'Veo 3',
                            'veo-3.0-fast-generate-001': 'Veo 3 Fast',
                            'veo-3.1-generate-preview': 'Veo 3.1',
                            'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast',
                            'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite',
                        }
                        if (nanoBananaNames[modelId]) return nanoBananaNames[modelId]

                        return modelId
                            .replace(/^models\//, '')
                            .split('-')
                            .map(part => {
                                if (part.toLowerCase() === 'gemini') return 'Gemini'
                                return part.charAt(0).toUpperCase() + part.slice(1)
                            })
                            .join(' ')
                            .replace(/\s+Preview$/i, '')
                    }
                }
            }
        },
        Stability: {
            exact: {
                'stability-ultra': {
                    modalities: ['image_generation'],
                    imageReferenceCapabilities: STABILITY_IMAGE_REFERENCES,
                    pricing: { currency: 'USD', resaleMargin: '1', image: { measuringUnit: 'credits', pricePer: '1', prompt: '0.00', completion: '8.00' } }
                },
                'sd3.5-large': {
                    modalities: ['image_generation'],
                    imageReferenceCapabilities: STABILITY_IMAGE_REFERENCES,
                    pricing: { currency: 'USD', resaleMargin: '1', image: { measuringUnit: 'credits', pricePer: '1', prompt: '0.00', completion: '6.50' } }
                },
            },
            prefix: [],
            contains: [],
            fallback: {
                imagePromptMaxChars: 10000,
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0,
                inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES,
                modalities: ['image_generation'],
                imageReferenceCapabilities: STABILITY_IMAGE_REFERENCES,
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',
                    image: {
                        measuringUnit: 'credits',
                        pricePer: '1',
                        prompt: '0.00',
                        completion: '0.00'
                    }
                },
                color: '#A855F7',
                iconName: 'stabilityIcon',
                imageSizeMode: 'aspectRatio',
                imageSizes: [
                    { value: '1:1', label: '1:1' },
                    { value: '21:9', label: '21:9' },
                    { value: '16:9', label: '16:9' },
                    { value: '3:2', label: '3:2' },
                    { value: '5:4', label: '5:4' },
                    { value: '4:5', label: '4:5' },
                    { value: '2:3', label: '2:3' },
                    { value: '9:16', label: '9:16' },
                    { value: '9:21', label: '9:21' },
                ],
                starSortingPosition: 300,
                transforms: {
                    title: (modelId: string) => {
                        const names: Record<string, string> = {
                            'stability-ultra': 'Stable Image Ultra',
                            'sd3.5-large': 'SD 3.5 Large',
                        }
                        return names[modelId] || modelId
                    },
                    shortTitle: (modelId: string) => {
                        const names: Record<string, string> = {
                            'stability-ultra': 'Ultra',
                            'sd3.5-large': 'SD 3.5 Large',
                        }
                        return names[modelId] || modelId
                    }
                }
            }
        },
        // BytePlus ModelArk — Seedance 2.0 video generation. Static entries (no
        // model-list API in the repo); token-metered. videoMaxReferenceImages=9
        // lets the provider-aware cap (Phase 2) pass up to 9 references.
        //
        // Rates are the vendor's published online-inference prices in USD per 1M
        // tokens. Seedance prices by output resolution AND by whether the input
        // contained video, so a single flat rate cannot express the tariff: at
        // 480p/720p, text-to-video costs 7.0 while video-to-video costs 4.3, a 63%
        // spread. `tiers` carries that; `price` remains the fallback for a
        // resolution with no matching tier and is set to the model's HIGHEST
        // published rate so an unmatched tier never under-charges.
        //
        // Exact profiles below are authoritative for provider/model generation
        // controls and override provider-level fallback values.
        BytePlus: {
            exact: {
                'dreamina-seedance-2-0-260128': {
                    videoResolutions: SEEDANCE_STANDARD_RESOLUTIONS,
                    videoGenerationControls: SEEDANCE_STANDARD_CONTROLS,
                    pricing: {
                        video: {
                            measuringUnit: 'tokens',
                            pricePer: '1000000',
                            price: '7.7',
                            tiers: {
                                '480p': { withoutVideoInput: '7.0', withVideoInput: '4.3' },
                                '720p': { withoutVideoInput: '7.0', withVideoInput: '4.3' },
                                '1080p': { withoutVideoInput: '7.7', withVideoInput: '4.7' },
                                '4k': { withoutVideoInput: '4.0', withVideoInput: '2.4' },
                            },
                        },
                    },
                },
                'dreamina-seedance-2-0-fast-260128': {
                    videoResolutions: SEEDANCE_FAST_RESOLUTIONS,
                    videoGenerationControls: SEEDANCE_FAST_CONTROLS,
                    pricing: {
                        video: {
                            measuringUnit: 'tokens',
                            pricePer: '1000000',
                            price: '5.6',
                            tiers: {
                                '480p': { withoutVideoInput: '5.6', withVideoInput: '3.3' },
                                '720p': { withoutVideoInput: '5.6', withVideoInput: '3.3' },
                            },
                        },
                    },
                },
            },
            prefix: [],
            contains: [],
            fallback: {
                contextWindow: 0,
                maxCompletionSize: 0,
                defaultTemperature: 0.7,
                inferenceCapabilities: NON_REASONING_INFERENCE_CAPABILITIES,
                modalities: ['video', 'video_generation'],
                videoAspectRatios: SEEDANCE_ASPECT_RATIOS,
                videoResolutions: SEEDANCE_STANDARD_RESOLUTIONS,
                videoDurations: SEEDANCE_DURATIONS,
                videoGenerationControls: SEEDANCE_STANDARD_CONTROLS,
                videoMaxReferenceImages: 9,
                // Fallback for an unrecognized BytePlus video model: the highest
                // Seedance 2.0 rate, so an unknown model is never under-charged.
                pricing: {
                    currency: 'USD',
                    resaleMargin: '1',
                    video: { measuringUnit: 'tokens', pricePer: '1000000', price: '7.7' }
                },
                // Seedance is a ByteDance model — brand color plus the ByteDance brand icon.
                color: '#1664FF',
                iconName: 'bytedanceIcon',
                starSortingPosition: 250,
                transforms: {
                    title: (modelId: string) => {
                        const names: Record<string, string> = {
                            'dreamina-seedance-2-0-260128': 'Seedance 2.0',
                            'dreamina-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
                        }
                        return names[modelId] || modelId
                    },
                    shortTitle: (modelId: string) => {
                        const names: Record<string, string> = {
                            'dreamina-seedance-2-0-260128': 'Seedance 2.0',
                            'dreamina-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
                        }
                        return names[modelId] || modelId
                    }
                }
            }
        }
    }

    // Helper to merge pricing from partial values with provider fallback
    private mergePricingWithFallback(partial: Partial<AiModel['pricing']> | undefined, fallback: AiModel['pricing']): AiModel['pricing'] {
        const p = partial || {}
        const merged: any = {
            currency: p.currency || fallback.currency,
            resaleMargin: p.resaleMargin || fallback.resaleMargin,
        }
        if (p.text || fallback.text) merged.text = p.text || fallback.text
        if (p.audio || (fallback as any).audio) merged.audio = p.audio || (fallback as any).audio
        if (p.image || (fallback as any).image) merged.image = p.image || (fallback as any).image
        if ((p as any).video || (fallback as any).video) merged.video = (p as any).video || (fallback as any).video
        return merged as AiModel['pricing']
    }

    // Merge a (possibly partial) entry with the provider fallback to ensure all fields are present.
    private mergeWithFallback(partial: PartialDeep<ModelDefaults> | undefined, fallback: ModelDefaults): ModelDefaults {
        const p = partial || {}
        return {
            imagePromptMaxChars: typeof p.imagePromptMaxChars === 'number' ? p.imagePromptMaxChars : fallback.imagePromptMaxChars,
            contextWindow: typeof p.contextWindow === 'number' ? p.contextWindow : fallback.contextWindow,
            maxCompletionSize: typeof p.maxCompletionSize === 'number' ? p.maxCompletionSize : fallback.maxCompletionSize,
            defaultTemperature: typeof p.defaultTemperature === 'number' ? p.defaultTemperature : fallback.defaultTemperature,
            inferenceCapabilities: p.inferenceCapabilities
                ? structuredClone(p.inferenceCapabilities as AiModelInferenceCapabilities)
                : structuredClone(fallback.inferenceCapabilities),
            modalities: Array.isArray(p.modalities) ? p.modalities : fallback.modalities,
            imageSizeMode: typeof p.imageSizeMode === 'string' ? p.imageSizeMode : fallback.imageSizeMode,
            imageSizes: Array.isArray(p.imageSizes) ? p.imageSizes : fallback.imageSizes,
            imageReferenceCapabilities: p.imageReferenceCapabilities
                ? structuredClone(p.imageReferenceCapabilities as ImageReferenceCapabilities)
                : fallback.imageReferenceCapabilities,
            videoAspectRatios: Array.isArray(p.videoAspectRatios) ? p.videoAspectRatios : fallback.videoAspectRatios,
            videoResolutions: Array.isArray(p.videoResolutions) ? p.videoResolutions : fallback.videoResolutions,
            videoDurations: Array.isArray(p.videoDurations) ? p.videoDurations : fallback.videoDurations,
            videoGenerationControls: Array.isArray(p.videoGenerationControls)
                ? structuredClone(p.videoGenerationControls as MediaGenerationConfigControl[])
                : fallback.videoGenerationControls,
            videoMaxReferenceImages: typeof p.videoMaxReferenceImages === 'number' ? p.videoMaxReferenceImages : fallback.videoMaxReferenceImages,
            pricing: this.mergePricingWithFallback(p.pricing as any, fallback.pricing),
            color: typeof (p as any).color === 'string' ? (p as any).color : fallback.color,
            iconName: typeof (p as any).iconName === 'string' ? (p as any).iconName : fallback.iconName,
            colorIconName: typeof (p as any).colorIconName === 'string' ? (p as any).colorIconName : fallback.colorIconName,
            starSortingPosition: typeof (p as any).starSortingPosition === 'number' ? (p as any).starSortingPosition : fallback.starSortingPosition,
            transforms: (p as any).transforms || fallback.transforms,
        }
    }

    private resolveModelDefaults(provider: keyof typeof AiModelsSync.MODELS_DEFAULTS, modelId: string): ModelDefaults {
        const config = AiModelsSync.MODELS_DEFAULTS[provider]
        const fallback = config.fallback!

        // 1. Check exact matches first
        if (config.exact[modelId]) {
            return this.mergeWithFallback(config.exact[modelId], fallback)
        }

        // 2. Check prefix matches
        for (const prefixEntry of config.prefix) {
            if (modelId.startsWith(prefixEntry.prefix)) {
                return this.mergeWithFallback(prefixEntry.values, fallback)
            }
        }

        // 3. Check contains (partial-name) matches
        for (const containsEntry of config.contains) {
            if (modelId.includes(containsEntry.includes)) {
                return this.mergeWithFallback(containsEntry.values, fallback)
            }
        }

        // 4. Return fallback if no specific match
        return fallback
    }

    // Helper function to detect minor versions with date patterns
    private isMinorVersion(modelId: string): boolean {
        const patterns = [
            /\d{4}-\d{2}-\d{2}/,    // 2024-01-25
            /:\d{8}/,               // :20240125
            /-preview$/,            // -preview suffix
            /-alpha$/,              // -alpha suffix
            /-beta$/,               // -beta suffix
        ]

        return patterns.some(pattern => pattern.test(modelId))
    }

    // Fetch available models from OpenAI API using SDK
    private async fetchOpenAIModels(): Promise<OpenAIModel[]> {
        const apiKey = this.openai.apiKey
        if (!apiKey) {
            throw new Error('OpenAI API key is required but not provided')
        }

        try {
            const modelsList = await this.openai.models.list()
            const models = modelsList.data

            // Filter models based on blacklist and only include relevant models
            const blacklist = AiModelsSync.MODELS_BLACKLIST.OpenAI

            return models.filter((model: OpenAIModel) => {
                const modelId = model.id

                // GPT Image models are always allowed through (overrides -mini/-nano contains rules),
                // but still drop dated snapshot versions (e.g. gpt-image-2-2026-04-21).
                if (modelId.startsWith('gpt-image-')) {
                    return !this.isMinorVersion(modelId)
                }

                // Check exact blacklist matches
                if (blacklist.exact.includes(modelId)) {
                    return false
                }

                // Check prefix blacklist matches
                if (blacklist.prefix.some(prefix => modelId.startsWith(prefix))) {
                    return false
                }

                // Check contains blacklist matches
                if (blacklist.contains.some(substring => modelId.includes(substring))) {
                    return false
                }

                // Skip minor versions/snapshots with date patterns
                if (this.isMinorVersion(modelId)) {
                    return false
                }

                // Include only GPT, O1, or text-davinci models (main OpenAI chat/completion models)
                return modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('text-davinci')
            })

        } catch (error) {
            err('Failed to fetch OpenAI models:', error)
            throw error
        }
    }

    // Bedrock exposes concrete dated releases rather than the vendor's moving aliases.
    // Preserve those releases so persisted selections remain exact catalog keys.
    private filterAnthropicModels(models: AnthropicModel[], includeSnapshots = false): AnthropicModel[] {
        const blacklist = AiModelsSync.MODELS_BLACKLIST.Anthropic

        return models.filter(model => {
            const modelId = model.id

            if (blacklist.exact.includes(modelId)) {
                return false
            }
            if (blacklist.prefix.some(prefix => modelId.startsWith(prefix))) {
                return false
            }
            if (blacklist.contains.some(substring => modelId.includes(substring))) {
                return false
            }
            // Skip minor versions/snapshots with date patterns
            if (!includeSnapshots && this.isMinorVersion(modelId)) {
                return false
            }

            return true
        })
    }

    // Fetch available Anthropic models from the AWS Bedrock foundation-model catalog and
    // project the Bedrock ids back onto the exact vendor-API ids the rest of the platform
    // persists. Bedrock uses both dated `-vN` ids and current pinned, dateless ids.
    private projectBedrockAnthropicModel(
        bedrockModelId: string,
        displayName: string | undefined,
    ): AnthropicModel | undefined {
        const match = /^anthropic\.(claude-[^:]+?)(?:-v\d+(?::\d+)?)?$/i.exec(bedrockModelId)
        if (!match?.[1]) return undefined

        const modelId = match[1]
        if (!modelId.startsWith('claude-')) return undefined

        const releaseDate = /-(\d{8})$/u.exec(modelId)?.[1]

        return {
            id: modelId,
            display_name: displayName || modelId,
            // Bedrock exposes no creation timestamp; the release date embedded in the
            // model id is the closest equivalent the catalog can carry.
            ...(releaseDate && {
                created_at: `${releaseDate.slice(0, 4)}-${releaseDate.slice(4, 6)}-${releaseDate.slice(6, 8)}`,
            }),
        }
    }

    private async fetchAnthropicModelsFromBedrock(): Promise<AnthropicModel[]> {
        const env = process.env
        const region = env.AWS_REGION?.trim()
        if (!region) {
            throw new Error('AWS_REGION is required to list Anthropic models on AWS Bedrock')
        }

        const ssoProfile = env.AWS_PROFILE?.trim()
        const client = new BedrockClient({
            region,
            ...((env.ENVIRONMENT === 'local' && ssoProfile) && { credentials: fromSSO({ profile: ssoProfile }) }),
        })

        const response = await client.send(new ListFoundationModelsCommand({ byProvider: 'Anthropic' }))
        const summaries = response.modelSummaries ?? []

        const byModelId = new Map<string, AnthropicModel>()
        for (const summary of summaries) {
            const bedrockModelId = summary.modelId
            if (!bedrockModelId) continue
            const model = this.projectBedrockAnthropicModel(bedrockModelId, summary.modelName)
            if (!model || byModelId.has(model.id)) continue
            byModelId.set(model.id, model)
        }

        const models = this.filterAnthropicModels([...byModelId.values()], true)
        if (models.length === 0) {
            throw new Error(`AWS Bedrock returned no usable Anthropic models in region ${region}`)
        }
        return models
    }

    // Fetch available models from Anthropic API using SDK
    private async fetchAnthropicModels(): Promise<AnthropicModel[]> {
        if (this.useBedrockForAnthropic) {
            info('Sourcing Anthropic models from the AWS Bedrock foundation-model catalog (ANTHROPIC_USE_AWS_BEDROCK_INFERENCE=true)')
            return await this.fetchAnthropicModelsFromBedrock()
        }

        const apiKey = this.anthropic.apiKey
        if (!apiKey) {
            throw new Error('Anthropic API key is required but not provided')
        }

        try {
            if (typeof this.anthropic.models?.list === 'function') {
                const page = await this.anthropic.models.list({
                    limit: 100,
                }) as any

                if (page?.data) {
                    return this.filterAnthropicModels(page.data as AnthropicModel[])
                }
            }

            throw new Error('Anthropic models list endpoint returned no models')

        } catch (error) {
            warn('Failed to fetch Anthropic models:', error)
            throw error
        }
    }

    // Fetch available models from Google Gen AI API
    private async fetchGoogleModels(): Promise<GoogleModel[]> {
        try {
            const pager = await this.google.models.list({ config: { pageSize: 100 } })
            const allModels: GoogleModel[] = []

            for await (const model of pager) {
                // The API returns model names like "models/gemini-2.5-flash"
                // Strip the "models/" prefix for consistency
                const modelId = (model.name || '').replace(/^models\//, '')
                if (!modelId) continue

                allModels.push({
                    name: modelId,
                    displayName: model.displayName,
                    description: model.description,
                    inputTokenLimit: model.inputTokenLimit,
                    outputTokenLimit: model.outputTokenLimit,
                })
            }

            // Filter models based on blacklist
            const blacklist = AiModelsSync.MODELS_BLACKLIST.Google

            return allModels.filter(model => {
                const modelId = model.name

                // Image generation models are always allowed through (overrides blacklist rules)
                // Use '-image' to match gemini-*-image* but NOT 'imagen' models
                if (modelId.includes('-image')) return true

                // VEO video models are always allowed through. Keep preview ids
                // (e.g. veo-3.1-generate-preview); drop only dated snapshots.
                if (modelId.includes('veo')) {
                    return !/\d{4}-\d{2}-\d{2}/.test(modelId) && !/:\d{8}/.test(modelId)
                }

                if (blacklist.exact.includes(modelId)) return false
                if (blacklist.prefix.some(prefix => modelId.startsWith(prefix))) return false
                if (blacklist.contains.some(substring => modelId.includes(substring))) return false
                if (this.isMinorVersion(modelId) && !modelId.includes('-image')) return false

                // Only include gemini models
                return modelId.startsWith('gemini')
            })

        } catch (error) {
            err('Failed to fetch Google models:', error)
            throw error
        }
    }

    // Map OpenAI model to our AiModel format
    private mapOpenAIModelToAiModel(openAIModel: OpenAIModel, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('OpenAI', openAIModel.id)

        const now = Date.now()

        const model: AiModel = {
            provider: 'OpenAI',
            providerTitle: PROVIDER_DISPLAY_NAMES.OpenAI,
            model: openAIModel.id,
            title: openAIModel.id,
            shortTitle: openAIModel.id,
            modelVersion: openAIModel.id,
            imagePromptMaxChars: modelDefaults.imagePromptMaxChars,
            contextWindow: modelDefaults.contextWindow,
            maxCompletionSize: modelDefaults.maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            inferenceCapabilities: modelDefaults.inferenceCapabilities,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            colorIconName: modelDefaults.colorIconName || modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            imageSizeMode: modelDefaults.imageSizeMode,
            imageSizes: modelDefaults.imageSizes,
            imageReferenceCapabilities: modelDefaults.imageReferenceCapabilities,
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (model as any)[key] = transformFn(openAIModel.id)
                }
            }
        }

        return assertValidVideoGenerationControls(assertValidImageReferenceCapabilities(assertValidInferenceCapabilities(model)))
    }

    // Map Anthropic model to our AiModel format
    private mapAnthropicModelToAiModel(anthropicModel: AnthropicModel, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('Anthropic', anthropicModel.id)

        const now = Date.now()

        const model: AiModel = {
            provider: 'Anthropic',
            providerTitle: PROVIDER_DISPLAY_NAMES.Anthropic,
            model: anthropicModel.id,
            title: anthropicModel.display_name || anthropicModel.id,
            shortTitle: anthropicModel.display_name || anthropicModel.id,
            modelVersion: anthropicModel.id,
            imagePromptMaxChars: modelDefaults.imagePromptMaxChars,
            contextWindow: modelDefaults.contextWindow,
            maxCompletionSize: modelDefaults.maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            inferenceCapabilities: modelDefaults.inferenceCapabilities,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            colorIconName: modelDefaults.colorIconName || modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            imageSizeMode: modelDefaults.imageSizeMode,
            imageSizes: modelDefaults.imageSizes,
            imageReferenceCapabilities: modelDefaults.imageReferenceCapabilities,
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (model as any)[key] = transformFn(anthropicModel.id, anthropicModel.display_name)
                }
            }
        }

        return assertValidVideoGenerationControls(assertValidImageReferenceCapabilities(assertValidInferenceCapabilities(model)))
    }

    // Map Google model to our AiModel format
    private mapGoogleModelToAiModel(googleModel: GoogleModel, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('Google', googleModel.name)

        const now = Date.now()

        // Use API-reported token limits if available and our defaults are 0
        const contextWindow = modelDefaults.contextWindow || googleModel.inputTokenLimit || 0
        const maxCompletionSize = modelDefaults.maxCompletionSize || googleModel.outputTokenLimit || 0

        const model: AiModel = {
            provider: 'Google',
            providerTitle: PROVIDER_DISPLAY_NAMES.Google,
            model: googleModel.name,
            title: googleModel.displayName || googleModel.name,
            shortTitle: googleModel.displayName || googleModel.name,
            modelVersion: googleModel.name,
            imagePromptMaxChars: modelDefaults.imagePromptMaxChars,
            contextWindow,
            maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            inferenceCapabilities: modelDefaults.inferenceCapabilities,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            colorIconName: modelDefaults.colorIconName || modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            imageSizeMode: modelDefaults.imageSizeMode,
            imageSizes: modelDefaults.imageSizes,
            imageReferenceCapabilities: modelDefaults.imageReferenceCapabilities,
            videoAspectRatios: modelDefaults.videoAspectRatios,
            videoResolutions: modelDefaults.videoResolutions,
            videoDurations: modelDefaults.videoDurations,
            videoGenerationControls: modelDefaults.videoGenerationControls,
            videoMaxReferenceImages: modelDefaults.videoMaxReferenceImages,
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (model as any)[key] = transformFn(googleModel.name)
                }
            }
        }

        return assertValidVideoGenerationControls(assertValidImageReferenceCapabilities(assertValidInferenceCapabilities(model)))
    }

    // Update existing models sequentially to avoid overwhelming DynamoDB
    private async updateModelsSequentially(modelsToUpdate: AiModel[], tableName: string, origin: string) {
        if (modelsToUpdate.length === 0) return

        info(`📝 Updating ${modelsToUpdate.length} existing models sequentially`)

        for (const model of modelsToUpdate) {
            try {
                await this.dynamoDBService.putItem({
                    tableName,
                    item: model,
                    origin
                })
                info(`Updated model: ${model.model}`)
            } catch (error) {
                err(`Failed to update model ${model.model}:`, error)
                throw error
            }
        }

        info(`✅ Successfully updated ${modelsToUpdate.length} models`)
    }

    // Synchronize OpenAI models with database
    private async synchronizeOpenAIModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting OpenAI models synchronization')

        try {
            // Fetch models from OpenAI API
            const openAIModels = await this.fetchOpenAIModels()
            info(`📡 Fetched ${openAIModels.length} models from OpenAI API`)

            // Log the raw models from OpenAI
            info('📋 Raw OpenAI models:')
            openAIModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.id} (owner: ${model.owned_by}, created: ${new Date(model.created * 1000).toISOString()})`)
            })

            // Map OpenAI models to our format
            const mappedModels: AiModel[] = openAIModels.map((model, index) =>
                this.applyDefaultModelFlags(this.mapOpenAIModelToAiModel(model, index + 1))
            )

            info(`🔧 Mapped ${mappedModels.length} models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title} (context: ${model.contextWindow}, max completion: ${model.maxCompletionSize})`)
            })

            // Get existing OpenAI models from database
            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'OpenAI' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing OpenAI models in database`)

            // Identify models to delete (exist in DB but not in fetched list)
            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            // Separate remaining models into new and existing
            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new OpenAI models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            // Delete obsolete models first
            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete OpenAI models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete OpenAI model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete OpenAI model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete OpenAI models`)
            }

            // Process new models first
            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new OpenAI models`)
            }

            // Process updates sequentially
            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ OpenAI models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ OpenAI models synchronization failed:', error)
            throw error
        }
    }

    // Synchronize Anthropic models with database
    private async synchronizeAnthropicModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting Anthropic models synchronization')

        try {
            // Fetch models from Anthropic API
            const anthropicModels = await this.fetchAnthropicModels()
            info(`📡 Fetched ${anthropicModels.length} models from Anthropic API`)

            // Log the raw models from Anthropic
            info('Raw Anthropic models:')
            anthropicModels.forEach((model, index) => {
                const createdIso = model.created_at ? new Date(model.created_at).toISOString() : 'N/A'
                const logMessage = `${index + 1}. ${model.id} (display: ${model.display_name || 'N/A'}, created: ${createdIso})`
                info(logMessage)
            })

            // Map Anthropic models to our format
            const mappedModels: AiModel[] = anthropicModels.map((model, index) =>
                this.applyDefaultModelFlags(this.mapAnthropicModelToAiModel(model, index + 1))
            )

            info(`🔧 Mapped ${mappedModels.length} Anthropic models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title} (context: ${model.contextWindow}, max completion: ${model.maxCompletionSize})`)
            })

            // Get existing Anthropic models from database
            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'Anthropic' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing Anthropic models in database`)

            // Identify models to delete (exist in DB but not in fetched list)
            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            // Separate remaining models into new and existing
            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new Anthropic models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            // Delete obsolete models first
            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete Anthropic models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete Anthropic model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete Anthropic model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete Anthropic models`)
            }

            // Process new models first
            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new Anthropic models`)
            }

            // Process updates sequentially
            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ Anthropic models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ Anthropic models synchronization failed:', error)
            throw error
        }
    }

    // Synchronize Google models with database
    private async synchronizeGoogleModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting Google models synchronization')

        try {
            const googleModels = await this.fetchGoogleModels()
            info(`📡 Fetched ${googleModels.length} models from Google API`)

            info('📋 Raw Google models:')
            googleModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.name} (display: ${model.displayName || 'N/A'}, input: ${model.inputTokenLimit}, output: ${model.outputTokenLimit})`)
            })

            const mappedModels: AiModel[] = googleModels.map((model, index) =>
                this.applyDefaultModelFlags(this.mapGoogleModelToAiModel(model, index + 1))
            )

            info(`🔧 Mapped ${mappedModels.length} Google models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title} (context: ${model.contextWindow}, max completion: ${model.maxCompletionSize})`)
            })

            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'Google' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing Google models in database`)

            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new Google models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete Google models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete Google model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete Google model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete Google models`)
            }

            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new Google models`)
            }

            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ Google models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ Google models synchronization failed:', error)
            throw error
        }
    }

    // Stability AI models (hardcoded — no list-models API available)
    private getStabilityModels(): Array<{ id: string; displayName: string }> {
        return [
            { id: 'stability-ultra', displayName: 'Stable Image Ultra' },
            { id: 'sd3.5-large', displayName: 'SD 3.5 Large' },
        ]
    }

    // Map Stability model to our AiModel format
    private mapStabilityModelToAiModel(model: { id: string; displayName: string }, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('Stability', model.id)

        const now = Date.now()

        const aiModel: AiModel = {
            provider: 'Stability',
            providerTitle: PROVIDER_DISPLAY_NAMES.Stability,
            model: model.id,
            title: model.displayName,
            shortTitle: model.displayName,
            modelVersion: model.id,
            imagePromptMaxChars: modelDefaults.imagePromptMaxChars,
            contextWindow: modelDefaults.contextWindow,
            maxCompletionSize: modelDefaults.maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            inferenceCapabilities: modelDefaults.inferenceCapabilities,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            colorIconName: modelDefaults.colorIconName || modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            imageSizeMode: modelDefaults.imageSizeMode,
            imageSizes: modelDefaults.imageSizes,
            imageReferenceCapabilities: modelDefaults.imageReferenceCapabilities,
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (aiModel as any)[key] = transformFn(model.id)
                }
            }
        }

        return assertValidVideoGenerationControls(assertValidImageReferenceCapabilities(assertValidInferenceCapabilities(aiModel)))
    }

    // Synchronize Stability AI models with database
    private async synchronizeStabilityModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting Stability AI models synchronization')

        try {
            const stabilityModels = this.getStabilityModels()
            info(`📡 Using ${stabilityModels.length} hardcoded Stability AI models`)

            const mappedModels: AiModel[] = stabilityModels.map((model, index) =>
                this.applyDefaultModelFlags(this.mapStabilityModelToAiModel(model, index + 1))
            )

            info(`🔧 Mapped ${mappedModels.length} Stability AI models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title}`)
            })

            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'Stability' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing Stability AI models in database`)

            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new Stability AI models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete Stability AI models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete Stability AI model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete Stability AI model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete Stability AI models`)
            }

            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new Stability AI models`)
            }

            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ Stability AI models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ Stability AI models synchronization failed:', error)
            throw error
        }
    }

    // BytePlus ModelArk models (hardcoded — no list-models API in the repo).
    // Seedance 2.0 video generation; mirrors the Stability static-injection path.
    private getBytePlusModels(): Array<{ id: string; displayName: string }> {
        return [
            { id: 'dreamina-seedance-2-0-260128', displayName: 'Seedance 2.0' },
            { id: 'dreamina-seedance-2-0-fast-260128', displayName: 'Seedance 2.0 Fast' },
        ]
    }

    // Map a BytePlus model to our AiModel format. Mirrors mapStabilityModelToAiModel
    // but carries the video option lists + reference cap (Seedance is video-only).
    private mapBytePlusModelToAiModel(model: { id: string; displayName: string }, sortingPosition: number): AiModel {
        const modelDefaults = this.resolveModelDefaults('BytePlus', model.id)

        const now = Date.now()

        const aiModel: AiModel = {
            provider: 'BytePlus',
            providerTitle: PROVIDER_DISPLAY_NAMES.BytePlus,
            model: model.id,
            title: model.displayName,
            shortTitle: model.displayName,
            modelVersion: model.id,
            imagePromptMaxChars: modelDefaults.imagePromptMaxChars,
            contextWindow: modelDefaults.contextWindow,
            maxCompletionSize: modelDefaults.maxCompletionSize,
            defaultTemperature: modelDefaults.defaultTemperature,
            inferenceCapabilities: modelDefaults.inferenceCapabilities,
            color: modelDefaults.color,
            iconName: modelDefaults.iconName,
            colorIconName: modelDefaults.colorIconName || modelDefaults.iconName,
            sortingPosition: modelDefaults.starSortingPosition + sortingPosition,
            modalities: generateModalitiesWithMetadata(modelDefaults.modalities),
            imageSizeMode: modelDefaults.imageSizeMode,
            imageSizes: modelDefaults.imageSizes,
            imageReferenceCapabilities: modelDefaults.imageReferenceCapabilities,
            videoAspectRatios: modelDefaults.videoAspectRatios,
            videoResolutions: modelDefaults.videoResolutions,
            videoDurations: modelDefaults.videoDurations,
            videoGenerationControls: modelDefaults.videoGenerationControls,
            videoMaxReferenceImages: modelDefaults.videoMaxReferenceImages,
            pricing: modelDefaults.pricing,
            createdAt: now,
            updatedAt: now
        }

        // Apply transforms to model properties
        if (modelDefaults.transforms) {
            for (const [key, transformFn] of Object.entries(modelDefaults.transforms)) {
                if (transformFn) {
                    (aiModel as any)[key] = transformFn(model.id)
                }
            }
        }

        return assertValidVideoGenerationControls(assertValidImageReferenceCapabilities(assertValidInferenceCapabilities(aiModel)))
    }

    // Synchronize BytePlus (Seedance) models with database. Mirrors the Stability
    // path exactly (static list -> map -> diff against DB -> delete/insert/update).
    private async synchronizeBytePlusModels() {
        if (!this.aiModelsListTableName) {
            throw new Error('AI_MODELS_LIST_TABLE_NAME environment variable is required')
        }

        info('🔄 Starting BytePlus models synchronization')

        try {
            const bytePlusModels = this.getBytePlusModels()
            info(`📡 Using ${bytePlusModels.length} hardcoded BytePlus models`)

            const mappedModels: AiModel[] = bytePlusModels.map((model, index) =>
                this.applyDefaultModelFlags(this.mapBytePlusModelToAiModel(model, index + 1))
            )

            info(`🔧 Mapped ${mappedModels.length} BytePlus models to our format:`)
            mappedModels.forEach((model, index) => {
                info(`  ${index + 1}. ${model.model} - ${model.title}`)
            })

            const existingModelsResult = await this.dynamoDBService.queryItems({
                tableName: this.aiModelsListTableName,
                keyConditions: { provider: 'BytePlus' },
                fetchAllItems: true,
                origin: `Service::${this.serviceName}`
            })

            const existingModels = existingModelsResult.items
            const existingModelIds: string[] = existingModels.map((model: any) => model.model)
            const fetchedModelIds: string[] = mappedModels.map(model => model.model)

            info(`Found ${existingModels.length} existing BytePlus models in database`)

            const modelsToDelete = existingModels.filter((existingModel: any) =>
                fetchedModelIds.indexOf(existingModel.model) === -1
            )

            const newModels = mappedModels.filter(model => existingModelIds.indexOf(model.model) === -1)
            const modelsToUpdate = mappedModels.filter(model => existingModelIds.indexOf(model.model) !== -1)

            info(`Processing ${newModels.length} new BytePlus models, ${modelsToUpdate.length} existing models, and ${modelsToDelete.length} models to delete`)

            if (modelsToDelete.length > 0) {
                info(`🗑️ Deleting ${modelsToDelete.length} obsolete BytePlus models`)

                for (const modelToDelete of modelsToDelete) {
                    try {
                        await this.dynamoDBService.deleteItems({
                            tableName: this.aiModelsListTableName,
                            key: { provider: (modelToDelete as any).provider, model: (modelToDelete as any).model },
                            origin: `Service::${this.serviceName}`
                        })
                        info(`Deleted obsolete BytePlus model: ${(modelToDelete as any).model}`)
                    } catch (error) {
                        err(`Failed to delete BytePlus model ${(modelToDelete as any).model}:`, error)
                        throw error
                    }
                }
                info(`✅ Successfully deleted ${modelsToDelete.length} obsolete BytePlus models`)
            }

            if (newModels.length > 0) {
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.aiModelsListTableName,
                    items: newModels,
                    origin: `Service::${this.serviceName}`
                })
                info(`Inserted ${newModels.length} new BytePlus models`)
            }

            if (modelsToUpdate.length > 0) {
                await this.updateModelsSequentially(modelsToUpdate, this.aiModelsListTableName, `Service::${this.serviceName}`)
            }

            info('✅ BytePlus models synchronization completed successfully')

            return {
                processed: mappedModels.length,
                newModels: newModels.length,
                updatedModels: modelsToUpdate.length,
                deletedModels: modelsToDelete.length
            }

        } catch (error) {
            err('❌ BytePlus models synchronization failed:', error)
            throw error
        }
    }

    // Main synchronization method
    async synchronizeModels(): Promise<AiModelsSyncResult> {
        info(`🚀 Starting AI models synchronization - Service: ${this.serviceName}`)

        // Each provider syncs independently. A missing/invalid API key (or any
        // provider-side failure) is logged and skipped — it must never abort the
        // other providers or crash startup, since model sync is a best-effort
        // bootstrap task, not a hard dependency for the server to run.
        type ProviderResult = { processed: number; newModels: number; updatedModels: number; deletedModels: number }
        const zero: ProviderResult = { processed: 0, newModels: 0, updatedModels: 0, deletedModels: 0 }
        const runProvider = async (name: string, fn: () => Promise<ProviderResult>): Promise<ProviderResult> => {
            try {
                const result = await fn()
                info(`${name} synchronization completed: ${JSON.stringify(result)}`)
                return result
            } catch (error) {
                warn(`⚠️  ${name} models synchronization skipped (continuing): ${error instanceof Error ? error.message : String(error)}`)
                return { ...zero }
            }
        }

        const openAIResult = await runProvider('OpenAI', () => this.synchronizeOpenAIModels())
        const anthropicResult = await runProvider('Anthropic', () => this.synchronizeAnthropicModels())
        const googleResult = await runProvider('Google', () => this.synchronizeGoogleModels())
        const stabilityResult = await runProvider('Stability AI', () => this.synchronizeStabilityModels())
        const bytePlusResult = await runProvider('BytePlus', () => this.synchronizeBytePlusModels())

        const totalResult = {
            openAI: openAIResult,
            anthropic: anthropicResult,
            google: googleResult,
            stability: stabilityResult,
            byteplus: bytePlusResult,
            totalProcessed: openAIResult.processed + anthropicResult.processed + googleResult.processed + stabilityResult.processed + bytePlusResult.processed,
            totalNew: openAIResult.newModels + anthropicResult.newModels + googleResult.newModels + stabilityResult.newModels + bytePlusResult.newModels,
            totalUpdated: openAIResult.updatedModels + anthropicResult.updatedModels + googleResult.updatedModels + stabilityResult.updatedModels + bytePlusResult.updatedModels,
            totalDeleted: openAIResult.deletedModels + anthropicResult.deletedModels + googleResult.deletedModels + stabilityResult.deletedModels + bytePlusResult.deletedModels
        }

        info('✅ AI models synchronization completed')
        info(`📊 Summary: ${JSON.stringify(totalResult)}`)

        return totalResult
    }
}
