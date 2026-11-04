import {
    type ConversationAcknowledgement,
    type ConversationCreateRequest,
    type ConversationEvent,
    type ConversationGetRequest,
    type ConversationListRequest,
    type ConversationMessageNode,
    type ConversationMessage,
    type ConversationMessagesPage,
    type ConversationMessagesRequest,
    type ConversationQueueRequest,
    type ConversationReference,
    type ConversationReplay,
    type ConversationReplayRequest,
    type ConversationSettings,
    type ConversationSettingsRequest,
    type ConversationSnapshot,
    type ConversationStopRequest,
    type ConversationSubmitRequest,
    type ConversationOperationSummary,
} from '@lixpi/constants'

export type WorkspaceConversationPorts = {
    rename?: (
        workspaceId: string,
        conversationAssetId: string,
        title: string,
    ) => Promise<void>
    create: (request: ConversationCreateRequest) => Promise<ConversationSnapshot>
    list: (request: ConversationListRequest) => Promise<{
        conversations: ConversationSnapshot[]
        cursor?: string
    }>
    get: (request: ConversationGetRequest) => Promise<ConversationSnapshot>
    messages?: (request: ConversationMessagesRequest) => Promise<ConversationMessagesPage>
    submit: (request: ConversationSubmitRequest) => Promise<ConversationAcknowledgement>
    settings: (request: ConversationSettingsRequest) => Promise<ConversationSnapshot>
    stop: (request: ConversationStopRequest) => Promise<unknown>
    queue: (request: ConversationQueueRequest) => Promise<unknown>
    replay: (request: ConversationReplayRequest) => Promise<ConversationReplay>
    subscribe: (
        workspaceId: string,
        conversationAssetId: string,
        receive: (event: ConversationEvent) => void,
    ) => () => void
}

export class WorkspaceConversationController {
    conversations: ConversationSnapshot[] = []
    current?: ConversationSnapshot
    error = ''
    submitting = false
    selecting = false
    loadingEarlier = false
    nextMessagePolicy?: ConversationSettings['midRunPolicy']
    steeringPending = false
    readonly operations = new Map<string, ConversationOperationSummary>()
    pendingSubmission?: ConversationSubmitRequest
    private readonly listeners = new Set<() => void>()
    private subscription?: () => void
    private generation = 0
    private destroyed = false
    private replaying?: Promise<void>
    private readonly buffered = new Map<number, ConversationEvent>()
    private readonly activeKey: string
    private readonly reservations = new Set<string>()
    private recoveryError?: string
    private snapshotNeeded = false

    constructor(
        readonly workspaceId: string,
        userId: string,
        readonly ports: WorkspaceConversationPorts,
        private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
        private readonly createId: () => string,
    ) {
        this.activeKey = `lixpi:conversation-active:${userId}:${workspaceId}`
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener)

