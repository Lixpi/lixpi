import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'
import {
    type WorkspacePromptCatalog,
} from './workspace-canvas-editors.ts'
import {
    type WorkspaceCanvasDocument as Document,
    type WorkspaceCanvasConversation as AiChatThread,
} from './workspace-canvas-surface.ts'
import { WorkspaceGenerationContext } from '../../shared/generation/workspace-generation-context.ts'
import {
    WorkspaceNodeDeletion,
    WorkspaceMediaTrackers,
    WorkspaceApiCanvasGeometry,
    WorkspaceGenerationSettlement,
    WorkspacePreflightMarkers,
    WorkspaceBranchMarkerHandoff,
    WorkspaceLineageProjection,
    WorkspaceGenerationPlacements,
    WorkspaceGeometry,
    WorkspaceConversationProjection,
    WorkspaceMediaOperationRecovery,
    WorkspaceMediaAnalysis,
    WorkspaceHistory,
    getBranchMarkerThreadId,
    WorkspaceReferenceProjection,
    WorkspaceBranchActivity,
    CanvasGenerationSubmission,
    CanvasGenerationEvents,
    createPendingCanvasVisualCommit,
    getCanvasVisualSyncKey,
    getNodeStructureKey,
    updatePendingCanvasVisualCommitViewport,
    BranchCapabilityProgress,
    buildBranchMarkerProgress,
    getAiChatPanelState,
    setAiChatPanelState,
    type WorkspaceBranchMarkerSettlementOptions as BranchMarkerSettlementOptions,
    type PendingGeneratedImagePlacement,
    type BranchMarkerUiPhase,
    type GeneratedOutputCanvasNode,
    type BranchMarkerPromptPart,
    type GeneratedMediaRebalancePipeline,
    type BranchMarkerNode,
    type CanvasGeometry,
    type PendingCanvasVisualCommit,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import {
    WorkspaceNodeGestures,
    CanvasConversationRun,
    WorkspaceConversationRuns,
    WorkspaceRightPanel,
} from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    defaultPanZoomConfig,
    createViewportBridge,
    type ViewportController,
    type ViewportBridge,
} from '@lixpi/canvas-engine/frontend/viewport'

