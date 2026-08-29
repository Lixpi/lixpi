'use strict'

import type {
    MediaBranchVlmReferenceDecision,
    ImageGenerationTraceExcludedReference,
    ImageGenerationTraceReference,
    VideoGenerationTrace,
} from '@lixpi/constants'

import type { ProviderState } from '../graph/state.ts'

export const VEO_NEGATIVE_PROMPT = [
    'warped anatomy',
    'distorted faces',
    'extra limbs',
    'duplicate limbs',
    'malformed hands',
    'melted fingers',
    'identity drift',
    'object morphing',
    'flicker',
    'jitter',
    'stutter',
    'abrupt cuts',
    'scene reset',
    'inconsistent scale',
    'low-resolution noise',
    'blurry subject',
    'random text',
    'subtitles',
    'captions',
    'watermarks',
    'UI overlays',
    'brand logos',
].join(', ')

// A video model's prompt profile: the provider-specific wording the shared
// wrapper composes around the user's request. VEO and Seedance share the same
// pipeline (buildVideoModelPrompt) but differ in the headline quality direction,
// reference-image input-mode wording, image-conditioning safety context, and how
// negatives are handled. VEO appends an inline `Negative prompt:` line; Seedance
// 2.0 has no reliable native negative field and negative phrasing backfires (the
// model renders the tokens), so its profile omits the line entirely and relies
// on positive phrasing. Provider differences live here, never in shared routing.
export type VideoModelProfileName = 'veo' | 'seedance'

export type VideoModelProfile = {
    qualityDirection: string
    referenceImageDirection: string
    // null => no provider-specific image-conditioning safety context.
    imageConditioningSafetyDirection: string | null
    // null => omit the trailing `Negative prompt: …` line (positive phrasing only).
    negativePrompt: string | null
}

export const VIDEO_MODEL_PROFILES: Record<VideoModelProfileName, VideoModelProfile> = {
    veo: {
        qualityDirection: 'VEO QUALITY DIRECTION: produce one coherent continuous shot for a short clip, with stable identity, physically plausible motion, consistent scale, and clean temporal continuity. Keep the subject sharp and materially consistent through the entire motion.',
        referenceImageDirection: 'REFERENCE-IMAGE DIRECTION: use the attached VEO reference images as asset/content references for the subject, product, character, material, or visual ingredient they show. Preserve the useful visual evidence without blending unrelated identities.',
        imageConditioningSafetyDirection: null,
        negativePrompt: VEO_NEGATIVE_PROMPT,
    },
    seedance: {
        qualityDirection: 'SEEDANCE QUALITY DIRECTION: produce one cohesive cinematic shot with a clear subject, physically natural motion, stable identity, consistent scale, smooth temporal continuity, and filmic lighting. Keep the subject crisp and materially consistent throughout the motion, and render every described element affirmatively.',
        referenceImageDirection: 'REFERENCE-IMAGE DIRECTION: use the attached reference images as asset/content references for the subject, product, character, material, or visual ingredient they show. Preserve the useful visual evidence without blending unrelated identities.',
        imageConditioningSafetyDirection: 'SEEDANCE REFERENCE CONTINUITY: preserve the supplied reference evidence as closely as possible: composition, silhouette, proportions, pose, expression, hairstyle, wardrobe, props, palette, lighting, material behavior, rendering style, and medium-specific texture should remain visibly continuous through motion. Do not infer whether a depicted subject is fictional or real from visual style.',
        negativePrompt: null,
    },
}

// Selects the prompt profile from the SELECTED video model. Keyed off the model
// version (the same `/seedance/i` vs `/veo/i` signal the providers gate on) so
// the wrapper stays provider-agnostic and VEO output is byte-identical for every
// non-Seedance model.
export const getVideoModelProfile = (state: ProviderState): VideoModelProfile => {
    const modelVersion = state.videoModelVersion ?? ''
    if (/seedance/i.test(modelVersion)) return VIDEO_MODEL_PROFILES.seedance
    return VIDEO_MODEL_PROFILES.veo
}

const buildInputModeDirection = (state: ProviderState, profile: VideoModelProfile): string => {
    if (state.videoSourceForExtension) {
        return 'EXTENSION CONTINUITY: continue from the final second of the source video. Preserve the existing motion direction, camera continuity, subject identity, lighting, and spatial layout. Do not restart the scene or return to the opening composition.'
    }

    if (state.videoFirstFrameImage) {
        const hasStopFrame = !!(state.videoReferenceImages && state.videoReferenceImages.length > 0)
        if (hasStopFrame) {
            return 'FIRST-LAST-FRAME DIRECTION: the first attached image is the start frame and the second is the end frame; both define the subject, composition, scene, color palette, and visual style. Generate a smooth, physically coherent transition from the start frame to the end frame, focusing on the motion, environmental animation, and lighting changes that bridge the two frames.'
        }
        return 'IMAGE-TO-VIDEO DIRECTION: the attached image is the first frame and already defines the subject, composition, scene, color palette, and visual style. Preserve that starting frame and focus on motion, environmental animation, and lighting changes.'
    }

    if (state.videoReferenceImages && state.videoReferenceImages.length > 0) {
        return profile.referenceImageDirection
    }

    return 'TEXT-TO-VIDEO DIRECTION: generate one focused short-video moment with a clear subject, coherent physical action, and consistent lighting.'
}

