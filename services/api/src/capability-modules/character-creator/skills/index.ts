'use strict'

import type { SkillModule } from '@lixpi/capability-system/backend'
import { createCharacterImagePromptSkillModule } from './image-prompt/index.ts'
import { createReferenceFidelitySkillModule } from './reference-fidelity/index.ts'
import { createCharacterSheetLayoutSkillModule } from './sheet-layout/index.ts'

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

export function createCharacterCreatorSkillModules(): SkillModule[] {
    return [
        createCharacterSheetLayoutSkillModule(),
        createReferenceFidelitySkillModule(),
        createCharacterImagePromptSkillModule(),
    ]
}
