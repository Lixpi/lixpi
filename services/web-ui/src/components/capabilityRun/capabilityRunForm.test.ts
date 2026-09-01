import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    coerceCapabilityFormValue,
    readCapabilityRunForm,
} from '$src/components/capabilityRun/capabilityRunForm.ts'
import {
    type CapabilityInputSchema,
} from '$src/services/capability-catalog-client.ts'

describe('Capability run form', () => {
    const schema: CapabilityInputSchema = {
        type: 'object',
        required: ['prompt'],
        properties: {
            prompt: { type: 'string', title: 'Prompt' },
            count: { type: 'integer', default: 2 },
            preserveIdentity: { type: 'boolean' },
            references: { type: 'array', items: { type: 'string' } },
        },
    }

    it('coerces scalar and array values from controls', () => {
        expect(coerceCapabilityFormValue({ type: 'number' }, '3.5')).toBe(3.5)
        expect(coerceCapabilityFormValue({ type: 'boolean' }, 'on')).toBe(true)
        expect(coerceCapabilityFormValue({ type: 'array', items: { type: 'string' } }, 'a, b')).toEqual(['a', 'b'])
    })

    it('builds schema-shaped run input and applies defaults', () => {
        const formData = new FormData()
        formData.set('prompt', 'Desert courier')
        formData.set('preserveIdentity', 'on')
        formData.set('references', 'asset-1, asset-2')

        expect(readCapabilityRunForm(schema, formData)).toEqual({
            errors: [],
            value: {
                prompt: 'Desert courier',
                count: 2,
                preserveIdentity: true,
                references: ['asset-1', 'asset-2'],
            },
        })
    })

    it('rejects a missing required field', () => {
        expect(readCapabilityRunForm(schema, new FormData()).errors).toEqual(['Prompt is required.'])
    })

    it('rejects invalid numeric values instead of omitting them', () => {
        const formData = new FormData()
        formData.set('prompt', 'Courier')
        formData.set('count', 'many')
        expect(readCapabilityRunForm(schema, formData).errors).toEqual(['count must be a number.'])
    })
})
