import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasState,
} from '@lixpi/constants'
import { WorkspaceCanvasThreadState } from './workspace-canvas-thread-state.ts'
import {
    type WorkspaceCanvasConversation,
} from './workspace-canvas-surface.ts'

const state = (nodes: CanvasState['nodes'] = []): CanvasState => ({
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
})

describe('WorkspaceCanvasThreadState', () => {
    it('keys only singleton-panel threads and tracks loaded content', () => {
        const owner = new WorkspaceCanvasThreadState({
            getState: () => state(),
            merge: threads => threads,
            now: () => 10_000,
            reattachWindowMs: 1_000,
        })
        const threads = [
            { threadId: 'canvas-run', content: {} },
            { threadId: 'thread-b' },
            { threadId: 'thread-a', content: {} },
        ] as WorkspaceCanvasConversation[]

        expect(owner.getThreadsKey(threads)).toBe('thread-a:loaded,thread-b:pending')
        expect(owner.getDocumentsKey([{ documentId: 'b' }, { documentId: 'a' }] as never)).toBe('a,b')
    })

    it('detects recoverable in-progress turns and canvas projections', () => {
        const merge = vi.fn(threads => threads)
        const owner = new WorkspaceCanvasThreadState({
            getState: () =>
                state([
                    {
                        nodeId: 'image-1',
                        type: 'image',
                        assetId: 'asset-1',
                        position: { x: 0, y: 0 },
                        dimensions: { width: 1, height: 1 },
                        generatedBy: { conversationAssetId: 'canvas-run' },
                    } as CanvasState['nodes'][number],
                ]),
            merge,
            now: () => 10_000,
            reattachWindowMs: 1_000,
        })
        const thread = {
            threadId: 'canvas-run',
            updatedAt: 9_500,
            content: { type: 'doc', content: [{ type: 'aiAssistantMessage', attrs: { isStreaming: true } }] },
        } as WorkspaceCanvasConversation

        expect(owner.hasInProgressContent(thread)).toBe(true)
        expect(owner.hasRecoverableTurn(thread)).toBe(true)
        expect(owner.hasCanvasProjection(thread.threadId)).toBe(true)
        expect(owner.isRecentUpdate(thread)).toBe(true)
        expect(owner.merge([thread], state(), false)).toEqual([thread])
        expect(merge).toHaveBeenCalledOnce()
    })
})
