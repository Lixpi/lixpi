'use strict'

import type NatsService from '@lixpi/nats-service'
import { info, warn } from '@lixpi/debug-tools'

import type { BaseProvider, BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '../config.ts'
import type { ProviderState } from '../graph/state.ts'
import type { StoreWorkspaceImageFn } from '../graph/image-publisher.ts'
import { UsageReporter } from '../usage/usage-reporter.ts'

export type ProviderConstructor = new (
    instanceKey: string,
    deps: BaseProviderDeps,
) => BaseProvider

export class ProviderRegistry {
    private readonly instances = new Map<string, BaseProvider>()
    private readonly activeTasks = new Map<string, Promise<void>>()
    private readonly providerCtors: Map<ProviderName, ProviderConstructor>
    private readonly usageReporter: UsageReporter
    private imageRouter?: (state: ProviderState) => Promise<Partial<ProviderState>>

    constructor(
        private readonly natsService: NatsService,
        private readonly storeWorkspaceImage: StoreWorkspaceImageFn,
        ctors: Record<ProviderName, ProviderConstructor>,
    ) {
        this.providerCtors = new Map(Object.entries(ctors) as Array<[ProviderName, ProviderConstructor]>)
        this.usageReporter = new UsageReporter()
    }

    // late-bound to break the registry↔image-router circular dependency
    setImageRouter(router: (state: ProviderState) => Promise<Partial<ProviderState>>): void {
        this.imageRouter = router
    }

    private buildDeps(): BaseProviderDeps {
        return {
            natsService: this.natsService,
            storeWorkspaceImage: this.storeWorkspaceImage,
            usageReporter: this.usageReporter,
            runImageRouter: async (state: ProviderState) => {
                if (!this.imageRouter) {
                    throw new Error('ImageRouter not initialized')
                }
                return this.imageRouter(state)
            },
        }
    }

    getOrCreate(instanceKey: string, providerName: ProviderName): BaseProvider {
        const existing = this.instances.get(instanceKey)
        if (existing) {
            info(`Reusing existing instance: ${instanceKey}`)
            return existing
        }
        const Ctor = this.providerCtors.get(providerName)
        if (!Ctor) {
            throw new Error(`Unsupported provider: ${providerName}`)
        }
        info(`Creating new ${providerName} instance: ${instanceKey}`)
        const provider = new Ctor(instanceKey, this.buildDeps())
        this.instances.set(instanceKey, provider)
        return provider
    }

    // One-shot instance not stored in the registry — used by image router for transient image-model providers.
    createTransient(instanceKey: string, providerName: ProviderName): BaseProvider {
        const Ctor = this.providerCtors.get(providerName)
        if (!Ctor) {
            throw new Error(`Unsupported provider: ${providerName}`)
        }
        return new Ctor(instanceKey, this.buildDeps())
    }

    remove(instanceKey: string): void {
        if (this.instances.delete(instanceKey)) {
            info(`Removed instance: ${instanceKey}`)
        }
    }

    get(instanceKey: string): BaseProvider | undefined {
        return this.instances.get(instanceKey)
    }

    // Deduplicates concurrent invocations — drops the duplicate if a request is already in flight.
    async process(instanceKey: string, providerName: ProviderName, requestData: Record<string, any>): Promise<void> {
        if (this.activeTasks.has(instanceKey)) {
            warn(`Request already in progress for ${instanceKey}, skipping duplicate`)
            return
        }

        const provider = this.getOrCreate(instanceKey, providerName)
        const task = (async () => {
            try {
                await provider.process(requestData)
            } finally {
                this.activeTasks.delete(instanceKey)
                this.remove(instanceKey)
                info(`Chat request completed for ${instanceKey}`)
            }
        })()
        this.activeTasks.set(instanceKey, task)
        return task
    }

    async stop(instanceKey: string): Promise<void> {
        const provider = this.instances.get(instanceKey)
        if (!provider) {
            warn(`Instance not found: ${instanceKey}`)
            return
        }
        await provider.stop()
        info(`Stopped instance: ${instanceKey}`)
    }

    async shutdown(): Promise<void> {
        info('Shutting down provider registry...')
        for (const [key, provider] of this.instances.entries()) {
            try {
                await provider.stop()
            } catch (e) {
                warn(`Failed to stop ${key}: ${e}`)
            }
        }
        this.instances.clear()
        this.activeTasks.clear()
    }
}
