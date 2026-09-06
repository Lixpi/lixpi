import {
    MEDIA_DESCRIPTOR_VERSION,
    type Asset,
    type ContentDescriptor,
    type ImageCanvasNode,
    type MediaDescriptor,
    type VideoCanvasNode,
} from '@lixpi/constants'

type MediaNode = ImageCanvasNode | VideoCanvasNode
type AnalysisScope = {
    workspaceId: string
    sceneKey: string
}
type PendingWork = AnalysisScope & {
    nodeId: string
    assetId: string | undefined
    cancelTimer?: () => void
}

export type WorkspaceMediaAnalysisPorts = {
    readScope: () => AnalysisScope
    readNode: (nodeId: string) => MediaNode | undefined
    describe: (request: {
        workspaceId: string
        assetId: string
    }) => Promise<{
        title?: string
        summary?: string
        entityTags?: string[]
        styleTags?: string[]
        error?: string
    }>
    patchDescriptor: (
        assetId: string,
        descriptor: MediaDescriptor,
        title?: string,
    ) => void
    refreshAsset: (
        assetId: string,
        workspaceId: string,
    ) => Promise<Asset | { error: string }>
    loadWorkspaceAssets: (workspaceId: string) => Promise<void>
    refreshVideo: (node: VideoCanvasNode) => void
    refreshChrome: () => void
    refreshMarkers: () => void
    refreshContext: () => void
    setTimer: (
        callback: () => void,
        delayMs: number,
    ) => () => void
    now: () => number
    reportError: (error: unknown) => void
}

const ANALYSIS_RETRY_DELAYS_MS = [1000, 3000, 8000] as const
const PROVENANCE_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000] as const

export class WorkspaceMediaAnalysis {
    private readonly analysis = new Map<string, PendingWork>()
    private readonly refreshes = new Map<string, PendingWork>()
    private revision = 0
    private disposed = false

    constructor(private readonly ports: WorkspaceMediaAnalysisPorts) {}

    queue(
        nodeId: string,
        assetId: string | undefined,
    ): void {
        if (this.disposed)
            return

        const previous = this.analysis.get(nodeId)

        if (
            previous
            && previous.assetId === assetId
            && this.isCurrent(
                previous,
                this.analysis,
                false,
            )
        )
            return

        previous?.cancelTimer?.()
        const work = {
            ...this.ports.readScope(),
            nodeId,
            assetId,
        }
        this.analysis.set(nodeId, work)
        this.waitForNode(work, 0)
    }

    async refreshCompleted(node: MediaNode): Promise<void> {
        if (this.disposed)
            return

        const previous = this.refreshes.get(node.nodeId)

        if (
            previous?.assetId === node.assetId
            && this.isCurrent(previous, this.refreshes)
        )
            return

        previous?.cancelTimer?.()
        const work = {
            ...this.ports.readScope(),
            nodeId: node.nodeId,
            assetId: node.assetId,
        }
        this.refreshes.set(node.nodeId, work)
        await this.refresh(work, 0)
    }

    async refreshWorkspaceDescriptors(improvedDescriptors: Record<string, ContentDescriptor> | undefined): Promise<void> {
        if (
            this.disposed
            || !improvedDescriptors
            || !Object.keys(improvedDescriptors).length
        )
            return

        const scope = this.ports.readScope()
        const revision = this.revision

        try {
            await this.ports.loadWorkspaceAssets(scope.workspaceId)

            if (!this.scopeIsCurrent(scope, revision))
                return

            this.ports.refreshChrome()

            if (this.scopeIsCurrent(scope, revision))
                this.ports.refreshContext()
        } catch (error) {
            if (this.scopeIsCurrent(scope, revision))
                this.ports.reportError(error)
        }
    }

    clear(): void {
        this.revision += 1
        const pending = [...this.analysis.values(), ...this.refreshes.values()]
        this.analysis.clear()
        this.refreshes.clear()

        for (const work of pending) work.cancelTimer?.()
    }

    destroy(): void {
        this.disposed = true
        this.clear()
    }

    private scopeIsCurrent(
        scope: AnalysisScope,
        revision = this.revision,
    ): boolean {
        const current = this.ports.readScope()

        return !this.disposed && revision === this.revision
            && scope.workspaceId === current.workspaceId && scope.sceneKey === current.sceneKey
    }

    private isCurrent(
        work: PendingWork,
        owner: Map<string, PendingWork>,
        requireNode = true,
    ): boolean {
        if (
            owner.get(work.nodeId) !== work
            || !this.scopeIsCurrent(work)
        )
            return false

        const node = this.ports.readNode(work.nodeId)

        return requireNode ? Boolean(node && node.assetId === work.assetId) : !node || node.assetId === work.assetId
    }

