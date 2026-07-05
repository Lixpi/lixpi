'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { deleteVideo } from './videoUtils.ts'

const { VIDEO_SUBJECTS, IMAGE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    getTokenSilently: vi.fn(),
    hasNats: true,
    tokenValue: 'token-123',
}))

vi.mock('$src/services/auth-service.ts', () => ({
    default: {
        getTokenSilently: mocks.getTokenSilently,
    },
}))

vi.mock('$src/stores/servicesStore.ts', () => ({
    servicesStore: {
        getData: vi.fn((key: string) => {
            if (key === 'nats' && mocks.hasNats) {
                return { request: mocks.request }
            }
            return null
        }),
    },
}))

describe('videoUtils.deleteVideo', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.hasNats = true
        mocks.tokenValue = 'token-123'
        mocks.getTokenSilently.mockResolvedValue(mocks.tokenValue)
        mocks.request.mockResolvedValue({})
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleWarnSpy?.mockRestore()
        consoleWarnSpy = null
    })

    it('returns early when fileId or workspaceId is missing', async () => {
        await deleteVideo('', 'workspace-1')
        await deleteVideo('video-id', '')

        expect(mocks.request).not.toHaveBeenCalled()
        expect(mocks.getTokenSilently).not.toHaveBeenCalled()
    })

    it('returns early when no NATS client is available', async () => {
        mocks.hasNats = false

        await deleteVideo('video-id', 'workspace-1')

        expect(mocks.getTokenSilently).not.toHaveBeenCalled()
        expect(mocks.request).not.toHaveBeenCalled()
    })

    it('returns early when auth token is unavailable', async () => {
        mocks.getTokenSilently.mockResolvedValue('')

        await deleteVideo('video-id', 'workspace-1')

        expect(mocks.getTokenSilently).toHaveBeenCalledTimes(1)
        expect(mocks.request).not.toHaveBeenCalled()
    })

    it('deletes the workspace video and poster when provided', async () => {
        await deleteVideo('video-file-id', 'workspace-1', 'poster-file-id')

        expect(mocks.getTokenSilently).toHaveBeenCalledTimes(1)
        expect(mocks.request).toHaveBeenCalledTimes(2)
        expect(mocks.request).toHaveBeenNthCalledWith(1, VIDEO_SUBJECTS.DELETE_VIDEO, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'video-file-id',
        })
        expect(mocks.request).toHaveBeenNthCalledWith(2, IMAGE_SUBJECTS.DELETE_IMAGE, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'poster-file-id',
        })
    })

    it('does not attempt poster cleanup when no poster id is provided', async () => {
        await deleteVideo('video-file-id', 'workspace-1')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(mocks.request).toHaveBeenCalledWith(VIDEO_SUBJECTS.DELETE_VIDEO, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'video-file-id',
        })
    })

    it('logs and returns when delete returns an error object', async () => {
        mocks.request.mockResolvedValueOnce({ error: 'DENIED' })

        await deleteVideo('video-file-id', 'workspace-1')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(mocks.request).toHaveBeenCalledWith(VIDEO_SUBJECTS.DELETE_VIDEO, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'video-file-id',
        })
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[videoUtils] deleteVideo refused',
            { fileId: 'video-file-id', workspaceId: 'workspace-1', error: 'DENIED' },
        )
    })

    it('does not attempt poster cleanup when the primary video delete is refused', async () => {
        mocks.request.mockResolvedValueOnce({ error: 'DENIED' })

        await deleteVideo('video-file-id', 'workspace-1', 'poster-file-id')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(mocks.request).toHaveBeenCalledWith(VIDEO_SUBJECTS.DELETE_VIDEO, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'video-file-id',
        })
        expect(mocks.request).not.toHaveBeenCalledWith(IMAGE_SUBJECTS.DELETE_IMAGE, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'poster-file-id',
        })
    })

    it('propagates token retrieval errors instead of suppressing them', async () => {
        const authError = new Error('token unavailable')
        mocks.getTokenSilently.mockRejectedValueOnce(authError)

        await expect(deleteVideo('video-file-id', 'workspace-1')).rejects.toThrow(authError)

        expect(mocks.request).not.toHaveBeenCalled()
    })

    it('logs and returns when request rejects and never attempts poster cleanup', async () => {
        mocks.request.mockRejectedValueOnce(new Error('request failed'))

        await deleteVideo('video-file-id', 'workspace-1', 'poster-file-id')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[videoUtils] deleteVideo failed',
            { fileId: 'video-file-id', workspaceId: 'workspace-1', error: expect.any(Error) },
        )
        expect(mocks.request).not.toHaveBeenCalledWith(IMAGE_SUBJECTS.DELETE_IMAGE, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'poster-file-id',
        })
    })

    it('best-effort cleans up poster failures without propagating errors', async () => {
        mocks.request
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('poster cleanup failed'))

        await deleteVideo('video-file-id', 'workspace-1', 'poster-file-id')

        expect(mocks.request).toHaveBeenCalledTimes(2)
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[videoUtils] poster cleanup failed',
            {
                posterFileId: 'poster-file-id',
                workspaceId: 'workspace-1',
                error: expect.any(Error),
            },
        )
    })

    // =========================================================================
    // FILE_STILL_REFERENCED_BY_CANVAS RETRY
    // =========================================================================

    it('retries the video delete with backoff while the file is still referenced, then succeeds', async () => {
        vi.useFakeTimers()
        try {
            mocks.request
                .mockResolvedValueOnce({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })
                .mockResolvedValueOnce({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })
                .mockResolvedValueOnce({})

            const promise = deleteVideo('video-file-id', 'workspace-1')

            await vi.advanceTimersByTimeAsync(750)
            await vi.advanceTimersByTimeAsync(2000)
            await promise

            expect(mocks.request).toHaveBeenCalledTimes(3)
            expect(consoleWarnSpy).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('gives up after exhausting all retries and warns that cleanup was deferred', async () => {
        vi.useFakeTimers()
        try {
            mocks.request.mockResolvedValue({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })

            const promise = deleteVideo('video-file-id', 'workspace-1')

            await vi.advanceTimersByTimeAsync(750)
            await vi.advanceTimersByTimeAsync(2000)
            await vi.advanceTimersByTimeAsync(5000)
            await promise

            expect(mocks.request).toHaveBeenCalledTimes(4)
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                '[videoUtils] deleteVideo deferred because file is still referenced by canvas',
                { fileId: 'video-file-id', workspaceId: 'workspace-1', error: 'FILE_STILL_REFERENCED_BY_CANVAS' },
            )
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not attempt poster cleanup when the primary video delete is deferred after retries', async () => {
        vi.useFakeTimers()
        try {
            mocks.request.mockResolvedValue({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })

            const promise = deleteVideo('video-file-id', 'workspace-1', 'poster-file-id')

            await vi.advanceTimersByTimeAsync(750)
            await vi.advanceTimersByTimeAsync(2000)
            await vi.advanceTimersByTimeAsync(5000)
            await promise

            expect(mocks.request).toHaveBeenCalledTimes(4)
            expect(mocks.request).not.toHaveBeenCalledWith(IMAGE_SUBJECTS.DELETE_IMAGE, expect.anything())
        } finally {
            vi.useRealTimers()
        }
    })

    it('retries poster cleanup independently of the primary video delete outcome', async () => {
        vi.useFakeTimers()
        try {
            mocks.request
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })
                .mockResolvedValueOnce({})

            const promise = deleteVideo('video-file-id', 'workspace-1', 'poster-file-id')

            await vi.advanceTimersByTimeAsync(750)
            await promise

            expect(mocks.request).toHaveBeenCalledTimes(3)
            expect(mocks.request).toHaveBeenNthCalledWith(1, VIDEO_SUBJECTS.DELETE_VIDEO, {
                token: 'token-123',
                workspaceId: 'workspace-1',
                fileId: 'video-file-id',
            })
            expect(mocks.request).toHaveBeenNthCalledWith(2, IMAGE_SUBJECTS.DELETE_IMAGE, {
                token: 'token-123',
                workspaceId: 'workspace-1',
                fileId: 'poster-file-id',
            })
            expect(mocks.request).toHaveBeenNthCalledWith(3, IMAGE_SUBJECTS.DELETE_IMAGE, {
                token: 'token-123',
                workspaceId: 'workspace-1',
                fileId: 'poster-file-id',
            })
            expect(consoleWarnSpy).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it('does not retry on a non-referenced error, returning immediately', async () => {
        mocks.request.mockResolvedValueOnce({ error: 'SOME_OTHER_ERROR' })

        await deleteVideo('video-file-id', 'workspace-1')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[videoUtils] deleteVideo refused',
            { fileId: 'video-file-id', workspaceId: 'workspace-1', error: 'SOME_OTHER_ERROR' },
        )
    })
})
