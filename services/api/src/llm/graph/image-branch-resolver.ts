'use strict'

import * as process from 'process'
import { randomUUID } from 'crypto'

import type NatsService from '@lixpi/nats-service'
import { info } from '@lixpi/debug-tools'
import type {
    ImageBranchCandidateImage,
    ImageBranchVlmReferenceDecision,
    ImageBranchVlmResolution,
    ImageGenerationOperationKind,
    ProviderName,
} from '@lixpi/constants'

import { callStructuredVlm, type VlmCallArgs, type VlmCallResult, type VlmJsonSchema } from '../extraction/vlm-client.ts'
import { resolveImageUrls } from '../utils/attachments.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { StreamPublisher } from './stream-publisher.ts'

type ResolveImageBranchDeps = {
    natsService: NatsService
    publisher: StreamPublisher
    abortSignal?: AbortSignal
    callVlm?: (args: VlmCallArgs) => Promise<VlmCallResult<ImageBranchVlmRawResolution>>
}

type ImageBranchVlmRawResolution = {
    mode: string
    operationKind: string
    targetImageNodeId: string
    parentImageNodeId: string
    branchId: string
    includeGeneratedNodeIds: string[]
    referenceImageNodeIds: string[]
    sourceContextNodeIds: string[]
    styleReferenceNodeIds: string[]
    excludedNodeIds: string[]
    visualEntitySummary: string
    visualStyleSummary: string
    entityTags: string[]
    styleTags: string[]
    confidence: number
    rationale: string
    decisions: ImageBranchVlmReferenceDecision[]
}

const SUPPORTED_RESOLVER_PROVIDERS = new Set<ProviderName>(['Anthropic', 'OpenAI', 'Google'])
const RESOLVER_KIND = 'structured-vlm' as const

const VALID_MODES = new Set<ImageBranchVlmResolution['mode']>([
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
            targetImageNodeId: {
                type: 'string',
                description: 'Candidate nodeId being edited. Empty string when the prompt requests a new/fresh image rather than editing an existing generated image.',
            },
            parentImageNodeId: {
                type: 'string',
                description: 'Parent generated image nodeId for placement. Empty string when there is no generated-image parent.',
            },
            branchId: {
                type: 'string',
                description: 'Existing branchId to continue, or empty string for a new branch.',
            },
            includeGeneratedNodeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Generated candidate nodeIds selected as target/comparison visual references.',
            },
            referenceImageNodeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Exact candidate nodeIds that should be sent to the image or video model as visual references.',
            },
            sourceContextNodeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Base context candidate nodeIds relevant to the request.',
            },
            styleReferenceNodeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Candidate nodeIds used as style, palette, medium, mood, or composition evidence rather than target identity.',
            },
            excludedNodeIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Candidate nodeIds that should not be sent because they are unrelated or would contaminate identity/style.',
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
                        nodeId: { type: 'string' },
                        role: {
                            type: 'string',
                            enum: ['target', 'base-context', 'style-reference', 'comparison-target', 'excluded'],
                        },
                        reason: { type: 'string' },
                    },
                    required: ['nodeId', 'role', 'reason'],
                    additionalProperties: false,
                },
            },
        },
        required: [
            'mode',
            'operationKind',
            'targetImageNodeId',
            'parentImageNodeId',
            'branchId',
            'includeGeneratedNodeIds',
            'referenceImageNodeIds',
            'sourceContextNodeIds',
            'styleReferenceNodeIds',
            'excludedNodeIds',
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
    'If the candidate metadata includes roleHints containing "active-target" or the prompt context names an Active target nodeId, treat that as a weak UI selection hint only. It is not visual truth and must never override the user prompt or candidate pixels.',
    'Purely deictic prompts like "this", "that", "it", or "make it" usually refer to the active-target candidate. Deictic prompts with an explicit visible subject like "that man", "that guy", "that person", "that goat", "that portrait", or "that landscape" must target a candidate whose pixels match that named subject. If the active target visibly conflicts with the named subject, exclude it and choose the matching candidate; if no candidate matches, return mode="ambiguous" with low confidence.',
    'For style/medium changes to an active-target candidate, return mode="edit-active-branch", operationKind="edit_existing", targetImageNodeId set to the active target nodeId, and include the active target as a reference only when the prompt is purely deictic or the active target visibly matches the named subject. Do not use the active target for a different visible subject or a fresh unrelated image.',
    'If the prompt identifies an existing generated candidate or branch as the subject/identity, continue that generated branch even when the requested palette, medium, or style changes substantially. If you include a generated candidate as the target/identity reference, set targetImageNodeId to that generated candidate, set parentImageNodeId to that candidate, preserve its branchId when available, and do not return targetless mode="fresh-branch".',
    'Separate target identity from style/source evidence. A phrase like "draw a goat in the style of that landscape painting" means the goat is the requested subject and the landscape can be style evidence; unrelated generated portraits must be excluded.',
    'referenceImageNodeIds is authoritative: include only candidate nodeIds that should be sent to the image or video model. Exclude distractors aggressively because unrelated generated variants contaminate identity.',
    'Reserve mode="ambiguous" strictly for when the visual referent genuinely cannot be determined from the candidate pixels — never to flag an unsupported output type or a request you believe cannot be fulfilled. If the prompt is genuinely impossible to resolve from the candidate images, return mode="ambiguous" with low confidence and explain why.',
].join('\n')