const buildAudioDirection = (state: ProviderState): string => (
    state.videoGenerationConfig?.generateAudio === 'false'
        ? 'AUDIO DIRECTION: generate a silent video with no dialogue, soundtrack, or sound effects.'
        : 'AUDIO DIRECTION: generate synchronized audio that follows the described action and environment.'
)

const CAMERA_DIRECTION = 'CAMERA DIRECTION: follow any camera instructions in the user request while maintaining smooth, coherent motion.'

const buildImageConditioningSafetyDirection = (state: ProviderState, profile: VideoModelProfile): string | undefined => {
    if (!profile.imageConditioningSafetyDirection) return undefined
    return state.videoFirstFrameImage || (state.videoReferenceImages?.length ?? 0) > 0
        ? profile.imageConditioningSafetyDirection
        : undefined
}

export const buildVideoModelPrompt = (state: ProviderState): string => {
    const prompt = state.generatedVideoPrompt ?? ''
    if (!prompt) return ''

    const profile = getVideoModelProfile(state)
    const capabilityReferenceImages = state.capabilityReferenceImages ?? []
    const hasCapabilityReferences = capabilityReferenceImages.length > 0
    const capabilityUsagePrompt = state.capabilityUsagePrompt?.trim()

    if (state.capabilityUsageMode === 'character-creator') {
        return [
            profile.qualityDirection,
            buildImageConditioningSafetyDirection(state, profile),
            buildInputModeDirection(state, profile),
            CAMERA_DIRECTION,
            buildAudioDirection(state),
            'MANDATORY CHARACTER CREATOR GENERATION: preserve one consistent character identity, anatomy, clothing, materials, colors, and distinguishing details from the request and attached source images. The capability sample is a layout reference, not a subject to copy.',
            capabilityUsagePrompt ? `CHARACTER CREATOR BRIEF:\n${capabilityUsagePrompt}` : undefined,
            'USER VIDEO REQUEST:',
            prompt,
            profile.negativePrompt ? `Negative prompt: ${profile.negativePrompt}` : undefined,
        ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n')
    }

    return [
        profile.qualityDirection,
        buildImageConditioningSafetyDirection(state, profile),
        buildInputModeDirection(state, profile),
        CAMERA_DIRECTION,
        buildAudioDirection(state),
        hasCapabilityReferences || capabilityUsagePrompt
            ? 'MANDATORY VISUAL CAPABILITY TRANSFER FOR VIDEO: the capability reference image(s) and capability brief define a reusable visual medium or material, not optional inspiration. Transfer that medium into the moving subject itself so texture, palette, mark-making, grain, edge behavior, and material response remain visible on the subject during motion. Do not copy the capability sample subject, pose, composition, or layout.'
            : undefined,
        capabilityUsagePrompt ? `VISUAL CAPABILITY BRIEF:\n${capabilityUsagePrompt}` : undefined,
        'USER VIDEO REQUEST:',
        prompt,
        profile.negativePrompt ? `Negative prompt: ${profile.negativePrompt}` : undefined,
    ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n')
}

const shortText = (value: string | undefined, fallback: string): string => {
    const trimmed = value?.replace(/\s+/g, ' ').trim()
    if (!trimmed) return fallback
    return trimmed.length > 80 ? `${trimmed.slice(0, 77).trim()}...` : trimmed
}

const getCandidateLabel = (candidate: MediaBranchCandidateImage | undefined, fallback: string): string => {
    if (!candidate) return fallback
    return shortText(
        candidate.visualEntitySummary
            ?? candidate.visualStyleSummary
            ?? candidate.promptText,
        fallback,
    )
}

const getTraceSafeImageUrl = (imageUrl: string, candidate?: MediaBranchCandidateImage): string => {
    if (candidate?.assetId) {
        const rendition = candidate.mediaKind === 'video' ? 'representativeFrame' : 'preview'
        return `/api/assets/${encodeURIComponent(candidate.assetId)}/renditions/${rendition}`
    }
    if (!imageUrl.startsWith('/api/')) return ''
    try {
        const url = new URL(imageUrl, 'http://trace.local')
        url.searchParams.delete('token')
        return `${url.pathname}${url.search}`
    } catch {
        return ''
    }
}

const getDecisionByCandidateId = (
    decisions: MediaBranchVlmReferenceDecision[] | undefined,
): Map<string, MediaBranchVlmReferenceDecision> => {
    return new Map((decisions ?? []).map((decision) => [
        decision.candidateId ?? (decision as { nodeId?: string }).nodeId ?? '',
        decision,
    ]))
}

const buildBranchReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const resolution = state.mediaBranchResolution
    if (!resolution) return []
    const candidatesById = new Map(
        (state.mediaBranchCandidateSnapshot?.candidates ?? []).map((candidate) => [candidate.candidateId ?? candidate.nodeId, candidate]),
    )
    const decisionsById = getDecisionByCandidateId(resolution.decisions)

    return resolution.referenceCandidateIds.map((candidateId, index) => {
        const candidate = candidatesById.get(candidateId)
        const decision = decisionsById.get(candidateId)
        return {
            id: `branch:${candidateId}`,
            imageUrl: getTraceSafeImageUrl(candidate?.imageUrl ?? '', candidate),
            source: 'branch-candidate' as const,
            label: getCandidateLabel(candidate, `Reference image ${index + 1}`),
            role: decision?.role ?? 'base-context',
            candidateId,
            nodeId: candidate?.nodeId,
            assetId: candidate?.assetId,
            branchId: candidate?.branchId,
            reason: decision?.reason,
        }
    })
}

const buildCapabilityReference = (imageUrl: string, traceImageUrl: string | undefined, index: number): ImageGenerationTraceReference => ({
    id: `capability:${index + 1}`,
    imageUrl: traceImageUrl ?? getTraceSafeImageUrl(imageUrl),
    source: 'capability-reference',
    label: `Capability reference ${index + 1}`,
    role: 'capability-reference',
})

const buildReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const capabilityReferenceImages = state.capabilityReferenceImages ?? []
    const capabilityReferenceImageTraceUrls = state.capabilityReferenceImageTraceUrls ?? []
    return [
        ...buildBranchReferenceTrace(state),
        ...capabilityReferenceImages.map((imageUrl, index) => buildCapabilityReference(
            imageUrl,
            capabilityReferenceImageTraceUrls[index],
            index,
        )),
    ]
}

