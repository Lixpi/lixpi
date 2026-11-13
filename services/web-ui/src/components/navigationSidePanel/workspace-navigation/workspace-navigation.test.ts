// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    NATS_SUBJECTS,
    type WorkspaceMeta,
    type WorkspaceNavigationDocument,
    type WorkspaceNavigationSnapshot,
    type WorkspaceTreeEntry,
} from '@lixpi/constants'
import {
    createNestedListSchema,
    parseNestedListDocument,
} from '@lixpi/prosemirror/shared/nested-list'
import {
    deleteNestedListItem,
    findNestedListEntry,
} from '@lixpi/prosemirror/frontend/nested-list'
import { TextSelection } from 'prosemirror-state'
import { undo, redo, closeHistory } from 'prosemirror-history'
import { resolve } from 'node:path'
import { settings } from '$src/settings.ts'
import { compileThemedStylesheet } from '@lixpi/test-utils/stylesheets'

import {
    createWorkspaceNavigation,
    type WorkspaceNavigationHandle,
} from './create-workspace-navigation.ts'
import {
    composeWorkspaceNavigation,
    splitWorkspaceNavigation,
} from './workspace-navigation-document.ts'
import {
    createWorkspaceTreeClient,
} from '$src/services/workspace-tree-client.ts'

const subjects = NATS_SUBJECTS.WORKSPACE_SUBJECTS

type FixtureItem = {
    id: string
    name?: string
    children?: FixtureItem[]
}

const workspaceMeta = (
    organizationId: string,
    item: FixtureItem,
): WorkspaceMeta => ({
    workspaceId: item.id,
    organizationId,
    name: item.name ?? item.id,
    tagIds: [],
    ancestorIds: [],
    position: 'V',
    createdAt: 1,
    updatedAt: 1,
})

const treeEntry = (
    organizationId: string,
    item: FixtureItem,
): WorkspaceTreeEntry => ({
    entryType: 'workspace',
    workspace: workspaceMeta(organizationId, item),
    accessLevel: 'owner',
    children: (item.children ?? []).map(child => treeEntry(organizationId, child)),
})

const workspaceItem = (
    item: FixtureItem,
): WorkspaceNavigationDocument => ({
    type: 'list_item',
    attrs: {
        entryId: item.id,
        itemType: 'workspace',
        data: { workspaceId: item.id },
        tagIds: [],
    },
    content: [
        {
            type: 'paragraph',
            attrs: {
                entryId: `title-${item.id}`,
                bold: false,
            },
            ...(item.name === '' ? {} : {
                content: [{
                    type: 'text',
                    text: item.name ?? item.id,
                }],
            }),
        },
        ...(item.children?.length
            ? [{
                type: 'bullet_list',
                attrs: { entryId: `children-${item.id}` },
                content: item.children.map(workspaceItem),
            }]
            : []),
    ],
})

const snapshot = (
    organizationId: string,
    roots: FixtureItem[] = [{ id: `${organizationId}-workspace` }],
    revision = 1,
): WorkspaceNavigationSnapshot => ({
    organizationId,
    revision,
    schemaVersion: 1,
    document: roots.length
        ? {
            type: 'doc',
            content: [{
                type: 'bullet_list',
                attrs: { entryId: 'shared-list' },
                content: roots.map(workspaceItem),
            }],
        }
        : {
            type: 'doc',
            content: [{
                type: 'paragraph',
                attrs: {
                    entryId: 'navigation-empty',
                    bold: false,
                },
            }],
        },
    tree: {
        organizationId,
        organizationName: organizationId,
        tags: {
            red: {
                name: 'Urgent',
                color: '#f00',
            },
        },
        roots: roots.map(item => treeEntry(organizationId, item)),
    },
})

type SavePayload = {
    organizationId: string
    baseRevision: number
    mutationId: string
    document: WorkspaceNavigationDocument
    deletedWorkspaceIds?: string[]
    createdWorkspaceIds?: string[]
}

const createServer = (
    initial: WorkspaceNavigationSnapshot[],
    onSave?: (payload: SavePayload, current: WorkspaceNavigationSnapshot) => unknown,
) => {
    const state = new Map(initial.map(item => [item.organizationId, item]))
    const calls: Array<{
        subject: string
        payload: Record<string, unknown>
    }> = []
    const request = vi.fn(async (subject: string, payload: Record<string, unknown>) => {
        calls.push({
            subject,
            payload,
        })

        if (subject === subjects.GET_USER_WORKSPACE_NAVIGATION)
            return { organizations: [...state.values()].map(item => structuredClone(item)) }

        if (subject === subjects.SAVE_WORKSPACE_NAVIGATION) {
            const body = payload as SavePayload
            const current = state.get(body.organizationId)!
            const reply = onSave?.(body, current) ?? {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: body.document,
                },
            }

            if ((reply as { snapshot?: WorkspaceNavigationSnapshot }).snapshot)
                state.set(body.organizationId, (reply as { snapshot: WorkspaceNavigationSnapshot }).snapshot)

            return reply
        }

        throw new Error(`Unexpected subject: ${subject}`)
    })

    return {
        state,
        calls,
        request,
    }
}

const handles: WorkspaceNavigationHandle[] = []

afterEach(() => {
    handles.splice(0).forEach(handle => handle.destroy())
    document.body.replaceChildren()
    vi.useRealTimers()
})

const mount = async (
    server: ReturnType<typeof createServer>,
    extraPorts: Record<string, unknown> = {},
) => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const ports = {
        request: server.request,
        navigate: vi.fn(),
        confirm: vi.fn(async () => true),
        reportError: vi.fn(),
        onWorkspaceCreated: vi.fn(),
        onWorkspacesDeleted: vi.fn(),
        ...extraPorts,
    }
    const navigation = createWorkspaceNavigation({
        container,
        ports,
    })
    handles.push(navigation)
    await navigation.refresh()

    return {
        container,
        navigation,
        ports,
    }
}

const autosave = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(settings.workspacePersistence.debounceMs))

const saves = (server: ReturnType<typeof createServer>): SavePayload[] =>
    server.calls
        .filter(call => call.subject === subjects.SAVE_WORKSPACE_NAVIGATION)
        .map(call => call.payload as SavePayload)

