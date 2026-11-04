import { randomUUID } from 'node:crypto'
import {
    CONVERSATION_RESPONSE_MAX_BYTES,
    type AccountWorkContext,
    type ConversationAcknowledgement,
    type ConversationCommandBase,
    type ConversationCreateRequest,
    type ConversationEvent,
    type ConversationGetRequest,
    type ConversationListRequest,
    type ConversationMessage,
    type ConversationOperationSummary,
    type ConversationMessagesPage,
    type ConversationMessagesRequest,
    type ConversationQueueRequest,
    type ConversationReference,
    type ConversationReplay,
    type ConversationReplayRequest,
    type ConversationSettingsRequest,
    type ConversationSnapshot,
    type ConversationSourceSnapshot,
    type ConversationStopRequest,
    type ConversationSubmitRequest,
    type ConversationTurn,
} from '@lixpi/constants'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    conversationMessageText,
    conversationPayloadHash,
    resolveConversationSettings,
} from './conversation-protocol.ts'
import {
    conversationDueKey,
    conversationDuePartition,
    conversationPartition,
    conversationSequenceKey,
    conversationWorkspacePartition,
    type ConversationRepository,
    type ConversationDispatch,
    type ConversationMeta,
} from './conversation-repository.ts'

export type ConversationAccess = {
    userId: string
    organizationId: string
    workspaceId: string
    fences: TransactOperation[]
    account?: AccountWorkContext
}

export type ConversationServicePorts = {
    migrate?: (access: ConversationAccess) => Promise<void>
    title?: (meta: ConversationMeta) => Promise<string | undefined>
    retainReferences?: (
        access: ConversationAccess,
        conversationAssetId: string,
        turn: ConversationTurn,
    ) => Promise<TransactOperation[]>
    authorize: (
        workspaceId: string,
        userId: string,
        write: boolean,
    ) => Promise<ConversationAccess>
    resolveReferences: (
        access: ConversationAccess,
        references: ConversationReference[],
    ) => Promise<ConversationSourceSnapshot[]>
    activate: (
        meta: ConversationMeta,
        operations: TransactOperation[],
    ) => Promise<void>
    publish: (event: ConversationEvent) => Promise<void>
    now: () => number
    createId: () => string
}

type AcceptedClient = {
    userId: string
    payloadHash: string
    acknowledgement: ConversationAcknowledgement
}

const terminal = new Set([
    'stopped',
    'completed',
    'failed',
])

export class ConversationService {
    constructor(
        readonly repository: ConversationRepository,
        private readonly ports: ConversationServicePorts,
    ) {}

