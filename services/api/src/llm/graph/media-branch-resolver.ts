import * as process from 'process'
import { randomUUID } from 'crypto'

import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import {
    type MediaBranchCandidateImage,
    type MediaBranchVlmReferenceDecision,
    type MediaBranchVlmResolution,
    type ImageGenerationOperationKind,
    type ProviderName,
} from '@lixpi/constants'

import {
    callStructuredVlm,
    type VlmCallArgs,
    type VlmCallResult,
    type VlmJsonSchema,
} from '../structured-vlm/structured-vlm-client.ts'
import { resolveImageUrls } from '../utils/attachments.ts'
import { restrictSnapshotToExplicitRefs } from './media-branch-snapshot.ts'
import {
    type ChatMessage,
    type ProviderState,
} from './state.ts'
import {
    type StreamPublisher,
} from './stream-publisher.ts'
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

const SUPPORTED_RESOLVER_PROVIDERS = new Set<ProviderName>([
    'Anthropic',
    'OpenAI',
    'Google',
])
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
                description: 'Every explicitly attached candidate identity. Copy all candidate ids exactly.',
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
                description: 'Always an empty array because every candidate was explicitly attached.',
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
                description: 'Brief visual-grounding rationale for the assigned target and style roles.',
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
    "You are Lixpi's image branch resolver. Your job is to inspect the user prompt plus labeled candidate images and assign visual roles before image or video generation. Image generation and video generation are both fully supported capabilities; which one runs is decided elsewhere and is never your concern — you only ground visual references.",
    'Resolve visual references only — never judge feasibility. Do not refuse, lower confidence, or return mode="ambiguous" because the request is for a video, because it asks for motion, animation, camera movement, or audio, or because of any perceived capability limit. Motion and clip requests are ordinary video generation and must be grounded exactly like image requests. For video, the target identity you pick becomes the first frame (image-to-video) and your selected style references become the video reference images.',
    'Always ground decisions in the actual candidate pixels. Do not route from regexes, recency, prompt text alone, or guessed entity tags.',
    'If the candidate metadata includes roleHints containing "active-target" or the prompt context names an Active target candidateId, treat that as a weak UI selection hint only. It is not visual truth and must never override the user prompt or candidate pixels.',
    'A prompt that refers only to the selected item usually targets the active-target candidate. When the prompt also names or describes visible content, target only a candidate whose pixels match that description. If the active target visibly conflicts with the described content, keep it as attached context and choose the matching candidate; if no candidate matches, return mode="ambiguous" with low confidence.',
    'For style/medium changes to an active-target candidate, return mode="edit-active-branch", operationKind="edit_existing", and set targetCandidateId to the active target only when the prompt is purely deictic or its pixels match the named subject. Do not assign the active target as target for a different visible subject or a fresh unrelated image.',
    'A generated candidate remains an editable lineage parent after acceptance. If it has a branchId, continue that active branch. If acceptance removed its branchId, target the generated candidate and let the server create a new continuation branch rooted at that media node.',
    'If the prompt identifies a generated candidate or branch as the subject/identity, continue from that generated candidate even when the requested palette, medium, or style changes substantially. Set targetCandidateId and parentCandidateId to that candidate and do not return targetless mode="fresh-branch".',
    'Every candidate was explicitly attached by the user in the message or composer context. Include every candidate in referenceCandidateIds and never exclude one. Your role is to assign target/style/branch roles, not to decide whether an attached reference reaches generation.',
    'Separate requested target content from style or source evidence. A reference assigned only to style must remain context and must not become the target identity or lineage parent for newly requested content.',
    'Reserve mode="ambiguous" strictly for when the visual referent genuinely cannot be determined from the candidate pixels — never to flag an unsupported output type or a request you believe cannot be fulfilled. If the prompt is genuinely impossible to resolve from the candidate images, return mode="ambiguous" with low confidence and explain why.',
].join('\n')

