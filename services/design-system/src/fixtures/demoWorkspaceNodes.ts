// Workspace node content composed the way the Lixpi workspace composes it:
// WorkspaceNodeShells places each node, OperationStatusNode fills status
// cards, and branch markers combine BranchMarkerContent with
// BranchMarkerActions. The demo host answers the action ports with toasts.

import {
    type BranchLineCanvasNode,
    type CanvasNode,
    type OperationStatusCanvasNode,
} from '@lixpi/constants'
import {
    type CanvasEngineRect,
} from '@lixpi/canvas-engine/shared'
import {
    BranchMarkerActions,
    BranchMarkerContent,
    BranchMediaModelCircleStyles,
    OperationStatusNode,
    WorkspaceNodeShells,
    type BranchMarkerContentOptions,
    type WorkspaceNodeShellsOptions,
} from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import { createCanvasPromptReferenceRenderer } from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    type WorkspaceCanvasAppearance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

import { announce } from '$src/views/showcase/showcasePage.ts'

export type DemoBranchMarkerModel = {
    color: string
    icon: string
    label: string
    title: string
}

export type DemoBranchMarkerState = Pick<BranchMarkerContentOptions, 'pending' | 'promptParts' | 'responsePhase' | 'responseText' | 'showResponseLine'> & {
    active: boolean
    canAcceptAll: boolean
    hasReviewOutputs: boolean
    mediaModels: readonly DemoBranchMarkerModel[]
    progress?: HTMLElement
    reasoningModel: {
        icon: string
        title: string
    } | null
    receiving: boolean
}

export type DemoWorkspaceNodesOptions = Partial<Omit<WorkspaceNodeShellsOptions, 'document' | 'getBounds'>> & {
    appearance: WorkspaceCanvasAppearance
    getBounds?: (node: CanvasNode) => CanvasEngineRect
}

const localBounds = (node: CanvasNode): CanvasEngineRect => ({
    ...node.position,
    ...node.dimensions,
})

export class DemoWorkspaceNodes {
    readonly shells: WorkspaceNodeShells

    private readonly lifetime = new Lifetime()
    private readonly circles: BranchMediaModelCircleStyles

    constructor(private readonly options: DemoWorkspaceNodesOptions) {
        const {
            appearance,
            getBounds,
            ...ports
        } = options
        const resize = appearance.mediaNode.resizeHandle
        this.circles = new BranchMediaModelCircleStyles(appearance.mediaBranchLineage.mediaModelCircle)
        this.lifetime.own(() => this.circles.clear())
        this.shells = new WorkspaceNodeShells({
            consumeSuppressedClick: () => false,
            document,
            getBounds: getBounds ?? localBounds,
            getLayer: () => 1,
            getResizeSettings: () => ({
                ...resize,
                useZoomCompensatedScaling: appearance.mediaNode.useZoomCompensatedResizeHandleScaling,
            }),
            getZoom: () => 1,
            onCreate: () => {},
            select: nodeId => announce(`Selected ${nodeId}`),
            startDrag: () => {},
            startResize: () => {},
            toggleSelection: nodeId => announce(`Toggled ${nodeId}`),
            togglePlayback: () => {},
            ...ports,
        })
        this.lifetime.own(() => this.shells.destroy())
    }

    createOperationStatus(node: OperationStatusCanvasNode): HTMLElement {
        return new OperationStatusNode(
            node,
            this.shells,
            {
                cancel: async () => announce(`Cancel ${node.title}`),
                dismissUpload: () => announce(`Dismiss ${node.title}`),
                edit: async () => announce(`Edit ${node.title}`),
                verify: async () => announce(`Verify ${node.title}`),
            },
        ).element
    }

    createBranchMarker(
        node: BranchLineCanvasNode,
        state: DemoBranchMarkerState,
    ): HTMLElement {
        const {
            nodeEl,
            dragOverlay,
            own,
        } = this.shells.createBranchMarker(node, () => announce(`Open details for ${node.nodeId}`))
        const content = new BranchMarkerContent({
            active: state.active,
            document,
            headerHeight: node.dimensions.height,
            label: 'Branch',
            mediaModels: state.mediaModels.map(
                model => ({
                    glassImage: this.circles.getGlassImage(model.color),
                    icon: model.icon,
                    label: model.label,
                    textureImage: this.circles.getTextureImage(model.color),
                    title: model.title,
                }),
            ),
            modelSummary: state.mediaModels.map(model => `${model.label}: ${model.title}`).join(', '),
            pending: state.pending,
            progress: state.progress
                ? {
                    destroy: () => state.progress?.remove(),
                    element: state.progress,
                }
                : null,
            promptParts: state.promptParts,
            reasoningModel: state.reasoningModel,
            renderReference: createCanvasPromptReferenceRenderer({
                document,
                inlinePopover: true,
            }),
            responseIsReceiving: state.receiving,
            responsePhase: state.responsePhase,
            responseText: state.responseText,
            showResponseLine: state.showResponseLine,
            tooltipHideDelayMs: this.options.appearance.helpTooltip.interactiveHideDelayMs,
        })
        own(() => content.destroy())
        dragOverlay.before(content.element)
        const actions = new BranchMarkerActions({
            active: state.active,
            canAcceptAll: state.canAcceptAll,
            document,
            hasReviewOutputs: state.hasReviewOutputs,
            key: node.nodeId,
            onAcceptAll: () => announce('Accept all outputs'),
            onRegenerate: mode => announce(`Regenerate: ${mode}`),
            onStop: () => announce('Stop generation'),
        })
        own(() => actions.destroy())

        if (actions.stopControl)
            nodeEl.appendChild(actions.stopControl)

        if (actions.reviewControls)
            (nodeEl.querySelector<HTMLElement>(':scope > .workspace-branch-marker-content') ?? nodeEl).appendChild(actions.reviewControls)

        return nodeEl
    }

    remove(nodeId: string): void {
        this.shells.remove(nodeId)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
