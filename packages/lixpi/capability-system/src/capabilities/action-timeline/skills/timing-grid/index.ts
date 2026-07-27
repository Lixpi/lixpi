'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const ACTION_TIMELINE_TIMING_GRID_SKILL_ID = 'global.action-timeline-timing-grid'

export function createActionTimelineTimingGridSkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: ACTION_TIMELINE_TIMING_GRID_SKILL_ID,
        name: 'Action Timeline Timing Grid',
        description: 'Rules for writing content into server-calculated timeline slots.',
        summary: 'Keeps action beats aligned to immutable server-owned timing slots.',
        tags: ['timeline', 'timing'],
        exportName: 'timing-grid',
        resourceId: 'action-timeline-timing-grid',
        resourceName: 'Action Timeline Timing Grid',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
