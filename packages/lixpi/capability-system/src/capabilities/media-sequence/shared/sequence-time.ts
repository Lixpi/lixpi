import {
    type SequenceRational,
} from './media-sequence.ts'

export type SequenceRounding = 'floor' | 'ceil' | 'nearest'

export const assertSequenceInteger = (
    value: unknown,
    name: string,
    minimum = 0,
): void => {
    if (
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < minimum
    )
        throw new Error(`MEDIA_SEQUENCE_INVALID_${name}`)
}

export const assertSequenceRational = (value: SequenceRational): void => {
    if (
        !value
        || typeof value !== 'object'
        || Object.keys(value).some(key => key !== 'numerator' && key !== 'denominator')
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_RATIONAL')

    assertSequenceInteger(
        value.numerator,
        'RATIONAL',
        1,
    )
    assertSequenceInteger(
        value.denominator,
        'RATIONAL',
        1,
    )
}

const divide = (
    numerator: bigint,
    denominator: bigint,
    rounding: SequenceRounding,
): number => {
    let result = numerator / denominator
    const remainder = numerator % denominator

    if (
        rounding === 'ceil'
        && remainder !== 0n
    )
        result += 1n

    if (
        rounding === 'nearest'
        && remainder * 2n >= denominator
    )
        result += 1n

    if (
        result > BigInt(Number.MAX_SAFE_INTEGER)
        || result < 0n
    )
        throw new Error('MEDIA_SEQUENCE_TIME_OVERFLOW')

    return Number(result)
}

export const convertTicks = (
    ticks: number,
    from: SequenceRational,
    to: SequenceRational,
    rounding: SequenceRounding = 'nearest',
): number => {
    assertSequenceInteger(ticks, 'TIME')
    assertSequenceRational(from)
    assertSequenceRational(to)

    return divide(
        BigInt(ticks) * BigInt(from.numerator) * BigInt(to.denominator),
        BigInt(from.denominator) * BigInt(to.numerator),
        rounding,
    )
}

export const ticksToSeconds = (
    ticks: number,
    timeBase: SequenceRational,
): number => {
    assertSequenceInteger(ticks, 'TIME')
    assertSequenceRational(timeBase)

    return (ticks * timeBase.numerator) / timeBase.denominator
}

export const secondsToTicks = (
    seconds: number,
    timeBase: SequenceRational,
): number => {
    if (
        !Number.isFinite(seconds)
        || seconds < 0
    )
        throw new Error('MEDIA_SEQUENCE_INVALID_TIME')

    assertSequenceRational(timeBase)
    const ticks = Math.round((seconds * timeBase.denominator) / timeBase.numerator)
    assertSequenceInteger(ticks, 'TIME')

    return ticks
}

export const sourceDurationToSequenceTicks = (
    sourceTicks: number,
    sourceTimeBase: SequenceRational,
    sequenceTimeBase: SequenceRational,
    rate: SequenceRational,
): number => {
    assertSequenceInteger(sourceTicks, 'TIME')
    assertSequenceRational(sourceTimeBase)
    assertSequenceRational(sequenceTimeBase)
    assertSequenceRational(rate)

    return divide(
        BigInt(sourceTicks) * BigInt(sourceTimeBase.numerator) * BigInt(sequenceTimeBase.denominator) * BigInt(rate.denominator),
        BigInt(sourceTimeBase.denominator) * BigInt(sequenceTimeBase.numerator) * BigInt(rate.numerator),
        'nearest',
    )
}

export const sequenceOffsetToSourceTicks = (
    sequenceTicks: number,
    sequenceTimeBase: SequenceRational,
    sourceTimeBase: SequenceRational,
    rate: SequenceRational,
): number =>
    sourceDurationToSequenceTicks(
        sequenceTicks,
        sequenceTimeBase,
        sourceTimeBase,
        {
            numerator: rate.denominator,
            denominator: rate.numerator,
        },
    )

export const frameTimeBase = (frameRate: SequenceRational): SequenceRational => ({
    numerator: frameRate.denominator,
    denominator: frameRate.numerator,
})
