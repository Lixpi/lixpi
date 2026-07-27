'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const CHARACTER_SHEET_LAYOUT_SKILL_ID = 'global.character-sheet-layout'
export const CHARACTER_SHEET_LAYOUT_RESOURCE_ID = 'character-sheet-layout'

export function createCharacterSheetLayoutSkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: CHARACTER_SHEET_LAYOUT_SKILL_ID,
        name: 'Character Sheet Layout',
        description: 'Fixed multi-view layout and composition constraints for character sheets.',
        summary: 'Fixed portrait, turnaround, and pose layout for one-image character sheets.',
        tags: ['character', 'layout', 'turnaround'],
        exportName: 'layout',
        resourceId: CHARACTER_SHEET_LAYOUT_RESOURCE_ID,
        resourceName: 'Character Sheet Layout',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
