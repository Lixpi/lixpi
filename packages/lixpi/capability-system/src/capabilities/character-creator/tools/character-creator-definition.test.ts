import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityResourceRef } from '@lixpi/constants'
import { validateCapabilityManifest } from '@lixpi/capability-system/shared'

const mocks = vi.hoisted(() => ({
    seedBuiltInCapability: vi.fn(),
    storeCapabilityResource: vi.fn(),
}))

import {
    buildCharacterCreatorManifest,
    seedCharacterCreatorTool,
} from './character-creator-definition.ts'

function makeResource(
    resourceId: string,
    mediaType: CapabilityResourceRef['mediaType'],
    role: CapabilityResourceRef['role'],
): CapabilityResourceRef {
    return {
        resourceId,
        blobHash: `sha256:${resourceId}`,
        mediaType,
        role,
    }
}

describe('Character Creator built-in Tool definition', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.storeCapabilityResource.mockImplementation(async (input: {
            resourceId: string
            mediaType: CapabilityResourceRef['mediaType']
            role: CapabilityResourceRef['role']
            bytes: Uint8Array
        }) => ({
            resourceId: input.resourceId,
            blobHash: `sha256:${input.resourceId}`,
            mediaType: input.mediaType,
            role: input.role,
        }))
    })

    it('is a valid allowlisted DAG that prepares the shared media-generation pipeline', () => {
        const manifest = buildCharacterCreatorManifest({
            inputSchema: makeResource('character-creator-input-schema', 'application/schema+json', 'schema'),
            outputSchema: makeResource('character-creator-output-schema', 'application/schema+json', 'schema'),
            example: makeResource('character-sheet-example', 'image/jpeg', 'example'),
        })
        const result = validateCapabilityManifest(manifest, {
            allowedActions: new Set([
                'character.validate-request',
                'character.build-prompt',
            ]),
        })

        expect(result.valid).toBe(true)
        expect(manifest.tool!.workflow.steps).toEqual([
            expect.objectContaining({ stepId: 'validate-request', action: 'character.validate-request' }),
            expect.objectContaining({ stepId: 'build-prompt', action: 'character.build-prompt' }),
        ])
    })

    it('imports the three component Skills and exposes shared media-generation context', () => {
        const manifest = buildCharacterCreatorManifest({
            inputSchema: makeResource('character-creator-input-schema', 'application/schema+json', 'schema'),
            outputSchema: makeResource('character-creator-output-schema', 'application/schema+json', 'schema'),
            example: makeResource('character-sheet-example', 'image/jpeg', 'example'),
        })

        expect(manifest.references.map((reference) => reference.import?.[0])).toEqual([
            'layout',
            'reference-fidelity',
            'image-prompt',
        ])
        expect(manifest.tool!.workflow.outputs.mediaGenerationMode).toEqual({
            source: 'step',
            stepId: 'build-prompt',
            path: ['mediaGenerationMode'],
        })
        expect(manifest.tool!.workflow.outputs.preserveUserPrompt).toEqual(expect.objectContaining({
            stepId: 'build-prompt',
        }))
        expect(manifest.tool!.workflow.outputs.referenceImages).toEqual(expect.objectContaining({
            stepId: 'build-prompt',
        }))
    })

    it('loads and seeds every packaged resource with the example image MIME type', async () => {
        await seedCharacterCreatorTool({
            allowedActions: new Set([
                'character.validate-request',
                'asset.resolve-references',
                'character.build-prompt',
                'image.generate',
                'character-sheet.validate',
                'character.build-correction-prompt',
                'character-sheet.persist',
            ]),
            parentModuleId: 'character-creator',
            catalogExposure: 'module-internal',
        }, {
            storeResource: mocks.storeCapabilityResource,
            seedBuiltInCapability: mocks.seedBuiltInCapability,
        })

        expect(mocks.storeCapabilityResource).toHaveBeenCalledTimes(3)
        expect(mocks.storeCapabilityResource).toHaveBeenCalledWith(expect.objectContaining({
            resourceId: 'character-sheet-example',
            mediaType: 'image/jpeg',
            role: 'example',
            bytes: expect.any(Uint8Array),
        }))
        expect(mocks.seedBuiltInCapability).toHaveBeenCalledWith(expect.objectContaining({
            manifest: expect.objectContaining({
                resources: expect.arrayContaining([
                    expect.objectContaining({
                        resourceId: 'character-sheet-example',
                        mediaType: 'image/jpeg',
                    }),
                ]),
            }),
        }))
    })
})
