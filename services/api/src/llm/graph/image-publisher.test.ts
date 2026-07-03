'use strict'

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

const projectionMocks = vi.hoisted(() => ({
    upsertGeneratedImageToCanvas: vi.fn(async () => undefined),
    logCanvasProjectionError: vi.fn(),
}))

vi.mock('../../services/media-generation-canvas-projection.ts', () => projectionMocks)

import { ImagePublisher } from './image-publisher.ts'

type Published = { subject: string, payload: any }

const makePublisher = () => {
    const published: Published[] = []
    const nats = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
    } as any
    const storeImage = vi.fn(async (input: any) => ({
        fileId: 'file-1',
        url: '/api/images/ws-1/file-1',
        isDuplicate: false,
        size: input.buffer.length,
        mimeType: input.mimeType,
    }))
    const publisher = new ImagePublisher(nats, storeImage, 'ws-1', 'thread-1', 'Google')
    return { publisher, published, storeImage }
}

describe('ImagePublisher', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        projectionMocks.upsertGeneratedImageToCanvas.mockResolvedValue(undefined)
    })

    it('publishes a placeholder for partial stream images with an empty base64 payload', async () => {
        const { publisher, published, storeImage } = makePublisher()

        await publisher.partial('', 2)

        expect(storeImage).not.toHaveBeenCalled()
        expect(published).toHaveLength(1)
        expect(published[0]?.subject).toBe('ai.interaction.chat.receiveMessage.ws-1.thread-1')
        expect(published[0]?.payload.content).toEqual(expect.objectContaining({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: '',
            fileId: '',
            partialIndex: 2,
            aiProvider: 'Google',
        }))
    })

    it('stores partial images as objects and publishes image metadata', async () => {
        const { publisher, published, storeImage } = makePublisher()
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.partial(pngBase64, 1)

        expect(storeImage).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'ws-1',
            originalName: 'generated-image.png',
            mimeType: 'image/png',
        }))
        expect(published).toHaveLength(1)
        expect(published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            imageUrl: '/api/images/ws-1/file-1',
            fileId: 'file-1',
            partialIndex: 1,
            aiProvider: 'Google',
        })
    })

    it('silently skips partial upload failures', async () => {
        const published: { subject: string, payload: any }[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const storeImage = vi.fn(async () => {
            throw new Error('storage temporarily unavailable')
        })

        const publisher = new ImagePublisher(nats, storeImage, 'ws-1', 'thread-1', 'Google')

        await expect(publisher.partial('aW1hZ2UtdmFsaWQ=', 0)).resolves.toBeUndefined()
        expect(storeImage).toHaveBeenCalledOnce()
        expect(published).toHaveLength(0)
    })

    it('rejects empty final image bytes', async () => {
        const { publisher, published, storeImage } = makePublisher()

        await expect(publisher.complete({
            imageBase64: '',
            responseId: '',
            revisedPrompt: '',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('no final image bytes')

        expect(storeImage).not.toHaveBeenCalled()
        expect(published).toHaveLength(0)
    })

    it('rejects non-image final bytes', async () => {
        const { publisher, published, storeImage } = makePublisher()

        await expect(publisher.complete({
            imageBase64: Buffer.from('not an image').toString('base64'),
            responseId: '',
            revisedPrompt: '',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('not a PNG or JPEG image')

        expect(storeImage).not.toHaveBeenCalled()
        expect(published).toHaveLength(0)
    })

    it('rejects truncated PNG headers that are not full valid images', async () => {
        const { publisher, published, storeImage } = makePublisher()
        const shortPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString('base64')

        await expect(publisher.complete({
            imageBase64: shortPng,
            responseId: 'resp-2',
            revisedPrompt: 'tiny',
            imageModelId: 'gemini-2.5-flash-image',
        })).rejects.toThrow('Image completion failed: provider returned bytes that are not a PNG or JPEG image')

        expect(storeImage).not.toHaveBeenCalled()
        expect(published).toHaveLength(0)
    })

    it('stores JPEG final bytes with the JPEG MIME type', async () => {
        const { publisher, published, storeImage } = makePublisher()
        const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')

        await publisher.complete({
            imageBase64: jpegBase64,
            responseId: 'resp-1',
            revisedPrompt: 'prompt',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(storeImage).toHaveBeenCalledWith(expect.objectContaining({
            originalName: 'generated-image.jpg',
            mimeType: 'image/jpeg',
        }))
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.IMAGE_COMPLETE)
    })

    it('propagates storage errors from IMAGE_COMPLETE', async () => {
        const { publisher, published } = makePublisher()
        const storeImage = vi.fn(async () => {
            throw new Error('temporary object store write failure')
        })
        const failingPublisher = new ImagePublisher(
            { publish: () => {} } as any,
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
        )
        const jpegBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64')

        await expect(
            failingPublisher.complete({
                imageBase64: jpegBase64,
                responseId: 'resp-1',
                revisedPrompt: 'cat',
                imageModelId: 'gemini-2.5-flash-image',
            }),
        ).rejects.toThrow('temporary object store write failure')
        expect(published).toHaveLength(0)
    })

    it('passes generation-run metadata through partial and complete image events', async () => {
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const onProseMirrorContent = vi.fn()
        const storeImage = vi.fn(async (input: any) => ({
            fileId: 'file-1',
            url: '/api/images/ws-1/file-1',
            isDuplicate: false,
            size: input.buffer.length,
            mimeType: input.mimeType,
        }))
        const published: { subject: string, payload: any }[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const publisher = new ImagePublisher(
            nats,
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
            onProseMirrorContent,
        )

        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')
        await publisher.partial(pngBase64, 2)
        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'cat prompt',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(published[0]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            partialIndex: 2,
            generationRun,
        })
        expect(published[1]?.payload.content).toMatchObject({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            responseId: 'resp-1',
            revisedPrompt: 'cat prompt',
            generationRun,
        })
        expect(onProseMirrorContent).toHaveBeenCalledTimes(2)
        expect(onProseMirrorContent.mock.calls[0]?.[0]).toMatchObject({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            generationRun,
        })
        expect(onProseMirrorContent.mock.calls[1]?.[0]).toMatchObject({
            status: STREAM_STATUS.IMAGE_COMPLETE,
            generationRun,
        })
    })

    it('persists final generated images to API-owned canvas projection before publishing completion', async () => {
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'media-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
            lineageAssignment: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                mediaRunId: 'media-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                branchId: 'branch-1',
                branchForkNodeId: 'fork-1',
                lineageParentNodeId: 'fork-1',
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                promptText: 'draw it',
                createdAt: 1,
            },
        } as const
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const storeImage = vi.fn(async (input: any) => ({
            fileId: 'file-1',
            url: '/api/images/ws-1/file-1',
            isDuplicate: false,
            size: input.buffer.length,
            mimeType: input.mimeType,
        }))
        const publisher = new ImagePublisher(
            nats,
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
        )
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(projectionMocks.upsertGeneratedImageToCanvas).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/ws-1/file-1',
            fileId: 'file-1',
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun,
        })
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.IMAGE_COMPLETE)
    })

    it('still publishes final image completion when canvas projection fails', async () => {
        projectionMocks.upsertGeneratedImageToCanvas.mockRejectedValueOnce(new Error('canvas write failed'))
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            lineageAssignment: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                mediaModelId: 'Google:gemini-2.5-flash-image',
                mediaType: 'image',
                branchId: 'branch-1',
                branchForkNodeId: 'fork-1',
                lineageParentNodeId: 'fork-1',
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                promptText: 'draw it',
                createdAt: 1,
            },
        } as const
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const publisher = new ImagePublisher(
            nats,
            vi.fn(async (input: any) => ({
                fileId: 'file-1',
                url: '/api/images/ws-1/file-1',
                isDuplicate: false,
                size: input.buffer.length,
                mimeType: input.mimeType,
            })),
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
        )
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(projectionMocks.logCanvasProjectionError).toHaveBeenCalledWith(
            'failed to persist generated image to canvas',
            expect.any(Error),
        )
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.IMAGE_COMPLETE)
    })

    it('attempts canvas projection during completion even when generationRun requestKind is media-generation-matrix', async () => {
        const generationRun = {
            requestKind: 'media-generation-matrix',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'media-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const storeImage = vi.fn(async (input: any) => ({
            fileId: 'file-1',
            url: '/api/images/ws-1/file-1',
            isDuplicate: false,
            size: input.buffer.length,
            mimeType: input.mimeType,
        }))
        const publisher = new ImagePublisher(
            nats,
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
        )
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.complete({
            imageBase64: pngBase64,
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            imageModelId: 'gemini-2.5-flash-image',
        })

        expect(projectionMocks.upsertGeneratedImageToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/ws-1/file-1',
            fileId: 'file-1',
            responseId: 'resp-1',
            revisedPrompt: 'draw it clearly',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun,
        }))
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.IMAGE_COMPLETE)
    })

    it('routes image events through onPipelineContent when durable pipeline publishing is supplied', async () => {
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const storeImage = vi.fn(async (input: any) => ({
            fileId: 'file-1',
            url: '/api/images/ws-1/file-1',
            isDuplicate: false,
            size: input.buffer.length,
            mimeType: input.mimeType,
        }))
        const onProseMirrorContent = vi.fn()
        const onPipelineContent = vi.fn()
        const publisher = new ImagePublisher(
            nats,
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
            undefined,
            onProseMirrorContent,
            onPipelineContent,
        )
        const pngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]).toString('base64')

        await publisher.partial(pngBase64, 3)

        expect(published).toHaveLength(0)
        expect(onProseMirrorContent).not.toHaveBeenCalled()
        expect(onPipelineContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.IMAGE_PARTIAL,
            fileId: 'file-1',
            partialIndex: 3,
            aiProvider: 'Google',
        }))
    })
})
