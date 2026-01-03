'use strict'

import {
	XYHandle,
	ConnectionMode,
	adoptUserNodes,
	updateNodeInternals,
	type ConnectionInProgress,
	type Transform,
	type NodeBase,
	type InternalNodeBase,
	type NodeLookup,
	type ParentLookup,
	type HandleType,
	type Connection,
} from '@xyflow/system'

import {
	createConnectorRenderer,
	type ConnectorRenderer,
	type EdgeConfig,
	type NodeConfig,
} from '../connectors/index.ts'

import type {
	CanvasNode,
	WorkspaceEdge,
} from '@lixpi/constants'

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

function getEdgeAnchorPositions(edge: WorkspaceEdge): { source: 'left' | 'right'; target: 'left' | 'right' } {
	const source = edge.sourceHandle?.startsWith('left') ? 'left' : 'right'
	const target = edge.targetHandle?.startsWith('right') ? 'right' : 'left'
	return { source, target }
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

export class WorkspaceConnectionManager {
	private readonly config: ConnectionManagerConfig

	private readonly nodeLookup: NodeLookup<InternalNodeBase> = new Map()
	private readonly parentLookup: ParentLookup<InternalNodeBase> = new Map()

	private nodes: CanvasNode[] = []
	private edges: WorkspaceEdge[] = []

	private connector: ConnectorRenderer | null = null
	private lastRenderBoundsKey: string | null = null

	private selectedEdgeId: string | null = null
	private connectionInProgress: ConnectionInProgress | null = null

	private reconnectingEdge: { edgeId: string; edgeUpdaterType: HandleType } | null = null

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
			measured: { width: n.dimensions.width, height: n.dimensions.height }
		}))

		adoptUserNodes(xyNodes, this.nodeLookup, this.parentLookup, {
			nodeOrigin: [0, 0],
			elevateNodesOnSelect: false
		})
	}

	public registerNodeElement(nodeId: string, nodeElement: HTMLDivElement) {
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

				const nextEdge: WorkspaceEdge = {
					edgeId: generateEdgeId(),
					sourceNodeId: connection.source,
					targetNodeId: connection.target,
					sourceHandle: connection.sourceHandle ?? undefined,
					targetHandle: connection.targetHandle ?? undefined,
				}

				this.config.onEdgesChange([...this.edges, nextEdge])
				this.selectEdge(nextEdge.edgeId)
			},

			onReconnectEnd: (_event: MouseEvent | TouchEvent, finalState: ConnectionInProgress) => {
				if (!this.reconnectingEdge) {
					return
				}

				if (!finalState.toNode) {
					return
				}

				const edgeToUpdate = this.edges.find((e) => e.edgeId === this.reconnectingEdge?.edgeId)
				if (!edgeToUpdate) {
					return
				}

				const updatedEdge: WorkspaceEdge = { ...edgeToUpdate }

				if (this.reconnectingEdge.edgeUpdaterType === 'source') {
					updatedEdge.sourceNodeId = finalState.toNode.id
					updatedEdge.sourceHandle = finalState.toHandle?.id ?? undefined
				} else {
					updatedEdge.targetNodeId = finalState.toNode.id
					updatedEdge.targetHandle = finalState.toHandle?.id ?? undefined
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

	private computeRenderBounds(): RenderBounds | null {
		if (!this.edges.length && !this.connectionInProgress) {
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
		for (const n of this.nodes) {
			const nodeConfig: NodeConfig = {
				id: n.nodeId,
				shape: 'rect',
				x: n.position.x - offsetX,
				y: n.position.y - offsetY,
				width: n.dimensions.width,
				height: n.dimensions.height,
				className: 'workspace-edge-node'
			}
			this.connector.addNode(nodeConfig)
		}

		// Add committed edges
		for (const e of this.edges) {
			const { source, target } = getEdgeAnchorPositions(e)

			const edgeConfig: EdgeConfig = {
				id: e.edgeId,
				source: { nodeId: e.sourceNodeId, position: source },
				target: { nodeId: e.targetNodeId, position: target },
				pathType: 'horizontal-bezier',
				marker: 'arrowhead',
				markerSize: 12,
				markerOffset: { source: 5, target: 10 },
				strokeWidth: e.edgeId === this.selectedEdgeId ? 3 : 2,
				className: `workspace-edge ${e.edgeId === this.selectedEdgeId ? 'is-selected' : ''}`
			}

			this.connector.addEdge(edgeConfig)
		}

		// Add in-progress edge
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

			const tempEdge: EdgeConfig = {
				id: '__workspace-temp-edge',
				source: {
					nodeId: this.connectionInProgress.fromHandle.nodeId,
					position: this.connectionInProgress.fromHandle.position as any
				},
				target: { nodeId: tempNodeId, position: 'center' },
				pathType: 'horizontal-bezier',
				marker: 'none',
				strokeWidth: 2,
				lineStyle: 'dashed',
				className: 'workspace-edge workspace-edge-temp'
			}
			this.connector.addEdge(tempEdge)
		}

		this.connector.render()

		this.attachEdgeInteractionHandlers()
	}

	private attachEdgeInteractionHandlers() {
		const svg = this.config.edgesLayerEl.querySelector('svg')
		if (!svg) return

		// Remove old hitareas to avoid stacking
		svg.querySelectorAll('path.workspace-edge-hitarea').forEach((p) => p.remove())

		const paths = Array.from(svg.querySelectorAll('path.connector-edge')) as SVGPathElement[]

		for (const path of paths) {
			const id = path.getAttribute('id')
			if (!id?.startsWith('edge-')) continue

			const edgeId = id.slice('edge-'.length)
			if (edgeId.startsWith('__workspace-temp')) continue

			const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
			hit.setAttribute('d', path.getAttribute('d') ?? '')
			hit.setAttribute('class', 'workspace-edge-hitarea')
			hit.setAttribute('data-edge-id', edgeId)
			hit.setAttribute('fill', 'none')
			hit.setAttribute('stroke', 'transparent')
			hit.setAttribute('stroke-width', '14')
			hit.style.pointerEvents = 'stroke'

			hit.addEventListener('click', (e) => {
				e.preventDefault()
				e.stopPropagation()
				this.selectEdge(edgeId)
			})

			// Add on top of the visible path for easier hit target
			path.parentElement?.appendChild(hit)
		}
	}

	public destroy() {
		this.connector?.destroy()
		this.connector = null
		this.config.edgesLayerEl.replaceChildren()
		this.nodeLookup.clear()
		this.parentLookup.clear()
		this.nodes = []
		this.edges = []
		this.connectionInProgress = null
		this.selectedEdgeId = null
		this.reconnectingEdge = null
	}
}
