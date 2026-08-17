'use strict'

import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    MediaBranchLineagePlan,
} from '@lixpi/constants'
import { describe, expect, it } from 'vitest'
import {
    getSupersededPreflightNodeIdsForPlannedOwner,
    hasCompletePlannedBranchMarkerGeometry,
    resolveBranchMarkerRenderOwnership,
    resolvePreflightBranchMarkerScreenOwnership,
} from './branchMarkerRenderOwnership.ts'

type BranchMarkerNode = BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode

function makePreflight(nodeId: string, threadId: string, reasoningIndex = 0): BranchLineCanvasNode {
    return {
        nodeId,
        type: 'branchLine',
        branchId: `pending-${threadId}-${reasoningIndex}`,
        generationRequestId: threadId,
        conversationAssetId: threadId,
        reasoningIndex,
        pendingState: {
            phase: 'preflight',
            promptText: 'create a character',
            reasoningModelIds: ['Anthropic:claude-haiku-4-5-20251001'],
            reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
            reasoningIndex,
            imageModelIds: ['Stability:sd3.5-large'],
            videoModelIds: [],
        },
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 30 },
        temporary: true,
    }
}

function makePlannedOrigin(nodeId: string, threadId: string): BranchOriginCanvasNode {
    return {
        nodeId,
        type: 'branchOrigin',
        branchId: 'branch-1',
        generationRequestId: 'request-1',
        conversationAssetId: threadId,
        position: { x: 200, y: 0 },
        dimensions: { width: 100, height: 30 },
        temporary: true,
    }
}

function makePlannedFork(nodeId: string, threadId: string, reasoningIndex: number): BranchForkCanvasNode {
    return {
        nodeId,
        type: 'branchFork',
        branchId: 'branch-1',
        generationRequestId: 'request-1',
        conversationAssetId: threadId,
        reasoningIndex,
        reasoningRunId: `reasoning-${reasoningIndex}`,
        reasoningModelId: reasoningIndex === 0
            ? 'Anthropic:claude-haiku-4-5-20251001'
            : 'OpenAI:gpt-5-mini',
        position: { x: 200, y: reasoningIndex * 100 },
        dimensions: { width: 100, height: 30 },
        temporary: true,
    }
}

function makeLineagePlan(): MediaBranchLineagePlan {
    return {
        planVersion: 'media-branch-lineage-v1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        promptText: 'create a character',
        referenceAssetIds: [],
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        branchOrigin: {
            nodeId: 'planned-origin',
            generationRequestId: 'request-1',
            branchId: 'branch-1',
            provenance: {
                kind: 'branch-root-fork-decision',
                promptText: 'create a character',
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                forked: false,
                forkCount: 0,
            },
        },
        branchForks: [],
        branchLines: [],
        runAssignments: [],
        createdAt: 1,
    }
}

describe('planned branch marker geometry readiness', () => {
    it('accepts the complete matching planned marker set', () => {
        const plannedOrigin = makePlannedOrigin('planned-origin', 'thread-1')

        expect(hasCompletePlannedBranchMarkerGeometry(
            [plannedOrigin],
            makeLineagePlan(),
        )).toBe(true)
    })

    it('rejects a screen-fixed preflight marker using the planned node identity', () => {
        const preflight = makePreflight('planned-origin', 'thread-1')

        expect(hasCompletePlannedBranchMarkerGeometry(
            [preflight],
            makeLineagePlan(),
        )).toBe(false)
    })

    it('rejects incomplete or unrelated planned marker geometry', () => {
        const lineagePlan = makeLineagePlan()
        lineagePlan.branchForks.push({
            nodeId: 'planned-fork',
            generationRequestId: 'request-1',
            branchId: 'branch-1',
            reasoningRunId: 'reasoning-0',
            reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
            reasoningIndex: 0,
            provenance: {
                kind: 'reasoning-run',
                promptText: 'create a character',
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                reasoningRunId: 'reasoning-0',
                reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
                reasoningIndex: 0,
            },
        })
        const plannedOrigin = makePlannedOrigin('planned-origin', 'thread-1')
        const unrelatedFork = makePlannedFork('other-fork', 'thread-1', 0)

        expect(hasCompletePlannedBranchMarkerGeometry(
            [plannedOrigin, unrelatedFork],
            lineagePlan,
        )).toBe(false)
    })
})

