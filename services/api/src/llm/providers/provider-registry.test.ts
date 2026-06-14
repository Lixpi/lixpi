'use strict'

import { describe, expect, it, vi } from 'vitest'

import { ProviderRegistry } from './provider-registry.ts'

const makeDeps = () => ({
    natsService: { publish: vi.fn() } as any,
    storeWorkspaceImage: vi.fn(),
    storeWorkspaceVideo: vi.fn(),
})

const createFakeProvider = (resolveToken?: { release: () => void }) => {
    const providerName = 'Anthropic' as const
    const process = vi.fn(async () => {
        if (resolveToken) await new Promise<void>((resolve) => {
            resolveToken.release = resolve
        })
        return {}
    })
    const stop = vi.fn()
    const ctor = vi.fn(function() {
        return { process, stop, providerName }
    }) as any
    return { process, stop, providerName, ctor }
}

const createState = () => ({
    messages: [{ role: 'user', content: 'hi' }],
    aiModelMetaInfo: { provider: 'Anthropic', model: 'claude', modelVersion: 'claude' },
    eventMeta: {},
    workspaceId: 'ws-1',
    aiChatThreadId: 'thread-1',
    instanceKey: 'ws-1:thread-1',
    provider: 'Anthropic',
    modelVersion: 'claude',
    temperature: 0.7,
    streamActive: false,
    aiRequestReceivedAt: 1,
})

describe('ProviderRegistry', () => {
    it('creates and reuses providers by instance key, but refuses unknown providers', async () => {
        const { natsService } = makeDeps() as any
        const { ctor } = createFakeProvider()
        const registry = new ProviderRegistry(natsService, vi.fn(), vi.fn(), { Anthropic: ctor as any })
        const create = ctor

        const first = registry.getOrCreate('ws-1:thread-1', 'Anthropic')
        const second = registry.getOrCreate('ws-1:thread-1', 'Anthropic')

        expect(first).toBe(second)
        expect(create).toHaveBeenCalledOnce()
        expect(() => registry.getOrCreate('ws-1:thread-2', 'Google' as any))
            .toThrow('Unsupported provider: Google')
    })

    it('ignores duplicate process requests while one is in flight', async () => {
        const resolver = { release: () => undefined as void }
        const { process, stop, ctor } = createFakeProvider(resolver)
        const create = ctor
        const deps = makeDeps()
        const registry = new ProviderRegistry(deps.natsService, deps.storeWorkspaceImage, deps.storeWorkspaceVideo, { Anthropic: create as any })

        const first = registry.process('ws-1:thread-1', 'Anthropic', createState())
        const second = registry.process('ws-1:thread-1', 'Anthropic', createState())

        expect(process).toHaveBeenCalledOnce()
        expect(create).toHaveBeenCalledOnce()

        resolver.release()
        await first
        await second

        expect(stop).not.toHaveBeenCalled()
    })

    it('stops every instance in a request group', async () => {
        const resolver = { release: () => undefined as void }
        const { process, stop, ctor } = createFakeProvider(resolver)
        const create = ctor
        const deps = makeDeps()
        const registry = new ProviderRegistry(deps.natsService, deps.storeWorkspaceImage, deps.storeWorkspaceVideo, { Anthropic: create as any })

        const processPromise = registry.process('ws-1:thread-1', 'Anthropic', createState(), {
            requestGroupKey: 'ws-1:thread-1:group-1',
        })
        await registry.stopGroup('ws-1:thread-1:group-1')

        expect(stop).toHaveBeenCalledOnce()
        resolver.release()
        await processPromise
        expect(process).toHaveBeenCalledOnce()
    })

    it('shuts down all active providers', async () => {
        const providerA = createFakeProvider()
        const providerB = createFakeProvider()
        const create = vi.fn(function() {
            return providerA.ctor()
        }) as any
        create
            .mockImplementationOnce(function() {
                return { process: providerA.process, stop: providerA.stop, providerName: providerA.providerName }
            })
            .mockImplementationOnce(function() {
                return { process: providerB.process, stop: providerB.stop, providerName: providerB.providerName }
            })
        const deps = makeDeps()
        const registry = new ProviderRegistry(deps.natsService, deps.storeWorkspaceImage, deps.storeWorkspaceVideo, { Anthropic: create as any })

        registry.createTransient('ws:thread:image', 'Anthropic')
        registry.createTransient('ws:thread:video', 'Anthropic')
        await registry.shutdown()

        expect(providerA.stop).toHaveBeenCalledOnce()
        expect(providerB.stop).toHaveBeenCalledOnce()
        expect(registry.get('ws:thread:image')).toBeUndefined()
        expect(registry.get('ws:thread:video')).toBeUndefined()
    })
})
