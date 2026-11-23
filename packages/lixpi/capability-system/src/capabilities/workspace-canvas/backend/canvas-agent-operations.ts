import { v5 as uuidv5 } from 'uuid'
import {
    resolveCanvasViewerActor,
    type CanvasCollaborationActor,
    type CanvasCollaborationChanges,
    type CanvasCollaborationLease,
    type CanvasCollaborationPresence,
    type CanvasCollaborationSnapshot,
    type CanvasNode,
    type CanvasNodePosition,
    type CanvasState,
    type WorkspaceEdge,
} from '@lixpi/constants'
import {
    createCanvasDocumentContent,
    prepareCanvasDocumentStep,
} from './canvas-agent-documents.ts'
import {
    type CanvasAgentAsset,
    type CanvasAgentDocumentEdit,
    type CanvasAgentDocumentRole,
    type CanvasAgentSession,
    type CanvasCameraEdit,
    type CanvasConnectionEdit,
    type CanvasNodePatch,
    type CanvasPlacement,
} from './canvas-agent-ports.ts'

const graph = (snapshot: CanvasCollaborationSnapshot): CanvasState => {
    if (!snapshot.canvasState)
        throw new Error('CANVAS_STATE_UNAVAILABLE')

    return snapshot.canvasState
}

const nodeById = (
    state: CanvasState,
    nodeId: string,
): CanvasNode => {
    const node = state.nodes.find(item => item.nodeId === nodeId)

    if (!node)
        throw new Error('CANVAS_NODE_NOT_FOUND')

    return node
}

const assetOf = (node: CanvasNode): string => {
    if (
        !('assetId' in node)
        || !node.assetId
        || node.type === 'operationStatus'
    )
        throw new Error('CANVAS_NODE_HAS_NO_ASSET')

    return node.assetId
}

const nodeTarget = (id: string): string => `node:${id}`
const edgeTarget = (id: string): string => `edge:${id}`
const assetTarget = (id: string): string => `asset:${id}`

export const withCanvasAgentLeases = async <T>(
    session: CanvasAgentSession,
    targets: string[],
    work: (leases: CanvasCollaborationLease[]) => Promise<T>,
): Promise<T> => {
    const leases: CanvasCollaborationLease[] = []

    try {
        for (const target of [...new Set(targets)].sort())
            leases.push(await session.acquire(target))

        session.signal.throwIfAborted()

        return await work(leases)
    } finally {
        await Promise.allSettled(
            leases.map(lease => session.release(lease)),
        )
    }
}

const worldPosition = (
    node: CanvasNode,
    resolveParent: (nodeId: string) => CanvasNode,
): CanvasNodePosition => {
    let position = { ...node.position }
    let parentId = node.parentId
    const visited = new Set([node.nodeId])

    while (parentId) {
        if (visited.has(parentId))
            throw new Error('CANVAS_NODE_PARENT_CYCLE')

        const parent = resolveParent(parentId)
        visited.add(parentId)
        position = {
            x: position.x + parent.position.x,
            y: position.y + parent.position.y,
        }
        parentId = parent.parentId
    }

    return position
}

const proposeGeometry = (
    state: CanvasState,
    patches: CanvasNodePatch[],
): CanvasNode[] => {
    const pending = new Set<string>()
    const requested = new Map(
        patches.map(patch => [patch.nodeId, patch]),
    )
    const resolved = new Map<string, CanvasNode>()
    const resolve = (nodeId: string): CanvasNode => {
        const previous = resolved.get(nodeId)

        if (previous)
            return previous

        const node = nodeById(state, nodeId)
        const patch = requested.get(nodeId)

        if (!patch)
            return node

        if (pending.has(nodeId))
            throw new Error('CANVAS_NODE_PARENT_CYCLE')

        pending.add(nodeId)
        const parentId = patch.parentId === undefined ? node.parentId : (patch.parentId ?? undefined)
        let position = patch.position ?? node.position

        if (
            !patch.position
            && (patch.offset || parentId !== node.parentId)
        ) {
            const original = worldPosition(node, id => nodeById(state, id))
            const parent = parentId ? worldPosition(
                resolve(parentId),
                resolve,
            ) : {
                x: 0,
                y: 0,
            }
            position = {
                x: original.x - parent.x + (patch.offset?.x ?? 0),
                y: original.y - parent.y + (patch.offset?.y ?? 0),
            }
        }

        const next = {
            ...node,
            position,
            dimensions: patch.dimensions ?? node.dimensions,
        }

        if (parentId) {
            nodeById(state, parentId)
            next.parentId = parentId
        } else {
            delete next.parentId

            if (next.extent === 'parent')
                delete next.extent
        }

        pending.delete(nodeId)
        resolved.set(nodeId, next)

        return next
    }

    return patches.map(patch => resolve(patch.nodeId))
}

