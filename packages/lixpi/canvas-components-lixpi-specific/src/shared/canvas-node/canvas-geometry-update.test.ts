'use strict'

import type {
    CanvasNode,
    CanvasState,
    WorkspaceEdge,
} from '@lixpi/constants'
import {
    describe,
    expect,
    it,
} from 'vitest'

import { applyCanvasGeometryUpdateToState } from './canvas-geometry-update.ts'

function makeForkNode(nodeId: string): CanvasNode {
    return {
        nodeId,
        type: 'branchFork',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        position: { x: 0, y: 0 },
        dimensions: { width: 300, height: 64 },
        temporary: true,
    }
}

function makeImageNode(nodeId: string, src = '', overrides: Partial<Extract<CanvasNode, { type: 'image' }>> = {}): CanvasNode {
    return {
        nodeId,
        type: 'image',
        fileId: '',
        workspaceId: 'workspace-1',
        src,
        aspectRatio: 1,
        position: { x: 0, y: 0 },
        dimensions: { width: 800, height: 800 },
        generatedBy: {
            aiChatThreadId: 'thread-1',
            responseId: '',
            aiModel: 'Anthropic:claude-sonnet-4-6',
            imageModelProvider: 'Stability',
            revisedPrompt: 'make a mountain',
            responseMessageId: '',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: `${nodeId}:run`,
            branchId: 'branch-1',
            branchForkNodeId: 'fork-1',
            lineageParentNodeId: 'fork-1',
            promptText: 'make a mountain',
        },
        ...overrides,
    }
}

function makeVideoNode(nodeId: string): CanvasNode {
    return {
        nodeId,
        type: 'video',
        fileId: '',
        posterFileId: '',
        workspaceId: 'workspace-1',
        src: '',
        posterSrc: '',
        aspectRatio: 1,
        durationSeconds: 0,
        hasAudio: false,
        position: { x: 0, y: 0 },
        dimensions: { width: 800, height: 800 },
        generatedBy: {
            aiChatThreadId: 'thread-1',
            responseId: '',
            videoModel: 'Google:veo-3',
            revisedPrompt: 'make a mountain',
            responseMessageId: '',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: `${nodeId}:run`,
            branchId: 'branch-1',
            branchForkNodeId: 'fork-1',
            lineageParentNodeId: 'fork-1',
            promptText: 'make a mountain',
        },
    }
}

function makeEdge(edgeId: string, sourceNodeId: string, targetNodeId: string): WorkspaceEdge {
    return {
        edgeId,
        sourceNodeId,
        targetNodeId,
        sourceHandle: 'right',
        targetHandle: 'left',
    }
}

const canvasState = (nodes: CanvasNode[], edges: WorkspaceEdge[] = []): CanvasState => ({
    sourceContext: { extractionRunId: 'extraction-1', sourceWorkspaceId: 'workspace-1' },
    nodes,
    edges,
})

