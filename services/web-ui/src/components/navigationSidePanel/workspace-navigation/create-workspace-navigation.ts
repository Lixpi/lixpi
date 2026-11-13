import {
    WORKSPACE_TREE_ERROR,
    type SaveWorkspaceNavigationRequest,
    type WorkspaceMeta,
    type WorkspaceNavigationDocument,
    type WorkspaceNavigationSnapshot,
    type WorkspaceTreeEntry,
} from '@lixpi/constants'
import { createNewFileIcon } from '@lixpi/ui-kit/svg'
import { html } from '@lixpi/ui-primitives/dom'
import {
    createNestedListItemView,
    deleteNestedListItem,
    findNestedListEntry,
    mountNestedList,
    type NestedListHandle,
    type NestedListMove,
    type NestedListTag,
    type NestedListBlockContext,
    type NestedListBlockMenuItem,
} from '@lixpi/prosemirror/frontend/nested-list'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    type Command,
} from 'prosemirror-state'
import {
    createWorkspaceTreeClient,
    WorkspaceTreeClientError,
    type WorkspaceTreeClient,
    type WorkspaceTreeRequestPort,
} from '$src/services/workspace-tree-client.ts'
import {
    composeWorkspaceNavigation,
    findNavigationEntry,
    ORGANIZATION_ITEM_TYPE,
    splitWorkspaceNavigation,
    WORKSPACE_ITEM_TYPE,
    workspaceIdsInDocument,
    workspaceNavigationEntries,
    workspaceNavigationGuard,
    type WorkspaceNavigationEntry,
} from './workspace-navigation-document.ts'
import {
    insertWorkspaceItem,
    insertWorkspaceItemAfter,
    workspaceIdsInSubtree,
} from './workspace-navigation-editing.ts'
import { WorkspaceTreeStore } from '$src/stores/workspaceTreeStore.ts'
import { settings } from '$src/settings.ts'

export type WorkspaceNavigationPorts = {
    request: WorkspaceTreeRequestPort
    navigate: (workspaceId: string) => void
    buildHref?: (workspaceId: string) => string
    confirm: (message: string) => Promise<boolean>
    reportError: (
        message: string,
        error: unknown,
    ) => void
    importWorkspace?: (workspaceId: string) => void
    exportWorkspace?: (workspaceId: string) => void
    collapsed?: {
        load: () => string[]
        save: (workspaceIds: string[]) => void
    }
    onWorkspaceCreated?: (workspace: WorkspaceMeta) => void
    onWorkspacesDeleted?: (workspaceIds: string[]) => void
}

export type WorkspaceNavigationMenuBuilder = (
    entryId: string,
    entry: WorkspaceNavigationEntry,
    navigation: WorkspaceNavigationHandle,
) => NestedListBlockMenuItem[]

export type CreateWorkspaceNavigationOptions = {
    container: HTMLElement
    ports: WorkspaceNavigationPorts
    store?: WorkspaceTreeStore
    menus?: WorkspaceNavigationMenuBuilder | false
    scrollContainer?: () => HTMLElement | null
}

export type WorkspaceNavigationHandle = {
    readonly ports: WorkspaceNavigationPorts
    readonly store: WorkspaceTreeStore
    readonly client: WorkspaceTreeClient
    readonly list: NestedListHandle
    refresh: () => Promise<void>
    createWorkspace: (request: {
        organizationId?: string
        parentWorkspaceId?: string
        name?: string
    }) => void
    moveEntry: (move: NestedListMove) => boolean
    deleteEntry: (entryId: string) => Promise<void>
    setTag: (
        workspaceId: string,
        tagId: string,
        enabled: boolean,
    ) => boolean
    entry: (entryId: string) => WorkspaceNavigationEntry | undefined
    setActive: (workspaceId: string | undefined) => void
    hasPendingChanges: () => boolean
    flushPendingChanges: () => Promise<boolean>
    destroy: () => void
}

const NEW_WORKSPACE_NAME = 'New Workspace'

const findWorkspaceMeta = (
    entries: WorkspaceTreeEntry[],
    id: string,
): WorkspaceMeta | undefined => {
    for (const entry of entries) {
        if (entry.entryType !== 'workspace')
            continue

        if (entry.workspace.workspaceId === id)
            return entry.workspace

        const child = findWorkspaceMeta(entry.children, id)

        if (child)
            return child
    }

    return undefined
}

type NavigationFlight = {
    request: SaveWorkspaceNavigationRequest
    generation: number
    running: boolean
    completion?: Promise<void>
}

type OrganizationPersistence = {
    acknowledged?: WorkspaceNavigationSnapshot
    localDocument?: WorkspaceNavigationDocument
    generation: number
    timer?: ReturnType<typeof setTimeout>
    retryNotBefore?: number
    rateLimited?: boolean
    flight?: NavigationFlight
    paused?: 'stale' | 'terminal'
    emptyBodyId?: string
}