const placementNode = (
    asset: CanvasAgentAsset,
    nodeId: string,
    placement: CanvasPlacement & { position: CanvasNodePosition },
): CanvasNode => {
    const aspectRatio = asset.media?.aspectRatio
    const dimensions = placement.dimensions ?? (asset.media?.kind === 'audio'
        ? {
            width: 360,
            height: 96,
        }
        : asset.media
            || asset.artifact
            ? {
                width: 600,
                height: 600 / (aspectRatio
                    && aspectRatio > 0
                    ? aspectRatio
                    : 1),
            }
            : {
                width: 400,
                height: 350,
            })
    const node = {
        nodeId,
        assetId: asset.assetId,
        position: placement.position,
        dimensions,
        ...(placement.parentId ? { parentId: placement.parentId } : {}),
    }

    if (asset.artifact)
        return {
            ...node,
            type: 'capabilityArtifact',
            artifactTypeId: asset.artifact.artifactTypeId,
        }

    if (asset.media)
        return {
            ...node,
            type: asset.media.kind === 'document' ? 'mediaDocument' : asset.media.kind,
        }

    if (asset.documents.content)
        return {
            ...node,
            type: 'document',
        }

    throw new Error('CANVAS_ASSET_HAS_NO_PLACEABLE_CONTENT')
}

export class CanvasAgentOperations {
    constructor(private readonly session: CanvasAgentSession) {}

    async inspect(): Promise<object> {
        const snapshot = await this.session.inspect()
        const state = graph(snapshot)
        const assetIds = [...new Set(
            state.nodes.flatMap(
                node => 'assetId' in node
                    && node.assetId
                    ? [node.assetId]
                    : [],
            ),
        )]
        const assets = await Promise.allSettled(
            assetIds.map(id => this.session.readAsset(id)),
        )

        const viewers = new Map<string, CanvasCollaborationActor>()

        for (const actor of snapshot.actors) {
            if (
                actor.kind !== 'human'
                || !actor.viewerId
            )
                continue

            const current = viewers.get(actor.viewerId)
            viewers.set(actor.viewerId, current ? resolveCanvasViewerActor([current, actor], actor.viewerId)! : actor)
        }

        return {
            actorId: snapshot.actorId,
            revision: snapshot.canvasRevision,
            camera: this.camera(snapshot),
            nodes: state.nodes,
            assets: assets.flatMap(
                result => result.status === 'fulfilled' ? [{
                    assetId: result.value.assetId,
                    title: result.value.title,
                    revision: result.value.revision,
                    documentRoles: Object.keys(result.value.documents),
                }] : [],
            ),
            connections: state.edges,
            viewers: [...viewers].map(
                ([viewerId, {
                    actorId,
                    name,
                }]) => ({
                    viewerId,
                    actorId,
                    name,
                }),
            ),
            actors: snapshot.actors,
            ownership: snapshot.ownership,
            queue: snapshot.queue,
        }
    }

    async presence(presence: CanvasCollaborationPresence): Promise<object> {
        const state = graph(await this.session.inspect())

        for (const nodeId of presence.selection?.nodeIds ?? [])
            nodeById(state, nodeId)

        for (const edgeId of presence.selection?.edgeIds ?? [])
            if (!state.edges.some(edge => edge.edgeId === edgeId))
                throw new Error('CANVAS_EDGE_NOT_FOUND')

        if (presence.menu?.nodeId)
            nodeById(state, presence.menu.nodeId)

        if (
            presence.menu?.edgeId
            && !state.edges.some(edge => edge.edgeId === presence.menu?.edgeId)
        )
            throw new Error('CANVAS_EDGE_NOT_FOUND')

        for (const nodeId of presence.panel?.contextNodeIds ?? [])
            nodeById(state, nodeId)

        if (presence.panel?.detailsTarget)
            nodeById(state, presence.panel.detailsTarget.nodeId)

        if (presence.playback) {
            const media = nodeById(state, presence.playback.nodeId)

            if (
                media.type !== 'video'
                && media.type !== 'audio'
            )
                throw new Error('CANVAS_MEDIA_KIND_MISMATCH')
        }

        if (presence.caret?.nodeId)
            nodeById(state, presence.caret.nodeId)

        const snapshot = await this.session.updatePresence(presence)

        return { actor: snapshot.actors.find(actor => actor.actorId === snapshot.actorId) }
    }

