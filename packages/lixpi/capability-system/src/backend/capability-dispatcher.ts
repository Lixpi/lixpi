'use strict'

import type {
    CapabilityJsonValue,
    CapabilityKind,
    CapabilityMeta,
    CapabilityPromptReference,
    CapabilityReasoningModelVariant,
    CapabilityRun,
    CapabilityRunEvent,
} from '@lixpi/constants'

import { CapabilityActionRegistry } from './capability-action-registry.ts'
import { CapabilityError } from '../shared/capability-errors.ts'
import {
    type CapabilityRequesterContext,
    type CapabilityResolverStore,
    resolveCapabilities,
    type SealedResolvedCapabilityPlan,
} from './capability-resolver.ts'
import {
    CapabilityWorkflowRunner,
    type CapabilityRunPersistence,
    type CapabilityWorkflowRunResult,
} from './capability-workflow-runner.ts'

export type CapabilitySearchRequest = {
    query?: string
    kinds?: CapabilityKind[]
    limit?: number
    cursor?: string
}

export type CapabilitySearchResult = {
    items: CapabilityMeta[]
    cursor?: string
}

export type CapabilityUseRequest = {
    capabilityId: string
    arguments: Readonly<Record<string, CapabilityJsonValue>>
    requester: CapabilityRequesterContext
    origin: 'prompt' | 'model' | 'panel'
    conversationAssetId?: string
    sealedPlan?: SealedResolvedCapabilityPlan
    invocationDepth?: number
    invocationGenerationRequestId?: string
    signal?: AbortSignal
    onRunCreated?: (run: Readonly<CapabilityRun>) => void | Promise<void>
    onEvent?: (event: Readonly<CapabilityRunEvent>) => void | Promise<void>
    variant?: { axis: 'request'; variantKey: 'request' } | CapabilityReasoningModelVariant
}

export type CapabilityDispatcherOptions = {
    store: CapabilityResolverStore
    registry: CapabilityActionRegistry
    createPersistence: (userId: string) => CapabilityRunPersistence
    createEventStreamName: (run: CapabilityRun) => string
    search: (request: CapabilitySearchRequest, requester: CapabilityRequesterContext) => Promise<CapabilitySearchResult>
    createEventHandler?: (
        request: CapabilityUseRequest,
    ) => ((event: Readonly<CapabilityRunEvent>) => void | Promise<void>) | undefined
}

export class CapabilityDispatcher {
    private readonly activeRuns = new Map<string, {
        controller: AbortController
        userId: string
        workspaceId: string
    }>()

    constructor(private readonly options: CapabilityDispatcherOptions) {}

    async search(
        request: CapabilitySearchRequest,
        requester: CapabilityRequesterContext,
    ): Promise<CapabilitySearchResult> {
        return await this.options.search({
            ...request,
            limit: Math.min(20, Math.max(1, request.limit ?? 10)),
        }, requester)
    }

    async use(request: CapabilityUseRequest): Promise<CapabilityWorkflowRunResult> {
        if ((request.invocationDepth ?? 0) > 0) {
            throw new CapabilityError(
                'CAPABILITY_ACTION_NOT_ALLOWED',
                'A Capability Tool run cannot recursively invoke another Capability Tool through a chat turn',
            )
        }
        const plan = request.sealedPlan?.getManifest(request.capabilityId)
            ? request.sealedPlan
            : await this.resolveToolPlan(request.capabilityId, request.requester, request.signal)
        const runner = new CapabilityWorkflowRunner({
            registry: this.options.registry,
            persistence: this.options.createPersistence(request.requester.userId),
            createEventStreamName: this.options.createEventStreamName,
        })
        const eventHandler = request.onEvent ?? this.options.createEventHandler?.(request)
        return await runner.run({
            plan,
            rootCapabilityId: request.capabilityId,
            input: request.arguments,
            userId: request.requester.userId,
            workspaceId: request.requester.workspaceId,
            organizationId: request.requester.organizationId,
            conversationAssetId: request.conversationAssetId,
            origin: request.origin,
            ...(request.invocationGenerationRequestId
                ? { invocationGenerationRequestId: request.invocationGenerationRequestId }
                : {}),
            signal: request.signal,
            onRunCreated: request.onRunCreated,
            onEvent: eventHandler,
            variant: request.variant ?? { axis: 'request', variantKey: 'request' },
        })
    }

    async resolveToolPlan(
        capabilityId: string,
        requester: CapabilityRequesterContext,
        signal?: AbortSignal,
    ): Promise<SealedResolvedCapabilityPlan> {
        return await resolveCapabilities([
            { capabilityId, kind: 'tool' } satisfies CapabilityPromptReference,
        ], {
            store: this.options.store,
            requester,
            allowedActions: this.options.registry.allowedActionKeys(),
            signal,
        })
    }

    async startDetached(request: Omit<CapabilityUseRequest, 'signal' | 'onRunCreated'>): Promise<CapabilityRun> {
        const controller = new AbortController()
        let resolveCreated: (run: CapabilityRun) => void = () => undefined
        let rejectCreated: (error: unknown) => void = () => undefined
        const created = new Promise<CapabilityRun>((resolve, reject) => {
            resolveCreated = resolve
            rejectCreated = reject
        })
        const execution = this.use({
            ...request,
            signal: controller.signal,
            onRunCreated: run => {
                const snapshot = structuredClone(run)
                this.activeRuns.set(run.runId, {
                    controller,
                    userId: request.requester.userId,
                    workspaceId: request.requester.workspaceId,
                })
                resolveCreated(snapshot)
            },
        })
        void this.observeDetachedExecution(execution, controller, rejectCreated)
        return await created
    }

    private async observeDetachedExecution(
        execution: Promise<CapabilityWorkflowRunResult>,
        controller: AbortController,
        rejectCreated: (error: unknown) => void,
    ): Promise<void> {
        try {
            const result = await execution
            this.activeRuns.delete(result.run.runId)
        } catch (error) {
            for (const [runId, active] of this.activeRuns) {
                if (active.controller !== controller) continue
                this.activeRuns.delete(runId)
            }
            rejectCreated(error)
        }
    }

    stopDetached(run: Pick<CapabilityRun, 'runId' | 'workspaceId'>, userId: string): boolean {
        const active = this.activeRuns.get(run.runId)
        if (!active || active.userId !== userId || active.workspaceId !== run.workspaceId) return false
        active.controller.abort(new Error('Capability run stopped by user'))
        return true
    }
}
