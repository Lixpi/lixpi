// Type definitions for the connector/infographics system
// Provides reusable abstractions for drawing connections between visual nodes

import type { Position } from '@xyflow/system'
import type { Selection } from 'd3-selection'

// Position anchor point on a node's perimeter
// Matches XYFlow's Position enum but as union type for flexibility
export type AnchorPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'

// Path rendering strategy
export type PathType =
    | 'bezier'              // XYFlow getBezierPath (curved, respects Position)
    | 'straight'            // XYFlow getStraightPath (direct line)
    | 'smoothstep'          // XYFlow getSmoothStepPath (orthogonal with rounded corners)
    | 'horizontal-bezier'   // Custom symmetric S-curve for horizontal flows

// Marker (arrowhead) style
export type MarkerType = 'arrowhead' | 'arrowhead-muted' | 'circle' | 'none'

// Base anchor point for edge connections
export type EdgeAnchor = {
    nodeId: string
    position: AnchorPosition
    offset?: { x?: number; y?: number }  // Fine-tune anchor position
}

// Edge configuration with source/target and styling
export type EdgeConfig = {
    id: string
    source: EdgeAnchor
    target: EdgeAnchor
    pathType?: PathType
    className?: string
    marker?: MarkerType
    markerStart?: MarkerType    // Marker at the start of the edge (for bidirectional arrows)
    markerSize?: number          // Arrowhead size in pixels (default: 7)
    markerOffset?: { source?: number; target?: number }  // Gap between edge end and node (default: 5 for both)
    curvature?: number           // For bezier/smoothstep paths (default: 0.25)
    lineStyle?: 'solid' | 'dashed'  // Line style (default: 'solid')
    strokeWidth?: number         // Line thickness in pixels (default: 1.2)
    strokeDasharray?: string     // For custom dash patterns (overrides lineStyle if provided)
}

export type NodeShape = 'rect' | 'circle' | 'foreignObject' | 'path'

export type NodeAnchorOverride = Partial<Record<AnchorPosition, { x: number; y: number }>>

// Node content types
export type NodeContent =
    | { type: 'text'; text: string; className?: string; align?: 'middle' | 'start' | 'end'; dx?: number; dy?: number }
    | { type: 'html'; html: string; className?: string }
    | { type: 'lines'; count: number; className?: string; padding?: { x: number; y: number }; spacingScale?: number }
    | { type: 'icon'; icon: string; className?: string }

// Visual node configuration
export type NodeConfig = {
    id: string
    shape: NodeShape
    x: number
    y: number
    width: number
    height: number
    radius?: number         // For rounded rect corners or circle radius
    pathData?: string        // For path-based shapes
    className?: string
    content?: NodeContent
    disabled?: boolean      // Applies disabled styling
    anchorOverrides?: NodeAnchorOverride
}

// Computed anchor coordinates for a node
export type NodeAnchors = {
    nodeId: string
    left: { x: number; y: number }
    right: { x: number; y: number }
    top: { x: number; y: number }
    bottom: { x: number; y: number }
    center: { x: number; y: number }
}

// Configuration for the connector renderer
export type ConnectorConfig = {
    container: HTMLElement
    width: number
    height: number
    instanceId?: string     // Unique ID for marker definitions (auto-generated if omitted)
}

// Internal state for the connector renderer
export type ConnectorState = {
    svg: Selection<SVGSVGElement, unknown, null, undefined>
    defs: Selection<SVGDefsElement, unknown, null, undefined>
    gEdges: Selection<SVGGElement, unknown, null, undefined>
    gNodes: Selection<SVGGElement, unknown, null, undefined>
    nodes: Map<string, NodeConfig>
    edges: Map<string, EdgeConfig>
    anchors: Map<string, NodeAnchors>
    instanceId: string
}

// Public API for the connector renderer
export type ConnectorRenderer = {
    addNode: (node: NodeConfig) => void
    addEdge: (edge: EdgeConfig) => void
    removeNode: (nodeId: string) => void
    removeEdge: (edgeId: string) => void
    updateNode: (nodeId: string, updates: Partial<NodeConfig>) => void
    updateEdge: (edgeId: string, updates: Partial<EdgeConfig>) => void
    clear: () => void
    render: () => void
    destroy: () => void
    getNode: (nodeId: string) => NodeConfig | undefined
    getEdge: (edgeId: string) => EdgeConfig | undefined
    getAnchor: (nodeId: string, position: AnchorPosition) => { x: number; y: number } | undefined
}

// Path computation result
export type ComputedPath = {
    path: string            // SVG path string
    labelX: number          // X coordinate for label
    labelY: number          // Y coordinate for label
    offsetX: number         // X offset from source
    offsetY: number         // Y offset from source
}
