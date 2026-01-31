// elkjs-powered edge routing service
// Computes orthogonal edge paths with bend points to avoid overlapping

// Use the bundled browser version (no web-worker dependency)
import ELK from 'elkjs/lib/elk.bundled.js'
import type { EdgeConfig, NodeConfig } from '$src/infographics/connectors/types.ts'

type ElkNode = {
    id: string
    x: number
    y: number
    width: number
    height: number
    ports?: ElkPort[]
    properties?: Record<string, unknown>
}

type ElkPort = {
    id: string
    x: number
    y: number
    width?: number
    height?: number
    properties?: Record<string, unknown>
}

type ElkEdge = {
    id: string
    sources: string[]
    targets: string[]
}

type ElkSection = {
    id: string
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
    bendPoints?: Array<{ x: number; y: number }>
}

type ElkEdgeResult = {
    id: string
    sections?: ElkSection[]
}

type ElkGraph = {
    id: string
    layoutOptions: Record<string, string | number | boolean>
    children: ElkNode[]
    edges: ElkEdge[]
}

type ElkResult = {
    children?: ElkNode[]
    edges?: ElkEdgeResult[]
}

// Singleton ELK instance
let elkInstance: InstanceType<typeof ELK> | null = null

function getElk(): InstanceType<typeof ELK> {
    if (!elkInstance) {
        elkInstance = new ELK()
    }
    return elkInstance
}

// Compute port position along a node side based on t value (0-1)
// For left/right sides: t=0 is top, t=1 is bottom
function computePortPosition(
    node: NodeConfig,
    side: 'left' | 'right',
    t: number = 0.5
): { x: number; y: number } {
    const y = node.height * t
    const x = side === 'left' ? 0 : node.width
    return { x, y }
}

// Build elk ports for a node based on connected edges
function buildNodePorts(
    node: NodeConfig,
    edges: EdgeConfig[]
): ElkPort[] {
    const ports: ElkPort[] = []

    for (const edge of edges) {
        // Source port
        if (edge.source.nodeId === node.id) {
            const side = edge.source.position as 'left' | 'right'
            if (side === 'left' || side === 'right') {
                const t = edge.source.t ?? 0.5
                const pos = computePortPosition(node, side, t)
                ports.push({
                    id: `${node.id}_src_${edge.id}`,
                    x: pos.x,
                    y: pos.y,
                    width: 1,
                    height: 1,
                    properties: {
                        'org.eclipse.elk.port.side': side === 'left' ? 'WEST' : 'EAST'
                    }
                })
            }
        }

        // Target port
        if (edge.target.nodeId === node.id) {
            const side = edge.target.position as 'left' | 'right'
            if (side === 'left' || side === 'right') {
                const t = edge.target.t ?? 0.5
                const pos = computePortPosition(node, side, t)
                ports.push({
                    id: `${node.id}_tgt_${edge.id}`,
                    x: pos.x,
                    y: pos.y,
                    width: 1,
                    height: 1,
                    properties: {
                        'org.eclipse.elk.port.side': side === 'left' ? 'WEST' : 'EAST'
                    }
                })
            }
        }
    }

    return ports
}

// Compute edge routes using elkjs
// Returns a map of edge id -> bend points
export async function computeEdgeRoutes(
    nodes: NodeConfig[],
    edges: EdgeConfig[]
): Promise<Map<string, Array<{ x: number; y: number }>>> {
    const elk = getElk()

    // Build elk graph
    // Note: 'layered' algorithm is required for proper ORTHOGONAL edge routing
    // 'force' algorithm does NOT support orthogonal routing
    const elkGraph: ElkGraph = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.direction': 'RIGHT',
            'elk.portConstraints': 'FIXED_POS',
            'elk.spacing.edgeEdge': '15',
            'elk.spacing.edgeNode': '15',
            'elk.spacing.nodeNode': '30',
            'elk.layered.spacing.edgeEdgeBetweenLayers': '15',
            'elk.layered.spacing.edgeNodeBetweenLayers': '15',
            // Keep nodes at their fixed positions
            'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
            'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
        },
        children: nodes.map(node => ({
            id: node.id,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            ports: buildNodePorts(node, edges),
            properties: {
                'org.eclipse.elk.noLayout': true  // Don't move nodes
            }
        })),
        edges: edges.map(edge => ({
            id: edge.id,
            sources: [`${edge.source.nodeId}_src_${edge.id}`],
            targets: [`${edge.target.nodeId}_tgt_${edge.id}`]
        }))
    }

    const result = await elk.layout(elkGraph) as ElkResult

    // Debug: log the elkjs result to understand what's being returned
    console.log('[elkjs] Layout result:', JSON.stringify(result, null, 2))

    // Extract bend points from result
    const routeMap = new Map<string, Array<{ x: number; y: number }>>()

    for (const elkEdge of result.edges ?? []) {
        const points: Array<{ x: number; y: number }> = []

        for (const section of elkEdge.sections ?? []) {
            // Add bend points (intermediate turns)
            // Note: startPoint and endPoint are the port positions,
            // bendPoints are the intermediate orthogonal turns
            console.log(`[elkjs] Edge ${elkEdge.id} section:`, section)
            for (const bp of section.bendPoints ?? []) {
                points.push({ x: bp.x, y: bp.y })
            }
        }

        console.log(`[elkjs] Edge ${elkEdge.id} bend points:`, points)
        routeMap.set(elkEdge.id, points)
    }

    return routeMap
}

// Debounced edge routing computation
type DebouncedCompute = {
    schedule: (nodes: NodeConfig[], edges: EdgeConfig[]) => void
    cancel: () => void
}

export function createDebouncedEdgeRouting(
    onComplete: (routes: Map<string, Array<{ x: number; y: number }>>) => void,
    delay: number = 50
): DebouncedCompute {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let pendingNodes: NodeConfig[] = []
    let pendingEdges: EdgeConfig[] = []

    const execute = async () => {
        const nodes = pendingNodes
        const edges = pendingEdges
        pendingNodes = []
        pendingEdges = []

        try {
            const routes = await computeEdgeRoutes(nodes, edges)
            onComplete(routes)
        } catch (error) {
            console.error('elkjs edge routing failed:', error)
        }
    }

    return {
        schedule(nodes: NodeConfig[], edges: EdgeConfig[]) {
            pendingNodes = nodes
            pendingEdges = edges

            if (timeoutId !== null) {
                clearTimeout(timeoutId)
            }

            timeoutId = setTimeout(() => {
                timeoutId = null
                execute()
            }, delay)
        },

        cancel() {
            if (timeoutId !== null) {
                clearTimeout(timeoutId)
                timeoutId = null
            }
            pendingNodes = []
            pendingEdges = []
        }
    }
}