    private schedule(
        work: PendingWork,
        callback: () => void,
        delayMs: number,
    ): void {
        work.cancelTimer?.()
        work.cancelTimer = this.ports.setTimer(() => {
            work.cancelTimer = undefined
            callback()
        }, delayMs)
    }

    private waitForNode(
        work: PendingWork,
        attempt: number,
    ): void {
        if (!this.isCurrent(
            work,
            this.analysis,
            false,
        )) {
            this.release(work, this.analysis)

            return
        }

        if (!this.ports.readNode(work.nodeId)) {
            if (attempt < 20)
                this.schedule(
                    work,
                    () => this.waitForNode(work, attempt + 1),
                    50,
                )
            else
                this.release(work, this.analysis)

            return
        }

        if (!work.assetId) {
            this.release(work, this.analysis)

            return
        }

        void this.analyze(work, 0)
    }

    private async analyze(
        work: PendingWork,
        attempt: number,
    ): Promise<void> {
        if (
            !work.assetId
            || !this.isCurrent(work, this.analysis)
        ) {
            this.release(work, this.analysis)

            return
        }

        let result: Awaited<ReturnType<WorkspaceMediaAnalysisPorts['describe']>>

        try {
            result = await this.ports.describe({
                workspaceId: work.workspaceId,
                assetId: work.assetId,
            })
        } catch {
            result = { error: 'MEDIA_ANALYSIS_FAILED' }
        }

        if (!this.isCurrent(work, this.analysis)) {
            this.release(work, this.analysis)

            return
        }

        if (
            result.error
            || !result.summary
        ) {
            const retryDelay = ANALYSIS_RETRY_DELAYS_MS[attempt]

            if (retryDelay !== undefined) {
                this.schedule(
                    work,
                    () => void this.analyze(work, attempt + 1),
                    retryDelay,
                )

                return
            }
        }

        try {
            this.ports.patchDescriptor(
                work.assetId,
                {
                    status: result.error
                        || !result.summary
                        ? 'failed'
                        : 'ready',
                    summary: result.error ? '' : result.summary ?? '',
                    entityTags: result.error
                        || !result.summary
                        ? []
                        : result.entityTags ?? [],
                    styleTags: result.error
                        || !result.summary
                        ? []
                        : result.styleTags ?? [],
                    source: 'analysis',
                    version: MEDIA_DESCRIPTOR_VERSION,
                    updatedAt: this.ports.now(),
                },
                result.error
                    || !result.summary
                    ? undefined
                    : result.title,
            )

            if (this.isCurrent(work, this.analysis))
                this.ports.refreshChrome()
        } catch (error) {
            this.ports.reportError(error)
        } finally {
            this.release(work, this.analysis)
        }
    }

    private async refresh(
        work: PendingWork,
        attempt: number,
    ): Promise<void> {
        if (
            !work.assetId
            || !this.isCurrent(work, this.refreshes)
        ) {
            this.release(work, this.refreshes)

            return
        }

        let retry = false

        try {
            this.ports.refreshChrome()

            if (!this.isCurrent(work, this.refreshes))
                return

            const result = await this.ports.refreshAsset(work.assetId, work.workspaceId)

            if (
                !this.isCurrent(work, this.refreshes)
                || 'error' in result
            )
                return

            const node = this.ports.readNode(work.nodeId)

            if (
                attempt === 0
                && node?.type === 'video'
            )
                this.ports.refreshVideo(node)

            if (!this.isCurrent(work, this.refreshes))
                return

            this.ports.refreshChrome()

            if (!this.isCurrent(work, this.refreshes))
                return

            this.ports.refreshMarkers()

            if (!this.isCurrent(work, this.refreshes))
                return

            this.queue(work.nodeId, work.assetId)
            const retryDelay = PROVENANCE_RETRY_DELAYS_MS[attempt]

            if (
                result.states.provenance !== 'sealed'
                && retryDelay !== undefined
            ) {
                retry = true
                this.schedule(
                    work,
                    () => void this.refresh(work, attempt + 1),
                    retryDelay,
                )
            }
        } catch (error) {
            if (this.isCurrent(work, this.refreshes))
                this.ports.reportError(error)
        } finally {
            if (!retry)
                this.release(work, this.refreshes)
        }
    }

    private release(
        work: PendingWork,
        owner: Map<string, PendingWork>,
    ): void {
        if (owner.get(work.nodeId) === work)
            owner.delete(work.nodeId)
    }
}
