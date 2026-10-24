import { describe, expect, it } from 'vitest'
import { bakeLoadingOutline } from './loading-outline-bitmap.ts'
import { type LoadingOverlayOptions } from './loading-overlay.ts'

const texture = {
    kind: 'pixels' as const,
    size: {
        width: 1,
        height: 1,
    },
    rgba: new Uint8Array([40, 120, 200, 160]),
}
const outline: LoadingOverlayOptions['outline'] = {
    size: 100,
    snakeLengthFraction: 0.6,
    texture,
    style: {
        radius: 50,
        gap: 0,
        snakeHeadWidth: 8,
        snakeTailWidthFraction: 0.2,
        snakeTailThinLengthFraction: 0.1,
        snakeWidthTaperPower: 1,
        snakeLengthFraction: 0.6,
        snakeHeadRoundLengthFraction: 0.5,
        edgeFeatherFraction: 0.5,
        durationMs: 600,
    },
}

describe('loading outline bitmap', () => {
    it('preserves material pixels, an empty center and a gap between head and tail', () => {
        const bitmap = bakeLoadingOutline(outline, texture, 2)
        const occupiedAngles = new Set<number>()
        const center = bitmap.size / 2

        for (let y = 0; y < bitmap.size; y++) {
            for (let x = 0; x < bitmap.size; x++) {
                const offset = (y * bitmap.size + x) * 4

                if (!bitmap.rgba[offset + 3])
                    continue

                expect(Array.from(bitmap.rgba.slice(offset, offset + 4))).toEqual([40, 120, 200, 160])
                expect(Math.hypot(x - center, y - center)).toBeGreaterThan(90)
                occupiedAngles.add(Math.floor(Math.atan2(y - center, x - center) * 180 / Math.PI))
            }
        }

        expect(occupiedAngles.size).toBeGreaterThan(190)
        expect(occupiedAngles.size).toBeLessThan(240)
        expect(bitmap.rgba[(Math.floor(center) * bitmap.size + Math.floor(center)) * 4 + 3]).toBe(0)
        expect(bitmap.rgba[3]).toBe(0)
    })

    it('scales backing pixels without changing the configured display size', () => {
        const regular = bakeLoadingOutline(outline, texture, 1)
        const retina = bakeLoadingOutline(outline, texture, 2)
        expect(retina.displaySize).toBe(regular.displaySize)
        expect(retina.size).toBe(regular.size * 2)
        expect(retina.rgba.length).toBe(regular.rgba.length * 4)
    })
})