const getResolverModel = (state: ProviderState): {
    provider: ProviderName
    modelVersion: string
} => {
    const configuredProvider = process.env.MEDIA_BRANCH_RESOLVER_PROVIDER as ProviderName | undefined
    const configuredModel = process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
    const provider = configuredProvider ?? state.provider
    const modelVersion = configuredModel ?? (provider === state.provider ? state.modelVersion : undefined)

    if (!SUPPORTED_RESOLVER_PROVIDERS.has(provider))
        throw new Error(`Image branch resolver requires a VLM-capable provider; got ${provider}`)

    if (!modelVersion)
        throw new Error(`Image branch resolver model is not configured for provider ${provider}`)

    return {
        provider,
        modelVersion,
    }
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
    return Promise.all(
        candidates.map(async candidate => {
            const resolved = await resolveImageUrls(
                [{
                    type: 'input_image',
                    image_url: candidate.imageUrl,
                    detail: 'high',
                }],
                natsService,
            )

            if (!Array.isArray(resolved))
                return candidate

            const imageBlock = resolved.find(block => block?.type === 'input_image')
            const imageUrl = typeof imageBlock?.image_url === 'string' ? imageBlock.image_url : candidate.imageUrl

            return imageUrl === candidate.imageUrl ? candidate : {
                ...candidate,
                imageUrl,
            }
        }),
    )
}

const buildResolverMessages = (state: ProviderState): ChatMessage[] => {
    const snapshot = state.mediaBranchCandidateSnapshot

    if (!snapshot)
        throw new Error('Image branch candidate snapshot is required')

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
            JSON.stringify(
                snapshot.candidates.map(compactCandidateForPrompt),
                null,
                2,
            ),
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
        blocks.push({
            type: 'input_image',
            image_url: candidate.imageUrl,
            detail: 'high',
        })
    }

    return [{
        role: 'user',
        content: blocks,
    }]
}

const normalizeOptionalCandidateId = (value: unknown): string | null => {
    if (typeof value !== 'string')
        return null

    const trimmed = value.trim()

    return trimmed ? trimmed : null
}

const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value))
        return []

    return Array.from(
        new Set(
            value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()),
        ),
    )
}

const assertKnownCandidateIds = (
    label: string,
    candidateIds: string[],
    candidateById: Map<string, MediaBranchCandidateImage>,
): void => {
    const unknown = candidateIds.filter(candidateId => !candidateById.has(candidateId))

    if (unknown.length > 0)
        throw new Error(`Image branch resolver returned unknown ${label}: ${unknown.join(', ')}`)
}

const appendRationale = (
    rationale: string,
    guardMessage: string,
): string => [rationale, guardMessage].filter(Boolean).join(' ')

const sanitizeDecisions = (
    decisions: unknown,
    candidateById: Map<string, MediaBranchCandidateImage>,
): MediaBranchVlmReferenceDecision[] => {
    if (!Array.isArray(decisions))
        return []

    const out: MediaBranchVlmReferenceDecision[] = []

    for (const decision of decisions) {
        if (
            typeof decision !== 'object'
            || decision === null
        )
            continue

        const candidateId = normalizeOptionalCandidateId((decision as any).candidateId ?? (decision as any).nodeId)

        if (!candidateId)
            continue

        // Decisions are trace/debug metadata, not routing authority. VLMs can
        // echo stale or invented nodeIds here even when target/reference arrays
        // are valid, so unknown audit rows are discarded instead of failing a
        // simple generation. The authoritative node-id fields are validated
        // below and still fail hard when they name unknown candidates.
        if (!candidateById.has(candidateId))
            continue

        const role = (decision as any).role

        if (!['target', 'base-context', 'style-reference', 'comparison-target', 'excluded'].includes(role))
            throw new Error(`Image branch resolver returned invalid decision role for ${candidateId}: ${role}`)

        out.push({
            candidateId,
            role,
            reason: typeof (decision as any).reason === 'string' ? (decision as any).reason : '',
        })
    }

    return out
}

