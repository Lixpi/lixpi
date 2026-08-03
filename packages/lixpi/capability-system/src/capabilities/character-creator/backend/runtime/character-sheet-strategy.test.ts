'use strict'

import { readFile } from 'node:fs/promises'

import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityMediaExecutionContext } from '../../../../backend/capability-media-strategy.ts'
import { buildCharacterSheetRenderPlan } from '../../shared/character-sheet-media-plan.ts'
import { CharacterSheetStrategy, type CharacterSheetStrategyDeps } from './character-sheet-strategy.ts'

const mocks = {
    clear: vi.fn(async () => undefined),
    compose: vi.fn(async () => ({
        bytes: Buffer.from('composed-sheet'),
        sha256: 'c'.repeat(64),
        width: 3840 as const,
        height: 2560 as const,
        sourceCoverageNote: 'Source coverage: prompt-derived.',
    })),
    getAuthorizedAsset: vi.fn(),
    putWithCoordinate: vi.fn(async (args: { bytes: Uint8Array; revision: number }) => ({
        coordinate: {
            organizationId: 'org-1',
            bucketName: 'transient-media-org-1-files',
            objectKey: `partial-${String(args.revision).padStart(64, '0')}.png`,
            mimeType: 'image/png' as const,
            byteLength: args.bytes.byteLength,
        },
    })),
    readBlob: vi.fn(),
    render: vi.fn(),
}

let panelPng: Buffer

const plan = () => buildCharacterSheetRenderPlan({
    capabilityRunId: 'run-1',
    sourceAssetIds: [],
    userPrompt: 'A courier',
})

const context = (): CapabilityMediaExecutionContext => ({
    organizationId: 'org-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    conversationAssetId: 'thread-1',
    generationRequestId: 'request-1',
    mediaRunId: 'media-1',
    reasoningModel: {
        provider: 'OpenAI',
        modelVersion: 'reasoning-v1',
    },
    imageModel: {
        provider: 'OpenAI',
        modelVersion: 'image-v1',
        meta: {
            provider: 'OpenAI',
            model: 'image',
            modelVersion: 'image-v1',
            imageReferenceCapabilities: {
                maxReferenceImages: 8,
                maxIdentityReferenceImages: 5,
                conditioningModes: ['edit', 'identity'],
                inputFidelity: 'high',
                supportsIterativeEdit: true,
                supportsMask: false,
                supportsStructureControl: false,
                supportsPoseControl: false,
                supportsDeterministicSeed: false,
                maxOutputPixels: 2_359_296,
                supportedAspectRatios: ['1:1'],
            },
        },
    },
    eventMeta: { organizationId: 'org-1', userId: 'user-1' },
})

const assessment = (failed: boolean, score = failed ? 0.4 : 0.9) => ({
    dimensions: [{
        dimension: 'target-view',
        score,
        mismatchCodes: failed ? ['WRONG_VIEW'] : [],
    }],
    assessor: 'test/reasoning-v1',
})

const runtime = (): CharacterSheetStrategyDeps => ({
    referenceAssets: {
        getAuthorizedAsset: mocks.getAuthorizedAsset,
        readBlob: mocks.readBlob,
    },
    transientMedia: {
        create: () => ({
            putWithCoordinate: mocks.putWithCoordinate,
            clear: mocks.clear,
        }),
    },
    imageGeneration: { generate: mocks.render },
    structuredVlm: {
        call: async () => { throw new Error('Unexpected structured VLM call') },
    },
    fidelity: {
        assess: async () => { throw new Error('Unexpected fidelity call') },
    },
    compositor: mocks.compose,
    providerConcurrency: 4,
})

const strategy = (assess: (request: Parameters<NonNullable<CharacterSheetStrategyDeps['panelAssessor']>['assess']>[0]) => Promise<ReturnType<typeof assessment>>) => new CharacterSheetStrategy({
    ...runtime(),
    panelAssessor: { assess },
    evidenceAnalyzer: { analyze: async () => ({ medium: 'unknown' }) },
})

