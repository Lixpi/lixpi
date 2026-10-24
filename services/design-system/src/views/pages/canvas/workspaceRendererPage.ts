// The Lixpi workspace renderer: the canvas chrome, the product media layer
// with its node registry, connectors, generating outlines and glass, the
// workspace node shells, the canvas bubble menu and the video chrome. The demo
// host owns the canvas state and answers the interaction ports the way
// LixpiWorkspaceCanvas does, without an API, editors or persistence.

import {
    type BranchLineCanvasNode,
    type CanvasNode,
    type CanvasState,
    type VideoCanvasNode,
    type WorkspaceEdgePathType,
} from '@lixpi/constants'
import {
    computeWorldPosition,
    buildNodesById,
    type CanvasEngineRect,
    type CanvasViewport,
} from '@lixpi/canvas-engine/shared'
import {
    createWorkspaceMediaLayer,
    WorkspaceVideoChrome,
    type GeneratingMediaOutlineTargets,
    type WorkspaceMediaLayer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/media'
import {
    WorkspaceDomNodes,
    type WorkspaceResizeCorner,
} from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import { WorkspaceCanvasMenu } from '@lixpi/canvas-components-lixpi-specific/frontend/menus'
import {
    type ViewportController,
} from '@lixpi/canvas-engine/frontend/viewport'
import {
    WorkspaceCanvasChrome,
    applyWorkspaceCanvasTheme,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    arrowRightIcon,
    geminiIcon,
} from '@lixpi/ui-kit/svg'
import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'
import { createGentelellaButton } from '@lixpi/ui-kit-gentelella/components/button'
import { html } from '@lixpi/ui-primitives/dom'
import {
    type WebClientView,
} from '@lixpi/web-client-service-factory'

import {
    DEMO_WORKSPACE_ID,
    DemoAssets,
} from '$src/fixtures/demoAssets.ts'
import { settleRecordedVideoDuration } from '$src/fixtures/demoMedia.ts'
import {
    DemoWorkspaceNodes,
    type DemoBranchMarkerState,
} from '$src/fixtures/demoWorkspaceNodes.ts'
import {
    createWorkspaceAppearance,
    createWorkspaceChromeSettings,
} from '$src/fixtures/workspaceAppearance.ts'
import {
    ShowcasePage,
    announce,
    createShowcaseRow,
    createShowcaseSpecimen,
} from '$src/views/showcase/showcasePage.ts'
import '$src/views/pages/canvas/canvas-pages.scss'

const PATH_TYPES: WorkspaceEdgePathType[] = ['bezier', 'straight', 'smoothstep', 'horizontal-bezier', 'orthogonal']

const media = (
    nodeId: string,
    type: 'audio' | 'image' | 'mediaDocument' | 'video',
    assetId: string,
    bounds: CanvasEngineRect,
): CanvasNode => ({
    assetId,
    dimensions: {
        height: bounds.height,
        width: bounds.width,
    },
    nodeId,
    position: {
        x: bounds.x,
        y: bounds.y,
    },
    type,
})

const MARKER: BranchLineCanvasNode = {
    branchId: 'branch',
    dimensions: {
        height: 42,
        width: 300,
    },
    generationRequestId: 'request',
    nodeId: 'marker',
    position: {
        x: 60,
        y: 40,
    },
    temporary: true,
    type: 'branchLine',
}

const MARKER_STATE: DemoBranchMarkerState = {
    active: false,
    canAcceptAll: true,
    hasReviewOutputs: true,
    mediaModels: [{
        color: '#4285F4',
        icon: geminiIcon,
        label: 'Image',
        title: 'Nano Banana Pro',
    }],
    pending: false,
    promptParts: [{
        text: 'Two variants of the dawn study',
        type: 'text',
    }],
    reasoningModel: null,
    receiving: false,
    responsePhase: 'final',
    responseText: '',
    showResponseLine: false,
}

const initialState = (): CanvasState => ({
    edges: [
        {
            edgeId: 'marker-dawn',
            sourceNodeId: 'marker',
            targetNodeId: 'dawn',
        },
        {
            edgeId: 'marker-sage',
            sourceNodeId: 'marker',
            targetNodeId: 'sage',
        },
        {
            edgeId: 'dawn-clip',
            pathType: 'smoothstep',
            sourceNodeId: 'dawn',
            targetNodeId: 'clip',
        },
    ],
    nodes: [
        MARKER,
        media(
            'dawn',
            'image',
            'image-dawn',
            {
                height: 200,
                width: 300,
                x: 420,
                y: 20,
            },
        ),
        media(
            'sage',
            'image',
            'image-sage',
            {
                height: 200,
                width: 200,
                x: 420,
                y: 280,
            },
        ),
        media(
            'clip',
            'video',
            'video-violet',
            {
                height: 220,
                width: 392,
                x: 820,
                y: 40,
            },
        ),
        media(
            'tone',
            'audio',
            'audio-tone',
            {
                height: 80,
                width: 300,
                x: 820,
                y: 360,
            },
        ),
        media(
            'brief',
            'mediaDocument',
            'document-brief',
            {
                height: 260,
                width: 200,
                x: 60,
                y: 160,
            },
        ),
        {
            createdAt: 1,
            dimensions: {
                height: 104,
                width: 320,
            },
            generationRequestId: 'request',
            message: 'The provider rejected the prompt.',
            nodeId: 'failed',
            operation: 'media-generation',
            position: {
                x: 1260,
                y: 60,
            },
            status: 'failed',
            title: 'Variant 3',
            type: 'operationStatus',
            updatedAt: 1,
        },
    ],
    viewport: {
        x: 20,
        y: 40,
        zoom: 0.62,
    },
})

class WorkspaceRendererDemo {
    readonly element: HTMLElement

    private readonly appearance = createWorkspaceAppearance()
    private readonly chrome: WorkspaceCanvasChrome
    private readonly nodes: DemoWorkspaceNodes
    private readonly dom: WorkspaceDomNodes
    private layer: WorkspaceMediaLayer | null = null
    private menu: WorkspaceCanvasMenu | null = null
    private videoChrome: WorkspaceVideoChrome | null = null
    private viewportInput: ViewportController | null = null
    private state = initialState()
    private viewport: CanvasViewport = this.state.viewport
    private selected = new Set<string>()
    private destroyed = false

    constructor(private readonly assets: DemoAssets) {
        this.chrome = new WorkspaceCanvasChrome(
            createWorkspaceChromeSettings(this.appearance),
            {
                createDocument: async () => announce('New document'),
                document,
                importUrl: async url => announce(`Import ${url}`),
                reportError: error => console.error('Canvas chrome failed', error),
                uploadFile: async file => announce(`Upload ${file.name}`),
            },
        )
        this.element = html`<div className="design-system-workspace-stage">${this.chrome.element}</div>` as HTMLElement
        applyWorkspaceCanvasTheme(this.chrome.pane, this.appearance)
        this.nodes = new DemoWorkspaceNodes({
            appearance: this.appearance,
            getBounds: node => this.worldBounds(node),
            getZoom: () => this.viewport.zoom,
            select: nodeId => this.select(nodeId),
            startDrag: (event, nodeId) => this.startDrag(event, nodeId),
            startResize: (
                event,
                nodeId,
                corner,
            ) => this.startResize(
                event,
                nodeId,
                corner,
            ),
            toggleSelection: nodeId => this.select(nodeId, true),
            togglePlayback: nodeId => void this.layer?.playback.toggle(nodeId),
        })
        this.dom = new WorkspaceDomNodes({
            branch: node => this.nodes.createBranchMarker(node as BranchLineCanvasNode, MARKER_STATE),
            capability: node => this.nodes.shells.create(node).nodeEl,
            document: node => this.nodes.shells.create(node).nodeEl,
            operation: node => this.nodes.createOperationStatus(node),
            shells: this.nodes.shells,
            updateBranch: () => {},
        })
    }

    async mount(): Promise<void> {
        const marker = extractSvgPathIcon(arrowRightIcon)
        const layer = createWorkspaceMediaLayer({
            getWorkspaceId: () => DEMO_WORKSPACE_ID,
            marker: {
                paths: marker.pathData,
                reference: {
                    x: 48,
                    y: 128,
                },
                width: marker.width,
            },
            nodes: {
                geometry: type => ({
                    measure: node => {
                        const bounds = {
                            ...node.position,
                            ...node.dimensions,
                        }

                        return {
                            collisionBounds: bounds,
                            connectorBounds: bounds,
                            hitBounds: bounds,
                            selectionBounds: bounds,
                            visualBounds: bounds,
                        }
                    },
                    movable: true,
                    resize: {
                        min: {
                            height: type === 'image' ? 1 : 150,
                            width: type === 'image' ? 50 : 200,
                        },
                        preserveAspectRatio: type === 'image',
                    },
                }),
                mountDom: node => this.dom.mount(node),
                visible: state => state.nodes,
            },
            paneEl: this.chrome.pane,
            selectionColors: {
                groupOverlayFill: this.appearance.selection.styles.overlayBackgroundColor,
                groupOverlayStroke: this.appearance.selection.styles.overlayBorderColor,
                marqueeFill: this.appearance.selection.styles.marqueeBackgroundColor,
                marqueeStroke: this.appearance.selection.styles.marqueeBorderColor,
            },
            settings: this.appearance,
            sources: this.assets.sources,
            viewportEl: this.chrome.viewportMount,
            onEdgeSelectionChange: edgeId => {
                if (edgeId)
                    this.menu?.showEdge(edgeId)
                else
                    this.menu?.hide()
            },
            onEdgesChange: edges => this.commit({
                ...this.state,
                edges,
            }),
            onError: error => console.error('Workspace media layer failed', error),
            onHealthChange: health => announce(`Renderer ${health}`),
            onPlaybackReady: nodeId => this.syncVideoChrome(nodeId),
        })
        this.layer = layer
        layer.setGlassTargets(this.chrome.glassTargets)
        this.viewportInput = layer.canvas.installViewport({
            maxZoom: 2,
            minZoom: 0.2,
            onTransformChange: ([x, y, zoom]) => this.setViewport({
                x,
                y,
                zoom,
            }),
        })
        this.menu = new WorkspaceCanvasMenu({
            actions: {
                onChangeConnectorCurve: edgeId => this.commit({
                    ...this.state,
                    edges: this.state.edges.map(
                        edge => edge.edgeId === edgeId
                            ? {
                                ...edge,
                                pathType: PATH_TYPES[(PATH_TYPES.indexOf(edge.pathType ?? 'bezier') + 1) % PATH_TYPES.length],
                            }
                            : edge,
                    ),
                }),
                onDeleteEdge: edgeId => this.commit({
                    ...this.state,
                    edges: this.state.edges.filter(edge => edge.edgeId !== edgeId),
                }),
                onDeleteNode: nodeId => this.remove(nodeId),
                onDownloadMedia: nodeId => announce(`Download ${nodeId}`),
                onOpenAsset: nodeId => announce(`Open the Asset for ${nodeId}`),
                onReplaceMedia: nodeId => announce(`Replace media in ${nodeId}`),
                onTriggerConnection: nodeId => layer.connections.startConnectionFromMenu(nodeId),
            },
            getEdgeRect: edgeId => layer.connections.getEdgeMidpointRect(edgeId),
            getNode: nodeId => this.state.nodes.find(node => node.nodeId === nodeId),
            getVisualScale: () => this.viewport.zoom,
            pane: this.chrome.pane,
            viewport: this.chrome.viewportMount,
        })
        this.videoChrome = new WorkspaceVideoChrome({
            document,
            getBounds: node => this.worldBounds(node),
            getResizeSettings: () => ({
                ...this.appearance.mediaNode.resizeHandle,
                useZoomCompensatedScaling: this.appearance.mediaNode.useZoomCompensatedResizeHandleScaling,
            }),
            getVideo: nodeId => layer.playback.getVideoElement(nodeId),
            getViewport: () => this.viewport,
            settings: this.appearance.videoControls,
            startDrag: (event, nodeId) => this.startDrag(event, nodeId),
            startResize: (
                event,
                nodeId,
                corner,
            ) => this.startResize(
                event,
                nodeId,
                corner,
            ),
            togglePlayback: nodeId => void layer.playback.toggle(nodeId),
        })
        this.chrome.pane.append(this.videoChrome.element)
        await this.assets.ready

        if (this.destroyed)
            return

        this.zoomTo(this.viewport)
        layer.sync(this.state)
    }

    setGenerating(targets: GeneratingMediaOutlineTargets): void {
        this.layer?.setGeneratingImageNodes(targets)
    }

    // Programmatic changes also move the viewport input, so the next pan or
    // zoom continues from the new transform instead of the previous one.
    zoomTo(viewport: CanvasViewport): void {
        this.viewportInput?.syncViewport(viewport)
        this.setViewport(viewport)
    }

    private setViewport(viewport: CanvasViewport): void {
        this.viewport = viewport
        this.layer?.setViewport(viewport)
        this.chrome.setZoom(viewport.zoom)
        this.nodes.shells.setZoom(viewport.zoom)
        this.syncVideoChrome()
        this.menu?.repositionNode(this.selected.size === 1 ? [...this.selected][0] : null)
    }

    private worldBounds(node: CanvasNode): CanvasEngineRect {
        return {
            ...computeWorldPosition(
                node,
                buildNodesById(this.state.nodes),
            ),
            ...node.dimensions,
        }
    }

    private commit(state: CanvasState): void {
        this.state = state
        this.layer?.sync(state)
        this.syncVideoChrome()
    }

    private select(
        nodeId: string,
        toggle = false,
    ): void {
        if (toggle) {
            if (this.selected.has(nodeId))
                this.selected.delete(nodeId)
            else
                this.selected.add(nodeId)
        } else
            this.selected = new Set([nodeId])

        this.layer?.setSelectedImageNodes(this.selected)

        if (this.selected.size === 1)
            this.menu?.showNode([...this.selected][0])
        else
            this.menu?.hide()
    }

    private remove(nodeId: string): void {
        this.selected.delete(nodeId)
        this.menu?.hide(true)
        this.commit({
            ...this.state,
            edges: this.state.edges.filter(edge => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
            nodes: this.state.nodes.filter(node => node.nodeId !== nodeId),
        })
    }

    private applyBounds(bounds: ReadonlyMap<string, CanvasEngineRect>): void {
        this.commit({
            ...this.state,
            nodes: this.state.nodes.map(node => {
                const next = bounds.get(node.nodeId)

                return next
                    ? {
                        ...node,
                        dimensions: {
                            height: next.height,
                            width: next.width,
                        },
                        position: {
                            x: next.x,
                            y: next.y,
                        },
                    } as CanvasNode
                    : node
            }),
        })
    }

    private live(bounds: ReadonlyMap<string, CanvasEngineRect>): void {
        for (const [nodeId, rect] of bounds) {
            this.layer?.setNodeLiveTransform(
                nodeId,
                {
                    x: rect.x,
                    y: rect.y,
                },
                {
                    height: rect.height,
                    width: rect.width,
                },
            )
            this.videoChrome?.update(
                nodeId,
                rect,
                this.viewport,
            )
        }

        this.menu?.repositionNode(this.selected.size === 1 ? [...this.selected][0] : null)
    }

    private startDrag(
        event: MouseEvent,
        nodeId: string,
    ): void {
        const layer = this.layer
        const node = this.state.nodes.find(candidate => candidate.nodeId === nodeId)

        if (
            !layer
            || !node
        )
            return

        const ids = this.selected.has(nodeId) ? [...this.selected] : [nodeId]
        layer.canvas.startNodeDrag({
            event,
            targets: ids.flatMap(id => {
                const target = this.state.nodes.find(candidate => candidate.nodeId === id)

                return target
                    ? [{
                        bounds: this.worldBounds(target),
                        nodeId: id,
                    }]
                    : []
            }),
            onCancel: () => this.layer?.sync(this.state),
            onChange: bounds => this.live(bounds),
            onEnd: (
                _event,
                bounds,
                moved,
            ) => {
                if (moved)
                    this.applyBounds(bounds)
                else if (node.type !== 'branchLine')
                    this.select(nodeId)
            },
        })
    }

    private startResize(
        event: MouseEvent,
        nodeId: string,
        corner: WorkspaceResizeCorner,
    ): void {
        const node = this.state.nodes.find(candidate => candidate.nodeId === nodeId)

        if (
            !this.layer
            || !node
        )
            return

        this.layer.canvas.startNodeResize({
            constraints: {
                min: {
                    height: node.type === 'image' ? 40 : 80,
                    width: 80,
                },
                preserveAspectRatio: node.type === 'image',
            },
            event,
            handle: corner,
            target: {
                bounds: this.worldBounds(node),
                nodeId,
            },
            onCancel: () => this.layer?.sync(this.state),
            onChange: bounds => this.live(bounds),
            onEnd: (
                _event,
                bounds,
                moved,
            ) => {
                if (moved)
                    this.applyBounds(bounds)
            },
        })
    }

    private syncVideoChrome(_nodeId?: string): void {
        const videos = this.state.nodes.filter((node): node is VideoCanvasNode => node.type === 'video')

        for (const video of videos) {
            const element = this.layer?.playback.getVideoElement(video.nodeId)

            if (element)
                settleRecordedVideoDuration(element)
        }

        this.videoChrome?.sync(videos)
    }

    reset(): void {
        this.selected.clear()
        this.menu?.hide(true)
        this.commit(
            initialState(),
        )
        this.zoomTo(initialState().viewport)
    }

    destroy(): void {
        this.destroyed = true
        this.menu?.destroy()
        this.videoChrome?.destroy()
        this.layer?.destroy()
        this.nodes.destroy()
        this.chrome.destroy()
        this.element.remove()
    }
}

export const createWorkspaceRendererPage = (): WebClientView => {
    const page = new ShowcasePage({
        packageName: '@lixpi/canvas-components-lixpi-specific',
        title: 'Workspace renderer',
        description: 'The product renderer with demo Assets: image, video, audio and document nodes, a branch marker, a failed generation card and their connectors. Pan and zoom the background, drag or resize nodes, select a node or connector for its bubble menu, and use the toolbar buttons on the left.',
    })
    const assets = page.own(
        new DemoAssets(),
    )
    const renderer = page.own(
        new WorkspaceRendererDemo(assets),
    )
    page.onMount(() => void renderer.mount())
    const button = (
        label: string,
        onClick: () => void,
    ): HTMLElement =>
        page.own(
            createGentelellaButton({
                label,
                size: 'small',
                variant: 'outline',
                onClick,
            }),
        ).el

    page.addSection({
        title: 'Canvas',
        content: createShowcaseSpecimen({
            content: [
                createShowcaseRow([
                    button(
                        'Generating outlines',
                        () => renderer.setGenerating(
                            new Map([
                                ['dawn', 'clockwise'],
                                ['sage', 'counterclockwise'],
                                ['clip', { shape: 'node' }],
                            ]),
                        ),
                    ),
                    button(
                        'Pre-frame circle',
                        () => renderer.setGenerating(
                            new Map([['sage', { shape: 'preFrameCircle' }]]),
                        ),
                    ),
                    button(
                        'Stop outlines',
                        () => renderer.setGenerating(
                            new Set(),
                        ),
                    ),
                    button(
                        'Zoom to 100%',
                        () => renderer.zoomTo({
                            x: 0,
                            y: 0,
                            zoom: 1,
                        }),
                    ),
                    button('Reset scene', () => renderer.reset()),
                ]),
                renderer.element,
            ],
            label: 'WorkspaceCanvasChrome + createWorkspaceMediaLayer + WorkspaceDomNodes + WorkspaceCanvasMenu + WorkspaceVideoChrome',
        }),
    })

    return page
}
