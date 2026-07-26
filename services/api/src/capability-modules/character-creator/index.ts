'use strict'

import type { CapabilityModuleDefinition } from '@lixpi/capability-system/backend'

import { CHARACTER_CREATOR_TOOL_ID } from './character-creator-routing.ts'
import { createCharacterCreatorSkillPackages } from './skills/index.ts'
import {
    createCharacterCreatorToolPackage,
    type CharacterCreatorActionDependencies,
} from './tools/index.ts'

export function createCharacterCreatorModule(
    dependencies: CharacterCreatorActionDependencies,
): CapabilityModuleDefinition {
    return {
        moduleId: 'character-creator',
        name: 'Character Creator',
        normalizedName: 'character creator',
        summary: 'Creates structured multi-view character sheets with explicit reference fidelity.',
        tags: ['character', 'image', 'turnaround'],
        entry: { capabilityId: CHARACTER_CREATOR_TOOL_ID, kind: 'tool' },
        tools: [createCharacterCreatorToolPackage(dependencies)],
        skills: createCharacterCreatorSkillPackages(),
    }
}

export { createCharacterCreatorActionDependencies } from './tools/index.ts'
