'use strict'

import type {
    ImageBranchCandidateImage,
    ImageBranchVlmReferenceDecision,
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

const buildInputModeDirection = (state: ProviderState): string => {
    if (state.videoSourceForExtension) {
        return 'EXTENSION CONTINUITY: continue from the final second of the source video. Preserve the existing motion direction, camera momentum, subject identity, lighting, spatial layout, and audio bed. Do not restart the scene or return to the opening composition.'
    }

    if (state.videoFirstFrameImage) {
        return 'IMAGE-TO-VIDEO DIRECTION: the attached image is the first frame and already defines the subject, composition, scene, color palette, and visual style. Preserve that starting frame and focus the prompt on motion, camera movement, environmental animation, lighting changes, and synchronized audio.'
    }

    if (state.videoReferenceImages && state.videoReferenceImages.length > 0) {
        return 'REFERENCE-IMAGE DIRECTION: use the attached VEO reference images as asset/content references for the subject, product, character, material, or visual ingredient they show. Preserve the useful visual evidence without blending unrelated identities.'
    }

    return 'TEXT-TO-VIDEO DIRECTION: generate one focused short-video moment with a clear subject, coherent physical action, deliberate camera movement, consistent lighting, and synchronized audio.'
}

export const buildVideoModelPrompt = (state: ProviderState): string => {
    const prompt = state.generatedVideoPrompt ?? ''
    if (!prompt) return ''

    const featureReferenceImages = state.featureReferenceImages ?? []
    const hasFeatureReferences = featureReferenceImages.length > 0
    const featureUsagePrompt = state.featureUsagePrompt?.trim()

    return [
        'VEO QUALITY DIRECTION: produce one coherent continuous shot for a short clip, with stable identity, physically plausible motion, consistent scale, clean temporal continuity, and synchronized audio. Keep the subject sharp and materially consistent through the entire motion.',
        buildInputModeDirection(state),
        hasFeatureReferences || featureUsagePrompt
            ? 'MANDATORY /use FEATURE TRANSFER FOR VIDEO: the feature reference image(s) and feature brief define a reusable visual medium or material, not optional inspiration. Transfer that medium into the moving subject itself so texture, palette, mark-making, grain, edge behavior, and material response remain visible on the subject during motion. Do not copy the feature sample subject, pose, composition, or layout.'
            : undefined,
        featureUsagePrompt ? `FEATURE BRIEF:\n${featureUsagePrompt}` : undefined,
        'USER VIDEO REQUEST:',
        prompt,
        `Negative prompt: ${VEO_NEGATIVE_PROMPT}`,
    ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n')
}

const shortText = (value: string | undefined, fallback: string): string => {
    const trimmed = value?.replace(/\s+/g, ' ').trim()
    if (!trimmed) return fallback
    return trimmed.length > 80 ? `${trimmed.slice(0, 77).trim()}...` : trimmed
}

const getCandidateLabel = (candidate: ImageBranchCandidateImage | undefined, fallback: string): string => {
    if (!candidate) return fallback
    return shortText(
        candidate.visualEntitySummary
            ?? candidate.visualStyleSummary
            ?? candidate.promptText,
        fallback,
    )
}

const getTraceSafeImageUrl = (imageUrl: string, candidate?: ImageBranchCandidateImage): string => {
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        if (candidate?.workspaceId && candidate.fileId) {
            return `nats-obj://workspace-${candidate.workspaceId}-files/${candidate.fileId}`
        }
        return ''
    }
    return imageUrl
}

const getDecisionByNodeId = (
    decisions: ImageBranchVlmReferenceDecision[] | undefined,
): Map<string, ImageBranchVlmReferenceDecision> => {
    return new Map((decisions ?? []).map((decision) => [decision.nodeId, decision]))
}

const buildBranchReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const resolution = state.imageBranchResolution
    if (!resolution) return []
    const candidatesByNodeId = new Map(
        (state.imageBranchCandidateSnapshot?.candidates ?? []).map((candidate) => [candidate.nodeId, candidate]),
    )
    const decisionsByNodeId = getDecisionByNodeId(resolution.decisions)

    return resolution.referenceImageNodeIds.map((nodeId, index) => {
        const candidate = candidatesByNodeId.get(nodeId)
        const decision = decisionsByNodeId.get(nodeId)
        return {
            id: `branch:${nodeId}`,
            imageUrl: getTraceSafeImageUrl(candidate?.imageUrl ?? '', candidate),
            source: 'branch-candidate' as const,
            label: getCandidateLabel(candidate, `Reference image ${index + 1}`),
            role: decision?.role ?? 'base-context',
            nodeId,
            fileId: candidate?.fileId,
            workspaceId: candidate?.workspaceId,
            branchId: candidate?.branchId,
            reason: decision?.reason,
        }
    })
}

const buildFeatureReference = (imageUrl: string, traceImageUrl: string | undefined, index: number): ImageGenerationTraceReference => ({
    id: `feature:${index + 1}`,
    imageUrl: traceImageUrl ?? getTraceSafeImageUrl(imageUrl),
    source: 'feature-reference',
    label: `Feature reference ${index + 1}`,
    role: 'feature-reference',
})

const buildReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const featureReferenceImages = state.featureReferenceImages ?? []
    const featureReferenceImageTraceUrls = state.featureReferenceImageTraceUrls ?? []
    return [
        ...buildBranchReferenceTrace(state),
        ...featureReferenceImages.map((imageUrl, index) => buildFeatureReference(
            imageUrl,
            featureReferenceImageTraceUrls[index],
            index,
        )),
    ]
}

const buildExcludedTrace = (state: ProviderState): ImageGenerationTraceExcludedReference[] => {
    const resolution = state.imageBranchResolution
    if (!resolution) return []
    const candidatesByNodeId = new Map(
        (state.imageBranchCandidateSnapshot?.candidates ?? []).map((candidate) => [candidate.nodeId, candidate]),
    )
    const decisionsByNodeId = getDecisionByNodeId(resolution.decisions)

    return resolution.excludedNodeIds.map((nodeId) => {
        const candidate = candidatesByNodeId.get(nodeId)
        const decision = decisionsByNodeId.get(nodeId)
        return {
            nodeId,
            label: getCandidateLabel(candidate, nodeId),
            role: 'excluded' as const,
            reason: decision?.reason ?? 'Excluded by image branch resolver.',
            fileId: candidate?.fileId,
            workspaceId: candidate?.workspaceId,
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
    const resolution = state.imageBranchResolution

    return {
        traceVersion: 'video-generation-trace-v1',
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
            targetImageNodeId: resolution.targetImageNodeId,
            parentImageNodeId: resolution.parentImageNodeId,
            branchId: resolution.branchId,
        } : undefined,
    }
}
