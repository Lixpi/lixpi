import {
    type AgentOperation,
    type ConversationSourceSnapshot,
} from '@lixpi/constants'
import {
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type MeasuredUsage,
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import {
    type ConversationOwner,
} from './conversation-owner.ts'
import {
    type ConversationRepository,
} from './conversation-repository.ts'
import {
    type AgentPayload,
} from './agent-payload-store.ts'

export type AgentOperationRecord = AgentOperation & {
    providerModelVersion: string
    revision: number
    request: AgentPayload
    response?: AgentPayload
    outputSources: Record<string, ConversationSourceSnapshot>
    usage?: MeasuredUsage
}

export class AgentOperations {
    constructor(
        private readonly owner: ConversationOwner,
        private readonly repository: ConversationRepository,
        private readonly metrics: ProviderUsageClient,
    ) {}

    async get(operationId: string): Promise<AgentOperationRecord | undefined> {
        return await this.repository.read<AgentOperationRecord>(this.owner.partition, `OPERATION#${operationId}`)
    }

    async prepare(
        record: AgentOperationRecord,
        operations: TransactOperation[],
    ): Promise<AgentOperationRecord> {
        const existing = await this.get(record.operationId)

        if (existing) {
            if (
                existing.inputHash !== record.inputHash
                || existing.runId !== record.runId
                || existing.continuationEpoch !== record.continuationEpoch
            )
                throw new Error('AGENT_OPERATION_IDEMPOTENCY_CONFLICT')

            if (
                !existing.providerModelVersion
                && existing.state === 'prepared'
            )
                return await this.update(existing, { providerModelVersion: record.providerModelVersion })

            return existing
        }

        await this.repository.commit([...(await this.owner.fences(record.continuationEpoch)), this.repository.put(
            this.owner.partition,
            `OPERATION#${record.operationId}`,
            record,
        ), ...operations])

        return record
    }

    async update(
        record: AgentOperationRecord,
        patch: Partial<AgentOperationRecord>,
        operations: TransactOperation[] = [],
        requireContinuation = true,
    ): Promise<AgentOperationRecord> {
        const next = {
            ...record,
            ...patch,
            revision: record.revision + 1,
            updatedAt: Date.now(),
        }
        await this.repository.commit([
            ...await this.owner.fences(requireContinuation ? record.continuationEpoch : undefined),
            this.repository.put(
                this.owner.partition,
                `OPERATION#${record.operationId}`,
                next,
                record.revision,
            ), ...operations,
        ])
        const {
            revision: _revision,
            request: _request,
            response: _response,
            outputSources: _outputSources,
            usage: _usage,
            providerModelVersion: _providerModelVersion,
            ...status
        } = next
        await this.owner.event('operation.status', status)

        return next
    }

    async authorize(record: AgentOperationRecord): Promise<AgentOperationRecord> {
        if (record.state !== 'prepared')
            return record

        if (!record.providerModelVersion)
            throw new Error('AGENT_OPERATION_PROVIDER_MODEL_REQUIRED')

        const result = await this.metrics.authorizeRequest({
            orgId: this.owner.job.organizationId,
            userId: this.owner.job.userId,
            workspaceId: this.owner.job.workspaceId,
            workflowId: record.operationId,
            model: record.providerModelVersion,
            modality: 'image',
            estimatedUnits: 1,
        })

        if (
            !result.authorized
            || (this.metrics.enabled && !result.authorizationId)
        )
            throw new Error('AGENT_OPERATION_NOT_AUTHORIZED')

        return await this.update(
            record,
            {
                state: 'authorized',
                ...(result.authorizationId ? { authorizationId: result.authorizationId } : {}),
            },
        )
    }

    async settle(record: AgentOperationRecord): Promise<void> {
        if (
            !record.authorizationId
            || !record.usage
            || !record.providerModelVersion
        )
            return

        const identity = {
            orgId: this.owner.job.organizationId,
            userId: this.owner.job.userId,
            workspaceId: this.owner.job.workspaceId,
            workflowId: record.operationId,
            authorizationId: record.authorizationId,
        }
        const providerRequestId = record.providerRequestId ?? `agent-operation:${record.operationId}`
        await this.metrics.recordUsage({
            ...identity,
            providerRequestId,
            workflowSeq: 1,
            model: record.providerModelVersion,
            modality: 'image',
            measuringUnit: 'images',
            usage: record.usage,
            occurredAt: new Date(record.createdAt).toISOString(),
        })
        await this.metrics.completeRequest({
            ...identity,
            providerRequestIds: [providerRequestId],
        })
    }
}
