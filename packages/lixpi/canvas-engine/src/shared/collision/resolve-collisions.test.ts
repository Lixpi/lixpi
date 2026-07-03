'use strict'

import { describe, expect, it, vi } from 'vitest'

import {
    resolveCollisions,
    type CollisionBox,
} from './resolve-collisions.ts'

// =============================================================================
// BASE COLLISION RESOLUTION
// =============================================================================

describe('resolveCollisions', () => {
    it('returns no changes for separated boxes', () => {
        const result = resolveCollisions([
            { id: 'left', x: 0, y: 0, width: 100, height: 100 },
            { id: 'right', x: 140, y: 0, width: 100, height: 100 },
        ])

        expect(result.hasChanges).toBe(false)
        expect(result.numIterations).toBe(1)
        expect(result.nodes.size).toBe(0)
    })

    it('resolves overlaps along the x-axis when horizontal overlap is smaller', () => {
        const result = resolveCollisions([
            { id: 'a', x: 0, y: 0, width: 100, height: 100 },
            { id: 'b', x: 80, y: 0, width: 100, height: 100 },
        ], { margin: 0 })

        expect(result.hasChanges).toBe(true)
        expect(result.numIterations).toBe(2)
        expect(result.nodes.get('a')).toEqual({ x: -10, y: 0 })
        expect(result.nodes.get('b')).toEqual({ x: 90, y: 0 })
    })

    it('resolves overlaps along the y-axis when vertical overlap is smaller', () => {
        const result = resolveCollisions([
            { id: 'a', x: 0, y: 0, width: 100, height: 100 },
            { id: 'b', x: 0, y: 80, width: 100, height: 100 },
        ], { margin: 0 })

        expect(result.hasChanges).toBe(true)
        expect(result.numIterations).toBe(2)
        expect(result.nodes.get('a')).toEqual({ x: 0, y: -10 })
        expect(result.nodes.get('b')).toEqual({ x: 0, y: 90 })
    })

    it('allows node-local margin to override the global margin', () => {
        const result = resolveCollisions([
            { id: 'a', x: 0, y: 0, width: 100, height: 100, margin: 0 },
            { id: 'b', x: 130, y: 0, width: 100, height: 100, margin: 0 },
        ], { margin: 20 })

        expect(result.hasChanges).toBe(false)
        expect(result.nodes.size).toBe(0)
    })

    it('honors excluded pair IDs and skips only that overlap', () => {
        const result = resolveCollisions([
            { id: 'parent', x: 0, y: 0, width: 100, height: 100 },
            { id: 'child', x: 80, y: 0, width: 100, height: 100 },
        ], {
            margin: 0,
            excludePairs: new Set(['parent-child']),
        })

        expect(result.hasChanges).toBe(false)
        expect(result.nodes.size).toBe(0)
    })

    it('uses per-box overlap thresholds and allows box-specific thresholds to override global behavior', () => {
        const overlapAware: CollisionBox[] = [
            {
                id: 'tight',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                overlapThreshold: 5,
            },
            {
                id: 'wide',
                x: 98,
                y: 0,
                width: 100,
                height: 100,
                overlapThreshold: 5,
            },
        ]

        const noResolution = resolveCollisions(overlapAware, { margin: 0 })
        expect(noResolution.hasChanges).toBe(false)
        expect(noResolution.nodes.size).toBe(0)

        const withGlobalDefault = resolveCollisions([
            {
                ...overlapAware[0],
                overlapThreshold: undefined,
            },
            {
                ...overlapAware[1],
                overlapThreshold: undefined,
            },
        ], {
            overlapThreshold: 0.5,
            margin: 0,
        })
        expect(withGlobalDefault.hasChanges).toBe(true)
        expect(withGlobalDefault.nodes.size).toBe(2)
    })

    it('passes original boxes into shouldResolvePair and skips when callback rejects', () => {
        const seen: Array<{ a: CollisionBox; b: CollisionBox }> = []
        const result = resolveCollisions([
            { id: 'a', x: 0, y: 0, width: 100, height: 100 },
            { id: 'b', x: 80, y: 0, width: 100, height: 100 },
        ], {
            shouldResolvePair: (a, b) => {
                seen.push({
                    a,
                    b,
                })
                return false
            },
        })

        expect(seen).toEqual([
            {
                a: { id: 'a', x: 0, y: 0, width: 100, height: 100 },
                b: { id: 'b', x: 80, y: 0, width: 100, height: 100 },
            },
        ])
        expect(result.hasChanges).toBe(false)
        expect(result.nodes.size).toBe(0)
    })

    it('does not mutate original node inputs', () => {
        const nodes = [
            { id: 'left', x: 0, y: 0, width: 100, height: 100 },
            { id: 'right', x: 80, y: 0, width: 100, height: 100 },
        ]
        const snapshot = structuredClone(nodes)

        resolveCollisions(nodes, { margin: 0 })

        expect(nodes).toEqual(snapshot)
    })

    it('respects zero-iteration configuration and returns no work', () => {
        const nodes = [
            { id: 'a', x: 0, y: 0, width: 100, height: 100 },
            { id: 'b', x: 20, y: 0, width: 100, height: 100 },
        ]

        const result = resolveCollisions(nodes, { margin: 0, iterations: 0 })

        expect(result.hasChanges).toBe(false)
        expect(result.numIterations).toBe(0)
        expect(result.nodes.size).toBe(0)
    })

    it('does not invoke shouldResolvePair for excluded pairs', () => {
        const shouldResolvePair = vi.fn(() => true)

        const result = resolveCollisions([
            { id: 'left', x: 0, y: 0, width: 100, height: 100 },
            { id: 'right', x: 20, y: 0, width: 100, height: 100 },
        ], {
            margin: 0,
            excludePairs: new Set(['left-right']),
            shouldResolvePair,
        })

        expect(shouldResolvePair).not.toHaveBeenCalled()
        expect(result.hasChanges).toBe(false)
        expect(result.nodes.size).toBe(0)
    })

    it('returns one iteration even when there are no overlapping nodes', () => {
        const result = resolveCollisions([
            { id: 'left', x: 0, y: 0, width: 100, height: 100 },
            { id: 'right', x: 160, y: 0, width: 100, height: 100 },
        ], { margin: 0 })

        expect(result.hasChanges).toBe(false)
        expect(result.numIterations).toBe(1)
        expect(result.nodes.size).toBe(0)
    })
})
