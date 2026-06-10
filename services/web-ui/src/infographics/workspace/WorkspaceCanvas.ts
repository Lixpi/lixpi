import {
    XYPanZoom,
    infiniteExtent,
    PanOnScrollMode,
    type PanZoomInstance,
    type Viewport,
    type Transform,
    type Rect,
} from '@xyflow/system'
// @ts-ignore - runtime import
import { select } from 'd3-selection'
import { TextSelection } from 'prosemirror-state'
import { v4 as uuidv4 } from 'uuid'
import {
    NATS_SUBJECTS,
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type AiChatThreadCanvasNode,
    type BranchOriginCanvasNode,
    type AiChatThread,
    type WorkspaceEdge,
    type CanvasAiChatSidebarTab,
    type CanvasAiChatPanelState,
    type CanvasFeatureExtractionState,
    type FeatureMeta,
    type MediaLibraryImageMeta,
    type MediaLibraryVideoMeta,
    type ImageBranchCandidateSnapshot,
    type ImageBranchVlmResolution,
    type MediaDescriptor,
    type ContentDescriptor,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
    type MediaGenerationRunMeta,
    MEDIA_DESCRIPTOR_VERSION,
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import { setAiGeneratedImageCallbacks, setAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/index.ts'
import { getAiProviderIcon } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'
import { getGeneratedImageTurnInfoFromThreadContent } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadContentUtils.ts'
import { createAiResponseMessageShell, createAiUserMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'
import { createImageGenerationTraceDetails } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon, aiChatThreadRailBoundaryCircle, brokenImageIcon, infoCircleIcon, trashBinIcon, aiChatPanelToggleHistoryIcon, xCircleIcon, documentIcon, videoPlayGlyphIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasImageLifecycleTracker } from '$src/infographics/workspace/canvasImageLifecycle.ts'
import { createCanvasVideoLifecycleTracker } from '$src/infographics/workspace/canvasVideoLifecycle.ts'
import { createVideoNodeHandler, type VideoNodeHandlerControl } from '$src/infographics/workspace/rendering/videoNodeHandler.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { getCanvasChromeZoomMultiplier, getResizeHandleScaledSizes } from '$src/infographics/utils/zoomScaling.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import { rebalanceBranchTreesAndResolve } from '$src/infographics/workspace/branchTreeLayout.ts'
import {
    computeLineageContinuationPositionToRightOfRect,
    computeNextBranchRowPositionToRightOfRect,
    computeViewportCenterInsertionPosition,
} from '$src/infographics/workspace/imagePositioning.ts'
import { createNodeLayerManager } from '$src/infographics/workspace/nodeLayering.ts'
import { computeWorkspaceDragPlan } from '$src/infographics/workspace/workspaceDragPlan.ts'
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
import { settings } from '$src/settings.ts'
import { BubbleMenu, type BubbleMenuPositionRequest } from '$src/components/bubbleMenu/index.ts'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_EDGE_CONTEXT } from '$src/infographics/workspace/canvasBubbleMenuItems.ts'
import { downloadImage } from '$src/utils/downloadImage.ts'
import { AiPromptInputController } from '$src/services/ai-prompt-input-controller.ts'
import MediaLibraryService from '$src/services/media-library-service.ts'
import { describeMedia, describeText } from '$src/services/media-descriptor-service.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    buildImageBranchCandidateSnapshot,
    buildWorkspaceContextSnapshot,
    getGeneratedImageTextByNodeIdFromThreadContent,
    getPromptTextFromMessages,
} from '$src/services/ai-image-branching.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'
import { extractContentFromProseMirror } from '$src/services/ai-chat-thread-service.ts'
import {
    createGenericAiModelMultiSelect,
    createGenericSubmitButton,
    createGenericImageSizeDropdown,
    createGenericImageModelMultiSelect,
    createGenericVideoModelMultiSelect,
    createGenericVideoAspectDropdown,
    createGenericVideoResolutionDropdown,
    createGenericVideoDurationDropdown,
} from '$src/components/proseMirror/plugins/primitives/aiControls/index.ts'
import { createPixiMediaLayer, type PixiMediaLayer, type SelectionColors } from '$src/infographics/workspace/pixiMediaLayer.ts'
import { createViewportBridge, type ViewportBridge } from '$src/infographics/workspace/rendering/viewportBridge.ts'
import { createMediaLibraryPanel } from '$src/infographics/workspace/mediaLibraryPanel.ts'
import { setPendingExtractionContext, getPendingExtractionContext, submitExtractionRequest, renderExtractionTabBody } from '$src/infographics/workspace/extractionTab.ts'
import {
    NEW_CHAT_DRAFT_KEY,
    getAiChatPanelState,
    setAiChatPanelState,
} from '$src/infographics/workspace/aiChatPanelState.ts'
import { createVideoControls, type VideoControlsInstance } from '$src/components/videoControls/index.ts'
import {
    createSlidingTabsSwitch,
    type SlidingTabsSwitchInstance,
} from '$src/components/slidingTabsSwitch/index.ts'
import { createHelpTooltip, type HelpTooltipInstance } from '$src/components/helpTooltip/index.ts'

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type ResizeHandle = ResizeCorner
type CollisionBox = { id: string; x: number; y: number; width: number; height: number }
type CollisionEntry = { node: CanvasNode; offset: { x: number; y: number } }
type CollisionPlan = {
    nodeBoxes: CollisionBox[]
    entries: Map<string, CollisionEntry>
    shouldResolvePair: (a: CollisionBox, b: CollisionBox) => boolean
}

const RESIZE_CORNERS: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const NODE_DRAG_START_THRESHOLD_PX = 6
const AI_CHAT_DRAFT_TAB_PREFIX = 'draft:'
const AI_CHAT_PANEL_CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES = [
    '--workspace-ai-chat-panel-context-preview-tooltip-background',
    '--workspace-ai-chat-panel-context-preview-tooltip-border',
    '--workspace-ai-chat-panel-context-preview-tooltip-border-radius',
    '--workspace-ai-chat-panel-context-preview-tooltip-box-shadow',
    '--workspace-ai-chat-panel-context-preview-tooltip-color',
    '--workspace-ai-chat-panel-context-preview-border-radius',
    '--workspace-ai-chat-panel-context-preview-video-background',
    '--workspace-ai-chat-panel-context-preview-video-glyph-background',
    '--workspace-ai-chat-panel-context-preview-video-glyph-color',
    '--workspace-ai-chat-panel-context-preview-document-color',
    '--workspace-ai-chat-panel-context-preview-document-icon-color',
    '--workspace-ai-chat-panel-context-preview-document-text-color',
    '--workspace-ai-chat-panel-context-preview-popover-title-color',
    '--workspace-ai-chat-panel-context-preview-popover-text-color',
]

function applyAiPromptInputStyleSettings(promptEl: HTMLElement): void {
    promptEl.style.setProperty('--dropdown-popover-box-shadow', settings.dropdown.styles.popoverBoxShadow)
}

function applyAiChatPanelSessionHistorySettings(panelEl: HTMLElement): void {
    const sessionHistoryStyles = settings.aiChatThread.sessionHistory.styles
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-control-color', sessionHistoryStyles.controlColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-control-hover-color', sessionHistoryStyles.controlHoverColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-history-toggle-hover-background', sessionHistoryStyles.historyToggleHoverBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-action-hover-background', sessionHistoryStyles.actionHoverBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-action-hover-color', sessionHistoryStyles.actionHoverColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-delete-color', sessionHistoryStyles.deleteColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-hover-background-image', sessionHistoryStyles.hoverBackgroundImage)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-thread-marker-background', sessionHistoryStyles.threadMarkerBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-session-thread-marker-box-shadow', sessionHistoryStyles.threadMarkerBoxShadow)
}

function applyAiChatPanelContextPreviewSettings(panelEl: HTMLElement): void {
    const contextPreviewStyles = settings.aiChatThread.contextPreview.styles
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-controls-color', contextPreviewStyles.controlsColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-chip-background', contextPreviewStyles.chipBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-trigger-border-radius', contextPreviewStyles.triggerBorderRadius)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-border-radius', contextPreviewStyles.previewBorderRadius)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-tooltip-background', contextPreviewStyles.tooltipBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-tooltip-border', contextPreviewStyles.tooltipBorder)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-tooltip-border-radius', contextPreviewStyles.tooltipBorderRadius)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-tooltip-box-shadow', contextPreviewStyles.tooltipBoxShadow)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-tooltip-color', contextPreviewStyles.tooltipColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-video-background', contextPreviewStyles.videoBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-video-glyph-background', contextPreviewStyles.videoGlyphBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-video-glyph-color', contextPreviewStyles.videoGlyphColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-document-color', contextPreviewStyles.documentColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-document-skeleton-line-border-radius', contextPreviewStyles.documentSkeletonLineBorderRadius)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-document-skeleton-line-background', contextPreviewStyles.documentSkeletonLineBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-document-icon-color', contextPreviewStyles.documentIconColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-document-text-color', contextPreviewStyles.documentTextColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-popover-title-color', contextPreviewStyles.popoverTitleColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-preview-popover-text-color', contextPreviewStyles.popoverTextColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-chip-remove-background', contextPreviewStyles.removeButtonBackground)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-chip-remove-color', contextPreviewStyles.removeButtonColor)
    panelEl.style.setProperty('--workspace-ai-chat-panel-context-chip-remove-box-shadow', contextPreviewStyles.removeButtonBoxShadow)
}

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

type ChatRootNode = AiChatThreadCanvasNode
type RenderActiveAiChatPanelOptions = {
    preserveTabsSwitch?: boolean
}

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

