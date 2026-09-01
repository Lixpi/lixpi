'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    FreeformGradientRenderer,
    type FreeformGradientColor,
    type FreeformGradientPoint,
} from './freeformGradient.ts'

function makeImageData(width: number, height: number): ImageData {
    return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
    } as ImageData
}

function readPixel(imageData: ImageData, x: number, y: number): FreeformGradientColor & { a: number } {
    const index = (y * imageData.width + x) * 4
    return {
        r: imageData.data[index],
        g: imageData.data[index + 1],
        b: imageData.data[index + 2],
        a: imageData.data[index + 3],
    }
}

describe('FreeformGradientRenderer', () => {
    const colors: FreeformGradientColor[] = [
        { r: 255, g: 0, b: 0 },
        { r: 0, g: 255, b: 0 },
        { r: 0, g: 0, b: 255 },
        { r: 255, g: 255, b: 255 },
    ]

    it('exposes the shared bitmap and phase constants used by canvas and PIXI renderers', () => {
        expect(FreeformGradientRenderer.bitmapSize).toEqual({ width: 60, height: 80 })
        expect(FreeformGradientRenderer.initialPhase).toBe(4)
        expect(FreeformGradientRenderer.phasePositions).toHaveLength(8)
    })

    it('parses hex color sets into RGB colors', () => {
        expect(FreeformGradientRenderer.hexToColor('#A7C39A')).toEqual({ r: 167, g: 195, b: 154 })
        expect(FreeformGradientRenderer.parseHexColors(['#000000', '#112233', '#AABBCC', '#FFFFFF'])).toEqual([
            { r: 0, g: 0, b: 0 },
            { r: 17, g: 34, b: 51 },
            { r: 170, g: 187, b: 204 },
            { r: 255, g: 255, b: 255 },
        ])
    })

    it('selects four alternating phase positions from the eight-point path', () => {
        expect(FreeformGradientRenderer.getPhasePositions(4)).toEqual([
            { x: 0.2, y: 0.9 },
            { x: 0.65, y: 0.75 },
            { x: 0.8, y: 0.1 },
            { x: 0.35, y: 0.25 },
        ])
    })

    it('wraps previous phase selection around the phase path', () => {
        expect(FreeformGradientRenderer.getPreviousPhase(4)).toBe(3)
        expect(FreeformGradientRenderer.getPreviousPhase(0)).toBe(7)
    })

    it('samples weighted colors within the source color channel bounds', () => {
        const sample = FreeformGradientRenderer.sampleColor(
            0.5,
            0.5,
            colors,
            FreeformGradientRenderer.getPhasePositions(4),
        )

        expect(sample.r).toBeGreaterThanOrEqual(0)
        expect(sample.r).toBeLessThanOrEqual(255)
        expect(sample.g).toBeGreaterThanOrEqual(0)
        expect(sample.g).toBeLessThanOrEqual(255)
        expect(sample.b).toBeGreaterThanOrEqual(0)
        expect(sample.b).toBeLessThanOrEqual(255)
    })

    it('falls back to the first color when there are no usable positions', () => {
        expect(FreeformGradientRenderer.sampleColor(0.5, 0.5, colors, [])).toEqual(colors[0])
        expect(FreeformGradientRenderer.sampleColor(0.5, 0.5, [], [])).toEqual({ r: 0, g: 0, b: 0 })
    })

    it('paints image data with opaque, non-flat freeform gradient pixels', () => {
        const imageData = makeImageData(12, 10)

        FreeformGradientRenderer.paintImageData(imageData, colors, FreeformGradientRenderer.getPhasePositions(4))

        for (let index = 3; index < imageData.data.length; index += 4) {
            expect(imageData.data[index]).toBe(255)
        }

        const topLeft = readPixel(imageData, 0, 0)
        const center = readPixel(imageData, 6, 5)
        const bottomRight = readPixel(imageData, 11, 9)

        expect(topLeft).not.toEqual(center)
        expect(bottomRight).not.toEqual(center)
    })

    it('draws a bitmap through a supplied canvas context', () => {
        const ctx = {
            createImageData: vi.fn((width: number, height: number) => makeImageData(width, height)),
            putImageData: vi.fn(),
        }
        const positions: FreeformGradientPoint[] = FreeformGradientRenderer.getPhasePositions(4)

        const imageData = FreeformGradientRenderer.drawBitmap(
            ctx as unknown as CanvasRenderingContext2D,
            { width: 6, height: 5 },
            colors,
            positions,
        )

        expect(ctx.createImageData).toHaveBeenCalledWith(6, 5)
        expect(ctx.putImageData).toHaveBeenCalledWith(imageData, 0, 0)
        expect(imageData.width).toBe(6)
        expect(imageData.height).toBe(5)
    })
})
