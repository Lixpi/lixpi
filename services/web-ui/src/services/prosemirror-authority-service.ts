import { v4 as uuidv4 } from 'uuid'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    Mapping,
    Step,
    getDocumentStepSubject,
    type DocResumeResult,
    type LoggedStepStreamEvent,
    type ProseMirrorDocType,
    type StepEnvelope,
    type StepStreamEvent,
    type SubmitResult,
} from '@lixpi/prosemirror'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'

type ProseMirrorAuthorityServiceOptions = {
    workspaceId: string
    docType: ProseMirrorDocType
    docId: string
    baseVersion?: number
    receiveOnly?: boolean
    getView: () => EditorView | null
    onRemoteDocumentChange?: (doc: object) => void
    onReceivingChange?: (receiving: boolean, event: StepStreamEvent) => void
}

type PendingLocalStep = {
    msgId: string
    step: Step
    beforeDoc: ProseMirrorNode
}

type EndStreamEvent = Extract<StepStreamEvent, { kind: 'END' }>

function getStreamSequence(event: StepStreamEvent): number | null {
    const streamSequence = (event as Partial<LoggedStepStreamEvent>).streamSequence
    return typeof streamSequence === 'number' ? streamSequence : null
}

function getReasoningRunKey(event: StepStreamEvent): string {
    return event.generationRun?.reasoningRunId || event.docId
}

function shouldApplySnapshot(result: DocResumeResult, localVersion: number): boolean {
    return Boolean(result.snapshot && result.snapshot.version > localVersion)
}

export class ProseMirrorAuthorityService {
    private readonly clientId = uuidv4()
    private readonly pendingLocalSteps: PendingLocalStep[] = []
    private readonly pendingRemoteStepEvents: Map<number, StepEnvelope> = new Map()
    private readonly pendingEndEvents: Map<number, EndStreamEvent> = new Map()
    private readonly acknowledgedLocalMessageIds: Set<string> = new Set()
    private readonly subject: string
    private localVersion: number
    private disconnected = false
    private applyingAuthorityStep = false
    private submitting = false
    private resumeInFlight = false
    private localStreamSeq = 0
    private drainingPendingRemoteEvents = false
    private subscription: { unsubscribe: () => void } | null = null

    constructor(private readonly options: ProseMirrorAuthorityServiceOptions) {
        this.localVersion = options.baseVersion ?? 0
        this.subject = getDocumentStepSubject({
            workspaceId: options.workspaceId,
            docType: options.docType,
            docId: options.docId,
        })
        this.connect()
    }

    submitLocalTransaction(transaction: Transaction): void {
        if (this.options.receiveOnly || this.applyingAuthorityStep) return
        if (!transaction.docChanged || transaction.getMeta('skipDispatch')) return

        transaction.steps.forEach((step, index) => {
            this.pendingLocalSteps.push({
                msgId: `pm-client-${this.clientId}-${Date.now().toString(36)}-${index}-${uuidv4()}`,
                step,
                beforeDoc: transaction.docs[index] as ProseMirrorNode,
            })
        })
        this.flushSubmitQueue()
    }

    disconnect(): void {
        this.disconnected = true
        this.subscription?.unsubscribe()
        this.subscription = null
    }

    private connect(): void {
        const nats = servicesStore.getData('nats')
        if (!nats) return

        this.subscription = nats.subscribe(this.subject, (event: StepStreamEvent) => {
            void this.handleStepStreamEvent(event)
        })
        void this.resume()
    }

    private async resume(): Promise<void> {
        if (this.resumeInFlight || this.disconnected) return
        this.resumeInFlight = true
        let needsAnotherResume = false
        try {
            const result = await servicesStore.getData('nats')!.request(
                NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_RESUME,
                {
                    token: await AuthService.getTokenSilently(),
                    workspaceId: this.options.workspaceId,
                    docType: this.options.docType,
                    docId: this.options.docId,
                    baseVersion: this.options.baseVersion ?? 0,
                    localVersion: this.localVersion,
                    localStreamSeq: this.localStreamSeq,
                },
            ) as DocResumeResult & { error?: unknown }

            if (result?.error) {
                console.error('[PROSEMIRROR_AUTHORITY] DOC_RESUME failed:', result.error)
                return
            }

            if (shouldApplySnapshot(result, this.localVersion)) {
                this.applySnapshot(result.snapshot!.doc, result.snapshot!.version)
            }

            const events = result.events ?? []
            for (const event of events) {
                await this.handleStepStreamEvent(event)
            }
            this.drainPendingRemoteEvents()
            needsAnotherResume = (result.currentVersion ?? this.localVersion) > this.localVersion
                || (events.length > 0 && this.localStreamSeq < (result.currentStreamSeq ?? this.localStreamSeq))
            if (!needsAnotherResume) {
                this.localStreamSeq = Math.max(this.localStreamSeq, result.currentStreamSeq ?? this.localStreamSeq)
            }
        } catch (error) {
            console.error('[PROSEMIRROR_AUTHORITY] DOC_RESUME failed:', error)
        } finally {
            this.resumeInFlight = false
        }

        if (needsAnotherResume) {
            this.requestResume()
        }
    }

