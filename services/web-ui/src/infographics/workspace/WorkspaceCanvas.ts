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
    getAiInteractionResponseSubject,
    NATS_SUBJECTS,
    STREAM_STATUS,
    LoadingStatus,
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type DocumentMediaCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type AudioCanvasNode,
    type UploadPlaceholderCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchForkLineagePlan,
    type BranchLineCanvasNode,
    type BranchLineLineagePlan,
    type WorkspaceEdge,
    type CanvasAiChatSidebarTab,
    type CanvasAiChatPanelState,
    type CanvasRightSidePanelMode,
    type CanvasFeatureExtractionState,
    type ExtractionRun,
    type StageTraceEvent,
    type FeatureMeta,
    type Asset,
    type AssetMeta,
    type CanvasGeometryUpdate,
    type MediaBranchCandidateSnapshot,
    type MediaBranchVlmResolution,
    type MediaBranchLineagePlan,
    type MediaRunLineageAssignment,
    type MediaDescriptor,
    type ContentDescriptor,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
    type MediaGenerationRunMeta,
    type ImageGenerationTraceReference,
    type ImageGenerationTrace,
    type VideoGenerationTrace,
    type AiInteractionMediaGenerationRequest,
    type AiModelId,
    MEDIA_DESCRIPTOR_VERSION,
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import { createPureDropdown } from '$src/components/dropdown/index.ts'
import {
    createAiPromptComposer,
    createDefaultPromptControlFactories,
    type AiPromptComposerInstance,
    type AiPromptComposerSubmitData,
} from '$src/components/proseMirror/aiPromptComposer.ts'
import {
    parseAiModelSelectionAttr,
    serializeAiModelSelectionAttr,
    serializeMediaGenerationConfigSelectionAttr,
} from '$src/components/proseMirror/plugins/aiPromptInputPlugin/aiPromptInputNode.ts'
import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { setAiGeneratedImageCallbacks, setAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/index.ts'
import {
    buildBranchMarkerTurnProjectionFromThreadContent,
    buildGeneratedMediaTurnProjectionFromThreadContent,
    type GeneratedMediaTurnLocator,
} from '@lixpi/prosemirror/shared/generated-media-turn-projection'
import {
    collectProseMirrorText,
    findAiChatThreadContentNode,
    getBranchMarkerConversationPreviewFromThreadContent,
    parseProseMirrorJsonContent,
    shouldShowBranchMarkerConversationResponseLine,
    type BranchMarkerConversationPreview,
    type BranchMarkerTurnDescriptor,
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import type { AiLineageProjectionScope } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'
import type { ImageGenerationTraceDetailsOptions } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import {
    applyCanvasGeometryUpdateToState,
    CircularGlassMaterial,
    createShiftingGradientBackground,
    estimateBranchMarkerDimensions,
    fitDimensionsToAspectRatio,
    getAdaptiveBoundedZoomScalingOptions,
    getBranchMarkerPromptPreview,
    getBranchMarkerResponsePreview,
    getBranchMarkerScreenFixedMinWidth,
    getCanvasChromeScreenLayout,
    getGeneratedMediaChromeCollisionHeight as getSharedGeneratedMediaChromeCollisionHeight,
    getPendingGeneratedMediaNodeId,
    getResizeHandleScaledSizes,
    resolveCollisions,
    resizeBranchMarkerToDimensions,
    scaleCanvasChromeToScreenForZoom,
    scaleCanvasChromeWorldSizeForZoom,
} from '@lixpi/canvas-engine'
import {
    mountReadOnlyAiChatThreadProjection,
    type ReadOnlyAiChatThreadRendererInstance,
} from '$src/components/proseMirror/readOnlyAiChatThreadRenderer.ts'
import { createHelpTooltip, type HelpTooltipInstance } from '$src/components/helpTooltip/index.ts'
import AiInteractionService, { stopAiChatMessageForThread } from '$src/services/ai-interaction-service.ts'
import {
    aiChatPanelCollapseIcon,
    aiChatPanelToggleHistoryIcon,
    atomIcon,
    checkMarkIcon,
    imageIcon,
    imageResizeCornerIcon,
    infoLetterIcon,
    pauseIcon,
    promptIcon,
    refreshIcon,
    trashBinIcon,
    videoPlayGlyphIcon,
    xCircleIcon,
} from '$src/svgIcons/index.ts'
import type {
    AssetDocumentView as Document,
    ConversationAssetView as AiChatThread,
} from '$src/stores/assetViewTypes.ts'
import { shouldAcceptGeneratedMediaEvent as shouldAcceptGeneratedMediaEventForState } from '$src/infographics/workspace/generatedMediaEventWorkspaceGuard.ts'
import { createVideoNodeHandler, type VideoNodeHandlerControl } from '$src/infographics/workspace/rendering/videoNodeHandler.ts'
import { createAudioNodeHandler, type AudioNodeHandlerControl } from '$src/infographics/workspace/rendering/audioNodeHandler.ts'
import { createDocumentNodeHandler } from '$src/infographics/workspace/rendering/documentNodeHandler.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { createSidePanel, type SidePanelInstance } from '$src/components/sidePanel/index.ts'
import {
    GeneratedMediaRebalancePipeline,
    type BranchMarkerNode,
    type CanvasGeometry,
} from '$src/infographics/workspace/generatedMediaRebalancePipeline.ts'
import { getBranchMarkerMediaModelCircleDescriptors } from '$src/infographics/workspace/branchMarkerMediaModelCircles.ts'
import {
    computeLineageContinuationPositionToRightOfRect,
    computeNextBranchRowPositionToRightOfRect,
    computeViewportCenterInsertionPosition,
} from '$src/infographics/workspace/imagePositioning.ts'
import {
    applyBranchLineageNodeGap,
    normalizeBranchLineageNodeGap,
} from '$src/infographics/workspace/branchLineageNodeSpacing.ts'
import { computeReferenceBranchRootMarkerPosition } from '$src/infographics/workspace/referenceBranchRootPlacement.ts'
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
import { shouldPreserveLiveViewportForSameWorkspaceRender } from '$src/infographics/workspace/workspaceViewportStatePlan.ts'
import { planWorkspaceRenderTransition } from '$src/infographics/workspace/workspaceRenderTransitionPlan.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import { loadWorkspaceRouteData } from '$src/services/router-service.ts'
import { tPatternSvgTexture } from '$src/svgIcons/svgTextures.ts'
import { settings, type WorkspaceCollisionFlowSettings, type WorkspaceCollisionNodeTypeSettings } from '$src/settings.ts'
import { BubbleMenu, type BubbleMenuPositionRequest } from '$src/components/bubbleMenu/index.ts'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_DOCUMENT_CONTEXT, CANVAS_AUDIO_CONTEXT, CANVAS_EDGE_CONTEXT } from '$src/infographics/workspace/canvasBubbleMenuItems.ts'
import { downloadImage } from '$src/utils/downloadImage.ts'
import {
    buildAssetRenditionPath,
    buildAssetUploadPath,
    isAssetEndpoint,
    resolveMediaUrl,
} from '$src/utils/mediaUrls.ts'
import { AiPromptInputController } from '$src/services/ai-prompt-input-controller.ts'
import AssetService from '$src/services/asset-service.ts'
import { describeMedia } from '$src/services/media-descriptor-service.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    buildMediaBranchCandidateSnapshot,
    buildCanvasWideCandidateSnapshot,
    buildWorkspaceContextSnapshot,
    getGeneratedImageTextByNodeIdFromThreadContent,
    getPromptTextFromMessages,
} from '$src/services/ai-image-branching.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { extractContentFromProseMirror } from '$src/utils/prosemirrorText.ts'
import {
    createGenericAiModelDropdown,
    createGenericAiModelMultiSelect,
    createGenericSubmitButton,
    createGenericImageSizeDropdown,
    createGenericImageModelDropdown,
    createGenericImageModelMultiSelect,
    createGenericVideoModelDropdown,
    createGenericVideoModelMultiSelect,
    createGenericVideoAspectDropdown,
    createGenericVideoResolutionDropdown,
    createGenericVideoDurationDropdown,
    applyAiModelMenuStyleSettings,
    createAiModelMenuContent,
} from '$src/components/aiModelControls/index.ts'
import { createPixiMediaLayer, type GeneratingMediaOutlineTarget, type PixiMediaLayer, type SelectionColors } from '$src/infographics/workspace/pixiMediaLayer.ts'
import { createWorkspaceLoadingOutline, type WorkspaceLoadingOutlineInstance } from '$src/infographics/workspace/workspaceLoadingOutline.ts'
import { createViewportBridge, type ViewportBridge } from '$src/infographics/workspace/rendering/viewportBridge.ts'
import { createMediaLibraryPanel, type FeatureExtractionModelContext, type FeatureExtractionModelControlsInstance } from '$src/infographics/workspace/mediaLibraryPanel.ts'
import { setPendingExtractionContext, getPendingExtractionContext, clearPendingExtractionContext, submitExtractionRequest, renderExtractionTabBody, type ExtractionTabContext } from '$src/infographics/workspace/extractionTab.ts'
import {
    getAiChatPanelState,
    setAiChatPanelState,
} from '$src/infographics/workspace/aiChatPanelState.ts'
import { applyVideoControlsHostStyleProperties, createVideoControls, type VideoControlsInstance } from '$src/components/videoControls/index.ts'
import {
    createSlidingTabsSwitch,
    type SlidingTabsSwitchInstance,
} from '$src/components/slidingTabsSwitch/index.ts'
import {
    createSlidingSwitch,
    type SlidingSwitchInstance,
} from '$src/components/slidingSwitch/index.ts'
import {
    createContextPreviewTile,
    getContextPreviewAccessibleLabel,
    type ContextPreviewEnvironment,
    type ContextPreviewTileInstance,
} from '$src/components/contextPreview/index.ts'
import { applyMediaModelBadgeStyleProperties, createMediaModelBadge } from '$src/components/mediaModelBadge.ts'
import { getAiModelIcon, getAiProviderIcon } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiProviderIcons.ts'

type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
type ResizeHandle = ResizeCorner
type CollisionBox = {
    id: string
    x: number
    y: number
    width: number
    height: number
    margin?: number
    overlapThreshold?: number
}
type CollisionEntry = { node: CanvasNode; offset: { x: number; y: number } }
type CollisionPlan = {
    nodeBoxes: CollisionBox[]
    entries: Map<string, CollisionEntry>
    shouldResolvePair: (a: CollisionBox, b: CollisionBox) => boolean
    iterations: number
}
type BaseNodeInteractionOptions = {
    renderResizeHandles?: boolean
    allowSelection?: boolean
    allowDrag?: boolean
    onClick?: () => void
}
type GeneratedMediaHistoryPanelOptions = {
    className?: string
    rendererKey?: string
    limitProjectionToSelectedMedia?: boolean
    lineageProjectionScope?: AiLineageProjectionScope
}
type GeneratedMediaProjectionTarget = {
    node: ImageCanvasNode | VideoCanvasNode
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
}
type BranchMarkerProjectionTarget = {
    marker: BranchMarkerNode
    lineageProjectionScope: AiLineageProjectionScope
}
type MountGeneratedMediaProjectionOptions = {
    mount: HTMLElement
    node: ImageCanvasNode | VideoCanvasNode
    rendererClassName: string
    traceDetailsClassName: string
    previewTiles: Set<ContextPreviewTileInstance>
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
    includeReasoningModelHeader?: boolean
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
type PendingBranchMarkerRecord = {
    nodeId: string
    placementKey: string
    threadId: string
    reasoningModelId?: AiModelId
    reasoningIndex?: number
}
type BranchMarkerSettlementOptions = {
    preserveGeometry?: boolean
}

const RESIZE_CORNERS: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const NODE_DRAG_START_THRESHOLD_PX = 6
// Branch-marker pill sizing is the shared estimateBranchMarkerDimensions in
// @lixpi/canvas-engine — the API layout reserves marker space with the exact
// same text metrics (single source: mediaGenerationLayoutSettings.marker).
function getPendingBranchMarkerInputGap(): number {
    const gap = Number(settings.mediaBranchLineage.pendingMarkerInputGap)
    return Number.isFinite(gap) ? Math.max(0, gap) : 0
}

function getBranchLineageNodeGap(): number {
    return normalizeBranchLineageNodeGap(settings.mediaBranchLineage.nodeGap)
}

function getBranchMarkerStackGap(): number {
    return getBranchLineageNodeGap()
}
// Must match the `workspace-branch-marker-spin` animation duration in
// workspace-canvas.scss (0.8s). Used to phase-align recreated spinners to a
// shared rotation clock so the spinner never visibly restarts.
const BRANCH_MARKER_SPINNER_PERIOD_MS = 800
const MEDIA_DESCRIPTOR_ANALYSIS_RETRY_DELAYS_MS = [1000, 3000, 8000] as const
const GENERATED_IMAGE_COMPLETION_OUTLINE_FALLBACK_MS = 30_000
const branchMarkerMediaModelCircleGlassCssImageByColor = new Map<string, string>()
const branchMarkerMediaModelCircleTextureCssImageByColor = new Map<string, string>()
type BranchMarkerDimensionOptions = {
    responseLine?: boolean
    responseText?: string
}

function getBranchMarkerContentDimensions(promptText: string, options: BranchMarkerDimensionOptions = {}): { width: number; height: number } {
    return estimateBranchMarkerDimensions(promptText, { responseLine: options.responseLine, responseText: options.responseText })
}

// Screen-fixed preflight pose: shorter and wider than the on-canvas pill so the
// marker visibly grows once it lands. Same shared estimator, screenFixed flag.
function getBranchMarkerScreenFixedDimensions(promptText: string, options: BranchMarkerDimensionOptions = {}): { width: number; height: number } {
    return estimateBranchMarkerDimensions(promptText, {
        responseLine: options.responseLine,
        responseText: options.responseText,
        screenFixed: true,
    })
}

function getBranchMarkerNodeDimensions(
    node: BranchMarkerNode,
    options: { responseLine?: boolean } = {},
): { width: number; height: number } {
    return getBranchMarkerContentDimensions(
        getBranchMarkerPromptText(node),
        options,
    )
}

function getBranchOriginOutputGap(): number {
    return settings.mediaBranchLineage.branchOriginToFirstMediaGap
}

function getRootBranchMarkerOutputGap(): number {
    return settings.mediaBranchLineage.rootToFirstMediaGap
}

function getGeneratedMediaOutputGap(sourceNode: CanvasNode): number {
    if (sourceNode.type === 'branchOrigin') return getBranchOriginOutputGap()
    if (sourceNode.type === 'branchFork' && !sourceNode.parentBranchNodeId) return getRootBranchMarkerOutputGap()
    return settings.mediaBranchLineage.mediaToMediaGap
}

function getExpectedBranchMarkerDimensions(node: CanvasNode): { width: number; height: number } | undefined {
    if (node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine') {
        if (node.dimensions?.width > 0 && node.dimensions?.height > 0) return undefined
        return getBranchMarkerNodeDimensions(node)
    }
    return undefined
}

function resizeBranchMarkerNodeToDimensions<T extends BranchMarkerNode>(
    node: T,
    dimensions: { width: number; height: number },
): T {
    return resizeBranchMarkerToDimensions(node, dimensions)
}

function resizeBranchMarkerNodeToContent<T extends BranchMarkerNode>(
    node: T,
    options: { responseLine?: boolean } = {},
): T {
    return resizeBranchMarkerNodeToDimensions(node, getBranchMarkerNodeDimensions(node, options))
}

function normalizeBranchMarkerDimensions(canvasState: CanvasState): CanvasState {
    let changed = false
    const nodes = canvasState.nodes.map((node: CanvasNode): CanvasNode => {
        const dimensions = getExpectedBranchMarkerDimensions(node)
        if (!dimensions) return node
        if (node.dimensions.width === dimensions.width && node.dimensions.height === dimensions.height) return node

        changed = true
        return resizeBranchMarkerNodeToDimensions(node as BranchMarkerNode, dimensions) as CanvasNode
    })
    return changed ? { ...canvasState, nodes } : canvasState
}

function resetStaleAnalyzingMediaDescriptors(canvasState: CanvasState): { state: CanvasState; changed: boolean } {
    return { state: canvasState, changed: false }
}

function getBranchMarkerPromptText(node: BranchMarkerNode): string {
    return (node.provenance?.promptText ?? node.pendingState?.promptText ?? '').trim().replace(/\s+/g, ' ')
}


// Streaming reasoning text scrolls past the marker as a tail while receiving.
function normalizeBranchMarkerModelValue(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase()
}

type BranchMarkerRgbColor = { r: number; g: number; b: number }
type BranchMarkerHslColor = { h: number; s: number; l: number }

function normalizeBranchMarkerHexColor(value: string | null | undefined): string | null {
    const normalized = String(value ?? '').trim().replace(/^#/, '')
    if (!/^[\da-f]{6}$/i.test(normalized)) return null
    return `#${normalized.toUpperCase()}`
}

function parseBranchMarkerHexColor(hex: string): BranchMarkerRgbColor {
    const normalized = normalizeBranchMarkerHexColor(hex) ?? '#53616C'
    const value = Number.parseInt(normalized.slice(1), 16)
    return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff,
    }
}

function clampBranchMarkerColorUnit(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
}

function branchMarkerRgbToHsl({ r, g, b }: BranchMarkerRgbColor): BranchMarkerHslColor {
    const red = r / 255
    const green = g / 255
    const blue = b / 255
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    const lightness = (max + min) / 2
    const delta = max - min
    if (delta === 0) return { h: 0, s: 0, l: lightness }

    const saturation = lightness > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min)
    let hue = 0
    if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0)
    if (max === green) hue = (blue - red) / delta + 2
    if (max === blue) hue = (red - green) / delta + 4
    return {
        h: hue / 6,
        s: saturation,
        l: lightness,
    }
}

function branchMarkerHueToRgb(p: number, q: number, hue: number): number {
    let normalizedHue = hue
    if (normalizedHue < 0) normalizedHue += 1
    if (normalizedHue > 1) normalizedHue -= 1
    if (normalizedHue < 1 / 6) return p + (q - p) * 6 * normalizedHue
    if (normalizedHue < 1 / 2) return q
    if (normalizedHue < 2 / 3) return p + (q - p) * (2 / 3 - normalizedHue) * 6
    return p
}

function branchMarkerHslToRgb({ h, s, l }: BranchMarkerHslColor): BranchMarkerRgbColor {
    if (s === 0) {
        const value = Math.round(l * 255)
        return { r: value, g: value, b: value }
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    return {
        r: Math.round(branchMarkerHueToRgb(p, q, h + 1 / 3) * 255),
        g: Math.round(branchMarkerHueToRgb(p, q, h) * 255),
        b: Math.round(branchMarkerHueToRgb(p, q, h - 1 / 3) * 255),
    }
}

function branchMarkerRgbToHex({ r, g, b }: BranchMarkerRgbColor): string {
    const channel = (value: number): string =>
        Math.max(0, Math.min(255, Math.round(value)))
            .toString(16)
            .padStart(2, '0')
    return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

function adjustBranchMarkerBrandColor(
    hex: string,
    adjust: {
        saturationMultiplier: number
        minSaturation: number
        maxSaturation: number
        lightnessMultiplier: number
        minLightness: number
        maxLightness: number
    }
): string {
    const hsl = branchMarkerRgbToHsl(parseBranchMarkerHexColor(hex))
    const saturation = Math.min(
        clampBranchMarkerColorUnit(adjust.maxSaturation),
        Math.max(
            clampBranchMarkerColorUnit(adjust.minSaturation),
            clampBranchMarkerColorUnit(hsl.s * adjust.saturationMultiplier),
        ),
    )
    const lightness = Math.max(
        clampBranchMarkerColorUnit(adjust.minLightness),
        Math.min(
            clampBranchMarkerColorUnit(adjust.maxLightness),
            clampBranchMarkerColorUnit(hsl.l * adjust.lightnessMultiplier),
        ),
    )
    return branchMarkerRgbToHex(branchMarkerHslToRgb({ h: hsl.h, s: saturation, l: lightness }))
}

function mixBranchMarkerColor(fromHex: string, toHex: string, amount: number): string {
    const from = parseBranchMarkerHexColor(fromHex)
    const to = parseBranchMarkerHexColor(toHex)
    const boundedAmount = Math.max(0, Math.min(1, amount))
    const channel = (fromChannel: number, toChannel: number): string =>
        Math.round(fromChannel + (toChannel - fromChannel) * boundedAmount)
            .toString(16)
            .padStart(2, '0')

    return `#${channel(from.r, to.r)}${channel(from.g, to.g)}${channel(from.b, to.b)}`.toUpperCase()
}

function svgToCssImageUrl(svg: string): string {
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function getBranchMarkerMediaModelCircleGlassColors(modelColor: string | null): string[] {
    const circleGlassSettings = settings.mediaBranchLineage.mediaModelCircle.glass
    const normalizedColor = normalizeBranchMarkerHexColor(modelColor)
    if (!normalizedColor) return circleGlassSettings.fallbackColors
    const saturatedColor = adjustBranchMarkerBrandColor(normalizedColor, circleGlassSettings.brandColorAdjust)

    return circleGlassSettings.brandColorStops.map(({ targetColor, amount }) =>
        mixBranchMarkerColor(saturatedColor, targetColor, amount)
    )
}

function getBranchMarkerMediaModelCircleTextureColor(modelColor: string | null): string {
    const textureSettings = settings.mediaBranchLineage.mediaModelCircle.texture
    const normalizedColor = normalizeBranchMarkerHexColor(modelColor)
    if (!normalizedColor) return textureSettings.fallbackColor

    return mixBranchMarkerColor(
        normalizedColor,
        textureSettings.brandColorMix.targetColor,
        textureSettings.brandColorMix.amount,
    )
}

function splitBranchMarkerModelId(modelId: string): { provider: string; model: string } {
    const separatorIndex = modelId.indexOf(':')
    if (separatorIndex < 0) return { provider: '', model: modelId }
    return {
        provider: modelId.slice(0, separatorIndex),
        model: modelId.slice(separatorIndex + 1),
    }
}

function findBranchMarkerModelMeta(modelId: string, modelProvider: string): BranchMarkerModelCatalogEntry | null {
    const { provider, model } = splitBranchMarkerModelId(modelId)
    const normalizedProvider = normalizeBranchMarkerModelValue(provider || modelProvider)
    const normalizedModel = normalizeBranchMarkerModelValue(model)
    const normalizedModelId = normalizeBranchMarkerModelValue(modelId)
    const models = (aiModelsStore.getData() ?? []) as BranchMarkerModelCatalogEntry[]

    return models.find((candidate) => {
        const candidateProvider = normalizeBranchMarkerModelValue(candidate.provider)
        const candidateModel = normalizeBranchMarkerModelValue(candidate.model)
        const candidateModelId = normalizeBranchMarkerModelValue(`${candidate.provider ?? ''}:${candidate.model ?? ''}`)

        if (normalizedProvider) {
            return candidateProvider === normalizedProvider && candidateModel === normalizedModel
        }

        return candidateModel === normalizedModel || candidateModelId === normalizedModelId
    }) ?? null
}

function getBranchMarkerModelEntry(modelId: string, modelProvider = ''): BranchMarkerModelEntry | null {
    if (!modelId) return null
    const modelIdParts = splitBranchMarkerModelId(modelId)
    const providerKey = modelProvider || modelIdParts.provider
    const meta = findBranchMarkerModelMeta(modelId, providerKey)
    const title = meta?.shortTitle ?? meta?.title ?? modelIdParts.model ?? modelId
    const icon = getAiModelIcon(meta?.iconName)
        ?? getAiProviderIcon(meta?.provider)
        ?? getAiProviderIcon(providerKey)
    return title ? { title, icon, color: normalizeBranchMarkerHexColor(meta?.color) } : null
}

function uniqueBranchMarkerModelEntries(entries: BranchMarkerModelEntry[]): BranchMarkerModelEntry[] {
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

function createBranchMarkerModelDetail(label: string, descriptors: BranchMarkerModelDescriptor[]): BranchMarkerModelDetail | null {
    const entries = uniqueBranchMarkerModelEntries(descriptors
        .map(descriptor => getBranchMarkerModelEntry(descriptor.modelId, descriptor.modelProvider ?? ''))
        .filter((entry): entry is BranchMarkerModelEntry => Boolean(entry)))
    return entries.length > 0 ? { label, entries } : null
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

type RenderActiveAiChatPanelOptions = {
    preserveTabsSwitch?: boolean
    // Keep the live top-level mode switch (and its in-flight slide animation)
    // across a body re-render instead of destroying and rebuilding it.
    preserveModeSwitch?: boolean
    animateOpen?: boolean
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
    onAuthoritativeCanvasStateChange?: (params: { canvasState: CanvasState; layoutRevision: number }) => void
    onDocumentContentChange?: (params: { documentId: string; title?: string; content: any }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
    onAssetDetach?: (params: { assetId: string; nodeId: string; canvasState: CanvasState }) => Promise<void>
    onAssetAttach?: (params: { assetId: string; nodeId: string; canvasState: CanvasState }) => Promise<void>
}

type WorkspaceCanvasNodeInsertion =
    | Omit<DocumentCanvasNode, 'position'>
    | Omit<DocumentMediaCanvasNode, 'position'>
    | Omit<ImageCanvasNode, 'position'>
    | Omit<VideoCanvasNode, 'position'>
    | Omit<AudioCanvasNode, 'position'>
    | Omit<UploadPlaceholderCanvasNode, 'position'>

type PendingGeneratedMediaTracker = {
    nodeId: string
    assetId: string
    sourceNodeId?: string
    placementKey: string
    hasReceivedFrame: boolean
}

type GeneratedMediaNode = ImageCanvasNode | VideoCanvasNode

type GeneratedOutputRegenerationRequest = {
    scope: 'media-node'
    mode: 'existing-prompt'
    targetNodeId: string
    mediaNodes: Array<ImageCanvasNode | VideoCanvasNode>
} | {
    scope: 'branch-lineage'
    mode: 'existing-prompt' | 'regenerate-prompt'
    targetNodeId: string
    mediaNodes: Array<ImageCanvasNode | VideoCanvasNode>
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

function createBranchMarkerMediaModelCircleGlassCssImage(modelColor: string | null = null): string {
    const circleGlass = settings.mediaBranchLineage.mediaModelCircle.glass
    const glassColors = getBranchMarkerMediaModelCircleGlassColors(modelColor)
    const cacheKey = JSON.stringify([
        glassColors,
        circleGlass.textureSize,
        circleGlass.translucency,
        circleGlass.rimFeatherFraction,
        circleGlass.material,
        circleGlass.discMaterial,
    ])
    const cachedImage = branchMarkerMediaModelCircleGlassCssImageByColor.get(cacheKey)
    if (cachedImage !== undefined) return cachedImage

    const dataUrl = new CircularGlassMaterial(
        glassColors,
        0,
        circleGlass.material,
        {
            size: circleGlass.textureSize,
            translucency: circleGlass.translucency,
            rimFeatherFraction: circleGlass.rimFeatherFraction,
            discStyle: circleGlass.discMaterial,
        },
    ).bakeDataUrl()
    const image = dataUrl ? `url(${dataUrl})` : ''
    branchMarkerMediaModelCircleGlassCssImageByColor.set(cacheKey, image)
    return image
}

function createBranchMarkerMediaModelCircleTextureCssImage(modelColor: string | null = null): string {
    const textureSettings = settings.mediaBranchLineage.mediaModelCircle.texture
    const textureColor = getBranchMarkerMediaModelCircleTextureColor(modelColor)
    const cacheKey = `${textureColor}|${textureSettings.fillOpacity}`
    const cachedImage = branchMarkerMediaModelCircleTextureCssImageByColor.get(cacheKey)
    if (cachedImage !== undefined) return cachedImage

    const texturedSvg = tPatternSvgTexture.replace('<path ', `<path fill="${textureColor}" fill-opacity="${textureSettings.fillOpacity}" `)
    const image = svgToCssImageUrl(texturedSvg)
    branchMarkerMediaModelCircleTextureCssImageByColor.set(cacheKey, image)
    return image
}

export function createWorkspaceCanvas(options: WorkspaceCanvasOptions) {
    const {
        paneEl,
        viewportEl,
        onViewportChange,
        onCanvasStateChange,
        onAuthoritativeCanvasStateChange,
        onDocumentContentChange,
        onAiChatThreadContentChange,
        onAssetDetach,
        onAssetAttach,
    } = options
    let workspaceId = options.workspaceId
    const connectorStyles = settings.connector.styles
    const selectionStyles = settings.selection.styles
    const mediaNodeStyles = settings.mediaNode.styles
    const generatedMediaInfoPanelSettings = settings.mediaNode.generatedMediaInfoPanel
    const generatedMediaInfoPanelStyles = generatedMediaInfoPanelSettings.styles
    const branchOriginSettings = settings.mediaBranchLineage.branchOrigin
    const mediaModelCircleSettings = settings.mediaBranchLineage.mediaModelCircle

    paneEl.style.setProperty('--connector-line-default-color', connectorStyles.lineDefaultColor)
    paneEl.style.setProperty('--connector-line-focus-color', connectorStyles.lineFocusColor)
    paneEl.style.setProperty('--selection-marquee-border-color', selectionStyles.marqueeBorderColor)
    paneEl.style.setProperty('--selection-marquee-background-color', selectionStyles.marqueeBackgroundColor)
    paneEl.style.setProperty('--selection-overlay-border-color', selectionStyles.overlayBorderColor)
    paneEl.style.setProperty('--selection-overlay-background-color', selectionStyles.overlayBackgroundColor)
    paneEl.style.setProperty('--selection-outline-color', selectionStyles.outlineColor)
    paneEl.style.setProperty('--workspace-media-node-default-box-shadow', mediaNodeStyles.defaultBoxShadow)
    paneEl.style.setProperty('--workspace-media-node-selected-box-shadow', mediaNodeStyles.selectedBoxShadow)
    paneEl.style.setProperty('--workspace-media-node-border-radius', `${mediaNodeStyles.borderRadius}px`)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-background', generatedMediaInfoPanelStyles.background)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-border', generatedMediaInfoPanelStyles.border)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-border-radius', generatedMediaInfoPanelStyles.borderRadius)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-box-shadow', generatedMediaInfoPanelStyles.boxShadow)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-color', generatedMediaInfoPanelStyles.color)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-overflow', generatedMediaInfoPanelStyles.overflow)
    paneEl.style.setProperty('--workspace-generated-media-info-panel-padding', generatedMediaInfoPanelStyles.padding)
    applyMediaModelBadgeStyleProperties(paneEl)
    paneEl.style.setProperty('--workspace-branch-origin-icon-size', `${branchOriginSettings.iconSize}px`)
    paneEl.style.setProperty('--workspace-branch-origin-background-color', branchOriginSettings.styles.backgroundColor)
    paneEl.style.setProperty('--workspace-branch-origin-border-color', branchOriginSettings.styles.borderColor)
    paneEl.style.setProperty('--workspace-branch-origin-icon-color', branchOriginSettings.styles.iconColor)
    paneEl.style.setProperty('--workspace-branch-origin-box-shadow', branchOriginSettings.styles.boxShadow)
    paneEl.style.setProperty('--workspace-branch-marker-separator-gradient', branchOriginSettings.styles.separatorGradient)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-circle-size', `${mediaModelCircleSettings.size}px`)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-icon-size', `${mediaModelCircleSettings.iconSize}px`)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-main-gap', `${mediaModelCircleSettings.mainGap}px`)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-stack-gap', `${mediaModelCircleSettings.stackGap}px`)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-icon-color', mediaModelCircleSettings.styles.iconColor)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-circle-background-color', mediaModelCircleSettings.styles.backgroundColor)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-circle-box-shadow', mediaModelCircleSettings.styles.boxShadow)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-texture-inset', `${mediaModelCircleSettings.texture.inset}px`)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-texture-opacity', `${mediaModelCircleSettings.texture.opacity}`)
    paneEl.style.setProperty('--workspace-branch-marker-media-model-texture-background-size', `${mediaModelCircleSettings.texture.backgroundSizePercent}% ${mediaModelCircleSettings.texture.backgroundSizePercent}%`)
    paneEl.style.setProperty('--workspace-branch-marker-move-duration', `${settings.mediaBranchLineage.pendingMarkerMoveDurationMs}ms`)
    const branchMarkerText = settings.mediaBranchLineage.marker.text
    paneEl.style.setProperty('--workspace-branch-marker-message-font-size', `${branchMarkerText.messageFontSize}px`)
    paneEl.style.setProperty('--workspace-branch-marker-message-line-height', `${branchMarkerText.messageLineHeight}`)
    paneEl.style.setProperty('--workspace-branch-marker-response-font-size', `${branchMarkerText.responseFontSize}px`)
    paneEl.style.setProperty('--workspace-branch-marker-response-line-height', `${branchMarkerText.responseLineHeight}`)
    const normalizedInitialCanvasState: CanvasState | null = options.canvasState
        ? normalizeBranchMarkerDimensions(options.canvasState)
        : options.canvasState
    const initialMediaAnalysisState = normalizedInitialCanvasState
        ? resetStaleAnalyzingMediaDescriptors(normalizedInitialCanvasState)
        : { state: normalizedInitialCanvasState, changed: false }
    let currentCanvasState: CanvasState | null = initialMediaAnalysisState.state
    let initialStaleMediaAnalysisReset = initialMediaAnalysisState.changed
    let currentDocuments: Document[] = options.documents
    let currentAiChatThreads: AiChatThread[] = options.aiChatThreads
    let panZoom: PanZoomInstance | null = null
    let lastTransform: Transform = [0, 0, 1]

    let connectionManager: WorkspaceConnectionManager | null = null
    let pixiMediaLayer: PixiMediaLayer | null = null
    let workspaceLoadingOutline: WorkspaceLoadingOutlineInstance | null = null
    let viewportBridge: ViewportBridge | null = null
    let lastWorkspaceLoadingStatus = workspaceStore.getMeta('loadingStatus') as LoadingStatus
    let renderedWorkspaceId: string | null = currentCanvasState ? workspaceId : null
    let mediaChromeViewportEl: HTMLDivElement | null = null
    let generatedMediaChromeLayerEl: HTMLDivElement | null = null
    let pendingGeneratedMediaIconLayerEl: HTMLDivElement | null = null
    let generatedMediaInfoPanelLayerEl: HTMLDivElement | null = null
    // Screen-fixed pending markers live here, not in viewportEl: they are not real
    // canvas nodes until the API lineage plan resolves, so pan/zoom must not scale
    // them. The overlay sits above every canvas layer and is intentionally not
    // registered with the viewport bridge.
    let pendingBranchMarkerOverlayEl: HTMLDivElement | null = null
    let generatedMediaChromeSyncRaf: number | null = null

    const liveNodeOverrides: Map<string, { position?: { x: number; y: number }; dimensions?: { width: number; height: number } }> = new Map()
    const branchMarkerProjectionOverrideNodeIds: Set<string> = new Set()
    const manuallyPositionedBranchMarkerNodeIds: Set<string> = new Set()
    // Streamed AI tokens are dispatched with `skipDispatch`, so the aiChatThreads
    // store lags behind the live editor doc until the stream settles. Branch
    // lineage markers read their preview text from this override while a thread is
    // actively streaming so the response line tracks the doc token-by-token; it is
    // cleared once the store catches up via onEditorChange.
    const liveAiChatThreadContentOverrides: Map<string, object> = new Map()
    const branchMarkerHandoffDebugKeys: Set<string> = new Set()
    const pendingAiChatThreadRefreshTimers: Map<string, number[]> = new Map()
    let edgesRaf: number | null = null
    let transformSideEffectsRaf: number | null = null
    let pendingHandleZoom: number | null = null
    let selectedNodeIds: Set<string> = new Set()
    let selectedEdgeId: string | null = null
    const expandedGeneratedMediaInfoNodeIds: Set<string> = new Set()
    const expandedGeneratedMediaHistoryNodeIds: Set<string> = new Set()
    const expandedBranchOriginInfoNodeIds: Set<string> = new Set()
    const expandedBranchForkInfoNodeIds: Set<string> = new Set()
    const expandedBranchLineInfoNodeIds: Set<string> = new Set()
    const generatedMediaInfoRenderers: Map<string, ReadOnlyAiChatThreadRendererInstance> = new Map()
    const generatedMediaAssetEditors: Map<string, ProseMirrorEditor> = new Map()
    const generatedMediaAssetDropdowns: Map<string, ReturnType<typeof createPureDropdown>> = new Map()
    const branchMarkerReviewDropdowns: Map<string, ReturnType<typeof createPureDropdown>> = new Map()
    const generatedMediaInfoPreviewTiles: Set<ContextPreviewTileInstance> = new Set()
    const RESET_GENERATED_MEDIA_CHROME_SYNC_KEY = '\u0000reset-generated-media-chrome'
    let generatedMediaChromeSyncKey = RESET_GENERATED_MEDIA_CHROME_SYNC_KEY
    const activeAiChatPanelTracePreviewTiles: Set<ContextPreviewTileInstance> = new Set()
    const videoControlInstances: Map<string, VideoControlsInstance> = new Map()
    const mediaAnalysisRequestsInFlight: Set<string> = new Set()
    const branchMarkerReasoningTooltips: Map<string, HelpTooltipInstance> = new Map()
    const branchMarkerMediaModelTooltips: Map<string, HelpTooltipInstance[]> = new Map()
    const detachedAiChatThreadEditors: Map<string, AiChatThreadEditorEntry> = new Map()
    let detachedAiChatThreadHostEl: HTMLDivElement | null = null
    const VIDEO_CONTROLS_HEIGHT = settings.videoControls.height
    const VIDEO_CONTROLS_HORIZONTAL_INSET = settings.videoControls.canvas.horizontalInset
    const VIDEO_CONTROLS_COMPACT_HORIZONTAL_INSET = settings.videoControls.canvas.compactHorizontalInset
    const VIDEO_CONTROLS_COMPACT_WIDTH_THRESHOLD = settings.videoControls.canvas.compactWidthThreshold
    const VIDEO_CONTROLS_BOTTOM_INSET = settings.videoControls.canvas.bottomInset
    const RIGHT_SIDE_PANEL_SETTINGS = settings.rightSidePanel
    let resizingNodeId: string | null = null
    let draggingNodeId: string | null = null
    let selectionRectEl: HTMLDivElement | null = null
    let selectionGroupOverlayEl: HTMLDivElement | null = null
    let marqueeSelection: MarqueeSelectionState | null = null
    let selectionIsFromMarquee = false
    let suppressNextPaneClick = false
    let suppressNextNodeClick = false
    const nodeLayerManager = createNodeLayerManager()
    const documentEditors: Map<string, DocumentEditorEntry> = new Map()
    const threadEditors: Map<string, AiChatThreadEditorEntry> = new Map()
    // Per-node debounce timers for document/thread descriptor regeneration. Keyed
    // by canvas nodeId so rapid edits collapse into one describe call once typing
    // (or a streaming transcript) settles.
    const textDescriptorTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    let activeAiChatThreadId: string | null = null
    let activeAiChatPanelThreadId: string | null = null
    let activeAiChatPanelHadContent = false
    let activeAiChatPanelEl: HTMLDivElement | null = null
    let activeAiChatPanelTabsSwitch: SlidingTabsSwitchInstance<string> | null = null
    // Top-level Features / Media / AI Threads switch that lives at the top of the
    // right side panel. Rebuilt on every panel render alongside the panel chrome.
    let activeRightPanelModeSwitch: SlidingSwitchInstance<CanvasRightSidePanelMode> | null = null
    // Set while a preserved-switch body re-render runs, so no resize path snaps
    // the indicator mid-slide.
    let suppressModeSwitchResize = false
    let activeRightPanelRenderedMode: CanvasRightSidePanelMode | null = null
    let activeRightPanelModeSwitchAnimationTimer: ReturnType<typeof setTimeout> | null = null
    let activeAiChatPanelProjectionRenderer: ReadOnlyAiChatThreadRendererInstance | null = null
    let activeRightSidePanel: SidePanelInstance | null = null
    // Screen-fixed, canvas-wide composer mounted at the bottom-center of the
    // viewport. Each submission creates one hidden ProseMirror-backed message
    // instance whose visible projection is the spatial branch lineage marker.
    let globalCanvasComposer: AiPromptComposerInstance | null = null
    let globalCanvasComposerHostEl: HTMLDivElement | null = null
    // Feature extraction opens on the right panel's Features surface. Confirming
    // the pending feature row starts the dedicated extraction stream there.
    const pendingFeatureExtractionRuns = new Map<string, CanvasFeatureExtractionState>()
    const apiFeatureExtractionRuns = new Map<string, CanvasFeatureExtractionState>()
    const subscribedFeatureExtractionRunSubjects = new Map<string, { subject: string; errorSubject: string }>()
    const featureExtractionModelSelections = new Map<string, FeatureExtractionModelContext>()
    const featureExtractionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
    // In-flight detached canvas message ids for stream reattachment and delayed
    // editor teardown. Generated-media event routing uses normal thread and
    // workspace state.
    const activeCanvasRunIds: Set<string> = new Set()
    const settledDetachedCanvasRunThreadIds: Set<string> = new Set()
    const activeCanvasRunServices: Map<string, AiInteractionService> = new Map()
    const activeCanvasRunTeardowns: Set<() => void> = new Set()
    const activeCanvasRunTeardownsByThread: Map<string, () => void> = new Map()
    const DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS = 30 * 60 * 1000
    const activeContextChipTrayEls: Set<HTMLDivElement> = new Set()
    const contextPreviewTilesByTray: Map<HTMLDivElement, Set<ContextPreviewTileInstance>> = new Map()
    let contextPreviewRefreshVersion = 0
    let mediaLibraryPanelInstance: ReturnType<typeof createMediaLibraryPanel> | null = null
    const assetService = new AssetService()
    let activeAiChatSidebarThreadId: string | null = null
    let activeAiChatSidebarTabId: string | null = null
    let aiChatSidebarTabs: CanvasAiChatSidebarTab[] = []
    let aiChatPanelState: CanvasAiChatPanelState = getAiChatPanelState(currentCanvasState)
    let extractionSessionHistoryLoaded = false
    let pendingLocalCanvasVisualCommit: PendingCanvasVisualCommit | null = null
    let nodePointerPanLockNodeId: string | null = null
    let paneNoPanAddedForNodePointer = false
    const partialImageTracker = new Map<string, PendingGeneratedMediaTracker>()
    const cancelledMediaGenerationRequestIds = new Set<string>()
    const finalizingGeneratedImageRunKeysByNodeId = new Map<string, string>()
    const finalizingGeneratedImageOutlineTimersByNodeId = new Map<string, number>()
    const decodedGeneratedImageNodeIds = new Set<string>()
    const generatingReferenceNodeIdsByThread = new Map<string, Set<string>>()
    // Visibility tracking for lazy loading
    const visibleNodeIds: Set<string> = new Set()
    const loadedNodeIds: Set<string> = new Set()
    let paneRect: DOMRect | null = null


    // Pending video-generation tracker: mirrors partialImageTracker. VEO has no
    // partial frames, so the sequence is VIDEO_PENDING (apply the API-persisted
    // placeholder + tracker entry) -> VIDEO_GENERATING keepalives (no state mutation) ->
    // VIDEO_COMPLETE (finalize the same node + clear tracker). Source-shape
    // tests guard that this is the ONLY tracker used for video generation —
    // there is no DOM spinner, mirroring PR #202's image pattern.
    const videoGenerationTracker = new Map<string, PendingGeneratedMediaTracker>()
    let videoNodeHandler: VideoNodeHandlerControl | null = null
    let audioNodeHandler: AudioNodeHandlerControl | null = null

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
    workspaceLoadingOutline = createWorkspaceLoadingOutline({
        paneEl,
        onRetry: () => {
            const targetWorkspaceId = workspaceId
            if (!targetWorkspaceId) return
            workspaceLoadingOutline?.setErrorMessage(null)
            void loadWorkspaceRouteData(targetWorkspaceId)
        },
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

            // Uploaded audio + document nodes share the same media container as
            // video. Audio owns a hidden DOM <audio> surface (playback chrome is
            // wired like video); documents render a first-page poster sprite only.
            audioNodeHandler = createAudioNodeHandler({
                audioLayer: videoLayer,
                onRender: () => pixiMediaLayer?.scheduleRender?.(),
                onAudioElementReady: () => scheduleGeneratedMediaChromeSync(),
            })
            mediaRegistry.register(audioNodeHandler)

            mediaRegistry.register(createDocumentNodeHandler({
                documentLayer: videoLayer,
                onRender: () => pixiMediaLayer?.scheduleRender?.(),
            }))
        }
    }
    mediaChromeViewportEl = createMediaChromeViewport()
    generatedMediaChromeLayerEl = createGeneratedMediaChromeLayer()
    pendingGeneratedMediaIconLayerEl = createPendingGeneratedMediaIconLayer()
    generatedMediaInfoPanelLayerEl = createGeneratedMediaInfoPanelLayer()
    pendingBranchMarkerOverlayEl = createPendingBranchMarkerOverlay()
    viewportBridge = createViewportBridge({
        viewportEl,
        viewportOverlayEls: [mediaChromeViewportEl, generatedMediaInfoPanelLayerEl],
        getPixiLayers: () => [pixiMediaLayer],
    })
    if (currentCanvasState?.viewport) {
        viewportBridge.applyViewport(currentCanvasState.viewport)
    }
    syncPixiMediaLayer(currentCanvasState)
    createGlobalCanvasComposer()

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
                const resolvedTreeState = deletedNode && isBranchTreeCanvasNode(deletedNode)
                    ? resolveGeneratedMediaTreeState(remainingNodes, updatedEdges)
                    : { nodes: remainingNodes, edges: updatedEdges }

                selectNode(null)
                const nextState = { ...currentCanvasState, nodes: resolvedTreeState.nodes, edges: resolvedTreeState.edges }
                const assetId = (deletedNode as CanvasNode & { assetId?: string } | undefined)?.assetId
                if (assetId && onAssetDetach) {
                    await onAssetDetach({ assetId, nodeId, canvasState: nextState })
                    commitTransientCanvasStatePreservingEditors(nextState)
                    return
                }
                commitCanvasState(nextState)
            },
            onDownloadMedia: (nodeId) => {
                const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
                if (!node) return

                // Uploaded documents/audio use a tokenized attachment link.
                if (node.type === 'mediaDocument' || node.type === 'audio') {
                    void (async () => {
                        const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                        const token = await AuthService.getTokenSilently()
                        if (!token) return
                        const href = `${API_BASE_URL}${buildAssetRenditionPath(node.assetId, 'original')}?download=true&token=${encodeURIComponent(token)}`
                        const a = document.createElement('a')
                        a.href = href
                        a.rel = 'noopener'
                        a.style.display = 'none'
                        document.body.appendChild(a)
                        a.click()
                        a.remove()
                    })()
                    return
                }

                if (node.type !== 'image' && node.type !== 'video') return

                void (async () => {
                    const API_BASE_URL = import.meta.env.VITE_API_URL || ''
                    const token = await AuthService.getTokenSilently()
                    const rendition = node.type === 'video' ? 'preview' : 'original'
                    const resolvedSrc = buildAssetRenditionPath(node.assetId, rendition)
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

                    const response = await fetch(`${API_BASE_URL}${buildAssetUploadPath(workspaceId)}`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    })

                    if (!response.ok) return

                    const data = await response.json() as { assetId?: string; kind?: string }
                    if (!data.assetId || data.kind !== node.type || !currentCanvasState || !onAssetDetach || !onAssetAttach) return

                    const originalState = currentCanvasState
                    const detachedState: CanvasState = {
                        ...originalState,
                        nodes: originalState.nodes.filter((candidate) => candidate.nodeId !== nodeId),
                        edges: originalState.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
                    }
                    await onAssetDetach({ assetId: node.assetId, nodeId, canvasState: detachedState })
                    commitTransientCanvasStatePreservingEditors(detachedState)
                    const replacementNode = { ...node, assetId: data.assetId } as ImageCanvasNode | VideoCanvasNode
                    const attachedState: CanvasState = {
                        ...detachedState,
                        nodes: [...detachedState.nodes, replacementNode],
                        edges: originalState.edges,
                    }
                    await onAssetAttach({ assetId: data.assetId, nodeId, canvasState: attachedState })
                    commitTransientCanvasStatePreservingEditors(attachedState)
                })
                document.body.appendChild(input)
                input.click()
            },
            onOpenAsset: (nodeId) => {
                const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId) as CanvasNode & { assetId?: string } | undefined
                if (!node?.assetId) return
                openRightSidePanelToMode('media')
                ensureMediaLibraryPanel().showAsset(node.assetId)
            },
            onAskAi: async (nodeId) => {
                const imageNode = currentCanvasState?.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
                if (!imageNode || imageNode.type !== 'image') return

                try {
                    const imageNatsUrl = `asset://${imageNode.assetId}`

                    const extractionRunId = uuidv4()
                    const sourceContextSnapshot: ExtractionTabContext = {
                        imageNatsUrl,
                        contextMessages: [],
                    }

                    setPendingExtractionContext(extractionRunId, sourceContextSnapshot)
                    setPendingFeatureExtractionRun({
                        extractionRunId,
                        status: 'pending',
                        userText: 'Extract a reusable visual feature from this image.',
                        sourceContextSnapshot,
                        updatedAt: Date.now(),
                    })

                    openFeatureExtractionRunInFeatures(extractionRunId)
                } catch (error) {
                    console.error('Failed to open feature extraction from image:', error)
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
            getVisualScale: () => scaleCanvasChromeToScreenForZoom(
                1,
                getCurrentViewportZoom(),
                getAdaptiveBoundedZoomScalingOptions(settings.canvasBubbleMenu.zoomScaling),
            ),
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
            if (node.type !== 'image' && node.type !== 'video' && node.type !== 'document' && node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine') continue
            const worldPosition = getNodeWorldPosition(node, nodesById)
            const pendingCircleGeometry = getPendingGeneratedMediaBeforeFrameCircleGeometry(
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
                : getNodeWorldRect(node, nodesById)
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

        const nodesById = getCanvasNodesById(currentCanvasState?.nodes ?? nodes)
        for (const node of nodes) {
            const position = getNodeWorldPosition(node, nodesById)
            const dimensions = liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            const nodeEl = viewportEl.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
            if (nodeEl) {
                applyStyle(nodeEl, {
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    width: `${dimensions.width}px`,
                    height: `${dimensions.height}px`,
                })
                updatePendingGeneratedMediaBeforeFrameClass(nodeEl, node.nodeId)
            }
            updateGeneratedMediaChromeLiveTransform(node.nodeId, position, dimensions, getLiveViewport())
        }

        updateSelectionGroupOverlayElement()
        repositionCanvasBubbleMenu()
    }

    function createMediaChromeViewport(): HTMLDivElement {
        const chromeViewportStyle = {
            position: 'absolute' as const,
            top: '0',
            left: '0',
            transformOrigin: '0 0',
            willChange: 'transform',
            pointerEvents: 'none' as const,
            zIndex: '3',
        }
        const chromeViewport = html`<div className="workspace-media-chrome-viewport" style=${chromeViewportStyle}></div>` as HTMLDivElement
        paneEl.appendChild(chromeViewport)
        return chromeViewport
    }

    function createPendingBranchMarkerOverlay(): HTMLDivElement {
        const overlayStyle = {
            position: 'absolute' as const,
            inset: '0',
            pointerEvents: 'none' as const,
            // Above the canvas content/media layers and the composer host (9990)
            // so context items added to the prompt slide behind the marker.
            zIndex: '9991',
        }
        const overlay = html`<div className="workspace-pending-branch-marker-overlay" style=${overlayStyle}></div>` as HTMLDivElement
        paneEl.appendChild(overlay)
        return overlay
    }

    function findBranchMarkerNodeEl(nodeId: string): HTMLElement | null {
        return (pendingBranchMarkerOverlayEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null)
            ?? (viewportEl.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null)
    }

    function getBranchMarkerNodeEls(nodeId: string): HTMLElement[] {
        return [
            ...(pendingBranchMarkerOverlayEl?.querySelectorAll(`[data-node-id="${nodeId}"]`) ?? []),
            ...viewportEl.querySelectorAll(`[data-node-id="${nodeId}"]`),
        ] as HTMLElement[]
    }

    function removeDuplicateBranchMarkerNodeEls(nodeId: string, keepEl: HTMLElement): void {
        for (const nodeEl of getBranchMarkerNodeEls(nodeId)) {
            if (nodeEl !== keepEl) nodeEl.remove()
        }
        connectionManager?.registerNodeElement(nodeId, keepEl as HTMLDivElement)
    }

    function findBranchMarkerNodeElForNode(node: BranchMarkerNode): HTMLElement | null {
        const overlayEl = pendingBranchMarkerOverlayEl?.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
        const viewportNodeEl = viewportEl.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
        const nodeEl = node.pendingState?.phase === 'preflight'
            ? overlayEl ?? viewportNodeEl
            : viewportNodeEl ?? overlayEl
        if (nodeEl) removeDuplicateBranchMarkerNodeEls(node.nodeId, nodeEl)
        return nodeEl
    }

    function createGeneratedMediaChromeLayer(): HTMLDivElement {
        const chromeLayerStyle = {
            position: 'absolute' as const,
            inset: '0',
            pointerEvents: 'none' as const,
            zIndex: '1',
        }
        const chromeLayer = html`<div className="workspace-generated-media-chrome-layer" style=${chromeLayerStyle}></div>` as HTMLDivElement
        paneEl.appendChild(chromeLayer)
        return chromeLayer
    }

    function createPendingGeneratedMediaIconLayer(): HTMLDivElement {
        const iconLayerStyle = {
            position: 'absolute' as const,
            inset: '0',
            pointerEvents: 'none' as const,
            zIndex: '4',
        }
        const iconLayer = html`<div className="workspace-generated-media-pending-icon-layer" style=${iconLayerStyle}></div>` as HTMLDivElement
        paneEl.appendChild(iconLayer)
        return iconLayer
    }

    // Viewport-transformed overlay for expandable media info panels. This keeps
    // the panel on the same natural canvas scale as the media node while the
    // separate generated-media icon strip keeps its bounded screen-space scaling.
    function createGeneratedMediaInfoPanelLayer(): HTMLDivElement {
        const panelLayerStyle = {
            position: 'absolute' as const,
            top: '0',
            left: '0',
            transformOrigin: '0 0',
            willChange: 'transform',
            pointerEvents: 'none' as const,
            zIndex: String(settings.mediaNode.generatedMediaInfoPanel.layerZIndex),
        }
        const panelLayer = html`<div className="workspace-generated-media-info-panel-layer" style=${panelLayerStyle}></div>` as HTMLDivElement
        paneEl.appendChild(panelLayer)
        return panelLayer
    }

    function applyGeneratedMediaChromeGeometry(
        chromeEl: HTMLElement,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
        extraTopOffsetScreen = 0,
    ): void {
        // Generated-media chrome is not a child of the viewport-transformed DOM
        // layer. It is projected into screen coordinates here, then scaled with
        // the adaptive bounded curve. That keeps the strip aligned to the media
        // node while preventing the info icon from visually dominating the image
        // as the user zooms out.
        const chromeLayout = getCanvasChromeScreenLayout({
            viewport,
            worldPosition: position,
            worldDimensions: dimensions,
            baseGap: settings.mediaNode.generatedMediaChrome.gap,
            zoomScaling: getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),
        })
        applyStyle(chromeEl, {
            left: `${chromeLayout.left}px`,
            top: `${chromeLayout.top + extraTopOffsetScreen}px`,
            width: `${chromeLayout.layoutWidth}px`,
            transformOrigin: '0 0',
            transform: `scale(${chromeLayout.screenScale})`,
        })
        const titleEl = chromeEl.querySelector('.workspace-generated-media-title') as HTMLElement | null
        if (titleEl) {
            const nodeScreenTop = viewport.y + position.y * getSafeViewportZoom(viewport)
            applyStyle(titleEl, {
                top: `${(nodeScreenTop - chromeLayout.top - extraTopOffsetScreen) / chromeLayout.screenScale - 2}px`,
            })
        }
    }

    function applyPendingGeneratedMediaIconGeometry(
        iconEl: HTMLElement,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
    ): void {
        const zoom = getSafeViewportZoom(viewport)
        const screenScale = scaleCanvasChromeToScreenForZoom(
            1,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),
        )
        const centerX = viewport.x + (position.x + dimensions.width / 2) * zoom
        const centerY = viewport.y + (position.y + dimensions.height / 2) * zoom

        applyStyle(iconEl, {
            left: `${centerX}px`,
            top: `${centerY}px`,
            transformOrigin: 'center',
            transform: `translate(-50%, -50%) scale(${screenScale})`,
        })
    }

    function applyGeneratedMediaInfoPanelGeometry(
        panel: HTMLElement,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
        extraTopOffsetScreen = 0,
    ): void {
        const panelSettings = settings.mediaNode.generatedMediaInfoPanel
        const zoom = Number.isFinite(viewport.zoom) ? Math.max(viewport.zoom, 0.01) : 1
        const iconStripScreenGap = scaleCanvasChromeToScreenForZoom(
            settings.mediaNode.generatedMediaChrome.gap,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),
        )
        const iconScreenSize = scaleCanvasChromeToScreenForZoom(
            settings.mediaNode.generatedMediaChrome.iconSize,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),
        )
        // The info panel lives in the normal viewport-transformed panel layer,
        // so its top coordinate must be converted back to world units. The strip
        // gap and icon height are computed in final screen pixels, then divided
        // by zoom before being added to the media node's world-space bottom.
        const panelTop = position.y + dimensions.height + (extraTopOffsetScreen + iconStripScreenGap + iconScreenSize + iconStripScreenGap) / zoom
        const anchorWidth = Number.isFinite(dimensions.width) && dimensions.width > 0
            ? dimensions.width
            : settings.mediaBranchLineage.generatedMediaSize
        const panelWidth = getConfiguredGeneratedMediaInfoPanelWidth(anchorWidth)

        applyStyle(panel, {
            left: `${position.x + panelSettings.horizontalOffset}px`,
            top: `${panelTop}px`,
            width: `${panelWidth}px`,
            transform: 'none',
        })
    }

    function getConfiguredGeneratedMediaInfoPanelWidth(anchorWidth: number): number {
        const panelSettings = settings.mediaNode.generatedMediaInfoPanel
        const widthMultiplier = Number.isFinite(panelSettings.widthMultiplier) && panelSettings.widthMultiplier > 0
            ? panelSettings.widthMultiplier
            : 1
        const scaledWidth = Math.max(1, anchorWidth * widthMultiplier)
        const minWidth = Number.isFinite(panelSettings.minWidth) && panelSettings.minWidth > 0
            ? panelSettings.minWidth
            : 0
        const maxWidth = panelSettings.maxWidth == null || !Number.isFinite(panelSettings.maxWidth) || panelSettings.maxWidth <= 0
            ? Number.POSITIVE_INFINITY
            : panelSettings.maxWidth

        return Math.max(minWidth, Math.min(maxWidth, scaledWidth))
    }

    function getGeneratedMediaInfoPanelWidth(generatedMediaNodes: Array<ImageCanvasNode | VideoCanvasNode>): number {
        const generatedMediaWidth = Math.max(
            0,
            ...generatedMediaNodes.map((node: ImageCanvasNode | VideoCanvasNode) => node.dimensions.width)
        )
        return getConfiguredGeneratedMediaInfoPanelWidth(generatedMediaWidth || settings.mediaBranchLineage.generatedMediaSize)
    }

    function getBranchOriginInfoPanelWidth(branchOriginNodeId: string): number {
        return getGeneratedMediaInfoPanelWidth(getBranchOriginGeneratedMediaNodes(branchOriginNodeId))
    }

    function getBranchForkInfoPanelWidth(branchForkNodeId: string): number {
        return getGeneratedMediaInfoPanelWidth(getBranchForkGeneratedMediaNodes(branchForkNodeId))
    }

    function getBranchLineInfoPanelWidth(branchLineNodeId: string): number {
        return getGeneratedMediaInfoPanelWidth(getBranchLineGeneratedMediaNodes(branchLineNodeId))
    }

    function applyBranchOriginInfoChromeGeometry(
        chromeEl: HTMLElement,
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        panelWidth: number,
        viewport: Viewport = getLiveViewport(),
    ): void {
        const anchor = getBranchMarkerInfoPanelAnchor(nodeId, position, dimensions, viewport)
        const panelSettings = settings.mediaNode.generatedMediaInfoPanel
        applyStyle(chromeEl, {
            left: `${anchor.x + panelSettings.horizontalOffset}px`,
            top: `${anchor.y + anchor.height + panelSettings.branchMarkerTopOffset}px`,
            width: `${panelWidth}px`,
        })
    }

    function getBranchMarkerInfoPanelAnchor(
        nodeId: string,
        fallbackPosition: { x: number; y: number },
        fallbackDimensions: { width: number; height: number },
        viewport: Viewport,
    ): { x: number; y: number; width: number; height: number } {
        const fallback = {
            x: fallbackPosition.x,
            y: fallbackPosition.y,
            width: fallbackDimensions.width,
            height: fallbackDimensions.height,
        }
        const nodeEl = findBranchMarkerNodeEl(nodeId)
        if (!nodeEl) return fallback

        const measuredEls = [
            nodeEl,
            ...Array.from(nodeEl.querySelectorAll<HTMLElement>([
                '.workspace-branch-marker-content',
                '.workspace-branch-marker-main',
                '.workspace-branch-marker-message',
                '.workspace-branch-marker-separator',
                '.workspace-branch-marker-response',
                '.workspace-branch-marker-media-models',
            ].join(', '))),
        ]
        const rects = measuredEls
            .map((el: HTMLElement) => el.getBoundingClientRect())
            .filter((rect: DOMRect) =>
                rect.width > 0
                && rect.height > 0
                && Number.isFinite(rect.left)
                && Number.isFinite(rect.top)
                && Number.isFinite(rect.right)
                && Number.isFinite(rect.bottom))
        if (rects.length === 0) return fallback

        const paneRect = paneEl.getBoundingClientRect()
        const zoom = getSafeViewportZoom(viewport)
        const left = Math.min(...rects.map((rect: DOMRect) => rect.left))
        const top = Math.min(...rects.map((rect: DOMRect) => rect.top))
        const right = Math.max(...rects.map((rect: DOMRect) => rect.right))
        const bottom = Math.max(...rects.map((rect: DOMRect) => rect.bottom))

        return {
            x: (left - paneRect.left - viewport.x) / zoom,
            y: (top - paneRect.top - viewport.y) / zoom,
            width: (right - left) / zoom,
            height: (bottom - top) / zoom,
        }
    }

    function getVideoControlsZoomScalingOptions() {
        return getAdaptiveBoundedZoomScalingOptions(settings.videoControls.canvas.zoomScaling)
    }

    function getSafeViewportZoom(viewport: Viewport): number {
        return Number.isFinite(viewport.zoom) ? Math.max(viewport.zoom, 0.01) : 1
    }

    function getVideoControlsScreenScale(viewport: Viewport): number {
        return scaleCanvasChromeToScreenForZoom(1, getSafeViewportZoom(viewport), getVideoControlsZoomScalingOptions())
    }

    function getVideoControlsChromeLayout(
        dimensions: { width: number; height: number },
        viewport: Viewport
    ): { insetX: number; top: number; width: number; height: number; logicalWidth: number; responsiveWidth: number } {
        const zoom = getSafeViewportZoom(viewport)
        const screenScale = getVideoControlsScreenScale(viewport)
        const projectedNodeWidth = dimensions.width * zoom
        const baseInset = projectedNodeWidth >= VIDEO_CONTROLS_COMPACT_WIDTH_THRESHOLD
            ? VIDEO_CONTROLS_HORIZONTAL_INSET
            : VIDEO_CONTROLS_COMPACT_HORIZONTAL_INSET
        const insetX = scaleCanvasChromeWorldSizeForZoom(baseInset, zoom, getVideoControlsZoomScalingOptions())
        const top = dimensions.height + scaleCanvasChromeWorldSizeForZoom(VIDEO_CONTROLS_BOTTOM_INSET, zoom, getVideoControlsZoomScalingOptions())
        const width = Math.max(1, dimensions.width - insetX * 2)
        const height = Math.max(1, (VIDEO_CONTROLS_HEIGHT * screenScale) / zoom)
        const responsiveWidth = Math.max(1, width * zoom)
        const logicalWidth = Math.max(1, (width * zoom) / screenScale)

        return {
            insetX,
            top,
            width,
            height,
            logicalWidth,
            responsiveWidth,
        }
    }

    function getVideoControlsOutsideOffsetScreen(nodeId: string, viewport: Viewport): number {
        if (!videoControlInstances.has(nodeId)) return 0
        const zoom = getSafeViewportZoom(viewport)
        const zoomScaling = getVideoControlsZoomScalingOptions()
        return scaleCanvasChromeToScreenForZoom(VIDEO_CONTROLS_BOTTOM_INSET, zoom, zoomScaling)
            + scaleCanvasChromeToScreenForZoom(VIDEO_CONTROLS_HEIGHT, zoom, zoomScaling)
    }

    function getVideoChromeResizeHandle(event: MouseEvent, chromeEl: HTMLElement): ResizeCorner | null {
        const surface = chromeEl.querySelector('.workspace-video-surface') as HTMLElement | null
        const rect = surface?.getBoundingClientRect() ?? chromeEl.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
        const resizeHandleSettings = settings.mediaNode.resizeHandle
        const zoom = getCurrentViewportZoom()
        const { size, offset } = settings.mediaNode.useZoomCompensatedResizeHandleScaling
            ? getResizeHandleScaledSizes(zoom, {
                baseSize: resizeHandleSettings.size,
                baseOffset: resizeHandleSettings.offset,
                minSize: resizeHandleSettings.minSize,
                zoomScaling: getAdaptiveBoundedZoomScalingOptions(resizeHandleSettings.zoomScaling),
            })
            : { size: resizeHandleSettings.size, offset: resizeHandleSettings.offset }
        // The surface rect and event coordinates are screen
        // pixels, but resize handle sizing is computed in world units because
        // the completed-video chrome is inside the viewport-transformed overlay.
        // Convert the handle hit radius back to screen pixels before comparing.
        const hitSize = Math.max(16, (size + Math.max(0, offset)) * zoom)

        if (x <= hitSize && y <= hitSize) return 'top-left'
        if (x >= rect.width - hitSize && y <= hitSize) return 'top-right'
        if (x <= hitSize && y >= rect.height - hitSize) return 'bottom-left'
        if (x >= rect.width - hitSize && y >= rect.height - hitSize) return 'bottom-right'
        return null
    }

    // The video chrome keeps the visible video surface node-sized, then mounts
    // the controls as a separate row below it. Only the surface mirrors node
    // drag/click/resize; individual control hit areas stop their own events.
    function applyVideoControlsGeometry(
        chromeEl: HTMLElement,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport = getLiveViewport()
    ): void {
        const controlsLayout = getVideoControlsChromeLayout(dimensions, viewport)
        applyStyle(chromeEl, {
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: `${dimensions.width}px`,
            height: `${controlsLayout.top + controlsLayout.height}px`,
        })

        const surface = chromeEl.querySelector('.workspace-video-surface') as HTMLElement | null
        if (surface) {
            applyStyle(surface, {
                width: `${dimensions.width}px`,
                height: `${dimensions.height}px`,
            })
        }

        const host = chromeEl.querySelector('.workspace-video-controls-host') as HTMLElement | null
        if (host) {
            applyStyle(host, {
                left: `${controlsLayout.insetX}px`,
                top: `${controlsLayout.top}px`,
                width: `${controlsLayout.width}px`,
                height: `${controlsLayout.height}px`,
            })
        }

        // The controls host lives inside the viewport-transformed layer. The
        // SVG viewBox is expanded by the inverse bounded scale so the row keeps
        // full node width while glyphs/text use the same low-zoom curve as other
        // canvas chrome.
        const svg = chromeEl.querySelector('.workspace-video-controls-svg') as SVGSVGElement | null
        svg?.setAttribute('viewBox', `0 0 ${controlsLayout.logicalWidth} ${VIDEO_CONTROLS_HEIGHT}`)
        svg?.setAttribute('height', '100%')
        const controls = videoControlInstances.get(chromeEl.dataset.videoChromeNodeId || '')
        controls?.resize(0, 0, controlsLayout.logicalWidth, controlsLayout.responsiveWidth)
    }

    function updateGeneratedMediaChromeLiveTransform(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
    ): void {
        const chromeEl = generatedMediaChromeLayerEl?.querySelector(`[data-media-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        const videoControlsOffsetScreen = getVideoControlsOutsideOffsetScreen(nodeId, viewport)
        if (chromeEl) applyGeneratedMediaChromeGeometry(chromeEl, position, dimensions, viewport, videoControlsOffsetScreen)
        const pendingIconEl = pendingGeneratedMediaIconLayerEl?.querySelector(`[data-pending-media-icon-node-id="${nodeId}"]`) as HTMLElement | null
        if (pendingIconEl) applyPendingGeneratedMediaIconGeometry(pendingIconEl, position, dimensions, viewport)
        updateGeneratedMediaInfoPanelPosition(nodeId, position, dimensions, viewport)
        updateGeneratedMediaHistoryPanelPosition(nodeId, position, dimensions, viewport)
        const videoChromeEl = mediaChromeViewportEl?.querySelector(`[data-video-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (videoChromeEl) applyVideoControlsGeometry(videoChromeEl, position, dimensions, viewport)
        const branchOriginChromeEl = mediaChromeViewportEl?.querySelector(`[data-branch-origin-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (branchOriginChromeEl) applyBranchOriginInfoChromeGeometry(
            branchOriginChromeEl,
            nodeId,
            position,
            dimensions,
            getBranchOriginInfoPanelWidth(nodeId),
            viewport,
        )
        const branchForkChromeEl = mediaChromeViewportEl?.querySelector(`[data-branch-fork-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (branchForkChromeEl) applyBranchOriginInfoChromeGeometry(
            branchForkChromeEl,
            nodeId,
            position,
            dimensions,
            getBranchForkInfoPanelWidth(nodeId),
            viewport,
        )
        const branchLineChromeEl = mediaChromeViewportEl?.querySelector(`[data-branch-line-chrome-node-id="${nodeId}"]`) as HTMLElement | null
        if (branchLineChromeEl) applyBranchOriginInfoChromeGeometry(
            branchLineChromeEl,
            nodeId,
            position,
            dimensions,
            getBranchLineInfoPanelWidth(nodeId),
            viewport,
        )
    }

    function updateGeneratedMediaChromeLayout(viewport: Viewport = getLiveViewport()): void {
        if (!currentCanvasState || !generatedMediaChromeLayerEl) return
        const nodesById = getCanvasNodesById(currentCanvasState.nodes)
        for (const node of currentCanvasState.nodes) {
            if (node.type !== 'image' && node.type !== 'video' && !isBranchMarkerNode(node)) continue
            const position = getNodeWorldPosition(node, nodesById)
            const dimensions = liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            updateGeneratedMediaChromeLiveTransform(node.nodeId, position, dimensions, viewport)
        }
    }

    function getCanvasTraceReferenceImageSources(reference: ImageGenerationTraceReference): string[] {
        if (!currentCanvasState || !reference.nodeId) return []
        const node = currentCanvasState.nodes.find((candidate: CanvasNode) => candidate.nodeId === reference.nodeId)
        if (node?.type === 'image') {
            return [buildAssetRenditionPath(node.assetId, 'preview')]
        }
        if (node?.type === 'video') {
            return [
                buildAssetRenditionPath(node.assetId, 'representativeFrame'),
                buildAssetRenditionPath(node.assetId, 'poster'),
            ]
        }
        return []
    }

    // Renders a trace reference as the canvas context-preview tile — a thumbnail-only
    // tile with the same rich hover card used when media is attached to the AI chat
    // input. Looked up by the reference's canvas nodeId; falls back (null) to the
    // default captioned tile when the referenced node is no longer on the canvas.
    function renderCanvasTraceReferenceTile(
        reference: ImageGenerationTraceReference,
        previewTiles: Set<ContextPreviewTileInstance>,
    ): HTMLElement | null {
        if (!reference.nodeId) return null
        const node = findCanvasNodeById(reference.nodeId)
        if (!node) return null
        const tile = createContextPreviewTile({
            node,
            getNode: () => findCanvasNodeById(reference.nodeId as string) ?? node,
            environment: getContextPreviewEnvironment(),
            preferredPlacement: 'bottom',
            inlinePopover: true,
        })
        previewTiles.add(tile)
        return tile.dom
    }

    function createCanvasTraceDetailsOptions(
        className: string,
        previewTiles: Set<ContextPreviewTileInstance>,
    ): ImageGenerationTraceDetailsOptions {
        return {
            className,
            getAdditionalReferenceImageSources: getCanvasTraceReferenceImageSources,
            renderReferenceTile: (reference) => renderCanvasTraceReferenceTile(reference, previewTiles),
        }
    }

    function getGeneratedMediaProjectionLocator(node: ImageCanvasNode | VideoCanvasNode): GeneratedMediaTurnLocator | null {
        const generatedBy = node.generatedBy
        if (!generatedBy) return null

        return {
            responseMessageId: generatedBy.responseMessageId,
            reasoningRunId: generatedBy.reasoningRunId,
            reasoningModelId: generatedBy.reasoningModelId,
            mediaRunId: generatedBy.mediaRunId,
            mediaType: generatedBy.mediaType ?? node.type,
            assetId: node.assetId,
            variantIndex: generatedBy.variantIndex ?? null,
        }
    }

    function appendGeneratedMediaReasoningModelHeader(
        mount: HTMLElement,
        node: ImageCanvasNode | VideoCanvasNode,
    ): void {
        const reasoningModelId = node.generatedBy?.reasoningModelId
        if (!reasoningModelId) return

        const reasoningModelBadge = createMediaModelBadge({ modelId: reasoningModelId, monochromeIcon: true })
        const reasoningModelHeader = html`<div className="canvas-generated-media-reasoning-model">
            <span className="canvas-generated-media-reasoning-model-caption">Reasoning model:</span>
            ${reasoningModelBadge}
        </div>` as HTMLElement
        applyMediaModelBadgeStyleProperties(reasoningModelHeader, { scale: settings.mediaNode.generatedMediaChrome.chatScale })
        mount.appendChild(reasoningModelHeader)
    }

    function mountGeneratedMediaChatProjection({
        mount,
        node,
        rendererClassName,
        traceDetailsClassName,
        previewTiles,
        lineageProjectionScope,
        limitProjectionToSelectedMedia,
        includeReasoningModelHeader = true,
    }: MountGeneratedMediaProjectionOptions): ReadOnlyAiChatThreadRendererInstance | null {
        const generatedBy = node.generatedBy
        if (!generatedBy) return null

        const locator = getGeneratedMediaProjectionLocator(node)
        if (!locator) return null

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(
            getGeneratedMediaHistoryContent(node),
            locator,
            {
                threadId: generatedBy.conversationAssetId,
                forceGenerationDetailsOpen: true,
                limitToLocatorMedia: limitProjectionToSelectedMedia,
                lineageProjectionScope,
            },
        )
        if (!projection) return null

        if (includeReasoningModelHeader) appendGeneratedMediaReasoningModelHeader(mount, node)
        const projectionMount = html`<div className="canvas-generated-media-projection"></div>` as HTMLElement
        mount.appendChild(projectionMount)

        return mountReadOnlyAiChatThreadProjection({
            mount: projectionMount,
            content: projection.content,
            threadId: projection.threadId,
            className: rendererClassName,
            contextPreview: getAiUserMessageContextPreviewRenderer({ inlinePopover: true }),
            traceDetailsOptions: createCanvasTraceDetailsOptions(traceDetailsClassName, previewTiles),
        })
    }

    function buildBranchMarkerTurnProjectionContent(
        marker: BranchMarkerNode,
        lineageProjectionScope: AiLineageProjectionScope,
    ): { threadId: string; content: ProseMirrorJsonNode } | null {
        const threadId = getBranchMarkerThreadId(marker)
        if (!threadId) return null

        const projection = buildBranchMarkerTurnProjectionFromThreadContent(
            getAiChatThreadContentForBranchMarker(threadId),
            getBranchMarkerTurnDescriptor(marker),
            {
                threadId,
                forceGenerationDetailsOpen: true,
                lineageProjectionScope,
                allowLatestTurnFallback: isBranchMarkerGenerationActive(marker) || Boolean(marker.pendingState),
            },
        )
        if (!projection) return null

        return {
            threadId: projection.threadId,
            content: projection.content,
        }
    }

    function mountBranchMarkerChatProjection({
        mount,
        marker,
        rendererClassName,
        traceDetailsClassName,
        previewTiles,
        lineageProjectionScope,
    }: {
        mount: HTMLElement
        marker: BranchMarkerNode
        rendererClassName: string
        traceDetailsClassName: string
        previewTiles: Set<ContextPreviewTileInstance>
        lineageProjectionScope: AiLineageProjectionScope
    }): ReadOnlyAiChatThreadRendererInstance | null {
        const projection = buildBranchMarkerTurnProjectionContent(marker, lineageProjectionScope)
        if (!projection) return null

        const projectionMount = html`<div className="canvas-generated-media-projection"></div>` as HTMLElement
        mount.appendChild(projectionMount)

        return mountReadOnlyAiChatThreadProjection({
            mount: projectionMount,
            content: projection.content,
            threadId: projection.threadId,
            className: rendererClassName,
            contextPreview: getAiUserMessageContextPreviewRenderer({ inlinePopover: true }),
            traceDetailsOptions: createCanvasTraceDetailsOptions(traceDetailsClassName, previewTiles),
        })
    }

    // The node's compact descriptor (summary + tags) — shown for all media,
    // including uploads with no generation metadata. Failed analysis still gets
    // a visible row so the info panel never collapses into an empty surface.
    function buildMediaDescriptorSection(
        descriptor: MediaDescriptor | undefined,
        options: { includeSummary?: boolean } = {},
    ): HTMLElement | null {
        if (!descriptor) return null
        if (descriptor.source !== 'analysis') return null
        if (descriptor.status === 'analyzing') {
            const spinnerStyle = { animationDelay: `${-(performance.now() % BRANCH_MARKER_SPINNER_PERIOD_MS)}ms` }
            return html`
                <div className="canvas-media-descriptor is-analyzing">
                    <div className="canvas-media-descriptor-loading">
                        <span className="workspace-branch-marker-spinner canvas-media-descriptor-spinner" style=${spinnerStyle} aria-hidden="true"></span>
                        <span className="canvas-media-descriptor-label">Analyzing media…</span>
                    </div>
                    <p className="canvas-media-descriptor-summary">Generating a short description of this media. It runs once and is reused later.</p>
                </div>
            ` as HTMLElement
        }
        if (descriptor.status === 'failed' || !descriptor.summary) {
            return html`
                <div className="canvas-media-descriptor is-failed">
                    <span className="canvas-media-descriptor-label">Description unavailable</span>
                    <p className="canvas-media-descriptor-summary">Media analysis did not return a usable description.</p>
                </div>
            ` as HTMLElement
        }

        const section = html`
            <div className="canvas-media-descriptor">
                ${options.includeSummary === false ? '' : html`
                    <span className="canvas-media-descriptor-label">Description</span>
                    <p className="canvas-media-descriptor-summary">${descriptor.summary}</p>
                `}
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

    function getAssetDescriptor(node: ImageCanvasNode | VideoCanvasNode): MediaDescriptor | undefined {
        return assetsStore.get(node.assetId)?.descriptor as MediaDescriptor | undefined
    }

    function buildAssetMetadataEditorDocument(
        asset: Asset,
        mode: 'node' | 'details',
    ): ProseMirrorJsonNode {
        const title = asset.title.trim()
        const description = asset.descriptor?.summary?.trim() ?? ''
        return {
            type: 'doc',
            content: [
                {
                    type: 'documentTitle',
                    ...(title ? { content: [{ type: 'text', text: title }] } : {}),
                },
                ...(mode === 'details' ? [{
                    type: 'paragraph',
                    ...(description ? { content: [{ type: 'text', text: description }] } : {}),
                }] : []),
            ],
        }
    }

    function readAssetMetadataEditorDocument(value: ProseMirrorJsonNode): { title: string; description?: string } {
        const titleNode = value.content?.find((node) => node.type === 'documentTitle')
        const descriptionNode = value.content?.find((node) => node.type === 'paragraph')
        return {
            title: collectProseMirrorText(titleNode).trim(),
            ...(descriptionNode ? { description: collectProseMirrorText(descriptionNode).trim() } : {}),
        }
    }

    function mountAssetMetadataEditor(
        node: ImageCanvasNode | VideoCanvasNode,
        mount: HTMLElement,
        mode: 'node' | 'details',
    ): void {
        const asset = assetsStore.get(node.assetId)
        if (!asset) return
        let draft = buildAssetMetadataEditorDocument(asset, mode)
        const editorKey = `${node.nodeId}:metadata:${mode}`
        const commit = async (): Promise<void> => {
            const current = assetsStore.get(node.assetId)
            if (!current) return
            const metadata = readAssetMetadataEditorDocument(draft)
            if (!metadata.title) return
            const currentDescription = current.descriptor?.summary ?? ''
            const descriptionChanged = metadata.description !== undefined
                && metadata.description !== currentDescription
            if (metadata.title === current.title && !descriptionChanged) return
            const descriptor = current.descriptor && metadata.description !== undefined
                ? { ...current.descriptor, summary: metadata.description, updatedAt: Date.now() }
                : undefined
            const updated = await assetService.updateMetadata(current.assetId, current.revision, {
                title: metadata.title,
                ...(descriptor ? { descriptor } : {}),
            })
            if ('error' in updated) return
            assetsStore.upsert(updated)
            resetGeneratedMediaChromeSyncKey()
            scheduleGeneratedMediaChromeSync()
        }
        const editor = new ProseMirrorEditor({
            editorMountElement: mount,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: draft,
            isDisabled: false,
            documentType: mode === 'node' ? 'assetTitle' : 'assetMetadata',
            onEditorChange: (value: ProseMirrorJsonNode) => { draft = value },
            onStreamingUpdate: () => {},
            onAiChatSubmit: () => {},
            onAiChatStop: () => {},
        })
        mount.addEventListener('focusout', (event: FocusEvent) => {
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof Node && mount.contains(nextTarget)) return
            void commit()
        })
        generatedMediaAssetEditors.set(editorKey, editor)
    }

    function createAssetDetailsSection(node: ImageCanvasNode | VideoCanvasNode): HTMLElement | null {
        const asset = assetsStore.get(node.assetId)
        if (!asset) return null
        const section = html`
            <section className="canvas-asset-details">
                <div className="canvas-asset-details-toolbar">
                    <span className="canvas-asset-details-heading">Asset details</span>
                    <div className="canvas-asset-scope-control">
                        <span className="canvas-asset-details-label">Scope</span>
                        <div className="canvas-asset-scope-dropdown"></div>
                    </div>
                </div>
                <div className="canvas-asset-storage-lineage">
                    <div className="canvas-asset-detail-row">
                        <span className="canvas-asset-diagnostics-label">Status</span>
                        <div className="canvas-asset-details-status"></div>
                    </div>
                    <div className="canvas-asset-detail-row">
                        <span className="canvas-asset-diagnostics-label">Renditions</span>
                        <div className="canvas-asset-renditions"></div>
                    </div>
                    <div className="canvas-asset-detail-row">
                        <span className="canvas-asset-diagnostics-label">Lineage</span>
                        <div className="canvas-asset-lineage"></div>
                    </div>
                </div>
            </section>
        ` as HTMLElement
        const statusEl = section.querySelector('.canvas-asset-details-status') as HTMLElement
        const renditionsEl = section.querySelector('.canvas-asset-renditions') as HTMLElement
        const lineageEl = section.querySelector('.canvas-asset-lineage') as HTMLElement
        statusEl.textContent = `${asset.states.lifecycle} · ${asset.states.media} · ${asset.states.provenance}`
        const renditionNames = Object.entries(asset.media?.renditions ?? {})
            .map(([name, rendition]) => `${name}: ${rendition?.status ?? 'missing'}`)
        renditionsEl.textContent = renditionNames.length > 0 ? renditionNames.join(' · ') : 'No media renditions'
        const lineageParts = [
            asset.lineage?.sourceConversationAssetId ? `conversation ${asset.lineage.sourceConversationAssetId}` : '',
            asset.lineage?.parentAssetId ? `parent ${asset.lineage.parentAssetId}` : '',
            ...(asset.lineage?.sourceAssetIds ?? []).map((assetId) => `source ${assetId}`),
        ].filter(Boolean)
        lineageEl.textContent = lineageParts.length > 0 ? lineageParts.join('\n') : 'No lineage'

        const scopeOptions: Array<{ title: string; scope: Asset['scope'] }> = [
            { title: 'Workspace', scope: 'workspace' },
            { title: 'Mine', scope: 'user' },
            { title: 'Organization', scope: 'organization' },
        ]
        const selectedScope = scopeOptions.find((option) => option.scope === asset.scope) ?? scopeOptions[0]!
        const scopeDropdown = createPureDropdown({
            id: `asset-scope-${node.nodeId}`,
            selectedValue: selectedScope,
            options: scopeOptions,
            theme: 'dark',
            ignoreColorValuesForOptions: true,
            ignoreColorValuesForSelectedValue: true,
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            mountToBody: false,
            disableAutoPositioning: true,
            onSelect: (option) => {
                void (async () => {
                    const current = assetsStore.get(asset.assetId)
                    if (!current) return
                    const scope = option.scope as Asset['scope']
                    const scopeOwnerId = scope === 'workspace'
                        ? workspaceId
                        : scope === 'user'
                            ? userStore.getData('userId')
                            : current.organizationId
                    const updated = await assetService.changeScope(current.assetId, current.revision, scope, scopeOwnerId)
                    if ('error' in updated) {
                        statusEl.textContent = `Scope update failed: ${updated.error}`
                        statusEl.classList.add('is-error')
                        return
                    }
                    assetsStore.upsert(updated)
                    resetGeneratedMediaChromeSyncKey()
                    scheduleGeneratedMediaChromeSync()
                })()
            },
        })
        const scopeMount = section.querySelector('.canvas-asset-scope-dropdown') as HTMLElement
        scopeMount.appendChild(scopeDropdown.dom)
        generatedMediaAssetDropdowns.set(node.nodeId, scopeDropdown)

        const contentSnapshot = assetDocumentsStore.get(asset.assetId, 'content')
        if (asset.documents.content && contentSnapshot) {
            const contentMount = html`<div className="canvas-asset-content-editor nopan"></div>` as HTMLElement
            section.appendChild(contentMount)
            const editor = new ProseMirrorEditor({
                editorMountElement: contentMount,
                content: html`<div></div>` as HTMLDivElement,
                initialVal: contentSnapshot.doc,
                isDisabled: false,
                documentType: 'assetContent',
                proseMirrorAuthority: {
                    organizationId: asset.organizationId,
                    workspaceId,
                    assetId: asset.assetId,
                    role: 'content',
                    baseVersion: contentSnapshot.version,
                    onLeaseStateChange: (state: { readOnly: boolean; holderWorkspaceId?: string; expiresAt?: number }) => {
                        contentMount.classList.toggle('is-read-only', state.readOnly)
                        contentMount.title = state.readOnly
                            ? `Read-only${state.holderWorkspaceId ? `; lease held by ${state.holderWorkspaceId}` : ''}`
                            : ''
                    },
                },
                onEditorChange: () => {},
                onStreamingUpdate: () => {},
                onAiChatSubmit: () => {},
                onAiChatStop: () => {},
            })
            generatedMediaAssetEditors.set(node.nodeId, editor)
        }

        return section
    }

    function appendGeneratedMediaMetadata(
        panel: HTMLElement,
        node: ImageCanvasNode | VideoCanvasNode,
    ): void {
        const metadataEditorMount = html`<div className="canvas-asset-metadata-editor is-details nopan"></div>` as HTMLElement
        panel.appendChild(metadataEditorMount)
        mountAssetMetadataEditor(node, metadataEditorMount, 'details')
        const descriptorSection = buildMediaDescriptorSection(getAssetDescriptor(node), { includeSummary: false })
        if (descriptorSection) panel.appendChild(descriptorSection)
        const assetDetails = createAssetDetailsSection(node)
        if (assetDetails) panel.appendChild(assetDetails)
    }

    // Metadata-only panel used exclusively by the media info button. Chat
    // history cannot be mounted through this construction path.
    function createGeneratedMediaMetadataPanel(node: ImageCanvasNode | VideoCanvasNode): HTMLElement {
        const panel = html`<div className="canvas-generated-media-info-panel canvas-generated-media-metadata-panel nopan"></div>` as HTMLElement
        appendGeneratedMediaMetadata(panel, node)
        return panel
    }

    function createGeneratedMediaHistoryPanel(
        node: ImageCanvasNode | VideoCanvasNode,
        options: GeneratedMediaHistoryPanelOptions = {},
    ): HTMLElement | null {
        if (!node.generatedBy) return null

        const panelClassName = ['canvas-generated-media-info-panel', 'canvas-generated-media-history-panel', options.className, 'nopan']
            .filter(Boolean)
            .join(' ')
        const panel = html`<div className=${panelClassName}></div>` as HTMLElement
        const rendererKey = options.rendererKey ?? `media-history:${node.nodeId}`
        destroyGeneratedMediaInfoRenderer(rendererKey)
        const renderer = mountGeneratedMediaChatProjection({
            mount: panel,
            node,
            rendererClassName: 'canvas-generated-media-projection-editor',
            traceDetailsClassName: 'canvas-generated-media-trace-details',
            previewTiles: generatedMediaInfoPreviewTiles,
            lineageProjectionScope: options.lineageProjectionScope ?? 'media-run',
            limitProjectionToSelectedMedia: options.limitProjectionToSelectedMedia ?? true,
            includeReasoningModelHeader: false,
        })
        if (!renderer) return null

        generatedMediaInfoRenderers.set(rendererKey, renderer)
        return panel
    }

    function hasPanelContent(panel: HTMLElement | null): panel is HTMLElement {
        return Boolean(panel && panel.hasChildNodes())
    }

    function createBranchMarkerInfoPanel(
        marker: BranchMarkerNode,
        options: GeneratedMediaHistoryPanelOptions = {},
    ): HTMLElement | null {
        const panelClassName = ['canvas-generated-media-info-panel', options.className, 'nopan'].filter(Boolean).join(' ')
        const panel = html`<div className=${panelClassName}></div>` as HTMLElement
        const rendererKey = options.rendererKey ?? `branch-marker:${marker.nodeId}`
        console.info('[CANVAS][generated-media-chrome]', 'branch-marker-renderer-mount-start', {
            rendererKey,
            nodeId: marker.nodeId,
            markerType: marker.type,
            threadId: getBranchMarkerThreadId(marker),
            lineageProjectionScope: options.lineageProjectionScope ?? 'media-run',
        })
        destroyGeneratedMediaInfoRenderer(rendererKey)

        const renderer = mountBranchMarkerChatProjection({
            mount: panel,
            marker,
            rendererClassName: 'canvas-generated-media-projection-editor',
            traceDetailsClassName: 'canvas-generated-media-trace-details',
            previewTiles: generatedMediaInfoPreviewTiles,
            lineageProjectionScope: options.lineageProjectionScope ?? 'media-run',
        })
        if (!renderer) {
            console.info('[CANVAS][generated-media-chrome]', 'branch-marker-renderer-missing', {
                rendererKey,
                nodeId: marker.nodeId,
                markerType: marker.type,
                threadId: getBranchMarkerThreadId(marker),
            })
            return null
        }

        generatedMediaInfoRenderers.set(rendererKey, renderer)
        console.info('[CANVAS][generated-media-chrome]', 'branch-marker-renderer-mounted', {
            rendererKey,
            nodeId: marker.nodeId,
            markerType: marker.type,
            threadId: getBranchMarkerThreadId(marker),
            rendererCount: generatedMediaInfoRenderers.size,
        })
        return panel
    }

    function toggleGeneratedMediaInfo(nodeId: string): void {
        const wasExpanded = expandedGeneratedMediaInfoNodeIds.has(nodeId)
        expandedGeneratedMediaHistoryNodeIds.delete(nodeId)
        if (wasExpanded) {
            expandedGeneratedMediaInfoNodeIds.delete(nodeId)
        } else {
            expandedGeneratedMediaInfoNodeIds.add(nodeId)
        }
        syncGeneratedMediaChrome(currentCanvasState)
    }

    function toggleGeneratedMediaHistory(nodeId: string): void {
        const wasExpanded = expandedGeneratedMediaHistoryNodeIds.has(nodeId)
        expandedGeneratedMediaInfoNodeIds.delete(nodeId)
        if (wasExpanded) {
            expandedGeneratedMediaHistoryNodeIds.delete(nodeId)
        } else {
            expandedGeneratedMediaHistoryNodeIds.add(nodeId)
        }
        syncGeneratedMediaChrome(currentCanvasState)
    }

    function hasOpenGeneratedMediaInfoPanels(): boolean {
        return expandedGeneratedMediaInfoNodeIds.size > 0
            || expandedGeneratedMediaHistoryNodeIds.size > 0
            || expandedBranchOriginInfoNodeIds.size > 0
            || expandedBranchForkInfoNodeIds.size > 0
            || expandedBranchLineInfoNodeIds.size > 0
    }

    function clearGeneratedMediaInfoPanels(options: { preserveBranchInfo?: boolean } = {}): void {
        if (!hasOpenGeneratedMediaInfoPanels()) return
        expandedGeneratedMediaInfoNodeIds.clear()
        expandedGeneratedMediaHistoryNodeIds.clear()
        if (!options.preserveBranchInfo) {
            expandedBranchOriginInfoNodeIds.clear()
            expandedBranchForkInfoNodeIds.clear()
            expandedBranchLineInfoNodeIds.clear()
        }
        syncGeneratedMediaChrome(currentCanvasState)
        if (activeAiChatPanelProjectionRenderer) {
            refreshActiveAiChatPanelProjectionTarget(activeAiChatPanelThreadId ?? undefined)
        }
    }

    function shouldClearGeneratedMediaInfoForCanvasClick(target: EventTarget | null): boolean {
        if (!hasOpenGeneratedMediaInfoPanels()) return false
        if (!(target instanceof Element)) return false
        if (!paneEl.contains(target)) return false
        if (target.closest('.canvas-generated-media-info-panel')) return false
        if (target.closest('.workspace-branch-origin-node, .workspace-branch-fork-node, .workspace-branch-line-node')) return false
        if (target.closest([
            '.workspace-ai-chat-floating-panel',
            '.workspace-canvas-global-composer-host',
            '.ai-prompt-input-floating',
            '.bubble-menu',
            '.workspace-video-controls-host',
        ].join(', '))) return false
        return true
    }

    function compareGeneratedMediaByGenerationOrder(
        a: ImageCanvasNode | VideoCanvasNode,
        b: ImageCanvasNode | VideoCanvasNode,
    ): number {
        const aVariant = a.generatedBy?.variantIndex ?? Number.MAX_SAFE_INTEGER
        const bVariant = b.generatedBy?.variantIndex ?? Number.MAX_SAFE_INTEGER
        if (aVariant !== bVariant) return aVariant - bVariant
        return (a.generatedBy?.createdAt ?? 0) - (b.generatedBy?.createdAt ?? 0)
    }

    function getBranchOriginGeneratedMediaNodes(branchOriginNodeId: string): Array<ImageCanvasNode | VideoCanvasNode> {
        return (currentCanvasState?.nodes ?? [])
            .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                (node.type === 'image' || node.type === 'video')
                && node.generatedBy?.branchOriginNodeId === branchOriginNodeId)
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    function getBranchForkGeneratedMediaNodes(branchForkNodeId: string): Array<ImageCanvasNode | VideoCanvasNode> {
        return (currentCanvasState?.nodes ?? [])
            .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                (node.type === 'image' || node.type === 'video')
                && node.generatedBy?.branchForkNodeId === branchForkNodeId)
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    function toggleBranchOriginGeneratedMediaInfo(branchOriginNodeId: string): void {
        if (expandedBranchOriginInfoNodeIds.has(branchOriginNodeId)) {
            expandedBranchOriginInfoNodeIds.delete(branchOriginNodeId)
        } else {
            expandedBranchOriginInfoNodeIds.add(branchOriginNodeId)
        }
        syncGeneratedMediaChrome(currentCanvasState)
        refreshActiveAiChatPanelProjectionTarget(getBranchMarkerAiChatThreadId(branchOriginNodeId))
    }

    function getBranchLineGeneratedMediaNodes(branchLineNodeId: string): Array<ImageCanvasNode | VideoCanvasNode> {
        return (currentCanvasState?.nodes ?? [])
            .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                (node.type === 'image' || node.type === 'video')
                && node.generatedBy?.branchLineNodeId === branchLineNodeId)
            .sort(compareGeneratedMediaByGenerationOrder)
    }

    function getOpenBranchProjectionTarget(threadId: string): GeneratedMediaProjectionTarget | null {
        for (const branchOriginNodeId of expandedBranchOriginInfoNodeIds) {
            const node = getBranchOriginGeneratedMediaNodes(branchOriginNodeId)[0]
            if (node?.generatedBy?.conversationAssetId === threadId) {
                return { node, lineageProjectionScope: 'branch-origin', limitProjectionToSelectedMedia: false }
            }
        }

        for (const branchForkNodeId of expandedBranchForkInfoNodeIds) {
            const node = getBranchForkGeneratedMediaNodes(branchForkNodeId)[0]
            if (node?.generatedBy?.conversationAssetId === threadId) {
                return { node, lineageProjectionScope: 'branch-fork', limitProjectionToSelectedMedia: false }
            }
        }

        for (const branchLineNodeId of expandedBranchLineInfoNodeIds) {
            const node = getBranchLineGeneratedMediaNodes(branchLineNodeId)[0]
            if (node?.generatedBy?.conversationAssetId === threadId) {
                return { node, lineageProjectionScope: 'media-run', limitProjectionToSelectedMedia: true }
            }
        }

        return null
    }

    function getOpenBranchMarkerProjectionTarget(threadId: string): BranchMarkerProjectionTarget | null {
        const nodesById = getCanvasNodesById(currentCanvasState?.nodes ?? [])

        for (const branchOriginNodeId of expandedBranchOriginInfoNodeIds) {
            const marker = nodesById.get(branchOriginNodeId)
            if (marker && isBranchMarkerNode(marker) && marker.conversationAssetId === threadId) {
                return { marker, lineageProjectionScope: 'branch-origin' }
            }
        }

        for (const branchForkNodeId of expandedBranchForkInfoNodeIds) {
            const marker = nodesById.get(branchForkNodeId)
            if (marker && isBranchMarkerNode(marker) && marker.conversationAssetId === threadId) {
                return { marker, lineageProjectionScope: 'branch-fork' }
            }
        }

        for (const branchLineNodeId of expandedBranchLineInfoNodeIds) {
            const marker = nodesById.get(branchLineNodeId)
            if (marker && isBranchMarkerNode(marker) && marker.conversationAssetId === threadId) {
                return { marker, lineageProjectionScope: 'media-run' }
            }
        }

        return null
    }

    function getSelectedGeneratedMediaProjectionTarget(threadId: string): GeneratedMediaProjectionTarget | null {
        const nodesById = getCanvasNodesById(currentCanvasState?.nodes ?? [])
        for (const nodeId of selectedNodeIds) {
            const node = nodesById.get(nodeId)
            if (!node || (node.type !== 'image' && node.type !== 'video')) continue
            if (node.generatedBy?.conversationAssetId !== threadId) continue
            return { node, lineageProjectionScope: 'media-run', limitProjectionToSelectedMedia: true }
        }
        return null
    }

    function getDefaultGeneratedMediaProjectionTarget(threadId: string): GeneratedMediaProjectionTarget | null {
        const node = (currentCanvasState?.nodes ?? [])
            .filter((candidate: CanvasNode): candidate is ImageCanvasNode | VideoCanvasNode =>
                (candidate.type === 'image' || candidate.type === 'video')
                && candidate.generatedBy?.conversationAssetId === threadId)
            .sort(compareGeneratedMediaByGenerationOrder)
            .at(-1)
        return node
            ? { node, lineageProjectionScope: 'media-run', limitProjectionToSelectedMedia: true }
            : null
    }

    function getActiveAiChatPanelProjectionTarget(threadId: string): GeneratedMediaProjectionTarget | null {
        if (promptInputController.isReceiving(threadId)) return null
        return getOpenBranchProjectionTarget(threadId)
            ?? getSelectedGeneratedMediaProjectionTarget(threadId)
            ?? getDefaultGeneratedMediaProjectionTarget(threadId)
    }

    function getBranchMarkerAiChatThreadId(nodeId: string): string | undefined {
        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node) return undefined
        if (node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine') return undefined
        return node.conversationAssetId
    }

    function refreshActiveAiChatPanelProjectionTarget(threadId?: string): void {
        if (!threadId || activeAiChatPanelThreadId !== threadId || !activeAiChatPanelEl) return
        renderActiveAiChatPanel(undefined, { preserveTabsSwitch: true, animateOpen: false })
    }

    function toggleBranchForkGeneratedMediaInfo(branchForkNodeId: string): void {
        if (expandedBranchForkInfoNodeIds.has(branchForkNodeId)) {
            expandedBranchForkInfoNodeIds.delete(branchForkNodeId)
        } else {
            expandedBranchForkInfoNodeIds.add(branchForkNodeId)
        }
        syncGeneratedMediaChrome(currentCanvasState)
        refreshActiveAiChatPanelProjectionTarget(getBranchMarkerAiChatThreadId(branchForkNodeId))
    }

    function toggleBranchLineGeneratedMediaInfo(branchLineNodeId: string): void {
        if (expandedBranchLineInfoNodeIds.has(branchLineNodeId)) {
            expandedBranchLineInfoNodeIds.delete(branchLineNodeId)
        } else {
            expandedBranchLineInfoNodeIds.add(branchLineNodeId)
        }
        syncGeneratedMediaChrome(currentCanvasState)
        refreshActiveAiChatPanelProjectionTarget(getBranchMarkerAiChatThreadId(branchLineNodeId))
    }

    function createBranchOriginInfoPanel(branchOriginNode: BranchOriginCanvasNode): HTMLElement | null {
        const generatedMediaNode = getBranchOriginGeneratedMediaNodes(branchOriginNode.nodeId)[0]
        const panelOptions: GeneratedMediaHistoryPanelOptions = {
            className: 'canvas-branch-origin-info-panel',
            rendererKey: `branch-origin:${branchOriginNode.nodeId}`,
            limitProjectionToSelectedMedia: false,
            lineageProjectionScope: 'branch-origin',
        }
        const generatedMediaPanel = generatedMediaNode
            ? createGeneratedMediaHistoryPanel(generatedMediaNode, panelOptions)
            : null
        if (hasPanelContent(generatedMediaPanel)) return generatedMediaPanel
        return createBranchMarkerInfoPanel(branchOriginNode, panelOptions)
    }

    function createBranchOriginInfoChrome(branchOriginNode: BranchOriginCanvasNode): HTMLElement | null {
        if (!expandedBranchOriginInfoNodeIds.has(branchOriginNode.nodeId)) return null

        const panel = createBranchOriginInfoPanel(branchOriginNode)
        if (!panel) return null

        const chromeEl = html`
            <div className="workspace-branch-origin-info-chrome" data=${{ branchOriginChromeNodeId: branchOriginNode.nodeId }}>
                ${panel}
            </div>
        ` as HTMLElement
        applyBranchOriginInfoChromeGeometry(
            chromeEl,
            branchOriginNode.nodeId,
            getNodeWorldPosition(branchOriginNode),
            branchOriginNode.dimensions,
            getBranchOriginInfoPanelWidth(branchOriginNode.nodeId),
        )
        return chromeEl
    }

    function createBranchForkInfoPanel(branchForkNode: BranchForkCanvasNode): HTMLElement | null {
        const generatedMediaNode = getBranchForkGeneratedMediaNodes(branchForkNode.nodeId)[0]
        const panelOptions: GeneratedMediaHistoryPanelOptions = {
            className: 'canvas-branch-fork-info-panel',
            rendererKey: `branch-fork:${branchForkNode.nodeId}`,
            limitProjectionToSelectedMedia: false,
            lineageProjectionScope: 'branch-fork',
        }
        const generatedMediaPanel = generatedMediaNode
            ? createGeneratedMediaHistoryPanel(generatedMediaNode, panelOptions)
            : null
        if (hasPanelContent(generatedMediaPanel)) return generatedMediaPanel
        return createBranchMarkerInfoPanel(branchForkNode, panelOptions)
    }

    function createBranchForkInfoChrome(branchForkNode: BranchForkCanvasNode): HTMLElement | null {
        if (!expandedBranchForkInfoNodeIds.has(branchForkNode.nodeId)) return null

        const panel = createBranchForkInfoPanel(branchForkNode)
        if (!panel) return null

        const chromeEl = html`
            <div className="workspace-branch-fork-info-chrome" data=${{ branchForkChromeNodeId: branchForkNode.nodeId }}>
                ${panel}
            </div>
        ` as HTMLElement
        applyBranchOriginInfoChromeGeometry(
            chromeEl,
            branchForkNode.nodeId,
            getNodeWorldPosition(branchForkNode),
            branchForkNode.dimensions,
            getBranchForkInfoPanelWidth(branchForkNode.nodeId),
        )
        return chromeEl
    }

    function createBranchLineInfoPanel(branchLineNode: BranchLineCanvasNode): HTMLElement | null {
        const generatedMediaNode = getBranchLineGeneratedMediaNodes(branchLineNode.nodeId)[0]
        const panelOptions: GeneratedMediaHistoryPanelOptions = {
            className: 'canvas-branch-line-info-panel',
            rendererKey: `branch-line:${branchLineNode.nodeId}`,
            limitProjectionToSelectedMedia: true,
            lineageProjectionScope: 'media-run',
        }
        const generatedMediaPanel = generatedMediaNode
            ? createGeneratedMediaHistoryPanel(generatedMediaNode, panelOptions)
            : null
        if (hasPanelContent(generatedMediaPanel)) return generatedMediaPanel
        return createBranchMarkerInfoPanel(branchLineNode, panelOptions)
    }

    function createBranchLineInfoChrome(branchLineNode: BranchLineCanvasNode): HTMLElement | null {
        if (!expandedBranchLineInfoNodeIds.has(branchLineNode.nodeId)) return null

        const panel = createBranchLineInfoPanel(branchLineNode)
        if (!panel) return null

        const chromeEl = html`
            <div className="workspace-branch-line-info-chrome" data=${{ branchLineChromeNodeId: branchLineNode.nodeId }}>
                ${panel}
            </div>
        ` as HTMLElement
        applyBranchOriginInfoChromeGeometry(
            chromeEl,
            branchLineNode.nodeId,
            getNodeWorldPosition(branchLineNode),
            branchLineNode.dimensions,
            getBranchLineInfoPanelWidth(branchLineNode.nodeId),
        )
        return chromeEl
    }

    // Shared info (i) button used by both image and video chrome. Pulses while
    // the media descriptor is still being analyzed and explains itself on hover.
    function createMediaInfoButton(node: ImageCanvasNode | VideoCanvasNode): HTMLButtonElement {
        const analyzing = getAssetDescriptor(node)?.status === 'analyzing'
        const isExpanded = expandedGeneratedMediaInfoNodeIds.has(node.nodeId)
        const title = analyzing ? 'Analyzing media — generating a description…' : 'Media details'
        const button = html`
            <button
                className=${`media-info-button nopan${isExpanded ? ' is-active' : ''}${analyzing ? ' is-analyzing' : ''}`}
                type="button"
                aria-label=${title}
                aria-expanded=${String(isExpanded)}
                title=${title}
            >
                <span innerHTML=${infoLetterIcon}></span>
            </button>
        ` as HTMLButtonElement
        button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toggleGeneratedMediaInfo(node.nodeId)
        })
        return button
    }

    function getGeneratedMediaUserMessage(node: ImageCanvasNode | VideoCanvasNode): string {
        const generatedBy = node.generatedBy
        if (!generatedBy) return ''

        const locator = getGeneratedMediaProjectionLocator(node)
        const projection = locator
            ? buildGeneratedMediaTurnProjectionFromThreadContent(
                getGeneratedMediaHistoryContent(node),
                locator,
                {
                    threadId: generatedBy.conversationAssetId,
                    limitToLocatorMedia: true,
                    lineageProjectionScope: 'media-run',
                },
            )
            : null
        const root = parseProseMirrorJsonContent(projection?.content)
        const thread = root ? findAiChatThreadContentNode(root, generatedBy.conversationAssetId) : null
        const userMessage = thread?.content?.find((child) => child.type === 'aiUserMessage')
        return collectProseMirrorText(userMessage).trim() || generatedBy.promptText?.trim() || ''
    }

    function getGeneratedMediaUserMessagePreview(message: string): string {
        const normalized = message.replace(/\s+/g, ' ').trim()
        if (normalized.length <= 20) return normalized
        return `${normalized.slice(0, 17).trimEnd()}...`
    }

    function isGeneratedOutputAccepted(node: ImageCanvasNode | VideoCanvasNode): boolean {
        return assetsStore.get(node.assetId)?.generatedOutputReview?.status === 'accepted'
    }

    async function acceptGeneratedOutput(scope: 'media-node' | 'branch-lineage', nodeId: string): Promise<void> {
        const result = await assetService.reviewGeneratedOutput({
            workspaceId,
            scope,
            action: 'accept',
            nodeId,
        })
        if ('error' in result) {
            console.error('[CANVAS][generated-output-review] Unable to accept generated output:', result.error)
            return
        }
        applyApiCanvasGeometry(result.canvasGeometry)
        scheduleGeneratedMediaChromeSync()
        syncBranchMarkerNodeContents()
    }

    type GeneratedMediaReplayDescriptor = {
        node: ImageCanvasNode | VideoCanvasNode
        reasoningModelId: AiModelId
        mediaModelId: AiModelId
        mediaType: 'image' | 'video'
        finalPrompt: string
        imageSize?: string
        videoAspectRatio?: string
        videoResolution?: string
        videoDuration?: string
    }

    function getGeneratedMediaTrace(
        node: ImageCanvasNode | VideoCanvasNode,
    ): ImageGenerationTrace | VideoGenerationTrace | null {
        const generatedBy = node.generatedBy
        if (!generatedBy) return null
        const content = getGeneratedMediaHistoryContent(node)
        const usesSealedProvenance = Boolean(assetDocumentsStore.get(node.assetId, 'provenance')?.doc)
        const traces: Array<ImageGenerationTrace | VideoGenerationTrace> = []
        const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const record = value as Record<string, unknown>
            const attrs = record.attrs
            if (attrs && typeof attrs === 'object') {
                const attrRecord = attrs as Record<string, unknown>
                const imageTrace = attrRecord.imageGenerationTrace
                const videoTrace = attrRecord.videoGenerationTrace
                if (imageTrace && typeof imageTrace === 'object') traces.push(imageTrace as ImageGenerationTrace)
                if (videoTrace && typeof videoTrace === 'object') traces.push(videoTrace as VideoGenerationTrace)
            }
            if (Array.isArray(record.content)) record.content.forEach(visit)
        }
        visit(content)
        const matchesRun = (trace: ImageGenerationTrace | VideoGenerationTrace): boolean => {
            const run = trace.generationRun
            if (generatedBy.mediaRunId && run?.mediaRunId === generatedBy.mediaRunId) return true
            return Boolean(
                generatedBy.reasoningRunId
                && run?.reasoningRunId === generatedBy.reasoningRunId
                && generatedBy.mediaModelId
                && run?.mediaModelId === generatedBy.mediaModelId
            )
        }
        return traces.find(matchesRun)
            ?? (usesSealedProvenance && traces.length === 1 ? traces[0]! : null)
    }

    function getGeneratedMediaReplayDescriptor(
        node: ImageCanvasNode | VideoCanvasNode,
    ): GeneratedMediaReplayDescriptor | null {
        const trace = getGeneratedMediaTrace(node)
        const reasoningModelId = node.generatedBy?.reasoningModelId
        const mediaModelId = node.generatedBy?.mediaModelId ?? getGeneratedMediaModelId(node)
        if (!trace?.finalPrompt || !reasoningModelId || !mediaModelId) return null
        if (trace.traceVersion === 'image-generation-trace-v1') {
            return {
                node,
                reasoningModelId,
                mediaModelId: mediaModelId as AiModelId,
                mediaType: 'image',
                finalPrompt: trace.finalPrompt,
                imageSize: trace.imageSize,
            }
        }
        return {
            node,
            reasoningModelId,
            mediaModelId: mediaModelId as AiModelId,
            mediaType: 'video',
            finalPrompt: trace.finalPrompt,
            videoAspectRatio: trace.aspectRatio,
            videoResolution: trace.resolution,
            videoDuration: String(trace.durationSeconds),
        }
    }

    function buildRegenerationSubmitData(
        descriptors: GeneratedMediaReplayDescriptor[],
        promptText: string,
    ): AiPromptComposerSubmitData {
        const reasoningModels = uniqueAiModelIds(descriptors.map(descriptor => descriptor.reasoningModelId))
        const imageDescriptors = descriptors.filter(descriptor => descriptor.mediaType === 'image')
        const videoDescriptors = descriptors.filter(descriptor => descriptor.mediaType === 'video')
        const imageModels = uniqueAiModelIds(imageDescriptors.map(descriptor => descriptor.mediaModelId))
        const videoModels = uniqueAiModelIds(videoDescriptors.map(descriptor => descriptor.mediaModelId))
        const firstImage = imageDescriptors[0]
        const firstVideo = videoDescriptors[0]
        return {
            contentJSON: [{ type: 'paragraph', content: [{ type: 'text', text: promptText }] }],
            aiReasoningModels: reasoningModels,
            useMultipleReasoningModels: reasoningModels.length > 1,
            useMultipleImageModels: imageModels.length > 1,
            useMultipleVideoModels: videoModels.length > 1,
            ...(imageModels.length > 0 ? {
                imageOptions: {
                    aiImageModels: imageModels,
                    imageGenerationSize: firstImage?.imageSize ?? 'auto',
                    configGroups: imageModels.map((modelId, index) => {
                        const descriptor = imageDescriptors.find(candidate => candidate.mediaModelId === modelId)
                        return {
                            groupId: `regeneration-image-${index}`,
                            modelIds: [modelId],
                            values: { imageSize: descriptor?.imageSize ?? 'auto' },
                        }
                    }),
                },
            } : {}),
            ...(videoModels.length > 0 ? {
                videoOptions: {
                    aiVideoModels: videoModels,
                    ...(firstVideo?.videoAspectRatio ? { videoAspectRatio: firstVideo.videoAspectRatio } : {}),
                    ...(firstVideo?.videoResolution ? { videoResolution: firstVideo.videoResolution } : {}),
                    ...(firstVideo?.videoDuration ? { videoDuration: firstVideo.videoDuration } : {}),
                    configGroups: videoModels.map((modelId, index) => {
                        const descriptor = videoDescriptors.find(candidate => candidate.mediaModelId === modelId)
                        return {
                            groupId: `regeneration-video-${index}`,
                            modelIds: [modelId],
                            values: {
                                ...(descriptor?.videoAspectRatio ? { aspectRatio: descriptor.videoAspectRatio } : {}),
                                ...(descriptor?.videoResolution ? { resolution: descriptor.videoResolution } : {}),
                                ...(descriptor?.videoDuration ? { duration: descriptor.videoDuration } : {}),
                            },
                        }
                    }),
                },
            } : {}),
        }
    }

    async function regenerateGeneratedOutputs(request: GeneratedOutputRegenerationRequest): Promise<void> {
        const { scope, targetNodeId, mediaNodes } = request
        const regeneratePrompt = request.mode === 'regenerate-prompt'
        await Promise.all(mediaNodes.map(async (node) => {
            if (assetDocumentsStore.get(node.assetId, 'provenance')?.doc) return
            const result = await assetService.refresh(node.assetId)
            if ('error' in result) {
                console.error('[CANVAS][generated-output-review] Unable to load sealed provenance:', {
                    assetId: node.assetId,
                    error: result.error,
                })
            }
        }))
        const descriptors = mediaNodes
            .map(getGeneratedMediaReplayDescriptor)
            .filter((descriptor): descriptor is GeneratedMediaReplayDescriptor => Boolean(descriptor))
        if (descriptors.length !== mediaNodes.length) {
            console.error('[CANVAS][generated-output-review] Generation history is not ready for regeneration.', {
                targetNodeId,
                mediaNodeIds: mediaNodes.map(node => node.nodeId),
                descriptorCount: descriptors.length,
            })
            return
        }
        const promptText = getGeneratedMediaUserMessage(mediaNodes[0]!)
        if (!promptText) return
        const lineageParentNodeId = scope === 'branch-lineage'
            ? targetNodeId
            : mediaNodes[0]?.generatedBy?.lineageParentNodeId
                ?? mediaNodes[0]?.generatedBy?.branchLineNodeId
                ?? mediaNodes[0]?.generatedBy?.branchForkNodeId
                ?? mediaNodes[0]?.generatedBy?.branchOriginNodeId
        const branchId = mediaNodes[0]?.generatedBy?.branchId
        const lineageParentNode = lineageParentNodeId ? findCanvasNodeById(lineageParentNodeId) : undefined
        const lineageParentType = lineageParentNode
            && ['branchOrigin', 'branchFork', 'branchLine'].includes(lineageParentNode.type)
            ? lineageParentNode.type as 'branchOrigin' | 'branchFork' | 'branchLine'
            : undefined
        if (!regeneratePrompt && (!lineageParentNodeId || !lineageParentType || !branchId)) {
            console.error('[CANVAS][generated-output-review] Branch lineage is unavailable.', {
                targetNodeId,
                lineageParentNodeId,
                lineageParentType,
                branchId,
            })
            return
        }
        const explicitContextNodeIds = [...new Set(mediaNodes.flatMap(node => [
            ...(node.generatedBy?.referenceImageNodeIds ?? []),
            ...(node.generatedBy?.sourceContextNodeIds ?? []),
        ]))]
        const excludedCanvasNodeIds = [
            ...mediaNodes.map(node => node.nodeId),
            ...(regeneratePrompt ? [targetNodeId] : []),
        ]
        const result = request.scope === 'media-node'
            ? await assetService.reviewGeneratedOutput({
                workspaceId,
                scope: 'media-node',
                action: 'supersede',
                nodeId: targetNodeId,
                preserveLineage: true,
            })
            : await assetService.reviewGeneratedOutput({
                workspaceId,
                scope: 'branch-lineage',
                action: 'supersede',
                nodeId: targetNodeId,
                preserveLineage: request.mode === 'existing-prompt',
            })
        if ('error' in result) {
            console.error('[CANVAS][generated-output-review] Unable to supersede generated output:', result.error)
            return
        }
        applyApiCanvasGeometry(result.canvasGeometry)
        scheduleGeneratedMediaChromeSync()
        syncBranchMarkerNodeContents()
        const submitData = buildRegenerationSubmitData(descriptors, promptText)
        await submitCanvasGenerationRun(submitData, {
            explicitContextNodeIds,
            excludedCanvasNodeIds,
            ...(regeneratePrompt ? {
                regeneration: {
                    mode: 'regenerate-prompt',
                    forceFreshLineage: true,
                } as const,
            } : lineageParentNodeId && lineageParentType && branchId ? {
                regeneration: {
                    mode: 'existing-prompt',
                    branchId,
                    lineageParentNodeId,
                    lineageParentType,
                    replayPrompts: descriptors.map(descriptor => ({
                        sourceAssetId: descriptor.node.assetId,
                        reasoningModelId: descriptor.reasoningModelId,
                        mediaModelId: descriptor.mediaModelId,
                        mediaType: descriptor.mediaType,
                        finalPrompt: descriptor.finalPrompt,
                    })),
                },
            } : {}),
        })
    }

    function createMediaAcceptButton(node: ImageCanvasNode | VideoCanvasNode): HTMLButtonElement | null {
        if (isGeneratedOutputAccepted(node)) return null
        const asset = assetsStore.get(node.assetId)
        if (!asset || asset.generatedOutputReview?.status === 'superseded') return null
        const disabled = asset.media?.renditions.original?.status !== 'ready'
            || asset.states.provenance !== 'sealed'
        const handleClick = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            void acceptGeneratedOutput('media-node', node.nodeId)
        }
        const button = html`
            <button
                className="media-review-action media-review-accept nopan"
                type="button"
                aria-label="Accept generated output"
                title=${disabled ? 'Generation history is still being sealed' : 'Accept generated output'}
                onclick=${handleClick}
            >
                <span className="media-review-action-icon" innerHTML=${checkMarkIcon} aria-hidden="true"></span>
            </button>
        ` as HTMLButtonElement
        button.disabled = disabled
        return button
    }

    function createMediaRegenerationControls(node: ImageCanvasNode | VideoCanvasNode): HTMLDivElement | null {
        const asset = assetsStore.get(node.assetId)
        if (!asset || isGeneratedOutputAccepted(node) || asset.generatedOutputReview?.status === 'superseded') return null
        const disabled = asset.media?.renditions.original?.status !== 'ready'
            || asset.states.provenance !== 'sealed'
        const regenerate = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            void regenerateGeneratedOutputs({
                scope: 'media-node',
                mode: 'existing-prompt',
                targetNodeId: node.nodeId,
                mediaNodes: [node],
            })
        }
        const controls = html`
            <div className="media-regeneration-controls nopan">
                <button
                    className="media-review-action media-review-regenerate"
                    type="button"
                    title="Generate another result with the existing media prompt"
                    aria-label="Regenerate with existing media prompt"
                    onclick=${regenerate}
                >
                    <span className="media-review-action-icon" innerHTML=${refreshIcon} aria-hidden="true"></span>
                </button>
            </div>
        ` as HTMLDivElement
        for (const button of controls.querySelectorAll('button')) button.disabled = disabled
        return controls
    }

    function createMediaHistoryButton(node: ImageCanvasNode | VideoCanvasNode): HTMLButtonElement | null {
        if (!isGeneratedOutputAccepted(node)) return null
        const message = getGeneratedMediaUserMessage(node)
        if (!message) return null

        const isExpanded = expandedGeneratedMediaHistoryNodeIds.has(node.nodeId)
        const preview = getGeneratedMediaUserMessagePreview(message)
        const reasoningModelEntry = getBranchMarkerModelEntry(String(node.generatedBy?.reasoningModelId ?? ''))
        const reasoningModelIcon = reasoningModelEntry ? reasoningModelEntry.icon ?? atomIcon : null
        const reasoningModelLabel = reasoningModelEntry?.title ? ` Reasoning model: ${reasoningModelEntry.title}.` : ''
        const button = html`
            <button
                className=${`media-history-button nopan${isExpanded ? ' is-active' : ''}`}
                type="button"
                aria-label=${`Open generation history for: ${message}.${reasoningModelLabel}`}
                aria-expanded=${String(isExpanded)}
                title=${message}
            >
                ${reasoningModelIcon ? html`
                    <span
                        className="workspace-branch-marker-message-icon media-history-reasoning-icon"
                        innerHTML=${reasoningModelIcon}
                        aria-hidden="true"
                    ></span>
                ` : null}
                <span className="media-history-button-text">${preview}</span>
            </button>
        ` as HTMLButtonElement
        button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toggleGeneratedMediaHistory(node.nodeId)
        })
        return button
    }

    function splitAiModelId(modelId: string): { provider: string; model: string } {
        const separatorIndex = modelId.indexOf(':')
        if (separatorIndex < 0) return { provider: '', model: modelId }
        return {
            provider: modelId.slice(0, separatorIndex),
            model: modelId.slice(separatorIndex + 1),
        }
    }

    function buildAiModelId(provider: string, model: string): string {
        if (!model) return ''
        return model.includes(':') || !provider ? model : `${provider}:${model}`
    }

    function getGeneratedMediaModelId(node: ImageCanvasNode | VideoCanvasNode): string {
        const generatedBy = node.generatedBy
        if (!generatedBy) return ''
        if (generatedBy.mediaModelId) return String(generatedBy.mediaModelId)
        if (node.type === 'video') return String((generatedBy as VideoCanvasNode['generatedBy'])?.videoModel ?? '')
        return String((generatedBy as ImageCanvasNode['generatedBy'])?.aiModel ?? '')
    }

    function getGeneratedMediaModelProvider(node: ImageCanvasNode | VideoCanvasNode, modelId: string): string {
        const generatedBy = node.generatedBy
        const persistedProvider = node.type === 'video'
            ? (generatedBy as VideoCanvasNode['generatedBy'])?.videoModelProvider
            : (generatedBy as ImageCanvasNode['generatedBy'])?.imageModelProvider
        if (persistedProvider) return persistedProvider
        return splitAiModelId(modelId).provider
    }

    // Info, model, and user-message history controls share one screen-space strip
    // projected from media bounds with bounded zoom compensation. Their panels
    // render separately in the viewport-transformed panel layer.
    function createGeneratedMediaChrome(node: ImageCanvasNode | VideoCanvasNode): HTMLElement {
        const modelId = getGeneratedMediaModelId(node)
        const modelProvider = getGeneratedMediaModelProvider(node, modelId)
        const modelBadge = createMediaModelBadge({ modelId, modelProvider })
        const acceptButton = createMediaAcceptButton(node)
        const regenerationControls = createMediaRegenerationControls(node)
        const chromeEl = html`
            <div className="workspace-generated-media-chrome" data=${{ mediaChromeNodeId: node.nodeId }}>
                <div className="workspace-generated-media-title canvas-asset-metadata-editor is-node nopan"></div>
                <div className="workspace-generated-media-actions">
                    ${createMediaInfoButton(node)}
                    ${modelBadge ? html`<div className="media-info-model-separator media-review-action-separator" aria-hidden="true"></div>` : null}
                    ${modelBadge}
                    ${acceptButton}
                    ${acceptButton && regenerationControls ? html`<div className="media-info-model-separator media-review-action-separator" aria-hidden="true"></div>` : null}
                    ${regenerationControls}
                    ${createMediaHistoryButton(node)}
                </div>
            </div>
        ` as HTMLElement
        const metadataEditorMount = chromeEl.querySelector('.workspace-generated-media-title') as HTMLElement
        mountAssetMetadataEditor(node, metadataEditorMount, 'node')

        const viewport = getLiveViewport()
        applyGeneratedMediaChromeGeometry(
            chromeEl,
            getNodeWorldPosition(node),
            node.dimensions,
            viewport,
            getVideoControlsOutsideOffsetScreen(node.nodeId, viewport),
        )
        return chromeEl
    }

    function createPendingGeneratedMediaIconChrome(node: ImageCanvasNode | VideoCanvasNode): HTMLElement | null {
        const modelId = getGeneratedMediaModelId(node)
        const modelProvider = getGeneratedMediaModelProvider(node, modelId)
        const modelBadge = createMediaModelBadge({ modelId, modelProvider, iconOnly: true })
        if (!modelBadge) return null

        const chromeEl = html`
            <div className="workspace-generated-media-pending-icon" data=${{ pendingMediaIconNodeId: node.nodeId }}>
                ${modelBadge}
            </div>
        ` as HTMLElement

        applyPendingGeneratedMediaIconGeometry(
            chromeEl,
            getNodeWorldPosition(node),
            node.dimensions,
            getLiveViewport(),
        )
        return chromeEl
    }

    // The expandable info panel is decoupled from the scaling chrome strip. It
    // uses normal viewport-transformed canvas coordinates, so zooming the canvas
    // changes the panel and text naturally instead of applying bounded icon scaling.
    function createGeneratedMediaInfoPanelChrome(node: ImageCanvasNode | VideoCanvasNode): HTMLElement {
        const panel = createGeneratedMediaMetadataPanel(node)
        panel.setAttribute('data-media-info-panel-node-id', node.nodeId)
        applyStyle(panel, { position: 'absolute', top: '0', left: '0' })
        return panel
    }

    function createGeneratedMediaHistoryPanelChrome(node: ImageCanvasNode | VideoCanvasNode): HTMLElement | null {
        const panel = createGeneratedMediaHistoryPanel(node)
        if (!panel) return null
        panel.setAttribute('data-media-history-panel-node-id', node.nodeId)
        applyStyle(panel, { position: 'absolute', top: '0', left: '0' })
        return panel
    }

    function updateGeneratedMediaInfoPanelPosition(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
    ): void {
        const panel = generatedMediaInfoPanelLayerEl?.querySelector(`[data-media-info-panel-node-id="${nodeId}"]`) as HTMLElement | null
        if (!panel) return
        applyGeneratedMediaInfoPanelGeometry(
            panel,
            position,
            dimensions,
            viewport,
            getVideoControlsOutsideOffsetScreen(nodeId, viewport),
        )
    }

    function updateGeneratedMediaHistoryPanelPosition(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
        viewport: Viewport,
    ): void {
        const panel = generatedMediaInfoPanelLayerEl?.querySelector(`[data-media-history-panel-node-id="${nodeId}"]`) as HTMLElement | null
        if (!panel) return
        applyGeneratedMediaInfoPanelGeometry(
            panel,
            position,
            dimensions,
            viewport,
            getVideoControlsOutsideOffsetScreen(nodeId, viewport),
        )
    }

    // Video chrome for completed video nodes: the actual <video> shown on the
    // node plus an external SVG control bar below it, both in the transform-
    // synced chrome layer. The element MUST be visibly composited — the browser
    // throttles frame production for a <video> it isn't rendering, so sampling a
    // hidden element into a PIXI texture renders blank on play. Showing the real
    // element is what makes playback and fullscreen work; the opaque surface
    // covers the redundant PIXI sprite behind it.
    function createVideoControlsChrome(node: VideoCanvasNode): HTMLElement | null {
        const videoEl = videoNodeHandler?.getVideoElement(node.nodeId)
        if (!videoEl) return null
        if (!videoEl.currentSrc && !videoEl.src) return null

        const viewport = getLiveViewport()
        const controlsLayout = getVideoControlsChromeLayout(node.dimensions, viewport)
        const controlsStyles = settings.videoControls.styles
        const controlsHostStyle = {
            position: 'absolute' as const,
            left: `${controlsLayout.insetX}px`,
            top: `${controlsLayout.top}px`,
            width: `${controlsLayout.width}px`,
            height: `${controlsLayout.height}px`,
            borderRadius: controlsStyles.hostBorderRadius,
            filter: controlsStyles.hostDropShadow,
            backdropFilter: controlsStyles.hostBackdropFilter,
            webkitBackdropFilter: controlsStyles.hostBackdropFilter,
        }
        const chromeEl = html`
            <div className="workspace-video-chrome" data=${{ videoChromeNodeId: node.nodeId }}>
                <div className="workspace-video-surface"></div>
                <div className="workspace-video-controls-host" style=${controlsHostStyle}></div>
            </div>
        ` as HTMLElement

        // Move the handler's <video> out of its off-screen host and onto the node
        // so it actually renders (and plays).
        const surface = chromeEl.querySelector('.workspace-video-surface') as HTMLDivElement
        surface.appendChild(videoEl)

        const togglePlayback = (event: Event) => {
            event.preventDefault()
            event.stopPropagation()
            if (videoNodeHandler?.hasEntry(node.nodeId)) {
                videoNodeHandler.toggle(node.nodeId).catch(() => {})
            }
        }

        surface.addEventListener('mousemove', (event: MouseEvent) => {
            const resizeHandle = getVideoChromeResizeHandle(event, chromeEl)
            surface.style.cursor = resizeHandle ? getResizeCursorForHandle(resizeHandle) : ''
        })
        surface.addEventListener('mouseleave', () => {
            surface.style.cursor = ''
        })
        surface.addEventListener('mousedown', (event: MouseEvent) => {
            const resizeHandle = getVideoChromeResizeHandle(event, chromeEl)
            if (resizeHandle) {
                handleResizeStart(event, node.nodeId, resizeHandle)
                return
            }
            handleDragStart(event, node.nodeId)
        })
        surface.addEventListener('dblclick', togglePlayback)

        const host = chromeEl.querySelector('.workspace-video-controls-host') as HTMLDivElement
        applyVideoControlsHostStyleProperties(host)

        const svg = select(host)
            .append('svg')
            .attr('class', 'workspace-video-controls-svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('viewBox', `0 0 ${controlsLayout.logicalWidth} ${VIDEO_CONTROLS_HEIGHT}`)
            .style('display', 'block')
            .style('overflow', 'visible')

        const controls = createVideoControls(svg, {
            id: node.nodeId,
            x: 0,
            y: 0,
            width: controlsLayout.logicalWidth,
            height: VIDEO_CONTROLS_HEIGHT,
            responsiveWidth: controlsLayout.responsiveWidth,
            videoEl,
            className: 'workspace-video-controls',
        })
        videoControlInstances.set(node.nodeId, controls)
        applyVideoControlsGeometry(chromeEl, getNodeWorldPosition(node), node.dimensions, viewport)
        return chromeEl
    }

    function destroyVideoControlInstances(): void {
        for (const controls of videoControlInstances.values()) {
            controls.destroy()
        }
        videoControlInstances.clear()
    }

    function destroyGeneratedMediaInfoRenderer(rendererKey: string): void {
        const renderer = generatedMediaInfoRenderers.get(rendererKey)
        if (!renderer) return
        console.info('[CANVAS][generated-media-chrome]', 'projection-renderer-destroy', {
            rendererKey,
            rendererCountBefore: generatedMediaInfoRenderers.size,
        })
        renderer.destroy()
        generatedMediaInfoRenderers.delete(rendererKey)
    }

    function destroyGeneratedMediaInfoRenderers(): void {
        if (generatedMediaInfoRenderers.size > 0 || generatedMediaInfoPreviewTiles.size > 0) {
            console.info('[CANVAS][generated-media-chrome]', 'projection-renderers-destroy-all', {
                rendererCountBefore: generatedMediaInfoRenderers.size,
                previewTileCountBefore: generatedMediaInfoPreviewTiles.size,
            })
        }
        for (const renderer of generatedMediaInfoRenderers.values()) {
            renderer.destroy()
        }
        generatedMediaInfoRenderers.clear()
        for (const editor of generatedMediaAssetEditors.values()) editor.destroy()
        generatedMediaAssetEditors.clear()
        for (const dropdown of generatedMediaAssetDropdowns.values()) dropdown.destroy()
        generatedMediaAssetDropdowns.clear()
        for (const tile of generatedMediaInfoPreviewTiles) {
            tile.destroy()
        }
        generatedMediaInfoPreviewTiles.clear()
    }

    function resetGeneratedMediaChromeSyncKey(): void {
        generatedMediaChromeSyncKey = RESET_GENERATED_MEDIA_CHROME_SYNC_KEY
    }

    function getJsonChromeKey(value: unknown): string {
        try {
            return JSON.stringify(value ?? null)
        } catch {
            return String(value ?? '')
        }
    }

    function getDescriptorChromeKey(node: ImageCanvasNode | VideoCanvasNode): string {
        const descriptor = getAssetDescriptor(node)
        if (!descriptor) return ''
        return [
            descriptor.status ?? '',
            descriptor.source ?? '',
            descriptor.summary ?? '',
            ...(descriptor.entityTags ?? []),
            ...(descriptor.styleTags ?? []),
            String(descriptor.version ?? ''),
        ].join('\u001f')
    }

    function getGeneratedMediaNodeChromeKey(node: ImageCanvasNode | VideoCanvasNode): string {
        const asset = assetsStore.get(node.assetId)
        return [
            node.nodeId,
            node.type,
            node.assetId,
            getGeneratedMediaModelId(node),
            node.generatedBy?.reasoningModelId ?? '',
            getDescriptorChromeKey(node),
            asset?.revision ?? '',
            asset?.title ?? '',
            asset?.scope ?? '',
            asset?.states.provenance ?? '',
            expandedGeneratedMediaInfoNodeIds.has(node.nodeId) ? 'metadata-open' : '',
            expandedGeneratedMediaHistoryNodeIds.has(node.nodeId)
                ? getJsonChromeKey(getGeneratedMediaHistoryContent(node))
                : '',
        ].join('\u001f')
    }

    function getBranchMarkerProjectionChromeKey(marker: BranchMarkerNode, lineageProjectionScope: AiLineageProjectionScope): string {
        const projection = buildBranchMarkerTurnProjectionContent(marker, lineageProjectionScope)
        return [
            marker.nodeId,
            marker.type,
            getBranchMarkerThreadId(marker),
            lineageProjectionScope,
            marker.generationRequestId,
            marker.branchId,
            marker.reasoningRunId ?? '',
            marker.reasoningModelId ?? '',
            marker.reasoningIndex == null ? '' : String(marker.reasoningIndex),
            marker.type === 'branchLine' ? marker.mediaRunId ?? '' : '',
            marker.type === 'branchLine' ? marker.mediaModelId ?? '' : '',
            getJsonChromeKey(marker.pendingState ?? null),
            getJsonChromeKey(marker.provenance ?? null),
            getJsonChromeKey(projection?.content ?? null),
        ].join('\u001f')
    }

    function getGeneratedMediaProjectionContentChromeKey(
        node: ImageCanvasNode | VideoCanvasNode,
        lineageProjectionScope: AiLineageProjectionScope,
        limitProjectionToSelectedMedia: boolean,
    ): string {
        const generatedBy = node.generatedBy
        const locator = getGeneratedMediaProjectionLocator(node)
        if (!generatedBy || !locator) return ''

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(
            getGeneratedMediaHistoryContent(node),
            locator,
            {
                threadId: generatedBy.conversationAssetId,
                forceGenerationDetailsOpen: true,
                limitToLocatorMedia: limitProjectionToSelectedMedia,
                lineageProjectionScope,
            },
        )
        if (!projection) return ''

        return [
            projection.threadId,
            getJsonChromeKey(projection.content),
        ].join('\u001f')
    }

    function getBranchMarkerPanelChromeKey(
        marker: BranchMarkerNode,
        lineageProjectionScope: AiLineageProjectionScope,
        limitProjectionToSelectedMedia: boolean,
    ): string {
        const generatedMediaNode = getBranchMarkerGeneratedMediaNodes(marker)[0]
        const generatedMediaProjectionKey = generatedMediaNode
            ? getGeneratedMediaProjectionContentChromeKey(
                generatedMediaNode,
                lineageProjectionScope,
                limitProjectionToSelectedMedia,
            )
            : ''
        if (generatedMediaNode && generatedMediaProjectionKey) {
            return [
                'generated-media-panel',
                generatedMediaNode.nodeId,
                generatedMediaNode.type,
                generatedMediaNode.assetId,
                getGeneratedMediaModelId(generatedMediaNode),
                generatedMediaProjectionKey,
            ].join('\u001f')
        }

        return [
            'branch-marker-panel',
            getBranchMarkerProjectionChromeKey(marker, lineageProjectionScope),
        ].join('\u001f')
    }

    function getPlayableVideoChromeKey(node: VideoCanvasNode): string {
        const videoEl = videoNodeHandler?.getVideoElement(node.nodeId)
        return [
            node.nodeId,
            node.assetId,
            videoEl ? 'video-element-ready' : 'video-element-missing',
            videoEl?.currentSrc || videoEl?.src || '',
        ].join('\u001f')
    }

    function getGeneratedMediaChromeSyncKey({
        mediaInfoNodes,
        pendingIconNodes,
        playableVideoNodes,
        branchOriginNodes,
        branchForkNodes,
        branchLineNodes,
    }: {
        mediaInfoNodes: Array<ImageCanvasNode | VideoCanvasNode>
        pendingIconNodes: Array<ImageCanvasNode | VideoCanvasNode>
        playableVideoNodes: VideoCanvasNode[]
        branchOriginNodes: BranchOriginCanvasNode[]
        branchForkNodes: BranchForkCanvasNode[]
        branchLineNodes: BranchLineCanvasNode[]
    }): string {
        const expandedBranchOrigins = branchOriginNodes
            .filter((node) => expandedBranchOriginInfoNodeIds.has(node.nodeId))
            .map((node) => getBranchMarkerPanelChromeKey(node, 'branch-origin', false))
        const expandedBranchForks = branchForkNodes
            .filter((node) => expandedBranchForkInfoNodeIds.has(node.nodeId))
            .map((node) => getBranchMarkerPanelChromeKey(node, 'branch-fork', false))
        const expandedBranchLines = branchLineNodes
            .filter((node) => expandedBranchLineInfoNodeIds.has(node.nodeId))
            .map((node) => getBranchMarkerPanelChromeKey(node, 'media-run', true))

        return [
            mediaInfoNodes.map(getGeneratedMediaNodeChromeKey).join('\u001e'),
            pendingIconNodes.map((node) => [node.nodeId, node.type, node.assetId].join('\u001f')).join('\u001e'),
            playableVideoNodes.map(getPlayableVideoChromeKey).join('\u001e'),
            expandedBranchOrigins.join('\u001e'),
            expandedBranchForks.join('\u001e'),
            expandedBranchLines.join('\u001e'),
        ].join('\u001d')
    }

    function destroyActiveAiChatPanelProjection(): void {
        activeAiChatPanelProjectionRenderer?.destroy()
        activeAiChatPanelProjectionRenderer = null
        for (const tile of activeAiChatPanelTracePreviewTiles) {
            tile.destroy()
        }
        activeAiChatPanelTracePreviewTiles.clear()
    }

    function destroyBranchMarkerReasoningTooltip(nodeId: string): void {
        branchMarkerReasoningTooltips.get(nodeId)?.destroy()
        branchMarkerReasoningTooltips.delete(nodeId)
        for (const tooltip of branchMarkerMediaModelTooltips.get(nodeId) ?? []) {
            tooltip.destroy()
        }
        branchMarkerMediaModelTooltips.delete(nodeId)
    }

    function destroyBranchMarkerReasoningTooltips(): void {
        for (const tooltip of branchMarkerReasoningTooltips.values()) {
            tooltip.destroy()
        }
        branchMarkerReasoningTooltips.clear()
        for (const tooltips of branchMarkerMediaModelTooltips.values()) {
            for (const tooltip of tooltips) tooltip.destroy()
        }
        branchMarkerMediaModelTooltips.clear()
    }

    function scheduleGeneratedMediaChromeSync(): void {
        if (generatedMediaChromeSyncRaf !== null) return
        generatedMediaChromeSyncRaf = requestAnimationFrame(() => {
            generatedMediaChromeSyncRaf = null
            syncGeneratedMediaChrome(currentCanvasState)
        })
    }

    function syncGeneratedMediaChrome(canvasState: CanvasState | null = currentCanvasState): void {
        if (!mediaChromeViewportEl || !generatedMediaChromeLayerEl || !pendingGeneratedMediaIconLayerEl) return
        const canvasNodes = canvasState?.nodes ?? []
        const pendingBeforeFirstFrameNodeIds = getPendingGeneratedMediaBeforeFirstFrameNodeIds()
        // Generated/uploaded media (image OR video) carrying generation metadata
        // or a descriptor gets the below-node provenance chrome (info button +
        // panel + analyzing pulse). Video info chrome reserves space for the
        // external playback-control row.
        const mediaInfoNodes = canvasNodes
            .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                (node.type === 'image' || node.type === 'video')
                && !pendingBeforeFirstFrameNodeIds.has(node.nodeId)
                && Boolean(assetsStore.get((node as ImageCanvasNode | VideoCanvasNode).assetId)))
        for (const node of mediaInfoNodes) {
            const descriptor = getAssetDescriptor(node)
            if (descriptor?.status === 'ready' && descriptor.version !== MEDIA_DESCRIPTOR_VERSION) {
                queueCanvasMediaAnalysis(node.nodeId, getMediaDescriptorStillAssetId(node))
            }
        }
        const pendingIconNodes = canvasNodes
            .filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
                (node.type === 'image' || node.type === 'video')
                && pendingBeforeFirstFrameNodeIds.has(node.nodeId))
        const branchOriginNodes = canvasNodes
            .filter((node: CanvasNode): node is BranchOriginCanvasNode => node.type === 'branchOrigin')
        const branchForkNodes = canvasNodes
            .filter((node: CanvasNode): node is BranchForkCanvasNode => node.type === 'branchFork')
        const branchLineNodes = canvasNodes
            .filter((node: CanvasNode): node is BranchLineCanvasNode => node.type === 'branchLine')

        // Completed video nodes (those with a stored MP4 src) get the visible
        // video surface plus the external shared SVG control bar in the chrome layer.
        const playableVideoNodes = canvasNodes
            .filter((node: CanvasNode): node is VideoCanvasNode =>
                node.type === 'video' && assetsStore.get(node.assetId)?.media?.renditions.original?.status === 'ready')

        // Drop expanded state for nodes that no longer show info chrome, so a
        // deleted node doesn't leak an orphaned open panel.
        const infoNodeIds = new Set<string>(mediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => node.nodeId))
        for (const expandedNodeId of Array.from(expandedGeneratedMediaInfoNodeIds)) {
            if (!infoNodeIds.has(expandedNodeId)) {
                expandedGeneratedMediaInfoNodeIds.delete(expandedNodeId)
                continue
            }
            expandedGeneratedMediaHistoryNodeIds.delete(expandedNodeId)
        }
        for (const expandedNodeId of Array.from(expandedGeneratedMediaHistoryNodeIds)) {
            const node = mediaInfoNodes.find((candidate) => candidate.nodeId === expandedNodeId)
            if (!node?.generatedBy) expandedGeneratedMediaHistoryNodeIds.delete(expandedNodeId)
        }
        const branchOriginNodeIds = new Set<string>(branchOriginNodes.map((node: BranchOriginCanvasNode) => node.nodeId))
        for (const expandedNodeId of Array.from(expandedBranchOriginInfoNodeIds)) {
            if (!branchOriginNodeIds.has(expandedNodeId)) expandedBranchOriginInfoNodeIds.delete(expandedNodeId)
        }
        const branchForkNodeIds = new Set<string>(branchForkNodes.map((node: BranchForkCanvasNode) => node.nodeId))
        for (const expandedNodeId of Array.from(expandedBranchForkInfoNodeIds)) {
            if (!branchForkNodeIds.has(expandedNodeId)) expandedBranchForkInfoNodeIds.delete(expandedNodeId)
        }
        const branchLineNodeIds = new Set<string>(branchLineNodes.map((node: BranchLineCanvasNode) => node.nodeId))
        for (const expandedNodeId of Array.from(expandedBranchLineInfoNodeIds)) {
            if (!branchLineNodeIds.has(expandedNodeId)) expandedBranchLineInfoNodeIds.delete(expandedNodeId)
        }

        const nextChromeSyncKey = getGeneratedMediaChromeSyncKey({
            mediaInfoNodes,
            pendingIconNodes,
            playableVideoNodes,
            branchOriginNodes,
            branchForkNodes,
            branchLineNodes,
        })
        if (nextChromeSyncKey === generatedMediaChromeSyncKey) {
            console.info('[CANVAS][generated-media-chrome]', 'sync-skip-same-key', {
                mediaInfoNodeCount: mediaInfoNodes.length,
                pendingIconNodeCount: pendingIconNodes.length,
                playableVideoNodeCount: playableVideoNodes.length,
                expandedMediaInfoNodeIds: Array.from(expandedGeneratedMediaInfoNodeIds).join(','),
                expandedMediaHistoryNodeIds: Array.from(expandedGeneratedMediaHistoryNodeIds).join(','),
                expandedBranchOriginInfoNodeIds: Array.from(expandedBranchOriginInfoNodeIds).join(','),
                expandedBranchForkInfoNodeIds: Array.from(expandedBranchForkInfoNodeIds).join(','),
                expandedBranchLineInfoNodeIds: Array.from(expandedBranchLineInfoNodeIds).join(','),
                rendererCount: generatedMediaInfoRenderers.size,
            })
            updateGeneratedMediaChromeLayout()
            return
        }

        console.info('[CANVAS][generated-media-chrome]', 'sync-rebuild', {
            mediaInfoNodeCount: mediaInfoNodes.length,
            pendingIconNodeCount: pendingIconNodes.length,
            playableVideoNodeCount: playableVideoNodes.length,
            branchOriginNodeCount: branchOriginNodes.length,
            branchForkNodeCount: branchForkNodes.length,
            branchLineNodeCount: branchLineNodes.length,
            expandedMediaInfoNodeIds: Array.from(expandedGeneratedMediaInfoNodeIds).join(','),
            expandedMediaHistoryNodeIds: Array.from(expandedGeneratedMediaHistoryNodeIds).join(','),
            expandedBranchOriginInfoNodeIds: Array.from(expandedBranchOriginInfoNodeIds).join(','),
            expandedBranchForkInfoNodeIds: Array.from(expandedBranchForkInfoNodeIds).join(','),
            expandedBranchLineInfoNodeIds: Array.from(expandedBranchLineInfoNodeIds).join(','),
            previousRendererCount: generatedMediaInfoRenderers.size,
        })
        generatedMediaChromeSyncKey = nextChromeSyncKey
        destroyGeneratedMediaInfoRenderers()
        destroyVideoControlInstances()

        const videoChromeEls = playableVideoNodes
            .map(createVideoControlsChrome)
            .filter((el): el is HTMLElement => Boolean(el))
        const branchOriginInfoChromeEls = branchOriginNodes
            .map(createBranchOriginInfoChrome)
            .filter((el): el is HTMLElement => Boolean(el))
        const branchForkInfoChromeEls = branchForkNodes
            .map(createBranchForkInfoChrome)
            .filter((el): el is HTMLElement => Boolean(el))
        const branchLineInfoChromeEls = branchLineNodes
            .map(createBranchLineInfoChrome)
            .filter((el): el is HTMLElement => Boolean(el))

        pendingGeneratedMediaIconLayerEl.replaceChildren(
            ...pendingIconNodes
                .map((node: ImageCanvasNode | VideoCanvasNode) => createPendingGeneratedMediaIconChrome(node))
                .filter((el): el is HTMLElement => Boolean(el)),
        )
        generatedMediaChromeLayerEl.replaceChildren(
            ...mediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => createGeneratedMediaChrome(node)),
        )
        mediaChromeViewportEl.replaceChildren(
            ...branchOriginInfoChromeEls,
            ...branchForkInfoChromeEls,
            ...branchLineInfoChromeEls,
            ...videoChromeEls,
        )
        // Expanded info panels render in their own viewport-transformed layer,
        // decoupled from the bounded scaling strip above, then get anchored under it.
        if (generatedMediaInfoPanelLayerEl) {
            const expandedMediaInfoNodes = mediaInfoNodes.filter((node: ImageCanvasNode | VideoCanvasNode) =>
                expandedGeneratedMediaInfoNodeIds.has(node.nodeId))
            const expandedMediaHistoryNodes = mediaInfoNodes.filter((node: ImageCanvasNode | VideoCanvasNode) =>
                expandedGeneratedMediaHistoryNodeIds.has(node.nodeId))
            generatedMediaInfoPanelLayerEl.replaceChildren(
                ...expandedMediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => createGeneratedMediaInfoPanelChrome(node)),
                ...expandedMediaHistoryNodes
                    .map((node: ImageCanvasNode | VideoCanvasNode) => createGeneratedMediaHistoryPanelChrome(node))
                    .filter((panel): panel is HTMLElement => Boolean(panel)),
            )
            const nodesById = getCanvasNodesById(canvasNodes)
            const viewport = getLiveViewport()
            for (const node of expandedMediaInfoNodes) {
                updateGeneratedMediaInfoPanelPosition(
                    node.nodeId,
                    getNodeWorldPosition(node, nodesById),
                    liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions,
                    viewport,
                )
            }
            for (const node of expandedMediaHistoryNodes) {
                updateGeneratedMediaHistoryPanelPosition(
                    node.nodeId,
                    getNodeWorldPosition(node, nodesById),
                    liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions,
                    viewport,
                )
            }
        }
    }

    function syncPixiGeneratingImageNodes(canvasState: CanvasState | null = currentCanvasState): void {
        // Feeds the PIXI traveling outline (snake border) renderer with the set
        // of active media nodes and their travel direction. New generated media
        // travels clockwise; existing reference/evaluation media travels counterclockwise.
        const generatingIds = new Map<string, GeneratingMediaOutlineTarget>()
        if (settings.mediaNode.inProgressOutlineAnimation.developmentFlags.alwaysOn) {
            for (const node of canvasState?.nodes ?? []) {
                if (node.type !== 'image' && node.type !== 'video') continue
                const isPendingBeforeFrame = isPendingGeneratedMediaBeforeFirstFrame(node.nodeId)
                generatingIds.set(node.nodeId, {
                    direction: isPendingBeforeFrame ? 'clockwise' : 'counterclockwise',
                    shape: isPendingBeforeFrame ? 'preFrameCircle' : 'node',
                })
            }
            pixiMediaLayer?.setGeneratingImageNodes(generatingIds)
            return
        }
        for (const partial of partialImageTracker.values()) {
            const isFinalizing = finalizingGeneratedImageRunKeysByNodeId.has(partial.nodeId)
            generatingIds.set(partial.nodeId, {
                direction: 'clockwise',
                shape: partial.hasReceivedFrame ? 'node' : 'preFrameCircle',
                ...(isFinalizing ? { sourceRendition: 'original' as const } : {}),
            })
        }
        for (const pending of videoGenerationTracker.values()) {
            generatingIds.set(pending.nodeId, {
                direction: 'clockwise',
                shape: pending.hasReceivedFrame ? 'node' : 'preFrameCircle',
            })
        }
        for (const node of canvasState?.nodes ?? []) {
            if (generatingIds.has(node.nodeId) || !isGeneratedMediaCanvasNodeWaitingForFrame(node)) continue
            generatingIds.set(node.nodeId, {
                direction: 'clockwise',
                shape: 'preFrameCircle',
            })
        }
        for (const referenceNodeIds of generatingReferenceNodeIdsByThread.values()) {
            for (const nodeId of referenceNodeIds) {
                if (!generatingIds.has(nodeId)) generatingIds.set(nodeId, { direction: 'counterclockwise' })
            }
        }
        pixiMediaLayer?.setGeneratingImageNodes(generatingIds)
    }

    function clearFinalizingGeneratedImageOutline(nodeId: string): void {
        const runKey = finalizingGeneratedImageRunKeysByNodeId.get(nodeId)
        if (!runKey) return

        finalizingGeneratedImageRunKeysByNodeId.delete(nodeId)
        const timer = finalizingGeneratedImageOutlineTimersByNodeId.get(nodeId)
        if (timer !== undefined) window.clearTimeout(timer)
        finalizingGeneratedImageOutlineTimersByNodeId.delete(nodeId)

        if (partialImageTracker.get(runKey)?.nodeId === nodeId) {
            partialImageTracker.delete(runKey)
            syncPixiGeneratingImageNodes()
        }
    }

    function pruneGeneratedMediaTrackerAliases(
        trackerMap: Map<string, PendingGeneratedMediaTracker>,
        runKey: string,
        nodeId: string,
    ): void {
        for (const [existingRunKey, existingTracker] of trackerMap.entries()) {
            if (existingRunKey !== runKey && existingTracker.nodeId === nodeId) {
                trackerMap.delete(existingRunKey)
            }
        }
    }

    function setGeneratedMediaTracker(
        trackerMap: Map<string, PendingGeneratedMediaTracker>,
        runKey: string,
        tracker: PendingGeneratedMediaTracker,
    ): void {
        pruneGeneratedMediaTrackerAliases(trackerMap, runKey, tracker.nodeId)
        trackerMap.set(runKey, tracker)
    }

    function keepGeneratedImageCompletionOutlineUntilTextureReady(
        runKey: string,
        previousTracker: PendingGeneratedMediaTracker,
        completedImageNode: ImageCanvasNode,
    ): void {
        const staleNodeIds = Array.from(finalizingGeneratedImageRunKeysByNodeId.entries())
            .filter(([, existingRunKey]) => existingRunKey === runKey)
            .map(([nodeId]) => nodeId)
        for (const nodeId of staleNodeIds) clearFinalizingGeneratedImageOutline(nodeId)

        setGeneratedMediaTracker(partialImageTracker, runKey, {
            ...previousTracker,
            nodeId: completedImageNode.nodeId,
            assetId: completedImageNode.assetId || previousTracker.assetId,
            // Completion makes the original rendition fetchable, but the visual
            // remains the pre-frame circle until PIXI has decoded real pixels.
            hasReceivedFrame: false,
        })
        finalizingGeneratedImageRunKeysByNodeId.set(completedImageNode.nodeId, runKey)

        const fallbackTimer = window.setTimeout(() => {
            clearFinalizingGeneratedImageOutline(completedImageNode.nodeId)
        }, GENERATED_IMAGE_COMPLETION_OUTLINE_FALLBACK_MS)
        finalizingGeneratedImageOutlineTimersByNodeId.set(completedImageNode.nodeId, fallbackTimer)
        syncPixiGeneratingImageNodes()
    }

    function getPendingGeneratedMediaBeforeFirstFrameNodeIds(): Set<string> {
        const nodeIds = new Set<string>()
        for (const pending of partialImageTracker.values()) {
            if (!pending.hasReceivedFrame) nodeIds.add(pending.nodeId)
        }
        for (const pending of videoGenerationTracker.values()) {
            if (!pending.hasReceivedFrame) nodeIds.add(pending.nodeId)
        }
        for (const node of currentCanvasState?.nodes ?? []) {
            if (isGeneratedMediaCanvasNodeWaitingForFrame(node)) nodeIds.add(node.nodeId)
        }
        return nodeIds
    }

    function isGeneratedMediaCanvasNodeWaitingForFrame(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode {
        if (node.type !== 'image' && node.type !== 'video') return false
        if (node.type === 'image' && decodedGeneratedImageNodeIds.has(node.nodeId)) return false
        if (node.mediaGenerationPhase) return node.mediaGenerationPhase === 'pending-before-first-frame'
        const asset = assetsStore.get(node.assetId)
        return Boolean(node.generatedBy) && asset?.media?.renditions.original?.status !== 'ready'
    }

    function isPendingGeneratedMediaBeforeFirstFrame(nodeId: string): boolean {
        for (const pending of partialImageTracker.values()) {
            if (pending.nodeId === nodeId) return !pending.hasReceivedFrame
        }
        for (const pending of videoGenerationTracker.values()) {
            if (pending.nodeId === nodeId) return !pending.hasReceivedFrame
        }
        const canvasNode = currentCanvasState?.nodes.find((node: CanvasNode) => node.nodeId === nodeId)
        if (canvasNode) return isGeneratedMediaCanvasNodeWaitingForFrame(canvasNode)
        return false
    }

    function updatePendingGeneratedMediaBeforeFrameClass(nodeEl: HTMLElement, nodeId: string): void {
        const pendingBeforeFirstFrame = isPendingGeneratedMediaBeforeFirstFrame(nodeId)
        nodeEl.classList.toggle('is-pending-generated-media-before-frame', pendingBeforeFirstFrame)
        if (!pendingBeforeFirstFrame) return

        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) return
        const inset = getPendingGeneratedMediaBeforeFrameCircleInset(node.dimensions)
        nodeEl.style.setProperty('--workspace-pending-media-hit-left', `${inset.x}px`)
        nodeEl.style.setProperty('--workspace-pending-media-hit-top', `${inset.y}px`)
        nodeEl.style.setProperty('--workspace-pending-media-hit-size', `${inset.size}px`)
    }

    function syncPixiMediaLayer(canvasState: CanvasState | null = currentCanvasState): void {
        syncPixiGeneratingImageNodes(canvasState)
        pixiMediaLayer?.sync(canvasState)
        syncGeneratedMediaChrome(canvasState)
    }

    function fitImageDimensionsToAspectRatio(
        dimensions: { width: number; height: number },
        aspectRatio: number
    ): { width: number; height: number } {
        return fitDimensionsToAspectRatio(dimensions, aspectRatio)
    }

    // Mirror of handleImageIntrinsicSize, fired when the attached <video>
    // reports the MP4's intrinsic width/height via loadedmetadata. Re-fits the
    // canvas node dimensions to the real aspect, preserves the node's current
    // center, then lets branch-tree layout re-tidy generated lineages. This
    // prevents final aspect-ratio updates from collapsing forked media back
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
        if (!currentCanvasState) {
            clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
            clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }

        const intrinsicAspectRatio = size.width / size.height
        if (!Number.isFinite(intrinsicAspectRatio) || intrinsicAspectRatio <= 0) {
            clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }

        const imageNode = currentCanvasState.nodes.find(
            (node: CanvasNode): node is ImageCanvasNode => node.type === 'image' && node.nodeId === size.nodeId
        )
        if (!imageNode) {
            clearFinalizingGeneratedImageOutline(size.nodeId)
            return
        }
        decodedGeneratedImageNodeIds.add(size.nodeId)
        clearFinalizingGeneratedImageOutline(size.nodeId)
        if (draggingNodeId === size.nodeId || resizingNodeId === size.nodeId) return

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

    function getGeneratedMediaInsertionSize(): number {
        return settings.mediaBranchLineage.generatedMediaSize
    }

    function getInsertionPaneSize(): { width: number; height: number } {
        const rect = paneRect ?? paneEl.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
    }

    function getCanvasVisibleAreaForApiProjection(): { width: number; height: number } | undefined {
        const { width, height } = getInsertionPaneSize()
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
        return { width, height }
    }

    function getCenteredInsertionPosition(dimensions: { width: number; height: number }): { x: number; y: number } {
        return computeViewportCenterInsertionPosition(dimensions, getLiveViewport(), getInsertionPaneSize())
    }

    function getFreshBranchRootMarkerPosition(
        dimensions: { width: number; height: number },
    ): { x: number; y: number } {
        const viewport = getLiveViewport()
        const paneSize = getInsertionPaneSize()
        const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
        const viewportEdgeGap = getBranchLineageNodeGap() / zoom
        const visibleLeft = (0 - viewport.x) / zoom
        const visibleTop = (0 - viewport.y) / zoom
        const visibleHeight = paneSize.height / zoom
        const minY = visibleTop + viewportEdgeGap
        const maxY = visibleTop + visibleHeight - dimensions.height - viewportEdgeGap
        const centeredY = visibleTop + (visibleHeight - dimensions.height) / 2
        return {
            x: visibleLeft + viewportEdgeGap,
            y: clampInsideRange(centeredY, minY, maxY),
        }
    }

    function getResolvedNodePositionFromCollisionBox(node: CanvasNode, box: { x: number; y: number }, entries: Map<string, CollisionEntry>): { x: number; y: number } {
        const entry = entries.get(node.nodeId)
        if (!entry) return box
        return {
            x: box.x + entry.offset.x,
            y: box.y + entry.offset.y,
        }
    }

    // Shared with the API layout (chrome metrics live in
    // mediaGenerationLayoutSettings.generatedMediaChrome): pending nodes reserve
    // chrome too, so the model label appearing at settle time causes no reflow.
    function getGeneratedMediaChromeCollisionHeight(node: CanvasNode): number {
        if (!isGeneratedMediaNode(node)) return 0
        return getSharedGeneratedMediaChromeCollisionHeight(node.type)
    }

    function getCanvasNodeCollisionRect(
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ): Rect {
        const dimensions = isBranchMarkerNode(node)
            ? liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            : node.dimensions
        const pendingCircleGeometry = getPendingGeneratedMediaBeforeFrameCircleGeometry(
            node.nodeId,
            worldPosition,
            dimensions,
        )
        if (pendingCircleGeometry) {
            return {
                x: pendingCircleGeometry.position.x,
                y: pendingCircleGeometry.position.y,
                width: pendingCircleGeometry.dimensions.width,
                height: pendingCircleGeometry.dimensions.height,
            }
        }
        return {
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height + getGeneratedMediaChromeCollisionHeight(node),
        }
    }

    function getCanvasNodeConnectorAnchorRect(
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ): Rect {
        const dimensions = isBranchMarkerNode(node)
            ? liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            : node.dimensions
        const pendingCircleGeometry = getPendingGeneratedMediaBeforeFrameCircleGeometry(
            node.nodeId,
            worldPosition,
            dimensions,
        )
        if (pendingCircleGeometry) {
            return {
                x: pendingCircleGeometry.position.x,
                y: pendingCircleGeometry.position.y,
                width: pendingCircleGeometry.dimensions.width,
                height: pendingCircleGeometry.dimensions.height,
            }
        }
        return {
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height,
        }
    }

    function getBranchLineageCollisionSettings(
        nodeSettings: WorkspaceCollisionNodeTypeSettings,
    ): WorkspaceCollisionNodeTypeSettings {
        return applyBranchLineageNodeGap(nodeSettings, getBranchLineageNodeGap())
    }

    function getCanvasNodeCollisionSettings(
        node: CanvasNode,
        collisionSettings: WorkspaceCollisionFlowSettings,
    ): WorkspaceCollisionNodeTypeSettings {
        switch (node.type) {
            case 'image':
                return collisionSettings.nodeTypes.image
            case 'video':
                return collisionSettings.nodeTypes.video
            case 'branchOrigin':
                return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchOrigin)
            case 'branchFork':
                return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchFork)
            case 'branchLine':
                return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchLine)
            case 'document':
            default:
                return collisionSettings.nodeTypes.document
        }
    }

    function getWorkspaceCollisionFlowIterations(collisionSettings: WorkspaceCollisionFlowSettings): number {
        return Math.max(
            ...Object.values(collisionSettings.nodeTypes)
                .map((nodeSettings: WorkspaceCollisionNodeTypeSettings) => nodeSettings.iterations),
        )
    }

    function createCollisionPlan(
        nodes: CanvasNode[],
        topLevelOnly = false,
        collisionSettings: WorkspaceCollisionFlowSettings = settings.workspaceCollision.dragRelease,
    ): CollisionPlan {
        const collisionNodes = topLevelOnly
            ? nodes.filter((node: CanvasNode) => !node.parentId)
            : nodes
        const nodesById = getCanvasNodesById(nodes)
        const entries = new Map<string, CollisionEntry>()
        let iterations = 0

        const nodeBoxes = collisionNodes.map((node: CanvasNode) => {
            const worldPosition = getNodeWorldPosition(node, nodesById)
            const collisionRect = getCanvasNodeCollisionRect(node, worldPosition)
            const nodeCollisionSettings = getCanvasNodeCollisionSettings(node, collisionSettings)
            iterations = Math.max(iterations, nodeCollisionSettings.iterations)
            entries.set(node.nodeId, {
                node,
                offset: {
                    x: worldPosition.x - collisionRect.x,
                    y: worldPosition.y - collisionRect.y,
                },
            })
            return {
                id: node.nodeId,
                x: collisionRect.x,
                y: collisionRect.y,
                width: collisionRect.width,
                height: collisionRect.height,
                margin: nodeCollisionSettings.margin,
                overlapThreshold: nodeCollisionSettings.overlapThreshold,
            }
        })

        const shouldResolvePair = (): boolean => true

        return { nodeBoxes, entries, shouldResolvePair, iterations }
    }

    function resolveTopLevelNodeCollisions(nodes: CanvasNode[]): CanvasNode[] {
        const collisionSettings = settings.workspaceCollision.insertion
        const collisionPlan = createCollisionPlan(nodes, true, collisionSettings)
        const collisionResult = resolveCollisions(collisionPlan.nodeBoxes, {
            iterations: collisionPlan.iterations,
            margin: 0,
            shouldResolvePair: collisionPlan.shouldResolvePair,
        })

        if (!collisionResult.hasChanges) return nodes

        return nodes.map((node: CanvasNode) => {
            if (node.parentId) return node
            const movedPosition = collisionResult.nodes.get(node.nodeId)
            return movedPosition ? { ...node, position: getResolvedNodePositionFromCollisionBox(node, movedPosition, collisionPlan.entries) } : node
        })
    }

    function clearStartedBranchMarkerProjectionOverrides(startedMarkerNodeIds: Iterable<string>): void {
        for (const markerId of startedMarkerNodeIds) {
            liveNodeOverrides.delete(markerId)
            branchMarkerProjectionOverrideNodeIds.delete(markerId)
            manuallyPositionedBranchMarkerNodeIds.delete(markerId)
        }
    }

    function createGeneratedMediaRebalancePipeline(): GeneratedMediaRebalancePipeline {
        const collisionSettings = settings.workspaceCollision.branchTree
        return new GeneratedMediaRebalancePipeline({
            workspaceId,
            mediaSize: getGeneratedMediaInsertionSize(),
            pendingMediaPreFrameScale: settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale,
            depthGap: settings.mediaBranchLineage.mediaToMediaGap,
            branchOriginDepthGap: getBranchOriginOutputGap(),
            rootMarkerDepthGap: getRootBranchMarkerOutputGap(),
            siblingGap: settings.mediaBranchLineage.branchRowGap,
            branchFanoutExtraGap: settings.mediaBranchLineage.branchFanoutExtraGap,
            branchOriginMarkerStackGap: getBranchMarkerStackGap(),
            collisionIterations: getWorkspaceCollisionFlowIterations(collisionSettings),
            collisionMargin: 0,
            getNodeWorldPosition,
            getNodeWorldRect,
            getNodeCollisionRect: getCanvasNodeCollisionRect,
            getNodeConnectorAnchorRect: getCanvasNodeConnectorAnchorRect,
            getNodeCollisionMargin: (node: CanvasNode) => getCanvasNodeCollisionSettings(node, collisionSettings).margin,
            getNodeCollisionOverlapThreshold: (node: CanvasNode) =>
                getCanvasNodeCollisionSettings(node, collisionSettings).overlapThreshold,
            isPendingGeneratedMediaBeforeFrame: (node: CanvasNode) => isPendingGeneratedMediaBeforeFirstFrame(node.nodeId),
        })
    }

    // Single entry point for the generated-media add/remove paths: re-tidy every
    // branch-lineage tree and rigid-separate trees + loose nodes through the
    // shared resolver. Depth/sibling gaps come from mediaBranchLineage so
    // spacing matches the rest of the lineage placement.
    function rebalanceGeneratedMediaTrees(nodes: CanvasNode[], edges: WorkspaceEdge[]): CanvasNode[] {
        const result = createGeneratedMediaRebalancePipeline().rebalance(nodes, edges)
        clearStartedBranchMarkerProjectionOverrides(result.startedMarkerNodeIds)
        return result.nodes
    }

    function getPendingGeneratedMediaBeforeFrameCircleGeometry(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): CanvasGeometry | null {
        if (!isPendingGeneratedMediaBeforeFirstFrame(nodeId)) return null
        const inset = getPendingGeneratedMediaBeforeFrameCircleInset(dimensions)
        return {
            position: {
                x: position.x + inset.x,
                y: position.y + inset.y,
            },
            dimensions: { width: inset.size, height: inset.size },
        }
    }

    function getPendingGeneratedMediaBeforeFrameCircleInset(dimensions: { width: number; height: number }): { x: number; y: number; size: number } {
        const configuredScale = Number(settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale)
        const scale = Number.isFinite(configuredScale) && configuredScale > 0
            ? Math.min(1, configuredScale)
            : 1 / 3
        const size = Math.max(1, Math.min(dimensions.width, dimensions.height) * scale)
        return {
            x: (dimensions.width - size) / 2,
            y: (dimensions.height - size) / 2,
            size,
        }
    }

    function getPlannedBranchMarkerSiblingSlot(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        parentBranchNodeId: string,
        markerNodeId: string,
    ): { index: number; count: number } | undefined {
        const lineagePlan = getPendingGeneratedMediaPlacement(threadId, generationRun)?.lineagePlan
        if (!lineagePlan) return undefined

        const markerEntries: Array<{ nodeId: string; reasoningIndex: number }> = []
        const seen = new Set<string>()
        for (const assignment of getUniqueLineageAssignmentsForMarkers(lineagePlan)) {
            const markerId = assignment.branchForkNodeId ?? assignment.branchLineNodeId
            if (!markerId || seen.has(markerId)) continue

            const forkPlan = findBranchForkPlanForRun(lineagePlan, assignment.branchForkNodeId)
            const linePlan = findBranchLinePlanForRun(lineagePlan, assignment.branchLineNodeId)
            const markerParentBranchNodeId = forkPlan?.parentBranchNodeId ?? linePlan?.parentBranchNodeId
            if (markerParentBranchNodeId !== parentBranchNodeId) continue

            markerEntries.push({
                nodeId: markerId,
                reasoningIndex: forkPlan?.reasoningIndex ?? linePlan?.reasoningIndex ?? markerEntries.length,
            })
            seen.add(markerId)
        }
        markerEntries.sort((a, b) => {
            const indexDelta = a.reasoningIndex - b.reasoningIndex
            if (indexDelta !== 0) return indexDelta
            return a.nodeId.localeCompare(b.nodeId)
        })

        const markerIds = markerEntries.map(entry => entry.nodeId)
        const index = markerIds.indexOf(markerNodeId)
        if (index < 0 || markerIds.length <= 1) return undefined
        return { index, count: markerIds.length }
    }

    function getPlannedRootBranchForkSiblingSlot(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        markerNodeId: string,
    ): { index: number; count: number } | undefined {
        const lineagePlan = getPendingGeneratedMediaPlacement(threadId, generationRun)?.lineagePlan
        if (!lineagePlan) return undefined

        const markerEntries = lineagePlan.branchForks
            .filter((fork) => !fork.parentBranchNodeId)
            .map((fork) => ({
                nodeId: fork.nodeId,
                reasoningIndex: fork.reasoningIndex,
            }))
            .sort((a, b) => {
                const indexDelta = a.reasoningIndex - b.reasoningIndex
                if (indexDelta !== 0) return indexDelta
                return a.nodeId.localeCompare(b.nodeId)
            })

        const markerIds = markerEntries.map(entry => entry.nodeId)
        const index = markerIds.indexOf(markerNodeId)
        if (index < 0 || markerIds.length <= 1) return undefined
        return { index, count: markerIds.length }
    }

    function getRootBranchMarkerPositionBeforeGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        markerDimensions: { width: number; height: number },
        mediaHeight: number,
        siblingSlot?: { index: number; count: number },
    ): { x: number; y: number } {
        const referenceRootPosition = getReferenceBranchRootMarkerPositionForGeneratedMedia(
            threadId,
            generationRun,
            markerDimensions,
            mediaHeight,
            getRootBranchMarkerOutputGap(),
        )
        const basePosition = referenceRootPosition
            ? referenceRootPosition
            : getFreshBranchRootMarkerPosition(markerDimensions)

        if (!siblingSlot) return basePosition

        const stackGap = getBranchMarkerStackGap()
        const stackStep = markerDimensions.height + stackGap
        const stackHeight = siblingSlot.count * markerDimensions.height
            + Math.max(0, siblingSlot.count - 1) * stackGap
        return {
            x: basePosition.x,
            y: basePosition.y - stackHeight / 2
                + markerDimensions.height / 2
                + siblingSlot.index * stackStep,
        }
    }

    function getPendingBranchMarkerPositionBeforeGeneratedMedia(
        parentNode: CanvasNode,
        markerDimensions: { width: number; height: number },
        siblingSlot?: { index: number; count: number },
    ): { x: number; y: number } {
        const parentRect = getNodeWorldRect(parentNode)
        const mediaSize = getGeneratedMediaInsertionSize()
        const mediaDimensions = { width: mediaSize, height: mediaSize }
        const siblingCount = siblingSlot?.count ?? 1
        const mediaGapBase = parentNode.type === 'branchOrigin'
            ? getBranchOriginOutputGap()
            : settings.mediaBranchLineage.mediaToMediaGap
        const mediaGap = mediaGapBase + settings.mediaBranchLineage.branchFanoutExtraGap * Math.max(0, siblingCount - 1)
        const futureMediaPosition = computeLineageContinuationPositionToRightOfRect(
            parentRect,
            mediaDimensions.height,
            mediaGap,
        )
        const futureCircleInset = getPendingGeneratedMediaBeforeFrameCircleInset(mediaDimensions)
        const futureCircleLeft = futureMediaPosition.x + futureCircleInset.x
        const futureCircleStep = futureCircleInset.size + settings.mediaBranchLineage.branchRowGap
        const futureCircleStackHeight = futureCircleInset.size * siblingCount
            + settings.mediaBranchLineage.branchRowGap * Math.max(0, siblingCount - 1)
        const firstCircleCenterY = parentRect.y + parentRect.height / 2
            - futureCircleStackHeight / 2
            + futureCircleInset.size / 2
        const futureCircleCenterY = siblingSlot
            ? firstCircleCenterY + futureCircleStep * siblingSlot.index
            : futureMediaPosition.y + futureCircleInset.y + futureCircleInset.size / 2
        const parentAnchorX = parentRect.x + parentRect.width
        const parentAnchorY = parentRect.y + parentRect.height / 2

        if (parentNode.type === 'branchOrigin') {
            const stackIndex = siblingSlot?.index ?? 0
            const stackGap = getBranchMarkerStackGap()
            return {
                x: (parentAnchorX + futureCircleLeft) / 2 - markerDimensions.width / 2,
                y: parentRect.y + parentRect.height
                    + stackGap
                    + stackIndex * (markerDimensions.height + stackGap),
            }
        }

        return {
            x: (parentAnchorX + futureCircleLeft) / 2 - markerDimensions.width / 2,
            y: (parentAnchorY + futureCircleCenterY) / 2 - markerDimensions.height / 2,
        }
    }

    function positionPendingBranchMarkerBeforeGeneratedMedia(
        markerNode: BranchMarkerNode,
        supportNodes: BranchMarkerNode[] = [],
        threadId?: string,
        generationRun?: MediaGenerationRunMeta,
    ): BranchMarkerNode {
        if (markerNode.type !== 'branchFork' && markerNode.type !== 'branchLine') return markerNode
        const parentBranchNodeId = markerNode.parentBranchNodeId
        if (!parentBranchNodeId) return markerNode
        const parentNode = findCanvasNodeById(parentBranchNodeId)
            ?? supportNodes.find((node: BranchMarkerNode) => node.nodeId === parentBranchNodeId)
        if (!parentNode) return markerNode
        const siblingSlot = threadId
            ? getPlannedBranchMarkerSiblingSlot(threadId, generationRun, parentBranchNodeId, markerNode.nodeId)
            : undefined
        return {
            ...markerNode,
            position: getPendingBranchMarkerPositionBeforeGeneratedMedia(parentNode, markerNode.dimensions, siblingSlot),
        }
    }

    function getPendingGeneratedMediaBeforeFrameVisualGeometry(
        nodeId: string,
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): CanvasGeometry | null {
        const circleGeometry = getPendingGeneratedMediaBeforeFrameCircleGeometry(nodeId, position, dimensions)
        if (!circleGeometry) return null
        const animation = settings.mediaNode.inProgressOutlineAnimation
        const outlineStrokeScale = scaleCanvasChromeWorldSizeForZoom(
            1,
            getCurrentViewportZoom(),
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

    function getNodesForConnectionManager(nodes: CanvasNode[]): CanvasNode[] {
        const nodesById = getCanvasNodesById(nodes)
        return nodes.map((node: CanvasNode) => {
            const override = liveNodeOverrides.get(node.nodeId)
            const basePosition = override?.position ?? getNodeWorldPosition(node, nodesById)
            const baseDimensions = override?.dimensions ?? node.dimensions
            const pendingVisualGeometry = getPendingGeneratedMediaBeforeFrameVisualGeometry(
                node.nodeId,
                basePosition,
                baseDimensions,
            )
            const nodeForConnection: CanvasNode = {
                ...node,
                position: pendingVisualGeometry?.position ?? basePosition,
                dimensions: pendingVisualGeometry?.dimensions ?? baseDimensions,
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

    function getSelectionOverlayBoundsForNode(node: CanvasNode): Rect {
        return getSelectionBoundsForNode(node)
    }

    function selectionRectIntersectsNode(rect: Rect, node: CanvasNode): boolean {
        if (!isSelectableCanvasNode(node)) return false
        return rectsOverlap(rect, getSelectionBoundsForNode(node))
    }

    function isSelectableCanvasNode(node: CanvasNode): boolean {
        return node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine'
    }

    function filterSelectableNodeIds(nodeIds: Set<string>): Set<string> {
        if (!currentCanvasState) return nodeIds
        const selectableNodeIds = new Set(currentCanvasState.nodes
            .filter(isSelectableCanvasNode)
            .map((node: CanvasNode) => node.nodeId))
        return new Set(Array.from(nodeIds).filter((nodeId) => selectableNodeIds.has(nodeId)))
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

        const overlayNodeIds = new Set<string>()
        for (const nodeId of selectedNodeIds) {
            overlayNodeIds.add(nodeId)
        }

        const overlayNodes = currentCanvasState.nodes.filter((node: CanvasNode) => overlayNodeIds.has(node.nodeId))
        if (overlayNodes.length === 0) return null

        const bounds = overlayNodes.map((node: CanvasNode) => {
            const rect = getSelectionOverlayBoundsForNode(node)
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
        }

        for (const nodeId of nextSelectedNodeIds) {
            if (prevSelectedNodeIds.has(nodeId)) continue
            const nextNode = viewportEl?.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
            nextNode?.classList.add('is-selected')
            if (nextNode) nodeLayerManager.bringToFront(nextNode)
        }
    }

    function updateSelectionDrivenUi(): void {
        const singleSelectedNodeId = getSingleSelectedNodeId()

        if (!singleSelectedNodeId) {
            hideCanvasBubbleMenu()
            return
        }

        selectedEdgeId = null
        connectionManager?.deselect()
        hideEdgeBubbleMenu()
        showCanvasBubbleMenuForNode(singleSelectedNodeId)

        const node = currentCanvasState?.nodes.find((item: CanvasNode) => item.nodeId === singleSelectedNodeId)
        if (!node) {
            hideCanvasBubbleMenu()
            return
        }
    }

    function clearSelectedEdgeSelection(force = false): void {
        if (!force && !selectedEdgeId) return
        selectedEdgeId = null
        connectionManager?.deselect()
        hideEdgeBubbleMenu()
    }

    function setSelectedNodes(nextSelectedNodeIds: Set<string>, fromMarquee = false): void {
        const prevSelectedNodeIds = selectedNodeIds
        selectedNodeIds = filterSelectableNodeIds(nextSelectedNodeIds)
        selectionIsFromMarquee = fromMarquee && selectedNodeIds.size > 0
        if (currentCanvasState) connectionManager?.syncEdges(currentCanvasState.edges)
        if (selectedNodeIds.size > 0) clearSelectedEdgeSelection()
        updateNodeSelectionClasses(prevSelectedNodeIds, selectedNodeIds)
        updateSelectionGroupOverlayElement()
        updateSelectionDrivenUi()
        pixiMediaLayer?.setSelectedImageNodes(selectedNodeIds)
        scheduleEdgesRender()
        const selectedGeneratedMediaThreadId = currentCanvasState?.nodes.find((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode =>
            selectedNodeIds.has(node.nodeId)
            && (node.type === 'image' || node.type === 'video')
            && Boolean(node.generatedBy?.conversationAssetId)
        )?.generatedBy?.conversationAssetId
        if (selectedGeneratedMediaThreadId) {
            refreshActiveAiChatPanelProjectionTarget(selectedGeneratedMediaThreadId)
        } else if (activeAiChatPanelProjectionRenderer) {
            refreshActiveAiChatPanelProjectionTarget(activeAiChatPanelThreadId ?? undefined)
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
            '.workspace-branch-origin-info-chrome',
            '.workspace-branch-fork-info-chrome',
            '.canvas-generated-media-info-panel',
        ].join(', '))
    }

    function showCanvasBubbleMenuForNode(nodeId: string) {
        if (!canvasBubbleMenu || !canvasBubbleMenuItems || !currentCanvasState) return

        const node = currentCanvasState.nodes.find((n: CanvasNode) => n.nodeId === nodeId)
        // Every uploaded media kind gets a bubble menu (at minimum Delete) — image,
        // video, uploaded document (PDF/office/text), and audio.
        const bubbleContextByType: Record<string, string> = {
            image: CANVAS_IMAGE_CONTEXT,
            video: CANVAS_VIDEO_CONTEXT,
            mediaDocument: CANVAS_DOCUMENT_CONTEXT,
            audio: CANVAS_AUDIO_CONTEXT,
        }
        const context = node ? bubbleContextByType[node.type] : undefined
        if (!node || !context) {
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

    // The active right side panel's width state lives in the SidePanel instance
    // (activeRightSidePanel), which owns clamping, persistence, and the public
    // get/set/subscribe API. The host only reflects the reported width into DOM.
    let activeOpeningRightSidePanel: SidePanelInstance | null = null
    let activeClosingRightSidePanel: SidePanelInstance | null = null
    let hasRenderedInitialAiChatPanelState = false

    const promptInputController = new AiPromptInputController({
        workspaceId,
        getCanvasState: () => currentCanvasState,
        persistCanvasState: (state: CanvasState) => {
            commitCanvasState(state)
        },
        onAiChatThreadCreated: ({ threadId }) => {
            aiChatPanelState = { ...aiChatPanelState, isOpen: true }
            activeAiChatThreadId = threadId
            ensureAiChatSidebarThreadTab(threadId)
            activeAiChatSidebarTabId = `thread:${threadId}`
            persistAiChatSidebarState()
            requestAnimationFrame(() => {
                renderActiveAiChatPanel()
            })
        },
        createAiChatThread: async (params) => {
            const organizationId = workspaceStore.getData('organizationId')
            const asset = await assetService.create({
                organizationId,
                workspaceId: params.workspaceId,
                title: 'AI Chat',
                primaryCategory: 'conversation',
                assetId: params.threadId,
                initialDoc: params.content,
            })
            return {
                threadId: asset.assetId,
                assetId: asset.assetId,
                organizationId: asset.organizationId,
                workspaceId: params.workspaceId,
                title: asset.title,
                content: params.content,
                proseMirrorVersion: asset.documents.conversation?.version ?? 0,
                status: asset.states.conversation,
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
                aiModel: params.aiModel,
            }
        },
        onAiSubmit: (threadId, payload) => {
            const entry = threadEditors.get(threadId)
            if (!entry) return

            // Trigger gradient animation on the target thread
            entry.triggerGradientAnimation?.()

            // The actual AI request is triggered by USE_AI_CHAT_META dispatch
            // which the controller already handles via injectMessageAndSubmit
        },
    })

    function getPromptControlFactories() {
        return {
            createContextTray: createAiChatPanelContextTrayElement,
            createModelDropdown: createGenericAiModelDropdown,
            createModelMultiSelect: createGenericAiModelMultiSelect,
            createImageModelDropdown: createGenericImageModelDropdown,
            createImageModelMultiSelect: createGenericImageModelMultiSelect,
            createImageSizeDropdown: createGenericImageSizeDropdown,
            createVideoModelDropdown: createGenericVideoModelDropdown,
            createVideoModelMultiSelect: createGenericVideoModelMultiSelect,
            createVideoAspectDropdown: createGenericVideoAspectDropdown,
            createVideoResolutionDropdown: createGenericVideoResolutionDropdown,
            createVideoDurationDropdown: createGenericVideoDurationDropdown,
            createSubmitButton: createGenericSubmitButton,
        }
    }

    function getWorkspaceCanvasElement(): HTMLElement | null {
        return paneEl.closest('.workspace-canvas') as HTMLElement | null
    }

    function getRightSidePanelMaxWidth(): number {
        const paneWidth = paneEl.getBoundingClientRect().width
        return Math.max(
            RIGHT_SIDE_PANEL_SETTINGS.dimensions.minWidth,
            paneWidth - RIGHT_SIDE_PANEL_SETTINGS.dimensions.maxPaneMargin
        )
    }

    function getRightSidePanelCurrentWidth(): number {
        if (activeRightSidePanel) return activeRightSidePanel.getWidth()
        return Math.min(RIGHT_SIDE_PANEL_SETTINGS.defaultDimensions.width, getRightSidePanelMaxWidth())
    }

    function getCssPixelVariable(name: string, defaultValue: number): number {
        const sourceEl = getWorkspaceCanvasElement() ?? document.documentElement
        const value = Number.parseFloat(getComputedStyle(sourceEl).getPropertyValue(name))
        return Number.isFinite(value) ? value : defaultValue
    }

    function getAiChatPanelTabsViewportWidth(panelWidth = getRightSidePanelCurrentWidth()): number {
        const inlinePadding = getCssPixelVariable(
            '--workspace-right-side-panel-content-inset',
            RIGHT_SIDE_PANEL_SETTINGS.layout.contentInset
        )
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

    function resizeActiveRightPanelModeSwitch(): void {
        // While a mode-switch slide is being preserved across a body re-render,
        // any resize would re-lay (and snap) the indicator. Leave it untouched.
        if (suppressModeSwitchResize) return
        if (!activeRightPanelModeSwitch || !activeAiChatPanelEl) return
        const switchEl = activeAiChatPanelEl.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch')
        const viewportWidth = switchEl?.clientWidth ?? getAiChatPanelTabsViewportWidth()
        activeRightPanelModeSwitch.resize(0, 0, viewportWidth, settings.aiChatThread.panelTabs.height)
    }

    function clearRightPanelModeSwitchAnimationTimer(): void {
        if (activeRightPanelModeSwitchAnimationTimer === null) return
        clearTimeout(activeRightPanelModeSwitchAnimationTimer)
        activeRightPanelModeSwitchAnimationTimer = null
    }

    function getRightPanelModeSwitchTransitionDuration(previousMode: CanvasRightSidePanelMode, nextMode: CanvasRightSidePanelMode): number {
        const modes: CanvasRightSidePanelMode[] = ['features', 'media', 'aiThreads']
        const previousIndex = modes.indexOf(previousMode)
        const nextIndex = modes.indexOf(nextMode)
        if (previousIndex < 0 || nextIndex < 0) return settings.aiChatThread.panelTabs.transitionDurationMs

        const travelDistance = Math.max(1, Math.abs(nextIndex - previousIndex))
        const speedup = 1 + (travelDistance - 1) * settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor
        return Math.max(
            settings.aiChatThread.panelTabs.transitionMinDurationMs,
            Math.round(settings.aiChatThread.panelTabs.transitionDurationMs / speedup)
        )
    }

    function preserveRightPanelModeSwitchDuringAnimation(previousSwitchMode: CanvasRightSidePanelMode, nextMode: CanvasRightSidePanelMode): void {
        clearRightPanelModeSwitchAnimationTimer()
        const durationMs = getRightPanelModeSwitchTransitionDuration(previousSwitchMode, nextMode)
        activeRightPanelModeSwitchAnimationTimer = setTimeout(() => {
            activeRightPanelModeSwitchAnimationTimer = null
        }, durationMs)
    }

    function applyRightPanelModeBody(nextMode: CanvasRightSidePanelMode): void {
        if (activeRightPanelRenderedMode === nextMode) return

        if (activeRightPanelRenderedMode !== 'aiThreads' && nextMode !== 'aiThreads') {
            ensureMediaLibraryPanel().setMode(nextMode === 'media' ? 'media' : 'features')
            activeRightPanelRenderedMode = nextMode
            return
        }

        renderActiveAiChatPanel(undefined, { preserveModeSwitch: true })
    }

    // Reflects the width owned by the SidePanel instance into host DOM. The
    // SidePanel has already clamped and stored it; this only updates CSS vars and
    // dependent layout.
    function reflectRightSidePanelWidth(width: number): void {
        const widthValue = `${width}px`
        const workspaceCanvasElement = getWorkspaceCanvasElement()
        workspaceCanvasElement?.style.setProperty('--workspace-right-side-panel-width', widthValue)
        workspaceCanvasElement?.style.setProperty('--side-panel-backdrop-width', widthValue)
        activeAiChatPanelEl?.style.setProperty('--workspace-right-side-panel-width', widthValue)
        activeAiChatPanelEl?.style.setProperty('--side-panel-backdrop-width', widthValue)
        resizeActiveAiChatPanelTabsSwitch()
        resizeActiveRightPanelModeSwitch()
    }

    function handleRightSidePanelResizeStart(): void {
        activeAiChatPanelEl?.classList.add('is-resizing')
        if (panZoom) {
            panZoom.update({
                ...panZoomConfig,
                panOnDrag: false,
                userSelectionActive: true,
                connectionInProgress: true,
                selectionOnDrag: false
            })
        }
    }

    function handleRightSidePanelResizeEnd(): void {
        activeAiChatPanelEl?.classList.remove('is-resizing')
        if (panZoom) {
            panZoom.update(panZoomConfig)
        }
    }

    function ensureActiveRightSidePanel(): SidePanelInstance {
        if (activeRightSidePanel) return activeRightSidePanel

        const { defaultDimensions, dimensions, resizeHandle, toggle, animation, overlay, drag } = RIGHT_SIDE_PANEL_SETTINGS
        activeRightSidePanel = createSidePanel({
            side: 'right',
            offset: resizeHandle.offset,
            grabWidth: resizeHandle.grabWidth,
            className: 'workspace-ai-chat-side-panel-resize-handle',
            styles: resizeHandle.styles,
            overlay,
            drag,
            toggle: {
                iconSvg: aiChatPanelCollapseIcon,
                className: 'workspace-ai-chat-panel-toggle',
                openAriaLabel: toggle.openAriaLabel,
                closedAriaLabel: toggle.closedAriaLabel,
                openOffset: toggle.openOffset,
                closedTravel: toggle.closedTravel,
                top: toggle.top,
                size: toggle.size,
                onToggle: toggleAiChatPanelVisibility,
            },
            animation,
            minWidth: dimensions.minWidth,
            defaultWidth: defaultDimensions.width,
            getMaxWidth: getRightSidePanelMaxWidth,
            measureWidth: () => activeAiChatPanelEl?.getBoundingClientRect().width ?? defaultDimensions.width,
            loadState: () => ({ width: aiChatPanelState.width ?? null }),
            persistState: (state) => {
                aiChatPanelState = { ...aiChatPanelState, width: state.width ?? undefined }
                persistAiChatSidebarState()
            },
            onResizeStart: handleRightSidePanelResizeStart,
            onResize: (width) => reflectRightSidePanelWidth(width),
            onResizeEnd: handleRightSidePanelResizeEnd,
            onOpenChange: (open) => {
                if (open) {
                    openAiChatPanel()
                    return
                }
                void closeAiChatPanel()
            },
        })
        if (activeRightSidePanel.toggleElement) paneEl.appendChild(activeRightSidePanel.toggleElement)
        activeRightSidePanel.setOpen(aiChatPanelState.isOpen)
        reflectRightSidePanelWidth(activeRightSidePanel.getWidth())
        return activeRightSidePanel
    }

    function aiChatThreadHasRenderableContent(thread: AiChatThread | undefined): boolean {
        return Boolean(thread && thread.content != null && typeof thread.content === 'object' && Object.keys(thread.content).length > 0)
    }

    function proseMirrorContentHasInProgressAiContent(value: unknown): boolean {
        if (!value || typeof value !== 'object') return false
        const node = value as { attrs?: Record<string, unknown>; content?: unknown[] }
        const attrs = node.attrs ?? {}
        if (attrs.isReceivingAnimation || attrs.isStreaming || attrs.isPartial) return true
        return Boolean(node.content?.some(proseMirrorContentHasInProgressAiContent))
    }

    function aiChatThreadHasInProgressContent(thread: AiChatThread | undefined): boolean {
        return proseMirrorContentHasInProgressAiContent(thread?.content)
    }

    function aiChatThreadHasSubmittedUserMessage(thread: AiChatThread | undefined): boolean {
        if (!thread?.content) return false

        const userMessageCount = countProseMirrorNodesByType(thread.content, new Set(['aiUserMessage']))
        return userMessageCount > 0
    }

    function aiChatThreadHasRecoverableDetachedCanvasTurn(thread: AiChatThread | undefined): boolean {
        return aiChatThreadHasSubmittedUserMessage(thread) || aiChatThreadHasInProgressContent(thread)
    }

    function getStoredProseMirrorVersion(record: unknown): number {
        const version = (record as { proseMirrorVersion?: unknown } | undefined)?.proseMirrorVersion
        return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
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
        preserveTabsSwitch = false,
        destroySidePanel = false,
        preserveModeSwitch = false
    ): void {
        destroyActiveAiChatPanelProjection()
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

        if (activeOpeningRightSidePanel === activeRightSidePanel) activeOpeningRightSidePanel = null
        if (activeClosingRightSidePanel === activeRightSidePanel) activeClosingRightSidePanel = null
        if (!preserveModeSwitch) clearRightPanelModeSwitchAnimationTimer()
        if (destroySidePanel) {
            activeRightSidePanel?.destroy()
            activeRightSidePanel = null
        } else {
            activeRightSidePanel?.detachPanel()
            if (!aiChatPanelState.isOpen) activeRightSidePanel?.setOpen(false)
        }
        if (!preserveTabsSwitch) activeAiChatPanelTabsSwitch?.destroy()
        if (!preserveModeSwitch) {
            activeRightPanelModeSwitch?.destroy()
            activeRightPanelModeSwitch = null
        }
        mediaLibraryPanelInstance?.unmount()
        activeAiChatPanelEl?.remove()
        activeAiChatPanelThreadId = null
        activeAiChatPanelHadContent = false
        activeAiChatPanelEl = null
        activeRightPanelRenderedMode = null
        if (!preserveTabsSwitch) activeAiChatPanelTabsSwitch = null
        refreshContextChipTray()

        if (clearActive) {
            activeAiChatThreadId = null
            activeAiChatSidebarThreadId = null
            promptInputController.setTarget(null)
        }
    }

    function createAiChatThreadSidebarTab(threadId: string): CanvasAiChatSidebarTab {
        return { tabId: `thread:${threadId}`, type: 'thread', refId: threadId, title: 'AI Chat' }
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
        const { lastActiveConversationAssetId: _removedLastActiveConversationAssetId, ...nextCanvasStateWithoutActiveConversation } = nextCanvasState
        const persistedState = {
            ...nextCanvasStateWithoutActiveConversation,
            ...(activeAiChatThreadId ? { lastActiveConversationAssetId: activeAiChatThreadId } : {}),
        }
        if (JSON.stringify(currentCanvasState.aiChatPanel) === JSON.stringify(persistedState.aiChatPanel)
            && currentCanvasState.lastActiveConversationAssetId === persistedState.lastActiveConversationAssetId) return

        commitCanvasMetadataState(persistedState)
    }

    function getContextPreviewEnvironment(): ContextPreviewEnvironment {
        return {
            getDocuments: () => currentDocuments,
            getThreads: () => currentAiChatThreads,
            getAsset: (assetId: string) => assetsStore.get(assetId),
            getApiBaseUrl: () => import.meta.env.VITE_API_URL || '',
            getAuthToken: () => AuthService.getTokenSilently(),
        }
    }

    function getAiUserMessageContextPreviewRenderer(options: { inlinePopover?: boolean } = {}) {
        return {
            getNodeById: (nodeId: string) => findCanvasNodeById(nodeId),
            environment: getContextPreviewEnvironment(),
            inlinePopover: options.inlinePopover,
        }
    }

    function destroyContextPreviewTilesForTray(trayEl: HTMLDivElement): void {
        const tiles = contextPreviewTilesByTray.get(trayEl)
        if (!tiles) return
        for (const tile of tiles) {
            tile.destroy()
        }
        contextPreviewTilesByTray.delete(trayEl)
    }

    function destroyContextPreviewTiles(): void {
        for (const trayEl of Array.from(contextPreviewTilesByTray.keys())) {
            destroyContextPreviewTilesForTray(trayEl)
        }
    }

    function getConnectedContextChipTrays(): HTMLDivElement[] {
        const connectedTrays: HTMLDivElement[] = []
        for (const trayEl of activeContextChipTrayEls) {
            if (trayEl.isConnected) {
                connectedTrays.push(trayEl)
            } else {
                activeContextChipTrayEls.delete(trayEl)
                destroyContextPreviewTilesForTray(trayEl)
            }
        }
        return connectedTrays
    }

    function createContextTrayElement(className: string, ariaLabel: string): HTMLDivElement {
        const trayEl = html`<div
            className=${`workspace-ai-chat-panel-context-chips ${className}`}
            role="list"
            aria-label=${ariaLabel}
            contenteditable="false"
        ></div>` as HTMLDivElement
        trayEl.hidden = true
        activeContextChipTrayEls.add(trayEl)
        requestAnimationFrame(() => {
            if (trayEl.isConnected) refreshContextChipTray()
        })
        return trayEl
    }

    function createAiChatPanelContextTrayElement(): HTMLDivElement {
        return createContextTrayElement('workspace-ai-chat-panel-context-chips-panel', 'Chat context previews')
    }

    function createCanvasGlobalContextTrayElement(): HTMLDivElement {
        return createContextTrayElement('workspace-canvas-global-context-chips', 'Canvas prompt context previews')
    }

    function addContextChips(nodeIds: Iterable<string>): void {
        if (!currentCanvasState) return
        const eligibleNodeIds = new Set(currentCanvasState.nodes
            .filter((node: CanvasNode) => node.type === 'image' || node.type === 'video' || node.type === 'document')
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

    function restoreAiChatPanelHistoryScroll(historyScrollerEl: HTMLElement | null | undefined, scrollTop: number | null, refreshVersion: number): void {
        if (!historyScrollerEl || scrollTop === null) return
        historyScrollerEl.scrollTop = scrollTop
        requestAnimationFrame(() => {
            if (refreshVersion !== contextPreviewRefreshVersion) return
            if (historyScrollerEl.isConnected) historyScrollerEl.scrollTop = scrollTop
        })
    }

    function renderContextChip({
        nodeId,
        node,
        trayEl,
    }: {
        nodeId: string
        node: CanvasNode
        trayEl: HTMLDivElement
    }): HTMLDivElement {
        const environment = getContextPreviewEnvironment()
        const previewTile = createContextPreviewTile({
            node,
            getNode: () => findCanvasNodeById(nodeId) ?? node,
            environment,
        })
        const accessibleLabel = getContextPreviewAccessibleLabel(node, environment)
        const removeLabel = `Remove ${accessibleLabel} from context`
        const trayTiles = contextPreviewTilesByTray.get(trayEl) ?? new Set<ContextPreviewTileInstance>()
        trayTiles.add(previewTile)
        contextPreviewTilesByTray.set(trayEl, trayTiles)
        const chipEl = html`<div
            className="workspace-ai-chat-panel-context-chip workspace-ai-chat-panel-context-chip-explicit"
            data=${{ nodeId, contextKind: 'explicit', contextRole: 'forced-chip' }}
            role="listitem"
        >
            ${previewTile.dom}
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
        const trayEls = getConnectedContextChipTrays()
        if (trayEls.length === 0) return
        const historyScrollerEl = activeAiChatPanelEl?.querySelector<HTMLElement>(
            '.workspace-ai-chat-panel-body-pane:not(.workspace-ai-chat-panel-body-pane-hidden)'
        )
        const previousScrollTop = historyScrollerEl?.scrollTop ?? null
        const refreshVersion = ++contextPreviewRefreshVersion
        const explicitChipNodeIds = aiChatPanelState.contextChips
        const nodesById = new Map(currentCanvasState?.nodes.map((node): [string, CanvasNode] => [node.nodeId, node]) ?? [])
        const explicitChipNodes: CanvasNode[] = []
        for (const nodeId of explicitChipNodeIds) {
            const node = nodesById.get(nodeId)
            if (node) explicitChipNodes.push(node)
        }
        for (const trayEl of trayEls) {
            destroyContextPreviewTilesForTray(trayEl)
            trayEl.replaceChildren()
            if (explicitChipNodes.length === 0) {
                trayEl.hidden = true
                continue
            }
            trayEl.hidden = false
            for (const node of explicitChipNodes) {
                trayEl.appendChild(renderContextChip({ nodeId: node.nodeId, node, trayEl }))
            }
        }
        restoreAiChatPanelHistoryScroll(historyScrollerEl, previousScrollTop, refreshVersion)
    }

    function isTerminalFeatureExtractionStatus(status: CanvasFeatureExtractionState['status'] | undefined): boolean {
        return status === 'completed' || status === 'failed'
    }

    function normalizeFeatureExtractionStatus(status: unknown): CanvasFeatureExtractionState['status'] {
        const statusText = typeof status === 'string' ? status : 'pending'
        switch (statusText) {
            case 'pending':
            case 'analyzing':
            case 'routing':
            case 'extracting':
            case 'extracting_axes':
            case 'materializing_crops':
            case 'synthesizing':
            case 'generating_samples':
            case 'saving':
            case 'completed':
            case 'failed':
                return statusText
            default:
                return 'analyzing'
        }
    }

    function toCanvasFeatureExtractionState(run: ExtractionRun): CanvasFeatureExtractionState {
        const analysisProvider = run.modelConfig?.analysisModelId
            ? splitAiModelId(run.modelConfig.analysisModelId).provider
            : ''
        return {
            extractionRunId: run.extractionRunId,
            ...(run.featureId ? { featureId: run.featureId } : {}),
            status: normalizeFeatureExtractionStatus(run.status),
            ...(run.userText ? { userText: run.userText } : {}),
            ...(analysisProvider ? { aiProvider: analysisProvider } : {}),
            ...(run.modelConfig ? { modelConfig: run.modelConfig } : {}),
            ...(run.stageReasoning ? { stageReasoning: run.stageReasoning } : {}),
            ...(run.featureCard ? { featureCard: run.featureCard } : {}),
            ...(run.trace ? { traceEvents: run.trace } : {}),
            ...(run.sourceContextSnapshot ? { sourceContextSnapshot: run.sourceContextSnapshot } : {}),
            ...(run.error ? { error: run.error } : {}),
            updatedAt: run.updatedAt,
        }
    }

    function upsertFeatureExtractionTraceEvent(
        traceEvents: StageTraceEvent[] | undefined,
        event: StageTraceEvent,
    ): StageTraceEvent[] {
        const nextTraceEvents = [...(traceEvents ?? [])]
        const existingIndex = nextTraceEvents.findIndex((existing) => existing.stage === event.stage)
        if (existingIndex >= 0) nextTraceEvents[existingIndex] = event
        else nextTraceEvents.push(event)
        return nextTraceEvents
    }

    function refreshSelectedFeatureExtractionRun(): void {
        if (!mediaLibraryPanelInstance) return
        if (aiChatPanelState.topLevelMode !== 'features') return
        mediaLibraryPanelInstance.refresh()
    }

    function scheduleFeatureExtractionPanelRefresh(extractionRunId: string, immediate = false): void {
        const existingTimer = featureExtractionRefreshTimers.get(extractionRunId)
        if (existingTimer) {
            clearTimeout(existingTimer)
            featureExtractionRefreshTimers.delete(extractionRunId)
        }
        if (immediate) {
            refreshSelectedFeatureExtractionRun()
            return
        }
        const timer = setTimeout(() => {
            featureExtractionRefreshTimers.delete(extractionRunId)
            refreshSelectedFeatureExtractionRun()
        }, 600)
        featureExtractionRefreshTimers.set(extractionRunId, timer)
    }

    function unsubscribeFeatureExtractionRun(extractionRunId: string): void {
        const subjects = subscribedFeatureExtractionRunSubjects.get(extractionRunId)
        if (!subjects) return
        servicesStore.getData('nats')?.getSubscriptions?.([subjects.subject, subjects.errorSubject])
            ?.forEach((sub: any) => sub.unsubscribe())
        subscribedFeatureExtractionRunSubjects.delete(extractionRunId)
    }

    function unsubscribeAllFeatureExtractionRuns(): void {
        for (const extractionRunId of Array.from(subscribedFeatureExtractionRunSubjects.keys())) {
            unsubscribeFeatureExtractionRun(extractionRunId)
        }
        for (const timer of featureExtractionRefreshTimers.values()) clearTimeout(timer)
        featureExtractionRefreshTimers.clear()
    }

    function subscribeToFeatureExtractionRun(extractionRunId: string): void {
        const extractionState = apiFeatureExtractionRuns.get(extractionRunId)
        if (!extractionState || isTerminalFeatureExtractionStatus(extractionState.status)) return
        if (subscribedFeatureExtractionRunSubjects.has(extractionRunId)) return

        const nats = servicesStore.getData('nats')
        if (!nats) return

        const subject = getAiInteractionResponseSubject(userStore.getData('userId') as string, workspaceId, extractionRunId)
        const errorSubject = `ai.interaction.chat.error.${workspaceId}:${extractionRunId}`
        if ((nats.getSubscriptions?.([subject, errorSubject])?.length ?? 0) > 0) return
        subscribedFeatureExtractionRunSubjects.set(extractionRunId, { subject, errorSubject })

        let currentReasoningStage = 'router'
        const processedPipelineEventIds = new Set<string>()
        let pipelineLocalStreamSeq = 0
        const saveUpdatedState = (
            updater: (state: CanvasFeatureExtractionState) => CanvasFeatureExtractionState,
            refreshImmediately = false,
        ) => {
            const current = apiFeatureExtractionRuns.get(extractionRunId)
            if (!current) return
            const next = updater(current)
            apiFeatureExtractionRuns.set(extractionRunId, next)
            if (isTerminalFeatureExtractionStatus(next.status)) unsubscribeFeatureExtractionRun(extractionRunId)
            scheduleFeatureExtractionPanelRefresh(extractionRunId, refreshImmediately)
        }

        const shouldProcessPipelinePayload = (data: any): boolean => {
            const pipelineEventId = typeof data?.pipelineEventId === 'string' ? data.pipelineEventId : ''
            const pipelineStreamSeq = typeof data?.pipelineStreamSeq === 'number' ? data.pipelineStreamSeq : 0

            if (pipelineEventId) {
                if (processedPipelineEventIds.has(pipelineEventId)) {
                    pipelineLocalStreamSeq = Math.max(pipelineLocalStreamSeq, pipelineStreamSeq)
                    return false
                }
                processedPipelineEventIds.add(pipelineEventId)
            }

            pipelineLocalStreamSeq = Math.max(pipelineLocalStreamSeq, pipelineStreamSeq)
            return true
        }

        const handleFeatureExtractionResponse = (data: any): void => {
            if (!shouldProcessPipelinePayload(data)) return
            if (data?.error) {
                saveUpdatedState((state) => ({
                    ...state,
                    status: 'failed',
                    error: String(data.error),
                    updatedAt: Date.now(),
                }), true)
                return
            }
            const content = data?.content
            if (!content) return
            if (content.stageTraceEvent) {
                const event = content.stageTraceEvent as StageTraceEvent
                if (event.status === 'running') currentReasoningStage = event.stage
                saveUpdatedState((state) => ({
                    ...state,
                    traceEvents: upsertFeatureExtractionTraceEvent(state.traceEvents, event),
                    status: event.stage === 'persist' && event.status === 'ok'
                        ? 'completed'
                        : state.status,
                    updatedAt: Date.now(),
                }), true)
            }
            if (content.extractionStatus) {
                saveUpdatedState((state) => ({
                    ...state,
                    status: normalizeFeatureExtractionStatus(content.extractionStatus),
                    updatedAt: Date.now(),
                }), true)
            }
            if (content.featureCard) {
                saveUpdatedState((state) => ({
                    ...state,
                    ...(typeof content.featureCard.featureId === 'string' ? { featureId: content.featureCard.featureId } : {}),
                    featureCard: content.featureCard,
                    updatedAt: Date.now(),
                }), true)
            }
            if (content.status === STREAM_STATUS.STREAMING && content.text) {
                const text = String(content.text)
                saveUpdatedState((state) => ({
                    ...state,
                    stageReasoning: {
                        ...(state.stageReasoning ?? {}),
                        [currentReasoningStage]: `${state.stageReasoning?.[currentReasoningStage] ?? ''}${text}`,
                    },
                    updatedAt: Date.now(),
                }))
            }
            if (content.status === STREAM_STATUS.END_STREAM) {
                saveUpdatedState((state) => ({
                    ...state,
                    status: state.status === 'failed' ? state.status : 'completed',
                    updatedAt: Date.now(),
                }), true)
            }
        }

        nats.subscribe(subject, handleFeatureExtractionResponse)

        nats.subscribe(errorSubject, (data: any) => {
            saveUpdatedState((state) => ({
                ...state,
                status: 'failed',
                error: String(data?.error ?? data?.message ?? 'Unknown extraction error'),
                updatedAt: Date.now(),
            }), true)
        })

        const resumeFeatureExtractionPipeline = async (): Promise<void> => {
            try {
                let hasMore = false
                do {
                    const result = await nats.request(NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_PIPELINE_RESUME, {
                        token: await AuthService.getTokenSilently(),
                        workspaceId,
                        pipelineId: extractionRunId,
                        localStreamSeq: pipelineLocalStreamSeq,
                    }) as {
                        error?: unknown
                        events?: Array<{ payload: Record<string, any>; streamSequence: number }>
                        hasMore?: boolean
                    }
                    if (result?.error) {
                        console.error('[FEATURE_EXTRACTION] CHAT_PIPELINE_RESUME failed:', result.error)
                        return
                    }
                    const events = result.events ?? []
                    for (const event of events) {
                        handleFeatureExtractionResponse({
                            ...event.payload,
                            pipelineStreamSeq: event.streamSequence,
                        })
                    }
                    hasMore = result.hasMore === true && events.length > 0
                } while (hasMore)
            } catch (error) {
                console.error('[FEATURE_EXTRACTION] CHAT_PIPELINE_RESUME failed:', error)
            }
        }
        void resumeFeatureExtractionPipeline()
    }

    function getPersistedFeatureExtractionState(extractionRunId: string): CanvasFeatureExtractionState | undefined {
        return apiFeatureExtractionRuns.get(extractionRunId)
    }

    function getFeatureExtractionState(extractionRunId: string): CanvasFeatureExtractionState | undefined {
        return getPersistedFeatureExtractionState(extractionRunId) ?? pendingFeatureExtractionRuns.get(extractionRunId)
    }

    function getFeatureExtractionRunsForPanel(): CanvasFeatureExtractionState[] {
        const persistedRuns = Array.from(apiFeatureExtractionRuns.values())
        const persistedRunIds = new Set(persistedRuns.map((run) => run.extractionRunId))
        const pendingRuns = Array.from(pendingFeatureExtractionRuns.values())
            .filter((run) => !persistedRunIds.has(run.extractionRunId))
        return [...pendingRuns, ...persistedRuns]
    }

    function setPendingFeatureExtractionRun(extractionState: CanvasFeatureExtractionState): void {
        for (const pendingRunId of pendingFeatureExtractionRuns.keys()) {
            if (pendingRunId !== extractionState.extractionRunId) {
                clearPendingExtractionContext(pendingRunId)
                featureExtractionModelSelections.delete(pendingRunId)
            }
        }
        pendingFeatureExtractionRuns.clear()
        pendingFeatureExtractionRuns.set(extractionState.extractionRunId, extractionState)
    }

    function persistFeatureExtractionState(extractionState: CanvasFeatureExtractionState): void {
        pendingFeatureExtractionRuns.delete(extractionState.extractionRunId)
        clearPendingExtractionContext(extractionState.extractionRunId)

        const currentExtractionState = apiFeatureExtractionRuns.get(extractionState.extractionRunId)
        if (currentExtractionState && JSON.stringify(currentExtractionState) === JSON.stringify(extractionState)) return

        apiFeatureExtractionRuns.set(extractionState.extractionRunId, extractionState)
        if (isTerminalFeatureExtractionStatus(extractionState.status)) {
            scheduleFeatureExtractionPanelRefresh(extractionState.extractionRunId, true)
        }
    }

    function syncActiveAiChatPanelFromState(): void {
        aiChatPanelState = getAiChatPanelState(currentCanvasState)
        aiChatSidebarTabs = aiChatPanelState.tabs
        activeAiChatSidebarTabId = aiChatPanelState.activeTabId ?? null
        // The SidePanel instance owns width; push the persisted value into it
        // when one exists. When the panel is not mounted, the next createSidePanel
        // loads the width from this same state via its loadState adapter.
        if (aiChatPanelState.width != null) activeRightSidePanel?.setWidth(aiChatPanelState.width, { persist: false })
        activeRightSidePanel?.setOpen(aiChatPanelState.isOpen)
        const activeTab = getActiveAiChatSidebarTab()
        activeAiChatThreadId = activeTab?.type === 'thread' ? activeTab.refId : null
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

    // Insert a media-library feature reference into the bottom-center global
    // composer (the only AI input). Triggered by the Media Library `/use` command.
    function insertFeatureIntoActivePrompt(feature: FeatureMeta): boolean {
        const view = globalCanvasComposer?.editorView
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
            globalCanvasComposer?.triggerGradientAnimation()
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

    function getModelId(model: any): string {
        return model?.provider && model?.model ? `${model.provider}:${model.model}` : ''
    }

    function modelHasModality(model: any, modality: string): boolean {
        return Boolean(model?.modalities?.some((entry: any) => (entry?.modality ?? entry) === modality))
    }

    function getDefaultFeatureExtractionAiModel(): string {
        const models = (aiModelsStore.getData() ?? []) as any[]
        const defaultId = aiModelsStore.getDefaultModelId('reasoning')
        if (defaultId && models.some((model) => getModelId(model) === defaultId)) return defaultId
        return getModelId(models.find((model) =>
            !modelHasModality(model, 'image_generation') && !modelHasModality(model, 'video_generation')
        ))
    }

    function getDefaultFeatureExtractionImageModel(): string | undefined {
        const models = (aiModelsStore.getData() ?? []) as any[]
        const defaultId = aiModelsStore.getDefaultModelId('image')
        if (defaultId && models.some((model) => getModelId(model) === defaultId)) return defaultId
        return getModelId(models.find((model) => modelHasModality(model, 'image_generation'))) || undefined
    }

    function getFeatureExtractionModelSelection(extractionRunId: string): FeatureExtractionModelContext {
        const existing = featureExtractionModelSelections.get(extractionRunId)
        if (existing) return existing
        const extractionState = getFeatureExtractionState(extractionRunId)
        const sourceContext = extractionState?.sourceContextSnapshot as ExtractionTabContext | undefined
        const savedModelConfig = extractionState?.modelConfig ?? sourceContext?.modelConfig
        const initialSelection = {
            aiModel: savedModelConfig?.analysisModelId ?? sourceContext?.aiModel ?? getDefaultFeatureExtractionAiModel(),
            aiImageModel: savedModelConfig?.mediaModelId ?? sourceContext?.aiImageModel ?? getDefaultFeatureExtractionImageModel(),
        }
        featureExtractionModelSelections.set(extractionRunId, initialSelection)
        return initialSelection
    }

    function setFeatureExtractionModelSelection(extractionRunId: string, modelContext: FeatureExtractionModelContext): void {
        featureExtractionModelSelections.set(extractionRunId, modelContext)
    }

    function createFeatureExtractionModelControls(extractionRunId: string): FeatureExtractionModelControlsInstance {
        const modelContext = { ...getFeatureExtractionModelSelection(extractionRunId) }
        const analysisDropdown = createGenericAiModelDropdown({
            getCurrentAiModel: () => modelContext.aiModel ?? '',
            setAiModel: (aiModel) => {
                modelContext.aiModel = aiModel
                setFeatureExtractionModelSelection(extractionRunId, modelContext)
            },
        }, `feature-extraction-reasoning-${extractionRunId}`)
        const mediaDropdown = createGenericImageModelDropdown({
            getCurrentImageModel: () => modelContext.aiImageModel ?? '',
            setImageModel: (aiImageModel) => {
                modelContext.aiImageModel = aiImageModel
                setFeatureExtractionModelSelection(extractionRunId, modelContext)
            },
        }, `feature-extraction-media-${extractionRunId}`)
        const modelMenuContent = createAiModelMenuContent([
            {
                title: 'Reasoning model',
                helpText: 'Reasoning model works on your prompt, resolves the most relevant items on canvas, crafts a detailed prompt for media model and passed it to the media model with the reference items included.',
                controls: [
                    { label: 'Model', control: analysisDropdown.dom },
                ],
            },
            {
                title: 'Image model',
                helpText: 'In this section you can configure image generation options. The model choice decides which image generator will draw it. The second option controls the shape or exact size of the image, depending on what that model supports.',
                controls: [
                    { label: 'Model', control: mediaDropdown.dom },
                ],
            },
        ])
        const dom = modelMenuContent.dom
        dom.classList.add('feature-extraction-model-controls')
        applyAiModelMenuStyleSettings(dom)

        return {
            dom,
            getModelContext: () => ({ ...modelContext }),
            destroy: () => {
                analysisDropdown.destroy()
                mediaDropdown.destroy()
                modelMenuContent.destroy()
            },
        }
    }

    function getFeatureExtractionUserText(extractionState: CanvasFeatureExtractionState | undefined): string {
        const userText = extractionState?.userText?.trim()
        if (userText) return userText
        const ctx = extractionState?.sourceContextSnapshot as ExtractionTabContext | undefined
        return ctx?.imageNatsUrl
            ? 'Extract a reusable visual feature from this image.'
            : 'Extract a reusable visual feature from the selected context.'
    }

    function startFeatureExtractionFromPanel(extractionRunId: string, bodyEl: HTMLElement, modelContext: FeatureExtractionModelContext): void {
        const extractionState = getFeatureExtractionState(extractionRunId)
        const savedContext = extractionState?.sourceContextSnapshot as ExtractionTabContext | undefined
        const selectedModelContext = {
            ...getFeatureExtractionModelSelection(extractionRunId),
            ...modelContext,
        }
        setFeatureExtractionModelSelection(extractionRunId, selectedModelContext)
        const ctx: ExtractionTabContext = {
            ...(savedContext ?? getPendingExtractionContext(extractionRunId) ?? {}),
            aiModel: selectedModelContext.aiModel,
            aiImageModel: selectedModelContext.aiImageModel,
            modelConfig: {
                analysisModelId: selectedModelContext.aiModel,
                mediaModelId: selectedModelContext.aiImageModel,
            },
        }
        submitExtractionRequest(
            bodyEl,
            extractionRunId,
            workspaceId,
            getFeatureExtractionUserText(extractionState),
            ctx,
            {
                getState: getPersistedFeatureExtractionState,
                saveState: persistFeatureExtractionState,
                surface: 'feature',
            },
        )
    }

    function openFeatureExtractionRunInFeatures(extractionRunId: string): void {
        const mediaLibrary = ensureMediaLibraryPanel()
        mediaLibrary.showExtractionRun(extractionRunId)
        openRightSidePanelToMode('features')
        mediaLibrary.showExtractionRun(extractionRunId)
    }

    function openFeatureExtractionTab(extractionRunId: string): void {
        openFeatureExtractionRunInFeatures(extractionRunId)
    }

    function openAiChatPanel(): void {
        syncActiveAiChatPanelFromState()
        aiChatPanelState = { ...aiChatPanelState, isOpen: true }
        persistAiChatSidebarState()
        renderActiveAiChatPanel()
        void loadExtractionSessionHistory()
    }

    async function playRightSidePanelOpen(sidePanel: SidePanelInstance, panelEl: HTMLElement): Promise<void> {
        await sidePanel.playOpen(panelEl)
        if (activeOpeningRightSidePanel === sidePanel) activeOpeningRightSidePanel = null
    }

    async function closeAiChatPanel(): Promise<void> {
        if (activeClosingRightSidePanel) return
        const closingSidePanel = activeRightSidePanel
        if (activeOpeningRightSidePanel === closingSidePanel) activeOpeningRightSidePanel = null
        activeClosingRightSidePanel = closingSidePanel
        aiChatPanelState = { ...aiChatPanelState, isOpen: false }
        persistAiChatSidebarState()
        // Slide the panel back out to its edge before tearing it down. State
        // sync must not destroy the panel while this animation is in flight.
        if (closingSidePanel) await closingSidePanel.playClose()
        if (activeRightSidePanel === closingSidePanel && !aiChatPanelState.isOpen) destroyActiveAiChatPanel(false)
        if (activeClosingRightSidePanel === closingSidePanel) activeClosingRightSidePanel = null
    }

    function toggleAiChatPanelVisibility(): void {
        if (aiChatPanelState.isOpen) {
            void closeAiChatPanel()
        } else {
            openAiChatPanel()
        }
    }

    function closeAiChatSidebarTab(tabId: string): void {
        const closedTabIndex = aiChatSidebarTabs.findIndex((tab) => tab.tabId === tabId)
        aiChatSidebarTabs = aiChatSidebarTabs.filter((tab) => tab.tabId !== tabId)
        if (aiChatSidebarTabs.length === 0) {
            // No tabs left — leave the (view-only) panel open on its empty
            // "reopen a session" state instead of starting a new draft.
            activeAiChatSidebarTabId = null
            activeAiChatSidebarThreadId = null
            activeAiChatThreadId = null
            persistAiChatSidebarState()
            syncActiveAiChatPanelFromState()
            renderActiveAiChatPanel()
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

    async function deleteAiChatSession(threadId: string): Promise<void> {
        const detached = await assetService.detach({
            assetId: threadId,
            workspaceId,
            surfaceId: `conversation#${threadId}`,
        }) as { error?: string }
        if (detached?.error) return
        await assetService.detach({ assetId: threadId, referenceType: 'catalog' })
        currentAiChatThreads = currentAiChatThreads.filter((thread) => thread.threadId !== threadId)
        closeAiChatSidebarTab(`thread:${threadId}`)
    }

    async function deleteExtractionSession(extractionRunId: string): Promise<void> {
        const deletedPendingRun = pendingFeatureExtractionRuns.delete(extractionRunId)
        clearPendingExtractionContext(extractionRunId)
        if (deletedPendingRun && !apiFeatureExtractionRuns.has(extractionRunId)) {
            featureExtractionModelSelections.delete(extractionRunId)
            closeAiChatSidebarTab(`extraction:${extractionRunId}`)
            renderActiveAiChatPanel()
            return
        }

        const response = await servicesStore.getData('nats')?.request(NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.FEATURE_EXTRACT.DELETE, {
            token: await AuthService.getTokenSilently(),
            workspaceId,
            extractionRunId,
        })
        if (!response || response.error) return

        apiFeatureExtractionRuns.delete(extractionRunId)
        featureExtractionModelSelections.delete(extractionRunId)
        unsubscribeFeatureExtractionRun(extractionRunId)
        closeAiChatSidebarTab(`extraction:${extractionRunId}`)
        renderActiveAiChatPanel()
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
            let added = false
            for (const run of runs) {
                if (!run?.extractionRunId) continue
                const extractionState = toCanvasFeatureExtractionState(run as ExtractionRun)
                const existing = apiFeatureExtractionRuns.get(extractionState.extractionRunId)
                apiFeatureExtractionRuns.set(extractionState.extractionRunId, extractionState)
                if (!isTerminalFeatureExtractionStatus(extractionState.status)) {
                    subscribeToFeatureExtractionRun(extractionState.extractionRunId)
                }
                if (!existing || JSON.stringify(existing) !== JSON.stringify(extractionState)) added = true
            }
            if (!added) return
            renderActiveAiChatPanel()
        } catch (error) {
            extractionSessionHistoryLoaded = false
            console.error('Failed to load feature extraction sessions:', error)
        }
    }

    function renderActiveAiChatPanel(
        threadOverride?: AiChatThread,
        options: RenderActiveAiChatPanelOptions = {}
    ): void {
        const preserveModeSwitchForRender = Boolean(
            options.preserveModeSwitch
            || (activeRightPanelModeSwitchAnimationTimer !== null && activeRightPanelModeSwitch && activeAiChatPanelEl)
        )
        if (!aiChatPanelState.isOpen) {
            if (!activeClosingRightSidePanel) destroyActiveAiChatPanel(false)
            hasRenderedInitialAiChatPanelState = true
            return
        }
        if (activeOpeningRightSidePanel && activeAiChatPanelEl) {
            return
        }
        // Suppress switch resizes for the whole synchronous body of a preserved
        // re-render so the in-flight slide is never re-laid or snapped.
        suppressModeSwitchResize = preserveModeSwitchForRender
        void loadExtractionSessionHistory()

        // Play the drawer slide-in only when the panel goes from absent to
        // present. Tab switches and content re-renders rebuild the panel while it
        // is already on screen, and must not replay the open animation.
        const wasMounted = activeAiChatPanelEl !== null && !activeClosingRightSidePanel
        const shouldAnimateOpen = !wasMounted && hasRenderedInitialAiChatPanelState && options.animateOpen !== false

        const activeSidebarTab = getActiveAiChatSidebarTab()
        const panelThreadId = activeSidebarTab?.type === 'thread' ? activeSidebarTab.refId : null
        const thread = panelThreadId
            ? threadOverride?.threadId === panelThreadId
                ? threadOverride
                : currentAiChatThreads.find((candidate) => candidate.threadId === panelThreadId)
            : undefined
        activeAiChatThreadId = panelThreadId
        const shouldRenderTabs = aiChatSidebarTabs.length > 1
        const preservedTabsEl = options.preserveTabsSwitch && shouldRenderTabs
            ? activeAiChatPanelEl?.querySelector<HTMLDivElement>('.workspace-ai-chat-panel-tabs') ?? null
            : null
        const preservedTabsScrollLeft = preservedTabsEl?.scrollLeft ?? 0
        preservedTabsEl?.remove()
        // Preserve the live mode switch across a body re-render so its in-flight
        // slide animation survives (mirrors the AI-thread tabs switch).
        const preservedModeSwitchEl = preserveModeSwitchForRender
            ? activeAiChatPanelEl?.querySelector<HTMLDivElement>('.workspace-right-panel-mode-switch') ?? null
            : null
        preservedModeSwitchEl?.remove()
        destroyActiveAiChatPanel(false, activeAiChatPanelThreadId ?? activeAiChatThreadId, Boolean(preservedTabsEl), false, Boolean(preservedModeSwitchEl))

        const panelEl = html`<div
            className="workspace-ai-chat-floating-panel workspace-ai-chat-thread-node nopan nowheel"
            data=${{ threadId: panelThreadId ?? '' }}
            onmousedown=${(event: Event) => event.stopPropagation()}
            onclick=${(event: Event) => event.stopPropagation()}
        ></div>` as HTMLDivElement

        panelEl.style.setProperty('--ai-chat-thread-node-box-shadow', settings.aiChatThread.styles.nodeBoxShadow)
        panelEl.style.setProperty('--ai-chat-thread-node-border', settings.aiChatThread.styles.nodeBorder)
        panelEl.style.setProperty('--workspace-ai-chat-panel-divider-border', settings.aiChatThread.styles.panelSectionDividerBorder)
        applyAiChatPanelSessionHistorySettings(panelEl)
        applyAiChatPanelContextPreviewSettings(panelEl)

        if (!settings.aiChatThread.showHeader) {
            panelEl.classList.add('workspace-ai-chat-thread-node-hide-title')
        }

        // The AI chat panel body never uses a shifting gradient background.
        const gradient: ReturnType<typeof createShiftingGradientBackground> | null = null

        // Top-level switch: Features / Media / AI Threads. Always shown at the top
        // of the panel; it owns which surface the panel body renders below it.
        const topLevelMode = aiChatPanelState.topLevelMode
        const showingAiThreads = topLevelMode === 'aiThreads'
        // Reuse the live switch (and its in-flight slide) when only the body is
        // being re-rendered; otherwise build a fresh one.
        const modeSwitchEl = preservedModeSwitchEl ?? html`<div className="workspace-right-panel-mode-switch"></div>` as HTMLDivElement
        if (!preservedModeSwitchEl) {
            const modeSwitchSvg = select(modeSwitchEl).append('svg:svg')
                .attr('class', 'workspace-right-panel-mode-switch-svg')
                .attr('aria-label', 'Right side panel mode')
            activeRightPanelModeSwitch = createSlidingSwitch<CanvasRightSidePanelMode>(modeSwitchSvg, {
                id: 'workspace-right-panel-mode',
                x: 0,
                y: 0,
                width: getAiChatPanelTabsViewportWidth(),
                height: settings.aiChatThread.panelTabs.height,
                options: [
                    { label: 'Features', value: 'features' },
                    { label: 'Media', value: 'media' },
                    { label: 'AI Threads', value: 'aiThreads' },
                ],
                selectedValue: topLevelMode,
                transition: {
                    durationMs: settings.aiChatThread.panelTabs.transitionDurationMs,
                    minDurationMs: settings.aiChatThread.panelTabs.transitionMinDurationMs,
                    distanceSpeedupFactor: settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor,
                },
                indicatorBoxShadow: settings.aiChatThread.panelTabs.styles.activeTabBoxShadow,
                indicatorInsetShadow: settings.aiChatThread.panelTabs.styles.activeTabInsetShadow,
                onChange: (nextMode) => {
                    const previousSwitchMode = aiChatPanelState.topLevelMode
                    if (nextMode === previousSwitchMode) return
                    preserveRightPanelModeSwitchDuringAnimation(previousSwitchMode, nextMode)
                    aiChatPanelState = { ...aiChatPanelState, topLevelMode: nextMode }
                    persistAiChatSidebarState()
                    applyRightPanelModeBody(nextMode)
                },
            })
        }
        panelEl.appendChild(modeSwitchEl)

        // Tab strip geometry is reused by the post-mount resize pass, and hasContent
        // is read by the common tail; hoisted so they survive the AI-threads branch.
        let tabsEl: HTMLDivElement | null = null
        let tabsInitialScrollLeft = preservedTabsEl ? preservedTabsScrollLeft : 0
        let hasContent = false

        if (showingAiThreads) {
            const controlsEl = html`<div className="workspace-ai-chat-panel-context-controls">
            <div className="workspace-ai-chat-panel-context-mode">
                <div className="workspace-ai-chat-panel-history-control">
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
        const historyToggleEl = controlsEl.querySelector<HTMLButtonElement>('.workspace-ai-chat-panel-history-toggle')!

        tabsEl = shouldRenderTabs
            ? preservedTabsEl ?? html`<div className="workspace-ai-chat-panel-tabs"></div>` as HTMLDivElement
            : null
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
                    renderActiveAiChatPanel(undefined, { preserveTabsSwitch: true })
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
                renderActiveAiChatPanel(session)
            })
            const deleteEl = html`<button type="button" className="workspace-ai-chat-panel-session-delete" aria-label="Delete session" innerHTML=${trashBinIcon}></button>` as HTMLButtonElement
            deleteEl.addEventListener('click', () => void deleteAiChatSession(session.threadId))
            sessionEl.appendChild(deleteEl)
            sessionsListEl.appendChild(sessionEl)
        }
        const extractionSessions = Array.from(apiFeatureExtractionRuns.values())
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
        const projectionTarget = showingThread && panelThreadId
            ? getActiveAiChatPanelProjectionTarget(panelThreadId)
            : null
        const branchMarkerProjectionTarget = showingThread && panelThreadId
            ? getOpenBranchMarkerProjectionTarget(panelThreadId)
            : null
        const showingGeneratedMediaProjection = Boolean(projectionTarget || branchMarkerProjectionTarget)
        const emptyBodyText = 'Reopen a session from the history, or start a new chat from the prompt below the canvas.'
        const editorContainer = html`<div className=${`ai-chat-thread-node-editor workspace-ai-chat-panel-body-pane nopan${showingThread && !showingGeneratedMediaProjection ? '' : ' workspace-ai-chat-panel-body-pane-hidden'}`}></div>` as HTMLDivElement
        const projectionContainer = html`<div className=${`workspace-ai-chat-panel-projection workspace-ai-chat-panel-body-pane nopan${showingGeneratedMediaProjection ? '' : ' workspace-ai-chat-panel-body-pane-hidden'}`}></div>` as HTMLDivElement
        const extractionBodyEl = html`<div className=${`workspace-ai-chat-panel-extraction workspace-ai-chat-panel-body-pane nopan${showingExtraction ? '' : ' workspace-ai-chat-panel-body-pane-hidden'}`}></div>` as HTMLDivElement
        const emptyBodyEl = html`<div className=${`workspace-ai-chat-panel-empty workspace-ai-chat-panel-body-pane nopan${showingThread || showingExtraction ? ' workspace-ai-chat-panel-body-pane-hidden' : ''}`}>${emptyBodyText}</div>` as HTMLDivElement
        bodyHost.appendChild(editorContainer)
        bodyHost.appendChild(projectionContainer)
        bodyHost.appendChild(extractionBodyEl)
        bodyHost.appendChild(emptyBodyEl)
        panelEl.appendChild(bodyHost)

        if (projectionTarget) {
            activeAiChatPanelProjectionRenderer = mountGeneratedMediaChatProjection({
                mount: projectionContainer,
                node: projectionTarget.node,
                rendererClassName: 'canvas-generated-media-projection-editor workspace-ai-chat-panel-projection-editor',
                traceDetailsClassName: 'canvas-generated-media-trace-details workspace-ai-chat-panel-trace-details',
                previewTiles: activeAiChatPanelTracePreviewTiles,
                lineageProjectionScope: projectionTarget.lineageProjectionScope,
                limitProjectionToSelectedMedia: projectionTarget.limitProjectionToSelectedMedia,
            })
        }

        if (!activeAiChatPanelProjectionRenderer && branchMarkerProjectionTarget) {
            activeAiChatPanelProjectionRenderer = mountBranchMarkerChatProjection({
                mount: projectionContainer,
                marker: branchMarkerProjectionTarget.marker,
                rendererClassName: 'canvas-generated-media-projection-editor workspace-ai-chat-panel-projection-editor',
                traceDetailsClassName: 'canvas-generated-media-trace-details workspace-ai-chat-panel-trace-details',
                previewTiles: activeAiChatPanelTracePreviewTiles,
                lineageProjectionScope: branchMarkerProjectionTarget.lineageProjectionScope,
            })
        }

        if (showingGeneratedMediaProjection && !activeAiChatPanelProjectionRenderer) {
            projectionContainer.classList.add('workspace-ai-chat-panel-body-pane-hidden')
            editorContainer.classList.remove('workspace-ai-chat-panel-body-pane-hidden')
        }

        if (showingExtraction && activeSidebarTab) {
            const extractionState = getPersistedFeatureExtractionState(activeSidebarTab.refId)
            if (extractionState?.sourceContextSnapshot && !getPendingExtractionContext(activeSidebarTab.refId)) {
                setPendingExtractionContext(activeSidebarTab.refId, extractionState.sourceContextSnapshot as any)
            }
            renderExtractionTabBody(activeSidebarTab.tabId, activeSidebarTab.refId, extractionBodyEl, workspaceId, {
                getState: getPersistedFeatureExtractionState,
            })
        }

        hasContent = aiChatThreadHasRenderableContent(thread)
        const promptControlFactories = getPromptControlFactories()
        if (showingThread && panelThreadId) {
            const editorContent = hasContent && thread
                ? thread.content
                : {
                    type: 'doc',
                    content: [
                        { type: 'aiChatThread', attrs: { threadId: panelThreadId }, content: [] },
                    ],
                }
            let aiService: AiInteractionService | null = null
            const getAiService = (): AiInteractionService => {
                if (!aiService) throw new Error('AI interaction service is not initialized')
                return aiService
            }
            const editor = new ProseMirrorEditor({
                editorMountElement: editorContainer,
                content: html`<div></div>` as HTMLDivElement,
                initialVal: editorContent,
                isDisabled: true,
                documentType: 'assetConversation',
                threadId: panelThreadId,
                proseMirrorAuthority: {
                    organizationId: thread.organizationId!,
                    workspaceId,
                    assetId: panelThreadId,
                    role: 'conversation',
                    baseVersion: getStoredProseMirrorVersion(thread),
                    receiveOnly: true,
                },
                aiChatThreadRenderContext: {
                    contextPreview: getAiUserMessageContextPreviewRenderer(),
                    traceDetailsOptions: createCanvasTraceDetailsOptions(
                        'canvas-generated-media-trace-details workspace-ai-chat-panel-trace-details',
                        activeAiChatPanelTracePreviewTiles,
                    ),
                },
                onEditorChange: (value: any) => {
                    liveAiChatThreadContentOverrides.delete(panelThreadId)
                    rememberAiChatThreadContent(panelThreadId, value)
                    onAiChatThreadContentChange?.({ workspaceId, threadId: panelThreadId, content: value })
                    refreshBranchMarkersForAiChatThread(panelThreadId)
                    refreshGeneratedMediaProjectionsForAiChatThread(panelThreadId)
                },
                // Streamed AI tokens are dispatched with skipDispatch, so they never
                // reach onEditorChange or the store. Mirror the live doc into the
                // local cache/override and refresh so the marker's response preview
                // tracks the sliced tail token-by-token instead of only updating once finished.
                onStreamingUpdate: (value: any) => {
                    liveAiChatThreadContentOverrides.set(panelThreadId, value)
                    rememberAiChatThreadContent(panelThreadId, value)
                    refreshBranchMarkersForAiChatThread(panelThreadId)
                    refreshGeneratedMediaProjectionsForAiChatThread(panelThreadId)
                },
                onAiChatSubmit: async ({
                    messages,
                    aiReasoningModels,
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    imageOptions,
                    videoOptions,
                    referencedFeatureIds,
                }: any) => {
                    gradient?.triggerAnimation()

                    try {
                        // Explicit context chips are always force-included. The thread has
                        // no canvas node, so all context comes from the chips.
                        const chipNodeIds = aiChatPanelState.contextChips.slice()
                        const messagesWithContext = messages
                        // The branch-resolver snapshot is reused for video generation too —
                        // VEO image-to-video / reference-image inputs come from the same VLM
                        // resolution, so the snapshot must be built whenever an image OR
                        // video model is selected.
                        const hasMediaModel = Boolean(
                            imageOptions?.aiImageModels?.length
                            || videoOptions?.aiVideoModels?.length
                        )
                        const imagePlacement = rememberStandaloneGeneratedImagePlacement(panelThreadId, messages, hasMediaModel)
                        const mediaBranchCandidateSnapshot = imagePlacement.mediaBranchCandidateSnapshot

                        // Whole-workspace, descriptors-only index for the API relevance stage.
                        // Built every turn (text-only included); chips + the rooted thread's
                        // edge-connected nodes are flagged so the API can force-include them.
                        const workspaceContextSnapshot = currentCanvasState
                            ? buildWorkspaceContextSnapshot({
                                workspaceId,
                                conversationAssetId: panelThreadId ?? '',
                                prompt: imagePlacement.promptText,
                                nodes: currentCanvasState.nodes,
                                edges: currentCanvasState.edges,
                                contextChipNodeIds: chipNodeIds,
                                titlesByNodeId: buildWorkspaceContextTitlesByNodeId(currentCanvasState.nodes),
                            })
                            : undefined

                        // Resolve `sourceVideoNodeId` (set by the "Extend video in new
                        // thread" action) to an Asset ID. The API resolves the authorized
                        // organization Blob coordinate before VEO consumes
                        // this as its `video` (extension) input — see google-provider
                        // `runVeoGeneration` precedence: extension > first-frame > refs.
                        let videoSourceForExtension: string | undefined
                        if (videoOptions?.sourceVideoNodeId) {
                            const sourceVideoNode = currentCanvasState?.nodes.find(
                                (n: CanvasNode) => n.nodeId === videoOptions.sourceVideoNodeId && n.type === 'video'
                            ) as VideoCanvasNode | undefined
                            if (sourceVideoNode?.assetId) {
                                videoSourceForExtension = sourceVideoNode.assetId
                            }
                        }

                        await getAiService().sendChatMessage({
                            messages: messagesWithContext,
                            aiReasoningModels: aiReasoningModels ?? [],
                            useMultipleReasoningModels,
                            useMultipleImageModels,
                            useMultipleVideoModels,
                            aiImageModels: imageOptions?.aiImageModels,
                            imageSize: imageOptions?.imageGenerationSize,
                            imageConfigGroups: imageOptions?.configGroups,
                            aiVideoModels: videoOptions?.aiVideoModels,
                            videoAspectRatio: videoOptions?.videoAspectRatio,
                            videoResolution: videoOptions?.videoResolution,
                            videoDuration: videoOptions?.videoDuration,
                            videoConfigGroups: videoOptions?.configGroups,
                            videoSourceForExtension,
                            referencedFeatureIds,
                            mediaBranchCandidateSnapshot,
                            workspaceContextSnapshot,
                            canvasVisibleArea: getCanvasVisibleAreaForApiProjection(),
                        })
                        clearExplicitContextChips()
                    } catch (error) {
                        console.error('Failed to gather AI chat context:', error)
                        throw error
                    }
                },
                onAiChatStop: () => {
                    void getAiService().stopChatMessage()
                },
                onPromptSubmit: () => {},
                promptControlFactories,
                onReceivingStateChange: (threadId: string, receiving: boolean) => {
                    promptInputController.setReceiving(threadId, receiving)
                    if (threadId !== panelThreadId) return
                    if (receiving) {
                        projectionContainer.classList.add('workspace-ai-chat-panel-body-pane-hidden')
                        editorContainer.classList.remove('workspace-ai-chat-panel-body-pane-hidden')
                        return
                    }
                    requestAnimationFrame(() => refreshActiveAiChatPanelProjectionTarget(threadId))
                }
            })

            aiService = new AiInteractionService({
                workspaceId,
                conversationAssetId: panelThreadId,
                organizationId: thread.organizationId,
            })
            threadEditors.set(panelThreadId, {
                editor,
                aiService,
                containerEl: panelEl,
                gradientCleanup: gradient?.destroy,
                triggerGradientAnimation: () => {
                    gradient?.triggerAnimation()
                },
            })
            promptInputController.registerThreadEditor(panelThreadId, {
                editorView: editor.editorView,
                triggerGradientAnimation: () => {
                    gradient?.triggerAnimation()
                },
            })
        }
        } else {
            // Features / Media surface: host the framework-agnostic media library
            // renderer in the panel body, below the top-level mode switch.
            const mediaHost = html`<div className="workspace-right-panel-media-host"></div>` as HTMLDivElement
            panelEl.appendChild(mediaHost)
            const mediaLibrary = ensureMediaLibraryPanel()
            // Set the surface before mounting so it loads once for the right mode
            // instead of loading `features` then reloading `media`.
            mediaLibrary.setMode(topLevelMode === 'media' ? 'media' : 'features')
            mediaLibrary.mountInto(mediaHost)
        }

        // AI-thread editors are torn down when leaving the threads surface; detach
        // the media renderer when the threads surface is active so its NATS event
        // handlers stop reloading a hidden, detached body.
        if (showingAiThreads) mediaLibraryPanelInstance?.unmount()

        activeRightSidePanel = ensureActiveRightSidePanel()
        const resizeHandle = activeRightSidePanel.element
        panelEl.appendChild(resizeHandle)

        activeAiChatPanelEl = panelEl
        activeAiChatPanelThreadId = panelThreadId
        activeAiChatPanelHadContent = hasContent
        activeRightPanelRenderedMode = topLevelMode
        if (shouldAnimateOpen) {
            activeOpeningRightSidePanel = activeRightSidePanel
            activeRightSidePanel.prepareOpen(panelEl)
        } else {
            activeRightSidePanel.mountOpen(panelEl)
        }
        if (activeRightSidePanel.overlayElement) paneEl.appendChild(activeRightSidePanel.overlayElement)
        paneEl.appendChild(activeRightSidePanel.backdropElement)
        paneEl.appendChild(panelEl)

        if (activeRightSidePanel.getRawWidth() !== null) {
            reflectRightSidePanelWidth(activeRightSidePanel.getWidth())
        }

        if (shouldAnimateOpen) {
            void playRightSidePanelOpen(activeRightSidePanel, panelEl)
        }
        hasRenderedInitialAiChatPanelState = true

        // Synchronous body is done; allow resizes again. The rAF below still skips
        // the mode-switch resize when it was preserved so the slide finishes clean.
        suppressModeSwitchResize = false

        requestAnimationFrame(() => {
            resizeActiveAiChatPanelTabsSwitch()
            // Resizing re-lays out the indicator at its target; skip it when the
            // switch is mid-slide (preserved) so the animation isn't snapped.
            if (!preservedModeSwitchEl) resizeActiveRightPanelModeSwitch()
            if (tabsEl) tabsEl.scrollLeft = tabsInitialScrollLeft
        })
    }

    // Screen-fixed, canvas-wide composer at the bottom-center of the viewport.
    // Reuses the shared aiPromptComposer component (same one the right side panel uses)
    // but renders the submitted message as a branch marker instead of opening the
    // right side panel.
    function createGlobalCanvasComposer(): void {
        if (globalCanvasComposer || globalCanvasComposerHostEl) return

        // The composer's draft (text + selected models) is persisted to
        // localStorage — NOT canvas state. Routing it through canvas state would
        // call the host's persist path, which overwrites the saved viewport with
        // the host's current (default, at init) viewport and clobber the zoom.
        // localStorage is fully decoupled from canvas state, so it can never do that.
        const globalComposerDraftKey = `lixpi:canvas-global-composer-draft:${workspaceId}`
        const readGlobalComposerDraft = (): object => {
            try {
                const raw = localStorage.getItem(globalComposerDraftKey)
                return raw ? JSON.parse(raw) : {}
            } catch {
                return {}
            }
        }
        const hostEl = html`<div className="workspace-canvas-global-composer-host nopan"></div>` as HTMLDivElement
        const contextTrayEl = createCanvasGlobalContextTrayElement()
        globalCanvasComposer = createAiPromptComposer({
            className: 'workspace-canvas-global-composer',
            controlFactories: createDefaultPromptControlFactories(),
            initialContent: readGlobalComposerDraft(),
            onContentChange: (value: object) => {
                try {
                    localStorage.setItem(globalComposerDraftKey, JSON.stringify(value))
                } catch {
                    // Ignore quota/availability errors — draft persistence is best-effort.
                }
            },
            onSubmit: (data) => { void submitCanvasGenerationRun(data) },
        })

        const hostStyle = {
            position: 'absolute' as const,
            left: '50%',
            bottom: '24px',
            transform: 'translateX(-50%)',
            width: '760px',
            maxWidth: 'calc(100% - 48px)',
            zIndex: '9990',
        }
        applyStyle(hostEl, hostStyle)
        hostEl.appendChild(contextTrayEl)
        hostEl.appendChild(globalCanvasComposer.element)
        globalCanvasComposerHostEl = hostEl
        paneEl.appendChild(hostEl)
        refreshContextChipTray()
    }

    function ensureDetachedAiChatThreadHostElement(): HTMLDivElement {
        if (detachedAiChatThreadHostEl) return detachedAiChatThreadHostEl

        const hostStyle = {
            position: 'absolute' as const,
            left: '-10000px',
            top: '-10000px',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            pointerEvents: 'none' as const,
            opacity: '0',
        }
        detachedAiChatThreadHostEl = html`
            <div className="workspace-detached-ai-chat-thread-host" style=${hostStyle}></div>
        ` as HTMLDivElement
        paneEl.appendChild(detachedAiChatThreadHostEl)
        return detachedAiChatThreadHostEl
    }

    function destroyDetachedAiChatThreadEditor(threadId: string): void {
        const entry = detachedAiChatThreadEditors.get(threadId)
        if (!entry) return

        entry.editor?.destroy?.()
        entry.aiService?.disconnect?.()
        promptInputController.unregisterThreadEditor(threadId)
        entry.containerEl.remove()
        detachedAiChatThreadEditors.delete(threadId)
    }

    function teardownDetachedCanvasRun(threadId: string): void {
        const teardown = activeCanvasRunTeardownsByThread.get(threadId)
        if (teardown) {
            activeCanvasRunTeardowns.delete(teardown)
            activeCanvasRunTeardownsByThread.delete(threadId)
        }
        activeCanvasRunIds.delete(threadId)
        activeCanvasRunServices.delete(threadId)
        promptInputController.setReceiving(threadId, false)
        destroyDetachedAiChatThreadEditor(threadId)
    }

    function scheduleDetachedCanvasRunTeardown(threadId: string): void {
        window.setTimeout(() => {
            teardownDetachedCanvasRun(threadId)
        }, 1500)
    }

    function settleDetachedCanvasRun(threadId: string): void {
        settledDetachedCanvasRunThreadIds.add(threadId)
        activeCanvasRunIds.delete(threadId)
        promptInputController.setReceiving(threadId, false)
    }

    function createDetachedCanvasThreadEditor({
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
    }): AiChatThreadEditorEntry {
        const threadId = thread.threadId
        // A reattach triggered by a workspace-state update can race the submit
        // path and create an editor for the same thread first. Two live editors
        // for one thread double-handle every pipeline event (duplicate markers,
        // run bookkeeping consumed twice), so the newest creation owns the slot
        // and any existing instance is destroyed before mounting.
        destroyDetachedAiChatThreadEditor(threadId)
        const host = ensureDetachedAiChatThreadHostElement()
        const containerEl = html`
            <div className="workspace-detached-ai-chat-thread-instance"></div>
        ` as HTMLDivElement
        host.appendChild(containerEl)

        let aiService: AiInteractionService | null = null
        const getAiService = (): AiInteractionService => {
            if (!aiService) throw new Error('AI interaction service is not initialized')
            return aiService
        }

        const editor = new ProseMirrorEditor({
            editorMountElement: containerEl,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: thread.content,
            isDisabled: false,
            documentType: 'assetConversation',
            threadId,
            proseMirrorAuthority: {
                organizationId: thread.organizationId!,
                workspaceId,
                assetId: threadId,
                role: 'conversation',
                baseVersion: getStoredProseMirrorVersion(thread),
                receiveOnly: true,
            },
            aiChatThreadRenderContext: {
                contextPreview: getAiUserMessageContextPreviewRenderer(),
            },
            onEditorChange: (value: any) => {
                liveAiChatThreadContentOverrides.delete(threadId)
                rememberAiChatThreadContent(threadId, value)
                onAiChatThreadContentChange?.({ workspaceId, threadId, content: value })
                refreshBranchMarkersForAiChatThread(threadId)
                refreshGeneratedMediaProjectionsForAiChatThread(threadId)
            },
            // Streamed AI tokens are dispatched with skipDispatch, so they never
            // reach onEditorChange or the store. Mirror the live doc into the
            // local cache/override and refresh so the marker's response preview
            // tracks the sliced tail token-by-token instead of only updating once finished.
            onStreamingUpdate: (value: any) => {
                liveAiChatThreadContentOverrides.set(threadId, value)
                rememberAiChatThreadContent(threadId, value)
                refreshBranchMarkersForAiChatThread(threadId)
                refreshGeneratedMediaProjectionsForAiChatThread(threadId)
            },
            onAiChatSubmit: async ({
                messages,
                aiReasoningModels,
                useMultipleReasoningModels,
                useMultipleImageModels,
                useMultipleVideoModels,
                imageOptions,
                videoOptions,
                referencedFeatureIds,
            }: any) => {
                try {
                    if (!submittedData) return

                    const currentDoc = editor.editorView?.state?.doc
                    if (currentDoc?.toJSON) {
                        onAiChatThreadContentChange?.({ workspaceId, threadId, content: currentDoc.toJSON() })
                        refreshBranchMarkersForAiChatThread(threadId)
                    }

                    const excludedCanvasNodeIdSet = new Set(excludedCanvasNodeIds)
                    const nodes = (currentCanvasState?.nodes ?? [])
                        .filter(node => !excludedCanvasNodeIdSet.has(node.nodeId))
                    const edges = (currentCanvasState?.edges ?? [])
                        .filter(edge => !excludedCanvasNodeIdSet.has(edge.sourceNodeId)
                            && !excludedCanvasNodeIdSet.has(edge.targetNodeId))
                    const promptText = getPromptTextFromMessages(messages)
                    const explicitMediaReferenceNodeIds = getExistingMediaNodeIds(
                        explicitContextNodeIds.filter(nodeId => !excludedCanvasNodeIdSet.has(nodeId))
                    )
                    const hasMediaModel = Boolean(
                        imageOptions?.aiImageModels?.length
                        || videoOptions?.aiVideoModels?.length
                    )

                    const mediaBranchCandidateSnapshot = hasMediaModel
                        ? buildCanvasWideCandidateSnapshot({
                            generationRunId: threadId,
                            nodes,
                            prompt: promptText,
                            referenceNodeIds: explicitMediaReferenceNodeIds,
                        })
                        : undefined

                    const workspaceContextSnapshot = currentCanvasState
                        ? buildWorkspaceContextSnapshot({
                            workspaceId,
                            conversationAssetId: threadId,
                            prompt: promptText,
                            nodes,
                            edges,
                            contextChipNodeIds: explicitContextNodeIds
                                .filter(nodeId => !excludedCanvasNodeIdSet.has(nodeId)),
                            titlesByNodeId: buildWorkspaceContextTitlesByNodeId(nodes),
                        })
                        : undefined

                    if (mediaBranchCandidateSnapshot) {
                        const candidateNodeIds = explicitMediaReferenceNodeIds.length > 0
                            ? explicitMediaReferenceNodeIds
                            : mediaBranchCandidateSnapshot.candidates.map((candidate) => candidate.nodeId)
                        pendingGeneratedImagePlacements.set(threadId, {
                            referenceNodeIds: candidateNodeIds,
                            promptText,
                            mediaBranchCandidateSnapshot,
                            createdAt: Date.now(),
                        })
                        setGeneratingReferenceNodeIds(threadId, candidateNodeIds)
                        if (regeneration?.mode === 'existing-prompt') {
                            branchMarkerUiPhaseByNodeId.set(regeneration.lineageParentNodeId, 'preflight')
                            syncBranchMarkerNodeContents()
                        } else {
                            insertPendingBranchMarkerForCanvasRun(threadId, promptText, submittedData)
                        }
                    }

                    const messagesWithContext = messages

                    let videoSourceForExtension: string | undefined
                    if (videoOptions?.sourceVideoNodeId) {
                        const sourceVideoNode = currentCanvasState?.nodes.find(
                            (node: CanvasNode) => node.nodeId === videoOptions.sourceVideoNodeId && node.type === 'video'
                        ) as VideoCanvasNode | undefined
                        if (sourceVideoNode?.assetId) {
                            videoSourceForExtension = sourceVideoNode.assetId
                        }
                    }

                    await getAiService().sendChatMessage({
                        messages: messagesWithContext,
                        aiReasoningModels: aiReasoningModels ?? [],
                        useMultipleReasoningModels,
                        useMultipleImageModels,
                        useMultipleVideoModels,
                        aiImageModels: imageOptions?.aiImageModels,
                        imageSize: imageOptions?.imageGenerationSize,
                        imageConfigGroups: imageOptions?.configGroups,
                        aiVideoModels: videoOptions?.aiVideoModels,
                        videoAspectRatio: videoOptions?.videoAspectRatio,
                        videoResolution: videoOptions?.videoResolution,
                        videoDuration: videoOptions?.videoDuration,
                        videoConfigGroups: videoOptions?.configGroups,
                        regeneration,
                        videoSourceForExtension,
                        referencedFeatureIds,
                        mediaBranchCandidateSnapshot,
                        workspaceContextSnapshot,
                        canvasVisibleArea: getCanvasVisibleAreaForApiProjection(),
                    })
                    clearExplicitContextChips()
                } catch (error) {
                    console.error('[CANVAS-RUN] failed to send detached canvas generation request', error)
                    teardownDetachedCanvasRun(threadId)
                    throw error
                }
            },
            onAiChatStop: () => {
                void getAiService().stopChatMessage()
            },
            onPromptSubmit: () => {},
            promptControlFactories: getPromptControlFactories(),
            onReceivingStateChange: (receivingThreadId: string, receiving: boolean) => {
                promptInputController.setReceiving(receivingThreadId, receiving)
                const currentDoc = editor.editorView?.state?.doc
                if (currentDoc?.toJSON) {
                    rememberAiChatThreadContent(receivingThreadId, currentDoc.toJSON())
                    refreshBranchMarkersForAiChatThread(receivingThreadId)
                    refreshGeneratedMediaProjectionsForAiChatThread(receivingThreadId)
                }
                if (!receiving && !pendingGeneratedImagePlacements.has(receivingThreadId)) {
                    scheduleDetachedCanvasRunTeardown(receivingThreadId)
                }
            },
        })

        aiService = new AiInteractionService({
            workspaceId,
            conversationAssetId: threadId,
            organizationId: thread.organizationId,
        })
        activeCanvasRunServices.set(threadId, aiService)
        const entry: AiChatThreadEditorEntry = {
            editor,
            aiService,
            containerEl,
        }
        detachedAiChatThreadEditors.set(threadId, entry)
        promptInputController.registerThreadEditor(threadId, {
            editorView: editor.editorView,
        })
        return entry
    }

    function ensureDetachedCanvasRunTeardown(threadId: string): void {
        if (activeCanvasRunTeardownsByThread.has(threadId)) return
        const teardown = () => teardownDetachedCanvasRun(threadId)
        activeCanvasRunTeardowns.add(teardown)
        activeCanvasRunTeardownsByThread.set(threadId, teardown)
    }

    function getActiveDetachedCanvasRunThreadIds(): string[] {
        const threadIds = new Set<string>()
        const threadsById = new Map(currentAiChatThreads.map((thread) => [thread.threadId, thread]))
        if (currentCanvasState) {
            for (const node of currentCanvasState.nodes) {
                if (!isBranchMarkerNode(node)) continue
                const threadId = getBranchMarkerThreadId(node)
                if (!isDetachedCanvasThreadId(threadId)) continue
                if (settledDetachedCanvasRunThreadIds.has(threadId)) continue
                const thread = threadsById.get(threadId)
                if (!thread) continue
                if (!isBranchMarkerGenerationActive(node) && !aiChatThreadHasInProgressContent(thread)) continue
                threadIds.add(threadId)
            }
        }

        for (const thread of currentAiChatThreads) {
            if (!isDetachedCanvasThreadId(thread.threadId)) continue
            if (settledDetachedCanvasRunThreadIds.has(thread.threadId)) continue
            if (thread.owner?.type !== 'standalone') continue
            if (hasDetachedCanvasRunCanvasProjection(thread.threadId)) continue
            if (!isRecentDetachedCanvasThreadUpdate(thread)) continue
            if (!aiChatThreadHasRecoverableDetachedCanvasTurn(thread)) continue
            threadIds.add(thread.threadId)
        }
        return [...threadIds]
    }

    function reattachDetachedCanvasRunListenersForActiveMarkers(): void {
        restoreDetachedCanvasPreflightMarkersForActiveThreads()
        for (const threadId of getActiveDetachedCanvasRunThreadIds()) {
            if (activeCanvasRunIds.has(threadId)) continue
            if (detachedAiChatThreadEditors.has(threadId)) continue
            const thread = getPersistedAiChatThread(threadId)
            if (!thread) continue

            activeCanvasRunIds.add(threadId)
            ensureDetachedCanvasRunTeardown(threadId)
            promptInputController.setReceiving(threadId, true)
            createDetachedCanvasThreadEditor({ thread })
        }
    }

    function submitPersistedDetachedCanvasThreadMessage(threadId: string): void {
        const entry = detachedAiChatThreadEditors.get(threadId)
        const editorView = entry?.editor.editorView
        if (!editorView) return

        let nodePos: number | undefined
        editorView.state.doc.descendants((node: any, pos: number) => {
            if (node.type?.name === 'aiChatThread' && node.attrs?.threadId === threadId) {
                nodePos = pos
                return false
            }
            return true
        })
        if (nodePos === undefined) return

        editorView.dispatch(editorView.state.tr.setMeta(USE_AI_CHAT_META, { threadId, nodePos }))
    }

    // Runs a detached, canvas-wide generation as a standalone ProseMirror-backed
    // message instance. The editor is hidden because the canvas marker is the
    // visible projection, but storage/stream parsing/persistence stays on the same
    // aiChatThreadPlugin path as the panel.
    async function submitCanvasGenerationRun(
        data: AiPromptComposerSubmitData,
        options: {
            explicitContextNodeIds?: string[]
            excludedCanvasNodeIds?: string[]
            regeneration?: NonNullable<AiInteractionMediaGenerationRequest['regeneration']>
        } = {},
    ): Promise<void> {
        if (!data.aiReasoningModels[0]) {
            console.error('[CANVAS] Cannot submit generation without a reasoning model.')
            return
        }
        const promptText = extractPromptTextFromContentJSON(data.contentJSON)
        if (!promptText) return

        const threadId = uuidv4()
        const explicitContextNodeIds = options.explicitContextNodeIds ?? aiChatPanelState.contextChips.slice()
        const useMultipleReasoningModels = Boolean(data.useMultipleReasoningModels)
        const useMultipleImageModels = Boolean(data.useMultipleImageModels)
        const useMultipleVideoModels = Boolean(data.useMultipleVideoModels)
        const collapseForMode = (models: string[], useMultiple: boolean): string[] =>
            useMultiple ? models : models.slice(0, 1)
        const aiReasoningModels = serializeAiModelSelectionAttr(collapseForMode(data.aiReasoningModels, useMultipleReasoningModels))
        const aiImageModels = data.imageOptions
            ? serializeAiModelSelectionAttr(collapseForMode(data.imageOptions.aiImageModels, useMultipleImageModels))
            : ''
        const aiVideoModels = data.videoOptions
            ? serializeAiModelSelectionAttr(collapseForMode(data.videoOptions.aiVideoModels, useMultipleVideoModels))
            : ''
        const imageGenerationConfigGroups = data.imageOptions
            ? serializeMediaGenerationConfigSelectionAttr(useMultipleImageModels ? data.imageOptions.configGroups ?? [] : [])
            : ''
        const videoGenerationConfigGroups = data.videoOptions
            ? serializeMediaGenerationConfigSelectionAttr(useMultipleVideoModels ? data.videoOptions.configGroups ?? [] : [])
            : ''
        const initialContent = {
            type: 'doc',
            content: [
                {
                    type: 'aiChatThread',
                    attrs: {
                        threadId,
                        aiReasoningModels,
                        useMultipleReasoningModels,
                        useMultipleImageModels,
                        useMultipleVideoModels,
                        ...(aiImageModels ? { aiImageModels } : {}),
                        ...(data.imageOptions?.imageGenerationSize ? { imageGenerationSize: data.imageOptions.imageGenerationSize } : {}),
                        ...(imageGenerationConfigGroups ? { imageGenerationConfigGroups } : {}),
                        ...(aiVideoModels ? { aiVideoModels } : {}),
                        ...(data.videoOptions?.videoAspectRatio ? { videoAspectRatio: data.videoOptions.videoAspectRatio } : {}),
                        ...(data.videoOptions?.videoResolution ? { videoResolution: data.videoOptions.videoResolution } : {}),
                        ...(data.videoOptions?.videoDuration ? { videoDuration: data.videoOptions.videoDuration } : {}),
                        ...(videoGenerationConfigGroups ? { videoGenerationConfigGroups } : {}),
                    },
                    content: [{
                        type: 'aiUserMessage',
                        attrs: { id: `msg-${uuidv4()}`, createdAt: Date.now(), referenceNodeIds: explicitContextNodeIds },
                        content: data.contentJSON.length > 0 ? data.contentJSON : [{ type: 'paragraph' }],
                    }],
                },
            ],
        }
        settledDetachedCanvasRunThreadIds.delete(threadId)
        activeCanvasRunIds.add(threadId)
        ensureDetachedCanvasRunTeardown(threadId)
        promptInputController.setReceiving(threadId, true)
        try {
            const asset = await assetService.create({
                organizationId: workspaceStore.getData('organizationId'),
                workspaceId,
                title: promptText,
                primaryCategory: 'conversation',
                assetId: threadId,
                initialDoc: initialContent,
            })
            const thread = {
                threadId: asset.assetId,
                assetId: asset.assetId,
                organizationId: asset.organizationId,
                workspaceId,
                content: initialContent,
                proseMirrorVersion: asset.documents.conversation?.version ?? 0,
                aiModel: data.aiReasoningModels[0] ?? '',
                title: asset.title,
                status: asset.states.conversation,
                createdAt: asset.createdAt,
                updatedAt: asset.updatedAt,
            } as AiChatThread
            if (!thread) {
                teardownDetachedCanvasRun(threadId)
                return
            }

            currentAiChatThreads = currentAiChatThreads.some((existing) => existing.threadId === threadId)
                ? currentAiChatThreads.map((existing) => existing.threadId === threadId ? thread : existing)
                : [...currentAiChatThreads, thread]
            createDetachedCanvasThreadEditor({
                thread,
                submittedData: data,
                explicitContextNodeIds,
                excludedCanvasNodeIds: options.excludedCanvasNodeIds,
                regeneration: options.regeneration,
            })
            promptInputController.setTarget({
                nodeId: `standalone:${threadId}`,
                type: 'aiChatThread',
                assetId: threadId,
            })
            submitPersistedDetachedCanvasThreadMessage(threadId)
        } catch (error) {
            console.error('[CANVAS-RUN] failed to submit detached canvas generation request', error)
            teardownDetachedCanvasRun(threadId)
        }
    }

    // Set up callbacks for AI-generated images
    type PendingGeneratedImagePlacement = {
        placementAnchorNodeId?: string
        referenceNodeIds?: string[]
        lineagePlan?: MediaBranchLineagePlan
        promptText: string
        mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot
        mediaBranchResolution?: MediaBranchVlmResolution
        activeRunKeys?: Set<string>
        createdAt: number
    }

    type PendingBranchMarkerLineageSpec = {
        assignment?: MediaRunLineageAssignment
        generationRun?: MediaGenerationRunMeta
        pendingState: NonNullable<BranchMarkerNode['pendingState']>
    }

    const pendingGeneratedImagePlacements = new Map<string, PendingGeneratedImagePlacement>()
    const pendingBranchMarkers = new Map<string, PendingBranchMarkerRecord>()

    // Explicit branch-marker UI phase, driven by media pipeline events instead of
    // ProseMirror receiving flags. ProseMirror's isReceivingAnimation stays true for
    // the whole media workflow, so it cannot distinguish "visible assistant text is
    // streaming" from "text is done but the media placeholder has not appeared yet".
    // Keyed by marker nodeId so the phase survives incoming workspace-state
    // replacements that drop the marker's transient pendingState.
    type BranchMarkerUiPhase = 'preflight' | 'planned-awaiting-media' | 'media-placeholder'
    const branchMarkerUiPhaseByNodeId = new Map<string, BranchMarkerUiPhase>()

    function isBranchMarkerGenerationCancelled(node: BranchMarkerNode): boolean {
        return Boolean(
            node.generationRequestId
            && cancelledMediaGenerationRequestIds.has(node.generationRequestId)
        )
    }

    function getBranchMarkerUiPhase(node: BranchMarkerNode): BranchMarkerUiPhase | undefined {
        if (isBranchMarkerGenerationCancelled(node)) return undefined
        if (hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)) return 'media-placeholder'
        const trackedPhase = branchMarkerUiPhaseByNodeId.get(node.nodeId)
        if (trackedPhase) return trackedPhase
        // Markers restored without a tracked phase (e.g. after a reload) fall back
        // to the persisted pendingState phase.
        if (node.pendingState?.phase === 'preflight') return 'preflight'
        if (node.pendingState?.phase === 'planned') return 'planned-awaiting-media'
        return undefined
    }

    function isBranchMarkerPendingForUi(node: BranchMarkerNode): boolean {
        if (isBranchMarkerGenerationCancelled(node)) return false
        const uiPhase = getBranchMarkerUiPhase(node)
        return uiPhase === 'preflight' || uiPhase === 'planned-awaiting-media'
    }

    function getBranchMarkerUiPhaseNodeIdsForRun(threadId: string, generationRun?: MediaGenerationRunMeta): string[] {
        const nodeIds = new Set<string>()
        const record = getPendingBranchMarkerRecord(threadId, generationRun)
        if (record) nodeIds.add(record.nodeId)
        const assignment = getApiMediaRunLineageAssignment(generationRun)
        for (const nodeId of [
            assignment?.lineageParentNodeId,
            assignment?.branchOriginNodeId,
            assignment?.branchForkNodeId,
            assignment?.branchLineNodeId,
        ]) {
            if (nodeId) nodeIds.add(nodeId)
        }
        return [...nodeIds]
    }

    // Overwrite-only: markers without a tracked pending phase already render as
    // committed, so 'media-placeholder' only needs to displace an earlier pending
    // phase once the generated-media placeholder/tracker owns the visible progress.
    function markBranchMarkerRunMediaPlaceholderPhase(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        for (const nodeId of getBranchMarkerUiPhaseNodeIdsForRun(threadId, generationRun)) {
            if (branchMarkerUiPhaseByNodeId.has(nodeId)) branchMarkerUiPhaseByNodeId.set(nodeId, 'media-placeholder')
        }
    }

    function clearBranchMarkerUiPhasesForRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        for (const nodeId of getBranchMarkerUiPhaseNodeIdsForRun(threadId, generationRun)) {
            branchMarkerUiPhaseByNodeId.delete(nodeId)
        }
    }

    function getGeneratedMediaPlacementKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.generationRequestId
            ? `${threadId}:${generationRun.generationRequestId}`
            : threadId
    }

    function getGeneratedMediaRunKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.mediaRunId
            ?? generationRun?.lineageAssignment?.mediaRunId
            ?? generationRun?.reasoningRunId
            ?? threadId
    }

    function getPendingBranchMarkerReasoningModelKey(placementKey: string, reasoningModelId: string): string {
        return `${placementKey}:reasoning-model:${reasoningModelId}`
    }

    function getPendingBranchMarkerReasoningRunKey(placementKey: string, reasoningRunId: string): string {
        return `${placementKey}:reasoning-run:${reasoningRunId}`
    }

    function getPendingBranchMarkerReasoningIndexKey(placementKey: string, reasoningIndex: number): string {
        return `${placementKey}:reasoning-index:${reasoningIndex}`
    }

    function getPendingBranchMarkerBranchNodeKey(placementKey: string, markerNodeId: string): string {
        return `${placementKey}:marker:${markerNodeId}`
    }

    function hasPendingBranchMarkerForPlacement(placementKey: string): boolean {
        const placementPrefix = `${placementKey}:`
        for (const key of pendingBranchMarkers.keys()) {
            if (key === placementKey || key.startsWith(placementPrefix)) return true
        }
        return false
    }

    function hasCanvasBranchMarkerForPlacement(placementKey: string): boolean {
        if (!currentCanvasState) return false

        const [threadId, generationRequestId] = placementKey.split(':')
        const placementIds = new Set<string>(
            [placementKey, threadId, generationRequestId].filter((value): value is string => Boolean(value)),
        )
        return currentCanvasState.nodes.some((node: CanvasNode) => {
            if (!isBranchMarkerNode(node)) return false
            return placementIds.has(getBranchMarkerThreadId(node)) || placementIds.has(node.generationRequestId)
        })
    }

    function addUniquePendingBranchMarkerKey(keys: string[], key: string | undefined): void {
        if (!key || keys.includes(key)) return
        keys.push(key)
    }

    function getPendingBranchMarkerSpecificKeys(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): string[] {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        const keys: string[] = []
        addUniquePendingBranchMarkerKey(
            keys,
            generationRun?.reasoningRunId
                ? getPendingBranchMarkerReasoningRunKey(placementKey, generationRun.reasoningRunId)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.reasoningRunId
                ? getPendingBranchMarkerReasoningRunKey(placementKey, lineageAssignment.reasoningRunId)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            generationRun?.reasoningIndex != null
                ? getPendingBranchMarkerReasoningIndexKey(placementKey, generationRun.reasoningIndex)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.branchForkNodeId
                ? getPendingBranchMarkerBranchNodeKey(placementKey, lineageAssignment.branchForkNodeId)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.branchLineNodeId
                ? getPendingBranchMarkerBranchNodeKey(placementKey, lineageAssignment.branchLineNodeId)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.branchOriginNodeId
                ? getPendingBranchMarkerBranchNodeKey(placementKey, lineageAssignment.branchOriginNodeId)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            generationRun?.reasoningModelId
                ? getPendingBranchMarkerReasoningModelKey(placementKey, generationRun.reasoningModelId)
                : undefined
        )
        addUniquePendingBranchMarkerKey(
            keys,
            lineageAssignment?.reasoningModelId
                ? getPendingBranchMarkerReasoningModelKey(placementKey, lineageAssignment.reasoningModelId)
                : undefined
        )
        return keys
    }

    function findPendingBranchMarkerRecordByReasoningModel(
        placementKey: string,
        reasoningModelId: string | undefined,
    ): PendingBranchMarkerRecord | undefined {
        if (!reasoningModelId) return undefined
        const normalizedReasoningModelId = normalizeBranchMarkerModelValue(reasoningModelId)
        const placementPrefix = `${placementKey}:`
        for (const [key, record] of pendingBranchMarkers.entries()) {
            if (key !== placementKey && !key.startsWith(placementPrefix)) continue
            if (normalizeBranchMarkerModelValue(record.reasoningModelId) === normalizedReasoningModelId) return record
        }
        return undefined
    }

    function findPendingBranchMarkerRecordByReasoningIndex(
        placementKey: string,
        reasoningIndex: number | undefined,
    ): PendingBranchMarkerRecord | undefined {
        if (reasoningIndex == null) return undefined
        return pendingBranchMarkers.get(getPendingBranchMarkerReasoningIndexKey(placementKey, reasoningIndex))
    }

    function pendingBranchMarkerRecordMatchesGenerationRun(
        record: PendingBranchMarkerRecord,
        generationRun: MediaGenerationRunMeta | undefined,
    ): boolean {
        if (!generationRun) return true
        if (record.reasoningIndex != null && generationRun.reasoningIndex != null) {
            return record.reasoningIndex === generationRun.reasoningIndex
        }
        if (record.reasoningModelId && generationRun.reasoningModelId) {
            return normalizeBranchMarkerModelValue(record.reasoningModelId) === normalizeBranchMarkerModelValue(generationRun.reasoningModelId)
        }
        return !record.reasoningModelId && record.reasoningIndex == null
    }

    function createPendingBranchMarkerRecordFromCanvasNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        node: BranchMarkerNode,
    ): PendingBranchMarkerRecord {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        const runNode = node as Partial<BranchForkCanvasNode & BranchLineCanvasNode>
        const reasoningModelId = node.pendingState?.reasoningModelId
            ?? runNode.reasoningModelId
            ?? generationRun?.reasoningModelId
            ?? lineageAssignment?.reasoningModelId
        const reasoningIndex = node.pendingState?.reasoningIndex
            ?? runNode.reasoningIndex
            ?? generationRun?.reasoningIndex
        return {
            nodeId: node.nodeId,
            placementKey,
            threadId: getBranchMarkerThreadId(node) || threadId,
            ...(reasoningModelId ? { reasoningModelId } : {}),
            ...(reasoningIndex == null ? {} : { reasoningIndex }),
        }
    }

    function recoverPendingBranchMarkerRecordFromCanvasState(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerRecord | undefined {
        if (!currentCanvasState) return undefined

        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const candidates = currentCanvasState.nodes.filter((node: CanvasNode): node is BranchMarkerNode =>
            isBranchMarkerNode(node)
            && Boolean(node.pendingState)
            && getBranchMarkerThreadId(node) === threadId
        )
        if (candidates.length === 0) return undefined

        const lineageNodeIds = new Set([
            lineageAssignment?.branchForkNodeId,
            lineageAssignment?.branchLineNodeId,
            lineageAssignment?.branchOriginNodeId,
        ].filter((nodeId): nodeId is string => Boolean(nodeId)))
        const matchingLineageNode = lineageNodeIds.size > 0
            ? candidates.find(node => lineageNodeIds.has(node.nodeId))
            : undefined
        const matchingRunNode = candidates.find((node) => {
            const runNode = node as Partial<BranchForkCanvasNode & BranchLineCanvasNode>
            return Boolean(
                (generationRun?.reasoningRunId && runNode.reasoningRunId === generationRun.reasoningRunId)
                || (lineageAssignment?.reasoningRunId && runNode.reasoningRunId === lineageAssignment.reasoningRunId)
                || (generationRun?.mediaRunId && runNode.mediaRunId === generationRun.mediaRunId)
                || (lineageAssignment?.mediaRunId && runNode.mediaRunId === lineageAssignment.mediaRunId)
            )
        })
        const matchingReasoningIndex = generationRun?.reasoningIndex == null
            ? undefined
            : candidates.find(node => node.pendingState?.reasoningIndex === generationRun.reasoningIndex)
        const matchingReasoningModel = generationRun?.reasoningModelId
            ? candidates.find(node =>
                normalizeBranchMarkerModelValue(node.pendingState?.reasoningModelId)
                    === normalizeBranchMarkerModelValue(generationRun.reasoningModelId)
            )
            : undefined
        const requestMatches = generationRun?.generationRequestId
            ? candidates.filter(node => node.generationRequestId === generationRun.generationRequestId)
            : []
        const matchingNode = matchingLineageNode
            ?? matchingRunNode
            ?? matchingReasoningIndex
            ?? matchingReasoningModel
            ?? (requestMatches.length === 1 ? requestMatches[0] : undefined)
            ?? (candidates.length === 1 ? candidates[0] : undefined)
        if (!matchingNode) return undefined

        const record = createPendingBranchMarkerRecordFromCanvasNode(threadId, generationRun, matchingNode)
        pendingBranchMarkers.set(placementKey, record)
        setPendingBranchMarkerRecordAliases(threadId, generationRun, record)
        return record
    }

    function setPendingBranchMarkerRecordAliases(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        record: PendingBranchMarkerRecord,
    ): void {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        for (const key of getPendingBranchMarkerSpecificKeys(threadId, generationRun)) {
            pendingBranchMarkers.set(key, { ...record, placementKey })
        }
    }

    function deletePendingBranchMarkerAliasesForNodeId(nodeId: string): void {
        for (const [key, record] of pendingBranchMarkers.entries()) {
            if (record.nodeId === nodeId) pendingBranchMarkers.delete(key)
        }
    }

    function deletePendingBranchMarkerAliasesForPlacement(placementKey: string): void {
        const placementPrefix = `${placementKey}:`
        for (const key of pendingBranchMarkers.keys()) {
            if (key === placementKey || key.startsWith(placementPrefix)) pendingBranchMarkers.delete(key)
        }
    }

    function cleanupBranchMarkerArtifacts(nodeIds: Iterable<string>): void {
        for (const nodeId of nodeIds) {
            deletePendingBranchMarkerAliasesForNodeId(nodeId)
            branchMarkerUiPhaseByNodeId.delete(nodeId)
            destroyBranchMarkerReasoningTooltip(nodeId)
            liveNodeOverrides.delete(nodeId)
            branchMarkerProjectionOverrideNodeIds.delete(nodeId)
            manuallyPositionedBranchMarkerNodeIds.delete(nodeId)
            for (const nodeEl of getBranchMarkerNodeEls(nodeId)) nodeEl.remove()
        }
    }

    function uniqueAiModelIds(modelIds: Array<string | undefined>): AiModelId[] {
        const seen = new Set<string>()
        const unique: AiModelId[] = []
        for (const modelId of modelIds) {
            const trimmed = modelId?.trim()
            if (!trimmed || seen.has(trimmed)) continue
            seen.add(trimmed)
            unique.push(trimmed as AiModelId)
        }
        return unique
    }

    function getPendingBranchMarkerModelState(
        data: AiPromptComposerSubmitData,
        promptText: string,
    ): NonNullable<BranchMarkerNode['pendingState']> {
        const reasoningModelIds = data.useMultipleReasoningModels
            ? uniqueAiModelIds(data.aiReasoningModels)
            : uniqueAiModelIds(data.aiReasoningModels.slice(0, 1))
        const imageModelIds = data.useMultipleImageModels
            ? uniqueAiModelIds(data.imageOptions?.aiImageModels ?? [])
            : uniqueAiModelIds((data.imageOptions?.aiImageModels ?? []).slice(0, 1))
        const videoModelIds = data.useMultipleVideoModels
            ? uniqueAiModelIds(data.videoOptions?.aiVideoModels ?? [])
            : uniqueAiModelIds((data.videoOptions?.aiVideoModels ?? []).slice(0, 1))
        return {
            phase: 'preflight',
            promptText,
            reasoningModelIds,
            imageModelIds,
            videoModelIds,
        }
    }

    function getPendingBranchMarkerModelStates(
        data: AiPromptComposerSubmitData,
        promptText: string,
    ): Array<NonNullable<BranchMarkerNode['pendingState']>> {
        const baseState = getPendingBranchMarkerModelState(data, promptText)
        const focusedReasoningModelIds: Array<AiModelId | undefined> = baseState.reasoningModelIds.length > 0
            ? baseState.reasoningModelIds
            : [undefined]
        return focusedReasoningModelIds.map((reasoningModelId, reasoningIndex) => ({
            ...baseState,
            reasoningModelIds: reasoningModelId ? [reasoningModelId] : [],
            ...(reasoningModelId ? { reasoningModelId } : {}),
            reasoningIndex,
        }))
    }

    function getSafeViewportZoom(viewport: Viewport): number {
        return Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
    }

    function getPendingBranchMarkerScreenProjection(
        dimensions: { width: number; height: number },
        stackOffsetY = 0,
        stackHeight = dimensions.height,
    ): { position: { x: number; y: number }; anchor: 'composer' | 'viewport-fallback' } {
        const paneBounds = paneRect ?? paneEl.getBoundingClientRect()
        const composerBounds = (globalCanvasComposer?.element ?? globalCanvasComposerHostEl)?.getBoundingClientRect()
        if (composerBounds && composerBounds.width > 0 && composerBounds.height > 0) {
            const inputGap = getPendingBranchMarkerInputGap()
            return {
                anchor: 'composer',
                position: {
                    x: composerBounds.right - paneBounds.left - dimensions.width,
                    y: composerBounds.top - paneBounds.top - stackHeight - inputGap + stackOffsetY,
                },
            }
        }

        return {
            anchor: 'viewport-fallback',
            position: {
                x: paneBounds.width - getBranchLineageNodeGap() - dimensions.width,
                y: paneBounds.height / 2 - stackHeight / 2 + stackOffsetY,
            },
        }
    }

    function getPendingBranchMarkerStackHeight(
        dimensions: Array<{ height: number }>,
    ): number {
        const stackGap = getPendingBranchMarkerInputGap()
        return dimensions.reduce(
            (height, entry, index) => height + entry.height + (index > 0 ? stackGap : 0),
            0,
        )
    }

    function getPendingBranchMarkerStackOffsets(
        dimensions: Array<{ height: number }>,
    ): number[] {
        const stackGap = getPendingBranchMarkerInputGap()
        let stackTopOffset = 0
        return dimensions.map((entry) => {
            const markerTopOffset = stackTopOffset
            stackTopOffset += entry.height + stackGap
            return markerTopOffset
        })
    }

    function applyPendingBranchMarkerScreenProjection(
        nodeId: string,
        dimensions: { width: number; height: number },
        stackOffsetY = 0,
        stackHeight = dimensions.height,
    ): void {
        const nodeEl = findBranchMarkerNodeEl(nodeId)
        if (!nodeEl) return

        // Lift the screen-fixed marker out of the viewport stacking context into
        // the high z-index overlay so generated media never paints over it.
        if (pendingBranchMarkerOverlayEl && nodeEl.parentElement !== pendingBranchMarkerOverlayEl) {
            pendingBranchMarkerOverlayEl.appendChild(nodeEl)
        }

        nodeEl.classList.add('workspace-branch-marker-screen-fixed')

        // The docked pill hugs its single-line content (no trailing dead space):
        // measure the intrinsic content width instead of a char-count heuristic, then
        // cap it so its on-screen width never exceeds 80% of the prompt input field —
        // beyond that the message truncates with an ellipsis.
        const composerBounds = (globalCanvasComposer?.element ?? globalCanvasComposerHostEl)?.getBoundingClientRect()
        applyStyle(nodeEl, { width: 'max-content', height: `${dimensions.height}px` })
        let dockedWidth = Math.max(getBranchMarkerScreenFixedMinWidth(), nodeEl.scrollWidth || dimensions.width)
        if (composerBounds && composerBounds.width > 0) {
            // Preflight markers are screen-space UI, not canvas chrome. Keep the
            // width cap independent from zoom; zoom only matters after promotion.
            const screenFixedMaxScreenWidth = composerBounds.width * settings.mediaBranchLineage.marker.screenFixedMaxWidthFraction
            dockedWidth = Math.min(dockedWidth, screenFixedMaxScreenWidth)
        }
        dockedWidth = Math.round(dockedWidth)

        const dockedDimensions = { width: dockedWidth, height: dimensions.height }
        const projection = getPendingBranchMarkerScreenProjection(dockedDimensions, stackOffsetY, stackHeight)
        const debugKey = `screen-fixed-marker-placement:${nodeId}:${projection.anchor}`
        if (!branchMarkerHandoffDebugKeys.has(debugKey)) {
            branchMarkerHandoffDebugKeys.add(debugKey)
            console.info('[CANVAS][branch-marker-handoff]', 'screen-fixed-marker-placement', {
                markerNodeId: nodeId,
                anchor: projection.anchor,
                x: projection.position.x,
                y: projection.position.y,
                width: dockedWidth,
                height: dimensions.height,
                stackOffsetY,
                stackHeight,
            })
        }
        applyStyle(nodeEl, {
            left: `${projection.position.x}px`,
            top: `${projection.position.y}px`,
            width: `${dockedWidth}px`,
            height: `${dimensions.height}px`,
            transform: 'none',
            // Keep preflight markers above the canvas and composer overlays while
            // they are screen-fixed.
            zIndex: '9991',
        })
    }

    function syncPendingBranchMarkerScreenPlacements(): void {
        if (!currentCanvasState) return
        const branchMarkersById = new Map(
            currentCanvasState.nodes
                .filter((node: CanvasNode): node is BranchMarkerNode => isBranchMarkerNode(node))
                .map((node: BranchMarkerNode) => [node.nodeId, node]),
        )
        if (pendingBranchMarkerOverlayEl) {
            for (const nodeEl of [...pendingBranchMarkerOverlayEl.querySelectorAll('[data-node-id]')] as HTMLElement[]) {
                const nodeId = nodeEl.dataset.nodeId ?? ''
                const branchMarker = branchMarkersById.get(nodeId)
                if (!branchMarker) {
                    cleanupBranchMarkerArtifacts([nodeId])
                    continue
                }
                if (branchMarker.pendingState?.phase === 'preflight') continue
                if (shouldDeferPlannedBranchMarkerViewportRender(branchMarker)) continue

                const viewportNodeEl = viewportEl.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null
                if (viewportNodeEl) {
                    nodeEl.remove()
                    continue
                }

                viewportEl.appendChild(nodeEl)
                nodeEl.classList.remove('workspace-branch-marker-screen-fixed')
                nodeEl.style.removeProperty('z-index')
                connectionManager?.registerNodeElement(nodeId, nodeEl as HTMLDivElement)
                syncCanvasNodeDomGeometry([branchMarker])
                syncBranchMarkerNodeContent(branchMarker, nodeEl)
            }
        }
        const pendingNodes = currentCanvasState.nodes
            .filter((node: CanvasNode): node is BranchMarkerNode =>
                isBranchMarkerNode(node) && node.pendingState?.phase === 'preflight'
            )
            .sort((a, b) => {
                const aIndex = a.pendingState?.reasoningIndex ?? 0
                const bIndex = b.pendingState?.reasoningIndex ?? 0
                if (aIndex !== bIndex) return aIndex - bIndex
                return a.nodeId.localeCompare(b.nodeId)
            })
        const entries = pendingNodes.map(node => ({
            node,
            // The preflight pose is laid out at its compact screen-fixed width, with
            // height expanded only when a streamed response row is actually visible.
            dimensions: getBranchMarkerScreenFixedDimensionsForNode(node),
        }))
        const stackDimensions = entries.map(entry => entry.dimensions)
        const stackOffsets = getPendingBranchMarkerStackOffsets(stackDimensions)
        const stackHeight = getPendingBranchMarkerStackHeight(stackDimensions)
        entries.forEach(({ node, dimensions }, index) => {
            applyPendingBranchMarkerScreenProjection(node.nodeId, dimensions, stackOffsets[index] ?? 0, stackHeight)
        })
    }

    function branchMarkerMatchesPendingRecord(node: BranchMarkerNode, record: PendingBranchMarkerRecord): boolean {
        if (record.nodeId === node.nodeId) return true

        const runNode = node as Partial<BranchForkCanvasNode & BranchLineCanvasNode>
        if (record.reasoningIndex != null && runNode.reasoningIndex != null) {
            return record.reasoningIndex === runNode.reasoningIndex
        }
        if (record.reasoningModelId && runNode.reasoningModelId) {
            return normalizeBranchMarkerModelValue(record.reasoningModelId) === normalizeBranchMarkerModelValue(runNode.reasoningModelId)
        }

        return !record.reasoningModelId
            && record.reasoningIndex == null
            && record.threadId === getBranchMarkerThreadId(node)
    }

    function hasStartedGeneratedMediaForBranchMarkerNode(nodeId: string): boolean {
        for (const tracker of partialImageTracker.values()) {
            if (tracker.sourceNodeId === nodeId) return true
        }
        for (const tracker of videoGenerationTracker.values()) {
            if (tracker.sourceNodeId === nodeId) return true
        }
        const nodesById = getCanvasNodesById(currentCanvasState?.nodes ?? [])
        return Boolean(currentCanvasState?.edges.some((edge: WorkspaceEdge) => {
            if (edge.sourceNodeId !== nodeId) return false
            const targetNode = nodesById.get(edge.targetNodeId)
            return targetNode?.type === 'image' || targetNode?.type === 'video'
        }))
    }

    function getMatchingScreenFixedPendingBranchMarkerRecord(node: BranchMarkerNode): PendingBranchMarkerRecord | null {
        if (!pendingBranchMarkerOverlayEl) return null
        for (const record of pendingBranchMarkers.values()) {
            if (!branchMarkerMatchesPendingRecord(node, record)) continue
            const markerEl = findBranchMarkerNodeEl(record.nodeId)
            if (markerEl?.parentElement === pendingBranchMarkerOverlayEl) return record
        }
        return null
    }

    function getScreenFixedPendingBranchMarkerRecordForThread(threadId: string): PendingBranchMarkerRecord | null {
        if (!threadId || !pendingBranchMarkerOverlayEl) return null
        for (const record of pendingBranchMarkers.values()) {
            if (record.threadId !== threadId) continue
            const markerEl = findBranchMarkerNodeEl(record.nodeId)
            if (markerEl?.parentElement === pendingBranchMarkerOverlayEl) return record
        }
        return null
    }

    function lineagePlanReferencesBranchMarkerNode(lineagePlan: MediaBranchLineagePlan, node: BranchMarkerNode): boolean {
        return lineagePlan.regenerationTarget?.lineageParentNodeId === node.nodeId
            || lineagePlan.branchOrigin?.nodeId === node.nodeId
            || lineagePlan.branchForks.some(branchFork => branchFork.nodeId === node.nodeId)
            || lineagePlan.branchLines.some(branchLine => branchLine.nodeId === node.nodeId)
            || lineagePlan.runAssignments.some(assignment =>
                assignment.branchOriginNodeId === node.nodeId
                || assignment.branchForkNodeId === node.nodeId
                || assignment.branchLineNodeId === node.nodeId
            )
    }

    function getPendingGeneratedMediaPlacementForBranchMarker(
        node: BranchMarkerNode,
    ): { placementKey: string; placement: PendingGeneratedImagePlacement; reason: string } | null {
        const threadId = getBranchMarkerThreadId(node)
        const generationRequestId = node.generationRequestId
        for (const [placementKey, placement] of pendingGeneratedImagePlacements.entries()) {
            if (threadId && placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue
            const lineagePlan = placement.lineagePlan
            if (lineagePlan && lineagePlanReferencesBranchMarkerNode(lineagePlan, node)) {
                return { placementKey, placement, reason: 'lineage-node' }
            }
            if (generationRequestId && lineagePlan?.generationRequestId === generationRequestId) {
                return { placementKey, placement, reason: 'lineage-generation-request' }
            }
            if (threadId && generationRequestId && placementKey === `${threadId}:${generationRequestId}`) {
                return { placementKey, placement, reason: 'placement-key' }
            }
            if (threadId && generationRequestId && !generationRequestId.startsWith('canvas-') && placementKey === threadId) {
                return { placementKey, placement, reason: 'thread-active-placement' }
            }
        }
        return null
    }

    function debugBranchMarkerHandoff(
        event: string,
        marker: BranchMarkerNode,
        details: Record<string, unknown> = {},
    ): void {
        const key = [
            event,
            marker.nodeId,
            getBranchMarkerThreadId(marker),
            marker.generationRequestId,
            details.reason,
            details.placementKey,
            details.previousNodeId,
        ].join(':')
        if (branchMarkerHandoffDebugKeys.has(key)) return
        branchMarkerHandoffDebugKeys.add(key)
        console.info('[CANVAS][branch-marker-handoff]', event, {
            markerNodeId: marker.nodeId,
            markerType: marker.type,
            threadId: getBranchMarkerThreadId(marker),
            generationRequestId: marker.generationRequestId,
            pendingPhase: marker.pendingState?.phase ?? '',
            uiPhase: branchMarkerUiPhaseByNodeId.get(marker.nodeId) ?? '',
            ...details,
        })
    }

    function shouldDeferPlannedBranchMarkerViewportRender(node: BranchMarkerNode): boolean {
        if (node.pendingState) return false
        if (hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)) return false

        const matchingRecord = getMatchingScreenFixedPendingBranchMarkerRecord(node)
        if (matchingRecord) {
            debugBranchMarkerHandoff('defer-planned-marker-render', node, {
                reason: 'matching-screen-fixed-marker',
                previousNodeId: matchingRecord.nodeId,
                placementKey: matchingRecord.placementKey,
            })
            return true
        }

        const threadId = getBranchMarkerThreadId(node)
        const screenFixedRecord = getScreenFixedPendingBranchMarkerRecordForThread(threadId)
        const placementMatch = getPendingGeneratedMediaPlacementForBranchMarker(node)
        if (screenFixedRecord && placementMatch) {
            debugBranchMarkerHandoff('defer-planned-marker-render', node, {
                reason: placementMatch.reason,
                previousNodeId: screenFixedRecord.nodeId,
                placementKey: placementMatch.placementKey,
                screenFixedPlacementKey: screenFixedRecord.placementKey,
            })
            return true
        }

        return false
    }

    function parseBooleanAttr(value: unknown): boolean {
        return value === true || value === 'true'
    }

    function getAiChatThreadJsonNode(thread: AiChatThread): ProseMirrorJsonNode | null {
        const root = parseProseMirrorJsonContent(thread.content)
        return root ? findAiChatThreadContentNode(root, thread.threadId) : null
    }

    function getLatestAiUserMessageText(thread: AiChatThread): string {
        const threadNode = getAiChatThreadJsonNode(thread)
        const latestUserMessage = [...(threadNode?.content ?? [])]
            .reverse()
            .find((child) => child.type === 'aiUserMessage')
        return latestUserMessage ? collectProseMirrorText(latestUserMessage).trim() : ''
    }

    function getDetachedThreadPendingModelStates(thread: AiChatThread, promptText: string): Array<NonNullable<BranchMarkerNode['pendingState']>> {
        const attrs = getAiChatThreadJsonNode(thread)?.attrs ?? {}
        const useMultipleReasoningModels = parseBooleanAttr(attrs.useMultipleReasoningModels)
        const useMultipleImageModels = parseBooleanAttr(attrs.useMultipleImageModels)
        const useMultipleVideoModels = parseBooleanAttr(attrs.useMultipleVideoModels)
        const collapseForMode = (models: string[], useMultiple: boolean): string[] =>
            useMultiple ? models : models.slice(0, 1)
        const reasoningModelIds = uniqueAiModelIds(collapseForMode(
            parseAiModelSelectionAttr(attrs.aiReasoningModels),
            useMultipleReasoningModels,
        ))
        const imageModelIds = uniqueAiModelIds(collapseForMode(
            parseAiModelSelectionAttr(attrs.aiImageModels),
            useMultipleImageModels,
        ))
        const videoModelIds = uniqueAiModelIds(collapseForMode(
            parseAiModelSelectionAttr(attrs.aiVideoModels),
            useMultipleVideoModels,
        ))
        const focusedReasoningModelIds: Array<AiModelId | undefined> = reasoningModelIds.length > 0
            ? reasoningModelIds
            : [undefined]
        return focusedReasoningModelIds.map((reasoningModelId, reasoningIndex) => ({
            phase: 'preflight',
            promptText,
            reasoningModelIds: reasoningModelId ? [reasoningModelId] : [],
            ...(reasoningModelId ? { reasoningModelId } : {}),
            reasoningIndex,
            imageModelIds,
            videoModelIds,
        }))
    }

    function insertPendingBranchMarkerForPersistedCanvasThread(thread: AiChatThread): void {
        if (!currentCanvasState) return
        const threadId = thread.threadId
        if (hasPendingBranchMarkerForPlacement(threadId) || hasCanvasBranchMarkerForPlacement(threadId)) return

        const promptText = getLatestAiUserMessageText(thread)
        if (!promptText) return

        const pendingStates = getDetachedThreadPendingModelStates(thread, promptText)
        const pendingNodes: BranchLineCanvasNode[] = []
        const screenFixedDimensionsByIndex = pendingStates.map(() => getBranchMarkerScreenFixedDimensions(promptText))
        const stackOffsets = getPendingBranchMarkerStackOffsets(screenFixedDimensionsByIndex)
        const stackHeight = getPendingBranchMarkerStackHeight(screenFixedDimensionsByIndex)
        pendingStates.forEach((pendingState, index) => {
            const dimensions = getBranchMarkerContentDimensions(promptText)
            const screenFixedDimensions = screenFixedDimensionsByIndex[index] ?? getBranchMarkerScreenFixedDimensions(promptText)
            const projection = getPendingBranchMarkerScreenProjection(screenFixedDimensions, stackOffsets[index] ?? 0, stackHeight)
            const nodeId = `pending-branch-${threadId}-${index}`
            const pendingNode = resizeBranchMarkerNodeFromProseMirror({
                nodeId,
                type: 'branchLine',
                branchId: `pending-${threadId}-${index}`,
                generationRequestId: threadId,
                conversationAssetId: threadId,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
                pendingState,
                position: projection.position,
                dimensions,
                temporary: true,
            } as BranchLineCanvasNode) as BranchLineCanvasNode
            const record: PendingBranchMarkerRecord = {
                nodeId,
                placementKey: threadId,
                threadId,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
            }
            if (pendingState.reasoningModelId) {
                pendingBranchMarkers.set(getPendingBranchMarkerReasoningModelKey(threadId, pendingState.reasoningModelId), record)
            }
            if (pendingState.reasoningIndex != null) {
                pendingBranchMarkers.set(getPendingBranchMarkerReasoningIndexKey(threadId, pendingState.reasoningIndex), record)
            }
            if (pendingStates.length === 1) pendingBranchMarkers.set(threadId, record)
            branchMarkerUiPhaseByNodeId.set(nodeId, 'preflight')
            pendingNodes.push(pendingNode)
        })
        if (pendingNodes.length === 0) return

        commitTransientCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes: [...currentCanvasState.nodes, ...pendingNodes],
        })
        for (const pendingNode of pendingNodes) {
            appendBranchLineNodeToDOM(pendingNode)
        }
        syncPendingBranchMarkerScreenPlacements()
    }

    function restoreDetachedCanvasPreflightMarkersForActiveThreads(): void {
        for (const threadId of getActiveDetachedCanvasRunThreadIds()) {
            if (activeCanvasRunIds.has(threadId)) continue
            const thread = getPersistedAiChatThread(threadId)
            if (!thread) continue
            insertPendingBranchMarkerForPersistedCanvasThread(thread)
        }
    }

    function insertPendingBranchMarkerForCanvasRun(
        placementKey: string,
        promptText: string,
        data: AiPromptComposerSubmitData,
    ): void {
        if (!currentCanvasState || hasPendingBranchMarkerForPlacement(placementKey) || hasCanvasBranchMarkerForPlacement(placementKey)) return

        const pendingStates = getPendingBranchMarkerModelStates(data, promptText)
        const pendingNodes: BranchLineCanvasNode[] = []
        const screenFixedDimensionsByIndex = pendingStates.map(() => getBranchMarkerScreenFixedDimensions(promptText))
        const stackOffsets = getPendingBranchMarkerStackOffsets(screenFixedDimensionsByIndex)
        const stackHeight = getPendingBranchMarkerStackHeight(screenFixedDimensionsByIndex)
        pendingStates.forEach((pendingState, index) => {
            const dimensions = getBranchMarkerContentDimensions(promptText)
            // The node carries on-canvas dimensions, but its initial preflight pose is
            // projected from the compact screen-fixed size.
            const screenFixedDimensions = screenFixedDimensionsByIndex[index] ?? getBranchMarkerScreenFixedDimensions(promptText)
            const projection = getPendingBranchMarkerScreenProjection(screenFixedDimensions, stackOffsets[index] ?? 0, stackHeight)
            const nodeId = `pending-branch-${uuidv4()}`
            const basePendingNode: BranchLineCanvasNode = {
                nodeId,
                type: 'branchLine',
                branchId: `pending-${placementKey}-${index}`,
                generationRequestId: placementKey,
                conversationAssetId: placementKey,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
                pendingState,
                position: projection.position,
                dimensions,
                temporary: true,
            }
            const pendingNode = resizeBranchMarkerNodeFromProseMirror(basePendingNode) as BranchLineCanvasNode
            const record: PendingBranchMarkerRecord = {
                nodeId,
                placementKey,
                threadId: placementKey,
                ...(pendingState.reasoningModelId ? { reasoningModelId: pendingState.reasoningModelId } : {}),
                ...(pendingState.reasoningIndex == null ? {} : { reasoningIndex: pendingState.reasoningIndex }),
            }
            if (pendingState.reasoningModelId) {
                pendingBranchMarkers.set(getPendingBranchMarkerReasoningModelKey(placementKey, pendingState.reasoningModelId), record)
            }
            if (pendingState.reasoningIndex != null) {
                pendingBranchMarkers.set(getPendingBranchMarkerReasoningIndexKey(placementKey, pendingState.reasoningIndex), record)
            }
            if (pendingStates.length === 1) pendingBranchMarkers.set(placementKey, record)
            branchMarkerUiPhaseByNodeId.set(nodeId, 'preflight')
            pendingNodes.push(pendingNode)
        })
        commitTransientCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes: [...currentCanvasState.nodes, ...pendingNodes],
        })
        for (const pendingNode of pendingNodes) {
            appendBranchLineNodeToDOM(pendingNode)
        }
        syncPendingBranchMarkerScreenPlacements()
    }

    function getPendingBranchMarkerRecord(threadId: string, generationRun?: MediaGenerationRunMeta): PendingBranchMarkerRecord | undefined {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        for (const key of getPendingBranchMarkerSpecificKeys(threadId, generationRun)) {
            const record = pendingBranchMarkers.get(key)
            if (record) return record
        }
        const byReasoningIndex = findPendingBranchMarkerRecordByReasoningIndex(placementKey, generationRun?.reasoningIndex)
            ?? (placementKey !== threadId
                ? findPendingBranchMarkerRecordByReasoningIndex(threadId, generationRun?.reasoningIndex)
                : undefined)
        if (byReasoningIndex) return byReasoningIndex

        const byReasoningModel = findPendingBranchMarkerRecordByReasoningModel(placementKey, generationRun?.reasoningModelId)
            ?? (placementKey !== threadId
                ? findPendingBranchMarkerRecordByReasoningModel(threadId, generationRun?.reasoningModelId)
                : undefined)
        if (byReasoningModel) return byReasoningModel

        const placementRecord = pendingBranchMarkers.get(placementKey)
        if (placementRecord && pendingBranchMarkerRecordMatchesGenerationRun(placementRecord, generationRun)) {
            return placementRecord
        }

        const threadRecord = placementKey !== threadId ? pendingBranchMarkers.get(threadId) : undefined
        if (threadRecord && pendingBranchMarkerRecordMatchesGenerationRun(threadRecord, generationRun)) {
            return threadRecord
        }

        return recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)
    }

    function preserveBranchMarkerPreviewStateAcrossPromotion(
        pendingNodeId: string,
        plannedNode: BranchMarkerNode,
    ): BranchMarkerNode {
        if (pendingNodeId !== plannedNode.nodeId) {
            liveNodeOverrides.delete(pendingNodeId)
            branchMarkerProjectionOverrideNodeIds.delete(pendingNodeId)
            manuallyPositionedBranchMarkerNodeIds.delete(pendingNodeId)
        }
        const nodeWithProjection = resizeBranchMarkerNodeFromProseMirror(plannedNode)
        liveNodeOverrides.delete(nodeWithProjection.nodeId)
        branchMarkerProjectionOverrideNodeIds.delete(nodeWithProjection.nodeId)
        manuallyPositionedBranchMarkerNodeIds.delete(nodeWithProjection.nodeId)
        return nodeWithProjection
    }

    function ensurePendingBranchMarkerRecordForApiRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerRecord | undefined {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        for (const key of getPendingBranchMarkerSpecificKeys(threadId, generationRun)) {
            const existing = pendingBranchMarkers.get(key)
            if (existing) {
                setPendingBranchMarkerRecordAliases(threadId, generationRun, existing)
                return existing
            }
        }

        const byReasoningIndex = findPendingBranchMarkerRecordByReasoningIndex(placementKey, generationRun?.reasoningIndex)
            ?? (placementKey !== threadId
                ? findPendingBranchMarkerRecordByReasoningIndex(threadId, generationRun?.reasoningIndex)
                : undefined)
        if (byReasoningIndex) {
            setPendingBranchMarkerRecordAliases(threadId, generationRun, byReasoningIndex)
            return byReasoningIndex
        }

        const byReasoningModel = findPendingBranchMarkerRecordByReasoningModel(placementKey, generationRun?.reasoningModelId)
            ?? (placementKey !== threadId
                ? findPendingBranchMarkerRecordByReasoningModel(threadId, generationRun?.reasoningModelId)
                : undefined)
        if (byReasoningModel) {
            setPendingBranchMarkerRecordAliases(threadId, generationRun, byReasoningModel)
            return byReasoningModel
        }

        const existing = pendingBranchMarkers.get(placementKey)
        if (existing && pendingBranchMarkerRecordMatchesGenerationRun(existing, generationRun)) {
            setPendingBranchMarkerRecordAliases(threadId, generationRun, existing)
            return existing
        }

        const threadRecord = placementKey !== threadId ? pendingBranchMarkers.get(threadId) : undefined
        if (!threadRecord || !pendingBranchMarkerRecordMatchesGenerationRun(threadRecord, generationRun)) {
            return recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)
        }

        const migrated = { ...threadRecord, placementKey }
        pendingBranchMarkers.set(placementKey, migrated)
        setPendingBranchMarkerRecordAliases(threadId, generationRun, migrated)
        return migrated
    }

    function getPendingBranchMarkerViewportStartGeometry(pendingEl: HTMLElement): CanvasGeometry {
        const viewport = getLiveViewport()
        const zoom = getSafeViewportZoom(viewport)
        const screenLeft = parseFloat(pendingEl.style.left) || 0
        const screenTop = parseFloat(pendingEl.style.top) || 0
        const screenWidth = parseFloat(pendingEl.style.width) || pendingEl.offsetWidth
        const screenHeight = parseFloat(pendingEl.style.height) || pendingEl.offsetHeight

        return {
            position: {
                x: (screenLeft - viewport.x) / zoom,
                y: (screenTop - viewport.y) / zoom,
            },
            dimensions: {
                width: screenWidth / zoom,
                height: screenHeight / zoom,
            },
        }
    }

    function promotePendingBranchMarkerElement(pendingNodeId: string, node: BranchMarkerNode): HTMLElement | null {
        const pendingEl = findBranchMarkerNodeEl(pendingNodeId)
        if (!pendingEl) return null

        let nodeEl: HTMLElement
        if (node.type === 'branchOrigin') {
            nodeEl = createBranchOriginNode(node)
        } else if (node.type === 'branchFork') {
            nodeEl = createBranchForkNode(node)
        } else {
            nodeEl = createBranchLineNode(node)
        }
        const startGeometry = getPendingBranchMarkerViewportStartGeometry(pendingEl)
        applyStyle(nodeEl, {
            left: `${startGeometry.position.x}px`,
            top: `${startGeometry.position.y}px`,
            // Start at the preflight pose's compact size so the move animation grows the
            // pill into its (larger) on-canvas dimensions instead of snapping.
            width: `${startGeometry.dimensions.width}px`,
            height: `${startGeometry.dimensions.height}px`,
            transform: 'scale(1)',
            transformOrigin: 'top right',
        })
        // The marker now becomes a real canvas node: it must live in viewportEl so
        // node layering and geometry sync own it. Convert the screen-space docked
        // rect into viewport world units so it stays visually in place at handoff.
        pendingEl.remove()
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(node.nodeId, nodeEl as HTMLDivElement)
        return nodeEl
    }

    function markBranchMarkerPlacementAnimating(nodeEl: HTMLElement): void {
        nodeEl.classList.add('workspace-branch-marker-moving')
        void nodeEl.offsetLeft
        setTimeout(() => {
            nodeEl.classList.remove('workspace-branch-marker-moving')
            nodeEl.classList.remove('workspace-branch-marker-screen-fixed')
            nodeEl.style.removeProperty('transform')
            nodeEl.style.removeProperty('transform-origin')
        }, settings.mediaBranchLineage.pendingMarkerMoveDurationMs + 60)
    }

    function moveBranchMarkerIntoCanvasViewport(nodeEl: HTMLElement, node: BranchMarkerNode): void {
        applyStyle(nodeEl, {
            left: `${node.position.x}px`,
            top: `${node.position.y}px`,
            width: `${node.dimensions.width}px`,
            height: `${node.dimensions.height}px`,
            transform: 'scale(1)',
            transformOrigin: 'top right',
        })
    }

    function clonePendingGeneratedMediaPlacement(placement: PendingGeneratedImagePlacement): PendingGeneratedImagePlacement {
        return {
            ...placement,
            activeRunKeys: placement.activeRunKeys ? new Set(placement.activeRunKeys) : undefined,
        }
    }

    function getPendingGeneratedMediaPlacement(threadId: string, generationRun?: MediaGenerationRunMeta): PendingGeneratedImagePlacement | undefined {
        return pendingGeneratedImagePlacements.get(getGeneratedMediaPlacementKey(threadId, generationRun))
    }

    function ensurePendingGeneratedMediaPlacementForApiRun(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        seed?: PendingGeneratedImagePlacement,
    ): PendingGeneratedImagePlacement | undefined {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const existing = pendingGeneratedImagePlacements.get(placementKey)
        if (existing) return existing

        const threadPlacement = placementKey !== threadId
            ? pendingGeneratedImagePlacements.get(threadId)
            : undefined
        const placement = threadPlacement
            ? clonePendingGeneratedMediaPlacement(threadPlacement)
            : seed
        if (!placement) return undefined

        pendingGeneratedImagePlacements.set(placementKey, placement)
        return placement
    }

    function setPendingGeneratedMediaPlacement(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        placement: PendingGeneratedImagePlacement,
    ): void {
        pendingGeneratedImagePlacements.set(getGeneratedMediaPlacementKey(threadId, generationRun), placement)
    }

    function getApiMediaRunLineageAssignment(generationRun?: MediaGenerationRunMeta): MediaRunLineageAssignment | undefined {
        return generationRun?.lineageAssignment
    }

    function stripPendingBranchMarkerState(node: BranchMarkerNode): BranchMarkerNode {
        const { pendingState: _pendingState, ...nodeWithoutPendingState } = node
        return nodeWithoutPendingState as BranchMarkerNode
    }

    function rememberPlannedBranchMarkerRecord(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        previousRecord: PendingBranchMarkerRecord,
        plannedNodeId: string,
    ): void {
        if (previousRecord.nodeId !== plannedNodeId) {
            deletePendingBranchMarkerAliasesForNodeId(previousRecord.nodeId)
        }
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const reasoningModelId = previousRecord.reasoningModelId ?? generationRun?.reasoningModelId
        const reasoningIndex = previousRecord.reasoningIndex ?? generationRun?.reasoningIndex
        const plannedRecord: PendingBranchMarkerRecord = {
            nodeId: plannedNodeId,
            placementKey,
            threadId: previousRecord.threadId,
            ...(reasoningModelId ? { reasoningModelId } : {}),
            ...(reasoningIndex == null ? {} : { reasoningIndex }),
        }
        pendingBranchMarkers.set(placementKey, plannedRecord)
        const threadRecord = pendingBranchMarkers.get(threadId)
        if (threadRecord?.nodeId === previousRecord.nodeId) {
            pendingBranchMarkers.set(threadId, plannedRecord)
        }
        setPendingBranchMarkerRecordAliases(threadId, generationRun, plannedRecord)
    }

    function getPlannedBranchMarkerResolution(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
    ): {
        branchOriginNode: BranchOriginCanvasNode | undefined
        branchForkNode: BranchForkCanvasNode | undefined
        branchLineNode: BranchLineCanvasNode | undefined
        primaryNode: BranchMarkerNode | undefined
    } {
        const mediaHeight = getGeneratedMediaInsertionSize()
        const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, mediaHeight)
        const { branchForkNode, branchLineNode, markerNode } = ensureBranchMarkerForGeneratedMedia(threadId, generationRun, branchOriginNode)
        return {
            branchOriginNode,
            branchForkNode,
            branchLineNode,
            primaryNode: markerNode ?? branchOriginNode,
        }
    }

    function findLineageAssignmentForGenerationRun(
        lineagePlan: MediaBranchLineagePlan,
        generationRun?: MediaGenerationRunMeta,
    ): MediaRunLineageAssignment | undefined {
        if (generationRun?.lineageAssignment) return generationRun.lineageAssignment
        if (!generationRun) return undefined

        return lineagePlan.runAssignments.find(assignment =>
            (generationRun.mediaRunId && assignment.mediaRunId === generationRun.mediaRunId)
            || (generationRun.reasoningRunId && assignment.reasoningRunId === generationRun.reasoningRunId)
            || (
                generationRun.reasoningIndex != null
                && getLineageAssignmentReasoningIndex(lineagePlan, assignment, generationRun) === generationRun.reasoningIndex
                && (!generationRun.reasoningModelId || assignment.reasoningModelId === generationRun.reasoningModelId)
            )
        )
    }

    function buildPendingBranchMarkerStateForPlannedRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): NonNullable<BranchMarkerNode['pendingState']> | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
            ?? pendingGeneratedImagePlacements.get(threadId)
        const lineagePlan = placement?.lineagePlan
        if (lineagePlan) {
            const assignment = findLineageAssignmentForGenerationRun(lineagePlan, generationRun)
            const relatedAssignments = assignment
                ? getRelatedLineageAssignments(lineagePlan, assignment)
                : lineagePlan.runAssignments
            const reasoningModelId = assignment?.reasoningModelId ?? generationRun?.reasoningModelId
            const reasoningIndex = assignment
                ? getLineageAssignmentReasoningIndex(lineagePlan, assignment, generationRun)
                : generationRun?.reasoningIndex
            return {
                phase: 'planned',
                promptText: assignment?.promptText || lineagePlan.promptText,
                reasoningModelIds: uniqueAiModelIds([reasoningModelId]),
                ...(reasoningModelId ? { reasoningModelId } : {}),
                ...(reasoningIndex == null ? {} : { reasoningIndex }),
                imageModelIds: getLineageAssignmentMediaModelIds(relatedAssignments, 'image'),
                videoModelIds: getLineageAssignmentMediaModelIds(relatedAssignments, 'video'),
            }
        }

        const promptText = placement?.promptText
        if (!promptText) return undefined

        const mediaModelIds = uniqueAiModelIds([generationRun?.mediaModelId])
        return {
            phase: 'planned',
            promptText,
            reasoningModelIds: uniqueAiModelIds([generationRun?.reasoningModelId]),
            ...(generationRun?.reasoningModelId ? { reasoningModelId: generationRun.reasoningModelId } : {}),
            ...(generationRun?.reasoningIndex == null ? {} : { reasoningIndex: generationRun.reasoningIndex }),
            imageModelIds: generationRun?.mediaType === 'video' ? [] : mediaModelIds,
            videoModelIds: generationRun?.mediaType === 'video' ? mediaModelIds : [],
        }
    }

    function applyPendingStateToSyncedPlannedBranchMarker(
        plannedNode: BranchMarkerNode,
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): BranchMarkerNode {
        const pendingState = buildPendingBranchMarkerStateForPlannedRun(threadId, generationRun)
        if (!pendingState) return resizeBranchMarkerNodeFromProseMirror(plannedNode)

        return resizeBranchMarkerNodeFromProseMirror({
            ...plannedNode,
            conversationAssetId: getBranchMarkerThreadId(plannedNode) || threadId,
            pendingState,
        } as BranchMarkerNode)
    }

    function applyPendingStateToPlannedBranchMarker(
        plannedNode: BranchMarkerNode,
        pendingNode: BranchMarkerNode,
    ): BranchMarkerNode {
        return resizeBranchMarkerNodeFromProseMirror({
            ...plannedNode,
            ...(pendingNode.conversationAssetId ? { conversationAssetId: pendingNode.conversationAssetId } : {}),
            pendingState: {
                ...pendingNode.pendingState!,
                phase: 'planned',
            },
        } as BranchMarkerNode)
    }

    function appendBranchMarkerNodeForKind(node: BranchMarkerNode): void {
        if (node.type === 'branchOrigin') appendBranchOriginNodeToDOM(node)
        else if (node.type === 'branchFork') appendBranchForkNodeToDOM(node)
        else appendBranchLineNodeToDOM(node)
    }

    function syncPlannedBranchMarkerResolution(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        previousRecord: PendingBranchMarkerRecord,
        plannedResolution: ReturnType<typeof getPlannedBranchMarkerResolution>,
    ): void {
        if (!currentCanvasState || !plannedResolution.primaryNode) return

        const plannedNode = applyPendingStateToSyncedPlannedBranchMarker(
            plannedResolution.primaryNode,
            threadId,
            generationRun,
        )
        const supportNodes = [
            plannedResolution.branchOriginNode,
            plannedResolution.branchForkNode,
            plannedResolution.branchLineNode,
        ].filter((node): node is BranchMarkerNode =>
            Boolean(node && node.nodeId !== plannedNode.nodeId)
        )
        const nodesById = new Map<string, BranchMarkerNode>([
            ...supportNodes.map(node => [node.nodeId, node] as const),
            [plannedNode.nodeId, plannedNode],
        ])
        const insertedNodeIds = new Set<string>()
        const removePreviousNode = previousRecord.nodeId !== plannedNode.nodeId
        const nodes: CanvasNode[] = []
        for (const node of currentCanvasState.nodes) {
            if (removePreviousNode && node.nodeId === previousRecord.nodeId) continue
            const plannedReplacement = nodesById.get(node.nodeId)
            if (plannedReplacement) {
                if (!insertedNodeIds.has(plannedReplacement.nodeId)) {
                    nodes.push(plannedReplacement)
                    insertedNodeIds.add(plannedReplacement.nodeId)
                }
                continue
            }
            nodes.push(node)
        }
        for (const node of nodesById.values()) {
            if (insertedNodeIds.has(node.nodeId)) continue
            nodes.push(node)
            insertedNodeIds.add(node.nodeId)
        }

        let edges = removePreviousNode
            ? currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                edge.sourceNodeId !== previousRecord.nodeId && edge.targetNodeId !== previousRecord.nodeId
            )
            : currentCanvasState.edges
        edges = addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchForkNode)
        edges = addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchLineNode)
        edges = plannedNode.type === 'branchFork' || plannedNode.type === 'branchLine'
            ? addBranchMarkerEdgeIfMissing(edges, plannedNode)
            : edges

        if (removePreviousNode) cleanupBranchMarkerArtifacts([previousRecord.nodeId])
        rememberPlannedBranchMarkerRecord(threadId, generationRun, previousRecord, plannedNode.nodeId)
        branchMarkerUiPhaseByNodeId.delete(previousRecord.nodeId)
        branchMarkerUiPhaseByNodeId.set(plannedNode.nodeId, 'planned-awaiting-media')
        debugBranchMarkerHandoff('sync-planned-marker-resolution', plannedNode, {
            previousNodeId: previousRecord.nodeId,
            placementKey: getGeneratedMediaPlacementKey(threadId, generationRun),
            removedPreviousNode: removePreviousNode,
        })
        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes,
            edges,
        })
        for (const node of nodesById.values()) appendBranchMarkerNodeForKind(node)
        refreshBranchMarkersForAiChatThread(threadId)
    }

    function resolvePendingBranchMarkerWithLineagePlan(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        if (!currentCanvasState) return
        const lineagePlan = getPendingGeneratedMediaPlacement(threadId, generationRun)?.lineagePlan
        const regenerationTarget = lineagePlan?.regenerationTarget
        if (regenerationTarget) {
            const markerNode = currentCanvasState.nodes.find((node: CanvasNode): node is BranchMarkerNode =>
                node.nodeId === regenerationTarget.lineageParentNodeId
                && node.type === regenerationTarget.lineageParentType
            )
            if (!markerNode) {
                console.error('[CANVAS][generated-output-review] API regeneration lineage parent is missing.', {
                    threadId,
                    generationRequestId: generationRun?.generationRequestId,
                    regenerationTarget,
                })
                return
            }
            branchMarkerUiPhaseByNodeId.set(markerNode.nodeId, 'planned-awaiting-media')
            syncBranchMarkerNodeContent(markerNode)
            return
        }
        const record = ensurePendingBranchMarkerRecordForApiRun(threadId, generationRun)
        if (!record) {
            const plannedResolution = getPlannedBranchMarkerResolution(threadId, generationRun)
            const plannedNode = plannedResolution.primaryNode
            if (plannedNode) {
                syncPlannedBranchMarkerResolution(
                    threadId,
                    generationRun,
                    createPendingBranchMarkerRecordFromCanvasNode(threadId, generationRun, plannedNode),
                    plannedResolution,
                )
            }
            return
        }

        const pendingNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === record.nodeId)
        if (!pendingNode || !isBranchMarkerNode(pendingNode) || !pendingNode.pendingState) {
            // A state replacement (incoming workspace update) can drop the
            // transient preflight node while its overlay pill and record linger;
            // keep the API-planned marker as the active run instead of recreating
            // another preflight marker beside it.
            const plannedResolution = getPlannedBranchMarkerResolution(threadId, generationRun)
            if (!plannedResolution.primaryNode) return
            syncPlannedBranchMarkerResolution(threadId, generationRun, record, plannedResolution)
            return
        }

        const plannedResolution = getPlannedBranchMarkerResolution(threadId, generationRun)
        const plannedNode = plannedResolution.primaryNode
        if (!plannedNode) return

        const supportNodes = [
            plannedResolution.branchOriginNode,
            plannedResolution.branchForkNode,
            plannedResolution.branchLineNode,
        ].filter((node): node is BranchMarkerNode =>
            Boolean(node && node.nodeId !== plannedNode.nodeId)
        )
        let plannedNodeWithPending = applyPendingStateToPlannedBranchMarker(plannedNode, pendingNode)
        plannedNodeWithPending = preserveBranchMarkerPreviewStateAcrossPromotion(record.nodeId, plannedNodeWithPending)
        plannedNodeWithPending = positionPendingBranchMarkerBeforeGeneratedMedia(plannedNodeWithPending, supportNodes, threadId, generationRun)
        const promotedEl = promotePendingBranchMarkerElement(record.nodeId, plannedNodeWithPending)
        debugBranchMarkerHandoff('promote-planned-marker', plannedNodeWithPending, {
            previousNodeId: record.nodeId,
            placementKey: getGeneratedMediaPlacementKey(threadId, generationRun),
            hadScreenFixedElement: Boolean(promotedEl),
        })
        if (promotedEl) markBranchMarkerPlacementAnimating(promotedEl)

        const supportNodesById = new Map<string, BranchMarkerNode>(supportNodes.map(node => [node.nodeId, node]))
        const insertedSupportNodeIds = new Set<string>()
        let insertedPlannedNode = false
        const nodes: CanvasNode[] = []
        for (const node of currentCanvasState.nodes) {
            const supportNode = supportNodesById.get(node.nodeId)
            if (supportNode) {
                if (!insertedSupportNodeIds.has(supportNode.nodeId)) {
                    nodes.push(supportNode)
                    insertedSupportNodeIds.add(supportNode.nodeId)
                }
                continue
            }
            if (node.nodeId === record.nodeId || node.nodeId === plannedNodeWithPending.nodeId) {
                if (!insertedPlannedNode) {
                    nodes.push(plannedNodeWithPending)
                    insertedPlannedNode = true
                }
                continue
            }
            nodes.push(node)
        }
        for (const supportNode of supportNodes) {
            if (insertedSupportNodeIds.has(supportNode.nodeId)) continue
            nodes.push(supportNode)
            insertedSupportNodeIds.add(supportNode.nodeId)
        }
        if (!insertedPlannedNode) nodes.push(plannedNodeWithPending)

        let edges = currentCanvasState.edges
        edges = addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchForkNode)
        edges = addBranchMarkerEdgeIfMissing(edges, plannedResolution.branchLineNode)
        edges = plannedNodeWithPending.type === 'branchFork' || plannedNodeWithPending.type === 'branchLine'
            ? addBranchMarkerEdgeIfMissing(edges, plannedNodeWithPending)
            : edges

        rememberPlannedBranchMarkerRecord(threadId, generationRun, record, plannedNodeWithPending.nodeId)
        branchMarkerUiPhaseByNodeId.delete(record.nodeId)
        branchMarkerUiPhaseByNodeId.set(plannedNodeWithPending.nodeId, 'planned-awaiting-media')
        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes,
            edges,
        })
        if (promotedEl) moveBranchMarkerIntoCanvasViewport(promotedEl, plannedNodeWithPending)
        syncBranchMarkerNodeContent(plannedNodeWithPending)

        if (!promotedEl) {
            if (plannedNodeWithPending.type === 'branchOrigin') appendBranchOriginNodeToDOM(plannedNodeWithPending)
            else if (plannedNodeWithPending.type === 'branchFork') appendBranchForkNodeToDOM(plannedNodeWithPending)
            else appendBranchLineNodeToDOM(plannedNodeWithPending)
        }
        for (const supportNode of supportNodes) {
            if (supportNode.type === 'branchOrigin') appendBranchOriginNodeToDOM(supportNode)
            else if (supportNode.type === 'branchFork') appendBranchForkNodeToDOM(supportNode)
            else appendBranchLineNodeToDOM(supportNode)
        }
        refreshBranchMarkersForAiChatThread(threadId)
    }

    function clearPendingBranchMarkerStateForRun(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
        options: BranchMarkerSettlementOptions = {},
    ): void {
        // Every caller reaches this point when the generated-media placeholder or
        // tracker takes over the visible progress (or the run is settling, where
        // the finish/skip handlers clear the phase immediately afterwards).
        markBranchMarkerRunMediaPlaceholderPhase(threadId, generationRun)
        if (!currentCanvasState) return
        const record = getPendingBranchMarkerRecord(threadId, generationRun)
        if (!record) return

        let updatedMarker: BranchMarkerNode | undefined
        const nodes = currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (node.nodeId !== record.nodeId || !isBranchMarkerNode(node) || !node.pendingState) return node
            const liveNode = applyBranchMarkerLiveGeometry(node)
            if (options.preserveGeometry) {
                updatedMarker = stripPendingBranchMarkerState(liveNode) as BranchMarkerNode
                return updatedMarker
            }
            const resizedNode = resizeBranchMarkerNodeFromProseMirror(stripPendingBranchMarkerState(liveNode) as BranchMarkerNode)
            updatedMarker = manuallyPositionedBranchMarkerNodeIds.has(node.nodeId)
                ? { ...resizedNode, position: liveNode.position }
                : resizedNode
            return updatedMarker
        })
        if (!updatedMarker) return

        liveNodeOverrides.delete(record.nodeId)
        branchMarkerProjectionOverrideNodeIds.delete(record.nodeId)
        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes,
        })
        syncBranchMarkerNodeContent(updatedMarker)
        syncPendingBranchMarkerScreenPlacements()
        refreshBranchMarkersForAiChatThread(threadId)
    }

    function forgetPendingBranchMarkerRecordForRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const record = getPendingBranchMarkerRecord(threadId, generationRun)
        if (record) deletePendingBranchMarkerAliasesForNodeId(record.nodeId)
        else pendingBranchMarkers.delete(placementKey)
        const threadRecord = pendingBranchMarkers.get(threadId)
        if (record && threadRecord?.nodeId === record.nodeId) pendingBranchMarkers.delete(threadId)
    }

    function removePendingBranchMarkerForRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        const record = getPendingBranchMarkerRecord(threadId, generationRun)
        if (!currentCanvasState) {
            if (record) cleanupBranchMarkerArtifacts([record.nodeId])
            else forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
            return
        }
        if (!record) {
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            const removableGenerationRequestIds = new Set([placementKey, threadId])
            const removableNodeIds = currentCanvasState.nodes
                .filter((node: CanvasNode): node is BranchMarkerNode =>
                    isBranchMarkerNode(node)
                    && Boolean(node.pendingState)
                    && removableGenerationRequestIds.has(node.generationRequestId)
                )
                .map(node => node.nodeId)
            if (removableNodeIds.length === 0) return
            commitCanvasStatePreservingEditors({
                ...currentCanvasState,
                nodes: currentCanvasState.nodes.filter((node: CanvasNode) => !removableNodeIds.includes(node.nodeId)),
                edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                    !removableNodeIds.includes(edge.sourceNodeId) && !removableNodeIds.includes(edge.targetNodeId)
                ),
            })
            cleanupBranchMarkerArtifacts(removableNodeIds)
            return
        }

        const markerNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === record.nodeId)
        forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
        if (!markerNode || !isBranchMarkerNode(markerNode) || !markerNode.pendingState) return

        commitCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes: currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== record.nodeId),
            edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                edge.sourceNodeId !== record.nodeId && edge.targetNodeId !== record.nodeId
            ),
        })
        cleanupBranchMarkerArtifacts([record.nodeId])
    }

    function getLineageAssignmentReasoningIndex(
        lineagePlan: MediaBranchLineagePlan,
        lineageAssignment: MediaRunLineageAssignment,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): number {
        if (sourceGenerationRun?.reasoningRunId === lineageAssignment.reasoningRunId) {
            return sourceGenerationRun.reasoningIndex
        }
        const branchForkPlan = findBranchForkPlanForRun(lineagePlan, lineageAssignment.branchForkNodeId)
        if (branchForkPlan) return branchForkPlan.reasoningIndex
        const branchLinePlan = findBranchLinePlanForRun(lineagePlan, lineageAssignment.branchLineNodeId)
        if (branchLinePlan) return branchLinePlan.reasoningIndex
        return 0
    }

    function buildGenerationRunFromLineageAssignment(
        lineagePlan: MediaBranchLineagePlan,
        lineageAssignment: MediaRunLineageAssignment,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): MediaGenerationRunMeta | undefined {
        if (!lineageAssignment.reasoningRunId || !lineageAssignment.reasoningModelId) return undefined
        return {
            requestKind: sourceGenerationRun?.requestKind ?? 'media-generation-matrix',
            generationRequestId: lineageAssignment.generationRequestId,
            reasoningRunId: lineageAssignment.reasoningRunId,
            ...(lineageAssignment.mediaRunId ? { mediaRunId: lineageAssignment.mediaRunId } : {}),
            reasoningModelId: lineageAssignment.reasoningModelId,
            ...(lineageAssignment.mediaModelId ? { mediaModelId: lineageAssignment.mediaModelId } : {}),
            ...(lineageAssignment.mediaType ? { mediaType: lineageAssignment.mediaType } : {}),
            reasoningIndex: getLineageAssignmentReasoningIndex(lineagePlan, lineageAssignment, sourceGenerationRun),
            lineageAssignment,
        }
    }

    function getLineageAssignmentMarkerKey(assignment: MediaRunLineageAssignment): string | undefined {
        return assignment.branchForkNodeId
            ?? assignment.branchLineNodeId
            ?? assignment.branchOriginNodeId
            ?? assignment.reasoningRunId
            ?? assignment.mediaRunId
    }

    function getUniqueLineageAssignmentsForMarkers(lineagePlan: MediaBranchLineagePlan): MediaRunLineageAssignment[] {
        const assignments: MediaRunLineageAssignment[] = []
        const seen = new Set<string>()
        for (const assignment of lineagePlan.runAssignments) {
            const markerKey = getLineageAssignmentMarkerKey(assignment)
            if (!markerKey || seen.has(markerKey)) continue
            seen.add(markerKey)
            assignments.push(assignment)
        }
        return assignments
    }

    function getRelatedLineageAssignments(
        lineagePlan: MediaBranchLineagePlan,
        assignment: MediaRunLineageAssignment,
    ): MediaRunLineageAssignment[] {
        const markerKey = getLineageAssignmentMarkerKey(assignment)
        return lineagePlan.runAssignments.filter(candidate =>
            (markerKey && getLineageAssignmentMarkerKey(candidate) === markerKey)
            || (assignment.reasoningRunId && candidate.reasoningRunId === assignment.reasoningRunId)
        )
    }

    function getLineageAssignmentMediaModelIds(
        assignments: MediaRunLineageAssignment[],
        mediaType: 'image' | 'video',
    ): AiModelId[] {
        return uniqueAiModelIds(assignments
            .filter(assignment => mediaType === 'image'
                ? assignment.mediaType === 'image' || (!assignment.mediaType && Boolean(assignment.mediaModelId))
                : assignment.mediaType === 'video'
            )
            .map(assignment => assignment.mediaModelId))
    }

    function buildPendingBranchMarkerSpecsFromLineagePlan(
        lineagePlan: MediaBranchLineagePlan,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): PendingBranchMarkerLineageSpec[] {
        const assignments = getUniqueLineageAssignmentsForMarkers(lineagePlan)
        if (assignments.length === 0) {
            return [{
                pendingState: {
                    phase: 'preflight',
                    promptText: lineagePlan.promptText,
                    reasoningModelIds: uniqueAiModelIds([sourceGenerationRun?.reasoningModelId]),
                    ...(sourceGenerationRun?.reasoningModelId ? { reasoningModelId: sourceGenerationRun.reasoningModelId } : {}),
                    ...(sourceGenerationRun?.reasoningIndex == null ? {} : { reasoningIndex: sourceGenerationRun.reasoningIndex }),
                    imageModelIds: getLineageAssignmentMediaModelIds(lineagePlan.runAssignments, 'image'),
                    videoModelIds: getLineageAssignmentMediaModelIds(lineagePlan.runAssignments, 'video'),
                },
            }]
        }

        return assignments.map((assignment) => {
            const generationRun = buildGenerationRunFromLineageAssignment(lineagePlan, assignment, sourceGenerationRun)
            const relatedAssignments = getRelatedLineageAssignments(lineagePlan, assignment)
            const reasoningModelId = assignment.reasoningModelId ?? generationRun?.reasoningModelId
            return {
                assignment,
                generationRun,
                pendingState: {
                    phase: 'preflight',
                    promptText: assignment.promptText || lineagePlan.promptText,
                    reasoningModelIds: uniqueAiModelIds([reasoningModelId]),
                    ...(reasoningModelId ? { reasoningModelId } : {}),
                    reasoningIndex: getLineageAssignmentReasoningIndex(lineagePlan, assignment, sourceGenerationRun),
                    imageModelIds: getLineageAssignmentMediaModelIds(relatedAssignments, 'image'),
                    videoModelIds: getLineageAssignmentMediaModelIds(relatedAssignments, 'video'),
                },
            }
        })
    }

    function insertPendingBranchMarkersFromLineagePlan(
        threadId: string,
        lineagePlan: MediaBranchLineagePlan,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): void {
        if (!currentCanvasState) return

        const lineagePlacementKey = `${threadId}:${lineagePlan.generationRequestId}`
        if (hasPendingBranchMarkerForPlacement(threadId)
            || hasPendingBranchMarkerForPlacement(lineagePlacementKey)
            || hasCanvasBranchMarkerForPlacement(threadId)
            || hasCanvasBranchMarkerForPlacement(lineagePlacementKey)) return

        const pendingSpecs = buildPendingBranchMarkerSpecsFromLineagePlan(lineagePlan, sourceGenerationRun)
        const pendingNodes: BranchLineCanvasNode[] = []
        const screenFixedDimensionsByIndex = pendingSpecs.map(spec =>
            getBranchMarkerScreenFixedDimensions(spec.pendingState.promptText)
        )
        const stackOffsets = getPendingBranchMarkerStackOffsets(screenFixedDimensionsByIndex)
        const stackHeight = getPendingBranchMarkerStackHeight(screenFixedDimensionsByIndex)

        pendingSpecs.forEach((spec, index) => {
            const promptText = spec.pendingState.promptText
            const dimensions = getBranchMarkerContentDimensions(promptText)
            const screenFixedDimensions = screenFixedDimensionsByIndex[index] ?? getBranchMarkerScreenFixedDimensions(promptText)
            const projection = getPendingBranchMarkerScreenProjection(screenFixedDimensions, stackOffsets[index] ?? 0, stackHeight)
            const nodeId = spec.assignment?.branchForkNodeId
                ?? spec.assignment?.branchLineNodeId
                ?? spec.assignment?.branchOriginNodeId
                ?? `pending-branch-${uuidv4()}`
            const existingMarker = currentCanvasState?.nodes.find((node: CanvasNode): node is BranchMarkerNode =>
                node.nodeId === nodeId && isBranchMarkerNode(node)
            )
            const placementKey = spec.generationRun
                ? getGeneratedMediaPlacementKey(threadId, spec.generationRun)
                : lineagePlacementKey
            if (existingMarker) {
                console.error('[CANVAS] API lineage plan attempted to reuse an existing marker as a transient marker.', {
                    nodeId,
                    generationRequestId: lineagePlan.generationRequestId,
                    existingGenerationRequestId: existingMarker.generationRequestId,
                })
                return
            }
            const pendingNode: BranchLineCanvasNode = resizeBranchMarkerNodeFromProseMirror({
                nodeId,
                type: 'branchLine',
                branchId: `pending-${lineagePlan.generationRequestId}-${index}`,
                generationRequestId: lineagePlan.generationRequestId,
                conversationAssetId: threadId,
                ...(spec.pendingState.reasoningModelId ? { reasoningModelId: spec.pendingState.reasoningModelId } : {}),
                ...(spec.pendingState.reasoningIndex == null ? {} : { reasoningIndex: spec.pendingState.reasoningIndex }),
                pendingState: spec.pendingState,
                position: projection.position,
                dimensions,
                temporary: true,
            } as BranchLineCanvasNode) as BranchLineCanvasNode
            const record: PendingBranchMarkerRecord = {
                nodeId,
                placementKey,
                threadId,
                ...(spec.pendingState.reasoningModelId ? { reasoningModelId: spec.pendingState.reasoningModelId } : {}),
                ...(spec.pendingState.reasoningIndex == null ? {} : { reasoningIndex: spec.pendingState.reasoningIndex }),
            }
            pendingBranchMarkers.set(placementKey, record)
            if (spec.generationRun) setPendingBranchMarkerRecordAliases(threadId, spec.generationRun, record)
            if (pendingSpecs.length === 1) pendingBranchMarkers.set(threadId, record)
            branchMarkerUiPhaseByNodeId.set(nodeId, 'preflight')
            pendingNodes.push(pendingNode)
        })

        if (pendingNodes.length === 0) return
        commitTransientCanvasStatePreservingEditors({
            ...currentCanvasState,
            nodes: [...currentCanvasState.nodes, ...pendingNodes],
        })
        for (const pendingNode of pendingNodes) {
            appendBranchLineNodeToDOM(pendingNode)
        }
        syncPendingBranchMarkerScreenPlacements()
    }

    function applyMediaBranchLineagePlan(
        threadId: string,
        lineagePlan: MediaBranchLineagePlan,
        generationRun?: MediaGenerationRunMeta,
    ): void {
        const placement = ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun, {
            ...(lineagePlan.placementAnchorNodeId ? { placementAnchorNodeId: lineagePlan.placementAnchorNodeId } : {}),
            referenceNodeIds: lineagePlan.referenceNodeIds,
            lineagePlan,
            promptText: lineagePlan.promptText,
            createdAt: lineagePlan.createdAt,
        })
        if (!placement) return

        const nextPlacement: PendingGeneratedImagePlacement = {
            ...placement,
            lineagePlan,
            ...(lineagePlan.placementAnchorNodeId ? { placementAnchorNodeId: lineagePlan.placementAnchorNodeId } : {}),
            referenceNodeIds: lineagePlan.referenceNodeIds,
            activeRunKeys: new Set([
                ...(placement.activeRunKeys ?? []),
                ...lineagePlan.runAssignments
                    .map(assignment => assignment.mediaRunId ?? assignment.reasoningRunId)
                    .filter((runKey): runKey is string => Boolean(runKey)),
            ]),
        }
        setPendingGeneratedMediaPlacement(threadId, generationRun, nextPlacement)
        setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), lineagePlan.referenceNodeIds)
        if (lineagePlan.regenerationTarget) {
            resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)
            return
        }
        insertPendingBranchMarkersFromLineagePlan(threadId, lineagePlan, generationRun)
        syncPendingBranchMarkerScreenPlacements()
        resolvePendingBranchMarkersForLineagePlan(threadId, lineagePlan, generationRun)
        cleanupOrphanPreflightMarkersForThread(threadId)
    }

    function resolvePendingBranchMarkersForLineagePlan(
        threadId: string,
        lineagePlan: MediaBranchLineagePlan,
        sourceGenerationRun?: MediaGenerationRunMeta,
    ): void {
        const assignments = getUniqueLineageAssignmentsForMarkers(lineagePlan)
        if (assignments.length === 0) {
            resolvePendingBranchMarkerWithLineagePlan(threadId, sourceGenerationRun)
            return
        }

        for (const assignment of assignments) {
            resolvePendingBranchMarkerWithLineagePlan(
                threadId,
                buildGenerationRunFromLineageAssignment(lineagePlan, assignment, sourceGenerationRun),
            )
        }
    }

    // After the API lineage plan is applied, every surviving preflight pill must
    // be backed by a pending record (multi-reasoning runs keep one per pending
    // run). Anything else is an orphan left behind by a transient preflight
    // reattach race and would render as a duplicate of the promoted marker.
    function cleanupOrphanPreflightMarkersForThread(threadId: string): void {
        if (!currentCanvasState) return
        const recordedNodeIds = new Set(
            [...pendingBranchMarkers.values()].map(record => record.nodeId)
        )
        const orphanNodeIds = currentCanvasState.nodes
            .filter((node: CanvasNode): node is BranchMarkerNode =>
                isBranchMarkerNode(node)
                && node.pendingState?.phase === 'preflight'
                && getBranchMarkerThreadId(node) === threadId
                && !recordedNodeIds.has(node.nodeId)
            )
            .map(node => node.nodeId)
        cleanupBranchMarkerArtifacts(orphanNodeIds)
        if (orphanNodeIds.length > 0) {
            commitCanvasStatePreservingEditors({
                ...currentCanvasState,
                nodes: currentCanvasState.nodes.filter((node: CanvasNode) => !orphanNodeIds.includes(node.nodeId)),
                edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                    !orphanNodeIds.includes(edge.sourceNodeId) && !orphanNodeIds.includes(edge.targetNodeId)
                ),
            })
        }
        // A stale overlay pill can also survive with no matching state node at
        // all (the state was replaced under it). Sweep overlay elements whose
        // node ids are neither in state nor recorded as pending.
        if (!pendingBranchMarkerOverlayEl) return
        const stateNodeIds = new Set(currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId))
        for (const el of [...pendingBranchMarkerOverlayEl.querySelectorAll('[data-node-id]')] as HTMLElement[]) {
            const nodeId = el.dataset.nodeId ?? ''
            if (!recordedNodeIds.has(nodeId) && !stateNodeIds.has(nodeId)) el.remove()
        }
    }

    function registerGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const placement = ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
        if (!placement) return

        const runKey = getGeneratedMediaRunKey(threadId, generationRun)
        const activeRunKeys = new Set(placement.activeRunKeys ?? [])
        if (generationRun?.mediaRunId && generationRun.reasoningRunId) {
            activeRunKeys.delete(generationRun.reasoningRunId)
        }
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
            clearPendingBranchMarkerStateForRun(threadId, generationRun)
            clearBranchMarkerUiPhasesForRun(threadId, generationRun)
            schedulePersistedAiChatThreadRefreshForBranchMarkers(threadId)
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
            forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
            refreshBranchMarkersForAiChatThread(threadId)
            return
        }

        const activeRunKeys = new Set(placement.activeRunKeys ?? [])
        activeRunKeys.delete(getGeneratedMediaRunKey(threadId, generationRun))
        if (generationRun.reasoningRunId) activeRunKeys.delete(generationRun.reasoningRunId)
        if (generationRun.mediaRunId) activeRunKeys.delete(generationRun.mediaRunId)
        clearPendingBranchMarkerStateForRun(threadId, generationRun)
        clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        schedulePersistedAiChatThreadRefreshForBranchMarkers(threadId)
        if (activeRunKeys.size > 0) {
            pendingGeneratedImagePlacements.set(placementKey, {
                ...placement,
                activeRunKeys,
            })
            refreshBranchMarkersForAiChatThread(threadId)
            return
        }

        pendingGeneratedImagePlacements.delete(placementKey)
        clearGeneratingReferenceNodeIds(placementKey)
        deletePendingBranchMarkerAliasesForPlacement(placementKey)
        if (placementKey !== threadId) {
            pendingBranchMarkers.delete(threadId)
            const initialReasoningModelPrefix = `${threadId}:reasoning-model:`
            for (const key of pendingBranchMarkers.keys()) {
                if (key.startsWith(initialReasoningModelPrefix)) pendingBranchMarkers.delete(key)
            }
        }
        refreshBranchMarkersForAiChatThread(threadId)

    }

    function finishFailedGeneratedMediaRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        finishGeneratedMediaRun(threadId, generationRun)
        if (pendingGeneratedImagePlacements.has(placementKey)) return

        settleDetachedCanvasRun(threadId)
        scheduleDetachedCanvasRunTeardown(threadId)
    }

    function settleBranchMarkersForGenerationRequest(
        generationRequestId: string,
        options: BranchMarkerSettlementOptions = {},
    ): void {
        if (!generationRequestId || !currentCanvasState) return

        let changed = false
        const markersToSync: BranchMarkerNode[] = []
        const nodes = currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (!isBranchMarkerNode(node) || node.generationRequestId !== generationRequestId) return node

            const hadTrackedUiPhase = branchMarkerUiPhaseByNodeId.has(node.nodeId)
            branchMarkerUiPhaseByNodeId.delete(node.nodeId)
            deletePendingBranchMarkerAliasesForNodeId(node.nodeId)
            if (!node.pendingState) {
                if (hadTrackedUiPhase) markersToSync.push(node)
                return node
            }

            const liveNode = applyBranchMarkerLiveGeometry(node)
            const settledNode = options.preserveGeometry
                ? stripPendingBranchMarkerState(liveNode) as BranchMarkerNode
                : resizeBranchMarkerNodeFromProseMirror(stripPendingBranchMarkerState(liveNode) as BranchMarkerNode)
            const positionedSettledNode = !options.preserveGeometry && manuallyPositionedBranchMarkerNodeIds.has(node.nodeId)
                ? { ...settledNode, position: liveNode.position }
                : settledNode
            markersToSync.push(positionedSettledNode)
            changed = true
            return positionedSettledNode
        })

        if (changed) {
            commitCanvasStatePreservingEditors({
                ...currentCanvasState,
                nodes,
            })
        }
        for (const marker of markersToSync) {
            syncBranchMarkerNodeContent(marker)
        }
    }

    function settleMediaGenerationRequest(
        threadId: string,
        generationRequestId: string,
        generationRun?: MediaGenerationRunMeta,
        options: BranchMarkerSettlementOptions = {},
    ): void {
        const requestPlacementKey = generationRequestId ? `${threadId}:${generationRequestId}` : ''
        const runPlacementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const placementKey = requestPlacementKey || runPlacementKey
        const placement = pendingGeneratedImagePlacements.get(placementKey)
            ?? pendingGeneratedImagePlacements.get(runPlacementKey)
            ?? pendingGeneratedImagePlacements.get(threadId)
        const lineagePlan = placement?.lineagePlan
        const plannedRuns: Array<MediaGenerationRunMeta | undefined> = lineagePlan
            ? getUniqueLineageAssignmentsForMarkers(lineagePlan)
                .map(assignment => buildGenerationRunFromLineageAssignment(lineagePlan, assignment, generationRun))
            : []
        if (plannedRuns.length === 0) plannedRuns.push(generationRun)

        for (const plannedRun of plannedRuns) {
            const targetRun = plannedRun ?? generationRun
            clearPendingBranchMarkerStateForRun(threadId, targetRun, options)
            clearBranchMarkerUiPhasesForRun(threadId, targetRun)
            forgetPendingBranchMarkerRecordForRun(threadId, targetRun)
        }
        clearPendingBranchMarkerStateForRun(threadId, generationRun, options)
        clearBranchMarkerUiPhasesForRun(threadId, generationRun)
        forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
        schedulePersistedAiChatThreadRefreshForBranchMarkers(threadId)
        if (requestPlacementKey) {
            pendingGeneratedImagePlacements.delete(requestPlacementKey)
            clearGeneratingReferenceNodeIds(requestPlacementKey)
            deletePendingBranchMarkerAliasesForPlacement(requestPlacementKey)
        }
        pendingGeneratedImagePlacements.delete(runPlacementKey)
        pendingGeneratedImagePlacements.delete(threadId)
        clearGeneratingReferenceNodeIds(runPlacementKey)
        clearGeneratingReferenceNodeIds(threadId)
        settleBranchMarkersForGenerationRequest(generationRequestId, options)
        refreshBranchMarkersForAiChatThread(threadId)
        settleDetachedCanvasRun(threadId)
        scheduleDetachedCanvasRunTeardown(threadId)
    }

    function clearPendingGeneratedMediaPlacementsForThread(threadId: string): void {
        for (const placementKey of pendingGeneratedImagePlacements.keys()) {
            if (placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
        }
        for (const placementKey of pendingBranchMarkers.keys()) {
            if (placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue
            pendingBranchMarkers.delete(placementKey)
        }
        for (const node of currentCanvasState?.nodes ?? []) {
            if (isBranchMarkerNode(node) && getBranchMarkerThreadId(node) === threadId) {
                branchMarkerUiPhaseByNodeId.delete(node.nodeId)
            }
        }
    }

    function findCanvasNodeById(nodeId: string | undefined): CanvasNode | undefined {
        if (!nodeId) return undefined
        return currentCanvasState?.nodes.find((node: CanvasNode) => node.nodeId === nodeId)
    }

    function hasGeneratedMediaChildrenForBranchMarker(markerNode: BranchMarkerNode): boolean {
        if (markerNode.type === 'branchOrigin') return getBranchOriginGeneratedMediaNodes(markerNode.nodeId).length > 0
        if (markerNode.type === 'branchFork') return getBranchForkGeneratedMediaNodes(markerNode.nodeId).length > 0
        return getBranchLineGeneratedMediaNodes(markerNode.nodeId).length > 0
    }

    function getLineagePlacementAnchorNode(threadId: string, generationRun?: MediaGenerationRunMeta): CanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const anchorNodeId = placement?.placementAnchorNodeId
            ?? placement?.lineagePlan?.placementAnchorNodeId
            ?? placement?.lineagePlan?.sourceNodeId
        return findCanvasNodeById(anchorNodeId)
    }

    function isApiFallbackBranchMarkerGeometry(
        markerNode: BranchMarkerNode,
        plannedDimensions: { width: number; height: number },
    ): boolean {
        const plannedPosition = getFreshBranchRootMarkerPosition(plannedDimensions)
        const staleLeftFallback = markerNode.position.x < plannedPosition.x - 1
        const staleVerticalFallback = Math.abs(markerNode.position.y - plannedPosition.y) > getBranchLineageNodeGap()
        const dimensionMismatch = Math.abs(markerNode.dimensions.width - plannedDimensions.width) > 1
            || Math.abs(markerNode.dimensions.height - plannedDimensions.height) > 1
        return staleLeftFallback || staleVerticalFallback || dimensionMismatch
    }

    function shouldReplaceApiFallbackFreshRootPosition(
        markerNode: BranchMarkerNode,
        threadId: string,
        plannedDimensions: { width: number; height: number },
        generationRun?: MediaGenerationRunMeta,
    ): boolean {
        return isApiFallbackBranchMarkerGeometry(markerNode, plannedDimensions)
            && !manuallyPositionedBranchMarkerNodeIds.has(markerNode.nodeId)
            && !hasGeneratedMediaChildrenForBranchMarker(markerNode)
            && !getLineagePlacementAnchorNode(threadId, generationRun)
            && !getReferenceGroupRectForGeneratedMedia(threadId, generationRun)
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
        return getExistingMediaNodeIds(aiChatPanelState.contextChips)
    }

    function findPendingLineageNode(
        nodeId: string,
        pendingNodes: Array<BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | undefined>,
    ): CanvasNode | undefined {
        return pendingNodes.find((node): node is BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode =>
            Boolean(node && node.nodeId === nodeId)
        )
    }

    function getGeneratedMediaEdgeSourceNode(
        generationRun: MediaGenerationRunMeta | undefined,
        pendingNodes: Array<BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | undefined> = [],
    ): CanvasNode | undefined {
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        const lineageParentNodeId = lineageAssignment?.lineageParentNodeId
            ?? lineageAssignment?.branchLineNodeId
            ?? lineageAssignment?.branchForkNodeId
            ?? lineageAssignment?.parentMediaNodeId
            ?? lineageAssignment?.branchOriginNodeId
        if (!lineageParentNodeId) return undefined
        return findCanvasNodeById(lineageParentNodeId)
            ?? findPendingLineageNode(lineageParentNodeId, pendingNodes)
    }

    // Resolves the API-planned fork marker declared by the lineage assignment.
    function findBranchForkPlanForRun(
        lineagePlan: MediaBranchLineagePlan | undefined,
        branchForkNodeId?: string,
    ): BranchForkLineagePlan | undefined {
        const branchForks = lineagePlan?.branchForks ?? []
        return branchForkNodeId ? branchForks.find(fork => fork.nodeId === branchForkNodeId) : undefined
    }

    function getBranchForkParentNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): CanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        const forkPlan = findBranchForkPlanForRun(placement?.lineagePlan, lineageAssignment?.branchForkNodeId)
        const parentBranchNodeId = forkPlan?.parentBranchNodeId
        if (!parentBranchNodeId) return undefined
        return findCanvasNodeById(parentBranchNodeId)
            ?? (branchOriginNode?.nodeId === parentBranchNodeId ? branchOriginNode : undefined)
    }

    function addBranchLineageMarkerNodesIfMissing(
        nodes: CanvasNode[],
        ...markerNodes: Array<BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode | undefined>
    ): CanvasNode[] {
        const existingNodeIds = new Set(nodes.map((node: CanvasNode) => node.nodeId))
        const additions = markerNodes.filter((node): node is BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode =>
            Boolean(node && !existingNodeIds.has(node.nodeId))
        )
        return additions.length > 0 ? [...nodes, ...additions] : nodes
    }

    // BranchFork and branchLine markers with a parentBranchNodeId connect to
    // that parent through the same edge builder. Parentless branchFork markers
    // are root markers, so they do not need a marker-to-marker edge.
    function createBranchMarkerEdge(markerNode: BranchForkCanvasNode | BranchLineCanvasNode): WorkspaceEdge | undefined {
        if (!markerNode.parentBranchNodeId) return undefined
        return {
            edgeId: `edge-${markerNode.parentBranchNodeId}-${markerNode.nodeId}`,
            sourceNodeId: markerNode.parentBranchNodeId,
            targetNodeId: markerNode.nodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }
    }

    function addBranchMarkerEdgeIfMissing(edges: WorkspaceEdge[], markerNode: BranchForkCanvasNode | BranchLineCanvasNode | undefined): WorkspaceEdge[] {
        if (!markerNode) return edges
        const edge = createBranchMarkerEdge(markerNode)
        if (!edge) return edges
        if (edges.some((existing: WorkspaceEdge) => existing.edgeId === edge.edgeId)) return edges
        return [...edges, edge]
    }

    function ensureBranchOriginForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        mediaHeight: number,
    ): BranchOriginCanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        if (!placement || !lineageAssignment?.branchOriginNodeId) return undefined
        const plannedBranchOriginNodeId = lineageAssignment.branchOriginNodeId
        const branchOriginPlan = placement.lineagePlan?.branchOrigin?.nodeId === plannedBranchOriginNodeId
            ? placement.lineagePlan.branchOrigin
            : undefined
        if (!branchOriginPlan) return undefined

        const nodeId = plannedBranchOriginNodeId
        const dimensions = getBranchMarkerContentDimensions(branchOriginPlan.provenance?.promptText ?? '')
        const referenceRootPosition = getReferenceBranchRootMarkerPositionForGeneratedMedia(
            threadId,
            generationRun,
            dimensions,
            mediaHeight,
            getBranchOriginOutputGap(),
        )
        const position = referenceRootPosition
            ? referenceRootPosition
            : getFreshBranchRootMarkerPosition(dimensions)
        const branchOriginNode: BranchOriginCanvasNode = {
            nodeId,
            type: 'branchOrigin',
            branchId: branchOriginPlan.branchId,
            generationRequestId: branchOriginPlan.generationRequestId,
            conversationAssetId: threadId,
            ...(branchOriginPlan.promptFingerprint ? { promptFingerprint: branchOriginPlan.promptFingerprint } : {}),
            provenance: branchOriginPlan.provenance,
            position,
            dimensions,
            temporary: true,
        }
        const existing = findCanvasNodeById(plannedBranchOriginNodeId)
        if (existing?.type === 'branchOrigin') {
            const existingBranchOrigin = existing as BranchOriginCanvasNode
            if (!shouldReplaceApiFallbackFreshRootPosition(existingBranchOrigin, threadId, dimensions, generationRun)) {
                return existingBranchOrigin
            }
            return resizeBranchMarkerNodeFromProseMirror({
                ...branchOriginNode,
                ...(existingBranchOrigin.pendingState ? { pendingState: existingBranchOrigin.pendingState } : {}),
            } as BranchOriginCanvasNode) as BranchOriginCanvasNode
        }
        return resizeBranchMarkerNodeFromProseMirror(branchOriginNode) as BranchOriginCanvasNode
    }

    function ensureBranchForkForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): BranchForkCanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        if (!placement || !generationRun || !lineageAssignment?.branchForkNodeId) return undefined
        const branchForkNodeId = lineageAssignment.branchForkNodeId

        const branchForkPlan = findBranchForkPlanForRun(placement.lineagePlan, branchForkNodeId)
        if (!branchForkPlan) return undefined

        const nodeId = branchForkNodeId
        const parentNode = getBranchForkParentNode(threadId, generationRun, branchOriginNode)
        const dimensions = getBranchMarkerContentDimensions(branchForkPlan.provenance?.promptText ?? '')
        const mediaHeight = getGeneratedMediaInsertionSize()
        const position = parentNode && branchForkPlan.parentBranchNodeId
            ? getPendingBranchMarkerPositionBeforeGeneratedMedia(
                parentNode,
                dimensions,
                getPlannedBranchMarkerSiblingSlot(threadId, generationRun, branchForkPlan.parentBranchNodeId, branchForkNodeId),
            )
            : getRootBranchMarkerPositionBeforeGeneratedMedia(
                threadId,
                generationRun,
                dimensions,
                mediaHeight,
                getPlannedRootBranchForkSiblingSlot(threadId, generationRun, branchForkNodeId),
            )

        const branchForkNode: BranchForkCanvasNode = {
            nodeId,
            type: 'branchFork',
            branchId: branchForkPlan.branchId,
            generationRequestId: branchForkPlan.generationRequestId,
            conversationAssetId: threadId,
            reasoningRunId: branchForkPlan.reasoningRunId,
            reasoningModelId: branchForkPlan.reasoningModelId,
            reasoningIndex: branchForkPlan.reasoningIndex,
            ...(branchForkPlan.parentBranchNodeId ? { parentBranchNodeId: branchForkPlan.parentBranchNodeId } : {}),
            ...(branchForkPlan.promptFingerprint ? { promptFingerprint: branchForkPlan.promptFingerprint } : {}),
            provenance: branchForkPlan.provenance,
            position,
            dimensions,
            temporary: true,
        }
        const existing = findCanvasNodeById(branchForkNodeId)
        if (existing?.type === 'branchFork') {
            const existingBranchFork = existing as BranchForkCanvasNode
            if (
                branchForkPlan.parentBranchNodeId
                || !shouldReplaceApiFallbackFreshRootPosition(existingBranchFork, threadId, dimensions, generationRun)
            ) {
                return existingBranchFork
            }
            return resizeBranchMarkerNodeFromProseMirror({
                ...branchForkNode,
                ...(existingBranchFork.pendingState ? { pendingState: existingBranchFork.pendingState } : {}),
            } as BranchForkCanvasNode) as BranchForkCanvasNode
        }
        return resizeBranchMarkerNodeFromProseMirror(branchForkNode) as BranchForkCanvasNode
    }

    function findBranchLinePlanForRun(
        lineagePlan: MediaBranchLineagePlan | undefined,
        branchLineNodeId?: string,
    ): BranchLineLineagePlan | undefined {
        const branchLines = lineagePlan?.branchLines ?? []
        return branchLineNodeId ? branchLines.find(line => line.nodeId === branchLineNodeId) : undefined
    }

    // A branchLine marks a plain continuation: the single new generation descends
    // from an existing generated branch, with this marker carrying the prompt that
    // drove the continuation. Mirrors the fork marker but is never a split.
    function ensureBranchLineForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): BranchLineCanvasNode | undefined {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        if (!placement || !generationRun || !lineageAssignment?.branchLineNodeId) return undefined
        const branchLineNodeId = lineageAssignment.branchLineNodeId

        const existing = findCanvasNodeById(branchLineNodeId)
        if (existing?.type === 'branchLine' && existing.pendingState?.phase !== 'preflight') {
            return existing as BranchLineCanvasNode
        }

        const nodeId = branchLineNodeId
        const branchLinePlan = findBranchLinePlanForRun(placement.lineagePlan, branchLineNodeId)
        if (!branchLinePlan) return undefined
        const parentBranchNodeId = branchLinePlan.parentBranchNodeId
        if (!parentBranchNodeId) return undefined
        const parentNode = findCanvasNodeById(parentBranchNodeId)
            ?? (branchOriginNode?.nodeId === parentBranchNodeId ? branchOriginNode : undefined)
        const dimensions = getBranchMarkerContentDimensions(branchLinePlan.provenance?.promptText ?? '')
        if (!parentNode) return undefined
        const siblingSlot = getPlannedBranchMarkerSiblingSlot(threadId, generationRun, parentBranchNodeId, branchLineNodeId)
        const position = getPendingBranchMarkerPositionBeforeGeneratedMedia(parentNode, dimensions, siblingSlot)

        const branchLineNode: BranchLineCanvasNode = {
            nodeId,
            type: 'branchLine',
            branchId: branchLinePlan.branchId,
            generationRequestId: branchLinePlan.generationRequestId,
            conversationAssetId: threadId,
            reasoningRunId: branchLinePlan.reasoningRunId,
            reasoningModelId: branchLinePlan.reasoningModelId,
            reasoningIndex: branchLinePlan.reasoningIndex,
            ...(branchLinePlan.mediaRunId ? { mediaRunId: branchLinePlan.mediaRunId } : {}),
            ...(branchLinePlan.mediaModelId ? { mediaModelId: branchLinePlan.mediaModelId } : {}),
            ...(branchLinePlan.mediaType ? { mediaType: branchLinePlan.mediaType } : {}),
            parentBranchNodeId,
            ...(branchLinePlan.promptFingerprint ? { promptFingerprint: branchLinePlan.promptFingerprint } : {}),
            provenance: branchLinePlan.provenance,
            position,
            dimensions,
            temporary: true,
        }
        return resizeBranchMarkerNodeFromProseMirror(branchLineNode) as BranchLineCanvasNode
    }

    // Returns the active per-generation lineage marker — a branchFork on a split,
    // a branchLine on a plain continuation — so callers chain one node before the
    // generated output regardless of which kind the API planned.
    function ensureBranchMarkerForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        branchOriginNode: BranchOriginCanvasNode | undefined,
    ): {
        branchForkNode: BranchForkCanvasNode | undefined
        branchLineNode: BranchLineCanvasNode | undefined
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode | undefined
    } {
        const branchForkNode = ensureBranchForkForGeneratedMedia(threadId, generationRun, branchOriginNode)
        const branchLineNode = branchForkNode
            ? undefined
            : ensureBranchLineForGeneratedMedia(threadId, generationRun, branchOriginNode)
        return { branchForkNode, branchLineNode, markerNode: branchForkNode ?? branchLineNode }
    }

    function appendBranchMarkerNodeToDOM(
        rebalancedNodes: CanvasNode[],
        markerNode: BranchForkCanvasNode | BranchLineCanvasNode | undefined,
    ): void {
        if (!markerNode) return
        const placed = rebalancedNodes.find((n: CanvasNode) => n.nodeId === markerNode.nodeId) ?? markerNode
        if (placed.type === 'branchFork') appendBranchForkNodeToDOM(placed as BranchForkCanvasNode)
        else if (placed.type === 'branchLine') appendBranchLineNodeToDOM(placed as BranchLineCanvasNode)
    }

    // Pending generated-media updates preserve active ProseMirror editors by
    // appending nodes manually instead of running a full renderNodes() pass. If
    // the marker already exists from preflight streaming, its DOM coordinates can
    // still be stale after the rebalance pipeline moves it into the final
    // connector midpoint. Sync geometry and content together so visible marker,
    // connection anchors, and canvas state stay on the same coordinate frame.
    function syncExistingBranchMarkerNodeToDOM(branchMarkerNode: BranchMarkerNode): void {
        const nodeEl = findBranchMarkerNodeElForNode(branchMarkerNode)
        if (!nodeEl) return
        if (branchMarkerNode.pendingState?.phase !== 'preflight' && nodeEl.parentElement === pendingBranchMarkerOverlayEl) {
            viewportEl.appendChild(nodeEl)
            nodeEl.classList.remove('workspace-branch-marker-screen-fixed')
            nodeEl.style.removeProperty('z-index')
            connectionManager?.registerNodeElement(branchMarkerNode.nodeId, nodeEl as HTMLDivElement)
        }
        syncCanvasNodeDomGeometry([branchMarkerNode])
        syncBranchMarkerNodeContent(branchMarkerNode, nodeEl)
        syncConnectionsAfterManualNodeAppend()
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

    function clearGeneratingReferenceNodeIdsForPromptHandoff(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        const keysToClear = new Set<string>([
            threadId,
            getGeneratedMediaPlacementKey(threadId, generationRun),
        ])
        let didClear = false
        for (const key of keysToClear) {
            didClear = generatingReferenceNodeIdsByThread.delete(key) || didClear
        }
        if (didClear) syncPixiGeneratingImageNodes()
    }

    function clearGeneratingReferencesOnFirstPixels(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        clearGeneratingReferenceNodeIdsForPromptHandoff(threadId, generationRun)
    }

    function clearGeneratingReferencesAfterPromptHandoff(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        clearGeneratingReferenceNodeIdsForPromptHandoff(threadId, generationRun)
    }

    function getPersistedAiChatThread(threadId: string): AiChatThread | undefined {
        return currentAiChatThreads.find((candidate: AiChatThread) => candidate.threadId === threadId)
    }

    function rememberAiChatThreadContent(threadId: string, content: object): void {
        const thread = getPersistedAiChatThread(threadId)
        if (!thread) return

        const updatedThread = {
            ...thread,
            content,
            updatedAt: Math.max(thread.updatedAt, Date.now()),
        }
        currentAiChatThreads = currentAiChatThreads.some((candidate: AiChatThread) => candidate.threadId === threadId)
            ? currentAiChatThreads.map((candidate: AiChatThread) => candidate.threadId === threadId ? updatedThread : candidate)
            : [...currentAiChatThreads, updatedThread]
    }

    function rememberAiChatThreadRecord(thread: AiChatThread): void {
        currentAiChatThreads = currentAiChatThreads.some((candidate: AiChatThread) => candidate.threadId === thread.threadId)
            ? currentAiChatThreads.map((candidate: AiChatThread) => candidate.threadId === thread.threadId ? thread : candidate)
            : [...currentAiChatThreads, thread]
    }

    async function refreshPersistedAiChatThreadForBranchMarkers(threadId: string): Promise<void> {
        const asset = await assetService.get(threadId)
        if ('error' in asset || !asset.documents.conversation) return
        await assetService.resumeDocument({
            organizationId: asset.organizationId,
            assetId: asset.assetId,
            role: 'conversation',
        })
        const snapshot = assetDocumentsStore.get(asset.assetId, 'conversation')
        if (!snapshot) return
        const thread = {
            threadId: asset.assetId,
            assetId: asset.assetId,
            organizationId: asset.organizationId,
            workspaceId,
            title: asset.title,
            content: snapshot.doc,
            proseMirrorVersion: snapshot.version,
            status: asset.states.conversation,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            aiModel: '',
        } as AiChatThread

        const currentThread = getPersistedAiChatThread(threadId)
        const currentVersion = getStoredProseMirrorVersion(currentThread)
        const fetchedVersion = getStoredProseMirrorVersion(thread)
        if (fetchedVersion < currentVersion) return

        rememberAiChatThreadRecord(thread)
        liveAiChatThreadContentOverrides.delete(threadId)
        refreshBranchMarkersForAiChatThread(threadId)
        refreshGeneratedMediaProjectionsForAiChatThread(threadId)
    }

    function schedulePersistedAiChatThreadRefreshForBranchMarkers(threadId: string): void {
        for (const timer of pendingAiChatThreadRefreshTimers.get(threadId) ?? []) {
            window.clearTimeout(timer)
        }

        const timers = [400, 1400, 3000].map(delayMs =>
            window.setTimeout(() => {
                void refreshPersistedAiChatThreadForBranchMarkers(threadId).catch((error) => {
                    console.error('[CANVAS] failed to refresh AI chat thread after media completion', { threadId, error })
                })
            }, delayMs)
        )
        pendingAiChatThreadRefreshTimers.set(threadId, timers)
    }

    function getAiChatThreadContentForProjection(threadId: string): unknown {
        return liveAiChatThreadContentOverrides.get(threadId)
            ?? getPersistedAiChatThread(threadId)?.content
    }

    function getGeneratedMediaHistoryContent(node: ImageCanvasNode | VideoCanvasNode): unknown {
        // Sealed provenance is the immutable history for candidates as well as
        // accepted outputs. Replay controls are enabled only after it exists, so
        // reading it here keeps the UI descriptor identical to the API source.
        const provenanceDocument = assetDocumentsStore.get(node.assetId, 'provenance')?.doc
        if (provenanceDocument) return provenanceDocument
        return getAiChatThreadContentForProjection(node.generatedBy?.conversationAssetId ?? '')
    }

    function getAiChatThreadContentForBranchMarker(threadId: string): unknown {
        return getAiChatThreadContentForProjection(threadId)
    }

    function getBranchMarkerThreadId(node: BranchMarkerNode): string {
        return node.conversationAssetId ?? ''
    }

    function parseBranchMarkerReasoningIndex(value: unknown): number | null {
        if (value === null || value === undefined || value === '') return null
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    function getBranchMarkerReasoningModelId(node: BranchMarkerNode): string {
        if (node.type === 'branchOrigin') return node.pendingState?.reasoningModelId ?? ''
        const runNode = node as BranchForkCanvasNode | BranchLineCanvasNode
        return node.pendingState?.reasoningModelId
            ?? runNode.reasoningModelId
            ?? runNode.provenance?.reasoningModelId
            ?? ''
    }

    function getBranchMarkerReasoningIndex(node: BranchMarkerNode): number | null {
        if (node.type === 'branchOrigin') return parseBranchMarkerReasoningIndex(node.pendingState?.reasoningIndex)
        const runNode = node as BranchForkCanvasNode | BranchLineCanvasNode
        return parseBranchMarkerReasoningIndex(node.pendingState?.reasoningIndex ?? runNode.reasoningIndex)
    }

    function getBranchMarkerPlacementKeys(node: BranchMarkerNode): string[] {
        const threadId = getBranchMarkerThreadId(node)
        if (!threadId) return []

        const keys = [threadId]
        if (node.generationRequestId && node.generationRequestId !== threadId) {
            keys.push(`${threadId}:${node.generationRequestId}`)
        }
        return Array.from(new Set(keys))
    }

    function assignmentMatchesBranchMarker(assignment: MediaRunLineageAssignment, node: BranchMarkerNode): boolean {
        if (assignment.branchOriginNodeId === node.nodeId) return true
        if (assignment.branchForkNodeId === node.nodeId) return true
        if (assignment.branchLineNodeId === node.nodeId) return true
        if (node.type === 'branchFork' && node.reasoningRunId && assignment.reasoningRunId === node.reasoningRunId) return true
        if (node.type === 'branchLine' && node.reasoningRunId && assignment.reasoningRunId === node.reasoningRunId) return true
        if (node.type === 'branchLine' && node.mediaRunId && assignment.mediaRunId === node.mediaRunId) return true
        return false
    }

    function isLineageAssignmentActive(assignment: MediaRunLineageAssignment, activeRunKeys: Set<string>): boolean {
        return Boolean(
            (assignment.mediaRunId && activeRunKeys.has(assignment.mediaRunId))
            || (assignment.reasoningRunId && activeRunKeys.has(assignment.reasoningRunId))
        )
    }

    function isBranchMarkerGenerationActive(node: BranchMarkerNode): boolean {
        if (isBranchMarkerGenerationCancelled(node)) return false
        if (hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)) return false
        if (node.pendingState || isBranchMarkerPendingForUi(node)) return true

        for (const placementKey of getBranchMarkerPlacementKeys(node)) {
            const placement = pendingGeneratedImagePlacements.get(placementKey)
            const activeRunKeys = placement?.activeRunKeys
            if (!activeRunKeys?.size) continue

            const assignments = placement.lineagePlan?.runAssignments ?? []
            if (assignments.length === 0) return true

            const matchingAssignments = assignments.filter(assignment => assignmentMatchesBranchMarker(assignment, node))
            if (matchingAssignments.length === 0) continue

            if (matchingAssignments.some(assignment => isLineageAssignmentActive(assignment, activeRunKeys))) return true
        }

        return false
    }

    function isBranchMarkerGenerationGroupActive(node: BranchMarkerNode): boolean {
        if (isBranchMarkerGenerationCancelled(node)) return false
        const generatedMediaNodes = getBranchMarkerGeneratedMediaNodes(node)
        const everyGeneratedMediaNodeCompleted = generatedMediaNodes.length > 0
            && generatedMediaNodes.every((mediaNode) =>
                assetsStore.get(mediaNode.assetId)?.media?.renditions.original?.status === 'ready')
        if (everyGeneratedMediaNodeCompleted) return false
        if (node.pendingState || isBranchMarkerPendingForUi(node)) return true

        const threadId = getBranchMarkerThreadId(node)
        const generationRequestId = node.generationRequestId
        for (const [placementKey, placement] of pendingGeneratedImagePlacements.entries()) {
            if (!placement.activeRunKeys?.size) continue
            if (threadId && placementKey !== threadId && !placementKey.startsWith(`${threadId}:`)) continue

            const lineagePlan = placement.lineagePlan
            if (lineagePlan && lineagePlanReferencesBranchMarkerNode(lineagePlan, node)) return true
            if (generationRequestId && lineagePlan?.generationRequestId === generationRequestId) return true
            if (threadId && generationRequestId && placementKey === `${threadId}:${generationRequestId}`) return true
            if (threadId && generationRequestId && !generationRequestId.startsWith('canvas-') && placementKey === threadId) return true
        }

        return false
    }

    function getBranchMarkerTurnDescriptor(node: BranchMarkerNode): BranchMarkerTurnDescriptor {
        const reasoningRunId = node.type === 'branchOrigin'
            ? ''
            : (node as BranchForkCanvasNode | BranchLineCanvasNode).reasoningRunId ?? ''
        const markerNodeAttr = node.type === 'branchOrigin'
            ? 'branchOriginNodeId' as const
            : node.type === 'branchFork'
                ? 'branchForkNodeId' as const
                : 'branchLineNodeId' as const
        // 'canvas-' ids are synthetic client placeholders, never present in the doc.
        const generationRequestId = node.generationRequestId && !node.generationRequestId.startsWith('canvas-')
            ? node.generationRequestId
            : undefined

        return {
            ...(generationRequestId ? { generationRequestId } : {}),
            ...(reasoningRunId ? { reasoningRunId } : {}),
            ...(getBranchMarkerReasoningModelId(node) ? { reasoningModelId: getBranchMarkerReasoningModelId(node) } : {}),
            reasoningIndex: getBranchMarkerReasoningIndex(node),
            markerNodeId: node.nodeId,
            markerNodeAttr,
        }
    }

    function getBranchMarkerConversationPreview(node: BranchMarkerNode): BranchMarkerConversationPreview | null {
        const threadId = getBranchMarkerThreadId(node)
        if (!threadId) return null

        const preview = getBranchMarkerConversationPreviewFromThreadContent(
            getAiChatThreadContentForBranchMarker(threadId),
            threadId,
            getBranchMarkerTurnDescriptor(node),
            { generationActive: isBranchMarkerGenerationActive(node) },
        )
        if (!preview || !isBranchMarkerGenerationCancelled(node)) return preview
        return {
            ...preview,
            phase: 'done',
            isReceiving: false,
            streamIsReceiving: false,
        }
    }

    function shouldShowBranchMarkerResponseLine(
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): boolean {
        return shouldShowBranchMarkerConversationResponseLine(preview)
    }

    function resizeBranchMarkerNodeFromProseMirror(node: BranchMarkerNode): BranchMarkerNode {
        const preview = getBranchMarkerConversationPreview(node)
        return resizeBranchMarkerNodeToDimensions(
            node,
            getBranchMarkerContentDimensions(preview?.userText ?? getBranchMarkerPromptText(node), {
                responseLine: shouldShowBranchMarkerResponseLine(node, preview),
                responseText: preview?.responseText ?? '',
            }),
        )
    }

    function getBranchMarkerScreenFixedDimensionsForNode(node: BranchMarkerNode): { width: number; height: number } {
        const preview = getBranchMarkerConversationPreview(node)
        return getBranchMarkerScreenFixedDimensions(
            preview?.userText ?? getBranchMarkerPromptText(node),
            {
                responseLine: shouldShowBranchMarkerResponseLine(node, preview),
                responseText: preview?.responseText ?? '',
            },
        )
    }

    function applyBranchMarkerLiveGeometry<T extends BranchMarkerNode>(node: T): T {
        const override = liveNodeOverrides.get(node.nodeId)
        if (!override?.position && !override?.dimensions) return node
        return {
            ...node,
            ...(override.position ? { position: override.position } : {}),
            ...(override.dimensions ? { dimensions: override.dimensions } : {}),
        } as T
    }

    function refreshBranchMarkersForAiChatThread(threadId: string): void {
        if (!currentCanvasState) return

        const markersWithClearedProjectionGeometry: BranchMarkerNode[] = []
        const resizedOnCanvasMarkersById = new Map<string, BranchMarkerNode>()
        let syncedPreflightMarkerContent = false

        for (const node of currentCanvasState.nodes) {
            if (!isBranchMarkerNode(node) || getBranchMarkerThreadId(node) !== threadId) continue

            if (node.pendingState?.phase === 'preflight') {
                syncBranchMarkerNodeContent(resizeBranchMarkerNodeFromProseMirror(applyBranchMarkerLiveGeometry(node)))
                syncedPreflightMarkerContent = true
                continue
            }

            if (branchMarkerProjectionOverrideNodeIds.has(node.nodeId)) {
                liveNodeOverrides.delete(node.nodeId)
                branchMarkerProjectionOverrideNodeIds.delete(node.nodeId)
                markersWithClearedProjectionGeometry.push(node)
            }

            const resizedNode = resizeBranchMarkerNodeFromProseMirror(applyBranchMarkerLiveGeometry(node))
            if (resizedNode.dimensions.width !== node.dimensions.width
                || resizedNode.dimensions.height !== node.dimensions.height
                || resizedNode.position.x !== node.position.x
                || resizedNode.position.y !== node.position.y) {
                resizedOnCanvasMarkersById.set(node.nodeId, resizedNode)
            }
            syncBranchMarkerNodeContent(resizedNode)
        }
        if (resizedOnCanvasMarkersById.size > 0) {
            commitTransientCanvasStatePreservingEditors({
                ...currentCanvasState,
                nodes: currentCanvasState.nodes.map((node: CanvasNode): CanvasNode =>
                    resizedOnCanvasMarkersById.get(node.nodeId) ?? node
                ),
            })
        }
        if (markersWithClearedProjectionGeometry.length > 0 && resizedOnCanvasMarkersById.size === 0) {
            syncCanvasNodeDomGeometry(markersWithClearedProjectionGeometry)
            connectionManager?.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
            scheduleEdgesRender()
        }
        if (syncedPreflightMarkerContent) syncPendingBranchMarkerScreenPlacements()
    }

    function refreshBranchMarkerPreviewsForLoadedThreads(threads: AiChatThread[]): void {
        for (const thread of threads) {
            refreshBranchMarkersForAiChatThread(thread.threadId)
        }
    }

    function hasOpenGeneratedMediaProjectionForAiChatThread(threadId: string): boolean {
        if (!currentCanvasState) return false
        return currentCanvasState.nodes.some((node: CanvasNode) => {
            if ((node.type === 'image' || node.type === 'video')
                && expandedGeneratedMediaHistoryNodeIds.has(node.nodeId)
                && node.generatedBy?.conversationAssetId === threadId) {
                return true
            }

            if ((node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine')
                && node.conversationAssetId === threadId) {
                if (node.type === 'branchOrigin') return expandedBranchOriginInfoNodeIds.has(node.nodeId)
                return node.type === 'branchFork'
                    ? expandedBranchForkInfoNodeIds.has(node.nodeId)
                    : expandedBranchLineInfoNodeIds.has(node.nodeId)
            }

            return false
        })
    }

    function refreshGeneratedMediaProjectionsForAiChatThread(threadId: string): void {
        if (hasOpenGeneratedMediaProjectionForAiChatThread(threadId)) {
            scheduleGeneratedMediaChromeSync()
        }
    }

    function getGeneratedImageTextByNodeIdForThread(threadId: string): Record<string, string> {
        return getGeneratedImageTextByNodeIdFromThreadContent(
            getAiChatThreadContentForBranchMarker(threadId),
            currentCanvasState?.nodes ?? [],
            threadId
        )
    }

    // A new generated output is positioned relative to its most recent sibling.
    // Both images and videos count as siblings here — otherwise a freshly
    // generated video cannot "see" a previously generated video and the two
    // stack on the same spot. Both node types expose the shared fields used
    // below (generatedBy.createdAt, position).
    function getGeneratedMediaOutputs(sourceNode: CanvasNode, nodes: CanvasNode[], edges: WorkspaceEdge[]): (ImageCanvasNode | VideoCanvasNode)[] {
        return nodes.filter((node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode => {
            if ((node.type !== 'image' && node.type !== 'video') || node.parentId) return false
            if (!node.generatedBy) return false
            return edges.some((edge: WorkspaceEdge) => edge.sourceNodeId === sourceNode.nodeId && edge.targetNodeId === node.nodeId)
        })
    }

    function getMostRecentGeneratedMediaOutput(outputs: (ImageCanvasNode | VideoCanvasNode)[]): ImageCanvasNode | VideoCanvasNode | undefined {
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

    function getReferenceBranchRootMarkerPositionForGeneratedMedia(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        markerDimensions: { width: number; height: number },
        mediaHeight: number,
        markerToMediaGap: number,
    ): { x: number; y: number } | undefined {
        const referenceGroupRect = getReferenceGroupRectForGeneratedMedia(threadId, generationRun)
        if (!referenceGroupRect) return undefined
        return computeReferenceBranchRootMarkerPosition({
            referenceGroupRect,
            mediaHeight,
            markerDimensions,
            rootToFirstMediaGap: getRootBranchMarkerOutputGap(),
            markerToMediaGap,
            referenceToMarkerMinGap: getBranchLineageNodeGap(),
        })
    }

    function getNextGeneratedMediaPosition(sourceNode: CanvasNode, mediaHeight: number): { x: number; y: number } {
        const nodes = currentCanvasState?.nodes || []
        const edges = currentCanvasState?.edges ?? []
        const existingMediaOutputs = getGeneratedMediaOutputs(sourceNode, nodes, edges)
        const previousOutput = getMostRecentGeneratedMediaOutput(existingMediaOutputs)
        const anchorRect = previousOutput ? getNodeWorldRect(previousOutput) : getNodeWorldRect(sourceNode)

        return computeLineageContinuationPositionToRightOfRect(
            anchorRect,
            mediaHeight,
            previousOutput ? settings.mediaBranchLineage.mediaToMediaGap : getGeneratedMediaOutputGap(sourceNode)
        )
    }

    function createGeneratedImageEdge(sourceNode: CanvasNode, imageNodeId: string, responseMessageId?: string): WorkspaceEdge {
        return {
            edgeId: `edge-${sourceNode.nodeId}-${imageNodeId}`,
            sourceNodeId: sourceNode.nodeId,
            targetNodeId: imageNodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
        }
    }

    // Document node titles for the workspace context snapshot. Media nodes carry
    // their own descriptor, so only document nodes need a store lookup; a missing
    // title is simply omitted from the snapshot.
    function buildWorkspaceContextTitlesByNodeId(nodes: CanvasNode[]): Record<string, string> {
        const assetTitleById = new Map<string, string>(currentDocuments.map((doc) => [doc.documentId, doc.title]))
        const titlesByNodeId: Record<string, string> = {}
        for (const node of nodes) {
            if (node.type === 'document') {
                const title = assetTitleById.get(node.assetId)
                if (title) titlesByNodeId[node.nodeId] = title
            }
        }
        return titlesByNodeId
    }

    function rememberStandaloneGeneratedImagePlacement(
        threadId: string,
        messages: any[],
        hasImageModel: boolean,
    ): { promptText: string; mediaBranchCandidateSnapshot?: MediaBranchCandidateSnapshot } {
        if (!hasImageModel) {
            clearPendingGeneratedMediaPlacementsForThread(threadId)
            return { promptText: '' }
        }

        const promptText = getPromptTextFromMessages(messages)
        const referenceNodeIds = getStandaloneGeneratedMediaReferenceNodeIds()
        const activeTargetNodeId = referenceNodeIds.length === 1 ? referenceNodeIds[0] : undefined
        const mediaBranchCandidateSnapshot = buildMediaBranchCandidateSnapshot({
            regionNodeId: `standalone:${threadId}`,
            conversationAssetId: threadId,
            activeTargetNodeId,
            nodes: currentCanvasState?.nodes ?? [],
            edges: currentCanvasState?.edges ?? [],
            prompt: promptText,
            contextMediaNodeIds: referenceNodeIds,
            generatedImageTextByNodeId: getGeneratedImageTextByNodeIdForThread(threadId),
        })
        const candidateNodeIds = mediaBranchCandidateSnapshot.candidates.map((candidate: MediaBranchCandidateSnapshot['candidates'][number]) => candidate.nodeId)
        if (candidateNodeIds.length === 0) {
            pendingGeneratedImagePlacements.set(threadId, {
                referenceNodeIds,
                promptText,
                mediaBranchCandidateSnapshot,
                createdAt: Date.now(),
            })
            setGeneratingReferenceNodeIds(threadId, referenceNodeIds)
            console.info('[CANVAS] standalone image branch candidate snapshot', {
                threadId,
                candidateCount: 0,
                promptFingerprint: mediaBranchCandidateSnapshot.promptFingerprint,
                activeTargetNodeId: mediaBranchCandidateSnapshot.activeTargetNodeId,
                candidateNodeIds,
            })
            return { promptText, mediaBranchCandidateSnapshot }
        }
        const placementAnchorNodeId = referenceNodeIds[0] ?? activeTargetNodeId ?? candidateNodeIds[0]
        pendingGeneratedImagePlacements.set(threadId, {
            ...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),
            referenceNodeIds: candidateNodeIds,
            promptText,
            mediaBranchCandidateSnapshot,
            createdAt: Date.now(),
        })
        setGeneratingReferenceNodeIds(threadId, candidateNodeIds)
        console.info('[CANVAS] standalone image branch candidate snapshot', {
            threadId,
            candidateCount: mediaBranchCandidateSnapshot.candidates.length,
            promptFingerprint: mediaBranchCandidateSnapshot.promptFingerprint,
            activeTargetNodeId: mediaBranchCandidateSnapshot.activeTargetNodeId,
            candidateNodeIds,
        })
        return { promptText, mediaBranchCandidateSnapshot }
    }

    function getPendingGeneratedImageLineage(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): Partial<NonNullable<ImageCanvasNode['generatedBy']>> {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        if (!lineageAssignment) return {}

        const resolution = placement?.mediaBranchResolution

        return {
            generationRequestId: lineageAssignment.generationRequestId,
            reasoningRunId: lineageAssignment.reasoningRunId,
            mediaRunId: lineageAssignment.mediaRunId,
            reasoningModelId: lineageAssignment.reasoningModelId,
            mediaModelId: lineageAssignment.mediaModelId,
            mediaType: lineageAssignment.mediaType,
            variantIndex: generationRun?.variantIndex,
            branchOriginNodeId: lineageAssignment.branchOriginNodeId,
            branchForkNodeId: lineageAssignment.branchForkNodeId,
            branchLineNodeId: lineageAssignment.branchLineNodeId,
            branchId: lineageAssignment.branchId,
            parentMediaNodeId: lineageAssignment.parentMediaNodeId,
            parentImageNodeId: lineageAssignment.parentImageNodeId,
            sourceContextNodeIds: lineageAssignment.sourceContextNodeIds,
            referenceImageNodeIds: lineageAssignment.referenceNodeIds,
            operationKind: lineageAssignment.operationKind,
            promptText: lineageAssignment.promptText,
            promptFingerprint: lineageAssignment.promptFingerprint,
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
            resolverVersion: resolution?.resolverVersion ?? placement?.mediaBranchCandidateSnapshot?.resolverVersion,
            createdAt: lineageAssignment.createdAt,
        }
    }

    function uniqueStringValues(values: string[]): string[] {
        return Array.from(new Set(values.filter(Boolean)))
    }

    function isGeneratedMediaNode(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode {
        return (node.type === 'image' || node.type === 'video') && Boolean(node.generatedBy?.branchId)
    }

    function isBranchTreeCanvasNode(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode | BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode {
        return isGeneratedMediaNode(node) || node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }

    function pruneOrphanBranchMarkers(nodes: CanvasNode[], edges: WorkspaceEdge[]): { nodes: CanvasNode[]; edges: WorkspaceEdge[] } {
        const referencedOriginNodeIds = new Set<string>()
        const referencedForkNodeIds = new Set<string>()
        const referencedLineNodeIds = new Set<string>()
        for (const node of nodes) {
            if (node.type !== 'image' && node.type !== 'video') continue
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
            edges: edges.filter((edge: WorkspaceEdge) =>
                !removedMarkerNodeIds.has(edge.sourceNodeId) && !removedMarkerNodeIds.has(edge.targetNodeId)
            ),
        }
    }

    function resolveGeneratedMediaTreeState(nodes: CanvasNode[], edges: WorkspaceEdge[]): { nodes: CanvasNode[]; edges: WorkspaceEdge[] } {
        const pruned = pruneOrphanBranchMarkers(nodes, edges)
        return {
            nodes: rebalanceGeneratedMediaTrees(pruned.nodes, pruned.edges),
            edges: pruned.edges,
        }
    }

    function getRemovedBranchMarkerNodeIds(beforeNodes: CanvasNode[], afterNodes: CanvasNode[]): string[] {
        const afterNodeIds = new Set(afterNodes.map((node: CanvasNode) => node.nodeId))
        return beforeNodes
            .filter((node: CanvasNode): node is BranchMarkerNode =>
                isBranchMarkerNode(node) && !afterNodeIds.has(node.nodeId)
            )
            .map(node => node.nodeId)
    }

    function removeFailedGeneratedMediaNodeFromCanvas(errorNodeId: string): void {
        if (!currentCanvasState) return

        const remainingNodes = currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== errorNodeId)
        const remainingEdges = currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
            edge.sourceNodeId !== errorNodeId && edge.targetNodeId !== errorNodeId
        )
        const resolvedTreeState = resolveGeneratedMediaTreeState(remainingNodes, remainingEdges)
        const removedBranchMarkerNodeIds = getRemovedBranchMarkerNodeIds(remainingNodes, resolvedTreeState.nodes)
        const nextState: CanvasState = {
            ...currentCanvasState,
            viewport: currentCanvasState.viewport,
            nodes: resolvedTreeState.nodes,
            edges: resolvedTreeState.edges,
        }
        commitCanvasStatePreservingEditors(nextState)
        viewportEl.querySelector(`[data-node-id="${errorNodeId}"]`)?.remove()
        cleanupBranchMarkerArtifacts(removedBranchMarkerNodeIds)
    }

    function ensureImageGenerationPlaceholderForRun({
        threadId,
        generationRun,
        imageUrl = '',
        assetId = '',
        imageWorkspaceId = '',
        failOnMissingLineage = false,
    }: {
        threadId: string
        generationRun?: MediaGenerationRunMeta
        imageUrl?: string
        assetId?: string
        imageWorkspaceId?: string
        failOnMissingLineage?: boolean
    }): PendingGeneratedMediaTracker | undefined {
        if (!currentCanvasState) return undefined

        const runKey = getGeneratedMediaRunKey(threadId, generationRun)
        const existingTracker = partialImageTracker.get(runKey)
        if (existingTracker) {
            clearPendingBranchMarkerStateForRun(threadId, generationRun)
            return existingTracker
        }

        const existingImageNode = findGeneratedMediaNodeForRun('image', threadId, generationRun)
        if (existingImageNode?.type === 'image') {
            if (hasGeneratedImageFrame(existingImageNode) && !imageUrl && !assetId) {
                clearPendingBranchMarkerStateForRun(threadId, generationRun)
                return undefined
            }
            const tracker = rememberPartialImageTrackerForNode(threadId, generationRun, existingImageNode)
            debugGeneratedMediaLifecycle('reattach-image-placeholder', {
                runKey,
                threadId,
                nodeId: tracker.nodeId,
                assetId: tracker.assetId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                hasReceivedFrame: tracker.hasReceivedFrame,
            })
            clearPendingBranchMarkerStateForRun(threadId, generationRun)
            if (!viewportEl.querySelector(`[data-node-id="${existingImageNode.nodeId}"]`)) {
                appendImageNodeToDOM(existingImageNode)
            } else {
                syncPixiMediaLayer(currentCanvasState)
            }
            return tracker
        }

        const imageWidth = getGeneratedMediaInsertionSize()
        const imageHeight = imageWidth
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        if (!lineageAssignment) {
            if (failOnMissingLineage) {
                console.error('[CANVAS] Missing API media lineage assignment for image placeholder', { threadId, generationRun })
                removePendingBranchMarkerForRun(threadId, generationRun)
            } else {
                debugGeneratedMediaLifecycle('skip-image-placeholder-missing-lineage', {
                    runKey,
                    threadId,
                    generationRequestId: generationRun?.generationRequestId ?? '',
                    mediaRunId: generationRun?.mediaRunId ?? '',
                })
            }
            return undefined
        }
        resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)
        const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, imageHeight)
        const { branchForkNode, branchLineNode, markerNode } = ensureBranchMarkerForGeneratedMedia(threadId, generationRun, branchOriginNode)
        const edgeSourceNode = getGeneratedMediaEdgeSourceNode(generationRun, [branchOriginNode, branchForkNode, branchLineNode])
        if (!edgeSourceNode) {
            if (failOnMissingLineage) {
                console.error('[CANVAS] Missing API media lineage parent for image placeholder', {
                    threadId,
                    lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                    generationRun,
                })
                removePendingBranchMarkerForRun(threadId, generationRun)
            } else {
                debugGeneratedMediaLifecycle('skip-image-placeholder-missing-parent', {
                    runKey,
                    threadId,
                    lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                    generationRequestId: generationRun?.generationRequestId ?? '',
                    mediaRunId: generationRun?.mediaRunId ?? '',
                })
            }
            return undefined
        }
        const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

        clearPendingBranchMarkerStateForRun(threadId, generationRun)
        const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
        const nodeId = getPendingGeneratedMediaNodeId(lineageAssignment)
        partialImageTracker.set(runKey, {
            nodeId,
            assetId: assetId || lineageAssignment.assetId,
            placementKey,
            hasReceivedFrame: Boolean(imageUrl),
            sourceNodeId: edgeSourceNode.nodeId,
        })
        pruneGeneratedMediaTrackerAliases(partialImageTracker, runKey, nodeId)
        const tracker = partialImageTracker.get(runKey)
        if (!tracker) return undefined
        debugGeneratedMediaLifecycle('create-image-placeholder', {
            runKey,
            threadId,
            nodeId,
            assetId: tracker.assetId,
            sourceNodeId: edgeSourceNode.nodeId,
            hasInitialFrame: Boolean(imageUrl),
            generationRequestId: generationRun?.generationRequestId ?? '',
            mediaRunId: generationRun?.mediaRunId ?? '',
        })

        // The node sits at its final position from insertion; the pre-frame
        // circle is a render-only treatment inside the full placeholder rect, so
        // no position swap happens when the first frame arrives.
        const position = getNextGeneratedMediaPosition(edgeSourceNode, imageHeight)

        const imageNode: ImageCanvasNode = {
            nodeId,
            type: 'image',
            assetId: assetId || lineageAssignment.assetId,
            position,
            dimensions: { width: imageWidth, height: imageHeight },
            generatedBy: {
                conversationAssetId: threadId,
                responseId: '',
                aiModel: (generationRun?.reasoningModelId ?? '') as any,
                ...(generationRun?.mediaModelId ? { mediaModelId: generationRun.mediaModelId } : {}),
                revisedPrompt: promptText,
                responseMessageId: '',
                ...getPendingGeneratedImageLineage(threadId, generationRun),
            },
        }

        const existingNodes = addBranchLineageMarkerNodesIfMissing(currentCanvasState.nodes, branchOriginNode, branchForkNode, branchLineNode)
        const existingEdges = addBranchMarkerEdgeIfMissing(currentCanvasState.edges, markerNode)
        const newEdges = [
            ...existingEdges,
            createGeneratedImageEdge(edgeSourceNode, nodeId),
        ]

        const nodesWithImage: CanvasNode[] = [...existingNodes, imageNode]
        const rebalancedNodes = rebalanceGeneratedMediaTrees(nodesWithImage, newEdges)

        const newCanvasState: CanvasState = {
            ...currentCanvasState,
            nodes: rebalancedNodes,
            edges: newEdges,
        }
        commitTransientCanvasStatePreservingEditors(newCanvasState)
        if (branchOriginNode) {
            const placedBranchOriginNode =
                (rebalancedNodes.find((n: CanvasNode) => n.nodeId === branchOriginNode.nodeId) as BranchOriginCanvasNode | undefined)
                ?? branchOriginNode
            appendBranchOriginNodeToDOM(placedBranchOriginNode)
        }
        appendBranchMarkerNodeToDOM(rebalancedNodes, markerNode)
        const placedImageNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === nodeId) as ImageCanvasNode) ?? imageNode
        appendImageNodeToDOM(placedImageNode)
        if (imageUrl) clearGeneratingReferencesOnFirstPixels(threadId, generationRun)
        return tracker
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

    function patchWorkspaceContextImprovedDescriptors(improvedDescriptors: Record<string, ContentDescriptor> | undefined): void {
        if (!improvedDescriptors || Object.keys(improvedDescriptors).length === 0) return
        void assetService.loadWorkspaceAssets(workspaceId).then(() => {
            scheduleGeneratedMediaChromeSync()
            refreshContextChipTray()
        })
    }

    function updatePendingGeneratedImageReferencesFromWorkspaceContext(
        threadId: string | undefined,
        resolution: WorkspaceContextResolution,
        generationRun?: MediaGenerationRunMeta,
    ): void {
        if (!threadId) return
        const placement = ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
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
        updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution, generationRun)
    }

    // Patch a single media node's descriptor and re-commit so the canvas chrome
    // (analyzing indicator, info panel) re-renders. No-op if the node is gone.
    function patchMediaNodeDescriptor(nodeId: string, descriptor: MediaDescriptor, title?: string): void {
        const node = getCurrentCanvasMediaNode(nodeId)
        const asset = node ? assetsStore.get(node.assetId) : undefined
        if (!asset) return
        assetsStore.upsert({ ...asset, ...(title ? { title } : {}), descriptor })
        scheduleGeneratedMediaChromeSync()
    }

    function getCurrentCanvasMediaNode(nodeId: string): ImageCanvasNode | VideoCanvasNode | undefined {
        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) return undefined
        return node
    }

    function currentMediaStillMatches(nodeId: string, stillAssetId: string): boolean {
        const node = getCurrentCanvasMediaNode(nodeId)
        return Boolean(node && getMediaDescriptorStillAssetId(node) === stillAssetId)
    }

    // Caption a media object from its pixels. `stillAssetId` is the image Asset
    // or a video Asset whose representative frame is resolved by the API, never
    // the generation prompt. Used by uploads, Media Library inserts, and completed
    // generated media so every visible description is VLM-authored.
    function scheduleCanvasMediaAnalysisRetry(nodeId: string, stillAssetId: string, analysisAttempt: number): boolean {
        const delayMs = MEDIA_DESCRIPTOR_ANALYSIS_RETRY_DELAYS_MS[analysisAttempt]
        if (delayMs === undefined) return false
        window.setTimeout(() => queueCanvasMediaAnalysis(nodeId, stillAssetId, 0, analysisAttempt + 1), delayMs)
        return true
    }

    async function analyzeCanvasMediaStill(nodeId: string, stillAssetId: string, analysisAttempt = 0): Promise<void> {
        const failed = (): MediaDescriptor => ({ ...buildAnalyzingDescriptor(), status: 'failed', updatedAt: Date.now() })
        if (!stillAssetId) {
            if (currentMediaStillMatches(nodeId, stillAssetId)) patchMediaNodeDescriptor(nodeId, failed())
            return
        }
        try {
            const result = await describeMedia({ assetId: stillAssetId })
            if (!currentMediaStillMatches(nodeId, stillAssetId)) return
            if (result.error || !result.summary) {
                if (scheduleCanvasMediaAnalysisRetry(nodeId, stillAssetId, analysisAttempt)) return
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
            }, result.title)
        } catch {
            if (!currentMediaStillMatches(nodeId, stillAssetId)) return
            if (scheduleCanvasMediaAnalysisRetry(nodeId, stillAssetId, analysisAttempt)) return
            patchMediaNodeDescriptor(nodeId, failed())
        }
    }

    function getMediaAnalysisRequestKey(nodeId: string, stillAssetId: string): string {
        return `${nodeId}:${stillAssetId}`
    }

    async function runQueuedCanvasMediaAnalysis(
        nodeId: string,
        stillAssetId: string,
        requestKey: string,
        analysisAttempt: number,
    ): Promise<void> {
        try {
            await analyzeCanvasMediaStill(nodeId, stillAssetId, analysisAttempt)
        } finally {
            mediaAnalysisRequestsInFlight.delete(requestKey)
        }
    }

    function queueCanvasMediaAnalysis(nodeId: string, stillAssetId: string | undefined, attempt = 0, analysisAttempt = 0): void {
        const hasNode = currentCanvasState?.nodes.some((node: CanvasNode) => node.nodeId === nodeId) ?? false
        if (!hasNode && attempt < 20) {
            window.setTimeout(() => queueCanvasMediaAnalysis(nodeId, stillAssetId, attempt + 1, analysisAttempt), 50)
            return
        }
        if (!stillAssetId) {
            patchMediaNodeDescriptor(nodeId, { ...buildAnalyzingDescriptor(), status: 'failed', updatedAt: Date.now() })
            return
        }
        const requestKey = getMediaAnalysisRequestKey(nodeId, stillAssetId)
        if (mediaAnalysisRequestsInFlight.has(requestKey)) return
        mediaAnalysisRequestsInFlight.add(requestKey)
        void runQueuedCanvasMediaAnalysis(nodeId, stillAssetId, requestKey, analysisAttempt)
    }

    async function refreshCompletedGeneratedMediaAsset(
        node: ImageCanvasNode | VideoCanvasNode,
        attempt = 0,
    ): Promise<void> {
        scheduleGeneratedMediaChromeSync()
        try {
            const result = await assetService.refresh(node.assetId)
            if ('error' in result) return
            scheduleGeneratedMediaChromeSync()
            syncBranchMarkerNodeContents()
            queueCanvasMediaAnalysis(node.nodeId, getMediaDescriptorStillAssetId(node))
            if (result.states.provenance !== 'sealed' && attempt < 5) {
                const retryDelaysMs = [250, 500, 1_000, 2_000, 4_000]
                window.setTimeout(() => {
                    const currentNode = getCurrentCanvasMediaNode(node.nodeId)
                    if (currentNode?.assetId === node.assetId) {
                        void refreshCompletedGeneratedMediaAsset(currentNode, attempt + 1)
                    }
                }, retryDelaysMs[attempt])
            }
        } catch (error) {
            console.error('[CANVAS] failed to refresh completed generated media Asset', error)
        }
    }

    function getMediaDescriptorStillAssetId(node: ImageCanvasNode | VideoCanvasNode): string | undefined {
        return node.assetId || undefined
    }

    function buildImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {
        return resolveMediaUrl(imageUrl, {
            apiBaseUrl,
            base64MimeType: 'image/png',
            emptyFallback: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            token,
        })
    }

    function buildStoredImageSrc(_workspaceId: string, assetId: string): string {
        return buildAssetRenditionPath(assetId, 'preview')
    }

    function buildGeneratedImageFrameSrc({
        imageUrl,
        workspaceId: imageWorkspaceId,
        assetId,
        fallbackSrc,
    }: {
        imageUrl?: string
        workspaceId: string
        assetId?: string
        fallbackSrc?: string
    }): string {
        const trimmedImageUrl = imageUrl?.trim()
        if (assetId && (!trimmedImageUrl || isAssetEndpoint(trimmedImageUrl))) return buildStoredImageSrc(imageWorkspaceId, assetId)
        if (trimmedImageUrl) return buildImageSrc(trimmedImageUrl, '', false)
        if (assetId) return buildStoredImageSrc(imageWorkspaceId, assetId)
        if (fallbackSrc) return fallbackSrc
        return buildImageSrc('', '', false)
    }

    function generatedMediaNodeMatchesGenerationRun(
        node: CanvasNode,
        mediaType: 'image' | 'video',
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): node is ImageCanvasNode | VideoCanvasNode {
        if ((node.type !== 'image' && node.type !== 'video') || node.type !== mediaType) return false
        const generatedBy = node.generatedBy
        if (!generationRun || !generatedBy || generatedBy.conversationAssetId !== threadId) return false
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        const mediaRunId = generationRun.mediaRunId ?? lineageAssignment?.mediaRunId
        if (mediaRunId && generatedBy.mediaRunId === mediaRunId) return true

        if (generatedBy.generationRequestId !== generationRun.generationRequestId) return false
        if (generationRun.mediaType && generationRun.mediaType !== mediaType) return false
        if (lineageAssignment?.mediaType && lineageAssignment.mediaType !== mediaType) return false
        if (generationRun.reasoningRunId && generatedBy.reasoningRunId && generatedBy.reasoningRunId !== generationRun.reasoningRunId) return false

        const mediaModelId = generationRun.mediaModelId ?? lineageAssignment?.mediaModelId
        if (mediaModelId) return generatedBy.mediaModelId === mediaModelId

        const branchLineNodeId = generationRun.lineageAssignment?.branchLineNodeId ?? lineageAssignment?.branchLineNodeId
        if (branchLineNodeId) return generatedBy.branchLineNodeId === branchLineNodeId

        return Boolean(generatedBy.reasoningRunId && generatedBy.reasoningRunId === generationRun.reasoningRunId)
    }

    function debugGeneratedMediaLifecycle(event: string, details: Record<string, unknown>): void {
        console.info('[CANVAS][generated-media]', event, details)
    }

    function getGeneratedMediaNodeRunKey(node: GeneratedMediaNode): string {
        const generatedBy = node.generatedBy
        if (!generatedBy) return ''
        if (generatedBy.mediaRunId) return `mediaRun:${generatedBy.conversationAssetId}:${generatedBy.mediaRunId}`
        let modelId = generatedBy.mediaModelId
        if (!modelId) {
            modelId = node.type === 'image'
                ? node.generatedBy?.aiModel
                : node.generatedBy?.videoModel
        }
        return [
            generatedBy.conversationAssetId,
            generatedBy.generationRequestId ?? '',
            generatedBy.reasoningRunId ?? '',
            modelId ?? '',
            generatedBy.branchForkNodeId ?? '',
            generatedBy.branchLineNodeId ?? '',
            generatedBy.branchOriginNodeId ?? '',
        ].join(':')
    }

    function generatedMediaNodesRepresentSameRun(a: GeneratedMediaNode, b: GeneratedMediaNode): boolean {
        if (a.type !== b.type || !a.generatedBy || !b.generatedBy) return false
        const aRunKey = getGeneratedMediaNodeRunKey(a)
        const bRunKey = getGeneratedMediaNodeRunKey(b)
        return Boolean(aRunKey && aRunKey === bRunKey)
    }

    function findGeneratedMediaRunInState(
        state: CanvasState,
        node: GeneratedMediaNode,
        tracker: PendingGeneratedMediaTracker,
    ): { nodeId: string; assetId: string; reason: 'node-id' | 'asset-id' | 'generated-by-run' } | undefined {
        for (const candidate of state.nodes) {
            if (candidate.type !== node.type) continue
            const mediaNode = candidate as GeneratedMediaNode
            if (mediaNode.nodeId === node.nodeId) {
                return { nodeId: mediaNode.nodeId, assetId: mediaNode.assetId, reason: 'node-id' }
            }
            if (tracker.assetId && mediaNode.assetId === tracker.assetId) {
                return { nodeId: mediaNode.nodeId, assetId: mediaNode.assetId, reason: 'asset-id' }
            }
            if (generatedMediaNodesRepresentSameRun(node, mediaNode)) {
                return { nodeId: mediaNode.nodeId, assetId: mediaNode.assetId, reason: 'generated-by-run' }
            }
        }
        return undefined
    }

    function preserveActiveGeneratedMediaTrackerInState(
        state: CanvasState,
        runKey: string,
        tracker: PendingGeneratedMediaTracker,
        mediaType: 'image' | 'video',
    ): CanvasState {
        if (!currentCanvasState) {
            debugGeneratedMediaLifecycle('skip-preserve-active-tracker-no-current-state', {
                runKey,
                mediaType,
                nodeId: tracker.nodeId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                assetId: tracker.assetId,
                hasReceivedFrame: tracker.hasReceivedFrame,
            })
            return state
        }
        const currentNode = currentCanvasState.nodes.find((node: CanvasNode): node is GeneratedMediaNode =>
            node.nodeId === tracker.nodeId && node.type === mediaType
        )
        if (!currentNode) {
            debugGeneratedMediaLifecycle('skip-preserve-active-tracker-missing-node', {
                runKey,
                mediaType,
                nodeId: tracker.nodeId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                assetId: tracker.assetId,
                hasReceivedFrame: tracker.hasReceivedFrame,
                incomingNodeCount: state.nodes.length,
            })
            return state
        }
        const incomingRunMatch = findGeneratedMediaRunInState(state, currentNode, tracker)
        if (incomingRunMatch) {
            debugGeneratedMediaLifecycle('skip-preserve-active-tracker-incoming-has-run', {
                runKey,
                mediaType,
                nodeId: tracker.nodeId,
                sourceNodeId: tracker.sourceNodeId ?? '',
                assetId: tracker.assetId,
                hasReceivedFrame: tracker.hasReceivedFrame,
                incomingNodeId: incomingRunMatch.nodeId,
                incomingAssetId: incomingRunMatch.assetId,
                reason: incomingRunMatch.reason,
            })
            return state
        }

        const stateNodeIds = new Set(state.nodes.map((node: CanvasNode) => node.nodeId))
        const stateEdgeIds = new Set(state.edges.map((edge: WorkspaceEdge) => edge.edgeId))
        const sourceNode = tracker.sourceNodeId
            ? currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === tracker.sourceNodeId)
            : undefined
        const nodes = stateNodeIds.has(currentNode.nodeId)
            ? state.nodes
            : [
                ...state.nodes,
                ...(sourceNode && !stateNodeIds.has(sourceNode.nodeId) ? [sourceNode] : []),
                currentNode,
            ]
        const preservedEdges = currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
            (edge.targetNodeId === currentNode.nodeId || edge.sourceNodeId === currentNode.nodeId)
            && !stateEdgeIds.has(edge.edgeId)
        )
        if (preservedEdges.length === 0 && nodes === state.nodes) return state

        debugGeneratedMediaLifecycle('preserve-active-tracker-render', {
            runKey,
            mediaType,
            nodeId: tracker.nodeId,
            sourceNodeId: tracker.sourceNodeId ?? '',
            assetId: tracker.assetId,
            hasReceivedFrame: tracker.hasReceivedFrame,
            incomingNodeCount: state.nodes.length,
            preservedEdgeCount: preservedEdges.length,
        })

        return {
            ...state,
            nodes,
            edges: [...state.edges, ...preservedEdges],
        }
    }

    function preserveActiveGeneratedMediaTrackersInState(state: CanvasState | null): CanvasState | null {
        if (!state || !currentCanvasState) return state

        let nextState = state
        for (const [runKey, tracker] of partialImageTracker.entries()) {
            nextState = preserveActiveGeneratedMediaTrackerInState(nextState, runKey, tracker, 'image')
        }
        for (const [runKey, tracker] of videoGenerationTracker.entries()) {
            nextState = preserveActiveGeneratedMediaTrackerInState(nextState, runKey, tracker, 'video')
        }
        return nextState
    }

    function findGeneratedMediaNodeForRun(
        mediaType: 'image' | 'video',
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): ImageCanvasNode | VideoCanvasNode | undefined {
        return currentCanvasState?.nodes.find((node: CanvasNode) =>
            generatedMediaNodeMatchesGenerationRun(node, mediaType, threadId, generationRun)
        )
    }

    function getGeneratedMediaSourceNodeId(nodeId: string): string | undefined {
        return currentCanvasState?.edges.find((edge: WorkspaceEdge) => edge.targetNodeId === nodeId)?.sourceNodeId
    }

    function hasGeneratedImageFrame(node: ImageCanvasNode): boolean {
        return decodedGeneratedImageNodeIds.has(node.nodeId)
            || assetsStore.get(node.assetId)?.media?.renditions.original?.status === 'ready'
    }

    function hasGeneratedVideoFrame(node: VideoCanvasNode): boolean {
        return assetsStore.get(node.assetId)?.media?.renditions.original?.status === 'ready'
    }

    function rememberPartialImageTrackerForNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        imageNode: ImageCanvasNode,
    ): PendingGeneratedMediaTracker {
        const sourceNodeId = getGeneratedMediaSourceNodeId(imageNode.nodeId)
        const tracker: PendingGeneratedMediaTracker = {
            nodeId: imageNode.nodeId,
            assetId: imageNode.assetId,
            placementKey: getGeneratedMediaPlacementKey(threadId, generationRun),
            hasReceivedFrame: hasGeneratedImageFrame(imageNode),
            ...(sourceNodeId ? { sourceNodeId } : {}),
        }
        setGeneratedMediaTracker(partialImageTracker, getGeneratedMediaRunKey(threadId, generationRun), tracker)
        return tracker
    }

    function rememberVideoGenerationTrackerForNode(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
        videoNode: VideoCanvasNode,
    ): PendingGeneratedMediaTracker {
        const sourceNodeId = getGeneratedMediaSourceNodeId(videoNode.nodeId)
        const tracker: PendingGeneratedMediaTracker = {
            nodeId: videoNode.nodeId,
            assetId: videoNode.assetId,
            placementKey: getGeneratedMediaPlacementKey(threadId, generationRun),
            hasReceivedFrame: hasGeneratedVideoFrame(videoNode),
            ...(sourceNodeId ? { sourceNodeId } : {}),
        }
        setGeneratedMediaTracker(videoGenerationTracker, getGeneratedMediaRunKey(threadId, generationRun), tracker)
        return tracker
    }

    // Append an image node to the DOM directly without a full renderNodes() cycle.
    // This preserves active editors and their streaming state.
    function syncConnectionManagerForCurrentCanvasState(options: { flushPixi?: boolean } = {}): void {
        if (!connectionManager || !currentCanvasState) return
        connectionManager.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
        connectionManager.syncEdges(currentCanvasState.edges)
        connectionManager.render()
        if (options.flushPixi) pixiMediaLayer?.renderNow()
    }

    function syncConnectionsAfterManualNodeAppend(): void {
        syncConnectionManagerForCurrentCanvasState({ flushPixi: true })
    }

    function appendImageNodeToDOM(imageNode: ImageCanvasNode): void {
        viewportEl.querySelector(`[data-node-id="${imageNode.nodeId}"]`)?.remove()
        const nodeEl = createImageNode(imageNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(imageNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    // Sibling of appendImageNodeToDOM for VideoCanvasNode placeholders. The
    // PIXI media layer's videoNodeHandler picks the new node up on the next
    // syncPixiMediaLayer() call and creates the corresponding sprite under the
    // videoLayer Container.
    function appendVideoNodeToDOM(videoNode: VideoCanvasNode): void {
        viewportEl.querySelector(`[data-node-id="${videoNode.nodeId}"]`)?.remove()
        const nodeEl = createVideoNode(videoNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(videoNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    function appendDocumentMediaNodeToDOM(documentNode: DocumentMediaCanvasNode): void {
        const nodeEl = createDocumentMediaNode(documentNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(documentNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    function appendAudioNodeToDOM(audioNode: AudioCanvasNode): void {
        const nodeEl = createAudioNode(audioNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(audioNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    function appendCanvasNodeToDOM(node: CanvasNode): void {
        if (node.type === 'image') appendImageNodeToDOM(node)
        else if (node.type === 'video') appendVideoNodeToDOM(node)
        else if (node.type === 'mediaDocument') appendDocumentMediaNodeToDOM(node)
        else if (node.type === 'audio') appendAudioNodeToDOM(node)
    }

    function syncExistingUploadPlaceholderNodeToDOM(node: UploadPlaceholderCanvasNode): void {
        const existingNodeEl = viewportEl.querySelector(`[data-node-id="${node.nodeId}"]`) as HTMLElement | null
        if (!existingNodeEl) return

        const nodeEl = createUploadPlaceholderNode(node)
        existingNodeEl.replaceWith(nodeEl)
        connectionManager?.registerNodeElement(node.nodeId, nodeEl as HTMLDivElement)
        syncConnectionsAfterManualNodeAppend()
    }

    function prepareUploadReplacementNode(
        placeholderNode: UploadPlaceholderCanvasNode,
        node: WorkspaceCanvasNodeInsertion,
        commit = true,
    ): CanvasNode {
        const position = {
            x: placeholderNode.position.x + (placeholderNode.dimensions.width - node.dimensions.width) / 2,
            y: placeholderNode.position.y + (placeholderNode.dimensions.height - node.dimensions.height) / 2,
        }
        const positionedNode = { ...node, position } as CanvasNode
        return positionedNode
    }

    function replaceUploadPlaceholderInternal(
        placeholderNodeId: string,
        node: WorkspaceCanvasNodeInsertion
    ): CanvasState | null {
        if (!currentCanvasState) return null
        const placeholderNode = currentCanvasState.nodes.find((candidate: CanvasNode): candidate is UploadPlaceholderCanvasNode =>
            candidate.type === 'uploadPlaceholder' && candidate.nodeId === placeholderNodeId
        )
        if (!placeholderNode) return null

        const preparedNode = prepareUploadReplacementNode(placeholderNode, node)
        const nodes = resolveTopLevelNodeCollisions(currentCanvasState.nodes.map((candidate: CanvasNode): CanvasNode =>
            candidate.nodeId === placeholderNodeId ? preparedNode : candidate
        ))
        const edges = currentCanvasState.edges.map((edge: WorkspaceEdge): WorkspaceEdge => ({
            ...edge,
            sourceNodeId: edge.sourceNodeId === placeholderNodeId ? preparedNode.nodeId : edge.sourceNodeId,
            targetNodeId: edge.targetNodeId === placeholderNodeId ? preparedNode.nodeId : edge.targetNodeId,
        }))
        const nextState: CanvasState = { ...currentCanvasState, nodes, edges }

        if (commit) {
            commitCanvasStatePreservingEditors(nextState)
            viewportEl.querySelector(`[data-node-id="${placeholderNodeId}"]`)?.remove()
            appendCanvasNodeToDOM(preparedNode)
            selectedNodeIds.delete(placeholderNodeId)
            selectNode(preparedNode.nodeId)

            if (preparedNode.type === 'image' || preparedNode.type === 'video') {
                queueCanvasMediaAnalysis(preparedNode.nodeId, getMediaDescriptorStillAssetId(preparedNode))
            }
        }

        return nextState
    }

    function markUploadPlaceholderFailedInternal(placeholderNodeId: string, message: string): CanvasState | null {
        if (!currentCanvasState) return null
        let failedNode: UploadPlaceholderCanvasNode | null = null
        const nodes = currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (node.type !== 'uploadPlaceholder' || node.nodeId !== placeholderNodeId) return node
            failedNode = {
                ...node,
                status: 'failed',
                message,
                updatedAt: Date.now(),
            }
            return failedNode
        })
        if (!failedNode) return null

        const nextState: CanvasState = { ...currentCanvasState, nodes }
        commitCanvasStatePreservingEditors(nextState)
        syncExistingUploadPlaceholderNodeToDOM(failedNode)

        return nextState
    }

    function appendBranchOriginNodeToDOM(branchOriginNode: BranchOriginCanvasNode): void {
        if (findBranchMarkerNodeEl(branchOriginNode.nodeId)) {
            syncExistingBranchMarkerNodeToDOM(branchOriginNode)
            return
        }
        const nodeEl = createBranchOriginNode(branchOriginNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(branchOriginNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    function appendBranchForkNodeToDOM(branchForkNode: BranchForkCanvasNode): void {
        if (findBranchMarkerNodeEl(branchForkNode.nodeId)) {
            syncExistingBranchMarkerNodeToDOM(branchForkNode)
            return
        }
        const nodeEl = createBranchForkNode(branchForkNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(branchForkNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    function appendBranchLineNodeToDOM(branchLineNode: BranchLineCanvasNode): void {
        if (findBranchMarkerNodeEl(branchLineNode.nodeId)) {
            syncExistingBranchMarkerNodeToDOM(branchLineNode)
            return
        }
        const nodeEl = createBranchLineNode(branchLineNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(branchLineNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    // Persist canvas state without triggering a full re-render.
    // Updates internal state + persists via callback, then immediately updates the
    // structure key so the Svelte $effect's render() call sees no structural change
    // and skips renderNodes(). The caller manages DOM updates manually.
    function commitCanvasStatePreservingEditors(nextState: CanvasState): void {
        commitCanvasState(nextState)
        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    }

    function commitTransientCanvasStatePreservingEditors(nextState: CanvasState): void {
        currentCanvasState = nextState
        pendingLocalCanvasVisualCommit = null

        syncCanvasNodeDomGeometry(nextState.nodes)
        syncPixiMediaLayer(nextState)
        syncConnectionManagerForCurrentCanvasState()
        syncPendingBranchMarkerScreenPlacements()
        pixiMediaLayer?.renderNow()
        lastVisualSyncKey = getCanvasVisualSyncKey(nextState)
        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)
    }

    function commitCanvasMetadataState(nextState: CanvasState): void {
        currentCanvasState = nextState
        onCanvasStateChange?.(nextState)
    }

    // Monotonic guard so out-of-order geometry events never regress the canvas.
    let lastAppliedApiLayoutRevision = 0
    let highestObservedApiLayoutRevision = 0

    function syncApiCanvasSnapshotNodesToDOM(nodeIds: Iterable<string>): void {
        if (!currentCanvasState) return
        const nodeIdSet = new Set(nodeIds)
        if (nodeIdSet.size === 0) return

        for (const node of currentCanvasState.nodes) {
            if (!nodeIdSet.has(node.nodeId)) continue
            if (node.type === 'branchOrigin') {
                appendBranchOriginNodeToDOM(node)
            } else if (node.type === 'branchFork') {
                appendBranchForkNodeToDOM(node)
            } else if (node.type === 'branchLine') {
                appendBranchLineNodeToDOM(node)
            } else if (node.type === 'image' || node.type === 'video' || node.type === 'mediaDocument' || node.type === 'audio') {
                appendCanvasNodeToDOM(node)
            }
        }
    }

    function removeApiCanvasRemovedNodesFromDOM(nodeIds: Iterable<string>): void {
        const nodeIdSet = new Set(nodeIds)
        if (nodeIdSet.size === 0) return

        for (const nodeId of nodeIdSet) {
            const removedEls = [
                ...(pendingBranchMarkerOverlayEl?.querySelectorAll(`[data-node-id="${nodeId}"]`) ?? []),
                ...viewportEl.querySelectorAll(`[data-node-id="${nodeId}"]`),
            ] as HTMLElement[]
            for (const nodeEl of removedEls) nodeEl.remove()
        }

        console.info('[CANVAS][api-geometry]', 'removed-dom-nodes', {
            removedNodeIds: [...nodeIdSet],
        })
    }

    function pruneApiCanvasRemovedGeneratedMediaTrackers(nodeIds: Iterable<string>): void {
        const nodeIdSet = new Set(nodeIds)
        if (nodeIdSet.size === 0) return

        for (const [runKey, tracker] of [...partialImageTracker.entries()]) {
            if (nodeIdSet.has(tracker.nodeId)) partialImageTracker.delete(runKey)
        }
        for (const [runKey, tracker] of [...videoGenerationTracker.entries()]) {
            if (nodeIdSet.has(tracker.nodeId)) videoGenerationTracker.delete(runKey)
        }
        for (const nodeId of nodeIdSet) {
            decodedGeneratedImageNodeIds.delete(nodeId)
            clearFinalizingGeneratedImageOutline(nodeId)
        }
    }

    // Applies API-resolved authoritative node geometry. The API already
    // persisted it, so this is a transient commit — no client-side save. Missing
    // API-owned projected nodes arrive as snapshots in the same revision.
    function applyApiCanvasGeometry(canvasGeometry: CanvasGeometryUpdate): void {
        if (!currentCanvasState) return
        if (canvasGeometry.layoutRevision < lastAppliedApiLayoutRevision) return
        if (canvasGeometry.layoutRevision < highestObservedApiLayoutRevision) return

        const result = applyCanvasGeometryUpdateToState(currentCanvasState, canvasGeometry)
        highestObservedApiLayoutRevision = Math.max(highestObservedApiLayoutRevision, canvasGeometry.layoutRevision)
        console.info('[CANVAS][api-geometry]', 'received', {
            layoutRevision: canvasGeometry.layoutRevision,
            geometryNodeCount: canvasGeometry.nodes.length,
            nodeSnapshotCount: canvasGeometry.nodeSnapshots?.length ?? 0,
            edgeSnapshotCount: canvasGeometry.edgeSnapshots?.length ?? 0,
            removedNodeCount: canvasGeometry.removedNodeIds?.length ?? 0,
            removedEdgeCount: canvasGeometry.removedEdgeIds?.length ?? 0,
            initialMatchedGeometryNodeCount: result.initialMatchedGeometryNodeCount,
            matchedGeometryNodeCount: result.matchedGeometryNodeCount,
            missingGeometryNodeCount: result.missingGeometryNodeIds.length,
            geometryNodeIds: canvasGeometry.nodes.map(node => node.nodeId),
            nodeSnapshotIds: canvasGeometry.nodeSnapshots?.map(node => node.nodeId) ?? [],
            edgeSnapshotIds: canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
            removedNodeIds: canvasGeometry.removedNodeIds ?? [],
            removedEdgeIds: canvasGeometry.removedEdgeIds ?? [],
            upsertedNodeIds: result.upsertedNodeIds,
            updatedNodeIds: result.updatedNodeIds,
            upsertedEdgeIds: result.upsertedEdgeIds,
            missingGeometryNodeIds: result.missingGeometryNodeIds,
        })
        if (result.fullyApplied) lastAppliedApiLayoutRevision = canvasGeometry.layoutRevision
        console.info('[CANVAS][api-geometry]', 'applied', {
            layoutRevision: canvasGeometry.layoutRevision,
            changed: result.changed,
            fullyApplied: result.fullyApplied,
            appliedGeometryNodeIds: result.appliedGeometryNodeIds,
            upsertedNodeIds: result.upsertedNodeIds,
            updatedNodeIds: result.updatedNodeIds,
            upsertedEdgeIds: result.upsertedEdgeIds,
            removedNodeIds: result.removedNodeIds,
            removedEdgeIds: result.removedEdgeIds,
            missingGeometryNodeIds: result.missingGeometryNodeIds,
        })
        if (result.changed) commitTransientCanvasStatePreservingEditors(result.state)
        if (result.fullyApplied) {
            onAuthoritativeCanvasStateChange?.({
                canvasState: result.state,
                layoutRevision: canvasGeometry.layoutRevision,
            })
        }
        if (!result.changed) return
        removeApiCanvasRemovedNodesFromDOM(result.removedNodeIds)
        pruneApiCanvasRemovedGeneratedMediaTrackers(result.removedNodeIds)
        syncPixiGeneratingImageNodes()
        syncApiCanvasSnapshotNodesToDOM([...result.upsertedNodeIds, ...result.updatedNodeIds])
        if (currentCanvasState) {
            pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(currentCanvasState)
            console.info('[CANVAS][api-geometry]', 'preserve-until-store-ack', {
                layoutRevision: canvasGeometry.layoutRevision,
                visualSyncKey: getCanvasVisualSyncKey(currentCanvasState),
                nodeCount: currentCanvasState.nodes.length,
                edgeCount: currentCanvasState.edges.length,
            })
        }
    }

    function getGenerationRequestId(generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.generationRequestId
            ?? getApiMediaRunLineageAssignment(generationRun)?.generationRequestId
            ?? ''
    }

    function shouldAcceptGeneratedMediaEvent(
        threadId: string,
        eventWorkspaceId?: string,
        generationRun?: MediaGenerationRunMeta,
    ): boolean {
        const generationRequestId = getGenerationRequestId(generationRun)
        if (generationRequestId && cancelledMediaGenerationRequestIds.has(generationRequestId)) return false
        return shouldAcceptGeneratedMediaEventForState({
            threadId,
            eventWorkspaceId,
            workspaceId,
            currentCanvasState,
            currentAiChatThreads,
        })
    }

    setAiGeneratedImageCallbacks({
        onAddToCanvas: async (data) => {
            if (!data.assetId) return
            await loadWorkspaceRouteData(workspaceId)
        },

        onMediaBranchResolvedToCanvas: ({ threadId, resolution, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            const placement = ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
            if (!placement) return

            const referenceNodeIds = getExistingMediaNodeIds(resolution.referenceImageNodeIds)
            const placementAnchorNodeId = placement.placementAnchorNodeId ?? referenceNodeIds[0]
            setPendingGeneratedMediaPlacement(threadId, generationRun, {
                ...placement,
                placementAnchorNodeId,
                referenceNodeIds,
                mediaBranchResolution: resolution,
            })
            setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)

            console.info('[CANVAS] image branch VLM resolution', {
                threadId,
                mode: resolution.mode,
                branchId: resolution.branchId,
                operationKind: resolution.operationKind,
                referenceImageNodeIds: resolution.referenceImageNodeIds,
                excludedNodeIds: resolution.excludedNodeIds,
                confidence: resolution.confidence,
                rationale: resolution.rationale,
            })
        },

        onMediaLineagePlannedToCanvas: ({ threadId, lineagePlan, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            applyMediaBranchLineagePlan(threadId, lineagePlan, generationRun)
        },

        onWorkspaceContextResolvedToCanvas: ({ threadId, resolution, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            handleWorkspaceContextResolution(threadId, resolution, generationRun)
        },

        // The reasoning model finished without calling a media tool, so none of
        // the planned runs will start. Settle every pending marker (spinner off,
        // marker kept — the text response still belongs to it) and release the
        // run bookkeeping that would otherwise wait forever.
        onMediaGenerationSkippedToCanvas: ({ threadId, generationRequestId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            settleMediaGenerationRequest(threadId, generationRequestId, generationRun)
        },

        onCanvasGeometryResolvedToCanvas: ({ canvasGeometry }) => {
            const generationRequestId = canvasGeometry.generationRequestId ?? ''
            const isCancelledRequest = generationRequestId
                && cancelledMediaGenerationRequestIds.has(generationRequestId)
            if (isCancelledRequest && (canvasGeometry.removedNodeIds?.length ?? 0) === 0) return
            applyApiCanvasGeometry(canvasGeometry)
        },

        onMediaGenerationRequestCompleteToCanvas: ({ threadId, generationRequestId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            settleMediaGenerationRequest(threadId, generationRequestId, generationRun)
        },

        onMediaBranchResolutionErrorToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            removePendingBranchMarkerForRun(threadId, generationRun)
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
            settleDetachedCanvasRun(threadId)
            scheduleDetachedCanvasRunTeardown(threadId)
        },

        onImageGenerationTraceToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            registerGeneratedMediaRun(threadId, generationRun)
            if (getApiMediaRunLineageAssignment(generationRun)) {
                const existingImageNode = findGeneratedMediaNodeForRun('image', threadId, generationRun)
                if (existingImageNode?.type === 'image') {
                    rememberPartialImageTrackerForNode(threadId, generationRun, existingImageNode)
                    clearPendingBranchMarkerStateForRun(threadId, generationRun)
                    syncPixiGeneratingImageNodes()
                } else {
                    debugGeneratedMediaLifecycle('image-generation-trace-waiting-for-api-geometry', {
                        runKey: getGeneratedMediaRunKey(threadId, generationRun),
                        threadId,
                        generationRequestId: generationRun?.generationRequestId ?? '',
                        mediaRunId: generationRun?.mediaRunId ?? '',
                    })
                }
                clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)
                return
            }
            ensureImageGenerationPlaceholderForRun({ threadId, generationRun })
            clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)
        },

        onImageErrorToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const existing = partialImageTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                removePendingBranchMarkerForRun(threadId, generationRun)
                finishFailedGeneratedMediaRun(threadId, generationRun)
                return
            }

            partialImageTracker.delete(runKey)
            selectedNodeIds.delete(existing.nodeId)
            syncPixiGeneratingImageNodes()

            removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)
            finishFailedGeneratedMediaRun(threadId, generationRun)
        },

        onImagePartialToCanvas: (data) => {
            const { threadId, imageUrl, assetId, generationRun, canvasGeometry } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)
            const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)

            if (canvasGeometry) {
                console.info('[CANVAS][api-geometry]', 'image-partial-apply', {
                    runKey,
                    layoutRevision: canvasGeometry.layoutRevision,
                    partialIndex: data.partialIndex,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                    mediaModelId: generationRun?.mediaModelId,
                    geometryNodeIds: canvasGeometry.nodes.map(node => node.nodeId),
                    nodeSnapshotIds: canvasGeometry.nodeSnapshots?.map(node => node.nodeId) ?? [],
                    edgeSnapshotIds: canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
                })
                const previousTracker = partialImageTracker.get(runKey)
                applyApiCanvasGeometry(canvasGeometry)
                const expectedNodeId = lineageAssignment ? getPendingGeneratedMediaNodeId(lineageAssignment) : ''
                const imageNode = (expectedNodeId ? getCurrentCanvasMediaNode(expectedNodeId) : undefined)
                    ?? findGeneratedMediaNodeForRun('image', threadId, generationRun)
                if (imageNode?.type !== 'image') {
                    console.error('[CANVAS][api-geometry] image partial geometry did not materialize image node', {
                        runKey,
                        threadId,
                        expectedNodeId,
                        generationRequestId: generationRun?.generationRequestId,
                        mediaRunId: generationRun?.mediaRunId,
                    })
                    syncPixiGeneratingImageNodes()
                    return
                }

                const tracker = rememberPartialImageTrackerForNode(threadId, generationRun, imageNode)
                const hasFrame = hasGeneratedImageFrame(imageNode) || Boolean(imageUrl)
                setGeneratedMediaTracker(partialImageTracker, runKey, {
                    ...tracker,
                    assetId: assetId || tracker.assetId,
                    hasReceivedFrame: hasFrame,
                })
                const receivedFirstFrame = !previousTracker?.hasReceivedFrame && hasFrame
                debugGeneratedMediaLifecycle('image-partial-api-geometry-update', {
                    runKey,
                    threadId,
                    nodeId: imageNode.nodeId,
                    assetId: assetId || imageNode.assetId,
                    receivedFirstFrame,
                    hasReceivedFrame: hasFrame,
                    imageUrlPresent: Boolean(imageUrl),
                    layoutRevision: canvasGeometry.layoutRevision,
                })
                clearPendingBranchMarkerStateForRun(threadId, generationRun)
                if (hasFrame) clearGeneratingReferencesOnFirstPixels(threadId, generationRun)
                syncPixiGeneratingImageNodes()
                return
            }

            if (lineageAssignment && (imageUrl || assetId)) {
                const existingTracker = partialImageTracker.get(runKey)
                const expectedNodeId = getPendingGeneratedMediaNodeId(lineageAssignment)
                const existingImageNode = (existingTracker ? getCurrentCanvasMediaNode(existingTracker.nodeId) : undefined)
                    ?? getCurrentCanvasMediaNode(expectedNodeId)
                    ?? findGeneratedMediaNodeForRun('image', threadId, generationRun)
                if (
                    existingImageNode?.type === 'image'
                    && hasGeneratedImageFrame(existingImageNode)
                    && (!assetId || existingImageNode.assetId === assetId)
                ) {
                    debugGeneratedMediaLifecycle('image-partial-duplicate-without-geometry', {
                        runKey,
                        threadId,
                        nodeId: existingImageNode.nodeId,
                        assetId: existingImageNode.assetId,
                        partialIndex: data.partialIndex,
                        generationRequestId: generationRun?.generationRequestId ?? '',
                        mediaRunId: generationRun?.mediaRunId ?? '',
                    })
                    syncPixiGeneratingImageNodes()
                    return
                }
                console.error('[CANVAS][api-geometry] missing image partial geometry; refusing local canvas topology mutation', {
                    runKey,
                    threadId,
                    partialIndex: data.partialIndex,
                    partialAssetId: assetId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                syncPixiGeneratingImageNodes()
                return
            }

            if (lineageAssignment) {
                const existing = partialImageTracker.get(runKey)
                debugGeneratedMediaLifecycle('empty-image-partial-api-heartbeat', {
                    runKey,
                    threadId,
                    nodeId: existing?.nodeId ?? '',
                    hasReceivedFrame: existing?.hasReceivedFrame ?? false,
                    generationRequestId: generationRun?.generationRequestId ?? '',
                    mediaRunId: generationRun?.mediaRunId ?? '',
                })
                syncPixiGeneratingImageNodes()
                return
            }

            let existing = partialImageTracker.get(runKey)
            if (existing && !getCurrentCanvasMediaNode(existing.nodeId)) {
                debugGeneratedMediaLifecycle('drop-stale-image-tracker-before-partial', {
                    runKey,
                    threadId,
                    nodeId: existing.nodeId,
                    assetId: existing.assetId,
                    incomingHasImageUrl: Boolean(imageUrl),
                    incomingAssetId: assetId,
                })
                partialImageTracker.delete(runKey)
                existing = undefined
            }
            if (!existing) {
                existing = ensureImageGenerationPlaceholderForRun({
                    threadId,
                    generationRun,
                    imageUrl,
                    assetId,
                    imageWorkspaceId: workspaceId,
                    failOnMissingLineage: true,
                })
                if (!existing) return
            }

            if (existing) {
                if (!imageUrl && !assetId) {
                    debugGeneratedMediaLifecycle('empty-image-partial-refresh-outline', {
                        runKey,
                        threadId,
                        nodeId: existing.nodeId,
                        hasReceivedFrame: existing.hasReceivedFrame,
                    })
                    syncPixiGeneratingImageNodes()
                    return
                }

                const receivedFirstFrame = !existing.hasReceivedFrame && Boolean(imageUrl)
                const updatedTracker = {
                    ...existing,
                    assetId: assetId || existing.assetId,
                    hasReceivedFrame: existing.hasReceivedFrame || Boolean(imageUrl),
                }
                setGeneratedMediaTracker(partialImageTracker, runKey, updatedTracker)
                debugGeneratedMediaLifecycle('image-partial-update', {
                    runKey,
                    threadId,
                    nodeId: existing.nodeId,
                    assetId: updatedTracker.assetId,
                    receivedFirstFrame,
                    hasReceivedFrame: updatedTracker.hasReceivedFrame,
                    imageUrlPresent: Boolean(imageUrl),
                })

                if (imageUrl && currentCanvasState) {
                    clearGeneratingReferencesOnFirstPixels(threadId, generationRun)
                    const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
                        if (node.nodeId !== existing.nodeId) return node
                        const imageNode = node as ImageCanvasNode
                        const position = imageNode.position
                        const generatedBy = imageNode.generatedBy && generationRun?.mediaModelId
                            ? { ...imageNode.generatedBy, mediaModelId: generationRun.mediaModelId as any }
                            : imageNode.generatedBy
                        return {
                            ...imageNode,
                            assetId: assetId || imageNode.assetId,
                            position,
                            generatedBy,
                        } satisfies ImageCanvasNode
                    })

                    const resolvedNodes = receivedFirstFrame
                        ? rebalanceGeneratedMediaTrees(updatedNodes, currentCanvasState.edges)
                        : updatedNodes

                    commitTransientCanvasStatePreservingEditors({ ...currentCanvasState, nodes: resolvedNodes })
                }
                return
            }
        },

        onImageCompleteToCanvas: (data) => {
            const { threadId, assetId, generationRun } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)
            const pendingNodeId = partialImageTracker.get(runKey)?.nodeId
            const completedNodeId = generationRun?.lineageAssignment
                ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)
                : ''
            if (!data.canvasGeometry) {
                const existingCompletedImageNode = completedNodeId ? getCurrentCanvasMediaNode(completedNodeId) : undefined
                if (existingCompletedImageNode?.type === 'image') {
                    console.info('[CANVAS][api-geometry]', 'image-complete-existing-final-without-geometry', {
                        runKey,
                        threadId,
                        completedNodeId,
                        generationRequestId: generationRun?.generationRequestId,
                        mediaRunId: generationRun?.mediaRunId,
                    })
                    const completionTracker = partialImageTracker.get(runKey)
                        ?? rememberPartialImageTrackerForNode(threadId, generationRun, existingCompletedImageNode)
                    keepGeneratedImageCompletionOutlineUntilTextureReady(
                        runKey,
                        completionTracker,
                        existingCompletedImageNode,
                    )
                    if (pendingNodeId && pendingNodeId !== completedNodeId) {
                        viewportEl.querySelector(`[data-node-id="${pendingNodeId}"]`)?.remove()
                    }
                    appendImageNodeToDOM(existingCompletedImageNode)
                    finishGeneratedMediaRun(threadId, generationRun)
                    void refreshCompletedGeneratedMediaAsset(existingCompletedImageNode)
                    return
                }
                console.error('[CANVAS][api-geometry] missing image completion geometry; refusing local canvas topology mutation', {
                    runKey,
                    threadId,
                    completionAssetId: assetId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                void loadWorkspaceRouteData(workspaceId)
                return
            }

            console.info('[CANVAS][api-geometry]', 'image-complete-apply', {
                runKey,
                layoutRevision: data.canvasGeometry.layoutRevision,
                removedNodeIds: data.canvasGeometry.removedNodeIds ?? [],
                edgeSnapshotIds: data.canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
            })
            applyApiCanvasGeometry(data.canvasGeometry)
            const completedImageNode = completedNodeId ? getCurrentCanvasMediaNode(completedNodeId) : undefined
            if (completedImageNode?.type !== 'image') {
                console.error('[CANVAS][api-geometry] image completion geometry did not materialize final node', {
                    runKey,
                    threadId,
                    completedNodeId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                return
            }
            const completionTracker = partialImageTracker.get(runKey)
                ?? rememberPartialImageTrackerForNode(threadId, generationRun, completedImageNode)
            keepGeneratedImageCompletionOutlineUntilTextureReady(runKey, completionTracker, completedImageNode)
            if (pendingNodeId && pendingNodeId !== completedNodeId) {
                viewportEl.querySelector(`[data-node-id="${pendingNodeId}"]`)?.remove()
            }
            appendImageNodeToDOM(completedImageNode)
            finishGeneratedMediaRun(threadId, generationRun)
            void refreshCompletedGeneratedMediaAsset(completedImageNode)
        },

    })

    // VideoCanvasNode lifecycle callbacks, fired from the AI chat thread plugin
    // when VIDEO_* segments arrive. Mirrors setAiGeneratedImageCallbacks above
    // but skips the in-chat node insertion path that images use (the chat
    // schema registers aiGeneratedVideo but does not yet auto-insert it; the
    // canvas-side placeholder is the user-visible representation in Phase 5 v1).
    // The pendingGeneratedImagePlacements Map is shared with images because the
    // resolveMediaBranch snapshot serves both media types.
    setAiGeneratedVideoCallbacks({
        onVideoPendingToCanvas: (data) => {
            const { threadId, generationRun, canvasGeometry } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)
            const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
            if (!lineageAssignment) {
                console.error('[CANVAS] Missing API media lineage assignment for video pending', { threadId, generationRun })
                removePendingBranchMarkerForRun(threadId, generationRun)
                return
            }
            if (!canvasGeometry) {
                console.error('[CANVAS][api-geometry] missing video pending geometry; refusing local canvas topology mutation', {
                    runKey,
                    threadId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                return
            }
            applyApiCanvasGeometry(canvasGeometry)
            const nodeId = getPendingGeneratedMediaNodeId(lineageAssignment)
            const videoNode = getCurrentCanvasMediaNode(nodeId)
            if (videoNode?.type !== 'video') {
                console.error('[CANVAS][api-geometry] video pending geometry did not materialize video node', {
                    runKey,
                    threadId,
                    nodeId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                return
            }
            rememberVideoGenerationTrackerForNode(threadId, generationRun, videoNode)
            clearPendingBranchMarkerStateForRun(threadId, generationRun)
            appendVideoNodeToDOM(videoNode)
            syncPixiGeneratingImageNodes()
        },

        onVideoGeneratingToCanvas: ({ threadId }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            // VEO keepalive heartbeat. The PIXI traveling outline is already
            // running on the placeholder via pixiMediaLayer's generating-image
            // tracker, so no canvas state mutation is required here. Phase 6
            // may add a "still generating" pulse animation.
        },

        onVideoGenerationTraceToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            registerGeneratedMediaRun(threadId, generationRun)
            clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)
        },

        onVideoCompleteToCanvas: (data) => {
            const {
                threadId,
                assetId,
                generationRun,
            } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)
            const pendingNodeId = videoGenerationTracker.get(runKey)?.nodeId
            const completedNodeId = generationRun?.lineageAssignment
                ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)
                : ''
            if (!data.canvasGeometry) {
                console.error('[CANVAS][api-geometry] missing video completion geometry; refusing local canvas topology mutation', {
                    runKey,
                    threadId,
                    completionAssetId: assetId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                void loadWorkspaceRouteData(workspaceId)
                return
            }

            console.info('[CANVAS][api-geometry]', 'video-complete-apply', {
                runKey,
                layoutRevision: data.canvasGeometry.layoutRevision,
                removedNodeIds: data.canvasGeometry.removedNodeIds ?? [],
                edgeSnapshotIds: data.canvasGeometry.edgeSnapshots?.map(edge => edge.edgeId) ?? [],
            })
            applyApiCanvasGeometry(data.canvasGeometry)
            const completedVideoNode = getCurrentCanvasMediaNode(completedNodeId)
            if (completedVideoNode?.type !== 'video') {
                console.error('[CANVAS][api-geometry] video completion geometry did not materialize final node', {
                    runKey,
                    threadId,
                    completedNodeId,
                    generationRequestId: generationRun?.generationRequestId,
                    mediaRunId: generationRun?.mediaRunId,
                })
                return
            }
            videoGenerationTracker.delete(runKey)
            syncPixiGeneratingImageNodes()
            if (pendingNodeId && pendingNodeId !== completedNodeId) {
                viewportEl.querySelector(`[data-node-id="${pendingNodeId}"]`)?.remove()
            }
            appendVideoNodeToDOM(completedVideoNode)
            finishGeneratedMediaRun(threadId, generationRun)
            void refreshCompletedGeneratedMediaAsset(completedVideoNode)
        },

        onVideoErrorToCanvas: (data) => {
            const { threadId, generationRun } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, undefined, generationRun)) return
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const existing = videoGenerationTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                removePendingBranchMarkerForRun(threadId, generationRun)
                finishFailedGeneratedMediaRun(threadId, generationRun)
                return
            }

            videoGenerationTracker.delete(runKey)
            syncPixiGeneratingImageNodes()

            const errorNodeId = existing.nodeId
            setTimeout(() => {
                removeFailedGeneratedMediaNodeFromCanvas(errorNodeId)
            }, 3000)
            finishFailedGeneratedMediaRun(threadId, generationRun)
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
        // The max width depends on pane width, so re-clamp through the SidePanel.
        // It re-emits the clamped width, which reflectRightSidePanelWidth applies.
        activeRightSidePanel?.applyConstraints()
        syncPendingBranchMarkerScreenPlacements()
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
            viewportBridge?.applyViewport(vp)
            syncPendingBranchMarkerScreenPlacements()
            updateGeneratedMediaChromeLayout()
            if (zoomChanged) {
                updateBranchMarkerReviewControlsZoom(vp.zoom)
                if (settings.mediaNode.useZoomCompensatedResizeHandleScaling) {
                    pendingHandleZoom = vp.zoom
                }
                if (settings.connector.useZoomCompensatedScaling) {
                    const hasPreFrameConnectorBounds = getPendingGeneratedMediaBeforeFirstFrameNodeIds().size > 0
                    if (hasPreFrameConnectorBounds && connectionManager && currentCanvasState) {
                        connectionManager.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
                        connectionManager.syncEdges(currentCanvasState.edges)
                        connectionManager.render()
                        pixiMediaLayer?.renderNow()
                    } else {
                        // Recompute and flush the connector canvas in the same turn as the DOM
                        // viewport transform. If the pan/zoom callback runs inside a rAF, waiting
                        // for PIXI's scheduled rAF lets the browser paint one frame where nodes
                        // have moved but connectors still show the previous canvas bitmap.
                        const pixiEdgesRecomputed = connectionManager?.recomputePixiEdgesOnly(vp.zoom) ?? false
                        if (pixiEdgesRecomputed) pixiMediaLayer?.renderNow()
                    }
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
        interactionOptions: BaseNodeInteractionOptions = {}
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
        updatePendingGeneratedMediaBeforeFrameClass(nodeEl, node.nodeId)

        nodeEl.addEventListener('click', (e) => {
            e.stopPropagation()
            if (suppressNextNodeClick) {
                suppressNextNodeClick = false
                return
            }

            clearGeneratedMediaInfoPanels({
                preserveBranchInfo: node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine',
            })

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
                if (interactionOptions.allowSelection !== false) {
                    toggleNodeSelection(node.nodeId)
                } else {
                    interactionOptions.onClick?.()
                }
                return
            }

            if (interactionOptions.allowSelection !== false) {
                selectNode(node.nodeId)
            }
            interactionOptions.onClick?.()
        })

        if (interactionOptions.renderResizeHandles !== false) {
            for (const corner of RESIZE_CORNERS) {
                nodeEl.appendChild(createResizeHandle(node.nodeId, corner))
            }
        }

        const dragOverlay = html`
            <div
                className="node-drag-overlay nopan"
                onmousedown=${(e: MouseEvent) => {
                    if (interactionOptions.allowDrag === false) {
                        e.preventDefault()
                        e.stopPropagation()
                        return
                    }
                    handleDragStart(e, node.nodeId, {
                        allowSelection: interactionOptions.allowSelection !== false,
                        onClick: interactionOptions.onClick,
                    })
                }}
            ></div>
        ` as HTMLDivElement
        nodeEl.appendChild(dragOverlay)

        return { nodeEl, dragOverlay }
    }

    function commitCanvasState(nextState: CanvasState) {
        currentCanvasState = nextState
        pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(nextState)
        onCanvasStateChange?.(nextState)

        syncCanvasNodeDomGeometry(nextState.nodes)
        syncPixiMediaLayer(nextState)
        syncConnectionManagerForCurrentCanvasState()
        pixiMediaLayer?.renderNow()
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

    function cancelScheduledEdgesRender(): void {
        if (edgesRaf === null) return
        cancelAnimationFrame(edgesRaf)
        edgesRaf = null
    }

    function ensureConnectionManager() {
        if (connectionManager) {
            return
        }

        connectionManager = new WorkspaceConnectionManager({
            paneEl,
            viewportEl,
            getTransform: () => lastTransform,
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
        const resizeHandleSettings = settings.mediaNode.resizeHandle
        const { size: sizePx, offset: offsetPx } = settings.mediaNode.useZoomCompensatedResizeHandleScaling
            ? getResizeHandleScaledSizes(zoom, {
                baseSize: resizeHandleSettings.size,
                baseOffset: resizeHandleSettings.offset,
                minSize: resizeHandleSettings.minSize,
                zoomScaling: getAdaptiveBoundedZoomScalingOptions(resizeHandleSettings.zoomScaling),
            })
            : { size: resizeHandleSettings.size, offset: resizeHandleSettings.offset }

        // Node resize handles are DOM children of the viewport-transformed node
        // shell, so these CSS sizes are world units. The browser applies the
        // viewport scale after layout, producing the adaptive final screen size.
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
        return getLiveViewport().zoom
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
                updateGeneratedMediaChromeLiveTransform(draggedNodeId, currentPos, currentDims, getLiveViewport())

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
            cancelScheduledEdgesRender()

            for (const draggedNodeId of draggedNodeEntries.keys()) {
                const draggedNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === draggedNodeId)
                if (dragDidMove && draggedNode && isBranchMarkerNode(draggedNode)) continue
                liveNodeOverrides.delete(draggedNodeId)
                branchMarkerProjectionOverrideNodeIds.delete(draggedNodeId)
            }

            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)

            releasePanZoomForNodePointer()

            if (!dragDidMove) {
                // No drag occurred — this was a click. Collision logic can
                // legitimately move nearby nodes and must only run after movement.
                if (options.onClick) {
                    suppressNextNodeClick = true
                    window.setTimeout(() => {
                        suppressNextNodeClick = false
                    }, 0)
                }
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

            const manuallyMovedBranchMarkerNodeIds = new Set<string>()

            if (dragPlan.allowCollisionResolution) {
                const collisionExclusions = new Set<string>()

                for (const child of updatedNodes) {
                    if (child.parentId) {
                        collisionExclusions.add(`${child.parentId}-${child.nodeId}`)
                    }
                }

                const collisionSettings = settings.workspaceCollision.dragRelease
                const collisionPlan = createCollisionPlan(updatedNodes, dragPlan.isParentContainerDrag, collisionSettings)

                const { nodes: movedNodes, hasChanges } = resolveCollisions(collisionPlan.nodeBoxes, {
                    iterations: collisionPlan.iterations,
                    margin: 0,
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
                            updateGeneratedMediaChromeLiveTransform(n.nodeId, resolvedPosition, n.dimensions, getLiveViewport())
                            const nextPosition = n.parentId
                                ? toParentRelativePosition(resolvedPosition, n.parentId, getCanvasNodesById(updatedNodes))
                                : resolvedPosition
                            if (isBranchMarkerNode(n)) manuallyMovedBranchMarkerNodeIds.add(n.nodeId)
                            return { ...n, position: nextPosition }
                        }
                        return n
                    })
                }
            }

            for (const draggedNodeId of finalDraggedPositions.keys()) {
                const draggedNode = updatedNodes.find((node: CanvasNode) => node.nodeId === draggedNodeId)
                if (draggedNode && isBranchMarkerNode(draggedNode)) {
                    manuallyMovedBranchMarkerNodeIds.add(draggedNode.nodeId)
                }
            }

            for (const movedBranchMarkerNodeId of manuallyMovedBranchMarkerNodeIds) {
                const movedBranchMarkerNode = updatedNodes.find((node: CanvasNode) => node.nodeId === movedBranchMarkerNodeId)
                if (!movedBranchMarkerNode || !isBranchMarkerNode(movedBranchMarkerNode)) continue
                const movedBranchMarkerEl = viewportEl?.querySelector(`[data-node-id="${movedBranchMarkerNodeId}"]`) as HTMLElement
                liveNodeOverrides.set(movedBranchMarkerNode.nodeId, {
                    position: movedBranchMarkerNode.position,
                    dimensions: {
                        width: movedBranchMarkerEl?.offsetWidth ?? movedBranchMarkerNode.dimensions.width,
                        height: movedBranchMarkerEl?.offsetHeight ?? movedBranchMarkerNode.dimensions.height,
                    },
                })
                branchMarkerProjectionOverrideNodeIds.add(movedBranchMarkerNode.nodeId)
                manuallyPositionedBranchMarkerNodeIds.add(movedBranchMarkerNode.nodeId)
            }

            commitCanvasState({
                ...currentCanvasState,
                nodes: updatedNodes
            })

            // Final reposition after collision resolution may have moved the node
            repositionCanvasBubbleMenu()
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

        // PIXI owns image pixels, so resize behavior uses persisted geometry
        // instead of a rendered surface or duplicated media metadata.
        let aspectRatio: number | null = null
        if (isImageNode) {
            aspectRatio = node.dimensions.height > 0
                ? node.dimensions.width / node.dimensions.height
                : null
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
            updateGeneratedMediaChromeLiveTransform(nodeId, liveResizePosition, liveResizeDimensions, getLiveViewport())
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

        }

        const handleMouseUp = () => {
            nodeEl.classList.remove('is-resizing')
            handle?.classList.remove('is-dragging')
            resizingNodeId = null
            paneEl.style.cursor = previousPaneCursor
            applyStyle(document.body, { cursor: previousBodyCursor, userSelect: previousBodyUserSelect })
            applyStyle(document.documentElement, { cursor: previousDocumentCursor })

            liveNodeOverrides.delete(nodeId)
            branchMarkerProjectionOverrideNodeIds.delete(nodeId)

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

            const updatedNodes = currentCanvasState.nodes.map((n: CanvasNode) =>
                n.nodeId === nodeId ? { ...n, dimensions: newDimensions, position: newPosition } : n
            )

            currentCanvasState = { ...currentCanvasState, nodes: updatedNodes }

            commitCanvasState(currentCanvasState)

            // Final reposition at new size
            repositionCanvasBubbleMenu()
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    function createDocumentNode(node: DocumentCanvasNode, doc: Document | undefined): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(node, undefined, { assetId: node.assetId })
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
                    documentType: 'assetContent',
                    threadId: null,
                    proseMirrorAuthority: {
                        organizationId: doc.organizationId!,
                        workspaceId,
                        assetId: node.assetId,
                        role: 'content',
                        baseVersion: getStoredProseMirrorVersion(doc),
                        onLeaseStateChange: (state: { readOnly: boolean; holderWorkspaceId?: string; expiresAt?: number }) => {
                            nodeEl.classList.toggle('is-asset-lease-read-only', state.readOnly)
                            if (state.readOnly) {
                                const holder = state.holderWorkspaceId ? ` by workspace ${state.holderWorkspaceId}` : ''
                                const expiry = state.expiresAt ? ` until ${new Date(state.expiresAt).toLocaleTimeString()}` : ''
                                editorContainer.title = `Read-only: Asset edit lease is held${holder}${expiry}`
                            } else {
                                editorContainer.removeAttribute('title')
                            }
                        },
                    },
                    onEditorChange: (value: any) => {
                        onDocumentContentChange?.({
                            documentId: node.assetId,
                            title: doc.title,
                            content: value
                        })
                    },
                    onStreamingUpdate: () => {},
                    onAiChatSubmit: () => {},
                    onAiChatStop: () => {},
                    onPromptSubmit: () => {},
                    promptControlFactories: getPromptControlFactories(),
                    onReceivingStateChange: () => {},
                })

                documentEditors.set(node.assetId, {
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
            { assetId: node.assetId }
        )
        dragOverlay.className = 'image-drag-overlay nopan'

        return nodeEl
    }

    function createDocumentMediaNode(node: DocumentMediaCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-media-document-node',
            { assetId: node.assetId }
        )
        dragOverlay.className = 'media-document-drag-overlay nopan'

        return nodeEl
    }

    // DOM shell for VideoCanvasNode. Mirrors createImageNode: the shell owns
    // interaction chrome, while completed videos get a visible DOM
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
            { assetId: node.assetId }
        )
        dragOverlay.className = 'video-drag-overlay nopan'

        const togglePlayback = (event: Event) => {
            event.stopPropagation()
            if (videoNodeHandler?.hasEntry(node.nodeId)) {
                videoNodeHandler.toggle(node.nodeId).catch(() => {})
            }
        }
        dragOverlay.addEventListener('dblclick', togglePlayback)

        return nodeEl
    }

    function createAudioNode(node: AudioCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-audio-node',
            { assetId: node.assetId }
        )
        dragOverlay.className = 'audio-drag-overlay nopan'

        const togglePlayback = (event: Event) => {
            event.stopPropagation()
            if (audioNodeHandler?.hasEntry(node.nodeId)) {
                audioNodeHandler.toggle(node.nodeId).catch(() => {})
            }
        }
        dragOverlay.addEventListener('dblclick', togglePlayback)

        return nodeEl
    }

    // Dismiss a (typically failed) upload placeholder: drop it from canvas state
    // + DOM so a failed upload can be cleared instead of lingering forever.
    function removeUploadPlaceholderInternal(placeholderNodeId: string): CanvasState | null {
        if (!currentCanvasState) return null
        const exists = currentCanvasState.nodes.some((candidate: CanvasNode): boolean =>
            candidate.type === 'uploadPlaceholder' && candidate.nodeId === placeholderNodeId
        )
        if (!exists) return null

        const nodes = currentCanvasState.nodes.filter((candidate: CanvasNode): boolean => candidate.nodeId !== placeholderNodeId)
        const edges = currentCanvasState.edges.filter((edge: WorkspaceEdge): boolean =>
            edge.sourceNodeId !== placeholderNodeId && edge.targetNodeId !== placeholderNodeId
        )
        const nextState: CanvasState = { ...currentCanvasState, nodes, edges }

        commitCanvasStatePreservingEditors(nextState)
        viewportEl.querySelector(`[data-node-id="${placeholderNodeId}"]`)?.remove()
        selectedNodeIds.delete(placeholderNodeId)

        return nextState
    }

    function createUploadPlaceholderNode(node: UploadPlaceholderCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            `workspace-upload-placeholder-node is-${node.status}`,
            { uploadStatus: node.status },
            { renderResizeHandles: false }
        )
        dragOverlay.className = 'upload-placeholder-drag-overlay nopan'

        const label = node.status === 'failed' ? 'Conversion failed' : 'Converting upload'
        const message = node.message ?? (node.status === 'failed'
            ? 'The file could not be converted to a supported format.'
            : 'Creating a supported copy before adding it to the canvas.')
        const content = html`
            <div className="workspace-upload-placeholder-content">
                <span className="workspace-upload-placeholder-status">${label}</span>
                <span className="workspace-upload-placeholder-name">${node.fileName}</span>
                <span className="workspace-upload-placeholder-message">${message}</span>
            </div>
        ` as HTMLDivElement
        nodeEl.appendChild(content)

        if (node.status === 'converting') {
            const spinner = html`<span className="workspace-upload-placeholder-loading-spinner ai-response-loading-spinner" aria-hidden="true"></span>` as HTMLSpanElement
            nodeEl.appendChild(spinner)
        }

        // Failed uploads get a dismiss (×) button so they can be cleared. It sits
        // above the transparent drag overlay (z-index) so its click isn't swallowed.
        if (node.status === 'failed') {
            const dismissBtn = document.createElement('button')
            dismissBtn.type = 'button'
            dismissBtn.className = 'workspace-upload-placeholder-dismiss nopan'
            dismissBtn.setAttribute('aria-label', 'Dismiss')
            dismissBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
            dismissBtn.addEventListener('pointerdown', (e: Event) => { e.stopPropagation() })
            dismissBtn.addEventListener('click', (e: Event) => {
                e.stopPropagation()
                removeUploadPlaceholderInternal(node.nodeId)
            })
            nodeEl.appendChild(dismissBtn)
        }

        return nodeEl
    }

    function getBranchMarkerGeneratedMediaNodes(node: BranchMarkerNode): Array<ImageCanvasNode | VideoCanvasNode> {
        if (node.type === 'branchOrigin') return getBranchOriginGeneratedMediaNodes(node.nodeId)
        if (node.type === 'branchFork') return getBranchForkGeneratedMediaNodes(node.nodeId)
        return getBranchLineGeneratedMediaNodes(node.nodeId)
    }

    function getBranchMarkerReasoningModelDescriptors(node: BranchMarkerNode): BranchMarkerModelDescriptor[] {
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
        for (const mediaNode of getBranchMarkerGeneratedMediaNodes(node)) {
            const reasoningModelId = mediaNode.generatedBy?.reasoningModelId
            if (reasoningModelId) descriptors.push({ modelId: reasoningModelId })
        }
        return descriptors
    }

    function getBranchMarkerReasoningModelEntry(node: BranchMarkerNode): BranchMarkerModelEntry | null {
        const entries = uniqueBranchMarkerModelEntries(getBranchMarkerReasoningModelDescriptors(node)
            .map(descriptor => getBranchMarkerModelEntry(descriptor.modelId, descriptor.modelProvider ?? ''))
            .filter((entry): entry is BranchMarkerModelEntry => Boolean(entry)))
        return entries[0] ?? null
    }

    function getBranchMarkerMediaModelDetails(node: BranchMarkerNode): BranchMarkerModelDetail[] {
        const descriptorsByLabel = new Map<string, BranchMarkerModelDescriptor[]>()
        for (const descriptor of getBranchMarkerMediaModelCircleDescriptors(node, currentCanvasState?.nodes ?? [])) {
            descriptorsByLabel.set(descriptor.label, [
                ...(descriptorsByLabel.get(descriptor.label) ?? []),
                {
                    modelId: descriptor.modelId,
                    ...(descriptor.modelProvider ? { modelProvider: descriptor.modelProvider } : {}),
                },
            ])
        }

        return Array.from(descriptorsByLabel.entries())
            .map(([label, descriptors]) => createBranchMarkerModelDetail(label, descriptors))
            .filter((detail): detail is BranchMarkerModelDetail => Boolean(detail))
    }

    function getBranchMarkerModelDetails(node: BranchMarkerNode): BranchMarkerModelDetail[] {
        return [
            ...getBranchMarkerMediaModelDetails(node),
        ].filter((detail): detail is BranchMarkerModelDetail => Boolean(detail))
    }

    function getBranchMarkerModelSummary(details: BranchMarkerModelDetail[]): string {
        return details
            .map(detail => `${detail.label}: ${detail.entries.map(entry => entry.title).join(', ')}`)
            .join(' · ')
    }

    function getBranchMarkerMediaModelTooltipEntries(node: BranchMarkerNode): Array<{ label: string; entry: BranchMarkerModelEntry }> {
        return getBranchMarkerMediaModelCircleDescriptors(node, currentCanvasState?.nodes ?? [])
            .map((descriptor) => {
                const entry = getBranchMarkerModelEntry(descriptor.modelId, descriptor.modelProvider ?? '')
                return entry ? { label: descriptor.label, entry } : null
            })
            .filter((entry): entry is { label: string; entry: BranchMarkerModelEntry } => Boolean(entry))
    }

    function getBranchMarkerMediaModelDefaultIcon(label: string): string {
        return label === 'Video' ? videoPlayGlyphIcon : imageIcon
    }

    function createBranchMarkerMediaModelTooltip(nodeId: string, label: string, entry: BranchMarkerModelEntry, index: number): HTMLElement {
        const icon = entry.icon ?? getBranchMarkerMediaModelDefaultIcon(label)
        const circleGlassImage = createBranchMarkerMediaModelCircleGlassCssImage(entry.color)
        const circleTextureImage = createBranchMarkerMediaModelCircleTextureCssImage(entry.color)
        const circleStyle = circleGlassImage ? { backgroundImage: circleGlassImage } : {}
        const textureStyle = {
            backgroundImage: circleTextureImage,
        }
        const triggerContent = html`
            <span className="workspace-branch-marker-media-model-circle" style=${circleStyle} data=${{ mediaModelCircleIndex: String(index) }}>
                <span className="workspace-branch-marker-media-model-texture" style=${textureStyle}></span>
                <span
                    className="workspace-branch-marker-message-icon workspace-branch-marker-media-model-icon"
                    innerHTML=${icon}
                    aria-hidden="true"
                ></span>
            </span>
        ` as HTMLElement
        const tooltip = createHelpTooltip({
            label: `${label} model: ${entry.title}`,
            text: `${label}: ${entry.title}`,
            triggerContent,
            preferredPlacement: 'left',
            className: 'workspace-branch-marker-media-model-tooltip workspace-branch-marker-reasoning-tooltip nopan',
            triggerClassName: 'workspace-branch-marker-media-model-tooltip-trigger workspace-branch-marker-reasoning-tooltip-trigger',
            contentClassName: 'workspace-branch-marker-reasoning-tooltip-content',
        })
        const tooltips = branchMarkerMediaModelTooltips.get(nodeId) ?? []
        tooltips.push(tooltip)
        branchMarkerMediaModelTooltips.set(nodeId, tooltips)
        return tooltip.dom
    }

    function createBranchMarkerReasoningTooltip(nodeId: string, modelTitle: string, icon: string): HTMLElement {
        destroyBranchMarkerReasoningTooltip(nodeId)
        const triggerContent = html`
            <span
                className="workspace-branch-marker-message-icon workspace-branch-marker-reasoning-icon"
                innerHTML=${icon}
                aria-hidden="true"
            ></span>
        ` as HTMLElement
        const tooltip = createHelpTooltip({
            label: `Reasoning model: ${modelTitle}`,
            text: modelTitle,
            triggerContent,
            preferredPlacement: 'top',
            className: 'workspace-branch-marker-reasoning-tooltip nopan',
            triggerClassName: 'workspace-branch-marker-reasoning-tooltip-trigger',
            contentClassName: 'workspace-branch-marker-reasoning-tooltip-content',
        })
        branchMarkerReasoningTooltips.set(nodeId, tooltip)
        return tooltip.dom
    }

    function generatedMediaNodeBelongsToBranchMarker(mediaNode: GeneratedMediaNode, markerNodeId: string): boolean {
        return mediaNode.generatedBy?.branchOriginNodeId === markerNodeId
            || mediaNode.generatedBy?.branchForkNodeId === markerNodeId
            || mediaNode.generatedBy?.branchLineNodeId === markerNodeId
            || mediaNode.generatedBy?.lineageParentNodeId === markerNodeId
    }

    function isProjectedPendingGeneratedMediaNode(node: GeneratedMediaNode): boolean {
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

    function generatedMediaTrackerBelongsToBranchMarker(
        tracker: PendingGeneratedMediaTracker,
        markerNodeId: string,
    ): boolean {
        if (tracker.sourceNodeId === markerNodeId) return true
        const mediaNode = currentCanvasState?.nodes.find((node: CanvasNode): node is GeneratedMediaNode =>
            node.nodeId === tracker.nodeId && (node.type === 'image' || node.type === 'video')
        )
        return Boolean(mediaNode && generatedMediaNodeBelongsToBranchMarker(mediaNode, markerNodeId))
    }

    function getActiveGeneratedMediaNodeIdsForBranchMarker(node: BranchMarkerNode): Set<string> {
        const nodeIds = new Set<string>()
        const trackerNodeIds = new Set<string>([
            ...Array.from(partialImageTracker.values(), (tracker) => tracker.nodeId),
            ...Array.from(videoGenerationTracker.values(), (tracker) => tracker.nodeId),
        ])
        const generationRequestId = node.generationRequestId && !node.generationRequestId.startsWith('canvas-')
            ? node.generationRequestId
            : ''
        for (const tracker of partialImageTracker.values()) {
            if (generatedMediaTrackerBelongsToBranchMarker(tracker, node.nodeId)) nodeIds.add(tracker.nodeId)
        }
        for (const tracker of videoGenerationTracker.values()) {
            if (generatedMediaTrackerBelongsToBranchMarker(tracker, node.nodeId)) nodeIds.add(tracker.nodeId)
        }

        const directlyConnectedNodeIds = new Set(
            (currentCanvasState?.edges ?? [])
                .filter((edge: WorkspaceEdge) => edge.sourceNodeId === node.nodeId)
                .map((edge: WorkspaceEdge) => edge.targetNodeId),
        )
        for (const candidate of currentCanvasState?.nodes ?? []) {
            if (candidate.type !== 'image' && candidate.type !== 'video') continue
            if (!trackerNodeIds.has(candidate.nodeId)
                && !isGeneratedMediaCanvasNodeWaitingForFrame(candidate)
                && !isProjectedPendingGeneratedMediaNode(candidate)) continue
            const matchesGenerationRequest = Boolean(
                generationRequestId && candidate.generatedBy?.generationRequestId === generationRequestId
            )
            if (matchesGenerationRequest
                || directlyConnectedNodeIds.has(candidate.nodeId)
                || generatedMediaNodeBelongsToBranchMarker(candidate, node.nodeId)) {
                nodeIds.add(candidate.nodeId)
            }
        }
        return nodeIds
    }

    function removeActiveGeneratedMediaNodesForBranchMarker(node: BranchMarkerNode): void {
        if (!currentCanvasState) return
        const nodeIds = getActiveGeneratedMediaNodeIdsForBranchMarker(node)
        if (nodeIds.size === 0) return

        pruneApiCanvasRemovedGeneratedMediaTrackers(nodeIds)
        for (const nodeId of nodeIds) selectedNodeIds.delete(nodeId)
        const nextState: CanvasState = {
            ...currentCanvasState,
            nodes: currentCanvasState.nodes.filter((candidate: CanvasNode) => !nodeIds.has(candidate.nodeId)),
            edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                !nodeIds.has(edge.sourceNodeId) && !nodeIds.has(edge.targetNodeId)
            ),
        }
        commitTransientCanvasStatePreservingEditors(nextState)
        removeApiCanvasRemovedNodesFromDOM(nodeIds)
        syncConnectionManagerForCurrentCanvasState({ flushPixi: true })
    }

    async function stopBranchMarkerGeneration(node: BranchMarkerNode): Promise<void> {
        const threadId = getBranchMarkerThreadId(node)
        if (!threadId) return

        const generationRequestId = node.generationRequestId && !node.generationRequestId.startsWith('canvas-')
            ? node.generationRequestId
            : undefined

        if (generationRequestId) cancelledMediaGenerationRequestIds.add(generationRequestId)
        removeActiveGeneratedMediaNodesForBranchMarker(node)
        if (generationRequestId) {
            settleMediaGenerationRequest(threadId, generationRequestId, undefined, { preserveGeometry: true })
        } else {
            clearPendingGeneratedMediaPlacementsForThread(threadId)
            settleBranchMarkersForGenerationRequest(node.generationRequestId, { preserveGeometry: true })
            settleDetachedCanvasRun(threadId)
            scheduleDetachedCanvasRunTeardown(threadId)
            refreshBranchMarkersForAiChatThread(threadId)
        }

        try {
            await stopAiChatMessageForThread({
                workspaceId,
                conversationAssetId: threadId,
                ...(generationRequestId ? { generationRequestId } : {}),
            })
            await refreshPersistedAiChatThreadForBranchMarkers(threadId)
        } catch (error) {
            console.error('[CANVAS] failed to stop branch-marker generation', {
                nodeId: node.nodeId,
                threadId,
                error,
            })
        }
    }

    function getBranchMarkerStopControlKey(node: BranchMarkerNode): string {
        return [node.nodeId, node.generationRequestId, getBranchMarkerThreadId(node)].join(':')
    }

    function createBranchMarkerStopControl(node: BranchMarkerNode): HTMLButtonElement {
        const handlePointerDown = (event: PointerEvent): void => {
            event.preventDefault()
            event.stopPropagation()
        }
        const handleMouseEvent = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
        }
        const handleClick = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            void stopBranchMarkerGeneration(node)
        }

        return html`
            <button
                type="button"
                className="workspace-branch-marker-stop-control nopan"
                data=${{ branchStopKey: getBranchMarkerStopControlKey(node) }}
                aria-label="Stop all branch generations"
                title="Stop all branch generations"
                onpointerdown=${handlePointerDown}
                onpointerup=${handlePointerDown}
                onmousedown=${handleMouseEvent}
                onmouseup=${handleMouseEvent}
                onclick=${handleClick}
            >
                <span className="workspace-branch-marker-stop-icon" innerHTML=${pauseIcon} aria-hidden="true"></span>
            </button>
        ` as HTMLButtonElement
    }

    function syncBranchMarkerStopControl(node: BranchMarkerNode, nodeEl: HTMLElement): void {
        const currentControl = nodeEl.querySelector(':scope > .workspace-branch-marker-stop-control') as HTMLButtonElement | null
        if (!isBranchMarkerGenerationGroupActive(node)) {
            currentControl?.remove()
            return
        }
        const nextControlKey = getBranchMarkerStopControlKey(node)
        if (currentControl?.dataset.branchStopKey === nextControlKey) return

        const nextControl = createBranchMarkerStopControl(node)
        if (currentControl) {
            currentControl.replaceWith(nextControl)
            return
        }
        nodeEl.appendChild(nextControl)
    }

    function createBranchMarkerReviewControls(node: BranchMarkerNode): HTMLDivElement | null {
        branchMarkerReviewDropdowns.get(node.nodeId)?.destroy()
        branchMarkerReviewDropdowns.delete(node.nodeId)
        const mediaNodes = getBranchMarkerGeneratedMediaNodes(node)
            .filter(mediaNode => !isGeneratedOutputAccepted(mediaNode))
        if (mediaNodes.length === 0 || isBranchMarkerGenerationGroupActive(node)) return null
        const canAcceptAll = mediaNodes.every((mediaNode) => {
            const asset = assetsStore.get(mediaNode.assetId)
            return asset?.media?.renditions.original?.status === 'ready'
                && asset.states.provenance === 'sealed'
        })
        const handleAcceptAll = (event: MouseEvent): void => {
            event.preventDefault()
            event.stopPropagation()
            void acceptGeneratedOutput('branch-lineage', node.nodeId)
        }
        const regenerate = (mode: 'existing-prompt' | 'regenerate-prompt'): void => {
            void regenerateGeneratedOutputs({
                scope: 'branch-lineage',
                mode,
                targetNodeId: node.nodeId,
                mediaNodes,
            })
        }
        const stopPointerEvent = (event: PointerEvent): void => {
            event.preventDefault()
            event.stopPropagation()
        }
        const controls = html`
            <div className="workspace-branch-marker-review-controls nopan">
                <button
                    type="button"
                    className="workspace-branch-marker-review-action is-accept"
                    aria-label="Accept all generated variants"
                    title=${canAcceptAll ? 'Accept all generated variants' : 'Wait for every variant history to finish sealing'}
                    onpointerdown=${stopPointerEvent}
                    onclick=${handleAcceptAll}
                >
                    <span className="workspace-branch-marker-review-action-icon" innerHTML=${checkMarkIcon} aria-hidden="true"></span>
                </button>
                <div className="media-info-model-separator media-review-action-separator" aria-hidden="true"></div>
            </div>
        ` as HTMLDivElement
        const acceptButton = controls.querySelector('.workspace-branch-marker-review-action') as HTMLButtonElement
        acceptButton.disabled = !canAcceptAll
        const regenerationOptions = [
            {
                title: 'Regenerate variants',
                mode: 'existing-prompt' as const,
            },
            {
                title: 'Regenerate prompt',
                mode: 'regenerate-prompt' as const,
            },
        ]
        const regenerationSelection = { title: '' }
        let regenerationDropdown: ReturnType<typeof createPureDropdown>
        regenerationDropdown = createPureDropdown({
            id: `branch-regeneration-${node.nodeId}`,
            selectedValue: regenerationSelection,
            options: regenerationOptions,
            buttonIcon: refreshIcon,
            theme: 'dark',
            renderIconForSelectedValue: false,
            renderIconForOptions: false,
            renderTitleForSelectedValue: false,
            mountToBody: true,
            disableTriggerHover: true,
            onSelect: option => {
                regenerationDropdown.update(regenerationSelection)
                regenerate(option.mode)
            },
        })
        regenerationDropdown.dom.classList.add('workspace-branch-marker-regeneration-dropdown')
        const regenerationButton = regenerationDropdown.dom.querySelector('button') as HTMLButtonElement
        regenerationButton.disabled = !canAcceptAll
        regenerationButton.setAttribute('aria-label', 'Regenerate branch outputs')
        regenerationButton.title = canAcceptAll
            ? 'Choose how to regenerate branch outputs'
            : 'Wait for every variant history to finish sealing'
        controls.appendChild(regenerationDropdown.dom)
        applyBranchMarkerReviewControlsZoom(controls, getCurrentViewportZoom())
        branchMarkerReviewDropdowns.set(node.nodeId, regenerationDropdown)
        return controls
    }

    function applyBranchMarkerReviewControlsZoom(controls: HTMLElement, zoom: number): void {
        const worldScale = scaleCanvasChromeWorldSizeForZoom(
            1,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),
        )
        controls.style.setProperty('--workspace-branch-marker-review-zoom-scale', String(worldScale))
    }

    function updateBranchMarkerReviewControlsZoom(zoom: number): void {
        if (!viewportEl) return
        for (const controls of viewportEl.querySelectorAll<HTMLElement>('.workspace-branch-marker-review-controls')) {
            applyBranchMarkerReviewControlsZoom(controls, zoom)
        }
    }

    function syncBranchMarkerReviewControls(node: BranchMarkerNode, nodeEl: HTMLElement): void {
        nodeEl.querySelector(':scope > .workspace-branch-marker-review-controls')?.remove()
        const controls = createBranchMarkerReviewControls(node)
        if (controls) nodeEl.appendChild(controls)
    }

    function createBranchMarkerContent({
        node,
        label,
    }: {
        node: BranchMarkerNode
        label: string
    }): HTMLDivElement {
        const threadPreview = getBranchMarkerConversationPreview(node)
        const promptText = (threadPreview?.userText ?? '').trim()
        const promptPreview = getBranchMarkerPromptPreview(promptText)
        // Media models render as a separate stacked circle rail to the right of
        // the text pill once generated media descendants exist.
        const modelDetails = getBranchMarkerModelDetails(node)
        const mediaModelEntries = getBranchMarkerMediaModelTooltipEntries(node)
        const modelSummary = getBranchMarkerModelSummary(modelDetails)
        const reasoningModelEntry = getBranchMarkerReasoningModelEntry(node)
        const reasoningModelIcon = reasoningModelEntry ? reasoningModelEntry.icon ?? atomIcon : null
        const reasoningModelSummary = reasoningModelEntry?.title ? `Reasoning: ${reasoningModelEntry.title}` : ''
        // Live reasoning stream (pending markers only). An empty receiving
        // response shell keeps the marker as a single user row; streamed
        // response text creates the separator and moves progress to row two.
        const responseText = threadPreview?.responseText || ''
        const responsePhase = threadPreview?.phase ?? 'preamble'
        const responseIsReceiving = Boolean(threadPreview?.isReceiving)
        const showResponseLine = shouldShowBranchMarkerResponseLine(node, threadPreview)
        const responsePreview = showResponseLine
            ? getBranchMarkerResponsePreview(responseText, { isReceiving: responseIsReceiving })
            : ''
        const pendingForUi = isBranchMarkerPendingForUi(node)
        const spinnerOnUserLine = pendingForUi && !showResponseLine
        const spinnerOnResponseLine = pendingForUi && showResponseLine && responseIsReceiving
        const showStopControl = isBranchMarkerGenerationGroupActive(node)
        const responseIsEnhancing = responseIsReceiving && responsePhase === 'enhancement'
        const responseDone = showResponseLine && (!pendingForUi || responsePhase === 'done' || !responseIsReceiving)
        const responseSummary = responsePreview ? `Response: ${responsePreview}` : ''
        const accessibleLabel = [promptPreview, label, reasoningModelSummary, responseSummary, modelSummary].filter(Boolean).join(' · ')
        const contentClassName = `workspace-branch-marker-content${showStopControl ? ' has-stop-control' : ''}`
        const messageClassName = `workspace-branch-marker-message${pendingForUi ? ' is-pending' : ''}`
        const responseClassName = `workspace-branch-marker-response${responseIsEnhancing ? ' is-enhancing' : ''}`
        // The marker DOM is rebuilt as it streams and as it travels through pending
        // states (preflight → planned → committed). A fresh spinner element would
        // restart its CSS rotation each time. Anchoring `animation-delay` to a
        // negative offset into the global 800ms rotation phase-aligns every newly
        // created spinner with the shared clock, so the spin looks continuous and
        // never visibly restarts no matter how often the element is recreated.
        const spinnerStyle = { animationDelay: `${-(performance.now() % BRANCH_MARKER_SPINNER_PERIOD_MS)}ms` }
        return html`
            <div className=${contentClassName} aria-label=${accessibleLabel}>
                <div className="workspace-branch-marker-main">
                    <div className=${messageClassName}>
                        ${reasoningModelEntry && reasoningModelIcon
                            ? createBranchMarkerReasoningTooltip(node.nodeId, reasoningModelEntry.title, reasoningModelIcon)
                            : null}
                        ${spinnerOnUserLine
                            ? html`<span className="workspace-branch-marker-spinner workspace-branch-marker-message-progress" style=${spinnerStyle} aria-hidden="true"></span>`
                            : null}
                        <span className="workspace-branch-marker-message-text">${promptPreview}</span>
                    </div>
                    ${showResponseLine ? html`
                        <div className="workspace-branch-marker-separator"></div>
                        <div className=${responseClassName}>
                            ${spinnerOnResponseLine
                                ? html`<span className="workspace-branch-marker-spinner workspace-branch-marker-response-spinner" style=${spinnerStyle} aria-hidden="true"></span>`
                                : responseDone
                                    ? html`<span className="workspace-branch-marker-response-icon" innerHTML=${promptIcon} aria-hidden="true"></span>`
                                    : null}
                            <span className="workspace-branch-marker-response-text">${responsePreview}</span>
                        </div>
                    ` : null}
                </div>
                ${mediaModelEntries.length > 0 ? html`
                    <div className="workspace-branch-marker-media-models">
                        ${mediaModelEntries.map(({ label: mediaLabel, entry }, index) =>
                            createBranchMarkerMediaModelTooltip(node.nodeId, mediaLabel, entry, index)
                        )}
                    </div>
                ` : null}
            </div>
        ` as HTMLDivElement
    }

    function isBranchMarkerNode(node: CanvasNode): node is BranchMarkerNode {
        return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
    }

    function isCurrentBranchMarkerPending(nodeId: string): boolean {
        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        return Boolean(
            node
            && isBranchMarkerNode(node)
            && !hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)
            && (node.pendingState || isBranchMarkerPendingForUi(node))
        )
    }

    function handleBranchMarkerInfoClick(nodeId: string): void {
        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node || !isBranchMarkerNode(node)) {
            console.info('[CANVAS][branch-marker-info]', 'info-click-missing-node', { nodeId })
            return
        }

        const hasStartedMedia = hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)
        const pendingForUi = isBranchMarkerPendingForUi(node)
        const wouldHaveBeenBlockedByPendingState = isCurrentBranchMarkerPending(node.nodeId)
        console.info('[CANVAS][branch-marker-info]', 'info-click', {
            nodeId: node.nodeId,
            markerType: node.type,
            threadId: getBranchMarkerThreadId(node),
            generationRequestId: node.generationRequestId,
            pendingPhase: node.pendingState?.phase ?? '',
            uiPhase: getBranchMarkerUiPhase(node) ?? '',
            hasStartedMedia,
            pendingForUi,
            wouldHaveBeenBlockedByPendingState,
        })

        if (node.type === 'branchOrigin') {
            toggleBranchOriginGeneratedMediaInfo(node.nodeId)
        } else if (node.type === 'branchFork') {
            toggleBranchForkGeneratedMediaInfo(node.nodeId)
        } else {
            toggleBranchLineGeneratedMediaInfo(node.nodeId)
        }
    }

    function getBranchMarkerTypeLabel(node: BranchMarkerNode): string {
        if (getBranchMarkerUiPhase(node) === 'preflight') return 'Preparing branch'
        if (node.type === 'branchOrigin') return 'Start branch'
        if (node.type === 'branchFork') return 'Fork branch'
        return 'Continue branch'
    }

    function syncBranchMarkerNodeContent(node: BranchMarkerNode, nodeElOverride?: HTMLElement): void {
        const nodeEl = nodeElOverride ?? findBranchMarkerNodeElForNode(node)
        if (!nodeEl) return

        const currentContent = nodeEl.querySelector('.workspace-branch-marker-content')
        const dragOverlay = nodeEl.querySelector('.branch-origin-drag-overlay, .branch-fork-drag-overlay, .branch-line-drag-overlay')
        destroyBranchMarkerReasoningTooltip(node.nodeId)
        const nextContent = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        if (currentContent) {
            // The content is rebuilt on every streamed segment / state change, which
            // would restart a fresh spinner's CSS rotation. Continuity is handled by
            // phase-aligning each spinner to a shared clock (see createBranchMarkerContent),
            // so a plain replace is safe here.
            currentContent.replaceWith(nextContent)
            syncBranchMarkerStopControl(node, nodeEl)
            syncBranchMarkerReviewControls(node, nodeEl)
            return
        }
        nodeEl.insertBefore(nextContent, dragOverlay)
        syncBranchMarkerStopControl(node, nodeEl)
        syncBranchMarkerReviewControls(node, nodeEl)
    }

    function syncBranchMarkerNodeContents(): void {
        if (!currentCanvasState) return
        for (const node of currentCanvasState.nodes) {
            if (isBranchMarkerNode(node)) syncBranchMarkerNodeContent(node)
        }
    }

    function createBranchOriginNode(node: BranchOriginCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-branch-origin-node',
            {
                branchId: node.branchId,
                generationRequestId: node.generationRequestId,
            },
            {
                renderResizeHandles: false,
                allowSelection: false,
                onClick: () => {
                    handleBranchMarkerInfoClick(node.nodeId)
                },
            }
        )
        dragOverlay.className = 'branch-origin-drag-overlay nopan'

        const content = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        nodeEl.insertBefore(content, dragOverlay)
        syncBranchMarkerStopControl(node, nodeEl)
        syncBranchMarkerReviewControls(node, nodeEl)

        return nodeEl
    }

    function createBranchForkNode(node: BranchForkCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-branch-fork-node',
            {
                branchId: node.branchId,
                generationRequestId: node.generationRequestId,
                reasoningRunId: node.reasoningRunId ?? '',
                reasoningModelId: node.reasoningModelId ?? '',
                reasoningIndex: node.reasoningIndex == null ? '' : String(node.reasoningIndex),
            },
            {
                renderResizeHandles: false,
                allowSelection: false,
                onClick: () => {
                    handleBranchMarkerInfoClick(node.nodeId)
                },
            }
        )
        dragOverlay.className = 'branch-fork-drag-overlay nopan'

        const content = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        nodeEl.insertBefore(content, dragOverlay)
        syncBranchMarkerStopControl(node, nodeEl)
        syncBranchMarkerReviewControls(node, nodeEl)

        return nodeEl
    }

    function createBranchLineNode(node: BranchLineCanvasNode): HTMLElement {
        const { nodeEl, dragOverlay } = createBaseNodeElement(
            node,
            'workspace-branch-line-node',
            {
                branchId: node.branchId,
                generationRequestId: node.generationRequestId,
                reasoningRunId: node.reasoningRunId ?? '',
                reasoningModelId: node.reasoningModelId ?? '',
                reasoningIndex: node.reasoningIndex == null ? '' : String(node.reasoningIndex),
            },
            {
                renderResizeHandles: false,
                allowSelection: false,
                onClick: () => {
                    handleBranchMarkerInfoClick(node.nodeId)
                },
            }
        )
        dragOverlay.className = 'branch-line-drag-overlay nopan'

        const content = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        nodeEl.insertBefore(content, dragOverlay)
        syncBranchMarkerStopControl(node, nodeEl)
        syncBranchMarkerReviewControls(node, nodeEl)

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

            const completedMarqueeSelection = Boolean(marqueeSelection?.moved)
            marqueeSelection = null
            hideSelectionRectElement()
            connectionManager?.cancelTransientConnection()
            updateSelectionGroupOverlayElement()
            if (completedMarqueeSelection && selectionIsFromMarquee) addContextChips(selectedNodeIds)

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

        destroyGeneratedMediaInfoRenderers()
        resetGeneratedMediaChromeSyncKey()
        destroyBranchMarkerReasoningTooltips()
        viewportEl.innerHTML = ''

        ensureConnectionManager()
        ensureSelectionGroupOverlayElement()
        ensureSelectionRectElement()

        const shouldAnimatePanelOpenAfterRender = aiChatPanelState.isOpen && !activeAiChatPanelEl && hasRenderedInitialAiChatPanelState
        if (!activeClosingRightSidePanel) destroyActiveAiChatPanel(false)

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

        // Clear loaded node tracking on full re-render
        loadedNodeIds.clear()

        const documentMap = new Map<string, Document>(currentDocuments.map((d) => [d.documentId, d]))
        for (const node of currentCanvasState.nodes) {
            let nodeEl: HTMLElement

            if (node.type === 'document') {
                const docNode = node as DocumentCanvasNode
                const doc = documentMap.get(docNode.assetId)
                nodeEl = createDocumentNode(docNode, doc)
            } else if (node.type === 'mediaDocument') {
                nodeEl = createDocumentMediaNode(node as DocumentMediaCanvasNode)
            } else if (node.type === 'image') {
                nodeEl = createImageNode(node as ImageCanvasNode)
            } else if (node.type === 'video') {
                nodeEl = createVideoNode(node as VideoCanvasNode)
            } else if (node.type === 'audio') {
                nodeEl = createAudioNode(node as AudioCanvasNode)
            } else if (node.type === 'uploadPlaceholder') {
                nodeEl = createUploadPlaceholderNode(node as UploadPlaceholderCanvasNode)
            } else if (node.type === 'branchOrigin') {
                if (shouldDeferPlannedBranchMarkerViewportRender(node as BranchOriginCanvasNode)) continue
                nodeEl = createBranchOriginNode(node as BranchOriginCanvasNode)
            } else if (node.type === 'branchFork') {
                if (shouldDeferPlannedBranchMarkerViewportRender(node as BranchForkCanvasNode)) continue
                nodeEl = createBranchForkNode(node as BranchForkCanvasNode)
            } else if (node.type === 'branchLine') {
                if (shouldDeferPlannedBranchMarkerViewportRender(node as BranchLineCanvasNode)) continue
                nodeEl = createBranchLineNode(node as BranchLineCanvasNode)
            } else {
                // Inert guard: persisted workspaces may still contain
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

        renderActiveAiChatPanel(undefined, { animateOpen: shouldAnimatePanelOpenAfterRender })

        // A full re-render (including initial page load) appends pending markers at
        // their stale stored world position inside viewportEl. Project them onto the
        // screen-fixed overlay now so they don't appear mispositioned until the next
        // pan/zoom. A deferred pass re-runs once the composer has been laid out and
        // its bounds are measurable (first paint may report a zero rect).
        syncPendingBranchMarkerScreenPlacements()
        requestAnimationFrame(() => syncPendingBranchMarkerScreenPlacements())

        lastNodeStructureKey = getNodeStructureKey(currentCanvasState)

        // PIXI sync is driven by the caller (render() / commitCanvasState),
        // not here — avoids a duplicate sync when renderNodes() is called
        // from render() which syncs PIXI immediately afterwards.
    }

    function getDocumentsKey(docs: Document[]): string {
        // Track document IDs and their loaded state
        return docs.map(d => `${d.documentId}:${d.content ? 'loaded' : 'pending'}`).join(',')
    }

    function isDetachedCanvasThreadId(threadId: string): boolean {
        return threadId.startsWith('canvas-')
    }

    function hasDetachedCanvasRunCanvasProjection(threadId: string): boolean {
        if (!currentCanvasState) return false

        return currentCanvasState.nodes.some((node: CanvasNode) => {
            if (isBranchMarkerNode(node) && getBranchMarkerThreadId(node) === threadId) return true
            return (node.type === 'image' || node.type === 'video')
                && node.generatedBy?.conversationAssetId === threadId
        })
    }

    function isRecentDetachedCanvasThreadUpdate(thread: AiChatThread): boolean {
        const updatedAt = Number(thread.updatedAt)
        return Number.isFinite(updatedAt)
            && Date.now() - updatedAt <= DETACHED_CANVAS_PREFLIGHT_REATTACH_WINDOW_MS
    }

    function getAiChatThreadsKey(threads: AiChatThread[]): string {
        // Context-region threads render in the singleton side panel. Loading a
        // thread's ProseMirror content should refresh that panel, not tear down
        // every canvas node and PIXI/DOM proxy on the workspace surface.
        return threads
            .filter(t => !isDetachedCanvasThreadId(t.threadId))
            .map(t => t.threadId)
            .join(',')
    }

    let lastDocumentsKey = getDocumentsKey(currentDocuments)
    let lastThreadsKey = getAiChatThreadsKey(currentAiChatThreads)

    function clearWorkspaceVisualContent(newDocuments: Document[], newAiChatThreads: AiChatThread[]): void {
        destroyGeneratedMediaInfoRenderers()
        resetGeneratedMediaChromeSyncKey()
        destroyBranchMarkerReasoningTooltips()
        destroyVideoControlInstances()
        viewportEl.innerHTML = ''
        selectionRectEl = null
        selectionGroupOverlayEl = null
        selectedNodeIds = new Set()
        selectedEdgeId = null
        clearMarqueeInteractionState()
        connectionManager?.syncNodes([])
        connectionManager?.syncEdges([])
        connectionManager?.render()
        syncPixiMediaLayer(null)
        lastNodeStructureKey = getNodeStructureKey(null)
        lastVisualSyncKey = getCanvasVisualSyncKey(null)
        lastDocumentsKey = getDocumentsKey(newDocuments)
        lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)

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
    }

    function getWorkspaceLoadErrorMessage(error: unknown): string {
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

    function refreshActiveAiChatPanelWhenContentLoads(): void {
        if (!activeAiChatThreadId) return
        if (!activeAiChatPanelEl || activeAiChatPanelThreadId !== activeAiChatThreadId) return
        if (activeAiChatPanelHadContent) return

        const thread = currentAiChatThreads.find((candidate) => candidate.threadId === activeAiChatThreadId)
        if (!aiChatThreadHasRenderableContent(thread)) return

        renderActiveAiChatPanel(thread)
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

        if (shouldClearGeneratedMediaInfoForCanvasClick(e.target)) {
            clearGeneratedMediaInfoPanels()
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
                onUseFeature: insertFeatureIntoActivePrompt,
                getFeatureExtractionRuns: getFeatureExtractionRunsForPanel,
                createFeatureExtractionModelControls,
                onConfirmFeatureExtraction: (extractionRunId, bodyEl, modelContext) => startFeatureExtractionFromPanel(extractionRunId, bodyEl, modelContext),
                onInsertAsset: async (item: AssetMeta) => {
                    if (!onAssetAttach) return false
                    const nodeId = `node-${uuidv4()}`
                    const width = settings.mediaNode.image.defaultInsertionWidth
                    const aspectRatio = item.aspectRatio && item.aspectRatio > 0 ? item.aspectRatio : 1
                    const type = item.primaryCategory === 'document' ? 'mediaDocument' : item.primaryCategory
                    if (type === 'conversation') return false
                    const insertion = {
                        nodeId,
                        type,
                        assetId: item.assetId,
                        dimensions: type === 'audio' ? { width: 360, height: 96 } : { width, height: width / aspectRatio },
                    } as WorkspaceCanvasNodeInsertion
                    const nextState = insertNodeAtViewportCenterInternal(insertion, {}, false)
                    await onAssetAttach({ assetId: item.assetId, nodeId, canvasState: nextState })
                    commitTransientCanvasStatePreservingEditors(nextState)
                    return true
                },
            })
        }
        return mediaLibraryPanelInstance
    }

    // Open the right side panel on a specific top-level surface (used by the
    // floating Media Library launcher and the `/use` slash command).
    function openRightSidePanelToMode(mode: CanvasRightSidePanelMode): void {
        ensureMediaLibraryPanel()
        const alreadyOnMode = aiChatPanelState.isOpen && aiChatPanelState.topLevelMode === mode
        aiChatPanelState = { ...aiChatPanelState, isOpen: true, topLevelMode: mode }
        persistAiChatSidebarState()
        if (!alreadyOnMode) syncActiveAiChatPanelFromState()
        renderActiveAiChatPanel()
        void loadExtractionSessionHistory()
    }

    const onOpenExtractionPanel = (event: Event) => {
        const detail = (event as CustomEvent<{
            extractionRunId?: string
            workspaceId?: string
            userText?: string
            sourceContextSnapshot?: ExtractionTabContext
        }>).detail
        if (!detail?.extractionRunId) return
        if (detail.workspaceId && detail.workspaceId !== workspaceId) return
        if (!getFeatureExtractionState(detail.extractionRunId)) {
            const sourceContextSnapshot = detail.sourceContextSnapshot ?? {}
            setPendingExtractionContext(detail.extractionRunId, sourceContextSnapshot)
            setPendingFeatureExtractionRun({
                extractionRunId: detail.extractionRunId,
                status: 'pending',
                userText: detail.userText?.trim() || 'Extract a reusable visual feature from the selected context.',
                sourceContextSnapshot,
                updatedAt: Date.now(),
            })
        }
        openFeatureExtractionRunInFeatures(detail.extractionRunId)
    }

    const onOpenMediaLibraryFeatures = (event: Event) => {
        const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
        if (detail?.workspaceId && detail.workspaceId !== workspaceId) return
        openRightSidePanelToMode('features')
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('lixpi:open-extraction-tab', onOpenExtractionPanel)
    window.addEventListener('lixpi:open-media-library-features', onOpenMediaLibraryFeatures)

    initializePanZoom()
    initCanvasBubbleMenu()
    syncActiveAiChatPanelFromState()
    if (!aiChatPanelState.isOpen) ensureActiveRightSidePanel()
    // Create the connection manager up front so connector edges render even when
    // the canvas mounts empty. renderNodes() only calls ensureConnectionManager()
    // after an early-return guard on currentCanvasState, so a workspace that starts
    // with no nodes (e.g. the first branch from the canvas-wide composer) would
    // otherwise never get a connection manager — edges get committed to state but
    // never drawn until a reload runs renderNodes() with a non-null state.
    ensureConnectionManager()
    renderNodes()
    reattachDetachedCanvasRunListenersForActiveMarkers()
    syncPixiMediaLayer(currentCanvasState)
    if (initialStaleMediaAnalysisReset && currentCanvasState) {
        initialStaleMediaAnalysisReset = false
        pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(currentCanvasState)
        onCanvasStateChange?.(currentCanvasState)
    }

    let hasObservedInitialAiModelsStore = false
    const unsubscribeAiModelsStore = aiModelsStore.subscribe(() => {
        if (!hasObservedInitialAiModelsStore) {
            hasObservedInitialAiModelsStore = true
            return
        }
        scheduleGeneratedMediaChromeSync()
        syncBranchMarkerNodeContents()
    })
    let hasObservedInitialAssetsStore = false
    const unsubscribeAssetsStore = assetsStore.subscribe(() => {
        if (!hasObservedInitialAssetsStore) {
            hasObservedInitialAssetsStore = true
            return
        }
        scheduleGeneratedMediaChromeSync()
        syncBranchMarkerNodeContents()
    })
    const unsubscribeWorkspaceStore = workspaceStore.subscribe(({ meta, data }) => {
        lastWorkspaceLoadingStatus = meta.loadingStatus
        if (meta.loadingStatus === LoadingStatus.error) {
            workspaceLoadingOutline?.setVisible(false)
            workspaceLoadingOutline?.setErrorMessage(getWorkspaceLoadErrorMessage(data.error))
        } else if (meta.loadingStatus === LoadingStatus.loading) {
            workspaceLoadingOutline?.setErrorMessage(null)
        }
    })

    function insertNodeAtViewportCenterInternal(
        node: WorkspaceCanvasNodeInsertion,
        statePatch: WorkspaceCanvasInsertionStatePatch = {},
        persist = true,
    ) {
        const baseCanvasState: CanvasState = currentCanvasState ?? {
            viewport: getLiveViewport(),
            edges: [],
            nodes: [],
        }
        const positionedNode = {
            ...node,
            position: getCenteredInsertionPosition(node.dimensions),
        } as CanvasNode
        const preparedNode = positionedNode
        const newCanvasState: CanvasState = {
            ...baseCanvasState,
            ...statePatch,
            viewport: baseCanvasState.viewport,
            edges: baseCanvasState.edges ?? [],
            nodes: resolveTopLevelNodeCollisions([...baseCanvasState.nodes, preparedNode]),
        }

        if (persist) {
            pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(newCanvasState)
            onCanvasStateChange?.(newCanvasState)
        }

        return newCanvasState
    }

    return {
        getCanvasState() {
            return currentCanvasState
                ? { ...currentCanvasState, viewport: getLiveViewport() }
                : null
        },
        getViewport() {
            return getLiveViewport()
        },
        insertNodeAtViewportCenter(node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}, commit = true) {
            return insertNodeAtViewportCenterInternal(node, statePatch, commit)
        },
        replaceUploadPlaceholder(placeholderNodeId: string, node: WorkspaceCanvasNodeInsertion, commit = true) {
            return replaceUploadPlaceholderInternal(placeholderNodeId, node, commit)
        },
        commitTransientCanvasState(canvasState: CanvasState) {
            commitTransientCanvasStatePreservingEditors(canvasState)
        },
        markUploadPlaceholderFailed(placeholderNodeId: string, message: string) {
            return markUploadPlaceholderFailedInternal(placeholderNodeId, message)
        },
        render(newCanvasState: CanvasState | null, newDocuments: Document[], newAiChatThreads: AiChatThread[] = [], newWorkspaceId?: string) {
            const transitionPlan = planWorkspaceRenderTransition({
                currentRouteWorkspaceId: workspaceId,
                nextRouteWorkspaceId: newWorkspaceId,
                renderedWorkspaceId,
                incomingCanvasState: newCanvasState,
                loadingStatus: lastWorkspaceLoadingStatus,
            })
            const workspaceChanged = transitionPlan.shouldTreatAsWorkspaceChanged
            workspaceId = transitionPlan.routeWorkspaceId
            workspaceLoadingOutline?.setVisible(transitionPlan.shouldShowLoadingOutline)
            if (workspaceChanged) pendingLocalCanvasVisualCommit = null

            const pendingVisualCommitBeforeMerge = pendingLocalCanvasVisualCommit
            const renderStatePlan = mergeIncomingCanvasStateWithPendingVisualCommit({
                incomingState: newCanvasState,
                pendingVisualCommit: pendingVisualCommitBeforeMerge,
            })
            const normalizedCanvasState = renderStatePlan.state
                ? normalizeBranchMarkerDimensions(renderStatePlan.state)
                : renderStatePlan.state
            pendingLocalCanvasVisualCommit = renderStatePlan.pendingVisualCommit
            if (pendingVisualCommitBeforeMerge || renderStatePlan.usedPendingVisualState || renderStatePlan.acknowledgedPendingVisualState) {
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
            const incomingMatchesLocalVisualCommit = renderStatePlan.usedPendingVisualState || renderStatePlan.acknowledgedPendingVisualState
            const shouldResetStaleMediaAnalysis = workspaceChanged || (!currentCanvasState && Boolean(normalizedCanvasState) && !incomingMatchesLocalVisualCommit)
            const mediaAnalysisState = shouldResetStaleMediaAnalysis && normalizedCanvasState
                ? resetStaleAnalyzingMediaDescriptors(normalizedCanvasState)
                : { state: normalizedCanvasState, changed: false }
            const persistedCanvasState = mediaAnalysisState.state
            const effectiveCanvasState = workspaceChanged
                ? persistedCanvasState
                : preserveActiveGeneratedMediaTrackersInState(persistedCanvasState)
            if (mediaAnalysisState.changed && persistedCanvasState) {
                pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(persistedCanvasState)
                onCanvasStateChange?.(persistedCanvasState)
            }

            // Stale drag/resize positions from a previous workspace would corrupt
            // getNodeWorldPosition for the new workspace's nodes.
            if (workspaceChanged) {
                liveNodeOverrides.clear()
                branchMarkerProjectionOverrideNodeIds.clear()
                manuallyPositionedBranchMarkerNodeIds.clear()
                selectedNodeIds = new Set()
                selectedEdgeId = null
                draggingNodeId = null
                resizingNodeId = null
                extractionSessionHistoryLoaded = false
                liveAiChatThreadContentOverrides.clear()
                partialImageTracker.clear()
                videoGenerationTracker.clear()
                generatingReferenceNodeIdsByThread.clear()
                decodedGeneratedImageNodeIds.clear()
                finalizingGeneratedImageRunKeysByNodeId.clear()
                for (const timer of finalizingGeneratedImageOutlineTimersByNodeId.values()) window.clearTimeout(timer)
                finalizingGeneratedImageOutlineTimersByNodeId.clear()
                for (const pendingRunId of pendingFeatureExtractionRuns.keys()) clearPendingExtractionContext(pendingRunId)
                pendingFeatureExtractionRuns.clear()
                apiFeatureExtractionRuns.clear()
                featureExtractionModelSelections.clear()
                unsubscribeAllFeatureExtractionRuns()
            }

            // Only do a full re-render if node structure or documents/threads changed
            // Position/dimension updates are handled directly in DOM during drag/resize
            const nextNodeStructureKey = getNodeStructureKey(effectiveCanvasState)
            const nextDocumentsKey = getDocumentsKey(newDocuments)
            const nextThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            const nodeStructureChanged = nextNodeStructureKey !== lastNodeStructureKey
            const documentsKeyChanged = nextDocumentsKey !== lastDocumentsKey
            const threadsKeyChanged = nextThreadsKey !== lastThreadsKey
            const needsRerender = nodeStructureChanged || documentsKeyChanged || threadsKeyChanged || workspaceChanged

            // Check if viewport actually changed (not just nodes)
            const oldViewport = currentCanvasState?.viewport
            const newViewport = effectiveCanvasState?.viewport
            const viewportChanged = !oldViewport || !newViewport ||
                oldViewport.x !== newViewport.x ||
                oldViewport.y !== newViewport.y ||
                oldViewport.zoom !== newViewport.zoom
            const nextVisualSyncKey = getCanvasVisualSyncKey(effectiveCanvasState)
            const visualStateChanged = workspaceChanged || nextVisualSyncKey !== lastVisualSyncKey
            if (
                needsRerender
                || visualStateChanged
                || pendingVisualCommitBeforeMerge
                || renderStatePlan.usedPendingVisualState
                || renderStatePlan.acknowledgedPendingVisualState
                || hasOpenGeneratedMediaInfoPanels()
            ) {
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
                    previousNodeStructureKeyLength: lastNodeStructureKey.length,
                    nextNodeStructureKeyLength: nextNodeStructureKey.length,
                    previousDocumentsKey: lastDocumentsKey,
                    nextDocumentsKey,
                    previousThreadsKey: lastThreadsKey,
                    nextThreadsKey,
                    previousVisualSyncKeyLength: lastVisualSyncKey.length,
                    nextVisualSyncKeyLength: nextVisualSyncKey.length,
                    openMediaInfoPanelCount: expandedGeneratedMediaInfoNodeIds.size,
                    openMediaHistoryPanelCount: expandedGeneratedMediaHistoryNodeIds.size,
                    openBranchOriginInfoPanelCount: expandedBranchOriginInfoNodeIds.size,
                    openBranchForkInfoPanelCount: expandedBranchForkInfoNodeIds.size,
                    openBranchLineInfoPanelCount: expandedBranchLineInfoNodeIds.size,
                })
            }
            const liveViewport = getLiveViewport()
            const shouldPreserveLiveViewport = shouldPreserveLiveViewportForSameWorkspaceRender({
                incomingViewport: effectiveCanvasState?.viewport,
                liveViewport,
                workspaceChanged,
            })

            const shouldResetMediaLifecycle = workspaceChanged || (!currentCanvasState && Boolean(effectiveCanvasState))

            currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState
                ? { ...effectiveCanvasState, viewport: liveViewport }
                : effectiveCanvasState
            currentDocuments = newDocuments
            currentAiChatThreads = newAiChatThreads
            if (shouldResetMediaLifecycle) {
            }
            syncActiveAiChatPanelFromState()

            // 1. Rebuild DOM first so image nodes exist when PIXI syncs DOM ownership.
            if (transitionPlan.shouldClearVisualContent) {
                clearWorkspaceVisualContent(newDocuments, newAiChatThreads)
            } else if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
                lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            } else {
                refreshActiveAiChatPanelWhenContentLoads()
                if (aiChatPanelState.isOpen && !activeAiChatPanelEl) renderActiveAiChatPanel()
                if (!aiChatPanelState.isOpen && activeAiChatPanelEl && !activeClosingRightSidePanel) destroyActiveAiChatPanel(false)
            }
            if (currentCanvasState) renderedWorkspaceId = workspaceId
            refreshBranchMarkerPreviewsForLoadedThreads(newAiChatThreads)
            reattachDetachedCanvasRunListenersForActiveMarkers()

            // 2. Sync PIXI state BEFORE applying the viewport. This ensures
            //    `lastState` inside the PIXI layer is already the new workspace's
            //    canvas state when `setViewport` fires. Without this ordering, a
            //    zoom-tier change during workspace switch would call
            //    `upsertAllImages(OLD_STATE)`, spawning async texture fetches for
            //    the old workspace's images that arrive and overwrite new sprites.
            if (currentCanvasState && connectionManager && (visualStateChanged || needsRerender)) {
                if (!needsRerender) syncCanvasNodeDomGeometry(currentCanvasState.nodes)
                connectionManager.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
                connectionManager.syncEdges(currentCanvasState.edges)
                scheduleEdgesRender()
                syncPixiMediaLayer(currentCanvasState)
                lastVisualSyncKey = getCanvasVisualSyncKey(currentCanvasState)
            }

            // Video controls need videoNodeHandler entries. Those entries are
            // created by syncPixiMediaLayer, so media chrome must sync after the
            // PIXI/media-registry pass.
            syncGeneratedMediaChrome(currentCanvasState)

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
                if (
                    oldViewport?.x !== currentCanvasState?.viewport?.x
                    || oldViewport?.y !== currentCanvasState?.viewport?.y
                    || oldViewport?.zoom !== currentCanvasState?.viewport?.zoom
                ) {
                    updateGeneratedMediaChromeLayout()
                }
            }
        },
        toggleMediaLibrary() {
            if (aiChatPanelState.isOpen && aiChatPanelState.topLevelMode === 'media') {
                void closeAiChatPanel()
                return
            }
            openRightSidePanelToMode('media')
        },
        toggleAiChatPanel() {
            toggleAiChatPanelVisibility()
        },
        destroy() {
            clearRightPanelModeSwitchAnimationTimer()
            mediaLibraryPanelInstance?.destroy()
            resizeObserver.disconnect()
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('lixpi:open-extraction-tab', onOpenExtractionPanel)
            window.removeEventListener('lixpi:open-media-library-features', onOpenMediaLibraryFeatures)
            unsubscribeAiModelsStore()
            unsubscribeAssetsStore()
            unsubscribeWorkspaceStore()
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
            for (const timer of textDescriptorTimers.values()) clearTimeout(timer)
            textDescriptorTimers.clear()
            for (const timers of pendingAiChatThreadRefreshTimers.values()) {
                for (const timer of timers) window.clearTimeout(timer)
            }
            pendingAiChatThreadRefreshTimers.clear()
            for (const timer of finalizingGeneratedImageOutlineTimersByNodeId.values()) {
                window.clearTimeout(timer)
            }
            finalizingGeneratedImageOutlineTimersByNodeId.clear()
            finalizingGeneratedImageRunKeysByNodeId.clear()
            decodedGeneratedImageNodeIds.clear()
            connectionManager?.destroy()
            connectionManager = null
            viewportBridge = null
            destroyGeneratedMediaInfoRenderers()
            resetGeneratedMediaChromeSyncKey()
            destroyBranchMarkerReasoningTooltips()
            for (const dropdown of branchMarkerReviewDropdowns.values()) dropdown.destroy()
            branchMarkerReviewDropdowns.clear()
            destroyVideoControlInstances()
            mediaChromeViewportEl?.remove()
            mediaChromeViewportEl = null
            generatedMediaChromeLayerEl?.remove()
            generatedMediaChromeLayerEl = null
            pendingGeneratedMediaIconLayerEl?.remove()
            pendingGeneratedMediaIconLayerEl = null
            generatedMediaInfoPanelLayerEl?.remove()
            generatedMediaInfoPanelLayerEl = null
            pendingBranchMarkerOverlayEl?.remove()
            pendingBranchMarkerOverlayEl = null
            expandedGeneratedMediaInfoNodeIds.clear()
            expandedGeneratedMediaHistoryNodeIds.clear()
            expandedBranchOriginInfoNodeIds.clear()
            expandedBranchForkInfoNodeIds.clear()
            expandedBranchLineInfoNodeIds.clear()
            pixiMediaLayer?.destroy()
            pixiMediaLayer = null
            workspaceLoadingOutline?.destroy()
            workspaceLoadingOutline = null
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
            for (const [threadId, { editor, aiService, containerEl }] of detachedAiChatThreadEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
                promptInputController.unregisterThreadEditor(threadId)
                containerEl.remove()
            }
            detachedAiChatThreadEditors.clear()
            detachedAiChatThreadHostEl?.remove()
            detachedAiChatThreadHostEl = null
            videoNodeHandler?.destroy()
            videoNodeHandler = null
            partialImageTracker.clear()
            videoGenerationTracker.clear()
            cancelledMediaGenerationRequestIds.clear()
            branchMarkerUiPhaseByNodeId.clear()
            canvasBubbleMenu?.destroy()
            canvasBubbleMenu = null

            selectionRectEl?.remove()
            selectionRectEl = null
            selectionGroupOverlayEl?.remove()
            selectionGroupOverlayEl = null
            marqueeSelection = null

            for (const teardownCanvasRun of Array.from(activeCanvasRunTeardowns)) {
                teardownCanvasRun()
            }
            activeCanvasRunTeardowns.clear()
            activeCanvasRunTeardownsByThread.clear()
            activeCanvasRunServices.clear()
            activeCanvasRunIds.clear()
            settledDetachedCanvasRunThreadIds.clear()
            for (const pendingRunId of pendingFeatureExtractionRuns.keys()) clearPendingExtractionContext(pendingRunId)
            pendingFeatureExtractionRuns.clear()
            apiFeatureExtractionRuns.clear()
            featureExtractionModelSelections.clear()
            unsubscribeAllFeatureExtractionRuns()

            globalCanvasComposer?.destroy()
            globalCanvasComposer = null
            globalCanvasComposerHostEl?.remove()
            globalCanvasComposerHostEl = null

            destroyActiveAiChatPanel(true, activeAiChatPanelThreadId ?? activeAiChatThreadId, false, true)
            destroyContextPreviewTiles()
            activeContextChipTrayEls.clear()

            promptInputController.destroy()
        }
    }
}