const getResolverModel = (state: ProviderState): { provider: ProviderName; modelVersion: string } => {
    const configuredProvider = process.env.IMAGE_BRANCH_RESOLVER_PROVIDER as ProviderName | undefined
    const configuredModel = process.env.IMAGE_BRANCH_RESOLVER_MODEL_VERSION
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

const compactCandidateForPrompt = (candidate: ImageBranchCandidateImage): Record<string, unknown> => ({
    nodeId: candidate.nodeId,
    roleHints: candidate.roleHints,
    branchId: candidate.branchId ?? '',
    parentImageNodeId: candidate.parentImageNodeId ?? '',
    ancestorNodeIds: candidate.ancestorNodeIds,
    sourceContextNodeIds: candidate.sourceContextNodeIds,
    sourceMessageId: candidate.sourceMessageId ?? '',
    promptText: candidate.promptText ?? '',
    visualEntitySummary: candidate.visualEntitySummary ?? '',
    visualStyleSummary: candidate.visualStyleSummary ?? '',
    entityTags: candidate.entityTags ?? [],
    styleTags: candidate.styleTags ?? [],
    createdAt: candidate.createdAt ?? 0,
})

const resolveCandidateImageUrls = async (
    candidates: ImageBranchCandidateImage[],
    natsService: NatsService,
): Promise<ImageBranchCandidateImage[]> => {
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
    const snapshot = state.imageBranchCandidateSnapshot
    if (!snapshot) throw new Error('Image branch candidate snapshot is required')

    const blocks: Array<Record<string, any>> = [{
        type: 'input_text',
        text: [
            `User prompt: ${snapshot.promptText}`,
            `Prompt fingerprint: ${snapshot.promptFingerprint}`,
            `Thread ID: ${snapshot.threadId}`,
            `Region node ID: ${snapshot.regionNodeId}`,
            snapshot.activeTargetNodeId ? `Active target node ID: ${snapshot.activeTargetNodeId}` : undefined,
            '',
            'Candidate metadata JSON:',
            JSON.stringify(snapshot.candidates.map(compactCandidateForPrompt), null, 2),
            '',
            'Transcript/candidate context:',
            snapshot.transcriptContext,
            '',
            'Inspect each attached candidate image. Return strict JSON using the tool schema. Use nodeId values exactly as given.',
        ].filter((line): line is string => typeof line === 'string').join('\n'),
    }]

    for (const candidate of snapshot.candidates) {
        blocks.push({
            type: 'input_text',
            text: `Candidate image nodeId=${candidate.nodeId} roleHints=${candidate.roleHints.join(',')} branchId=${candidate.branchId ?? ''}`,
        })
        blocks.push({ type: 'input_image', image_url: candidate.imageUrl, detail: 'high' })
    }

    return [{ role: 'user', content: blocks }]
}

const normalizeOptionalNodeId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())))
}

const assertKnownNodeIds = (label: string, nodeIds: string[], candidateByNodeId: Map<string, ImageBranchCandidateImage>): void => {
    const unknown = nodeIds.filter((nodeId) => !candidateByNodeId.has(nodeId))
    if (unknown.length > 0) {
        throw new Error(`Image branch resolver returned unknown ${label}: ${unknown.join(', ')}`)
    }
}

