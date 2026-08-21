'use strict'

import { createHash } from 'node:crypto'

export const canonicalize = (value: unknown): string => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value)
    }

    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`
    }

    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

export const canonicalHash = (value: unknown): string => sha256(canonicalize(value))
