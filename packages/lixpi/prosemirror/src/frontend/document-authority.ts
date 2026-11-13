import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import {
    TextSelection,
    type Transaction,
} from 'prosemirror-state'
import {
    Mapping,
    Step,
} from 'prosemirror-transform'
import {
    type EditorView,
} from 'prosemirror-view'

import {
    getAssetDocumentEventSubject,
    type AssetDocResumeResult,
    type AssetDocSnapshot,
    type AssetDocSnapshotReference,
    type AssetDocumentRole,
    type AssetStepStreamEvent,
    type SubmitResult,
} from '../shared/transport-types.ts'
import { DOCUMENT_REPLACE_META } from './document-view.ts'

// Marks a transaction the authority applied from the server.
export const DOCUMENT_AUTHORITY_REMOTE_META = 'proseMirrorAuthorityRemote'

export type DocumentLeaseState = {
    readOnly: boolean
    holderWorkspaceId?: string
    expiresAt?: number
}

export type DocumentAuthorityResumeRequest = {
    organizationId: string
    workspaceId: string
    assetId: string
    role: AssetDocumentRole
    localVersion: number
    localStreamSeq: number
    acceptSnapshot: boolean
    activateLiveRelay: boolean
}

export type DocumentAuthoritySubmitRequest = {
    organizationId: string
    assetId: string
    role: AssetDocumentRole
    workspaceId: string
    leaseId: string
    holderId: string
    baseVersion: number
    expectedVersion: number
    steps: Array<{
        step: unknown
        msgId: string
        clientId: string
    }>
}

type DocumentAuthorityEvent = AssetStepStreamEvent & { streamSequence?: number }
type LeaseGrant = { leaseId: string }
type LeaseResult = LeaseGrant | { error: string } | null | undefined

// What the authority needs from the host: the signed-in user, the live event
// subscription, the document resume and step submission requests, snapshot
// downloads and the edit lease calls. The host adds authentication.
export type DocumentAuthorityTransport = {
    isReady: () => boolean
    userId: () => string | undefined
    subscribe: (
        subject: string,
        handler: (event: DocumentAuthorityEvent) => void,
    ) => { unsubscribe: () => void }
    resume: (
        request: DocumentAuthorityResumeRequest,
        timeoutMs: number,
    ) => Promise<AssetDocResumeResult & { error?: string }>
    submitSteps: (request: DocumentAuthoritySubmitRequest) => Promise<SubmitResult & { error?: string }>
    fetchSnapshot: (reference: AssetDocSnapshotReference) => Promise<AssetDocSnapshot>
    acquireLease: (
        assetId: string,
        workspaceId: string,
        holderId: string,
    ) => Promise<LeaseResult>
    renewLease: (
        assetId: string,
        workspaceId: string,
        leaseId: string,
        holderId: string,
    ) => Promise<LeaseResult | void>
    releaseLease: (
        assetId: string,
        workspaceId: string,
        leaseId: string,
        holderId: string,
    ) => Promise<void>
    // The lease another holder has, shown while this view is read-only.
    readEditLease: (
        assetId: string,
        workspaceId: string,
    ) => Promise<{
        workspaceId?: string
        expiresAt?: number
    } | undefined>
}

export type DocumentAuthorityOptions = {
    transport: DocumentAuthorityTransport
    organizationId: string
    workspaceId: string
    assetId: string
    role: AssetDocumentRole
    baseVersion?: number
    receiveOnly?: boolean
    getView: () => EditorView | null
    onRemoteDocumentChange?: (doc: object) => void
    onLeaseStateChange?: (state: DocumentLeaseState) => void
}

type PendingLocalStep = {
    msgId: string
    step: Step
    beforeDoc: ProseMirrorNode
}
type LoggedEvent = DocumentAuthorityEvent

const BATCH_DELAY_MS = 100
const MAX_BATCH_SIZE = 50
const DOCUMENT_RESUME_TIMEOUT_MS = 15000
const sharedWorkspaceLeases = new Map<string, {
    leaseId: string
    holderId: string
    references: number
}>()

