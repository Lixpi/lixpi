'use strict'

import {
	XYHandle,
	ConnectionMode,
	adoptUserNodes,
	updateNodeInternals,
	Position,
	type ConnectionInProgress,
	type Transform,
	type NodeBase,
	type InternalNodeBase,
	type NodeLookup,
	type ParentLookup,
	type HandleType,
	type Connection,
	type Handle,
} from '@xyflow/system'

import {
	computePath,
	applyOffset,
	type EdgeConfig,
	type EdgeAnchor,
	type NodeConfig,
	type AnchorPosition,
} from '$src/infographics/connectors/index.ts'
import type { PixiEdgeRenderDatum, PixiEdgeArrow } from '$src/infographics/workspace/pixiMediaLayerLogic.ts'

import { getAdaptiveBoundedZoomScalingOptions, getEdgeScaledSizes } from '$src/infographics/utils/zoomScaling.ts'
import { applyStyle } from '$src/utils/domTemplates.ts'

import type {
	CanvasNode,
	WorkspaceEdge,
} from '@lixpi/constants'

import { settings } from '$src/settings.ts'

type ProximityCandidate = {
	sourceNodeId: string
	sourceHandle: 'left' | 'right'
	targetNodeId: string
	targetHandle: 'left' | 'right'
	sourceT?: number
	targetT?: number
}

type HandleMeta = {
	nodeId: string
	handleId: string
	isTarget: boolean
	handleDomNode: Element
	edgeUpdaterType?: HandleType
	reconnectingEdgeId?: string
}

type ConnectionManagerConfig = {
	paneEl: HTMLDivElement
	viewportEl: HTMLDivElement
	getTransform: () => Transform
	panBy: ({ x, y }: { x: number; y: number }) => Promise<boolean>
	onEdgesChange: (edges: WorkspaceEdge[]) => void
	onSelectedEdgeChange?: (edgeId: string | null) => void
	railOffset?: number
	onPixiEdgesReady?: (edges: PixiEdgeRenderDatum[]) => void
}

type EdgeNodeGeometry = {
	x: number
	y: number
	width: number
	height: number
}

function generateEdgeId(): string {
	const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
	return `edge-${random}`
}

function toRendererPoint(point: { x: number; y: number }, transform: Transform) {
	return {
		x: (point.x - transform[0]) / transform[2],
		y: (point.y - transform[1]) / transform[2]
	}
}

// =============================================================================
// PIXI edge data helpers — compute world-coordinate edge paths for the GPU renderer
// =============================================================================

function computeWorldAnchorPoint(
	position: AnchorPosition,
	t: number,
	node: NodeConfig
): { x: number; y: number } {
	const override = node.anchorOverrides?.[position]
	if (override) return override

	const { x, y, width, height } = node
	switch (position) {
		case 'left':   return { x, y: y + height * t }
		case 'right':  return { x: x + width, y: y + height * t }
		case 'top':    return { x: x + width * t, y }
		case 'bottom': return { x: x + width * t, y: y + height }
		default:       return { x: x + width / 2, y: y + height / 2 }
	}
}

function anchorArrowAngle(position: AnchorPosition): number {
	// Angle = direction the arrowhead tip points (into the node).
	// left anchor  → edge arrives from the left going rightward  → tip points RIGHT (0)
	// right anchor → edge arrives from the right going leftward  → tip points LEFT  (π)
	// top anchor   → edge arrives from above going downward      → tip points DOWN  (π/2)
	// bottom anchor→ edge arrives from below going upward        → tip points UP    (-π/2)
	switch (position) {
		case 'left':   return 0
		case 'right':  return Math.PI
		case 'top':    return Math.PI / 2
		case 'bottom': return -Math.PI / 2
		default:       return 0
	}
}

function computePixiEdgeDatum(
	edgeConfig: EdgeConfig,
	worldNodeMap: Map<string, NodeConfig>,
	isSelected: boolean,
	defaultColor: string,
	focusColor: string,
	baseScreenStrokeWidth: number,
	baseScreenMarkerSize: number,
	markerOffset: { source: number; target: number }
): PixiEdgeRenderDatum | null {
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
	if (!sourceNode || !targetNode) return null

	const srcT = source.t ?? 0.5
	const tgtT = target.t ?? 0.5

	const rawSrcAnchor = computeWorldAnchorPoint(source.position, srcT, sourceNode)
	const rawTgtAnchor = computeWorldAnchorPoint(target.position, tgtT, targetNode)

	let srcCoords = applyOffset(rawSrcAnchor.x, rawSrcAnchor.y, source.offset)
	let tgtCoords = applyOffset(rawTgtAnchor.x, rawTgtAnchor.y, target.offset)

	const srcOff = markerOffset.source ?? 5
	const tgtOff = markerOffset.target ?? 5

	switch (source.position) {
		case 'right':  srcCoords = { x: srcCoords.x + srcOff, y: srcCoords.y }; break
		case 'left':   srcCoords = { x: srcCoords.x - srcOff, y: srcCoords.y }; break
		case 'top':    srcCoords = { x: srcCoords.x, y: srcCoords.y - srcOff }; break
		case 'bottom': srcCoords = { x: srcCoords.x, y: srcCoords.y + srcOff }; break
	}
	switch (target.position) {
		case 'right':  tgtCoords = { x: tgtCoords.x + tgtOff, y: tgtCoords.y }; break
		case 'left':   tgtCoords = { x: tgtCoords.x - tgtOff, y: tgtCoords.y }; break
		case 'top':    tgtCoords = { x: tgtCoords.x, y: tgtCoords.y - tgtOff }; break
		case 'bottom': tgtCoords = { x: tgtCoords.x, y: tgtCoords.y + tgtOff }; break
	}

	const { path: svgPath } = computePath(
		pathType,
		srcCoords.x, srcCoords.y,
		tgtCoords.x, tgtCoords.y,
		source.position, target.position,
		curvature, borderRadius, bendPoints,
		worldNodeMap, source.nodeId, target.nodeId,
		laneIndex, laneCount
	)

	const strokeColor = isSelected ? focusColor : defaultColor
	// Size matches SVG markerWidth so the PIXI polygon scales identically.
	const arrowSize = baseScreenMarkerSize

	// Place arrows at the path endpoints (tgtCoords / srcCoords), not at the
	// raw node-edge anchors. The marker-offset gap is already built into those
	// coordinates, matching the SVG marker's refX/refY positioning.
	const arrowEnd: PixiEdgeArrow | null = marker !== 'none'
		? { x: tgtCoords.x, y: tgtCoords.y, angle: anchorArrowAngle(target.position), baseScreenSize: arrowSize, size: arrowSize }
		: null

	const arrowStart: PixiEdgeArrow | null = markerStart && markerStart !== 'none'
		? { x: srcCoords.x, y: srcCoords.y, angle: anchorArrowAngle(source.position), baseScreenSize: arrowSize, size: arrowSize }
		: null

	return {
		id,
		svgPath,
		strokeColor,
		baseScreenStrokeWidth,
		strokeWidth: baseScreenStrokeWidth,
		isDashed: edgeConfig.lineStyle === 'dashed',
		arrowEnd,
		arrowStart,
	}
}

export function getEdgeAnchorPositions(edge: WorkspaceEdge): { source: 'left' | 'right'; target: 'left' | 'right' } {
	const source = edge.sourceHandle === 'left' ? 'left' : 'right'
	const target = edge.targetHandle === 'left' ? 'left' : 'right'
	return { source, target }
}

// Compute anchor 't' value based on pointer Y position relative to the node side
// Returns value between 0 (top) and 1 (bottom) for left/right sides
function computeTFromPointerPosition(
	pointerY: number,
	nodeTop: number,
	nodeHeight: number
): number {
	const relativeY = pointerY - nodeTop
	const t = Math.max(0, Math.min(1, relativeY / nodeHeight))
	return t
}

// Image AND video nodes always anchor edges to the middle of their side — no
// pointer/source-Y projection or fan-out spreading — so a connector meets the
// node cleanly at the centre of its left/right edge. (AI chat threads and
// documents still auto-align so stacked branches don't overlap.)
function isMidSideAnchorNode(node: CanvasNode | undefined): boolean {
	return node?.type === 'image' || node?.type === 'video'
}

function resolveEdgeAnchorT(node: CanvasNode | undefined, t: number | undefined): number {
	return isMidSideAnchorNode(node) ? 0.5 : t ?? 0.5
}

