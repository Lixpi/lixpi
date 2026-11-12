import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type AccessLevel,
    type WorkspaceNavigationDocument,
} from '@lixpi/constants'
import { InMemoryWorkspaceTreeRepository } from './in-memory-workspace-tree-repository.ts'
import { WorkspaceTreeService } from './workspace-tree-service.ts'
import {
    indexNavigationDocument,
    navigationProjectionEntries,
} from './workspace-navigation-document.ts'

const paragraph = (id: string, text = ''): WorkspaceNavigationDocument => ({
    type: 'paragraph',
    attrs: { entryId: id },
    content: text ? [{
        type: 'text',
        text,
    }] : [],
})
const list = (id: string, content: WorkspaceNavigationDocument[]): WorkspaceNavigationDocument => ({
    type: 'bullet_list',
    attrs: { entryId: id },
    content,
})
const workspace = (id: string, name: string, content: WorkspaceNavigationDocument[] = []): WorkspaceNavigationDocument => ({
    type: 'list_item',
    attrs: {
        entryId: id,
        itemType: 'workspace',
        data: { workspaceId: id },
        tagIds: [],
    },
    content: [paragraph(`${id}-label`, name), ...content],
})
const group = (id: string, text: string, content: WorkspaceNavigationDocument[]): WorkspaceNavigationDocument => ({
    type: 'list_item',
    attrs: {
        entryId: id,
        itemType: 'text',
        data: null,
        tagIds: [],
    },
    content: [paragraph(`${id}-label`, text), ...content],
})
const doc = (...content: WorkspaceNavigationDocument[]): WorkspaceNavigationDocument => ({
    type: 'doc',
    content,
})

const harness = () => {
    const repository = new InMemoryWorkspaceTreeRepository()
    const memberships = new Map<string, AccessLevel>([['owner', 'owner']])
    const clock = { now: 1000 }
    let id = 0
    const cleanup = vi.fn(async () => undefined)
    const service = new WorkspaceTreeService({
        repository,
        organizations: {
            getMembershipLevel: async userId => memberships.get(userId),
            getOrganization: async organizationId => ({
                organizationId,
                name: 'Studio',
                tags: { red: {
                    name: 'Red',
                    color: '#ff0000',
                } },
            }),
            listUserOrganizationIds: async userId => memberships.has(userId) ? ['org'] : [],
        },
        deletion: {
            cleanupWorkspace: cleanup,
            stopConversations: vi.fn(async () => undefined),
        },
        now: () => clock.now,
        createId: () => `id-${++id}`,
    })
    const create = async (name: string, parentWorkspaceId?: string): Promise<string> =>
        (await service.createWorkspace('owner', {
            organizationId: 'org',
            name,
            parentWorkspaceId,
        })).workspace.workspaceId
    const save = async (document: WorkspaceNavigationDocument, deletedWorkspaceIds: string[] = [], userId = 'owner', mutationId = `mutation-${++id}`) => {
        const snapshot = await service.getNavigationSnapshot(userId, 'org')

        return await service.saveNavigation(userId, {
            organizationId: 'org',
            baseRevision: snapshot.revision,
            mutationId,
            document,
            deletedWorkspaceIds,
        })
    }

    return {
        repository,
        service,
        memberships,
        clock,
        cleanup,
        create,
        save,
    }
}

// =============================================================================
// CANONICAL DOCUMENT AND DOMAIN PROJECTION
// =============================================================================