    async create(
        request: ConversationCreateRequest,
        userId: string,
    ): Promise<ConversationSnapshot> {
        const access = await this.ports.authorize(
            request.workspaceId,
            userId,
            true,
        )
        const conversationAssetId = `agent-${conversationPayloadHash({
            organizationId: access.organizationId,
            userId,
            workspaceId: request.workspaceId,
            clientConversationId: request.clientConversationId,
        }).slice(0, 32)}`
        const pk = conversationPartition(access.organizationId, conversationAssetId)
        const creationHash = conversationPayloadHash(request)
        const now = this.ports.now()
        const meta: ConversationMeta = {
            protocolVersion: 1,
            organizationId: access.organizationId,
            workspaceId: request.workspaceId,
            conversationAssetId,
            ownerUserId: userId,
            creationHash,
            title: 'New conversation',
            activated: false,
            revision: 1,
            settings: resolveConversationSettings(request.settings),
            settingsRevision: 1,
            queueRevision: 1,
            queuePaused: false,
            commandSeq: 0,
            eventSeq: 0,
            projectedCommandSeq: 0,
            documentRevision: 0,
            epoch: 0,
            checkpointNamespace: 'context-1',
            createdAt: now,
            updatedAt: now,
            expiresAt: Math.floor(now / 1000) + 86400,
        }
        const existing = await this.repository.read<ConversationMeta>(pk, 'META')

        if (!existing) {
            try {
                await this.repository.commit([...access.fences, this.repository.put(
                    pk,
                    'META',
                    meta,
                )])
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error))
                    throw error
            }
        }

        const saved = await this.repository.read<ConversationMeta>(pk, 'META')

        if (
            !saved
            || saved.creationHash !== creationHash
        )
            throw new Error('CONVERSATION_IDEMPOTENCY_CONFLICT')

        return await this.snapshot(saved)
    }

    async list(
        request: ConversationListRequest,
        userId: string,
    ): Promise<{
        conversations: ConversationSnapshot[]
        cursor?: string
    }> {
        const access = await this.ports.authorize(
            request.workspaceId,
            userId,
            false,
        )
        await this.ports.migrate?.(access)
        const page = await this.repository.query<{ conversationAssetId: string }>(
            conversationWorkspacePartition(access.organizationId, request.workspaceId),
            'CONVERSATION#',
            {
                limit: request.limit ?? 30,
                ...(request.cursor ? { after: `CONVERSATION#${request.cursor}` } : {}),
            },
        )
        const conversations: ConversationSnapshot[] = []
        let bytes = 1024
        let cursor: string | undefined

        for (const entry of page.items) {
            const meta = await this.repository.read<ConversationMeta>(
                conversationPartition(access.organizationId, entry.conversationAssetId),
                'META',
            )

            if (
                meta?.activated
                && meta.workspaceId === request.workspaceId
            ) {
                const snapshot = await this.snapshot(meta, false)
                const size = Buffer.byteLength(
                    JSON.stringify(snapshot),
                ) + 1

                if (bytes + size > CONVERSATION_RESPONSE_MAX_BYTES) {
                    if (!conversations.length)
                        throw new Error('CONVERSATION_RECORD_TOO_LARGE')

                    return {
                        conversations,
                        cursor,
                    }
                }

                conversations.push(snapshot)
                bytes += size
            }

            cursor = entry.conversationAssetId
        }

        return {
            conversations,
            ...(page.cursor ? { cursor: page.cursor.slice('CONVERSATION#'.length) } : {}),
        }
    }

    async get(
        request: ConversationGetRequest,
        userId: string,
    ): Promise<ConversationSnapshot> {
        const {
            meta,
            pk,
        } = await this.load(
            request,
            userId,
            false,
        )
        const snapshot = await this.snapshot(meta)

        if (request.clientMessageId) {
            const receipt = await this.repository.read<AcceptedClient>(pk, `CLIENT#${request.clientMessageId}`)

            if (receipt?.userId === userId)
                snapshot.acknowledgement = receipt.acknowledgement
        }

        return snapshot
    }

    async messages(
        request: ConversationMessagesRequest,
        userId: string,
    ): Promise<ConversationMessagesPage> {
        const { meta } = await this.load(
            request,
            userId,
            false,
        )

        return await this.messagePage(
            meta,
            request.cursor,
            request.limit,
        )
    }

    async submit(
        request: ConversationSubmitRequest,
        userId: string,
    ): Promise<ConversationAcknowledgement> {
        const payloadHash = conversationPayloadHash(request)

        for (let attempt = 0; attempt < 5; attempt++) {
            const {
                meta,
                access,
                pk,
            } = await this.load(
                request,
                userId,
                true,
            )
            const existing = await this.repository.read<AcceptedClient>(pk, `CLIENT#${request.clientMessageId}`)

            if (existing) {
                if (
                    existing.payloadHash !== payloadHash
                    || existing.userId !== userId
                )
                    return this.reject(
                        request,
                        'CONVERSATION_IDEMPOTENCY_CONFLICT',
                        'This message ID was already used for different content.',
                    )

                return {
                    ...existing.acknowledgement,
                    status: 'duplicate',
                } as ConversationAcknowledgement
            }

            if (meta.settingsRevision !== request.settingsRevision)
                return {
                    status: 'rejected',
                    clientMessageId: request.clientMessageId,
                    error: {
                        code: 'STALE_CONVERSATION_SETTINGS',
                        message: 'Conversation settings changed. Review them before sending again.',
                        recoverable: true,
                        currentRevision: meta.settingsRevision,
                    },
                }

            const queued = await this.repository.query(
                pk,
                'QUEUED#',
                { limit: 33 },
            )

            if (
                queued.items.length >= 32
                && !request.interruptId
            )
                return this.reject(
                    request,
                    'CONVERSATION_QUEUE_FULL',
                    'The conversation already has 32 queued messages. Wait for a turn to finish or remove a queued message.',
                )

            const sources = await this.ports.resolveReferences(access, request.references)
            const now = this.ports.now()
            const turnId = this.ports.createId()
            const commandSeq = meta.commandSeq + 1
            const eventSeq = meta.eventSeq + 1
            const activeRun = meta.run && !terminal.has(meta.run.state)
            const activeTurn = activeRun ? await this.repository.read<ConversationTurn>(pk, `TURN#${meta.run!.turnId}`) : undefined

            if (
                activeTurn
                && activeTurn.userId !== userId
                && (request.interruptId || (request.midRunPolicy ?? meta.settings.midRunPolicy) === 'steer')
            )
                return this.reject(
                    request,
                    'CONVERSATION_ACTIVE_AUTHOR_CONFLICT',
                    'Another collaborator owns the active turn. Queue your message or choose Stop first.',
                )

            if (
                request.interruptId
                && (request.interruptId !== meta.run?.interruptId || meta.run?.state !== 'waiting-input')
            )
                return this.reject(
                    request,
                    'STALE_CONVERSATION_INTERRUPT',
                    'This question has already been answered or is no longer active.',
                )

            if (
                request.interruptId
                && (await this.repository.read(pk, `INTERRUPT_ANSWER#${request.interruptId}`))
            )
                return this.reject(
                    request,
                    'CONVERSATION_INTERRUPT_ALREADY_ANSWERED',
                    'An answer to this question has already been accepted.',
                )

            const turn: ConversationTurn = {
                turnId,
                clientMessageId: request.clientMessageId,
                commandSeq,
                userId,
                fragment: request.fragment,
                references: sources,
                settings: meta.settings,
                settingsRevision: meta.settingsRevision,
                midRunPolicy: request.interruptId ? 'steer' : request.midRunPolicy ?? meta.settings.midRunPolicy,
                state: 'queued',
                createdAt: now,
                ...(request.interruptId ? { interruptId: request.interruptId } : {}),
            }
            const next: ConversationMeta = {
                ...meta,
                activated: true,
                title: meta.activated ? meta.title : conversationMessageText(request.fragment).trim().slice(0, 80) || 'Conversation',
                commandSeq,
                eventSeq,
                queueRevision: meta.queueRevision + 1,
                revision: meta.revision + 1,
                updatedAt: now,
            }
            delete next.expiresAt

            if (
                activeRun
                && turn.midRunPolicy === 'stop-first'
            ) {
                next.run = {
                    ...meta.run!,
                    state: 'stopping',
                    continuationEpoch: meta.run!.continuationEpoch + 1,
                    updatedAt: now,
                }
                next.queuePaused = false
            }

            const acknowledgement: ConversationAcknowledgement = {
                status: 'accepted',
                clientMessageId: request.clientMessageId,
                turnId,
                commandSeq,
                eventSeq,
                documentRevision: meta.documentRevision,
                projectionPending: true,
            }
            const event: ConversationEvent = {
                ...this.eventBase(next, now),
                turnId,
                type: 'message.accepted',
                payload: acknowledgement,
            }
            const dispatch: ConversationDispatch = {
                jobId: turnId,
                organizationId: access.organizationId,
                workspaceId: request.workspaceId,
                conversationAssetId: request.conversationAssetId,
                userId,
                turnId,
                dueAt: now,
                ...(access.account ? { account: access.account } : {}),
            }
            const operations = [
                ...access.fences,
                ...(request.interruptId ? [this.repository.put(
                    pk,
                    `INTERRUPT_ANSWER#${request.interruptId}`,
                    {
                        turnId,
                        clientMessageId: request.clientMessageId,
                        userId,
                    },
                )] : []),
                ...await this.ports.retainReferences?.(
                    access,
                    meta.conversationAssetId,
                    turn,
                ) ?? [],
                this.repository.put(
                    pk,
                    'META',
                    next,
                    meta.revision,
                ),
                this.repository.put(
                    pk,
                    `CLIENT#${request.clientMessageId}`,
                    {
                        userId,
                        payloadHash,
                        acknowledgement,
                    },
                ),
                this.repository.put(
                    pk,
                    `COMMAND#${conversationSequenceKey(commandSeq)}`,
                    turn,
                ),
                this.repository.put(
                    pk,
                    `TURN#${turnId}`,
                    turn,
                ),
                this.repository.put(
                    pk,
                    `QUEUED#${conversationSequenceKey(commandSeq)}`,
                    {
                        turnId,
                        commandSeq,
                    },
                ),
                this.repository.put(
                    pk,
                    `MESSAGE#${conversationSequenceKey(commandSeq)}-0-user`,
                    {
                        messageId: `${conversationSequenceKey(commandSeq)}-0-user`,
                        turnId,
                        role: 'user',
                        text: conversationMessageText(request.fragment),
                        clientMessageId: request.clientMessageId,
                        complete: true,
                        createdAt: now,
                    },
                ),
                this.repository.put(
                    pk,
                    `EVENT#${conversationSequenceKey(eventSeq)}`,
                    event,
                ),
                this.repository.put(
                    pk,
                    `DISPATCH#${dispatch.jobId}`,
                    dispatch,
                ),
                this.repository.put(
                    conversationDuePartition(meta.conversationAssetId),
                    conversationDueKey(dispatch),
                    dispatch,
                ),
                this.repository.replace(
                    conversationWorkspacePartition(access.organizationId, request.workspaceId),
                    `CONVERSATION#${meta.conversationAssetId}`,
                    { conversationAssetId: meta.conversationAssetId },
                ),
            ]

            try {
                if (meta.activated)
                    await this.repository.commit(operations)
                else
                    await this.ports.activate(next, operations)
            } catch (error) {
                if (isTransactionConditionalCheckFailure(error))
                    continue

                throw error
            }

            await this.ports.publish(event)

            return acknowledgement
        }

        return this.reject(
            request,
            'CONVERSATION_BUSY',
            'Another message changed this conversation. Retry this message.',
        )
    }

    async settings(
        request: ConversationSettingsRequest,
        userId: string,
    ): Promise<ConversationSnapshot> {
        const {
            meta,
            access,
            pk,
        } = await this.load(
            request,
            userId,
            true,
        )

        if (request.expectedRevision !== meta.settingsRevision)
            throw new Error('STALE_CONVERSATION_SETTINGS')

        const now = this.ports.now()
        const next = {
            ...meta,
            settings: {
                ...meta.settings,
                ...request.patch,
            },
            settingsRevision: meta.settingsRevision + 1,
            revision: meta.revision + 1,
            eventSeq: meta.eventSeq + 1,
            updatedAt: now,
        }
        const event: ConversationEvent = {
            ...this.eventBase(next, now),
            type: 'settings.changed',
            payload: {
                settings: next.settings,
                revision: next.settingsRevision,
            },
        }
        const descriptions: string[] = []

        if (next.settings.contextMode !== meta.settings.contextMode)
            descriptions.push(`Context: ${next.settings.contextMode[0].toUpperCase()}${next.settings.contextMode.slice(1)}`)

        if (next.settings.midRunPolicy !== meta.settings.midRunPolicy)
            descriptions.push(`During a run: ${{
                steer: 'Steer',
                'stop-first': 'Stop first',
                queue: 'Queue',
            }[next.settings.midRunPolicy]}`)

        if (JSON.stringify(next.settings.models) !== JSON.stringify(meta.settings.models))
            descriptions.push('Model preferences updated')

        const messageId = `${conversationSequenceKey(meta.commandSeq)}-2-settings-${conversationSequenceKey(next.settingsRevision)}`
        const configuration: ConversationMessage = {
            messageId,
            turnId: `settings-${next.settingsRevision}`,
            role: 'configuration',
            text: `${descriptions.join('. ')  }.`,
            complete: true,
            createdAt: now,
        }
        const previousProjection = await this.repository.read<ConversationDispatch>(pk, 'DISPATCH#configuration')
        const dispatch: ConversationDispatch = {
            jobId: 'configuration',
            purpose: 'projection',
            projectionRevision: next.settingsRevision,
            organizationId: access.organizationId,
            workspaceId: request.workspaceId,
            conversationAssetId: meta.conversationAssetId,
            userId,
            turnId: configuration.turnId,
            dueAt: previousProjection?.dueAt ?? now,
            ...(access.account ? { account: access.account } : {}),
        }
        await this.repository.commit([
            ...access.fences,
            this.repository.put(
                pk,
                'META',
                next,
                meta.revision,
            ),
            this.repository.put(
                pk,
                `EVENT#${conversationSequenceKey(event.eventSeq)}`,
                event,
            ),
            ...(descriptions.length ? [this.repository.put(
                pk,
                `MESSAGE#${messageId}`,
                configuration,
            )] : []),
            ...(descriptions.length
                && meta.activated
                ? [
                    this.repository.replace(
                        pk,
                        `DISPATCH#${dispatch.jobId}`,
                        dispatch,
                    ),
                    this.repository.replace(
                        conversationDuePartition(meta.conversationAssetId),
                        conversationDueKey(dispatch),
                        dispatch,
                    ),
                ]
                : []),
        ])
        await this.ports.publish(event)

        return await this.snapshot(next)
    }

    async stop(
        request: ConversationStopRequest,
        userId: string,
    ): Promise<ConversationSnapshot> {
        return await this.commandMutation(
            request,
            userId,
            meta => {
                if (meta.run?.runId !== request.runId)
                    throw new Error('STALE_CONVERSATION_RUN')

                return {
                    ...meta,
                    queuePaused: true,
                    queueRevision: meta.queueRevision + 1,
                    run: {
                        ...meta.run,
                        state: terminal.has(meta.run.state) ? meta.run.state : 'stopping',
                        continuationEpoch: meta.run.continuationEpoch + 1,
                        updatedAt: this.ports.now(),
                    },
                }
            },
        )
    }

    async queue(
        request: ConversationQueueRequest,
        userId: string,
    ): Promise<ConversationSnapshot> {
        const changes: TransactOperation[] = []

        return await this.commandMutation(
            request,
            userId,
            async (
                meta,
                pk,
                access,
            ) => {
                changes.length = 0

                if (request.expectedRevision !== meta.queueRevision)
                    throw new Error('STALE_CONVERSATION_QUEUE')

                if (request.action === 'cancel-message') {
                    for (const turnId of request.turnIds) {
                        const turn = await this.repository.read<ConversationTurn>(pk, `TURN#${turnId}`)

                        if (
                            !turn
                            || turn.state !== 'queued'
                            || meta.run?.turnId === turnId
                        )
                            throw new Error('CONVERSATION_TURN_NOT_QUEUED')

                        if (turn.interruptId)
                            throw new Error('CONVERSATION_INTERRUPT_ANSWER_ALREADY_ACCEPTED')

                        changes.push(
                            this.repository.replace(
                                pk,
                                `TURN#${turnId}`,
                                {
                                    ...turn,
                                    state: 'stopped',
                                },
                            ),
                        )
                        changes.push(
                            this.repository.remove(pk, `QUEUED#${conversationSequenceKey(turn.commandSeq)}`),
                        )
                    }
                }

                if (request.action === 'resume') {
                    let after: string | undefined

                    do {
                        const page = await this.repository.query<ConversationDispatch>(
                            pk,
                            'DISPATCH#',
                            { after },
                        )

                        for (const dispatch of page.items) {
                            if (dispatch.userId !== userId)
                                continue

                            changes.push(
                                this.repository.replace(
                                    pk,
                                    `DISPATCH#${dispatch.jobId}`,
                                    {
                                        ...dispatch,
                                        account: access.account,
                                    },
                                ),
                            )
                        }

                        after = page.cursor
                    } while (after)

                    if (changes.length > 80)
                        throw new Error('CONVERSATION_QUEUE_TOO_LARGE')

                    if (meta.run?.state === 'needs-reauthentication') {
                        const turn = await this.repository.read<ConversationTurn>(pk, `TURN#${meta.run.turnId}`)

                        if (turn?.userId !== userId)
                            throw new Error('CONVERSATION_REAUTHENTICATION_OWNER_REQUIRED')
                    }
                }

                return {
                    ...meta,
                    queueRevision: meta.queueRevision + 1,
                    queuePaused: request.action === 'resume' ? false : meta.queuePaused,
                    ...(request.action === 'resume'
                        && meta.run?.state === 'needs-reauthentication'
                        ? { run: {
                            ...meta.run,
                            state: 'running' as const,
                        } }
                        : {}),
                }
            },
            changes,
        )
    }

    async replay(
        request: ConversationReplayRequest,
        userId: string,
    ): Promise<ConversationReplay> {
        const {
            meta,
            pk,
        } = await this.load(
            request,
            userId,
            false,
        )

        if (request.afterEventSeq > meta.eventSeq)
            return {
                events: [],
                eventSeq: meta.eventSeq,
                hasMore: false,
                snapshotRequired: true,
            }

        const result = await this.repository.query<ConversationEvent>(
            pk,
            'EVENT#',
            {
                after: `EVENT#${conversationSequenceKey(request.afterEventSeq)}`,
                limit: request.limit ?? 100,
            },
        )
        const events: ConversationEvent[] = []
        let bytes = 1024
        let expected = request.afterEventSeq + 1
        let gap = false

        for (const row of result.items) {
            if (row.eventSeq > meta.eventSeq)
                break

            if (row.eventSeq !== expected) {
                gap = true

                break
            }

            const event = { ...row } as ConversationEvent & {
                pk?: string
                sk?: string
            }
            delete event.pk
            delete event.sk
            const size = Buffer.byteLength(
                JSON.stringify(event),
            ) + 1

            if (bytes + size > CONVERSATION_RESPONSE_MAX_BYTES) {
                if (!events.length)
                    gap = true

                break
            }

            bytes += size
            events.push(event)
            expected++
        }

        gap ||= !events.length && request.afterEventSeq < meta.eventSeq

        return {
            events: gap ? [] : events,
            eventSeq: meta.eventSeq,
            hasMore: !gap && (events.at(-1)?.eventSeq ?? request.afterEventSeq) < meta.eventSeq,
            snapshotRequired: gap,
        }
    }

    private async commandMutation(
        request: ConversationStopRequest | ConversationQueueRequest,
        userId: string,
        change: (
            meta: ConversationMeta,
            pk: string,
            access: ConversationAccess,
        ) => ConversationMeta | Promise<ConversationMeta>,
        extra: TransactOperation[] = [],
        attempt = 0,
    ): Promise<ConversationSnapshot> {
        const {
            meta,
            access,
            pk,
        } = await this.load(
            request,
            userId,
            true,
        )
        const hash = conversationPayloadHash(request)
        const receipt = await this.repository.read<{ hash: string }>(pk, `CONTROL#${request.clientCommandId}`)

        if (receipt) {
            if (receipt.hash !== hash)
                throw new Error('CONVERSATION_IDEMPOTENCY_CONFLICT')

            return await this.snapshot(meta)
        }

        const next = await change(
            meta,
            pk,
            access,
        )
        next.revision = meta.revision + 1
        next.eventSeq = meta.eventSeq + 1
        next.updatedAt = this.ports.now()
        const event: ConversationEvent = {
            ...this.eventBase(next, next.updatedAt),
            type: 'queue.state',
            payload: {
                revision: next.queueRevision,
                paused: next.queuePaused,
                turnIds: [],
            },
        }

        try {
            await this.repository.commit([
                ...access.fences,
                this.repository.put(
                    pk,
                    'META',
                    next,
                    meta.revision,
                ),
                this.repository.put(
                    pk,
                    `CONTROL#${request.clientCommandId}`,
                    { hash },
                ),
                this.repository.put(
                    pk,
                    `EVENT#${conversationSequenceKey(next.eventSeq)}`,
                    event,
                ),
                ...extra,
            ])
        } catch (error) {
            if (
                isTransactionConditionalCheckFailure(error)
                && attempt < 4
            )
                return await this.commandMutation(
                    request,
                    userId,
                    change,
                    extra,
                    attempt + 1,
                )

            throw error
        }

        await this.ports.publish(event)

        return await this.snapshot(next)
    }

    private async load(
        request: ConversationCommandBase,
        userId: string,
        write: boolean,
    ): Promise<{
        meta: ConversationMeta
        access: ConversationAccess
        pk: string
    }> {
        const access = await this.ports.authorize(
            request.workspaceId,
            userId,
            write,
        )
        const pk = conversationPartition(access.organizationId, request.conversationAssetId)
        const meta = await this.repository.read<ConversationMeta>(pk, 'META')

        if (
            !meta
            || meta.workspaceId !== request.workspaceId
            || (!meta.activated && meta.ownerUserId !== userId)
        )
            throw new Error('CONVERSATION_NOT_FOUND')

        if (
            meta.expiresAt
            && meta.expiresAt <= Math.floor(this.ports.now() / 1000)
        )
            throw new Error('CONVERSATION_RESERVATION_EXPIRED')

        return {
            meta,
            access,
            pk,
        }
    }

    private async snapshot(
        meta: ConversationMeta,
        includeMessages = true,
        attempt = 0,
    ): Promise<ConversationSnapshot> {
        const pk = conversationPartition(meta.organizationId, meta.conversationAssetId)
        const queued = await this.repository.query<{
            turnId: string
            commandSeq: number
        }>(
            pk,
            'QUEUED#',
            { limit: 100 },
        )
        const turns = await Promise.all(
            queued.items.filter(entry => entry.commandSeq <= meta.commandSeq).map(
                entry => this.repository.read<ConversationTurn>(pk, `TURN#${entry.turnId}`),
            ),
        )
        const snapshot: ConversationSnapshot = {
            protocolVersion: 1,
            workspaceId: meta.workspaceId,
            conversationAssetId: meta.conversationAssetId,
            title: await this.ports.title?.(meta) ?? meta.title,
            settings: meta.settings,
            settingsRevision: meta.settingsRevision,
            queueRevision: meta.queueRevision,
            queuePaused: meta.queuePaused,
            queuedTurns: turns.filter((turn): turn is ConversationTurn => turn?.state === 'queued').sort(
                (left, right) => left.commandSeq - right.commandSeq,
            ).map(
                ({
                    turnId,
                    clientMessageId,
                    commandSeq,
                    state,
                    createdAt,
                    interruptId,
                }) => ({
                    turnId,
                    clientMessageId,
                    commandSeq,
                    state,
                    createdAt,
                    ...(interruptId ? { interruptId } : {}),
                }),
            ),
            ...(meta.run ? { run: meta.run } : {}),
            messages: [],
            documentRevision: meta.documentRevision,
            eventSeq: meta.eventSeq,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
        }

        if (includeMessages) {
            const page = await this.messagePage(
                meta,
                undefined,
                50,
                CONVERSATION_RESPONSE_MAX_BYTES - Buffer.byteLength(
                    JSON.stringify(snapshot),
                ) - 2048,
            )
            snapshot.messages = page.messages
            snapshot.operations = page.operations

            if (page.cursor)
                snapshot.messageCursor = page.cursor
        }

        const latest = await this.repository.read<ConversationMeta>(pk, 'META')

        if (!latest)
            throw new Error('CONVERSATION_NOT_FOUND')

        if (latest.revision !== meta.revision) {
            if (attempt >= 4)
                throw new Error('CONVERSATION_SNAPSHOT_BUSY')

            return await this.snapshot(
                latest,
                includeMessages,
                attempt + 1,
            )
        }

        return snapshot
    }

    private async messagePage(
        meta: ConversationMeta,
        cursor?: string,
        limit = 50,
        maxBytes = CONVERSATION_RESPONSE_MAX_BYTES - 2048,
    ): Promise<ConversationMessagesPage> {
        let before: string | undefined

        if (cursor) {
            try {
                const decoded = JSON.parse(
                    Buffer.from(cursor, 'base64url').toString('utf8'),
                )

                if (
                    decoded.version !== 1
                    || decoded.workspaceId !== meta.workspaceId
                    || decoded.conversationAssetId !== meta.conversationAssetId
                    || typeof decoded.before !== 'string'
                    || !/^MESSAGE#[A-Za-z0-9_-]{1,256}$/u.test(decoded.before)
                )
                    throw new Error('INVALID_CONVERSATION_CURSOR')

                before = decoded.before
            } catch {
                throw new Error('INVALID_CONVERSATION_CURSOR')
            }
        }

        const page = await this.repository.query<ConversationMessage & { sk: string }>(
            conversationPartition(meta.organizationId, meta.conversationAssetId),
            'MESSAGE#',
            {
                descending: true,
                limit,
                ...(before ? { after: before } : {}),
            },
        )
        const messages: ConversationMessage[] = []
        const operations: ConversationOperationSummary[] = []
        let bytes = 0
        let lastKey: string | undefined
        let more = Boolean(page.cursor)

        for (const row of page.items) {
            const message: ConversationMessage = {
                messageId: row.messageId,
                turnId: row.turnId,
                role: row.role,
                text: row.text,
                complete: row.complete,
                createdAt: row.createdAt,
                orderKey: row.sk.slice('MESSAGE#'.length),
                ...(row.clientMessageId ? { clientMessageId: row.clientMessageId } : {}),
            }
            const messageOperations = message.role === 'assistant' ? await this.messageOperations(meta, message.messageId) : []
            const size = Buffer.byteLength(
                JSON.stringify(message),
            ) + Buffer.byteLength(
                JSON.stringify(messageOperations),
            ) + 2

            if (bytes + size > maxBytes) {
                if (!messages.length)
                    throw new Error('CONVERSATION_RECORD_TOO_LARGE')

                more = true

                break
            }

            messages.push(message)
            operations.push(...messageOperations)
            lastKey = row.sk
            bytes += size
        }

        return {
            messages: messages.reverse(),
            operations,
            ...(more
                && lastKey
                ? { cursor: Buffer.from(
                    JSON.stringify({
                        version: 1,
                        workspaceId: meta.workspaceId,
                        conversationAssetId: meta.conversationAssetId,
                        before: lastKey,
                    }),
                ).toString('base64url') }
                : {}),
        }
    }

    private async messageOperations(
        meta: ConversationMeta,
        messageId: string,
    ): Promise<ConversationOperationSummary[]> {
        const result: ConversationOperationSummary[] = []
        let after: string | undefined

        do {
            const page = await this.repository.query<ConversationOperationSummary>(
                conversationPartition(meta.organizationId, meta.conversationAssetId),
                `PUBLIC_OPERATION#${messageId}#`,
                {
                    after,
                    limit: 100,
                },
            )

            for (const row of page.items) {
                const {
                    operationId,
                    turnId,
                    responseMessageId,
                    operationKey,
                    executionId,
                    stepId,
                    stepLabel,
                    state,
                    outputAssetIds,
                    error,
                    createdAt,
                    updatedAt,
                } = row
                result.push({
                    operationId,
                    turnId,
                    responseMessageId,
                    operationKey,
                    ...(executionId ? { executionId } : {}),
                    ...(stepId ? { stepId } : {}),
                    ...(stepLabel ? { stepLabel } : {}),
                    state,
                    outputAssetIds,
                    ...(error ? { error } : {}),
                    createdAt,
                    updatedAt,
                })
            }

            after = page.cursor

            if (
                result.length > 256
                || Buffer.byteLength(
                    JSON.stringify(result),
                ) > CONVERSATION_RESPONSE_MAX_BYTES / 2
            )
                throw new Error('CONVERSATION_OPERATION_HISTORY_TOO_LARGE')
        } while (after)

        return result
    }

    private eventBase(
        meta: ConversationMeta,
        now: number,
    ) {
        return {
            protocolVersion: 1 as const,
            workspaceId: meta.workspaceId,
            conversationAssetId: meta.conversationAssetId,
            turnId: meta.run?.turnId ?? null,
            runId: meta.run?.runId ?? null,
            epoch: meta.epoch,
            eventSeq: meta.eventSeq,
            createdAt: now,
        }
    }

    private reject(
        request: ConversationSubmitRequest,
        code: string,
        message: string,
    ): ConversationAcknowledgement {
        return {
            status: 'rejected',
            clientMessageId: request.clientMessageId,
            error: {
                code,
                message,
                recoverable: true,
            },
        }
    }
}

export const conversationServiceClock = {
    now: Date.now,
    createId: randomUUID,
}