class WorkspaceNavigation implements WorkspaceNavigationHandle {
    readonly ports: WorkspaceNavigationPorts
    readonly store: WorkspaceTreeStore
    readonly client: WorkspaceTreeClient
    readonly list: NestedListHandle
    private readonly unsubscribe: () => void
    private readonly status: HTMLElement
    private latestSnapshots = new Map<string, WorkspaceNavigationSnapshot>()
    private organizationOrder: string[] = []
    private latestEntries = new Map<string, WorkspaceNavigationEntry>()
    private localEntries = new Map<string, WorkspaceNavigationEntry>()
    private readonly persistence = new Map<string, OrganizationPersistence>()
    private readonly flushWaiters = new Set<() => void>()
    private readonly authorizedCreates = new Map<string, WorkspaceNavigationEntry>()
    private readonly activeCreates = new Set<string>()
    private readonly queuedDeletions = new Map<string, Set<string>>()
    private readonly confirmedDeletions = new Map<string, Set<string>>()
    private readonly explicitRemovals = new Set<string>()
    private readonly committedDeletions = new Set<string>()
    private currentTags: Readonly<Record<string, NestedListTag>> = {}
    private refreshPromise?: Promise<void>
    private flushPromise?: Promise<boolean>
    private refreshQueued = false
    private suppressStore = false
    private authoritativeReload = false
    private loaded = false
    private destroyed = false

    constructor(private readonly options: CreateWorkspaceNavigationOptions) {
        this.ports = options.ports
        this.store = options.store ?? new WorkspaceTreeStore()
        this.client = createWorkspaceTreeClient(options.ports.request)
        this.status = html`
            <div
                className="workspace-navigation-status"
                role="status"
                aria-live="polite"
                hidden
            ></div>
        ` as HTMLElement
        options.container.after(this.status)
        this.list = mountNestedList({
            container: options.container,
            document: composeWorkspaceNavigation([]),
            collapsed: options.ports.collapsed?.load() ?? [],
            ...(options.scrollContainer ? { scrollContainer: options.scrollContainer } : {}),
            itemViews: {
                [WORKSPACE_ITEM_TYPE]: node => {
                    const item = createNestedListItemView(node, { tags: () => this.currentTags })

                    return item
                },
                [ORGANIZATION_ITEM_TYPE]: node => {
                    const item = createNestedListItemView(node)
                    item.dom.classList.add('workspace-navigation-organization')

                    return item
                },
            },
            itemEnter: { [WORKSPACE_ITEM_TYPE]: this.enterWorkspaceItem },
            tags: this.currentTags,
            blockMenu: context => this.blockMenu(context),
            filterTransaction: (transaction, state) => this.authoritativeReload || workspaceNavigationGuard(
                () => this.localEntries,
                () => this.allQueuedDeletions(),
                () => new Set(
                    [...this.authorizedCreates.keys()].filter(id => !this.submittedCreates().has(id)),
                ),
                () => this.allConfirmedDeletions(),
                () => this.explicitRemovals,
                () => new Set([
                    ...this.committedDeletions,
                    ...this.submittedDeletions(),
                ]),
            )(transaction, state),
            onChange: ({ document }) => {
                if (!this.authoritativeReload)
                    this.localChanged(document)
            },
            onActivate: ({
                entryId,
                node,
                event,
            }) => {
                if (
                    node.attrs.itemType !== WORKSPACE_ITEM_TYPE
                    || this.authorizedCreates.has(entryId)
                )
                    return

                if (
                    (event.metaKey || event.ctrlKey)
                    && this.ports.buildHref
                ) {
                    options.container.ownerDocument.defaultView?.open(
                        this.ports.buildHref(entryId),
                        '_blank',
                        'noopener,noreferrer',
                    )

                    return
                }

                this.ports.navigate(entryId)
            },
            onCollapseChange: () => {
                this.expandSingleOrganization()
                this.ports.collapsed?.save([...this.list.collapsed])
            },
            onModeChange: mode => {
                if (mode === 'view')
                    this.reconcileIdleSnapshots()
            },
        })
        this.unsubscribe = this.store.subscribe(trees => {
            if (
                this.suppressStore
                || this.destroyed
                || (!trees.organizations.length && !this.loaded)
            )
                return

            void this.refresh()
        })
    }

    private stateFor(organizationId: string): OrganizationPersistence {
        let state = this.persistence.get(organizationId)

        if (!state) {
            state = { generation: 0 }
            this.persistence.set(organizationId, state)
        }

        return state
    }

    private orderedSnapshots(): WorkspaceNavigationSnapshot[] {
        return this.organizationOrder.flatMap(id => {
            const snapshot = this.latestSnapshots.get(id)

            return snapshot ? [snapshot] : []
        })
    }

    private buildTags(): Readonly<Record<string, NestedListTag>> {
        const tags: Record<string, NestedListTag> = {}

        for (const snapshot of this.orderedSnapshots()) {
            for (const [id, tag] of Object.entries(snapshot.tree.tags))
                tags[`${snapshot.organizationId}:${id}`] = tag
        }

        return tags
    }

    private expandSingleOrganization(): boolean {
        if (this.organizationOrder.length !== 1)
            return false

        const collapsed = new Set(this.list.collapsed)

        if (!collapsed.delete(`navigation-organization:${this.organizationOrder[0]}`))
            return false

        this.list.setCollapsed(collapsed)

        return true
    }

