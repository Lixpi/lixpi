'use strict'

import { describe, expect, it, vi } from 'vitest'

import { MAX_UPLOAD_FILE_SIZE } from '@lixpi/constants'

const mocks = vi.hoisted(() => ({
    assertRemoteImageUrlIsPublic: vi.fn(),
    ingestWorkspaceFile: vi.fn(),
}))

vi.mock('./remote-image-import.ts', () => ({
    assertRemoteImageUrlIsPublic: mocks.assertRemoteImageUrlIsPublic,
}))

vi.mock('./file-ingest.ts', () => ({
    ingestWorkspaceFile: mocks.ingestWorkspaceFile,
}))

import { importRemoteFileToWorkspace } from './remote-file-import.ts'

const makeBodyReader = (chunks: Buffer[]) => {
    let index = 0
    return {
        getReader: () => ({
            async read() {
                if (index >= chunks.length) {
                    return { done: true, value: undefined }
                }
                const value = new Uint8Array(chunks[index])
                index += 1
                return { done: false, value }
            },
            async cancel() {},
        }),
    }
}

const makeResponse = ({
    status,
    headers = {},
    bodyChunks = [],
}: {
    status: number
    headers?: Record<string, string>
    bodyChunks?: Buffer[]
}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: makeBodyReader(bodyChunks),
})

describe('importRemoteFileToWorkspace', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('throws for invalid URLs before making a request', async () => {
        mocks.assertRemoteImageUrlIsPublic.mockResolvedValue(undefined)

        await expect(importRemoteFileToWorkspace({
            workspaceId: 'workspace-1',
            url: '::not-a-url',
        })).rejects.toThrow('Invalid file URL')
        expect(mocks.ingestWorkspaceFile).not.toHaveBeenCalled()
    })

    it('uses the URL pathname filename and returns ingest result for a successful response', async () => {
        mocks.assertRemoteImageUrlIsPublic.mockResolvedValue(undefined)
        mocks.ingestWorkspaceFile.mockResolvedValue({ status: 'ready', fileId: 'file-id', kind: 'document', url: '/api/files/workspace-1/file-id', modelSafe: true })
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({
                status: 200,
                headers: { 'content-length': '4' },
                bodyChunks: [Buffer.from('data')],
            }) as any,
        )

        const result = await importRemoteFileToWorkspace({
            workspaceId: 'workspace-1',
            url: 'https://cdn.example.com/assets/photo.png',
        })

        expect(mocks.ingestWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('data'),
            originalName: 'photo.png',
        })
        expect(result).toEqual({
            status: 'ready',
            fileId: 'file-id',
            kind: 'document',
            url: '/api/files/workspace-1/file-id',
            modelSafe: true,
        })
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        fetchSpy.mockRestore()
    })

    it('uses fallback filename when the path has no explicit file segment', async () => {
        mocks.assertRemoteImageUrlIsPublic.mockResolvedValue(undefined)
        mocks.ingestWorkspaceFile.mockResolvedValue({ status: 'ready', fileId: 'file-id', kind: 'document', url: '/api/files/workspace-1/file-id', modelSafe: true })
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({
                status: 200,
                headers: { 'content-length': '4' },
                bodyChunks: [Buffer.from('data')],
            }) as any,
        )

        await importRemoteFileToWorkspace({
            workspaceId: 'workspace-1',
            url: 'https://cdn.example.com/path/',
        })

        expect(mocks.ingestWorkspaceFile).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            buffer: Buffer.from('data'),
            originalName: 'remote-file',
        })
        fetchSpy.mockRestore()
    })

    it('rejects oversized payloads before ingestion', async () => {
        mocks.assertRemoteImageUrlIsPublic.mockResolvedValue(undefined)
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            makeResponse({
                status: 200,
                headers: { 'content-length': String(MAX_UPLOAD_FILE_SIZE + 1) },
            }) as any,
        )

        await expect(importRemoteFileToWorkspace({
            workspaceId: 'workspace-1',
            url: 'https://cdn.example.com/video.mp4',
        })).rejects.toThrow('Remote file is too large')
        expect(mocks.ingestWorkspaceFile).not.toHaveBeenCalled()
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        fetchSpy.mockRestore()
    })

    it('rejects too many redirects', async () => {
        mocks.assertRemoteImageUrlIsPublic.mockResolvedValue(undefined)
        let redirects = 0
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            redirects += 1
            if (redirects >= 6) {
                return { ok: true, status: 200, headers: new Headers() } as any
            }
            return {
                ok: false,
                status: 302,
                headers: new Headers({ location: `https://cdn.example.com/${redirects}` }),
                body: makeBodyReader([]),
            } as any
        })

        await expect(importRemoteFileToWorkspace({
            workspaceId: 'workspace-1',
            url: 'https://cdn.example.com/start',
        })).rejects.toThrow('Remote file redirected too many times')
        expect(redirects).toBeGreaterThan(4)
    })

    it('rejects non-OK responses', async () => {
        mocks.assertRemoteImageUrlIsPublic.mockResolvedValue(undefined)
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            status: 404,
            headers: new Headers(),
        } as any)

        await expect(importRemoteFileToWorkspace({
            workspaceId: 'workspace-1',
            url: 'https://cdn.example.com/missing',
        })).rejects.toThrow('Remote file fetch failed with status 404')
    })
})
