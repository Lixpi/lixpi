'use strict'

import { describe, expect, it } from 'vitest'
import type {
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    CanvasState,
} from '@lixpi/constants'

import { removePreflightBranchMarkersForThread } from './branchMarkerSettlement.ts'

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
