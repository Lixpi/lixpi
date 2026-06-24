import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    NATS_SUBJECTS,
    LoadingStatus,
    type AiChatThread,
    type CanvasNode,
    type CanvasState,
    type WorkspaceEdge,
} from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import RouterService from '$src/services/router-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { aiChatThreadStore } from '$src/stores/aiChatThreadStore.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'

// The service module pulls in several stores at import time; mock them so the
// context-resolution logic can run deterministically under happy-dom.
// vi.hoisted keeps the spy available inside the hoisted vi.mock factory below.
const { workspaceGetData, getRouteParams } = vi.hoisted(() => ({ workspaceGetData: vi.fn(), getRouteParams: vi.fn() }))

vi.mock('$src/services/auth-service.ts', () => ({ default: { getTokenSilently: vi.fn() } }))
vi.mock('$src/services/router-service.ts', () => ({ default: { getRouteParams } }))
vi.mock('$src/stores/servicesStore.ts', () => ({ servicesStore: { getData: vi.fn() } }))
vi.mock('$src/stores/aiChatThreadStore.ts', () => ({
    aiChatThreadStore: {
        getData: vi.fn(),
        setMetaValues: vi.fn(),
        setDataValues: vi.fn(),
        setThread: vi.fn(),
    },
}))
vi.mock('$src/stores/aiChatThreadsStore.ts', () => ({
    aiChatThreadsStore: {
        getData: vi.fn(() => new Map()),
        setMetaValues: vi.fn(),
        setThreads: vi.fn(),
        addThread: vi.fn(),
        updateThread: vi.fn(),
        removeThread: vi.fn(),
    },
}))
vi.mock('$src/stores/workspaceStore.ts', () => ({ workspaceStore: { getData: workspaceGetData } }))
vi.mock('$src/stores/documentsStore.ts', () => ({ documentsStore: { getData: vi.fn(() => []) } }))

import AiChatThreadService from '$src/services/ai-chat-thread-service.ts'

const { AI_CHAT_THREAD_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

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

function setNatsRequestResponse(response: unknown): ReturnType<typeof vi.fn> {
    const request = vi.fn().mockResolvedValue(response)
    servicesStore.getData.mockReturnValue({ request } as never)
    return request
}

function setNatsRequestError(error: unknown): ReturnType<typeof vi.fn> {
    const request = vi.fn().mockRejectedValue(error)
    servicesStore.getData.mockReturnValue({ request } as never)
    return request
}

function makeDocumentNode({
    nodeId,
    referenceId,
    contentText = '',
    imageSrc,
}: {
    nodeId: string
    referenceId: string
    contentText?: string
    imageSrc?: string
}): CanvasNode {
    return {
        nodeId,
        type: 'document',
        referenceId,
        position: { x: 0, y: 0 },
        dimensions: { width: 120, height: 90 },
        src: `/doc/${nodeId}.png`,
        fileId: referenceId,
        workspaceId: 'ws-1',
    } as CanvasNode
}

type TestDocument = { documentId: string; title: string; content: string }

const testDocumentsById = (documents: TestDocument[]) => {
    documentsStore.getData.mockReturnValue(documents as never)
}

let service: AiChatThreadService

beforeEach(() => {
    vi.clearAllMocks()
    getRouteParams.mockReturnValue({ workspaceId: 'ws-1' })
    vi.mocked(AuthService.getTokenSilently).mockResolvedValue('token-123')
    testDocumentsById([])
    servicesStore.getData.mockReturnValue(undefined as never)
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

    it('adds document context with embedded images before any standalone media entries', async () => {
        const doc: TestDocument = {
            documentId: 'doc-1',
            title: 'Context doc',
            content: JSON.stringify({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'describe the scene' }],
                    },
                    {
                        type: 'image',
                        attrs: { src: 'embedded-scene.png' },
                    },
                ],
            }),
        }
        testDocumentsById([doc])
        setCanvasState([makeDocumentNode({ nodeId: 'document-1', referenceId: 'doc-1' })])

        const context = await service.extractSelectedContext({ nodeIds: ['document-1'], includeUpstream: false })
        const message = service.buildContextMessage(context)

        expect(message?.content).toEqual(
            expect.arrayContaining([
                { type: 'input_text', text: JSON.stringify({ type: 'document', title: 'Context doc', content: 'describe the scene\n[image]' }) },
                {
                    type: 'input_image',
                    image_url: 'embedded-scene.png',
                    detail: 'auto',
                },
            ]),
        )
        expect(message?.content).toHaveLength(2)
        expect(aiChatThreadStore.setMetaValues).not.toHaveBeenCalled()
    })

    it('serializes standalone video context using video_url and poster still', () => {
        const message = service.buildContextMessage([
            {
                type: 'video',
                nodeId: 'video-1',
                content: '',
                fileId: 'video-file',
                workspaceId: 'ws-1',
                posterFileId: 'poster-file',
                durationSeconds: 12,
                aspectRatio: 1.78,
                hasAudio: true,
                sourceMessageId: 'source-video-message',
            },
        ])

        expect(message?.content).toEqual([
            {
                type: 'input_text',
                text: JSON.stringify({
                    type: 'standalone_video',
                    video_url: 'nats-obj://workspace-ws-1-files/video-file',
                    duration_s: 12,
                    aspect_ratio: 1.78,
                    has_audio: true,
                    sourceMessageId: 'source-video-message',
                }),
            },
            {
                type: 'input_image',
                image_url: 'nats-obj://workspace-ws-1-files/poster-file',
                detail: 'auto',
            },
        ])
    })
})

