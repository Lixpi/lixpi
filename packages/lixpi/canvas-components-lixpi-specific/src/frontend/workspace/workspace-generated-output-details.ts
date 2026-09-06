import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    createGeneratedOutputDetailsSidebar,
    mountWorkspaceMediaHistory,
    WorkspaceGenerationHistory,
    WorkspaceOutputDetails,
    type GeneratedOutputDetailsSidebarInstance,
    type GeneratedOutputRegenerationRequest,
    type WorkspaceAssetDetailsPorts,
    type WorkspaceGenerationHistoryPorts,
    type WorkspaceHistoryView,
    type WorkspaceOutputReview,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'
import {
    type WorkspaceHistory,
    type BranchMarkerNode,
    type GeneratedOutputCanvasNode,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    type MediaGenerationProgressInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/progress'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type AiLineageProjectionScope,
} from '@lixpi/prosemirror'
import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type CanvasAiChatPanelState,
    type CanvasGeneratedOutputDetailsTarget,
    type CanvasNode,
    type CanvasRightSidePanelMode,
    type CanvasState,
    type CapabilityArtifactCanvasNode,
    type ImageCanvasNode,
    type MediaDescriptor,
    type MediaGenerationProgressState,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    type WorkspaceCanvasContext,
} from './workspace-canvas-context.ts'
import {
    type WorkspaceCanvasEditors,
} from './workspace-canvas-editors.ts'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspaceCanvasLibraries,
} from './workspace-canvas-libraries.ts'
import {
    type WorkspaceRightPanelRenderOptions,
} from './workspace-right-panel.ts'

type GeneratedMediaProjectionTarget = {
    node: ImageCanvasNode | VideoCanvasNode
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
}

type BranchMarkerProjectionTarget = {
    marker: BranchMarkerNode
    lineageProjectionScope: AiLineageProjectionScope
}

export type WorkspaceGeneratedOutputDetailsPorts = {
    document: Document
    host: WorkspaceCanvasHost
    editors: WorkspaceCanvasEditors
    context: WorkspaceCanvasContext
    libraries: WorkspaceCanvasLibraries
    history: WorkspaceHistory
    review: WorkspaceOutputReview
    createAssetViewPorts: () => WorkspaceAssetDetailsPorts
    getState: () => CanvasState | null
    getPanelState: () => CanvasAiChatPanelState
    persistPanelState: (state: CanvasAiChatPanelState) => void
    renderPanel: (options?: WorkspaceRightPanelRenderOptions) => void
    syncFooters: (state: CanvasState | null) => void
    getMediaContent: (node: ImageCanvasNode | VideoCanvasNode) => unknown
    getCapabilityProgressStatus: (node: CapabilityArtifactCanvasNode) => string | undefined
    findNode: (nodeId: string | undefined) => CanvasNode | undefined
    now: () => number
    reportError: (
        message: string,
        error: unknown,
    ) => void
}

export class WorkspaceGeneratedOutputDetails {
    private readonly html: ReturnType<typeof createDocumentHtml>
    private activeDetails: WorkspaceOutputDetails | null = null
    private activePanel: GeneratedOutputDetailsSidebarInstance | null = null

    constructor(private readonly ports: WorkspaceGeneratedOutputDetailsPorts) {
        this.html = createDocumentHtml(ports.document)
    }

    getTraceState = (node: ImageCanvasNode | VideoCanvasNode): MediaGenerationProgressState | null =>
        this.ports.history.getMediaGenerationTraceState(node)

    targetsMatch = (
        left: CanvasGeneratedOutputDetailsTarget | undefined,
        right: CanvasGeneratedOutputDetailsTarget,
    ): boolean => left?.kind === right.kind && left.nodeId === right.nodeId

    open = (
        target: CanvasGeneratedOutputDetailsTarget,
        options: { toggle?: boolean } = {},
    ): void => {
        if (
            options.toggle
            && this.targetsMatch(this.ports.getPanelState().generatedOutputDetailsTarget, target)
        ) {
            this.close()

            return
        }

        this.ports.persistPanelState({
            ...this.ports.getPanelState(),
            isOpen: true,
            topLevelMode: 'aiThreads',
            generatedOutputDetailsTarget: target,
        })
        this.ports.syncFooters(
            this.ports.getState(),
        )
        this.render()
    }

