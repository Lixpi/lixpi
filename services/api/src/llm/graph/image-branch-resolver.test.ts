'use strict'

import { describe, expect, it, vi } from 'vitest'

import { resolveImageBranch } from './image-branch-resolver.ts'
import type { ChatMessage, ProviderState } from './state.ts'
import type { VlmCallArgs, VlmCallResult } from '../extraction/vlm-client.ts'

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

function getImageUrls(messages: ChatMessage[]): string[] {
    return messages.flatMap((message) => {
        if (!Array.isArray(message.content)) return []
        return message.content
            .filter((block) => block?.type === 'input_image')
            .map((block) => block.image_url)
    })
}

const baseCandidates: NonNullable<ProviderState['imageBranchCandidateSnapshot']>['candidates'] = [
    {
        nodeId: 'portrait-source',
        fileId: 'portrait-file',
        workspaceId: 'workspace-1',
        imageUrl: portraitUrl,
        roleHints: ['base-context'],
        ancestorNodeIds: ['portrait-source'],
        sourceContextNodeIds: ['portrait-source'],
        visualEntitySummary: 'photo of a man with glasses',
        entityTags: ['person'],
    },
    {
        nodeId: 'landscape-source',
        fileId: 'landscape-file',
        workspaceId: 'workspace-1',
        imageUrl: landscapeUrl,
        roleHints: ['base-context'],
        ancestorNodeIds: ['landscape-source'],
        sourceContextNodeIds: ['landscape-source'],
        visualStyleSummary: 'Gauguin Tahitian landscape painting',
        styleTags: ['post-impressionist'],
    },
    {
        nodeId: 'person-generated',
        fileId: 'person-file',
        workspaceId: 'workspace-1',
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

const goatCandidate: NonNullable<ProviderState['imageBranchCandidateSnapshot']>['candidates'][number] = {
    nodeId: 'goat-generated',
    fileId: 'goat-file',
    workspaceId: 'workspace-1',
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
function buildCapReferenceCandidates(): NonNullable<ProviderState['imageBranchCandidateSnapshot']>['candidates'] {
    return Array.from({ length: 5 }, (_, i) => ({
        nodeId: `cap-src-${i}`,
        fileId: `cap-file-${i}`,
        workspaceId: 'workspace-1',
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
    activeTargetNodeId?: string
    candidates?: NonNullable<ProviderState['imageBranchCandidateSnapshot']>['candidates']
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
        ...(hasGoatCandidate ? [
            { type: 'input_text', text: JSON.stringify({ type: 'generated_image_variant', nodeId: 'goat-generated' }) },
            { type: 'input_image', image_url: goatUrl, detail: 'auto' },
        ] : []),
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
        imageBranchCandidateSnapshot: {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-1',
            regionNodeId: 'region-1',
            ...(overrides.activeTargetNodeId ? { activeTargetNodeId: overrides.activeTargetNodeId } : {}),
            promptText,
            promptFingerprint: 'prompt-test',
            transcriptContext: 'candidate labels',
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
        targetImageNodeId: '',
        parentImageNodeId: '',
        branchId: '',
        includeGeneratedNodeIds: [],
        referenceImageNodeIds: [],
        sourceContextNodeIds: [],
        styleReferenceNodeIds: [],
        excludedNodeIds: [],
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
        imageBranchResolved: vi.fn(),
        imageBranchResolutionError: vi.fn(),
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

describe('resolveImageBranch', () => {
    it('preserves feature images and removes unselected candidate images from provider messages', async () => {
        const { deps, publisher, callVlm } = createDeps({
            mode: 'context-only',
            operationKind: 'new_image',
            targetImageNodeId: '',
            parentImageNodeId: '',
            branchId: '',
            includeGeneratedNodeIds: [],
            referenceImageNodeIds: ['portrait-source', 'landscape-source'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source'],
            styleReferenceNodeIds: ['landscape-source'],
            excludedNodeIds: ['person-generated'],
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

        const update = await resolveImageBranch(createState(), deps)
        const messages = update.messages ?? []
        const imageUrls = getImageUrls(messages)

        expect(callVlm).toHaveBeenCalledOnce()
        expect(publisher.imageBranchResolved).toHaveBeenCalledOnce()
        expect(update.imageBranchResolution?.resolverKind).toBe('structured-vlm')
        expect(update.imageBranchResolution?.referenceImageNodeIds).toEqual(['portrait-source', 'landscape-source'])
        expect(getImageUrls(callVlm.mock.calls[0]?.[0].userMessages ?? [])).toEqual([
            resolvedTinyPngUrl,
            resolvedTinyPngUrl,
            resolvedTinyPngUrl,
        ])
        expect(imageUrls).toContain(featureUrl)
        expect(imageUrls.filter((url) => url === resolvedTinyPngUrl)).toHaveLength(2)
        expect(imageUrls).not.toContain(portraitUrl)
        expect(imageUrls).not.toContain(landscapeUrl)
        expect(imageUrls).not.toContain(personUrl)
    })

    it('continues a generated identity branch when the VLM returns targetless fresh-branch', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetImageNodeId: '',
            parentImageNodeId: '',
            branchId: 'branch-invented-by-vlm',
            referenceImageNodeIds: ['portrait-source', 'landscape-source', 'person-generated'],
            sourceContextNodeIds: ['portrait-source', 'landscape-source'],
            styleReferenceNodeIds: ['landscape-source'],
            excludedNodeIds: ['goat-generated'],
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

        const update = await resolveImageBranch(createState({
            promptText: 'make that guy that used landscape as a source orange monochromatic',
            activeTargetNodeId: 'goat-generated',
            candidates: [...baseCandidates, goatCandidate],
        }), deps)
        const resolution = update.imageBranchResolution

        expect(publisher.imageBranchResolved).toHaveBeenCalledOnce()
        expect(resolution).toMatchObject({
            mode: 'edit-active-branch',
            operationKind: 'style_transfer',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchId: 'branch-person',
            referenceImageNodeIds: ['portrait-source', 'landscape-source', 'person-generated'],
            excludedNodeIds: ['goat-generated'],
        })
        expect(resolution?.rationale).toContain('Resolver guard continued generated branch')
        expect(getImageUrls(update.messages ?? []).filter((url) => url === resolvedTinyPngUrl)).toHaveLength(3)
        expect(getImageUrls(update.messages ?? [])).toContain(featureUrl)
        expect(getImageUrls(update.messages ?? [])).not.toContain(goatUrl)
    })

    it('does not continue lineage from generated references used only as style evidence', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            branchId: 'branch-new-subject',
            referenceImageNodeIds: ['person-generated'],
            sourceContextNodeIds: [],
            styleReferenceNodeIds: ['person-generated'],
            visualEntitySummary: 'new ceramic horse',
            visualStyleSummary: 'style borrowed from a generated portrait',
            entityTags: ['horse'],
            styleTags: ['portrait-style'],
            decisions: [
                { nodeId: 'person-generated', role: 'style-reference', reason: 'only a style reference for a new subject' },
            ],
        }))

        const update = await resolveImageBranch(createState({
            promptText: 'draw a new ceramic horse in the style of this painted portrait',
        }), deps)

        expect(update.imageBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetImageNodeId: null,
            parentImageNodeId: undefined,
            branchId: 'branch-new-subject',
        })
    })

    it('preserves the target candidate branch id over an invented VLM branch id', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchId: 'branch-invented-by-vlm',
            referenceImageNodeIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            visualEntitySummary: 'more artistic portrait of the man',
            entityTags: ['person'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'active portrait branch target' },
            ],
        }))

        const update = await resolveImageBranch(createState({
            promptText: 'make it very artistic',
            activeTargetNodeId: 'person-generated',
        }), deps)

        expect(update.imageBranchResolution).toMatchObject({
            mode: 'edit-active-branch',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchId: 'branch-person',
        })
    })

    it('keeps explicit new-subject requests targetless even when a generated image is active', async () => {
        const { deps } = createDeps(createParsedResolution({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            branchId: 'branch-goat-request',
            referenceImageNodeIds: ['landscape-source'],
            sourceContextNodeIds: ['landscape-source'],
            styleReferenceNodeIds: ['landscape-source'],
            excludedNodeIds: ['person-generated'],
            visualEntitySummary: 'new goat',
            visualStyleSummary: 'landscape painting style',
            entityTags: ['goat'],
            styleTags: ['painting'],
            decisions: [
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'style source' },
                { nodeId: 'person-generated', role: 'excluded', reason: 'portrait branch conflicts with goat subject' },
            ],
        }))

        const update = await resolveImageBranch(createState({
            promptText: 'draw a goat in the style of that landscape painting',
            activeTargetNodeId: 'person-generated',
        }), deps)

        expect(update.imageBranchResolution).toMatchObject({
            mode: 'fresh-branch',
            operationKind: 'new_image',
            targetImageNodeId: null,
            branchId: 'branch-goat-request',
            referenceImageNodeIds: ['landscape-source'],
            excludedNodeIds: ['person-generated'],
        })
    })

    it('fails when the VLM excludes its own target', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            referenceImageNodeIds: ['person-generated'],
            excludedNodeIds: ['person-generated'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'target' },
            ],
        }))

        await expect(resolveImageBranch(createState(), deps)).rejects.toThrow('excluded its own targetImageNodeId')
        expect(publisher.imageBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.imageBranchResolved).not.toHaveBeenCalled()
    })

    it('fails when the VLM target is not included in referenceImageNodeIds', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            referenceImageNodeIds: ['portrait-source'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'target' },
            ],
        }))

        await expect(resolveImageBranch(createState(), deps)).rejects.toThrow('targetImageNodeId is not in referenceImageNodeIds')
        expect(publisher.imageBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.imageBranchResolved).not.toHaveBeenCalled()
    })

    it('fails visibly when the VLM returns an ambiguous resolution', async () => {
        const { deps, publisher } = createDeps({
            mode: 'ambiguous',
            operationKind: 'new_image',
            targetImageNodeId: '',
            parentImageNodeId: '',
            branchId: '',
            includeGeneratedNodeIds: [],
            referenceImageNodeIds: [],
            sourceContextNodeIds: [],
            styleReferenceNodeIds: [],
            excludedNodeIds: [],
            visualEntitySummary: '',
            visualStyleSummary: '',
            entityTags: [],
            styleTags: [],
            confidence: 0.1,
            rationale: 'The referent is unclear.',
            decisions: [],
        })

        await expect(resolveImageBranch(createState(), deps)).rejects.toThrow('could not disambiguate')
        expect(publisher.imageBranchResolutionError).toHaveBeenCalledOnce()
        expect(publisher.imageBranchResolved).not.toHaveBeenCalled()
    })

    it('runs for a video-only request and maps the resolved target onto videoFirstFrameImage', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            referenceImageNodeIds: ['person-generated'],
            sourceContextNodeIds: ['portrait-source'],
            decisions: [
                { nodeId: 'person-generated', role: 'target', reason: 'animate this generated portrait' },
            ],
        }))

        const update = await resolveImageBranch(createVideoState({
            promptText: 'animate that portrait, slow zoom in with ambient sound',
            activeTargetNodeId: 'person-generated',
        }), deps)

        // The resolver must run off videoModelVersion alone (no image model selected)
        // and feed the chosen target identity into VEO as the first frame.
        expect(publisher.imageBranchResolved).toHaveBeenCalledOnce()
        expect(update.imageBranchResolution?.targetImageNodeId).toBe('person-generated')
        expect(update.videoFirstFrameImage).toBe(resolvedTinyPngUrl)
        expect(update.videoReferenceImages).toBeUndefined()
    })

    it('maps references onto videoReferenceImages when a video request identifies no target', async () => {
        const { deps, publisher } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceImageNodeIds: ['landscape-source'],
            sourceContextNodeIds: ['landscape-source'],
            styleReferenceNodeIds: ['landscape-source'],
            decisions: [
                { nodeId: 'landscape-source', role: 'style-reference', reason: 'style and mood reference' },
            ],
        }))

        const update = await resolveImageBranch(createVideoState({
            promptText: 'a fox trotting through falling snow in this painting style',
        }), deps)

        expect(publisher.imageBranchResolved).toHaveBeenCalledOnce()
        expect(update.imageBranchResolution?.targetImageNodeId).toBeNull()
        expect(update.videoReferenceImages).toEqual([resolvedTinyPngUrl])
        expect(update.videoFirstFrameImage).toBeUndefined()
    })

    it('caps videoReferenceImages at 3 for a default (VEO) video model', async () => {
        const capCandidates = buildCapReferenceCandidates()
        const refNodeIds = capCandidates.map((candidate) => candidate.nodeId)
        const { deps } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceImageNodeIds: refNodeIds,
            sourceContextNodeIds: refNodeIds,
            styleReferenceNodeIds: refNodeIds,
            decisions: refNodeIds.map((nodeId) => ({ nodeId, role: 'style-reference', reason: 'cap test reference' })),
        }))

        const update = await resolveImageBranch(createVideoState({ candidates: capCandidates }), deps)

        // No videoModelMetaInfo on state => default cap of 3 (VEO baseline preserved).
        expect(update.videoFirstFrameImage).toBeUndefined()
        expect(update.videoReferenceImages).toHaveLength(3)
    })

    it('raises the videoReferenceImages cap to the model metadata value (Seedance 9)', async () => {
        const capCandidates = buildCapReferenceCandidates()
        const refNodeIds = capCandidates.map((candidate) => candidate.nodeId)
        const { deps } = createDeps(createParsedResolution({
            mode: 'context-only',
            operationKind: 'new_image',
            referenceImageNodeIds: refNodeIds,
            sourceContextNodeIds: refNodeIds,
            styleReferenceNodeIds: refNodeIds,
            decisions: refNodeIds.map((nodeId) => ({ nodeId, role: 'style-reference', reason: 'cap test reference' })),
        }))

        const state: ProviderState = {
            ...createVideoState({ candidates: capCandidates }),
            videoModelMetaInfo: { provider: 'Google', model: 'Seedance', modelVersion: 'dreamina-seedance-2-0-260128', videoMaxReferenceImages: 9 },
        }
        const update = await resolveImageBranch(state, deps)

        // 5 references all pass because the cap is raised to 9 (was 3).
        expect(update.videoFirstFrameImage).toBeUndefined()
        expect(update.videoReferenceImages).toHaveLength(5)
    })
})