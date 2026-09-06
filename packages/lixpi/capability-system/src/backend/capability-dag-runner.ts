export type CapabilityDagNode = {
    nodeId: string
    dependsOn: readonly string[]
}

export type CapabilityDagNodeStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'skipped'
    | 'failed'
    | 'cancelled'

const SUCCESS_STATUSES = new Set<CapabilityDagNodeStatus>([
    'completed',
    'skipped',
])

export class CapabilityDagRunner<Node extends CapabilityDagNode> {
    private readonly nodesById: ReadonlyMap<string, Node>
    private readonly orderedNodeIds: readonly string[]
    private readonly statuses = new Map<string, CapabilityDagNodeStatus>()

    constructor(nodes: readonly Node[]) {
        this.orderedNodeIds = nodes.map(node => node.nodeId)
        this.nodesById = new Map(
            nodes.map(node => [node.nodeId, node]),
        )
        this.validate(nodes)

        for (const node of nodes)
            this.statuses.set(node.nodeId, 'pending')
    }

    hasPending(): boolean {
        return this.orderedNodeIds.some(nodeId => this.statuses.get(nodeId) === 'pending')
    }

    getStatus(nodeId: string): CapabilityDagNodeStatus | undefined {
        return this.statuses.get(nodeId)
    }

    getReadyNodes(): Node[] {
        return this.orderedNodeIds.flatMap(nodeId => {
            const node = this.nodesById.get(nodeId)

            if (
                !node
                || this.statuses.get(nodeId) !== 'pending'
            )
                return []

            return node.dependsOn.every(dependency => SUCCESS_STATUSES.has(this.statuses.get(dependency)!))
                ? [node]
                : []
        })
    }

    setStatus(
        nodeId: string,
        status: CapabilityDagNodeStatus,
    ): void {
        if (!this.nodesById.has(nodeId))
            throw new Error(`CAPABILITY_DAG_NODE_UNKNOWN:${nodeId}`)

        this.statuses.set(nodeId, status)
    }

    cancelPending(): Node[] {
        const cancelled: Node[] = []

        for (const nodeId of this.orderedNodeIds) {
            if (this.statuses.get(nodeId) !== 'pending')
                continue

            this.statuses.set(nodeId, 'cancelled')
            const node = this.nodesById.get(nodeId)

            if (node)
                cancelled.push(node)
        }

        return cancelled
    }

    snapshot(): Readonly<Record<string, CapabilityDagNodeStatus>> {
        return Object.freeze(
            Object.fromEntries(
                this.orderedNodeIds.map(nodeId => [nodeId, this.statuses.get(nodeId)!]),
            ),
        )
    }

    private validate(nodes: readonly Node[]): void {
        if (nodes.length === 0)
            throw new Error('CAPABILITY_DAG_EMPTY')

        const seen = new Set<string>()

        for (const node of nodes) {
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(node.nodeId))
                throw new Error(`CAPABILITY_DAG_NODE_ID_INVALID:${node.nodeId}`)

            if (seen.has(node.nodeId))
                throw new Error(`CAPABILITY_DAG_NODE_ID_DUPLICATE:${node.nodeId}`)

            seen.add(node.nodeId)
        }

        for (const node of nodes) {
            const dependencies = new Set<string>()

            for (const dependency of node.dependsOn) {
                if (dependency === node.nodeId)
                    throw new Error(`CAPABILITY_DAG_SELF_DEPENDENCY:${node.nodeId}`)

                if (!seen.has(dependency))
                    throw new Error(`CAPABILITY_DAG_DEPENDENCY_UNKNOWN:${node.nodeId}:${dependency}`)

                if (dependencies.has(dependency))
                    throw new Error(`CAPABILITY_DAG_DEPENDENCY_DUPLICATE:${node.nodeId}:${dependency}`)

                dependencies.add(dependency)
            }
        }

        this.assertAcyclic(nodes)
    }

    private assertAcyclic(nodes: readonly Node[]): void {
        const visiting = new Set<string>()
        const visited = new Set<string>()
        const visit = (nodeId: string): void => {
            if (visited.has(nodeId))
                return

            if (visiting.has(nodeId))
                throw new Error(`CAPABILITY_DAG_CYCLE:${nodeId}`)

            visiting.add(nodeId)
            const node = this.nodesById.get(nodeId)
                ?? nodes.find(candidate => candidate.nodeId === nodeId)

            for (const dependency of node?.dependsOn ?? [])
                visit(dependency)

            visiting.delete(nodeId)
            visited.add(nodeId)
        }

        for (const node of nodes)
            visit(node.nodeId)
    }
}