const sanitizeDecisions = (
    decisions: unknown,
    candidateByNodeId: Map<string, ImageBranchCandidateImage>
): ImageBranchVlmReferenceDecision[] => {
    if (!Array.isArray(decisions)) return []
    const out: ImageBranchVlmReferenceDecision[] = []
    for (const decision of decisions) {
        if (typeof decision !== 'object' || decision === null) continue
        const nodeId = normalizeOptionalNodeId((decision as any).nodeId)
        if (!nodeId) continue
        assertKnownNodeIds('decision nodeIds', [nodeId], candidateByNodeId)
        const role = (decision as any).role
        if (!['target', 'base-context', 'style-reference', 'comparison-target', 'excluded'].includes(role)) {
            throw new Error(`Image branch resolver returned invalid decision role for ${nodeId}: ${role}`)
        }
        out.push({
            nodeId,
            role,
            reason: typeof (decision as any).reason === 'string' ? (decision as any).reason : '',
        })
    }
    return out
}

const isGeneratedCandidate = (candidate: ImageBranchCandidateImage): boolean =>
    candidate.roleHints.includes('generated-variant')

const findGeneratedTargetReference = (args: {
    candidateByNodeId: Map<string, ImageBranchCandidateImage>
    referenceImageNodeIds: string[]
    styleReferenceNodeIds: string[]
    decisions: ImageBranchVlmReferenceDecision[]
}): ImageBranchCandidateImage | undefined => {
    const styleReferenceNodeIds = new Set(args.styleReferenceNodeIds)
    const decisionByNodeId = new Map(args.decisions.map((decision) => [decision.nodeId, decision]))
    const generatedReferences = args.referenceImageNodeIds
        .map((nodeId) => args.candidateByNodeId.get(nodeId))
        .filter((candidate): candidate is ImageBranchCandidateImage => Boolean(candidate && isGeneratedCandidate(candidate)))
        .filter((candidate) => !styleReferenceNodeIds.has(candidate.nodeId))
        .filter((candidate) => decisionByNodeId.get(candidate.nodeId)?.role !== 'style-reference')

    const explicitTargetReferences = generatedReferences.filter((candidate) => {
        const role = decisionByNodeId.get(candidate.nodeId)?.role
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
    parsed: ImageBranchVlmRawResolution
    state: ProviderState
    resolverProvider: ProviderName
    resolverModelId: string
}): ImageBranchVlmResolution => {
    const snapshot = args.state.imageBranchCandidateSnapshot
    if (!snapshot) throw new Error('Image branch candidate snapshot is required')

    const candidateByNodeId: Map<string, ImageBranchCandidateImage> = new Map(snapshot.candidates.map((candidate: ImageBranchCandidateImage) => [candidate.nodeId, candidate]))
    let mode = args.parsed.mode as ImageBranchVlmResolution['mode']
    let operationKind = args.parsed.operationKind as ImageGenerationOperationKind
    if (!VALID_MODES.has(mode)) throw new Error(`Image branch resolver returned invalid mode: ${args.parsed.mode}`)
    if (!VALID_OPERATION_KINDS.has(operationKind)) throw new Error(`Image branch resolver returned invalid operationKind: ${args.parsed.operationKind}`)

    let targetImageNodeId = normalizeOptionalNodeId(args.parsed.targetImageNodeId)
    let parentImageNodeId = normalizeOptionalNodeId(args.parsed.parentImageNodeId) ?? targetImageNodeId ?? undefined
    const includeGeneratedNodeIds = normalizeStringArray(args.parsed.includeGeneratedNodeIds)
    const referenceImageNodeIds = normalizeStringArray(args.parsed.referenceImageNodeIds)
    const sourceContextNodeIds = normalizeStringArray(args.parsed.sourceContextNodeIds)
    const styleReferenceNodeIds = normalizeStringArray(args.parsed.styleReferenceNodeIds)
    let excludedNodeIds = normalizeStringArray(args.parsed.excludedNodeIds)
    const decisions = sanitizeDecisions(args.parsed.decisions, candidateByNodeId)

    let rationale = typeof args.parsed.rationale === 'string' ? args.parsed.rationale.trim() : ''
    if (!targetImageNodeId && (mode === 'fresh-branch' || operationKind === 'new_image' || operationKind === 'fresh_branch')) {
        const generatedTarget = findGeneratedTargetReference({
            candidateByNodeId,
            referenceImageNodeIds,
            styleReferenceNodeIds,
            decisions,
        })
        if (generatedTarget) {
            targetImageNodeId = generatedTarget.nodeId
            parentImageNodeId = generatedTarget.nodeId
            mode = 'edit-active-branch'
            if (operationKind === 'new_image' || operationKind === 'fresh_branch') operationKind = 'style_transfer'
            excludedNodeIds = excludedNodeIds.filter((nodeId) => nodeId !== generatedTarget.nodeId)
            rationale = [
                rationale,
                `Resolver guard continued generated branch via selected target reference ${generatedTarget.nodeId}.`,
            ].filter(Boolean).join(' ')
        }
    }

    assertKnownNodeIds('targetImageNodeId', targetImageNodeId ? [targetImageNodeId] : [], candidateByNodeId)
    assertKnownNodeIds('parentImageNodeId', parentImageNodeId ? [parentImageNodeId] : [], candidateByNodeId)
    assertKnownNodeIds('includeGeneratedNodeIds', includeGeneratedNodeIds, candidateByNodeId)
    assertKnownNodeIds('referenceImageNodeIds', referenceImageNodeIds, candidateByNodeId)
    assertKnownNodeIds('sourceContextNodeIds', sourceContextNodeIds, candidateByNodeId)
    assertKnownNodeIds('styleReferenceNodeIds', styleReferenceNodeIds, candidateByNodeId)
    assertKnownNodeIds('excludedNodeIds', excludedNodeIds, candidateByNodeId)

    if (targetImageNodeId && excludedNodeIds.includes(targetImageNodeId)) {
        throw new Error(`Image branch resolver excluded its own targetImageNodeId: ${targetImageNodeId}`)
    }
    if (targetImageNodeId && !referenceImageNodeIds.includes(targetImageNodeId)) {
        throw new Error(`Image branch resolver targetImageNodeId is not in referenceImageNodeIds: ${targetImageNodeId}`)
    }

    const confidence = Math.max(0, Math.min(1, Number(args.parsed.confidence) || 0))
    if (mode === 'ambiguous') {
        throw new Error(`Image branch resolver could not disambiguate: ${rationale || 'ambiguous visual reference'}`)
    }
    if (confidence < 0.2) {
        throw new Error(`Image branch resolver confidence too low (${confidence}): ${rationale || 'no rationale provided'}`)
    }

    const targetCandidate = targetImageNodeId ? candidateByNodeId.get(targetImageNodeId) : undefined
    const rawBranchId = normalizeOptionalNodeId(args.parsed.branchId)
    const branchId = targetCandidate?.branchId ?? rawBranchId ?? `branch-${randomUUID()}`

    return {
        resolverKind: RESOLVER_KIND,
        resolverVersion: snapshot.resolverVersion,
        resolverModelProvider: args.resolverProvider,
        resolverModelId: args.resolverModelId,
        mode,
        operationKind,
        targetImageNodeId,
        parentImageNodeId,
        branchId,
        includeGeneratedNodeIds,
        referenceImageNodeIds,
        sourceContextNodeIds,
        styleReferenceNodeIds,
        excludedNodeIds,
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
    resolution: ImageBranchVlmResolution,
    candidates: ImageBranchCandidateImage[]
): ChatMessage => {
    const candidateByNodeId = new Map(candidates.map((candidate) => [candidate.nodeId, candidate]))
    const blocks: Array<Record<string, any>> = [{
        type: 'input_text',
        text: JSON.stringify({
            type: 'image_branch_vlm_resolution',
            mode: resolution.mode,
            operationKind: resolution.operationKind,
            targetImageNodeId: resolution.targetImageNodeId,
            referenceImageNodeIds: resolution.referenceImageNodeIds,
            styleReferenceNodeIds: resolution.styleReferenceNodeIds,
            excludedNodeIds: resolution.excludedNodeIds,
            rationale: resolution.rationale,
        }),
    }]

    for (const nodeId of resolution.referenceImageNodeIds) {
        const candidate = candidateByNodeId.get(nodeId)
        if (!candidate) continue
        blocks.push({
            type: 'input_text',
            text: JSON.stringify({
                type: 'image_branch_selected_reference',
                nodeId: candidate.nodeId,
                roleHints: candidate.roleHints,
                branchId: candidate.branchId ?? '',
            }),
        })
        blocks.push({ type: 'input_image', image_url: candidate.imageUrl, detail: 'high' })
    }

    return { role: 'user', content: blocks }
}

export const resolveImageBranch = async (state: ProviderState, deps: ResolveImageBranchDeps): Promise<Partial<ProviderState>> => {
    // The resolver runs for both image AND video generation: VEO image-to-video
    // and reference-conditioned video both need the same VLM grounding that
    // image generation uses.
    if (!state.imageModelVersion && !state.videoModelVersion) return {}
    const snapshot = state.imageBranchCandidateSnapshot
    if (!snapshot) {
        const message = state.videoModelVersion
            ? 'Image branch candidate snapshot is required for video generation.'
            : 'Image branch candidate snapshot is required for image generation.'
        deps.publisher.imageBranchResolutionError(message)
        throw new Error(message)
    }

    const { provider, modelVersion } = getResolverModel(state)
    const callVlm = deps.callVlm ?? ((args: VlmCallArgs) => callStructuredVlm<ImageBranchVlmRawResolution>(args))

    try {
        const resolvedCandidates = await resolveCandidateImageUrls(snapshot.candidates, deps.natsService)
        const resolverState: ProviderState = {
            ...state,
            imageBranchCandidateSnapshot: {
                ...snapshot,
                candidates: resolvedCandidates,
            },
        }
        const result: VlmCallResult<ImageBranchVlmRawResolution> = await callVlm({
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
            state,
            resolverProvider: provider,
            resolverModelId: result.modelName || modelVersion,
        })
        const candidateImageUrls: Set<string> = new Set(snapshot.candidates.map((candidate: ImageBranchCandidateImage) => candidate.imageUrl))
        const cleanedMessages = stripCandidateImageBlocks(state.messages, candidateImageUrls)
        const resolvedBranchMessage = buildResolvedBranchMessage(resolution, resolvedCandidates)
        const messages = [resolvedBranchMessage, ...cleanedMessages]

        deps.publisher.imageBranchResolved(resolution)
        info(`[ImageBranchResolver] resolved ${JSON.stringify({
            workspaceId: state.workspaceId,
            aiChatThreadId: state.aiChatThreadId,
            provider,
            model: result.modelName || modelVersion,
            activeTargetNodeId: snapshot.activeTargetNodeId,
            mode: resolution.mode,
            operationKind: resolution.operationKind,
            targetImageNodeId: resolution.targetImageNodeId,
            referenceImageNodeIds: resolution.referenceImageNodeIds,
            excludedNodeIds: resolution.excludedNodeIds,
            confidence: resolution.confidence,
            rationale: resolution.rationale,
        }, null, 0)}`)

        // For video generation, map the VLM-selected references onto VEO inputs.
        // VEO's `image` (first frame, image-to-video) and `referenceImages`
        // (up to 3 style/content guides) are MUTUALLY EXCLUSIVE in the API,
        // so we pick one path based on whether the resolver identified a target:
        //   - target set (edit / style_transfer / continuation) -> first-frame mode
        //   - no target, refs present                            -> referenceImages mode
        //   - no refs at all                                     -> text-to-video (both undefined)
        let videoFirstFrameImage: string | undefined
        let videoReferenceImages: string[] | undefined
        if (state.videoModelVersion && resolution.referenceImageNodeIds.length > 0) {
            const urlByNodeId = new Map(resolvedCandidates.map(c => [c.nodeId, c.imageUrl]))
            const orderedUrls = resolution.referenceImageNodeIds
                .map(nodeId => urlByNodeId.get(nodeId))
                .filter((url): url is string => typeof url === 'string' && url.length > 0)

            if (resolution.targetImageNodeId) {
                videoFirstFrameImage = urlByNodeId.get(resolution.targetImageNodeId) ?? orderedUrls[0]
            } else if (orderedUrls.length > 0) {
                videoReferenceImages = orderedUrls.slice(0, 3)
            }
        }

        return {
            imageBranchResolution: resolution,
            messages,
            videoFirstFrameImage,
            videoReferenceImages,
        }
    } catch (error: any) {
        const message = error?.message ?? String(error)
        deps.publisher.imageBranchResolutionError(message)
        throw error
    }
}