import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    createCanvasSidePorts,
    inferCanvasGraphStages,
    layoutCanvasGraph,
} from './graph-layout.ts'
import {
    type EngineEdge,
    type EngineNode,
    type SceneSnapshot,
} from '../scene/types.ts'
import { isOrthogonalRouteClear } from '../connectors/paths/route-clearance.ts'

type EdgeData = { kind?: 'forward' | 'relation' | 'feedback' }

const box = (nodeId: string): EngineNode => {
    const dimensions = {
        width: 160,
        height: 60,
    }

    return {
        nodeId,
        type: 'box',
        position: {
            x: 0,
            y: 0,
        },
        dimensions,
        ports: createCanvasSidePorts(dimensions),
        data: null,
    }
}

const link = (
    source: string,
    target: string,
    kind: EdgeData['kind'] = 'forward',
): EngineEdge<EdgeData> => ({
    edgeId: `${source}-${target}`,
    source: {
        nodeId: source,
        portId: 'right',
    },
    target: {
        nodeId: target,
        portId: 'left',
    },
    path: 'straight',
    data: { kind },
})

const scene = (edges: EngineEdge<EdgeData>[]): SceneSnapshot<null, EdgeData> => ({
    sceneKey: 'graph',
    revision: '1',
    nodes: ['root', 'left', 'right', 'join'].map(box) as EngineNode<null>[],
    edges,
})

const edgeKind = (edge: EngineEdge<EdgeData>) => edge.data.kind ?? 'forward'

describe('inferCanvasGraphStages', () => {
    it('roots trees at nodes no forward edge enters and assigns joins to their first parent', () => {
        expect(
            inferCanvasGraphStages(
                ['root', 'left', 'right', 'join', 'alone'],
                new Map([
                    ['root', ['left', 'right']],
                    ['left', ['join']],
                    ['right', ['join']],
                ]),
            ),
        ).toEqual([{
            trees: [
                {
                    rootId: 'root',
                    children: {
                        root: ['left', 'right'],
                        left: ['join'],
                    },
                },
                {
                    rootId: 'alone',
                    children: {},
                },
            ],
        }])
    })
})

describe('layoutCanvasGraph', () => {
    it('places forward children in later columns and routes them as horizontal Beziers', () => {
        const layout = layoutCanvasGraph(
            scene([
                link('root', 'left'),
                link('root', 'right'),
                link('left', 'join'),
                link('right', 'join'),
            ]),
            { edgeKind },
        )
        const byId = new Map(
            layout.scene.nodes.map(node => [node.nodeId, node]),
        )

        expect(byId.get('left')!.position.x).toBeGreaterThan(byId.get('root')!.position.x + 160)
        expect(byId.get('join')!.position.x).toBeGreaterThan(byId.get('left')!.position.x + 160)
        expect(byId.get('left')!.position.y).not.toBe(byId.get('right')!.position.y)
        expect(layout.scene.edges.every(edge => edge.path === 'horizontal-bezier')).toBe(true)
        expect(layout.scene.edges.map(edge => edge.edgeId)).toEqual(['root-left', 'root-right', 'left-join', 'right-join'])
    })

    it('routes a feedback return through an exterior lane clear of other nodes and inside the bounds', () => {
        const layout = layoutCanvasGraph(
            scene([
                link('root', 'left'),
                link('root', 'right'),
                link('left', 'join'),
                link('join', 'root', 'feedback'),
            ]),
            { edgeKind },
        )
        const feedback = layout.scene.edges.find(edge => edge.edgeId === 'join-root')!
        const byId = new Map(
            layout.scene.nodes.map(node => [node.nodeId, node]),
        )
        const anchor = (nodeId: string, portId: string) => {
            const node = byId.get(nodeId)!
            const port = node.ports.find(candidate => candidate.id === portId)!

            return {
                x: node.position.x + port.anchor.x,
                y: node.position.y + port.anchor.y,
            }
        }
        const points = [
            anchor('join', feedback.source.portId),
            ...feedback.bendPoints!,
            anchor('root', feedback.target.portId),
        ]
        const obstacles = layout.scene.nodes.filter(node => node.nodeId !== 'join' && node.nodeId !== 'root').map(
            node => ({
                id: node.nodeId,
                ...node.position,
                ...node.dimensions,
            }),
        )

        expect(feedback.path).toBe('orthogonal')
        expect(feedback.source.portId).not.toBe('right')
        expect(feedback.target.portId).not.toBe('left')
        expect(isOrthogonalRouteClear(points, obstacles)).toBe(true)
        expect(
            points.every(point =>
                point.x >= 0
                && point.y >= 0
                && point.x <= layout.bounds.width
                && point.y <= layout.bounds.height,
            ),
        ).toBe(true)
    })

    it('rejects nested nodes and tree relationships that are not forward edges', () => {
        expect(() => layoutCanvasGraph({
            ...scene([]),
            nodes: [box('root'), {
                ...box('child'),
                parentId: 'root',
            }],
        })).toThrow('Graph layout places top-level nodes only')

        expect(() => layoutCanvasGraph(
            scene([link('root', 'left', 'relation')]),
            {
                edgeKind,
                stages: [{
                    trees: [
                        {
                            rootId: 'root',
                            children: { root: ['left'] },
                        },
                        { rootId: 'right' },
                        { rootId: 'join' },
                    ],
                }],
            },
        )).toThrow('Graph layout tree relationships must be forward edges')
    })
})
