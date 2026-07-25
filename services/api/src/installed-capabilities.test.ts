import { describe, expect, it } from 'vitest'

import { createDefaultCapabilityModuleCatalog } from './installed-capabilities.ts'

describe('installed Capability composition', () => {
    it('installs instruction Skills and executable Tools as separate module kinds', () => {
        const catalog = createDefaultCapabilityModuleCatalog({
            natsService: {} as never,
            imageRouter: { execute: async () => ({}) } as never,
        })

        expect(catalog.listModuleIds()).toEqual({
            skills: [
                'character-sheet-layout',
                'reference-fidelity',
                'character-image-prompt',
                'style-extraction-router',
                'style-extraction-axes',
                'style-extraction-synthesis',
            ],
            tools: [
                'character-creator',
                'style-extraction',
            ],
        })
    })
})
