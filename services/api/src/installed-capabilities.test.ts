import {
    describe,
    expect,
    it,
    vi,
    afterEach,
} from 'vitest'

import { createDefaultCapabilityModuleCatalog } from './installed-capabilities.ts'

describe('installed Capability composition', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('installs first-class modules with their internal Skill and Tool packages', () => {
        vi.stubGlobal('dynamoDBService', {})
        const catalog = createDefaultCapabilityModuleCatalog({})

        expect(catalog.listModuleIds()).toEqual(['media-pipeline'])
        expect(catalog.getModule('media-pipeline')?.tools?.map(tool => tool.capabilityId)).toEqual([
            'global.get-pipeline', 'global.save-pipeline', 'global.save-pipeline-matrix', 'global.prepare-pipeline-matrix', 'global.submit-pipeline', 'global.retry-pipeline',
        ])
        expect(catalog.getExtension('media-pipeline', 'operations')).toMatchObject({
            advance: expect.any(Function),
            cancel: expect.any(Function),
        })
    })
})