    close = (): void => {
        const {
            generatedOutputDetailsTarget: _removedTarget,
            ...panelState
        } = this.ports.getPanelState()
        this.ports.persistPanelState(panelState)
        this.ports.syncFooters(
            this.ports.getState(),
        )
        this.render()
    }

    isAccepted = (node: GeneratedOutputCanvasNode): boolean => this.ports.review.isGeneratedOutputAccepted(node)

    isReviewReady = (node: GeneratedOutputCanvasNode): boolean => this.ports.review.isGeneratedOutputReviewReady(node)

    accept = async (
        scope: 'output-node' | 'branch-lineage',
        nodeId: string,
    ): Promise<void> => void (await this.ports.review.acceptGeneratedOutput(scope, nodeId))

    reject = async (
        scope: 'output-node' | 'branch-lineage',
        nodeId: string,
    ): Promise<'applied' | 'not-found' | 'failed'> => await this.ports.review.rejectGeneratedOutput(scope, nodeId)

    regenerate = async (request: GeneratedOutputRegenerationRequest): Promise<void> =>
        void (await this.ports.review.regenerateGeneratedOutputs(request))

    isProgressActive = (node: GeneratedOutputCanvasNode): boolean => {
        if (node.type === 'capabilityArtifact') {
            const status = this.ports.getCapabilityProgressStatus(node)

            return status === 'pending' || status === 'running'
        }

        const status = this.getTraceState(node)?.status

        return status === 'pending' || status === 'running' || status === 'awaiting-provider-verification'
    }

    resolveNode = (target: CanvasGeneratedOutputDetailsTarget | undefined): GeneratedOutputCanvasNode | BranchMarkerNode | null =>
        this.ports.history.resolveGeneratedOutputDetailsNode(target)

    mountContent = (
        host: HTMLElement,
        mode: CanvasRightSidePanelMode,
    ): () => void => {
        const lifetime = new Lifetime()

        try {
            const unmountLibrary = this.ports.libraries.mount(host, mode)

            if (unmountLibrary)
                lifetime.own(unmountLibrary)
            else {
                lifetime.own(this.destroyProjection)
                const node = this.resolveNode(this.ports.getPanelState().generatedOutputDetailsTarget)

                if (node) {
                    this.activePanel = createGeneratedOutputDetailsSidebar({
                        onClose: this.close,
                        renderContent: body => this.renderContent(body, node),
                    })
                    host.appendChild(this.activePanel.element)
                } else
                    host.appendChild(
                        this.html`<div className="workspace-generated-output-details-empty nopan">Select a media item or lineage marker to view its details.</div>` as HTMLDivElement,
                    )
            }
        } catch (error) {
            lifetime.destroy()

            throw error
        }

        return () => lifetime.destroy()
    }

    render = (options: WorkspaceRightPanelRenderOptions = {}): void => {
        const target = this.ports.getPanelState().generatedOutputDetailsTarget

        if (
            target
            && !this.resolveNode(target)
        ) {
            const {
                generatedOutputDetailsTarget: _removed,
                ...state
            } = this.ports.getPanelState()
            this.ports.persistPanelState(state)
        }

        this.ports.renderPanel(options)
    }

    syncProgress = (state: CanvasState): void => {
        this.ports.syncFooters(state)
        this.activeDetails?.sync(state)
    }

    destroyProjection = (): void => {
        const cleanup = new Lifetime()
        const details = this.activeDetails
        const panel = this.activePanel
        this.activeDetails = null
        this.activePanel = null

        if (panel)
            cleanup.own(() => panel.destroy())

        if (details)
            cleanup.own(() => details.destroy())

        cleanup.destroy()
    }

    destroy(): void {
        this.destroyProjection()
    }

