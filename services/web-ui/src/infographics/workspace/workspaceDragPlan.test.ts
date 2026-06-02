import { describe, it, expect } from 'vitest'
import type { AiChatThreadCanvasNode, CanvasNode, ImageCanvasNode, DocumentCanvasNode } from '@lixpi/constants'

import { computeWorkspaceDragPlan } from '$src/infographics/workspace/workspaceDragPlan.ts'

// =============================================================================
// HELPERS
// =============================================================================

function makeThread(overrides: Partial<AiChatThreadCanvasNode> & { nodeId: string }): AiChatThreadCanvasNode {
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
// AI CHAT THREAD DRAG PLANNING
// =============================================================================

describe('computeWorkspaceDragPlan — AI chat thread drags', () => {
    it('ignores stale selection from another activated chat thread', () => {
        const threadA = makeThread({ nodeId: 'thread-a' })
        const threadB = makeThread({ nodeId: 'thread-b' })

        const result = plan({
            nodes: [threadA, threadB],
            primaryNodeId: 'thread-b',
            selectedNodeIds: new Set(['thread-a']),
        })

        expect(result.resolvedNodeId).toBe('thread-b')
        expect(result.draggedNodeIds).toEqual(['thread-b'])
    })

    it('moves only the chat thread and its real parented descendants', () => {
        const thread = makeThread({ nodeId: 'thread-1' })
        const childImage = makeImage({ nodeId: 'child-image', parentId: 'thread-1', position: { x: 48, y: 64 } })
        const connectedImage = makeImage({ nodeId: 'connected-image', position: { x: 800, y: 100 } })

        const result = plan({
            nodes: [thread, childImage, connectedImage],
            primaryNodeId: 'thread-1',
        })

        expect(result.draggedNodeIds).toEqual(['thread-1', 'child-image'])
        expect(result.draggedNodeIds).not.toContain('connected-image')
    })

    it('does not move generated output images with chat threads', () => {
        const thread = makeThread({ nodeId: 'thread-1' })
        const outputImage = makeImage({
            nodeId: 'output-image',
            position: { x: 640, y: 100 },
            generatedBy: {
                aiChatThreadId: 'thread-1',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [thread, outputImage],
            primaryNodeId: 'thread-1',
        })

        expect(result.draggedNodeIds).toEqual(['thread-1'])
    })

    it('does not move generated output images even if stale parentId says they are chat-thread children', () => {
        const thread = makeThread({ nodeId: 'thread-node-1', referenceId: 'thread-1' })
        const generatedOutput = makeImage({
            nodeId: 'generated-output',
            parentId: 'thread-node-1',
            position: { x: 96, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-1',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                revisedPrompt: 'prompt',
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [thread, generatedOutput],
            primaryNodeId: 'thread-node-1',
        })

        expect(result.draggedNodeIds).toEqual(['thread-node-1'])
    })

    it('does not let active-thread selection pull edge-connected generated outputs into the drag set', () => {
        const activeThread = makeThread({ nodeId: 'active-thread', referenceId: 'thread-active' })
        const generatedOutput = makeImage({
            nodeId: 'generated-output',
            position: { x: 720, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-active',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [activeThread, generatedOutput],
            primaryNodeId: 'active-thread',
            selectedNodeIds: new Set(['active-thread', 'generated-output']),
        })

        expect(result.draggedNodeIds).toEqual(['active-thread'])
        expect(result.allowCollisionResolution).toBe(true)
    })

    it('moves every selected chat thread as one group', () => {
        const threadA = makeThread({ nodeId: 'thread-a' })
        const threadB = makeThread({ nodeId: 'thread-b' })

        const result = plan({
            nodes: [threadA, threadB],
            primaryNodeId: 'thread-b',
            selectedNodeIds: new Set(['thread-a', 'thread-b']),
        })

        expect(result.resolvedNodeId).toBe('thread-b')
        expect(result.draggedNodeIds).toEqual(['thread-a', 'thread-b'])
        expect(result.allowProximityConnection).toBe(false)
        expect(result.allowCollisionResolution).toBe(true)
    })

    it('moves selected chat threads with their real children but not unrelated leaves', () => {
        const threadA = makeThread({ nodeId: 'thread-a' })
        const threadB = makeThread({ nodeId: 'thread-b' })
        const childA = makeImage({ nodeId: 'child-a', parentId: 'thread-a', position: { x: 48, y: 72 } })
        const childB = makeImage({ nodeId: 'child-b', parentId: 'thread-b', position: { x: 64, y: 80 } })
        const unrelatedLeaf = makeImage({ nodeId: 'unrelated-leaf', position: { x: 900, y: 240 } })

        const result = plan({
            nodes: [threadA, childA, threadB, childB, unrelatedLeaf],
            primaryNodeId: 'thread-a',
            selectedNodeIds: new Set(['thread-a', 'thread-b']),
        })

        expect(result.draggedNodeIds).toEqual(['thread-a', 'thread-b', 'child-b', 'child-a'])
        expect(result.draggedNodeIds).not.toContain('unrelated-leaf')
    })

    it('moves mixed selected groups that include a chat thread without pulling generated outputs', () => {
        const thread = makeThread({ nodeId: 'thread-node-1', referenceId: 'thread-1' })
        const document = makeDocument({ nodeId: 'doc-1' })
        const generatedOutput = makeImage({
            nodeId: 'generated-output',
            position: { x: 760, y: 120 },
            generatedBy: {
                aiChatThreadId: 'thread-1',
                responseId: 'response-1',
                aiModel: 'openai:gpt-4o' as any,
                responseMessageId: 'message-1',
            },
        })

        const result = plan({
            nodes: [thread, document, generatedOutput],
            primaryNodeId: 'thread-node-1',
            selectedNodeIds: new Set(['thread-node-1', 'doc-1', 'generated-output']),
        })

        expect(result.draggedNodeIds).toEqual(['thread-node-1', 'doc-1'])
        expect(result.draggedNodeIds).not.toContain('generated-output')
        expect(result.allowCollisionResolution).toBe(true)
    })

    it('enables top-level collision resolution for chat-thread release', () => {
        const result = plan({
            nodes: [makeThread({ nodeId: 'thread-1' })],
            primaryNodeId: 'thread-1',
        })

        expect(result.isParentContainerDrag).toBe(true)
        expect(result.allowProximityConnection).toBe(false)
        expect(result.allowCollisionResolution).toBe(true)
    })
})

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
