'use strict'

import { describe, it, expect } from 'vitest'
import { Decimal } from 'decimal.js'

import { toMicroDollars } from './money.ts'

describe('toMicroDollars', () => {
    it('converts whole dollars', () => {
        expect(toMicroDollars('10')).toBe(10_000_000)
    })

    it('converts a sub-cent amount', () => {
        expect(toMicroDollars('0.0034')).toBe(3400)
    })

    it('accepts a Decimal input', () => {
        expect(toMicroDollars(new Decimal('1.234567'))).toBe(1_234_567)
    })

    it('rounds half-even down to the even integer', () => {
        // 0.0000005 dollars = 0.5 micro → nearest even is 0
        expect(toMicroDollars('0.0000005')).toBe(0)
    })

    it('rounds half-even up to the even integer', () => {
        // 0.0000015 dollars = 1.5 micro → nearest even is 2
        expect(toMicroDollars('0.0000015')).toBe(2)
    })
})
