import {
    type CapabilitySkillPackageInstaller,
} from '../../../backend/capability-module.ts'
import {
    type InstructionSkillStorage,
} from '../../../backend/instruction-skill.ts'
import { createCharacterImagePromptSkillPackage } from './image-prompt/index.ts'
import { createReferenceFidelitySkillPackage } from './reference-fidelity/index.ts'
import { createCharacterSheetLayoutSkillPackage } from './sheet-layout/index.ts'

export {
    CHARACTER_IMAGE_PROMPT_RESOURCE_ID,
    CHARACTER_IMAGE_PROMPT_SKILL_ID,
} from './image-prompt/index.ts'
export {
    REFERENCE_FIDELITY_RESOURCE_ID,
    REFERENCE_FIDELITY_SKILL_ID,
} from './reference-fidelity/index.ts'
export {
    CHARACTER_SHEET_LAYOUT_RESOURCE_ID,
    CHARACTER_SHEET_LAYOUT_SKILL_ID,
} from './sheet-layout/index.ts'

export const createCharacterCreatorSkillPackages = (storage: InstructionSkillStorage): CapabilitySkillPackageInstaller[] => {
    return [
        createCharacterSheetLayoutSkillPackage(storage),
        createReferenceFidelitySkillPackage(storage),
        createCharacterImagePromptSkillPackage(storage),
    ]
}
