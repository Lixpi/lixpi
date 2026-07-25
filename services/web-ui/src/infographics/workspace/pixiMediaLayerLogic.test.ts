'use strict'

import { describe, it, expect } from 'vitest'
import { type CanvasViewport, type CanvasNode, type ImageCanvasNode } from '@lixpi/constants'
import {
    getSafeViewportZoom,
    worldPointToScreenPoint,
    worldSizeToScreenSize,
    buildNodesById,
    computeWorldPosition,
    tierRank,
    transparentPixel,
    buildPixiImageSrc,
    isStoredImageSrc,
    resolveStoredImagePath,
    getPixiLodTier,
    addPixiLodSizeParam,
    isGeneratedImageNodeWaitingForFrame,
    makeIndexedImage,
    getVisibleWorldRect,
} from './pixiMediaLayerLogic.ts'

// =============================================================================
// pixiMediaLayerLogic
// =============================================================================

describe('pixiMediaLayerLogic', () => {
    describe('viewport zoom normalization', () => {
        it('falls back to 1 when zoom is not finite', () => {
            const viewport = { x: 10, y: 20, zoom: Number.NaN }

            expect(getSafeViewportZoom(viewport)).toBe(1)
        })

        it('floors tiny zoom values to the minimum safe floor', () => {
            const viewport = { x: 0, y: 0, zoom: 0 }

            expect(getSafeViewportZoom(viewport)).toBe(0.01)
        })

        it('keeps finite positive zoom values as-is', () => {
            const viewport = { x: 0, y: 0, zoom: 1.25 }

            expect(getSafeViewportZoom(viewport)).toBe(1.25)
        })
    })

    it('maps world coordinates and lengths to screen space with zoom normalization', () => {
        const viewport: CanvasViewport = { x: 5, y: -7, zoom: 0 }

        expect(worldPointToScreenPoint({ x: 10, y: 5 }, viewport)).toEqual({ x: 5.1, y: -6.95 })
        expect(worldSizeToScreenSize(10, viewport)).toBe(0.1)
    })

    it('builds absolute canvas node lookup maps', () => {
        const nodes: Array<CanvasNode> = [
            { nodeId: 'a', type: 'image', position: { x: 0, y: 0 }, dimensions: { width: 20, height: 20 } } as CanvasNode,
            { nodeId: 'b', type: 'video', position: { x: 5, y: 6 }, dimensions: { width: 40, height: 30 } } as CanvasNode,
        ]

        const map = buildNodesById(nodes)

        expect(map.size).toBe(2)
        expect(map.get('a')!.nodeId).toBe('a')
        expect(map.get('b')!.nodeId).toBe('b')
    })

    it('accumulates parent chain coordinates and breaks on cycles', () => {
        const parent: CanvasNode = {
            nodeId: 'parent',
            type: 'image',
            position: { x: 4, y: 8 },
            dimensions: { width: 5, height: 5 },
            parentId: 'child',
        } as CanvasNode
        const child: CanvasNode = {
            nodeId: 'child',
            type: 'image',
            position: { x: 10, y: 20 },
            dimensions: { width: 5, height: 5 },
            parentId: 'parent',
        } as CanvasNode

        const nodesById = buildNodesById([parent, child])

        expect(computeWorldPosition(child, nodesById)).toEqual({ x: 14, y: 28 })
    })

    it('ranks LoD tiers in deterministic order', () => {
        expect(tierRank('color')).toBe(0)
        expect(tierRank('thumb-256')).toBe(1)
        expect(tierRank('thumb-1024')).toBe(2)
        expect(tierRank('full')).toBe(3)
    })

    describe('image URL shaping', () => {
        it('returns a transparent fallback pixel for empty URLs', () => {
            expect(buildPixiImageSrc('', 'https://api', 'token')).toBe(transparentPixel)
        })

        it('preserves data URLs and applies token only to /api paths', () => {
            expect(buildPixiImageSrc('data:image/png,ok', 'https://api', 'token')).toBe('data:image/png,ok')
            expect(buildPixiImageSrc('/api/assets/asset-1/renditions/preview', 'https://api', 'token'))
                .toBe('https://api/api/assets/asset-1/renditions/preview?token=token')
        })

        it('detects stored image source URLs', () => {
            expect(isStoredImageSrc('/api/assets/asset-1/renditions/preview')).toBe(true)
            expect(isStoredImageSrc('https://cdn.test/api/assets/asset-1/renditions/preview')).toBe(true)
            expect(isStoredImageSrc('https://cdn.test/media/one/two')).toBe(false)
        })

        it('resolves the Asset-owned rendition path from assetId, ignoring the workspace argument', () => {
            const node: ImageCanvasNode = {
                nodeId: 'img-1',
                type: 'image',
                assetId: 'asset-id',
                dimensions: { width: 1, height: 1 },
                position: { x: 0, y: 0 },
            }

            expect(resolveStoredImagePath(node, 'workspace-override')).toBe('/api/assets/asset-id/renditions/preview')
        })

        it('URL-encodes the assetId when building the rendition path', () => {
            const node: ImageCanvasNode = {
                nodeId: 'img-2',
                type: 'image',
                assetId: 'asset/with space',
                dimensions: { width: 1, height: 1 },
                position: { x: 0, y: 0 },
            }

            expect(resolveStoredImagePath(node, 'workspace-1')).toBe('/api/assets/asset%2Fwith%20space/renditions/preview')
        })

        it('classifies media-less generated images as waiting for their first frame', () => {
            const pendingGenerated: ImageCanvasNode = {
                nodeId: 'pending-image-1',
                type: 'image',
                assetId: '',
                mediaGenerationPhase: 'pending-before-first-frame',
                dimensions: { width: 1, height: 1 },
                position: { x: 0, y: 0 },
                generatedBy: {
                    conversationAssetId: 'thread-1',
                    responseId: '',
                    aiModel: 'Anthropic:claude-sonnet-4-6',
                    revisedPrompt: 'make a mountain',
                    generationRequestId: 'request-1',
                },
            }
            const finalGenerated = { ...pendingGenerated, assetId: 'asset-1', mediaGenerationPhase: 'ready' as const }
            const uploaded = { ...pendingGenerated, assetId: 'asset-1', generatedBy: undefined }

            expect(isGeneratedImageNodeWaitingForFrame(pendingGenerated)).toBe(true)
            expect(isGeneratedImageNodeWaitingForFrame(finalGenerated)).toBe(false)
            expect(isGeneratedImageNodeWaitingForFrame(uploaded)).toBe(false)
        })

        it('maps viewport zoom to expected source LoD tiers', () => {
            expect(getPixiLodTier(0.05)).toBe('color')
            expect(getPixiLodTier(0.12)).toBe('thumb-256')
            expect(getPixiLodTier(0.7)).toBe('thumb-1024')
            expect(getPixiLodTier(1.4)).toBe('full')
        })

        it('rewrites the Asset rendition segment for the requested LoD tier and keeps existing query params', () => {
            const thumbUrl = addPixiLodSizeParam('/api/assets/asset-1/renditions/original?token=old', 'thumb-256')
            expect(thumbUrl).toBe('/api/assets/asset-1/renditions/original?token=old')

            const previewSwap = addPixiLodSizeParam('/api/assets/asset-1/renditions/thumbnail?token=old', 'thumb-1024')
            expect(previewSwap).toBe('/api/assets/asset-1/renditions/preview?token=old')

            const thumbSwap = addPixiLodSizeParam('/api/assets/asset-1/renditions/preview?token=old', 'thumb-256')
            expect(thumbSwap).toBe('/api/assets/asset-1/renditions/thumbnail?token=old')
        })

        it('leaves non-color, non-Asset URLs and the color tier untouched', () => {
            const fullUrl = addPixiLodSizeParam('/api/assets/asset-1/renditions/preview', 'color')
            expect(fullUrl).toBe('/api/assets/asset-1/renditions/preview')

            expect(addPixiLodSizeParam('https://cdn.test/not-an-api.png', 'thumb-256')).toBe('https://cdn.test/not-an-api.png')
        })
    })

    it('creates indexed image rect metadata', () => {
        const worldPoint = makeIndexedImage(
            {
                nodeId: 'img-1',
                type: 'image',
                dimensions: { width: 10, height: 20 },
                position: { x: 0, y: 0 },
            } as ImageCanvasNode,
            { x: 40, y: 60 }
        )

        expect(worldPoint).toEqual({
            minX: 40,
            minY: 60,
            maxX: 50,
            maxY: 80,
            nodeId: 'img-1',
        })
    })

    it('projects a viewport into world coordinates with margin', () => {
        const viewport: CanvasViewport = { x: 10, y: 20, zoom: 2 }

        expect(getVisibleWorldRect(viewport, { width: 200, height: 160 }, 4)).toEqual({
            minX: -9,
            minY: -14,
            maxX: 99,
            maxY: 74,
        })
    })

    it('leaves malformed LoD URL params untouched', () => {
        expect(addPixiLodSizeParam('https://bad[url', 'thumb-256')).toBe('https://bad[url')
    })
})
