import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    type CanvasDrawingSurface,
} from '../rendering/drawing-scope.ts'
import {
    type ResourceHandle,
    type ResourceKind,
} from '../rendering/resources.ts'
import {
    ConnectorRenderer,
    type ConnectorRenderDatum,
} from './connector-renderer.ts'

function fixture() {
    const controller = new AbortController()
    const owner = Symbol()
    let id = 0
    const handle = <Kind extends ResourceKind>(kind: Kind): ResourceHandle<Kind> => ({ id: String(++id), kind, owner })
    const resources = { createGroup: vi.fn(() => handle('group')), createPath: vi.fn(() => handle('path')), updateGroup: vi.fn(), updatePath: vi.fn(), setVisible: vi.fn(), release: vi.fn() }
    const surface = { resources, signal: controller.signal, layers: { connectors: handle('layer') } } as unknown as CanvasDrawingSurface
    const renderer = new ConnectorRenderer({ surface, marker: { width: 10, reference: { x: 0, y: 5 }, paths: ['M0 0 L10 5 L0 10 Z'] }, zoomScaling: { minZoom: 0.4 }, resolution: 2 })
    const edge: ConnectorRenderDatum = { id: 'one', svgPath: 'M0 0 C5 0 10 0 20 10', baseScreenStrokeWidth: 2, strokeColor: '#123456', isDashed: false, arrowStart: null, arrowEnd: { x: 20, y: 10, angle: 0.5, baseScreenSize: 10 } }
    return { renderer, controller, resources, edge }
}

describe('ConnectorRenderer', () => {
    it('positions both endpoint markers and hides unused markers on the next update', () => {
        const { renderer, resources, edge } = fixture()
        const viewport = { x: 10, y: 20, zoom: 2 }
        renderer.render([{ ...edge, arrowStart: { x: 0, y: 0, angle: Math.PI, baseScreenSize: 10 } }], viewport)
        expect(resources.updateGroup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ position: { x: 10, y: 20 }, rotation: Math.PI }))
        expect(resources.updateGroup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ position: { x: 50, y: 40 }, rotation: 0.5 }))
        const markers = resources.updateGroup.mock.calls.filter(([, config]) => config.rotation !== undefined).map(([group]) => group)
        renderer.render([{ ...edge, arrowEnd: null }], viewport)
        for (const marker of markers) expect(resources.setVisible).toHaveBeenCalledWith(marker, false)
        renderer.destroy()
    })

    it('reuses connector and marker allocations across viewport and visibility changes', () => {
        const { renderer, resources, edge, controller } = fixture()
        const viewport = { x: 10, y: 20, zoom: 1 }
        renderer.render([edge], viewport)
        const allocations = resources.createGroup.mock.calls.length
        const paints = resources.updatePath.mock.calls.length
        renderer.render([edge], viewport)
        expect(resources.updatePath).toHaveBeenCalledTimes(paints)
        renderer.render([], viewport)
        renderer.render([{ ...edge, strokeColor: '#ffffff' }], { ...viewport, zoom: 2 })
        expect(resources.createGroup).toHaveBeenCalledTimes(allocations)
        expect(resources.updateGroup).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ position: { x: 50, y: 40 }, rotation: 0.5 }))
        controller.abort()
        renderer.destroy()
        expect(resources.release).toHaveBeenCalledOnce()
    })

    it('uses configured screen dash lengths and caller-supplied marker paths', () => {
        const { renderer, resources, edge } = fixture()
        renderer.render([{ ...edge, isDashed: true }], { x: 0, y: 0, zoom: 1 })
        expect(resources.updatePath).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ projection: { x: 0, y: 0, zoom: 1, snapResolution: 2 }, stroke: expect.objectContaining({ width: 2, dash: [6, 4] }) })])
        expect(resources.updatePath).toHaveBeenLastCalledWith(expect.anything(), [{ path: 'M0 0 L10 5 L0 10 Z', fill: { color: '#123456' } }])
        renderer.destroy()
    })
})
