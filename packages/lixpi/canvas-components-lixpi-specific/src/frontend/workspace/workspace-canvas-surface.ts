import {
    LoadingStatus,
    type Asset,
    type AssetDocumentRole,
    type CanvasState,
    type CapabilityArtifactCanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type ViewportSnapshot as Viewport,
} from '@lixpi/canvas-engine/shared'
import {
    WorkspaceCanvasMembership,
    type WorkspaceCanvasMembershipPorts,
} from '../../shared/persistence/workspace-canvas-membership.ts'
import {
    type WorkspaceCanvasSession,
} from '../../shared/persistence/workspace-canvas-session.ts'
import {
    WorkspaceViewportPersistence,
    type WorkspaceViewportPersistencePorts,
} from '../../shared/persistence/workspace-viewport-persistence.ts'
import { rebaseCanvasMembershipState } from '../../shared/scene/membership-state-rebase.ts'
import {
    WorkspaceCanvasActions,
    type WorkspaceCanvasActionsPorts,
    type WorkspaceCanvasInsertionNode,
} from './workspace-canvas-actions.ts'
import {
    WorkspaceCanvasChrome,
    type WorkspaceCanvasChromeSettings,
} from './workspace-canvas-chrome.ts'

export type WorkspaceCanvasDocument = {
    documentId: string
    assetId: string
    workspaceId: string
    organizationId: string
    title: string
    content?: object
    proseMirrorVersion: number
    revision: number
}

export type WorkspaceCanvasConversation = Omit<WorkspaceCanvasDocument, 'documentId'> & {
    threadId: string
    status: Exclude<Asset['states']['conversation'], 'none'>
    createdAt: number
    updatedAt: number
}

export type WorkspaceCanvasSurfaceSnapshot = {
    workspaceId: string
    loadedWorkspaceId: string | null
    organizationId: string
    loadingStatus: LoadingStatus
    canvasState: CanvasState | null
    assets: readonly Asset[]
}

export type WorkspaceCanvasRendererOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    mediaModeSwitchMountEl: HTMLDivElement
    modelMenuControlMountEl: HTMLDivElement
    glassTargets: readonly {
        id: string
        element: HTMLElement
    }[]
    workspaceId: string
    canvasState: CanvasState | null
    documents: WorkspaceCanvasDocument[]
    aiChatThreads: WorkspaceCanvasConversation[]
    onViewportChange: (viewport: Viewport) => void
    onCanvasStateChange: (state: CanvasState) => void
    onAuthoritativeCanvasStateChange: (change: {
        canvasState: CanvasState
        layoutRevision: number
    }) => void
    onAssetAttach: (request: {
        assetId: string
        nodeId: string
        canvasState: CanvasState
    }) => Promise<CanvasState>
    onAssetDetach: (request: {
        assetId: string
        nodeId: string
        removedNodeIds: string[]
        canvasState: CanvasState
    }) => Promise<CanvasState>
}

export type WorkspaceCanvasRendererInsertion = WorkspaceCanvasInsertionNode | Omit<CapabilityArtifactCanvasNode, 'position'> | Omit<OperationStatusCanvasNode, 'position'>
export type WorkspaceCanvasRenderer = {
    getCanvasState: () => CanvasState | null
    getViewport: () => Viewport
    setViewport: (viewport: Viewport) => void
    insertNodeAtViewportCenter: (
        node: WorkspaceCanvasRendererInsertion,
        patch?: Omit<Partial<CanvasState>, 'nodes' | 'edges' | 'viewport'>,
        commit?: boolean,
    ) => CanvasState | null
    replaceUploadPlaceholder: (
        placeholderId: string,
        node: WorkspaceCanvasRendererInsertion,
        commit?: boolean,
    ) => CanvasState | null
    commitTransientCanvasState: (state: CanvasState) => void
    commitTransientCanvasNodeInsertion: (
        state: CanvasState,
        nodeId: string,
        placeholderId?: string,
    ) => void
    markUploadPlaceholderFailed: (
        nodeId: string,
        message: string,
    ) => unknown
    render: (
        state: CanvasState | null,
        documents: WorkspaceCanvasDocument[],
        conversations: WorkspaceCanvasConversation[],
        workspaceId: string,
    ) => void
    toggleMediaLibrary: () => void
    destroy: () => void
}

