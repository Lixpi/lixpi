import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const createMediaSequenceEditingSkill = (storage: InstructionSkillStorage) =>
    createInstructionSkillPackage(
        {
            capabilityId: 'global.media-sequence-editing',
            name: 'Sequence Editing',
            description: 'Edit source media with rational timing and conflict-aware patches.',
            summary: 'Sequence timing, source selection, locks, and export rules.',
            tags: ['sequence', 'editing'],
            exportName: 'sequence-editing',
            resourceId: 'sequence-editing-instructions',
            resourceName: 'Sequence Editing',
            agentSkillName: 'media-sequence-editing',
            skillFile: new URL('./SKILL.md', import.meta.url),
        },
        storage,
    )
