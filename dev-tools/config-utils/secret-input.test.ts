import { spawn } from 'node:child_process'
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
import { SecretInputPrompt } from './secret-input.ts'

class TerminalInput extends PassThrough {
    isTTY = true
    isRaw = false
    readonly rawModes: boolean[] = []

    setRawMode(enabled: boolean): this {
        this.isRaw = enabled
        this.rawModes.push(enabled)

        return this
    }
}

class TerminalOutput extends Writable {
    columns = 80
    text = ''

    _write(chunk: Buffer, _encoding: string, callback: () => void): void {
        this.text += chunk.toString()
        callback()
    }
}

class PromptFixture {
    readonly input = new TerminalInput()
    readonly output = new TerminalOutput()
    readonly result: ReturnType<SecretInputPrompt['prompt']>

    constructor(validate = (value: string): string | undefined => value ? undefined : 'Input cleared. Enter a token.') {
        this.input.pause()
        this.result = new SecretInputPrompt({
            message: 'Synthetic token',
            input: this.input,
            output: this.output,
            validate,
        }).prompt()
    }

    expectCleanup(): void {
        expect(this.input.rawModes).toEqual([true, false])
        expect(this.input.isPaused()).toBe(true)
        expect(this.input.listenerCount('data')).toBe(0)
        expect(this.input.listenerCount('end')).toBe(0)
        expect(this.output.listenerCount('resize')).toBe(0)
        expect(this.output.text.endsWith('\n')).toBe(true)
        expect(this.output.text.includes('\x1b[?2004l')).toBe(true)
    }
}

// =============================================================================
// SECRET INPUT AND LIFECYCLE
// =============================================================================

describe('secret input', () => {
    it('shows changing character counts when typing without echoing the secret', async () => {
        const fixture = new PromptFixture()
        fixture.input.write('abc')
        await delay(25)
        expect(fixture.output.text.includes('3 characters entered')).toBe(true)
        fixture.input.write('def')
        await delay(25)
        expect(fixture.output.text.includes('6 characters entered')).toBe(true)
        fixture.input.write('\r')
        expect(await fixture.result).toBe('abcdef')
        expect(fixture.output.text.includes('abcdef')).toBe(false)
        fixture.expectCleanup()
    })

    it.each([8192, 65536, 1048576])('preserves a %i-character paste with bounded output', async length => {
        const fixture = new PromptFixture()
        const token = 'x'.repeat(length)
        fixture.input.write(token)
        await delay(25)
        expect(fixture.output.text.includes(`${length} characters entered`)).toBe(true)
        fixture.input.write('\r')
        expect((await fixture.result) === token).toBe(true)
        expect(fixture.output.text.length).toBeLessThan(1000)
        expect(fixture.output.text.includes('xxxx')).toBe(false)
        fixture.expectCleanup()
    })

    it('handles chunked paste markers and a multiline clipboard without submitting early', async () => {
        const fixture = new PromptFixture()
        fixture.input.write('\x1b[2')
        fixture.input.write('00~header.')
        fixture.input.write('payload.signature\r\n\x1b[20')
        fixture.input.write('1~')
        await delay(25)
        expect(fixture.input.isRaw).toBe(true)
        fixture.input.write('\r')
        expect(await fixture.result).toBe('header.payload.signature\r\n')
        fixture.expectCleanup()
    })

    it('supports backspace across chunks, Ctrl+U, UTF-8 and ignored arrow sequences', async () => {
        const fixture = new PromptFixture()
        fixture.input.write('old')
        fixture.input.write('\x15new')
        fixture.input.write('xy\x7f\x7f\x7f')
        const emoji = Buffer.from('🙂')
        fixture.input.write(emoji.subarray(0, 2))
        fixture.input.write(emoji.subarray(2))
        fixture.input.write('\x7f\x1b[Dw\r')
        expect(await fixture.result).toBe('new')
        fixture.expectCleanup()
    })

    it('clears invalid input so a second paste replaces it', async () => {
        const fixture = new PromptFixture(value => value === 'valid' ? undefined : 'Input cleared. Retry.')
        fixture.input.write('invalid\r')
        await delay(25)
        expect(fixture.output.text.includes('Input cleared. Retry.')).toBe(true)
        expect(fixture.output.text.includes('0 characters entered')).toBe(true)
        fixture.input.write('valid\r')
        expect(await fixture.result).toBe('valid')
        fixture.expectCleanup()
    })

    it.each(['secret\x03', '\x1b[200~secret\x03', '\x04'])('restores the terminal on cancellation', async input => {
        const fixture = new PromptFixture()
        fixture.input.write(input)
        expect(isCancel(await fixture.result)).toBe(true)
        fixture.expectCleanup()
    })

    it('cancels on input end', async () => {
        const fixture = new PromptFixture()
        fixture.input.end()
        expect(isCancel(await fixture.result)).toBe(true)
        fixture.expectCleanup()
    })

    it('restores raw mode on input errors and validator failures', async () => {
        const fixture = new PromptFixture(() => { throw new Error('Validation failed') })
        fixture.input.write('token\r')
        await expect(fixture.result).rejects.toThrow('Validation failed')
        expect(fixture.input.isRaw).toBe(false)
        expect(fixture.input.listenerCount('data')).toBe(0)

        const inputFailure = new PromptFixture()
        inputFailure.input.emit('error', new Error('Input failed'))
        await expect(inputFailure.result).rejects.toThrow('Input failed')
        expect(inputFailure.input.isRaw).toBe(false)
    })
})

