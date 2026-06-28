'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROSEMIRROR_SCHEMA_VERSION } from '@lixpi/prosemirror'
import { STREAM_STATUS } from '@lixpi/constants'

import AiChatThread from '../models/ai-chat-thread.ts'

const parserUnsubscribe = vi.fn()
const parserMock = {
    parseToken: vi.fn(),
    startParsing: vi.fn(),
    stopParsing: vi.fn(),
    subscribeToTokenParse: vi.fn(() => parserUnsubscribe),
}

vi.mock('@lixpi/markdown-stream-parser', () => ({
    MarkdownStreamParser: {
        getInstance: vi.fn(() => parserMock),
        removeInstance: vi.fn(),
    },
}))

vi.mock('../models/ai-chat-thread.ts', () => ({
    __esModule: true,
    default: {
        update: vi.fn(),
    },
}))

const flushQueue = () => new Promise(resolve => setTimeout(resolve, 0))

const createTransport = () => ({
    getCurrentSubjectState: vi.fn(async () => ({ subjectSeq: 0, streamSequence: 11 })),
    publishAiStreamStep: vi.fn(async () => ({
        envelope: {
            subjectSeq: 0,
            version: 0,
            kind: 'STEP' as const,
        },
        streamSequence: 77,
    })),
    publishControlEvent: vi.fn(async (payload: any) => ({
        envelope: {
            ...payload,
            kind: payload.kind as 'START' | 'END' | 'ERROR',
            version: payload.version,
        },
        streamSequence: 88,
    })),
    purgeDocumentSubject: vi.fn(async () => undefined),
})

describe('AiChatProseMirrorStreamAssembler', () => {
    let transport: ReturnType<typeof createTransport>

    beforeEach(() => {
        vi.clearAllMocks()
        transport = createTransport()
        parserUnsubscribe.mockClear()
        parserMock.parseToken.mockClear()
        parserMock.startParsing.mockClear()
        parserMock.stopParsing.mockClear()
        parserMock.subscribeToTokenParse.mockClear()
    })

    it('publishes a START control event and seeds stream sequence state on first token', async () => {
        const { AiChatProseMirrorStreamAssembler } = await import('./ai-chat-stream-assembler.ts')
        const assembler = new AiChatProseMirrorStreamAssembler({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            provider: 'Anthropic',
            transport,
        })

        assembler.handleContent({
            status: STREAM_STATUS.START_STREAM,
            aiProvider: 'Anthropic',
        })

        await flushQueue()

        expect(parserMock.startParsing).toHaveBeenCalledTimes(1)
        expect(transport.getCurrentSubjectState).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            docType: 'aiChatThread',
            docId: 'thread-1',
        })
        expect(transport.publishControlEvent).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'START',
            baseVersion: 0,
            version: 0,
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
            expectedLastStreamSequence: 0,
            subjectSeq: 1,
            msgId: expect.stringMatching(/-start-1$/),
            aiProvider: 'Anthropic',
        }))
    })

    it('forwards streaming text to the markdown parser after stream start', async () => {
        const { AiChatProseMirrorStreamAssembler } = await import('./ai-chat-stream-assembler.ts')
        const assembler = new AiChatProseMirrorStreamAssembler({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            provider: 'Anthropic',
            transport,
        })

        assembler.handleContent({ status: STREAM_STATUS.START_STREAM })
        await flushQueue()
        assembler.handleContent({
            status: STREAM_STATUS.STREAMING,
            text: 'hello world',
            aiProvider: 'Anthropic',
        })

        expect(parserMock.parseToken).toHaveBeenCalledTimes(1)
        expect(parserMock.parseToken).toHaveBeenCalledWith('hello world')
    })

    it('persists the final snapshot and publishes END when the stream closes', async () => {
        const { AiChatProseMirrorStreamAssembler } = await import('./ai-chat-stream-assembler.ts')
        const assembler = new AiChatProseMirrorStreamAssembler({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            provider: 'Anthropic',
            transport,
        })
        vi.mocked(AiChatThread.update).mockResolvedValue(undefined)

        assembler.handleContent({ status: STREAM_STATUS.START_STREAM, aiProvider: 'Anthropic' })
        await flushQueue()
        assembler.handleContent({ status: STREAM_STATUS.END_STREAM, aiProvider: 'Anthropic' })
        await flushQueue()
        await flushQueue()

        expect(transport.publishControlEvent).toHaveBeenCalledTimes(2)
        expect(transport.publishControlEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
            kind: 'START',
            baseVersion: 0,
            version: 0,
            schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        }))
        expect(transport.publishControlEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
            kind: 'END',
            version: 0,
            finalVersion: 0,
        }))
        expect(vi.mocked(AiChatThread.update)).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            content: expect.any(Object),
            proseMirrorVersion: 0,
        })
        expect(transport.purgeDocumentSubject).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            docType: 'aiChatThread',
            docId: 'thread-1',
        })
    })

    it('publishes stream error at most once even when duplicate ERROR content arrives', async () => {
        const { AiChatProseMirrorStreamAssembler } = await import('./ai-chat-stream-assembler.ts')
        const assembler = new AiChatProseMirrorStreamAssembler({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            provider: 'Anthropic',
            transport,
        })

        assembler.handleContent({
            status: STREAM_STATUS.ERROR,
            error: 'first failure',
            aiProvider: 'Anthropic',
        })
        await flushQueue()
        assembler.handleContent({
            status: STREAM_STATUS.ERROR,
            error: 'second failure',
            aiProvider: 'Anthropic',
        })
        await flushQueue()

        expect(transport.publishControlEvent).toHaveBeenCalledTimes(1)
        expect(transport.publishControlEvent).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'ERROR',
            error: 'first failure',
        }))
    })
})
