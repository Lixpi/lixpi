'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const ACTION_TIMELINE_REFERENCE_FIDELITY_SKILL_ID = 'global.action-timeline-reference-fidelity'

export function createActionTimelineReferenceFidelitySkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: ACTION_TIMELINE_REFERENCE_FIDELITY_SKILL_ID,
        name: 'Action Timeline Reference Fidelity',
        description: 'Rules for preserving cited Asset identity across timeline beats.',
        summary: 'Uses only authorized direct media references and preserves subject identity.',
        tags: ['timeline', 'references'],
        exportName: 'reference-fidelity',
        resourceId: 'action-timeline-reference-fidelity',
        resourceName: 'Action Timeline Reference Fidelity',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
