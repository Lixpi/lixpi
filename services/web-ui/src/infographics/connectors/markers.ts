// Marker (arrowhead) creation and management utilities
// Abstracts SVG marker definitions for reusable edge decorations

import type { Selection } from 'd3-selection'
import type { MarkerType } from './types.ts'

import { arrowRightIcon } from '$src/svgIcons/index.ts'

// Extract the <path d="..."> from an SVG string
function extractPathD(svg: string): string {
    const match = svg.match(/<path[^>]*d="([^"]+)"/i)
    if (!match) {
        throw new Error('Failed to extract path from SVG icon')
    }
    return match[1]
}

const ARROW_RIGHT_ICON_D = extractPathD(arrowRightIcon)

// Marker configuration for a specific marker type
type MarkerConfig = {
    id: string
    markerWidth: number
    markerHeight: number
    viewBox: string
    refX: number
    refY: number
    className: string
    path: string  // SVG path or polyline points
}

// Get marker configuration for a specific marker type
function getMarkerConfig(type: MarkerType, instanceId: string, size: number = 7): MarkerConfig | null {
    switch (type) {
        case 'arrowhead':
            return {
                id: `${instanceId}-arrowhead-${size}`,
                markerWidth: size,
                markerHeight: size,
                viewBox: '0 0 256 256',       // native icon viewBox
                refX: 48,                      // line terminates at arrow BASE (left edge)
                refY: 128,                     // center vertically
                className: 'connector-arrowhead',
                path: ARROW_RIGHT_ICON_D
            }

        case 'arrowhead-muted':
            return {
                id: `${instanceId}-arrowhead-muted-${size}`,
                markerWidth: size,
                markerHeight: size,
                viewBox: '0 0 256 256',
                refX: 48,                      // line terminates at arrow BASE
                refY: 128,
                className: 'connector-arrowhead-muted',
                path: ARROW_RIGHT_ICON_D
            }

        case 'circle':
            return {
                id: `${instanceId}-circle`,
                markerWidth: 8,
                markerHeight: 8,
                viewBox: '-5 -5 10 10',
                refX: 0,
                refY: 0,
                className: 'connector-marker-circle',
                path: 'M 0,0 m -2.5,0 a 2.5,2.5 0 1,0 5,0 a 2.5,2.5 0 1,0 -5,0'  // smaller circle
            }

        case 'none':
        default:
            return null
    }
}

// Create marker definitions in SVG defs element
// defs - D3 selection of the defs element
// instanceId - Unique instance identifier for marker IDs
// types - Array of marker types to create
// size - Optional marker size (default: 7)
export function createMarkers(
    defs: Selection<SVGDefsElement, unknown, null, undefined>,
    instanceId: string,
    types: MarkerType[],
    size: number = 7
): void {
    types.forEach(type => {
        if (type === 'none') return

        const config = getMarkerConfig(type, instanceId, size)
        if (!config) return

        const marker = defs.append('marker')
            .attr('id', config.id)
            .attr('class', 'connector-marker')
            .attr('markerWidth', config.markerWidth)
            .attr('markerHeight', config.markerHeight)
            .attr('viewBox', config.viewBox)
            .attr('orient', 'auto')
            .attr('refX', config.refX)
            .attr('refY', config.refY)
            // Use absolute pixel sizing so marker does not bloat with stroke width
            .attr('markerUnits', 'userSpaceOnUse')

        // All markers now use path elements for consistent rendering
        marker.append('path')
            .attr('d', config.path)
            .attr('class', config.className)
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round')
    })
}

// Get the marker URL reference for use in SVG path elements
// Returns URL reference string like "url(#instance-arrowhead-7)" or undefined for 'none'
export function getMarkerUrl(type: MarkerType, instanceId: string, size: number = 7): string | undefined {
    if (type === 'none') return undefined
    const config = getMarkerConfig(type, instanceId, size)
    return config ? `url(#${config.id})` : undefined
}

// Get all unique marker types from a collection of edges
// Useful for determining which markers need to be created
export function collectMarkerTypes(edges: Iterable<{ marker?: MarkerType }>): MarkerType[] {
    const types = new Set<MarkerType>()
    for (const edge of edges) {
        if (edge.marker && edge.marker !== 'none') {
            types.add(edge.marker)
        }
    }
    return Array.from(types)
}
