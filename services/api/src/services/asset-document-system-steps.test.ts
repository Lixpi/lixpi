import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type TransactOperation } from '@lixpi/dynamodb-service'
import { type Asset } from '@lixpi/constants'
import { DOCUMENT_TYPE, HeadlessProseMirrorEngine } from '@lixpi/prosemirror'
import NatsService from '@lixpi/nats-service'
import AssetDocumentService from './asset-document-service.ts'

const fixture = vi.hoisted(() => ({
    bytes: Buffer.from(''),
    getBlob: vi.fn(),
    storeBlob: vi.fn(),
    published: vi.fn(),
}))
vi.mock('../models/blob.ts', () => ({
    default: {
        get: fixture.getBlob,
        store: fixture.storeBlob,
    },
    buildBlobReferenceOperations: () => [],
    buildBlobReferenceRemovalOperations: async () => ({
        operations: [],
        deletionRequired: false,
    }),
}))
vi.mock('../models/asset.ts', () => ({
    default: {},
    getAssetRecord: vi.fn(),
    buildAssetProjectionOperations: async () => [],
    publishAssetEvent: fixture.published,
}))

const asset = {
    assetId: 'conversation',
    organizationId: 'org',
    revision: 12,
    documents: { conversation: {
        role: 'conversation',
        version: 7,
        blobHash: 'previous',
        schemaVersion: 'prosemirror-schema-v1',
        byteSize: 1,
        updatedAt: 1,
    } },
} as Asset
const initial = {
    type: 'doc',
    content: [{
        type: 'aiChatThread',
        attrs: { threadId: 'conversation' },
        content: [{
            type: 'aiResponseMessage',
            attrs: { id: 'message' },
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'Hello',
                }],
            }],
        }],
    }],
}

beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    fixture.bytes = Buffer.from(JSON.stringify(initial))
    fixture.getBlob.mockResolvedValue({
        bucketName: 'bucket',
        objectKey: 'object',
    })
    fixture.storeBlob.mockImplementation(async input => ({
        blobHash: 'next',
        organizationId: input.organizationId,
        blobKey: 'next',
    }))
    vi.spyOn(NatsService, 'getInstance').mockReturnValue({ getObject: async () => fixture.bytes } as unknown as NatsService)
})
afterEach(() => vi.restoreAllMocks())

describe('system document step authority', () => {
    it('persists actual step-count versions through the caller transaction with the Asset revision fence', async () => {
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
            doc: initial,
            version: 7,
        })
        const transaction = engine.state.tr.insertText(' world', 8).addMark(3, 8, engine.schema.marks.strong.create())
        const commit = vi.fn(async (_operations: TransactOperation[]) => {})
        const pointer = await AssetDocumentService.applySystemSteps({
            asset,
            role: 'conversation',
            baseVersion: 7,
            steps: transaction.steps.map(step => step.toJSON()),
            commitWith: commit,
        })
        expect(pointer.version).toBe(7 + transaction.steps.length)
        expect(JSON.parse(fixture.storeBlob.mock.calls[0][0].bytes.toString('utf8'))).toEqual(transaction.doc.toJSON())
        expect(commit).toHaveBeenCalledOnce()
        const operations = commit.mock.calls[0][0] as Array<{
            conditionExpression?: string
            expressionAttributeValues?: object
        }>
        expect(operations).toEqual(expect.arrayContaining([expect.objectContaining({
            conditionExpression: '#revision = :expectedRevision',
            expressionAttributeValues: { ':expectedRevision': 12 },
        })]))
        expect(fixture.published).toHaveBeenCalledOnce()
    })

    it('rejects a stale base before storing a replacement or committing', async () => {
        const commit = vi.fn()
        await expect(AssetDocumentService.applySystemSteps({
            asset,
            role: 'conversation',
            baseVersion: 6,
            steps: [{}],
            commitWith: commit,
        })).rejects.toThrow('SYSTEM_DOCUMENT_VERSION_CONFLICT')
        expect(fixture.storeBlob).not.toHaveBeenCalled()
        expect(commit).not.toHaveBeenCalled()
    })

    it('does not publish a snapshot after the owner transaction rejects its fence', async () => {
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONVERSATION,
            doc: initial,
            version: 7,
        })
        const step = engine.state.tr.insertText('!', 8).steps[0].toJSON()
        await expect(AssetDocumentService.applySystemSteps({
            asset,
            role: 'conversation',
            baseVersion: 7,
            steps: [step],
            commitWith: async () => { throw new Error('OWNER_LOST') },
        })).rejects.toThrow('OWNER_LOST')
        expect(fixture.published).not.toHaveBeenCalled()
    })

    it('updates the title and document together under the existing Asset revision fence', async () => {
        const commit = vi.fn(async (_operations: TransactOperation[]) => {})
        await AssetDocumentService.replaceSystemSnapshot({
            asset,
            role: 'conversation',
            doc: initial,
            version: 8,
            title: 'Named sequence',
            commitWith: commit,
        })
        expect(commit.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({
            type: 'update',
            updates: expect.objectContaining({
                title: 'Named sequence',
                revision: 13,
                documents: expect.any(Object),
            }),
            conditionExpression: '#revision = :expectedRevision',
            expressionAttributeValues: { ':expectedRevision': 12 },
        })]))
        expect(fixture.published).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            title: 'Named sequence',
            revision: 13,
        }))
    })
})
