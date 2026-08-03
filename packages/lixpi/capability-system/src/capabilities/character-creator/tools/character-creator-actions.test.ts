import { describe, expect, it } from 'vitest'

import { CapabilityActionRegistry } from '../../../backend/capability-action-registry.ts'
import { registerCharacterCreatorActions } from './character-creator-actions.ts'

function executionContext() {
    return {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        rootCapabilityId: 'global.character-creator',
        runId: 'run-1',
        origin: 'prompt' as const,
        stepId: 'build-render-plan',
        attempt: 1,
        signal: new AbortController().signal,
        plan: {} as never,
        variant: { axis: 'request' as const, variantKey: 'request' as const },
        getResource: () => undefined,
        getRunEvents: () => [],
    }
}

describe('Character Creator actions', () => {
    it('registers only preflight validation and plan construction actions', () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry)

        expect([...registry.allowedActionKeys()]).toEqual([
            'character.validate-request',
            'character.build-render-plan',
        ])
        expect(registry.has('image.generate')).toBe(false)
        expect(registry.has('character-sheet.persist')).toBe(false)
    })

    it('validates and deduplicates optional reference Asset IDs', () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry)

        expect(registry.get('character.validate-request').execute({
            prompt: '  Desert courier  ',
            referenceAssetIds: ['asset-1', 'asset-1', 'asset-2'],
        }, executionContext())).toEqual({
            prompt: 'Desert courier',
            referenceAssetIds: ['asset-1', 'asset-2'],
        })
    })

    it('builds a provider-neutral plan tied to the capability run', async () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry)

        const output = await registry.get('character.build-render-plan').execute({
            prompt: 'Desert courier',
            referenceAssetIds: ['asset-1'],
        }, executionContext()) as Record<string, any>

        expect(output.mediaGenerationMode).toBe('character-creator')
        expect(output.capabilityMediaExecutionPlan).toMatchObject({
            kind: 'character-sheet',
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Desert courier',
            layoutId: 'character-sheet-3840x2560',
            semanticRetryLimit: 1,
        })
        expect(output.capabilityMediaExecutionPlan.panels).toHaveLength(27)
    })

    it('rejects more than eight source Assets', () => {
        const registry = new CapabilityActionRegistry()
        registerCharacterCreatorActions(registry)

        expect(() => registry.get('character.validate-request').execute({
            prompt: 'Character',
            referenceAssetIds: Array.from({ length: 9 }, (_, index) => `asset-${index}`),
        }, executionContext())).toThrow('Character Creator accepts at most 8 reference Assets')
    })
})
