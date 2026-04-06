'use strict'

import { describe, it, expect } from 'vitest'
import {
    collectCanvasImageFileIds,
    reconcileFilesWithImages,
    rewriteCanvasImageNodes
} from './workspace-import-helpers.ts'

// =============================================================================
// collectCanvasImageFileIds
// =============================================================================

describe('collectCanvasImageFileIds', () => {
    it('returns fileIds from image nodes not already in the exported set', () => {
        const nodes = [
            { type: 'image', fileId: 'img-1', nodeId: 'n1' },
            { type: 'image', fileId: 'img-2', nodeId: 'n2' },
            { type: 'document', referenceId: 'doc-1', nodeId: 'n3' },
        ]
        const alreadyExported = new Set(['img-1'])

        const result = collectCanvasImageFileIds(nodes, alreadyExported)
        expect(result).toEqual(['img-2'])
    })

    it('skips non-image nodes', () => {
        const nodes = [
            { type: 'document', referenceId: 'doc-1', nodeId: 'n1' },
            { type: 'aiChatThread', referenceId: 'thread-1', nodeId: 'n2' },
        ]
        const result = collectCanvasImageFileIds(nodes, new Set())
        expect(result).toEqual([])
    })

    it('skips image nodes without a fileId', () => {
        const nodes = [
            { type: 'image', fileId: '', nodeId: 'n1' },
            { type: 'image', nodeId: 'n2' },
        ]
        const result = collectCanvasImageFileIds(nodes as any, new Set())
        expect(result).toEqual([])
    })

    it('returns empty array when all image fileIds are already exported', () => {
        const nodes = [
            { type: 'image', fileId: 'img-1', nodeId: 'n1' },
            { type: 'image', fileId: 'img-2', nodeId: 'n2' },
        ]
        const alreadyExported = new Set(['img-1', 'img-2'])
        const result = collectCanvasImageFileIds(nodes, alreadyExported)
        expect(result).toEqual([])
    })

    it('handles empty nodes array', () => {
        const result = collectCanvasImageFileIds([], new Set())
        expect(result).toEqual([])
    })
})

// =============================================================================
// reconcileFilesWithImages
// =============================================================================

describe('reconcileFilesWithImages', () => {
    it('adds missing image entries to the files array', () => {
        const files = [
            { id: 'existing-1', name: 'existing-1.png', mimeType: 'image/png' },
        ]
        const imageEntries = [
            { fileId: 'existing-1', ext: '.png' },
            { fileId: 'new-image', ext: '.jpg' },
        ]

        const added = reconcileFilesWithImages(files, imageEntries)
        expect(added).toBe(1)
        expect(files).toHaveLength(2)
        expect(files[1]).toEqual({
            id: 'new-image',
            name: 'new-image.jpg',
            mimeType: 'image/jpeg',
        })
    })

    it('does not duplicate existing entries', () => {
        const files = [
            { id: 'img-1', name: 'img-1.png', mimeType: 'image/png' },
        ]
        const imageEntries = [{ fileId: 'img-1', ext: '.png' }]

        const added = reconcileFilesWithImages(files, imageEntries)
        expect(added).toBe(0)
        expect(files).toHaveLength(1)
    })

    it('maps common extensions to correct MIME types', () => {
        const files: any[] = []
        const imageEntries = [
            { fileId: 'a', ext: '.jpg' },
            { fileId: 'b', ext: '.jpeg' },
            { fileId: 'c', ext: '.png' },
            { fileId: 'd', ext: '.gif' },
            { fileId: 'e', ext: '.webp' },
            { fileId: 'f', ext: '.svg' },
            { fileId: 'g', ext: '.avif' },
        ]

        reconcileFilesWithImages(files, imageEntries)
        expect(files.map(f => f.mimeType)).toEqual([
            'image/jpeg',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/svg+xml',
            'image/avif',
        ])
    })

    it('defaults to image/png for unknown extensions', () => {
        const files: any[] = []
        reconcileFilesWithImages(files, [{ fileId: 'x', ext: '.bmp' }])
        expect(files[0].mimeType).toBe('image/png')
    })

    it('handles empty imageEntries', () => {
        const files = [{ id: 'a', name: 'a.png', mimeType: 'image/png' }]
        const added = reconcileFilesWithImages(files, [])
        expect(added).toBe(0)
        expect(files).toHaveLength(1)
    })
})

// =============================================================================
// rewriteCanvasImageNodes
// =============================================================================

describe('rewriteCanvasImageNodes', () => {
    it('rewrites src and workspaceId on image nodes to target workspace', () => {
        const nodes = [
            { type: 'image', fileId: 'file-abc', src: '/api/images/old-ws/file-abc', workspaceId: 'old-ws', nodeId: 'n1' },
            { type: 'image', fileId: 'file-def', src: 'http://localhost/api/images/old-ws/file-def?token=stale', workspaceId: 'old-ws', nodeId: 'n2' },
        ]

        const count = rewriteCanvasImageNodes(nodes, 'new-ws-123')
        expect(count).toBe(2)
        expect(nodes[0].src).toBe('/api/images/new-ws-123/file-abc')
        expect(nodes[0].workspaceId).toBe('new-ws-123')
        expect(nodes[1].src).toBe('/api/images/new-ws-123/file-def')
        expect(nodes[1].workspaceId).toBe('new-ws-123')
    })

    it('does not touch non-image nodes', () => {
        const nodes = [
            { type: 'document', referenceId: 'doc-1', nodeId: 'n1' },
            { type: 'aiChatThread', referenceId: 'thread-1', nodeId: 'n2' },
        ]
        const count = rewriteCanvasImageNodes(nodes, 'new-ws')
        expect(count).toBe(0)
        expect(nodes[0]).not.toHaveProperty('src')
        expect(nodes[1]).not.toHaveProperty('src')
    })

    it('skips image nodes without fileId', () => {
        const nodes = [
            { type: 'image', fileId: '', nodeId: 'n1' },
        ]
        const count = rewriteCanvasImageNodes(nodes, 'new-ws')
        expect(count).toBe(0)
    })

    it('handles mixed node types', () => {
        const nodes = [
            { type: 'document', referenceId: 'doc-1', nodeId: 'n1' },
            { type: 'image', fileId: 'img-1', src: '/old', workspaceId: 'old', nodeId: 'n2' },
            { type: 'aiChatThread', referenceId: 't-1', nodeId: 'n3' },
            { type: 'image', fileId: 'img-2', src: '/old2', workspaceId: 'old', nodeId: 'n4' },
        ]

        const count = rewriteCanvasImageNodes(nodes, 'target-ws')
        expect(count).toBe(2)
        expect((nodes[1] as any).src).toBe('/api/images/target-ws/img-1')
        expect((nodes[3] as any).src).toBe('/api/images/target-ws/img-2')
    })

    it('handles empty nodes array', () => {
        const count = rewriteCanvasImageNodes([], 'ws')
        expect(count).toBe(0)
    })
})
