'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_STATUS } from '@lixpi/constants'

const projectionMocks = vi.hoisted(() => ({
    upsertGeneratedVideoToCanvas: vi.fn(async () => undefined),
    logCanvasProjectionError: vi.fn(),
}))

vi.mock('../../services/media-generation-canvas-projection.ts', () => projectionMocks)

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
    beforeEach(() => {
        vi.clearAllMocks()
        projectionMocks.upsertGeneratedVideoToCanvas.mockResolvedValue(undefined)
    })

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

    it('forwards onProseMirrorContent callbacks for the full life-cycle', async () => {
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        } as const
        const onProseMirrorContent = vi.fn()
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const publisher = new VideoPublisher(
            nats,
            async () => ({
                fileId: 'video-file-id',
                url: '/api/videos/ws-1/video-file-id',
                isDuplicate: false,
                size: 1234,
                mimeType: 'video/mp4',
            }),
            async () => ({
                fileId: 'image-file-id',
                url: '/api/images/ws-1/image-file-id',
                isDuplicate: false,
                size: 456,
                mimeType: 'image/png',
            }),
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
            onProseMirrorContent,
        )

        publisher.pending()
        publisher.generating()
        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: Buffer.from('poster'),
            frameBuffer: Buffer.from('frame'),
            durationSeconds: 6,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'Build a cat dance',
            videoModelId: 'veo-3.1-generate-preview',
        })
        publisher.error('temporary provider outage')

        expect(onProseMirrorContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.VIDEO_PENDING,
            generationRun,
        }))
        expect(onProseMirrorContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.VIDEO_GENERATING,
            generationRun,
        }))
        expect(onProseMirrorContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            generationRun,
        }))
        expect(onProseMirrorContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.VIDEO_ERROR,
            generationRun,
            error: 'temporary provider outage',
        }))
        expect(published).toHaveLength(4)
        expect(published[2]?.payload.content).toMatchObject({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            generationRun,
        })
        expect(onProseMirrorContent).toHaveBeenCalledTimes(4)
    })

    it('persists completed videos to API-owned canvas projection before publishing completion', async () => {
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'media-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
            lineageAssignment: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                mediaRunId: 'media-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                mediaModelId: 'Google:veo-3.1-generate-preview',
                mediaType: 'video',
                branchId: 'branch-1',
                branchLineNodeId: 'line-1',
                lineageParentNodeId: 'line-1',
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                promptText: 'animate it',
                createdAt: 1,
            },
        } as const
        const published: Published[] = []
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
            { publish: (subject: string, payload: any) => published.push({ subject, payload }) } as any,
            storeVideo,
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
        )

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: Buffer.from('poster'),
            frameBuffer: Buffer.from('frame'),
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'animate it clearly',
            videoModelId: 'veo-3.1-generate-preview',
        })

        expect(projectionMocks.upsertGeneratedVideoToCanvas).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
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
            revisedPrompt: 'animate it clearly',
            aiProvider: 'Google',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            generationRun,
        })
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.VIDEO_COMPLETE)
    })

    it('still publishes video completion when canvas projection fails', async () => {
        projectionMocks.upsertGeneratedVideoToCanvas.mockRejectedValueOnce(new Error('canvas write failed'))
        const generationRun = {
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            reasoningIndex: 0,
            lineageAssignment: {
                generationRequestId: 'request-1',
                reasoningRunId: 'reasoning-1',
                reasoningModelId: 'Anthropic:claude-sonnet-4-6',
                mediaModelId: 'Google:veo-3.1-generate-preview',
                mediaType: 'video',
                branchId: 'branch-1',
                branchLineNodeId: 'line-1',
                lineageParentNodeId: 'line-1',
                referenceNodeIds: [],
                sourceContextNodeIds: [],
                promptText: 'animate it',
                createdAt: 1,
            },
        } as const
        const published: Published[] = []
        const publisher = new VideoPublisher(
            { publish: (subject: string, payload: any) => published.push({ subject, payload }) } as any,
            vi.fn(async () => ({
                fileId: 'video-file-id',
                url: '/api/videos/ws-1/video-file-id',
                isDuplicate: false,
                size: 1234,
                mimeType: 'video/mp4',
            })),
            vi.fn(async () => ({
                fileId: 'image-file-id',
                url: '/api/images/ws-1/image-file-id',
                isDuplicate: false,
                size: 456,
                mimeType: 'image/png',
            })),
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
        )

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: Buffer.from('poster'),
            frameBuffer: Buffer.from('frame'),
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'animate it clearly',
            videoModelId: 'veo-3.1-generate-preview',
        })

        expect(projectionMocks.logCanvasProjectionError).toHaveBeenCalledWith(
            'failed to persist generated video to canvas',
            expect.any(Error),
        )
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.VIDEO_COMPLETE)
    })

    it('ignores image-post-processing failures and still publishes VIDEO_COMPLETE', async () => {
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const failingStoreImage = vi.fn(async () => {
            throw new Error('post-processing image failed')
        })
        const publisher = new VideoPublisher(
            nats,
            async () => ({
                fileId: 'video-file-id',
                url: '/api/videos/ws-1/video-file-id',
                isDuplicate: false,
                size: 1234,
                mimeType: 'video/mp4',
            }),
            failingStoreImage,
            'ws-1',
            'thread-1',
            'Google',
        )

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: Buffer.from('poster'),
            frameBuffer: Buffer.from('frame'),
            durationSeconds: 7,
            aspectRatio: '16:9',
            hasAudio: false,
            responseId: 'resp-1',
            revisedPrompt: 'Cat in a hat',
            videoModelId: 'veo-3.1-generate-preview',
        })

        const complete = published.find((entry) => entry.payload.content.status === STREAM_STATUS.VIDEO_COMPLETE)?.payload.content
        expect(complete).toMatchObject({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            videoUrl: '/api/videos/ws-1/video-file-id',
            fileId: 'video-file-id',
            posterUrl: '',
            frameUrl: '',
        })
        expect(complete?.posterFileId).toBe('')
        expect(complete?.frameFileId).toBe('')
        expect(failingStoreImage).toHaveBeenCalledTimes(2)
    })

    it('allows missing poster and frame buffers and does not call image storage for absent assets', async () => {
        const storeImage = vi.fn(async () => ({
            fileId: 'image-file-id',
            url: '/api/images/ws-1/image-file-id',
            isDuplicate: false,
            size: 456,
            mimeType: 'image/png',
        }))
        const published: Published[] = []
        const publisher = new VideoPublisher(
            {
                publish: (subject: string, payload: any) => {
                    published.push({ subject, payload })
                },
            } as any,
            vi.fn(async () => ({
                fileId: 'video-file-id',
                url: '/api/videos/ws-1/video-file-id',
                isDuplicate: false,
                size: 1234,
                mimeType: 'video/mp4',
            })),
            storeImage,
            'ws-1',
            'thread-1',
            'Google',
        )

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: null,
            frameBuffer: undefined,
            durationSeconds: 6,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'No poster required',
            videoModelId: 'veo-3.1-generate-preview',
        })

        const complete = published.find((entry) => entry.payload.content.status === STREAM_STATUS.VIDEO_COMPLETE)?.payload.content
        expect(complete).toMatchObject({
            status: STREAM_STATUS.VIDEO_COMPLETE,
            posterUrl: '',
            posterFileId: '',
            frameUrl: '',
            frameFileId: '',
        })
        expect(storeImage).not.toHaveBeenCalled()
    })

    it('attempts canvas projection during completion even when generationRun requestKind is media-generation-matrix', async () => {
        const generationRun = {
            requestKind: 'media-generation-matrix',
            generationRequestId: 'request-1',
            reasoningRunId: 'reasoning-1',
            mediaRunId: 'media-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            reasoningIndex: 0,
            mediaIndex: 0,
            variantIndex: 0,
        }
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const publisher = new VideoPublisher(
            nats,
            async () => ({
                fileId: 'video-file-id',
                url: '/api/videos/ws-1/video-file-id',
                isDuplicate: false,
                size: 1234,
                mimeType: 'video/mp4',
            }),
            async () => ({
                fileId: 'image-file-id',
                url: '/api/images/ws-1/image-file-id',
                isDuplicate: false,
                size: 456,
                mimeType: 'image/png',
            }),
            'ws-1',
            'thread-1',
            'Google',
            generationRun,
        )

        await publisher.complete({
            videoBuffer: mp4Sample,
            posterBuffer: Buffer.from('poster'),
            frameBuffer: Buffer.from('frame'),
            durationSeconds: 4,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'static no lineage',
            videoModelId: 'veo-3.1-generate-preview',
        })

        expect(projectionMocks.upsertGeneratedVideoToCanvas).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'ws-1',
            aiChatThreadId: 'thread-1',
            videoUrl: '/api/videos/ws-1/video-file-id',
            fileId: 'video-file-id',
            posterUrl: '/api/images/ws-1/image-file-id',
            posterFileId: 'image-file-id',
            frameUrl: '/api/images/ws-1/image-file-id',
            frameFileId: 'image-file-id',
            durationSeconds: 4,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'resp-1',
            revisedPrompt: 'static no lineage',
            aiProvider: 'Google',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            generationRun,
        }))
        expect(published[0]?.payload.content.status).toBe(STREAM_STATUS.VIDEO_COMPLETE)
    })

    it('routes video events through onPipelineContent when durable pipeline publishing is supplied', () => {
        const published: Published[] = []
        const nats = {
            publish: (subject: string, payload: any) => {
                published.push({ subject, payload })
            },
        } as any
        const onProseMirrorContent = vi.fn()
        const onPipelineContent = vi.fn()
        const publisher = new VideoPublisher(
            nats,
            vi.fn(),
            vi.fn(),
            'ws-1',
            'thread-1',
            'Google',
            undefined,
            onProseMirrorContent,
            onPipelineContent,
        )

        publisher.pending()

        expect(published).toHaveLength(0)
        expect(onProseMirrorContent).not.toHaveBeenCalled()
        expect(onPipelineContent).toHaveBeenCalledWith(expect.objectContaining({
            status: STREAM_STATUS.VIDEO_PENDING,
            videoUrl: '',
            fileId: '',
            aiProvider: 'Google',
        }))
    })
})
