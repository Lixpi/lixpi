import {
    describe,
    expect,
    it,
} from 'vitest'

import { mediaPipelineSharedDefinition } from '@lixpi/capability-system/frontend'

import {
    capabilityArtifactFrontendRegistry,
    capabilityArtifactSharedRegistry,
    getCapabilityArtifactIcon,
} from './installed-capabilities.ts'

describe('installed Capability Artifact frontends', () => {
    it('installs the pipeline Artifact definitions required by output navigation and the library', () => {
        expect(capabilityArtifactSharedRegistry.get('media-pipeline')).toStrictEqual(mediaPipelineSharedDefinition)
        expect(capabilityArtifactFrontendRegistry.require('media-pipeline')).toMatchObject({
            artifactTypeId: 'media-pipeline',
            createCanvasNodeView: expect.any(Function),
            createGeneratedOutputInfoView: expect.any(Function),
            createLibraryItemView: expect.any(Function),
        })
        expect(getCapabilityArtifactIcon('media-pipeline')).toContain('<svg')
    })

    it('keeps Media Sequence out of the installed Artifact registries', () => {
        expect(capabilityArtifactSharedRegistry.get('media-sequence')).toBeUndefined()
        expect(capabilityArtifactFrontendRegistry.get('media-sequence')).toBeUndefined()
    })
})
