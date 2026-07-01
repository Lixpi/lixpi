'use strict'

import { describe, expect, it, vi } from 'vitest'

import { MEDIA_POLICY, type MediaKind } from '@lixpi/constants'

const policyByMime: Record<string, { kind: MediaKind; modelSafe: boolean; canonicalMime: string }> = {
    'application/pdf': {
        kind: MEDIA_POLICY['application/pdf'].kind as MediaKind,
        modelSafe: MEDIA_POLICY['application/pdf'].modelSafe,
        canonicalMime: MEDIA_POLICY['application/pdf'].canonicalMime,
    },
}

const mocks = vi.hoisted(() => ({
    fileTypeFromBuffer: vi.fn(),
}))

vi.mock('file-type', () => ({ fileTypeFromBuffer: mocks.fileTypeFromBuffer }))

import { detectFileType } from './file-type-detection.ts'

describe('file type detection', () => {
    it('rejects empty input with explicit reason', async () => {
        const result = await detectFileType(Buffer.alloc(0), 'empty.txt')

        expect(result).toEqual({ rejected: true, reason: 'The uploaded file is empty.' })
    })

    it('classifies markdown by extension when file type is textual', async () => {
        mocks.fileTypeFromBuffer.mockResolvedValue(undefined)

        const result = await detectFileType(Buffer.from('# hi\\n'), 'note.md')

        expect(result).toEqual({
            rejected: false,
            mimeType: 'text/markdown',
            kind: 'document',
            modelSafe: MEDIA_POLICY['text/markdown'].modelSafe,
            canonicalMime: MEDIA_POLICY['text/markdown'].canonicalMime,
        })
    })

    it('classifies raw text as plain text when extension is not markdown', async () => {
        mocks.fileTypeFromBuffer.mockResolvedValue(undefined)

        const result = await detectFileType(Buffer.from('plain text'), 'notes.txt')

        expect(result).toEqual({
            rejected: false,
            mimeType: 'text/plain',
            kind: 'document',
            modelSafe: MEDIA_POLICY['text/plain'].modelSafe,
            canonicalMime: MEDIA_POLICY['text/plain'].canonicalMime,
        })
    })

    it('classifies SVG by textual root element signature', async () => {
        mocks.fileTypeFromBuffer.mockResolvedValue(undefined)

        const result = await detectFileType(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))

        expect(result).toEqual({
            rejected: false,
            mimeType: 'image/svg+xml',
            kind: MEDIA_POLICY['image/svg+xml'].kind,
            modelSafe: MEDIA_POLICY['image/svg+xml'].modelSafe,
            canonicalMime: MEDIA_POLICY['image/svg+xml'].canonicalMime,
        })
    })

    it('rejects denied executable MIME types directly', async () => {
        mocks.fileTypeFromBuffer.mockResolvedValue({ mime: 'application/x-executable' })

        const result = await detectFileType(Buffer.from('MZ...'))

        expect(result).toEqual({
            rejected: true,
            reason: 'Executable files are not permitted.',
        })
    })

    it('maps known MIME types from file-type and returns policy fields', async () => {
        mocks.fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf' })

        const result = await detectFileType(Buffer.from('%PDF-1.4'))

        expect(result).toEqual({
            rejected: false,
            mimeType: 'application/pdf',
            kind: policyByMime['application/pdf'].kind,
            modelSafe: policyByMime['application/pdf'].modelSafe,
            canonicalMime: policyByMime['application/pdf'].canonicalMime,
        })
    })

    it('rejects unknown textual content when detection and denylist both miss', async () => {
        mocks.fileTypeFromBuffer.mockResolvedValue(undefined)

        const result = await detectFileType(Buffer.from([0xff, 0xfe, 0xfd, 0x00]))

        expect(result).toEqual({
            rejected: true,
            reason: 'Could not recognize this file type.',
        })
    })
})
