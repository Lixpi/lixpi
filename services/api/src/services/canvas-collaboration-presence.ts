import {
    createCipheriv,
    createECDH,
    randomBytes,
} from 'node:crypto'
import {
    getCanvasCollaborationEventSubject,
    getNatsUserInboxPrefix,
    isNewerCanvasMainCamera,
    NATS_SUBJECTS,
    resolveCanvasViewerActor,
    type CanvasCollaborationActor,
    type CanvasCollaborationComposerEvent,
    type CanvasCollaborationEvent,
    type CanvasCollaborationMainCamera,
    type CanvasCollaborationPresence,
    type CanvasCollaborationPresenceEvent,
    type EncryptedCanvasCollaborationComposerEvent,
} from '@lixpi/constants'
import { err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import { readCanvasRoom } from './canvas-collaboration-repository.ts'
import {
    humanViewerId,
    makeCanvasRoomEvent,
    type CanvasRoomState,
} from './canvas-collaboration-state.ts'
import { workspaceAccessResolver } from './workspace-tree.ts'

const AUTHORIZATION_TTL_MS = 2_000
const PRESENCE_TTL_MS = 45_000
const MAX_CACHED_PARTICIPANTS = 2_048
const MAX_CACHED_COMPOSER_PREVIEWS = 128

const subjects = NATS_SUBJECTS.WORKSPACE_SUBJECTS
const encoder = new TextEncoder()
const composerKey = createECDH('prime256v1')
const composerPublicKey = composerKey.generateKeys().toString('base64url')

const sealComposerEvent = (
    message: CanvasCollaborationComposerEvent,
    recipientKey: string,
): EncryptedCanvasCollaborationComposerEvent => {
    const secret = composerKey.computeSecret(
        Buffer.from(recipientKey, 'base64url'),
    )
    const nonce = randomBytes(12)
    const cipher = createCipheriv(
        'aes-256-gcm',
        secret,
        nonce,
    )
    const encrypted = Buffer.concat([
        cipher.update(
            JSON.stringify(message),
            'utf8',
        ),
        cipher.final(),
        cipher.getAuthTag(),
    ])

    return {
        publicKey: composerPublicKey,
        iv: nonce.toString('base64url'),
        ciphertext: encrypted.toString('base64url'),
    }
}

type CanvasRoomInvalidation = {
    workspaceId: string
    roomRevision: number
}

type InternalComposerEvent = Omit<CanvasCollaborationComposerEvent, 'recipientActorId'>

type CanvasInternalEvent = CanvasCollaborationPresenceEvent | CanvasRoomInvalidation | InternalComposerEvent

type StoredComposer = {
    expiresAt: number
    data: CanvasCollaborationComposerEvent['composerPresence']
    contentSequence?: number
    selectionSequence?: number
}

const resolvedFollowTarget = (
    actors: readonly CanvasCollaborationActor[],
    followerId: string,
): string | undefined => {
    const byId = new Map(
        actors.map(actor => [actor.actorId, actor]),
    )
    let target = byId.get(followerId)?.followingActorId
    const seen = new Set([followerId])

    while (
        target
        && !seen.has(target)
    ) {
        const actor = byId.get(target)

        if (!actor)
            return undefined

        if (!actor.followingActorId)
            return actor.followingViewerId ? undefined : target

        seen.add(target)
        target = actor.followingActorId
    }

    return undefined
}

type StoredPresence = {
    expiresAt: number
    event: CanvasCollaborationPresenceEvent
    fieldSequences: Record<string, number>
}

type RecipientCheck = {
    expiresAt: number
    result: Promise<boolean>
}

export class CanvasCollaborationPresenceRelay {
    private readonly presence = new Map<string, StoredPresence>()
    private readonly mainCameras = new Map<string, CanvasCollaborationMainCamera>()
    private readonly composerPreviews = new Map<string, StoredComposer>()
    private readonly recipients = new Map<string, RecipientCheck>()
    private active = false

    start(onRoomChange: (event: CanvasRoomInvalidation) => void): void {
        if (this.active)
            return

        const connection = NATS_Service.getInstance()?.getConnection()

        if (!connection)
            return

        const subscription = connection.subscribe(subjects.CANVAS_INTERNAL_PRESENCE)
        this.active = true

        void (async () => {
            try {
                for await (const message of subscription) {
                    const event = JSON.parse(
                        message.string(),
                    ) as CanvasInternalEvent

                    if ('roomRevision' in event)
                        onRoomChange(event)
                    else if ('composerPresence' in event)
                        this.rememberComposer(event)
                    else
                        this.remember(event)
                }
            } catch (error) {
                err('Canvas presence subscription stopped', error)
            } finally {
                this.active = false
            }
        })()
    }

    invalidateRoom(event: CanvasRoomInvalidation): void {
        this.publishInternal(event)
    }

    current(
        workspaceId: string,
        actorId: string,
    ): CanvasCollaborationPresenceEvent['presence'] | undefined {
        const key = this.key(workspaceId, actorId)
        const entry = this.presence.get(key)

        if (
            entry
            && entry.expiresAt > Date.now()
        )
            return entry.event.presence

        this.presence.delete(key)

        return undefined
    }

    update(
        workspaceId: string,
        state: CanvasRoomState,
        actorId: string,
        sequence: number,
        presence: CanvasCollaborationPresence,
        activityAt?: number,
        mainCameraAt?: number,
    ): number {
        const {
            composer,
            composerSelection,
            ...view
        } = presence

        if (
            composer !== undefined
            || composerSelection !== undefined
        ) {
            const selection: InternalComposerEvent = {
                workspaceId,
                composerPresence: {
                    actorId,
                    sequence,
                    ...(composer !== undefined ? { composer } : {}),
                    ...(composerSelection !== undefined ? { composerSelection } : {}),
                },
            }

            const accepted = this.rememberComposer(selection)

            if (accepted) {
                this.publishInternal(accepted)
                void this.publishComposer(state, accepted)
            }
        }

        if (
            activityAt === undefined
            && !Object.keys(view).length
            && (composer !== undefined || composerSelection !== undefined)
        )
            return sequence

        const participant = state.participants[actorId]
        const viewerId = (activityAt !== undefined || mainCameraAt !== undefined)
            && participant?.actor.kind === 'human'
            ? humanViewerId(workspaceId, participant.userId)
            : undefined
        const previous = viewerId
            && activityAt !== undefined
            ? this.activeDevice(
                workspaceId,
                state,
                participant!.userId,
                viewerId,
            )
            : undefined
        const mainCamera = viewerId
            && view.camera
            && mainCameraAt !== undefined
            ? {
                viewerId,
                actorId,
                sequence,
                updatedAt: mainCameraAt,
                camera: view.camera,
            }
            : undefined
        const accepted = this.remember({
            workspaceId,
            mainCamera,
            presence: {
                ...view,
                actorId,
                sequence,
                ...(activityAt !== undefined ? { lastActiveAt: activityAt } : {}),
            },
        })

        if (accepted) {
            this.publishInternal(accepted)
            const delivered = this.publishToParticipants(state, accepted)

            if (
                viewerId
                && accepted.presence.lastActiveAt !== undefined
                && previous !== this.activeDevice(
                    workspaceId,
                    state,
                    participant!.userId,
                    viewerId,
                )
            )
                void this.replayAfterActivity(
                    delivered,
                    workspaceId,
                    actorId,
                )
        }

        return this.current(workspaceId, actorId)?.sequence ?? sequence
    }

    mainCamera(
        workspaceId: string,
        viewerId: string,
    ): CanvasCollaborationMainCamera | undefined {
        return this.mainCameras.get(
            this.key(workspaceId, viewerId),
        )
    }

    roomActors(
        workspaceId: string,
        state: CanvasRoomState,
    ): CanvasCollaborationActor[] {
        const { actors } = makeCanvasRoomEvent(
            workspaceId,
            state,
            0,
        )
        const now = Date.now()
        const active = actors.filter(actor => state.participants[actor.actorId]!.expiresAt > now).map(
            actor => this.merge(
                workspaceId,
                state,
                actor,
            ),
        )

        return active.map(actor => {
            if (actor.followingViewerId)
                return {
                    ...actor,
                    followingActorId: resolveCanvasViewerActor(
                        active,
                        actor.followingViewerId,
                        actor.actorId,
                    )?.actorId ?? null,
                }

            const mainCamera = actor.viewerId
                && !actor.followingActorId
                ? this.mainCamera(workspaceId, actor.viewerId)
                : undefined

            return mainCamera ? {
                ...actor,
                camera: mainCamera.camera,
                mainCamera,
            } : actor
        })
    }

    private activeDevice(
        workspaceId: string,
        state: CanvasRoomState,
        userId: string,
        viewerId: string,
    ): string | undefined {
        const now = Date.now()
        const devices = Object
            .values(state.participants)
            .filter(participant => participant.userId === userId && participant.actor.kind === 'human' && participant.expiresAt > now)
            .map(
                ({ actor }) => ({
                    actorId: actor.actorId,
                    viewerId,
                    lastActiveAt: this.current(workspaceId, actor.actorId)?.lastActiveAt,
                }),
            )

        return resolveCanvasViewerActor(devices, viewerId)?.actorId
    }

    private async replayAfterActivity(
        delivered: Promise<void>,
        workspaceId: string,
        sourceActorId: string,
    ): Promise<void> {
        try {
            await delivered
            const state = await readCanvasRoom(workspaceId)
            const actors = this.roomActors(workspaceId, state)
            const followers = actors.filter(
                actor =>
                    actor.kind === 'human'
                    && resolvedFollowTarget(actors, actor.actorId) === sourceActorId,
            )

            await Promise.all(
                followers.map(
                    async actor => await this.replayComposer(
                        workspaceId,
                        state,
                        actor.actorId,
                    ),
                ),
            )
        } catch (error) {
            err('Canvas composer activity replay failed', error)
        }
    }

    merge(
        workspaceId: string,
        state: CanvasRoomState,
        actor: CanvasCollaborationActor,
    ): CanvasCollaborationActor {
        const current = this.current(workspaceId, actor.actorId)

        if (!current)
            return actor

        const {
            sequence: presenceSequence,
            ...presence
        } = current

        return {
            ...actor,
            ...presence,
            presenceSequence,
            ...(presence.geometry ? {
                geometry: presence.geometry.filter(item => state.leases[`node:${item.nodeId}`]?.actorId === actor.actorId),
            } : {}),
        }
    }

    composerSnapshot(
        workspaceId: string,
        state: CanvasRoomState,
        recipientActorId: string,
        actor: CanvasCollaborationActor,
    ): CanvasCollaborationActor {
        if (resolvedFollowTarget(
            this.roomActors(workspaceId, state),
            recipientActorId,
        ) !== actor.actorId)
            return actor

        const selection = this.currentComposer(workspaceId, actor.actorId)?.data

        if (!selection)
            return actor

        const {
            actorId: _ownerId,
            sequence: composerSequence,
            ...composer
        } = selection

        return {
            ...actor,
            ...composer,
            composerSequence,
        }
    }

    private currentComposer(
        workspaceId: string,
        actorId: string,
    ): StoredComposer | undefined {
        const key = this.key(workspaceId, actorId)
        const current = this.composerPreviews.get(key)

        if (
            current
            && current.expiresAt > Date.now()
        )
            return current

        this.composerPreviews.delete(key)

        return undefined
    }

    private rememberComposer(event: InternalComposerEvent): InternalComposerEvent | undefined {
        const {
            workspaceId,
            composerPresence,
        } = event
        const {
            actorId,
            sequence,
            composer,
            composerSelection,
        } = composerPresence
        const current = this.currentComposer(workspaceId, actorId)
        const acceptsContent = composer !== undefined && sequence > (current?.contentSequence ?? -1)
        const acceptsSelection = composerSelection !== undefined && sequence > (current?.selectionSequence ?? -1)

        if (
            !acceptsContent
            && !acceptsSelection
        )
            return undefined

        const accepted = {
            actorId,
            sequence,
            ...(acceptsContent ? { composer } : {}),
            ...(acceptsSelection ? { composerSelection } : {}),
        }
        const key = this.key(workspaceId, actorId)
        this.composerPreviews.delete(key)
        this.composerPreviews.set(
            key,
            {
                expiresAt: Date.now() + PRESENCE_TTL_MS,
                contentSequence: acceptsContent ? sequence : current?.contentSequence,
                selectionSequence: acceptsSelection ? sequence : current?.selectionSequence,
                data: {
                    ...current?.data,
                    ...accepted,
                    sequence: Math.max(sequence, current?.data.sequence ?? -1),
                },
            },
        )

        if (this.composerPreviews.size > MAX_CACHED_COMPOSER_PREVIEWS)
            this.composerPreviews.delete(this.composerPreviews.keys().next().value!)

        return {
            workspaceId,
            composerPresence: accepted,
        }
    }

    async replayComposer(
        workspaceId: string,
        state: CanvasRoomState,
        recipientActorId: string,
    ): Promise<void> {
        const source = resolvedFollowTarget(
            this.roomActors(workspaceId, state),
            recipientActorId,
        )
        const preview = source ? this.currentComposer(workspaceId, source) : undefined

        if (
            !preview
            || !source
        )
            return

        const {
            composer,
            composerSelection,
        } = preview.data
        const events: InternalComposerEvent[] = []

        if (preview.contentSequence !== undefined)
            events.push({
                workspaceId,
                composerPresence: {
                    actorId: source,
                    sequence: preview.contentSequence,
                    composer,
                },
            })

        if (preview.selectionSequence !== undefined)
            events.push({
                workspaceId,
                composerPresence: {
                    actorId: source,
                    sequence: preview.selectionSequence,
                    composerSelection,
                },
            })

        await Promise.all(
            events.map(
                async event => await this.publishComposer(
                    state,
                    event,
                    recipientActorId,
                ),
            ),
        )
    }

    private async publishComposer(
        state: CanvasRoomState,
        event: InternalComposerEvent,
        recipientActorId?: string,
    ): Promise<void> {
        const connection = NATS_Service.getInstance()?.getConnection()

        if (!connection)
            return

        const actors = this.roomActors(event.workspaceId, state)
        const recipients = Object.values(state.participants).filter(
            participant =>
                participant.actor.kind === 'human'
                && participant.composerReader
                && (recipientActorId === undefined || participant.actor.actorId === recipientActorId)
                && participant.expiresAt > Date.now()
                && resolvedFollowTarget(actors, participant.actor.actorId) === event.composerPresence.actorId,
        )
        const checks = new Map<string, Promise<boolean>>()

        await Promise.all(
            recipients.map(async participant => {
                try {
                    const access = checks.get(participant.userId) ?? this.authorize(
                        event.workspaceId,
                        participant.userId,
                        false,
                    )
                    checks.set(participant.userId, access)

                    if (!await access)
                        return

                    const message: CanvasCollaborationComposerEvent = {
                        ...event,
                        recipientActorId: participant.actor.actorId,
                    }
                    const reader = participant.composerReader!
                    const sealed = sealComposerEvent(message, reader.publicKey)
                    const inbox = `${getNatsUserInboxPrefix(participant.userId)}.canvas-composer.${reader.inboxId}`
                    connection.publish(
                        inbox,
                        encoder.encode(
                            JSON.stringify(sealed),
                        ),
                    )
                } catch (error) {
                    err('Canvas composer event delivery failed', error)
                }
            }),
        )
    }

    async publishToParticipants(
        state: CanvasRoomState,
        event: CanvasCollaborationEvent | CanvasCollaborationPresenceEvent,
    ): Promise<void> {
        const connection = NATS_Service.getInstance()?.getConnection()

        if (!connection)
            return

        const recipients = new Set(
            Object
                .values(state.participants)
                .filter(participant => participant.actor.kind === 'human' && participant.expiresAt > Date.now())
                .map(participant => participant.userId),
        )
        const payload = encoder.encode(
            JSON.stringify(event),
        )

        await Promise.all(
            [...recipients].map(async userId => {
                try {
                    const visible = await this.authorize(
                        event.workspaceId,
                        userId,
                        'presence' in event,
                    )

                    if (visible)
                        connection.publish(
                            getCanvasCollaborationEventSubject(userId),
                            payload,
                        )
                } catch (error) {
                    err('Canvas event delivery failed', error)
                }
            }),
        )
    }

    async authorize(
        workspaceId: string,
        userId: string,
        transient: boolean,
    ): Promise<boolean> {
        const key = this.key(workspaceId, userId)
        const cached = transient ? this.recipients.get(key) : undefined

        if (
            cached
            && cached.expiresAt > Date.now()
        )
            return await cached.result

        const result = this.checkWorkspaceAccess(workspaceId, userId)

        this.recipients.set(
            key,
            {
                expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
                result,
            },
        )
        this.trim(this.recipients)

        return await result
    }

    private publishInternal(event: CanvasInternalEvent): void {
        try {
            NATS_Service.getInstance()?.getConnection()?.publish(
                subjects.CANVAS_INTERNAL_PRESENCE,
                encoder.encode(
                    JSON.stringify(event),
                ),
            )
        } catch (error) {
            err('Canvas internal event delivery failed', error)
        }
    }

    private async checkWorkspaceAccess(
        workspaceId: string,
        userId: string,
    ): Promise<boolean> {
        const access = await workspaceAccessResolver().resolve({
            userId,
            workspaceId,
        })

        return access.status === 'granted'
    }

    private remember(event: CanvasCollaborationPresenceEvent): CanvasCollaborationPresenceEvent | undefined {
        const {
            workspaceId,
            presence,
            mainCamera: incomingCamera,
        } = event
        const {
            actorId,
            sequence,
            ...fields
        } = presence
        const key = this.key(workspaceId, actorId)
        const current = this.current(workspaceId, actorId)
        const fieldSequences = { ...this.presence.get(key)?.fieldSequences }
        const acceptsMainCamera = incomingCamera && sequence > (fieldSequences.mainCamera ?? -1)
        const mainCamera = acceptsMainCamera
            && this.rememberMainCamera(workspaceId, incomingCamera)
            ? incomingCamera
            : undefined

        if (acceptsMainCamera)
            fieldSequences.mainCamera = sequence

        const changes = Object.fromEntries(
            Object.entries(fields).filter(([field, value]) => {
                if (
                    field === 'lastActiveAt'
                    && typeof value === 'number'
                    && value <= (current?.lastActiveAt ?? -1)
                )
                    return false

                if (sequence <= (fieldSequences[field] ?? -1))
                    return false

                fieldSequences[field] = sequence

                return true
            }),
        )

        if (
            !Object.keys(changes).length
            && sequence <= (current?.sequence ?? -1)
            && !acceptsMainCamera
        )
            return undefined

        this.presence.set(
            key,
            {
                expiresAt: Date.now() + PRESENCE_TTL_MS,
                fieldSequences,
                event: {
                    workspaceId,
                    presence: {
                        ...current,
                        ...changes,
                        actorId,
                        sequence: Math.max(current?.sequence ?? -1, sequence),
                    },
                },
            },
        )
        this.trim(this.presence)

        return {
            workspaceId,
            ...(mainCamera ? { mainCamera } : {}),
            presence: {
                ...changes,
                actorId,
                sequence,
            },
        }
    }

    private rememberMainCamera(
        workspaceId: string,
        camera: CanvasCollaborationMainCamera,
    ): boolean {
        const key = this.key(workspaceId, camera.viewerId)

        if (!isNewerCanvasMainCamera(
            camera,
            this.mainCameras.get(key),
        ))
            return false

        this.mainCameras.delete(key)
        this.mainCameras.set(key, camera)
        this.trim(this.mainCameras)

        return true
    }

    private key(
        workspaceId: string,
        id: string,
    ): string {
        return JSON.stringify([workspaceId, id])
    }

    private trim<T>(entries: Map<string, T>): void {
        if (entries.size > MAX_CACHED_PARTICIPANTS)
            entries.delete(entries.keys().next().value!)
    }
}