// =============================================================================
// REAL PSEUDO-TERMINAL INPUT
// =============================================================================

class PseudoTerminalCheck {
    async run(cancel = false): Promise<void> {
        const child = spawn('script', ['-qefc', 'stty cols 80 rows 24 && exec node --experimental-transform-types fixtures/secret-input-pty.ts', '/dev/null'], {
            cwd: import.meta.dirname,
            env: {
                ...process.env,
                SECRET_INPUT_EXPECT_CANCEL: String(cancel),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        let output = ''
        let state = 0
        let written = false
        const timeout = setTimeout(() => child.kill('SIGKILL'), 10000)
        child.stderr.resume()
        child.stdout.on('data', chunk => {
            output += stripVTControlCharacters(chunk.toString())

            if (output.length > 20000)
                child.kill('SIGKILL')

            if (
                state === 0
                && output.includes('FIRST INPUT')
            ) {
                state++
                child.stdin.write('start\r')
            } else if (
                state === 1
                && output.includes('0 characters entered')
            ) {
                state++
                child.stdin.write('typed')
            } else if (
                state === 2
                && output.includes('5 characters entered')
            ) {
                state++
                child.stdin.write('\x15\x1b[200~')
                child.stdin.write('x'.repeat(1048576))
                child.stdin.write('\x1b[201~')
            } else if (
                state === 3
                && output.includes('1048576 characters entered')
            ) {
                state++
                written = true
                child.stdin.write(cancel ? '\x03' : '\r')
            } else if (
                state === 4
                && output.includes('SECOND INPUT')
            ) {
                state++
                child.stdin.write('next\r')
            }
        })
        const code = await new Promise<number | null>((resolve, reject) => {
            child.once('error', reject)
            child.once('close', resolve)
        }).finally(() => clearTimeout(timeout))
        expect(code, output.slice(-1000)).toBe(0)
        expect(written).toBe(true)
        expect(state).toBe(5)
        expect(output.includes('PTY CHECK PASSED')).toBe(true)
        expect(output.includes('xxxx')).toBe(false)
        expect(output.length).toBeLessThan(20000)
    }
}

describe('real terminal secret input', () => {
    it('accepts typing and a 1 MiB paste, then allows the following prompt', async () => void (await new PseudoTerminalCheck().run()), 15000)

    it('cancels a 1 MiB paste and restores the terminal for another prompt', async () => void (await new PseudoTerminalCheck().run(true)), 15000)
})
