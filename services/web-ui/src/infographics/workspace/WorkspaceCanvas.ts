import {
    XYPanZoom,
    infiniteExtent,
    PanOnScrollMode,
    type PanZoomInstance,
    type Viewport,
    type Transform,
    type Rect,
} from '@xyflow/system'
import { TextSelection } from 'prosemirror-state'
import { v4 as uuidv4 } from 'uuid'
import {
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type ImageCanvasNode,
    type AiChatThreadCanvasNode,
    type ContextRegionCanvasNode,
    type AiChatThread,
    type WorkspaceEdge,
    type CanvasAiChatSidebarTab,
    type CanvasFeatureExtractionState,
    type FeatureMeta,
    type ImageBranchCandidateSnapshot,
    type ImageBranchVlmResolution,
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import { setAiGeneratedImageCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/index.ts'
import { getAiProviderIcon } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'
import { getGeneratedImageTurnInfoFromThreadContent } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadContentUtils.ts'
import { createAiResponseMessageShell, createAiUserMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'
import { createImageGenerationTraceDetails } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon, aiChatThreadRailBoundaryCircle, brokenImageIcon, infoCircleIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasImageLifecycleTracker } from '$src/infographics/workspace/canvasImageLifecycle.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { getCanvasChromeZoomMultiplier, getResizeHandleScaledSizes } from '$src/infographics/utils/zoomScaling.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import {
    computeNextBranchRowPositionToRightOfRect,
    computeViewportCenterInsertionPosition,
} from '$src/infographics/workspace/imagePositioning.ts'
import { createNodeLayerManager } from '$src/infographics/workspace/nodeLayering.ts'
import { computeWorkspaceDragPlan } from '$src/infographics/workspace/workspaceDragPlan.ts'
import {
    canAdoptNodeIntoContextRegion,
} from '$src/infographics/workspace/workspaceImageNodePlan.ts'
import {
    createPendingCanvasVisualCommit,
    getCanvasVisualSyncKey,
    getNodeStructureKey,
    mergeIncomingCanvasStateWithPendingVisualCommit,
    updatePendingCanvasVisualCommitViewport,
    type PendingCanvasVisualCommit,
} from '$src/infographics/workspace/workspaceRenderStatePlan.ts'
import { shouldPreserveLiveViewportForViewportOnlyRender } from '$src/infographics/workspace/workspaceViewportStatePlan.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { createShiftingGradientBackground } from '$src/utils/animations/gradients/shiftingGradientRenderer.ts'
import { SvgGradientRenderer } from '$src/utils/animations/gradients/svgGradient.ts'
import { webUiSettings } from '$src/webUiSettings.ts'
import { webUiThemeSettings } from '$src/webUiThemeSettings.ts'
import { BubbleMenu, type BubbleMenuPositionRequest } from '$src/components/bubbleMenu/index.ts'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_EDGE_CONTEXT } from '$src/infographics/workspace/canvasBubbleMenuItems.ts'
import { downloadImage } from '$src/utils/downloadImage.ts'
import { AiPromptInputController } from '$src/services/ai-prompt-input-controller.ts'
import {
    buildImageBranchCandidateSnapshot,
    getGeneratedImageTextByNodeIdFromThreadContent,
    getPromptTextFromMessages,
} from '$src/services/ai-image-branching.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
import { createGenericAiModelDropdown, createGenericSubmitButton, createGenericImageSizeDropdown, createGenericImageModelDropdown } from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'
import { createPixiMediaLayer, type PixiMediaLayer, type SelectionColors } from '$src/infographics/workspace/pixiMediaLayer.ts'
import { createViewportBridge, type ViewportBridge } from '$src/infographics/workspace/rendering/viewportBridge.ts'
import { createPixiContextRegionLayer, type PixiContextRegionLayer } from '$src/infographics/workspace/rendering/pixiContextRegionLayer.ts'
import * as contextRegionCloudGeometry from '$src/infographics/workspace/rendering/contextRegionClouds.ts'
import {
    getContextRegionCloudBounds,
    scoreRectAgainstContextRegionCloud,
    type ContextRegionCloudDatum,
    type ContextRegionCloudResizeHandle,
} from '$src/infographics/workspace/rendering/contextRegionClouds.ts'
import { createFeatureLibraryPanel } from '$src/infographics/workspace/featureLibraryPanel.ts'
import { setPendingExtractionContext, getPendingExtractionContext, submitExtractionRequest, renderExtractionTabBody } from '$src/infographics/workspace/extractionTab.ts'

import { select } from 'd3-selection'

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type ResizeHandle = ResizeCorner | ContextRegionCloudResizeHandle
type CollisionBox = { id: string; x: number; y: number; width: number; height: number }
type CollisionEntry = { node: CanvasNode; offset: { x: number; y: number } }
type CollisionPlan = {
    nodeBoxes: CollisionBox[]
    entries: Map<string, CollisionEntry>
    shouldResolvePair: (a: CollisionBox, b: CollisionBox) => boolean
}

const RESIZE_CORNERS: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CONTEXT_REGION_IMAGE_CLASS = 'workspace-image-node--context-region-child'
const NODE_DRAG_START_THRESHOLD_PX = 6
type DocumentEditorEntry = {
    editor: any
    aiService: AiInteractionService | null
    containerEl: HTMLElement
}

type AiChatThreadEditorEntry = {
    editor: any
    aiService: AiInteractionService
    containerEl: HTMLElement
    gradientCleanup?: () => void
    triggerGradientAnimation?: () => void
}

type ContextRegionNode = ContextRegionCanvasNode | AiChatThreadCanvasNode

type MarqueeSelectionState = {
    start: { x: number; y: number }
    current: { x: number; y: number }
    moved: boolean
}

type DragStartOptions = {
    onClick?: () => void
    suppressPaneClick?: boolean
    allowSelection?: boolean
}

type WorkspaceCanvasCallbacks = {
    onViewportChange?: (viewport: Viewport) => void
    onCanvasStateChange?: (state: CanvasState) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; prevRevision?: number; content: any }) => void
    onDocumentTitleChange?: (params: { documentId: string; title: string }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
}

type WorkspaceCanvasNodeInsertion =
    | Omit<DocumentCanvasNode, 'position'>
    | Omit<ImageCanvasNode, 'position'>
    | Omit<AiChatThreadCanvasNode, 'position'>
    | Omit<ContextRegionCanvasNode, 'position'>

type WorkspaceCanvasInsertionStatePatch = Omit<Partial<CanvasState>, 'nodes' | 'edges' | 'viewport'>

type WorkspaceCanvasOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    workspaceId: string
    canvasState: CanvasState | null
    documents: Document[]
    aiChatThreads: AiChatThread[]
    panZoomConfig?: Partial<ReturnType<typeof defaultPanZoomConfig>>
} & WorkspaceCanvasCallbacks

function getResizeCursorForHandle(handlePosition: ResizeHandle): string {
    switch (handlePosition) {
        case 'top':
        case 'bottom':
            return 'ns-resize'
        case 'left':
        case 'right':
            return 'ew-resize'
        case 'top-left':
        case 'bottom-right':
            return 'nwse-resize'
        case 'top-right':
        case 'bottom-left':
            return 'nesw-resize'
    }
}

function defaultPanZoomConfig(onTransformChange: (transform: Transform) => void) {
    return {
        noWheelClassName: 'nowheel',
        noPanClassName: 'nopan',
        preventScrolling: true,
        panOnScroll: true,
        panOnDrag: true,
        panOnScrollMode: PanOnScrollMode.Free,
        panOnScrollSpeed: 1,
        zoomOnPinch: true,
        zoomOnScroll: false,
        zoomOnDoubleClick: true,
        zoomActivationKeyPressed: false,
        userSelectionActive: false,
        connectionInProgress: false,
        paneClickDistance: 0,
        selectionOnDrag: false,
        lib: 'xy',
        onTransformChange
    }
}

