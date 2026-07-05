// Type definitions for connector path math and shared infographic node data.

// Position anchor point on a node's perimeter
// Matches XYFlow's Position enum but as union type for flexibility
export type AnchorPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'

// Path rendering strategy
export type PathType =
    | 'bezier'              // XYFlow getBezierPath (curved, respects Position)
    | 'straight'            // XYFlow getStraightPath (direct line)
    | 'smoothstep'          // XYFlow getSmoothStepPath (orthogonal with rounded corners)
    | 'horizontal-bezier'   // Custom symmetric S-curve for horizontal flows
    | 'orthogonal'          // Circuit board style: horizontal → vertical → horizontal with rounded corners

// Marker (arrowhead) style
export type MarkerType = 'arrowhead' | 'arrowhead-muted' | 'arrowhead-selected' | 'none'

// Base anchor point for edge connections
export type EdgeAnchor = {
    nodeId: string
    position: AnchorPosition
    t?: number                               // Position along the side (0=start, 1=end, 0.5=center). Default: 0.5
    offset?: { x?: number; y?: number }      // Fine-tune anchor position in pixels
}

// Edge configuration with source/target and styling
export type EdgeConfig = {
    id: string
    source: EdgeAnchor
    target: EdgeAnchor
    pathType?: PathType
    marker?: MarkerType
    markerStart?: MarkerType    // Marker at the start of the edge (for bidirectional arrows)
    curvature?: number           // For bezier/smoothstep paths (default: 0.25)
    borderRadius?: number        // For orthogonal paths corner rounding (default: 8)
    lineStyle?: 'solid' | 'dashed'  // Line style (default: 'solid')
    bendPoints?: Array<{ x: number; y: number }>  // elkjs-computed waypoints for orthogonal routing
    laneIndex?: number           // Index within edges sharing same target (for vertical lane ordering)
    laneCount?: number           // Total edges sharing same target
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

// Path computation result
export type ComputedPath = {
    path: string            // SVG path string
    labelX: number          // X coordinate for label
    labelY: number          // Y coordinate for label
    offsetX: number         // X offset from source
    offsetY: number         // Y offset from source
}
