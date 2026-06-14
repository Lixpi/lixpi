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

        const assignment = plan.runAssignments[0]
        expect(assignment).toMatchObject({
            generationRequestId: 'request-1',
            reasoningRunId: 'request-1:reasoning:0',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            branchId: 'branch-person',
            parentMediaNodeId: 'person-generated',
            parentImageNodeId: 'person-generated',
            lineageParentNodeId: 'person-generated',
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
})
