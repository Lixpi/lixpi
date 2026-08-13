'use strict'

// Shared canvas layout geometry for generated-media branch lineage. The API
// canvas projection (services/api/src/services/asset-canvas-projection.ts)
// and the WebUI canvas (services/web-ui/src/infographics/workspace) must place
// markers and media with identical dimensions and gaps — two diverging copies
// make the persisted API geometry fight the client-side rebalance, so nodes
// jump or overlap mid-run. Tune spacing here and nowhere else.

export type MediaGenerationMarkerTextSettings = {
    // Pixel font size of the user-message preview line (the bold prompt text).
    messageFontSize: number
    // Unitless line-height multiplier applied to the user-message preview.
    messageLineHeight: number
    // Pixel font size of the AI-response preview line below the separator.
    responseFontSize: number
    // Unitless line-height multiplier applied to the AI-response preview.
    responseLineHeight: number
}

export type MediaGenerationMarkerSettings = {
    // Canvas-unit base size for branch lineage markers; width/height derive from it.
    baseSize: number
    // Multiplier on baseSize for the marker's comfortable minimum width.
    minWidthMultiplier: number
    // Multiplier on the minimum width capping how wide an on-canvas marker may grow.
    maxWidthGrowth: number
    // Multiplier on the minimum width capping the screen-fixed preflight pose.
    screenFixedMaxWidthGrowth: number
    // Hard cap on the screen-fixed preflight pose as a fraction of the prompt input width.
    screenFixedMaxWidthFraction: number
    // Naive per-character width used for width sizing.
    approxCharWidth: number
    // Wider per-character width used when predicting line wrapping.
    lineWrapCharWidth: number
    horizontalPadding: number
    screenFixedHorizontalPadding: number
    promptPreviewMaxChars: number
    responsePreviewMaxChars: number
    verticalPadding: number
    screenFixedVerticalPadding: number
    separatorHeight: number
    screenFixedSeparatorHeight: number
    text: MediaGenerationMarkerTextSettings
}

export type GeneratedMediaChromeLayoutSettings = {
    // Base screen-pixel height reserved for the single-line title above a
    // resolved media node, including the title's bottom padding.
    titleCollisionHeight: number
    // Screen-pixel gap between a media node's bottom edge and its chrome strip.
    topGap: number
    // Screen-pixel icon/button size of the chrome strip.
    iconSize: number
    // Screen-pixel height of the shared video controls bar.
    videoControlsHeight: number
    // Screen-pixel gap between a video node edge and the external controls strip.
    videoControlsBottomInset: number
    // Bounded zoom curve used to project screen-fixed chrome. Collision layout
    // reserves the curve's maximum world-space footprint.
    zoomScaling: {
        minZoom: number
        lowZoomPower?: number
    }
}

export type GeneratedMediaProgressLayoutSettings = {
    width: number
    gap: number
}

export type MediaGenerationLayoutSettings = {
    markerWidth: number
    markerHeight: number
    generatedMediaSize: number
    nodeGap: number
    rootToFirstMediaGap: number
    branchRowGap: number
    mediaToMediaGap: number
    branchOriginToFirstMediaGap: number
    branchFanoutExtraGap: number
    pendingMarkerInputGap: number
    pendingMarkerMoveDurationMs: number
    preFrameCircleScale: number
    serverFallbackPaneHeight: number
    marker: MediaGenerationMarkerSettings
    generatedMediaChrome: GeneratedMediaChromeLayoutSettings
    generatedMediaProgress: GeneratedMediaProgressLayoutSettings
}

export type WorkspaceCollisionNodeTypeSettings = {
    iterations: number
    margin: number
    overlapThreshold: number
}

export type WorkspaceCollisionFlowSettings = {
    nodeTypes: {
        document: WorkspaceCollisionNodeTypeSettings
        image: WorkspaceCollisionNodeTypeSettings
        video: WorkspaceCollisionNodeTypeSettings
        branchOrigin: WorkspaceCollisionNodeTypeSettings
        branchFork: WorkspaceCollisionNodeTypeSettings
        branchLine: WorkspaceCollisionNodeTypeSettings
    }
}

export type WorkspaceCollisionSettings = {
    insertion: WorkspaceCollisionFlowSettings
    dragRelease: WorkspaceCollisionFlowSettings
    branchTree: WorkspaceCollisionFlowSettings
}

