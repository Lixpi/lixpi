import {
    isOrthogonalRouteClear,
    type CanvasEnginePoint,
    type CanvasPort,
    type EngineEdge,
    type EngineNode,
} from '@lixpi/canvas-engine/shared'
import {
    type WorkspaceDiagramEdge,
    type WorkspaceDiagramNode,
} from './workspace-diagram.ts'

type DiagramNode = EngineNode<WorkspaceDiagramNode>
type Direction = CanvasPort['direction']
type Escape = {
    port: CanvasPort
    points: CanvasEnginePoint[]
}

const routeLength = (points: readonly CanvasEnginePoint[]): number => points.slice(1).reduce(
    (
        length,
        point,
        index,
    ) => length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y),
    0,
)

// This planner owns graph-level port separation and feedback lanes. The engine
// remains responsible for path rounding, endpoint gaps and marker rendering.
export class WorkspaceDiagramRouting {
    private readonly byId: Map<string, DiagramNode>
    private readonly occupied = new Map<string, CanvasEnginePoint[]>()

    constructor(
        private readonly nodes: DiagramNode[],
        private readonly edges: readonly WorkspaceDiagramEdge[],
        private readonly gap: number,
    ) {
        this.byId = new Map(
            nodes.map(node => [node.nodeId, node]),
        )

        for (const edge of edges) {
            if (
                edge.kind
                && edge.kind !== 'forward'
            )
                continue

            this.reserve(this.byId.get(edge.source)!, 'right')
            this.reserve(this.byId.get(edge.target)!, 'left')
        }
    }

    route(): EngineEdge<WorkspaceDiagramEdge>[] {
        const result = new Map<string, EngineEdge<WorkspaceDiagramEdge>>()

        for (const edge of this.edges) {
            if (edge.kind === 'feedback')
                continue

            if (edge.kind !== 'relation') {
                result.set(
                    edge.id,
                    this.edge(
                        edge,
                        'right',
                        'left',
                    ),
                )

                continue
            }

            const source = this.byId.get(edge.source)!
            const target = this.byId.get(edge.target)!
            const dx = target.position.x + target.dimensions.width / 2 - source.position.x - source.dimensions.width / 2
            const dy = target.position.y + target.dimensions.height / 2 - source.position.y - source.dimensions.height / 2
            const vertical = Math.abs(dy) > Math.abs(dx)
            const sourceDirection = vertical
                ? dy < 0
                    ? 'top'
                    : 'bottom'
                : dx < 0
                    ? 'left'
                    : 'right'
            const facingTargetDirection = vertical
                ? dy < 0
                    ? 'bottom'
                    : 'top'
                : dx < 0
                    ? 'right'
                    : 'left'
            const targetSideOccupied = this.occupied.has(`${target.nodeId}:${facingTargetDirection}`)
            const verticalClearance = Math.abs(dy) - target.dimensions.height / 2
            const targetDirection = !vertical
                && targetSideOccupied
                && verticalClearance >= this.gap
                ? dy < 0
                    ? 'bottom'
                    : 'top'
                : facingTargetDirection
            const sharedSourcePort = sourceDirection === 'right'
                && this.edges.some(candidate => candidate.source === edge.source && (!candidate.kind || candidate.kind === 'forward'))
                ? source.ports.find(port => port.id === 'right')
                : undefined
            const sourcePort = sharedSourcePort ?? this.port(
                source,
                sourceDirection,
                'output',
                `${edge.id}:source`,
            )
            const targetPort = this.port(
                target,
                targetDirection,
                'input',
                `${edge.id}:target`,
            )

            if (
                !sourcePort
                || !targetPort
            )
                throw new Error(`Workspace diagram relation ${edge.id} has no free ports`)

            if (vertical) {
                const left = Math.max(source.position.x, target.position.x)
                const right = Math.min(source.position.x + source.dimensions.width, target.position.x + target.dimensions.width)

                if (right > left) {
                    const x = (left + right) / 2
                    const sourceOccupied = this.occupied.get(`${source.nodeId}:${sourceDirection}`) ?? []
                    const targetOccupied = this.occupied.get(`${target.nodeId}:${targetDirection}`) ?? []

                    if (
                        sourceOccupied.every(anchor => Math.abs(source.position.x + anchor.x - x) > 1)
                        && targetOccupied.every(anchor => Math.abs(target.position.x + anchor.x - x) > 1)
                    ) {
                        sourcePort.anchor.x = x - source.position.x
                        targetPort.anchor.x = x - target.position.x
                    }
                }
            }

            if (!sharedSourcePort)
                this.addPort(source, sourcePort)

            this.addPort(target, targetPort)
            result.set(
                edge.id,
                this.edge(
                    edge,
                    sourcePort.id,
                    targetPort.id,
                ),
            )
        }

        const feedback = this.edges.filter(edge => edge.kind === 'feedback')
            .sort((a, b) => this.span(a) - this.span(b) || a.id.localeCompare(b.id))
        const top = Math.min(...this.nodes.map(node => node.position.y))
        const bottom = Math.max(...this.nodes.map(node => node.position.y + node.dimensions.height))

        for (const [index, edge] of feedback.entries()) {
            const source = this.byId.get(edge.source)!
            const target = this.byId.get(edge.target)!
            let routed = false

            // Longer returns occupy outer lanes, so nested feedback edges do
            // not cross each other's vertical legs.
            for (const side of ['top', 'bottom'] as const) {
                const lane = side === 'top'
                    ? top - this.gap * (index + 1)
                    : bottom + this.gap * (index + 1)
                const sourceEscape = this.escape(
                    source,
                    side,
                    lane,
                    'output',
                    `${edge.id}:source`,
                )
                const targetEscape = this.escape(
                    target,
                    side,
                    lane,
                    'input',
                    `${edge.id}:target`,
                )

                if (
                    !sourceEscape
                    || !targetEscape
                )
                    continue

                const points = [
                    ...sourceEscape.points,
                    ...targetEscape.points.toReversed(),
                ]
                const obstacles = this.obstacles(
                    new Set([
                        source.nodeId,
                        target.nodeId,
                    ]),
                )

                if (!isOrthogonalRouteClear(points, obstacles))
                    continue

                this.addPort(source, sourceEscape.port)
                this.addPort(target, targetEscape.port)
                result.set(
                    edge.id,
                    {
                        ...this.edge(
                            edge,
                            sourceEscape.port.id,
                            targetEscape.port.id,
                        ),
                        bendPoints: points.slice(1, -1),
                    },
                )
                routed = true

                break
            }

            if (!routed)
                throw new Error(`Workspace diagram feedback ${edge.id} has no clear exterior route`)
        }

        return this.edges.map(edge => result.get(edge.id)!)
    }

