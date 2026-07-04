'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as debugTools from '@lixpi/debug-tools'

const mocks = vi.hoisted(() => ({
    request: vi.fn(),
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
    getInstance: vi.fn(),
}))

vi.mock('@lixpi/debug-tools', () => ({
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: { getInstance: mocks.getInstance },
}))

vi.mock('uuid', () => ({ v4: () => 'frame-workflow' }))

import { extractVideoFramesViaWorkload } from './video-frame-extraction.ts'

const workspaceId = 'workspace-1'
const bucketName = `workspace-${workspaceId}-files`
const videoBuffer = Buffer.from('mp4-bytes')
const fileId = 'tmp-frames-frame-workflow'

describe('video frame extraction via workload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getInstance.mockReturnValue({
            request: mocks.request,
            putObject: mocks.putObject,
            getObject: mocks.getObject,
            deleteObject: mocks.deleteObject,
        })
    })

    it('returns nulls when NATS is unavailable and leaves no traces', async () => {
        mocks.getInstance.mockReturnValue(undefined)

        const result = await extractVideoFramesViaWorkload({
            workspaceId,
            videoBuffer,
        })

        expect(result).toEqual({ posterBuffer: null, frameBuffer: null })
        expect(mocks.request).not.toHaveBeenCalled()
        expect(mocks.putObject).not.toHaveBeenCalled()
        mockWarnSpy('extractVideoFramesViaWorkload: NATS service unavailable; proceeding without frames')
    })

    it('returns nulls and clears temporary video object when the workload reports failure', async () => {
        mocks.request.mockResolvedValue({ success: false, error: 'not supported' })
        mocks.putObject.mockResolvedValue(undefined)
        mocks.deleteObject.mockResolvedValue(undefined)

        const result = await extractVideoFramesViaWorkload({
            workspaceId,
            videoBuffer,
        })

        expect(result).toEqual({ posterBuffer: null, frameBuffer: null })
        expect(mocks.putObject).toHaveBeenCalledWith(bucketName, fileId, videoBuffer, { name: fileId })
        expect(mocks.deleteObject).toHaveBeenCalledWith(bucketName, fileId)
    })

    it('returns poster and frame buffers and deletes all temporary objects', async () => {
        const posterId = `${fileId}-poster`
        const frameId = `${fileId}-frame`
        const posterBuffer = Buffer.from('poster')
        const frameBuffer = Buffer.from('frame')
        mocks.request.mockResolvedValue({
            success: true,
            posterFileId: posterId,
            frameFileId: frameId,
        })
        mocks.putObject.mockResolvedValue(undefined)
        mocks.getObject
            .mockResolvedValueOnce(posterBuffer)
            .mockResolvedValueOnce(frameBuffer)
        mocks.deleteObject.mockResolvedValue(undefined)

        const result = await extractVideoFramesViaWorkload({
            workspaceId,
            videoBuffer,
            atSeconds: 3,
        })

        expect(result).toEqual({ posterBuffer, frameBuffer })
        expect(mocks.deleteObject).toHaveBeenNthCalledWith(1, bucketName, fileId)
        expect(mocks.deleteObject).toHaveBeenNthCalledWith(2, bucketName, posterId)
        expect(mocks.deleteObject).toHaveBeenNthCalledWith(3, bucketName, frameId)
    })

    it('returns nulls when the request throws after temporary upload', async () => {
        mocks.request.mockRejectedValue(new Error('convert failed'))
        mocks.putObject.mockResolvedValue(undefined)
        mocks.deleteObject.mockResolvedValue(undefined)

        const result = await extractVideoFramesViaWorkload({
            workspaceId,
            videoBuffer,
        })

        expect(result).toEqual({ posterBuffer: null, frameBuffer: null })
        expect(mocks.deleteObject).toHaveBeenCalledWith(bucketName, fileId)
    })
})

const mockWarnSpy = (message: string) => {
    expect(debugTools.warn).toHaveBeenCalledWith(expect.stringContaining(message))
}
