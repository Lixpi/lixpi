'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Document from './document.ts'

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

const dynamo = {
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    queryItems: vi.fn(),
    transactWrite: vi.fn(),
}

beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.clearAllMocks()
    ;(globalThis as any).dynamoDBService = dynamo
})

afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
})

// =============================================================================
// DOCUMENT MODEL — WORKSPACE-PARTITIONED KEY + TRANSACTIONAL WRITES
// =============================================================================

describe('Document.update', () => {
    it('persists proseMirrorVersion on the document record when provided', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated title',
            content: { type: 'doc', content: [] } as any,
            proseMirrorVersion: 9,
        })

        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const { operations, origin } = dynamo.transactWrite.mock.calls[0][0]
        expect(origin).toBe('updateDocument')
        expect(operations[0]).toMatchObject({
            type: 'update',
            key: { workspaceId: 'workspace-1', documentId: 'document-1' },
            updates: expect.objectContaining({
                title: 'Updated title',
                content: { type: 'doc', content: [] },
                proseMirrorVersion: 9,
                updatedAt: expect.any(Number),
            }),
        })
        expect(operations[1]).toMatchObject({
            type: 'update',
            key: { documentId: 'document-1' },
        })
        expect(Object.hasOwn(operations[1].updates, 'proseMirrorVersion')).toBe(false)
    })

    it('does not write proseMirrorVersion when it is omitted', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated title',
            content: { type: 'doc', content: [] } as any,
        })

        const { operations } = dynamo.transactWrite.mock.calls[0][0]
        expect(Object.hasOwn(operations[0].updates, 'proseMirrorVersion')).toBe(false)
    })

    it('omits undefined document fields from partial updates', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated title',
        })

        let { operations } = dynamo.transactWrite.mock.calls[0][0]
        expect(operations[0].updates).toMatchObject({
            title: 'Updated title',
            updatedAt: expect.any(Number),
        })
        expect(Object.hasOwn(operations[0].updates, 'content')).toBe(false)
        expect(operations[1].updates).toMatchObject({
            title: 'Updated title',
            updatedAt: expect.any(Number),
        })

        vi.clearAllMocks()
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            content: { type: 'doc', content: [] } as any,
        })

        ;({ operations } = dynamo.transactWrite.mock.calls[0][0])
        expect(operations[0].updates).toMatchObject({
            content: { type: 'doc', content: [] },
            updatedAt: expect.any(Number),
        })
        expect(Object.hasOwn(operations[0].updates, 'title')).toBe(false)
        expect(Object.hasOwn(operations[1].updates, 'title')).toBe(false)
    })
})

describe('Document.getDocument', () => {
    it('point-reads the document by workspace partition and document id', async () => {
        dynamo.getItem.mockResolvedValue({ documentId: 'document-1', workspaceId: 'workspace-1' })

        const document = await Document.getDocument({ workspaceId: 'workspace-1', documentId: 'document-1' })

        expect(dynamo.getItem).toHaveBeenCalledWith(expect.objectContaining({
            key: { workspaceId: 'workspace-1', documentId: 'document-1' },
        }))
        expect(document).toEqual({ documentId: 'document-1', workspaceId: 'workspace-1' })
    })

    it('normalizes missing documents into NOT_FOUND', async () => {
        dynamo.getItem.mockResolvedValue(undefined)

        await expect(Document.getDocument({ workspaceId: 'workspace-1', documentId: 'missing' }))
            .resolves.toEqual({ error: 'NOT_FOUND' })
    })
})

describe('Document.getWorkspaceDocuments', () => {
    it('queries the workspace partition and returns documents newest-first', async () => {
        dynamo.queryItems.mockResolvedValue({
            items: [
                { documentId: 'doc-a', updatedAt: 10 },
                { documentId: 'doc-b', updatedAt: 40 },
                { documentId: 'doc-c', updatedAt: 30 },
            ],
        })

        const documents = await Document.getWorkspaceDocuments({ workspaceId: 'workspace-1' })

        expect(dynamo.queryItems).toHaveBeenCalledWith(expect.objectContaining({
            keyConditions: { workspaceId: 'workspace-1' },
            fetchAllItems: true,
        }))
        expect(dynamo.queryItems.mock.calls[0][0]).not.toHaveProperty('indexName')
        expect(documents.map((doc: any) => doc.documentId)).toEqual(['doc-b', 'doc-c', 'doc-a'])
    })
})

describe('Document.createDocument', () => {
    it('writes Main and Meta rows in a single transaction keyed by the workspace partition', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        const created = await Document.createDocument({
            workspaceId: 'workspace-1',
            title: 'Q3 Plan',
            content: { type: 'doc', content: [] } as any,
        })

        expect(dynamo.transactWrite).toHaveBeenCalledTimes(1)
        const { operations } = dynamo.transactWrite.mock.calls[0][0]
        expect(operations).toHaveLength(2)
        expect(operations[0].type).toBe('put')
        expect(operations[0].item.workspaceId).toBe('workspace-1')
        expect(operations[0].item.documentId).toBe(created!.documentId)
        expect(operations[1].type).toBe('put')
        expect(operations[1].item.documentId).toBe(created!.documentId)
    })

    it('returns undefined when the transaction fails, leaving neither a Main nor a Meta row', async () => {
        dynamo.transactWrite.mockRejectedValue(new Error('cancelled'))

        const created = await Document.createDocument({
            workspaceId: 'workspace-1',
            title: 'Q3 Plan',
            content: { type: 'doc', content: [] } as any,
        })

        expect(created).toBeUndefined()
    })
})

describe('Document.delete', () => {
    it('deletes the Main row and the Meta row in one transaction', async () => {
        dynamo.transactWrite.mockResolvedValue(undefined)

        await Document.delete({ documentId: 'document-1', workspaceId: 'workspace-1' })

        const { operations } = dynamo.transactWrite.mock.calls[0][0]
        expect(operations[0]).toMatchObject({
            type: 'delete',
            key: { workspaceId: 'workspace-1', documentId: 'document-1' },
        })
        expect(operations[1]).toMatchObject({
            type: 'delete',
            key: { documentId: 'document-1' },
        })
    })
})

describe('Document.deleteWorkspaceDocuments', () => {
    it('deletes each document row and its meta row transactionally', async () => {
        dynamo.queryItems.mockResolvedValue({
            items: [
                { documentId: 'doc-a' },
                { documentId: 'doc-b' },
            ],
        })
        dynamo.transactWrite.mockResolvedValue(undefined)

        const deleted = await Document.deleteWorkspaceDocuments({ workspaceId: 'workspace-1' })

        expect(deleted).toBe(2)
        expect(dynamo.transactWrite).toHaveBeenCalledTimes(2)
        expect(dynamo.transactWrite.mock.calls[0][0].operations).toEqual([
            expect.objectContaining({ type: 'delete', key: { workspaceId: 'workspace-1', documentId: 'doc-a' } }),
            expect.objectContaining({ type: 'delete', key: { documentId: 'doc-a' } }),
        ])
    })
})
