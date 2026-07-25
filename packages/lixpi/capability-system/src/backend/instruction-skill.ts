'use strict'

import { readFile } from 'node:fs/promises'

import {
    type CapabilityCatalogVisibility,
    type CapabilityManifest,
    type CapabilityReference,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
} from '@lixpi/constants'

import type {
    CapabilityModuleSeedContext,
    SkillModule,
} from './capability-module.ts'
export type InstructionSkillDefinition = {
    moduleId: string
    capabilityId: string
    name: string
    description: string
    summary: string
    tags: string[]
    catalogVisibility?: CapabilityCatalogVisibility
    exportName: string
    resourceId: string
    resourceName: string
    skillFile: URL
    references?: CapabilityReference[]
}

export type InstructionSkillStorage = {
    storeResource: (input: {
        storageOwnerId: string
        resourceId: string
        bytes: Uint8Array
        mediaType: CapabilityResourceMediaType
        role: CapabilityResourceRole
        name?: string
    }) => Promise<CapabilityResourceRef>
    seedBuiltInCapability: (input: {
        manifest: CapabilityManifest
        summary: string
        tags: string[]
        storageOwnerId?: string
        allowedActions: ReadonlySet<string>
        catalogVisibility?: CapabilityCatalogVisibility
    }) => Promise<unknown>
}

export function createInstructionSkillModule(
    definition: InstructionSkillDefinition,
    storage: InstructionSkillStorage,
): SkillModule {
    return {
        kind: 'skill',
        moduleId: definition.moduleId,
        seed: async (context: CapabilityModuleSeedContext): Promise<void> => {
            await seedInstructionSkill(definition, storage, context.allowedActions)
        },
    }
}

async function seedInstructionSkill(
    definition: InstructionSkillDefinition,
    storage: InstructionSkillStorage,
    allowedActions: ReadonlySet<string>,
    storageOwnerId = 'system',
): Promise<void> {
    const resource = await storage.storeResource({
        storageOwnerId,
        resourceId: definition.resourceId,
        bytes: await readFile(definition.skillFile),
        mediaType: 'text/markdown',
        role: 'instructions',
        name: definition.resourceName,
    })
    await storage.seedBuiltInCapability({
        allowedActions,
        manifest: buildInstructionSkillManifest(definition, resource),
        summary: definition.summary,
        tags: definition.tags,
        catalogVisibility: definition.catalogVisibility,
        storageOwnerId,
    })
}

function buildInstructionSkillManifest(
    definition: InstructionSkillDefinition,
    resource: CapabilityResourceRef,
) {
    return {
        schemaVersion: 1 as const,
        capabilityId: definition.capabilityId,
        kind: 'skill' as const,
        name: definition.name,
        description: definition.description,
        references: definition.references ?? [],
        resources: [resource],
        exports: {
            instructions: {
                [definition.exportName]: { resourceIds: [resource.resourceId] },
            },
        },
    }
}
