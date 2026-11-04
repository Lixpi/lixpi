import {
    getOrthogonalRoutePoints,
    isOrthogonalRouteClear,
    isOrthogonalRouteSimple,
    type CanvasEnginePoint,
    type CanvasEngineRect,
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
type Obstacle = CanvasEngineRect & { id: string }
type Escape = {
    port: CanvasPort
    points: CanvasEnginePoint[]
}
type FeedbackRoute = {
    source: Escape
    target: Escape
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

const compareEdgeIds = (
    a: WorkspaceDiagramEdge,
    b: WorkspaceDiagramEdge,
): number => (a.id === b.id
    ? 0
    : a.id < b.id
        ? -1
        : 1)

// This planner owns graph-level port separation and feedback lanes. The engine
// remains responsible for obstacle checks, point routing and path rounding.
export class WorkspaceDiagramRouting {
    private readonly byId: Map<string, DiagramNode>
    private readonly occupied = new Map<string, CanvasEnginePoint[]>()
    private readonly connectors: Obstacle[] = []

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
        const ordered = this.edges.toSorted(compareEdgeIds)

        for (const edge of ordered) {
            if (edge.kind === 'feedback')
                continue

            if (edge.kind !== 'relation') {
                const routed = this.edge(
                    edge,
                    'right',
                    'left',
                )
                result.set(edge.id, routed)
                // The horizontal Bezier's control points remain inside this
                // endpoint hull. Reserving the hull is deliberately conservative.
                const start = this.anchor(this.byId.get(edge.source)!, 'right')
                const end = this.anchor(this.byId.get(edge.target)!, 'left')
                this.reserveSegments(
                    edge.id,
                    [{
                        x: Math.min(start.x, end.x - this.gap),
                        y: start.y,
                    }, {
                        x: Math.max(start.x + this.gap, end.x),
                        y: end.y,
                    }],
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
            const sourceAnchor = this.anchor(source, sourcePort.id)
            const targetAnchor = this.anchor(target, targetPort.id)
            const points = getOrthogonalRoutePoints(
                sourceAnchor.x,
                sourceAnchor.y,
                targetAnchor.x,
                targetAnchor.y,
                sourceDirection,
                targetDirection,
                24,
                undefined,
                this.obstacles(
                    new Set(),
                ),
                source.nodeId,
                target.nodeId,
                0,
                1,
                this.gap,
            )
            const routed = this.edge(
                edge,
                sourcePort.id,
                targetPort.id,
            )
            routed.bendPoints = points.slice(1, -1)
            result.set(edge.id, routed)
            this.reserveSegments(edge.id, points)
        }

        const feedback = ordered.filter(edge => edge.kind === 'feedback')
            .sort((a, b) => this.span(a) - this.span(b) || compareEdgeIds(a, b))
        const top = Math.min(...this.nodes.map(node => node.position.y), ...this.connectors.map(obstacle => obstacle.y))
        const bottom = Math.max(
            ...this.nodes.map(node => node.position.y + node.dimensions.height),
            ...this.connectors.map(obstacle => obstacle.y + obstacle.height),
        )

        for (const [index, edge] of feedback.entries()) {
            const source = this.byId.get(edge.source)!
            const target = this.byId.get(edge.target)!
            const candidates: FeedbackRoute[] = []

            // Longer returns receive outer lanes. Evaluate both sides and all
            // escape pairs before selecting a route; a short node-clear exit
            // can cross the forward branches or an earlier feedback route.
            for (const side of ['top', 'bottom'] as const) {
                const lane = side === 'top'
                    ? top - this.gap * (index + 1)
                    : bottom + this.gap * (index + 1)
                const sourceEscapes = this.escapes(
                    source,
                    side,
                    lane,
                    'output',
                    `${edge.id}:source`,
                )
                const targetEscapes = this.escapes(
                    target,
                    side,
                    lane,
                    'input',
                    `${edge.id}:target`,
                )

                for (const sourceEscape of sourceEscapes) {
                    for (const targetEscape of targetEscapes) {
                        const points = [
                            ...sourceEscape.points,
                            ...targetEscape.points.toReversed(),
                        ]

                        const excludedNodes = new Set<string>()
                        excludedNodes.add(source.nodeId)
                        excludedNodes.add(target.nodeId)

                        if (
                            !isOrthogonalRouteSimple(points)
                            || !this.clear(points, excludedNodes)
                        )
                            continue

                        candidates.push({
                            source: sourceEscape,
                            target: targetEscape,
                            points,
                        })
                    }
                }
            }

            // Candidate enumeration is canonical: top before bottom, centered
            // ports before off-center ports, then sorted corridor coordinates.
            const preference = (route: FeedbackRoute): number => this.portPreference(source, route.source.port) + this.portPreference(
                target,
                route.target.port,
            )
            const routed = candidates.toSorted((a, b) => preference(a) - preference(b) || routeLength(a.points) - routeLength(b.points))[0]

            if (!routed)
                throw new Error(`Workspace diagram feedback ${edge.id} has no clear exterior route`)

            this.addPort(source, routed.source.port)
            this.addPort(target, routed.target.port)
            result.set(
                edge.id,
                {
                    ...this.edge(
                        edge,
                        routed.source.port.id,
                        routed.target.port.id,
                    ),
                    bendPoints: routed.points.slice(1, -1),
                },
            )
            this.reserveSegments(edge.id, routed.points)
        }

        return this.edges.map(edge => result.get(edge.id)!)
    }

    private portPreference(
        node: DiagramNode,
        port: CanvasPort,
    ): number {
        const horizontal = port.direction === 'top' || port.direction === 'bottom'
        const fraction = horizontal
            ? port.anchor.x / node.dimensions.width
            : port.anchor.y / node.dimensions.height

        return Math.abs(fraction - 0.5)
    }

    private span(edge: WorkspaceDiagramEdge): number {
        const source = this.byId.get(edge.source)!
        const target = this.byId.get(edge.target)!

        return Math.abs(source.position.x + source.dimensions.width / 2 - target.position.x - target.dimensions.width / 2)
    }

    private obstacles(excluded: ReadonlySet<string>): Obstacle[] {
        return this.nodes.filter(node => !excluded.has(node.nodeId)).map(
            node => ({
                id: node.nodeId,
                ...node.position,
                ...node.dimensions,
            }),
        )
    }

    private clear(
        points: readonly CanvasEnginePoint[],
        excluded: ReadonlySet<string>,
    ): boolean {
        // Native markerGap is 64. Half of it covers the bounded native arrow
        // half-width, stroke and the 24-unit renderer's rounded corner deviation.
        return isOrthogonalRouteClear(
            points,
            this.obstacles(excluded),
        )
            && isOrthogonalRouteClear(
                points,
                this.connectors,
                this.gap / 2,
            )
    }

    private reserveSegments(
        id: string,
        points: readonly CanvasEnginePoint[],
    ): void {
        for (const [index, end] of points.entries()) {
            if (!index)
                continue

            const start = points[index - 1]
            this.connectors.push({
                id: `${id}:${index}`,
                x: Math.min(start.x, end.x),
                y: Math.min(start.y, end.y),
                width: Math.abs(start.x - end.x),
                height: Math.abs(start.y - end.y),
            })
        }
    }

    private anchor(
        node: DiagramNode,
        portId: string,
    ): CanvasEnginePoint {
        const port = node.ports.find(candidate => candidate.id === portId)!

        return {
            x: node.position.x + port.anchor.x,
            y: node.position.y + port.anchor.y,
        }
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

    private escapes(
        node: DiagramNode,
        side: 'top' | 'bottom',
        lane: number,
        role: CanvasPort['role'],
        id: string,
    ): Escape[] {
        const excludedNodes = new Set([node.nodeId])
        const obstacles = this.obstacles(excludedNodes)
        const corridorObstacles = [...obstacles, ...this.connectors]
        const candidates: Escape[] = []

        for (const direction of [side, 'left', 'right'] as const) {
            const occupied = this.occupied.get(`${node.nodeId}:${direction}`) ?? []
            const divisions = 2 ** Math.ceil(
                Math.log2(occupied.length + 4),
            )
            const fractions = [...new Set([
                0.5,
                ...Array.from({ length: divisions - 1 }, (_, index) => (index + 1) / divisions),
            ])]

            for (const fraction of fractions) {
                const port = this.port(
                    node,
                    direction,
                    role,
                    id,
                    fraction,
                )

                if (!port)
                    continue

                const anchor = {
                    x: node.position.x + port.anchor.x,
                    y: node.position.y + port.anchor.y,
                }
                const corridors = [...new Set([
                    node.position.x - this.gap,
                    node.position.x + node.dimensions.width + this.gap,
                    ...corridorObstacles.flatMap(
                        obstacle => [
                            obstacle.x - this.gap,
                            obstacle.x + obstacle.width + this.gap,
                        ],
                    ),
                ])].sort((a, b) => a - b)
                const routes: CanvasEnginePoint[][] = direction === side
                    ? [[anchor, {
                        x: anchor.x,
                        y: lane,
                    }]]
                    : []

                if (direction === side) {
                    // A vertically blocked port can first enter the inter-row
                    // gap, move around the blocker, then reach the exterior rail.
                    // Every candidate retains the native outward endpoint lead.
                    const leads = [...new Set([
                        anchor.y + (side === 'top' ? -this.gap : this.gap),
                        ...corridorObstacles.flatMap(
                            obstacle => [
                                obstacle.y - this.gap,
                                obstacle.y + obstacle.height + this.gap,
                            ],
                        ),
                    ])].filter(
                        y => side === 'top'
                            ? y <= anchor.y - this.gap && y > lane
                            : y >= anchor.y + this.gap && y < lane,
                    ).sort((a, b) => Math.abs(a - anchor.y) - Math.abs(b - anchor.y))

                    for (const y of leads) {
                        for (const x of corridors) {
                            if (x === anchor.x)
                                continue

                            routes.push([
                                anchor,
                                {
                                    x: anchor.x,
                                    y,
                                },
                                {
                                    x,
                                    y,
                                },
                                {
                                    x,
                                    y: lane,
                                },
                            ])
                        }
                    }
                } else {
                    for (const x of corridors) {
                        if (
                            (direction === 'left' && x > anchor.x - this.gap)
                            || (direction === 'right' && x < anchor.x + this.gap)
                        )
                            continue

                        routes.push([
                            anchor,
                            {
                                x,
                                y: anchor.y,
                            },
                            {
                                x,
                                y: lane,
                            },
                        ])
                    }
                }

                for (const points of routes) {
                    if (this.clear(points, excludedNodes))
                        candidates.push({
                            port,
                            points,
                        })
                }
            }
        }

        return candidates
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
