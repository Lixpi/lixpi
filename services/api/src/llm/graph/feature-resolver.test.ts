'use strict'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as FeatureModule from '../../models/feature.ts'
import * as featureSampleStorage from '../../services/feature-sample-storage.ts'
import { resolveFeatures } from './feature-resolver.ts'
import type { ProviderState } from './state.ts'

// resolveFeatures is the `/use` pre-stage shared by single requests and the matrix
// shared preflight. Its outputs (featureReferenceImages / featureUsagePrompt /
// rewritten messages / merged referenceImages) are media-agnostic: the matrix
// forwards them to every reasoning child, and both the image and video routers
// consume them. These tests pin the extraction contract so a regression here is
// caught before it can starve any media type of its feature references.

const createState = (overrides: Partial<ProviderState> = {}): ProviderState => ({
    messages: [{ role: 'user', content: 'paint a fox' }],
    aiModelMetaInfo: { provider: 'Anthropic', model: 'claude-sonnet-4-6', modelVersion: 'claude-sonnet-4-6' },
    eventMeta: { userId: 'user-1', workspaceId: 'ws-1', organizationId: 'org-1' },
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    instanceKey: 'ws-1:thread-1',
    provider: 'Anthropic',
    modelVersion: 'claude-sonnet-4-6',
    temperature: 0.7,
    streamActive: false,
    aiRequestReceivedAt: 1,
    ...overrides,
})

const buildFeature = (featureId: string) => ({
    featureId,
    name: 'Watercolor',
    category: 'style',
    scope: 'workspace',
    summary: 'Loose watercolor medium',
    instructions: 'Transfer the watercolor medium to the subject.',
    parameters: { styleFingerprint: { palette: 'muted' } },
    workspaceId: 'ws-1',
    sampleImages: [
        { idx: 0, subject: 'specimen', ext: 'png' },
        { idx: 1, subject: 'neutral subject', ext: 'jpg' },
    ],
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('resolveFeatures', () => {
    it('returns an empty patch when no features are referenced', async () => {
        const result = await resolveFeatures(createState({ referencedFeatureIds: [] }))
        expect(result).toEqual({})
    })

    it('resolves /use features into messages, reference images, trace urls, and a usage prompt', async () => {
        vi.spyOn(FeatureModule.default, 'getFeature').mockResolvedValue(buildFeature('feat-ok') as any)
        vi.spyOn(featureSampleStorage, 'readFeatureSampleObject').mockResolvedValue(Buffer.from('sample-bytes') as any)

        const result = await resolveFeatures(createState({
            referencedFeatureIds: ['feat-ok'],
            referenceImages: ['data:image/png;base64,EXISTING'],
        }))

        // Feature sample images are surfaced as data URLs for media generation,
        // with mime type derived from each sample's extension.
        expect(result.featureReferenceImages).toHaveLength(2)
        expect(result.featureReferenceImages?.[0]).toMatch(/^data:image\/png;base64,/)
        expect(result.featureReferenceImages?.[1]).toMatch(/^data:image\/jpeg;base64,/)
        // Merged ahead of any pre-existing references into one media-agnostic array
        // (the image path reads this; the video router reads featureReferenceImages).
        expect(result.referenceImages).toEqual([...(result.featureReferenceImages ?? []), 'data:image/png;base64,EXISTING'])
        // Trace URLs point at the authenticated sample route — no image bytes in trace/state.
        expect(result.featureReferenceImageTraceUrls).toEqual([
            expect.stringContaining('/api/features/feat-ok/samples/0'),
            expect.stringContaining('/api/features/feat-ok/samples/1'),
        ])
        // The feature definition + usage prompt reach the chat model via messages.
        expect(result.featureUsagePrompt).toContain('Watercolor')
        expect(typeof result.messages?.[0]?.content === 'string' ? result.messages[0].content : '').toContain('Feature definition for @Watercolor')
        expect(result.messages?.length).toBeGreaterThan((createState().messages).length)
    })

    it('caps feature reference samples at the per-feature maximum', async () => {
        const manySamples = {
            ...buildFeature('feat-many'),
            sampleImages: Array.from({ length: 8 }, (_, idx) => ({ idx, subject: `s${idx}`, ext: 'png' })),
        }
        vi.spyOn(FeatureModule.default, 'getFeature').mockResolvedValue(manySamples as any)
        vi.spyOn(featureSampleStorage, 'readFeatureSampleObject').mockResolvedValue(Buffer.from('sample-bytes') as any)

        const result = await resolveFeatures(createState({ referencedFeatureIds: ['feat-many'] }))

        // MAX_REFERENCE_SAMPLES_PER_FEATURE keeps the reference budget bounded.
        expect(result.featureReferenceImages?.length).toBeLessThanOrEqual(3)
    })

    it('skips features the requester cannot access without failing the request', async () => {
        vi.spyOn(FeatureModule.default, 'getFeature').mockResolvedValue({ error: 'not accessible' } as any)

        const result = await resolveFeatures(createState({ referencedFeatureIds: ['feat-denied'] }))
        expect(result).toEqual({})
    })
})
