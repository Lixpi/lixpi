'use strict'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CanvasNode, WorkspaceEdge } from '@lixpi/constants'
import { WorkspaceConnectionManager } from '$src/infographics/workspace/WorkspaceConnectionManager.ts'

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
