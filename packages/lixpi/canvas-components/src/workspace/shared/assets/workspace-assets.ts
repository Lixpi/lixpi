import { getPersistedPanelConversationIds } from '../scene/workspace-panel-state.ts'
import {
    type Asset,
    type AssetDocumentRole,
    type CanvasState,
} from '@lixpi/constants'

export type WorkspaceAssetDocument = {
    assetId: string
    role: AssetDocumentRole
    version: number
    doc: object
}
export type WorkspaceAssetDocumentCoordinate = {
    organizationId: string
    assetId: string
    role: AssetDocumentRole
}
export type WorkspaceAssetProjectionPorts = {
    get: (
        assetId: string,
        workspaceId: string,
    ) => Promise<Asset | { error: string }>
    hasDocument: (
        assetId: string,
        role: AssetDocumentRole,
        version: number,
    ) => boolean
    loadDocument: (coordinate: WorkspaceAssetDocumentCoordinate) => Promise<WorkspaceAssetDocument | null>
    readAsset: (assetId: string) => Asset | undefined
    publishAsset: (asset: Asset) => void
    publishAssets: (
        workspaceId: string,
        assets: Asset[],
    ) => void
    publishDocuments: (snapshots: WorkspaceAssetDocument[]) => void
    setLoading: (workspaceId: string) => void
    setError: (error: unknown) => void
    reportError: (
        message: string,
        error: unknown,
    ) => void
}

export const getWorkspaceCanvasAssetIds = (canvasState: CanvasState | undefined): string[] => {
    if (!canvasState)
        return []

    const assetIds = new Set<string>()

    for (const node of canvasState.nodes) {
        if (
            'assetId' in node
            && typeof node.assetId === 'string'
            && node.assetId
        )
            assetIds.add(node.assetId)

        if (
            'conversationAssetId' in node
            && typeof node.conversationAssetId === 'string'
            && node.conversationAssetId
        )
            assetIds.add(node.conversationAssetId)

        if (
            'generatedBy' in node
            && node.generatedBy
            && typeof node.generatedBy.conversationAssetId === 'string'
            && node.generatedBy.conversationAssetId
        )
            assetIds.add(node.generatedBy.conversationAssetId)
    }

    for (const assetId of getPersistedPanelConversationIds(canvasState.aiChatPanel))
        assetIds.add(assetId)

    if (canvasState.lastActiveConversationAssetId)
        assetIds.add(canvasState.lastActiveConversationAssetId)

    return [...assetIds]
}

// Canvas references determine loading priority; transport and cache mutation are supplied by the host.
export class WorkspaceAssetProjection {
    private revision = 0

    constructor(private readonly ports: WorkspaceAssetProjectionPorts) {}

    async load(
        workspaceId: string,
        canvasState: CanvasState | undefined,
        current: () => boolean,
    ): Promise<Asset[]> {
        if (!current())
            return []

        const revision = ++this.revision
        const admitted = (): boolean => revision === this.revision && current()
        this.ports.setLoading(workspaceId)

        try {
            const activeConversation = canvasState?.lastActiveConversationAssetId
            let conversation: Promise<void> | undefined
            const prioritized = getWorkspaceCanvasAssetIds(canvasState).sort((left, right) => {
                if (left === activeConversation)
                    return -1

                if (right === activeConversation)
                    return 1

                return 0
            })
            const directAssets = await this.loadAssets(
                prioritized,
                workspaceId,
                admitted,
                asset => {
                    const pointer = asset.documents.conversation

                    if (
                        asset.assetId !== activeConversation
                        || !pointer
                    )
                        return

                    this.ports.publishAsset(asset)

                    if (!this.ports.hasDocument(
                        asset.assetId,
                        'conversation',
                        pointer.version,
                    ))
                        conversation = this.publishActiveConversation(asset, admitted)
                },
            )

            if (!admitted())
                return []

            const directIds = new Set(
                directAssets.map(asset => asset.assetId),
            )
            const lineageIds = [...new Set(
                directAssets.flatMap(asset => asset.lineage?.sourceAssetIds ?? []),
            )].filter(assetId => !directIds.has(assetId))
            const lineageAssets = await this.loadAssets(
                lineageIds,
                workspaceId,
                admitted,
            )

            if (!admitted())
                return []

            const assets = [...directAssets, ...lineageAssets]
            this.ports.publishAssets(workspaceId, assets)
            await Promise.all([
                conversation,
                this.hydrate(
                    assets,
                    admitted,
                    activeConversation,
                ),
            ])

            return admitted() ? assets : []
        } catch (error) {
            if (admitted())
                this.ports.setError(error)

            throw error
        }
    }

