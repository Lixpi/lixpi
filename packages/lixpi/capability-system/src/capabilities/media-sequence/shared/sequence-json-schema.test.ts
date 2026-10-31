import { describe, expect, it } from 'vitest'

import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'
import { sequenceFixture } from './sequence-fixture.ts'
import { sequencePatchRequestSchema } from './sequence-json-schema.ts'

describe('Sequence tool schema', () => {
    it('describes a complete first assembly and rejects missing clip fields before mutation', () => {
        const fixture = sequenceFixture()
        const request = {
            sequenceId: fixture.sequenceId,
            baseRevision: 1,
            clientMutationId: 'mutation',
            operations: [{
                op: 'add-track',
                track: fixture.tracks[0],
            }, {
                op: 'add-source',
                source: fixture.sources[0],
            }, {
                op: 'insert-clip',
                clip: fixture.clips[0],
            }],
        }
        expect(validateJsonSchemaValue(sequencePatchRequestSchema, request)).toEqual({ valid: true })
        const invalid = structuredClone(request)
        delete (invalid.operations[2].clip as Partial<typeof fixture.clips[number]>).rate
        expect(validateJsonSchemaValue(sequencePatchRequestSchema, invalid).valid).toBe(false)
        expect(validateJsonSchemaValue(sequencePatchRequestSchema, {
            ...request,
            operations: [{
                op: 'move-clip',
                clipId: 'clip',
                start: 1,
            }],
        }).valid).toBe(false)
    })
})
