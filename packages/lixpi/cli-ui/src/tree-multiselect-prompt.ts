import {
    stripVTControlCharacters,
    styleText,
} from 'node:util'
import {
    type Readable,
    type Writable,
} from 'node:stream'
import {
    getColumns,
    getRows,
    Prompt,
    wrapTextWithPrefix,
} from '@clack/core'
import {
    limitOptions,
    S_BAR,
    S_CHECKBOX_ACTIVE,
    S_CHECKBOX_INACTIVE,
    S_CHECKBOX_SELECTED,
    S_RADIO_ACTIVE,
    S_RADIO_INACTIVE,
    symbol,
    symbolBar,
    unicodeOr,
} from '@clack/prompts'
import {
    TreeSelection,
    type TreeNode,
    type TreeRow,
} from './tree-selection.ts'
import {
    renderInstructionFooter,
    renderPointer,
    styleFocused,
} from './prompt-session.ts'

type TreeMultiSelectOptions = {
    message: string
    roots: TreeNode[]
    initialValues: string[]
    instructions?: string
    required?: boolean
    requiredMessage?: string
    input?: Readable
    output?: Writable
}

const S_CHECKBOX_PARTIAL = unicodeOr('◧', '[-]')
const S_COLLAPSED = unicodeOr('▸', '>')
const S_EXPANDED = unicodeOr('▾', 'v')
const S_TREE_BRANCH = unicodeOr('├─', '+-')
const S_TREE_LAST = unicodeOr('└─', '`-')
const SECTION_LINE = unicodeOr('─', '-').repeat(40)

// The header, footer and surrounding prompts that must stay on screen beside a
// tree too tall for the terminal.
const RESERVED_ROWS = 8

const HIDE_CURSOR = '\x1b[?25l'
const ERASE_TO_LINE_END = '\x1b[K'
const ERASE_BELOW = '\x1b[J'

// Terminals that support synchronized output show the whole update at once, and
// others ignore the mode.
const BEGIN_UPDATE = '\x1b[?2026h'
const END_UPDATE = '\x1b[?2026l'

// Clack's grouped multiselect stops at one level of groups, and the service tree
// nests deeper. This renders the same way as Clack's multiselect on Clack's base
// prompt, so it behaves like the prompts before and after it.
export class TreeMultiSelectPrompt extends Prompt<string[]> {
    private readonly message: string
    private readonly instructions: string
    private readonly selection: TreeSelection
    private activeValue: string

    // The lines on screen, ending with the empty line the cursor rests on.
    private painted: string[] = []

    constructor(options: TreeMultiSelectOptions) {
        super(
            {
                input: options.input,
                output: options.output,
                validate: () => options.required === false
                    || this.selection.selectedLeaves().length
                    ? undefined
                    : options.requiredMessage ?? 'Select at least one option.',
                render() {
                    return (this as unknown as TreeMultiSelectPrompt).frame()
                },
            },
            false,
        )

        this.message = options.message
        this.instructions = options.instructions ?? 'Arrows move and fold, Space toggles, Enter confirms'
        this.selection = new TreeSelection(options.roots, options.initialValues)
        this.activeValue = options.roots[0].value
        this.value = this.currentValue()

        // Clack binds its redraw onto the instance and calls it after every key, so
        // replacing it here routes every redraw through paint().
        ;(this as unknown as { render: () => void }).render = () => this.paint()

        this.on('cursor', action => this.handleAction(action))
    }

