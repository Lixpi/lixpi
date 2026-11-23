import {
    getNatsUserSubjectToken,
    isNewerCanvasMainCamera,
    getNatsUserInboxPrefix,
    NATS_SUBJECTS,
    type CanvasCollaborationEvent,
    type CanvasCollaborationComposerEvent,
    type EncryptedCanvasCollaborationComposerEvent,
    type CanvasCollaborationLease,
    type CanvasCollaborationMainCamera,
    type CanvasCollaborationMessage,
    type CanvasCollaborationPresence,
    type CanvasCollaborationRequest,
    type CanvasCollaborationResponse,
} from '@lixpi/constants'
import {
    type AuthClientInstance,
} from '@lixpi/auth-client'
import { resolveFollowedActor } from '@lixpi/canvas-components/workspace/shared'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { WorkspaceCanvasComposerReader } from './workspace-canvas-composer-reader.ts'

const { WORKSPACE_SUBJECTS } = NATS_SUBJECTS
const PRESENCE_INTERVAL_MS = 50
const HEARTBEAT_INTERVAL_MS = 5000

type RequestAction = CanvasCollaborationRequest extends infer Request
    ? Request extends CanvasCollaborationRequest
        ? Omit<Request, 'workspaceId' | 'sessionId' | 'token'>
        : never
    : never

type PresenceField = {
    value: unknown
    sequence: number
}

type ComposerFields = CanvasCollaborationComposerEvent['composerPresence'] & {
    draftSequence: number
    selectionSequence: number
}

const mergeComposerFields = (
    current: ComposerFields | null | undefined,
    next: ComposerFields,
): ComposerFields => {
    if (current?.actorId !== next.actorId)
        return next

    return {
        ...current,
        sequence: Math.max(current.sequence, next.sequence),
        ...(next.draftSequence > current.draftSequence ? {
            composer: next.composer,
            draftSequence: next.draftSequence,
        } : {}),
        ...(next.selectionSequence > current.selectionSequence ? {
            composerSelection: next.composerSelection,
            selectionSequence: next.selectionSequence,
        } : {}),
    }
}

export class WorkspaceCanvasCollaborationClient {
    readonly sessionId = crypto.randomUUID()
    private readonly nats = servicesStore.getData('nats')
    private unsubscribe: (() => void) | null = null
    private unsubscribeComposer: (() => void) | null = null
    private composerReader: WorkspaceCanvasComposerReader | null = null
    private pendingComposer: {
        recipientActorId: string
        fields: ComposerFields
    } | null = null
    private composerQueue: Promise<void> = Promise.resolve()
    private reconnect: (() => void) | null = null
    private heartbeat: ReturnType<typeof setInterval> | null = null
    private timer: ReturnType<typeof setTimeout> | null = null
    private closed = false
    private binding = 0
    private joining: number | null = null
    private actor: string | null = null
    private canvasRevision: number | undefined
    private snapshot: CanvasCollaborationEvent | null = null
    private pendingRoomSnapshot: CanvasCollaborationEvent | null = null
    private pendingCanvasSnapshot: Pick<CanvasCollaborationEvent, 'canvasState' | 'canvasRevision'> | null = null
    private privateComposer: ComposerFields | null = null
    private readonly deltas = new Map<string, Map<string, PresenceField>>()
    private readonly publicSnapshotSequences = new Map<string, number>()
    private sequence = 0
    private followSequence = 0
    private pending: CanvasCollaborationPresence = {}
    private pendingActivityAt: number | undefined
    private pendingMainCamera: {
        camera: NonNullable<CanvasCollaborationPresence['camera']>
        at: number
    } | undefined
    private readonly pendingMainCameras = new Map<string, CanvasCollaborationMainCamera>()
    private presence: CanvasCollaborationPresence = {}
    private lastSentAt = -Infinity
    private presenceInFlight = false
    private presenceUrgent = false
    private fullPresencePending = false
    private readonly acquired = new Map<string, Promise<CanvasCollaborationLease | undefined>>()
    private readonly desiredNodes = new Set<string>()

