import { describe, it, expect } from 'vitest'
import {
    getStashedViewportStorageKey,
    encodeStashedViewport,
    parseStashedViewport,
    shouldApplyStashedViewport,
} from '$src/components/workspaceViewportStash.ts'

describe('getStashedViewportStorageKey', () => {
    it('is versioned so stashes written before the startup persistence gate are never replayed', () => {
        const key = getStashedViewportStorageKey('ws-1')
        expect(key).toBe('lixpi.pendingViewport.v2.ws-1')
        expect(key).not.toBe('lixpi.pendingViewport.ws-1')
    })
})

describe('parseStashedViewport', () => {
    it('round-trips an encoded viewport', () => {
        const viewport = { x: 925.1, y: -3041.46, zoom: 0.404 }
        expect(parseStashedViewport(encodeStashedViewport(viewport))).toEqual(viewport)
    })

    it('rejects missing, malformed, and non-finite payloads', () => {
        expect(parseStashedViewport(null)).toBeNull()
        expect(parseStashedViewport('')).toBeNull()
        expect(parseStashedViewport('not json')).toBeNull()
        expect(parseStashedViewport('{}')).toBeNull()
        expect(parseStashedViewport(JSON.stringify({ viewport: { x: 1, y: 2 } }))).toBeNull()
        expect(parseStashedViewport(JSON.stringify({ viewport: { x: Infinity, y: 0, zoom: 1 } }))).toBeNull()
        expect(parseStashedViewport(JSON.stringify({ viewport: { x: 'NaN', y: 0, zoom: 1 } }))).toBeNull()
    })
})

describe('shouldApplyStashedViewport', () => {
    it('skips the stash when the server already holds the stashed viewport (unload flush landed)', () => {
        const viewport = { x: 10, y: -20, zoom: 0.5 }
        expect(shouldApplyStashedViewport(viewport, { ...viewport })).toBe(false)
    })

    it('applies the stash when the server viewport differs or is missing', () => {
        const stashed = { x: 10, y: -20, zoom: 0.5 }
        expect(shouldApplyStashedViewport(stashed, { x: 0, y: -1, zoom: 1 })).toBe(true)
        expect(shouldApplyStashedViewport(stashed, null)).toBe(true)
        expect(shouldApplyStashedViewport(stashed, undefined)).toBe(true)
    })

    it('tolerates sub-pixel drift between stash and server', () => {
        const stashed = { x: 10, y: -20, zoom: 0.5 }
        expect(shouldApplyStashedViewport(stashed, { x: 10.0001, y: -20.0001, zoom: 0.50000001 })).toBe(false)
    })
})