    private publishSnapshots(updateDocument = true): void {
        this.latestEntries = workspaceNavigationEntries(
            this.orderedSnapshots(),
        )
        this.localEntries = new Map([
            ...this.latestEntries,
            ...this.authorizedCreates,
        ])
        this.currentTags = this.buildTags()
        this.list.setTags(this.currentTags)
        this.options.container.classList.toggle('workspace-navigation-single-organization', this.organizationOrder.length === 1)

        if (this.expandSingleOrganization())
            this.ports.collapsed?.save([...this.list.collapsed])

        this.suppressStore = true

        try {
            this.store.replaceAll({
                organizations: this.orderedSnapshots().map(snapshot => snapshot.tree),
            })
        } finally {
            this.suppressStore = false
        }

        if (
            updateDocument
            && this.list.mode === 'view'
            && !this.hasPendingChanges()
        )
            this.list.setDocument(
                composeWorkspaceNavigation(
                    this.orderedSnapshots(),
                ),
            )
    }

    private acceptSnapshots(snapshots: WorkspaceNavigationSnapshot[]): void {
        const next = new Map<string, WorkspaceNavigationSnapshot>()
        const order: string[] = []
        const canApply = this.list.mode !== 'edit' && !this.hasPendingChanges()

        for (const snapshot of snapshots) {
            const previous = this.latestSnapshots.get(snapshot.organizationId)
            const accepted = previous
                && previous.revision > snapshot.revision
                ? previous
                : snapshot
            order.push(snapshot.organizationId)
            next.set(snapshot.organizationId, accepted)

            if (canApply) {
                this.stateFor(snapshot.organizationId).acknowledged = accepted
                this.stateFor(snapshot.organizationId).localDocument = accepted.document
            }
        }

        this.latestSnapshots = next
        this.organizationOrder = order
        this.loaded = true
        this.publishSnapshots()
    }

    private acceptSnapshot(snapshot: WorkspaceNavigationSnapshot): void {
        const previous = this.latestSnapshots.get(snapshot.organizationId)

        if (
            previous
            && previous.revision > snapshot.revision
        )
            return

        this.latestSnapshots.set(snapshot.organizationId, snapshot)

        if (!this.organizationOrder.includes(snapshot.organizationId))
            this.organizationOrder.push(snapshot.organizationId)

        this.publishSnapshots(false)
    }

    refresh = async (): Promise<void> => {
        if (this.destroyed)
            return

        this.refreshQueued = true

        if (this.refreshPromise)
            return await this.refreshPromise

        const run = async (): Promise<void> => {
            while (
                this.refreshQueued
                && !this.destroyed
            ) {
                this.refreshQueued = false

                try {
                    performance.mark('navigation:request')
                    const response = await this.client.getNavigation()
                    performance.mark('navigation:response')

                    if (!this.destroyed)
                        this.acceptSnapshots(response.organizations)

                    performance.measure('navigation:render', 'navigation:response')
                } catch (error) {
                    if (!this.destroyed)
                        this.ports.reportError('Workspaces could not be loaded.', error)
                }
            }
        }
        this.refreshPromise = run()

        try {
            await this.refreshPromise
        } finally {
            this.refreshPromise = undefined
        }
    }

    private reconcileIdleSnapshots(): void {
        if (!this.hasPendingChanges()) {
            for (const snapshot of this.orderedSnapshots()) {
                this.stateFor(snapshot.organizationId).acknowledged = snapshot
                this.stateFor(snapshot.organizationId).localDocument = snapshot.document
            }
        }

        this.publishSnapshots()
    }

    private activeFlights(): NavigationFlight[] {
        return [...this.persistence.values()].flatMap(state => (state.flight ? [state.flight] : []))
    }

    private submittedDeletions(): ReadonlySet<string> {
        return new Set(
            this.activeFlights().flatMap(flight => flight.request.deletedWorkspaceIds ?? []),
        )
    }

    private submittedCreates(): ReadonlySet<string> {
        return new Set(
            this.activeFlights().flatMap(flight => flight.request.createdWorkspaceIds ?? []),
        )
    }

    private documentsEqual(
        first: WorkspaceNavigationDocument,
        second: WorkspaceNavigationDocument,
    ): boolean {
        const schema = this.list.view.state.schema

        return schema.nodeFromJSON(first).eq(
            schema.nodeFromJSON(second),
        )
    }

    private hasPendingChange(organizationId: string): boolean {
        const acknowledged = this.stateFor(organizationId).acknowledged
        const local = this.stateFor(organizationId).localDocument

        return Boolean(
            Boolean(this.stateFor(organizationId).paused)
            || Boolean(this.stateFor(organizationId).flight)
            || this.queuedDeletions.get(organizationId)?.size
            || [...this.activeCreates].some(id => this.authorizedCreates.get(id)?.organizationId === organizationId)
            || (acknowledged && local && !this.documentsEqual(local, acknowledged.document)),
        )
    }

    hasPendingChanges(): boolean {
        return this.organizationOrder.some(id => this.hasPendingChange(id))
    }

    flushPendingChanges = (): Promise<boolean> => {
        this.flushPromise ??= this.runFlush()

        return this.flushPromise
    }

    private async runFlush(): Promise<boolean> {
        try {
            while (!this.destroyed) {
                const results = await Promise.all(
                    this.organizationOrder.map(id => this.flushOrganizationNow(id)),
                )

                if (!results.every(Boolean))
                    return false

                if (!this.hasPendingChanges())
                    return true
            }

            return false
        } catch (error) {
            if (!this.destroyed)
                this.ports.reportError('Navigation changes could not be saved before leaving.', error)

            return false
        } finally {
            this.flushPromise = undefined
        }
    }

