'use strict'

import { describe, it, expect } from 'vitest'
import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'

// =============================================================================
// GENERIC COLLISION RESOLUTION
// =============================================================================

describe('resolveCollisions', () => {
	it('returns no changes when boxes do not overlap', () => {
		const result = resolveCollisions([
			{ id: 'a', x: 0, y: 0, width: 100, height: 100 },
			{ id: 'b', x: 140, y: 0, width: 100, height: 100 },
		], { margin: 0 })

		expect(result.hasChanges).toBe(false)
		expect(result.nodes.size).toBe(0)
	})

	it('pushes overlapping boxes apart along the smallest overlap axis', () => {
		const result = resolveCollisions([
			{ id: 'a', x: 0, y: 0, width: 100, height: 100 },
			{ id: 'b', x: 80, y: 0, width: 100, height: 100 },
		], { margin: 0, overlapThreshold: 0.5, iterations: 1 })

		expect(result.hasChanges).toBe(true)
		expect(result.nodes.get('a')).toEqual({ x: -10, y: 0 })
		expect(result.nodes.get('b')).toEqual({ x: 90, y: 0 })
	})

	it('treats margin as required breathing room around boxes', () => {
		const result = resolveCollisions([
			{ id: 'a', x: 0, y: 0, width: 100, height: 100 },
			{ id: 'b', x: 110, y: 0, width: 100, height: 100 },
		], { margin: 10, overlapThreshold: 0.5, iterations: 1 })

		expect(result.hasChanges).toBe(true)
		expect(result.nodes.get('a')).toEqual({ x: -5, y: 0 })
		expect(result.nodes.get('b')).toEqual({ x: 115, y: 0 })
	})

	it('honors excluded node pairs even when boxes overlap', () => {
		const result = resolveCollisions([
			{ id: 'parent', x: 0, y: 0, width: 200, height: 200 },
			{ id: 'child', x: 40, y: 40, width: 80, height: 80 },
		], {
			margin: 0,
			excludePairs: new Set(['parent-child']),
		})

		expect(result.hasChanges).toBe(false)
		expect(result.nodes.size).toBe(0)
	})

	it('lets callers veto broad-phase overlaps with original unexpanded boxes', () => {
		const seenPairs: Array<{ a: unknown; b: unknown }> = []
		const result = resolveCollisions([
			{ id: 'a', x: 0, y: 0, width: 100, height: 100 },
			{ id: 'b', x: 90, y: 0, width: 100, height: 100 },
		], {
			margin: 20,
			shouldResolvePair: (a, b) => {
				seenPairs.push({ a, b })
				return false
			},
		})

		expect(seenPairs).toEqual([
			{
				a: { id: 'a', x: 0, y: 0, width: 100, height: 100 },
				b: { id: 'b', x: 90, y: 0, width: 100, height: 100 },
			},
		])
		expect(result.hasChanges).toBe(false)
		expect(result.nodes.size).toBe(0)
	})
})