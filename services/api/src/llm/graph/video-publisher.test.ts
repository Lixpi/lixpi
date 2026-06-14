'use strict'

import { describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

import { VideoPublisher } from './video-publisher.ts'

type Published = { subject: string, payload: any }

const makePublisher = () => {
    const published: Published[] = []
    const nats = {
        publish: (subject: string, payload: any) => {
            published.push({ subject, payload })
        },
    } as any
    const storeVideo = vi.fn(async () => ({
        fileId: 'video-file-id',
        url: '/api/videos/ws-1/video-file-id',
        isDuplicate: false,
        size: 1234,
        mimeType: 'video/mp4',
    }))
    const storeImage = vi.fn(async () => ({
        fileId: 'image-file-id',
        url: '/api/images/ws-1/image-file-id',
        isDuplicate: false,
        size: 456,
        mimeType: 'image/png',
    }))
    const publisher = new VideoPublisher(
        nats,
        storeVideo,
        storeImage,
        'ws-1',
        'thread-1',
        'Google',
    )
    return {
        publisher,
        published,
        nats,
        storeVideo,
        storeImage,
    }
}

const mp4Sample = Buffer.from([
    0x00, 0x00, 0x00, 0x20,
    0x66, 0x74, 0x79, 0x70,
    0x6d, 0x70, 0x34, 0x20,
    0x00, 0x00, 0x00, 0x00,
    0x69, 0x6d, 0x6f, 0x76, 0x00, 0x00, 0x00, 0x00,
])

describe('VideoPublisher', () => {
    it('publishes pending and generating events for long-running jobs', () => {
        const { publisher, published } = makePublisher()

        publisher.pending()
        publisher.generating()

        expect(published).toHaveLength(2)
        expect(published[0]?.payload.content).toEqual({
            status: STREAM_STATUS.VIDEO_PENDING,
            videoUrl: '',
            fileId: '',
            aiProvider: 'Google',
        })
        expect(published[1]?.payload.content.status).toBe(STREAM_STATUS.VIDEO_GENERATING)
    })

    it('stores completed videos and optional poster/frame images', async () => {
        const { publisher, published, storeImage } = makePublisher()

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: Buffer.from('poster'),
            frameBuffer: Buffer.from('frame'),
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'Make a fox walk',
            videoModelId: 'veo-3.1-generate-preview',
        })

        const completeEvent = published.find((entry) => entry.payload.content.status === STREAM_STATUS.VIDEO_COMPLETE)?.payload.content
        expect(completeEvent).toMatchObject({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            videoUrl: '/api/videos/ws-1/video-file-id',
            fileId: 'video-file-id',
            posterUrl: '/api/images/ws-1/image-file-id',
            posterFileId: 'image-file-id',
            frameUrl: '/api/images/ws-1/image-file-id',
            frameFileId: 'image-file-id',
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'Make a fox walk',
            aiProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
        })
        expect(storeImage).toHaveBeenCalledTimes(2)
    })

    it('rejects empty final video buffers', async () => {
        const { publisher } = makePublisher()

        await expect(
            publisher.complete({
                videoBuffer: Buffer.from(''),
                posterBuffer: undefined,
                frameBuffer: undefined,
                durationSeconds: 1,
                aspectRatio: '16:9',
                hasAudio: false,
                responseId: 'resp-1',
                revisedPrompt: 'bad',
                videoModelId: 'veo-3.1-generate-preview',
            }),
        ).rejects.toThrow('no video bytes')
    })

    it('rejects non-mp4 buffers before storing', async () => {
        const { publisher } = makePublisher()

        await expect(
            publisher.complete({
                videoBuffer: Buffer.from('still-not-mp4'),
                posterBuffer: undefined,
                frameBuffer: undefined,
                durationSeconds: 1,
                aspectRatio: '16:9',
                hasAudio: false,
                responseId: 'resp-1',
                revisedPrompt: 'bad',
                videoModelId: 'veo-3.1-generate-preview',
            }),
        ).rejects.toThrow('not an MP4 (no ftyp box)')
    })

    it('publishes video errors for downstream recovery', () => {
        const { publisher, published } = makePublisher()

        publisher.error('temporary provider outage')

        expect(published).toHaveLength(1)
        expect(published[0]?.payload.content).toEqual({
            status: STREAM_STATUS.VIDEO_ERROR,
            error: 'temporary provider outage',
            aiProvider: 'Google',
        })
    })
})