const sanitizeResolution = (args: {
    parsed: MediaBranchVlmRawResolution
    state: ProviderState
    resolverProvider: ProviderName
    resolverModelId: string
}): MediaBranchVlmResolution => {
    const snapshot = args.state.mediaBranchCandidateSnapshot

    if (!snapshot)
        throw new Error('Image branch candidate snapshot is required')

    const candidateById = new Map(
        snapshot.candidates.map(candidate => [candidate.candidateId, candidate]),
    )
    let mode = args.parsed.mode as MediaBranchVlmResolution['mode']
    let operationKind = args.parsed.operationKind as ImageGenerationOperationKind

    if (!VALID_MODES.has(mode))
        throw new Error(`Image branch resolver returned invalid mode: ${args.parsed.mode}`)

    if (!VALID_OPERATION_KINDS.has(operationKind))
        throw new Error(`Image branch resolver returned invalid operationKind: ${args.parsed.operationKind}`)

    let targetCandidateId = normalizeOptionalCandidateId(args.parsed.targetCandidateId)
    let parentCandidateId = normalizeOptionalCandidateId(args.parsed.parentCandidateId)
        ?? targetCandidateId
        ?? undefined
    let includeGeneratedCandidateIds = normalizeStringArray(args.parsed.includeGeneratedCandidateIds)
    const referenceCandidateIds = snapshot.candidates.map(candidate => candidate.candidateId)
    const sourceContextNodeIds = [...new Set(
        snapshot.candidates.flatMap(candidate => (candidate.nodeId ? [candidate.nodeId] : [])),
    )]
    let styleReferenceCandidateIds = normalizeStringArray(args.parsed.styleReferenceCandidateIds)
    const decisions = sanitizeDecisions(args.parsed.decisions, candidateById).map(
        decision =>
            decision.role === 'excluded'
                ? {
                    ...decision,
                    role: 'base-context' as const,
                    reason: appendRationale(decision.reason, 'The reference remains attached because the user selected it explicitly.'),
                }
                : decision,
    )

    let rationale = typeof args.parsed.rationale === 'string' ? args.parsed.rationale.trim() : ''
    let confidence = Math.max(
        0,
        Math.min(1, Number(args.parsed.confidence) || 0),
    )

    if (
        mode === 'ambiguous'
        || confidence < 0.2
    ) {
        const candidateAssetIds = [...new Set(
            snapshot.candidates.map(candidate => candidate.assetId),
        )]

        if (candidateAssetIds.length > 1) {
            throw new MediaBranchAmbiguityError({
                candidateAssetIds,
                rationale: rationale || 'The referenced branch could not be selected safely.',
            })
        }

        const onlyCandidate = snapshot.candidates.length === 1 ? snapshot.candidates[0] : undefined
        const promptLooksLikeEdit = /\b(?:fix|edit|correct|adjust|change|update|revise|redo|regenerate|remove|replace|add)\b/iu
            .test(snapshot.promptText)
            || /\bmake\s+(?:this|that|it)\b/iu.test(snapshot.promptText)
        const generatedTargetWasSelected = Boolean(
            onlyCandidate
                && (targetCandidateId === onlyCandidate.candidateId
                    || parentCandidateId === onlyCandidate.candidateId
                    || (onlyCandidate.roleHints.includes('active-target')
                        && promptLooksLikeEdit)),
        )
        const generatedTarget = onlyCandidate?.roleHints.includes('generated-variant')
            && generatedTargetWasSelected
            ? onlyCandidate
            : undefined

        if (generatedTarget) {
            mode = 'edit-active-branch'
            operationKind = 'edit_existing'
            targetCandidateId = generatedTarget.candidateId
            parentCandidateId = generatedTarget.candidateId
            includeGeneratedCandidateIds = [
                ...new Set([
                    ...includeGeneratedCandidateIds,
                    generatedTarget.candidateId,
                ]),
            ]
            rationale = appendRationale(
                rationale,
                'Resolver guard retained the only explicit generated Asset as the edit target and continuation parent.',
            )
        } else {
            mode = 'fresh-branch'
            operationKind = 'new_image'
            targetCandidateId = null
            parentCandidateId = undefined
            includeGeneratedCandidateIds = []
            styleReferenceCandidateIds = []
            rationale = appendRationale(
                rationale,
                'Resolver guard kept the only explicit Asset as context and started a fresh branch because no competing branch candidate exists.',
            )
        }
    }

    if (
        operationKind === 'edit_existing'
        && !targetCandidateId
    ) {
        const activeTarget = snapshot.activeTargetCandidateId
            ? candidateById.get(snapshot.activeTargetCandidateId)
            : undefined

        if (!activeTarget)
            throw new Error('Image branch resolver returned edit_existing without an active target')

        mode = 'edit-active-branch'
        targetCandidateId = activeTarget.candidateId
        parentCandidateId = activeTarget.candidateId
        includeGeneratedCandidateIds = [
            ...new Set([
                ...includeGeneratedCandidateIds,
                activeTarget.candidateId,
            ]),
        ]
        rationale = appendRationale(rationale, 'Resolver guard restored the active target omitted from an edit_existing resolution.')
    }

    if (
        parentCandidateId
        && !candidateById.has(parentCandidateId)
    ) {
        const unknownParentCandidateId = parentCandidateId
        parentCandidateId = targetCandidateId
            && candidateById.has(targetCandidateId)
            ? targetCandidateId
            : undefined
        rationale = appendRationale(
            rationale,
            parentCandidateId
                ? `Resolver guard replaced unknown parentCandidateId ${unknownParentCandidateId} with targetCandidateId ${parentCandidateId}.`
                : `Resolver guard ignored unknown parentCandidateId ${unknownParentCandidateId}.`,
        )
    }

    assertKnownCandidateIds(
        'targetCandidateId',
        targetCandidateId ? [targetCandidateId] : [],
        candidateById,
    )
    assertKnownCandidateIds(
        'parentCandidateId',
        parentCandidateId ? [parentCandidateId] : [],
        candidateById,
    )
    assertKnownCandidateIds(
        'includeGeneratedCandidateIds',
        includeGeneratedCandidateIds,
        candidateById,
    )
    assertKnownCandidateIds(
        'styleReferenceCandidateIds',
        styleReferenceCandidateIds,
        candidateById,
    )

    if (
        targetCandidateId
        && !referenceCandidateIds.includes(targetCandidateId)
    )
        throw new Error(`Image branch resolver targetCandidateId is not in referenceCandidateIds: ${targetCandidateId}`)

    const targetCandidate = targetCandidateId ? candidateById.get(targetCandidateId) : undefined
    const rawBranchId = normalizeOptionalCandidateId(args.parsed.branchId)
    const generatedTargetWithoutActiveBranch = Boolean(
        targetCandidate
            && !targetCandidate.branchId
            && targetCandidate.roleHints.includes('generated-variant'),
    )
    const branchId = targetCandidate?.branchId
        ?? (mode === 'fresh-branch'
            || generatedTargetWithoutActiveBranch
            ? undefined
            : rawBranchId)
        ?? `branch-${randomUUID()}`

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
        excludedCandidateIds: [],
        visualEntitySummary: args.parsed.visualEntitySummary?.trim() || undefined,
        visualStyleSummary: args.parsed.visualStyleSummary?.trim() || undefined,
        entityTags: normalizeStringArray(args.parsed.entityTags),
        styleTags: normalizeStringArray(args.parsed.styleTags),
        confidence,
        rationale,
        decisions,
    }
}

