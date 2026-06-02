'use strict'

import { describe, expect, it } from 'vitest'
import type {
	BranchOriginCanvasNode,
	CanvasState,
	ImageCanvasNode,
	VideoCanvasNode,
} from '@lixpi/constants'
import {
	getBranchOriginReferenceNodes,
	getBranchOriginRenderDatums,
	hitTestBranchOrigin,
} from '$src/infographics/workspace/rendering/branchOrigins.ts'

function imageNode(nodeId: string): ImageCanvasNode {
	return {
		nodeId,
		type: 'image',
		fileId: `${nodeId}-file`,
		workspaceId: 'workspace-1',
		src: `/api/images/workspace-1/${nodeId}-file`,
		aspectRatio: 1,
		position: { x: 20, y: 30 },
		dimensions: { width: 100, height: 100 },
	}
}

function videoNode(nodeId: string): VideoCanvasNode {
	return {
		nodeId,
		type: 'video',
		fileId: `${nodeId}-mp4`,
		posterFileId: `${nodeId}-poster`,
		frameFileId: `${nodeId}-frame`,
		workspaceId: 'workspace-1',
		src: `/api/videos/workspace-1/${nodeId}-mp4`,
		posterSrc: `/api/images/workspace-1/${nodeId}-poster`,
		aspectRatio: 16 / 9,
		durationSeconds: 4,
		hasAudio: false,
		position: { x: 280, y: 40 },
		dimensions: { width: 160, height: 90 },
	}
}

function branchOrigin(overrides: Partial<BranchOriginCanvasNode> = {}): BranchOriginCanvasNode {
	return {
		nodeId: 'branch-origin-1',
		type: 'branchOrigin',
		branchId: 'branch-1',
		prompt: 'Make the goat dance',
		referenceNodeIds: ['image-1', 'video-1'],
		referenceFileIds: ['image-1-file', 'video-1-frame'],
		position: { x: 140, y: 64 },
		dimensions: { width: 64, height: 64 },
		createdAt: 123,
		...overrides,
	}
}

function canvasState(nodes: CanvasState['nodes']): CanvasState {
	return {
		sourceContext: {} as CanvasState['sourceContext'],
		nodes,
		edges: [],
	}
}

describe('branch origin render helpers', () => {
	it('builds viewport render data and selected state from persisted branch-origin nodes', () => {
		const datums = getBranchOriginRenderDatums(
			canvasState([imageNode('image-1'), branchOrigin()]),
			new Set(['branch-origin-1'])
		)

		expect(datums).toHaveLength(1)
		expect(datums[0]).toMatchObject({
			nodeId: 'branch-origin-1',
			branchId: 'branch-1',
			prompt: 'Make the goat dance',
			x: 140,
			y: 64,
			width: 64,
			height: 64,
			selected: true,
		})
	})

	it('hit-tests the branch-origin circle, not the square proxy bounds', () => {
		const [datum] = getBranchOriginRenderDatums(canvasState([branchOrigin()]))

		expect(hitTestBranchOrigin([datum], { x: 172, y: 96 })?.nodeId).toBe('branch-origin-1')
		expect(hitTestBranchOrigin([datum], { x: 140, y: 64 })).toBeUndefined()
	})

	it('returns only media reference nodes for the info panel thumbnail strip', () => {
		const origin = branchOrigin()
		const references = getBranchOriginReferenceNodes(origin, [
			imageNode('image-1'),
			videoNode('video-1'),
			branchOrigin({ nodeId: 'nested-origin', referenceNodeIds: [] }),
		])

		expect(references.map((node) => node.nodeId)).toEqual(['image-1', 'video-1'])
	})
})
