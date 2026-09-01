'use strict'

import type {
    MeasuringUnit,
    Modality,
} from '@lixpi/constants'

import type {
    AiModelMetaInfo,
    ProviderState,
} from '../graph/state.ts'
import { getSystemPrompt } from '../prompts/load-prompts.ts'
import { estimateInputTokens } from '../providers/provider-input-budget.ts'
import { estimateVideoTokens } from './video-token-accounting.ts'

// Pre-call spend estimate for the metrics check (the mirror image of
// usage-event-mapper.ts, which reports what a call actually cost). The metering
// backend prices `estimatedUnits` at the named model's rate, so the number here
// must be an UPPER BOUND expressed in the unit that model is metered in.
//
// Over-estimating only makes the admission gate stricter. Under-estimating lets a
// run past a balance that cannot cover it, and a zero here prices the whole check
// at $0.00, which approves everything and defeats the gate entirely.
//
// CheckRequest names exactly one model and one modality, so the two must always
// describe the same thing. resolveCheckModality derives the modality from what the
// named model IS, never from what the run might go on to do.
//
// CheckRequest carries no measuringUnit, so the backend reads estimatedUnits in
// whatever unit the named model's own tariff meters: tokens for text, images for
// image models, and for video either seconds or vendor video tokens depending on
// that model's pricing.video.measuringUnit. video-token-accounting.ts does the
// seconds-to-tokens conversion for the token-metered case.

// Reasoning providers build their system prompt from the same two flags, so the
// gate can reproduce it exactly. Everything else the request picks up (tool
// schemas, workspace context, Capability injections, attachment bytes resolved
// from the object store) is assembled by nodes that run AFTER validateRequest, so
// the gate cannot measure it. This factor is the margin for that unmeasurable
// growth. It is a margin, not a bound: a run that resolves a large workspace
// context can still exceed it, which is acceptable because the reserved
// completion ceiling dominates the total and the confirm charges actuals.
const POST_GATE_PROMPT_GROWTH_FACTOR = 2

// How an estimate was arrived at, for the usage log. Only the fields relevant to
// the modality are set. `provisionalVideoFrame` and `promptGrowthFactor` are the
// two places a number is not a straight measurement, so both are surfaced rather
// than buried.
export type CheckMeteringBasis = {
    measuringUnit: MeasuringUnit
    promptTokensMeasured?: number
    promptGrowthFactor?: number
    promptTokensCharged?: number
    completionCeiling?: number
    completionCeilingFrom?: 'maxCompletionSize' | 'contextWindowRemainder' | 'unknown'
    videoSeconds?: number
    videoInputSeconds?: number
    videoResolutionTier?: string
    videoAspectRatio?: string
    provisionalVideoFrame?: string
}

export type CheckMetering = {
    modality: Modality
    estimatedUnits: number
    basis: CheckMeteringBasis
}

// resolveCheckMetering derives every part of one graph run's admission check
// together, so the unit count can never disagree with the modality it is counted
// in. Returned as one value for exactly that reason.
export function resolveCheckMetering(state: ProviderState): CheckMetering {
    const modality = resolveCheckModality(state)
    // An image-modality check only ever names an image-generation model, and one
    // such run produces one image. Multi-model fanout and the Character Creator
    // draft plus fidelity passes each dispatch their own transient run, so each is
    // admitted separately rather than multiplied in here.
    if (modality === 'image') {
        return { modality, estimatedUnits: 1, basis: { measuringUnit: 'images' } }
    }
    if (modality === 'video') return estimateVideoMetering(state)
    return estimateReasoningMetering(state)
}

// The modality answers "what is state.modelVersion metered as", because that is
// the model the check names. A reasoning run gates as tokens even when it has
// image or video generation enabled: those are separate paid calls made later
// through transient media providers, and each of those runs its own check against
// its own model. Escalating here would name a text model under an image or video
// modality, which has no tariff and is denied outright.
function resolveCheckModality(state: ProviderState): Modality {
    const model = state.aiModelMetaInfo
    if (hasGenerationModality(model, 'video_generation')) return 'video'
    if (hasGenerationModality(model, 'image_generation')) return 'image'
    return 'tokens'
}