    constructor(
        private readonly auth: AuthClientInstance,
        private readonly workspaceId: string,
        private readonly changed: (
            event: CanvasCollaborationEvent,
            actorId: string,
        ) => void,
        private readonly joined?: () => Promise<void>,
    ) {}

    get actorId(): string | null {
        return this.actor
    }

    start(): void {
        const connection = this.nats

        if (!connection)
            return

        const bind = () => {
            if (this.closed)
                return

            const binding = ++this.binding
            this.unsubscribe?.()
            this.unsubscribeComposer?.()
            this.unsubscribeComposer = null
            this.pendingComposer = null
            const user = getNatsUserSubjectToken(
                this.auth.userStore.getData('userId'),
            )
            const subscription = connection.subscribe(
                `${WORKSPACE_SUBJECTS.CANVAS_EVENTS}.${user}`,
                (message: CanvasCollaborationMessage) => {
                    if (binding === this.binding)
                        this.receive(message)
                },
            )
            this.unsubscribe = () => subscription?.unsubscribe()
            this.actor = null
            this.snapshot = null
            this.pendingRoomSnapshot = null
            this.pendingCanvasSnapshot = null
            this.pendingMainCameras.clear()
            this.privateComposer = null
            this.acquired.clear()
            this.deltas.clear()
            this.publicSnapshotSequences.clear()
            void this.join()
        }
        bind()
        this.reconnect = connection.onReconnect(bind)
        this.heartbeat = setInterval(() => (this.actor ? void this.sendPresence(true) : void this.join()), HEARTBEAT_INTERVAL_MS)
    }

    update(
        update: CanvasCollaborationPresence,
        immediate = false,
        mainCameraAt?: number,
    ): void {
        if (this.closed)
            return

        const changed = Object.fromEntries(
            Object.entries(update).filter(
                ([key, value]) => JSON.stringify(value) !== JSON.stringify(this.presence[key as keyof CanvasCollaborationPresence]),
            ),
        ) as CanvasCollaborationPresence

        if (
            update.camera
            && mainCameraAt !== undefined
        )
            this.pendingMainCamera = {
                camera: update.camera,
                at: mainCameraAt,
            }

        if (
            !Object.keys(changed).length
            && mainCameraAt === undefined
        ) {
            if (immediate)
                this.flush()

            return
        }

        this.presence = {
            ...this.presence,
            ...changed,
        }
        this.schedulePresence(changed, immediate)
    }

    activity(at: number): void {
        if (this.closed)
            return

        this.pendingActivityAt = Math.max(this.pendingActivityAt ?? 0, at)
        this.schedulePresence({})
    }

    private schedulePresence(
        changed: CanvasCollaborationPresence,
        immediate = false,
    ): void {
        this.pending = {
            ...this.pending,
            ...changed,
        }

        if (
            immediate
            || performance.now() - this.lastSentAt >= PRESENCE_INTERVAL_MS
        ) {
            this.flush()

            return
        }

        this.timer ??= setTimeout(() => this.flush(), PRESENCE_INTERVAL_MS - (performance.now() - this.lastSentAt))
    }

    flush(): void {
        if (this.timer !== null)
            clearTimeout(this.timer)

        this.timer = null

        if (
            !Object.keys(this.pending).length
            && !this.fullPresencePending
            && this.pendingActivityAt === undefined
            && !this.pendingMainCamera
        )
            return

        if (this.presenceInFlight)
            this.presenceUrgent = true
        else
            void this.sendPresence()
    }

    follow(
        actorId: string | null,
        viewerId?: string,
    ): void {
        void this.send({
            action: 'follow',
            sequence: ++this.followSequence,
            actorId,
            ...(viewerId ? { viewerId } : {}),
        })
    }

    acquireNode(nodeId: string): void {
        const target = `node:${nodeId}`
        this.desiredNodes.add(nodeId)

        if (this.acquired.has(target))
            return

        const acquisition = this.acquireLease(target)
        this.acquired.set(target, acquisition)
        void this.refreshLease(target, acquisition)
    }

