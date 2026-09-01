'use strict'

import process from 'process'

import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    vi,
} from 'vitest'

import {
    NATS_SUBJECTS,
    type GenerateRenditionsRequest,
} from '@lixpi/constants'

const generateAssetRenditionsMock = vi.fn()

const initMock = vi.fn()
const getInstanceMock = vi.fn()
const closeMock = vi.fn()
const infoMock = vi.fn()
const warnMock = vi.fn()
const errMock = vi.fn()

vi.mock('./asset-renditions.ts', () => ({
    generateAssetRenditions: (...args: Parameters<typeof generateAssetRenditionsMock>) => generateAssetRenditionsMock(...args),
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

    it('registers the rendition-generation handler and delegates requests', async () => {
        const generateRenditionsSubject = NATS_SUBJECTS.BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS
        const storage = {}
        const request: GenerateRenditionsRequest = {
            jobId: 'job-1',
            jobKey: 'job-key-1',
            organizationId: 'org-1',
            assetId: 'asset-1',
            sourceBlobHash: 'sha256:abc',
            requestedRenditions: ['thumbnail'],
        }

        getInstanceMock.mockReturnValue(storage)
        generateAssetRenditionsMock.mockResolvedValue({
            jobId: 'job-1',
            jobKey: 'job-key-1',
            organizationId: 'org-1',
            assetId: 'asset-1',
            sourceBlobHash: 'sha256:abc',
            renditions: [{ name: 'thumbnail', status: 'ready', blobHash: 'sha256:def' }],
        })

        await loadResponder()

        const options = initMock.mock.calls[0][0]
        const subscription = options.subscriptions.find((sub: any) => sub.subject === generateRenditionsSubject)
        expect(subscription).toBeTruthy()

        const result = await subscription.handler(request)
        expect(result).toEqual({
            jobId: 'job-1',
            jobKey: 'job-key-1',
            organizationId: 'org-1',
            assetId: 'asset-1',
            sourceBlobHash: 'sha256:abc',
            renditions: [{ name: 'thumbnail', status: 'ready', blobHash: 'sha256:def' }],
        })
        expect(generateAssetRenditionsMock).toHaveBeenCalledWith(request, storage)
    })

    it('throws before attempting a conversion when the storage instance is unavailable', async () => {
        getInstanceMock.mockReturnValue(null)
        const generateRenditionsSubject = NATS_SUBJECTS.BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS
        const request: GenerateRenditionsRequest = {
            jobId: 'job-1',
            jobKey: 'job-key-1',
            organizationId: 'org-1',
            assetId: 'asset-1',
            sourceBlobHash: 'sha256:abc',
            requestedRenditions: ['thumbnail', 'preview'],
        }

        await loadResponder()

        const options = initMock.mock.calls[0][0]
        const subscription = options.subscriptions.find((sub: any) => sub.subject === generateRenditionsSubject)

        await expect(subscription.handler(request)).rejects.toThrow('Conversion service storage unavailable.')
        expect(generateAssetRenditionsMock).not.toHaveBeenCalled()
    })

    it('returns failed rendition payloads when generateAssetRenditions throws', async () => {
        getInstanceMock.mockReturnValue({})
        generateAssetRenditionsMock.mockRejectedValue(new Error('conversion failed'))
        const generateRenditionsSubject = NATS_SUBJECTS.BLOB_PROCESSING_SUBJECTS.GENERATE_RENDITIONS
        const request: GenerateRenditionsRequest = {
            jobId: 'job-1',
            jobKey: 'job-key-1',
            organizationId: 'org-1',
            assetId: 'asset-1',
            sourceBlobHash: 'sha256:abc',
            requestedRenditions: ['thumbnail'],
        }

        await loadResponder()

        const options = initMock.mock.calls[0][0]
        const subscription = options.subscriptions.find((sub: any) => sub.subject === generateRenditionsSubject)

        const result = await subscription.handler(request)
        expect(result.renditions).toEqual([
            { name: 'thumbnail', status: 'failed', errorCode: 'CONVERSION_FAILED' },
        ])
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
