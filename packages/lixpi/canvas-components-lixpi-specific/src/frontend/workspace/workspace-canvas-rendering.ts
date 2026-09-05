import {
    createPendingCanvasVisualCommit,
    getCanvasVisualSyncKey,
    getNodeStructureKey,
    mergeIncomingCanvasStateWithPendingVisualCommit,
    planWorkspaceRenderTransition,
    type PendingCanvasVisualCommit,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    shouldPreserveLiveViewportForScene,
    type ViewportSnapshot,
} from '@lixpi/canvas-engine/shared'
import {
    type CanvasAiChatPanelState,
    type CanvasState,
    type LoadingStatus,
} from '@lixpi/constants'
import { WorkspaceBranchMarkerProjection } from './workspace-branch-marker-projection.ts'
import {
    type WorkspaceCanvasConversation,
    type WorkspaceCanvasDocument,
} from './workspace-canvas-surface.ts'

type RenderKeys = {
    nodeStructure: string
    visual: string
    documents: string
    threads: string
}

type MediaAnalysisReset = {
    state: CanvasState | null
    changed: boolean
}

export type WorkspaceCanvasRenderingPorts = {
    getWorkspaceId: () => string
    setWorkspaceId: (workspaceId: string) => void
    getRenderedWorkspaceId: () => string | null
    setRenderedWorkspaceId: (workspaceId: string | null) => void
    getLoadingStatus: () => LoadingStatus
    setLoadingVisible: (visible: boolean) => void
    getPendingVisualCommit: () => PendingCanvasVisualCommit | null
    setPendingVisualCommit: (commit: PendingCanvasVisualCommit | null) => void
    getState: () => CanvasState | null
    setState: (state: CanvasState | null) => void
    setDocuments: (documents: WorkspaceCanvasDocument[]) => void
    setThreads: (threads: WorkspaceCanvasConversation[]) => void
    getPanelState: () => CanvasAiChatPanelState
    getKeys: () => RenderKeys
    setKeys: (keys: Partial<RenderKeys>) => void
    getLiveViewport: () => ViewportSnapshot
    isViewportLocked: () => boolean
    syncPanZoom: (viewport: ViewportSnapshot) => void
    syncViewportInteraction: (viewport: ViewportSnapshot) => void
    applyViewport: (viewport: ViewportSnapshot) => void
    resetStaleMediaAnalysis: (state: CanvasState) => MediaAnalysisReset
    preserveActiveMedia: (state: CanvasState | null) => CanvasState | null
    mergeThreads: (
        threads: WorkspaceCanvasConversation[],
        state: CanvasState | null,
        workspaceChanged: boolean,
    ) => WorkspaceCanvasConversation[]
    getDocumentsKey: (documents: WorkspaceCanvasDocument[]) => string
    getThreadsKey: (threads: WorkspaceCanvasConversation[]) => string
    clearWorkspaceRuntime: () => void
    releaseWorkspaceResources: () => void
    publishState: (state: CanvasState) => void
    syncPanelState: () => void
    clearVisualContent: (
        documents: WorkspaceCanvasDocument[],
        threads: WorkspaceCanvasConversation[],
    ) => void
    renderNodes: () => void
    syncDocuments: (documents: WorkspaceCanvasDocument[]) => void
    syncMarkers: () => void
    hasPanelElement: () => boolean
    isPanelClosing: () => boolean
    renderDetails: (options?: {
        preserveModeSwitch?: boolean
        animateOpen?: boolean
    }) => void
    destroyPanel: () => void
    refreshMarkerThreads: (threadIds: Iterable<string>) => void
    hasConnections: () => boolean
    syncNodeGeometry: (state: CanvasState) => void
    syncCanvasLayer: (state: CanvasState) => void
    scheduleEdges: () => void
    syncMedia: (state: CanvasState) => void
    syncChrome: (state: CanvasState | null) => void
    updateChromeLayout: () => void
    reattachRuns: () => void
    createComposer: () => void
    markPersistedViewportApplied: () => void
    isDebugEnabled: () => boolean
    debug: (
        event: string,
        details: Record<string, unknown>,
    ) => void
}