    private async acquireLease(target: string): Promise<CanvasCollaborationLease | undefined> {
        const result = await this.send({
            action: 'acquire',
            target,
            requestId: crypto.randomUUID(),
        })

        return result
            && 'actors' in result
            ? result.lease
            : undefined
    }

    private async refreshLease(
        target: string,
        acquisition: Promise<CanvasCollaborationLease | undefined>,
    ): Promise<void> {
        const lease = await acquisition

        if (this.acquired.get(target) !== acquisition)
            return

        if (!lease)
            this.acquired.delete(target)
        else if (this.presence.geometry?.length)
            this.schedulePresence({ geometry: this.presence.geometry })
    }

    async releaseNodes(nodeIds: readonly string[]): Promise<void> {
        const releases = nodeIds.map(async nodeId => {
            this.desiredNodes.delete(nodeId)
            const target = `node:${nodeId}`
            const acquisition = this.acquired.get(target)

            if (!acquisition)
                return

            const lease = await acquisition

            if (
                this.desiredNodes.has(nodeId)
                || this.acquired.get(target) !== acquisition
            )
                return

            if (lease)
                await this.send({
                    action: 'release',
                    target,
                    leaseId: lease.leaseId,
                })

            if (this.acquired.get(target) === acquisition)
                this.acquired.delete(target)

            if (this.desiredNodes.has(nodeId))
                this.acquireNode(nodeId)
        })
        await Promise.all(releases)
    }

    destroy(): void {
        this.flush()
        this.closed = true
        this.reconnect?.()
        this.unsubscribe?.()
        this.unsubscribeComposer?.()
        this.composerReader = null
        this.pendingComposer = null
        this.privateComposer = null

        if (this.heartbeat !== null)
            clearInterval(this.heartbeat)

        if (this.actor)
            void this.send({ action: 'leave' })
    }

    private async join(): Promise<void> {
        const binding = this.binding

        if (
            this.joining === binding
            || this.closed
        )
            return

        this.joining = binding

        try {
            const reader = await this.bindComposerReader(binding)

            if (
                this.closed
                || this.binding !== binding
            )
                return

            const result = await this.send({
                action: 'join',
                ...(reader ? { composerReader: {
                    inboxId: reader.inboxId,
                    publicKey: reader.publicKey,
                } } : {}),
            })

            if (
                !result
                || !('actors' in result)
            )
                return

            if (this.closed) {
                void this.send({ action: 'leave' })

                return
            }

            if (binding !== this.binding)
                return

            this.actor = result.actorId
            this.deltas.delete(result.actorId)
            this.receive(
                this.takeJoinSnapshot(result),
            )

            if (this.snapshot) {
                for (const mainCamera of this.pendingMainCameras.values()) {
                    this.changed(
                        {
                            ...this.snapshot,
                            mainCamera,
                        },
                        this.actor,
                    )
                }
            }

            this.pendingMainCameras.clear()
            void this.joined?.()

            for (const nodeId of this.desiredNodes)
                this.acquireNode(nodeId)

            void this.sendPresence(true)
        } finally {
            if (this.joining === binding)
                this.joining = null
        }
    }

    private takeJoinSnapshot(joined: CanvasCollaborationEvent): CanvasCollaborationEvent {
        const room = this.pendingRoomSnapshot
        const canvas = this.pendingCanvasSnapshot
        this.pendingRoomSnapshot = null
        this.pendingCanvasSnapshot = null

        const latestRoom = room
            && room.revision >= joined.revision
            ? room
            : joined
        const latestCanvas = canvas
            && (!joined.canvasState || canvas.canvasRevision > joined.canvasRevision)
            ? canvas
            : joined

        return latestCanvas.canvasState ? {
            ...latestRoom,
            canvasState: latestCanvas.canvasState,
            canvasRevision: latestCanvas.canvasRevision,
        } : latestRoom
    }

