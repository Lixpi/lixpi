import { describe, expect, it, vi } from 'vitest'
import { AgentModelSnapshot } from './agent-model-snapshot.ts'
import { type AgentBedrockModelProfile } from './agent-bedrock-model.ts'
import { createConversationExecutionFixture } from './conversation-test-support.ts'

const profile = {
    model: 'test-model',
    modelVersion: 'version-1',
    inferenceProviderCalledByThePlatform: 'aws-bedrock',
    contextWindow: 100_000,
    maxCompletionSize: 4096,
    inferenceCapabilities: { thinkingMode: 'none' },
    reasoningGenerationControls: [],
} as AgentBedrockModelProfile

describe('reasoning model recovery snapshots', () => {
    it('isolates preparation snapshots while preserving the root turn key', async () => {
        const {
            repository,
            payloads,
            owner,
            database,
        } = await createConversationExecutionFixture()
        const resolve = vi.fn().mockResolvedValueOnce('root-route').mockResolvedValueOnce('matrix-route-one').mockResolvedValueOnce('matrix-route-two')
        const snapshots = new AgentModelSnapshot(repository, payloads, resolve)
        await snapshots.load(owner, 'anthropic:test-model', profile)
        const first = await snapshots.load(owner, 'anthropic:test-model', profile, 'matrix#one')
        await snapshots.load(owner, 'anthropic:test-model', profile, 'matrix#two')
        expect(await snapshots.load(owner, 'anthropic:test-model', profile, 'matrix#one')).toEqual(first)
        const keys = [...database.rows.values()].map(row => String(row.sk)).filter(key => key.startsWith('MODEL_PROFILE#'))
        expect(keys).toContain('MODEL_PROFILE#turn')
        expect(keys.filter(key => /^MODEL_PROFILE#turn#[a-f0-9]{64}$/u.test(key))).toHaveLength(2)
        expect(resolve).toHaveBeenCalledTimes(3)
    })

    it('keeps transport route and controls stable across resolver and registry refreshes', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        const resolve = vi.fn().mockResolvedValue('resolved-profile-1')
        const original = await new AgentModelSnapshot(repository, payloads, resolve).load(owner, 'anthropic:test-model', profile)
        resolve.mockResolvedValue('resolved-profile-2')
        const resumed = await new AgentModelSnapshot(repository, payloads, resolve).load(owner, 'anthropic:test-model', {
            ...profile,
            contextWindow: 200_000,
        })
        expect(resumed).toEqual(original)
        expect(resolve).toHaveBeenCalledTimes(1)
    })

    it('recovers a saved route after losing its transaction acknowledgement', async () => {
        const {
            repository,
            payloads,
            owner,
            database,
        } = await createConversationExecutionFixture()
        database.failAfterCommit = true
        const snapshot = await new AgentModelSnapshot(repository, payloads, async () => 'resolved-profile').load(owner, 'anthropic:test-model', profile)
        expect(snapshot.resolvedModelId).toBe('resolved-profile')
        expect([...database.rows.values()].filter(row => String(row.sk).startsWith('MODEL_PROFILE#'))).toHaveLength(1)
    })

    it('rejects changed model versions and disabled routes before another provider request', async () => {
        const {
            repository,
            payloads,
            owner,
        } = await createConversationExecutionFixture()
        const resolve = vi.fn().mockResolvedValue('resolved-profile')
        const snapshots = new AgentModelSnapshot(repository, payloads, resolve)
        await snapshots.load(owner, 'anthropic:test-model', profile)
        await expect(snapshots.load(owner, 'anthropic:test-model', {
            ...profile,
            modelVersion: 'version-2',
        })).rejects.toThrow('AGENT_REASONING_MODEL_CHANGED')
        await expect(snapshots.load(owner, 'anthropic:test-model', {
            ...profile,
            inferenceProviderCalledByThePlatform: 'anthropic',
        })).rejects.toThrow('AGENT_REASONING_ROUTE_UNAVAILABLE')
        expect(resolve).toHaveBeenCalledTimes(1)
    })
})
