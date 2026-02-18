'use strict'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CanvasNode, WorkspaceEdge } from '@lixpi/constants'
import {
	WorkspaceConnectionManager,
	computeSpreadTValues,
	getEdgeAnchorPositions,
	type SpreadResult,
} from '$src/infographics/workspace/WorkspaceConnectionManager.ts'
import { webUiThemeSettings } from '$src/webUiThemeSettings.ts'

// =============================================================================
// HELPERS
// =============================================================================

function makeNode(overrides: Partial<CanvasNode> & { nodeId: string; type: CanvasNode['type'] }): CanvasNode {
	const base = {
		position: { x: 0, y: 0 },
		dimensions: { width: 200, height: 100 },
	}

	if (overrides.type === 'image') {
		return {
			...base,
			fileId: 'file-1',
			workspaceId: 'ws-1',
			src: 'test.jpg',
			aspectRatio: 1,
			...overrides,
		} as CanvasNode
	}

	return {
		...base,
		referenceId: 'ref-1',
		...overrides,
	} as CanvasNode
}

function makeEdge(overrides: Partial<WorkspaceEdge> & { edgeId: string; sourceNodeId: string; targetNodeId: string }): WorkspaceEdge {
	return {
		sourceHandle: 'right',
		targetHandle: 'left',
		sourceT: 0.5,
		targetT: 0.5,
		...overrides,
	}
}

function createMockConfig() {
	const paneEl = document.createElement('div')
	const viewportEl = document.createElement('div')
	const edgesLayerEl = document.createElement('div')

	return {
		paneEl,
		viewportEl,
		edgesLayerEl,
		getTransform: () => [0, 0, 1] as [number, number, number],
		panBy: vi.fn().mockResolvedValue(true),
		onEdgesChange: vi.fn(),
		onSelectedEdgeChange: vi.fn(),
	}
}

function createManager(config = createMockConfig()) {
	return { manager: new WorkspaceConnectionManager(config), config }
}

// =============================================================================
// PROXIMITY CONNECT — checkProximity
// =============================================================================

