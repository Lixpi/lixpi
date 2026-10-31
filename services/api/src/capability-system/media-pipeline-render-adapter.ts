import { createHash } from 'node:crypto'
import {
    type MediaPipelineContext,
    type MediaPipelineOperationHandler,
    type MediaPipelineOperationReceipt,
    type MediaPipelineOperationRequest,
    type MediaPipelineSource,
    type MediaSequenceService,
} from '@lixpi/capability-system/backend'
import { AgentExecutionScope } from '../llm/agent/agent-execution-scope.ts'
import {
    type ConversationRepository,
} from '../llm/agent/conversation-repository.ts'
import {
    type MediaRenderAdapter,
    type MediaRenderHandle,
} from './media-render-adapter.ts'

type RenderOperation = {
    operationId: string
    inputHash: string
    jobId: string
}

export class MediaPipelineRenderAdapter {
    constructor(
        private readonly repository: ConversationRepository,
        private readonly services: () => {
            sequence: MediaSequenceService
            renders: MediaRenderAdapter
        },
        private readonly resolveOutput: (
            context: MediaPipelineContext,
            assetId: string,
        ) => Promise<MediaPipelineSource>,
    ) {}

    handler(): Omit<MediaPipelineOperationHandler, 'definition'> {
        return {
            ensure: request => this.ensure(request),
            read: (context, operationId) => this.read(context, operationId),
            cancel: async (context, operationId) => {
                const record = await this.repository.read<RenderOperation>(
                    AgentExecutionScope.current().owner.partition,
                    `PIPELINE_RENDER#${operationId}`,
                )

                if (record)
                    await this.services().renders.cancel(context, record.jobId)
            },
        }
    }

    private async ensure(request: MediaPipelineOperationRequest): Promise<MediaPipelineOperationReceipt> {
        const scope = await AgentExecutionScope.authorize(
            'execute',
            ['sequence-export'],
            [request.inputs.sequence.assetId],
        )
        const existing = await this.read(request.context, request.operationId)

        if (existing) {
            if (existing.inputHash !== request.inputHash)
                throw new Error('PIPELINE_RENDER_IDEMPOTENCY_CONFLICT')

            return existing
        }

        const source = request.inputs.sequence
        const access = {
            ...request.context,
            origin: {
                kind: 'conversation' as const,
                conversationAssetId: request.context.conversationAssetId,
                turnId: request.context.turnId,
                operationId: request.operationId,
            },
        }
        const sequence = await this.services().sequence.get(
            access,
            source.assetId,
            source.revision,
        )
        const handle = await this.services().renders.submit(
            request.context,
            {
                sequence,
                preset: request.node.parameters.preset,
                clientMutationId: `pipeline-${createHash('sha256').update(request.operationId).digest('hex')}`,
                conversation: {
                    conversationAssetId: request.context.conversationAssetId,
                    runId: request.context.runId,
                    turnId: request.context.turnId,
                    continuationEpoch: request.context.continuationEpoch,
                },
            },
        )
        const record = {
            operationId: request.operationId,
            inputHash: request.inputHash,
            jobId: handle.jobId,
        }
        await this.repository.commit([...(await scope.owner.fences(request.context.continuationEpoch)), this.repository.put(
            scope.owner.partition,
            `PIPELINE_RENDER#${request.operationId}`,
            record,
        ), this.repository.replace(
            scope.owner.partition,
            `CREATED#${handle.outputAssetId}`,
            {
                assetId: handle.outputAssetId,
                runId: request.context.runId,
            },
        )])
        scope.createdAssetIds.add(handle.outputAssetId)

        return await this.receipt(
            request.context,
            record,
            handle,
        )
    }

    private async read(
        context: MediaPipelineContext,
        operationId: string,
    ): Promise<MediaPipelineOperationReceipt | undefined> {
        const record = await this.repository.read<RenderOperation>(AgentExecutionScope.current().owner.partition, `PIPELINE_RENDER#${operationId}`)

        if (!record)
            return undefined

        return await this.receipt(
            context,
            record,
            await this.services().renders.get(context, record.jobId),
        )
    }

    private async receipt(
        context: MediaPipelineContext,
        record: RenderOperation,
        handle: MediaRenderHandle,
    ): Promise<MediaPipelineOperationReceipt> {
        AgentExecutionScope.current().createdAssetIds.add(handle.outputAssetId)

        return {
            operationId: record.operationId,
            inputHash: record.inputHash,
            state: handle.state === 'completed'
                ? 'succeeded'
                : handle.state === 'queued'
                    ? 'submitted'
                    : handle.state,
            outputs: handle.state === 'completed' ? { video: await this.resolveOutput(context, handle.outputAssetId) } : {},
            ...(handle.error ? { error: {
                code: handle.error,
                message: 'The sequence export could not finish.',
                recoverable: true,
            } } : {}),
        }
    }
}