describe('CharacterSheetStrategy', () => {
    beforeAll(async () => {
        panelPng = await sharp({
            create: { width: 256, height: 256, channels: 3, background: '#6688aa' },
        }).png().toBuffer()
    })

    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getAuthorizedAsset.mockResolvedValue({
            assetId: 'asset-1',
            organizationId: 'org-1',
            media: {
                renditions: {
                    canonical: { status: 'ready', blobHash: 'blob-1', mimeType: 'image/png' },
                },
            },
        })
        mocks.readBlob.mockResolvedValue(panelPng)
        mocks.render.mockImplementation(async request => ({
            image: panelPng.toString('base64'),
            providerOperationId: request.operationKey,
            includedReferenceRoles: [],
            omittedReferenceRoles: [],
        }))
    })

    it('executes the 27-panel bound and carries accepted anchors through the graph', async () => {
        const result = await strategy(async () => assessment(false)).execute(context(), plan(), {})
        const trace = result.capabilityMediaTrace as Record<string, unknown>

        expect(mocks.render).toHaveBeenCalledTimes(27)
        expect(trace.totalProviderOperations).toBe(27)
        expect(trace.panels).toHaveLength(27)
        expect(mocks.render.mock.calls.find(([request]) => request.operationKey.includes(':body-profile-left:'))?.[0].references)
            .toEqual(expect.arrayContaining([expect.objectContaining({ role: 'canonical-anchor' })]))
        expect(mocks.clear).toHaveBeenCalledOnce()
    })

    it('retries only the failed panel dimension once and never exceeds 54 operations', async () => {
        const attempts = new Map<string, number>()
        const result = await strategy(async request => {
            const count = (attempts.get(request.panel.panelId) ?? 0) + 1
            attempts.set(request.panel.panelId, count)
            return assessment(count === 1)
        }).execute(context(), plan(), {})
        const trace = result.capabilityMediaTrace as Record<string, unknown>

        expect(mocks.render).toHaveBeenCalledTimes(54)
        expect(trace.totalProviderOperations).toBe(54)
        const corrected = mocks.render.mock.calls.find(([request]) => request.operationKey.endsWith(':2'))?.[0].prompt
        expect(corrected).toContain('Correct only these failed dimensions')
        expect(corrected).toContain('target-view: WRONG_VIEW')
    })

    it('selects best-effort valid panels with warnings after both semantic attempts', async () => {
        const result = await strategy(async () => assessment(true, 0.6)).execute(context(), plan(), {})
        const trace = result.capabilityMediaTrace as { totalProviderOperations: number; panels: unknown[] }

        expect(trace.totalProviderOperations).toBe(54)
        expect(trace.panels).toEqual(expect.arrayContaining([
            expect.objectContaining({ warning: expect.stringContaining('Best-effort') }),
        ]))
        expect(mocks.clear).toHaveBeenCalledOnce()
    })

    it('propagates provider failure and cancellation while cleaning all transient objects', async () => {
        mocks.render.mockImplementationOnce(async () => { throw new Error('provider rejected') })
        await expect(strategy(async () => assessment(false)).execute(context(), plan(), {}))
            .rejects.toThrow('provider rejected')
        expect(mocks.clear).toHaveBeenCalledOnce()

        vi.clearAllMocks()
        const controller = new AbortController()
        controller.abort(new Error('cancelled'))
        await expect(strategy(async () => assessment(false)).execute(context(), plan(), { signal: controller.signal }))
            .rejects.toThrow('cancelled')
        expect(mocks.render).not.toHaveBeenCalled()
        expect(mocks.clear).toHaveBeenCalledOnce()
    })

    it('keeps the final sheet when only the optional generated prop fails', async () => {
        mocks.render.mockImplementation(async request => {
            if (request.operationKey.includes(':prop-primary:')) throw new Error('prop unavailable')
            return {
                image: panelPng.toString('base64'),
                providerOperationId: request.operationKey,
                includedReferenceRoles: [],
                omittedReferenceRoles: [],
            }
        })

        const result = await strategy(async () => assessment(false)).execute(context(), plan(), {})
        const trace = result.capabilityMediaTrace as { totalProviderOperations: number; panels: unknown[] }

        expect(result.generatedImages).toEqual([Buffer.from('composed-sheet').toString('base64')])
        expect(trace.totalProviderOperations).toBe(27)
        expect(trace.panels).toContainEqual(expect.objectContaining({
            panelId: 'prop-primary',
            warning: 'Optional panel was unavailable and left blank.',
        }))
    })

    it('keeps bounded transport retries outside the semantic operation count', async () => {
        mocks.render.mockRejectedValueOnce(Object.assign(new Error('capacity'), { status: 429 }))
        mocks.render.mockImplementation(async request => ({
            image: panelPng.toString('base64'),
            providerOperationId: request.operationKey,
            includedReferenceRoles: [],
            omittedReferenceRoles: [],
        }))

        const result = await strategy(async () => assessment(false)).execute(context(), plan(), {})
        const trace = result.capabilityMediaTrace as Record<string, unknown>

        expect(mocks.render).toHaveBeenCalledTimes(28)
        expect(trace.totalProviderOperations).toBe(27)
    })

    it('cleans transient objects when evidence analysis fails before panel execution', async () => {
        const executionPlan = plan()
        executionPlan.sourceAssetIds = ['asset-1']
        const failing = new CharacterSheetStrategy({
            ...runtime(),
            evidenceAnalyzer: { analyze: async () => { throw new Error('analysis failed') } },
            panelAssessor: { assess: async () => assessment(false) },
        })

        await expect(failing.execute(context(), executionPlan, {})).rejects.toThrow('analysis failed')
        expect(mocks.clear).toHaveBeenCalledOnce()
    })

    it('keeps provider names out of Character and capability-media common layers', async () => {
        const sources = await Promise.all([
            new URL('./character-sheet-strategy.ts', import.meta.url),
            new URL('../../../../backend/capability-media-strategy.ts', import.meta.url),
            new URL('../../../../backend/capability-media-strategy-registry.ts', import.meta.url),
            new URL('../../../../backend/capability-media-dag-runner.ts', import.meta.url),
        ].map(async url => await readFile(url, 'utf8')))

        expect(sources.join('\n')).not.toMatch(/\b(?:OpenAI|Google|Stability)\b/u)
    })
})
