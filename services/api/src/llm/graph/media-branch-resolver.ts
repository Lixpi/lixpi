'use strict'

import * as process from 'process'
import { randomUUID } from 'crypto'

import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import type {
    MediaBranchCandidateImage,
    MediaBranchVlmReferenceDecision,
    MediaBranchVlmResolution,
    ImageGenerationOperationKind,
    ProviderName,
} from '@lixpi/constants'

import { callStructuredVlm, type VlmCallArgs, type VlmCallResult, type VlmJsonSchema } from '../structured-vlm/structured-vlm-client.ts'
import { resolveImageUrls } from '../utils/attachments.ts'
import { restrictSnapshotToExplicitRefs } from './media-branch-snapshot.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { StreamPublisher } from './stream-publisher.ts'
import { requiredCapabilityProducedCapabilityOnlyOutput } from '../../capability-system/capability-state-resolver.ts'

type ResolveMediaBranchDeps = {
    natsService: NatsService
    publisher: StreamPublisher
    abortSignal?: AbortSignal
    callVlm?: (args: VlmCallArgs) => Promise<VlmCallResult<MediaBranchVlmRawResolution>>
}

type MediaBranchVlmRawResolution = {
    mode: string
    operationKind: string
    targetCandidateId: string
    parentCandidateId: string
    branchId: string
    includeGeneratedCandidateIds: string[]
    referenceCandidateIds: string[]
    sourceContextNodeIds: string[]
    styleReferenceCandidateIds: string[]
    excludedCandidateIds: string[]
    visualEntitySummary: string
    visualStyleSummary: string
    entityTags: string[]
    styleTags: string[]
    confidence: number
    rationale: string
    decisions: Array<{
        candidateId?: string
        nodeId?: string
        role: MediaBranchVlmReferenceDecision['role']
        reason: string
    }>
}

const SUPPORTED_RESOLVER_PROVIDERS = new Set<ProviderName>(['Anthropic', 'OpenAI', 'Google'])
const RESOLVER_KIND = 'structured-vlm' as const

const VALID_MODES = new Set<MediaBranchVlmResolution['mode']>([
    'context-only',
    'edit-active-branch',
    'all-branches',
    'fresh-branch',
    'ambiguous',
])

const VALID_OPERATION_KINDS = new Set<ImageGenerationOperationKind>([
    'new_image',
    'edit_existing',
    'style_transfer',
    'compare_branches',
    'fresh_branch',
])

const RESOLUTION_SCHEMA: VlmJsonSchema = {
    name: 'resolve_image_branch',
    description: 'Resolve visual target/reference roles for an image or video generation request from labeled candidate images.',
    schema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['context-only', 'edit-active-branch', 'all-branches', 'fresh-branch', 'ambiguous'],
            },
            operationKind: {
                type: 'string',
                enum: ['new_image', 'edit_existing', 'style_transfer', 'compare_branches', 'fresh_branch'],
            },
            targetCandidateId: {
                type: 'string',
                description: 'Candidate identity being edited. Empty string when the prompt requests a new/fresh image.',
            },
            parentCandidateId: {
                type: 'string',
                description: 'Generated parent candidate identity. Empty string when there is no generated-media parent.',
            },
            branchId: {
                type: 'string',
                description: 'Existing branchId to continue, or empty string for a new branch.',
            },
            includeGeneratedCandidateIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Generated candidate identities selected as target/comparison visual references.',
            },
            referenceCandidateIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exact candidate identities that should be sent to the image or video model as visual references.',
            },
            sourceContextNodeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Base context candidate nodeIds relevant to the request.',
            },
            styleReferenceCandidateIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Candidate identities used as style, palette, medium, mood, or composition evidence rather than target identity.',
            },
            excludedCandidateIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Candidate identities that should not be sent because they are unrelated or would contaminate identity/style.',
            },
            visualEntitySummary: {
                type: 'string',
                description: 'Short visible-subject summary for the newly requested/generated image. Empty string if unavailable.',
            },
            visualStyleSummary: {
                type: 'string',
                description: 'Short visible-style/medium summary to persist for future turns. Empty string if unavailable.',
            },
            entityTags: {
                type: 'array',
                items: { type: 'string' },
            },
            styleTags: {
                type: 'array',
                items: { type: 'string' },
            },
            confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
            },
            rationale: {
                type: 'string',
                description: 'Brief visual-grounding rationale naming selected and excluded references.',
            },
            decisions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        candidateId: { type: 'string' },
                        role: {
                            type: 'string',
                            enum: ['target', 'base-context', 'style-reference', 'comparison-target', 'excluded'],
                        },
                        reason: { type: 'string' },
                    },
                    required: ['candidateId', 'role', 'reason'],
                    additionalProperties: false,
                },
            },
        },
        required: [
            'mode',
            'operationKind',
            'targetCandidateId',
            'parentCandidateId',
            'branchId',
            'includeGeneratedCandidateIds',
            'referenceCandidateIds',
            'sourceContextNodeIds',
            'styleReferenceCandidateIds',
            'excludedCandidateIds',
            'visualEntitySummary',
            'visualStyleSummary',
            'entityTags',
            'styleTags',
            'confidence',
            'rationale',
            'decisions',
        ],
        additionalProperties: false,
    },
}