type PendingGeneratedMediaTracker = {
    nodeId: string
    fileId: string
    sourceNodeId?: string
    placementKey: string
}

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
    const connectorStyles = settings.connector.styles
    const selectionStyles = settings.selection.styles
    const imageNodeStyles = settings.imageNode.styles

    paneEl.style.setProperty('--connector-line-default-color', connectorStyles.lineDefaultColor)
    paneEl.style.setProperty('--connector-line-focus-color', connectorStyles.lineFocusColor)
    paneEl.style.setProperty('--selection-marquee-border-color', selectionStyles.marqueeBorderColor)
    paneEl.style.setProperty('--selection-marquee-background-color', selectionStyles.marqueeBackgroundColor)
    paneEl.style.setProperty('--selection-overlay-border-color', selectionStyles.overlayBorderColor)
    paneEl.style.setProperty('--selection-overlay-background-color', selectionStyles.overlayBackgroundColor)
    paneEl.style.setProperty('--selection-outline-color', selectionStyles.outlineColor)
    paneEl.style.setProperty('--workspace-image-default-box-shadow', imageNodeStyles.defaultBoxShadow)
    paneEl.style.setProperty('--workspace-image-selected-box-shadow', imageNodeStyles.selectedBoxShadow)
    paneEl.style.setProperty('--workspace-image-border-radius', `${imageNodeStyles.borderRadius}px`)
    paneEl.style.setProperty('--workspace-image-model-badge-box-shadow', imageNodeStyles.modelBadgeBoxShadow)

    let currentCanvasState: CanvasState | null = options.canvasState
    let currentDocuments: Document[] = options.documents
    let currentAiChatThreads: AiChatThread[] = options.aiChatThreads
    let panZoom: PanZoomInstance | null = null
    let lastTransform: Transform = [0, 0, 1]

    let connectionManager: WorkspaceConnectionManager | null = null
    let pixiMediaLayer: PixiMediaLayer | null = null
    let viewportBridge: ViewportBridge | null = null
    let imageChromeViewportEl: HTMLDivElement | null = null
    let generatedMediaChromeSyncRaf: number | null = null

    const liveNodeOverrides: Map<string, { position?: { x: number; y: number }; dimensions?: { width: number; height: number } }> = new Map()
    let edgesRaf: number | null = null
    let transformSideEffectsRaf: number | null = null
    let pendingHandleZoom: number | null = null
    let autoGrowRaf: number | null = null
    let selectedNodeIds: Set<string> = new Set()
    let selectedEdgeId: string | null = null
    const expandedGeneratedImageInfoNodeIds: Set<string> = new Set()
    const videoControlInstances: Map<string, VideoControlsInstance> = new Map()
    const videoControlsHideTimers: Map<string, number> = new Map()
    const VIDEO_CONTROLS_HEIGHT = 52
    const VIDEO_CONTROLS_HORIZONTAL_INSET = 18
    const VIDEO_CONTROLS_COMPACT_HORIZONTAL_INSET = 8
    const VIDEO_CONTROLS_BOTTOM_INSET = 14
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
    // Per-node debounce timers for document/thread descriptor regeneration. Keyed
    // by canvas nodeId so rapid edits collapse into one describe call once typing
    // (or a streaming transcript) settles.
    const textDescriptorTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    let activeAiChatRootNodeId: string | null = null
    let activeAiChatThreadId: string | null = null
    let activeAiChatPanelThreadId: string | null = null
    let activeAiChatPanelRootNodeId: string | null = null
    let activeAiChatPanelHadContent = false
    let activeAiChatPanelEl: HTMLDivElement | null = null
    let activeAiChatBackdropEl: HTMLDivElement | null = null
    let activeAiChatPanelTabsSwitch: SlidingTabsSwitchInstance<string> | null = null
    let activeAiChatPromptEditor: any = null
    let activeAiChatPromptGradient: { destroy: () => void; triggerAnimation: () => void } | null = null
    let activeAiChatPromptResizeObserver: ResizeObserver | null = null
    let activeAiChatPanelRailHeightFrame: number | null = null
    let activeContextChipTrayEl: HTMLDivElement | null = null
    const activeContextPreviewTooltips: Set<HelpTooltipInstance> = new Set()
    let contextPreviewRefreshVersion = 0
    let mediaLibraryPanelInstance: ReturnType<typeof createMediaLibraryPanel> | null = null
    const mediaLibraryService = new MediaLibraryService()
    let activeAiChatSidebarThreadId: string | null = null
    let activeAiChatSidebarTabId: string | null = null
    let aiChatSidebarTabs: CanvasAiChatSidebarTab[] = []
    let aiChatPanelState: CanvasAiChatPanelState = getAiChatPanelState(currentCanvasState)
    let extractionSessionHistoryLoaded = false
    let pendingLocalCanvasVisualCommit: PendingCanvasVisualCommit | null = null
    let nodePointerPanLockNodeId: string | null = null
    let paneNoPanAddedForNodePointer = false
    const partialImageTracker = new Map<string, PendingGeneratedMediaTracker>()
    const generatingReferenceNodeIdsByThread = new Map<string, Set<string>>()
    // Visibility tracking for lazy loading
    const visibleNodeIds: Set<string> = new Set()
    const loadedNodeIds: Set<string> = new Set()
    let paneRect: DOMRect | null = null

    // Image lifecycle tracker - handles deletion of orphaned images
    const canvasImageLifecycle = createCanvasImageLifecycleTracker()
    canvasImageLifecycle.initializeFromCanvasState(currentCanvasState)

    // Video lifecycle tracker (sibling of canvasImageLifecycle) — deletes the
    // MP4 + poster from the workspace Object Store when a VideoCanvasNode is
    // removed from canvas state.
    const canvasVideoLifecycle = createCanvasVideoLifecycleTracker()
    canvasVideoLifecycle.initializeFromCanvasState(currentCanvasState)

    // Pending video-generation tracker: mirrors partialImageTracker. VEO has no
    // partial frames, so the sequence is VIDEO_PENDING (create placeholder +
    // tracker entry) -> VIDEO_GENERATING keepalives (no state mutation) ->
    // VIDEO_COMPLETE (finalize the same node + clear tracker). Source-shape
    // tests guard that this is the ONLY tracker used for video generation —
    // there is no DOM spinner, mirroring PR #202's image pattern.
    const videoGenerationTracker = new Map<string, PendingGeneratedMediaTracker>()
    let videoNodeHandler: VideoNodeHandlerControl | null = null

    const pixiSelectionColors: SelectionColors = {
        marqueeStroke: selectionStyles.marqueeBorderColor,
        marqueeFill: selectionStyles.marqueeBackgroundColor,
        groupOverlayStroke: selectionStyles.overlayBorderColor,
        groupOverlayFill: selectionStyles.overlayBackgroundColor,
    }
    pixiMediaLayer = createPixiMediaLayer({
        paneEl,
        viewportEl,
        getWorkspaceId: () => workspaceId,
        selectionColors: pixiSelectionColors,
        onImageIntrinsicSize: handleImageIntrinsicSize,
    })
    // Register the VideoCanvasNode handler with the PIXI media layer's
    // mediaNodeRegistry. The handler owns the poster/placeholder sprite and the
    // attached HTMLVideoElement; completed playback is composited by moving that
    // element into the chrome layer, above PIXI.
    {
        const mediaRegistry = pixiMediaLayer?.getMediaNodeRegistry?.()
        const videoLayer = pixiMediaLayer?.getVideoLayer?.()
        if (mediaRegistry && videoLayer) {
            videoNodeHandler = createVideoNodeHandler({
                videoLayer,
                onIntrinsicSize: handleVideoIntrinsicSize,
                onRender: () => pixiMediaLayer?.scheduleRender?.(),
                onVideoElementReady: () => scheduleGeneratedMediaChromeSync(),
            })
            mediaRegistry.register(videoNodeHandler)
        }
    }
    imageChromeViewportEl = createImageChromeViewport()
    viewportBridge = createViewportBridge({
        viewportEl,
        viewportOverlayEls: [imageChromeViewportEl],
        getPixiLayers: () => [pixiMediaLayer],
    })
    if (currentCanvasState?.viewport) {
        viewportBridge.applyViewport(currentCanvasState.viewport)
    }
    syncPixiMediaLayer(currentCanvasState)

    // Canvas bubble menu for image nodes (delete, create variant)
    let canvasBubbleMenu: BubbleMenu | null = null
    let canvasBubbleMenuItems: ReturnType<typeof buildCanvasBubbleMenuItems> | null = null

    // In-place confirmation for canvas actions (e.g. saving an image to the Media Library).
    // Auto-dismisses via a single CSS animation, removed on animationend.
    let canvasToastEl: HTMLElement | null = null
    function showCanvasToast(message: string, variant: 'success' | 'error') {
        canvasToastEl?.remove()
        const toastEl = html`<div className=${`media-library-toast media-library-toast-${variant}`} role="status" aria-live="polite">${message}</div>` as HTMLElement
        toastEl.addEventListener('animationend', () => {
            toastEl.remove()
            if (canvasToastEl === toastEl) canvasToastEl = null
        })
        paneEl.appendChild(toastEl)
        canvasToastEl = toastEl
    }

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
                const currentCurve = edge.pathType ?? settings.connector.lineCurve
                const newCurve = currentCurve === 'horizontal-bezier' ? 'orthogonal' : 'horizontal-bezier'

                const updatedEdge = { ...edge, pathType: newCurve }
                const newEdges = [...currentCanvasState.edges]
                newEdges[edgeIndex] = updatedEdge

                commitCanvasState({
                    ...currentCanvasState,
                    edges: newEdges
                })
            },
            onDeleteNode: async (nodeId) => {
                if (!currentCanvasState) return

                const deletedNode = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
                const remainingNodes = currentCanvasState.nodes.filter((n: CanvasNode) => n.nodeId !== nodeId)
                const updatedEdges = currentCanvasState.edges.filter(
                    (e: WorkspaceEdge) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId
                )

                // Re-tidy only when a lineage member left a tree. Deleting an
                // unrelated, non-tree node must never trigger tree layout (loose
                // nodes and trees interact only as rigid blocks, never by snapping).
                const updatedNodes = deletedNode && isBranchTreeCanvasNode(deletedNode)
                    ? rebalanceGeneratedMediaTrees(remainingNodes, updatedEdges)
                    : remainingNodes

                selectNode(null)
                commitCanvasState({ ...currentCanvasState, nodes: updatedNodes, edges: updatedEdges })
            },
            onDownloadMedia: (nodeId) => {
                const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
                if (!node || (node.type !== 'image' && node.type !== 'video')) return

                void (async () => {
                    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                    const token = await AuthService.getTokenSilently()
                    const strippedSrc = node.src.replace(/[?&]token=[^&]+/, '')
                    const route = node.type === 'video' ? 'videos' : 'images'
                    const isStoredMedia = strippedSrc.startsWith('/api/') || (strippedSrc.startsWith('http') && strippedSrc.includes(`/api/${route}/`))
                    const resolvedSrc = isStoredMedia ? `/api/${route}/${workspaceId}/${node.fileId}` : strippedSrc
                    const mediaSrc = buildImageSrc(resolvedSrc, API_BASE_URL, token || false)
                    await downloadImage(mediaSrc, {
                        getAuthToken: async () => {
                            const freshToken = await AuthService.getTokenSilently()
                            return freshToken || ''
                        }
                    })
                })()
            },
            onReplaceMedia: (nodeId) => {
                const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
                if (!node || (node.type !== 'image' && node.type !== 'video')) return

                const accept = node.type === 'video' ? 'video/mp4' : 'image/*'
                const expectedMimePrefix = node.type === 'video' ? 'video/' : 'image/'
                const input = html`<input type="file" accept=${accept} style=${{ display: 'none' }}></input>` as HTMLInputElement
                input.addEventListener('change', async () => {
                    const file = input.files?.[0]
                    input.remove()
                    if (!file || !file.type.startsWith(expectedMimePrefix)) return

                    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                    const token = await AuthService.getTokenSilently()
                    if (!token) return

                    const formData = new FormData()
                    formData.append('file', file)

                    const route = node.type === 'video' ? 'videos' : 'images'
                    const response = await fetch(`${API_BASE_URL}/api/${route}/${workspaceId}`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    })

                    if (!response.ok) return

                    const data = await response.json() as {
                        fileId?: string
                        url?: string
                        posterFileId?: string
                        posterUrl?: string
                    }
                    if (!data.fileId || !data.url) return

                    const newSrc = `${API_BASE_URL}${data.url}?token=${encodeURIComponent(token)}`
                    const newPosterSrc = data.posterUrl
                        ? `${API_BASE_URL}${data.posterUrl}?token=${encodeURIComponent(token)}`
                        : ''

                    // Update canvas state; the PIXI sprite replaces its texture.
                    if (!currentCanvasState) return
                    const updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) => {
                        if (n.nodeId !== nodeId) return n
                        if (n.type === 'image' && node.type === 'image') {
                            return { ...n, fileId: data.fileId, src: newSrc } as ImageCanvasNode
                        }
                        if (n.type === 'video' && node.type === 'video') {
                            return {
                                ...n,
                                fileId: data.fileId,
                                posterFileId: data.posterFileId ?? '',
                                frameFileId: undefined,
                                src: newSrc,
                                posterSrc: newPosterSrc,
                                descriptor: data.posterFileId ? buildAnalyzingDescriptor() : n.descriptor,
                            } as VideoCanvasNode
                        }
                        return n
                    })
                    commitCanvasState({ ...currentCanvasState, nodes: updatedNodes })
                    if (node.type === 'video' && data.posterFileId) {
                        void analyzeUploadedMedia(nodeId, data.posterFileId)
                    }
                })
                document.body.appendChild(input)
                input.click()
            },
            canAddToMediaLibrary: (nodeId) => {
                if (!nodeId || !currentCanvasState) return false
                const node = currentCanvasState.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
                if (!node) return false
                if (node.type === 'image') {
                    if (!node.fileId) return false
                    return !Array.from(partialImageTracker.values()).some((partial) => partial.nodeId === nodeId)
                }
                if (node.type === 'video') {
                    if (!node.fileId) return false
                    return !Array.from(videoGenerationTracker.values()).some((pending) => pending.nodeId === nodeId)
                }
                return false
            },
            onAddToMediaLibrary: async (nodeId) => {
                const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
                if (!node) return
                if (node.type === 'image') {
                    if (!node.fileId) return
                    if (Array.from(partialImageTracker.values()).some((partial) => partial.nodeId === nodeId)) return
                    try {
                        const response = await mediaLibraryService.addCanvasImage({ workspaceId, fileId: node.fileId })
                        if (response.error || !response.itemId) {
                            console.error('Failed to add image to Media Library:', response.error ?? 'No saved item was returned.')
                            showCanvasToast('Could not save image to Media Library.', 'error')
                            return
                        }
                        const savedName = response.displayName ? `"${response.displayName}"` : 'Image'
                        showCanvasToast(
                            response.deduplicated
                                ? `${savedName} is already in your Media Library.`
                                : `${savedName} saved to Media Library.`,
                            'success',
                        )
                    } catch (error) {
                        console.error('Failed to add image to Media Library:', error)
                        showCanvasToast('Could not save image to Media Library.', 'error')
                    }
                    return
                }
                if (node.type === 'video') {
                    if (!node.fileId) return
                    if (Array.from(videoGenerationTracker.values()).some((pending) => pending.nodeId === nodeId)) return
                    try {
                        const response = await mediaLibraryService.addCanvasVideo({
                            workspaceId,
                            fileId: node.fileId,
                            posterFileId: node.posterFileId || undefined,
                            durationSeconds: node.durationSeconds || 0,
                            aspectRatio: node.aspectRatio || 1,
                            hasAudio: node.hasAudio ?? false,
                        })
                        if (response.error || !response.itemId) {
                            console.error('Failed to add video to Media Library:', response.error ?? 'No saved item was returned.')
                            showCanvasToast('Could not save video to Media Library.', 'error')
                            return
                        }
                        const savedName = response.displayName ? `"${response.displayName}"` : 'Video'
                        showCanvasToast(
                            response.deduplicated
                                ? `${savedName} is already in your Media Library.`
                                : `${savedName} saved to Media Library.`,
                            'success',
                        )
                    } catch (error) {
                        console.error('Failed to add video to Media Library:', error)
                        showCanvasToast('Could not save video to Media Library.', 'error')
                    }
                    return
                }
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
                    persistFeatureExtractionState({
                        extractionRunId,
                        status: 'pending',
                        sourceContextSnapshot: {
                            imageNatsUrl,
                            contextMessages: contextMessage ? [contextMessage] : [],
                        },
                        updatedAt: Date.now(),
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
            onExtendVideoInNewThread: async (nodeId) => {
                // Mirrors onEditInNewThread (image edit) but seeds the new
                // thread with `sourceVideoNodeId` so the VEO extension input
                // resolves at submit time. Carry video model + generation
                // params across so the user does not have to re-pick.
                const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                if (!aiChatThreadService) {
                    console.error('AI Chat Thread service not available')
                    return
                }

                const sourceVideoNode = currentCanvasState?.nodes.find(
                    (n: CanvasNode) => n.nodeId === nodeId && n.type === 'video'
                ) as VideoCanvasNode | undefined
                if (!sourceVideoNode) return

                try {
                    const threadId = uuidv4()
                    const rawVideoModel = String(sourceVideoNode.generatedBy?.videoModel ?? '')
                    const videoModelProvider = String(sourceVideoNode.generatedBy?.videoModelProvider ?? '')
                    const inheritedVideoModel = rawVideoModel
                        ? (rawVideoModel.includes(':')
                            ? rawVideoModel
                            : (videoModelProvider ? `${videoModelProvider}:${rawVideoModel}` : rawVideoModel))
                        : ''
                    const inheritedAspectRatio = sourceVideoNode.generatedBy?.aspectRatio ?? ''
                    const inheritedResolution = sourceVideoNode.generatedBy?.resolution ?? ''
                    const inheritedDuration = sourceVideoNode.generatedBy?.durationSeconds != null
                        ? String(sourceVideoNode.generatedBy.durationSeconds)
                        : ''

                    const initialContent = {
                        type: 'doc',
                        content: [
                            {
                                type: 'documentTitle',
                                content: [{ type: 'text', text: 'Extend Video' }]
                            },
                            {
                                type: 'aiChatThread',
                                attrs: {
                                    threadId,
                                    sourceVideoNodeId: nodeId,
                                    aiVideoModel: inheritedVideoModel,
                                    videoAspectRatio: inheritedAspectRatio,
                                    videoResolution: inheritedResolution,
                                    videoDuration: inheritedDuration,
                                },
                                content: [
                                    {
                                        type: 'aiUserMessage',
                                        attrs: { id: uuidv4(), createdAt: Date.now() },
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [{ type: 'text', text: 'Describe how you want to extend this video...' }]
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
                        aiModel: 'openai:gpt-4o'
                    })

                    if (!thread) return

                    const existingNodes = currentCanvasState?.nodes || []
                    const threadDimensions = { ...settings.aiChatThread.defaultDimensions }
                    const fallbackPosition = getCenteredInsertionPosition(threadDimensions)
                    const sourceVideoRect = getNodeWorldRect(sourceVideoNode)
                    const threadPosition = sourceVideoRect
                        ? { x: sourceVideoRect.x + sourceVideoRect.width + settings.aiChatThread.adjacentNodeGap, y: sourceVideoRect.y }
                        : fallbackPosition

                    const threadNode: AiChatThreadCanvasNode = {
                        nodeId: `node-${thread.threadId}`,
                        type: 'aiChatThread',
                        referenceId: thread.threadId,
                        position: threadPosition,
                        dimensions: threadDimensions,
                    }

                    const newCanvasState: CanvasState = {
                        viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                        edges: currentCanvasState?.edges ?? [],
                        nodes: resolveTopLevelNodeCollisions([...existingNodes, threadNode])
                    }

                    const newEdge: WorkspaceEdge = {
                        edgeId: `edge-${sourceVideoNode.nodeId}-${threadNode.nodeId}`,
                        sourceNodeId: sourceVideoNode.nodeId,
                        targetNodeId: threadNode.nodeId,
                        sourceHandle: 'right',
                        targetHandle: 'left'
                    }
                    newCanvasState.edges = [...(newCanvasState.edges || []), newEdge]

                    onCanvasStateChange?.(newCanvasState)
                    activeAiChatThreadId = thread.threadId
                    activeAiChatRootNodeId = threadNode.nodeId
                    requestAnimationFrame(() => {
                        renderActiveAiChatPanel(threadNode, thread)
                    })
                } catch (error) {
                    console.error('Failed to create extend video thread:', error)
                }
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

    function getForegroundNodeHit(point: { x: number; y: number }): CanvasNode | null {
        if (!currentCanvasState) return null
        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        for (let i = currentCanvasState.nodes.length - 1; i >= 0; i--) {
            const node = currentCanvasState.nodes[i]
            if (node.type !== 'image' && node.type !== 'video' && node.type !== 'document' && node.type !== 'aiChatThread' && node.type !== 'branchOrigin') continue
            const rect = getNodeWorldRect(node, nodesById)
            if (rectContainsCanvasPoint(rect, point)) return node
        }
        return null
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

    function syncCanvasNodeDomGeometry(nodes: CanvasNode[]): void {
        if (!viewportEl) return

        const nodesById = getCanvasNodesById(nodes)
        for (const node of nodes) {
            const position = getNodeWorldPosition(node, nodesById)
            const nodeEl = viewportEl.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
            if (nodeEl) {
                applyStyle(nodeEl, {
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    width: `${node.dimensions.width}px`,
                    height: `${node.dimensions.height}px`,
                })
            }
            updateGeneratedImageChromeLiveTransform(node.nodeId, position, node.dimensions)
        }

        repositionAllThreadFloatingInputs()
        updateSelectionGroupOverlayElement()
        repositionCanvasBubbleMenu()
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

    function getVideoControlsChromeLayout(nodeWidth: number): { insetX: number; width: number } {
        const insetX = nodeWidth >= 260 ? VIDEO_CONTROLS_HORIZONTAL_INSET : VIDEO_CONTROLS_COMPACT_HORIZONTAL_INSET
        return {
            insetX,
            width: Math.max(1, nodeWidth - insetX * 2),
        }
    }

    function getVideoChromeResizeHandle(event: MouseEvent, chromeEl: HTMLElement): ResizeCorner | null {
        const rect = chromeEl.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        const { size, offset } = settings.imageNode.useZoomCompensatedResizeHandleScaling
            ? getResizeHandleScaledSizes(getCurrentViewportZoom())
            : { size: 24, offset: 6 }
        const hitSize = Math.max(16, size + Math.max(0, offset))

        if (x <= hitSize && y <= hitSize) return 'top-left'
        if (x >= rect.width - hitSize && y <= hitSize) return 'top-right'
        if (x <= hitSize && y >= rect.height - hitSize) return 'bottom-left'
        if (x >= rect.width - hitSize && y >= rect.height - hitSize) return 'bottom-right'
        return null
    }

    // The video controls chrome spans the whole node so hover is reliable over
    // the visible video surface. Controls capture their own events; the remaining
    // chrome surface mirrors the node drag/click hit target.
    function applyVideoControlsGeometry(
        chromeEl: HTMLElement,
        position: { x: number; y: number },
        dimensions: { width: number; height: number }
    ): void {
        applyStyle(chromeEl, {
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
        })

        const { insetX, width } = getVideoControlsChromeLayout(dimensions.width)
        const host = chromeEl.querySelector('.workspace-video-controls-host') as HTMLElement | null
        if (host) {
            applyStyle(host, {
                left: `${insetX}px`,
                bottom: `${VIDEO_CONTROLS_BOTTOM_INSET}px`,
                width: `${width}px`,
                height: `${VIDEO_CONTROLS_HEIGHT}px`,
            })
        }

        // The controls host is bottom-pinned inside the node-sized chrome. Keep
        // the SVG viewBox synced to the pill width at any zoom/resize.
        const svg = chromeEl.querySelector('.workspace-video-controls-svg') as SVGSVGElement | null
        svg?.setAttribute('viewBox', `0 0 ${width} ${VIDEO_CONTROLS_HEIGHT}`)
        svg?.setAttribute('height', String(VIDEO_CONTROLS_HEIGHT))
        const controls = videoControlInstances.get(chromeEl.dataset.videoChromeNodeId || '')
        controls?.resize(0, 0, width)
    }

    function updateGeneratedImageChromeLiveTransform(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number }
    ): void {
        const chromeEl = imageChromeViewportEl?.querySelector(`[data-image-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (chromeEl) applyGeneratedImageChromeGeometry(chromeEl, position, dimensions)
        const videoChromeEl = imageChromeViewportEl?.querySelector(`[data-video-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (videoChromeEl) applyVideoControlsGeometry(videoChromeEl, position, dimensions)
    }

    function appendTextParagraph(host: HTMLElement, text: string, fallbackText: string): void {
        const value = text.trim()
        const className = value ? 'canvas-generated-image-info-text' : 'canvas-generated-image-info-empty'
        host.replaceChildren(html`<p className=${className}>${value || fallbackText}</p>`)
    }

    // The node's compact descriptor (summary + tags) — shown for ALL media,
    // including uploads with no generation metadata. Returns null when there is
    // nothing useful to show (no descriptor, or analysis failed).
    function buildMediaDescriptorSection(descriptor: MediaDescriptor | undefined): HTMLElement | null {
        if (!descriptor) return null
        if (descriptor.status === 'analyzing') {
            return html`
                <div className="canvas-media-descriptor is-analyzing">
                    <span className="canvas-media-descriptor-label">Analyzing media…</span>
                    <p className="canvas-media-descriptor-summary">Generating a short description of this media. It runs once and is reused later.</p>
                </div>
            ` as HTMLElement
        }
        if (descriptor.status === 'failed' || !descriptor.summary) return null

        const section = html`
            <div className="canvas-media-descriptor">
                <span className="canvas-media-descriptor-label">Description</span>
                <p className="canvas-media-descriptor-summary">${descriptor.summary}</p>
            </div>
        ` as HTMLElement
        const tags = [...descriptor.entityTags, ...descriptor.styleTags]
        if (tags.length > 0) {
            const tagsEl = html`<div className="canvas-media-descriptor-tags"></div>` as HTMLElement
            for (const tag of tags) {
                tagsEl.appendChild(html`<span className="canvas-media-descriptor-tag">${tag}</span>` as HTMLElement)
            }
            section.appendChild(tagsEl)
        }
        return section
    }

    // Shared info panel for generated AND uploaded media (image or video). When
    // the node carries generation context it shows the prompt/response shells and
    // the reusable generation-trace details (image OR video trace); for every
    // media object it appends the compact descriptor.
    function createGeneratedMediaInfoPanel(node: ImageCanvasNode | VideoCanvasNode): HTMLElement {
        const generatedBy = node.generatedBy
        const panel = html`<div className="canvas-generated-image-info-panel nopan"></div>` as HTMLElement

        if (generatedBy) {
            const thread = currentAiChatThreads.find((candidate: AiChatThread) => candidate.threadId === generatedBy.aiChatThreadId)
            const turnInfo = getGeneratedImageTurnInfoFromThreadContent(thread?.content, generatedBy.responseMessageId)
            const modelName = node.type === 'video'
                ? String((generatedBy as VideoCanvasNode['generatedBy'])?.videoModel || '')
                : String((generatedBy as ImageCanvasNode['generatedBy'])?.aiModel || '')
            const userPromptText = turnInfo?.userPromptText || generatedBy.promptText || ''
            const responseText = turnInfo?.responseText || generatedBy.revisedPrompt || ''
            const responseProvider = turnInfo?.responseProvider || modelName
            const userShell = createAiUserMessageShell({ wrapperClassName: 'canvas-generated-image-user' })
            const responseShell = createAiResponseMessageShell({
                provider: responseProvider,
                wrapperClassName: 'canvas-generated-image-response',
                includeSpinner: false,
            })
            panel.appendChild(userShell.wrapper)
            panel.appendChild(responseShell.wrapper)

            appendTextParagraph(userShell.contentEl, userPromptText, 'Original prompt unavailable.')
            appendTextParagraph(responseShell.contentEl, responseText, 'AI response details unavailable.')

            const trace = turnInfo?.imageGenerationTrace ?? turnInfo?.videoGenerationTrace ?? null
            if (trace) {
                const isVideoTrace = Boolean(turnInfo?.videoGenerationTrace)
                const traceDetails = createImageGenerationTraceDetails({
                    className: 'canvas-generated-image-trace-details',
                    renderReferencesWhenClosed: true,
                })
                traceDetails.dom.open = true
                traceDetails.render({
                    attrs: {
                        title: isVideoTrace ? 'Video generation details' : 'Image generation details',
                        isOpen: true,
                        isStreaming: false,
                        imageGenerationTrace: isVideoTrace ? null : turnInfo!.imageGenerationTrace,
                        videoGenerationTrace: isVideoTrace ? turnInfo!.videoGenerationTrace : null,
                        imageGenerationTraceId: null,
                    },
                    childCount: turnInfo!.imageGenerationPromptText ? 1 : 0,
                    forceToolPromptFallback: true,
                    toolPromptFallbackText: turnInfo!.imageGenerationPromptText || trace.toolPrompt,
                })
                responseShell.contentEl.appendChild(traceDetails.dom)
            }
        }

        const descriptorSection = buildMediaDescriptorSection(node.descriptor)
        if (descriptorSection) panel.appendChild(descriptorSection)

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

    // Shared info (i) button used by both image and video chrome. Pulses while
    // the media descriptor is still being analyzed and explains itself on hover.
    function createMediaInfoButton(node: ImageCanvasNode | VideoCanvasNode): HTMLButtonElement {
        const analyzing = node.descriptor?.status === 'analyzing'
        const isExpanded = expandedGeneratedImageInfoNodeIds.has(node.nodeId)
        const title = analyzing ? 'Analyzing media — generating a description…' : 'Media details'
        const button = html`
            <button
                className=${`image-info-button nopan${isExpanded ? ' is-active' : ''}${analyzing ? ' is-analyzing' : ''}`}
                type="button"
                aria-label=${title}
                aria-expanded=${String(isExpanded)}
                title=${title}
            >
                <span innerHTML=${infoCircleIcon}></span>
            </button>
        ` as HTMLButtonElement
        button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toggleGeneratedImageInfo(node.nodeId)
        })
        return button
    }

    // Provenance/descriptor chrome (provider badge + info button + expandable
    // panel) rendered as a strip BELOW the node — identical placement for image
    // and video so the info affordance is consistent across media. The video
    // control bar is a SEPARATE overlay (createVideoControlsChrome).
    function createGeneratedMediaChrome(node: ImageCanvasNode | VideoCanvasNode): HTMLElement {
        const generatedBy = node.generatedBy
        const modelProvider = (node.type === 'video'
            ? (generatedBy as VideoCanvasNode['generatedBy'])?.videoModelProvider
            : (generatedBy as ImageCanvasNode['generatedBy'])?.imageModelProvider) || ''
        const providerIcon = getAiProviderIcon(modelProvider)
        const isExpanded = expandedGeneratedImageInfoNodeIds.has(node.nodeId)
        const chromeEl = html`
            <div className="workspace-generated-image-chrome" data=${{ imageChromeNodeId: node.nodeId }}>
                <div className="workspace-generated-image-actions">
                    ${providerIcon ? html`<div className="image-model-badge" innerHTML=${providerIcon} title=${modelProvider}></div>` : null}
                    ${createMediaInfoButton(node)}
                </div>
                ${isExpanded ? createGeneratedMediaInfoPanel(node) : null}
            </div>
        ` as HTMLElement

        applyGeneratedImageChromeGeometry(chromeEl, getNodeWorldPosition(node), node.dimensions)
        return chromeEl
    }

    // Video chrome for completed video nodes: the actual <video> shown on the node
    // PLUS the SVG control bar, both in the transform-synced chrome layer (above
    // the PIXI poster). The element MUST be visibly composited — the browser
    // throttles frame production for a <video> it isn't rendering, so sampling a
    // hidden element into a PIXI texture renders blank on play (it only decodes
    // when made visible, e.g. fullscreen). Showing the real element is what makes
    // playback, PiP and fullscreen work; the opaque surface covers the redundant
    // PIXI sprite behind it.
    function createVideoControlsChrome(node: VideoCanvasNode): HTMLElement | null {
        const videoEl = videoNodeHandler?.getVideoElement(node.nodeId)
        if (!videoEl) return null
        if (!videoEl.currentSrc && !videoEl.src) return null

        const { insetX, width: controlsWidth } = getVideoControlsChromeLayout(node.dimensions.width)
        const controlsHostStyle = {
            position: 'absolute' as const,
            left: `${insetX}px`,
            bottom: `${VIDEO_CONTROLS_BOTTOM_INSET}px`,
            width: `${controlsWidth}px`,
            height: `${VIDEO_CONTROLS_HEIGHT}px`,
        }
        const chromeEl = html`
            <div className="workspace-video-chrome nopan" data=${{ videoChromeNodeId: node.nodeId }}>
                <div className="workspace-video-surface"></div>
                <div className="workspace-video-controls-host nopan" style=${controlsHostStyle}></div>
            </div>
        ` as HTMLElement

        // Move the handler's <video> out of its off-screen host and onto the node
        // so it actually renders (and plays).
        const surface = chromeEl.querySelector('.workspace-video-surface') as HTMLDivElement
        surface.appendChild(videoEl)

        const isControlsEvent = (event: Event): boolean => {
            const target = event.target as HTMLElement | null
            return Boolean(target?.closest('.workspace-video-controls-host'))
        }
        const togglePlayback = (event: Event) => {
            if (isControlsEvent(event)) return
            event.preventDefault()
            event.stopPropagation()
            if (videoNodeHandler?.hasEntry(node.nodeId)) {
                videoNodeHandler.toggle(node.nodeId).catch(() => {})
            }
        }

        chromeEl.addEventListener('mouseenter', () => showVideoControls(node.nodeId))
        chromeEl.addEventListener('mousemove', (event: MouseEvent) => {
            showVideoControls(node.nodeId)
            if (isControlsEvent(event)) return
            const resizeHandle = getVideoChromeResizeHandle(event, chromeEl)
            chromeEl.style.cursor = resizeHandle ? getResizeCursorForHandle(resizeHandle) : 'move'
        })
        chromeEl.addEventListener('mouseleave', () => {
            chromeEl.style.cursor = ''
            hideVideoControls(node.nodeId)
        })
        chromeEl.addEventListener('mousedown', (event: MouseEvent) => {
            if (isControlsEvent(event)) return
            const resizeHandle = getVideoChromeResizeHandle(event, chromeEl)
            if (resizeHandle) {
                handleResizeStart(event, node.nodeId, resizeHandle)
                return
            }
            handleDragStart(event, node.nodeId)
        })
        chromeEl.addEventListener('dblclick', togglePlayback)

        // Controls auto-hide: revealed on hover of the node chrome or bar.
        const host = chromeEl.querySelector('.workspace-video-controls-host') as HTMLDivElement
        host.addEventListener('mouseenter', () => showVideoControls(node.nodeId))
        host.addEventListener('mouseleave', () => hideVideoControls(node.nodeId))

        const svg = select(host)
            .append('svg')
            .attr('class', 'workspace-video-controls-svg')
            .attr('width', '100%')
            .attr('height', String(VIDEO_CONTROLS_HEIGHT))
            .attr('viewBox', `0 0 ${controlsWidth} ${VIDEO_CONTROLS_HEIGHT}`)
            .style('display', 'block')
            .style('overflow', 'visible')

        const controls = createVideoControls(svg, {
            id: node.nodeId,
            x: 0,
            y: 0,
            width: controlsWidth,
            height: VIDEO_CONTROLS_HEIGHT,
            videoEl,
            className: 'workspace-video-controls',
        })
        videoControlInstances.set(node.nodeId, controls)
        applyVideoControlsGeometry(chromeEl, getNodeWorldPosition(node), node.dimensions)
        return chromeEl
    }

    function destroyVideoControlInstances(): void {
        for (const timer of videoControlsHideTimers.values()) clearTimeout(timer)
        videoControlsHideTimers.clear()
        for (const controls of videoControlInstances.values()) {
            controls.destroy()
        }
        videoControlInstances.clear()
    }

    function scheduleGeneratedMediaChromeSync(): void {
        if (generatedMediaChromeSyncRaf !== null) return
        generatedMediaChromeSyncRaf = requestAnimationFrame(() => {
            generatedMediaChromeSyncRaf = null
            syncGeneratedImageChrome(currentCanvasState)
        })
    }

    // Show/hide the auto-hiding control bar for a video node. The hide is debounced
    // so moving between the visible video surface and the bar doesn't flicker the
    // controls off.
    function showVideoControls(nodeId: string): void {
        const pending = videoControlsHideTimers.get(nodeId)
        if (pending !== undefined) {
            clearTimeout(pending)
            videoControlsHideTimers.delete(nodeId)
        }
        imageChromeViewportEl
            ?.querySelector(`[data-video-chrome-node-id="${nodeId}"] .workspace-video-controls-host`)
            ?.classList.add('is-visible')
    }

    function hideVideoControls(nodeId: string): void {
        const pending = videoControlsHideTimers.get(nodeId)
        if (pending !== undefined) clearTimeout(pending)
        const timer = window.setTimeout(() => {
            videoControlsHideTimers.delete(nodeId)
            imageChromeViewportEl
                ?.querySelector(`[data-video-chrome-node-id="${nodeId}"] .workspace-video-controls-host`)
                ?.classList.remove('is-visible')
        }, 140)
        videoControlsHideTimers.set(nodeId, timer)
    }

    function syncGeneratedImageChrome(canvasState: CanvasState | null = currentCanvasState): void {
        if (!imageChromeViewportEl) return
        // Generated/uploaded media (image OR video) carrying generation metadata
        // or a descriptor gets the below-node provenance chrome (info button +
        // panel + analyzing pulse) — placed identically for both media types.
        const mediaInfoNodes = (canvasState?.nodes ?? [])
            .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                (node.type === 'image' || node.type === 'video')
                && Boolean((node as ImageCanvasNode | VideoCanvasNode).generatedBy || (node as ImageCanvasNode | VideoCanvasNode).descriptor))

        destroyVideoControlInstances()

        // Completed video nodes (those with a stored MP4 src) get the shared SVG
        // control bar in the same chrome layer.
        const playableVideoNodes = (canvasState?.nodes ?? [])
            .filter((node: CanvasNode): node is VideoCanvasNode => node.type === 'video' && Boolean((node as VideoCanvasNode).src))
        const videoChromeEls = playableVideoNodes
            .map(createVideoControlsChrome)
            .filter((el): el is HTMLElement => Boolean(el))

        // Drop expanded state for nodes that no longer show info chrome, so a
        // deleted node doesn't leak an orphaned open panel.
        const infoNodeIds = new Set<string>(mediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => node.nodeId))
        for (const expandedNodeId of Array.from(expandedGeneratedImageInfoNodeIds)) {
            if (!infoNodeIds.has(expandedNodeId)) expandedGeneratedImageInfoNodeIds.delete(expandedNodeId)
        }

        imageChromeViewportEl.replaceChildren(
            ...mediaInfoNodes.map(createGeneratedMediaChrome),
            ...videoChromeEls,
        )
    }

    function syncPixiGeneratingImageNodes(): void {
        // Feeds the PIXI traveling outline (snake border) renderer with the set
        // of currently-generating media nodes, both image and video. Before the
        // first generated variant arrives, selected/reference media also
        // participate so users can see which source pixels are conditioning the
        // request. Once pixels arrive, only the generated node keeps animating.
        const generatingIds = new Set<string>()
        for (const partial of partialImageTracker.values()) generatingIds.add(partial.nodeId)
        for (const pending of videoGenerationTracker.values()) generatingIds.add(pending.nodeId)
        for (const referenceNodeIds of generatingReferenceNodeIdsByThread.values()) {
            for (const nodeId of referenceNodeIds) generatingIds.add(nodeId)
        }
        pixiMediaLayer?.setGeneratingImageNodes(generatingIds)
    }

    function syncPixiMediaLayer(canvasState: CanvasState | null = currentCanvasState): void {
        syncPixiGeneratingImageNodes()
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

    // Mirror of handleImageIntrinsicSize, fired when the attached <video>
    // reports the MP4's intrinsic width/height via loadedmetadata. Re-fits the
    // canvas node dimensions to the real aspect, preserves the node's current
    // center, then lets branch-tree layout re-tidy generated lineages. This
    // prevents final aspect-ratio updates from collapsing forked children back
    // onto the old predecessor center line.
    function handleVideoIntrinsicSize(size: { nodeId: string; width: number; height: number }): void {
        if (!currentCanvasState) return
        if (draggingNodeId === size.nodeId || resizingNodeId === size.nodeId) return
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return

        const intrinsicAspectRatio = size.width / size.height
        if (!Number.isFinite(intrinsicAspectRatio) || intrinsicAspectRatio <= 0) return

        const videoNode = currentCanvasState.nodes.find(
            (node: CanvasNode): node is VideoCanvasNode => node.type === 'video' && node.nodeId === size.nodeId
        )
        if (!videoNode) return

        const fittedDimensions = fitImageDimensionsToAspectRatio(videoNode.dimensions, intrinsicAspectRatio)
        const aspectChanged = Math.abs((videoNode.aspectRatio || 0) - intrinsicAspectRatio) > 0.001
        const widthChanged = Math.abs(videoNode.dimensions.width - fittedDimensions.width) > 0.5
        const heightChanged = Math.abs(videoNode.dimensions.height - fittedDimensions.height) > 0.5
        if (!aspectChanged && !widthChanged && !heightChanged) return

        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const worldPosition = getNodeWorldPosition(videoNode, nodesById)
        const nextWorldPosition = {
            x: worldPosition.x + (videoNode.dimensions.width - fittedDimensions.width) / 2,
            y: worldPosition.y + (videoNode.dimensions.height - fittedDimensions.height) / 2,
        }
        const nextPosition = videoNode.parentId
            ? toParentRelativePosition(nextWorldPosition, videoNode.parentId, nodesById)
            : nextWorldPosition

        const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== videoNode.nodeId) return node
            return {
                ...videoNode,
                aspectRatio: intrinsicAspectRatio,
                position: nextPosition,
                dimensions: fittedDimensions,
            }
        })

        const resolvedNodes = isGeneratedMediaNode(videoNode)
            ? rebalanceGeneratedMediaTrees(updatedNodes, currentCanvasState.edges)
            : updatedNodes

        commitCanvasState({ ...currentCanvasState, nodes: resolvedNodes })
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

        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const worldPosition = getNodeWorldPosition(imageNode, nodesById)
        const nextWorldPosition = {
            x: worldPosition.x + (imageNode.dimensions.width - fittedDimensions.width) / 2,
            y: worldPosition.y + (imageNode.dimensions.height - fittedDimensions.height) / 2,
        }
        const nextPosition = imageNode.parentId
            ? toParentRelativePosition(nextWorldPosition, imageNode.parentId, nodesById)
            : nextWorldPosition

        const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== imageNode.nodeId) return node
            return {
                ...imageNode,
                aspectRatio: intrinsicAspectRatio,
                position: nextPosition,
                dimensions: fittedDimensions,
            }
        })

        const resolvedNodes = isGeneratedMediaNode(imageNode)
            ? rebalanceGeneratedMediaTrees(updatedNodes, currentCanvasState.edges)
            : updatedNodes

        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes: resolvedNodes,
        })
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

    function expandParentContainersToFitChildren(nodes: CanvasNode[]): CanvasNode[] {
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
            if (node.type !== 'aiChatThread') return node
            const children = childrenByParentId.get(node.nodeId)

            // Empty parent containers keep their persisted size so manual resize is stable.
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

            // Parent containers grow to fit children, but never shrink below the user's
            // current size. Dropping a small image into a manually enlarged
            // empty container must preserve the larger dimensions.
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
        return settings.imageBranchLineage.generatedImageSize
    }

    function getNextChatRootOutputPosition(rootNode: ChatRootNode, childHeight: number, nodes: CanvasNode[]): { x: number; y: number } {
        const nodesById = getCanvasNodesById(nodes)
        const rootBounds = getSelectionBoundsForNode(rootNode)
        const horizontalGap = settings.imageBranchLineage.rootOutputGap
        const verticalGap = settings.imageBranchLineage.branchToBranchGap
        const existingBranchRoots = getGeneratedChildOutputs(rootNode, nodes, currentCanvasState?.edges ?? [])
            .filter((node: ImageCanvasNode | VideoCanvasNode) => node.generatedBy?.aiChatThreadId === rootNode.referenceId)
        const previousBranchRoot = getMostRecentGeneratedChildOutput(existingBranchRoots)
        const previousBranchRect = previousBranchRoot ? getNodeWorldRect(previousBranchRoot, nodesById) : undefined

        return computeNextBranchRowPositionToRightOfRect(rootBounds, previousBranchRect, childHeight, horizontalGap, verticalGap)
    }

    function getInsertionPaneSize(): { width: number; height: number } {
        const rect = paneRect ?? paneEl.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
    }

    function getCenteredInsertionPosition(dimensions: { width: number; height: number }): { x: number; y: number } {
        return computeViewportCenterInsertionPosition(dimensions, getLiveViewport(), getInsertionPaneSize())
    }

    function getResolvedNodePositionFromCollisionBox(node: CanvasNode, box: { x: number; y: number }, entries: Map<string, CollisionEntry>): { x: number; y: number } {
        const entry = entries.get(node.nodeId)
        if (!entry) return box
        return {
            x: box.x + entry.offset.x,
            y: box.y + entry.offset.y,
        }
    }

    function createCollisionPlan(nodes: CanvasNode[], topLevelOnly = false): CollisionPlan {
        const collisionNodes = topLevelOnly
            ? nodes.filter((node: CanvasNode) => !node.parentId)
            : nodes
        const nodesById = getCanvasNodesById(nodes)
        const entries = new Map<string, CollisionEntry>()

        const nodeBoxes = collisionNodes.map((node: CanvasNode) => {
            const worldPosition = getNodeWorldPosition(node, nodesById)
            entries.set(node.nodeId, { node, offset: { x: 0, y: 0 } })
            return {
                id: node.nodeId,
                x: worldPosition.x,
                y: worldPosition.y,
                width: node.dimensions.width,
                height: node.dimensions.height,
            }
        })

        const shouldResolvePair = (): boolean => true

        return { nodeBoxes, entries, shouldResolvePair }
    }

    function resolveTopLevelNodeCollisions(nodes: CanvasNode[]): CanvasNode[] {
        const collisionPlan = createCollisionPlan(nodes, true)
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

    // Single entry point for the generated-media add/remove paths: re-tidy every
    // branch-lineage tree and rigid-separate trees + loose nodes through the
    // unchanged resolver. Depth/sibling gaps come from imageBranchLineage so
    // spacing matches the rest of the lineage placement.
    function rebalanceGeneratedMediaTrees(nodes: CanvasNode[], edges: WorkspaceEdge[]): CanvasNode[] {
        return rebalanceBranchTreesAndResolve(nodes, edges, {
            depthGap: settings.imageBranchLineage.imageToImageGap,
            siblingGap: settings.imageBranchLineage.branchToBranchGap,
            branchFanoutDepthGap: settings.imageBranchLineage.branchFanoutDepthGap,
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

    function getSelectionOverlayBoundsForNode(node: CanvasNode): Rect {
        return getSelectionBoundsForNode(node)
    }

    function selectionRectIntersectsNode(rect: Rect, node: CanvasNode): boolean {
        return rectsOverlap(rect, getSelectionBoundsForNode(node))
    }

    function getSelectableNodeIdsInRect(rect: Rect): string[] {
        if (!currentCanvasState) return []

        const selectedNodeIdsInRect = new Set<string>()
        currentCanvasState.nodes
            .filter((node: CanvasNode) => selectionRectIntersectsNode(rect, node))
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
        return selectedNodeIds.size > 0
    }

    function shouldFillSelectionOverlayBounds(): boolean {
        return Boolean(currentCanvasState)
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
            if (nextNode) nodeLayerManager.bringToFront(nextNode)

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

        // The detached prompt input that used to appear below a selected node is
        // deprecated — the docked AI chat panel is the only composer. It must
        // NEVER render under any node type (documents, threads, images, video).
        hideFloatingInput()
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
        scheduleEdgesRender()
        // Selecting canvas nodes while the panel is open force-includes them as
        // explicit composer previews. Only newly-selected ids are added so a
        // removed preview whose node stays selected isn't immediately re-added.
        if (currentCanvasState && aiChatPanelState.isOpen) {
            addContextChips(Array.from(selectedNodeIds).filter((nodeId) => !prevSelectedNodeIds.has(nodeId)))
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
            '.workspace-generated-image-chrome',
        ].join(', '))
    }

    function showCanvasBubbleMenuForNode(nodeId: string) {
        if (!canvasBubbleMenu || !canvasBubbleMenuItems || !currentCanvasState) return

        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) {
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
        const context = node.type === 'video' ? CANVAS_VIDEO_CONTEXT : CANVAS_IMAGE_CONTEXT
        canvasBubbleMenu.show(context, position)
        canvasBubbleMenu.refreshState()
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
    const RAIL_OFFSET = settings.aiChatThread.rail.offset
    const RAIL_GRAB_WIDTH = settings.aiChatThread.rail.dragGrabWidth
    const AI_CHAT_PANEL_RAIL_PROMPT_GAP = 16
    const AI_CHAT_PANEL_MIN_WIDTH = 320
    const AI_CHAT_PANEL_DEFAULT_WIDTH = 380
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
            aiChatPanelState = { ...aiChatPanelState, isOpen: true }
            activeAiChatThreadId = threadId
            activeAiChatRootNodeId = nodeId
            ensureAiChatSidebarThreadTab(threadId)
            activeAiChatSidebarTabId = `thread:${threadId}`
            persistAiChatSidebarState()
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
            createContextTray: createAiChatPanelContextTrayElement,
            createModelDropdown: createGenericAiModelDropdown,
            createImageModelDropdown: createGenericImageModelDropdown,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createVideoModelDropdown: createGenericVideoModelMultiSelect,
            createVideoAspectDropdown: createGenericVideoAspectDropdown,
            createVideoResolutionDropdown: createGenericVideoResolutionDropdown,
            createVideoDurationDropdown: createGenericVideoDurationDropdown,
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

    function getActiveAiChatPanelCurrentWidth(): number {
        if (activeAiChatPanelWidth !== null) return activeAiChatPanelWidth
        return Math.min(AI_CHAT_PANEL_DEFAULT_WIDTH, getActiveAiChatPanelMaxWidth())
    }

    function getCssPixelVariable(name: string, fallback: number): number {
        const sourceEl = getWorkspaceCanvasElement() ?? document.documentElement
        const value = Number.parseFloat(getComputedStyle(sourceEl).getPropertyValue(name))
        return Number.isFinite(value) ? value : fallback
    }

    function getAiChatPanelTabsViewportWidth(panelWidth = getActiveAiChatPanelCurrentWidth()): number {
        const inlinePadding = getCssPixelVariable('--workspace-ai-chat-panel-content-inset', 10)
        return Math.max(0, panelWidth - inlinePadding * 2)
    }

    function getAiChatPanelActiveTabScrollLeft(switchWidth: number, panelWidth: number, selectedTabIndex: number, tabCount: number): number {
        if (tabCount <= 0) return 0

        const segmentWidth = (switchWidth - 4) / tabCount
        const tabStart = selectedTabIndex * segmentWidth
        const tabEnd = tabStart + segmentWidth

        return Math.max(0, Math.min(tabStart, tabEnd - panelWidth))
    }

    function resizeActiveAiChatPanelTabsSwitch(): void {
        if (!activeAiChatPanelTabsSwitch || !activeAiChatPanelEl || aiChatSidebarTabs.length < 2) return

        const switchHeight = settings.aiChatThread.panelTabs.height
        const tabsEl = activeAiChatPanelEl.querySelector<HTMLDivElement>('.workspace-ai-chat-panel-tabs')
        const switchViewportWidth = tabsEl?.clientWidth ?? getAiChatPanelTabsViewportWidth()

        activeAiChatPanelTabsSwitch.resize(0, 0, switchViewportWidth, switchHeight)

        if (tabsEl) {
            const switchWidth = activeAiChatPanelTabsSwitch.getContentWidth()
            const selectedTabIndex = Math.max(
                0,
                aiChatSidebarTabs.findIndex((tab) => tab.tabId === activeAiChatPanelTabsSwitch?.getValue())
            )
            tabsEl.scrollLeft = getAiChatPanelActiveTabScrollLeft(
                switchWidth,
                switchViewportWidth,
                selectedTabIndex,
                aiChatSidebarTabs.length
            )
        }
    }

    function applyActiveAiChatPanelWidth(width: number): number {
        const nextWidth = clampInsideRange(width, AI_CHAT_PANEL_MIN_WIDTH, getActiveAiChatPanelMaxWidth())
        const widthValue = `${nextWidth}px`
        const previousWidth = activeAiChatPanelWidth

        activeAiChatPanelWidth = nextWidth
        getWorkspaceCanvasElement()?.style.setProperty('--workspace-ai-chat-sidebar-width', widthValue)
        activeAiChatPanelEl?.style.setProperty('--workspace-ai-chat-sidebar-width', widthValue)
        if (previousWidth === null || Math.abs(nextWidth - previousWidth) >= 0.5) {
            resizeActiveAiChatPanelTabsSwitch()
        }

        return nextWidth
    }

    function measureActiveAiChatPanelRailThreadHeight(panelEl: HTMLElement): number {
        const promptEl = panelEl.querySelector<HTMLElement>('.workspace-ai-chat-floating-panel-prompt')
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
            if (activeAiChatPanelWidth !== null) {
                aiChatPanelState = { ...aiChatPanelState, width: activeAiChatPanelWidth }
                persistAiChatSidebarState()
            }
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function aiChatThreadHasRenderableContent(thread: AiChatThread | undefined): boolean {
        return Boolean(thread && thread.content != null && typeof thread.content === 'object' && Object.keys(thread.content).length > 0)
    }

    function countProseMirrorNodesByType(value: unknown, nodeTypes: Set<string>): number {
        if (!value || typeof value !== 'object') return 0

        const candidate = value as { type?: unknown; content?: unknown }
        const ownCount = typeof candidate.type === 'string' && nodeTypes.has(candidate.type) ? 1 : 0
        if (!Array.isArray(candidate.content)) return ownCount

        let childCount = 0
        for (const child of candidate.content) {
            childCount += countProseMirrorNodesByType(child, nodeTypes)
        }

        return ownCount + childCount
    }

    function countAiChatSessionMessages(content: object): number {
        return countProseMirrorNodesByType(content, new Set(['aiUserMessage', 'aiResponseMessage']))
    }

    function formatSessionTimestamp(updatedAt: number): string {
        const date = new Date(updatedAt)
        if (!Number.isFinite(updatedAt) || Number.isNaN(date.getTime())) return 'Date unavailable'

        return new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }).format(date)
    }

    function formatSessionRelativeTime(updatedAt: number): string {
        if (!Number.isFinite(updatedAt)) return ''

        const elapsedMs = Math.max(0, Date.now() - updatedAt)
        const minuteMs = 60_000
        const hourMs = 60 * minuteMs
        const dayMs = 24 * hourMs
        const weekMs = 7 * dayMs

        if (elapsedMs < minuteMs) return 'just now'
        if (elapsedMs < hourMs) return `${Math.floor(elapsedMs / minuteMs)}m ago`
        if (elapsedMs < dayMs) return `${Math.floor(elapsedMs / hourMs)}h ago`
        if (elapsedMs < weekMs) {
            const days = Math.floor(elapsedMs / dayMs)
            return `${days} ${days === 1 ? 'day' : 'days'} ago`
        }

        const weeks = Math.floor(elapsedMs / weekMs)
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`
    }

    function formatSessionUpdatedAt(updatedAt: number): string {
        const timestamp = formatSessionTimestamp(updatedAt)
        const relative = formatSessionRelativeTime(updatedAt)
        return relative ? `${timestamp} · ${relative}` : timestamp
    }

    function formatSessionStatus(status: string): string {
        return status
            .split(/[-_]/)
            .filter(Boolean)
            .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
            .join(' ')
    }

    function pluralizeSessionCount(count: number, singular: string): string {
        return `${count} ${count === 1 ? singular : `${singular}s`}`
    }

    function getAiChatSessionMeta(session: AiChatThread): string {
        const messageCount = countAiChatSessionMessages(session.content)
        return [
            pluralizeSessionCount(messageCount, 'message'),
            formatSessionStatus(session.status),
        ].filter(Boolean).join(' · ')
    }

    function getExtractionSourceCount(sourceContextSnapshot: object | undefined): number {
        if (!sourceContextSnapshot || typeof sourceContextSnapshot !== 'object') return 0

        const snapshot = sourceContextSnapshot as {
            imageNatsUrl?: unknown
            contextMessages?: unknown
            nodes?: unknown
        }
        let count = snapshot.imageNatsUrl ? 1 : 0
        if (Array.isArray(snapshot.contextMessages)) count += snapshot.contextMessages.length
        if (Array.isArray(snapshot.nodes)) count += snapshot.nodes.length

        return count
    }

    function getExtractionSessionTitle(extractionState: CanvasFeatureExtractionState): string {
        const userText = typeof extractionState.userText === 'string' ? extractionState.userText.trim() : ''
        if (userText) return userText

        const featureName = typeof extractionState.featureCard?.name === 'string'
            ? extractionState.featureCard.name.trim()
            : ''
        return featureName ? `Extract ${featureName}` : 'Extract Feature'
    }

    function getExtractionSessionMeta(extractionState: CanvasFeatureExtractionState): string {
        const sourceCount = getExtractionSourceCount(extractionState.sourceContextSnapshot)
        return [
            'Feature extraction',
            formatSessionStatus(extractionState.status),
            extractionState.aiProvider,
            sourceCount > 0 ? pluralizeSessionCount(sourceCount, 'source') : '',
        ].filter(Boolean).join(' · ')
    }

    function destroyActiveAiChatPanel(
        clearActive = false,
        panelThreadId = activeAiChatPanelThreadId ?? activeAiChatThreadId,
        preserveTabsSwitch = false
    ): void {
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
        activeAiChatPromptResizeObserver?.disconnect()
        if (activeAiChatPanelRailHeightFrame !== null) {
            cancelAnimationFrame(activeAiChatPanelRailHeightFrame)
            activeAiChatPanelRailHeightFrame = null
        }
        if (!preserveTabsSwitch) activeAiChatPanelTabsSwitch?.destroy()
        destroyContextPreviewTooltips()
        activeAiChatPanelEl?.remove()
        activeAiChatBackdropEl?.remove()
        activeAiChatPanelThreadId = null
        activeAiChatPanelRootNodeId = null
        activeAiChatPanelHadContent = false
        activeAiChatPanelEl = null
        activeAiChatBackdropEl = null
        if (!preserveTabsSwitch) activeAiChatPanelTabsSwitch = null
        activeAiChatPromptEditor = null
        activeAiChatPromptGradient = null
        activeAiChatPromptResizeObserver = null
        activeContextChipTrayEl = null

        if (clearActive) {
            activeAiChatThreadId = null
            activeAiChatRootNodeId = null
            activeAiChatSidebarThreadId = null
            promptInputController.setTarget(null)
        }
    }

    function activateAiChatPanel(rootNode: ChatRootNode, thread: AiChatThread | undefined): void {
        aiChatPanelState = { ...aiChatPanelState, isOpen: true }
        activeAiChatRootNodeId = rootNode.nodeId
        activeAiChatThreadId = rootNode.referenceId
        ensureAiChatSidebarThreadTab(rootNode.referenceId)
        activeAiChatSidebarTabId = `thread:${rootNode.referenceId}`
        persistAiChatSidebarState()
        renderActiveAiChatPanel(rootNode, thread)
    }

    function createAiChatThreadSidebarTab(threadId: string): CanvasAiChatSidebarTab {
        return { tabId: `thread:${threadId}`, type: 'thread', refId: threadId, title: 'AI Chat' }
    }

    function createAiChatDraftSidebarTab(): CanvasAiChatSidebarTab {
        const draftId = uuidv4()
        return { tabId: `${AI_CHAT_DRAFT_TAB_PREFIX}${draftId}`, type: 'draft', refId: draftId, title: 'AI Chat' }
    }

    function replaceAiChatDraftSidebarTab(draftTabId: string, threadId: string): void {
        const threadTab = createAiChatThreadSidebarTab(threadId)
        let replacedDraftTab = false
        aiChatSidebarTabs = aiChatSidebarTabs.map((tab) => {
            if (tab.tabId !== draftTabId) return tab
            replacedDraftTab = true
            return threadTab
        })
        if (!replacedDraftTab && !aiChatSidebarTabs.some((tab) => tab.tabId === threadTab.tabId)) {
            aiChatSidebarTabs.unshift(threadTab)
        }

        const drafts = { ...(aiChatPanelState.drafts ?? {}) }
        delete drafts[draftTabId]
        aiChatPanelState = { ...aiChatPanelState, drafts }
    }

    function persistAiChatSidebarState(): void {
        if (!currentCanvasState) return

        const nextActiveTabId = activeAiChatSidebarTabId && aiChatSidebarTabs.some((tab) => tab.tabId === activeAiChatSidebarTabId)
            ? activeAiChatSidebarTabId
            : aiChatSidebarTabs[0]?.tabId
        const { activeTabId: _existingActiveTabId, ...panelStateWithoutActiveTab } = aiChatPanelState
        aiChatPanelState = {
            ...panelStateWithoutActiveTab,
            tabs: aiChatSidebarTabs,
            ...(nextActiveTabId ? { activeTabId: nextActiveTabId } : {}),
        }
        const nextCanvasState = setAiChatPanelState(currentCanvasState, aiChatPanelState)
        const { lastActiveAiChatThreadId: _existingLastActiveThreadId, ...nextCanvasStateWithoutLegacyLastActive } = nextCanvasState
        const persistedState = {
            ...nextCanvasStateWithoutLegacyLastActive,
            ...(activeAiChatThreadId ? { lastActiveAiChatThreadId: activeAiChatThreadId } : {}),
        }
        if (JSON.stringify(currentCanvasState.aiChatPanel) === JSON.stringify(persistedState.aiChatPanel)
            && JSON.stringify(currentCanvasState.aiChatSidebarTabs ?? []) === JSON.stringify(persistedState.aiChatSidebarTabs ?? [])
            && currentCanvasState.activeAiChatSidebarTabId === persistedState.activeAiChatSidebarTabId
            && currentCanvasState.lastActiveAiChatThreadId === persistedState.lastActiveAiChatThreadId) return

        commitCanvasMetadataState(persistedState)
    }

    // A short visible label for context metadata. Media previews are already
    // visual, so unresolved image/video descriptors stay label-free.
    function getContextChipLabel(node: CanvasNode): string {
        const descriptor = isDescriptorCanvasNode(node) ? node.descriptor : undefined
        const summary = descriptor && descriptor.status === 'ready' ? descriptor.summary : ''
        const trimmed = summary.trim()
        if (trimmed) return trimmed
        switch (node.type) {
            case 'document': return 'Document'
            case 'aiChatThread': return 'Chat'
            case 'image':
            case 'video': return ''
            default: return node.type
        }
    }

    function getContextPreviewTitle(node: CanvasNode): string {
        if (node.type === 'document') {
            const document = currentDocuments.find((doc) => doc.documentId === node.referenceId)
            const title = document?.title?.trim()
            if (title) return title
        }
        if (node.type === 'aiChatThread') {
            const thread = currentAiChatThreads.find((item) => item.threadId === node.referenceId)
            const title = thread?.title?.trim()
            if (title) return title
        }
        if (node.type === 'image' || node.type === 'video') return ''
        return getContextChipLabel(node)
    }

    function getContextPreviewText(node: CanvasNode): string {
        const descriptor = isDescriptorCanvasNode(node) && node.descriptor?.status === 'ready'
            ? node.descriptor.summary.trim()
            : ''
        if (descriptor) return descriptor

        if (node.type === 'document') {
            const document = currentDocuments.find((doc) => doc.documentId === node.referenceId)
            const { text } = extractContentFromProseMirror((document?.content ?? '') as string | object)
            return text.trim()
        }

        if (node.type === 'aiChatThread') {
            const thread = currentAiChatThreads.find((item) => item.threadId === node.referenceId)
            const { text } = extractContentFromProseMirror((thread?.content ?? '') as string | object)
            return text.trim()
        }

        return ''
    }

    function getContextPreviewTypeLabel(node: CanvasNode): string {
        switch (node.type) {
            case 'document': return 'Document'
            case 'image': return 'Image'
            case 'video': return 'Video'
            case 'aiChatThread': return 'Chat'
            default: return node.type
        }
    }

    function buildContextPreviewInitialMediaSrc(mediaUrl: string): string {
        if (!mediaUrl) return ''
        if (mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:')) return mediaUrl
        if (mediaUrl.startsWith('/api/') || mediaUrl.startsWith('http')) return mediaUrl
        return `data:image/png;base64,${mediaUrl}`
    }

    function setContextPreviewMediaTokenParam(mediaUrl: string, token: string): string {
        if (!token) return mediaUrl
        const isAbsoluteUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(mediaUrl)
        try {
            const url = isAbsoluteUrl ? new URL(mediaUrl) : new URL(mediaUrl, window.location.origin)
            url.searchParams.set('token', token)
            if (isAbsoluteUrl) return url.toString()
            return `${url.pathname}${url.search}${url.hash}`
        } catch {
            const separator = mediaUrl.includes('?') ? '&' : '?'
            return `${mediaUrl}${separator}token=${encodeURIComponent(token)}`
        }
    }

    async function buildContextPreviewAuthenticatedMediaSrc(mediaUrl: string): Promise<string> {
        if (!mediaUrl) return ''
        if (mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:')) return mediaUrl
        if (mediaUrl.startsWith('/api/')) {
            const token = await AuthService.getTokenSilently()
            const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
            const sourceUrl = apiBaseUrl ? `${apiBaseUrl}${mediaUrl}` : mediaUrl
            return setContextPreviewMediaTokenParam(sourceUrl, token)
        }
        if (mediaUrl.startsWith('http')) {
            if (mediaUrl.includes('/api/videos/') || mediaUrl.includes('/api/images/')) {
                const token = await AuthService.getTokenSilently()
                return setContextPreviewMediaTokenParam(mediaUrl, token)
            }
            return mediaUrl
        }
        return `data:image/png;base64,${mediaUrl}`
    }

    function hydrateContextPreviewMedia(el: HTMLImageElement | HTMLVideoElement, mediaUrl: string, attr: 'src' | 'poster' = 'src'): void {
        if (!mediaUrl) return
        void (async () => {
            try {
                const src = await buildContextPreviewAuthenticatedMediaSrc(mediaUrl)
                if (!src || !el.isConnected) return
                if (attr === 'poster' && el instanceof HTMLVideoElement) {
                    el.poster = src
                    return
                }
                el.src = src
            } catch (error) {
                console.warn('Failed to resolve context preview media URL:', error)
            }
        })()
    }

    function setContextPreviewVideoSources(videoEl: HTMLVideoElement, node: VideoCanvasNode): void {
        const initialSrc = buildContextPreviewInitialMediaSrc(node.src)
        const initialPoster = buildContextPreviewInitialMediaSrc(node.posterSrc)
        if (initialSrc) videoEl.src = initialSrc
        if (initialPoster) videoEl.poster = initialPoster
        hydrateContextPreviewMedia(videoEl, node.src)
        hydrateContextPreviewMedia(videoEl, node.posterSrc, 'poster')
    }

    function renderContextImagePreview(node: ImageCanvasNode, label: string, size: 'mini' | 'large'): HTMLElement {
        const imageEl = html`<img
            className=${`workspace-ai-chat-panel-context-preview-image workspace-ai-chat-panel-context-preview-image-${size}`}
            src=${buildImageSrc(node.src, '', false)}
            alt=""
            loading="lazy"
        />` as HTMLImageElement
        imageEl.setAttribute('aria-label', label)
        hydrateContextPreviewMedia(imageEl, node.src)
        return imageEl
    }

    function renderContextVideoPreview(node: VideoCanvasNode, label: string, size: 'mini' | 'large'): HTMLElement {
        if (size === 'large') {
            const previewEl = html`<div className="workspace-ai-chat-panel-context-preview-video workspace-ai-chat-panel-context-preview-video-large">
                <video
                    muted="true"
                    playsinline="true"
                    preload="metadata"
                    controls="true"
                    aria-label=${label}
                ></video>
                <span className="workspace-ai-chat-panel-context-preview-video-glyph" innerHTML=${videoPlayGlyphIcon}></span>
            </div>` as HTMLElement
            const videoEl = previewEl.querySelector('video')
            if (videoEl) setContextPreviewVideoSources(videoEl, node)
            return previewEl
        }

        const previewEl = html`<div className="workspace-ai-chat-panel-context-preview-video workspace-ai-chat-panel-context-preview-video-mini">
            <video
                muted="true"
                playsinline="true"
                preload="metadata"
                aria-label=${label}
            ></video>
            <span className="workspace-ai-chat-panel-context-preview-video-glyph" innerHTML=${videoPlayGlyphIcon}></span>
        </div>` as HTMLElement
        const videoEl = previewEl.querySelector('video')
        if (videoEl) setContextPreviewVideoSources(videoEl, node)
        return previewEl
    }

    function renderContextDocumentPreview(node: DocumentCanvasNode | AiChatThreadCanvasNode, title: string, text: string, size: 'mini' | 'large'): HTMLElement {
        if (size === 'mini') {
            return html`<div className="workspace-ai-chat-panel-context-preview-document workspace-ai-chat-panel-context-preview-document-mini">
                <span className="workspace-ai-chat-panel-context-preview-document-icon" innerHTML=${documentIcon}></span>
                <span className="workspace-ai-chat-panel-context-preview-document-skeleton" aria-label=${title}>
                    <span></span>
                    <span></span>
                    <span></span>
                </span>
            </div>` as HTMLElement
        }

        return html`<div className=${`workspace-ai-chat-panel-context-preview-document workspace-ai-chat-panel-context-preview-document-${size}`}>
            <span className="workspace-ai-chat-panel-context-preview-document-icon" innerHTML=${documentIcon}></span>
            <span className="workspace-ai-chat-panel-context-preview-document-lines">
                <span className="workspace-ai-chat-panel-context-preview-document-title">${title}</span>
                <span className="workspace-ai-chat-panel-context-preview-document-text">${text || getContextPreviewTypeLabel(node)}</span>
            </span>
        </div>` as HTMLElement
    }

    function renderContextPreviewVisual(node: CanvasNode, title: string, text: string, size: 'mini' | 'large'): HTMLElement {
        if (node.type === 'image') return renderContextImagePreview(node, title, size)
        if (node.type === 'video') return renderContextVideoPreview(node, title, size)
        if (node.type === 'document' || node.type === 'aiChatThread') {
            return renderContextDocumentPreview(node, title, text, size)
        }
        return html`<div className="workspace-ai-chat-panel-context-preview-document">${title}</div>` as HTMLElement
    }

    type ContextPreviewPopoverOrientation = 'landscape' | 'portrait'

    function getContextPreviewPopoverOrientation(node: ImageCanvasNode | VideoCanvasNode): ContextPreviewPopoverOrientation {
        if (Number.isFinite(node.aspectRatio) && node.aspectRatio > 0) {
            return node.aspectRatio < 1 ? 'portrait' : 'landscape'
        }
        return node.dimensions.height > node.dimensions.width ? 'portrait' : 'landscape'
    }

    function renderContextPreviewPopoverMeta(title: string, text: string): HTMLElement {
        return html`<div className="workspace-ai-chat-panel-context-preview-popover-meta">
            ${title ? html`<span className="workspace-ai-chat-panel-context-preview-popover-title">${title}</span>` : ''}
            ${text ? html`<span className="workspace-ai-chat-panel-context-preview-popover-text">${text}</span>` : ''}
        </div>` as HTMLElement
    }

    function renderContextPreviewPopoverContent(node: CanvasNode, title: string, text: string, accessibleLabel: string): HTMLElement {
        if (node.type !== 'image' && node.type !== 'video') {
            return renderContextPreviewVisual(node, accessibleLabel, text, 'large')
        }

        const hasPopoverMeta = Boolean(title || text)
        const orientation = hasPopoverMeta ? getContextPreviewPopoverOrientation(node) : 'landscape'
        return html`<div className=${`workspace-ai-chat-panel-context-preview-popover-body workspace-ai-chat-panel-context-preview-popover-body-${orientation}`}>
            <div className="workspace-ai-chat-panel-context-preview-popover-media">
                ${renderContextPreviewVisual(node, accessibleLabel, text, 'large')}
            </div>
            ${hasPopoverMeta ? renderContextPreviewPopoverMeta(title, text) : ''}
        </div>` as HTMLElement
    }

    function getContextPreviewPopoverClassName(node: CanvasNode, hasPopoverMeta: boolean): string {
        const baseClassName = 'workspace-ai-chat-panel-context-preview-popover'
        if ((node.type !== 'image' && node.type !== 'video') || !hasPopoverMeta) return baseClassName
        return `${baseClassName} ${baseClassName}-${getContextPreviewPopoverOrientation(node)}`
    }

    function destroyContextPreviewTooltips(): void {
        for (const tooltip of activeContextPreviewTooltips) {
            tooltip.destroy()
        }
        activeContextPreviewTooltips.clear()
    }

    function createAiChatPanelContextTrayElement(): HTMLDivElement {
        const trayEl = html`<div
            className="workspace-ai-chat-panel-context-chips"
            role="list"
            aria-label="Chat context previews"
            contenteditable="false"
        ></div>` as HTMLDivElement
        activeContextChipTrayEl = trayEl
        refreshContextChipTray()
        return trayEl
    }

    function addContextChips(nodeIds: Iterable<string>): void {
        if (!currentCanvasState) return
        const eligibleNodeIds = new Set(currentCanvasState.nodes
            .map((node) => node.nodeId))
        const chipNodeIds = new Set(aiChatPanelState.contextChips)
        const nextChips = [...aiChatPanelState.contextChips]
        for (const nodeId of nodeIds) {
            if (!nodeId || chipNodeIds.has(nodeId) || !eligibleNodeIds.has(nodeId)) continue
            chipNodeIds.add(nodeId)
            nextChips.push(nodeId)
        }
        if (nextChips.length === aiChatPanelState.contextChips.length) return
        aiChatPanelState = { ...aiChatPanelState, contextChips: nextChips }
        persistAiChatSidebarState()
        refreshContextChipTray()
    }

    function removeContextChip(nodeId: string): void {
        if (!aiChatPanelState.contextChips.includes(nodeId)) return
        aiChatPanelState = {
            ...aiChatPanelState,
            contextChips: aiChatPanelState.contextChips.filter((id) => id !== nodeId),
        }
        persistAiChatSidebarState()
        refreshContextChipTray()
    }

    function clearExplicitContextChips(): void {
        if (aiChatPanelState.contextChips.length === 0) return
        aiChatPanelState = { ...aiChatPanelState, contextChips: [] }
        persistAiChatSidebarState()
        refreshContextChipTray()
    }

    function updateActiveAiChatPanelRailHeight(): void {
        if (!activeAiChatPanelEl) return
        const panelRail = activeAiChatPanelEl.querySelector<HTMLElement>('.workspace-ai-chat-floating-panel-rail')
        if (!panelRail) return
        panelRail.style.setProperty('--rail-thread-height', `${measureActiveAiChatPanelRailThreadHeight(activeAiChatPanelEl)}px`)
    }

    function scheduleActiveAiChatPanelRailHeightUpdate(): void {
        if (activeAiChatPanelRailHeightFrame !== null) return
        activeAiChatPanelRailHeightFrame = requestAnimationFrame(() => {
            activeAiChatPanelRailHeightFrame = null
            updateActiveAiChatPanelRailHeight()
        })
    }

    function restoreAiChatPanelHistoryScroll(historyScrollerEl: HTMLElement | null | undefined, scrollTop: number | null, refreshVersion: number): void {
        if (!historyScrollerEl || scrollTop === null) return
        historyScrollerEl.scrollTop = scrollTop
        requestAnimationFrame(() => {
            if (refreshVersion !== contextPreviewRefreshVersion) return
            if (historyScrollerEl.isConnected) historyScrollerEl.scrollTop = scrollTop
            updateActiveAiChatPanelRailHeight()
        })
    }

    function renderContextChip({
        nodeId,
        node,
    }: {
        nodeId: string
        node: CanvasNode
    }): HTMLDivElement {
        const title = getContextPreviewTitle(node)
        const text = getContextPreviewText(node)
        const accessibleLabel = title || getContextPreviewTypeLabel(node)
        const previewTooltip = createHelpTooltip({
            label: accessibleLabel,
            triggerContent: renderContextPreviewVisual(node, accessibleLabel, text, 'mini'),
            content: renderContextPreviewPopoverContent(node, title, text, accessibleLabel),
            preferredPlacement: 'top',
            className: 'workspace-ai-chat-panel-context-preview-tooltip',
            triggerClassName: 'workspace-ai-chat-panel-context-preview-trigger',
            contentClassName: getContextPreviewPopoverClassName(node, Boolean(title || text)),
            contentCssVariableNames: AI_CHAT_PANEL_CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,
            interactive: true,
        })
        const removeLabel = `Remove ${accessibleLabel} from context`
        activeContextPreviewTooltips.add(previewTooltip)
        const chipEl = html`<div
            className="workspace-ai-chat-panel-context-chip workspace-ai-chat-panel-context-chip-explicit"
            data=${{ nodeId, contextKind: 'explicit', contextRole: 'forced-chip' }}
            role="listitem"
        >
            <div className="workspace-ai-chat-panel-context-preview-main">
                ${previewTooltip.dom}
            </div>
            <button
                type="button"
                className="workspace-ai-chat-panel-context-chip-remove"
                aria-label=${removeLabel}
                innerHTML=${xCircleIcon}
            ></button>
        </div>` as HTMLDivElement
        chipEl.querySelector('.workspace-ai-chat-panel-context-chip-remove')
            ?.addEventListener('click', () => removeContextChip(nodeId))
        return chipEl
    }

    // Re-render just the composer preview strip in place so adding or removing
    // draft context never tears down the ProseMirror composer or its draft.
    function refreshContextChipTray(): void {
        const trayEl = activeContextChipTrayEl
        if (!trayEl) return
        const historyScrollerEl = activeAiChatPanelEl?.querySelector<HTMLElement>(
            '.workspace-ai-chat-panel-body-pane:not(.workspace-ai-chat-panel-body-pane-hidden)'
        )
        const previousScrollTop = historyScrollerEl?.scrollTop ?? null
        const refreshVersion = ++contextPreviewRefreshVersion
        destroyContextPreviewTooltips()
        trayEl.replaceChildren()
        const explicitChipNodeIds = aiChatPanelState.contextChips
        const nodesById = new Map(currentCanvasState?.nodes.map((node): [string, CanvasNode] => [node.nodeId, node]) ?? [])
        const explicitChipNodes: CanvasNode[] = []
        for (const nodeId of explicitChipNodeIds) {
            const node = nodesById.get(nodeId)
            if (node) explicitChipNodes.push(node)
        }
        if (explicitChipNodes.length === 0) {
            trayEl.hidden = true
            restoreAiChatPanelHistoryScroll(historyScrollerEl, previousScrollTop, refreshVersion)
            updateActiveAiChatPanelRailHeight()
            return
        }
        trayEl.hidden = false
        for (const node of explicitChipNodes) {
            trayEl.appendChild(renderContextChip({ nodeId: node.nodeId, node }))
        }
        restoreAiChatPanelHistoryScroll(historyScrollerEl, previousScrollTop, refreshVersion)
        updateActiveAiChatPanelRailHeight()
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
        aiChatPanelState = getAiChatPanelState(currentCanvasState)
        aiChatSidebarTabs = aiChatPanelState.tabs
        activeAiChatSidebarTabId = aiChatPanelState.activeTabId ?? null
        if (aiChatPanelState.width !== undefined) activeAiChatPanelWidth = aiChatPanelState.width
        const activeTab = getActiveAiChatSidebarTab()
        activeAiChatThreadId = activeTab?.type === 'thread' ? activeTab.refId : null
        const activeRootNode = activeAiChatThreadId
            ? currentCanvasState?.nodes.find(
                (node: CanvasNode): node is ChatRootNode => node.type === 'aiChatThread' && node.referenceId === activeAiChatThreadId
            )
            : undefined
        activeAiChatRootNodeId = activeRootNode?.nodeId ?? null
    }

    function ensureAiChatSidebarThreadTab(threadId: string): void {
        const threadTabId = `thread:${threadId}`
        if (!aiChatSidebarTabs.some((tab) => tab.tabId === threadTabId)) {
            aiChatSidebarTabs.unshift(createAiChatThreadSidebarTab(threadId))
        }
        activeAiChatSidebarThreadId = threadId
    }

    function getActiveAiChatSidebarTab(): CanvasAiChatSidebarTab | undefined {
        return aiChatSidebarTabs.find((tab) => tab.tabId === activeAiChatSidebarTabId) ?? aiChatSidebarTabs[0]
    }

    function persistAiChatPromptDraft(draftKey: string, content: object): void {
        aiChatPanelState = {
            ...aiChatPanelState,
            drafts: {
                ...(aiChatPanelState.drafts ?? {}),
                [draftKey]: { content },
            },
        }
        persistAiChatSidebarState()
    }

    function buildAiPromptDraftFromText(promptText: string, attrs: Record<string, string> = {}): object {
        const text = promptText.trim()
        const paragraph = text
            ? { type: 'paragraph', content: [{ type: 'text', text }] }
            : { type: 'paragraph' }
        return {
            type: 'doc',
            content: [
                {
                    type: 'aiPromptInput',
                    attrs: {
                        aiModel: attrs.aiModel || '',
                        aiModels: attrs.aiModels || '',
                        aiImageModel: attrs.aiImageModel || '',
                        aiImageModels: attrs.aiImageModels || '',
                        imageGenerationSize: attrs.imageGenerationSize || 'auto',
                        aiVideoModel: attrs.aiVideoModel || '',
                        aiVideoModels: attrs.aiVideoModels || '',
                        videoAspectRatio: attrs.videoAspectRatio || '',
                        videoResolution: attrs.videoResolution || '',
                        videoDuration: attrs.videoDuration || '',
                    },
                    content: [paragraph],
                },
            ],
        }
    }

    function getActiveAiPromptInputAttrs(): Record<string, string> {
        const view = activeAiChatPromptEditor?.editorView
        const attrs: Record<string, string> = {}
        view?.state.doc.descendants((node: any) => {
            if (node.type.name !== 'aiPromptInput') return true
            Object.assign(attrs, node.attrs)
            return false
        })
        return attrs
    }

    function replaceActiveAiChatPromptDraft(promptText: string): void {
        const draftKey = getActiveAiChatSidebarTab()?.tabId ?? NEW_CHAT_DRAFT_KEY
        const view = activeAiChatPromptEditor?.editorView
        const draft = buildAiPromptDraftFromText(promptText, getActiveAiPromptInputAttrs())
        persistAiChatPromptDraft(draftKey, draft)
        if (!view || !activeAiChatPromptEditor?.editorSchema) return

        try {
            const nextDoc = activeAiChatPromptEditor.editorSchema.nodeFromJSON(draft)
            let tr = view.state.tr.replaceWith(0, view.state.doc.content.size, nextDoc.content)
            let inputPos = -1
            tr.doc.descendants((node: any, pos: number) => {
                if (node.type.name !== 'aiPromptInput') return true
                inputPos = pos
                return false
            })
            if (inputPos >= 0) {
                const cursorPos = Math.max(1, Math.min(inputPos + 2 + promptText.trim().length, tr.doc.content.size))
                tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos))
            }
            view.dispatch(tr.scrollIntoView())
            view.focus()
        } catch (error) {
            console.error('Failed to seed AI prompt draft:', error)
        }
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
            // The `/use` slash text is deleted when the Media Library opens, so re-insert "use" as
            // plain text before the chip. The prompt then reads "use feature:<name>" and is no
            // longer empty, so the placeholder stops showing over an already-filled input.
            const usePrefix = 'use '
            const insertAt = view.state.selection.from
            let tr = view.state.tr.replaceSelectionWith(node)
            tr = tr.insertText(usePrefix, insertAt)
            const afterChip = insertAt + usePrefix.length + node.nodeSize
            tr = tr.insertText(' ', afterChip)
            tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(afterChip + 1, tr.doc.content.size))).scrollIntoView()
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
        aiChatPanelState = { ...aiChatPanelState, isOpen: true, isSessionHistoryOpen: false }
        const tabId = `extraction:${extractionRunId}`
        if (!aiChatSidebarTabs.some((tab) => tab.tabId === tabId)) {
            aiChatSidebarTabs.push({ tabId, type: 'extraction', refId: extractionRunId, title: 'Extract Feature' })
        }
        activeAiChatSidebarTabId = tabId
        persistAiChatSidebarState()
        renderActiveAiChatPanel()
    }

    function getChatRootNodeForThread(threadId: string | null): ChatRootNode | undefined {
        if (!threadId) return undefined
        return currentCanvasState?.nodes.find(
            (node: CanvasNode): node is ChatRootNode => node.type === 'aiChatThread' && node.referenceId === threadId
        )
    }

    function openAiChatPanel(): void {
        syncActiveAiChatPanelFromState()
        aiChatPanelState = { ...aiChatPanelState, isOpen: true }
        // Seed chips from whatever is selected when the panel opens, mirroring the
        // old follow-selection behavior — now as persistent, removable chips.
        addContextChips(selectedNodeIds)
        persistAiChatSidebarState()
        renderActiveAiChatPanel()
        void loadExtractionSessionHistory()
    }

    function startNewAiChatDraft({
        preserveOpenTabs = true,
        syncFromState = true,
    }: {
        preserveOpenTabs?: boolean
        syncFromState?: boolean
    } = {}): void {
        if (syncFromState) syncActiveAiChatPanelFromState()
        const drafts = { ...(aiChatPanelState.drafts ?? {}) }
        delete drafts[NEW_CHAT_DRAFT_KEY]
        if (preserveOpenTabs && aiChatSidebarTabs.length > 0) {
            const draftTab = createAiChatDraftSidebarTab()
            aiChatSidebarTabs = [...aiChatSidebarTabs, draftTab]
            activeAiChatSidebarTabId = draftTab.tabId
        } else {
            aiChatSidebarTabs = []
            activeAiChatSidebarTabId = null
        }
        activeAiChatSidebarThreadId = null
        activeAiChatThreadId = null
        activeAiChatRootNodeId = null
        aiChatPanelState = {
            ...aiChatPanelState,
            isOpen: true,
            isSessionHistoryOpen: false,
            contextChips: [],
            drafts,
        }
        promptInputController.setTarget(null)
        persistAiChatSidebarState()
        syncActiveAiChatPanelFromState()
        renderActiveAiChatPanel()
    }

    function closeAiChatPanel(): void {
        aiChatPanelState = { ...aiChatPanelState, isOpen: false }
        persistAiChatSidebarState()
        destroyActiveAiChatPanel(false)
    }

    function toggleAiChatPanelVisibility(): void {
        if (aiChatPanelState.isOpen) {
            closeAiChatPanel()
        } else {
            openAiChatPanel()
        }
    }

    function closeAiChatSidebarTab(tabId: string): void {
        const closedTabIndex = aiChatSidebarTabs.findIndex((tab) => tab.tabId === tabId)
        const closedTab = aiChatSidebarTabs.find((tab) => tab.tabId === tabId)
        aiChatSidebarTabs = aiChatSidebarTabs.filter((tab) => tab.tabId !== tabId)
        if (closedTab?.type === 'draft') {
            const drafts = { ...(aiChatPanelState.drafts ?? {}) }
            delete drafts[closedTab.tabId]
            aiChatPanelState = { ...aiChatPanelState, drafts }
        }
        if (aiChatSidebarTabs.length === 0) {
            startNewAiChatDraft({ preserveOpenTabs: false, syncFromState: false })
            return
        }
        if (activeAiChatSidebarTabId === tabId) {
            const nextActiveTabIndex = closedTabIndex >= 0
                ? Math.min(closedTabIndex, aiChatSidebarTabs.length - 1)
                : 0
            activeAiChatSidebarTabId = aiChatSidebarTabs[nextActiveTabIndex]?.tabId ?? null
        }
        persistAiChatSidebarState()
        syncActiveAiChatPanelFromState()
        renderActiveAiChatPanel()
    }

    function removeAiChatPanelDraft(tabId: string): void {
        if (!aiChatPanelState.drafts?.[tabId]) return
        const drafts = { ...aiChatPanelState.drafts }
        delete drafts[tabId]
        aiChatPanelState = { ...aiChatPanelState, drafts }
    }

    async function deleteAiChatSession(threadId: string): Promise<void> {
        const aiChatThreadService = servicesStore.getData('aiChatThreadService')
        if (!aiChatThreadService) return
        const deleted = await aiChatThreadService.deleteAiChatThread({ workspaceId, threadId })
        if (!deleted) return
        removeAiChatPanelDraft(`thread:${threadId}`)
        closeAiChatSidebarTab(`thread:${threadId}`)
    }

    async function deleteExtractionSession(extractionRunId: string): Promise<void> {
        const response = await servicesStore.getData('nats')?.request(NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.DELETE, {
            token: await AuthService.getTokenSilently(),
            workspaceId,
            extractionRunId,
        })
        if (response?.error || !currentCanvasState) return

        const featureExtractionRuns = { ...(currentCanvasState.featureExtractionRuns ?? {}) }
        delete featureExtractionRuns[extractionRunId]
        currentCanvasState = { ...currentCanvasState, featureExtractionRuns }
        removeAiChatPanelDraft(`extraction:${extractionRunId}`)
        closeAiChatSidebarTab(`extraction:${extractionRunId}`)
        commitCanvasStatePreservingEditors(currentCanvasState)
    }

    async function loadExtractionSessionHistory(): Promise<void> {
        if (extractionSessionHistoryLoaded || !currentCanvasState) return
        extractionSessionHistoryLoaded = true
        try {
            const runs = await servicesStore.getData('nats')?.request(
                NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.LIST_BY_WORKSPACE,
                {
                    token: await AuthService.getTokenSilently(),
                    workspaceId,
                },
            )
            if (!Array.isArray(runs) || !currentCanvasState) {
                extractionSessionHistoryLoaded = false
                return
            }
            const featureExtractionRuns = { ...(currentCanvasState.featureExtractionRuns ?? {}) }
            let added = false
            for (const run of runs) {
                if (!run?.extractionRunId || featureExtractionRuns[run.extractionRunId]) continue
                featureExtractionRuns[run.extractionRunId] = {
                    extractionRunId: run.extractionRunId,
                    status: run.status,
                    ...(run.sourceContextSnapshot ? { sourceContextSnapshot: run.sourceContextSnapshot } : {}),
                    updatedAt: run.updatedAt,
                }
                added = true
            }
            if (!added) return
            commitCanvasMetadataState({ ...currentCanvasState, featureExtractionRuns })
            renderActiveAiChatPanel()
        } catch (error) {
            extractionSessionHistoryLoaded = false
            console.error('Failed to load feature extraction sessions:', error)
        }
    }

    async function createStandaloneThreadAndSubmit(data: any): Promise<void> {
        const aiChatThreadService = servicesStore.getData('aiChatThreadService')
        if (!aiChatThreadService) return

        const submittedTab = getActiveAiChatSidebarTab()
        const submittedDraftTabId = submittedTab?.type === 'draft' ? submittedTab.tabId : null
        const threadId = uuidv4()
        const initialContent = {
            type: 'doc',
            content: [
                { type: 'documentTitle', content: [{ type: 'text', text: 'AI Chat' }] },
                { type: 'aiChatThread', attrs: { threadId }, content: [] },
            ],
        }
        const thread = await aiChatThreadService.createAiChatThread({
            workspaceId,
            threadId,
            content: initialContent,
            aiModel: data.aiModel,
            title: 'AI Chat',
            owner: { type: 'standalone' },
        })
        if (!thread) return

        if (submittedDraftTabId) {
            replaceAiChatDraftSidebarTab(submittedDraftTabId, threadId)
            activeAiChatSidebarThreadId = threadId
        } else {
            ensureAiChatSidebarThreadTab(threadId)
        }
        activeAiChatSidebarTabId = `thread:${threadId}`
        activeAiChatThreadId = threadId
        activeAiChatRootNodeId = null
        aiChatPanelState = { ...aiChatPanelState, isOpen: true }
        persistAiChatSidebarState()
        renderActiveAiChatPanel(undefined, thread)
        promptInputController.setTarget({
            nodeId: `standalone:${threadId}`,
            type: 'aiChatThread',
            referenceId: threadId,
        })
        await promptInputController.submitMessage({
            contentJSON: data.contentJSON,
            aiModel: data.aiModel,
            aiModels: data.aiModels,
            imageOptions: data.imageOptions,
            videoOptions: data.videoOptions,
        })
    }

    function renderActiveAiChatPanel(
        rootNodeOverride?: ChatRootNode,
        threadOverride?: AiChatThread,
        options: RenderActiveAiChatPanelOptions = {}
    ): void {
        if (!aiChatPanelState.isOpen) {
            destroyActiveAiChatPanel(false)
            return
        }
        void loadExtractionSessionHistory()

        const activeSidebarTab = getActiveAiChatSidebarTab()
        const panelThreadId = activeSidebarTab?.type === 'thread' ? activeSidebarTab.refId : null
        const rootNode = rootNodeOverride && rootNodeOverride.referenceId === panelThreadId
            ? rootNodeOverride
            : getChatRootNodeForThread(panelThreadId)
        const thread = panelThreadId
            ? threadOverride?.threadId === panelThreadId
                ? threadOverride
                : currentAiChatThreads.find((candidate) => candidate.threadId === panelThreadId)
            : undefined
        activeAiChatThreadId = panelThreadId
        activeAiChatRootNodeId = rootNode?.nodeId ?? null
        const shouldRenderTabs = aiChatSidebarTabs.length > 1
        const preservedTabsEl = options.preserveTabsSwitch && shouldRenderTabs
            ? activeAiChatPanelEl?.querySelector<HTMLDivElement>('.workspace-ai-chat-panel-tabs') ?? null
            : null
        const preservedTabsScrollLeft = preservedTabsEl?.scrollLeft ?? 0
        preservedTabsEl?.remove()
        destroyActiveAiChatPanel(false, activeAiChatPanelThreadId ?? activeAiChatThreadId, Boolean(preservedTabsEl))

        const panelEl = html`<div
            className="workspace-ai-chat-floating-panel workspace-ai-chat-thread-node nopan nowheel"
            data=${{ threadId: panelThreadId ?? '', rootNodeId: rootNode?.nodeId ?? '' }}
            onmousedown=${(event: Event) => event.stopPropagation()}
            onclick=${(event: Event) => event.stopPropagation()}
        ></div>` as HTMLDivElement

        panelEl.style.setProperty('--ai-chat-thread-node-box-shadow', settings.aiChatThread.styles.nodeBoxShadow)
        panelEl.style.setProperty('--ai-chat-thread-node-border', settings.aiChatThread.styles.nodeBorder)
        panelEl.style.setProperty('--workspace-ai-chat-panel-divider-border', settings.aiChatThread.styles.panelSectionDividerBorder)
        applyAiChatPanelSessionHistorySettings(panelEl)
        applyAiChatPanelContextPreviewSettings(panelEl)
        const backdropEl = html`<div className="workspace-ai-chat-panel-backdrop" aria-hidden="true"></div>` as HTMLDivElement

        if (!settings.aiChatThread.showHeader) {
            panelEl.classList.add('workspace-ai-chat-thread-node-hide-title')
        }

        const gradient = settings.aiChatThread.useShiftingGradientBackground
            ? createShiftingGradientBackground(panelEl)
            : null

        const controlsEl = html`<div className="workspace-ai-chat-panel-context-controls">
            <div className="workspace-ai-chat-panel-context-mode">
                <div className="workspace-ai-chat-panel-history-control">
                    <button
                        type="button"
                        className="workspace-ai-chat-panel-new-chat"
                        aria-label="Start new chat"
                        innerHTML=${xCircleIcon}
                    ></button>
                    <button
                        type="button"
                        className=${`workspace-ai-chat-panel-history-toggle${aiChatPanelState.isSessionHistoryOpen ? ' workspace-ai-chat-panel-history-toggle-active' : ''}`}
                        aria-label="Toggle session history"
                        aria-controls="workspace-ai-chat-panel-sessions"
                        aria-expanded=${String(aiChatPanelState.isSessionHistoryOpen)}
                        innerHTML=${aiChatPanelToggleHistoryIcon}
                    ></button>
                </div>
            </div>
        </div>` as HTMLDivElement
        panelEl.appendChild(controlsEl)
        const newChatEl = controlsEl.querySelector<HTMLButtonElement>('.workspace-ai-chat-panel-new-chat')!
        newChatEl.addEventListener('click', () => startNewAiChatDraft())
        const historyToggleEl = controlsEl.querySelector<HTMLButtonElement>('.workspace-ai-chat-panel-history-toggle')!

        const tabsEl = shouldRenderTabs
            ? preservedTabsEl ?? html`<div className="workspace-ai-chat-panel-tabs"></div>` as HTMLDivElement
            : null
        let tabsInitialScrollLeft = preservedTabsEl ? preservedTabsScrollLeft : 0
        if (tabsEl && !preservedTabsEl) {
            const tabSwitchHeight = settings.aiChatThread.panelTabs.height
            const tabSwitchViewportWidth = getAiChatPanelTabsViewportWidth()
            const selectedTabIndex = Math.max(0, aiChatSidebarTabs.findIndex((tab) => tab.tabId === activeSidebarTab?.tabId))
            const tabsSvg = select(tabsEl).append('svg:svg')
                .attr('class', 'workspace-ai-chat-panel-tabs-switch')
                .attr('aria-label', 'AI chat tabs')

            activeAiChatPanelTabsSwitch = createSlidingTabsSwitch<string>(tabsSvg, {
                id: 'workspace-ai-chat-panel-tabs',
                x: 0,
                y: 0,
                width: tabSwitchViewportWidth,
                height: tabSwitchHeight,
                minTabWidth: settings.aiChatThread.panelTabs.minTabWidth,
                transition: {
                    durationMs: settings.aiChatThread.panelTabs.transitionDurationMs,
                    minDurationMs: settings.aiChatThread.panelTabs.transitionMinDurationMs,
                    distanceSpeedupFactor: settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor,
                },
                activeTabBoxShadow: settings.aiChatThread.panelTabs.styles.activeTabBoxShadow,
                activeTabInsetShadow: settings.aiChatThread.panelTabs.styles.activeTabInsetShadow,
                tabs: aiChatSidebarTabs.map((tab) => ({
                    label: tab.title,
                    value: tab.tabId,
                    closable: true,
                    closeAriaLabel: `Close ${tab.title}`,
                })),
                selectedValue: activeSidebarTab?.tabId ?? aiChatSidebarTabs[0]!.tabId,
                onChange: (tabId) => {
                    activeAiChatSidebarTabId = tabId
                    persistAiChatSidebarState()
                    syncActiveAiChatPanelFromState()
                    renderActiveAiChatPanel(undefined, undefined, { preserveTabsSwitch: true })
                },
                onClose: (tabId) => closeAiChatSidebarTab(tabId),
            })
            tabsInitialScrollLeft = getAiChatPanelActiveTabScrollLeft(
                activeAiChatPanelTabsSwitch.getContentWidth(),
                tabSwitchViewportWidth,
                selectedTabIndex,
                aiChatSidebarTabs.length
            )
        }
        const sessionsEl = html`<div
            id="workspace-ai-chat-panel-sessions"
            className=${`workspace-ai-chat-panel-sessions${aiChatPanelState.isSessionHistoryOpen ? '' : ' workspace-ai-chat-panel-sessions-hidden'}`}
        >
            <div className="workspace-ai-chat-panel-sessions-title">Sessions</div>
            <div className="workspace-ai-chat-panel-sessions-list"></div>
        </div>` as HTMLDivElement
        const singleTabDividerEl = shouldRenderTabs
            ? null
            : html`<div
                className=${`workspace-ai-chat-panel-single-tab-divider${aiChatPanelState.isSessionHistoryOpen ? ' workspace-ai-chat-panel-single-tab-divider-hidden' : ''}`}
                aria-hidden="true"
            ></div>` as HTMLDivElement
        historyToggleEl.addEventListener('click', () => {
            const isSessionHistoryOpen = !aiChatPanelState.isSessionHistoryOpen
            aiChatPanelState = { ...aiChatPanelState, isSessionHistoryOpen }
            historyToggleEl.classList.toggle('workspace-ai-chat-panel-history-toggle-active', isSessionHistoryOpen)
            select(historyToggleEl).attr('aria-expanded', String(isSessionHistoryOpen))
            sessionsEl.classList.toggle('workspace-ai-chat-panel-sessions-hidden', !isSessionHistoryOpen)
            singleTabDividerEl?.classList.toggle('workspace-ai-chat-panel-single-tab-divider-hidden', isSessionHistoryOpen)
            persistAiChatSidebarState()
        })
        const sessionsListEl = sessionsEl.querySelector('.workspace-ai-chat-panel-sessions-list') as HTMLDivElement
        const sessions = [...currentAiChatThreads].sort((a, b) => b.updatedAt - a.updatedAt)
        for (const session of sessions) {
            const sessionTitle = session.title ?? 'AI Chat'
            const sessionEl = html`<div className="workspace-ai-chat-panel-session">
                <button type="button" className="workspace-ai-chat-panel-session-open">
                    <span className="workspace-ai-chat-panel-session-marker workspace-ai-chat-panel-session-marker-thread" aria-hidden="true"></span>
                    <span className="workspace-ai-chat-panel-session-content">
                        <span className="workspace-ai-chat-panel-session-title">${sessionTitle}</span>
                        <span className="workspace-ai-chat-panel-session-date">${formatSessionUpdatedAt(session.updatedAt)}</span>
                        <span className="workspace-ai-chat-panel-session-meta">${getAiChatSessionMeta(session)}</span>
                    </span>
                </button>
            </div>` as HTMLDivElement
            sessionEl.querySelector('.workspace-ai-chat-panel-session-open')?.addEventListener('click', () => {
                ensureAiChatSidebarThreadTab(session.threadId)
                activeAiChatSidebarTabId = `thread:${session.threadId}`
                aiChatPanelState = { ...aiChatPanelState, isOpen: true, isSessionHistoryOpen: false }
                persistAiChatSidebarState()
                syncActiveAiChatPanelFromState()
                renderActiveAiChatPanel(getChatRootNodeForThread(session.threadId), session)
            })
            const deleteEl = html`<button type="button" className="workspace-ai-chat-panel-session-delete" aria-label="Delete session" innerHTML=${trashBinIcon}></button>` as HTMLButtonElement
            deleteEl.addEventListener('click', () => void deleteAiChatSession(session.threadId))
            sessionEl.appendChild(deleteEl)
            sessionsListEl.appendChild(sessionEl)
        }
        const extractionSessions = Object.values(currentCanvasState?.featureExtractionRuns ?? {})
            .sort((a, b) => b.updatedAt - a.updatedAt)
        for (const extractionState of extractionSessions) {
            const sessionEl = html`<div className="workspace-ai-chat-panel-session">
                <button type="button" className="workspace-ai-chat-panel-session-open">
                    <span className="workspace-ai-chat-panel-session-marker workspace-ai-chat-panel-session-marker-extraction" aria-hidden="true"></span>
                    <span className="workspace-ai-chat-panel-session-content">
                        <span className="workspace-ai-chat-panel-session-title">${getExtractionSessionTitle(extractionState)}</span>
                        <span className="workspace-ai-chat-panel-session-date">${formatSessionUpdatedAt(extractionState.updatedAt)}</span>
                        <span className="workspace-ai-chat-panel-session-meta">${getExtractionSessionMeta(extractionState)}</span>
                    </span>
                </button>
            </div>` as HTMLDivElement
            sessionEl.querySelector('.workspace-ai-chat-panel-session-open')?.addEventListener('click', () => {
                openFeatureExtractionTab(extractionState.extractionRunId)
            })
            const deleteEl = html`<button type="button" className="workspace-ai-chat-panel-session-delete" aria-label="Delete extraction session" innerHTML=${trashBinIcon}></button>` as HTMLButtonElement
            deleteEl.addEventListener('click', () => void deleteExtractionSession(extractionState.extractionRunId))
            sessionEl.appendChild(deleteEl)
            sessionsListEl.appendChild(sessionEl)
        }
        panelEl.appendChild(sessionsEl)
        if (tabsEl) panelEl.appendChild(tabsEl)
        if (singleTabDividerEl) panelEl.appendChild(singleTabDividerEl)

        const bodyHost = html`<div className="workspace-ai-chat-panel-body"></div>` as HTMLDivElement
        const showingThread = activeSidebarTab?.type === 'thread'
        const showingExtraction = activeSidebarTab?.type === 'extraction'
        const emptyBodyText = activeSidebarTab?.type === 'draft' ? '' : 'Start a new chat or reopen a session.'
        const editorContainer = html`<div className=${`ai-chat-thread-node-editor workspace-ai-chat-panel-body-pane nopan${showingThread ? '' : ' workspace-ai-chat-panel-body-pane-hidden'}`}></div>` as HTMLDivElement
        const extractionBodyEl = html`<div className=${`workspace-ai-chat-panel-extraction workspace-ai-chat-panel-body-pane nopan${showingExtraction ? '' : ' workspace-ai-chat-panel-body-pane-hidden'}`}></div>` as HTMLDivElement
        const emptyBodyEl = html`<div className=${`workspace-ai-chat-panel-empty workspace-ai-chat-panel-body-pane nopan${showingThread || showingExtraction ? ' workspace-ai-chat-panel-body-pane-hidden' : ''}`}>${emptyBodyText}</div>` as HTMLDivElement
        bodyHost.appendChild(editorContainer)
        bodyHost.appendChild(extractionBodyEl)
        bodyHost.appendChild(emptyBodyEl)
        panelEl.appendChild(bodyHost)

        if (showingExtraction && activeSidebarTab) {
            const extractionState = getPersistedFeatureExtractionState(activeSidebarTab.refId)
            if (extractionState?.sourceContextSnapshot && !getPendingExtractionContext(activeSidebarTab.refId)) {
                setPendingExtractionContext(activeSidebarTab.refId, extractionState.sourceContextSnapshot as any)
            }
            renderExtractionTabBody(activeSidebarTab.tabId, activeSidebarTab.refId, extractionBodyEl, workspaceId, {
                getState: getPersistedFeatureExtractionState,
            })
        }

        const hasContent = aiChatThreadHasRenderableContent(thread)
        const promptControlFactories = getPromptControlFactories()
        let activeAiService: AiInteractionService | null = null
        if (showingThread && panelThreadId) {
            const editorContent = hasContent && thread
                ? thread.content
                : {
                    type: 'doc',
                    content: [
                        { type: 'documentTitle', content: [{ type: 'text', text: 'AI Chat' }] },
                        { type: 'aiChatThread', attrs: { threadId: panelThreadId }, content: [] },
                    ],
                }
            activeAiService = new AiInteractionService({ workspaceId, aiChatThreadId: panelThreadId })
            const aiService = activeAiService
            const editor = new ProseMirrorEditor({
                editorMountElement: editorContainer,
                content: html`<div></div>` as HTMLDivElement,
                initialVal: editorContent,
                isDisabled: false,
                documentType: 'aiChatThread',
                threadId: panelThreadId,
                onEditorChange: (value: any) => {
                    onAiChatThreadContentChange?.({ workspaceId, threadId: panelThreadId, content: value })
                    // The descriptor lives on the canvas thread node (if this thread
                    // has one); standalone panel-only sessions have no node to patch.
                    if (rootNode) scheduleTextNodeDescriptor(rootNode.nodeId, value)
                },
                onProjectTitleChange: () => {},
                onAiChatSubmit: async ({ messages, aiModel, aiModels, imageOptions, videoOptions, referencedFeatureIds }: any) => {
                    gradient?.triggerAnimation()
                    activeAiChatPromptGradient?.triggerAnimation()

                    try {
                        const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                        // Explicit context chips are always force-included. For a canvas
                        // thread node we also pull its edge-connected context; chip and
                        // edge items are deduped by nodeId so an overlapping node isn't sent twice.
                        const chipNodeIds = aiChatPanelState.contextChips.slice()
                        const edgeContext = rootNode
                            ? await aiChatThreadService.extractConnectedContext(rootNode.nodeId)
                            : []
                        const chipContext = chipNodeIds.length
                            ? await aiChatThreadService.extractSelectedContext({ nodeIds: chipNodeIds, includeUpstream: false })
                            : []
                        const seenContextNodeIds = new Set<string>()
                        const context = [...edgeContext, ...chipContext].filter((item) => {
                            if (seenContextNodeIds.has(item.nodeId)) return false
                            seenContextNodeIds.add(item.nodeId)
                            return true
                        })
                        const contextMessage = aiChatThreadService.buildContextMessage(context)
                        const messagesWithContext = contextMessage ? [contextMessage, ...messages] : messages
                        // The branch-resolver snapshot is reused for video generation too —
                        // VEO image-to-video / reference-image inputs come from the same VLM
                        // resolution, so the snapshot must be built whenever an image OR
                        // video model is selected.
                        const hasMediaModel = Boolean(
                            imageOptions?.aiImageModel
                            || imageOptions?.aiImageModels?.length
                            || videoOptions?.aiVideoModel
                            || videoOptions?.aiVideoModels?.length
                        )
                        const imagePlacement = rootNode
                            ? rememberGeneratedImagePlacement(
                                rootNode.referenceId,
                                rootNode,
                                messages,
                                hasMediaModel
                            )
                            : rememberStandaloneGeneratedImagePlacement(panelThreadId, messages, hasMediaModel)
                        const imageBranchCandidateSnapshot = imagePlacement.imageBranchCandidateSnapshot

                        // Whole-workspace, descriptors-only index for the API relevance stage.
                        // Built every turn (text-only included); chips + the rooted thread's
                        // edge-connected nodes are flagged so the API can force-include them.
                        const workspaceContextSnapshot = currentCanvasState
                            ? buildWorkspaceContextSnapshot({
                                workspaceId,
                                threadId: panelThreadId ?? '',
                                prompt: imagePlacement.promptText,
                                nodes: currentCanvasState.nodes,
                                edges: currentCanvasState.edges,
                                rootNodeId: rootNode?.nodeId,
                                contextChipNodeIds: chipNodeIds,
                                titlesByNodeId: buildWorkspaceContextTitlesByNodeId(currentCanvasState.nodes),
                            })
                            : undefined

                        // Resolve `sourceVideoNodeId` (set by the "Extend video in new
                        // thread" action) to a workspace Object Store URI. VEO consumes
                        // this as its `video` (extension) input — see google-provider
                        // `runVeoGeneration` precedence: extension > first-frame > refs.
                        let videoSourceForExtension: string | undefined
                        if (videoOptions?.sourceVideoNodeId) {
                            const sourceVideoNode = currentCanvasState?.nodes.find(
                                (n: CanvasNode) => n.nodeId === videoOptions.sourceVideoNodeId && n.type === 'video'
                            ) as VideoCanvasNode | undefined
                            if (sourceVideoNode?.fileId) {
                                videoSourceForExtension = `nats-obj://workspace-${workspaceId}-files/${sourceVideoNode.fileId}`
                            }
                        }

                        aiService.sendChatMessage({
                            messages: messagesWithContext,
                            aiModel,
                            aiModels,
                            aiImageModel: imageOptions?.aiImageModel,
                            aiImageModels: imageOptions?.aiImageModels,
                            imageSize: imageOptions?.imageGenerationSize,
                            aiVideoModel: videoOptions?.aiVideoModel,
                            aiVideoModels: videoOptions?.aiVideoModels,
                            videoAspectRatio: videoOptions?.videoAspectRatio,
                            videoResolution: videoOptions?.videoResolution,
                            videoDuration: videoOptions?.videoDuration,
                            videoSourceForExtension,
                            referencedFeatureIds,
                            imageBranchCandidateSnapshot,
                            workspaceContextSnapshot,
                        })
                        clearExplicitContextChips()
                    } catch (error) {
                        console.error('Failed to gather AI chat context:', error)
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
        }

        const promptEl = html`<div className="ai-prompt-input-floating workspace-ai-chat-floating-panel-prompt nopan"></div>` as HTMLDivElement
        applyAiPromptInputStyleSettings(promptEl)
        if (settings.aiPromptInput.useShiftingGradientBackground) {
            activeAiChatPromptGradient = createShiftingGradientBackground(promptEl)
        }

        const promptEditorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        promptEl.appendChild(promptEditorContainer)
        panelEl.appendChild(promptEl)

        const promptDraftKey = activeSidebarTab?.tabId ?? NEW_CHAT_DRAFT_KEY
        activeAiChatPromptEditor = new ProseMirrorEditor({
            editorMountElement: promptEditorContainer,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: aiChatPanelState.drafts?.[promptDraftKey]?.content ?? {},
            isDisabled: false,
            documentType: 'aiPromptInput',
            threadId: panelThreadId ?? NEW_CHAT_DRAFT_KEY,
            onEditorChange: (value: object) => {
                persistAiChatPromptDraft(promptDraftKey, value)
                scheduleActiveAiChatPanelRailHeightUpdate()
            },
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
                    clearExplicitContextChips()
                    return
                }

                if (!panelThreadId) {
                    void createStandaloneThreadAndSubmit(data)
                    return
                }
                promptInputController.setTarget(rootNode
                    ? { nodeId: rootNode.nodeId, type: rootNode.type, referenceId: panelThreadId }
                    : { nodeId: `standalone:${panelThreadId}`, type: 'aiChatThread', referenceId: panelThreadId })
                void promptInputController.submitMessage({
                    contentJSON: data.contentJSON,
                    aiModel: data.aiModel,
                    aiModels: data.aiModels,
                    imageOptions: data.imageOptions,
                    videoOptions: data.videoOptions,
                })
            },
            onPromptStop: () => {
                if (panelThreadId) {
                    activeAiService?.stopChatMessage()
                }
            },
            isPromptReceiving: () => promptInputController.isReceiving(panelThreadId ?? undefined),
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
            className="workspace-thread-rail workspace-ai-chat-floating-panel-rail nopan"
            style=${railStyle}
            data=${{ threadNodeId: rootNode?.nodeId ?? 'ai-chat-panel' }}
        ></div>` as HTMLDivElement
        rail.style.setProperty('--rail-gradient', settings.aiChatThread.rail.styles.gradient)
        rail.style.setProperty('--rail-width', settings.aiChatThread.rail.styles.width)
        rail.addEventListener('mousedown', (event) => {
            handleActiveAiChatPanelResizeStart(event, panelEl)
        })

        const line = html`<div className="workspace-thread-rail-line"></div>` as HTMLDivElement
        const bottomCircle = html`<div className="workspace-thread-rail-boundary-circle" innerHTML=${aiChatThreadRailBoundaryCircle}></div>` as HTMLDivElement
        const circlePaths = bottomCircle.querySelectorAll('path')
        const [outerColor, ringColor, innerColor] = settings.aiChatThread.rail.styles.boundaryCircleColors
        if (circlePaths[0]) circlePaths[0].setAttribute('fill', outerColor)
        if (circlePaths[1]) circlePaths[1].setAttribute('fill', ringColor)
        if (circlePaths[2]) circlePaths[2].setAttribute('fill', innerColor)
        line.appendChild(bottomCircle)
        rail.appendChild(line)
        panelEl.appendChild(rail)

        activeAiChatPanelEl = panelEl
        activeAiChatPanelThreadId = panelThreadId
        activeAiChatPanelRootNodeId = rootNode?.nodeId ?? null
        activeAiChatPanelHadContent = hasContent
        activeAiChatBackdropEl = backdropEl
        activeAiChatPromptResizeObserver = new ResizeObserver(scheduleActiveAiChatPanelRailHeightUpdate)
        activeAiChatPromptResizeObserver.observe(promptEl)
        paneEl.appendChild(backdropEl)
        paneEl.appendChild(panelEl)

        if (activeAiChatPanelWidth !== null) {
            applyActiveAiChatPanelWidth(activeAiChatPanelWidth)
        }

        requestAnimationFrame(() => {
            resizeActiveAiChatPanelTabsSwitch()
            if (tabsEl) tabsEl.scrollLeft = tabsInitialScrollLeft
            rail.style.setProperty('--rail-thread-height', `${measureActiveAiChatPanelRailThreadHeight(panelEl)}px`)
        })
    }

    // ---- Single floating input (for non-thread nodes) ----

    function createFloatingInput(): void {
        if (floatingInputEl) return

        const floatingInputStyle = { position: 'absolute' as const, display: 'none', zIndex: '9999', width: '400px' }
        floatingInputEl = html`<div className="ai-prompt-input-floating nopan" style=${floatingInputStyle}></div>` as HTMLDivElement

        // Add gradient background (controlled by settings flag)
        if (settings.aiPromptInput.useShiftingGradientBackground) {
            floatingInputGradient = createShiftingGradientBackground(floatingInputEl)
        }

        const editorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        floatingInputEl.appendChild(editorContainer)

        const controlFactories = {
            createModelDropdown: createGenericAiModelMultiSelect,
            createImageModelDropdown: createGenericImageModelMultiSelect,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createVideoModelDropdown: createGenericVideoModelMultiSelect,
            createVideoAspectDropdown: createGenericVideoAspectDropdown,
            createVideoResolutionDropdown: createGenericVideoResolutionDropdown,
            createVideoDurationDropdown: createGenericVideoDurationDropdown,
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
                    aiModels: data.aiModels,
                    imageOptions: data.imageOptions,
                    videoOptions: data.videoOptions,
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

    function createThreadFloatingInput(node: AiChatThreadCanvasNode, savedAttrs?: { aiModel?: string; aiModels?: string; aiImageModel?: string; aiImageModels?: string; imageGenerationSize?: string; aiVideoModel?: string; aiVideoModels?: string; videoAspectRatio?: string; videoResolution?: string; videoDuration?: string }): void {
        if (threadFloatingInputs.has(node.nodeId)) return

        const threadInputStyle = { position: 'absolute' as const, display: 'block', zIndex: '9999' }
        const el = html`<div
            className="ai-prompt-input-floating ai-prompt-input-thread-persistent nopan"
            style=${threadInputStyle}
            data=${{ threadNodeId: node.nodeId }}
        ></div>` as HTMLDivElement

        const gradient = settings.aiPromptInput.useShiftingGradientBackground
            ? createShiftingGradientBackground(el)
            : null

        const editorContainer = html`<div className="floating-input-editor nopan"></div>` as HTMLDivElement
        el.appendChild(editorContainer)

        const controlFactories = {
            createModelDropdown: createGenericAiModelMultiSelect,
            createImageModelDropdown: createGenericImageModelMultiSelect,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createVideoModelDropdown: createGenericVideoModelMultiSelect,
            createVideoAspectDropdown: createGenericVideoAspectDropdown,
            createVideoResolutionDropdown: createGenericVideoResolutionDropdown,
            createVideoDurationDropdown: createGenericVideoDurationDropdown,
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
                    aiModels: data.aiModels,
                    imageOptions: data.imageOptions,
                    videoOptions: data.videoOptions,
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
        rail.style.setProperty('--rail-gradient', settings.aiChatThread.rail.styles.gradient)
        rail.style.setProperty('--rail-width', settings.aiChatThread.rail.styles.width)

        const line = html`<div className="workspace-thread-rail-line"></div>` as HTMLDivElement
        const bottomCircle = html`<div className="workspace-thread-rail-boundary-circle" innerHTML=${aiChatThreadRailBoundaryCircle}></div>` as HTMLDivElement
        const circlePaths = bottomCircle.querySelectorAll('path')
        const [outerColor, ringColor, innerColor] = settings.aiChatThread.rail.styles.boundaryCircleColors
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

        const boundaryCircle = rail.querySelector('.workspace-thread-rail-boundary-circle') as HTMLElement | null
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
        // Disabled. The canvas keeps thread node dimensions explicit so drag,
        // resize, connector, and floating-input geometry stay stable.
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
        sourceNodeId?: string
        placementAnchorNodeId?: string
        referenceNodeIds?: string[]
        branchOriginNodeId?: string
        promptText: string
        branchId: string
        imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
        imageBranchResolution?: ImageBranchVlmResolution
        activeRunKeys?: Set<string>
        createdAt: number
    }

    const pendingGeneratedImagePlacements = new Map<string, PendingGeneratedImagePlacement>()

    function getGeneratedMediaPlacementKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.generationRequestId
            ? `${threadId}:${generationRun.generationRequestId}`
            : threadId
    }

    function getGeneratedMediaRunKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.mediaRunId ?? generationRun?.reasoningRunId ?? threadId
    }

    function getPendingGeneratedMediaPlacement(threadId: string, generationRun?: MediaGenerationRunMeta): PendingGeneratedImagePlacement | undefined {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const placement = pendingGeneratedImagePlacements.get(placementKey)
        if (placement) return placement

        if (!generationRun?.generationRequestId) return pendingGeneratedImagePlacements.get(threadId)

        const legacyPlacement = pendingGeneratedImagePlacements.get(threadId)
        if (!legacyPlacement) return undefined

        const clonedPlacement: PendingGeneratedImagePlacement = {
            ...legacyPlacement,
            activeRunKeys: legacyPlacement.activeRunKeys ? new Set(legacyPlacement.activeRunKeys) : undefined,
        }
        pendingGeneratedImagePlacements.set(placementKey, clonedPlacement)
        return clonedPlacement
    }

    function setPendingGeneratedMediaPlacement(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        placement: PendingGeneratedImagePlacement,
    ): void {
        pendingGeneratedImagePlacements.set(getGeneratedMediaPlacementKey(threadId, generationRun), placement)
    }

    function registerGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        if (!placement) return

        const runKey = getGeneratedMediaRunKey(threadId, generationRun)
        const activeRunKeys = new Set(placement.activeRunKeys ?? [])
        activeRunKeys.add(runKey)
        setPendingGeneratedMediaPlacement(threadId, generationRun, {
            ...placement,
            activeRunKeys,
        })
    }

    function finishGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const placement = pendingGeneratedImagePlacements.get(placementKey)
        if (!placement) return

        if (!generationRun?.generationRequestId) {
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
            return
        }

        const activeRunKeys = new Set(placement.activeRunKeys ?? [])
        activeRunKeys.delete(getGeneratedMediaRunKey(threadId, generationRun))
        if (activeRunKeys.size > 0) {
            pendingGeneratedImagePlacements.set(placementKey, {
                ...placement,
                activeRunKeys,
            })
            return
        }

        pendingGeneratedImagePlacements.delete(placementKey)
        clearGeneratingReferenceNodeIds(placementKey)
    }

    function clearPendingGeneratedMediaPlacementsForThread(threadId: string): void {
        for (const placementKey of pendingGeneratedImagePlacements.keys()) {
            if (placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
        }
    }

    function findSourceThreadNode(threadId: string): ChatRootNode | undefined {
        return currentCanvasState?.nodes.find(
            (n: CanvasNode): n is ChatRootNode => n.type === 'aiChatThread' && n.referenceId === threadId
        )
    }

    function findCanvasNodeById(nodeId: string | undefined): CanvasNode | undefined {
        if (!nodeId) return undefined
        return currentCanvasState?.nodes.find((node: CanvasNode) => node.nodeId === nodeId)
    }

    function getFirstExistingMediaNodeId(nodeIds: Iterable<string | null | undefined>): string | undefined {
        for (const nodeId of nodeIds) {
            const node = findCanvasNodeById(nodeId ?? undefined)
            if (node?.type === 'image' || node?.type === 'video') return node.nodeId
        }
        return undefined
    }

    function getExistingMediaNodeIds(nodeIds: Iterable<string | null | undefined>): string[] {
        const mediaNodeIds: string[] = []
        const seen = new Set<string>()
        for (const nodeId of nodeIds) {
            const node = findCanvasNodeById(nodeId ?? undefined)
            if (!node || (node.type !== 'image' && node.type !== 'video') || seen.has(node.nodeId)) continue
            seen.add(node.nodeId)
            mediaNodeIds.push(node.nodeId)
        }
        return mediaNodeIds
    }

    function getStandaloneGeneratedMediaReferenceNodeIds(): string[] {
        return getExistingMediaNodeIds([
            ...aiChatPanelState.contextChips,
            ...Array.from(selectedNodeIds),
        ])
    }

    function getGeneratedMediaLineageSourceNodeIdFromResolution(resolution: ImageBranchVlmResolution): string | undefined {
        for (const nodeId of [resolution.targetImageNodeId, resolution.parentImageNodeId]) {
            const node = findCanvasNodeById(nodeId ?? undefined)
            if (!node || !isGeneratedMediaNode(node)) continue
            const continuesSelectedBranch = resolution.mode === 'edit-active-branch'
                || resolution.operationKind === 'edit_existing'
                || Boolean(resolution.branchId && node.generatedBy?.branchId === resolution.branchId)
            if (continuesSelectedBranch) return node.nodeId
        }
        return undefined
    }

    function getGeneratedMediaPlacementNode(threadId: string, generationRun?: MediaGenerationRunMeta): CanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const anchorNode = findCanvasNodeById(placement?.sourceNodeId)
            ?? findCanvasNodeById(placement?.placementAnchorNodeId)
        return anchorNode ?? findSourceThreadNode(threadId)
    }

    function getGeneratedMediaEdgeSourceNode(threadId: string, generationRun?: MediaGenerationRunMeta): CanvasNode | undefined {
        const pendingSourceNodeId = getPendingGeneratedMediaPlacement(threadId, generationRun)?.sourceNodeId
        const pendingOriginNodeId = getPendingGeneratedMediaPlacement(threadId, generationRun)?.branchOriginNodeId
        return findCanvasNodeById(pendingSourceNodeId)
            ?? findSourceThreadNode(threadId)
            ?? findCanvasNodeById(pendingOriginNodeId)
    }

    function addBranchOriginNodeIfMissing(nodes: CanvasNode[], branchOriginNode: BranchOriginCanvasNode | undefined): CanvasNode[] {
        if (!branchOriginNode) return nodes
        if (nodes.some((node: CanvasNode) => node.nodeId === branchOriginNode.nodeId)) return nodes
        return [...nodes, branchOriginNode]
    }

    function ensureBranchOriginForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        mediaHeight: number,
    ): BranchOriginCanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        if (!placement || placement.sourceNodeId || findSourceThreadNode(threadId)) return undefined

        const existing = findCanvasNodeById(placement.branchOriginNodeId)
        if (existing?.type === 'branchOrigin') return existing as BranchOriginCanvasNode

        const generationRequestId = generationRun?.generationRequestId ?? `legacy-${threadId}`
        const nodeId = `branch-origin-${placement.branchId}`
        const referencePosition = getReferenceGroupGeneratedMediaPosition(threadId, mediaHeight, generationRun)
            ?? getCenteredInsertionPosition({ width: getGeneratedImageInsertionSize(), height: mediaHeight })
        const position = {
            x: referencePosition.x - settings.imageBranchLineage.imageToImageGap - BRANCH_ORIGIN_NODE_DIMENSIONS.width,
            y: referencePosition.y + (mediaHeight - BRANCH_ORIGIN_NODE_DIMENSIONS.height) / 2,
        }

        // TODO temporary branch-start marker for fresh multi-model generations.
        // Replace this robot-face placeholder when final branch-origin UX is designed.
        const branchOriginNode: BranchOriginCanvasNode = {
            nodeId,
            type: 'branchOrigin',
            branchId: placement.branchId,
            generationRequestId,
            ...(placement.imageBranchCandidateSnapshot?.promptFingerprint
                ? { promptFingerprint: placement.imageBranchCandidateSnapshot.promptFingerprint }
                : {}),
            position,
            dimensions: BRANCH_ORIGIN_NODE_DIMENSIONS,
            temporary: true,
        }

        setPendingGeneratedMediaPlacement(threadId, generationRun, {
            ...placement,
            branchOriginNodeId: nodeId,
        })
        return branchOriginNode
    }

    function setGeneratingReferenceNodeIds(threadId: string, nodeIds: Iterable<string | null | undefined>): void {
        const referenceNodeIds = getExistingMediaNodeIds(nodeIds)
        if (referenceNodeIds.length === 0) {
            generatingReferenceNodeIdsByThread.delete(threadId)
        } else {
            generatingReferenceNodeIdsByThread.set(threadId, new Set(referenceNodeIds))
        }
        syncPixiGeneratingImageNodes()
    }

    function clearGeneratingReferenceNodeIds(threadId: string): void {
        if (!generatingReferenceNodeIdsByThread.delete(threadId)) return
        syncPixiGeneratingImageNodes()
    }

    function clearGeneratingReferencesOnFirstPixels(placementKey: string, generationRun?: MediaGenerationRunMeta): void {
        if (generationRun?.generationRequestId) return
        clearGeneratingReferenceNodeIds(placementKey)
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

    // A new generated output is positioned relative to its most recent sibling.
    // Both images and videos count as siblings here — otherwise a freshly
    // generated video cannot "see" a previously generated video and the two
    // stack on the same spot. Both node types expose the shared fields used
    // below (generatedBy.createdAt, position).
    function getGeneratedChildOutputs(sourceNode: CanvasNode, nodes: CanvasNode[], edges: WorkspaceEdge[]): (ImageCanvasNode | VideoCanvasNode)[] {
        return nodes.filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode => {
            if ((node.type !== 'image' && node.type !== 'video') || node.parentId) return false
            if (!node.generatedBy) return false
            return edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === sourceNode.nodeId && edge.targetNodeId === node.nodeId)
        })
    }

    function getMostRecentGeneratedChildOutput(outputs: (ImageCanvasNode | VideoCanvasNode)[]): ImageCanvasNode | VideoCanvasNode | undefined {
        return [...outputs].sort((a: ImageCanvasNode | VideoCanvasNode, b: ImageCanvasNode | VideoCanvasNode) => {
            const createdAtDelta = (a.generatedBy?.createdAt ?? 0) - (b.generatedBy?.createdAt ?? 0)
            if (createdAtDelta !== 0) return createdAtDelta
            return a.position.x - b.position.x
        }).at(-1)
    }

    function getReferenceGroupRectForGeneratedMedia(threadId: string, generationRun?: MediaGenerationRunMeta): Rect | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        if (!placement?.referenceNodeIds?.length || !currentCanvasState) return undefined

        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        const referenceRects = placement.referenceNodeIds
            .map((nodeId: string) => nodesById.get(nodeId))
            .filter((node: CanvasNode | undefined): node is ImageCanvasNode | VideoCanvasNode => Boolean(node && (node.type === 'image' || node.type === 'video')))
            .map((node: ImageCanvasNode | VideoCanvasNode) => getNodeWorldRect(node, nodesById))

        if (referenceRects.length === 0) return undefined

        const minX = Math.min(...referenceRects.map((rect: Rect) => rect.x))
        const minY = Math.min(...referenceRects.map((rect: Rect) => rect.y))
        const maxX = Math.max(...referenceRects.map((rect: Rect) => rect.x + rect.width))
        const maxY = Math.max(...referenceRects.map((rect: Rect) => rect.y + rect.height))
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function getReferenceGroupGeneratedMediaPosition(threadId: string, mediaHeight: number, generationRun?: MediaGenerationRunMeta): { x: number; y: number } | undefined {
        const referenceGroupRect = getReferenceGroupRectForGeneratedMedia(threadId, generationRun)
        if (!referenceGroupRect) return undefined
        return computeLineageContinuationPositionToRightOfRect(
            referenceGroupRect,
            mediaHeight,
            settings.imageBranchLineage.rootOutputGap
        )
    }

    function getNextGeneratedImagePosition(sourceNode: CanvasNode, imageHeight: number): { x: number; y: number } {
        const nodes = currentCanvasState?.nodes || []
        if (sourceNode.type === 'aiChatThread') {
            return getNextChatRootOutputPosition(sourceNode, imageHeight, nodes)
        }

        const edges = currentCanvasState?.edges ?? []
        const existingChildOutputs = getGeneratedChildOutputs(sourceNode, nodes, edges)
        const previousOutput = getMostRecentGeneratedChildOutput(existingChildOutputs)
        const anchorRect = previousOutput ? getNodeWorldRect(previousOutput) : getNodeWorldRect(sourceNode)

        return computeLineageContinuationPositionToRightOfRect(
            anchorRect,
            imageHeight,
            settings.imageBranchLineage.imageToImageGap
        )
    }

    function getGeneratedMediaInsertionPosition(threadId: string, mediaHeight: number, generationRun?: MediaGenerationRunMeta): { x: number; y: number } | undefined {
        const edgeSourceNode = getGeneratedMediaEdgeSourceNode(threadId, generationRun)
        if (edgeSourceNode) return getNextGeneratedImagePosition(edgeSourceNode, mediaHeight)

        const placementNode = getGeneratedMediaPlacementNode(threadId, generationRun)
        if (placementNode?.type === 'aiChatThread') return getNextGeneratedImagePosition(placementNode, mediaHeight)

        const referenceGroupPosition = getReferenceGroupGeneratedMediaPosition(threadId, mediaHeight, generationRun)
        if (referenceGroupPosition) return referenceGroupPosition

        return placementNode ? getNextGeneratedImagePosition(placementNode, mediaHeight) : undefined
    }

    function createGeneratedImageEdge(sourceNode: CanvasNode, imageNodeId: string, responseMessageId?: string): WorkspaceEdge {
        return {
            edgeId: `edge-${sourceNode.nodeId}-${imageNodeId}`,
            sourceNodeId: sourceNode.nodeId,
            targetNodeId: imageNodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
            ...(sourceNode.type === 'aiChatThread' && responseMessageId ? { sourceMessageId: responseMessageId } : {}),
        }
    }

    function getActiveImageTargetNodeIdForThread(threadId: string, rootNode: ChatRootNode): string | undefined {
        const selectedNodeId = getSingleSelectedNodeId()
        if (!selectedNodeId) return undefined

        const selectedNode = currentCanvasState?.nodes.find((node: CanvasNode) => node.nodeId === selectedNodeId)
        if (selectedNode?.type !== 'image') return undefined

        const selectedImage = selectedNode as ImageCanvasNode
        if (selectedImage.generatedBy?.aiChatThreadId === threadId) return selectedImage.nodeId
        if (selectedImage.parentId === rootNode.nodeId) return selectedImage.nodeId
        if (currentCanvasState?.edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === selectedImage.nodeId && edge.targetNodeId === rootNode.nodeId)) return selectedImage.nodeId

        return undefined
    }

    // Doc/thread node titles for the workspace context snapshot. Media nodes
    // carry their own descriptor, so only document + aiChatThread nodes need a
    // store lookup; a missing title is simply omitted from the snapshot.
    function buildWorkspaceContextTitlesByNodeId(nodes: CanvasNode[]): Record<string, string> {
        const documentTitleById = new Map<string, string>(currentDocuments.map((doc) => [doc.documentId, doc.title]))
        const threadTitleById = new Map<string, string | undefined>(currentAiChatThreads.map((thread) => [thread.threadId, thread.title]))
        const titlesByNodeId: Record<string, string> = {}
        for (const node of nodes) {
            if (node.type === 'document') {
                const title = documentTitleById.get(node.referenceId)
                if (title) titlesByNodeId[node.nodeId] = title
            } else if (node.type === 'aiChatThread') {
                const title = threadTitleById.get(node.referenceId)
                if (title) titlesByNodeId[node.nodeId] = title
            }
        }
        return titlesByNodeId
    }

    function rememberGeneratedImagePlacement(threadId: string, rootNode: ChatRootNode, messages: any[], hasImageModel: boolean): { promptText: string; imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot } {
        if (!hasImageModel) {
            clearPendingGeneratedMediaPlacementsForThread(threadId)
            return { promptText: '' }
        }

        const promptText = getPromptTextFromMessages(messages)
        const activeTargetNodeId = getActiveImageTargetNodeIdForThread(rootNode.referenceId, rootNode)
        const imageBranchCandidateSnapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: rootNode.nodeId,
            threadId: rootNode.referenceId,
            activeTargetNodeId,
            nodes: currentCanvasState?.nodes ?? [],
            edges: currentCanvasState?.edges ?? [],
            prompt: promptText,
            generatedImageTextByNodeId: getGeneratedImageTextByNodeIdForThread(rootNode.referenceId),
        })
        const branchId = `branch-${uuidv4()}`
        pendingGeneratedImagePlacements.set(threadId, {
            sourceNodeId: rootNode.nodeId,
            placementAnchorNodeId: rootNode.nodeId,
            referenceNodeIds: imageBranchCandidateSnapshot.candidates.map((candidate: ImageBranchCandidateSnapshot['candidates'][number]) => candidate.nodeId),
            promptText,
            branchId,
            imageBranchCandidateSnapshot,
            createdAt: Date.now(),
        })
        setGeneratingReferenceNodeIds(threadId, imageBranchCandidateSnapshot.candidates.map((candidate: ImageBranchCandidateSnapshot['candidates'][number]) => candidate.nodeId))
        console.info('[CANVAS] image branch candidate snapshot', {
            threadId,
            candidateCount: imageBranchCandidateSnapshot.candidates.length,
            promptFingerprint: imageBranchCandidateSnapshot.promptFingerprint,
            activeTargetNodeId: imageBranchCandidateSnapshot.activeTargetNodeId,
            candidateNodeIds: imageBranchCandidateSnapshot.candidates.map((candidate: ImageBranchCandidateSnapshot['candidates'][number]) => candidate.nodeId),
        })
        return { promptText, imageBranchCandidateSnapshot }
    }

    function rememberStandaloneGeneratedImagePlacement(threadId: string, messages: any[], hasImageModel: boolean): { promptText: string; imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot } {
        if (!hasImageModel) {
            clearPendingGeneratedMediaPlacementsForThread(threadId)
            return { promptText: '' }
        }

        const promptText = getPromptTextFromMessages(messages)
        const referenceNodeIds = getStandaloneGeneratedMediaReferenceNodeIds()
        const placementAnchorNodeId = referenceNodeIds[0]
        pendingGeneratedImagePlacements.set(threadId, {
            ...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),
            referenceNodeIds,
            promptText,
            branchId: `branch-${uuidv4()}`,
            createdAt: Date.now(),
        })
        setGeneratingReferenceNodeIds(threadId, referenceNodeIds)
        return { promptText }
    }

    function getPendingGeneratedImageLineage(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
        existingGeneratedBy?: ImageCanvasNode['generatedBy'],
    ): Partial<NonNullable<ImageCanvasNode['generatedBy']>> {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        if (!placement) return {}

        const resolution = placement.imageBranchResolution
        const parentImageNodeId = resolution
            ? getGeneratedMediaLineageSourceNodeIdFromResolution(resolution)
            : undefined
        const variantIndex = generationRun?.variantIndex ?? 0

        return {
            generationRequestId: generationRun?.generationRequestId ?? existingGeneratedBy?.generationRequestId,
            reasoningRunId: generationRun?.reasoningRunId ?? existingGeneratedBy?.reasoningRunId,
            mediaRunId: generationRun?.mediaRunId ?? existingGeneratedBy?.mediaRunId,
            reasoningModelId: generationRun?.reasoningModelId ?? existingGeneratedBy?.reasoningModelId,
            mediaModelId: generationRun?.mediaModelId ?? existingGeneratedBy?.mediaModelId,
            mediaType: generationRun?.mediaType ?? existingGeneratedBy?.mediaType,
            variantIndex: generationRun?.variantIndex ?? existingGeneratedBy?.variantIndex,
            branchOriginNodeId: existingGeneratedBy?.branchOriginNodeId ?? placement.branchOriginNodeId,
            branchId: existingGeneratedBy?.branchId ?? resolution?.branchId ?? placement.branchId,
            parentImageNodeId: existingGeneratedBy?.parentImageNodeId ?? parentImageNodeId ?? undefined,
            sourceContextNodeIds: resolution?.sourceContextNodeIds ?? [],
            referenceImageNodeIds: resolution?.referenceImageNodeIds ?? [],
            operationKind: resolution?.operationKind ?? (placement.branchOriginNodeId ? 'fresh_branch' : 'new_image'),
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
            createdAt: existingGeneratedBy?.createdAt ?? placement.createdAt + variantIndex,
        }
    }

    function uniqueStringValues(values: string[]): string[] {
        return Array.from(new Set(values.filter(Boolean)))
    }

    function isGeneratedMediaNode(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode {
        return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy?.branchId)
    }

    function isBranchTreeCanvasNode(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode | BranchOriginCanvasNode {
        return isGeneratedMediaNode(node) || node.type === 'branchOrigin'
    }

    // Compose a media descriptor for AI-generated media for free from the branch
    // resolver's summaries already carried on generatedBy — no extra model call.
    // Uploaded media has no generatedBy and is captioned separately (see
    // analyzeUploadedMedia).
    function buildDescriptorFromGeneratedBy(
        generatedBy: ImageCanvasNode['generatedBy'] | VideoCanvasNode['generatedBy']
    ): MediaDescriptor | undefined {
        if (!generatedBy) return undefined
        const summaryParts = [
            generatedBy.visualEntitySummary ?? generatedBy.entitySummary,
            generatedBy.visualStyleSummary,
        ].filter((text): text is string => Boolean(text?.trim()))
        const summary = (summaryParts.join(' — ') || generatedBy.revisedPrompt || generatedBy.promptText || '').trim()
        if (!summary) return undefined
        return {
            status: 'ready',
            summary,
            entityTags: generatedBy.entityTags ?? [],
            styleTags: generatedBy.styleTags ?? [],
            source: 'generation',
            version: MEDIA_DESCRIPTOR_VERSION,
            updatedAt: Date.now(),
        }
    }

    function buildAnalyzingDescriptor(): MediaDescriptor {
        return {
            status: 'analyzing',
            summary: '',
            entityTags: [],
            styleTags: [],
            source: 'analysis',
            version: MEDIA_DESCRIPTOR_VERSION,
            updatedAt: Date.now(),
        }
    }

    // The branch resolver and descriptor captioner both need a vision-capable
    // model. Pick one the workspace already exposes (image input, not image
    // generation), preferring the configured sort order. Returns a
    // `Provider:model` id, or undefined when no vision model is available.
    function pickDescriptorModel(): string | undefined {
        const models = (aiModelsStore.getData() ?? []) as Array<{ provider: string; model: string; modalities?: Array<{ modality: string }>; sortingPosition?: number }>
        const visionModels = models.filter((model) => {
            const modalities = model.modalities?.map((entry) => entry.modality) ?? []
            return modalities.includes('image') && !modalities.includes('image_generation')
        })
        if (visionModels.length === 0) return undefined
        const best = [...visionModels].sort((a, b) => (a.sortingPosition ?? 0) - (b.sortingPosition ?? 0))[0]
        return `${best.provider}:${best.model}`
    }

    function isDescriptorCanvasNode(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode | DocumentCanvasNode | AiChatThreadCanvasNode {
        return node.type === 'image' || node.type === 'video' || node.type === 'document' || node.type === 'aiChatThread'
    }

    function patchWorkspaceContextImprovedDescriptors(improvedDescriptors: Record<string, ContentDescriptor> | undefined): void {
        if (!currentCanvasState || !improvedDescriptors || Object.keys(improvedDescriptors).length === 0) return
        let patched = false
        const nodes = currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            const descriptor = improvedDescriptors[node.nodeId]
            if (!descriptor || !isDescriptorCanvasNode(node)) return node
            if (JSON.stringify(node.descriptor) === JSON.stringify(descriptor)) return node
            patched = true
            return { ...node, descriptor } as CanvasNode
        })
        if (!patched) return
        currentCanvasState = { ...currentCanvasState, nodes }
        syncPixiMediaLayer(currentCanvasState)
        refreshContextChipTray()
    }

    function updatePendingGeneratedImageReferencesFromWorkspaceContext(
        threadId: string | undefined,
        resolution: WorkspaceContextResolution,
        generationRun?: MediaGenerationRunMeta,
    ): void {
        if (!threadId) return
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        if (!placement) return

        const forcedChipNodeIds = resolution.selections
            .filter((selection: WorkspaceContextSelection) => selection.role === 'forced-chip')
            .map((selection: WorkspaceContextSelection) => selection.nodeId)
        const referenceNodeIds = getExistingMediaNodeIds([
            ...forcedChipNodeIds,
            ...resolution.narrowedMediaNodeIds,
            ...resolution.selections.map((selection: WorkspaceContextSelection) => selection.nodeId),
        ])
        if (referenceNodeIds.length === 0) return

        setPendingGeneratedMediaPlacement(threadId, generationRun, {
            ...placement,
            placementAnchorNodeId: placement.placementAnchorNodeId ?? referenceNodeIds[0],
            referenceNodeIds,
        })
        setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)
    }

    function handleWorkspaceContextResolution(threadId: string | undefined, resolution: WorkspaceContextResolution, generationRun?: MediaGenerationRunMeta): void {
        patchWorkspaceContextImprovedDescriptors(resolution.improvedDescriptors)
        updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution)
    }

    // Patch a single media node's descriptor and re-commit so the canvas chrome
    // (analyzing indicator, info panel) re-renders. No-op if the node is gone.
    function patchMediaNodeDescriptor(nodeId: string, descriptor: MediaDescriptor): void {
        if (!currentCanvasState) return
        if (!currentCanvasState.nodes.some((node: CanvasNode) => node.nodeId === nodeId)) return
        const nodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== nodeId || (node.type !== 'image' && node.type !== 'video')) return node
            return { ...node, descriptor }
        })
        commitCanvasState({ ...currentCanvasState, nodes })
    }

    // Caption a freshly uploaded media object. `stillFileId` is the image's own
    // file or a video's poster — never the MP4. Best-effort: on any failure the
    // descriptor is marked 'failed' so the analyzing indicator resolves.
    async function analyzeUploadedMedia(nodeId: string, stillFileId: string): Promise<void> {
        const failed = (): MediaDescriptor => ({ ...buildAnalyzingDescriptor(), status: 'failed', updatedAt: Date.now() })
        const aiModel = pickDescriptorModel()
        if (!aiModel || !stillFileId) {
            patchMediaNodeDescriptor(nodeId, failed())
            return
        }
        try {
            const result = await describeMedia({ workspaceId, fileId: stillFileId, aiModel })
            if (result.error || !result.summary) {
                patchMediaNodeDescriptor(nodeId, failed())
                return
            }
            patchMediaNodeDescriptor(nodeId, {
                status: 'ready',
                summary: result.summary,
                entityTags: result.entityTags ?? [],
                styleTags: result.styleTags ?? [],
                source: 'analysis',
                version: MEDIA_DESCRIPTOR_VERSION,
                updatedAt: Date.now(),
            })
        } catch {
            patchMediaNodeDescriptor(nodeId, failed())
        }
    }

    // Patch a single document/thread node's descriptor and re-commit so the canvas
    // chrome (analyzing indicator, info panel) re-renders. No-op if the node is gone
    // or is not a text node.
    function patchTextNodeDescriptor(nodeId: string, descriptor: ContentDescriptor): void {
        if (!currentCanvasState) return
        if (!currentCanvasState.nodes.some((node: CanvasNode) => node.nodeId === nodeId)) return
        const nodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== nodeId || (node.type !== 'document' && node.type !== 'aiChatThread')) return node
            return { ...node, descriptor }
        })
        commitCanvasState({ ...currentCanvasState, nodes })
    }

    // Summarize a document/thread node from its plain text (no pixels). Mirrors
    // analyzeUploadedMedia's analyzing → ready/failed flow. Best-effort: any failure
    // marks the descriptor 'failed' so the analyzing indicator resolves.
    async function analyzeTextNode(nodeId: string, text: string, title?: string): Promise<void> {
        const failed = (): ContentDescriptor => ({ ...buildAnalyzingDescriptor(), status: 'failed', updatedAt: Date.now() })
        const aiModel = pickDescriptorModel()
        if (!aiModel) {
            patchTextNodeDescriptor(nodeId, failed())
            return
        }
        patchTextNodeDescriptor(nodeId, buildAnalyzingDescriptor())
        try {
            const result = await describeText({ workspaceId, text, title, aiModel })
            if (result.error || !result.summary) {
                patchTextNodeDescriptor(nodeId, failed())
                return
            }
            patchTextNodeDescriptor(nodeId, {
                status: 'ready',
                summary: result.summary,
                entityTags: result.entityTags ?? [],
                styleTags: result.styleTags ?? [],
                source: 'analysis',
                version: MEDIA_DESCRIPTOR_VERSION,
                updatedAt: Date.now(),
            })
        } catch {
            patchTextNodeDescriptor(nodeId, failed())
        }
    }

    // Debounce a document/thread descriptor refresh. Called on node create and on
    // each editor change; flattens the node's ProseMirror content to plain text and,
    // once there is enough to summarize, regenerates the descriptor after edits
    // settle. Too-thin content is skipped (no model call, no 'failed').
    function scheduleTextNodeDescriptor(nodeId: string, content: unknown, title?: string): void {
        const existing = textDescriptorTimers.get(nodeId)
        if (existing) clearTimeout(existing)
        const { text } = extractContentFromProseMirror((content ?? '') as string | object)
        if (text.trim().length < settings.contentDescriptor.minTextLength) return
        const timer = setTimeout(() => {
            textDescriptorTimers.delete(nodeId)
            void analyzeTextNode(nodeId, text, title)
        }, settings.contentDescriptor.editDebounceMs)
        textDescriptorTimers.set(nodeId, timer)
    }

    function buildImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {
        if (!imageUrl) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        if (imageUrl.startsWith('data:')) return imageUrl
        if (imageUrl.startsWith('/api/')) return `${apiBaseUrl}${imageUrl}${token ? `?token=${token}` : ''}`
        if (imageUrl.startsWith('http') && imageUrl.includes('/api/images/')) return `${imageUrl}${token ? `?token=${token}` : ''}`
        if (imageUrl.startsWith('http')) return imageUrl
        return `data:image/png;base64,${imageUrl}`
    }

    function showImageErrorPlaceholder(nodeEl: HTMLElement): void {
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

    // Sibling of appendImageNodeToDOM for VideoCanvasNode placeholders. The
    // PIXI media layer's videoNodeHandler picks the new node up on the next
    // syncPixiMediaLayer() call and creates the corresponding sprite under the
    // videoLayer Container.
    function appendVideoNodeToDOM(videoNode: VideoCanvasNode): void {
        const nodeEl = createVideoNode(videoNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(videoNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
    }

    function appendBranchOriginNodeToDOM(branchOriginNode: BranchOriginCanvasNode): void {
        if (viewportEl.querySelector(`[data-node-id="${branchOriginNode.nodeId}"]`)) return
        const nodeEl = createBranchOriginNode(branchOriginNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(branchOriginNode.nodeId, nodeEl as HTMLDivElement)
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
            let sourceThreadNode: ChatRootNode | undefined
            for (const n of existingNodes) {
                if (n.type === 'aiChatThread') {
                    sourceThreadNode = n
                    break
                }
            }

            const width = getGeneratedImageInsertionSize()
            const height = width
            const position = sourceThreadNode
                ? getNextChatRootOutputPosition(sourceThreadNode, height, existingNodes)
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
                ...(currentCanvasState ?? {}),
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: newEdges,
                nodes: [...existingNodes, imageNode]
            }

            onCanvasStateChange?.(newCanvasState)
        },

        onImageBranchResolvedToCanvas: ({ threadId, resolution, generationRun }) => {
            const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
            if (!placement) return

            const sourceNodeId = getGeneratedMediaLineageSourceNodeIdFromResolution(resolution)
            const referenceNodeIds = getExistingMediaNodeIds(resolution.referenceImageNodeIds)
            const placementAnchorNodeId = sourceNodeId
                ?? placement.placementAnchorNodeId
                ?? referenceNodeIds[0]
            setPendingGeneratedMediaPlacement(threadId, generationRun, {
                ...placement,
                placementAnchorNodeId,
                referenceNodeIds,
                ...(sourceNodeId ? { sourceNodeId } : {}),
                branchId: resolution.branchId ?? placement.branchId,
                imageBranchResolution: resolution,
            })
            setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)

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

        onWorkspaceContextResolvedToCanvas: ({ threadId, resolution, generationRun }) => {
            handleWorkspaceContextResolution(threadId, resolution, generationRun)
        },

        onImageBranchResolutionErrorToCanvas: ({ threadId, generationRun }) => {
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
        },

        onImageGenerationTraceToCanvas: ({ threadId, generationRun }) => {
            registerGeneratedMediaRun(threadId, generationRun)
        },

        onImageErrorToCanvas: ({ threadId, generationRun }) => {
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const existing = partialImageTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }

            partialImageTracker.delete(runKey)
            selectedNodeIds.delete(existing.nodeId)
            syncPixiGeneratingImageNodes()

            // Show error placeholder on the node so the user sees what failed,
            // then remove it from the canvas state (and DOM) after a short delay.
            const nodeEl = viewportEl?.querySelector(`[data-node-id="${existing.nodeId}"]`) as HTMLElement | null
            if (nodeEl) showImageErrorPlaceholder(nodeEl)

            const errorNodeId = existing.nodeId
            setTimeout(() => {
                if (!currentCanvasState) return
                const nextState: CanvasState = {
                    ...currentCanvasState,
                    viewport: currentCanvasState.viewport,
                    nodes: currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== errorNodeId),
                    edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                        edge.sourceNodeId !== errorNodeId && edge.targetNodeId !== errorNodeId
                    ),
                }
                commitCanvasStatePreservingEditors(nextState)
                nodeEl?.remove()
            }, 4000)
            finishGeneratedMediaRun(threadId, generationRun)
        },

        onImagePartialToCanvas: (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, generationRun } = data
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            const existing = partialImageTracker.get(runKey)

            if (existing) {
                if (imageUrl && currentCanvasState) {
                    clearGeneratingReferencesOnFirstPixels(placementKey, generationRun)
                    const imageSrc = buildImageSrc(imageUrl, '', false)
                    const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
                        if (node.nodeId !== existing.nodeId) return node
                        const imageNode = node as ImageCanvasNode
                        return {
                            ...imageNode,
                            fileId: fileId || imageNode.fileId,
                            workspaceId: imgWorkspaceId || imageNode.workspaceId,
                            src: imageSrc,
                        } satisfies ImageCanvasNode
                    })

                    commitCanvasStatePreservingEditors({ ...currentCanvasState, nodes: updatedNodes })
                }

                partialImageTracker.set(runKey, { ...existing, fileId: fileId || existing.fileId })
                return
            }

            const imageWidth = getGeneratedImageInsertionSize()
            const imageHeight = imageWidth
            const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, imageHeight)
            const edgeSourceNode = getGeneratedMediaEdgeSourceNode(threadId, generationRun) ?? branchOriginNode
            const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

            const nodeId = `node-${fileId || uuidv4()}`
            partialImageTracker.set(runKey, { nodeId, fileId: fileId || '', placementKey, ...(edgeSourceNode ? { sourceNodeId: edgeSourceNode.nodeId } : {}) })

            const imageSrc = buildImageSrc(imageUrl, '', false)

            const position = getGeneratedMediaInsertionPosition(threadId, imageHeight, generationRun)
                ?? getCenteredInsertionPosition({ width: imageWidth, height: imageHeight })

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
                    aiModel: (generationRun?.reasoningModelId ?? '') as any,
                    revisedPrompt: promptText,
                    responseMessageId: '',
                    ...getPendingGeneratedImageLineage(threadId, generationRun),
                }
            }

            const existingNodes = addBranchOriginNodeIfMissing(currentCanvasState?.nodes || [], branchOriginNode)
            const existingEdges = currentCanvasState?.edges || []

            const newEdges = edgeSourceNode
                ? [
                    ...existingEdges,
                    createGeneratedImageEdge(edgeSourceNode, nodeId),
                ]
                : existingEdges

            const nodesWithImage: CanvasNode[] = [...existingNodes, imageNode]
            const rebalancedNodes = rebalanceGeneratedMediaTrees(nodesWithImage, newEdges)

            const newCanvasState: CanvasState = {
                ...(currentCanvasState ?? {}),
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                nodes: rebalancedNodes,
                edges: newEdges,
            }
            commitCanvasStatePreservingEditors(newCanvasState)
            if (branchOriginNode) {
                const placedBranchOriginNode =
                    (rebalancedNodes.find((n: CanvasNode) => n.nodeId === branchOriginNode.nodeId) as BranchOriginCanvasNode | undefined)
                    ?? branchOriginNode
                appendBranchOriginNodeToDOM(placedBranchOriginNode)
            }
            const placedImageNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === nodeId) as ImageCanvasNode) ?? imageNode
            appendImageNodeToDOM(placedImageNode)
            if (imageUrl) clearGeneratingReferencesOnFirstPixels(placementKey, generationRun)
        },

        onImageCompleteToCanvas: (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, responseId, revisedPrompt, aiModel, imageModelProvider, responseMessageId, generationRun } = data
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            const partial = partialImageTracker.get(runKey)

            const imageSrc = buildImageSrc(imageUrl, '', false)

            if (partial) {
                const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''
                // Upgrade existing partial canvas node to complete
                const nodes = (currentCanvasState?.nodes || []).map((n: CanvasNode) => {
                    if (n.nodeId !== partial.nodeId) return n
                    const imgNode = n as ImageCanvasNode
                    const generatedBy: ImageCanvasNode['generatedBy'] = {
                        aiChatThreadId: threadId,
                        responseId,
                        aiModel: (generationRun?.reasoningModelId ?? aiModel) as any,
                        imageModelProvider: imageModelProvider || '',
                        revisedPrompt: revisedPrompt || imgNode.generatedBy?.revisedPrompt || promptText,
                        responseMessageId: responseMessageId || '',
                        ...getPendingGeneratedImageLineage(threadId, generationRun, imgNode.generatedBy),
                    }
                    return {
                        ...imgNode,
                        fileId: fileId || imgNode.fileId,
                        workspaceId: imgWorkspaceId || imgNode.workspaceId,
                        src: imageSrc,
                        generatedBy,
                        descriptor: buildDescriptorFromGeneratedBy(generatedBy) ?? imgNode.descriptor,
                    } satisfies ImageCanvasNode
                })

                const edges = (currentCanvasState?.edges || []).map((e: WorkspaceEdge) => {
                    if (e.targetNodeId !== partial.nodeId) return e
                    const sourceNode = (currentCanvasState?.nodes || []).find((node: CanvasNode) => node.nodeId === e.sourceNodeId)
                    if (sourceNode?.type === 'aiChatThread') {
                        return { ...e, sourceMessageId: responseMessageId || undefined }
                    }
                    const { sourceMessageId: _sourceMessageId, ...edgeWithoutSourceMessageId } = e
                    return edgeWithoutSourceMessageId
                })

                partialImageTracker.delete(runKey)
                syncPixiGeneratingImageNodes()

                // PIXI removes the progress border when the tracker is cleared and this state commits.
                // Re-tidy the lineage tree the finalized node belongs to and
                // rigid-separate it from neighbors via the unchanged resolver.
                const resolvedNodes = rebalanceGeneratedMediaTrees(nodes, edges)

                commitCanvasState({
                    ...(currentCanvasState ?? {}),
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges,
                })
                finishGeneratedMediaRun(threadId, generationRun)

            } else {
                // No partial existed — IMAGE_COMPLETE without prior IMAGE_PARTIAL.
                // Guard against duplicates: skip if this fileId is already on canvas
                if (fileId && currentCanvasState?.nodes.some((n: CanvasNode) => n.type === 'image' && (n as ImageCanvasNode).fileId === fileId)) {
                    finishGeneratedMediaRun(threadId, generationRun)
                    return
                }

                const imageWidth = getGeneratedImageInsertionSize()
                const imageHeight = imageWidth
                const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, imageHeight)
                const edgeSourceNode = getGeneratedMediaEdgeSourceNode(threadId, generationRun) ?? branchOriginNode
                const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

                const nodeId = `node-${fileId || uuidv4()}`

                const position = getGeneratedMediaInsertionPosition(threadId, imageHeight, generationRun)
                    ?? getCenteredInsertionPosition({ width: imageWidth, height: imageHeight })

                const generatedBy: ImageCanvasNode['generatedBy'] = {
                    aiChatThreadId: threadId,
                    responseId,
                    aiModel: (generationRun?.reasoningModelId ?? aiModel) as any,
                    imageModelProvider: imageModelProvider || '',
                    revisedPrompt: revisedPrompt || promptText,
                    responseMessageId: responseMessageId || '',
                    ...getPendingGeneratedImageLineage(threadId, generationRun),
                }
                const imageNode: ImageCanvasNode = {
                    nodeId,
                    type: 'image',
                    fileId: fileId || '',
                    workspaceId: imgWorkspaceId || workspaceId,
                    src: imageSrc,
                    aspectRatio: 1,
                    position,
                    dimensions: { width: imageWidth, height: imageHeight },
                    generatedBy,
                    descriptor: buildDescriptorFromGeneratedBy(generatedBy),
                }

                const existingNodes = addBranchOriginNodeIfMissing(currentCanvasState?.nodes || [], branchOriginNode)
                const existingEdges = currentCanvasState?.edges || []

                const newEdges = edgeSourceNode
                    ? [
                        ...existingEdges,
                        createGeneratedImageEdge(edgeSourceNode, nodeId, responseMessageId || undefined),
                    ]
                    : existingEdges

                const allNodes: CanvasNode[] = [...existingNodes, imageNode]

                const resolvedNodes = rebalanceGeneratedMediaTrees(allNodes, newEdges)
                const resolvedImageNode = (resolvedNodes.find((node: CanvasNode) => node.nodeId === nodeId) as ImageCanvasNode | undefined) ?? imageNode

                currentCanvasState = {
                    ...(currentCanvasState ?? {}),
                    viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                    nodes: resolvedNodes,
                    edges: newEdges,
                }
                if (branchOriginNode) {
                    const placedBranchOriginNode =
                        (resolvedNodes.find((node: CanvasNode) => node.nodeId === branchOriginNode.nodeId) as BranchOriginCanvasNode | undefined)
                        ?? branchOriginNode
                    appendBranchOriginNodeToDOM(placedBranchOriginNode)
                }
                appendImageNodeToDOM(resolvedImageNode)

                commitCanvasStatePreservingEditors(currentCanvasState)
                finishGeneratedMediaRun(threadId, generationRun)
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
                    aiModel: 'openai:gpt-4o', // Default to OpenAI for image editing
                    title: 'Edit Image',
                    owner: { type: 'standalone' },
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

                    const threadDimensions = { ...settings.aiChatThread.defaultDimensions }
                    const fallbackPosition = getCenteredInsertionPosition(threadDimensions)
                    const sourceImageRect = sourceImageNode ? getNodeWorldRect(sourceImageNode) : null
                    const threadPosition = sourceImageRect
                        ? { x: sourceImageRect.x + sourceImageRect.width + settings.aiChatThread.adjacentNodeGap, y: sourceImageRect.y }
                        : fallbackPosition

                    const threadNode: AiChatThreadCanvasNode = {
                        nodeId: `node-${thread.threadId}`,
                        type: 'aiChatThread',
                        referenceId: thread.threadId,
                        position: threadPosition,
                        dimensions: threadDimensions,
                    }

                    const newCanvasState: CanvasState = {
                        ...(currentCanvasState ?? {}),
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
                    currentCanvasState = newCanvasState
                    aiChatPanelState = { ...aiChatPanelState, isOpen: true }
                    activeAiChatThreadId = thread.threadId
                    activeAiChatRootNodeId = threadNode.nodeId
                    ensureAiChatSidebarThreadTab(thread.threadId)
                    activeAiChatSidebarTabId = `thread:${thread.threadId}`
                    persistAiChatSidebarState()
                    requestAnimationFrame(() => {
                        renderActiveAiChatPanel(threadNode, thread)
                    })

                }
            } catch (error) {
                console.error('Failed to create edit thread:', error)
            }
        }
    })

    // VideoCanvasNode lifecycle callbacks, fired from the AI chat thread plugin
    // when VIDEO_* segments arrive. Mirrors setAiGeneratedImageCallbacks above
    // but skips the in-chat node insertion path that images use (the chat
    // schema registers aiGeneratedVideo but does not yet auto-insert it; the
    // canvas-side placeholder is the user-visible representation in Phase 5 v1).
    // The pendingGeneratedImagePlacements Map is shared with images because the
    // resolveImageBranch snapshot serves both media types.
    setAiGeneratedVideoCallbacks({
        onVideoPendingToCanvas: (data) => {
            const { threadId, generationRun } = data
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            if (videoGenerationTracker.has(runKey)) return

            // Placeholder is square until the attached <video> reports the MP4's
            // intrinsic dimensions; handleVideoIntrinsicSize re-fits the node,
            // then re-tidies the generated-media tree around the final frame.
            const placeholderWidth = getGeneratedImageInsertionSize()
            const placeholderHeight = placeholderWidth
            const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, placeholderHeight)
            const edgeSourceNode = getGeneratedMediaEdgeSourceNode(threadId, generationRun) ?? branchOriginNode
            const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

            const nodeId = `node-${uuidv4()}`
            videoGenerationTracker.set(runKey, { nodeId, fileId: '', placementKey, ...(edgeSourceNode ? { sourceNodeId: edgeSourceNode.nodeId } : {}) })

            const position = getGeneratedMediaInsertionPosition(threadId, placeholderHeight, generationRun)
                ?? getCenteredInsertionPosition({ width: placeholderWidth, height: placeholderHeight })

            const videoNode: VideoCanvasNode = {
                nodeId,
                type: 'video',
                fileId: '',
                posterFileId: '',
                workspaceId,
                src: '',
                posterSrc: '',
                aspectRatio: 1,
                durationSeconds: 0,
                hasAudio: false,
                position,
                dimensions: { width: placeholderWidth, height: placeholderHeight },
                generatedBy: {
                    aiChatThreadId: threadId,
                    responseId: '',
                    videoModel: (generationRun?.mediaModelId ?? '') as any,
                    revisedPrompt: promptText,
                    ...getPendingGeneratedImageLineage(threadId, generationRun),
                },
            }

            const existingNodes = addBranchOriginNodeIfMissing(currentCanvasState?.nodes || [], branchOriginNode)
            const existingEdges = currentCanvasState?.edges || []
            const newEdges = edgeSourceNode
                ? [
                    ...existingEdges,
                    createGeneratedImageEdge(edgeSourceNode, nodeId),
                ]
                : existingEdges

            const nodesWithVideo: CanvasNode[] = [...existingNodes, videoNode]
            const rebalancedNodes = rebalanceGeneratedMediaTrees(nodesWithVideo, newEdges)

            const newCanvasState: CanvasState = {
                ...(currentCanvasState ?? {}),
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                nodes: rebalancedNodes,
                edges: newEdges,
            }
            commitCanvasStatePreservingEditors(newCanvasState)
            if (branchOriginNode) {
                const placedBranchOriginNode =
                    (rebalancedNodes.find((n: CanvasNode) => n.nodeId === branchOriginNode.nodeId) as BranchOriginCanvasNode | undefined)
                    ?? branchOriginNode
                appendBranchOriginNodeToDOM(placedBranchOriginNode)
            }
            const placedVideoNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === nodeId) as VideoCanvasNode) ?? videoNode
            appendVideoNodeToDOM(placedVideoNode)
        },

        onVideoGeneratingToCanvas: (_data) => {
            // VEO keepalive heartbeat. The PIXI traveling outline is already
            // running on the placeholder via pixiMediaLayer's generating-image
            // tracker, so no canvas state mutation is required here. Phase 6
            // may add a "still generating" pulse animation.
        },

        onVideoGenerationTraceToCanvas: ({ threadId, generationRun }) => {
            registerGeneratedMediaRun(threadId, generationRun)
        },

        onVideoCompleteToCanvas: (data) => {
            const {
                threadId,
                videoUrl,
                fileId,
                workspaceId: videoWorkspaceId,
                posterUrl,
                posterFileId,
                frameFileId,
                durationSeconds,
                aspectRatio,
                hasAudio,
                responseId,
                revisedPrompt,
                videoModel,
                videoModelProvider,
                responseMessageId,
                generationRun,
            } = data
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            const existing = videoGenerationTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }

            const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''
            const lineage = getPendingGeneratedImageLineage(threadId, generationRun)

            const nodes = currentCanvasState.nodes.map((n: CanvasNode) => {
                if (n.nodeId !== existing.nodeId || n.type !== 'video') return n
                const videoNode = n as VideoCanvasNode
                const fittedAspect = Number.isFinite(aspectRatio) && aspectRatio > 0
                    ? aspectRatio
                    : videoNode.aspectRatio
                const generatedBy: VideoCanvasNode['generatedBy'] = {
                    aiChatThreadId: threadId,
                    responseId,
                    videoModel: (generationRun?.mediaModelId ?? videoModel) as any,
                    videoModelProvider: videoModelProvider || '',
                    revisedPrompt: revisedPrompt || videoNode.generatedBy?.revisedPrompt || promptText,
                    responseMessageId: responseMessageId || '',
                    durationSeconds: durationSeconds || 0,
                    hasAudio: hasAudio ?? true,
                    ...lineage,
                }
                return {
                    ...videoNode,
                    fileId: fileId || videoNode.fileId,
                    posterFileId: posterFileId || videoNode.posterFileId,
                    frameFileId: frameFileId || videoNode.frameFileId,
                    workspaceId: videoWorkspaceId || videoNode.workspaceId,
                    src: videoUrl || videoNode.src,
                    posterSrc: posterUrl || videoNode.posterSrc,
                    aspectRatio: fittedAspect,
                    durationSeconds: durationSeconds || videoNode.durationSeconds,
                    hasAudio: hasAudio ?? videoNode.hasAudio,
                    generatedBy,
                    descriptor: buildDescriptorFromGeneratedBy(generatedBy) ?? videoNode.descriptor,
                } satisfies VideoCanvasNode
            })

            // Clearing the tracker removes the PIXI traveling outline (the
            // outline lifecycle is tracker-driven, same mechanism as images).
            videoGenerationTracker.delete(runKey)
            syncPixiGeneratingImageNodes()

            // Backstop against overlap, mirroring onImageCompleteToCanvas. Re-tidy
            // the lineage tree and rigid-separate it from neighbors; the initial
            // placement already accounts for prior media, so this is a no-op in the
            // common case and only nudges genuinely colliding nodes/trees.
            const resolvedNodes = rebalanceGeneratedMediaTrees(nodes, currentCanvasState.edges)

            commitCanvasState({
                ...currentCanvasState,
                nodes: resolvedNodes,
                edges: currentCanvasState.edges,
            })
            finishGeneratedMediaRun(threadId, generationRun)
        },

        onVideoErrorToCanvas: (data) => {
            const { threadId, generationRun } = data
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const existing = videoGenerationTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }

            videoGenerationTracker.delete(runKey)
            syncPixiGeneratingImageNodes()

            const errorNodeId = existing.nodeId
            setTimeout(() => {
                if (!currentCanvasState) return
                const nextState: CanvasState = {
                    ...currentCanvasState,
                    nodes: currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== errorNodeId),
                    edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                        edge.sourceNodeId !== errorNodeId && edge.targetNodeId !== errorNodeId
                    ),
                }
                commitCanvasStatePreservingEditors(nextState)
                const nodeEl = viewportEl?.querySelector(`[data-node-id="${errorNodeId}"]`) as HTMLElement | null
                nodeEl?.remove()
            }, 3000)
            finishGeneratedMediaRun(threadId, generationRun)
        },
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
            const panelRail = activeAiChatPanelEl.querySelector<HTMLElement>('.workspace-ai-chat-floating-panel-rail')
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
                if (settings.imageNode.useZoomCompensatedResizeHandleScaling) {
                    pendingHandleZoom = vp.zoom
                }
                if (settings.connector.useZoomCompensatedScaling) {
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
        extraDataAttrs?: Record<string, string>,
        interactionOptions: { renderResizeHandles?: boolean; onClick?: () => void } = {}
    ): { nodeEl: HTMLElement; dragOverlay: HTMLElement } {
        const nodeWorldPosition = getNodeWorldPosition(node)
        const nodeElStyle = {
            position: 'absolute' as const,
            left: `${nodeWorldPosition.x}px`,
            top: `${nodeWorldPosition.y}px`,
            width: `${node.dimensions.width}px`,
            height: `${node.dimensions.height}px`,
            zIndex: String(nodeLayerManager.currentTopIndex()),
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
                toggleNodeSelection(node.nodeId)
                return
            }

            selectNode(node.nodeId)
            interactionOptions.onClick?.()
        })

        if (interactionOptions.renderResizeHandles !== false) {
            for (const corner of RESIZE_CORNERS) {
                // Legacy embedded thread nodes keep bottom handles on the floating input.
                if (node.type === 'aiChatThread' && corner.startsWith('bottom')) continue
                nodeEl.appendChild(createResizeHandle(node.nodeId, corner))
            }
        }

        const dragOverlay = html`<div className="node-drag-overlay nopan" onmousedown=${(e: MouseEvent) => handleDragStart(e, node.nodeId)}></div>` as HTMLDivElement
        nodeEl.appendChild(dragOverlay)

        return { nodeEl, dragOverlay }
    }

    function commitCanvasState(nextState: CanvasState) {
        // Track image changes and delete orphaned images from storage
        canvasImageLifecycle.trackCanvasState(nextState)
        // Same lifecycle treatment for VideoCanvasNode entries: when a node
        // leaves canvasState, the tracker fires the workspace.video.delete
        // NATS subject to remove both the MP4 and its companion poster image.
        canvasVideoLifecycle.trackCanvasState(nextState)
        currentCanvasState = nextState
        pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(nextState)
        onCanvasStateChange?.(nextState)

        syncCanvasNodeDomGeometry(nextState.nodes)
        connectionManager?.syncEdges(nextState.edges)
        connectionManager?.syncNodes(getNodesForConnectionManager(nextState.nodes))
        scheduleEdgesRender()
        syncPixiMediaLayer(nextState)
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
        const { size: sizePx, offset: offsetPx } = settings.imageNode.useZoomCompensatedResizeHandleScaling
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
                if (draggedNodeId !== resolvedNodeId) {
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
                // No drag occurred — this was a click. Collision logic can
                // legitimately move nearby nodes and must only run after movement.
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

            let updatedNodes = currentCanvasState.nodes
            updatedNodes = updatedNodes.map((node: CanvasNode) => {
                const finalWorldPosition = finalDraggedPositions.get(node.nodeId)
                if (!finalWorldPosition) return node

                if (node.parentId && finalDraggedPositions.has(node.parentId)) {
                    // Parent and child moved together as one selected group. The
                    // live DOM/PIXI positions are world coordinates, but persisted
                    // child positions remain parent-relative. Keep the existing
                    // relative position so the parent's movement carries the child
                    // exactly once after the state commit.
                    return node
                }

                const releasedNode: CanvasNode = { ...node, position: finalWorldPosition }
                delete releasedNode.parentId
                delete releasedNode.expandParent
                delete releasedNode.extent
                return releasedNode
            })

            updatedNodes = expandParentContainersToFitChildren(updatedNodes)

            if (dragPlan.allowCollisionResolution) {
                const collisionExclusions = new Set<string>()

                for (const child of updatedNodes) {
                    if (child.parentId) {
                        collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                    }
                }

                const collisionPlan = createCollisionPlan(updatedNodes, dragPlan.isParentContainerDrag)

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

                    updatedNodes = expandParentContainersToFitChildren(updatedNodes)
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

        // PIXI owns image pixels, so resize behavior uses the persisted
        // canvas-node aspect ratio instead of a rendered surface.
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
            updateGeneratedImageChromeLiveTransform(nodeId, liveResizePosition, liveResizeDimensions)
            pixiMediaLayer?.setSelectedImageNodes(selectedNodeIds)
            pixiMediaLayer?.setSelectionOverlayBounds(getSelectionOverlayBounds(), { fill: shouldFillSelectionOverlayBounds() })

            // If resizing a parented child, visibly grow the parent in real-time.
            // `nodeEl.style.left/top` is in world coordinates; convert to parent-
            // relative before computing the needed parent dimensions.
            if (node?.parentId) {
                const parentEl = viewportEl?.querySelector(`[data-node-id="${node.parentId}"]`) as HTMLElement | null
                if (parentEl) {
                    const worldLeft = parseFloat(nodeEl.style.left) || 0
                    const worldTop = parseFloat(nodeEl.style.top) || 0
                    const parentWorldLeft = parseFloat(parentEl.style.left) || 0
                    const parentWorldTop = parseFloat(parentEl.style.top) || 0
                    const relativeLeft = worldLeft - parentWorldLeft
                    const relativeTop = worldTop - parentWorldTop
                    const neededWidth = relativeLeft + newWidth + 48
                    const neededHeight = relativeTop + newHeight + 48
                    const currentParentWidth = parseFloat(parentEl.style.width) || 200
                    const currentParentHeight = parseFloat(parentEl.style.height) || 120
                    if (neededWidth > currentParentWidth) applyStyle(parentEl, { width: `${neededWidth}px` })
                    if (neededHeight > currentParentHeight) applyStyle(parentEl, { height: `${neededHeight}px` })
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
            // Parented children persist `position` as parent-relative, so convert
            // back before committing.
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

            updatedNodes = expandParentContainersToFitChildren(updatedNodes)

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
                        scheduleTextNodeDescriptor(node.nodeId, value, doc.title)
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

    function createImageNode(node: ImageCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-image-node',
            { fileId: node.fileId }
        )
        dragOverlay.className = 'image-drag-overlay nopan'

        return nodeEl
    }

    // DOM shell for VideoCanvasNode. Mirrors createImageNode: the shell owns
    // fallback interaction chrome, while completed videos get a visible DOM
    // <video> surface in the transformed chrome layer.
    // Double-click toggles inline playback through videoNodeHandler.toggle().
    //
    // There is NO DOM bounce-dot spinner here; the PIXI traveling outline
    // (shared with image generation via pixiMediaLayer.setGeneratingImageNodes)
    // is the sole canvas indicator while a video is generating — mirroring the
    // image-side cleanup that removed the centered dot-bounce DOM element from
    // generated canvas image nodes.
    function createVideoNode(node: VideoCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-video-node',
            { fileId: node.fileId }
        )
        dragOverlay.className = 'video-drag-overlay nopan'

        // Fallback reveal while the pointer is over the node shell. Completed
        // videos normally use the chrome-layer hit target above the visible video.
        dragOverlay.addEventListener('mouseenter', () => showVideoControls(node.nodeId))
        dragOverlay.addEventListener('mouseleave', () => hideVideoControls(node.nodeId))

        const togglePlayback = (event: Event) => {
            event.stopPropagation()
            if (videoNodeHandler?.hasEntry(node.nodeId)) {
                videoNodeHandler.toggle(node.nodeId).catch(() => {})
            }
        }
        dragOverlay.addEventListener('dblclick', togglePlayback)

        return nodeEl
    }

    function createBranchOriginNode(node: BranchOriginCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-branch-origin-node',
            {
                branchId: node.branchId,
                generationRequestId: node.generationRequestId,
            },
            { renderResizeHandles: false }
        )
        dragOverlay.className = 'branch-origin-drag-overlay nopan'

        // TODO temporary branch-start marker for fresh multi-model generations.
        // Replace this robot-face placeholder when final branch-origin UX is designed.
        const icon = html`<div className="workspace-branch-origin-icon" innerHTML=${'&#129302;'}></div>` as HTMLDivElement
        nodeEl.insertBefore(icon, dragOverlay)

        return nodeEl
    }

    function handlePanePointerDown(event: PointerEvent): void {
        if (event.button !== 0 || !event.isPrimary) return
        if (!isCanvasBackgroundTarget(event.target)) return
        if (!currentCanvasState) return

        const start = getCanvasPointFromClient(event.clientX, event.clientY)
        const hitNodeId = getForegroundNodeHit(start)?.nodeId ?? null
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
        paneEl.style.cursor = getForegroundNodeHit(point) ? '' : ''
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
        const nodeHit = getForegroundNodeHit(start)
        if (nodeHit) {
            handleDragStart(event, nodeHit.nodeId, { suppressPaneClick: true })
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
        for (const node of currentCanvasState.nodes) {
            let nodeEl: HTMLElement

            if (node.type === 'document') {
                const docNode = node as DocumentCanvasNode
                const doc = documentMap.get(docNode.referenceId)
                nodeEl = createDocumentNode(docNode, doc)
            } else if (node.type === 'image') {
                nodeEl = createImageNode(node as ImageCanvasNode)
            } else if (node.type === 'video') {
                nodeEl = createVideoNode(node as VideoCanvasNode)
            } else if (node.type === 'branchOrigin') {
                nodeEl = createBranchOriginNode(node as BranchOriginCanvasNode)
            } else {
                // Inert legacy guard: old workspaces may still contain
                // `type: 'contextRegion'` nodes. Phase 1 intentionally does not
                // migrate or render them.
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
        if (!activeAiChatPanelEl || activeAiChatPanelThreadId !== activeAiChatThreadId) return
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

    function ensureMediaLibraryPanel() {
        if (!mediaLibraryPanelInstance) {
            mediaLibraryPanelInstance = createMediaLibraryPanel({
                workspaceId,
                paneEl,
                onUseFeature: insertFeatureIntoActivePrompt,
                onInsertImage: async (item: MediaLibraryImageMeta) => {
                    try {
                        const materialized = await mediaLibraryService.materializeImage({
                            workspaceId,
                            itemId: item.itemId,
                        })
                        if (!materialized.fileId || !materialized.url) return false
                        const width = settings.imageNode.defaultInsertionWidth
                        const imageNodeId = `node-${materialized.fileId}`
                        const imageNode: Omit<ImageCanvasNode, 'position'> = {
                            nodeId: imageNodeId,
                            type: 'image',
                            fileId: materialized.fileId,
                            workspaceId,
                            src: materialized.url,
                            aspectRatio: item.aspectRatio,
                            dimensions: { width, height: width / item.aspectRatio },
                            descriptor: buildAnalyzingDescriptor(),
                        }
                        insertNodeAtViewportCenterInternal(imageNode)
                        // Caption the upload in the background; updates the node's
                        // descriptor (analyzing → ready/failed) when it resolves.
                        void analyzeUploadedMedia(imageNodeId, materialized.fileId)
                        return true
                    } catch (error) {
                        console.error('Failed to add Media Library image to canvas:', error)
                        return false
                    }
                },
                onInsertVideo: async (item: MediaLibraryVideoMeta) => {
                    try {
                        const materialized = await mediaLibraryService.materializeVideo({
                            workspaceId,
                            itemId: item.itemId,
                        })
                        if (!materialized.video?.fileId || !materialized.video?.url) return false
                        // Reuse the image default insertion width — the video node
                        // resizes to its intrinsic aspect on first frame.
                        const width = settings.imageNode.defaultInsertionWidth
                        const aspectRatio = item.aspectRatio || 1
                        const videoNodeId = `node-${materialized.video.fileId}`
                        const posterFileId = materialized.poster?.fileId ?? ''
                        const videoNode: Omit<VideoCanvasNode, 'position'> = {
                            nodeId: videoNodeId,
                            type: 'video',
                            fileId: materialized.video.fileId,
                            posterFileId,
                            workspaceId,
                            src: materialized.video.url,
                            posterSrc: materialized.poster?.url ?? '',
                            aspectRatio,
                            durationSeconds: item.durationSeconds,
                            hasAudio: item.hasAudio,
                            dimensions: { width, height: width / aspectRatio },
                            descriptor: buildAnalyzingDescriptor(),
                        }
                        insertNodeAtViewportCenterInternal(videoNode)
                        // Caption from the poster still (never the MP4); updates the
                        // node's descriptor (analyzing → ready/failed) on resolve.
                        void analyzeUploadedMedia(videoNodeId, posterFileId)
                        return true
                    } catch (error) {
                        console.error('Failed to add Media Library video to canvas:', error)
                        return false
                    }
                },
                onOpenExtractionTab: (extractionRunId) => {
                    openFeatureExtractionTab(extractionRunId)
                },
            })
        }
        return mediaLibraryPanelInstance
    }

    const onOpenExtractionPanel = (event: Event) => {
        const detail = (event as CustomEvent<{ extractionRunId?: string; workspaceId?: string }>).detail
        if (!detail?.extractionRunId) return
        if (detail.workspaceId && detail.workspaceId !== workspaceId) return
        openFeatureExtractionTab(detail.extractionRunId)
    }

    const onOpenMediaLibraryFeatures = (event: Event) => {
        const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
        if (detail?.workspaceId && detail.workspaceId !== workspaceId) return
        ensureMediaLibraryPanel().openToFeatures()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('lixpi:open-extraction-tab', onOpenExtractionPanel)
    window.addEventListener('lixpi:open-media-library-features', onOpenMediaLibraryFeatures)

    initializePanZoom()
    initCanvasBubbleMenu()
    syncActiveAiChatPanelFromState()
    renderNodes()

    function insertNodeAtViewportCenterInternal(node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}) {
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

        // Newly inserted document/thread nodes get an initial descriptor from any
        // existing content; a fresh, empty node is skipped until it's edited.
        if (positionedNode.type === 'document') {
            const docs = documentsStore.getData() as Document[] | undefined
            const doc = docs?.find((d) => d.documentId === (positionedNode as DocumentCanvasNode).referenceId)
            if (doc?.content !== undefined) scheduleTextNodeDescriptor(positionedNode.nodeId, doc.content, doc.title)
        } else if (positionedNode.type === 'aiChatThread') {
            const thread = aiChatThreadsStore.getThread((positionedNode as AiChatThreadCanvasNode).referenceId)
            if (thread?.content !== undefined) scheduleTextNodeDescriptor(positionedNode.nodeId, thread.content)
        }

        return newCanvasState
    }

    return {
        insertNodeAtViewportCenter(node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}) {
            return insertNodeAtViewportCenterInternal(node, statePatch)
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
                extractionSessionHistoryLoaded = false
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

            // 1. Rebuild DOM first so image nodes exist when PIXI syncs DOM ownership.
            if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
                lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            } else {
                refreshActiveAiChatPanelWhenContentLoads()
                if (aiChatPanelState.isOpen && !activeAiChatPanelEl) renderActiveAiChatPanel()
                if (!aiChatPanelState.isOpen && activeAiChatPanelEl) destroyActiveAiChatPanel(false)
            }

            // 2. Sync PIXI state BEFORE applying the viewport. This ensures
            //    `lastState` inside the PIXI layer is already the new workspace's
            //    canvas state when `setViewport` fires. Without this ordering, a
            //    zoom-tier change during workspace switch would call
            //    `upsertAllImages(OLD_STATE)`, spawning async texture fetches for
            //    the old workspace's images that arrive and overwrite new sprites.
            if (currentCanvasState && connectionManager && visualStateChanged) {
                if (!needsRerender) syncCanvasNodeDomGeometry(currentCanvasState.nodes)
                connectionManager.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
                connectionManager.syncEdges(currentCanvasState.edges)
                scheduleEdgesRender()
                syncPixiMediaLayer(currentCanvasState)
                lastVisualSyncKey = nextVisualSyncKey
            }

            // Video controls need videoNodeHandler entries. Those entries are
            // created by syncPixiMediaLayer, so media chrome must sync after the
            // PIXI/media-registry pass.
            syncGeneratedImageChrome(currentCanvasState)

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
        toggleMediaLibrary() {
            ensureMediaLibraryPanel().toggle()
        },
        toggleAiChatPanel() {
            toggleAiChatPanelVisibility()
        },
        destroy() {
            mediaLibraryPanelInstance?.close()
            resizeObserver.disconnect()
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('lixpi:open-extraction-tab', onOpenExtractionPanel)
            window.removeEventListener('lixpi:open-media-library-features', onOpenMediaLibraryFeatures)
            paneEl.removeEventListener('pointerdown', handlePanePointerDown, true)
            paneEl.removeEventListener('mousemove', handlePaneMouseMove, true)
            paneEl.removeEventListener('mouseleave', handlePaneMouseLeave)
            paneEl.removeEventListener('mousedown', handlePaneMouseDown, true)
            paneEl.style.cursor = ''
            if (edgesRaf !== null) {
                cancelAnimationFrame(edgesRaf)
                edgesRaf = null
            }
            if (generatedMediaChromeSyncRaf !== null) {
                cancelAnimationFrame(generatedMediaChromeSyncRaf)
                generatedMediaChromeSyncRaf = null
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
            for (const timer of textDescriptorTimers.values()) clearTimeout(timer)
            textDescriptorTimers.clear()
            connectionManager?.destroy()
            connectionManager = null
            viewportBridge = null
            destroyVideoControlInstances()
            imageChromeViewportEl?.remove()
            imageChromeViewportEl = null
            expandedGeneratedImageInfoNodeIds.clear()
            pixiMediaLayer?.destroy()
            pixiMediaLayer = null
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
            canvasVideoLifecycle.destroy()
            videoNodeHandler?.destroy()
            videoNodeHandler = null
            videoGenerationTracker.clear()
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