        return () => this.listeners.delete(listener)
    }

    async initialize(legacyConversationId?: string): Promise<void> {
        try {
            let cursor: string | undefined

            do {
                const page = await this.ports.list({
                    protocolVersion: 1,
                    workspaceId: this.workspaceId,
                    ...(cursor ? { cursor } : {}),
                    limit: 100,
                })

                if (this.destroyed)
                    return

                this.conversations.push(
                    ...page.conversations.filter(
                        item => !this.conversations.some(existing => existing.conversationAssetId === item.conversationAssetId),
                    ),
                )
                cursor = page.cursor
            } while (cursor)

            let saved: string | null = null

            try {
                saved = this.storage.getItem(this.activeKey)
            } catch {}

            await this.restoreSelection([saved, legacyConversationId])
        } catch (error) {
            this.failRecovery(error)
        }
    }

    async refreshList(): Promise<void> {
        try {
            const conversations: ConversationSnapshot[] = []
            let cursor: string | undefined

            do {
                const page = await this.ports.list({
                    protocolVersion: 1,
                    workspaceId: this.workspaceId,
                    limit: 100,
                    ...(cursor ? { cursor } : {}),
                })

                if (this.destroyed)
                    return

                conversations.push(...page.conversations)
                cursor = page.cursor
            } while (cursor)

            this.conversations = conversations.map(item => (item.conversationAssetId === this.current?.conversationAssetId ? this.current : item))

            for (const item of conversations)
                this.reservations.delete(item.conversationAssetId)

            if (
                this.current
                && this.reservations.has(this.current.conversationAssetId)
            )
                this.conversations.unshift(this.current)

            this.clearRecoveryError()

            if (
                !this.current
                && !this.selecting
                && !this.submitting
            ) {
                let selected: string | null = null

                try {
                    selected = this.storage.getItem(this.activeKey)
                } catch {}

                await this.restoreSelection([selected])
            }

            this.emit()
        } catch (error) {
            this.failRecovery(error)
        }
    }

    async rename(title: string): Promise<void> {
        if (
            !this.current
            || !this.ports.rename
        )
            return

        try {
            await this.ports.rename(
                this.workspaceId,
                this.current.conversationAssetId,
                title,
            )
            await this.refresh(this.current.conversationAssetId)
        } catch (error) {
            this.fail(error)
        }
    }

    isUnread(snapshot: ConversationSnapshot): boolean {
        if (snapshot.conversationAssetId === this.current?.conversationAssetId)
            return false

        try {
            return snapshot.eventSeq > Number(this.storage.getItem(`${this.activeKey}:read:${snapshot.conversationAssetId}`) ?? 0)
        } catch {
            return false
        }
    }

    saveScroll(
        conversationAssetId: string,
        position: number,
    ): void {
        try {
            this.storage.setItem(
                `${this.activeKey}:scroll:${conversationAssetId}`,
                String(position),
            )
        } catch {}
    }

    readScroll(conversationAssetId: string): number | undefined {
        try {
            const value = this.storage.getItem(`${this.activeKey}:scroll:${conversationAssetId}`)

            return value === null ? undefined : Number(value)
        } catch {
            return undefined
        }
    }

    async create(forSubmission = false): Promise<void> {
        if (
            this.submitting
            && !forSubmission
        )
            return

        try {
            const snapshot = await this.ports.create({
                protocolVersion: 1,
                workspaceId: this.workspaceId,
                clientConversationId: this.createId(),
            })

            if (this.destroyed)
                return

            this.conversations.unshift(snapshot)
            this.reservations.add(snapshot.conversationAssetId)
            await this.select(snapshot.conversationAssetId, forSubmission)
        } catch (error) {
            this.fail(error)
        }
    }

    async select(
        conversationAssetId: string,
        forSubmission = false,
    ): Promise<boolean> {
        if (
            this.submitting
            && !forSubmission
        )
            return false

        const generation = ++this.generation

        if (!forSubmission)
            this.nextMessagePolicy = undefined

        this.selecting = true
        this.subscription?.()
        this.subscription = undefined
        this.buffered.clear()
        this.operations.clear()
        this.snapshotNeeded = false
        this.steeringPending = false
        this.replaying = undefined
        this.loadingEarlier = false
        this.error = ''
        this.emit()

        try {
            this.subscription = this.ports.subscribe(
                this.workspaceId,
                conversationAssetId,
                event => {
                    if (generation === this.generation)
                        this.receive(event)
                },
            )
            const snapshot = await this.ports.get({
                protocolVersion: 1,
                workspaceId: this.workspaceId,
                conversationAssetId,
            })

            if (
                this.destroyed
                || generation !== this.generation
            )
                return false

            this.current = snapshot
            this.mergeOperations(snapshot.operations ?? [])
            this.markRead()
            this.pendingSubmission = this.readPending(conversationAssetId)

            try {
                this.storage.setItem(this.activeKey, conversationAssetId)
            } catch {}

            this.emit()
            await this.recover()

            return true
        } catch (error) {
            if (generation === this.generation)
                this.fail(error)

            return false
        } finally {
            if (generation === this.generation) {
                this.selecting = false
                this.emit()
            }
        }
    }

    private async restoreSelection(preferred: Array<string | null | undefined>): Promise<void> {
        const candidates = new Set([
            ...preferred,
            this.conversations[0]?.conversationAssetId,
        ])

        for (const conversationAssetId of candidates) {
            if (
                !conversationAssetId
                || this.destroyed
            )
                continue

            if (!(await this.select(conversationAssetId)))
                continue

            if (
                this.current
                && !this.conversations.some(item => item.conversationAssetId === conversationAssetId)
            ) {
                this.reservations.add(conversationAssetId)
                this.conversations.unshift(this.current)
            }

            this.emit()

            return
        }

        this.emit()
    }

    async submit(
        fragment: ConversationMessageNode,
        references: ConversationReference[],
        models: ConversationSettings['models'],
    ): Promise<void> {
        if (this.submitting)
            throw new Error('A message is awaiting acknowledgement.')

        if (this.selecting)
            throw new Error('The selected conversation is loading.')

        if (references.length > 24) {
            this.error = 'Attach at most 24 references to one message.'
            this.emit()

            throw new Error(this.error)
        }

        this.submitting = true
        this.error = ''
        this.emit()

        try {
            if (!this.current)
                await this.create(true)

            if (!this.current)
                throw new Error(this.error || 'A conversation could not be created.')

            const conversationAssetId = this.current.conversationAssetId
            const running = this.current.run && !['completed', 'stopped', 'failed'].includes(this.current.run.state)
            this.steeringPending = Boolean(running && (this.nextMessagePolicy ?? this.current.settings.midRunPolicy) === 'steer')

            // Preferences are settings only. They never pre-create generation work.
            if (JSON.stringify(models) !== JSON.stringify(this.current.settings.models))
                await this.changeSettings({ models })

            const request: ConversationSubmitRequest = {
                protocolVersion: 1,
                workspaceId: this.workspaceId,
                conversationAssetId,
                clientMessageId: this.createId(),
                fragment: structuredClone(fragment),
                references: structuredClone(references),
                settingsRevision: this.current.settingsRevision,
                ...(this.nextMessagePolicy ? { midRunPolicy: this.nextMessagePolicy } : {}),
                ...(this.current.run?.state === 'waiting-input'
                    && this.current.run.interruptId
                    ? { interruptId: this.current.run.interruptId }
                    : {}),
            }
            const previous = this.pendingSubmission
            this.pendingSubmission = previous
                && previous.conversationAssetId === conversationAssetId
                && JSON.stringify(previous.fragment) === JSON.stringify(fragment)
                && JSON.stringify(previous.references) === JSON.stringify(references)
                ? previous
                : request
            this.writePending(conversationAssetId, this.pendingSubmission)
            let acknowledgement: ConversationAcknowledgement

            try {
                acknowledgement = await this.ports.submit(this.pendingSubmission)
            } catch (error) {
                const snapshot = await this.ports.get({
                    protocolVersion: 1,
                    workspaceId: this.workspaceId,
                    conversationAssetId,
                    clientMessageId: this.pendingSubmission.clientMessageId,
                })

                if (!snapshot.acknowledgement)
                    throw error

                acknowledgement = snapshot.acknowledgement
            }

            if (acknowledgement.status === 'rejected') {
                this.pendingSubmission = undefined
                this.writePending(conversationAssetId)

                throw new Error(acknowledgement.error.message)
            }

            this.pendingSubmission = undefined
            this.writePending(conversationAssetId)
            this.nextMessagePolicy = undefined

            try {
                await this.refresh(conversationAssetId)
            } catch (error) {
                this.fail(error)
            }
        } catch (error) {
            this.fail(error)

            throw error
        } finally {
            this.submitting = false
            this.emit()
        }
    }

    async changeSettings(patch: Partial<ConversationSettings>): Promise<void> {
        if (!this.current)
            return

        const snapshot = await this.ports.settings({
            protocolVersion: 1,
            workspaceId: this.workspaceId,
            conversationAssetId: this.current.conversationAssetId,
            expectedRevision: this.current.settingsRevision,
            patch,
        })

        if (snapshot.conversationAssetId === this.current?.conversationAssetId)
            this.install(snapshot)
    }

    async stop(): Promise<void> {
        if (!this.current?.run)
            return

        try {
            await this.ports.stop({
                protocolVersion: 1,
                workspaceId: this.workspaceId,
                conversationAssetId: this.current.conversationAssetId,
                runId: this.current.run.runId,
                clientCommandId: this.createId(),
            })
            await this.refresh(this.current.conversationAssetId)
        } catch (error) {
            this.fail(error)
        }
    }

    async queue(
        action: 'cancel-message' | 'resume',
        turnIds: string[] = [],
    ): Promise<void> {
        if (!this.current)
            return

        try {
            await this.ports.queue({
                protocolVersion: 1,
                workspaceId: this.workspaceId,
                conversationAssetId: this.current.conversationAssetId,
                expectedRevision: this.current.queueRevision,
                clientCommandId: this.createId(),
                action,
                turnIds,
            })
            await this.refresh(this.current.conversationAssetId)
        } catch (error) {
            this.fail(error)
        }
    }

    async loadEarlier(): Promise<void> {
        const current = this.current

        if (
            !current?.messageCursor
            || !this.ports.messages
            || this.loadingEarlier
            || this.selecting
        )
            return

        const generation = this.generation
        const cursor = current.messageCursor
        this.loadingEarlier = true
        this.error = ''
        this.emit()

        try {
            const page = await this.ports.messages({
                protocolVersion: 1,
                workspaceId: this.workspaceId,
                conversationAssetId: current.conversationAssetId,
                cursor,
                limit: 50,
            })

            if (
                this.destroyed
                || generation !== this.generation
                || this.current?.conversationAssetId !== current.conversationAssetId
            )
                return

            this.current.messages = this.mergeMessages(page.messages, this.current.messages)
            this.mergeOperations(page.operations ?? [])

            if (this.current.messageCursor === cursor)
                this.current.messageCursor = page.cursor
        } catch (error) {
            if (generation === this.generation)
                this.fail(error)
        } finally {
            if (generation === this.generation) {
                this.loadingEarlier = false
                this.emit()
            }
        }
    }

    async recover(): Promise<void> {
        if (this.replaying)
            return await this.replaying

        const generation = this.generation
        const run = async () => {
            if (!this.current)
                return

            let more = true

            while (
                more
                && !this.destroyed
                && generation === this.generation
            ) {
                const result = await this.ports.replay({
                    protocolVersion: 1,
                    workspaceId: this.workspaceId,
                    conversationAssetId: this.current.conversationAssetId,
                    afterEventSeq: this.current.eventSeq,
                    limit: 100,
                })

                if (
                    generation !== this.generation
                    || this.destroyed
                )
                    return

                if (result.snapshotRequired) {
                    await this.refresh(this.current.conversationAssetId)

                    return
                }

                for (const event of result.events)
                    this.buffered.set(event.eventSeq, event)

                this.drain()
                more = result.hasMore

                if (
                    more
                    && !result.events.length
                )
                    throw new Error('Conversation replay did not advance.')
            }

            if (
                this.snapshotNeeded
                && this.current
                && generation === this.generation
            )
                await this.refresh(this.current.conversationAssetId)
        }
        this.replaying = run()

        try {
            await this.replaying

            if (
                this.current
                && generation === this.generation
            )
                this.clearRecoveryError()
        } catch (error) {
            this.failRecovery(error)
        } finally {
            if (generation === this.generation)
                this.replaying = undefined
        }
    }

    destroy(): void {
        this.destroyed = true
        this.generation++
        this.subscription?.()
        this.listeners.clear()
        this.buffered.clear()
    }

    private receive(event: ConversationEvent): void {
        if (
            this.destroyed
            || event.workspaceId !== this.workspaceId
            || event.conversationAssetId !== this.current?.conversationAssetId
            || event.eventSeq <= this.current.eventSeq
        )
            return

        this.buffered.set(event.eventSeq, event)
        this.drain()

        if (this.buffered.size)
            void this.recover()
    }

    private drain(): void {
        if (!this.current)
            return

        for (const sequence of this.buffered.keys())
            if (sequence <= this.current.eventSeq)
                this.buffered.delete(sequence)

        let event = this.buffered.get(this.current.eventSeq + 1)

        while (event) {
            this.buffered.delete(event.eventSeq)
            this.current.eventSeq = event.eventSeq

            if (event.type === 'message.delta') {
                const payload = event.payload
                const message = this.current.messages.find(message => message.messageId === payload.messageId)

                if (
                    message
                    && message.text.length === event.payload.offset
                )
                    message.text += event.payload.text
                else if (
                    !message
                    && event.payload.offset === 0
                )
                    this.current.messages.push({
                        messageId: event.payload.messageId,
                        turnId: event.turnId ?? '',
                        role: 'assistant',
                        text: event.payload.text,
                        complete: false,
                        createdAt: event.createdAt,
                    })
                else
                    void this.refreshSafely(this.current.conversationAssetId)
            } else if (event.type === 'message.completed') {
                const payload = event.payload
                this.current.messages = this.mergeMessages(this.current.messages, [payload])
            } else if (event.type === 'run.state') {
                const run = event.payload

                if (
                    !this.current.run
                    || event.payload.instructionRevision > this.current.run.instructionRevision
                    || ['completed', 'stopped', 'failed'].includes(event.payload.state)
                )
                    this.steeringPending = false

                if (
                    !this.current.run
                    || event.payload.epoch >= this.current.run.epoch
                ) {
                    this.current.run = event.payload
                    this.current.queuedTurns = this.current.queuedTurns.filter(turn => turn.turnId !== run.turnId)
                    void this.refreshSafely(this.current.conversationAssetId)
                }
            } else if (event.type === 'settings.changed') {
                if (event.payload.revision > this.current.settingsRevision) {
                    this.current.settings = event.payload.settings
                    this.current.settingsRevision = event.payload.revision
                }
            } else if (event.type === 'operation.status') {
                this.mergeOperations([{
                    ...event.payload,
                    outputAssetIds: event.payload.state === 'succeeded' ? event.payload.outputAssetIds : {},
                }])
                const operation = event.payload

                if (!this.current.messages.some(message => message.messageId === operation.responseMessageId))
                    this.current.messages = this.mergeMessages(
                        this.current.messages,
                        [{
                            messageId: operation.responseMessageId,
                            turnId: operation.turnId,
                            role: 'assistant',
                            text: '',
                            complete: false,
                            createdAt: operation.createdAt,
                        }],
                    )
            } else if (event.type === 'output.committed') {
                const operation = this.operations.get(event.payload.operationId)

                if (operation)
                    this.mergeOperations([{
                        ...operation,
                        outputAssetIds: {
                            ...operation.outputAssetIds,
                            [event.payload.outputSlot]: event.payload.assetId,
                        },
                        updatedAt: Math.max(operation.updatedAt, event.createdAt),
                    }])
                else
                    void this.refreshSafely(this.current.conversationAssetId)
            } else if (event.type === 'error')
                this.error = event.payload.message
            else if (event.type === 'queue.state') {
                const queue = event.payload

                if (event.payload.revision >= this.current.queueRevision) {
                    this.current.queueRevision = event.payload.revision
                    this.current.queuePaused = event.payload.paused
                    this.current.queuedTurns = this.current.queuedTurns.filter(turn => queue.turnIds.includes(turn.turnId))
                }

                void this.refreshSafely(this.current.conversationAssetId)
            } else if (event.type === 'message.accepted')
                void this.refreshSafely(this.current.conversationAssetId)

            event = this.buffered.get(this.current.eventSeq + 1)
        }

        this.emit()
    }

    private async refresh(conversationAssetId: string): Promise<void> {
        const snapshot = await this.ports.get({
            protocolVersion: 1,
            workspaceId: this.workspaceId,
            conversationAssetId,
        })

        if (
            !this.destroyed
            && snapshot.conversationAssetId === this.current?.conversationAssetId
            && snapshot.eventSeq >= this.current.eventSeq
        ) {
            this.snapshotNeeded = false
            this.install(snapshot)
        }
    }

    private install(snapshot: ConversationSnapshot): void {
        if (
            snapshot.conversationAssetId === this.current?.conversationAssetId
            && snapshot.eventSeq < this.current.eventSeq
        )
            return

        if (snapshot.conversationAssetId === this.current?.conversationAssetId) {
            const ids = new Set(
                this.current.messages.map(message => message.messageId),
            )
            const overlaps = snapshot.messages.some(message => ids.has(message.messageId))
            snapshot.messages = this.mergeMessages(this.current.messages, snapshot.messages)

            if (overlaps)
                snapshot.messageCursor = this.current.messageCursor
        }

        if (
            snapshot.run
            && (!this.current?.run || snapshot.run.instructionRevision > this.current.run.instructionRevision || ['completed', 'stopped', 'failed'].includes(snapshot.run.state))
        )
            this.steeringPending = false

        this.current = snapshot
        this.mergeOperations(snapshot.operations ?? [])
        this.conversations = this.conversations.map(item => (item.conversationAssetId === snapshot.conversationAssetId ? snapshot : item))
        this.emit()
    }

    private mergeOperations(incoming: ConversationOperationSummary[]): void {
        for (const operation of incoming) {
            const previous = this.operations.get(operation.operationId)
            const latest = previous
                && previous.updatedAt > operation.updatedAt
                ? previous
                : operation
            this.operations.set(
                operation.operationId,
                {
                    operationId: latest.operationId,
                    turnId: latest.turnId,
                    responseMessageId: latest.responseMessageId,
                    operationKey: latest.operationKey,
                    ...(latest.executionId ? { executionId: latest.executionId } : {}),
                    ...(latest.stepId ? { stepId: latest.stepId } : {}),
                    ...(latest.stepLabel ? { stepLabel: latest.stepLabel } : {}),
                    state: latest.state,
                    outputAssetIds: {
                        ...previous?.outputAssetIds,
                        ...operation.outputAssetIds,
                    },
                    ...(latest.error ? { error: latest.error } : {}),
                    createdAt: latest.createdAt,
                    updatedAt: latest.updatedAt,
                },
            )
        }

        if (this.current)
            this.current.operations = [...this.operations.values()]
    }

    private mergeMessages(
        earlier: ConversationMessage[],
        later: ConversationMessage[],
    ): ConversationMessage[] {
        const messages = new Map(
            earlier.map(message => [message.messageId, message]),
        )

        for (const message of later)
            messages.set(
                message.messageId,
                {
                    ...messages.get(message.messageId),
                    ...message,
                },
            )

        return [...messages.values()].sort((left, right) => {
            const leftOrder = left.orderKey ?? left.messageId
            const rightOrder = right.orderKey ?? right.messageId

            return leftOrder < rightOrder
                ? -1
                : leftOrder > rightOrder
                    ? 1
                    : left.createdAt - right.createdAt
        })
    }

    private async refreshSafely(conversationAssetId: string): Promise<void> {
        this.snapshotNeeded = true

        try {
            await this.refresh(conversationAssetId)
        } catch (error) {
            if (conversationAssetId === this.current?.conversationAssetId)
                this.fail(error)
        }
    }

    private readPending(conversationAssetId: string): ConversationSubmitRequest | undefined {
        try {
            const raw = this.storage.getItem(`${this.activeKey}:pending:${conversationAssetId}`)
            const value = raw ? (JSON.parse(raw) as ConversationSubmitRequest) : undefined

            return value?.workspaceId === this.workspaceId
                && value.conversationAssetId === conversationAssetId
                && value.protocolVersion === 1
                ? value
                : undefined
        } catch {
            return undefined
        }
    }

    private writePending(
        conversationAssetId: string,
        request?: ConversationSubmitRequest,
    ): void {
        try {
            this.storage.setItem(
                `${this.activeKey}:pending:${conversationAssetId}`,
                JSON.stringify(request ?? null),
            )
        } catch {}
    }

    private fail(error: unknown): void {
        this.error = error instanceof Error ? error.message : 'Conversation connection failed.'
        this.emit()
    }

    private failRecovery(error: unknown): void {
        this.recoveryError = error instanceof Error ? error.message : 'Conversation connection failed.'
        this.fail(error)
    }

    private clearRecoveryError(): void {
        if (
            this.recoveryError
            && this.error === this.recoveryError
        ) {
            this.error = ''
            this.emit()
        }

        this.recoveryError = undefined
    }

    private emit(): void {
        if (!this.destroyed) {
            this.markRead()
            this.listeners.forEach(listener => listener())
        }
    }

    private markRead(): void {
        if (this.current) try {
            this.storage.setItem(
                `${this.activeKey}:read:${this.current.conversationAssetId}`,
                String(this.current.eventSeq),
            )
        } catch {}
    }
}
