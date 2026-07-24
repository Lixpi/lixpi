'use strict'

import { createInstructionSkillModule } from '@lixpi/capability-system/backend'

import { capabilityInstructionSkillStorage } from '../../../../capability-system/instruction-skill.ts'

export const CHARACTER_IMAGE_PROMPT_SKILL_ID = 'global.character-image-prompt'
export const CHARACTER_IMAGE_PROMPT_RESOURCE_ID = 'character-image-prompt'

export function createCharacterImagePromptSkillModule() {
    return createInstructionSkillModule({
        moduleId: 'character-image-prompt',
        capabilityId: CHARACTER_IMAGE_PROMPT_SKILL_ID,
        name: 'Character Image Prompt',
        description: 'Provider-neutral prompt construction for deterministic character sheets.',
        summary: 'Builds one provider-neutral prompt for a complete character sheet.',
        tags: ['character', 'prompt', 'image'],
        catalogVisibility: 'internal',
        exportName: 'image-prompt',
        resourceId: CHARACTER_IMAGE_PROMPT_RESOURCE_ID,
        resourceName: 'Character Image Prompt',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, capabilityInstructionSkillStorage)
}
