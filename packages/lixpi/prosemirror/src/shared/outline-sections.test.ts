import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    enclosingHeadingLevels,
    outlineSectionRange,
    type OutlineSequenceEntry,
} from './outline-sections.ts'

// loose, H1, a, H2, b, H3, c, H2, d, H1, e
const sequence: OutlineSequenceEntry[] = [
    { entryId: 'loose' },
    {
        entryId: 'h1-first',
        headingLevel: 1,
    },
    { entryId: 'a' },
    {
        entryId: 'h2-first',
        headingLevel: 2,
    },
    { entryId: 'b' },
    {
        entryId: 'h3',
        headingLevel: 3,
    },
    { entryId: 'c' },
    {
        entryId: 'h2-second',
        headingLevel: 2,
    },
    { entryId: 'd' },
    {
        entryId: 'h1-second',
        headingLevel: 1,
    },
    { entryId: 'e' },
]

const idsIn = (range: {
    start: number
    end: number
}): string[] => sequence.slice(range.start, range.end).map(entry => entry.entryId)

// =============================================================================
// SECTIONS
// =============================================================================

describe('outlineSectionRange', () => {
    it('carries every lower-level subgroup with a level 1 heading', () => void expect(idsIn(outlineSectionRange(sequence, 1))).toEqual(['h1-first', 'a', 'h2-first', 'b', 'h3', 'c', 'h2-second', 'd']))

    it('ends a level 2 section at the next level 2 or level 1 heading', () => {
        expect(idsIn(outlineSectionRange(sequence, 3))).toEqual(['h2-first', 'b', 'h3', 'c'])
        expect(idsIn(outlineSectionRange(sequence, 7))).toEqual(['h2-second', 'd'])
    })

    it('runs the last section to the end and treats an item as itself', () => {
        expect(idsIn(outlineSectionRange(sequence, 9))).toEqual(['h1-second', 'e'])
        expect(idsIn(outlineSectionRange(sequence, 2))).toEqual(['a'])
    })
})

describe('enclosingHeadingLevels', () => {
    it('lists the enclosing levels outermost first and leaves ungrouped entries empty', () => {
        expect(enclosingHeadingLevels(sequence)).toEqual([
            [],
            [],
            [1],
            [1],
            [1, 2],
            [1, 2],
            [1, 2, 3],
            [1],
            [1, 2],
            [],
            [1],
        ])
    })
})
