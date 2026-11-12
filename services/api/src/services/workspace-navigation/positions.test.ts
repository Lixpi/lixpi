import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    isValidPosition,
    needsRebalance,
    positionBetween,
    positionsBetween,
    rebalancePositions,
    POSITION_REBALANCE_LENGTH,
} from './positions.ts'

const expectAscending = (positions: string[]): void => {
    for (let index = 1; index < positions.length; index += 1)
        expect(
            positions[index - 1] < positions[index],
            `${positions[index - 1]} should sort before ${positions[index]}`,
        ).toBe(true)
}

// =============================================================================
// POSITION BETWEEN
// =============================================================================

describe('positionBetween', () => {
    it('places the first entry in an empty level', () => {
        const position = positionBetween()

        expect(isValidPosition(position)).toBe(true)
    })

    it('orders an entry between, before and after its neighbors', () => {
        const middle = positionBetween()
        const first = positionBetween(undefined, middle)
        const last = positionBetween(middle, undefined)
        const between = positionBetween(first, middle)

        expectAscending([first, between, middle, last])

        for (const position of [first, between, middle, last])
            expect(isValidPosition(position)).toBe(true)
    })

    it('fits between adjacent digits by extending the shorter neighbor', () => {
        const position = positionBetween('A', 'B')

        expectAscending(['A', position, 'B'])
    })

    it('fits between a prefix and its extension', () => {
        const position = positionBetween('A', 'A1')

        expectAscending(['A', position, 'A1'])
    })

    it('stays ordered across 500 inserts at one gap', () => {
        const low = positionBetween()
        const high = positionBetween(low, undefined)
        const inserted: string[] = []
        let after = high

        for (let index = 0; index < 500; index += 1) {
            after = positionBetween(low, after)
            inserted.unshift(after)
        }

        expectAscending([low, ...inserted, high])
        expect(new Set(inserted).size).toBe(500)
    })

    it('stays ordered across 500 appends and 500 prepends', () => {
        const appended: string[] = [positionBetween()]
        const prepended: string[] = [appended[0]]

        for (let index = 0; index < 500; index += 1) {
            appended.push(positionBetween(appended.at(-1), undefined))
            prepended.unshift(positionBetween(undefined, prepended[0]))
        }

        expectAscending(appended)
        expectAscending(prepended)
    })

    it('rejects neighbors that are out of order or malformed', () => {
        expect(() => positionBetween('B', 'A')).toThrow('not before')
        expect(() => positionBetween('A', 'A')).toThrow('not before')
        expect(() => positionBetween('A0', undefined)).toThrow('Invalid position')
        expect(() => positionBetween('A-', undefined)).toThrow('Invalid position')
    })
})

// =============================================================================
// REBALANCE
// =============================================================================

describe('rebalancePositions', () => {
    it('returns short, valid positions in ascending order', () => {
        for (const count of [0, 1, 2, 61, 62, 500, 5000]) {
            const positions = rebalancePositions(count)

            expect(positions).toHaveLength(count)
            expectAscending(positions)

            for (const position of positions) {
                expect(isValidPosition(position)).toBe(true)
                expect(position.length).toBeLessThanOrEqual(3)
            }
        }
    })

    it('leaves room before the first and after the last position', () => {
        const positions = rebalancePositions(10)

        expectAscending([
            positionBetween(undefined, positions[0]),
            ...positions,
            positionBetween(positions.at(-1), undefined),
        ])
    })

    it('flags a position past the rebalance length', () => {
        expect(needsRebalance('V'.repeat(POSITION_REBALANCE_LENGTH))).toBe(false)
        expect(needsRebalance('V'.repeat(POSITION_REBALANCE_LENGTH + 1))).toBe(true)
    })

    it('rejects a negative or fractional count', () => {
        expect(() => rebalancePositions(-1)).toThrow('Invalid position count')
        expect(() => rebalancePositions(1.5)).toThrow('Invalid position count')
    })
})

// =============================================================================
// RUNS OF POSITIONS
// =============================================================================

describe('positionsBetween', () => {
    it('returns an ascending run inside the gap', () => {
        const run = positionsBetween('A', 'B', 40)

        expect(run).toHaveLength(40)
        expectAscending(['A', ...run, 'B'])
    })

    it('fills an open-ended gap and an empty request', () => {
        expectAscending(positionsBetween(undefined, undefined, 7))
        expect(positionsBetween('A', undefined, 0)).toEqual([])
    })
})
