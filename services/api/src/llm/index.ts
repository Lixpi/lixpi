'use strict'

import type NatsService from '@lixpi/nats-service'
import type { ProviderName } from '@lixpi/constants'

import { ProviderRegistry } from './providers/provider-registry.ts'
import { OpenAIProvider } from './providers/openai-provider.ts'
import { AnthropicProvider } from './providers/anthropic-provider.ts'
import { GoogleProvider } from './providers/google-provider.ts'
import { StabilityProvider } from './providers/stability-provider.ts'
import { ImageRouter } from './tools/image-router.ts'
import { VideoRouter } from './tools/video-router.ts'
import { ExtractionOrchestrator } from './extraction/orchestrator.ts'

import type { StoreWorkspaceImageFn } from './graph/image-publisher.ts'
import type { StoreWorkspaceVideoFn } from './graph/video-publisher.ts'
import type { ExtractionInput, ExtractionResult } from './extraction/types.ts'

export type LlmModule = {
    process: (instanceKey: string, providerName: ProviderName, requestData: Record<string, any>) => Promise<void>
    processExtraction: (input: ExtractionInput) => Promise<ExtractionResult>
    stop: (instanceKey: string) => Promise<void>
    shutdown: () => Promise<void>
    // Currently empty — gateway invokes in-process. For a future llm-workers split,
    // a worker process registers these on its own NATS connection.
    getSubscriptions: () => any[]
}

export type LlmModuleDeps = {
    natsService: NatsService
    storeWorkspaceImage: StoreWorkspaceImageFn
    storeWorkspaceVideo: StoreWorkspaceVideoFn
}

export const createLlmModule = (deps: LlmModuleDeps): LlmModule => {
    const registry = new ProviderRegistry(
        deps.natsService,
        deps.storeWorkspaceImage,
        deps.storeWorkspaceVideo,
        {
            OpenAI: OpenAIProvider,
            Anthropic: AnthropicProvider,
            Google: GoogleProvider,
            Stability: StabilityProvider,
        },
    )

    const imageRouter = new ImageRouter(registry)
    registry.setImageRouter((state) => imageRouter.execute(state))

    const videoRouter = new VideoRouter(registry)
    registry.setVideoRouter((state) => videoRouter.execute(state))

    const extractionOrchestrator = new ExtractionOrchestrator(deps.natsService, {
        runImageRouter: (state) => imageRouter.execute(state),
        storeWorkspaceImage: deps.storeWorkspaceImage,
    })

    return {
        process: (instanceKey, providerName, requestData) =>
            registry.process(instanceKey, providerName, requestData),
        processExtraction: (input) => extractionOrchestrator.run(input),
        stop: (instanceKey) => registry.stop(instanceKey),
        shutdown: () => registry.shutdown(),
        getSubscriptions: () => [],
    }
}

export type { ExtractionInput, ExtractionResult } from './extraction/types.ts'