const SYSTEM_PROMPT = [
    'You are Lixpi\'s image branch resolver. Your job is to inspect the user prompt plus labeled candidate images and assign visual roles before image or video generation. Image generation and video generation are both fully supported capabilities; which one runs is decided elsewhere and is never your concern — you only ground visual references.',
    'Resolve visual references only — never judge feasibility. Do not refuse, lower confidence, or return mode="ambiguous" because the request is for a video, because it asks for motion, animation, camera movement, or audio, or because of any perceived capability limit. Motion and clip requests are ordinary video generation and must be grounded exactly like image requests. For video, the target identity you pick becomes the first frame (image-to-video) and your selected style references become the video reference images.',
    'Always ground decisions in the actual candidate pixels. Do not route from regexes, recency, prompt text alone, or guessed entity tags.',
    'If the candidate metadata includes roleHints containing "active-target" or the prompt context names an Active target candidateId, treat that as a weak UI selection hint only. It is not visual truth and must never override the user prompt or candidate pixels.',
    'Purely deictic prompts like "this", "that", "it", or "make it" usually refer to the active-target candidate. Deictic prompts with an explicit visible subject like "that man", "that guy", "that person", "that goat", "that portrait", or "that landscape" must target a candidate whose pixels match that named subject. If the active target visibly conflicts with the named subject, exclude it and choose the matching candidate; if no candidate matches, return mode="ambiguous" with low confidence.',
    'For style/medium changes to an active-target candidate, return mode="edit-active-branch", operationKind="edit_existing", targetCandidateId set to the active target candidateId, and include the active target as a reference only when the prompt is purely deictic or the active target visibly matches the named subject. Do not use the active target for a different visible subject or a fresh unrelated image.',
    'If the prompt identifies an existing generated candidate or branch as the subject/identity, continue that generated branch even when the requested palette, medium, or style changes substantially. If you include a generated candidate as the target/identity reference, set targetCandidateId and parentCandidateId to that candidate, preserve its branchId when available, and do not return targetless mode="fresh-branch".',
    'Separate target identity from style/source evidence. A phrase like "draw a goat in the style of that landscape painting" means the goat is the requested subject and the landscape can be style evidence; unrelated generated portraits must be excluded.',
    'referenceCandidateIds is authoritative: include only candidate identities that should be sent to the image or video model. Exclude distractors aggressively because unrelated generated variants contaminate identity.',
    'Reserve mode="ambiguous" strictly for when the visual referent genuinely cannot be determined from the candidate pixels — never to flag an unsupported output type or a request you believe cannot be fulfilled. If the prompt is genuinely impossible to resolve from the candidate images, return mode="ambiguous" with low confidence and explain why.',
].join('\n')

