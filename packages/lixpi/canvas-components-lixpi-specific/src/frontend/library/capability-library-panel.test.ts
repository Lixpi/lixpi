// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    createCapabilityLibraryPanel,
    mergeCapabilityCatalogPage,
} from './capability-library-panel.ts'
import type {
    CapabilityCatalogItem,
    CapabilityDetails,
} from '@lixpi/capability-system/frontend'

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
        catalogExposure: 'standalone',
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
            catalogExposure: 'standalone',
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
    it('ignores a catalog page arriving after disposal and refuses new loads', async () => {
        const page = Promise.withResolvers<{ items: CapabilityCatalogItem[]; cursor?: string }>()
        const client = { list: vi.fn(() => page.promise), get: vi.fn(), invalidate: vi.fn() }
        const panel = createCapabilityLibraryPanel({ document, client })
        const loading = panel.load()
        panel.destroy()
        page.resolve({ items: [item('late')], cursor: 'next' })
        await loading
        await panel.load()
        await panel.refresh()
        expect(client.list).toHaveBeenCalledOnce()
        expect(client.invalidate).not.toHaveBeenCalled()
        expect(panel.element.querySelector('.capability-library-row')).toBeNull()
    })

    it('does not display stale details after a catalog refresh', async () => {
        const response = Promise.withResolvers<CapabilityDetails>()
        const client = { list: vi.fn().mockResolvedValueOnce({ items: [item('old')] }).mockResolvedValueOnce({ items: [item('new')] }), get: vi.fn(() => response.promise), invalidate: vi.fn() }
        const panel = createCapabilityLibraryPanel({ document, client })
        await panel.load()
        panel.element.querySelector<HTMLElement>('.capability-library-row')!.click()
        await panel.refresh()
        response.resolve(details('old', 'Old'))
        await response.promise
        expect(panel.element.querySelector('.capability-library-inspector-card')).toBeNull()
        expect(panel.element.querySelector<HTMLElement>('.capability-library-row')?.dataset.capabilityId).toBe('new')
        panel.destroy()
    })

    it('removes row actions when rerendering and isolates two panel instances', async () => {
        const client = { list: vi.fn().mockResolvedValue({ items: [item('shared')] }), get: vi.fn(), invalidate: vi.fn() }
        const firstAttach = vi.fn()
        const secondAttach = vi.fn()
        const first = createCapabilityLibraryPanel({ document, client, onAttach: firstAttach })
        const second = createCapabilityLibraryPanel({ document, client, onAttach: secondAttach })
        await Promise.all([first.load(), second.load()])
        const oldButton = first.element.querySelector<HTMLButtonElement>('[data-action="attach"]')!
        await first.refresh()
        oldButton.click()
        expect(firstAttach).not.toHaveBeenCalled()
        const removedButton = first.element.querySelector<HTMLButtonElement>('[data-action="attach"]')!
        first.destroy()
        removedButton.click()
        second.element.querySelector<HTMLButtonElement>('[data-action="attach"]')!.click()
        expect(firstAttach).not.toHaveBeenCalled()
        expect(secondAttach).toHaveBeenCalledExactlyOnceWith({ capabilityId: 'shared', kind: 'tool', displayName: 'shared' })
        second.destroy()
    })

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
        const panel = createCapabilityLibraryPanel({ document, client })

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
        const panel = createCapabilityLibraryPanel({ document, client })
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
        const panel = createCapabilityLibraryPanel({ document, client, onAttach })
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
