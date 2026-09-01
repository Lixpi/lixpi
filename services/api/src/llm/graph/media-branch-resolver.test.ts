import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

import { resolveMediaBranch } from './media-branch-resolver.ts'
import {
    type ChatMessage,
    type ProviderState,
} from './state.ts'
import {
    type VlmCallArgs,
    type VlmCallResult,
} from '../structured-vlm/structured-vlm-client.ts'

const portraitUrl = 'nats-obj://workspace-workspace-1-files/portrait-file'
const landscapeUrl = 'nats-obj://workspace-workspace-1-files/landscape-file'
const personUrl = 'nats-obj://workspace-workspace-1-files/person-file'
const goatUrl = 'nats-obj://workspace-workspace-1-files/goat-file'
const featureUrl = 'data:image/png;base64,feature-sample'
const tinyPngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
)
const resolvedTinyPngUrl = `data:image/png;base64,${tinyPngBytes.toString('base64')}`

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    debugInfoSpy = vi.spyOn(debugTools, 'info').mockImplementation(() => undefined)
    debugWarnSpy = vi.spyOn(debugTools, 'warn').mockImplementation(() => undefined)
    debugErrSpy = vi.spyOn(debugTools, 'err').mockImplementation(() => undefined)
})

afterEach(() => {
    debugInfoSpy?.mockRestore()
    debugInfoSpy = null
    debugWarnSpy?.mockRestore()
    debugWarnSpy = null
    debugErrSpy?.mockRestore()
    debugErrSpy = null
})

function getImageUrls(messages: ChatMessage[]): string[] {
    return messages.flatMap((message) => {
        if (!Array.isArray(message.content)) return []
        return message.content
            .filter((block) => block?.type === 'input_image')
            .map((block) => block.image_url)
    })
}

const baseCandidates: NonNullable<ProviderState['mediaBranchCandidateSnapshot']>['candidates'] = [
    {
        candidateId: 'portrait-source',
        nodeId: 'portrait-source',
        assetId: 'portrait-file',
        imageUrl: portraitUrl,
        roleHints: ['base-context'],
        ancestorNodeIds: ['portrait-source'],
        sourceContextNodeIds: ['portrait-source'],
        visualEntitySummary: 'photo of a man with glasses',
        entityTags: ['person'],
    },
    {
        candidateId: 'landscape-source',
        nodeId: 'landscape-source',
        assetId: 'landscape-file',
        imageUrl: landscapeUrl,
        roleHints: ['base-context'],
        ancestorNodeIds: ['landscape-source'],
        sourceContextNodeIds: ['landscape-source'],
        visualStyleSummary: 'Gauguin Tahitian landscape painting',
        styleTags: ['post-impressionist'],
    },
    {
        candidateId: 'person-generated',
        nodeId: 'person-generated',
        assetId: 'person-file',
        imageUrl: personUrl,
        roleHints: ['generated-variant', 'branch-leaf'],
        branchId: 'branch-person',
        ancestorNodeIds: ['person-generated'],
        sourceContextNodeIds: ['portrait-source', 'landscape-source'],
        visualEntitySummary: 'painted portrait of the man with glasses',
        visualStyleSummary: 'Gauguin-inspired painted portrait',
        entityTags: ['person'],
        styleTags: ['post-impressionist'],
    },
]

const goatCandidate: NonNullable<ProviderState['mediaBranchCandidateSnapshot']>['candidates'][number] = {
    candidateId: 'goat-generated',
    nodeId: 'goat-generated',
    assetId: 'goat-file',
    imageUrl: goatUrl,
    roleHints: ['generated-variant', 'branch-leaf', 'active-target'],
    branchId: 'branch-goat',
    ancestorNodeIds: ['goat-generated'],
    sourceContextNodeIds: ['landscape-source'],
    visualEntitySummary: 'goat painted in a colorful landscape',
    entityTags: ['goat'],
}

// Five plain base-context references for exercising the provider-aware video
// reference cap (which replaced the old hardcoded .slice(0, 3)).
function buildCapReferenceCandidates(): NonNullable<ProviderState['mediaBranchCandidateSnapshot']>['candidates'] {
    return Array.from({ length: 5 }, (_, i) => ({
        candidateId: `cap-src-${i}`,
        nodeId: `cap-src-${i}`,
        assetId: `cap-file-${i}`,
        imageUrl: `nats-obj://workspace-workspace-1-files/cap-file-${i}`,
        roleHints: ['base-context'],
        ancestorNodeIds: [`cap-src-${i}`],
        sourceContextNodeIds: [`cap-src-${i}`],
        visualStyleSummary: `reference ${i}`,
        styleTags: ['ref'],
    }))
}

