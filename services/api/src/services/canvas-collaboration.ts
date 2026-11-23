import {
    createHash,
    randomUUID,
} from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'
import {
    resolveCanvasViewerActor,
    type CanvasCollaborationCommit,
    type CanvasCollaborationComposerReader,
    type CanvasCollaborationEvent,
    type CanvasCollaborationLease,
    type CanvasCollaborationPresence,
    type CanvasCollaborationPresenceAck,
    type CanvasCollaborationRequest,
    type CanvasCollaborationResponse,
    type CanvasCollaborationSnapshot,
    type CanvasState,
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import User from '../models/user.ts'
import { AccountRequestContext } from './account-request-context.ts'
import Workspace, {
    type AuthorizedWorkspace,
} from '../models/workspace.ts'
import {
    applyCanvasChanges,
    changedCanvasTargets,
    isCanvasId,
    isCanvasSequence,
    isCanvasTarget,
    readCanvasComposerReader,
    readCanvasPresence,
} from './canvas-collaboration-input.ts'
import { CanvasCollaborationPresenceRelay } from './canvas-collaboration-presence.ts'
import {
    activeWorkspaceCondition,
    canvasLeaseCondition,
    readCanvasRoom,
    writeCanvasRoom,
} from './canvas-collaboration-repository.ts'
import {
    acquireCanvasTarget,
    makeCanvasRoomEvent,
    pruneCanvasRoom,
    type CanvasParticipant,
    type CanvasRoomState,
} from './canvas-collaboration-state.ts'
import {
    canvasLeaseTransaction,
    isCanvasTransactionConflict,
    observeWorkspaceCanvasWrites,
} from './canvas-collaboration-transaction.ts'
import { KeyedOperationCoordinator } from './keyed-operation-coordinator.ts'
import { canEditWorkspace } from './workspace-navigation/access.ts'
import { workspaceTreeRepository } from './workspace-tree.ts'

const ACTOR_TTL_MS = 45_000
const ACTOR_RENEWAL_MS = 25_000
const ACTIVITY_CLOCK_SKEW_MS = 2_000
const AGENT_POLL_MS = 250
const ROOM_RETRY_LIMIT = 8
const ACTOR_LIMIT = 48
const ROUTING_TTL_MS = 2_000
const ROUTING_CACHE_LIMIT = 2_048
const HUMAN_ASSET_WRITE_TTL_MS = 60_000
const AGENT_PUBLICATION_TTL_MS = 15_000

type CanvasCommitFences = () => TransactOperation[] | Promise<TransactOperation[]>

type CachedRoom = {
    minimumRevision: number
    expiresAt: number
    state?: CanvasRoomState
}

type CanvasSession = {
    workspaceId: string
    userId: string
    sessionId: string
}

export type CanvasAgentSession = CanvasSession & {
    name: string
}

type HumanCanvasSave = Parameters<typeof Workspace.updateCanvasState>[0] & {
    sessionId?: string
}

const getActorId = (
    session: CanvasSession,
    kind: 'human' | 'agent',
): string =>
    createHash('sha256')
        .update(
            JSON.stringify([session.workspaceId, session.userId, session.sessionId, kind]),
        )
        .digest('base64url')

const getCanvasRevision = (workspace: Pick<AuthorizedWorkspace, 'canvasStateUpdatedAt' | 'updatedAt'>): number =>
    workspace.canvasStateUpdatedAt ?? workspace.updatedAt ?? 0

const getParticipant = (
    state: CanvasRoomState,
    actorId: string,
): CanvasParticipant => {
    const participant = state.participants[actorId]

    if (
        !participant
        || participant.expiresAt <= Date.now()
    )
        throw new Error('CANVAS_SESSION_NOT_JOINED')

    return participant
}

const requireLease = (
    state: CanvasRoomState,
    actorId: string,
    target: string,
    leaseId: string | undefined,
): void => {
    const current = state.leases[target]

    if (
        !current
        || current.actorId !== actorId
        || current.leaseId !== leaseId
    )
        throw new Error('CANVAS_LEASE_LOST')
}

const clearActor = (
    state: CanvasRoomState,
    actorId: string,
): void => {
    delete state.participants[actorId]
    pruneCanvasRoom(
        state,
        Date.now(),
    )
}

const nextActorExpiry = (): number => Date.now() + ACTOR_TTL_MS

const isPublicStateEqual = (
    left: CanvasRoomState,
    right: CanvasRoomState,
): boolean =>
    isDeepStrictEqual(
        makeCanvasRoomEvent(
            '',
            {
                ...left,
                revision: 0,
            },
            0,
        ),
        makeCanvasRoomEvent(
            '',
            {
                ...right,
                revision: 0,
            },
            0,
        ),
    )

class CanvasCollaboration {
    private readonly operations = new KeyedOperationCoordinator()
    private readonly presence = new CanvasCollaborationPresenceRelay()
    private readonly canvasRevisions = new Map<string, number>()
    private readonly roomRouting = new Map<string, CachedRoom>()

    start(): void {
        this.presence.start(({
            workspaceId,
            roomRevision,
        }) => this.invalidateRouting(workspaceId, roomRevision))
        observeWorkspaceCanvasWrites(async write => {
            try {
                const state = await readCanvasRoom(write.workspaceId)

                this.rememberCanvasRevision(write.workspaceId, write.canvasRevision)

                if (!Object.keys(state.participants).length)
                    return

                const workspace = await Workspace.getWorkspaceInternal({ workspaceId: write.workspaceId })

                if (
                    !workspace
                    || workspace.deletingAt
                )
                    return

                await this.publish(
                    write.workspaceId,
                    state,
                    getCanvasRevision(workspace),
                    workspace.canvasState,
                )
            } catch (error) {
                err('Canvas graph event delivery failed', error)
            }
        })
    }

    async handle(
        userId: string,
        request: CanvasCollaborationRequest,
    ): Promise<CanvasCollaborationResponse> {
        const {
            workspaceId,
            sessionId,
        } = request

        if (
            !isCanvasId(workspaceId)
            || !isCanvasId(sessionId)
        )
            return { error: 'INVALID_CANVAS_SESSION' }

        const session = {
            workspaceId,
            userId,
            sessionId,
        }
        const actorId = getActorId(session, 'human')

        try {
            if (request.action === 'presence')
                return await this.handlePresence(
                    session,
                    actorId,
                    request,
                )

            const workspace = await this.authorize(session, request.action === 'acquire' || request.action === 'commit')
            const canvasRevision = getCanvasRevision(workspace)
            this.rememberCanvasRevision(workspaceId, canvasRevision)

            switch (request.action) {
                case 'join': {
                    const user = await User.get(userId)

                    return await this.join(
                        session,
                        'human',
                        user?.givenName || user?.name || 'Collaborator',
                        workspace,
                        request.composerReader !== undefined ? readCanvasComposerReader(request.composerReader) : undefined,
                    )
                }
                case 'leave':
                    return this.snapshot(
                        workspaceId,
                        actorId,
                        await this.mutateRoom(workspaceId, state => clearActor(state, actorId)),
                    )
                case 'follow':
                    return await this.follow(
                        session,
                        actorId,
                        request,
                    )
                case 'acquire':
                    return await this.acquire(
                        session,
                        actorId,
                        request.target,
                        request.requestId,
                    )
                case 'release':
                    return await this.release(
                        session,
                        actorId,
                        request.target,
                        request.leaseId,
                    )
                case 'commit':
                    return await this.commit(
                        session,
                        actorId,
                        request,
                    )
                default:
                    return { error: 'INVALID_CANVAS_ACTION' }
            }
        } catch (error) {
            if (
                error instanceof Error
                && /^[A-Z_]+$/.test(error.message)
            )
                return { error: error.message }

            throw error
        }
    }

    async saveHumanCanvas(input: HumanCanvasSave): Promise<Awaited<ReturnType<typeof Workspace.updateCanvasState>>> {
        const {
            sessionId,
            ...update
        } = input

        if (input.persistViewport)
            return await Workspace.updateCanvasState(update)

        return await this.operations.run(input.workspaceId, async () => {
            for (let attempt = 0; attempt < ROOM_RETRY_LIMIT; attempt += 1) {
                const state = await readCanvasRoom(input.workspaceId)
                const previous = structuredClone(state)
                const actorId = typeof sessionId === 'string'
                    ? getActorId(
                        {
                            ...input,
                            sessionId,
                        },
                        'human',
                    )
                    : undefined
                pruneCanvasRoom(
                    state,
                    Date.now(),
                )

                const result = await Workspace.updateCanvasState({
                    ...update,
                    prepareCanvasWrite: (current, next) => {
                        const targets = changedCanvasTargets(current, next)

                        if (!targets.length)
                            return []

                        this.preemptHumanTargets(
                            state,
                            targets,
                            actorId,
                        )

                        state.revision += 1

                        return [writeCanvasRoom(
                            input.workspaceId,
                            previous.revision,
                            state,
                        )]
                    },
                })

                if (result.success) {
                    if (state.revision !== previous.revision)
                        this.roomChanged(input.workspaceId, state)

                    if (!isPublicStateEqual(previous, state))
                        await this.publish(
                            input.workspaceId,
                            state,
                            result.canvasStateUpdatedAt,
                        )

                    return result
                }

                if (result.currentCanvasStateUpdatedAt !== (input.expectedCanvasStateUpdatedAt ?? input.expectedUpdatedAt))
                    return result

                await delay(Math.random() * 20)
            }

            throw new Error('CANVAS_COLLABORATION_BUSY')
        })
    }

    async joinAgent(agent: CanvasAgentSession): Promise<CanvasCollaborationSnapshot> {
        const workspace = await this.authorize(agent, true)

        return await this.join(
            agent,
            'agent',
            agent.name,
            workspace,
        )
    }

    async syncAgentCanvas(agent: CanvasAgentSession): Promise<CanvasCollaborationSnapshot> {
        const actorId = getActorId(agent, 'agent')
        const workspace = await this.authorize(agent, true)
        const state = await this.renewActor(agent.workspaceId, actorId)
        const canvasRevision = getCanvasRevision(workspace)
        this.rememberCanvasRevision(agent.workspaceId, canvasRevision)

        return this.snapshot(
            agent.workspaceId,
            actorId,
            state,
            workspace.canvasState,
            canvasRevision,
        )
    }

    async leaveAgent(agent: CanvasAgentSession): Promise<void> {
        await this.mutateRoom(
            agent.workspaceId,
            state => clearActor(
                state,
                getActorId(agent, 'agent'),
            ),
        )
    }

    async updateAgentPresence(
        agent: CanvasAgentSession,
        presence: CanvasCollaborationPresence,
    ): Promise<CanvasCollaborationSnapshot> {
        const actorId = getActorId(agent, 'agent')
        const workspace = await this.authorize(agent, true)
        const state = await this.renewActor(agent.workspaceId, actorId)
        const current = this.presence.current(agent.workspaceId, actorId)
        const sequence = Math.max(
            Date.now(),
            (current?.sequence ?? 0) + 1,
        )
        this.presence.update(
            agent.workspaceId,
            state,
            actorId,
            sequence,
            readCanvasPresence(presence),
        )

        return this.snapshot(
            agent.workspaceId,
            actorId,
            state,
            undefined,
            getCanvasRevision(workspace),
        )
    }

    async followAsAgent(
        agent: CanvasAgentSession,
        actorId: string | null,
    ): Promise<CanvasCollaborationSnapshot> {
        await this.authorize(agent, true)

        return await this.follow(
            agent,
            getActorId(agent, 'agent'),
            { actorId },
            true,
        )
    }

    async acquireAgentLease(
        agent: CanvasAgentSession,
        target: string,
        requestId: string,
        signal?: AbortSignal,
    ): Promise<CanvasCollaborationLease> {
        await this.authorize(agent, true)
        const actorId = getActorId(agent, 'agent')
        signal?.throwIfAborted()
        const requested = await this.acquire(
            agent,
            actorId,
            target,
            requestId,
        )

        try {
            let lease = requested.lease

            while (!lease) {
                await delay(
                    AGENT_POLL_MS,
                    undefined,
                    { signal },
                )
                await this.authorize(agent, true)
                const state = await this.renewActor(agent.workspaceId, actorId)
                const current = state.leases[target]

                if (
                    current?.actorId === actorId
                    && current.requestId === requestId
                )
                    lease = current

                if (
                    !lease
                    && !state.queue.some(entry => entry.actorId === actorId && entry.requestId === requestId)
                )
                    throw new Error('CANVAS_LEASE_LOST')
            }

            signal?.throwIfAborted()

            return {
                target,
                actorId,
                leaseId: lease.leaseId,
            }
        } catch (error) {
            await this.cancelAgentRequest(
                agent.workspaceId,
                actorId,
                target,
                requestId,
            )

            throw error
        }
    }

    async releaseAgentLease(
        agent: CanvasAgentSession,
        lease: CanvasCollaborationLease,
    ): Promise<void> {
        await this.release(
            agent,
            getActorId(agent, 'agent'),
            lease.target,
            lease.leaseId,
            true,
        )
    }

    async isAgentLeaseCurrent(
        agent: CanvasAgentSession,
        lease: CanvasCollaborationLease,
    ): Promise<boolean> {
        await this.authorize(agent, true)
        const actorId = getActorId(agent, 'agent')
        const state = await readCanvasRoom(agent.workspaceId)

        return state.participants[actorId]?.expiresAt > Date.now()
            && state.leases[lease.target]?.actorId === actorId
            && state.leases[lease.target]?.leaseId === lease.leaseId
    }

    async withAgentLease<T>(
        agent: CanvasAgentSession,
        lease: CanvasCollaborationLease,
        work: () => Promise<T>,
        additionalFences?: CanvasCommitFences,
    ): Promise<T> {
        return await this.withAgentLeases(
            agent,
            [lease],
            work,
            additionalFences,
        )
    }

    async withAgentLeases<T>(
        agent: CanvasAgentSession,
        leases: CanvasCollaborationLease[],
        work: () => Promise<T>,
        additionalFences?: CanvasCommitFences,
    ): Promise<T> {
        await this.authorize(agent, true)
        const actorId = getActorId(agent, 'agent')
        const state = await this.renewActor(agent.workspaceId, actorId)
        const leaseIds = Object.fromEntries(
            leases.map(lease => {
                requireLease(
                    state,
                    actorId,
                    lease.target,
                    lease.leaseId,
                )

                return [lease.target, lease.leaseId]
            }),
        )
        const fences = async () => [
            canvasLeaseCondition(
                agent.workspaceId,
                actorId,
                leaseIds,
            ),
            ...await additionalFences?.() ?? [],
        ]

        try {
            return await canvasLeaseTransaction.run(fences, work)
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error)) {
                const current = await readCanvasRoom(agent.workspaceId)

                getParticipant(current, actorId)

                for (const lease of leases)
                    requireLease(
                        current,
                        actorId,
                        lease.target,
                        lease.leaseId,
                    )
            }

            throw error
        }
    }

    async commitAgent(
        agent: CanvasAgentSession,
        input: CanvasCollaborationCommit,
        additionalFences?: CanvasCommitFences,
    ): Promise<CanvasCollaborationSnapshot> {
        await this.authorize(agent, true)

        return await this.commit(
            agent,
            getActorId(agent, 'agent'),
            input,
            additionalFences,
        )
    }

    async withHumanAssetWrite<T>(
        workspaceId: string,
        userId: string,
        assetId: string,
        work: () => Promise<T>,
    ): Promise<T> {
        if (
            !isCanvasId(workspaceId)
            || !isCanvasId(assetId)
        )
            throw new Error('INVALID_CANVAS_TARGET')

        await this.authorize(
            {
                workspaceId,
                userId,
                sessionId: '',
            },
            true,
        )

        const target = `asset:${assetId}`
        const writeId = randomUUID()
        await this.mutateRoom(workspaceId, state => {
            const lease = state.leases[target]

            if (
                lease
                && state.participants[lease.actorId]?.actor.kind === 'agent'
            )
                delete state.leases[target]

            state.assetWrites[target] ??= {}

            if (Object.keys(state.assetWrites[target]).length >= 32)
                throw new Error('CANVAS_ASSET_WRITE_BUSY')

            state.assetWrites[target][writeId] = Date.now() + HUMAN_ASSET_WRITE_TTL_MS
        })

        const releaseReservation = AccountRequestContext.prepareCleanup(async () => {
            await this.mutateRoom(workspaceId, state => {
                const writes = state.assetWrites[target]

                if (writes)
                    delete writes[writeId]
            })
        })

        try {
            await this.waitForAgentPublication(workspaceId, target)

            return await work()
        } finally {
            try {
                await releaseReservation()
            } catch (error) {
                err('Canvas Asset write ownership cleanup failed', error)
            }
        }
    }

    async withAgentDocumentPublish<T>(
        agent: CanvasAgentSession,
        lease: CanvasCollaborationLease,
        work: () => Promise<T>,
    ): Promise<T> {
        if (
            !isCanvasTarget(lease.target)
            || !lease.target.startsWith('asset:')
        )
            throw new Error('INVALID_CANVAS_TARGET')

        await this.authorize(agent, true)

        const actorId = getActorId(agent, 'agent')
        const { workspaceId } = agent
        const reservationId = randomUUID()

        await canvasLeaseTransaction.exit(async () => {
            await this.mutateRoom(workspaceId, state => {
                getParticipant(state, actorId)
                requireLease(
                    state,
                    actorId,
                    lease.target,
                    lease.leaseId,
                )

                if (state.agentPublications[lease.target])
                    throw new Error('CANVAS_ASSET_WRITE_BUSY')

                state.agentPublications[lease.target] = {
                    reservationId,
                    expiresAt: Date.now() + AGENT_PUBLICATION_TTL_MS,
                }
            })
        })

        const releaseReservation = AccountRequestContext.prepareCleanup(async () => {
            await canvasLeaseTransaction.exit(async () => {
                await this.mutateRoom(workspaceId, state => {
                    if (state.agentPublications[lease.target]?.reservationId === reservationId)
                        delete state.agentPublications[lease.target]
                })
            })
        })

        try {
            AccountRequestContext.assertActive()

            return await work()
        } finally {
            try {
                await releaseReservation()
            } catch (error) {
                err('Canvas agent publication cleanup failed', error)
            }
        }
    }

    private async waitForAgentPublication(
        workspaceId: string,
        target: string,
    ): Promise<void> {
        const deadline = Date.now() + AGENT_PUBLICATION_TTL_MS

        while (Date.now() < deadline) {
            const state = await readCanvasRoom(workspaceId)
            const publication = state.agentPublications[target]

            if (
                !publication
                || publication.expiresAt <= Date.now()
            )
                return

            AccountRequestContext.assertActive()
            await delay(50)
        }

        throw new Error('CANVAS_ASSET_WRITE_BUSY')
    }

    private async authorize(
        session: CanvasSession,
        write: boolean,
    ): Promise<AuthorizedWorkspace> {
        const workspace = await Workspace.getWorkspace({
            workspaceId: session.workspaceId,
            userId: session.userId,
        })

        if ('error' in workspace)
            throw new Error(workspace.error)

        if (workspace.deletingAt)
            throw new Error('WORKSPACE_DELETING')

        if (
            write
            && !canEditWorkspace(workspace.accessLevel)
        )
            throw new Error('PERMISSION_DENIED')

        return workspace
    }

    private async join(
        session: CanvasSession,
        kind: 'human' | 'agent',
        name: string,
        workspace: AuthorizedWorkspace,
        composerReader?: CanvasCollaborationComposerReader,
    ): Promise<CanvasCollaborationSnapshot> {
        const {
            workspaceId,
            userId,
        } = session
        const actorId = getActorId(session, kind)

        const state = await this.mutateRoom(workspaceId, room => {
            const participant = room.participants[actorId]

            if (participant) {
                if (
                    composerReader
                    && !isDeepStrictEqual(composerReader, participant.composerReader)
                )
                    throw new Error('CANVAS_COMPOSER_SESSION_BOUND')

                participant.expiresAt = nextActorExpiry()

                return
            }

            if (Object.keys(room.participants).length >= ACTOR_LIMIT)
                throw new Error('CANVAS_PARTICIPANT_LIMIT')

            room.participants[actorId] = {
                actor: {
                    actorId,
                    kind,
                    name: name.slice(0, 128),
                },
                userId,
                expiresAt: nextActorExpiry(),
                followSequence: -1,
                ...(composerReader ? { composerReader } : {}),
            }
        })
        const latest = await this.authorize(session, kind === 'agent')
        const canvasRevision = getCanvasRevision(latest)

        this.rememberCanvasRevision(workspaceId, canvasRevision)
        void this.presence.replayComposer(
            workspaceId,
            state,
            actorId,
        )

        return this.snapshot(
            workspaceId,
            actorId,
            state,
            latest.canvasState ?? workspace.canvasState,
            canvasRevision,
        )
    }

    private async handlePresence(
        session: CanvasSession,
        actorId: string,
        request: Extract<CanvasCollaborationRequest, { action: 'presence' }>,
    ): Promise<CanvasCollaborationSnapshot | CanvasCollaborationPresenceAck> {
        if (!isCanvasSequence(request.sequence))
            throw new Error('INVALID_CANVAS_SEQUENCE')

        const { workspaceId } = session
        const presence = readCanvasPresence(request)
        const privatePresence = presence.composer !== undefined || presence.composerSelection !== undefined
        const authorized = await this.presence.authorize(
            workspaceId,
            session.userId,
            !privatePresence,
        )

        if (!authorized)
            throw new Error('PERMISSION_DENIED')

        const heartbeat = isCanvasSequence(request.knownCanvasRevision)
        const routing = await this.readRouting(workspaceId, heartbeat || privatePresence || Boolean(presence.geometry?.length))
        const state = await this.renewActor(
            workspaceId,
            actorId,
            routing,
        )

        if (presence.geometry)
            presence.geometry = presence.geometry.filter(item => state.leases[`node:${item.nodeId}`]?.actorId === actorId)

        const now = Date.now()
        const participant = state.participants[actorId]!.actor
        const activityAt = request.activityAt
        const localActivity = !heartbeat
            && isCanvasSequence(activityAt)
            && activityAt >= now - ACTOR_TTL_MS
            && activityAt <= now + ACTIVITY_CLOCK_SKEW_MS
            && (!participant.followingActorId && !participant.followingViewerId
                || !this.presence.roomActors(workspaceId, state).find(actor => actor.actorId === actorId)?.followingActorId)
            ? Math.min(now, activityAt)
            : undefined
        const mainCameraAt = !heartbeat
            && participant.kind === 'human'
            && !participant.followingActorId
            && !participant.followingViewerId
            && presence.camera
            && isCanvasSequence(request.mainCameraAt)
            && request.mainCameraAt <= now + ACTIVITY_CLOCK_SKEW_MS
            ? request.mainCameraAt
            : undefined
        const presenceSequence = this.presence.update(
            workspaceId,
            state,
            actorId,
            request.sequence,
            presence,
            localActivity,
            mainCameraAt,
        )

        if (heartbeat) {
            const workspace = await this.authorize(session, false)
            const canvasRevision = getCanvasRevision(workspace)

            this.rememberCanvasRevision(workspaceId, canvasRevision)
            void this.presence.replayComposer(
                workspaceId,
                state,
                actorId,
            )

            return this.snapshot(
                workspaceId,
                actorId,
                state,
                canvasRevision === request.knownCanvasRevision ? undefined : workspace.canvasState,
                canvasRevision,
            )
        }

        return {
            workspaceId,
            actorId,
            presenceSequence,
        }
    }

    private async renewActor(
        workspaceId: string,
        actorId: string,
        cachedState?: CanvasRoomState,
    ): Promise<CanvasRoomState> {
        const state = cachedState ?? (await readCanvasRoom(workspaceId))
        const now = Date.now()
        const participant = getParticipant(state, actorId)

        if (
            participant.expiresAt - now >= ACTOR_RENEWAL_MS
            && !Object.values(state.participants).some(other => other.expiresAt <= now)
        )
            return state

        return await this.mutateRoom(workspaceId, room => {
            const current = getParticipant(room, actorId)

            if (current.expiresAt - Date.now() < ACTOR_RENEWAL_MS)
                current.expiresAt = nextActorExpiry()
        })
    }

    private async follow(
        session: CanvasSession,
        actorId: string,
        target: {
            actorId: string | null
            viewerId?: string
            sequence?: number
        },
        groupHumanActors = false,
    ): Promise<CanvasCollaborationSnapshot> {
        const {
            actorId: following,
            viewerId,
            sequence,
        } = target

        if (
            (following !== null && !isCanvasId(following))
            || (viewerId !== undefined && (!isCanvasId(viewerId) || following !== null))
            || (sequence !== undefined && !isCanvasSequence(sequence))
        )
            throw new Error('INVALID_CANVAS_FOLLOW')

        const state = await this.mutateRoom(session.workspaceId, room => {
            const participant = getParticipant(room, actorId)

            if (
                sequence !== undefined
                && sequence <= participant.followSequence
            )
                return

            const actors = this.presence.roomActors(session.workspaceId, room)
            const agentViewer = groupHumanActors
                && following
                ? actors.find(actor => actor.viewerId === following || actor.actorId === following)?.viewerId
                : undefined
            const account = viewerId ?? agentViewer
            const activeActor = account ? resolveCanvasViewerActor(
                actors,
                account,
                actorId,
            ) : undefined

            if (
                account
                && !activeActor
            )
                throw new Error('CANVAS_FOLLOW_TARGET_UNAVAILABLE')

            let ancestor = account ? activeActor!.actorId : following
            const byId = new Map(
                actors.map(actor => [actor.actorId, actor]),
            )
            const seen = new Set([actorId])

            while (ancestor) {
                if (seen.has(ancestor))
                    throw new Error('CANVAS_FOLLOW_CYCLE')

                getParticipant(room, ancestor)
                seen.add(ancestor)
                ancestor = byId.get(ancestor)?.followingActorId ?? null
            }

            participant.actor.followingActorId = account ? null : following
            participant.actor.followingViewerId = account ?? null
            participant.followSequence = sequence ?? participant.followSequence + 1
            participant.expiresAt = nextActorExpiry()
        })

        void this.presence.replayComposer(
            session.workspaceId,
            state,
            actorId,
        )

        return this.snapshot(
            session.workspaceId,
            actorId,
            state,
        )
    }

    private async acquire(
        session: CanvasSession,
        actorId: string,
        target: string,
        requestId: string,
    ): Promise<CanvasCollaborationSnapshot> {
        if (
            !isCanvasTarget(target)
            || !isCanvasId(requestId)
        )
            throw new Error('INVALID_CANVAS_TARGET')

        const state = await this.mutateRoom(session.workspaceId, room => {
            const participant = getParticipant(room, actorId)
            participant.expiresAt = nextActorExpiry()
            acquireCanvasTarget(
                room,
                {
                    actorId,
                    target,
                    requestId,
                },
            )
        })
        const current = state.leases[target]

        return {
            ...this.snapshot(
                session.workspaceId,
                actorId,
                state,
            ),
            ...(current?.actorId === actorId
                && (state.participants[actorId]?.actor.kind === 'human' || current.requestId === requestId)
                ? {
                    lease: {
                        target,
                        actorId,
                        leaseId: current.leaseId,
                    },
                }
                : {}),
        }
    }

    private async release(
        session: CanvasSession,
        actorId: string,
        target: string,
        leaseId: string,
        cleanup = false,
    ): Promise<CanvasCollaborationSnapshot> {
        if (
            !isCanvasTarget(target)
            || !isCanvasId(leaseId)
        )
            throw new Error('INVALID_CANVAS_TARGET')

        const state = await this.mutateRoom(session.workspaceId, room => {
            if (!cleanup)
                getParticipant(room, actorId)

            if (
                room.leases[target]?.actorId === actorId
                && room.leases[target].leaseId === leaseId
            )
                delete room.leases[target]
        })

        return this.snapshot(
            session.workspaceId,
            actorId,
            state,
        )
    }

    private async cancelAgentRequest(
        workspaceId: string,
        actorId: string,
        target: string,
        requestId: string,
    ): Promise<void> {
        await this.mutateRoom(workspaceId, room => {
            room.queue = room.queue.filter(entry => entry.actorId !== actorId || entry.requestId !== requestId)

            if (
                room.leases[target]?.actorId === actorId
                && room.leases[target].requestId === requestId
            )
                delete room.leases[target]
        })
    }

    private async commit(
        session: CanvasSession,
        actorId: string,
        input: CanvasCollaborationCommit,
        additionalFences?: CanvasCommitFences,
    ): Promise<CanvasCollaborationSnapshot> {
        if (
            !isCanvasSequence(input.baseCanvasRevision)
            || !isCanvasId(input.requestId)
        )
            throw new Error('INVALID_CANVAS_COMMIT')

        const { workspaceId } = session
        const requestHash = createHash('sha256').update(
            JSON.stringify([
                input.baseCanvasRevision,
                input.changes,
                input.leases,
            ]),
        ).digest('hex')

        return await this.operations.run(workspaceId, async () => {
            for (let attempt = 0; attempt < ROOM_RETRY_LIMIT; attempt += 1) {
                const workspace = await this.authorize(session, true)
                const canvasRevision = getCanvasRevision(workspace)
                const previous = await readCanvasRoom(workspaceId)
                const state = structuredClone(previous)
                pruneCanvasRoom(
                    state,
                    Date.now(),
                )
                const participant = getParticipant(state, actorId)
                const receipt = state.receipts.find(
                    item => item.requestId === input.requestId && (
                        participant.actor.kind === 'agent'
                            ? item.agentUserId === session.userId
                            : item.actorId === actorId
                    ),
                )

                if (receipt) {
                    if (
                        participant.actor.kind === 'human'
                        && receipt.requestHash !== requestHash
                    )
                        throw new Error('CANVAS_REQUEST_ID_REUSED')

                    return this.snapshot(
                        workspaceId,
                        actorId,
                        state,
                        workspace.canvasState,
                        canvasRevision,
                    )
                }

                if (canvasRevision !== input.baseCanvasRevision)
                    throw new Error('STALE_CANVAS_STATE')

                const canvasState = applyCanvasChanges(workspace.canvasState, input.changes)
                const targets = changedCanvasTargets(workspace.canvasState, canvasState)

                for (const target of targets)
                    if (
                        participant.actor.kind === 'agent'
                        || input.leases?.[target] !== undefined
                    )
                        requireLease(
                            state,
                            actorId,
                            target,
                            input.leases?.[target],
                        )

                if (participant.actor.kind === 'human')
                    this.preemptHumanTargets(
                        state,
                        targets,
                        actorId,
                    )

                state.receipts.push({
                    actorId,
                    requestId: input.requestId,
                    requestHash,
                    ...(participant.actor.kind === 'agent' ? { agentUserId: session.userId } : {}),
                })
                state.receipts = state.receipts.slice(-96)
                state.revision += 1

                const fences = [...workspaceTreeRepository().accessFenceOperations({
                    userId: session.userId,
                    workspaceId,
                    organizationId: workspace.organizationId,
                    grant: workspace.accessGrant,
                }), ...(await additionalFences?.()) ?? []]
                const result = await Workspace.updateCanvasState({
                    workspaceId,
                    userId: session.userId,
                    canvasState,
                    expectedCanvasStateUpdatedAt: workspace.canvasStateUpdatedAt ?? workspace.updatedAt,
                    prepareCanvasWrite: () => [writeCanvasRoom(
                        workspaceId,
                        previous.revision,
                        state,
                    ), ...fences],
                })

                if (result.success) {
                    this.roomChanged(workspaceId, state)
                    const latest = await this.authorize(session, false)
                    const revision = getCanvasRevision(latest)
                    this.rememberCanvasRevision(workspaceId, revision)

                    return this.snapshot(
                        workspaceId,
                        actorId,
                        state,
                        latest.canvasState,
                        revision,
                    )
                }

                if (result.currentCanvasStateUpdatedAt !== canvasRevision)
                    throw new Error('STALE_CANVAS_STATE')

                await delay(Math.random() * 20)
            }

            throw new Error('CANVAS_COLLABORATION_BUSY')
        })
    }

    private preemptHumanTargets(
        state: CanvasRoomState,
        targets: string[],
        actorId: string | undefined,
    ): void {
        for (const target of targets) {
            const lease = state.leases[target]

            if (
                !lease
                || lease.actorId === actorId
            )
                continue

            if (state.participants[lease.actorId]?.actor.kind === 'human')
                throw new Error('CANVAS_TARGET_OWNED')

            delete state.leases[target]
        }

        pruneCanvasRoom(
            state,
            Date.now(),
        )
    }

    private async mutateRoom(
        workspaceId: string,
        mutate: (state: CanvasRoomState) => void,
    ): Promise<CanvasRoomState> {
        return await this.operations.run(workspaceId, async () => {
            for (let attempt = 0; attempt < ROOM_RETRY_LIMIT; attempt += 1) {
                const previous = await readCanvasRoom(workspaceId)
                const state = structuredClone(previous)
                pruneCanvasRoom(
                    state,
                    Date.now(),
                )
                mutate(state)
                pruneCanvasRoom(
                    state,
                    Date.now(),
                )

                if (isDeepStrictEqual(previous, state))
                    return state

                state.revision += 1

                try {
                    await dynamoDBService.transactWrite({
                        operations: [writeCanvasRoom(
                            workspaceId,
                            previous.revision,
                            state,
                        ), activeWorkspaceCondition(workspaceId)],
                        logConditionalCheckFailures: false,
                        origin: 'canvas-collaboration:write',
                    })
                } catch (error) {
                    if (
                        !isTransactionConditionalCheckFailure(error)
                        && !isCanvasTransactionConflict(error)
                    )
                        throw error

                    await delay(Math.random() * 20)

                    continue
                }

                this.roomChanged(workspaceId, state)

                if (!isPublicStateEqual(previous, state))
                    await this.publish(workspaceId, state)

                return state
            }

            throw new Error('CANVAS_COLLABORATION_BUSY')
        })
    }

    private async readRouting(
        workspaceId: string,
        requireFresh: boolean,
    ): Promise<CanvasRoomState> {
        const cached = this.roomRouting.get(workspaceId)

        if (
            !requireFresh
            && cached?.state
            && cached.expiresAt > Date.now()
        )
            return cached.state

        const state = await readCanvasRoom(workspaceId)
        this.rememberRouting(workspaceId, state)

        return state
    }

    private roomChanged(
        workspaceId: string,
        state: CanvasRoomState,
    ): void {
        this.rememberRouting(workspaceId, state)
        this.presence.invalidateRoom({
            workspaceId,
            roomRevision: state.revision,
        })
    }

    private invalidateRouting(
        workspaceId: string,
        revision: number,
    ): void {
        const cached = this.roomRouting.get(workspaceId)

        if (
            cached
            && cached.minimumRevision >= revision
        )
            return

        this.setRouting(
            workspaceId,
            {
                minimumRevision: revision,
                expiresAt: 0,
            },
        )
    }

    private rememberRouting(
        workspaceId: string,
        state: CanvasRoomState,
    ): void {
        const minimumRevision = this.roomRouting.get(workspaceId)?.minimumRevision ?? 0

        if (minimumRevision > state.revision)
            return

        this.setRouting(
            workspaceId,
            {
                minimumRevision: state.revision,
                expiresAt: Date.now() + ROUTING_TTL_MS,
                state,
            },
        )
    }

    private setRouting(
        workspaceId: string,
        cached: CachedRoom,
    ): void {
        this.roomRouting.delete(workspaceId)
        this.roomRouting.set(workspaceId, cached)

        if (this.roomRouting.size > ROUTING_CACHE_LIMIT)
            this.roomRouting.delete(this.roomRouting.keys().next().value!)
    }

    private snapshot(
        workspaceId: string,
        actorId: string,
        state: CanvasRoomState,
        canvasState?: CanvasState,
        canvasRevision = this.canvasRevisions.get(workspaceId) ?? 0,
    ): CanvasCollaborationSnapshot {
        const event = this.event(
            workspaceId,
            state,
            canvasRevision,
            canvasState,
        )

        const viewerId = event.actors.find(actor => actor.actorId === actorId)?.viewerId
        const mainCamera = viewerId ? this.presence.mainCamera(workspaceId, viewerId) : undefined

        return {
            ...event,
            ...(mainCamera ? { mainCamera } : {}),
            ...(state.participants[actorId]?.actor.kind === 'agent' ? {
                actors: event.actors.map(
                    actor => this.presence.composerSnapshot(
                        workspaceId,
                        state,
                        actorId,
                        actor,
                    ),
                ),
            } : {}),
            actorId,
        }
    }

    private event(
        workspaceId: string,
        state: CanvasRoomState,
        canvasRevision: number,
        canvasState?: CanvasState,
    ): CanvasCollaborationEvent {
        const event = makeCanvasRoomEvent(
            workspaceId,
            state,
            canvasRevision,
        )

        return {
            ...event,
            actors: this.presence.roomActors(workspaceId, state),
            ...(canvasState ? { canvasState } : {}),
        }
    }

    private async publish(
        workspaceId: string,
        state: CanvasRoomState,
        canvasRevision = this.canvasRevisions.get(workspaceId) ?? 0,
        canvasState?: CanvasState,
    ): Promise<void> {
        await this.presence.publishToParticipants(
            state,
            this.event(
                workspaceId,
                state,
                canvasRevision,
                canvasState,
            ),
        )
    }

    private rememberCanvasRevision(
        workspaceId: string,
        revision: number,
    ): void {
        const previous = this.canvasRevisions.get(workspaceId) ?? 0

        if (previous >= revision)
            return

        this.canvasRevisions.delete(workspaceId)
        this.canvasRevisions.set(workspaceId, revision)

        if (this.canvasRevisions.size > 2_048)
            this.canvasRevisions.delete(this.canvasRevisions.keys().next().value!)
    }
}

export const canvasCollaboration = new CanvasCollaboration()