function canAutoAlignTargetT(node: CanvasNode | undefined): boolean {
	return Boolean(node && !isMidSideAnchorNode(node))
}

function isSameConnection(
	a: WorkspaceEdge,
	b: { sourceNodeId: string; targetNodeId: string; sourceHandle?: string | null; targetHandle?: string | null }
) {
	return a.sourceNodeId === b.sourceNodeId &&
		a.targetNodeId === b.targetNodeId &&
		(a.sourceHandle ?? null) === (b.sourceHandle ?? null) &&
		(a.targetHandle ?? null) === (b.targetHandle ?? null)
}

type PathPoint = { x: number; y: number }

type PathPointWithTangent = {
	point: PathPoint
	tangent: PathPoint
}

function parsePathNumbers(rawArgs: string): number[] {
	return rawArgs
		.trim()
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number)
		.filter((value) => Number.isFinite(value))
}

function cubicAt(start: number, controlA: number, controlB: number, end: number, progress: number): number {
	const inverse = 1 - progress
	return inverse ** 3 * start + 3 * inverse ** 2 * progress * controlA + 3 * inverse * progress ** 2 * controlB + progress ** 3 * end
}

function quadraticAt(start: number, control: number, end: number, progress: number): number {
	const inverse = 1 - progress
	return inverse ** 2 * start + 2 * inverse * progress * control + progress ** 2 * end
}

function flattenSvgPath(svgPath: string): PathPoint[] {
	const points: PathPoint[] = []
	const commandRegex = /([MmLlHhVvCcQqZz])([^MmLlHhVvCcQqZz]*)/g
	let current: PathPoint = { x: 0, y: 0 }
	let subpathStart: PathPoint = { x: 0, y: 0 }
	let match: RegExpExecArray | null

	const pushPoint = (point: PathPoint): void => {
		current = point
		points.push(point)
	}

	while ((match = commandRegex.exec(svgPath)) !== null) {
		const command = match[1]
		const args = parsePathNumbers(match[2])
		const isRelative = command === command.toLowerCase()
		const absolutePoint = (x: number, y: number): PathPoint => isRelative
			? { x: current.x + x, y: current.y + y }
			: { x, y }

		switch (command.toUpperCase()) {
			case 'M': {
				for (let argIndex = 0; argIndex < args.length; argIndex += 2) {
					const point = absolutePoint(args[argIndex], args[argIndex + 1])
					if (argIndex === 0) {
						current = point
						subpathStart = point
						points.push(point)
					} else {
						pushPoint(point)
					}
				}
				break
			}
			case 'L': {
				for (let argIndex = 0; argIndex < args.length; argIndex += 2) {
					pushPoint(absolutePoint(args[argIndex], args[argIndex + 1]))
				}
				break
			}
			case 'H': {
				for (const rawX of args) {
					pushPoint({ x: isRelative ? current.x + rawX : rawX, y: current.y })
				}
				break
			}
			case 'V': {
				for (const rawY of args) {
					pushPoint({ x: current.x, y: isRelative ? current.y + rawY : rawY })
				}
				break
			}
			case 'C': {
				for (let argIndex = 0; argIndex < args.length; argIndex += 6) {
					const segmentStart = current
					const controlA = absolutePoint(args[argIndex], args[argIndex + 1])
					const controlB = absolutePoint(args[argIndex + 2], args[argIndex + 3])
					const segmentEnd = absolutePoint(args[argIndex + 4], args[argIndex + 5])
					for (let step = 1; step <= 24; step++) {
						const progress = step / 24
						pushPoint({
							x: cubicAt(segmentStart.x, controlA.x, controlB.x, segmentEnd.x, progress),
							y: cubicAt(segmentStart.y, controlA.y, controlB.y, segmentEnd.y, progress),
						})
					}
				}
				break
			}
			case 'Q': {
				for (let argIndex = 0; argIndex < args.length; argIndex += 4) {
					const segmentStart = current
					const control = absolutePoint(args[argIndex], args[argIndex + 1])
					const segmentEnd = absolutePoint(args[argIndex + 2], args[argIndex + 3])
					for (let step = 1; step <= 16; step++) {
						const progress = step / 16
						pushPoint({
							x: quadraticAt(segmentStart.x, control.x, segmentEnd.x, progress),
							y: quadraticAt(segmentStart.y, control.y, segmentEnd.y, progress),
						})
					}
				}
				break
			}
			case 'Z': {
				pushPoint(subpathStart)
				break
			}
		}
	}

	return points
}

function segmentLength(start: PathPoint, end: PathPoint): number {
	return Math.hypot(end.x - start.x, end.y - start.y)
}

function getPathLength(points: PathPoint[]): number {
	let total = 0
	for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
		total += segmentLength(points[pointIndex - 1], points[pointIndex])
	}
	return total
}

function getPointAtPathLength(points: PathPoint[], targetLength: number): PathPointWithTangent | null {
	if (points.length === 0) return null
	if (points.length === 1) return { point: points[0], tangent: { x: 1, y: 0 } }

	let walked = 0
	for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
		const start = points[pointIndex - 1]
		const end = points[pointIndex]
		const length = segmentLength(start, end)
		if (length <= 0) continue

		if (walked + length >= targetLength) {
			const progress = Math.max(0, Math.min(1, (targetLength - walked) / length))
			return {
				point: {
					x: start.x + (end.x - start.x) * progress,
					y: start.y + (end.y - start.y) * progress,
				},
				tangent: { x: end.x - start.x, y: end.y - start.y },
			}
		}

		walked += length
	}

	const start = points[points.length - 2]
	const end = points[points.length - 1]
	return { point: end, tangent: { x: end.x - start.x, y: end.y - start.y } }
}

function getSquaredDistanceToSegment(point: PathPoint, start: PathPoint, end: PathPoint): number {
	const deltaX = end.x - start.x
	const deltaY = end.y - start.y
	const lengthSquared = deltaX * deltaX + deltaY * deltaY
	if (lengthSquared <= 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2

	const progress = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared))
	const closest = {
		x: start.x + progress * deltaX,
		y: start.y + progress * deltaY,
	}

	return (point.x - closest.x) ** 2 + (point.y - closest.y) ** 2
}

function isPointNearPath(point: PathPoint, points: PathPoint[], radius: number): boolean {
	const radiusSquared = radius * radius
	for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
		if (getSquaredDistanceToSegment(point, points[pointIndex - 1], points[pointIndex]) <= radiusSquared) return true
	}
	return false
}

// Compute spread-out t values for edges that share the same node+side
// This prevents multiple edges from converging to the exact same point
// Edges are ordered by the OTHER node's Y position to prevent line crossings
// (higher source Y = lower t on target, so lines don't cross)
// Also computes lane indices for vertical segment ordering
export type SpreadResult = {
	sourceT: number
	targetT: number
	laneIndex: number      // Index within edges sharing same target (0 = topmost source)
	laneCount: number      // Total edges sharing same target
	sourceY: number        // Source node center Y for lane calculation
}

