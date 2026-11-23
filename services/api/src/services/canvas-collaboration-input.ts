import { ECDH } from 'node:crypto'
import {
    type CanvasCollaborationChanges,
    type CanvasCollaborationComposerReader,
    type CanvasCollaborationPoint,
    type CanvasCollaborationPresence,
    type CanvasNode,
    type CanvasState,
    type WorkspaceEdge,
} from '@lixpi/constants'
import { isDeepStrictEqual } from 'node:util'

const nodeTypes = new Set([
    'document',
    'mediaDocument',
    'image',
    'video',
    'audio',
    'operationStatus',
    'branchOrigin',
    'branchFork',
    'branchLine',
    'capabilityArtifact',
])

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export const isCanvasId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,192}$/.test(value)

export const isCanvasTarget = (value: unknown): value is string => typeof value === 'string'
    && /^(node|edge|asset):[A-Za-z0-9_.:-]{1,192}$/.test(value)

export const isCanvasSequence = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9

const isPoint = (value: unknown): value is CanvasCollaborationPoint => isObject(value) && isCoordinate(value.x) && isCoordinate(value.y)

const isSize = (value: unknown): value is number => isCoordinate(value) && value >= 0

const point = (value: CanvasCollaborationPoint): CanvasCollaborationPoint => ({
    x: value.x,
    y: value.y,
})

const isIdList = (
    value: unknown,
    limit: number,
): value is string[] => Array.isArray(value) && value.length <= limit && value.every(isCanvasId)

const isTextSelection = (value: unknown): value is {
    anchor: number
    head: number
} => isObject(value) && isCanvasSequence(value.anchor) && isCanvasSequence(value.head)

const invalidPresence = (): never => {
    throw new Error('INVALID_CANVAS_PRESENCE')
}

export const readCanvasComposerReader = (value: unknown): CanvasCollaborationComposerReader => {
    if (
        !isObject(value)
        || typeof value.inboxId !== 'string'
        || !/^[A-Za-z0-9_-]{22,64}$/.test(value.inboxId)
        || typeof value.publicKey !== 'string'
        || !/^[A-Za-z0-9_-]{87}$/.test(value.publicKey)
    )
        throw new Error('INVALID_CANVAS_COMPOSER_READER')

    try {
        const key = Buffer.from(value.publicKey, 'base64url')
        ECDH.convertKey(key, 'prime256v1')

        if (
            key.length !== 65
            || key[0] !== 4
        )
            throw new Error('INVALID_CANVAS_COMPOSER_READER')
    } catch {
        throw new Error('INVALID_CANVAS_COMPOSER_READER')
    }

    return {
        inboxId: value.inboxId,
        publicKey: value.publicKey,
    }
}

