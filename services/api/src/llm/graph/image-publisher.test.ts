'use strict'

import { describe, it, expect, vi } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

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
})
