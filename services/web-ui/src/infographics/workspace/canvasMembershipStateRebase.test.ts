import { describe, expect, it } from 'vitest'
import type {
    BranchLineCanvasNode,
    CanvasNode,
    CanvasState,
    ImageCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

import { rebaseCanvasMembershipState } from './canvasMembershipStateRebase.ts'

function makeImage(nodeId: string): ImageCanvasNode {
    return {
        nodeId,
        type: 'image',
        fileId: `file-${nodeId}`,
        workspaceId: 'workspace-1',
        src: `/api/images/workspace-1/file-${nodeId}`,
        aspectRatio: 1,
        position: { x: 0, y: 0 },
        dimensions: { width: 120, height: 120 },
    }
}

function makeBranchLine(nodeId: string): BranchLineCanvasNode {
    return {
        nodeId,
        type: 'branchLine',
        branchId: 'branch-1',
        generationRequestId: 'request-1',
        position: { x: 0, y: 0 },
        dimensions: { width: 240, height: 72 },
        temporary: true,
    }
}

function makeEdge(sourceNodeId: string, targetNodeId: string): WorkspaceEdge {
    return {
        edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
    }
}

function makeCanvasState(nodes: CanvasNode[], edges: WorkspaceEdge[] = []): CanvasState {
    return {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes,
        edges,
    }
}

describe('canvas membership state rebase', () => {
    it('keeps a detached media node and its orphan branch marker deleted while preserving concurrent additions', () => {
        const media = makeImage('media-deleted')
        const marker = makeBranchLine('marker-orphaned')
        const survivingMedia = makeImage('media-surviving')
        const concurrentNode = makeImage('node-concurrent')
        const concurrentEdge = makeEdge(survivingMedia.nodeId, concurrentNode.nodeId)

        const result = rebaseCanvasMembershipState({
            requestedState: makeCanvasState([survivingMedia]),
            currentState: makeCanvasState(
                [media, marker, survivingMedia, concurrentNode],
                [
                    makeEdge(marker.nodeId, media.nodeId),
                    concurrentEdge,
                ],
            ),
            operation: 'detach',
            removedNodeIds: [media.nodeId, marker.nodeId],
        })

        expect(result.nodes.map((node) => node.nodeId)).toEqual([
            survivingMedia.nodeId,
            concurrentNode.nodeId,
        ])
        expect(result.edges).toEqual([concurrentEdge])
    })

    it('preserves concurrent nodes and edges during an attach rebase without duplicating requested members', () => {
        const attachedNode = makeImage('node-attached')
        const concurrentNode = makeImage('node-concurrent')
        const concurrentEdge = makeEdge(attachedNode.nodeId, concurrentNode.nodeId)

        const result = rebaseCanvasMembershipState({
            requestedState: makeCanvasState([attachedNode]),
            currentState: makeCanvasState([attachedNode, concurrentNode], [concurrentEdge]),
            operation: 'attach',
        })

        expect(result.nodes.map((node) => node.nodeId)).toEqual([
            attachedNode.nodeId,
            concurrentNode.nodeId,
        ])
        expect(result.edges).toEqual([concurrentEdge])
    })
})
