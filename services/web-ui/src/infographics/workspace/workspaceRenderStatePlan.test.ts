import { describe, expect, it } from 'vitest'
import type { AiChatThreadCanvasNode, CanvasState, ImageCanvasNode, WorkspaceEdge } from '@lixpi/constants'

import {
    createPendingCanvasVisualCommit,
    getCanvasVisualSyncKey,
    mergeIncomingCanvasStateWithPendingVisualCommit,
    updatePendingCanvasVisualCommitViewport,
} from '$src/infographics/workspace/workspaceRenderStatePlan.ts'

function makeAiChatThread(overrides: Partial<AiChatThreadCanvasNode> & { nodeId: string }): AiChatThreadCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'aiChatThread',
        referenceId: overrides.referenceId ?? `thread-${overrides.nodeId}`,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 320, height: 240 },
        ...overrides,
    }
}

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

function makeEdge(sourceNodeId: string, targetNodeId: string): WorkspaceEdge {
    return {
        edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        targetNodeId,
        sourceHandle: 'right',
        targetHandle: 'left',
        sourceMessageId: 'message-1',
    }
}

function makeCanvasState(overrides: Partial<CanvasState>): CanvasState {
    return {
        sourceContext: 'workspace' as any,
        nodes: [],
        edges: [],
        ...overrides,
    }
}

describe('workspace render state plan', () => {
    it('preserves a local active-thread drag commit when a stale active-panel metadata render arrives', () => {
        const oldThread = makeAiChatThread({ nodeId: 'thread-node-active', referenceId: 'thread-active', position: { x: 100, y: 100 } })
        const movedThread = makeAiChatThread({ ...oldThread, position: { x: 360, y: 140 } })
        const connectedImage = makeImage({
            nodeId: 'connected-image',
            position: { x: 520, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-active',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                revisedPrompt: 'prompt',
                responseMessageId: 'message-1',
            },
        })
        const edge = makeEdge('thread-node-active', 'connected-image')

        const localDragCommit = makeCanvasState({
            nodes: [movedThread, connectedImage],
            edges: [edge],
            lastActiveAiChatThreadId: 'thread-active',
        })
        const stalePanelRender = makeCanvasState({
            nodes: [oldThread, connectedImage],
            edges: [edge],
            lastActiveAiChatThreadId: 'thread-active',
            activeAiChatSidebarTabId: 'chat:thread-active',
        })

        const result = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState: stalePanelRender,
            pendingVisualCommit: createPendingCanvasVisualCommit(localDragCommit),
        })

        expect(result.usedPendingVisualState).toBe(true)
        expect(result.pendingVisualCommit).not.toBeNull()
        expect(result.state?.activeAiChatSidebarTabId).toBe('chat:thread-active')
        expect(result.state?.nodes.find((node) => node.nodeId === 'thread-node-active')?.position).toEqual({ x: 360, y: 140 })
        expect(result.state?.nodes.find((node) => node.nodeId === 'connected-image')?.position).toEqual({ x: 520, y: 120 })
    })

    it('clears the pending visual commit when the store acknowledges the same visual state', () => {
        const thread = makeAiChatThread({ nodeId: 'thread-node-active', position: { x: 360, y: 140 } })
        const committed = makeCanvasState({ nodes: [thread], edges: [] })
        const acknowledged = makeCanvasState({ nodes: [thread], edges: [], lastActiveAiChatThreadId: 'thread-active' })

        const result = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState: acknowledged,
            pendingVisualCommit: createPendingCanvasVisualCommit(committed),
        })

        expect(result.acknowledgedPendingVisualState).toBe(true)
        expect(result.pendingVisualCommit).toBeNull()
        expect(getCanvasVisualSyncKey(result.state)).toBe(getCanvasVisualSyncKey(committed))
    })

    it('accepts an incoming structural change instead of masking it with a pending commit', () => {
        const thread = makeAiChatThread({ nodeId: 'thread-node-active', position: { x: 360, y: 140 } })
        const committed = makeCanvasState({ nodes: [thread], edges: [] })
        const incomingNewImage = makeCanvasState({
            nodes: [thread, makeImage({ nodeId: 'new-image', position: { x: 700, y: 100 } })],
            edges: [],
        })

        const result = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState: incomingNewImage,
            pendingVisualCommit: createPendingCanvasVisualCommit(committed),
        })

        expect(result.usedPendingVisualState).toBe(false)
        expect(result.pendingVisualCommit).toBeNull()
        expect(result.state?.nodes.map((node) => node.nodeId)).toEqual(['thread-node-active', 'new-image'])
    })

    it('updates a pending visual commit viewport without changing its visual acknowledgement key', () => {
        const thread = makeAiChatThread({ nodeId: 'thread-node-active', position: { x: 360, y: 140 } })
        const committed = makeCanvasState({
            viewport: { x: 663.8041612129193, y: -425.70182866034156, zoom: 0.1 },
            nodes: [thread],
            edges: [],
        })
        const pendingCommit = createPendingCanvasVisualCommit(committed)
        const liveViewport = { x: 672.8041612129193, y: -733.7018286603416, zoom: 0.1 }

        const updatedCommit = updatePendingCanvasVisualCommitViewport(pendingCommit, liveViewport)

        expect(updatedCommit?.state.viewport).toEqual(liveViewport)
        expect(updatedCommit?.visualSyncKey).toBe(pendingCommit.visualSyncKey)
        expect(updatedCommit?.visualSyncKey).toBe(getCanvasVisualSyncKey(committed))
    })
})