describe('WorkspaceConnectionManager — checkProximity', () => {
	let manager: WorkspaceConnectionManager
	let config: ReturnType<typeof createMockConfig>

	beforeEach(() => {
		const result = createManager()
		manager = result.manager
		config = result.config
	})

	// -------------------------------------------------------------------------
	// Basic detection
	// -------------------------------------------------------------------------

	it('detects proximity when image is dragged near aiChatThread (right→left)', () => {
		const imageNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imageNode, chatNode])
		manager.syncEdges([])

		// Drag image close to chat node's left side
		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })

		// Commit should produce a connection
		manager.commitProximityConnection()
		expect(config.onEdgesChange).toHaveBeenCalledTimes(1)

		const edges = config.onEdgesChange.mock.calls[0][0] as WorkspaceEdge[]
		expect(edges).toHaveLength(1)
		expect(edges[0].sourceNodeId).toBe('img-1')
		expect(edges[0].targetNodeId).toBe('chat-1')
		expect(edges[0].sourceHandle).toBe('right')
		expect(edges[0].targetHandle).toBe('left')
	})

	it('detects proximity when aiChatThread is dragged near image (other→dragged)', () => {
		const imageNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imageNode, chatNode])
		manager.syncEdges([])

		// Drag chat node close to image node's right side
		manager.checkProximity('chat-1', { x: 250, y: 50 }, { width: 200, height: 100 })

		manager.commitProximityConnection()
		expect(config.onEdgesChange).toHaveBeenCalledTimes(1)

		const edges = config.onEdgesChange.mock.calls[0][0] as WorkspaceEdge[]
		expect(edges).toHaveLength(1)
		expect(edges[0].sourceNodeId).toBe('img-1')
		expect(edges[0].targetNodeId).toBe('chat-1')
	})

	// -------------------------------------------------------------------------
	// Type restrictions
	// -------------------------------------------------------------------------

	it('does NOT trigger proximity between two image nodes', () => {
		const img1 = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const img2 = makeNode({ nodeId: 'img-2', type: 'image', position: { x: 250, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([img1, img2])
		manager.syncEdges([])

		manager.checkProximity('img-1', { x: 100, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	it('does NOT trigger proximity between two document nodes', () => {
		const doc1 = makeNode({ nodeId: 'doc-1', type: 'document', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const doc2 = makeNode({ nodeId: 'doc-2', type: 'document', position: { x: 250, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([doc1, doc2])
		manager.syncEdges([])

		manager.checkProximity('doc-1', { x: 100, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	it('triggers proximity between document and aiChatThread', () => {
		const docNode = makeNode({ nodeId: 'doc-1', type: 'document', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([docNode, chatNode])
		manager.syncEdges([])

		manager.checkProximity('doc-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).toHaveBeenCalledTimes(1)
		const edges = config.onEdgesChange.mock.calls[0][0] as WorkspaceEdge[]
		expect(edges[0].sourceNodeId).toBe('doc-1')
		expect(edges[0].targetNodeId).toBe('chat-1')
	})

	// -------------------------------------------------------------------------
	// Duplicate prevention
	// -------------------------------------------------------------------------

	it('does NOT trigger proximity if edge already exists between the same pair', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		const existingEdge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'img-1', targetNodeId: 'chat-1' })

		manager.syncNodes([imgNode, chatNode])
		manager.syncEdges([existingEdge])

		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	it('does NOT trigger proximity if existing edge connects dragged node to ANY other node', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode1 = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode2 = makeNode({ nodeId: 'chat-2', type: 'aiChatThread', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 100 } })

		const existingEdge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'img-1', targetNodeId: 'chat-2' })

		manager.syncNodes([imgNode, chatNode1, chatNode2])
		manager.syncEdges([existingEdge])

		// Drag near chat-1 (which has no connection yet)
		// But because img-1 is connected to chat-2, it should NOT trigger proximity for chat-1
		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	// -------------------------------------------------------------------------
	// Distance threshold
	// -------------------------------------------------------------------------

	it('does NOT trigger proximity if nodes are too far apart', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 5000, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imgNode, chatNode])
		manager.syncEdges([])

		manager.checkProximity('img-1', { x: 0, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	// -------------------------------------------------------------------------
	// Candidate clearing
	// -------------------------------------------------------------------------

	it('clears candidate when node is dragged away', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imgNode, chatNode])
		manager.syncEdges([])

		// First: drag close — candidate found
		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })

		// Then: drag far away — candidate cleared
		manager.checkProximity('img-1', { x: -5000, y: 50 }, { width: 200, height: 100 })

		manager.commitProximityConnection()
		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	// -------------------------------------------------------------------------
	// Unknown node
	// -------------------------------------------------------------------------

	it('does nothing if dragged node is not in the node list', () => {
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([chatNode])
		manager.syncEdges([])

		manager.checkProximity('unknown-node', { x: 300, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	// -------------------------------------------------------------------------
	// Closest candidate
	// -------------------------------------------------------------------------

	it('picks the closest aiChatThread when multiple are nearby', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatFar = makeNode({ nodeId: 'chat-far', type: 'aiChatThread', position: { x: 600, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatClose = makeNode({ nodeId: 'chat-close', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imgNode, chatFar, chatClose])
		manager.syncEdges([])

		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		expect(config.onEdgesChange).toHaveBeenCalledTimes(1)
		const edges = config.onEdgesChange.mock.calls[0][0] as WorkspaceEdge[]
		expect(edges[0].targetNodeId).toBe('chat-close')
	})
})

// =============================================================================
// PROXIMITY CONNECT — commitProximityConnection
// =============================================================================

describe('WorkspaceConnectionManager — commitProximityConnection', () => {
	let manager: WorkspaceConnectionManager
	let config: ReturnType<typeof createMockConfig>

	beforeEach(() => {
		const result = createManager()
		manager = result.manager
		config = result.config
	})

	it('does nothing when there is no proximity candidate', () => {
		manager.syncNodes([])
		manager.syncEdges([])

		manager.commitProximityConnection()
		expect(config.onEdgesChange).not.toHaveBeenCalled()
	})

	it('creates an edge with generated ID starting with "edge-"', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imgNode, chatNode])
		manager.syncEdges([])

		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		const edges = config.onEdgesChange.mock.calls[0][0] as WorkspaceEdge[]
		expect(edges[0].edgeId).toMatch(/^edge-/)
	})

	it('appends to existing edges', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })
		const docNode = makeNode({ nodeId: 'doc-1', type: 'document', position: { x: 0, y: 200 }, dimensions: { width: 200, height: 100 } })

		const existingEdge = makeEdge({ edgeId: 'e-existing', sourceNodeId: 'doc-1', targetNodeId: 'chat-1' })

		manager.syncNodes([imgNode, chatNode, docNode])
		manager.syncEdges([existingEdge])

		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()

		const edges = config.onEdgesChange.mock.calls[0][0] as WorkspaceEdge[]
		expect(edges).toHaveLength(2)
		expect(edges[0].edgeId).toBe('e-existing')
		expect(edges[1].sourceNodeId).toBe('img-1')
	})

	it('clears candidate after commit (second commit is no-op)', () => {
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 0, y: 50 }, dimensions: { width: 200, height: 100 } })
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 300, y: 50 }, dimensions: { width: 200, height: 100 } })

		manager.syncNodes([imgNode, chatNode])
		manager.syncEdges([])

		manager.checkProximity('img-1', { x: 150, y: 50 }, { width: 200, height: 100 })
		manager.commitProximityConnection()
		manager.commitProximityConnection() // second call

		expect(config.onEdgesChange).toHaveBeenCalledTimes(1)
	})
})

// =============================================================================
// getEdgeAnchorPositions
// =============================================================================

describe('getEdgeAnchorPositions', () => {
	it('returns right/left for default edge handles', () => {
		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 's', targetNodeId: 't', sourceHandle: 'right', targetHandle: 'left' })
		const { source, target } = getEdgeAnchorPositions(edge)

		expect(source).toBe('right')
		expect(target).toBe('left')
	})

	it('returns left for sourceHandle=left', () => {
		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 's', targetNodeId: 't', sourceHandle: 'left', targetHandle: 'right' })
		const { source, target } = getEdgeAnchorPositions(edge)

		expect(source).toBe('left')
		expect(target).toBe('right')
	})

	it('defaults to right when sourceHandle is undefined', () => {
		const edge: WorkspaceEdge = { edgeId: 'e-1', sourceNodeId: 's', targetNodeId: 't' }
		const { source, target } = getEdgeAnchorPositions(edge)

		expect(source).toBe('right')
		expect(target).toBe('right')
	})
})

// =============================================================================
// computeSpreadTValues — targetT auto-alignment
// =============================================================================

describe('computeSpreadTValues — targetT auto-alignment', () => {
	it('aligns targetT to straight line when source center hits target vertically', () => {
		// Source center at y=50 (0 + 100/2), target at y=0..100
		// idealT = (50 - 0) / 100 = 0.5 → straight line through center
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })

		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge], [source, target])

		const spread = result.get('e-1')!
		expect(spread.targetT).toBe(0.5) // perfectly aligned
	})

	it('snaps targetT to top when source is above target', () => {
		// Source center at y=50, target at y=200..400
		// idealT = (50 - 200) / 200 = -0.75 → clamp to 0.025
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 200 } })

		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge], [source, target])

		const spread = result.get('e-1')!
		expect(spread.targetT).toBe(0.025) // clamped to top
	})

	it('snaps targetT to bottom when source is below target', () => {
		// Source center at y=550, target at y=0..200
		// idealT = (550 - 0) / 200 = 2.75 → clamp to 0.975
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 500 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 200 } })

		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge], [source, target])

		const spread = result.get('e-1')!
		expect(spread.targetT).toBe(0.975) // clamped to bottom
	})

	it('calculates partial alignment when source is slightly above target center', () => {
		// Source center at y=150 (100 + 100/2), target at y=200..400 (height=200)
		// idealT = (150 - 200) / 200 = -0.25 → clamp to 0.025
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 100 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 200 } })

		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge], [source, target])

		const spread = result.get('e-1')!
		expect(spread.targetT).toBe(0.025)
	})

	it('uses stored targetT when nodes are missing from the lookup', () => {
		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'missing-src', targetNodeId: 'missing-tgt', targetT: 0.75 })
		const result = computeSpreadTValues([edge], [])

		const spread = result.get('e-1')!
		expect(spread.targetT).toBe(0.75) // falls back to stored value
	})

	it('clamps using webUiThemeSettings.aiChatThreadRailEdgeMargin', () => {
		const original = webUiThemeSettings.aiChatThreadRailEdgeMargin

		// Temporarily set a larger margin
		;(webUiThemeSettings as Record<string, unknown>).aiChatThreadRailEdgeMargin = 0.1

		try {
			// Source far above target → should clamp to 0.1 (not 0.025)
			const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
			const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 500 }, dimensions: { width: 200, height: 200 } })
			const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
			const result = computeSpreadTValues([edge], [source, target])

			const spread = result.get('e-1')!
			expect(spread.targetT).toBe(0.1)

			// Source far below target → should clamp to 0.9 (1 - 0.1)
			const source2 = makeNode({ nodeId: 'src2', type: 'aiChatThread', position: { x: 0, y: 900 }, dimensions: { width: 200, height: 100 } })
			const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src2', targetNodeId: 'tgt' })
			const result2 = computeSpreadTValues([edge2], [source2, target])

			const spread2 = result2.get('e-2')!
			expect(spread2.targetT).toBe(0.9)
		} finally {
			;(webUiThemeSettings as Record<string, unknown>).aiChatThreadRailEdgeMargin = original
		}
	})

	it('snaps targetT to 0.5 when target height is below aiChatThreadRailMinSlideHeight', () => {
		const original = webUiThemeSettings.aiChatThreadRailMinSlideHeight
		;(webUiThemeSettings as Record<string, unknown>).aiChatThreadRailMinSlideHeight = 200

		try {
			// Target height (100) is below threshold (200) → snap to center
			const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
			const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })
			const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
			const result = computeSpreadTValues([edge], [source, target])

			expect(result.get('e-1')!.targetT).toBe(0.5)
		} finally {
			;(webUiThemeSettings as Record<string, unknown>).aiChatThreadRailMinSlideHeight = original
		}
	})

	it('slides freely when target height meets aiChatThreadRailMinSlideHeight threshold', () => {
		const original = webUiThemeSettings.aiChatThreadRailMinSlideHeight
		;(webUiThemeSettings as Record<string, unknown>).aiChatThreadRailMinSlideHeight = 200

		try {
			// Target height (300) exceeds threshold (200) → slide freely
			const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
			const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 300 } })
			const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
			const result = computeSpreadTValues([edge], [source, target])

			// Source center at y=50, target 0..300 → idealT ≈ 0.167
			const spread = result.get('e-1')!
			expect(spread.targetT).not.toBe(0.5)
			expect(spread.targetT).toBeGreaterThan(0)
			expect(spread.targetT).toBeLessThan(1)
		} finally {
			;(webUiThemeSettings as Record<string, unknown>).aiChatThreadRailMinSlideHeight = original
		}
	})
})