function estimateReasoningMetering(state: ProviderState): CheckMetering {
    const payload = {
        messages: state.messages ?? [],
        // Reproduces getSystemPrompt(hasImageModel, hasVideoModel) as the
        // reasoning adapters call it. The image and video instruction blocks
        // dwarf the base prompt, so omitting them when a media model is
        // attached would understate the prompt by thousands of tokens.
        systemPrompt: getSystemPrompt(!!state.imageModelVersion, !!state.videoModelVersion),
    }
    const maxCompletionTokens = positiveInteger(state.maxCompletionSize)
        ?? positiveInteger(state.aiModelMetaInfo?.maxCompletionSize)
    const contextWindow = positiveInteger(state.aiModelMetaInfo?.contextWindow)
    const promptTokensMeasured = estimateInputTokens(payload).inputTokens
    const promptTokensCharged = Math.ceil(promptTokensMeasured * POST_GATE_PROMPT_GROWTH_FACTOR)
    const completionCeiling = maxCompletionTokens
        ?? remainingContextWindow(contextWindow, promptTokensCharged)
    return {
        modality: 'tokens',
        estimatedUnits: promptTokensCharged + completionCeiling,
        basis: {
            measuringUnit: 'tokens',
            promptTokensMeasured,
            promptGrowthFactor: POST_GATE_PROMPT_GROWTH_FACTOR,
            promptTokensCharged,
            completionCeiling,
            completionCeilingFrom: maxCompletionTokens !== undefined
                ? 'maxCompletionSize'
                : contextWindow !== undefined
                ? 'contextWindowRemainder'
                : 'unknown',
        },
    }
}

// A video-modality check only ever names a video-generation model, and one such
// run produces one clip. Seconds-metered models (VEO) are counted in seconds;
// token-metered models (Seedance) are converted to vendor video tokens, because
// the check carries no measuringUnit and the backend reads estimatedUnits in
// whatever unit the model's own tariff meters.
function estimateVideoMetering(state: ProviderState): CheckMetering {
    // Always the model the check names, never a routed-to model: the estimate has
    // to describe the same model the backend is about to price.
    const model = state.aiModelMetaInfo
    const seconds = videoSecondsForModel(state, model)
    if (videoMeasuringUnit(model) === 'seconds') {
        return {
            modality: 'video',
            estimatedUnits: seconds,
            basis: { measuringUnit: 'seconds', videoSeconds: seconds },
        }
    }

    // An extension run feeds a source clip back in, and the vendor counts input
    // duration too. The clip's measured length is read off its Asset when the
    // request is resolved; when the Asset carries no duration, fall back to the
    // longest clip these models can produce, which is what generated it.
    const inputSeconds = state.videoSourceForExtension
        ? positiveNumber(state.videoSourceDurationSeconds) ?? Math.max(0, ...catalogDurationSeconds(model))
        : 0
    const estimate = estimateVideoTokens({
        resolutionTier: state.videoResolution,
        aspectRatio: state.videoAspectRatio,
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

// Duration normalization always resolves to one of the model's own catalog
// options (see normalizeModelOption in base-provider.ts / media-generation-matrix.ts),
// so the longest option is a guaranteed ceiling. When the requested duration is
// one the model actually offers, normalization keeps it and the bound is exact.
// A model publishing no duration options receives the request verbatim.
function videoSecondsForModel(state: ProviderState, model: AiModelMetaInfo): number {
    const catalogSeconds = catalogDurationSeconds(model)
    const requestedSeconds = positiveNumber(state.videoDurationSeconds)
    if (catalogSeconds.length === 0) return requestedSeconds ?? 0
    if (requestedSeconds !== undefined && catalogSeconds.includes(requestedSeconds)) return requestedSeconds
    return Math.max(...catalogSeconds)
}

function catalogDurationSeconds(model: AiModelMetaInfo): number[] {
    const options: unknown = model.videoDurations
    if (!Array.isArray(options)) return []
    return options
        .map((option: unknown) => positiveNumber(asRecord(option)?.value))
        .filter((seconds): seconds is number => seconds !== undefined)
}

// The unit the catalog tariff meters this model's video in: 'seconds' for VEO,
// 'tokens' for vendor-token providers. Same field usage-reporter branches on when
// it prices the confirm.
function videoMeasuringUnit(model: AiModelMetaInfo): string {
    const video = asRecord(asRecord(model.pricing)?.video)
    return typeof video?.measuringUnit === 'string' && video.measuringUnit.length > 0
        ? video.measuringUnit
        : 'seconds'
}

// Catalog modality entries are published either as objects or as bare strings,
// so both are accepted (google-provider.ts reads them the same way).
function hasGenerationModality(
    model: AiModelMetaInfo | undefined,
    modality: 'image_generation' | 'video_generation',
): boolean {
    const entries: unknown = model?.modalities
    if (!Array.isArray(entries)) return false
    return entries.some((entry: unknown) => (
        (typeof entry === 'string' ? entry : asRecord(entry)?.modality) === modality
    ))
}

function remainingContextWindow(contextWindow: number | undefined, promptTokens: number): number {
    const window = positiveInteger(contextWindow)
    if (window === undefined) return 0
    return Math.max(0, window - promptTokens)
}

// AiModelMetaInfo carries an index signature, so catalog fields arrive as
// `unknown`. Zero and non-numeric values mean "not configured", not "no budget".
function positiveInteger(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined
}

// Durations are published as numeric strings ('8'), and a provider may
// legitimately offer a fractional clip length, so these are parsed loosely.
function positiveNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' && typeof value !== 'string') return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
}
