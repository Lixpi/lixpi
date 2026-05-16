'use strict'

import { describe, it, expect, vi } from 'vitest'

import { STREAM_STATUS } from '../config.ts'
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