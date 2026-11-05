import {
    type Readable,
    type Writable,
} from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { CANCEL_SYMBOL } from '@clack/prompts'

type TerminalInput = Readable & {
    isTTY?: boolean
    isRaw?: boolean
    setRawMode?: (enabled: boolean) => unknown
}

type TerminalOutput = Writable & { columns?: number }

type SecretInputOptions = {
    message: string
    validate: (value: string) => string | undefined
    input?: TerminalInput
    output?: TerminalOutput
}

// Read paste chunks directly. Readline's per-key editing and full-value masking
// both do increasing work per character when the secret is large.
export class SecretInputPrompt {
    private readonly input: TerminalInput
    private readonly output: TerminalOutput
    private readonly decoder = new StringDecoder('utf8')
    private readonly parts: string[] = []
    private length = 0
    private pending = ''
    private pasting = false
    private active = false
    private wasRaw = false
    private wasPaused = false
    private redraw?: ReturnType<typeof setTimeout>
    private resolve?: (value: string | typeof CANCEL_SYMBOL) => void
    private reject?: (error: Error) => void

    constructor(private readonly options: SecretInputOptions) {
        this.input = options.input ?? process.stdin
        this.output = options.output ?? process.stdout
    }

    prompt(): Promise<string | typeof CANCEL_SYMBOL> {
        if (
            !this.input.isTTY
            || !this.input.setRawMode
        )
            return Promise.reject(
                new Error('Secret input requires an interactive terminal. Run config init without redirected input.'),
            )

        return new Promise((resolve, reject) => {
            this.resolve = resolve
            this.reject = reject
            this.wasRaw = this.input.isRaw ?? false
            this.wasPaused = this.input.isPaused()
            this.active = true

            try {
                this.input.setRawMode!(true)
                this.input.on('data', this.onData)
                this.input.once('end', this.onCancel)
                this.input.once('error', this.onError)
                this.output.on('resize', this.render)
                process.once('SIGINT', this.onCancel)
                process.once('SIGTERM', this.onCancel)
                this.output.write(
                    `\n${this.options.message}\nPaste or type; Enter to accept, Backspace to delete, Ctrl+U to clear, Ctrl+C to cancel.\n\x1b[?2004h`,
                )
                this.render()
                this.input.resume()
            } catch (error) {
                this.onError(error instanceof Error ? error : new Error(
                    String(error),
                ))
            }
        })
    }

    private append(value: string): void {
        if (!value)
            return

        this.parts.push(value)
        this.length += value.length
    }

    private clear(): void {
        this.parts.length = 0
        this.length = 0
    }

    private backspace(): void {
        const last = this.parts.pop()

        if (!last)
            return

        const count = /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(last) ? 2 : 1
        this.length -= count

        if (last.length > count)
            this.parts.push(
                last.slice(0, -count),
            )
    }

    private consumePaste(text: string): string {
        const end = '\x1b[201~'
        const endIndex = text.indexOf(end)

        if (endIndex >= 0) {
            this.append(
                text.slice(0, endIndex),
            )
            this.pasting = false

            return text.slice(endIndex + end.length)
        }

        let suffix = Math.min(text.length, end.length - 1)

        while (
            suffix > 0
            && !text.endsWith(
                end.slice(0, suffix),
            )
        )
            suffix--

        this.append(
            text.slice(0, text.length - suffix),
        )
        this.pending = text.slice(text.length - suffix)

        return ''
    }

    private onData = (chunk: Buffer | string): void => {
        try {
            let text = this.pending + (typeof chunk === 'string' ? chunk : this.decoder.write(chunk))
            this.pending = ''

            // Cancellation must work even if a terminal loses the paste-end marker.
            if (text.includes('\x03')) {
                this.onCancel()

                return
            }

            while (
                text
                && this.active
            ) {
                if (this.pasting) {
                    text = this.consumePaste(text)

                    continue
                }

                const control = text.search(/[\x00-\x1f\x7f]/)

                if (control < 0) {
                    this.append(text)

                    break
                }

                this.append(
                    text.slice(0, control),
                )
                text = text.slice(control)
                const character = text[0]

                if (character === '\x1b') {
                    const escape = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O[@-~])/.exec(text)?.[0]

                    if (escape) {
                        this.pasting = escape === '\x1b[200~'
                        text = text.slice(escape.length)
                    } else if (
                        /^\x1b(?:\[[0-?]*[ -/]*|O)?$/.test(text)
                        && text.length < 64
                    ) {
                        this.pending = text

                        break
                    } else
                        text = text.slice(1)

                    continue
                }

                text = text.slice(1)

                if (
                    character === '\r'
                    || character === '\n'
                )
                    this.submit()
                else if (
                    character === '\x7f'
                    || character === '\b'
                )
                    this.backspace()
                else if (character === '\x15')
                    this.clear()
                else if (character === '\x04')
                    this.onCancel()
            }

            if (
                this.active
                && !this.redraw
            )
                this.redraw = setTimeout(this.render, 16)
        } catch (error) {
            this.onError(error instanceof Error ? error : new Error(
                String(error),
            ))
        }
    }

    private render = (): void => {
        clearTimeout(this.redraw)
        this.redraw = undefined

        if (!this.active)
            return

        const status = `${this.length} characters entered${this.pasting ? ' (pasting)' : ''}`
        const width = Math.max(1, (this.output.columns || 80) - 1)
        this.output.write(`\r\x1b[2K${status.slice(0, width)}`)
    }

    private submit(): void {
        const value = this.parts.join('')
        const error = this.options.validate(value)

        if (error) {
            this.clear()
            this.output.write(`\r\x1b[2K${error}\n`)
            this.render()

            return
        }

        this.finish(value, `${this.length} characters accepted`)
    }

    private cleanup(): void {
        this.active = false
        clearTimeout(this.redraw)
        this.input.off('data', this.onData)
        this.input.off('end', this.onCancel)
        this.input.off('error', this.onError)
        this.output.off('resize', this.render)
        process.off('SIGINT', this.onCancel)
        process.off('SIGTERM', this.onCancel)
        this.input.setRawMode?.(this.wasRaw)

        if (this.wasPaused)
            this.input.pause()

        this.clear()
        this.pending = ''
        this.output.write('\x1b[?2004l')
    }

    private finish(
        value: string | typeof CANCEL_SYMBOL,
        status: string,
    ): void {
        if (!this.active)
            return

        this.cleanup()
        this.output.write(`\r\x1b[2K${status}\n`)
        this.resolve?.(value)
    }

    private onCancel = (): void => void this.finish(CANCEL_SYMBOL, 'Input cancelled')

    private onError = (error: Error): void => {
        if (!this.active)
            return

        this.cleanup()
        this.reject?.(error)
    }
}