describe('branch marker structural render ownership', () => {
    it('renders only the preflight marker before its planned media starts', () => {
        const preflight = makePreflight('preflight-1', 'thread-1')
        const planned = makePlannedOrigin('planned-1', 'thread-1')

        const ownership = resolveBranchMarkerRenderOwnership([preflight, planned], new Set())

        expect([...ownership.suppressedNodeIds]).toEqual(['planned-1'])
        expect(ownership.visibleOwnerBySuppressedNodeId.get('planned-1')).toBe('preflight-1')
    })

    it('renders only the planned marker after its media placeholder starts', () => {
        const preflight = makePreflight('preflight-1', 'thread-1')
        const planned = makePlannedOrigin('planned-1', 'thread-1')

        const ownership = resolveBranchMarkerRenderOwnership(
            [preflight, planned],
            new Set(['planned-1']),
        )

        expect([...ownership.suppressedNodeIds]).toEqual(['preflight-1'])
        expect(ownership.visibleOwnerBySuppressedNodeId.get('preflight-1')).toBe('planned-1')
    })

    it('allows only one visible owner when duplicate preflight nodes race the same planned run', () => {
        const firstPreflight = makePreflight('preflight-1', 'thread-1')
        const duplicatePreflight = makePreflight('preflight-duplicate', 'thread-1')
        const planned = makePlannedOrigin('planned-1', 'thread-1')

        const beforeStart = resolveBranchMarkerRenderOwnership(
            [firstPreflight, duplicatePreflight, planned],
            new Set(),
        )
        expect([...beforeStart.suppressedNodeIds].sort()).toEqual([
            'planned-1',
            'preflight-duplicate',
        ])

        const afterStart = resolveBranchMarkerRenderOwnership(
            [firstPreflight, duplicatePreflight, planned],
            new Set([planned.nodeId]),
        )
        expect([...afterStart.suppressedNodeIds].sort()).toEqual([
            'preflight-1',
            'preflight-duplicate',
        ])
        expect(getSupersededPreflightNodeIdsForPlannedOwner(
            [firstPreflight, duplicatePreflight, planned],
            planned,
        ).sort()).toEqual([
            'preflight-1',
            'preflight-duplicate',
        ])
    })

    it('allows only one visible preflight owner before the lineage plan arrives', () => {
        const firstPreflight = makePreflight('preflight-1', 'thread-1')
        const duplicatePreflight = makePreflight('preflight-duplicate', 'thread-1')

        const ownership = resolveBranchMarkerRenderOwnership(
            [firstPreflight, duplicatePreflight],
            new Set(),
        )

        expect([...ownership.suppressedNodeIds]).toEqual(['preflight-duplicate'])
        expect(ownership.visibleOwnerBySuppressedNodeId.get('preflight-duplicate')).toBe('preflight-1')
    })

    it('matches multi-model markers by reasoning identity without suppressing siblings', () => {
        const preflightZero = makePreflight('preflight-0', 'thread-1', 0)
        const preflightOne = makePreflight('preflight-1', 'thread-1', 1)
        preflightOne.pendingState!.reasoningModelIds = ['OpenAI:gpt-5-mini']
        preflightOne.pendingState!.reasoningModelId = 'OpenAI:gpt-5-mini'
        const plannedZero = makePlannedFork('planned-0', 'thread-1', 0)
        const plannedOne = makePlannedFork('planned-1', 'thread-1', 1)

        const ownership = resolveBranchMarkerRenderOwnership(
            [preflightZero, preflightOne, plannedZero, plannedOne],
            new Set(['planned-0']),
        )

        expect([...ownership.suppressedNodeIds].sort()).toEqual(['planned-1', 'preflight-0'])
        expect(ownership.visibleOwnerBySuppressedNodeId.get('preflight-0')).toBe('planned-0')
        expect(ownership.visibleOwnerBySuppressedNodeId.get('planned-1')).toBe('preflight-1')
    })

    it('does not combine unrelated conversation markers', () => {
        const nodes: BranchMarkerNode[] = [
            makePreflight('preflight-1', 'thread-1'),
            makePlannedOrigin('planned-2', 'thread-2'),
        ]

        const ownership = resolveBranchMarkerRenderOwnership(nodes, new Set(['planned-2']))

        expect(ownership.suppressedNodeIds.size).toBe(0)
    })
})

describe('branch marker screen-fixed ownership', () => {
    it('does not reserve composer stack space for a superseded preflight marker from an older thread', () => {
        const stalePreflight = makePreflight('stale-preflight', 'old-thread')
        const startedPlanned = makePlannedOrigin('started-planned', 'old-thread')
        const currentPreflight = makePreflight('current-preflight', 'current-thread')

        const ownership = resolvePreflightBranchMarkerScreenOwnership(
            [stalePreflight, startedPlanned, currentPreflight],
            new Set([startedPlanned.nodeId]),
        )

        expect(ownership.visiblePreflightNodes.map(node => node.nodeId)).toEqual([
            currentPreflight.nodeId,
        ])
        expect([...ownership.supersededPreflightNodeIds]).toEqual([
            stalePreflight.nodeId,
        ])
    })
})
