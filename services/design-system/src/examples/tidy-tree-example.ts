import {
    layoutTree,
    type LayoutTreeOptions,
    type SceneSnapshot,
    type TreeLayoutNode,
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

export class TidyTreeExample {
    readonly frame: ExampleFrame
    readonly board: CapabilityBoard
    private depthGap = 90
    private siblingGap = 32
    private fanoutGap = 24
    private depth = 3
    private branches = 2
    private nodeWidth = 160
    private variedHeights = true
    private rootFanout = false
    private reverse = false

    constructor(host: HTMLElement) {
        this.board = new CapabilityBoard(
            host,
            {
                instructions: 'The shared tidy-tree algorithm arranges variable-sized boxes from left to right. Change depth and sibling gaps, branch spacing or the tree shape. Drag nodes to disturb the layout, then choose Tidy tree to restore it. Tree ancestry is host data; these nodes are not parent-relative canvas children.',
                scene: this.initialScene(),
                connectors: {
                    settings: createDiagramConnectorSettings(),
                    policy: { targetMarker: () => 'none' },
                },
            },
        )
        this.frame = this.board.frame
        this.frame.number(
            'Depth gap',
            {
                value: this.depthGap,
            },
            value => { this.depthGap = value; this.layout() },
        )
        this.frame.number(
            'Sibling gap',
            {
                value: this.siblingGap,
            },
            value => { this.siblingGap = value; this.layout() },
        )
        this.frame.number(
            'Fanout depth gap',
            {
                value: this.fanoutGap,
            },
            value => { this.fanoutGap = value; this.layout() },
        )
        this.frame.number(
            'Tree depth',
            {
                value: this.depth,
            },
            value => { this.depth = value; this.rebuild() },
        )
        this.frame.number(
            'Root branches',
            {
                value: this.branches,
            },
            value => { this.branches = value; this.rebuild() },
        )
        this.frame.number(
            'Node width',
            {
                value: this.nodeWidth,
            },
            value => { this.nodeWidth = value; this.rebuild() },
        )
        this.frame.toggle(
            'Variable node heights',
            this.variedHeights,
            value => {
                this.variedHeights = value
                this.rebuild()
            },
        )
        this.frame.toggle(
            'Double fanout gap at root',
            this.rootFanout,
            value => {
                this.rootFanout = value
                this.layout()
            },
        )
        this.frame.toggle(
            'Reverse sibling order',
            this.reverse,
            value => {
                this.reverse = value
                this.layout()
            },
        )
        this.frame.button('Tidy tree', () => this.layout())
        this.frame.button('Scatter nodes', () => {
            this.board.scene = {
                ...this.board.scene,
                nodes: this.board.scene.nodes.map(
                    (node, index) => ({
                        ...node,
                        position: {
                            x: 30 + index % 5 * 190,
                            y: 30 + Math.floor(index / 5) * 130 + index % 3 * 22,
                        },
                    }),
                ),
            }
            this.board.publish()
            this.board.fit()
            this.frame.report('Nodes scattered. Tidy tree restores the tree order using the shared layoutTree export.')
        })
        this.frame.code(() => this.sourceCode())
        this.layout()
    }

    private initialScene(): SceneSnapshot<CapabilityNodeData> {
        const nodes = [capabilityNode(
            'root',
            'Root',
            0,
            0,
            this.nodeWidth,
            84,
            {
                treeParent: null,
                tag: 'depth 0',
            },
        )]
        const edges: SceneSnapshot['edges'][number][] = []
        let parents = ['root']

        for (let level = 1; level <= this.depth; level++) {
            const next: string[] = []

            for (const parent of parents)
                for (let branch = 0; branch < (level === 1 ? this.branches : 2); branch++) {
                    const id = `${parent}-${branch + 1}`
                    const index = nodes.length
                    nodes.push(
                        capabilityNode(
                            id,
                            level === 1 ? `Branch ${branch + 1}` : `Node ${index}`,
                            0,
                            0,
                            this.nodeWidth,
                            this.variedHeights ? 72 + index % 3 * 24 : 84,
                            {
                                treeParent: parent,
                                tag: `depth ${level}`,
                                lines: this.variedHeights
                                    && index % 3 === 2
                                    ? ['Variable height', 'Subtree bands stay separate']
                                    : [],
                            },
                        ),
                    )
                    edges.push({
                        edgeId: `${parent}-to-${id}`,
                        source: {
                            nodeId: parent,
                            portId: 'right',
                        },
                        target: {
                            nodeId: id,
                            portId: 'left',
                        },
                        path: 'bezier',
                        data: null,
                    })
                    next.push(id)
                }

            parents = next
        }

        return {
            sceneKey: 'library-tidy-tree',
            revision: '0',
            nodes,
            edges,
        }
    }

    private treeNodes(): TreeLayoutNode[] {
        const nodes = this.board.scene.nodes.map(
            node => ({
                id: node.nodeId,
                parentId: node.data.treeParent ?? null,
                width: node.dimensions.width,
                height: node.dimensions.height,
            }),
        )

        return this.reverse ? [...nodes].reverse() : nodes
    }

    private options(): LayoutTreeOptions {
        return {
            depthGap: this.depthGap,
            siblingGap: this.siblingGap,
            branchFanoutDepthGap: this.fanoutGap,
            ...(this.rootFanout ? { getBranchFanoutDepthGap: (node: TreeLayoutNode) => node.parentId === null ? this.fanoutGap * 2 : this.fanoutGap } : {}),
        }
    }

    private layout(): void {
        const result = layoutTree(
            this.treeNodes(),
            this.options(),
        )
        const top = Math.min(0, ...[...result.positions.values()].map(position => position.y))
        this.board.scene = {
            ...this.board.scene,
            nodes: this.board.scene.nodes.map(node => {
                const position = result.positions.get(node.nodeId)

                return position ? {
                    ...node,
                    position: {
                        x: position.x + 30,
                        y: position.y - top + 30,
                    },
                } : node
            }),
        }
        this.board.publish()
        this.board.fit()
        this.frame.report(
            `${result.positions.size} nodes arranged in ${Math.round(result.bounds.width)} by ${Math.round(result.bounds.height)} world pixels. Root: ${result.rootId}.`,
        )
    }

    private rebuild(): void {
        this.board.scene = this.initialScene()
        this.layout()
    }

    private sourceCode(): string {
        return [
            "import { layoutTree } from '@lixpi/canvas-engine/shared'",
            '',
            '// Keep tree ancestry separate from EngineNode.parentId (relative positioning).',
            'const treeNodes = scene.nodes.map(node => ({',
            '    id: node.nodeId, parentId: node.data.treeParent ?? null,',
            '    width: node.dimensions.width, height: node.dimensions.height,',
            '}))',
            ...(this.reverse ? ['treeNodes.reverse()'] : []),
            'const result = layoutTree(treeNodes, {',
            `    depthGap: ${this.depthGap},`,
            `    siblingGap: ${this.siblingGap},`,
            `    branchFanoutDepthGap: ${this.fanoutGap},`,
            ...(this.rootFanout ? [`    getBranchFanoutDepthGap: node => node.parentId === null ? ${this.fanoutGap * 2} : ${this.fanoutGap},`] : []),
            '})',
            '// Results are relative to the root and can have negative y coordinates.',
            'const top = Math.min(0, ...[...result.positions.values()].map(point => point.y))',
            'scene = { ...scene, nodes: scene.nodes.map(node => {',
            '    const point = result.positions.get(node.nodeId)',
            '    return point ? { ...node, position: { x: point.x + 30, y: point.y - top + 30 } } : node',
            '}) }',
            'canvas.setScene(scene)',
        ].join('\n')
    }

    destroy(): void {
        this.board.destroy()
    }
}
