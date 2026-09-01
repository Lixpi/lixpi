import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type BranchOriginCanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import { WorkspaceBranchMarkerProjection } from './workspace-branch-marker-projection.ts'

const marker = (overrides: Partial<BranchOriginCanvasNode> = {}): BranchOriginCanvasNode => ({
    nodeId: 'marker-1',
    type: 'branchOrigin',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 0, height: 0 },
    temporary: true,
    conversationAssetId: 'thread-1',
    ...overrides,
})

describe('WorkspaceBranchMarkerProjection', () => {
    it('normalizes missing marker dimensions without changing unrelated state', () => {
        const source = marker()
        const state = { nodes: [source], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState

        const normalized = WorkspaceBranchMarkerProjection.normalizeState(state)

        expect(normalized).not.toBe(state)
        expect(normalized.nodes[0].dimensions.width).toBeGreaterThan(0)
        expect(normalized.nodes[0].dimensions.height).toBeGreaterThan(0)
    })

    it('clears live projection overrides and commits resized marker geometry', () => {
        const source = marker({ dimensions: { width: 100, height: 30 } })
        const state = { nodes: [source], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState
        const commit = vi.fn()
        const deleteProjectionOverride = vi.fn()
        const owner = new WorkspaceBranchMarkerProjection({
            getState: () => state,
            getConversationPreview: () => null,
            getPromptParts: () => [{ type: 'text', text: 'A much longer branch marker prompt that must resize the card' }],
            getPromptTraceHandles: () => [],
            getLiveOverride: () => ({ position: { x: 25, y: 30 } }),
            deleteProjectionOverride,
            projectionOverrideNodeIds: new Set([source.nodeId]),
            manuallyPositionedNodeIds: new Set(),
            syncMarker: vi.fn(),
            commit,
            syncGeometry: vi.fn(),
            syncMedia: vi.fn(),
            scheduleEdges: vi.fn(),
        })

        owner.refresh('thread-1')

        expect(deleteProjectionOverride).toHaveBeenCalledWith(source.nodeId)
        const committedState = commit.mock.calls[0]?.[0]
        const committedMarker = committedState?.nodes[0]
        expect(committedMarker?.position.x).toBe(25)
        expect(committedMarker?.position.y).toBeLessThan(30)
        expect(committedMarker?.dimensions.width).toBeGreaterThan(source.dimensions.width)
    })
})
