'use strict'

import { describe, expect, it } from 'vitest'
import type {
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    CanvasState,
} from '@lixpi/constants'

import {
    getSupersededBranchMarkerNodeIdsForAuthoritativePlan,
    removePreflightBranchMarkersForThread,
} from './branchMarkerSettlement.ts'

function makePreflightMarker(nodeId: string, threadId: string): BranchLineCanvasNode {
    return {
        nodeId,
        type: 'branchLine',
        branchId: `pending-${nodeId}`,
        generationRequestId: threadId,
        conversationAssetId: threadId,
        reasoningRunId: `reasoning-${nodeId}`,
        reasoningModelId: 'Anthropic:claude-haiku-4-5' as any,
        reasoningIndex: 0,
        pendingState: {
            phase: 'preflight',
            promptText: 'create a character',
            reasoningModelIds: [],
            imageModelIds: [],
            videoModelIds: [],
        },
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 50 },
        temporary: true,
    }
}

function makePlannedMarker(nodeId: string, threadId: string): BranchOriginCanvasNode {
    return {
        nodeId,
        type: 'branchOrigin',
        branchId: 'branch-1',
        generationRequestId: 'media-request-1',
        conversationAssetId: threadId,
        position: { x: 300, y: 0 },
        dimensions: { width: 200, height: 50 },
        temporary: true,
    }
}

describe('removePreflightBranchMarkersForThread', () => {
    it('removes a late composer-side preflight duplicate without removing the API marker', () => {
        const threadId = 'thread-1'
        const preflight = makePreflightMarker('pending-thread-1', threadId)
        const planned = makePlannedMarker('branch-origin-media-request-1', threadId)
        const unrelated = makePreflightMarker('pending-thread-2', 'thread-2')
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [preflight, planned, unrelated] as CanvasNode[],
            edges: [
                { edgeId: 'stale-edge', sourceNodeId: preflight.nodeId, targetNodeId: planned.nodeId },
                { edgeId: 'planned-edge', sourceNodeId: planned.nodeId, targetNodeId: unrelated.nodeId },
            ],
        }

        const result = removePreflightBranchMarkersForThread(state, threadId)

        expect(result.removedNodeIds).toEqual([preflight.nodeId])
        expect(result.state.nodes.map(node => node.nodeId)).toEqual([planned.nodeId, unrelated.nodeId])
        expect(result.state.edges.map(edge => edge.edgeId)).toEqual(['planned-edge'])
    })

    it('returns the original state when the thread has no preflight marker', () => {
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [makePlannedMarker('planned', 'thread-1')],
            edges: [],
        }

        const result = removePreflightBranchMarkersForThread(state, 'thread-1')

        expect(result.state).toBe(state)
        expect(result.removedNodeIds).toEqual([])
    })
})

describe('getSupersededBranchMarkerNodeIdsForAuthoritativePlan', () => {
    it('retires both the provisional plan marker and its initial preflight owner', () => {
        const threadId = 'thread-1'
        const requestId = 'media-request-1'
        const preflight = makePreflightMarker('pending-thread-1', threadId)
        const provisional = {
            ...makePlannedMarker('provisional-origin', threadId),
            generationRequestId: requestId,
            pendingState: {
                ...preflight.pendingState!,
                phase: 'planned' as const,
            },
        }
        const authoritative = {
            ...makePlannedMarker('authoritative-line', threadId),
            type: 'branchLine' as const,
            generationRequestId: requestId,
            parentBranchNodeId: 'source-media',
        }
        const historical = makePlannedMarker('historical-marker', 'thread-2')
        historical.generationRequestId = 'older-request'
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [preflight, provisional, authoritative, historical] as CanvasNode[],
            edges: [],
        }

        expect(getSupersededBranchMarkerNodeIdsForAuthoritativePlan({
            state,
            plannedMarkers: [historical, authoritative],
            generationRequestId: requestId,
        })).toEqual([preflight.nodeId, provisional.nodeId])
    })

    it('does not retire a concurrent request marker in the same conversation', () => {
        const authoritative = makePlannedMarker('authoritative-origin', 'thread-1')
        const concurrent = makePlannedMarker('concurrent-origin', 'thread-1')
        concurrent.generationRequestId = 'media-request-2'
        const state: CanvasState = {
            viewport: { x: 0, y: 0, zoom: 1 },
            nodes: [authoritative, concurrent],
            edges: [],
        }

        expect(getSupersededBranchMarkerNodeIdsForAuthoritativePlan({
            state,
            plannedMarkers: [authoritative],
            generationRequestId: authoritative.generationRequestId,
        })).toEqual([])
    })
})
