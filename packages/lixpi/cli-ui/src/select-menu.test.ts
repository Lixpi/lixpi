import {
    PassThrough,
    Writable,
} from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { isCancel } from '@clack/prompts'
import {
    describe,
    expect,
    it,
} from 'vitest'
import { selectMenu } from './select-menu.ts'

class TerminalOutput extends Writable {
    columns = 100
    rows = 40
    text = ''

    _write(
        chunk: Buffer,
        _encoding: string,
        callback: () => void,
    ): void {
        this.text += chunk.toString()
        callback()
    }
}

const DOWN = '\x1b[B'
const ENTER = '\r'
const ESC = '\x1b'

const openMenu = (initialValue?: string) => {
    const input = new PassThrough()
    const output = new TerminalOutput()
    const result = selectMenu<string>({
        message: 'Pick one',
        options: [
            {
                value: 'first',
                label: 'First option',
                hint: 'A hint',
            },
            {
                value: 'second',
                label: 'Second option',
            },
        ],
        initialValue,
        instructions: 'Guide text',
        input,
        output,
    })
    const press = async (...keys: string[]): Promise<void> => {
        for (const key of keys) {
            input.write(key)
            await delay(70)
        }
    }

    return {
        output,
        press,
        result,
    }
}

describe('select menu', () => {
    it('opens on the first option by default', async () => {
        const menu = openMenu()

        await menu.press(ENTER)

        expect(await menu.result).toBe('first')
    })

    it('honours an initial value and moves with the arrows', async () => {
        const opened = openMenu('second')

        await opened.press(ENTER)
        expect(await opened.result).toBe('second')

        const moved = openMenu()

        await moved.press(DOWN, ENTER)
        expect(await moved.result).toBe('second')
    })

    it('draws a blank line before the guide text', async () => {
        const menu = openMenu()

        await delay(70)

        expect(stripVTControlCharacters(menu.output.text)).toMatch(/Second option\n│\s*\n│\s+Guide text\n└/u)

        await menu.press(ENTER)
        await menu.result
    })

    it('draws a chevron beside the focused option only', async () => {
        const menu = openMenu()

        await delay(70)

        const screen = stripVTControlCharacters(menu.output.text)

        expect(screen).toContain('❯ ● First option')
        expect(screen).toMatch(/│ {4}○ Second option/u)

        await menu.press(ENTER)
        await menu.result
    })

    it('returns the cancel symbol on Escape', async () => {
        const menu = openMenu()

        await menu.press(ESC)

        expect(isCancel(await menu.result)).toBe(true)
    })
})
