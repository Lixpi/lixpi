// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { ConnectionGeometry } from './connection-geometry.ts'
import { PortMeasurement } from './port-measurement.ts'
import { portElementData, readPortElement } from './port-elements.ts'
import { type ConnectionGeometryNode } from '../../shared/connectors/geometry-types.ts'

const node = (nodeId: string, options: Partial<ConnectionGeometryNode> = {}): ConnectionGeometryNode => ({
    nodeId,
    position: {
        x: 0,
        y: 0,
    },
    dimensions: {
        width: 100,
        height: 100,
    },
    ...options,
})

describe('connection graph snapshots', () => {
    it('projects unordered nested parents, coordinate extents and parent limits without mutating inputs', () => {
        const inputs = [node('leaf', {
            parentId: 'child',
            position: {
                x: 90,
                y: -20,
            },
            dimensions: {
                width: 20,
                height: 20,
            },
            extent: 'parent',
        }), node('child', {
            parentId: 'root',
            position: {
                x: 200,
                y: 200,
            },
            extent: [[0, 0], [180, 160]],
        }), node('root', {
            position: {
                x: 50,
                y: 60,
            },
            dimensions: {
                width: 400,
                height: 400,
            },
        })]
        const before = structuredClone(inputs)
        const geometry = new ConnectionGeometry()
        geometry.replace(inputs)
        expect(geometry.get('child')?.bounds).toEqual({
            x: 130,
            y: 120,
            width: 100,
            height: 100,
        })
        expect(geometry.get('leaf')?.bounds).toEqual({
            x: 210,
            y: 120,
            width: 20,
            height: 20,
        })
        expect(inputs).toEqual(before)
        inputs[2].position.x = 999
        expect(geometry.get('root')?.bounds.x).toBe(50)
    })

    it('preserves empty ports, both roles, explicit centers and shifted fallback centers', () => {
        const geometry = new ConnectionGeometry()
        geometry.replace([node('empty', { ports: [] }), node('explicit', {
            position: {
                x: 20,
                y: 30,
            },
            ports: [{
                id: 'both',
                role: 'both',
                direction: 'top',
                anchor: {
                    x: 11,
                    y: 12,
                },
            }],
        }), node('fallback')])
        expect(geometry.get('empty')?.ports).toEqual([])
        expect(geometry.ports.filter(port => port.nodeId === 'explicit')).toEqual([
            {
                nodeId: 'explicit',
                id: 'both',
                type: 'source',
                position: 'top',
                x: 31,
                y: 42,
            },
            {
                nodeId: 'explicit',
                id: 'both',
                type: 'target',
                position: 'top',
                x: 31,
                y: 42,
            },
        ])
        expect(geometry.ports.find(port => port.nodeId === 'fallback' && port.type === 'source')).toMatchObject({
            x: 105,
            y: 55,
        })
    })

    it.each([
        [node('a'), node('a')],
        [node('a', { parentId: 'absent' })],
        [node('a', { parentId: 'b' }), node('b', { parentId: 'a' })],
        [node('a', { dimensions: {
            width: -1,
            height: 20,
        } })],
        [node('a', { ports: [{
            id: 'bad',
            role: 'input',
            direction: 'top',
            anchor: {
                x: NaN,
                y: 0,
            },
        }] })],
    ])('retains the previous graph after a rejected snapshot %#', (...invalid) => {
        const geometry = new ConnectionGeometry()
        geometry.replace([node('kept')])
        const ports = geometry.ports
        expect(() => geometry.replace(invalid)).toThrow()
        expect(geometry.get('kept')).toBeDefined()
        expect(geometry.ports).toBe(ports)
    })

    it.each([0.5, 1, 2])('measures fallback ports at explicit zoom %s and enforces pane identity', zoom => {
        const pane = document.createElement('div')
        const root = document.createElement('div')
        const port = document.createElement('div')
        port.className = 'canvas-port'

        for (const [key, value] of Object.entries(portElementData('owner', {
            nodeId: 'a',
            id: 'in',
            type: 'target',
            position: 'left',
        }))) port.dataset[key] = value

        root.append(port)
        pane.append(root)
        Object.defineProperties(root, {
            offsetWidth: { value: 200 },
            offsetHeight: { value: 100 },
        })
        Object.defineProperties(port, {
            offsetWidth: { value: 10 },
            offsetHeight: { value: 10 },
        })
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 50, 200 * zoom, 100 * zoom))
        vi.spyOn(port, 'getBoundingClientRect').mockReturnValue(new DOMRect(40 + 20 * zoom, 50 + 30 * zoom, 10 * zoom, 10 * zoom))
        const measurement = new PortMeasurement(pane, 'owner')
        const result = measurement.read('a', root, zoom, {
            width: 100,
            height: 100,
        })!
        expect(result.ports[0]).toMatchObject({
            x: 20,
            y: 30,
            width: 10,
            height: 10,
        })
        expect(measurement.read('a', root, zoom, result.dimensions)).toBeNull()
        expect(readPortElement(port, pane, 'another')).toBeNull()
        expect(readPortElement(port, document.createElement('div'), 'owner')).toBeNull()
        const geometry = new ConnectionGeometry()
        geometry.replace([node('a')])
        geometry.measure('a', result)
        expect(geometry.ports[0]).toMatchObject({
            id: 'in',
            x: 25,
            y: 35,
        })
        geometry.replace([node('b')])
        expect(geometry.get('a')).toBeUndefined()
    })
})
