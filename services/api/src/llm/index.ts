'use strict'

import type NatsService from '@lixpi/nats-service'
import type { ProviderName } from '@lixpi/constants'

import { ProviderRegistry } from './providers/provider-registry.ts'
import { OpenAIProvider } from './providers/openai-provider.ts'
import { AnthropicProvider } from './providers/anthropic-provider.ts'
import { GoogleProvider } from './providers/google-provider.ts'
import { StabilityProvider } from './providers/stability-provider.ts'
import { BytePlusProvider } from './providers/byteplus-provider.ts'
import { ImageRouter } from './tools/image-router.ts'
import { VideoRouter } from './tools/video-router.ts'
import { ExtractionOrchestrator } from './extraction/orchestrator.ts'
import { MediaGenerationMatrixOrchestrator, type MatrixRequestData } from './orchestration/media-generation-matrix.ts'

import type { StoreWorkspaceImageFn } from './graph/image-publisher.ts'
import type { StoreWorkspaceVideoFn } from './graph/video-publisher.ts'
import type { ExtractionInput, ExtractionResult } from './extraction/types.ts'
import type { MetricsClient } from '../metrics/metrics-client.ts'

export type LlmModule = {
    process: (instanceKey: string, providerName: ProviderName, requestData: Record<string, any>) => Promise<void>
    processMediaGenerationMatrix: (requestData: MatrixRequestData) => Promise<void>
    processExtraction: (input: ExtractionInput) => Promise<ExtractionResult>
    stop: (instanceKey: string) => Promise<void>
    stopMediaGenerationMatrix: (params: { workspaceId: string; aiChatThreadId: string; generationRequestId?: string }) => Promise<void>
    shutdown: () => Promise<void>
    // Currently empty — gateway invokes in-process. For a future llm-workers split,
    // a worker process registers these on its own NATS connection.
    getSubscriptions: () => any[]
}

export type LlmModuleDeps = {
    natsService: NatsService
    storeWorkspaceImage: StoreWorkspaceImageFn
    storeWorkspaceVideo: StoreWorkspaceVideoFn
    // Metrics integration (optional — absent/disabled = the open-source plug, i.e.
    // today's behavior). Synchronous check/confirm run via this client.
    metrics?: MetricsClient
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
            BytePlus: BytePlusProvider,
        },
        {
            metrics: deps.metrics,
        },
    )

    const imageRouter = new ImageRouter(registry)
    registry.setImageRouter((state, options) => imageRouter.execute(state, options))

    const videoRouter = new VideoRouter(registry)
    registry.setVideoRouter((state, options) => videoRouter.execute(state, options))

    const extractionOrchestrator = new ExtractionOrchestrator(deps.natsService, {
        runImageRouter: (state) => imageRouter.execute(state),
        storeWorkspaceImage: deps.storeWorkspaceImage,
    })
    const mediaGenerationMatrixOrchestrator = new MediaGenerationMatrixOrchestrator(registry, deps.natsService)

    return {
        process: (instanceKey, providerName, requestData) =>
            registry.process(instanceKey, providerName, requestData),
        processMediaGenerationMatrix: (requestData) =>
            mediaGenerationMatrixOrchestrator.process(requestData),
        processExtraction: (input) => extractionOrchestrator.run(input),
        stop: (instanceKey) => registry.stop(instanceKey),
        stopMediaGenerationMatrix: (params) => mediaGenerationMatrixOrchestrator.stop(params),
        shutdown: () => registry.shutdown(),
        getSubscriptions: () => [],
    }
}

export type { ExtractionInput, ExtractionResult } from './extraction/types.ts'
