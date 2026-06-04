import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CanvasNode, CanvasState, WorkspaceEdge } from '@lixpi/constants'

// The service module pulls in several stores at import time; mock them so the
// context-resolution logic can run deterministically under happy-dom.
// vi.hoisted keeps the spy available inside the hoisted vi.mock factory below.
const { workspaceGetData } = vi.hoisted(() => ({ workspaceGetData: vi.fn() }))

vi.mock('$src/services/auth-service.ts', () => ({ default: { getTokenSilently: vi.fn() } }))
vi.mock('$src/stores/servicesStore.ts', () => ({ servicesStore: { getData: vi.fn() } }))
vi.mock('$src/stores/aiChatThreadStore.ts', () => ({
    aiChatThreadStore: { getData: vi.fn(), setMetaValues: vi.fn(), setDataValues: vi.fn() },
}))
vi.mock('$src/stores/aiChatThreadsStore.ts', () => ({
    aiChatThreadsStore: { getData: vi.fn(() => new Map()), removeThread: vi.fn(), addThread: vi.fn() },
}))
vi.mock('$src/stores/workspaceStore.ts', () => ({ workspaceStore: { getData: workspaceGetData } }))
vi.mock('$src/stores/documentsStore.ts', () => ({ documentsStore: { getData: vi.fn(() => []) } }))

import AiChatThreadService from '$src/services/ai-chat-thread-service.ts'

function imageNode(nodeId: string, fileId: string): CanvasNode {
    return {
        nodeId,
        type: 'image',
        fileId,
        workspaceId: 'ws-1',
        src: `/${fileId}.png`,
        aspectRatio: 1,
        position: { x: 0, y: 0 },
        dimensions: { width: 10, height: 10 },
    } as CanvasNode
}

function setCanvasState(nodes: CanvasNode[], edges: WorkspaceEdge[] = []): void {
    workspaceGetData.mockReturnValue({ nodes, edges } as unknown as CanvasState)
}

let service: AiChatThreadService

beforeEach(() => {
    vi.clearAllMocks()
    service = new AiChatThreadService()
})

// =============================================================================
// extractSelectedContext — standalone selection resolution
// =============================================================================

describe('AiChatThreadService.extractSelectedContext', () => {
    it('resolves each selected image node and ignores missing ids', async () => {
        setCanvasState([imageNode('img-a', 'file-a'), imageNode('img-b', 'file-b')])

        const context = await service.extractSelectedContext({
            nodeIds: ['img-a', 'missing', 'img-b'],
            includeUpstream: false,
        })

        expect(context.map((item) => item.fileId)).toEqual(['file-a', 'file-b'])
        expect(context.every((item) => item.type === 'image')).toBe(true)
    })

    it('ignores upstream lineage when includeUpstream is false', async () => {
        setCanvasState(
            [imageNode('img-a', 'file-a'), imageNode('img-up', 'file-up')],
            [{ edgeId: 'e1', sourceNodeId: 'img-up', targetNodeId: 'img-a' }],
        )

        const context = await service.extractSelectedContext({ nodeIds: ['img-a'], includeUpstream: false })

        expect(context.map((item) => item.fileId)).toEqual(['file-a'])
    })

    it('includes upstream lineage when includeUpstream is true', async () => {
        setCanvasState(
            [imageNode('img-a', 'file-a'), imageNode('img-up', 'file-up')],
            [{ edgeId: 'e1', sourceNodeId: 'img-up', targetNodeId: 'img-a' }],
        )

        const context = await service.extractSelectedContext({ nodeIds: ['img-a'], includeUpstream: true })

        expect(context.map((item) => item.fileId).sort()).toEqual(['file-a', 'file-up'])
    })

    it('deduplicates a node selected more than once', async () => {
        setCanvasState([imageNode('img-a', 'file-a')])

        const context = await service.extractSelectedContext({ nodeIds: ['img-a', 'img-a'], includeUpstream: false })

        expect(context).toHaveLength(1)
    })

    it('returns nothing when there is no canvas state', async () => {
        workspaceGetData.mockReturnValue(undefined)

        const context = await service.extractSelectedContext({ nodeIds: ['img-a'], includeUpstream: true })

        expect(context).toEqual([])
    })
})

// =============================================================================
// buildContextMessage — outgoing payload shape
// =============================================================================

describe('AiChatThreadService.buildContextMessage', () => {
    it('returns null for empty context', () => {
        expect(service.buildContextMessage([])).toBeNull()
    })

    it('emits a nats-obj image reference for a standalone image', () => {
        const message = service.buildContextMessage([
            { type: 'image', nodeId: 'img-a', content: '', fileId: 'file-a', workspaceId: 'ws-1' },
        ])

        expect(message?.role).toBe('user')
        const imageBlock = message?.content.find((block) => block.type === 'input_image')
        expect(imageBlock).toEqual({
            type: 'input_image',
            image_url: 'nats-obj://workspace-ws-1-files/file-a',
            detail: 'auto',
        })
    })
})
