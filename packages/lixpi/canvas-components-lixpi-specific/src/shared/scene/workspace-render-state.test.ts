import {
    describe,
    expect,
    it,
} from 'vitest'
import type {
    AiChatThreadCanvasNode,
    CanvasState,
    ImageCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'

import {
    createPendingCanvasVisualCommit,
    getCanvasVisualSyncKey,
    mergeIncomingCanvasStateWithPendingVisualCommit,
    updatePendingCanvasVisualCommitViewport,
} from './workspace-render-state.ts'

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

    it('preserves API-applied connector edges while the incoming store canvas is stale', () => {
        const fork = makeAiChatThread({ nodeId: 'fork-node', referenceId: 'thread-lineage', position: { x: 0, y: 0 } })
        const generated = makeImage({ nodeId: 'pending-image-1', position: { x: 500, y: 0 } })
        const edge = makeEdge('fork-node', 'pending-image-1')
        const apiAppliedState = makeCanvasState({
            nodes: [fork, generated],
            edges: [edge],
        })
        const staleStoreState = makeCanvasState({
            nodes: [fork],
            edges: [],
            activeAiChatSidebarTabId: 'chat:thread-lineage',
        })

        const result = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState: staleStoreState,
            pendingVisualCommit: createPendingCanvasVisualCommit(apiAppliedState),
        })

        expect(result.usedPendingVisualState).toBe(true)
        expect(result.pendingVisualCommit).not.toBeNull()
        expect(result.state?.activeAiChatSidebarTabId).toBe('chat:thread-lineage')
        expect(result.state?.nodes.map((node) => node.nodeId)).toEqual(['fork-node', 'pending-image-1'])
        expect(result.state?.edges).toEqual([edge])
    })

    it('preserves API-completed generated media when the incoming store still has pending placeholders', () => {
        const fork = makeAiChatThread({ nodeId: 'fork-node', referenceId: 'thread-lineage', position: { x: 0, y: 0 } })
        const generatedByBase = {
            aiChatThreadId: 'thread-lineage',
            responseId: 'response-1',
            aiModel: 'anthropic:claude-haiku-4.5' as any,
            revisedPrompt: 'prompt',
            responseMessageId: 'message-1',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-0',
            branchForkNodeId: 'fork-node',
            branchLineNodeId: 'branch-line-1',
        }
        const pendingImage0 = makeImage({
            nodeId: 'pending-image-request-1-reasoning-0-image-0',
            fileId: '',
            src: '',
            position: { x: 500, y: -140 },
            generatedBy: {
                ...generatedByBase,
                mediaRunId: 'request-1:reasoning:0:image:0',
                mediaIndex: 0,
            },
        })
        const pendingImage1 = makeImage({
            nodeId: 'pending-image-request-1-reasoning-0-image-1',
            fileId: '',
            src: '',
            position: { x: 500, y: 140 },
            generatedBy: {
                ...generatedByBase,
                mediaRunId: 'request-1:reasoning:0:image:1',
                mediaIndex: 1,
            },
        })
        const finalImage0 = makeImage({
            nodeId: 'node-hash-final-0',
            fileId: 'hash-final-0',
            src: '/api/files/workspace-1/hash-final-0',
            position: { x: 500, y: -140 },
            generatedBy: pendingImage0.generatedBy,
        })
        const finalImage1 = makeImage({
            nodeId: 'node-hash-final-1',
            fileId: 'hash-final-1',
            src: '/api/files/workspace-1/hash-final-1',
            position: { x: 500, y: 140 },
            generatedBy: pendingImage1.generatedBy,
        })
        const apiCompletedState = makeCanvasState({
            nodes: [fork, finalImage0, finalImage1],
            edges: [
                makeEdge('fork-node', 'node-hash-final-0'),
                makeEdge('fork-node', 'node-hash-final-1'),
            ],
        })
        const stalePendingStoreState = makeCanvasState({
            nodes: [fork, pendingImage0, pendingImage1],
            edges: [
                makeEdge('fork-node', 'pending-image-request-1-reasoning-0-image-0'),
                makeEdge('fork-node', 'pending-image-request-1-reasoning-0-image-1'),
            ],
        })

        const result = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState: stalePendingStoreState,
            pendingVisualCommit: createPendingCanvasVisualCommit(apiCompletedState),
        })

        expect(result.usedPendingVisualState).toBe(true)
        expect(result.pendingVisualCommit).not.toBeNull()
        expect(result.state?.nodes.map((node) => node.nodeId)).toEqual(['fork-node', 'node-hash-final-0', 'node-hash-final-1'])
        expect(result.state?.edges.map((edge) => edge.targetNodeId)).toEqual(['node-hash-final-0', 'node-hash-final-1'])
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
