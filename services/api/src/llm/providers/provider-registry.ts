'use strict'

import type NatsService from '@lixpi/nats-service'
import { info, warn } from '@lixpi/debug-tools'

import type { BaseProvider, BaseProviderDeps } from './base-provider.ts'
import type { ProviderName } from '@lixpi/constants'
import type { ProviderState } from '../graph/state.ts'
import type { ProseMirrorContentHandler, ProseMirrorSnapshotProvider } from '../graph/stream-publisher.ts'
import type { StoreWorkspaceImageFn } from '../graph/image-publisher.ts'
import type { StoreWorkspaceVideoFn } from '../graph/video-publisher.ts'
import { UsageReporter } from '../usage/usage-reporter.ts'
import type { MetricsClient } from '../../metrics/metrics-client.ts'

// Metrics dependencies threaded into every provider's graph deps.
export type MetricsDeps = {
    metrics?: MetricsClient
}

export type ProviderConstructor = new (
    instanceKey: string,
    deps: BaseProviderDeps,
) => BaseProvider

type MediaRouterOptions = {
    onProseMirrorContent?: ProseMirrorContentHandler
    getProseMirrorSnapshot?: ProseMirrorSnapshotProvider
}

export class ProviderRegistry {
    private readonly instances = new Map<string, BaseProvider>()
    private readonly activeTasks = new Map<string, Promise<void>>()
    private readonly requestGroups = new Map<string, Set<string>>()
    private readonly providerCtors: Map<ProviderName, ProviderConstructor>
    private readonly usageReporter: UsageReporter
    private imageRouter?: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>
    private videoRouter?: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>

    constructor(
        private readonly natsService: NatsService,
        private readonly storeWorkspaceImage: StoreWorkspaceImageFn,
        private readonly storeWorkspaceVideo: StoreWorkspaceVideoFn,
        // Partial: not every ProviderName must have a registered constructor
        // (e.g. a video-only provider added before its class lands). Unregistered
        // providers throw "Unsupported provider" on lookup in getOrCreate/createTransient.
        ctors: Partial<Record<ProviderName, ProviderConstructor>>,
        private readonly metricsDeps: MetricsDeps = {},
    ) {
        this.providerCtors = new Map(Object.entries(ctors) as Array<[ProviderName, ProviderConstructor]>)
        this.usageReporter = new UsageReporter()
    }

    // late-bound to break the registry↔image-router circular dependency
    setImageRouter(router: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>): void {
        this.imageRouter = router
    }

    // late-bound to break the registry↔video-router circular dependency
    setVideoRouter(router: (state: ProviderState, options?: MediaRouterOptions) => Promise<Partial<ProviderState>>): void {
        this.videoRouter = router
    }

    private buildDeps(): BaseProviderDeps {
        return {
            natsService: this.natsService,
            storeWorkspaceImage: this.storeWorkspaceImage,
            storeWorkspaceVideo: this.storeWorkspaceVideo,
            usageReporter: this.usageReporter,
            runImageRouter: async (state: ProviderState, options?: MediaRouterOptions) => {
                if (!this.imageRouter) {
                    throw new Error('ImageRouter not initialized')
                }
                return this.imageRouter(state, options)
            },
            runVideoRouter: async (state: ProviderState, options?: MediaRouterOptions) => {
                if (!this.videoRouter) {
                    throw new Error('VideoRouter not initialized')
                }
                return this.videoRouter(state, options)
            },
            metrics: this.metricsDeps.metrics,
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

    // One-shot provider used by media routers. It is stored while running so
    // request-group stop can abort media children as well as reasoning children.
    createTransient(instanceKey: string, providerName: ProviderName): BaseProvider {
        const provider = this.getOrCreate(instanceKey, providerName)
        const requestGroupKey = this.inferRequestGroupKey(instanceKey)
        if (requestGroupKey) {
            this.registerRequestGroupInstance(requestGroupKey, instanceKey)
        }
        return provider
    }

    remove(instanceKey: string): void {
        if (this.instances.delete(instanceKey)) {
            info(`Removed instance: ${instanceKey}`)
        }
        this.unregisterInstanceFromAllGroups(instanceKey)
    }

    get(instanceKey: string): BaseProvider | undefined {
        return this.instances.get(instanceKey)
    }

    // Deduplicates concurrent invocations — drops the duplicate if a request is already in flight.
    async process(
        instanceKey: string,
        providerName: ProviderName,
        requestData: Record<string, any>,
        options: { requestGroupKey?: string } = {},
    ): Promise<void> {
        if (this.activeTasks.has(instanceKey)) {
            warn(`Request already in progress for ${instanceKey}, skipping duplicate`)
            return
        }

        if (options.requestGroupKey) {
            this.registerRequestGroupInstance(options.requestGroupKey, instanceKey)
        }

        const provider = this.getOrCreate(instanceKey, providerName)
        const task = (async () => {
            try {
                await provider.process(requestData)
            } finally {
                this.activeTasks.delete(instanceKey)
                if (options.requestGroupKey) {
                    this.unregisterRequestGroupInstance(options.requestGroupKey, instanceKey)
                }
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

    async stopGroup(requestGroupKey: string): Promise<void> {
        const instanceKeys = this.requestGroups.get(requestGroupKey)
        if (!instanceKeys || instanceKeys.size === 0) {
            warn(`Request group not found: ${requestGroupKey}`)
            return
        }

        await Promise.all([...instanceKeys].map((instanceKey) => this.stop(instanceKey)))
        info(`Stopped request group: ${requestGroupKey}`)
    }

    async stopGroupsWithPrefix(groupKeyPrefix: string): Promise<void> {
        const matchingGroupKeys = [...this.requestGroups.keys()].filter((groupKey) => groupKey.startsWith(groupKeyPrefix))
        if (matchingGroupKeys.length === 0) {
            return
        }

        await Promise.all(matchingGroupKeys.map((groupKey) => this.stopGroup(groupKey)))
    }

    private registerRequestGroupInstance(requestGroupKey: string, instanceKey: string): void {
        if (!this.requestGroups.has(requestGroupKey)) {
            this.requestGroups.set(requestGroupKey, new Set())
        }
        this.requestGroups.get(requestGroupKey)!.add(instanceKey)
    }

    private unregisterRequestGroupInstance(requestGroupKey: string, instanceKey: string): void {
        const instanceKeys = this.requestGroups.get(requestGroupKey)
        if (!instanceKeys) return
        instanceKeys.delete(instanceKey)
        if (instanceKeys.size === 0) {
            this.requestGroups.delete(requestGroupKey)
        }
    }

    private unregisterInstanceFromAllGroups(instanceKey: string): void {
        for (const [requestGroupKey, instanceKeys] of this.requestGroups) {
            if (!instanceKeys.delete(instanceKey)) continue
            if (instanceKeys.size === 0) {
                this.requestGroups.delete(requestGroupKey)
            }
        }
    }

    private inferRequestGroupKey(instanceKey: string): string | undefined {
        const reasoningMarkerIndex = instanceKey.indexOf(':reasoning:')
        if (reasoningMarkerIndex !== -1) return instanceKey.slice(0, reasoningMarkerIndex)

        const mediaMarkerIndex = instanceKey.indexOf(':media:')
        if (mediaMarkerIndex !== -1) return instanceKey.slice(0, mediaMarkerIndex)

        return undefined
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
        this.requestGroups.clear()
    }
}
