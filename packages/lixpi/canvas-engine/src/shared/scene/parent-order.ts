export const topoSortByParent = <T extends {
    nodeId: string
    parentId?: string
}>(nodes: readonly T[]): T[] => {
    const byId = new Map<string, T>()

    for (const n of nodes) byId.set(n.nodeId, n)

    const sorted: T[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()

    const visit = (n: T) => {
        if (visited.has(n.nodeId))
            return

        if (visiting.has(n.nodeId))
            throw new Error(`Cyclic parenting at node ${n.nodeId}`)

        visiting.add(n.nodeId)

        if (
            n.parentId
            && byId.has(n.parentId)
        )
            visit(byId.get(n.parentId)!)

        visiting.delete(n.nodeId)
        visited.add(n.nodeId)
        sorted.push(n)
    }

    for (const n of nodes) visit(n)

    return sorted
}