describe('AiChatThreadService.getAiChatThread', () => {
    it('sets loading state and persists data on successful load', async () => {
        const thread: AiChatThread = {
            threadId: 'thread-success',
            content: { type: 'doc' },
            aiModel: 'text-model',
            status: 'completed',
            createdAt: 0,
            title: 'Test',
            owner: { type: 'standalone' },
        } as AiChatThread
        setNatsRequestResponse(thread)

        const loaded = await service.getAiChatThread({ workspaceId: 'ws-1', threadId: 'thread-success' })

        expect(loaded).toEqual(thread)
        expect(aiChatThreadStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.loading })
        expect(aiChatThreadStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.success })
        expect(aiChatThreadStore.setThread).toHaveBeenCalledWith(thread)
    })

    it('marks error status when thread request returns an explicit error', async () => {
        setNatsRequestResponse({ error: 'not-found' })

        const loaded = await service.getAiChatThread({ workspaceId: 'ws-1', threadId: 'thread-missing' })

        expect(loaded).toBeNull()
        expect(aiChatThreadStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.error })
        expect(aiChatThreadStore.setThread).not.toHaveBeenCalled()
    })

    it('handles transport failures by returning null and exposing loading error', async () => {
        setNatsRequestError(new Error('transport'))

        const loaded = await service.getAiChatThread({ workspaceId: 'ws-1', threadId: 'thread-error' })

        expect(loaded).toBeNull()
        expect(aiChatThreadStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.error })
        expect(aiChatThreadStore.setThread).not.toHaveBeenCalled()
    })
})

describe('AiChatThreadService.getWorkspaceAiChatThreads', () => {
    it('stores all threads for current route and marks success', async () => {
        const request = setNatsRequestResponse([{ threadId: 'thread-a' }, { threadId: 'thread-b' }])

        await service.getWorkspaceAiChatThreads({ workspaceId: 'ws-1' })

        expect(request).toHaveBeenCalledWith(AI_CHAT_THREAD_SUBJECTS.GET_WORKSPACE_AI_CHAT_THREADS, {
            token: 'token-123',
            workspaceId: 'ws-1',
        })
        expect(aiChatThreadsStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.loading })
        expect(aiChatThreadsStore.setThreads).toHaveBeenCalledWith([{ threadId: 'thread-a' }, { threadId: 'thread-b' }])
        expect(aiChatThreadsStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.success })
        expect(aiChatThreadsStore.removeThread).not.toHaveBeenCalled()
    })

    it('normalizes non-array responses to empty threads', async () => {
        setNatsRequestResponse({ foo: 'bar' })

        await service.getWorkspaceAiChatThreads({ workspaceId: 'ws-1' })

        expect(aiChatThreadsStore.setThreads).toHaveBeenCalledWith([])
    })

    it('ignores stale route responses in both success and error paths', async () => {
        const request = setNatsRequestResponse([{ threadId: 'thread-stale' }])
        getRouteParams.mockReturnValue({ workspaceId: 'ws-2' })

        await service.getWorkspaceAiChatThreads({ workspaceId: 'ws-1' })

        expect(request).toHaveBeenCalled()
        expect(aiChatThreadsStore.setThreads).not.toHaveBeenCalled()
        expect(aiChatThreadsStore.setMetaValues).toHaveBeenCalledWith({ loadingStatus: LoadingStatus.loading })
        expect(aiChatThreadsStore.setMetaValues).not.toHaveBeenCalledWith({ loadingStatus: LoadingStatus.success })

        setNatsRequestError(new Error('transport'))
        getRouteParams.mockReturnValue({ workspaceId: 'ws-2' })
        await service.getWorkspaceAiChatThreads({ workspaceId: 'ws-1' })

        expect(aiChatThreadsStore.setMetaValues).not.toHaveBeenCalledWith({ loadingStatus: LoadingStatus.error })
    })
})