    async navigate(edit: CanvasCameraEdit): Promise<object> {
        const snapshot = await this.session.inspect()
        const state = graph(snapshot)
        const camera = this.camera(snapshot)
        let center = edit.center ?? camera

        if (edit.focusNodeId) {
            const node = nodeById(state, edit.focusNodeId)
            const position = worldPosition(node, id => nodeById(state, id))
            center = {
                x: position.x + node.dimensions.width / 2,
                y: position.y + node.dimensions.height / 2,
            }
        }

        return await this.presence({
            camera: {
                x: center.x + (edit.offset?.x ?? 0),
                y: center.y + (edit.offset?.y ?? 0),
                zoom: edit.zoom ?? camera.zoom,
            },
        })
    }

    async follow(actorId: string | null): Promise<object> {
        const snapshot = await this.session.follow(actorId)

        return { actor: snapshot.actors.find(actor => actor.actorId === snapshot.actorId) }
    }

    async editGeometry(patches: CanvasNodePatch[]): Promise<object> {
        if (new Set(
            patches.map(patch => patch.nodeId),
        ).size !== patches.length)
            throw new Error('CANVAS_NODE_PATCH_DUPLICATE')

        return await withCanvasAgentLeases(
            this.session,
            patches.map(patch => nodeTarget(patch.nodeId)),
            async leases => {
                const snapshot = await this.session.inspect()
                const state = graph(snapshot)
                const nodes = proposeGeometry(state, patches)
                const patchById = new Map(
                    nodes.map(node => [node.nodeId, node]),
                )
                const proposed = {
                    ...state,
                    nodes: state.nodes.map(node => patchById.get(node.nodeId) ?? node),
                }
                const geometry = nodes.map(
                    node => ({
                        nodeId: node.nodeId,
                        ...worldPosition(node, id => nodeById(proposed, id)),
                        ...node.dimensions,
                    }),
                )
                await this.session.updatePresence({ geometry })

                try {
                    const result = await this.session.commit(
                        snapshot.canvasRevision,
                        { nodes },
                        leases,
                    )

                    return {
                        revision: result.canvasRevision,
                        nodes: (result.canvasState ?? proposed).nodes.filter(node => patchById.has(node.nodeId)).map(
                            node => ({
                                nodeId: node.nodeId,
                                position: node.position,
                                dimensions: node.dimensions,
                                parentId: node.parentId,
                            }),
                        ),
                    }
                } finally {
                    await Promise.allSettled([this.session.updatePresence({ geometry: [] })])
                }
            },
        )
    }

    async editConnection(edit: CanvasConnectionEdit): Promise<object> {
        const edgeId = edit.action === 'connect'
            ? uuidv5(`edge:${this.session.requestId}`, uuidv5.URL)
            : edit.edgeId!

        return await withCanvasAgentLeases(
            this.session,
            [edgeTarget(edgeId)],
            async leases => {
                const snapshot = await this.session.inspect()
                const state = graph(snapshot)
                const existing = state.edges.find(edge => edge.edgeId === edgeId)

                if (
                    edit.action !== 'connect'
                    && !existing
                )
                    throw new Error('CANVAS_EDGE_NOT_FOUND')

                let changes: CanvasCollaborationChanges
                let edge: WorkspaceEdge | undefined

                if (edit.action === 'disconnect')
                    changes = { removedEdgeIds: [edgeId] }
                else {
                    const sourceNodeId = edit.sourceNodeId ?? existing!.sourceNodeId
                    const targetNodeId = edit.targetNodeId ?? existing!.targetNodeId
                    nodeById(state, sourceNodeId)
                    nodeById(state, targetNodeId)

                    if (sourceNodeId === targetNodeId)
                        throw new Error('CANVAS_EDGE_SELF_CONNECTION')

                    edge = {
                        ...existing,
                        edgeId,
                        sourceNodeId,
                        targetNodeId,
                        ...(edit.sourceHandle === undefined ? {} : { sourceHandle: edit.sourceHandle }),
                        ...(edit.targetHandle === undefined ? {} : { targetHandle: edit.targetHandle }),
                        ...(edit.sourceT === undefined ? {} : { sourceT: edit.sourceT }),
                        ...(edit.targetT === undefined ? {} : { targetT: edit.targetT }),
                        ...(edit.pathType === undefined ? {} : { pathType: edit.pathType }),
                    }
                    changes = { edges: [edge] }
                }

                const result = await this.session.commit(
                    snapshot.canvasRevision,
                    changes,
                    leases,
                )

                return {
                    edgeId,
                    ...(edge ? { edge } : { removed: true }),
                    revision: result.canvasRevision,
                }
            },
        )
    }