    private applySnapshot(docJson: object, version: number): void {
        const view = this.options.getView()
        if (!view) return

        try {
            const snapshotDoc = view.state.schema.nodeFromJSON(docJson)
            let transaction = view.state.tr
            transaction = transaction.replaceWith(0, view.state.doc.content.size, snapshotDoc.content)
            transaction.setMeta('skipDispatch', true)
            transaction.setMeta('proseMirrorAuthorityRemote', true)
            this.dispatchAuthorityTransaction(transaction)
            this.localVersion = Math.max(this.localVersion, version)
            this.drainPendingRemoteEvents()
        } catch (error) {
            console.error('[PROSEMIRROR_AUTHORITY] snapshot application failed:', error)
        }
    }

    private async handleStepStreamEvent(event: StepStreamEvent): Promise<void> {
        if (this.disconnected) return
        if (event.workspaceId !== this.options.workspaceId || event.docType !== this.options.docType || event.docId !== this.options.docId) return
        this.localStreamSeq = Math.max(this.localStreamSeq, getStreamSequence(event) ?? this.localStreamSeq)
        if (!this.shouldReceiveEvent(event)) return

        if (event.kind === 'START') {
            this.setReceiving(true, event)
            this.localVersion = Math.max(this.localVersion, event.baseVersion)
            return
        }

        if (event.kind === 'END') {
            if (this.localVersion < event.finalVersion) {
                this.pendingEndEvents.set(event.finalVersion, event)
                this.requestResume()
                return
            }
            this.setReceiving(false, event)
            this.localVersion = Math.max(this.localVersion, event.finalVersion)
            return
        }

        if (event.kind === 'ERROR') {
            this.setReceiving(false, event)
            return
        }

        this.handleRemoteStepEvent(event)
    }

    private handleRemoteStepEvent(event: StepEnvelope): void {
        if (event.version <= this.localVersion) return

        if (event.version > this.localVersion + 1) {
            this.pendingRemoteStepEvents.set(event.version, event)
            this.requestResume()
            return
        }

        if (event.clientId === this.clientId || (event.msgId && this.acknowledgedLocalMessageIds.has(event.msgId))) {
            this.localVersion = event.version
            this.drainPendingRemoteEvents()
            return
        }

        if (!this.applyRemoteStep(event)) {
            this.pendingRemoteStepEvents.set(event.version, event)
            this.requestResume()
            return
        }

        this.localVersion = event.version
        this.drainPendingRemoteEvents()
    }

    private shouldReceiveEvent(event: StepStreamEvent): boolean {
        if (event.kind === 'START') return this.localVersion <= event.baseVersion
        if (event.kind === 'END') return this.localVersion < event.finalVersion
        if (event.kind === 'ERROR') return true
        return event.version > this.localVersion
    }

    private setReceiving(receiving: boolean, event: StepStreamEvent): void {
        const view = this.options.getView()
        if (!view || this.options.docType !== DOCUMENT_TYPE.AI_CHAT_THREAD) return
        const transaction = view.state.tr.setMeta('setReceiving', {
            threadId: event.docId,
            receiving,
            runKey: getReasoningRunKey(event),
        })
        this.dispatchAuthorityTransaction(transaction)
        this.options.onReceivingChange?.(receiving, event)
    }

    private applyRemoteStep(event: StepEnvelope): boolean {
        const view = this.options.getView()
        if (!view) return false

        try {
            const remoteStep = Step.fromJSON(view.state.schema, event.step)
            if (this.pendingLocalSteps.length > 0) {
                this.applyRemoteStepWithPendingLocalSteps(remoteStep)
                return true
            }

            const transaction = view.state.tr.step(remoteStep)
            transaction.setMeta('skipDispatch', true)
            transaction.setMeta('proseMirrorAuthorityRemote', true)
            transaction.setMeta('proseMirrorStepVersion', event.version)
            this.dispatchAuthorityTransaction(transaction)
            return true
        } catch (error) {
            console.warn('[PROSEMIRROR_AUTHORITY] Step.fromJSON application failed:', error)
            return false
        }
    }

