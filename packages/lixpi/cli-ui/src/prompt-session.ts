import { styleText } from 'node:util'
import * as prompts from '@clack/prompts'

export class PromptCancelled extends Error {}

// Lets a wizard read prompt results as plain values and handle a cancellation
// once, around the whole wizard, instead of after every question.
export const unwrapPrompt = <T>(value: T | symbol): T => {
    if (prompts.isCancel(value))
        throw new PromptCancelled()

    return value as T
}

// The title bar that opens every developer-tool wizard.
export const showWizardIntro = (
    title: string,
    output?: NodeJS.WritableStream,
): void => void prompts.intro(
    styleText(['bgCyan', 'black'], ` ${title} `),
    { output },
)

// Marks the row under the cursor.
export const styleFocused = (text: string): string => styleText('green', text)

// The chevron beside the focused row. Other rows get the same width in spaces, so
// nothing shifts as the focus moves.
export const renderPointer = (active: boolean): string => (active ? `${styleFocused(
    prompts.unicodeOr('❯', '>'),
)} ` : '  ')

// The guide below every menu, set apart from the options by a blank line.
export const renderInstructionFooter = (
    color: 'cyan' | 'yellow',
    instructions: string,
): string => {
    const bar = styleText(color, prompts.S_BAR)
    const text = color === 'cyan' ? styleText('dim', instructions) : styleText('yellow', instructions)

    return `${bar}\n${bar}  ${text}\n${styleText(color, prompts.S_BAR_END)}`
}