    async importMedia(
        url: string,
        placement: CanvasPlacement,
    ): Promise<object> {
        const source = await this.session.importPublicMedia(url)

        return await this.place(placement, source)
    }

    async place(
        placement: CanvasPlacement,
        source: {
            title: string
            content?: string
        } | { assetId: string } | { sourceNodeId: string },
    ): Promise<object> {
        const nodeId = `node-${uuidv5(`node:${this.session.requestId}`, uuidv5.URL)}`

        return await withCanvasAgentLeases(
            this.session,
            [nodeTarget(nodeId)],
            async leases => {
                const snapshot = await this.session.inspect()
                const state = graph(snapshot)

                const parent = placement.parentId ? nodeById(state, placement.parentId) : undefined
                const camera = this.camera(snapshot)
                const parentWorld = parent ? worldPosition(parent, id => nodeById(state, id)) : {
                    x: 0,
                    y: 0,
                }
                const center = {
                    x: camera.x - parentWorld.x,
                    y: camera.y - parentWorld.y,
                }
                const cover = {
                    ...placement,
                    position: placement.position ?? center,
                }

                const existing = state.nodes.find(node => node.nodeId === nodeId)

                if (existing)
                    return {
                        nodeId,
                        assetId: assetOf(existing),
                        revision: snapshot.canvasRevision,
                    }

                const assetId = 'title' in source
                    ? uuidv5(`asset:${this.session.requestId}`, uuidv5.URL)
                    : 'assetId' in source
                        ? source.assetId
                        : assetOf(
                            nodeById(state, source.sourceNodeId),
                        )
                const node: CanvasNode = 'title' in source ? {
                    nodeId,
                    type: 'document',
                    assetId,
                    position: cover.position,
                    dimensions: cover.dimensions ?? {
                        width: 400,
                        height: 350,
                    },
                    ...(placement.parentId ? { parentId: placement.parentId } : {}),
                } : placementNode(
                    await this.session.readAsset(assetId),
                    nodeId,
                    cover,
                )

                if (!placement.position)
                    node.position = {
                        x: center.x - node.dimensions.width / 2,
                        y: center.y - node.dimensions.height / 2,
                    }

                if (
                    placement.avoidOverlap
                    ?? !placement.position
                )
                    node.position = this.session.resolvePlacement(state, node)

                const mutation = {
                    node,
                    state: {
                        ...state,
                        nodes: [...state.nodes, node],
                    },
                    revision: snapshot.canvasRevision,
                    leases,
                }

                if ('title' in source)
                    await this.session.createDocument(
                        mutation,
                        source.title,
                        createCanvasDocumentContent(source.content),
                    )
                else
                    await this.session.attachAsset(mutation)

                return {
                    nodeId,
                    assetId,
                    revision: (await this.session.inspect()).canvasRevision,
                }
            },
        )
    }