export const mediaGenerationLayoutSettings: MediaGenerationLayoutSettings = {
    // Canvas-unit base width of a branch marker pill as the API projects it.
    markerWidth: 280,
    // Canvas-unit base height of a branch marker pill as the API projects it.
    markerHeight: 64,
    // Canvas-unit base width and height for new generated media nodes. Increasing it makes each generated branch artifact larger when inserted.
    generatedMediaSize: 800,
    // Canvas-unit minimum empty space reserved around every branchOrigin, branchFork, and branchLine marker during placement, drag release, and branch-tree rebalance.
    nodeGap: 64,
    // Canvas-unit horizontal gap between a chat root or reference group and the first generated media node in that branch.
    rootToFirstMediaGap: 384,
    // Canvas-unit vertical gap between separate branch rows spawned from the same chat root. Increasing it moves new branches farther below the previous branch.
    branchRowGap: 160,
    // Canvas-unit base horizontal gap between consecutive generated media nodes in the same branch lineage.
    mediaToMediaGap: 712,
    // Canvas-unit horizontal gap from a temporary branchOrigin marker to its first generated media node.
    branchOriginToFirstMediaGap: 312,
    // Canvas-unit extra horizontal gap added for each extra generated media node when a lineage forks. Increasing it gives large branch fans more curve room.
    branchFanoutExtraGap: 200,
    // Screen-pixel vertical gap between stacked screen-fixed pending branch markers.
    pendingMarkerInputGap: 8,
    // Milliseconds for moving a pending branch marker from screen-fixed preflight into API-planned canvas position.
    pendingMarkerMoveDurationMs: 420,
    // Diameter of the pre-first-frame generation circle as a fraction of the pending media node's shortest side.
    preFrameCircleScale: 1 / 3,
    // Canvas-unit pane height the API assumes when the client did not report its visible area.
    serverFallbackPaneHeight: 900,
    // Text-driven branch-marker pill sizing. The API estimates marker dimensions
    // from the SAME metrics the WebUI uses to render, so server-resolved layout
    // reserves exactly the space the client paints.
    marker: {
        baseSize: 96,
        minWidthMultiplier: 2.6,
        maxWidthGrowth: 1.5,
        screenFixedMaxWidthGrowth: 6,
        screenFixedMaxWidthFraction: 0.8,
        approxCharWidth: 8,
        lineWrapCharWidth: 10,
        horizontalPadding: 60,
        // Includes the compact pose's asymmetric stop-control padding plus its
        // reasoning icon, progress spinner, flex gaps, and inline-reference icon.
        screenFixedHorizontalPadding: 124,
        promptPreviewMaxChars: 120,
        responsePreviewMaxChars: 50,
        verticalPadding: 30,
        screenFixedVerticalPadding: 18,
        separatorHeight: 16,
        screenFixedSeparatorHeight: 10,
        text: {
            messageFontSize: 16,
            messageLineHeight: 1.14,
            responseFontSize: 11.5,
            responseLineHeight: 1.15,
        },
    },
    // Screen-fixed title/model chrome reserved around resolved media in collision
    // boxes, on both the API and the WebUI.
    generatedMediaChrome: {
        titleCollisionHeight: 46,
        topGap: 8,
        iconSize: 34,
        videoControlsHeight: 40,
        videoControlsBottomInset: 8,
        zoomScaling: { minZoom: 0.4 },
    },
    generatedMediaProgress: {
        width: 360,
        gap: 36,
    },
}

// Workspace collision resolution settings. Resolver iterations, spacing, and
// trigger thresholds are configured per canvas node type. Branch-lineage marker
// margins are replaced at runtime by mediaGenerationLayoutSettings.nodeGap so
// one spacing knob controls every marker type across placement, drag, API
// projection, and WebUI rebalance.
export const workspaceCollisionSettings: WorkspaceCollisionSettings = {
    // Viewport-centered insertions use wider breathing room.
    insertion: {
        nodeTypes: {
            document: { iterations: 50, margin: 32, overlapThreshold: 0.5 },
            image: { iterations: 50, margin: 32, overlapThreshold: 0.5 },
            video: { iterations: 50, margin: 32, overlapThreshold: 0.5 },
            branchOrigin: { iterations: 50, margin: 0, overlapThreshold: 0 },
            branchFork: { iterations: 50, margin: 0, overlapThreshold: 0 },
            branchLine: { iterations: 50, margin: 0, overlapThreshold: 0 },
        },
    },
    // Drag-release cleanup keeps manually positioned nodes tight while runtime
    // marker margins still prevent branch-lineage marker bodies from overlapping.
    dragRelease: {
        nodeTypes: {
            document: { iterations: 50, margin: 20, overlapThreshold: 0.5 },
            image: { iterations: 50, margin: 20, overlapThreshold: 0.5 },
            video: { iterations: 50, margin: 20, overlapThreshold: 0.5 },
            branchOrigin: { iterations: 50, margin: 0, overlapThreshold: 0 },
            branchFork: { iterations: 50, margin: 0, overlapThreshold: 0 },
            branchLine: { iterations: 50, margin: 0, overlapThreshold: 0 },
        },
    },
    // Branch-tree rebalancing combines normal media/document breathing room with
    // runtime branch-marker clearance from mediaGenerationLayoutSettings.nodeGap.
    branchTree: {
        nodeTypes: {
            document: { iterations: 50, margin: 20, overlapThreshold: 0.5 },
            image: { iterations: 50, margin: 20, overlapThreshold: 0.5 },
            video: { iterations: 50, margin: 20, overlapThreshold: 0.5 },
            branchOrigin: { iterations: 50, margin: 0, overlapThreshold: 0 },
            branchFork: { iterations: 50, margin: 0, overlapThreshold: 0 },
            branchLine: { iterations: 50, margin: 0, overlapThreshold: 0 },
        },
    },
}
