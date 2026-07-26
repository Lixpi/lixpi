'use strict'

import { readFile } from 'node:fs/promises'

import {
    type CapabilityManifest,
    type CapabilityPackageExposure,
    type CapabilityReference,
    type CapabilityResourceMediaType,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
} from '@lixpi/constants'

import type {
    CapabilityPackageSeedContext,
    CapabilitySkillPackageInstaller,
} from './capability-module.ts'
export type InstructionSkillDefinition = {
    capabilityId: string
    name: string
    description: string
    summary: string
    tags: string[]
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
        parentModuleId?: string
        catalogExposure: CapabilityPackageExposure
    }) => Promise<unknown>
}

export function createInstructionSkillPackage(
    definition: InstructionSkillDefinition,
    storage: InstructionSkillStorage,
): CapabilitySkillPackageInstaller {
    return {
        kind: 'skill',
        capabilityId: definition.capabilityId,
        seed: async (context: CapabilityPackageSeedContext): Promise<void> => {
            await seedInstructionSkill(definition, storage, context)
        },
    }
}

async function seedInstructionSkill(
    definition: InstructionSkillDefinition,
    storage: InstructionSkillStorage,
    context: CapabilityPackageSeedContext,
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
        allowedActions: context.allowedActions,
        manifest: buildInstructionSkillManifest(definition, resource),
        summary: definition.summary,
        tags: definition.tags,
        parentModuleId: context.parentModuleId,
        catalogExposure: context.catalogExposure,
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
