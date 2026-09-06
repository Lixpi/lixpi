import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const CHARACTER_SHEET_LAYOUT_SKILL_ID = 'global.character-sheet-layout'
export const CHARACTER_SHEET_LAYOUT_RESOURCE_ID = 'character-sheet-layout'

export const createCharacterSheetLayoutSkillPackage = (storage: InstructionSkillStorage) => {
    return createInstructionSkillPackage(
        {
            capabilityId: CHARACTER_SHEET_LAYOUT_SKILL_ID,
            name: 'Character Sheet Layout',
            description: 'Provider-neutral panel graph and deterministic composition constraints for character sheets.',
            summary: 'Isolated character panels assembled into a deterministic 3840x2560 sheet.',
            tags: ['character', 'layout', 'turnaround'],
            exportName: 'layout',
            resourceId: CHARACTER_SHEET_LAYOUT_RESOURCE_ID,
            resourceName: 'Character Sheet Layout',
            skillFile: new URL('./SKILL.md', import.meta.url),
        },
        storage,
    )
}
