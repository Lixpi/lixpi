// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasState,
    type ImageCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceMediaReplacement,
    type WorkspaceMediaReplacementPorts,
} from './workspace-media-replacement.ts'

const node: ImageCanvasNode = {
    nodeId: 'image-1',
    type: 'image',
    assetId: 'asset-old',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
}

describe('WorkspaceMediaReplacement', () => {
    it('passes downloads through the host with the canvas lifetime signal', async () => {
        const lifetime = new Lifetime()
        const download = vi.fn(async () => {})
        const owner = new WorkspaceMediaReplacement({
            host: { media: { download } },
            document,
            lifetime,
            canAct: () => true,
            reportError: vi.fn(),
        } as WorkspaceMediaReplacementPorts)

        await owner.download('asset-1', 'preview', false)

        expect(download).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'asset-1',
            rendition: 'preview',
            attachment: false,
            signal: lifetime.signal,
        }))
        lifetime.destroy()
    })

    it('uploads, detaches and reattaches a replacement in the captured scene', async () => {
        const lifetime = new Lifetime()
        let state = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState
        const commitTransient = vi.fn((next: CanvasState) => {
            state = next
        })
        const owner = new WorkspaceMediaReplacement({
            host: { media: { uploadReplacement: vi.fn(async () => ({ assetId: 'asset-new', kind: 'image' })) } },
            document,
            lifetime,
            canAct: () => true,
            getWorkspaceId: () => 'workspace-1',
            getSceneKey: () => 'scene-1',
            isCurrentScene: () => true,
            getState: () => state,
            findNode: () => node,
            detach: async request => request.canvasState,
            attach: async request => request.canvasState,
            commitTransient,
            reportError: vi.fn(),
        } as WorkspaceMediaReplacementPorts)

        owner.choose(node.nodeId)
        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        Object.defineProperty(input, 'files', { value: [new File(['pixels'], 'replacement.png', { type: 'image/png' })] })
        input.dispatchEvent(new Event('change'))
        await vi.waitFor(() => expect(commitTransient).toHaveBeenCalledTimes(2))

        expect(state.nodes).toEqual([expect.objectContaining({ nodeId: node.nodeId, assetId: 'asset-new' })])
        lifetime.destroy()
    })
})