    private span(edge: WorkspaceDiagramEdge): number {
        const source = this.byId.get(edge.source)!
        const target = this.byId.get(edge.target)!

        return Math.abs(source.position.x + source.dimensions.width / 2 - target.position.x - target.dimensions.width / 2)
    }

    private obstacles(excluded: ReadonlySet<string>) {
        return this.nodes.filter(node => !excluded.has(node.nodeId)).map(
            node => ({
                id: node.nodeId,
                ...node.position,
                ...node.dimensions,
            }),
        )
    }

    private reserve(
        node: DiagramNode,
        direction: Direction,
    ): void {
        const port = node.ports.find(candidate => candidate.id === direction)!

        this.occupied.set(`${node.nodeId}:${direction}`, [port.anchor])
    }

    private port(
        node: DiagramNode,
        direction: Direction,
        role: CanvasPort['role'],
        id: string,
        fraction?: number,
    ): CanvasPort | undefined {
        const occupied = this.occupied.get(`${node.nodeId}:${direction}`) ?? []
        const horizontal = direction === 'top' || direction === 'bottom'
        const length = horizontal ? node.dimensions.width : node.dimensions.height
        const divisions = 2 ** Math.ceil(
            Math.log2(occupied.length + 2),
        )
        const fractions = fraction === undefined
            ? [0.5, ...Array.from({ length: divisions - 1 }, (_, index) => (index + 1) / divisions)]
            : [fraction]
        const position = fractions.find(candidate => occupied.every(anchor => Math.abs((horizontal ? anchor.x : anchor.y) - length * candidate) > 1))

        if (position === undefined)
            return undefined

        return {
            id,
            role,
            direction,
            anchor: {
                x: horizontal
                    ? length * position
                    : direction === 'left'
                        ? 0
                        : node.dimensions.width,
                y: horizontal
                    ? direction === 'top'
                        ? 0
                        : node.dimensions.height
                    : length * position,
            },
        }
    }

    private addPort(
        node: DiagramNode,
        port: CanvasPort,
    ): void {
        node.ports = [...node.ports, port]
        const key = `${node.nodeId}:${port.direction}`
        this.occupied.set(key, [...(this.occupied.get(key) ?? []), port.anchor])
    }

    private escape(
        node: DiagramNode,
        side: 'top' | 'bottom',
        lane: number,
        role: CanvasPort['role'],
        id: string,
    ): Escape | undefined {
        const obstacles = this.obstacles(
            new Set([node.nodeId]),
        )
        const candidates: Escape[] = []

        for (const direction of [side, 'left', 'right'] as const) {
            const port = this.port(
                node,
                direction,
                role,
                id,
            )

            if (!port)
                continue

            const anchor = {
                x: node.position.x + port.anchor.x,
                y: node.position.y + port.anchor.y,
            }
            const corridors = direction === side
                ? [anchor.x]
                : [
                    direction === 'left' ? node.position.x - this.gap : node.position.x + node.dimensions.width + this.gap,
                    ...obstacles.map(obstacle => direction === 'left' ? obstacle.x - this.gap : obstacle.x + obstacle.width + this.gap),
                ]

            for (const x of corridors) {
                if (
                    (direction === 'left' && x >= anchor.x)
                    || (direction === 'right' && x <= anchor.x)
                )
                    continue

                const points = direction === side
                    ? [anchor, {
                        x,
                        y: lane,
                    }]
                    : [anchor, {
                        x,
                        y: anchor.y,
                    }, {
                        x,
                        y: lane,
                    }]

                if (isOrthogonalRouteClear(points, obstacles))
                    candidates.push({
                        port,
                        points,
                    })
            }
        }

        return candidates.sort((a, b) => routeLength(a.points) - routeLength(b.points))[0]
    }

    private edge(
        edge: WorkspaceDiagramEdge,
        sourcePort: string,
        targetPort: string,
    ): EngineEdge<WorkspaceDiagramEdge> {
        return {
            edgeId: edge.id,
            source: {
                nodeId: edge.source,
                portId: sourcePort,
            },
            target: {
                nodeId: edge.target,
                portId: targetPort,
            },
            path: edge.kind
                && edge.kind !== 'forward'
                ? 'orthogonal'
                : 'horizontal-bezier',
            data: edge,
        }
    }
}
