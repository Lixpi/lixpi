import { describe, expect, it } from 'vitest'
import fixtures from './path-baseline.json'
import { computePath } from './index.ts'
import { type AnchorPosition, type PathType } from '../path-types.ts'

describe('connector path compatibility with captured 0.0.82 output', () => {
    it('preserves paths, labels and offsets across side pairs, reversed axes and degenerate endpoints', () => {
        for (const fixture of fixtures) {
            const actual = computePath(fixture.kind as PathType, fixture.sourceX, fixture.sourceY, fixture.targetX, fixture.targetY, fixture.sourcePosition as AnchorPosition, fixture.targetPosition as AnchorPosition, fixture.curvature)
            expect([actual.path, actual.labelX, actual.labelY, actual.offsetX, actual.offsetY], JSON.stringify(fixture)).toEqual(fixture.expected)
        }
    })
})
