'use strict'

import type {
    MediaBranchCandidateImage,
    MediaBranchVlmReferenceDecision,
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

export const getImageSourceReferenceImages = (state: ProviderState): string[] => {
    const selectedCandidateIds = state.mediaBranchResolution?.referenceCandidateIds ?? []
    if (selectedCandidateIds.length === 0) return [...new Set(state.referenceImages ?? [])]

    const candidateById = new Map(
        (state.mediaBranchCandidateSnapshot?.candidates ?? []).map(candidate => [candidate.candidateId ?? candidate.nodeId, candidate]),
    )
    const selectedReferences = selectedCandidateIds.map(candidateId => {
        const imageUrl = candidateById.get(candidateId)?.imageUrl
        if (!imageUrl) {
            throw new Error(`IMAGE_GENERATION_SELECTED_REFERENCE_MISSING:${candidateId}`)
        }
        return imageUrl
    })
    return [...new Set(selectedReferences)]
}

export const buildImageModelPrompt = (state: ProviderState): string => {
    const prompt = state.generatedImagePrompt ?? ''
    const capabilityReferenceImages = state.capabilityReferenceImages ?? []
    const hasCapabilityReferences = capabilityReferenceImages.length > 0
    const capabilityUsagePrompt = state.capabilityUsagePrompt?.trim()

    if (!hasCapabilityReferences && !capabilityUsagePrompt) return prompt

    if (state.capabilityUsageMode === 'character-creator') return prompt

    return [
        'MANDATORY VISUAL CAPABILITY TRANSFER: the attached capability reference image(s) and capability brief are not optional inspiration. They define the medium the generated image must be made of.',
        'The new subject MUST be CONSTRUCTED FROM this medium itself \u2014 brush strokes, washes, paper tooth, grain, deckle behavior, palette, edge softness, and mark-making must appear on the subject\'s own surface (its body, fur, skin, form), not only as a frame or background. A clean, smooth, digitally-rendered subject placed on top of a textured paper backdrop is a REJECTED result.',
        'Do not copy the reference subject, composition, pose, or layout. Carry only the medium and its mark-making behavior.',
        capabilityUsagePrompt ? `VISUAL CAPABILITY BRIEF:\n${capabilityUsagePrompt}` : undefined,
        'USER IMAGE REQUEST:',
        prompt,
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

const getDecisionByCandidateId = (
    decisions: MediaBranchVlmReferenceDecision[] | undefined,
): Map<string, MediaBranchVlmReferenceDecision> => {
    return new Map((decisions ?? []).map((decision) => [
        decision.candidateId ?? (decision as { nodeId?: string }).nodeId ?? '',
        decision,
    ]))
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

const buildBranchReference = (args: {
    imageUrl: string
    index: number
    candidateId: string
    candidate: MediaBranchCandidateImage | undefined
    decision: MediaBranchVlmReferenceDecision | undefined
}): ImageGenerationTraceReference => {
    const fallback = `Reference image ${args.index + 1}`
    return {
        id: `branch:${args.candidateId}`,
        imageUrl: getTraceSafeImageUrl(args.candidate?.imageUrl ?? args.imageUrl, args.candidate),
        source: 'branch-candidate',
        label: getCandidateLabel(args.candidate, fallback),
        role: args.decision?.role ?? 'base-context',
        candidateId: args.candidateId,
        nodeId: args.candidate?.nodeId,
        assetId: args.candidate?.assetId,
        branchId: args.candidate?.branchId,
        reason: args.decision?.reason,
    }
}

const buildCapabilityReference = (imageUrl: string, index: number): ImageGenerationTraceReference => ({
    id: `capability:${index + 1}`,
    imageUrl: getTraceSafeImageUrl(imageUrl),
    source: 'capability-reference',
    label: `Capability reference ${index + 1}`,
    role: 'capability-reference',
})

const buildCapabilityReferenceWithTraceUrl = (imageUrl: string, traceImageUrl: string | undefined, index: number): ImageGenerationTraceReference => ({
    ...buildCapabilityReference(imageUrl, index),
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

const buildBranchReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const resolution = state.mediaBranchResolution
    if (!resolution) return []

    const candidatesById = new Map(
        (state.mediaBranchCandidateSnapshot?.candidates ?? []).map((candidate) => [candidate.candidateId ?? candidate.nodeId, candidate]),
    )
    const decisionsById = getDecisionByCandidateId(resolution.decisions)

    return resolution.referenceCandidateIds.map((candidateId, index) => buildBranchReference({
        imageUrl: '',
        index,
        candidateId,
        candidate: candidatesById.get(candidateId),
        decision: decisionsById.get(candidateId),
    }))
}

const buildReferenceTrace = (state: ProviderState): ImageGenerationTraceReference[] => {
    const referenceImages = state.referenceImages ?? []
    const branchReferences = buildBranchReferenceTrace(state)
    const capabilityReferenceImages = state.capabilityReferenceImages ?? []
    const capabilityReferenceImagesCount = capabilityReferenceImages.length
    const capabilityReferenceImageTraceUrls = state.capabilityReferenceImageTraceUrls ?? []
    const messageTraceImageUrls = extractTraceImageUrlsFromMessages(state.messages)
    const capabilityStartIndex = branchReferences.length
    const messageStartIndex = capabilityStartIndex + capabilityReferenceImagesCount
    const capabilityReferences = capabilityReferenceImages.map((imageUrl, capabilityIndex) =>
        buildCapabilityReferenceWithTraceUrl(
            imageUrl,
            capabilityReferenceImageTraceUrls[capabilityIndex] ?? messageTraceImageUrls[capabilityStartIndex + capabilityIndex],
            capabilityIndex,
        )
    )
    const messageReferences = referenceImages.slice(messageStartIndex).map((imageUrl, index) => {
        const sourceIndex = messageStartIndex + index
        return buildMessageReference(imageUrl, sourceIndex, messageTraceImageUrls[sourceIndex])
    })

    return [
        ...branchReferences,
        ...capabilityReferences,
        ...messageReferences,
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
            role: 'excluded',
            reason: decision?.reason ?? 'Excluded by image branch resolver.',
            assetId: candidate?.assetId,
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
    const resolution = state.mediaBranchResolution

    return {
        traceVersion: 'image-generation-trace-v1',
        generationRun: state.generationRun,
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
            targetCandidateId: resolution.targetCandidateId,
            parentCandidateId: resolution.parentCandidateId,
            branchId: resolution.branchId,
        } : undefined,
    }
}
