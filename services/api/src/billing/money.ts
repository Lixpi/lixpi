'use strict'

import { Decimal } from 'decimal.js'

const MICROS_PER_DOLLAR = 1_000_000

// toMicroDollars converts a dollar amount (string / number / Decimal) to integer
// micro-dollars, rounding half-even — the wire encoding the billing service expects.
// Billing stores int64 micro-dollars and never parses decimals.
export function toMicroDollars(dollars: Decimal.Value): number {
    return new Decimal(dollars)
        .times(MICROS_PER_DOLLAR)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
        .toNumber()
}