    // Clack redraws by clearing everything below the first changed line and writing
    // the rest back in several writes. Moving the focus changes two lines, so most of
    // the tree blanks for a moment on every key, and the gap is longer when the output
    // passes through Docker. This writes over the old lines instead, without clearing
    // them first, and sends the update as one write.
    private paint(): void {
        const frame = this.frame()
        const lines = frame.split('\n')

        if (this.state === 'initial') {
            this.output.write(`${HIDE_CURSOR}${frame}`)
            this.state = 'active'
            this.painted = lines

            return
        }

        const previous = this.painted
        const columns = getColumns(this.output)
        const rowsOf = (line: string): number => Math.max(
            1,
            Math.ceil(stripVTControlCharacters(line).length / columns),
        )
        const rowsBelow = (index: number): number => previous.slice(index, -1).reduce((sum, line) => sum + rowsOf(line), 0)
        let first = 0

        while (
            first < Math.max(lines.length, previous.length)
            && lines[first] === previous[first]
        )
            first++

        if (first === Math.max(lines.length, previous.length))
            return

        // Lines that scrolled above the screen can't be reached, so drawing starts at
        // the first one still on it.
        while (
            first < previous.length - 1
            && rowsBelow(first) > getRows(this.output) - 1
        )
            first++

        const up = rowsBelow(first)

        // A line that fills its last row exactly leaves the cursor on that row's final
        // character, where erasing would remove it.
        const body = lines.slice(first, -1).map(line => {
            const width = stripVTControlCharacters(line).length
            const fillsRow = width > 0 && width % columns === 0

            return `${line}${fillsRow ? '' : ERASE_TO_LINE_END}\n`
        }).join('')

        this.output.write(`${BEGIN_UPDATE}\r${up ? `\x1b[${up}A` : ''}${body}${ERASE_BELOW}${END_UPDATE}`)
        this.painted = lines
    }

    private currentValue(): string[] {
        return [
            ...this.selection.selectedOptions(),
            ...this.selection.selectedLeaves(),
        ]
    }

    private handleAction(action: string | undefined): void {
        const rows = this.selection.rows()
        const index = rows.findIndex(row => row.node.value === this.activeValue)
        const row = rows[index]

        switch (action) {
            case 'up':
                this.activeValue = rows[(index - 1 + rows.length) % rows.length].node.value

                break
            case 'down':
                this.activeValue = rows[(index + 1) % rows.length].node.value

                break
            case 'left':
                if (row.node.choices) {
                    this.selection.switchChoice(row.node, -1)
                    this.value = this.currentValue()
                } else
                    this.moveOut(row)

                break
            case 'right':
                if (row.node.choices) {
                    this.selection.switchChoice(row.node, 1)
                    this.value = this.currentValue()
                } else
                    this.moveIn(row)

                break
            case 'space':
                this.selection.toggle(row.node)
                this.value = this.currentValue()

                break
            default:
                break
        }
    }

    private moveOut(row: TreeRow): void {
        if (
            row.node.children
            && !this.selection.isCollapsed(row.node)
        ) {
            this.selection.setCollapsed(row.node, true)

            return
        }

        if (row.parent)
            this.activeValue = row.parent.value
    }

    private moveIn(row: TreeRow): void {
        if (!row.node.children)
            return

        if (this.selection.isCollapsed(row.node)) {
            this.selection.setCollapsed(row.node, false)

            return
        }

        this.activeValue = row.node.children[0].value
    }

    private frame(): string {
        const header = wrapTextWithPrefix(
            this.output,
            this.message,
            `${symbolBar(this.state)}  `,
            `${symbol(this.state)}  `,
        )
        const top = `${styleText('gray', S_BAR)}\n${header}\n`

        if (this.state === 'submit')
            return `${top}${styleText('gray', S_BAR)}  ${styleText(
                'dim',
                this.selection.summary().join(', '),
            )}\n`

        if (this.state === 'cancel')
            return `${top}${styleText('gray', S_BAR)}  ${styleText(
                ['strikethrough', 'dim'],
                this.selection.summary().join(', '),
            )}\n${styleText('gray', S_BAR)}\n`

        const isError = this.state === 'error'
        const color = isError ? 'yellow' : 'cyan'
        const bar = styleText(color, S_BAR)
        const rows = this.selection.rows()
        const lines = limitOptions({
            cursor: rows.findIndex(row => row.node.value === this.activeValue),
            options: rows,
            style: (row, active) => `${this.renderSeparatorBefore(row)}${this.renderRow(row, active)}`,
            output: this.output,
            columnPadding: 3,
            rowPadding: RESERVED_ROWS,
        })
        const body = lines.map(line => `${bar}  ${line}`).join('\n')
        const footer = renderInstructionFooter(color, isError ? this.error : this.instructions)

        return `${top}${body}\n${footer}\n`
    }

    // A line and a blank line separate kinds of top-level rows, such as options from
    // the tree, and a blank line alone separates the tree's top-level groups.
    private renderSeparatorBefore(row: TreeRow): string {
        const previous = row.depth === 0 ? this.selection.roots[this.selection.roots.indexOf(row.node) - 1] : undefined

        if (!previous)
            return ''

        if (this.rowKind(previous) !== this.rowKind(row.node))
            return `  ${styleText('dim', SECTION_LINE)}\n\n`

        return row.node.children
            || previous.children
            ? '\n'
            : ''
    }

    private rowKind(node: TreeNode): string {
        return node.choices ? 'choices' : 'tree'
    }

    private renderRow(
        row: TreeRow,
        active: boolean,
    ): string {
        if (row.node.choices)
            return this.renderChoiceRow(row.node, active)

        const guides = row.guides.map(continues => continues ? `${S_BAR}  ` : '   ')
            .join('')
        const connector = row.depth === 0 ? '' : `${row.isLast ? S_TREE_LAST : S_TREE_BRANCH} `
        const fold = row.node.children
            ? `${this.selection.isCollapsed(row.node) ? S_COLLAPSED : S_EXPANDED} `
            : ''
        const hint = row.node.hint ? ` ${styleText('dim', `(${row.node.hint})`)}` : ''
        const label = this.renderLabel(row.node, active)

        const styledConnector = active ? styleFocused(connector) : styleText('gray', connector)

        return `${renderPointer(active)}${styleText('gray', guides)}${styledConnector}${this.renderCheckbox(row.node, active)} ${fold}${label}${hint}`
    }

    // Drawn like Clack's confirm prompt, with the labels of all radio rows aligned.
    private renderChoiceRow(
        node: TreeNode,
        active: boolean,
    ): string {
        const labelWidth = Math.max(...this.selection.roots.filter(root => root.choices).map(root => root.label.length))
        const label = node.label.padEnd(labelWidth)
        const current = this.selection.activeChoice(node)
        const choices = (node.choices ?? []).map(choice => {
            if (choice !== current)
                return `${styleText('dim', S_RADIO_INACTIVE)} ${styleText('dim', choice.label)}`

            // A locked row is drawn muted throughout, so it doesn't read as a choice
            // that can be switched.
            if (node.locked)
                return styleText('dim', `${S_RADIO_ACTIVE} ${choice.label}`)

            return `${styleText('green', S_RADIO_ACTIVE)} ${active ? styleFocused(choice.label) : choice.label}`
        }).join(
            styleText('dim', ' / '),
        )
        const hint = node.locked
            ?? current.hint
            ?? node.hint
        const styledLabel = node.locked ? styleText('dim', label) : label

        return `${renderPointer(active)}${styledLabel}  ${choices}${hint ? ` ${styleText('dim', `(${hint})`)}` : ''}`
    }

    // Only an unselected row is muted, so what will run stands out at a glance.
    private renderLabel(
        node: TreeNode,
        active: boolean,
    ): string {
        if (active)
            return styleFocused(node.label)

        return this.selection.stateOf(node) === 'none' ? styleText('dim', node.label) : node.label
    }

    private renderCheckbox(
        node: TreeNode,
        active: boolean,
    ): string {
        const state = this.selection.stateOf(node)

        if (state === 'all')
            return styleText('green', S_CHECKBOX_SELECTED)

        if (state === 'some')
            return styleText('green', S_CHECKBOX_PARTIAL)

        return active
            ? styleFocused(S_CHECKBOX_ACTIVE)
            : styleText('dim', S_CHECKBOX_INACTIVE)
    }
}
