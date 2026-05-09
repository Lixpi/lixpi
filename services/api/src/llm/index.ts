'use strict'

import type NatsService from '@lixpi/nats-service'

import { ProviderRegistry } from './providers/provider-registry.ts'
import { OpenAIProvider } from './providers/openai-provider.ts'
import { AnthropicProvider } from './providers/anthropic-provider.ts'
import { GoogleProvider } from './providers/google-provider.ts'
import { StabilityProvider } from './providers/stability-provider.ts'
import { ImageRouter } from './tools/image-router.ts'

import type { ProviderName } from './config.ts'
import type { StoreWorkspaceImageFn } from './graph/image-publisher.ts'

export type LlmModule = {
    process: (instanceKey: string, providerName: ProviderName, requestData: Record<string, any>) => Promise<void>
    stop: (instanceKey: string) => Promise<void>
    shutdown: () => Promise<void>
    // Currently empty — gateway invokes in-process. For a future llm-workers split,
    // a worker process registers these on its own NATS connection.
    getSubscriptions: () => any[]
}

export type LlmModuleDeps = {
    natsService: NatsService
    storeWorkspaceImage: StoreWorkspaceImageFn
}

export const createLlmModule = (deps: LlmModuleDeps): LlmModule => {
    const registry = new ProviderRegistry(
        deps.natsService,
        deps.storeWorkspaceImage,
        {
            OpenAI: OpenAIProvider,
            Anthropic: AnthropicProvider,
            Google: GoogleProvider,
            Stability: StabilityProvider,
        },
    )

    const imageRouter = new ImageRouter(registry)
    registry.setImageRouter((state) => imageRouter.execute(state))

    return {
        process: (instanceKey, providerName, requestData) =>
            registry.process(instanceKey, providerName, requestData),
        stop: (instanceKey) => registry.stop(instanceKey),
        shutdown: () => registry.shutdown(),
        getSubscriptions: () => [],
    }
}

export type { ProviderName } from './config.ts'
