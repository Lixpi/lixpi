'use strict'

// Shared canvas layout geometry for generated-media branch lineage. The API
// canvas projection (services/api/src/services/media-generation-canvas-projection.ts)
// and the WebUI canvas (services/web-ui/src/infographics/workspace) must place
// markers and media with identical dimensions and gaps — two diverging copies
// make the persisted API geometry fight the client-side rebalance, so nodes
// jump or overlap mid-run. Tune spacing here and nowhere else.

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
    serverFallbackPaneHeight: number
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
    // Canvas-unit pane height the API assumes when the client did not report its visible area.
    serverFallbackPaneHeight: 900,
}
