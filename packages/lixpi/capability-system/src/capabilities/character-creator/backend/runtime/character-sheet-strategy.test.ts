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
    sharedState: {
        authoritativePrompt: 'A courier',
        sourceSubjectIdentityClassifications: [],
        capabilityInstructions: [],
        capabilityReferences: [],
        capabilityOutputs: [],
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

    it('executes the configured three-shot barrier chain and carries the first two anchors into the back shot', async () => {
        const executionPlan = plan()
        const result = await strategy(async () => assessment(false)).execute(context(), executionPlan, {})
        const trace = result.capabilityMediaTrace as Record<string, unknown>
        const operationKeys = mocks.render.mock.calls.map(([request]) => request.operationKey)
        const frontRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':body-front:')
        ))?.[0]
        const backRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':body-back:')
        ))?.[0]

        expect(mocks.render).toHaveBeenCalledTimes(executionPlan.panels.length)
        expect(trace.totalProviderOperations).toBe(executionPlan.panels.length)
        expect(trace.panels).toHaveLength(executionPlan.panels.length)
        expect(operationKeys.findIndex(key => key.includes(':head-front-neutral:')))
            .toBeLessThan(operationKeys.findIndex(key => key.includes(':body-front:')))
        expect(operationKeys.findIndex(key => key.includes(':body-front:')))
            .toBeLessThan(operationKeys.findIndex(key => key.includes(':body-back:')))
        expect(frontRequest?.references).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'canonical-anchor',
                fileName: 'GENERATED_IDENTITY_ANCHOR.png',
            }),
        ]))
        expect(backRequest?.references).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'adjacent-angle',
                fileName: 'GENERATED_IDENTITY_ANCHOR.png',
            }),
            expect.objectContaining({
                role: 'canonical-anchor',
                fileName: 'GENERATED_OUTFIT_ANCHOR.png',
            }),
        ]))
        expect(mocks.clear).toHaveBeenCalledOnce()
    })

    it('feeds all three declared anchors, and no unrelated completed shot, into optional shots', async () => {
        const executionPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-optional',
            sourceAssetIds: [],
            userPrompt: 'A courier in four shots',
        })
        const serialStrategy = new CharacterSheetStrategy({
            ...runtime(),
            providerConcurrency: 1,
            panelAssessor: { assess: async () => assessment(false) },
            evidenceAnalyzer: { analyze: async () => ({ medium: 'unknown' }) },
        })

        await serialStrategy.execute(context(), executionPlan, {})

        const profileRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':body-profile:')
        ))?.[0]
        expect(profileRequest?.references.filter(reference => (
            ['canonical-anchor', 'adjacent-angle', 'opposite-angle'].includes(reference.role)
        ))).toEqual([
            expect.objectContaining({
                role: 'adjacent-angle',
                fileName: 'GENERATED_IDENTITY_ANCHOR.png',
            }),
            expect.objectContaining({
                role: 'canonical-anchor',
                fileName: 'GENERATED_OUTFIT_ANCHOR.png',
            }),
            expect.objectContaining({
                role: 'opposite-angle',
                fileName: 'GENERATED_BACK_OUTFIT_ANCHOR.png',
            }),
        ])
    })

    it('applies the authoritative shared request before source fidelity and carries sibling Capability state into every shot', async () => {
        const executionPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Create a character sheet.',
        })
        const executionContext = context()
        executionContext.sharedState = {
            authoritativePrompt: 'Transform the referenced woman into a visibly undead zombie.',
            sourceSubjectIdentityClassifications: ['self'],
            capabilityInstructions: ['Render the transformed character with rough watercolor texture.'],
            capabilityReferences: [{
                imageUrl: `data:image/png;base64,${panelPng.toString('base64')}`,
                traceUrl: '/api/capabilities/watercolor/resources/sample-1',
            }],
            capabilityOutputs: [
                { capabilityId: 'character-creator', runId: 'character-run', output: {} },
                { capabilityId: 'watercolor-style', runId: 'style-run', output: {} },
            ],
        }
        const assess = vi.fn(async () => assessment(false))
        const intentAwareStrategy = new CharacterSheetStrategy({
            ...runtime(),
            evidenceAnalyzer: {
                analyze: async () => ({
                    medium: 'illustration',
                    promptDirectives: ['Make the subject visibly undead.'],
                    promptChangedFeatures: ['skin condition'],
                    facts: [
                        {
                            feature: 'skin condition',
                            value: 'healthy natural skin',
                            visibility: 'observed',
                            sourceAssetId: 'asset-1',
                            targetAngles: ['front'],
                            confidence: 1,
                        },
                        {
                            feature: 'facial identity',
                            value: 'recognizable oval facial structure',
                            visibility: 'observed',
                            sourceAssetId: 'asset-1',
                            targetAngles: ['front'],
                            confidence: 1,
                        },
                    ],
                }),
            },
            panelAssessor: { assess },
        })

        await intentAwareStrategy.execute(executionContext, executionPlan, {})

        const headRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':head-front-neutral:')
        ))?.[0]
        const bodyRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':body-front:')
        ))?.[0]
        const backRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':body-back:')
        ))?.[0]
        expect(headRequest?.prompt).toContain('Transform the referenced woman into a visibly undead zombie.')
        expect(headRequest?.prompt).toContain('rough watercolor texture')
        expect(headRequest?.prompt).toContain('Make the subject visibly undead.')
        expect(headRequest?.prompt).toContain('classified as the requesting user’s own identity')
        expect(headRequest?.prompt).not.toContain('NON-GRAPHIC ZOMBIE DESIGN')
        expect(headRequest?.prompt).not.toContain('pallid mottled skin')
        expect(headRequest?.prompt).toContain('must not suppress any requested visual attribute')
        expect(headRequest?.prompt).toContain('facial identity: recognizable oval facial structure')
        expect(headRequest?.prompt).not.toContain('skin condition: healthy natural skin')
        expect(headRequest?.prompt).not.toContain('Change only the camera, crop, and pose')
        expect(headRequest?.references).toContainEqual(expect.objectContaining({
            role: 'capability-reference',
            fileName: 'CAPABILITY_REFERENCE_1.png',
        }))
        expect(bodyRequest?.prompt).toContain('GENERATED_IDENTITY_ANCHOR.png')
        expect(bodyRequest?.references).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'canonical-anchor' }),
            expect.objectContaining({ role: 'capability-reference' }),
        ]))
        expect(backRequest?.prompt).toContain('GENERATED_OUTFIT_ANCHOR.png')
        expect(backRequest?.prompt).toContain('full-body proportions, outfit construction')
        expect(backRequest?.references).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'canonical-anchor', fileName: 'GENERATED_OUTFIT_ANCHOR.png' }),
            expect.objectContaining({ role: 'adjacent-angle', fileName: 'GENERATED_IDENTITY_ANCHOR.png' }),
        ]))
        expect(assess).toHaveBeenCalledWith(expect.objectContaining({
            authoritativePrompt: 'Transform the referenced woman into a visibly undead zombie.',
            capabilityInstructions: ['Render the transformed character with rough watercolor texture.'],
            capabilityReferenceDataUrls: [expect.stringMatching(/^data:image\/png;base64,/u)],
        }))
    })

    it('preserves a photographic source medium and uses the evidence interpretation of an obvious archetype typo', async () => {
        const executionPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Create a combie character out of this photo.',
        })
        const executionContext = context()
        executionContext.sharedState.authoritativePrompt = 'Create a combie character out of this photo.'
        const analyze = vi.fn(async () => ({
            medium: 'photograph' as const,
            promptDirectives: ['Interpret "combie character" as "zombie character" and make the subject visibly undead.'],
            promptChangedFeatures: ['skin condition'],
            facts: [{
                feature: 'skin condition',
                value: 'healthy natural skin',
                visibility: 'observed' as const,
                sourceAssetId: 'asset-1',
                targetAngles: ['front' as const],
                confidence: 1,
            }],
        }))
        const intentAwareStrategy = new CharacterSheetStrategy({
            ...runtime(),
            evidenceAnalyzer: { analyze },
            panelAssessor: { assess: async () => assessment(false) },
        })

        await intentAwareStrategy.execute(executionContext, executionPlan, {})

        expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
            userPrompt: 'Create a combie character out of this photo.',
        }))
        const headRequest = mocks.render.mock.calls.find(([request]) => (
            request.operationKey.includes(':head-front-neutral:')
        ))?.[0]
        expect(headRequest?.prompt).toContain('Create a combie character out of this photo.')
        expect(headRequest?.prompt).toContain('"zombie character" and make the subject visibly undead')
        expect(headRequest?.prompt).toContain('SOURCE DEPICTION MEDIUM — PHOTOGRAPH')
        expect(headRequest?.prompt).toContain('Preserve a realistic photographic depiction')
        expect(headRequest?.prompt).toContain('does not by itself authorize a depiction-medium or visual-style change')
        expect(headRequest?.prompt).not.toContain('adorable chibi')
        expect(headRequest?.prompt).not.toContain('large head and small body')
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

    it('blocks every later shot when the required outfit anchor fails', async () => {
        mocks.render.mockImplementation(async request => {
            if (request.operationKey.includes(':body-front:')) throw new Error('outfit unavailable')
            return providerResult(request)
        })

        await expect(strategy(async () => assessment(false)).execute(context(), plan(), {}))
            .rejects.toThrow('CHARACTER_SHEET_OUTFIT_ANCHOR_UNAVAILABLE:outfit unavailable')
        expect(mocks.render).toHaveBeenCalledTimes(2)
        expect(mocks.render.mock.calls.some(([request]) => request.operationKey.includes(':body-back:')))
            .toBe(false)
    })

    it('blocks optional shots when the required back outfit anchor fails', async () => {
        const executionPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-optional',
            sourceAssetIds: [],
            userPrompt: 'A courier in four shots',
        })
        mocks.render.mockImplementation(async request => {
            if (request.operationKey.includes(':body-back:')) throw new Error('back outfit unavailable')
            return providerResult(request)
        })

        await expect(strategy(async () => assessment(false)).execute(context(), executionPlan, {}))
            .rejects.toThrow('CHARACTER_SHEET_BACK_ANCHOR_UNAVAILABLE:back outfit unavailable')
        expect(mocks.render).toHaveBeenCalledTimes(3)
        expect(mocks.render.mock.calls.some(([request]) => request.operationKey.includes(':body-profile:')))
            .toBe(false)
    })

    it('rejects models that cannot carry all generated anchors required by the selected graph', async () => {
        const executionContext = context()
        executionContext.imageModel.meta.imageReferenceCapabilities!.maxIdentityReferenceImages = 2
        const executionPlan = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-optional',
            sourceAssetIds: [],
            userPrompt: 'A courier in four shots',
        })

        await expect(strategy(async () => assessment(false)).execute(executionContext, executionPlan, {}))
            .rejects.toThrow('CHARACTER_CREATOR_GENERATED_REFERENCE_BUDGET_UNSUPPORTED')
        expect(mocks.render).not.toHaveBeenCalled()
        expect(mocks.clear).not.toHaveBeenCalled()
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
