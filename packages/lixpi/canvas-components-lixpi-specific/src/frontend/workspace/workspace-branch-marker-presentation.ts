import {
    createCanvasPromptReferenceRenderer,
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    BranchMarkerActions,
    BranchMarkerContent,
    BranchMediaModelCircleStyles,
    type WorkspaceNodeShells,
} from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import {
    getBranchMarkerReasoningResponseText,
    getBranchMarkerThreadId,
    getMediaGenerationReferenceResolutionForMarker,
    type BranchMarkerUiPhase,
    type BranchMarkerNode,
    type BranchMarkerPromptPart,
    type GeneratedOutputCanvasNode,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type CanvasNode,
    type CanvasState,
} from '@lixpi/constants'
import {
    type BranchMarkerConversationPreview,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type GeneratedOutputRegenerationRequest,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspaceBranchMarkerModels,
} from './workspace-branch-marker-models.ts'

export type WorkspaceBranchMarkerPresentationPorts = {
    document: Document
    shells: WorkspaceNodeShells
    modelCircleSettings: WorkspaceCanvasHost['settings']['mediaBranchLineage']['mediaModelCircle']
    tooltipHideDelayMs: number
    models: WorkspaceBranchMarkerModels
    getState: () => CanvasState | null
    findElement: (node: BranchMarkerNode) => HTMLElement | null
    getUiPhase: (node: BranchMarkerNode) => BranchMarkerUiPhase | undefined
    hasStartedMedia: (nodeId: string) => boolean
    isPending: (node: BranchMarkerNode) => boolean
    isGenerationGroupActive: (node: BranchMarkerNode) => boolean
    getOutputs: (node: BranchMarkerNode) => GeneratedOutputCanvasNode[]
    isAccepted: (node: GeneratedOutputCanvasNode) => boolean
    isReviewReady: (node: GeneratedOutputCanvasNode) => boolean
    stop: (node: BranchMarkerNode) => Promise<void>
    accept: (nodeId: string) => Promise<unknown>
    regenerate: (request: GeneratedOutputRegenerationRequest) => Promise<unknown>
    getZoomScale: () => number
    getConversationPreview: (node: BranchMarkerNode) => BranchMarkerConversationPreview | null
    getPromptParts: (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null,
    ) => BranchMarkerPromptPart[]
    getPromptPreviewRenderer: () => PromptReferencePreviewRenderer
    showResponseLine: (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null,
    ) => boolean
    createProgress: (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null,
        responseText: string,
    ) => HTMLElement | null
    destroyProgress: (nodeId: string) => void
    createReferenceResolution: (operation: NonNullable<ReturnType<typeof getMediaGenerationReferenceResolutionForMarker>>) => {
        element: HTMLElement
        destroy: () => void
    } | null
    openDetails: (nodeId: string) => void
    log: (
        event: string,
        detail: unknown,
    ) => void
}

export class WorkspaceBranchMarkerPresentation {
    private readonly actions = new Map<string, BranchMarkerActions>()
    private readonly contents = new Map<string, Lifetime>()
    private readonly circleStyles: BranchMediaModelCircleStyles

    constructor(private readonly ports: WorkspaceBranchMarkerPresentationPorts) {
        this.circleStyles = new BranchMediaModelCircleStyles(ports.modelCircleSettings)
    }

    create = (node: BranchMarkerNode): HTMLElement => {
        const {
            nodeEl,
            dragOverlay,
            own,
        } = this.ports.shells.createBranchMarker(node, () => this.handleInfoClick(node.nodeId))
        own(() => this.destroyNode(node.nodeId))
        dragOverlay.before(
            this.createContent(node),
        )
        this.syncActions(node, nodeEl)

        return nodeEl
    }

    sync = (
        node: BranchMarkerNode,
        element?: HTMLElement,
    ): void => {
        const nodeElement = element ?? this.ports.findElement(node)

        if (!nodeElement)
            return

        const dragOverlay = nodeElement.querySelector('.branch-origin-drag-overlay, .branch-fork-drag-overlay, .branch-line-drag-overlay')
        const content = this.createContent(node)

        if (dragOverlay)
            dragOverlay.before(content)
        else
            nodeElement.append(content)

        this.syncActions(node, nodeElement)
    }

    syncAll = (): void => {
        for (const node of this.ports.getState()?.nodes ?? []) {
            if (this.isMarker(node))
                this.sync(node)
        }
    }

    updateZoom(zoomScale: number): void {
        for (const controls of this.actions.values())
            controls.setZoomScale(zoomScale)
    }

    destroyNode(nodeId: string): void {
        const cleanup = new Lifetime()
        const content = this.contents.get(nodeId)
        const actions = this.actions.get(nodeId)
        this.contents.delete(nodeId)
        this.actions.delete(nodeId)
        cleanup.own(() => content?.destroy())
        cleanup.own(() => actions?.destroy())
        cleanup.destroy()
    }

