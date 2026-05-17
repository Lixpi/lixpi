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
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon, aiChatThreadRailBoundaryCircle, claudeIcon, gptAvatarIcon, geminiIcon, stabilityIcon, brokenImageIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasImageLifecycleTracker } from '$src/infographics/workspace/canvasImageLifecycle.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { getAdaptiveZoomMultiplier, getResizeHandleScaledSizes } from '$src/infographics/utils/zoomScaling.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import { computeImagePositionNextToThread, computeImagePositionOverlappingThread, countExistingImagesForThread, OVERLAP_PADDING_X, OVERLAP_GAP_Y, OVERLAP_WIDTH_RATIO } from '$src/infographics/workspace/imagePositioning.ts'
import { createNodeLayerManager } from '$src/infographics/workspace/nodeLayering.ts'
import { createAnchoredImageManager } from '$src/infographics/workspace/anchoredImageManager.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { createShiftingGradientBackground } from '$src/utils/shiftingGradientRenderer.ts'
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
import { scoreRectAgainstContextRegionCloud, type ContextRegionCloudDatum } from '$src/infographics/workspace/rendering/contextRegionClouds.ts'
import { createFeatureLibraryPanel } from '$src/infographics/workspace/featureLibraryPanel.ts'
import { setPendingExtractionContext, getPendingExtractionContext, submitExtractionRequest, renderExtractionTabBody } from '$src/infographics/workspace/extractionTab.ts'

import { select } from 'd3-selection'

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const RESIZE_CORNERS: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CONTEXT_REGION_IMAGE_CLASS = 'workspace-image-node--context-region-child'

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

type WorkspaceCanvasCallbacks = {
    onViewportChange?: (viewport: Viewport) => void
    onCanvasStateChange?: (state: CanvasState) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; prevRevision?: number; content: any }) => void
    onDocumentTitleChange?: (params: { documentId: string; title: string }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
}

type WorkspaceCanvasOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    workspaceId: string
    canvasState: CanvasState | null
    documents: Document[]
    aiChatThreads: AiChatThread[]
    panZoomConfig?: Partial<ReturnType<typeof defaultPanZoomConfig>>
} & WorkspaceCanvasCallbacks

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
    paneEl.style.setProperty('--context-region-image-frame-color', webUiThemeSettings.contextRegionImageFrameColor)

    let currentCanvasState: CanvasState | null = options.canvasState
    let currentDocuments: Document[] = options.documents
    let currentAiChatThreads: AiChatThread[] = options.aiChatThreads
    let panZoom: PanZoomInstance | null = null
    let lastTransform: Transform = [0, 0, 1]

    let connectionManager: WorkspaceConnectionManager | null = null
    let edgesLayerEl: HTMLDivElement | null = null
    let pixiMediaLayer: PixiMediaLayer | null = null
    let contextRegionLayer: PixiContextRegionLayer | null = null
    let viewportBridge: ViewportBridge | null = null

    // Health of the PIXI renderer. Image nodes' DOM `<img>` elements stay
    // empty (no `src`) while PIXI is healthy so the browser never makes a
    // second, redundant network round-trip for the same pixels PIXI is
    // already drawing. If PIXI fails to initialize (e.g. WebGL/WebGPU
    // unavailable), `pixiHealth` flips to `'failed'` and we backfill src
    // attributes so the DOM fallback takes over.
    let pixiHealth: 'initializing' | 'ready' | 'failed' | 'destroyed' = 'initializing'
    // Per-image-node DOM <img> element registry, keyed by node id. Lets us
    // assign src in O(1) on PIXI failure without a viewport-wide
    // querySelector.
    const imageElByNodeId: Map<string, HTMLImageElement> = new Map()
    // The resolved (token-less) API path for each image node, captured at
    // node-creation time. Used to backfill `<img>.src` when PIXI fails.
    const imageResolvedSrcByNodeId: Map<string, string> = new Map()

    const liveNodeOverrides: Map<string, { position?: { x: number; y: number }; dimensions?: { width: number; height: number } }> = new Map()
    let edgesRaf: number | null = null
    let transformSideEffectsRaf: number | null = null
    let pendingHandleZoom: number | null = null
    let anchoredRealignRaf: number | null = null
    let autoGrowRaf: number | null = null
    let selectedNodeIds: Set<string> = new Set()
    let selectedEdgeId: string | null = null
    let resizingNodeId: string | null = null
    let draggingNodeId: string | null = null
    let selectionRectEl: HTMLDivElement | null = null
    let selectionGroupOverlayEl: HTMLDivElement | null = null
    let marqueeSelection: MarqueeSelectionState | null = null
    let selectionIsFromMarquee = false
    let suppressNextPaneClick = false
    let suppressNextNodeClick = false
    const pendingAnchoredRealignThreadNodeIds: Set<string> = new Set()
    const pendingAutoGrowThreadNodeIds: Set<string> = new Set()
    const nodeLayerManager = createNodeLayerManager()
    const documentEditors: Map<string, DocumentEditorEntry> = new Map()
    const threadEditors: Map<string, AiChatThreadEditorEntry> = new Map()
    let activeAiChatRegionNodeId: string | null = null
    let activeAiChatThreadId: string | null = null
    let activeAiChatPanelEl: HTMLDivElement | null = null
    let activeAiChatPromptEditor: any = null
    let activeAiChatPromptGradient: { destroy: () => void; triggerAnimation: () => void } | null = null
    let featureLibraryPanelInstance: ReturnType<typeof createFeatureLibraryPanel> | null = null
    let activeAiChatSidebarThreadId: string | null = null
    let activeAiChatSidebarTabId: string | null = null
    let aiChatSidebarTabs: CanvasAiChatSidebarTab[] = []

    // Visibility tracking for lazy loading
    const visibleNodeIds: Set<string> = new Set()
    const loadedNodeIds: Set<string> = new Set()
    let paneRect: DOMRect | null = null

    // Image lifecycle tracker - handles deletion of orphaned images
    const canvasImageLifecycle = createCanvasImageLifecycleTracker()
    canvasImageLifecycle.initializeFromCanvasState(currentCanvasState)

    // Anchored image manager - tracks images overlapping their AI chat thread nodes
    const anchoredImageManager = createAnchoredImageManager()

    const pixiSelectionColors: SelectionColors = {
        nodeOutline: webUiThemeSettings.selectionOutlineColor,
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
        onHealthChange: (next) => {
            pixiHealth = next
            if (next === 'failed') {
                // PIXI gave up — every image node falls back to the DOM
                // <img> renderer. Set `src` on each tracked image element
                // so the browser starts the (previously skipped) fetch.
                void backfillDomImageSrcs()
            }
        },
    })
    contextRegionLayer = createPixiContextRegionLayer({
        paneEl,
        viewportEl,
    })
    viewportBridge = createViewportBridge({
        viewportEl,
        getPixiLayer: () => pixiMediaLayer,
        getContextRegionLayer: () => contextRegionLayer,
    })
    if (currentCanvasState?.viewport) {
        viewportBridge.applyViewport(currentCanvasState.viewport)
    }
    pixiMediaLayer.sync(currentCanvasState)
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

                // Clean up anchored image state when deleting an anchored image
                const removedAnchor = anchoredImageManager.removeAnchor(nodeId)

                // Clean up anchored images when deleting a thread that owns them
                const threadAnchors = anchoredImageManager.getAnchorsForThread(nodeId)
                for (const anchor of threadAnchors) {
                    anchoredImageManager.removeAnchor(anchor.imageNodeId)
                    const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement
                    if (imgEl) imgEl.classList.remove('workspace-image-node--anchored')
                }

                let updatedNodes = currentCanvasState.nodes.filter((n: CanvasNode) => n.nodeId !== nodeId)
                const updatedEdges = currentCanvasState.edges.filter(
                    (e: WorkspaceEdge) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
                )

                // Shrink thread height when deleting an anchored image
                if (removedAnchor) {
                    // Find the deleted image node to calculate shrink amount
                    const deletedImgNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
                    if (deletedImgNode) {
                        updatedNodes = updatedNodes.map((n: CanvasNode) => {
                            if (n.nodeId !== removedAnchor.threadNodeId) return n
                            // Recalculate: find max image bottom among remaining anchored images
                            const remainingAnchors = anchoredImageManager.getAnchorsForThread(n.nodeId)
                            let requiredHeight = 200 // minimum
                            for (const a of remainingAnchors) {
                                const imgN = updatedNodes.find((nn: CanvasNode) => nn.nodeId === a.imageNodeId)
                                if (imgN) {
                                    const imgBottom = (imgN.position.y + imgN.dimensions.height + OVERLAP_GAP_Y) - n.position.y
                                    requiredHeight = Math.max(requiredHeight, imgBottom)
                                }
                            }
                            const newHeight = Math.max(requiredHeight, 200)
                            const threadEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                            if (threadEl) applyStyle(threadEl, { height: `${newHeight}px` })
                            return { ...n, dimensions: { ...n.dimensions, height: newHeight } }
                        })
                    }
                }

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
            getVisualScale: () => getAdaptiveZoomMultiplier(getCurrentViewportZoom()),
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

    function isGeneratedOutputImageNode(node: CanvasNode | undefined): node is ImageCanvasNode {
        return node?.type === 'image' && Boolean((node as ImageCanvasNode).generatedBy?.aiChatThreadId)
    }

    function canAdoptNodeIntoContextRegion(node: CanvasNode): boolean {
        return !isGeneratedOutputImageNode(node)
    }

    function hasConnectorEdgeFromThreadToImage(threadNodeId: string, imageNodeId: string): boolean {
        return currentCanvasState?.edges.some((edge: WorkspaceEdge) =>
            edge.sourceNodeId === threadNodeId && edge.targetNodeId === imageNodeId
        ) ?? false
    }

    function getSelectionTargetNodeId(nodeId: string): string {
        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (isGeneratedOutputImageNode(node)) return nodeId

        const anchor = anchoredImageManager.getAnchor(nodeId)
        return anchor?.threadNodeId ?? nodeId
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
        const position = getNodeWorldPosition(node, nodesById)
        const dimensions = liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
        return {
            nodeId: node.nodeId,
            referenceId: node.referenceId,
            x: position.x,
            y: position.y,
            width: dimensions.width,
            height: dimensions.height,
            title: getAiChatThreadTitle(thread),
            selected: selectedNodeIds.has(node.nodeId),
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

    function syncContextRegionLayer(canvasState: CanvasState | null = currentCanvasState): void {
        contextRegionLayer?.sync(getContextRegionCloudDatums(canvasState))
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

    function getRegionGeneratedImageSize(region: CanvasNode): number {
        const availableWidth = Math.max(120, region.dimensions.width - 48)
        return Math.min(220, availableWidth)
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

    function getNextRegionOutputPosition(region: ContextRegionNode, childWidth: number, childHeight: number, nodes: CanvasNode[]): { x: number; y: number } {
        const nodesById = getCanvasNodesById(nodes)
        const regionPosition = getNodeWorldPosition(region, nodesById)
        const gap = 72
        const existingOutputs = nodes.filter((node: CanvasNode) => {
            if (node.type !== 'image' || node.parentId) return false
            return (node as ImageCanvasNode).generatedBy?.aiChatThreadId === region.referenceId
        })
        const index = existingOutputs.length

        return {
            x: regionPosition.x + region.dimensions.width + gap,
            y: regionPosition.y + index * (childHeight + gap),
        }
    }

    function getNodesForConnectionManager(nodes: CanvasNode[]): CanvasNode[] {
        const nodesById = getCanvasNodesById(nodes)
        return nodes.map((node: CanvasNode) => {
            const override = liveNodeOverrides.get(node.nodeId)
            if (!override) return node

            let position = override.position ?? node.position
            if (override.position && node.parentId) {
                position = toParentRelativePosition(override.position, node.parentId, nodesById)
            }

            return {
                ...node,
                position,
                dimensions: override.dimensions ?? node.dimensions,
            }
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

    function getSelectableNodeIdsInRect(rect: Rect): string[] {
        if (!currentCanvasState) return []

        const selectedNodeIdsInRect = new Set<string>()

        currentCanvasState.nodes
            .filter((node: CanvasNode) => rectsOverlap(rect, getSelectionBoundsForNode(node)))
            .forEach((node: CanvasNode) => {
                selectedNodeIdsInRect.add(getSelectionTargetNodeId(node.nodeId))
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

            // DOM rect only for non-PIXI contexts (document/thread nodes);
            // PIXI draws it for image nodes but DOM fallback keeps it working everywhere.
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

    function getSelectionOverlayBounds(): Rect | null {
        if (!currentCanvasState || !shouldShowSelectionGroupOverlay()) return null

        const overlayNodeIds = new Set<string>()
        for (const nodeId of selectedNodeIds) {
            overlayNodeIds.add(nodeId)
            for (const anchor of anchoredImageManager.getAnchorsForThread(nodeId)) {
                overlayNodeIds.add(anchor.imageNodeId)
            }
        }

        const overlayNodes = currentCanvasState.nodes.filter((node: CanvasNode) => overlayNodeIds.has(node.nodeId))
        if (overlayNodes.length === 0) return null

        const bounds = overlayNodes.map((node: CanvasNode) => {
            const rect = getSelectionBoundsForNode(node)
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

    function updateSelectionGroupOverlayElement(): void {
        const bounds = getSelectionOverlayBounds()

        // PIXI draws the visible selection overlay for image nodes.
        pixiMediaLayer?.setSelectionOverlayBounds(bounds)

        // The DOM element is kept invisible but in place as a drag hit target.
        // Its background/border are stripped in the SCSS so PIXI owns the visual.
        const overlayEl = ensureSelectionGroupOverlayElement()
        if (!overlayEl) return

        if (!bounds) {
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

                    const threadAnchors = anchoredImageManager.getAnchorsForThread(nodeId)
                    for (const anchor of threadAnchors) {
                        const anchoredEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement | null
                        if (anchoredEl) nodeLayerManager.bringToFront(anchoredEl)
                    }
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

    function setSelectedNodes(nextSelectedNodeIds: Set<string>, fromMarquee = false): void {
        const prevSelectedNodeIds = selectedNodeIds
        selectedNodeIds = nextSelectedNodeIds
        selectionIsFromMarquee = fromMarquee && nextSelectedNodeIds.size > 0
        updateNodeSelectionClasses(prevSelectedNodeIds, selectedNodeIds)
        updateSelectionGroupOverlayElement()
        updateSelectionDrivenUi()
        pixiMediaLayer?.setSelectedImageNodes(nextSelectedNodeIds)
        syncContextRegionLayer()
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

    function getDraggableNodeIds(primaryNodeId: string): string[] {
        const effectivePrimaryNodeId = getSelectionTargetNodeId(primaryNodeId)
        if (!isNodeSelected(effectivePrimaryNodeId)) return [effectivePrimaryNodeId]

        const draggableNodeIds = Array.from(selectedNodeIds).filter((nodeId) => !anchoredImageManager.isAnchored(nodeId))
        if (draggableNodeIds.length > 0) return draggableNodeIds

        return [effectivePrimaryNodeId]
    }

    function isCanvasBackgroundTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) return false
        if (!paneEl.contains(target)) return false
        if (selectionGroupOverlayEl?.contains(target)) return false

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

    function getEdgeMidpointRect(pathEl: SVGPathElement): DOMRect {
        const length = pathEl.getTotalLength()
        const mid = length / 2
        const svg = pathEl.ownerSVGElement!
        const ctm = pathEl.getScreenCTM()

        if (!ctm) {
            const bbox = pathEl.getBoundingClientRect()
            return new DOMRect(bbox.left + bbox.width / 2, bbox.top + bbox.height / 2, 1, 1)
        }

        const pt = svg.createSVGPoint()

        pt.x = pathEl.getPointAtLength(mid).x
        pt.y = pathEl.getPointAtLength(mid).y
        const screenMid = pt.matrixTransform(ctm)

        pt.x = pathEl.getPointAtLength(Math.max(0, mid - 1)).x
        pt.y = pathEl.getPointAtLength(Math.max(0, mid - 1)).y
        const screenP1 = pt.matrixTransform(ctm)

        pt.x = pathEl.getPointAtLength(Math.min(length, mid + 1)).x
        pt.y = pathEl.getPointAtLength(Math.min(length, mid + 1)).y
        const screenP2 = pt.matrixTransform(ctm)

        const dx = screenP2.x - screenP1.x
        const dy = screenP2.y - screenP1.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1

        let nx = -dy / dist
        let ny = dx / dist

        // Force normal to point DOWN (positive Y) so it works well with placement: 'below'
        if (ny < 0) {
            nx = -nx
            ny = -ny
        }

        // We want the center of the menu to be exactly 28px away from the line
        // (assuming ~18px menu radius + 10px desired gap)
        const menuRadius = 18
        const gap = 10
        const distance = menuRadius + gap

        const menuCenterX = screenMid.x + nx * distance
        const menuCenterY = screenMid.y + ny * distance

        // BubbleMenu with placement 'below' places the menu at:
        // center X = targetRect.left + width/2
        // top Y = targetRect.bottom + 8 (assuming scale 1)
        // So if we pass a 1x1 rect at (targetX, targetY):
        // menuCenterX = targetX
        // menuTop = targetY + 1 + 8 = targetY + 9
        // Since we want menuTop = menuCenterY - menuRadius:
        // targetY + 9 = menuCenterY - menuRadius

        const targetX = menuCenterX
        const targetY = menuCenterY - menuRadius - 9

        return new DOMRect(targetX, targetY, 1, 1)
    }

    function showEdgeBubbleMenu(edgeId: string) {
        if (!canvasBubbleMenu || !canvasBubbleMenuItems || !edgesLayerEl) return

        canvasBubbleMenuItems.setActiveEdgeId(edgeId)

        const pathEl = edgesLayerEl.querySelector(`path#edge-${edgeId}`) as SVGPathElement | null
        if (!pathEl) return

        const targetRect = getEdgeMidpointRect(pathEl)
        canvasBubbleMenu.show(CANVAS_EDGE_CONTEXT, { targetRect, placement: 'below' })
    }

    function hideEdgeBubbleMenu() {
        canvasBubbleMenuItems?.setActiveEdgeId(null)
        canvasBubbleMenu?.hide()
    }

    function repositionEdgeBubbleMenu() {
        if (!canvasBubbleMenu?.isVisible || !selectedEdgeId || !edgesLayerEl) return

        const pathEl = edgesLayerEl.querySelector(`path#edge-${selectedEdgeId}`) as SVGPathElement | null
        if (!pathEl) return

        const targetRect = getEdgeMidpointRect(pathEl)
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

    function destroyActiveAiChatPanel(clearActive = false): void {
        if (activeAiChatThreadId) {
            const entry = threadEditors.get(activeAiChatThreadId)
            if (entry) {
                entry.editor?.destroy?.()
                entry.aiService?.disconnect?.()
                entry.gradientCleanup?.()
                promptInputController.unregisterThreadEditor(activeAiChatThreadId)
                threadEditors.delete(activeAiChatThreadId)
            }
        }

        activeAiChatPromptEditor?.destroy?.()
        activeAiChatPromptGradient?.destroy()
        activeAiChatPanelEl?.remove()
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
        }
    }

    function activateAiChatPanel(regionNode: ContextRegionNode, thread: AiChatThread | undefined): void {
        activeAiChatRegionNodeId = regionNode.nodeId
        activeAiChatThreadId = regionNode.referenceId
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

        commitCanvasStatePreservingEditors({
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
            if (!aiChatSidebarTabs.length) hydrateAiChatSidebarTabsFromCanvasState(activeAiChatThreadId)
            return
        }

        const activeRegion = currentCanvasState.nodes.find(
            (node: CanvasNode): node is ContextRegionNode => isContextRegionCanvasNode(node)
                && node.referenceId === currentCanvasState!.lastActiveAiChatThreadId
        )
        if (!activeRegion) return

        activeAiChatThreadId = activeRegion.referenceId
        activeAiChatRegionNodeId = activeRegion.nodeId
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

        const regionNode = regionNodeOverride ?? currentCanvasState?.nodes.find(
            (node: CanvasNode): node is ContextRegionNode => isContextRegionCanvasNode(node) && node.nodeId === activeAiChatRegionNodeId
        )
        if (!regionNode) {
            destroyActiveAiChatPanel(true)
            return
        }

        const thread = threadOverride ?? currentAiChatThreads.find((candidate) => candidate.threadId === activeAiChatThreadId)
    ensureAiChatSidebarThreadTab(activeAiChatThreadId)
    const activeSidebarTab = getActiveAiChatSidebarTab()
        destroyActiveAiChatPanel(false)

        const panelEl = html`<div
            className="workspace-ai-chat-floating-panel workspace-ai-chat-thread-node nopan nowheel"
            data=${{ threadId: activeAiChatThreadId!, regionNodeId: regionNode.nodeId }}
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

        const hasContent = thread && thread.content != null && typeof thread.content === 'object' && Object.keys(thread.content).length > 0
        const editorContent = hasContent
            ? thread.content
            : {
                type: 'doc',
                content: [
                    { type: 'documentTitle', content: [{ type: 'text', text: 'AI Chat' }] },
                    { type: 'aiChatThread', attrs: { threadId: activeAiChatThreadId }, content: [] },
                ],
            }

        const aiService = new AiInteractionService({
            workspaceId,
            aiChatThreadId: activeAiChatThreadId
        })
        const promptControlFactories = getPromptControlFactories()

        const editor = new ProseMirrorEditor({
            editorMountElement: editorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: editorContent,
            isDisabled: false,
            documentType: 'aiChatThread',
            threadId: activeAiChatThreadId,
            onEditorChange: (value: any) => {
                onAiChatThreadContentChange?.({
                    workspaceId,
                    threadId: activeAiChatThreadId!,
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
            isPromptReceiving: () => promptInputController.isReceiving(activeAiChatThreadId ?? undefined),
            promptControlFactories,
            onReceivingStateChange: (threadId: string, receiving: boolean) => {
                promptInputController.setReceiving(threadId, receiving)
            }
        })

        threadEditors.set(activeAiChatThreadId, {
            editor,
            aiService,
            containerEl: panelEl,
            gradientCleanup: gradient?.destroy,
            triggerGradientAnimation: () => {
                gradient?.triggerAnimation()
                activeAiChatPromptGradient?.triggerAnimation()
            },
        })

        promptInputController.registerThreadEditor(activeAiChatThreadId, {
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
            threadId: activeAiChatThreadId,
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
                    referenceId: activeAiChatThreadId!,
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
                    referenceId: activeAiChatThreadId!,
                })
                promptInputController.stopStreaming()
            },
            isPromptReceiving: () => promptInputController.isReceiving(activeAiChatThreadId ?? undefined),
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

    function realignAnchoredImagesForThread(threadNodeId: string): void {
        if (!currentCanvasState) return
        if (webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) return
        if (draggingNodeId === threadNodeId || resizingNodeId === threadNodeId) return

        const threadNode = currentCanvasState.nodes.find(
            (n: CanvasNode): n is AiChatThreadCanvasNode => n.type === 'aiChatThread' && n.nodeId === threadNodeId
        )
        if (!threadNode) return

        const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${threadNode.nodeId}"]`) as HTMLElement | null
        if (!threadNodeEl) return

        const anchors = anchoredImageManager.getAnchorsForThread(threadNode.nodeId)
        if (anchors.length === 0) return

        const anchorByImageId = new Map(anchors.map((anchor) => [anchor.imageNodeId, anchor]))
        let hasChanges = false

        const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.type !== 'image') return node

            const anchor = anchorByImageId.get(node.nodeId)
            if (!anchor) return node

            if (draggingNodeId === node.nodeId || resizingNodeId === node.nodeId) {
                return node
            }

            const { x, y, constrainedWidth } = computeImagePositionOverlappingThread(
                threadNode,
                anchor.responseMessageId || '',
                threadNodeEl
            )

            // Recalculate height preserving aspect ratio
            const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
            const imgElement = imgNodeEl?.querySelector('img') as HTMLImageElement | null
            const ar = imgElement?.naturalWidth && imgElement?.naturalHeight
                ? imgElement.naturalWidth / imgElement.naturalHeight : 1
            const newHeight = constrainedWidth / ar

            const posChanged = Math.abs(node.position.x - x) > 0.5 || Math.abs(node.position.y - y) > 0.5
            const sizeChanged = Math.abs(node.dimensions.width - constrainedWidth) > 0.5
            if (!posChanged && !sizeChanged) return node

            hasChanges = true

            if (imgNodeEl) {
                applyStyle(imgNodeEl, { left: `${x}px`, top: `${y}px`, width: `${constrainedWidth}px`, height: `${newHeight}px` })
                imgNodeEl.classList.add('workspace-image-node--anchored')
                nodeLayerManager.bringToFront(imgNodeEl)
            }

            return {
                ...node,
                position: { x, y },
                dimensions: { width: constrainedWidth, height: newHeight },
            }
        })

        if (!hasChanges) {
            applyAnchoredImageSpacing(threadNodeId)
            return
        }

        // Update currentCanvasState with new image positions BEFORE spacing,
        // so applyAnchoredImageSpacing can grow the thread height and the
        // single commit below persists everything (positions + height).
        currentCanvasState = { ...currentCanvasState, nodes: updatedNodes }
        applyAnchoredImageSpacing(threadNodeId)

        commitCanvasStatePreservingEditors(currentCanvasState)

        scheduleEdgesRender()
        repositionCanvasBubbleMenu()
    }
    // are pushed below the overlapping anchored image.
    function applyAnchoredImageSpacing(threadNodeId: string): void {
        // Disabled for context regions. Messages render in the singleton canvas
        // chat panel, so there is nothing in the region body to push down.
        // The region height is driven by contained child dimensions.
    }

    function scheduleAnchoredImagesRealign(threadNodeId: string): void {
        if (webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) return

        pendingAnchoredRealignThreadNodeIds.add(threadNodeId)
        if (anchoredRealignRaf !== null) return

        anchoredRealignRaf = requestAnimationFrame(() => {
            anchoredRealignRaf = null

            const nodeIds = Array.from(pendingAnchoredRealignThreadNodeIds)
            pendingAnchoredRealignThreadNodeIds.clear()

            for (const nodeId of nodeIds) {
                realignAnchoredImagesForThread(nodeId)
            }
        })
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

    function getNextGeneratedImagePosition(sourceNode: CanvasNode, sourceThread: ContextRegionNode, imageWidth: number, imageHeight: number): { x: number; y: number } {
        const nodes = currentCanvasState?.nodes || []
        if (isContextRegionCanvasNode(sourceNode)) {
            return getNextRegionOutputPosition(sourceThread, imageWidth, imageHeight, nodes)
        }

        const sourceRect = getNodeWorldRect(sourceNode)
        const gap = 72
        const existingChildOutputs = nodes.filter((node: CanvasNode) => {
            if (node.type !== 'image' || node.parentId) return false
            return currentCanvasState?.edges.some((edge: WorkspaceEdge) =>
                edge.sourceNodeId === sourceNode.nodeId && edge.targetNodeId === node.nodeId
            ) ?? false
        })

        return {
            x: sourceRect.x + sourceRect.width + gap,
            y: sourceRect.y + existingChildOutputs.length * (imageHeight + gap),
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

    function rememberGeneratedImagePlacement(threadId: string, regionNode: ContextRegionNode, messages: any[], hasImageModel: boolean): { promptText: string; imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot } {
        if (!hasImageModel) {
            pendingGeneratedImagePlacements.delete(threadId)
            return { promptText: '' }
        }

        const promptText = getPromptTextFromMessages(messages)
        const imageBranchCandidateSnapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: regionNode.nodeId,
            threadId: regionNode.referenceId,
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

    // Last-resort fallback when PIXI fails to initialize. Iterates every
    // tracked image node and sets `<img>.src` so the (CSS-hidden) DOM
    // `<img>` tag becomes the renderer for that node. This is a one-time
    // cost per failed init — the canvas keeps working, just on the slower
    // DOM path used before PIXI was introduced.
    async function backfillDomImageSrcs(): Promise<void> {
        if (imageResolvedSrcByNodeId.size === 0) return
        const API_BASE_URL = import.meta.env.VITE_API_URL || ''
        let token: string | false = false
        try {
            token = await AuthService.getTokenSilently()
        } catch {
            // proceed without token; public images still work
        }
        for (const [nodeId, resolvedSrc] of imageResolvedSrcByNodeId) {
            const imgEl = imageElByNodeId.get(nodeId)
            if (!imgEl || imgEl.src) continue
            imgEl.src = buildImageSrc(resolvedSrc, API_BASE_URL, token)
        }
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
        pixiMediaLayer?.sync(currentCanvasState)
    }

    // Persist canvas state without triggering a full re-render.
    // Updates internal state + persists via callback, then immediately updates the
    // structure key so the Svelte $effect's render() call sees no structural change
    // and skips renderNodes(). The caller manages DOM updates manually.
    function commitCanvasStatePreservingEditors(nextState: CanvasState): void {
        commitCanvasState(nextState)
        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
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

            const width = sourceThreadNode ? getRegionGeneratedImageSize(sourceThreadNode) : 400
            const height = width
            const position = sourceThreadNode
                ? getNextRegionOutputPosition(sourceThreadNode, width, height, existingNodes)
                : { x: 50 + (existingNodes.length % 3) * 450, y: 50 + Math.floor(existingNodes.length / 3) * 400 }

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
            imageElByNodeId.delete(existing.nodeId)
            imageResolvedSrcByNodeId.delete(existing.nodeId)
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
            console.log('🖼️ [CANVAS] onImagePartialToCanvas', { threadId, fileId, hasExisting: partialImageTracker.has(threadId) })

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

            const useAnchored = false
            const imageWidth = getRegionGeneratedImageSize(sourceThread)
            const imageHeight = imageWidth
            const position = getNextGeneratedImagePosition(sourceNode, sourceThread, imageWidth, imageHeight)

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

            if (useAnchored) {
                // Grow thread height only if image bottom extends past current thread bottom
                const imageBottom = position.y + imageHeight + OVERLAP_GAP_Y
                const threadBottom = sourceThread.position.y + sourceThread.dimensions.height
                const additionalHeight = Math.max(0, imageBottom - threadBottom)
                const threadEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement
                const updatedNodes = additionalHeight > 0
                    ? existingNodes.map((n: CanvasNode) => {
                        if (n.nodeId !== sourceThread.nodeId) return n
                        return { ...n, dimensions: { ...n.dimensions, height: n.dimensions.height + additionalHeight } }
                    })
                    : existingNodes

                if (additionalHeight > 0 && threadEl) {
                    applyStyle(threadEl, { height: `${sourceThread.dimensions.height + additionalHeight}px` })
                }

                const newCanvasState: CanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: [...updatedNodes, imageNode],
                    edges: newEdges,
                }
                commitCanvasStatePreservingEditors(newCanvasState)
                appendImageNodeToDOM(imageNode)

                // Mark image as anchored (no responseMessageId yet — will be set on complete)
                anchoredImageManager.anchorImage({
                    imageNodeId: nodeId,
                    threadNodeId: sourceThread.nodeId,
                    threadReferenceId: sourceThread.referenceId,
                    responseMessageId: '',
                    imageHeight: imageHeight,
                })

                // Apply anchored CSS class
                const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
                if (imgNodeEl) {
                    imgNodeEl.classList.add('workspace-image-node--anchored')
                    nodeLayerManager.bringToFront(imgNodeEl)
                }

                // Reposition thread floating input after height change
                repositionAllThreadFloatingInputs()
                applyAnchoredImageSpacing(sourceThread.nodeId)
            } else {
                const newCanvasState: CanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: [...existingNodes, imageNode],
                    edges: newEdges,
                }
                commitCanvasStatePreservingEditors(newCanvasState)
                appendImageNodeToDOM(imageNode)
            }
        },

        onImageCompleteToCanvas: async (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, responseId, revisedPrompt, aiModel, imageModelProvider, responseMessageId } = data
            console.log('🖼️ [CANVAS] onImageCompleteToCanvas', { threadId, fileId, responseMessageId, hasPartial: partialImageTracker.has(threadId) })

            // Read tracker SYNCHRONOUSLY before any await
            const partial = partialImageTracker.get(threadId)

            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()
            const imageSrc = buildImageSrc(imageUrl, API_BASE_URL, token)

            const useAnchored = false

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

                let edges = currentCanvasState?.edges || []
                if (!useAnchored) {
                    // Standard mode: set the edge's sourceMessageId to link to the specific AI response
                    edges = edges.map((e: WorkspaceEdge) => {
                        if (e.targetNodeId !== partial.nodeId) return e
                        const sourceNode = (currentCanvasState?.nodes || []).find((node: CanvasNode) => node.nodeId === e.sourceNodeId)
                        if (sourceNode && isContextRegionCanvasNode(sourceNode)) {
                            return { ...e, sourceMessageId: responseMessageId || undefined }
                        }
                        const { sourceMessageId: _sourceMessageId, ...edgeWithoutSourceMessageId } = e
                        return edgeWithoutSourceMessageId
                    })
                }

                partialImageTracker.delete(threadId)
                pendingGeneratedImagePlacements.delete(threadId)

                // Remove the animated generating border and spinner
                const borderSvg = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"] .image-generating-border`)
                if (borderSvg) borderSvg.remove()
                const spinnerEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"] .image-generating-spinner`)
                if (spinnerEl) spinnerEl.remove()
                const collisionExclusions = useAnchored ? anchoredImageManager.getExclusionPairsForCollisions() : new Set<string>()
                for (const child of nodes) {
                    if (child.parentId) collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                }
                const nodesById = getCanvasNodesById(nodes)
                const nodeBoxes = nodes.map((n: CanvasNode) => {
                    const worldPosition = getNodeWorldPosition(n, nodesById)
                    return {
                        id: n.nodeId,
                        x: worldPosition.x,
                        y: worldPosition.y,
                        width: n.dimensions.width,
                        height: n.dimensions.height,
                    }
                })
                const collisionResult = resolveCollisions(nodeBoxes, { excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined })

                const resolvedNodes = collisionResult.hasChanges
                    ? nodes.map((n: CanvasNode) => {
                        const resolved = collisionResult.nodes.get(n.nodeId)
                        if (!resolved) return n
                        const position = n.parentId
                            ? toParentRelativePosition({ x: resolved.x, y: resolved.y }, n.parentId, getCanvasNodesById(nodes))
                            : { x: resolved.x, y: resolved.y }
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

                // Add provider icon badge to the existing DOM node
                const nodeEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"]`) as HTMLElement | null
                if (nodeEl && imageModelProvider) {
                    const providerIcons: Record<string, string> = {
                        'OpenAI': gptAvatarIcon,
                        'Anthropic': claudeIcon,
                        'Google': geminiIcon,
                        'Stability': stabilityIcon,
                    }
                    const iconSvg = providerIcons[imageModelProvider]
                    if (iconSvg) {
                        const badge = html`<div className="image-model-badge" innerHTML=${iconSvg} title=${imageModelProvider}></div>` as HTMLDivElement
                        nodeEl.appendChild(badge)
                    }
                }

                if (useAnchored && responseMessageId) {
                    // Update anchored entry with the real responseMessageId and
                    // realign against the finalized response message layout.
                    const existingAnchor = anchoredImageManager.getAnchor(partial.nodeId)
                    if (existingAnchor) {
                        anchoredImageManager.removeAnchor(partial.nodeId)
                    }

                    const sourceThread = findSourceThreadNode(threadId)
                    if (sourceThread) {
                        const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement | null
                        const imageNode = resolvedNodes.find((n: CanvasNode) => n.nodeId === partial.nodeId) as ImageCanvasNode | undefined
                        const imgHeight = imageNode?.dimensions.height ?? 400
                        const { x, y } = computeImagePositionOverlappingThread(
                            sourceThread,
                            responseMessageId,
                            threadNodeEl
                        )

                        const repositionedNodes = resolvedNodes.map((n: CanvasNode) =>
                            n.nodeId === partial.nodeId ? { ...n, position: { x, y } } : n
                        )

                        const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${partial.nodeId}"]`) as HTMLElement | null
                        if (imgNodeEl) {
                            applyStyle(imgNodeEl, { left: `${x}px`, top: `${y}px` })
                            imgNodeEl.classList.add('workspace-image-node--anchored')
                            nodeLayerManager.bringToFront(imgNodeEl)
                        }

                        anchoredImageManager.anchorImage({
                            imageNodeId: partial.nodeId,
                            threadNodeId: sourceThread.nodeId,
                            threadReferenceId: sourceThread.referenceId,
                            responseMessageId,
                            imageHeight: imgHeight,
                        })

                        // Apply spacing before commit so grown height is persisted
                        currentCanvasState = {
                            viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                            nodes: repositionedNodes,
                            edges,
                        }
                        applyAnchoredImageSpacing(sourceThread.nodeId)
                        commitCanvasState(currentCanvasState)
                    }
                }
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

                const imageWidth = getRegionGeneratedImageSize(sourceThread)
                const imageHeight = imageWidth
                const position = getNextGeneratedImagePosition(sourceNode, sourceThread, imageWidth, imageHeight)

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

                let allNodes: CanvasNode[]
                if (useAnchored) {
                    // Grow thread height only if image bottom extends past current thread bottom
                    const imageBottom = position.y + imageHeight + OVERLAP_GAP_Y
                    const threadBottom = sourceThread.position.y + sourceThread.dimensions.height
                    const additionalHeight = Math.max(0, imageBottom - threadBottom)
                    const threadEl = viewportEl?.querySelector(`[data-node-id="${sourceThread.nodeId}"]`) as HTMLElement
                    if (additionalHeight > 0 && threadEl) {
                        applyStyle(threadEl, { height: `${sourceThread.dimensions.height + additionalHeight}px` })
                    }
                    allNodes = [
                        ...existingNodes.map((n: CanvasNode) =>
                            n.nodeId === sourceThread.nodeId && additionalHeight > 0
                                ? { ...n, dimensions: { ...n.dimensions, height: n.dimensions.height + additionalHeight } }
                                : n
                        ),
                        imageNode,
                    ]
                } else {
                    allNodes = [...existingNodes, imageNode]
                }

                const collisionExclusions = useAnchored ? anchoredImageManager.getExclusionPairsForCollisions() : new Set<string>()
                for (const child of allNodes) {
                    if (child.parentId) collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                }
                const allNodesById = getCanvasNodesById(allNodes)
                const nodeBoxes = allNodes.map((n: CanvasNode) => {
                    const worldPosition = getNodeWorldPosition(n, allNodesById)
                    return {
                        id: n.nodeId,
                        x: worldPosition.x,
                        y: worldPosition.y,
                        width: n.dimensions.width,
                        height: n.dimensions.height,
                    }
                })
                const collisionResult = resolveCollisions(nodeBoxes, { excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined })

                const resolvedNodes = collisionResult.hasChanges
                    ? allNodes.map((n: CanvasNode) => {
                        const resolved = collisionResult.nodes.get(n.nodeId)
                        if (!resolved) return n
                        const position = n.parentId
                            ? toParentRelativePosition({ x: resolved.x, y: resolved.y }, n.parentId, getCanvasNodesById(allNodes))
                            : { x: resolved.x, y: resolved.y }
                        return { ...n, position }
                    })
                    : allNodes

                const resolvedImageNode = collisionResult.hasChanges
                    ? resolvedNodes.find((node: CanvasNode) => node.nodeId === nodeId) as ImageCanvasNode | undefined ?? imageNode
                    : imageNode

                // Set state but don't commit yet — spacing may grow thread height
                currentCanvasState = {
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges: newEdges,
                }
                appendImageNodeToDOM(resolvedImageNode)

                if (useAnchored) {
                    anchoredImageManager.anchorImage({
                        imageNodeId: nodeId,
                        threadNodeId: sourceThread.nodeId,
                        threadReferenceId: sourceThread.referenceId,
                        responseMessageId: responseMessageId || '',
                        imageHeight: imageHeight,
                    })

                    // Apply anchored class and z-index
                    const imgNodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
                    if (imgNodeEl) {
                        imgNodeEl.classList.add('workspace-image-node--anchored')
                        nodeLayerManager.bringToFront(imgNodeEl)
                    }

                    // Apply spacing before commit so grown height is persisted
                    applyAnchoredImageSpacing(sourceThread.nodeId)
                    repositionAllThreadFloatingInputs()
                }

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

                    // Calculate position to the right of the source image
                    const newX = sourceImageNode
                        ? sourceImageNode.position.x + sourceImageNode.dimensions.width + 50
                        : 50 + (existingNodes.length % 3) * 450
                    const newY = sourceImageNode
                        ? sourceImageNode.position.y
                        : 50 + Math.floor(existingNodes.length / 3) * 400

                    const threadNode: ContextRegionCanvasNode = {
                        nodeId: `node-${thread.threadId}`,
                        type: 'contextRegion',
                        referenceId: thread.threadId,
                        position: { x: newX, y: newY },
                        dimensions: { width: 400, height: 500 }
                    }

                    const newCanvasState: CanvasState = {
                        viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                        edges: currentCanvasState?.edges ?? [],
                        nodes: [...existingNodes, threadNode]
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

        // Transform node coordinates to screen space
        const screenLeft = node.position.x * zoom + x
        const screenTop = node.position.y * zoom + y
        const screenRight = screenLeft + node.dimensions.width * zoom
        const screenBottom = screenTop + node.dimensions.height * zoom

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
            lastTransform = transform
            const vp: Viewport = { x: transform[0], y: transform[1], zoom: transform[2] }
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
                    scheduleEdgesRender()
                }
            }
            // Defer all layout-forcing DOM work to a separate frame
            scheduleTransformSideEffects()
            onViewportChange?.(vp)
        }),
        ...options.panZoomConfig
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

            if (isModSelectionEvent(e)) {
                const selectionTargetNodeId = getSelectionTargetNodeId(node.nodeId)
                toggleNodeSelection(selectionTargetNodeId)
                return
            }

            selectNode(node.nodeId)
        })

        for (const corner of RESIZE_CORNERS) {
            // Legacy embedded thread nodes keep bottom handles on the floating input.
            // Context regions need all four corner handles on the region itself.
            if (node.type === 'aiChatThread' && !isContextRegion && corner.startsWith('bottom')) continue
            nodeEl.appendChild(createResizeHandle(node.nodeId, corner))
        }

        const dragOverlay = html`<div className="node-drag-overlay nopan" onmousedown=${(e: MouseEvent) => handleDragStart(e, node.nodeId)}></div>` as HTMLDivElement
        nodeEl.appendChild(dragOverlay)

        return { nodeEl, dragOverlay }
    }

    function commitCanvasState(nextState: CanvasState) {
        // Track image changes and delete orphaned images from storage
        canvasImageLifecycle.trackCanvasState(nextState)
        currentCanvasState = nextState
        onCanvasStateChange?.(nextState)

        connectionManager?.syncEdges(nextState.edges)
        connectionManager?.syncNodes(nextState.nodes)
        scheduleEdgesRender()
        pixiMediaLayer?.sync(nextState)
        syncContextRegionLayer(nextState)
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

    function ensureEdgesLayer() {
        if (edgesLayerEl && viewportEl.contains(edgesLayerEl)) {
            return
        }

        if (connectionManager) {
            connectionManager.destroy()
            connectionManager = null
        }

        edgesLayerEl = html`<div className="workspace-edges-layer"></div>` as HTMLDivElement

        viewportEl.prepend(edgesLayerEl)

        connectionManager = new WorkspaceConnectionManager({
            paneEl,
            viewportEl,
            edgesLayerEl,
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
            connectionManager.syncNodes(currentCanvasState.nodes)
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

    function handleDragStart(event: MouseEvent, nodeId: string, options: { onClick?: () => void; suppressPaneClick?: boolean } = {}) {
        event.preventDefault()
        event.stopPropagation()

        const resolvedNodeId = getSelectionTargetNodeId(nodeId)

        if (isModSelectionEvent(event)) {
            toggleNodeSelection(resolvedNodeId)
            return
        }

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${resolvedNodeId}"]`) as HTMLElement
        if (!nodeEl || !currentCanvasState) return

        // Defer selection: don't select on mousedown. Selecting here can cause
        // the selection overlay to appear (e.g. for AI chat threads) which sits
        // above the clicked element at a higher z-index, stealing the subsequent
        // mouseup/click. Instead, selection happens:
        //   - on first meaningful mouse movement (selects resolvedNodeId for drag)
        //   - on mouseup without movement (selects original nodeId for click)
        const wasAlreadySelected = isNodeSelected(resolvedNodeId)

        const draggedNodeIds = getDraggableNodeIds(resolvedNodeId)
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

        if (draggedNodeEntries.size === 0) return

        draggingNodeId = resolvedNodeId
        for (const [draggedNodeId, entry] of draggedNodeEntries) {
            entry.el.classList.add('is-dragging')
            if (isContextRegionNodeElement(entry.el)) {
                nodeLayerManager.sendToBackground(entry.el)
            } else if (draggedNodeId !== resolvedNodeId) {
                nodeLayerManager.bringToFront(entry.el)
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

        const anchoredImageStartPositions = new Map<string, { x: number; y: number }>()
        for (const draggedNodeId of draggedNodeEntries.keys()) {
            const anchoredImagesForThread = anchoredImageManager.getAnchorsForThread(draggedNodeId)
            for (const anchor of anchoredImagesForThread) {
                if (draggedNodeEntries.has(anchor.imageNodeId)) continue

                const anchoredEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement | null
                if (anchoredEl) {
                    anchoredImageStartPositions.set(anchor.imageNodeId, {
                        x: parseFloat(anchoredEl.style.left),
                        y: parseFloat(anchoredEl.style.top),
                    })
                }
            }
        }

        const singleSelectedNodeId = getSingleSelectedNodeId()
        let dragDidMove = false

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = (moveEvent.clientX - startX) / currentZoom
            const deltaY = (moveEvent.clientY - startY) / currentZoom
            if (!dragDidMove && (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1)) {
                dragDidMove = true
                if (!wasAlreadySelected) {
                    selectNode(resolvedNodeId)
                }
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

            connectionManager?.checkProximity(resolvedNodeId, currentPos, currentDims)

            for (const [imgId, startPos] of anchoredImageStartPositions) {
                const anchoredEl = viewportEl?.querySelector(`[data-node-id="${imgId}"]`) as HTMLElement | null
                if (anchoredEl) {
                    const newX = startPos.x + deltaX
                    const newY = startPos.y + deltaY
                    const newDims = { width: anchoredEl.offsetWidth, height: anchoredEl.offsetHeight }
                    applyStyle(anchoredEl, { left: `${newX}px`, top: `${newY}px` })
                    liveNodeOverrides.set(imgId, {
                        position: { x: newX, y: newY },
                        dimensions: newDims,
                    })
                    pixiMediaLayer?.setNodeLiveTransform(imgId, { x: newX, y: newY }, newDims)
                }
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

            // Try to convert any proximity candidate into a real connection
            connectionManager?.commitProximityConnection()

            draggingNodeId = null
            if (dragDidMove) {
                suppressNextNodeClick = true
                if (options.suppressPaneClick) suppressNextPaneClick = true
                window.setTimeout(() => {
                    suppressNextNodeClick = false
                }, 0)
            } else {
                // No drag occurred — this was a click. Select the original node
                // (not the resolved parent thread) so that clicking an anchored
                // image selects the image and shows its bubble menu.
                selectNode(nodeId)
                if (options.suppressPaneClick) suppressNextPaneClick = true
                options.onClick?.()
            }

            for (const draggedNodeId of draggedNodeEntries.keys()) {
                liveNodeOverrides.delete(draggedNodeId)
            }
            for (const [imgId] of anchoredImageStartPositions) {
                liveNodeOverrides.delete(imgId)
            }

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }

            const finalDraggedPositions = new Map<string, { x: number; y: number }>()
            for (const [draggedNodeId, entry] of draggedNodeEntries) {
                finalDraggedPositions.set(draggedNodeId, {
                    x: parseFloat(entry.el.style.left),
                    y: parseFloat(entry.el.style.top),
                })
            }

            for (const [imgId] of anchoredImageStartPositions) {
                const anchoredEl = viewportEl?.querySelector(`[data-node-id="${imgId}"]`) as HTMLElement | null
                if (anchoredEl) {
                    finalDraggedPositions.set(imgId, {
                        x: parseFloat(anchoredEl.style.left),
                        y: parseFloat(anchoredEl.style.top),
                    })
                }
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
                // The score uses the same irregular polygon as region clicks so
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
                if (isGeneratedOutputImageNode(node)) {
                    anchoredImageManager.removeAnchor(node.nodeId)
                    nodeEl?.classList.remove('workspace-image-node--anchored')
                }
                if (nodeEl) syncContextRegionImageFrame(nodeEl, releasedNode, currentCanvasState.nodes)
                return releasedNode
            })

            updatedNodes = expandRegionsToFitChildren(updatedNodes)

            if (draggedNodeEntries.size === 1) {
                const collisionExclusions = anchoredImageManager.getExclusionPairsForCollisions()

                // Region containers and their children must not collide. Without
                // this, the resolver would push children back out of the region
                // they were just adopted into.
                for (const child of updatedNodes) {
                    if (child.parentId) {
                        collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                    }
                }

                const updatedNodesById = getCanvasNodesById(updatedNodes)
                const nodeBoxes = updatedNodes.map((n: CanvasNode) => {
                    const worldPosition = getNodeWorldPosition(n, updatedNodesById)
                    return {
                    id: n.nodeId,
                    x: worldPosition.x,
                    y: worldPosition.y,
                    width: n.dimensions.width,
                    height: n.dimensions.height
                    }
                })

                const { nodes: movedNodes, hasChanges } = resolveCollisions(nodeBoxes, {
                    iterations: 50,
                    overlapThreshold: 0.5,
                    margin: 20,
                    excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined,
                })

                if (hasChanges) {
                    updatedNodes = updatedNodes.map((n: CanvasNode) => {
                        const newPos = movedNodes.get(n.nodeId)
                        if (newPos) {
                            const movedNodeEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                            if (movedNodeEl) {
                                applyStyle(movedNodeEl, { left: `${newPos.x}px`, top: `${newPos.y}px` })
                            }
                            pixiMediaLayer?.setNodeLiveTransform(n.nodeId, newPos, n.dimensions)
                            const nextPosition = n.parentId
                                ? toParentRelativePosition(newPos, n.parentId, getCanvasNodesById(updatedNodes))
                                : newPos
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

    function handleResizeStart(event: MouseEvent, nodeId: string, corner: ResizeCorner) {
        event.preventDefault()
        event.stopPropagation()

        const nodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
        if (!nodeEl || !currentCanvasState) return

        // Find the node to check if it's an image (for aspect ratio locking)
        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        const isImageNode = node?.type === 'image'

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

        const isLeft = corner.includes('left')
        const isTop = corner.includes('top')
        const directionX = isLeft ? -1 : 1
        const directionY = isTop ? -1 : 1

        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true
            })
        }

        // Anchored image resize constraints
        const resizeAnchor = isImageNode ? anchoredImageManager.getAnchor(nodeId) : undefined
        const resizeAnchorsForThread = !isImageNode ? anchoredImageManager.getAnchorsForThread(nodeId) : []

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = ((moveEvent.clientX - startX) / currentZoom) * directionX
            const deltaY = ((moveEvent.clientY - startY) / currentZoom) * directionY

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

            // Constrain anchored image width to fit within thread bounds
            if (resizeAnchor) {
                const threadNode = currentCanvasState?.nodes.find((n: CanvasNode) => n.nodeId === resizeAnchor.threadNodeId)
                if (threadNode) {
                    const maxWidth = Math.floor(threadNode.dimensions.width * OVERLAP_WIDTH_RATIO)
                    if (newWidth > maxWidth) {
                        newWidth = maxWidth
                        if (aspectRatio) newHeight = newWidth / aspectRatio
                    }
                }
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
            pixiMediaLayer?.setSelectedImageNodes(selectedNodeIds)
            pixiMediaLayer?.setSelectionOverlayBounds(getSelectionOverlayBounds())

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

            // Real-time anchored image repositioning during thread resize
            if (resizeAnchorsForThread.length > 0) {
                const liveThreadDims = { width: newWidth, height: newHeight }
                const liveThreadPos = { x: parseFloat(nodeEl.style.left), y: parseFloat(nodeEl.style.top) }
                const liveThread = {
                    ...(currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId) as AiChatThreadCanvasNode),
                    position: liveThreadPos,
                    dimensions: liveThreadDims,
                }
                for (const anchor of resizeAnchorsForThread) {
                    const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement | null
                    if (!imgEl) continue

                    const { x: imgX, y: imgY, constrainedWidth: imgW } = computeImagePositionOverlappingThread(
                        liveThread,
                        anchor.responseMessageId || '',
                        nodeEl
                    )
                    const imgElement = imgEl.querySelector('img') as HTMLImageElement | null
                    const ar = imgElement?.naturalWidth && imgElement?.naturalHeight
                        ? imgElement.naturalWidth / imgElement.naturalHeight : 1
                    const imgH = imgW / ar

                    applyStyle(imgEl, { left: `${imgX}px`, top: `${imgY}px`, width: `${imgW}px`, height: `${imgH}px` })
                }
                applyAnchoredImageSpacing(nodeId)
            }
        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-resizing')
            handle?.classList.remove('is-dragging')
            resizingNodeId = null

            liveNodeOverrides.delete(nodeId)

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

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

            // Update anchored image spacer height after image resize
            if (resizeAnchor) {
                anchoredImageManager.updateImageSize(nodeId, newDimensions.height)
                const heightDelta = newDimensions.height - startHeight
                if (heightDelta !== 0) {
                    updatedNodes = updatedNodes.map((n: CanvasNode) => {
                        if (n.nodeId !== resizeAnchor.threadNodeId) return n
                        const newThreadHeight = Math.max(n.dimensions.height + heightDelta, 200)
                        const threadEl = viewportEl?.querySelector(`[data-node-id="${n.nodeId}"]`) as HTMLElement
                        if (threadEl) applyStyle(threadEl, { height: `${newThreadHeight}px` })
                        return { ...n, dimensions: { ...n.dimensions, height: newThreadHeight } }
                    })
                }
                // No spacer dispatch needed — images are positioned side-by-side, not below text
            }

            // Adjust anchored images when thread is resized
            if (resizeAnchorsForThread.length > 0) {
                const threadNodeEl = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                const updatedThread = {
                    ...(currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId) as AiChatThreadCanvasNode),
                    position: newPosition,
                    dimensions: newDimensions,
                }

                for (const anchor of resizeAnchorsForThread) {
                    const imgIdx = updatedNodes.findIndex((n: CanvasNode) => n.nodeId === anchor.imageNodeId)
                    if (imgIdx === -1) continue
                    const imgNode = updatedNodes[imgIdx] as ImageCanvasNode
                    const imgEl = viewportEl?.querySelector(`[data-node-id="${anchor.imageNodeId}"]`) as HTMLElement

                    const { x: newImgX, y: newImgY, constrainedWidth: newImgWidth } = computeImagePositionOverlappingThread(
                        updatedThread,
                        anchor.responseMessageId || '',
                        threadNodeEl
                    )

                    const imgElement = imgEl?.querySelector('img') as HTMLImageElement | null
                    const ar = imgElement?.naturalWidth && imgElement?.naturalHeight
                        ? imgElement.naturalWidth / imgElement.naturalHeight : 1
                    const newImgHeight = newImgWidth / ar
                    anchoredImageManager.updateImageSize(anchor.imageNodeId, newImgHeight)

                    if (imgEl) {
                        applyStyle(imgEl, { left: `${newImgX}px`, top: `${newImgY}px`, width: `${newImgWidth}px`, height: `${newImgHeight}px` })
                    }

                    updatedNodes[imgIdx] = {
                        ...imgNode,
                        position: { x: newImgX, y: newImgY },
                        dimensions: { width: newImgWidth, height: newImgHeight },
                    }
                }
                // No spacer dispatch needed — images are side-by-side
            }

            // Apply spacing before commit so the grown height is persisted
            currentCanvasState = { ...currentCanvasState, nodes: updatedNodes }
            applyAnchoredImageSpacing(nodeId)

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

        // Track this <img> + its resolved API path. Used by the PIXI
        // health-failure fallback to backfill `src` only on stored images,
        // and the partial-streaming code path to update src in place.
        imageElByNodeId.set(node.nodeId, imgEl)
        if (isStoredImage) imageResolvedSrcByNodeId.set(node.nodeId, resolvedSrc)

        let retried = false
        const assignSrc = async () => {
            try {
                const token = await AuthService.getTokenSilently()
                imgEl.src = buildImageSrc(resolvedSrc, API_BASE_URL, token)
            } catch {
                showImageErrorPlaceholder(imgEl, nodeEl)
            }
        }

        // CRITICAL: stored images are rendered by PIXI. Setting `<img>.src`
        // here would double-fetch every image — once for the (hidden,
        // opacity:0) DOM `<img>` and once for the PIXI worker. With hundreds
        // of images that doubles network round-trips and makes the page
        // crawl through the browser's per-origin HTTP queue.
        //
        // For stored images we leave the `<img>` empty until/unless PIXI
        // signals failure (see `backfillDomImageSrcs`). Data: URLs (in-
        // progress generations) and external URLs continue to load
        // immediately, since PIXI only handles stored canvas images.
        if (!isStoredImage) {
            void assignSrc()
        } else if (pixiHealth === 'failed') {
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

        // PIXI owns image pixels. The hidden DOM <img> exists only as a legacy
        // DOM child for interaction chrome compatibility; it must never mutate
        // canvas state after async load, especially across workspace switches.
        imgEl.onload = () => {
            return
        }

        nodeEl.appendChild(imgEl)

        // Add image model provider icon badge
        const imageModelProvider = node.generatedBy?.imageModelProvider
        if (imageModelProvider) {
            const providerIcons: Record<string, string> = {
                'OpenAI': gptAvatarIcon,
                'Anthropic': claudeIcon,
                'Google': geminiIcon,
            }
            const iconSvg = providerIcons[imageModelProvider]
            if (iconSvg) {
                const badge = html`<div className="image-model-badge" innerHTML=${iconSvg} title=${imageModelProvider}></div>` as HTMLDivElement
                nodeEl.appendChild(badge)
            }
        }

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

            // Use the shifting gradient palette from theme settings
            const themeColors = webUiThemeSettings.shiftingGradientColors
            const extendedColors = [
                themeColors[0],
                themeColors[1],
                themeColors[2],
                themeColors[3],
                themeColors[0],
            ]

            const numRepeats = 2
            for (let i = 0; i <= numRepeats * extendedColors.length; i++) {
                const colorIndex = i % extendedColors.length
                const offset = (i / (numRepeats * extendedColors.length)) * 100
                gradient.append('stop')
                    .attr('offset', `${offset}%`)
                    .style('stop-color', extendedColors[colorIndex])
            }

            // Draw the border rectangle
            svg.append('rect')
                .attr('width', '100%')
                .attr('height', '100%')
                .attr('rx', 6) // Match image node's border radius
                .attr('ry', 6)
                .attr('fill', 'none')
                .attr('stroke', `url(#${gradientId})`)
                .attr('stroke-width', 4)

            // Custom easing matching cubic-bezier(0.19, 1, 0.22, 1)
            const customEase = (t: number): number => {
                const t2 = t * t, t3 = t2 * t, mt = 1 - t, mt2 = mt * mt
                return 3 * mt2 * t + 3 * mt * t2 + t3
            }

            // Animation loop
            let running = true
            const duration = 50

            const loop = () => {
                if (!running) return

                // Get current angle and calculate new position for rotation effect
                const centerX = 0.5
                const centerY = 0.5
                const radius = 0.707 // sqrt(0.5^2 + 0.5^2) to cover corners

                let angle = 0

                const animate = () => {
                    if (!running) return

                    // Calculate gradient endpoints based on rotating angle
                    const x1 = centerX + radius * Math.cos(angle)
                    const y1 = centerY + radius * Math.sin(angle)
                    const x2 = centerX + radius * Math.cos(angle + Math.PI)
                    const y2 = centerY + radius * Math.sin(angle + Math.PI)

                    gradient
                        .transition()
                        .duration(duration)  // Small steps for smooth rotation
                        .ease(customEase)
                        .attr('x1', x1)
                        .attr('y1', y1)
                        .attr('x2', x2)
                        .attr('y2', y2)
                        .on('end', () => {
                            angle -= 0.1  // Negative for counterclockwise
                            if (running) animate()
                        })
                }

                animate()
            }

            loop()
        }

        return nodeEl
    }

    function handlePaneMouseDown(event: MouseEvent): void {
        if (event.button !== 0) return
        if (!isCanvasBackgroundTarget(event.target)) return
        if (!currentCanvasState) return

        const start = getCanvasPointFromClient(event.clientX, event.clientY)
        const regionHit = contextRegionLayer?.hitTest(start) ?? { kind: 'none' as const }
        if (regionHit.kind !== 'none') {
            if (isModSelectionEvent(event)) {
                event.preventDefault()
                event.stopPropagation()
                toggleNodeSelection(regionHit.nodeId)
                suppressNextPaneClick = true
                return
            }

            if (regionHit.kind === 'resize-handle') {
                suppressNextPaneClick = true
                handleResizeStart(event, regionHit.nodeId, regionHit.corner)
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

        if (isModSelectionEvent(event)) return

        event.preventDefault()
        event.stopPropagation()

        marqueeSelection = {
            start,
            current: start,
            moved: false,
        }
        updateSelectionRectElement()

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
            if (!marqueeSelection) return

            marqueeSelection.current = getCanvasPointFromClient(moveEvent.clientX, moveEvent.clientY)
            const movedX = Math.abs(moveEvent.clientX - event.clientX)
            const movedY = Math.abs(moveEvent.clientY - event.clientY)
            marqueeSelection.moved = marqueeSelection.moved || movedX > 3 || movedY > 3
            updateSelectionRectElement()

            if (!marqueeSelection.moved) return

            const selectedIds = getSelectableNodeIdsInRect(getCanvasRectFromSelection(marqueeSelection))
            setSelectedNodes(new Set(selectedIds), true)
            suppressNextPaneClick = true
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            marqueeSelection = null
            hideSelectionRectElement()

            if (panZoom) {
                panZoom.update(panZoomConfig)
            }
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function getNodeStructureKey(canvasState: CanvasState | null): string {
        if (!canvasState) return ''
        // Create a key based on structural fields; position/dimension changes don't affect this
        return canvasState.nodes.map((n: CanvasNode) => `${n.nodeId}:${n.type}:${n.parentId ?? ''}`).join(',')
    }

    let lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

    function renderNodes() {
        if (!viewportEl || !currentCanvasState) return

        viewportEl.innerHTML = ''

        ensureEdgesLayer()
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
        anchoredImageManager.clear()
        imageElByNodeId.clear()
        imageResolvedSrcByNodeId.clear()

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
        connectionManager?.syncNodes(currentCanvasState.nodes)
        connectionManager?.syncEdges(currentCanvasState.edges)
        scheduleEdgesRender()
        syncContextRegionLayer(currentCanvasState)

        renderActiveAiChatPanel()

        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

        // Re-derive legacy anchored image state from `generatedBy` metadata.
        // The anchoredImageManager is in-memory only, so on page refresh
        // it starts empty. Generated images with persisted connector edges
        // remain independent canvas nodes and are not re-registered as anchored.
        if (!webUiSettings.renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem) {
            // Build a lookup: threadReferenceId → context region node
            const threadNodesByRef = new Map<string, ContextRegionNode>()
            for (const n of currentCanvasState.nodes) {
                if (isContextRegionCanvasNode(n)) {
                    threadNodesByRef.set(n.referenceId, n)
                }
            }

            for (const node of currentCanvasState.nodes) {
                if (node.type !== 'image') continue
                const imgNode = node as ImageCanvasNode
                if (!imgNode.generatedBy) continue

                const threadCanvasNode = threadNodesByRef.get(imgNode.generatedBy.aiChatThreadId)
                if (!threadCanvasNode) continue

                const hasConnectorEdge = hasConnectorEdgeFromThreadToImage(threadCanvasNode.nodeId, imgNode.nodeId)
                if (hasConnectorEdge) continue

                // Already tracked (e.g. re-render during live session) — skip re-registration
                if (anchoredImageManager.isAnchored(imgNode.nodeId)) continue

                // Use responseMessageId persisted in generatedBy metadata.
                // This is the ProseMirror node `id` of the response message that
                // triggered image generation — set during onImageCompleteToCanvas.
                const responseMessageId = imgNode.generatedBy.responseMessageId || ''

                anchoredImageManager.anchorImage({
                    imageNodeId: imgNode.nodeId,
                    threadNodeId: threadCanvasNode.nodeId,
                    threadReferenceId: threadCanvasNode.referenceId,
                    responseMessageId,
                    imageHeight: imgNode.dimensions.height,
                })
            }

            // Now apply CSS classes and bring anchored images to front
            for (const node of currentCanvasState.nodes) {
                if (node.type !== 'image') continue
                if (!anchoredImageManager.isAnchored(node.nodeId)) continue

                const imgEl = viewportEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement
                if (imgEl) {
                    imgEl.classList.add('workspace-image-node--anchored')
                    nodeLayerManager.bringToFront(imgEl)
                }
            }

            // Apply anchored image spacing to push messages below images
            const threadsWithAnchors = new Set<string>()
            for (const node of currentCanvasState.nodes) {
                if (node.type !== 'image') continue
                const anchor = anchoredImageManager.getAnchor(node.nodeId)
                if (anchor) threadsWithAnchors.add(anchor.threadNodeId)
            }
            for (const tid of threadsWithAnchors) {
                applyAnchoredImageSpacing(tid)
            }
        }

        // PIXI sync is driven by the caller (render() / commitCanvasState),
        // not here — avoids a duplicate sync when renderNodes() is called
        // from render() which syncs PIXI immediately afterwards.
    }

    function getDocumentsKey(docs: Document[]): string {
        // Track document IDs and their loaded state
        return docs.map(d => `${d.documentId}:${d.content ? 'loaded' : 'pending'}`).join(',')
    }

    function getAiChatThreadsKey(threads: AiChatThread[]): string {
        // Track thread IDs and their loaded state
        return threads.map(t => `${t.threadId}:${t.content ? 'loaded' : 'pending'}`).join(',')
    }

    let lastDocumentsKey = getDocumentsKey(currentDocuments)
    let lastThreadsKey = getAiChatThreadsKey(currentAiChatThreads)

    function shouldRerender(newCanvasState: CanvasState | null, newDocuments: Document[], newThreads: AiChatThread[]): boolean {
        const newNodeKey = getNodeStructureKey(newCanvasState)
        const newDocsKey = getDocumentsKey(newDocuments)
        const newThreadsKey = getAiChatThreadsKey(newThreads)
        return newNodeKey !== lastNodeStructureKey || newDocsKey !== lastDocumentsKey || newThreadsKey !== lastThreadsKey
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

    paneEl.addEventListener('mousedown', handlePaneMouseDown, true)

    paneEl.addEventListener('click', (e) => {
        if (suppressNextPaneClick) {
            suppressNextPaneClick = false
            return
        }

        if (isCanvasBackgroundTarget(e.target)) {
            clearNodeSelection()
            selectedEdgeId = null
            connectionManager?.deselect()
            hideEdgeBubbleMenu()
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
            selectedEdgeId = null
            connectionManager?.deselect()
            selectNode(null)
            hideEdgeBubbleMenu()
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
        render(newCanvasState: CanvasState | null, newDocuments: Document[], newAiChatThreads: AiChatThread[] = [], newWorkspaceId?: string) {
            const workspaceChanged = Boolean(newWorkspaceId && newWorkspaceId !== workspaceId)
            if (newWorkspaceId) workspaceId = newWorkspaceId

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
            const needsRerender = shouldRerender(newCanvasState, newDocuments, newAiChatThreads) || workspaceChanged

            // Check if viewport actually changed (not just nodes)
            const oldViewport = currentCanvasState?.viewport
            const newViewport = newCanvasState?.viewport
            const viewportChanged = !oldViewport || !newViewport ||
                oldViewport.x !== newViewport.x ||
                oldViewport.y !== newViewport.y ||
                oldViewport.zoom !== newViewport.zoom

            currentCanvasState = newCanvasState
            currentDocuments = newDocuments
            currentAiChatThreads = newAiChatThreads
            syncActiveAiChatPanelFromState()

            // 1. Rebuild DOM first so image nodes exist when PIXI syncs DOM ownership.
            if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
                lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            }

            // 2. Sync PIXI state BEFORE applying the viewport. This ensures
            //    `lastState` inside the PIXI layer is already the new workspace's
            //    canvas state when `setViewport` fires. Without this ordering, a
            //    zoom-tier change during workspace switch would call
            //    `upsertAllImages(OLD_STATE)`, spawning async texture fetches for
            //    the old workspace's images that arrive and overwrite new sprites.
            if (currentCanvasState && connectionManager) {
                connectionManager.syncNodes(currentCanvasState.nodes)
                connectionManager.syncEdges(currentCanvasState.edges)
                scheduleEdgesRender()
                pixiMediaLayer?.sync(currentCanvasState)
                syncContextRegionLayer(currentCanvasState)
            }

            // 3. Apply viewport after PIXI sync. `setViewport` may trigger
            //    `upsertAllImages(lastState)` on a tier change, but `lastState`
            //    is now the new workspace state, so no old sprites are created.
            if (viewportChanged && newCanvasState?.viewport) {
                const vp = newCanvasState.viewport
                syncViewportInteractionState(vp)
                viewportBridge?.applyViewport(vp)
                panZoom?.syncViewport(vp)
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
            paneEl.removeEventListener('mousedown', handlePaneMouseDown, true)
            if (edgesRaf !== null) {
                cancelAnimationFrame(edgesRaf)
                edgesRaf = null
            }
            if (transformSideEffectsRaf !== null) {
                cancelAnimationFrame(transformSideEffectsRaf)
                transformSideEffectsRaf = null
            }
            if (anchoredRealignRaf !== null) {
                cancelAnimationFrame(anchoredRealignRaf)
                anchoredRealignRaf = null
            }
            pendingAnchoredRealignThreadNodeIds.clear()
            if (autoGrowRaf !== null) {
                cancelAnimationFrame(autoGrowRaf)
                autoGrowRaf = null
            }
            pendingAutoGrowThreadNodeIds.clear()
            hiddenEmptyThreadNodeIds.clear()
            connectionManager?.destroy()
            connectionManager = null
            viewportBridge?.destroy()
            viewportBridge = null
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
