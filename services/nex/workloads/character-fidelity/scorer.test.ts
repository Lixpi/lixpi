import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
import {
    describe,
    expect,
    it,
} from 'vitest'

import type {
    CharacterFidelityAssessmentRequest,
    CharacterFidelityObjectCoordinate,
} from '@lixpi/constants'
import {
    assessCharacterFidelity,
    loadCharacterFidelityModels,
    verifyCharacterFidelityArtifacts,
} from './scorer.ts'

const sourceKey = `partial-${'a'.repeat(64)}.png`
const candidateKey = `partial-${'b'.repeat(64)}.png`
const PHOTO_FIXTURE_BASE64 =
    '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'

const coordinate = (objectKey: string, byteLength: number, organizationId = 'org-1'): CharacterFidelityObjectCoordinate => ({
    organizationId,
    bucketName: `transient-media-${organizationId}-files`,
    objectKey,
    mimeType: 'image/png',
    byteLength,
})

const portraitFixture = async (accent: string): Promise<Buffer> =>
    await sharp({
        create: { width: 320, height: 320, channels: 3, background: '#d8c2a6' },
    })
        .composite([
            { input: Buffer.from(`<svg width="320" height="320"><ellipse cx="160" cy="150" rx="92" ry="118" fill="${accent}"/><circle cx="125" cy="130" r="12" fill="#121820"/><circle cx="195" cy="130" r="12" fill="#121820"/><path d="M115 205 Q160 235 205 205" fill="none" stroke="#121820" stroke-width="10"/></svg>`), left: 0, top: 0 },
        ])
        .png()
        .toBuffer()

const request = (
    source: Buffer,
    candidate: Buffer,
    overrides: Partial<CharacterFidelityAssessmentRequest> = {},
): CharacterFidelityAssessmentRequest => ({
    jobId: 'job-1',
    organizationId: 'org-1',
    panelId: 'head-front',
    attemptId: 'attempt-1',
    sources: [coordinate(sourceKey, source.byteLength)],
    candidate: coordinate(candidateKey, candidate.byteLength),
    expectedFaceVisibility: 'required',
    sourceMedium: 'photograph',
    ...overrides,
})

const storage = (source: Buffer, candidate: Buffer) =>
    ({
        getObject: async (_bucket: string, objectKey: string) => objectKey === sourceKey ? source : objectKey === candidateKey ? candidate : null,
    }) as any

describe('character fidelity scorer', () => {
    it('verifies pinned artifacts and loads both models through WASM', async () => {
        await expect(verifyCharacterFidelityArtifacts()).resolves.toBeUndefined()
        await expect(loadCharacterFidelityModels()).resolves.toMatchObject({
            detector: expect.objectContaining({}),
            recognizer: expect.objectContaining({}),
        })
    }, 30000)

    it('scores a fixture pair and returns only detections and scalar similarity', async () => {
        const fixtureBase64 = await readFile(new URL('./fixtures/face-fixture.base64', import.meta.url), 'utf8')
        const source = await sharp(Buffer.from(fixtureBase64.trim(), 'base64')).png().toBuffer()
        const candidate = await sharp(Buffer.from(fixtureBase64.trim(), 'base64')).png().toBuffer()
        const response = await assessCharacterFidelity(request(source, candidate), storage(source, candidate))

        expect(response.metric.available).toBe(true)
        expect(response.metric.cosineSimilarity).toBeGreaterThan(0.9)
        expect(response.sourceDetections).toHaveLength(1)
        expect(response.candidateDetections).toHaveLength(1)
        expect(JSON.stringify(response)).not.toMatch(/embedding|vector/iu)
    }, 30000)

    it('returns typed unavailable results for non-photographic and missing-face inputs', async () => {
        const portrait = await portraitFixture('#68452e')
        const flat = await sharp(Buffer.from(PHOTO_FIXTURE_BASE64, 'base64')).png().toBuffer()

        await expect(assessCharacterFidelity(
            request(portrait, portrait, { sourceMedium: 'illustration' }),
            storage(portrait, portrait),
        )).resolves.toMatchObject({ metric: { available: false, unavailableReason: 'non-photographic' } })
        await expect(assessCharacterFidelity(
            request(flat, portrait),
            storage(flat, portrait),
        )).resolves.toMatchObject({ metric: { available: false, unavailableReason: 'source-face-not-found' } })
    }, 30000)

    it('rejects cross-organization coordinates and cancellation before object reads', async () => {
        const fixture = await portraitFixture('#68452e')
        const invalid = request(fixture, fixture)
        invalid.sources = [coordinate(sourceKey, fixture.byteLength, 'org-2')]
        await expect(assessCharacterFidelity(invalid, storage(fixture, fixture)))
            .rejects.toThrow('CHARACTER_FIDELITY_OBJECT_COORDINATE_INVALID')

        const controller = new AbortController()
        controller.abort(new Error('cancelled'))
        await expect(assessCharacterFidelity(request(fixture, fixture), storage(fixture, fixture), controller.signal))
            .rejects.toThrow('cancelled')
    })

    it('rejects mismatched media types and out-of-bounds dimensions', async () => {
        const jpeg = await sharp({
            create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
        }).jpeg().toBuffer()
        await expect(assessCharacterFidelity(request(jpeg, jpeg), storage(jpeg, jpeg)))
            .rejects.toThrow('CHARACTER_FIDELITY_OBJECT_MEDIA_TYPE_INVALID')

        const oversized = await sharp({
            create: { width: 8_193, height: 1, channels: 3, background: '#ffffff' },
        }).png().toBuffer()
        await expect(assessCharacterFidelity(request(oversized, oversized), storage(oversized, oversized)))
            .rejects.toThrow('CHARACTER_FIDELITY_IMAGE_DIMENSIONS_INVALID')
    })
})