// Keeps a view in step with the server's copy of an asset document: holds the
// edit lease, sends local steps in batches, applies remote steps and rebases
// pending local ones over them, and resumes after gaps.
export class DocumentAuthority {
    private readonly clientId = crypto.randomUUID()
    private readonly pendingLocalSteps: PendingLocalStep[] = []
    private readonly pendingRemoteSteps = new Map<number, LoggedEvent & { kind: 'STEP' }>()
    private localVersion: number
    private localStreamSeq = 0
    private leaseId: string | null = null
    private leaseRenewalTimer: ReturnType<typeof setInterval> | null = null
    private submitTimer: ReturnType<typeof setTimeout> | null = null
    private subscription: { unsubscribe: () => void } | null = null
    private applyingAuthorityStep = false
    private submitting = false
    private resumeInProgress = false
    private resumeRequested = false
    private readonly submissionWaiters: Array<() => void> = []
    private disconnected = false
    private sharedLeaseKey: string | null = null

    constructor(private readonly options: DocumentAuthorityOptions) {
        this.localVersion = options.baseVersion ?? 0
        void this.connect()
    }

    submitLocalTransaction(transaction: Transaction): void {
        if (
            this.options.receiveOnly
            || !this.leaseId
            || this.applyingAuthorityStep
        )
            return

        if (
            !transaction.docChanged
            || transaction.getMeta(DOCUMENT_REPLACE_META)
        )
            return

        transaction.steps.forEach(
            (step, index) =>
                this.pendingLocalSteps.push({
                    msgId: `asset-pm-${this.clientId}-${crypto.randomUUID()}`,
                    step,
                    beforeDoc: transaction.docs[index] as ProseMirrorNode,
                }),
        )
        this.scheduleSubmit()
    }

    async flushPendingSteps(): Promise<void> {
        while (
            this.pendingLocalSteps.length > 0
            || this.submitting
        ) {
            if (this.submitTimer) {
                clearTimeout(this.submitTimer)
                this.submitTimer = null
            }

            if (this.submitting) {
                await new Promise<void>(resolve => this.submissionWaiters.push(resolve))

                continue
            }

            if (!this.leaseId)
                throw new Error('ASSET_DOCUMENT_LEASE_UNAVAILABLE')

            await this.submitPending()
        }
    }

    disconnect(): void {
        this.disconnected = true
        this.subscription?.unsubscribe()
        this.subscription = null

        if (this.submitTimer)
            clearTimeout(this.submitTimer)

        if (this.leaseRenewalTimer)
            clearInterval(this.leaseRenewalTimer)

        const leaseId = this.leaseId
        this.leaseId = null
        const sharedLease = this.sharedLeaseKey ? sharedWorkspaceLeases.get(this.sharedLeaseKey) : undefined

        if (
            leaseId
            && sharedLease?.leaseId === leaseId
        ) {
            sharedLease.references -= 1

            if (sharedLease.references === 0) {
                sharedWorkspaceLeases.delete(this.sharedLeaseKey!)
                void this.options.transport.releaseLease(
                    this.options.assetId,
                    this.options.workspaceId,
                    leaseId,
                    sharedLease.holderId,
                )
            }
        } else if (leaseId)
            void this.options.transport.releaseLease(
                this.options.assetId,
                this.options.workspaceId,
                leaseId,
                this.clientId,
            )

        this.sharedLeaseKey = null
    }

    private async connect(): Promise<void> {
        if (
            !this.options.transport.isReady()
            || this.disconnected
        )
            return

        if (!this.options.receiveOnly)
            await this.acquireLease()

        if (this.disconnected)
            return

        const userId = this.options.transport.userId()

        if (!userId)
            throw new Error('USER_ID_REQUIRED')

        const subject = getAssetDocumentEventSubject(
            userId,
            {
                organizationId: this.options.organizationId,
                assetId: this.options.assetId,
                role: this.options.role,
            },
        )
        this.subscription = this.options.transport.subscribe(subject, event => this.handleEvent(event))
        await this.resume()
    }