    private waitForRetry(delay: number): Promise<void> {
        return new Promise<void>(resolve => {
            let timer: ReturnType<typeof setTimeout>
            const finish = (): void => {
                clearTimeout(timer)
                this.flushWaiters.delete(finish)
                resolve()
            }
            timer = setTimeout(finish, delay)
            this.flushWaiters.add(finish)
        })
    }

    private async flushOrganizationNow(organizationId: string): Promise<boolean> {
        const state = this.stateFor(organizationId)

        while (
            !this.destroyed
            && this.hasPendingChange(organizationId)
        ) {
            if (
                state.paused
                || !state.acknowledged
                || !state.localDocument
            )
                return false

            if (state.timer) {
                clearTimeout(state.timer)
                state.timer = undefined
            }

            if (state.flight?.running)
                await state.flight.completion
            else {
                const retryDelay = (state.retryNotBefore ?? 0) - Date.now()

                if (retryDelay > 0) {
                    await this.waitForRetry(retryDelay)

                    continue
                }

                await this.flushOrganization(organizationId)
            }

            if (
                state.flight
                && !state.flight.running
                && !state.rateLimited
            )
                return false
        }

        return !this.destroyed && !this.hasPendingChange(organizationId)
    }

    private allQueuedDeletions(): ReadonlySet<string> {
        return new Set(
            [...this.queuedDeletions.values()].flatMap(ids => [...ids]),
        )
    }

    private allConfirmedDeletions(): ReadonlySet<string> {
        return new Set(
            [...this.confirmedDeletions.values()].flatMap(ids => [...ids]),
        )
    }

    private syncQueues(document: ProseMirrorNode): void {
        const visible = workspaceIdsInDocument(document)

        for (const ids of this.queuedDeletions.values()) {
            for (const id of ids) {
                if (visible.has(id))
                    ids.delete(id)
            }
        }

        for (const [organizationId, confirmed] of this.confirmedDeletions) {
            const queue = this.queuedDeletions.get(organizationId) ?? new Set<string>()

            for (const id of confirmed) {
                if (visible.has(id))
                    queue.delete(id)
                else if (
                    !this.authorizedCreates.has(id)
                    || this.submittedCreates().has(id)
                )
                    queue.add(id)
            }

            this.queuedDeletions.set(organizationId, queue)
        }

        this.activeCreates.clear()

        for (const id of this.authorizedCreates.keys()) {
            if (visible.has(id))
                this.activeCreates.add(id)
        }
    }

    private localChanged(document: ProseMirrorNode): void {
        this.syncQueues(document)
        const documents = splitWorkspaceNavigation(
            document,
            organizationId => {
                let id = this.stateFor(organizationId).emptyBodyId

                if (!id) {
                    id = crypto.randomUUID()
                    this.stateFor(organizationId).emptyBodyId = id
                }

                return id
            },
        )

        if (
            documents.size !== this.organizationOrder.length
            || this.organizationOrder.some(id => !documents.has(id))
        ) {
            this.ports.reportError(
                'The navigation could not be saved.',
                new Error('The organization list changed unexpectedly.'),
            )

            return
        }

        for (const [organizationId, desired] of documents) {
            const previous = this.stateFor(organizationId).localDocument

            if (
                previous
                && this.documentsEqual(previous, desired)
            )
                continue

            this.stateFor(organizationId).localDocument = desired
            this.stateFor(organizationId).generation += 1
            this.scheduleSave(organizationId)
        }
    }

    private scheduleSave(
        organizationId: string,
        delay = settings.workspacePersistence.debounceMs,
    ): void {
        const state = this.stateFor(organizationId)

        if (state.timer)
            clearTimeout(state.timer)

        const retryDelay = (state.retryNotBefore ?? 0) - Date.now()
        state.timer = setTimeout(
            () => {
                state.timer = undefined
                void this.flushOrganization(organizationId)
            },
            Math.max(delay, retryDelay),
        )
    }

    private async flushOrganization(organizationId: string): Promise<void> {
        if (
            this.destroyed
            || Boolean(this.stateFor(organizationId).paused)
        )
            return

        const retryDelay = (this.stateFor(organizationId).retryNotBefore ?? 0) - Date.now()

        if (retryDelay > 0) {
            this.scheduleSave(organizationId, retryDelay)

            return
        }

        const existing = this.stateFor(organizationId).flight

        if (existing) {
            if (!existing.running)
                await this.attemptSave(organizationId, existing)

            return
        }

        const base = this.stateFor(organizationId).acknowledged
        const desired = this.stateFor(organizationId).localDocument

        if (
            !base
            || !desired
        )
            return

        const deletedWorkspaceIds = [...(this.queuedDeletions.get(organizationId) ?? [])].sort()
        const createdWorkspaceIds = [...this.activeCreates].filter(id => this.authorizedCreates.get(id)?.organizationId === organizationId).sort()

        if (
            this.documentsEqual(desired, base.document)
            && !deletedWorkspaceIds.length
            && !createdWorkspaceIds.length
        )
            return

        const flight = {
            request: {
                organizationId,
                baseRevision: base.revision,
                mutationId: crypto.randomUUID(),
                document: structuredClone(desired),
                ...(deletedWorkspaceIds.length ? { deletedWorkspaceIds } : {}),
                ...(createdWorkspaceIds.length ? { createdWorkspaceIds } : {}),
            },
            generation: this.stateFor(organizationId).generation,
            running: false,
        }
        this.stateFor(organizationId).flight = flight
        await this.attemptSave(organizationId, flight)
    }

