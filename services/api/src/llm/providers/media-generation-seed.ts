'use strict'

import { randomInt } from 'node:crypto'

// Seeds are no longer a user-facing control. Providers that accept one always
// receive a generated seed so the value that produced an output can be stored
// on the Asset and reused later. Each provider documents its own accepted
// range, and sending a value outside it is rejected, so the range is picked at
// the call site rather than shared.
//
// Ranges below come from the provider references:
// - Seedance (BytePlus ModelArk): [-1, 2147483647], where -1 means "random".
// - VEO (@google/genai GenerateVideosConfig.seed): uint32.
// - Stability: [0, 4294967294], where 0 means "random".
export const SEEDANCE_SEED_MAX = 2147483647
export const VEO_SEED_MAX = 4294967295
export const STABILITY_SEED_MAX = 4294967294

// randomInt's upper bound is exclusive, and every provider treats its own
// minimum as "pick one for me", so generated seeds start at 1.
export const generateMediaGenerationSeed = (maxValue: number): number => randomInt(1, maxValue)

// Providers echo the seed they used with different shapes and sentinel values.
// Anything that is not a usable positive integer falls back to the seed we sent.
export const resolveReportedSeed = (reported: unknown, requestedSeed: number): number => {
    const value = typeof reported === 'number' ? reported : Number(reported)
    return Number.isSafeInteger(value) && value > 0 ? value : requestedSeed
}