    private async acquireLease(): Promise<void> {
        if (this.disconnected)
            return

        const leaseKey = `${this.options.workspaceId}#${this.options.assetId}`
        const sharedLease = sharedWorkspaceLeases.get(leaseKey)

        if (sharedLease) {
            sharedLease.references += 1
            this.sharedLeaseKey = leaseKey
            this.leaseId = sharedLease.leaseId
            this.notifyLeaseState({ readOnly: false })
            this.leaseRenewalTimer = setInterval(() => void this.renewLease(), 10000)

            return
        }

        const result = await this.options.transport.acquireLease(
            this.options.assetId,
            this.options.workspaceId,
            this.clientId,
        )

        if (this.disconnected) {
            if (
                result
                && !('error' in result)
            )
                await this.releaseLeaseSilently(result.leaseId, this.clientId)

            return
        }

        if (
            !result
            || 'error' in result
        ) {
            const concurrentlyAcquired = sharedWorkspaceLeases.get(leaseKey)

            if (concurrentlyAcquired) {
                concurrentlyAcquired.references += 1
                this.sharedLeaseKey = leaseKey
                this.leaseId = concurrentlyAcquired.leaseId
                this.notifyLeaseState({ readOnly: false })
                this.leaseRenewalTimer = setInterval(() => void this.renewLease(), 10000)

                return
            }

            const lease = await this.options.transport.readEditLease(this.options.assetId, this.options.workspaceId)

            if (this.disconnected)
                return

            this.notifyLeaseState({
                readOnly: true,
                holderWorkspaceId: lease?.workspaceId,
                expiresAt: lease?.expiresAt,
            })

            return
        }

        const concurrentlyAcquired = sharedWorkspaceLeases.get(leaseKey)

        if (concurrentlyAcquired) {
            concurrentlyAcquired.references += 1
            this.sharedLeaseKey = leaseKey
            this.leaseId = concurrentlyAcquired.leaseId
            await this.releaseLeaseSilently(result.leaseId, this.clientId)

            if (this.disconnected)
                return

            this.notifyLeaseState({ readOnly: false })
            this.leaseRenewalTimer = setInterval(() => void this.renewLease(), 10000)

            return
        }

        sharedWorkspaceLeases.set(
            leaseKey,
            {
                leaseId: result.leaseId,
                holderId: this.clientId,
                references: 1,
            },
        )
        this.sharedLeaseKey = leaseKey
        this.leaseId = result.leaseId
        this.notifyLeaseState({ readOnly: false })
        this.leaseRenewalTimer = setInterval(() => void this.renewLease(), 10000)
    }

    private async renewLease(): Promise<void> {
        if (
            !this.leaseId
            || this.disconnected
        )
            return

        const holderId = this.sharedLeaseKey
            ? sharedWorkspaceLeases.get(this.sharedLeaseKey)?.holderId ?? this.clientId
            : this.clientId
        const result = await this.options.transport.renewLease(
            this.options.assetId,
            this.options.workspaceId,
            this.leaseId,
            holderId,
        )

        if (
            result
            && 'error' in result
        ) {
            if (this.sharedLeaseKey)
                sharedWorkspaceLeases.delete(this.sharedLeaseKey)

            this.sharedLeaseKey = null
            this.leaseId = null

            if (this.leaseRenewalTimer)
                clearInterval(this.leaseRenewalTimer)

            this.notifyLeaseState({ readOnly: true })
        }
    }

    private notifyLeaseState(state: {
        readOnly: boolean
        holderWorkspaceId?: string
        expiresAt?: number
    }): void {
        if (this.disconnected)
            return

        this.options.onLeaseStateChange?.(state)
    }

    private async releaseLeaseSilently(
        leaseId: string,
        holderId: string,
    ): Promise<void> {
        try {
            await this.options.transport.releaseLease(
                this.options.assetId,
                this.options.workspaceId,
                leaseId,
                holderId,
            )
        } catch {
            // Lease release is best-effort during an interrupted connection attempt.
        }
    }