    private async attemptSave(
        organizationId: string,
        flight: NavigationFlight,
    ): Promise<void> {
        if (this.destroyed)
            return

        if (flight.running) {
            await flight.completion

            return
        }

        let finish = (): void => void undefined
        flight.completion = new Promise<void>(resolve => void (finish = resolve))
        flight.running = true

        try {
            const snapshot = await this.client.saveNavigation(flight.request)

            if (
                this.destroyed
                || this.stateFor(organizationId).flight !== flight
            )
                return

            if (!this.documentsEqual(snapshot.document, flight.request.document)) {
                this.stateFor(organizationId).flight = undefined
                this.acceptSnapshot(snapshot)
                this.stateFor(organizationId).paused = 'stale'
                this.renderStatus()
                this.ports.reportError(
                    'The navigation changed elsewhere. Local changes are retained.',
                    new Error('The acknowledged document differs from the submitted document.'),
                )

                return
            }

            const newerLocal = this.stateFor(organizationId).generation > flight.generation
            this.stateFor(organizationId).flight = undefined
            this.stateFor(organizationId).acknowledged = snapshot
            this.stateFor(organizationId).retryNotBefore = undefined
            this.stateFor(organizationId).rateLimited = false

            if (!newerLocal)
                this.stateFor(organizationId).localDocument = snapshot.document

            this.acceptSnapshot(snapshot)

            for (const id of flight.request.deletedWorkspaceIds ?? []) {
                this.queuedDeletions.get(organizationId)?.delete(id)
                this.confirmedDeletions.get(organizationId)?.delete(id)
                this.committedDeletions.add(id)
            }

            for (const id of flight.request.createdWorkspaceIds ?? []) {
                this.activeCreates.delete(id)
                this.authorizedCreates.delete(id)
                const workspace = findWorkspaceMeta(snapshot.tree.roots, id)

                if (workspace)
                    this.ports.onWorkspaceCreated?.(workspace)
            }

            if (flight.request.deletedWorkspaceIds?.length)
                this.ports.onWorkspacesDeleted?.(flight.request.deletedWorkspaceIds)

            this.localEntries = new Map([
                ...this.latestEntries,
                ...this.authorizedCreates,
            ])

            if (
                newerLocal
                || this.hasPendingChange(organizationId)
            )
                this.scheduleSave(organizationId)
        } catch (error) {
            if (
                this.destroyed
                || this.stateFor(organizationId).flight !== flight
            )
                return

            const state = this.stateFor(organizationId)
            state.rateLimited = error instanceof WorkspaceTreeClientError
                && error.code === 'WORKSPACE_NAVIGATION_RATE_LIMITED'

            if (!state.rateLimited)
                state.retryNotBefore = undefined

            if (
                error instanceof WorkspaceTreeClientError
                && error.code === 'WORKSPACE_NAVIGATION_STALE'
            ) {
                if (error.snapshot)
                    this.acceptSnapshot(error.snapshot)

                this.stateFor(organizationId).paused = 'stale'
                this.renderStatus()
                this.ports.reportError('The navigation changed elsewhere. Local changes are retained.', error)

                return
            }

            const retryable = !(error instanceof WorkspaceTreeClientError)
                || error.code === 'WORKSPACE_NAVIGATION_RATE_LIMITED'
                || error.code === WORKSPACE_TREE_ERROR.BUSY

            if (!retryable) {
                this.stateFor(organizationId).paused = 'terminal'
                this.renderStatus()
                this.ports.reportError('The navigation could not be saved. Local changes are retained.', error)

                return
            }

            this.ports.reportError('The navigation could not be saved. It will retry.', error)
            const retryAfter = error instanceof WorkspaceTreeClientError
                ? error.retryAfterMs
                : undefined
            const retryDelay = typeof retryAfter === 'number'
                && Number.isFinite(retryAfter)
                && retryAfter > 0
                ? retryAfter
                : settings.workspacePersistence.debounceMs

            if (state.rateLimited)
                state.retryNotBefore = Math.max(state.retryNotBefore ?? 0, Date.now() + retryDelay)

            this.scheduleSave(organizationId, retryDelay)
        } finally {
            flight.running = false
            finish()
            flight.completion = undefined
        }
    }

    private renderStatus(): void {
        const rows: HTMLElement[] = []

        for (const [organizationId, state] of this.persistence) {
            if (!state.paused)
                continue

            const name = this.latestSnapshots.get(organizationId)?.tree.organizationName ?? organizationId
            const row = html`<div className="workspace-navigation-status-row"></div>` as HTMLElement
            const message = html`<span className="workspace-navigation-status-message"></span>` as HTMLElement
            message.textContent = state.paused === 'stale'
                ? `${name}: Navigation changed elsewhere. Local edits are retained.`
                : `${name}: Navigation changes were not saved. Local edits are retained.`
            const action = html`
                <button
                    type="button"
                    className="workspace-navigation-status-action"
                    onclick=${() => (state.paused === 'stale' ? void this.offerReload(organizationId) : this.retryOrganization(organizationId))}
                >${state.paused === 'stale' ? 'Reload' : 'Retry'}</button>
            ` as HTMLButtonElement
            row.append(message, action)
            rows.push(row)
        }

        this.status.replaceChildren(...rows)
        this.status.hidden = rows.length === 0
    }

