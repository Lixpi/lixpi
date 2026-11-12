import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    type AccessLevel,
    type WorkspaceTree,
    type WorkspaceTreeEntry,
} from '@lixpi/constants'

import { InMemoryWorkspaceTreeRepository } from './in-memory-workspace-tree-repository.ts'
import { createWorkspaceTreeHandlers } from './workspace-tree-handlers.ts'
import { WorkspaceTreeService } from './workspace-tree-service.ts'

// =============================================================================
// HARNESS
// =============================================================================

type Harness = {
    repository: InMemoryWorkspaceTreeRepository
    service: WorkspaceTreeService
    clock: { now: number }
    memberships: Map<string, AccessLevel>
    deletion: {
        stopConversations: ReturnType<typeof vi.fn>
        cleanupWorkspace: ReturnType<typeof vi.fn>
    }
}

const organizations = {
    'org-1': {
        organizationId: 'org-1',
        name: 'Studio',
        tags: {
            'tag-red': {
                name: 'Urgent',
                color: '#ff0000',
            },
        },
    },
    'org-2': {
        organizationId: 'org-2',
        name: 'Agency',
        tags: {},
    },
} as const

const createHarness = (): Harness => {
    const repository = new InMemoryWorkspaceTreeRepository()
    const clock = { now: 1_000 }
    let nextId = 0
    const memberships = new Map<string, AccessLevel>([
        ['owner#org-1', 'owner'],
        ['owner#org-2', 'owner'],
        ['member#org-1', 'viewer'],
    ])
    const deletion = {
        stopConversations: vi.fn(async () => undefined),
        cleanupWorkspace: vi.fn(async () => undefined),
    }
    const service = new WorkspaceTreeService({
        repository,
        organizations: {
            getMembershipLevel: async (userId, organizationId) => memberships.get(`${userId}#${organizationId}`),
            getOrganization: async organizationId => organizations[organizationId as keyof typeof organizations],
            listUserOrganizationIds: async userId => [...memberships.keys()].filter(key => key.startsWith(`${userId}#`)).map(key => key.split('#')[1]),
        },
        deletion,
        createWorkspaceContent: () => ({ canvasState: { nodes: [] } }),
        now: () => clock.now,
        createId: () => `id-${++nextId}`,
    })

    return {
        repository,
        service,
        clock,
        memberships,
        deletion,
    }
}

let harness: Harness

beforeEach(() => void (harness = createHarness()))

const createWorkspace = async (
    name: string,
    parentWorkspaceId?: string,
    organizationId = 'org-1',
): Promise<string> =>
    (await harness.service.createWorkspace('owner', {
        organizationId,
        name,
        ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
    })).workspace.workspaceId

const createHeading = async (
    name: string,
    level: 0 | 1 | 2 | 3,
    parentWorkspaceId?: string,
): Promise<string> => {
    const tree = await harness.service.createHeading('owner', {
        organizationId: 'org-1',
        name,
        level,
        ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
    })
    const find = (entries: WorkspaceTreeEntry[]): string | undefined => {
        for (const entry of entries) {
            if (
                entry.entryType === 'heading'
                && entry.heading.name === name
            )
                return entry.heading.headingId

            if (entry.entryType === 'workspace') {
                const nested = find(entry.children)

                if (nested)
                    return nested
            }
        }
    }

    return find(tree.roots)!
}

// Renders a level as names, with headings as "# name", notes as "> name" and
// children nested.
type Outline = Array<string | [string, Outline]>
const outline = (entries: WorkspaceTreeEntry[]): Outline => entries.map(entry =>
    entry.entryType === 'heading'
        ? `${entry.heading.level === 0 ? '>' : '#'.repeat(entry.heading.level)} ${entry.heading.name}`
        : entry.children.length
            ? [entry.workspace.name, outline(entry.children)]
            : entry.workspace.name)

const orgTree = async (
    userId = 'owner',
    organizationId = 'org-1',
): Promise<WorkspaceTree> => await harness.service.getOrganizationTree(userId, organizationId)

const metaOf = (workspaceId: string) => harness.repository.metas.get(workspaceId)!

// =============================================================================
// READS
// =============================================================================