describe('Workspace navigation document persistence', () => {
    it('initializes an empty canonical document once for a new organization', async () => {
        const h = harness()
        const first = await h.service.getNavigationSnapshot('owner', 'org')
        const second = await h.service.getNavigationSnapshot('owner', 'org')
        expect(first.revision).toBe(0)
        expect(first.document.content).toHaveLength(1)
        expect(first.document.content![0]).toMatchObject({
            type: 'paragraph',
            attrs: { entryId: expect.any(String) },
            content: [],
        })
        expect(second.document).toEqual(first.document)
        expect(second.revision).toBe(0)
        expect(await h.repository.listChildRows('org', undefined)).toEqual([])
    })

    it('loads every organization navigation from one tree read once each head exists', async () => {
        const h = harness()
        await h.create('Workspace')
        const single = await h.service.getNavigationSnapshot('owner', 'org')
        const buildTree = vi.spyOn(h.service, 'getUserWorkspaceTree')

        const navigation = await h.service.getUserWorkspaceNavigation('owner')

        expect(buildTree).toHaveBeenCalledOnce()
        expect(navigation.organizations).toEqual([single])
    })

    it('reports busy when the head moves while the navigation is being read', async () => {
        const h = harness()
        await h.create('Workspace')
        await h.service.getNavigationSnapshot('owner', 'org')
        const getNavigationDocument = h.repository.getNavigationDocument
        vi.spyOn(h.repository, 'getNavigationDocument').mockImplementationOnce(async (organizationId, revisionId) => {
            const document = await getNavigationDocument(organizationId, revisionId)
            await h.create('Concurrent')

            return document
        })

        await expect(h.service.getUserWorkspaceNavigation('owner')).rejects.toMatchObject({ code: 'WORKSPACE_TREE_BUSY' })
    })

    it('represents level-zero domain text under a workspace as a plain list item', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        await h.service.createHeading('owner', {
            organizationId: 'org',
            parentWorkspaceId: parent,
            level: 0,
            name: 'Plain child',
        })
        const row = (await h.repository.listChildRows('org', parent)).find(entry => entry.entryType === 'heading')!
        const before = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(before.document).get(row.entryId)?.node).toMatchObject({
            type: 'list_item',
            attrs: { itemType: 'text' },
            content: [{ type: 'paragraph' }],
        })
        await h.service.updateWorkspace('owner', {
            workspaceId: parent,
            name: 'Renamed',
        })
        const after = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(after.document).get(row.entryId)?.node.type).toBe('list_item')
        expect(navigationProjectionEntries(after.document).find(entry => entry.entryId === row.entryId)?.parentWorkspaceId).toBe(parent)
    })

    it('rejects nested H1-H3 domain mutations before opening a lock', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        await h.service.createHeading('owner', {
            organizationId: 'org',
            parentWorkspaceId: parent,
            level: 0,
            name: 'Plain',
        })
        await h.service.createHeading('owner', {
            organizationId: 'org',
            level: 2,
            name: 'Root heading',
        })
        const nested = (await h.repository.listChildRows('org', parent)).find(row => row.entryType === 'heading')!
        const root = (await h.repository.listChildRows('org', undefined)).find(row => row.entryType === 'heading')!
        const before = await h.service.getNavigationSnapshot('owner', 'org')
        await expect(h.service.createHeading('owner', {
            organizationId: 'org',
            parentWorkspaceId: parent,
            level: 1,
            name: 'Invalid',
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        await expect(h.service.updateHeading('owner', {
            organizationId: 'org',
            headingId: nested.entryId,
            level: 3,
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        await expect(h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: root.entryId,
            parentWorkspaceId: parent,
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(await h.repository.getLock('org')).toBeUndefined()
        expect((await h.service.getNavigationSnapshot('owner', 'org')).revision).toBe(before.revision)
    })

    it('converts a childless level-zero text row across the workspace boundary', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        await h.service.createHeading('owner', {
            organizationId: 'org',
            level: 0,
            name: 'Move me',
        })
        const row = (await h.repository.listChildRows('org', undefined)).find(entry => entry.entryType === 'heading')!
        await h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: row.entryId,
            parentWorkspaceId: parent,
        })
        let snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(snapshot.document).get(row.entryId)?.node.type).toBe('list_item')
        await h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: row.entryId,
        })
        snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(snapshot.document).get(row.entryId)?.node.type).toBe('paragraph')
    })

    it('rejects moving a plain group with child workspaces across a domain boundary', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const child = await h.create('Child', parent)
        await h.save(doc(list('root', [workspace(parent, 'Parent', [
            list('children', [group('group', 'Group', [
                list('nested', [workspace(child, 'Child')]),
            ])]),
        ])])))
        const before = await h.service.getNavigationSnapshot('owner', 'org')
        await expect(h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: 'group',
            parentWorkspaceId: parent,
            afterEntryId: child,
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        await expect(h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: 'group',
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(await h.repository.getLock('org')).toBeUndefined()
        expect((await h.service.getNavigationSnapshot('owner', 'org')).document).toEqual(before.document)
        await h.service.deleteHeading('owner', {
            organizationId: 'org',
            headingId: 'group',
        })
        const after = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(after.document).has('group')).toBe(false)
        expect(indexNavigationDocument(after.document).has(child)).toBe(true)
        expect(navigationProjectionEntries(after.document).find(entry => entry.entryId === child)?.parentWorkspaceId).toBe(parent)
    })

    it('rejects standalone domain text insertion and moves inside one workspace list', async () => {
        const h = harness()
        const first = await h.create('First')
        const second = await h.create('Second')
        await h.service.createHeading('owner', {
            organizationId: 'org',
            level: 1,
            name: 'Outside',
        })
        await h.save(doc(
            paragraph('outside', 'Outside'),
            list('shared', [workspace(first, 'First'), workspace(second, 'Second')]),
        ))
        const before = await h.service.getNavigationSnapshot('owner', 'org')
        const rows = await h.repository.listChildRows('org', undefined)
        const outside = rows.find(row => row.entryType === 'heading')!

        for (const level of [0, 2] as const)
            await expect(h.service.createHeading('owner', {
                organizationId: 'org',
                level,
                name: 'Between',
                afterEntryId: first,
                beforeEntryId: second,
            })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')

        await expect(h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: outside.entryId,
            afterEntryId: first,
            beforeEntryId: second,
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(await h.repository.getLock('org')).toBeUndefined()
        expect((await h.repository.listChildRows('org', undefined)).map(row => row.entryId)).toEqual(rows.map(row => row.entryId))
        expect((await h.service.getNavigationSnapshot('owner', 'org')).document).toEqual(before.document)
    })

    it('places standalone headings before a whole list without splitting it', async () => {
        const h = harness()
        const first = await h.create('First')
        const second = await h.create('Second')
        await h.save(doc(list('shared', [workspace(first, 'First'), workspace(second, 'Second')])))
        await h.service.createHeading('owner', {
            organizationId: 'org',
            level: 2,
            name: 'Before list',
            beforeEntryId: first,
        })
        const snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(snapshot.document.content?.map(node => node.type)).toEqual(['heading', 'bullet_list'])
        expect(snapshot.document.content?.[1].content?.map(node => node.attrs?.entryId)).toEqual([first, second])
    })

    it('moves a plain root list item before a standalone heading as a whole list', async () => {
        const h = harness()
        await h.service.getNavigationSnapshot('owner', 'org')
        await h.save(doc(
            {
                type: 'heading',
                attrs: {
                    entryId: 'heading',
                    level: 1,
                },
                content: [{
                    type: 'text',
                    text: 'Title',
                }],
            },
            list('plain-list', [group('plain', 'Plain', [])]),
        ))
        await h.service.moveHeading('owner', {
            organizationId: 'org',
            headingId: 'plain',
            beforeEntryId: 'heading',
        })
        const snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(snapshot.document.content?.map(node => node.type)).toEqual(['bullet_list', 'heading'])
        expect(snapshot.document.content?.[0].content?.[0].attrs?.entryId).toBe('plain')
    })

    it('keeps a root plain list label from becoming an H1-H3 heading', async () => {
        const h = harness()
        const workspaceId = await h.create('Workspace')
        await h.save(doc(list('shared', [group('plain', 'Plain', []), workspace(workspaceId, 'Workspace')])))
        const before = await h.service.getNavigationSnapshot('owner', 'org')
        await expect(h.service.updateHeading('owner', {
            organizationId: 'org',
            headingId: 'plain',
            level: 1,
        })).rejects.toThrow('WORKSPACE_NAVIGATION_INVALID')
        expect(await h.repository.getLock('org')).toBeUndefined()
        expect((await h.service.getNavigationSnapshot('owner', 'org')).document).toEqual(before.document)
        expect((await h.repository.listChildRows('org', undefined)).find(row => row.entryId === 'plain')?.level).toBe(0)
    })

    it('rejects a missing canonical head when hierarchy rows exist', async () => {
        const h = harness()
        await h.create('Workspace')
        h.repository.navigationRecords.delete('org#HEAD')
        await expect(h.service.getNavigationSnapshot('owner', 'org')).rejects.toThrow('WORKSPACE_NAVIGATION_REVISION_MISSING')
        expect(await h.repository.getNavigationRecord('org', 'HEAD')).toBeUndefined()
        expect(await h.repository.listChildRows('org', undefined)).toHaveLength(1)
    })

    it.each([1, 2, 3])('persists an empty level %s heading after deleting the last workspace', async level => {
        const h = harness()
        const workspaceId = await h.create('Temporary workspace')
        const heading: WorkspaceNavigationDocument = {
            type: 'heading',
            attrs: {
                entryId: 'heading',
                level,
            },
            content: [{
                type: 'text',
                text: 'Temporary heading',
            }],
        }
        await h.save(doc(heading, list('workspaces', [workspace(workspaceId, 'Temporary workspace')])))
        await h.save(doc(heading), [workspaceId])

        const result = await h.save(doc({
            type: 'heading',
            attrs: {
                entryId: 'heading',
                level,
            },
        }))
        expect(result).not.toHaveProperty('error')

        const reloaded = await h.service.getNavigationSnapshot('owner', 'org')
        expect(reloaded.document.content).toEqual([{
            type: 'heading',
            attrs: {
                entryId: 'heading',
                level,
                bold: false,
            },
            content: [],
        }])
        expect(await h.repository.listChildRows('org', undefined)).toEqual([
            expect.objectContaining({
                entryId: 'heading',
                entryType: 'heading',
                level,
                name: '',
            }),
        ])
        expect(await h.repository.getWorkspaceMeta(workspaceId)).toBeUndefined()
    })

    it('retains whole-label bold through unrelated domain mutations and note updates', async () => {
        const h = harness()
        const workspaceId = await h.create('Workspace')
        const document = doc(
            {
                type: 'heading',
                attrs: {
                    entryId: 'heading',
                    level: 2,
                },
                content: [{
                    type: 'text',
                    text: 'Projects',
                }],
            },
            paragraph('ordinary-text', 'Notes'),
            list('groups', [
                group('group', 'Clients', [
                    list('workspaces', [
                        workspace(workspaceId, 'Workspace', [
                            list('workspace-plain', [group('workspace-text', 'Workspace note', [])]),
                        ]),
                    ]),
                ]),
            ]),
        )
        const textBlocks = [...indexNavigationDocument(document).values()]
            .map(entry => entry.node)
            .filter(node => node.type === 'paragraph' || node.type === 'heading')

        for (const block of textBlocks)
            block.attrs = {
                ...block.attrs,
                bold: true,
            }

        await h.save(document)
        await h.create('Another workspace')
        await h.service.updateWorkspace('owner', {
            workspaceId,
            note: 'Updated note',
        })

        const snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        const saved = indexNavigationDocument(snapshot.document)

        for (const block of textBlocks)
            expect(saved.get(String(block.attrs!.entryId))?.node.attrs).toMatchObject(block.attrs!)

        expect(saved.get('workspace-text')?.node.content?.[0].content?.[0].text).toBe('Workspace note')
        expect(h.repository.metas.get(workspaceId)?.name).toBe('Workspace')
    })

    it('retains ordinary blocks and derives ancestry from the nearest workspace across text groups', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const child = await h.create('Child')
        const document = doc(
            {
                type: 'heading',
                attrs: {
                    entryId: 'heading',
                    level: 2,
                },
                content: [{
                    type: 'text',
                    text: 'Projects',
                }],
            },
            list('outer', [
                group('group', 'Clients', [
                    list('projects', [
                        workspace(parent, '', [
                            list('inside', [group('note', 'Details', [list('children', [workspace(child, 'Child')])])]),
                        ]),
                    ]),
                ]),
            ]),
            paragraph('end', 'Tail'),
        )
        const result = await h.save(document)
        expect('error' in result).toBe(false)
        expect(h.repository.metas.get(parent)?.name).toBe('')
        expect(h.repository.metas.get(child)).toMatchObject({
            parentWorkspaceId: parent,
            ancestorIds: [parent],
        })
        const snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(snapshot.document).get('group')?.node.attrs?.itemType).toBe('text')
        expect(indexNavigationDocument(snapshot.document).get('note')?.node.content?.[0].content?.[0].text).toBe('Details')
        expect(indexNavigationDocument(snapshot.document).get('end')?.node.content?.[0].text).toBe('Tail')
    })

    it('rejects omitted or invented workspace bindings and accepts clearing a name', async () => {
        const h = harness()
        const id = await h.create('Existing')
        await expect(h.save(doc(paragraph('p')))).rejects.toThrow('WORKSPACE_NAVIGATION_EXPLICIT_DELETE_REQUIRED')
        await expect(h.save(doc(list('l', [workspace('invented', 'New')])))).rejects.toThrow('WORKSPACE_NAVIGATION_UNKNOWN_WORKSPACE')
        await h.save(doc(list('l', [workspace(id, '')])))
        expect(h.repository.metas.get(id)?.name).toBe('')
        expect(h.cleanup).not.toHaveBeenCalled()
        await h.service.updateWorkspace('owner', {
            workspaceId: id,
            name: '',
        })
        expect(h.repository.metas.get(id)?.name).toBe('')
    })

    it('rejects stale revisions and makes a mutation retry idempotent without accepting a different body', async () => {
        const h = harness()
        const id = await h.create('Before')
        const snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        const request = {
            organizationId: 'org',
            baseRevision: snapshot.revision,
            mutationId: 'same-id',
            document: doc(list('list', [workspace(id, 'Saved')])),
        }
        const saved = await h.service.saveNavigation('owner', request)
        const repeated = await h.service.saveNavigation('owner', request)
        expect(repeated).toEqual(saved)
        await expect(h.service.saveNavigation('owner', {
            ...request,
            document: doc(list('list', [workspace(id, 'Different')])),
        })).rejects.toThrow('WORKSPACE_NAVIGATION_MUTATION_REUSED')
        const stale = await h.service.saveNavigation('owner', {
            ...request,
            mutationId: 'stale',
            document: doc(list('list', [workspace(id, 'Stale')])),
        })
        expect(stale).toMatchObject({ error: 'WORKSPACE_NAVIGATION_STALE' })
        expect(h.repository.metas.get(id)?.name).toBe('Saved')
    })

    it('keeps ordinary grouping when external APIs rename, tag, create, move and delete workspaces', async () => {
        const h = harness()
        const first = await h.create('First')
        const second = await h.create('Second')
        await h.save(doc(paragraph('intro', 'Keep me'), list('list', [group('group', 'Group', [list('nested', [workspace(first, 'First'), workspace(second, 'Second')])])])))
        await h.service.updateWorkspace('owner', {
            workspaceId: first,
            name: '',
            tagIds: ['red'],
        })
        const third = await h.create('Third', first)
        await h.service.moveWorkspace('owner', {
            workspaceId: second,
            parentWorkspaceId: first,
        })
        let snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(snapshot.document).get('intro')?.node.content?.[0].text).toBe('Keep me')
        expect(indexNavigationDocument(snapshot.document).get('group')?.node.attrs?.itemType).toBe('text')
        expect(indexNavigationDocument(snapshot.document).get(first)?.node.attrs?.tagIds).toEqual(['red'])
        expect(navigationProjectionEntries(snapshot.document).find(entry => entry.entryId === second)?.parentWorkspaceId).toBe(first)
        await h.service.deleteWorkspace('owner', third)
        snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(snapshot.document).has(third)).toBe(false)
        expect(indexNavigationDocument(snapshot.document).has(second)).toBe(true)
    })

    it('preserves hidden records and real inherited parents while renaming a promoted root', async () => {
        const h = harness()
        const hidden = await h.create('Secret parent')
        const visible = await h.create('Shared child', hidden)
        const sibling = await h.create('Secret sibling')
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: visible,
            accessLevel: 'editor',
        })
        const baseline = await h.service.getNavigationSnapshot('guest', 'org')
        expect(navigationProjectionEntries(baseline.document).filter(entry => entry.entryType === 'workspace').map(entry => entry.entryId)).toEqual([visible])
        const submitted = structuredClone(baseline.document)
        indexNavigationDocument(submitted).get(visible)!.node.content![0].content = [{
            type: 'text',
            text: 'Renamed',
        }]
        await h.save(submitted, [], 'guest')
        expect(h.repository.metas.get(visible)).toMatchObject({
            name: 'Renamed',
            parentWorkspaceId: hidden,
            ancestorIds: [hidden],
        })
        const complete = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(complete.document).has(hidden)).toBe(true)
        expect(indexNavigationDocument(complete.document).has(sibling)).toBe(true)
    })

    it('checks destination access and unknown tags before making a projection change', async () => {
        const h = harness()
        const source = await h.create('Source')
        const target = await h.create('Target')
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: source,
            accessLevel: 'editor',
        })
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: target,
            accessLevel: 'viewer',
        })
        await expect(h.save(doc(list('list', [workspace(target, 'Target', [list('children', [workspace(source, 'Source')])])])), [], 'guest')).rejects.toThrow('PERMISSION_DENIED')
        const invalid = workspace(source, 'Source')
        invalid.attrs!.tagIds = ['unknown']
        await expect(h.save(doc(list('list', [invalid, workspace(target, 'Target')])))).rejects.toThrow('WORKSPACE_TAG_UNKNOWN')
        expect(h.repository.metas.get(source)?.parentWorkspaceId).toBeUndefined()
    })
})

