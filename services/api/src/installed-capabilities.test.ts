import {
    describe,
    expect,
    it,
} from 'vitest'

import { createDefaultCapabilityModuleCatalog } from './installed-capabilities.ts'

describe('installed Capability composition', () => {
    it('installs first-class modules with their internal Skill and Tool packages', () => {
        const catalog = createDefaultCapabilityModuleCatalog({
            natsService: {} as never,
            imageRouter: { execute: async () => ({}) } as never,
        })

        expect(catalog.listModuleIds()).toEqual(['character-creator', 'style-extraction', 'action-timeline'])
        expect(catalog.getModule('character-creator')).toMatchObject({
            entry: { capabilityId: 'global.character-creator', kind: 'tool' },
            tools: [{ capabilityId: 'global.character-creator', kind: 'tool' }],
            skills: [
                { capabilityId: 'global.character-sheet-layout', kind: 'skill' },
                { capabilityId: 'global.reference-fidelity', kind: 'skill' },
                { capabilityId: 'global.character-image-prompt', kind: 'skill' },
            ],
        })
        expect(catalog.getModule('style-extraction')).toMatchObject({
            entry: { capabilityId: 'global.style-extraction', kind: 'tool' },
            tools: [{ capabilityId: 'global.style-extraction', kind: 'tool' }],
            skills: [
                { capabilityId: 'global.style-extraction-router', kind: 'skill' },
                { capabilityId: 'global.style-extraction-axes', kind: 'skill' },
                { capabilityId: 'global.style-extraction-synthesis', kind: 'skill' },
            ],
        })
        expect(catalog.getModule('action-timeline')).toMatchObject({
            entry: { capabilityId: 'global.action-timeline', kind: 'tool' },
            tools: [{ capabilityId: 'global.action-timeline', kind: 'tool' }],
            skills: [
                { capabilityId: 'global.action-timeline-timing-grid', kind: 'skill' },
                { capabilityId: 'global.action-timeline-segment-writing', kind: 'skill' },
                { capabilityId: 'global.action-timeline-reference-fidelity', kind: 'skill' },
            ],
        })
    })
})
