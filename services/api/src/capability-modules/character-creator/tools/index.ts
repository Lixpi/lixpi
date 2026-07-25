'use strict'

import type {
    CapabilityActionRegistry,
    CapabilityModuleSeedContext,
    ToolModule,
} from '@lixpi/capability-system/backend'
import {
    registerCharacterCreatorActions,
    type CharacterCreatorActionDependencies,
} from './character-creator-actions.ts'
import { seedCharacterCreatorTool } from './character-creator-definition.ts'

export function createCharacterCreatorToolModule(
    dependencies: CharacterCreatorActionDependencies,
): ToolModule {
    return {
        kind: 'tool',
        moduleId: 'character-creator',
        registerActions: (registry: CapabilityActionRegistry): void => {
            registerCharacterCreatorActions(registry, dependencies)
        },
        seed: async (context: CapabilityModuleSeedContext): Promise<void> => {
            await seedCharacterCreatorTool(context.allowedActions)
        },
    }
}

export * from './character-creator-actions.ts'
export * from './character-creator-definition.ts'
export * from './character-creator-prompt.ts'
export * from './character-creator-runtime.ts'