    private async bindComposerReader(binding: number): Promise<WorkspaceCanvasComposerReader | null> {
        if (
            !this.nats
            || !crypto.subtle
        )
            return null

        try {
            const reader = this.composerReader ?? (await WorkspaceCanvasComposerReader.create())

            if (
                this.closed
                || binding !== this.binding
            )
                return null

            this.composerReader = reader

            if (!this.unsubscribeComposer) {
                const prefix = getNatsUserInboxPrefix(
                    this.auth.userStore.getData('userId'),
                )
                const subscription = this.nats.subscribe(
                    `${prefix}.canvas-composer.${reader.inboxId}`,
                    (packet: EncryptedCanvasCollaborationComposerEvent) => void (this.composerQueue = this.receiveComposer(
                        this.composerQueue,
                        reader,
                        packet,
                        binding,
                    )),
                )

                if (!subscription)
                    return null

                this.unsubscribeComposer = () => subscription.unsubscribe()
            }

            return reader
        } catch {
            return null
        }
    }

    private async receiveComposer(
        previous: Promise<void>,
        reader: WorkspaceCanvasComposerReader,
        packet: EncryptedCanvasCollaborationComposerEvent,
        binding: number,
    ): Promise<void> {
        try {
            await previous
            const message = await reader.read(packet)

            if (
                this.closed
                || binding !== this.binding
                || this.composerReader !== reader
                || message.workspaceId !== this.workspaceId
            )
                return

            if (
                this.actor
                && message.recipientActorId !== this.actor
            )
                return

            const next = message.composerPresence
            const fields = {
                ...next,
                draftSequence: next.composer !== undefined ? next.sequence : -Infinity,
                selectionSequence: next.composerSelection !== undefined ? next.sequence : -Infinity,
            }
            this.pendingComposer = {
                recipientActorId: message.recipientActorId,
                fields: mergeComposerFields(this.pendingComposer?.fields, fields),
            }

            if (
                this.snapshot
                && this.actor
            ) {
                this.snapshot = this.reflectPrivateComposer(this.snapshot)
                this.changed(this.snapshot, this.actor)
            }
        } catch {
            // Unreadable packets cannot change the followed composer.
        }
    }

    private async sendPresence(heartbeat = false): Promise<void> {
        this.fullPresencePending ||= heartbeat

        if (
            !this.actor
            || this.closed
            || this.presenceInFlight
        )
            return

        const sendFull = this.fullPresencePending
        const presence = sendFull ? this.presence : this.pending
        const activityAt = sendFull ? undefined : this.pendingActivityAt
        const mainCamera = sendFull ? undefined : this.pendingMainCamera
        this.pending = {}

        if (!sendFull) {
            this.pendingActivityAt = undefined
            this.pendingMainCamera = undefined
        }

        this.fullPresencePending = false
        this.presenceInFlight = true
        this.presenceUrgent = this.presenceUrgent
            && sendFull
            && this.pendingMainCamera !== undefined
        this.lastSentAt = performance.now()

        try {
            const result = await this.send({
                action: 'presence',
                sequence: ++this.sequence,
                ...(sendFull ? { knownCanvasRevision: this.canvasRevision ?? 0 } : {}),
                ...(activityAt !== undefined ? { activityAt } : {}),
                ...presence,
                ...(mainCamera ? {
                    camera: mainCamera.camera,
                    mainCameraAt: mainCamera.at,
                } : {}),
            })

            if (
                !result
                || 'error' in result
            ) {
                this.pending = {
                    ...presence,
                    ...this.pending,
                }

                if (activityAt !== undefined)
                    this.pendingActivityAt = Math.max(this.pendingActivityAt ?? 0, activityAt)

                if (
                    mainCamera
                    && !this.pendingMainCamera
                )
                    this.pendingMainCamera = mainCamera
            }
        } finally {
            this.presenceInFlight = false
        }

        if (this.closed)
            return

        if (
            this.presenceUrgent
            || this.fullPresencePending
        )
            this.flush()
        else if (
            Object.keys(this.pending).length
            || this.pendingActivityAt !== undefined
            || this.pendingMainCamera
        )
            this.schedulePresence({})
    }