// =============================================================================
// computeSpreadTValues — sourceT spreading
// =============================================================================

describe('computeSpreadTValues — sourceT spreading', () => {
	it('keeps sourceT at 0.5 for a single edge', () => {
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })

		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge], [source, target])

		expect(result.get('e-1')!.sourceT).toBe(0.5)
	})

	it('spreads sourceT values for two edges sharing the same source', () => {
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 600 } })
		const target1 = makeNode({ nodeId: 'tgt-1', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })
		const target2 = makeNode({ nodeId: 'tgt-2', type: 'image', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 100 } })

		const edge1 = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt-1' })
		const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src', targetNodeId: 'tgt-2' })
		const result = computeSpreadTValues([edge1, edge2], [source, target1, target2])

		const t1 = result.get('e-1')!.sourceT
		const t2 = result.get('e-2')!.sourceT

		// They should be different (spread out, not both 0.5)
		expect(t1).not.toBe(t2)
		// Ordered: top target → smaller sourceT, bottom target → larger sourceT
		expect(t1).toBeLessThan(t2)
		// Both within 0.35–0.65 range
		expect(t1).toBeGreaterThanOrEqual(0.35)
		expect(t2).toBeLessThanOrEqual(0.65)
	})
})

// =============================================================================
// computeSpreadTValues — lane assignment
// =============================================================================

