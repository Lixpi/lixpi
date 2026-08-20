'use strict'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
    buildImageGenerationReferences,
    resolveImageGenerationReferences,
} from './image-generation-references.ts'
import { buildOpenAIImageReferenceFiles } from './providers/openai-provider.ts'

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`

describe('buildImageGenerationReferences', () => {
    it('uses provider-neutral roles even when Character Creator owns execution', () => {
        expect(buildImageGenerationReferences({
            sourceReferenceImages: ['source-image'],
            capabilityReferenceImages: ['layout-image'],
            capabilityUsageMode: 'character-creator',
        })).toEqual([
            { url: 'layout-image', role: 'capability-reference', fileName: 'capability-reference-1' },
            { url: 'source-image', role: 'source-reference', fileName: 'source-reference-1' },
        ])
    })

    it('uses the provider-neutral capability/source roles for ordinary image generation', () => {
        expect(buildImageGenerationReferences({
            sourceReferenceImages: ['source-image'],
            capabilityReferenceImages: ['capability-image'],
            capabilityUsageMode: 'visual-style',
        })).toEqual([
            { url: 'capability-image', role: 'capability-reference', fileName: 'capability-reference-1' },
            { url: 'source-image', role: 'source-reference', fileName: 'source-reference-1' },
        ])
    })
})

describe('resolveImageGenerationReferences', () => {
    it('resolves bytes once while preserving ordered roles, stable file names, and fingerprints', async () => {
        const bytes = Buffer.from(TINY_PNG_BASE64, 'base64')
        const references = buildImageGenerationReferences({
            sourceReferenceImages: [TINY_PNG_DATA_URL],
            capabilityReferenceImages: ['nats-obj://capability-bucket/character-sheet.png'],
            capabilityUsageMode: 'character-creator',
        })
        const natsClient = {
            getObject: vi.fn(async () => new Uint8Array(bytes)),
        } as any

        const resolvedReferences = await resolveImageGenerationReferences(references, natsClient)

        expect(natsClient.getObject).toHaveBeenCalledWith('capability-bucket', 'character-sheet.png')
        expect(resolvedReferences.map(reference => ({
            role: reference.role,
            fileName: reference.fileName,
            mediaType: reference.mediaType,
            byteLength: reference.byteLength,
            sha256: reference.sha256,
        }))).toEqual([
            {
                role: 'capability-reference',
                fileName: 'capability-reference-1.png',
                mediaType: 'image/png',
                byteLength: bytes.byteLength,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            },
            {
                role: 'source-reference',
                fileName: 'source-reference-1.png',
                mediaType: 'image/png',
                byteLength: bytes.byteLength,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            },
        ])
        expect(resolvedReferences.every(reference => reference.bytes.equals(bytes))).toBe(true)
    })

    it('fails the generation request instead of silently dropping an unresolved reference', async () => {
        await expect(resolveImageGenerationReferences([{
            url: 'https://example.test/reference.png',
            role: 'source-reference',
            fileName: 'source-reference-1',
        }])).rejects.toThrow(
            'Image generation reference source-reference-1 (source-reference) could not be resolved to inline image bytes',
        )
    })
})

describe('provider-neutral image reference contract', () => {
    it('preserves provider-neutral references in OpenAI multipart order and filenames', async () => {
        const resolvedReferences = await resolveImageGenerationReferences([
            {
                url: TINY_PNG_DATA_URL,
                role: 'original-source',
                fileName: 'original-source-1',
            },
            {
                url: TINY_PNG_DATA_URL,
                role: 'canonical-anchor',
                fileName: 'canonical-anchor-1',
            },
        ])

        const multipartReferences = await buildOpenAIImageReferenceFiles(resolvedReferences)

        expect(multipartReferences.map(reference => ({
            name: reference.name,
            role: reference.role,
            fileName: reference.file.name,
            mediaType: reference.file.type,
            byteLength: reference.file.size,
        }))).toEqual([
            {
                name: 'original-source-1.png',
                role: 'original-source',
                fileName: 'original-source-1.png',
                mediaType: 'image/png',
                byteLength: Buffer.from(TINY_PNG_BASE64, 'base64').byteLength,
            },
            {
                name: 'canonical-anchor-1.png',
                role: 'canonical-anchor',
                fileName: 'canonical-anchor-1.png',
                mediaType: 'image/png',
                byteLength: Buffer.from(TINY_PNG_BASE64, 'base64').byteLength,
            },
        ])
    })

    it('resolves references in BaseProvider and gives every image provider the same resolved state field', () => {
        const baseProviderSource = readFileSync(resolve(__dirname, 'providers/base-provider.ts'), 'utf-8')
        const providerSources = [
            readFileSync(resolve(__dirname, 'providers/openai-provider.ts'), 'utf-8'),
            readFileSync(resolve(__dirname, 'providers/google-provider.ts'), 'utf-8'),
            readFileSync(resolve(__dirname, 'providers/stability-provider.ts'), 'utf-8'),
        ]

        expect(baseProviderSource).toContain('await resolveImageGenerationReferences(imageGenerationReferences, this.nats)')
        for (const providerSource of providerSources) {
            expect(providerSource).toContain('resolvedImageGenerationReferences')
            expect(providerSource).not.toContain('reference_role')
            expect(providerSource).not.toContain('reference_file_name')
        }
    })
})
