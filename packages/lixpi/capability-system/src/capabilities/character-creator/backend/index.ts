'use strict'

import type { CapabilityModuleDefinition } from '../../../backend/capability-module.ts'
import type { InstructionSkillStorage } from '../../../backend/instruction-skill.ts'

import {
    CHARACTER_CREATOR_TOOL_ID,
    resolveCharacterCreatorRouting,
} from '../shared/character-creator-routing.ts'
import { createCharacterCreatorSkillPackages } from '../skills/index.ts'
import {
    createCharacterCreatorToolPackage,
    type CharacterCreatorActionDependencies,
    type CharacterCreatorCapabilityStorage,
} from '../tools/index.ts'

export type CharacterCreatorModuleDependencies = CharacterCreatorActionDependencies & {
    capabilityStorage: CharacterCreatorCapabilityStorage & InstructionSkillStorage
}

export function createCharacterCreatorModule(
    dependencies: CharacterCreatorModuleDependencies,
): CapabilityModuleDefinition {
    return {
        moduleId: 'character-creator',
        name: 'Character Creator',
        normalizedName: 'character creator',
        summary: 'Creates structured multi-view character sheets with explicit reference fidelity.',
        tags: ['character', 'image', 'turnaround'],
        entry: { capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' },
        tools: [createCharacterCreatorToolPackage(dependencies, dependencies.capabilityStorage)],
        skills: createCharacterCreatorSkillPackages(dependencies.capabilityStorage),
        routing: {
            resolve: prompt => {
                const route = resolveCharacterCreatorRouting(prompt, undefined)
                return route.isCharacterCreator
                    ? {
                        capabilityId: CHARACTER_CREATOR_TOOL_ID,
                        kind: 'tool',
                        input: {},
                        missingInputFields: [],
                    }
                    : undefined
            },
        },
    }
}

export * from '../tools/index.ts'
export * from '../shared/character-creator-routing.ts'