const buildExcludedTrace = (state: ProviderState): ImageGenerationTraceExcludedReference[] => {
    const resolution = state.mediaBranchResolution
    if (!resolution) return []
    const candidatesById = new Map(
        (state.mediaBranchCandidateSnapshot?.candidates ?? []).map((candidate) => [candidate.candidateId ?? candidate.nodeId, candidate]),
    )
    const decisionsById = getDecisionByCandidateId(resolution.decisions)

    return resolution.excludedCandidateIds.map((candidateId) => {
        const candidate = candidatesById.get(candidateId)
        const decision = decisionsById.get(candidateId)
        return {
            candidateId,
            nodeId: candidate?.nodeId,
            label: getCandidateLabel(candidate, candidateId),
            role: 'excluded' as const,
            reason: decision?.reason ?? 'Excluded by image branch resolver.',
            assetId: candidate?.assetId,
            branchId: candidate?.branchId,
        }
    })
}

export const buildVideoGenerationTrace = (state: ProviderState): VideoGenerationTrace | undefined => {
    const videoProvider = state.videoProviderName
    const videoModel = state.videoModelVersion
    const toolPrompt = state.generatedVideoPrompt ?? ''
    if (!videoProvider || !videoModel || !toolPrompt) return undefined

    const finalPrompt = buildVideoModelPrompt(state)
    const resolution = state.mediaBranchResolution

    return {
        traceVersion: 'video-generation-trace-v1',
        generationRun: state.generationRun,
        chatModelProvider: state.provider,
        chatModelId: state.modelVersion,
        videoModelProvider: videoProvider,
        videoModelId: videoModel,
        aspectRatio: state.videoAspectRatio ?? '',
        resolution: state.videoResolution ?? '',
        durationSeconds: Number(state.videoDurationSeconds) || 0,
        toolPrompt,
        finalPrompt,
        promptWasChanged: toolPrompt.trim() !== finalPrompt.trim(),
        referenceImages: buildReferenceTrace(state),
        excludedReferences: buildExcludedTrace(state),
        resolver: resolution ? {
            resolverKind: resolution.resolverKind,
            resolverVersion: resolution.resolverVersion,
            resolverModelProvider: resolution.resolverModelProvider,
            resolverModelId: resolution.resolverModelId,
            mode: resolution.mode,
            operationKind: resolution.operationKind,
            confidence: resolution.confidence,
            rationale: resolution.rationale,
            targetCandidateId: resolution.targetCandidateId,
            parentCandidateId: resolution.parentCandidateId,
            branchId: resolution.branchId,
        } : undefined,
    }
}
