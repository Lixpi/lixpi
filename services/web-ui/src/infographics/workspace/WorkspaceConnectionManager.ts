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
	createConnectorRenderer,
	type ConnectorRenderer,
	type EdgeConfig,
	type NodeConfig,
	type PathType,
} from '$src/infographics/connectors/index.ts'

import { getEdgeScaledSizes } from '$src/infographics/utils/zoomScaling.ts'

import type {
	CanvasNode,
	WorkspaceEdge,
} from '@lixpi/constants'

import { webUiSettings } from '$src/webUiSettings.ts'
import { webUiThemeSettings } from '$src/webUiThemeSettings.ts'

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
	edgesLayerEl: HTMLDivElement
	getTransform: () => Transform
	panBy: ({ x, y }: { x: number; y: number }) => Promise<boolean>
	onEdgesChange: (edges: WorkspaceEdge[]) => void
	onSelectedEdgeChange?: (edgeId: string | null) => void
	rainOffset?: number
}

type RenderBounds = {
	left: number
	top: number
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

function isSameConnection(
	a: WorkspaceEdge,
	b: { sourceNodeId: string; targetNodeId: string; sourceHandle?: string | null; targetHandle?: string | null }
) {
	return a.sourceNodeId === b.sourceNodeId &&
		a.targetNodeId === b.targetNodeId &&
		(a.sourceHandle ?? null) === (b.sourceHandle ?? null) &&
		(a.targetHandle ?? null) === (b.targetHandle ?? null)
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
		let targetT = edge.targetT ?? 0.5

		// Dynamic auto-align: If source Y hits the target node, FORCE straight line alignment
		// This ensures that even during dragging or node moving, the line attempts to stay straight
		// For off-axis nodes, we clamp to the nearest corner (top/bottom) instead of snapping to center
		if (sourceNode && targetNode) {
			const targetHeight = targetNode.dimensions.height

			// When the target is shorter than the minimum slide height, snap to center
			if (targetHeight < webUiThemeSettings.aiChatThreadRailMinSlideHeight) {
				targetT = 0.5
			} else {
				const targetTop = targetNode.position.y

				// Calculate ideal straight-line projection
				const idealT = (sourceY - targetTop) / targetHeight

				// Clamp to be within the node side (0-1), leaving a configurable margin
				// effectively snapping to the top or bottom corner if the source is outside vertical bounds
				const m = webUiThemeSettings.aiChatThreadRailEdgeMargin
				targetT = Math.max(m, Math.min(1 - m, idealT))
			}
		}

		// Initialize with values
		result.set(edge.edgeId, {
			sourceT: edge.sourceT ?? 0.5,
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

export class WorkspaceConnectionManager {
	private readonly config: ConnectionManagerConfig

	private readonly nodeLookup: NodeLookup<InternalNodeBase> = new Map()
	private readonly parentLookup: ParentLookup<InternalNodeBase> = new Map()

	private nodeElements: Map<string, HTMLElement> = new Map()
	private nodes: CanvasNode[] = []
	private edges: WorkspaceEdge[] = []

	private connector: ConnectorRenderer | null = null
	private lastRenderBoundsKey: string | null = null

	private selectedEdgeId: string | null = null
	private connectionInProgress: ConnectionInProgress | null = null

	private reconnectingEdge: { edgeId: string; edgeUpdaterType: HandleType } | null = null

	private proximityCandidate: ProximityCandidate | null = null

	private menuConnectionCleanup: (() => void) | null = null

	private railHeights: Map<string, number> = new Map()

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

	public constructor(config: ConnectionManagerConfig) {
		this.config = config

		// Ensure XYFlow internals can measure zoom from viewport transform
		this.config.viewportEl.classList.add('xyflow__viewport')

		// Let the edges layer be positioned by bounds
		this.config.edgesLayerEl.style.position = 'absolute'
		this.config.edgesLayerEl.style.top = '0'
		this.config.edgesLayerEl.style.left = '0'

	}

	public syncNodes(canvasNodes: CanvasNode[]) {
		this.nodes = canvasNodes

		const xyNodes: NodeBase[] = canvasNodes.map((n) => ({
			id: n.nodeId,
			position: { x: n.position.x, y: n.position.y },
			width: n.dimensions.width,
			height: n.dimensions.height,
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

	public startConnectionFromMenu(nodeId: string) {
		// Cancel any existing menu connection
		this.menuConnectionCleanup?.()

		const node = this.nodeLookup.get(nodeId)
		if (!node) {
			console.log('[CONNECT] startConnectionFromMenu: node not found in nodeLookup for', nodeId)
			return
		}

		const sourceHandle: Handle | null = node.internals.handleBounds?.source?.[0] ?? null
		if (!sourceHandle) {
			console.log('[CONNECT] startConnectionFromMenu: no sourceHandle.', {
				handleBounds: node.internals.handleBounds,
				source: node.internals.handleBounds?.source,
			})
			return
		}

		console.log('[CONNECT] startConnectionFromMenu: initiating connection from', nodeId, {
			sourceHandle,
			positionAbsolute: node.internals.positionAbsolute,
		})

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
		this.config.paneEl.style.cursor = 'crosshair'

		let moveLogCounter = 0
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

			if (moveLogCounter++ % 30 === 0) {
				console.log('[CONNECT] mousemove', {
					clientX: e.clientX, clientY: e.clientY,
					screenRel: { x: screenRelX, y: screenRelY },
					transform,
					rendererPos,
				})
			}

			// Find closest target handle
			const closestHandle = this.findClosestHandle(rendererPos, fromHandle, 30)

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

		const onMouseDown = (e: MouseEvent) => {
			console.log('[CONNECT] onMouseDown in menu connection mode', {
				toHandle: this.connectionInProgress?.toHandle,
				isValid: this.connectionInProgress?.isValid,
				target: e.target,
			})
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

				if (sourceNode && targetNode) {
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

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				cleanup()
			}
		}

		const cleanup = () => {
			document.removeEventListener('mousemove', onMouseMove)
			document.removeEventListener('mousedown', onMouseDown, true)
			document.removeEventListener('keydown', onKeyDown)
			this.connectionInProgress = null
			this.config.paneEl.style.cursor = ''
			this.menuConnectionCleanup = null
			this.render()
		}

		this.menuConnectionCleanup = cleanup

		// Use capture for mousedown so we intercept before other handlers
		document.addEventListener('mousemove', onMouseMove)
		document.addEventListener('mousedown', onMouseDown, true)
		document.addEventListener('keydown', onKeyDown)
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

				const hx = (handle.x ?? 0) + node.internals.positionAbsolute.x + (handle.width ?? 0) / 2
				const hy = (handle.y ?? 0) + node.internals.positionAbsolute.y + (handle.height ?? 0) / 2

				const dist = Math.sqrt((hx - position.x) ** 2 + (hy - position.y) ** 2)

				console.log('[CONNECT] findClosestHandle candidate:', {
					nodeId,
					handleId: handle.id,
					handleType: handle.type,
					handleXY: { x: handle.x, y: handle.y },
					posAbsolute: node.internals.positionAbsolute,
					computedCenter: { hx, hy },
					mousePos: position,
					dist,
					connectionRadius,
					withinRadius: dist <= connectionRadius,
				})

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
				this.connectionInProgress = null
				this.reconnectingEdge = null
				this.render()
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

				if (sourceNode && targetNode) {
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
					if (reconnectedNode && finalState.toHandle) {
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
					if (reconnectedNode && finalState.toHandle) {
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

		// Calculate relative Y position
		const nodeRect = nodeEl.getBoundingClientRect()
		const msgRect = messageEl.getBoundingClientRect()

		// Center of the message element
		const msgCenterY = msgRect.top + msgRect.height / 2

		// Relative to node top
		const relativeY = msgCenterY - nodeRect.top

		// Convert to T value (0-1)
		const t = relativeY / nodeRect.height

		return Math.max(0, Math.min(1, t))
	}

	private computeRenderBounds(): RenderBounds | null {
		if (!this.edges.length && !this.connectionInProgress && !this.proximityCandidate) {
			return null
		}

		const nodeById = new Map(this.nodes.map((n) => [n.nodeId, n]))
		const padding = 200

		let minX = Infinity
		let minY = Infinity
		let maxX = -Infinity
		let maxY = -Infinity

		const includeRect = (x: number, y: number, w: number, h: number) => {
			minX = Math.min(minX, x)
			minY = Math.min(minY, y)
			maxX = Math.max(maxX, x + w)
			maxY = Math.max(maxY, y + h)
		}

		for (const edge of this.edges) {
			const source = nodeById.get(edge.sourceNodeId)
			const target = nodeById.get(edge.targetNodeId)
			if (source) includeRect(source.position.x, source.position.y, source.dimensions.width, source.dimensions.height)
			if (target) includeRect(target.position.x, target.position.y, target.dimensions.width, target.dimensions.height)
		}

		if (this.connectionInProgress) {
			includeRect(this.connectionInProgress.from.x, this.connectionInProgress.from.y, 1, 1)

			const transform = this.config.getTransform()
			const to = this.connectionInProgress.toHandle
				? { x: this.connectionInProgress.toHandle.x, y: this.connectionInProgress.toHandle.y }
				: toRendererPoint({ x: this.connectionInProgress.to.x, y: this.connectionInProgress.to.y }, transform)

			includeRect(to.x, to.y, 1, 1)
		}

		if (this.proximityCandidate) {
			const proxSource = nodeById.get(this.proximityCandidate.sourceNodeId)
			const proxTarget = nodeById.get(this.proximityCandidate.targetNodeId)
			if (proxSource) includeRect(proxSource.position.x, proxSource.position.y, proxSource.dimensions.width, proxSource.dimensions.height)
			if (proxTarget) includeRect(proxTarget.position.x, proxTarget.position.y, proxTarget.dimensions.width, proxTarget.dimensions.height)
		}

		if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
			return null
		}

		const left = minX - padding
		const top = minY - padding
		const width = Math.max(1, (maxX - minX) + padding * 2)
		const height = Math.max(1, (maxY - minY) + padding * 2)

		return { left, top, width, height }
	}

	private ensureConnector(bounds: RenderBounds) {
		const key = `${bounds.left}:${bounds.top}:${bounds.width}:${bounds.height}`

		if (this.connector && this.lastRenderBoundsKey === key) {
			return
		}

		this.lastRenderBoundsKey = key
		this.connector?.destroy()

		this.config.edgesLayerEl.style.left = `${bounds.left}px`
		this.config.edgesLayerEl.style.top = `${bounds.top}px`
		this.config.edgesLayerEl.style.width = `${bounds.width}px`
		this.config.edgesLayerEl.style.height = `${bounds.height}px`

		this.connector = createConnectorRenderer({
			container: this.config.edgesLayerEl,
			width: bounds.width,
			height: bounds.height,
			instanceId: 'workspace-edges'
		})
	}

	public render() {
		const bounds = this.computeRenderBounds()

		if (!bounds) {
			this.connector?.clear()
			this.config.edgesLayerEl.replaceChildren()
			this.connector = null
			this.lastRenderBoundsKey = null
			return
		}

		this.ensureConnector(bounds)

		if (!this.connector) return

		this.connector.clear()

		const offsetX = bounds.left
		const offsetY = bounds.top

		// Add nodes for anchor computation (hidden by CSS)
		const railOff = this.config.railOffset ?? 0
		for (const n of this.nodes) {
			// For aiChatThread nodes shift the left anchor by -railOffset
			// so connector lines attach to the vertical rail, and extend
			// height to full rail span (thread + gap + floating input)
			const xShift = n.type === 'aiChatThread' ? railOff : 0
			const railH = n.type === 'aiChatThread' ? this.railHeights.get(n.nodeId) : undefined
			const nodeConfig: NodeConfig = {
				id: n.nodeId,
				shape: 'rect',
				x: n.position.x - offsetX - xShift,
				y: n.position.y - offsetY,
				width: n.dimensions.width + xShift,
				height: railH ?? n.dimensions.height,
				className: 'workspace-edge-node'
			}
			this.connector.addNode(nodeConfig)
		}

		// Get current zoom for proportional scaling
		const transform = this.config.getTransform()
		const zoom = transform[2]

		// Calculate scaled sizes for edges
		const { strokeWidth: scaledStrokeWidth, markerSize: scaledMarkerSize, markerOffset: scaledMarkerOffset } =
			getEdgeScaledSizes(zoom)

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
					if (sourceNode && targetNode) {
						const targetHeight = targetNode.dimensions.height

						if (targetHeight < webUiThemeSettings.aiChatThreadRailMinSlideHeight) {
							targetT = 0.5
						} else {
							const sourceY = sourceNode.position.y + (sourceNode.dimensions.height * sourceT)
							const targetTop = targetNode.position.y

							const idealT = (sourceY - targetTop) / targetHeight
							const m = webUiThemeSettings.aiChatThreadRailEdgeMargin
							targetT = Math.max(m, Math.min(1 - m, idealT))
						}
					}
				}
			}

			const edgeConfig: EdgeConfig = {
				id: e.edgeId,
				source: { nodeId: e.sourceNodeId, position: source, t: sourceT },
				target: { nodeId: e.targetNodeId, position: target, t: targetT },
				pathType: e.pathType ?? webUiSettings.nodesConnectorLineCurve,
				marker: 'arrowhead',
				markerSize: scaledMarkerSize,
				markerOffset: scaledMarkerOffset,
				strokeWidth: isSelected ? scaledStrokeWidth * 1.5 : scaledStrokeWidth,
				className: `workspace-edge ${isSelected ? 'is-selected' : ''}`,
				laneIndex: tValues?.laneIndex ?? 0,
				laneCount: tValues?.laneCount ?? 1
			}

			this.connector.addEdge(edgeConfig)
		}

		// Add in-progress edge (new connection or reconnecting existing edge)
		if (this.connectionInProgress) {
			const transform = this.config.getTransform()
			const to = this.connectionInProgress.toHandle
				? { x: this.connectionInProgress.toHandle.x, y: this.connectionInProgress.toHandle.y }
				: toRendererPoint({ x: this.connectionInProgress.to.x, y: this.connectionInProgress.to.y }, transform)

			const tempNodeId = '__workspace-temp-target'
			const tempNode: NodeConfig = {
				id: tempNodeId,
				shape: 'rect',
				x: to.x - offsetX,
				y: to.y - offsetY,
				width: 1,
				height: 1,
				className: 'workspace-edge-temp-node',
				anchorOverrides: {
					left: { x: to.x - offsetX, y: to.y - offsetY },
					right: { x: to.x - offsetX, y: to.y - offsetY },
					top: { x: to.x - offsetX, y: to.y - offsetY },
					bottom: { x: to.x - offsetX, y: to.y - offsetY },
					center: { x: to.x - offsetX, y: to.y - offsetY }
				}
			}
			this.connector.addNode(tempNode)

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

			// Use horizontal-bezier for in-progress edges:
			// - No obstacle avoidance means no wrapping around intermediate/target nodes
			// - Smooth S-curve from source center to cursor position
			// - Committed edges use 'orthogonal' with proper routing after drop
			const tempEdge: EdgeConfig = {
				id: '__workspace-temp-edge',
				source: { nodeId: sourceNodeId, position: sourcePosition },
				target: { nodeId: tempNodeId, position: 'center' },
				pathType: 'horizontal-bezier',
				marker: isReconnecting ? 'arrowhead' : 'none',
				markerSize: isReconnecting ? scaledMarkerSize : undefined,
				markerOffset: { source: 0, target: 0 },
				strokeWidth: scaledStrokeWidth,
				lineStyle: isReconnecting ? 'solid' : 'dashed',
				className: `workspace-edge ${isReconnecting ? '' : 'workspace-edge-temp'}`
			}
			this.connector.addEdge(tempEdge)
		}

		// Draw potential proximity connection
		if (this.proximityCandidate && !this.connectionInProgress) {
            // Retrieve computed values or fall back to candidate/default
            const computed = spreadTValues.get('__workspace-proximity-temp')

			const ghostEdge: EdgeConfig = {
				id: '__workspace-proximity-edge',
				source: {
					nodeId: this.proximityCandidate.sourceNodeId,
					position: this.proximityCandidate.sourceHandle,
					t: computed?.sourceT ?? this.proximityCandidate.sourceT
				},
				target: {
					nodeId: this.proximityCandidate.targetNodeId,
					position: this.proximityCandidate.targetHandle,
					t: computed?.targetT ?? this.proximityCandidate.targetT
				},
				pathType: webUiSettings.nodesConnectorLineCurve,
				marker: 'arrowhead',
				markerSize: scaledMarkerSize,
				markerOffset: scaledMarkerOffset,
				strokeWidth: Math.max(scaledStrokeWidth, 2), // Ensure visibility
				lineStyle: 'dashed',
				className: 'workspace-edge workspace-edge-temp'
			}
			// console.log('[ConnectionManager] Adding proximity ghost edge', ghostEdge)
			this.connector.addEdge(ghostEdge)
		}

		this.connector.render()

		this.attachEdgeInteractionHandlers()
	}

	private paneClickHandler: ((e: MouseEvent) => void) | null = null

	private attachEdgeInteractionHandlers() {
		if (this.paneClickHandler) return  // Already attached

		this.paneClickHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			if (target.closest('.workspace-document-node, .workspace-image-node, .workspace-ai-chat-thread-node')) {
				return
			}

			const svg = this.config.edgesLayerEl.querySelector('svg.connector-svg') as SVGSVGElement | null
			if (!svg) return

			const ctm = svg.getScreenCTM()
			if (!ctm) return

			const svgPoint = svg.createSVGPoint()
			svgPoint.x = e.clientX
			svgPoint.y = e.clientY
			const point = svgPoint.matrixTransform(ctm.inverse())

			const paths = svg.querySelectorAll('path.connector-edge') as NodeListOf<SVGPathElement>
			for (const path of paths) {
				const id = path.getAttribute('id')
				if (!id?.startsWith('edge-')) continue
				const edgeId = id.slice('edge-'.length)
				if (edgeId.startsWith('__workspace-temp')) continue

				const origWidth = path.style.strokeWidth
				path.style.strokeWidth = '14'
				const hit = path.isPointInStroke(point)
				path.style.strokeWidth = origWidth

				if (hit) {
					e.preventDefault()
					e.stopPropagation()
					this.selectEdge(edgeId)
					return
				}
			}
		}

		this.config.paneEl.addEventListener('click', this.paneClickHandler)
	}

	public checkProximity(
		nodeId: string,
		position: { x: number; y: number },
		dimensions: { width: number; height: number }
	) {
		const draggedNode = this.nodes.find(n => n.nodeId === nodeId)
		if (!draggedNode) {
            // console.warn('[Proximity] Dragged node not found in this.nodes', nodeId)
            return
        }

		let closestCandidate: ProximityCandidate | null = null
		let minDistance = webUiSettings.proximityConnectThreshold

		// Only trigger proximity connect if the dragged node has NO existing connections (either incoming or outgoing)
		// This prevents "ghost" connections from appearing when dragging nodes that are already part of a graph (e.g. AI images).
		const hasExistingConnections = this.edges.some(e => e.sourceNodeId === nodeId || e.targetNodeId === nodeId)

		if (!hasExistingConnections) {
			const proxRailOff = this.config.railOffset ?? 0
			for (const other of this.nodes) {
				if (other.nodeId === nodeId) continue

				// Calculate handles for the dragged node
				const draggedLeft = { x: position.x, y: position.y + dimensions.height / 2 }
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
            console.log('[Proximity] Candidate update:', closestCandidate ? 'FOUND' : 'LOST', closestCandidate)
			this.proximityCandidate = closestCandidate
		}
	}

	public commitProximityConnection() {
		if (!this.proximityCandidate) {
            // console.log('[Proximity] No candidate to commit')
            return
        }

        console.log('[Proximity] Committing connection!', this.proximityCandidate)

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
		this.connector?.destroy()
		this.connector = null
		this.config.edgesLayerEl.replaceChildren()
		// Remove click handler
		if (this.paneClickHandler) {
			this.config.paneEl.removeEventListener('click', this.paneClickHandler)
			this.paneClickHandler = null
		}
		this.nodeLookup.clear()
		this.parentLookup.clear()
		this.nodes = []
		this.edges = []
		this.connectionInProgress = null
		this.selectedEdgeId = null
		this.reconnectingEdge = null
		this.menuConnectionCleanup?.()
	}
}