    private retryOrganization(organizationId: string): void {
        const state = this.stateFor(organizationId)

        if (state.paused !== 'terminal')
            return

        state.paused = undefined
        state.flight = undefined
        state.rateLimited = false
        state.retryNotBefore = undefined
        this.renderStatus()
        this.scheduleSave(organizationId, 0)
    }

    private async offerReload(organizationId: string): Promise<void> {
        const generation = this.stateFor(organizationId).generation
        const confirmed = await this.ports.confirm('The navigation changed elsewhere. Reload this organization and discard its local edits?')

        if (
            !confirmed
            || this.destroyed
            || !Boolean(this.stateFor(organizationId).paused)
        )
            return

        if (this.stateFor(organizationId).generation !== generation) {
            this.ports.reportError(
                'The navigation changed while reload was pending. Local edits are retained.',
                new Error('Reload confirmation expired.'),
            )

            return
        }

        let enteredForReload = false

        try {
            const response = await this.client.getNavigation()

            if (this.destroyed)
                return

            const fetched = response.organizations.find(snapshot => snapshot.organizationId === organizationId)
            const cached = this.latestSnapshots.get(organizationId)
            const snapshot = fetched
                && cached
                && cached.revision > fetched.revision
                ? cached
                : fetched

            if (!snapshot)
                throw new Error('The organization is no longer available.')

            if (this.stateFor(organizationId).generation !== generation)
                throw new Error('Local edits changed while reloading. Confirm reload again.')

            const view = this.list.view
            const current = findNavigationEntry(view.state.doc, `navigation-organization:${organizationId}`)
            const composed = composeWorkspaceNavigation([snapshot])
            const replacement = view.state.schema.nodeFromJSON(composed).firstChild

            if (
                !current
                || !replacement
            )
                throw new Error('The organization could not be replaced in the editor.')

            if (this.list.mode === 'view') {
                if (!this.list.enterEdit())
                    throw new Error('The editor cannot reload this organization.')

                enteredForReload = true
            }

            const transaction = view.state.tr.replaceWith(
                current.pos,
                current.pos + current.node.nodeSize,
                replacement,
            ).setMeta('addToHistory', false)
            this.authoritativeReload = true

            try {
                view.dispatch(transaction)
            } finally {
                this.authoritativeReload = false
            }

            this.stateFor(organizationId).flight = undefined
            const state = this.stateFor(organizationId)

            if (state.timer)
                clearTimeout(state.timer)

            state.timer = undefined
            this.queuedDeletions.delete(organizationId)
            this.confirmedDeletions.delete(organizationId)
            this.stateFor(organizationId).emptyBodyId = undefined

            for (const [id, entry] of this.authorizedCreates) {
                if (entry.organizationId === organizationId) {
                    this.authorizedCreates.delete(id)
                    this.activeCreates.delete(id)
                }
            }

            this.stateFor(organizationId).acknowledged = snapshot
            this.stateFor(organizationId).localDocument = snapshot.document
            this.stateFor(organizationId).generation = 0
            this.stateFor(organizationId).retryNotBefore = undefined
            this.stateFor(organizationId).rateLimited = false
            this.stateFor(organizationId).paused = undefined
            this.renderStatus()
            this.acceptSnapshot(snapshot)
        } catch (error) {
            if (!this.destroyed)
                this.ports.reportError('The navigation could not be reloaded. Local edits are retained.', error)
        } finally {
            if (
                enteredForReload
                && !this.destroyed
            )
                this.list.exitEdit()
        }
    }

    entry = (entryId: string): WorkspaceNavigationEntry | undefined => this.localEntries.get(entryId)

    setActive = (workspaceId: string | undefined): void => void this.list.setActive(workspaceId)

    private blockLocation(target: NestedListBlockContext): {
        organizationId: string
        parentWorkspaceId?: string
    } | undefined {
        const found = findNestedListEntry(this.list.view.state.doc, target.entryId)

        if (!found)
            return undefined

        const at = this.list.view.state.doc.resolve(found.pos)
        let organizationId: string | undefined
        let parentWorkspaceId: string | undefined

        for (let depth = at.depth; depth >= 0; depth -= 1) {
            const node = at.node(depth)

            if (
                !parentWorkspaceId
                && node.attrs.itemType === WORKSPACE_ITEM_TYPE
            )
                parentWorkspaceId = String(node.attrs.entryId)

            if (
                node.attrs.itemType === ORGANIZATION_ITEM_TYPE
                && node.attrs.data?.organizationId
            ) {
                organizationId = String(node.attrs.data.organizationId)

                break
            }
        }

        return organizationId ? {
            organizationId,
            parentWorkspaceId,
        } : undefined
    }

    private enterWorkspaceItem: Command = (
        state,
        dispatch,
    ) => {
        const {
            $from,
            $to,
        } = state.selection
        const entry = this.entry(
            String($from.node(-1).attrs.entryId),
        )

        if (
            !$from.sameParent($to)
            || !entry?.editable
        )
            return false

        if (dispatch) {
            this.list.exitEdit()
            this.list.view.dom.blur()
            void this.saveWorkspaceName(entry.organizationId)
        }

        return true
    }

