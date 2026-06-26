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
    STREAM_STATUS,
    type CanvasState,
    type CanvasNode,
    type DocumentCanvasNode,
    type ImageCanvasNode,
    type VideoCanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchForkLineagePlan,
    type BranchLineCanvasNode,
    type BranchLineLineagePlan,
    type AiChatThread,
    type WorkspaceEdge,
    type CanvasAiChatSidebarTab,
    type CanvasAiChatPanelState,
    type CanvasRightSidePanelMode,
    type CanvasFeatureExtractionState,
    type ExtractionRun,
    type StageTraceEvent,
    type FeatureMeta,
    type MediaLibraryImageMeta,
    type MediaLibraryVideoMeta,
    type ImageBranchCandidateSnapshot,
    type ImageBranchVlmResolution,
    type MediaBranchLineagePlan,
    type MediaRunLineageAssignment,
    type MediaDescriptor,
    type ContentDescriptor,
    type WorkspaceContextResolution,
    type WorkspaceContextSelection,
    type MediaGenerationRunMeta,
    type ImageGenerationTraceReference,
    type AiModelId,
    MEDIA_DESCRIPTOR_VERSION,
} from '@lixpi/constants'
import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import {
    createAiPromptComposer,
    createDefaultPromptControlFactories,
    type AiPromptComposerInstance,
    type AiPromptComposerSubmitData,
} from '$src/components/proseMirror/aiPromptComposer.ts'
import { setAiGeneratedImageCallbacks, setAiGeneratedVideoCallbacks } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/index.ts'
import {
    buildGeneratedMediaTurnProjectionFromThreadContent,
    collectProseMirrorText,
    parseProseMirrorJsonContent,
    type GeneratedMediaTurnLocator,
    type ProseMirrorJsonNode,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadContentUtils.ts'
import type { AiLineageProjectionScope } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'
import type { ImageGenerationTraceDetailsOptions } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/imageGenerationTraceDetails.ts'
import {
    mountReadOnlyAiChatThreadProjection,
    type ReadOnlyAiChatThreadRendererInstance,
} from '$src/components/proseMirror/readOnlyAiChatThreadRenderer.ts'
import { createHelpTooltip, type HelpTooltipInstance } from '$src/components/helpTooltip/index.ts'
import AiInteractionService from '$src/services/ai-interaction-service.ts'
import { imageResizeCornerIcon, infoCircleFilledIcon, trashBinIcon, aiChatPanelToggleHistoryIcon, xCircleIcon, atomIcon, imageIcon, videoPlayGlyphIcon, promptIcon, aiChatPanelCollapseIcon } from '$src/svgIcons/index.ts'
import { type Document } from '$src/stores/documentStore.ts'
import { createCanvasMediaNodeLifecycleTracker } from '$src/infographics/workspace/canvasMediaNodeLifecycle.ts'
import { shouldAcceptGeneratedMediaEvent as shouldAcceptGeneratedMediaEventForState } from '$src/infographics/workspace/generatedMediaEventWorkspaceGuard.ts'
import { createVideoNodeHandler, type VideoNodeHandlerControl } from '$src/infographics/workspace/rendering/videoNodeHandler.ts'
import { createLoadingPlaceholder, createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { getAdaptiveBoundedZoomScalingOptions, getCanvasChromeScreenLayout, getResizeHandleScaledSizes, scaleCanvasChromeToScreenForZoom, scaleCanvasChromeWorldSizeForZoom } from '$src/infographics/utils/zoomScaling.ts'
import { html, applyStyle } from '$src/utils/domTemplates.ts'
import { createSidePanel, type SidePanelInstance } from '$src/components/sidePanel/index.ts'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'
import {
    GeneratedMediaRebalancePipeline,
    reflowStackedBranchMarkers,
    type BranchMarkerNode,
    type CanvasGeometry,
} from '$src/infographics/workspace/generatedMediaRebalancePipeline.ts'
import { getStartedLineageMarkerState } from '$src/infographics/workspace/branchLineageState.ts'
import { getBranchMarkerMediaModelCircleDescriptors } from '$src/infographics/workspace/branchMarkerMediaModelCircles.ts'
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
import { CircularGlassMaterial } from '$src/utils/animations/gradients/pixiGlassMaterial.ts'
import { tPatternSvgTexture } from '$src/svgIcons/svgTextures.ts'
import { settings, type WorkspaceCollisionFlowSettings, type WorkspaceCollisionNodeTypeSettings } from '$src/settings.ts'
import { BubbleMenu, type BubbleMenuPositionRequest } from '$src/components/bubbleMenu/index.ts'
import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT, CANVAS_EDGE_CONTEXT } from '$src/infographics/workspace/canvasBubbleMenuItems.ts'
import { downloadImage } from '$src/utils/downloadImage.ts'
import { AiPromptInputController } from '$src/services/ai-prompt-input-controller.ts'
import MediaLibraryService from '$src/services/media-library-service.ts'
import { describeMedia, describeText } from '$src/services/media-descriptor-service.ts'
import { aiModelsStore } from '$src/stores/aiModelsStore.ts'
import {
    buildImageBranchCandidateSnapshot,
    buildCanvasWideCandidateSnapshot,
    buildWorkspaceContextSnapshot,
    getGeneratedImageTextByNodeIdFromThreadContent,
    getPromptTextFromMessages,
} from '$src/services/ai-image-branching.ts'
import { aiChatThreadsStore } from '$src/stores/aiChatThreadsStore.ts'
import { documentsStore } from '$src/stores/documentsStore.ts'
import { extractContentFromProseMirror } from '$src/services/ai-chat-thread-service.ts'
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
type GeneratedMediaInfoPanelOptions = {
    className?: string
    includeDescriptor?: boolean
    rendererKey?: string
    limitProjectionToSelectedMedia?: boolean
    lineageProjectionScope?: AiLineageProjectionScope
    // When true the panel only renders the media descriptor (summary + tags) and
    // never the AI chat thread projection — used by the media info (i) button,
    // which must always show media meta info, not the generating conversation.
    descriptorOnly?: boolean
}
type GeneratedMediaProjectionTarget = {
    node: ImageCanvasNode | VideoCanvasNode
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
}
type MountGeneratedMediaProjectionOptions = {
    mount: HTMLElement
    node: ImageCanvasNode | VideoCanvasNode
    rendererClassName: string
    traceDetailsClassName: string
    previewTiles: Set<ContextPreviewTileInstance>
    lineageProjectionScope: AiLineageProjectionScope
    limitProjectionToSelectedMedia: boolean
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

const RESIZE_CORNERS: ResizeCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const NODE_DRAG_START_THRESHOLD_PX = 6
// The marker is a pill that hugs the user message by default. Its width grows
// with the message length from a comfortable minimum up to a ceiling, after which
// the preview text wraps to a second line and truncates. Width-sizing multipliers
// (min width, on-canvas ceiling, docked-pose ceiling) are configurable in
// settings.ts under `mediaBranchLineage.marker`.
const BRANCH_MARKER_APPROX_CHAR_WIDTH = 8
// Wrapping kicks in before the naive char-width estimate predicts (real glyphs
// average wider than the width-sizing approximation). Use a larger per-char width
// when deciding line count so a prompt that visually wraps to two lines is sized
// for two lines instead of being crammed into a one-line pill.
const BRANCH_MARKER_LINE_WRAP_CHAR_WIDTH = 10
const BRANCH_MARKER_HORIZONTAL_PADDING = 60
const BRANCH_MARKER_PROMPT_PREVIEW_MAX_CHARS = 120
const BRANCH_MARKER_RESPONSE_PREVIEW_MAX_CHARS = 50
const BRANCH_MARKER_VERTICAL_PADDING = 21
const BRANCH_MARKER_SEPARATOR_HEIGHT = 13
// Rendered pixel line heights are derived from the configurable text sizing in
// settings.ts so the height the layout reserves stays in sync with the CSS that
// actually paints the marker's preview lines.
function getBranchMarkerMessageLineHeight(): number {
    const { messageFontSize, messageLineHeight } = settings.mediaBranchLineage.marker.text
    return Math.ceil(messageFontSize * messageLineHeight)
}
function getBranchMarkerResponseLineHeight(): number {
    const { responseFontSize, responseLineHeight } = settings.mediaBranchLineage.marker.text
    return Math.ceil(responseFontSize * responseLineHeight)
}
// Match the natural single-line height (vertical padding + one message line) so a
// one-line marker isn't inflated relative to a wrapped two-line one — otherwise
// `justify-content: center` pads the single-line case more than the multi-line case.
function getBranchMarkerMinHeight(): number {
    return BRANCH_MARKER_VERTICAL_PADDING + getBranchMarkerMessageLineHeight()
}
function getBranchMarkerStackGap(): number {
    const gap = Number(settings.mediaBranchLineage.pendingMarkerInputGap)
    return Number.isFinite(gap) ? Math.max(0, gap) : 0
}
// Must match the `workspace-branch-marker-spin` animation duration in
// workspace-canvas.scss (0.8s). Used to phase-align recreated spinners to a
// shared rotation clock so the spinner never visibly restarts.
const BRANCH_MARKER_SPINNER_PERIOD_MS = 800
const MEDIA_DESCRIPTOR_ANALYSIS_RETRY_DELAYS_MS = [1000, 3000, 8000] as const
const BRANCH_MARKER_VISIBLE_VIEWPORT_PADDING_SCREEN = 24
const branchMarkerMediaModelCircleGlassCssImageByColor = new Map<string, string>()
const branchMarkerMediaModelCircleTextureCssImageByColor = new Map<string, string>()
function getBranchMarkerMinWidth(): number {
    return Math.round(settings.mediaBranchLineage.branchOrigin.size * settings.mediaBranchLineage.marker.minWidthMultiplier)
}

function getBranchMarkerWidthForText(promptText: string): number {
    const minWidth = getBranchMarkerMinWidth()
    const maxWidth = minWidth * settings.mediaBranchLineage.marker.maxWidthGrowth
    const promptPreview = getBranchMarkerPromptPreview(promptText)
    // Target a single line; longer messages keep growing until they hit the
    // ceiling, then wrap to (and truncate at) two lines.
    const desiredWidth = BRANCH_MARKER_HORIZONTAL_PADDING + promptPreview.length * BRANCH_MARKER_APPROX_CHAR_WIDTH
    return Math.round(Math.max(minWidth, Math.min(maxWidth, desiredWidth)))
}

function getBranchMarkerPromptLineCount(promptText: string, width: number): number {
    const promptPreview = getBranchMarkerPromptPreview(promptText)
    const charsPerLine = Math.max(1, Math.floor((width - BRANCH_MARKER_HORIZONTAL_PADDING) / BRANCH_MARKER_LINE_WRAP_CHAR_WIDTH))
    return promptPreview.length > charsPerLine ? 2 : 1
}

function getBranchMarkerContentDimensions(promptText: string, options: { responseLine?: boolean } = {}): { width: number; height: number } {
    const width = getBranchMarkerWidthForText(promptText)
    const promptLineCount = getBranchMarkerPromptLineCount(promptText, width)
    const responseHeight = options.responseLine
        ? BRANCH_MARKER_SEPARATOR_HEIGHT + getBranchMarkerResponseLineHeight()
        : 0
    return {
        width,
        height: Math.max(
            getBranchMarkerMinHeight(),
            Math.ceil(
                BRANCH_MARKER_VERTICAL_PADDING
                + promptLineCount * getBranchMarkerMessageLineHeight()
                + responseHeight
            )
        ),
    }
}

// Sizing for the docked, above-the-composer pose: always a single line, sized so
// the prompt fits on that line up to a wider ceiling (then truncates). Shorter and
// wider than the on-canvas pill so the marker visibly grows once it lands.
function getBranchMarkerScreenFixedDimensions(promptText: string): { width: number; height: number } {
    const minWidth = getBranchMarkerMinWidth()
    const maxWidth = minWidth * settings.mediaBranchLineage.marker.screenFixedMaxWidthGrowth
    const promptPreview = getBranchMarkerPromptPreview(promptText)
    const desiredWidth = BRANCH_MARKER_HORIZONTAL_PADDING + promptPreview.length * BRANCH_MARKER_APPROX_CHAR_WIDTH
    return {
        width: Math.round(Math.max(minWidth, Math.min(maxWidth, desiredWidth))),
        height: getBranchMarkerMinHeight(),
    }
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
        return getBranchMarkerNodeDimensions(node)
    }
    return undefined
}

function resizeBranchMarkerNodeToDimensions<T extends BranchMarkerNode>(
    node: T,
    dimensions: { width: number; height: number },
): T {
    if (node.dimensions.width === dimensions.width && node.dimensions.height === dimensions.height) return node
    const widthDelta = dimensions.width - node.dimensions.width
    const heightDelta = dimensions.height - node.dimensions.height
    const position = node.type === 'branchOrigin'
        ? {
            x: node.position.x,
            y: node.position.y - heightDelta / 2,
        }
        : {
            x: node.position.x - widthDelta / 2,
            y: node.position.y - heightDelta / 2,
        }
    return {
        ...node,
        position,
        dimensions,
    } as T
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

function getBranchMarkerPromptText(node: BranchMarkerNode): string {
    return (node.provenance?.promptText ?? node.pendingState?.promptText ?? '').trim().replace(/\s+/g, ' ')
}

function getBranchMarkerPromptPreview(promptText: string): string {
    if (!promptText) return ''

    if (promptText.length <= BRANCH_MARKER_PROMPT_PREVIEW_MAX_CHARS) return promptText

    return `${promptText.slice(0, BRANCH_MARKER_PROMPT_PREVIEW_MAX_CHARS)}...`
}

// Streaming reasoning text scrolls past the marker as a tail while receiving.
// Completed markers settle on the start of the response so the lineage marker
// previews the answer's topic instead of its trailing fragment.
function getBranchMarkerResponsePreview(responseText: string, options: { isReceiving?: boolean } = {}): string {
    const normalized = responseText.replace(/\s+/g, ' ').trim()
    if (normalized.length <= BRANCH_MARKER_RESPONSE_PREVIEW_MAX_CHARS) return normalized
    if (options.isReceiving) return `…${normalized.slice(-BRANCH_MARKER_RESPONSE_PREVIEW_MAX_CHARS)}`
    return `${normalized.slice(0, BRANCH_MARKER_RESPONSE_PREVIEW_MAX_CHARS)}...`
}

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
    onDocumentContentChange?: (params: { documentId: string; title?: string; prevRevision?: number; content: any }) => void
    onDocumentTitleChange?: (params: { documentId: string; title: string }) => void
    onAiChatThreadContentChange?: (params: { workspaceId: string; threadId: string; content: any }) => void
}

type WorkspaceCanvasNodeInsertion =
    | Omit<DocumentCanvasNode, 'position'>
    | Omit<ImageCanvasNode, 'position'>
    | Omit<VideoCanvasNode, 'position'>

type PendingGeneratedMediaTracker = {
    nodeId: string
    fileId: string
    sourceNodeId?: string
    placementKey: string
    hasReceivedFrame: boolean
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
    const { paneEl, viewportEl, onViewportChange, onCanvasStateChange, onDocumentContentChange, onDocumentTitleChange, onAiChatThreadContentChange } = options
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
    const initialFeatureExtractionState = pruneUnconfirmedFeatureExtractionRuns(normalizedInitialCanvasState)
    let currentCanvasState: CanvasState | null = initialFeatureExtractionState.state
    let initialUnconfirmedFeatureExtractionRunsPruned = initialFeatureExtractionState.removed
    let currentDocuments: Document[] = options.documents
    let currentAiChatThreads: AiChatThread[] = options.aiChatThreads
    let panZoom: PanZoomInstance | null = null
    let lastTransform: Transform = [0, 0, 1]

    let connectionManager: WorkspaceConnectionManager | null = null
    let pixiMediaLayer: PixiMediaLayer | null = null
    let viewportBridge: ViewportBridge | null = null
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
    let edgesRaf: number | null = null
    let transformSideEffectsRaf: number | null = null
    let pendingHandleZoom: number | null = null
    let selectedNodeIds: Set<string> = new Set()
    let selectedEdgeId: string | null = null
    const expandedGeneratedMediaInfoNodeIds: Set<string> = new Set()
    const expandedBranchOriginInfoNodeIds: Set<string> = new Set()
    const expandedBranchForkInfoNodeIds: Set<string> = new Set()
    const expandedBranchLineInfoNodeIds: Set<string> = new Set()
    const generatedMediaInfoRenderers: Map<string, ReadOnlyAiChatThreadRendererInstance> = new Map()
    const generatedMediaInfoPreviewTiles: Set<ContextPreviewTileInstance> = new Set()
    const activeAiChatPanelTracePreviewTiles: Set<ContextPreviewTileInstance> = new Set()
    const videoControlInstances: Map<string, VideoControlsInstance> = new Map()
    const mediaAnalysisRequestsInFlight: Set<string> = new Set()
    const branchMarkerReasoningTooltips: Map<string, HelpTooltipInstance> = new Map()
    const branchMarkerMediaModelTooltips: Map<string, HelpTooltipInstance[]> = new Map()
    type BranchMarkerStreamPhase = 'preamble' | 'enhancement' | 'done'
    type BranchMarkerConversationPreview = {
        userText: string
        responseText: string
        phase: BranchMarkerStreamPhase
        isReceiving: boolean
        streamIsReceiving: boolean
    }
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
    // In-flight detached canvas message ids for composer receiving state and
    // delayed editor teardown. Generated-media event routing uses normal thread
    // and workspace state.
    const activeCanvasRunIds: Set<string> = new Set()
    const activeCanvasRunServices: Map<string, AiInteractionService> = new Map()
    const activeCanvasRunTeardowns: Set<() => void> = new Set()
    const activeCanvasRunTeardownsByThread: Map<string, () => void> = new Map()
    const activeContextChipTrayEls: Set<HTMLDivElement> = new Set()
    const contextPreviewTilesByTray: Map<HTMLDivElement, Set<ContextPreviewTileInstance>> = new Map()
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

    const canvasMediaNodeLifecycle = createCanvasMediaNodeLifecycleTracker()
    canvasMediaNodeLifecycle.initializeFromCanvasState(currentCanvasState)

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
                commitCanvasState({ ...currentCanvasState, nodes: resolvedTreeState.nodes, edges: resolvedTreeState.edges })
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
                            return { ...n, fileId: data.fileId, src: newSrc, descriptor: buildAnalyzingDescriptor() } as ImageCanvasNode
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
                    if (node.type === 'image') {
                        queueCanvasMediaAnalysis(nodeId, data.fileId)
                    } else if (node.type === 'video') {
                        queueCanvasMediaAnalysis(nodeId, data.posterFileId)
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
                        const response = await mediaLibraryService.addCanvasImage({ workspaceId, fileId: node.fileId, descriptor: (node as ImageCanvasNode).descriptor })
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
                            descriptor: (node as VideoCanvasNode).descriptor,
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
                    const sourceContextSnapshot: ExtractionTabContext = {
                        imageNatsUrl,
                        contextMessages: contextMessage ? [contextMessage] : [],
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
            if (node.type !== 'image' && node.type !== 'video' && node.type !== 'document' && node.type !== 'aiChatThread' && node.type !== 'branchOrigin' && node.type !== 'branchFork' && node.type !== 'branchLine') continue
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
            baseGap: settings.mediaNode.generatedMediaChrome.topGap,
            zoomScaling: getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),
        })
        applyStyle(chromeEl, {
            left: `${chromeLayout.left}px`,
            top: `${chromeLayout.top + extraTopOffsetScreen}px`,
            width: `${chromeLayout.layoutWidth}px`,
            transformOrigin: '0 0',
            transform: `scale(${chromeLayout.screenScale})`,
        })
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
            settings.mediaNode.generatedMediaChrome.topGap,
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
        const panelTop = position.y + dimensions.height + (extraTopOffsetScreen + iconStripScreenGap + iconScreenSize + panelSettings.mediaTopOffset) / zoom
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
            if (node.type !== 'image' && node.type !== 'video') continue
            const position = getNodeWorldPosition(node, nodesById)
            const dimensions = liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            updateGeneratedMediaChromeLiveTransform(node.nodeId, position, dimensions, viewport)
        }
    }

    function getCanvasTraceReferenceImageSources(reference: ImageGenerationTraceReference): string[] {
        if (!currentCanvasState || !reference.nodeId) return []
        const node = currentCanvasState.nodes.find((candidate: CanvasNode) => candidate.nodeId === reference.nodeId)
        if (node?.type === 'image') {
            const imageNode = node as ImageCanvasNode
            return [
                imageNode.src,
                imageNode.workspaceId && imageNode.fileId
                    ? `/api/images/${encodeURIComponent(imageNode.workspaceId)}/${encodeURIComponent(imageNode.fileId)}`
                    : '',
            ]
        }
        if (node?.type === 'video') {
            const videoNode = node as VideoCanvasNode
            return [
                videoNode.frameFileId && videoNode.workspaceId
                    ? `/api/images/${encodeURIComponent(videoNode.workspaceId)}/${encodeURIComponent(videoNode.frameFileId)}`
                    : '',
                videoNode.posterSrc,
                videoNode.workspaceId && videoNode.posterFileId
                    ? `/api/images/${encodeURIComponent(videoNode.workspaceId)}/${encodeURIComponent(videoNode.posterFileId)}`
                    : '',
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
            fileId: node.fileId,
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
    }: MountGeneratedMediaProjectionOptions): ReadOnlyAiChatThreadRendererInstance | null {
        const generatedBy = node.generatedBy
        if (!generatedBy) return null

        const locator = getGeneratedMediaProjectionLocator(node)
        if (!locator) return null

        const projection = buildGeneratedMediaTurnProjectionFromThreadContent(
            getAiChatThreadContentForProjection(generatedBy.aiChatThreadId),
            locator,
            {
                threadId: generatedBy.aiChatThreadId,
                forceGenerationDetailsOpen: true,
                limitToLocatorMedia: limitProjectionToSelectedMedia,
                lineageProjectionScope,
            },
        )
        if (!projection) return null

        appendGeneratedMediaReasoningModelHeader(mount, node)
        const projectionMount = html`<div className="canvas-generated-media-projection"></div>` as HTMLElement
        mount.appendChild(projectionMount)

        return mountReadOnlyAiChatThreadProjection({
            mount: projectionMount,
            content: projection.content,
            threadId: projection.threadId,
            className: rendererClassName,
            contextPreview: getAiUserMessageContextPreviewRenderer(),
            traceDetailsOptions: createCanvasTraceDetailsOptions(traceDetailsClassName, previewTiles),
        })
    }

    // The node's compact descriptor (summary + tags) — shown for all media,
    // including uploads with no generation metadata. Failed analysis still gets
    // a visible row so the info panel never collapses into an empty surface.
    function buildMediaDescriptorSection(descriptor: MediaDescriptor | undefined): HTMLElement | null {
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
    // the node carries generation context it mounts a scoped read-only AI chat
    // ProseMirror projection. Uploaded media without generation context can show
    // the compact descriptor generated by media analysis.
    function createGeneratedMediaInfoPanel(
        node: ImageCanvasNode | VideoCanvasNode,
        options: GeneratedMediaInfoPanelOptions = {}
    ): HTMLElement {
        const generatedBy = node.generatedBy
        const showChatThread = Boolean(generatedBy) && !options.descriptorOnly
        const panelClassName = ['canvas-generated-media-info-panel', options.className, 'nopan'].filter(Boolean).join(' ')
        const panel = html`<div className=${panelClassName}></div>` as HTMLElement

        if (generatedBy && showChatThread) {
            const rendererKey = options.rendererKey ?? `media:${node.nodeId}`
            destroyGeneratedMediaInfoRenderer(rendererKey)
            const renderer = mountGeneratedMediaChatProjection({
                mount: panel,
                node,
                rendererClassName: 'canvas-generated-media-projection-editor',
                traceDetailsClassName: 'canvas-generated-media-trace-details',
                previewTiles: generatedMediaInfoPreviewTiles,
                lineageProjectionScope: options.lineageProjectionScope ?? 'media-run',
                limitProjectionToSelectedMedia: options.limitProjectionToSelectedMedia ?? true,
            })
            if (renderer) generatedMediaInfoRenderers.set(rendererKey, renderer)
        }

        if (!showChatThread && options.includeDescriptor !== false) {
            const descriptorSection = buildMediaDescriptorSection(node.descriptor)
            if (descriptorSection) panel.appendChild(descriptorSection)
        }

        return panel
    }

    function toggleGeneratedMediaInfo(nodeId: string): void {
        if (expandedGeneratedMediaInfoNodeIds.has(nodeId)) {
            expandedGeneratedMediaInfoNodeIds.delete(nodeId)
        } else {
            expandedGeneratedMediaInfoNodeIds.add(nodeId)
        }
        syncGeneratedMediaChrome(currentCanvasState)
    }

    function hasOpenGeneratedMediaInfoPanels(): boolean {
        return expandedGeneratedMediaInfoNodeIds.size > 0
            || expandedBranchOriginInfoNodeIds.size > 0
            || expandedBranchForkInfoNodeIds.size > 0
            || expandedBranchLineInfoNodeIds.size > 0
    }

    function clearGeneratedMediaInfoPanels(options: { preserveBranchInfo?: boolean } = {}): void {
        if (!hasOpenGeneratedMediaInfoPanels()) return
        expandedGeneratedMediaInfoNodeIds.clear()
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
            if (node?.generatedBy?.aiChatThreadId === threadId) {
                return { node, lineageProjectionScope: 'branch-origin', limitProjectionToSelectedMedia: false }
            }
        }

        for (const branchForkNodeId of expandedBranchForkInfoNodeIds) {
            const node = getBranchForkGeneratedMediaNodes(branchForkNodeId)[0]
            if (node?.generatedBy?.aiChatThreadId === threadId) {
                return { node, lineageProjectionScope: 'branch-fork', limitProjectionToSelectedMedia: false }
            }
        }

        for (const branchLineNodeId of expandedBranchLineInfoNodeIds) {
            const node = getBranchLineGeneratedMediaNodes(branchLineNodeId)[0]
            if (node?.generatedBy?.aiChatThreadId === threadId) {
                return { node, lineageProjectionScope: 'media-run', limitProjectionToSelectedMedia: true }
            }
        }

        return null
    }

    function getSelectedGeneratedMediaProjectionTarget(threadId: string): GeneratedMediaProjectionTarget | null {
        const nodesById = getCanvasNodesById(currentCanvasState?.nodes ?? [])
        for (const nodeId of selectedNodeIds) {
            const node = nodesById.get(nodeId)
            if (!node || (node.type !== 'image' && node.type !== 'video')) continue
            if (node.generatedBy?.aiChatThreadId !== threadId) continue
            return { node, lineageProjectionScope: 'media-run', limitProjectionToSelectedMedia: true }
        }
        return null
    }

    function getDefaultGeneratedMediaProjectionTarget(threadId: string): GeneratedMediaProjectionTarget | null {
        const node = (currentCanvasState?.nodes ?? [])
            .filter((candidate: CanvasNode): candidate is ImageCanvasNode | VideoCanvasNode =>
                (candidate.type === 'image' || candidate.type === 'video')
                && candidate.generatedBy?.aiChatThreadId === threadId)
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
        return node.aiChatThreadId
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
        if (!generatedMediaNode) return null
        return createGeneratedMediaInfoPanel(generatedMediaNode, {
            className: 'canvas-branch-origin-info-panel',
            includeDescriptor: false,
            rendererKey: `branch-origin:${branchOriginNode.nodeId}`,
            limitProjectionToSelectedMedia: false,
            lineageProjectionScope: 'branch-origin',
        })
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
        if (!generatedMediaNode) return null
        return createGeneratedMediaInfoPanel(generatedMediaNode, {
            className: 'canvas-branch-fork-info-panel',
            includeDescriptor: false,
            rendererKey: `branch-fork:${branchForkNode.nodeId}`,
            limitProjectionToSelectedMedia: false,
            lineageProjectionScope: 'branch-fork',
        })
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
        if (!generatedMediaNode) return null
        return createGeneratedMediaInfoPanel(generatedMediaNode, {
            className: 'canvas-branch-line-info-panel',
            includeDescriptor: false,
            rendererKey: `branch-line:${branchLineNode.nodeId}`,
            limitProjectionToSelectedMedia: true,
            lineageProjectionScope: 'media-run',
        })
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
        const analyzing = node.descriptor?.status === 'analyzing'
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
                <span innerHTML=${infoCircleFilledIcon}></span>
            </button>
        ` as HTMLButtonElement
        button.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            toggleGeneratedMediaInfo(node.nodeId)
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

    // Model badge (colored brand icon + title) + info button only. This screen-space
    // strip is projected from media node bounds and uses bounded zoom compensation.
    // The expandable info panel renders separately in the viewport-transformed panel layer.
    function createGeneratedMediaChrome(node: ImageCanvasNode | VideoCanvasNode): HTMLElement {
        const modelId = getGeneratedMediaModelId(node)
        const modelProvider = getGeneratedMediaModelProvider(node, modelId)
        const modelBadge = createMediaModelBadge({ modelId, modelProvider })
        const chromeEl = html`
            <div className="workspace-generated-media-chrome" data=${{ mediaChromeNodeId: node.nodeId }}>
                <div className="workspace-generated-media-actions">
                    ${modelBadge}
                    ${createMediaInfoButton(node)}
                </div>
            </div>
        ` as HTMLElement

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
        const panel = createGeneratedMediaInfoPanel(node, { descriptorOnly: true })
        panel.setAttribute('data-media-info-panel-node-id', node.nodeId)
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
        generatedMediaInfoRenderers.get(rendererKey)?.destroy()
        generatedMediaInfoRenderers.delete(rendererKey)
    }

    function destroyGeneratedMediaInfoRenderers(): void {
        for (const renderer of generatedMediaInfoRenderers.values()) {
            renderer.destroy()
        }
        generatedMediaInfoRenderers.clear()
        for (const tile of generatedMediaInfoPreviewTiles) {
            tile.destroy()
        }
        generatedMediaInfoPreviewTiles.clear()
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
                && Boolean((node as ImageCanvasNode | VideoCanvasNode).generatedBy || (node as ImageCanvasNode | VideoCanvasNode).descriptor))
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

        destroyGeneratedMediaInfoRenderers()
        destroyVideoControlInstances()

        // Completed video nodes (those with a stored MP4 src) get the visible
        // video surface plus the external shared SVG control bar in the chrome layer.
        const playableVideoNodes = canvasNodes
            .filter((node: CanvasNode): node is VideoCanvasNode => node.type === 'video' && Boolean((node as VideoCanvasNode).src))
        const videoChromeEls = playableVideoNodes
            .map(createVideoControlsChrome)
            .filter((el): el is HTMLElement => Boolean(el))

        // Drop expanded state for nodes that no longer show info chrome, so a
        // deleted node doesn't leak an orphaned open panel.
        const infoNodeIds = new Set<string>(mediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => node.nodeId))
        for (const expandedNodeId of Array.from(expandedGeneratedMediaInfoNodeIds)) {
            if (!infoNodeIds.has(expandedNodeId)) expandedGeneratedMediaInfoNodeIds.delete(expandedNodeId)
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
            generatedMediaInfoPanelLayerEl.replaceChildren(
                ...expandedMediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => createGeneratedMediaInfoPanelChrome(node)),
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
            generatingIds.set(partial.nodeId, {
                direction: 'clockwise',
                shape: partial.hasReceivedFrame ? 'node' : 'preFrameCircle',
            })
        }
        for (const pending of videoGenerationTracker.values()) {
            generatingIds.set(pending.nodeId, {
                direction: 'clockwise',
                shape: pending.hasReceivedFrame ? 'node' : 'preFrameCircle',
            })
        }
        for (const referenceNodeIds of generatingReferenceNodeIdsByThread.values()) {
            for (const nodeId of referenceNodeIds) {
                if (!generatingIds.has(nodeId)) generatingIds.set(nodeId, { direction: 'counterclockwise' })
            }
        }
        pixiMediaLayer?.setGeneratingImageNodes(generatingIds)
    }

    function getPendingGeneratedMediaBeforeFirstFrameNodeIds(): Set<string> {
        const nodeIds = new Set<string>()
        for (const pending of partialImageTracker.values()) {
            if (!pending.hasReceivedFrame) nodeIds.add(pending.nodeId)
        }
        for (const pending of videoGenerationTracker.values()) {
            if (!pending.hasReceivedFrame) nodeIds.add(pending.nodeId)
        }
        return nodeIds
    }

    function isPendingGeneratedMediaBeforeFirstFrame(nodeId: string): boolean {
        for (const pending of partialImageTracker.values()) {
            if (pending.nodeId === nodeId) return !pending.hasReceivedFrame
        }
        for (const pending of videoGenerationTracker.values()) {
            if (pending.nodeId === nodeId) return !pending.hasReceivedFrame
        }
        return false
    }

    function updatePendingGeneratedMediaBeforeFrameClass(nodeEl: HTMLElement, nodeId: string): void {
        nodeEl.classList.toggle('is-pending-generated-media-before-frame', isPendingGeneratedMediaBeforeFirstFrame(nodeId))
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

    function getGeneratedMediaInsertionSize(): number {
        return settings.mediaBranchLineage.generatedMediaSize
    }

    function getInsertionPaneSize(): { width: number; height: number } {
        const rect = paneRect ?? paneEl.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
    }

    function getCenteredInsertionPosition(dimensions: { width: number; height: number }): { x: number; y: number } {
        return computeViewportCenterInsertionPosition(dimensions, getLiveViewport(), getInsertionPaneSize())
    }

    function clampBranchOriginPositionToVisibleViewport(
        position: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): { x: number; y: number } {
        const viewport = getLiveViewport()
        const paneSize = getInsertionPaneSize()
        const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
        const padding = BRANCH_MARKER_VISIBLE_VIEWPORT_PADDING_SCREEN / zoom
        const minX = (0 - viewport.x) / zoom + padding
        const maxX = (paneSize.width - viewport.x) / zoom - dimensions.width - padding
        const minY = (0 - viewport.y) / zoom + padding
        const maxY = (paneSize.height - viewport.y) / zoom - dimensions.height - padding

        return {
            x: clampInsideRange(position.x, minX, maxX),
            y: clampInsideRange(position.y, minY, maxY),
        }
    }

    function getCenteredFreshBranchOriginPosition(
        dimensions: { width: number; height: number },
        mediaHeight: number,
    ): { x: number; y: number } {
        const mediaWidth = getGeneratedMediaInsertionSize()
        const groupDimensions = {
            width: dimensions.width + getBranchOriginOutputGap() + mediaWidth,
            height: Math.max(dimensions.height, mediaHeight),
        }
        const groupPosition = getCenteredInsertionPosition(groupDimensions)
        return clampBranchOriginPositionToVisibleViewport({
            x: groupPosition.x,
            y: groupPosition.y + (groupDimensions.height - dimensions.height) / 2,
        }, dimensions)
    }

    function getCenteredFreshRootBranchMarkerPosition(
        dimensions: { width: number; height: number },
        mediaHeight: number,
    ): { x: number; y: number } {
        const mediaWidth = getGeneratedMediaInsertionSize()
        const groupDimensions = {
            width: dimensions.width + getRootBranchMarkerOutputGap() + mediaWidth,
            height: Math.max(dimensions.height, mediaHeight),
        }
        const groupPosition = getCenteredInsertionPosition(groupDimensions)
        return clampBranchOriginPositionToVisibleViewport({
            x: groupPosition.x,
            y: groupPosition.y + (groupDimensions.height - dimensions.height) / 2,
        }, dimensions)
    }

    function getResolvedNodePositionFromCollisionBox(node: CanvasNode, box: { x: number; y: number }, entries: Map<string, CollisionEntry>): { x: number; y: number } {
        const entry = entries.get(node.nodeId)
        if (!entry) return box
        return {
            x: box.x + entry.offset.x,
            y: box.y + entry.offset.y,
        }
    }

    function getGeneratedMediaChromeCollisionHeight(node: CanvasNode): number {
        if (!isGeneratedMediaNode(node) || isPendingGeneratedMediaBeforeFirstFrame(node.nodeId)) return 0
        const generatedMediaChromeHeight = settings.mediaNode.generatedMediaChrome.topGap
            + settings.mediaNode.generatedMediaChrome.iconSize
        if (node.type !== 'video') return generatedMediaChromeHeight
        return VIDEO_CONTROLS_BOTTOM_INSET + VIDEO_CONTROLS_HEIGHT + generatedMediaChromeHeight
    }

    function getCanvasNodeCollisionRect(
        node: CanvasNode,
        worldPosition: { x: number; y: number },
    ): Rect {
        const dimensions = isBranchMarkerNode(node)
            ? liveNodeOverrides.get(node.nodeId)?.dimensions ?? node.dimensions
            : node.dimensions
        return {
            x: worldPosition.x,
            y: worldPosition.y,
            width: dimensions.width,
            height: dimensions.height + getGeneratedMediaChromeCollisionHeight(node),
        }
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
                return collisionSettings.nodeTypes.branchOrigin
            case 'branchFork':
                return collisionSettings.nodeTypes.branchFork
            case 'branchLine':
                return collisionSettings.nodeTypes.branchLine
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
            depthGap: settings.mediaBranchLineage.mediaToMediaGap,
            branchOriginDepthGap: getBranchOriginOutputGap(),
            rootMarkerDepthGap: getRootBranchMarkerOutputGap(),
            siblingGap: settings.mediaBranchLineage.branchRowGap,
            branchFanoutExtraGap: settings.mediaBranchLineage.branchFanoutExtraGap,
            branchOriginMarkerStackGap: getBranchMarkerStackGap(),
            collisionIterations: getWorkspaceCollisionFlowIterations(collisionSettings),
            collisionMargin: 0,
            getPendingGeneratedMediaLayoutGeometry: (node: ImageCanvasNode | VideoCanvasNode) =>
                getPendingGeneratedMediaBeforeFrameCircleGeometry(node.nodeId, node.position, node.dimensions),
            getPendingGeneratedMediaCircleInset: getPendingGeneratedMediaBeforeFrameCircleInset,
            getNodeWorldPosition,
            getNodeWorldRect,
            getNodeCollisionRect: getCanvasNodeCollisionRect,
            getNodeCollisionMargin: (node: CanvasNode) => getCanvasNodeCollisionSettings(node, collisionSettings).margin,
            getNodeCollisionOverlapThreshold: (node: CanvasNode) =>
                getCanvasNodeCollisionSettings(node, collisionSettings).overlapThreshold,
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

    function getPendingGeneratedMediaBeforeFrameInsertionPosition(
        nodeId: string,
        finalPosition: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): { x: number; y: number } {
        if (!isPendingGeneratedMediaBeforeFirstFrame(nodeId)) return finalPosition
        const inset = getPendingGeneratedMediaBeforeFrameCircleInset(dimensions)
        return {
            x: finalPosition.x - inset.x,
            y: finalPosition.y,
        }
    }

    function getFullFramePositionFromPendingGeneratedMediaPosition(
        pendingPosition: { x: number; y: number },
        dimensions: { width: number; height: number },
    ): { x: number; y: number } {
        const inset = getPendingGeneratedMediaBeforeFrameCircleInset(dimensions)
        return {
            x: pendingPosition.x + inset.x,
            y: pendingPosition.y,
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
        const referencePosition = getReferenceGroupGeneratedMediaPosition(threadId, mediaHeight, generationRun)
        const basePosition = referencePosition
            ? {
                x: referencePosition.x - getRootBranchMarkerOutputGap() - markerDimensions.width,
                y: referencePosition.y + (mediaHeight - markerDimensions.height) / 2,
            }
            : getCenteredFreshRootBranchMarkerPosition(markerDimensions, mediaHeight)

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
        const futureCircleLeft = futureMediaPosition.x
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
            && Boolean(node.generatedBy?.aiChatThreadId)
        )?.generatedBy?.aiChatThreadId
        if (selectedGeneratedMediaThreadId) {
            refreshActiveAiChatPanelProjectionTarget(selectedGeneratedMediaThreadId)
        } else if (activeAiChatPanelProjectionRenderer) {
            refreshActiveAiChatPanelProjectionTarget(activeAiChatPanelThreadId ?? undefined)
        }
        // Selecting canvas nodes force-includes them as explicit composer previews.
        // Only newly-selected ids are added so a removed preview whose node stays
        // selected isn't immediately re-added.
        if (currentCanvasState) {
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
        const { lastActiveAiChatThreadId: _removedLastActiveThreadId, ...nextCanvasStateWithoutLastActiveThread } = nextCanvasState
        const persistedState = {
            ...nextCanvasStateWithoutLastActiveThread,
            ...(activeAiChatThreadId ? { lastActiveAiChatThreadId: activeAiChatThreadId } : {}),
        }
        if (JSON.stringify(currentCanvasState.aiChatPanel) === JSON.stringify(persistedState.aiChatPanel)
            && JSON.stringify(currentCanvasState.aiChatSidebarTabs ?? []) === JSON.stringify(persistedState.aiChatSidebarTabs ?? [])
            && currentCanvasState.activeAiChatSidebarTabId === persistedState.activeAiChatSidebarTabId
            && currentCanvasState.lastActiveAiChatThreadId === persistedState.lastActiveAiChatThreadId) return

        commitCanvasMetadataState(persistedState)
    }

    function getContextPreviewEnvironment(): ContextPreviewEnvironment {
        return {
            getDocuments: () => currentDocuments,
            getThreads: () => currentAiChatThreads,
            getApiBaseUrl: () => import.meta.env.VITE_API_URL || '',
            getAuthToken: () => AuthService.getTokenSilently(),
        }
    }

    function getAiUserMessageContextPreviewRenderer() {
        return {
            getNodeById: (nodeId: string) => findCanvasNodeById(nodeId),
            environment: getContextPreviewEnvironment(),
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

    function isUnconfirmedFeatureExtractionState(extractionState: CanvasFeatureExtractionState | undefined): boolean {
        return Boolean(
            extractionState
            && extractionState.status === 'pending'
            && !extractionState.aiProvider
            && !extractionState.featureCard
            && !extractionState.error
            && (!extractionState.traceEvents || extractionState.traceEvents.length === 0)
        )
    }

    function getConfirmedFeatureExtractionEntries(canvasState: CanvasState): Array<[string, CanvasFeatureExtractionState]> {
        return Object.entries(canvasState.featureExtractionRuns ?? {})
            .filter(([, run]) => !isUnconfirmedFeatureExtractionState(run))
    }

    function pruneUnconfirmedFeatureExtractionRuns(canvasState: CanvasState | null): {
        state: CanvasState | null
        removed: boolean
    } {
        if (!canvasState?.featureExtractionRuns) return { state: canvasState, removed: false }
        const entries = getConfirmedFeatureExtractionEntries(canvasState)
        if (entries.length === Object.keys(canvasState.featureExtractionRuns).length) {
            return { state: canvasState, removed: false }
        }
        return {
            state: {
                ...canvasState,
                featureExtractionRuns: Object.fromEntries(entries),
            },
            removed: true,
        }
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

        const subject = `${NATS_SUBJECTS.AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE_RESPONSE}.${workspaceId}.${extractionRunId}`
        const errorSubject = `ai.interaction.chat.error.${workspaceId}:${extractionRunId}`
        if ((nats.getSubscriptions?.([subject, errorSubject])?.length ?? 0) > 0) return
        subscribedFeatureExtractionRunSubjects.set(extractionRunId, { subject, errorSubject })

        let currentReasoningStage = 'router'
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

        nats.subscribe(subject, (data: any) => {
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
        })

        nats.subscribe(errorSubject, (data: any) => {
            saveUpdatedState((state) => ({
                ...state,
                status: 'failed',
                error: String(data?.error ?? data?.message ?? 'Unknown extraction error'),
                updatedAt: Date.now(),
            }), true)
        })
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
        // Seed chips from whatever is selected when the panel opens, mirroring the
        // old follow-selection behavior — now as persistent, removable chips.
        addContextChips(selectedNodeIds)
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
        const aiChatThreadService = servicesStore.getData('aiChatThreadService')
        if (!aiChatThreadService) return
        const deleted = await aiChatThreadService.deleteAiChatThread({ workspaceId, threadId })
        if (!deleted) return
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
        const showingGeneratedMediaProjection = Boolean(projectionTarget)
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
            if (!activeAiChatPanelProjectionRenderer) {
                projectionContainer.classList.add('workspace-ai-chat-panel-body-pane-hidden')
                editorContainer.classList.remove('workspace-ai-chat-panel-body-pane-hidden')
            }
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
                isDisabled: true,
                documentType: 'aiChatThread',
                threadId: panelThreadId,
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
                // override and refresh so the marker's response preview tracks the
                // sliced tail token-by-token instead of only updating once finished.
                onStreamingUpdate: (value: any) => {
                    liveAiChatThreadContentOverrides.set(panelThreadId, value)
                    refreshBranchMarkersForAiChatThread(panelThreadId)
                    refreshGeneratedMediaProjectionsForAiChatThread(panelThreadId)
                },
                onProjectTitleChange: () => {},
                onAiChatSubmit: async ({
                    messages,
                    aiModel,
                    aiModels,
                    useMultipleModels,
                    useMultipleReasoningModels,
                    useMultipleImageModels,
                    useMultipleVideoModels,
                    imageOptions,
                    videoOptions,
                    referencedFeatureIds
                }: any) => {
                    gradient?.triggerAnimation()

                    try {
                        const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                        // Explicit context chips are always force-included. The thread has
                        // no canvas node, so all context comes from the chips.
                        const chipNodeIds = aiChatPanelState.contextChips.slice()
                        const chipContext = chipNodeIds.length
                            ? await aiChatThreadService.extractSelectedContext({ nodeIds: chipNodeIds, includeUpstream: false })
                            : []
                        const seenContextNodeIds = new Set<string>()
                        const context = [...chipContext].filter((item) => {
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
                        const imagePlacement = rememberStandaloneGeneratedImagePlacement(panelThreadId, messages, hasMediaModel)
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
                            useMultipleModels,
                            useMultipleReasoningModels,
                            useMultipleImageModels,
                            useMultipleVideoModels,
                            aiImageModel: imageOptions?.aiImageModel,
                            aiImageModels: imageOptions?.aiImageModels,
                            imageSize: imageOptions?.imageGenerationSize,
                            imageConfigGroups: imageOptions?.configGroups,
                            aiVideoModel: videoOptions?.aiVideoModel,
                            aiVideoModels: videoOptions?.aiVideoModels,
                            videoAspectRatio: videoOptions?.videoAspectRatio,
                            videoResolution: videoOptions?.videoResolution,
                            videoDuration: videoOptions?.videoDuration,
                            videoConfigGroups: videoOptions?.configGroups,
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
                    if (threadId !== panelThreadId) return
                    if (receiving) {
                        projectionContainer.classList.add('workspace-ai-chat-panel-body-pane-hidden')
                        editorContainer.classList.remove('workspace-ai-chat-panel-body-pane-hidden')
                        return
                    }
                    requestAnimationFrame(() => refreshActiveAiChatPanelProjectionTarget(threadId))
                }
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
            onStop: () => {
                for (const aiService of activeCanvasRunServices.values()) {
                    void aiService.stopChatMessage()
                }
            },
            isReceiving: () => activeCanvasRunIds.size > 0,
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

    function createDetachedCanvasThreadEditor({
        thread,
        submittedData,
        explicitContextNodeIds,
    }: {
        thread: AiChatThread
        submittedData: AiPromptComposerSubmitData
        explicitContextNodeIds: string[]
    }): AiChatThreadEditorEntry {
        const threadId = thread.threadId
        const host = ensureDetachedAiChatThreadHostElement()
        const containerEl = html`
            <div className="workspace-detached-ai-chat-thread-instance"></div>
        ` as HTMLDivElement
        host.appendChild(containerEl)

        const aiService = new AiInteractionService({ workspaceId, aiChatThreadId: threadId })
        activeCanvasRunServices.set(threadId, aiService)

        const editor = new ProseMirrorEditor({
            editorMountElement: containerEl,
            content: html`<div></div>` as HTMLDivElement,
            initialVal: thread.content,
            isDisabled: false,
            documentType: 'aiChatThread',
            threadId,
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
            // override and refresh so the marker's response preview tracks the
            // sliced tail token-by-token instead of only updating once finished.
            onStreamingUpdate: (value: any) => {
                liveAiChatThreadContentOverrides.set(threadId, value)
                refreshBranchMarkersForAiChatThread(threadId)
                refreshGeneratedMediaProjectionsForAiChatThread(threadId)
            },
            onProjectTitleChange: () => {},
            onAiChatSubmit: async ({
                messages,
                aiModel,
                aiModels,
                useMultipleModels,
                useMultipleReasoningModels,
                useMultipleImageModels,
                useMultipleVideoModels,
                imageOptions,
                videoOptions,
                referencedFeatureIds
            }: any) => {
                try {
                    const currentDoc = editor.editorView?.state?.doc
                    if (currentDoc?.toJSON) {
                        onAiChatThreadContentChange?.({ workspaceId, threadId, content: currentDoc.toJSON() })
                        refreshBranchMarkersForAiChatThread(threadId)
                    }

                    const nodes = currentCanvasState?.nodes ?? []
                    const promptText = getPromptTextFromMessages(messages)
                    const explicitMediaReferenceNodeIds = getExistingMediaNodeIds(explicitContextNodeIds)
                    const hasMediaModel = Boolean(
                        imageOptions?.aiImageModel
                        || imageOptions?.aiImageModels?.length
                        || videoOptions?.aiVideoModel
                        || videoOptions?.aiVideoModels?.length
                    )

                    const imageBranchCandidateSnapshot = hasMediaModel
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
                            threadId,
                            prompt: promptText,
                            nodes,
                            edges: currentCanvasState.edges,
                            contextChipNodeIds: explicitContextNodeIds,
                            titlesByNodeId: buildWorkspaceContextTitlesByNodeId(nodes),
                        })
                        : undefined

                    if (imageBranchCandidateSnapshot) {
                        const candidateNodeIds = explicitMediaReferenceNodeIds.length > 0
                            ? explicitMediaReferenceNodeIds
                            : imageBranchCandidateSnapshot.candidates.map((candidate) => candidate.nodeId)
                        pendingGeneratedImagePlacements.set(threadId, {
                            referenceNodeIds: candidateNodeIds,
                            promptText,
                            imageBranchCandidateSnapshot,
                            createdAt: Date.now(),
                        })
                        setGeneratingReferenceNodeIds(threadId, candidateNodeIds)
                        insertPendingBranchMarkerForCanvasRun(threadId, promptText, submittedData)
                    }

                    const aiChatThreadService = servicesStore.getData('aiChatThreadService')
                    const chipContext = explicitContextNodeIds.length && aiChatThreadService
                        ? await aiChatThreadService.extractSelectedContext({ nodeIds: explicitContextNodeIds, includeUpstream: false })
                        : []
                    const contextMessage = aiChatThreadService?.buildContextMessage(chipContext)
                    const messagesWithContext = contextMessage ? [contextMessage, ...messages] : messages

                    let videoSourceForExtension: string | undefined
                    if (videoOptions?.sourceVideoNodeId) {
                        const sourceVideoNode = currentCanvasState?.nodes.find(
                            (node: CanvasNode) => node.nodeId === videoOptions.sourceVideoNodeId && node.type === 'video'
                        ) as VideoCanvasNode | undefined
                        if (sourceVideoNode?.fileId) {
                            videoSourceForExtension = `nats-obj://workspace-${workspaceId}-files/${sourceVideoNode.fileId}`
                        }
                    }

                    await aiService.sendChatMessage({
                        messages: messagesWithContext,
                        aiModel,
                        aiModels,
                        useMultipleModels,
                        useMultipleReasoningModels,
                        useMultipleImageModels,
                        useMultipleVideoModels,
                        aiImageModel: imageOptions?.aiImageModel,
                        aiImageModels: imageOptions?.aiImageModels,
                        imageSize: imageOptions?.imageGenerationSize,
                        imageConfigGroups: imageOptions?.configGroups,
                        aiVideoModel: videoOptions?.aiVideoModel,
                        aiVideoModels: videoOptions?.aiVideoModels,
                        videoAspectRatio: videoOptions?.videoAspectRatio,
                        videoResolution: videoOptions?.videoResolution,
                        videoDuration: videoOptions?.videoDuration,
                        videoConfigGroups: videoOptions?.configGroups,
                        videoSourceForExtension,
                        referencedFeatureIds,
                        imageBranchCandidateSnapshot,
                        workspaceContextSnapshot,
                    })
                    clearExplicitContextChips()
                } catch (error) {
                    console.error('[CANVAS-RUN] failed to send detached canvas generation request', error)
                    teardownDetachedCanvasRun(threadId)
                    throw error
                }
            },
            onAiChatStop: () => {
                aiService.stopChatMessage()
            },
            onPromptSubmit: () => {},
            onPromptStop: () => {},
            isPromptReceiving: () => promptInputController.isReceiving(threadId),
            promptControlFactories: getPromptControlFactories(),
            onReceivingStateChange: (receivingThreadId: string, receiving: boolean) => {
                promptInputController.setReceiving(receivingThreadId, receiving)
                if (!receiving && !pendingGeneratedImagePlacements.has(receivingThreadId)) {
                    scheduleDetachedCanvasRunTeardown(receivingThreadId)
                }
            },
        })

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

    // Runs a detached, canvas-wide generation as a standalone ProseMirror-backed
    // message instance. The editor is hidden because the canvas marker is the
    // visible projection, but storage/stream parsing/persistence stays on the same
    // aiChatThreadPlugin path as the panel.
    async function submitCanvasGenerationRun(data: AiPromptComposerSubmitData): Promise<void> {
        if (!data.aiModel) {
            alert('Please select an AI model from the dropdown before submitting.')
            return
        }
        const promptText = extractPromptTextFromContentJSON(data.contentJSON)
        if (!promptText) return

        const aiChatThreadService = servicesStore.getData('aiChatThreadService')
        if (!aiChatThreadService) return

        const threadId = `canvas-${uuidv4()}`
        const explicitContextNodeIds = aiChatPanelState.contextChips.slice()
        const initialContent = {
            type: 'doc',
            content: [
                { type: 'documentTitle', content: [{ type: 'text', text: 'Canvas message' }] },
                { type: 'aiChatThread', attrs: { threadId }, content: [] },
            ],
        }
        const thread = await aiChatThreadService.createAiChatThread({
            workspaceId,
            threadId,
            content: initialContent,
            aiModel: data.aiModel,
            title: promptText,
            owner: { type: 'standalone' },
        })
        if (!thread) return

        try {
            currentAiChatThreads = currentAiChatThreads.some((existing) => existing.threadId === threadId)
                ? currentAiChatThreads.map((existing) => existing.threadId === threadId ? thread : existing)
                : [...currentAiChatThreads, thread]
            activeCanvasRunIds.add(threadId)
            const teardown = () => teardownDetachedCanvasRun(threadId)
            activeCanvasRunTeardowns.add(teardown)
            activeCanvasRunTeardownsByThread.set(threadId, teardown)
            createDetachedCanvasThreadEditor({
                thread,
                submittedData: data,
                explicitContextNodeIds,
            })
            promptInputController.setTarget({
                nodeId: `standalone:${threadId}`,
                type: 'aiChatThread',
                referenceId: threadId,
            })
            await promptInputController.submitMessage({
                contentJSON: data.contentJSON,
                aiModel: data.aiModel,
                aiModels: data.aiModels,
                useMultipleModels: data.useMultipleModels,
                useMultipleReasoningModels: data.useMultipleReasoningModels,
                useMultipleImageModels: data.useMultipleImageModels,
                useMultipleVideoModels: data.useMultipleVideoModels,
                imageOptions: data.imageOptions,
                videoOptions: data.videoOptions,
                referenceNodeIds: explicitContextNodeIds,
            })
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
        imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot
        imageBranchResolution?: ImageBranchVlmResolution
        activeRunKeys?: Set<string>
        createdAt: number
    }

    const pendingGeneratedImagePlacements = new Map<string, PendingGeneratedImagePlacement>()
    const pendingBranchMarkers = new Map<string, PendingBranchMarkerRecord>()

    function getGeneratedMediaPlacementKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.generationRequestId
            ? `${threadId}:${generationRun.generationRequestId}`
            : threadId
    }

    function getGeneratedMediaRunKey(threadId: string, generationRun?: MediaGenerationRunMeta): string {
        return generationRun?.mediaRunId ?? generationRun?.reasoningRunId ?? threadId
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
            ? uniqueAiModelIds(data.aiModels)
            : uniqueAiModelIds([data.aiModel])
        const imageModelIds = data.useMultipleImageModels
            ? uniqueAiModelIds(data.imageOptions?.aiImageModels ?? [])
            : uniqueAiModelIds([data.imageOptions?.aiImageModel])
        const videoModelIds = data.useMultipleVideoModels
            ? uniqueAiModelIds(data.videoOptions?.aiVideoModels ?? [])
            : uniqueAiModelIds([data.videoOptions?.aiVideoModel])
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
    ): { position: { x: number; y: number } } {
        const paneBounds = paneRect ?? paneEl.getBoundingClientRect()
        // Anchor to the input row itself, not the composer host: the host grows
        // upward as context items are added above the input, and we don't want
        // those items to push the marker. The marker stays pinned just above the
        // input and overlaps the context tray instead.
        const composerBounds = (globalCanvasComposer?.element ?? globalCanvasComposerHostEl)?.getBoundingClientRect()
        const gap = settings.mediaBranchLineage.pendingMarkerInputGap
        if (!composerBounds) {
            const screenRight = paneBounds.width / 2 + dimensions.width / 2
            const screenBottom = paneBounds.height - 24 - gap - stackOffsetY
            return {
                position: {
                    x: screenRight - dimensions.width,
                    y: screenBottom - dimensions.height,
                },
            }
        }

        const screenRight = composerBounds.right - paneBounds.left
        const screenBottom = composerBounds.top - paneBounds.top - gap - stackOffsetY
        return {
            position: {
                x: screenRight - dimensions.width,
                y: screenBottom - dimensions.height,
            },
        }
    }

    function applyPendingBranchMarkerScreenProjection(
        nodeId: string,
        dimensions: { width: number; height: number },
        stackOffsetY = 0,
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
        let dockedWidth = Math.max(getBranchMarkerMinWidth(), nodeEl.scrollWidth || dimensions.width)
        if (composerBounds && composerBounds.width > 0) {
            // Preflight markers are screen-space UI, not canvas chrome. Keep the
            // width cap independent from zoom; zoom only matters after promotion.
            const screenFixedMaxScreenWidth = composerBounds.width * settings.mediaBranchLineage.marker.screenFixedMaxWidthFraction
            dockedWidth = Math.min(dockedWidth, screenFixedMaxScreenWidth)
        }
        dockedWidth = Math.round(dockedWidth)

        const dockedDimensions = { width: dockedWidth, height: dimensions.height }
        const projection = getPendingBranchMarkerScreenProjection(dockedDimensions, stackOffsetY)
        applyStyle(nodeEl, {
            left: `${projection.position.x}px`,
            top: `${projection.position.y}px`,
            width: `${dockedWidth}px`,
            height: `${dimensions.height}px`,
            transform: 'none',
            // Overlap the composer's context tray (host z-index 9990) so added
            // context items render behind the marker instead of shifting it.
            zIndex: '9991',
        })
    }

    function syncPendingBranchMarkerScreenPlacements(): void {
        if (!currentCanvasState) return
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
        let stackOffsetY = 0
        const stackGap = getBranchMarkerStackGap()
        for (const node of pendingNodes) {
            // The docked pose is laid out at its own compact, single-line size — not
            // the (taller, possibly wrapped) on-canvas dimensions the node carries.
            const dimensions = getBranchMarkerScreenFixedDimensions(getBranchMarkerPromptText(node))
            applyPendingBranchMarkerScreenProjection(node.nodeId, dimensions, stackOffsetY)
            stackOffsetY += dimensions.height + stackGap
        }
    }

    function insertPendingBranchMarkerForCanvasRun(
        placementKey: string,
        promptText: string,
        data: AiPromptComposerSubmitData,
    ): void {
        if (!currentCanvasState || hasPendingBranchMarkerForPlacement(placementKey)) return

        const pendingStates = getPendingBranchMarkerModelStates(data, promptText)
        const pendingNodes: BranchLineCanvasNode[] = []
        let stackOffsetY = 0
        const stackGap = getBranchMarkerStackGap()
        pendingStates.forEach((pendingState, index) => {
            const dimensions = getBranchMarkerContentDimensions(promptText)
            // The node carries on-canvas dimensions, but its initial docked pose is
            // projected from the compact single-line screen-fixed size.
            const screenFixedDimensions = getBranchMarkerScreenFixedDimensions(promptText)
            const projection = getPendingBranchMarkerScreenProjection(screenFixedDimensions, stackOffsetY)
            const nodeId = `pending-branch-${uuidv4()}`
            const basePendingNode: BranchLineCanvasNode = {
                nodeId,
                type: 'branchLine',
                branchId: `pending-${placementKey}-${index}`,
                generationRequestId: placementKey,
                aiChatThreadId: placementKey,
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
            pendingNodes.push(pendingNode)
            stackOffsetY += screenFixedDimensions.height + stackGap
        })
        commitCanvasStatePreservingEditors({
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

        return undefined
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
        if (!threadRecord || !pendingBranchMarkerRecordMatchesGenerationRun(threadRecord, generationRun)) return undefined

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
            // Start at the docked pose's compact size so the move animation grows the
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

    function applyPendingStateToPlannedBranchMarker(
        plannedNode: BranchMarkerNode,
        pendingNode: BranchMarkerNode,
    ): BranchMarkerNode {
        return resizeBranchMarkerNodeFromProseMirror({
            ...plannedNode,
            ...(pendingNode.aiChatThreadId ? { aiChatThreadId: pendingNode.aiChatThreadId } : {}),
            pendingState: {
                ...pendingNode.pendingState!,
                phase: 'planned',
            },
        } as BranchMarkerNode)
    }

    function resolvePendingBranchMarkerWithLineagePlan(
        threadId: string,
        generationRun: MediaGenerationRunMeta | undefined,
    ): void {
        if (!currentCanvasState) return
        const record = ensurePendingBranchMarkerRecordForApiRun(threadId, generationRun)
        if (!record) return

        const pendingNode = currentCanvasState.nodes.find((node: CanvasNode) => node.nodeId === record.nodeId)
        if (!pendingNode || !isBranchMarkerNode(pendingNode) || !pendingNode.pendingState) return

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

    function clearPendingBranchMarkerStateForRun(threadId: string, generationRun?: MediaGenerationRunMeta): void {
        if (!currentCanvasState) return
        const record = getPendingBranchMarkerRecord(threadId, generationRun)
        if (!record) return

        let updatedMarker: BranchMarkerNode | undefined
        const nodes = currentCanvasState.nodes.map((node: CanvasNode): CanvasNode => {
            if (node.nodeId !== record.nodeId || !isBranchMarkerNode(node) || !node.pendingState) return node
            const liveNode = applyBranchMarkerLiveGeometry(node)
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
        if (!currentCanvasState) {
            forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
            return
        }
        const record = getPendingBranchMarkerRecord(threadId, generationRun)
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
            for (const nodeId of removableNodeIds) deletePendingBranchMarkerAliasesForNodeId(nodeId)
            commitCanvasStatePreservingEditors({
                ...currentCanvasState,
                nodes: currentCanvasState.nodes.filter((node: CanvasNode) => !removableNodeIds.includes(node.nodeId)),
                edges: currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                    !removableNodeIds.includes(edge.sourceNodeId) && !removableNodeIds.includes(edge.targetNodeId)
                ),
            })
            for (const nodeId of removableNodeIds) {
                destroyBranchMarkerReasoningTooltip(nodeId)
                liveNodeOverrides.delete(nodeId)
                branchMarkerProjectionOverrideNodeIds.delete(nodeId)
                manuallyPositionedBranchMarkerNodeIds.delete(nodeId)
                findBranchMarkerNodeEl(nodeId)?.remove()
            }
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
        destroyBranchMarkerReasoningTooltip(record.nodeId)
        liveNodeOverrides.delete(record.nodeId)
        branchMarkerProjectionOverrideNodeIds.delete(record.nodeId)
        manuallyPositionedBranchMarkerNodeIds.delete(record.nodeId)
        findBranchMarkerNodeEl(record.nodeId)?.remove()
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

    function getUniqueLineageAssignmentsForMarkers(lineagePlan: MediaBranchLineagePlan): MediaRunLineageAssignment[] {
        const assignments: MediaRunLineageAssignment[] = []
        const seen = new Set<string>()
        for (const assignment of lineagePlan.runAssignments) {
            const markerKey = assignment.branchForkNodeId
                ?? assignment.branchLineNodeId
                ?? assignment.branchOriginNodeId
                ?? assignment.reasoningRunId
                ?? assignment.mediaRunId
            if (!markerKey || seen.has(markerKey)) continue
            seen.add(markerKey)
            assignments.push(assignment)
        }
        return assignments
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
        const resolvedRuns = getUniqueLineageAssignmentsForMarkers(lineagePlan)
            .map(assignment => buildGenerationRunFromLineageAssignment(lineagePlan, assignment, generationRun))
            .filter((run): run is MediaGenerationRunMeta => Boolean(run))
        if (resolvedRuns.length === 0) {
            resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)
            return
        }
        for (const resolvedRun of resolvedRuns) {
            resolvePendingBranchMarkerWithLineagePlan(threadId, resolvedRun)
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
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
            forgetPendingBranchMarkerRecordForRun(threadId, generationRun)
            if (activeCanvasRunIds.has(threadId)) scheduleDetachedCanvasRunTeardown(threadId)
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
        deletePendingBranchMarkerAliasesForPlacement(placementKey)
        if (placementKey !== threadId) {
            pendingBranchMarkers.delete(threadId)
            const initialReasoningModelPrefix = `${threadId}:reasoning-model:`
            for (const key of pendingBranchMarkers.keys()) {
                if (key.startsWith(initialReasoningModelPrefix)) pendingBranchMarkers.delete(key)
            }
        }
        if (activeCanvasRunIds.has(threadId)) scheduleDetachedCanvasRunTeardown(threadId)
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

        const existing = findCanvasNodeById(plannedBranchOriginNodeId)
        if (existing?.type === 'branchOrigin') return existing as BranchOriginCanvasNode

        const nodeId = plannedBranchOriginNodeId
        const dimensions = getBranchMarkerContentDimensions(branchOriginPlan.provenance?.promptText ?? '')
        const referencePosition = getReferenceGroupGeneratedMediaPosition(threadId, mediaHeight, generationRun)
        const position = referencePosition
            ? {
                x: referencePosition.x - getBranchOriginOutputGap() - dimensions.width,
                y: referencePosition.y + (mediaHeight - dimensions.height) / 2,
            }
            : getCenteredFreshBranchOriginPosition(dimensions, mediaHeight)

        const branchOriginNode: BranchOriginCanvasNode = {
            nodeId,
            type: 'branchOrigin',
            branchId: branchOriginPlan.branchId,
            generationRequestId: branchOriginPlan.generationRequestId,
            aiChatThreadId: threadId,
            ...(branchOriginPlan.promptFingerprint ? { promptFingerprint: branchOriginPlan.promptFingerprint } : {}),
            provenance: branchOriginPlan.provenance,
            position,
            dimensions,
            temporary: true,
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

        const existing = findCanvasNodeById(branchForkNodeId)
        if (existing?.type === 'branchFork') return existing as BranchForkCanvasNode

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
            aiChatThreadId: threadId,
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
        if (existing?.type === 'branchLine') return existing as BranchLineCanvasNode

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
            aiChatThreadId: threadId,
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

    type BranchMarkerResponseLocator = {
        attr:
            | 'reasoningRunId'
            | 'branchOriginNodeId'
            | 'branchForkNodeId'
            | 'branchLineNodeId'
            | 'reasoningModelId'
            | 'generationRequestId'
        value: string
    }

    function getPersistedAiChatThread(threadId: string): AiChatThread | undefined {
        const storeThread = aiChatThreadsStore.getThread(threadId)
        const currentThread = currentAiChatThreads.find((candidate: AiChatThread) => candidate.threadId === threadId)
        if (!storeThread) return currentThread
        if (!currentThread) return storeThread
        return storeThread.updatedAt >= currentThread.updatedAt ? storeThread : currentThread
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

    function getAiChatThreadContentForProjection(threadId: string): unknown {
        return liveAiChatThreadContentOverrides.get(threadId)
            ?? getPersistedAiChatThread(threadId)?.content
    }

    function getAiChatThreadContentForBranchMarker(threadId: string): unknown {
        return getAiChatThreadContentForProjection(threadId)
    }

    function getBranchMarkerThreadId(node: BranchMarkerNode): string {
        return node.aiChatThreadId ?? ''
    }

    function getBranchMarkerResponseLocator(node: BranchMarkerNode): BranchMarkerResponseLocator | null {
        const reasoningRunId = (node as BranchForkCanvasNode | BranchLineCanvasNode).reasoningRunId
        if (reasoningRunId) return { attr: 'reasoningRunId', value: reasoningRunId }

        const reasoningModelId = node.pendingState?.reasoningModelId
        if (reasoningModelId) return { attr: 'reasoningModelId', value: reasoningModelId }

        if (node.type === 'branchOrigin') return { attr: 'branchOriginNodeId', value: node.nodeId }
        if (node.type === 'branchFork') return { attr: 'branchForkNodeId', value: node.nodeId }
        if (node.type === 'branchLine') return { attr: 'branchLineNodeId', value: node.nodeId }

        const generationRequestId = node.generationRequestId
        if (generationRequestId && !generationRequestId.startsWith('canvas-')) {
            return { attr: 'generationRequestId', value: generationRequestId }
        }
        return null
    }

    function getBranchMarkerResponseContainer(responseNode: ProseMirrorJsonNode, marker: BranchMarkerNode): ProseMirrorJsonNode | null {
        const sections = (responseNode.content ?? []).filter((child) => child.type === 'aiReasoningSection')
        if (sections.length === 0) return responseNode

        const locator = getBranchMarkerResponseLocator(marker)
        if (!locator) return null
        return sections.find((section) => section.attrs?.[locator.attr] === locator.value) ?? null
    }

    function hasStreamingCollapsibleBlock(node: ProseMirrorJsonNode): boolean {
        if (node.type === 'aiCollapsibleBlock' && node.attrs?.isStreaming) return true
        return Boolean(node.content?.some(hasStreamingCollapsibleBlock))
    }

    function findAiChatThreadContentNode(root: ProseMirrorJsonNode, threadId: string): ProseMirrorJsonNode | null {
        if (root.type === 'aiChatThread' && root.attrs?.threadId === threadId) return root
        for (const child of root.content ?? []) {
            const result = findAiChatThreadContentNode(child, threadId)
            if (result) return result
        }
        return null
    }

    function inferBranchMarkerPreviewPhase(
        responseNode: ProseMirrorJsonNode,
        responseContainer: ProseMirrorJsonNode,
    ): { phase: BranchMarkerStreamPhase; isReceiving: boolean } {
        const responseReceiving = Boolean(responseNode.attrs?.isReceivingAnimation)
        const sectionReceiving = Boolean(responseContainer.attrs?.isReceivingAnimation)
        if (hasStreamingCollapsibleBlock(responseContainer)) {
            return { phase: 'enhancement', isReceiving: true }
        }
        const isReceiving = responseReceiving || sectionReceiving
        return {
            phase: isReceiving ? 'preamble' : 'done',
            isReceiving,
        }
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
        if (node.pendingState) return true

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

    function getBranchMarkerConversationPreview(node: BranchMarkerNode): BranchMarkerConversationPreview | null {
        const threadId = getBranchMarkerThreadId(node)
        if (!threadId) return null

        const root = parseProseMirrorJsonContent(getAiChatThreadContentForBranchMarker(threadId))
        if (!root) return null

        const threadNode = findAiChatThreadContentNode(root, threadId)
        if (!threadNode) return null

        let latestUserMessage: ProseMirrorJsonNode | null = null
        let responseMessage: ProseMirrorJsonNode | null = null

        for (const child of threadNode.content ?? []) {
            if (child.type === 'aiUserMessage') {
                latestUserMessage = child
                continue
            }

            if (child.type === 'aiResponseMessage') {
                responseMessage = child
            }
        }

        if (!latestUserMessage) return null
        const userText = collectProseMirrorText(latestUserMessage).trim()
        if (!responseMessage) {
            return {
                userText,
                responseText: '',
                phase: 'preamble',
                isReceiving: false,
                streamIsReceiving: false,
            }
        }

        const responseContainer = getBranchMarkerResponseContainer(responseMessage, node)
        if (!responseContainer) {
            return {
                userText,
                responseText: '',
                phase: 'preamble',
                isReceiving: false,
                streamIsReceiving: false,
            }
        }

        const { phase, isReceiving: streamIsReceiving } = inferBranchMarkerPreviewPhase(responseMessage, responseContainer)
        return {
            userText,
            responseText: collectProseMirrorText(responseContainer, {
                excludedNodeTypes: ['aiGeneratedImage', 'aiGeneratedVideo', 'aiLineageEvent'],
            }).trim(),
            phase,
            isReceiving: streamIsReceiving || isBranchMarkerGenerationActive(node),
            streamIsReceiving,
        }
    }

    function shouldShowBranchMarkerResponseLine(
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): boolean {
        return Boolean(preview?.responseText) && (!node.pendingState || Boolean(preview?.streamIsReceiving))
    }

    function resizeBranchMarkerNodeFromProseMirror(node: BranchMarkerNode): BranchMarkerNode {
        const preview = getBranchMarkerConversationPreview(node)
        return resizeBranchMarkerNodeToDimensions(
            node,
            getBranchMarkerContentDimensions(preview?.userText ?? '', {
                responseLine: shouldShowBranchMarkerResponseLine(node, preview),
            }),
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

        const markerIdsToSync: string[] = []
        const nextMarkersById = new Map<string, BranchMarkerNode>()
        const geometryMarkersToSync: BranchMarkerNode[] = []
        const { markerIdsWithGeneratedChildren } = getStartedLineageMarkerState(currentCanvasState.nodes)

        for (const node of currentCanvasState.nodes) {
            if (!isBranchMarkerNode(node) || getBranchMarkerThreadId(node) !== threadId) continue
            const hasGeneratedChildren = markerIdsWithGeneratedChildren.has(node.nodeId)
            const liveNode = hasGeneratedChildren ? node : applyBranchMarkerLiveGeometry(node)
            const resizedNode = resizeBranchMarkerNodeFromProseMirror(liveNode)
            const nextNode = !hasGeneratedChildren && manuallyPositionedBranchMarkerNodeIds.has(node.nodeId)
                ? { ...resizedNode, position: liveNode.position }
                : resizedNode
            nextMarkersById.set(node.nodeId, nextNode)
            markerIdsToSync.push(node.nodeId)
        }

        const reflowedMarkersById = reflowStackedBranchMarkers({
            markers: [...nextMarkersById.values()],
            allNodes: currentCanvasState.nodes,
            manuallyPositionedMarkerNodeIds: manuallyPositionedBranchMarkerNodeIds,
            branchMarkerStackGap: getBranchMarkerStackGap(),
            getNodeWorldRect,
        })

        for (const node of currentCanvasState.nodes) {
            if (!isBranchMarkerNode(node) || getBranchMarkerThreadId(node) !== threadId) continue
            const nextNode = reflowedMarkersById.get(node.nodeId) ?? nextMarkersById.get(node.nodeId)
            if (!nextNode) continue

            // Preflight markers are docked over the prompt input via screen
            // projection at a compact, single-line size — their on-canvas dimensions
            // and position are not in play yet. Writing a liveNodeOverride here (from
            // the still-screen-projected node) corrupts the eventual canvas placement,
            // making the marker fly off when it commits. Skip the geometry/override
            // path entirely for preflight; they only need their preview text synced.
            if (node.pendingState?.phase === 'preflight') continue

            const existingOverride = liveNodeOverrides.get(node.nodeId)
            const ownsProjectionOverride = branchMarkerProjectionOverrideNodeIds.has(node.nodeId)
            const needsOverride =
                nextNode.dimensions.width !== node.dimensions.width
                || nextNode.dimensions.height !== node.dimensions.height
                || nextNode.position.x !== node.position.x
                || nextNode.position.y !== node.position.y
            const nextOverride = needsOverride
                ? {
                    ...existingOverride,
                    position: nextNode.position,
                    dimensions: nextNode.dimensions,
                }
                : undefined
            const overrideChanged = nextOverride
                ? existingOverride?.position?.x !== nextOverride.position.x
                    || existingOverride?.position?.y !== nextOverride.position.y
                    || existingOverride?.dimensions?.width !== nextOverride.dimensions.width
                    || existingOverride?.dimensions?.height !== nextOverride.dimensions.height
                : ownsProjectionOverride && Boolean(existingOverride?.position || existingOverride?.dimensions)

            if (!overrideChanged) continue
            if (nextOverride) {
                liveNodeOverrides.set(node.nodeId, nextOverride)
                branchMarkerProjectionOverrideNodeIds.add(node.nodeId)
            } else {
                liveNodeOverrides.delete(node.nodeId)
                branchMarkerProjectionOverrideNodeIds.delete(node.nodeId)
            }
            geometryMarkersToSync.push(nextNode)
        }

        // Preflight markers are skipped above, so everything here is an on-canvas
        // (planned/committed) marker positioned through canvas geometry.
        if (geometryMarkersToSync.length > 0) {
            syncCanvasNodeDomGeometry(geometryMarkersToSync)
            connectionManager?.syncNodes(getNodesForConnectionManager(currentCanvasState.nodes))
            scheduleEdgesRender()
        }
        for (const markerId of markerIdsToSync) {
            const marker = reflowedMarkersById.get(markerId) ?? nextMarkersById.get(markerId)
            if (marker) syncBranchMarkerNodeContent(marker)
        }
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
                && expandedGeneratedMediaInfoNodeIds.has(node.nodeId)
                && node.generatedBy?.aiChatThreadId === threadId) {
                return true
            }

            if ((node.type === 'branchFork' || node.type === 'branchLine')
                && node.aiChatThreadId === threadId) {
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

    function getReferenceGroupGeneratedMediaPosition(threadId: string, mediaHeight: number, generationRun?: MediaGenerationRunMeta): { x: number; y: number } | undefined {
        const referenceGroupRect = getReferenceGroupRectForGeneratedMedia(threadId, generationRun)
        if (!referenceGroupRect) return undefined
        return computeLineageContinuationPositionToRightOfRect(
            referenceGroupRect,
            mediaHeight,
            settings.mediaBranchLineage.rootToFirstMediaGap
        )
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
        const documentTitleById = new Map<string, string>(currentDocuments.map((doc) => [doc.documentId, doc.title]))
        const titlesByNodeId: Record<string, string> = {}
        for (const node of nodes) {
            if (node.type === 'document') {
                const title = documentTitleById.get(node.referenceId)
                if (title) titlesByNodeId[node.nodeId] = title
            }
        }
        return titlesByNodeId
    }

    function rememberStandaloneGeneratedImagePlacement(
        threadId: string,
        messages: any[],
        hasImageModel: boolean,
    ): { promptText: string; imageBranchCandidateSnapshot?: ImageBranchCandidateSnapshot } {
        if (!hasImageModel) {
            clearPendingGeneratedMediaPlacementsForThread(threadId)
            return { promptText: '' }
        }

        const promptText = getPromptTextFromMessages(messages)
        const referenceNodeIds = getStandaloneGeneratedMediaReferenceNodeIds()
        const activeTargetNodeId = referenceNodeIds.length === 1 ? referenceNodeIds[0] : undefined
        const imageBranchCandidateSnapshot = buildImageBranchCandidateSnapshot({
            regionNodeId: `standalone:${threadId}`,
            threadId,
            activeTargetNodeId,
            nodes: currentCanvasState?.nodes ?? [],
            edges: currentCanvasState?.edges ?? [],
            prompt: promptText,
            contextMediaNodeIds: referenceNodeIds,
            generatedImageTextByNodeId: getGeneratedImageTextByNodeIdForThread(threadId),
        })
        const candidateNodeIds = imageBranchCandidateSnapshot.candidates.map((candidate: ImageBranchCandidateSnapshot['candidates'][number]) => candidate.nodeId)
        if (candidateNodeIds.length === 0) {
            pendingGeneratedImagePlacements.set(threadId, {
                referenceNodeIds,
                promptText,
                imageBranchCandidateSnapshot,
                createdAt: Date.now(),
            })
            setGeneratingReferenceNodeIds(threadId, referenceNodeIds)
            console.info('[CANVAS] standalone image branch candidate snapshot', {
                threadId,
                candidateCount: 0,
                promptFingerprint: imageBranchCandidateSnapshot.promptFingerprint,
                activeTargetNodeId: imageBranchCandidateSnapshot.activeTargetNodeId,
                candidateNodeIds,
            })
            return { promptText, imageBranchCandidateSnapshot }
        }
        const placementAnchorNodeId = referenceNodeIds[0] ?? activeTargetNodeId ?? candidateNodeIds[0]
        pendingGeneratedImagePlacements.set(threadId, {
            ...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),
            referenceNodeIds: candidateNodeIds,
            promptText,
            imageBranchCandidateSnapshot,
            createdAt: Date.now(),
        })
        setGeneratingReferenceNodeIds(threadId, candidateNodeIds)
        console.info('[CANVAS] standalone image branch candidate snapshot', {
            threadId,
            candidateCount: imageBranchCandidateSnapshot.candidates.length,
            promptFingerprint: imageBranchCandidateSnapshot.promptFingerprint,
            activeTargetNodeId: imageBranchCandidateSnapshot.activeTargetNodeId,
            candidateNodeIds,
        })
        return { promptText, imageBranchCandidateSnapshot }
    }

    function getPendingGeneratedImageLineage(
        threadId: string,
        generationRun?: MediaGenerationRunMeta,
    ): Partial<NonNullable<ImageCanvasNode['generatedBy']>> {
        const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)
        const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
        if (!lineageAssignment) return {}

        const resolution = placement?.imageBranchResolution

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
            resolverVersion: resolution?.resolverVersion ?? placement?.imageBranchCandidateSnapshot?.resolverVersion,
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

    function isReadyAnalysisDescriptor(descriptor: MediaDescriptor | undefined): descriptor is MediaDescriptor {
        return descriptor?.status === 'ready' && descriptor.source === 'analysis' && Boolean(descriptor.summary.trim())
    }

    function shouldAnalyzeMediaDescriptor(descriptor: MediaDescriptor | undefined): boolean {
        return !isReadyAnalysisDescriptor(descriptor)
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

    function isDescriptorCanvasNode(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode | DocumentCanvasNode {
        return node.type === 'image' || node.type === 'video' || node.type === 'document'
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
        const nextState = { ...currentCanvasState, nodes }
        commitCanvasMetadataState(nextState)
        syncPixiMediaLayer(nextState)
        refreshContextChipTray()
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
    function patchMediaNodeDescriptor(nodeId: string, descriptor: MediaDescriptor): void {
        if (!currentCanvasState) return
        if (!currentCanvasState.nodes.some((node: CanvasNode) => node.nodeId === nodeId)) return
        const nodes = currentCanvasState.nodes.map((node: CanvasNode) => {
            if (node.nodeId !== nodeId || (node.type !== 'image' && node.type !== 'video')) return node
            return { ...node, descriptor }
        })
        commitCanvasState({ ...currentCanvasState, nodes })
    }

    function getCurrentCanvasMediaNode(nodeId: string): ImageCanvasNode | VideoCanvasNode | undefined {
        const node = currentCanvasState?.nodes.find((candidate: CanvasNode) => candidate.nodeId === nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) return undefined
        return node
    }

    function currentMediaStillMatches(nodeId: string, stillFileId: string): boolean {
        const node = getCurrentCanvasMediaNode(nodeId)
        return Boolean(node && getMediaDescriptorStillFileId(node) === stillFileId)
    }

    // Caption a media object from its pixels. `stillFileId` is the image's own
    // file or a video's representative frame/poster — never the MP4 and never
    // the generation prompt. Used by uploads, Media Library inserts, and completed
    // generated media so every visible description is VLM-authored.
    function scheduleCanvasMediaAnalysisRetry(nodeId: string, stillFileId: string, analysisAttempt: number): boolean {
        const delayMs = MEDIA_DESCRIPTOR_ANALYSIS_RETRY_DELAYS_MS[analysisAttempt]
        if (delayMs === undefined) return false
        window.setTimeout(() => queueCanvasMediaAnalysis(nodeId, stillFileId, 0, analysisAttempt + 1), delayMs)
        return true
    }

    async function analyzeCanvasMediaStill(nodeId: string, stillFileId: string, analysisAttempt = 0): Promise<void> {
        const failed = (): MediaDescriptor => ({ ...buildAnalyzingDescriptor(), status: 'failed', updatedAt: Date.now() })
        if (!stillFileId) {
            if (currentMediaStillMatches(nodeId, stillFileId)) patchMediaNodeDescriptor(nodeId, failed())
            return
        }
        try {
            const result = await describeMedia({ workspaceId, fileId: stillFileId })
            if (!currentMediaStillMatches(nodeId, stillFileId)) return
            if (result.error || !result.summary) {
                if (scheduleCanvasMediaAnalysisRetry(nodeId, stillFileId, analysisAttempt)) return
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
            if (!currentMediaStillMatches(nodeId, stillFileId)) return
            if (scheduleCanvasMediaAnalysisRetry(nodeId, stillFileId, analysisAttempt)) return
            patchMediaNodeDescriptor(nodeId, failed())
        }
    }

    function getMediaAnalysisRequestKey(nodeId: string, stillFileId: string): string {
        return `${nodeId}:${stillFileId}`
    }

    async function runQueuedCanvasMediaAnalysis(
        nodeId: string,
        stillFileId: string,
        requestKey: string,
        analysisAttempt: number,
    ): Promise<void> {
        try {
            await analyzeCanvasMediaStill(nodeId, stillFileId, analysisAttempt)
        } finally {
            mediaAnalysisRequestsInFlight.delete(requestKey)
        }
    }

    function queueCanvasMediaAnalysis(nodeId: string, stillFileId: string | undefined, attempt = 0, analysisAttempt = 0): void {
        const hasNode = currentCanvasState?.nodes.some((node: CanvasNode) => node.nodeId === nodeId) ?? false
        if (!hasNode && attempt < 20) {
            window.setTimeout(() => queueCanvasMediaAnalysis(nodeId, stillFileId, attempt + 1, analysisAttempt), 50)
            return
        }
        if (!stillFileId) {
            patchMediaNodeDescriptor(nodeId, { ...buildAnalyzingDescriptor(), status: 'failed', updatedAt: Date.now() })
            return
        }
        const requestKey = getMediaAnalysisRequestKey(nodeId, stillFileId)
        if (mediaAnalysisRequestsInFlight.has(requestKey)) return
        mediaAnalysisRequestsInFlight.add(requestKey)
        void runQueuedCanvasMediaAnalysis(nodeId, stillFileId, requestKey, analysisAttempt)
    }

    function getMediaDescriptorStillFileId(node: ImageCanvasNode | VideoCanvasNode): string | undefined {
        if (node.type === 'image') return node.fileId || undefined
        return node.frameFileId || node.posterFileId || undefined
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
    // analyzeCanvasMediaStill's analyzing -> ready/failed flow. Best-effort: any
    // failure marks the descriptor 'failed' so the analyzing indicator resolves.
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

    function buildStoredImageSrc(workspaceId: string, fileId: string): string {
        return `/api/images/${encodeURIComponent(workspaceId)}/${encodeURIComponent(fileId)}`
    }

    function buildGeneratedImageFrameSrc({
        imageUrl,
        workspaceId: imageWorkspaceId,
        fileId,
        fallbackSrc,
    }: {
        imageUrl?: string
        workspaceId: string
        fileId?: string
        fallbackSrc?: string
    }): string {
        if (imageUrl?.trim()) return buildImageSrc(imageUrl, '', false)
        if (fileId) return buildStoredImageSrc(imageWorkspaceId, fileId)
        if (fallbackSrc) return fallbackSrc
        return buildImageSrc('', '', false)
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
        const nodeEl = createVideoNode(videoNode)
        viewportEl.appendChild(nodeEl)
        connectionManager?.registerNodeElement(videoNode.nodeId, nodeEl as HTMLDivElement)
        syncPixiMediaLayer(currentCanvasState)
        syncConnectionsAfterManualNodeAppend()
    }

    function appendBranchOriginNodeToDOM(branchOriginNode: BranchOriginCanvasNode): void {
        if (findBranchMarkerNodeEl(branchOriginNode.nodeId)) {
            syncBranchMarkerNodeContent(branchOriginNode)
            syncConnectionsAfterManualNodeAppend()
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
            syncBranchMarkerNodeContent(branchForkNode)
            syncConnectionsAfterManualNodeAppend()
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
            syncBranchMarkerNodeContent(branchLineNode)
            syncConnectionsAfterManualNodeAppend()
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

    function commitCanvasMetadataState(nextState: CanvasState): void {
        const prunedState = pruneUnconfirmedFeatureExtractionRuns(nextState).state ?? nextState
        currentCanvasState = prunedState
        onCanvasStateChange?.(prunedState)
    }

    function shouldAcceptGeneratedMediaEvent(threadId: string, eventWorkspaceId?: string): boolean {
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
            const { imageUrl, fileId, responseId, revisedPrompt, aiModel } = data

            const API_BASE_URL = import.meta.env.VITE_API_URL || ''
            const token = await AuthService.getTokenSilently()

            const existingNodes = currentCanvasState?.nodes || []
            // This older callback does not receive a thread id, so it drops the
            // generated image at the viewport center with no source edge.
            const width = getGeneratedMediaInsertionSize()
            const height = width
            const position = getCenteredInsertionPosition({ width, height })

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
                    aiChatThreadId: '',
                    responseId,
                    aiModel: aiModel as any,
                    revisedPrompt,
                    responseMessageId: '',
                },
                descriptor: buildAnalyzingDescriptor(),
            }

            const newCanvasState: CanvasState = {
                ...(currentCanvasState ?? {}),
                viewport: currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 },
                edges: currentCanvasState?.edges ?? [],
                nodes: [...existingNodes, imageNode]
            }

            commitCanvasState(newCanvasState)
            queueCanvasMediaAnalysis(imageNode.nodeId, fileId)
        },

        onImageBranchResolvedToCanvas: ({ threadId, resolution, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            const placement = ensurePendingGeneratedMediaPlacementForApiRun(threadId, generationRun)
            if (!placement) return

            const referenceNodeIds = getExistingMediaNodeIds(resolution.referenceImageNodeIds)
            const placementAnchorNodeId = placement.placementAnchorNodeId ?? referenceNodeIds[0]
            setPendingGeneratedMediaPlacement(threadId, generationRun, {
                ...placement,
                placementAnchorNodeId,
                referenceNodeIds,
                imageBranchResolution: resolution,
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
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            applyMediaBranchLineagePlan(threadId, lineagePlan, generationRun)
        },

        onWorkspaceContextResolvedToCanvas: ({ threadId, resolution, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            handleWorkspaceContextResolution(threadId, resolution, generationRun)
        },

        onImageBranchResolutionErrorToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            removePendingBranchMarkerForRun(threadId, generationRun)
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            pendingGeneratedImagePlacements.delete(placementKey)
            clearGeneratingReferenceNodeIds(placementKey)
            if (activeCanvasRunIds.has(threadId)) scheduleDetachedCanvasRunTeardown(threadId)
        },

        onImageGenerationTraceToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            registerGeneratedMediaRun(threadId, generationRun)
            clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)
        },

        onImageErrorToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const existing = partialImageTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                removePendingBranchMarkerForRun(threadId, generationRun)
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }

            partialImageTracker.delete(runKey)
            selectedNodeIds.delete(existing.nodeId)
            syncPixiGeneratingImageNodes()

            const errorNodeId = existing.nodeId
            const remainingNodes = currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== errorNodeId)
            const remainingEdges = currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                edge.sourceNodeId !== errorNodeId && edge.targetNodeId !== errorNodeId
            )
            const resolvedTreeState = resolveGeneratedMediaTreeState(remainingNodes, remainingEdges)
            const nextState: CanvasState = {
                ...currentCanvasState,
                viewport: currentCanvasState.viewport,
                nodes: resolvedTreeState.nodes,
                edges: resolvedTreeState.edges,
            }
            commitCanvasStatePreservingEditors(nextState)
            const nodeEl = viewportEl?.querySelector(`[data-node-id="${errorNodeId}"]`) as HTMLElement | null
            nodeEl?.remove()
            finishGeneratedMediaRun(threadId, generationRun)
        },

        onImagePartialToCanvas: (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, generationRun } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, imgWorkspaceId)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            const existing = partialImageTracker.get(runKey)

            if (existing) {
                const receivedFirstFrame = !existing.hasReceivedFrame && Boolean(imageUrl)
                const updatedTracker = {
                    ...existing,
                    fileId: fileId || existing.fileId,
                    hasReceivedFrame: existing.hasReceivedFrame || Boolean(imageUrl),
                }
                partialImageTracker.set(runKey, updatedTracker)

                if (imageUrl && currentCanvasState) {
                    clearGeneratingReferencesOnFirstPixels(threadId, generationRun)
                    const imageSrc = buildImageSrc(imageUrl, '', false)
                    const updatedNodes = currentCanvasState.nodes.map((node: CanvasNode) => {
                        if (node.nodeId !== existing.nodeId) return node
                        const imageNode = node as ImageCanvasNode
                        const position = receivedFirstFrame
                            ? getFullFramePositionFromPendingGeneratedMediaPosition(imageNode.position, imageNode.dimensions)
                            : imageNode.position
                        const generatedBy = imageNode.generatedBy && generationRun?.mediaModelId
                            ? { ...imageNode.generatedBy, mediaModelId: generationRun.mediaModelId as any }
                            : imageNode.generatedBy
                        return {
                            ...imageNode,
                            fileId: fileId || imageNode.fileId,
                            workspaceId: imgWorkspaceId || imageNode.workspaceId,
                            src: imageSrc,
                            position,
                            generatedBy,
                        } satisfies ImageCanvasNode
                    })

                    const resolvedNodes = receivedFirstFrame
                        ? rebalanceGeneratedMediaTrees(updatedNodes, currentCanvasState.edges)
                        : updatedNodes

                    commitCanvasStatePreservingEditors({ ...currentCanvasState, nodes: resolvedNodes })
                }
                return
            }

            const imageWidth = getGeneratedMediaInsertionSize()
            const imageHeight = imageWidth
            const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
            if (!lineageAssignment) {
                console.error('[CANVAS] Missing API media lineage assignment for image partial', { threadId, generationRun })
                removePendingBranchMarkerForRun(threadId, generationRun)
                return
            }
            const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, imageHeight)
            const { branchForkNode, branchLineNode, markerNode } = ensureBranchMarkerForGeneratedMedia(threadId, generationRun, branchOriginNode)
            const edgeSourceNode = getGeneratedMediaEdgeSourceNode(generationRun, [branchOriginNode, branchForkNode, branchLineNode])
            if (!edgeSourceNode) {
                console.error('[CANVAS] Missing API media lineage parent for image partial', {
                    threadId,
                    lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                    generationRun,
                })
                removePendingBranchMarkerForRun(threadId, generationRun)
                return
            }
            const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

            clearPendingBranchMarkerStateForRun(threadId, generationRun)
            const nodeId = `node-${fileId || uuidv4()}`
            partialImageTracker.set(runKey, {
                nodeId,
                fileId: fileId || '',
                placementKey,
                hasReceivedFrame: Boolean(imageUrl),
                sourceNodeId: edgeSourceNode.nodeId,
            })

            const imageSrc = buildGeneratedImageFrameSrc({
                imageUrl,
                workspaceId: imgWorkspaceId || workspaceId,
                fileId: fileId || '',
            })

            const finalPosition = getNextGeneratedMediaPosition(edgeSourceNode, imageHeight)
            const position = getPendingGeneratedMediaBeforeFrameInsertionPosition(
                nodeId,
                finalPosition,
                { width: imageWidth, height: imageHeight },
            )

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
                    ...(generationRun?.mediaModelId ? { mediaModelId: generationRun.mediaModelId } : {}),
                    revisedPrompt: promptText,
                    responseMessageId: '',
                    ...getPendingGeneratedImageLineage(threadId, generationRun),
                }
            }

            const existingNodes = addBranchLineageMarkerNodesIfMissing(currentCanvasState?.nodes || [], branchOriginNode, branchForkNode, branchLineNode)
            const existingEdges = addBranchMarkerEdgeIfMissing(currentCanvasState?.edges || [], markerNode)

            const newEdges = [
                ...existingEdges,
                createGeneratedImageEdge(edgeSourceNode, nodeId),
            ]

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
            appendBranchMarkerNodeToDOM(rebalancedNodes, markerNode)
            const placedImageNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === nodeId) as ImageCanvasNode) ?? imageNode
            appendImageNodeToDOM(placedImageNode)
            if (imageUrl) clearGeneratingReferencesOnFirstPixels(threadId, generationRun)
        },

        onImageCompleteToCanvas: (data) => {
            const { threadId, imageUrl, fileId, workspaceId: imgWorkspaceId, responseId, revisedPrompt, aiModel, imageModelProvider, imageModelId, responseMessageId, generationRun } = data
            if (!shouldAcceptGeneratedMediaEvent(threadId, imgWorkspaceId)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)
            const completionMediaModelId = generationRun?.mediaModelId ?? buildAiModelId(imageModelProvider, imageModelId ?? '')

            const partial = partialImageTracker.get(runKey)

            if (partial) {
                const receivedFirstFrame = !partial.hasReceivedFrame
                if (!getApiMediaRunLineageAssignment(generationRun)) {
                    console.error('[CANVAS] Missing API media lineage assignment for image completion', { threadId, generationRun })
                    finishGeneratedMediaRun(threadId, generationRun)
                    return
                }
                const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''
                // Upgrade existing partial canvas node to complete
                const nodes = (currentCanvasState?.nodes || []).map((n: CanvasNode) => {
                    if (n.nodeId !== partial.nodeId) return n
                    const imgNode = n as ImageCanvasNode
                    const position = receivedFirstFrame
                        ? getFullFramePositionFromPendingGeneratedMediaPosition(imgNode.position, imgNode.dimensions)
                        : imgNode.position
                    const imageSrc = buildGeneratedImageFrameSrc({
                        imageUrl,
                        workspaceId: imgWorkspaceId || imgNode.workspaceId,
                        fileId: fileId || imgNode.fileId,
                        fallbackSrc: imgNode.src,
                    })
                    const generatedBy: ImageCanvasNode['generatedBy'] = {
                        aiChatThreadId: threadId,
                        responseId,
                        aiModel: (generationRun?.reasoningModelId ?? aiModel) as any,
                        imageModelProvider: imageModelProvider || '',
                        revisedPrompt: revisedPrompt || imgNode.generatedBy?.revisedPrompt || promptText,
                        responseMessageId: responseMessageId || '',
                        ...getPendingGeneratedImageLineage(threadId, generationRun),
                        ...(completionMediaModelId ? { mediaModelId: completionMediaModelId as any } : {}),
                    }
                    return {
                        ...imgNode,
                        fileId: fileId || imgNode.fileId,
                        workspaceId: imgWorkspaceId || imgNode.workspaceId,
                        src: imageSrc,
                        position,
                        generatedBy,
                        descriptor: buildAnalyzingDescriptor(),
                    } satisfies ImageCanvasNode
                })

                const edges = (currentCanvasState?.edges || []).map((e: WorkspaceEdge) => {
                    if (e.targetNodeId !== partial.nodeId) return e
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
                const completedImageNode = getCurrentCanvasMediaNode(partial.nodeId)
                queueCanvasMediaAnalysis(
                    partial.nodeId,
                    completedImageNode ? getMediaDescriptorStillFileId(completedImageNode) : fileId || partial.fileId,
                )

            } else {
                // No partial existed — IMAGE_COMPLETE without prior IMAGE_PARTIAL.
                // Guard against duplicates: skip if this fileId is already on canvas
                if (fileId && currentCanvasState?.nodes.some((n: CanvasNode) => n.type === 'image' && (n as ImageCanvasNode).fileId === fileId)) {
                    removePendingBranchMarkerForRun(threadId, generationRun)
                    finishGeneratedMediaRun(threadId, generationRun)
                    return
                }

                const imageWidth = getGeneratedMediaInsertionSize()
                const imageHeight = imageWidth
                const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
                if (!lineageAssignment) {
                    console.error('[CANVAS] Missing API media lineage assignment for image completion', { threadId, generationRun })
                    removePendingBranchMarkerForRun(threadId, generationRun)
                    finishGeneratedMediaRun(threadId, generationRun)
                    return
                }
                const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, imageHeight)
                const { branchForkNode, branchLineNode, markerNode } = ensureBranchMarkerForGeneratedMedia(threadId, generationRun, branchOriginNode)
                const edgeSourceNode = getGeneratedMediaEdgeSourceNode(generationRun, [branchOriginNode, branchForkNode, branchLineNode])
                if (!edgeSourceNode) {
                    console.error('[CANVAS] Missing API media lineage parent for image completion', {
                        threadId,
                        lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                        generationRun,
                    })
                    removePendingBranchMarkerForRun(threadId, generationRun)
                    finishGeneratedMediaRun(threadId, generationRun)
                    return
                }
                const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

                clearPendingBranchMarkerStateForRun(threadId, generationRun)
                const nodeId = `node-${fileId || uuidv4()}`
                const imageSrc = buildGeneratedImageFrameSrc({
                    imageUrl,
                    workspaceId: imgWorkspaceId || workspaceId,
                    fileId: fileId || '',
                })

                const position = getNextGeneratedMediaPosition(edgeSourceNode, imageHeight)

                const generatedBy: ImageCanvasNode['generatedBy'] = {
                    aiChatThreadId: threadId,
                    responseId,
                    aiModel: (generationRun?.reasoningModelId ?? aiModel) as any,
                    imageModelProvider: imageModelProvider || '',
                    revisedPrompt: revisedPrompt || promptText,
                    responseMessageId: responseMessageId || '',
                    ...getPendingGeneratedImageLineage(threadId, generationRun),
                    ...(completionMediaModelId ? { mediaModelId: completionMediaModelId as any } : {}),
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
                    descriptor: buildAnalyzingDescriptor(),
                }

                const existingNodes = addBranchLineageMarkerNodesIfMissing(currentCanvasState?.nodes || [], branchOriginNode, branchForkNode, branchLineNode)
                const existingEdges = addBranchMarkerEdgeIfMissing(currentCanvasState?.edges || [], markerNode)

                const newEdges = [
                    ...existingEdges,
                    createGeneratedImageEdge(edgeSourceNode, nodeId, responseMessageId || undefined),
                ]

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
                appendBranchMarkerNodeToDOM(resolvedNodes, markerNode)
                appendImageNodeToDOM(resolvedImageNode)

                commitCanvasStatePreservingEditors(currentCanvasState)
                finishGeneratedMediaRun(threadId, generationRun)
                queueCanvasMediaAnalysis(nodeId, fileId)
            }
        },

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
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const placementKey = getGeneratedMediaPlacementKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            if (videoGenerationTracker.has(runKey)) return

            // Placeholder is square until the attached <video> reports the MP4's
            // intrinsic dimensions; handleVideoIntrinsicSize re-fits the node,
            // then re-tidies the generated-media tree around the final frame.
            const placeholderWidth = getGeneratedMediaInsertionSize()
            const placeholderHeight = placeholderWidth
            const lineageAssignment = getApiMediaRunLineageAssignment(generationRun)
            if (!lineageAssignment) {
                console.error('[CANVAS] Missing API media lineage assignment for video pending', { threadId, generationRun })
                removePendingBranchMarkerForRun(threadId, generationRun)
                return
            }
            const branchOriginNode = ensureBranchOriginForGeneratedMedia(threadId, generationRun, placeholderHeight)
            const { branchForkNode, branchLineNode, markerNode } = ensureBranchMarkerForGeneratedMedia(threadId, generationRun, branchOriginNode)
            const edgeSourceNode = getGeneratedMediaEdgeSourceNode(generationRun, [branchOriginNode, branchForkNode, branchLineNode])
            if (!edgeSourceNode) {
                console.error('[CANVAS] Missing API media lineage parent for video pending', {
                    threadId,
                    lineageParentNodeId: lineageAssignment.lineageParentNodeId,
                    generationRun,
                })
                removePendingBranchMarkerForRun(threadId, generationRun)
                return
            }
            const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''

            clearPendingBranchMarkerStateForRun(threadId, generationRun)
            const nodeId = `node-${uuidv4()}`
            videoGenerationTracker.set(runKey, {
                nodeId,
                fileId: '',
                placementKey,
                hasReceivedFrame: false,
                sourceNodeId: edgeSourceNode.nodeId,
            })

            const finalPosition = getNextGeneratedMediaPosition(edgeSourceNode, placeholderHeight)
            const position = getPendingGeneratedMediaBeforeFrameInsertionPosition(
                nodeId,
                finalPosition,
                { width: placeholderWidth, height: placeholderHeight },
            )

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

            const existingNodes = addBranchLineageMarkerNodesIfMissing(currentCanvasState?.nodes || [], branchOriginNode, branchForkNode, branchLineNode)
            const existingEdges = addBranchMarkerEdgeIfMissing(currentCanvasState?.edges || [], markerNode)
            const newEdges = [
                ...existingEdges,
                createGeneratedImageEdge(edgeSourceNode, nodeId),
            ]

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
            appendBranchMarkerNodeToDOM(rebalancedNodes, markerNode)
            const placedVideoNode = (rebalancedNodes.find((n: CanvasNode) => n.nodeId === nodeId) as VideoCanvasNode) ?? videoNode
            appendVideoNodeToDOM(placedVideoNode)
        },

        onVideoGeneratingToCanvas: ({ threadId }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            // VEO keepalive heartbeat. The PIXI traveling outline is already
            // running on the placeholder via pixiMediaLayer's generating-image
            // tracker, so no canvas state mutation is required here. Phase 6
            // may add a "still generating" pulse animation.
        },

        onVideoGenerationTraceToCanvas: ({ threadId, generationRun }) => {
            if (!shouldAcceptGeneratedMediaEvent(threadId)) return

            registerGeneratedMediaRun(threadId, generationRun)
            clearGeneratingReferencesAfterPromptHandoff(threadId, generationRun)
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
            if (!shouldAcceptGeneratedMediaEvent(threadId, videoWorkspaceId)) return

            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            registerGeneratedMediaRun(threadId, generationRun)

            const existing = videoGenerationTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }
            const receivedFirstFrame = !existing.hasReceivedFrame

            const promptText = getPendingGeneratedMediaPlacement(threadId, generationRun)?.promptText ?? ''
            if (!getApiMediaRunLineageAssignment(generationRun)) {
                console.error('[CANVAS] Missing API media lineage assignment for video completion', { threadId, generationRun })
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }
            const lineage = getPendingGeneratedImageLineage(threadId, generationRun)

            const nodes = currentCanvasState.nodes.map((n: CanvasNode) => {
                if (n.nodeId !== existing.nodeId || n.type !== 'video') return n
                const videoNode = n as VideoCanvasNode
                const position = receivedFirstFrame
                    ? getFullFramePositionFromPendingGeneratedMediaPosition(videoNode.position, videoNode.dimensions)
                    : videoNode.position
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
                    position,
                    aspectRatio: fittedAspect,
                    durationSeconds: durationSeconds || videoNode.durationSeconds,
                    hasAudio: hasAudio ?? videoNode.hasAudio,
                    generatedBy,
                    descriptor: buildAnalyzingDescriptor(),
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
            const completedVideoNode = getCurrentCanvasMediaNode(existing.nodeId)
            queueCanvasMediaAnalysis(
                existing.nodeId,
                completedVideoNode ? getMediaDescriptorStillFileId(completedVideoNode) : frameFileId || posterFileId,
            )
        },

        onVideoErrorToCanvas: (data) => {
            const { threadId, generationRun } = data
            const runKey = getGeneratedMediaRunKey(threadId, generationRun)
            const existing = videoGenerationTracker.get(runKey)
            if (!existing || !currentCanvasState) {
                removePendingBranchMarkerForRun(threadId, generationRun)
                finishGeneratedMediaRun(threadId, generationRun)
                return
            }

            videoGenerationTracker.delete(runKey)
            syncPixiGeneratingImageNodes()

            const errorNodeId = existing.nodeId
            setTimeout(() => {
                if (!currentCanvasState) return
                const remainingNodes = currentCanvasState.nodes.filter((node: CanvasNode) => node.nodeId !== errorNodeId)
                const remainingEdges = currentCanvasState.edges.filter((edge: WorkspaceEdge) =>
                    edge.sourceNodeId !== errorNodeId && edge.targetNodeId !== errorNodeId
                )
                const resolvedTreeState = resolveGeneratedMediaTreeState(remainingNodes, remainingEdges)
                const nextState: CanvasState = {
                    ...currentCanvasState,
                    nodes: resolvedTreeState.nodes,
                    edges: resolvedTreeState.edges,
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
        const prunedState = pruneUnconfirmedFeatureExtractionRuns(nextState).state ?? nextState
        canvasMediaNodeLifecycle.trackCanvasState(prunedState)
        currentCanvasState = prunedState
        pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(prunedState)
        onCanvasStateChange?.(prunedState)

        syncCanvasNodeDomGeometry(prunedState.nodes)
        syncPixiMediaLayer(prunedState)
        syncConnectionManagerForCurrentCanvasState()
        pixiMediaLayer?.renderNow()
        lastVisualSyncKey = getCanvasVisualSyncKey(prunedState)
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
            { fileId: node.fileId }
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
        const spinnerOnUserLine = Boolean(node.pendingState) && !showResponseLine
        const spinnerOnResponseLine = Boolean(node.pendingState) && showResponseLine && responseIsReceiving
        const responseIsEnhancing = responseIsReceiving && responsePhase === 'enhancement'
        const responseDone = showResponseLine && (!node.pendingState || responsePhase === 'done' || !responseIsReceiving)
        const responseSummary = responsePreview ? `Response: ${responsePreview}` : ''
        const accessibleLabel = [promptPreview, label, reasoningModelSummary, responseSummary, modelSummary].filter(Boolean).join(' · ')
        const messageClassName = `workspace-branch-marker-message${node.pendingState ? ' is-pending' : ''}`
        const responseClassName = `workspace-branch-marker-response${responseIsEnhancing ? ' is-enhancing' : ''}`
        // The marker DOM is rebuilt as it streams and as it travels through pending
        // states (preflight → planned → committed). A fresh spinner element would
        // restart its CSS rotation each time. Anchoring `animation-delay` to a
        // negative offset into the global 800ms rotation phase-aligns every newly
        // created spinner with the shared clock, so the spin looks continuous and
        // never visibly restarts no matter how often the element is recreated.
        const spinnerStyle = { animationDelay: `${-(performance.now() % BRANCH_MARKER_SPINNER_PERIOD_MS)}ms` }
        return html`
            <div className="workspace-branch-marker-content" aria-label=${accessibleLabel}>
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
        return Boolean(node && isBranchMarkerNode(node) && node.pendingState)
    }

    function getBranchMarkerTypeLabel(node: BranchMarkerNode): string {
        if (node.pendingState?.phase === 'preflight') return 'Preparing branch'
        if (node.type === 'branchOrigin') return 'Start branch'
        if (node.type === 'branchFork') return 'Fork branch'
        return 'Continue branch'
    }

    function syncBranchMarkerNodeContent(node: BranchMarkerNode): void {
        const nodeEl = findBranchMarkerNodeEl(node.nodeId)
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
            return
        }
        nodeEl.insertBefore(nextContent, dragOverlay)
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
                    if (!isCurrentBranchMarkerPending(node.nodeId)) toggleBranchOriginGeneratedMediaInfo(node.nodeId)
                },
            }
        )
        dragOverlay.className = 'branch-origin-drag-overlay nopan'

        const content = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        nodeEl.insertBefore(content, dragOverlay)

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
                    if (!isCurrentBranchMarkerPending(node.nodeId)) toggleBranchForkGeneratedMediaInfo(node.nodeId)
                },
            }
        )
        dragOverlay.className = 'branch-fork-drag-overlay nopan'

        const content = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        nodeEl.insertBefore(content, dragOverlay)

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
                    if (!isCurrentBranchMarkerPending(node.nodeId)) toggleBranchLineGeneratedMediaInfo(node.nodeId)
                },
            }
        )
        dragOverlay.className = 'branch-line-drag-overlay nopan'

        const content = createBranchMarkerContent({
            node,
            label: getBranchMarkerTypeLabel(node),
        })
        nodeEl.insertBefore(content, dragOverlay)

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

        destroyGeneratedMediaInfoRenderers()
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
                const doc = documentMap.get(docNode.referenceId)
                nodeEl = createDocumentNode(docNode, doc)
            } else if (node.type === 'image') {
                nodeEl = createImageNode(node as ImageCanvasNode)
            } else if (node.type === 'video') {
                nodeEl = createVideoNode(node as VideoCanvasNode)
            } else if (node.type === 'branchOrigin') {
                nodeEl = createBranchOriginNode(node as BranchOriginCanvasNode)
            } else if (node.type === 'branchFork') {
                nodeEl = createBranchForkNode(node as BranchForkCanvasNode)
            } else if (node.type === 'branchLine') {
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
                onInsertImage: async (item: MediaLibraryImageMeta) => {
                    try {
                        const materialized = await mediaLibraryService.materializeImage({
                            workspaceId,
                            itemId: item.itemId,
                        })
                        if (!materialized.fileId || !materialized.url) return false
                        const width = settings.mediaNode.image.defaultInsertionWidth
                        const imageNodeId = `node-${materialized.fileId}`
                        // Reuse only VLM-authored descriptions copied into the library item.
                        const savedDescriptor = isReadyAnalysisDescriptor(materialized.descriptor) ? materialized.descriptor : undefined
                        const imageNode: Omit<ImageCanvasNode, 'position'> = {
                            nodeId: imageNodeId,
                            type: 'image',
                            fileId: materialized.fileId,
                            workspaceId,
                            src: materialized.url,
                            aspectRatio: item.aspectRatio,
                            dimensions: { width, height: width / item.aspectRatio },
                            descriptor: savedDescriptor ?? buildAnalyzingDescriptor(),
                        }
                        insertNodeAtViewportCenterInternal(imageNode)
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
                        const width = settings.mediaNode.image.defaultInsertionWidth
                        const aspectRatio = item.aspectRatio || 1
                        const videoNodeId = `node-${materialized.video.fileId}`
                        const posterFileId = materialized.poster?.fileId ?? ''
                        // Reuse only VLM-authored descriptions copied into the library item.
                        const savedDescriptor = isReadyAnalysisDescriptor(materialized.descriptor) ? materialized.descriptor : undefined
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
                            descriptor: savedDescriptor ?? buildAnalyzingDescriptor(),
                        }
                        insertNodeAtViewportCenterInternal(videoNode)
                        return true
                    } catch (error) {
                        console.error('Failed to add Media Library video to canvas:', error)
                        return false
                    }
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
    syncPixiMediaLayer(currentCanvasState)
    if (initialUnconfirmedFeatureExtractionRunsPruned && currentCanvasState) {
        initialUnconfirmedFeatureExtractionRunsPruned = false
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
        const mediaNodeNeedsAnalysis = (positionedNode.type === 'image' || positionedNode.type === 'video')
            && shouldAnalyzeMediaDescriptor((positionedNode as ImageCanvasNode | VideoCanvasNode).descriptor)
        const preparedNode = mediaNodeNeedsAnalysis
            ? { ...(positionedNode as ImageCanvasNode | VideoCanvasNode), descriptor: buildAnalyzingDescriptor() } as CanvasNode
            : positionedNode
        const newCanvasState: CanvasState = {
            ...baseCanvasState,
            ...statePatch,
            viewport: baseCanvasState.viewport,
            edges: baseCanvasState.edges ?? [],
            nodes: resolveTopLevelNodeCollisions([...baseCanvasState.nodes, preparedNode]),
        }

        onCanvasStateChange?.(newCanvasState)

        // A newly inserted document node gets an initial descriptor from any
        // existing content; a fresh, empty node is skipped until it's edited.
        if (preparedNode.type === 'document') {
            const docs = documentsStore.getData() as Document[] | undefined
            const doc = docs?.find((d) => d.documentId === (preparedNode as DocumentCanvasNode).referenceId)
            if (doc?.content !== undefined) scheduleTextNodeDescriptor(preparedNode.nodeId, doc.content, doc.title)
        } else if (mediaNodeNeedsAnalysis && (preparedNode.type === 'image' || preparedNode.type === 'video')) {
            queueCanvasMediaAnalysis(preparedNode.nodeId, getMediaDescriptorStillFileId(preparedNode))
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
            const normalizedCanvasState = renderStatePlan.state
                ? normalizeBranchMarkerDimensions(renderStatePlan.state)
                : renderStatePlan.state
            const prunedCanvasState = pruneUnconfirmedFeatureExtractionRuns(normalizedCanvasState)
            const effectiveCanvasState = prunedCanvasState.state
            if (prunedCanvasState.removed && effectiveCanvasState) onCanvasStateChange?.(effectiveCanvasState)
            pendingLocalCanvasVisualCommit = renderStatePlan.pendingVisualCommit

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
                for (const pendingRunId of pendingFeatureExtractionRuns.keys()) clearPendingExtractionContext(pendingRunId)
                pendingFeatureExtractionRuns.clear()
                apiFeatureExtractionRuns.clear()
                featureExtractionModelSelections.clear()
                unsubscribeAllFeatureExtractionRuns()
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

            const shouldResetMediaLifecycle = workspaceChanged || (!currentCanvasState && Boolean(effectiveCanvasState))

            currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState
                ? { ...effectiveCanvasState, viewport: liveViewport }
                : effectiveCanvasState
            currentDocuments = newDocuments
            currentAiChatThreads = newAiChatThreads
            if (shouldResetMediaLifecycle) {
                canvasMediaNodeLifecycle.initializeFromCanvasState(currentCanvasState)
            }
            syncActiveAiChatPanelFromState()

            // 1. Rebuild DOM first so image nodes exist when PIXI syncs DOM ownership.
            if (needsRerender) {
                renderNodes()
                lastDocumentsKey = getDocumentsKey(newDocuments)
                lastThreadsKey = getAiChatThreadsKey(newAiChatThreads)
            } else {
                refreshActiveAiChatPanelWhenContentLoads()
                if (aiChatPanelState.isOpen && !activeAiChatPanelEl) renderActiveAiChatPanel()
                if (!aiChatPanelState.isOpen && activeAiChatPanelEl && !activeClosingRightSidePanel) destroyActiveAiChatPanel(false)
            }
            refreshBranchMarkerPreviewsForLoadedThreads(newAiChatThreads)

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
            connectionManager?.destroy()
            connectionManager = null
            viewportBridge = null
            destroyGeneratedMediaInfoRenderers()
            destroyBranchMarkerReasoningTooltips()
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
            expandedBranchOriginInfoNodeIds.clear()
            expandedBranchForkInfoNodeIds.clear()
            expandedBranchLineInfoNodeIds.clear()
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
            for (const [threadId, { editor, aiService, containerEl }] of detachedAiChatThreadEditors) {
                if (editor?.destroy) editor.destroy()
                if (aiService?.disconnect) aiService.disconnect()
                promptInputController.unregisterThreadEditor(threadId)
                containerEl.remove()
            }
            detachedAiChatThreadEditors.clear()
            detachedAiChatThreadHostEl?.remove()
            detachedAiChatThreadHostEl = null
            canvasMediaNodeLifecycle.destroy()
            videoNodeHandler?.destroy()
            videoNodeHandler = null
            videoGenerationTracker.clear()
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