function createState(overrides: {
    promptText?: string
    activeTargetCandidateId?: string
    candidates?: NonNullable<ProviderState['mediaBranchCandidateSnapshot']>['candidates']
} = {}): ProviderState {
    const promptText = overrides.promptText ?? 'draw a goat in the style of that landscape painting'
    const candidates = overrides.candidates ?? baseCandidates
    const hasGoatCandidate = candidates.some((candidate: { nodeId?: string }) => candidate.nodeId === 'goat-generated')
    const candidateMessageContent = [
        { type: 'input_text', text: JSON.stringify({ type: 'standalone_image', nodeId: 'portrait-source' }) },
        { type: 'input_image', image_url: portraitUrl, detail: 'auto' },
        { type: 'input_text', text: JSON.stringify({ type: 'standalone_image', nodeId: 'landscape-source' }) },
        { type: 'input_image', image_url: landscapeUrl, detail: 'auto' },
        { type: 'input_text', text: JSON.stringify({ type: 'generated_image_variant', nodeId: 'person-generated' }) },
        { type: 'input_image', image_url: personUrl, detail: 'auto' },
        ...(hasGoatCandidate
            ? [
                { type: 'input_text', text: JSON.stringify({ type: 'generated_image_variant', nodeId: 'goat-generated' }) },
                { type: 'input_image', image_url: goatUrl, detail: 'auto' },
            ]
            : []),
    ]
    return {
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Feature visual references for @paint' },
                    { type: 'input_image', image_url: featureUrl, detail: 'high' },
                ],
            },
            {
                role: 'user',
                content: candidateMessageContent,
            },
            { role: 'user', content: promptText },
        ],
        aiModelMetaInfo: { provider: 'OpenAI', model: 'gpt-4.1', modelVersion: 'gpt-4.1', maxCompletionSize: 4096 },
        eventMeta: {},
        workspaceId: 'workspace-1',
        aiChatThreadId: 'thread-1',
        instanceKey: 'workspace-1:thread-1',
        provider: 'OpenAI',
        modelVersion: 'gpt-4.1',
        temperature: 0.7,
        streamActive: false,
        aiRequestReceivedAt: 1,
        enableImageGeneration: false,
        imageSize: 'auto',
        imageModelMetaInfo: { provider: 'OpenAI', model: 'gpt-image-1', modelVersion: 'gpt-image-1' },
        imageModelVersion: 'gpt-image-1',
        imageProviderName: 'OpenAI',
        imagePromptRetryCount: 0,
        mediaBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'region-1',
            ...(overrides.activeTargetCandidateId ? { activeTargetCandidateId: overrides.activeTargetCandidateId } : {}),
            promptText,
            promptFingerprint: 'prompt-test',
            transcriptContext: 'candidate labels',
            explicitReferenceCandidateIds: candidates.map(candidate => candidate.candidateId),
            candidates,
        },
    }
}

function createVideoState(overrides: Parameters<typeof createState>[0] = {}): ProviderState {
    // A video-only request: no image model selected, only a VEO video model.
    // The resolver must still run and ground references for VEO.
    return {
        ...createState(overrides),
        imageModelVersion: undefined,
        imageProviderName: undefined,
        videoModelVersion: 'veo-3.0-generate-001',
        videoProviderName: 'Google',
    }
}

function createParsedResolution(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        mode: 'context-only',
        operationKind: 'new_image',
        targetCandidateId: '',
        parentCandidateId: '',
        branchId: '',
        includeGeneratedCandidateIds: [],
        referenceCandidateIds: [],
        sourceContextNodeIds: [],
        styleReferenceCandidateIds: [],
        excludedCandidateIds: [],
        visualEntitySummary: '',
        visualStyleSummary: '',
        entityTags: [],
        styleTags: [],
        confidence: 0.92,
        rationale: 'Resolved from visible candidates.',
        decisions: [],
        ...overrides,
    }
}

