import {
    describe,
    expect,
    it,
} from 'vitest'

import { validateJsonSchemaValue } from './capability-json-schema.ts'

describe('validateJsonSchemaValue', () => {
    it('validates bounded objects, arrays, and local schema references', () => {
        const schema = {
            type: 'object',
            required: ['subjects'],
            properties: {
                subjects: {
                    type: 'array',
                    minItems: 1,
                    items: { $ref: '#/$defs/subject' },
                },
            },
            additionalProperties: false,
            $defs: {
                subject: {
                    type: 'object',
                    required: ['name'],
                    properties: { name: { type: 'string', minLength: 1 } },
                    additionalProperties: false,
                },
            },
        }

        expect(validateJsonSchemaValue(schema, { subjects: [{ name: 'Maya' }] })).toEqual({ valid: true })
        expect(validateJsonSchemaValue(schema, { subjects: [{ name: '' }], extra: true })).toEqual({
            valid: false,
            errors: expect.arrayContaining([
                '$.subjects[0].name: string is shorter than minLength',
                '$.extra: additional property is not allowed',
            ]),
        })
    })

    it('rejects unresolved and unsafe local references', () => {
        expect(validateJsonSchemaValue({ $ref: '#/$defs/missing' }, 'x')).toEqual({
            valid: false,
            errors: ['$: schema reference #/$defs/missing was not found'],
        })
        expect(validateJsonSchemaValue({ $ref: '#/__proto__/polluted' }, 'x')).toEqual({
            valid: false,
            errors: ['$: schema reference #/__proto__/polluted was not found'],
        })
    })

    it('implements combinators, enums, numeric bounds, and contains-safe equality', () => {
        expect(validateJsonSchemaValue({
            oneOf: [
                { type: 'integer', minimum: 1 },
                { type: 'string', enum: ['auto'] },
            ],
        }, 'auto')).toEqual({ valid: true })
        expect(validateJsonSchemaValue({
            type: 'integer',
            minimum: 1,
            maximum: 3,
        }, 4)).toEqual({
            valid: false,
            errors: ['$: number is above maximum'],
        })
    })
})
