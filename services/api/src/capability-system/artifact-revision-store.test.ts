import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type TransactOperation } from '@lixpi/dynamodb-service'
import { type CapabilityArtifactSharedDefinition } from '@lixpi/capability-system/shared'
import { ArtifactRevisionStore } from './artifact-revision-store.ts'
import { type ConversationRepository } from '../llm/agent/conversation-repository.ts'

const mocks = vi.hoisted(() => ({
    getAsset: vi.fn(),
    prepareCreate: vi.fn(),
    authorize: vi.fn(),
    preparePayload: vi.fn(),
    replaceSnapshot: vi.fn(),
}))
vi.mock('../models/asset.ts', () => ({
    default: {
        get: mocks.getAsset,
        prepareCreate: mocks.prepareCreate,
    },
    publishAssetEvent: vi.fn(),
}))
vi.mock('../models/blob.ts', () => ({ default: { store: vi.fn(async () => ({ blobHash: 'document' })) } }))
vi.mock('../services/asset-document-service.ts', () => ({ default: { replaceSystemSnapshot: mocks.replaceSnapshot } }))
vi.mock('../llm/agent/conversation-adapters.ts', () => ({ ConversationAdapters: class { authorize = mocks.authorize } }))
vi.mock('../llm/agent/agent-payload-store.ts', () => ({ AgentPayloadStore: class { prepare = mocks.preparePayload } }))

const operation = (key: string, tableName = 'Rows'): TransactOperation => ({
    type: 'put',
    tableName,
    item: {
        pk: key,
        sk: 'record',
    },
})
const operations = (prefix: string, count: number): TransactOperation[] => Array.from({ length: count }, (_, index) => operation(`${prefix}-${index}`))
const access = {
    userId: 'user',
    organizationId: 'org',
    workspaceId: 'workspace',
}
const definition = {
    artifactTypeId: 'test',
    schemaVersion: 1,
    assertInitialDocument: vi.fn(),
} as unknown as CapabilityArtifactSharedDefinition
const fixture = () => {
    const commit = vi.fn(async (_operations: TransactOperation[]) => {})
    const repository = {
        commit,
        put: (_pk: string, sk: string) => operation(sk),
    } as unknown as ConversationRepository
    const store = new ArtifactRevisionStore(repository)
    const input = {
        access,
        assetId: 'sequence',
        title: 'Sequence',
        expectedRevision: 0,
        revision: 1,
        clientMutationId: 'edit',
        value: {},
        document: {},
        definition,
        fences: async () => operations('fence', 3),
    }

    return {
        commit,
        store,
        input,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAsset.mockResolvedValue({ error: 'NOT_FOUND' })
    mocks.authorize.mockResolvedValue({
        ...access,
        fences: [operation('workspace', 'Workspaces')],
    })
    mocks.preparePayload.mockResolvedValue({
        payload: {
            type: 'json',
            hash: 'hash',
            byteSize: 100000,
            blobHash: 'payload',
        },
        operations: operations('payload', 2),
    })
    mocks.prepareCreate.mockResolvedValue({
        asset: {},
        operations: [operation('workspace', 'Workspaces'), ...operations('asset', 8)],
    })
})

describe('artifact transaction budgets', () => {
    it('atomically commits all 24 unique source pins and fences with the create bookkeeping', async () => {
        const {
            store,
            input,
            commit,
        } = fixture()
        const sourceOperations = operations('source', 24 * 3)
        await expect(store.commit({
            ...input,
            additionalOperations: [...sourceOperations, operation('created')],
        })).resolves.toBe(true)
        const transaction = commit.mock.calls[0][0] as unknown as TransactOperation[]
        expect(transaction).toHaveLength(89)
        expect(transaction).toEqual(expect.arrayContaining(sourceOperations))
    })

    it('reserves the admission fence and rejects overflow without committing partial state', async () => {
        const {
            store,
            input,
            commit,
        } = fixture()
        await expect(store.commit({
            ...input,
            additionalOperations: operations('source', 83),
        })).resolves.toBe(true)
        expect(commit.mock.calls[0][0]).toHaveLength(99)
        commit.mockClear()
        await expect(store.commit({
            ...input,
            additionalOperations: operations('source', 84),
        })).rejects.toThrow('ARTIFACT_TRANSACTION_LIMIT')
        expect(commit).not.toHaveBeenCalled()
    })

    it('includes every Asset projection when bounding a revision update', async () => {
        const {
            store,
            input,
            commit,
        } = fixture()
        mocks.getAsset.mockResolvedValue({
            organizationId: 'org',
            states: { lifecycle: 'active' },
            artifact: { artifactTypeId: 'test' },
        })
        mocks.replaceSnapshot.mockImplementation(async request => request.commitWith(operations('projection', 24)))
        await expect(store.commit({
            ...input,
            expectedRevision: 1,
            revision: 2,
            additionalOperations: operations('source', 72),
        })).rejects.toThrow('ARTIFACT_TRANSACTION_LIMIT')
        expect(commit).not.toHaveBeenCalled()
    })

    it('passes the canonical title into the same snapshot and revision transaction', async () => {
        const {
            store,
            input,
            commit,
        } = fixture()
        mocks.getAsset.mockResolvedValue({
            organizationId: 'org',
            states: { lifecycle: 'active' },
            artifact: { artifactTypeId: 'test' },
        })
        mocks.replaceSnapshot.mockImplementation(async request => request.commitWith([operation('asset')]))
        await expect(store.commit({
            ...input,
            title: 'Named sequence',
            expectedRevision: 1,
            revision: 2,
        })).resolves.toBe(true)
        expect(mocks.replaceSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Named sequence',
            version: 2,
            commitWith: expect.any(Function),
        }))
        expect(commit).toHaveBeenCalledOnce()
    })
})