describe('AiChatThreadService.createUpdateAndDeleteChatThread', () => {
    it('creates thread via nats with request payload and adds result to store', async () => {
        const thread = { threadId: 'thread-new', content: { type: 'doc' } }
        const request = setNatsRequestResponse(thread)

        const created = await service.createAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-new',
            content: { type: 'doc', content: [] },
            aiModel: 'model-alpha',
            title: 'New thread',
            owner: { type: 'standalone' },
        })

        expect(created).toEqual(thread)
        expect(request).toHaveBeenCalledWith(AI_CHAT_THREAD_SUBJECTS.CREATE_AI_CHAT_THREAD, {
            token: 'token-123',
            workspaceId: 'ws-1',
            threadId: 'thread-new',
            content: { type: 'doc', content: [] },
            aiModel: 'model-alpha',
            title: 'New thread',
            owner: { type: 'standalone' },
        })
        expect(aiChatThreadsStore.addThread).toHaveBeenCalledWith(thread)
    })

    it('returns null when create response carries an error', async () => {
        setNatsRequestResponse({ error: 'denied' })

        const created = await service.createAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-new',
            content: { type: 'doc' },
            aiModel: 'model-alpha',
        })

        expect(created).toBeNull()
        expect(aiChatThreadsStore.addThread).not.toHaveBeenCalled()
    })

    it('sends only provided update payload fields', async () => {
        const request = setNatsRequestResponse({ threadId: 'thread-update' })
        await service.updateAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-update',
            aiModel: 'updated-model',
            status: 'completed',
        })

        expect(request).toHaveBeenCalledWith(AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD, {
            token: 'token-123',
            workspaceId: 'ws-1',
            threadId: 'thread-update',
            aiModel: 'updated-model',
            status: 'completed',
        })
        expect(aiChatThreadsStore.updateThread).toHaveBeenCalledWith('thread-update', {
            content: undefined,
            aiModel: 'updated-model',
            status: 'completed',
        })
    })

    it('updates only content synchronously for content-only updates and still dispatches request', async () => {
        const request = setNatsRequestResponse({ threadId: 'thread-update' })
        const content = { type: 'doc', content: [{ type: 'paragraph' }] }

        await service.updateAiChatThread({
            workspaceId: 'ws-1',
            threadId: 'thread-update',
            content,
        })

        expect(aiChatThreadsStore.updateThread).toHaveBeenCalledWith('thread-update', { content })
        expect(request).toHaveBeenCalledWith(AI_CHAT_THREAD_SUBJECTS.UPDATE_AI_CHAT_THREAD, {
            token: 'token-123',
            workspaceId: 'ws-1',
            threadId: 'thread-update',
            content,
        })
    })

    it('deletes thread and removes it from store on success, false otherwise', async () => {
        let request = setNatsRequestResponse({ ok: true })
        const deleted = await service.deleteAiChatThread({ workspaceId: 'ws-1', threadId: 'thread-delete' })

        expect(deleted).toBe(true)
        expect(request).toHaveBeenCalledWith(AI_CHAT_THREAD_SUBJECTS.DELETE_AI_CHAT_THREAD, {
            token: 'token-123',
            workspaceId: 'ws-1',
            threadId: 'thread-delete',
        })
        expect(aiChatThreadsStore.removeThread).toHaveBeenCalledWith('thread-delete')

        request = setNatsRequestResponse({ error: 'forbidden' })
        const failed = await service.deleteAiChatThread({ workspaceId: 'ws-1', threadId: 'thread-delete' })
        expect(failed).toBe(false)
    })
})

describe('AiChatThreadService.extractConnectedContext', () => {
    it('extracts document/image/video context from inbound edges and enriches video metadata', async () => {
        const docNode = makeDocumentNode({ nodeId: 'doc-1', referenceId: 'document-1' })
        const connectedImage = imageNode('img-1', 'img-file')
        const connectedVideo = {
            ...imageNode('video-1', 'video-file'),
            type: 'video',
            posterFileId: 'poster-file',
            durationSeconds: 8,
            aspectRatio: 1.78,
            hasAudio: true,
        } as CanvasNode
        setCanvasState(
            [docNode, connectedImage, connectedVideo],
            [
                { edgeId: 'edge-doc', sourceNodeId: 'doc-1', targetNodeId: 'chat-node', sourceHandle: 'right', targetHandle: 'left' },
                {
                    edgeId: 'edge-img',
                    sourceNodeId: 'img-1',
                    targetNodeId: 'chat-node',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
                {
                    edgeId: 'edge-video',
                    sourceNodeId: 'video-1',
                    targetNodeId: 'chat-node',
                    sourceHandle: 'right',
                    targetHandle: 'left',
                },
            ],
        )
        testDocumentsById([
            {
                documentId: 'document-1',
                title: 'Doc title',
                content: JSON.stringify({
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'doc body' }] }],
                }),
            },
        ])

        const context = await service.extractConnectedContext('chat-node')
        expect(context.map((item) => `${item.type}:${item.fileId || item.nodeId}`)).toEqual(
            expect.arrayContaining([
                'document:doc-1',
                'image:img-file',
                'video:video-file',
            ]),
        )
        expect(context[0]!.type).toBe('document')
        const video = context.find((item) => item.type === 'video')
        expect(video?.posterFileId).toBe('poster-file')
    })
})