    private async saveWorkspaceName(organizationId: string): Promise<void> {
        try {
            await this.flushOrganizationNow(organizationId)
        } catch (error) {
            if (!this.destroyed)
                this.ports.reportError('The workspace name could not be saved.', error)
        }
    }

    private createAdjacentInDocument(target: NestedListBlockContext): void {
        const location = this.blockLocation(target)
        const parent = location?.parentWorkspaceId ? this.entry(location.parentWorkspaceId) : undefined

        if (
            !location
            || (location.parentWorkspaceId && !parent?.editable)
            || !this.list.enterEdit()
        )
            return

        const workspaceId = crypto.randomUUID()
        const name = NEW_WORKSPACE_NAME
        const entry: WorkspaceNavigationEntry = {
            organizationId: location.organizationId,
            workspaceId,
            editable: true,
            owner: true,
            name,
        }
        this.authorizedCreates.set(workspaceId, entry)
        this.localEntries.set(workspaceId, entry)

        if (!insertWorkspaceItemAfter(
            this.list.view,
            target.entryId,
            workspaceId,
            name,
        )) {
            this.authorizedCreates.delete(workspaceId)
            this.localEntries.delete(workspaceId)
        }
    }

    private blockMenu(target: NestedListBlockContext): {
        insert: NestedListBlockMenuItem[]
        actions: NestedListBlockMenuItem[]
    } | null {
        if (target.node.attrs.itemType === ORGANIZATION_ITEM_TYPE)
            return null

        const location = this.blockLocation(target)
        const parent = location?.parentWorkspaceId ? this.entry(location.parentWorkspaceId) : undefined
        const workspace = target.node.attrs.itemType === WORKSPACE_ITEM_TYPE
            ? this.entry(target.entryId)
            : undefined
        const build = this.options.menus === undefined
            ? defaultWorkspaceNavigationMenus
            : this.options.menus

        return {
            insert: [{
                label: 'Workspace',
                icon: createNewFileIcon,
                disabled: !location || Boolean(location.parentWorkspaceId && !parent?.editable),
                onSelect: () => void this.createAdjacentInDocument(target),
            }],
            actions: workspace
                && build
                ? build(
                    target.entryId,
                    workspace,
                    this,
                )
                : [],
        }
    }

    private createInDocument(
        organizationId: string,
        parentWorkspaceId: string | undefined,
        name: string,
    ): void {
        const parentId = parentWorkspaceId ?? `navigation-organization:${organizationId}`
        const parent = parentWorkspaceId ? this.entry(parentWorkspaceId) : undefined

        if (
            (parentWorkspaceId && (!parent?.editable || parent.organizationId !== organizationId))
            || !findNavigationEntry(this.list.view.state.doc, parentId)
        )
            return

        const workspaceId = crypto.randomUUID()
        const entry: WorkspaceNavigationEntry = {
            organizationId,
            workspaceId,
            editable: true,
            owner: true,
            name,
        }
        this.authorizedCreates.set(workspaceId, entry)
        this.localEntries.set(workspaceId, entry)

        if (!insertWorkspaceItem(
            this.list.view,
            parentId,
            workspaceId,
            name,
        )) {
            this.authorizedCreates.delete(workspaceId)
            this.localEntries.delete(workspaceId)
        }
    }

    createWorkspace = (request: {
        organizationId?: string
        parentWorkspaceId?: string
        name?: string
    }): void => {
        const parent = request.parentWorkspaceId ? this.entry(request.parentWorkspaceId) : undefined
        const organizationId = request.organizationId
            ?? parent?.organizationId
            ?? this.organizationOrder[0]
            ?? this.store.current.organizations[0]?.organizationId

        if (
            !organizationId
            || !this.list.enterEdit()
        )
            return

        this.createInDocument(
            organizationId,
            request.parentWorkspaceId,
            request.name ?? NEW_WORKSPACE_NAME,
        )
    }

    moveEntry = (move: NestedListMove): boolean => this.list.move(move)

    deleteEntry = async (id: string): Promise<void> => {
        const entry = this.entry(id)
        const found = findNestedListEntry(this.list.view.state.doc, id)

        if (
            !entry?.owner
            || !found
            || found.node.attrs.itemType !== WORKSPACE_ITEM_TYPE
        )
            return

        const ids = workspaceIdsInSubtree(found.node)

        if (ids.some(candidate => !this.entry(candidate)?.owner))
            return

        const name = found.node.firstChild?.textContent ?? entry.name
        const confirmed = await this.ports.confirm(
            ids.length > 1
                ? `Delete "${name}" and the ${ids.length - 1} workspaces inside it? This removes ${ids.length} workspaces.`
                : `Delete "${name}"?`,
        )

        if (
            !confirmed
            || this.destroyed
        )
            return

        const current = findNestedListEntry(this.list.view.state.doc, id)

        if (
            !current
            || JSON.stringify(
                workspaceIdsInSubtree(current.node),
            ) !== JSON.stringify(ids)
            || !this.list.enterEdit()
        )
            return

        const submitted = this.submittedCreates()
        const existing = ids.filter(candidate => !this.authorizedCreates.has(candidate) || submitted.has(candidate))
        const queue = this.queuedDeletions.get(entry.organizationId) ?? new Set<string>()
        const confirmedIds = this.confirmedDeletions.get(entry.organizationId) ?? new Set<string>()
        const added = ids.filter(candidate => !confirmedIds.has(candidate))
        existing.forEach(candidate => queue.add(candidate))
        ids.forEach(candidate => {
            confirmedIds.add(candidate)
            this.explicitRemovals.add(candidate)
        })
        this.queuedDeletions.set(entry.organizationId, queue)
        this.confirmedDeletions.set(entry.organizationId, confirmedIds)

        const before = this.list.view.state.doc

        try {
            deleteNestedListItem(id)(this.list.view.state, this.list.view.dispatch)
        } finally {
            ids.forEach(candidate => this.explicitRemovals.delete(candidate))
        }

        if (this.list.view.state.doc.eq(before)) {
            added.forEach(candidate => {
                queue.delete(candidate)
                confirmedIds.delete(candidate)
            })
        }
    }