export function computeSpreadTValues(
	edges: WorkspaceEdge[],
	nodes: CanvasNode[]
): Map<string, SpreadResult> {
	const result = new Map<string, SpreadResult>()
	const nodeMap = new Map(nodes.map(n => [n.nodeId, n]))

	// Group edges by source node+side
	const sourceGroups = new Map<string, WorkspaceEdge[]>()
	// Group edges by target node+side
	const targetGroups = new Map<string, WorkspaceEdge[]>()

	for (const edge of edges) {
		const sourceKey = `${edge.sourceNodeId}:${edge.sourceHandle ?? 'right'}`
		const targetKey = `${edge.targetNodeId}:${edge.targetHandle ?? 'left'}`

		if (!sourceGroups.has(sourceKey)) sourceGroups.set(sourceKey, [])
		if (!targetGroups.has(targetKey)) targetGroups.set(targetKey, [])

		sourceGroups.get(sourceKey)!.push(edge)
		targetGroups.get(targetKey)!.push(edge)

		const sourceNode = nodeMap.get(edge.sourceNodeId)
		const targetNode = nodeMap.get(edge.targetNodeId)
		const sourceY = sourceNode ? sourceNode.position.y + sourceNode.dimensions.height / 2 : 0

		// Default to stored T or 0.5
		const sourceT = resolveEdgeAnchorT(sourceNode, edge.sourceT)
		let targetT = resolveEdgeAnchorT(targetNode, edge.targetT)

		// Dynamic auto-align: If source Y hits the target node, FORCE straight line alignment
		// This ensures that even during dragging or node moving, the line attempts to stay straight
		// For off-axis nodes, we clamp to the nearest corner (top/bottom) instead of snapping to center
		if (sourceNode && canAutoAlignTargetT(targetNode)) {
			const targetHeight = targetNode.dimensions.height

			// When the target is shorter than the minimum slide height, snap to center
			if (targetHeight < settings.aiChatThread.rail.minSlideHeight) {
				targetT = 0.5
			} else {
				const targetTop = targetNode.position.y

				// Calculate ideal straight-line projection
				const idealT = (sourceY - targetTop) / targetHeight

				// Clamp to be within the node side (0-1), leaving a configurable margin
				// effectively snapping to the top or bottom corner if the source is outside vertical bounds
				const m = settings.aiChatThread.rail.edgeMargin
				targetT = Math.max(m, Math.min(1 - m, idealT))
			}
		}

		// Initialize with values
		result.set(edge.edgeId, {
			sourceT,
			targetT,
			laneIndex: 0,
			laneCount: 1,
			sourceY
		})
	}

	// Spread source t values for edges sharing the same source node+side
	// Sort by TARGET node's Y position so lines don't cross
	for (const [, group] of sourceGroups) {
		if (group.length <= 1) continue
		if (isMidSideAnchorNode(nodeMap.get(group[0]?.sourceNodeId))) continue

		// Sort by target node Y position (smaller Y = higher on screen = smaller t)
		group.sort((a, b) => {
			const aTarget = nodeMap.get(a.targetNodeId)
			const bTarget = nodeMap.get(b.targetNodeId)
			const aY = aTarget ? aTarget.position.y + aTarget.dimensions.height / 2 : 0
			const bY = bTarget ? bTarget.position.y + bTarget.dimensions.height / 2 : 0
			return aY - bY
		})

		// Spread evenly between 0.35 and 0.65 (subtle spread near center)
		const count = group.length
		const margin = 0.35
		const range = 1 - 2 * margin
		const step = count > 1 ? range / (count - 1) : 0

		for (let i = 0; i < group.length; i++) {
			const edge = group[i]
			const values = result.get(edge.edgeId)!
			values.sourceT = count === 1 ? 0.5 : margin + i * step
		}
	}

	// Spread target t values for edges sharing the same target node+side
	// Sort by SOURCE node's Y position so lines don't cross
	// Also assign lane indices for vertical segment ordering
	for (const [, group] of targetGroups) {
		if (group.length <= 1) continue

		// Sort by source node Y position (smaller Y = higher on screen = smaller t)
		group.sort((a, b) => {
			const aSource = nodeMap.get(a.sourceNodeId)
			const bSource = nodeMap.get(b.sourceNodeId)
			const aY = aSource ? aSource.position.y + aSource.dimensions.height / 2 : 0
			const bY = bSource ? bSource.position.y + bSource.dimensions.height / 2 : 0
			return aY - bY
		})

		// Assign lane indices
		// We DO NOT override targetT here anymore. We prioritize standard straight lines.
		// If lines overlap, laneIndex will separate their vertical segments.
		const count = group.length
		for (let i = 0; i < group.length; i++) {
			const edge = group[i]
			const values = result.get(edge.edgeId)!
			values.laneIndex = i
			values.laneCount = count
		}
	}

	return result
}

// Stable topological sort for canvas nodes by `parentId`. Roots come first,
// then their direct children, then grandchildren, and so on. Stable: original
// relative order is preserved among siblings and within each depth tier.
//
// xyflow's `adoptUserNodes` requires parents to appear before their children
// in the input array; otherwise it logs a "Parent node not found" warning and
// skips the parent linkage for that node.
export function topoSortByParent<T extends { nodeId: string; parentId?: string }>(nodes: T[]): T[] {
	const byId = new Map<string, T>()
	for (const n of nodes) byId.set(n.nodeId, n)

	const sorted: T[] = []
	const visiting = new Set<string>()
	const visited = new Set<string>()

	const visit = (n: T) => {
		if (visited.has(n.nodeId)) return
		if (visiting.has(n.nodeId)) return // cycle guard — emit in original order
		visiting.add(n.nodeId)
		if (n.parentId && byId.has(n.parentId)) {
			visit(byId.get(n.parentId)!)
		}
		visiting.delete(n.nodeId)
		visited.add(n.nodeId)
		sorted.push(n)
	}

	for (const n of nodes) visit(n)
	return sorted
}

export class WorkspaceConnectionManager {
	private readonly config: ConnectionManagerConfig

	private readonly nodeLookup: NodeLookup<InternalNodeBase> = new Map()
	private readonly parentLookup: ParentLookup<InternalNodeBase> = new Map()

	private nodeElements: Map<string, HTMLElement> = new Map()
	private nodes: CanvasNode[] = []
	private edges: WorkspaceEdge[] = []

	private selectedEdgeId: string | null = null
	private connectionInProgress: ConnectionInProgress | null = null

	private reconnectingEdge: { edgeId: string; edgeUpdaterType: HandleType } | null = null

	private proximityCandidate: ProximityCandidate | null = null
	private currentEdgeClickAreaWidth = settings.connector.scaling.clickAreaWidth

	private menuConnectionCleanup: (() => void) | null = null

	private railHeights: Map<string, number> = new Map()

	// Cache for fast synchronous PIXI datum recomputation on zoom change.
	// Avoids the full connectionManager.render() cost when only markerOffset changes.
	private cachedPixiEdgeConfigs: Array<{ edgeConfig: EdgeConfig; isSelected: boolean }> | null = null
	private cachedPixiWorldNodeMap: Map<string, NodeConfig> | null = null
	private cachedPixiEdgeData: PixiEdgeRenderDatum[] = []
	private cachedFlattenedEdgePaths = new Map<string, { svgPath: string; points: PathPoint[] }>()
	private cachedPixiDefaultColor = '#000000'
	private cachedPixiFocusColor = '#000000'

	public setRailHeight(nodeId: string, height: number): void {
		this.railHeights.set(nodeId, height)
	}

	public clearRailHeights(): void {
		this.railHeights.clear()
	}

	public getRailHeight(nodeId: string): number | undefined {
		return this.railHeights.get(nodeId)
	}

	private nodesWithRailHeights(): CanvasNode[] {
		if (this.railHeights.size === 0) return this.nodes
		return this.nodes.map(n => {
			if (n.type !== 'aiChatThread') return n
			const railH = this.railHeights.get(n.nodeId)
			if (railH === undefined) return n
			return { ...n, dimensions: { ...n.dimensions, height: railH } }
		})
	}

	private getEdgeNodeGeometry(node: CanvasNode): EdgeNodeGeometry {
		const railOffset = this.config.railOffset ?? 0
		const xShift = node.type === 'aiChatThread' ? railOffset : 0
		const railHeight = node.type === 'aiChatThread' ? this.railHeights.get(node.nodeId) : undefined

		return {
			x: node.position.x - xShift,
			y: node.position.y,
			width: node.dimensions.width + xShift,
			height: railHeight ?? node.dimensions.height,
		}
	}

	private buildEdgeAnchor(
		nodeId: string,
		position: AnchorPosition,
		t: number | undefined,
		nodeById: Map<string, CanvasNode>
	): EdgeAnchor {
		const node = nodeById.get(nodeId)
		const resolvedT = resolveEdgeAnchorT(node, t)

		return {
			nodeId,
			position,
			t: resolvedT,
		}
	}

	public constructor(config: ConnectionManagerConfig) {
		this.config = config

		// Ensure XYFlow internals can measure zoom from viewport transform
		this.config.viewportEl.classList.add('xyflow__viewport')
	}