import {
    CapabilityModulePromiseCache,
    createCanvasPromptReferenceRenderer,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import {
    Lifetime,
    createNodeLayerManager,
    lockCanvasScrollLayers,
    type CanvasConnectionControls,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    WorkspaceNodeShells,
    WorkspaceDomNodes,
    WorkspaceDocumentNodes,
    WorkspaceCapabilityNode,
    createBranchReferenceResolution,
    type WorkspaceDocumentEditorOptions,
} from '@lixpi/canvas-components-lixpi-specific/frontend/nodes'
import {
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeToScreenForZoom,
    scaleCanvasChromeWorldSizeForZoom,
    type ViewportSnapshot as Viewport,
    type CanvasEngineRect as Rect,
} from '@lixpi/canvas-engine/shared'
import {
    LoadingStatus,
    type CanvasState,
    type CanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type CapabilityArtifactCanvasNode,
    type OperationStatusCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
    type WorkspaceEdge,
    type CanvasAiChatPanelState,
    type CanvasRightSidePanelMode,
    type AssetMeta,
    type CanvasGeometryUpdate,
    type CapabilityRunEvent,
    type ContentDescriptor,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
    type MediaGenerationRunMeta,
    type AiInteractionMediaGenerationRequest,
    type MediaPromptReference,
} from '@lixpi/constants'
import {
    WorkspacePromptComposer,
    type AiPromptComposerSubmitData,
} from '@lixpi/canvas-components-lixpi-specific/frontend/composer'
import {
    type BranchMarkerConversationPreview,
} from '@lixpi/prosemirror/shared/thread-doc'
import { arrowRightIcon } from '@lixpi/ui-kit/svg'

import { extractSvgPathIcon } from '@lixpi/ui-primitives/svg'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'

import {
    createMediaGenerationProgress,
    type MediaGenerationProgressInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/progress'
import {
    WorkspaceOutputReview,
    WorkspaceAssetViews,
} from '@lixpi/canvas-components-lixpi-specific/frontend/review'

import {
    WorkspaceGenerationHandlers,
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
import { WorkspaceCanvasLibraries } from './workspace-canvas-libraries.ts'
import { WorkspaceBranchMarkerModels } from './workspace-branch-marker-models.ts'
import { WorkspaceMediaGeometry } from './workspace-media-geometry.ts'
import { WorkspaceCanvasSelection } from './workspace-canvas-selection.ts'
import { WorkspaceBranchMarkerGeneration } from './workspace-branch-marker-generation.ts'
import { WorkspaceOperationStatusNodes } from './workspace-operation-status-nodes.ts'
import { WorkspaceBranchMarkerPresentation } from './workspace-branch-marker-presentation.ts'
import { WorkspaceMediaReplacement } from './workspace-media-replacement.ts'
import { WorkspaceCanvasContext } from './workspace-canvas-context.ts'
import { WorkspaceBranchMarkerProjection } from './workspace-branch-marker-projection.ts'
import { WorkspaceGeneratedOutputDetails } from './workspace-generated-output-details.ts'
import { WorkspaceCanvasInteractions } from './workspace-canvas-interactions.ts'
import {
    applyWorkspaceCanvasTheme,
    getWorkspaceRightPanelCssProperties,
} from './workspace-canvas-theme.ts'
import { WorkspaceCanvasRendering } from './workspace-canvas-rendering.ts'
import { destroyWorkspaceCanvasResources } from './workspace-canvas-cleanup.ts'
import { WorkspaceCanvasVisibility } from './workspace-canvas-visibility.ts'
import { WorkspaceCanvasAssets } from './workspace-canvas-assets.ts'
import { WorkspaceCanvasThreadState } from './workspace-canvas-thread-state.ts'
import {
    type DragStartOptions,
    type ResizeHandle,
    type WorkspaceCanvasInsertionStatePatch,
    type WorkspaceCanvasNodeInsertion,
    type WorkspaceCanvasOptions,
} from './workspace-canvas-contracts.ts'

export {
    type WorkspaceCanvasOptions,
} from './workspace-canvas-contracts.ts'
const NODE_DRAG_START_THRESHOLD_PX = 6
// Must match the `workspace-branch-marker-spin` animation duration in
// workspace-canvas.scss (0.8s). Used to phase-align recreated spinners to a
// shared rotation clock so the spinner never visibly restarts.
const GENERATED_IMAGE_COMPLETION_OUTLINE_FALLBACK_MS = 30000
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
    private readonly selectionStyles
    private readonly mediaModelCircleSettings
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
    private edgesRaf: number | null
    private transformSideEffectsRaf: number | null
    private pendingHandleZoom: number | null
    private readonly canvasAssetViews
    private readonly assets
    private readonly generationContext
    private readonly generationEvents
    private readonly generationPlacements
    private readonly mediaGenerationProgressInstances
    private readonly capabilityProgressRuns
    private readonly detachedAiChatThreadEditors
    private readonly nodeLayerManager
    private readonly documentNodes
    private readonly referenceProjection
    private readonly branchActivity
    private readonly workspaceHistory
    private readonly branchMarkerModels
    private readonly branchMarkerPresentation
    private readonly branchMarkerProjection
    private readonly outputDetails
    private globalCanvasComposer: WorkspacePromptComposer | null
    private readonly DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS
    private readonly context
    private readonly libraries
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
    private readonly mediaGeometry
    private readonly mediaReplacement
    private readonly canvasRuntime
    private readonly liveNodeOverrides
    private readonly workspaceGeometry
    private readonly lineageProjection
    private readonly markerHandoff
    private readonly preflightMarkers
    private readonly generationSettlement
    private readonly apiCanvasGeometry
    private readonly selection
    private readonly selectionController
    private readonly mediaOperationRecovery
    private readonly conversationProjection
    private readonly threadState
    private readonly canvasGenerationSubmission
    private readonly mediaAnalysis
    private readonly outputReview
    private projectionOverrides
    private projectionSceneKey
    private readonly videoChrome
    private readonly outputChrome
    private readonly interactions
    private canvasToastEl: HTMLElement | null
    private readonly nodeGestures
    private readonly nodeDeletion
    private readonly rightPanel
    private readonly pendingGeneratedImagePlacements
    private readonly pendingBranchMarkers
    private readonly branchMarkerUiPhaseByNodeId
    private readonly generationHandlers
    private readonly branchMarkerGeneration
    private readonly operationStatusNodes
    private readonly visibility
    private readonly rendering
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
            this.selectionStyles = this.host.settings.selection.styles
            this.mediaModelCircleSettings = this.host.settings.mediaBranchLineage.mediaModelCircle
            applyWorkspaceCanvasTheme(this.paneEl, this.host.settings)
            this.host.models.styleBadge(this.paneEl)
            this.normalizedInitialCanvasState = this.options.canvasState
                ? WorkspaceBranchMarkerProjection.normalizeState(this.options.canvasState)
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
                toggleSelection: nodeId => this.selectionController.toggleNode(nodeId),
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
            this.edgesRaf = null
            this.transformSideEffectsRaf = null
            this.pendingHandleZoom = null
            this.canvasAssetViews = new WorkspaceAssetViews(() => this.assets.createViewPorts())
            this.generationContext = new WorkspaceGenerationContext({ readAsset: assetId => this.host.assets.read(assetId), renditionPath: this.host.media.renditionPath })
            this.generationEvents = new CanvasGenerationEvents(error => console.error('[CANVAS] Generated media event failed:', error))
            this.generationPlacements = new WorkspaceGenerationPlacements({
                readCanvasState: () => this.currentCanvasState,
                hasStartedMedia: this.hasStartedGeneratedMediaForBranchMarkerNode,
            })
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
            this.branchMarkerModels = new WorkspaceBranchMarkerModels({
                models: this.host.models,
                getCanvasNodes: () => this.currentCanvasState?.nodes ?? [],
                getGeneratedOutputNodes: node => this.workspaceHistory.getBranchMarkerGeneratedOutputNodes(node),
            })
            this.branchMarkerProjection = new WorkspaceBranchMarkerProjection({
                getState: () => this.currentCanvasState,
                getConversationPreview: node => this.workspaceHistory.getBranchMarkerConversationPreview(node),
                getPromptParts: (node, preview) => this.referenceProjection.getBranchMarkerPromptPartsForNode(node, preview),
                getPromptTraceHandles: (node, preview) => this.referenceProjection.getBranchMarkerPromptTraceHandles(node, preview),
                getLiveOverride: nodeId => this.liveNodeOverrides.get(nodeId),
                deleteProjectionOverride: nodeId => this.projectionOverrides.delete(nodeId),
                projectionOverrideNodeIds: this.branchMarkerProjectionOverrideNodeIds,
                manuallyPositionedNodeIds: this.manuallyPositionedBranchMarkerNodeIds,
                syncMarker: node => this.branchMarkerPresentation.sync(node),
                commit: this.commitTransientCanvasStatePreservingEditors,
                syncGeometry: this.syncCanvasNodeDomGeometry,
                syncMedia: state => this.canvasMediaLayer?.sync(state),
                scheduleEdges: this.scheduleEdgesRender,
            })
            this.branchMarkerPresentation = new WorkspaceBranchMarkerPresentation({
                document: this.paneEl.ownerDocument,
                shells: this.nodeShells,
                modelCircleSettings: this.mediaModelCircleSettings,
                tooltipHideDelayMs: this.host.settings.helpTooltip.interactiveHideDelayMs,
                models: this.branchMarkerModels,
                getState: () => this.currentCanvasState,
                findElement: this.findBranchMarkerNodeElForNode,
                getUiPhase: this.getBranchMarkerUiPhase,
                hasStartedMedia: this.hasStartedGeneratedMediaForBranchMarkerNode,
                isPending: this.isBranchMarkerPendingForUi,
                isGenerationGroupActive: this.isBranchMarkerGenerationGroupActive,
                getOutputs: this.getBranchMarkerGeneratedOutputNodes,
                isAccepted: node => this.outputDetails.isAccepted(node),
                isReviewReady: node => this.outputDetails.isReviewReady(node),
                stop: this.stopBranchMarkerGeneration,
                accept: nodeId => this.outputDetails.accept('branch-lineage', nodeId),
                regenerate: request => this.outputDetails.regenerate(request),
                getZoomScale: () => this.getBranchMarkerReviewZoomScale(this.getCurrentViewportZoom()),
                getConversationPreview: this.getBranchMarkerConversationPreview,
                getPromptParts: this.branchMarkerProjection.getPromptParts,
                getPromptPreviewRenderer: () => this.context.getPromptReferencePreviewRenderer({ inlinePopover: true }),
                showResponseLine: this.branchMarkerProjection.shouldShowResponseLine,
                createProgress: this.createBranchMarkerGlobalProgress,
                destroyProgress: nodeId => this.destroyMediaGenerationProgressInstance(`branch:${nodeId}`),
                createReferenceResolution: this.createBranchMarkerReferenceResolution,
                openDetails: nodeId => this.outputDetails.open({ kind: 'branch-marker', nodeId }, { toggle: true }),
                log: (event, detail) => console.info('[CANVAS][branch-marker-info]', event, detail),
            })
            // Screen-fixed, canvas-wide composer mounted at the bottom-center of the
            // viewport. Each submission creates one hidden ProseMirror-backed message
            // instance whose visible projection is the spatial branch lineage marker.
            this.globalCanvasComposer = null
            // In-flight detached canvas message ids for stream reattachment and delayed
            // editor teardown. Generated-media event routing uses normal thread and
            // workspace state.
            this.DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS = 30 * 60 * 1000
            this.context = new WorkspaceCanvasContext({
                host: this.host,
                document: this.paneEl.ownerDocument,
                window: this.window,
                capabilityModuleCache: this.capabilityModuleCache,
                getPromptCatalog: this.getPromptReferenceCatalogClient,
                getDocuments: () => this.currentDocuments,
                getThreads: () => this.currentAiChatThreads,
                getState: () => this.currentCanvasState,
                getPanelState: () => this.aiChatPanelState,
                persistPanelState: state => {
                    this.aiChatPanelState = state
                    this.persistAiChatSidebarState()
                },
                applyLocalPanelState: state => {
                    this.aiChatPanelState = state
                    if (this.currentCanvasState) this.currentCanvasState = setAiChatPanelState(this.currentCanvasState, state)
                },
                findNode: this.findCanvasNodeById,
                getPreviewNode: reference => this.referenceProjection.getPromptReferencePreviewNode(reference),
            })
            this.assets = new WorkspaceCanvasAssets({
                host: this.host,
                document: this.paneEl.ownerDocument,
                editors: this.editors,
                context: this.context,
                getWorkspaceId: () => this.workspaceId,
                refreshChrome: () => {
                    this.resetGeneratedMediaChromeSyncKey()
                    this.scheduleGeneratedMediaChromeSync()
                },
                reportError: (message, error) => console.error(message, error),
            })
            this.libraries = new WorkspaceCanvasLibraries({
                host: this.host,
                document: this.paneEl.ownerDocument,
                getWorkspaceId: () => this.workspaceId,
                getCanvasState: () => this.currentCanvasState,
                getComposer: () => this.globalCanvasComposer,
                captureAdmission: this.captureSceneAdmission,
                createLibraryPorts: this.assets.createLibraryPorts,
                createAssetViewPorts: this.assets.createViewPorts,
                insertNode: node => this.insertNodeAtViewportCenterInternal(node, {}, false),
                attachAsset: this.onAssetAttach,
                commit: this.commitTransientCanvasStatePreservingEditors,
                applyGeometry: this.applyApiCanvasGeometry,
            })
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
                operation: node => this.operationStatusNodes.create(node),
                branch: node => this.branchMarkerPresentation.create(node),
                updateBranch: (node, element) => this.branchMarkerPresentation.sync(node, element),
            })
            this.mediaGeometry = new WorkspaceMediaGeometry({
                getState: () => this.currentCanvasState,
                getActiveGesture: () => ({
                    draggingNodeId: this.nodeGestures.draggingNodeId,
                    resizingNodeId: this.nodeGestures.resizingNodeId,
                }),
                getWorldPosition: this.getNodeWorldPosition,
                toParentRelativePosition: (position, parentId, nodesById) => this.workspaceGeometry.toParentRelativePosition(position, parentId, nodesById),
                rebalance: this.rebalanceGeneratedMediaTrees,
                commit: (state, options) => {
                    if (options.preserveEditors) this.commitCanvasStatePreservingEditors(state)
                    else this.commitCanvasState(state)
                },
                markImageFrameDecoded: nodeId => this.generationVisuals.markFrameDecoded(nodeId),
                clearImageCompletion: this.clearFinalizingGeneratedImageOutline,
            })
            this.mediaReplacement = new WorkspaceMediaReplacement({
                host: this.host,
                document: this.paneEl.ownerDocument,
                lifetime: this.callbacks,
                canAct: () => !this.rendererDestroyed,
                getWorkspaceId: () => this.workspaceId,
                getSceneKey: () => this.canvasRuntime.scene.scene.sceneKey,
                isCurrentScene: this.isCurrentScene,
                getState: () => this.currentCanvasState,
                findNode: this.findCanvasNodeById,
                detach: this.onAssetDetach,
                attach: this.onAssetAttach,
                commitTransient: this.commitTransientCanvasStatePreservingEditors,
                reportError: (message, error) => console.error(message, error),
            })
            this.canvasMediaLayer = createWorkspaceMediaLayer({
                paneEl: this.paneEl,
                viewportEl: this.viewportMount,
                nodes: {
                    visible: state => this.visibility.getVisibleNodes(state),
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
                onImageIntrinsicSize: this.mediaGeometry.handleImageIntrinsicSize,
                onVideoIntrinsicSize: this.mediaGeometry.handleVideoIntrinsicSize,
                onPlaybackReady: () => this.scheduleGeneratedMediaChromeSync(),
                marker: { paths: this.connectorIcon.pathData, width: this.connectorIcon.width, reference: { x: 48, y: 128 } },
                onEdgesChange: edges => {
                    if (this.currentCanvasState) this.commitCanvasState({ ...this.currentCanvasState, edges })
                },
                onEdgeSelectionChange: edgeId => this.selectionController.setEdgeSelection(edgeId),
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
                resizeMarker: node => this.branchMarkerProjection.resize(node) as typeof node,
            })
            this.markerHandoff = new WorkspaceBranchMarkerHandoff({
                readScope: () => !this.rendererDestroyed && this.workspaceId ? { workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey } : null,
                readCanvasState: () => this.currentCanvasState,
                placements: this.generationPlacements,
                lineage: this.lineageProjection,
                geometry: this.workspaceGeometry,
                resizeMarker: this.branchMarkerProjection.resize,
                liveGeometry: this.branchMarkerProjection.applyLiveGeometry,
                isManuallyPositioned: nodeId => this.manuallyPositionedBranchMarkerNodeIds.has(nodeId),
                preservePreview: this.branchMarkerProjection.preserveAcrossPromotion,
                cleanup: this.cleanupBranchMarkerArtifacts,
                clearProjection: nodeId => {
                    this.projectionOverrides.delete(nodeId)
                    this.branchMarkerProjectionOverrideNodeIds.delete(nodeId)
                },
                commit: this.commitTransientCanvasStatePreservingEditors,
                syncMarker: node => this.branchMarkerPresentation.sync(node),
                refreshConversation: this.branchMarkerProjection.refresh,
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
                resizeMarker: this.branchMarkerProjection.resize,
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
                refreshConversation: this.branchMarkerProjection.refresh,
                settleConversation: this.settleDetachedCanvasRun,
                scheduleTeardown: this.scheduleDetachedCanvasRunTeardown,
                cleanup: this.cleanupBranchMarkerArtifacts,
                commit: this.commitTransientCanvasStatePreservingEditors,
                syncMedia: this.syncCanvasMediaLayer,
                liveGeometry: this.branchMarkerProjection.applyLiveGeometry,
                resizeMarker: this.branchMarkerProjection.resize,
                isManuallyPositioned: nodeId => this.manuallyPositionedBranchMarkerNodeIds.has(nodeId),
                syncMarker: node => this.branchMarkerPresentation.sync(node),
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
                    if (progressOnly) this.operationStatusNodes.applyProgress(result)
                    else this.operationStatusNodes.applyRecovery(result)
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
                    this.branchMarkerProjection.refresh(threadId)
                    this.refreshGeneratedMediaProjectionsForAiChatThread(threadId)
                },
                setTimer: (callback, delay) => {
                    const timer = this.window.setTimeout(callback, delay)
                    return () => this.window.clearTimeout(timer)
                },
                now: Date.now,
                reportError: (error, threadId) => console.error('[CANVAS] Conversation refresh failed:', { threadId, error }),
            })
            this.threadState = new WorkspaceCanvasThreadState({
                getState: () => this.currentCanvasState,
                merge: (threads, state, workspaceChanged) => this.conversationProjection.merge(threads, state, workspaceChanged),
                now: Date.now,
                reattachWindowMs: this.DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS,
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
                refreshMarkers: () => this.branchMarkerPresentation.syncAll(),
                refreshContext: this.context.refresh,
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
                readArtifactReplay: node => this.host.capabilities.frontend.require(node.artifactTypeId).buildReplaySubmitData({ provenance: this.assets.getArtifactProvenance(node) }),
                readPrompt: node => this.workspaceHistory.getGeneratedOutputUserMessageText(node),
                findNode: this.findCanvasNodeById,
                review: request => this.host.assets.reviewGeneratedOutput(request),
                refreshAsset: async (assetId, capturedWorkspaceId) => {
                    const result = await this.host.assets.refresh(assetId, capturedWorkspaceId)
                    return 'error' in result ? result : {}
                },
                applyGeometry: this.applyApiCanvasGeometry,
                removeContextChips: this.context.removeLocal,
                refreshChrome: this.scheduleGeneratedMediaChromeSync,
                refreshMarkers: () => this.branchMarkerPresentation.syncAll(),
                submit: this.submitCanvasGenerationRun,
                reportError: (message, detail) => console.error(message, detail),
            })
            this.outputDetails = new WorkspaceGeneratedOutputDetails({
                document: this.paneEl.ownerDocument,
                host: this.host,
                editors: this.editors,
                context: this.context,
                libraries: this.libraries,
                history: this.workspaceHistory,
                review: this.outputReview,
                createAssetViewPorts: this.assets.createViewPorts,
                getState: () => this.currentCanvasState,
                getPanelState: () => this.aiChatPanelState,
                persistPanelState: state => {
                    this.aiChatPanelState = state
                    this.persistAiChatSidebarState()
                },
                renderPanel: options => this.rightPanel.render(options),
                syncFooters: state => this.outputChrome.updateState(state),
                getMediaContent: this.getGeneratedMediaHistoryContent,
                getCapabilityProgressStatus: node => {
                    const generatedBy = node.generatedBy
                    return generatedBy
                        ? this.capabilityProgressRuns.get(generatedBy.conversationAssetId)?.get(generatedBy.capabilityRunId)?.status
                        : undefined
                },
                findNode: this.findCanvasNodeById,
                now: () => this.window.performance.now(),
                reportError: (message, error) => console.error(message, error),
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
            this.selectionController = new WorkspaceCanvasSelection({
                pane: this.paneEl,
                viewport: this.viewportEl,
                runtime: this.canvasRuntime,
                media: this.canvasMediaLayer,
                layers: this.nodeLayerManager,
                marqueeStyle: {
                    borderColor: this.selectionStyles.marqueeBorderColor,
                    backgroundColor: this.selectionStyles.marqueeBackgroundColor,
                },
                getState: () => this.currentCanvasState,
                getNodeWorldPosition: node => this.getNodeWorldPosition(node),
                getNodeGeometryOverride: nodeId => this.liveNodeOverrides.get(nodeId),
                getConnections: () => this.connectionManager,
                lockPan: () => this.panZoom?.lock({ selection: true }) ?? (() => {}),
                startGroupDrag: (event, nodeId) => this.handleDragStart(event, nodeId),
                suppressPaneClick: () => this.nodeGestures.suppressPaneClick(),
                addContext: this.context.add,
                scheduleEdges: this.scheduleEdgesRender,
                menu: {
                    showNode: nodeId => this.interactions.menu.showNode(nodeId),
                    showEdge: edgeId => this.interactions.menu.showEdge(edgeId),
                    hide: () => this.interactions.menu.hide(),
                    repositionNode: nodeId => this.interactions.menu.repositionNode(nodeId),
                    repositionEdge: edgeId => this.interactions.menu.repositionEdge(edgeId),
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
                getDescriptor: this.assets.getDescriptor,
                getTraceStatus: node => this.outputDetails.getTraceState(node)?.status,
                isProgressActive: this.outputDetails.isProgressActive,
                isSelected: nodeId => this.outputDetails.targetsMatch(this.aiChatPanelState.generatedOutputDetailsTarget, { kind: 'output', nodeId }),
                getVideo: nodeId => this.canvasMediaLayer?.playback.getVideoElement(nodeId),
                video: this.videoChrome,
                createModelBadge: options => this.host.models.createBadge(options),
                mountTitle: (node, host) => this.canvasAssetViews.mountMetadata(node, host, 'node'),
                queueAnalysis: node => this.queueCanvasMediaAnalysis(node.nodeId, this.getMediaDescriptorStillAssetId(node)),
                onOpenDetails: nodeId => this.outputDetails.open({ kind: 'output', nodeId }, { toggle: true }),
                onAccept: nodeId => {
                    void this.outputDetails.accept('output-node', nodeId)
                },
                onReject: nodeId => {
                    void this.deleteCanvasNodes(new Set([nodeId]))
                },
                onRegenerate: node => {
                    void this.outputDetails.regenerate({ scope: 'output-node', mode: 'existing-prompt', targetNodeId: node.nodeId, outputNodes: [node] })
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
                isSelected: nodeId => this.selectionController.isNodeSelected(nodeId),
                select: this.selectNode,
                toggleSelection: nodeId => this.selectionController.toggleNode(nodeId),
                bringToFront: element => this.nodeLayerManager.bringToFront(element),
                lockPan: () => this.panZoom?.lock() ?? (() => {}),
                getViewport: this.getLiveViewport,
                updateChromeTransform: this.updateGeneratedMediaChromeLiveTransform,
                updateChromeLayout: this.updateGeneratedMediaChromeLayout,
                scheduleEdges: this.scheduleEdgesRender,
                cancelEdges: this.cancelScheduledEdgesRender,
                repositionMenu: () => this.selectionController.repositionNodeMenu(),
                updateSelectionOverlay: this.selectionController.updateGroupOverlay,
                getSelectionBounds: this.selectionController.getOverlayBounds,
                shouldFillSelectionBounds: this.selectionController.shouldFillOverlayBounds,
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
                clearSelection: () => this.selectionController.setNodes(new Set()),
                resolveTree: this.resolveGeneratedMediaTreeState,
                rejectOutput: this.outputDetails.reject,
                getRequest: this.host.generation.get,
                cancelRequest: this.host.generation.cancel,
                removeOperation: (nodeId, operation) => this.operationStatusNodes.remove(nodeId, operation),
                detachAsset: this.onAssetDetach,
                commitTransient: this.commitTransientCanvasStatePreservingEditors,
                commit: this.commitCanvasState,
                removeContextChips: this.context.removeLocal,
                reportError: (message, detail) => console.error(message, detail),
                warn: (message, detail) => console.warn(message, detail),
            })
            this.interactions = new WorkspaceCanvasInteractions({
                pane: this.paneEl,
                viewport: this.viewportEl,
                gestures: this.nodeGestures,
                selection: this.selectionController,
                isDestroyed: () => this.rendererDestroyed,
                getState: () => this.currentCanvasState,
                getNode: this.findCanvasNodeById,
                getConnections: () => this.connectionManager,
                getWorldRect: (node, nodesById) => this.getNodeWorldRect(node, nodesById),
                getPendingCircle: this.getPendingGeneratedMediaBeforeFrameCircleGeometry,
                clientToWorld: (clientX, clientY) => this.canvasRuntime.clientToWorld({ x: clientX, y: clientY }),
                cancelInteraction: () => this.canvasRuntime.cancelInteraction('replaced'),
                suspendPanZoom: this.suspendPanZoomForNodePointer,
                startDrag: this.handleDragStart,
                deleteNodes: this.deleteCanvasNodes,
                downloadMedia: this.mediaReplacement.download,
                replaceMedia: this.mediaReplacement.choose,
                openAsset: assetId => {
                    this.openRightSidePanelToMode('media')
                    this.libraries.showMediaAsset(assetId)
                },
                commit: this.commitCanvasState,
                defaultConnectorCurve: this.host.settings.connector.lineCurve,
                getMenuVisualScale: () =>
                    scaleCanvasChromeToScreenForZoom(
                        1,
                        this.getCurrentViewportZoom(),
                        getAdaptiveBoundedZoomScalingOptions(this.host.settings.canvasBubbleMenu.zoomScaling),
                    ),
            })
            this.rightPanel = new WorkspaceRightPanel({
                pane: this.paneEl,
                widthHost: this.paneEl.closest<HTMLElement>('.workspace-canvas') ?? this.paneEl,
                settings: this.host.settings.rightSidePanel,
                switchSettings: this.host.settings.aiChatThread.panelSwitch,
                cssProperties: getWorkspaceRightPanelCssProperties(this.host.settings),
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
                mountContent: this.outputDetails.mountContent,
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
                applyMediaOperationRecoveryResult: result => this.operationStatusNodes.applyRecovery(result),
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
            this.branchMarkerGeneration = new WorkspaceBranchMarkerGeneration({
                canAct: () => !this.rendererDestroyed,
                getState: () => this.currentCanvasState,
                getScene: () => ({ workspaceId: this.workspaceId, sceneKey: this.canvasRuntime.scene.scene.sceneKey }),
                isCurrentScene: this.isCurrentScene,
                imageTrackers: this.partialImageTracker,
                videoTrackers: this.videoGenerationTracker,
                isWaitingForFrame: this.isGeneratedMediaCanvasNodeWaitingForFrame,
                pruneTrackers: this.pruneApiCanvasRemovedGeneratedMediaTrackers,
                removeSelection: nodeId => this.selection.remove(nodeId),
                commit: this.commitTransientCanvasStatePreservingEditors,
                removeNodes: this.removeApiCanvasRemovedNodesFromDOM,
                syncConnections: () => this.syncConnectionManagerForCurrentCanvasState({ flushRenderer: true }),
                cancelledRequests: this.cancelledMediaGenerationRequestIds,
                settleRequest: (threadId, generationRequestId, options) => this.settleMediaGenerationRequest(threadId, generationRequestId, undefined, options),
                clearPlacements: this.clearPendingGeneratedMediaPlacementsForThread,
                settleMarkers: this.settleBranchMarkersForGenerationRequest,
                settleConversation: this.settleDetachedCanvasRun,
                scheduleTeardown: this.scheduleDetachedCanvasRunTeardown,
                refreshMarkers: this.branchMarkerProjection.refresh,
                stopConversation: this.host.generation.stopConversation,
                applyGeometry: this.applyApiCanvasGeometry,
                refreshConversation: threadId => this.conversationProjection.refresh(threadId),
                reportError: (message, detail) => console.error(message, detail),
            })
            this.operationStatusNodes = new WorkspaceOperationStatusNodes({
                host: this.host,
                shells: this.nodeShells,
                getWorkspaceId: () => this.workspaceId,
                getState: () => this.currentCanvasState,
                replaceState: state => {
                    this.currentCanvasState = state
                },
                captureAdmission: this.captureSceneAdmission,
                commit: this.commitCanvasStatePreservingEditors,
                commitTransient: this.commitTransientCanvasStatePreservingEditors,
                removeSelection: nodeId => this.selection.remove(nodeId),
                rebalance: this.rebalanceGeneratedMediaTrees,
                removeNodes: this.removeApiCanvasRemovedNodesFromDOM,
                pruneTrackers: this.pruneApiCanvasRemovedGeneratedMediaTrackers,
                clearTransientImage: nodeId => this.canvasMediaLayer?.setTransientImageSource(nodeId, null),
                syncNode: this.syncExistingOperationStatusNodeToDOM,
                syncGeometry: this.syncCanvasNodeDomGeometry,
                syncMedia: state => this.syncCanvasMediaLayer(state),
                syncChrome: this.scheduleGeneratedMediaChromeSync,
                syncMarkers: () => this.branchMarkerPresentation.syncAll(),
                syncConnections: this.syncConnectionsAfterManualNodeAppend,
                syncProgress: this.outputDetails.syncProgress,
                ensureRecovery: node => {
                    void this.mediaOperationRecovery.ensure(node)
                },
                addContext: this.context.add,
                getComposer: () => this.globalCanvasComposer,
            })
            this.visibility = new WorkspaceCanvasVisibility({
                hasStartedMedia: this.hasStartedGeneratedMediaForBranchMarkerNode,
                ensureOperation: node => this.mediaOperationRecovery.ensure(node),
                reportedOwnershipKeys: this.branchMarkerHandoffDebugKeys,
                reportUnknownType: nodeType => console.warn(`Unknown canvas node type: ${nodeType}`),
                reportOwnership: details => console.info('[CANVAS] branch marker structural ownership', details),
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
                        this.branchMarkerPresentation.updateZoom(this.getBranchMarkerReviewZoomScale(vp.zoom))
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
            this.lastDocumentsKey = this.threadState.getDocumentsKey(this.currentDocuments)
            this.lastThreadsKey = this.threadState.getThreadsKey(this.currentAiChatThreads)
            this.rendering = new WorkspaceCanvasRendering({
                getWorkspaceId: () => this.workspaceId,
                setWorkspaceId: workspaceId => {
                    this.workspaceId = workspaceId
                },
                getRenderedWorkspaceId: () => this.renderedWorkspaceId,
                setRenderedWorkspaceId: workspaceId => {
                    this.renderedWorkspaceId = workspaceId
                },
                getLoadingStatus: () => this.lastWorkspaceLoadingStatus as LoadingStatus,
                setLoadingVisible: visible => this.workspaceLoadingOutline?.setVisible(visible),
                getPendingVisualCommit: () => this.pendingLocalCanvasVisualCommit,
                setPendingVisualCommit: commit => {
                    this.pendingLocalCanvasVisualCommit = commit
                },
                getState: () => this.currentCanvasState,
                setState: state => {
                    this.currentCanvasState = state
                },
                setDocuments: documents => {
                    this.currentDocuments = documents
                },
                setThreads: threads => {
                    this.currentAiChatThreads = threads
                },
                getPanelState: () => this.aiChatPanelState,
                getKeys: () => ({
                    nodeStructure: this.lastNodeStructureKey,
                    visual: this.lastVisualSyncKey,
                    documents: this.lastDocumentsKey,
                    threads: this.lastThreadsKey,
                }),
                setKeys: keys => {
                    if (keys.nodeStructure !== undefined) this.lastNodeStructureKey = keys.nodeStructure
                    if (keys.visual !== undefined) this.lastVisualSyncKey = keys.visual
                    if (keys.documents !== undefined) this.lastDocumentsKey = keys.documents
                    if (keys.threads !== undefined) this.lastThreadsKey = keys.threads
                },
                getLiveViewport: this.getLiveViewport,
                isViewportLocked: () => this.panZoom?.locked ?? false,
                syncPanZoom: viewport => this.panZoom?.syncViewport(viewport),
                syncViewportInteraction: this.syncViewportInteractionState,
                applyViewport: viewport => this.viewportBridge?.applyViewport(viewport),
                resetStaleMediaAnalysis: this.resetStaleAnalyzingMediaDescriptors,
                preserveActiveMedia: this.preserveActiveGeneratedMediaTrackersInState,
                mergeThreads: this.threadState.merge,
                getDocumentsKey: this.threadState.getDocumentsKey,
                getThreadsKey: this.threadState.getThreadsKey,
                clearWorkspaceRuntime: this.clearWorkspaceRuntime,
                releaseWorkspaceResources: this.releaseWorkspaceResources,
                publishState: state => this.onCanvasStateChange?.(state),
                syncPanelState: this.syncActiveAiChatPanelFromState,
                clearVisualContent: this.clearWorkspaceVisualContent,
                renderNodes: this.renderNodes,
                syncDocuments: documents => this.documentNodes.syncDocuments(documents),
                syncMarkers: () => this.branchMarkerPresentation.syncAll(),
                hasPanelElement: () => Boolean(this.rightPanel.element),
                isPanelClosing: () => this.rightPanel.isClosing,
                renderDetails: this.outputDetails.render,
                destroyPanel: () => this.destroyActiveAiChatPanel(false),
                refreshMarkerThreads: this.branchMarkerProjection.refreshThreads,
                hasConnections: () => Boolean(this.connectionManager),
                syncNodeGeometry: state => this.syncCanvasNodeDomGeometry(state.nodes),
                syncCanvasLayer: state => this.canvasMediaLayer?.sync(state),
                scheduleEdges: this.scheduleEdgesRender,
                syncMedia: this.syncCanvasMediaLayer,
                syncChrome: this.syncGeneratedMediaChrome,
                updateChromeLayout: this.updateGeneratedMediaChromeLayout,
                reattachRuns: this.reattachDetachedCanvasRunListenersForActiveMarkers,
                createComposer: this.createGlobalCanvasComposer,
                markPersistedViewportApplied: () => {
                    this.persistedViewportApplied = true
                },
                isDebugEnabled: () => this.debugLoggingEnabled,
                debug: (event, details) => console.info('[CANVAS][render-state]', event, details),
            })
            this.unlockCanvasScrollLayers = lockCanvasScrollLayers([this.paneEl, this.viewportEl, this.paneEl.parentElement])
            this.canvasRuntime.installKeyboard({
                onEscape: () => {
                    this.selectionController.clearEdgeSelection(true)
                    this.selectNode(null)
                },
                onDelete: () => {
                    if (this.selection.nodeIds.size > 0) {
                        void this.deleteCanvasNodes(new Set(this.selection.nodeIds))
                        return true
                    }
                    if (!this.selectionController.selectedEdgeId) return false
                    this.connectionManager?.deleteSelectedEdge()
                    this.interactions.menu.hide()
                    return true
                },
            })
            const releaseCommands = this.host.onOpenCapabilityLibrary?.(targetWorkspaceId => {
                if (this.rendererDestroyed || targetWorkspaceId && targetWorkspaceId !== this.workspaceId) return
                this.openRightSidePanelToMode('capabilities')
            })
            if (releaseCommands) this.callbacks.own(releaseCommands)
            this.initializePanZoom()
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
                this.branchMarkerPresentation.syncAll()
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
                this.branchMarkerPresentation.syncAll()
                const detailsNode = this.outputDetails.resolveNode(this.aiChatPanelState.generatedOutputDetailsTarget)
                const detailsAssetId = detailsNode
                    ? this.isBranchMarkerNode(detailsNode) ? detailsNode.conversationAssetId : detailsNode.assetId
                    : null
                if (detailsAssetId && changedAssetIds.has(detailsAssetId) && this.rightPanel.element) {
                    this.outputDetails.render({ preserveModeSwitch: true, animateOpen: false })
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

    private resetStaleAnalyzingMediaDescriptors = (canvasState: CanvasState): { state: CanvasState; changed: boolean } => {
        return { state: canvasState, changed: false }
    }

    private isWorkspaceCanvasDebugEnabled = (): boolean => this.host.debugEnabled()

    private isCurrentScene = (originWorkspaceId: string, originSceneKey: string): boolean => {
        return !this.rendererDestroyed && this.workspaceId === originWorkspaceId && this.canvasRuntime.scene.scene.sceneKey === originSceneKey
    }

    private deleteCanvasNodes = async (nodeIds: ReadonlySet<string>): Promise<void> => {
        await this.nodeDeletion.deleteCanvasNodes(nodeIds)
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

        this.selectionController.updateGroupOverlay()
        this.selectionController.repositionNodeMenu()
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

    private scheduleGeneratedMediaChromeSync = (): void => {
        this.outputChrome.schedule()
    }

    private syncGeneratedOutputNodeFooters = (canvasState: CanvasState | null): void => {
        this.outputChrome.updateState(canvasState)
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

    private ensureActiveRightSidePanel = (): void => {
        this.rightPanel.ensure()
    }

    private destroyActiveAiChatPanel = (destroySidePanel = false): void => {
        if (destroySidePanel) this.rightPanel.destroy()
        else this.rightPanel.clear()
        this.context.refresh()
    }

    private persistAiChatSidebarState = (): void => {
        if (!this.currentCanvasState) return

        const nextCanvasState = setAiChatPanelState(this.currentCanvasState, this.aiChatPanelState)
        if (JSON.stringify(this.currentCanvasState.aiChatPanel) === JSON.stringify(nextCanvasState.aiChatPanel)) return
        this.commitCanvasMetadataState(nextCanvasState)
    }

    private syncActiveAiChatPanelFromState = (): void => {
        this.aiChatPanelState = getAiChatPanelState(this.currentCanvasState)
        this.rightPanel.syncState()
    }

    private openAiChatPanel = (): void => {
        this.syncActiveAiChatPanelFromState()
        this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: true }
        this.persistAiChatSidebarState()
        this.outputDetails.render()
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

    private createGlobalCanvasComposer = (): void => {
        if (this.globalCanvasComposer) return
        this.globalCanvasComposer = new WorkspacePromptComposer({
            document: this.paneEl.ownerDocument,
            workspaceId: this.workspaceId,
            storage: this.host.storage,
            mountContextTray: () => {
                const element = this.context.createTray('canvas')
                return { element, destroy: () => this.context.releaseTray(element) }
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
                promptReferencePreviewRenderer: this.context.getPromptReferencePreviewRenderer(),
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
        this.context.refresh()
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
                    createContextTray: () => this.context.createTray('chat'),
                    promptReferencePreviewRenderer: this.context.getPromptReferencePreviewRenderer(),
                    contextPreview: this.context.getAiUserMessagePreviewRenderer(),
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
                    this.branchMarkerProjection.refresh(id)
                    this.refreshGeneratedMediaProjectionsForAiChatThread(id)
                },

                hasPendingPlacement: id => this.pendingGeneratedImagePlacements.has(id),
                deferTeardown: this.scheduleDetachedCanvasRunTeardown,
                preflight: (placement, data, regeneration) => {
                    this.pendingGeneratedImagePlacements.set(threadId, placement)
                    this.setGeneratingReferenceNodeIds(threadId, placement.referenceNodeIds)
                    if (regeneration?.mode === 'existing-prompt') {
                        this.branchMarkerUiPhaseByNodeId.set(regeneration.lineageParentNodeId, 'preflight')
                        this.branchMarkerPresentation.syncAll()
                    } else {
                        this.insertPendingBranchMarkerForCanvasRun(threadId, placement.promptText, data)
                    }
                },
                clearContext: this.context.clear,
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
                if (!this.threadState.isDetached(threadId)) continue
                if (this.detachedAiChatThreadEditors.isSettled(threadId)) continue
                const thread = threadsById.get(threadId)
                if (!thread) continue
                if (!this.isBranchMarkerGenerationActive(node) && !this.threadState.hasInProgressContent(thread)) continue
                threadIds.add(threadId)
            }
        }

        for (const thread of this.currentAiChatThreads) {
            if (!this.threadState.isDetached(thread.threadId)) continue
            if (this.detachedAiChatThreadEditors.isSettled(thread.threadId)) continue
            if (thread.workspaceId !== this.workspaceId) continue
            if (this.threadState.hasCanvasProjection(thread.threadId)) continue
            if (!this.threadState.isRecentUpdate(thread)) continue
            if (!this.threadState.hasRecoverableTurn(thread)) continue
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
            this.branchMarkerPresentation.destroyNode(nodeId)
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

    private refreshGeneratedMediaProjectionsForAiChatThread = (threadId: string): void => {
        const detailsNode = this.outputDetails.resolveNode(this.aiChatPanelState.generatedOutputDetailsTarget)
        const detailsThreadId = detailsNode
            ? this.isBranchMarkerNode(detailsNode)
                ? detailsNode.conversationAssetId
                : detailsNode.generatedBy?.conversationAssetId
            : undefined
        if (detailsThreadId !== threadId || !this.rightPanel.element) return
        if (this.generatedOutputDetailsRefreshRaf !== null) return
        this.generatedOutputDetailsRefreshRaf = this.window.requestAnimationFrame(() => {
            this.generatedOutputDetailsRefreshRaf = null
            const currentDetailsNode = this.outputDetails.resolveNode(this.aiChatPanelState.generatedOutputDetailsTarget)
            const currentDetailsThreadId = currentDetailsNode
                ? this.isBranchMarkerNode(currentDetailsNode)
                    ? currentDetailsNode.conversationAssetId
                    : currentDetailsNode.generatedBy?.conversationAssetId
                : undefined
            if (currentDetailsThreadId !== threadId || !this.rightPanel.element) return
            this.outputDetails.render({ preserveModeSwitch: true, animateOpen: false })
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
        void this.mediaOperationRecovery.ensure(node)
        if (this.currentCanvasState && !this.visibility.shouldRenderOperation(node, this.currentCanvasState)) {
            this.selection.remove(node.nodeId)
        }
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
        this.selectionController.selectNode(nodeId)
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
            this.selectionController.repositionNodeMenu()
            this.selectionController.repositionEdgeMenu()
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
            this.selectionController.repositionEdgeMenu()
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
        this.selectionController.restoreEdgeSelection()
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
            createContextTray: () => this.context.createTray('chat'),
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
            createAssetReferenceView: this.context.createArtifactAssetReferenceView,
            onHeightChange: this.applyCapabilityArtifactHeight,
            onError: (error, nodeId) => console.error('Failed to mount Capability Artifact:', { nodeId, error }),
            mountEditor: request =>
                this.editors.mountCapability({
                    ...request,
                    workspaceId: this.workspaceId,
                    promptReferenceCatalog: this.getPromptReferenceCatalogClient(request.asset.organizationId),
                    promptReferencePreviewRenderer: this.context.getPromptReferencePreviewRenderer({ inlinePopover: true }),
                }),
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
            renderReference: createCanvasPromptReferenceRenderer({ document: this.paneEl.ownerDocument, previewRenderer: this.context.getPromptReferencePreviewRenderer({ inlinePopover: true }), inlinePopover: true }),
            resolveReference: request => this.host.generation.resolveReference({ ...request, workspaceId: this.workspaceId }),
        })
        return view
    }

    private getBranchMarkerGeneratedOutputNodes = (node: BranchMarkerNode): GeneratedOutputCanvasNode[] => {
        return this.workspaceHistory.getBranchMarkerGeneratedOutputNodes(node)
    }

    private stopBranchMarkerGeneration = async (node: BranchMarkerNode): Promise<void> => {
        await this.branchMarkerGeneration.stop(node)
    }

    private getBranchMarkerReviewZoomScale = (zoom: number): number => {
        return scaleCanvasChromeWorldSizeForZoom(
            1,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(this.host.settings.mediaNode.generatedMediaChrome.zoomScaling),
        )
    }

    private applyCapabilityRunEventToBranchMarkers = (threadId: string, event: CapabilityRunEvent): void => {
        if (!this.capabilityProgressRuns.apply(threadId, event)) return
        this.syncGeneratedOutputNodeFooters(this.currentCanvasState)
        this.branchMarkerProjection.refresh(threadId)
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
            promptHandles: this.branchMarkerProjection.getPromptTraceHandles(node, threadPreview),
            reasoningModelDescriptor: this.branchMarkerModels.getReasoningDescriptor(node),
            mediaModelDescriptors: this.branchMarkerModels.getDescriptors(node),
            updatedAt: Date.now(),
        })
        this.destroyMediaGenerationProgressInstance(instanceKey)
        if (!state) return null
        const progress = createMediaGenerationProgress({
            id: instanceKey,
            className: 'workspace-branch-marker-progress',
            showSummaryWhenCollapsedItemIds: ['understand-request'],
            ...this.context.getExecutionTraceTimelineDetail(),
            state,
        })
        this.mediaGenerationProgressInstances.set(instanceKey, progress)
        return progress.element
    }

    private isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerNode => {
        return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }

    private renderNodes = () => {
        if (!this.currentCanvasState) return
        this.ensureConnectionManager()
        const shouldAnimatePanelOpenAfterRender = this.aiChatPanelState.isOpen && !this.rightPanel.element && this.rightPanel.hasRendered
        if (!this.rightPanel.isClosing) this.destroyActiveAiChatPanel(false)
        this.documentNodes.syncDocuments(this.currentDocuments)
        this.syncCanvasMediaLayer(this.currentCanvasState)

        const existingNodeIds = new Set(this.currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId))
        this.selectionController.reconcileMountedNodes(existingNodeIds)

        // Ensure edges render after a full rerender
        this.canvasMediaLayer?.sync(this.currentCanvasState)
        this.scheduleEdgesRender()

        this.outputDetails.render({ animateOpen: shouldAnimatePanelOpenAfterRender })

        this.lastNodeStructureKey = getNodeStructureKey(this.currentCanvasState)
    }

    private releaseWorkspaceResources = (): void => {
        this.detachedAiChatThreadEditors.clear()
        this.libraries.release()
        const composer = this.globalCanvasComposer
        this.globalCanvasComposer = null
        composer?.destroy()
    }

    private clearWorkspaceRuntime = (): void => {
        this.canvasRuntime.cancelInteraction('scene-change')
        this.releasePanZoomForNodePointer()
        this.liveNodeOverrides.clear()
        this.projectionOverrides = this.liveNodeOverrides.createScope()
        this.branchMarkerProjectionOverrideNodeIds.clear()
        this.manuallyPositionedBranchMarkerNodeIds.clear()
        this.selectionController.clearState()
        this.nodeGestures.clear()
        this.nodeDeletion.clear()
        this.generationPlacements.clear()
        this.mediaAnalysis.clear()
        this.outputReview.clear()
        this.conversationProjection.clear()
        this.mediaTrackers.clear()
        this.generationVisuals.clear()
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
        this.branchMarkerPresentation.clear()
        this.videoChrome.clear()
        this.selectionController.reset()
        this.canvasMediaLayer?.sync(null)
        this.connectionManager?.render()
        this.syncCanvasMediaLayer(null)
        this.lastNodeStructureKey = getNodeStructureKey(null)
        this.lastVisualSyncKey = getCanvasVisualSyncKey(null)
        this.lastDocumentsKey = this.threadState.getDocumentsKey(newDocuments)
        this.lastThreadsKey = this.threadState.getThreadsKey(newAiChatThreads)
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

    private openRightSidePanelToMode = (mode: CanvasRightSidePanelMode): void => {
        const alreadyOnMode = this.aiChatPanelState.isOpen && this.aiChatPanelState.topLevelMode === mode
        this.aiChatPanelState = { ...this.aiChatPanelState, isOpen: true, topLevelMode: mode }
        this.persistAiChatSidebarState()
        if (!alreadyOnMode) this.syncActiveAiChatPanelFromState()
        this.outputDetails.render()
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
        this.rendering.render(newCanvasState, newDocuments, newAiChatThreads, newWorkspaceId)
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
        destroyWorkspaceCanvasResources([
            () => this.context?.destroy(),
            () => {
                this.globalCanvasComposer = null
            },
            () => this.globalCanvasComposer?.destroy(),
            () => this.interactions?.destroy(),
            () => this.generationPlacements?.clear(),
            () => this.mediaTrackers?.destroy(),
            () => this.detachedAiChatThreadEditors?.destroy(),
            () => this.documentNodes?.destroy(),
            () => {
                this.workspaceLoadingOutline = null
            },
            () => this.workspaceLoadingOutline?.destroy(),
            () => {
                this.canvasMediaLayer = null
            },
            () => this.canvasMediaLayer?.destroy(),
            () => {
                this.mediaChromeViewportEl = null
            },
            () => this.mediaChromeViewportEl?.remove(),
            () => this.videoChrome?.destroy(),
            () => this.mediaGenerationProgressInstances?.clear(),
            () => destroyWorkspaceCanvasResources(Array.from(this.mediaGenerationProgressInstances?.values() ?? [], progress => () => progress.destroy())),
            () => this.outputChrome?.invalidate(),
            () => this.canvasAssetViews?.destroy(),
            () => {
                if (this.outputChrome && this.canvasAssetViews) this.destroyGeneratedMediaChromeControls()
            },
            () => {
                this.viewportBridge = null
            },
            () => {
                this.connectionManager = null
            },
            () => this.generationVisuals?.destroy(),
            () => this.conversationProjection?.destroy(),
            () => this.outputReview?.destroy(),
            () => this.mediaAnalysis?.destroy(),
            () => {
                if (typeof this.transformSideEffectsRaf === 'number') {
                    this.window.cancelAnimationFrame(this.transformSideEffectsRaf)
                    this.transformSideEffectsRaf = null
                }
            },
            () => {
                if (typeof this.generatedOutputDetailsRefreshRaf === 'number') {
                    this.window.cancelAnimationFrame(this.generatedOutputDetailsRefreshRaf)
                    this.generatedOutputDetailsRefreshRaf = null
                }
            },
            () => this.outputChrome?.destroy(),
            () => {
                if (typeof this.edgesRaf === 'number') {
                    this.window.cancelAnimationFrame(this.edgesRaf)
                    this.edgesRaf = null
                }
            },
            () => this.unsubscribeWorkspaceStore?.(),
            () => this.unsubscribeAssetsStore?.(),
            () => this.unsubscribeAiModelsStore?.(),
            () => this.nodeShells?.destroy(),
            () => this.unlockCanvasScrollLayers?.(),
            () => this.resizeObserver?.disconnect(),
            () => this.libraries.destroy(),
            () => this.rightPanel?.destroy(),
            () => this.nodeGestures?.destroy(),
            () => this.capabilityProgressRuns?.clear(),
            () => this.branchMarkerPresentation?.destroy(),
            () => this.generationEvents?.destroy(),
            () => this.apiCanvasGeometry?.destroy(),
            () => this.generationHandlers?.destroy(),
            () => this.mediaOperationRecovery?.destroy(),
            () => this.canvasGenerationSubmission?.destroy(),
            () => this.nodeDeletion?.destroy(),
            () => this.projectionOverrides?.destroy(),
            () => this.callbacks.destroy(),
        ])
    }
}

export function createWorkspaceCanvas(options: WorkspaceCanvasOptions, host: WorkspaceCanvasHost): LixpiWorkspaceCanvas {
    return new LixpiWorkspaceCanvas(options, host)
}