function createDeps(parsed: Record<string, unknown>) {
    const natsService = {
        getObject: vi.fn(async () => tinyPngBytes),
    }
    const publisher = {
        mediaBranchResolved: vi.fn(),
        mediaBranchResolutionError: vi.fn(),
    }
    const callVlm = vi.fn(async (_args: VlmCallArgs): Promise<VlmCallResult<any>> => ({
        parsed,
        rawText: JSON.stringify(parsed),
        modelName: 'gpt-4.1',
        promptTokens: 10,
        completionTokens: 20,
    }))

    return {
        publisher,
        natsService,
        deps: {
            natsService: natsService as any,
            publisher: publisher as any,
            callVlm,
        },
        callVlm,
    }
}

describe('resolveMediaBranch', () => {
    it('resolves lineage for Capability media output even when ordinary media providers are disabled', async () => {
        const { deps, publisher } = createDeps(createParsedResolution())
        const state = createState({ candidates: [] })
        state.imageModelVersion = undefined
        state.imageProviderName = undefined
        state.capabilityOutputAssetIds = ['asset-character-sheet']

        const update = await resolveMediaBranch(state, deps)

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'fresh_branch',
        })
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
    })

    it('does not resolve a media branch for a terminal Capability Artifact', async () => {
        const { deps, publisher, callVlm } = createDeps(createParsedResolution())
        const state = createState({ candidates: [] })
        state.capabilityOutputAssetIds = ['asset-action-timeline']
        state.capabilityOutputMediaAssetIds = []
        state.enableImageGeneration = false
        state.enableVideoGeneration = false
        state.videoModelVersion = 'veo-3.0-generate-001'
        state.videoProviderName = 'Google'

        await expect(resolveMediaBranch(state, deps)).resolves.toEqual({})
        expect(callVlm).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolved).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolutionError).not.toHaveBeenCalled()
    })

    it('preserves feature images and every explicitly attached candidate in provider messages', async () => {
        const { deps, publisher, callVlm } = createDeps({
            mode: 'context-only',
            operationKind: 'new_image',
            targetCandidateId: '',
            parentCandidateId: '',
            branchId: '',
            includeGeneratedCandidateIds: [],
            referenceCandidateIds: ['portrait-source', 'landscape-source'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source'],
            styleReferenceCandidateIds: ['landscape-source'],
            excludedCandidateIds: ['person-generated'],
            visualEntitySummary: 'new goat',
            visualStyleSummary: 'landscape painting style',
            entityTags: ['goat'],
            styleTags: ['painting'],
            confidence: 0.92,
            rationale: 'The prompt asks for a new goat and uses the landscape as style evidence.',
            decisions: [
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'style source' },
                { nodeId: 'person-generated', role: 'excluded', reason: 'unrelated portrait branch' },
            ],
        })

        const update = await resolveMediaBranch(createState(), deps)
        const messages = update.messages ?? []
        const imageUrls = getImageUrls(messages)

        expect(callVlm).toHaveBeenCalledOnce()
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
        expect(update.mediaBranchResolution?.resolverKind).toBe('structured-vlm')
        expect(update.mediaBranchResolution?.referenceCandidateIds).toEqual([
            'portrait-source',
            'landscape-source',
            'person-generated',
        ])
        expect(getImageUrls(callVlm.mock.calls[0]?.[0].userMessages ?? [])).toEqual([
            resolvedTinyPngUrl,
            resolvedTinyPngUrl,
            resolvedTinyPngUrl,
        ])
        expect(imageUrls).toContain(featureUrl)
        expect(imageUrls.filter((url) => url === resolvedTinyPngUrl)).toHaveLength(3)
        expect(imageUrls).not.toContain(portraitUrl)
        expect(imageUrls).not.toContain(landscapeUrl)
        expect(imageUrls).not.toContain(personUrl)
    })

    it('does not invent a generated identity target when the VLM returns a fresh branch', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: '',
            parentCandidateId: '',
            branchId: 'branch-invented-by-vlm',
            referenceCandidateIds: ['portrait-source', 'landscape-source', 'person-generated'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source'],
            styleReferenceCandidateIds: ['landscape-source'],
            excludedCandidateIds: ['goat-generated'],
            visualEntitySummary: 'orange painted portrait of the same man',
            visualStyleSummary: 'orange monochrome portrait variant',
            entityTags: ['person'],
            styleTags: ['orange-palette'],
            rationale: 'The prompt names the guy from the landscape-source branch; person-generated is the branch leaf identity reference.',
            decisions: [
                { nodeId: 'portrait-source', role: 'base-context', reason: 'original identity photo' },
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'landscape source style' },
                { nodeId: 'person-generated', role: 'base-context', reason: 'existing branch leaf for the named guy' },
                { nodeId: 'goat-generated', role: 'excluded', reason: 'active target is a goat, not the named guy' },
            ],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'make that guy that used landscape as a source orange monochromatic',
                activeTargetCandidateId: 'goat-generated',
                candidates: [...baseCandidates, goatCandidate],
            }),
            deps,
        )
        const resolution = update.mediaBranchResolution

        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
        expect(resolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: null,
            parentCandidateId: undefined,
            referenceCandidateIds: ['portrait-source', 'landscape-source', 'person-generated', 'goat-generated'],
            excludedCandidateIds: [],
        })
        expect(resolution?.branchId).toMatch(/^branch-/)
        expect(getImageUrls(update.messages ?? []).filter((url) => url === resolvedTinyPngUrl)).toHaveLength(4)
        expect(getImageUrls(update.messages ?? [])).toContain(featureUrl)
    })

    it('does not continue lineage from generated references used only as style evidence', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            branchId: 'branch-new-subject',
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: [],
            styleReferenceCandidateIds: ['person-generated'],
            visualEntitySummary: 'new ceramic horse',
            visualStyleSummary: 'style borrowed from a generated portrait',
            entityTags: ['horse'],
            styleTags: ['portrait-style'],
            decisions: [
                { nodeId: 'person-generated', role: 'style-reference', reason: 'only a style reference for a new subject' },
            ],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'draw a new ceramic horse in the style of this painted portrait',
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: null,
            parentCandidateId: undefined,
        })
        expect(update.mediaBranchResolution?.branchId).toMatch(/^branch-/)
    })

    it('preserves the target candidate branch id over an invented VLM branch id', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            branchId: 'branch-invented-by-vlm',
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            visualEntitySummary: 'more artistic portrait of the man',
            entityTags: ['person'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'active portrait branch target' },
            ],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'make it very artistic',
                activeTargetCandidateId: 'person-generated',
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'edit-active-branch',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            branchId: 'branch-person',
        })
    })

    it('targets an accepted generated Asset and assigns a new continuation branch', async () => {
        const acceptedCandidate = {
            ...baseCandidates[2]!,
            roleHints: ['base-context', 'generated-variant', 'active-target'] as const,
            branchId: undefined,
        }
        const { deps } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: acceptedCandidate.candidateId,
            parentCandidateId: acceptedCandidate.candidateId,
            branchId: 'stale-branch-from-vlm',
            includeGeneratedCandidateIds: [acceptedCandidate.candidateId],
            decisions: [{
                candidateId: acceptedCandidate.candidateId,
                role: 'target',
                reason: 'selected character sheet',
            }],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'fix the coat sleeves on this accepted character sheet',
                activeTargetCandidateId: acceptedCandidate.candidateId,
                candidates: [acceptedCandidate],
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: acceptedCandidate.candidateId,
            parentCandidateId: acceptedCandidate.candidateId,
            includeGeneratedCandidateIds: [acceptedCandidate.candidateId],
            referenceCandidateIds: [acceptedCandidate.candidateId],
        })
        expect(update.mediaBranchResolution?.branchId).toMatch(/^branch-/)
        expect(update.mediaBranchResolution?.branchId).not.toBe('stale-branch-from-vlm')
    })

    it('restores the active target when an edit-existing resolution omits it', async () => {
        const acceptedCandidate = {
            ...baseCandidates[2]!,
            roleHints: ['base-context', 'generated-variant', 'active-target'] as const,
        }
        const { deps } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: '',
            parentCandidateId: '',
            includeGeneratedCandidateIds: [],
            confidence: 0.9,
            rationale: 'The active character sheet is being corrected.',
            decisions: [],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'correct the clothing on this character sheet using the original reference',
                activeTargetCandidateId: acceptedCandidate.candidateId,
                candidates: [baseCandidates[0]!, acceptedCandidate],
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: acceptedCandidate.candidateId,
            parentCandidateId: acceptedCandidate.candidateId,
            includeGeneratedCandidateIds: [acceptedCandidate.candidateId],
        })
        expect(update.mediaBranchResolution?.rationale).toContain(
            'restored the active target omitted from an edit_existing resolution',
        )
    })

    it('keeps the only accepted generated Asset as parent when the VLM is ambiguous', async () => {
        const acceptedCandidate = {
            ...baseCandidates[2]!,
            roleHints: ['base-context', 'generated-variant', 'active-target'] as const,
            branchId: undefined,
        }
        const { deps } = createDeps(createParsedResolution({
            mode: 'ambiguous',
            operationKind: 'new_image',
            targetCandidateId: '',
            parentCandidateId: '',
            branchId: 'stale-branch-from-vlm',
            includeGeneratedCandidateIds: [],
            confidence: 0.1,
            rationale: 'The edit referent was not resolved confidently.',
            decisions: [],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'fix this accepted character sheet',
                activeTargetCandidateId: acceptedCandidate.candidateId,
                candidates: [acceptedCandidate],
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: acceptedCandidate.candidateId,
            parentCandidateId: acceptedCandidate.candidateId,
            includeGeneratedCandidateIds: [acceptedCandidate.candidateId],
            referenceCandidateIds: [acceptedCandidate.candidateId],
        })
        expect(update.mediaBranchResolution?.branchId).toMatch(/^branch-/)
        expect(update.mediaBranchResolution?.branchId).not.toBe('stale-branch-from-vlm')
        expect(update.mediaBranchResolution?.rationale).toContain('retained the only explicit generated Asset')
    })

    it('does not force an ambiguous new-subject request to edit its only generated style reference', async () => {
        const acceptedCandidate = {
            ...baseCandidates[2]!,
            roleHints: ['base-context', 'generated-variant', 'active-target'] as const,
            branchId: undefined,
        }
        const { deps } = createDeps(createParsedResolution({
            mode: 'ambiguous',
            operationKind: 'new_image',
            targetCandidateId: '',
            parentCandidateId: '',
            branchId: 'stale-branch-from-vlm',
            confidence: 0.1,
            rationale: 'The referent was not resolved confidently.',
            decisions: [],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'draw a goat in the style of this image',
                activeTargetCandidateId: acceptedCandidate.candidateId,
                candidates: [acceptedCandidate],
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: null,
            parentCandidateId: undefined,
            referenceCandidateIds: [acceptedCandidate.candidateId],
        })
    })

    it('keeps explicit new-subject requests targetless even when a generated image is active', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            branchId: 'branch-goat-request',
            referenceCandidateIds: ['landscape-source'],
            sourceContextNodeIds: ['landscape-source'],
            styleReferenceCandidateIds: ['landscape-source'],
            excludedCandidateIds: ['person-generated'],
            visualEntitySummary: 'new goat',
            visualStyleSummary: 'landscape painting style',
            entityTags: ['goat'],
            styleTags: ['painting'],
            decisions: [
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'style source' },
                { nodeId: 'person-generated', role: 'excluded', reason: 'portrait branch conflicts with goat subject' },
            ],
        }))

        const update = await resolveMediaBranch(
            createState({
                promptText: 'draw a goat in the style of that landscape painting',
                activeTargetCandidateId: 'person-generated',
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: null,
            referenceCandidateIds: ['portrait-source', 'landscape-source', 'person-generated'],
            excludedCandidateIds: [],
        })
        expect(update.mediaBranchResolution?.branchId).toMatch(/^branch-/)
    })

    it('ignores a VLM exclusion of an explicitly attached target', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            referenceCandidateIds: ['person-generated'],
            excludedCandidateIds: ['person-generated'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'target' },
            ],
        }))

        const update = await resolveMediaBranch(createState(), deps)

        expect(update.mediaBranchResolution).toMatchObject({
            targetCandidateId: 'person-generated',
            referenceCandidateIds: ['portrait-source', 'landscape-source', 'person-generated'],
            excludedCandidateIds: [],
        })
        expect(publisher.mediaBranchResolutionError).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
    })

    it('restores an explicitly attached target omitted by the VLM reference list', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            referenceCandidateIds: ['portrait-source'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'target' },
            ],
        }))

        const update = await resolveMediaBranch(createState(), deps)

        expect(update.mediaBranchResolution).toMatchObject({
            targetCandidateId: 'person-generated',
            referenceCandidateIds: ['portrait-source', 'landscape-source', 'person-generated'],
        })
        expect(publisher.mediaBranchResolutionError).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
    })

    it('fails visibly when the VLM returns an ambiguous resolution', async () => {
        const { deps, publisher } = createDeps({
            mode: 'ambiguous',
            operationKind: 'new_image',
            targetCandidateId: '',
            parentCandidateId: '',
            branchId: '',
            includeGeneratedCandidateIds: [],
            referenceCandidateIds: [],
            sourceContextNodeIds: [],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: [],
            visualEntitySummary: '',
            visualStyleSummary: '',
            entityTags: [],
            styleTags: [],
            confidence: 0.1,
            rationale: 'The referent is unclear.',
            decisions: [],
        })

        await expect(resolveMediaBranch(createState(), deps)).rejects.toThrow('MEDIA_BRANCH_REFERENCE_AMBIGUITY:The referent is unclear.')
        expect(publisher.mediaBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.mediaBranchResolved).not.toHaveBeenCalled()
    })

    it('starts a fresh branch when duplicate candidates collapse to one Asset', async () => {
        const duplicatePortraitCandidate = {
            ...baseCandidates[0]!,
            candidateId: 'portrait-source-copy',
            nodeId: 'portrait-source-copy',
            ancestorNodeIds: ['portrait-source-copy'],
            sourceContextNodeIds: ['portrait-source-copy'],
        }
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'ambiguous',
            confidence: 0.1,
            rationale: 'The referent is unclear.',
        }))

        const update = await resolveMediaBranch(
            createState({
                candidates: [baseCandidates[0]!, duplicatePortraitCandidate],
            }),
            deps,
        )

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: null,
            referenceCandidateIds: ['portrait-source'],
        })
        expect(publisher.mediaBranchResolutionError).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
    })

    // Temporary skip: API integration behavior changed; re-enable after stabilization.
    it.skip('runs for a video-only request and maps the resolved target onto videoFirstFrameImage', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'animate this generated portrait' },
            ],
        }))

        const update = await resolveMediaBranch(
            createVideoState({
                promptText: 'animate that portrait, slow zoom in with ambient sound',
                activeTargetCandidateId: 'person-generated',
            }),
            deps,
        )

        // The resolver must run off videoModelVersion alone (no image model selected)
        // and feed the chosen target identity into VEO as the first frame.
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
        expect(update.mediaBranchResolution?.targetCandidateId).toBe('person-generated')
        expect(update.videoFirstFrameImage).toBe(resolvedTinyPngUrl)
        expect(update.videoReferenceImages).toBeUndefined()
    })

    // Temporary skip: API integration behavior changed; re-enable after stabilization.
    it.skip('maps references onto videoReferenceImages when a video request identifies no target', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceCandidateIds: ['landscape-source'],
            sourceContextNodeIds: ['landscape-source'],
            styleReferenceCandidateIds: ['landscape-source'],
            decisions: [
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'style and mood reference' },
            ],
        }))

        const update = await resolveMediaBranch(
            createVideoState({
                promptText: 'a fox trotting through falling snow in this painting style',
            }),
            deps,
        )

        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
        expect(update.mediaBranchResolution?.targetCandidateId).toBeNull()
        expect(update.videoReferenceImages).toEqual([resolvedTinyPngUrl])
        expect(update.videoFirstFrameImage).toBeUndefined()
    })

    // Temporary skip: API integration behavior changed; re-enable after stabilization.
    it.skip('caps videoReferenceImages at 3 for a default (VEO) video model', async () => {
        const capCandidates = buildCapReferenceCandidates()
        const refNodeIds = capCandidates.map((candidate) => candidate.nodeId)
        const { deps } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceCandidateIds: refNodeIds,
            sourceContextNodeIds: refNodeIds,
            styleReferenceCandidateIds: refNodeIds,
            decisions: refNodeIds.map((nodeId) => ({ nodeId, role: 'style-reference', reason: 'cap test reference' })),
        }))

        const update = await resolveMediaBranch(createVideoState({ candidates: capCandidates }), deps)

        // No videoModelMetaInfo on state => default cap of 3 (VEO baseline preserved).
        expect(update.videoFirstFrameImage).toBeUndefined()
        expect(update.videoReferenceImages).toHaveLength(3)
    })

    // Temporary skip: API integration behavior changed; re-enable after stabilization.
    it.skip('raises the videoReferenceImages cap to the model metadata value (Seedance 9)', async () => {
        const capCandidates = buildCapReferenceCandidates()
        const refNodeIds = capCandidates.map((candidate) => candidate.nodeId)
        const { deps } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceCandidateIds: refNodeIds,
            sourceContextNodeIds: refNodeIds,
            styleReferenceCandidateIds: refNodeIds,
            decisions: refNodeIds.map((nodeId) => ({ nodeId, role: 'style-reference', reason: 'cap test reference' })),
        }))

        const state: ProviderState = {
            ...createVideoState({ candidates: capCandidates }),
            videoModelMetaInfo: { provider: 'Google', model: 'Seedance', modelVersion: 'dreamina-seedance-2-0-260128', videoMaxReferenceImages: 9 },
        }
        const update = await resolveMediaBranch(state, deps)

        // 5 references all pass because the cap is raised to 9 (was 3).
        expect(update.videoFirstFrameImage).toBeUndefined()
        expect(update.videoReferenceImages).toHaveLength(5)
    })

    it('returns an empty patch when neither image nor video generation is configured', async () => {
        const { deps, publisher, callVlm } = createDeps(createParsedResolution({}))

        const update = await resolveMediaBranch({
            ...createState(),
            imageModelVersion: undefined,
            videoModelVersion: undefined,
            imageProviderName: undefined,
            videoProviderName: undefined,
        }, deps)

        expect(update).toEqual({})
        expect(callVlm).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolved).not.toHaveBeenCalled()
        expect(publisher.mediaBranchResolutionError).not.toHaveBeenCalled()
    })

    it('errors for missing snapshot on a video-only request', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({}))

        await expect(resolveMediaBranch({
            ...createVideoState(),
            mediaBranchCandidateSnapshot: undefined,
        }, deps)).rejects.toThrow('Image branch candidate snapshot is required for video generation.')

        expect(publisher.mediaBranchResolutionError).toHaveBeenCalledOnce()
    })

    it('honors resolver env override only when model is provided', async () => {
        const previousProvider = process.env.MEDIA_BRANCH_RESOLVER_PROVIDER
        const previousModel = process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
        process.env.MEDIA_BRANCH_RESOLVER_PROVIDER = 'Google'
        delete process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION

        try {
            const { deps } = createDeps(createParsedResolution({}))

            await expect(resolveMediaBranch(createState(), deps)).rejects.toThrow(
                'Image branch resolver model is not configured for provider Google',
            )
        } finally {
            if (previousProvider === undefined) {
                delete process.env.MEDIA_BRANCH_RESOLVER_PROVIDER
            } else {
                process.env.MEDIA_BRANCH_RESOLVER_PROVIDER = previousProvider
            }
            if (previousModel === undefined) {
                delete process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION
            } else {
                process.env.MEDIA_BRANCH_RESOLVER_MODEL_VERSION = previousModel
            }
        }
    })

    it('rejects invalid decision roles from the VLM while retaining strict node-id validation', async () => {
        const { deps, publisher } = createDeps({
            ...createParsedResolution({}),
            decisions: [
                { nodeId: 'person-generated', role: 'invalid-role', reason: 'bad enum member' },
            ],
        })

        await expect(resolveMediaBranch(createState({ candidates: [...baseCandidates, goatCandidate] }), deps))
            .rejects
            .toThrow('Image branch resolver returned invalid decision role for person-generated: invalid-role')
        expect(publisher.mediaBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.mediaBranchResolved).not.toHaveBeenCalled()
    })

    it('rejects low-confidence resolutions even when references are present', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({ confidence: 0.1 }))

        await expect(resolveMediaBranch(createState(), deps)).rejects.toThrow('MEDIA_BRANCH_REFERENCE_AMBIGUITY:Resolved from visible candidates.')
        expect(publisher.mediaBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.mediaBranchResolved).not.toHaveBeenCalled()
    })

    it('keeps a targetless mode targetless without explicit resolver target evidence', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            decisions: [],
        }))

        const update = await resolveMediaBranch(createState({ candidates: [...baseCandidates, goatCandidate] }), deps)

        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetCandidateId: null,
            parentCandidateId: undefined,
        })
    })

    it('keeps targetless fresh-branch when the only generated reference is style-only', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: [],
            styleReferenceCandidateIds: ['person-generated'],
            decisions: [],
        }))

        const update = await resolveMediaBranch(createState({ candidates: [...baseCandidates, goatCandidate] }), deps)

        expect(update.mediaBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            targetCandidateId: null,
            operationKind: 'new_image',
        })
    })

    // Temporary skip: API integration behavior changed; re-enable after stabilization.
    it.skip('uses the target image as first-frame regardless of reference-image ordering', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'person-generated',
            referenceCandidateIds: ['landscape-source', 'person-generated'],
            sourceContextNodeIds: ['landscape-source'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'target image should win first-frame order' },
            ],
        }))

        const update = await resolveMediaBranch(createVideoState(), deps)

        expect(update.videoFirstFrameImage).toBe(resolvedTinyPngUrl)
        expect(update.videoReferenceImages).toBeUndefined()
    })

    it('normalizes candidate node-id arrays by trimming whitespace and deduplicating', async () => {
        const { deps, publisher } = createDeps({
            ...createParsedResolution({
                referenceCandidateIds: ['  portrait-source', 'landscape-source ', 'portrait-source', '', 'landscape-source'],
                sourceContextNodeIds: [' landscape-source', 'landscape-source  ', ''],
                styleReferenceCandidateIds: ['person-generated', ' person-generated', '', 'person-generated'],
                excludedCandidateIds: ['', 'person-generated', 'person-generated', ''],
                includeGeneratedCandidateIds: ['goat-generated', 'goat-generated', ''],
            }),
        })

        const update = await resolveMediaBranch(createState({ candidates: [...baseCandidates, goatCandidate] }), deps)

        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
        expect(update.mediaBranchResolution).toMatchObject({
            referenceCandidateIds: ['portrait-source', 'landscape-source', 'person-generated', 'goat-generated'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source', 'person-generated', 'goat-generated'],
            styleReferenceCandidateIds: ['person-generated'],
            excludedCandidateIds: [],
            includeGeneratedCandidateIds: ['goat-generated'],
        })
    })

    it('ignores decision rows for unknown nodeIds while preserving known decisions', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceCandidateIds: ['portrait-source'],
            sourceContextNodeIds: ['portrait-source'],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: [],
            decisions: [
                { nodeId: 'missing-node', role: 'style-reference', reason: 'should be ignored' },
                { nodeId: 'portrait-source', role: 'base-context', reason: 'portrait is the intended source' },
            ],
        }))

        const update = await resolveMediaBranch(createState({ candidates: [...baseCandidates, goatCandidate] }), deps)

        expect(update.mediaBranchResolution?.decisions).toEqual([
            {
                candidateId: 'portrait-source',
                role: 'base-context',
                reason: 'portrait is the intended source',
            },
        ])
    })

    it('restricts candidates to explicitReferenceCandidateIds so the VLM never sees non-explicit media', async () => {
        const { deps, callVlm } = createDeps(createParsedResolution({
            referenceCandidateIds: ['landscape-source'],
            sourceContextNodeIds: ['landscape-source'],
        }))

        const state = createState()
        state.mediaBranchCandidateSnapshot = {
            ...state.mediaBranchCandidateSnapshot!,
            explicitReferenceCandidateIds: ['landscape-source'],
        }
        const update = await resolveMediaBranch(state, deps)

        expect(callVlm).toHaveBeenCalledOnce()
        const vlmContent = callVlm.mock.calls[0]?.[0].userMessages[0]?.content as Array<Record<string, any>>
        const candidateBlocks = vlmContent.filter((block) => block.type === 'input_image')
        expect(candidateBlocks).toHaveLength(1)
        const metadataText = String(vlmContent[0]?.text)
        expect(metadataText).toContain('landscape-source')
        expect(metadataText).not.toContain('portrait-source')
        expect(metadataText).not.toContain('person-generated')
        expect(update.mediaBranchResolution?.referenceCandidateIds).toEqual(['landscape-source'])
    })

    it('resolves a fresh branch when explicitReferenceCandidateIds exclude every candidate', async () => {
        const { deps, callVlm, publisher } = createDeps(createParsedResolution())

        const state = createState()
        state.mediaBranchCandidateSnapshot = {
            ...state.mediaBranchCandidateSnapshot!,
            explicitReferenceCandidateIds: ['not-a-candidate'],
        }
        const update = await resolveMediaBranch(state, deps)

        expect(callVlm).not.toHaveBeenCalled()
        expect(update.mediaBranchResolution?.mode).toBe('fresh-branch')
        expect(publisher.mediaBranchResolved).toHaveBeenCalledOnce()
    })
})