    needsHydration(canvasState: CanvasState | undefined): boolean {
        return getWorkspaceCanvasAssetIds(canvasState).some(assetId => {
            const asset = this.ports.readAsset(assetId)

            return !asset || (Object.keys(asset.documents) as AssetDocumentRole[]).some(
                role => !this.ports.hasDocument(
                    assetId,
                    role,
                    asset.documents[role]?.version ?? 0,
                ),
            )
        })
    }

    private async publishActiveConversation(
        asset: Asset,
        current: () => boolean,
    ): Promise<void> {
        const snapshot = await this.readDocument(
            {
                organizationId: asset.organizationId,
                assetId: asset.assetId,
                role: 'conversation',
            },
            current,
        )

        if (
            snapshot
            && current()
        )
            this.ports.publishDocuments([snapshot])
    }

    async hydrate(
        assets: Asset[],
        current: () => boolean,
        activeConversation?: string,
    ): Promise<void> {
        const coordinates = assets.flatMap(
            asset =>
                (Object.keys(asset.documents) as AssetDocumentRole[]).map(
                    role => ({
                        organizationId: asset.organizationId,
                        assetId: asset.assetId,
                        role,
                        version: asset.documents[role]?.version ?? 0,
                    }),
                ),
        ).filter(
            ({
                assetId,
                role,
                version,
            }) => !(assetId === activeConversation && role === 'conversation')
                && !this.ports.hasDocument(
                    assetId,
                    role,
                    version,
                ),
        )
            .sort((left, right) => {
                if (
                    left.role === 'conversation'
                    && right.role !== 'conversation'
                )
                    return -1

                if (
                    right.role === 'conversation'
                    && left.role !== 'conversation'
                )
                    return 1

                return 0
            })
        const snapshots: WorkspaceAssetDocument[] = []
        const flush = (): void => {
            if (
                current()
                && snapshots.length
            )
                this.ports.publishDocuments(
                    snapshots.splice(0),
                )
        }
        await this.map(
            coordinates,
            4,
            current,
            async coordinate => {
                const {
                    version: _,
                    ...request
                } = coordinate
                const snapshot = await this.readDocument(request, current)

                if (
                    snapshot
                    && current()
                )
                    snapshots.push(snapshot)

                if (snapshots.length >= 16)
                    flush()
            },
        )
        flush()
    }

    private async readDocument(
        coordinate: WorkspaceAssetDocumentCoordinate,
        current: () => boolean,
    ): Promise<WorkspaceAssetDocument | null> {
        try {
            return await this.ports.loadDocument(coordinate)
        } catch (error) {
            if (current())
                this.ports.reportError('Asset document load failed; synchronization will retry it', error)

            return null
        }
    }

    private async loadAssets(
        ids: string[],
        workspaceId: string,
        current: () => boolean,
        loaded?: (asset: Asset) => void,
    ): Promise<Asset[]> {
        const assets = await this.map(
            ids,
            8,
            current,
            async assetId => {
                try {
                    const result = await this.ports.get(assetId, workspaceId)

                    if (
                        'error' in result
                        || !current()
                    )
                        return undefined

                    loaded?.(result)

                    return result
                } catch (error) {
                    if (current())
                        this.ports.reportError('Asset load failed; synchronization will retry it', error)

                    return undefined
                }
            },
        )

        return assets.filter((asset): asset is Asset => Boolean(asset))
    }