describe('workspace navigation document', () => {
    it('scopes duplicate ordinary IDs across organizations, including empty placeholders', () => {
        const first = snapshot('org-a', [])
        const second = snapshot('org-b', [])
        const composed = composeWorkspaceNavigation([first, second])
        const parsed = parseNestedListDocument(composed, createNestedListSchema())
        const split = splitWorkspaceNavigation(parsed)

        expect(split.get('org-a')).toEqual(first.document)
        expect(split.get('org-b')).toEqual(second.document)

        const a = snapshot('org-a', [{ id: 'workspace-a' }])
        const b = snapshot('org-b', [{ id: 'workspace-b' }])
        const mixed = parseNestedListDocument(composeWorkspaceNavigation([a, b]), createNestedListSchema())
        const duplicatePlainId = mixed.toJSON().content.map((org: any) => org.content[1].attrs.entryId)

        expect(new Set(duplicatePlainId).size).toBe(2)
        expect(splitWorkspaceNavigation(mixed).get('org-a')).toEqual(a.document)
        expect(splitWorkspaceNavigation(mixed).get('org-b')).toEqual(b.document)
    })
})

describe('workspace navigation empty body', () => {
    it('assigns an identity when the final body block is removed before autosave', () => {
        const initial = snapshot('org', [])
        const composed = composeWorkspaceNavigation([initial])
        const wrapper = composed.content![0]
        wrapper.content = wrapper.content!.slice(0, 1)
        const parsed = parseNestedListDocument(composed, createNestedListSchema())
        const split = splitWorkspaceNavigation(parsed, () => 'fresh-empty').get('org')!

        expect(split).toEqual({
            type: 'doc',
            content: [{
                type: 'paragraph',
                attrs: { entryId: 'fresh-empty' },
            }],
        })
        expect(parseNestedListDocument(split, createNestedListSchema())).toBeDefined()
    })
})

describe('workspace navigation client', () => {
    it('unwraps navigation snapshots and preserves stale snapshot errors', async () => {
        const current = snapshot('org-a')
        const server = createServer([current], () => ({
            error: 'WORKSPACE_NAVIGATION_STALE',
            snapshot: {
                ...current,
                revision: 2,
            },
        }))
        const client = createWorkspaceTreeClient(server.request, async () => undefined)

        expect((await client.getNavigation()).organizations).toHaveLength(1)
        await expect(client.saveNavigation({
            organizationId: 'org-a',
            baseRevision: 1,
            mutationId: 'mutation',
            document: current.document,
        })).rejects.toMatchObject({
            code: 'WORKSPACE_NAVIGATION_STALE',
            snapshot: { revision: 2 },
        })
        expect(server.calls.map(call => call.subject)).toEqual([
            subjects.GET_USER_WORKSPACE_NAVIGATION,
            subjects.SAVE_WORKSPACE_NAVIGATION,
        ])
    })
})

