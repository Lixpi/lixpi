'use strict'

import type {
    CapabilityActionRegistry,
    CapabilityPackageSeedContext,
    CapabilityToolPackageInstaller,
} from '../../../backend/index.ts'
import {
    registerCharacterCreatorActions,
    type CharacterCreatorActionDependencies,
} from './character-creator-actions.ts'
import {
    seedCharacterCreatorTool,
    type CharacterCreatorCapabilityStorage,
} from './character-creator-definition.ts'
import { CHARACTER_CREATOR_TOOL_ID } from '../shared/character-creator-routing.ts'

export function createCharacterCreatorToolPackage(
    dependencies: CharacterCreatorActionDependencies,
    storage: CharacterCreatorCapabilityStorage,
): CapabilityToolPackageInstaller {
    return {
        kind: 'tool',
        capabilityId: CHARACTER_CREATOR_TOOL_ID,
        registerActions: (registry: CapabilityActionRegistry): void => {
            registerCharacterCreatorActions(registry, dependencies)
        },
        seed: async (context: CapabilityPackageSeedContext): Promise<void> => {
            await seedCharacterCreatorTool(context, storage)
        },
    }
}

export * from './character-creator-actions.ts'
export * from './character-creator-definition.ts'
export * from './character-creator-prompt.ts'