describe('WorkspaceTreeService reads', () => {
    it('returns one tree per organization with its tag definitions', async () => {
        await createWorkspace('Brand')
        await createWorkspace('Pitch', undefined, 'org-2')

        const trees = await harness.service.getUserWorkspaceTree('owner')

        expect(trees.organizations.map(tree => [tree.organizationName, outline(tree.roots)])).toEqual([
            ['Studio', ['Brand']],
            ['Agency', ['Pitch']],
        ])
        expect(trees.organizations[0].tags).toEqual(organizations['org-1'].tags)
    })

    it('keeps root headings and nested plain text in the workspace tree', async () => {
        await createHeading('Clients', 1)
        const acme = await createWorkspace('Acme')
        await createHeading('Campaigns', 0, acme)
        const spring = await createWorkspace('Spring', acme)
        await createHeading('Shots', 0, acme)
        await createWorkspace('Hero shot', acme)
        await createWorkspace('Storyboard', spring)
        await createHeading('Archive', 1)

        expect(outline((await orgTree()).roots)).toEqual([
            '# Clients',
            ['Acme', [
                '> Campaigns',
                ['Spring', ['Storyboard']],
                '> Shots',
                'Hero shot',
            ]],
            '# Archive',
        ])
        expect(metaOf(spring).ancestorIds).toEqual([acme])
    })

    it('keeps heading and note text as typed, empty included', async () => {
        const note = await createHeading('', 0)

        await harness.service.updateHeading('owner', {
            headingId: note,
            organizationId: 'org-1',
            name: '  two spaces ',
        })

        expect(outline((await orgTree()).roots)).toEqual(['>   two spaces '])
        await expect(harness.service.updateHeading('owner', {
            headingId: note,
            organizationId: 'org-1',
            name: 'x'.repeat(2001),
        })).rejects.toMatchObject({ code: 'WORKSPACE_NOTE_TOO_LONG' })
    })

    it('keeps a note among entries without grouping them, and switches it to a heading and back', async () => {
        const note = await createHeading('Remember the brief', 0)
        await createWorkspace('Acme')

        expect(outline((await orgTree()).roots)).toEqual(['> Remember the brief', 'Acme'])

        await harness.service.updateHeading('owner', {
            headingId: note,
            organizationId: 'org-1',
            level: 2,
        })
        expect(outline((await orgTree()).roots)).toEqual(['## Remember the brief', 'Acme'])

        await harness.service.updateHeading('owner', {
            headingId: note,
            organizationId: 'org-1',
            level: 0,
        })
        expect(outline((await orgTree()).roots)).toEqual(['> Remember the brief', 'Acme'])
        await expect(harness.service.updateHeading('owner', {
            headingId: note,
            organizationId: 'org-1',
            level: 4 as never,
        })).rejects.toMatchObject({ code: 'INVALID_HEADING_LEVEL' })
    })

    it('hides a heading whose workspaces the user cannot see and promotes a granted child to a root', async () => {
        const parent = await createWorkspace('Parent')
        const shared = await createWorkspace('Shared', parent)
        await createHeading('Private', 1)
        await createWorkspace('Secret')
        await createHeading('Empty', 1)
        harness.repository.putGrant({
            userId: 'member',
            workspaceId: shared,
            accessLevel: 'viewer',
        })

        // The member's child grant shows at its root ancestor's place, and
        // "Private" holds only a workspace the member cannot see, so it is hidden.
        expect(outline((await orgTree('member')).roots)).toEqual(['Shared', '# Empty'])

        harness.memberships.delete('member#org-1')

        // A grant-only user does not see the organization's empty headings.
        expect(outline((await orgTree('member')).roots)).toEqual(['Shared'])
    })
})

// =============================================================================
// CREATE, ANNOTATE AND PLACE
// =============================================================================

