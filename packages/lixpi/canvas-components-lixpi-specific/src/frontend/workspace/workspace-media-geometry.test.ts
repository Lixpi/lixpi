import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceMediaGeometry,
    type WorkspaceMediaGeometryPorts,
} from './workspace-media-geometry.ts'

const image = (overrides: Partial<ImageCanvasNode> = {}): ImageCanvasNode => ({
    nodeId: 'image-1',
    type: 'image',
    assetId: 'asset-image-1',
    aspectRatio: 1,
    position: { x: 100, y: 200 },
    dimensions: { width: 200, height: 200 },
    ...overrides,
})

const video = (overrides: Partial<VideoCanvasNode> = {}): VideoCanvasNode => ({
    nodeId: 'video-1',
    type: 'video',
    assetId: 'asset-video-1',
    aspectRatio: 1,
    position: { x: 100, y: 200 },
    dimensions: { width: 200, height: 200 },
    ...overrides,
})

const canvas = (...nodes: CanvasState['nodes']): CanvasState => ({
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
})

function setup(state: CanvasState | null, overrides: Partial<WorkspaceMediaGeometryPorts> = {}) {
    const ports: WorkspaceMediaGeometryPorts = {
        getState: () => state,
        getActiveGesture: () => ({ draggingNodeId: null, resizingNodeId: null }),
        getWorldPosition: node => node.position,
        toParentRelativePosition: worldPosition => worldPosition,
        rebalance: nodes => nodes,
        commit: vi.fn(),
        markImageFrameDecoded: vi.fn(),
        clearImageCompletion: vi.fn(),
        ...overrides,
    }
    return { owner: new WorkspaceMediaGeometry(ports), ports }
}

describe('WorkspaceMediaGeometry', () => {
    it('fits an image to its intrinsic aspect ratio around the existing center and preserves editors', () => {
        const fixture = setup(canvas(image()))

        fixture.owner.handleImageIntrinsicSize({ nodeId: 'image-1', width: 400, height: 200 })

        expect(fixture.ports.markImageFrameDecoded).toHaveBeenCalledWith('image-1')
        expect(fixture.ports.clearImageCompletion).toHaveBeenCalledWith('image-1')
        expect(fixture.ports.commit).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [expect.objectContaining({
                    nodeId: 'image-1',
                    aspectRatio: 2,
                    position: { x: 100, y: 250 },
                    dimensions: { width: 200, height: 100 },
                })],
            }),
            { preserveEditors: true },
        )
    })

    it('fits video geometry without requesting editor preservation', () => {
        const fixture = setup(canvas(video()))

        fixture.owner.handleVideoIntrinsicSize({ nodeId: 'video-1', width: 100, height: 200 })

        expect(fixture.ports.commit).toHaveBeenCalledWith(
            expect.objectContaining({
                nodes: [expect.objectContaining({
                    nodeId: 'video-1',
                    aspectRatio: 0.5,
                    position: { x: 150, y: 200 },
                    dimensions: { width: 100, height: 200 },
                })],
            }),
            { preserveEditors: false },
        )
    })

    it('does not change image geometry while a gesture owns it or when the caller preserves it', () => {
        const gestureFixture = setup(canvas(image()), {
            getActiveGesture: () => ({ draggingNodeId: 'image-1', resizingNodeId: null }),
        })
        const preservedFixture = setup(canvas(image()))

        gestureFixture.owner.handleImageIntrinsicSize({ nodeId: 'image-1', width: 400, height: 200 })
        preservedFixture.owner.handleImageIntrinsicSize({ nodeId: 'image-1', width: 400, height: 200, preserveNodeGeometry: true })

        expect(gestureFixture.ports.commit).not.toHaveBeenCalled()
        expect(preservedFixture.ports.commit).not.toHaveBeenCalled()
        expect(gestureFixture.ports.markImageFrameDecoded).toHaveBeenCalledWith('image-1')
        expect(preservedFixture.ports.markImageFrameDecoded).toHaveBeenCalledWith('image-1')
    })

    it('clears completion state for invalid or missing image measurements', () => {
        const fixture = setup(canvas(image()))

        fixture.owner.handleImageIntrinsicSize({ nodeId: 'image-1', width: 0, height: 200 })
        fixture.owner.handleImageIntrinsicSize({ nodeId: 'missing', width: 200, height: 200 })

        expect(fixture.ports.clearImageCompletion).toHaveBeenCalledWith('image-1')
        expect(fixture.ports.clearImageCompletion).toHaveBeenCalledWith('missing')
        expect(fixture.ports.markImageFrameDecoded).not.toHaveBeenCalled()
        expect(fixture.ports.commit).not.toHaveBeenCalled()
    })
})
