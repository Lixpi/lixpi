import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import { WorkspaceCanvasVisibility } from './workspace-canvas-visibility.ts'

const operation = (overrides: Partial<OperationStatusCanvasNode> = {}): OperationStatusCanvasNode => ({
    nodeId: 'operation-1',
    type: 'operationStatus',
    operation: 'media-generation',
    status: 'in-progress',
    title: 'Generating',
    message: 'Waiting',
    generationRequestId: 'request-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
})

describe('WorkspaceCanvasVisibility', () => {
    it('starts recovery for operation nodes while hiding in-progress media operations', () => {
        const ensureOperation = vi.fn(async () => {})
        const owner = new WorkspaceCanvasVisibility({
            hasStartedMedia: () => false,
            ensureOperation,
            reportedOwnershipKeys: new Set(),
            reportUnknownType: vi.fn(),
            reportOwnership: vi.fn(),
        })
        const state = {
            nodes: [operation()],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
        } satisfies CanvasState

        expect(owner.getVisibleNodes(state)).toEqual([])
        expect(owner.shouldRenderOperation(state.nodes[0], state)).toBe(false)
        expect(ensureOperation).toHaveBeenCalledWith(state.nodes[0])
    })

    it('hides a failed media operation superseded by its ready output', () => {
        const owner = new WorkspaceCanvasVisibility({
            hasStartedMedia: () => false,
            ensureOperation: vi.fn(async () => {}),
            reportedOwnershipKeys: new Set(),
            reportUnknownType: vi.fn(),
            reportOwnership: vi.fn(),
        })
        const status = operation({
            status: 'failed',
            outputNodeId: 'image-1',
        })
        const state = {
            nodes: [status, {
                nodeId: 'image-1',
                type: 'image',
                assetId: 'asset-1',
                position: { x: 0, y: 0 },
                dimensions: { width: 100, height: 100 },
                mediaGenerationPhase: 'ready',
                generatedBy: { generationRequestId: status.generationRequestId },
            }],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
        } as CanvasState

        expect(owner.getVisibleNodes(state).map(node => node.nodeId)).toEqual(['image-1'])
    })
})
