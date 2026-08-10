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

type CharacterImageGenerationRequest = Parameters<
    NonNullable<CharacterSheetStrategyDeps['imageGeneration']>['generate']
>[0]

const providerResult = (request: CharacterImageGenerationRequest) => ({
    image: panelPng.toString('base64'),
    providerOperationId: request.operationKey,
    includedReferenceRoles: [...new Set(request.references.map(reference => reference.role))],
    omittedReferenceRoles: [],
})

let panelPng: Buffer

const plan = () => buildCharacterSheetRenderPlan({
    capabilityRunId: 'run-1',
    sourceAssetIds: [],
    userPrompt: 'A courier',
})

const context = (mediaRunId = 'media-1'): CapabilityMediaExecutionContext => ({
    organizationId: 'org-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    conversationAssetId: 'thread-1',
    generationRequestId: 'request-1',
    mediaRunId,
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
        mocks.render.mockImplementation(async request => providerResult(request))
    })

    it('executes the planned panels and carries the accepted identity anchor through the graph', async () => {
        const executionPlan = plan()
        const result = await strategy(async () => assessment(false)).execute(context(), executionPlan, {})
        const trace = result.capabilityMediaTrace as Record<string, unknown>

        expect(mocks.render).toHaveBeenCalledTimes(executionPlan.panels.length)
        expect(trace.totalProviderOperations).toBe(executionPlan.panels.length)
        expect(trace.panels).toHaveLength(executionPlan.panels.length)
        expect(mocks.render.mock.calls.find(([request]) => request.operationKey.includes(':body-profile:'))?.[0].references)
            .toEqual(expect.arrayContaining([expect.objectContaining({ role: 'canonical-anchor' })]))
        expect(mocks.clear).toHaveBeenCalledOnce()
    })

    it('isolates provider operations by media run and publishes the identity-anchor partial before its terminal image', async () => {
        const lifecycle: string[] = []
        mocks.render.mockImplementation(async request => {
            if (request.operationKey.includes(':head-front-neutral:1')) {
                lifecycle.push(`partial:${request.context.mediaRunId}`)
                await request.onImagePartial?.(panelPng.toString('base64'), 1)
                lifecycle.push(`terminal:${request.context.mediaRunId}`)
            }
            return providerResult(request)
        })

        const publishImagePartial = vi.fn(async () => {
            lifecycle.push('published')
        })
        await strategy(async () => assessment(false)).execute(
            context('media-google'),
            plan(),
            { publishImagePartial },
        )
        await strategy(async () => assessment(false)).execute(
            context('media-openai'),
            plan(),
            {},
        )

        const plannedOperationCount = plan().panels.length
        const operationKeys = mocks.render.mock.calls.map(([request]) => request.operationKey)
        expect(operationKeys.filter(key => key.startsWith('media-google:'))).toHaveLength(plannedOperationCount)
        expect(operationKeys.filter(key => key.startsWith('media-openai:'))).toHaveLength(plannedOperationCount)
        expect(new Set(operationKeys)).toHaveLength(plannedOperationCount * 2)
        expect(publishImagePartial).toHaveBeenCalled()
        expect(lifecycle.indexOf('published')).toBeGreaterThan(lifecycle.indexOf('partial:media-google'))
        expect(lifecycle.indexOf('published')).toBeLessThan(lifecycle.indexOf('terminal:media-google'))
    })

    it('does not silently regenerate panels when comparison reports a failed dimension', async () => {
        const attempts = new Map<string, number>()
        const executionPlan = plan()
        const result = await strategy(async request => {
            const count = (attempts.get(request.panel.panelId) ?? 0) + 1
            attempts.set(request.panel.panelId, count)
            return assessment(count === 1)
        }).execute(context(), executionPlan, {})
        const trace = result.capabilityMediaTrace as Record<string, unknown>

        expect(mocks.render).toHaveBeenCalledTimes(executionPlan.panels.length)
        expect(trace.totalProviderOperations).toBe(executionPlan.panels.length)
        expect([...attempts.values()]).toEqual(executionPlan.panels.map(() => 1))
        expect(mocks.render.mock.calls.some(([request]) => request.operationKey.endsWith(':2'))).toBe(false)
    })

    it('retains panels with comparison warnings for explicit user review', async () => {
        const executionPlan = plan()
        const result = await strategy(async () => assessment(true, 0.6)).execute(context(), executionPlan, {})
        const trace = result.capabilityMediaTrace as { totalProviderOperations: number; panels: unknown[] }

        expect(trace.totalProviderOperations).toBe(executionPlan.panels.length)
        expect(trace.panels).toEqual(expect.arrayContaining([
            expect.objectContaining({
                status: 'needs-review',
                failedDimensions: ['target-view'],
            }),
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
        const executionPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: [],
            userPrompt: 'A courier; include their belongings',
        })
        mocks.render.mockImplementation(async request => {
            if (request.operationKey.includes(':prop-primary:')) throw new Error('prop unavailable')
            return providerResult(request)
        })

        const result = await strategy(async () => assessment(false)).execute(context(), executionPlan, {})
        const trace = result.capabilityMediaTrace as { totalProviderOperations: number; panels: unknown[] }

        expect(result.generatedImages).toEqual([Buffer.from('composed-sheet').toString('base64')])
        expect(trace.totalProviderOperations).toBe(executionPlan.panels.length)
        expect(trace.panels).toContainEqual(expect.objectContaining({
            panelId: 'prop-primary',
            status: 'unavailable',
            warning: 'prop unavailable',
        }))
    })

    it('does not silently rerun a failed required identity anchor', async () => {
        mocks.render.mockRejectedValueOnce(Object.assign(new Error('capacity'), { status: 429 }))
        mocks.render.mockImplementation(async request => providerResult(request))

        await expect(strategy(async () => assessment(false)).execute(context(), plan(), {}))
            .rejects.toThrow('CHARACTER_SHEET_IDENTITY_ANCHOR_UNAVAILABLE:capacity')
        expect(mocks.render).toHaveBeenCalledOnce()
    })

    it('continues with authorized source evidence and records a warning when analysis is unavailable', async () => {
        const executionPlan = plan()
        executionPlan.sourceAssetIds = ['asset-1']
        const failing = new CharacterSheetStrategy({
            ...runtime(),
            evidenceAnalyzer: { analyze: async () => { throw new Error('analysis failed') } },
            panelAssessor: { assess: async () => assessment(false) },
        })

        const result = await failing.execute(context(), executionPlan, {})
        const trace = result.capabilityMediaTrace as { steps: Array<{ stepId: string; issues: string[] }> }

        expect(trace.steps).toContainEqual(expect.objectContaining({
            stepId: 'source-evidence',
            issues: [expect.stringContaining('analysis failed')],
        }))
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
