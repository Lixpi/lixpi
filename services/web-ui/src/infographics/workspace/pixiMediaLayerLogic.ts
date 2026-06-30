import type {
    CanvasNode,
    CanvasViewport,
    ImageCanvasNode,
} from '@lixpi/constants'

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

// Walks a node's parent chain and returns its absolute world position.
// Context-region children store `position` relative to their parent; PIXI
// renders sprites in world coordinates, so it must accumulate parent offsets
// the same way the DOM rendering does (via `getNodeWorldPosition`).
export function computeWorldPosition(
    node: CanvasNode,
    nodesById: Map<string, CanvasNode>
): WorldPosition {
    let x = 0
    let y = 0
    const visited = new Set<string>()
    let current: CanvasNode | undefined = node
    while (current) {
        if (visited.has(current.nodeId)) break
        visited.add(current.nodeId)
        x += current.position.x
        y += current.position.y
        const parentId = current.parentId
        if (!parentId) break
        current = nodesById.get(parentId)
    }
    return { x, y }
}

export function buildNodesById(nodes: ReadonlyArray<CanvasNode>): Map<string, CanvasNode> {
    return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
}

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
    if (!imageUrl) return transparentPixel
    if (imageUrl.startsWith('data:')) return imageUrl
    if (imageUrl.startsWith('/api/')) return `${apiBaseUrl}${imageUrl}${token ? `?token=${token}` : ''}`
    return imageUrl
}

export function isStoredImageSrc(src: string): boolean {
    const stripped = src.replace(/[?&]token=[^&]+/, '')
    return stripped.startsWith('/api/') || (stripped.startsWith('http') && stripped.includes('/api/files/'))
}

export function resolveStoredImagePath(node: ImageCanvasNode, workspaceId: string): string {
    const strippedSrc = node.src.replace(/[?&]token=[^&]+/, '')
    return isStoredImageSrc(strippedSrc)
        ? `/api/files/${workspaceId}/${node.fileId}`
        : strippedSrc
}

export function getPixiLodTier(zoom: number): LodTier {
    if (zoom < 0.1) return 'color'
    if (zoom < 0.4) return 'thumb-256'
    if (zoom < 1) return 'thumb-1024'
    return 'full'
}

export function addPixiLodSizeParam(url: string, tier: LodTier): string {
    if (tier === 'full' || tier === 'color') return url
    if (!url.includes('/api/files/')) return url

    try {
        const parsed = new URL(url, window.location.origin)
        parsed.searchParams.set('size', tier === 'thumb-256' ? '256' : '1024')
        return parsed.toString()
    } catch {
        return url
    }
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
