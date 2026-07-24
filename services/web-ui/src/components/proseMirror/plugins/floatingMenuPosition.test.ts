import { describe, expect, it } from 'vitest'

import {
    resolveFloatingMenuScreenPosition,
    screenPointToLocal,
} from '$src/components/proseMirror/plugins/floatingMenuPosition.ts'

describe('floating menu positioning', () => {
    it('places a menu below the trigger when it fits', () => {
        expect(resolveFloatingMenuScreenPosition(
            { left: 200, right: 210, top: 100, bottom: 120 },
            { width: 300, height: 180 },
            { width: 1000, height: 800 },
            6,
        )).toEqual({ left: 200, top: 126, placement: 'below' })
    })

    it('flips a menu above a bottom composer instead of clipping it', () => {
        expect(resolveFloatingMenuScreenPosition(
            { left: 200, right: 210, top: 720, bottom: 740 },
            { width: 300, height: 240 },
            { width: 1000, height: 800 },
            6,
        )).toEqual({ left: 200, top: 474, placement: 'above' })
    })

    it('clamps oversized horizontal and vertical coordinates to the viewport', () => {
        expect(resolveFloatingMenuScreenPosition(
            { left: 950, right: 960, top: 10, bottom: 30 },
            { width: 300, height: 900 },
            { width: 1000, height: 800 },
            6,
        )).toEqual({ left: 692, top: 8, placement: 'below' })
    })

    it('converts a clamped screen point into transformed parent coordinates', () => {
        expect(screenPointToLocal(
            { left: 100, top: 200 },
            { left: 300, top: 500 },
            0.5,
        )).toEqual({ left: 400, top: 600 })
    })
})
