import {
    resolveCollisions,
    resolveRigidCanvasNodeGroupCollisions,
    unionRectangles,
    type CollisionOptions,
    type RigidCanvasNodeGroup,
    type SceneSnapshot,
} from '@lixpi/canvas-engine/shared'
import { createDiagramConnectorSettings } from '@lixpi/canvas-components/connectors'
import {
    CapabilityBoard,
    capabilityNode,
    type CapabilityNodeData,
} from './capability-board.ts'
import {
    type ExampleFrame,
} from './example-frame.ts'

export class CollisionExample {
    readonly board: CapabilityBoard
    readonly frame: ExampleFrame
    private mode = 'boxes'
    private margin = 24
    private overlapThreshold = 0
    private iterations = 100
    private fixed = true
    private exclude = false
    private automatic = true

    constructor(host: HTMLElement) {
        this.board = new CapabilityBoard(
            host,
            {
                instructions: 'The initial boxes overlap. Resolve them once, or drag a node and let the solver run on release. Individual boxes support a fixed anchor and excluded A/B pairs. Rigid groups move each connected pair by one shared delta, preserving the distance between its members. Reset overlap restores the original input without changing the solver controls.',
                scene: this.initialScene(),
                connectors: {
                    settings: createDiagramConnectorSettings(),
                    policy: { targetMarker: () => 'none' },
                },
                onGeometry: () => {
                    if (this.automatic)
                        this.resolve(false)
                },
            },
        )
        this.frame = this.board.frame
        this.frame.select(
            'Collision model',
            this.mode,
            {
                boxes: 'Individual boxes',
                groups: 'Rigid groups',
            },
            value => {
                this.mode = value
                this.reset()
            },
        )
        this.frame.number(
            'Margin',
            {
                value: this.margin,
            },
            value => void (this.margin = value),
        )
        this.frame.number(
            'Overlap threshold',
            {
                value: this.overlapThreshold,
            },
            value => void (this.overlapThreshold = value),
        )
        this.frame.number(
            'Maximum iterations',
            {
                value: this.iterations,
            },
            value => void (this.iterations = value),
        )
        this.frame.toggle(
            'Keep anchor fixed (boxes)',
            this.fixed,
            value => {
                this.fixed = value
                this.board.scene = {
                    ...this.board.scene,
                    nodes: this.board.scene.nodes.map(
                        node => node.nodeId === 'anchor' ? {
                            ...node,
                            type: value ? 'fixed' : 'diagram',
                            data: {
                                ...node.data,
                                lines: [value ? 'Fixed while other boxes move' : 'Movable collision box'],
                                tag: value ? 'fixed' : 'movable',
                            },
                        } : node,
                    ),
                }
                this.board.publish()
            },
        )
        this.frame.toggle(
            'Exclude A/B collision pair',
            this.exclude,
            value => void (this.exclude = value),
        )
        this.frame.toggle(
            'Resolve on drag release',
            this.automatic,
            value => void (this.automatic = value),
        )
        this.frame.button('Resolve collisions', () => this.resolve())
        this.frame.button('Reset overlap', () => this.reset())
        this.frame.code(() => this.sourceCode())
        this.frame.report('Overlapping input. Choose Resolve collisions to run the shared solver.')
    }

    private initialScene(): SceneSnapshot<CapabilityNodeData> {
        if (this.mode === 'groups')
            return {
                sceneKey: 'library-collisions',
                revision: '0',
                nodes: [
                    capabilityNode(
                        'a-one',
                        'A.1',
                        60,
                        100,
                        180,
                        96,
                        {
                            lines: ['Moves with A.2'],
                            tag: 'Group A',
                        },
                    ),
                    capabilityNode(
                        'a-two',
                        'A.2',
                        300,
                        100,
                        180,
                        96,
                        {
                            lines: ['Relative offset stays fixed'],
                            tag: 'Group A',
                        },
                    ),
                    capabilityNode(
                        'b-one',
                        'B.1',
                        220,
                        150,
                        180,
                        96,
                        {
                            lines: ['Moves with B.2'],
                            tag: 'Group B',
                        },
                    ),
                    capabilityNode(
                        'b-two',
                        'B.2',
                        460,
                        150,
                        180,
                        96,
                        {
                            lines: ['Relative offset stays fixed'],
                            tag: 'Group B',
                        },
                    ),
                    capabilityNode(
                        'c-one',
                        'C.1',
                        400,
                        210,
                        180,
                        96,
                        {
                            lines: ['Moves with C.2'],
                            tag: 'Group C',
                        },
                    ),
                    capabilityNode(
                        'c-two',
                        'C.2',
                        640,
                        210,
                        180,
                        96,
                        {
                            lines: ['Relative offset stays fixed'],
                            tag: 'Group C',
                        },
                    ),
                ],
                edges: ['a', 'b', 'c'].map(
                    group => ({
                        edgeId: `${group}-members`,
                        source: {
                            nodeId: `${group}-one`,
                            portId: 'right',
                        },
                        target: {
                            nodeId: `${group}-two`,
                            portId: 'left',
                        },
                        path: 'straight',
                        data: null,
                    }),
                ),
            }

        const anchor = capabilityNode(
            'anchor',
            'Anchor',
            330,
            180,
            230,
            150,
            {
                lines: [this.fixed ? 'Fixed while other boxes move' : 'Movable collision box'],
                tag: this.fixed ? 'fixed' : 'movable',
            },
        )

        return {
            sceneKey: 'library-collisions',
            revision: '0',
            nodes: [
                {
                    ...anchor,
                    type: this.fixed ? 'fixed' : 'diagram',
                },
                capabilityNode(
                    'a',
                    'Box A',
                    220,
                    140,
                    210,
                    110,
                    {
                        lines: ['Overlaps anchor and B'],
                        tag: 'A',
                    },
                ),
                capabilityNode(
                    'b',
                    'Box B',
                    280,
                    230,
                    210,
                    110,
                    {
                        lines: ['A/B can be excluded'],
                        tag: 'B',
                    },
                ),
                capabilityNode(
                    'c',
                    'Box C',
                    470,
                    220,
                    190,
                    100,
                    {
                        lines: ['Resolved as a separate box'],
                        tag: 'C',
                    },
                ),
                capabilityNode(
                    'd',
                    'Box D',
                    530,
                    290,
                    190,
                    100,
                    {
                        lines: ['Drag to create another overlap'],
                        tag: 'D',
                    },
                ),
            ],
            edges: [],
        }
    }

