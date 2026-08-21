import { describe, expect, it } from 'vitest'

import { buildCharacterCreatorManifest } from './character-creator-definition.ts'

const resource = (resourceId: string) => ({
    resourceId,
    blobHash: `sha256:${'a'.repeat(64)}`,
    mediaType: 'application/schema+json' as const,
    role: 'schema' as const,
})

describe('Character Creator definition', () => {
    it('runs validation then emits a media execution plan without provider or persistence actions', () => {
        const manifest = buildCharacterCreatorManifest({
            inputSchema: resource('input'),
            outputSchema: resource('output'),
        })
        const actions = manifest.tool?.workflow.steps.map(step => step.action)

        expect(actions).toEqual(['character.validate-request', 'character.build-render-plan'])
        expect(actions).not.toContain('image.generate')
        expect(actions).not.toContain('character-sheet.persist')
        expect(manifest.tool?.workflow.outputs).toHaveProperty('capabilityMediaExecutionPlan')
        expect(manifest.resources).toHaveLength(2)
    })
})
