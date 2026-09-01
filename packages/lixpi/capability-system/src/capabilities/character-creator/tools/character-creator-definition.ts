import { readFile } from 'node:fs/promises'

import {
    type CapabilityManifest,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
} from '@lixpi/constants'
import {
    type CapabilityPackageSeedContext,
} from '../../../backend/capability-module.ts'
import {
    CHARACTER_IMAGE_PROMPT_SKILL_ID,
    CHARACTER_SHEET_LAYOUT_SKILL_ID,
    REFERENCE_FIDELITY_SKILL_ID,
} from '../skills/index.ts'
import { CHARACTER_CREATOR_TOOL_ID } from '../shared/character-creator-routing.ts'

export type CharacterCreatorCapabilityStorage = {
    storeResource: (input: {
        storageOwnerId: string
        resourceId: string
        bytes: Uint8Array
        mediaType: CapabilityResourceMediaType
        role: CapabilityResourceRole
        name: string
    }) => Promise<CapabilityResourceRef>
    seedBuiltInCapability: (input: {
        allowedActions: ReadonlySet<string>
        manifest: CapabilityManifest
        summary: string
        tags: string[]
        parentModuleId: string
        catalogExposure: 'module-internal'
        storageOwnerId: string
    }) => Promise<unknown>
}

export const CHARACTER_CREATOR_CAPABILITY_IDS = {
    tool: CHARACTER_CREATOR_TOOL_ID,
    layoutSkill: CHARACTER_SHEET_LAYOUT_SKILL_ID,
    referenceFidelitySkill: REFERENCE_FIDELITY_SKILL_ID,
    imagePromptSkill: CHARACTER_IMAGE_PROMPT_SKILL_ID,
} as const

type ResourceSource = {
    resourceId: string
    fileName: string
    mediaType: CapabilityResourceMediaType
    role: CapabilityResourceRole
    name: string
}

const inputSchemaSource: ResourceSource = {
    resourceId: 'character-creator-input-schema',
    fileName: 'character-creator-input.schema.json',
    mediaType: 'application/schema+json',
    role: 'schema',
    name: 'Character Creator Input Schema',
}

const outputSchemaSource: ResourceSource = {
    resourceId: 'character-creator-output-schema',
    fileName: 'character-creator-output.schema.json',
    mediaType: 'application/schema+json',
    role: 'schema',
    name: 'Character Creator Output Schema',
}

export async function seedCharacterCreatorTool(
    context: CapabilityPackageSeedContext,
    storage: CharacterCreatorCapabilityStorage,
    storageOwnerId = 'system',
): Promise<void> {
    const inputSchema = await storeToolResource(storage, storageOwnerId, inputSchemaSource)
    const outputSchema = await storeToolResource(storage, storageOwnerId, outputSchemaSource)
    await storage.seedBuiltInCapability({
        allowedActions: context.allowedActions,
        manifest: buildCharacterCreatorManifest({ inputSchema, outputSchema }),
        summary: 'Plans configurable 3-to-10-shot character sheets with progressive results and no automatic retries.',
        tags: ['character', 'image', 'turnaround', 'global'],
        parentModuleId: context.parentModuleId,
        catalogExposure: context.catalogExposure,
        storageOwnerId,
    })
}

export function buildCharacterCreatorManifest(resources: {
    inputSchema: CapabilityResourceRef
    outputSchema: CapabilityResourceRef
}): CapabilityManifest {
    return {
        schemaVersion: 1,
        capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.tool,
        kind: 'tool',
        name: 'Character Creator',
        description: 'Use for a request to create, design, or develop a character sheet. It uses a required three-shot identity-and-turnaround plan and accepts 3 to 10 user-prioritized shots. Every shot runs once and the final sheet contains imagery only.',
        references: [
            { capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.layoutSkill, kind: 'skill', import: ['layout'] },
            { capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.referenceFidelitySkill, kind: 'skill', import: ['reference-fidelity'] },
            { capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.imagePromptSkill, kind: 'skill', import: ['image-prompt'] },
        ],
        resources: [resources.inputSchema, resources.outputSchema],
        tool: {
            toolType: 'character-creator',
            inputSchema: resources.inputSchema,
            outputSchema: resources.outputSchema,
            executionPolicy: 'required',
            executionMultiplicity: 'once',
            modelAxisPolicy: {
                reasoning: 'first-selected',
                image: 'all-selected',
                video: 'ignore',
                outputMode: 'continue-media-generation',
            },
            workflow: {
                steps: [
                    {
                        stepId: 'validate-request',
                        title: 'Validate request',
                        action: 'character.validate-request',
                        dependsOn: [],
                        input: {
                            prompt: { source: 'input', path: ['prompt'] },
                            referenceAssetIds: { source: 'input', path: ['referenceAssetIds'] },
                        },
                        progress: {},
                    },
                    {
                        stepId: 'build-render-plan',
                        title: 'Build character render plan',
                        action: 'character.build-render-plan',
                        dependsOn: ['validate-request'],
                        input: {
                            prompt: { source: 'step', stepId: 'validate-request', path: ['prompt'] },
                            referenceAssetIds: { source: 'step', stepId: 'validate-request', path: ['referenceAssetIds'] },
                        },
                        progress: {},
                    },
                ],
                outputs: {
                    mediaGenerationMode: { source: 'step', stepId: 'build-render-plan', path: ['mediaGenerationMode'] },
                    preserveUserPrompt: { source: 'step', stepId: 'build-render-plan', path: ['preserveUserPrompt'] },
                    capabilityMediaExecutionPlan: { source: 'step', stepId: 'build-render-plan', path: ['capabilityMediaExecutionPlan'] },
                },
            },
        },
    }
}

async function storeToolResource(
    storage: CharacterCreatorCapabilityStorage,
    storageOwnerId: string,
    source: ResourceSource,
): Promise<CapabilityResourceRef> {
    const bytes = await readFile(new URL(`./resources/${source.fileName}`, import.meta.url))
    return await storage.storeResource({
        storageOwnerId,
        resourceId: source.resourceId,
        bytes,
        mediaType: source.mediaType,
        role: source.role,
        name: source.name,
    })
}
