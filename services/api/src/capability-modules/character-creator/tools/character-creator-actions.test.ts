import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import {
    CapabilityActionRegistry,
    type CapabilityActionExecutionContext,
} from '@lixpi/capability-system/backend'
import { CHARACTER_CREATOR_CAPABILITY_IDS } from './character-creator-definition.ts'
import { normalizeCharacterSheetAssessment, type CharacterSheetAssessment } from './character-creator-prompt.ts'
import {
    registerCharacterCreatorActions,
    selectFinalCharacterSheet,
    type CharacterCreatorActionDependencies,
} from './character-creator-actions.ts'

function makeAssessment(overrides: Partial<CharacterSheetAssessment> = {}) {
    return normalizeCharacterSheetAssessment({
        isSingleImage: true,
        hasPortrait: true,
        hasFrontView: true,
        hasLeftView: true,
        hasRightView: true,
        hasBackView: true,
        hasThreeQuarterView: true,
        hasWalkingPose: true,
        fullHeightViewsUncropped: true,
        identityConsistent: true,
        outfitConsistent: true,
        labelsCorrect: true,
        issues: [],
        ...overrides,
    })
}

function makeDependencies(): CharacterCreatorActionDependencies {
    return {
        resolveReferences: vi.fn(async ({ assetIds }) => assetIds.map(assetId => ({
            assetId,
            modelUrl: `nats://authorized/${assetId}`,
        }))),
        generateImage: vi.fn(async () => ({ image: { assetCandidateId: 'candidate-1' } })),
        assessSheet: vi.fn(async () => makeAssessment()),
        persistSheet: vi.fn(async () => ({ assetId: 'asset-final' })),
    }
}

function makeContext(): CapabilityActionExecutionContext {
    return {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'organization-1',
        rootCapabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.tool,
        runId: 'run-1',
        origin: 'prompt',
        stepId: 'step-1',
        attempt: 1,
        signal: new AbortController().signal,
        plan: {
            serializable: {
                resolvedManifests: [{
                    capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.tool,
                    manifestBlobHash: 'manifest-hash',
                }],
            },
        } as CapabilityActionExecutionContext['plan'],
        getResource: () => undefined,
        getRunEvents: () => [],
    }
}

