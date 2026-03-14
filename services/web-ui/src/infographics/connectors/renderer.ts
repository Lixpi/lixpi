// Core connector rendering engine
// Coordinates nodes, edges, and markers using D3 and XYFlow utilities

import '$src/infographics/connectors/connectors.scss'
import { select } from 'd3-selection'
import type {
    ConnectorConfig,
    ConnectorRenderer,
    ConnectorState,
    NodeConfig,
    EdgeConfig,
    NodeAnchors,
    AnchorPosition,
    MarkerType,
    EdgeAnchor
} from '$src/infographics/connectors/types.ts'
import { createMarkers, getMarkerUrl } from '$src/infographics/connectors/markers.ts'
import { computePath, applyOffset } from '$src/infographics/connectors/paths.ts'

// Compute anchor points for a node based on its shape and dimensions
// These are the default center positions for each side
function computeNodeAnchors(node: NodeConfig): NodeAnchors {
    const { x, y, width, height, anchorOverrides } = node
    const centerX = x + width / 2
    const centerY = y + height / 2

    const anchors: NodeAnchors = {
        nodeId: node.id,
        left: { x, y: centerY },
        right: { x: x + width, y: centerY },
        top: { x: centerX, y },
        bottom: { x: centerX, y: y + height },
        center: { x: centerX, y: centerY }
    }

    if (anchorOverrides) {
        if (anchorOverrides.left) anchors.left = anchorOverrides.left
        if (anchorOverrides.right) anchors.right = anchorOverrides.right
        if (anchorOverrides.top) anchors.top = anchorOverrides.top
        if (anchorOverrides.bottom) anchors.bottom = anchorOverrides.bottom
        if (anchorOverrides.center) anchors.center = anchorOverrides.center
    }

    return anchors
}

// Compute anchor coordinate for an edge anchor, supporting flexible positioning via 't' parameter
// t=0 is start of side, t=1 is end of side, t=0.5 (default) is center
function computeAnchorCoordinate(
    anchor: EdgeAnchor,
    node: NodeConfig
): { x: number; y: number } {
    const { x, y, width, height } = node
    const t = anchor.t ?? 0.5  // Default to center

    let coord: { x: number; y: number }

    switch (anchor.position) {
        case 'left':
            // Left side: x is fixed, y varies from top (t=0) to bottom (t=1)
            coord = { x, y: y + height * t }
            break
        case 'right':
            // Right side: x is fixed at right edge, y varies from top (t=0) to bottom (t=1)
            coord = { x: x + width, y: y + height * t }
            break
        case 'top':
            // Top side: y is fixed, x varies from left (t=0) to right (t=1)
            coord = { x: x + width * t, y }
            break
        case 'bottom':
            // Bottom side: y is fixed at bottom, x varies from left (t=0) to right (t=1)
            coord = { x: x + width * t, y: y + height }
            break
        case 'center':
        default:
            coord = { x: x + width / 2, y: y + height / 2 }
            break
    }

    return coord
}