    private getGenerationHistoryPorts(): WorkspaceGenerationHistoryPorts {
        return {
            getNode: this.ports.findNode,
            getContextEnvironment: this.ports.context.getPreviewEnvironment,
            renditionPath: this.ports.host.media.renditionPath,
            getMediaContent: this.ports.getMediaContent,
            getProgress: this.getTraceState,
            createReasoningBadge: modelId => this.ports.host.models.createBadge({
                modelId,
                monochromeIcon: true,
            }),
            styleReasoningHeader: header => this.ports.host.models.styleBadge(
                header,
                { scale: this.ports.host.settings.mediaNode.generatedMediaChrome.chatScale },
            ),
            progressDetails: this.ports.context.getExecutionTraceTimelineDetail(),
            onError: error => this.ports.reportError('[CANVAS][generation-history]', error),
            mountEditor: request =>
                this.ports.editors.mountHistory({
                    ...request,
                    contextPreview: this.ports.context.getAiUserMessagePreviewRenderer({ inlinePopover: true }),
                    promptReferencePreviewRenderer: this.ports.context.getPromptReferencePreviewRenderer({ inlinePopover: true }),
                }),
        }
    }

    private renderContent(
        body: HTMLElement,
        node: GeneratedOutputCanvasNode | BranchMarkerNode,
    ): WorkspaceOutputDetails {
        this.activeDetails = new WorkspaceOutputDetails(
            body,
            node,
            {
                assets: this.ports.createAssetViewPorts(),
                getDescriptor: candidate => this.ports.host.assets.read(candidate.assetId)?.descriptor as MediaDescriptor | undefined,
                getArtifactDefinition: typeId => this.ports.host.capabilities.frontend.require(typeId),
                getArtifactDocument: assetId => this.ports.host.assets.readDocument(assetId, 'capabilityArtifact')?.doc,
                getBranchMediaTarget: marker => this.ports.history.getBranchMarkerMediaProjectionTarget(marker),
                getMediaBranchTarget: candidate => this.ports.history.getMediaNodeBranchMarkerProjectionTarget(candidate),
                getProgress: this.getTraceState,
                progressDetails: this.ports.context.getExecutionTraceTimelineDetail(),
                now: this.ports.now,
                mountMediaHistory: ({
                    host,
                    target,
                    onProgress,
                    signal,
                }) => this.mountMediaHistory(
                    host,
                    target,
                    onProgress,
                    signal,
                ),
                mountBranchHistory: ({
                    host,
                    target,
                    signal,
                }) => this.mountBranchHistory(
                    host,
                    target,
                    signal,
                ),
                mountArtifactHistory: ({
                    host,
                    node: artifact,
                    signal,
                }) => this.mountArtifactHistory(
                    host,
                    artifact,
                    signal,
                ),
            },
        )

        return this.activeDetails
    }

    private mountMediaHistory(
        host: HTMLElement,
        target: GeneratedMediaProjectionTarget,
        onProgress: (progress: MediaGenerationProgressInstance) => void,
        signal: AbortSignal,
    ): WorkspaceHistoryView | null {
        return mountWorkspaceMediaHistory(
            {
                host,
                node: target.node,
                lineageProjectionScope: target.lineageProjectionScope,
                limitToSelectedMedia: target.limitProjectionToSelectedMedia,
                onProgress,
                signal,
            },
            this.getGenerationHistoryPorts(),
        )
    }

    private mountBranchHistory(
        host: HTMLElement,
        target: BranchMarkerProjectionTarget,
        signal: AbortSignal,
    ): WorkspaceHistoryView | null {
        const projection = this.ports.history.buildBranchMarkerTurnProjectionContent(target.marker, target.lineageProjectionScope)

        return projection
            ? new WorkspaceGenerationHistory(
                {
                    host,
                    projection,
                    signal,
                },
                this.getGenerationHistoryPorts(),
            )
            : null
    }

    private mountArtifactHistory(
        host: HTMLElement,
        node: CapabilityArtifactCanvasNode,
        signal: AbortSignal,
    ): WorkspaceHistoryView | null {
        const projection = this.ports.history.buildCapabilityArtifactTurnProjectionContent(node) as {
            threadId: string
            content: ProseMirrorJsonNode
            lineageProjectionScope: AiLineageProjectionScope
        } | null

        return projection
            ? new WorkspaceGenerationHistory(
                {
                    host,
                    projection,
                    signal,
                },
                this.getGenerationHistoryPorts(),
            )
            : null
    }
}
