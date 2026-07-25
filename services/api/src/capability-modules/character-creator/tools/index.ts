'use strict'

import type {
    CapabilityActionRegistry,
    CapabilityPackageSeedContext,
    CapabilityToolPackageInstaller,
} from '@lixpi/capability-system/backend'
import {
    registerCharacterCreatorActions,
    type CharacterCreatorActionDependencies,
} from './character-creator-actions.ts'
import { seedCharacterCreatorTool } from './character-creator-definition.ts'
import { CHARACTER_CREATOR_TOOL_ID } from '../character-creator-routing.ts'

export function createCharacterCreatorToolPackage(
    dependencies: CharacterCreatorActionDependencies,
): CapabilityToolPackageInstaller {
    return {
        kind: 'tool',
        capabilityId: CHARACTER_CREATOR_TOOL_ID,
        registerActions: (registry: CapabilityActionRegistry): void => {
            registerCharacterCreatorActions(registry, dependencies)
        },
        seed: async (context: CapabilityPackageSeedContext): Promise<void> => {
            await seedCharacterCreatorTool(context)
        },
    }
}

export * from './character-creator-actions.ts'
export * from './character-creator-definition.ts'
export * from './character-creator-prompt.ts'
export * from './character-creator-runtime.ts'