export type WorkspaceCanvasSurfacePorts = {
    document: Document
    readSnapshot: () => WorkspaceCanvasSurfaceSnapshot
    readDocument: (
        assetId: string,
        role: AssetDocumentRole,
    ) => object | undefined
    subscriptions: readonly ((changed: () => void) => () => void)[]
    session: (workspaceId: string) => WorkspaceCanvasSession
    membership: WorkspaceCanvasMembershipPorts
    ingest: Pick<WorkspaceCanvasActionsPorts, 'createDocument' | 'uploadFile' | 'importUrl' | 'refreshAsset'>
    createId: () => string
    now: () => number
    publishTransient: (
        workspaceId: string,
        state: CanvasState,
    ) => void
    synchronizeAssets: (workspaceId: string) => (() => void) | void
    storage: WorkspaceViewportPersistencePorts['storage']
    setTimer: WorkspaceViewportPersistencePorts['setTimer']
    onPageHide: (callback: () => void) => () => void
    createRenderer: (options: WorkspaceCanvasRendererOptions) => WorkspaceCanvasRenderer
    reportError: (
        message: string,
        error: unknown,
    ) => void
}

const cloneViewport = (value: Viewport | null | undefined): Viewport | null => {
    return value
        && [value.x, value.y, value.zoom].every(Number.isFinite)
        ? { ...value }
        : null
}

export class WorkspaceCanvasSurface {
    readonly el: HTMLElement
    private readonly lifetime = new Lifetime()
    private readonly chrome: WorkspaceCanvasChrome
    private readonly actions: WorkspaceCanvasActions
    private renderer: WorkspaceCanvasRenderer | null = null
    private viewportPersistence: WorkspaceViewportPersistence | null = null
    private snapshot: WorkspaceCanvasSurfaceSnapshot
    private canvasState: CanvasState | null = null
    private documents: WorkspaceCanvasDocument[] = []
    private conversations: WorkspaceCanvasConversation[] = []
    private viewport: Viewport = {
        x: 0,
        y: 0,
        zoom: 1,
    }
    private renderedWorkspaceId: string | null = null
    private syncedWorkspaceId: string | null = null
    private stopSynchronization: (() => void) | null = null
    private viewRevision = 0
    private transientMutation = false
    private disposed = false
    private reconciling = false
    private reconcileRequested = false

    constructor(
        settings: WorkspaceCanvasChromeSettings & { insertionWidth: number },
        private readonly ports: WorkspaceCanvasSurfacePorts,
    ) {
        this.snapshot = ports.readSnapshot()
        this.actions = new WorkspaceCanvasActions({
            ...ports.ingest,
            readScope: () =>
                this.isLoaded()
                    && this.renderer
                    && this.canvasState
                    ? {
                        workspaceId: this.snapshot.workspaceId,
                        organizationId: this.snapshot.organizationId,
                        revision: this.viewRevision,
                    }
                    : null,
            createId: ports.createId,
            now: ports.now,
            insertionWidth: settings.insertionWidth,
            attach: (workspaceId, request) => this.membership(workspaceId).attach(request),
            insertPlaceholder: node => {
                this.transientMutation = true

                try {
                    this.renderer?.insertNodeAtViewportCenter(node)
                } finally {
                    this.transientMutation = false
                }
            },
            failPlaceholder: (nodeId, message) => this.renderer?.markUploadPlaceholderFailed(nodeId, message),
            prepareInsertion: (node, placeholderId) => {
                const replaced = placeholderId ? this.renderer?.replaceUploadPlaceholder(
                    placeholderId,
                    node,
                    false,
                ) : null
                const state = replaced ?? this.renderer?.insertNodeAtViewportCenter(
                    node,
                    {},
                    false,
                )

                if (!state)
                    throw new Error('CANVAS_REVISION_REQUIRED')

                return state
            },
            commitDocument: state => this.renderer?.commitTransientCanvasState(state),
            commitMedia: (
                state,
                nodeId,
                placeholderId,
            ) => this.renderer?.commitTransientCanvasNodeInsertion(
                state,
                nodeId,
                placeholderId,
            ),
            closeUploadMenu: () => this.chrome.closeUploadMenu(),
            reportError: ports.reportError,
        })
        this.chrome = new WorkspaceCanvasChrome(
            settings,
            {
                document: ports.document,
                createDocument: () => this.actions.createDocument(),
                uploadFile: file => this.actions.uploadFile(file),
                importUrl: url => this.actions.importUrl(url),
                toggleMediaLibrary: () => this.renderer?.toggleMediaLibrary(),
                reportError: error => ports.reportError('[CANVAS] Toolbar action failed:', error),
            },
        )
        this.el = this.chrome.element
        this.lifetime.own(() => this.chrome.destroy())
        this.lifetime.own(() => this.actions.destroy())
        this.lifetime.own(() => this.stopSynchronization?.())
        this.lifetime.own(() => this.viewportPersistence?.destroy())

        try {
            this.derive(this.snapshot)
            this.ensureViewportPersistence()
            this.viewport = cloneViewport(this.canvasState?.viewport) ?? this.viewport
            this.chrome.setZoom(this.viewport.zoom)
            const renderer = ports.createRenderer({
                paneEl: this.chrome.pane,
                viewportEl: this.chrome.viewportMount,
                mediaModeSwitchMountEl: this.chrome.mediaModeSwitchMount,
                modelMenuControlMountEl: this.chrome.modelMenuControlMount,
                glassTargets: this.chrome.glassTargets,
                workspaceId: this.snapshot.workspaceId,
                canvasState: this.canvasState,
                documents: this.documents,
                aiChatThreads: this.conversations,
                onViewportChange: viewport => this.changeViewport(viewport),
                onCanvasStateChange: state => this.persist(state),
                onAuthoritativeCanvasStateChange: ({
                    canvasState,
                    layoutRevision,
                }) => {
                    if (!this.isLoaded())
                        return

                    this.ports.session(this.snapshot.workspaceId).persistence.adoptAuthoritative({
                        canvasState,
                        version: {
                            updatedAt: layoutRevision,
                            canvasStateUpdatedAt: layoutRevision,
                        },
                    })
                },
                onAssetAttach: request => this.mutateMembership('attach', request),
                onAssetDetach: request => this.mutateMembership('detach', request),
            })
            this.renderer = renderer
            this.lifetime.own(() => renderer.destroy())
            this.lifetime.own(
                ports.onPageHide(() => this.viewportPersistence?.stashForUnload()),
            )
            this.reconcile()

            for (const subscribe of ports.subscriptions) this.lifetime.own(
                subscribe(this.reconcile),
            )
        } catch (error) {
            try {
                this.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Workspace surface mount failed')
            }

            throw error
        }
    }

