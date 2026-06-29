'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Document from './document.ts'

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

const dynamo = {
    getItem: vi.fn(),
    putItem: vi.fn(),
    updateItem: vi.fn(),
    queryItems: vi.fn(),
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
// DOCUMENT MODEL — PROSEMIRROR VERSION
// =============================================================================

describe('Document.update', () => {
    it('persists proseMirrorVersion on the latest document record when provided', async () => {
        dynamo.updateItem.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated title',
            content: { type: 'doc', content: [] } as any,
            proseMirrorVersion: 9,
        })

        expect(dynamo.updateItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            key: { documentId: 'document-1', revision: 1 },
            updates: expect.objectContaining({
                title: 'Updated title',
                content: { type: 'doc', content: [] },
                proseMirrorVersion: 9,
                updatedAt: expect.any(Number),
            }),
            origin: 'updateDocument',
        }))
        expect(dynamo.updateItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            key: { documentId: 'document-1' },
            origin: 'updateDocument',
        }))
        expect(Object.hasOwn(dynamo.updateItem.mock.calls[1]?.[0].updates, 'proseMirrorVersion')).toBe(false)
    })

    it('does not write proseMirrorVersion when it is omitted', async () => {
        dynamo.updateItem.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated title',
            content: { type: 'doc', content: [] } as any,
        })

        expect(Object.hasOwn(dynamo.updateItem.mock.calls[0]?.[0].updates, 'proseMirrorVersion')).toBe(false)
    })

    it('omits undefined document fields from partial updates', async () => {
        dynamo.updateItem.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            title: 'Updated title',
        })

        expect(dynamo.updateItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            updates: expect.objectContaining({
                title: 'Updated title',
                updatedAt: expect.any(Number),
            }),
        }))
        expect(Object.hasOwn(dynamo.updateItem.mock.calls[0]?.[0].updates, 'content')).toBe(false)
        expect(dynamo.updateItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
            updates: expect.objectContaining({
                title: 'Updated title',
                updatedAt: expect.any(Number),
            }),
        }))

        vi.clearAllMocks()
        dynamo.updateItem.mockResolvedValue(undefined)

        await Document.update({
            workspaceId: 'workspace-1',
            documentId: 'document-1',
            content: { type: 'doc', content: [] } as any,
        })

        expect(dynamo.updateItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
            updates: expect.objectContaining({
                content: { type: 'doc', content: [] },
                updatedAt: expect.any(Number),
            }),
        }))
        expect(Object.hasOwn(dynamo.updateItem.mock.calls[0]?.[0].updates, 'title')).toBe(false)
        expect(Object.hasOwn(dynamo.updateItem.mock.calls[1]?.[0].updates, 'title')).toBe(false)
    })
})
