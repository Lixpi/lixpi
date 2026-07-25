import { describe, expect, it } from 'vitest'

import {
    CAPABILITY_REFERENCE_NODE_TYPE,
    normalizeCapabilityReferenceAttrs,
    toCapabilityPromptReference,
} from './capability-reference.ts'
import { schema } from './base-schema.ts'

describe('Capability reference contract', () => {
    it('normalizes stable atom attributes while retaining cosmetic display text', () => {
        const attrs = normalizeCapabilityReferenceAttrs({
            capabilityId: ' cap-character-creator ',
            kind: 'tool',
            displayName: ' Character Creator ',
        })

        expect(CAPABILITY_REFERENCE_NODE_TYPE).toBe('capability_reference')
        expect(attrs).toEqual({
            capabilityId: 'cap-character-creator',
            kind: 'tool',
            displayName: 'Character Creator',
        })
    })

    it('rejects missing IDs, invalid kinds, and empty display names', () => {
        expect(normalizeCapabilityReferenceAttrs({ kind: 'tool', displayName: 'Tool' })).toBeNull()
        expect(normalizeCapabilityReferenceAttrs({ capabilityId: 'cap', kind: 'feature', displayName: 'Tool' })).toBeNull()
        expect(normalizeCapabilityReferenceAttrs({ capabilityId: 'cap', kind: 'skill', displayName: ' ' })).toBeNull()
    })

    it('strips cosmetic display metadata from the submitted prompt reference', () => {
        expect(toCapabilityPromptReference({
            capabilityId: 'cap-layout',
            kind: 'skill',
            displayName: 'Renamed Layout Skill',
        })).toEqual({
            capabilityId: 'cap-layout',
            kind: 'skill',
        })
    })

    it('serializes and parses the shared inline atom by stable ID and kind', () => {
        const node = schema.nodes.capability_reference.create({
            capabilityId: 'cap-character-creator',
            kind: 'tool',
            displayName: 'Character Creator',
        })
        const dom = schema.nodes.capability_reference.spec.toDOM!(node) as Array<unknown>
        const attrs = dom[1] as Record<string, string>

        expect(schema.nodes.capability_reference.isAtom).toBe(true)
        expect(attrs['data-capability-id']).toBe('cap-character-creator')
        expect(attrs['data-capability-kind']).toBe('tool')

        const parseRule = schema.nodes.capability_reference.spec.parseDOM![0]!
        const parsed = parseRule.getAttrs!({
            getAttribute(name: string): string | null {
                return attrs[name] ?? null
            },
        } as HTMLElement)
        expect(parsed).toEqual({
            capabilityId: 'cap-character-creator',
            kind: 'tool',
            displayName: 'Character Creator',
        })
    })
})
