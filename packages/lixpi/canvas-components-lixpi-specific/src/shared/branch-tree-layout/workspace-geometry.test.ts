import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type CanvasNode,
    type ImageCanvasNode,
} from '@lixpi/constants'
import { createLixpiCanvasSettings } from '../../frontend/settings/canvas-settings.ts'
import {
    WorkspaceGeometry,
    type WorkspaceGeometryPorts,
} from './workspace-geometry.ts'

function image(nodeId = 'image'): ImageCanvasNode {
    return { nodeId, type: 'image', assetId: nodeId, position: { x: 10, y: 20 }, dimensions: { width: 300, height: 180 } }
}

function setup(overrides: Partial<WorkspaceGeometryPorts> = {}) {
    const settings = createLixpiCanvasSettings()
    settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale = 0.5
    const pending = new Set<string>()
    const dimensions = new Map<string, CanvasNode['dimensions']>()
    const ports: WorkspaceGeometryPorts = {
        workspaceId: 'workspace',
        settings,
        getViewport: () => ({ x: 40, y: -20, zoom: 2 }),
        getPaneSize: () => ({ width: 800, height: 600 }),
        getWorldPosition: node => node.position,
        getWorldRect: node => ({ ...node.position, ...node.dimensions }),
        getLiveDimensions: nodeId => dimensions.get(nodeId),
        isPending: nodeId => pending.has(nodeId),
        ...overrides,
    }
    return { geometry: new WorkspaceGeometry(ports), settings, pending, dimensions }
}

describe('WorkspaceGeometry', () => {
    it('reserves the final media width while connectors attach to the compact pending circle', () => {
        const { geometry, pending } = setup()
        const node = image()
        pending.add(node.nodeId)
        expect(geometry.getCanvasNodeCollisionRect(node, node.position)).toEqual({ x: 10, y: 65, width: 300, height: 90 })
        expect(geometry.getCanvasNodeConnectorAnchorRect(node, node.position)).toEqual({ x: 115, y: 65, width: 90, height: 90 })
        pending.clear()
        expect(geometry.getCanvasNodeConnectorAnchorRect(node, node.position)).toEqual({ ...node.position, ...node.dimensions })
    })

    it('includes completed media chrome in collisions without moving connector anchors', () => {
        const { geometry } = setup()
        const node = image()
        const bounds = geometry.getCanvasNodeCollisionRect(node, node.position)
        expect(bounds.y).toBeLessThan(node.position.y)
        expect(bounds.y + bounds.height).toBeGreaterThan(node.position.y + node.dimensions.height)
        expect(geometry.getCanvasNodeConnectorAnchorRect(node, node.position)).toEqual({ ...node.position, ...node.dimensions })
        const plan = geometry.createCollisionPlan([node])
        expect(geometry.getResolvedNodePositionFromCollisionBox(node, plan.nodeBoxes[0], plan.entries)).toEqual(node.position)
    })

    it('uses live marker sizes without applying marker overrides to media dimensions', () => {
        const { geometry, dimensions } = setup()
        const marker: CanvasNode = { nodeId: 'marker', type: 'branchOrigin', branchId: 'branch', generationRequestId: 'request', temporary: true, position: { x: 0, y: 0 }, dimensions: { width: 40, height: 30 } }
        dimensions.set(marker.nodeId, { width: 80, height: 60 })
        dimensions.set('image', { width: 1, height: 1 })
        expect(geometry.getCanvasNodeCollisionRect(marker, marker.position)).toEqual({ x: 0, y: 0, width: 80, height: 60 })
        const node = image()
        expect(geometry.getCanvasNodeConnectorAnchorRect(node, node.position).width).toBe(300)
    })

    it('passes the complete scene to world-coordinate ports even when resolving only parents', () => {
        const parent = image('parent')
        const child = { ...image('child'), parentId: parent.nodeId }
        const { geometry } = setup({
            getWorldPosition: (node, nodesById) => {
                expect(nodesById.get('child')).toBe(child)
                return { x: node.position.x + 100, y: node.position.y + 200 }
            },
        })
        const plan = geometry.createCollisionPlan([parent, child], true)
        expect(plan.nodeBoxes.map(box => box.id)).toEqual(['parent'])
        expect(geometry.getResolvedNodePositionFromCollisionBox(parent, plan.nodeBoxes[0], plan.entries)).toEqual({ x: 110, y: 220 })
        expect(geometry.toParentRelativePosition({ x: 130, y: 250 }, parent.nodeId, new Map([[parent.nodeId, parent], [child.nodeId, child]]))).toEqual({ x: 20, y: 30 })
    })

    it('normalizes marker spacing without mutating the supplied collision flow', () => {
        const { geometry, settings } = setup()
        settings.mediaBranchLineage.nodeGap = -10
        const original = structuredClone(settings.workspaceCollision.dragRelease.nodeTypes.branchOrigin)
        const result = geometry.getBranchLineageCollisionSettings(original)
        expect(result).toEqual({ ...original, margin: 0 })
        expect(settings.workspaceCollision.dragRelease.nodeTypes.branchOrigin).toEqual(original)
    })

    it('separates overlapping parents through the engine and preserves child-local coordinates', () => {
        const { geometry } = setup()
        const first = image('first')
        const second = image('second')
        const child = { ...image('child'), parentId: first.nodeId }
        const nodes = [first, second, child]
        const result = geometry.resolveTopLevelNodeCollisions(nodes)
        expect(result[2]).toBe(child)
        expect(result[0].position).not.toEqual(result[1].position)
        expect(first.position).toEqual({ x: 10, y: 20 })
        expect(geometry.createGeneratedMediaRebalancePipeline().rebalance([], []).nodes).toEqual([])
    })

    it('uses the live viewport for insertion and rejects an unavailable visible area', () => {
        const { geometry } = setup()
        expect(geometry.getCenteredInsertionPosition({ width: 100, height: 80 })).toEqual({ x: 130, y: 120 })
        const missing = setup({ getPaneSize: () => ({ width: 0, height: 500 }) }).geometry
        expect(missing.getCanvasVisibleAreaForApiProjection()).toBeUndefined()
        const invalid = setup({ getViewport: () => ({ x: 0, y: 0, zoom: NaN }), getPaneSize: () => ({ width: 50, height: 50 }) })
        expect(invalid.geometry.getFreshBranchRootMarkerPosition({ width: 100, height: 100 })).toEqual({ x: invalid.settings.mediaBranchLineage.nodeGap, y: invalid.settings.mediaBranchLineage.nodeGap })
    })

    it('keeps pending state and settings independent between canvases', () => {
        const first = setup()
        const second = setup()
        first.pending.add('image')
        first.settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale = 1
        const node = image()
        expect(first.geometry.getPendingGeneratedMediaBeforeFrameCircleGeometry(node.nodeId, node.position, node.dimensions)?.dimensions.width).toBe(180)
        expect(second.geometry.getPendingGeneratedMediaBeforeFrameCircleGeometry(node.nodeId, node.position, node.dimensions)).toBeNull()
    })
})
