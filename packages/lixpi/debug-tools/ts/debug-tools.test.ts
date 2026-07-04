'use strict'

import util from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockedChalk = vi.hoisted(() => ({
    green: vi.fn((value: string) => `green:${value}`),
    blue: vi.fn((value: string) => `blue:${value}`),
    yellow: vi.fn((value: string) => `yellow:${value}`),
    red: vi.fn((value: string) => `red:${value}`),
}))

vi.mock('chalk', () => ({
    default: mockedChalk,
}))

import { err, info, infoStr, log, warn } from './debug-tools.ts'

let consoleLogSpy: ReturnType<typeof vi.spyOn> | undefined
let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined

const safeInspect = (value: unknown) => util.inspect(value, {
    showHidden: false,
    depth: null,
    colors: true,
})

const setupConsoleSpies = () => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

const teardownConsoleSpies = () => {
    consoleLogSpy?.mockRestore()
    consoleInfoSpy?.mockRestore()
    consoleWarnSpy?.mockRestore()
    consoleErrorSpy?.mockRestore()
    consoleLogSpy = undefined
    consoleInfoSpy = undefined
    consoleWarnSpy = undefined
    consoleErrorSpy = undefined
}

// =============================================================================
// LOG FORMATTING
// =============================================================================

describe('debug-tools logging helpers', () => {
    beforeEach(() => {
        setupConsoleSpies()
        vi.clearAllMocks()
    })

    afterEach(() => {
        teardownConsoleSpies()
        vi.restoreAllMocks()
    })

    it('formats string-first log calls with green prefix and preserves extra values', () => {
        log('Success!', { file: 'foo.txt' }, 'done')

        expect(mockedChalk.green).toHaveBeenCalledWith('Success!')
        expect(consoleLogSpy).toHaveBeenCalledWith(
            'green:Success!',
            safeInspect({ file: 'foo.txt' }),
            'done',
        )
    })

    it('formats string-first info calls with blue prefix and preserves extra values', () => {
        info('Info', 'value', '42')

        expect(mockedChalk.blue).toHaveBeenCalledWith('Info')
        expect(consoleInfoSpy).toHaveBeenCalledWith(
            'blue:Info',
            'value',
            '42',
        )
    })

    it('formats string-first warn calls with yellow prefix', () => {
        warn('Caution', 'low', 'disk')

        expect(mockedChalk.yellow).toHaveBeenCalledWith('Caution')
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            'yellow:Caution',
            'low',
            'disk',
        )
    })

    it('formats string-first error calls with red prefix and preserves additional values', () => {
        const detail = { code: 'EPIPE' }
        err('Oops', detail)

        expect(mockedChalk.red).toHaveBeenCalledWith('Oops')
        expect(consoleErrorSpy).toHaveBeenCalledWith('red:Oops', safeInspect(detail))
    })

    it('passes non-string values straight through safeInspect when first arg is not string', () => {
        const node = { nodeId: 'n1', size: 100 }

        log(node)

        expect(consoleLogSpy).toHaveBeenCalledWith(safeInspect(node))
    })

    it('falls back to JSON.stringify when util.inspect throws', () => {
        const inspectSpy = vi.spyOn(util, 'inspect').mockImplementation(() => {
            throw new Error('inspect unavailable')
        })
        const node = { nodeId: 'n2', size: 100 }

        info(node)

        expect(consoleInfoSpy).toHaveBeenCalledWith(JSON.stringify(node, null, 2))
        inspectSpy.mockRestore()
    })

    it('concatenates infoStr input chunks exactly as received', () => {
        infoStr(['one', 'two', 'three'])

        expect(consoleInfoSpy).toHaveBeenCalledWith('onetwothree')
    })
})
