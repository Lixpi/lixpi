import {
    type AgentOperation,
} from '@lixpi/constants'
import { createHash } from 'node:crypto'
import {
    createMediaSequenceModule,
    createMediaPipelineModule,
    type CapabilityModuleCatalog,
    type InstructionSkillStorage,
    type MediaSequenceAccess,
    type MediaSequenceService,
    type MediaRenderCompilerPort,
    type CapabilityActionAuthorizationContext,
    type MediaPipelineModuleExtension,
    type MediaPipelineOperationHandler,
} from '@lixpi/capability-system/backend'
import {
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import {
    type default as NatsService,
} from '@lixpi/nats-service'
import { ConversationRepository } from './llm/agent/conversation-repository.ts'
import { AgentExecutionScope } from './llm/agent/agent-execution-scope.ts'
import { setAgentStateRetentionResolver } from './llm/agent/agent-state-maintenance.ts'
import {
    type ConversationOwner,
} from './llm/agent/conversation-owner.ts'
import { MediaSequenceAdapter } from './capability-system/media-sequence-adapter.ts'
import {
    MediaRenderAdapter,
    type MediaRenderHandle,
} from './capability-system/media-render-adapter.ts'
import { MediaRenderPlatform } from './capability-system/media-render-platform.ts'
import { MediaPipelineAdapter } from './capability-system/media-pipeline-adapter.ts'
import { StabilityPipelineExecutor } from './capability-system/stability-pipeline-executor.ts'
import { MediaPipelineRenderAdapter } from './capability-system/media-pipeline-render-adapter.ts'
import { MediaPipelinePromptAdapter } from './capability-system/media-pipeline-prompt-adapter.ts'

export type MediaWorkspacePlatform = {
    sequenceAdapter: MediaSequenceAdapter
    sequence: MediaSequenceService
    renders: MediaRenderAdapter
    pipelines: MediaPipelineAdapter
    operations: {
        advance: (owner: ConversationOwner) => Promise<{
            pending: boolean
            completed: Array<{
                operationId: string
                result: unknown
            }>
        }>
        acknowledge: (
            owner: ConversationOwner,
            operationId: string,
        ) => Promise<void>
        cancel: (owner: ConversationOwner) => Promise<void>
        get: (
            owner: ConversationOwner,
            operationId: string,
        ) => Promise<unknown>
        cancelOperation: (
            owner: ConversationOwner,
            operationId: string,
        ) => Promise<unknown>
    }
    start: () => Promise<void>
    stop: () => void
}

type AsyncRenderTool = {
    kind: 'render'
    jobId: string
    runId: string
    turnId: string
    continuationEpoch: number
    responseMessageId: string
    inputHash: string
    createdAt: number
    notified?: boolean
}

export const installMediaWorkspace = (
    catalog: CapabilityModuleCatalog,
    nats: NatsService,
    capabilityStorage: InstructionSkillStorage,
    metrics?: ProviderUsageClient,
): MediaWorkspacePlatform => {
    const repository = new ConversationRepository()
    setAgentStateRetentionResolver(row => MediaPipelineAdapter.retainedPayloads(row, row.sk))
    const publishRenderStatus = async (
        owner: ConversationOwner,
        tool: AsyncRenderTool,
        handle: MediaRenderHandle,
    ) => {
        const operationId = `render:${handle.jobId}`
        const state: AgentOperation['state'] = handle.state === 'completed'
            ? 'succeeded'
            : handle.state === 'queued'
                ? 'submitted'
                : handle.state
        const previous = await repository.read<{ state: string }>(owner.partition, `PUBLIC_OPERATION#${tool.responseMessageId}#${operationId}`)

        if (previous?.state === state)
            return

        const now = Date.now()
        await owner.event(
            'operation.status',
            {
                operationId,
                conversationAssetId: owner.job.conversationAssetId,
                turnId: tool.turnId,
                runId: tool.runId,
                responseMessageId: tool.responseMessageId,
                operationKey: 'sequence.export',
                inputHash: tool.inputHash,
                sources: [],
                state,
                epoch: owner.epoch,
                continuationEpoch: tool.continuationEpoch,
                providerJobId: handle.jobId,
                outputAssetIds: handle.state === 'completed' ? { video: handle.outputAssetId } : {},
                ...(handle.error ? { error: {
                    code: handle.error,
                    message: 'The sequence export could not finish.',
                    recoverable: true,
                } } : {}),
                createdAt: tool.createdAt,
                updatedAt: now,
            },
        )

        if (handle.state === 'completed')
            await owner.event(
                'output.committed',
                {
                    operationId,
                    outputSlot: 'video',
                    assetId: handle.outputAssetId,
                },
            )
    }
    const images = metrics ? new StabilityPipelineExecutor(repository, metrics) : undefined
    let renderReady = false
    const pipelines = new MediaPipelineAdapter(
        repository,
        {
            ...(metrics ? { promptModel: new MediaPipelinePromptAdapter(repository, metrics).ports() } : {}),
            handlers: () => [...images ? [images.handler()] : [], ...catalog.getExtension<MediaPipelineOperationHandler[]>(
                'media-sequence',
                'pipelineOperations',
            ) ?? []].map(
                handler => handler.definition.operationKey === 'sequence.export' ? {
                    ...handler,
                    definition: {
                        ...handler.definition,
                        ready: renderReady,
                    },
                } : handler,
            ),
            modelRoutes: async () => {
                try {
                    const readiness = await platform.renders.readiness()
                    renderReady = readiness.ready && readiness.presets.some(preset => preset.presetId === 'mp4-h264-aac' && preset.available)
                } catch {
                    renderReady = false
                }

                return await images?.routes() ?? []
            },
            onCompleted: async () => {},
        },
    )
    const sequenceAdapter = new MediaSequenceAdapter(
        repository,
        async access => {
            const execution = AgentExecutionScope.current()

            if (
                access.origin.kind !== 'conversation'
                || access.origin.conversationAssetId !== execution.owner.job.conversationAssetId
                || access.origin.turnId !== execution.turn.turnId
            )
                throw new Error('AGENT_SEQUENCE_SCOPE_MISMATCH')

            return await execution.owner.fences(execution.continuationEpoch)
        },
        nats,
    )
    const resolveAccess = async (
        context: CapabilityActionAuthorizationContext,
        clientMutationId: string,
    ): Promise<MediaSequenceAccess> => {
        const execution = AgentExecutionScope.current()
        const meta = await execution.owner.read()

        if (
            context.userId !== execution.owner.job.userId
            || context.workspaceId !== execution.owner.job.workspaceId
            || context.runId !== meta.run?.runId
        )
            throw new Error('AGENT_SEQUENCE_SCOPE_MISMATCH')

        return {
            userId: context.userId,
            organizationId: execution.owner.job.organizationId,
            workspaceId: context.workspaceId,
            origin: {
                kind: 'conversation',
                conversationAssetId: execution.owner.job.conversationAssetId,
                turnId: execution.turn.turnId,
                operationId: clientMutationId,
            },
        }
    }
    let platform: MediaWorkspacePlatform
    const pipelineRenders = new MediaPipelineRenderAdapter(
        repository,
        () => platform,
        (context, assetId) => pipelines.resolveSource(
            context,
            {
                assetId,
                kind: 'video',
            },
        ),
    )
    const render = async (
        access: MediaSequenceAccess,
        request: Record<string, unknown>,
    ) => {
        const sequence = await platform.sequence.get(
            access,
            String(request.sequenceId),
            request.revision as number | undefined,
        )
        let conversation

        if (access.origin.kind === 'conversation') {
            const execution = await AgentExecutionScope.authorize(
                'execute',
                ['sequence-export'],
                [sequence.sequenceId],
            )
            const meta = await execution.owner.read()
            conversation = {
                conversationAssetId: execution.owner.job.conversationAssetId,
                runId: meta.run!.runId,
                turnId: execution.turn.turnId,
                continuationEpoch: execution.continuationEpoch,
            }
        }

        const handle = await platform.renders.submit(
            access,
            {
                sequence,
                preset: request.preset ?? sequence.exportDefaults,
                clientMutationId: String(request.clientMutationId),
                ...(conversation ? { conversation } : {}),
            },
        )

        if (!conversation)
            return handle

        const execution = AgentExecutionScope.current()
        const operationId = `render:${handle.jobId}`
        const key = `ASYNC_TOOL#${operationId}`
        const existing = await repository.read<AsyncRenderTool>(execution.owner.partition, key)
        const savedTool: AsyncRenderTool = existing ?? {
            kind: 'render',
            jobId: handle.jobId,
            ...conversation,
            responseMessageId: execution.responseMessageId,
            inputHash: createHash('sha256').update(
                JSON.stringify(request),
            ).digest('hex'),
            createdAt: Date.now(),
        }

        if (!existing)
            await repository.commit([...await execution.owner.fences(execution.continuationEpoch), repository.put(
                execution.owner.partition,
                key,
                savedTool,
            ), repository.replace(
                execution.owner.partition,
                `CREATED#${handle.outputAssetId}`,
                {
                    assetId: handle.outputAssetId,
                    runId: conversation.runId,
                },
            )])

        execution.createdAssetIds.add(handle.outputAssetId)
        await publishRenderStatus(
            execution.owner,
            savedTool,
            handle,
        )

        return {
            ...handle,
            status: 'pending',
            operationId,
        }
    }
    catalog.registerModule(
        createMediaSequenceModule({
            ports: sequenceAdapter.ports(),
            resolveSourceSelection: (access, input) => sequenceAdapter.resolveSource(access, input),
            onEditCommitted: (access, result) => sequenceAdapter.reportEdit(access, result),
            capabilityStorage,
            resolveAccess,
            exportSequence: render,
            pipeline: {
                exportHandler: pipelineRenders.handler(),
                resolvePipelineSource: (access, input) => pipelines.resolveSource(access, input),
                resolvePipelineMediaSource: async (
                    access,
                    source,
                    sourceId,
                ) => {
                    const verified = await pipelines.resolveSource(access, source)

                    return await sequenceAdapter.resolveSource(
                        access,
                        {
                            sourceId,
                            assetId: verified.assetId,
                            renditionId: verified.renditionId ?? 'original',
                        },
                    )
                },
            },
        }),
    )
    catalog.registerModule(
        createMediaPipelineModule({
            ports: pipelines.ports(),
            capabilityStorage,
            resolveContext: async context => pipelines.resolveContext(context),
        }),
    )
    pipelines.bind(catalog.getExtension<MediaPipelineModuleExtension>('media-pipeline', 'media-pipeline')!.service)
    const compiler = catalog.getExtension<MediaRenderCompilerPort>('media-sequence', 'renderCompiler')!
    const sequence = catalog.getExtension<MediaSequenceService>('media-sequence', 'service')!
    const renders = new MediaRenderAdapter(
        repository,
        compiler,
        new MediaRenderPlatform(repository, nats).ports(),
    )
    const renderTools = async (owner: ConversationOwner): Promise<AsyncRenderTool[]> => {
        const meta = await owner.read()
        const tools: AsyncRenderTool[] = []
        let after: string | undefined

        do {
            const page = await repository.query<AsyncRenderTool>(
                owner.partition,
                'ASYNC_TOOL#render:',
                { after },
            )
            tools.push(...page.items.filter(tool => tool.runId === meta.run?.runId && !tool.notified))
            after = page.cursor
        } while (after)

        return tools
    }
    const operations: MediaWorkspacePlatform['operations'] = {
        get: async (owner, operationId) => {
            if (!operationId.startsWith('render:'))
                return await pipelines.getOperation(owner, operationId)

            await owner.read()
            const tool = await repository.read<AsyncRenderTool>(owner.partition, `ASYNC_TOOL#${operationId}`)

            if (!tool)
                throw new Error('AGENT_OPERATION_NOT_FOUND')

            return {
                ...await renders.get(owner.job, tool.jobId),
                operationId,
                kind: 'render',
            }
        },
        cancelOperation: async (owner, operationId) => {
            if (!operationId.startsWith('render:'))
                return await pipelines.cancelOperation(owner, operationId)

            const scope = await AgentExecutionScope.authorize('execute')
            const meta = await owner.read()
            const tool = await repository.read<AsyncRenderTool>(owner.partition, `ASYNC_TOOL#${operationId}`)

            if (
                !tool
                || scope.owner !== owner
                || tool.runId !== meta.run?.runId
                || tool.continuationEpoch !== scope.continuationEpoch
            )
                throw new Error('AGENT_OPERATION_SCOPE_MISMATCH')

            await owner.fences(scope.continuationEpoch)
            await renders.cancel(owner.job, tool.jobId)
            const handle = await renders.get(owner.job, tool.jobId)
            await publishRenderStatus(
                owner,
                tool,
                handle,
            )

            return {
                ...handle,
                operationId,
                kind: 'render',
            }
        },
        advance: async owner => {
            const advanced = await pipelines.advanceForRun(owner)
            const completed: Array<{
                operationId: string
                result: unknown
            }> = advanced.completed.map(
                execution => ({
                    operationId: execution.executionId,
                    result: {
                        status: execution.state === 'succeeded' ? 'completed' : 'error',
                        executionId: execution.executionId,
                        pipelineId: execution.pipeline.pipelineId,
                        revision: execution.pipeline.revision,
                        state: execution.state,
                        outputs: execution.outputs,
                        issues: execution.issues,
                    },
                }),
            )
            let pending = advanced.pending
            const meta = await owner.read()

            for (const tool of await renderTools(owner)) {
                if (tool.continuationEpoch !== meta.run?.continuationEpoch) {
                    await renders.cancel(owner.job, tool.jobId)

                    continue
                }

                const handle = await renders.get(owner.job, tool.jobId)
                await publishRenderStatus(
                    owner,
                    tool,
                    handle,
                )

                if (['completed', 'failed', 'cancelled'].includes(handle.state))
                    completed.push({
                        operationId: `render:${tool.jobId}`,
                        result: {
                            ...handle,
                            status: handle.state === 'completed' ? 'completed' : 'error',
                        },
                    })
                else
                    pending = true
            }

            return {
                pending,
                completed,
            }
        },
        acknowledge: async (owner, operationId) => {
            if (!operationId.startsWith('render:'))
                return await pipelines.acknowledgeCompletion(owner, operationId)

            const key = `ASYNC_TOOL#${operationId}`
            const tool = await repository.read<AsyncRenderTool>(owner.partition, key)
            const meta = await owner.read()

            if (
                !tool
                || tool.runId !== meta.run?.runId
            )
                throw new Error('ASYNC_TOOL_SCOPE_MISMATCH')

            await repository.commit([...await owner.fences(tool.continuationEpoch), repository.replace(
                owner.partition,
                key,
                {
                    ...tool,
                    notified: true,
                },
            )])
        },
        cancel: async owner => {
            await pipelines.cancelForRun(owner)

            for (const tool of await renderTools(owner)) {
                await renders.cancel(owner.job, tool.jobId)
                await publishRenderStatus(
                    owner,
                    tool,
                    await renders.get(owner.job, tool.jobId),
                )
            }
        },
    }
    platform = {
        sequenceAdapter,
        sequence,
        renders,
        pipelines,
        operations,
        start: () => renders.start(),
        stop: () => renders.stop(),
    }

    return platform
}
