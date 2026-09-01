import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    getGeneratedMediaPreFrameLayoutRect,
    getGeneratedMediaPreFrameRect,
    getGeneratedMediaPreFrameSize,
    isCompletedGeneratedMediaCanvasNode,
    isPendingGeneratedMediaCanvasNode,
} from './generated-media-node.ts'

describe('generated media pre-frame geometry', () => {
    it('centers the configured compact footprint inside the eventual media card', () => {
        expect(getGeneratedMediaPreFrameSize({ width: 800, height: 600 }, 1 / 3)).toBe(200)
        expect(getGeneratedMediaPreFrameRect(
            { x: 100, y: 200 },
            { width: 800, height: 600 },
            1 / 3,
        )).toEqual({ x: 400, y: 400, width: 200, height: 200 })
    })

    it('falls back to the default compact scale when configuration is invalid', () => {
        expect(getGeneratedMediaPreFrameSize({ width: 800, height: 600 }, 0)).toBe(200)
    })

    it('keeps the final width while using the compact pre-frame height for tree layout', () => {
        expect(getGeneratedMediaPreFrameLayoutRect(
            { x: 100, y: 200 },
            { width: 800, height: 600 },
            1 / 3,
        )).toEqual({ x: 100, y: 400, width: 800, height: 200 })
    })

    it('treats terminal progress as authoritative over a stale pending-before-first-frame phase', () => {
        const node = {
            nodeId: 'pending-image-1',
            type: 'image',
            assetId: 'asset-1',
            position: { x: 0, y: 0 },
            dimensions: { width: 800, height: 800 },
            mediaGenerationPhase: 'pending-before-first-frame',
            generatedBy: { conversationAssetId: 'thread-1' },
            generationProgress: {
                generationRequestId: 'request-1',
                status: 'failed',
                message: 'Media generation did not start.',
                progress: {
                    phase: 'preparing',
                    completedSteps: 0,
                    totalSteps: 3,
                    message: 'Media generation did not start.',
                },
                updatedAt: 1,
            },
        } as any

        expect(isPendingGeneratedMediaCanvasNode(node)).toBe(false)
        expect(isCompletedGeneratedMediaCanvasNode(node)).toBe(true)
    })
})
