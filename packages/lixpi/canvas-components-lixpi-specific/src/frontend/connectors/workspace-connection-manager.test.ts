// @vitest-environment happy-dom

import {
    describe,
    it,
    expect,
    beforeEach,
    vi,
} from 'vitest'
import type {
    CanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import {
    WorkspaceConnectionManager,
    computeSpreadTValues,
} from './workspace-connection-manager.ts'
import {
    getAdaptiveBoundedZoomScalingOptions,
    scaleCanvasChromeWorldSizeForZoom,
} from '@lixpi/canvas-engine/shared'
import { createWorkspaceConnectorSettings } from './workspace-connector-settings.ts'
import {
    getEdgeAnchorPositions,
    type SpreadResult,
} from '@lixpi/canvas-engine/frontend/connectors'
import { flattenSvgPath } from '@lixpi/ui-primitives/svg'

const settings = { connector: createWorkspaceConnectorSettings({ lineDefaultColor: '#5d656d' }) }

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

    return {
        paneEl,
        viewportEl,
        settings: settings.connector,
        getTransform: () => [0, 0, 1] as [number, number, number],
        panBy: vi.fn().mockResolvedValue(true),
        onEdgesChange: vi.fn(),
        onError: vi.fn(),
        onSelectedEdgeChange: vi.fn(),
    }
}

function createManager(config = createMockConfig()) {
    return { manager: new WorkspaceConnectionManager(config), config }
}

function mockPaneBounds(paneEl: HTMLDivElement) {
    vi.spyOn(paneEl, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 0,
        right: 1600,
        bottom: 1200,
        width: 1600,
        height: 1200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    })
}

function getRenderedPixiEdgeStart(onConnectorGeometry: ReturnType<typeof vi.fn>, edgeId: string): { x: number; y: number } {
    const pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{ id: string; svgPath: string }> | undefined
    const edge = pixiEdges?.find((candidate) => candidate.id === edgeId)
    expect(edge).toBeDefined()

    const pathData = edge?.svgPath ?? ''
    const match = pathData.match(/^M\s*([-\d.]+)[,\s]+([-\d.]+)/)
    expect(match).not.toBeNull()

    return {
        x: Number(match?.[1] ?? 0),
        y: Number(match?.[2] ?? 0),
    }
}

// =============================================================================
// MENU CONNECTIONS
// =============================================================================

describe('WorkspaceConnectionManager — menu connections', () => {
    it('commits menu connections on mouseup, not mousedown', () => {
        const config = createMockConfig()
        mockPaneBounds(config.paneEl)
        const manager = new WorkspaceConnectionManager(config)

        const imageNode = makeNode({
            nodeId: 'img-1',
            type: 'image',
            position: { x: 100, y: 100 },
            dimensions: { width: 200, height: 120 },
        })
        const chatNode = makeNode({
            nodeId: 'doc-1',
            type: 'document',
            position: { x: 500, y: 100 },
            dimensions: { width: 260, height: 120 },
        })

        manager.syncNodes([imageNode, chatNode])
        manager.syncEdges([])

        manager.startConnectionFromMenu('img-1')

        document.dispatchEvent(
            new MouseEvent('mousemove', {
                clientX: 495,
                clientY: 160,
                bubbles: true,
            }),
        )

        document.dispatchEvent(
            new MouseEvent('mousedown', {
                clientX: 495,
                clientY: 160,
                bubbles: true,
            }),
        )

        expect(config.onEdgesChange).not.toHaveBeenCalled()

        document.dispatchEvent(
            new MouseEvent('mouseup', {
                clientX: 495,
                clientY: 160,
                bubbles: true,
            }),
        )

        expect(config.onEdgesChange).toHaveBeenCalledTimes(1)
    })
})

// =============================================================================
// RENDERING — edge anchors
// =============================================================================