// Render a single node using D3
function renderNode(
    gNodes: ConnectorState['gNodes'],
    node: NodeConfig
): void {
    const { id, shape, x, y, width, height, radius, className, content, disabled, pathData } = node
    const classes = [
        'connector-node',     // internal base (connector-specific)
        'shape-node',         // neutral base for shape styling (non-connector)
        className || '',
        disabled ? 'connector-node-disabled' : '',
        disabled ? 'is-disabled' : ''
    ].filter(Boolean).join(' ')

    switch (shape) {
        case 'rect': {
            gNodes.append('rect')
                .attr('id', `node-${id}`)
                .attr('x', x)
                .attr('y', y)
                .attr('width', width)
                .attr('height', height)
                .attr('rx', radius ?? 0)
                .attr('class', classes)
            break
        }

        case 'circle': {
            const r = radius ?? Math.min(width, height) / 2
            const cx = x + width / 2
            const cy = y + height / 2
            gNodes.append('circle')
                .attr('id', `node-${id}`)
                .attr('cx', cx)
                .attr('cy', cy)
                .attr('r', r)
                .attr('class', classes)
            break
        }

        case 'foreignObject': {
            gNodes.append('foreignObject')
                .attr('id', `node-${id}`)
                .attr('x', x)
                .attr('y', y)
                .attr('width', width)
                .attr('height', height)
                .attr('class', classes)
            break
        }

        case 'path': {
            if (!pathData) {
                console.warn(`[Connector] Missing pathData for node ${id}`)
                break
            }
            gNodes.append('path')
                .attr('id', `node-${id}`)
                .attr('d', pathData)
                .attr('class', classes)
            break
        }
    }

    // Render content if provided
    if (content) {
        const centerX = x + width / 2
        const centerY = y + height / 2

        switch (content.type) {
            case 'text': {
                const textAnchor = content.align ?? 'middle'
                let anchor: 'start' | 'middle' | 'end'
                switch (textAnchor) {
                    case 'start':
                        anchor = 'start'
                        break
                    case 'end':
                        anchor = 'end'
                        break
                    default:
                        anchor = 'middle'
                }

                gNodes.append('text')
                    .attr('x', centerX + (content.dx ?? 0))
                    .attr('y', centerY + (content.dy ?? 0))
                    .attr('class', `connector-text ${content.className || ''}`)
                    .attr('text-anchor', anchor)
                    .attr('dominant-baseline', 'middle')
                    .text(content.text)
                break
            }

            case 'html': {
                // If shape is already foreignObject, use the existing one
                let foreignObject
                if (shape === 'foreignObject') {
                    foreignObject = gNodes.select(`#node-${id}`)
                } else {
                    // Otherwise create a new foreignObject for the html content
                    foreignObject = gNodes.append('foreignObject')
                        .attr('x', x)
                        .attr('y', y)
                        .attr('width', width)
                        .attr('height', height)
                }

                foreignObject.append('xhtml:div')
                    .attr('class', content.className || '')
                    .html(content.html)
                break
            }

            case 'lines': {
                const paddingX = content.padding?.x ?? 12
                const paddingY = content.padding?.y ?? 12
                const availableHeight = height - paddingY * 2
                const spacingScale = content.spacingScale ?? 1
                const lineSpacing = content.count > 1 ? (availableHeight / (content.count - 1)) * spacingScale : 0
                const lineClass = `connector-content-line ${content.className || ''} ${disabled ? 'connector-content-line-disabled' : ''}`.trim()

                for (let i = 0; i < content.count; i += 1) {
                    const lineY = y + paddingY + lineSpacing * i
                    gNodes.append('line')
                        .attr('x1', x + paddingX)
                        .attr('y1', lineY)
                        .attr('x2', x + width - paddingX)
                        .attr('y2', lineY)
                        .attr('class', lineClass)
                }
                break
            }

            case 'icon': {
                // If shape is already foreignObject, use the existing one
                let foreignObject
                if (shape === 'foreignObject') {
                    foreignObject = gNodes.select(`#node-${id}`)
                } else {
                    // Otherwise create a new foreignObject for the icon
                    foreignObject = gNodes.append('foreignObject')
                        .attr('x', x)
                        .attr('y', y)
                        .attr('width', width)
                        .attr('height', height)
                }

                foreignObject.append('xhtml:div')
                    .attr('class', `connector-icon ${content.className || ''}`)
                    .html(content.icon)
                break
            }
        }
    }
}

// Pre-compute edge path and styling data for D3 data join rendering
// Returns computed render data without creating DOM elements
type EdgeRenderDatum = {
    id: string
    path: string
    className: string
    strokeWidth: number
    markerEnd: string | undefined
    markerStart: string | undefined
    strokeDasharray: string | null
}