// =============================================================================
// EXPLICIT DELETION AND INTERRUPTED SAVES
// =============================================================================

describe('Workspace navigation save recovery', () => {
    it('moves a surviving child out before deleting its former parent', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const child = await h.create('Child', parent)
        const result = await h.save(doc(list('survivors', [workspace(child, 'Survivor')])), [parent])
        expect('error' in result).toBe(false)
        expect(h.repository.metas.has(parent)).toBe(false)
        expect(h.repository.metas.get(child)).toMatchObject({
            name: 'Survivor',
            ancestorIds: [],
        })
        expect(h.repository.metas.get(child)?.parentWorkspaceId).toBeUndefined()
        expect(h.cleanup.mock.calls.map(call => call[0].workspaceId)).toEqual([parent])
    })

    it('deletes the exact IDs removed from the draft even when they had different stored parents', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const movedIntoDraft = await h.create('Moved into draft')
        const keep = await h.create('Keep')
        await h.save(doc(list('keep', [workspace(keep, 'Keep')])), [parent, movedIntoDraft])
        expect([...h.repository.metas.keys()]).toEqual([keep])
        expect(new Set(h.cleanup.mock.calls.map(call => call[0].workspaceId))).toEqual(new Set([
            parent,
            movedIntoDraft,
        ]))
    })

    it('fences reads during an interrupted projection and publishes the saved revision only after recovery', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const child = await h.create('Child')
        const before = await h.service.getNavigationSnapshot('owner', 'org')
        let stopped = false
        h.repository.beforeCommit = commit => {
            if (
                !stopped
                && commit.changes.some(change => change.type === 'putNavigationRecord' && change.key === 'HEAD')
            ) {
                stopped = true

                throw new Error('STOPPED_BEFORE_PUBLICATION')
            }
        }
        await expect(h.save(doc(list('roots', [workspace(parent, 'Parent', [list('children', [workspace(child, 'Child')])])])))).rejects.toThrow('STOPPED_BEFORE_PUBLICATION')
        expect((await h.repository.getNavigationRecord('org', 'HEAD'))?.revision).toBe(before.revision)
        await expect(h.service.access.resolve({
            userId: 'owner',
            workspaceId: child,
        })).rejects.toThrow('WORKSPACE_TREE_BUSY')
        await expect(h.service.getUserWorkspaceTree('owner')).rejects.toThrow('WORKSPACE_TREE_BUSY')
        h.repository.beforeCommit = undefined
        h.clock.now += 60_000
        await h.service.resumeExpiredOperations()
        const saved = await h.service.getNavigationSnapshot('owner', 'org')
        expect(saved.revision).toBe(before.revision + 1)
        expect(h.repository.metas.get(child)?.ancestorIds).toEqual([parent])
        expect(await h.repository.getLock('org')).toBeUndefined()
    })

    it('resumes an explicit deletion whose cleanup was interrupted without deleting survivors', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const child = await h.create('Child', parent)
        h.cleanup.mockRejectedValueOnce(new Error('CLEANUP_STOPPED'))
        await expect(h.save(doc(list('keep', [workspace(child, 'Keep')])), [parent])).rejects.toThrow('CLEANUP_STOPPED')
        h.clock.now += 60_000
        await h.service.resumeExpiredOperations()
        expect(h.repository.metas.has(parent)).toBe(false)
        expect(h.repository.metas.has(child)).toBe(true)
        expect(h.repository.metas.get(child)?.ancestorIds).toEqual([])
        expect(await h.repository.getLock('org')).toBeUndefined()
    })
})