    private async map<T, R>(
        items: T[],
        concurrency: number,
        current: () => boolean,
        action: (item: T) => Promise<R>,
    ): Promise<(R | undefined)[]> {
        const results: (R | undefined)[] = new Array(items.length)
        const entries = items.entries()
        await Promise.all(
            Array.from({ length: Math.min(concurrency, items.length) }, async () => {
                while (current()) {
                    const entry = entries.next()

                    if (entry.done)
                        return

                    const [index, item] = entry.value
                    results[index] = await action(item)
                }
            }),
        )

        return results
    }
}

export type WorkspaceAssetEvent = {
    assetId: string
    deleted: boolean
}
export type WorkspaceAssetSynchronizationPorts = {
    subscribe: (listener: (event: WorkspaceAssetEvent) => void) => () => void
    onReconnect?: (listener: () => void) => () => void
    needsRecovery?: () => boolean
    setInterval: (
        callback: () => void,
        delayMs: number,
    ) => () => void
    load: (current: () => boolean) => Promise<unknown>
    read: (assetId: string) => Asset | undefined
    fetch: (
        assetId: string,
        workspaceId: string,
    ) => Promise<Asset | { error: string }>
    publish: (asset: Asset) => void
    hydrate: (
        assets: Asset[],
        current: () => boolean,
    ) => Promise<void>
    remove: (assetId: string) => void
    reportError: (error: unknown) => void
}

export class WorkspaceAssetSynchronization {
    private readonly cleanup: (() => void)[] = []
    private readonly revisions = new Map<string, number>()
    private stopEvents: (() => void) | undefined
    private closed = false
    private loading = false

    constructor(
        private readonly workspaceId: string,
        private readonly ports: WorkspaceAssetSynchronizationPorts,
    ) {
        try {
            this.stopEvents = ports.subscribe(this.onEvent)
            this.cleanup.push(() => this.stopEvents?.())

            if (ports.onReconnect)
                this.cleanup.push(
                    ports.onReconnect(this.reconnect),
                )

            this.cleanup.push(
                ports.setInterval(() => void this.synchronize(), 5 * 60000),
            )
        } catch (error) {
            try {
                this.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Asset synchronization mount failed')
            }

            throw error
        }
    }

    destroy = (): void => {
        if (this.closed)
            return

        this.closed = true
        this.revisions.clear()
        const errors: unknown[] = []

        for (const release of this.cleanup.splice(0).reverse()) {
            try {
                release()
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length)
            throw new AggregateError(errors, 'Asset synchronization cleanup failed')
    }

    private reconnect = (): void => {
        if (this.closed)
            return

        try {
            this.stopEvents?.()
            this.stopEvents = this.ports.subscribe(this.onEvent)

            if (this.ports.needsRecovery?.())
                void this.synchronize()
        } catch (error) {
            this.ports.reportError(error)
        }
    }

    private onEvent = (event: WorkspaceAssetEvent): void => {
        if (
            this.closed
            || !event.assetId
        )
            return

        const revision = (this.revisions.get(event.assetId) ?? 0) + 1
        this.revisions.set(event.assetId, revision)

        if (event.deleted)
            this.ports.remove(event.assetId)
        else if (this.ports.read(event.assetId))
            void this.refresh(event.assetId, revision)
    }

    private async refresh(
        assetId: string,
        revision: number,
    ): Promise<void> {
        const current = (): boolean => !this.closed && this.revisions.get(assetId) === revision

        try {
            const result = await this.ports.fetch(assetId, this.workspaceId)

            if (!current())
                return

            if ('error' in result) {
                this.ports.remove(assetId)

                return
            }

            this.ports.publish(result)

            if (current())
                await this.ports.hydrate([result], current)
        } catch (error) {
            if (current())
                this.ports.reportError(error)
        }
    }

    private async synchronize(): Promise<void> {
        if (
            this.closed
            || this.loading
        )
            return

        this.loading = true

        try {
            await this.ports.load(() => !this.closed)
        } catch (error) {
            if (!this.closed)
                this.ports.reportError(error)
        } finally {
            this.loading = false
        }
    }
}