export const readCanvasPresence = (input: CanvasCollaborationPresence): CanvasCollaborationPresence => {
    const presence: CanvasCollaborationPresence = {}
    const {
        camera,
        cursor,
        selection,
        menu,
        caret,
        panel,
        playback,
        library,
        composer,
        composerSelection,
        connector,
        geometry,
    } = input

    if (camera !== undefined) {
        if (
            !isPoint(camera)
            || !isCoordinate(camera.zoom)
            || camera.zoom <= 0
        )
            invalidPresence()

        presence.camera = {
            ...point(camera),
            zoom: camera.zoom,
        }
    }

    if (cursor !== undefined) {
        if (
            cursor !== null
            && !isPoint(cursor)
        )
            invalidPresence()

        presence.cursor = cursor === null ? null : point(cursor)
    }

    if (selection !== undefined) {
        if (
            !isObject(selection)
            || !isIdList(selection.nodeIds, 32)
            || !isIdList(selection.edgeIds, 32)
        )
            invalidPresence()

        presence.selection = {
            nodeIds: selection.nodeIds,
            edgeIds: selection.edgeIds,
        }
    }

    if (menu !== undefined) {
        if (
            menu !== null
            && (!isObject(menu) ||
                !isCanvasId(menu.kind) ||
                (menu.nodeId !== undefined && !isCanvasId(menu.nodeId)) ||
                (menu.edgeId !== undefined && !isCanvasId(menu.edgeId)) ||
                (menu.controlId !== undefined && !isCanvasId(menu.controlId)) ||
                (menu.position !== undefined && !isPoint(menu.position)) ||
                (menu.textSelection !== undefined && !isTextSelection(menu.textSelection)))
        )
            invalidPresence()

        presence.menu = menu === null ? null : {
            kind: menu.kind,
            ...(menu.nodeId !== undefined ? { nodeId: menu.nodeId } : {}),
            ...(menu.edgeId !== undefined ? { edgeId: menu.edgeId } : {}),
            ...(menu.controlId !== undefined ? { controlId: menu.controlId } : {}),
            ...(menu.textSelection !== undefined ? {
                textSelection: {
                    anchor: menu.textSelection.anchor,
                    head: menu.textSelection.head,
                },
            } : {}),
            ...(menu.position !== undefined ? { position: point(menu.position) } : {}),
        }
    }

    if (caret !== undefined) {
        if (
            caret !== null
            && (!isObject(caret) || !isCanvasId(caret.nodeId) || (caret.field !== undefined && caret.field !== 'content' && caret.field !== 'title') || !isCanvasSequence(caret.anchor) || !isCanvasSequence(caret.head))
        )
            invalidPresence()

        presence.caret = caret === null ? null : {
            nodeId: caret.nodeId,
            ...(caret.field !== undefined ? { field: caret.field } : {}),
            anchor: caret.anchor,
            head: caret.head,
        }
    }

    if (panel !== undefined) {
        if (
            !isObject(panel)
            || typeof panel.isOpen !== 'boolean'
            || !['capabilities', 'artifacts', 'media', 'aiThreads'].includes(panel.mode)
            || (panel.width !== undefined && (!isSize(panel.width) || panel.width > 4_096))
            || (panel.contextNodeIds !== undefined && !isIdList(panel.contextNodeIds, 32))
            || (panel.detailsTarget != null && (!isObject(panel.detailsTarget) || (panel.detailsTarget.kind !== 'output' && panel.detailsTarget.kind !== 'branch-marker') || !isCanvasId(panel.detailsTarget.nodeId)))
        )
            invalidPresence()

        presence.panel = {
            isOpen: panel.isOpen,
            mode: panel.mode,
            ...(panel.width !== undefined ? { width: panel.width } : {}),
            ...(panel.contextNodeIds !== undefined ? { contextNodeIds: panel.contextNodeIds } : {}),
            ...(panel.detailsTarget !== undefined ? {
                detailsTarget: panel.detailsTarget === null ? null : {
                    kind: panel.detailsTarget.kind,
                    nodeId: panel.detailsTarget.nodeId,
                },
            } : {}),
        }
    }

    if (playback !== undefined) {
        if (
            playback !== null
            && (!isObject(playback) ||
                !isCanvasId(playback.nodeId) ||
                !isSize(playback.time) ||
                typeof playback.paused !== 'boolean' ||
                !isSize(playback.rate) ||
                playback.rate < 0.25 ||
                playback.rate > 4 ||
                !isSize(playback.volume) ||
                playback.volume > 1 ||
                typeof playback.muted !== 'boolean' ||
                (playback.fullscreen !== undefined && typeof playback.fullscreen !== 'boolean'))
        )
            invalidPresence()

        presence.playback = playback === null ? null : {
            nodeId: playback.nodeId,
            time: playback.time,
            paused: playback.paused,
            rate: playback.rate,
            volume: playback.volume,
            muted: playback.muted,
            ...(playback.fullscreen !== undefined ? { fullscreen: playback.fullscreen } : {}),
        }
    }

    if (library !== undefined) {
        if (
            library !== null
            && (!isObject(library) || !['media', 'artifacts', 'capabilities'].includes(library.kind) || (library.selectedId !== null && !isCanvasId(library.selectedId)) || (library.scrollTop !== undefined && !isSize(library.scrollTop)))
        )
            invalidPresence()

        presence.library = library === null ? null : {
            kind: library.kind,
            selectedId: library.selectedId,
            ...(library.scrollTop !== undefined ? { scrollTop: library.scrollTop } : {}),
        }
    }

    if (composer !== undefined) {
        if (composer === null)
            presence.composer = null
        else {
            if (
                !isObject(composer)
                || !isObject(composer.content)
                || (composer.conversationAssetId != null && !isCanvasId(composer.conversationAssetId))
            )
                invalidPresence()

            let serialized: string

            try {
                serialized = JSON.stringify(composer.content)

                if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024)
                    invalidPresence()
            } catch {
                invalidPresence()
            }

            presence.composer = {
                ...(composer.conversationAssetId !== undefined ? { conversationAssetId: composer.conversationAssetId } : {}),
                content: JSON.parse(serialized) as object,
            }
        }
    }

    if (composerSelection !== undefined) {
        if (
            composerSelection !== null
            && !isTextSelection(composerSelection)
        )
            invalidPresence()

        presence.composerSelection = composerSelection === null ? null : {
            anchor: composerSelection.anchor,
            head: composerSelection.head,
        }
    }

    if (connector !== undefined) {
        if (
            connector !== null
            && (!isObject(connector) || !isPoint(connector.source) || !isPoint(connector.target) || !['bezier', 'straight', 'smoothstep', 'horizontal-bezier', 'orthogonal'].includes(connector.pathType) || (connector.lineStyle !== 'solid' && connector.lineStyle !== 'dashed'))
        )
            invalidPresence()

        presence.connector = connector === null ? null : {
            source: point(connector.source),
            target: point(connector.target),
            pathType: connector.pathType,
            lineStyle: connector.lineStyle,
        }
    }

    if (geometry !== undefined) {
        if (
            !Array.isArray(geometry)
            || geometry.length > 24
        )
            invalidPresence()

        presence.geometry = geometry.map(item => {
            if (
                !isPoint(item)
                || !isCanvasId(item.nodeId)
                || !isSize(item.width)
                || !isSize(item.height)
            )
                invalidPresence()

            return {
                nodeId: item.nodeId,
                ...point(item),
                width: item.width,
                height: item.height,
            }
        })
    }

    return presence
}