const getResolverModel = (state: ProviderState): { provider: ProviderName; modelVersion: string } => {
    const configuredProvider = process.env.MEDIA_BRANCH_RESOLVER_PROVIDER as ProviderName | undefined
    const configuredModel = process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
    const provider = configuredProvider ?? state.provider
    const modelVersion = configuredModel ?? (provider === state.provider ? state.modelVersion : undefined)

    if (!SUPPORTED_RESOLVER_PROVIDERS.has(provider)) {
        throw new Error(`Image branch resolver requires a VLM-capable provider; got ${provider}`)
    }
    if (!modelVersion) {
        throw new Error(`Image branch resolver model is not configured for provider ${provider}`)
    }

    return { provider, modelVersion }
}

const compactCandidateForPrompt = (candidate: MediaBranchCandidateImage): Record<string, unknown> => ({
    candidateId: candidate.candidateId,
    nodeId: candidate.nodeId,
    assetId: candidate.assetId,
    roleHints: candidate.roleHints,
    branchId: candidate.branchId ?? '',
    ancestorNodeIds: candidate.ancestorNodeIds ?? [],
    sourceContextNodeIds: candidate.sourceContextNodeIds ?? [],
    sourceMessageId: candidate.sourceMessageId ?? '',
    promptText: candidate.promptText ?? '',
    visualEntitySummary: candidate.visualEntitySummary ?? '',
    visualStyleSummary: candidate.visualStyleSummary ?? '',
    entityTags: candidate.entityTags ?? [],
    styleTags: candidate.styleTags ?? [],
    createdAt: candidate.createdAt ?? 0,
})

const resolveCandidateImageUrls = async (
    candidates: MediaBranchCandidateImage[],
    natsService: NatsService,
): Promise<MediaBranchCandidateImage[]> => {
    return Promise.all(candidates.map(async (candidate) => {
        const resolved = await resolveImageUrls([{
            type: 'input_image',
            image_url: candidate.imageUrl,
            detail: 'high',
        }], natsService)

        if (!Array.isArray(resolved)) return candidate
        const imageBlock = resolved.find((block) => block?.type === 'input_image')
        const imageUrl = typeof imageBlock?.image_url === 'string' ? imageBlock.image_url : candidate.imageUrl
        return imageUrl === candidate.imageUrl ? candidate : { ...candidate, imageUrl }
    }))
}

const buildResolverMessages = (state: ProviderState): ChatMessage[] => {
    const snapshot = state.mediaBranchCandidateSnapshot
    if (!snapshot) throw new Error('Image branch candidate snapshot is required')
    const blocks: Array<Record<string, any>> = [{
        type: 'input_text',
        text: [
            `User prompt: ${snapshot.promptText}`,
            `Prompt fingerprint: ${snapshot.promptFingerprint}`,
            `Conversation Asset ID: ${snapshot.conversationAssetId}`,
            `Region node ID: ${snapshot.regionNodeId}`,
            snapshot.activeTargetCandidateId ? `Active target candidate ID: ${snapshot.activeTargetCandidateId}` : undefined,
            '',
            'Candidate metadata JSON:',
            JSON.stringify(snapshot.candidates.map(compactCandidateForPrompt), null, 2),
            '',
            'Transcript/candidate context:',
            snapshot.transcriptContext,
            '',
            'Inspect each attached candidate image. Return strict JSON using the tool schema. Use candidateId values exactly as given.',
        ].filter((line): line is string => typeof line === 'string').join('\n'),
    }]

    for (const candidate of snapshot.candidates) {
        blocks.push({
            type: 'input_text',
            text: `Candidate image candidateId=${candidate.candidateId} nodeId=${candidate.nodeId ?? ''} roleHints=${candidate.roleHints.join(',')} branchId=${candidate.branchId ?? ''}`,
        })
        blocks.push({ type: 'input_image', image_url: candidate.imageUrl, detail: 'high' })
    }

    return [{ role: 'user', content: blocks }]
}