    private receive(message: CanvasCollaborationMessage): void {
        if (
            this.closed
            || message.workspaceId !== this.workspaceId
        )
            return

        if ('composerPresence' in message)
            return

        const mainCamera = message.mainCamera

        if (
            mainCamera
            && !this.actor
            && isNewerCanvasMainCamera(
                mainCamera,
                this.pendingMainCameras.get(mainCamera.viewerId),
            )
        )
            this.pendingMainCameras.set(mainCamera.viewerId, mainCamera)

        if ('presence' in message) {
            const {
                actorId,
                sequence,
                ...fields
            } = message.presence

            if (actorId === this.actor) {
                if (
                    mainCamera
                    && this.snapshot
                    && this.actor
                )
                    this.changed(
                        {
                            ...this.snapshot,
                            mainCamera,
                        },
                        this.actor,
                    )

                return
            }

            let deltas = this.deltas.get(actorId)

            if (!deltas) {
                deltas = new Map()
                this.deltas.set(actorId, deltas)
            }

            const baseline = this.publicSnapshotSequences.get(actorId) ?? -Infinity

            for (const [field, value] of Object.entries(fields)) {
                if (sequence > Math.max(baseline, deltas.get(field)?.sequence ?? -Infinity))
                    deltas.set(
                        field,
                        {
                            value,
                            sequence,
                        },
                    )
            }

            if (
                !this.actor
                || !this.snapshot
            )
                return

            if (!this.snapshot.actors.some(actor => actor.actorId === actorId)) {
                if (mainCamera)
                    this.changed(
                        {
                            ...this.snapshot,
                            mainCamera,
                        },
                        this.actor,
                    )

                return
            }

            this.snapshot = {
                ...this.snapshot,
                actors: this.snapshot.actors.map(actor => this.withPresence(actor)),
            }

            if (Object.hasOwn(fields, 'lastActiveAt'))
                this.snapshot = this.reflectPrivateComposer(this.snapshot)

            this.changed(mainCamera ? {
                ...this.snapshot,
                mainCamera,
            } : this.snapshot, this.actor)

            return
        }

        if (!this.actor) {
            // The subscription is live before join returns its room and graph snapshot.
            if (
                !this.pendingRoomSnapshot
                || message.revision >= this.pendingRoomSnapshot.revision
            )
                this.pendingRoomSnapshot = message

            if (
                message.canvasState
                && message.canvasRevision > (this.pendingCanvasSnapshot?.canvasRevision ?? -Infinity)
            )
                this.pendingCanvasSnapshot = {
                    canvasState: message.canvasState,
                    canvasRevision: message.canvasRevision,
                }

            return
        }

        if (
            this.snapshot
            && message.revision < this.snapshot.revision
        ) {
            if (
                message.canvasState
                && message.canvasRevision > (this.canvasRevision ?? -Infinity)
            ) {
                this.canvasRevision = message.canvasRevision
                this.changed(
                    {
                        ...this.snapshot,
                        canvasState: message.canvasState,
                        canvasRevision: message.canvasRevision,
                        ...(mainCamera ? { mainCamera } : {}),
                    },
                    this.actor,
                )
            } else if (mainCamera)
                this.changed(
                    {
                        ...this.snapshot,
                        mainCamera,
                    },
                    this.actor,
                )

            return
        }

        const {
            canvasState,
            ...event
        } = message
        const previous = new Map(this.snapshot?.actors.map(actor => [actor.actorId, actor]))
        const present = new Set(
            event.actors.map(actor => actor.actorId),
        )

        for (const actorId of previous.keys()) {
            if (!present.has(actorId)) {
                this.deltas.delete(actorId)
                this.publicSnapshotSequences.delete(actorId)
            }
        }

        this.snapshot = {
            ...event,
            actors: event.actors.map(actor => {
                const earlier = previous.get(actor.actorId)

                const sequence = actor.presenceSequence ?? -Infinity

                if (sequence >= (this.publicSnapshotSequences.get(actor.actorId) ?? -Infinity)) {
                    this.publicSnapshotSequences.set(actor.actorId, sequence)

                    return this.withPresence(actor)
                }

                return this.withPresence({
                    ...actor,
                    camera: earlier?.camera,
                    cursor: earlier?.cursor,
                    selection: earlier?.selection,
                    menu: earlier?.menu,
                    caret: earlier?.caret,
                    panel: earlier?.panel,
                    connector: earlier?.connector,
                    library: earlier?.library,
                    playback: earlier?.playback,
                    geometry: earlier?.geometry,
                    lastActiveAt: earlier?.lastActiveAt,
                    presenceSequence: earlier?.presenceSequence,
                })
            }),
        }
        this.snapshot = this.reflectPrivateComposer(this.snapshot)
        const freshState = canvasState && event.canvasRevision > (this.canvasRevision ?? -Infinity)

        if (freshState)
            this.canvasRevision = event.canvasRevision

        this.changed(
            {
                ...this.snapshot,
                ...(freshState ? { canvasState } : {}),
            },
            this.actor,
        )
    }

