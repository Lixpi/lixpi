'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { deleteImage } from './imageUtils.ts'

const { IMAGE_SUBJECTS } = NATS_SUBJECTS.WORKSPACE_SUBJECTS

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    getTokenSilently: vi.fn(),
    hasNats: true,
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

describe('imageUtils.deleteImage', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn> | null = null
    let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null
    let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.hasNats = true
        mocks.getTokenSilently.mockResolvedValue('token-123')
        mocks.request.mockResolvedValue({})
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
        consoleLogSpy?.mockRestore()
        consoleLogSpy = null
        consoleWarnSpy?.mockRestore()
        consoleWarnSpy = null
        consoleErrorSpy?.mockRestore()
        consoleErrorSpy = null
    })

    it('logs an error and returns when no NATS client is available', async () => {
        mocks.hasNats = false

        await deleteImage('file-id', 'workspace-1')

        expect(mocks.getTokenSilently).not.toHaveBeenCalled()
        expect(mocks.request).not.toHaveBeenCalled()
        expect(consoleErrorSpy).toHaveBeenCalledWith('[imageUtils] NATS service not available')
    })

    it('logs an error and returns when the auth token is unavailable', async () => {
        mocks.getTokenSilently.mockResolvedValue('')

        await deleteImage('file-id', 'workspace-1')

        expect(mocks.getTokenSilently).toHaveBeenCalledTimes(1)
        expect(mocks.request).not.toHaveBeenCalled()
        expect(consoleErrorSpy).toHaveBeenCalledWith('[imageUtils] Failed to get auth token')
    })

    it('deletes the image and logs success when the request succeeds on the first attempt', async () => {
        await deleteImage('file-id', 'workspace-1')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(mocks.request).toHaveBeenCalledWith(IMAGE_SUBJECTS.DELETE_IMAGE, {
            token: 'token-123',
            workspaceId: 'workspace-1',
            fileId: 'file-id',
        })
        expect(consoleLogSpy).toHaveBeenCalledWith('[imageUtils] Deleted image file-id from workspace workspace-1')
        expect(consoleWarnSpy).not.toHaveBeenCalled()
        expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('logs a generic error immediately for a non-retryable error, without retrying', async () => {
        mocks.request.mockResolvedValueOnce({ error: 'SOME_OTHER_ERROR' })

        await deleteImage('file-id', 'workspace-1')

        expect(mocks.request).toHaveBeenCalledTimes(1)
        expect(consoleErrorSpy).toHaveBeenCalledWith('[imageUtils] Failed to delete image file-id:', 'SOME_OTHER_ERROR')
        expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('retries with the documented backoff while the file is still referenced, then succeeds', async () => {
        vi.useFakeTimers()
        mocks.request
            .mockResolvedValueOnce({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })
            .mockResolvedValueOnce({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })
            .mockResolvedValueOnce({})

        const promise = deleteImage('file-id', 'workspace-1')

        await vi.advanceTimersByTimeAsync(750)
        await vi.advanceTimersByTimeAsync(2000)
        await promise

        expect(mocks.request).toHaveBeenCalledTimes(3)
        expect(consoleLogSpy).toHaveBeenCalledWith('[imageUtils] Deleted image file-id from workspace workspace-1')
        expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('gives up after exhausting all retries and warns instead of logging a generic error', async () => {
        vi.useFakeTimers()
        mocks.request.mockResolvedValue({ error: 'FILE_STILL_REFERENCED_BY_CANVAS' })

        const promise = deleteImage('file-id', 'workspace-1')

        await vi.advanceTimersByTimeAsync(750)
        await vi.advanceTimersByTimeAsync(2000)
        await vi.advanceTimersByTimeAsync(5000)
        await promise

        // 1 initial attempt + 3 retries (750ms, 2000ms, 5000ms delays)
        expect(mocks.request).toHaveBeenCalledTimes(4)
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[imageUtils] Image file-id is still referenced by canvas after cleanup retry.',
        )
        expect(consoleErrorSpy).not.toHaveBeenCalled()
        expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    it('catches and logs unexpected errors thrown by the NATS request', async () => {
        const requestError = new Error('nats unavailable')
        mocks.request.mockRejectedValueOnce(requestError)

        await deleteImage('file-id', 'workspace-1')

        expect(consoleErrorSpy).toHaveBeenCalledWith('[imageUtils] Error deleting image file-id:', requestError)
    })
})