function computeEdgeRenderData(
    edge: EdgeConfig,
    nodes: Map<string, NodeConfig>,
    anchors: Map<string, NodeAnchors>,
    instanceId: string
): EdgeRenderDatum | null {
    const {
        id,
        source,
        target,
        pathType = 'bezier',
        className,
        marker = 'none',
        markerStart,
        markerSize = 7,
        markerOffset = {},
        curvature = 0.25,
        borderRadius = 24,
        lineStyle = 'solid',
        strokeWidth = 1.2,
        strokeDasharray,
        bendPoints,
        laneIndex = 0,
        laneCount = 1
    } = edge

    const sourceMarkerOffset = markerOffset.source ?? 5
    const targetMarkerOffset = markerOffset.target ?? 5

    const sourceNodeConfig = nodes.get(source.nodeId)
    const targetNodeConfig = nodes.get(target.nodeId)

    if (!sourceNodeConfig || !targetNodeConfig) {
        console.warn(`[Connector] Missing node for edge ${id}: source=${source.nodeId}, target=${target.nodeId}`)
        return null
    }

    const sourceAnchor = computeAnchorCoordinate(source, sourceNodeConfig)
    const targetAnchor = computeAnchorCoordinate(target, targetNodeConfig)

    let sourceCoords = applyOffset(sourceAnchor.x, sourceAnchor.y, source.offset)
    let targetCoords = applyOffset(targetAnchor.x, targetAnchor.y, target.offset)

    if (sourceMarkerOffset > 0) {
        switch (source.position) {
            case 'right':
                sourceCoords = { x: sourceCoords.x + sourceMarkerOffset, y: sourceCoords.y }
                break
            case 'left':
                sourceCoords = { x: sourceCoords.x - sourceMarkerOffset, y: sourceCoords.y }
                break
            case 'top':
                sourceCoords = { x: sourceCoords.x, y: sourceCoords.y - sourceMarkerOffset }
                break
            case 'bottom':
                sourceCoords = { x: sourceCoords.x, y: sourceCoords.y + sourceMarkerOffset }
                break
        }
    }

    if (targetMarkerOffset > 0) {
        switch (target.position) {
            case 'right':
                targetCoords = { x: targetCoords.x + targetMarkerOffset, y: targetCoords.y }
                break
            case 'left':
                targetCoords = { x: targetCoords.x - targetMarkerOffset, y: targetCoords.y }
                break
            case 'top':
                targetCoords = { x: targetCoords.x, y: targetCoords.y - targetMarkerOffset }
                break
            case 'bottom':
                targetCoords = { x: targetCoords.x, y: targetCoords.y + targetMarkerOffset }
                break
        }
    }

    const { path } = computePath(
        pathType,
        sourceCoords.x,
        sourceCoords.y,
        targetCoords.x,
        targetCoords.y,
        source.position,
        target.position,
        curvature,
        borderRadius,
        bendPoints,
        nodes,
        source.nodeId,
        target.nodeId,
        laneIndex,
        laneCount
    )

    const markerEndUrl = getMarkerUrl(marker, instanceId, markerSize)
    const markerStartUrl = markerStart ? getMarkerUrl(markerStart, instanceId, markerSize) : undefined

    let computedDasharray: string | null = null
    if (strokeDasharray) {
        computedDasharray = strokeDasharray
    } else if (lineStyle === 'dashed') {
        computedDasharray = '6 8'
    }

    return {
        id,
        path,
        className: `connector-edge ${className || ''}`,
        strokeWidth,
        markerEnd: markerEndUrl,
        markerStart: markerStartUrl,
        strokeDasharray: computedDasharray
    }
}