describe('Character Creator registered actions', () => {
    it('registers only explicit server action keys and rejects another root Tool', async () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry, makeDependencies())

        expect(registry.allowedActionKeys()).toEqual(new Set([
            'character.validate-request',
            'asset.resolve-references',
            'character.build-prompt',
            'image.generate',
            'character-sheet.validate',
            'character.build-correction-prompt',
            'character-sheet.persist',
        ]))
        expect(registry.get('image.generate').classifyRetry(new TypeError('fetch failed'))).toBe('retryable')
        expect(registry.get('image.generate').classifyRetry(new Error('Stability API error (bad_request)'))).toBe('terminal')
        expect(registry.get('character-sheet.persist').validateOutput({
            assetId: 'asset-candidate',
            validation: { passed: false, correctionAttempts: 1 },
        })).toEqual({ valid: true })
        expect(registry.get('character-sheet.persist').collectCanvasGeometry).toBeUndefined()
        expect(await registry.get('image.generate').authorize({
            ...makeContext(),
            rootCapabilityId: 'global.unrelated-tool',
        }, {})).toBe(false)
    })

    it('normalizes and deduplicates validated request references', async () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry, makeDependencies())
        const output = await registry.get('character.validate-request').execute({
            prompt: '  A desert courier.  ',
            referenceAssetIds: ['asset-a', 'asset-a', 'asset-b'],
        }, makeContext())

        expect(output).toEqual({
            prompt: 'A desert courier.',
            referenceAssetIds: ['asset-a', 'asset-b'],
        })
    })

    it('passes only authorized reference results through the action boundary', async () => {
        const dependencies = makeDependencies()
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry, dependencies)
        const context = makeContext()
        const output = await registry.get('asset.resolve-references').execute({
            referenceAssetIds: ['asset-a'],
        }, context)

        expect(output).toEqual({
            references: [{ assetId: 'asset-a', modelUrl: 'nats://authorized/asset-a' }],
        })
        expect(dependencies.resolveReferences).toHaveBeenCalledWith({
            assetIds: ['asset-a'],
            context,
        })
    })

    it('sends the packaged character-sheet example as an explicit layout reference', async () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry, makeDependencies())

        const output = await registry.get('character.build-prompt').execute({
            prompt: 'Create a character sheet from the attached portrait.',
            referenceAssetIds: ['asset-a'],
            layout: { bytes: new TextEncoder().encode('PORTRAIT, FRONT, LEFT, RIGHT, BACK, 3/4, WALK') },
            referenceFidelity: { bytes: new TextEncoder().encode('Preserve the referenced identity and design.') },
            promptInstructions: { bytes: new TextEncoder().encode('Use one coherent sheet.') },
            oneShotExample: { bytes: new Uint8Array([1, 2, 3]) },
        }, makeContext())

        expect(output.mediaGenerationMode).toBe('character-creator')
        expect(output.preserveUserPrompt).toBe(true)
        expect(output.referenceImages).toEqual(['data:image/jpeg;base64,AQID'])
        expect(output.referenceImageTraceUrls).toEqual([
            `/api/capabilities/${encodeURIComponent(CHARACTER_CREATOR_CAPABILITY_IDS.tool)}/resources/character-sheet-example?manifestBlobHash=manifest-hash`,
        ])
        expect(output.visualInstructions).toContain('Preserve the referenced identity and design.')
    })

    it('loads the checked-in character-sheet example bytes without substituting another image', async () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry, makeDependencies())
        const exampleBytes = await readFile(new URL('./resources/character-sheet-example.jpg', import.meta.url))

        const output = await registry.get('character.build-prompt').execute({
            prompt: 'Create a character sheet.',
            referenceAssetIds: ['asset-a'],
            layout: { bytes: new TextEncoder().encode('layout') },
            referenceFidelity: { bytes: new TextEncoder().encode('fidelity') },
            promptInstructions: { bytes: new TextEncoder().encode('prompt') },
            oneShotExample: { bytes: exampleBytes },
        }, makeContext())
        const encoded = String(output.referenceImages[0]).split(',')[1] ?? ''
        const hash = createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex')

        expect(hash).toBe('388e3c7a398f43b3e2ad9cebf6019d16c95e4a17289fb5b77a94bf62e11acadd')
    })
})

describe('Character Creator final candidate selection', () => {
    it('uses the original passing sheet without a correction attempt', () => {
        const original = { image: { candidate: 'original' } }
        expect(selectFinalCharacterSheet({
            original,
            originalValidation: makeAssessment(),
        })).toEqual({
            candidate: original,
            validation: makeAssessment(),
            correctionAttempts: 0,
        })
    })

    it('uses one passing correction', () => {
        const original = { image: { candidate: 'original' } }
        const correction = { image: { candidate: 'correction' } }
        const failed = makeAssessment({ hasBackView: false, issues: ['Missing back view'] })
        const passed = makeAssessment()

        expect(selectFinalCharacterSheet({
            original,
            originalValidation: failed,
            correction,
            correctionValidation: passed,
        })).toEqual({
            candidate: correction,
            validation: passed,
            correctionAttempts: 1,
        })
    })

    it('persists the higher-scoring candidate when the bounded correction still fails validation', () => {
        const original = { image: { candidate: 'original' } }
        const correction = { image: { candidate: 'correction' } }
        const originalValidation = makeAssessment({
            hasBackView: false,
            issues: ['Missing back view'],
        })
        const correctionValidation = makeAssessment({
            hasBackView: false,
            hasWalkingPose: false,
            issues: ['Missing back view', 'Missing walking pose'],
        })

        expect(selectFinalCharacterSheet({
            original,
            originalValidation,
            correction,
            correctionValidation,
        })).toEqual({
            candidate: original,
            validation: originalValidation,
            correctionAttempts: 1,
        })
    })
})
