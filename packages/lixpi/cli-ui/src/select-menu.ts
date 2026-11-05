import { styleText } from 'node:util'
import {
    SelectPrompt,
    wrapTextWithPrefix,
} from '@clack/core'
import {
    limitOptions,
    S_BAR,
    S_RADIO_ACTIVE,
    S_RADIO_INACTIVE,
    symbol,
    symbolBar,
} from '@clack/prompts'
import {
    renderInstructionFooter,
    renderPointer,
    styleFocused,
} from './prompt-session.ts'

type SelectMenuOption<T> = {
    value: T
    label?: string
    hint?: string
    disabled?: boolean
}

type SelectMenuOptions<T> = {
    message: string
    options: SelectMenuOption<T>[]
    initialValue?: T
    instructions?: string
    output?: NodeJS.WritableStream
    input?: NodeJS.ReadableStream
}

const DEFAULT_INSTRUCTIONS = 'Arrows move, Enter confirms, Esc cancels'

// The bar, message, footer and reserved rows around the option list.
const RESERVED_ROWS = 6

const renderOption = <T>(
    option: SelectMenuOption<T>,
    active: boolean,
): string => {
    const label = option.label ?? String(option.value)
    const hint = option.hint ? ` ${styleText('dim', `(${option.hint})`)}` : ''

    if (option.disabled)
        return `  ${styleText('gray', S_RADIO_INACTIVE)} ${styleText('gray', label)}${hint}`

    return active
        ? `${renderPointer(true)}${styleFocused(S_RADIO_ACTIVE)} ${styleFocused(label)}${hint}`
        : `${renderPointer(false)}${styleText('dim', S_RADIO_INACTIVE)} ${styleText('dim', label)}`
}

// Clack's select hardcodes its footer, so this draws the same menu with the footer
// every Lixpi prompt shares.
export const selectMenu = <T>(options: SelectMenuOptions<T>): Promise<T | symbol> => {
    const output = options.output ?? process.stdout
    const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS
    const prompt = new SelectPrompt({
        options: options.options,
        initialValue: options.initialValue,
        input: options.input,
        output,
        render() {
            const self = this as unknown as {
                state: string
                cursor: number
                options: SelectMenuOption<T>[]
            }
            const state = self.state as Parameters<typeof symbol>[0]
            const header = wrapTextWithPrefix(
                output,
                options.message,
                `${symbolBar(state)}  `,
                `${symbol(state)}  `,
            )
            const top = `${styleText('gray', S_BAR)}\n${header}\n`
            const current = self.options[self.cursor]
            const currentLabel = current?.label ?? String(current?.value)

            if (self.state === 'submit')
                return `${top}${styleText('gray', S_BAR)}  ${styleText('dim', currentLabel)}`

            if (self.state === 'cancel')
                return `${top}${styleText('gray', S_BAR)}  ${styleText(['strikethrough', 'dim'], currentLabel)}\n${styleText('gray', S_BAR)}`

            const bar = styleText('cyan', S_BAR)
            const lines = limitOptions({
                output,
                cursor: self.cursor,
                options: self.options,
                columnPadding: 3,
                rowPadding: RESERVED_ROWS,
                style: (option, active) => renderOption(option, active),
            })

            return `${top}${bar}  ${lines.join(`\n${bar}  `)}\n${renderInstructionFooter('cyan', instructions)}\n`
        },
    })

    return prompt.prompt() as Promise<T | symbol>
}
