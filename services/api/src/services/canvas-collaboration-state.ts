import { createHash } from 'node:crypto'
import {
    type CanvasCollaborationActor,
    type CanvasCollaborationComposerReader,
    type CanvasCollaborationEvent,
    type CanvasCollaborationLease,
    type CanvasCollaborationQueueEntry,
} from '@lixpi/constants'

export type CanvasParticipant = {
    actor: CanvasCollaborationActor
    userId: string
    expiresAt: number
    followSequence: number
    composerReader?: CanvasCollaborationComposerReader
}

export type CanvasOwnership = CanvasCollaborationLease & {
    requestId: string
}

type CanvasCommitReceipt = {
    actorId: string
    agentUserId?: string
    requestId: string
    requestHash: string
}

export type CanvasRoomState = {
    revision: number
    participants: Record<string, CanvasParticipant>
    leases: Record<string, CanvasOwnership>
    queue: CanvasCollaborationQueueEntry[]
    receipts: CanvasCommitReceipt[]
    assetWrites: Record<string, Record<string, number>>
    agentPublications: Record<string, {
        reservationId: string
        expiresAt: number
    }>
}

export const emptyCanvasRoom = (): CanvasRoomState => ({
    revision: 0,
    participants: {},
    leases: {},
    queue: [],
    receipts: [],
    assetWrites: {},
    agentPublications: {},
})

export const humanViewerId = (
    workspaceId: string,
    userId: string,
): string =>
    createHash('sha256')
        .update(
            JSON.stringify(['canvas-viewer', workspaceId, userId]),
        )
        .digest('base64url')

export const makeCanvasRoomEvent = (
    workspaceId: string,
    state: CanvasRoomState,
    canvasRevision: number,
): CanvasCollaborationEvent => ({
    workspaceId,
    revision: state.revision,
    canvasRevision,
    actors: Object.values(state.participants).map(
        participant =>
            participant.actor.kind === 'human' ? {
                ...participant.actor,
                viewerId: humanViewerId(workspaceId, participant.userId),
            } : participant.actor,
    ),
    ownership: Object.values(state.leases).map(({
        requestId: _requestId,
        ...lease
    }) => lease),
    queue: state.queue,
})

export const promoteQueuedCanvasAgents = (state: CanvasRoomState): void => {
    state.queue = state.queue.filter(request => {
        if (!state.participants[request.actorId])
            return false

        if (
            state.leases[request.target]
            || state.assetWrites[request.target]
            || state.agentPublications[request.target]
        )
            return true

        state.leases[request.target] = {
            ...request,
            leaseId: globalThis.crypto.randomUUID(),
        }

        return false
    })
}

export const pruneCanvasRoom = (
    state: CanvasRoomState,
    now: number,
): void => {
    for (const [actorId, participant] of Object.entries(state.participants))
        if (participant.expiresAt <= now)
            delete state.participants[actorId]

    for (const [target, writes] of Object.entries(state.assetWrites)) {
        for (const [writeId, expiresAt] of Object.entries(writes))
            if (expiresAt <= now)
                delete writes[writeId]

        if (!Object.keys(writes).length)
            delete state.assetWrites[target]
    }

    for (const [target, publication] of Object.entries(state.agentPublications))
        if (publication.expiresAt <= now)
            delete state.agentPublications[target]

    for (const lease of Object.values(state.leases))
        if (!state.participants[lease.actorId])
            delete state.leases[lease.target]

    for (const participant of Object.values(state.participants)) {
        const following = participant.actor.followingActorId

        if (
            following
            && !participant.actor.followingViewerId
            && !state.participants[following]
        )
            participant.actor.followingActorId = null
    }

    promoteQueuedCanvasAgents(state)
}

export const acquireCanvasTarget = (
    state: CanvasRoomState,
    request: CanvasCollaborationQueueEntry,
): void => {
    const current = state.leases[request.target]

    const participant = state.participants[request.actorId]

    if (
        current?.actorId === request.actorId
        && (participant.actor.kind === 'human' || current.requestId === request.requestId)
    )
        return

    if (
        Object.keys(state.leases).length >= 256
        && !current
    )
        throw new Error('CANVAS_OWNERSHIP_LIMIT')

    if (participant.actor.kind === 'human') {
        if (
            current
            && state.participants[current.actorId]?.actor.kind === 'human'
        )
            throw new Error('CANVAS_TARGET_OWNED')

        state.leases[request.target] = {
            ...request,
            leaseId: globalThis.crypto.randomUUID(),
        }

        return
    }

    if (state.queue.some(queued => queued.target === request.target && queued.actorId === request.actorId && queued.requestId === request.requestId))
        return

    if (state.queue.length >= 128)
        throw new Error('CANVAS_QUEUE_FULL')

    state.queue.push(request)
    promoteQueuedCanvasAgents(state)
}
