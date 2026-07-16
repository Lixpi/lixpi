import type {
    CanvasNode,
    CanvasViewport,
    ImageCanvasNode,
} from '@lixpi/constants'
import { isApiEndpoint, resolveMediaUrl, stripAuthTokenFromUrl } from '$src/utils/mediaUrls.ts'

export type IndexedImage = {
    minX: number
    minY: number
    maxX: number
    maxY: number
    nodeId: string
}

export type WorldPosition = {
    x: number
    y: number
}

export function getSafeViewportZoom(viewport: Pick<CanvasViewport, 'zoom'>): number {
    return Number.isFinite(viewport.zoom) ? Math.max(viewport.zoom, 0.01) : 1
}

export function worldPointToScreenPoint(
    point: { x: number; y: number },
    viewport: CanvasViewport
): { x: number; y: number } {
    const zoom = getSafeViewportZoom(viewport)
    return {
        x: point.x * zoom + viewport.x,
        y: point.y * zoom + viewport.y,
    }
}

export function worldSizeToScreenSize(size: number, viewport: Pick<CanvasViewport, 'zoom'>): number {
    return size * getSafeViewportZoom(viewport)
}

// World-position accumulation and node indexing live in @lixpi/canvas-engine
// shared (the API layout walks parent chains identically). Re-exported here so
// PIXI-layer call sites keep their local import path.
export { buildNodesById, computeWorldPosition } from '@lixpi/canvas-engine'

export type LodTier = 'color' | 'thumb-256' | 'thumb-1024' | 'full'

// Higher rank = higher pixel quality. The PIXI media layer uses this to
// avoid the classic LoD-pyramid trap of refetching a smaller texture when
// the user zooms out: a higher-resolution texture already on the GPU can
// be downsampled for free by mipmapping, so zooming out should never
// trigger a network round-trip.
export function tierRank(tier: LodTier): number {
    switch (tier) {
        case 'color': return 0
        case 'thumb-256': return 1
        case 'thumb-1024': return 2
        case 'full': return 3
    }
}

export type PixiRendererHealth = 'initializing' | 'ready' | 'destroyed'

export const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export function buildPixiImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {
    return resolveMediaUrl(imageUrl, { apiBaseUrl, emptyFallback: transparentPixel, token })
}

export function isStoredImageSrc(src: string): boolean {
    const stripped = stripAuthTokenFromUrl(src)
    return isApiEndpoint(stripped)
}

export function resolveStoredImagePath(node: ImageCanvasNode, _workspaceId: string): string {
    return `/api/assets/${encodeURIComponent(node.assetId)}/renditions/preview`
}

export function isGeneratedImageNodeWaitingForFrame(node: ImageCanvasNode): boolean {
    return Boolean(node.generatedBy && !node.assetId)
}

export function getPixiLodTier(zoom: number): LodTier {
    if (zoom < 0.1) return 'color'
    if (zoom < 0.4) return 'thumb-256'
    if (zoom < 1) return 'thumb-1024'
    return 'full'
}

export function addPixiLodSizeParam(url: string, tier: LodTier): string {
    if (tier === 'color' || !url.includes('/api/assets/')) return url
    return url.replace(/\/renditions\/[^/?]+/, tier === 'thumb-256' ? '/renditions/thumbnail' : '/renditions/preview')
}

export function makeIndexedImage(node: ImageCanvasNode, worldPosition: WorldPosition): IndexedImage {
    return {
        minX: worldPosition.x,
        minY: worldPosition.y,
        maxX: worldPosition.x + node.dimensions.width,
        maxY: worldPosition.y + node.dimensions.height,
        nodeId: node.nodeId,
    }
}

// =============================================================================
// PIXI edge renderer types
// =============================================================================

export type PixiEdgeArrow = {
    // World-space attachment point on the already-offset connector path.
    x: number
    y: number
    // Direction the arrowhead points (into the node it touches)
    // left anchor = Math.PI, right = 0, top = -Math.PI/2, bottom = Math.PI/2
    angle: number
    // Configured arrowhead width in final screen pixels before the viewport
    // curve is applied by `pixiEdgeRenderer`. This must not be inverse-scaled
    // in `WorkspaceConnectionManager`.
    baseScreenSize: number
    // Compatibility alias for older source-shape checks and consumers. New
    // rendering code should read `baseScreenSize`.
    size: number
}

export type PixiEdgeRenderDatum = {
    id: string
    svgPath: string     // SVG path string in world coordinates
    strokeColor: string
    // Configured stroke width in final screen pixels before the viewport curve
    // is applied by `pixiEdgeRenderer`. The edge layer is screen-space, so the
    // renderer, not the connection manager, owns the final stroke scaling.
    baseScreenStrokeWidth: number
    // Compatibility alias for older source-shape checks and consumers. New
    // rendering code should read `baseScreenStrokeWidth`.
    strokeWidth: number
    isDashed: boolean
    arrowEnd: PixiEdgeArrow | null
    arrowStart: PixiEdgeArrow | null
}

export function getVisibleWorldRect(
    viewport: CanvasViewport,
    paneSize: { width: number; height: number },
    margin: number
): Omit<IndexedImage, 'nodeId'> {
    return {
        minX: (-viewport.x / viewport.zoom) - margin,
        minY: (-viewport.y / viewport.zoom) - margin,
        maxX: ((paneSize.width - viewport.x) / viewport.zoom) + margin,
        maxY: ((paneSize.height - viewport.y) / viewport.zoom) + margin,
    }
}
