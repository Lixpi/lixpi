// @vitest-environment happy-dom

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import {
    type CanvasDrawingSurface,
} from '@lixpi/canvas-engine/frontend/rendering'
import {
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    createFixedDiagramNodeGeometry,
    DiagramNodeSurface,
} from './diagram-node-surface.ts'

const createSurface = () => {
    const group = {} as never
    const path = {} as never
    const resources = {
        createGroup: vi.fn(() => group),
        createPath: vi.fn((_group: unknown, _shapes: unknown) => path),
        updateGroup: vi.fn((_group: unknown, _transform: unknown) => {}),
        updatePath: vi.fn((_path: unknown, _shapes: unknown) => {}),
        setVisible: vi.fn((_resource: unknown, _visible: boolean) => {}),
        release: vi.fn((_resource: unknown) => {}),
    }
    const surface = {
        resources,
        layers: { media: {} },
    } as unknown as CanvasDrawingSurface

    return {
        group,
        path,
        resources,
        surface,
    }
}

describe('DiagramNodeSurface', () => {
    it('paints the chosen shape and releases its owned group once', () => {
        const drawing = createSurface()
        const nodeSurface = new DiagramNodeSurface({
            surface: drawing.surface,
            bounds: {
                x: 12,
                y: 24,
                width: 80,
                height: 60,
            },
            appearance: {
                fill: '#112233',
                stroke: '#445566',
                strokeWidth: 2,
                shape: 'circle',
            },
        })

        expect(drawing.resources.createGroup).toHaveBeenCalledWith({
            space: 'world',
            layer: drawing.surface.layers.media,
        })
        expect(drawing.resources.createPath).toHaveBeenCalledWith(drawing.group, [])
        expect(drawing.resources.updateGroup).toHaveBeenLastCalledWith(
            drawing.group,
            { position: {
                x: 12,
                y: 24,
            } },
        )
        const shapes = drawing.resources.updatePath.mock.calls.at(-1)?.[1] as Array<{
            path: string
            fill: { color: string }
            stroke: {
                color: string
                width: number
            }
        }>
        expect(shapes[0]).toMatchObject({
            path: expect.stringContaining(' A30 30'),
            fill: { color: '#112233' },
            stroke: {
                color: '#445566',
                width: 2,
            },
        })

        nodeSurface.setSelected(true)
        nodeSurface.setVisible(false)
        nodeSurface.destroy()
        nodeSurface.destroy()

        expect(drawing.resources.setVisible).toHaveBeenCalledWith(drawing.group, false)
        expect(drawing.resources.release).toHaveBeenCalledTimes(1)
    })

    it('uses immutable node bounds for every fixed-diagram footprint', () => {
        const policy = createFixedDiagramNodeGeometry<{ label: string }>()
        const node: EngineNode<{ label: string }> = {
            nodeId: 'node-a',
            type: 'card',
            data: { label: 'A' },
            position: {
                x: 10,
                y: 20,
            },
            dimensions: {
                width: 140,
                height: 70,
            },
            ports: [],
        }

        expect(policy.movable).toBe(false)
        expect(policy.measure(node)).toEqual({
            visualBounds: {
                x: 10,
                y: 20,
                width: 140,
                height: 70,
            },
            hitBounds: {
                x: 10,
                y: 20,
                width: 140,
                height: 70,
            },
            selectionBounds: {
                x: 10,
                y: 20,
                width: 140,
                height: 70,
            },
            collisionBounds: {
                x: 10,
                y: 20,
                width: 140,
                height: 70,
            },
            connectorBounds: {
                x: 10,
                y: 20,
                width: 140,
                height: 70,
            },
        })
    })
})
