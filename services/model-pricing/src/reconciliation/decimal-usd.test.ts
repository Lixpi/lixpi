import { describe, it, expect } from 'vitest'

import { formatUsdMicros, parseUsdMicros } from './decimal-usd.ts'

// =============================================================================
// parseUsdMicros
// =============================================================================

describe('parseUsdMicros — exact decimal parsing', () => {
    it('parses a whole dollar amount', () => {
        expect(parseUsdMicros('12')).toBe(12_000_000n)
    })

    it('parses a fractional amount and pads to six decimal places', () => {
        expect(parseUsdMicros('1.5')).toBe(1_500_000n)
    })

    it('parses zero', () => {
        expect(parseUsdMicros('0')).toBe(0n)
    })

    it('parses an amount already at six decimal places', () => {
        expect(parseUsdMicros('0.006732')).toBe(6_732n)
    })

    it('rejects more than six decimal places rather than silently truncating', () => {
        expect(() => parseUsdMicros('1.1234567')).toThrow(/more than six decimal places/)
    })

    it('rejects a leading-zero integer part', () => {
        expect(() => parseUsdMicros('01.5')).toThrow(/non-negative decimal/)
    })

    it('rejects a negative amount', () => {
        expect(() => parseUsdMicros('-1')).toThrow(/non-negative decimal/)
    })

    it('rejects scientific notation', () => {
        expect(() => parseUsdMicros('1e10')).toThrow(/non-negative decimal/)
    })

    it('rejects a currency-symbol-prefixed amount', () => {
        expect(() => parseUsdMicros('$1.50')).toThrow(/non-negative decimal/)
    })

    it('trims surrounding whitespace', () => {
        expect(parseUsdMicros(' 3.25 ')).toBe(3_250_000n)
    })
})

// =============================================================================
// formatUsdMicros
// =============================================================================

describe('formatUsdMicros — plain exact decimal rendering', () => {
    it('renders a whole-dollar amount with no fraction', () => {
        expect(formatUsdMicros(1_000_000n)).toBe('1')
    })

    it('renders zero as "0"', () => {
        expect(formatUsdMicros(0n)).toBe('0')
    })

    it('trims trailing zero micros', () => {
        expect(formatUsdMicros(1_500_000n)).toBe('1.5')
    })

    it('keeps a non-terminating-looking fraction intact', () => {
        expect(formatUsdMicros(6_732n)).toBe('0.006732')
    })

    it('renders a negative value with a leading minus (used for reconciliation deltas)', () => {
        expect(formatUsdMicros(-2_500_000n)).toBe('-2.5')
    })
})

// =============================================================================
// round trip
// =============================================================================

describe('parseUsdMicros / formatUsdMicros — round trip', () => {
    it('formatUsdMicros output is always re-parseable by parseUsdMicros', () => {
        for (const micros of [0n, 6_732n, 1_000_000n, 3_250_000n, 999_999_999_999n]) {
            expect(parseUsdMicros(formatUsdMicros(micros))).toBe(micros)
        }
    })
})
