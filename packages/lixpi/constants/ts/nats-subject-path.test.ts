import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    getNatsSubjectPath,
    NATS_SUBJECTS,
} from './index.ts'

describe('NATS subject paths', () => {
    it('derives identifiers from the constants tree', () => {
        expect(getNatsSubjectPath(subjects => subjects.ORGANIZATION_SUBJECTS.GET_MEMBERSHIP)).toBe('ORGANIZATION_SUBJECTS.GET_MEMBERSHIP')
        expect(getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.GET)).toBe('AI_INTERACTION_SUBJECTS.MEDIA_GENERATION_REQUEST.GET')
    })

    it('preserves the selected alias when two names share a wire subject', () => {
        expect(NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.START).toBe(NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CAPABILITY_RUN.START)
        expect(getNatsSubjectPath(subjects => subjects.CAPABILITY_SUBJECTS.RUN.START)).toBe('CAPABILITY_SUBJECTS.RUN.START')
        expect(getNatsSubjectPath(subjects => subjects.AI_INTERACTION_SUBJECTS.CAPABILITY_RUN.START)).toBe('AI_INTERACTION_SUBJECTS.CAPABILITY_RUN.START')
    })
})
