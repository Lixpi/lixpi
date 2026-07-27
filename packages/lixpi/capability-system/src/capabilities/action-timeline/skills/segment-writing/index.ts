'use strict'

import {
    createInstructionSkillPackage,
    type InstructionSkillStorage,
} from '../../../../backend/instruction-skill.ts'

export const ACTION_TIMELINE_SEGMENT_WRITING_SKILL_ID = 'global.action-timeline-segment-writing'

export function createActionTimelineSegmentWritingSkillPackage(storage: InstructionSkillStorage) {
    return createInstructionSkillPackage({
        capabilityId: ACTION_TIMELINE_SEGMENT_WRITING_SKILL_ID,
        name: 'Action Timeline Segment Writing',
        description: 'Rules for concise, continuous, visually specific action beats.',
        summary: 'Writes coherent visual action across sequential segments.',
        tags: ['timeline', 'writing'],
        exportName: 'segment-writing',
        resourceId: 'action-timeline-segment-writing',
        resourceName: 'Action Timeline Segment Writing',
        skillFile: new URL('./SKILL.md', import.meta.url),
    }, storage)
}
