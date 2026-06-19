'use strict'

import { describe, expect, it } from 'vitest'

import {
    type ImageBranchCandidateImage,
    type ImageBranchCandidateSnapshot,
    type ImageBranchVlmResolution,
} from '@lixpi/constants'

import { MediaBranchLineagePlanner } from './media-branch-lineage-planner.ts'

const planner = new MediaBranchLineagePlanner()

const candidate = (overrides: Partial<ImageBranchCandidateImage>): ImageBranchCandidateImage => ({
    nodeId: 'node-1',
    fileId: 'file-1',
    workspaceId: 'workspace-1',
    imageUrl: 'nats://workspace-workspace-1-files/file-1',
    roleHints: [],
    ancestorNodeIds: ['node-1'],
    sourceContextNodeIds: ['node-1'],
    visualEntitySummary: 'base image',
    ...overrides,
})

describe('MediaBranchLineagePlanner', () => {
    it('uses a generated lineage source when VLM target points to an eligible generated node', () => {
        const snapshot: ImageBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-1',
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
                candidate({ nodeId: 'portrait-source', roleHints: ['base-context'], fileId: 'portrait-source' }),
            ],
        }

        const resolution: ImageBranchVlmResolution = {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'OpenAI',
            resolverModelId: 'gpt-4.1',
            mode: 'edit-active-branch',
            operationKind: 'edit_existing',
            targetImageNodeId: 'person-generated',
            parentImageNodeId: 'parent-person',
            branchId: 'branch-person',
            includeGeneratedNodeIds: [],
            referenceImageNodeIds: ['person-generated'],
            sourceContextNodeIds: ['parent-person'],
            styleReferenceNodeIds: [],
            excludedNodeIds: [],
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
            imageBranchCandidateSnapshot: snapshot,
            imageBranchResolution: resolution,
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
            nodeId: 'branch-line-request-1-reasoning-0',
            parentBranchNodeId: 'person-generated',
            branchId: 'branch-person',
        })
        expect(branchLine.provenance).toMatchObject({
            kind: 'branch-continuation',
            promptText: 'stylize the portrait',
        })

        const assignment = plan.runAssignments[0]
        expect(assignment).toMatchObject({
            generationRequestId: 'request-1',
            reasoningRunId: 'request-1:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            branchId: 'branch-person',
            parentMediaNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            branchLineNodeId: 'branch-line-request-1-reasoning-0',
            lineageParentNodeId: 'branch-line-request-1-reasoning-0',
            referenceNodeIds: ['person-generated'],
            sourceContextNodeIds: ['parent-person'],
            operationKind: 'edit_existing',
            promptText: 'stylize the portrait',
            promptFingerprint: 'prompt-fp',
            createdAt: 1700000000000,
        })
    })

    it('uses explicit placement from a non-standalone region node when no lineage source is matched', () => {
        const snapshot: ImageBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-1',
            regionNodeId: 'region-1',
            promptText: 'create a landscape',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'portrait-source', roleHints: ['base-context'], fileId: 'portrait-source' }),
                candidate({ nodeId: 'duplicate-source', roleHints: ['base-context'], fileId: 'duplicate-source' }),
            ],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-2',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageBranchCandidateSnapshot: snapshot,
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
        const snapshot: ImageBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-1',
            regionNodeId: 'standalone:region-1',
            promptText: 'paint four skies',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'portrait-source', roleHints: ['base-context'], fileId: 'portrait-source' }),
                candidate({ nodeId: 'landscape-source', roleHints: ['base-context'], fileId: 'landscape-source' }),
            ],
        }

        const resolution: ImageBranchVlmResolution = {
            resolverKind: 'structured-vlm',
            resolverVersion: 'image-branch-vlm-v1',
            resolverModelProvider: 'OpenAI',
            resolverModelId: 'gpt-4.1',
            mode: 'context-only',
            operationKind: 'new_image',
            targetImageNodeId: null,
            branchId: null,
            includeGeneratedNodeIds: [],
            referenceImageNodeIds: ['portrait-source', 'portrait-source', 'landscape-source'],
            sourceContextNodeIds: ['portrait-source'],
            styleReferenceNodeIds: [],
            excludedNodeIds: [],
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
            imageBranchCandidateSnapshot: snapshot,
            imageBranchResolution: resolution,
            createdAt: 1700000002000,
        })

        expect(plan.branchForks).toHaveLength(2)
        expect(plan.branchOrigin).toBeDefined()
        const forkIds = plan.branchForks.map((fork) => fork.nodeId)
        expect(forkIds).toEqual([
            'branch-fork-request-3-reasoning-0',
            'branch-fork-request-3-reasoning-1',
        ])

        expect(plan.runAssignments).toHaveLength(2)
        expect(plan.runAssignments[0]).toMatchObject({
            branchForkNodeId: 'branch-fork-request-3-reasoning-0',
            lineageParentNodeId: 'branch-fork-request-3-reasoning-0',
            reasoningRunId: 'request-3:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            createdAt: 1700000002000,
            referenceNodeIds: ['portrait-source', 'landscape-source'],
        })
        expect(plan.runAssignments[1]).toMatchObject({
            branchForkNodeId: 'branch-fork-request-3-reasoning-1',
            lineageParentNodeId: 'branch-fork-request-3-reasoning-1',
            reasoningRunId: 'request-3:reasoning:1',
            reasoningModelId: 'Anthropic:claude-opus-4-1',
            createdAt: 1700000002001,
            referenceNodeIds: ['portrait-source', 'landscape-source'],
        })

        const forkNodeIds = plan.branchForks.map((fork) => fork.nodeId)
        expect(forkNodeIds.every((forkNodeId) => plan.runAssignments.some((assignment) => assignment.branchForkNodeId === forkNodeId))).toBe(true)
    })

    it('deduplicates candidate/reference nodes and records explicit reference provenance', () => {
        const snapshot: ImageBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-2',
            regionNodeId: 'standalone:region-2',
            promptText: 'compose a poster',
            transcriptContext: 'context',
            candidates: [
                candidate({ nodeId: 'candidate-1', roleHints: ['base-context'], fileId: 'candidate-1' }),
                candidate({ nodeId: 'candidate-2', roleHints: ['base-context'], fileId: 'candidate-2' }),
                candidate({ nodeId: 'candidate-1', roleHints: ['base-context'], fileId: 'candidate-1' }),
            ],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-4',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6', 'Anthropic:claude-opus-4-1'],
            imageBranchCandidateSnapshot: snapshot,
            imageBranchResolution: {
                ...(resolutionForCandidate(snapshot) as any),
            },
            workspaceContextSnapshot: {
                threadId: 'thread-2',
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
        expect(plan.branchOrigin?.provenance.providedReferenceNodeIds).toEqual(['chip-1', 'chip-3'])
        expect(plan.branchOrigin?.provenance.referenceNodeIds).toEqual(['candidate-1', 'candidate-2'])
        expect(plan.branchForks).toHaveLength(2)
        expect(plan.runAssignments[1]).toMatchObject({
            lineageParentNodeId: plan.branchForks[1]?.nodeId,
            createdAt: 1700000003001,
            referenceNodeIds: ['candidate-1', 'candidate-2'],
            sourceContextNodeIds: ['chip-1', 'chip-3'],
        })
    })

    it('forks per media run when a single reasoning model fans out to multiple image models', () => {
        const snapshot: ImageBranchCandidateSnapshot = {
            resolverVersion: 'image-branch-vlm-v1',
            threadId: 'thread-5',
            regionNodeId: 'standalone:region-5',
            promptText: 'two angry pigs',
            transcriptContext: 'context',
            candidates: [],
        }

        const plan = planner.buildPlan({
            generationRequestId: 'request-5',
            reasoningModelIds: ['Anthropic:claude-sonnet-4-6'],
            imageModelIds: ['OpenAI:gpt-image-1-mini', 'Google:gemini-2.5-flash-image'],
            imageBranchCandidateSnapshot: snapshot,
            createdAt: 1700000005000,
        })

        // Two image models under one reasoning model = two generations -> a split,
        // so each generation gets its own branchFork flat under the branch origin.
        expect(plan.branchLines).toEqual([])
        expect(plan.branchForks).toHaveLength(2)
        expect(plan.branchOrigin).toBeDefined()
        expect(plan.branchForks.map((fork) => fork.nodeId)).toEqual([
            'branch-fork-request-5-r0-image-0',
            'branch-fork-request-5-r0-image-1',
        ])
        expect(plan.branchForks.every((fork) => fork.parentBranchNodeId === plan.branchOrigin?.nodeId)).toBe(true)

        expect(plan.runAssignments).toHaveLength(2)
        expect(plan.runAssignments[0]).toMatchObject({
            mediaRunId: 'request-5:reasoning:0:image:0',
            mediaModelId: 'OpenAI:gpt-image-1-mini',
            mediaType: 'image',
            branchForkNodeId: 'branch-fork-request-5-r0-image-0',
            lineageParentNodeId: 'branch-fork-request-5-r0-image-0',
        })
        expect(plan.runAssignments[1]).toMatchObject({
            mediaRunId: 'request-5:reasoning:0:image:1',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            branchForkNodeId: 'branch-fork-request-5-r0-image-1',
        })
    })
})

const resolutionForCandidate = (snapshot: ImageBranchCandidateSnapshot) => {
    const firstCandidate = snapshot.candidates?.[0]
    return {
        resolverKind: 'structured-vlm',
        resolverVersion: 'image-branch-vlm-v1',
        resolverModelProvider: 'OpenAI',
        resolverModelId: 'gpt-4.1',
        mode: 'context-only',
        operationKind: 'new_image',
        targetImageNodeId: firstCandidate?.nodeId,
        branchId: firstCandidate?.branchId ?? null,
        includeGeneratedNodeIds: [],
        referenceImageNodeIds: ['candidate-1', 'candidate-1', 'candidate-2'],
        sourceContextNodeIds: ['chip-1', 'chip-3'],
        styleReferenceNodeIds: [],
        excludedNodeIds: [],
        visualEntitySummary: 'poster',
        entityTags: ['poster'],
        styleTags: ['graphic'],
        confidence: 0.9,
        rationale: 'context references',
        decisions: [],
        visualStyleSummary: 'bold typography',
    }
}