const normalizeOptionalCandidateId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
}

const assertKnownCandidateIds = (label: string, candidateIds: string[], candidateById: Map<string, MediaBranchCandidateImage>): void => {
    const unknown = candidateIds.filter((candidateId) => !candidateById.has(candidateId))
    if (unknown.length > 0) {
        throw new Error(`Image branch resolver returned unknown ${label}: ${unknown.join(', ')}`)
    }
}

const appendRationale = (rationale: string, guardMessage: string): string =>
    [rationale, guardMessage].filter(Boolean).join(' ')

const sanitizeDecisions = (
    decisions: unknown,
    candidateById: Map<string, MediaBranchCandidateImage>
): MediaBranchVlmReferenceDecision[] => {
    if (!Array.isArray(decisions)) return []
    const out: MediaBranchVlmReferenceDecision[] = []
    for (const decision of decisions) {
        if (typeof decision !== 'object' || decision === null) continue
        const candidateId = normalizeOptionalCandidateId(
            (decision as any).candidateId ?? (decision as any).nodeId,
        )
        if (!candidateId) continue
        // Decisions are trace/debug metadata, not routing authority. VLMs can
        // echo stale or invented nodeIds here even when target/reference arrays
        // are valid, so unknown audit rows are discarded instead of failing a
        // simple generation. The authoritative node-id fields are validated
        // below and still fail hard when they name unknown candidates.
        if (!candidateById.has(candidateId)) continue
        const role = (decision as any).role
        if (!['target', 'base-context', 'style-reference', 'comparison-target', 'excluded'].includes(role)) {
            throw new Error(`Image branch resolver returned invalid decision role for ${candidateId}: ${role}`)
        }
        out.push({
            candidateId,
            role,
            reason: typeof (decision as any).reason === 'string' ? (decision as any).reason : '',
        })
    }
    return out
}

const isGeneratedCandidate = (candidate: MediaBranchCandidateImage): boolean =>
    candidate.roleHints.includes('generated-variant')

const findGeneratedTargetReference = (args: {
    candidateById: Map<string, MediaBranchCandidateImage>
    referenceCandidateIds: string[]
    styleReferenceCandidateIds: string[]
    decisions: MediaBranchVlmReferenceDecision[]
}): MediaBranchCandidateImage | undefined => {
    const styleReferenceCandidateIds = new Set(args.styleReferenceCandidateIds)
    const decisionByCandidateId = new Map(args.decisions.map((decision) => [decision.candidateId, decision]))
    const generatedReferences = args.referenceCandidateIds
        .map((candidateId) => args.candidateById.get(candidateId))
        .filter((candidate): candidate is MediaBranchCandidateImage => Boolean(candidate && isGeneratedCandidate(candidate)))
        .filter((candidate) => !styleReferenceCandidateIds.has(candidate.candidateId))
        .filter((candidate) => decisionByCandidateId.get(candidate.candidateId)?.role !== 'style-reference')

    const explicitTargetReferences = generatedReferences.filter((candidate) => {
        const role = decisionByCandidateId.get(candidate.candidateId)?.role
        return role === 'target' || role === 'base-context'
    })
    let targetReferences = explicitTargetReferences
    if (targetReferences.length === 0 && args.decisions.length === 0) {
        targetReferences = generatedReferences
    }
    if (targetReferences.length === 1) return targetReferences[0]

    const leafReferences = targetReferences.filter((candidate) => candidate.roleHints.includes('branch-leaf'))
    return leafReferences.length === 1 ? leafReferences[0] : undefined
}