    async remove(nodeId: string): Promise<object> {
        const initial = graph(await this.session.inspect())

        if (!initial.nodes.some(node => node.nodeId === nodeId))
            return {
                nodeId,
                removed: true,
            }

        const initialPlan = await this.session.prepareManagedRemoval(
            initial,
            nodeById(initial, nodeId),
        )
        const initialTargets = [...this.removalTargets(initial, nodeId), ...(initialPlan?.targets ?? [])]

        return await withCanvasAgentLeases(
            this.session,
            initialTargets,
            async leases => {
                const snapshot = await this.session.inspect()
                const state = graph(snapshot)
                const node = state.nodes.find(node => node.nodeId === nodeId)

                if (!node)
                    return {
                        nodeId,
                        removed: true,
                        revision: snapshot.canvasRevision,
                    }

                const plan = await this.session.prepareManagedRemoval(state, node)
                const currentTargets = [...this.removalTargets(state, nodeId), ...plan?.targets ?? []]

                if (currentTargets.some(target => !initialTargets.includes(target)))
                    throw new Error('CANVAS_REMOVAL_NEIGHBORS_CHANGED')

                if (await plan?.execute(leases)) {
                    const latest = await this.session.inspect()

                    return {
                        nodeId,
                        removed: !graph(latest).nodes.some(item => item.nodeId === nodeId),
                        revision: latest.canvasRevision,
                    }
                }

                const children = state.nodes.filter(item => item.parentId === nodeId).map(item => {
                    const child = {
                        ...item,
                        position: worldPosition(item, id => nodeById(state, id)),
                    }
                    delete child.parentId

                    if (child.extent === 'parent')
                        delete child.extent

                    return child
                })
                const removedEdgeIds = state.edges.filter(edge => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId).map(
                    edge => edge.edgeId,
                )

                if (
                    'assetId' in node
                    && node.assetId
                    && node.type !== 'operationStatus'
                ) {
                    const childById = new Map(
                        children.map(child => [child.nodeId, child]),
                    )
                    await this.session.detachAsset({
                        node,
                        state: {
                            ...state,
                            nodes: state.nodes.filter(item => item.nodeId !== nodeId).map(item => childById.get(item.nodeId) ?? item),
                            edges: state.edges.filter(edge => !removedEdgeIds.includes(edge.edgeId)),
                        },
                        revision: snapshot.canvasRevision,
                        leases,
                    })
                } else
                    await this.session.commit(
                        snapshot.canvasRevision,
                        {
                            nodes: children,
                            removedNodeIds: [nodeId],
                            removedEdgeIds,
                        },
                        leases,
                    )

                return {
                    nodeId,
                    removed: true,
                    revision: (await this.session.inspect()).canvasRevision,
                }
            },
        )
    }

    async rename(
        nodeId: string,
        title: string,
        expectedRevision: number,
    ): Promise<object> {
        const assetId = await this.nodeAssetId(nodeId)

        return await withCanvasAgentLeases(
            this.session,
            [assetTarget(assetId)],
            async leases => {
                if (await this.nodeAssetId(nodeId) !== assetId)
                    throw new Error('CANVAS_NODE_ASSET_CHANGED')

                const asset = await this.session.renameAsset(
                    assetId,
                    title,
                    expectedRevision,
                    leases[0]!,
                )

                return {
                    assetId,
                    title: asset.title,
                    revision: asset.revision,
                }
            },
        )
    }

    async readDocument(
        nodeId: string,
        role: CanvasAgentDocumentRole,
    ): Promise<object> {
        return await this.session.readDocument(await this.nodeAssetId(nodeId), role)
    }

    async editDocument(
        nodeId: string,
        role: CanvasAgentDocumentRole,
        expectedVersion: number,
        edit: CanvasAgentDocumentEdit,
    ): Promise<object> {
        const assetId = await this.nodeAssetId(nodeId)

        return await withCanvasAgentLeases(
            this.session,
            [assetTarget(assetId)],
            async leases => {
                if (await this.nodeAssetId(nodeId) !== assetId)
                    throw new Error('CANVAS_NODE_ASSET_CHANGED')

                const result = await this.session.editDocument(
                    assetId,
                    role,
                    expectedVersion,
                    engine => prepareCanvasDocumentStep(engine, edit),
                    leases[0]!,
                )

                return {
                    assetId,
                    role,
                    version: result.version,
                }
            },
        )
    }

    private camera(snapshot: CanvasCollaborationSnapshot) {
        return (
            snapshot.actors.find(actor => actor.actorId === snapshot.actorId)?.camera ?? {
                x: 0,
                y: 0,
                zoom: 1,
            }
        )
    }

    private async nodeAssetId(nodeId: string): Promise<string> {
        return assetOf(
            nodeById(
                graph(await this.session.inspect()),
                nodeId,
            ),
        )
    }

    private removalTargets(
        state: CanvasState,
        nodeId: string,
    ): string[] {
        const targets = [nodeTarget(nodeId)]
        const node = nodeById(state, nodeId)

        if (
            'assetId' in node
            && node.assetId
            && node.type !== 'operationStatus'
        )
            targets.push(
                assetTarget(node.assetId),
            )

        for (const child of state.nodes)
            if (child.parentId === nodeId)
                targets.push(
                    nodeTarget(child.nodeId),
                )

        for (const edge of state.edges)
            if (
                edge.sourceNodeId === nodeId
                || edge.targetNodeId === nodeId
            )
                targets.push(
                    edgeTarget(edge.edgeId),
                )

        return targets
    }
}
