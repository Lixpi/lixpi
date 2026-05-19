import { describe, expect, it } from 'vitest'
import {
    getContextRegionCloudAspect,
    getContextRegionCloudBounds,
    getContextRegionCloudResizeCursor,
    getContextRegionCloudStyle,
    getContextRegionCloudTitleRect,
    hitTestContextRegionCloud,
    rectIntersectsContextRegionCloud,
    scoreRectAgainstContextRegionCloud,
    type ContextRegionCloudDatum,
} from '$src/infographics/workspace/rendering/contextRegionClouds.ts'

function makeDatum(overrides: Partial<ContextRegionCloudDatum> = {}): ContextRegionCloudDatum {
    return {
        nodeId: 'region-1',
        referenceId: 'thread-1',
        x: 100,
        y: 80,
        width: 400,
        height: 260,
        title: 'AI Chat',
        selected: false,
        ...overrides,
    }
}

// =============================================================================
// STYLE SELECTION
// =============================================================================

describe('context region clouds — style selection', () => {
    it('classifies region aspect ratios', () => {
        expect(getContextRegionCloudAspect(500, 200)).toBe('wide')
        expect(getContextRegionCloudAspect(200, 400)).toBe('tall')
        expect(getContextRegionCloudAspect(300, 280)).toBe('square')
    })

    it('selects deterministic styles for the same node and dimensions', () => {
        const first = getContextRegionCloudStyle('region-1', 400, 260)
        const second = getContextRegionCloudStyle('region-1', 400, 260)

        expect(first.key).toBe(second.key)
        expect(first.aspect).toBe('wide')
    })

    it('expands visual bounds beyond the logical region rect', () => {
        const datum = makeDatum()
        const bounds = getContextRegionCloudBounds(datum)

        expect(bounds.x).toBeLessThan(datum.x)
        expect(bounds.y).toBeLessThan(datum.y)
        expect(bounds.width).toBeGreaterThan(datum.width)
        expect(bounds.height).toBeGreaterThan(datum.height)
    })
})

// =============================================================================
// HIT TESTING
// =============================================================================

describe('context region clouds — irregular hit testing', () => {
    it('hits the cloud body at the center of the region', () => {
        const hit = hitTestContextRegionCloud(makeDatum(), { x: 300, y: 210 }, 1)

        expect(hit).toEqual({ kind: 'body', nodeId: 'region-1' })
    })

    it('rejects transparent rectangle corners outside the cloud polygon', () => {
        const datum = makeDatum()
        const bounds = getContextRegionCloudBounds(datum)
        const hit = hitTestContextRegionCloud(datum, { x: bounds.x + 4, y: bounds.y + 4 }, 1)

        expect(hit).toEqual({ kind: 'none' })
    })

    it('detects title zones before body hits', () => {
        const datum = makeDatum()
        const title = getContextRegionCloudTitleRect(datum, 1)

        expect(hitTestContextRegionCloud(datum, { x: title.x + 8, y: title.y + 8 }, 1)).toEqual({ kind: 'title', nodeId: 'region-1' })
    })

    it('detects resize hits along the irregular cloud edge', () => {
        const datum = makeDatum()
        const bounds = getContextRegionCloudBounds(datum)
        const hit = hitTestContextRegionCloud(datum, { x: bounds.x + bounds.width - 2, y: bounds.y + bounds.height * 0.62 }, 1)

        expect(hit.kind).toBe('resize')
        if (hit.kind !== 'resize') return
        expect(hit.handle).toBe('right')
        expect(hit.cursor).toBe(getContextRegionCloudResizeCursor('right'))
    })

    it('uses the cloud silhouette for selection-rect intersection', () => {
        const datum = makeDatum()
        const bounds = getContextRegionCloudBounds(datum)

        expect(rectIntersectsContextRegionCloud(datum, { x: 250, y: 180, width: 40, height: 40 })).toBe(true)
        expect(rectIntersectsContextRegionCloud(datum, { x: bounds.x + 2, y: bounds.y + 2, width: 16, height: 16 })).toBe(false)
    })
})

// =============================================================================
// ADOPTION SCORING
// =============================================================================

describe('context region clouds — adoption scoring', () => {
    it('scores a dragged rect inside the cloud higher than a rect in an empty corner', () => {
        const datum = makeDatum()
        const bounds = getContextRegionCloudBounds(datum)
        const insideScore = scoreRectAgainstContextRegionCloud(
            datum,
            { x: 230, y: 160, width: 80, height: 80 },
            { x: 270, y: 200 }
        )
        const cornerScore = scoreRectAgainstContextRegionCloud(
            datum,
            { x: bounds.x + 2, y: bounds.y + 2, width: 20, height: 20 },
            { x: bounds.x + 4, y: bounds.y + 4 }
        )

        expect(insideScore).toBeGreaterThan(0)
        expect(cornerScore).toBe(0)
        expect(insideScore).toBeGreaterThan(cornerScore)
    })
})