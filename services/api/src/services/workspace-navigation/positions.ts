// Fractional positions order siblings without renumbering them. A position is
// a string of base-62 digits read as the fraction after a radix point, so
// "V" sits halfway between the empty start and the end. Digits are ordered by
// character code, which makes plain string comparison match numeric order as
// long as no position ends in the smallest digit. Every function here keeps
// that invariant.

export const POSITION_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const POSITION_REBALANCE_LENGTH = 48

const BASE = POSITION_DIGITS.length
const ZERO = POSITION_DIGITS[0]

const digitValue = (character: string): number => {
    const value = POSITION_DIGITS.indexOf(character)

    if (value < 0)
        throw new Error(`Invalid position digit: ${character}`)

    return value
}

export const isValidPosition = (position: string): boolean => position.length > 0
    && !position.endsWith(ZERO)
    && [...position].every(character => POSITION_DIGITS.includes(character))

export const comparePositions = (
    left: string,
    right: string,
): number => left < right
    ? -1
    : left > right
        ? 1
        : 0

// Returns a digit string strictly between `low` and `high`, where an empty
// `low` means the start and an undefined `high` means the end.
const midpoint = (
    low: string,
    high: string | undefined,
): string => {
    if (high !== undefined) {
        let shared = 0

        while ((low[shared] ?? ZERO) === high[shared])
            shared += 1

        if (shared > 0)
            return `${high.slice(0, shared)}${midpoint(
                low.slice(shared),
                high.slice(shared),
            )}`
    }

    const lowDigit = low ? digitValue(low[0]) : 0
    const highDigit = high ? digitValue(high[0]) : BASE

    if (highDigit - lowDigit > 1)
        return POSITION_DIGITS[Math.round((lowDigit + highDigit) / 2)]

    if (
        high
        && high.length > 1
    )
        return high.slice(0, 1)

    return `${POSITION_DIGITS[lowDigit]}${midpoint(
        low.slice(1),
        undefined,
    )}`
}

// Returns a position after `before` and before `after`. Leave `before` out to
// insert at the start and `after` out to insert at the end.
export const positionBetween = (
    before?: string,
    after?: string,
): string => {
    if (
        before !== undefined
        && !isValidPosition(before)
    )
        throw new Error(`Invalid position: ${before}`)

    if (
        after !== undefined
        && !isValidPosition(after)
    )
        throw new Error(`Invalid position: ${after}`)

    if (
        before !== undefined
        && after !== undefined
        && before >= after
    )
        throw new Error(`Position ${before} is not before ${after}`)

    return midpoint(before ?? '', after)
}

// Returns `count` short positions spread evenly across the whole range, in
// ascending order. A level is rebalanced with these when an insert produces a
// position longer than POSITION_REBALANCE_LENGTH.
export const rebalancePositions = (count: number): string[] => {
    if (
        !Number.isInteger(count)
        || count < 0
    )
        throw new Error(`Invalid position count: ${count}`)

    let length = 1

    while (BigInt(BASE) ** BigInt(length) <= BigInt(count))
        length += 1

    const span = BigInt(BASE) ** BigInt(length)
    const slots = BigInt(count + 1)
    const positions: string[] = []

    for (let index = 1; index <= count; index += 1) {
        let value = (span * BigInt(index)) / slots
        let digits = ''

        for (let place = 0; place < length; place += 1) {
            digits = `${POSITION_DIGITS[Number(value % BigInt(BASE))]}${digits}`
            value /= BigInt(BASE)
        }

        positions.push(
            digits.replace(/0+$/u, ''),
        )
    }

    return positions
}

export const needsRebalance = (position: string): boolean => position.length > POSITION_REBALANCE_LENGTH

// Returns `count` ascending positions strictly between `before` and `after`,
// keeping them as short as the gap allows. Moving a run of entries, such as a
// heading's section, uses this to keep the run's order at the destination.
export const positionsBetween = (
    before: string | undefined,
    after: string | undefined,
    count: number,
): string[] => {
    if (count <= 0)
        return []

    const middle = positionBetween(before, after)
    const leftCount = Math.floor((count - 1) / 2)

    return [
        ...positionsBetween(
            before,
            middle,
            leftCount,
        ),
        middle,
        ...positionsBetween(
            middle,
            after,
            count - 1 - leftCount,
        ),
    ]
}
