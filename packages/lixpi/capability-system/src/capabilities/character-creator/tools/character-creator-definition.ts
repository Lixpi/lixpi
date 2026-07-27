import { readFile } from 'node:fs/promises'

import {
    type CapabilityManifest,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
} from '@lixpi/constants'
import type { CapabilityPackageSeedContext } from '../../../backend/capability-module.ts'
import {
    CHARACTER_IMAGE_PROMPT_RESOURCE_ID,
    CHARACTER_IMAGE_PROMPT_SKILL_ID,
    CHARACTER_SHEET_LAYOUT_RESOURCE_ID,
    CHARACTER_SHEET_LAYOUT_SKILL_ID,
    REFERENCE_FIDELITY_RESOURCE_ID,
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

const exampleSource: ResourceSource = {
    resourceId: 'character-sheet-example',
    fileName: 'character-sheet-example.jpg',
    mediaType: 'image/jpeg',
    role: 'example',
    name: 'Character Sheet One-Shot Example',
}

export async function seedCharacterCreatorTool(
    context: CapabilityPackageSeedContext,
    storage: CharacterCreatorCapabilityStorage,
    storageOwnerId = 'system',
): Promise<void> {
    const inputSchema = await storeToolResource(storage, storageOwnerId, inputSchemaSource)
    const outputSchema = await storeToolResource(storage, storageOwnerId, outputSchemaSource)
    const example = await storeToolResource(storage, storageOwnerId, exampleSource)
    await storage.seedBuiltInCapability({
        allowedActions: context.allowedActions,
        manifest: buildCharacterCreatorManifest({ inputSchema, outputSchema, example }),
        summary: 'Creates or designs characters through a structured multi-view character-sheet workflow using the selected image-model matrix.',
        tags: ['character', 'image', 'turnaround', 'global'],
        parentModuleId: context.parentModuleId,
        catalogExposure: context.catalogExposure,
        storageOwnerId,
    })
}

export function buildCharacterCreatorManifest(resources: {
    inputSchema: CapabilityResourceRef
    outputSchema: CapabilityResourceRef
    example: CapabilityResourceRef
}): CapabilityManifest {
    return {
        schemaVersion: 1,
        capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.tool,
        kind: 'tool',
        name: 'Character Creator',
        description: 'Use for any request to create, design, or develop a character. Adds structured character-sheet instructions and layout references to ordinary multi-model image generation.',
        references: [
            { capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.layoutSkill, kind: 'skill', import: ['layout'] },
            { capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.referenceFidelitySkill, kind: 'skill', import: ['reference-fidelity'] },
            { capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.imagePromptSkill, kind: 'skill', import: ['image-prompt'] },
        ],
        resources: [resources.inputSchema, resources.outputSchema, resources.example],
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
                        stepId: 'build-prompt',
                        title: 'Build character prompt',
                        action: 'character.build-prompt',
                        dependsOn: ['validate-request'],
                        input: {
                            prompt: { source: 'step', stepId: 'validate-request', path: ['prompt'] },
                            referenceAssetIds: { source: 'step', stepId: 'validate-request', path: ['referenceAssetIds'] },
                            layout: {
                                source: 'resource',
                                capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.layoutSkill,
                                resourceId: CHARACTER_SHEET_LAYOUT_RESOURCE_ID,
                            },
                            referenceFidelity: {
                                source: 'resource',
                                capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.referenceFidelitySkill,
                                resourceId: REFERENCE_FIDELITY_RESOURCE_ID,
                            },
                            promptInstructions: {
                                source: 'resource',
                                capabilityId: CHARACTER_CREATOR_CAPABILITY_IDS.imagePromptSkill,
                                resourceId: CHARACTER_IMAGE_PROMPT_RESOURCE_ID,
                            },
                            oneShotExample: { source: 'resource', resourceId: resources.example.resourceId },
                        },
                        progress: {},
                    },
                ],
                outputs: {
                    mediaGenerationMode: { source: 'step', stepId: 'build-prompt', path: ['mediaGenerationMode'] },
                    preserveUserPrompt: { source: 'step', stepId: 'build-prompt', path: ['preserveUserPrompt'] },
                    visualInstructions: { source: 'step', stepId: 'build-prompt', path: ['visualInstructions'] },
                    referenceImages: { source: 'step', stepId: 'build-prompt', path: ['referenceImages'] },
                    referenceImageTraceUrls: { source: 'step', stepId: 'build-prompt', path: ['referenceImageTraceUrls'] },
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