export class MediaBranchAmbiguityError extends Error {
    readonly candidateAssetIds: string[]

    constructor({
        candidateAssetIds,
        rationale,
    }: {
        candidateAssetIds: string[]
        rationale: string
    }) {
        super(`MEDIA_BRANCH_REFERENCE_AMBIGUITY:${rationale}`)
        this.name = 'MediaBranchAmbiguityError'
        this.candidateAssetIds = [...new Set(candidateAssetIds)]
    }
}

const isCandidateImageBlock = (
    block: Record<string, any>,
    candidateImageUrls: Set<string>,
): boolean => {
    if (block?.type !== 'input_image')
        return false

    const imageUrl = block.image_url

    return typeof imageUrl === 'string' && candidateImageUrls.has(imageUrl)
}

const isImageMetadataBlock = (block: Record<string, any>): boolean => {
    if (
        block?.type !== 'input_text'
        || typeof block.text !== 'string'
    )
        return false

    try {
        const parsed = JSON.parse(block.text)

        return parsed?.type === 'standalone_image' || parsed?.type === 'generated_image_variant'
    } catch {
        return false
    }
}

const stripCandidateImageBlocks = (
    messages: ChatMessage[],
    candidateImageUrls: Set<string>,
): ChatMessage[] => {
    return messages.flatMap(message => {
        if (!Array.isArray(message.content))
            return [message]

        const filtered: Array<Record<string, any>> = []

        for (let index = 0; index < message.content.length; index++) {
            const block = message.content[index]

            if (block === undefined)
                continue

            if (
                typeof block !== 'object'
                || block === null
            ) {
                filtered.push(block)

                continue
            }

            if (isCandidateImageBlock(block, candidateImageUrls))
                continue

            const nextBlock = message.content[index + 1]
            const nextIsCandidateImage = typeof nextBlock === 'object'
                && nextBlock !== null
                && isCandidateImageBlock(nextBlock, candidateImageUrls)

            if (
                isImageMetadataBlock(block)
                && nextIsCandidateImage
            )
                continue

            filtered.push(block)
        }

        return filtered.length > 0 ? [{
            ...message,
            content: filtered,
        }] : []
    })
}