const sanitizeResolution = (args: {
    parsed: MediaBranchVlmRawResolution
    state: ProviderState
    resolverProvider: ProviderName
    resolverModelId: string
}): MediaBranchVlmResolution => {
    const snapshot = args.state.mediaBranchCandidateSnapshot
    if (!snapshot) throw new Error('Image branch candidate snapshot is required')

    const candidateById = new Map(snapshot.candidates.map((candidate) => [candidate.candidateId, candidate]))
    let mode = args.parsed.mode as MediaBranchVlmResolution['mode']
    let operationKind = args.parsed.operationKind as ImageGenerationOperationKind
    if (!VALID_MODES.has(mode)) throw new Error(`Image branch resolver returned invalid mode: ${args.parsed.mode}`)
    if (!VALID_OPERATION_KINDS.has(operationKind)) throw new Error(`Image branch resolver returned invalid operationKind: ${args.parsed.operationKind}`)

    let targetCandidateId = normalizeOptionalCandidateId(args.parsed.targetCandidateId)
    let parentCandidateId = normalizeOptionalCandidateId(args.parsed.parentCandidateId) ?? targetCandidateId ?? undefined
    const includeGeneratedCandidateIds = normalizeStringArray(args.parsed.includeGeneratedCandidateIds)
    const referenceCandidateIds = normalizeStringArray(args.parsed.referenceCandidateIds)
    const sourceContextNodeIds = normalizeStringArray(args.parsed.sourceContextNodeIds)
    const styleReferenceCandidateIds = normalizeStringArray(args.parsed.styleReferenceCandidateIds)
    let excludedCandidateIds = normalizeStringArray(args.parsed.excludedCandidateIds)
    const decisions = sanitizeDecisions(args.parsed.decisions, candidateById)

    let rationale = typeof args.parsed.rationale === 'string' ? args.parsed.rationale.trim() : ''
    if (!targetCandidateId && (mode === 'fresh-branch' || operationKind === 'new_image' || operationKind === 'fresh_branch')) {
        const generatedTarget = findGeneratedTargetReference({
            candidateById,
            referenceCandidateIds,
            styleReferenceCandidateIds,
            decisions,
        })
        if (generatedTarget) {
            targetCandidateId = generatedTarget.candidateId
            parentCandidateId = generatedTarget.candidateId
            mode = 'edit-active-branch'
            if (operationKind === 'new_image' || operationKind === 'fresh_branch') operationKind = 'style_transfer'
            excludedCandidateIds = excludedCandidateIds.filter((candidateId) => candidateId !== generatedTarget.candidateId)
            rationale = appendRationale(
                rationale,
                `Resolver guard continued generated branch via selected target reference ${generatedTarget.candidateId}.`,
            )
        }
    }

    if (parentCandidateId && !candidateById.has(parentCandidateId)) {
        const unknownParentCandidateId = parentCandidateId
        parentCandidateId = targetCandidateId && candidateById.has(targetCandidateId)
            ? targetCandidateId
            : undefined
        rationale = appendRationale(
            rationale,
            parentCandidateId
                ? `Resolver guard replaced unknown parentCandidateId ${unknownParentCandidateId} with targetCandidateId ${parentCandidateId}.`
                : `Resolver guard ignored unknown parentCandidateId ${unknownParentCandidateId}.`,
        )
    }

    assertKnownCandidateIds('targetCandidateId', targetCandidateId ? [targetCandidateId] : [], candidateById)
    assertKnownCandidateIds('parentCandidateId', parentCandidateId ? [parentCandidateId] : [], candidateById)
    assertKnownCandidateIds('includeGeneratedCandidateIds', includeGeneratedCandidateIds, candidateById)
    assertKnownCandidateIds('referenceCandidateIds', referenceCandidateIds, candidateById)
    assertKnownCandidateIds('styleReferenceCandidateIds', styleReferenceCandidateIds, candidateById)
    assertKnownCandidateIds('excludedCandidateIds', excludedCandidateIds, candidateById)
    const knownSourceNodeIds = new Set(snapshot.candidates.flatMap(candidate => [
        ...(candidate.nodeId ? [candidate.nodeId] : []),
        ...candidate.sourceContextNodeIds,
    ]))
    const unknownSourceNodeIds = sourceContextNodeIds.filter(nodeId => !knownSourceNodeIds.has(nodeId))
    if (unknownSourceNodeIds.length > 0) {
        throw new Error(`Image branch resolver returned unknown sourceContextNodeIds: ${unknownSourceNodeIds.join(', ')}`)
    }

    if (targetCandidateId && excludedCandidateIds.includes(targetCandidateId)) {
        throw new Error(`Image branch resolver excluded its own targetCandidateId: ${targetCandidateId}`)
    }
    if (targetCandidateId && !referenceCandidateIds.includes(targetCandidateId)) {
        throw new Error(`Image branch resolver targetCandidateId is not in referenceCandidateIds: ${targetCandidateId}`)
    }

    const confidence = Math.max(0, Math.min(1, Number(args.parsed.confidence) || 0))
    if (mode === 'ambiguous') {
        throw new Error(`Image branch resolver could not disambiguate: ${rationale || 'ambiguous visual reference'}`)
    }
    if (confidence < 0.2) {
        throw new Error(`Image branch resolver confidence too low (${confidence}): ${rationale || 'no rationale provided'}`)
    }

    const targetCandidate = targetCandidateId ? candidateById.get(targetCandidateId) : undefined
    const rawBranchId = normalizeOptionalCandidateId(args.parsed.branchId)
    const branchId = targetCandidate?.branchId ?? rawBranchId ?? `branch-${randomUUID()}`

    return {
        resolverKind: RESOLVER_KIND,
        resolverVersion: snapshot.resolverVersion,
        resolverModelProvider: args.resolverProvider,
        resolverModelId: args.resolverModelId,
        mode,
        operationKind,
        targetCandidateId,
        parentCandidateId,
        branchId,
        includeGeneratedCandidateIds,
        referenceCandidateIds,
        sourceContextNodeIds,
        styleReferenceCandidateIds,
        excludedCandidateIds,
        visualEntitySummary: args.parsed.visualEntitySummary?.trim() || undefined,
        visualStyleSummary: args.parsed.visualStyleSummary?.trim() || undefined,
        entityTags: normalizeStringArray(args.parsed.entityTags),
        styleTags: normalizeStringArray(args.parsed.styleTags),
        confidence,
        rationale,
        decisions,
    }
}

