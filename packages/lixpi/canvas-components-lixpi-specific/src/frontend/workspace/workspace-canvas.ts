import type { WorkspaceCanvasHost } from './workspace-canvas-host.ts'
import type { WorkspacePromptCatalog } from './workspace-canvas-editors.ts'
import type {
    WorkspaceCanvasDocument as Document,
    WorkspaceCanvasConversation as AiChatThread,
} from './workspace-canvas-surface.ts'
import { WorkspaceGenerationContext } from '../../shared/generation/workspace-generation-context.ts'
import { WorkspaceNodeDeletion } from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspaceNodeGestures } from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import { WorkspaceGenerationHandlers } from '@lixpi/canvas-components-lixpi-specific/frontend/media'
import {
    WorkspaceMediaTrackers,
    type PendingGeneratedMediaTracker,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspaceApiCanvasGeometry } from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspaceGenerationSettlement } from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspacePreflightMarkers } from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    WorkspaceBranchMarkerHandoff,
    type WorkspaceBranchMarkerSettlementOptions as BranchMarkerSettlementOptions,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspaceLineageProjection } from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    WorkspaceGenerationPlacements,
    type PendingGeneratedImagePlacement,
    type BranchMarkerUiPhase,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspaceGeometry } from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    WorkspaceConversationProjection,
    WorkspaceMediaOperationRecovery,
    WorkspaceMediaAnalysis,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    defaultPanZoomConfig,
    type ViewportController,
} from '@lixpi/canvas-engine/frontend/viewport'
import {
    CanvasConversationRun,
    WorkspaceConversationRuns,
    WorkspaceRightPanel,
    type WorkspaceRightPanelRenderOptions,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    WorkspaceHistory,
    countProseMirrorNodesByType,
    getBranchMarkerThreadId,
} from '@lixpi/canvas-components-lixpi-specific/shared'

