import {
    type CapabilityActionRegistry,
    type CapabilityPackageSeedContext,
    type CapabilityToolPackageInstaller,
} from '../../../backend/index.ts'
import { registerCharacterCreatorActions } from './character-creator-actions.ts'
import {
    seedCharacterCreatorTool,
    type CharacterCreatorCapabilityStorage,
} from './character-creator-definition.ts'
import { CHARACTER_CREATOR_TOOL_ID } from '../shared/character-creator-routing.ts'

export const createCharacterCreatorToolPackage = (storage: CharacterCreatorCapabilityStorage): CapabilityToolPackageInstaller => {
    return {
        kind: 'tool',
        capabilityId: CHARACTER_CREATOR_TOOL_ID,
        registerActions: (registry: CapabilityActionRegistry): void => void registerCharacterCreatorActions(registry),
        seed: async (context: CapabilityPackageSeedContext): Promise<void> => void (await seedCharacterCreatorTool(context, storage)),
    }
}

export * from './character-creator-actions.ts'
export * from './character-creator-definition.ts'