describe('WorkspaceTreeService placement and annotations', () => {
    it('places entries before and after named neighbors', async () => {
        const first = await createWorkspace('First')
        const last = await createWorkspace('Last')
        await harness.service.createWorkspace('owner', {
            organizationId: 'org-1',
            name: 'Middle',
            afterEntryId: first,
            beforeEntryId: last,
        })
        await harness.service.createWorkspace('owner', {
            organizationId: 'org-1',
            name: 'Zero',
            beforeEntryId: first,
        })

        expect(outline((await orgTree()).roots)).toEqual(['Zero', 'First', 'Middle', 'Last'])
    })

    it('rejects neighbors that are no longer adjacent siblings with the current tree', async () => {
        const first = await createWorkspace('First')
        await createWorkspace('Second')
        const last = await createWorkspace('Last')

        await expect(harness.service.createWorkspace('owner', {
            organizationId: 'org-1',
            name: 'Late',
            afterEntryId: first,
            beforeEntryId: last,
        })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_STALE' })
        await expect(harness.service.createWorkspace('owner', {
            organizationId: 'org-1',
            name: 'Late',
            afterEntryId: 'gone',
        })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_STALE' })
    })

    it('saves notes and tags and rejects unknown tags and long notes', async () => {
        const brand = await createWorkspace('Brand')
        const tree = await harness.service.updateWorkspace('owner', {
            workspaceId: brand,
            note: 'Quarterly refresh',
            tagIds: ['tag-red', 'tag-red'],
        })
        const entry = tree.roots[0] as Extract<WorkspaceTreeEntry, { entryType: 'workspace' }>

        expect(entry.workspace).toMatchObject({
            note: 'Quarterly refresh',
            tagIds: ['tag-red'],
        })
        await expect(harness.service.updateWorkspace('owner', {
            workspaceId: brand,
            tagIds: ['tag-missing'],
        })).rejects.toMatchObject({ code: 'WORKSPACE_TAG_UNKNOWN' })
        await expect(harness.service.updateWorkspace('owner', {
            workspaceId: brand,
            note: 'x'.repeat(281),
        })).rejects.toMatchObject({ code: 'WORKSPACE_NOTE_TOO_LONG' })

        await harness.service.updateWorkspace('owner', {
            workspaceId: brand,
            note: null,
        })
        expect(metaOf(brand)).not.toHaveProperty('note')
    })

    it('rebalances a level whose positions grew too long', async () => {
        const anchor = await createWorkspace('Anchor')
        let before = await createWorkspace('Tail')

        // Each insert halves the same gap, so without a rebalance the newest
        // position would pass 48 digits after about 290 inserts.
        for (let index = 0; index < 320; index += 1)
            before = (await harness.service.createWorkspace('owner', {
                organizationId: 'org-1',
                name: `Item ${index}`,
                afterEntryId: anchor,
                beforeEntryId: before,
            })).workspace.workspaceId

        const rows = await harness.repository.listChildRows('org-1', undefined)

        expect(rows).toHaveLength(322)
        expect(Math.max(...rows.map(row => row.position.length))).toBeLessThanOrEqual(48)
        expect(rows[0].entryId).toBe(anchor)
        expect(metaOf(rows.at(-1)!.entryId).name).toBe('Tail')
        expect(rows.map(row => metaOf(row.entryId).position)).toEqual(rows.map(row => row.position))
        expect(harness.repository.locks.size).toBe(0)
    })
})

// =============================================================================
// MOVES
// =============================================================================

describe('WorkspaceTreeService moves', () => {
    it('moves a workspace to a deep parent and back to the root, rewriting ancestor chains', async () => {
        const a = await createWorkspace('A')
        const b = await createWorkspace('B', a)
        const c = await createWorkspace('C', b)
        const target = await createWorkspace('Target')
        const deep = await createWorkspace('Deep', target)

        await harness.service.moveWorkspace('owner', {
            workspaceId: b,
            parentWorkspaceId: deep,
        })

        expect(metaOf(b)).toMatchObject({
            parentWorkspaceId: deep,
            ancestorIds: [target, deep],
        })
        expect(metaOf(c).ancestorIds).toEqual([target, deep, b])

        await harness.service.moveWorkspace('owner', { workspaceId: b })

        expect(metaOf(b).ancestorIds).toEqual([])
        expect(metaOf(b)).not.toHaveProperty('parentWorkspaceId')
        expect(metaOf(c).ancestorIds).toEqual([b])
        expect(outline((await orgTree()).roots)).toEqual(['A', ['Target', ['Deep']], ['B', ['C']]])
    })

    it('refuses cycles and moves across organizations', async () => {
        const a = await createWorkspace('A')
        const b = await createWorkspace('B', a)
        const elsewhere = await createWorkspace('Elsewhere', undefined, 'org-2')

        await expect(harness.service.moveWorkspace('owner', {
            workspaceId: a,
            parentWorkspaceId: b,
        })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_CYCLE' })
        await expect(harness.service.moveWorkspace('owner', {
            workspaceId: a,
            parentWorkspaceId: a,
        })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_CYCLE' })
        await expect(harness.service.moveWorkspace('owner', {
            workspaceId: a,
            parentWorkspaceId: elsewhere,
        })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_CROSS_ORGANIZATION' })
    })

    it('moves a heading with its section, carrying lower-level headings', async () => {
        await createHeading('Clients', 1)
        await createWorkspace('Acme')
        await createHeading('Retainers', 2)
        await createWorkspace('Globex')
        const archive = await createHeading('Archive', 1)
        const target = await createWorkspace('Target')
        const clients = (await orgTree()).roots[0] as Extract<WorkspaceTreeEntry, { entryType: 'heading' }>

        await harness.service.moveHeading('owner', {
            organizationId: 'org-1',
            headingId: clients.heading.headingId,
            afterEntryId: target,
        })

        expect(outline((await orgTree()).roots)).toEqual([
            '# Archive',
            'Target',
            '# Clients',
            'Acme',
            '## Retainers',
            'Globex',
        ])
        expect(archive).toBeDefined()

        const acme = [...harness.repository.metas.values()].find(meta => meta.name === 'Acme')!
        expect(acme.ancestorIds).toEqual([])
    })

    it('reports a busy organization while a structure change holds the lock', async () => {
        const a = await createWorkspace('A')
        await harness.repository.acquireLock({
            organizationId: 'org-1',
            operationId: 'other',
            operation: 'move',
            entryId: a,
            userId: 'owner',
            phase: 'start',
            parameters: {},
            acquiredAt: harness.clock.now,
            expiresAt: harness.clock.now + 30_000,
        })

        await expect(createWorkspace('B')).rejects.toMatchObject({ code: 'WORKSPACE_TREE_BUSY' })
        await expect(harness.service.moveWorkspace('owner', { workspaceId: a })).rejects.toMatchObject({ code: 'WORKSPACE_TREE_BUSY' })
    })
})

// =============================================================================
// RECOVERY
// =============================================================================

// Fails the Nth locked commit, as if the process stopped there.
const crashOnLockedCommit = (failAt: number): void => {
    let lockedCommits = 0
    harness.repository.beforeCommit = commit => {
        if (!commit.lockOperationId)
            return

        lockedCommits += 1

        if (lockedCommits === failAt)
            throw new Error('PROCESS_STOPPED')
    }
}

describe('WorkspaceTreeService recovery', () => {
    it('finishes an interrupted move from the sweep', async () => {
        const a = await createWorkspace('A')
        const b = await createWorkspace('B', a)
        await createWorkspace('C', b)
        const target = await createWorkspace('Target')
        // The first locked commit rewrites the descendants; stop before the swap.
        crashOnLockedCommit(2)

        await expect(harness.service.moveWorkspace('owner', {
            workspaceId: b,
            parentWorkspaceId: target,
        })).rejects.toThrow('PROCESS_STOPPED')
        expect(harness.repository.locks.size).toBe(1)

        harness.repository.beforeCommit = undefined
        harness.clock.now += 60_000

        expect(await harness.service.resumeExpiredOperations()).toBe(1)
        expect(harness.repository.locks.size).toBe(0)
        expect(outline((await orgTree()).roots)).toEqual(['A', ['Target', [['B', ['C']]]]])
    })

    it('finishes an interrupted section move when the next structure change finds the expired lock', async () => {
        const clients = await createHeading('Clients', 1)
        await createWorkspace('Acme')
        await createWorkspace('Globex')
        await createHeading('Other', 1)
        const target = await createWorkspace('Target')
        crashOnLockedCommit(2)

        await expect(harness.service.moveHeading('owner', {
            organizationId: 'org-1',
            headingId: clients,
            afterEntryId: target,
        })).rejects.toThrow('PROCESS_STOPPED')

        harness.repository.beforeCommit = undefined
        harness.clock.now += 60_000
        await createWorkspace('After')

        expect(outline((await orgTree()).roots)).toEqual(['# Other', 'Target', '# Clients', 'Acme', 'Globex', 'After'])
    })

    it('deletes a three-level subtree deepest first and finishes an interrupted delete', async () => {
        const top = await createWorkspace('Top')
        const middle = await createWorkspace('Middle', top)
        const bottom = await createWorkspace('Bottom', middle)
        await createHeading('Inside', 0, middle)
        await createWorkspace('Keep')
        harness.repository.putGrant({
            userId: 'member',
            workspaceId: middle,
            accessLevel: 'editor',
        })
        // Mark commits once, then each workspace removal commits once.
        crashOnLockedCommit(3)

        await expect(harness.service.deleteWorkspace('owner', top)).rejects.toThrow('PROCESS_STOPPED')
        expect(metaOf(top).deletingAt).toBeDefined()
        expect(harness.repository.metas.has(bottom)).toBe(false)
        expect((await harness.service.access.resolve({
            userId: 'member',
            workspaceId: middle,
        })).status).toBe('deleting')

        harness.repository.beforeCommit = undefined
        harness.clock.now += 60_000
        await harness.service.resumeExpiredOperations()

        for (const workspaceId of [top, middle, bottom])
            expect(harness.repository.metas.has(workspaceId)).toBe(false)

        expect([...harness.repository.grants.values()].some(grant => grant.workspaceId === middle)).toBe(false)
        expect(harness.repository.headingPointers.size).toBe(0)
        expect(outline((await orgTree()).roots)).toEqual(['Keep'])
        // Middle was cleaned before the crash and again after it, which is why
        // cleanup must be safe to repeat.
        expect(harness.deletion.cleanupWorkspace.mock.calls.map(([workspace]) => workspace.name)).toEqual(['Bottom', 'Middle', 'Middle', 'Top'])
        expect(harness.deletion.stopConversations).toHaveBeenCalled()
    })
})

// =============================================================================
// HANDLER PERMISSIONS
// =============================================================================

describe('workspace tree handlers', () => {
    const call = async (
        subject: string,
        userId: string,
        payload: Record<string, unknown>,
    ) => await createWorkspaceTreeHandlers(harness.service)[subject]({
        user: { userId },
        ...payload,
    })

    it('requires a signed-in user', async () => void expect(await createWorkspaceTreeHandlers(harness.service)['WORKSPACE_SUBJECTS.GET_USER_WORKSPACE_TREE']({})).toEqual({ error: 'UNAUTHORIZED' }))

    it('lets any member create a root workspace but needs organization editor for a root heading', async () => {
        expect(await call('WORKSPACE_SUBJECTS.CREATE_WORKSPACE', 'member', {
            organizationId: 'org-1',
            name: 'Mine',
        })).toMatchObject({ workspace: { name: 'Mine' } })
        expect(await call('WORKSPACE_SUBJECTS.CREATE_WORKSPACE_HEADING', 'member', {
            organizationId: 'org-1',
            name: 'Group',
            level: 1,
        })).toEqual({ error: 'PERMISSION_DENIED' })
        expect(await call('WORKSPACE_SUBJECTS.CREATE_WORKSPACE', 'stranger', {
            organizationId: 'org-1',
            name: 'Nope',
        })).toEqual({ error: 'PERMISSION_DENIED' })
    })

    it('needs editor on the parent for structure under a workspace and owner to delete', async () => {
        const parent = await createWorkspace('Parent')
        harness.repository.putGrant({
            userId: 'member',
            workspaceId: parent,
            accessLevel: 'viewer',
        })

        expect(await call('WORKSPACE_SUBJECTS.CREATE_WORKSPACE', 'member', {
            organizationId: 'org-1',
            parentWorkspaceId: parent,
            name: 'Child',
        })).toEqual({ error: 'PERMISSION_DENIED' })
        expect(await call('WORKSPACE_SUBJECTS.UPDATE_WORKSPACE', 'member', {
            workspaceId: parent,
            name: 'Renamed',
        })).toEqual({ error: 'PERMISSION_DENIED' })

        harness.repository.putGrant({
            userId: 'member',
            workspaceId: parent,
            accessLevel: 'editor',
        })

        expect(await call('WORKSPACE_SUBJECTS.CREATE_WORKSPACE_HEADING', 'member', {
            organizationId: 'org-1',
            parentWorkspaceId: parent,
            name: 'Group',
            level: 0,
        })).toHaveProperty('tree')
        expect(await call('WORKSPACE_SUBJECTS.DELETE_WORKSPACE', 'member', { workspaceId: parent })).toEqual({ error: 'PERMISSION_DENIED' })
        expect(await call('WORKSPACE_SUBJECTS.DELETE_WORKSPACE', 'owner', { workspaceId: parent })).toMatchObject({ deletedWorkspaceIds: [parent] })
    })

    it('needs editor on the moved workspace and on the destination', async () => {
        const source = await createWorkspace('Source')
        const destination = await createWorkspace('Destination')
        harness.repository.putGrant({
            userId: 'member',
            workspaceId: source,
            accessLevel: 'editor',
        })

        expect(await call('WORKSPACE_SUBJECTS.MOVE_WORKSPACE', 'member', {
            workspaceId: source,
            parentWorkspaceId: destination,
        })).toEqual({ error: 'PERMISSION_DENIED' })

        harness.repository.putGrant({
            userId: 'member',
            workspaceId: destination,
            accessLevel: 'editor',
        })

        expect(await call('WORKSPACE_SUBJECTS.MOVE_WORKSPACE', 'member', {
            workspaceId: source,
            parentWorkspaceId: destination,
        })).toHaveProperty('tree')
        // Moving to the root needs organization editor, which a viewer member lacks.
        expect(await call('WORKSPACE_SUBJECTS.MOVE_WORKSPACE', 'member', { workspaceId: source })).toEqual({ error: 'PERMISSION_DENIED' })
    })
})