describe('workspace navigation adapter', () => {
    it('expands the hidden single-organization wrapper while retaining workspace and plain-group collapse', async () => {
        const current = snapshot('org-a', [{
            id: 'one',
            children: [{ id: 'child' }],
        }])
        const plain = workspaceItem({
            id: 'plain',
            name: 'Group',
        })
        plain.attrs!.itemType = 'text'
        plain.attrs!.data = null
        plain.content!.push({
            type: 'bullet_list',
            attrs: { entryId: 'plain-children' },
            content: current.document.content![0].content!,
        })
        current.document.content![0].content = [plain]
        const server = createServer([current])
        const save = vi.fn()
        const {
            navigation,
            container,
        } = await mount(server, {
            collapsed: {
                load: () => ['navigation-organization:org-a', 'one', 'navigation-block:org-a:plain'],
                save,
            },
        })

        expect(container.classList.contains('workspace-navigation-single-organization')).toBe(true)
        expect(navigation.list.collapsed).toEqual(new Set([
            'one',
            'navigation-block:org-a:plain',
        ]))
        expect(container.querySelector('[data-entry-id="navigation-organization:org-a"]')?.classList.contains('nested-list-collapsed')).toBe(false)
        expect(save).toHaveBeenLastCalledWith(['one', 'navigation-block:org-a:plain'])

        server.state.set('org-b', snapshot('org-b'))
        await navigation.refresh()
        navigation.list.setCollapsed(['navigation-organization:org-a', 'one', 'navigation-block:org-a:plain'])
        server.state.delete('org-b')
        await navigation.refresh()
        expect(navigation.list.collapsed).toEqual(new Set([
            'one',
            'navigation-block:org-a:plain',
        ]))
    })

    it('shows a body-mounted trigger popup above the sidebar with readable inherited menu text', async () => {
        const packages = resolve(import.meta.dirname, '../../../../packages/lixpi')
        const [bubbleCss, sidebarCss, navigationCss] = await Promise.all([
            compileThemedStylesheet(resolve(packages, 'ui-kit/src/components/bubbleMenu/bubbleMenu.scss')),
            compileThemedStylesheet(resolve(packages, 'ui-kit/styles/navigation-side-panel.scss')),
            compileThemedStylesheet(resolve(import.meta.dirname, 'workspace-navigation.scss')),
        ])
        const stylesheet = document.createElement('style')
        stylesheet.textContent = `${bubbleCss}
${sidebarCss}
${navigationCss}`
        document.head.appendChild(stylesheet)
        const previousColor = document.body.style.color
        document.body.style.color = 'rgb(1, 2, 3)'

        try {
            const sidebar = document.createElement('div')
            sidebar.className = 'navigation-side-panel'
            document.body.appendChild(sidebar)
            const server = createServer([snapshot('org-a', [{ id: 'one' }])])
            const { container } = await mount(server)
            sidebar.appendChild(container)
            const row = container.querySelector<HTMLElement>('[data-entry-id="one"]')!
            const trigger = container.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!
            vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 28, 18, 18))
            row.querySelector('p')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
            trigger.click()
            const popup = document.querySelector<HTMLElement>('.nested-list-block-bubble')!
            const rootOption = popup.querySelector<HTMLButtonElement>('.nested-list-block-toolbar [aria-label="More"]')!
            const popupColor = getComputedStyle(popup).color

            expect(popup.classList.contains('is-visible')).toBe(true)
            expect(popup.parentElement).toBe(document.body)
            expect(popup.style.zIndex).toBe('')
            expect(Number(getComputedStyle(sidebar).zIndex)).toBeGreaterThan(0)
            expect(Number(getComputedStyle(popup).zIndex)).toBeGreaterThan(Number(getComputedStyle(sidebar).zIndex))
            expect(popupColor.trim()).not.toBe('')
            expect(popupColor).not.toBe(getComputedStyle(document.body).color)
            expect(getComputedStyle(rootOption).color).toBe(popupColor)
            rootOption.click()
            const submenuOption = popup.querySelector<HTMLButtonElement>('.nested-list-block-panel .nested-list-block-menu-item')!
            expect(getComputedStyle(submenuOption).color).toBe(popupColor)
        } finally {
            stylesheet.remove()
            document.body.style.color = previousColor
        }
    })

    it.each(['Section', ''])('splits a guarded organization heading into body paragraphs (%s)', async text => {
        const current = snapshot('org-a', [])
        current.document.content = [{
            type: 'heading',
            attrs: {
                entryId: 'section',
                level: 2,
                bold: false,
            },
            ...(text ? { content: [{
                type: 'text',
                text,
            }] } : {}),
        }]
        const server = createServer([current])
        const { navigation } = await mount(server)
        const view = navigation.list.view
        const originalWrapper = findNestedListEntry(view.state.doc, 'navigation-organization:org-a')!.node
        navigation.list.enterEdit()
        const heading = findNestedListEntry(view.state.doc, 'navigation-block:org-a:section')!
        view.dispatch(view.state.tr.setSelection(TextSelection.create(
            view.state.doc,
            heading.pos + 1 + heading.node.content.size,
        )))
        const pressEnter = (): void => {
            view.dom.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
            }))
        }
        pressEnter()

        let wrapper = findNestedListEntry(view.state.doc, 'navigation-organization:org-a')!.node
        expect(wrapper.attrs).toEqual(originalWrapper.attrs)
        expect(wrapper.firstChild?.eq(originalWrapper.firstChild!)).toBe(true)
        expect(wrapper.childCount).toBe(3)
        expect(wrapper.child(1).type.name).toBe('heading')
        expect(wrapper.child(1).attrs.entryId).toBe('navigation-block:org-a:section')
        expect(wrapper.child(2).type.name).toBe('paragraph')
        expect(wrapper.child(2).attrs.entryId).not.toBe(wrapper.child(1).attrs.entryId)
        expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
        view.dispatch(view.state.tr.insertText('First body'))
        pressEnter()
        expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
        pressEnter()
        expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
        view.dispatch(view.state.tr.insertText('Third body'))

        wrapper = findNestedListEntry(view.state.doc, 'navigation-organization:org-a')!.node
        expect(wrapper.childCount).toBe(5)
        expect(wrapper.child(2).textContent).toBe('First body')
        expect(wrapper.child(3).textContent).toBe('')
        expect(wrapper.child(4).textContent).toBe('Third body')
        await autosave()
        expect(saves(server)).toHaveLength(1)
        expect(saves(server)[0]!.document.content!.map(block => block.type)).toEqual([
            'heading',
            'paragraph',
            'paragraph',
            'paragraph',
        ])
        await navigation.refresh()
        wrapper = findNestedListEntry(view.state.doc, 'navigation-organization:org-a')!.node
        expect(wrapper.child(2).textContent).toBe('First body')
        expect(wrapper.child(3).textContent).toBe('')
        expect(wrapper.child(4).textContent).toBe('Third body')
    })

    it('lifts an empty plain child item within the protected organization and saves typed text', async () => {
        const current = snapshot('org-a', [{ id: 'one' }])
        current.document.content![0].content!.push({
            type: 'list_item',
            attrs: {
                entryId: 'empty-note-item',
                itemType: 'text',
                data: null,
                tagIds: [],
            },
            content: [{
                type: 'paragraph',
                attrs: {
                    entryId: 'empty-note-label',
                    bold: false,
                },
            }],
        })
        const server = createServer([current])
        const { navigation } = await mount(server)
        const view = navigation.list.view
        const originalWrapper = findNestedListEntry(view.state.doc, 'navigation-organization:org-a')!.node
        navigation.list.enterEdit()
        const empty = findNestedListEntry(view.state.doc, 'navigation-block:org-a:empty-note-label')!
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, empty.pos + 1)))
        view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
        }))

        const wrapper = findNestedListEntry(view.state.doc, 'navigation-organization:org-a')!.node
        expect(wrapper.attrs).toEqual(originalWrapper.attrs)
        expect(wrapper.firstChild?.eq(originalWrapper.firstChild!)).toBe(true)
        expect(wrapper.childCount).toBe(3)
        expect(findNestedListEntry(view.state.doc, 'one')).toBeDefined()
        expect(wrapper.child(2).type.name).toBe('paragraph')
        expect(wrapper.child(2).attrs.entryId).toBe('navigation-block:org-a:empty-note-label')
        expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
        view.dispatch(view.state.tr.insertText('A note'))
        await autosave()
        expect(saves(server)[0]!.document.content!.map(block => block.type)).toEqual([
            'bullet_list',
            'paragraph',
        ])
        await navigation.refresh()
        expect(findNestedListEntry(view.state.doc, 'one')).toBeDefined()
        expect(findNestedListEntry(view.state.doc, 'navigation-block:org-a:empty-note-label')?.node.textContent).toBe('A note')
    })

    it.each([
        {
            name: 'Alpha',
            offset: 0,
        },
        {
            name: 'Alpha',
            offset: 2,
        },
        {
            name: 'Alpha',
            offset: 5,
        },
        {
            name: '',
            offset: 0,
        },
    ])('saves and exits on Enter at $offset in workspace title "$name" without changing the list', async ({
        name,
        offset,
    }) => {
        const server = createServer([snapshot('org-a', [{
            id: 'one',
            name: 'Original',
            children: [{ id: 'child' }],
        }, { id: 'two' }])])
        const { navigation } = await mount(server)
        const view = navigation.list.view
        navigation.list.enterEdit()
        const workspace = findNestedListEntry(view.state.doc, 'one')!
        view.dispatch(view.state.tr.insertText(name, workspace.pos + 2, workspace.pos + 2 + 'Original'.length))
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, workspace.pos + 2 + offset)))
        view.focus()
        const beforeEnter = view.state.doc
        expect(saves(server)).toHaveLength(0)
        view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))

        expect(view.state.doc.eq(beforeEnter)).toBe(true)
        expect(navigation.list.mode).toBe('view')
        expect(view.hasFocus()).toBe(false)
        expect(findNestedListEntry(view.state.doc, 'one')!.node.firstChild!.textContent).toBe(name)
        expect(findNestedListEntry(view.state.doc, 'child')).toBeDefined()
        await vi.advanceTimersByTimeAsync(0)
        expect(saves(server)).toHaveLength(1)
        expect(saves(server)[0]!.createdWorkspaceIds).toBeUndefined()
        expect(saves(server)[0]!.document.content![0].content![0].content![0].content?.[0]?.text ?? '').toBe(name)
        expect(server.calls.some(call => call.subject === subjects.CREATE_WORKSPACE)).toBe(false)
    })

    it('consumes workspace Enter without splitting a noneditable title', async () => {
        const initial = snapshot('org-a', [{
            id: 'one',
            name: 'Alpha',
        }])
        const entry = initial.tree.roots[0]!

        if (entry.entryType !== 'workspace')
            throw new Error('Expected a workspace fixture')

        entry.accessLevel = 'viewer'
        const server = createServer([initial])
        const { navigation } = await mount(server)
        const view = navigation.list.view
        navigation.list.enterEdit()
        const source = findNestedListEntry(view.state.doc, 'one')!
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, source.pos + 4)))
        const before = view.state.doc
        view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        expect(view.state.doc.eq(before)).toBe(true)
        await autosave()
        expect(saves(server)).toHaveLength(0)
    })

    it('flushes only the current workspace organization immediately on Enter', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }]), snapshot('org-b', [{ id: 'two' }])])
        const { navigation } = await mount(server)
        const view = navigation.list.view
        navigation.list.enterEdit()

        for (const id of ['two', 'one']) {
            const source = findNestedListEntry(view.state.doc, id)!
            view.dispatch(view.state.tr.insertText('Edited', source.pos + 2, source.pos + 2 + id.length))
        }

        const source = findNestedListEntry(view.state.doc, 'one')!
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, source.pos + 3)))
        view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        await vi.advanceTimersByTimeAsync(0)
        expect(saves(server).map(request => request.organizationId)).toEqual(['org-a'])
        expect(navigation.list.mode).toBe('view')
        expect(navigation.hasPendingChanges()).toBe(true)
    })

    it('retains the edited title and subtree when the immediate Enter save conflicts', async () => {
        const initial = snapshot('org-a', [{
            id: 'one',
            children: [{ id: 'child' }],
        }])
        const server = createServer([initial], () => ({
            error: 'WORKSPACE_NAVIGATION_STALE',
            snapshot: {
                ...initial,
                revision: 2,
            },
        }))
        const { navigation } = await mount(server)
        const view = navigation.list.view
        navigation.list.enterEdit()
        const source = findNestedListEntry(view.state.doc, 'one')!
        view.dispatch(view.state.tr.insertText('Unsaved', source.pos + 2, source.pos + 5))
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, source.pos + 3)))
        const beforeEnter = view.state.doc
        view.dom.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        }))
        await vi.advanceTimersByTimeAsync(0)
        expect(navigation.list.mode).toBe('view')
        expect(view.state.doc.eq(beforeEnter)).toBe(true)
        expect(navigation.hasPendingChanges()).toBe(true)
        expect(saves(server)[0]!.createdWorkspaceIds).toBeUndefined()
    })

    it('uses one trigger menu to queue a sibling workspace below the hovered row', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }, { id: 'two' }])])
        const {
            navigation,
            container,
        } = await mount(server)
        const row = container.querySelector<HTMLElement>('[data-entry-id="one"]')!
        row.querySelector('p')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        expect(row.querySelector('.workspace-navigation-row-menu')).toBeNull()

        const trigger = container.querySelector<HTMLButtonElement>('.nested-list-block-trigger')!
        expect(trigger).not.toBeNull()
        trigger.click()
        const option = (label: string): HTMLButtonElement =>
            [...document.querySelectorAll<HTMLButtonElement>('.nested-list-block-bubble button')]
                .find(button => button.getAttribute('aria-label') === label)!
        option('More').click()
        const panel = document.querySelector<HTMLElement>('.nested-list-block-panel')!
        expect(panel.classList.contains('nested-list-block-panel-text')).toBe(true)
        expect(option('Tags').textContent).toBe('Tags')
        option('Insert new block').click()
        expect(panel.classList.contains('nested-list-block-panel-text')).toBe(false)
        expect(panel.querySelectorAll('.bubble-menu-dropdown-item')).toHaveLength(5)
        expect(panel.querySelector('[aria-label="Bulleted list"]')).toBeNull()
        expect(option('Workspace').querySelector('svg')).not.toBeNull()
        option('Workspace').click()

        expect(navigation.list.mode).toBe('edit')
        expect(saves(server)).toHaveLength(0)
        const existing = findNestedListEntry(navigation.list.view.state.doc, 'one')!
        const at = navigation.list.view.state.doc.resolve(existing.pos)
        const sibling = at.parent.child(at.index() + 1)
        expect(sibling.attrs.itemType).toBe('workspace')
        expect(sibling.attrs.entryId).not.toBe('two')
        expect(sibling.firstChild?.textContent).toBe('New Workspace')

        await autosave()
        expect(saves(server)[0]?.createdWorkspaceIds).toEqual([sibling.attrs.entryId])
    })

    it('reuses a fresh empty-body ID and mutation ID when autosave retries', async () => {
        let attempts = 0
        const server = createServer([snapshot('org-a', [])], (payload, current) => {
            if (attempts++ === 0)
                throw new Error('TEMPORARY_FAILURE')

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        navigation.list.enterEdit()
        const view = navigation.list.view
        const body = findNestedListEntry(view.state.doc, 'navigation-block:org-a:navigation-empty')!
        view.dispatch(view.state.tr.delete(body.pos, body.pos + body.node.nodeSize))

        await autosave()
        await autosave()
        const first = saves(server)[0]!
        const second = saves(server)[1]!
        const id = first.document.content![0].attrs!.entryId
        expect(typeof id).toBe('string')
        expect(id).not.toBe('navigation-empty')
        expect(second.document.content![0].attrs!.entryId).toBe(id)
        expect(second.mutationId).toBe(first.mutationId)
    })

    it('waits for rate admission and retries the exact request identity', async () => {
        let attempts = 0
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], (payload, current) => {
            if (attempts++ === 0)
                return {
                    error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
                    retryAfterMs: 5000,
                }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        navigation.setTag('one', 'red', true)
        await autosave()
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(4999)
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]).toEqual(saves(server)[0])
    })

    it('keeps the rate retry deadline when another edit occurs during backoff', async () => {
        let attempts = 0
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], (payload, current) => {
            if (attempts++ === 0)
                return {
                    error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
                    retryAfterMs: 5000,
                }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        expect(navigation.setTag('one', 'red', true)).toBe(true)
        await autosave()
        expect(saves(server)).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(1000)
        expect(navigation.setTag('one', 'red', false)).toBe(true)
        await vi.advanceTimersByTimeAsync(3999)
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]).toEqual(saves(server)[0])
    })

    it('flushes cleanly without a request and saves pending edits before the debounce', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }])])
        const { navigation } = await mount(server)
        expect(navigation.hasPendingChanges()).toBe(false)
        expect(await navigation.flushPendingChanges()).toBe(true)
        expect(saves(server)).toHaveLength(0)

        navigation.setTag('one', 'red', true)
        expect(navigation.hasPendingChanges()).toBe(true)
        expect(await navigation.flushPendingChanges()).toBe(true)
        expect(saves(server)).toHaveLength(1)
        expect(navigation.hasPendingChanges()).toBe(false)
    })

    it('shares a leave flush and drains edits made during an in-flight save', async () => {
        const initial = snapshot('org-a', [{ id: 'one' }])
        const pending = Promise.withResolvers<{ snapshot: WorkspaceNavigationSnapshot }>()
        let attempts = 0
        const server = createServer([initial], (payload, current) => {
            if (attempts++ === 0)
                return pending.promise

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        navigation.setTag('one', 'red', true)
        const flush = navigation.flushPendingChanges()
        expect(navigation.flushPendingChanges()).toBe(flush)
        expect(saves(server)).toHaveLength(1)
        navigation.setTag('one', 'red', false)
        const first = saves(server)[0]!
        const acknowledged = {
            ...initial,
            revision: 2,
            document: first.document,
        }
        server.state.set('org-a', acknowledged)
        pending.resolve({ snapshot: acknowledged })
        expect(await flush).toBe(true)
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]!.baseRevision).toBe(2)
        expect(saves(server)[1]!.mutationId).not.toBe(first.mutationId)
        expect(navigation.hasPendingChanges()).toBe(false)
    })

    it('waits for the server rate deadline during a leave flush', async () => {
        let attempts = 0
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], (payload, current) => {
            if (attempts++ === 0)
                return {
                    error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
                    retryAfterMs: 5000,
                }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        navigation.setTag('one', 'red', true)
        const flush = navigation.flushPendingChanges()
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(4999)
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(await flush).toBe(true)
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]).toEqual(saves(server)[0])
    })

    it('uses the configured debounce when a rate reply has no positive retry hint', async () => {
        let attempts = 0
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], (payload, current) => {
            if (attempts++ === 0)
                return {
                    error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
                    retryAfterMs: 0,
                }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        navigation.setTag('one', 'red', true)
        const flush = navigation.flushPendingChanges()
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(settings.workspacePersistence.debounceMs - 1)
        expect(saves(server)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(await flush).toBe(true)
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]).toEqual(saves(server)[0])
    })

    it('cancels a pending rate wait when navigation is destroyed', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], () => ({
            error: 'WORKSPACE_NAVIGATION_RATE_LIMITED',
            retryAfterMs: 5000,
        }))
        const { navigation } = await mount(server)
        navigation.setTag('one', 'red', true)
        const flush = navigation.flushPendingChanges()
        await vi.advanceTimersByTimeAsync(0)
        expect(saves(server)).toHaveLength(1)
        navigation.destroy()
        expect(await flush).toBe(false)
        await vi.advanceTimersByTimeAsync(5000)
        expect(saves(server)).toHaveLength(1)
        handles.splice(handles.indexOf(navigation), 1)
    })

    it('batches text and tags within the autosave debounce', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }])])
        const { navigation } = await mount(server)

        expect(navigation.setTag('one', 'red', true)).toBe(true)
        expect(navigation.list.mode).toBe('edit')
        expect(saves(server)).toHaveLength(0)
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.attrs.tagIds).toEqual(['org-a:red'])

        await autosave()
        expect(saves(server)).toHaveLength(1)
        expect(saves(server)[0]!.baseRevision).toBe(1)
        expect(JSON.stringify(saves(server)[0]!.document)).toContain('"tagIds":["red"]')
        expect(navigation.list.mode).toBe('edit')
    })

    it('retries only the failed organization with the same mutation ID', async () => {
        let secondAttempts = 0
        const server = createServer([
            snapshot('org-a', [{ id: 'a' }]),
            snapshot('org-b', [{ id: 'b' }]),
        ], (payload, current) => {
            if (
                payload.organizationId === 'org-b'
                && secondAttempts++ === 0
            )
                throw new Error('TEMPORARY_FAILURE')

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)

        navigation.setTag('a', 'red', true)
        navigation.setTag('b', 'red', true)

        await autosave()
        expect(navigation.list.mode).toBe('edit')
        expect(saves(server).map(call => call.organizationId)).toEqual(['org-a', 'org-b'])

        const failedMutationId = saves(server)[1]!.mutationId
        await autosave()
        expect(saves(server).map(call => call.organizationId)).toEqual(['org-a', 'org-b', 'org-b'])
        expect(saves(server)[2]!.mutationId).toBe(failedMutationId)
        expect(saves(server)[2]!.baseRevision).toBe(1)
    })

    it('continues saving other organizations when the first one fails', async () => {
        let firstAttempts = 0
        const server = createServer([
            snapshot('org-a', [{ id: 'a' }]),
            snapshot('org-b', [{ id: 'b' }]),
        ], (payload, current) => {
            if (
                payload.organizationId === 'org-a'
                && firstAttempts++ === 0
            )
                throw new Error('TEMPORARY_FAILURE')

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)

        navigation.setTag('a', 'red', true)
        navigation.setTag('b', 'red', true)

        await autosave()
        expect(saves(server).map(call => call.organizationId)).toEqual(['org-a', 'org-b'])
        expect(navigation.list.mode).toBe('edit')

        await autosave()
        expect(saves(server).map(call => call.organizationId)).toEqual(['org-a', 'org-b', 'org-a'])
        expect(saves(server)[2]!.mutationId).toBe(saves(server)[0]!.mutationId)
    })

    it('keeps typing during an in-flight save and sends the newer document after its acknowledgement', async () => {
        let acknowledge!: (reply: unknown) => void
        let attempts = 0
        const initial = snapshot('org-a', [{ id: 'one' }])
        const server = createServer([initial], (payload, current) => {
            if (attempts++ === 0)
                return new Promise(resolve => void (acknowledge = resolve))

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        expect(navigation.setTag('one', 'red', true)).toBe(true)
        await autosave()
        expect(saves(server)).toHaveLength(1)
        expect(navigation.setTag('one', 'red', false)).toBe(true)
        await autosave()
        expect(saves(server)).toHaveLength(1)
        const first = saves(server)[0]!
        const accepted = {
            ...initial,
            revision: 2,
            document: first.document,
        }
        server.state.set('org-a', accepted)
        acknowledge({ snapshot: accepted })
        await Promise.resolve()
        await autosave()
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]!.baseRevision).toBe(2)
        expect(saves(server)[1]!.document.content![0].content![0].attrs!.tagIds).toEqual([])
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.attrs.tagIds).toEqual([])
    })

    it('keeps a permanent error visible and retries only on the explicit action', async () => {
        let attempts = 0
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], (payload, current) => {
            if (attempts++ === 0)
                return { error: 'WORKSPACE_NAVIGATION_INVALID' }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const {
            navigation,
            ports,
        } = await mount(server)
        navigation.setTag('one', 'red', true)
        await autosave()
        await autosave()
        expect(saves(server)).toHaveLength(1)
        expect(ports.reportError).toHaveBeenCalledWith(
            'The navigation could not be saved. Local changes are retained.',
            expect.objectContaining({ code: 'WORKSPACE_NAVIGATION_INVALID' }),
        )
        const status = document.querySelector<HTMLElement>('.workspace-navigation-status')!
        expect(status.hidden).toBe(false)
        const view = navigation.list.view
        const item = findNestedListEntry(view.state.doc, 'one')!
        view.dispatch(view.state.tr.insertText(' fixed', item.pos + 2 + item.node.firstChild!.content.size))
        await autosave()
        expect(saves(server)).toHaveLength(1)
        status.querySelector<HTMLButtonElement>('.workspace-navigation-status-action')!.click()
        await vi.advanceTimersByTimeAsync(0)
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]!.mutationId).not.toBe(saves(server)[0]!.mutationId)
        expect(saves(server)[1]!.document).not.toEqual(saves(server)[0]!.document)
        expect(status.hidden).toBe(true)
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.attrs.tagIds).toEqual(['org-a:red'])
    })

    it('stops a pending debounce when navigation is destroyed', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }])])
        const { navigation } = await mount(server)
        navigation.setTag('one', 'red', true)
        navigation.destroy()
        handles.splice(handles.indexOf(navigation), 1)
        await autosave()
        expect(saves(server)).toHaveLength(0)
        expect(document.querySelector('.workspace-navigation-status')).toBeNull()
    })

    it('preserves unrelated editor undo history after another organization acknowledges', async () => {
        const server = createServer([
            snapshot('org-a', [{ id: 'a' }]),
            snapshot('org-b', [{ id: 'b' }]),
        ])
        const { navigation } = await mount(server)
        navigation.setTag('a', 'red', true)
        navigation.list.view.dispatch(closeHistory(navigation.list.view.state.tr))
        navigation.setTag('b', 'red', true)
        await autosave()
        expect(saves(server)).toHaveLength(2)
        const before = navigation.list.view.state.doc
        expect(undo(navigation.list.view.state, navigation.list.view.dispatch)).toBe(true)
        expect(navigation.list.view.state.doc.eq(before)).toBe(false)
    })

    it('does not advance an acknowledged base until a clean edit session accepts a refreshed document', async () => {
        const original = snapshot('org-a', [{ id: 'one' }])
        const newer = snapshot('org-a', [{
            id: 'one',
            name: 'Remote',
        }], 2)
        const server = createServer([original])
        const { navigation } = await mount(server)
        navigation.list.enterEdit()
        server.state.set('org-a', newer)
        await navigation.refresh()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.firstChild?.textContent).toBe('one')
        navigation.list.exitEdit()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.firstChild?.textContent).toBe('Remote')
        expect(navigation.setTag('one', 'red', true)).toBe(true)
        await autosave()
        expect(saves(server)[0]!.baseRevision).toBe(2)
    })

    it('does not advance a clean organization baseline when another organization has pending edits', async () => {
        const originalA = snapshot('org-a', [{ id: 'a' }])
        const originalB = snapshot('org-b', [{ id: 'b' }])
        const remoteB = snapshot('org-b', [{
            id: 'b',
            name: 'Remote B',
        }], 2)
        const server = createServer([originalA, originalB], (payload, current) => {
            if (
                payload.organizationId === 'org-b'
                && payload.baseRevision !== current.revision
            )
                return {
                    error: 'WORKSPACE_NAVIGATION_STALE',
                    snapshot: current,
                }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const confirm = vi.fn(async () => false)
        const { navigation } = await mount(server, { confirm })
        navigation.setTag('a', 'red', true)
        navigation.list.exitEdit()
        server.state.set('org-b', remoteB)
        await navigation.refresh()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'b')?.node.firstChild?.textContent).toBe('b')
        navigation.setTag('b', 'red', true)
        await autosave()
        expect(saves(server).find(call => call.organizationId === 'org-b')?.baseRevision).toBe(1)
        expect(confirm).not.toHaveBeenCalled()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'b')?.node.firstChild?.textContent).toBe('b')
        expect(findNestedListEntry(navigation.list.view.state.doc, 'a')?.node.attrs.tagIds).toEqual(['org-a:red'])
    })

    it('offers confirmed reload for a stale organization while retaining local edits until acceptance', async () => {
        const newer = snapshot('org-a', [{
            id: 'one',
            name: 'Changed elsewhere',
        }], 2)
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], () => ({
            error: 'WORKSPACE_NAVIGATION_STALE',
            snapshot: newer,
        }))
        const confirm = vi.fn(async () => true)
        const {
            navigation,
            ports,
        } = await mount(server, { confirm })

        navigation.setTag('one', 'red', true)
        navigation.list.exitEdit()
        await autosave()
        expect(confirm).not.toHaveBeenCalled()
        document.querySelector<HTMLButtonElement>('.workspace-navigation-status-action')!.click()
        await vi.advanceTimersByTimeAsync(0)
        expect(confirm).toHaveBeenCalledWith('The navigation changed elsewhere. Reload this organization and discard its local edits?')
        expect(ports.reportError).toHaveBeenCalledWith(
            'The navigation changed elsewhere. Local changes are retained.',
            expect.objectContaining({ code: 'WORKSPACE_NAVIGATION_STALE' }),
        )
        expect(navigation.list.mode).toBe('view')
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.firstChild?.textContent).toBe('Changed elsewhere')
    })

    it('keeps local edits when a lost-response retry acknowledges a newer remote document', async () => {
        const initial = snapshot('org-a', [{ id: 'one' }])
        const remote = snapshot('org-a', [{
            id: 'one',
            name: 'Remote',
        }], 3)
        let attempts = 0
        const server = createServer([initial], () => {
            if (attempts++ === 0) {
                server.state.set('org-a', remote)

                throw new Error('Reply lost after commit')
            }

            return { snapshot: remote }
        })
        const confirm = vi.fn(async () => false)
        const { navigation } = await mount(server, { confirm })
        navigation.setTag('one', 'red', true)
        await autosave()
        await autosave()
        const requests = saves(server)
        expect(requests).toHaveLength(2)
        expect(requests[1]).toEqual(requests[0])
        expect(confirm).not.toHaveBeenCalled()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.firstChild?.textContent).toBe('one')
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.attrs.tagIds).toEqual(['org-a:red'])
        expect(document.querySelector<HTMLElement>('.workspace-navigation-status')!.hidden).toBe(false)
        await autosave()
        expect(saves(server)).toHaveLength(2)
    })

    it('keeps a conflicted organization pending after local text returns to its old baseline', async () => {
        const initial = snapshot('org-a', [{ id: 'one' }])
        const remote = snapshot('org-a', [{
            id: 'one',
            name: 'Remote',
        }], 3)
        const pending = Promise.withResolvers<{ snapshot: WorkspaceNavigationSnapshot }>()
        const confirm = vi.fn(async () => false)
        const server = createServer([initial], () => pending.promise)
        const { navigation } = await mount(server, { confirm })
        navigation.setTag('one', 'red', true)
        const flush = navigation.flushPendingChanges()
        navigation.setTag('one', 'red', false)
        pending.resolve({ snapshot: remote })
        expect(await flush).toBe(false)
        expect(navigation.hasPendingChanges()).toBe(true)
        expect(confirm).not.toHaveBeenCalled()
        expect(document.querySelector<HTMLElement>('.workspace-navigation-status')!.hidden).toBe(false)
    })

    it('keeps a declined stale reload available for later confirmation', async () => {
        const newer = snapshot('org-a', [{
            id: 'one',
            name: 'Remote',
        }], 2)
        const server = createServer([snapshot('org-a', [{ id: 'one' }])], () => ({
            error: 'WORKSPACE_NAVIGATION_STALE',
            snapshot: newer,
        }))
        const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        const { navigation } = await mount(server, { confirm })
        navigation.setTag('one', 'red', true)
        await autosave()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.firstChild?.textContent).toBe('one')
        const status = document.querySelector<HTMLElement>('.workspace-navigation-status')!
        expect(status.hidden).toBe(false)
        status.querySelector<HTMLButtonElement>('.workspace-navigation-status-action')!.click()
        await vi.advanceTimersByTimeAsync(0)
        expect(confirm).toHaveBeenCalledOnce()
        status.querySelector<HTMLButtonElement>('.workspace-navigation-status-action')!.click()
        await vi.advanceTimersByTimeAsync(0)
        expect(confirm).toHaveBeenCalledTimes(2)
        expect(findNestedListEntry(navigation.list.view.state.doc, 'one')?.node.firstChild?.textContent).toBe('Remote')
        expect(status.hidden).toBe(true)
    })

    it('autosaves a view-mode workspace move without opening text editing', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }, { id: 'two' }])])
        const { navigation } = await mount(server)
        expect(navigation.list.mode).toBe('view')
        expect(navigation.moveEntry({
            entryId: 'one',
            targetEntryId: 'two',
            placement: 'after',
        })).toBe(true)
        expect(navigation.list.mode).toBe('view')
        expect(saves(server)).toHaveLength(0)
        await autosave()
        expect(saves(server)).toHaveLength(1)
        const saved = parseNestedListDocument(saves(server)[0]!.document, createNestedListSchema())
        expect(findNestedListEntry(saved, 'one')!.pos).toBeGreaterThan(findNestedListEntry(saved, 'two')!.pos)
        expect(navigation.list.mode).toBe('view')
    })

    it('deletes only the current subtree after a child moves out', async () => {
        const server = createServer([snapshot('org-a', [
            {
                id: 'parent',
                children: [{ id: 'child' }],
            },
            { id: 'other' },
        ])])
        const {
            navigation,
            ports,
        } = await mount(server)

        expect(navigation.moveEntry({
            entryId: 'child',
            targetEntryId: 'other',
            placement: 'inside',
        })).toBe(true)
        await navigation.deleteEntry('parent')

        expect(ports.confirm).toHaveBeenCalledWith('Delete "parent"?')
        expect(saves(server)).toHaveLength(0)
        expect(findNestedListEntry(navigation.list.view.state.doc, 'child')).toBeDefined()
        expect(findNestedListEntry(navigation.list.view.state.doc, 'parent')).toBeUndefined()

        await autosave()
        expect(saves(server)[0]!.deletedWorkspaceIds).toEqual(['parent'])
        expect(JSON.stringify(saves(server)[0]!.document)).toContain('"entryId":"child"')
        expect(ports.onWorkspacesDeleted).toHaveBeenCalledWith(['parent'])
    })

    it('allows Redo of a confirmed Delete while ordinary deletion remains blocked after Undo', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'parent' }, { id: 'other' }])])
        const { navigation } = await mount(server)

        await navigation.deleteEntry('parent')
        expect(findNestedListEntry(navigation.list.view.state.doc, 'parent')).toBeUndefined()

        expect(undo(navigation.list.view.state, navigation.list.view.dispatch)).toBe(true)
        expect(findNestedListEntry(navigation.list.view.state.doc, 'parent')).toBeDefined()

        const restored = navigation.list.view.state.doc
        deleteNestedListItem('parent')(navigation.list.view.state, navigation.list.view.dispatch)
        expect(navigation.list.view.state.doc.eq(restored)).toBe(true)

        expect(redo(navigation.list.view.state, navigation.list.view.dispatch)).toBe(true)
        expect(findNestedListEntry(navigation.list.view.state.doc, 'parent')).toBeUndefined()
        await autosave()
        expect(saves(server)[0]!.deletedWorkspaceIds).toEqual(['parent'])
        const committed = navigation.list.view.state.doc
        undo(navigation.list.view.state, navigation.list.view.dispatch)
        expect(navigation.list.view.state.doc.eq(committed)).toBe(true)
    })

    it('allows only explicit new workspace IDs and sends queued creation on autosave', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'parent' }])], (payload, current) => {
            const id = payload.createdWorkspaceIds?.[0]!
            const created = {
                id,
                name: '',
            }

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                    tree: {
                        ...current.tree,
                        roots: [{
                            ...current.tree.roots[0]!,
                            children: [treeEntry('org-a', created)],
                        }],
                    },
                },
            }
        })
        const {
            navigation,
            ports,
        } = await mount(server)

        navigation.list.enterEdit()
        navigation.createWorkspace({
            parentWorkspaceId: 'parent',
            name: '',
        })

        expect(server.calls.some(call => call.subject === subjects.CREATE_WORKSPACE)).toBe(false)
        const localDocument = navigation.list.view.state.doc
        const ids: string[] = []
        localDocument.descendants(node => {
            if (node.attrs.itemType === 'workspace')
                ids.push(String(node.attrs.entryId))
        })
        expect(ids).toHaveLength(2)
        const provisional = ids.find(id => id !== 'parent')!
        expect(findNestedListEntry(localDocument, provisional)?.node.firstChild?.textContent).toBe('')

        await autosave()
        expect(saves(server)[0]!.createdWorkspaceIds).toEqual([provisional])
        expect(ports.onWorkspaceCreated).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: provisional,
            name: '',
        }))
    })

    it('protects a submitted creation from Undo and permits explicit deletion after its acknowledgement', async () => {
        let acknowledge!: (reply: unknown) => void
        let attempts = 0
        const initial = snapshot('org-a', [{ id: 'parent' }])
        const server = createServer([initial], (payload, current) => {
            if (attempts++ === 0)
                return new Promise(resolve => void (acknowledge = resolve))

            return {
                snapshot: {
                    ...current,
                    revision: current.revision + 1,
                    document: payload.document,
                },
            }
        })
        const { navigation } = await mount(server)
        navigation.createWorkspace({ organizationId: 'org-a' })
        const created = saves(server)
        expect(created).toHaveLength(0)
        await autosave()
        const first = saves(server)[0]!
        const provisional = first.createdWorkspaceIds![0]!
        const beforeUndo = navigation.list.view.state.doc
        undo(navigation.list.view.state, navigation.list.view.dispatch)
        expect(navigation.list.view.state.doc.eq(beforeUndo)).toBe(true)
        await navigation.deleteEntry(provisional)
        expect(findNestedListEntry(navigation.list.view.state.doc, provisional)).toBeUndefined()
        const accepted: WorkspaceNavigationSnapshot = {
            ...initial,
            revision: 2,
            document: first.document,
            tree: {
                ...initial.tree,
                roots: [
                    ...initial.tree.roots,
                    treeEntry('org-a', {
                        id: provisional,
                        name: 'New Workspace',
                    }),
                ],
            },
        }
        server.state.set('org-a', accepted)
        acknowledge({ snapshot: accepted })
        await Promise.resolve()
        await autosave()
        expect(saves(server)).toHaveLength(2)
        expect(saves(server)[1]!.deletedWorkspaceIds).toEqual([provisional])
        expect(saves(server)[1]!.createdWorkspaceIds).toBeUndefined()
    })

    it('protects a provisional workspace from ordinary range deletion until explicit Delete', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'parent' }])])
        const { navigation } = await mount(server)

        navigation.list.enterEdit()
        navigation.createWorkspace({
            parentWorkspaceId: 'parent',
            name: 'Temporary',
        })
        let provisional = ''
        navigation.list.view.state.doc.descendants(node => {
            if (
                node.attrs.itemType === 'workspace'
                && node.attrs.entryId !== 'parent'
            )
                provisional = String(node.attrs.entryId)
        })
        const found = findNestedListEntry(navigation.list.view.state.doc, provisional)!
        const before = navigation.list.view.state.doc
        navigation.list.view.dispatch(navigation.list.view.state.tr.delete(
            found.pos,
            found.pos + found.node.nodeSize,
        ))
        expect(navigation.list.view.state.doc.eq(before)).toBe(true)

        await navigation.deleteEntry(provisional)
        expect(findNestedListEntry(navigation.list.view.state.doc, provisional)).toBeUndefined()
        await autosave()
        expect(saves(server)).toHaveLength(0)
    })

    it('drops a queued creation when it is removed before autosave', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'parent' }])])
        const { navigation } = await mount(server)

        navigation.list.enterEdit()
        navigation.createWorkspace({ parentWorkspaceId: 'parent' })
        const created = [...navigation.list.view.state.doc.textContent.matchAll(/New Workspace/g)]
        expect(created).toHaveLength(1)
        let id = ''
        navigation.list.view.state.doc.descendants(node => {
            if (
                node.attrs.itemType === 'workspace'
                && node.attrs.entryId !== 'parent'
            )
                id = String(node.attrs.entryId)
        })
        expect(id).not.toBe('')
        expect(undo(navigation.list.view.state, navigation.list.view.dispatch)).toBe(true)
        expect(findNestedListEntry(navigation.list.view.state.doc, id)).toBeUndefined()
        await autosave()
        expect(saves(server)).toHaveLength(0)
    })

    it('blocks ordinary deletion of an existing workspace identity', async () => {
        const server = createServer([snapshot('org-a', [{ id: 'one' }, { id: 'two' }])])
        const { navigation } = await mount(server)
        navigation.list.enterEdit()
        const before = navigation.list.view.state.doc

        expect(deleteNestedListItem('one')(navigation.list.view.state, navigation.list.view.dispatch)).toBe(true)
        expect(navigation.list.view.state.doc.eq(before)).toBe(true)
        await autosave()
        expect(saves(server)).toHaveLength(0)
    })
})
