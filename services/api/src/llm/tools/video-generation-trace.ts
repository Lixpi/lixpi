'use strict'

import type {
    ImageBranchCandidateImage,
    ImageBranchVlmReferenceDecision,
    ImageGenerationTraceExcludedReference,
    ImageGenerationTraceReference,
    VideoGenerationTrace,
} from '@lixpi/constants'

import type { ProviderState } from '../graph/state.ts'

// Mirrors tools/image-generation-trace.ts but for VEO. The reference-trace
// shape is shared with images (selected/excluded by the same structured VLM
// resolver), so the frontend can render either with the same components.
//
// Phase 3 does not apply a feature-transfer wrapping to the video prompt the
// way the image trace does — /use feature samples are not propagated to video
// generation in v1.

export const buildVideoModelPrompt = (state: ProviderState): string => {
    return state.generatedVideoPrompt ?? ''
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

const buildReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
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
