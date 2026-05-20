'use strict'

import type {
    ImageBranchCandidateImage,
    ImageBranchVlmReferenceDecision,
    ImageGenerationTrace,
    ImageGenerationTraceExcludedReference,
    ImageGenerationTraceReference,
    ProviderName,
} from '@lixpi/constants'

import type { ProviderState } from '../graph/state.ts'

export const normalizeImageSize = (imageProvider: ProviderName | undefined, imageSize: string | undefined): string => {
    if (!imageSize || imageSize === 'auto') return 'auto'
    const ratioForSize: Record<string, string> = {
        '1024x1024': '1:1',
        '1536x1024': '3:2',
        '1024x1536': '2:3',
    }
    const sizeForRatio: Record<string, string> = {
        '1:1': '1024x1024',
        '3:2': '1536x1024',
        '2:3': '1024x1536',
    }
    if (imageProvider === 'OpenAI') return sizeForRatio[imageSize] ?? imageSize
    if (imageProvider === 'Google' || imageProvider === 'Stability') return ratioForSize[imageSize] ?? imageSize
    return imageSize
}

export const buildImageModelPrompt = (state: ProviderState): string => {
    const prompt = state.generatedImagePrompt ?? ''
    const featureReferenceImages = state.featureReferenceImages ?? []
    const hasFeatureReferences = featureReferenceImages.length > 0
    const featureUsagePrompt = state.featureUsagePrompt?.trim()

    if (!hasFeatureReferences && !featureUsagePrompt) return prompt

    return [
        'MANDATORY /use FEATURE TRANSFER: the attached feature reference image(s) and feature brief are not optional inspiration. They define the medium the generated image must be made of.',
        'The new subject MUST be CONSTRUCTED FROM this medium itself \u2014 brush strokes, washes, paper tooth, grain, deckle behavior, palette, edge softness, and mark-making must appear on the subject\'s own surface (its body, fur, skin, form), not only as a frame or background. A clean, smooth, digitally-rendered subject placed on top of a textured paper backdrop is a REJECTED result.',
        'Do not copy the reference subject, composition, pose, or layout. Carry only the medium and its mark-making behavior.',
        featureUsagePrompt ? `FEATURE BRIEF:\n${featureUsagePrompt}` : undefined,
        'USER IMAGE REQUEST:',
        prompt,
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

const getDecisionByNodeId = (
    decisions: ImageBranchVlmReferenceDecision[] | undefined,
): Map<string, ImageBranchVlmReferenceDecision> => {
    return new Map((decisions ?? []).map((decision) => [decision.nodeId, decision]))
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

const buildBranchReference = (args: {
    imageUrl: string
    index: number
    nodeId: string
    candidate: ImageBranchCandidateImage | undefined
    decision: ImageBranchVlmReferenceDecision | undefined
}): ImageGenerationTraceReference => {
    const fallback = `Reference image ${args.index + 1}`
    return {
        id: `branch:${args.nodeId}`,
        imageUrl: getTraceSafeImageUrl(args.candidate?.imageUrl ?? args.imageUrl, args.candidate),
        source: 'branch-candidate',
        label: getCandidateLabel(args.candidate, fallback),
        role: args.decision?.role ?? 'base-context',
        nodeId: args.nodeId,
        fileId: args.candidate?.fileId,
        workspaceId: args.candidate?.workspaceId,
        branchId: args.candidate?.branchId,
        reason: args.decision?.reason,
    }
}

const buildFeatureReference = (imageUrl: string, index: number): ImageGenerationTraceReference => ({
    id: `feature:${index + 1}`,
    imageUrl: getTraceSafeImageUrl(imageUrl),
    source: 'feature-reference',
    label: `Feature reference ${index + 1}`,
    role: 'feature-reference',
})

const buildFeatureReferenceWithTraceUrl = (imageUrl: string, traceImageUrl: string | undefined, index: number): ImageGenerationTraceReference => ({
    ...buildFeatureReference(imageUrl, index),
    imageUrl: traceImageUrl ?? getTraceSafeImageUrl(imageUrl),
})

const buildMessageReference = (imageUrl: string, index: number, traceImageUrl?: string): ImageGenerationTraceReference => ({
    id: `message:${index + 1}`,
    imageUrl: traceImageUrl ?? getTraceSafeImageUrl(imageUrl),
    source: 'message-reference',
    label: `Reference image ${index + 1}`,
    role: 'message-reference',
})

const extractTraceImageUrlsFromMessages = (messages: ProviderState['messages']): string[] => {
    const urls: string[] = []
    for (const message of messages) {
        if (!Array.isArray(message.content)) continue
        for (const block of message.content) {
            if (typeof block !== 'object' || block === null) continue
            if ((block as any).type !== 'input_image') continue
            const imageUrl = (block as any).image_url
            if (typeof imageUrl === 'string') urls.push(getTraceSafeImageUrl(imageUrl))
        }
    }
    return urls
}

const buildReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const referenceImages = state.referenceImages ?? []
    const resolution = state.imageBranchResolution
    const branchReferenceNodeIds = resolution?.referenceImageNodeIds ?? []
    const featureReferenceImagesCount = state.featureReferenceImages?.length ?? 0
    const featureReferenceImageTraceUrls = state.featureReferenceImageTraceUrls ?? []
    const messageTraceImageUrls = extractTraceImageUrlsFromMessages(state.messages)
    const candidatesByNodeId = new Map(
        (state.imageBranchCandidateSnapshot?.candidates ?? []).map((candidate) => [candidate.nodeId, candidate]),
    )
    const decisionsByNodeId = getDecisionByNodeId(resolution?.decisions)

    return referenceImages.map((imageUrl, index) => {
        const branchNodeId = branchReferenceNodeIds[index]
        if (branchNodeId) {
            return buildBranchReference({
                imageUrl,
                index,
                nodeId: branchNodeId,
                candidate: candidatesByNodeId.get(branchNodeId),
                decision: decisionsByNodeId.get(branchNodeId),
            })
        }

        const featureIndex = index - branchReferenceNodeIds.length
        if (featureIndex >= 0 && featureIndex < featureReferenceImagesCount) {
            return buildFeatureReferenceWithTraceUrl(imageUrl, featureReferenceImageTraceUrls[featureIndex] ?? messageTraceImageUrls[index], featureIndex)
        }

        return buildMessageReference(imageUrl, index, messageTraceImageUrls[index])
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
            role: 'excluded',
            reason: decision?.reason ?? 'Excluded by image branch resolver.',
            fileId: candidate?.fileId,
            workspaceId: candidate?.workspaceId,
            branchId: candidate?.branchId,
        }
    })
}

export const buildImageGenerationTrace = (state: ProviderState): ImageGenerationTrace | undefined => {
    const imageProvider = state.imageProviderName
    const imageModel = state.imageModelVersion
    const toolPrompt = state.generatedImagePrompt ?? ''
    if (!imageProvider || !imageModel || !toolPrompt) return undefined

    const imageSize = normalizeImageSize(imageProvider, state.imageSize)
    const finalPrompt = buildImageModelPrompt(state)
    const resolution = state.imageBranchResolution

    return {
        traceVersion: 'image-generation-trace-v1',
        chatModelProvider: state.provider,
        chatModelId: state.modelVersion,
        imageModelProvider: imageProvider,
        imageModelId: imageModel,
        imageSize,
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