import { describe, expect, it, vi } from 'vitest'

import type { CapabilityManifest, CapabilityResourceRef } from '@lixpi/constants'

import { createInstructionSkillModule } from './instruction-skill.ts'

describe('createInstructionSkillModule', () => {
    it('loads instructions and delegates persistence through one injected adapter', async () => {
        const resource: CapabilityResourceRef = {
            resourceId: 'instructions',
            blobHash: 'instructions-hash',
            mediaType: 'text/markdown',
            role: 'instructions',
            name: 'Instructions',
        }
        const storeResource = vi.fn(async () => resource)
        const seedBuiltInCapability = vi.fn(async () => undefined)
        const module = createInstructionSkillModule({
            moduleId: 'test-skill',
            capabilityId: 'global.test-skill',
            name: 'Test Skill',
            description: 'Test instructions.',
            summary: 'Test instructions.',
            tags: ['test'],
            exportName: 'instructions',
            resourceId: 'instructions',
            resourceName: 'Instructions',
            skillFile: new URL('./fixtures/instruction-skill.md', import.meta.url),
        }, {
            storeResource,
            seedBuiltInCapability,
        })

        await module.seed({ allowedActions: new Set(['test.action']) })

        expect(storeResource).toHaveBeenCalledWith(expect.objectContaining({
            storageOwnerId: 'system',
            resourceId: 'instructions',
            mediaType: 'text/markdown',
            role: 'instructions',
            bytes: expect.any(Uint8Array),
        }))
        const seeded = seedBuiltInCapability.mock.calls[0]?.[0]
        expect(seeded?.allowedActions).toEqual(new Set(['test.action']))
        expect((seeded?.manifest as CapabilityManifest).exports).toEqual({
            instructions: {
                instructions: { resourceIds: ['instructions'] },
            },
        })
    })
})