describe('applyCanvasGeometryUpdateToState', () => {
    it('adds missing API-owned node snapshots before applying authoritative geometry', () => {
        const fork = makeForkNode('fork-1')
        const image0 = makeImageNode('pending-image-0', '', { mediaGenerationPhase: 'pending-before-first-frame' })
        const image1 = makeImageNode('pending-image-1', '', { mediaGenerationPhase: 'pending-before-first-frame' })
        const video0 = makeVideoNode('pending-video-0')

        const result = applyCanvasGeometryUpdateToState(canvasState([fork]), {
            layoutRevision: 200,
            nodes: [
                { nodeId: 'fork-1', position: { x: 100, y: 300 }, dimensions: { width: 298, height: 64 } },
                { nodeId: 'pending-image-0', position: { x: 650, y: -700 }, dimensions: { width: 800, height: 800 } },
                { nodeId: 'pending-image-1', position: { x: 650, y: 200 }, dimensions: { width: 800, height: 800 } },
                { nodeId: 'pending-video-0', position: { x: 650, y: 1100 }, dimensions: { width: 800, height: 800 } },
            ],
            nodeSnapshots: [image0, image1, video0],
            edgeSnapshots: [
                makeEdge('edge-fork-image-0', 'fork-1', 'pending-image-0'),
                makeEdge('edge-fork-image-1', 'fork-1', 'pending-image-1'),
                makeEdge('edge-fork-video-0', 'fork-1', 'pending-video-0'),
            ],
        })

        expect(result.changed).toBe(true)
        expect(result.initialMatchedGeometryNodeCount).toBe(1)
        expect(result.matchedGeometryNodeCount).toBe(4)
        expect(result.missingGeometryNodeIds).toEqual([])
        expect(result.upsertedNodeIds).toEqual(['pending-image-0', 'pending-image-1', 'pending-video-0'])
        expect(result.upsertedEdgeIds).toEqual(['edge-fork-image-0', 'edge-fork-image-1', 'edge-fork-video-0'])
        expect(result.fullyApplied).toBe(true)
        expect(result.state.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'fork-1', position: { x: 100, y: 300 }, dimensions: { width: 298, height: 64 } }),
            expect.objectContaining({
                nodeId: 'pending-image-0',
                position: { x: 650, y: -700 },
                mediaGenerationPhase: 'pending-before-first-frame',
            }),
            expect.objectContaining({ nodeId: 'pending-video-0', position: { x: 650, y: 1100 } }),
        ]))
        expect(result.state.edges).toEqual([
            makeEdge('edge-fork-image-0', 'fork-1', 'pending-image-0'),
            makeEdge('edge-fork-image-1', 'fork-1', 'pending-image-1'),
            makeEdge('edge-fork-video-0', 'fork-1', 'pending-video-0'),
        ])
    })

    it('does not overwrite existing local media state with an API snapshot', () => {
        const localImage = makeImageNode('pending-image-0', 'blob:partial-frame')
        const staleSnapshot = makeImageNode('pending-image-0', '')

        const result = applyCanvasGeometryUpdateToState(canvasState([localImage]), {
            layoutRevision: 201,
            nodes: [
                { nodeId: 'pending-image-0', position: { x: 400, y: 500 }, dimensions: { width: 640, height: 640 } },
            ],
            nodeSnapshots: [staleSnapshot],
        })

        expect(result.upsertedNodeIds).toEqual([])
        expect(result.upsertedEdgeIds).toEqual([])
        expect(result.state.nodes[0]).toMatchObject({
            nodeId: 'pending-image-0',
            src: 'blob:partial-frame',
            position: { x: 400, y: 500 },
            dimensions: { width: 640, height: 640 },
        })
    })

    it('removes replaced pending nodes and their edges', () => {
        const pending = makeImageNode('pending-image-0')
        const final = makeImageNode('node-file-1', '/api/images/workspace-1/file-1')
        const state: CanvasState = {
            ...canvasState([makeForkNode('fork-1'), pending]),
            edges: [
                { edgeId: 'edge-fork-pending', sourceNodeId: 'fork-1', targetNodeId: 'pending-image-0' },
            ],
        }

        const result = applyCanvasGeometryUpdateToState(state, {
            layoutRevision: 202,
            removedNodeIds: ['pending-image-0'],
            nodeSnapshots: [final],
            edgeSnapshots: [
                { edgeId: 'edge-fork-final', sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' },
            ],
            nodes: [
                { nodeId: 'node-file-1', position: { x: 500, y: 600 }, dimensions: { width: 800, height: 800 } },
            ],
        })

        expect(result.removedNodeIds).toEqual(['pending-image-0'])
        expect(result.removedEdgeIds).toEqual(['edge-fork-pending'])
        expect(result.upsertedNodeIds).toEqual(['node-file-1'])
        expect(result.upsertedEdgeIds).toEqual(['edge-fork-final'])
        expect(result.state.nodes.map(node => node.nodeId)).toEqual(['fork-1', 'node-file-1'])
        expect(result.state.edges).toEqual([
            { edgeId: 'edge-fork-final', sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' },
        ])
    })

    it('does not resurrect stale pending snapshots after their final media run already exists', () => {
        const fork = makeForkNode('fork-1')
        const pending = makeImageNode('pending-image-0', '', {
            generatedBy: {
                ...(makeImageNode('pending-image-0') as Extract<CanvasNode, { type: 'image' }>).generatedBy!,
                mediaRunId: 'request-1:reasoning:0:image:0',
                mediaModelId: 'Stability:stable-image-ultra',
            },
        })
        const final = makeImageNode('node-file-1', '/api/files/workspace-1/file-1', {
            fileId: 'file-1',
            generatedBy: {
                ...(makeImageNode('node-file-1') as Extract<CanvasNode, { type: 'image' }>).generatedBy!,
                mediaRunId: 'request-1:reasoning:0:image:0',
                mediaModelId: 'Stability:stable-image-ultra',
            },
        })

        const result = applyCanvasGeometryUpdateToState(
            canvasState([fork, final], [
                makeEdge('edge-fork-final', 'fork-1', 'node-file-1'),
            ]),
            {
                layoutRevision: 204,
                nodes: [
                    { nodeId: 'fork-1', position: { x: 100, y: 300 }, dimensions: { width: 298, height: 64 } },
                    { nodeId: 'pending-image-0', position: { x: 650, y: -700 }, dimensions: { width: 800, height: 800 } },
                ],
                nodeSnapshots: [pending],
                edgeSnapshots: [
                    makeEdge('edge-fork-pending', 'fork-1', 'pending-image-0'),
                ],
            },
        )

        expect(result.upsertedNodeIds).toEqual([])
        expect(result.upsertedEdgeIds).toEqual([])
        expect(result.missingGeometryNodeIds).toEqual(['pending-image-0'])
        expect(result.state.nodes.map(node => node.nodeId)).toEqual(['fork-1', 'node-file-1'])
        expect(result.state.edges).toEqual([
            makeEdge('edge-fork-final', 'fork-1', 'node-file-1'),
        ])
    })

    it('does not add API edge snapshots until both endpoints exist', () => {
        const result = applyCanvasGeometryUpdateToState(canvasState([makeForkNode('fork-1')]), {
            layoutRevision: 203,
            nodes: [
                { nodeId: 'fork-1', position: { x: 100, y: 200 }, dimensions: { width: 298, height: 64 } },
            ],
            edgeSnapshots: [
                makeEdge('edge-fork-missing-image', 'fork-1', 'pending-image-0'),
            ],
        })

        expect(result.changed).toBe(true)
        expect(result.upsertedEdgeIds).toEqual([])
        expect(result.state.edges).toEqual([])
    })
})
