'use strict'

import process from 'process'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { NATS_SUBJECTS, type ConvertFileRequest, type ExtractFramesRequest } from '@lixpi/constants'

const convertWorkspaceFileMock = vi.fn()
const extractVideoFramesMock = vi.fn()

const initMock = vi.fn()
const getInstanceMock = vi.fn()
const closeMock = vi.fn()
const infoMock = vi.fn()
const warnMock = vi.fn()
const errMock = vi.fn()

vi.mock('./file-conversion.ts', () => ({
    convertWorkspaceFile: (...args: Parameters<typeof convertWorkspaceFileMock>) => convertWorkspaceFileMock(...args),
    extractVideoFrames: (...args: Parameters<typeof extractVideoFramesMock>) => extractVideoFramesMock(...args),
}))

vi.mock('@lixpi/nats-service', () => ({
    default: {
        init: (...args: unknown[]) => initMock(...args),
        getInstance: (...args: unknown[]) => getInstanceMock(...args),
    },
}))

vi.mock('@lixpi/debug-tools', () => ({
    info: (...args: unknown[]) => infoMock(...args),
    warn: (...args: unknown[]) => warnMock(...args),
    err: (...args: unknown[]) => errMock(...args),
}))

const loadResponder = async () => {
    vi.resetModules()
    await import('./index.ts')
}

beforeEach(() => {
    vi.resetAllMocks()
    initMock.mockResolvedValue({ close: closeMock })
    process.env.NATS_SERVERS = 'nats://127.0.0.1:4222'
    process.env.NATS_REGULAR_USER_PASSWORD = 'password'
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
})

afterEach(() => {
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
})

describe('file-conversion index responder', () => {
    it('aborts with process.exit when required env vars are missing', async () => {
        process.env.NATS_SERVERS = ''
        process.env.NATS_REGULAR_USER_PASSWORD = ''
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('exit-called')
        })

        await expect(loadResponder()).rejects.toThrow('exit-called')
        expect(initMock).not.toHaveBeenCalled()
        expect(errMock).toHaveBeenCalledWith(
            'file-conversion: NATS_SERVERS and NATS_REGULAR_USER_PASSWORD are required; exiting',
        )

        exitSpy.mockRestore()
    })

    it('registers both conversion handlers and delegates requests', async () => {
        const fileConvertSubject = NATS_SUBJECTS.WORKSPACE_SUBJECTS.FILE_SUBJECTS.CONVERT
        const extractFramesSubject = NATS_SUBJECTS.WORKSPACE_SUBJECTS.FILE_SUBJECTS.EXTRACT_FRAMES
        const storage = {}

        getInstanceMock.mockReturnValue(storage)
        convertWorkspaceFileMock.mockResolvedValue({ success: true, canonicalFileId: 'canonical' })
        extractVideoFramesMock.mockResolvedValue({ success: true, posterFileId: 'poster' })

        await loadResponder()

        const options = initMock.mock.calls[0][0]
        const convertSubscription = options.subscriptions.find((sub: any) => sub.subject === fileConvertSubject)
        const extractSubscription = options.subscriptions.find((sub: any) => sub.subject === extractFramesSubject)
        expect(convertSubscription).toBeTruthy()
        expect(extractSubscription).toBeTruthy()

        const convertReq: ConvertFileRequest = {
            workspaceId: 'ws-1',
            fileId: 'f-1',
            originalName: 'photo.png',
            mimeType: 'image/png',
            kind: 'image',
            modelSafe: true,
            canonicalMime: 'image/png',
        }
        const extractReq: ExtractFramesRequest = {
            workspaceId: 'ws-1',
            videoFileId: 'v-1',
            atSeconds: 1.5,
        }

        const convertResult = await convertSubscription.handler(convertReq)
        expect(convertResult).toEqual({ success: true, canonicalFileId: 'canonical' })
        expect(convertWorkspaceFileMock).toHaveBeenCalledWith(convertReq, storage)

        const extractResult = await extractSubscription.handler(extractReq)
        expect(extractResult).toEqual({ success: true, posterFileId: 'poster' })
        expect(extractVideoFramesMock).toHaveBeenCalledWith(extractReq, storage)

        getInstanceMock.mockReturnValue(null)
        const unavailableResult = await convertSubscription.handler(convertReq)
        expect(unavailableResult).toEqual({ success: false, error: 'Conversion service storage unavailable.' })
    })

    it('returns failure payloads when handlers throw', async () => {
        getInstanceMock.mockReturnValue({})
        convertWorkspaceFileMock.mockRejectedValue(new Error('convert failed'))
        extractVideoFramesMock.mockRejectedValue(new Error('extract failed'))

        await loadResponder()

        const fileConvertSubject = NATS_SUBJECTS.WORKSPACE_SUBJECTS.FILE_SUBJECTS.CONVERT
        const extractFramesSubject = NATS_SUBJECTS.WORKSPACE_SUBJECTS.FILE_SUBJECTS.EXTRACT_FRAMES
        const options = initMock.mock.calls[0][0]
        const convertSubscription = options.subscriptions.find((sub: any) => sub.subject === fileConvertSubject)
        const extractSubscription = options.subscriptions.find((sub: any) => sub.subject === extractFramesSubject)

        const convertResult = await convertSubscription.handler({} as ConvertFileRequest)
        expect(convertResult.success).toBe(false)
        if (!convertResult.success) {
            expect(convertResult.error).toBe('convert failed')
        }

        const extractResult = await extractSubscription.handler({} as ExtractFramesRequest)
        expect(extractResult.success).toBe(false)
        if (!extractResult.success) {
            expect(extractResult.error).toBe('extract failed')
        }
    })

    it('shuts down gracefully on SIGINT and closes service', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined)
        const storage = {}
        getInstanceMock.mockReturnValue(storage)

        await loadResponder()
        process.emit('SIGINT')
        await Promise.resolve()

        expect(closeMock).toHaveBeenCalled()
        expect(exitSpy).toHaveBeenCalledWith(0)

        exitSpy.mockRestore()
    })
})
