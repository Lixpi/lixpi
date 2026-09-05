// Simple de-duplication of Pulumi engine lines to suppress repeated diagnostics
// Tracks a hash of each unique line per session and applies consistent chalk styling.

import chalk from 'chalk'
import { SENTINELS } from './pulumiLogger.ts'

let seenLines: Set<string> | null = null

export const startOutputSession = () => void (seenLines = new Set())

type Severity = 'plain' | 'info' | 'warn' | 'error' | 'debug'

// First pass: derive severity from raw Pulumi engine output (no sentinels)
const detectBaseSeverity = (line: string): Severity => {
    const trimmed = line.trimStart()

    if (/^error:/i.test(trimmed))
        return 'error'

    if (/^warning:/i.test(trimmed))
        return 'warn'

    if (/^info:/i.test(trimmed))
        return 'info'

    if (/\berror:\b/i.test(line))
        return 'error'

    if (/\bwarning:\b/i.test(line))
        return 'warn'

    return 'plain'
}

// Second pass: override with sentinel markers (explicit user-intent)
const applySentinelOverride = (
    line: string,
    current: Severity,
): Severity => {
    if (line.includes(SENTINELS.PREFIX_ERROR))
        return 'error'

    if (line.includes(SENTINELS.PREFIX_WARN))
        return 'warn'

    if (line.includes(SENTINELS.PREFIX_DEBUG))
        return 'debug'

    if (line.includes(SENTINELS.PREFIX_INFO))
        return 'info'

    return current
}

const classifyLine = (line: string): Severity => {
    const base = detectBaseSeverity(line)

    return applySentinelOverride(line, base)
}

const colorize = (line: string): string => {
    const severity = classifyLine(line)
    const stripped = stripSentinel(line)

    switch (severity) {
        case 'error':
            return chalk.redBright(stripped)
        case 'warn':
            return chalk.yellow(stripped)
        case 'debug':
            return chalk.gray(stripped)
        case 'info':
            return chalk.blue(stripped) // info -> blue
        case 'plain':
            return chalk.whiteBright(stripped) // plain -> whiteBright
        default:
            return chalk.whiteBright(stripped)
    }
}

const stripSentinel = (line: string) => {
    let stripped = line

    for (const s of Object.values(SENTINELS)) {
        stripped = stripped.replace(s, '')
    }

    return stripped
}

export const printPulumiLine = (raw: string) => {
    if (!seenLines) {
        // Fallback if session not started
        process.stdout.write(
            colorize(raw),
        )

        return
    }

    const lines = raw.split(/\r?\n/)

    for (const line of lines) {
        if (!line.trim())
            continue

        const key = line // could hash if lines are huge

        if (seenLines.has(key))
            continue

        seenLines.add(key)
        process.stdout.write(`${colorize(line)}\n`)
    }
}

export const endOutputSession = () => void (seenLines = null)