    private async resume(): Promise<void> {
        if (this.resumeInProgress) {
            this.resumeRequested = true

            return
        }

        this.resumeInProgress = true

        try {
            let hasMore = true

            while (
                hasMore
                && !this.disconnected
            ) {
                const acceptSnapshot = this.pendingLocalSteps.length === 0
                const result = await this.options.transport.resume(
                    {
                        organizationId: this.options.organizationId,
                        workspaceId: this.options.workspaceId,
                        assetId: this.options.assetId,
                        role: this.options.role,
                        localVersion: this.localVersion,
                        localStreamSeq: this.localStreamSeq,
                        acceptSnapshot,
                        activateLiveRelay: true,
                    },
                    DOCUMENT_RESUME_TIMEOUT_MS,
                )

                if (result.error)
                    throw new Error(result.error)

                const userId = this.options.transport.userId()
                const expectedLiveSubject = getAssetDocumentEventSubject(
                    userId,
                    {
                        organizationId: this.options.organizationId,
                        assetId: this.options.assetId,
                        role: this.options.role,
                    },
                )

                if (result.liveSubject !== expectedLiveSubject)
                    throw new Error('ASSET_DOCUMENT_LIVE_SUBJECT_MISMATCH')

                if (
                    result.snapshot
                    && result.snapshot.version > this.localVersion
                    && acceptSnapshot
                ) {
                    const snapshot = await this.options.transport.fetchSnapshot(result.snapshot)

                    if (
                        snapshot.version > this.localVersion
                        && this.pendingLocalSteps.length === 0
                    )
                        this.applySnapshot(snapshot.doc, snapshot.version)
                }

                for (const event of result.events ?? [])
                    this.handleEvent(event)

                this.localStreamSeq = Math.max(this.localStreamSeq, result.currentStreamSeq ?? 0)
                hasMore = result.hasMore === true
            }
        } finally {
            this.resumeInProgress = false

            if (
                this.resumeRequested
                && !this.disconnected
            ) {
                this.resumeRequested = false
                await this.resume()
            }
        }
    }

    private handleEvent(event: LoggedEvent): void {
        if (
            event.organizationId !== this.options.organizationId
            || event.assetId !== this.options.assetId
            || event.role !== this.options.role
        )
            return

        const streamSequence = event.streamSequence ?? 0

        if (
            event.kind !== 'STEP'
            || event.version <= this.localVersion
        ) {
            this.localStreamSeq = Math.max(this.localStreamSeq, streamSequence)

            return
        }

        if (event.version > this.localVersion + 1) {
            this.pendingRemoteSteps.set(event.version, event)
            void this.resume()

            return
        }

        if (event.clientId === this.clientId)
            this.localVersion = event.version
        else if (!this.applyRemoteStep(event)) {
            void this.resume()

            return
        } else
            this.localVersion = event.version

        this.localStreamSeq = Math.max(this.localStreamSeq, streamSequence)
        this.drainRemoteSteps()
    }

    private applySnapshot(
        docJson: object,
        version: number,
    ): void {
        const view = this.options.getView()

        if (!view)
            return

        const doc = view.state.schema.nodeFromJSON(docJson)
        const transaction = view.state.tr.replaceWith(
            0,
            view.state.doc.content.size,
            doc.content,
        )
        transaction.setMeta(DOCUMENT_REPLACE_META, true)
        transaction.setMeta(DOCUMENT_AUTHORITY_REMOTE_META, true)
        this.dispatch(transaction)
        this.localVersion = version
        this.pendingLocalSteps.length = 0
    }

