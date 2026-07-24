'use strict'

import { createInstructionSkillModule } from '@lixpi/capability-system/backend'

import { capabilityInstructionSkillStorage } from '../../../../capability-system/instruction-skill.ts'

export const CHARACTER_SHEET_LAYOUT_SKILL_ID = 'global.character-sheet-layout'
export const CHARACTER_SHEET_LAYOUT_RESOURCE_ID = 'character-sheet-layout'

export function createCharacterSheetLayoutSkillModule() {
    return createInstructionSkillModule({
        moduleId: 'character-sheet-layout',
        capabilityId: CHARACTER_SHEET_LAYOUT_SKILL_ID,
        name: 'Character Sheet Layout',
        description: 'Fixed multi-view layout and composition constraints for character sheets.',
        summary: 'Fixed portrait, turnaround, and pose layout for one-image character sheets.',
        tags: ['character', 'layout', 'turnaround'],
        catalogVisibility: 'internal',
        exportName: 'layout',
        resourceId: CHARACTER_SHEET_LAYOUT_RESOURCE_ID,
        resourceName: 'Character Sheet Layout',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, capabilityInstructionSkillStorage)
}
