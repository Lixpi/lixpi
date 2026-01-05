// Path building utilities wrapping XYFlow edge utilities
// Provides both XYFlow standard paths and custom path types

import { getBezierPath, getStraightPath, getSmoothStepPath, Position } from '@xyflow/system'
import type { PathType, ComputedPath, AnchorPosition } from '$src/infographics/connectors/types.ts'

// Convert our simplified anchor position to XYFlow's Position enum
function toXYFlowPosition(position: AnchorPosition): Position {
    switch (position) {
        case 'left': return Position.Left
        case 'right': return Position.Right
        case 'top': return Position.Top
        case 'bottom': return Position.Bottom
        case 'center': return Position.Bottom  // Default to bottom for center
    }
}

// Build a horizontal symmetric S-curve bezier path
// Leaves horizontally from source, transitions in the middle, arrives horizontally at target
// This is the custom path type used in contextSelector for smooth horizontal flows
function buildHorizontalBezierPath(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number
): string {
    // Place both control points at the horizontal midpoint
    const midX = (sourceX + targetX) / 2

    // Control point 1: at midpoint X, source Y (stays horizontal from source)
    const c1x = midX
    const c1y = sourceY

    // Control point 2: at midpoint X, target Y (stays horizontal to target)
    const c2x = midX
    const c2y = targetY

    return `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`
}

// Compute SVG path between two points using specified path type
// Returns computed path with SVG string and label coordinates
export function computePath(
    pathType: PathType,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    sourcePosition: AnchorPosition,
    targetPosition: AnchorPosition,
    curvature: number = 0.25
): ComputedPath {
    switch (pathType) {
        case 'bezier': {
            const [path, labelX, labelY, offsetX, offsetY] = getBezierPath({
                sourceX,
                sourceY,
                sourcePosition: toXYFlowPosition(sourcePosition),
                targetX,
                targetY,
                targetPosition: toXYFlowPosition(targetPosition),
                curvature
            })
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'straight': {
            const [path, labelX, labelY, offsetX, offsetY] = getStraightPath({
                sourceX,
                sourceY,
                targetX,
                targetY
            })
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'smoothstep': {
            const [path, labelX, labelY, offsetX, offsetY] = getSmoothStepPath({
                sourceX,
                sourceY,
                sourcePosition: toXYFlowPosition(sourcePosition),
                targetX,
                targetY,
                targetPosition: toXYFlowPosition(targetPosition),
                borderRadius: 8,  // Default border radius
                offset: 20        // Default orthogonal offset
            })
            return { path, labelX, labelY, offsetX, offsetY }
        }

        case 'horizontal-bezier': {
            const path = buildHorizontalBezierPath(sourceX, sourceY, targetX, targetY)
            // For custom paths, compute label position as midpoint
            const labelX = (sourceX + targetX) / 2
            const labelY = (sourceY + targetY) / 2
            const offsetX = Math.abs(labelX - sourceX)
            const offsetY = Math.abs(labelY - sourceY)
            return { path, labelX, labelY, offsetX, offsetY }
        }

        default:
            // Fallback to straight path
            const [path, labelX, labelY, offsetX, offsetY] = getStraightPath({
                sourceX,
                sourceY,
                targetX,
                targetY
            })
            return { path, labelX, labelY, offsetX, offsetY }
    }
}

// Compute label position for a path (center point)
// Useful for placing text or icons along edges
export function computeLabelPosition(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number
): { x: number; y: number } {
    return {
        x: (sourceX + targetX) / 2,
        y: (sourceY + targetY) / 2
    }
}

// Adjust coordinates with offset
export function applyOffset(
    x: number,
    y: number,
    offset?: { x?: number; y?: number }
): { x: number; y: number } {
    return {
        x: x + (offset?.x ?? 0),
        y: y + (offset?.y ?? 0)
    }
}
