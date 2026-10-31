import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createHash } from 'node:crypto'
import { AgentPayloadStore } from './agent-payload-store.ts'

const ports = vi.hoisted(() => ({
    store: vi.fn(),
    references: vi.fn(),
    removeReferences: vi.fn(),
    read: vi.fn(),
    deleteBlob: vi.fn(),
}))
vi.mock('../../models/blob.ts', () => ({
    default: { store: ports.store },
    buildBlobReferenceOperations: ports.references,
    buildBlobReferenceRemovalOperations: ports.removeReferences,
}))
vi.mock('../../services/blob-storage.ts', () => ({ getContentAddressedBlob: ports.read }))
vi.mock('../../services/asset-maintenance-queue.ts', () => ({ enqueueBlobDeletion: ports.deleteBlob }))

beforeEach(() => {
    vi.clearAllMocks()
    ports.store.mockImplementation(async ({
        bytes,
        organizationId,
    }) => {
        const blobHash = createHash('sha256').update(bytes).digest('hex')

        return {
            blobHash,
            blobKey: `${organizationId}:${blobHash}`,
            organizationId,
        }
    })
    ports.references.mockReturnValue([{
        type: 'check',
        tableName: 'Blobs',
        key: { blob: 'reference' },
    }])
    ports.removeReferences.mockResolvedValue({
        operations: [{
            type: 'delete',
            tableName: 'Blobs',
            key: { blob: 'reference' },
        }],
        deletionRequired: true,
    })
    ports.deleteBlob.mockResolvedValue(undefined)
})

// =============================================================================
// CONTENT INTEGRITY AND TRANSACTIONAL BLOB REFERENCES
// =============================================================================

describe('agent payload store', () => {
    it('keeps small state inline and detects size or hash corruption', async () => {
        const store = new AgentPayloadStore('org', 'conversation')
        const bytes = new Uint8Array(48000).fill(7)
        const {
            payload,
            operations,
        } = await store.prepare('json', bytes, 'checkpoint')
        expect(payload.inline).toBeDefined()
        expect(payload.blobHash).toBeUndefined()
        expect(operations).toEqual([])
        expect(await store.read(payload)).toEqual(Buffer.from(bytes))
        await expect(store.read({
            ...payload,
            byteSize: 1,
        })).rejects.toThrow('AGENT_PAYLOAD_CORRUPT')
        await expect(store.read({
            ...payload,
            hash: 'f'.repeat(64),
        })).rejects.toThrow('AGENT_PAYLOAD_CORRUPT')
        expect(ports.store).not.toHaveBeenCalled()
    })

    it('returns reference operations for large payloads without committing them separately', async () => {
        const store = new AgentPayloadStore('org', 'conversation')
        const bytes = new Uint8Array(48001).fill(9)
        const first = await store.prepare('json', bytes, 'checkpoint-1')
        const second = await store.prepare('json', bytes, 'checkpoint-2')
        expect(first.payload.inline).toBeUndefined()
        expect(first.payload.blobHash).toBe(first.payload.hash)
        expect(first.operations).toHaveLength(1)
        const firstReference = ports.references.mock.calls[0][0].reference
        const secondReference = ports.references.mock.calls[1][0].reference
        expect(firstReference).toMatchObject({
            organizationId: 'org',
            ownerType: 'asset',
            ownerId: 'conversation',
            blobHash: first.payload.hash,
        })
        expect(firstReference.referenceKey).not.toBe(secondReference.referenceKey)
        ports.read.mockResolvedValue(bytes)
        expect(await store.read(second.payload)).toEqual(bytes)
        expect(ports.read).toHaveBeenCalledWith({
            organizationId: 'org',
            blobHash: first.payload.hash,
        })
    })

    it('defers Blob deletion until reference removal commits and preserves shared Blobs', async () => {
        const store = new AgentPayloadStore('org', 'conversation')
        const prepared = await store.prepare('json', new Uint8Array(48001), 'checkpoint')
        const released = await store.release(prepared.payload, 'checkpoint')
        expect(released.operations).toHaveLength(1)
        expect(ports.deleteBlob).not.toHaveBeenCalled()
        await released.afterCommit()
        expect(ports.deleteBlob).toHaveBeenCalledWith({
            organizationId: 'org',
            blobHash: prepared.payload.blobHash,
        })
        ports.removeReferences.mockResolvedValueOnce({
            operations: [],
            deletionRequired: false,
        })
        const shared = await store.release(prepared.payload, 'another-checkpoint')
        await shared.afterCommit()
        expect(ports.deleteBlob).toHaveBeenCalledTimes(1)
    })
})
