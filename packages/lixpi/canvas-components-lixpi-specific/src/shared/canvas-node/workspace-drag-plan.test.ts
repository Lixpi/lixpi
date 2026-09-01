import {
    describe,
    it,
    expect,
} from 'vitest'
import {
    type CanvasNode,
    type ImageCanvasNode,
    type DocumentCanvasNode,
} from '@lixpi/constants'

import { computeWorkspaceDragPlan } from './workspace-drag-plan.ts'

// =============================================================================
// HELPERS
// =============================================================================

function makeImage(overrides: Partial<ImageCanvasNode> & { nodeId: string }): ImageCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'image',
        fileId: overrides.fileId ?? `file-${overrides.nodeId}`,
        workspaceId: overrides.workspaceId ?? 'workspace-1',
        src: overrides.src ?? `/api/images/workspace-1/file-${overrides.nodeId}`,
        aspectRatio: overrides.aspectRatio ?? 1,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 120, height: 120 },
        ...overrides,
    }
}

function makeDocument(overrides: Partial<DocumentCanvasNode> & { nodeId: string }): DocumentCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'document',
        referenceId: overrides.referenceId ?? `doc-${overrides.nodeId}`,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 240, height: 180 },
        ...overrides,
    }
}

function plan(overrides: {
    nodes: CanvasNode[]
    primaryNodeId: string
    selectedNodeIds?: Set<string>
}) {
    return computeWorkspaceDragPlan({
        nodes: overrides.nodes,
        primaryNodeId: overrides.primaryNodeId,
        selectedNodeIds: overrides.selectedNodeIds ?? new Set<string>(),
    })
}

// =============================================================================
// ORDINARY DRAG PLANNING
// =============================================================================

describe('computeWorkspaceDragPlan — ordinary drags', () => {
    it('moves only the selected ordinary node by default', () => {
        const doc = makeDocument({ nodeId: 'doc-1' })
        const image = makeImage({ nodeId: 'image-1' })

        const result = plan({
            nodes: [doc, image],
            primaryNodeId: 'doc-1',
        })

        expect(result.draggedNodeIds).toEqual(['doc-1'])
        expect(result.allowProximityConnection).toBe(true)
        expect(result.allowCollisionResolution).toBe(true)
    })

    it('keeps ordinary selected images in selected drag sets', () => {
        const doc = makeDocument({ nodeId: 'doc-1' })
        const image = makeImage({ nodeId: 'image-1' })

        const result = plan({
            nodes: [doc, image],
            primaryNodeId: 'doc-1',
            selectedNodeIds: new Set(['doc-1', 'image-1']),
        })

        expect(result.draggedNodeIds).toEqual(['doc-1', 'image-1'])
    })
})
