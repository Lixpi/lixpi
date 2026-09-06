import {
    computePath,
    applyOffset,
} from './paths.ts'
import {
    type EdgeConfig,
    type NodeConfig,
    type AnchorPosition,
} from './types.ts'
import {
    type ConnectorRenderDatum,
    type ConnectorArrow,
} from './connector-renderer.ts'

const computeWorldAnchorPoint = (
    position: AnchorPosition,
    t: number,
    node: NodeConfig,
): {
    x: number
    y: number
} => {
    const override = node.anchorOverrides?.[position]

    if (override)
        return override

    const {
        x,
        y,
        width,
        height,
    } = node

    switch (position) {
        case 'left':
            return {
                x,
                y: y + height * t,
            }
        case 'right':
            return {
                x: x + width,
                y: y + height * t,
            }
        case 'top':
            return {
                x: x + width * t,
                y,
            }
        case 'bottom':
            return {
                x: x + width * t,
                y: y + height,
            }
        default:
            return {
                x: x + width / 2,
                y: y + height / 2,
            }
    }
}

const anchorArrowAngle = (position: AnchorPosition): number => {
    // Angle = direction the arrowhead tip points (into the node).
    // left anchor  → edge arrives from the left going rightward  → tip points RIGHT (0)
    // right anchor → edge arrives from the right going leftward  → tip points LEFT  (π)
    // top anchor   → edge arrives from above going downward      → tip points DOWN  (π/2)
    // bottom anchor→ edge arrives from below going upward        → tip points UP    (-π/2)
    switch (position) {
        case 'left':
            return 0
        case 'right':
            return Math.PI
        case 'top':
            return Math.PI / 2
        case 'bottom':
            return -Math.PI / 2
        default:
            return 0
    }
}

export type ConnectorDatumStyle = {
    selected: boolean
    color: string
    selectedColor: string
    strokeWidth: number
    markerSize: number
    markerOffset: {
        source: number
        target: number
    }
    worldMarkerSize: number
    markerBodyLengthFraction: number
}

export const computeConnectorDatum = (
    edgeConfig: EdgeConfig,
    worldNodeMap: Map<string, NodeConfig>,
    style: ConnectorDatumStyle,
): ConnectorRenderDatum | null => {
    const {
        selected: isSelected,
        color: defaultColor,
        selectedColor: focusColor,
        strokeWidth: baseScreenStrokeWidth,
        markerSize: baseScreenMarkerSize,
        markerOffset,
        worldMarkerSize: scaledMarkerSizeWorld,
        markerBodyLengthFraction,
    } = style
    const {
        id,
        source,
        target,
        pathType = 'bezier',
        marker = 'none',
        markerStart,
        curvature = 0.25,
        borderRadius = 24,
        laneIndex = 0,
        laneCount = 1,
        bendPoints,
    } = edgeConfig

    const sourceNode = worldNodeMap.get(source.nodeId)
    const targetNode = worldNodeMap.get(target.nodeId)

    if (
        !sourceNode
        || !targetNode
    )
        return null

    const srcT = source.t ?? 0.5
    const tgtT = target.t ?? 0.5

    const rawSrcAnchor = computeWorldAnchorPoint(
        source.position,
        srcT,
        sourceNode,
    )
    const rawTgtAnchor = computeWorldAnchorPoint(
        target.position,
        tgtT,
        targetNode,
    )

    let srcCoords = applyOffset(
        rawSrcAnchor.x,
        rawSrcAnchor.y,
        source.offset,
    )
    let tgtCoords = applyOffset(
        rawTgtAnchor.x,
        rawTgtAnchor.y,
        target.offset,
    )

    // markerOffset is the pure node↔connector gap and carries NO knowledge of the
    // arrowhead. The arrowhead occupies real length along the line, so when (and
    // only when) an arrow is drawn this component adds that length here — keeping
    // the line's end tucked exactly at the arrow's tail and the arrow tip landing
    // at the same gap as a plain, arrowless endpoint. An endpoint with no arrow
    // (for example, an undecorated endpoint) gets just the base gap, no phantom compensation.
    const arrowLengthWorld = scaledMarkerSizeWorld * markerBodyLengthFraction
    const endArrowComp = marker !== 'none' ? arrowLengthWorld : 0
    const startArrowComp = (
        markerStart
        && markerStart !== 'none'
    )
        ? arrowLengthWorld
        : 0
    const srcOff = (markerOffset.source ?? 5) + startArrowComp
    const tgtOff = (markerOffset.target ?? 5) + endArrowComp

    switch (source.position) {
        case 'right':
            srcCoords = {
                x: srcCoords.x + srcOff,
                y: srcCoords.y,
            }

            break
        case 'left':
            srcCoords = {
                x: srcCoords.x - srcOff,
                y: srcCoords.y,
            }

            break
        case 'top':
            srcCoords = {
                x: srcCoords.x,
                y: srcCoords.y - srcOff,
            }

            break
        case 'bottom':
            srcCoords = {
                x: srcCoords.x,
                y: srcCoords.y + srcOff,
            }

            break
    }

    switch (target.position) {
        case 'right':
            tgtCoords = {
                x: tgtCoords.x + tgtOff,
                y: tgtCoords.y,
            }

            break
        case 'left':
            tgtCoords = {
                x: tgtCoords.x - tgtOff,
                y: tgtCoords.y,
            }

            break
        case 'top':
            tgtCoords = {
                x: tgtCoords.x,
                y: tgtCoords.y - tgtOff,
            }

            break
        case 'bottom':
            tgtCoords = {
                x: tgtCoords.x,
                y: tgtCoords.y + tgtOff,
            }

            break
    }

    const { path: svgPath } = computePath(
        pathType,
        srcCoords.x,
        srcCoords.y,
        tgtCoords.x,
        tgtCoords.y,
        source.position,
        target.position,
        curvature,
        borderRadius,
        bendPoints,
        worldNodeMap,
        source.nodeId,
        target.nodeId,
        laneIndex,
        laneCount,
    )

    const strokeColor = isSelected ? focusColor : defaultColor
    // Connector data deliberately carries stroke and arrow sizes as base screen
    // pixels, not pre-scaled world widths. The renderer is a screen-space drawing
    // layer, so it applies the bounded screen-size curve exactly once while
    // projecting path points from world to screen coordinates.
    const arrowSize = baseScreenMarkerSize

    // Place arrows at the path endpoints (tgtCoords / srcCoords), not at the
    // raw node-edge anchors. The marker-offset gap is already built into those
    // coordinates, matching the SVG marker's refX/refY positioning.
    const arrowEnd: ConnectorArrow | null = marker !== 'none'
        ? {
            x: tgtCoords.x,
            y: tgtCoords.y,
            angle: anchorArrowAngle(target.position),
            baseScreenSize: arrowSize,
        }
        : null

    const arrowStart: ConnectorArrow | null = markerStart
        && markerStart !== 'none'
        ? {
            x: srcCoords.x,
            y: srcCoords.y,
            angle: anchorArrowAngle(source.position),
            baseScreenSize: arrowSize,
        }
        : null

    return {
        id,
        svgPath,
        strokeColor,
        baseScreenStrokeWidth,
        isDashed: edgeConfig.lineStyle === 'dashed',
        arrowEnd,
        arrowStart,
    }
}