const isNode = (value: unknown): value is CanvasNode => isObject(value)
    && isCanvasId(value.nodeId)
    && typeof value.type === 'string'
    && nodeTypes.has(value.type)
    && isPoint(value.position)
    && isObject(value.dimensions)
    && isSize(value.dimensions.width)
    && isSize(value.dimensions.height)

const isEdge = (value: unknown): value is WorkspaceEdge => isObject(value)
    && isCanvasId(value.edgeId)
    && isCanvasId(value.sourceNodeId)
    && isCanvasId(value.targetNodeId)

export const applyCanvasChanges = (
    state: CanvasState,
    changes: CanvasCollaborationChanges,
): CanvasState => {
    if (!isObject(changes))
        throw new Error('INVALID_CANVAS_CHANGES')

    const nodes = changes.nodes === undefined ? [] : changes.nodes
    const edges = changes.edges === undefined ? [] : changes.edges
    const removedNodeIds = changes.removedNodeIds === undefined ? [] : changes.removedNodeIds
    const removedEdgeIds = changes.removedEdgeIds === undefined ? [] : changes.removedEdgeIds

    if (
        !Array.isArray(nodes)
        || !Array.isArray(edges)
        || !isIdList(removedNodeIds, 256)
        || !isIdList(removedEdgeIds, 256)
        || nodes.length + edges.length + removedNodeIds.length + removedEdgeIds.length > 256
        || !nodes.every(isNode)
        || !edges.every(isEdge)
    )
        throw new Error('INVALID_CANVAS_CHANGES')

    const nodeMap = new Map(
        state.nodes.map(node => [node.nodeId, node]),
    )
    const edgeMap = new Map(
        state.edges.map(edge => [edge.edgeId, edge]),
    )

    for (const nodeId of removedNodeIds)
        nodeMap.delete(nodeId)

    for (const node of nodes)
        nodeMap.set(node.nodeId, node)

    for (const edgeId of removedEdgeIds)
        edgeMap.delete(edgeId)

    for (const edge of edges) {
        if (
            !nodeMap.has(edge.sourceNodeId)
            || !nodeMap.has(edge.targetNodeId)
        )
            throw new Error('CANVAS_EDGE_ENDPOINT_NOT_FOUND')

        edgeMap.set(edge.edgeId, edge)
    }

    for (const [edgeId, edge] of edgeMap)
        if (
            !nodeMap.has(edge.sourceNodeId)
            || !nodeMap.has(edge.targetNodeId)
        )
            edgeMap.delete(edgeId)

    return {
        ...state,
        nodes: [...nodeMap.values()],
        edges: [...edgeMap.values()],
    }
}

const changedEntityIds = <Entity>(
    previous: Entity[],
    next: Entity[],
    identify: (entity: Entity) => string,
): string[] => {
    const previousById = new Map(
        previous.map(entity => [identify(entity), entity]),
    )
    const changedIds = new Set<string>()

    for (const entity of next) {
        const id = identify(entity)

        if (!isDeepStrictEqual(
            previousById.get(id),
            entity,
        ))
            changedIds.add(id)

        previousById.delete(id)
    }

    for (const id of previousById.keys())
        changedIds.add(id)

    return [...changedIds]
}

export const changedCanvasTargets = (
    previous: CanvasState,
    next: CanvasState,
): string[] => [
    ...changedEntityIds(
        previous.nodes,
        next.nodes,
        node => node.nodeId,
    ).map(id => `node:${id}`),
    ...changedEntityIds(
        previous.edges,
        next.edges,
        edge => edge.edgeId,
    ).map(id => `edge:${id}`),
]
