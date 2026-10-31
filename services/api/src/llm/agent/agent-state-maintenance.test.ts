import { describe, expect, it, vi } from 'vitest'
import { AgentStateMaintenance, retainedAgentStatePayloads } from './agent-state-maintenance.ts'
import { AtomicConversationTestDatabase } from './conversation-test-support.ts'
import { ConversationRepository, conversationPartition } from './conversation-repository.ts'
import { type AgentPayload } from './agent-payload-store.ts'
import { type Asset } from '@lixpi/constants'

const releases = vi.hoisted(() => ({
    payload: vi.fn(async () => ({
        operations: [],
        afterCommit: async () => {},
    })),
    reference: vi.fn(async () => ({
        operations: [],
        deletionRequired: false,
    })),
}))
vi.mock('./agent-payload-store.ts', () => ({ AgentPayloadStore: class { release = releases.payload } }))
vi.mock('../../models/blob.ts', () => ({ buildBlobReferenceRemovalOperations: releases.reference }))
vi.mock('../../services/asset-maintenance-queue.ts', () => ({ enqueueBlobDeletion: vi.fn() }))

const payload: AgentPayload = {
    type: 'json',
    hash: 'hash',
    byteSize: 1,
    blobHash: 'hash',
}

describe('agent state retention', () => {
    it('releases both native operation payloads and versioned message attribution owners', () => {
        expect(retainedAgentStatePayloads({
            sk: 'OPERATION#operation',
            request: payload,
            response: {
                ...payload,
                hash: 'response',
            },
        })).toEqual([
            {
                payload,
                ownerKey: 'operation#operation#request',
            },
            {
                payload: {
                    ...payload,
                    hash: 'response',
                },
                ownerKey: 'operation#operation#response',
            },
        ])
        expect(retainedAgentStatePayloads({
            sk: 'MESSAGE_CONTEXT#message',
            revision: 3,
            payload,
        })).toEqual([{
            payload,
            ownerKey: 'message-context#message#3',
        }])
        expect(retainedAgentStatePayloads({ sk: 'PIPELINE_PROMPTS#turn#preparation' })).toEqual([])
        expect(retainedAgentStatePayloads({
            sk: 'DOCUMENT_STEPS#0000000000000001',
            payload,
        })).toEqual([{
            payload,
            ownerKey: 'DOCUMENT_STEPS#0000000000000001',
        }])
    })

    it('uses the injected retention resolver and removes paginated retry and prompt records', async () => {
        const database = new AtomicConversationTestDatabase()
        const repository = new ConversationRepository(database as never, 'AgentConversations')
        const partition = conversationPartition('org', 'conversation')
        await repository.commit([
            repository.put(partition, 'META', { revision: 1 }),
            repository.put(partition, 'PIPELINE#retry', {
                revision: 4,
                payload,
            }),
            repository.put(partition, 'PIPELINE_PROMPTS#turn#preparation', { inputHash: 'prepared-prompt' }),
            repository.put(partition, 'PIPELINE_COMPLETION#retry', { notified: true }),
            repository.put(partition, 'DOCUMENT_STEPS#0000000000000001', { payload }),
            repository.put(partition, 'TOOL_RESULT#context#result', { payload }),
        ])
        const resolver = vi.fn(row => row.sk.startsWith('PIPELINE#') ? [{
            payload: row.payload!,
            ownerKey: `${row.sk}#${row.revision}`,
        }] : [])
        await new AgentStateMaintenance(repository, resolver).deleteAsset({
            assetId: 'conversation',
            organizationId: 'org',
            originWorkspaceId: 'workspace',
            conversationRuntime: 'deep-agents',
        } as Asset)
        expect(releases.payload).toHaveBeenCalledWith(payload, 'PIPELINE#retry#4')
        expect(releases.payload).toHaveBeenCalledWith(payload, 'DOCUMENT_STEPS#0000000000000001')
        expect(releases.payload).toHaveBeenCalledWith(payload, 'TOOL_RESULT#context#result')
        expect(database.rows.size).toBe(0)
        expect(resolver.mock.calls.map(([row]) => row.sk)).toContain('PIPELINE_PROMPTS#turn#preparation')
    })
})