const buildResolvedBranchMessage = (
    resolution: MediaBranchVlmResolution,
    candidates: MediaBranchCandidateImage[],
): ChatMessage => {
    const candidateById = new Map(
        candidates.map(candidate => [candidate.candidateId, candidate]),
    )
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

        if (!candidate)
            continue

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
        blocks.push({
            type: 'input_image',
            image_url: candidate.imageUrl,
            detail: 'high',
        })
    }

    return {
        role: 'user',
        content: blocks,
    }
}

const buildFreshBranchResolution = (state: ProviderState): MediaBranchVlmResolution => {
    const snapshot = state.mediaBranchCandidateSnapshot

    if (!snapshot)
        throw new Error('Image branch candidate snapshot is required')

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

export const resolveMediaBranch = async (
    state: ProviderState,
    deps: ResolveMediaBranchDeps,
): Promise<Partial<ProviderState>> => {
    // The resolver runs for both image AND video generation: VEO image-to-video
    // and reference-conditioned video both need the same VLM grounding that
    // image generation uses.
    if (requiredCapabilityProducedCapabilityOnlyOutput(state))
        return {}

    const hasCapabilityMediaOutput = (
        state.capabilityOutputMediaAssetIds
            ?? state.capabilityOutputAssetIds
            ?? []
    ).length > 0

    if (
        !hasCapabilityMediaOutput
        && !state.imageModelVersion
        && !state.videoModelVersion
    )
        return {}

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
        info(
            `[MediaBranchResolver] resolved fresh branch ${
                JSON.stringify(
                    {
                        workspaceId: state.workspaceId,
                        aiChatThreadId: state.aiChatThreadId,
                        branchId: resolution.branchId,
                        rationale: resolution.rationale,
                    },
                    null,
                    0,
                )
            }`,
        )

        return { mediaBranchResolution: resolution }
    }

    const {
        provider,
        modelVersion,
    } = getResolverModel(state)
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
        const resolvedTarget = snapshot.resolvedTargetCandidateId
            ? resolvedCandidates.find(candidate => candidate.candidateId === snapshot.resolvedTargetCandidateId)
            : undefined

        if (
            snapshot.resolvedTargetCandidateId
            && !resolvedTarget
        )
            throw new Error('MEDIA_BRANCH_RESOLVED_TARGET_NOT_FOUND')

        const result: VlmCallResult<MediaBranchVlmRawResolution> = resolvedTarget
            ? {
                parsed: {
                    mode: 'edit-active-branch',
                    operationKind: 'edit_existing',
                    targetCandidateId: resolvedTarget.candidateId,
                    parentCandidateId: resolvedTarget.candidateId,
                    branchId: resolvedTarget.branchId ?? '',
                    includeGeneratedCandidateIds: [],
                    referenceCandidateIds: resolvedCandidates.map(candidate => candidate.candidateId),
                    sourceContextNodeIds: resolvedCandidates.flatMap(candidate => candidate.nodeId ? [candidate.nodeId] : []),
                    styleReferenceCandidateIds: [],
                    excludedCandidateIds: [],
                    visualEntitySummary: resolvedTarget.visualEntitySummary ?? '',
                    visualStyleSummary: resolvedTarget.visualStyleSummary ?? '',
                    entityTags: resolvedTarget.entityTags ?? [],
                    styleTags: resolvedTarget.styleTags ?? [],
                    confidence: 1,
                    rationale: 'The user selected this attached Asset to resolve branch ambiguity.',
                    decisions: [{
                        candidateId: resolvedTarget.candidateId,
                        role: 'target',
                        reason: 'Explicit user selection.',
                    }],
                },
                rawText: '',
                modelName: 'user-selection',
                promptTokens: 0,
                completionTokens: 0,
            }
            : await callVlm({
                provider,
                modelVersion,
                inferenceCapabilities: state.aiModelMetaInfo.inferenceCapabilities,
                systemPrompt: SYSTEM_PROMPT,
                userMessages: buildResolverMessages(resolverState),
                schema: RESOLUTION_SCHEMA,
                natsService: deps.natsService,
                temperature: 0.1,
                maxTokens: Math.min(state.aiModelMetaInfo.maxCompletionSize ?? 4096, 4096),
                maxOutputTokensCeiling: state.aiModelMetaInfo.maxCompletionSize,
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
        const candidateImageUrls: Set<string> = new Set(
            snapshot.candidates.map((candidate: MediaBranchCandidateImage) => candidate.imageUrl),
        )
        const cleanedMessages = stripCandidateImageBlocks(state.messages, candidateImageUrls)
        const resolvedBranchMessage = buildResolvedBranchMessage(resolution, resolvedCandidates)
        const messages = [resolvedBranchMessage, ...cleanedMessages]

        deps.publisher.mediaBranchResolved(resolution)
        info(
            `[MediaBranchResolver] resolved ${
                JSON.stringify(
                    {
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
                    },
                    null,
                    0,
                )
            }`,
        )

        // For video generation, map the explicit references and VLM-assigned roles onto the video
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

        if (
            state.videoModelVersion
            && resolution.referenceCandidateIds.length > 0
        ) {
            const urlByCandidateId = new Map(
                resolvedCandidates.map(candidate => [candidate.candidateId, candidate.imageUrl]),
            )
            const orderedFrames: string[] = []
            const pushFrame = (url: string | undefined): void => {
                if (
                    typeof url === 'string'
                    && url.length > 0
                    && !orderedFrames.includes(url)
                )
                    orderedFrames.push(url)
            }

            if (resolution.targetCandidateId)
                pushFrame(
                    urlByCandidateId.get(resolution.targetCandidateId),
                )

            for (const candidateId of resolution.referenceCandidateIds)
                pushFrame(
                    urlByCandidateId.get(candidateId),
                )

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
