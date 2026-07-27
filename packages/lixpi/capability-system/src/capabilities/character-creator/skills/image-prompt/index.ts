'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const CHARACTER_IMAGE_PROMPT_SKILL_ID = 'global.character-image-prompt'
export const CHARACTER_IMAGE_PROMPT_RESOURCE_ID = 'character-image-prompt'

export function createCharacterImagePromptSkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: CHARACTER_IMAGE_PROMPT_SKILL_ID,
        name: 'Character Image Prompt',
        description: 'Provider-neutral prompt construction for deterministic character sheets.',
        summary: 'Builds one provider-neutral prompt for a complete character sheet.',
        tags: ['character', 'prompt', 'image'],
        exportName: 'image-prompt',
        resourceId: CHARACTER_IMAGE_PROMPT_RESOURCE_ID,
        resourceName: 'Character Image Prompt',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