export class WorkspaceCanvasRendering {
    constructor(private readonly ports: WorkspaceCanvasRenderingPorts) {}

    render(
        incomingState: CanvasState | null,
        documents: WorkspaceCanvasDocument[],
        incomingThreads: WorkspaceCanvasConversation[] = [],
        nextWorkspaceId?: string,
    ): void {
        const transition = planWorkspaceRenderTransition({
            currentRouteWorkspaceId: this.ports.getWorkspaceId(),
            nextRouteWorkspaceId: nextWorkspaceId,
            renderedWorkspaceId: this.ports.getRenderedWorkspaceId(),
            incomingCanvasState: incomingState,
            loadingStatus: this.ports.getLoadingStatus(),
        })
        const workspaceChanged = transition.shouldTreatAsWorkspaceChanged

        if (workspaceChanged)
            this.ports.releaseWorkspaceResources()

        this.ports.setWorkspaceId(transition.routeWorkspaceId)
        this.ports.setLoadingVisible(transition.shouldShowLoadingOutline)

        if (workspaceChanged)
            this.ports.setPendingVisualCommit(null)

        const pendingBeforeMerge = this.ports.getPendingVisualCommit()
        const renderState = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState,
            pendingVisualCommit: pendingBeforeMerge,
        })
        const normalizedState = renderState.state
            ? WorkspaceBranchMarkerProjection.normalizeState(renderState.state)
            : renderState.state
        this.ports.setPendingVisualCommit(renderState.pendingVisualCommit)

        if (
            pendingBeforeMerge
            || renderState.usedPendingVisualState
            || renderState.acknowledgedPendingVisualState
        )
            this.debugPendingMerge(
                incomingState,
                normalizedState,
                pendingBeforeMerge,
                renderState,
            )

        const incomingMatchesLocalCommit = renderState.usedPendingVisualState || renderState.acknowledgedPendingVisualState
        const shouldResetMediaAnalysis = workspaceChanged
            || (!this.ports.getState() && Boolean(normalizedState) && !incomingMatchesLocalCommit)
        const mediaAnalysis = shouldResetMediaAnalysis
            && normalizedState
            ? this.ports.resetStaleMediaAnalysis(normalizedState)
            : {
                state: normalizedState,
                changed: false,
            }
        const persistedState = mediaAnalysis.state
        const effectiveState = workspaceChanged ? persistedState : this.ports.preserveActiveMedia(persistedState)

        if (
            mediaAnalysis.changed
            && persistedState
        ) {
            this.ports.setPendingVisualCommit(
                createPendingCanvasVisualCommit(persistedState),
            )
            this.ports.publishState(persistedState)
        }

        if (workspaceChanged)
            this.ports.clearWorkspaceRuntime()

        const threads = this.ports.mergeThreads(
            incomingThreads,
            effectiveState,
            workspaceChanged,
        )
        const previousKeys = this.ports.getKeys()
        const nextKeys: RenderKeys = {
            nodeStructure: getNodeStructureKey(effectiveState),
            visual: getCanvasVisualSyncKey(effectiveState),
            documents: this.ports.getDocumentsKey(documents),
            threads: this.ports.getThreadsKey(threads),
        }
        const nodeStructureChanged = nextKeys.nodeStructure !== previousKeys.nodeStructure
        const documentsChanged = nextKeys.documents !== previousKeys.documents
        const threadsChanged = nextKeys.threads !== previousKeys.threads
        const needsRerender = nodeStructureChanged || workspaceChanged
        const previousViewport = this.ports.getState()?.viewport
        const incomingViewport = effectiveState?.viewport
        const viewportChanged = !previousViewport
            || !incomingViewport
            || previousViewport.x !== incomingViewport.x
            || previousViewport.y !== incomingViewport.y
            || previousViewport.zoom !== incomingViewport.zoom
        const visualChanged = workspaceChanged || nextKeys.visual !== previousKeys.visual
        this.debugDecision({
            incomingState,
            effectiveState,
            pendingBeforeMerge,
            renderState,
            workspaceChanged,
            needsRerender,
            nodeStructureChanged,
            documentsChanged,
            threadsChanged,
            viewportChanged,
            visualChanged,
            previousKeys,
            nextKeys,
        })

        const liveViewport = this.ports.getLiveViewport()
        const preserveLiveViewport = shouldPreserveLiveViewportForScene({
            incomingViewport: effectiveState?.viewport,
            liveViewport,
            sceneChanged: workspaceChanged,
        })
        this.ports.setState(preserveLiveViewport
            && effectiveState
            ? {
                ...effectiveState,
                viewport: liveViewport,
            }
            : effectiveState)
        this.ports.setDocuments(documents)
        this.ports.setThreads(threads)
        this.ports.syncPanelState()

        if (transition.shouldClearVisualContent)
            this.ports.clearVisualContent(documents, threads)
        else if (needsRerender)
            this.ports.renderNodes()
        else
            this.refreshMountedSurfaces(
                documents,
                documentsChanged,
                threadsChanged,
            )

        this.ports.setKeys({
            documents: nextKeys.documents,
            threads: nextKeys.threads,
        })

        if (this.ports.getState())
            this.ports.setRenderedWorkspaceId(
                this.ports.getWorkspaceId(),
            )

        this.ports.refreshMarkerThreads(
            threads.map(thread => thread.threadId),
        )

        const currentState = this.ports.getState()

        if (
            currentState
            && this.ports.hasConnections()
            && (visualChanged || needsRerender)
        ) {
            if (!needsRerender)
                this.ports.syncNodeGeometry(currentState)

            this.ports.syncCanvasLayer(currentState)
            this.ports.scheduleEdges()
            this.ports.syncMedia(currentState)
            this.ports.setKeys({ visual: getCanvasVisualSyncKey(currentState) })
        }

        this.ports.syncChrome(currentState)
        this.syncViewport(
            previousViewport,
            effectiveState,
            viewportChanged,
            preserveLiveViewport,
            liveViewport,
        )

        if (effectiveState)
            this.ports.markPersistedViewportApplied()

        this.ports.reattachRuns()

        if (workspaceChanged)
            this.ports.createComposer()
    }

    private refreshMountedSurfaces(
        documents: WorkspaceCanvasDocument[],
        documentsChanged: boolean,
        threadsChanged: boolean,
    ): void {
        this.ports.syncDocuments(documents)
        this.ports.syncMarkers()
        const panel = this.ports.getPanelState()

        if (
            panel.generatedOutputDetailsTarget
            && this.ports.hasPanelElement()
            && (documentsChanged || threadsChanged)
        )
            this.ports.renderDetails({
                preserveModeSwitch: true,
                animateOpen: false,
            })
        else if (
            threadsChanged
            && panel.isOpen
        )
            this.ports.renderDetails()

        if (
            panel.isOpen
            && !this.ports.hasPanelElement()
        )
            this.ports.renderDetails()

        if (
            !panel.isOpen
            && this.ports.hasPanelElement()
            && !this.ports.isPanelClosing()
        )
            this.ports.destroyPanel()
    }

    private syncViewport(
        previousViewport: ViewportSnapshot | undefined,
        effectiveState: CanvasState | null,
        viewportChanged: boolean,
        preserveLiveViewport: boolean,
        liveViewport: ViewportSnapshot,
    ): void {
        if (
            !viewportChanged
            || !effectiveState?.viewport
        )
            return

        if (preserveLiveViewport)
            this.ports.syncPanZoom(liveViewport)
        else if (this.ports.isViewportLocked()) {
            const lockedViewport = this.ports.getLiveViewport()
            const currentState = this.ports.getState()

            if (currentState)
                this.ports.setState({
                    ...currentState,
                    viewport: lockedViewport,
                })

            this.ports.syncPanZoom(lockedViewport)
        } else {
            this.ports.syncViewportInteraction(effectiveState.viewport)
            this.ports.applyViewport(effectiveState.viewport)
            this.ports.syncPanZoom(effectiveState.viewport)
        }

        const currentViewport = this.ports.getState()?.viewport

        if (
            previousViewport?.x !== currentViewport?.x
            || previousViewport?.y !== currentViewport?.y
            || previousViewport?.zoom !== currentViewport?.zoom
        )
            this.ports.updateChromeLayout()
    }

    private debugPendingMerge(
        incomingState: CanvasState | null,
        normalizedState: CanvasState | null,
        pendingBeforeMerge: PendingCanvasVisualCommit | null,
        renderState: ReturnType<typeof mergeIncomingCanvasStateWithPendingVisualCommit>,
    ): void {
        if (!this.ports.isDebugEnabled())
            return

        this.ports.debug(
            'pending-visual-merge',
            {
                incomingNodeCount: incomingState?.nodes.length ?? 0,
                incomingEdgeCount: incomingState?.edges.length ?? 0,
                incomingNodeIds: incomingState?.nodes.map(node => node.nodeId) ?? [],
                pendingNodeCount: pendingBeforeMerge?.state.nodes.length ?? 0,
                pendingEdgeCount: pendingBeforeMerge?.state.edges.length ?? 0,
                pendingNodeIds: pendingBeforeMerge?.state.nodes.map(node => node.nodeId) ?? [],
                resultNodeCount: normalizedState?.nodes.length ?? 0,
                resultEdgeCount: normalizedState?.edges.length ?? 0,
                resultNodeIds: normalizedState?.nodes.map(node => node.nodeId) ?? [],
                usedPendingVisualState: renderState.usedPendingVisualState,
                acknowledgedPendingVisualState: renderState.acknowledgedPendingVisualState,
                clearedPendingVisualCommit: Boolean(pendingBeforeMerge && !renderState.pendingVisualCommit),
            },
        )
    }

    private debugDecision(input: {
        incomingState: CanvasState | null
        effectiveState: CanvasState | null
        pendingBeforeMerge: PendingCanvasVisualCommit | null
        renderState: ReturnType<typeof mergeIncomingCanvasStateWithPendingVisualCommit>
        workspaceChanged: boolean
        needsRerender: boolean
        nodeStructureChanged: boolean
        documentsChanged: boolean
        threadsChanged: boolean
        viewportChanged: boolean
        visualChanged: boolean
        previousKeys: RenderKeys
        nextKeys: RenderKeys
    }): void {
        if (!this.ports.isDebugEnabled())
            return

        if (
            !input.needsRerender
            && !input.visualChanged
            && !input.pendingBeforeMerge
            && !input.renderState.usedPendingVisualState
            && !input.renderState.acknowledgedPendingVisualState
            && this.ports.getPanelState().generatedOutputDetailsTarget === undefined
        )
            return

        this.ports.debug(
            'decision',
            {
                workspaceChanged: input.workspaceChanged,
                needsRerender: input.needsRerender,
                nodeStructureChanged: input.nodeStructureChanged,
                documentsKeyChanged: input.documentsChanged,
                threadsKeyChanged: input.threadsChanged,
                viewportChanged: input.viewportChanged,
                visualStateChanged: input.visualChanged,
                usedPendingVisualState: input.renderState.usedPendingVisualState,
                acknowledgedPendingVisualState: input.renderState.acknowledgedPendingVisualState,
                hasPendingVisualCommit: Boolean(input.pendingBeforeMerge),
                incomingNodeCount: input.incomingState?.nodes.length ?? 0,
                effectiveNodeCount: input.effectiveState?.nodes.length ?? 0,
                incomingNodeIds: input.incomingState?.nodes.map(node => node.nodeId).join(',') ?? '',
                effectiveNodeIds: input.effectiveState?.nodes.map(node => node.nodeId).join(',') ?? '',
                previousNodeStructureKeyLength: input.previousKeys.nodeStructure.length,
                nextNodeStructureKeyLength: input.nextKeys.nodeStructure.length,
                previousDocumentsKey: input.previousKeys.documents,
                nextDocumentsKey: input.nextKeys.documents,
                previousThreadsKey: input.previousKeys.threads,
                nextThreadsKey: input.nextKeys.threads,
                previousVisualSyncKeyLength: input.previousKeys.visual.length,
                nextVisualSyncKeyLength: input.nextKeys.visual.length,
                generatedOutputDetailsTarget: this.getDetailsTargetDebugKey(),
            },
        )
    }

    private getDetailsTargetDebugKey(): string {
        const target = this.ports.getPanelState().generatedOutputDetailsTarget

        return target ? `${target.kind}:${target.nodeId}` : ''
    }
}
