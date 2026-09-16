import {
    type UsageUnit,
    type MeteredModality,
} from './provider-usage-contract.ts'
import { pricingForCalledInferenceProvider } from './model-pricing.ts'
import {
    type MeteredAiModel,
} from './types.ts'
import { estimateVideoTokens } from './video-token-accounting.ts'
import { UNMEASURED_PROMPT_GROWTH_FACTOR } from './constants.ts'

// The pre-call upper-bound estimate uses the named model\'s usage unit.
// See ../documentation/REQUEST-AUTHORIZATION.md.

// How an estimate was arrived at, for the usage log. Only the fields the modality
// set are filled in.
export type ProviderUsageEstimateBasis = {
    measuringUnit: UsageUnit
    promptTokensMeasured?: number
    promptGrowthFactor?: number
    promptTokensUpperBound?: number
    completionCeiling?: number
    completionCeilingFrom?: 'maxCompletionSize' | 'contextWindowRemainder' | 'unknown'
    videoSeconds?: number
    videoInputSeconds?: number
    videoResolutionTier?: string
    videoAspectRatio?: string
    provisionalVideoFrame?: string
}

export type ProviderUsageEstimate = {
    modality: MeteredModality
    estimatedUnits: number
    basis: ProviderUsageEstimateBasis
}

// One run, reduced to what an estimate reads. The caller owns the request and the
// tokenizer, so the prompt arrives here already measured.
export type ProviderUsageEstimateInput = {
    model: MeteredAiModel
    // Prompt tokens as the provider's own tokenizer counts them, system prompt
    // included. The growth margin below is applied to this.
    promptTokensMeasured: number
    // The run's own completion ceiling, when it overrides the model's.
    maxCompletionSize?: number
    videoResolution?: string
    videoAspectRatio?: string
    videoDurationSeconds?: number | string
    // Set when the run extends an existing clip, which the vendor also meters.
    videoSourceForExtension?: string
    videoSourceDurationSeconds?: number
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
    return value
        && typeof value === 'object'
        && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
}

// Durations are published as numeric strings ('8'), and a provider may
// legitimately offer a fractional clip length, so these are parsed loosely.
const positiveNumber = (value: unknown): number | undefined => {
    if (
        typeof value !== 'number'
        && typeof value !== 'string'
    )
        return undefined

    const parsed = Number(value)

    return Number.isFinite(parsed)
        && parsed > 0
        ? parsed
        : undefined
}

// A catalog record carries an index signature, so its fields arrive as
// `unknown`. Zero and non-numeric values mean "not configured", not "no budget".
const positiveInteger = (value: unknown): number | undefined => {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        ? value
        : undefined
}

const remainingContextWindow = (
    contextWindow: number | undefined,
    promptTokens: number,
): number => {
    const window = positiveInteger(contextWindow)

    if (window === undefined)
        return 0

    return Math.max(0, window - promptTokens)
}

// Catalog modality entries are published either as objects or as bare strings,
// so both are accepted (google-provider.ts reads them the same way).
const generatesModality = (
    model: MeteredAiModel | undefined,
    modality: 'image_generation' | 'video_generation',
): boolean => {
    const entries: unknown = model?.modalities

    if (!Array.isArray(entries))
        return false

    return entries.some(
        (entry: unknown) => (
            (typeof entry === 'string' ? entry : asRecord(entry)?.modality) === modality
        ),
    )
}

// The unit this model's video is metered in, which the usage record uses too.
const videoUsageUnit = (model: MeteredAiModel): string => {
    const video = asRecord(
        asRecord(
            pricingForCalledInferenceProvider(model),
        )?.video,
    )

    return typeof video?.measuringUnit === 'string'
        && video.measuringUnit.length > 0
        ? video.measuringUnit
        : 'seconds'
}

const publishedClipDurations = (model: MeteredAiModel): number[] => {
    const options: unknown = model.videoDurations

    if (!Array.isArray(options))
        return []

    return options.map((option: unknown) => positiveNumber(asRecord(option)?.value)).filter((seconds): seconds is number => seconds !== undefined)
}