    setTag = (
        workspaceId: string,
        tagId: string,
        enabled: boolean,
    ): boolean => {
        const entry = this.entry(workspaceId)

        if (
            !entry?.editable
            || !this.list.enterEdit()
        )
            return false

        const found = findNestedListEntry(this.list.view.state.doc, workspaceId)

        if (
            !found
            || found.node.attrs.itemType !== WORKSPACE_ITEM_TYPE
        )
            return false

        const scopedId = `${entry.organizationId}:${tagId}`
        const current = found.node.attrs.tagIds as string[]
        const tagIds = enabled
            ? [...new Set([
                ...current,
                scopedId,
            ])]
            : current.filter(id => id !== scopedId)
        this.list.view.dispatch(
            this.list.view.state.tr.setNodeMarkup(
                found.pos,
                undefined,
                {
                    ...found.node.attrs,
                    tagIds,
                },
            ),
        )

        return true
    }

    destroy = (): void => {
        this.destroyed = true
        this.unsubscribe()

        for (const finish of this.flushWaiters)
            finish()

        for (const state of this.persistence.values()) {
            if (state.timer)
                clearTimeout(state.timer)
        }

        this.list.destroy()
        this.status.remove()
    }
}

const moveTargets = (
    navigation: WorkspaceNavigationHandle,
    id: string,
    organizationId: string,
): Array<{
    label: string
    targetEntryId: string
}> => {
    const source = findNavigationEntry(navigation.list.view.state.doc, id)
    const descendants = new Set(source ? workspaceIdsInSubtree(source.node) : [])
    const targets = [{
        label: 'Top level',
        targetEntryId: `navigation-organization:${organizationId}`,
    }]

    navigation.list.view.state.doc.descendants(node => {
        if (
            node.type.name !== 'list_item'
            || node.attrs.itemType !== WORKSPACE_ITEM_TYPE
        )
            return

        const targetId = String(node.attrs.entryId)
        const entry = navigation.entry(targetId)

        if (
            entry?.organizationId === organizationId
            && entry.editable
            && !descendants.has(targetId)
        )
            targets.push({
                label: node.firstChild?.textContent ?? entry.name,
                targetEntryId: targetId,
            })
    })

    return targets
}

export const defaultWorkspaceNavigationMenus: WorkspaceNavigationMenuBuilder = (
    id,
    entry,
    navigation,
) => {
    const ports = navigation.ports
    const tree = navigation.store.current.organizations.find(candidate => candidate.organizationId === entry.organizationId)
    const current = findNestedListEntry(navigation.list.view.state.doc, id)?.node
    const currentTags = (current?.attrs.tagIds ?? []) as string[]

    return [
        {
            label: 'New sub-workspace',
            disabled: !entry.editable,
            onSelect: () => void navigation.createWorkspace({ parentWorkspaceId: id }),
        },
        {
            label: 'Tags',
            disabled: !entry.editable || !Object.keys(tree?.tags ?? {}).length,
            children: () => Object.entries(tree?.tags ?? {}).map(([tagId, tag]) => {
                const scopedId = `${entry.organizationId}:${tagId}`
                const enabled = currentTags.includes(scopedId)

                return {
                    label: tag.name,
                    checked: enabled,
                    onSelect: () => void navigation.setTag(
                        id,
                        tagId,
                        !enabled,
                    ),
                }
            }),
        },
        {
            label: 'Move to…',
            disabled: !entry.editable,
            children: () => moveTargets(
                navigation,
                id,
                entry.organizationId,
            ).map(
                target => ({
                    label: target.label,
                    onSelect: () => void navigation.moveEntry({
                        entryId: id,
                        targetEntryId: target.targetEntryId,
                        placement: 'inside',
                    }),
                }),
            ),
        },
        ...(ports.importWorkspace
            ? [{
                label: 'Import',
                disabled: !entry.editable || !tree || !findWorkspaceMeta(tree.roots, id),
                entersEdit: false,
                onSelect: () => ports.importWorkspace!(id),
            }]
            : []),
        ...(ports.exportWorkspace
            ? [{
                label: 'Export',
                disabled: !tree || !findWorkspaceMeta(tree.roots, id),
                entersEdit: false,
                onSelect: () => ports.exportWorkspace!(id),
            }]
            : []),
        {
            label: 'Delete',
            disabled: !entry.owner,
            onSelect: () => void navigation.deleteEntry(id),
        },
    ]
}

export const createWorkspaceNavigation = (options: CreateWorkspaceNavigationOptions): WorkspaceNavigationHandle => new WorkspaceNavigation(options)