    destroy(): void {
        if (this.disposed)
            return

        const errors: unknown[] = []

        // Retain the final renderer geometry before closing callback admission.
        try {
            const state = this.renderer?.getCanvasState() ?? this.canvasState
            this.viewportPersistence?.sync(this.viewport, state)
        } catch (error) {
            errors.push(error)
        }

        this.disposed = true
        this.viewRevision += 1

        try {
            this.lifetime.destroy()
        } catch (error) {
            errors.push(error)
        } finally {
            this.renderer = null
            this.viewportPersistence = null
            this.stopSynchronization = null
        }

        if (errors.length)
            throw new AggregateError(errors, 'Workspace surface disposal failed')
    }

    private isLoaded(): boolean {
        return !this.disposed && Boolean(this.snapshot.workspaceId) && this.snapshot.loadedWorkspaceId === this.snapshot.workspaceId
    }

    private membership(workspaceId: string): WorkspaceCanvasMembership {
        return new WorkspaceCanvasMembership(this.ports.session(workspaceId).persistence, this.ports.membership)
    }

    private async mutateMembership(
        operation: 'attach' | 'detach',
        request: {
            assetId: string
            nodeId: string
            canvasState: CanvasState
            removedNodeIds?: string[]
        },
    ): Promise<CanvasState> {
        if (
            !this.isLoaded()
            || !this.canvasState
        )
            throw new Error('WORKSPACE_CHANGED_DURING_CANVAS_MUTATION')

        const workspaceId = this.snapshot.workspaceId
        const revision = this.viewRevision

        return await this.membership(workspaceId)[operation]({
            assetId: request.assetId,
            nodeId: request.nodeId,
            prepare: () => {
                if (
                    !this.isLoaded()
                    || workspaceId !== this.snapshot.workspaceId
                    || revision !== this.viewRevision
                )
                    throw new Error('WORKSPACE_CHANGED_DURING_CANVAS_MUTATION')

                return rebaseCanvasMembershipState({
                    requestedState: request.canvasState,
                    currentState: this.renderer?.getCanvasState(),
                    operation,
                    removedNodeIds: request.removedNodeIds,
                })
            },
        })
    }

    private persist(state: CanvasState): void {
        if (!this.isLoaded())
            return

        const viewport = cloneViewport(state.viewport)
            ?? cloneViewport(this.renderer?.getViewport())
            ?? this.viewport
        const next = {
            ...state,
            viewport,
        }

        if (this.transientMutation)
            this.ports.publishTransient(this.snapshot.workspaceId, next)
        else
            this.ports.session(this.snapshot.workspaceId).persistence.update(next)
    }

    private changeViewport(value: Viewport): void {
        const viewport = cloneViewport(value)

        if (
            this.disposed
            || !viewport
        )
            return

        this.viewport = viewport
        this.chrome.setZoom(viewport.zoom)
        this.viewportPersistence?.change(viewport)
    }