describe('Explicit workspace creation and retained notes', () => {
    it('creates only explicitly queued IDs with complete content, ownership and hierarchy on Save', async () => {
        const h = harness()
        h.memberships.set('member', 'viewer')
        const before = await h.service.getNavigationSnapshot('member', 'org')
        expect(h.repository.metas.size).toBe(0)
        const request = {
            organizationId: 'org',
            baseRevision: before.revision,
            mutationId: 'create-on-save',
            createdWorkspaceIds: ['new-parent', 'new-child'],
            document: doc(list('new-list', [workspace('new-parent', '', [list('new-children', [workspace('new-child', 'Child')])])])),
        }
        await h.service.saveNavigation('member', request)
        expect(h.repository.metas.get('new-parent')?.name).toBe('')
        expect(h.repository.metas.get('new-child')).toMatchObject({
            parentWorkspaceId: 'new-parent',
            ancestorIds: ['new-parent'],
        })
        expect(await h.repository.listWorkspaceGrants('new-child')).toEqual([expect.objectContaining({
            userId: 'member',
            accessLevel: 'owner',
        })])
        await h.service.saveNavigation('member', request)
        expect(h.repository.metas.size).toBe(2)
    })

    it('rejects queued ID collisions and a noneditor creation destination before any creation', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: parent,
            accessLevel: 'viewer',
        })
        const before = await h.service.getNavigationSnapshot('guest', 'org')
        await expect(h.service.saveNavigation('guest', {
            organizationId: 'org',
            baseRevision: before.revision,
            mutationId: 'denied-create',
            createdWorkspaceIds: ['new'],
            document: doc(list('list', [workspace(parent, 'Parent', [list('children', [workspace('new', 'New')])])])),
        })).rejects.toThrow('PERMISSION_DENIED')
        expect(h.repository.metas.has('new')).toBe(false)
        const owner = await h.service.getNavigationSnapshot('owner', 'org')
        await expect(h.service.saveNavigation('owner', {
            organizationId: 'org',
            baseRevision: owner.revision,
            mutationId: 'collision',
            createdWorkspaceIds: [parent],
            document: owner.document,
        })).rejects.toThrow('WORKSPACE_NAVIGATION_UNKNOWN_WORKSPACE')
    })

    it('keeps domain notes out of the navigation document', async () => {
        const h = harness()
        const workspaceId = await h.create('Workspace')
        await h.service.updateWorkspace('owner', {
            workspaceId,
            note: 'Workspace metadata note',
        })
        await h.service.createHeading('owner', {
            organizationId: 'org',
            level: 1,
            name: 'Section',
            note: 'Heading metadata note',
        })
        const snapshot = await h.service.getNavigationSnapshot('owner', 'org')
        const entries = indexNavigationDocument(snapshot.document)
        expect([...entries.keys()].some(id => id.startsWith('navigation-note:'))).toBe(false)
        await h.save(snapshot.document)
        expect(h.repository.metas.get(workspaceId)?.note).toBe('Workspace metadata note')
        const heading = (await h.repository.listChildRows('org', undefined)).find(row => row.entryType === 'heading')
        expect(heading?.note).toBe('Heading metadata note')
    })

    it('repairs a save interrupted between projection batches without leaving unreachable children', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const children: string[] = []

        for (let index = 0; index < 40; index += 1)
            children.push(await h.create(`Child ${index}`))

        let batches = 0
        h.repository.beforeCommit = commit => {
            if (
                commit.changes.some(change => change.type === 'patchWorkspace')
                && ++batches === 2
            )
                throw new Error('MID_PROJECTION')
        }
        await expect(h.save(doc(list('outer', [workspace(parent, 'Parent', [list('inner', children.map(id => workspace(id, id)))])])))).rejects.toThrow('MID_PROJECTION')
        h.repository.beforeCommit = undefined
        h.clock.now += 60_000
        await h.service.resumeExpiredOperations()

        for (const id of children)
            expect(h.repository.metas.get(id)?.ancestorIds).toEqual([parent])

        const rows = await h.repository.listChildRows('org', undefined)
        expect(rows.filter(row => row.entryType === 'workspace').map(row => row.entryId)).toEqual([parent])
        expect((await h.repository.listChildRows('org', parent)).filter(row => row.entryType === 'workspace')).toHaveLength(40)
    })
})


