// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasAiChatPanelState,
    type CanvasState,
    type ImageCanvasNode,
} from '@lixpi/constants'
import {
    WorkspaceGeneratedOutputDetails,
    type WorkspaceGeneratedOutputDetailsPorts,
} from './workspace-generated-output-details.ts'

const node: ImageCanvasNode = {
    nodeId: 'image-1',
    type: 'image',
    assetId: 'asset-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
}

describe('WorkspaceGeneratedOutputDetails', () => {
    it('opens, toggles and closes a generated-output target through panel ports', () => {
        const canvasState = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } satisfies CanvasState
        let panelState = { isOpen: false, topLevelMode: 'media', contextChips: [] } as CanvasAiChatPanelState
        const renderPanel = vi.fn()
        const syncFooters = vi.fn()
        const ports = {
            document,
            history: { resolveGeneratedOutputDetailsNode: () => node },
            review: {},
            getState: () => canvasState,
            getPanelState: () => panelState,
            persistPanelState: (state: CanvasAiChatPanelState) => {
                panelState = state
            },
            renderPanel,
            syncFooters,
        } as WorkspaceGeneratedOutputDetailsPorts
        const owner = new WorkspaceGeneratedOutputDetails(ports)
        const target = { kind: 'output', nodeId: node.nodeId } as const

        owner.open(target)
        expect(panelState).toMatchObject({ isOpen: true, topLevelMode: 'aiThreads', generatedOutputDetailsTarget: target })
        expect(syncFooters).toHaveBeenCalledWith(canvasState)

        owner.open(target, { toggle: true })
        expect(panelState.generatedOutputDetailsTarget).toBeUndefined()
        expect(renderPanel).toHaveBeenCalledTimes(2)
    })

    it('delegates review actions and progress state to their owners', async () => {
        const accept = vi.fn(async () => {})
        const reject = vi.fn(async () => 'applied' as const)
        const regenerate = vi.fn(async () => {})
        const owner = new WorkspaceGeneratedOutputDetails({
            document,
            review: {
                isGeneratedOutputAccepted: () => true,
                isGeneratedOutputReviewReady: () => true,
                acceptGeneratedOutput: accept,
                rejectGeneratedOutput: reject,
                regenerateGeneratedOutputs: regenerate,
            },
            history: { getMediaGenerationTraceState: () => ({ status: 'running' }) },
        } as WorkspaceGeneratedOutputDetailsPorts)

        expect(owner.isAccepted(node)).toBe(true)
        expect(owner.isReviewReady(node)).toBe(true)
        expect(owner.isProgressActive(node)).toBe(true)
        await owner.accept('output-node', node.nodeId)
        await owner.reject('output-node', node.nodeId)
        await owner.regenerate({ scope: 'output-node', mode: 'existing-prompt', targetNodeId: node.nodeId, outputNodes: [node] })
        expect(accept).toHaveBeenCalledOnce()
        expect(reject).toHaveBeenCalledOnce()
        expect(regenerate).toHaveBeenCalledOnce()
    })
})
