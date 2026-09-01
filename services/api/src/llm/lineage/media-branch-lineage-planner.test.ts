import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type MediaBranchCandidateImage,
    type MediaBranchCandidateSnapshot,
    type MediaBranchVlmResolution,
} from '@lixpi/constants'

import { MediaBranchLineagePlanner } from './media-branch-lineage-planner.ts'

const planner = new MediaBranchLineagePlanner()

const candidate = (overrides: Partial<MediaBranchCandidateImage>): MediaBranchCandidateImage => {
    const nodeId = overrides.nodeId ?? 'node-1'
    return {
        candidateId: overrides.candidateId ?? nodeId,
        nodeId,
        assetId: overrides.assetId ?? `asset:${nodeId}`,
        imageUrl: `nats-obj://assets/${nodeId}`,
        roleHints: [],
        ancestorNodeIds: [nodeId],
        sourceContextNodeIds: [nodeId],
        visualEntitySummary: 'base image',
        ...overrides,
    }
}

describe('MediaBranchLineagePlanner', () => {
    it('continues an unambiguous active generated branch before semantic resolution finishes', () => {
        const plan = planner.buildPlan({
            generationRequestId: 'request-provisional-continuation',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: {
                resolverVersion: 'image-branch-vlm-v1',
                conversationAssetId: 'thread-1',
                regionNodeId: 'standalone:thread-1',
                activeTargetCandidateId: 'node:derived-output',
                explicitReferenceCandidateIds: ['node:source-input', 'node:derived-output'],
                promptText: 'adjust only the derived output',
                promptFingerprint: 'prompt-provisional',
                transcriptContext: '',
                candidates: [
                    candidate({
                        candidateId: 'node:source-input',
                        nodeId: 'source-input',
                        roleHints: ['base-context'],
                    }),
                    candidate({
                        candidateId: 'node:derived-output',
                        nodeId: 'derived-output',
                        roleHints: ['generated-variant', 'branch-leaf', 'active-target'],
                        branchId: 'branch-existing',
                        sourceContextNodeIds: ['source-input', 'derived-output'],
                    }),
                ],
            },
            createdAt: 1700000000000,
        })

        expect(plan.sourceNodeId).toBe('derived-output')
        expect(plan.placementAnchorNodeId).toBe('derived-output')
        expect(plan.branchId).toBe('branch-existing')
        expect(plan.branchOrigin).toBeUndefined()
        expect(plan.branchLines).toEqual([
            expect.objectContaining({
                parentBranchNodeId: 'derived-output',
                branchId: 'branch-existing',
            }),
        ])
        expect(plan.runAssignments[0]).toMatchObject({
            parentMediaNodeId: 'derived-output',
            lineageParentNodeId: plan.branchLines[0]?.nodeId,
        })
    })

    it('does not turn an active base reference into a generated lineage continuation', () => {
        const plan = planner.buildPlan({
            generationRequestId: 'request-provisional-root',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: {
                resolverVersion: 'image-branch-vlm-v1',
                conversationAssetId: 'thread-1',
                regionNodeId: 'standalone:thread-1',
                activeTargetCandidateId: 'node:source-input',
                explicitReferenceCandidateIds: ['node:source-input'],
                promptText: 'create a new output using the reference',
                promptFingerprint: 'prompt-root',
                transcriptContext: '',
                candidates: [candidate({
                    candidateId: 'node:source-input',
                    nodeId: 'source-input',
                    roleHints: ['base-context', 'active-target'],
                })],
            },
            createdAt: 1700000000000,
        })

        expect(plan.sourceNodeId).toBeUndefined()
        expect(plan.placementAnchorNodeId).toBe('source-input')
        expect(plan.branchOrigin).toBeDefined()
        expect(plan.branchLines).toEqual([])
    })

    it('places a preassigned Capability output through the normal lineage topology without creating another Asset', () => {
        const plan = planner.buildPlan({
            generationRequestId: 'request-character',
            reasoningModelIds: ['capability:character-creator'],
            preassignedMediaRuns: [{
                assetId: 'asset-character-sheet',
                reasoningModelId: 'capability:character-creator',
                reasoningRunId: 'capability-run-1',
                reasoningIndex: 0,
                mediaModelId: 'Google:imagen',
                mediaType: 'image',
                mediaIndex: 0,
                mediaRunId: 'capability-run-1:image:0',
            }],
            mediaBranchCandidateSnapshot: {
                resolverVersion: 'image-branch-vlm-v1',
                conversationAssetId: 'thread-1',
                regionNodeId: 'region-root',
                promptText: 'create a character',
                promptFingerprint: 'character-fp',
                transcriptContext: '',
                candidates: [candidate({
                    nodeId: 'source-character',
                    roleHints: ['generated-variant', 'branch-leaf'],
                    branchId: 'branch-character',
                })],
            },
            mediaBranchResolution: {
                resolverKind: 'structured-vlm',
                resolverVersion: 'image-branch-vlm-v1',
                resolverModelProvider: 'OpenAI',
                resolverModelId: 'gpt-4.1',
                mode: 'edit-active-branch',
                operationKind: 'edit_existing',
                targetCandidateId: 'source-character',
                branchId: 'branch-character',
                includeGeneratedCandidateIds: [],
                referenceCandidateIds: ['source-character'],
                sourceContextNodeIds: ['source-character'],
                styleReferenceCandidateIds: [],
                excludedCandidateIds: [],
                visualEntitySummary: 'character',
                entityTags: ['character'],
                styleTags: [],
                confidence: 1,
                rationale: 'explicit source',
                decisions: [],
                visualStyleSummary: '',
            },
            createdAt: 1700000000000,
        })

        expect(plan.runAssignments).toHaveLength(1)
        expect(plan.runAssignments[0]).toMatchObject({
            assetId: 'asset-character-sheet',
            generationRequestId: 'request-character',
            reasoningRunId: 'capability-run-1',
            mediaRunId: 'capability-run-1:image:0',
            parentMediaNodeId: 'source-character',
            branchLineNodeId: 'branch-line-request-character-r0-image-0',
            lineageParentNodeId: 'branch-line-request-character-r0-image-0',
        })
    })

    it('uses a generated lineage source when VLM target points to an eligible generated node', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'region-root',
            promptText: 'stylize the portrait',
            promptFingerprint: 'prompt-fp',
            transcriptContext: 'context',
            candidates: [
                candidate({
                    nodeId: 'person-generated',
                    roleHints: ['generated-variant', 'branch-leaf'],
                    branchId: 'branch-person',
                    parentImageNodeId: 'parent-person',
                }),
                candidate({ nodeId: 'portrait-source', roleHints: ['base-context'], assetId: 'portrait-source' }),
            ],
        }

        const resolution: MediaBranchVlmResolution = {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'OpenAI',
            resolverModelId: 'gpt-4.1',
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'person-generated',
            parentCandidateId: 'parent-person',
            branchId: 'branch-person',
            includeGeneratedCandidateIds: [],
            referenceCandidateIds: ['person-generated'],
            sourceContextNodeIds: ['parent-person'],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: [],
            visualEntitySummary: 'portrait',
            entityTags: ['person'],
            styleTags: [],
            confidence: 0.95,
            rationale: 'selected',
            decisions: [],
            visualStyleSummary: 'paint style',
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-1',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: snapshot,
            mediaBranchResolution: resolution,
            createdAt: 1700000000000,
        })

        expect(plan.branchId).toBe('branch-person')
        expect(plan.sourceNodeId).toBe('person-generated')
        expect(plan.placementAnchorNodeId).toBe('person-generated')
        expect(plan.referenceNodeIds).toEqual(['person-generated'])
        expect(plan.branchOrigin).toBeUndefined()
        expect(plan.branchForks).toEqual([])

        // A single generation that continues an existing generated branch gets a
        // branchLine continuation marker between the source media and the output.
        expect(plan.branchLines).toHaveLength(1)
        const branchLine = plan.branchLines[0]
        expect(branchLine).toMatchObject({
            nodeId: 'branch-line-request-1-r0-image-0',
            parentBranchNodeId: 'person-generated',
            branchId: 'branch-person',
        })
        expect(branchLine.provenance).toMatchObject({
            kind: 'branch-continuation',
            promptText: 'stylize the portrait',
            referenceAssetIds: ['asset:person-generated'],
        })

        const assignment = plan.runAssignments[0]
        expect(assignment).toMatchObject({
            generationRequestId: 'request-1',
            reasoningRunId: 'request-1:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            branchId: 'branch-person',
            parentMediaNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchLineNodeId: 'branch-line-request-1-r0-image-0',
            lineageParentNodeId: 'branch-line-request-1-r0-image-0',
            referenceNodeIds: ['person-generated'],
            sourceContextNodeIds: ['parent-person'],
            operationKind: 'edit_existing',
            promptText: 'stylize the portrait',
            promptFingerprint: 'prompt-fp',
            createdAt: 1700000000000,
        })
    })

    it('continues from accepted generated media under a new server branch id', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'standalone:thread-1',
            promptText: 'fix the coat sleeves',
            promptFingerprint: 'accepted-edit-fp',
            transcriptContext: 'context',
            candidates: [candidate({
                nodeId: 'accepted-character-sheet',
                roleHints: ['generated-variant', 'branch-leaf'],
                parentMediaNodeId: 'historical-parent',
            })],
        }
        const resolution: MediaBranchVlmResolution = {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'OpenAI',
            resolverModelId: 'gpt-4.1',
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetCandidateId: 'accepted-character-sheet',
            parentCandidateId: 'accepted-character-sheet',
            branchId: 'stale-accepted-branch',
            includeGeneratedCandidateIds: ['accepted-character-sheet'],
            referenceCandidateIds: ['accepted-character-sheet'],
            sourceContextNodeIds: ['accepted-character-sheet'],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: [],
            entityTags: ['character'],
            styleTags: [],
            confidence: 1,
            rationale: 'stale resolver output',
            decisions: [],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-accepted-edit',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: snapshot,
            mediaBranchResolution: resolution,
            createdAt: 1700000000000,
        })

        expect(plan.branchId).toBe('branch-request-accepted-edit')
        expect(plan.sourceNodeId).toBe('accepted-character-sheet')
        expect(plan.placementAnchorNodeId).toBe('accepted-character-sheet')
        expect(plan.branchOrigin).toBeUndefined()
        expect(plan.branchLines).toEqual([expect.objectContaining({
            parentBranchNodeId: 'accepted-character-sheet',
            branchId: 'branch-request-accepted-edit',
        })])
        expect(plan.runAssignments[0]).toMatchObject({
            parentMediaNodeId: 'accepted-character-sheet',
            operationKind: 'edit_existing',
        })
    })

    it('uses explicit placement from a non-standalone region node when no lineage source is matched', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'region-1',
            promptText: 'create a landscape',
            promptFingerprint: 'landscape-fp',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'portrait-source', roleHints: ['base-context'], assetId: 'portrait-source' }),
                candidate({ nodeId: 'duplicate-source', roleHints: ['base-context'], assetId: 'duplicate-source' }),
            ],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-2',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: snapshot,
            createdAt: 1700000001000,
        })

        expect(plan.branchId).toBe('branch-request-2')
        expect(plan.sourceNodeId).toBe('region-1')
        expect(plan.placementAnchorNodeId).toBe('region-1')
        expect(plan.referenceNodeIds).toEqual(['portrait-source', 'duplicate-source'])
        expect(plan.sourceContextNodeIds).toEqual([])

        const assignment = plan.runAssignments[0]
        expect(assignment).toMatchObject({
            generationRequestId: 'request-2',
            reasoningRunId: 'request-2:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            branchId: 'branch-request-2',
            lineageParentNodeId: 'region-1',
            referenceNodeIds: ['portrait-source', 'duplicate-source'],
            sourceContextNodeIds: [],
            promptText: 'create a landscape',
            createdAt: 1700000001000,
        })
    })

    it('constructs branch forks and uses them as lineage parents for multi-reasoning runs', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-1',
            regionNodeId: 'standalone:region-1',
            promptText: 'paint four skies',
            promptFingerprint: 'skies-fp',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'portrait-source', roleHints: ['base-context'], assetId: 'portrait-source' }),
                candidate({ nodeId: 'landscape-source', roleHints: ['base-context'], assetId: 'landscape-source' }),
            ],
        }

        const resolution: MediaBranchVlmResolution = {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'OpenAI',
            resolverModelId: 'gpt-4.1',
            mode: 'context-only',
            operationKind: 'new_image',
            targetCandidateId: null,
            branchId: null,
            includeGeneratedCandidateIds: [],
            referenceCandidateIds: ['portrait-source', 'portrait-source', 'landscape-source'],
            sourceContextNodeIds: ['portrait-source'],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: [],
            visualEntitySummary: 'sky',
            entityTags: ['sky'],
            styleTags: ['painting'],
            confidence: 0.91,
            rationale: 'all context',
            decisions: [],
            visualStyleSummary: 'painterly',
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-3',
            reasoningModelIds: [
                'Anthropic:claude-sonnet-4-6',
                'Anthropic:claude-opus-4-1',
            ],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: snapshot,
            mediaBranchResolution: resolution,
            createdAt: 1700000002000,
        })

        expect(plan.branchForks).toHaveLength(2)
        expect(plan.branchOrigin).toBeUndefined()
        const forkIds = plan.branchForks.map((fork) => fork.nodeId)
        expect(forkIds).toEqual([
            'branch-fork-request-3-reasoning-0',
            'branch-fork-request-3-reasoning-1',
        ])
        expect(plan.branchForks.every((fork) => fork.parentBranchNodeId === undefined)).toBe(true)
        expect(plan.branchForks[0]).toMatchObject({
            provenance: {
                kind: 'reasoning-run',
                reasoningRunId: 'request-3:reasoning:0',
                reasoningIndex: 0,
            },
        })
        expect(plan.branchForks[1]).toMatchObject({
            provenance: {
                kind: 'reasoning-run',
                reasoningRunId: 'request-3:reasoning:1',
                reasoningIndex: 1,
            },
        })

        expect(plan.runAssignments).toHaveLength(2)
        expect(plan.runAssignments[0]).toMatchObject({
            branchForkNodeId: 'branch-fork-request-3-reasoning-0',
            lineageParentNodeId: 'branch-fork-request-3-reasoning-0',
            reasoningRunId: 'request-3:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            mediaIndex: 0,
            createdAt: 1700000002000,
            referenceNodeIds: ['portrait-source', 'landscape-source'],
        })
        expect(plan.runAssignments[1]).toMatchObject({
            branchForkNodeId: 'branch-fork-request-3-reasoning-1',
            lineageParentNodeId: 'branch-fork-request-3-reasoning-1',
            reasoningRunId: 'request-3:reasoning:1',
            reasoningModelId: 'Anthropic:claude-opus-4-1',
            reasoningIndex: 1,
            mediaIndex: 0,
            createdAt: 1700000002001,
            referenceNodeIds: ['portrait-source', 'landscape-source'],
        })

        const forkNodeIds = plan.branchForks.map((fork) => fork.nodeId)
        expect(forkNodeIds.every((forkNodeId) => plan.runAssignments.some((assignment) => assignment.branchForkNodeId === forkNodeId))).toBe(true)
    })

    it('deduplicates candidate/reference nodes and records explicit reference provenance', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-2',
            regionNodeId: 'standalone:region-2',
            promptText: 'compose a poster',
            promptFingerprint: 'poster-fp',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'candidate-1', roleHints: ['base-context'], assetId: 'candidate-1' }),
                candidate({ nodeId: 'candidate-2', roleHints: ['base-context'], assetId: 'candidate-2' }),
                candidate({ nodeId: 'candidate-1', roleHints: ['base-context'], assetId: 'candidate-1' }),
            ],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-4',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6', 'Anthropic:claude-opus-4-1'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: snapshot,
            mediaBranchResolution: {
                ...(resolutionForCandidate(snapshot) as any),
            },
            workspaceContextSnapshot: {
                conversationAssetId: 'thread-2',
                workspaceId: 'workspace-1',
                nodes: [
                    { nodeId: 'chip-1', isExplicitChip: true },
                    { nodeId: 'chip-1', isExplicitChip: true },
                    { nodeId: 'chip-2', isExplicitChip: false },
                    { nodeId: 'chip-3', isExplicitChip: true },
                ],
            } as any,
            createdAt: 1700000003000,
        })

        expect(plan.referenceNodeIds).toEqual(['candidate-1', 'candidate-2'])
        expect(plan.referenceAssetIds).toEqual(['candidate-1', 'candidate-2'])
        expect(plan.branchOrigin).toBeUndefined()
        expect(plan.branchForks[0]?.provenance.providedReferenceNodeIds).toEqual(['chip-1', 'chip-3'])
        expect(plan.branchForks[0]?.provenance.referenceNodeIds).toEqual(['candidate-1', 'candidate-2'])
        expect(plan.branchForks[0]?.provenance.referenceAssetIds).toEqual(['candidate-1', 'candidate-2'])
        expect(plan.branchForks).toHaveLength(2)
        expect(plan.branchForks.every((fork) => fork.parentBranchNodeId === undefined)).toBe(true)
        expect(plan.runAssignments[1]).toMatchObject({
            lineageParentNodeId: plan.branchForks[1]?.nodeId,
            createdAt: 1700000003001,
            referenceNodeIds: ['candidate-1', 'candidate-2'],
            sourceContextNodeIds: ['chip-1', 'chip-3'],
        })
    })

    it('forks per media run when a single reasoning model fans out to multiple image models', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-5',
            regionNodeId: 'standalone:region-5',
            promptText: 'two angry pigs',
            promptFingerprint: 'pigs-fp',
            transcriptContext: 'context',
            candidates: [],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-5',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1-mini', 'Google:gemini-2.5-flash-image'],
            mediaBranchCandidateSnapshot: snapshot,
            createdAt: 1700000005000,
        })

        // Two image models under one reasoning model = two generations -> a split,
        // so each generation gets its own branchFork flat under the branch origin.
        expect(plan.branchLines).toEqual([])
        expect(plan.branchForks).toHaveLength(1)
        expect(plan.branchOrigin).toBeUndefined()
        expect(plan.branchForks.map((fork) => fork.nodeId)).toEqual([
            'branch-fork-request-5-reasoning-0',
        ])
        expect(plan.branchForks.every((fork) => fork.parentBranchNodeId === undefined)).toBe(true)

        expect(plan.runAssignments).toHaveLength(2)
        expect(plan.runAssignments[0]).toMatchObject({
            mediaRunId: 'request-5:reasoning:0:image:0',
            mediaModelId: 'OpenAI:gpt-image-1-mini',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 0,
            branchForkNodeId: 'branch-fork-request-5-reasoning-0',
            lineageParentNodeId: 'branch-fork-request-5-reasoning-0',
        })
        expect(plan.runAssignments[1]).toMatchObject({
            mediaRunId: 'request-5:reasoning:0:image:1',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 1,
            branchForkNodeId: 'branch-fork-request-5-reasoning-0',
        })
    })

    it('falls back placement anchor to the first reference node for standalone regions without lineage source', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'thread-6',
            regionNodeId: 'standalone:region-6',
            promptText: 'a tiny portrait',
            promptFingerprint: 'portrait-fp',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'reference-a', roleHints: ['base-context'], assetId: 'reference-a' }),
                candidate({ nodeId: 'reference-b', roleHints: ['base-context'], assetId: 'reference-b' }),
            ],
        }

        const resolution: MediaBranchVlmResolution = {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'OpenAI',
            resolverModelId: 'gpt-4.1',
            mode: 'context-only',
            operationKind: 'new_image',
            targetCandidateId: null,
            branchId: null,
            includeGeneratedCandidateIds: [],
            referenceCandidateIds: ['reference-b', 'reference-a'],
            sourceContextNodeIds: [],
            styleReferenceCandidateIds: [],
            excludedCandidateIds: [],
            visualEntitySummary: 'portrait',
            visualStyleSummary: 'minimal style',
            entityTags: ['portrait'],
            styleTags: ['minimal'],
            confidence: 0.88,
            rationale: 'context references',
            decisions: [],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-6',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            mediaBranchCandidateSnapshot: snapshot,
            mediaBranchResolution: resolution,
            createdAt: 1700000006000,
        })

        expect(plan.sourceNodeId).toBeUndefined()
        expect(plan.placementAnchorNodeId).toBe('reference-b')
        expect(plan.referenceNodeIds).toEqual(['reference-b', 'reference-a'])
        expect(plan.branchOrigin?.provenance.referenceAssetIds).toEqual(['reference-b', 'reference-a'])
        expect(plan.runAssignments).toHaveLength(1)
        expect(plan.runAssignments[0]?.lineageParentNodeId).toBe(plan.branchOrigin?.nodeId)
    })

    it('declares the preserved API lineage target for existing-prompt regeneration without creating temporary markers', () => {
        const plan = planner.buildPlan({
            generationRequestId: 'request-replay-1',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1', 'Google:gemini-2.5-flash-image'],
            mediaBranchResolution: {
                resolverKind: 'structured-vlm',
                resolverVersion: 'image-branch-vlm-v1',
                resolverModelProvider: 'OpenAI',
                resolverModelId: 'gpt-4.1',
                mode: 'edit-active-branch',
                operationKind: 'edit_existing',
                targetCandidateId: 'resolver-selected-media',
                parentCandidateId: 'resolver-selected-parent',
                branchId: 'resolver-selected-branch',
                includeGeneratedCandidateIds: [],
                referenceCandidateIds: ['resolver-selected-media'],
                sourceContextNodeIds: [],
                styleReferenceCandidateIds: [],
                excludedCandidateIds: [],
                visualEntitySummary: 'ignored topology candidate',
                entityTags: [],
                styleTags: [],
                confidence: 1,
                rationale: 'irrelevant to replay parentage',
                decisions: [],
                visualStyleSummary: '',
            },
            regenerationTarget: {
                branchId: 'branch-preserved',
                lineageParentNodeId: 'branch-fork-preserved',
                lineageParentType: 'branchFork',
            },
            createdAt: 1700000007000,
        })

        expect(plan).toMatchObject({
            branchId: 'branch-preserved',
            regenerationTarget: {
                branchId: 'branch-preserved',
                lineageParentNodeId: 'branch-fork-preserved',
                lineageParentType: 'branchFork',
            },
            branchForks: [],
            branchLines: [],
        })
        expect(plan.branchOrigin).toBeUndefined()
        expect(plan.runAssignments).toHaveLength(2)
        expect(plan.runAssignments).toEqual(expect.arrayContaining([
            expect.objectContaining({
                branchId: 'branch-preserved',
                branchForkNodeId: 'branch-fork-preserved',
                lineageParentNodeId: 'branch-fork-preserved',
            }),
        ]))
    })

    it('records Asset-only references without inventing canvas lineage or placement anchors', () => {
        const snapshot: MediaBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            conversationAssetId: 'conversation-asset-only',
            regionNodeId: 'standalone:conversation-asset-only',
            promptText: 'use the library portrait',
            promptFingerprint: 'asset-only-fp',
            transcriptContext: '',
            candidates: [{
                candidateId: 'asset:portrait-library',
                assetId: 'portrait-library',
                imageUrl: 'nats-obj://assets/portrait-library',
                roleHints: ['base-context'],
                ancestorNodeIds: [],
                sourceContextNodeIds: [],
            }],
        }
        const plan = planner.buildPlan({
            generationRequestId: 'request-asset-only',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1'],
            referenceAssetIds: ['document-library'],
            mediaBranchCandidateSnapshot: snapshot,
            mediaBranchResolution: {
                resolverKind: 'structured-vlm',
                resolverVersion: 'image-branch-vlm-v1',
                resolverModelProvider: 'OpenAI',
                resolverModelId: 'gpt-4.1',
                mode: 'context-only',
                operationKind: 'new_image',
                targetCandidateId: null,
                branchId: 'branch-asset-only',
                includeGeneratedCandidateIds: [],
                referenceCandidateIds: ['asset:portrait-library'],
                sourceContextNodeIds: [],
                styleReferenceCandidateIds: [],
                excludedCandidateIds: [],
                entityTags: [],
                styleTags: [],
                confidence: 1,
                rationale: 'authorized library reference',
                decisions: [],
            },
            createdAt: 1700000008000,
        })

        expect(plan.referenceAssetIds).toEqual(['document-library', 'portrait-library'])
        expect(plan.referenceNodeIds).toEqual([])
        expect(plan.sourceNodeId).toBeUndefined()
        expect(plan.placementAnchorNodeId).toBeUndefined()
        expect(plan.runAssignments[0]).toMatchObject({
            referenceAssetIds: ['document-library', 'portrait-library'],
            referenceNodeIds: [],
        })
        expect(plan.branchOrigin?.provenance.referenceAssetIds).toEqual([
            'document-library',
            'portrait-library',
        ])
        expect(plan.runAssignments[0]?.parentMediaNodeId).toBeUndefined()
    })
})

const resolutionForCandidate = (snapshot: MediaBranchCandidateSnapshot) => {
    const firstCandidate = snapshot.candidates?.[0]
    return {
        resolverKind: 'structured-vlm',
        resolverVersion: 'image-branch-vlm-v1',
        resolverModelProvider: 'OpenAI',
        resolverModelId: 'gpt-4.1',
        mode: 'context-only',
        operationKind: 'new_image',
        targetCandidateId: firstCandidate?.candidateId ?? null,
        branchId: firstCandidate?.branchId ?? null,
        includeGeneratedCandidateIds: [],
        referenceCandidateIds: ['candidate-1', 'candidate-1', 'candidate-2'],
        sourceContextNodeIds: ['chip-1', 'chip-3'],
        styleReferenceCandidateIds: [],
        excludedCandidateIds: [],
        visualEntitySummary: 'poster',
        entityTags: ['poster'],
        styleTags: ['graphic'],
        confidence: 0.9,
        rationale: 'context references',
        decisions: [],
        visualStyleSummary: 'bold typography',
    }
}
