import {
    type CanvasState,
} from '@lixpi/constants'

const same = (
    left: unknown,
    right: unknown,
): boolean => left === right || JSON.stringify(left) === JSON.stringify(right)

const applyLocalFields = <Value extends object>(
    base: Value,
    local: Value,
    remote: Value,
): Value => {
    const next = { ...remote }

    for (const field of new Set([
        ...Object.keys(base),
        ...Object.keys(local),
    ]) as Set<keyof Value>) {
        if (same(base[field], local[field]))
            continue

        if (Object.hasOwn(local, field))
            next[field] = local[field]
        else
            delete next[field]
    }

    return next
}

const mergeEntities = <Value extends object>(
    base: readonly Value[],
    local: readonly Value[],
    remote: readonly Value[],
    identity: (value: Value) => string,
): Value[] => {
    const baseline = new Map(
        base.map(value => [identity(value), value]),
    )
    const requested = new Map(
        local.map(value => [identity(value), value]),
    )
    const current = new Map(
        remote.map(value => [identity(value), value]),
    )
    const result: Value[] = []

    for (const [id, received] of current) {
        const previous = baseline.get(id)
        const edit = requested.get(id)

        if (
            previous
            && edit
        )
            result.push(
                applyLocalFields(
                    previous,
                    edit,
                    received,
                ),
            )
        else if (!previous)
            result.push(received)
    }

    for (const [id, edit] of requested) {
        if (
            !baseline.has(id)
            && !current.has(id)
        )
            result.push(edit)
    }

    return result
}

export const mergeConcurrentCanvasChanges = (
    base: CanvasState,
    local: CanvasState,
    remote: CanvasState,
): CanvasState => {
    const nodes = mergeEntities(
        base.nodes,
        local.nodes,
        remote.nodes,
        node => node.nodeId,
    )
    const nodeIds = new Set(
        nodes.map(node => node.nodeId),
    )
    const edges = mergeEntities(
        base.edges,
        local.edges,
        remote.edges,
        edge => edge.edgeId,
    ).filter(edge => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))

    return {
        ...applyLocalFields(
            base,
            local,
            remote,
        ),
        nodes,
        edges,
    }
}
