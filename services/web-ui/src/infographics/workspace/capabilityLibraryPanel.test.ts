import { describe, expect, it, vi } from 'vitest'

import {
    createCapabilityLibraryPanel,
    mergeCapabilityCatalogPage,
} from '$src/infographics/workspace/capabilityLibraryPanel.ts'
import type {
    CapabilityCatalogItem,
    CapabilityDetails,
} from '$src/services/capability-catalog-client.ts'

function item(
    capabilityId: string,
    name = capabilityId,
    kind: CapabilityCatalogItem['kind'] = 'tool',
): CapabilityCatalogItem {
    return {
        scopeAndOwner: 'global#system',
        scopeOwnerId: 'system',
        searchKey: `${kind}#${name}`,
        capabilityId,
        kind,
        scope: 'global',
        name,
        normalizedName: name.toLocaleLowerCase(),
        summary: `${name} summary`,
        tags: [],
        manifestBlobHash: `hash-${capabilityId}`,
        catalogVisibility: 'listed',
        status: 'active',
        updatedAt: 1,
    }
}

function details(capabilityId: string, name: string): CapabilityDetails {
    const catalogItem = item(capabilityId, name)
    return {
        ...catalogItem,
        record: {
            capabilityId,
            kind: 'tool',
            scope: 'global',
            scopeOwnerId: 'system',
            storageOwnerId: 'system',
            manifestBlobHash: `hash-${capabilityId}`,
            catalogVisibility: 'listed',
            status: 'active',
            ownerUserId: 'system',
            createdAt: 1,
            updatedAt: 2,
        },
        manifest: {
            schemaVersion: 1,
            capabilityId,
            kind: 'tool',
            name,
            description: `${name} summary`,
            references: [{ capabilityId: 'internal-skill', kind: 'skill' }],
            resources: [],
            tool: {
                executionPolicy: 'model-choice',
                inputSchema: { resourceId: 'input-schema' },
                outputSchema: { resourceId: 'output-schema' },
                workflow: { nodes: [] },
            },
        },
        references: [{ capabilityId: 'internal-skill', kind: 'skill', name: 'Internal Skill' }],
        inputSchema: {
            type: 'object',
            properties: { prompt: { type: 'string' } },
            required: ['prompt'],
        },
        permissions: { canEdit: true, canDelete: true, canShare: true, canSetStatus: true },
        grants: [],
    }
}

describe('Capability library catalog projection', () => {
    it('merges pages without duplicates and excludes component Skills', () => {
        expect(mergeCapabilityCatalogPage(
            [item('a'), item('old-internal-skill', 'Old Internal Skill', 'skill'), item('b', 'Old B')],
            {
                items: [
                    item('b', 'New B'),
                    item('internal-skill', 'Internal Skill', 'skill'),
                    item('c'),
                ],
            },
            true,
        )).toEqual([item('a'), item('b', 'New B'), item('c')])
    })

    it('requests only Tools and renders no Skill rows', async () => {
        const client = {
            list: vi.fn().mockResolvedValue({
                items: [item('style-extraction', 'Style Extraction'), item('router', 'Router', 'skill')],
            }),
            invalidate: vi.fn(),
        } as any
        const panel = createCapabilityLibraryPanel({ client })

        await panel.load()

        expect(client.list).toHaveBeenCalledWith({ cursor: undefined, kind: 'tool' })
        expect(panel.element.querySelectorAll('.capability-library-row')).toHaveLength(1)
        expect(panel.element.textContent).toContain('Style Extraction')
        expect(panel.element.textContent).not.toContain('Router')
        panel.destroy()
    })

    it('does not expose dependencies, management controls, or schema-generated inputs', async () => {
        const capabilityDetails = details('style-extraction', 'Style Extraction')
        const client = {
            list: vi.fn().mockResolvedValue({ items: [item('style-extraction', 'Style Extraction')] }),
            get: vi.fn().mockResolvedValue(capabilityDetails),
            invalidate: vi.fn(),
        } as any
        const panel = createCapabilityLibraryPanel({ client })
        await panel.load()
        ;(panel.element.querySelector('.capability-library-row') as HTMLElement).click()

        await vi.waitFor(() => expect(panel.element.querySelector('.capability-library-inspector-card')).not.toBeNull())
        expect(panel.element.textContent).not.toContain('Internal Skill')
        expect(panel.element.textContent).not.toContain('Dependencies')
        expect(panel.element.querySelector('.capability-run-form')).toBeNull()
        expect(panel.element.querySelector('.capability-library-management')).toBeNull()
        expect(panel.element.querySelector('input')).toBeNull()
        expect(panel.element.querySelector('textarea')).toBeNull()
        expect(panel.element.querySelector('select')).toBeNull()
        panel.destroy()
    })

    it('attaches the top-level Tool from the existing row action', async () => {
        const onAttach = vi.fn()
        const client = {
            list: vi.fn().mockResolvedValue({ items: [item('character-creator', 'Character Creator')] }),
            invalidate: vi.fn(),
        } as any
        const panel = createCapabilityLibraryPanel({ client, onAttach })
        await panel.load()
        ;(panel.element.querySelector('.capability-library-row-action-primary') as HTMLButtonElement).click()

        expect(onAttach).toHaveBeenCalledWith({
            capabilityId: 'character-creator',
            kind: 'tool',
            displayName: 'Character Creator',
        })
        panel.destroy()
    })
})