const isCandidateImageBlock = (block: Record<string, any>, candidateImageUrls: Set<string>): boolean => {
    if (block?.type !== 'input_image') return false
    const imageUrl = block.image_url
    return typeof imageUrl === 'string' && candidateImageUrls.has(imageUrl)
}

const isImageMetadataBlock = (block: Record<string, any>): boolean => {
    if (block?.type !== 'input_text' || typeof block.text !== 'string') return false
    try {
        const parsed = JSON.parse(block.text)
        return parsed?.type === 'standalone_image' || parsed?.type === 'generated_image_variant'
    } catch {
        return false
    }
}

const stripCandidateImageBlocks = (messages: ChatMessage[], candidateImageUrls: Set<string>): ChatMessage[] => {
    return messages.flatMap((message) => {
        if (!Array.isArray(message.content)) return [message]

        const filtered: Array<Record<string, any>> = []
        for (let index = 0; index < message.content.length; index++) {
            const block = message.content[index]
            if (block === undefined) continue
            if (typeof block !== 'object' || block === null) {
                filtered.push(block)
                continue
            }
            if (isCandidateImageBlock(block, candidateImageUrls)) continue

            const nextBlock = message.content[index + 1]
            const nextIsCandidateImage = typeof nextBlock === 'object'
                && nextBlock !== null
                && isCandidateImageBlock(nextBlock, candidateImageUrls)
            if (isImageMetadataBlock(block) && nextIsCandidateImage) continue

            filtered.push(block)
        }

        return filtered.length > 0 ? [{ ...message, content: filtered }] : []
    })
}

