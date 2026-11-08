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
    ) => boolean
    resumeDocument: (coordinate: WorkspaceAssetDocumentCoordinate) => Promise<WorkspaceAssetDocument | null>
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
            const prioritized = getWorkspaceCanvasAssetIds(canvasState).sort((left, right) => {
                if (left === canvasState?.lastActiveConversationAssetId)
                    return -1

                if (right === canvasState?.lastActiveConversationAssetId)
                    return 1

                return 0
            })
            const directAssets = await this.loadAssets(
                prioritized,
                workspaceId,
                admitted,
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
            await this.hydrate(assets, admitted)

            return admitted() ? assets : []
        } catch (error) {
            if (admitted())
                this.ports.setError(error)

            throw error
        }
    }

    async hydrate(
        assets: Asset[],
        current: () => boolean,
    ): Promise<void> {
        const coordinates = assets.flatMap(
            asset =>
                (Object.keys(asset.documents) as AssetDocumentRole[]).map(
                    role => ({
                        organizationId: asset.organizationId,
                        assetId: asset.assetId,
                        role,
                    }),
                ),
        ).filter(({
            assetId,
            role,
        }) => !this.ports.hasDocument(assetId, role))
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
                try {
                    const snapshot = await this.ports.resumeDocument(coordinate)

                    if (!current())
                        return

                    if (snapshot)
                        snapshots.push(snapshot)

                    if (snapshots.length >= 16)
                        flush()
                } catch (error) {
                    if (current())
                        this.ports.reportError('Asset document resume failed; synchronization will retry it', error)
                }
            },
        )
        flush()
    }

    private async loadAssets(
        ids: string[],
        workspaceId: string,
        current: () => boolean,
    ): Promise<Asset[]> {
        const assets = await this.map(
            ids,
            8,
            current,
            async assetId => {
                try {
                    const result = await this.ports.get(assetId, workspaceId)

                    return 'error' in result ? undefined : result
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
    private closed = false
    private loading = false

    constructor(
        private readonly workspaceId: string,
        private readonly ports: WorkspaceAssetSynchronizationPorts,
    ) {
        try {
            this.cleanup.push(
                ports.subscribe(this.onEvent),
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
