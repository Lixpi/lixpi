import { createHash } from 'node:crypto'
import {
    type CapabilityActionAuthorizationContext,
    type MediaPipelineCatalog,
    type MediaPipelineContext,
    type MediaPipelineExecution,
    type MediaPipelineOperationHandler,
    type MediaPipelineOperationReceipt,
    type MediaPipelineOperationRequest,
    type MediaPipelinePorts,
    type MediaPipelineService,
} from '@lixpi/capability-system/backend'
import {
    createMediaPipelineDocument,
    mediaPipelineSharedDefinition,
    type MediaPipeline,
    type MediaPipelineIssue,
    type MediaPipelineSource,
} from '@lixpi/capability-system/shared'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'
import {
    type ConversationTurn,
    type AgentOperation,
} from '@lixpi/constants'
import AssetModel from '../models/asset.ts'
import BlobModel, { buildBlobReferenceBatchOperations } from '../models/blob.ts'
import {
    AgentExecutionScope,
    type AgentExecution,
} from '../llm/agent/agent-execution-scope.ts'
import {
    AgentPayloadStore,
    type AgentPayload,
    type AgentPayloadPort,
} from '../llm/agent/agent-payload-store.ts'
import {
    type AgentIntent,
} from '../llm/agent/agent-harness.ts'
import {
    type ConversationOwner,
} from '../llm/agent/conversation-owner.ts'
import {
    conversationPartition,
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import { ArtifactRevisionStore } from './artifact-revision-store.ts'

type ExecutionRecord = {
    executionId: string
    revision: number
    inputHash: string
    runId: string
    continuationEpoch: number
    state: MediaPipelineExecution['state']
    payload: AgentPayload
    intent: AgentIntent
    createdAssetIds: string[]
}
type CompletionRecord = {
    executionId: string
    notified: boolean
}
type OperationRecord = {
    revision: number
    createdAt?: number
    operationKey: string
    executionId: string
    request: AgentPayload
    receipt: MediaPipelineOperationReceipt
}

export type MediaPipelineAdapterPorts = {
    promptModel?: MediaPipelinePorts['promptModel']
    handlers: () => MediaPipelineOperationHandler[]
    modelRoutes: (context: MediaPipelineContext) => Promise<MediaPipelineCatalog['modelRoutes']>
    onCompleted: (
        context: MediaPipelineContext,
        execution: MediaPipelineExecution,
    ) => Promise<void>
    payloads?: (context: MediaPipelineContext) => AgentPayloadPort
}

const terminal = new Set([
    'succeeded',
    'failed',
    'cancelled',
])
const partition = (context: MediaPipelineContext): string => conversationPartition(context.organizationId, context.conversationAssetId)
const mutationKey = (
    context: MediaPipelineContext,
    mutationId: string,
): string => `PIPELINE_MUTATION#${context.turnId}#${mutationId}`
const executionKey = (executionId: string): string => `PIPELINE#${executionId}`
const operationKey = (operationId: string): string => `PIPELINE_OPERATION#${operationId}`

// The module schedules domain work. This adapter supplies scoped persistence,
// fencing and installed executors without interpreting a plan or its steps.
export class MediaPipelineAdapter {
    private readonly artifacts: ArtifactRevisionStore
    private service?: MediaPipelineService

    constructor(
        private readonly repository: ConversationRepository,
        private readonly infrastructure: MediaPipelineAdapterPorts,
    ) {
        this.artifacts = new ArtifactRevisionStore(repository)
    }

    bind(service: MediaPipelineService): void {
        this.service = service
    }

    resolveContext = (authorization: CapabilityActionAuthorizationContext): MediaPipelineContext | undefined => {
        const scope = AgentExecutionScope.current()
        const { job } = scope.owner

        if (
            authorization.userId !== job.userId
            || authorization.organizationId !== job.organizationId
            || authorization.workspaceId !== job.workspaceId
            || authorization.conversationAssetId !== job.conversationAssetId
        )
            return undefined

        return {
            userId: job.userId,
            organizationId: job.organizationId,
            workspaceId: job.workspaceId,
            conversationAssetId: job.conversationAssetId,
            turnId: scope.turn.turnId,
            responseMessageId: scope.responseMessageId,
            runId: authorization.runId,
            epoch: scope.owner.epoch,
            continuationEpoch: scope.continuationEpoch,
            authority: createHash('sha256').update(
                JSON.stringify([authorization.runId, scope.turn.turnId, scope.continuationEpoch]),
            ).digest('hex'),
        }
    }

    ports(): MediaPipelinePorts {
        return {
            ...(this.infrastructure.promptModel ? { promptModel: this.infrastructure.promptModel } : {}),
            authorize: async input => {
                try {
                    await this.assertContext(input.context)
                    // Source Assets are read, while the pipeline itself is the
                    // mutation target. A new Artifact receives its grant on commit.
                    await AgentExecutionScope.authorize(
                        input.action,
                        input.operationFamilies,
                        input.pipelineId ? [input.pipelineId] : [],
                    )

                    return true
                } catch {
                    return false
                }
            },
            isContinuationCurrent: async context => {
                try { await this.assertContext(context)

                    return true } catch { return false }
            },
            catalog: async context => {
                await this.assertContext(context)
                const modelRoutes = await this.infrastructure.modelRoutes(context)

                return {
                    operations: this.infrastructure.handlers().map(handler => handler.definition),
                    modelRoutes,
                }
            },
            recheckSources: this.recheckSources,
            readArtifact: async (context, pipelineId) => {
                await this.assertContext(context)
                await this.artifacts.authorize(
                    context,
                    pipelineId,
                    false,
                    false,
                )
                const pipeline = await this.artifacts.load<MediaPipeline>(context, pipelineId)

                return pipeline ? {
                    assetId: pipelineId,
                    pipeline,
                } : undefined
            },
            readArtifactMutation: async (context, clientMutationId) => {
                await this.assertContext(context)
                const receipt = await this.repository.read<{
                    inputHash: string
                    assetId: string
                    revision: number
                }>(
                    partition(context),
                    mutationKey(context, clientMutationId),
                )

                if (!receipt)
                    return undefined

                await this.artifacts.authorize(
                    context,
                    receipt.assetId,
                    false,
                    false,
                )
                const pipeline = await this.artifacts.load<MediaPipeline>(
                    context,
                    receipt.assetId,
                    receipt.revision,
                )

                if (!pipeline)
                    throw new Error('PIPELINE_MUTATION_ARTIFACT_MISSING')

                AgentExecutionScope.current().createdAssetIds.add(receipt.assetId)
                await this.publishDraft(
                    context,
                    pipeline,
                    receipt.inputHash,
                    clientMutationId,
                )

                return {
                    inputHash: receipt.inputHash,
                    artifact: {
                        assetId: receipt.assetId,
                        pipeline,
                    },
                }
            },
            commitArtifact: async input => {
                const {
                    context,
                    pipeline,
                } = input
                await this.assertContext(context)
                const committed = await this.artifacts.commit({
                    access: context,
                    assetId: pipeline.pipelineId,
                    title: pipeline.name ?? pipeline.requestedOutcome.slice(0, 160),
                    expectedRevision: input.expectedRevision,
                    revision: pipeline.revision,
                    clientMutationId: input.clientMutationId,
                    value: pipeline,
                    document: createMediaPipelineDocument(pipeline),
                    definition: mediaPipelineSharedDefinition,
                    fences: () => AgentExecutionScope.current().owner.fences(context.continuationEpoch),
                    additionalOperations: [
                        this.repository.put(
                            partition(context),
                            mutationKey(context, input.clientMutationId),
                            {
                                inputHash: input.inputHash,
                                assetId: pipeline.pipelineId,
                                revision: pipeline.revision,
                            },
                        ),
                        ...(input.expectedRevision === 0 ? [this.repository.put(
                            partition(context),
                            `CREATED#${pipeline.pipelineId}`,
                            {
                                assetId: pipeline.pipelineId,
                                runId: context.runId,
                            },
                        )] : []),
                        ...await this.retainSources(context, pipeline),
                    ],
                    retainedBlobs: pipeline.sources.filter(source => source.blobHash).map(
                        source =>
                            ({
                                blobHash: source.blobHash!,
                                referenceKey: `asset#${pipeline.pipelineId}#pipeline#${pipeline.revision}#${source.sourceId}`,
                            }),
                    ),
                })

                if (!committed)
                    throw new Error('PIPELINE_REVISION_CONFLICT')

                AgentExecutionScope.current().createdAssetIds.add(pipeline.pipelineId)
                await this.publishDraft(
                    context,
                    pipeline,
                    input.inputHash,
                    input.clientMutationId,
                )

                return {
                    assetId: pipeline.pipelineId,
                    pipeline,
                }
            },
            createExecution: this.createExecution,
            readExecution: this.readExecution,
            saveExecution: this.saveExecution,
            readOperation: this.readOperation,
            ensureOperation: this.ensureOperation,
            enqueueExecution: async executionId => {
                // createExecution writes the pending index atomically. The
                // conversation dispatch remains durable until this is drained.
                if (!await this.readExecution(executionId))
                    throw new Error('PIPELINE_EXECUTION_NOT_FOUND')
            },
            enqueueContinuation: async () => {},
        }
    }

    async listPending(context: MediaPipelineContext): Promise<string[]> {
        await this.assertContext(context)
        const ids: string[] = []
        let after: string | undefined

        do {
            const page = await this.repository.query<{
                executionId: string
                runId: string
            }>(
                partition(context),
                'PIPELINE_PENDING#',
                { after },
            )
            ids.push(...page.items.filter(item => item.runId === context.runId).map(item => item.executionId))
            after = page.cursor
        } while (after)

        return ids
    }

    async advanceForRun(owner: ConversationOwner): Promise<{
        pending: boolean
        completed: MediaPipelineExecution[]
    }> {
        if (!this.service)
            throw new Error('PIPELINE_MODULE_NOT_BOUND')

        const meta = await owner.read()

        if (!meta.run)
            return {
                pending: false,
                completed: [],
            }

        const turn = await this.repository.read<ConversationTurn>(owner.partition, `TURN#${meta.run.turnId}`)

        if (!turn)
            throw new Error('PIPELINE_TURN_MISSING')

        const records: ExecutionRecord[] = []
        let after: string | undefined

        do {
            const page = await this.repository.query<ExecutionRecord>(
                owner.partition,
                'PIPELINE#',
                { after },
            )
            records.push(...page.items.filter(record => record.runId === meta.run!.runId))
            after = page.cursor
        } while (after)

        let pending = false
        const completed: MediaPipelineExecution[] = []

        for (const record of records) {
            const restored = await this.decode(record, owner)
            const scope: AgentExecution = {
                owner,
                turn,
                intent: record.intent,
                responseMessageId: restored.context.responseMessageId,
                continuationEpoch: record.continuationEpoch,
                createdAssetIds: new Set([
                    ...record.createdAssetIds,
                    ...Object
                        .values(restored.receipts)
                        .filter(receipt => receipt.state === 'succeeded')
                        .flatMap(receipt => Object.values(receipt.outputs).map(output => output.assetId)),
                ]),
                assertReadTarget: async assetId => {
                    if (
                        assetId !== restored.pipeline.pipelineId
                        && !turn.references.some(source => source.assetId === assetId)
                        && !restored.pipeline.sources.some(source => source.assetId === assetId)
                        && !Object.values(restored.receipts).some(
                            receipt => receipt.state === 'succeeded' && Object.values(receipt.outputs).some(source => source.assetId === assetId),
                        )
                    )
                        throw new Error('AGENT_READ_TARGET_NOT_IN_CONTEXT')
                },
            }
            await AgentExecutionScope.run(scope, async () => {
                if (
                    record.continuationEpoch !== meta.run!.continuationEpoch
                    || meta.run!.state === 'stopping'
                ) {
                    await this.cancelRecord(restored)

                    return
                }

                const result = terminal.has(record.state) ? restored : await this.service!.advance(record.executionId)

                if (terminal.has(result.state)) {
                    const notified = await this.notifyCompletion(result.context, result)

                    if (notified)
                        completed.push(result)
                } else
                    pending = true
            })
        }

        return {
            pending,
            completed,
        }
    }

    async cancelForRun(owner: ConversationOwner): Promise<void> {
        const meta = await owner.read()

        if (!meta.run)
            return

        const turn = await this.repository.read<ConversationTurn>(owner.partition, `TURN#${meta.run.turnId}`)

        if (!turn)
            return

        let after: string | undefined

        do {
            const page = await this.repository.query<ExecutionRecord>(
                owner.partition,
                'PIPELINE#',
                { after },
            )

            for (const record of page.items.filter(item => item.runId === meta.run!.runId && !terminal.has(item.state))) {
                const execution = await this.decode(record, owner)
                await AgentExecutionScope.run(
                    {
                        owner,
                        turn,
                        intent: record.intent,
                        responseMessageId: execution.context.responseMessageId,
                        continuationEpoch: record.continuationEpoch,
                        createdAssetIds: new Set(record.createdAssetIds),
                    },
                    async () => this.cancelRecord(execution),
                )
            }

            after = page.cursor
        } while (after)
    }

    async getOperation(
        owner: ConversationOwner,
        operationId: string,
    ): Promise<unknown> {
        await owner.read()
        const record = await this.repository.read<ExecutionRecord>(
            owner.partition,
            executionKey(operationId),
        )

        if (record) {
            const execution = await this.decode(record, owner)

            return {
                operationId,
                kind: 'pipeline',
                state: execution.state,
                pipelineId: execution.pipeline.pipelineId,
                revision: execution.pipeline.revision,
                steps: execution.pipeline.nodes.map(
                    node => ({
                        stepId: node.nodeId,
                        operationKey: node.operationKey,
                        operationId: execution.receipts[node.nodeId]?.operationId,
                        state: execution.receipts[node.nodeId]?.state ?? 'blocked',
                    }),
                ),
                outputs: execution.outputs,
                issues: execution.issues,
            }
        }

        const node = await this.repository.read<OperationRecord>(owner.partition, `PIPELINE_OPERATION#${operationId}`)

        if (node)
            return {
                ...node.receipt,
                kind: 'pipeline-node',
                executionId: node.executionId,
            }

        throw new Error('AGENT_OPERATION_NOT_FOUND')
    }

    async cancelOperation(
        owner: ConversationOwner,
        operationId: string,
    ): Promise<unknown> {
        const scope = await AgentExecutionScope.authorize('execute')

        if (scope.owner !== owner)
            throw new Error('AGENT_OPERATION_SCOPE_MISMATCH')

        const meta = await owner.read()
        const node = await this.repository.read<OperationRecord>(
            owner.partition,
            operationKey(operationId),
        )
        const record = await this.repository.read<ExecutionRecord>(
            owner.partition,
            executionKey(node?.executionId ?? operationId),
        )

        if (
            !record
            || record.runId !== meta.run?.runId
            || record.continuationEpoch !== scope.continuationEpoch
        )
            throw new Error('AGENT_OPERATION_SCOPE_MISMATCH')

        const execution = await this.decode(record, owner)

        if (node) {
            if (!['succeeded', 'failed', 'cancelled', 'outcome-unknown'].includes(node.receipt.state)) {
                const handler = this.infrastructure.handlers().find(candidate => candidate.definition.operationKey === node.operationKey)
                await handler?.cancel?.(execution.context, operationId)
                const receipt = await handler?.read(execution.context, operationId)

                if (receipt)
                    await this.saveOperation(
                        execution.context,
                        node,
                        receipt,
                    )
            }

            return await this.getOperation(owner, operationId)
        }

        if (!terminal.has(execution.state))
            await this.cancelRecord(execution)

        return await this.getOperation(owner, operationId)
    }

    async acknowledgeCompletion(
        owner: ConversationOwner,
        executionId: string,
    ): Promise<void> {
        const record = await this.repository.read<ExecutionRecord>(
            owner.partition,
            executionKey(executionId),
        )
        const meta = await owner.read()

        if (
            !record
            || !terminal.has(record.state)
            || record.runId !== meta.run?.runId
        )
            throw new Error('PIPELINE_COMPLETION_SCOPE_MISMATCH')

        await this.repository.commit([...await owner.fences(record.continuationEpoch), this.repository.replace(
            owner.partition,
            `PIPELINE_COMPLETION#${executionId}`,
            {
                executionId,
                notified: true,
            },
        )])
    }

    private createExecution = async (execution: MediaPipelineExecution): Promise<MediaPipelineExecution> => {
        await this.assertContext(execution.context)
        const existing = await this.readExecution(execution.executionId)

        if (existing) {
            if (existing.inputHash !== execution.inputHash)
                throw new Error('PIPELINE_EXECUTION_IDEMPOTENCY_CONFLICT')

            await this.publishExecution(existing)

            return existing
        }

        const prepared = await this.prepareExecution(execution)
        await this.repository.commit([
            ...await AgentExecutionScope.current().owner.fences(execution.context.continuationEpoch),
            this.repository.put(
                partition(execution.context),
                executionKey(execution.executionId),
                prepared.record,
            ),
            this.repository.put(
                partition(execution.context),
                `PIPELINE_PENDING#${execution.executionId}`,
                {
                    executionId: execution.executionId,
                    runId: execution.context.runId,
                },
            ),
            ...prepared.operations,
        ])
        await this.publishExecution(execution)

        return execution
    }

    private readExecution = async (
        executionId: string,
        allowHistorical = false,
    ): Promise<MediaPipelineExecution | undefined> => {
        const scope = AgentExecutionScope.current()
        const record = await this.repository.read<ExecutionRecord>(
            scope.owner.partition,
            executionKey(executionId),
        )

        if (!record)
            return undefined

        const execution = await this.decode(record, scope.owner)
        const meta = await scope.owner.read()

        if (
            execution.context.runId !== meta.run?.runId
            && !(allowHistorical && terminal.has(execution.state))
        )
            throw new Error('PIPELINE_RUN_MISMATCH')

        return execution
    }

    private saveExecution = async (
        execution: MediaPipelineExecution,
        expectedRevision: number,
    ): Promise<boolean> => {
        const prepared = await this.prepareExecution(execution)
        const previous = await this.repository.read<ExecutionRecord>(
            partition(execution.context),
            executionKey(execution.executionId),
        )

        if (
            !previous
            || previous.revision !== expectedRevision
        )
            return false

        const released = await this.payloads(execution.context).release(
            previous.payload,
            `${executionKey(execution.executionId)}#${previous.revision}`,
        )

        try {
            await this.repository.commit([
                ...await AgentExecutionScope.current().owner.fences(),
                this.repository.put(
                    partition(execution.context),
                    executionKey(execution.executionId),
                    prepared.record,
                    expectedRevision,
                ),
                ...(terminal.has(execution.state) ? [
                    this.repository.remove(
                        partition(execution.context),
                        `PIPELINE_PENDING#${execution.executionId}`,
                    ),
                    this.repository.replace(
                        partition(execution.context),
                        `PIPELINE_COMPLETION#${execution.executionId}`,
                        {
                            executionId: execution.executionId,
                            notified: false,
                        },
                    ),
                ] : []),
                ...prepared.operations,
                ...released.operations,
            ])
            await released.afterCommit()
            await this.publishExecution(execution)

            return true
        } catch (error) {
            if (isTransactionConditionalCheckFailure(error))
                return false

            throw error
        }
    }

    private prepareExecution = async (execution: MediaPipelineExecution): Promise<{
        record: ExecutionRecord
        operations: TransactOperation[]
    }> => {
        const scope = AgentExecutionScope.current()
        const prepared = await this.payloads(execution.context).prepare(
            'json',
            Buffer.from(
                JSON.stringify(execution),
            ),
            `${executionKey(execution.executionId)}#${execution.revision}`,
        )

        return {
            record: {
                executionId: execution.executionId,
                revision: execution.revision,
                inputHash: execution.inputHash,
                runId: execution.context.runId,
                continuationEpoch: execution.context.continuationEpoch,
                state: execution.state,
                payload: prepared.payload,
                intent: scope.intent,
                createdAssetIds: [...scope.createdAssetIds],
            },
            operations: prepared.operations,
        }
    }

    private async decode(
        record: ExecutionRecord,
        owner: ConversationOwner,
    ): Promise<MediaPipelineExecution> {
        const context = {
            organizationId: owner.job.organizationId,
            conversationAssetId: owner.job.conversationAssetId,
        } as MediaPipelineContext
        const execution = JSON.parse(
            Buffer.from(await this.payloads(context).read(record.payload)).toString('utf8'),
        ) as MediaPipelineExecution
        execution.context.epoch = owner.epoch

        return execution
    }

    private readOperation = async (
        context: MediaPipelineContext,
        operationId: string,
    ): Promise<MediaPipelineOperationReceipt | undefined> => {
        await this.assertContext(context)
        const stored = await this.repository.read<OperationRecord>(
            partition(context),
            operationKey(operationId),
        )

        if (!stored)
            return undefined

        if (stored.receipt.state === 'prepared')
            return await this.ensureOperation({
                ...await this.decodeOperation(context, stored),
                context,
            })

        if (['succeeded', 'failed', 'cancelled', 'outcome-unknown'].includes(stored.receipt.state)) {
            this.admitOutputs(stored.receipt)

            return stored.receipt
        }

        const handler = this.infrastructure.handlers().find(item => item.definition.operationKey === stored.operationKey)
        const receipt = await handler?.read(context, operationId)

        if (receipt)
            await this.saveOperation(
                context,
                stored,
                receipt,
            )

        const result = receipt ?? stored.receipt
        this.admitOutputs(result)

        return result
    }

    private ensureOperation = async (request: MediaPipelineOperationRequest): Promise<MediaPipelineOperationReceipt> => {
        await this.assertContext(request.context)
        const handler = this.infrastructure.handlers().find(item => item.definition.operationKey === request.node.operationKey)

        if (!handler)
            throw new Error('PIPELINE_EXECUTOR_UNAVAILABLE')

        let stored = await this.repository.read<OperationRecord>(
            partition(request.context),
            operationKey(request.operationId),
        )

        if (
            stored
            && stored.receipt.inputHash !== request.inputHash
        )
            throw new Error('PIPELINE_OPERATION_IDEMPOTENCY_CONFLICT')

        if (
            stored
            && stored.receipt.state !== 'prepared'
        )
            return (await this.readOperation(request.context, request.operationId)) ?? stored.receipt

        if (!stored) {
            await AgentExecutionScope.current().owner.consumeBudget('toolCalls', request.context.continuationEpoch)
            const prepared = await this.payloads(request.context).prepare(
                'json',
                Buffer.from(
                    JSON.stringify(request),
                ),
                `${operationKey(request.operationId)}#request`,
            )
            stored = {
                revision: 1,
                operationKey: request.node.operationKey,
                executionId: request.executionId,
                createdAt: Date.now(),
                request: prepared.payload,
                receipt: {
                    operationId: request.operationId,
                    inputHash: request.inputHash,
                    state: 'prepared',
                    outputs: {},
                },
            }
            await this.repository.commit([...(await AgentExecutionScope.current().owner.fences(request.context.continuationEpoch)), this.repository.put(
                partition(request.context),
                operationKey(request.operationId),
                stored,
            ), ...prepared.operations,
                ...(handler.definition.execution === 'local' ? [this.repository.put(
                    partition(request.context),
                    `OPERATION#${request.operationId}`,
                    {
                        ...this.publicOperation(
                            request,
                            stored.receipt,
                            stored.createdAt,
                        ),
                        revision: 1,
                    },
                )] : []),
            ])
        }

        await AgentExecutionScope.authorize('execute', [handler.definition.family])
        const receipt = await handler.ensure(request)
        await this.saveOperation(
            request.context,
            stored,
            receipt,
        )

        this.admitOutputs(receipt)

        return receipt
    }

    private admitOutputs(receipt: MediaPipelineOperationReceipt): void {
        if (receipt.state !== 'succeeded')
            return

        for (const output of Object.values(receipt.outputs))
            AgentExecutionScope.current().createdAssetIds.add(output.assetId)
    }

    private async saveOperation(
        context: MediaPipelineContext,
        previous: OperationRecord,
        receipt: MediaPipelineOperationReceipt,
    ): Promise<void> {
        if (
            receipt.operationId !== previous.receipt.operationId
            || receipt.inputHash !== previous.receipt.inputHash
        )
            throw new Error('PIPELINE_OPERATION_RECEIPT_MISMATCH')

        const local = this.infrastructure.handlers().find(handler => handler.definition.operationKey === previous.operationKey)?.definition.execution === 'local'
        const status = local ? this.publicOperation(
            await this.decodeOperation(context, previous),
            receipt,
            previous.createdAt,
        ) : undefined

        const outputs = receipt.state === 'succeeded' ? [...new Set(
            Object.values(receipt.outputs).map(output => output.assetId),
        )] : []
        await this.repository.commit([...await AgentExecutionScope.current().owner.fences(), this.repository.put(
            partition(context),
            operationKey(receipt.operationId),
            {
                ...previous,
                receipt,
                revision: previous.revision + 1,
            },
            previous.revision,
        ), ...(status ? [this.repository.put(
            partition(context),
            `OPERATION#${receipt.operationId}`,
            {
                ...status,
                revision: previous.revision + 1,
            },
            previous.revision,
        )] : []), ...outputs.map(
            assetId => this.repository.replace(
                partition(context),
                `CREATED#${assetId}`,
                {
                    assetId,
                    runId: context.runId,
                },
            ),
        )])

        if (status)
            await AgentExecutionScope.current().owner.event('operation.status', status)

        if (receipt.state === 'succeeded') for (const [outputSlot, output] of Object.entries(receipt.outputs))
            await AgentExecutionScope.current().owner.event(
                'output.committed',
                {
                    operationId: receipt.operationId,
                    outputSlot,
                    assetId: output.assetId,
                },
            )
    }

    private async publishExecution(execution: MediaPipelineExecution): Promise<void> {
        const scope = AgentExecutionScope.current()
        const context = execution.context
        const state: AgentOperation['state'] = execution.state === 'queued'
            ? 'submitted'
            : execution.state === 'waiting'
                ? 'running'
                : execution.state
        const outputAssetIds = Object.fromEntries(
            Object.entries(execution.outputs).map(([slot, output]) => [slot, output.assetId]),
        )
        const previous = await this.repository.read<Pick<AgentOperation, 'state' | 'outputAssetIds' | 'createdAt'>>(
            scope.owner.partition,
            `PUBLIC_OPERATION#${context.responseMessageId}#${execution.executionId}`,
        )

        if (
            previous?.state === state
            && JSON.stringify(previous.outputAssetIds) === JSON.stringify(outputAssetIds)
        )
            return

        const issue = execution.issues[0]
        const now = Date.now()
        await scope.owner.event(
            'operation.status',
            {
                operationId: execution.executionId,
                executionId: execution.executionId,
                conversationAssetId: context.conversationAssetId,
                turnId: context.turnId,
                runId: context.runId,
                responseMessageId: context.responseMessageId,
                operationKey: 'media-pipeline.execute',
                inputHash: execution.inputHash,
                sources: [],
                state,
                epoch: context.epoch,
                continuationEpoch: context.continuationEpoch,
                outputAssetIds,
                ...(issue ? { error: {
                    code: issue.code,
                    message: issue.message,
                    recoverable: issue.recoverable,
                } } : {}),
                createdAt: previous?.createdAt ?? now,
                updatedAt: now,
            },
        )
    }

    private async publishDraft(
        context: MediaPipelineContext,
        pipeline: MediaPipeline,
        inputHash: string,
        clientMutationId: string,
    ): Promise<void> {
        const scope = AgentExecutionScope.current()
        const operationId = `pipeline-draft-${createHash('sha256')
            .update(
                JSON.stringify([context.turnId, clientMutationId]),
            )
            .digest('hex')}`

        if (await this.repository.read(scope.owner.partition, `PUBLIC_OPERATION#${context.responseMessageId}#${operationId}`))
            return

        const now = Date.now()
        await scope.owner.event(
            'operation.status',
            {
                operationId,
                conversationAssetId: context.conversationAssetId,
                turnId: context.turnId,
                runId: context.runId,
                responseMessageId: context.responseMessageId,
                operationKey: 'media-pipeline.save',
                inputHash,
                sources: [],
                state: 'succeeded',
                epoch: context.epoch,
                continuationEpoch: context.continuationEpoch,
                outputAssetIds: { artifact: pipeline.pipelineId },
                createdAt: now,
                updatedAt: now,
            },
        )
        await scope.owner.event(
            'output.committed',
            {
                operationId,
                outputSlot: 'artifact',
                assetId: pipeline.pipelineId,
            },
        )
    }

    private async decodeOperation(
        context: MediaPipelineContext,
        record: OperationRecord,
    ): Promise<MediaPipelineOperationRequest> {
        return JSON.parse(
            Buffer.from(await this.payloads(context).read(record.request)).toString('utf8'),
        ) as MediaPipelineOperationRequest
    }

    private publicOperation(
        request: MediaPipelineOperationRequest,
        receipt: MediaPipelineOperationReceipt,
        createdAt = Date.now(),
    ): AgentOperation {
        return {
            operationId: request.operationId,
            conversationAssetId: request.context.conversationAssetId,
            turnId: request.context.turnId,
            runId: request.context.runId,
            responseMessageId: request.context.responseMessageId,
            operationKey: request.node.operationKey,
            executionId: request.executionId,
            stepId: request.node.nodeId,
            stepLabel: request.node.nodeId,
            inputHash: request.inputHash,
            sources: Object.values(request.inputs).map(
                source =>
                    ({
                        assetId: source.assetId,
                        role: ['image', 'video', 'audio'].includes(source.kind) ? 'media' : 'artifact',
                        revision: source.revision,
                        blobHash: source.blobHash!,
                        acquiredBy: 'explicit',
                        relationshipPath: [source.assetId],
                        ...(source.documentVersion ? { documentVersion: source.documentVersion } : {}),
                        ...(source.renditionId ? { renditionId: source.renditionId } : {}),
                    }),
            ),
            state: receipt.state,
            epoch: request.context.epoch,
            continuationEpoch: request.context.continuationEpoch,
            outputAssetIds: Object.fromEntries(
                Object.entries(receipt.outputs).map(([slot, source]) => [slot, source.assetId]),
            ),
            ...(receipt.error ? { error: receipt.error } : {}),
            createdAt,
            updatedAt: Date.now(),
        }
    }

    static retainedPayloads(
        row: Record<string, unknown>,
        sortKey: string,
    ): Array<{
        payload: AgentPayload
        ownerKey: string
    }> {
        if (
            sortKey.startsWith('PIPELINE#')
            && row.payload
        )
            return [{
                payload: row.payload as AgentPayload,
                ownerKey: `${sortKey}#${row.revision}`,
            }]

        if (
            sortKey.startsWith('PIPELINE_OPERATION#')
            && row.request
        )
            return [{
                payload: row.request as AgentPayload,
                ownerKey: `${sortKey}#request`,
            }]

        return []
    }

    private async notifyCompletion(
        context: MediaPipelineContext,
        execution: MediaPipelineExecution,
    ): Promise<boolean> {
        if (!terminal.has(execution.state))
            return false

        const key = `PIPELINE_COMPLETION#${execution.executionId}`
        const receipt = await this.repository.read<CompletionRecord>(
            partition(context),
            key,
        )

        if (
            !receipt
            || receipt.notified
        )
            return false

        await this.assertContext(context)
        await this.infrastructure.onCompleted(context, execution)

        return true
    }

    private async cancelRecord(execution: MediaPipelineExecution): Promise<void> {
        let after: string | undefined

        do {
            const page = await this.repository.query<OperationRecord>(
                partition(execution.context),
                'PIPELINE_OPERATION#',
                { after },
            )

            for (const stored of page.items.filter(record => record.executionId === execution.executionId))
                await this.infrastructure
                    .handlers().find(handler => handler.definition.operationKey === stored.operationKey)
                    ?.cancel?.(execution.context, stored.receipt.operationId)

            after = page.cursor
        } while (after)

        await this.saveExecution(
            {
                ...execution,
                revision: execution.revision + 1,
                state: 'cancelled',
            },
            execution.revision,
        )
    }

    private recheckSources = async (
        context: MediaPipelineContext,
        sources: MediaPipelineSource[],
    ): Promise<MediaPipelineIssue[]> => {
        const issues: MediaPipelineIssue[] = []

        for (const source of sources) {
            try {
                await this.resolveSource(context, source)
            } catch {
                issues.push({
                    code: 'PIPELINE_SOURCE_CHANGED',
                    message: 'A source changed or is no longer accessible.',
                    sourceId: source.sourceId,
                    recoverable: true,
                })
            }
        }

        return issues
    }

    async resolveSource(
        context: Pick<MediaPipelineContext, 'userId' | 'organizationId' | 'workspaceId'>,
        source: Pick<MediaPipelineSource, 'assetId' | 'kind'> & Partial<MediaPipelineSource>,
    ): Promise<MediaPipelineSource> {
        await AgentExecutionScope.assertReadTargets([source.assetId])
        const asset = await AssetModel.get({
            assetId: source.assetId,
            requester: {
                userId: context.userId,
                organizationIds: [context.organizationId],
                workspaceIds: [context.workspaceId],
                editableWorkspaceIds: [],
            },
        })

        if (
            'error' in asset
            || asset.organizationId !== context.organizationId
            || asset.states.lifecycle !== 'active'
        )
            throw new Error('PIPELINE_SOURCE_UNAVAILABLE')

        const media = ['image', 'video', 'audio'].includes(source.kind)

        if (
            media
            && asset.media?.kind !== source.kind
        )
            throw new Error('PIPELINE_SOURCE_KIND_CONFLICT')

        if (
            source.kind === 'sequence'
            && asset.artifact?.artifactTypeId !== 'media-sequence'
        )
            throw new Error('PIPELINE_SOURCE_KIND_CONFLICT')

        const pointer = media
            ? Object.values(asset.media?.renditions ?? {}).find(item => item?.name === (source.renditionId ?? 'original'))
            : source.kind === 'text'
                ? asset.documents.content
                : asset.documents.capabilityArtifact

        if (
            !pointer?.blobHash
            || ('status' in pointer && pointer.status !== 'ready')
        )
            throw new Error('PIPELINE_SOURCE_UNAVAILABLE')

        const revision = 'version' in pointer ? pointer.version : asset.revision

        if (
            (!media && source.revision !== undefined && source.revision !== revision)
            || (media && source.revision !== undefined && !source.blobHash && source.revision !== revision)
            || (source.blobHash && source.blobHash !== pointer.blobHash)
            || (source.documentVersion !== undefined && (!('version' in pointer) || source.documentVersion !== pointer.version))
        )
            throw new Error('PIPELINE_SOURCE_CHANGED')

        return {
            sourceId: source.sourceId ?? `source-${source.assetId}`,
            assetId: source.assetId,
            kind: source.kind,
            revision: media
                && source.blobHash
                ? source.revision ?? revision
                : revision,
            blobHash: pointer.blobHash,
            ...('version' in pointer ? { documentVersion: pointer.version } : { renditionId: source.renditionId ?? 'original' }),
        }
    }

    private async retainSources(
        context: MediaPipelineContext,
        pipeline: MediaPipeline,
    ): Promise<TransactOperation[]> {
        const additions = []

        for (const source of pipeline.sources) {
            const resolved = await this.resolveSource(context, source)
            const blob = await BlobModel.get({
                organizationId: context.organizationId,
                blobHash: resolved.blobHash!,
            })

            if (!blob)
                throw new Error('PIPELINE_SOURCE_UNAVAILABLE')

            additions.push({
                blob,
                reference: {
                    blobKey: blob.blobKey,
                    blobHash: blob.blobHash,
                    organizationId: context.organizationId,
                    referenceKey: `asset#${pipeline.pipelineId}#pipeline#${pipeline.revision}#${source.sourceId}`,
                    ownerType: 'asset' as const,
                    ownerId: pipeline.pipelineId,
                    createdAt: Date.now(),
                },
            })
        }

        return buildBlobReferenceBatchOperations({
            additions,
            now: Date.now(),
        }).operations
    }

    private async assertContext(context: MediaPipelineContext): Promise<void> {
        const scope = AgentExecutionScope.current()
        const meta = await scope.owner.read()
        const { job } = scope.owner

        if (
            context.userId !== job.userId
            || context.organizationId !== job.organizationId
            || context.workspaceId !== job.workspaceId
            || context.conversationAssetId !== job.conversationAssetId
            || context.turnId !== scope.turn.turnId
            || context.runId !== meta.run?.runId
            || context.continuationEpoch !== scope.continuationEpoch
            || context.epoch !== scope.owner.epoch
        )
            throw new Error('PIPELINE_EXECUTION_SCOPE_MISMATCH')

        await scope.owner.fences(context.continuationEpoch)
    }

    private payloads(context: MediaPipelineContext): AgentPayloadPort {
        return this.infrastructure.payloads?.(context) ?? new AgentPayloadStore(context.organizationId, context.conversationAssetId)
    }
}