	public syncNodes(canvasNodes: CanvasNode[]) {
		this.nodes = canvasNodes

		// xyflow's adoptUserNodes requires parents to appear BEFORE their children in the
		// input array; otherwise it logs a warning and skips parent linkage. Stable
		// topological sort keeps roots first, then children, preserving original order
		// among siblings.
		const sortedCanvasNodes = topoSortByParent(canvasNodes)

		const xyNodes: NodeBase[] = sortedCanvasNodes.map((n) => ({
			id: n.nodeId,
			position: { x: n.position.x, y: n.position.y },
			width: n.dimensions.width,
			height: n.dimensions.height,
			// xyflow-native parent-child fields. When `parentId` is set, `position` is
			// parent-relative; xyflow auto-derives `positionAbsolute`. `expandParent`
			// causes the parent to grow when this child is moved past its bounds.
			...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
			...(n.extent !== undefined ? { extent: n.extent } : {}),
			...(n.expandParent !== undefined ? { expandParent: n.expandParent } : {}),
			// `measured` must be set for XYFlow's parseHandles to preserve existing handleBounds
			measured: { width: n.dimensions.width, height: n.dimensions.height },
			// Provide synthetic handles so XYHandle can find handle bounds
			// for programmatic connection triggers (e.g. bubble menu).
			// Without DOM handle elements, handleBounds would otherwise be empty.
			handles: [
				{ id: 'left', type: 'target' as const, position: Position.Left, x: 0, y: n.dimensions.height / 2, width: 10, height: 10 },
				{ id: 'right', type: 'source' as const, position: Position.Right, x: n.dimensions.width, y: n.dimensions.height / 2, width: 10, height: 10 },
			],
		}))

		adoptUserNodes(xyNodes, this.nodeLookup, this.parentLookup, {
			nodeOrigin: [0, 0],
			elevateNodesOnSelect: false
		})
	}

	public registerNodeElement(nodeId: string, nodeElement: HTMLDivElement) {
		this.nodeElements.set(nodeId, nodeElement)
		const updates = new Map([
			[nodeId, { id: nodeId, nodeElement }]
		])

		updateNodeInternals(
			updates,
			this.nodeLookup,
			this.parentLookup,
			this.config.paneEl,
			[0, 0],
			undefined
		)
	}

	public syncEdges(edges: WorkspaceEdge[]) {
		this.edges = edges
		if (this.selectedEdgeId && !edges.some((e) => e.edgeId === this.selectedEdgeId)) {
			this.selectEdge(null)
		}
	}

	public cancelTransientConnection(): void {
		const hadTransientConnection = Boolean(this.connectionInProgress || this.reconnectingEdge || this.proximityCandidate || this.menuConnectionCleanup)
		const menuCleanup = this.menuConnectionCleanup

		this.menuConnectionCleanup = null
		this.connectionInProgress = null
		this.reconnectingEdge = null
		this.proximityCandidate = null

		if (menuCleanup) {
			menuCleanup()
			return
		}

		if (hadTransientConnection) {
			this.render()
		}
	}

