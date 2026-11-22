import {
    describe,
    expect,
    it,
} from 'vitest'
import { computeCanvasFitViewport } from './fit.ts'

const content = {
    x: 100,
    y: 50,
    width: 400,
    height: 200,
}

describe('computeCanvasFitViewport', () => {
    it('centers content that fits without zooming past the maximum', () => {
        expect(
            computeCanvasFitViewport(
                content,
                {
                    width: 1000,
                    height: 600,
                },
            ),
        ).toEqual({
            x: 200,
            y: 150,
            zoom: 1,
        })
    })

    it('zooms out to fit the padded canvas and respects the minimum zoom', () => {
        const fitted = computeCanvasFitViewport(
            content,
            {
                width: 264,
                height: 600,
            },
            { padding: 32 },
        )!
        expect(fitted.zoom).toBeCloseTo(0.5)
        expect(fitted.x + content.x * fitted.zoom).toBeCloseTo(32)

        expect(
            computeCanvasFitViewport(
                content,
                {
                    width: 264,
                    height: 600,
                },
                { minZoom: 0.8 },
            )!.zoom,
        ).toBe(0.8)
    })

    it('pins overflowing content to the leading padding with start alignment', () => {
        const fitted = computeCanvasFitViewport(
            content,
            {
                width: 264,
                height: 600,
            },
            {
                padding: 32,
                minZoom: 1,
                alignment: 'start',
            },
        )!
        expect(fitted.x + content.x).toBe(32)
        expect(fitted.y).toBe((600 - 200) / 2 - 50)
    })

    it('returns null for a canvas without area', () => {
        expect(
            computeCanvasFitViewport(
                content,
                {
                    width: 0,
                    height: 600,
                },
            ),
        ).toBeNull()
    })
})
