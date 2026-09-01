import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    type CapabilityManifest,
} from '@lixpi/constants'

import {
    buildCapabilityScopeAndOwner,
    buildCapabilitySearchKey,
    normalizeCapabilityName,
    serializeCapabilityManifest,
} from './capability.ts'

const decoder = new TextDecoder()

describe('Capability storage primitives', () => {
    it('serializes equivalent manifests to identical canonical bytes', () => {
        const left = {
            schemaVersion: 1,
            capabilityId: 'skill-one',
            kind: 'skill',
            name: 'One',
            description: 'Description',
            references: [],
            resources: [],
        } satisfies CapabilityManifest
        const right = {
            resources: [],
            references: [],
            description: 'Description',
            name: 'One',
            kind: 'skill',
            capabilityId: 'skill-one',
            schemaVersion: 1,
        } satisfies CapabilityManifest

        expect(serializeCapabilityManifest(left)).toEqual(serializeCapabilityManifest(right))
        expect(decoder.decode(serializeCapabilityManifest(left))).toBe(
            '{"capabilityId":"skill-one","description":"Description","kind":"skill","name":"One","references":[],"resources":[],"schemaVersion":1}',
        )
    })

    it('normalizes names and constructs prefix-query keys deterministically', () => {
        const normalizedName = normalizeCapabilityName('  Character   Creator  ')

        expect(normalizedName).toBe('character creator')
        expect(buildCapabilitySearchKey('tool', normalizedName, 'cap-character')).toBe(
            'tool#character creator#cap-character',
        )
        expect(buildCapabilityScopeAndOwner('global', 'ignored')).toBe('global#system')
        expect(buildCapabilityScopeAndOwner('organization', 'org-7')).toBe('organization#org-7')
    })
})