const buildResolvedBranchMessage = (
    resolution: MediaBranchVlmResolution,
    candidates: MediaBranchCandidateImage[]
): ChatMessage => {
    const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]))
    const blocks: Array<Record<string, any>> = [{
        type: 'input_text',
        text: JSON.stringify({
            type: 'image_branch_vlm_resolution',
            mode: resolution.mode,
            operationKind: resolution.operationKind,
            targetCandidateId: resolution.targetCandidateId,
            referenceCandidateIds: resolution.referenceCandidateIds,
            styleReferenceCandidateIds: resolution.styleReferenceCandidateIds,
            excludedCandidateIds: resolution.excludedCandidateIds,
            rationale: resolution.rationale,
        }),
    }]

    for (const candidateId of resolution.referenceCandidateIds) {
        const candidate = candidateById.get(candidateId)
        if (!candidate) continue
        blocks.push({
            type: 'input_text',
            text: JSON.stringify({
                type: 'image_branch_selected_reference',
                candidateId: candidate.candidateId,
                nodeId: candidate.nodeId,
                assetId: candidate.assetId,
                roleHints: candidate.roleHints,
                branchId: candidate.branchId ?? '',
            }),
        })
        blocks.push({ type: 'input_image', image_url: candidate.imageUrl, detail: 'high' })
    }

    return { role: 'user', content: blocks }
}

const buildFreshBranchResolution = (state: ProviderState): MediaBranchVlmResolution => {
    const snapshot = state.mediaBranchCandidateSnapshot
    if (!snapshot) throw new Error('Image branch candidate snapshot is required')
    return {
        resolverKind: RESOLVER_KIND,
        resolverVersion: snapshot.resolverVersion,
        resolverModelProvider: state.provider,
        resolverModelId: state.modelVersion,
        mode: 'fresh-branch',
        operationKind: 'fresh_branch',
        targetCandidateId: null,
        branchId: `branch-${randomUUID()}`,
        includeGeneratedCandidateIds: [],
        referenceCandidateIds: [],
        sourceContextNodeIds: [],
        styleReferenceCandidateIds: [],
        excludedCandidateIds: [],
        entityTags: [],
        styleTags: [],
        confidence: 1,
        rationale: 'No candidate media was supplied; starting a fresh generated branch.',
        decisions: [],
    }
}