import {
    WorkspaceReferenceProjection,
    getBranchMarkerPromptText,
    getBranchMarkerReasoningResponseText,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { WorkspaceBranchActivity } from '@lixpi/canvas-components-lixpi-specific/shared'
import { CanvasGenerationSubmission } from '@lixpi/canvas-components-lixpi-specific/shared'
import { CapabilityModulePromiseCache } from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    Lifetime,
    type CanvasConnectionControls,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    WorkspaceNodeShells,
    WorkspaceDomNodes,
    isWorkspaceNodeType,
    OperationStatusNode,
    WorkspaceDocumentNodes,
    WorkspaceCapabilityNode,
    BranchMediaModelCircleStyles,
    BranchMarkerContent,
    BranchMarkerActions,
    createBranchReferenceResolution,
    type WorkspaceDocumentEditorOptions,
} from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import {
    rectangleContainsPoint,
    unionRectangles,
    getIntersectingNodeIds,
} from '@lixpi/canvas-engine/shared'
import type {
    ViewportSnapshot as Viewport,
    CanvasEngineRect as Rect,
} from '@lixpi/canvas-engine/shared'
import {
    LoadingStatus,
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type DocumentMediaCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type AudioCanvasNode,
    type CapabilityArtifactCanvasNode,
    type OperationStatusCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type WorkspaceEdge,
    type CanvasAiChatPanelState,
    type CanvasGeneratedOutputDetailsTarget,
    type CanvasRightSidePanelMode,
    type AssetMeta,
    type CanvasGeometryUpdate,
    type CapabilityRunEvent,
    type ExecutionTraceHandle,
    type MediaDescriptor,
    type ContentDescriptor,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
    type MediaGenerationRunMeta,
    type MediaGenerationProgressState,
    type AiInteractionMediaGenerationRequest,
    type MediaPromptReference,
} from '@lixpi/constants'
import {
    WorkspacePromptComposer,
    type AiPromptComposerSubmitData,
} from '@lixpi/canvas-components-lixpi-specific/frontend/composer'
import {
    createMediaPromptReferencePreview,
    type PromptReferencePreviewRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '@lixpi/prosemirror/shared/model-selection-attrs'
import { CanvasGenerationEvents } from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    type BranchMarkerConversationPreview,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import type { AiLineageProjectionScope } from '@lixpi/prosemirror'
import {
    estimateBranchMarkerDimensions,
    getPendingGeneratedMediaNodeId,
    resizeBranchMarkerToDimensions,
    type GeneratedOutputCanvasNode,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { normalizeHexColor } from '@lixpi/ui-primitives/gradients'
import {
    fitDimensionsToAspectRatio,
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeToScreenForZoom,
    scaleCanvasChromeWorldSizeForZoom,
} from '@lixpi/canvas-engine/shared'
import { arrowRightIcon } from '@lixpi/ui-kit/svg'

import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'
import {
    type BranchMarkerPromptPart,
    getBranchMarkerPromptDisplayText,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { createCanvasPromptReferenceRenderer } from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    GeneratedMediaRebalancePipeline,
    type BranchMarkerNode,
    type CanvasGeometry,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { getBranchMarkerMediaModelCircleDescriptors } from '@lixpi/canvas-components-lixpi-specific/shared'

import { resolveBranchMarkerRenderOwnership } from '@lixpi/canvas-components-lixpi-specific/shared'

import { createNodeLayerManager } from '@lixpi/canvas-engine/frontend/runtime'

import {
    createPendingCanvasVisualCommit,
    getCanvasVisualSyncKey,
    getNodeStructureKey,
    mergeIncomingCanvasStateWithPendingVisualCommit,
    updatePendingCanvasVisualCommitViewport,
    type PendingCanvasVisualCommit,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { shouldPreserveLiveViewportForScene } from '@lixpi/canvas-engine/shared'
import { lockCanvasScrollLayers } from '@lixpi/canvas-engine/frontend/runtime'
import { planWorkspaceRenderTransition } from '@lixpi/canvas-components-lixpi-specific/shared'
import { type MediaGenerationOperationRecoveryResult } from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    getMediaGenerationReferenceResolutionForMarker,
    isMediaGenerationReferenceResolutionOperation,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    createMediaGenerationProgress,
    type MediaGenerationProgressInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/progress'
import {
    BranchCapabilityProgress,
    buildBranchMarkerProgress,
    isMediaGenerationOperationSupersededByOutput,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    createGeneratedOutputDetailsSidebar,
    type GeneratedOutputDetailsSidebarInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'

import {
    WorkspaceCanvasMenu,
    type WorkspaceCanvasMenuPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/menus'

import {
    createWorkspaceMediaLayer,
    WorkspaceVideoChrome,
    WorkspaceOutputChrome,
    WorkspaceGenerationVisuals,
    type WorkspaceMediaLayer,
    type SelectionColors,
} from '@lixpi/canvas-components-lixpi-specific/frontend/media'
import {
    createWorkspaceLoadingOutline,
    type WorkspaceLoadingOutlineInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/loading'
import {
    createViewportBridge,
    type ViewportBridge,
} from '@lixpi/canvas-engine/frontend/viewport'
import {
    WorkspaceOutputReview,
    type GeneratedOutputRegenerationRequest,
    WorkspaceAssetViews,
    WorkspaceOutputDetails,
    WorkspaceGenerationHistory,
    mountWorkspaceMediaHistory,
    type WorkspaceGenerationHistoryPorts,
    type WorkspaceHistoryView,
    type WorkspaceAssetDetailsPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'
import {
    createCapabilityLibraryPanel,
    createArtifactLibraryPanel,
    createMediaLibraryPanel,
    type CapabilityLibraryPanelInstance,
    type WorkspaceLibraryPorts,
} from '@lixpi/canvas-components-lixpi-specific/frontend/library'
import {
    getAiChatPanelState,
    setAiChatPanelState,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    WorkspaceContextTrays,
    type ContextPreviewEnvironment,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type ResizeHandle = ResizeCorner
type GeneratedMediaProjectionTarget = {
    node: ImageCanvasNode | VideoCanvasNode
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
}
type BranchMarkerProjectionTarget = {
    marker: BranchMarkerNode
    lineageProjectionScope: AiLineageProjectionScope
}
type BranchMarkerModelDescriptor = {
    modelId: string
    modelProvider?: string
}
type BranchMarkerModelCatalogEntry = {
    provider?: string
    model?: string
    title?: string
    shortTitle?: string
    iconName?: string
    color?: string
}
type BranchMarkerModelEntry = {
    title: string
    icon: string | null
    color: string | null
}
type BranchMarkerModelDetail = {
    label: string
    entries: BranchMarkerModelEntry[]
}
const NODE_DRAG_START_THRESHOLD_PX = 6
// Must match the `workspace-branch-marker-spin` animation duration in
// workspace-canvas.scss (0.8s). Used to phase-align recreated spinners to a
// shared rotation clock so the spinner never visibly restarts.
const GENERATED_IMAGE_COMPLETION_OUTLINE_FALLBACK_MS = 30000
type BranchMarkerDimensionOptions = {
    responseLine?: boolean
    responseText?: string
}
// Streaming reasoning text scrolls past the marker as a tail while receiving.
type DragStartOptions = {
    onClick?: () => void
    suppressPaneClick?: boolean
    allowSelection?: boolean
}
type WorkspaceCanvasCallbacks = {
    onViewportChange?: (viewport: Viewport) => void
    onCanvasStateChange?: (state: CanvasState) => void
    onAuthoritativeCanvasStateChange?: (params: { canvasState: CanvasState; layoutRevision: number }) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; content: any }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
    onAssetDetach?: (params: {
        assetId: string
        nodeId: string
        removedNodeIds: string[]
        canvasState: CanvasState
    }) => Promise<CanvasState>
    onAssetAttach?: (params: { assetId: string; nodeId: string; canvasState: CanvasState }) => Promise<CanvasState>
}
type WorkspaceCanvasNodeInsertion =
    | Omit<DocumentCanvasNode, 'position'>
    | Omit<DocumentMediaCanvasNode, 'position'>
    | Omit<ImageCanvasNode, 'position'>
    | Omit<VideoCanvasNode, 'position'>
    | Omit<AudioCanvasNode, 'position'>
    | Omit<CapabilityArtifactCanvasNode, 'position'>
    | Omit<OperationStatusCanvasNode, 'position'>
type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode
type WorkspaceCanvasInsertionStatePatch = Omit<Partial<CanvasState>, 'nodes' | 'edges' | 'viewport'>
export type WorkspaceCanvasOptions = {
    paneEl: HTMLDivElement
    viewportEl: HTMLDivElement
    mediaModeSwitchMountEl: HTMLDivElement
    modelMenuControlMountEl: HTMLDivElement
    glassTargets?: readonly { id: string; element: HTMLElement }[]
    workspaceId: string
    canvasState: CanvasState | null
    documents: Document[]
    aiChatThreads: AiChatThread[]
    panZoomConfig?: Partial<ReturnType<typeof defaultPanZoomConfig>>
} & WorkspaceCanvasCallbacks

export class LixpiWorkspaceCanvas {
    private readonly callbacks = new Lifetime()
    private readonly editors: WorkspaceCanvasHost['editors']
    private readonly paneEl
    private readonly html: ReturnType<typeof createDocumentHtml>
    private readonly window: Window
    private readonly viewportMount
    private readonly onViewportChange
    private readonly onCanvasStateChange
    private readonly onAuthoritativeCanvasStateChange
    private readonly onDocumentContentChange
    private readonly onAiChatThreadContentChange
    private readonly onAssetDetach
    private readonly onAssetAttach
    private rendererDestroyed
    private viewportEl: HTMLDivElement
    private workspaceId
    private readonly capabilityModuleCache
    private promptReferenceCatalogClient: WorkspacePromptCatalog | undefined
    private promptReferenceCatalogOrganizationId
    private promptReferenceCatalogWorkspaceId = ''
    private readonly getPromptReferenceCatalogClient
    private readonly debugLoggingEnabled
    private readonly connectorStyles
    private readonly selectionStyles
    private readonly mediaNodeStyles
    private readonly branchOriginSettings
    private readonly mediaModelCircleSettings
    private readonly branchMediaCircleStyles
    private readonly branchMarkerText
    private readonly normalizedInitialCanvasState: CanvasState | null
    private readonly initialMediaAnalysisState
    private currentCanvasState: CanvasState | null
    private initialStaleMediaAnalysisReset
    private currentDocuments: Document[]
    private currentAiChatThreads: AiChatThread[]
    private panZoom: ViewportController | null
    private lastTransform: [number, number, number]
    private connectionManager: CanvasConnectionControls | null
    private canvasMediaLayer: WorkspaceMediaLayer | null
    private workspaceLoadingOutline: WorkspaceLoadingOutlineInstance | null
    private viewportBridge: ViewportBridge | null
    private lastWorkspaceLoadingStatus
    private renderedWorkspaceId: string | null
    private mediaChromeViewportEl: HTMLDivElement | null
    private generatedOutputDetailsRefreshRaf: number | null
    private readonly nodeShells
    private readonly branchMarkerProjectionOverrideNodeIds: Set<string>
    private readonly manuallyPositionedBranchMarkerNodeIds: Set<string>
    private readonly branchMarkerHandoffDebugKeys: Set<string>
    private readonly branchMarkerContentLifetimes
    private edgesRaf: number | null
    private transformSideEffectsRaf: number | null
    private pendingHandleZoom: number | null
    private selectedEdgeId: string | null
    private readonly canvasAssetViews
    private readonly generationContext
    private readonly generationEvents
    private readonly generationPlacements
    private readonly branchMarkerActions
    private readonly mediaGenerationProgressInstances
    private readonly capabilityProgressRuns
    private readonly detachedAiChatThreadEditors
    private readonly nodeLayerManager
    private readonly documentNodes
    private activeOutputDetails: WorkspaceOutputDetails | null
    private readonly referenceProjection
    private readonly branchActivity
    private readonly workspaceHistory
    private activeGeneratedOutputDetailsPanel: GeneratedOutputDetailsSidebarInstance | null
    private globalCanvasComposer: WorkspacePromptComposer | null
    private readonly DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS
    private readonly contextTrays
    private mediaLibraryPanelInstance: ReturnType<typeof createMediaLibraryPanel> | null
    private artifactLibraryPanelInstance: ReturnType<typeof createArtifactLibraryPanel> | null
    private capabilityLibraryPanelInstance: CapabilityLibraryPanelInstance | null
    private aiChatPanelState: CanvasAiChatPanelState
    private pendingLocalCanvasVisualCommit: PendingCanvasVisualCommit | null
    private readonly mediaTrackers
    private readonly partialImageTracker
    private readonly cancelledMediaGenerationRequestIds
    private paneRect: DOMRect | null
    private readonly videoGenerationTracker
    private readonly generationVisuals
    private readonly canvasSelectionColors: SelectionColors
    private readonly connectorIcon
    private readonly domNodes
    private readonly canvasRuntime
    private readonly liveNodeOverrides
    private readonly workspaceGeometry
    private readonly lineageProjection
    private readonly markerHandoff
    private readonly preflightMarkers
    private readonly generationSettlement
    private readonly apiCanvasGeometry
    private readonly selection
    private readonly mediaOperationRecovery
    private readonly conversationProjection
    private readonly canvasGenerationSubmission
    private readonly mediaAnalysis
    private readonly outputReview
    private projectionOverrides
    private projectionSceneKey
    private readonly selectionOverlay
    private readonly marquee
    private readonly videoChrome
    private readonly outputChrome
    private canvasBubbleMenu: WorkspaceCanvasMenu | null
    private canvasToastEl: HTMLElement | null
    private readonly nodeGestures
    private readonly nodeDeletion
    private readonly rightPanel
    private readonly pendingGeneratedImagePlacements
    private readonly pendingBranchMarkers
    private readonly branchMarkerUiPhaseByNodeId
    private readonly generationHandlers
    private readonly resizeObserver
    private persistedViewportApplied
    private readonly panZoomConfig
    private lastNodeStructureKey
    private lastVisualSyncKey
    private lastDocumentsKey
    private lastThreadsKey
    private readonly unlockCanvasScrollLayers
    private hasObservedInitialAiModelsStore
    private readonly unsubscribeAiModelsStore
    private observedAssetRevisions
    private hasObservedInitialAssetsStore
    private readonly unsubscribeAssetsStore
    private readonly unsubscribeWorkspaceStore

    constructor(private readonly options: WorkspaceCanvasOptions, private readonly host: WorkspaceCanvasHost) {
        try {
            this.editors = host.editors
            this.paneEl = this.options.paneEl
            this.html = createDocumentHtml(this.paneEl.ownerDocument)
            this.window = this.paneEl.ownerDocument.defaultView ?? window
            this.viewportMount = this.options.viewportEl
            this.onViewportChange = this.options.onViewportChange
            this.onCanvasStateChange = this.options.onCanvasStateChange
            this.onAuthoritativeCanvasStateChange = this.options.onAuthoritativeCanvasStateChange
            this.onDocumentContentChange = this.options.onDocumentContentChange
            this.onAiChatThreadContentChange = this.options.onAiChatThreadContentChange
            this.onAssetDetach = this.options.onAssetDetach
            this.onAssetAttach = this.options.onAssetAttach
            this.rendererDestroyed = false
            this.viewportEl = this.viewportMount
            this.workspaceId = this.options.workspaceId
            this.capabilityModuleCache = new CapabilityModulePromiseCache()
            this.promptReferenceCatalogOrganizationId = ''
            this.getPromptReferenceCatalogClient = (organizationId = String(this.host.workspace.organizationId() ?? '')): WorkspacePromptCatalog => {
                if (!this.promptReferenceCatalogClient || organizationId !== this.promptReferenceCatalogOrganizationId || this.workspaceId !== this.promptReferenceCatalogWorkspaceId) {
                    this.promptReferenceCatalogOrganizationId = organizationId
                    this.promptReferenceCatalogWorkspaceId = this.workspaceId
                    this.promptReferenceCatalogClient = this.host.capabilities.promptCatalog(this.workspaceId, organizationId)
                }
                return this.promptReferenceCatalogClient
            }
            this.debugLoggingEnabled = this.isWorkspaceCanvasDebugEnabled()
            this.connectorStyles = this.host.settings.connector.styles
            this.selectionStyles = this.host.settings.selection.styles
            this.mediaNodeStyles = this.host.settings.mediaNode.styles
            this.branchOriginSettings = this.host.settings.mediaBranchLineage.branchOrigin
            this.mediaModelCircleSettings = this.host.settings.mediaBranchLineage.mediaModelCircle
            this.branchMediaCircleStyles = new BranchMediaModelCircleStyles(this.mediaModelCircleSettings)
            this.paneEl.style.setProperty('--connector-line-default-color', this.connectorStyles.lineDefaultColor)
            this.paneEl.style.setProperty('--connector-line-focus-color', this.connectorStyles.lineFocusColor)
            this.paneEl.style.setProperty('--selection-marquee-border-color', this.selectionStyles.marqueeBorderColor)
            this.paneEl.style.setProperty('--selection-marquee-background-color', this.selectionStyles.marqueeBackgroundColor)
            this.paneEl.style.setProperty('--selection-overlay-border-color', this.selectionStyles.overlayBorderColor)
            this.paneEl.style.setProperty('--selection-overlay-background-color', this.selectionStyles.overlayBackgroundColor)
            this.paneEl.style.setProperty('--selection-outline-color', this.selectionStyles.outlineColor)
            this.paneEl.style.setProperty('--workspace-media-node-default-box-shadow', this.mediaNodeStyles.defaultBoxShadow)
            this.paneEl.style.setProperty('--workspace-media-node-selected-box-shadow', this.mediaNodeStyles.selectedBoxShadow)
            this.paneEl.style.setProperty('--workspace-media-node-border-radius', `${this.mediaNodeStyles.borderRadius}px`)
            this.host.models.styleBadge(this.paneEl)
            this.paneEl.style.setProperty('--workspace-branch-origin-icon-size', `${this.branchOriginSettings.iconSize}px`)
            this.paneEl.style.setProperty('--workspace-branch-origin-background-color', this.branchOriginSettings.styles.backgroundColor)
            this.paneEl.style.setProperty('--workspace-branch-origin-border-color', this.branchOriginSettings.styles.borderColor)
            this.paneEl.style.setProperty('--workspace-branch-origin-icon-color', this.branchOriginSettings.styles.iconColor)
            this.paneEl.style.setProperty('--workspace-branch-origin-box-shadow', this.branchOriginSettings.styles.boxShadow)
            this.paneEl.style.setProperty('--canvas-node-footer-separator-gradient', this.branchOriginSettings.styles.separatorGradient)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-circle-size', `${this.mediaModelCircleSettings.size}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-icon-size', `${this.mediaModelCircleSettings.iconSize}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-main-gap', `${this.mediaModelCircleSettings.mainGap}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-stack-gap', `${this.mediaModelCircleSettings.stackGap}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-icon-color', this.mediaModelCircleSettings.styles.iconColor)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-circle-background-color', this.mediaModelCircleSettings.styles.backgroundColor)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-circle-box-shadow', this.mediaModelCircleSettings.styles.boxShadow)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-texture-inset', `${this.mediaModelCircleSettings.texture.inset}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-texture-opacity', `${this.mediaModelCircleSettings.texture.opacity}`)
            this.paneEl.style.setProperty('--workspace-branch-marker-media-model-texture-background-size', `${this.mediaModelCircleSettings.texture.backgroundSizePercent}% ${this.mediaModelCircleSettings.texture.backgroundSizePercent}%`)
            this.branchMarkerText = this.host.settings.mediaBranchLineage.marker.text
            this.paneEl.style.setProperty('--workspace-branch-marker-message-font-size', `${this.branchMarkerText.messageFontSize}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-message-line-height', `${this.branchMarkerText.messageLineHeight}`)
            this.paneEl.style.setProperty('--workspace-branch-marker-response-font-size', `${this.branchMarkerText.responseFontSize}px`)
            this.paneEl.style.setProperty('--workspace-branch-marker-response-line-height', `${this.branchMarkerText.responseLineHeight}`)
            this.normalizedInitialCanvasState = this.options.canvasState
                ? this.normalizeBranchMarkerDimensions(this.options.canvasState)
                : this.options.canvasState
            this.initialMediaAnalysisState = this.normalizedInitialCanvasState
                ? this.resetStaleAnalyzingMediaDescriptors(this.normalizedInitialCanvasState)
                : { state: this.normalizedInitialCanvasState, changed: false }
            this.currentCanvasState = this.initialMediaAnalysisState.state
            this.initialStaleMediaAnalysisReset = this.initialMediaAnalysisState.changed
            this.currentDocuments = this.options.documents
            this.currentAiChatThreads = this.options.aiChatThreads
            this.panZoom = null
            this.lastTransform = [0, 0, 1]
            this.connectionManager = null
            this.canvasMediaLayer = null
            this.workspaceLoadingOutline = null
            this.viewportBridge = null
            this.lastWorkspaceLoadingStatus = this.host.workspace.loadingStatus() as LoadingStatus
            this.renderedWorkspaceId = this.currentCanvasState ? this.workspaceId : null
            this.mediaChromeViewportEl = null
            this.generatedOutputDetailsRefreshRaf = null
            this.nodeShells = new WorkspaceNodeShells({
                document: this.paneEl.ownerDocument,
                getBounds: node => ({ ...this.getNodeWorldPosition(node), ...node.dimensions }),
                getLayer: () => this.nodeLayerManager.currentTopIndex(),
                getZoom: () => this.currentCanvasState?.viewport?.zoom ?? 1,
                getResizeSettings: () => ({ ...this.host.settings.mediaNode.resizeHandle, useZoomCompensatedScaling: this.host.settings.mediaNode.useZoomCompensatedResizeHandleScaling }),
                consumeSuppressedClick: () => {
                    return this.nodeGestures.consumeNodeClick()
                },
                select: this.selectNode,
                toggleSelection: this.toggleNodeSelection,
                startDrag: this.handleDragStart,
                startResize: this.handleResizeStart,
                onCreate: this.updatePendingGeneratedMediaBeforeFrameClass,
                togglePlayback: nodeId => {
                    if (this.canvasMediaLayer?.playback.hasEntry(nodeId)) void this.canvasMediaLayer.playback.toggle(nodeId)
                },
            })
            this.branchMarkerProjectionOverrideNodeIds = new Set()
            this.manuallyPositionedBranchMarkerNodeIds = new Set()
            // Streamed AI tokens are dispatched with `skipDispatch`, so the aiChatThreads
            // store lags behind the live editor doc until the stream settles. Branch
            // lineage markers read their preview text from this override while a thread is
            // actively streaming so the response line tracks the doc token-by-token; it is
            // cleared once the store catches up via onEditorChange.
            this.branchMarkerHandoffDebugKeys = new Set()
            this.branchMarkerContentLifetimes = new Map<string, Lifetime>()
            this.edgesRaf = null
            this.transformSideEffectsRaf = null
            this.pendingHandleZoom = null
            this.selectedEdgeId = null
            this.canvasAssetViews = new WorkspaceAssetViews(this.createAssetViewPorts)
            this.generationContext = new WorkspaceGenerationContext({ readAsset: assetId => this.host.assets.read(assetId), renditionPath: this.host.media.renditionPath })
            this.generationEvents = new CanvasGenerationEvents(error => console.error('[CANVAS] Generated media event failed:', error))
            this.generationPlacements = new WorkspaceGenerationPlacements({
                readCanvasState: () => this.currentCanvasState,
                hasStartedMedia: this.hasStartedGeneratedMediaForBranchMarkerNode,
            })
            this.branchMarkerActions = new Map<string, BranchMarkerActions>()
            this.mediaGenerationProgressInstances = new Map<string, MediaGenerationProgressInstance>()
            this.capabilityProgressRuns = new BranchCapabilityProgress()
            this.detachedAiChatThreadEditors = new WorkspaceConversationRuns<CanvasConversationRun>({
                pane: this.paneEl,
                setTimer: (callback, delayMs) => this.window.setTimeout(callback, delayMs),
                clearTimer: handle => this.window.clearTimeout(handle),
            })
            this.nodeLayerManager = createNodeLayerManager()
            this.documentNodes = new WorkspaceDocumentNodes(this.nodeShells, {
                mountEditor: this.mountDocumentEditor,
                onError: (error, nodeId) => console.error('Failed to create document editor:', { nodeId, error }),
            })
            // Per-node debounce timers for document/thread descriptor regeneration. Keyed
            // by canvas nodeId so rapid edits collapse into one describe call once typing
            // (or a streaming transcript) settles.
            this.activeOutputDetails = null
            this.referenceProjection = new WorkspaceReferenceProjection({
                getNodes: () => this.currentCanvasState?.nodes ?? [],
                getAsset: assetId => this.host.assets.read(assetId),
                getDocumentTitles: () => new Map(this.currentDocuments.map(document => [document.documentId, document.title])),
                getSubmittedPromptParts: placementKey => this.pendingGeneratedImagePlacements.get(placementKey)?.promptParts,
            })
            this.branchActivity = new WorkspaceBranchActivity({
                getNodes: () => this.currentCanvasState?.nodes ?? [],
                getOutputs: this.getBranchMarkerGeneratedOutputNodes,
                getAsset: assetId => this.host.assets.read(assetId),
                getPlacements: () => this.pendingGeneratedImagePlacements,
                isCancelled: this.isBranchMarkerGenerationCancelled,
                hasStartedMedia: this.hasStartedGeneratedMediaForBranchMarkerNode,
                isPending: this.isBranchMarkerPendingForUi,
            })
            this.workspaceHistory = new WorkspaceHistory({
                getNodes: () => this.currentCanvasState?.nodes ?? [],
                getThreadContent: this.getAiChatThreadContentForProjection,
                getProvenanceContent: assetId => this.host.assets.readDocument(assetId, 'provenance')?.doc,
                isBranchActive: this.isBranchMarkerGenerationActive,
                isBranchGroupActive: this.isBranchMarkerGenerationGroupActive,
                isBranchCancelled: this.isBranchMarkerGenerationCancelled,
            })
            this.activeGeneratedOutputDetailsPanel = null
            // Screen-fixed, canvas-wide composer mounted at the bottom-center of the
            // viewport. Each submission creates one hidden ProseMirror-backed message
            // instance whose visible projection is the spatial branch lineage marker.
            this.globalCanvasComposer = null
            // In-flight detached canvas message ids for stream reattachment and delayed
            // editor teardown. Generated-media event routing uses normal thread and
            // workspace state.
            this.DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS = 30 * 60 * 1000
            this.contextTrays = new WorkspaceContextTrays({
                document: this.paneEl.ownerDocument,
                getNode: nodeId => this.findCanvasNodeById(nodeId),
                getContextNodeIds: () => this.aiChatPanelState.contextChips,
                getEnvironment: this.getContextPreviewEnvironment,
                onRemove: this.removeContextChip,
                requestFrame: callback => this.window.requestAnimationFrame(callback),
                cancelFrame: frame => this.window.cancelAnimationFrame(frame),
            })
            this.mediaLibraryPanelInstance = null
            this.artifactLibraryPanelInstance = null
            this.capabilityLibraryPanelInstance = null
            this.aiChatPanelState = getAiChatPanelState(this.currentCanvasState)
            this.pendingLocalCanvasVisualCommit = null
            this.mediaTrackers = new WorkspaceMediaTrackers({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                hasDecodedFrame: nodeId => this.generationVisuals.hasDecodedFrame(nodeId),
                hasReadyOriginal: assetId => this.host.assets.read(assetId)?.media?.renditions.original?.status === 'ready',
                forgetDecodedFrame: nodeId => this.generationVisuals.forgetDecodedFrame(nodeId),
                clearCompletion: this.clearFinalizingGeneratedImageOutline,
                debug: this.debugGeneratedMediaLifecycle,
            })
            this.partialImageTracker = this.mediaTrackers.images
            this.cancelledMediaGenerationRequestIds = this.generationPlacements.cancelledRequests
            this.paneRect = null
            // Pending video-generation tracker: mirrors partialImageTracker. VEO has no
            // partial frames, so the sequence is VIDEO_PENDING (apply the API-persisted
            // placeholder + tracker entry) -> VIDEO_GENERATING keepalives (no state mutation) ->
            // VIDEO_COMPLETE (finalize the same node + clear tracker). Source-shape
            // tests guard that this is the ONLY tracker used for video generation —
            // there is no DOM spinner, mirroring PR #202's image pattern.
            this.videoGenerationTracker = this.mediaTrackers.videos
            this.generationVisuals = new WorkspaceGenerationVisuals({
                getState: () => this.currentCanvasState,
                getAsset: assetId => this.host.assets.read(assetId),
                images: this.partialImageTracker,
                videos: this.videoGenerationTracker,
                alwaysOn: () => this.host.settings.mediaNode.inProgressOutlineAnimation.developmentFlags.alwaysOn,
                setTargets: targets => this.canvasMediaLayer?.setGeneratingImageNodes(targets),
                completionTimeoutMs: GENERATED_IMAGE_COMPLETION_OUTLINE_FALLBACK_MS,
                setTimer: (callback, delayMs) => this.window.setTimeout(callback, delayMs),
                clearTimer: handle => this.window.clearTimeout(handle),
                getPendingInset: this.getPendingGeneratedMediaBeforeFrameCircleInset,
                onFinalized: nodeId => {
                    const nodeEl = this.viewportEl.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                    if (nodeEl) this.updatePendingGeneratedMediaBeforeFrameClass(nodeEl, nodeId)
                    this.syncCanvasMediaLayer(this.currentCanvasState)
                    this.syncConnectionManagerForCurrentCanvasState({ flushRenderer: true })
                },
            })
            this.canvasSelectionColors = {
                marqueeStroke: this.selectionStyles.marqueeBorderColor,
                marqueeFill: this.selectionStyles.marqueeBackgroundColor,
                groupOverlayStroke: this.selectionStyles.overlayBorderColor,
                groupOverlayFill: this.selectionStyles.overlayBackgroundColor,
            }
            this.connectorIcon = extractSvgPathIcon(arrowRightIcon)
            this.domNodes = new WorkspaceDomNodes({
                shells: this.nodeShells,
                document: node => this.documentNodes.create(node, this.currentDocuments.find(document => document.documentId === node.assetId)),
                capability: this.createCapabilityArtifactNode,
                operation: this.createOperationStatusNode,
                branch: this.createBranchMarkerNode,
                updateBranch: this.syncBranchMarkerNodeContent,
            })
            this.canvasMediaLayer = createWorkspaceMediaLayer({
                paneEl: this.paneEl,
                viewportEl: this.viewportMount,
                nodes: {
                    visible: this.getVisibleCanvasNodes,
                    mountDom: node => this.domNodes.mount(node),
                    geometry: type => ({
                        measure: projected => {
                            const node = { ...projected.data.node, parentId: undefined, position: projected.position, dimensions: projected.dimensions } as CanvasNode
                            const bounds = { ...node.position, ...node.dimensions }
                            const pending = this.generationVisuals.isFinalizing(node.nodeId)
                                ? null
                                : this.getPendingGeneratedMediaBeforeFrameVisualGeometry(node.nodeId, node.position, node.dimensions)
                            return {
                                visualBounds: bounds,
                                hitBounds: bounds,
                                selectionBounds: bounds,
                                collisionBounds: this.getCanvasNodeCollisionRect(node, node.position),
                                connectorBounds: pending ? { ...pending.position, ...pending.dimensions } : bounds,
                            }
                        },
                        resize: { min: { width: type === 'image' ? 50 : 200, height: type === 'image' ? 1 : 150 }, preserveAspectRatio: type === 'image' },
                        movable: true,
                    }),
                },
                getWorkspaceId: () => this.workspaceId,
                selectionColors: this.canvasSelectionColors,
                onImageIntrinsicSize: this.handleImageIntrinsicSize,
                onVideoIntrinsicSize: this.handleVideoIntrinsicSize,
                onPlaybackReady: () => this.scheduleGeneratedMediaChromeSync(),
                marker: { paths: this.connectorIcon.pathData, width: this.connectorIcon.width, reference: { x: 48, y: 128 } },
                onEdgesChange: edges => {
                    if (this.currentCanvasState) this.commitCanvasState({ ...this.currentCanvasState, edges })
                },
                onEdgeSelectionChange: edgeId => {
                    this.selectedEdgeId = edgeId
                    if (edgeId) {
                        this.selectNode(null)
                        this.showEdgeBubbleMenu(edgeId)
                    } else {
                        this.hideEdgeBubbleMenu()
                    }
                },
                settings: this.host.settings,
                sources: this.host.media.sources,
                onError: error => console.error('Canvas media rendering failed:', error),
            })
            this.canvasRuntime = this.canvasMediaLayer.canvas
            this.connectionManager = this.canvasMediaLayer.connections
            this.liveNodeOverrides = this.canvasRuntime.geometry
            this.workspaceGeometry = new WorkspaceGeometry({
                workspaceId: this.workspaceId,
                settings: this.host.settings,
                getViewport: this.getLiveViewport,
                getPaneSize: this.getInsertionPaneSize,
                getWorldPosition: this.getNodeWorldPosition,
                getWorldRect: this.getNodeWorldRect,
                getLiveDimensions: nodeId => this.liveNodeOverrides.get(nodeId)?.dimensions,
                isPending: this.isPendingGeneratedMediaBeforeFirstFrame,
            })
            this.lineageProjection = new WorkspaceLineageProjection({
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                geometry: this.workspaceGeometry,
                settings: this.host.settings.mediaBranchLineage,
                getWorldPosition: this.getNodeWorldPosition,
                getWorldRect: this.getNodeWorldRect,
                resizeMarker: node => this.resizeBranchMarkerNodeFromProseMirror(node) as typeof node,
            })
            this.markerHandoff = new WorkspaceBranchMarkerHandoff({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                lineage: this.lineageProjection,
                geometry: this.workspaceGeometry,
                resizeMarker: this.resizeBranchMarkerNodeFromProseMirror,
                liveGeometry: this.applyBranchMarkerLiveGeometry,
                isManuallyPositioned: nodeId => this.manuallyPositionedBranchMarkerNodeIds.has(nodeId),
                preservePreview: this.preserveBranchMarkerPreviewStateAcrossPromotion,
                cleanup: this.cleanupBranchMarkerArtifacts,
                clearProjection: nodeId => {
                    this.projectionOverrides.delete(nodeId)
                    this.branchMarkerProjectionOverrideNodeIds.delete(nodeId)
                },
                commit: this.commitTransientCanvasStatePreservingEditors,
                syncMarker: this.syncBranchMarkerNodeContent,
                refreshConversation: this.refreshBranchMarkersForAiChatThread,
                hasElement: nodeId => Boolean(this.findBranchMarkerNodeEl(nodeId)),
                debugHandoff: this.debugBranchMarkerHandoff,
                log: (level, message, details) => console[level](message, details),
            })
            this.preflightMarkers = new WorkspacePreflightMarkers({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                lineage: this.lineageProjection,
                handoff: this.markerHandoff,
                geometry: this.workspaceGeometry,
                activeThreadIds: this.getActiveDetachedCanvasRunThreadIds,
                isRunActive: threadId => this.detachedAiChatThreadEditors.isActive(threadId),
                readThread: this.getPersistedAiChatThread,
                resizeMarker: this.resizeBranchMarkerNodeFromProseMirror,
                rebalance: this.rebalanceGeneratedMediaTrees,
                commit: this.commitTransientCanvasStatePreservingEditors,
                append: this.appendCanvasNodeToDOM,
                createId: this.host.createId,
                log: (level, message, details) => console[level](message, details),
            })
            this.generationSettlement = new WorkspaceGenerationSettlement({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                lineage: this.lineageProjection,
                handoff: this.markerHandoff,
                preflight: this.preflightMarkers,
                setReferences: this.setGeneratingReferenceNodeIds,
                clearReferences: this.clearGeneratingReferenceNodeIds,
                scheduleConversationRefresh: this.schedulePersistedAiChatThreadRefreshForBranchMarkers,
                refreshConversation: this.refreshBranchMarkersForAiChatThread,
                settleConversation: this.settleDetachedCanvasRun,
                scheduleTeardown: this.scheduleDetachedCanvasRunTeardown,
                cleanup: this.cleanupBranchMarkerArtifacts,
                commit: this.commitTransientCanvasStatePreservingEditors,
                syncMedia: this.syncCanvasMediaLayer,
                liveGeometry: this.applyBranchMarkerLiveGeometry,
                resizeMarker: this.resizeBranchMarkerNodeFromProseMirror,
                isManuallyPositioned: nodeId => this.manuallyPositionedBranchMarkerNodeIds.has(nodeId),
                syncMarker: this.syncBranchMarkerNodeContent,
                log: (message, details) => console.info(message, details),
            })
            this.apiCanvasGeometry = new WorkspaceApiCanvasGeometry({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                settlement: this.generationSettlement,
                cleanupMarkers: this.cleanupBranchMarkerArtifacts,
                pruneTrackers: this.pruneApiCanvasRemovedGeneratedMediaTrackers,
                commit: this.commitTransientCanvasStatePreservingEditors,
                publishAuthoritative: snapshot => this.onAuthoritativeCanvasStateChange?.(snapshot),
                syncMedia: this.syncCanvasMediaLayer,
                syncGeneratingMedia: this.syncGeneratingMediaNodes,
                appendNode: this.appendCanvasNodeToDOM,
                syncOperationNode: this.syncExistingOperationStatusNodeToDOM,
                syncNodeGeometry: this.syncCanvasNodeDomGeometry,
                preserveUntilAcknowledged: state => {
                    this.pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(state)
                },
                log: (event, details) => {
                    if (this.debugLoggingEnabled) console.info('[CANVAS][api-geometry]', event, details)
                },
            })
            this.selection = this.canvasRuntime.selection
            this.mediaOperationRecovery = new WorkspaceMediaOperationRecovery({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                fetch: this.host.generation.get,
                replay: this.host.generation.replay,
                subscribe: this.host.generation.subscribe,
                apply: (result, progressOnly) => {
                    if (progressOnly) this.applyMediaOperationProgressResult(result)
                    else this.applyMediaOperationRecoveryResult(result)
                },
                reportError: error => console.error('[CANVAS] Media operation recovery failed:', error),
            })
            this.conversationProjection = new WorkspaceConversationProjection<AiChatThread>({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                getThreads: () => this.currentAiChatThreads,
                setThreads: threads => {
                    this.currentAiChatThreads = threads
                },
                getNodes: () => this.currentCanvasState?.nodes ?? [],
                retainedThreadIds: () => [...this.detachedAiChatThreadEditors.activeIds(), ...this.detachedAiChatThreadEditors.keys()],
                canUseLatestTurnFallback: (node, content) => this.workspaceHistory.canUseLatestBranchMarkerTurnFallback(node, content),
                fetchThread: this.host.generation.fetchConversation,
                refreshProjection: threadId => {
                    this.refreshBranchMarkersForAiChatThread(threadId)
                    this.refreshGeneratedMediaProjectionsForAiChatThread(threadId)
                },
                setTimer: (callback, delay) => {
                    const timer = this.window.setTimeout(callback, delay)
                    return () => this.window.clearTimeout(timer)
                },
                now: Date.now,
                reportError: (error, threadId) => console.error('[CANVAS] Conversation refresh failed:', { threadId, error }),
            })
            this.canvasGenerationSubmission = new CanvasGenerationSubmission({
                readScope: () =>
                    this.currentCanvasState && this.workspaceId
                        ? {
                            workspaceId: this.workspaceId,
                            organizationId: String(this.host.workspace.organizationId() ?? ''),
                            sceneKey: this.canvasRuntime.scene.scene.sceneKey,
                            contextNodeIds: this.aiChatPanelState.contextChips,
                        }
                        : null,
                createId: this.host.createId,
                now: Date.now,
                createConversation: request => this.host.assets.create({ ...request, primaryCategory: 'conversation' }),
                activate: threadId => this.detachedAiChatThreadEditors.activate(threadId),
                cancel: this.teardownDetachedCanvasRun,
                install: request => {
                    const thread: AiChatThread = { ...request.thread, status: request.thread.status === 'none' ? 'idle' : request.thread.status }
                    this.currentAiChatThreads = this.currentAiChatThreads.some(existing => existing.threadId === thread.threadId)
                        ? this.currentAiChatThreads.map(existing => existing.threadId === thread.threadId ? thread : existing)
                        : [...this.currentAiChatThreads, thread]
                    this.createDetachedCanvasThreadEditor({ ...request, thread })

                    this.submitPersistedDetachedCanvasThreadMessage(thread.threadId)
                },
                reportError: error => console.error('[CANVAS-RUN] failed to submit detached canvas generation request', error),
            })
            this.mediaAnalysis = new WorkspaceMediaAnalysis({
                readScope: () => ({ workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey }),
                readNode: this.getCurrentCanvasMediaNode,
                describe: this.host.generation.describeMedia,
                patchDescriptor: (assetId, descriptor, title) => {
                    const asset = this.host.assets.read(assetId)
                    if (asset) this.host.assets.upsert({ ...asset, ...(title ? { title } : {}), descriptor })
                },
                refreshAsset: (assetId, capturedWorkspaceId) => this.host.assets.refresh(assetId, capturedWorkspaceId),
                loadWorkspaceAssets: async capturedWorkspaceId => {
                    await this.host.assets.loadWorkspaceAssets(capturedWorkspaceId)
                },
                refreshVideo: node => {
                    this.canvasMediaLayer?.retryAssetTextures(new Set([node.assetId]))
                    this.syncCanvasMediaLayer(this.currentCanvasState)
                    this.appendCanvasNodeToDOM(node)
                },
                refreshChrome: this.scheduleGeneratedMediaChromeSync,
                refreshMarkers: this.syncBranchMarkerNodeContents,
                refreshContext: this.refreshContextChipTray,
                setTimer: (callback, delayMs) => {
                    const timer = this.window.setTimeout(callback, delayMs)
                    return () => this.window.clearTimeout(timer)
                },
                now: Date.now,
                reportError: error => console.error('[CANVAS] Media analysis or Asset refresh failed:', error),
            })
            this.outputReview = new WorkspaceOutputReview({
                readScope: () => ({ workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey }),
                readCanvasState: () => this.currentCanvasState,
                readAsset: assetId => this.host.assets.read(assetId),
                readProvenance: assetId => this.host.assets.readDocument(assetId, 'provenance')?.doc,
                readMediaHistory: this.getGeneratedMediaHistoryContent,
                readArtifactReplay: node => this.host.capabilities.frontend.require(node.artifactTypeId).buildReplaySubmitData({ provenance: this.getCapabilityArtifactProvenance(node) }),
                readPrompt: this.getGeneratedOutputUserMessageText,
                findNode: this.findCanvasNodeById,
                review: request => this.host.assets.reviewGeneratedOutput(request),
                refreshAsset: async (assetId, capturedWorkspaceId) => {
                    const result = await this.host.assets.refresh(assetId, capturedWorkspaceId)
                    return 'error' in result ? result : {}
                },
                applyGeometry: this.applyApiCanvasGeometry,
                removeContextChips: this.removeLocalContextChips,
                refreshChrome: this.scheduleGeneratedMediaChromeSync,
                refreshMarkers: this.syncBranchMarkerNodeContents,
                submit: this.submitCanvasGenerationRun,
                reportError: (message, detail) => console.error(message, detail),
            })
            this.projectionOverrides = this.liveNodeOverrides.createScope()
            this.projectionSceneKey = this.canvasRuntime.scene.scene.sceneKey
            this.callbacks.own(this.canvasRuntime.scene.subscribeScene(scene => {
                if (this.rendererDestroyed || scene.sceneKey === this.projectionSceneKey) return
                this.generationPlacements.clear()
                this.mediaAnalysis.clear()
                this.outputReview.clear()
                this.conversationProjection.clear()
                this.detachedAiChatThreadEditors.clear()
                this.mediaOperationRecovery.clear()
                this.canvasGenerationSubmission.clear()
                this.projectionSceneKey = scene.sceneKey
                this.projectionOverrides.destroy()
                this.projectionOverrides = this.liveNodeOverrides.createScope()
            }))
            this.viewportEl = this.canvasMediaLayer.worldElement as HTMLDivElement
            this.selectionOverlay = this.canvasRuntime.installSelectionOverlay({
                marquee: { borderColor: this.selectionStyles.marqueeBorderColor, backgroundColor: this.selectionStyles.marqueeBackgroundColor, radius: 8 },
                onGroupPointerDown: event => {
                    if (!this.shouldShowSelectionGroupOverlay()) return
                    const primaryNodeId = Array.from(this.selection.nodeIds)[0]
                    if (primaryNodeId) this.handleDragStart(event, primaryNodeId)
                },
            })
            this.marquee = this.canvasRuntime.installMarquee({
                lock: () => this.panZoom?.lock({ selection: true }) ?? (() => {}),
                onStart: () => {
                    this.connectionManager?.cancelTransientConnection()
                    this.clearSelectedEdgeSelection(true)
                    this.selectionOverlay.setGroup(null)
                    if (this.selection.nodeIds.size > 0) this.setSelectedNodes(new Set())
                },
                onChange: bounds => {
                    this.updateSelectionRectElement()
                    const selectedIds = this.getSelectableNodeIdsInRect(bounds)
                    this.setSelectedNodes(new Set(selectedIds), true)
                    this.nodeGestures.suppressPaneClick()
                },
                onEnd: moved => {
                    this.hideSelectionRectElement()
                    this.connectionManager?.cancelTransientConnection()
                    this.updateSelectionGroupOverlayElement()
                    if (moved && this.selection.fromMarquee) this.addContextChips(this.selection.nodeIds)
                },
                onCancel: () => {
                    this.clearMarqueeInteractionState()
                    this.connectionManager?.cancelTransientConnection()
                },
            })
            this.workspaceLoadingOutline = createWorkspaceLoadingOutline({
                paneEl: this.paneEl,
                settings: this.host.settings,
                onRetry: () => {
                    const targetWorkspaceId = this.workspaceId
                    if (!targetWorkspaceId) return
                    this.workspaceLoadingOutline?.setErrorMessage(null)
                    void this.host.workspace.reload(targetWorkspaceId)
                },
            })
            this.videoChrome = new WorkspaceVideoChrome({
                document: this.paneEl.ownerDocument,
                settings: this.host.settings.videoControls,
                getVideo: nodeId => this.canvasMediaLayer?.playback.getVideoElement(nodeId),
                getBounds: node => this.canvasMediaLayer?.getNodeBounds(node.nodeId) ?? { ...this.getNodeWorldPosition(node), ...node.dimensions },
                getViewport: this.getLiveViewport,
                getResizeSettings: () => ({
                    ...this.host.settings.mediaNode.resizeHandle,
                    useZoomCompensatedScaling: this.host.settings.mediaNode.useZoomCompensatedResizeHandleScaling,
                }),
                startDrag: (event, nodeId) => this.handleDragStart(event, nodeId),
                startResize: this.handleResizeStart,
                togglePlayback: nodeId => {
                    void this.canvasMediaLayer?.playback.toggle(nodeId)
                },
            })
            this.mediaChromeViewportEl = this.videoChrome.element
            this.paneEl.appendChild(this.mediaChromeViewportEl)
            this.outputChrome = new WorkspaceOutputChrome({
                document: this.paneEl.ownerDocument,
                settings: this.host.settings.mediaNode.generatedMediaChrome,
                getState: () => this.currentCanvasState,
                getViewport: this.getLiveViewport,
                getBounds: (node, nodesById) => ({ ...this.getNodeWorldPosition(node, nodesById), ...(this.liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions) }),
                getPendingBounds: (nodeId, bounds) => {
                    const circle = this.getPendingGeneratedMediaBeforeFrameCircleGeometry(nodeId, bounds, bounds)
                    return circle ? { ...circle.position, ...circle.dimensions } : null
                },
                getPendingNodeIds: this.getPendingGeneratedMediaBeforeFirstFrameNodeIds,
                getAsset: assetId => this.host.assets.read(assetId),
                getDocumentVersion: (assetId, role) => this.host.assets.readDocument(assetId, role)?.version,
                getDescriptor: this.getAssetDescriptor,
                getTraceStatus: node => this.getMediaGenerationTraceState(node)?.status,
                isProgressActive: this.isGeneratedOutputProgressActive,
                isSelected: nodeId => this.generatedOutputDetailsTargetsMatch(this.aiChatPanelState.generatedOutputDetailsTarget, { kind: 'output', nodeId }),
                getVideo: nodeId => this.canvasMediaLayer?.playback.getVideoElement(nodeId),
                video: this.videoChrome,
                createModelBadge: options => this.host.models.createBadge(options),
                mountTitle: (node, host) => this.canvasAssetViews.mountMetadata(node, host, 'node'),
                queueAnalysis: node => this.queueCanvasMediaAnalysis(node.nodeId, this.getMediaDescriptorStillAssetId(node)),
                onOpenDetails: nodeId => this.openGeneratedOutputDetails({ kind: 'output', nodeId }, { toggle: true }),
                onAccept: nodeId => {
                    void this.acceptGeneratedOutput('output-node', nodeId)
                },
                onReject: nodeId => {
                    void this.deleteCanvasNodes(new Set([nodeId]))
                },
                onRegenerate: node => {
                    void this.regenerateGeneratedOutputs({ scope: 'output-node', mode: 'existing-prompt', targetNodeId: node.nodeId, outputNodes: [node] })
                },
                requestFrame: callback => this.window.requestAnimationFrame(callback),
                cancelFrame: handle => this.window.cancelAnimationFrame(handle),
                onError: error => console.error('[CANVAS][generated-media-chrome]', error),
                onSync: event => {
                    if (this.debugLoggingEnabled) console.info('[CANVAS][generated-media-chrome]', event.rebuilt ? 'sync-rebuild' : 'sync-skip-same-key', event)
                },
            })
            this.paneEl.append(this.outputChrome.element, this.outputChrome.pendingElement)
            this.viewportBridge = createViewportBridge({
                viewportEl: this.viewportEl,
                viewportOverlayEls: [this.mediaChromeViewportEl],
                targets: () => [this.canvasMediaLayer],
            })
            if (this.currentCanvasState?.viewport) {
                this.viewportBridge.applyViewport(this.currentCanvasState.viewport)
            }
            this.createGlobalCanvasComposer()
            // Canvas bubble menu for image nodes (delete, create variant)
            this.canvasBubbleMenu = null
            // In-place confirmation for canvas actions (e.g. saving an image to the Media Library).
            // Auto-dismisses via a single CSS animation, removed on animationend.
            this.canvasToastEl = null
            this.nodeGestures = new WorkspaceNodeGestures({
                pane: this.paneEl,
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readState: () => this.currentCanvasState,
                runtime: this.canvasRuntime,
                findElement: nodeId => this.viewportEl?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`) ?? null,
                media: () => this.canvasMediaLayer,
                connections: () => this.connectionManager,
                geometry: this.workspaceGeometry,
                collisionSettings: this.host.settings.workspaceCollision.dragRelease,
                selectedNodeIds: () => this.selection.nodeIds,
                isSelected: this.isNodeSelected,
                select: this.selectNode,
                toggleSelection: this.toggleNodeSelection,
                bringToFront: element => this.nodeLayerManager.bringToFront(element),
                lockPan: () => this.panZoom?.lock() ?? (() => {}),
                getViewport: this.getLiveViewport,
                updateChromeTransform: this.updateGeneratedMediaChromeLiveTransform,
                updateChromeLayout: this.updateGeneratedMediaChromeLayout,
                scheduleEdges: this.scheduleEdgesRender,
                cancelEdges: this.cancelScheduledEdgesRender,
                repositionMenu: this.repositionCanvasBubbleMenu,
                updateSelectionOverlay: this.updateSelectionGroupOverlayElement,
                getSelectionBounds: this.getSelectionOverlayBounds,
                shouldFillSelectionBounds: this.shouldFillSelectionOverlayBounds,
                syncNodeGeometry: this.syncCanvasNodeDomGeometry,
                syncMedia: this.syncCanvasMediaLayer,
                rememberManualMarker: (node, dimensions) => {
                    this.projectionOverrides.set(node.nodeId, { position: node.position, dimensions })
                    this.branchMarkerProjectionOverrideNodeIds.add(node.nodeId)
                    this.manuallyPositionedBranchMarkerNodeIds.add(node.nodeId)
                },
                commit: this.commitCanvasState,
                setTimer: (callback, delay) => {
                    const timer = this.window.setTimeout(callback, delay)
                    return () => this.window.clearTimeout(timer)
                },
            })
            this.nodeDeletion = new WorkspaceNodeDeletion({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readState: () => this.currentCanvasState,
                getAsset: assetId => this.host.assets.read(assetId),
                clearSelection: () => this.setSelectedNodes(new Set()),
                resolveTree: this.resolveGeneratedMediaTreeState,
                rejectOutput: this.rejectGeneratedOutput,
                getRequest: this.host.generation.get,
                cancelRequest: this.host.generation.cancel,
                removeOperation: this.removeOperationStatusNodeInternal,
                detachAsset: this.onAssetDetach,
                commitTransient: this.commitTransientCanvasStatePreservingEditors,
                commit: this.commitCanvasState,
                removeContextChips: this.removeLocalContextChips,
                reportError: (message, detail) => console.error(message, detail),
                warn: (message, detail) => console.warn(message, detail),
            })
            this.rightPanel = new WorkspaceRightPanel({
                pane: this.paneEl,
                widthHost: this.paneEl.closest<HTMLElement>('.workspace-canvas') ?? this.paneEl,
                settings: this.host.settings.rightSidePanel,
                switchSettings: this.host.settings.aiChatThread.panelSwitch,
                cssProperties: this.getWorkspaceRightPanelCssProperties(),
                getState: () => this.aiChatPanelState,
                onWidthChange: width => {
                    this.aiChatPanelState = { ...this.aiChatPanelState, width }
                    this.persistAiChatSidebarState()
                },
                onModeChange: topLevelMode => {
                    this.aiChatPanelState = { ...this.aiChatPanelState, topLevelMode }
                    this.persistAiChatSidebarState()
                },
                onOpenChange: open => {
                    if (open) this.openAiChatPanel()
                    else void this.closeAiChatPanel()
                },
                mountContent: this.mountWorkspaceRightPanelContent,
                acquirePanLock: () => this.panZoom?.lock() ?? (() => {}),
                requestFrame: callback => this.window.requestAnimationFrame(callback),
                cancelFrame: handle => this.window.cancelAnimationFrame(handle),
                setTimer: (callback, delay) => this.window.setTimeout(callback, delay),
                clearTimer: handle => this.window.clearTimeout(handle),
                onError: error => console.error('[CANVAS][right-panel]', error),
            })
            this.pendingGeneratedImagePlacements = this.generationPlacements.placements
            this.pendingBranchMarkers = this.generationPlacements.markers
            // Explicit branch-marker UI phase, driven by media pipeline events instead of
            // ProseMirror receiving flags. ProseMirror's isReceivingAnimation stays true for
            // the whole media workflow, so it cannot distinguish "visible assistant text is
            // streaming" from "text is done but the media placeholder has not appeared yet".
            // Keyed by marker nodeId so the phase survives incoming workspace-state
            // replacements that drop the marker's transient pendingState.
            this.branchMarkerUiPhaseByNodeId = this.generationPlacements.phases
            this.generationHandlers = new WorkspaceGenerationHandlers(this.generationEvents, {
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                readThreads: () => this.currentAiChatThreads,
                placements: this.generationPlacements,
                trackers: this.mediaTrackers,
                settlement: this.generationSettlement,
                handoff: this.markerHandoff,
                lineage: this.lineageProjection,
                geometry: this.workspaceGeometry,
                apiGeometry: this.apiCanvasGeometry,
                recovery: this.mediaOperationRecovery,
                analysis: this.mediaAnalysis,
                visuals: this.generationVisuals,
                refreshAsset: async (assetId, sourceWorkspaceId) => {
                    const refreshed = await this.host.assets.refresh(assetId, sourceWorkspaceId)
                    if ('error' in refreshed) throw new Error(`GENERATED_ASSET_REFRESH_FAILED:${refreshed.error}`)
                },
                reloadWorkspace: this.host.workspace.reload,
                applyCapabilityRunEventToBranchMarkers: this.applyCapabilityRunEventToBranchMarkers,
                handleWorkspaceContextResolution: this.handleWorkspaceContextResolution,
                setGeneratingReferenceNodeIds: this.setGeneratingReferenceNodeIds,
                clearGeneratingReferenceNodeIds: this.clearGeneratingReferenceNodeIds,
                clearGeneratingReferencesAfterPromptHandoff: this.clearGeneratingReferencesAfterPromptHandoff,
                clearGeneratingReferencesOnFirstPixels: this.clearGeneratingReferencesOnFirstPixels,
                settleDetachedCanvasRun: this.settleDetachedCanvasRun,
                scheduleDetachedCanvasRunTeardown: this.scheduleDetachedCanvasRunTeardown,
                applyMediaOperationRecoveryResult: this.applyMediaOperationRecoveryResult,
                syncGeneratingMediaNodes: this.syncGeneratingMediaNodes,
                syncCanvasMediaLayer: this.syncCanvasMediaLayer,
                syncCanvasNodeDomGeometry: this.syncCanvasNodeDomGeometry,
                setTransientImageSource: (nodeId, source) => this.canvasMediaLayer?.setTransientImageSource(nodeId, source),
                renderNow: () => this.canvasMediaLayer?.renderNow(),
                removeSelection: nodeId => this.selection.remove(nodeId),
                rebalanceGeneratedMediaTrees: this.rebalanceGeneratedMediaTrees,
                commitTransientCanvasStatePreservingEditors: this.commitTransientCanvasStatePreservingEditors,
                appendCanvasNodeToDOM: this.appendCanvasNodeToDOM,
                appendBranchMarkerNodeToDOM: this.appendBranchMarkerNodeToDOM,
                hasNodeElement: nodeId => Boolean(this.viewportEl.querySelector(`[data-node-id="${nodeId}"]`)),
                debugLoggingEnabled: this.debugLoggingEnabled,
                debugGeneratedMediaLifecycle: this.debugGeneratedMediaLifecycle,
                log: (level, ...details) => console[level](...details),
            })
            // Re-clamp the product panel when its available pane size changes.
            this.resizeObserver = new ResizeObserver(() => {
                this.paneRect = this.paneEl.getBoundingClientRect()
                // The max width depends on pane width, so re-clamp through the SidePanel.
                // It re-emits the clamped width, which reflectRightSidePanelWidth applies.
                this.rightPanel.applyConstraints()
            })
            this.resizeObserver.observe(this.paneEl)
            // Guards viewport reporting during startup. Until the persisted viewport
            // has been applied (initializePanZoom or the first render pass), any
            // pan/zoom event is spurious — e.g. a 1px scroll nudge from side-panel
            // chrome mounting — and reporting it would persist a default viewport
            // over the stored one.
            this.persistedViewportApplied = false
            this.panZoomConfig = {
                ...defaultPanZoomConfig((transform) => {
                    const zoomChanged = transform[2] !== this.lastTransform[2]
                    const vp: Viewport = { x: transform[0], y: transform[1], zoom: transform[2] }
                    this.syncViewportInteractionState(vp)
                    if (this.persistedViewportApplied) this.updateCurrentCanvasViewport(vp)
                    this.viewportBridge?.applyViewport(vp)
                    this.updateGeneratedMediaChromeLayout()
                    if (zoomChanged) {
                        this.updateBranchMarkerReviewControlsZoom(vp.zoom)
                        if (this.host.settings.mediaNode.useZoomCompensatedResizeHandleScaling) {
                            this.pendingHandleZoom = vp.zoom
                        }
                        if (this.host.settings.connector.useZoomCompensatedScaling) {
                            const hasPreFrameConnectorBounds = this.getPendingGeneratedMediaBeforeFirstFrameNodeIds().size > 0
                            if (hasPreFrameConnectorBounds && this.connectionManager && this.currentCanvasState) {
                                this.canvasMediaLayer?.sync(this.currentCanvasState)
                                this.connectionManager.render()
                                this.canvasMediaLayer?.renderNow()
                            } else {
                                // Recompute and flush the connector canvas in the same turn as the DOM
                                // viewport transform. If the pan/zoom callback runs inside a rAF, waiting
                                // for PIXI's scheduled rAF lets the browser paint one frame where nodes
                                // have moved but connectors still show the previous canvas bitmap.
                                const connectorsRecomputed = this.connectionManager?.recomputeConnectorGeometry(vp.zoom) ?? false
                                if (connectorsRecomputed) this.canvasMediaLayer?.renderNow()
                            }
                            this.scheduleEdgesRender()
                        }
                    }
                    // Defer all layout-forcing DOM work to a separate frame
                    this.scheduleTransformSideEffects()
                    if (this.persistedViewportApplied) this.onViewportChange?.(vp)
                }),
                ...this.options.panZoomConfig,
            }
            // Every generated output hanging off the marker, regardless of kind. Branch
            // marker chrome must never vary by what was generated.
            this.lastNodeStructureKey = getNodeStructureKey(this.currentCanvasState)
            this.lastVisualSyncKey = getCanvasVisualSyncKey(this.currentCanvasState)
            this.lastDocumentsKey = this.getDocumentsKey(this.currentDocuments)
            this.lastThreadsKey = this.getAiChatThreadsKey(this.currentAiChatThreads)
            this.unlockCanvasScrollLayers = lockCanvasScrollLayers([this.paneEl, this.viewportEl, this.paneEl.parentElement])
            this.paneEl.addEventListener('pointerdown', this.handlePanePointerDown, true)
            this.paneEl.addEventListener('mousemove', this.handlePaneMouseMove, true)
            this.paneEl.addEventListener('mouseleave', this.handlePaneMouseLeave)
            this.paneEl.addEventListener('mousedown', this.handlePaneMouseDown, true)
            this.paneEl.addEventListener('click', this.handlePaneClick)
            this.canvasRuntime.installKeyboard({
                onEscape: () => {
                    this.clearSelectedEdgeSelection(true)
                    this.selectNode(null)
                },
                onDelete: () => {
                    if (this.selection.nodeIds.size > 0) {
                        void this.deleteCanvasNodes(new Set(this.selection.nodeIds))
                        return true
                    }
                    if (!this.selectedEdgeId) return false
                    this.connectionManager?.deleteSelectedEdge()
                    this.hideEdgeBubbleMenu()
                    return true
                },
            })
            const releaseCommands = this.host.onOpenCapabilityLibrary?.(targetWorkspaceId => {
                if (this.rendererDestroyed || targetWorkspaceId && targetWorkspaceId !== this.workspaceId) return
                this.openRightSidePanelToMode('capabilities')
            })
            if (releaseCommands) this.callbacks.own(releaseCommands)
            this.initializePanZoom()
            this.initCanvasBubbleMenu()
            this.syncActiveAiChatPanelFromState()
            if (!this.aiChatPanelState.isOpen) this.ensureActiveRightSidePanel()
            // Create the connection manager up front so connector edges render even when
            // the canvas mounts empty. renderNodes() only calls ensureConnectionManager()
            // after an early-return guard on currentCanvasState, so a workspace that starts
            // with no nodes (e.g. the first branch from the canvas-wide composer) would
            // otherwise never get a connection manager — edges get committed to state but
            // never drawn until a reload runs renderNodes() with a non-null state.
            this.ensureConnectionManager()
            this.renderNodes()
            this.reattachDetachedCanvasRunListenersForActiveMarkers()
            this.syncCanvasMediaLayer(this.currentCanvasState)
            if (this.initialStaleMediaAnalysisReset && this.currentCanvasState) {
                this.initialStaleMediaAnalysisReset = false
                this.pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(this.currentCanvasState)
                this.onCanvasStateChange?.(this.currentCanvasState)
            }
            this.hasObservedInitialAiModelsStore = false
            this.unsubscribeAiModelsStore = this.host.models.subscribe(() => {
                if (this.rendererDestroyed) return
                if (!this.hasObservedInitialAiModelsStore) {
                    this.hasObservedInitialAiModelsStore = true
                    return
                }
                this.scheduleGeneratedMediaChromeSync()
                this.syncBranchMarkerNodeContents()
            })
            this.observedAssetRevisions = new Map<string, number>()
            this.hasObservedInitialAssetsStore = false
            this.unsubscribeAssetsStore = this.host.assets.subscribe(({ items }) => {
                if (this.rendererDestroyed) return
                const nextAssetRevisions = new Map(Array.from(items, ([assetId, asset]) => [assetId, asset.revision]))
                if (!this.hasObservedInitialAssetsStore) {
                    this.hasObservedInitialAssetsStore = true
                    this.observedAssetRevisions = nextAssetRevisions
                    return
                }
                const changedAssetIds = new Set<string>()
                for (const [assetId, revision] of nextAssetRevisions) {
                    if (this.observedAssetRevisions.get(assetId) !== revision) changedAssetIds.add(assetId)
                }
                this.observedAssetRevisions = nextAssetRevisions
                this.canvasMediaLayer?.refreshAssets(changedAssetIds)
                if (changedAssetIds.size > 0) this.syncCanvasMediaLayer(this.currentCanvasState)
                this.scheduleGeneratedMediaChromeSync()
                this.syncBranchMarkerNodeContents()
                const detailsNode = this.resolveGeneratedOutputDetailsNode(this.aiChatPanelState.generatedOutputDetailsTarget)
                const detailsAssetId = detailsNode
                    ? this.isBranchMarkerNode(detailsNode) ? detailsNode.conversationAssetId : detailsNode.assetId
                    : null
                if (detailsAssetId && changedAssetIds.has(detailsAssetId) && this.rightPanel.element) {
                    this.renderActiveAiChatPanel({ preserveModeSwitch: true, animateOpen: false })
                }
            })
            this.unsubscribeWorkspaceStore = this.host.workspace.subscribe(({ loadingStatus, error }) => {
                if (this.rendererDestroyed) return
                this.lastWorkspaceLoadingStatus = loadingStatus
                if (loadingStatus === LoadingStatus.error) {
                    this.workspaceLoadingOutline?.setVisible(false)
                    this.workspaceLoadingOutline?.setErrorMessage(this.getWorkspaceLoadErrorMessage(error))
                } else if (loadingStatus === LoadingStatus.loading) {
                    this.workspaceLoadingOutline?.setErrorMessage(null)
                }
            })
        } catch (error) {
            try {
                this.destroy()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Workspace canvas construction failed')
            }
            throw error
        }
    }

    private handlePaneClick = (event: MouseEvent): void => {
        if (this.rendererDestroyed || this.nodeGestures.consumePaneClick()) return
        if (this.isCanvasBackgroundTarget(event.target)) {
            this.clearNodeSelection()
            this.clearSelectedEdgeSelection(true)
        }
    }

    private getBranchMarkerContentDimensions = (promptText: string, options: BranchMarkerDimensionOptions = {}): { width: number; height: number } => {
        return estimateBranchMarkerDimensions(promptText, { responseLine: options.responseLine, responseText: options.responseText })
    }

    private getBranchMarkerNodeDimensions = (
        node: BranchMarkerNode,
        options: { responseLine?: boolean } = {},
    ): { width: number; height: number } => {
        return this.getBranchMarkerContentDimensions(
            getBranchMarkerPromptText(node),
            options,
        )
    }

    private getExpectedBranchMarkerDimensions = (node: CanvasNode): { width: number; height: number } | undefined => {
        if (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine') {
            if (node.dimensions?.width > 0 && node.dimensions?.height > 0) return undefined
            return this.getBranchMarkerNodeDimensions(node)
        }
        return undefined
    }

    private resizeBranchMarkerNodeToDimensions = <T extends BranchMarkerNode>(
        node: T,
        dimensions: { width: number; height: number },
    ): T => {
        return resizeBranchMarkerToDimensions(node, dimensions)
    }

    private normalizeBranchMarkerDimensions = (canvasState: CanvasState): CanvasState => {
        let changed = false
        const nodes = canvasState.nodes.map((node: CanvasNode): CanvasNode => {
            const dimensions = this.getExpectedBranchMarkerDimensions(node)
            if (!dimensions) return node
            if (node.dimensions.width === dimensions.width && node.dimensions.height === dimensions.height) return node

            changed = true
            return this.resizeBranchMarkerNodeToDimensions(node as BranchMarkerNode, dimensions) as CanvasNode
        })
        return changed ? { ...canvasState, nodes } : canvasState
    }

    private resetStaleAnalyzingMediaDescriptors = (canvasState: CanvasState): { state: CanvasState; changed: boolean } => {
        return { state: canvasState, changed: false }
    }

    private normalizeBranchMarkerModelValue = (value: string | null | undefined): string => {
        return String(value ?? '').trim().toLowerCase()
    }

    private splitBranchMarkerModelId = (modelId: string): { provider: string; model: string } => {
        const separatorIndex = modelId.indexOf(':')
        if (separatorIndex < 0) return { provider: '', model: modelId }
        return {
            provider: modelId.slice(0, separatorIndex),
            model: modelId.slice(separatorIndex + 1),
        }
    }

    private findBranchMarkerModelMeta = (modelId: string, modelProvider: string): BranchMarkerModelCatalogEntry | null => {
        const { provider, model } = this.splitBranchMarkerModelId(modelId)
        const normalizedProvider = this.normalizeBranchMarkerModelValue(provider || modelProvider)
        const normalizedModel = this.normalizeBranchMarkerModelValue(model)
        const normalizedModelId = this.normalizeBranchMarkerModelValue(modelId)
        const models = (this.host.models.read() ?? []) as BranchMarkerModelCatalogEntry[]

        return models.find((candidate) => {
            const candidateProvider = this.normalizeBranchMarkerModelValue(candidate.provider)
            const candidateModel = this.normalizeBranchMarkerModelValue(candidate.model)
            const candidateModelId = this.normalizeBranchMarkerModelValue(`${candidate.provider ?? ''}:${candidate.model ?? ''}`)

            if (normalizedProvider) {
                return candidateProvider === normalizedProvider && candidateModel === normalizedModel
            }

            return candidateModel === normalizedModel || candidateModelId === normalizedModelId
        }) ?? null
    }

    private getBranchMarkerModelEntry = (modelId: string, modelProvider = ''): BranchMarkerModelEntry | null => {
        if (!modelId) return null
        const modelIdParts = this.splitBranchMarkerModelId(modelId)
        const providerKey = modelProvider || modelIdParts.provider
        const meta = this.findBranchMarkerModelMeta(modelId, providerKey)
        const title = meta?.shortTitle ?? meta?.title ?? modelIdParts.model ?? modelId
        const icon = this.host.models.modelIcon(meta?.iconName)
            ?? this.host.models.providerIcon(meta?.provider)
            ?? this.host.models.providerIcon(providerKey)
        return title ? { title, icon, color: normalizeHexColor(meta?.color) } : null
    }

    private uniqueBranchMarkerModelEntries = (entries: BranchMarkerModelEntry[]): BranchMarkerModelEntry[] => {
        const seen = new Set<string>()
        const uniqueEntries: BranchMarkerModelEntry[] = []
        for (const entry of entries) {
            const key = `${entry.title}:${entry.icon ?? ''}:${entry.color ?? ''}`
            if (seen.has(key)) continue
            seen.add(key)
            uniqueEntries.push(entry)
        }
        return uniqueEntries
    }

    private createBranchMarkerModelDetail = (label: string, descriptors: BranchMarkerModelDescriptor[]): BranchMarkerModelDetail | null => {
        const entries = this.uniqueBranchMarkerModelEntries(
            descriptors
                .map(descriptor => this.getBranchMarkerModelEntry(descriptor.modelId, descriptor.modelProvider ?? ''))
                .filter((entry): entry is BranchMarkerModelEntry => Boolean(entry)),
        )
        return entries.length > 0 ? { label, entries } : null
    }

    private getWorkspaceRightPanelCssProperties = (): Record<`--${string}`, string> => {
        const contextPreviewStyles = this.host.settings.aiChatThread.contextPreview.styles
        return {
            '--ai-chat-thread-node-box-shadow': this.host.settings.aiChatThread.styles.nodeBoxShadow,
            '--ai-chat-thread-node-border': this.host.settings.aiChatThread.styles.nodeBorder,
            '--workspace-ai-chat-panel-divider-border': this.host.settings.aiChatThread.styles.panelSectionDividerBorder,
            '--workspace-ai-chat-panel-context-controls-color': contextPreviewStyles.controlsColor,
            '--workspace-ai-chat-panel-context-chip-background': contextPreviewStyles.chipBackground,
            '--context-preview-trigger-border-radius': contextPreviewStyles.triggerBorderRadius,
            '--context-preview-border-radius': contextPreviewStyles.previewBorderRadius,
            '--context-preview-tooltip-background': contextPreviewStyles.tooltipBackground,
            '--context-preview-tooltip-border': contextPreviewStyles.tooltipBorder,
            '--context-preview-tooltip-border-radius': contextPreviewStyles.tooltipBorderRadius,
            '--context-preview-tooltip-box-shadow': contextPreviewStyles.tooltipBoxShadow,
            '--context-preview-tooltip-color': contextPreviewStyles.tooltipColor,
            '--context-preview-video-background': contextPreviewStyles.videoBackground,
            '--context-preview-video-glyph-background': contextPreviewStyles.videoGlyphBackground,
            '--context-preview-video-glyph-color': contextPreviewStyles.videoGlyphColor,
            '--context-preview-document-color': contextPreviewStyles.documentColor,
            '--context-preview-document-skeleton-line-border-radius': contextPreviewStyles.documentSkeletonLineBorderRadius,
            '--context-preview-document-skeleton-line-background': contextPreviewStyles.documentSkeletonLineBackground,
            '--context-preview-document-icon-color': contextPreviewStyles.documentIconColor,
            '--context-preview-document-text-color': contextPreviewStyles.documentTextColor,
            '--context-preview-popover-title-color': contextPreviewStyles.popoverTitleColor,
            '--context-preview-popover-text-color': contextPreviewStyles.popoverTextColor,
            '--workspace-ai-chat-panel-context-chip-remove-background': contextPreviewStyles.removeButtonBackground,
            '--workspace-ai-chat-panel-context-chip-remove-color': contextPreviewStyles.removeButtonColor,
            '--workspace-ai-chat-panel-context-chip-remove-box-shadow': contextPreviewStyles.removeButtonBoxShadow,
        }
    }

    private isWorkspaceCanvasDebugEnabled = (): boolean => this.host.debugEnabled()

    private isCurrentScene = (originWorkspaceId: string, originSceneKey: string): boolean => {
        return !this.rendererDestroyed && this.workspaceId === originWorkspaceId && this.canvasRuntime.scene.scene.sceneKey === originSceneKey
    }

    private downloadMedia = async (assetId: string, rendition: string, attachment: boolean): Promise<void> => {
        if (this.rendererDestroyed) return
        try {
            await this.host.media.download({ assetId, rendition, attachment, document: this.paneEl.ownerDocument, signal: this.callbacks.signal })
        } catch (error) {
            if (!this.rendererDestroyed) console.error('Canvas download failed:', error)
        }
    }

    private chooseMediaReplacement = (nodeId: string): void => {
        if (this.rendererDestroyed) return
        const node = this.findCanvasNodeById(nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) return
        const workspaceId = this.workspaceId
        const sceneKey = this.canvasRuntime.scene.scene.sceneKey
        const pending = this.callbacks.child()
        const accept = node.type === 'video' ? 'video/mp4' : 'image/*'
        const input = this.html`<input type="file" accept=${accept} style=${{ display: 'none' }}></input>` as HTMLInputElement
        const current = () => !pending.signal.aborted && this.isCurrentScene(workspaceId, sceneKey)
        const changed = () => {
            const file = input.files?.[0]
            input.remove()
            if (!file || !file.type.startsWith(node.type === 'video' ? 'video/' : 'image/') || !current()) {
                pending.destroy()
                return
            }
            void this.replaceMediaFile(node, file, workspaceId, current, pending)
        }
        const cancelled = () => pending.destroy()
        pending.own(() => input.remove())
        input.addEventListener('change', changed, { once: true })
        input.addEventListener('cancel', cancelled, { once: true })
        pending.own(() => input.removeEventListener('change', changed))
        pending.own(() => input.removeEventListener('cancel', cancelled))
        try {
            this.paneEl.ownerDocument.body.append(input)
            input.click()
        } catch (error) {
            pending.destroy()
            throw error
        }
    }

    private replaceMediaFile = async (node: ImageCanvasNode | VideoCanvasNode, file: File, workspaceId: string, current: () => boolean, pending: Lifetime): Promise<void> => {
        try {
            const nodeStillCurrent = () => current() && this.currentCanvasState?.nodes.some(candidate => candidate.nodeId === node.nodeId && 'assetId' in candidate && candidate.assetId === node.assetId) === true
            const uploaded = await this.host.media.uploadReplacement({ workspaceId, file, signal: pending.signal, isCurrent: nodeStillCurrent })
            if (!uploaded?.assetId || uploaded.kind !== node.type || !nodeStillCurrent() || !this.currentCanvasState || !this.onAssetDetach || !this.onAssetAttach) return
            const originalState = this.currentCanvasState
            const detachedState: CanvasState = {
                ...originalState,
                nodes: originalState.nodes.filter(candidate => candidate.nodeId !== node.nodeId),
                edges: originalState.edges.filter(edge => edge.sourceNodeId !== node.nodeId && edge.targetNodeId !== node.nodeId),
            }
            const committedDetachedState = await this.onAssetDetach({ assetId: node.assetId, nodeId: node.nodeId, removedNodeIds: [node.nodeId], canvasState: detachedState })
            if (!current()) return
            this.commitTransientCanvasStatePreservingEditors(committedDetachedState)
            if (!current()) return
            const attachedState: CanvasState = {
                ...committedDetachedState,
                nodes: [...committedDetachedState.nodes, { ...node, assetId: uploaded.assetId }],
                edges: originalState.edges,
            }
            const committedAttachedState = await this.onAssetAttach({ assetId: uploaded.assetId, nodeId: node.nodeId, canvasState: attachedState })
            if (current()) this.commitTransientCanvasStatePreservingEditors(committedAttachedState)
        } catch (error) {
            if (current()) console.error('Canvas media replacement failed:', error)
        } finally {
            pending.destroy()
        }
    }

    private initCanvasBubbleMenu = () => {
        const actions: WorkspaceCanvasMenuPorts['actions'] = {
            onDeleteEdge: (edgeId) => {
                if (!this.connectionManager) return
                this.connectionManager.selectEdge(edgeId)
                this.connectionManager.deleteSelectedEdge()
            },
            onChangeConnectorCurve: (edgeId) => {
                if (!this.currentCanvasState) return

                const edgeIndex = this.currentCanvasState.edges.findIndex((e: WorkspaceEdge) => e.edgeId === edgeId)
                if (edgeIndex === -1) return

                const edge = this.currentCanvasState.edges[edgeIndex]
                const currentCurve = edge.pathType ?? this.host.settings.connector.lineCurve
                const newCurve = currentCurve === 'horizontal-bezier' ? 'orthogonal' : 'horizontal-bezier'

                const updatedEdge: WorkspaceEdge = { ...edge, pathType: newCurve }
                const newEdges = [...this.currentCanvasState.edges]
                newEdges[edgeIndex] = updatedEdge

                this.commitCanvasState({
                    ...this.currentCanvasState,
                    edges: newEdges,
                })
            },
            onDeleteNode: (nodeId) => {
                void this.deleteCanvasNodes(new Set([nodeId]))
            },
            onDownloadMedia: nodeId => {
                const node = this.findCanvasNodeById(nodeId)
                if (!node || !('assetId' in node) || !node.assetId) return
                if (!['mediaDocument', 'audio', 'image', 'video'].includes(node.type)) return
                void this.downloadMedia(node.assetId, node.type === 'video' ? 'preview' : 'original', node.type === 'mediaDocument' || node.type === 'audio')
            },
            onReplaceMedia: nodeId => this.chooseMediaReplacement(nodeId),
            onOpenAsset: (nodeId) => {
                const node = this.currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId) as CanvasNode & { assetId?: string } | undefined
                if (!node?.assetId) return
                this.openRightSidePanelToMode('media')
                this.ensureMediaLibraryPanel().showAsset(node.assetId)
            },
            onTriggerConnection: (nodeId) => {
                if (!this.connectionManager) return

                this.connectionManager.startConnectionFromMenu(nodeId)
            },
        }

        this.canvasBubbleMenu = new WorkspaceCanvasMenu({
            pane: this.paneEl,
            viewport: this.viewportEl,
            getNode: this.findCanvasNodeById,
            getEdgeRect: edgeId => this.connectionManager?.getEdgeMidpointRect(edgeId) ?? null,
            actions,
            getVisualScale: () =>
                scaleCanvasChromeToScreenForZoom(
                    1,
                    this.getCurrentViewportZoom(),
                    getAdaptiveBoundedZoomScalingOptions(this.host.settings.canvasBubbleMenu.zoomScaling),
                ),
        })
    }

    private removeLocalContextChips = (removedNodeIds: readonly string[]): void => {
        if (removedNodeIds.length === 0) return
        const removedNodeIdSet = new Set(removedNodeIds)
        const contextChips = this.aiChatPanelState.contextChips.filter((nodeId) => !removedNodeIdSet.has(nodeId))
        if (contextChips.length === this.aiChatPanelState.contextChips.length) return
        this.aiChatPanelState = { ...this.aiChatPanelState, contextChips }
        if (this.currentCanvasState) this.currentCanvasState = setAiChatPanelState(this.currentCanvasState, this.aiChatPanelState)
        this.refreshContextChipTray()
    }

    private deleteCanvasNodes = async (nodeIds: ReadonlySet<string>): Promise<void> => {
        await this.nodeDeletion.deleteCanvasNodes(nodeIds)
    }

    private isModSelectionEvent = (event: MouseEvent): boolean => {
        return event.metaKey || event.ctrlKey
    }

    private getSingleSelectedNodeId = (): string | null => {
        return this.selection.singleNodeId
    }

    private isNodeSelected = (nodeId: string): boolean => {
        return this.selection.has(nodeId)
    }

    private getForegroundNodeHit = (point: { x: number; y: number }): CanvasNode | null => {
        if (!this.currentCanvasState) return null
        const nodesById = this.getCanvasNodesById(this.currentCanvasState.nodes)
        for (let i = this.currentCanvasState.nodes.length - 1; i >= 0; i--) {
            const node = this.currentCanvasState.nodes[i]
            if (node.type !== 'image' && node.type !== 'video' && node.type !== 'document' && node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine') continue
            const worldPosition = this.getNodeWorldPosition(node, nodesById)
            const pendingCircleGeometry = this.getPendingGeneratedMediaBeforeFrameCircleGeometry(
                node.nodeId,
                worldPosition,
                node.dimensions,
            )
            const rect = pendingCircleGeometry
                ? {
                    x: pendingCircleGeometry.position.x,
                    y: pendingCircleGeometry.position.y,
                    width: pendingCircleGeometry.dimensions.width,
                    height: pendingCircleGeometry.dimensions.height,
                }
                : this.getNodeWorldRect(node, nodesById)
            if (rectangleContainsPoint(rect, point)) return node
        }
        return null
    }

    private getCanvasNodesById = (nodes: CanvasNode[] = this.currentCanvasState?.nodes ?? []): Map<string, CanvasNode> => {
        return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
    }

    private getNodeWorldPosition = (
        node: CanvasNode,
        nodesById: Map<string, CanvasNode> = this.getCanvasNodesById(),
    ): { x: number; y: number } => {
        return this.liveNodeOverrides.worldPosition(node, nodesById)
    }

    private getNodeWorldRect = (node: CanvasNode, nodesById: Map<string, CanvasNode> = this.getCanvasNodesById()): Rect => {
        return this.liveNodeOverrides.worldBounds(node, nodesById)
    }

    private syncCanvasNodeDomGeometry = (nodes: CanvasNode[]): void => {
        if (!this.viewportEl) return

        const nodesById = this.getCanvasNodesById(this.currentCanvasState?.nodes ?? nodes)
        for (const node of nodes) {
            const position = this.getNodeWorldPosition(node, nodesById)
            const dimensions = this.liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            const nodeEl = this.viewportEl.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
            this.canvasMediaLayer?.setNodeLiveTransform(node.nodeId, position, dimensions)
            if (nodeEl) {
                this.updatePendingGeneratedMediaBeforeFrameClass(nodeEl, node.nodeId)
            }
            this.updateGeneratedMediaChromeLiveTransform(node.nodeId, position, dimensions, this.getLiveViewport())
        }

        this.updateSelectionGroupOverlayElement()
        this.repositionCanvasBubbleMenu()
    }

    private findBranchMarkerNodeEl = (nodeId: string): HTMLElement | null => {
        return this.viewportEl.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
    }

    private findBranchMarkerNodeElForNode = (node: BranchMarkerNode): HTMLElement | null => {
        return this.findBranchMarkerNodeEl(node.nodeId)
    }

    private updateGeneratedMediaChromeLiveTransform = (
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
    ): void => {
        this.outputChrome.update(nodeId, { ...position, ...dimensions }, viewport)
    }

    private updateGeneratedMediaChromeLayout = (viewport: Viewport = this.getLiveViewport()): void => {
        this.outputChrome.layout(viewport)
    }

    private getMediaGenerationTraceState = (
        node: ImageCanvasNode | VideoCanvasNode,
    ): MediaGenerationProgressState | null => {
        return this.workspaceHistory.getMediaGenerationTraceState(node)
    }

    private buildBranchMarkerTurnProjectionContent = (
        marker: BranchMarkerNode,
        lineageProjectionScope: AiLineageProjectionScope,
    ): { threadId: string; content: ProseMirrorJsonNode } | null => {
        return this.workspaceHistory.buildBranchMarkerTurnProjectionContent(marker, lineageProjectionScope)
    }

    private mountBranchMarkerChatProjection = ({ mount, marker, lineageProjectionScope, signal }: {
        mount: HTMLElement
        marker: BranchMarkerNode
        lineageProjectionScope: AiLineageProjectionScope
        signal: AbortSignal
    }): WorkspaceHistoryView | null => {
        const projection = this.buildBranchMarkerTurnProjectionContent(marker, lineageProjectionScope)
        return projection ? new WorkspaceGenerationHistory({ host: mount, projection, signal }, this.getGenerationHistoryPorts()) : null
    }

    private getGenerationHistoryPorts = (): WorkspaceGenerationHistoryPorts => {
        return {
            getNode: this.findCanvasNodeById,
            getContextEnvironment: this.getContextPreviewEnvironment,
            renditionPath: this.host.media.renditionPath,
            getMediaContent: this.getGeneratedMediaHistoryContent,
            getProgress: this.getMediaGenerationTraceState,
            createReasoningBadge: modelId => this.host.models.createBadge({ modelId, monochromeIcon: true }),
            styleReasoningHeader: header => this.host.models.styleBadge(header, { scale: this.host.settings.mediaNode.generatedMediaChrome.chatScale }),
            progressDetails: this.getExecutionTraceTimelineDetail(),
            onError: error => console.error('[CANVAS][generation-history]', error),
            mountEditor: request =>
                this.editors.mountHistory({
                    ...request,
                    contextPreview: this.getAiUserMessageContextPreviewRenderer({ inlinePopover: true }),
                    promptReferencePreviewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }),
                }),
        }
    }

    private getAssetDescriptor = (node: ImageCanvasNode | VideoCanvasNode): MediaDescriptor | undefined => {
        return this.host.assets.read(node.assetId)?.descriptor as MediaDescriptor | undefined
    }

    private createAssetViewPorts = (): WorkspaceAssetDetailsPorts => {
        return {
            document: this.paneEl.ownerDocument,
            workspaceId: this.workspaceId,
            userId: this.host.workspace.userId(),
            tooltipHideDelayMs: this.host.settings.helpTooltip.interactiveHideDelayMs,
            getAsset: assetId => this.host.assets.read(assetId),
            getContentDocument: assetId => {
                const snapshot = this.host.assets.readDocument(assetId, 'content')
                return snapshot ? { doc: snapshot.doc as ProseMirrorJsonNode, version: snapshot.version } : undefined
            },
            mountEditor: this.editors.mountAsset,
            updateMetadata: async (assetId, revision, patch) => {
                const updated = await this.host.assets.updateMetadata(assetId, revision, patch)
                if (!('error' in updated)) this.host.assets.upsert(updated)
                return updated
            },
            changeScope: async (assetId, revision, scope, ownerId) => {
                const updated = await this.host.assets.changeScope(assetId, revision, scope, ownerId)
                if (!('error' in updated)) this.host.assets.upsert(updated)
                return updated
            },
            attestSubjectIdentity: async (assetId, revision, classification) => {
                const updated = await this.host.assets.attestSubjectIdentity(assetId, revision, classification)
                if (!('error' in updated)) this.host.assets.upsert(updated)
                return updated
            },
            onChanged: () => {
                this.resetGeneratedMediaChromeSyncKey()
                this.scheduleGeneratedMediaChromeSync()
            },
            onError: error => console.error('Canvas Asset update failed:', error),
        }
    }

    private generatedOutputDetailsTargetsMatch = (
        left: CanvasGeneratedOutputDetailsTarget | undefined,
        right: CanvasGeneratedOutputDetailsTarget,
    ): boolean => {
        return left?.kind === right.kind && left.nodeId === right.nodeId
    }

    private openGeneratedOutputDetails = (
        target: CanvasGeneratedOutputDetailsTarget,
        options: { toggle?: boolean } = {},
    ): void => {
        if (options.toggle && this.generatedOutputDetailsTargetsMatch(this.aiChatPanelState.generatedOutputDetailsTarget, target)) {
            this.closeGeneratedOutputDetails()
            return
        }
        this.aiChatPanelState = {
            ...this.aiChatPanelState,
            isOpen: true,
            topLevelMode: 'aiThreads',
            generatedOutputDetailsTarget: target,
        }
        this.persistAiChatSidebarState()
        this.syncGeneratedOutputNodeFooters(this.currentCanvasState)
        this.renderActiveAiChatPanel()
    }

    private closeGeneratedOutputDetails = (): void => {
        const { generatedOutputDetailsTarget: _removedTarget, ...panelState } = this.aiChatPanelState
        this.aiChatPanelState = panelState
        this.persistAiChatSidebarState()
        this.syncGeneratedOutputNodeFooters(this.currentCanvasState)
        this.renderActiveAiChatPanel()
    }

    private getGeneratedOutputUserMessageText = (node: GeneratedOutputCanvasNode): string => {
        return this.workspaceHistory.getGeneratedOutputUserMessageText(node)
    }

    private isGeneratedOutputAccepted = (node: GeneratedOutputCanvasNode): boolean => {
        return this.outputReview.isGeneratedOutputAccepted(node)
    }

    private isGeneratedOutputReviewReady = (node: GeneratedOutputCanvasNode): boolean => {
        return this.outputReview.isGeneratedOutputReviewReady(node)
    }

    private acceptGeneratedOutput = async (scope: 'output-node' | 'branch-lineage', nodeId: string): Promise<void> => {
        await this.outputReview.acceptGeneratedOutput(scope, nodeId)
    }

    private rejectGeneratedOutput = async (scope: 'output-node' | 'branch-lineage', nodeId: string): Promise<'applied' | 'not-found' | 'failed'> => {
        return await this.outputReview.rejectGeneratedOutput(scope, nodeId)
    }

    private regenerateGeneratedOutputs = async (request: GeneratedOutputRegenerationRequest): Promise<void> => {
        await this.outputReview.regenerateGeneratedOutputs(request)
    }

    private isGeneratedOutputProgressActive = (node: GeneratedOutputCanvasNode): boolean => {
        if (node.type === 'capabilityArtifact') {
            const generatedBy = node.generatedBy
            if (!generatedBy) return false
            const status = this.capabilityProgressRuns
                .get(generatedBy.conversationAssetId)
                ?.get(generatedBy.capabilityRunId)
                ?.status
            return status === 'pending' || status === 'running'
        }
        const traceState = this.getMediaGenerationTraceState(node)
        return traceState?.status === 'pending'
            || traceState?.status === 'running'
            || traceState?.status === 'awaiting-provider-verification'
    }

    private getCapabilityArtifactProvenance = (node: CapabilityArtifactCanvasNode): Record<string, any> => {
        const document = this.host.assets.readDocument(node.assetId, 'provenance')?.doc
        const text = document ? this.host.extractText(document) : ''
        if (text) {
            try {
                const parsed = JSON.parse(text)
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
            } catch {
                // Fall through to sealed canvas metadata when an older provenance
                // document is not JSON-encoded.
            }
        }
        return {
            input: node.generatedBy?.input ?? {},
            variant: { reasoningModelId: node.generatedBy?.reasoningModelId ?? '' },
        }
    }

    private buildCapabilityArtifactTurnProjectionContent = (
        node: CapabilityArtifactCanvasNode,
    ): { threadId: string; content: ProseMirrorJsonNode; lineageProjectionScope: AiLineageProjectionScope } | null => {
        return this.workspaceHistory.buildCapabilityArtifactTurnProjectionContent(node)
    }

    private mountCapabilityArtifactHistory = (
        mount: HTMLElement,
        node: CapabilityArtifactCanvasNode,
        signal: AbortSignal,
    ): WorkspaceHistoryView | null => {
        const projection = this.buildCapabilityArtifactTurnProjectionContent(node)
        if (!projection) return null
        return new WorkspaceGenerationHistory({ host: mount, projection, signal }, this.getGenerationHistoryPorts())
    }

    private destroyGeneratedMediaChromeControls = (): void => {
        try {
            this.outputChrome.clear()
        } finally {
            this.canvasAssetViews.clear()
        }
    }

    private destroyMediaGenerationProgressInstance = (instanceKey: string): void => {
        this.mediaGenerationProgressInstances.get(instanceKey)?.destroy()
        this.mediaGenerationProgressInstances.delete(instanceKey)
    }

    private resetGeneratedMediaChromeSyncKey = (): void => {
        this.outputChrome.invalidate()
    }

    private destroyActiveAiChatPanelProjection = (): void => {
        const cleanup = new Lifetime()
        const details = this.activeOutputDetails
        const panel = this.activeGeneratedOutputDetailsPanel
        this.activeOutputDetails = null
        this.activeGeneratedOutputDetailsPanel = null
        if (panel) cleanup.own(() => panel.destroy())
        if (details) cleanup.own(() => details.destroy())
        cleanup.destroy()
    }

    private destroyBranchMarkerContent = (nodeId: string): void => {
        const content = this.branchMarkerContentLifetimes.get(nodeId)
        const actions = this.branchMarkerActions.get(nodeId)
        this.branchMarkerContentLifetimes.delete(nodeId)
        this.branchMarkerActions.delete(nodeId)
        const cleanup = new Lifetime()
        cleanup.own(() => actions?.destroy())
        cleanup.own(() => content?.destroy())
        cleanup.destroy()
    }

    private destroyBranchMarkerContents = (): void => {
        const cleanup = new Lifetime()
        for (const nodeId of new Set([...this.branchMarkerContentLifetimes.keys(), ...this.branchMarkerActions.keys()])) {
            cleanup.own(() => this.destroyBranchMarkerContent(nodeId))
        }
        cleanup.destroy()
    }

    private scheduleGeneratedMediaChromeSync = (): void => {
        this.outputChrome.schedule()
    }

    private syncGeneratedOutputNodeFooters = (canvasState: CanvasState | null): void => {
        this.outputChrome.updateState(canvasState)
    }

    private syncLiveMediaGenerationProgressInstancesForState = (canvasState: CanvasState): void => {
        this.syncGeneratedOutputNodeFooters(canvasState)
        this.activeOutputDetails?.sync(canvasState)
    }

    private syncGeneratedMediaChrome = (canvasState: CanvasState | null = this.currentCanvasState): void => {
        this.outputChrome.sync(canvasState)
    }

    private syncGeneratingMediaNodes = (canvasState: CanvasState | null = this.currentCanvasState): void => {
        this.generationVisuals.sync(canvasState)
    }

    private clearFinalizingGeneratedImageOutline = (nodeId: string): void => {
        this.generationVisuals.clearCompletion(nodeId)
    }

    private getPendingGeneratedMediaBeforeFirstFrameNodeIds = (): Set<string> => {
        return this.generationVisuals.pendingNodeIds()
    }

    private isGeneratedMediaCanvasNodeWaitingForFrame = (node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode => {
        return this.generationVisuals.isWaitingForFrame(node)
    }

    private isPendingGeneratedMediaBeforeFirstFrame = (nodeId: string): boolean => {
        return this.generationVisuals.isPending(nodeId)
    }

    private updatePendingGeneratedMediaBeforeFrameClass = (nodeEl: HTMLElement, nodeId: string): void => {
        this.generationVisuals.updateHitArea(nodeEl, nodeId)
    }

    private syncCanvasMediaLayer = (canvasState: CanvasState | null = this.currentCanvasState): void => {
        this.syncGeneratingMediaNodes(canvasState)
        this.canvasMediaLayer?.sync(canvasState)
        this.syncGeneratedMediaChrome(canvasState)
    }

    private fitImageDimensionsToAspectRatio = (
        dimensions: { width: number; height: number },
        aspectRatio: number,
    ): { width: number; height: number } => {
        return fitDimensionsToAspectRatio(dimensions, aspectRatio)
    }

    private handleVideoIntrinsicSize = (size: { nodeId: string; width: number; height: number }): void => {
        if (!this.currentCanvasState) return
        if (this.nodeGestures.draggingNodeId === size.nodeId || this.nodeGestures.resizingNodeId === size.nodeId) return
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return

        const intrinsicAspectRatio = size.width / size.height
        if (!Number.isFinite(intrinsicAspectRatio) || intrinsicAspectRatio <= 0) return

        const videoNode = this.currentCanvasState.nodes.find(
            (node: CanvasNode): node is VideoCanvasNode => node.type === 'video' && node.nodeId === size.nodeId,
        )
        if (!videoNode) return

        const fittedDimensions = this.fitImageDimensionsToAspectRatio(videoNode.dimensions, intrinsicAspectRatio)
        const previousAspectRatio = 'aspectRatio' in videoNode && typeof videoNode.aspectRatio === 'number' ? videoNode.aspectRatio : 0
        const aspectChanged = Math.abs(previousAspectRatio - intrinsicAspectRatio) > 0.001
        const widthChanged = Math.abs(videoNode.dimensions.width - fittedDimensions.width) > 0.5
        const heightChanged = Math.abs(videoNode.dimensions.height - fittedDimensions.height) > 0.5
        if (!aspectChanged && !widthChanged && !heightChanged) return

        const nodesById = this.getCanvasNodesById(this.currentCanvasState.nodes)
        const worldPosition = this.getNodeWorldPosition(videoNode, nodesById)
        const nextWorldPosition = {
            x: worldPosition.x + (videoNode.dimensions.width - fittedDimensions.width) / 2,
            y: worldPosition.y + (videoNode.dimensions.height - fittedDimensions.height) / 2,
        }
        const nextPosition = videoNode.parentId
            ? this.toParentRelativePosition(nextWorldPosition, videoNode.parentId, nodesById)
            : nextWorldPosition

        const updatedNodes = this.currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== videoNode.nodeId) return node
            return {
                ...videoNode,
                aspectRatio: intrinsicAspectRatio,
                position: nextPosition,
                dimensions: fittedDimensions,
            }
        })

        const resolvedNodes = this.isGeneratedMediaNode(videoNode)
            ? this.rebalanceGeneratedMediaTrees(updatedNodes, this.currentCanvasState.edges)
            : updatedNodes

        this.commitCanvasState({ ...this.currentCanvasState, nodes: resolvedNodes })
    }

    private handleImageIntrinsicSize = (size: {
        nodeId: string
        width: number
        height: number
        preserveNodeGeometry?: boolean
    }): void => {
        if (!this.currentCanvasState) {
            this.clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
            this.clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }

        const intrinsicAspectRatio = size.width / size.height
        if (!Number.isFinite(intrinsicAspectRatio) || intrinsicAspectRatio <= 0) {
            this.clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }

        const imageNode = this.currentCanvasState.nodes.find(
            (node: CanvasNode): node is ImageCanvasNode => node.type === 'image' && node.nodeId === size.nodeId,
        )
        if (!imageNode) {
            this.clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }
        this.generationVisuals.markFrameDecoded(size.nodeId)
        this.clearFinalizingGeneratedImageOutline(size.nodeId)
        if (size.preserveNodeGeometry) return
        if (this.nodeGestures.draggingNodeId === size.nodeId || this.nodeGestures.resizingNodeId === size.nodeId) return

        const fittedDimensions = this.fitImageDimensionsToAspectRatio(imageNode.dimensions, intrinsicAspectRatio)
        const previousAspectRatio = 'aspectRatio' in imageNode && typeof imageNode.aspectRatio === 'number' ? imageNode.aspectRatio : 0
        const aspectChanged = Math.abs(previousAspectRatio - intrinsicAspectRatio) > 0.001
        const widthChanged = Math.abs(imageNode.dimensions.width - fittedDimensions.width) > 0.5
        const heightChanged = Math.abs(imageNode.dimensions.height - fittedDimensions.height) > 0.5
        if (!aspectChanged && !widthChanged && !heightChanged) return

        const nodesById = this.getCanvasNodesById(this.currentCanvasState.nodes)
        const worldPosition = this.getNodeWorldPosition(imageNode, nodesById)
        const nextWorldPosition = {
            x: worldPosition.x + (imageNode.dimensions.width - fittedDimensions.width) / 2,
            y: worldPosition.y + (imageNode.dimensions.height - fittedDimensions.height) / 2,
        }
        const nextPosition = imageNode.parentId
            ? this.toParentRelativePosition(nextWorldPosition, imageNode.parentId, nodesById)
            : nextWorldPosition

        const updatedNodes = this.currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== imageNode.nodeId) return node
            return {
                ...imageNode,
                aspectRatio: intrinsicAspectRatio,
                position: nextPosition,
                dimensions: fittedDimensions,
            }
        })

        const resolvedNodes = this.isGeneratedMediaNode(imageNode)
            ? this.rebalanceGeneratedMediaTrees(updatedNodes, this.currentCanvasState.edges)
            : updatedNodes

        this.commitCanvasStatePreservingEditors({
            ...this.currentCanvasState,
            nodes: resolvedNodes,
        })
    }

    private toParentRelativePosition = (
        worldPosition: { x: number; y: number },
        parentId: string,
        nodesById: Map<string, CanvasNode>,
    ): { x: number; y: number } => {
        return this.workspaceGeometry.toParentRelativePosition(worldPosition, parentId, nodesById)
    }

    private getInsertionPaneSize = (): { width: number; height: number } => {
        const rect = this.paneRect ?? this.paneEl.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
    }

    private getCanvasVisibleAreaForApiProjection = (): { width: number; height: number } | undefined => {
        return this.workspaceGeometry.getCanvasVisibleAreaForApiProjection()
    }

    private getCenteredInsertionPosition = (dimensions: { width: number; height: number }): { x: number; y: number } => {
        return this.workspaceGeometry.getCenteredInsertionPosition(dimensions)
    }

    private getCanvasNodeCollisionRect = (
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ): Rect => {
        return this.workspaceGeometry.getCanvasNodeCollisionRect(node, worldPosition)
    }

    private resolveTopLevelNodeCollisions = (nodes: CanvasNode[]): CanvasNode[] => {
        return this.workspaceGeometry.resolveTopLevelNodeCollisions(nodes)
    }

    private clearStartedBranchMarkerProjectionOverrides = (startedMarkerNodeIds: Iterable<string>): void => {
        for (const markerId of startedMarkerNodeIds) {
            this.projectionOverrides.delete(markerId)
            this.branchMarkerProjectionOverrideNodeIds.delete(markerId)
            this.manuallyPositionedBranchMarkerNodeIds.delete(markerId)
        }
    }

    private createGeneratedMediaRebalancePipeline = (): GeneratedMediaRebalancePipeline => {
        return this.workspaceGeometry.createGeneratedMediaRebalancePipeline()
    }

    private rebalanceGeneratedMediaTrees = (nodes: CanvasNode[], edges: WorkspaceEdge[]): CanvasNode[] => {
        const result = this.createGeneratedMediaRebalancePipeline().rebalance(nodes, edges)
        this.clearStartedBranchMarkerProjectionOverrides(result.startedMarkerNodeIds)
        return result.nodes
    }

    private getPendingGeneratedMediaBeforeFrameCircleGeometry = (
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): CanvasGeometry | null => {
        return this.workspaceGeometry.getPendingGeneratedMediaBeforeFrameCircleGeometry(nodeId, position, dimensions)
    }

    private getPendingGeneratedMediaBeforeFrameCircleInset = (dimensions: { width: number; height: number }): { x: number; y: number; size: number } => {
        return this.workspaceGeometry.getPendingGeneratedMediaBeforeFrameCircleInset(dimensions)
    }

    private getPendingGeneratedMediaBeforeFrameVisualGeometry = (
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): CanvasGeometry | null => {
        const circleGeometry = this.getPendingGeneratedMediaBeforeFrameCircleGeometry(nodeId, position, dimensions)
        if (!circleGeometry) return null
        const animation = this.host.settings.mediaNode.inProgressOutlineAnimation
        const outlineStrokeScale = scaleCanvasChromeWorldSizeForZoom(
            1,
            this.getCurrentViewportZoom(),
            getAdaptiveBoundedZoomScalingOptions(animation.zoomScaling),
        )
        const outlineGap = Number.isFinite(animation.gap) ? Math.max(0, animation.gap) : 0
        const outlineWidth = Number.isFinite(animation.snakeWidth) ? Math.max(0, animation.snakeWidth) : 0
        const outlineOutset = (outlineGap + outlineWidth) * outlineStrokeScale
        return {
            position: {
                x: circleGeometry.position.x - outlineOutset,
                y: circleGeometry.position.y - outlineOutset,
            },
            dimensions: {
                width: circleGeometry.dimensions.width + outlineOutset * 2,
                height: circleGeometry.dimensions.height + outlineOutset * 2,
            },
        }
    }

    private shouldRenderOperationStatusNode = (node: OperationStatusCanvasNode): boolean => {
        if (isMediaGenerationReferenceResolutionOperation(node)) return false
        if (node.operation === 'media-generation' && node.status === 'failed') {
            const isSupersededByReadyOutput = (this.currentCanvasState?.nodes ?? []).some(candidate => (
                (candidate.type === 'image' || candidate.type === 'video')
                && candidate.mediaGenerationPhase === 'ready'
                && candidate.generatedBy?.generationRequestId === node.generationRequestId
                && isMediaGenerationOperationSupersededByOutput(node, {
                    nodeId: candidate.nodeId,
                    mediaRunId: candidate.generationProgress?.mediaRunId ?? candidate.generatedBy?.mediaRunId,
                })
            ))
            if (isSupersededByReadyOutput) return false
        }
        return node.operation !== 'media-generation' || node.status !== 'in-progress'
    }

    private shouldRenderCanvasNode = (node: CanvasNode): boolean => {
        return node.type !== 'operationStatus' || this.shouldRenderOperationStatusNode(node)
    }

    private getCanvasPointFromClient = (clientX: number, clientY: number): { x: number; y: number } => {
        return this.canvasRuntime.clientToWorld({ x: clientX, y: clientY })
    }

    private syncViewportInteractionState = (viewport: Viewport): void => {
        this.lastTransform = [viewport.x, viewport.y, viewport.zoom]
        this.paneRect = this.paneEl.getBoundingClientRect()
    }

    private updateCurrentCanvasViewport = (viewport: Viewport): void => {
        if (!this.currentCanvasState) return
        this.currentCanvasState = {
            ...this.currentCanvasState,
            viewport,
        }
        this.pendingLocalCanvasVisualCommit = updatePendingCanvasVisualCommitViewport(this.pendingLocalCanvasVisualCommit, viewport)
    }

    private getLiveViewport = (): Viewport => {
        return { x: this.lastTransform[0], y: this.lastTransform[1], zoom: this.lastTransform[2] }
    }

    private getSelectionBoundsForNode = (node: CanvasNode): Rect => {
        const override = this.liveNodeOverrides.get(node.nodeId)
        const position = override?.position ?? this.getNodeWorldPosition(node)
        const dimensions = override?.dimensions ?? node.dimensions

        const left = position.x
        const top = position.y
        const right = position.x + dimensions.width
        const bottom = position.y + dimensions.height

        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    private getSelectionOverlayBoundsForNode = (node: CanvasNode): Rect => {
        return this.getSelectionBoundsForNode(node)
    }

    private filterSelectableNodeIds = (nodeIds: Set<string>): Set<string> => {
        if (!this.currentCanvasState) return nodeIds
        const selectableNodeIds = new Set(this.currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId))
        return new Set(Array.from(nodeIds).filter((nodeId) => selectableNodeIds.has(nodeId)))
    }

    private getSelectableNodeIdsInRect = (rect: Rect): string[] => {
        return getIntersectingNodeIds(this.currentCanvasState?.nodes ?? [], rect, this.getSelectionBoundsForNode)
    }

    private shouldShowSelectionGroupOverlay = (): boolean => {
        if (!this.currentCanvasState || this.selection.nodeIds.size === 0) return false
        if (this.selection.nodeIds.size > 1) return true
        return this.selection.fromMarquee
    }

    private updateSelectionRectElement = (): void => {
        const rect = this.marquee.bounds
        this.canvasMediaLayer?.setMarqueeRect(rect)
        this.selectionOverlay.setMarquee(rect)
    }

    private hideSelectionRectElement = (): void => {
        this.canvasMediaLayer?.setMarqueeRect(null)
        this.selectionOverlay.setMarquee(null)
    }

    private clearMarqueeInteractionState = (): void => {
        this.marquee.cancel()
        this.hideSelectionRectElement()
        this.canvasMediaLayer?.setSelectionOverlayBounds(null)
        this.selectionOverlay.setGroup(null)
    }

    private getSelectionOverlayBounds = (): Rect | null => {
        if (!this.currentCanvasState || !this.shouldShowSelectionGroupOverlay()) return null
        if (this.marquee.active) return null

        const overlayNodeIds = new Set<string>()
        for (const nodeId of this.selection.nodeIds) {
            overlayNodeIds.add(nodeId)
        }

        const overlayNodes = this.currentCanvasState.nodes.filter((node: CanvasNode) => overlayNodeIds.has(node.nodeId))
        if (overlayNodes.length === 0) return null

        return unionRectangles(overlayNodes.map(this.getSelectionOverlayBoundsForNode), 16)
    }

    private shouldUseSelectionGroupOverlayHitTarget = (): boolean => {
        if (!this.currentCanvasState || !this.shouldShowSelectionGroupOverlay()) return false
        return this.selection.nodeIds.size > 0
    }

    private shouldFillSelectionOverlayBounds = (): boolean => {
        return Boolean(this.currentCanvasState)
    }

    private updateSelectionGroupOverlayElement = (): void => {
        const bounds = this.getSelectionOverlayBounds()
        this.canvasMediaLayer?.setSelectionOverlayBounds(bounds, { fill: this.shouldFillSelectionOverlayBounds() })
        this.selectionOverlay.setGroup(this.shouldUseSelectionGroupOverlayHitTarget() ? bounds : null)
    }

    private updateNodeSelectionClasses = (prevSelectedNodeIds: ReadonlySet<string>, nextSelectedNodeIds: ReadonlySet<string>): void => {
        for (const nodeId of prevSelectedNodeIds) {
            if (nextSelectedNodeIds.has(nodeId)) continue
            const prevNode = this.viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
            prevNode?.classList.remove('is-selected')
        }

        for (const nodeId of nextSelectedNodeIds) {
            if (prevSelectedNodeIds.has(nodeId)) continue
            const nextNode = this.viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
            nextNode?.classList.add('is-selected')
            if (nextNode) this.nodeLayerManager.bringToFront(nextNode)
        }
    }

    private updateSelectionDrivenUi = (): void => {
        const singleSelectedNodeId = this.getSingleSelectedNodeId()

        if (!singleSelectedNodeId) {
            this.hideCanvasBubbleMenu()
            return
        }

        this.selectedEdgeId = null
        this.connectionManager?.deselect()
        this.hideEdgeBubbleMenu()
        this.showCanvasBubbleMenuForNode(singleSelectedNodeId)

        const node = this.currentCanvasState?.nodes.find((item: CanvasNode) => item.nodeId === singleSelectedNodeId)
        if (!node) {
            this.hideCanvasBubbleMenu()
            return
        }
    }

    private clearSelectedEdgeSelection = (force = false): void => {
        if (!force && !this.selectedEdgeId) return
        this.selectedEdgeId = null
        this.connectionManager?.deselect()
        this.hideEdgeBubbleMenu()
    }

    private setSelectedNodes = (nextSelectedNodeIds: Set<string>, fromMarquee = false): void => {
        this.reflectSelectionChange(this.selection.replace(this.filterSelectableNodeIds(nextSelectedNodeIds), fromMarquee))
    }

    private reflectSelectionChange = (prevSelectedNodeIds: ReadonlySet<string>): void => {
        if (this.selection.nodeIds.size > 0) this.clearSelectedEdgeSelection()
        this.updateNodeSelectionClasses(prevSelectedNodeIds, this.selection.nodeIds)
        this.updateSelectionGroupOverlayElement()
        this.updateSelectionDrivenUi()
        this.canvasMediaLayer?.setSelectedImageNodes(this.selection.nodeIds)
        this.scheduleEdgesRender()
    }

    private toggleNodeSelection = (nodeId: string): void => {
        this.reflectSelectionChange(this.selection.toggle(nodeId))
    }

    private clearNodeSelection = (): void => {
        if (this.selection.nodeIds.size === 0) {
            this.hideCanvasBubbleMenu()
            this.updateSelectionGroupOverlayElement()
            return
        }
        this.setSelectedNodes(new Set())
    }

    private isCanvasBackgroundTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Element)) return false
        if (!this.paneEl.contains(target)) return false
        if (this.selectionOverlay.contains(target)) return false

        return !target.closest([
            '[data-node-id]',
            '.workspace-ai-chat-floating-panel',
            '.workspace-canvas-global-composer-host',
            '.ai-prompt-input-floating',
            '.workspace-edge-node',
            '.workspace-handle',
            '.document-resize-handle',
            '.node-drag-overlay',
            '.bubble-menu',
            '.workspace-generated-media-chrome',
            '.workspace-video-controls-host',
        ].join(', '))
    }

    private showCanvasBubbleMenuForNode = (nodeId: string) => {
        this.canvasBubbleMenu?.showNode(nodeId)
    }

    private hideCanvasBubbleMenu = () => {
        this.canvasBubbleMenu?.hide()
    }

    private repositionCanvasBubbleMenu = () => {
        this.canvasBubbleMenu?.repositionNode(this.getSingleSelectedNodeId())
    }

    private showEdgeBubbleMenu = (edgeId: string) => {
        this.canvasBubbleMenu?.showEdge(edgeId)
    }

    private hideEdgeBubbleMenu = () => {
        this.canvasBubbleMenu?.hide()
    }

    private repositionEdgeBubbleMenu = () => {
        this.canvasBubbleMenu?.repositionEdge(this.selectedEdgeId)
    }

    private mountWorkspaceRightPanelContent = (host: HTMLElement, mode: CanvasRightSidePanelMode): () => void => {
        const lifetime = new Lifetime()
        try {
            if (mode === 'capabilities') {
                const library = this.ensureCapabilityLibraryPanel()
                lifetime.own(this.destroyCapabilityLibraryPanel)
                host.appendChild(library.element)
                void library.load()
            } else if (mode === 'artifacts') {
                const library = this.ensureArtifactLibraryPanel()
                lifetime.own(() => library.unmount())
                library.mountInto(host)
            } else if (mode === 'media') {
                const library = this.ensureMediaLibraryPanel()
                lifetime.own(() => library.unmount())
                library.mountInto(host)
            } else {
                lifetime.own(this.destroyActiveAiChatPanelProjection)
                const node = this.resolveGeneratedOutputDetailsNode(this.aiChatPanelState.generatedOutputDetailsTarget)
                if (node) {
                    this.activeGeneratedOutputDetailsPanel = createGeneratedOutputDetailsSidebar({
                        onClose: this.closeGeneratedOutputDetails,
                        renderContent: body => this.renderGeneratedOutputDetailsContent(body, node),
                    })
                    host.appendChild(this.activeGeneratedOutputDetailsPanel.element)
                } else {
                    host.appendChild(this.html`<div className="workspace-generated-output-details-empty nopan">Select a media item or lineage marker to view its details.</div>` as HTMLDivElement)
                }
            }
        } catch (error) {
            lifetime.destroy()
            throw error
        }
        return () => lifetime.destroy()
    }

    private ensureActiveRightSidePanel = (): void => {
        this.rightPanel.ensure()
    }

    private proseMirrorContentHasInProgressAiContent = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false
        const node = value as { attrs?: Record<string, unknown>; content?: unknown[] }
        const attrs = node.attrs ?? {}
        if (attrs.isReceivingAnimation || attrs.isStreaming || attrs.isPartial) return true
        return Boolean(node.content?.some(this.proseMirrorContentHasInProgressAiContent))
    }

    private aiChatThreadHasInProgressContent = (thread: AiChatThread | undefined): boolean => {
        return this.proseMirrorContentHasInProgressAiContent(thread?.content)
    }

    private aiChatThreadHasSubmittedUserMessage = (thread: AiChatThread | undefined): boolean => {
        if (!thread?.content) return false

        const userMessageCount = countProseMirrorNodesByType(thread.content, new Set(['aiUserMessage']))
        return userMessageCount > 0
    }

    private aiChatThreadHasRecoverableDetachedCanvasTurn = (thread: AiChatThread | undefined): boolean => {
        return this.aiChatThreadHasSubmittedUserMessage(thread) || this.aiChatThreadHasInProgressContent(thread)
    }

    private destroyActiveAiChatPanel = (destroySidePanel = false): void => {
        if (destroySidePanel) this.rightPanel.destroy()
        else this.rightPanel.clear()
        this.refreshContextChipTray()
    }

    private persistAiChatSidebarState = (): void => {
        if (!this.currentCanvasState) return

        const nextCanvasState = setAiChatPanelState(this.currentCanvasState, this.aiChatPanelState)
        if (JSON.stringify(this.currentCanvasState.aiChatPanel) === JSON.stringify(nextCanvasState.aiChatPanel)) return
        this.commitCanvasMetadataState(nextCanvasState)
    }

    private getContextPreviewEnvironment = (): ContextPreviewEnvironment => {
        return this.host.contextEnvironment({
            document: this.paneEl.ownerDocument,
            getDocuments: () => this.currentDocuments,
            getThreads: () => this.currentAiChatThreads,
            getAsset: (assetId: string) => this.host.assets.read(assetId),
        })
    }

    private getPromptReferencePreviewNode = (reference: MediaPromptReference): CanvasNode | undefined => {
        return this.referenceProjection.getPromptReferencePreviewNode(reference)
    }

    private getPromptReferencePreviewRenderer = (
        options: Pick<PromptReferencePreviewRenderer, 'inlinePopover' | 'preferredPlacement'> = {},
    ): PromptReferencePreviewRenderer => {
        return {
            getNode: this.getPromptReferencePreviewNode,
            environment: this.getContextPreviewEnvironment(),
            getCapabilityModule: async moduleId => (await this.getPromptReferenceCatalogClient().getModule(moduleId)).meta,
            capabilityModuleCache: this.capabilityModuleCache,
            ...options,
        }
    }

    private getExecutionTraceTimelineDetail = () => {
        return this.host.traceDetail({
            previewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }),
            inlinePopover: true,
            preferredPlacement: 'top',
        })
    }

    private createCapabilityArtifactAssetReferenceView = ({
        assetId,
        displayName,
        variant,
    }: {
        assetId: string
        displayName?: string
        variant: 'inline' | 'thumbnail'
    }) => {
        const asset = this.host.assets.read(assetId)
        const mediaKind = asset?.media?.kind
        if (!mediaKind) return undefined
        return createMediaPromptReferencePreview(
            {
                referenceType: 'media',
                assetId,
                mediaKind,
                displayName: asset.title.trim() || displayName?.trim() || assetId,
            },
            this.getPromptReferencePreviewRenderer({ inlinePopover: true }),
            {
                variant,
                preferredPlacement: 'top',
            },
        ) ?? undefined
    }

    private getAiUserMessageContextPreviewRenderer = (options: { inlinePopover?: boolean } = {}) => {
        return {
            getNodeById: (nodeId: string) => this.findCanvasNodeById(nodeId),
            environment: this.getContextPreviewEnvironment(),
            inlinePopover: options.inlinePopover,
        }
    }

    private createAiChatPanelContextTrayElement = (): HTMLDivElement => {
        return this.contextTrays.create('chat')
    }

    private createCanvasGlobalContextTrayElement = (): HTMLDivElement => {
        return this.contextTrays.create('canvas')
    }

    private addContextChips = (nodeIds: Iterable<string>): void => {
        if (!this.currentCanvasState) return
        const eligibleNodeIds = new Set(
            this.currentCanvasState.nodes
                .filter((node: CanvasNode) =>
                    node.type === 'image'
                    || node.type === 'video'
                    || node.type === 'document'
                    || node.type === 'capabilityArtifact'
                )
                .map((node) => node.nodeId),
        )
        const chipNodeIds = new Set(this.aiChatPanelState.contextChips)
        const nextChips = [...this.aiChatPanelState.contextChips]
        for (const nodeId of nodeIds) {
            if (!nodeId || chipNodeIds.has(nodeId) || !eligibleNodeIds.has(nodeId)) continue
            chipNodeIds.add(nodeId)
            nextChips.push(nodeId)
        }
        if (nextChips.length === this.aiChatPanelState.contextChips.length) return
        this.aiChatPanelState = { ...this.aiChatPanelState, contextChips: nextChips }
        this.persistAiChatSidebarState()
        this.refreshContextChipTray()
    }

    private removeContextChip = (nodeId: string): void => {
        if (!this.aiChatPanelState.contextChips.includes(nodeId)) return
        this.aiChatPanelState = {
            ...this.aiChatPanelState,
            contextChips: this.aiChatPanelState.contextChips.filter((id) => id !== nodeId),
        }
        this.persistAiChatSidebarState()
        this.refreshContextChipTray()
    }

    private clearExplicitContextChips = (): void => {
        if (this.aiChatPanelState.contextChips.length === 0) return
        this.aiChatPanelState = { ...this.aiChatPanelState, contextChips: [] }
        this.persistAiChatSidebarState()
        this.refreshContextChipTray()
    }

    private refreshContextChipTray = (): void => {
        this.contextTrays.refresh()
    }

    private syncActiveAiChatPanelFromState = (): void => {
        this.aiChatPanelState = getAiChatPanelState(this.currentCanvasState)
        this.rightPanel.syncState()
    }

    private openAiChatPanel = (): void => {
        this.syncActiveAiChatPanelFromState()
        this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: true }
        this.persistAiChatSidebarState()
        this.renderActiveAiChatPanel()
    }

    private closeAiChatPanel = async (): Promise<void> => {
        if (this.rightPanel.isClosing) return
        this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: false }
        const closing = this.rightPanel.close()
        this.persistAiChatSidebarState()
        await closing
    }

    private toggleAiChatPanelVisibility = (): void => {
        if (this.aiChatPanelState.isOpen) {
            void this.closeAiChatPanel()
        } else {
            this.openAiChatPanel()
        }
    }

    private getBranchMarkerMediaProjectionTarget = (marker: BranchMarkerNode): GeneratedMediaProjectionTarget | null => {
        return this.workspaceHistory.getBranchMarkerMediaProjectionTarget(marker)
    }

    private getMediaNodeBranchMarkerProjectionTarget = (
        node: ImageCanvasNode | VideoCanvasNode,
    ): BranchMarkerProjectionTarget | null => {
        return this.workspaceHistory.getMediaNodeBranchMarkerProjectionTarget(node)
    }

    private resolveGeneratedOutputDetailsNode = (
        target: CanvasGeneratedOutputDetailsTarget | undefined,
    ): GeneratedOutputCanvasNode | BranchMarkerNode | null => {
        return this.workspaceHistory.resolveGeneratedOutputDetailsNode(target)
    }

    private mountGeneratedMediaDetailsProjection = (
        mount: HTMLElement,
        target: GeneratedMediaProjectionTarget,
        onProgress: (progress: MediaGenerationProgressInstance) => void,
        signal: AbortSignal,
    ): WorkspaceHistoryView | null => {
        return mountWorkspaceMediaHistory({
            host: mount,
            node: target.node,
            lineageProjectionScope: target.lineageProjectionScope,
            limitToSelectedMedia: target.limitProjectionToSelectedMedia,
            onProgress,
            signal,
        }, this.getGenerationHistoryPorts())
    }

    private renderGeneratedOutputDetailsContent = (body: HTMLElement, node: GeneratedOutputCanvasNode | BranchMarkerNode): WorkspaceOutputDetails => {
        this.activeOutputDetails = new WorkspaceOutputDetails(body, node, {
            assets: this.createAssetViewPorts(),
            getDescriptor: this.getAssetDescriptor,
            getArtifactDefinition: typeId => this.host.capabilities.frontend.require(typeId),
            getArtifactDocument: assetId => this.host.assets.readDocument(assetId, 'capabilityArtifact')?.doc,
            getBranchMediaTarget: this.getBranchMarkerMediaProjectionTarget,
            getMediaBranchTarget: this.getMediaNodeBranchMarkerProjectionTarget,
            getProgress: this.getMediaGenerationTraceState,
            progressDetails: this.getExecutionTraceTimelineDetail(),
            now: () => performance.now(),
            mountMediaHistory: ({ host, target, onProgress, signal }) => this.mountGeneratedMediaDetailsProjection(host, target, onProgress, signal),
            mountBranchHistory: ({ host, target, signal }) =>
                this.mountBranchMarkerChatProjection({
                    mount: host,
                    marker: target.marker,
                    lineageProjectionScope: target.lineageProjectionScope,
                    signal,
                }),
            mountArtifactHistory: ({ host, node, signal }) => this.mountCapabilityArtifactHistory(host, node, signal),
        })
        return this.activeOutputDetails
    }

    private renderActiveAiChatPanel = (options: WorkspaceRightPanelRenderOptions = {}): void => {
        const target = this.aiChatPanelState.generatedOutputDetailsTarget
        if (target && !this.resolveGeneratedOutputDetailsNode(target)) {
            const { generatedOutputDetailsTarget: _removed, ...state } = this.aiChatPanelState
            this.aiChatPanelState = state
            this.persistAiChatSidebarState()
        }
        this.rightPanel.render(options)
    }

    private createGlobalCanvasComposer = (): void => {
        if (this.globalCanvasComposer) return
        this.globalCanvasComposer = new WorkspacePromptComposer({
            document: this.paneEl.ownerDocument,
            workspaceId: this.workspaceId,
            storage: this.host.storage,
            mountContextTray: () => {
                const element = this.createCanvasGlobalContextTrayElement()
                return { element, destroy: () => this.contextTrays.release(element) }
            },
            appearance: {
                popoverBoxShadow: this.host.settings.dropdown.styles.popoverBoxShadow,
                useShiftingGradientBackground: this.host.settings.aiPromptInput.useShiftingGradientBackground,
                gradientColors: this.host.settings.gradient.styles.shiftingColors,
            },
            mountEditor: this.editors.createPrompt({
                mountMediaModeSwitch: switchElement => this.options.mediaModeSwitchMountEl.replaceChildren(switchElement),
                mountModelMenuControl: controlElement => this.options.modelMenuControlMountEl.replaceChildren(controlElement),
                promptReferenceCatalog: this.getPromptReferenceCatalogClient(),
                promptReferencePreviewRenderer: this.getPromptReferencePreviewRenderer(),
            }),
            onSubmit: data => {
                void this.submitCanvasGenerationRun(data)
            },
        })
        this.paneEl.appendChild(this.globalCanvasComposer.element)
        this.canvasMediaLayer?.setGlassTargets([
            ...(this.options.glassTargets ?? []),
            { id: 'workspace-global-composer', element: this.globalCanvasComposer.input.element },
        ])
        this.refreshContextChipTray()
    }

    private teardownDetachedCanvasRun = (threadId: string): void => {
        this.detachedAiChatThreadEditors.teardown(threadId)
    }

    private failDetachedCanvasRun = (threadId: string): void => {
        this.detachedAiChatThreadEditors.settle(threadId)
        this.pendingGeneratedImagePlacements.delete(threadId)
        this.clearGeneratingReferenceNodeIds(threadId)
        this.removePendingBranchMarkerForRun(threadId)
        this.teardownDetachedCanvasRun(threadId)
    }

    private scheduleDetachedCanvasRunTeardown = (threadId: string): void => {
        this.detachedAiChatThreadEditors.defer(threadId, 1500)
    }

    private settleDetachedCanvasRun = (threadId: string): void => {
        this.detachedAiChatThreadEditors.settle(threadId)
    }

    private createDetachedCanvasThreadEditor = ({
        thread,
        submittedData,
        explicitContextNodeIds = [],
        excludedCanvasNodeIds = [],
        regeneration,
    }: {
        thread: AiChatThread
        submittedData?: AiPromptComposerSubmitData
        explicitContextNodeIds?: string[]
        excludedCanvasNodeIds?: string[]
        regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
    }): CanvasConversationRun => {
        const threadId = thread.threadId
        const runWorkspaceId = this.workspaceId
        return this.detachedAiChatThreadEditors.mount(threadId, scope =>
            new CanvasConversationRun(scope, {
                workspaceId: runWorkspaceId,
                thread,
                submittedData,
                explicitContextNodeIds,
                excludedCanvasNodeIds,
                regeneration,
            }, {
                mountEditor: this.editors.createConversation({
                    createContextTray: this.createAiChatPanelContextTrayElement,
                    promptReferencePreviewRenderer: this.getPromptReferencePreviewRenderer(),
                    contextPreview: this.getAiUserMessageContextPreviewRenderer(),
                }),
                connect: this.host.generation.connect,
                onSegment: (event, options) => this.generationEvents.route(event, options),
                context: this.generationContext,
                readCanvasState: () => this.currentCanvasState,
                getContextTitles: this.buildWorkspaceContextTitlesByNodeId,
                getVisibleArea: this.getCanvasVisibleAreaForApiProjection,
                createRequestId: () => `media-${this.host.createId()}`,
                now: () => Date.now(),
                publishContent: content => this.onAiChatThreadContentChange?.({ workspaceId: runWorkspaceId, threadId, content }),
                rememberContent: (id, content, streaming) => this.conversationProjection.rememberContent(id, content, streaming),
                refreshProjection: id => {
                    this.refreshBranchMarkersForAiChatThread(id)
                    this.refreshGeneratedMediaProjectionsForAiChatThread(id)
                },

                hasPendingPlacement: id => this.pendingGeneratedImagePlacements.has(id),
                deferTeardown: this.scheduleDetachedCanvasRunTeardown,
                preflight: (placement, data, regeneration) => {
                    this.pendingGeneratedImagePlacements.set(threadId, placement)
                    this.setGeneratingReferenceNodeIds(threadId, placement.referenceNodeIds)
                    if (regeneration?.mode === 'existing-prompt') {
                        this.branchMarkerUiPhaseByNodeId.set(regeneration.lineageParentNodeId, 'preflight')
                        this.syncBranchMarkerNodeContents()
                    } else {
                        this.insertPendingBranchMarkerForCanvasRun(threadId, placement.promptText, data)
                    }
                },
                clearContext: this.clearExplicitContextChips,
                fail: () => this.failDetachedCanvasRun(threadId),
                teardown: () => this.teardownDetachedCanvasRun(threadId),
                reportError: error => console.error('[CANVAS-RUN] detached canvas generation failed', error),
            }))
    }

    private getActiveDetachedCanvasRunThreadIds = (): string[] => {
        const threadIds = new Set<string>()
        const threadsById = new Map(this.currentAiChatThreads.map((thread) => [thread.threadId, thread]))
        if (this.currentCanvasState) {
            for (const node of this.currentCanvasState.nodes) {
                if (!this.isBranchMarkerNode(node)) continue
                const threadId = getBranchMarkerThreadId(node)
                if (!this.isDetachedCanvasThreadId(threadId)) continue
                if (this.detachedAiChatThreadEditors.isSettled(threadId)) continue
                const thread = threadsById.get(threadId)
                if (!thread) continue
                if (!this.isBranchMarkerGenerationActive(node) && !this.aiChatThreadHasInProgressContent(thread)) continue
                threadIds.add(threadId)
            }
        }

        for (const thread of this.currentAiChatThreads) {
            if (!this.isDetachedCanvasThreadId(thread.threadId)) continue
            if (this.detachedAiChatThreadEditors.isSettled(thread.threadId)) continue
            if (thread.workspaceId !== this.workspaceId) continue
            if (this.hasDetachedCanvasRunCanvasProjection(thread.threadId)) continue
            if (!this.isRecentDetachedCanvasThreadUpdate(thread)) continue
            if (!this.aiChatThreadHasRecoverableDetachedCanvasTurn(thread)) continue
            threadIds.add(thread.threadId)
        }
        return [...threadIds]
    }

    private reattachDetachedCanvasRunListenersForActiveMarkers = (): void => {
        this.restoreDetachedCanvasPreflightMarkersForActiveThreads()
        for (const threadId of this.getActiveDetachedCanvasRunThreadIds()) {
            if (this.detachedAiChatThreadEditors.isActive(threadId)) continue
            if (this.detachedAiChatThreadEditors.has(threadId)) continue
            const thread = this.getPersistedAiChatThread(threadId)
            if (!thread) continue

            this.detachedAiChatThreadEditors.activate(threadId)
            this.createDetachedCanvasThreadEditor({ thread })
        }
    }

    private submitPersistedDetachedCanvasThreadMessage = (threadId: string): void => {
        this.detachedAiChatThreadEditors.get(threadId)?.submitPersisted()
    }

    private submitCanvasGenerationRun = async (
        data: AiPromptComposerSubmitData,
        options: {
            explicitContextNodeIds?: string[]
            excludedCanvasNodeIds?: string[]
            regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
        } = {},
    ): Promise<void> => {
        await this.canvasGenerationSubmission.submit(data, options)
    }

    private isBranchMarkerGenerationCancelled = (node: BranchMarkerNode): boolean => {
        return this.generationPlacements.isBranchMarkerGenerationCancelled(node)
    }

    private getBranchMarkerUiPhase = (node: BranchMarkerNode): BranchMarkerUiPhase | undefined => {
        return this.generationPlacements.getBranchMarkerUiPhase(node)
    }

    private isBranchMarkerPendingForUi = (node: BranchMarkerNode): boolean => {
        return this.generationPlacements.isBranchMarkerPendingForUi(node)
    }

    private getGeneratedMediaPlacementKey = (threadId: string, generationRun?: MediaGenerationRunMeta): string => {
        return this.generationPlacements.getGeneratedMediaPlacementKey(threadId, generationRun)
    }

    private getGeneratedMediaRunKey = (threadId: string, generationRun?: MediaGenerationRunMeta): string => {
        return this.generationPlacements.getGeneratedMediaRunKey(threadId, generationRun)
    }

    private deletePendingBranchMarkerAliasesForNodeId = (nodeId: string): void => {
        return this.generationPlacements.deletePendingBranchMarkerAliasesForNodeId(nodeId)
    }

    private cleanupBranchMarkerArtifacts = (nodeIds: Iterable<string>): void => {
        for (const nodeId of nodeIds) {
            this.deletePendingBranchMarkerAliasesForNodeId(nodeId)
            this.branchMarkerUiPhaseByNodeId.delete(nodeId)
            this.destroyBranchMarkerContent(nodeId)
            this.destroyMediaGenerationProgressInstance(`branch:${nodeId}`)
            this.projectionOverrides.delete(nodeId)
            this.branchMarkerProjectionOverrideNodeIds.delete(nodeId)
            this.manuallyPositionedBranchMarkerNodeIds.delete(nodeId)
        }
    }

    private hasStartedGeneratedMediaForBranchMarkerNode = (nodeId: string): boolean => {
        for (const tracker of this.partialImageTracker.values()) {
            if (tracker.sourceNodeId === nodeId) return true
        }
        for (const tracker of this.videoGenerationTracker.values()) {
            if (tracker.sourceNodeId === nodeId) return true
        }
        const nodesById = this.getCanvasNodesById(this.currentCanvasState?.nodes ?? [])
        return Boolean(
            this.currentCanvasState?.edges.some((edge: WorkspaceEdge) => {
                if (edge.sourceNodeId !== nodeId) return false
                const targetNode = nodesById.get(edge.targetNodeId)
                return targetNode?.type === 'image' || targetNode?.type === 'video'
            }),
        )
    }

    private debugBranchMarkerHandoff = (
        event: string,
        marker: BranchMarkerNode,
        details: Record<string, unknown> = {},
    ): void => {
        if (!this.debugLoggingEnabled) return
        const key = [
            event,
            marker.nodeId,
            getBranchMarkerThreadId(marker),
            marker.generationRequestId,
            details.reason,
            details.placementKey,
            details.previousNodeId,
        ].join(':')
        if (this.branchMarkerHandoffDebugKeys.has(key)) return
        this.branchMarkerHandoffDebugKeys.add(key)
        console.info('[CANVAS][branch-marker-handoff]', event, {
            markerNodeId: marker.nodeId,
            markerType: marker.type,
            threadId: getBranchMarkerThreadId(marker),
            generationRequestId: marker.generationRequestId,
            pendingPhase: marker.pendingState?.phase ?? '',
            uiPhase: this.branchMarkerUiPhaseByNodeId.get(marker.nodeId) ?? '',
            ...details,
        })
    }

    private restoreDetachedCanvasPreflightMarkersForActiveThreads = (): void => {
        return this.preflightMarkers.restoreDetachedCanvasPreflightMarkersForActiveThreads()
    }

    private insertPendingBranchMarkerForCanvasRun = (
        placementKey: string,
        promptText: string,
        data: AiPromptComposerSubmitData,
    ): void => {
        return this.preflightMarkers.insertPendingBranchMarkerForCanvasRun(placementKey, promptText, data)
    }

    private preserveBranchMarkerPreviewStateAcrossPromotion = (
        pendingNodeId: string,
        plannedNode: BranchMarkerNode,
    ): BranchMarkerNode => {
        if (pendingNodeId !== plannedNode.nodeId) {
            this.projectionOverrides.delete(pendingNodeId)
            this.branchMarkerProjectionOverrideNodeIds.delete(pendingNodeId)
            this.manuallyPositionedBranchMarkerNodeIds.delete(pendingNodeId)
        }
        const nodeWithProjection = this.resizeBranchMarkerNodeFromProseMirror(plannedNode)
        this.projectionOverrides.delete(nodeWithProjection.nodeId)
        this.branchMarkerProjectionOverrideNodeIds.delete(nodeWithProjection.nodeId)
        this.manuallyPositionedBranchMarkerNodeIds.delete(nodeWithProjection.nodeId)
        return nodeWithProjection
    }

    private ensurePendingGeneratedMediaPlacementForApiRun = (
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        seed?: PendingGeneratedImagePlacement,
    ): PendingGeneratedImagePlacement | undefined => {
        return this.generationPlacements.ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun, seed)
    }

    private setPendingGeneratedMediaPlacement = (
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        placement: PendingGeneratedImagePlacement,
    ): void => {
        return this.generationPlacements.setPendingGeneratedMediaPlacement(threadId, generationRun, placement)
    }

    private removePendingBranchMarkerForRun = (threadId: string, generationRun?: MediaGenerationRunMeta): void => {
        return this.markerHandoff.removePendingBranchMarkerForRun(threadId, generationRun)
    }

    private settleBranchMarkersForGenerationRequest = (
        generationRequestId: string,
        options: BranchMarkerSettlementOptions = {},
    ): void => {
        return this.generationSettlement.settleBranchMarkersForGenerationRequest(generationRequestId, options)
    }

    private settleMediaGenerationRequest = (
        threadId: string,
        generationRequestId: string,
        generationRun?: MediaGenerationRunMeta,
        options: BranchMarkerSettlementOptions = {},
    ): void => {
        return this.generationSettlement.settleMediaGenerationRequest(threadId, generationRequestId, generationRun, options)
    }

    private clearPendingGeneratedMediaPlacementsForThread = (threadId: string): void => {
        return this.generationSettlement.clearPendingGeneratedMediaPlacementsForThread(threadId)
    }

    private findCanvasNodeById = (nodeId: string | undefined): CanvasNode | undefined => {
        return this.lineageProjection.findCanvasNodeById(nodeId)
    }

    private getExistingMediaNodeIds = (nodeIds: Iterable<string | null | undefined>): string[] => {
        return this.lineageProjection.getExistingMediaNodeIds(nodeIds)
    }

    private appendBranchMarkerNodeToDOM = (
        rebalancedNodes: CanvasNode[],
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode | undefined,
    ): void => {
        if (!markerNode) return
        const placed = rebalancedNodes.find((n: CanvasNode) => n.nodeId === markerNode.nodeId) ?? markerNode
        if (placed.type === 'branchFork') this.appendCanvasNodeToDOM(placed as BranchForkCanvasNode)
        else if (placed.type === 'branchLine') this.appendCanvasNodeToDOM(placed as BranchLineCanvasNode)
    }

    private setGeneratingReferenceNodeIds = (threadId: string, referenceNodeIds: Iterable<string>): void => {
        this.generationVisuals.setReferences(threadId, referenceNodeIds)
        this.syncGeneratingMediaNodes()
    }

    private clearGeneratingReferenceNodeIds = (threadId: string): void => {
        if (!this.generationVisuals.removeReferences(threadId)) return
        this.syncGeneratingMediaNodes()
    }

    private clearGeneratingReferenceNodeIdsForPromptHandoff = (threadId: string, generationRun?: MediaGenerationRunMeta): void => {
        const placementKey = this.getGeneratedMediaPlacementKey(threadId, generationRun)
        const placement = this.ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
        const expectedRunKeys = placement?.lineagePlan?.runAssignments
            .map(assignment => assignment.mediaRunId ?? assignment.reasoningRunId)
            .filter((runKey): runKey is string => Boolean(runKey))
            ?? []
        if (placement && expectedRunKeys.length > 0) {
            const promptHandoffRunKeys = new Set(placement.promptHandoffRunKeys ?? [])
            promptHandoffRunKeys.add(this.getGeneratedMediaRunKey(threadId, generationRun))
            this.pendingGeneratedImagePlacements.set(placementKey, {
                ...placement,
                promptHandoffRunKeys,
            })
            if (expectedRunKeys.some(runKey => !promptHandoffRunKeys.has(runKey))) return
        }

        const keysToClear = new Set<string>([
            threadId,
            placementKey,
        ])
        let didClear = false
        for (const key of keysToClear) {
            didClear = this.generationVisuals.removeReferences(key) || didClear
        }
        if (didClear) this.syncGeneratingMediaNodes()
    }

    private clearGeneratingReferencesOnFirstPixels = (threadId: string, generationRun?: MediaGenerationRunMeta): void => {
        this.clearGeneratingReferenceNodeIdsForPromptHandoff(threadId, generationRun)
    }

    private clearGeneratingReferencesAfterPromptHandoff = (threadId: string, generationRun?: MediaGenerationRunMeta): void => {
        this.clearGeneratingReferenceNodeIdsForPromptHandoff(threadId, generationRun)
    }

    private getPersistedAiChatThread = (threadId: string): AiChatThread | undefined => {
        return this.conversationProjection.get(threadId)
    }

    private schedulePersistedAiChatThreadRefreshForBranchMarkers = (threadId: string): void => {
        this.conversationProjection.schedule(threadId)
    }

    private getAiChatThreadContentForProjection = (threadId: string): unknown => {
        return this.conversationProjection.content(threadId)
    }

    private getGeneratedMediaHistoryContent = (node: ImageCanvasNode | VideoCanvasNode): unknown => {
        return this.workspaceHistory.getGeneratedMediaHistoryContent(node)
    }

    private isBranchMarkerGenerationActive = (node: BranchMarkerNode): boolean => {
        return this.branchActivity.isBranchMarkerGenerationActive(node)
    }

    private isBranchMarkerGenerationGroupActive = (node: BranchMarkerNode): boolean => {
        return this.branchActivity.isBranchMarkerGenerationGroupActive(node)
    }

    private getBranchMarkerConversationPreview = (node: BranchMarkerNode): BranchMarkerConversationPreview | null => {
        return this.workspaceHistory.getBranchMarkerConversationPreview(node)
    }

    private shouldShowBranchMarkerResponseLine = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): boolean => {
        return Boolean(getBranchMarkerReasoningResponseText(node, preview))
    }

    private getBranchMarkerPromptTraceHandles = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): ExecutionTraceHandle[] => {
        return this.referenceProjection.getBranchMarkerPromptTraceHandles(node, preview)
    }

    private getBranchMarkerPromptPartsForNode = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): BranchMarkerPromptPart[] => {
        return this.referenceProjection.getBranchMarkerPromptPartsForNode(node, preview)
    }

    private getBranchMarkerVisiblePromptText = (
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null,
    ): string => {
        return getBranchMarkerPromptDisplayText(this.getBranchMarkerPromptPartsForNode(node, preview))
    }

    private resizeBranchMarkerNodeFromProseMirror = (node: BranchMarkerNode): BranchMarkerNode => {
        const preview = this.getBranchMarkerConversationPreview(node)
        const responseText = getBranchMarkerReasoningResponseText(node, preview)
        return this.resizeBranchMarkerNodeToDimensions(
            node,
            this.getBranchMarkerContentDimensions(this.getBranchMarkerVisiblePromptText(node, preview), {
                responseLine: this.shouldShowBranchMarkerResponseLine(node, preview),
                responseText,
            }),
        )
    }

    private applyBranchMarkerLiveGeometry = <T extends BranchMarkerNode>(node: T): T => {
        const override = this.liveNodeOverrides.get(node.nodeId)
        if (!override?.position && !override?.dimensions) return node
        return {
            ...node,
            ...(override.position ? { position: override.position } : {}),
            ...(override.dimensions ? { dimensions: override.dimensions } : {}),
        } as T
    }

    private refreshBranchMarkersForAiChatThread = (threadId: string): void => {
        if (!this.currentCanvasState) return

        const markersWithClearedProjectionGeometry: BranchMarkerNode[] = []
        const resizedOnCanvasMarkersById = new Map<string, BranchMarkerNode>()

        for (const node of this.currentCanvasState.nodes) {
            if (!this.isBranchMarkerNode(node) || getBranchMarkerThreadId(node) !== threadId) continue

            if (this.branchMarkerProjectionOverrideNodeIds.has(node.nodeId)) {
                this.projectionOverrides.delete(node.nodeId)
                this.branchMarkerProjectionOverrideNodeIds.delete(node.nodeId)
                markersWithClearedProjectionGeometry.push(node)
            }

            const resizedNode = this.resizeBranchMarkerNodeFromProseMirror(this.applyBranchMarkerLiveGeometry(node))
            if (
                resizedNode.dimensions.width !== node.dimensions.width
                || resizedNode.dimensions.height !== node.dimensions.height
                || resizedNode.position.x !== node.position.x
                || resizedNode.position.y !== node.position.y
            ) {
                resizedOnCanvasMarkersById.set(node.nodeId, resizedNode)
            }
            this.syncBranchMarkerNodeContent(resizedNode)
        }
        if (resizedOnCanvasMarkersById.size > 0) {
            this.commitTransientCanvasStatePreservingEditors({
                ...this.currentCanvasState,
                nodes: this.currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => resizedOnCanvasMarkersById.get(node.nodeId) ?? node),
            })
        }
        if (markersWithClearedProjectionGeometry.length > 0 && resizedOnCanvasMarkersById.size === 0) {
            this.syncCanvasNodeDomGeometry(markersWithClearedProjectionGeometry)
            this.canvasMediaLayer?.sync(this.currentCanvasState)
            this.scheduleEdgesRender()
        }
    }

    private refreshBranchMarkerPreviewsForLoadedThreads = (threads: AiChatThread[]): void => {
        for (const thread of threads) {
            this.refreshBranchMarkersForAiChatThread(thread.threadId)
        }
    }

    private refreshGeneratedMediaProjectionsForAiChatThread = (threadId: string): void => {
        const detailsNode = this.resolveGeneratedOutputDetailsNode(this.aiChatPanelState.generatedOutputDetailsTarget)
        const detailsThreadId = detailsNode
            ? this.isBranchMarkerNode(detailsNode)
                ? detailsNode.conversationAssetId
                : detailsNode.generatedBy?.conversationAssetId
            : undefined
        if (detailsThreadId !== threadId || !this.rightPanel.element) return
        if (this.generatedOutputDetailsRefreshRaf !== null) return
        this.generatedOutputDetailsRefreshRaf = this.window.requestAnimationFrame(() => {
            this.generatedOutputDetailsRefreshRaf = null
            const currentDetailsNode = this.resolveGeneratedOutputDetailsNode(this.aiChatPanelState.generatedOutputDetailsTarget)
            const currentDetailsThreadId = currentDetailsNode
                ? this.isBranchMarkerNode(currentDetailsNode)
                    ? currentDetailsNode.conversationAssetId
                    : currentDetailsNode.generatedBy?.conversationAssetId
                : undefined
            if (currentDetailsThreadId !== threadId || !this.rightPanel.element) return
            this.renderActiveAiChatPanel({ preserveModeSwitch: true, animateOpen: false })
        })
    }

    private buildWorkspaceContextTitlesByNodeId = (nodes: CanvasNode[]): Record<string, string> => {
        return this.referenceProjection.buildWorkspaceContextTitlesByNodeId(nodes)
    }

    private isGeneratedMediaNode = (node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode => {
        return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy?.branchId)
    }

    private pruneOrphanBranchMarkers = (nodes: CanvasNode[], edges: WorkspaceEdge[]): { nodes: CanvasNode[]; edges: WorkspaceEdge[] } => {
        const referencedOriginNodeIds = new Set<string>()
        const referencedForkNodeIds = new Set<string>()
        const referencedLineNodeIds = new Set<string>()
        for (const node of nodes) {
            if (node.type !== 'image' && node.type !== 'video' && node.type !== 'capabilityArtifact') continue
            if (node.generatedBy?.branchOriginNodeId) referencedOriginNodeIds.add(node.generatedBy.branchOriginNodeId)
            if (node.generatedBy?.branchForkNodeId) referencedForkNodeIds.add(node.generatedBy.branchForkNodeId)
            if (node.generatedBy?.branchLineNodeId) referencedLineNodeIds.add(node.generatedBy.branchLineNodeId)
        }

        const removedMarkerNodeIds = new Set<string>()
        const prunedNodes = nodes.filter((node: CanvasNode) => {
            const shouldRemove = (node.type === 'branchOrigin' && !referencedOriginNodeIds.has(node.nodeId))
                || (node.type === 'branchFork' && !referencedForkNodeIds.has(node.nodeId))
                || (node.type === 'branchLine' && !referencedLineNodeIds.has(node.nodeId))
            if (shouldRemove) removedMarkerNodeIds.add(node.nodeId)
            return !shouldRemove
        })
        if (removedMarkerNodeIds.size === 0) return { nodes, edges }

        return {
            nodes: prunedNodes,
            edges: edges.filter((edge: WorkspaceEdge) => !removedMarkerNodeIds.has(edge.sourceNodeId) && !removedMarkerNodeIds.has(edge.targetNodeId)),
        }
    }

    private resolveGeneratedMediaTreeState = (nodes: CanvasNode[], edges: WorkspaceEdge[]): { nodes: CanvasNode[]; edges: WorkspaceEdge[] } => {
        const pruned = this.pruneOrphanBranchMarkers(nodes, edges)
        return {
            nodes: this.rebalanceGeneratedMediaTrees(pruned.nodes, pruned.edges),
            edges: pruned.edges,
        }
    }

    private patchWorkspaceContextImprovedDescriptors = (improvedDescriptors: Record<string, ContentDescriptor> | undefined): void => {
        void this.mediaAnalysis.refreshWorkspaceDescriptors(improvedDescriptors)
    }

    private updatePendingGeneratedImageReferencesFromWorkspaceContext = (
        threadId: string | undefined,
        resolution: WorkspaceContextResolution,
        generationRun?: MediaGenerationRunMeta,
    ): void => {
        if (!threadId) return
        const placement = this.ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
        if (!placement) return

        const forcedChipNodeIds = resolution.selections
            .filter((selection: WorkspaceContextSelection) => selection.role === 'forced-chip')
            .map((selection: WorkspaceContextSelection) => selection.nodeId)
        const referenceNodeIds = this.getExistingMediaNodeIds([
            ...forcedChipNodeIds,
            ...resolution.narrowedMediaNodeIds,
            ...resolution.selections.map((selection: WorkspaceContextSelection) => selection.nodeId),
        ])
        if (referenceNodeIds.length === 0) return

        this.setPendingGeneratedMediaPlacement(threadId, generationRun, {
            ...placement,
            placementAnchorNodeId: placement.placementAnchorNodeId ?? referenceNodeIds[0],
            referenceNodeIds,
        })
        this.setGeneratingReferenceNodeIds(this.getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)
    }

    private handleWorkspaceContextResolution = (threadId: string | undefined, resolution: WorkspaceContextResolution, generationRun?: MediaGenerationRunMeta): void => {
        this.patchWorkspaceContextImprovedDescriptors(resolution.improvedDescriptors)
        this.updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution, generationRun)
    }

    private getCurrentCanvasMediaNode = (nodeId: string): ImageCanvasNode | VideoCanvasNode | undefined => {
        const node = this.currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) return undefined
        return node
    }

    private queueCanvasMediaAnalysis = (nodeId: string, stillAssetId: string | undefined): void => {
        this.mediaAnalysis.queue(nodeId, stillAssetId)
    }

    private getMediaDescriptorStillAssetId = (node: ImageCanvasNode | VideoCanvasNode): string | undefined => {
        return node.assetId || undefined
    }

    private debugGeneratedMediaLifecycle = (event: string, details: Record<string, unknown>): void => {
        if (this.debugLoggingEnabled) console.info('[CANVAS][generated-media]', event, details)
    }

    private preserveActiveGeneratedMediaTrackersInState = (state: CanvasState | null): CanvasState | null => {
        return this.mediaTrackers.preserveActiveGeneratedMediaTrackersInState(state)
    }

    private syncConnectionManagerForCurrentCanvasState = (options: { flushRenderer?: boolean } = {}): void => {
        if (!this.connectionManager || !this.currentCanvasState) return
        this.canvasMediaLayer?.sync(this.currentCanvasState)
        this.connectionManager.render()
        if (options.flushRenderer) this.canvasMediaLayer?.renderNow()
    }

    private syncConnectionsAfterManualNodeAppend = (): void => {
        this.syncConnectionManagerForCurrentCanvasState({ flushRenderer: true })
    }

    private appendCanvasNodeToDOM = (node: CanvasNode): void => {
        if (!this.currentCanvasState?.nodes.some(candidate => candidate.nodeId === node.nodeId)) return
        this.syncCanvasMediaLayer(this.currentCanvasState)
        this.syncConnectionsAfterManualNodeAppend()
    }

    private syncExistingOperationStatusNodeToDOM = (node: OperationStatusCanvasNode): void => {
        this.ensureMediaGenerationOperationRecovery(node)
        if (!this.shouldRenderOperationStatusNode(node)) this.selection.remove(node.nodeId)
        this.appendCanvasNodeToDOM(node)
    }

    private prepareUploadReplacementNode = (
        placeholderNode: OperationStatusCanvasNode,
        node: WorkspaceCanvasNodeInsertion,
    ): CanvasNode => {
        const position = {
            x: placeholderNode.position.x + (placeholderNode.dimensions.width - node.dimensions.width) / 2,
            y: placeholderNode.position.y + (placeholderNode.dimensions.height - node.dimensions.height) / 2,
        }
        const positionedNode = { ...node, position } as CanvasNode
        return positionedNode
    }

    private replaceUploadPlaceholderInternal = (
        placeholderNodeId: string,
        node: WorkspaceCanvasNodeInsertion,
        commit = true,
    ): CanvasState | null => {
        if (!this.currentCanvasState) return null
        const placeholderNode = this.currentCanvasState.nodes.find((candidate: CanvasNode): candidate is OperationStatusCanvasNode => candidate.type === 'operationStatus' && candidate.operation === 'upload' && candidate.nodeId === placeholderNodeId)
        if (!placeholderNode) return null

        const preparedNode = this.prepareUploadReplacementNode(placeholderNode, node)
        const nodes = this.resolveTopLevelNodeCollisions(this.currentCanvasState.nodes.map((candidate: CanvasNode): CanvasNode => candidate.nodeId === placeholderNodeId ? preparedNode : candidate))
        const edges = this.currentCanvasState.edges.map((edge: WorkspaceEdge): WorkspaceEdge => ({
            ...edge,
            sourceNodeId: edge.sourceNodeId === placeholderNodeId ? preparedNode.nodeId : edge.sourceNodeId,
            targetNodeId: edge.targetNodeId === placeholderNodeId ? preparedNode.nodeId : edge.targetNodeId,
        }))
        const nextState: CanvasState = { ...this.currentCanvasState, nodes, edges }

        if (commit) {
            this.commitCanvasStatePreservingEditors(nextState)
            this.appendCanvasNodeToDOM(preparedNode)
            this.selection.remove(placeholderNodeId)
            this.selectNode(preparedNode.nodeId)

            if (preparedNode.type === 'image' || preparedNode.type === 'video') {
                this.queueCanvasMediaAnalysis(preparedNode.nodeId, this.getMediaDescriptorStillAssetId(preparedNode))
            }
        }

        return nextState
    }

    private markUploadPlaceholderFailedInternal = (placeholderNodeId: string, message: string): CanvasState | null => {
        if (!this.currentCanvasState) return null
        let failedNode: OperationStatusCanvasNode | null = null
        const nodes = this.currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (node.type !== 'operationStatus' || node.operation !== 'upload' || node.nodeId !== placeholderNodeId) return node
            failedNode = {
                ...node,
                status: 'failed',
                message,
                updatedAt: Date.now(),
            }
            return failedNode
        })
        if (!failedNode) return null

        const nextState: CanvasState = { ...this.currentCanvasState, nodes }
        this.commitCanvasStatePreservingEditors(nextState)
        this.syncExistingOperationStatusNodeToDOM(failedNode)

        return nextState
    }

    private commitCanvasStatePreservingEditors = (nextState: CanvasState): void => {
        this.commitCanvasState(nextState)
        this.lastNodeStructureKey = getNodeStructureKey(this.currentCanvasState)
    }

    private commitTransientCanvasStatePreservingEditors = (nextState: CanvasState): void => {
        this.currentCanvasState = nextState
        this.pendingLocalCanvasVisualCommit = null

        this.syncCanvasNodeDomGeometry(nextState.nodes)
        this.syncCanvasMediaLayer(nextState)
        this.syncConnectionManagerForCurrentCanvasState()
        this.canvasMediaLayer?.renderNow()
        this.lastVisualSyncKey = getCanvasVisualSyncKey(nextState)
        this.lastNodeStructureKey = getNodeStructureKey(this.currentCanvasState)
    }

    private commitTransientCanvasNodeInsertionToScene = (
        nextState: CanvasState,
        nodeId: string,
        replacedPlaceholderNodeId?: string,
    ): void => {
        this.currentCanvasState = nextState
        this.pendingLocalCanvasVisualCommit = null

        if (replacedPlaceholderNodeId) {
            this.selection.remove(replacedPlaceholderNodeId)
        }

        const insertedNode = nextState.nodes.find((node: CanvasNode) => node.nodeId === nodeId)
        if (!insertedNode) {
            this.commitTransientCanvasStatePreservingEditors(nextState)
            return
        }

        this.appendCanvasNodeToDOM(insertedNode)
        this.syncCanvasNodeDomGeometry(nextState.nodes)
        this.syncConnectionManagerForCurrentCanvasState({ flushRenderer: true })
        this.lastVisualSyncKey = getCanvasVisualSyncKey(nextState)
        this.lastNodeStructureKey = getNodeStructureKey(nextState)

        if (insertedNode.type === 'image' || insertedNode.type === 'video') {
            this.queueCanvasMediaAnalysis(insertedNode.nodeId, this.getMediaDescriptorStillAssetId(insertedNode))
        }
    }

    private commitCanvasMetadataState = (nextState: CanvasState): void => {
        this.currentCanvasState = nextState
        this.onCanvasStateChange?.(nextState)
    }

    private removeApiCanvasRemovedNodesFromDOM = (nodeIds: Iterable<string>): void => {
        const nodeIdSet = new Set(nodeIds)
        if (nodeIdSet.size === 0) return

        this.syncCanvasMediaLayer(this.currentCanvasState)

        if (this.debugLoggingEnabled) {
            console.info('[CANVAS][api-geometry]', 'removed-dom-nodes', {
                removedNodeIds: [...nodeIdSet],
            })
        }
    }

    private pruneApiCanvasRemovedGeneratedMediaTrackers = (nodeIds: Iterable<string>): void => {
        return this.mediaTrackers.pruneApiCanvasRemovedGeneratedMediaTrackers(nodeIds)
    }

    private applyApiCanvasGeometry = (canvasGeometry: CanvasGeometryUpdate): void => {
        return this.apiCanvasGeometry.applyApiCanvasGeometry(canvasGeometry)
    }

    private suspendPanZoomForNodePointer = (nodeId: string): void => {
        this.nodeGestures.suspendPanLock(nodeId)
    }

    private releasePanZoomForNodePointer = (): void => {
        this.nodeGestures.releasePanLock()
    }

    private selectNode = (nodeId: string | null) => {
        this.setSelectedNodes(nodeId ? new Set([nodeId]) : new Set())
    }

    private commitCanvasState = (nextState: CanvasState) => {
        this.currentCanvasState = nextState
        this.pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(nextState)
        this.onCanvasStateChange?.(nextState)

        this.syncCanvasNodeDomGeometry(nextState.nodes)
        this.syncCanvasMediaLayer(nextState)
        this.syncConnectionManagerForCurrentCanvasState()
        this.canvasMediaLayer?.renderNow()
        this.lastVisualSyncKey = getCanvasVisualSyncKey(nextState)
    }

    private scheduleTransformSideEffects = () => {
        if (this.transformSideEffectsRaf !== null) return
        this.transformSideEffectsRaf = this.window.requestAnimationFrame(() => {
            this.transformSideEffectsRaf = null
            if (this.pendingHandleZoom !== null) {
                this.updateResizeHandles(this.pendingHandleZoom)
                this.pendingHandleZoom = null
            }
            this.repositionCanvasBubbleMenu()
            this.repositionEdgeBubbleMenu()
        })
    }

    private scheduleEdgesRender = () => {
        if (!this.connectionManager || !this.currentCanvasState) return
        if (this.edgesRaf !== null) return

        this.edgesRaf = this.window.requestAnimationFrame(() => {
            this.edgesRaf = null

            if (!this.connectionManager || !this.currentCanvasState) return

            this.canvasMediaLayer?.sync(this.currentCanvasState)
            this.connectionManager.render()
            this.repositionEdgeBubbleMenu()
        })
    }

    private cancelScheduledEdgesRender = (): void => {
        if (this.edgesRaf === null) return
        this.window.cancelAnimationFrame(this.edgesRaf)
        this.edgesRaf = null
    }

    private ensureConnectionManager = (): void => {
        if (!this.currentCanvasState) return
        this.syncCanvasMediaLayer(this.currentCanvasState)
        if (this.selectedEdgeId) this.connectionManager?.selectEdge(this.selectedEdgeId)
        this.scheduleEdgesRender()
    }

    private updateResizeHandles = (zoom: number) => {
        this.nodeShells.setZoom(zoom)
    }

    private getCurrentViewportZoom = (): number => {
        return this.getLiveViewport().zoom
    }

    private handleDragStart = (event: MouseEvent, nodeId: string, options: DragStartOptions = {}) => {
        this.nodeGestures.startDrag(event, nodeId, options)
    }

    private handleResizeStart = (event: MouseEvent, nodeId: string, handlePosition: ResizeHandle) => {
        this.nodeGestures.startResize(event, nodeId, handlePosition)
    }

    private mountDocumentEditor = (request: WorkspaceDocumentEditorOptions): { destroy: () => void } => {
        return this.editors.mountDocument({
            ...request,
            workspaceId: this.workspaceId,
            createContextTray: this.createAiChatPanelContextTrayElement,
            onChange: content =>
                this.onDocumentContentChange?.({
                    documentId: request.node.assetId,
                    title: request.document.title,
                    content,
                }),
        })
    }

    private applyCapabilityArtifactHeight = (nodeId: string, measuredHeight: number): void => {
        if (!this.currentCanvasState) return
        const node = this.currentCanvasState.nodes.find((candidate): candidate is CapabilityArtifactCanvasNode => (
            candidate.nodeId === nodeId && candidate.type === 'capabilityArtifact'
        ))
        if (!node) return
        const height = Math.max(140, Math.ceil(measuredHeight))
        if (Math.abs(node.dimensions.height - height) <= 1) return
        const resizedNodes = this.currentCanvasState.nodes.map(candidate =>
            candidate.nodeId === nodeId
                ? { ...candidate, dimensions: { width: node.dimensions.width, height } }
                : candidate
        )
        const nodes = this.rebalanceGeneratedMediaTrees(resizedNodes, this.currentCanvasState.edges)
        this.commitCanvasStatePreservingEditors({ ...this.currentCanvasState, nodes })
        this.scheduleGeneratedMediaChromeSync()
    }

    private createCapabilityArtifactNode = (node: CapabilityArtifactCanvasNode): HTMLElement => {
        return new WorkspaceCapabilityNode(node, this.nodeShells, {
            ensureStyles: this.host.capabilities.ensureStyles,
            getAsset: assetId => this.host.assets.read(assetId),
            getDocument: assetId => this.host.assets.readDocument(assetId, 'capabilityArtifact'),
            refreshAsset: assetId => this.host.assets.refresh(assetId, this.workspaceId),
            ensureAssetsLoaded: assetIds => this.host.assets.ensureAssetsLoaded(assetIds),
            getDefinitions: artifactTypeId => ({
                frontend: this.host.capabilities.frontend.require(artifactTypeId),
                shared: this.host.capabilities.shared.require(artifactTypeId),
            }),
            createAssetReferenceView: this.createCapabilityArtifactAssetReferenceView,
            onHeightChange: this.applyCapabilityArtifactHeight,
            onError: (error, nodeId) => console.error('Failed to mount Capability Artifact:', { nodeId, error }),
            mountEditor: request =>
                this.editors.mountCapability({
                    ...request,
                    workspaceId: this.workspaceId,
                    promptReferenceCatalog: this.getPromptReferenceCatalogClient(request.asset.organizationId),
                    promptReferencePreviewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }),
                }),
        }).element
    }

    private removeOperationStatusNodeInternal = (placeholderNodeId: string, operation?: OperationStatusCanvasNode['operation']): CanvasState | null => {
        if (!this.currentCanvasState) return null
        const exists = this.currentCanvasState.nodes.some((candidate: CanvasNode): boolean =>
            candidate.type === 'operationStatus'
            && (!operation || candidate.operation === operation)
            && candidate.nodeId === placeholderNodeId
        )
        if (!exists) return null

        const nodes = this.currentCanvasState.nodes.filter((candidate: CanvasNode): boolean => candidate.nodeId !== placeholderNodeId)
        const edges = this.currentCanvasState.edges.filter((edge: WorkspaceEdge): boolean => edge.sourceNodeId !== placeholderNodeId && edge.targetNodeId !== placeholderNodeId)
        const nextState: CanvasState = { ...this.currentCanvasState, nodes, edges }

        this.commitCanvasStatePreservingEditors(nextState)
        this.selection.remove(placeholderNodeId)
        return nextState
    }

    private applyMediaOperationRecoveryResult = (result: MediaGenerationOperationRecoveryResult): void => {
        if (!result.changed || !this.currentCanvasState) return
        const replacedGeneratedMediaNodeIds = result.updatedNodeIds.filter(nodeId => {
            const previousNode = this.currentCanvasState?.nodes.find(node => node.nodeId === nodeId)
            const updatedNode = result.state.nodes.find(node => node.nodeId === nodeId)
            return (previousNode?.type === 'image' || previousNode?.type === 'video')
                && updatedNode?.type === 'operationStatus'
        })
        const rebalancedNodes = result.removedNodeIds.length > 0 || replacedGeneratedMediaNodeIds.length > 0
            ? this.rebalanceGeneratedMediaTrees(result.state.nodes, result.state.edges)
            : result.state.nodes
        const changedGeometryNodeIds = rebalancedNodes.flatMap(node => {
            const previous = result.state.nodes.find(candidate => candidate.nodeId === node.nodeId)
            return previous
                    && previous.position.x === node.position.x
                    && previous.position.y === node.position.y
                    && previous.dimensions.width === node.dimensions.width
                    && previous.dimensions.height === node.dimensions.height
                ? []
                : [node.nodeId]
        })
        this.commitTransientCanvasStatePreservingEditors({ ...result.state, nodes: rebalancedNodes })
        this.removeApiCanvasRemovedNodesFromDOM(result.removedNodeIds)
        this.pruneApiCanvasRemovedGeneratedMediaTrackers([
            ...result.removedNodeIds,
            ...replacedGeneratedMediaNodeIds,
        ])

        for (const nodeId of result.removedNodeIds) {
            this.canvasMediaLayer?.setTransientImageSource(nodeId, null)
            this.selection.remove(nodeId)
        }
        for (const nodeId of result.updatedNodeIds) {
            const updatedNode = this.currentCanvasState.nodes.find(candidate => candidate.nodeId === nodeId)
            if (updatedNode?.type === 'operationStatus') this.syncExistingOperationStatusNodeToDOM(updatedNode)
        }
        if (changedGeometryNodeIds.length > 0) {
            this.syncCanvasNodeDomGeometry(
                this.currentCanvasState.nodes.filter(node => changedGeometryNodeIds.includes(node.nodeId)),
            )
        }
        this.syncCanvasMediaLayer(this.currentCanvasState)
        this.scheduleGeneratedMediaChromeSync()
        this.syncBranchMarkerNodeContents()
        this.syncConnectionsAfterManualNodeAppend()
    }

    private applyMediaOperationProgressResult = (result: MediaGenerationOperationRecoveryResult): void => {
        if (!result.changed || !this.currentCanvasState) return
        this.currentCanvasState = result.state
        this.syncLiveMediaGenerationProgressInstancesForState(result.state)
    }

    private ensureMediaGenerationOperationRecovery = (node: OperationStatusCanvasNode): void => {
        void this.mediaOperationRecovery.ensure(node)
    }

    private editOperationRequest = async (node: OperationStatusCanvasNode, signal: AbortSignal): Promise<void> => {
        const current = this.captureSceneAdmission()
        if (signal.aborted || !current()) return
        const response = await this.host.generation.get({
            generationRequestId: node.generationRequestId!,
            workspaceId: this.workspaceId,
        })
        if (signal.aborted || !current()) return
        if (!response.checkpoint) throw new Error('Media request checkpoint is no longer available.')
        const promptDocument = response.checkpoint.promptDocument as { content?: unknown[] }
        const selection = response.checkpoint.modelSelection as {
            reasoningModelIds?: string[]
            mediaModelIds?: string[]
        }
        const generation = (response.checkpoint.configuration as {
            generation?: AiInteractionMediaGenerationRequest
        }).generation
        const restoredContextNodeIds = response.checkpoint.selectedReferences.flatMap(reference => {
            const explicitNode = reference.nodeId
                ? this.currentCanvasState?.nodes.find(candidate => candidate.nodeId === reference.nodeId)
                : undefined
            const assetNode = this.currentCanvasState?.nodes.find(candidate => (
                'assetId' in candidate && candidate.assetId === reference.assetId
            ))
            const nodeId = explicitNode?.nodeId ?? assetNode?.nodeId
            return nodeId ? [nodeId] : []
        })
        this.addContextChips(restoredContextNodeIds)
        const imageModelIds = generation?.imageModelIds ?? selection.mediaModelIds?.filter(modelId => !modelId.toLocaleLowerCase().includes('video'))
            ?? []
        const videoModelIds = generation?.videoModelIds ?? selection.mediaModelIds?.filter(modelId => modelId.toLocaleLowerCase().includes('video'))
            ?? []
        this.globalCanvasComposer?.input.restoreContent({
            type: 'doc',
            content: [{
                type: 'aiPromptInput',
                attrs: {
                    mediaGenerationMode: generation?.mediaGenerationMode
                        ?? (generation?.outputMediaTypes?.includes('video') ? 'video' : 'image'),
                    aiReasoningModels: serializeAiModelSelectionAttr(selection.reasoningModelIds ?? []),
                    reasoningGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(
                        generation?.reasoningOptions?.configGroups ?? [],
                    ),
                    useMultipleReasoningModels: (selection.reasoningModelIds?.length ?? 0) > 1,
                    useMultipleImageModels: imageModelIds.length > 1,
                    useMultipleVideoModels: videoModelIds.length > 1,
                    aiImageModels: serializeAiModelSelectionAttr(imageModelIds),
                    imageGenerationSize: generation?.imageOptions?.imageSize ?? 'auto',
                    imageGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(
                        generation?.imageOptions?.configGroups ?? [],
                    ),
                    aiVideoModels: serializeAiModelSelectionAttr(videoModelIds),
                    videoAspectRatio: generation?.videoOptions?.aspectRatio ?? '',
                    videoResolution: generation?.videoOptions?.resolution ?? '',
                    videoDuration: generation?.videoOptions?.duration ?? '',
                    videoGenerationConfigGroups: serializeMediaGenerationConfigSelectionAttr(
                        generation?.videoOptions?.configGroups ?? [],
                    ),
                    capabilityInputs: '',
                },
                content: promptDocument.content ?? [{ type: 'paragraph' }],
            }],
        })
    }

    private createOperationStatusNode = (node: OperationStatusCanvasNode): HTMLElement => {
        this.ensureMediaGenerationOperationRecovery(node)
        return new OperationStatusNode(node, this.nodeShells, {
            verify: async (operation, signal) => {
                const current = this.captureSceneAdmission()
                if (signal.aborted || !current()) return
                const session = await this.host.generation.startVerification({
                    generationRequestId: operation.generationRequestId!,
                    workspaceId: this.workspaceId,
                    requestRevision: operation.requestRevision!,
                    generationRun: operation.generationRun!,
                    assetId: operation.verificationAssetId!,
                })
                if (!signal.aborted && current()) this.host.openExternalUrl(session.verificationUrl)
            },
            cancel: async (operation, signal) => {
                const current = this.captureSceneAdmission()
                if (signal.aborted || !current()) return
                await this.host.generation.cancel({
                    generationRequestId: operation.generationRequestId!,
                    workspaceId: this.workspaceId,
                    requestRevision: operation.requestRevision!,
                })
                if (!signal.aborted && current()) this.removeOperationStatusNodeInternal(operation.nodeId, 'media-generation')
            },
            edit: this.editOperationRequest,
            dismissUpload: operation => this.removeOperationStatusNodeInternal(operation.nodeId, operation.operation),
        }).element
    }

    private getReferenceResolutionMediaKind = (
        assetId: string,
    ): MediaPromptReference['mediaKind'] | undefined => {
        return this.referenceProjection.getReferenceResolutionMediaKind(assetId)
    }

    private createBranchMarkerReferenceResolution = (operation: OperationStatusCanvasNode) => {
        const candidates = (operation.candidateAssetIds ?? []).flatMap(assetId => {
            const mediaKind = this.getReferenceResolutionMediaKind(assetId)
            if (!mediaKind) return []
            const asset = this.host.assets.read(assetId)
            const candidateNode = this.currentCanvasState?.nodes.find(candidate => 'assetId' in candidate && candidate.assetId === assetId)
            return [{
                referenceType: 'media' as const,
                assetId,
                mediaKind,
                ...(candidateNode ? { nodeId: candidateNode.nodeId } : {}),
                displayName: asset?.title.trim() || 'Attached Asset',
            }]
        })
        const view = createBranchReferenceResolution({
            document: this.paneEl.ownerDocument,
            operation,
            candidates,
            renderReference: createCanvasPromptReferenceRenderer({ document: this.paneEl.ownerDocument, previewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }), inlinePopover: true }),
            resolveReference: request => this.host.generation.resolveReference({ ...request, workspaceId: this.workspaceId }),
        })
        return view
    }

    private getBranchMarkerGeneratedOutputNodes = (node: BranchMarkerNode): GeneratedOutputCanvasNode[] => {
        return this.workspaceHistory.getBranchMarkerGeneratedOutputNodes(node)
    }

    private getBranchMarkerReasoningModelDescriptors = (node: BranchMarkerNode): BranchMarkerModelDescriptor[] => {
        const descriptors: BranchMarkerModelDescriptor[] = []
        if (node.pendingState?.reasoningModelId) {
            descriptors.push({ modelId: node.pendingState.reasoningModelId })
        } else if (node.pendingState?.reasoningModelIds.length) {
            descriptors.push(...node.pendingState.reasoningModelIds.map(modelId => ({ modelId })))
        }
        if (node.type === 'branchFork' || node.type === 'branchLine') {
            if (node.reasoningModelId) descriptors.push({ modelId: node.reasoningModelId })
            if (node.provenance?.reasoningModelId) descriptors.push({ modelId: node.provenance.reasoningModelId })
        }
        for (const outputNode of this.getBranchMarkerGeneratedOutputNodes(node)) {
            const reasoningModelId = outputNode.generatedBy?.reasoningModelId
            if (reasoningModelId) descriptors.push({ modelId: reasoningModelId })
        }
        return descriptors
    }

    private getBranchMarkerReasoningModelEntry = (node: BranchMarkerNode): BranchMarkerModelEntry | null => {
        const entries = this.uniqueBranchMarkerModelEntries(
            this.getBranchMarkerReasoningModelDescriptors(node)
                .map(descriptor => this.getBranchMarkerModelEntry(descriptor.modelId, descriptor.modelProvider ?? ''))
                .filter((entry): entry is BranchMarkerModelEntry => Boolean(entry)),
        )
        return entries[0] ?? null
    }

    private getBranchMarkerMediaModelDetails = (node: BranchMarkerNode): BranchMarkerModelDetail[] => {
        const descriptorsByLabel = new Map<string, BranchMarkerModelDescriptor[]>()
        for (const descriptor of getBranchMarkerMediaModelCircleDescriptors(node, this.currentCanvasState?.nodes ?? [])) {
            descriptorsByLabel.set(descriptor.label, [
                ...(descriptorsByLabel.get(descriptor.label) ?? []),
                {
                    modelId: descriptor.modelId,
                    ...(descriptor.modelProvider ? { modelProvider: descriptor.modelProvider } : {}),
                },
            ])
        }

        return Array.from(descriptorsByLabel.entries())
            .map(([label, descriptors]) => this.createBranchMarkerModelDetail(label, descriptors))
            .filter((detail): detail is BranchMarkerModelDetail => Boolean(detail))
    }

    private getBranchMarkerModelDetails = (node: BranchMarkerNode): BranchMarkerModelDetail[] => {
        return [
            ...this.getBranchMarkerMediaModelDetails(node),
        ].filter((detail): detail is BranchMarkerModelDetail => Boolean(detail))
    }

    private getBranchMarkerModelSummary = (details: BranchMarkerModelDetail[]): string => {
        return details
            .map(detail => `${detail.label}: ${detail.entries.map(entry => entry.title).join(', ')}`)
            .join(' · ')
    }

    private getBranchMarkerMediaModelTooltipEntries = (node: BranchMarkerNode): Array<{ label: string; entry: BranchMarkerModelEntry }> => {
        return getBranchMarkerMediaModelCircleDescriptors(node, this.currentCanvasState?.nodes ?? [])
            .map((descriptor) => {
                const entry = this.getBranchMarkerModelEntry(descriptor.modelId, descriptor.modelProvider ?? '')
                return entry ? { label: descriptor.label, entry } : null
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    }

    private generatedMediaNodeBelongsToBranchMarker = (mediaNode: GeneratedMediaNode, markerNodeId: string): boolean => {
        return mediaNode.generatedBy?.branchOriginNodeId === markerNodeId
            || mediaNode.generatedBy?.branchForkNodeId === markerNodeId
            || mediaNode.generatedBy?.branchLineNodeId === markerNodeId
            || mediaNode.generatedBy?.lineageParentNodeId === markerNodeId
    }

    private isProjectedPendingGeneratedMediaNode = (node: GeneratedMediaNode): boolean => {
        const generatedBy = node.generatedBy
        if (!generatedBy?.generationRequestId) return false
        return getPendingGeneratedMediaNodeId({
            generationRequestId: generatedBy.generationRequestId,
            ...(generatedBy.reasoningRunId ? { reasoningRunId: generatedBy.reasoningRunId } : {}),
            ...(generatedBy.mediaRunId ? { mediaRunId: generatedBy.mediaRunId } : {}),
            ...(generatedBy.mediaModelId ? { mediaModelId: generatedBy.mediaModelId } : {}),
            mediaType: generatedBy.mediaType ?? node.type,
            ...(generatedBy.mediaIndex !== undefined ? { mediaIndex: generatedBy.mediaIndex } : {}),
            ...(generatedBy.reasoningIndex !== undefined ? { reasoningIndex: generatedBy.reasoningIndex } : {}),
        }) === node.nodeId
    }

    private generatedMediaTrackerBelongsToBranchMarker = (
        tracker: PendingGeneratedMediaTracker,
        markerNodeId: string,
    ): boolean => {
        if (tracker.sourceNodeId === markerNodeId) return true
        const mediaNode = this.currentCanvasState?.nodes.find((node: CanvasNode): node is GeneratedMediaNode => node.nodeId === tracker.nodeId && (node.type === 'image' || node.type === 'video'))
        return Boolean(mediaNode && this.generatedMediaNodeBelongsToBranchMarker(mediaNode, markerNodeId))
    }

    private getActiveGeneratedMediaNodeIdsForBranchMarker = (node: BranchMarkerNode): Set<string> => {
        const nodeIds = new Set<string>()
        const trackerNodeIds = new Set<string>([
            ...Array.from(this.partialImageTracker.values(), (tracker) => tracker.nodeId),
            ...Array.from(this.videoGenerationTracker.values(), (tracker) => tracker.nodeId),
        ])
        const generationRequestId = node.generationRequestId && !node.generationRequestId.startsWith('canvas-')
            ? node.generationRequestId
            : ''
        for (const tracker of this.partialImageTracker.values()) {
            if (this.generatedMediaTrackerBelongsToBranchMarker(tracker, node.nodeId)) nodeIds.add(tracker.nodeId)
        }
        for (const tracker of this.videoGenerationTracker.values()) {
            if (this.generatedMediaTrackerBelongsToBranchMarker(tracker, node.nodeId)) nodeIds.add(tracker.nodeId)
        }

        const directlyConnectedNodeIds = new Set(
            (this.currentCanvasState?.edges ?? [])
                .filter((edge: WorkspaceEdge) => edge.sourceNodeId === node.nodeId)
                .map((edge: WorkspaceEdge) => edge.targetNodeId),
        )
        for (const candidate of this.currentCanvasState?.nodes ?? []) {
            if (candidate.type !== 'image' && candidate.type !== 'video') continue
            if (
                !trackerNodeIds.has(candidate.nodeId)
                && !this.isGeneratedMediaCanvasNodeWaitingForFrame(candidate)
                && !this.isProjectedPendingGeneratedMediaNode(candidate)
            ) continue
            const matchesGenerationRequest = Boolean(
                generationRequestId && candidate.generatedBy?.generationRequestId === generationRequestId,
            )
            if (
                matchesGenerationRequest
                || directlyConnectedNodeIds.has(candidate.nodeId)
                || this.generatedMediaNodeBelongsToBranchMarker(candidate, node.nodeId)
            ) {
                nodeIds.add(candidate.nodeId)
            }
        }
        return nodeIds
    }

    private removeActiveGeneratedMediaNodesForBranchMarker = (node: BranchMarkerNode): void => {
        if (!this.currentCanvasState) return
        const nodeIds = this.getActiveGeneratedMediaNodeIdsForBranchMarker(node)
        if (nodeIds.size === 0) return

        this.pruneApiCanvasRemovedGeneratedMediaTrackers(nodeIds)
        for (const nodeId of nodeIds) this.selection.remove(nodeId)
        const nextState: CanvasState = {
            ...this.currentCanvasState,
            nodes: this.currentCanvasState.nodes.filter((candidate: CanvasNode) => !nodeIds.has(candidate.nodeId)),
            edges: this.currentCanvasState.edges.filter((edge: WorkspaceEdge) => !nodeIds.has(edge.sourceNodeId) && !nodeIds.has(edge.targetNodeId)),
        }
        this.commitTransientCanvasStatePreservingEditors(nextState)
        this.removeApiCanvasRemovedNodesFromDOM(nodeIds)
        this.syncConnectionManagerForCurrentCanvasState({ flushRenderer: true })
    }

    private stopBranchMarkerGeneration = async (node: BranchMarkerNode): Promise<void> => {
        if (this.rendererDestroyed) return
        const originWorkspaceId = this.workspaceId
        const originSceneKey = this.canvasRuntime.scene.scene.sceneKey
        const threadId = getBranchMarkerThreadId(node)
        if (!threadId) return

        const projectionGenerationRequestId = node.generationRequestId || undefined
        const generationRequestId = projectionGenerationRequestId && !projectionGenerationRequestId.startsWith('canvas-')
            ? projectionGenerationRequestId
            : undefined

        if (generationRequestId) this.cancelledMediaGenerationRequestIds.add(generationRequestId)
        this.removeActiveGeneratedMediaNodesForBranchMarker(node)
        if (generationRequestId) {
            this.settleMediaGenerationRequest(threadId, generationRequestId, undefined, {
                preserveGeometry: true,
            })
        } else {
            this.clearPendingGeneratedMediaPlacementsForThread(threadId)
            this.settleBranchMarkersForGenerationRequest(node.generationRequestId, { preserveGeometry: true })
            this.settleDetachedCanvasRun(threadId)
            this.scheduleDetachedCanvasRunTeardown(threadId)
            this.refreshBranchMarkersForAiChatThread(threadId)
        }

        try {
            const result = await this.host.generation.stopConversation({
                workspaceId: this.workspaceId,
                conversationAssetId: threadId,
                ...(projectionGenerationRequestId ? { generationRequestId: projectionGenerationRequestId } : {}),
            })
            if (!this.isCurrentScene(originWorkspaceId, originSceneKey)) return
            if (result.canvasGeometry) this.applyApiCanvasGeometry(result.canvasGeometry)
            if (!this.isCurrentScene(originWorkspaceId, originSceneKey)) return
            await this.conversationProjection.refresh(threadId)
        } catch (error) {
            console.error('[CANVAS] failed to stop branch-marker generation', {
                nodeId: node.nodeId,
                threadId,
                error,
            })
        }
    }

    private getBranchMarkerReviewZoomScale = (zoom: number): number => {
        return scaleCanvasChromeWorldSizeForZoom(
            1,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(this.host.settings.mediaNode.generatedMediaChrome.zoomScaling),
        )
    }

    private updateBranchMarkerReviewControlsZoom = (zoom: number): void => {
        const scale = this.getBranchMarkerReviewZoomScale(zoom)
        for (const controls of this.branchMarkerActions.values()) controls.setZoomScale(scale)
    }

    private syncBranchMarkerActions = (node: BranchMarkerNode, nodeEl: HTMLElement): void => {
        this.branchMarkerActions.get(node.nodeId)?.destroy()
        const outputNodes = this.getBranchMarkerGeneratedOutputNodes(node).filter(output => !this.isGeneratedOutputAccepted(output))
        const controls = new BranchMarkerActions({
            document: nodeEl.ownerDocument,
            key: [node.nodeId, node.generationRequestId, getBranchMarkerThreadId(node)].join(':'),
            active: this.isBranchMarkerGenerationGroupActive(node),
            hasReviewOutputs: outputNodes.length > 0,
            canAcceptAll: outputNodes.every(this.isGeneratedOutputReviewReady),
            onStop: () => {
                void this.stopBranchMarkerGeneration(node)
            },
            onAcceptAll: () => {
                void this.acceptGeneratedOutput('branch-lineage', node.nodeId)
            },
            onRegenerate: mode => {
                void this.regenerateGeneratedOutputs({ scope: 'branch-lineage', mode, targetNodeId: node.nodeId, outputNodes })
            },
        })
        this.branchMarkerActions.set(node.nodeId, controls)
        controls.setZoomScale(this.getBranchMarkerReviewZoomScale(this.getCurrentViewportZoom()))
        if (controls.stopControl) nodeEl.appendChild(controls.stopControl)
        if (controls.reviewControls) {
            const content = nodeEl.querySelector<HTMLElement>(':scope > .workspace-branch-marker-content')
            const controlsHost = content ?? nodeEl
            controlsHost.appendChild(controls.reviewControls)
        }
    }

    private applyCapabilityRunEventToBranchMarkers = (threadId: string, event: CapabilityRunEvent): void => {
        if (!this.capabilityProgressRuns.apply(threadId, event)) return
        this.syncGeneratedOutputNodeFooters(this.currentCanvasState)
        this.refreshBranchMarkersForAiChatThread(threadId)
    }

    private createBranchMarkerGlobalProgress = (
        node: BranchMarkerNode,
        threadPreview: BranchMarkerConversationPreview | null,
        responseText: string,
    ): HTMLElement | null => {
        const instanceKey = `branch:${node.nodeId}`
        const state = buildBranchMarkerProgress({
            nodeId: node.nodeId,
            generationRequestId: node.generationRequestId,
            nodes: this.currentCanvasState?.nodes ?? [],
            capabilityRuns: [...(this.capabilityProgressRuns.get(getBranchMarkerThreadId(node))?.values() ?? [])],
            pending: this.isBranchMarkerPendingForUi(node),
            active: this.isBranchMarkerGenerationGroupActive(node),
            responseText,
            isReasoningReceiving: Boolean(threadPreview?.isReceiving),
            promptHandles: this.getBranchMarkerPromptTraceHandles(node, threadPreview),
            reasoningModelDescriptor: this.getBranchMarkerReasoningModelDescriptors(node)[0],
            mediaModelDescriptors: getBranchMarkerMediaModelCircleDescriptors(node, this.currentCanvasState?.nodes ?? []),
            updatedAt: Date.now(),
        })
        this.destroyMediaGenerationProgressInstance(instanceKey)
        if (!state) return null
        const progress = createMediaGenerationProgress({
            id: instanceKey,
            className: 'workspace-branch-marker-progress',
            showSummaryWhenCollapsedItemIds: ['understand-request'],
            ...this.getExecutionTraceTimelineDetail(),
            state,
        })
        this.mediaGenerationProgressInstances.set(instanceKey, progress)
        return progress.element
    }

    private createBranchMarkerContent = ({ node, label }: { node: BranchMarkerNode; label: string }): HTMLDivElement => {
        this.destroyBranchMarkerContent(node.nodeId)
        const contentLifetime = new Lifetime()
        this.branchMarkerContentLifetimes.set(node.nodeId, contentLifetime)
        const threadPreview = this.getBranchMarkerConversationPreview(node)
        const responseText = getBranchMarkerReasoningResponseText(node, threadPreview)
        const globalProgress = this.createBranchMarkerGlobalProgress(node, threadPreview, responseText)
        const resolutionOperation = this.currentCanvasState
            ? getMediaGenerationReferenceResolutionForMarker(this.currentCanvasState.nodes, node)
            : undefined
        const content = new BranchMarkerContent({
            document: this.paneEl.ownerDocument,
            label,
            headerHeight: node.dimensions.height,
            promptParts: this.getBranchMarkerPromptPartsForNode(node, threadPreview),
            renderReference: createCanvasPromptReferenceRenderer({ document: this.paneEl.ownerDocument, previewRenderer: this.getPromptReferencePreviewRenderer({ inlinePopover: true }) }),
            reasoningModel: this.getBranchMarkerReasoningModelEntry(node),
            mediaModels: this.getBranchMarkerMediaModelTooltipEntries(node).map(({ label, entry }) => ({
                ...entry,
                label,
                glassImage: this.branchMediaCircleStyles.getGlassImage(entry.color),
                textureImage: this.branchMediaCircleStyles.getTextureImage(entry.color),
            })),
            modelSummary: this.getBranchMarkerModelSummary(this.getBranchMarkerModelDetails(node)),
            responseText,
            responsePhase: threadPreview?.phase ?? 'preamble',
            responseIsReceiving: Boolean(threadPreview?.isReceiving),
            showResponseLine: this.shouldShowBranchMarkerResponseLine(node, threadPreview),
            pending: this.isBranchMarkerPendingForUi(node),
            active: this.isBranchMarkerGenerationGroupActive(node),
            tooltipHideDelayMs: this.host.settings.helpTooltip.interactiveHideDelayMs,
            progress: globalProgress ? { element: globalProgress, destroy: () => this.destroyMediaGenerationProgressInstance(`branch:${node.nodeId}`) } : null,
            referenceResolution: resolutionOperation ? this.createBranchMarkerReferenceResolution(resolutionOperation) : null,
        })
        contentLifetime.own(() => content.destroy())
        return content.element
    }

    private isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerNode => {
        return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }

    private isCurrentBranchMarkerPending = (nodeId: string): boolean => {
        const node = this.currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        return Boolean(
            node
                && this.isBranchMarkerNode(node)
                && !this.hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)
                && (node.pendingState || this.isBranchMarkerPendingForUi(node)),
        )
    }

    private handleBranchMarkerInfoClick = (nodeId: string): void => {
        const node = this.currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node || !this.isBranchMarkerNode(node)) {
            console.info('[CANVAS][branch-marker-info]', 'info-click-missing-node', { nodeId })
            return
        }

        const hasStartedMedia = this.hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)
        const pendingForUi = this.isBranchMarkerPendingForUi(node)
        const wouldHaveBeenBlockedByPendingState = this.isCurrentBranchMarkerPending(node.nodeId)
        console.info('[CANVAS][branch-marker-info]', 'info-click', {
            nodeId: node.nodeId,
            markerType: node.type,
            threadId: getBranchMarkerThreadId(node),
            generationRequestId: node.generationRequestId,
            pendingPhase: node.pendingState?.phase ?? '',
            uiPhase: this.getBranchMarkerUiPhase(node) ?? '',
            hasStartedMedia,
            pendingForUi,
            wouldHaveBeenBlockedByPendingState,
        })

        this.openGeneratedOutputDetails({ kind: 'branch-marker', nodeId: node.nodeId }, { toggle: true })
    }

    private getBranchMarkerTypeLabel = (node: BranchMarkerNode): string => {
        if (this.getBranchMarkerUiPhase(node) === 'preflight') return 'Preparing branch'
        if (node.type === 'branchOrigin') return 'Start branch'
        if (node.type === 'branchFork') return 'Fork branch'
        return 'Continue branch'
    }

    private syncBranchMarkerNodeContent = (node: BranchMarkerNode, nodeElOverride?: HTMLElement): void => {
        const nodeEl = nodeElOverride ?? this.findBranchMarkerNodeElForNode(node)
        if (!nodeEl) return
        const dragOverlay = nodeEl.querySelector('.branch-origin-drag-overlay, .branch-fork-drag-overlay, .branch-line-drag-overlay')
        const nextContent = this.createBranchMarkerContent({ node, label: this.getBranchMarkerTypeLabel(node) })
        nodeEl.insertBefore(nextContent, dragOverlay)
        this.syncBranchMarkerActions(node, nodeEl)
    }

    private syncBranchMarkerNodeContents = (): void => {
        if (!this.currentCanvasState) return
        for (const node of this.currentCanvasState.nodes) {
            if (this.isBranchMarkerNode(node)) this.syncBranchMarkerNodeContent(node)
        }
    }

    private createBranchMarkerNode = (node: BranchMarkerNode): HTMLElement => {
        const { nodeEl, dragOverlay, own } = this.nodeShells.createBranchMarker(node, () => this.handleBranchMarkerInfoClick(node.nodeId))
        own(() => this.destroyBranchMarkerContent(node.nodeId))
        const content = this.createBranchMarkerContent({ node, label: this.getBranchMarkerTypeLabel(node) })
        nodeEl.insertBefore(content, dragOverlay)
        this.syncBranchMarkerActions(node, nodeEl)
        return nodeEl
    }

    private handlePanePointerDown = (event: PointerEvent): void => {
        if (event.button !== 0 || !event.isPrimary) return
        if (!this.isCanvasBackgroundTarget(event.target)) return
        if (!this.currentCanvasState) return

        const start = this.getCanvasPointFromClient(event.clientX, event.clientY)
        const hitNodeId = this.getForegroundNodeHit(start)?.nodeId ?? null
        if (!hitNodeId) return

        this.suspendPanZoomForNodePointer(hitNodeId)
    }

    private handlePaneMouseMove = (event: MouseEvent): void => {
        if (this.nodeGestures.resizingNodeId) return

        if (!this.currentCanvasState || this.nodeGestures.draggingNodeId || this.marquee.active) {
            this.paneEl.style.cursor = ''
            return
        }

        if (!this.isCanvasBackgroundTarget(event.target)) {
            this.paneEl.style.cursor = ''
            return
        }

        const point = this.getCanvasPointFromClient(event.clientX, event.clientY)
        this.paneEl.style.cursor = this.getForegroundNodeHit(point) ? '' : ''
    }

    private handlePaneMouseLeave = (): void => {
        if (this.nodeGestures.resizingNodeId) return
        this.paneEl.style.cursor = ''
    }

    private handlePaneMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) return
        if (!this.isCanvasBackgroundTarget(event.target)) return
        if (!this.currentCanvasState) return
        this.canvasRuntime.cancelInteraction('replaced')

        const start = this.getCanvasPointFromClient(event.clientX, event.clientY)
        const nodeHit = this.getForegroundNodeHit(start)
        if (nodeHit) {
            this.handleDragStart(event, nodeHit.nodeId, { suppressPaneClick: true })
            return
        }

        if (this.isModSelectionEvent(event)) return

        event.preventDefault()
        event.stopPropagation()
        this.clearMarqueeInteractionState()
        this.marquee.start(event)
    }

    private getVisibleCanvasNodes = (state: CanvasState): CanvasNode[] => {
        const visible: CanvasNode[] = []
        const branchMarkerNodes = state.nodes.filter(
            (node: CanvasNode): node is BranchMarkerNode => this.isBranchMarkerNode(node),
        )
        const startedPlannedBranchMarkerNodeIds = new Set(
            branchMarkerNodes
                .filter(node => node.pendingState?.phase !== 'preflight')
                .filter(node => this.hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId))
                .map(node => node.nodeId),
        )
        const branchMarkerRenderOwnership = resolveBranchMarkerRenderOwnership(
            branchMarkerNodes,
            startedPlannedBranchMarkerNodeIds,
        )
        for (const node of state.nodes) {
            if (!isWorkspaceNodeType(node.type)) {
                console.warn(`Unknown canvas node type: ${node.type}`)
                continue
            }
            if (branchMarkerRenderOwnership.suppressedNodeIds.has(node.nodeId)) {
                const visibleOwnerNodeId = branchMarkerRenderOwnership.visibleOwnerBySuppressedNodeId.get(node.nodeId) ?? ''
                if (this.isBranchMarkerNode(node)) {
                    const visibleOwner = branchMarkerNodes.find(candidate => candidate.nodeId === visibleOwnerNodeId)
                    const logKey = `structural-owner:${node.nodeId}:${visibleOwnerNodeId}`
                    if (!this.branchMarkerHandoffDebugKeys.has(logKey)) {
                        this.branchMarkerHandoffDebugKeys.add(logKey)
                        console.info('[CANVAS] branch marker structural ownership', {
                            threadId: getBranchMarkerThreadId(node),
                            suppressedNodeId: node.nodeId,
                            suppressedPhase: node.pendingState?.phase ?? 'planned',
                            visibleOwnerNodeId,
                            visibleOwnerPhase: visibleOwner?.pendingState?.phase ?? 'planned',
                            visibleOwnerMediaStarted: startedPlannedBranchMarkerNodeIds.has(visibleOwnerNodeId),
                        })
                    }
                }
                continue
            }

            if (node.type === 'operationStatus') this.ensureMediaGenerationOperationRecovery(node)
            if (this.shouldRenderCanvasNode(node)) visible.push(node)
        }
        return visible
    }

    private renderNodes = () => {
        if (!this.currentCanvasState) return
        this.ensureConnectionManager()
        const shouldAnimatePanelOpenAfterRender = this.aiChatPanelState.isOpen && !this.rightPanel.element && this.rightPanel.hasRendered
        if (!this.rightPanel.isClosing) this.destroyActiveAiChatPanel(false)
        this.documentNodes.syncDocuments(this.currentDocuments)
        this.syncCanvasMediaLayer(this.currentCanvasState)

        const existingNodeIds = new Set(this.currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId))
        const prunedSelectedNodeIds = new Set(Array.from(this.selection.nodeIds).filter((nodeId) => existingNodeIds.has(nodeId)))
        if (prunedSelectedNodeIds.size !== this.selection.nodeIds.size) {
            this.selection.replace(prunedSelectedNodeIds, this.selection.fromMarquee)
        }

        this.updateNodeSelectionClasses(new Set(), this.selection.nodeIds)
        this.canvasMediaLayer?.setSelectedImageNodes(this.selection.nodeIds)
        this.updateSelectionGroupOverlayElement()
        this.updateSelectionDrivenUi()

        // Ensure edges render after a full rerender
        this.canvasMediaLayer?.sync(this.currentCanvasState)
        this.scheduleEdgesRender()

        this.renderActiveAiChatPanel({ animateOpen: shouldAnimatePanelOpenAfterRender })

        this.lastNodeStructureKey = getNodeStructureKey(this.currentCanvasState)
    }

    private getDocumentsKey = (docs: Document[]): string => {
        return docs.map((doc) => doc.documentId).sort().join(',')
    }

    private isDetachedCanvasThreadId = (threadId: string): boolean => {
        return threadId.startsWith('canvas-')
    }

    private hasDetachedCanvasRunCanvasProjection = (threadId: string): boolean => {
        if (!this.currentCanvasState) return false

        return this.currentCanvasState.nodes.some((node: CanvasNode) => {
            if (this.isBranchMarkerNode(node) && getBranchMarkerThreadId(node) === threadId) return true
            return (node.type === 'image' || node.type === 'video' || node.type === 'capabilityArtifact')
                && node.generatedBy?.conversationAssetId === threadId
        })
    }

    private isRecentDetachedCanvasThreadUpdate = (thread: AiChatThread): boolean => {
        const updatedAt = Number(thread.updatedAt)
        return Number.isFinite(updatedAt)
            && Date.now() - updatedAt <= this.DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS
    }

    private getAiChatThreadsKey = (threads: AiChatThread[]): string => {
        // Context-region threads render in the singleton side panel. Loading a
        // thread's ProseMirror content should refresh that panel, not tear down
        // every canvas node and PIXI/DOM proxy on the workspace surface.
        return threads
            .filter(t => !this.isDetachedCanvasThreadId(t.threadId))
            .map(t => `${t.threadId}:${t.content ? 'loaded' : 'pending'}`)
            .sort()
            .join(',')
    }

    private mergeIncomingAiChatThreads = (
        incomingThreads: AiChatThread[],
        canvasState: CanvasState | null,
        workspaceChanged: boolean,
    ): AiChatThread[] => {
        return this.conversationProjection.merge(incomingThreads, canvasState, workspaceChanged)
    }

    private clearWorkspaceVisualContent = (newDocuments: Document[], newAiChatThreads: AiChatThread[]): void => {
        this.generationPlacements.clear()
        this.mediaAnalysis.clear()
        this.outputReview.clear()
        this.conversationProjection.clear()
        this.detachedAiChatThreadEditors.clear()
        this.mediaOperationRecovery.clear()
        this.canvasGenerationSubmission.clear()
        this.capabilityProgressRuns.clear()
        this.destroyGeneratedMediaChromeControls()
        this.resetGeneratedMediaChromeSyncKey()
        this.destroyBranchMarkerContents()
        this.videoChrome.clear()
        this.selectionOverlay.reset()
        this.selection.clear()
        this.selectedEdgeId = null
        this.clearMarqueeInteractionState()
        this.canvasMediaLayer?.sync(null)
        this.connectionManager?.render()
        this.syncCanvasMediaLayer(null)
        this.lastNodeStructureKey = getNodeStructureKey(null)
        this.lastVisualSyncKey = getCanvasVisualSyncKey(null)
        this.lastDocumentsKey = this.getDocumentsKey(newDocuments)
        this.lastThreadsKey = this.getAiChatThreadsKey(newAiChatThreads)
    }

    private getWorkspaceLoadErrorMessage = (error: unknown): string => {
        const message = error instanceof Error
            ? error.message
            : typeof error === 'string'
            ? error
            : ''
        if (message.toLowerCase().includes('timeout')) {
            return 'The connection timed out while loading this workspace. Check the network connection and retry.'
        }
        return message
            ? `The workspace could not be loaded: ${message}`
            : 'The workspace could not be loaded. Check the network connection and retry.'
    }

    private initializePanZoom = () => {
        const initialViewport = this.currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 }
        this.syncViewportInteractionState(initialViewport)

        this.panZoom = this.canvasRuntime.installViewport({
            config: this.panZoomConfig,
            onTransformChange: this.panZoomConfig.onTransformChange,
            minZoom: 0.1,
            maxZoom: 2,
            onDraggingChange: (dragging: boolean) => {
                this.paneEl.classList.toggle('is-dragging', dragging)
            },
        })

        if (this.currentCanvasState?.viewport) {
            const vp = this.currentCanvasState.viewport
            this.syncViewportInteractionState(vp)
            this.viewportBridge?.applyViewport(vp)
            // Ensure handles match initial zoom
            this.updateResizeHandles(vp.zoom)
            this.panZoom.syncViewport(vp)
            this.persistedViewportApplied = true
        } else {
            this.updateResizeHandles(1)
        }
    }

    private captureSceneAdmission = (): () => boolean => {
        const workspaceId = this.workspaceId
        const scene = this.projectionOverrides
        return () => !this.rendererDestroyed && workspaceId === this.workspaceId && scene === this.projectionOverrides
    }

    private createWorkspaceLibraryPorts = (): WorkspaceLibraryPorts => {
        return {
            document: this.paneEl.ownerDocument,
            workspaceId: this.workspaceId,
            userId: this.host.workspace.userId() as string,
            assets: {
                list: query => this.host.assets.list(query),
                get: async (assetId, targetWorkspaceId) => {
                    const asset = await this.host.assets.get(assetId, targetWorkspaceId)
                    if (!('error' in asset)) this.host.assets.upsert(asset)
                    return asset
                },
                refresh: (assetId, targetWorkspaceId) => this.host.assets.refresh(assetId, targetWorkspaceId),
                updateMetadata: (assetId, revision, patch) => this.host.assets.updateMetadata(assetId, revision, patch),
                changeScope: (assetId, revision, scope, ownerId) => this.host.assets.changeScope(assetId, revision, scope, ownerId),
                resumeDocument: coordinate => this.host.assets.resumeDocument(coordinate),
                getDocument: (assetId, role) => this.host.assets.readDocument(assetId, role),
            },
            mountHistory: ({ host, asset, content }) =>
                this.editors.mountHistory({
                    mount: host,
                    content: content as never,
                    threadId: asset.lineage?.sourceConversationAssetId ?? asset.assetId,
                    documentType: 'assetProvenance',
                    contextPreview: this.getAiUserMessageContextPreviewRenderer(),
                    promptReferencePreviewRenderer: this.getPromptReferencePreviewRenderer(),
                    mediaGenerationProgress: ({ id, state, showSummaryWhenCollapsedItemIds }) =>
                        createMediaGenerationProgress({
                            id: `provenance:${asset.assetId}:${id}`,
                            state,
                            defaultExpanded: true,
                            showSummaryWhenCollapsedItemIds,
                            ...this.host.traceDetail({ previewRenderer: this.getPromptReferencePreviewRenderer() }),
                        }),
                }),
            onError: error => console.error('Workspace library failed:', error),
        }
    }

    private ensureMediaLibraryPanel = () => {
        if (!this.mediaLibraryPanelInstance) {
            const current = this.captureSceneAdmission()
            this.mediaLibraryPanelInstance = createMediaLibraryPanel({
                ...this.createWorkspaceLibraryPorts(),
                tooltipHideDelayMs: this.host.settings.helpTooltip.interactiveHideDelayMs,
                mountEditor: this.createAssetViewPorts().mountEditor,
                attestSubjectIdentity: (assetId, revision, classification) => this.host.assets.attestSubjectIdentity(assetId, revision, classification),
                removeFromLibrary: async assetId => await this.host.assets.detach({ assetId, referenceType: 'catalog' }) as { error?: string },
                prepareRenditionUrls: this.host.media.prepareRenditionUrls,
                onInsertAsset: async (item: AssetMeta) => {
                    if (!this.onAssetAttach || !current()) return false
                    const nodeId = `node-${this.host.createId()}`
                    const width = this.host.settings.mediaNode.image.defaultInsertionWidth
                    const aspectRatio = item.aspectRatio && item.aspectRatio > 0 ? item.aspectRatio : 1
                    const type = item.primaryCategory === 'document' ? 'mediaDocument' : item.primaryCategory
                    if (type === 'conversation') return false
                    const insertion = {
                        nodeId,
                        type,
                        assetId: item.assetId,
                        dimensions: type === 'audio' ? { width: 360, height: 96 } : { width, height: width / aspectRatio },
                    } as WorkspaceCanvasNodeInsertion
                    const nextState = this.insertNodeAtViewportCenterInternal(insertion, {}, false)
                    const committedState = await this.onAssetAttach({ assetId: item.assetId, nodeId, canvasState: nextState })
                    if (!current()) return false
                    this.commitTransientCanvasStatePreservingEditors(committedState)
                    return true
                },
            })
        }
        return this.mediaLibraryPanelInstance
    }

    private ensureArtifactLibraryPanel = () => {
        if (!this.artifactLibraryPanelInstance) {
            const current = this.captureSceneAdmission()
            this.artifactLibraryPanelInstance = createArtifactLibraryPanel({
                ...this.createWorkspaceLibraryPorts(),
                frontendRegistry: this.host.capabilities.frontend,
                sharedRegistry: this.host.capabilities.shared,
                ensureStyles: this.host.capabilities.ensureStyles,
                onInsertAsset: async (item: AssetMeta) => {
                    if (!this.onAssetAttach || !item.artifactTypeId || !current()) return false
                    const nodeId = `node-${this.host.createId()}`
                    const insertion: WorkspaceCanvasNodeInsertion = {
                        nodeId,
                        type: 'capabilityArtifact',
                        artifactTypeId: item.artifactTypeId,
                        assetId: item.assetId,
                        dimensions: { ...this.host.capabilities.frontend.require(item.artifactTypeId).initialCanvasDimensions },
                    }
                    const nextState = this.insertNodeAtViewportCenterInternal(insertion, {}, false)
                    const committedState = await this.onAssetAttach({ assetId: item.assetId, nodeId, canvasState: nextState })
                    if (!current()) return false
                    this.commitTransientCanvasStatePreservingEditors(committedState)
                    return true
                },
                onAcceptAsset: async (asset) => {
                    if (!current()) return false
                    const node = this.currentCanvasState?.nodes.find(candidate => (
                        candidate.type === 'capabilityArtifact' && candidate.assetId === asset.assetId
                    ))
                    if (!node) return false
                    const result = await this.host.assets.reviewGeneratedOutput({
                        workspaceId: this.workspaceId,
                        scope: 'output-node',
                        action: 'accept',
                        nodeId: node.nodeId,
                    })
                    if ('error' in result || !current() || result.workspaceId !== this.workspaceId) return false
                    this.applyApiCanvasGeometry(result.canvasGeometry)
                    return true
                },
            })
        }
        return this.artifactLibraryPanelInstance
    }

    private ensureCapabilityLibraryPanel = (): CapabilityLibraryPanelInstance => {
        if (!this.capabilityLibraryPanelInstance) {
            const current = this.captureSceneAdmission()
            this.capabilityLibraryPanelInstance = createCapabilityLibraryPanel({
                document: this.paneEl.ownerDocument,
                client: this.host.capabilities.catalog(
                    this.workspaceId,
                    this.host.workspace.organizationId() as string,
                ),
                onAttach: (reference) => {
                    if (!current()) return
                    const view = this.globalCanvasComposer?.input.editorView
                    const nodeType = view?.state.schema.nodes.prompt_reference
                    if (!view || !nodeType) return
                    const atom = nodeType.create({
                        referenceType: reference.kind,
                        capabilityId: reference.capabilityId,
                        displayName: reference.displayName,
                    })
                    const tr = view.state.tr.replaceSelectionWith(atom).insertText(' ').scrollIntoView()
                    view.dispatch(tr)
                    view.focus()
                    this.globalCanvasComposer?.input.triggerGradientAnimation()
                },
            })
        }
        return this.capabilityLibraryPanelInstance
    }

    private destroyCapabilityLibraryPanel = (): void => {
        this.capabilityLibraryPanelInstance?.destroy()
        this.capabilityLibraryPanelInstance = null
    }

    private releaseWorkspaceLibraries = (): void => {
        const cleanup = new Lifetime()
        const media = this.mediaLibraryPanelInstance
        const artifact = this.artifactLibraryPanelInstance
        const capability = this.capabilityLibraryPanelInstance
        this.mediaLibraryPanelInstance = null
        this.artifactLibraryPanelInstance = null
        this.capabilityLibraryPanelInstance = null
        cleanup.own(() => media?.destroy())
        cleanup.own(() => artifact?.destroy())
        cleanup.own(() => capability?.destroy())
        cleanup.destroy()
    }

    private openRightSidePanelToMode = (mode: CanvasRightSidePanelMode): void => {
        const alreadyOnMode = this.aiChatPanelState.isOpen && this.aiChatPanelState.topLevelMode === mode
        this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: true, topLevelMode: mode }
        this.persistAiChatSidebarState()
        if (!alreadyOnMode) this.syncActiveAiChatPanelFromState()
        this.renderActiveAiChatPanel()
    }

    private insertNodeAtViewportCenterInternal = (
        node: WorkspaceCanvasNodeInsertion,
        statePatch: WorkspaceCanvasInsertionStatePatch = {},
        persist = true,
    ) => {
        const baseCanvasState: CanvasState = this.currentCanvasState ?? {
            viewport: this.getLiveViewport(),
            edges: [],
            nodes: [],
        }
        const positionedNode = {
            ...node,
            position: this.getCenteredInsertionPosition(node.dimensions),
        } as CanvasNode
        const preparedNode = positionedNode
        const newCanvasState: CanvasState = {
            ...baseCanvasState,
            ...statePatch,
            viewport: baseCanvasState.viewport,
            edges: baseCanvasState.edges ?? [],
            nodes: this.resolveTopLevelNodeCollisions([...baseCanvasState.nodes, preparedNode]),
        }

        if (persist) {
            this.pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(newCanvasState)
            this.onCanvasStateChange?.(newCanvasState)
        }

        return newCanvasState
    }

    getCanvasState = () => {
        if (this.rendererDestroyed) return null
        return this.currentCanvasState
            ? { ...this.currentCanvasState, viewport: this.getLiveViewport() }
            : null
    }

    getViewport = () => {
        return this.getLiveViewport()
    }

    setViewport = (nextViewport: Viewport) => {
        if (this.rendererDestroyed) return
        const vp = { x: nextViewport.x, y: nextViewport.y, zoom: nextViewport.zoom }
        this.updateCurrentCanvasViewport(vp)
        this.syncViewportInteractionState(vp)
        this.viewportBridge?.applyViewport(vp)
        this.panZoom?.syncViewport(vp)
        this.updateResizeHandles(vp.zoom)
        this.updateGeneratedMediaChromeLayout()
        this.scheduleEdgesRender()
        this.persistedViewportApplied = true
    }

    insertNodeAtViewportCenter = (node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}, commit = true) => {
        if (this.rendererDestroyed) return null
        return this.insertNodeAtViewportCenterInternal(node, statePatch, commit)
    }

    replaceUploadPlaceholder = (placeholderNodeId: string, node: WorkspaceCanvasNodeInsertion, commit = true) => {
        if (this.rendererDestroyed) return null
        return this.replaceUploadPlaceholderInternal(placeholderNodeId, node, commit)
    }

    commitTransientCanvasState = (canvasState: CanvasState) => {
        if (this.rendererDestroyed) return
        this.commitTransientCanvasStatePreservingEditors(canvasState)
    }

    commitTransientCanvasNodeInsertion = (
        canvasState: CanvasState,
        nodeId: string,
        replacedPlaceholderNodeId?: string,
    ) => {
        if (this.rendererDestroyed) return
        this.commitTransientCanvasNodeInsertionToScene(canvasState, nodeId, replacedPlaceholderNodeId)
    }

    markUploadPlaceholderFailed = (placeholderNodeId: string, message: string) => {
        if (this.rendererDestroyed) return
        return this.markUploadPlaceholderFailedInternal(placeholderNodeId, message)
    }

    render = (newCanvasState: CanvasState | null, newDocuments: Document[], newAiChatThreads: AiChatThread[] = [], newWorkspaceId?: string) => {
        if (this.rendererDestroyed) return
        const transitionPlan = planWorkspaceRenderTransition({
            currentRouteWorkspaceId: this.workspaceId,
            nextRouteWorkspaceId: newWorkspaceId,
            renderedWorkspaceId: this.renderedWorkspaceId,
            incomingCanvasState: newCanvasState,
            loadingStatus: this.lastWorkspaceLoadingStatus,
        })
        const workspaceChanged = transitionPlan.shouldTreatAsWorkspaceChanged
        if (workspaceChanged) {
            this.detachedAiChatThreadEditors.clear()
            this.releaseWorkspaceLibraries()
            const composer = this.globalCanvasComposer
            this.globalCanvasComposer = null
            composer?.destroy()
        }
        this.workspaceId = transitionPlan.routeWorkspaceId
        this.workspaceLoadingOutline?.setVisible(transitionPlan.shouldShowLoadingOutline)
        if (workspaceChanged) this.pendingLocalCanvasVisualCommit = null

        const pendingVisualCommitBeforeMerge = this.pendingLocalCanvasVisualCommit
        const renderStatePlan = mergeIncomingCanvasStateWithPendingVisualCommit({
            incomingState: newCanvasState,
            pendingVisualCommit: pendingVisualCommitBeforeMerge,
        })
        const normalizedCanvasState = renderStatePlan.state
            ? this.normalizeBranchMarkerDimensions(renderStatePlan.state)
            : renderStatePlan.state
        this.pendingLocalCanvasVisualCommit = renderStatePlan.pendingVisualCommit
        if (pendingVisualCommitBeforeMerge || renderStatePlan.usedPendingVisualState || renderStatePlan.acknowledgedPendingVisualState) {
            if (this.debugLoggingEnabled) {
                console.info('[CANVAS][render-state]', 'pending-visual-merge', {
                    incomingNodeCount: newCanvasState?.nodes.length ?? 0,
                    incomingEdgeCount: newCanvasState?.edges.length ?? 0,
                    incomingNodeIds: newCanvasState?.nodes.map((node) => node.nodeId) ?? [],
                    pendingNodeCount: pendingVisualCommitBeforeMerge?.state.nodes.length ?? 0,
                    pendingEdgeCount: pendingVisualCommitBeforeMerge?.state.edges.length ?? 0,
                    pendingNodeIds: pendingVisualCommitBeforeMerge?.state.nodes.map((node) => node.nodeId) ?? [],
                    resultNodeCount: normalizedCanvasState?.nodes.length ?? 0,
                    resultEdgeCount: normalizedCanvasState?.edges.length ?? 0,
                    resultNodeIds: normalizedCanvasState?.nodes.map((node) => node.nodeId) ?? [],
                    usedPendingVisualState: renderStatePlan.usedPendingVisualState,
                    acknowledgedPendingVisualState: renderStatePlan.acknowledgedPendingVisualState,
                    clearedPendingVisualCommit: Boolean(pendingVisualCommitBeforeMerge && !renderStatePlan.pendingVisualCommit),
                })
            }
        }
        const incomingMatchesLocalVisualCommit = renderStatePlan.usedPendingVisualState || renderStatePlan.acknowledgedPendingVisualState
        const shouldResetStaleMediaAnalysis = workspaceChanged || (!this.currentCanvasState && Boolean(normalizedCanvasState) && !incomingMatchesLocalVisualCommit)
        const mediaAnalysisState = shouldResetStaleMediaAnalysis && normalizedCanvasState
            ? this.resetStaleAnalyzingMediaDescriptors(normalizedCanvasState)
            : { state: normalizedCanvasState, changed: false }
        const persistedCanvasState = mediaAnalysisState.state
        const effectiveCanvasState = workspaceChanged
            ? persistedCanvasState
            : this.preserveActiveGeneratedMediaTrackersInState(persistedCanvasState)
        if (mediaAnalysisState.changed && persistedCanvasState) {
            this.pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(persistedCanvasState)
            this.onCanvasStateChange?.(persistedCanvasState)
        }

        // Stale drag/resize positions from a previous workspace would corrupt
        // getNodeWorldPosition for the new workspace's nodes.
        if (workspaceChanged) {
            this.canvasRuntime.cancelInteraction('scene-change')
            this.releasePanZoomForNodePointer()
            this.liveNodeOverrides.clear()
            this.projectionOverrides = this.liveNodeOverrides.createScope()
            this.branchMarkerProjectionOverrideNodeIds.clear()
            this.manuallyPositionedBranchMarkerNodeIds.clear()
            this.selection.clear()
            this.selectedEdgeId = null
            this.nodeGestures.clear()
            this.nodeDeletion.clear()
            this.generationPlacements.clear()
            this.mediaAnalysis.clear()
            this.outputReview.clear()
            this.conversationProjection.clear()
            this.mediaTrackers.clear()
            this.generationVisuals.clear()
        }

        // Only node structure and workspace identity rebuild the canvas DOM.
        // Document and thread hydration update their mounted surfaces in place.
        const mergedAiChatThreads = this.mergeIncomingAiChatThreads(
            newAiChatThreads,
            effectiveCanvasState,
            workspaceChanged,
        )
        const nextNodeStructureKey = getNodeStructureKey(effectiveCanvasState)
        const nextDocumentsKey = this.getDocumentsKey(newDocuments)
        const nextThreadsKey = this.getAiChatThreadsKey(mergedAiChatThreads)
        const nodeStructureChanged = nextNodeStructureKey !== this.lastNodeStructureKey
        const documentsKeyChanged = nextDocumentsKey !== this.lastDocumentsKey
        const threadsKeyChanged = nextThreadsKey !== this.lastThreadsKey
        const needsRerender = nodeStructureChanged || workspaceChanged

        // Check if viewport actually changed (not just nodes)
        const oldViewport = this.currentCanvasState?.viewport
        const newViewport = effectiveCanvasState?.viewport
        const viewportChanged = !oldViewport || !newViewport
            || oldViewport.x !== newViewport.x
            || oldViewport.y !== newViewport.y
            || oldViewport.zoom !== newViewport.zoom
        const nextVisualSyncKey = getCanvasVisualSyncKey(effectiveCanvasState)
        const visualStateChanged = workspaceChanged || nextVisualSyncKey !== this.lastVisualSyncKey
        if (
            needsRerender
            || visualStateChanged
            || pendingVisualCommitBeforeMerge
            || renderStatePlan.usedPendingVisualState
            || renderStatePlan.acknowledgedPendingVisualState
            || this.aiChatPanelState.generatedOutputDetailsTarget !== undefined
        ) {
            if (this.debugLoggingEnabled) {
                console.info('[CANVAS][render-state]', 'decision', {
                    workspaceChanged,
                    needsRerender,
                    nodeStructureChanged,
                    documentsKeyChanged,
                    threadsKeyChanged,
                    viewportChanged,
                    visualStateChanged,
                    usedPendingVisualState: renderStatePlan.usedPendingVisualState,
                    acknowledgedPendingVisualState: renderStatePlan.acknowledgedPendingVisualState,
                    hasPendingVisualCommit: Boolean(pendingVisualCommitBeforeMerge),
                    incomingNodeCount: newCanvasState?.nodes.length ?? 0,
                    effectiveNodeCount: effectiveCanvasState?.nodes.length ?? 0,
                    incomingNodeIds: newCanvasState?.nodes.map((node) => node.nodeId).join(',') ?? '',
                    effectiveNodeIds: effectiveCanvasState?.nodes.map((node) => node.nodeId).join(',') ?? '',
                    previousNodeStructureKeyLength: this.lastNodeStructureKey.length,
                    nextNodeStructureKeyLength: nextNodeStructureKey.length,
                    previousDocumentsKey: this.lastDocumentsKey,
                    nextDocumentsKey,
                    previousThreadsKey: this.lastThreadsKey,
                    nextThreadsKey,
                    previousVisualSyncKeyLength: this.lastVisualSyncKey.length,
                    nextVisualSyncKeyLength: nextVisualSyncKey.length,
                    generatedOutputDetailsTarget: this.aiChatPanelState.generatedOutputDetailsTarget
                        ? `${this.aiChatPanelState.generatedOutputDetailsTarget.kind}:${this.aiChatPanelState.generatedOutputDetailsTarget.nodeId}`
                        : '',
                })
            }
        }
        const liveViewport = this.getLiveViewport()
        const shouldPreserveLiveViewport = shouldPreserveLiveViewportForScene({
            incomingViewport: effectiveCanvasState?.viewport,
            liveViewport,
            sceneChanged: workspaceChanged,
        })

        this.currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState
            ? { ...effectiveCanvasState, viewport: liveViewport }
            : effectiveCanvasState
        this.currentDocuments = newDocuments
        this.currentAiChatThreads = mergedAiChatThreads
        this.syncActiveAiChatPanelFromState()

        // 1. Rebuild DOM first so image nodes exist when PIXI syncs DOM ownership.
        if (transitionPlan.shouldClearVisualContent) {
            this.clearWorkspaceVisualContent(newDocuments, mergedAiChatThreads)
        } else if (needsRerender) {
            this.renderNodes()
        } else {
            this.documentNodes.syncDocuments(this.currentDocuments)
            this.syncBranchMarkerNodeContents()
            if (
                this.aiChatPanelState.generatedOutputDetailsTarget
                && this.rightPanel.element
                && (documentsKeyChanged || threadsKeyChanged)
            ) {
                this.renderActiveAiChatPanel({ preserveModeSwitch: true, animateOpen: false })
            } else if (threadsKeyChanged && this.aiChatPanelState.isOpen) {
                this.renderActiveAiChatPanel()
            }
            if (this.aiChatPanelState.isOpen && !this.rightPanel.element) this.renderActiveAiChatPanel()
            if (!this.aiChatPanelState.isOpen && this.rightPanel.element && !this.rightPanel.isClosing) this.destroyActiveAiChatPanel(false)
        }
        this.lastDocumentsKey = nextDocumentsKey
        this.lastThreadsKey = nextThreadsKey
        if (this.currentCanvasState) this.renderedWorkspaceId = this.workspaceId
        this.refreshBranchMarkerPreviewsForLoadedThreads(mergedAiChatThreads)

        // 2. Sync PIXI state BEFORE applying the viewport. This ensures
        //    `lastState` inside the PIXI layer is already the new workspace's
        //    canvas state when `setViewport` fires. Without this ordering, a
        //    zoom-tier change during workspace switch would call
        //    `upsertAllImages(OLD_STATE)`, spawning async texture fetches for
        //    the old workspace's images that arrive and overwrite new sprites.
        if (this.currentCanvasState && this.connectionManager && (visualStateChanged || needsRerender)) {
            if (!needsRerender) this.syncCanvasNodeDomGeometry(this.currentCanvasState.nodes)
            this.canvasMediaLayer?.sync(this.currentCanvasState)
            this.scheduleEdgesRender()
            this.syncCanvasMediaLayer(this.currentCanvasState)
            this.lastVisualSyncKey = getCanvasVisualSyncKey(this.currentCanvasState)
        }

        // Video controls need native playback entries. Those entries are
        // created by syncCanvasMediaLayer, so media chrome must sync after the
        // PIXI/media-registry pass.
        this.syncGeneratedMediaChrome(this.currentCanvasState)

        // 3. Apply viewport after PIXI sync. `setViewport` may trigger
        //    `upsertAllImages(lastState)` on a tier change, but `lastState`
        //    is now the new workspace state, so no old sprites are created.
        if (viewportChanged && effectiveCanvasState?.viewport) {
            const viewportInteractionLocked = this.panZoom?.locked ?? false
            if (shouldPreserveLiveViewport) {
                this.panZoom?.syncViewport(liveViewport)
            } else if (viewportInteractionLocked) {
                const lockedViewport = this.getLiveViewport()
                if (this.currentCanvasState) this.currentCanvasState = { ...this.currentCanvasState, viewport: lockedViewport }
                this.panZoom?.syncViewport(lockedViewport)
            } else {
                const vp = effectiveCanvasState.viewport
                this.syncViewportInteractionState(vp)
                this.viewportBridge?.applyViewport(vp)
                this.panZoom?.syncViewport(vp)
            }
            if (
                oldViewport?.x !== this.currentCanvasState?.viewport?.x
                || oldViewport?.y !== this.currentCanvasState?.viewport?.y
                || oldViewport?.zoom !== this.currentCanvasState?.viewport?.zoom
            ) {
                this.updateGeneratedMediaChromeLayout()
            }
        }
        if (effectiveCanvasState) this.persistedViewportApplied = true
        this.reattachDetachedCanvasRunListenersForActiveMarkers()
        if (workspaceChanged) this.createGlobalCanvasComposer()
    }

    toggleMediaLibrary = () => {
        if (this.rendererDestroyed) return
        if (this.aiChatPanelState.isOpen && this.aiChatPanelState.topLevelMode === 'media') {
            void this.closeAiChatPanel()
            return
        }
        this.openRightSidePanelToMode('media')
    }

    toggleAiChatPanel = () => {
        if (this.rendererDestroyed) return
        this.toggleAiChatPanelVisibility()
    }

    destroy = () => {
        if (this.rendererDestroyed) return
        this.rendererDestroyed = true
        const cleanup = new Lifetime()
        cleanup.own(() => {
            this.paneEl?.removeEventListener('click', this.handlePaneClick)
        })
        cleanup.own(() => {
            this.contextTrays?.destroy()
        })
        cleanup.own(() => {
            this.globalCanvasComposer = null
        })
        cleanup.own(() => {
            this.globalCanvasComposer?.destroy()
        })
        cleanup.own(() => {
            this.canvasBubbleMenu = null
        })
        cleanup.own(() => {
            this.canvasBubbleMenu?.destroy()
        })
        cleanup.own(() => {
            this.generationPlacements?.clear()
        })
        cleanup.own(() => {
            this.mediaTrackers?.destroy()
        })
        cleanup.own(() => {
            this.detachedAiChatThreadEditors?.destroy()
        })
        cleanup.own(() => {
            this.documentNodes?.destroy()
        })
        cleanup.own(() => {
            this.workspaceLoadingOutline = null
        })
        cleanup.own(() => {
            this.workspaceLoadingOutline?.destroy()
        })
        cleanup.own(() => {
            this.canvasMediaLayer = null
        })
        cleanup.own(() => {
            this.canvasMediaLayer?.destroy()
        })
        cleanup.own(() => {
            this.mediaChromeViewportEl = null
        })
        cleanup.own(() => {
            this.mediaChromeViewportEl?.remove()
        })
        cleanup.own(() => {
            this.videoChrome?.destroy()
        })
        cleanup.own(() => {
            this.mediaGenerationProgressInstances?.clear()
        })
        cleanup.own(() => {
            const progressCleanup = new Lifetime()
            for (const progress of this.mediaGenerationProgressInstances?.values() ?? []) progressCleanup.own(() => progress.destroy())
            progressCleanup.destroy()
        })
        cleanup.own(() => {
            if (this.branchMarkerContentLifetimes) this.destroyBranchMarkerContents()
        })
        cleanup.own(() => {
            this.outputChrome?.invalidate()
        })
        cleanup.own(() => {
            this.canvasAssetViews?.destroy()
        })
        cleanup.own(() => {
            if (this.outputChrome && this.canvasAssetViews) this.destroyGeneratedMediaChromeControls()
        })
        cleanup.own(() => {
            this.viewportBridge = null
        })
        cleanup.own(() => {
            this.connectionManager = null
        })
        cleanup.own(() => {
            this.generationVisuals?.destroy()
        })
        cleanup.own(() => {
            this.conversationProjection?.destroy()
        })
        cleanup.own(() => {
            this.outputReview?.destroy()
        })
        cleanup.own(() => {
            this.mediaAnalysis?.destroy()
        })
        cleanup.own(() => {
            if (typeof this.transformSideEffectsRaf === 'number') {
                this.window.cancelAnimationFrame(this.transformSideEffectsRaf)
                this.transformSideEffectsRaf = null
            }
        })
        cleanup.own(() => {
            if (typeof this.generatedOutputDetailsRefreshRaf === 'number') {
                this.window.cancelAnimationFrame(this.generatedOutputDetailsRefreshRaf)
                this.generatedOutputDetailsRefreshRaf = null
            }
        })
        cleanup.own(() => {
            this.outputChrome?.destroy()
        })
        cleanup.own(() => {
            if (typeof this.edgesRaf === 'number') {
                this.window.cancelAnimationFrame(this.edgesRaf)
                this.edgesRaf = null
            }
        })
        cleanup.own(() => {
            if (this.paneEl) this.paneEl.style.cursor = ''
        })
        cleanup.own(() => {
            this.paneEl?.removeEventListener('mousedown', this.handlePaneMouseDown, true)
        })
        cleanup.own(() => {
            this.paneEl?.removeEventListener('mouseleave', this.handlePaneMouseLeave)
        })
        cleanup.own(() => {
            this.paneEl?.removeEventListener('mousemove', this.handlePaneMouseMove, true)
        })
        cleanup.own(() => {
            this.paneEl?.removeEventListener('pointerdown', this.handlePanePointerDown, true)
        })
        cleanup.own(() => {
            this.unsubscribeWorkspaceStore?.()
        })
        cleanup.own(() => {
            this.unsubscribeAssetsStore?.()
        })
        cleanup.own(() => {
            this.unsubscribeAiModelsStore?.()
        })
        cleanup.own(() => {
            this.nodeShells?.destroy()
        })
        cleanup.own(() => {
            this.unlockCanvasScrollLayers?.()
        })
        cleanup.own(() => {
            this.resizeObserver?.disconnect()
        })
        cleanup.own(() => {
            this.releaseWorkspaceLibraries()
        })
        cleanup.own(() => {
            this.rightPanel?.destroy()
        })
        cleanup.own(() => {
            this.nodeGestures?.destroy()
        })
        cleanup.own(() => {
            this.capabilityProgressRuns?.clear()
        })
        cleanup.own(() => {
            this.branchMediaCircleStyles?.clear()
        })
        cleanup.own(() => {
            this.generationEvents?.destroy()
        })
        cleanup.own(() => {
            this.apiCanvasGeometry?.destroy()
        })
        cleanup.own(() => {
            this.generationHandlers?.destroy()
        })
        cleanup.own(() => {
            this.mediaOperationRecovery?.destroy()
        })
        cleanup.own(() => {
            this.canvasGenerationSubmission?.destroy()
        })
        cleanup.own(() => {
            this.nodeDeletion?.destroy()
        })
        cleanup.own(() => {
            this.projectionOverrides?.destroy()
        })
        cleanup.own(() => {
            this.callbacks.destroy()
        })
        cleanup.destroy()
    }
}

export function createWorkspaceCanvas(options: WorkspaceCanvasOptions, host: WorkspaceCanvasHost): LixpiWorkspaceCanvas {
    return new LixpiWorkspaceCanvas(options, host)
}