    private applyRemoteStepWithPendingLocalSteps(remoteStep: Step): void {
        const view = this.options.getView()
        if (!view) return

        let transaction = view.state.tr
        for (let index = this.pendingLocalSteps.length - 1; index >= 0; index -= 1) {
            const pending = this.pendingLocalSteps[index]
            transaction = transaction.step(pending.step.invert(pending.beforeDoc))
        }

        transaction = transaction.step(remoteStep)
        const mapping = new Mapping([remoteStep.getMap()])
        const rebasedPending: PendingLocalStep[] = []

        for (const pending of this.pendingLocalSteps) {
            const mappedStep = pending.step.map(mapping)
            if (!mappedStep) continue
            const beforeDoc = transaction.doc
            transaction = transaction.step(mappedStep)
            mapping.appendMap(mappedStep.getMap())
            rebasedPending.push({
                ...pending,
                step: mappedStep,
                beforeDoc,
            })
        }

        this.pendingLocalSteps.splice(0, this.pendingLocalSteps.length, ...rebasedPending)
        transaction.setMeta('skipDispatch', true)
        transaction.setMeta('proseMirrorAuthorityRemote', true)
        this.dispatchAuthorityTransaction(transaction)
        this.flushSubmitQueue()
    }

    private dispatchAuthorityTransaction(transaction: Transaction): void {
        const view = this.options.getView()
        if (!view) return
        this.applyingAuthorityStep = true
        view.dispatch(transaction)
        this.applyingAuthorityStep = false
        this.options.onRemoteDocumentChange?.(view.state.doc.toJSON())
    }

    private flushSubmitQueue(): void {
        if (this.submitting) return
        this.submitting = true
        void this.runSubmitQueue()
    }

    private async runSubmitQueue(): Promise<void> {
        try {
            while (!this.disconnected && this.pendingLocalSteps.length > 0) {
                const progressed = await this.submitFirstPendingStep()
                if (!progressed) return
            }
        } finally {
            this.submitting = false
        }
    }

    private drainPendingRemoteEvents(): void {
        if (this.drainingPendingRemoteEvents) return
        this.drainingPendingRemoteEvents = true
        try {
            while (true) {
                const nextEvent = this.pendingRemoteStepEvents.get(this.localVersion + 1)
                if (!nextEvent) break
                this.pendingRemoteStepEvents.delete(nextEvent.version)
                this.handleRemoteStepEvent(nextEvent)
            }

            for (const [finalVersion, event] of this.pendingEndEvents) {
                if (finalVersion > this.localVersion) continue
                this.pendingEndEvents.delete(finalVersion)
                this.setReceiving(false, event)
                this.localVersion = Math.max(this.localVersion, finalVersion)
            }
        } finally {
            this.drainingPendingRemoteEvents = false
        }
    }

    private requestResume(): void {
        if (this.resumeInFlight || this.disconnected) return
        void this.resume()
    }

    private async submitFirstPendingStep(): Promise<boolean> {
        const pending = this.pendingLocalSteps[0]
        if (!pending) return false

        let result: SubmitResult & { error?: unknown }
        try {
            result = await servicesStore.getData('nats')!.request(
                NATS_SUBJECTS.DOCUMENT_STEP_SUBJECTS.DOC_SUBMIT_STEP,
                {
                    token: await AuthService.getTokenSilently(),
                    workspaceId: this.options.workspaceId,
                    docType: this.options.docType,
                    docId: this.options.docId,
                    baseVersion: this.options.baseVersion ?? 0,
                    expectedVersion: this.localVersion,
                    step: pending.step.toJSON(),
                    msgId: pending.msgId,
                    clientId: this.clientId,
                },
            ) as SubmitResult & { error?: unknown }
        } catch (error) {
            console.error('[PROSEMIRROR_AUTHORITY] DOC_SUBMIT_STEP failed:', error)
            return false
        }

        if (result?.error) {
            console.error('[PROSEMIRROR_AUTHORITY] DOC_SUBMIT_STEP failed:', result.error)
            return false
        }

        if (result.status === 'CONFLICT') {
            await this.resume()
            return true
        }

        this.localVersion = Math.max(this.localVersion, result.version)
        this.acknowledgedLocalMessageIds.add(pending.msgId)
        this.pendingLocalSteps.shift()
        return true
    }
}
