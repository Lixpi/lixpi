import {
    Container,
    Graphics,
} from 'pixi.js'
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    dashVectorPath,
    projectVectorPath,
} from './pixi-vector-path.ts'
import { PixiDrawingResources } from './pixi-drawing-resources.ts'

describe('Vector projection and strokes', () => {
    it('projects mixed SVG commands and preserves a closed path', () => {
        const path = projectVectorPath('M1 2 L3 4 H8 V5 C6 7 8 9 10 11 Q12 13 14 15 Z', { x: 10, y: -7, zoom: 2 })
        expect(path.instructions.map(({ action, data }) => ({ action, data }))).toEqual([
            { action: 'moveTo', data: [12, -3] },
            { action: 'lineTo', data: [16, 1] },
            { action: 'lineTo', data: [26, 1] },
            { action: 'lineTo', data: [26, 3] },
            { action: 'bezierCurveTo', data: [22, 7, 26, 11, 30, 15] },
            { action: 'quadraticCurveTo', data: [34, 19, 38, 23] },
            { action: 'closePath', data: [] },
        ])
    })

    it('projects relative curves and snaps points without scaling stroke width', () => {
        const path = projectVectorPath('M1 2 c3 4 5 6 7 8', { x: 0.2, y: 0.2, zoom: 2, snapResolution: 2 })
        expect(path.instructions.map(({ action, data }) => ({ action, data }))).toEqual([
            { action: 'moveTo', data: [2, 4] },
            { action: 'bezierCurveTo', data: [8, 12, 12, 16, 16, 20] },
        ])
    })

    it('scales SVG arc radii and endpoints while preserving rotation and flags', () => {
        const path = projectVectorPath('M0 0 A10 20 45 0 1 30 40', { x: 5, y: 10, zoom: 2 })
        expect(path.instructions[1]).toMatchObject({ action: 'arcToSvg', data: [20, 40, 45, 0, 1, 65, 90] })
    })

    it('continues dash distances around corners and resets at separate subpaths', () => {
        const path = dashVectorPath(projectVectorPath('M0 0 L3 0 L3 7 M10 0 L20 0'), [5, 5])
        expect(path.instructions.map(instruction => instruction.data)).toEqual([[0, 0], [3, 0], [3, 0], [3, 2], [10, 0], [15, 0]])
        expect(() => dashVectorPath(path, [0, 5])).toThrow('positive')
        expect(() => projectVectorPath('M0 0', { x: 0, y: 0, zoom: NaN })).toThrow('finite')
    })

    it('submits dashed geometry without also stroking the underlying solid path', () => {
        const stage = new Container()
        const resources = new PixiDrawingResources(stage, dispose => dispose(), vi.fn())
        const layer = resources.addLayer()
        const group = resources.createGroup({ layer, space: 'screen' })
        resources.createPath(group, [{ path: 'M0 0 L20 0', stroke: { color: '#ffffff', width: 2, cap: 'round', dash: [5, 5] } }])
        const graphics = (stage.children[1] as Container).children[0] as Container
        const instruction = (graphics.children[0] as Graphics).context.instructions[0]
        expect(instruction.action).toBe('stroke')
        if (instruction.action !== 'stroke') throw new Error('Expected stroke instruction')
        expect(instruction.data.style.width).toBe(2)
        expect(instruction.data.path.shapePath.shapePrimitives.map(({ shape }) => 'points' in shape ? shape.points : [])).toEqual([[0, 0, 5, 0], [10, 0, 15, 0]])
        resources.destroy()
    })
})