    private applyRemoteStep(event: LoggedEvent & { kind: 'STEP' }): boolean {
        const view = this.options.getView()

        if (!view)
            return false

        try {
            const remoteStep = Step.fromJSON(view.state.schema, event.step)
            let transaction = view.state.tr

            if (this.pendingLocalSteps.length > 0) {
                for (let index = this.pendingLocalSteps.length - 1; index >= 0; index -= 1) {
                    const pending = this.pendingLocalSteps[index]!
                    transaction = transaction.step(
                        pending.step.invert(pending.beforeDoc),
                    )
                }

                transaction = transaction.step(remoteStep)
                const mapping = new Mapping([remoteStep.getMap()])
                const rebased: PendingLocalStep[] = []

                for (const pending of this.pendingLocalSteps) {
                    const mapped = pending.step.map(mapping)

                    if (!mapped)
                        continue

                    const beforeDoc = transaction.doc
                    transaction = transaction.step(mapped)
                    mapping.appendMap(
                        mapped.getMap(),
                    )
                    rebased.push({
                        ...pending,
                        step: mapped,
                        beforeDoc,
                    })
                }

                this.pendingLocalSteps.splice(
                    0,
                    this.pendingLocalSteps.length,
                    ...rebased,
                )
            } else
                transaction = transaction.step(remoteStep)

            const selection = view.state.selection

            if (
                selection instanceof TextSelection
                && !selection.empty
            ) {
                const forward = selection.anchor < selection.head
                transaction.setSelection(
                    TextSelection.between(
                        transaction.doc.resolve(
                            transaction.mapping.map(selection.anchor, forward ? 1 : -1),
                        ),
                        transaction.doc.resolve(
                            transaction.mapping.map(selection.head, forward ? -1 : 1),
                        ),
                    ),
                )
            }

            transaction.setMeta(DOCUMENT_REPLACE_META, true)
            transaction.setMeta(DOCUMENT_AUTHORITY_REMOTE_META, true)
            this.dispatch(transaction)

            return true
        } catch {
            return false
        }
    }

    private dispatch(transaction: Transaction): void {
        const view = this.options.getView()

        if (!view)
            return

        this.applyingAuthorityStep = true
        view.dispatch(transaction)
        this.applyingAuthorityStep = false
        this.options.onRemoteDocumentChange?.(
            view.state.doc.toJSON(),
        )
    }

    private drainRemoteSteps(): void {
        while (true) {
            const event = this.pendingRemoteSteps.get(this.localVersion + 1)

            if (!event)
                return

            this.pendingRemoteSteps.delete(event.version)
            this.handleEvent(event)
        }
    }

    private scheduleSubmit(): void {
        if (
            this.submitting
            || this.submitTimer
        )
            return

        this.submitTimer = setTimeout(
            async () => {
                this.submitTimer = null

                try {
                    await this.submitPending()
                } catch (error) {
                    console.error('Asset document step submission failed:', error)
                }
            },
            this.pendingLocalSteps.length >= MAX_BATCH_SIZE ? 0 : BATCH_DELAY_MS,
        )
    }

    private async submitPending(): Promise<void> {
        if (
            !this.leaseId
            || this.submitting
        )
            return

        this.submitting = true

        try {
            while (
                this.pendingLocalSteps.length > 0
                && this.leaseId
            ) {
                const batch = this.pendingLocalSteps.slice(0, MAX_BATCH_SIZE)
                const sharedLease = this.sharedLeaseKey ? sharedWorkspaceLeases.get(this.sharedLeaseKey) : undefined
                const holderId = sharedLease?.leaseId === this.leaseId ? sharedLease.holderId : this.clientId
                const result = await this.options.transport.submitSteps({
                    organizationId: this.options.organizationId,
                    assetId: this.options.assetId,
                    role: this.options.role,
                    workspaceId: this.options.workspaceId,
                    leaseId: this.leaseId,
                    holderId,
                    baseVersion: this.localVersion,
                    expectedVersion: this.localVersion,
                    steps: batch.map(
                        pending => ({
                            step: pending.step.toJSON(),
                            msgId: pending.msgId,
                            clientId: this.clientId,
                        }),
                    ),
                })

                if (result.error)
                    throw new Error(result.error)

                if (result.status === 'CONFLICT') {
                    await this.resume()

                    continue
                }

                this.localVersion = Math.max(this.localVersion, result.version)
                this.pendingLocalSteps.splice(0, batch.length)
            }
        } finally {
            this.submitting = false

            for (const resolve of this.submissionWaiters.splice(0))
                resolve()

            if (this.pendingLocalSteps.length > 0)
                this.scheduleSubmit()
        }
    }
}