    private derive(snapshot: WorkspaceCanvasSurfaceSnapshot): void {
        const changedWorkspace = snapshot.workspaceId !== this.snapshot.workspaceId
        const nextCanvasState = snapshot.workspaceId
            && snapshot.workspaceId === snapshot.loadedWorkspaceId
            && snapshot.loadingStatus === LoadingStatus.success
            ? snapshot.canvasState
            : null

        if (
            changedWorkspace
            || (this.canvasState && !nextCanvasState)
        ) {
            this.viewRevision += 1
            this.actions.clear()
            const previous = this.viewportPersistence
            this.viewportPersistence = null
            previous?.destroy()
        }

        this.snapshot = snapshot
        this.canvasState = nextCanvasState
        const assets = this.isLoaded() ? snapshot.assets : []
        const documentView = (
            asset: Asset,
            role: AssetDocumentRole,
        ) => ({
            assetId: asset.assetId,
            workspaceId: snapshot.workspaceId,
            organizationId: asset.organizationId,
            title: asset.title,
            content: this.ports.readDocument(asset.assetId, role),
            proseMirrorVersion: asset.documents[role]?.version ?? 0,
            revision: asset.revision,
        })
        this.documents = assets.filter(asset => Boolean(asset.documents.content)).map(
            asset => ({
                documentId: asset.assetId,
                ...documentView(asset, 'content'),
            }),
        )
        this.conversations = assets.filter(asset => Boolean(asset.documents.conversation)).map(
            asset => ({
                threadId: asset.assetId,
                ...documentView(asset, 'conversation'),
                status: asset.states.conversation === 'none' ? 'idle' : asset.states.conversation,
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
            }),
        )
    }

    private synchronize(): void {
        const workspaceId = this.isLoaded() ? this.snapshot.workspaceId : null

        if (workspaceId === this.syncedWorkspaceId)
            return

        const previous = this.stopSynchronization
        this.stopSynchronization = null
        this.syncedWorkspaceId = null
        previous?.()

        if (workspaceId) {
            // Synchronization can publish store changes synchronously.
            this.syncedWorkspaceId = workspaceId

            try {
                const stop = this.ports.synchronizeAssets(workspaceId) ?? null

                if (this.disposed)
                    stop?.()
                else
                    this.stopSynchronization = stop
            } catch (error) {
                this.syncedWorkspaceId = null

                throw error
            }
        }
    }

    private ensureViewportPersistence(): void {
        if (
            !this.canvasState
            || !this.isLoaded()
            || this.viewportPersistence
        )
            return

        const workspaceId = this.snapshot.workspaceId
        this.viewportPersistence = new WorkspaceViewportPersistence(
            this.ports.session(workspaceId),
            {
                readCanvasState: () => {
                    if (
                        !this.isLoaded()
                        || this.snapshot.workspaceId !== workspaceId
                    )
                        return null

                    return this.renderedWorkspaceId === workspaceId ? this.renderer?.getCanvasState() ?? this.canvasState : this.canvasState
                },
                restoreViewport: viewport => {
                    if (
                        !this.isLoaded()
                        || this.snapshot.workspaceId !== workspaceId
                    )
                        return

                    this.viewport = viewport
                    this.chrome.setZoom(viewport.zoom)
                    this.renderer?.setViewport(viewport)
                },
                storage: this.ports.storage,
                setTimer: this.ports.setTimer,
            },
        )
    }

    private reconcile = (): void => {
        if (this.disposed)
            return

        if (this.reconciling) {
            this.reconcileRequested = true

            return
        }

        this.reconciling = true

        try {
            do {
                this.reconcileRequested = false
                this.derive(
                    this.ports.readSnapshot(),
                )

                if (this.disposed)
                    return

                this.chrome.setRightPanelOpen(
                    Boolean(this.isLoaded() && (this.canvasState?.aiChatPanel?.isOpen ?? this.canvasState?.lastActiveConversationAssetId)),
                )
                this.synchronize()

                if (this.disposed)
                    return

                this.ensureViewportPersistence()
                this.renderer?.render(
                    this.canvasState,
                    this.documents,
                    this.conversations,
                    this.snapshot.workspaceId,
                )

                if (this.disposed)
                    return

                this.renderedWorkspaceId = this.snapshot.workspaceId
                this.viewport = this.renderer?.getViewport() ?? this.viewport
                this.chrome.setZoom(this.viewport.zoom)
                this.viewportPersistence?.sync(this.viewport, this.canvasState)
                this.viewportPersistence?.restore(this.canvasState?.viewport)
            } while (
                this.reconcileRequested
                && !this.disposed
            )
        } finally {
            this.reconciling = false
        }
    }
}