describe('computeSpreadTValues — lane assignment', () => {
	it('assigns laneIndex 0 and laneCount 1 for a single edge', () => {
		const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })

		const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge], [source, target])

		expect(result.get('e-1')!.laneIndex).toBe(0)
		expect(result.get('e-1')!.laneCount).toBe(1)
	})

	it('assigns increasing laneIndex for edges sharing the same target', () => {
		const src1 = makeNode({ nodeId: 'src-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
		const src2 = makeNode({ nodeId: 'src-2', type: 'document', position: { x: 0, y: 200 }, dimensions: { width: 200, height: 100 } })
		const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 100 }, dimensions: { width: 200, height: 100 } })

		const edge1 = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src-1', targetNodeId: 'tgt' })
		const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src-2', targetNodeId: 'tgt' })
		const result = computeSpreadTValues([edge1, edge2], [src1, src2, target])

		// Both should have laneCount = 2
		expect(result.get('e-1')!.laneCount).toBe(2)
		expect(result.get('e-2')!.laneCount).toBe(2)

		// Sorted by sourceY: src-1 (y=50) is first, src-2 (y=250) is second
		expect(result.get('e-1')!.laneIndex).toBe(0)
		expect(result.get('e-2')!.laneIndex).toBe(1)
	})
})

// =============================================================================
// computeMessageSourceT — via registerNodeElement
// =============================================================================