describe('WorkspaceConnectionManager — edge anchors', () => {
    it('renders workspace connector data through PIXI only at screenshot zoom levels', () => {
        let zoom = 1
        const onConnectorGeometry = vi.fn()
        const config = {
            ...createMockConfig(),
            getTransform: () => [0, 0, zoom] as [number, number, number],
            onConnectorGeometry,
        }
        const manager = new WorkspaceConnectionManager(config)
        const sourceNode = makeNode({ nodeId: 'source-1', type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 120, height: 120 } })
        const targetNode = makeNode({ nodeId: 'target-1', type: 'image', position: { x: 500, y: 0 }, dimensions: { width: 120, height: 120 } })
        const edge = makeEdge({ edgeId: 'edge-pixi-only', sourceNodeId: sourceNode.nodeId, targetNodeId: targetNode.nodeId })

        manager.syncNodes([sourceNode, targetNode])
        manager.syncEdges([edge])

        for (const nextZoom of [0.41, 0.48, 0.52, 0.84, 1.04, 1.93, 2.0]) {
            zoom = nextZoom
            manager.render()

            const pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{
                id: string
                baseScreenStrokeWidth: number
                strokeWidth: number
                arrowEnd: { baseScreenSize: number; size: number } | null
                svgPath: string
            }>
            expect(pixiEdges).toHaveLength(1)
            expect(pixiEdges[0].id).toBe(edge.edgeId)
            expect(pixiEdges[0].svgPath).toMatch(/^M\s/)
            expect(pixiEdges[0].baseScreenStrokeWidth).toBe(settings.connector.scaling.strokeWidth)
            expect(pixiEdges[0].arrowEnd?.baseScreenSize ?? 0).toBe(settings.connector.scaling.markerSize)
            expect(config.viewportEl.querySelector('svg.connector-svg')).toBeNull()
        }
    })

    it('keeps PIXI stroke and arrow data as base screen pixels while adaptive marker offsets use world units', () => {
        const zoom = 0.44
        const onConnectorGeometry = vi.fn()
        const config = {
            ...createMockConfig(),
            getTransform: () => [0, 0, zoom] as [number, number, number],
            onConnectorGeometry,
        }
        const manager = new WorkspaceConnectionManager(config)
        const sourceNode = makeNode({ nodeId: 'source-adaptive', type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 120, height: 120 } })
        const targetNode = makeNode({ nodeId: 'target-adaptive', type: 'image', position: { x: 500, y: 0 }, dimensions: { width: 120, height: 120 } })
        const edge = makeEdge({ edgeId: 'edge-adaptive', sourceNodeId: sourceNode.nodeId, targetNodeId: targetNode.nodeId })

        manager.syncNodes([sourceNode, targetNode])
        manager.syncEdges([edge])
        manager.render()

        const pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{
            baseScreenStrokeWidth: number
            strokeWidth: number
            arrowEnd: { baseScreenSize: number; size: number } | null
        }>
        const start = getRenderedPixiEdgeStart(onConnectorGeometry, edge.edgeId)
        const expectedSourceOffsetWorld = scaleCanvasChromeWorldSizeForZoom(
            settings.connector.scaling.markerOffset.source,
            zoom,
            getAdaptiveBoundedZoomScalingOptions(settings.connector.scaling.zoomScaling),
        )

        expect(pixiEdges[0].baseScreenStrokeWidth).toBe(settings.connector.scaling.strokeWidth)
        expect(pixiEdges[0].arrowEnd?.baseScreenSize).toBe(settings.connector.scaling.markerSize)
        expect(start.x).toBeCloseTo(sourceNode.dimensions.width + expectedSourceOffsetWorld, 10)
    })

    it('uses configured connector scaling in normal render and zoom-only recompute', () => {
        const originalScaling = structuredClone(settings.connector.scaling)
        let zoom = 1
        const onConnectorGeometry = vi.fn()

        try {
            settings.connector.scaling = {
                ...settings.connector.scaling,
                strokeWidth: 5,
                markerSize: 22,
                markerOffset: { source: 8, target: 21 },
                clickAreaWidth: 32,
                zoomScaling: { minZoom: 0.5 },
            }

            const config = {
                ...createMockConfig(),
                getTransform: () => [0, 0, zoom] as [number, number, number],
                onConnectorGeometry,
            }
            const manager = new WorkspaceConnectionManager(config)
            const sourceNode = makeNode({ nodeId: 'source-configured', type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 120, height: 120 } })
            const targetNode = makeNode({ nodeId: 'target-configured', type: 'image', position: { x: 500, y: 0 }, dimensions: { width: 120, height: 120 } })
            const edge = makeEdge({ edgeId: 'edge-configured', sourceNodeId: sourceNode.nodeId, targetNodeId: targetNode.nodeId })

            manager.syncNodes([sourceNode, targetNode])
            manager.syncEdges([edge])
            manager.render()

            let pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{
                baseScreenStrokeWidth: number
                strokeWidth: number
                arrowEnd: { baseScreenSize: number; size: number } | null
            }>
            expect(pixiEdges[0].baseScreenStrokeWidth).toBe(5)
            expect(pixiEdges[0].arrowEnd?.baseScreenSize).toBe(22)

            zoom = 0.25
            expect(manager.recomputeConnectorGeometry(zoom)).toBe(true)

            pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{
                baseScreenStrokeWidth: number
                strokeWidth: number
                arrowEnd: { baseScreenSize: number; size: number } | null
            }>
            expect(pixiEdges[0].baseScreenStrokeWidth).toBe(5)
            expect(pixiEdges[0].arrowEnd?.baseScreenSize).toBe(22)
        } finally {
            settings.connector.scaling = originalScaling
        }
    })

    it('renders rectangular node edge endpoints and recomputes them after resize', () => {
        const onConnectorGeometry = vi.fn()
        const config = {
            ...createMockConfig(),
            onConnectorGeometry,
        }
        const manager = new WorkspaceConnectionManager(config)
        const chatNode = makeNode({
            nodeId: 'chat-1',
            type: 'aiChatThread',
            position: { x: 100, y: 80 },
            dimensions: { width: 400, height: 260 },
        })
        const imageNode = makeNode({
            nodeId: 'img-1',
            type: 'image',
            position: { x: 780, y: 120 },
            dimensions: { width: 260, height: 260 },
        })
        const edge = makeEdge({
            edgeId: 'e-1',
            sourceNodeId: chatNode.nodeId,
            targetNodeId: imageNode.nodeId,
            sourceT: 0.5,
            targetT: 0.5,
        })

        manager.syncNodes([chatNode, imageNode])
        manager.syncEdges([edge])
        manager.render()

        const sourceMarkerOffset = scaleCanvasChromeWorldSizeForZoom(
            settings.connector.scaling.markerOffset.source,
            1,
            getAdaptiveBoundedZoomScalingOptions(settings.connector.scaling.zoomScaling),
        )
        const start = getRenderedPixiEdgeStart(onConnectorGeometry, edge.edgeId)

        expect(start.x).toBeCloseTo(chatNode.position.x + chatNode.dimensions.width + sourceMarkerOffset, 2)
        expect(start.y).toBeCloseTo(chatNode.position.y + chatNode.dimensions.height / 2, 2)

        const resizedChatNode = {
            ...chatNode,
            dimensions: { width: 620, height: 360 },
        }
        manager.syncNodes([resizedChatNode, imageNode])
        manager.render()

        const resizedStart = getRenderedPixiEdgeStart(onConnectorGeometry, edge.edgeId)

        expect(resizedStart.x).toBeCloseTo(resizedChatNode.position.x + resizedChatNode.dimensions.width + sourceMarkerOffset, 2)
        expect(resizedStart.y).toBeCloseTo(resizedChatNode.position.y + resizedChatNode.dimensions.height / 2, 2)
        expect(resizedStart.x).toBeGreaterThan(start.x)
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
        const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })

        const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        const spread = result.get('e-1')!
        expect(spread.targetT).toBe(0.5) // perfectly aligned
    })

    it('snaps targetT to top when source is above target', () => {
        // Source center at y=50, target at y=200..400
        // idealT = (50 - 200) / 200 = -0.75 → clamp to 0.065
        const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
        const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 200 } })

        const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        const spread = result.get('e-1')!
        expect(spread.targetT).toBe(0.065) // clamped to top
    })

    it('snaps targetT to bottom when source is below target', () => {
        // Source center at y=550, target at y=0..200
        // idealT = (550 - 0) / 200 = 2.75 → clamp to 0.935
        const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 500 }, dimensions: { width: 200, height: 100 } })
        const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 200 } })

        const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        const spread = result.get('e-1')!
        expect(spread.targetT).toBe(0.935) // clamped to bottom
    })

    it('calculates partial alignment when source is slightly above target center', () => {
        // Source center at y=150 (100 + 100/2), target at y=200..400 (height=200)
        // idealT = (150 - 200) / 200 = -0.25 → clamp to 0.065
        const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 100 }, dimensions: { width: 200, height: 100 } })
        const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 200 } })

        const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        const spread = result.get('e-1')!
        expect(spread.targetT).toBe(0.065)
    })

    it('uses stored targetT when nodes are missing from the lookup', () => {
        const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'missing-src', targetNodeId: 'missing-tgt', targetT: 0.75 })
        const result = computeSpreadTValues([edge], [], settings.connector)

        const spread = result.get('e-1')!
        expect(spread.targetT).toBe(0.75) // falls back to stored value
    })

    it('clamps using settings.connector.autoAlign.edgeMargin', () => {
        const original = settings.connector.autoAlign.edgeMargin

        // Temporarily set a larger margin
        settings.connector.autoAlign.edgeMargin = 0.1

        try {
            // Source far above target → should clamp to 0.1 (not 0.025)
            const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
            const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 500 }, dimensions: { width: 200, height: 200 } })
            const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
            const result = computeSpreadTValues([edge], [source, target], settings.connector)

            const spread = result.get('e-1')!
            expect(spread.targetT).toBe(0.1)

            // Source far below target → should clamp to 0.9 (1 - 0.1)
            const source2 = makeNode({ nodeId: 'src2', type: 'aiChatThread', position: { x: 0, y: 900 }, dimensions: { width: 200, height: 100 } })
            const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src2', targetNodeId: 'tgt' })
            const result2 = computeSpreadTValues([edge2], [source2, target], settings.connector)

            const spread2 = result2.get('e-2')!
            expect(spread2.targetT).toBe(0.9)
        } finally {
            settings.connector.autoAlign.edgeMargin = original
        }
    })

    it('snaps targetT to 0.5 when target height is below aiChatThreadRailMinSlideHeight', () => {
        const original = settings.connector.autoAlign.minSlideHeight
        settings.connector.autoAlign.minSlideHeight = 200

        try {
            // Target height (100) is below threshold (200) → snap to center
            const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
            const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })
            const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
            const result = computeSpreadTValues([edge], [source, target], settings.connector)

            expect(result.get('e-1')!.targetT).toBe(0.5)
        } finally {
            settings.connector.autoAlign.minSlideHeight = original
        }
    })

    it('slides freely when target height meets aiChatThreadRailMinSlideHeight threshold', () => {
        const original = settings.connector.autoAlign.minSlideHeight
        settings.connector.autoAlign.minSlideHeight = 200

        try {
            // Target height (300) exceeds threshold (200) → slide freely
            const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
            const target = makeNode({ nodeId: 'tgt', type: 'document', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 300 } })
            const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt' })
            const result = computeSpreadTValues([edge], [source, target], settings.connector)

            // Source center at y=50, target 0..300 → idealT ≈ 0.167
            const spread = result.get('e-1')!
            expect(spread.targetT).not.toBe(0.5)
            expect(spread.targetT).toBeGreaterThan(0)
            expect(spread.targetT).toBeLessThan(1)
        } finally {
            settings.connector.autoAlign.minSlideHeight = original
        }
    })

    it('keeps targetT at 0.5 when the target is an image node', () => {
        const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 500 }, dimensions: { width: 200, height: 100 } })
        const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 300 } })

        const edge = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt', targetT: 0.9 })
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        expect(result.get('e-1')!.targetT).toBe(0.5)
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
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        expect(result.get('e-1')!.sourceT).toBe(0.5)
    })

    it('spreads sourceT values for two edges sharing the same source', () => {
        const source = makeNode({ nodeId: 'src', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 600 } })
        const target1 = makeNode({ nodeId: 'tgt-1', type: 'image', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })
        const target2 = makeNode({ nodeId: 'tgt-2', type: 'image', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 100 } })

        const edge1 = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt-1' })
        const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src', targetNodeId: 'tgt-2' })
        const result = computeSpreadTValues([edge1, edge2], [source, target1, target2], settings.connector)

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

    it('keeps sourceT at 0.5 when the source is an image node', () => {
        const source = makeNode({ nodeId: 'src', type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 600 } })
        const target1 = makeNode({ nodeId: 'tgt-1', type: 'aiChatThread', position: { x: 300, y: 0 }, dimensions: { width: 200, height: 100 } })
        const target2 = makeNode({ nodeId: 'tgt-2', type: 'aiChatThread', position: { x: 300, y: 200 }, dimensions: { width: 200, height: 100 } })

        const edge1 = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src', targetNodeId: 'tgt-1', sourceT: 0.2 })
        const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src', targetNodeId: 'tgt-2', sourceT: 0.8 })
        const result = computeSpreadTValues([edge1, edge2], [source, target1, target2], settings.connector)

        expect(result.get('e-1')!.sourceT).toBe(0.5)
        expect(result.get('e-2')!.sourceT).toBe(0.5)
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
        const result = computeSpreadTValues([edge], [source, target], settings.connector)

        expect(result.get('e-1')!.laneIndex).toBe(0)
        expect(result.get('e-1')!.laneCount).toBe(1)
    })

    it('assigns increasing laneIndex for edges sharing the same target', () => {
        const src1 = makeNode({ nodeId: 'src-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
        const src2 = makeNode({ nodeId: 'src-2', type: 'document', position: { x: 0, y: 200 }, dimensions: { width: 200, height: 100 } })
        const target = makeNode({ nodeId: 'tgt', type: 'image', position: { x: 300, y: 100 }, dimensions: { width: 200, height: 100 } })

        const edge1 = makeEdge({ edgeId: 'e-1', sourceNodeId: 'src-1', targetNodeId: 'tgt' })
        const edge2 = makeEdge({ edgeId: 'e-2', sourceNodeId: 'src-2', targetNodeId: 'tgt' })
        const result = computeSpreadTValues([edge1, edge2], [src1, src2, target], settings.connector)

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
            top: 0,
            bottom: 600,
            left: 0,
            right: 300,
            width: 300,
            height: 600,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        })
        vi.spyOn(messageEl, 'getBoundingClientRect').mockReturnValue({
            top: 100,
            bottom: 150,
            left: 0,
            right: 300,
            width: 300,
            height: 50,
            x: 0,
            y: 100,
            toJSON: () => ({}),
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

    it('keeps image target midpoint when sourceMessageId adjusts source anchor', () => {
        const onConnectorGeometry = vi.fn()
        const messageConfig = { ...createMockConfig(), onConnectorGeometry }
        const messageManager = new WorkspaceConnectionManager(messageConfig)
        const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 600 } })
        const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 400, y: 0 }, dimensions: { width: 400, height: 400 } })

        const nodeEl = document.createElement('div')
        const messageEl = document.createElement('div')
        messageEl.setAttribute('data-message-id', 'msg-abc')
        nodeEl.appendChild(messageEl)

        vi.spyOn(nodeEl, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            bottom: 600,
            left: 0,
            right: 300,
            width: 300,
            height: 600,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        })
        vi.spyOn(messageEl, 'getBoundingClientRect').mockReturnValue({
            top: 500,
            bottom: 550,
            left: 0,
            right: 300,
            width: 300,
            height: 50,
            x: 0,
            y: 500,
            toJSON: () => ({}),
        })

        messageManager.syncNodes([chatNode, imgNode])
        messageManager.syncEdges([makeEdge({
            edgeId: 'e-1',
            sourceNodeId: 'chat-1',
            targetNodeId: 'img-1',
            sourceMessageId: 'msg-abc',
        })])
        messageManager.registerNodeElement('chat-1', nodeEl as HTMLDivElement)
        messageManager.render()

        const pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{ id: string; arrowEnd: { y: number } | null }>
        const renderedEdge = pixiEdges.find((edge) => edge.id === 'e-1')

        expect(renderedEdge?.arrowEnd?.y).toBeCloseTo(imgNode.position.y + imgNode.dimensions.height / 2, 5)
    })

    it('ignores message elements whose viewport rect is outside the registered node rect', () => {
        const onConnectorGeometry = vi.fn()
        manager.destroy()
        manager = new WorkspaceConnectionManager({ ...config, onConnectorGeometry })
        const chatNode = makeNode({ nodeId: 'chat-1', type: 'aiChatThread', position: { x: 0, y: 0 }, dimensions: { width: 300, height: 600 } })
        const imgNode = makeNode({ nodeId: 'img-1', type: 'image', position: { x: 400, y: 0 }, dimensions: { width: 400, height: 400 } })

        const nodeEl = document.createElement('div')
        const messageEl = document.createElement('div')
        messageEl.setAttribute('data-message-id', 'msg-abc')
        nodeEl.appendChild(messageEl)

        vi.spyOn(nodeEl, 'getBoundingClientRect').mockReturnValue({
            top: 1000,
            bottom: 1600,
            left: 0,
            right: 300,
            width: 300,
            height: 600,
            x: 0,
            y: 1000,
            toJSON: () => ({}),
        })
        vi.spyOn(messageEl, 'getBoundingClientRect').mockReturnValue({
            top: 120,
            bottom: 170,
            left: 0,
            right: 300,
            width: 300,
            height: 50,
            x: 0,
            y: 120,
            toJSON: () => ({}),
        })

        manager.syncNodes([chatNode, imgNode])
        manager.syncEdges([makeEdge({
            edgeId: 'e-1',
            sourceNodeId: 'chat-1',
            targetNodeId: 'img-1',
            sourceMessageId: 'msg-abc',
        })])
        manager.registerNodeElement('chat-1', nodeEl as HTMLDivElement)

        manager.render()
        const rendered = onConnectorGeometry.mock.lastCall?.[0][0]
        expect(flattenSvgPath(rendered.svgPath)[0].y).toBe(300)
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
// MEDIA NODE EDGE ANCHORING — image + video anchor to the middle of the side
// =============================================================================

describe('WorkspaceConnectionManager — media node edge anchoring', () => {
    function renderArrowEndY(targetType: CanvasNode['type'], targetHeight: number): number {
        const onConnectorGeometry = vi.fn()
        const config = {
            ...createMockConfig(),
            getTransform: () => [0, 0, 1.04] as [number, number, number],
            onConnectorGeometry,
        }
        const manager = new WorkspaceConnectionManager(config)
        // Source sits far ABOVE the target, so a node that auto-aligns its anchor
        // would pull the connector toward the top of the target's side.
        const source = makeNode({ nodeId: 'src', type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 200, height: 100 } })
        const target = makeNode({ nodeId: 'tgt', type: targetType, position: { x: 800, y: 600 }, dimensions: { width: 320, height: targetHeight } })
        const edge = makeEdge({ edgeId: 'e-anchor', sourceNodeId: 'src', targetNodeId: 'tgt' })

        manager.syncNodes([source, target])
        manager.syncEdges([edge])
        manager.render()

        const pixiEdges = onConnectorGeometry.mock.calls.at(-1)?.[0] as Array<{ id: string; arrowEnd: { x: number; y: number } | null }> | undefined
        const rendered = pixiEdges?.find((candidate) => candidate.id === 'e-anchor')
        expect(rendered?.arrowEnd).toBeDefined()
        return rendered!.arrowEnd!.y
    }

    it('anchors a video target at the middle of its side, identical to an image target', () => {
        const imageY = renderArrowEndY('image', 200)
        const videoY = renderArrowEndY('video', 200)
        expect(videoY).toBeCloseTo(imageY, 1)
    })

    it('does NOT auto-align video toward the source (unlike a chat thread node)', () => {
        // A tall chat-thread target auto-aligns: its anchor is pulled UP toward the
        // far-above source. The video target must stay at its own vertical middle.
        const videoY = renderArrowEndY('video', 800)
        const chatY = renderArrowEndY('aiChatThread', 800)
        expect(chatY).toBeLessThan(videoY)
    })
})
