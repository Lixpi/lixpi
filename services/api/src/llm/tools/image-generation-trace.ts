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

export const buildCharacterFidelityRestorationPrompt = (sourceReferenceCount: number): string => {
    if (!Number.isInteger(sourceReferenceCount) || sourceReferenceCount < 1) {
        throw new Error('CHARACTER_FIDELITY_SOURCE_REFERENCE_REQUIRED')
    }
    const sourceRange = sourceReferenceCount === 1 ? 'Image 2' : `Images 2-${sourceReferenceCount + 1}`

    return [
        'CHARACTER FIDELITY RESTORATION EDIT — CHANGE ONLY THE RENDERED CHARACTER APPEARANCE.',
        '',
        'IMAGE ROLES',
        'Image 1 is the generated character-design sheet to edit. It is authoritative for the complete canvas, layout, panel geometry, alignment guides, labels, typography, notes, swatches, spacing, framing, poses, and view placement.',
        `${sourceRange} ${sourceReferenceCount === 1 ? 'is' : 'are'} the authoritative source ${sourceReferenceCount === 1 ? 'image' : 'images'} for the character identity, design, and original rendering style.`,
        '',
        'LOCKED SHEET INVARIANTS',
        'Preserve Image 1 at the same landscape dimensions and preserve every panel, divider, guide, label, note block, swatch, pose, view angle, figure scale, and full-body crop exactly. Do not simplify, rearrange, relabel, omit, add, or redesign any sheet element.',
        'Keep the existing number and placement of character depictions. This is a bounded edit of those depictions, not a new sheet composition.',
        '',
        'AUTHORITATIVE CHARACTER INVARIANTS',
        `Reconstruct every depiction in Image 1 from ${sourceRange}. Preserve the exact facial construction and proportions; eye, eyebrow, nose, mouth, jaw, cheek, and ear shapes; hair silhouette, curl or strand behavior, hairline, and color; skin tone; body proportions; clothing construction, seams, closures, folds, wear, and colors; accessories; materials; and distinguishing marks.`,
        'Use one identical character design in every full-body view, head view, expression, feature panel, and pose. Change view angle or expression only where the locked sheet calls for it.',
        '',
        'AUTHORITATIVE RENDERING-STYLE INVARIANTS',
        `Render every character depiction in the same visual medium as ${sourceRange}, matching its concrete medium signature, line presence and line-weight variation, contour color, interior linework, edge softness or hardness, brush or pencil mark morphology, wash behavior, pigment density, shading method, palette relationships, contrast, paper or canvas substrate, visible grain, surface texture, and detail density.`,
        'The source medium must construct the character itself at every scale. Preserve source-specific marks on faces, hair, skin, garments, and props—not merely on the page background.',
        'Do not clean up, beautify, photorealize, vectorize, smooth, sharpen, airbrush, homogenize, modernize, or reinterpret the source rendering. Do not replace distinctive facial construction or handmade texture with generic polished concept art or generic AI illustration.',
        '',
        'OUTPUT',
        'Return the complete edited landscape sheet as one image. Keep everything from Image 1 unchanged except the minimum character pixels required to restore the exact identity, design, and rendering style from the authoritative source images.',
    ].join('\n')
}

export const buildImageModelPrompt = (state: ProviderState): string => {
    const prompt = state.generatedImagePrompt ?? ''
    const capabilityReferenceImages = state.capabilityReferenceImages ?? []
    const hasCapabilityReferences = capabilityReferenceImages.length > 0
    const capabilityUsagePrompt = state.capabilityUsagePrompt?.trim()

    if (!hasCapabilityReferences && !capabilityUsagePrompt) return prompt

    if (state.capabilityUsageMode === 'character-creator') {
        const sourceReferenceCount = getImageSourceReferenceImages(state).length
        const capabilityReferenceCount = capabilityReferenceImages.length
        const hasSourceReferences = sourceReferenceCount > 0
        const originalCharacterRequest = state.mediaBranchCandidateSnapshot?.promptText?.trim()
            || state.mediaBranchLineagePlan?.promptText?.trim()
            || prompt
        const sourceImageRange = sourceReferenceCount === 1
            ? 'Image 1'
            : `Images 1-${sourceReferenceCount}`
        const templateImageStart = sourceReferenceCount + 1
        const templateImageRange = capabilityReferenceCount === 1
            ? `Image ${templateImageStart}`
            : `Images ${templateImageStart}-${templateImageStart + capabilityReferenceCount - 1}`
        return [
            'MANDATORY CHARACTER CREATOR GENERATION:',
            hasSourceReferences
                ? [
                    'IMAGE ROLES — HIGHEST PRIORITY:',
                    `${sourceImageRange} ${sourceReferenceCount === 1 ? 'is' : 'are'} the authoritative character identity, construction, colors, materials, and rendering-style source.`,
                    `${templateImageRange} ${capabilityReferenceCount === 1 ? 'is' : 'are'} the authoritative output-layout template, never character-appearance inspiration.`,
                    'Populate the complete template with the source character. Preserve source identity and medium in every depiction while preserving the template geometry, labels, guides, panels, and view coverage.',
                ].join('\n')
                : undefined,
            capabilityUsagePrompt
                ? `CHARACTER CREATOR BRIEF:\n${capabilityUsagePrompt}`
                : `USER CHARACTER REQUEST:\n${originalCharacterRequest}`,
        ].filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n')
    }

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