describe('WorkspaceConnectionManager — computeMessageSourceT', () => {
	let manager: WorkspaceConnectionManager
	let config: ReturnType<typeof createMockConfig>

	beforeEach(() => {
		const result = createManager()
		manager = result.manager
		config = result.config
	})

	it('returns null (falls back to default) when node element is not registered', () => {
		// computeMessageSourceT is private — we test its effect through render():
		// If the node element is not registered, sourceMessageId has no effect and
		// the default sourceT from computeSpreadTValues is used.

		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 600 } })
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 400, y: 0 }, dimensions: { width: 400, height: 400 } })

		const edge = makeEdge({
			edgeId: 'e-1',
			sourceNodeId: 'chat-1',
			targetNodeId: 'img-1',
			sourceMessageId: 'msg-abc',
		})

		manager.syncNodes([chatNode, imgNode])
		manager.syncEdges([edge])

		// render() should not throw even when node element is missing
		expect(() => manager.render()).not.toThrow()
	})

	it('finds data-message-id in registered node element and adjusts source anchor', () => {
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 600 } })
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 400, y: 0 }, dimensions: { width: 400, height: 400 } })

		// Create a mock DOM element with a data-message-id child
		const nodeEl = document.createElement('div')
		const messageEl = document.createElement('div')
		messageEl.setAttribute('data-message-id', 'msg-abc')
		nodeEl.appendChild(messageEl)

		// Mock getBoundingClientRect for both elements
		vi.spyOn(nodeEl, 'getBoundingClientRect').mockReturnValue({
			top: 0, bottom: 600, left: 0, right: 300, width: 300, height: 600, x: 0, y: 0, toJSON: () => ({})
		})
		vi.spyOn(messageEl, 'getBoundingClientRect').mockReturnValue({
			top: 100, bottom: 150, left: 0, right: 300, width: 300, height: 50, x: 0, y: 100, toJSON: () => ({})
		})

		manager.syncNodes([chatNode, imgNode])
		manager.syncEdges([makeEdge({
			edgeId: 'e-1',
			sourceNodeId: 'chat-1',
			targetNodeId: 'img-1',
			sourceMessageId: 'msg-abc',
		})])

		// Register the node element so computeMessageSourceT can find it
		manager.registerNodeElement('chat-1', nodeEl as HTMLDivElement)

		// render() should succeed — the message element will be found
		expect(() => manager.render()).not.toThrow()
	})

	it('does not find message element when data-message-id does not match', () => {
		const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 600 } })
		const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 400, y: 0 }, dimensions: { width: 400, height: 400 } })

		const nodeEl = document.createElement('div')
		const messageEl = document.createElement('div')
		messageEl.setAttribute('data-message-id', 'different-msg')
		nodeEl.appendChild(messageEl)

		manager.syncNodes([chatNode, imgNode])
		manager.syncEdges([makeEdge({
			edgeId: 'e-1',
			sourceNodeId: 'chat-1',
			targetNodeId: 'img-1',
			sourceMessageId: 'msg-abc',
		})])

		manager.registerNodeElement('chat-1', nodeEl as HTMLDivElement)

		// Should not throw — falls back to default sourceT
		expect(() => manager.render()).not.toThrow()
	})
})

