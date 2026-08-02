'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as debugTools from '@lixpi/debug-tools'
import { PROVIDER_NAMES, type ProviderName } from '@lixpi/constants'

import { ProviderRegistry } from './provider-registry.ts'
import {
    compileProviderSafeIntent,
    normalizeProviderProblem,
    type MediaProviderDefinition,
} from './media-provider-definition.ts'

let debugInfoSpy: ReturnType<typeof vi.spyOn> | null = null
let debugWarnSpy: ReturnType<typeof vi.spyOn> | null = null
let debugErrSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    debugInfoSpy = vi.spyOn(debugTools, 'info').mockImplementation(() => undefined)
    debugWarnSpy = vi.spyOn(debugTools, 'warn').mockImplementation(() => undefined)
    debugErrSpy = vi.spyOn(debugTools, 'err').mockImplementation(() => undefined)
})

afterEach(() => {
    debugInfoSpy?.mockRestore()
    debugInfoSpy = null
    debugWarnSpy?.mockRestore()
    debugWarnSpy = null
    debugErrSpy?.mockRestore()
    debugErrSpy = null
})

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

const createDefinition = (provider: ProviderName, constructor: any): MediaProviderDefinition => ({
    provider,
    constructor,
    mediaCapabilities: provider === 'Anthropic' ? [] : ['image'],
    referenceRules: {
        aliases: 'positional-reference',
        supportedInputs: ['text', 'image', 'video'],
        compile: compileProviderSafeIntent,
    },
    moderation: {
        policy: provider === 'OpenAI' ? 'low'
            : provider === 'Google' ? 'input-mode-least-restrictive' : 'fixed-provider-policy',
        settings: (_modelId, inputMode) => provider === 'OpenAI'
            ? { moderation: 'low' }
            : provider === 'Google' ? {
                personGeneration: inputMode === 'image-conditioned' ? 'allow_adult' : 'allow_all',
            } : {},
        automaticRetry: 'never',
        costOnFilter: 'not-documented',
    },
    normalizeProblem: (error, context) => normalizeProviderProblem({ provider, error, context }),
    verification: provider === 'BytePlus'
        ? { strategy: 'provider-hosted-session', derivativeReuse: 'documented-lineage' }
        : { strategy: 'unsupported', derivativeReuse: 'not-allowed' },
    retentionNotes: 'Test retention policy.',
    sensitiveDataNotes: 'Test sensitive-data policy.',
    documentationUrls: ['https://docs.anthropic.com/'],
    reviewedAt: '2026-07-28',
    profileVersion: `${provider.toLowerCase()}-test-v1`,
})

const createDefinitions = (anthropicConstructor: any): Record<ProviderName, MediaProviderDefinition> =>
    Object.fromEntries(PROVIDER_NAMES.map(provider => [
        provider,
        createDefinition(provider, provider === 'Anthropic' ? anthropicConstructor : createFakeProvider().ctor),
    ])) as Record<ProviderName, MediaProviderDefinition>

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
        const registry = new ProviderRegistry(natsService, createDefinitions(ctor))
        const create = ctor

        const first = registry.getOrCreate('ws-1:thread-1', 'Anthropic')
        const second = registry.getOrCreate('ws-1:thread-1', 'Anthropic')

        expect(first).toBe(second)
        expect(create).toHaveBeenCalledOnce()
        expect(() => registry.getOrCreate('ws-1:thread-2', 'Unknown' as any))
            .toThrow('Unsupported provider: Unknown')
    })

    it('ignores duplicate process requests while one is in flight', async () => {
        const resolver = { release: () => undefined as void }
        const { process, stop, ctor } = createFakeProvider(resolver)
        const create = ctor
        const deps = makeDeps()
        const registry = new ProviderRegistry(deps.natsService, createDefinitions(create))

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
        const registry = new ProviderRegistry(deps.natsService, createDefinitions(create))

        const processPromise = registry.process('ws-1:thread-1', 'Anthropic', createState(), {
            requestGroupKey: 'ws-1:thread-1:group-1',
        })
        const stopGroupPromise = registry.stopGroup('ws-1:thread-1:group-1')
        resolver.release()
        await stopGroupPromise

        expect(stop).toHaveBeenCalledOnce()
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
        const registry = new ProviderRegistry(deps.natsService, createDefinitions(create))

        registry.createTransient('ws:thread:image', 'Anthropic')
        registry.createTransient('ws:thread:video', 'Anthropic')
        await registry.shutdown()

        expect(providerA.stop).toHaveBeenCalledOnce()
        expect(providerB.stop).toHaveBeenCalledOnce()
        expect(registry.get('ws:thread:image')).toBeUndefined()
        expect(registry.get('ws:thread:video')).toBeUndefined()
    })

    it('stops requests by inferred media key from instanceKey when no request group is passed', async () => {
        const resolver = { release: () => undefined as void }
        const { stop, ctor } = createFakeProvider(resolver)
        const deps = makeDeps()
        const registry = new ProviderRegistry(deps.natsService, createDefinitions(ctor))

        registry.createTransient('ws-1:thread-1:reasoning:alpha', 'Anthropic')
        await registry.stopGroupsWithPrefix('ws-1:thread-1')

        expect(stop).toHaveBeenCalledOnce()
    })

    it('does not stop unknown groups, and no-op is safe', async () => {
        const deps = makeDeps()
        const registry = new ProviderRegistry(deps.natsService, createDefinitions(createFakeProvider().ctor))
        await expect(registry.stopGroup('missing-group')).resolves.toBeUndefined()
        await expect(registry.stopGroupsWithPrefix('never-present')).resolves.toBeUndefined()
    })

    it('rejects legacy constructor-only provider registration', () => {
        const { ctor } = createFakeProvider()
        const definitions = createDefinitions(ctor) as any
        definitions.Anthropic = ctor
        expect(() => new ProviderRegistry(makeDeps().natsService, definitions))
            .toThrow('MEDIA_PROVIDER_CONSTRUCTOR_REQUIRED')
    })
})