	public startConnectionFromMenu(nodeId: string) {
		// Cancel any existing menu connection
		this.menuConnectionCleanup?.()

		const node = this.nodeLookup.get(nodeId)
		if (!node) {
			return
		}

		const sourceHandle: Handle | null = node.internals.handleBounds?.source?.[0] ?? null
		if (!sourceHandle) {
			return
		}

		const fromPosition = sourceHandle.position ?? Position.Right
		const fromX = (sourceHandle.x ?? 0) + node.internals.positionAbsolute.x + (sourceHandle.width ?? 0) / 2
		const fromY = (sourceHandle.y ?? 0) + node.internals.positionAbsolute.y + (sourceHandle.height ?? 0) / 2

		const from = { x: fromX, y: fromY }

		const fromHandle: Handle = {
			...sourceHandle,
			nodeId,
			type: 'source',
			position: fromPosition,
		}

		// Don't render the in-progress line until the first mousemove.
		// The initial `to` value is a placeholder — displaying it causes a
		// visual glitch where the dashed line extends beyond the cursor due
		// to coordinate-system round-trip imprecision between screen-relative
		// and renderer coordinates. The first mousemove provides exact coords.
		this.connectionInProgress = {
			inProgress: true,
			isValid: null,
			from,
			fromHandle,
			fromPosition,
			fromNode: node,
			to: { x: 0, y: 0 },
			toHandle: null,
			toPosition: Position.Left,
			toNode: null,
		}

		// Change cursor to crosshair on the pane
		applyStyle(this.config.paneEl, { cursor: 'crosshair' })

		const onMouseMove = (e: MouseEvent) => {
			const transform = this.config.getTransform()
			const containerBounds = this.config.paneEl.getBoundingClientRect()
			if (!containerBounds) return

			// Convert screen position to renderer coordinates (accounting for pan + zoom)
			const screenRelX = e.clientX - containerBounds.left
			const screenRelY = e.clientY - containerBounds.top
			const rendererPos = {
				x: (screenRelX - transform[0]) / transform[2],
				y: (screenRelY - transform[1]) / transform[2],
			}

			// Find closest target handle
			const closestHandle = this.findClosestHandle(rendererPos, fromHandle, settings.connector.menuConnectionSnapRadius)

			const isValid = closestHandle ? this.isMenuConnectionValid(nodeId, closestHandle) : null

			this.connectionInProgress = {
				...this.connectionInProgress!,
				isValid,
				to: closestHandle && isValid
					? { x: closestHandle.x, y: closestHandle.y }
					: { x: screenRelX, y: screenRelY },
				toHandle: closestHandle ?? null,
				toPosition: closestHandle?.position ?? Position.Left,
				toNode: closestHandle ? this.nodeLookup.get(closestHandle.nodeId) ?? null : null,
			}

			this.render()
		}

		const onMouseUp = (e: MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()

			const toHandle = this.connectionInProgress?.toHandle
			const toNode = this.connectionInProgress?.toNode
			const isValid = this.connectionInProgress?.isValid

			cleanup()

			if (toHandle && toNode && isValid) {
				const toNodeId = toHandle.nodeId
				const toHandleId = toHandle.id ?? 'left'

				// Compute T values for straight lines when possible
				const sourceT = 0.5
				let targetT = 0.5

				const sourceNode = this.nodes.find(n => n.nodeId === nodeId)
				const targetNode = this.nodes.find(n => n.nodeId === toNodeId)

				if (sourceNode && canAutoAlignTargetT(targetNode)) {
					const sourceY = sourceNode.position.y + sourceNode.dimensions.height * sourceT
					const targetTop = targetNode.position.y
					const targetBottom = targetTop + targetNode.dimensions.height

					if (sourceY >= targetTop && sourceY <= targetBottom) {
						targetT = (sourceY - targetTop) / targetNode.dimensions.height
					}
				}

				const nextEdge: WorkspaceEdge = {
					edgeId: generateEdgeId(),
					sourceNodeId: nodeId,
					targetNodeId: toNodeId,
					sourceHandle: sourceHandle.id ?? 'right',
					targetHandle: toHandleId,
					sourceT,
					targetT,
				}

				this.config.onEdgesChange([...this.edges, nextEdge])
				this.selectEdge(nextEdge.edgeId)
			}
		}

		const onMouseDownCapture = (e: MouseEvent) => {
			// While menu-connection mode is active, suppress target-node mousedown
			// handlers so clicking to finish a connection cannot also start a drag,
			// focus an editor, or otherwise attach the target UI to mouse movement.
			e.preventDefault()
			e.stopPropagation()
		}

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				cleanup()
			}
		}

		const cleanup = () => {
			document.removeEventListener('mousemove', onMouseMove)
			document.removeEventListener('mousedown', onMouseDownCapture, true)
			document.removeEventListener('mouseup', onMouseUp, true)
			document.removeEventListener('keydown', onKeyDown)
			this.connectionInProgress = null
			applyStyle(this.config.paneEl, { cursor: '' })
			this.menuConnectionCleanup = null
			this.render()
		}

		this.menuConnectionCleanup = cleanup

		// Use capture for mouseup so we intercept before other handlers
		document.addEventListener('mousemove', onMouseMove)
		document.addEventListener('mousedown', onMouseDownCapture, true)
		document.addEventListener('mouseup', onMouseUp, true)
		document.addEventListener('keydown', onKeyDown)
	}

	private getMenuSnapPoint(nodeId: string, handle: Handle, pointer: { x: number; y: number }) {
		const node = this.nodeLookup.get(nodeId)
		const canvasNode = this.nodes.find((candidate) => candidate.nodeId === nodeId)

		if (!node || !canvasNode) {
			return {
				x: (handle.x ?? 0),
				y: (handle.y ?? 0),
			}
		}

		const isLeftHandle = (handle.id === 'left') || handle.position === Position.Left
		const railOffset = this.config.railOffset ?? 0
		const railHeight = canvasNode.type === 'aiChatThread'
			? (this.railHeights.get(nodeId) ?? canvasNode.dimensions.height)
			: canvasNode.dimensions.height

		const x = isLeftHandle
			? node.internals.positionAbsolute.x - (canvasNode.type === 'aiChatThread' ? railOffset : 0)
			: node.internals.positionAbsolute.x + canvasNode.dimensions.width

		if (canvasNode.type === 'aiChatThread' && isLeftHandle) {
			if (railHeight < settings.aiChatThread.rail.minSlideHeight) {
				return {
					x,
					y: node.internals.positionAbsolute.y + railHeight / 2,
				}
			}

			const margin = railHeight * settings.aiChatThread.rail.edgeMargin
			const minY = node.internals.positionAbsolute.y + margin
			const maxY = node.internals.positionAbsolute.y + railHeight - margin

			return {
				x,
				y: Math.max(minY, Math.min(maxY, pointer.y)),
			}
		}

		return {
			x,
			y: node.internals.positionAbsolute.y + canvasNode.dimensions.height / 2,
		}
	}

	private findClosestHandle(
		position: { x: number; y: number },
		fromHandle: Handle,
		connectionRadius: number,
	): Handle | null {
		let closest: Handle | null = null
		let minDist = Infinity

		for (const [nodeId, node] of this.nodeLookup) {
			const handles = [
				...(node.internals.handleBounds?.source ?? []),
				...(node.internals.handleBounds?.target ?? []),
			]

			for (const handle of handles) {
				// Skip the same handle we're dragging from
				if (handle.nodeId === fromHandle.nodeId && handle.type === fromHandle.type && handle.id === fromHandle.id) {
					continue
				}

				const { x: hx, y: hy } = this.getMenuSnapPoint(nodeId, handle, position)

				const dist = Math.sqrt((hx - position.x) ** 2 + (hy - position.y) ** 2)

				if (dist <= connectionRadius && dist < minDist) {
					minDist = dist
					closest = { ...handle, x: hx, y: hy }
				}
			}
		}

		return closest
	}

	private isMenuConnectionValid(sourceNodeId: string, targetHandle: Handle): boolean {
		// No self-loops
		if (targetHandle.nodeId === sourceNodeId) return false

		// No duplicates
		const candidate = {
			sourceNodeId,
			targetNodeId: targetHandle.nodeId,
			sourceHandle: 'right',
			targetHandle: targetHandle.id ?? 'left',
		}

		for (const existing of this.edges) {
			if (isSameConnection(existing, candidate)) {
				return false
			}
		}

		return true
	}

	public onHandlePointerDown(event: MouseEvent | TouchEvent, meta: HandleMeta) {
		event.preventDefault()
		event.stopPropagation()

		this.reconnectingEdge = meta.reconnectingEdgeId && meta.edgeUpdaterType
			? { edgeId: meta.reconnectingEdgeId, edgeUpdaterType: meta.edgeUpdaterType }
			: null

		const handleType: HandleType | undefined = meta.edgeUpdaterType

		XYHandle.onPointerDown(event, {
			domNode: this.config.paneEl,
			flowId: 'workspace',
			lib: 'xy',
			getTransform: this.config.getTransform,
			nodeLookup: this.nodeLookup,
			handleDomNode: meta.handleDomNode,

			nodeId: meta.nodeId,
			handleId: meta.handleId,
			isTarget: meta.isTarget,
			edgeUpdaterType: handleType,
			getFromHandle: () => {
				// XYHandle uses this to abort if the from-handle disappears
				return { nodeId: meta.nodeId, id: meta.handleId, position: meta.isTarget ? 'left' : 'right', type: meta.isTarget ? 'target' : 'source' } as any
			},

			connectionMode: ConnectionMode.Strict,
			connectionRadius: 30,
			autoPanOnConnect: true,

			updateConnection: (state: ConnectionInProgress) => {
				this.connectionInProgress = state
				this.render()
			},

			cancelConnection: () => {
				this.cancelTransientConnection()
			},

			onConnectEnd: () => {
				requestAnimationFrame(() => this.cancelTransientConnection())
			},

			isValidConnection: (connection: Connection) => {
				// No self-loops
				if ('source' in connection && 'target' in connection && connection.source === connection.target) {
					return false
				}

				const candidate = {
					sourceNodeId: connection.source,
					targetNodeId: connection.target,
					sourceHandle: connection.sourceHandle ?? null,
					targetHandle: connection.targetHandle ?? null,
				}

				// No duplicates
				for (const existing of this.edges) {
					if (this.reconnectingEdge?.edgeId === existing.edgeId) {
						continue
					}
					if (isSameConnection(existing, candidate)) {
						return false
					}
				}

				return true
			},

			onConnect: (connection: Connection) => {
				if (this.reconnectingEdge) {
					return
				}

				// Use the actual drag start/end nodes, not XYFlow's source/target
				// which depends on handle types (source/target) not drag direction
				const fromNodeId = this.connectionInProgress?.fromHandle?.nodeId
				const fromHandleId = this.connectionInProgress?.fromHandle?.id
				if (!fromNodeId) return

				const toNodeId = fromNodeId === connection.source ? connection.target : connection.source
				const toHandleId = fromNodeId === connection.source ? connection.targetHandle : connection.sourceHandle

				// Source always attaches at center of side (t=0.5).
				const sourceT = 0.5
				let targetT = 0.5

				// Try to make a straight horizontal line by aligning target anchor
				// with the source Y. If source Y falls within the target node's
				// vertical range, adjust targetT so both endpoints share the same Y.
				// This gives perfectly straight lines whenever geometrically possible.
				const sourceNode = this.nodes.find(n => n.nodeId === fromNodeId)
				const targetNode = this.nodes.find(n => n.nodeId === toNodeId)

				if (sourceNode && canAutoAlignTargetT(targetNode)) {
					const sourceY = sourceNode.position.y + sourceNode.dimensions.height * sourceT
					const targetTop = targetNode.position.y
					const targetBottom = targetTop + targetNode.dimensions.height

					if (sourceY >= targetTop && sourceY <= targetBottom) {
						// Source Y is within target node range — straight line!
						targetT = (sourceY - targetTop) / targetNode.dimensions.height
					}
					// Otherwise targetT stays 0.5, producing a 3-point connector
				}

				const nextEdge: WorkspaceEdge = {
					edgeId: generateEdgeId(),
					sourceNodeId: fromNodeId,
					targetNodeId: toNodeId,
					sourceHandle: fromHandleId ?? undefined,
					targetHandle: toHandleId ?? undefined,
					sourceT,
					targetT,
				}

				this.config.onEdgesChange([...this.edges, nextEdge])
				this.selectEdge(nextEdge.edgeId)
			},

			onReconnectEnd: (_event: MouseEvent | TouchEvent, finalState: ConnectionInProgress) => {
				if (!this.reconnectingEdge) {
					return
				}

				const edgeIdToUpdate = this.reconnectingEdge.edgeId

				// If dropped in empty space (no target node), delete the edge
				if (!finalState.toNode) {
					this.selectEdge(null)
					this.config.onEdgesChange(this.edges.filter((e) => e.edgeId !== edgeIdToUpdate))
					return
				}

				const edgeToUpdate = this.edges.find((e) => e.edgeId === edgeIdToUpdate)
				if (!edgeToUpdate) {
					return
				}

				const updatedEdge: WorkspaceEdge = { ...edgeToUpdate }

				// Get the node being reconnected to
				const reconnectedNode = this.nodes.find(n => n.nodeId === finalState.toNode!.id)

				// Reconnect logic: edgeUpdaterType tells us which end is being moved
				// 'source' means moving the source end, 'target' means moving the target end
				if (this.reconnectingEdge.edgeUpdaterType === 'source') {
					updatedEdge.sourceNodeId = finalState.toNode.id
					updatedEdge.sourceHandle = finalState.toHandle?.id ?? undefined
					// Compute t from drop position
					if (reconnectedNode?.type === 'image') {
						updatedEdge.sourceT = 0.5
					} else if (reconnectedNode && finalState.toHandle) {
						updatedEdge.sourceT = computeTFromPointerPosition(
							finalState.toHandle.y,
							reconnectedNode.position.y,
							reconnectedNode.dimensions.height
						)
					} else {
						updatedEdge.sourceT = 0.5
					}
				} else {
					updatedEdge.targetNodeId = finalState.toNode.id
					updatedEdge.targetHandle = finalState.toHandle?.id ?? undefined
					// Compute t from drop position
					if (reconnectedNode?.type === 'image') {
						updatedEdge.targetT = 0.5
					} else if (reconnectedNode && finalState.toHandle) {
						updatedEdge.targetT = computeTFromPointerPosition(
							finalState.toHandle.y,
							reconnectedNode.position.y,
							reconnectedNode.dimensions.height
						)
					} else {
						updatedEdge.targetT = 0.5
					}
				}

				// Validate again (avoid creating duplicates via reconnect)
				for (const existing of this.edges) {
					if (existing.edgeId === updatedEdge.edgeId) continue
					if (isSameConnection(existing, updatedEdge)) {
						return
					}
				}

				const nextEdges = this.edges.map((e) => e.edgeId === updatedEdge.edgeId ? updatedEdge : e)
				this.config.onEdgesChange(nextEdges)
				this.selectEdge(updatedEdge.edgeId)
			},

			panBy: this.config.panBy
		})
	}

	public selectEdge(edgeId: string | null) {
		this.selectedEdgeId = edgeId
		this.config.onSelectedEdgeChange?.(edgeId)
		this.render()
	}

	public deleteSelectedEdge() {
		if (!this.selectedEdgeId) return

		const toDelete = this.selectedEdgeId
		this.selectEdge(null)
		this.config.onEdgesChange(this.edges.filter((e) => e.edgeId !== toDelete))
	}

	public deselect() {
		this.selectEdge(null)
	}

	private computeMessageSourceT(nodeId: string, messageId: string): number | null {
		const nodeEl = this.nodeElements.get(nodeId)
		if (!nodeEl) return null

		const messageEl = nodeEl.querySelector(`[data-message-id="${messageId}"]`)
		if (!messageEl) return null

		const nodeRect = nodeEl.getBoundingClientRect()
		const msgRect = messageEl.getBoundingClientRect()
		if (nodeRect.height <= 0 || msgRect.height <= 0) return null

		const msgCenterY = msgRect.top + msgRect.height / 2
		if (msgCenterY < nodeRect.top || msgCenterY > nodeRect.bottom) return null

		const relativeY = msgCenterY - nodeRect.top
		const t = relativeY / nodeRect.height

		return Math.max(0, Math.min(1, t))
	}

	public render() {
		if (!this.edges.length && !this.connectionInProgress && !this.proximityCandidate) {
			this.cachedPixiEdgeConfigs = null
			this.cachedPixiWorldNodeMap = null
			this.cachedPixiEdgeData = []
			this.cachedFlattenedEdgePaths.clear()
			this.config.onPixiEdgesReady?.([])
			return
		}

		const nodeById = new Map(this.nodes.map((node) => [node.nodeId, node]))

		const worldNodeMap = new Map<string, NodeConfig>()

		for (const canvasNode of this.nodes) {
			const geometry = this.getEdgeNodeGeometry(canvasNode)
			worldNodeMap.set(canvasNode.nodeId, {
				id: canvasNode.nodeId,
				shape: 'rect',
				x: geometry.x,
				y: geometry.y,
				width: geometry.width,
				height: geometry.height,
				className: 'workspace-edge-node'
			})
		}

		// Get current zoom for proportional scaling
		const transform = this.config.getTransform()
		const zoom = transform[2]
		const connectorScaling = settings.connector.scaling

		// Calculate scaled sizes for edges
		const { markerOffset: scaledMarkerOffset, clickAreaWidth: scaledClickAreaWidth } =
			settings.connector.useZoomCompensatedScaling
				? getEdgeScaledSizes(zoom, {
					baseStrokeWidth: connectorScaling.strokeWidth,
					baseMarkerSize: connectorScaling.markerSize,
					baseMarkerOffset: connectorScaling.markerOffset,
					baseClickAreaWidth: connectorScaling.clickAreaWidth,
					zoomScaling: getAdaptiveBoundedZoomScalingOptions(connectorScaling.zoomScaling),
				})
				: { markerOffset: connectorScaling.markerOffset, clickAreaWidth: connectorScaling.clickAreaWidth }
		const pixiStrokeWidth = connectorScaling.strokeWidth
		const pixiMarkerSize = connectorScaling.markerSize
		this.currentEdgeClickAreaWidth = scaledClickAreaWidth

		// Read CSS connector colors for PIXI rendering (set as CSS custom props on paneEl)
		const paneStyle = getComputedStyle(this.config.paneEl)
		const pixiDefaultColor = paneStyle.getPropertyValue('--connector-line-default-color').trim() || '#000000'
		const pixiFocusColor = paneStyle.getPropertyValue('--connector-line-focus-color').trim() || '#000000'
		this.cachedPixiDefaultColor = pixiDefaultColor
		this.cachedPixiFocusColor = pixiFocusColor
		const pixiEdgeData: PixiEdgeRenderDatum[] = []
		const pixiEdgeConfigsForCache: Array<{ edgeConfig: EdgeConfig; isSelected: boolean }> = []
		const addPixiEdgeDatum = (edgeConfig: EdgeConfig, isSelected: boolean): void => {
			if (!this.config.onPixiEdgesReady) return
			pixiEdgeConfigsForCache.push({ edgeConfig, isSelected })
			const pixiDatum = computePixiEdgeDatum(
				edgeConfig, worldNodeMap, isSelected,
				pixiDefaultColor, pixiFocusColor,
				pixiStrokeWidth, pixiMarkerSize, scaledMarkerOffset
			)
			if (pixiDatum) {
				pixiEdgeData.push(pixiDatum)
			}
		}

		// Compute spread-out t values for edges sharing the same node+side
		// This prevents multiple edges from converging to the exact same point

		// If we handle proximity, include the ghost edge in calculations so it behaves exactly like a real edge
		const effectiveEdges = [...this.edges]
		if (this.proximityCandidate && !this.connectionInProgress) {
			const ghostEdgeData: WorkspaceEdge = {
				edgeId: '__workspace-proximity-temp', // Use consistent ID
				sourceNodeId: this.proximityCandidate.sourceNodeId,
				sourceHandle: this.proximityCandidate.sourceHandle,
				targetNodeId: this.proximityCandidate.targetNodeId,
				targetHandle: this.proximityCandidate.targetHandle,
				sourceT: 0.5,
				targetT: 0.5
			}
			effectiveEdges.push(ghostEdgeData)
		}

		const spreadTValues = computeSpreadTValues(effectiveEdges, this.nodesWithRailHeights())

		// Update proximity candidate T-values with computed ones so commit uses them too
		if (this.proximityCandidate && !this.connectionInProgress) {
			const computed = spreadTValues.get('__workspace-proximity-temp')
			if (computed) {
				this.proximityCandidate.sourceT = computed.sourceT
				this.proximityCandidate.targetT = computed.targetT
			}
		}

		// Add committed edges (skip the one being reconnected)
		for (const e of this.edges) {
			// Hide the edge being reconnected - it will be shown as in-progress line
			if (this.reconnectingEdge?.edgeId === e.edgeId && this.connectionInProgress) {
				continue
			}

			const { source, target } = getEdgeAnchorPositions(e)
			const isSelected = e.edgeId === this.selectedEdgeId

			// Use spread t values to prevent convergence, fall back to stored values
			const tValues = spreadTValues.get(e.edgeId)
			let sourceT = tValues?.sourceT ?? e.sourceT ?? 0.5
			let targetT = tValues?.targetT ?? e.targetT ?? 0.5

			// If sourceMessageId is present, try to anchor to that specific message
			if (e.sourceMessageId) {
				const computedT = this.computeMessageSourceT(e.sourceNodeId, e.sourceMessageId)
				if (computedT !== null) {
					sourceT = computedT

					// Re-calculate targetT to align with the specific message source height
					// This prevents the arrow from pointing to the bottom of the target when the thread is long
					const sourceNode = this.nodes.find(n => n.nodeId === e.sourceNodeId)
					const targetNode = this.nodes.find(n => n.nodeId === e.targetNodeId)
					if (sourceNode && canAutoAlignTargetT(targetNode)) {
						const targetHeight = targetNode.dimensions.height

						if (targetHeight < settings.aiChatThread.rail.minSlideHeight) {
							targetT = 0.5
						} else {
							const sourceY = sourceNode.position.y + (sourceNode.dimensions.height * sourceT)
							const targetTop = targetNode.position.y

							const idealT = (sourceY - targetTop) / targetHeight
							const m = settings.aiChatThread.rail.edgeMargin
							targetT = Math.max(m, Math.min(1 - m, idealT))
						}
					}
				}
			}

			const edgeConfig: EdgeConfig = {
				id: e.edgeId,
				source: this.buildEdgeAnchor(e.sourceNodeId, source, sourceT, nodeById),
				target: this.buildEdgeAnchor(e.targetNodeId, target, targetT, nodeById),
				pathType: e.pathType ?? settings.connector.lineCurve,
				marker: isSelected ? 'arrowhead-selected' : 'arrowhead',
				laneIndex: tValues?.laneIndex ?? 0,
				laneCount: tValues?.laneCount ?? 1
			}

			addPixiEdgeDatum(edgeConfig, isSelected)
		}

		// Add in-progress edge (new connection or reconnecting existing edge)
		if (this.connectionInProgress) {
			const transform = this.config.getTransform()
			const to = this.connectionInProgress.toHandle
				? { x: this.connectionInProgress.toHandle.x, y: this.connectionInProgress.toHandle.y }
				: toRendererPoint({ x: this.connectionInProgress.to.x, y: this.connectionInProgress.to.y }, transform)

			const tempNodeId = '__workspace-temp-target'
			const snappedTargetNodeId = this.connectionInProgress.toHandle?.nodeId ?? this.connectionInProgress.toNode?.id ?? null
			const snappedTargetNode = snappedTargetNodeId
				? this.nodes.find((node) => node.nodeId === snappedTargetNodeId) ?? null
				: null
			const snappedTargetPosition = this.connectionInProgress.toHandle?.position as 'left' | 'right' | 'top' | 'bottom' | undefined

			if (!snappedTargetNode || !snappedTargetPosition || !this.connectionInProgress.toHandle) {
				const tempNode: NodeConfig = {
					id: tempNodeId,
					shape: 'rect',
					x: to.x,
					y: to.y,
					width: 0,
					height: 0,
					anchorOverrides: {
						left: { x: to.x, y: to.y },
						right: { x: to.x, y: to.y },
						top: { x: to.x, y: to.y },
						bottom: { x: to.x, y: to.y },
						center: { x: to.x, y: to.y }
					}
				}
				worldNodeMap.set(tempNodeId, tempNode)
			}

			// When reconnecting, show the edge from the anchored end to the cursor
			// When creating new connection, show dashed line from source to cursor
			const isReconnecting = this.reconnectingEdge !== null
			const reconnectingEdgeData = isReconnecting
				? this.edges.find((e) => e.edgeId === this.reconnectingEdge?.edgeId)
				: null

			let sourceNodeId: string
			let sourcePosition: 'left' | 'right' | 'center'

			if (isReconnecting && reconnectingEdgeData) {
				// When reconnecting, the source is the end that's NOT being dragged
				if (this.reconnectingEdge!.edgeUpdaterType === 'source') {
					// Dragging source end, so anchor from target
					sourceNodeId = reconnectingEdgeData.targetNodeId
					sourcePosition = (reconnectingEdgeData.targetHandle === 'left' ? 'left' : 'right') as 'left' | 'right'
				} else {
					// Dragging target end, so anchor from source
					sourceNodeId = reconnectingEdgeData.sourceNodeId
					sourcePosition = (reconnectingEdgeData.sourceHandle === 'left' ? 'left' : 'right') as 'left' | 'right'
				}
			} else {
				// New connection - use the fromHandle
				sourceNodeId = this.connectionInProgress.fromHandle.nodeId
				sourcePosition = this.connectionInProgress.fromHandle.position as 'left' | 'right'
			}

			const snappedTargetT = snappedTargetNode && snappedTargetPosition && this.connectionInProgress.toHandle
				? computeTFromPointerPosition(
					this.connectionInProgress.toHandle.y,
					snappedTargetNode.position.y,
					snappedTargetNode.type === 'aiChatThread'
						? (this.railHeights.get(snappedTargetNode.nodeId) ?? snappedTargetNode.dimensions.height)
						: snappedTargetNode.dimensions.height,
				)
				: undefined

			const tempEdge: EdgeConfig = {
				id: '__workspace-temp-edge',
				source: this.buildEdgeAnchor(sourceNodeId, sourcePosition, undefined, nodeById),
				target: snappedTargetNode && snappedTargetPosition && this.connectionInProgress.toHandle
					? this.buildEdgeAnchor(snappedTargetNode.nodeId, snappedTargetPosition, snappedTargetT, nodeById)
					: { nodeId: tempNodeId, position: 'center' },
				pathType: settings.connector.lineCurve,
				marker: 'arrowhead',
				lineStyle: isReconnecting ? 'solid' : 'dashed'
			}
			addPixiEdgeDatum(tempEdge, false)
		}

		// Draw potential proximity connection
		if (this.proximityCandidate && !this.connectionInProgress) {
			// Retrieve computed values or fall back to candidate/default
			const computed = spreadTValues.get('__workspace-proximity-temp')
			const sourceT = computed?.sourceT ?? this.proximityCandidate.sourceT
			const targetT = computed?.targetT ?? this.proximityCandidate.targetT

			const ghostEdge: EdgeConfig = {
				id: '__workspace-proximity-edge',
				source: this.buildEdgeAnchor(this.proximityCandidate.sourceNodeId, this.proximityCandidate.sourceHandle, sourceT, nodeById),
				target: this.buildEdgeAnchor(this.proximityCandidate.targetNodeId, this.proximityCandidate.targetHandle, targetT, nodeById),
				pathType: settings.connector.lineCurve,
				marker: 'arrowhead',
				lineStyle: 'dashed'
			}
			addPixiEdgeDatum(ghostEdge, false)
		}

		this.config.onPixiEdgesReady?.(pixiEdgeData)
		this.cachedPixiEdgeConfigs = pixiEdgeConfigsForCache
		this.cachedPixiWorldNodeMap = worldNodeMap
		this.cachedPixiEdgeData = pixiEdgeData
		this.cachedFlattenedEdgePaths.clear()

		this.attachEdgeInteractionHandlers()
	}

	// Fast synchronous PIXI datum recomputation when only zoom changes.
	// Called from the viewport zoom handler after the viewport is applied,
	// then flushed synchronously by pixiMediaLayer.renderNow().
	public recomputePixiEdgesOnly(zoom: number): boolean {
		if (!this.cachedPixiEdgeConfigs || !this.cachedPixiWorldNodeMap || !this.config.onPixiEdgesReady) return false

		const connectorScaling = settings.connector.scaling
		const { markerOffset: scaledMarkerOffset, clickAreaWidth: scaledClickAreaWidth } = settings.connector.useZoomCompensatedScaling
			? getEdgeScaledSizes(zoom, {
				baseStrokeWidth: connectorScaling.strokeWidth,
				baseMarkerSize: connectorScaling.markerSize,
				baseMarkerOffset: connectorScaling.markerOffset,
				baseClickAreaWidth: connectorScaling.clickAreaWidth,
				zoomScaling: getAdaptiveBoundedZoomScalingOptions(connectorScaling.zoomScaling),
			})
			: { markerOffset: connectorScaling.markerOffset, clickAreaWidth: connectorScaling.clickAreaWidth }
		this.currentEdgeClickAreaWidth = scaledClickAreaWidth

		const pixiEdgeData: PixiEdgeRenderDatum[] = []
		for (const { edgeConfig, isSelected } of this.cachedPixiEdgeConfigs) {
			const pixiDatum = computePixiEdgeDatum(
				edgeConfig, this.cachedPixiWorldNodeMap, isSelected,
				this.cachedPixiDefaultColor, this.cachedPixiFocusColor,
				connectorScaling.strokeWidth, connectorScaling.markerSize, scaledMarkerOffset
			)
			if (pixiDatum) pixiEdgeData.push(pixiDatum)
		}

		this.cachedPixiEdgeData = pixiEdgeData
		this.cachedFlattenedEdgePaths.clear()
		this.config.onPixiEdgesReady(pixiEdgeData)
		return true
	}

	private paneClickHandler: ((e: MouseEvent) => void) | null = null
	private paneMouseMoveHandler: ((e: MouseEvent) => void) | null = null

	private getFlattenedEdgePath(edge: PixiEdgeRenderDatum): PathPoint[] {
		const cached = this.cachedFlattenedEdgePaths.get(edge.id)
		if (cached?.svgPath === edge.svgPath) return cached.points

		const points = flattenSvgPath(edge.svgPath)
		this.cachedFlattenedEdgePaths.set(edge.id, { svgPath: edge.svgPath, points })
		return points
	}

	private getWorldPointFromClient(clientX: number, clientY: number): PathPoint {
		const paneBounds = this.config.paneEl.getBoundingClientRect()
		const transform = this.config.getTransform()
		return {
			x: (clientX - paneBounds.left - transform[0]) / transform[2],
			y: (clientY - paneBounds.top - transform[1]) / transform[2],
		}
	}

	private worldPointToClientPoint(point: PathPoint): PathPoint {
		const paneBounds = this.config.paneEl.getBoundingClientRect()
		const transform = this.config.getTransform()
		return {
			x: paneBounds.left + point.x * transform[2] + transform[0],
			y: paneBounds.top + point.y * transform[2] + transform[1],
		}
	}

	private findEdgeIdAtClientPoint(clientX: number, clientY: number): string | null {
		const worldPoint = this.getWorldPointFromClient(clientX, clientY)
		const hitRadius = Math.max(1, this.currentEdgeClickAreaWidth / 2)
		const committedEdgeIds = new Set(this.edges.map((edge) => edge.edgeId))

		for (const edge of [...this.cachedPixiEdgeData].reverse()) {
			if (!committedEdgeIds.has(edge.id)) continue
			if (isPointNearPath(worldPoint, this.getFlattenedEdgePath(edge), hitRadius)) return edge.id
		}

		return null
	}

	public getEdgeMidpointRect(edgeId: string): DOMRect | null {
		const edge = this.cachedPixiEdgeData.find((candidate) => candidate.id === edgeId)
		if (!edge) return null

		const points = this.getFlattenedEdgePath(edge)
		const pathLength = getPathLength(points)
		const midpoint = getPointAtPathLength(points, pathLength / 2)
		if (!midpoint) return null

		const screenMid = this.worldPointToClientPoint(midpoint.point)
		const tangentLength = Math.hypot(midpoint.tangent.x, midpoint.tangent.y) || 1
		let normalX = -midpoint.tangent.y / tangentLength
		let normalY = midpoint.tangent.x / tangentLength

		if (normalY < 0) {
			normalX = -normalX
			normalY = -normalY
		}

		const menuRadius = 18
		const gap = 10
		const distance = menuRadius + gap
		const menuCenterX = screenMid.x + normalX * distance
		const menuCenterY = screenMid.y + normalY * distance
		const targetX = menuCenterX
		const targetY = menuCenterY - menuRadius - 9

		return new DOMRect(targetX, targetY, 1, 1)
	}

	private attachEdgeInteractionHandlers() {
		if (this.paneClickHandler) return  // Already attached

		this.paneClickHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			if (target.closest('.workspace-document-node, .workspace-image-node, .workspace-ai-chat-thread-node')) {
				return
			}


			const edgeId = this.findEdgeIdAtClientPoint(e.clientX, e.clientY)
			if (!edgeId) return

			e.preventDefault()
			e.stopPropagation()
			this.selectEdge(edgeId)
		}

		this.paneMouseMoveHandler = (e: MouseEvent) => {
			// Don't interfere with cursor if we are currently drawing a connection
			// or if the user is dragging something (mouse button is held down)
			if (this.connectionInProgress || e.buttons > 0) {
				this.config.paneEl.classList.remove('is-hovering-edge')
				return
			}

			const target = e.target as HTMLElement
			if (target.closest('.workspace-document-node, .workspace-image-node, .workspace-ai-chat-thread-node')) {
				this.config.paneEl.classList.remove('is-hovering-edge')
				return
			}

			this.config.paneEl.classList.toggle('is-hovering-edge', Boolean(this.findEdgeIdAtClientPoint(e.clientX, e.clientY)))
		}

		this.config.paneEl.addEventListener('click', this.paneClickHandler)
		this.config.paneEl.addEventListener('mousemove', this.paneMouseMoveHandler)
	}

	public checkProximity(
		nodeId: string,
		position: { x: number; y: number },
		dimensions: { width: number; height: number }
	) {
		const draggedNode = this.nodes.find(n => n.nodeId === nodeId)
		if (!draggedNode) {
			return
		}

		let closestCandidate: ProximityCandidate | null = null
		let minDistance = settings.connector.proximityConnectThreshold

		// Only trigger proximity connect if the dragged node has NO existing connections (either incoming or outgoing)
		// This prevents "ghost" connections from appearing when dragging nodes that are already part of a graph (e.g. AI images).
		const hasExistingConnections = this.edges.some(e => e.sourceNodeId === nodeId || e.targetNodeId === nodeId)

		if (!hasExistingConnections) {
			const proxRailOff = this.config.railOffset ?? 0
			for (const other of this.nodes) {
				if (other.nodeId === nodeId) continue

				// Calculate handles for the dragged node.
				const draggedRight = { x: position.x + dimensions.width, y: position.y + dimensions.height / 2 }

				// Calculate handles for the other node (shift left anchor by railOffset for threads)
				const otherXShift = other.type === 'aiChatThread' ? proxRailOff : 0
				const otherLeft = { x: other.position.x - otherXShift, y: other.position.y + other.dimensions.height / 2 }
				const otherRight = { x: other.position.x + other.dimensions.width, y: other.position.y + other.dimensions.height / 2 }

				// For dragged node as aiChatThread, shift its own left anchor
				const draggedXShift = draggedNode.type === 'aiChatThread' ? proxRailOff : 0
				const draggedLeftForTarget = { x: position.x - draggedXShift, y: position.y + dimensions.height / 2 }

				// Check Connection: Dragged Right (Source) -> Other Left (Target)
				// Rule: Target (Other) must be aiChatThread
				// Rule: No existing connection between these nodes (in this direction)
				if (other.type === 'aiChatThread') {
					const hasExisting = this.edges.some(e => e.sourceNodeId === nodeId && e.targetNodeId === other.nodeId)
					if (!hasExisting) {
						const d1 = Math.hypot(draggedRight.x - otherLeft.x, draggedRight.y - otherLeft.y)
						if (d1 < minDistance) {
							minDistance = d1
							closestCandidate = {
								sourceNodeId: nodeId,
								sourceHandle: 'right',
								targetNodeId: other.nodeId,
								targetHandle: 'left'
							}
						}
					}
				}

				// Check Connection: Other Right (Source) -> Dragged Left (Target)
				// Rule: Target (Dragged) must be aiChatThread
				// Rule: No existing connection between these nodes (in this direction)
				if (draggedNode.type === 'aiChatThread') {
					const hasExisting = this.edges.some(e => e.sourceNodeId === other.nodeId && e.targetNodeId === nodeId)
					if (!hasExisting) {
						const d2 = Math.hypot(otherRight.x - draggedLeftForTarget.x, otherRight.y - draggedLeftForTarget.y)
						if (d2 < minDistance) {
							minDistance = d2
							closestCandidate = {
								sourceNodeId: other.nodeId,
								sourceHandle: 'right',
								targetNodeId: nodeId,
								targetHandle: 'left'
							}
						}
					}
				}
			}
		}

		if (
			this.proximityCandidate?.sourceNodeId !== closestCandidate?.sourceNodeId ||
			this.proximityCandidate?.targetNodeId !== closestCandidate?.targetNodeId
		) {
			this.proximityCandidate = closestCandidate
		}
	}

	public commitProximityConnection() {
		if (!this.proximityCandidate) {
			return
		}

		const newEdge: WorkspaceEdge = {
			edgeId: generateEdgeId(),
			sourceNodeId: this.proximityCandidate.sourceNodeId,
			sourceHandle: this.proximityCandidate.sourceHandle,
			targetNodeId: this.proximityCandidate.targetNodeId,
			targetHandle: this.proximityCandidate.targetHandle,
			// Use the calculated T values so strict position matches ghost edge (no jump)
			sourceT: this.proximityCandidate.sourceT ?? 0.5,
			targetT: this.proximityCandidate.targetT ?? 0.5
		}

		const nextEdges = [...this.edges, newEdge]
		this.config.onEdgesChange(nextEdges)

		this.proximityCandidate = null
	}

	public destroy() {
		// Remove click handler
		if (this.paneClickHandler) {
			this.config.paneEl.removeEventListener('click', this.paneClickHandler)
			this.paneClickHandler = null
		}
		this.nodeLookup.clear()
		this.parentLookup.clear()
		this.nodes = []
		this.edges = []
		this.cachedPixiEdgeConfigs = null
		this.cachedPixiWorldNodeMap = null
		this.cachedPixiEdgeData = []
		this.cachedFlattenedEdgePaths.clear()
		this.connectionInProgress = null
		this.selectedEdgeId = null
		this.reconnectingEdge = null
		this.menuConnectionCleanup?.()
	}
}