// The request is normalized onto one of the model's own duration options upstream,
// so the longest option is a guaranteed ceiling and a published duration is exact.
const boundedClipSeconds = (
    run: ProviderUsageEstimateInput,
    model: MeteredAiModel,
): number => {
    const catalogSeconds = publishedClipDurations(model)
    const requestedSeconds = positiveNumber(run.videoDurationSeconds)

    if (catalogSeconds.length === 0)
        return requestedSeconds ?? 0

    if (
        requestedSeconds !== undefined
        && catalogSeconds.includes(requestedSeconds)
    )
        return requestedSeconds

    return Math.max(...catalogSeconds)
}

// Seconds for a per-second model (VEO), vendor video tokens for a token-metered one
// (Seedance). The authorization carries no unit, so the count has to already be in
// the one the model's tariff meters.
const estimateVideoUsage = (run: ProviderUsageEstimateInput): ProviderUsageEstimate => {
    // Always the model the authorization names, never a routed-to model: the estimate
    // has to describe the same model the request will call.
    const model = run.model
    const seconds = boundedClipSeconds(run, model)

    if (videoUsageUnit(model) === 'seconds') {
        return {
            modality: 'video',
            estimatedUnits: seconds,
            basis: {
                measuringUnit: 'seconds',
                videoSeconds: seconds,
            },
        }
    }

    // An extension run feeds a source clip back in and the vendor meters that too.
    // Without a measured length, assume the longest clip these models produce.
    const inputSeconds = run.videoSourceForExtension
        ? positiveNumber(run.videoSourceDurationSeconds) ?? Math.max(0, ...publishedClipDurations(model))
        : 0
    const estimate = estimateVideoTokens({
        resolutionTier: run.videoResolution,
        aspectRatio: run.videoAspectRatio,
        outputSeconds: seconds,
        inputSeconds,
    })

    return {
        modality: 'video',
        estimatedUnits: estimate.tokens,
        basis: {
            measuringUnit: 'tokens',
            videoSeconds: seconds,
            ...(inputSeconds > 0 ? { videoInputSeconds: inputSeconds } : {}),
            videoResolutionTier: estimate.resolutionTier,
            videoAspectRatio: estimate.aspectRatio,
            ...(estimate.provisional
                ? { provisionalVideoFrame: `${estimate.frameSize.width}x${estimate.frameSize.height}` }
                : {}),
        },
    }
}

const estimateTextUsage = (run: ProviderUsageEstimateInput): ProviderUsageEstimate => {
    const maxCompletionTokens = positiveInteger(run.maxCompletionSize)
        ?? positiveInteger(run.model?.maxCompletionSize)
    const contextWindow = positiveInteger(run.model?.contextWindow)
    const promptTokensMeasured = Math.max(0, run.promptTokensMeasured)
    const promptTokensUpperBound = Math.ceil(promptTokensMeasured * UNMEASURED_PROMPT_GROWTH_FACTOR)
    const completionCeiling = maxCompletionTokens
        ?? remainingContextWindow(contextWindow, promptTokensUpperBound)

    return {
        modality: 'tokens',
        estimatedUnits: promptTokensUpperBound + completionCeiling,
        basis: {
            measuringUnit: 'tokens',
            promptTokensMeasured,
            promptGrowthFactor: UNMEASURED_PROMPT_GROWTH_FACTOR,
            promptTokensUpperBound,
            completionCeiling,
            completionCeilingFrom: maxCompletionTokens !== undefined
                ? 'maxCompletionSize'
                : contextWindow !== undefined
                    ? 'contextWindowRemainder'
                    : 'unknown',
        },
    }
}

// What the named model is metered as, never what the run might go on to do. A
// reasoning run gates as tokens even with media generation enabled, because each
// media call is authorized separately against its own model.
const meteredModalityOf = (run: ProviderUsageEstimateInput): MeteredModality => {
    const model = run.model

    if (generatesModality(model, 'video_generation'))
        return 'video'

    if (generatesModality(model, 'image_generation'))
        return 'image'

    return 'tokens'
}

// Every part of one run's request authorization, derived together so the unit count can
// never disagree with the modality it is counted in.
export const estimateProviderUsageForRun = (run: ProviderUsageEstimateInput): ProviderUsageEstimate => {
    const modality = meteredModalityOf(run)

    // One image-generation run produces one image. Fanout and multi-pass runs are
    // each authorized separately.
    if (modality === 'image')
        return {
            modality,
            estimatedUnits: 1,
            basis: { measuringUnit: 'images' },
        }

    if (modality === 'video')
        return estimateVideoUsage(run)

    return estimateTextUsage(run)
}