// Create a connector renderer instance
// Returns public API for managing and rendering nodes and edges
export function createConnectorRenderer(config: ConnectorConfig): ConnectorRenderer {
    const { container, width, height, instanceId = `conn-${Math.random().toString(36).substr(2, 9)}` } = config

    // Initialize state
    const state: ConnectorState = {
        svg: null as any,
        defs: null as any,
        gEdges: null as any,
        gNodes: null as any,
        nodes: new Map(),
        edges: new Map(),
        anchors: new Map(),
        instanceId
    }

    // Initialize SVG structure
    function init() {
        // Clear container
        select(container).selectAll('*').remove()

        // Create SVG
        state.svg = select(container)
            .append('svg')
            .attr('class', 'connector-svg')
            .attr('viewBox', `0 0 ${width} ${height}`)
            .attr('width', '100%')
            .attr('height', height)

        // Create defs for markers
        state.defs = state.svg.append('defs')

        // Create groups for edges and nodes (edges rendered first so they appear behind nodes)
        state.gEdges = state.svg.append('g').attr('class', 'connector-edges')
        state.gNodes = state.svg.append('g').attr('class', 'connector-nodes')
    }

    // Initialize on creation
    init()

    // Public API
    const api: ConnectorRenderer = {
        addNode(node: NodeConfig) {
            state.nodes.set(node.id, node)
            state.anchors.set(node.id, computeNodeAnchors(node))
        },

        addEdge(edge: EdgeConfig) {
            state.edges.set(edge.id, edge)
        },

        removeNode(nodeId: string) {
            state.nodes.delete(nodeId)
            state.anchors.delete(nodeId)
            // Remove edges connected to this node
            for (const [edgeId, edge] of state.edges) {
                if (edge.source.nodeId === nodeId || edge.target.nodeId === nodeId) {
                    state.edges.delete(edgeId)
                }
            }
        },

        removeEdge(edgeId: string) {
            state.edges.delete(edgeId)
        },

        updateNode(nodeId: string, updates: Partial<NodeConfig>) {
            const existing = state.nodes.get(nodeId)
            if (existing) {
                const updated = { ...existing, ...updates }
                state.nodes.set(nodeId, updated)
                state.anchors.set(nodeId, computeNodeAnchors(updated))
            }
        },

        updateEdge(edgeId: string, updates: Partial<EdgeConfig>) {
            const existing = state.edges.get(edgeId)
            if (existing) {
                state.edges.set(edgeId, { ...existing, ...updates })
            }
        },

        clear() {
            state.nodes.clear()
            state.edges.clear()
            state.anchors.clear()
            // SVG structure preserved — data join in render() handles DOM cleanup
        },

        render() {
            // Update markers in defs (few elements, simple rebuild is fine)
            state.defs.selectAll('*').remove()

            const markerConfigs = new Map<string, { type: MarkerType; size: number }>()
            for (const edge of state.edges.values()) {
                const size = edge.markerSize || 7
                if (edge.marker && edge.marker !== 'none') {
                    markerConfigs.set(`${edge.marker}-${size}`, { type: edge.marker, size })
                }
                if (edge.markerStart && edge.markerStart !== 'none') {
                    markerConfigs.set(`${edge.markerStart}-${size}`, { type: edge.markerStart, size })
                }
            }

            for (const { type, size } of markerConfigs.values()) {
                createMarkers(state.defs, state.instanceId, [type], size)
            }

            // Render nodes using D3 data join — reuse DOM elements across frames
            const nodesArray = Array.from(state.nodes.values())
            state.gNodes.selectAll<SVGGElement, NodeConfig>('g.connector-node-group')
                .data(nodesArray, (d: NodeConfig) => d.id)
                .join(
                    enter => {
                        const g = enter.append('g').attr('class', 'connector-node-group')
                        g.each(function (this: SVGGElement, d: NodeConfig) {
                            renderNode(select(this) as any, d)
                        })
                        return g
                    },
                    update => {
                        update.each(function (this: SVGGElement, d: NodeConfig) {
                            const g = select(this)
                            g.selectAll('*').remove()
                            renderNode(g as any, d)
                        })
                        return update
                    },
                    exit => exit.remove()
                )

            // Render edges using D3 data join — path elements persist across frames
            const edgesData: EdgeRenderDatum[] = []
            for (const edge of state.edges.values()) {
                const result = computeEdgeRenderData(edge, state.nodes, state.anchors, state.instanceId)
                if (result) edgesData.push(result)
            }

            state.gEdges.selectAll<SVGPathElement, EdgeRenderDatum>('path.connector-edge')
                .data(edgesData, (d: EdgeRenderDatum) => d.id)
                .join(
                    enter => enter.append('path')
                        .attr('stroke-linecap', 'round')
                        .attr('stroke-linejoin', 'round')
                )
                .attr('id', (d: EdgeRenderDatum) => `edge-${d.id}`)
                .attr('class', (d: EdgeRenderDatum) => d.className)
                .attr('d', (d: EdgeRenderDatum) => d.path)
                .style('stroke-width', (d: EdgeRenderDatum) => `${d.strokeWidth}px`)
                .attr('marker-end', (d: EdgeRenderDatum) => d.markerEnd ?? null)
                .attr('marker-start', (d: EdgeRenderDatum) => d.markerStart ?? null)
                .attr('stroke-dasharray', (d: EdgeRenderDatum) => d.strokeDasharray)
        },

        destroy() {
            select(container).selectAll('*').remove()
            state.nodes.clear()
            state.edges.clear()
            state.anchors.clear()
        },

        getNode(nodeId: string) {
            return state.nodes.get(nodeId)
        },

        getEdge(edgeId: string) {
            return state.edges.get(edgeId)
        },

        getAnchor(nodeId: string, position: AnchorPosition) {
            return state.anchors.get(nodeId)?.[position]
        }
    }

    return api
}