export const resolveMediaBranch = async (state: ProviderState, deps: ResolveMediaBranchDeps): Promise<Partial<ProviderState>> => {
    // The resolver runs for both image AND video generation: VEO image-to-video
    // and reference-conditioned video both need the same VLM grounding that
    // image generation uses.
    if (requiredCapabilityProducedCapabilityOnlyOutput(state)) return {}
    const hasCapabilityMediaOutput = (
        state.capabilityOutputMediaAssetIds
        ?? state.capabilityOutputAssetIds
        ?? []
    ).length > 0
    if (!hasCapabilityMediaOutput && !state.imageModelVersion && !state.videoModelVersion) return {}
    const snapshot = restrictSnapshotToExplicitRefs(state.mediaBranchCandidateSnapshot)
    if (!snapshot) {
        const message = state.videoModelVersion
            ? 'Image branch candidate snapshot is required for video generation.'
            : 'Image branch candidate snapshot is required for image generation.'
        deps.publisher.mediaBranchResolutionError(message)
        throw new Error(message)
    }
    if (snapshot.candidates.length === 0) {
        const resolution = buildFreshBranchResolution(state)
        deps.publisher.mediaBranchResolved(resolution)
        info(`[MediaBranchResolver] resolved fresh branch ${JSON.stringify({
            workspaceId: state.workspaceId,
            aiChatThreadId: state.aiChatThreadId,
            branchId: resolution.branchId,
            rationale: resolution.rationale,
        }, null, 0)}`)
        return { mediaBranchResolution: resolution }
    }

    const { provider, modelVersion } = getResolverModel(state)
    const callVlm = deps.callVlm ?? ((args: VlmCallArgs) => callStructuredVlm<MediaBranchVlmRawResolution>(args))

    try {
        const resolvedCandidates = await resolveCandidateImageUrls(snapshot.candidates, deps.natsService)
        const resolverState: ProviderState = {
            ...state,
            mediaBranchCandidateSnapshot: {
                ...snapshot,
                candidates: resolvedCandidates,
            },
        }
        const result: VlmCallResult<MediaBranchVlmRawResolution> = await callVlm({
            provider,
            modelVersion,
            systemPrompt: SYSTEM_PROMPT,
            userMessages: buildResolverMessages(resolverState),
            schema: RESOLUTION_SCHEMA,
            natsService: deps.natsService,
            temperature: 0.1,
            maxTokens: Math.min(state.aiModelMetaInfo.maxCompletionSize ?? 4096, 4096),
            abortSignal: deps.abortSignal,
        })

        const resolution = sanitizeResolution({
            parsed: result.parsed,
            // Validate VLM selections against the explicit-restricted snapshot so
            // non-explicit node ids can never survive sanitization.
            state: resolverState,
            resolverProvider: provider,
            resolverModelId: result.modelName || modelVersion,
        })
        const candidateImageUrls: Set<string> = new Set(snapshot.candidates.map((candidate: MediaBranchCandidateImage) => candidate.imageUrl))
        const cleanedMessages = stripCandidateImageBlocks(state.messages, candidateImageUrls)
        const resolvedBranchMessage = buildResolvedBranchMessage(resolution, resolvedCandidates)
        const messages = [resolvedBranchMessage, ...cleanedMessages]

        deps.publisher.mediaBranchResolved(resolution)
        info(`[MediaBranchResolver] resolved ${JSON.stringify({
            workspaceId: state.workspaceId,
            aiChatThreadId: state.aiChatThreadId,
            provider,
            model: result.modelName || modelVersion,
            activeTargetCandidateId: snapshot.activeTargetCandidateId,
            mode: resolution.mode,
            operationKind: resolution.operationKind,
            targetCandidateId: resolution.targetCandidateId,
            referenceCandidateIds: resolution.referenceCandidateIds,
            excludedCandidateIds: resolution.excludedCandidateIds,
            confidence: resolution.confidence,
            rationale: resolution.rationale,
        }, null, 0)}`)

        // For video generation, map the VLM-selected references onto the video
        // provider's inputs as FRAME CONDITIONING ONLY (never asset/style refs):
        //   - 1 image  -> start frame (image-to-video)
        //   - 2 images -> start frame + stop frame (first/last-frame interpolation)
        // We collect the selected images in a stable order — the resolver target
        // (edit / continuation anchor) first, then the remaining references in
        // selection order — and surface the first as the start frame and the
        // second as the stop frame. videoReferenceImages now carries the OPTIONAL
        // stop frame (at most one), not asset references. (Per-user-config of how
        // each reference is used is planned but out of scope here.)
        let videoFirstFrameImage: string | undefined
        let videoReferenceImages: string[] | undefined
        if (state.videoModelVersion && resolution.referenceCandidateIds.length > 0) {
            const urlByCandidateId = new Map(resolvedCandidates.map(candidate => [candidate.candidateId, candidate.imageUrl]))
            const orderedFrames: string[] = []
            const pushFrame = (url: string | undefined): void => {
                if (typeof url === 'string' && url.length > 0 && !orderedFrames.includes(url)) {
                    orderedFrames.push(url)
                }
            }
            if (resolution.targetCandidateId) pushFrame(urlByCandidateId.get(resolution.targetCandidateId))
            for (const candidateId of resolution.referenceCandidateIds) pushFrame(urlByCandidateId.get(candidateId))

            videoFirstFrameImage = orderedFrames[0]
            videoReferenceImages = orderedFrames.slice(1, 2)
        }

        return {
            mediaBranchResolution: resolution,
            messages,
            videoFirstFrameImage,
            videoReferenceImages,
        }
    } catch (error: any) {
        const message = error?.message ?? String(error)
        deps.publisher.mediaBranchResolutionError(message)
        throw error
    }
}
