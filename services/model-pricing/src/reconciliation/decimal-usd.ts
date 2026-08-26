'use strict'

const decimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/

export const parseUsdMicros = (value: string): bigint => {
    const match = decimalPattern.exec(value.trim())
    if (!match) throw new Error(`USD amount must be a non-negative decimal, received ${value}`)
    const fraction = (match[2] ?? '').padEnd(6, '0')
    if (fraction.length > 6) throw new Error(`USD amount has more than six decimal places: ${value}`)
    return BigInt(match[1]!) * 1_000_000n + BigInt(fraction || '0')
}

export const formatUsdMicros = (value: bigint): string => {
    const sign = value < 0n ? '-' : ''
    const absolute = value < 0n ? -value : value
    const dollars = absolute / 1_000_000n
    const micros = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
    return `${sign}${dollars}${micros ? `.${micros}` : ''}`
}