    clear(): void {
        const cleanup = new Lifetime()

        for (const nodeId of new Set([
            ...this.contents.keys(),
            ...this.actions.keys(),
        ])) {
            cleanup.own(() => this.destroyNode(nodeId))
        }

        cleanup.destroy()
    }

    destroy(): void {
        this.clear()
        this.circleStyles.clear()
    }

    private createContent(node: BranchMarkerNode): HTMLDivElement {
        this.destroyNode(node.nodeId)
        const lifetime = new Lifetime()
        this.contents.set(node.nodeId, lifetime)
        const preview = this.ports.getConversationPreview(node)
        const responseText = getBranchMarkerReasoningResponseText(node, preview)
        const progress = this.ports.createProgress(
            node,
            preview,
            responseText,
        )
        const state = this.ports.getState()
        const resolution = state
            ? getMediaGenerationReferenceResolutionForMarker(state.nodes, node)
            : undefined
        const content = new BranchMarkerContent({
            document: this.ports.document,
            label: this.getTypeLabel(node),
            headerHeight: node.dimensions.height,
            promptParts: this.ports.getPromptParts(node, preview),
            renderReference: createCanvasPromptReferenceRenderer({
                document: this.ports.document,
                previewRenderer: this.ports.getPromptPreviewRenderer(),
                inlinePopover: true,
            }),
            reasoningModel: this.ports.models.getReasoningModel(node),
            mediaModels: this.ports.models.getTooltipEntries(node).map(
                ({
                    label,
                    entry,
                }) => ({
                    ...entry,
                    label,
                    glassImage: this.circleStyles.getGlassImage(entry.color),
                    textureImage: this.circleStyles.getTextureImage(entry.color),
                }),
            ),
            modelSummary: this.ports.models.getSummary(node),
            responseText,
            responsePhase: preview?.phase ?? 'preamble',
            responseIsReceiving: Boolean(preview?.isReceiving),
            showResponseLine: this.ports.showResponseLine(node, preview),
            pending: this.ports.isPending(node),
            active: this.ports.isGenerationGroupActive(node),
            tooltipHideDelayMs: this.ports.tooltipHideDelayMs,
            progress: progress ? {
                element: progress,
                destroy: () => this.ports.destroyProgress(node.nodeId),
            } : null,
            referenceResolution: resolution ? this.ports.createReferenceResolution(resolution) : null,
        })
        lifetime.own(() => content.destroy())

        return content.element
    }

    private syncActions(
        node: BranchMarkerNode,
        element: HTMLElement,
    ): void {
        this.actions.get(node.nodeId)?.destroy()
        const outputs = this.ports.getOutputs(node).filter(output => !this.ports.isAccepted(output))
        const controls = new BranchMarkerActions({
            document: element.ownerDocument,
            key: [node.nodeId, node.generationRequestId, getBranchMarkerThreadId(node)].join(':'),
            active: this.ports.isGenerationGroupActive(node),
            hasReviewOutputs: outputs.length > 0,
            canAcceptAll: outputs.every(this.ports.isReviewReady),
            onStop: () => void this.ports.stop(node),
            onAcceptAll: () => void this.ports.accept(node.nodeId),
            onRegenerate: mode => void this.ports.regenerate({
                scope: 'branch-lineage',
                mode,
                targetNodeId: node.nodeId,
                outputNodes: outputs,
            }),
        })
        this.actions.set(node.nodeId, controls)
        controls.setZoomScale(
            this.ports.getZoomScale(),
        )

        if (controls.stopControl)
            element.appendChild(controls.stopControl)

        if (controls.reviewControls) {
            const content = element.querySelector<HTMLElement>(':scope > .workspace-branch-marker-content')
            const host = content ?? element
            host.appendChild(controls.reviewControls)
        }
    }

    private handleInfoClick(nodeId: string): void {
        const node = this.ports.getState()?.nodes.find(candidate => candidate.nodeId === nodeId)

        if (
            !node
            || !this.isMarker(node)
        ) {
            this.ports.log('info-click-missing-node', { nodeId })

            return
        }

        this.ports.log(
            'info-click',
            {
                nodeId: node.nodeId,
                markerType: node.type,
                threadId: getBranchMarkerThreadId(node),
                generationRequestId: node.generationRequestId,
                pendingPhase: node.pendingState?.phase ?? '',
                uiPhase: this.ports.getUiPhase(node) ?? '',
                hasStartedMedia: this.ports.hasStartedMedia(node.nodeId),
                pendingForUi: this.ports.isPending(node),
            },
        )
        this.ports.openDetails(node.nodeId)
    }

    private getTypeLabel(node: BranchMarkerNode): string {
        if (this.ports.getUiPhase(node) === 'preflight')
            return 'Preparing branch'

        if (node.type === 'branchOrigin')
            return 'Start branch'

        if (node.type === 'branchFork')
            return 'Fork branch'

        return 'Continue branch'
    }

    private isMarker(node: CanvasNode): node is BranchMarkerNode {
        return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }
}
