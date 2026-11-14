import {
    type MeasuredUsage,
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import { AccountRequestContext } from '../../services/account-request-context.ts'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import { conversationPayloadHash } from './conversation-protocol.ts'
import {
    type AgentPayload,
    type AgentPayloadPort,
} from './agent-payload-store.ts'

type ModelCall = {
    callId: string
    runId?: string
    invocationId?: string
    revision: number
    inputHash: string
    modelId: string
    state: 'prepared' | 'authorized' | 'submitted' | 'completed' | 'failed' | 'unknown'
    authorizationId?: string
    providerRequestId?: string
    usage?: MeasuredUsage
    response?: AgentPayload
    error?: string
    occurredAt: string
}

export type AgentModelCallInput<T> = {
    invocationId?: string
    requestKey: string
    modelId: string
    estimatedUnits: number
    invoke: (observe: (
        usage: MeasuredUsage,
        providerRequestId: string,
    ) => void) => Promise<T>
}

// The call receipt precedes the network request. A submitted call without a
// recorded response is ambiguous and must never be paid for a second time.
export class AgentModelCalls {
    constructor(
        private readonly owner: ConversationOwner,
        private readonly repository: ConversationRepository,
        private readonly payloads: AgentPayloadPort,
        private readonly metrics: ProviderUsageClient,
        private readonly continuationEpoch: number,
    ) {}

    async execute<T>(input: AgentModelCallInput<T>): Promise<T> {
        const meta = await this.owner.read()

        if (!meta.run)
            throw new Error('CONVERSATION_RUN_REQUIRED')

        const inputHash = conversationPayloadHash({
            runId: meta.run.runId,
            instructionRevision: meta.run.instructionRevision,
            ...(input.invocationId ? { invocationId: input.invocationId } : {}),
            requestKey: input.requestKey,
            modelId: input.modelId,
        })
        const callId = `agent-${inputHash}`
        const sk = `MODEL#${callId}`
        let receipt = await this.repository.read<ModelCall>(this.owner.partition, sk)

        if (receipt?.response) {
            await this.settle(receipt)

            return JSON.parse(
                Buffer.from(await this.payloads.read(receipt.response)).toString('utf8'),
            ) as T
        }

        if (
            receipt
            && ['submitted', 'unknown'].includes(receipt.state)
        ) {
            await this.settle(receipt)

            throw new Error('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')
        }

        if (receipt?.state === 'failed') {
            await this.settle(receipt)

            throw new Error(receipt.error ?? 'AGENT_MODEL_CALL_FAILED')
        }

        await this.assertNoUncertainCall(meta.run.runId, input.invocationId)

        if (!receipt) {
            await this.owner.consumeBudget('modelCalls', this.continuationEpoch)
            receipt = {
                callId,
                runId: meta.run.runId,
                ...(input.invocationId ? { invocationId: input.invocationId } : {}),
                inputHash,
                modelId: input.modelId,
                revision: 1,
                state: 'prepared',
                occurredAt: new Date().toISOString(),
            }
            await this.repository.commit([
                ...await this.owner.fences(this.continuationEpoch),
                this.repository.put(
                    this.owner.partition,
                    sk,
                    receipt,
                ),
            ])
        }

        let usage: MeasuredUsage | undefined
        let providerRequestId: string | undefined
        let authorizationId = receipt.authorizationId
        let authorizationError: string | undefined
        let invokeStarted = false
        let nonSubmissionRecorded = false
        const settle = AccountRequestContext.prepareCleanup(async () => {
            if (
                usage
                && (invokeStarted || nonSubmissionRecorded)
            )
                await this.settle({
                    ...receipt!,
                    ...(authorizationId ? { authorizationId } : {}),
                    usage,
                    providerRequestId: providerRequestId ?? `agent:${callId}`,
                })
        })

        try {
            if (receipt.state === 'prepared') {
                const authorization = await this.metrics.authorizeRequest({
                    orgId: this.owner.job.organizationId,
                    userId: this.owner.job.userId,
                    workspaceId: this.owner.job.workspaceId,
                    workflowId: callId,
                    model: input.modelId,
                    modality: 'tokens',
                    estimatedUnits: input.estimatedUnits,
                })

                if (!authorization.authorized)
                    authorizationError = authorization.reason === 'authorization_unavailable'
                        ? 'AGENT_MODEL_AUTHORIZATION_UNAVAILABLE'
                        : authorization.reason === 'invalid_request'
                            ? 'AGENT_MODEL_AUTHORIZATION_INVALID_REQUEST'
                            : 'AGENT_MODEL_CALL_NOT_AUTHORIZED'
                else if (
                    this.metrics.enabled
                    && !authorization.authorizationId
                )
                    authorizationError = 'AGENT_MODEL_AUTHORIZATION_UNAVAILABLE'

                if (authorizationError)
                    throw new Error(authorizationError)

                authorizationId = authorization.authorizationId
                receipt = await this.update(
                    receipt,
                    {
                        state: 'authorized',
                        ...(authorizationId ? { authorizationId } : {}),
                    },
                )
            }

            await this.owner.fences(this.continuationEpoch)
            AccountRequestContext.assertActive()
            receipt = await this.update(receipt, { state: 'submitted' })
            // Check again after authorization, immediately before submission.
            await this.owner.fences(this.continuationEpoch)
            AccountRequestContext.assertActive()
            invokeStarted = true
            const result = await input.invoke((observed, requestId) => {
                usage = observed
                providerRequestId = requestId
            })
            const prepared = await this.payloads.prepare(
                'json',
                Buffer.from(
                    JSON.stringify(result),
                ),
                sk,
            )
            receipt = await this.update(
                receipt,
                {
                    state: 'completed',
                    response: prepared.payload,
                    ...(usage ? { usage } : {}),
                    ...(providerRequestId ? { providerRequestId } : {}),
                },
                prepared.operations,
            )

            return result
        } catch (error) {
            const status = (error as { status?: number })?.status
            const knownRejection = Boolean(status && [400, 401, 403, 404, 413, 422, 429].includes(status))
            const notSubmitted = !invokeStarted

            if (
                knownRejection
                || notSubmitted
            )
                usage = {
                    promptTokens: 0,
                    completionTokens: 0,
                }

            try {
                if (notSubmitted) {
                    // A lost storage acknowledgement may have committed the
                    // authorization or submission marker. Read its revision
                    // before fencing a definitive non-submission receipt.
                    const latest = await this.repository.read<ModelCall>(this.owner.partition, sk)

                    if (latest)
                        receipt = latest
                }

                receipt = await this.update(
                    receipt,
                    {
                        state: knownRejection
                            || notSubmitted
                            ? 'failed'
                            : 'unknown',
                        error: authorizationError ?? (notSubmitted
                            ? 'AGENT_MODEL_CALL_NOT_SUBMITTED'
                            : knownRejection
                                ? 'AGENT_MODEL_REQUEST_REJECTED'
                                : 'AGENT_MODEL_CALL_OUTCOME_UNKNOWN'),
                        ...(authorizationId ? { authorizationId } : {}),
                        ...(usage ? { usage } : {}),
                        ...(providerRequestId ? { providerRequestId } : {}),
                    },
                )
                nonSubmissionRecorded = notSubmitted
            } catch {
                // An expired owner cannot write a response, but measured usage
                // still goes to the durable usage outbox through cleanup scope.
                if (notSubmitted) {
                    const latest = await this.repository.read<ModelCall>(this.owner.partition, sk)
                    nonSubmissionRecorded = latest?.state === 'failed' && latest.error === 'AGENT_MODEL_CALL_NOT_SUBMITTED'

                    if (
                        nonSubmissionRecorded
                        && latest
                    )
                        receipt = latest
                }
            }

            throw error
        } finally {
            await settle()
        }
    }

    // A changed prompt has a different request hash. It cannot turn an uncertain
    // submission into a new paid attempt. Separate experts have independent serial
    // model loops, so an active call in another invocation does not block this one.
    private async assertNoUncertainCall(
        runId: string,
        invocationId: string | undefined,
    ): Promise<void> {
        let after: string | undefined

        do {
            const page = await this.repository.query<ModelCall>(
                this.owner.partition,
                'MODEL#',
                {
                    after,
                    limit: 100,
                },
            )

            for (const receipt of page.items) {
                if (
                    receipt.runId !== runId
                    || receipt.invocationId !== invocationId
                    || !['submitted', 'unknown'].includes(receipt.state)
                )
                    continue

                await this.settle(receipt)

                throw new Error('AGENT_MODEL_CALL_OUTCOME_UNKNOWN')
            }

            after = page.cursor
        } while (after)
    }

    private async update(
        receipt: ModelCall,
        patch: Partial<ModelCall>,
        extra: Parameters<ConversationRepository['commit']>[0] = [],
    ): Promise<ModelCall> {
        const next = {
            ...receipt,
            ...patch,
            revision: receipt.revision + 1,
        }
        await this.repository.commit([
            ...await this.owner.fences(),
            this.repository.put(
                this.owner.partition,
                `MODEL#${receipt.callId}`,
                next,
                receipt.revision,
            ),
            ...extra,
        ])

        return next
    }

    private async settle(receipt: ModelCall): Promise<void> {
        if (
            !receipt.authorizationId
            || !receipt.usage
        )
            return

        const providerRequestId = receipt.providerRequestId ?? `agent:${receipt.callId}`
        const identity = {
            orgId: this.owner.job.organizationId,
            userId: this.owner.job.userId,
            workspaceId: this.owner.job.workspaceId,
            authorizationId: receipt.authorizationId,
            workflowId: receipt.callId,
        }
        await this.metrics.recordUsage({
            ...identity,
            providerRequestId,
            workflowSeq: 1,
            model: receipt.modelId,
            modality: 'tokens',
            measuringUnit: 'tokens',
            usage: receipt.usage,
            occurredAt: receipt.occurredAt,
        })
        await this.metrics.completeRequest({
            ...identity,
            providerRequestIds: [providerRequestId],
        })
    }
}