describe('Navigation authorization and publication races', () => {
    it('keeps the published document when an indexed parent meta is missing and resumes after repair', async () => {
        const h = harness()
        const parent = await h.create('Parent')
        const child = await h.create('Child', parent)
        const sibling = await h.create('Sibling')
        const baseline = await h.repository.getNavigationRecord('org', 'HEAD')
        const parentMeta = h.repository.metas.get(parent)!
        h.repository.metas.delete(parent)

        await expect(h.service.updateWorkspace('owner', {
            workspaceId: sibling,
            name: 'Renamed',
        })).rejects.toThrow('WORKSPACE_NAVIGATION_PROJECTION_INCOMPLETE')

        expect(await h.repository.getNavigationRecord('org', 'HEAD')).toEqual(baseline)
        const published = await h.repository.getNavigationDocument('org', baseline!.revisionId)
        expect(indexNavigationDocument(published).has(child)).toBe(true)
        expect(await h.repository.getLock('org')).toBeDefined()

        h.repository.putMeta(parentMeta)
        h.clock.now += 60_000
        await h.service.resumeExpiredOperations()
        const recovered = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(recovered.document).get(child)?.ancestorIds).toEqual([parent])
        expect(h.repository.metas.get(sibling)?.name).toBe('Renamed')
        expect(recovered.revision).toBe(baseline!.revision + 1)
        expect(await h.repository.getLock('org')).toBeUndefined()
    })

    it('rolls back only its own provisional creations when another organization claims the same queued ID', async () => {
        const h = harness()
        const baseline = await h.service.getNavigationSnapshot('owner', 'org')
        let injected = false
        h.repository.beforeCommit = commit => {
            if (
                injected
                || !commit.changes.some(change => change.type === 'createWorkspace' && change.workspace.workspaceId === 'collision')
            )
                return

            injected = true
            h.repository.putMeta({
                workspaceId: 'collision',
                organizationId: 'other-org',
                name: 'Other owner',
                tagIds: [],
                ancestorIds: [],
                position: 'V',
                createdAt: 1,
                updatedAt: 1,
            })
            h.repository.workspaces.set('collision', {
                workspaceId: 'collision',
                organizationId: 'other-org',
                name: 'Other owner',
            })
            h.repository.putGrant({
                workspaceId: 'collision',
                userId: 'other-owner',
                accessLevel: 'owner',
            })
        }
        await expect(h.service.saveNavigation('owner', {
            organizationId: 'org',
            baseRevision: baseline.revision,
            mutationId: 'creation-race',
            createdWorkspaceIds: ['created-first', 'collision'],
            document: doc(list('list', [workspace('created-first', 'Mine'), workspace('collision', 'Should not overwrite')])),
        })).rejects.toThrow('WORKSPACE_NAVIGATION_ID_COLLISION')
        expect(h.repository.metas.has('created-first')).toBe(false)
        expect(h.repository.metas.get('collision')).toMatchObject({
            organizationId: 'other-org',
            name: 'Other owner',
        })
        expect(await h.repository.listWorkspaceGrants('collision')).toEqual([{
            workspaceId: 'collision',
            userId: 'other-owner',
            accessLevel: 'owner',
        }])
        expect(await h.repository.getLock('org')).toBeUndefined()
        expect((await h.repository.getNavigationRecord('org', 'HEAD'))?.revision).toBe(baseline.revision)
    })

    it('requires editor at the source when moving ordinary text into an editable workspace', async () => {
        const h = harness()
        const source = await h.create('Source')
        const target = await h.create('Target')
        await h.save(doc(list('root-list', [
            workspace(source, 'Source', [list('source-list', [group('moving', 'Protected text', []), group('stays', 'Stays', [])])]),
            workspace(target, 'Target', [list('target-list', [group('target-group', 'Target text', [])])]),
        ])))
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: source,
            accessLevel: 'viewer',
        })
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: target,
            accessLevel: 'editor',
        })
        const baseline = await h.service.getNavigationSnapshot('guest', 'org')
        const entries = indexNavigationDocument(baseline.document)
        const from = entries.get('source-list')!.node
        const moving = from.content!.shift()!
        entries.get('target-list')!.node.content!.push(moving)
        await expect(h.service.saveNavigation('guest', {
            organizationId: 'org',
            baseRevision: baseline.revision,
            mutationId: 'move-readonly-text',
            document: baseline.document,
        })).rejects.toThrow('PERMISSION_DENIED')
        expect(indexNavigationDocument((await h.service.getNavigationSnapshot('owner', 'org')).document).get('moving')?.ancestorIds).toEqual([source])
    })

    it('requires organization editor access when moving ordinary text out to the root', async () => {
        const h = harness()
        const source = await h.create('Source')
        await h.save(doc(list('root-list', [
            workspace(source, 'Source', [
                list('source-list', [
                    group('moving', 'Workspace text', []),
                    group('stays', 'Stays', []),
                ]),
            ]),
        ])))
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: source,
            accessLevel: 'editor',
        })
        const baseline = await h.service.getNavigationSnapshot('guest', 'org')
        const entries = indexNavigationDocument(baseline.document)
        const moving = entries.get('source-list')!.node.content!.shift()!
        entries.get('root-list')!.node.content!.push(moving)

        await expect(h.service.saveNavigation('guest', {
            organizationId: 'org',
            baseRevision: baseline.revision,
            mutationId: 'move-text-to-root',
            document: baseline.document,
        })).rejects.toThrow('PERMISSION_DENIED')

        const unchanged = await h.service.getNavigationSnapshot('owner', 'org')
        expect(indexNavigationDocument(unchanged.document).get('moving')?.ancestorIds).toEqual([source])
    })

    it('returns not-found from a missing initial meta read instead of granting an unpublished creation', async () => {
        const h = harness()
        const id = await h.create('Workspace')
        await h.repository.acquireLock({
            organizationId: 'org',
            operationId: 'save',
            operation: 'saveNavigation',
            entryId: 'save',
            userId: 'owner',
            phase: 'start',
            parameters: {},
            acquiredAt: 1,
            expiresAt: 5000,
        })
        vi.spyOn(h.repository, 'getWorkspaceMeta').mockResolvedValueOnce(undefined)
        expect(await h.service.access.resolve({
            userId: 'owner',
            workspaceId: id,
        })).toEqual({ status: 'not-found' })
    })

    it('rejects a new organization discovered after the accessible-forest fence was captured', async () => {
        const h = harness()
        const id = await h.create('Workspace')
        h.repository.putGrant({
            userId: 'guest',
            workspaceId: id,
            accessLevel: 'editor',
        })
        await h.repository.acquireLock({
            organizationId: 'org',
            operationId: 'save',
            operation: 'saveNavigation',
            entryId: 'save',
            userId: 'owner',
            phase: 'start',
            parameters: {},
            acquiredAt: 1,
            expiresAt: 5000,
        })
        vi.spyOn(h.repository, 'listUserGrants').mockResolvedValueOnce([])
        await expect(h.service.access.loadAccessibleForest('guest')).rejects.toThrow('WORKSPACE_TREE_BUSY')
    })

    it('keeps a descendant reachable when its final removal fails after a full grant-cleanup batch', async () => {
        const h = harness()
        const root = await h.create('Root')
        const child = await h.create('Child', root)

        for (let index = 0; index < 96; index += 1)
            h.repository.putGrant({
                userId: `grant-${index}`,
                workspaceId: child,
                accessLevel: 'viewer',
            })

        h.repository.beforeCommit = commit => {
            if (commit.changes.some(change => change.type === 'deleteWorkspace' && change.workspaceId === child))
                throw new Error('STOP_AT_FINAL_REMOVAL')
        }
        await expect(h.service.deleteWorkspace('owner', root)).rejects.toThrow('STOP_AT_FINAL_REMOVAL')
        expect(h.repository.metas.has(child)).toBe(true)
        expect((await h.repository.listChildRows('org', root)).some(row => row.entryId === child)).toBe(true)
        h.repository.beforeCommit = undefined
        h.clock.now += 60_000
        await h.service.resumeExpiredOperations()
        expect(h.repository.metas.has(child)).toBe(false)
        expect(h.repository.metas.has(root)).toBe(false)
    })
})

