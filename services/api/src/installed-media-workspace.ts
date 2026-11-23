import {
    createMediaPipelineModule,
    regeneratePipelineOutputs,
    type CapabilityActionAuthorizationContext,
    type MediaPipelineRegenerationAdmission,
    type CapabilityModuleCatalog,
    type InstructionSkillStorage,
    type MediaPipelineModuleExtension,
} from '@lixpi/capability-system/backend'
import {
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'

import { MediaPipelineAdapter } from './capability-system/media-pipeline-adapter.ts'
import { MediaPipelinePromptAdapter } from './capability-system/media-pipeline-prompt-adapter.ts'
import { StabilityPipelineExecutor } from './capability-system/stability-pipeline-executor.ts'
import {
    type ConversationMediaOperations,
} from './llm/agent/agent-pending-tools.ts'
import { setAgentStateRetentionResolver } from './llm/agent/agent-state-maintenance.ts'
import {
    type Asset,
} from '@lixpi/constants'
import { ConversationRepository } from './llm/agent/conversation-repository.ts'

export const installMediaWorkspace = (
    catalog: CapabilityModuleCatalog,
    capabilityStorage: InstructionSkillStorage,
    metrics?: ProviderUsageClient,
) => {
    const repository = new ConversationRepository()
    setAgentStateRetentionResolver(row => MediaPipelineAdapter.retainedPayloads(row, row.sk))
    const images = metrics ? new StabilityPipelineExecutor(repository, metrics) : undefined
    const pipelines = new MediaPipelineAdapter(
        repository,
        {
            ...(metrics ? { promptModel: new MediaPipelinePromptAdapter(repository, metrics).ports() } : {}),
            handlers: () => images ? [images.handler()] : [],
            modelRoutes: async () => await images?.routes() ?? [],
            onCompleted: async () => {},
        },
    )
    const operations: ConversationMediaOperations = {
        get: async (owner, operationId) => await pipelines.getOperation(owner, operationId),
        cancelOperation: async (owner, operationId) => await pipelines.cancelOperation(owner, operationId),
        advance: async owner => {
            const advanced = await pipelines.advanceForRun(owner)

            return {
                pending: advanced.pending,
                completed: advanced.completed.map(
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
                ),
            }
        },
        acknowledge: async (owner, operationId) => await pipelines.acknowledgeCompletion(owner, operationId),
        cancel: async owner => await pipelines.cancelForRun(owner),
    }
    const ports = pipelines.ports()
    const module = createMediaPipelineModule({
        ports,
        capabilityStorage,
        resolveContext: async context => pipelines.resolveContext(context),
    })
    module.extensions = {
        ...module.extensions,
        operations,
    }
    catalog.registerModule(module)
    const { service } = catalog.getExtension<MediaPipelineModuleExtension>('media-pipeline', 'media-pipeline')!
    pipelines.bind(service)

    return async (
        authorization: CapabilityActionAuthorizationContext,
        input: {
            assets: Asset[]
            regenerationId: string
            mode: 'existing-prompt' | 'regenerate-prompt'
            admit: MediaPipelineRegenerationAdmission
        },
    ): Promise<{
        status: 'pending'
        operationId: string
    }> => {
        const context = pipelines.resolveContext(authorization)

        if (!context)
            throw new Error('CANVAS_REGENERATION_HISTORY_UNAVAILABLE')

        const sources = await Promise.all(
            input.assets.map(
                async asset =>
                    await pipelines.readRegenerationSource(
                        context,
                        asset,
                        input.mode === 'regenerate-prompt',
                    ),
            ),
        )

        return await regeneratePipelineOutputs(
            service,
            ports,
            context,
            {
                ...input,
                sources,
            },
        )
    }
}
