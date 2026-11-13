// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { findNestedListEntry } from '@lixpi/prosemirror/frontend/nested-list'
import { createWorkspaceNavigation } from './create-workspace-navigation.ts'
import { settings } from '$src/settings.ts'
import { createWorkspaceTreeHandlers } from '../../../../../api/src/services/workspace-navigation/workspace-tree-handlers.ts'
import { InMemoryWorkspaceTreeRepository } from '../../../../../api/src/services/workspace-navigation/in-memory-workspace-tree-repository.ts'
import { indexNavigationDocument } from '../../../../../api/src/services/workspace-navigation/workspace-navigation-document.ts'
import { WorkspaceTreeService } from '../../../../../api/src/services/workspace-navigation/workspace-tree-service.ts'

describe('workspace navigation adapter and service', () => {
    it('saves a blank label and a queued workspace under a plain group, then reloads the canonical document', async () => {
        const repository = new InMemoryWorkspaceTreeRepository()
        let serial = 0
        const service = new WorkspaceTreeService({
            repository,
            organizations: {
                getMembershipLevel: async () => 'owner',
                getOrganization: async organizationId => ({
                    organizationId,
                    name: 'Studio',
                    tags: {},
                }),
                listUserOrganizationIds: async () => ['org'],
            },
            deletion: {
                cleanupWorkspace: async () => undefined,
                stopConversations: async () => undefined,
            },
            now: () => 1000,
            createId: () => `id-${++serial}`,
        })
        const created = await service.createWorkspace('owner', {
            organizationId: 'org',
            name: 'Existing',
        })
        const existingId = created.workspace.workspaceId
        const baseline = await service.getNavigationSnapshot('owner', 'org')
        const existing = structuredClone(indexNavigationDocument(baseline.document).get(existingId)!.node)
        existing.content!.push({
            type: 'bullet_list',
            attrs: { entryId: 'group-list' },
            content: [{
                type: 'list_item',
                attrs: {
                    entryId: 'plain-group',
                    itemType: 'text',
                    data: null,
                    tagIds: [],
                },
                content: [{
                    type: 'paragraph',
                    attrs: { entryId: 'plain-group-label' },
                    content: [{
                        type: 'text',
                        text: 'Notes',
                    }],
                }],
            }],
        })
        const seeded = await service.saveNavigation('owner', {
            organizationId: 'org',
            baseRevision: baseline.revision,
            mutationId: 'seed-group',
            document: {
                type: 'doc',
                content: [{
                    type: 'bullet_list',
                    attrs: { entryId: 'root-list' },
                    content: [existing],
                }],
            },
        })
        expect('error' in seeded).toBe(false)

        const handlersByPath = createWorkspaceTreeHandlers(service)
        const handlers = Object.fromEntries(
            Object.entries(NATS_SUBJECTS.WORKSPACE_SUBJECTS).map(
                ([key, subject]) => [subject, handlersByPath[`WORKSPACE_SUBJECTS.${key}`]],
            ),
        )
        const request = async (
            subject: string,
            payload: Record<string, unknown>,
        ): Promise<unknown> => await handlers[subject]!({
            user: { userId: 'owner' },
            ...payload,
        })
        vi.useFakeTimers()
        const mounted: ReturnType<typeof createWorkspaceNavigation>[] = []
        const reportError = vi.fn()

        try {
            const container = document.createElement('div')
            document.body.appendChild(container)
            const navigation = createWorkspaceNavigation({
                container,
                ports: {
                    request,
                    navigate: vi.fn(),
                    confirm: vi.fn(async () => true),
                    reportError,
                },
            })
            mounted.push(navigation)
            await navigation.refresh()
            expect(reportError).not.toHaveBeenCalled()

            const view = navigation.list.view
            const row = findNestedListEntry(view.state.doc, existingId)!
            navigation.list.enterEdit()
            view.dispatch(view.state.tr.delete(row.pos + 2, row.pos + 2 + 'Existing'.length))
            navigation.createWorkspace({ name: '' })

            let provisionalId = ''
            view.state.doc.descendants(node => {
                if (
                    node.attrs.itemType === 'workspace'
                    && node.attrs.entryId !== existingId
                )
                    provisionalId = String(node.attrs.entryId)
            })
            expect(provisionalId).not.toBe('')
            const groupRow = view.dom.querySelector<HTMLElement>('[data-entry-id="navigation-block:org:plain-group"]')!
            expect(groupRow).not.toBeNull()
            const groupId = groupRow.dataset.entryId!
            expect(navigation.moveEntry({
                entryId: provisionalId,
                targetEntryId: groupId,
                placement: 'inside',
            })).toBe(true)
            await vi.advanceTimersByTimeAsync(settings.workspacePersistence.debounceMs)
            expect(repository.metas.get(existingId)?.name).toBe('')
            expect(repository.metas.get(provisionalId)).toMatchObject({
                name: '',
                parentWorkspaceId: existingId,
            })
            expect(repository.grants.has(`owner#${provisionalId}`)).toBe(true)
            const saved = await service.getNavigationSnapshot('owner', 'org')
            expect(indexNavigationDocument(saved.document).get('plain-group')?.ancestorIds).toEqual([existingId])

            const reloadContainer = document.createElement('div')
            document.body.appendChild(reloadContainer)
            const reloaded = createWorkspaceNavigation({
                container: reloadContainer,
                ports: {
                    request,
                    navigate: vi.fn(),
                    confirm: vi.fn(async () => true),
                    reportError,
                },
            })
            mounted.push(reloaded)
            await reloaded.refresh()
            expect(reportError).not.toHaveBeenCalled()
            expect(findNestedListEntry(reloaded.list.view.state.doc, existingId)?.node.firstChild?.textContent).toBe('')
            const group = findNestedListEntry(reloaded.list.view.state.doc, groupId)!.node
            let nested = false
            group.descendants(node => {
                if (node.attrs.entryId === provisionalId)
                    nested = true
            })
            expect(nested).toBe(true)
        } finally {
            mounted.forEach(navigation => navigation.destroy())
            vi.useRealTimers()
            document.body.replaceChildren()
        }
    })
})