export function createWorkspaceCanvas(options: WorkspaceCanvasOptions) {
    const { paneEl, viewportEl, onViewportChange, onCanvasStateChange, onDocumentContentChange, onDocumentTitleChange, onAiChatThreadContentChange } = options
    let workspaceId = options.workspaceId

    paneEl.style.setProperty('--connector-line-default-color', webUiThemeSettings.nodesConnectorLineDefaultColor)
    paneEl.style.setProperty('--connector-line-focus-color', webUiThemeSettings.nodesConnectorLineFocusColor)
    paneEl.style.setProperty('--selection-marquee-border-color', webUiThemeSettings.selectionMarqueeBorderColor)
    paneEl.style.setProperty('--selection-marquee-background-color', webUiThemeSettings.selectionMarqueeBackgroundColor)
    paneEl.style.setProperty('--selection-overlay-border-color', webUiThemeSettings.selectionOverlayBorderColor)
    paneEl.style.setProperty('--selection-overlay-background-color', webUiThemeSettings.selectionOverlayBackgroundColor)
    paneEl.style.setProperty('--selection-outline-color', webUiThemeSettings.selectionOutlineColor)
    paneEl.style.setProperty('--workspace-image-default-box-shadow', webUiThemeSettings.imageNode.defaultBoxShadow)
    paneEl.style.setProperty('--workspace-image-selected-box-shadow', webUiThemeSettings.imageNode.selectedBoxShadow)
    paneEl.style.setProperty('--workspace-image-border-radius', `${webUiThemeSettings.imageNode.borderRadius}px`)
    paneEl.style.setProperty('--workspace-image-context-region-child-image-frame-color', webUiThemeSettings.imageNode.contextRegionChildImageFrameColor)
    paneEl.style.setProperty('--workspace-image-context-region-child-image-drop-shadow', webUiThemeSettings.imageNode.contextRegionChildImageDropShadow)
    paneEl.style.setProperty('--workspace-image-model-badge-box-shadow', webUiThemeSettings.imageNode.modelBadgeBoxShadow)

    let currentCanvasState: CanvasState | null = options.canvasState
    let currentDocuments: Document[] = options.documents
    let currentAiChatThreads: AiChatThread[] = options.aiChatThreads
    let panZoom: PanZoomInstance | null = null
    let lastTransform: Transform = [0, 0, 1]

    let connectionManager: WorkspaceConnectionManager | null = null
    let pixiMediaLayer: PixiMediaLayer | null = null
    let contextRegionLayer: PixiContextRegionLayer | null = null
    let viewportBridge: ViewportBridge | null = null
    let imageChromeViewportEl: HTMLDivElement | null = null

    const liveNodeOverrides: Map<string, { position?: { x: number; y: number }; dimensions?: { width: number; height: number } }> = new Map()
    let edgesRaf: number | null = null
    let transformSideEffectsRaf: number | null = null
    let pendingHandleZoom: number | null = null
    let autoGrowRaf: number | null = null
    let selectedNodeIds: Set<string> = new Set()
    let selectedEdgeId: string | null = null
    const expandedGeneratedImageInfoNodeIds: Set<string> = new Set()
    let resizingNodeId: string | null = null
    let draggingNodeId: string | null = null
    let selectionRectEl: HTMLDivElement | null = null
    let selectionGroupOverlayEl: HTMLDivElement | null = null
    let marqueeSelection: MarqueeSelectionState | null = null
    let selectionIsFromMarquee = false
    let suppressNextPaneClick = false
    let suppressNextNodeClick = false
    const pendingAutoGrowThreadNodeIds: Set<string> = new Set()
    const nodeLayerManager = createNodeLayerManager()
    const documentEditors: Map<string, DocumentEditorEntry> = new Map()
    const threadEditors: Map<string, AiChatThreadEditorEntry> = new Map()
    let activeAiChatRegionNodeId: string | null = null
    let activeAiChatThreadId: string | null = null
    let activeAiChatPanelThreadId: string | null = null
    let activeAiChatPanelRegionNodeId: string | null = null
    let activeAiChatPanelHadContent = false
    let activeAiChatPanelEl: HTMLDivElement | null = null
    let activeAiChatPromptEditor: any = null
    let activeAiChatPromptGradient: { destroy: () => void; triggerAnimation: () => void } | null = null
    let featureLibraryPanelInstance: ReturnType<typeof createFeatureLibraryPanel> | null = null
    let activeAiChatSidebarThreadId: string | null = null
    let activeAiChatSidebarTabId: string | null = null
    let aiChatSidebarTabs: CanvasAiChatSidebarTab[] = []
    let pendingLocalCanvasVisualCommit: PendingCanvasVisualCommit | null = null
    let nodePointerPanLockNodeId: string | null = null
    let paneNoPanAddedForNodePointer = false
    // Visibility tracking for lazy loading
    const visibleNodeIds: Set<string> = new Set()
    const loadedNodeIds: Set<string> = new Set()
    let paneRect: DOMRect | null = null

    // Image lifecycle tracker - handles deletion of orphaned images
    const canvasImageLifecycle = createCanvasImageLifecycleTracker()
    canvasImageLifecycle.initializeFromCanvasState(currentCanvasState)

    const pixiSelectionColors: SelectionColors = {
        marqueeStroke: webUiThemeSettings.selectionMarqueeBorderColor,
        marqueeFill: webUiThemeSettings.selectionMarqueeBackgroundColor,
        groupOverlayStroke: webUiThemeSettings.selectionOverlayBorderColor,
        groupOverlayFill: webUiThemeSettings.selectionOverlayBackgroundColor,
    }
    pixiMediaLayer = createPixiMediaLayer({
        paneEl,
        viewportEl,
        getWorkspaceId: () => workspaceId,
        selectionColors: pixiSelectionColors,
        onImageIntrinsicSize: handleImageIntrinsicSize,
    })
    contextRegionLayer = createPixiContextRegionLayer({
        paneEl,
        viewportEl,
    })
    imageChromeViewportEl = createImageChromeViewport()
    viewportBridge = createViewportBridge({
        viewportEl,
        viewportOverlayEls: [imageChromeViewportEl],
        getPixiLayer: () => pixiMediaLayer,
        getContextRegionLayer: () => contextRegionLayer,
    })
    if (currentCanvasState?.viewport) {
        viewportBridge.applyViewport(currentCanvasState.viewport)
    }
    syncPixiMediaLayer(currentCanvasState)
    syncContextRegionLayer(currentCanvasState)

    // Canvas bubble menu for image nodes (delete, create variant)
    let canvasBubbleMenu: BubbleMenu | null = null
    let canvasBubbleMenuItems: ReturnType<typeof buildCanvasBubbleMenuItems> | null = null

    function initCanvasBubbleMenu() {
        canvasBubbleMenuItems = buildCanvasBubbleMenuItems({
            onDeleteEdge: (edgeId) => {
                if (!connectionManager) return
                connectionManager.selectEdge(edgeId)
                connectionManager.deleteSelectedEdge()
            },
            onChangeConnectorCurve: (edgeId) => {
                if (!currentCanvasState) return

                const edgeIndex = currentCanvasState.edges.findIndex((e: WorkspaceEdge) => e.edgeId === edgeId)
                if (edgeIndex === -1) return

                const edge = currentCanvasState.edges[edgeIndex]
                const currentCurve = edge.pathType ?? webUiSettings.nodesConnectorLineCurve
                const newCurve = currentCurve === 'horizontal-bezier' ? 'orthogonal' : 'horizontal-bezier'

                const updatedEdge = { ...edge, pathType: newCurve }
                const newEdges = [...currentCanvasState.edges]
                newEdges[edgeIndex] = updatedEdge

                commitCanvasState({
                    ...currentCanvasState,
                    edges: newEdges
                })
            },
            onDeleteNode: (nodeId) => {
                if (!currentCanvasState) return

                const updatedNodes = currentCanvasState.nodes.filter((n: CanvasNode) => n.nodeId !== nodeId)
                const updatedEdges = currentCanvasState.edges.filter(
                    (e: WorkspaceEdge) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
                )

                selectNode(null)
                commitCanvasState({ ...currentCanvasState, nodes: updatedNodes, edges: updatedEdges })
            },
            onDownloadImage: (nodeId) => {
                const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                const imgEl = nodeEl?.querySelector('img') as HTMLImageElement | null
                if (imgEl?.src) {
                    downloadImage(imgEl.src, {
                        getAuthToken: async () => {
                            const token = await AuthService.getTokenSilently()
                            return token || ''
                        }
                    })
                }
            },
            onReplaceImage: (nodeId) => {
                const input = html`<input type="file" accept="image/*" style=${{ display: 'none' }}></input>` as HTMLInputElement
                input.addEventListener('change', async () => {
                    const file = input.files?.[0]
                    input.remove()
                    if (!file || !file.type.startsWith('image/')) return

                    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                    const token = await AuthService.getTokenSilently()
                    if (!token) return

                    const formData = new FormData()
                    formData.append('file', file)

                    const response = await fetch(`${API_BASE_URL}/api/images/${workspaceId}`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    })

                    if (!response.ok) return

                    const data = await response.json()
                    const newSrc = `${API_BASE_URL}${data.url}?token=${encodeURIComponent(token)}`

                    // Update DOM immediately
                    const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                    const imgEl = nodeEl?.querySelector('img') as HTMLImageElement | null
                    if (imgEl) imgEl.src = newSrc

                    // Update canvas state
                    if (!currentCanvasState) return
                    const updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) => {
                        if (n.nodeId !== nodeId || n.type !== 'image') return n
                        return { ...n, fileId: data.fileId, src: newSrc } as ImageCanvasNode
                    })
                    commitCanvasState({ ...currentCanvasState, nodes: updatedNodes })
                })
                document.body.appendChild(input)
                input.click()
            },
            onAskAi: async (nodeId) => {
                const imageNode = currentCanvasState?.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
                if (!imageNode || imageNode.type !== 'image') return

                const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                if (!aiChatThreadService) return

                try {
                    // Build the image NATS URL and any connected upstream context
                    const imageNatsUrl = `nats-obj://workspace-${workspaceId}-files/${(imageNode as any).fileId}`
                    const context = await aiChatThreadService.extractConnectedContext(nodeId)
                    const contextMessage = aiChatThreadService.buildContextMessage(context)

                    const extractionRunId = uuidv4()

                    // Store the image context so the extraction tab can use it when the user submits
                    setPendingExtractionContext(extractionRunId, {
                        imageNatsUrl,
                        contextMessages: contextMessage ? [contextMessage] : [],
                    })

                    openFeatureExtractionTab(extractionRunId)
                } catch (error) {
                    console.error('Failed to open extraction tab from image:', error)
                }
            },
            onTriggerConnection: (nodeId) => {
                if (!connectionManager) return

                connectionManager.startConnectionFromMenu(nodeId)
            },
            onHide: () => {
                canvasBubbleMenu?.forceHide()
            },
        })

        canvasBubbleMenu = new BubbleMenu({
            parentEl: paneEl,
            items: canvasBubbleMenuItems.items,
            getVisualScale: () => getCanvasChromeZoomMultiplier(getCurrentViewportZoom()),
        })
    }

    function isModSelectionEvent(event: MouseEvent): boolean {
        return event.metaKey || event.ctrlKey
    }

    function getSingleSelectedNodeId(): string | null {
        if (selectedNodeIds.size !== 1) return null
        return selectedNodeIds.values().next().value ?? null
    }

    function isNodeSelected(nodeId: string): boolean {
        return selectedNodeIds.has(nodeId)
    }

    function isContextRegionNodeElement(nodeEl: HTMLElement): boolean {
        return nodeEl.classList.contains('workspace-context-region-node')
            || nodeEl.classList.contains('workspace-ai-chat-thread-node--region')
    }

    function isContextRegionCanvasNode(node: CanvasNode): node is ContextRegionNode {
        return node.type === 'contextRegion' || node.type === 'aiChatThread'
    }

    function isImageInsideContextRegion(node: ImageCanvasNode, nodes: CanvasNode[] = currentCanvasState?.nodes ?? []): boolean {
        if (!node.parentId) return false
        return nodes.some((candidate: CanvasNode) => candidate.nodeId === node.parentId && isContextRegionCanvasNode(candidate))
    }

    function syncContextRegionImageFrame(nodeEl: HTMLElement, node: CanvasNode, nodes: CanvasNode[] = currentCanvasState?.nodes ?? []): void {
        const hasContextRegionFrame = node.type === 'image' && isImageInsideContextRegion(node as ImageCanvasNode, nodes)
        nodeEl.classList.toggle(CONTEXT_REGION_IMAGE_CLASS, hasContextRegionFrame)
    }

    function getCanvasRectFromSelection(state: MarqueeSelectionState): Rect {
        const left = Math.min(state.start.x, state.current.x)
        const top = Math.min(state.start.y, state.current.y)
        const width = Math.abs(state.current.x - state.start.x)
        const height = Math.abs(state.current.y - state.start.y)

        return { x: left, y: top, width, height }
    }

    function rectsOverlap(a: Rect, b: Rect): boolean {
        return a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y
    }
    function rectContainsCanvasPoint(rect: Rect, point: { x: number; y: number }): boolean {
        return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
    }

    function getNodeHitBeforeContextRegion(point: { x: number; y: number }): CanvasNode | null {
        if (!currentCanvasState) return null
        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        for (let i = currentCanvasState.nodes.length - 1; i >= 0; i--) {
            const node = currentCanvasState.nodes[i]
            if (node.type !== 'image' && node.type !== 'document') continue
            const rect = getNodeWorldRect(node, nodesById)
            if (rectContainsCanvasPoint(rect, point)) return node
        }
        return null
    }

    function getContextRegionBoundsHit(point: { x: number; y: number }): ContextRegionNode | null {
        if (!currentCanvasState) return null
        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))
        for (let i = currentCanvasState.nodes.length - 1; i >= 0; i--) {
            const node = currentCanvasState.nodes[i]
            if (!isContextRegionCanvasNode(node)) continue
            const rect = getSelectionOverlayBoundsForNode(node, nodesById, threadMap)
            if (rectContainsCanvasPoint(rect, point)) return node
        }
        return null
    }

    function getConnectedNodeIds(nodeId: string, canvasState: CanvasState | null = currentCanvasState): string[] {
        if (!canvasState) return []
        const connectedNodeIds = new Set<string>()
        for (const edge of canvasState.edges) {
            if (edge.sourceNodeId === nodeId) connectedNodeIds.add(edge.targetNodeId)
            if (edge.targetNodeId === nodeId) connectedNodeIds.add(edge.sourceNodeId)
        }
        return Array.from(connectedNodeIds)
    }

    function clampInsideRange(value: number, min: number, max: number): number {
        if (min > max) return min
        return Math.min(max, Math.max(min, value))
    }

    function getCanvasNodesById(nodes: CanvasNode[] = currentCanvasState?.nodes ?? []): Map<string, CanvasNode> {
        return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
    }

    function getNodeWorldPosition(
        node: CanvasNode,
        nodesById: Map<string, CanvasNode> = getCanvasNodesById(),
        visiting: Set<string> = new Set()
    ): { x: number; y: number } {
        const override = liveNodeOverrides.get(node.nodeId)?.position
        if (override) return override

        if (!node.parentId || visiting.has(node.nodeId)) return node.position

        const parentNode = nodesById.get(node.parentId)
        if (!parentNode) return node.position

        visiting.add(node.nodeId)
        const parentPosition = getNodeWorldPosition(parentNode, nodesById, visiting)
        visiting.delete(node.nodeId)

        return {
            x: parentPosition.x + node.position.x,
            y: parentPosition.y + node.position.y,
        }
    }

    function getNodeWorldRect(node: CanvasNode, nodesById: Map<string, CanvasNode> = getCanvasNodesById()): Rect {
        const position = getNodeWorldPosition(node, nodesById)
        const dimensions = liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
        return {
            x: position.x,
            y: position.y,
            width: dimensions.width,
            height: dimensions.height,
        }
    }

    function getAiChatThreadTitle(thread: AiChatThread | undefined): string {
        const docTitleNode = thread?.content?.content?.find?.((n: any) => n.type === 'documentTitle')
        return docTitleNode?.content?.[0]?.text ?? 'AI Chat'
    }

    function getContextRegionCloudDatum(
        node: ContextRegionNode,
        thread: AiChatThread | undefined,
        nodesById: Map<string, CanvasNode>
    ): ContextRegionCloudDatum {
        const override = liveNodeOverrides.get(node.nodeId)
        const position = override?.position ?? getNodeWorldPosition(node, nodesById)
        const dimensions = override?.dimensions ?? node.dimensions
        return {
            nodeId: node.nodeId,
            referenceId: node.referenceId,
            x: position.x,
            y: position.y,
            width: dimensions.width,
            height: dimensions.height,
            title: getAiChatThreadTitle(thread),
            selected: selectedNodeIds.has(node.nodeId),
            active: activeAiChatRegionNodeId === node.nodeId,
        }
    }

    function getContextRegionCloudDatums(canvasState: CanvasState | null = currentCanvasState): ContextRegionCloudDatum[] {
        if (!canvasState) return []
        const nodesById = getCanvasNodesById(canvasState.nodes)
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))
        return canvasState.nodes
            .filter((node: CanvasNode): node is ContextRegionNode => isContextRegionCanvasNode(node))
            .map((node: ContextRegionNode) => getContextRegionCloudDatum(node, threadMap.get(node.referenceId), nodesById))
    }

    function createImageChromeViewport(): HTMLDivElement {
        const chromeViewportStyle = {
            position: 'absolute' as const,
            top: '0',
            left: '0',
            transformOrigin: '0 0',
            willChange: 'transform',
            pointerEvents: 'none' as const,
            zIndex: '3',
        }
        const chromeViewport = html`<div className="workspace-image-chrome-viewport" style=${chromeViewportStyle}></div>` as HTMLDivElement
        paneEl.appendChild(chromeViewport)
        return chromeViewport
    }

    function applyGeneratedImageChromeGeometry(
        chromeEl: HTMLElement,
        position: { x: number; y: number },
        dimensions: { width: number; height: number }
    ): void {
        applyStyle(chromeEl, {
            left: `${position.x}px`,
            top: `${position.y + dimensions.height + 10}px`,
            width: `${dimensions.width}px`,
        })
    }

    function updateGeneratedImageChromeLiveTransform(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number }
    ): void {
        const chromeEl = imageChromeViewportEl?.querySelector(`[data-image-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (!chromeEl) return
        applyGeneratedImageChromeGeometry(chromeEl, position, dimensions)
    }

    function appendTextParagraph(host: HTMLElement, text: string, fallbackText: string): void {
        const value = text.trim()
        const className = value ? 'canvas-generated-image-info-text' : 'canvas-generated-image-info-empty'
        host.replaceChildren(html`<p className=${className}>${value || fallbackText}</p>`)
    }

    function createGeneratedImageInfoPanel(node: ImageCanvasNode): HTMLElement {
        const generatedBy = node.generatedBy
        const thread = generatedBy
            ? currentAiChatThreads.find((candidate: AiChatThread) => candidate.threadId === generatedBy.aiChatThreadId)
            : undefined
        const turnInfo = getGeneratedImageTurnInfoFromThreadContent(thread?.content, generatedBy?.responseMessageId)
        const userPromptText = turnInfo?.userPromptText || generatedBy?.promptText || ''
        const responseText = turnInfo?.responseText || generatedBy?.revisedPrompt || ''
        const responseProvider = turnInfo?.responseProvider || String(generatedBy?.aiModel || '')
        const userShell = createAiUserMessageShell({ wrapperClassName: 'canvas-generated-image-user' })
        const responseShell = createAiResponseMessageShell({
            provider: responseProvider,
            wrapperClassName: 'canvas-generated-image-response',
            includeSpinner: false,
        })
        const panel = html`
            <div className="canvas-generated-image-info-panel nopan">
                ${userShell.wrapper}
                ${responseShell.wrapper}
            </div>
        ` as HTMLElement

        appendTextParagraph(userShell.contentEl, userPromptText, 'Original prompt unavailable.')
        appendTextParagraph(responseShell.contentEl, responseText, 'AI response details unavailable.')

        if (turnInfo?.imageGenerationTrace) {
            const traceDetails = createImageGenerationTraceDetails({
                className: 'canvas-generated-image-trace-details',
                renderReferencesWhenClosed: true,
            })
            traceDetails.dom.open = true
            traceDetails.render({
                attrs: {
                    title: 'Image generation details',
                    isOpen: true,
                    isStreaming: false,
                    imageGenerationTrace: turnInfo.imageGenerationTrace,
                    imageGenerationTraceId: null,
                },
                childCount: turnInfo.imageGenerationPromptText ? 1 : 0,
                forceToolPromptFallback: true,
                toolPromptFallbackText: turnInfo.imageGenerationPromptText || turnInfo.imageGenerationTrace.toolPrompt,
            })
            responseShell.contentEl.appendChild(traceDetails.dom)
        }

        return panel
    }

    function toggleGeneratedImageInfo(nodeId: string): void {
        if (expandedGeneratedImageInfoNodeIds.has(nodeId)) {
            expandedGeneratedImageInfoNodeIds.delete(nodeId)
        } else {
            expandedGeneratedImageInfoNodeIds.add(nodeId)
        }
        syncGeneratedImageChrome(currentCanvasState)
    }

    function createGeneratedImageChrome(node: ImageCanvasNode): HTMLElement {
        const generatedBy = node.generatedBy
        const imageModelProvider = generatedBy?.imageModelProvider || ''
        const providerIcon = getAiProviderIcon(imageModelProvider)
        const isExpanded = expandedGeneratedImageInfoNodeIds.has(node.nodeId)
        const handleInfoClick = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toggleGeneratedImageInfo(node.nodeId)
        }
        const chromeEl = html`
            <div className="workspace-generated-image-chrome" data=${{ imageChromeNodeId: node.nodeId }}>
                <div className="workspace-generated-image-actions">
                    ${providerIcon ? html`<div className="image-model-badge" innerHTML=${providerIcon} title=${imageModelProvider}></div>` : null}
                    <button
                        className=${`image-info-button nopan${isExpanded ? ' is-active' : ''}`}
                        type="button"
                        aria-label="Image generation details"
                        aria-expanded=${String(isExpanded)}
                        title="Image generation details"
                        onclick=${handleInfoClick}
                    >
                        <span innerHTML=${infoCircleIcon}></span>
                    </button>
                </div>
                ${isExpanded ? createGeneratedImageInfoPanel(node) : null}
            </div>
        ` as HTMLElement

        applyGeneratedImageChromeGeometry(chromeEl, getNodeWorldPosition(node), node.dimensions)
        return chromeEl
    }

    function syncGeneratedImageChrome(canvasState: CanvasState | null = currentCanvasState): void {
        if (!imageChromeViewportEl) return
        const generatedImageNodes = (canvasState?.nodes ?? [])
            .filter((node: CanvasNode): node is ImageCanvasNode => node.type === 'image' && Boolean((node as ImageCanvasNode).generatedBy))
        const generatedNodeIds = new Set(generatedImageNodes.map((node: ImageCanvasNode) => node.nodeId))

        for (const expandedNodeId of Array.from(expandedGeneratedImageInfoNodeIds)) {
            if (!generatedNodeIds.has(expandedNodeId)) expandedGeneratedImageInfoNodeIds.delete(expandedNodeId)
        }

        imageChromeViewportEl.replaceChildren(...generatedImageNodes.map(createGeneratedImageChrome))
    }

    function syncContextRegionLayer(canvasState: CanvasState | null = currentCanvasState): void {
        const datums = getContextRegionCloudDatums(canvasState)
        contextRegionLayer?.sync(datums)
    }

    function syncPixiMediaLayer(canvasState: CanvasState | null = currentCanvasState): void {
        pixiMediaLayer?.sync(canvasState)
        syncGeneratedImageChrome(canvasState)
    }

    function fitImageDimensionsToAspectRatio(
        dimensions: { width: number; height: number },
        aspectRatio: number
    ): { width: number; height: number } {
        const widthFromHeight = dimensions.height * aspectRatio
        if (widthFromHeight <= dimensions.width) {
            return { width: widthFromHeight, height: dimensions.height }
        }
        return { width: dimensions.width, height: dimensions.width / aspectRatio }
    }

    function handleImageIntrinsicSize(size: { nodeId: string; width: number; height: number }): void {
        if (!currentCanvasState) return
        if (draggingNodeId === size.nodeId || resizingNodeId === size.nodeId) return
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return

        const intrinsicAspectRatio = size.width / size.height
        if (!Number.isFinite(intrinsicAspectRatio) || intrinsicAspectRatio <= 0) return

        const imageNode = currentCanvasState.nodes.find(
            (node: CanvasNode): node is ImageCanvasNode => node.type === 'image' && node.nodeId === size.nodeId
        )
        if (!imageNode) return

        const fittedDimensions = fitImageDimensionsToAspectRatio(imageNode.dimensions, intrinsicAspectRatio)
        const aspectChanged = Math.abs((imageNode.aspectRatio || 0) - intrinsicAspectRatio) > 0.001
        const widthChanged = Math.abs(imageNode.dimensions.width - fittedDimensions.width) > 0.5
        const heightChanged = Math.abs(imageNode.dimensions.height - fittedDimensions.height) > 0.5
        if (!aspectChanged && !widthChanged && !heightChanged) return

        const positionOffset = {
            x: (imageNode.dimensions.width - fittedDimensions.width) / 2,
            y: (imageNode.dimensions.height - fittedDimensions.height) / 2,
        }
        const nextPosition = {
            x: imageNode.position.x + positionOffset.x,
            y: imageNode.position.y + positionOffset.y,
        }

        const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== imageNode.nodeId) return node
            return {
                ...imageNode,
                aspectRatio: intrinsicAspectRatio,
                position: nextPosition,
                dimensions: fittedDimensions,
            }
        })

        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const worldPosition = getNodeWorldPosition(imageNode, nodesById)
        const nodeEl = viewportEl?.querySelector(`[data-node-id="${imageNode.nodeId}"]`) as HTMLElement | null
        if (nodeEl) {
            applyStyle(nodeEl, {
                left: `${worldPosition.x + positionOffset.x}px`,
                top: `${worldPosition.y + positionOffset.y}px`,
                width: `${fittedDimensions.width}px`,
                height: `${fittedDimensions.height}px`,
            })
        }

        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes: updatedNodes,
        })
        repositionCanvasBubbleMenu()
        updateSelectionGroupOverlayElement()
    }

    function toParentRelativePosition(
        worldPosition: { x: number; y: number },
        parentId: string,
        nodesById: Map<string, CanvasNode>
    ): { x: number; y: number } {
        const parentNode = nodesById.get(parentId)
        if (!parentNode) return worldPosition
        const parentPosition = getNodeWorldPosition(parentNode, nodesById)
        return {
            x: worldPosition.x - parentPosition.x,
            y: worldPosition.y - parentPosition.y,
        }
    }

    function expandRegionsToFitChildren(nodes: CanvasNode[]): CanvasNode[] {
        const inset = 48
        const childrenByParentId = new Map<string, CanvasNode[]>()
        for (const node of nodes) {
            if (!node.parentId) continue
            // Only consider image or document child nodes for bounding box.
            // Ignore anything like bubble menus or floating inputs if they ever crept in.
            const children = childrenByParentId.get(node.parentId) ?? []
            children.push(node)
            childrenByParentId.set(node.parentId, children)
        }

        return nodes.map((node: CanvasNode) => {
            if (!isContextRegionCanvasNode(node)) return node
            const children = childrenByParentId.get(node.nodeId)

            // Empty regions keep their persisted size so manual resize is stable.
            // Only repair invalid legacy dimensions that cannot render usefully.
            if (!children?.length) {
                if (node.dimensions.width <= 0 || node.dimensions.height <= 0) {
                    const nodeEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
                    if (nodeEl) {
                        applyStyle(nodeEl, { width: '300px', height: '200px' })
                    }
                    return { ...node, dimensions: { ...node.dimensions, width: 300, height: 200 } }
                }
                return node
            }

            // Regions grow to fit children, but never shrink below the user's
            // current size. Dropping a small image into a manually enlarged
            // empty region must preserve the larger region dimensions.
            let width = Math.max(200, node.dimensions.width)
            let height = Math.max(120, node.dimensions.height)
            for (const child of children) {
                width = Math.max(width, child.position.x + child.dimensions.width + inset)
                height = Math.max(height, child.position.y + child.dimensions.height + inset)
            }

            if (width === node.dimensions.width && height === node.dimensions.height) return node

            const nodeEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
            if (nodeEl) {
                applyStyle(nodeEl, { width: `${width}px`, height: `${height}px` })
            }

            return {
                ...node,
                dimensions: { ...node.dimensions, width, height },
            }
        })
    }

    function getGeneratedImageInsertionSize(): number {
        return webUiThemeSettings.imageBranchLineage.generatedImageSize
    }

    function getNextRegionChildPosition(region: CanvasNode, childWidth: number, childHeight: number, nodes: CanvasNode[]): { x: number; y: number } {
        const inset = 48
        const labelClearance = 48
        const gap = 16
        const existingChildren = nodes.filter((node: CanvasNode) => node.parentId === region.nodeId)
        const availableWidth = Math.max(childWidth, region.dimensions.width - inset * 2)
        const columns = Math.max(1, Math.floor((availableWidth + gap) / (childWidth + gap)))
        const index = existingChildren.length
        return {
            x: inset + (index % columns) * (childWidth + gap),
            y: labelClearance + Math.floor(index / columns) * (childHeight + gap),
        }
    }

    function getNextRegionOutputPosition(region: ContextRegionNode, childHeight: number, nodes: CanvasNode[]): { x: number; y: number } {
        const nodesById = getCanvasNodesById(nodes)
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))
        const regionDatum = getContextRegionCloudDatum(region, threadMap.get(region.referenceId), nodesById)
        const cloudBounds = getContextRegionCloudBounds(regionDatum)
        const horizontalGap = webUiThemeSettings.imageBranchLineage.contextRegionOutputGap
        const verticalGap = webUiThemeSettings.imageBranchLineage.branchToBranchGap
        const existingBranchRoots = getGeneratedChildOutputs(region, nodes, currentCanvasState?.edges ?? [])
            .filter((node: ImageCanvasNode) => node.generatedBy?.aiChatThreadId === region.referenceId)
        const previousBranchRoot = getMostRecentGeneratedChildOutput(existingBranchRoots)
        const previousBranchRect = previousBranchRoot ? getNodeWorldRect(previousBranchRoot, nodesById) : undefined

        return computeNextBranchRowPositionToRightOfRect(cloudBounds, previousBranchRect, childHeight, horizontalGap, verticalGap)
    }

    function getInsertionPaneSize(): { width: number; height: number } {
        const rect = paneRect ?? paneEl.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
    }

    function getCenteredInsertionPosition(dimensions: { width: number; height: number }): { x: number; y: number } {
        return computeViewportCenterInsertionPosition(dimensions, getLiveViewport(), getInsertionPaneSize())
    }

    function getContextRegionCollisionDatum(
        node: ContextRegionNode,
        position: { x: number; y: number },
        threadMap: Map<string, AiChatThread>
    ): ContextRegionCloudDatum {
        return {
            nodeId: node.nodeId,
            referenceId: node.referenceId,
            x: position.x,
            y: position.y,
            width: node.dimensions.width,
            height: node.dimensions.height,
            title: getAiChatThreadTitle(threadMap.get(node.referenceId)),
            selected: selectedNodeIds.has(node.nodeId),
            active: activeAiChatRegionNodeId === node.nodeId,
        }
    }

    function getContextRegionCollisionDatumFromBox(
        entry: CollisionEntry,
        box: CollisionBox,
        threadMap: Map<string, AiChatThread>
    ): ContextRegionCloudDatum | null {
        if (!isContextRegionCanvasNode(entry.node)) return null
        return getContextRegionCollisionDatum(entry.node, {
            x: box.x + entry.offset.x,
            y: box.y + entry.offset.y,
        }, threadMap)
    }

    function getResolvedNodePositionFromCollisionBox(node: CanvasNode, box: { x: number; y: number }, entries: Map<string, CollisionEntry>): { x: number; y: number } {
        const entry = entries.get(node.nodeId)
        if (!entry) return box
        return {
            x: box.x + entry.offset.x,
            y: box.y + entry.offset.y,
        }
    }

    function createShapeAwareCollisionPlan(nodes: CanvasNode[], topLevelOnly = false): CollisionPlan {
        const collisionNodes = topLevelOnly
            ? nodes.filter((node: CanvasNode) => !node.parentId)
            : nodes
        const nodesById = getCanvasNodesById(nodes)
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))
        const entries = new Map<string, CollisionEntry>()

        const nodeBoxes = collisionNodes.map((node: CanvasNode) => {
            const worldPosition = getNodeWorldPosition(node, nodesById)
            if (isContextRegionCanvasNode(node)) {
                const datum = getContextRegionCollisionDatum(node, worldPosition, threadMap)
                const cloudBounds = getContextRegionCloudBounds(datum)
                entries.set(node.nodeId, {
                    node,
                    offset: {
                        x: worldPosition.x - cloudBounds.x,
                        y: worldPosition.y - cloudBounds.y,
                    },
                })
                return { id: node.nodeId, ...cloudBounds }
            }

            entries.set(node.nodeId, { node, offset: { x: 0, y: 0 } })
            return {
                id: node.nodeId,
                x: worldPosition.x,
                y: worldPosition.y,
                width: node.dimensions.width,
                height: node.dimensions.height,
            }
        })

        const shouldResolvePair = (a: CollisionBox, b: CollisionBox): boolean => {
            const entryA = entries.get(a.id)
            const entryB = entries.get(b.id)
            if (!entryA || !entryB) return true

            const datumA = getContextRegionCollisionDatumFromBox(entryA, a, threadMap)
            const datumB = getContextRegionCollisionDatumFromBox(entryB, b, threadMap)
            if (datumA && datumB) return contextRegionCloudGeometry.contextRegionCloudsIntersect(datumA, datumB)
            if (datumA) return contextRegionCloudGeometry.rectIntersectsContextRegionCloud(datumA, b)
            if (datumB) return contextRegionCloudGeometry.rectIntersectsContextRegionCloud(datumB, a)
            return true
        }

        return { nodeBoxes, entries, shouldResolvePair }
    }

    function resolveTopLevelNodeCollisions(nodes: CanvasNode[]): CanvasNode[] {
        const collisionPlan = createShapeAwareCollisionPlan(nodes, true)
        const collisionResult = resolveCollisions(collisionPlan.nodeBoxes, {
            iterations: 50,
            overlapThreshold: 0.5,
            margin: 32,
            shouldResolvePair: collisionPlan.shouldResolvePair,
        })

        if (!collisionResult.hasChanges) return nodes

        return nodes.map((node: CanvasNode) => {
            if (node.parentId) return node
            const movedPosition = collisionResult.nodes.get(node.nodeId)
            return movedPosition ? { ...node, position: getResolvedNodePositionFromCollisionBox(node, movedPosition, collisionPlan.entries) } : node
        })
    }

    function getNodesForConnectionManager(nodes: CanvasNode[]): CanvasNode[] {
        const nodesById = getCanvasNodesById(nodes)
        return nodes.map((node: CanvasNode) => {
            const override = liveNodeOverrides.get(node.nodeId)
            const nodeForConnection: CanvasNode = {
                ...node,
                position: override?.position ?? getNodeWorldPosition(node, nodesById),
                dimensions: override?.dimensions ?? node.dimensions,
            }

            delete nodeForConnection.parentId
            delete nodeForConnection.expandParent
            delete nodeForConnection.extent

            return nodeForConnection
        })
    }

    function getCanvasPointFromClient(clientX: number, clientY: number): { x: number; y: number } {
        const paneBounds = paneRect ?? paneEl.getBoundingClientRect()
        return {
            x: (clientX - paneBounds.left - lastTransform[0]) / lastTransform[2],
            y: (clientY - paneBounds.top - lastTransform[1]) / lastTransform[2],
        }
    }

    function syncViewportInteractionState(viewport: Viewport): void {
        lastTransform = [viewport.x, viewport.y, viewport.zoom]
        paneRect = paneEl.getBoundingClientRect()
    }

    function updateCurrentCanvasViewport(viewport: Viewport): void {
        if (!currentCanvasState) return
        currentCanvasState = {
            ...currentCanvasState,
            viewport,
        }
        pendingLocalCanvasVisualCommit = updatePendingCanvasVisualCommitViewport(pendingLocalCanvasVisualCommit, viewport)
    }

    function getLiveViewport(): Viewport {
        return { x: lastTransform[0], y: lastTransform[1], zoom: lastTransform[2] }
    }

    function getSelectionBoundsForNode(node: CanvasNode): Rect {
        const override = liveNodeOverrides.get(node.nodeId)
        const position = override?.position ?? getNodeWorldPosition(node)
        const dimensions = override?.dimensions ?? node.dimensions

        let left = position.x
        let top = position.y
        let right = position.x + dimensions.width
        let bottom = position.y + dimensions.height

        if (node.type === 'aiChatThread') {
            const isHidden = hiddenEmptyThreadNodeIds.has(node.nodeId)
            const threadFloatingInput = threadFloatingInputs.get(node.nodeId)
            if (threadFloatingInput) {
                const inputTop = position.y + getThreadTopOffset(node.nodeId, dimensions.height)
                const inputWidth = threadFloatingInput.el.offsetWidth || dimensions.width
                const inputHeight = threadFloatingInput.el.offsetHeight

                if (isHidden) {
                    // Hidden empty threads: use only the floating input bounds
                    right = position.x + inputWidth
                    bottom = inputTop + inputHeight
                } else {
                    right = Math.max(right, position.x + inputWidth)
                    bottom = Math.max(bottom, inputTop + inputHeight)
                }
            }
        }

        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    function getSelectionOverlayBoundsForNode(
        node: CanvasNode,
        nodesById: Map<string, CanvasNode>,
        threadMap: Map<string, AiChatThread>
    ): Rect {
        if (!isContextRegionCanvasNode(node)) return getSelectionBoundsForNode(node)

        const datum = getContextRegionCloudDatum(node, threadMap.get(node.referenceId), nodesById)
        return getContextRegionCloudBounds(datum)
    }

    function selectionRectIntersectsNode(
        rect: Rect,
        node: CanvasNode,
        nodesById: Map<string, CanvasNode>,
        threadMap: Map<string, AiChatThread>
    ): boolean {
        if (!isContextRegionCanvasNode(node)) return rectsOverlap(rect, getSelectionBoundsForNode(node))

        if (node.type === 'aiChatThread' && hiddenEmptyThreadNodeIds.has(node.nodeId) && rectsOverlap(rect, getSelectionBoundsForNode(node))) {
            return true
        }

        const datum = getContextRegionCloudDatum(node, threadMap.get(node.referenceId), nodesById)
        if (typeof contextRegionCloudGeometry.rectIntersectsContextRegionCloud === 'function') {
            return contextRegionCloudGeometry.rectIntersectsContextRegionCloud(datum, rect)
        }

        return scoreRectAgainstContextRegionCloud(datum, rect, {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
        }) > 0
    }

    function getSelectableNodeIdsInRect(rect: Rect): string[] {
        if (!currentCanvasState) return []

        const selectedNodeIdsInRect = new Set<string>()
        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))

        currentCanvasState.nodes
            .filter((node: CanvasNode) => selectionRectIntersectsNode(rect, node, nodesById, threadMap))
            .forEach((node: CanvasNode) => {
                selectedNodeIdsInRect.add(node.nodeId)
            })

        return Array.from(selectedNodeIdsInRect)
    }

    function ensureSelectionRectElement(): HTMLDivElement | null {
        if (!viewportEl) return null
        if (selectionRectEl && viewportEl.contains(selectionRectEl)) return selectionRectEl

        selectionRectEl = html`<div className="workspace-selection-rect" style=${{ display: 'none' }}></div>` as HTMLDivElement
        viewportEl.appendChild(selectionRectEl)
        return selectionRectEl
    }

    function ensureSelectionGroupOverlayElement(): HTMLDivElement | null {
        if (!viewportEl) return null
        if (selectionGroupOverlayEl && viewportEl.contains(selectionGroupOverlayEl)) return selectionGroupOverlayEl

        selectionGroupOverlayEl = html`<div className="workspace-selection-group-overlay" style=${{ display: 'none' }}></div>` as HTMLDivElement
        selectionGroupOverlayEl.addEventListener('mousedown', (event) => {
            if (!shouldShowSelectionGroupOverlay()) return
            if (event.button !== 0) return

            const primaryNodeId = Array.from(selectedNodeIds)[0]
            if (!primaryNodeId) return

            handleDragStart(event, primaryNodeId)
        })
        viewportEl.appendChild(selectionGroupOverlayEl)
        return selectionGroupOverlayEl
    }

    function shouldShowSelectionGroupOverlay(): boolean {
        if (!currentCanvasState || selectedNodeIds.size === 0) return false
        if (selectedNodeIds.size > 1) return true
        return selectionIsFromMarquee
    }

    function updateSelectionRectElement(): void {
        if (!marqueeSelection) return

        const rect = getCanvasRectFromSelection(marqueeSelection)

        if (marqueeSelection.moved) {
            pixiMediaLayer?.setMarqueeRect(rect)

            // DOM rect covers document/thread selection while PIXI renders image-node chrome.
            const rectEl = ensureSelectionRectElement()
            if (rectEl) {
                applyStyle(rectEl, {
                    display: 'block',
                    left: `${rect.x}px`,
                    top: `${rect.y}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                })
            }
        } else {
            pixiMediaLayer?.setMarqueeRect(null)
            if (selectionRectEl) applyStyle(selectionRectEl, { display: 'none' })
        }
    }

    function hideSelectionRectElement(): void {
        pixiMediaLayer?.setMarqueeRect(null)
        if (selectionRectEl) {
            applyStyle(selectionRectEl, { display: 'none' })
        }
    }

    function clearMarqueeInteractionState(): void {
        marqueeSelection = null
        hideSelectionRectElement()
        pixiMediaLayer?.setSelectionOverlayBounds(null)
        if (selectionGroupOverlayEl) applyStyle(selectionGroupOverlayEl, { display: 'none' })
    }

    function getSelectionOverlayBounds(): Rect | null {
        if (!currentCanvasState || !shouldShowSelectionGroupOverlay()) return null
        if (marqueeSelection) return null

        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const overlayNodeIds = new Set<string>()
        for (const nodeId of selectedNodeIds) {
            overlayNodeIds.add(nodeId)
        }

        const overlayNodes = currentCanvasState.nodes.filter((node: CanvasNode) => overlayNodeIds.has(node.nodeId))
        if (overlayNodes.length === 0) return null

        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))

        const bounds = overlayNodes.map((node: CanvasNode) => {
            const rect = getSelectionOverlayBoundsForNode(node, nodesById, threadMap)
            return {
                left: rect.x,
                top: rect.y,
                right: rect.x + rect.width,
                bottom: rect.y + rect.height,
            }
        })

        const padding = 16
        const left = Math.min(...bounds.map((bound: { left: number }) => bound.left)) - padding
        const top = Math.min(...bounds.map((bound: { top: number }) => bound.top)) - padding
        const right = Math.max(...bounds.map((bound: { right: number }) => bound.right)) + padding
        const bottom = Math.max(...bounds.map((bound: { bottom: number }) => bound.bottom)) + padding

        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    function shouldUseSelectionGroupOverlayHitTarget(): boolean {
        if (!currentCanvasState || !shouldShowSelectionGroupOverlay()) return false
        if (selectedNodeIds.size > 1) return true

        for (const nodeId of selectedNodeIds) {
            const node = currentCanvasState.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
            if (node && !isContextRegionCanvasNode(node)) return true
        }

        return false
    }

    function shouldFillSelectionOverlayBounds(): boolean {
        if (!currentCanvasState) return true
        if (selectedNodeIds.size !== 1) return true
        if (selectionIsFromMarquee) return true

        const selectedNodeId = getSingleSelectedNodeId()
        const selectedNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === selectedNodeId)
        return !(selectedNode && isContextRegionCanvasNode(selectedNode))
    }

    function updateSelectionGroupOverlayElement(): void {
        const bounds = getSelectionOverlayBounds()

        // PIXI draws the visible selection overlay for image nodes.
        pixiMediaLayer?.setSelectionOverlayBounds(bounds, { fill: shouldFillSelectionOverlayBounds() })

        // The DOM element is kept invisible but in place as a drag hit target.
        // Its background/border are stripped in the SCSS so PIXI owns the visual.
        const overlayEl = ensureSelectionGroupOverlayElement()
        if (!overlayEl) return

        if (!bounds) {
            applyStyle(overlayEl, { display: 'none' })
            return
        }

        if (!shouldUseSelectionGroupOverlayHitTarget()) {
            applyStyle(overlayEl, { display: 'none' })
            return
        }

        applyStyle(overlayEl, {
            display: 'block',
            left: `${bounds.x}px`,
            top: `${bounds.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
        })
    }

    function updateNodeSelectionClasses(prevSelectedNodeIds: Set<string>, nextSelectedNodeIds: Set<string>): void {
        for (const nodeId of prevSelectedNodeIds) {
            if (nextSelectedNodeIds.has(nodeId)) continue
            const prevNode = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
            prevNode?.classList.remove('is-selected')
            threadFloatingInputs.get(nodeId)?.el.classList.remove('is-selected')
            threadRails.get(nodeId)?.classList.remove('is-selected')
        }

        for (const nodeId of nextSelectedNodeIds) {
            if (prevSelectedNodeIds.has(nodeId)) continue
            const nextNode = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
            nextNode?.classList.add('is-selected')
            threadFloatingInputs.get(nodeId)?.el.classList.add('is-selected')

            if (nextNode) {
                if (isContextRegionNodeElement(nextNode)) {
                    nodeLayerManager.sendToBackground(nextNode)
                } else {
                    nodeLayerManager.bringToFront(nextNode)
                }
            }

            threadRails.get(nodeId)?.classList.add('is-selected')
        }
    }

    function updateSelectionDrivenUi(): void {
        const singleSelectedNodeId = getSingleSelectedNodeId()

        if (!singleSelectedNodeId) {
            hideCanvasBubbleMenu()
            hideFloatingInput()
            return
        }

        selectedEdgeId = null
        connectionManager?.deselect()
        hideEdgeBubbleMenu()
        showCanvasBubbleMenuForNode(singleSelectedNodeId)

        const node = currentCanvasState?.nodes.find((item: CanvasNode) => item.nodeId === singleSelectedNodeId)
        if (!node) {
            hideCanvasBubbleMenu()
            hideFloatingInput()
            return
        }

        const selectedNodeIsContextRegion = isContextRegionCanvasNode(node)
        const selectedNodeType = (node as CanvasNode).type
        if (selectedNodeIsContextRegion || selectedNodeType === 'image') {
            if (selectedNodeIsContextRegion) {
                const refId = node.referenceId || singleSelectedNodeId
                promptInputController.setTarget({ nodeId: singleSelectedNodeId, type: node.type, referenceId: refId })
            }
            hideFloatingInput()
            return
        }

        showFloatingInput(singleSelectedNodeId)
    }

    function clearSelectedEdgeSelection(force = false): void {
        if (!force && !selectedEdgeId) return
        selectedEdgeId = null
        connectionManager?.deselect()
        hideEdgeBubbleMenu()
    }

    function setSelectedNodes(nextSelectedNodeIds: Set<string>, fromMarquee = false): void {
        const prevSelectedNodeIds = selectedNodeIds
        selectedNodeIds = nextSelectedNodeIds
        selectionIsFromMarquee = fromMarquee && nextSelectedNodeIds.size > 0
        if (currentCanvasState) connectionManager?.syncEdges(currentCanvasState.edges)
        if (nextSelectedNodeIds.size > 0) clearSelectedEdgeSelection()
        updateNodeSelectionClasses(prevSelectedNodeIds, selectedNodeIds)
        updateSelectionGroupOverlayElement()
        updateSelectionDrivenUi()
        pixiMediaLayer?.setSelectedImageNodes(nextSelectedNodeIds)
        syncContextRegionLayer(undefined)
        scheduleEdgesRender()
        for (const nodeId of nextSelectedNodeIds) {
            if (prevSelectedNodeIds.has(nodeId)) continue
            const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
            if (node && isContextRegionCanvasNode(node)) contextRegionLayer?.pulseRegion(nodeId)
        }
    }

    function toggleNodeSelection(nodeId: string): void {
        const nextSelectedNodeIds = new Set(selectedNodeIds)
        if (nextSelectedNodeIds.has(nodeId)) {
            nextSelectedNodeIds.delete(nodeId)
        } else {
            nextSelectedNodeIds.add(nodeId)
        }
        setSelectedNodes(nextSelectedNodeIds)
    }

    function clearNodeSelection(): void {
        if (selectedNodeIds.size === 0) {
            hideCanvasBubbleMenu()
            hideFloatingInput()
            updateSelectionGroupOverlayElement()
            return
        }
        setSelectedNodes(new Set())
    }

    function getContextRegionTargetNodeId(target: EventTarget | null): string | null {
        if (!(target instanceof Element)) return null
        if (!paneEl.contains(target)) return null
        const nodeEl = target.closest('[data-node-id]') as HTMLElement | null
        const nodeId = nodeEl?.dataset.nodeId
        if (!nodeId || !currentCanvasState) return null

        const node = currentCanvasState.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        return node && isContextRegionCanvasNode(node) ? nodeId : null
    }

    function isCanvasBackgroundTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) return false
        if (!paneEl.contains(target)) return false
        if (selectionGroupOverlayEl?.contains(target)) return false
        if (getContextRegionTargetNodeId(target)) return true

        return !target.closest([
            '[data-node-id]',
            '.workspace-thread-rail',
            '.workspace-ai-chat-floating-panel',
            '.ai-prompt-input-floating',
            '.workspace-edge-node',
            '.workspace-handle',
            '.document-resize-handle',
            '.node-drag-overlay',
            '.bubble-menu',
            '.workspace-generated-image-chrome',
        ].join(', '))
    }

    function showCanvasBubbleMenuForNode(nodeId: string) {
        if (!canvasBubbleMenu || !canvasBubbleMenuItems || !currentCanvasState) return

        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        if (!node || node.type !== 'image') {
            canvasBubbleMenu.hide()
            return
        }

        canvasBubbleMenuItems.setActiveNodeId(nodeId)

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
        if (!nodeEl) return

        const targetRect = getCanvasImageBubbleMenuTargetRect(nodeEl)

        const position: BubbleMenuPositionRequest = {
            targetRect,
            placement: 'below',
            clampToParent: false,
            animateOnShow: false,
        }
        canvasBubbleMenu.show(CANVAS_IMAGE_CONTEXT, position)
    }

    function getCanvasImageBubbleMenuTargetRect(nodeEl: HTMLElement): DOMRect {
        // Anchor to the canvas node box. The inner image can briefly report a
        // transient rect while the node is being dragged into or out of a region.
        return nodeEl.getBoundingClientRect()
    }

    function hideCanvasBubbleMenu() {
        canvasBubbleMenuItems?.setActiveNodeId(null)
        canvasBubbleMenu?.hide()
    }

    function repositionCanvasBubbleMenu() {
        const selectedNodeId = getSingleSelectedNodeId()
        if (!canvasBubbleMenu?.isVisible || !selectedNodeId) return

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${selectedNodeId}"]`) as HTMLElement
        if (!nodeEl) return

        const targetRect = getCanvasImageBubbleMenuTargetRect(nodeEl)

        canvasBubbleMenu.reposition({
            targetRect,
            placement: 'below',
            clampToParent: false,
            animateOnShow: false,
        })
    }

    function showEdgeBubbleMenu(edgeId: string) {
        if (!canvasBubbleMenu || !canvasBubbleMenuItems || !connectionManager) return

        canvasBubbleMenuItems.setActiveEdgeId(edgeId)

        const targetRect = connectionManager.getEdgeMidpointRect(edgeId)
        if (!targetRect) return
        canvasBubbleMenu.show(CANVAS_EDGE_CONTEXT, { targetRect, placement: 'below' })
    }

    function hideEdgeBubbleMenu() {
        canvasBubbleMenuItems?.setActiveEdgeId(null)
        canvasBubbleMenu?.hide()
    }

    function repositionEdgeBubbleMenu() {
        if (!canvasBubbleMenu?.isVisible || !selectedEdgeId || !connectionManager) return

        const targetRect = connectionManager.getEdgeMidpointRect(selectedEdgeId)
        if (!targetRect) return
        canvasBubbleMenu.reposition({ targetRect, placement: 'below' })
    }

    // ========== FLOATING AI PROMPT INPUT ==========

    // Single floating input for non-thread nodes (selection-based show/hide)
    let floatingInputEl: HTMLDivElement | null = null
    let floatingInputEditor: any = null
    let floatingInputGradient: { destroy: () => void; triggerAnimation: () => void } | null = null

    // Per-thread floating inputs: always visible below each aiChatThread node
    type ThreadFloatingInputEntry = {
        nodeId: string
        threadId: string
        el: HTMLDivElement
        editor: any
        gradient: { destroy: () => void; triggerAnimation: () => void } | null
    }
    const threadFloatingInputs: Map<string, ThreadFloatingInputEntry> = new Map()

    // Vertical rail elements — one per AI chat thread, spanning thread + floating input
    const RAIL_OFFSET = webUiThemeSettings.aiChatThreadRailOffset
    const RAIL_GRAB_WIDTH = webUiSettings.aiChatThreadRailDragGrabWidth
    const AI_CHAT_PANEL_RAIL_PROMPT_GAP = 16
    const AI_CHAT_PANEL_MIN_WIDTH = 320
    const AI_CHAT_PANEL_MAX_PANE_MARGIN = 64
    const threadRails: Map<string, HTMLElement> = new Map()
    let activeAiChatPanelWidth: number | null = null

    const promptInputController = new AiPromptInputController({
        workspaceId,
        getCanvasState: () => currentCanvasState,
        persistCanvasState: (state: CanvasState) => {
            commitCanvasState(state)
        },
        onAiChatThreadCreated: ({ threadId, nodeId }) => {
            activeAiChatThreadId = threadId
            activeAiChatRegionNodeId = nodeId
            syncContextRegionLayer(currentCanvasState)
            requestAnimationFrame(() => {
                renderActiveAiChatPanel()
            })
        },
        createAiChatThread: async (params) => {
            const aiChatThreadService = servicesStore.getData('aiChatThreadService')
            if (!aiChatThreadService) return null
            return aiChatThreadService.createAiChatThread(params)
        },
        onAiSubmit: (threadId, payload) => {
            const entry = threadEditors.get(threadId)
            if (!entry) return

            // Trigger gradient animation on the target thread
            entry.triggerGradientAnimation?.()

            // The actual AI request is triggered by USE_AI_CHAT_META dispatch
            // which the controller already handles via injectMessageAndSubmit
        },
        onAiStop: (threadId) => {
            const entry = threadEditors.get(threadId)
            if (!entry) return
            entry.aiService.stopChatMessage()
        },
    })

    function getPromptControlFactories() {
        return {
            createModelDropdown: createGenericAiModelDropdown,
            createImageModelDropdown: createGenericImageModelDropdown,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createSubmitButton: createGenericSubmitButton,
        }
    }

    function getWorkspaceCanvasElement(): HTMLElement | null {
        return paneEl.closest('.workspace-canvas') as HTMLElement | null
    }

    function getActiveAiChatPanelMaxWidth(): number {
        const paneWidth = paneEl.getBoundingClientRect().width
        return Math.max(AI_CHAT_PANEL_MIN_WIDTH, paneWidth - AI_CHAT_PANEL_MAX_PANE_MARGIN)
    }

    function applyActiveAiChatPanelWidth(width: number): number {
        const nextWidth = clampInsideRange(width, AI_CHAT_PANEL_MIN_WIDTH, getActiveAiChatPanelMaxWidth())
        const widthValue = `${nextWidth}px`

        activeAiChatPanelWidth = nextWidth
        getWorkspaceCanvasElement()?.style.setProperty('--workspace-ai-chat-sidebar-width', widthValue)
        activeAiChatPanelEl?.style.setProperty('--workspace-ai-chat-sidebar-width', widthValue)

        return nextWidth
    }

    function measureActiveAiChatPanelRailThreadHeight(panelEl: HTMLElement): number {
        const promptEl = panelEl.querySelector<HTMLElement>('.workspace-ai-chat-floating-panel__prompt')
        if (promptEl) return Math.max(0, promptEl.offsetTop - AI_CHAT_PANEL_RAIL_PROMPT_GAP)

        const bodyHost = panelEl.querySelector<HTMLElement>('.workspace-ai-chat-panel-body')
        if (bodyHost) return bodyHost.offsetTop + bodyHost.offsetHeight

        return panelEl.querySelector<HTMLElement>('.ai-chat-thread-node-editor')?.offsetHeight ?? 0
    }

    function handleActiveAiChatPanelResizeStart(event: MouseEvent, panelEl: HTMLDivElement): void {
        if (event.button !== 0) return

        event.preventDefault()
        event.stopPropagation()

        const startX = event.clientX
        const startWidth = activeAiChatPanelWidth ?? panelEl.getBoundingClientRect().width
        const previousBodyCursor = document.body.style.cursor
        const previousBodyUserSelect = document.body.style.userSelect

        panelEl.classList.add('is-resizing')
        applyStyle(document.body, { cursor: 'ew-resize', userSelect: 'none' })

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true,
                selectionOnDrag: false
            })
        }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            applyActiveAiChatPanelWidth(startWidth + startX - moveEvent.clientX)
        }

        const handleMouseUp = () => {
            panelEl.classList.remove('is-resizing')
            applyStyle(document.body, { cursor: previousBodyCursor, userSelect: previousBodyUserSelect })

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function aiChatThreadHasRenderableContent(thread: AiChatThread | undefined): boolean {
        return Boolean(thread && thread.content != null && typeof thread.content === 'object' && Object.keys(thread.content).length > 0)
    }

    function destroyActiveAiChatPanel(clearActive = false, panelThreadId = activeAiChatPanelThreadId ?? activeAiChatThreadId): void {
        if (panelThreadId) {
            const entry = threadEditors.get(panelThreadId)
            if (entry) {
                entry.editor?.destroy?.()
                entry.aiService?.disconnect?.()
                entry.gradientCleanup?.()
                promptInputController.unregisterThreadEditor(panelThreadId)
                threadEditors.delete(panelThreadId)
            }
        }

        activeAiChatPromptEditor?.destroy?.()
        activeAiChatPromptGradient?.destroy()
        activeAiChatPanelEl?.remove()
        activeAiChatPanelThreadId = null
        activeAiChatPanelRegionNodeId = null
        activeAiChatPanelHadContent = false
        activeAiChatPanelEl = null
        activeAiChatPromptEditor = null
        activeAiChatPromptGradient = null

        if (clearActive) {
            activeAiChatThreadId = null
            activeAiChatRegionNodeId = null
            activeAiChatSidebarThreadId = null
            activeAiChatSidebarTabId = null
            aiChatSidebarTabs = []
            promptInputController.setTarget(null)
            syncContextRegionLayer(currentCanvasState)
        }
    }

    function activateAiChatPanel(regionNode: ContextRegionNode, thread: AiChatThread | undefined): void {
        activeAiChatRegionNodeId = regionNode.nodeId
        activeAiChatThreadId = regionNode.referenceId
        syncContextRegionLayer(currentCanvasState)
        contextRegionLayer?.pulseRegion(regionNode.nodeId)
        ensureAiChatSidebarThreadTab(regionNode.referenceId)
        persistAiChatSidebarState()
        renderActiveAiChatPanel(regionNode, thread)
    }

    function createAiChatThreadSidebarTab(threadId: string): CanvasAiChatSidebarTab {
        return { tabId: `thread:${threadId}`, type: 'thread', refId: threadId, title: 'AI Chat' }
    }

    function getPersistedAiChatSidebarTabs(threadId: string): CanvasAiChatSidebarTab[] {
        if (currentCanvasState?.lastActiveAiChatThreadId !== threadId) return []

        const tabs = currentCanvasState.aiChatSidebarTabs ?? []
        const seenTabIds = new Set<string>()
        const sanitizedTabs: CanvasAiChatSidebarTab[] = []
        for (const tab of tabs) {
            if (!tab?.tabId || seenTabIds.has(tab.tabId)) continue
            if (tab.type === 'thread' && tab.refId !== threadId) continue
            if (tab.type !== 'thread' && tab.type !== 'extraction') continue
            seenTabIds.add(tab.tabId)
            sanitizedTabs.push(tab)
        }

        return sanitizedTabs
    }

    function hydrateAiChatSidebarTabsFromCanvasState(threadId: string): void {
        const threadTab = createAiChatThreadSidebarTab(threadId)
        const persistedTabs = getPersistedAiChatSidebarTabs(threadId)
        aiChatSidebarTabs = persistedTabs.some((tab) => tab.tabId === threadTab.tabId)
            ? persistedTabs
            : [threadTab, ...persistedTabs]

        const persistedActiveTabId = currentCanvasState?.activeAiChatSidebarTabId ?? null
        activeAiChatSidebarTabId = persistedActiveTabId && aiChatSidebarTabs.some((tab) => tab.tabId === persistedActiveTabId)
            ? persistedActiveTabId
            : threadTab.tabId
        activeAiChatSidebarThreadId = threadId
    }

    function persistAiChatSidebarState(): void {
        if (!currentCanvasState || !activeAiChatThreadId) return

        const threadTab = createAiChatThreadSidebarTab(activeAiChatThreadId)
        const persistedTabs = aiChatSidebarTabs.some((tab) => tab.tabId === threadTab.tabId)
            ? aiChatSidebarTabs
            : [threadTab, ...aiChatSidebarTabs]
        const nextActiveTabId = activeAiChatSidebarTabId && persistedTabs.some((tab) => tab.tabId === activeAiChatSidebarTabId)
            ? activeAiChatSidebarTabId
            : threadTab.tabId

        const tabsUnchanged = JSON.stringify(currentCanvasState.aiChatSidebarTabs ?? []) === JSON.stringify(persistedTabs)
        if (
            currentCanvasState.lastActiveAiChatThreadId === activeAiChatThreadId &&
            currentCanvasState.activeAiChatSidebarTabId === nextActiveTabId &&
            tabsUnchanged
        ) return

        commitCanvasMetadataState({
            ...currentCanvasState,
            lastActiveAiChatThreadId: activeAiChatThreadId,
            aiChatSidebarTabs: persistedTabs,
            activeAiChatSidebarTabId: nextActiveTabId,
        })
    }

    function getPersistedFeatureExtractionState(extractionRunId: string): CanvasFeatureExtractionState | undefined {
        return currentCanvasState?.featureExtractionRuns?.[extractionRunId]
    }

    function persistFeatureExtractionState(extractionState: CanvasFeatureExtractionState): void {
        if (!currentCanvasState) return

        const currentExtractionState = currentCanvasState.featureExtractionRuns?.[extractionState.extractionRunId]
        if (currentExtractionState && JSON.stringify(currentExtractionState) === JSON.stringify(extractionState)) return

        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            featureExtractionRuns: {
                ...(currentCanvasState.featureExtractionRuns ?? {}),
                [extractionState.extractionRunId]: extractionState,
            },
        })
    }

    function syncActiveAiChatPanelFromState(): void {
        if (!currentCanvasState?.lastActiveAiChatThreadId) return
        if (activeAiChatThreadId === currentCanvasState.lastActiveAiChatThreadId) {
            if (!aiChatSidebarTabs.length && activeAiChatThreadId) hydrateAiChatSidebarTabsFromCanvasState(activeAiChatThreadId)
            return
        }

        const activeRegion = currentCanvasState.nodes.find(
            (node: CanvasNode): node is ContextRegionNode => isContextRegionCanvasNode(node)
                && node.referenceId === currentCanvasState!.lastActiveAiChatThreadId
        )
        if (!activeRegion) return

        activeAiChatThreadId = activeRegion.referenceId
        activeAiChatRegionNodeId = activeRegion.nodeId
        syncContextRegionLayer(currentCanvasState)
        hydrateAiChatSidebarTabsFromCanvasState(activeRegion.referenceId)
    }

    function ensureAiChatSidebarThreadTab(threadId: string): void {
        const threadTabId = `thread:${threadId}`
        if (activeAiChatSidebarThreadId !== threadId) {
            hydrateAiChatSidebarTabsFromCanvasState(threadId)
            return
        }

        if (!aiChatSidebarTabs.some((tab) => tab.tabId === threadTabId)) {
            aiChatSidebarTabs.unshift(createAiChatThreadSidebarTab(threadId))
        }
        if (!activeAiChatSidebarTabId || !aiChatSidebarTabs.some((tab) => tab.tabId === activeAiChatSidebarTabId)) {
            activeAiChatSidebarTabId = threadTabId
        }
    }

    function getActiveAiChatSidebarTab(): CanvasAiChatSidebarTab | undefined {
        return aiChatSidebarTabs.find((tab) => tab.tabId === activeAiChatSidebarTabId) ?? aiChatSidebarTabs[0]
    }

    function insertFeatureIntoActivePrompt(feature: FeatureMeta): boolean {
        const view = activeAiChatPromptEditor?.editorView
        const featureRefType = view?.state.schema.nodes.feature_reference
        if (!view || !featureRefType) return false

        try {
            const node = featureRefType.create({
                featureId: feature.featureId,
                featureName: feature.name,
                category: feature.category,
            })
            let tr = view.state.tr.replaceSelectionWith(node)
            const cursorPos = Math.min(tr.selection.from, tr.doc.content.size)
            tr = tr.insertText(' ', cursorPos)
            tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(cursorPos + 1, tr.doc.content.size))).scrollIntoView()
            view.dispatch(tr)
            view.focus()
            activeAiChatPromptGradient?.triggerAnimation()
            return true
        } catch (error) {
            console.error('Failed to insert feature reference into prompt:', error)
            view.focus()
            return false
        }
    }

    function extractPromptTextFromContentJSON(contentJSON: any): string {
        const chunks: string[] = []
        const visit = (node: any) => {
            if (!node) return
            if (Array.isArray(node)) {
                for (const child of node) visit(child)
                return
            }
            if (typeof node === 'string') {
                chunks.push(node)
                return
            }
            if (node.type === 'text' && typeof node.text === 'string') chunks.push(node.text)
            if (node.type === 'hard_break') chunks.push('\n')
            if (Array.isArray(node.content)) {
                for (const child of node.content) visit(child)
                if (node.type === 'paragraph') chunks.push('\n')
            }
        }
        visit(contentJSON)
        return chunks.join('').replace(/\n{3,}/g, '\n\n').trim()
    }

    function openFeatureExtractionTab(extractionRunId: string): void {
        syncActiveAiChatPanelFromState()
        if (!activeAiChatThreadId || !activeAiChatRegionNodeId) return

        ensureAiChatSidebarThreadTab(activeAiChatThreadId)
        const tabId = `extraction:${extractionRunId}`
        if (!aiChatSidebarTabs.some((tab) => tab.tabId === tabId)) {
            aiChatSidebarTabs.push({ tabId, type: 'extraction', refId: extractionRunId, title: 'Extract Feature' })
        }
        activeAiChatSidebarTabId = tabId
        persistAiChatSidebarState()
        renderActiveAiChatPanel()
    }

    function renderActiveAiChatPanel(regionNodeOverride?: ContextRegionNode, threadOverride?: AiChatThread): void {
        if (!activeAiChatRegionNodeId || !activeAiChatThreadId) return

        const panelRegionNodeId = activeAiChatRegionNodeId
        const panelThreadId = activeAiChatThreadId

        const regionNode = regionNodeOverride ?? currentCanvasState?.nodes.find(
            (node: CanvasNode): node is ContextRegionNode => isContextRegionCanvasNode(node) && node.nodeId === panelRegionNodeId
        )
        if (!regionNode) {
            destroyActiveAiChatPanel(true)
            return
        }

        const thread = threadOverride ?? currentAiChatThreads.find((candidate) => candidate.threadId === panelThreadId)
        ensureAiChatSidebarThreadTab(panelThreadId)
        const activeSidebarTab = getActiveAiChatSidebarTab()
        destroyActiveAiChatPanel(false)

        const panelEl = html`<div
            className="workspace-ai-chat-floating-panel workspace-ai-chat-thread-node nopan nowheel"
            data=${{ threadId: panelThreadId, regionNodeId: regionNode.nodeId }}
            onmousedown=${(event: Event) => event.stopPropagation()}
            onclick=${(event: Event) => event.stopPropagation()}
        ></div>` as HTMLDivElement

        panelEl.style.setProperty('--ai-chat-thread-node-box-shadow', webUiThemeSettings.aiChatThreadNodeBoxShadow)
        panelEl.style.setProperty('--ai-chat-thread-node-border', webUiThemeSettings.aiChatThreadNodeBorder)

        if (!webUiSettings.showHeaderOnAiChatThreadNodes) {
            panelEl.classList.add('workspace-ai-chat-thread-node--hide-title')
        }

        const gradient = webUiSettings.useShiftingGradientBackgroundOnAiChatThreadNode
            ? createShiftingGradientBackground(panelEl)
            : null

        const tabsEl = html`<div className="workspace-ai-chat-panel-tabs" role="tablist"></div>` as HTMLDivElement
        for (const tab of aiChatSidebarTabs) {
            const isActive = tab.tabId === activeSidebarTab?.tabId
            const tabEl = html`<button
                type="button"
                className=${`workspace-ai-chat-panel-tab${isActive ? ' workspace-ai-chat-panel-tab--active' : ''}`}
                data=${{ tabId: tab.tabId }}
                role="tab"
                aria-selected=${String(isActive)}
            >
                <span className="workspace-ai-chat-panel-tab__title">${tab.title}</span>
                ${tab.type === 'extraction' ? html`<span className="workspace-ai-chat-panel-tab__close" aria-hidden="true">x</span>` : null}
            </button>` as HTMLButtonElement
            tabEl.addEventListener('click', (event) => {
                const target = event.target as HTMLElement
                if (target.classList.contains('workspace-ai-chat-panel-tab__close')) {
                    aiChatSidebarTabs = aiChatSidebarTabs.filter((candidate) => candidate.tabId !== tab.tabId)
                    activeAiChatSidebarTabId = aiChatSidebarTabs[0]?.tabId ?? null
                } else {
                    activeAiChatSidebarTabId = tab.tabId
                }
                persistAiChatSidebarState()
                renderActiveAiChatPanel(regionNode, thread)
            })
            tabsEl.appendChild(tabEl)
        }
        panelEl.appendChild(tabsEl)

        const bodyHost = html`<div className="workspace-ai-chat-panel-body"></div>` as HTMLDivElement
        const editorContainer = html`<div className=${`ai-chat-thread-node-editor workspace-ai-chat-panel-body__pane nopan${activeSidebarTab?.type === 'extraction' ? ' workspace-ai-chat-panel-body__pane--hidden' : ''}`}></div>` as HTMLDivElement
        const extractionBodyEl = html`<div className=${`workspace-ai-chat-panel-extraction workspace-ai-chat-panel-body__pane nopan${activeSidebarTab?.type === 'extraction' ? '' : ' workspace-ai-chat-panel-body__pane--hidden'}`}></div>` as HTMLDivElement
        bodyHost.appendChild(editorContainer)
        bodyHost.appendChild(extractionBodyEl)
        panelEl.appendChild(bodyHost)

        if (activeSidebarTab?.type === 'extraction') {
            renderExtractionTabBody(activeSidebarTab.tabId, activeSidebarTab.refId, extractionBodyEl, workspaceId, {
                getState: getPersistedFeatureExtractionState,
            })
        }

        const hasContent = aiChatThreadHasRenderableContent(thread)
        const editorContent = hasContent && thread
            ? thread.content
            : {
                type: 'doc',
                content: [
                    { type: 'documentTitle', content: [{ type: 'text', text: 'AI Chat' }] },
                    { type: 'aiChatThread', attrs: { threadId: panelThreadId }, content: [] },
                ],
            }

        const aiService = new AiInteractionService({
            workspaceId,
            aiChatThreadId: panelThreadId
        })
        const promptControlFactories = getPromptControlFactories()

        const editor = new ProseMirrorEditor({
            editorMountElement: editorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: editorContent,
            isDisabled: false,
            documentType: 'aiChatThread',
            threadId: panelThreadId,
            onEditorChange: (value: any) => {
                onAiChatThreadContentChange?.({
                    workspaceId,
                    threadId: panelThreadId,
                    content: value
                })
            },
            onProjectTitleChange: () => {},
            onAiChatSubmit: async ({ messages, aiModel, imageOptions, referencedFeatureIds }: any) => {
                gradient?.triggerAnimation()
                activeAiChatPromptGradient?.triggerAnimation()
                contextRegionLayer?.pulseRegion(regionNode.nodeId)

                try {
                    const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                    const imagePlacement = rememberGeneratedImagePlacement(
                        regionNode.referenceId,
                        regionNode,
                        messages,
                        Boolean(imageOptions?.aiImageModel)
                    )
                    const context = await aiChatThreadService.extractConnectedContext(regionNode.nodeId)
                    const contextMessage = aiChatThreadService.buildContextMessage(context)
                    const messagesWithContext = contextMessage ? [contextMessage, ...messages] : messages

                    aiService.sendChatMessage({
                        messages: messagesWithContext,
                        aiModel,
                        aiImageModel: imageOptions?.aiImageModel,
                        imageSize: imageOptions?.imageGenerationSize,
                        referencedFeatureIds,
                        imageBranchCandidateSnapshot: imagePlacement.imageBranchCandidateSnapshot,
                    })
                } catch (error) {
                    console.error('Failed to gather context from context region:', error)
                    throw error
                }
            },
            onAiChatStop: () => {
                aiService.stopChatMessage()
            },
            onPromptSubmit: () => {},
            onPromptStop: () => {},
            isPromptReceiving: () => promptInputController.isReceiving(panelThreadId),
            promptControlFactories,
            onReceivingStateChange: (threadId: string, receiving: boolean) => {
                promptInputController.setReceiving(threadId, receiving)
            }
        })

        threadEditors.set(panelThreadId, {
            editor,
            aiService,
            containerEl: panelEl,
            gradientCleanup: gradient?.destroy,
            triggerGradientAnimation: () => {
                gradient?.triggerAnimation()
                activeAiChatPromptGradient?.triggerAnimation()
            },
        })

        promptInputController.registerThreadEditor(panelThreadId, {
            editorView: editor.editorView,
            triggerGradientAnimation: () => {
                gradient?.triggerAnimation()
                activeAiChatPromptGradient?.triggerAnimation()
            },
        })

        const promptEl = html`<div className="ai-prompt-input-floating workspace-ai-chat-floating-panel__prompt nopan"></div>` as HTMLDivElement
        promptEl.style.setProperty('--dropdown-popover-box-shadow', webUiThemeSettings.dropdownPopoverBoxShadow)
        if (webUiSettings.useShiftingGradientBackgroundOnAiUserInputNode) {
            activeAiChatPromptGradient = createShiftingGradientBackground(promptEl)
        }

        const promptEditorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        promptEl.appendChild(promptEditorContainer)
        panelEl.appendChild(promptEl)

        activeAiChatPromptEditor = new ProseMirrorEditor({
            editorMountElement: promptEditorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            threadId: panelThreadId,
            onEditorChange: () => {},
            onProjectTitleChange: () => {},
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
            onPromptSubmit: (data: any) => {
                const currentTab = getActiveAiChatSidebarTab()
                if (currentTab?.type === 'extraction') {
                    const userText = extractPromptTextFromContentJSON(data.contentJSON)
                    if (!userText) return
                    const ctx = {
                        ...(getPendingExtractionContext(currentTab.refId) ?? {}),
                        aiModel: data.aiModel,
                        aiImageModel: data.imageOptions?.aiImageModel,
                    }
                    submitExtractionRequest(extractionBodyEl, currentTab.refId, workspaceId, userText, ctx, {
                        getState: getPersistedFeatureExtractionState,
                        saveState: persistFeatureExtractionState,
                    })
                    return
                }

                promptInputController.setTarget({
                    nodeId: regionNode.nodeId,
                    type: regionNode.type,
                    referenceId: panelThreadId,
                })
                promptInputController.submitMessage({
                    contentJSON: data.contentJSON,
                    aiModel: data.aiModel,
                    imageOptions: data.imageOptions,
                })
            },
            onPromptStop: () => {
                promptInputController.setTarget({
                    nodeId: regionNode.nodeId,
                    type: regionNode.type,
                    referenceId: panelThreadId,
                })
                promptInputController.stopStreaming()
            },
            isPromptReceiving: () => promptInputController.isReceiving(panelThreadId),
            promptControlFactories,
            onReceivingStateChange: () => {},
        })

        const railStyle = {
            position: 'absolute' as const,
            width: `${RAIL_GRAB_WIDTH}px`,
            left: `${-RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`,
            top: '0',
            zIndex: '9990',
        }
        const rail = html`<div
            className="workspace-thread-rail workspace-ai-chat-floating-panel__rail nopan"
            style=${railStyle}
            data=${{ threadNodeId: regionNode.nodeId }}
        ></div>` as HTMLDivElement
        rail.style.setProperty('--rail-gradient', webUiThemeSettings.aiChatThreadRailGradient)
        rail.style.setProperty('--rail-width', webUiThemeSettings.aiChatThreadRailWidth)
        rail.addEventListener('mousedown', (event) => {
            handleActiveAiChatPanelResizeStart(event, panelEl)
        })

        const line = html`<div className="workspace-thread-rail__line"></div>` as HTMLDivElement
        const bottomCircle = html`<div className="workspace-thread-rail__boundary-circle" innerHTML=${aiChatThreadRailBoundaryCircle}></div>` as HTMLDivElement
        const circlePaths = bottomCircle.querySelectorAll('path')
        const [outerColor, ringColor, innerColor] = webUiThemeSettings.aiChatThreadRailBoundaryCircleColors
        if (circlePaths[0]) circlePaths[0].setAttribute('fill', outerColor)
        if (circlePaths[1]) circlePaths[1].setAttribute('fill', ringColor)
        if (circlePaths[2]) circlePaths[2].setAttribute('fill', innerColor)
        line.appendChild(bottomCircle)
        rail.appendChild(line)
        panelEl.appendChild(rail)

        activeAiChatPanelEl = panelEl
        activeAiChatPanelThreadId = panelThreadId
        activeAiChatPanelRegionNodeId = regionNode.nodeId
        activeAiChatPanelHadContent = hasContent
        paneEl.appendChild(panelEl)

        if (activeAiChatPanelWidth !== null) {
            applyActiveAiChatPanelWidth(activeAiChatPanelWidth)
        }

        requestAnimationFrame(() => {
            rail.style.setProperty('--rail-thread-height', `${measureActiveAiChatPanelRailThreadHeight(panelEl)}px`)
        })
    }

    // ---- Single floating input (for non-thread nodes) ----

    function createFloatingInput(): void {
        if (floatingInputEl) return

        const floatingInputStyle = { position: 'absolute' as const, display: 'none', zIndex: '9999', width: '400px' }
        floatingInputEl = html`<div className="ai-prompt-input-floating nopan" style=${floatingInputStyle}></div>` as HTMLDivElement

        // Add gradient background (controlled by settings flag)
        if (webUiSettings.useShiftingGradientBackgroundOnAiUserInputNode) {
            floatingInputGradient = createShiftingGradientBackground(floatingInputEl)
        }

        const editorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        floatingInputEl.appendChild(editorContainer)

        const controlFactories = {
            createModelDropdown: createGenericAiModelDropdown,
            createImageModelDropdown: createGenericImageModelDropdown,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createSubmitButton: createGenericSubmitButton,
        }

        floatingInputEditor = new ProseMirrorEditor({
            editorMountElement: editorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            threadId: null,
            onEditorChange: () => {},
            onProjectTitleChange: () => {},
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
            onPromptSubmit: (data: any) => {
                promptInputController.submitMessage({
                    contentJSON: data.contentJSON,
                    aiModel: data.aiModel,
                    imageOptions: data.imageOptions,
                })
            },
            onPromptStop: () => {
                promptInputController.stopStreaming()
            },
            isPromptReceiving: () => promptInputController.isReceiving(),
            promptControlFactories: controlFactories,
            onReceivingStateChange: () => {},
        })

        viewportEl.appendChild(floatingInputEl)
    }

    function showFloatingInput(nodeId: string): void {
        if (!floatingInputEl) createFloatingInput()
        if (!floatingInputEl || !currentCanvasState) return

        const targetCanvasNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        if (!targetCanvasNode) return

        const refId = (targetCanvasNode as any).referenceId || nodeId
        promptInputController.setTarget({
            nodeId,
            type: targetCanvasNode.type,
            referenceId: refId,
        })

        positionFloatingInput(targetCanvasNode)
        applyStyle(floatingInputEl, { display: 'block' })
    }

    function hideFloatingInput(): void {
        if (floatingInputEl) {
            applyStyle(floatingInputEl, { display: 'none' })
        }
        promptInputController.setTarget(null)
    }

    function positionFloatingInput(targetNode: CanvasNode): void {
        if (!floatingInputEl) return

        const inputX = targetNode.position.x
        const inputY = targetNode.position.y + (targetNode.dimensions?.height ?? 400) + 16

        applyStyle(floatingInputEl, {
            left: `${inputX}px`,
            top: `${inputY}px`,
            width: `${targetNode.dimensions?.width ?? 400}px`,
        })
    }

    // ---- Per-thread floating inputs (always visible for aiChatThread nodes) ----

    function createThreadFloatingInput(node: AiChatThreadCanvasNode, savedAttrs?: { aiModel?: string; aiImageModel?: string; imageGenerationSize?: string }): void {
        if (threadFloatingInputs.has(node.nodeId)) return

        const threadInputStyle = { position: 'absolute' as const, display: 'block', zIndex: '9999' }
        const el = html`<div
            className="ai-prompt-input-floating ai-prompt-input-thread-persistent nopan"
            style=${threadInputStyle}
            data=${{ threadNodeId: node.nodeId }}
        ></div>` as HTMLDivElement

        const gradient = webUiSettings.useShiftingGradientBackgroundOnAiUserInputNode
            ? createShiftingGradientBackground(el)
            : null

        const editorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        el.appendChild(editorContainer)

        const controlFactories = {
            createModelDropdown: createGenericAiModelDropdown,
            createImageModelDropdown: createGenericImageModelDropdown,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createSubmitButton: createGenericSubmitButton,
        }

        const threadId = node.referenceId
        const nodeId = node.nodeId

        const editor = new ProseMirrorEditor({
            editorMountElement: editorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            threadId,
            onEditorChange: () => {},
            onProjectTitleChange: () => {},
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
            onPromptSubmit: (data: any) => {
                promptInputController.setTarget({
                    nodeId,
                    type: 'aiChatThread',
                    referenceId: threadId,
                })
                promptInputController.submitMessage({
                    contentJSON: data.contentJSON,
                    aiModel: data.aiModel,
                    imageOptions: data.imageOptions,
                })
            },
            onPromptStop: () => {
                promptInputController.setTarget({
                    nodeId,
                    type: 'aiChatThread',
                    referenceId: threadId,
                })
                promptInputController.stopStreaming()
            },
            isPromptReceiving: () => promptInputController.isReceiving(threadId),
            promptControlFactories: controlFactories,
            onReceivingStateChange: () => {},
        })

        positionElementBelowNode(el, node)

        // Add bottom resize handles to the floating input (they control the thread node's height)
        el.appendChild(createResizeHandle(nodeId, 'bottom-left'))
        el.appendChild(createResizeHandle(nodeId, 'bottom-right'))

        viewportEl.appendChild(el)

        threadFloatingInputs.set(nodeId, {
            nodeId,
            threadId,
            el,
            editor,
            gradient,
        })

        // Restore saved dropdown attrs from the thread content
        if (savedAttrs) {
            const view = editor.editorView
            let inputPos: number | undefined
            view.state.doc.descendants((n: any, pos: number) => {
                if (n.type.name === 'aiPromptInput' && inputPos === undefined) inputPos = pos
            })
            if (inputPos !== undefined) {
                const node = view.state.doc.nodeAt(inputPos)
                if (node) {
                    const tr = view.state.tr.setNodeMarkup(inputPos, undefined, {
                        ...node.attrs,
                        ...savedAttrs,
                    })
                    tr.setMeta('skipDispatch', true)
                    view.dispatch(tr)
                }
            }
        }
    }

    // Returns the vertical offset from a thread node's top to where the floating
    // input should be placed. Hidden (empty) threads contribute 0 height.
    function getThreadTopOffset(nodeId: string, threadHeight: number): number {
        return hiddenEmptyThreadNodeIds.has(nodeId) ? 0 : threadHeight + 16
    }

    function positionElementBelowNode(el: HTMLElement, node: CanvasNode): void {
        applyStyle(el, {
            left: `${node.position.x}px`,
            top: `${node.position.y + getThreadTopOffset(node.nodeId, node.dimensions?.height ?? 400)}px`,
            width: `${node.dimensions?.width ?? 400}px`,
        })
    }

    function repositionAllThreadFloatingInputs(): void {
        if (!currentCanvasState) return
        for (const [nodeId, entry] of threadFloatingInputs) {
            const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
            if (node) {
                positionElementBelowNode(entry.el, node)
                repositionThreadRail(nodeId, node)
            }
        }
    }

    function createThreadRail(node: AiChatThreadCanvasNode): void {
        if (threadRails.has(node.nodeId)) return

        const railStyle = {
            position: 'absolute' as const,
            width: `${RAIL_GRAB_WIDTH}px`,
            zIndex: '9990',
        }
        const rail = html`<div
            className="workspace-thread-rail nopan"
            style=${railStyle}
            data=${{ threadNodeId: node.nodeId }}
        ></div>` as HTMLDivElement
        rail.style.setProperty('--rail-gradient', webUiThemeSettings.aiChatThreadRailGradient)
        rail.style.setProperty('--rail-width', webUiThemeSettings.aiChatThreadRailWidth)

        const line = html`<div className="workspace-thread-rail__line"></div>` as HTMLDivElement
        const bottomCircle = html`<div className="workspace-thread-rail__boundary-circle" innerHTML=${aiChatThreadRailBoundaryCircle}></div>` as HTMLDivElement
        const circlePaths = bottomCircle.querySelectorAll('path')
        const [outerColor, ringColor, innerColor] = webUiThemeSettings.aiChatThreadRailBoundaryCircleColors
        if (circlePaths[0]) circlePaths[0].setAttribute('fill', outerColor)
        if (circlePaths[1]) circlePaths[1].setAttribute('fill', ringColor)
        if (circlePaths[2]) circlePaths[2].setAttribute('fill', innerColor)
        line.appendChild(bottomCircle)

        rail.appendChild(line)

        rail.addEventListener('mousedown', (e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDragStart(e, node.nodeId)
        })

        repositionThreadRail(node.nodeId, node, rail)

        viewportEl.appendChild(rail)
        threadRails.set(node.nodeId, rail)
    }

    function repositionThreadRail(nodeId: string, node: CanvasNode, railEl?: HTMLElement): void {
        const rail = railEl ?? threadRails.get(nodeId)
        if (!rail) return

        const isHidden = hiddenEmptyThreadNodeIds.has(nodeId)
        const threadHeight = isHidden ? 0 : (node.dimensions?.height ?? 400)
        const gap = isHidden ? 0 : 16
        const floatingEntry = threadFloatingInputs.get(nodeId)
        const floatingHeight = floatingEntry ? floatingEntry.el.offsetHeight : 0
        const totalHeight = threadHeight + gap + floatingHeight

        applyStyle(rail, {
            left: `${node.position.x - RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`,
            top: `${node.position.y}px`,
            height: `${totalHeight}px`,
        })
        rail.style.setProperty('--rail-thread-height', `${threadHeight}px`)

        const boundaryCircle = rail.querySelector('.workspace-thread-rail__boundary-circle') as HTMLElement | null
        if (boundaryCircle) {
            applyStyle(boundaryCircle, { display: isHidden ? 'none' : '' })
        }

        connectionManager?.setRailHeight(nodeId, totalHeight)
    }

    function destroyAllThreadRails(): void {
        for (const [, rail] of threadRails) {
            rail.remove()
        }
        threadRails.clear()
        connectionManager?.clearRailHeights()
    }

    const AI_CHAT_THREAD_MIN_HEIGHT = 150

    function threadContentHasMessages(content: any): boolean {
        if (!content || typeof content !== 'object') return false
        const nodes = content.content
        if (!Array.isArray(nodes)) return false
        for (const node of nodes) {
            if (node.type === 'aiChatThread') {
                const children = node.content
                if (Array.isArray(children) && children.length > 0) return true
            }
        }
        return false
    }

    // Tracks thread nodes that are hidden because they have no messages yet
    const hiddenEmptyThreadNodeIds: Set<string> = new Set()

    function hideThreadNode(nodeEl: HTMLElement, nodeId: string): void {
        nodeEl.dataset.threadEmpty = 'true'
        hiddenEmptyThreadNodeIds.add(nodeId)
    }

    function showThreadNode(nodeEl: HTMLElement, nodeId: string): void {
        delete nodeEl.dataset.threadEmpty
        hiddenEmptyThreadNodeIds.delete(nodeId)
    }

    function updateThreadNodeVisibility(nodeId: string, threadNodeEl: HTMLElement, contentJSON?: any): void {
        // Check ProseMirror state (contentJSON) when available — the DOM isn't updated yet
        // during statePlugin.apply, so querying NodeViews would return stale results.
        const hasMessages = contentJSON
            ? threadContentHasMessages(contentJSON)
            : threadNodeEl.querySelector('.ai-user-message-wrapper, .ai-response-message-wrapper') !== null
        const wasHidden = hiddenEmptyThreadNodeIds.has(nodeId)

        if (hasMessages && wasHidden) {
            showThreadNode(threadNodeEl, nodeId)
            repositionAllThreadFloatingInputs()
            scheduleThreadAutoGrow(nodeId)
        } else if (!hasMessages && !wasHidden) {
            hideThreadNode(threadNodeEl, nodeId)
            repositionAllThreadFloatingInputs()
        }
    }

    function autoGrowThreadNode(threadNodeId: string): void {
        // Disabled for context region nodes.
        // Region height is driven entirely by its absolute-positioned
        // children via `expandRegionsToFitChildren()`. Setting height='auto' here
        // would collapse regions to 0 (or min-height) because their content is abs-pos.
    }

    function scheduleThreadAutoGrow(threadNodeId: string): void {
        // Disabled
    }

    function destroyAllThreadFloatingInputs(): void {
        for (const [, entry] of threadFloatingInputs) {
            entry.editor?.destroy?.()
            entry.gradient?.destroy()
            entry.el.remove()
        }
        threadFloatingInputs.clear()
    }

    // Set up callbacks for AI-generated images
    type PendingGeneratedImagePlacement = {
        sourceNodeId: string
        promptText: string
        branchId: string
        imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
        imageBranchResolution?: ImageBranchVlmResolution
        createdAt: number
    }

    // Tracks in-progress partial images per thread (threadId → canvas node info)
    const partialImageTracker = new Map<string, { nodeId: string; fileId: string; sourceNodeId: string }>()
    const pendingGeneratedImagePlacements = new Map<string, PendingGeneratedImagePlacement>()

    function findSourceThreadNode(threadId: string): ContextRegionNode | undefined {
        return currentCanvasState?.nodes.find(
            (n: CanvasNode): n is ContextRegionNode => isContextRegionCanvasNode(n) && n.referenceId === threadId
        )
    }

    function getGeneratedImageSourceNode(threadId: string, sourceThread: ContextRegionNode): CanvasNode {
        const pendingSourceNodeId = pendingGeneratedImagePlacements.get(threadId)?.sourceNodeId
        const sourceNode = currentCanvasState?.nodes.find((node: CanvasNode) => node.nodeId === pendingSourceNodeId)
        return sourceNode ?? sourceThread
    }

    function getThreadContentForBranchSnapshot(threadId: string): unknown {
        const editorDoc = threadEditors.get(threadId)?.editor?.editorView?.state?.doc
        if (editorDoc?.toJSON) return editorDoc.toJSON()
        return aiChatThreadsStore.getThread(threadId)?.content
    }

    function getGeneratedImageTextByNodeIdForThread(threadId: string): Record<string, string> {
        return getGeneratedImageTextByNodeIdFromThreadContent(
            getThreadContentForBranchSnapshot(threadId),
            currentCanvasState?.nodes ?? [],
            threadId
        )
    }

    function getGeneratedChildOutputs(sourceNode: CanvasNode, nodes: CanvasNode[], edges: WorkspaceEdge[]): ImageCanvasNode[] {
        return nodes.filter((node: CanvasNode): node is ImageCanvasNode => {
            if (node.type !== 'image' || node.parentId) return false
            if (!node.generatedBy) return false
            return edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === sourceNode.nodeId && edge.targetNodeId === node.nodeId)
        })
    }

    function getMostRecentGeneratedChildOutput(outputs: ImageCanvasNode[]): ImageCanvasNode | undefined {
        return [...outputs].sort((a: ImageCanvasNode, b: ImageCanvasNode) => {
            const createdAtDelta = (a.generatedBy?.createdAt ?? 0) - (b.generatedBy?.createdAt ?? 0)
            if (createdAtDelta !== 0) return createdAtDelta
            return a.position.x - b.position.x
        }).at(-1)
    }

    function getNextGeneratedImagePosition(sourceNode: CanvasNode, imageHeight: number): { x: number; y: number } {
        const nodes = currentCanvasState?.nodes || []
        if (isContextRegionCanvasNode(sourceNode)) {
            return getNextRegionOutputPosition(sourceNode, imageHeight, nodes)
        }

        const edges = currentCanvasState?.edges ?? []
        const existingChildOutputs = getGeneratedChildOutputs(sourceNode, nodes, edges)
        const previousOutput = getMostRecentGeneratedChildOutput(existingChildOutputs)
        const anchorRect = previousOutput ? getNodeWorldRect(previousOutput) : getNodeWorldRect(sourceNode)

        return {
            x: anchorRect.x + anchorRect.width + webUiThemeSettings.imageBranchLineage.imageToImageGap,
            y: anchorRect.y,
        }
    }

    function createGeneratedImageEdge(sourceNode: CanvasNode, imageNodeId: string, responseMessageId?: string): WorkspaceEdge {
        return {
            edgeId: `edge-${sourceNode.nodeId}-${imageNodeId}`,
            sourceNodeId: sourceNode.nodeId,
            targetNodeId: imageNodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
            ...(isContextRegionCanvasNode(sourceNode) && responseMessageId ? { sourceMessageId: responseMessageId } : {}),
        }
    }

    function getActiveImageTargetNodeIdForThread(threadId: string, regionNode: ContextRegionNode): string | undefined {
        const selectedNodeId = getSingleSelectedNodeId()
        if (!selectedNodeId) return undefined

        const selectedNode = currentCanvasState?.nodes.find((node: CanvasNode) => node.nodeId === selectedNodeId)
        if (selectedNode?.type !== 'image') return undefined

        const selectedImage = selectedNode as ImageCanvasNode
        if (selectedImage.generatedBy?.aiChatThreadId === threadId) return selectedImage.nodeId
        if (selectedImage.parentId === regionNode.nodeId) return selectedImage.nodeId
        if (currentCanvasState?.edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === selectedImage.nodeId && edge.targetNodeId === regionNode.nodeId)) return selectedImage.nodeId

        return undefined
    }

    function rememberGeneratedImagePlacement(threadId: string, regionNode: ContextRegionNode, messages: any[], hasImageModel: boolean): { promptText: string; imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot } {
        if (!hasImageModel) {
            pendingGeneratedImagePlacements.delete(threadId)
            return { promptText: '' }
        }

        const promptText = getPromptTextFromMessages(messages)
        const activeTargetNodeId = getActiveImageTargetNodeIdForThread(regionNode.referenceId, regionNode)
        const imageBranchCandidateSnapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: regionNode.nodeId,
            threadId: regionNode.referenceId,
            activeTargetNodeId,
            nodes: currentCanvasState?.nodes ?? [],
            edges: currentCanvasState?.edges ?? [],
            prompt: promptText,
            generatedImageTextByNodeId: getGeneratedImageTextByNodeIdForThread(regionNode.referenceId),
        })
        const branchId = `branch-${uuidv4()}`
        pendingGeneratedImagePlacements.set(threadId, {
            sourceNodeId: regionNode.nodeId,
            promptText,
            branchId,
            imageBranchCandidateSnapshot,
            createdAt: Date.now(),
        })
        console.info('[CANVAS] image branch candidate snapshot', {
            threadId,
            candidateCount: imageBranchCandidateSnapshot.candidates.length,
            promptFingerprint: imageBranchCandidateSnapshot.promptFingerprint,
            activeTargetNodeId: imageBranchCandidateSnapshot.activeTargetNodeId,
            candidateNodeIds: imageBranchCandidateSnapshot.candidates.map((candidate: ImageBranchCandidateSnapshot['candidates'][number]) => candidate.nodeId),
        })
        return { promptText, imageBranchCandidateSnapshot }
    }

    function getPendingGeneratedImageLineage(threadId: string, existingGeneratedBy?: ImageCanvasNode['generatedBy']): Partial<NonNullable<ImageCanvasNode['generatedBy']>> {
        const placement = pendingGeneratedImagePlacements.get(threadId)
        if (!placement) return {}

        const resolution = placement.imageBranchResolution
        const parentImageNodeId = resolution?.targetImageNodeId ?? resolution?.parentImageNodeId

        return {
            branchId: existingGeneratedBy?.branchId ?? resolution?.branchId ?? placement.branchId,
            parentImageNodeId: existingGeneratedBy?.parentImageNodeId ?? parentImageNodeId ?? undefined,
            sourceContextNodeIds: resolution?.sourceContextNodeIds ?? [],
            referenceImageNodeIds: resolution?.referenceImageNodeIds ?? [],
            operationKind: resolution?.operationKind ?? 'new_image',
            promptText: placement.promptText,
            promptFingerprint: placement.imageBranchCandidateSnapshot?.promptFingerprint,
            visualEntitySummary: resolution?.visualEntitySummary,
            visualStyleSummary: resolution?.visualStyleSummary,
            entitySummary: resolution?.visualEntitySummary,
            entityTags: resolution?.entityTags ?? [],
            styleTags: resolution?.styleTags ?? [],
            targetImageNodeId: resolution?.targetImageNodeId ?? undefined,
            styleReferenceNodeIds: resolution?.styleReferenceNodeIds ?? [],
            excludedNodeIds: resolution?.excludedNodeIds ?? [],
            resolverKind: resolution?.resolverKind,
            resolverModelProvider: resolution?.resolverModelProvider,
            resolverModelId: resolution?.resolverModelId,
            resolverRationale: resolution?.rationale,
            resolverConfidence: resolution?.confidence,
            resolverVersion: resolution?.resolverVersion ?? placement.imageBranchCandidateSnapshot?.resolverVersion,
            createdAt: existingGeneratedBy?.createdAt ?? placement.createdAt,
        }
    }

    function buildImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {
        if (!imageUrl) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        if (imageUrl.startsWith('data:')) return imageUrl
        if (imageUrl.startsWith('/api/')) return `${apiBaseUrl}${imageUrl}${token ? `?token=${token}` : ''}`
        if (imageUrl.startsWith('http') && imageUrl.includes('/api/images/')) return `${imageUrl}${token ? `?token=${token}` : ''}`
        if (imageUrl.startsWith('http')) return imageUrl
        return `data:image/png;base64,${imageUrl}`
    }

    function showImageErrorPlaceholder(imgEl: HTMLImageElement, nodeEl: HTMLElement): void {
        applyStyle(imgEl, { display: 'none' })
        if (nodeEl.querySelector('.image-error-placeholder')) return

        nodeEl.appendChild(html`
            <div className="image-error-placeholder">
                <span innerHTML=${brokenImageIcon}></span>
                <span>Image unavailable</span>
            </div>
        `)
    }

    // Append an image node to the DOM directly without a full renderNodes() cycle.
    // This preserves active editors and their streaming state.
    function appendImageNodeToDOM(imageNode: ImageCanvasNode): void {
        const nodeEl = createImageNode(imageNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(imageNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
    }

    // Persist canvas state without triggering a full re-render.
    // Updates internal state + persists via callback, then immediately updates the
    // structure key so the Svelte $effect's render() call sees no structural change
    // and skips renderNodes(). The caller manages DOM updates manually.
    function commitCanvasStatePreservingEditors(nextState: CanvasState): void {
        commitCanvasState(nextState)
        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    }

    function commitCanvasMetadataState(nextState: CanvasState): void {
        currentCanvasState = nextState
        onCanvasStateChange?.(nextState)
    }

    setAiGeneratedImageCallbacks({
        onAddToCanvas: async (data) => {
            const { imageUrl, fileId, responseId, revisedPrompt, aiModel } = data

            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()

            const existingNodes = currentCanvasState?.nodes || []
            // Try to find the specific source thread (best effort — legacy path doesn't have threadId)
            let sourceThreadNode: ContextRegionNode | undefined
            for (const n of existingNodes) {
                if (isContextRegionCanvasNode(n)) {
                    sourceThreadNode = n
                    break
                }
            }

            const width = getGeneratedImageInsertionSize()
            const height = width
            const position = sourceThreadNode
                ? getNextRegionOutputPosition(sourceThreadNode, height, existingNodes)
                : getCenteredInsertionPosition({ width, height })

            const imageNode: ImageCanvasNode = {
                nodeId: `node-${fileId}`,
                type: 'image',
                fileId,
                workspaceId,
                src: `${API_BASE_URL}${imageUrl}?token=${token}`,
                aspectRatio: 1,
                position,
                dimensions: { width, height },
                generatedBy: {
                    aiChatThreadId: sourceThreadNode?.referenceId ?? '',
                    responseId,
                    aiModel: aiModel as any,
                    revisedPrompt,
                    responseMessageId: '',
                }
            }

            const newEdges: WorkspaceEdge[] = sourceThreadNode
                ? [
                    ...(currentCanvasState?.edges ?? []),
                    {
                        edgeId: `edge-${sourceThreadNode.nodeId}-${imageNode.nodeId}`,
                        sourceNodeId: sourceThreadNode.nodeId,
                        targetNodeId: imageNode.nodeId,
                        sourceHandle: 'right',
                        targetHandle: 'left',
                    },
                ]
                : currentCanvasState?.edges ?? []

            const newCanvasState: CanvasState = {
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: newEdges,
                nodes: [...existingNodes, imageNode]
            }

            onCanvasStateChange?.(newCanvasState)
        },

        onImageBranchResolvedToCanvas: ({ threadId, resolution }) => {
            const placement = pendingGeneratedImagePlacements.get(threadId)
            if (!placement) return

            const sourceNodeId = resolution.targetImageNodeId ?? resolution.parentImageNodeId ?? placement.sourceNodeId
            pendingGeneratedImagePlacements.set(threadId, {
                ...placement,
                sourceNodeId,
                branchId: resolution.branchId ?? placement.branchId,
                imageBranchResolution: resolution,
            })

            console.info('[CANVAS] image branch VLM resolution', {
                threadId,
                mode: resolution.mode,
                sourceNodeId,
                branchId: resolution.branchId,
                operationKind: resolution.operationKind,
                referenceImageNodeIds: resolution.referenceImageNodeIds,
                excludedNodeIds: resolution.excludedNodeIds,
                confidence: resolution.confidence,
                rationale: resolution.rationale,
            })
        },

        onImageBranchResolutionErrorToCanvas: ({ threadId }) => {
            pendingGeneratedImagePlacements.delete(threadId)
        },

        onImageErrorToCanvas: ({ threadId }) => {
            pendingGeneratedImagePlacements.delete(threadId)
            const existing = partialImageTracker.get(threadId)
            if (!existing || !currentCanvasState) return

            partialImageTracker.delete(threadId)
            selectedNodeIds.delete(existing.nodeId)

            // Show error placeholder on the node so the user sees what failed,
            // then remove it from the canvas state (and DOM) after a short delay.
            const nodeEl = viewportEl?.querySelector(`[data-node-id="${existing.nodeId}"]`) as HTMLElement | null
            const spinnerEl = nodeEl?.querySelector('.image-generating-spinner')
            if (spinnerEl) spinnerEl.remove()
            const borderSvg = nodeEl?.querySelector('.image-generating-border')
            if (borderSvg) borderSvg.remove()
            const imgEl = nodeEl?.querySelector('img.image-node-img') as HTMLImageElement | null
            if (nodeEl && imgEl) showImageErrorPlaceholder(imgEl, nodeEl)

            const errorNodeId = existing.nodeId
            setTimeout(() => {
                if (!currentCanvasState) return
                const nextState: CanvasState = {
                    viewport: currentCanvasState.viewport,
                    nodes: currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== errorNodeId),
                    edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                        edge.sourceNodeId !== errorNodeId && edge.targetNodeId !== errorNodeId
                    ),
                }
                commitCanvasStatePreservingEditors(nextState)
                nodeEl?.remove()
            }, 4000)
        },

        onImagePartialToCanvas: async (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId } = data

            // Check tracker SYNCHRONOUSLY before any await to prevent race with onImageCompleteToCanvas
            const existing = partialImageTracker.get(threadId)

            if (existing) {
                // Subsequent partial — update DOM directly, no canvas state change
                const token = await AuthService.getTokenSilently()
                const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                const imgEl = viewportEl?.querySelector(`[data-node-id="${existing.nodeId}"] img.image-node-img`) as HTMLImageElement | null
                if (imgEl && imageUrl) {
                    imgEl.src = buildImageSrc(imageUrl, API_BASE_URL, token)
                    // Remove the spinner once real image data arrives
                    const spinnerEl = viewportEl?.querySelector(`[data-node-id="${existing.nodeId}"] .image-generating-spinner`)
                    if (spinnerEl) spinnerEl.remove()
                }
                partialImageTracker.set(threadId, { ...existing, fileId: fileId || existing.fileId })
                return
            }

            // First partial for this thread — register in tracker IMMEDIATELY before await
            const sourceThread = findSourceThreadNode(threadId)
            if (!sourceThread) return
            const sourceNode = getGeneratedImageSourceNode(threadId, sourceThread)
            const promptText = pendingGeneratedImagePlacements.get(threadId)?.promptText ?? ''

            const nodeId = `node-${fileId || uuidv4()}`
            partialImageTracker.set(threadId, { nodeId, fileId: fileId || '', sourceNodeId: sourceNode.nodeId })

            const token = await AuthService.getTokenSilently()
            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const imageSrc = buildImageSrc(imageUrl, API_BASE_URL, token)

            const imageWidth = getGeneratedImageInsertionSize()
            const imageHeight = imageWidth
            const position = getNextGeneratedImagePosition(sourceNode, imageHeight)

            const imageNode: ImageCanvasNode = {
                nodeId,
                type: 'image',
                fileId: fileId || '',
                workspaceId: imgWorkspaceId || workspaceId,
                src: imageSrc,
                aspectRatio: 1,
                position,
                dimensions: { width: imageWidth, height: imageHeight },
                generatedBy: {
                    aiChatThreadId: threadId,
                    responseId: '',
                    aiModel: '' as any,
                    revisedPrompt: promptText,
                    responseMessageId: '',
                    ...getPendingGeneratedImageLineage(threadId),
                }
            }

            const existingNodes = currentCanvasState?.nodes || []
            const existingEdges = currentCanvasState?.edges || []

            const newEdges = [
                ...existingEdges,
                createGeneratedImageEdge(sourceNode, nodeId),
            ]

            const newCanvasState: CanvasState = {
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                nodes: [...existingNodes, imageNode],
                edges: newEdges,
            }
            commitCanvasStatePreservingEditors(newCanvasState)
            appendImageNodeToDOM(imageNode)
        },

        onImageCompleteToCanvas: async (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, responseId, revisedPrompt, aiModel, imageModelProvider, responseMessageId } = data

            // Read tracker SYNCHRONOUSLY before any await
            const partial = partialImageTracker.get(threadId)

            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()
            const imageSrc = buildImageSrc(imageUrl, API_BASE_URL, token)

            if (partial) {
                const promptText = pendingGeneratedImagePlacements.get(threadId)?.promptText ?? ''
                // Upgrade existing partial canvas node to complete
                const nodes = (currentCanvasState?.nodes || []).map((n: CanvasNode) => {
                    if (n.nodeId !== partial.nodeId) return n
                    const imgNode = n as ImageCanvasNode
                    return {
                        ...imgNode,
                        fileId: fileId || imgNode.fileId,
                        workspaceId: imgWorkspaceId || imgNode.workspaceId,
                        src: imageSrc,
                        generatedBy: {
                            aiChatThreadId: threadId,
                            responseId,
                            aiModel: aiModel as any,
                            imageModelProvider: imageModelProvider || '',
                            revisedPrompt: revisedPrompt || imgNode.generatedBy?.revisedPrompt || promptText,
                            responseMessageId: responseMessageId || '',
                            ...getPendingGeneratedImageLineage(threadId, imgNode.generatedBy),
                        },
                    } satisfies ImageCanvasNode
                })

                const edges = (currentCanvasState?.edges || []).map((e: WorkspaceEdge) => {
                    if (e.targetNodeId !== partial.nodeId) return e
                    const sourceNode = (currentCanvasState?.nodes || []).find((node: CanvasNode) => node.nodeId === e.sourceNodeId)
                    if (sourceNode && isContextRegionCanvasNode(sourceNode)) {
                        return { ...e, sourceMessageId: responseMessageId || undefined }
                    }
                    const { sourceMessageId: _sourceMessageId, ...edgeWithoutSourceMessageId } = e
                    return edgeWithoutSourceMessageId
                })

                partialImageTracker.delete(threadId)
                pendingGeneratedImagePlacements.delete(threadId)

                // Remove the animated generating border and spinner
                const borderSvg = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"] .image-generating-border`)
                if (borderSvg) borderSvg.remove()
                const spinnerEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"] .image-generating-spinner`)
                if (spinnerEl) spinnerEl.remove()
                const collisionExclusions = new Set<string>()
                for (const child of nodes) {
                    if (child.parentId) collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                }
                const collisionPlan = createShapeAwareCollisionPlan(nodes)
                const collisionResult = resolveCollisions(collisionPlan.nodeBoxes, {
                    excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined,
                    shouldResolvePair: collisionPlan.shouldResolvePair,
                })

                const resolvedNodes = collisionResult.hasChanges
                    ? nodes.map((n: CanvasNode) => {
                        const resolved = collisionResult.nodes.get(n.nodeId)
                        if (!resolved) return n
                        const resolvedPosition = getResolvedNodePositionFromCollisionBox(n, resolved, collisionPlan.entries)
                        const position = n.parentId
                            ? toParentRelativePosition(resolvedPosition, n.parentId, getCanvasNodesById(nodes))
                            : resolvedPosition
                        return { ...n, position }
                    })
                    : nodes

                commitCanvasState({
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges,
                })

                // Update the existing DOM image src directly
                const imgEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"] img.image-node-img`) as HTMLImageElement | null
                if (imgEl) imgEl.src = imageSrc

            } else {
                // No partial existed — IMAGE_COMPLETE without prior IMAGE_PARTIAL.
                // Guard against duplicates: skip if this fileId is already on canvas
                if (fileId && currentCanvasState?.nodes.some((n: CanvasNode) => n.type === 'image' && (n as ImageCanvasNode).fileId === fileId)) {
                    return
                }

                const sourceThread = findSourceThreadNode(threadId)
                if (!sourceThread) return
                const sourceNode = getGeneratedImageSourceNode(threadId, sourceThread)
                const promptText = pendingGeneratedImagePlacements.get(threadId)?.promptText ?? ''

                const nodeId = `node-${fileId || uuidv4()}`

                const imageWidth = getGeneratedImageInsertionSize()
                const imageHeight = imageWidth
                const position = getNextGeneratedImagePosition(sourceNode, imageHeight)

                const imageNode: ImageCanvasNode = {
                    nodeId,
                    type: 'image',
                    fileId: fileId || '',
                    workspaceId: imgWorkspaceId || workspaceId,
                    src: imageSrc,
                    aspectRatio: 1,
                    position,
                    dimensions: { width: imageWidth, height: imageHeight },
                    generatedBy: {
                        aiChatThreadId: threadId,
                        responseId,
                        aiModel: aiModel as any,
                        imageModelProvider: imageModelProvider || '',
                        revisedPrompt: revisedPrompt || promptText,
                        responseMessageId: responseMessageId || '',
                        ...getPendingGeneratedImageLineage(threadId),
                    },
                }

                const existingNodes = currentCanvasState?.nodes || []
                const existingEdges = currentCanvasState?.edges || []

                const newEdges = [
                    ...existingEdges,
                    createGeneratedImageEdge(sourceNode, nodeId, responseMessageId || undefined),
                ]

                const allNodes: CanvasNode[] = [...existingNodes, imageNode]

                const collisionExclusions = new Set<string>()
                for (const child of allNodes) {
                    if (child.parentId) collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                }
                const collisionPlan = createShapeAwareCollisionPlan(allNodes)
                const collisionResult = resolveCollisions(collisionPlan.nodeBoxes, {
                    excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined,
                    shouldResolvePair: collisionPlan.shouldResolvePair,
                })

                const resolvedNodes = collisionResult.hasChanges
                    ? allNodes.map((n: CanvasNode) => {
                        const resolved = collisionResult.nodes.get(n.nodeId)
                        if (!resolved) return n
                        const resolvedPosition = getResolvedNodePositionFromCollisionBox(n, resolved, collisionPlan.entries)
                        const position = n.parentId
                            ? toParentRelativePosition(resolvedPosition, n.parentId, getCanvasNodesById(allNodes))
                            : resolvedPosition
                        return { ...n, position }
                    })
                    : allNodes

                const resolvedImageNode = collisionResult.hasChanges
                    ? resolvedNodes.find((node: CanvasNode) => node.nodeId === nodeId) as ImageCanvasNode | undefined ?? imageNode
                    : imageNode

                currentCanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges: newEdges,
                }
                appendImageNodeToDOM(resolvedImageNode)

                commitCanvasStatePreservingEditors(currentCanvasState)
                pendingGeneratedImagePlacements.delete(threadId)
            }
        },

        onEditInNewThread: async (responseId) => {
            // Create a new AI chat thread specifically for editing this image
            const aiChatThreadService = servicesStore.getData('aiChatThreadService')
            if (!aiChatThreadService) {
                console.error('AI Chat Thread service not available')
                return
            }

            try {
                // Generate threadId on frontend to ensure content and DB record match
                const threadId = uuidv4()

                // Create empty AI chat thread with reference to the source image
                const initialContent = {
                    type: 'doc',
                    content: [
                        {
                            type: 'documentTitle',
                            content: [{ type: 'text', text: 'Edit Image' }]
                        },
                        {
                            type: 'aiChatThread',
                            attrs: {
                                threadId,
                                // Store the previous response ID for multi-turn editing
                                previousResponseId: responseId
                            },
                            content: [
                                {
                                    type: 'aiUserMessage',
                                    attrs: { id: uuidv4(), createdAt: Date.now() },
                                    content: [
                                        {
                                            type: 'paragraph',
                                            content: [{ type: 'text', text: 'Describe how you want to edit this image...' }]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }

                const thread = await aiChatThreadService.createAiChatThread({
                    workspaceId,
                    threadId,
                    content: initialContent,
                    aiModel: 'openai:gpt-4o' // Default to OpenAI for image editing
                })

                if (thread) {
                    // Find the source image node to position the new thread next to it
                    const existingNodes = currentCanvasState?.nodes || []
                    let sourceImageNode: CanvasNode | undefined
                    for (const n of existingNodes) {
                        if (n.type === 'image' && (n as ImageCanvasNode).generatedBy?.responseId === responseId) {
                            sourceImageNode = n
                            break
                        }
                    }

                    const threadDimensions = { ...webUiThemeSettings.contextRegion.defaultDimensions }
                    const fallbackPosition = getCenteredInsertionPosition(threadDimensions)
                    const sourceImageRect = sourceImageNode ? getNodeWorldRect(sourceImageNode) : null
                    const threadPosition = sourceImageRect
                        ? { x: sourceImageRect.x + sourceImageRect.width + webUiThemeSettings.contextRegion.adjacentNodeGap, y: sourceImageRect.y }
                        : fallbackPosition

                    const threadNode: ContextRegionCanvasNode = {
                        nodeId: `node-${thread.threadId}`,
                        type: 'contextRegion',
                        referenceId: thread.threadId,
                        position: threadPosition,
                        dimensions: threadDimensions,
                    }

                    const newCanvasState: CanvasState = {
                        viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                        edges: currentCanvasState?.edges ?? [],
                        nodes: resolveTopLevelNodeCollisions([...existingNodes, threadNode])
                    }

                    // Create edge from source image to edit thread if we found the source
                    if (sourceImageNode) {
                        const newEdge: WorkspaceEdge = {
                            edgeId: `edge-${sourceImageNode.nodeId}-${threadNode.nodeId}`,
                            sourceNodeId: sourceImageNode.nodeId,
                            targetNodeId: threadNode.nodeId,
                            sourceHandle: 'right',
                            targetHandle: 'left'
                        }
                        newCanvasState.edges = [...(newCanvasState.edges || []), newEdge]
                    }

                    onCanvasStateChange?.(newCanvasState)
                    activeAiChatThreadId = thread.threadId
                    activeAiChatRegionNodeId = threadNode.nodeId
                    requestAnimationFrame(() => {
                        renderActiveAiChatPanel(threadNode, thread)
                    })

                }
            } catch (error) {
                console.error('Failed to create edit thread:', error)
            }
        }
    })

    // Visibility detection for lazy loading
    function isNodeInViewport(node: CanvasNode, viewport: Viewport): boolean {
        if (!paneRect) {
            paneRect = paneEl.getBoundingClientRect()
        }

        const { x, y, zoom } = viewport
        const worldRect = getNodeWorldRect(node)

        // Transform node coordinates to screen space
        const screenLeft = worldRect.x * zoom + x
        const screenTop = worldRect.y * zoom + y
        const screenRight = screenLeft + worldRect.width * zoom
        const screenBottom = screenTop + worldRect.height * zoom

        // Check intersection with pane bounds
        return !(
            screenRight < 0 ||
            screenLeft > paneRect.width ||
            screenBottom < 0 ||
            screenTop > paneRect.height
        )
    }

    function updateVisibleNodes() {
        if (!currentCanvasState) return

        const viewport = panZoom?.getViewport() || { x: 0, y: 0, zoom: 1 }
        // Use cached paneRect (updated by ResizeObserver) to avoid forced layout reflow
        if (!paneRect) paneRect = paneEl.getBoundingClientRect()

        for (const node of currentCanvasState.nodes) {
            const wasVisible = visibleNodeIds.has(node.nodeId)
            const isVisible = isNodeInViewport(node, viewport)

            if (isVisible && !wasVisible) {
                visibleNodeIds.add(node.nodeId)
            } else if (!isVisible && wasVisible) {
                visibleNodeIds.delete(node.nodeId)
            }
        }
    }

    // Track pane bounds on resize for visibility detection
    const resizeObserver = new ResizeObserver(() => {
        paneRect = paneEl.getBoundingClientRect()
        if (activeAiChatPanelWidth !== null) {
            applyActiveAiChatPanelWidth(activeAiChatPanelWidth)
        }
        if (activeAiChatPanelEl) {
            const panelRail = activeAiChatPanelEl.querySelector<HTMLElement>('.workspace-ai-chat-floating-panel__rail')
            if (panelRail) {
                panelRail.style.setProperty('--rail-thread-height', `${measureActiveAiChatPanelRailThreadHeight(activeAiChatPanelEl)}px`)
            }
        }
        updateVisibleNodes()
    })
    resizeObserver.observe(paneEl)

    const panZoomConfig = {
        ...defaultPanZoomConfig((transform) => {
            const zoomChanged = transform[2] !== lastTransform[2]
            if (nodePointerPanLockNodeId || draggingNodeId || resizingNodeId) {
                const lockedViewport = { x: lastTransform[0], y: lastTransform[1], zoom: lastTransform[2] }
                panZoom?.syncViewport(lockedViewport)
                return
            }
            const vp: Viewport = { x: transform[0], y: transform[1], zoom: transform[2] }
            syncViewportInteractionState(vp)
            updateCurrentCanvasViewport(vp)
            // ONLY write the CSS transform here — nothing else.
            // Any other DOM mutation (custom properties, style writes, querySelectorAll)
            // invalidates the compositor layer cache and forces a full re-rasterization
            // of every image/text in the viewport, causing visible flickering.
            viewportBridge?.applyViewport(vp)
            if (zoomChanged) {
                if (webUiSettings.useZoomCompensatedResizeHandleScaling) {
                    pendingHandleZoom = vp.zoom
                }
                if (webUiSettings.useZoomCompensatedConnectorScaling) {
                    // Recompute and flush the connector canvas in the same turn as the DOM
                    // viewport transform. If the pan/zoom callback runs inside a rAF, waiting
                    // for PIXI's scheduled rAF lets the browser paint one frame where nodes
                    // have moved but connectors still show the previous canvas bitmap.
                    const pixiEdgesRecomputed = connectionManager?.recomputePixiEdgesOnly(vp.zoom) ?? false
                    if (pixiEdgesRecomputed) pixiMediaLayer?.renderNow()
                    scheduleEdgesRender()
                }
            }
            // Defer all layout-forcing DOM work to a separate frame
            scheduleTransformSideEffects()
            onViewportChange?.(vp)
        }),
        ...options.panZoomConfig
    }

    function suspendPanZoomForNodePointer(nodeId: string): void {
        nodePointerPanLockNodeId = nodeId
        if (!paneEl.classList.contains('nopan')) {
            paneEl.classList.add('nopan')
            paneNoPanAddedForNodePointer = true
        }
        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true,
                selectionOnDrag: false,
            })
        }
    }

    function releasePanZoomForNodePointer(): void {
        if (!nodePointerPanLockNodeId && !paneNoPanAddedForNodePointer) return
        nodePointerPanLockNodeId = null
        if (paneNoPanAddedForNodePointer) {
            paneEl.classList.remove('nopan')
            paneNoPanAddedForNodePointer = false
        }
        panZoom?.update(panZoomConfig)
    }

    function selectNode(nodeId: string | null) {
        setSelectedNodes(nodeId ? new Set([nodeId]) : new Set())
    }

    function createResizeHandle(nodeId: string, corner: ResizeCorner): HTMLElement {
        const handle = html`<div
            className=${`document-resize-handle document-resize-${corner} nopan`}
            innerHTML=${imageResizeCornerIcon}
            data=${{ corner }}
            onmousedown=${(e: MouseEvent) => handleResizeStart(e, nodeId, corner)}
        ></div>` as HTMLDivElement

        // Initialize sizing/position so newly created handles are correct immediately
        const currentZoom = currentCanvasState?.viewport?.zoom ?? 1
        applyHandleSizing(handle, corner, currentZoom)

        return handle
    }

    function createBaseNodeElement(
        node: CanvasNode,
        extraClasses?: string,
        extraDataAttrs?: Record<string, string>
    ): { nodeEl: HTMLElement; dragOverlay: HTMLElement } {
        const isContextRegion = isContextRegionCanvasNode(node) && Boolean(extraClasses?.includes('workspace-context-region-node'))
        const nodeWorldPosition = getNodeWorldPosition(node)
        const nodeElStyle = {
            position: 'absolute' as const,
            left: `${nodeWorldPosition.x}px`,
            top: `${nodeWorldPosition.y}px`,
            width: `${node.dimensions.width}px`,
            height: `${node.dimensions.height}px`,
            zIndex: isContextRegion
                ? String(nodeLayerManager.backgroundIndex())
                : String(nodeLayerManager.currentTopIndex()),
        }
        const nodeEl = html`<div
            className=${`workspace-document-node${extraClasses ? ` ${extraClasses}` : ''}`}
            data=${{ nodeId: node.nodeId, ...extraDataAttrs }}
            style=${nodeElStyle}
        ></div>` as HTMLDivElement

        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation()
            if (suppressNextNodeClick) {
                suppressNextNodeClick = false
                return
            }

            // Don't trigger node selection when clicking inside editor content
            // (ProseMirror, contenteditable areas) — let the editor handle the click
            const clickTarget = e.target as HTMLElement | null
            if (clickTarget && (
                clickTarget.isContentEditable ||
                clickTarget.closest('.ProseMirror') ||
                clickTarget.closest('.ai-chat-thread-wrapper')
            )) {
                return
            }

            if (isContextRegion) return

            if (isModSelectionEvent(e)) {
                toggleNodeSelection(node.nodeId)
                return
            }

            selectNode(node.nodeId)
        })

        if (!isContextRegion) {
            for (const corner of RESIZE_CORNERS) {
                // Legacy embedded thread nodes keep bottom handles on the floating input.
                if (node.type === 'aiChatThread' && corner.startsWith('bottom')) continue
                nodeEl.appendChild(createResizeHandle(node.nodeId, corner))
            }
        }

        const dragOverlay = html`<div className="node-drag-overlay nopan" onmousedown=${(e: MouseEvent) => handleDragStart(e, node.nodeId, isContextRegion ? { suppressPaneClick: true } : {})}></div>` as HTMLDivElement
        nodeEl.appendChild(dragOverlay)

        return { nodeEl, dragOverlay }
    }

    function commitCanvasState(nextState: CanvasState) {
        // Track image changes and delete orphaned images from storage
        canvasImageLifecycle.trackCanvasState(nextState)
        currentCanvasState = nextState
        pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(nextState)
        onCanvasStateChange?.(nextState)

        connectionManager?.syncEdges(nextState.edges)
        connectionManager?.syncNodes(getNodesForConnectionManager(nextState.nodes))
        scheduleEdgesRender()
        syncPixiMediaLayer(nextState)
        syncContextRegionLayer(nextState)
        lastVisualSyncKey = getCanvasVisualSyncKey(nextState)
    }

    function scheduleTransformSideEffects() {
        if (transformSideEffectsRaf !== null) return
        transformSideEffectsRaf = requestAnimationFrame(() => {
            transformSideEffectsRaf = null
            if (pendingHandleZoom !== null) {
                updateResizeHandles(pendingHandleZoom)
                pendingHandleZoom = null
            }
            repositionCanvasBubbleMenu()
            repositionEdgeBubbleMenu()
        })
    }

    function scheduleEdgesRender() {
        if (!connectionManager || !currentCanvasState) return
        if (edgesRaf !== null) return

        edgesRaf = requestAnimationFrame(() => {
            edgesRaf = null

            if (!connectionManager || !currentCanvasState) return

            const nodesForEdges = getNodesForConnectionManager(currentCanvasState.nodes)
            connectionManager.syncNodes(nodesForEdges)
            connectionManager.syncEdges(currentCanvasState.edges)
            connectionManager.render()
            repositionEdgeBubbleMenu()
        })
    }

    function ensureConnectionManager() {
        if (connectionManager) {
            return
        }

        connectionManager = new WorkspaceConnectionManager({
            paneEl,
            viewportEl,
            getTransform: () => lastTransform,
            railOffset: RAIL_OFFSET,
            panBy: async ({ x, y }) => {
                if (!panZoom) return false
                const vp = panZoom.getViewport()
                await panZoom.setViewport({ ...vp, x: vp.x + x, y: vp.y + y, zoom: vp.zoom })
                return true
            },
            onEdgesChange: (edges) => {
                if (!currentCanvasState) return
                commitCanvasState({
                    ...currentCanvasState,
                    edges
                })
            },
            onSelectedEdgeChange: (edgeId) => {
                selectedEdgeId = edgeId
                if (edgeId) {
                    selectNode(null)
                    showEdgeBubbleMenu(edgeId)
                } else {
                    hideEdgeBubbleMenu()
                }
            },
            isContextRegionNode: isContextRegionCanvasNode,
            onPixiEdgesReady: (edges) => {
                pixiMediaLayer?.setPixiEdges(edges)
            },
        })

        if (currentCanvasState) {
            connectionManager.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
            connectionManager.syncEdges(currentCanvasState.edges)
            if (selectedEdgeId) {
                connectionManager.selectEdge(selectedEdgeId)
            }
            scheduleEdgesRender()
        }
    }

    function createConnectionHandle(params: {
        nodeId: string
        handleId: string
        handleType: 'source' | 'target'
        position: 'left' | 'right'
        onPointerDown?: (e: MouseEvent) => void
    }): HTMLDivElement {
        const handle = html`<div
            className="workspace-handle nopan connectable connectableend xy-flow__handle ${params.handleType} ${params.position}"
            data=${{ nodeid: params.nodeId, handleid: params.handleId, handlepos: params.position, id: `workspace-${params.nodeId}-${params.handleId}-${params.handleType}` }}
        ></div>` as HTMLDivElement

        if (params.onPointerDown) {
            handle.addEventListener('mousedown', (e) => {
                params.onPointerDown?.(e)
            })
        }

        return handle
    }

    function addConnectionHandlesToNode(nodeEl: HTMLElement, nodeId: string) {
        const left = createConnectionHandle({
            nodeId,
            handleId: 'left',
            handleType: 'target',
            position: 'left',
            onPointerDown: (e) => {
                if (!connectionManager) return
                connectionManager.onHandlePointerDown(e, {
                    nodeId,
                    handleId: 'left',
                    isTarget: true,
                    handleDomNode: left
                })
            }
        })

        const right = createConnectionHandle({
            nodeId,
            handleId: 'right',
            handleType: 'source',
            position: 'right',
            onPointerDown: (e) => {
                if (!connectionManager) return
                connectionManager.onHandlePointerDown(e, {
                    nodeId,
                    handleId: 'right',
                    isTarget: false,
                    handleDomNode: right
                })
            }
        })

        nodeEl.appendChild(left)
        nodeEl.appendChild(right)
    }

    // Handle sizing/positioning of resize handles so they appear constant in screen pixels
    function applyHandleSizing(handle: HTMLElement, corner: ResizeCorner, zoom: number) {
        const { size: sizePx, offset: offsetPx } = webUiSettings.useZoomCompensatedResizeHandleScaling
            ? getResizeHandleScaledSizes(zoom)
            : { size: 24, offset: 6 }

        applyStyle(handle, { width: `${sizePx}px`, height: `${sizePx}px` })

        // Reset positional properties first
        applyStyle(handle, { top: '', left: '', right: '', bottom: '' })

        const pos = { top: '', left: '', right: '', bottom: '' }
        switch (corner) {
            case 'top-left':     pos.top = `${-offsetPx}px`; pos.left   = `${-offsetPx}px`; break
            case 'top-right':    pos.top = `${-offsetPx}px`; pos.right  = `${-offsetPx}px`; break
            case 'bottom-left':  pos.bottom = `${-offsetPx}px`; pos.left  = `${-offsetPx}px`; break
            case 'bottom-right': pos.bottom = `${-offsetPx}px`; pos.right = `${-offsetPx}px`; break
        }
        applyStyle(handle, pos)
    }

    function updateResizeHandles(zoom: number) {
        if (!viewportEl) return
        const handles = viewportEl.querySelectorAll('.document-resize-handle')
        handles.forEach((h) => {
            const el = h as HTMLElement
            const corner = (el.dataset.corner as ResizeCorner) || 'bottom-right'
            applyHandleSizing(el, corner, zoom)
        })
    }

    function getCurrentViewportZoom(): number {
        return panZoom?.getViewport().zoom ?? currentCanvasState?.viewport?.zoom ?? lastTransform[2] ?? 1
    }

    function handleDragStart(event: MouseEvent, nodeId: string, options: DragStartOptions = {}) {
        event.preventDefault()
        event.stopPropagation()

        if (!currentCanvasState) return
        const allowSelection = options.allowSelection !== false

        const dragPlan = computeWorkspaceDragPlan({
            nodes: currentCanvasState.nodes,
            primaryNodeId: nodeId,
            selectedNodeIds,
        })
        const resolvedNodeId = dragPlan.resolvedNodeId

        if (isModSelectionEvent(event)) {
            if (allowSelection) {
                toggleNodeSelection(resolvedNodeId)
            } else {
                if (options.suppressPaneClick) suppressNextPaneClick = true
                options.onClick?.()
            }
            releasePanZoomForNodePointer()
            return
        }

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${resolvedNodeId}"]`) as HTMLElement
        if (!nodeEl) {
            releasePanZoomForNodePointer()
            return
        }

        suspendPanZoomForNodePointer(resolvedNodeId)

        // Defer selection: don't select on mousedown. Selecting here can cause
        // the selection overlay to appear (e.g. for AI chat threads) which sits
        // above the clicked element at a higher z-index, stealing the subsequent
        // mouseup/click. Instead, selection happens:
        //   - on first meaningful mouse movement (selects resolvedNodeId for drag)
        //   - on mouseup without movement (selects original nodeId for click)
        const wasAlreadySelected = isNodeSelected(resolvedNodeId)

        const draggedNodeIds = dragPlan.draggedNodeIds
        const draggedNodeEntries = new Map<string, {
            el: HTMLElement
            startLeft: number
            startTop: number
            startWidth: number
            startHeight: number
        }>()

        for (const draggedNodeId of draggedNodeIds) {
            const draggedNodeEl = viewportEl?.querySelector(`[data-node-id="${draggedNodeId}"]`) as HTMLElement | null
            if (!draggedNodeEl) continue

            draggedNodeEntries.set(draggedNodeId, {
                el: draggedNodeEl,
                startLeft: parseFloat(draggedNodeEl.style.left),
                startTop: parseFloat(draggedNodeEl.style.top),
                startWidth: draggedNodeEl.offsetWidth,
                startHeight: draggedNodeEl.offsetHeight,
            })
        }

        if (draggedNodeEntries.size === 0) {
            releasePanZoomForNodePointer()
            return
        }

        let dragVisualsActivated = false
        const activateDragVisuals = () => {
            if (dragVisualsActivated) return
            dragVisualsActivated = true
            draggingNodeId = resolvedNodeId
            for (const [draggedNodeId, entry] of draggedNodeEntries) {
                entry.el.classList.add('is-dragging')
                if (isContextRegionNodeElement(entry.el)) {
                    nodeLayerManager.sendToBackground(entry.el)
                } else if (draggedNodeId !== resolvedNodeId) {
                    nodeLayerManager.bringToFront(entry.el)
                }
            }
        }

        const startX = event.clientX
        const startY = event.clientY
        const currentZoom = (panZoom?.getViewport().zoom ?? 1) || 1

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true,
                selectionOnDrag: false
            })
        }

        const singleSelectedNodeId = getSingleSelectedNodeId()
        let dragDidMove = false

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const screenDeltaX = moveEvent.clientX - startX
            const screenDeltaY = moveEvent.clientY - startY
            const deltaX = (moveEvent.clientX - startX) / currentZoom
            const deltaY = (moveEvent.clientY - startY) / currentZoom
            if (!dragDidMove && Math.hypot(screenDeltaX, screenDeltaY) >= NODE_DRAG_START_THRESHOLD_PX) {
                dragDidMove = true
                if (allowSelection && !wasAlreadySelected) {
                    selectNode(resolvedNodeId)
                }
                activateDragVisuals()
            }

            if (!dragDidMove) return

            for (const [draggedNodeId, entry] of draggedNodeEntries) {
                const currentPos = {
                    x: entry.startLeft + deltaX,
                    y: entry.startTop + deltaY,
                }
                const currentDims = {
                    width: entry.startWidth,
                    height: entry.startHeight,
                }
                applyStyle(entry.el, { left: `${currentPos.x}px`, top: `${currentPos.y}px` })

                liveNodeOverrides.set(draggedNodeId, {
                    position: currentPos,
                    dimensions: currentDims,
                })

                pixiMediaLayer?.setNodeLiveTransform(draggedNodeId, currentPos, currentDims)
                contextRegionLayer?.setNodeLiveTransform(draggedNodeId, currentPos, currentDims)
                updateGeneratedImageChromeLiveTransform(draggedNodeId, currentPos, currentDims)

                if (floatingInputEl && floatingInputEl.style.display !== 'none' && draggedNodeId === singleSelectedNodeId) {
                    applyStyle(floatingInputEl, {
                        left: `${currentPos.x}px`,
                        top: `${currentPos.y + getThreadTopOffset(draggedNodeId, currentDims.height)}px`,
                        width: `${currentDims.width}px`,
                    })
                }

                const threadEntry = threadFloatingInputs.get(draggedNodeId)
                if (threadEntry) {
                    applyStyle(threadEntry.el, {
                        left: `${currentPos.x}px`,
                        top: `${currentPos.y + getThreadTopOffset(draggedNodeId, currentDims.height)}px`,
                        width: `${currentDims.width}px`,
                    })
                }

                const dragRail = threadRails.get(draggedNodeId)
                if (dragRail) {
                    applyStyle(dragRail, { left: `${currentPos.x - RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`, top: `${currentPos.y}px` })
                    const totalH = parseFloat(dragRail.style.height || '0')
                    if (totalH > 0) connectionManager?.setRailHeight(draggedNodeId, totalH)
                }
            }

            const primaryNodeEntry = draggedNodeEntries.get(resolvedNodeId)
            if (!primaryNodeEntry) return

            const currentPos = {
                x: parseFloat(primaryNodeEntry.el.style.left),
                y: parseFloat(primaryNodeEntry.el.style.top),
            }
            const currentDims = {
                width: primaryNodeEntry.el.offsetWidth,
                height: primaryNodeEntry.el.offsetHeight,
            }

            if (dragPlan.allowProximityConnection) {
                connectionManager?.checkProximity(resolvedNodeId, currentPos, currentDims)
            }

            scheduleEdgesRender()
            repositionCanvasBubbleMenu()
            updateSelectionGroupOverlayElement()
            pixiMediaLayer?.setSelectedImageNodes(selectedNodeIds)
        }

        const handleMouseUp = (upEvent: MouseEvent) => {
            for (const [, entry] of draggedNodeEntries) {
                entry.el.classList.remove('is-dragging')
            }

            draggingNodeId = null

            for (const draggedNodeId of draggedNodeEntries.keys()) {
                liveNodeOverrides.delete(draggedNodeId)
            }

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            releasePanZoomForNodePointer()

            if (!dragDidMove) {
                // No drag occurred — this was a click. Do not run drag-release
                // adoption or collision logic; those paths can legitimately move
                // connected/nearby nodes and must only run after actual movement.
                if (allowSelection) selectNode(nodeId)
                if (options.suppressPaneClick) suppressNextPaneClick = true
                options.onClick?.()
                return
            }

            if (dragPlan.allowProximityConnection) {
                connectionManager?.commitProximityConnection()
            }

            suppressNextNodeClick = true
            if (options.suppressPaneClick) suppressNextPaneClick = true
            window.setTimeout(() => {
                suppressNextNodeClick = false
            }, 0)

            const finalDraggedPositions = new Map<string, { x: number; y: number }>()
            for (const [draggedNodeId, entry] of draggedNodeEntries) {
                finalDraggedPositions.set(draggedNodeId, {
                    x: parseFloat(entry.el.style.left),
                    y: parseFloat(entry.el.style.top),
                })
            }

            const dropPoint = getCanvasPointFromClient(upEvent.clientX, upEvent.clientY)
            let updatedNodes = currentCanvasState.nodes
            const originalNodesById = getCanvasNodesById(updatedNodes)
            const regionNodes = updatedNodes.filter(isContextRegionCanvasNode)
            const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))

            updatedNodes = updatedNodes.map((node: CanvasNode) => {
                const finalWorldPosition = finalDraggedPositions.get(node.nodeId)
                if (!finalWorldPosition) return node

                if (isContextRegionCanvasNode(node)) {
                    return { ...node, position: finalWorldPosition }
                }

                if (node.parentId && finalDraggedPositions.has(node.parentId)) {
                    // Parent and child moved together as one selected group. The
                    // live DOM/PIXI positions are world coordinates, but persisted
                    // child positions remain parent-relative. Keep the existing
                    // relative position so the parent's movement carries the child
                    // exactly once after the state commit.
                    return node
                }

                const draggedRect: Rect = {
                    x: finalWorldPosition.x,
                    y: finalWorldPosition.y,
                    width: node.dimensions.width,
                    height: node.dimensions.height,
                }

                // Pick the best cloud region to adopt this dragged node into.
                // The score uses the same CO2 cloud mask as region clicks so
                // transparent corners do not behave like drop targets.
                let containingRegion: ContextRegionNode | null = null
                let bestRegionScore = 0
                if (canAdoptNodeIntoContextRegion(node)) {
                    for (const region of regionNodes) {
                        if (region.nodeId === node.nodeId) continue
                        const regionDatum = getContextRegionCloudDatum(region, threadMap.get(region.referenceId), originalNodesById)
                        const score = scoreRectAgainstContextRegionCloud(regionDatum, draggedRect, dropPoint)
                        if (score > bestRegionScore) {
                            bestRegionScore = score
                            containingRegion = region
                        }
                    }
                }

                if (containingRegion) {
                    // Snap the child to the inner inset (so it never overlaps
                    // the title pill / left edge) but DO NOT clamp to the
                    // region's current right/bottom — `expandRegionsToFitChildren`
                    // grows the region to fit, matching the mockup.
                    const inset = 48
                    const relative = toParentRelativePosition(finalWorldPosition, containingRegion.nodeId, originalNodesById)
                    const snappedRelative = {
                        x: Math.max(inset, relative.x),
                        y: Math.max(inset, relative.y),
                    }
                    const regionPos = getNodeWorldPosition(containingRegion, originalNodesById)
                    const snappedWorld = {
                        x: regionPos.x + snappedRelative.x,
                        y: regionPos.y + snappedRelative.y,
                    }
                    const nodeEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
                    if (nodeEl) {
                        applyStyle(nodeEl, { left: `${snappedWorld.x}px`, top: `${snappedWorld.y}px` })
                        syncContextRegionImageFrame(nodeEl, { ...node, parentId: containingRegion.nodeId }, currentCanvasState.nodes)
                    }
                    pixiMediaLayer?.setNodeLiveTransform(node.nodeId, snappedWorld, node.dimensions)
                    updateGeneratedImageChromeLiveTransform(node.nodeId, snappedWorld, node.dimensions)

                    return {
                        ...node,
                        parentId: containingRegion.nodeId,
                        expandParent: true,
                        position: snappedRelative,
                    }
                }

                const releasedNode: CanvasNode = { ...node, position: finalWorldPosition }
                delete releasedNode.parentId
                delete releasedNode.expandParent
                delete releasedNode.extent
                const nodeEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
                if (nodeEl) syncContextRegionImageFrame(nodeEl, releasedNode, currentCanvasState.nodes)
                return releasedNode
            })

            updatedNodes = expandRegionsToFitChildren(updatedNodes)

            if (dragPlan.allowCollisionResolution) {
                const collisionExclusions = new Set<string>()

                // Region containers and their children must not collide. Without
                // this, the resolver would push children back out of the region
                // they were just adopted into.
                for (const child of updatedNodes) {
                    if (child.parentId) {
                        collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                    }
                }

                const collisionPlan = createShapeAwareCollisionPlan(updatedNodes, dragPlan.isContextRegionDrag)

                const { nodes: movedNodes, hasChanges } = resolveCollisions(collisionPlan.nodeBoxes, {
                    iterations: 50,
                    overlapThreshold: 0.5,
                    margin: 20,
                    excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined,
                    shouldResolvePair: collisionPlan.shouldResolvePair,
                })

                if (hasChanges) {
                    updatedNodes = updatedNodes.map((n: CanvasNode) => {
                        const newPos = movedNodes.get(n.nodeId)
                        if (newPos) {
                            const resolvedPosition = getResolvedNodePositionFromCollisionBox(n, newPos, collisionPlan.entries)
                            const movedNodeEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                            if (movedNodeEl) {
                                applyStyle(movedNodeEl, { left: `${resolvedPosition.x}px`, top: `${resolvedPosition.y}px` })
                            }
                            pixiMediaLayer?.setNodeLiveTransform(n.nodeId, resolvedPosition, n.dimensions)
                            updateGeneratedImageChromeLiveTransform(n.nodeId, resolvedPosition, n.dimensions)
                            const nextPosition = n.parentId
                                ? toParentRelativePosition(resolvedPosition, n.parentId, getCanvasNodesById(updatedNodes))
                                : resolvedPosition
                            return { ...n, position: nextPosition }
                        }
                        return n
                    })

                    // Run region expansion again in case collision resolution pushed
                    // a child further out than its initial dropped position.
                    updatedNodes = expandRegionsToFitChildren(updatedNodes)
                }
            }

            commitCanvasState({
                ...currentCanvasState,
                nodes: updatedNodes
            })

            // Final reposition after collision resolution may have moved the node
            repositionCanvasBubbleMenu()
            repositionAllThreadFloatingInputs()
            updateSelectionGroupOverlayElement()
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function handleResizeStart(event: MouseEvent, nodeId: string, handlePosition: ResizeHandle) {
        event.preventDefault()
        event.stopPropagation()

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
        if (!nodeEl || !currentCanvasState) {
            releasePanZoomForNodePointer()
            return
        }

        const resizeCursor = getResizeCursorForHandle(handlePosition)
        const previousPaneCursor = paneEl.style.cursor
        const previousBodyCursor = document.body.style.cursor
        const previousBodyUserSelect = document.body.style.userSelect
        const previousDocumentCursor = document.documentElement.style.cursor

        paneEl.style.cursor = resizeCursor
        applyStyle(document.body, { cursor: resizeCursor, userSelect: 'none' })
        applyStyle(document.documentElement, { cursor: resizeCursor })

        // Find the node to check if it's an image (for aspect ratio locking)
        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        const isImageNode = node?.type === 'image'
        const isContextRegionResize = isContextRegionNodeElement(nodeEl)

        // PIXI owns image pixels; the hidden DOM <img> can finish loading after
        // workspace switches, so do not derive resize behavior from DOM natural
        // dimensions. Use the persisted canvas-node aspect ratio instead.
        let aspectRatio: number | null = null
        if (isImageNode) {
            aspectRatio = node.aspectRatio || null
        }

        resizingNodeId = nodeId
        nodeEl.classList.add('is-resizing')

        const handle = event.currentTarget instanceof HTMLElement && event.currentTarget.classList.contains('document-resize-handle')
            ? event.currentTarget
            : null
        handle?.classList.add('is-dragging')

        const startX = event.clientX
        const startY = event.clientY
        const startWidth = nodeEl.offsetWidth
        const startHeight = nodeEl.offsetHeight
        const startLeft = parseFloat(nodeEl.style.left)
        const startTop = parseFloat(nodeEl.style.top)
        const currentZoom = panZoom?.getViewport().zoom ?? 1

        const isLeft = handlePosition.includes('left')
        const isRight = handlePosition.includes('right')
        const isTop = handlePosition.includes('top')
        const isBottom = handlePosition.includes('bottom')
        const directionX = isLeft ? -1 : isRight ? 1 : 0
        const directionY = isTop ? -1 : isBottom ? 1 : 0

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true
            })
        }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = directionX === 0 ? 0 : ((moveEvent.clientX - startX) / currentZoom) * directionX
            const deltaY = directionY === 0 ? 0 : ((moveEvent.clientY - startY) / currentZoom) * directionY

            let newWidth = startWidth + deltaX
            let newHeight = startHeight + deltaY

            // For image nodes, enforce aspect ratio lock using diagonal distance
            if (isImageNode && aspectRatio) {
                // Use the diagonal distance from start point to determine scale
                // This gives smooth, consistent resizing regardless of mouse direction
                const diagonalDelta = (deltaX + deltaY * aspectRatio) / (1 + aspectRatio)
                newWidth = startWidth + diagonalDelta
                newHeight = newWidth / aspectRatio
            }

            // Apply minimum constraints
            const minWidth = isImageNode ? 50 : 200
            const minHeight = isImageNode && aspectRatio ? minWidth / aspectRatio : 150
            newWidth = Math.max(minWidth, newWidth)
            newHeight = Math.max(minHeight, newHeight)

            // Re-apply aspect ratio after min constraints for images
            if (isImageNode && aspectRatio) {
                newHeight = newWidth / aspectRatio
            }

            applyStyle(nodeEl, { width: `${newWidth}px`, height: `${newHeight}px` })

            if (isLeft) {
                const widthDiff = newWidth - startWidth
                applyStyle(nodeEl, { left: `${startLeft - widthDiff}px` })
            }
            if (isTop) {
                const heightDiff = newHeight - startHeight
                applyStyle(nodeEl, { top: `${startTop - heightDiff}px` })
            }

            const liveResizePosition = {
                x: parseFloat(nodeEl.style.left),
                y: parseFloat(nodeEl.style.top)
            }
            const liveResizeDimensions = {
                width: newWidth,
                height: newHeight
            }
            liveNodeOverrides.set(nodeId, {
                position: liveResizePosition,
                dimensions: liveResizeDimensions,
            })

            pixiMediaLayer?.setNodeLiveTransform(nodeId, liveResizePosition, liveResizeDimensions)
            contextRegionLayer?.setNodeLiveTransform(nodeId, liveResizePosition, liveResizeDimensions)
            updateGeneratedImageChromeLiveTransform(nodeId, liveResizePosition, liveResizeDimensions)
            pixiMediaLayer?.setSelectedImageNodes(selectedNodeIds)
            pixiMediaLayer?.setSelectionOverlayBounds(getSelectionOverlayBounds(), { fill: shouldFillSelectionOverlayBounds() })

            // If resizing a region child, visibly grow the region in real-time.
            // `nodeEl.style.left/top` is in world coordinates; convert to parent-
            // relative before computing the needed region dimensions.
            if (node?.parentId) {
                const regionEl = viewportEl?.querySelector(`[data-node-id="${node.parentId}"]`) as HTMLElement | null
                if (regionEl) {
                    const worldLeft = parseFloat(nodeEl.style.left) || 0
                    const worldTop = parseFloat(nodeEl.style.top) || 0
                    const regionWorldLeft = parseFloat(regionEl.style.left) || 0
                    const regionWorldTop = parseFloat(regionEl.style.top) || 0
                    const relativeLeft = worldLeft - regionWorldLeft
                    const relativeTop = worldTop - regionWorldTop
                    const neededWidth = relativeLeft + newWidth + 48
                    const neededHeight = relativeTop + newHeight + 48
                    const currentRegionWidth = parseFloat(regionEl.style.width) || 200
                    const currentRegionHeight = parseFloat(regionEl.style.height) || 120
                    if (neededWidth > currentRegionWidth) applyStyle(regionEl, { width: `${neededWidth}px` })
                    if (neededHeight > currentRegionHeight) applyStyle(regionEl, { height: `${neededHeight}px` })
                    contextRegionLayer?.setNodeLiveTransform(
                        node.parentId,
                        { x: regionWorldLeft, y: regionWorldTop },
                        {
                            width: parseFloat(regionEl.style.width) || currentRegionWidth,
                            height: parseFloat(regionEl.style.height) || currentRegionHeight,
                        }
                    )
                }
            }

            scheduleEdgesRender()
            repositionCanvasBubbleMenu()

            // Reposition per-thread floating input during resize
            const threadEntry = threadFloatingInputs.get(nodeId)
            if (threadEntry) {
                const pos = { x: parseFloat(nodeEl.style.left), y: parseFloat(nodeEl.style.top) }
                applyStyle(threadEntry.el, { left: `${pos.x}px`, top: `${pos.y + getThreadTopOffset(nodeId, newHeight)}px`, width: `${newWidth}px` })
            }

            // Reposition the vertical rail during resize
            const resizeRail = threadRails.get(nodeId)
            if (resizeRail) {
                const pos = { x: parseFloat(nodeEl.style.left), y: parseFloat(nodeEl.style.top) }
                const threadH = hiddenEmptyThreadNodeIds.has(nodeId) ? 0 : newHeight
                const floatingH = threadEntry ? threadEntry.el.offsetHeight : 0
                const gap = hiddenEmptyThreadNodeIds.has(nodeId) ? 0 : 16
                const totalH = threadH + gap + floatingH
                applyStyle(resizeRail, { left: `${pos.x - RAIL_OFFSET - RAIL_GRAB_WIDTH / 2}px`, top: `${pos.y}px`, height: `${totalH}px` })
                resizeRail.style.setProperty('--rail-thread-height', `${threadH}px`)
                connectionManager?.setRailHeight(nodeId, totalH)
            }

        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-resizing')
            handle?.classList.remove('is-dragging')
            resizingNodeId = null
            paneEl.style.cursor = previousPaneCursor
            applyStyle(document.body, { cursor: previousBodyCursor, userSelect: previousBodyUserSelect })
            applyStyle(document.documentElement, { cursor: previousDocumentCursor })

            liveNodeOverrides.delete(nodeId)

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            releasePanZoomForNodePointer()
            if (panZoom) {
                panZoom.update(panZoomConfig)
            }

            const newDimensions = {
                width: nodeEl.offsetWidth,
                height: nodeEl.offsetHeight
            }

            // `nodeEl.style.left/top` is always in viewport-relative world
            // coordinates (set by `createBaseNodeElement` via `getNodeWorldPosition`).
            // Context-region children persist `position` as parent-relative, so
            // convert back before committing.
            const newWorldPosition = {
                x: parseFloat(nodeEl.style.left),
                y: parseFloat(nodeEl.style.top)
            }
            const resizingNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
            const newPosition = resizingNode?.parentId
                ? toParentRelativePosition(newWorldPosition, resizingNode.parentId, getCanvasNodesById())
                : newWorldPosition

            let updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) =>
                n.nodeId === nodeId ? { ...n, dimensions: newDimensions, position: newPosition } : n
            )

            // Grow regions if we resized a child of a region
            updatedNodes = expandRegionsToFitChildren(updatedNodes)

            currentCanvasState = { ...currentCanvasState, nodes: updatedNodes }

            commitCanvasState(currentCanvasState)

            // Final reposition at new size
            repositionCanvasBubbleMenu()
            repositionAllThreadFloatingInputs()
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function createDocumentNode(node: DocumentCanvasNode, doc: Document | undefined): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(node, undefined, { documentId: node.referenceId })
        dragOverlay.className = 'document-drag-overlay nopan'

        const editorContainer = html`<div className="document-node-editor nopan"></div>` as HTMLDivElement
        nodeEl.appendChild(editorContainer)

        if (doc && doc.content !== undefined) {
            try {
                const editor = new ProseMirrorEditor({
                    editorMountElement: editorContainer,
                    content: html`<div></div>` as HTMLDivElement,
                    initialVal: doc.content,
                    isDisabled: false,
                    documentType: 'document',
                    threadId: null,
                    onEditorChange: (value: any) => {
                        onDocumentContentChange?.({
                            documentId: node.referenceId,
                            title: doc.title,
                            prevRevision: doc.prevRevision || 1,
                            content: value
                        })
                    },
                    onProjectTitleChange: (title: string) => {
                        onDocumentTitleChange?.({ documentId: node.referenceId, title })
                    },
                    onAiChatSubmit: () => {},
                    onAiChatStop: () => {},
                    onPromptSubmit: () => {},
                    onPromptStop: () => {},
                    isPromptReceiving: () => false,
                    promptControlFactories: getPromptControlFactories(),
                    onReceivingStateChange: () => {},
                })

                documentEditors.set(node.referenceId, {
                    editor,
                    aiService: null,
                    containerEl: nodeEl
                })
            } catch (error) {
                console.error('Failed to create ProseMirror editor:', error)
                editorContainer.innerHTML = ''
                const errorPlaceholder = createErrorPlaceholder({
                    message: 'Failed to load editor',
                    retryLabel: 'Retry',
                    onRetry: () => {
                        loadedNodeIds.delete(node.nodeId)
                        renderNodes()
                    }
                })
                editorContainer.appendChild(errorPlaceholder.dom)
            }
        } else {
            editorContainer.innerHTML = ''
            editorContainer.appendChild(createLoadingPlaceholder().dom)
        }

        return nodeEl
    }

    function createContextRegionNode(node: ContextRegionNode, thread: AiChatThread | undefined): HTMLElement {
        const { nodeEl } = createBaseNodeElement(
            node,
            'workspace-context-region-node workspace-context-region-node--pixi-owned workspace-ai-chat-thread-node workspace-ai-chat-thread-node--region',
            { threadId: node.referenceId }
        )

        nodeEl.dataset.regionTitle = getAiChatThreadTitle(thread)

        loadedNodeIds.add(node.nodeId)

        return nodeEl
    }

    function createImageNode(node: ImageCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-image-node',
            { fileId: node.fileId }
        )
        syncContextRegionImageFrame(nodeEl, node)
        dragOverlay.className = 'image-drag-overlay nopan'

        // Create the img element - fills the container
        const imgEl = html`<img className="image-node-img" alt="" draggable="false"></img>` as HTMLImageElement

        // For data: URLs (streaming partials) and external URLs, use node.src
        // directly. For NATS-stored images, build a canonical path from the
        // current workspaceId (kept in sync by render()) to avoid stale refs.
        const API_BASE_URL = import.meta.env.VITE_API_URL || ''
        const strippedSrc = node.src.replace(/[?&]token=[^&]+/, '')
        const isStoredImage = strippedSrc.startsWith('/api/') || (strippedSrc.startsWith('http') && strippedSrc.includes('/api/images/'))
        const resolvedSrc = isStoredImage
            ? `/api/images/${workspaceId}/${node.fileId}`
            : strippedSrc

        let retried = false
        const assignSrc = async () => {
            try {
                const token = await AuthService.getTokenSilently()
                imgEl.src = buildImageSrc(resolvedSrc, API_BASE_URL, token)
            } catch {
                showImageErrorPlaceholder(imgEl, nodeEl)
            }
        }

        // Stored images are rendered by PIXI. Setting `<img>.src` here would
        // double-fetch every image: once for the hidden DOM `<img>` and once for
        // the PIXI worker. Data URLs and external URLs still load directly because
        // PIXI only owns stored canvas images.
        if (!isStoredImage) {
            void assignSrc()
        }

        imgEl.onerror = async () => {
            if (!retried) {
                retried = true
                try {
                    const token = await AuthService.getTokenSilently()
                    if (token) {
                        const freshSrc = buildImageSrc(resolvedSrc, API_BASE_URL, token)
                        if (imgEl.src !== freshSrc) {
                            imgEl.src = freshSrc
                            return
                        }
                    }
                    showImageErrorPlaceholder(imgEl, nodeEl)
                } catch {
                    showImageErrorPlaceholder(imgEl, nodeEl)
                }
            } else {
                showImageErrorPlaceholder(imgEl, nodeEl)
            }
        }

        // PIXI owns image pixels. The hidden DOM <img> exists as part of the
        // image-node DOM structure for interaction chrome; it must never mutate
        // canvas state after async load, especially across workspace switches.
        imgEl.onload = () => {
            return
        }

        nodeEl.appendChild(imgEl)

        // Check if this image is currently generating
        const isGenerating = Array.from(partialImageTracker.values()).some(p => p.nodeId === node.nodeId)

        if (isGenerating) {
            // Add loading spinner — three bouncing dots matching AI response message style
            const spinnerContainerStyle = {
                position: 'absolute' as const,
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '5',
                pointerEvents: 'none' as const,
            }
            const spinnerContainer = html`<div className="image-generating-spinner" style=${spinnerContainerStyle}></div>` as HTMLDivElement

            const dotsWrapperStyle = { display: 'flex', gap: '8px', alignItems: 'center' }
            const dotsWrapper = html`<div style=${dotsWrapperStyle}></div>` as HTMLDivElement

            for (let i = 0; i < 3; i++) {
                const dotStyle = { width: '8px', height: '8px', borderRadius: '50%', background: '#b0b0b0', animation: `img-dot-bounce 1s ${i * 0.15}s infinite ease-in-out` }
                const dot = html`<div style=${dotStyle}></div>` as HTMLDivElement
                dotsWrapper.appendChild(dot)
            }

            // Inject keyframes if not already present
            if (!document.getElementById('img-dot-bounce-keyframes')) {
                const style = html`<style id="img-dot-bounce-keyframes" innerHTML=${'@keyframes img-dot-bounce { 0%,80%,100%{transform:scale(1);opacity:.4} 40%{transform:scale(1.3);opacity:1} }'}></style>` as HTMLStyleElement
                document.head.appendChild(style)
            }

            spinnerContainer.appendChild(dotsWrapper)
            nodeEl.appendChild(spinnerContainer)

            const gradientId = `img-grad-${node.nodeId}`

            // Create an SVG overlay that covers the image node
            const svg = select(nodeEl).append('svg')
                .attr('class', 'image-generating-border')
                .style('position', 'absolute')
                .style('top', '0')
                .style('left', '0')
                .style('width', '100%')
                .style('height', '100%')
                .style('pointer-events', 'none')
                .style('border-radius', 'inherit')
                .style('z-index', '10')

            const defs = svg.append('defs')
            const gradient = defs.append('linearGradient')
                .attr('id', gradientId)
                .attr('gradientUnits', 'objectBoundingBox')
                .attr('x1', '0').attr('y1', '0.5')
                .attr('x2', '1').attr('y2', '0.5')

            SvgGradientRenderer.appendRepeatingLinearGradientStops(gradient, webUiThemeSettings.shiftingGradientColors)

            // Draw the border rectangle
            svg.append('rect')
                .attr('width', '100%')
                .attr('height', '100%')
                .attr('rx', 6) // Match image node's border radius
                .attr('ry', 6)
                .attr('fill', 'none')
                .attr('stroke', `url(#${gradientId})`)
                .attr('stroke-width', 4)

            SvgGradientRenderer.startRotatingLinearGradient(gradient, {
                center: { x: 0.5, y: 0.5 },
                radius: 0.707, // sqrt(0.5^2 + 0.5^2) to cover corners
                duration: 50,
            })
        }

        return nodeEl
    }

    function handlePanePointerDown(event: PointerEvent): void {
        if (event.button !== 0 || !event.isPrimary) return
        if (!isCanvasBackgroundTarget(event.target)) return
        if (!currentCanvasState) return

        const start = getCanvasPointFromClient(event.clientX, event.clientY)
        const nodeHit = getNodeHitBeforeContextRegion(start)
        const regionHit = nodeHit ? { kind: 'none' as const } : contextRegionLayer?.hitTest(start) ?? { kind: 'none' as const }
        const regionBoundsHit = nodeHit || regionHit.kind !== 'none' ? null : getContextRegionBoundsHit(start)
        const hitNodeId = nodeHit?.nodeId ?? (regionHit.kind !== 'none' ? regionHit.nodeId : regionBoundsHit?.nodeId ?? null)
        if (!hitNodeId) return

        suspendPanZoomForNodePointer(hitNodeId)
    }

    function handlePaneMouseMove(event: MouseEvent): void {
        if (resizingNodeId) return

        if (!currentCanvasState || draggingNodeId || marqueeSelection) {
            paneEl.style.cursor = ''
            return
        }

        if (!isCanvasBackgroundTarget(event.target)) {
            paneEl.style.cursor = ''
            return
        }

        const point = getCanvasPointFromClient(event.clientX, event.clientY)
        const nodeHit = getNodeHitBeforeContextRegion(point)
        if (nodeHit) {
            paneEl.style.cursor = ''
            return
        }

        const regionHit = contextRegionLayer?.hitTest(point) ?? { kind: 'none' as const }
        if (regionHit.kind === 'none' && getContextRegionBoundsHit(point)) {
            paneEl.style.cursor = ''
            return
        }
        paneEl.style.cursor = regionHit.kind === 'resize' ? regionHit.cursor : ''
    }

    function handlePaneMouseLeave(): void {
        if (resizingNodeId) return
        paneEl.style.cursor = ''
    }

    function handlePaneMouseDown(event: MouseEvent): void {
        if (event.button !== 0) return
        if (!isCanvasBackgroundTarget(event.target)) return
        if (!currentCanvasState) return

        const start = getCanvasPointFromClient(event.clientX, event.clientY)
        const nodeHit = getNodeHitBeforeContextRegion(start)
        if (nodeHit) {
            handleDragStart(event, nodeHit.nodeId, { suppressPaneClick: true })
            return
        }

        const regionHit = contextRegionLayer?.hitTest(start) ?? { kind: 'none' as const }
        if (regionHit.kind !== 'none') {
            if (regionHit.kind === 'resize') {
                handleResizeStart(event, regionHit.nodeId, regionHit.handle)
                return
            }

            const regionNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === regionHit.nodeId)
            const thread = regionNode && isContextRegionCanvasNode(regionNode)
                ? currentAiChatThreads.find((candidate) => candidate.threadId === regionNode.referenceId)
                : undefined
            handleDragStart(event, regionHit.nodeId, {
                suppressPaneClick: true,
                onClick: () => {
                    if (regionNode && isContextRegionCanvasNode(regionNode)) activateAiChatPanel(regionNode, thread)
                },
            })
            return
        }

        const regionBoundsHit = getContextRegionBoundsHit(start)
        if (regionBoundsHit) {
            const thread = currentAiChatThreads.find((candidate) => candidate.threadId === regionBoundsHit.referenceId)
            handleDragStart(event, regionBoundsHit.nodeId, {
                suppressPaneClick: true,
                onClick: () => activateAiChatPanel(regionBoundsHit, thread),
            })
            return
        }

        if (isModSelectionEvent(event)) return

        event.preventDefault()
        event.stopPropagation()
        clearMarqueeInteractionState()

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true,
                selectionOnDrag: true,
            })
        }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const movedX = Math.abs(moveEvent.clientX - event.clientX)
            const movedY = Math.abs(moveEvent.clientY - event.clientY)
            if (!marqueeSelection && movedX <= 3 && movedY <= 3) return

            if (!marqueeSelection) {
                connectionManager?.cancelTransientConnection()
                clearSelectedEdgeSelection(true)
                clearMarqueeInteractionState()
                if (selectedNodeIds.size > 0) setSelectedNodes(new Set())

                marqueeSelection = {
                    start,
                    current: start,
                    moved: true,
                }
            }

            marqueeSelection.current = getCanvasPointFromClient(moveEvent.clientX, moveEvent.clientY)
            marqueeSelection.moved = true
            updateSelectionRectElement()

            const selectedIds = getSelectableNodeIdsInRect(getCanvasRectFromSelection(marqueeSelection))
            setSelectedNodes(new Set(selectedIds), true)
            suppressNextPaneClick = true
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            marqueeSelection = null
            hideSelectionRectElement()
            connectionManager?.cancelTransientConnection()
            updateSelectionGroupOverlayElement()

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    let lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    let lastVisualSyncKey = getCanvasVisualSyncKey(currentCanvasState)

    function renderNodes() {
        if (!viewportEl || !currentCanvasState) return

        viewportEl.innerHTML = ''

        ensureConnectionManager()
        ensureSelectionGroupOverlayElement()
        ensureSelectionRectElement()

        destroyActiveAiChatPanel(false)

        for (const [, { editor, aiService }] of documentEditors) {
            if (editor?.destroy) editor.destroy()
            if (aiService?.disconnect) aiService.disconnect()
        }
        documentEditors.clear()

        for (const [threadId, { editor, aiService, gradientCleanup }] of threadEditors) {
            if (editor?.destroy) editor.destroy()
            if (aiService?.disconnect) aiService.disconnect()
            if (gradientCleanup) gradientCleanup()
            promptInputController.unregisterThreadEditor(threadId)
        }
        threadEditors.clear()

        // Clean up per-thread floating inputs (will be recreated for each thread node)
        destroyAllThreadFloatingInputs()

        // Clean up per-thread vertical rails (will be recreated for each thread node)
        destroyAllThreadRails()

        // Clear loaded node tracking on full re-render
        loadedNodeIds.clear()
        hiddenEmptyThreadNodeIds.clear()

        const documentMap = new Map<string, Document>(currentDocuments.map((d) => [d.documentId, d]))
        const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((t) => [t.threadId, t]))

        for (const node of currentCanvasState.nodes) {
            let nodeEl: HTMLElement

            if (node.type === 'document') {
                const docNode = node as DocumentCanvasNode
                const doc = documentMap.get(docNode.referenceId)
                nodeEl = createDocumentNode(docNode, doc)
            } else if (node.type === 'image') {
                nodeEl = createImageNode(node as ImageCanvasNode)
            } else if (isContextRegionCanvasNode(node)) {
                const thread = threadMap.get(node.referenceId)
                nodeEl = createContextRegionNode(node, thread)
            } else {
                // Unknown node type, skip
                console.warn(`Unknown canvas node type: ${(node as CanvasNode).type}`)
                continue
            }

            // addConnectionHandlesToNode(nodeEl, node.nodeId)
            viewportEl.appendChild(nodeEl)

            // Register after insertion so bounds are measurable
            connectionManager?.registerNodeElement(node.nodeId, nodeEl as HTMLDivElement)
        }

        const existingNodeIds = new Set(currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId))
        const prunedSelectedNodeIds = new Set(Array.from(selectedNodeIds).filter((nodeId) => existingNodeIds.has(nodeId)))
        if (prunedSelectedNodeIds.size !== selectedNodeIds.size) {
            selectedNodeIds = prunedSelectedNodeIds
        }

        updateNodeSelectionClasses(new Set(), selectedNodeIds)
        updateSelectionGroupOverlayElement()
        updateSelectionDrivenUi()

        // Ensure edges render after a full rerender
        connectionManager?.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
        connectionManager?.syncEdges(currentCanvasState.edges)
        scheduleEdgesRender()
        syncContextRegionLayer(currentCanvasState)

        renderActiveAiChatPanel()

        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

        // PIXI sync is driven by the caller (render() / commitCanvasState),
        // not here — avoids a duplicate sync when renderNodes() is called
        // from render() which syncs PIXI immediately afterwards.
    }

    function getDocumentsKey(docs: Document[]): string {
        // Track document IDs and their loaded state
        return docs.map(d => `${d.documentId}:${d.content ? 'loaded' : 'pending'}`).join(',')
    }

    function getAiChatThreadsKey(threads: AiChatThread[]): string {
        // Context-region threads render in the singleton side panel. Loading a
        // thread's ProseMirror content should refresh that panel, not tear down
        // every canvas node and PIXI/DOM proxy on the workspace surface.
        return threads.map(t => t.threadId).join(',')
    }

    let lastDocumentsKey = getDocumentsKey(currentDocuments)
    let lastThreadsKey = getAiChatThreadsKey(currentAiChatThreads)

    function shouldRerender(newCanvasState: CanvasState | null, newDocuments: Document[], newThreads: AiChatThread[]): boolean {
        const newNodeKey = getNodeStructureKey(newCanvasState)
        const newDocsKey = getDocumentsKey(newDocuments)
        const newThreadsKey = getAiChatThreadsKey(newThreads)
        return newNodeKey !== lastNodeStructureKey || newDocsKey !== lastDocumentsKey || newThreadsKey !== lastThreadsKey
    }

    function refreshActiveAiChatPanelWhenContentLoads(): void {
        if (!activeAiChatThreadId) return
        if (!activeAiChatPanelEl || !activeAiChatPanelRegionNodeId || activeAiChatPanelThreadId !== activeAiChatThreadId) return
        if (activeAiChatPanelHadContent) return

        const thread = currentAiChatThreads.find((candidate) => candidate.threadId === activeAiChatThreadId)
        if (!aiChatThreadHasRenderableContent(thread)) return

        renderActiveAiChatPanel(undefined, thread)
    }

    function initializePanZoom() {
        const initialViewport = currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 }
        syncViewportInteractionState(initialViewport)

        panZoom = XYPanZoom({
            domNode: paneEl,
            viewport: initialViewport,
            minZoom: 0.1,
            maxZoom: 2,
            translateExtent: infiniteExtent,
            onDraggingChange: (dragging: boolean) => {
                paneEl.classList.toggle('is-dragging', dragging)
            },
            onPanZoom: () => {}
        })

        panZoom.update(panZoomConfig)

        if (currentCanvasState?.viewport) {
            const vp = currentCanvasState.viewport
            syncViewportInteractionState(vp)
            viewportBridge?.applyViewport(vp)
            // Ensure handles match initial zoom
            updateResizeHandles(vp.zoom)
            panZoom.syncViewport(vp)
        } else {
            updateResizeHandles(1)
        }
    }

    paneEl.addEventListener('pointerdown', handlePanePointerDown, true)
    paneEl.addEventListener('mousemove', handlePaneMouseMove, true)
    paneEl.addEventListener('mouseleave', handlePaneMouseLeave)
    paneEl.addEventListener('mousedown', handlePaneMouseDown, true)

    paneEl.addEventListener('click', (e) => {
        if (suppressNextPaneClick) {
            suppressNextPaneClick = false
            return
        }

        if (isCanvasBackgroundTarget(e.target)) {
            clearNodeSelection()
            clearSelectedEdgeSelection(true)
        }
    })

    const onKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null
        const isTyping = !!target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            (target as any).isContentEditable
        )

        if (e.key === 'Escape') {
            clearSelectedEdgeSelection(true)
            selectNode(null)
            return
        }

        if (isTyping) return

        if ((e.key === 'Backspace' || e.key === 'Delete') && selectedEdgeId) {
            e.preventDefault()
            connectionManager?.deleteSelectedEdge()
            hideEdgeBubbleMenu()
        }
    }

    const onOpenExtractionPanel = (event: Event) => {
        const detail = (event as CustomEvent<{ extractionRunId?: string; workspaceId?: string }>).detail
        if (!detail?.extractionRunId) return
        if (detail.workspaceId && detail.workspaceId !== workspaceId) return
        openFeatureExtractionTab(detail.extractionRunId)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('lixpi:open-extraction-tab', onOpenExtractionPanel)

    initializePanZoom()
    initCanvasBubbleMenu()
    syncActiveAiChatPanelFromState()
    renderNodes()

    return {
        insertNodeAtViewportCenter(node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}) {
            const baseCanvasState: CanvasState = currentCanvasState ?? {
                viewport: getLiveViewport(),
                edges: [],
                nodes: [],
            }
            const positionedNode = {
                ...node,
                position: getCenteredInsertionPosition(node.dimensions),
            } as CanvasNode
            const newCanvasState: CanvasState = {
                ...baseCanvasState,
                ...statePatch,
                viewport: baseCanvasState.viewport,
                edges: baseCanvasState.edges ?? [],
                nodes: resolveTopLevelNodeCollisions([...baseCanvasState.nodes, positionedNode]),
            }

            onCanvasStateChange?.(newCanvasState)
            return newCanvasState
        },
        render(newCanvasState: CanvasState | null, newDocuments: Document[], newAiChatThreads: AiChatThread[] = [], newWorkspaceId?: string) {
            const workspaceChanged = Boolean(newWorkspaceId && newWorkspaceId !== workspaceId)
            if (newWorkspaceId) workspaceId = newWorkspaceId
            if (workspaceChanged) pendingLocalCanvasVisualCommit = null

            const renderStatePlan = mergeIncomingCanvasStateWithPendingVisualCommit({
                incomingState: newCanvasState,
                pendingVisualCommit: pendingLocalCanvasVisualCommit,
            })
            const effectiveCanvasState = renderStatePlan.state
            pendingLocalCanvasVisualCommit = renderStatePlan.pendingVisualCommit

            // Stale drag/resize positions from a previous workspace would corrupt
            // getNodeWorldPosition for the new workspace's nodes.
            if (workspaceChanged) {
                liveNodeOverrides.clear()
                selectedNodeIds = new Set()
                selectedEdgeId = null
                draggingNodeId = null
                resizingNodeId = null
            }

            // Only do a full re-render if node structure or documents/threads changed
            // Position/dimension updates are handled directly in DOM during drag/resize
            const needsRerender = shouldRerender(effectiveCanvasState, newDocuments, newAiChatThreads) || workspaceChanged

            // Check if viewport actually changed (not just nodes)
            const oldViewport = currentCanvasState?.viewport
            const newViewport = effectiveCanvasState?.viewport
            const viewportChanged = !oldViewport || !newViewport ||
                oldViewport.x !== newViewport.x ||
                oldViewport.y !== newViewport.y ||
                oldViewport.zoom !== newViewport.zoom
            const nextVisualSyncKey = getCanvasVisualSyncKey(effectiveCanvasState)
            const visualStateChanged = workspaceChanged || nextVisualSyncKey !== lastVisualSyncKey
            const liveViewport = getLiveViewport()
            const shouldPreserveLiveViewport = shouldPreserveLiveViewportForViewportOnlyRender({
                incomingViewport: effectiveCanvasState?.viewport,
                liveViewport,
                viewportChanged,
                visualStateChanged,
                needsRerender,
                workspaceChanged,
            })

            currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState
                ? { ...effectiveCanvasState, viewport: liveViewport }
                : effectiveCanvasState
            currentDocuments = newDocuments
            currentAiChatThreads = newAiChatThreads
            syncActiveAiChatPanelFromState()
            syncGeneratedImageChrome(currentCanvasState)

            // 1. Rebuild DOM first so image nodes exist when PIXI syncs DOM ownership.
            if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
                lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            } else {
                refreshActiveAiChatPanelWhenContentLoads()
            }

            // 2. Sync PIXI state BEFORE applying the viewport. This ensures
            //    `lastState` inside the PIXI layer is already the new workspace's
            //    canvas state when `setViewport` fires. Without this ordering, a
            //    zoom-tier change during workspace switch would call
            //    `upsertAllImages(OLD_STATE)`, spawning async texture fetches for
            //    the old workspace's images that arrive and overwrite new sprites.
            if (currentCanvasState && connectionManager && visualStateChanged) {
                connectionManager.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
                connectionManager.syncEdges(currentCanvasState.edges)
                scheduleEdgesRender()
                syncPixiMediaLayer(currentCanvasState)
                syncContextRegionLayer(currentCanvasState)
                lastVisualSyncKey = nextVisualSyncKey
            } else if (currentCanvasState) {
                syncContextRegionLayer(currentCanvasState)
            }

            // 3. Apply viewport after PIXI sync. `setViewport` may trigger
            //    `upsertAllImages(lastState)` on a tier change, but `lastState`
            //    is now the new workspace state, so no old sprites are created.
            if (viewportChanged && effectiveCanvasState?.viewport) {
                const viewportInteractionLocked = Boolean(nodePointerPanLockNodeId || draggingNodeId || resizingNodeId)
                if (shouldPreserveLiveViewport) {
                    panZoom?.syncViewport(liveViewport)
                } else if (viewportInteractionLocked) {
                    const lockedViewport = getLiveViewport()
                    if (currentCanvasState) currentCanvasState = { ...currentCanvasState, viewport: lockedViewport }
                    panZoom?.syncViewport(lockedViewport)
                } else {
                    const vp = effectiveCanvasState.viewport
                    syncViewportInteractionState(vp)
                    viewportBridge?.applyViewport(vp)
                    panZoom?.syncViewport(vp)
                }
            }
        },
        toggleFeatureLibrary() {
            if (!featureLibraryPanelInstance) {
                featureLibraryPanelInstance = createFeatureLibraryPanel({
                    workspaceId,
                    paneEl,
                    onUseFeature: insertFeatureIntoActivePrompt,
                    onOpenExtractionTab: (extractionRunId) => {
                        openFeatureExtractionTab(extractionRunId)
                    },
                })
            }
            featureLibraryPanelInstance.toggle()
        },
        destroy() {
            featureLibraryPanelInstance?.close()
            resizeObserver.disconnect()
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('lixpi:open-extraction-tab', onOpenExtractionPanel)
            paneEl.removeEventListener('pointerdown', handlePanePointerDown, true)
            paneEl.removeEventListener('mousemove', handlePaneMouseMove, true)
            paneEl.removeEventListener('mouseleave', handlePaneMouseLeave)
            paneEl.removeEventListener('mousedown', handlePaneMouseDown, true)
            paneEl.style.cursor = ''
            if (edgesRaf !== null) {
                cancelAnimationFrame(edgesRaf)
                edgesRaf = null
            }
            if (transformSideEffectsRaf !== null) {
                cancelAnimationFrame(transformSideEffectsRaf)
                transformSideEffectsRaf = null
            }
            if (autoGrowRaf !== null) {
                cancelAnimationFrame(autoGrowRaf)
                autoGrowRaf = null
            }
            pendingAutoGrowThreadNodeIds.clear()
            hiddenEmptyThreadNodeIds.clear()
            connectionManager?.destroy()
            connectionManager = null
            viewportBridge = null
            imageChromeViewportEl?.remove()
            imageChromeViewportEl = null
            expandedGeneratedImageInfoNodeIds.clear()
            pixiMediaLayer?.destroy()
            pixiMediaLayer = null
            contextRegionLayer?.destroy()
            contextRegionLayer = null
            if (panZoom) {
                panZoom.destroy()
            }
            for (const [, { editor, aiService }] of documentEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
            }
            documentEditors.clear()
            for (const [threadId, { editor, aiService, gradientCleanup }] of threadEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
                if (gradientCleanup) gradientCleanup()
                promptInputController.unregisterThreadEditor(threadId)
            }
            threadEditors.clear()
            canvasImageLifecycle.destroy()
            canvasBubbleMenu?.destroy()
            canvasBubbleMenu = null

            // Clean up floating input
            if (floatingInputEditor?.destroy) floatingInputEditor.destroy()
            floatingInputGradient?.destroy()
            floatingInputEl?.remove()
            floatingInputEl = null
            floatingInputEditor = null
            floatingInputGradient = null
            selectionRectEl?.remove()
            selectionRectEl = null
            selectionGroupOverlayEl?.remove()
            selectionGroupOverlayEl = null
            marqueeSelection = null

            // Clean up per-thread floating inputs
            destroyAllThreadFloatingInputs()

            // Clean up per-thread vertical rails
            destroyAllThreadRails()

            destroyActiveAiChatPanel(true)

            promptInputController.destroy()
        }
    }
}