// =============================================================================
// railOffset — connection proxy for vertical rail
// =============================================================================

describe('WorkspaceConnectionManager — railOffset', () => {
	it('config type accepts optional railOffset', () => {
		const config = {
			...createMockConfig(),
			railOffset: 5,
		}
		const mgr = new WorkspaceConnectionManager(config)
		expect(mgr).toBeTruthy()
	})

	it('checkProximity applies railOffset to aiChatThread left anchor', () => {
		const config = { ...createMockConfig(), railOffset: 5 }
		const mgr = new WorkspaceConnectionManager(config)

		// Place the chat thread at x=500; with railOffset=5, its left anchor
		// sits at x=495. An image at x=300 has its right handle at x=300+200=500.
		// Without offset: distance = |500-500| = 0 (perfect snap)
		// With offset: distance = |500-495| = 5 (still close enough)
		const chatNode = makeNode({
			nodeId: 'chat-1', type: 'aiChatThread',
			position: { x: 500, y: 0 }, dimensions: { width: 300, height: 200 },
		})
		const imgNode = makeNode({
			nodeId: 'img-1', type: 'image',
			position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 },
		})

		mgr.syncNodes([chatNode, imgNode])
		mgr.syncEdges([])

		// Dragging the image at its current position
		mgr.checkProximity('img-1', { x: 300, y: 0 }, { width: 200, height: 100 })

		// Should find a proximity candidate (the chat thread)
		expect((mgr as any).proximityCandidate).not.toBeNull()
		expect((mgr as any).proximityCandidate.targetNodeId).toBe('chat-1')
	})

	it('render does not throw with railOffset set', () => {
		const config = { ...createMockConfig(), railOffset: 5 }
		const mgr = new WorkspaceConnectionManager(config)

		const chatNode = makeNode({
			nodeId: 'chat-1', type: 'aiChatThread',
			position: { x: 0, y: 0 }, dimensions: { width: 300, height: 200 },
		})
		const imgNode = makeNode({
			nodeId: 'img-1', type: 'image',
			position: { x: 400, y: 0 }, dimensions: { width: 200, height: 100 },
		})
		const edge = makeEdge({
			edgeId: 'e-1',
			sourceNodeId: 'img-1',
			targetNodeId: 'chat-1',
		})

		mgr.syncNodes([chatNode, imgNode])
		mgr.syncEdges([edge])

		expect(() => mgr.render()).not.toThrow()
	})

	it('setRailHeight stores height and getRailHeight retrieves it', () => {
		const config = { ...createMockConfig(), railOffset: 5 }
		const mgr = new WorkspaceConnectionManager(config)

		expect(mgr.getRailHeight('chat-1')).toBeUndefined()
		mgr.setRailHeight('chat-1', 500)
		expect(mgr.getRailHeight('chat-1')).toBe(500)
	})

	it('clearRailHeights removes all stored heights', () => {
		const config = { ...createMockConfig(), railOffset: 5 }
		const mgr = new WorkspaceConnectionManager(config)

		mgr.setRailHeight('chat-1', 500)
		mgr.setRailHeight('chat-2', 600)
		mgr.clearRailHeights()
		expect(mgr.getRailHeight('chat-1')).toBeUndefined()
		expect(mgr.getRailHeight('chat-2')).toBeUndefined()
	})

	it('render uses railHeight for aiChatThread node config height', () => {
		const config = { ...createMockConfig(), railOffset: 5 }
		const mgr = new WorkspaceConnectionManager(config)

		const chatNode = makeNode({
			nodeId: 'chat-1', type: 'aiChatThread',
			position: { x: 0, y: 0 }, dimensions: { width: 300, height: 200 },
		})
		const imgNode = makeNode({
			nodeId: 'img-1', type: 'image',
			position: { x: 400, y: 0 }, dimensions: { width: 200, height: 100 },
		})
		const edge = makeEdge({
			edgeId: 'e-1',
			sourceNodeId: 'img-1',
			targetNodeId: 'chat-1',
		})

		mgr.syncNodes([chatNode, imgNode])
		mgr.syncEdges([edge])
		mgr.setRailHeight('chat-1', 500)

		expect(() => mgr.render()).not.toThrow()
	})
})