    private options(): CollisionOptions {
        return {
            margin: this.margin,
            overlapThreshold: this.overlapThreshold,
            iterations: this.iterations,
            excludePairs: this.exclude ? new Set(['a-b']) : undefined,
        }
    }

    private groups(): RigidCanvasNodeGroup[] {
        return ['a', 'b', 'c'].flatMap(id => {
            const members = this.board.scene.nodes.filter(node => node.nodeId.startsWith(`${id}-`))

            return members.length ? [{
                id,
                nodeIds: members.map(node => node.nodeId),
                rect: unionRectangles(
                    members.map(
                        node => ({
                            ...node.position,
                            ...node.dimensions,
                        }),
                    ),
                )!,
            }] : []
        })
    }

    private resolve(publish = true): void {
        if (this.mode === 'groups') {
            const result = resolveRigidCanvasNodeGroupCollisions(
                [...this.board.scene.nodes],
                this.groups(),
                this.options(),
            )
            this.board.scene = {
                ...this.board.scene,
                nodes: result.nodes,
            }
            this.frame.report(
                `${result.movedGroupCount} groups and ${result.movedNodeCount} nodes moved in ${result.collisionIterations} iterations. Member offsets are preserved.`,
            )
        } else {
            const boxes = this.board.scene.nodes.map(
                node => ({
                    id: node.nodeId,
                    ...node.position,
                    ...node.dimensions,
                    fixed: node.type === 'fixed',
                }),
            )
            const result = resolveCollisions(
                boxes,
                this.options(),
            )
            this.board.scene = {
                ...this.board.scene,
                nodes: this.board.scene.nodes.map(node => {
                    const position = result.nodes.get(node.nodeId)

                    return position ? {
                        ...node,
                        position,
                    } : node
                }),
            }
            this.frame.report(
                `${result.hasChanges ? 'Positions changed' : 'Positions unchanged'} after ${result.numIterations} iterations. ${this.fixed ? 'Anchor stays fixed.' : 'All boxes can move.'}${this.exclude ? ' A/B is excluded.' : ''}`,
            )
        }

        if (publish)
            this.board.publish()
    }

    private reset(): void {
        this.board.scene = this.initialScene()
        this.board.publish()
        this.board.fit()
        this.frame.report('Overlapping input restored. Choose Resolve collisions or drag a node.')
    }

    private sourceCode(): string {
        const optionCode = [
            `    margin: ${this.margin},`,
            `    overlapThreshold: ${this.overlapThreshold},`,
            `    iterations: ${this.iterations},`,
            ...(this.exclude ? ["    excludePairs: new Set(['a-b']),"] : []),
        ]

        if (this.mode === 'groups')
            return [
                "import { resolveRigidCanvasNodeGroupCollisions, unionRectangles } from '@lixpi/canvas-engine/shared'",
                '',
                '// Each group rect is the union of its member bounds in world coordinates.',
                'const groups = memberLists.map(({ id, members }) => ({',
                '    id, nodeIds: members.map(node => node.nodeId),',
                '    rect: unionRectangles(members.map(node => ({ ...node.position, ...node.dimensions }))),',
                '}))',
                'const result = resolveRigidCanvasNodeGroupCollisions(nodes, groups, {',
                ...optionCode,
                '})',
                'scene = { ...scene, nodes: result.nodes }',
                'canvas.setScene(scene)',
                '// A shared translation for every member preserves each group\'s internal geometry.',
            ].join('\n')

        return [
            "import { resolveCollisions } from '@lixpi/canvas-engine/shared'",
            '',
            'const boxes = nodes.map(node => ({',
            '    id: node.nodeId, ...node.position, ...node.dimensions,',
            `    fixed: ${this.fixed} && node.nodeId === 'anchor',`,
            '}))',
            'const result = resolveCollisions(boxes, {',
            ...optionCode,
            '})',
            'scene = { ...scene, nodes: nodes.map(node => ({',
            '    ...node, position: result.nodes.get(node.nodeId) ?? node.position,',
            '})) }',
            'canvas.setScene(scene)',
            '// Run again after the host applies a geometry intent to resolve on drag release.',
        ].join('\n')
    }

    destroy(): void {
        this.board.destroy()
    }
}