    private reflectPrivateComposer(event: CanvasCollaborationEvent): CanvasCollaborationEvent {
        const target = this.actor ? resolveFollowedActor(event.actors, this.actor) : null

        if (
            !target
            || this.privateComposer?.actorId !== target.actorId
        )
            this.privateComposer = null

        const pending = this.pendingComposer

        if (
            pending
            && pending.recipientActorId === this.actor
            && pending.fields.actorId === target?.actorId
        ) {
            this.pendingComposer = null
            this.privateComposer = mergeComposerFields(this.privateComposer, pending.fields)
        }

        const preview = this.privateComposer

        return {
            ...event,
            actors: event.actors.map(actor => {
                const scoped = preview?.actorId === actor.actorId ? preview : null

                return {
                    ...actor,
                    composerSequence: scoped?.sequence,
                    composer: scoped?.composer,
                    composerSelection: scoped?.composerSelection,
                }
            }),
        }
    }

    private withPresence(actor: CanvasCollaborationEvent['actors'][number]): CanvasCollaborationEvent['actors'][number] {
        const deltas = this.deltas.get(actor.actorId)

        if (!deltas)
            return actor

        const baseline = this.publicSnapshotSequences.get(actor.actorId) ?? -Infinity
        const presence: Record<string, unknown> = {}
        let sequence = actor.presenceSequence ?? baseline

        for (const [field, update] of deltas) {
            if (update.sequence <= baseline)
                deltas.delete(field)
            else {
                presence[field] = update.value
                sequence = Math.max(sequence, update.sequence)
            }
        }

        return {
            ...actor,
            ...presence,
            presenceSequence: Number.isFinite(sequence) ? sequence : undefined,
        }
    }

    private async send(action: RequestAction): Promise<CanvasCollaborationResponse | undefined> {
        const binding = this.binding

        try {
            const token = await this.auth.getTokenSilently()

            if (binding !== this.binding)
                return undefined

            const result = (await this.nats?.request(
                WORKSPACE_SUBJECTS.CANVAS_COLLABORATE,
                {
                    ...action,
                    token,
                    workspaceId: this.workspaceId,
                    sessionId: this.sessionId,
                },
            )) as CanvasCollaborationResponse | undefined

            if (
                !result
                || binding !== this.binding
            )
                return undefined

            if (
                'actors' in result
                && action.action !== 'join'
            )
                this.receive(result)
            else if (
                'error' in result
                && result.error === 'CANVAS_SESSION_NOT_JOINED'
            ) {
                this.actor = null
                this.snapshot = null
                this.privateComposer = null
                this.pendingComposer = null
                this.acquired.clear()
                this.deltas.clear()
                this.publicSnapshotSequences.clear()
                void this.join()
            }

            return result
        } catch (error) {
            if (!this.closed)
                console.error('Canvas collaboration request failed:', error)

            return undefined
        }
    }
}
