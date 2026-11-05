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
import { TreeMultiSelectPrompt } from './tree-multiselect-prompt.ts'
import {
    TreeSelection,
    type TreeNode,
} from './tree-selection.ts'

class TerminalOutput extends Writable {
    columns = 100
    rows = 60
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

describe('tree selection', () => {
    const roots: TreeNode[] = [{
        value: 'all',
        label: 'All',
        children: [
            {
                value: 'group',
                label: 'Group',
                children: [
                    {
                        value: 'a',
                        label: 'a',
                    },
                    {
                        value: 'b',
                        label: 'b',
                    },
                ],
            },
            {
                value: 'c',
                label: 'c',
            },
        ],
    }]
    const [all] = roots
    const [group, leafC] = all.children!
    const [leafA] = group.children!

    it('derives group state from its leaves', () => {
        const selection = new TreeSelection(roots, ['a'])

        expect(selection.stateOf(leafA)).toBe('all')
        expect(selection.stateOf(group)).toBe('some')
        expect(selection.stateOf(leafC)).toBe('none')
        expect(selection.stateOf(all)).toBe('some')
    })

    it('completes a partly selected group before clearing it', () => {
        const selection = new TreeSelection(roots, ['a'])

        selection.toggle(group)
        expect(selection.selectedLeaves()).toEqual(['a', 'b'])

        selection.toggle(group)
        expect(selection.selectedLeaves()).toEqual([])
    })

    it('toggles an entire subtree from the root', () => {
        const selection = new TreeSelection(roots, [])

        selection.toggle(all)
        expect(selection.selectedLeaves()).toEqual(['a', 'b', 'c'])
    })

    it('hides the children of a collapsed group without changing the selection', () => {
        const selection = new TreeSelection(roots, ['a'])

        selection.setCollapsed(group, true)

        expect(selection.rows().map(row => row.node.value)).toEqual(['all', 'group', 'c'])
        expect(selection.selectedLeaves()).toEqual(['a'])
    })

    it('continues an ancestor guide only while that ancestor has a later sibling', () => {
        const rows = new TreeSelection(roots, []).rows()
        const guidesOf = (value: string): boolean[] | undefined =>
            rows.find(row => row.node.value === value)?.guides

        expect(guidesOf('group')).toEqual([])
        expect(guidesOf('a')).toEqual([true])
    })

    it('summarizes with the largest fully selected nodes', () => {
        expect(new TreeSelection(roots, ['a', 'b', 'c']).summary()).toEqual(['All'])
        expect(new TreeSelection(roots, ['a', 'b']).summary()).toEqual(['Group'])
        expect(new TreeSelection(roots, ['a', 'c']).summary()).toEqual(['a', 'c'])
    })
})

describe('tree selection radio rows', () => {
    const containers: TreeNode = {
        value: 'choice:containers',
        label: 'Containers',
        choices: [
            {
                value: 'existing',
                label: 'Existing',
            },
            {
                value: 'rebuild',
                label: 'Rebuild',
            },
        ],
    }
    const services: TreeNode = {
        value: 'choice:services',
        label: 'Services',
        choices: [
            {
                value: 'base',
                label: 'Base',
                selection: ['a'],
            },
            {
                value: 'all',
                label: 'All',
                selection: ['a', 'b'],
            },
        ],
    }
    const leafA: TreeNode = {
        value: 'a',
        label: 'a',
    }
    const leafB: TreeNode = {
        value: 'b',
        label: 'b',
    }
    const group: TreeNode = {
        value: 'group',
        label: 'Group',
        children: [leafA, leafB],
    }
    const roots = [containers, services, group]

    it('starts an independent row on its first choice and reports it', () => void expect(new TreeSelection(roots, ['a']).selectedOptions()).toEqual(['existing']))

    it('switches an independent row without touching the tree', () => {
        const selection = new TreeSelection(roots, ['a'])

        selection.switchChoice(containers, 1)

        expect(selection.selectedOptions()).toEqual(['rebuild'])
        expect(selection.selectedLeaves()).toEqual(['a'])
    })

    it('applies a selection choice to the tree', () => {
        const selection = new TreeSelection(roots, ['a'])

        selection.switchChoice(services, 1)

        expect(selection.selectedLeaves()).toEqual(['a', 'b'])
        expect(selection.activeChoice(services)?.value).toBe('all')
    })

    it('wraps around in both directions', () => {
        const selection = new TreeSelection(roots, ['a'])

        selection.switchChoice(containers, -1)

        expect(selection.selectedOptions()).toEqual(['rebuild'])
    })

    it('shows no active choice once the tree matches neither selection', () => {
        const selection = new TreeSelection(roots, ['b'])

        expect(selection.activeChoice(services)).toBeUndefined()
    })

    it('comes back to a choice when the tree matches it again', () => {
        const selection = new TreeSelection(roots, ['b'])

        selection.toggle(leafA)

        expect(selection.activeChoice(services)?.value).toBe('all')
    })

    it('picks the option on the side of the arrow from a custom selection', () => {
        const right = new TreeSelection(roots, ['b'])
        const left = new TreeSelection(roots, ['b'])

        right.switchChoice(services, 1)
        left.switchChoice(services, -1)

        expect(right.activeChoice(services)?.value).toBe('all')
        expect(left.activeChoice(services)?.value).toBe('base')
    })

    it('keeps an independent choice when the tree changes', () => {
        const selection = new TreeSelection(roots, ['a'])

        selection.switchChoice(containers, 1)
        selection.switchChoice(services, 1)

        expect(selection.selectedOptions()).toEqual(['rebuild'])
    })

    it('summarizes every row, and the tree only for a custom selection', () => {
        expect(new TreeSelection(roots, ['a']).summary()).toEqual(['Containers: Existing', 'Services: Base'])
        expect(new TreeSelection(roots, ['b']).summary()).toEqual(['Containers: Existing', 'b'])
    })
})

describe('tree multiselect prompt', () => {
    const roots: TreeNode[] = [{
        value: 'all',
        label: 'All services',
        children: [
            {
                value: 'group',
                label: 'Group',
                children: [
                    {
                        value: 'a',
                        label: 'service-a',
                    },
                    {
                        value: 'b',
                        label: 'service-b',
                    },
                ],
            },
            {
                value: 'c',
                label: 'service-c',
            },
        ],
    }]
    const DOWN = '\x1b[B'
    const LEFT = '\x1b[D'
    const RIGHT = '\x1b[C'
    const SPACE = ' '
    const ENTER = '\r'

    class PromptFixture {
        readonly input = new PassThrough()
        readonly output = new TerminalOutput()
        readonly result: Promise<string[] | symbol>

        constructor(initialValues = [
            'a',
            'b',
            'c',
        ]) {
            this.result = new TreeMultiSelectPrompt({
                message: 'Which services should run?',
                roots,
                initialValues,
                input: this.input,
                output: this.output,
            }).prompt()
        }

        async press(...keys: string[]): Promise<void> {
            for (const key of keys) {
                this.input.write(key)
                await delay(70)
            }
        }

        visibleText(): string {
            return stripVTControlCharacters(this.output.text)
        }
    }

    it('starts with the initial values selected', async () => {
        const fixture = new PromptFixture()

        await fixture.press(ENTER)

        expect(await fixture.result).toEqual(['a', 'b', 'c'])
    })

    it('draws the nested tree with guides and fold markers', async () => {
        const fixture = new PromptFixture()

        await fixture.press(DOWN)

        expect(fixture.visibleText()).toContain('├─ ◼ ▾ Group')
        expect(fixture.visibleText()).toContain('│  ├─ ◼ service-a')
        expect(fixture.visibleText()).toContain('└─ ◼ service-c')

        await fixture.press(ENTER)
        await fixture.result
    })

    it('clears a whole subgroup with Space on the group', async () => {
        const fixture = new PromptFixture()

        await fixture.press(DOWN, SPACE, ENTER)

        expect(await fixture.result).toEqual(['c'])
    })

    it('clears a single service with Space on its row', async () => {
        const fixture = new PromptFixture()

        await fixture.press(DOWN, DOWN, SPACE, ENTER)

        expect(await fixture.result).toEqual(['b', 'c'])
    })

    it('reselects everything with Space on the root after a partial change', async () => {
        const fixture = new PromptFixture(['a'])

        await fixture.press(SPACE, ENTER)

        expect(await fixture.result).toEqual(['a', 'b', 'c'])
    })

    it('skips hidden services after Left folds a group and restores them with Right', async () => {
        const fixture = new PromptFixture()

        // Group, fold, then the next visible row is service-c rather than service-a.
        await fixture.press(DOWN, LEFT, DOWN, SPACE)

        // Back on Group, unfold it, and service-a is the next row again.
        await fixture.press(DOWN, DOWN, RIGHT, DOWN, SPACE, ENTER)

        expect(await fixture.result).toEqual(['b'])
    })

    it('moves to the first child with Right and back to the parent with Left', async () => {
        const fixture = new PromptFixture()

        // Root, Group, service-a, back to Group, then clear Group.
        await fixture.press(DOWN, RIGHT, LEFT, SPACE, ENTER)

        expect(await fixture.result).toEqual(['c'])
    })

    it('refuses an empty selection and accepts it once a service is chosen', async () => {
        const fixture = new PromptFixture([])

        await fixture.press(ENTER)
        expect(fixture.visibleText()).toContain('Select at least one option.')

        await fixture.press(DOWN, DOWN, SPACE, ENTER)
        expect(await fixture.result).toEqual(['a'])
    })

    describe('with radio rows', () => {
        const openPrompt = (initialValues: string[]) => {
            const output = new TerminalOutput()
            const input = new PassThrough()
            const result = new TreeMultiSelectPrompt({
                message: 'Which services should run?',
                roots: [
                    {
                        value: 'choice:containers',
                        label: 'Containers',
                        choices: [
                            {
                                value: 'existing',
                                label: 'Use existing',
                                hint: 'Builds what is missing',
                            },
                            {
                                value: 'rebuild',
                                label: 'Rebuild',
                            },
                        ],
                    },
                    {
                        value: 'choice:set',
                        label: 'Set',
                        hint: 'Custom selection',
                        choices: [
                            {
                                value: 'base',
                                label: 'Base',
                                selection: ['a'],
                            },
                            {
                                value: 'all',
                                label: 'All',
                                selection: ['a', 'b'],
                            },
                        ],
                    },
                    {
                        value: 'first',
                        label: 'First',
                        children: [{
                            value: 'a',
                            label: 'service-a',
                        }],
                    },
                    {
                        value: 'second',
                        label: 'Second',
                        children: [{
                            value: 'b',
                            label: 'service-b',
                        }],
                    },
                ],
                initialValues,
                input,
                output,
            }).prompt()
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

        it('draws each row horizontally with its active choice marked', async () => {
            const prompt = openPrompt(['a'])

            await delay(70)

            const screen = stripVTControlCharacters(prompt.output.text)

            expect(screen).toContain('Containers  ● Use existing / ○ Rebuild (Builds what is missing)')
            expect(screen).toContain('Set         ● Base / ○ All')

            await prompt.press(ENTER)
            await prompt.result
        })

        it('highlights only the chosen value on the focused row, never its label', async () => {
            const previous = process.env.FORCE_COLOR

            process.env.FORCE_COLOR = '1'

            const prompt = openPrompt(['a'])

            await delay(70)

            expect(prompt.output.text).toContain('\x1b[32mUse existing')
            expect(prompt.output.text).not.toContain('\x1b[32mContainers')

            await prompt.press(ENTER)
            await prompt.result

            if (previous === undefined)
                delete process.env.FORCE_COLOR
            else
                process.env.FORCE_COLOR = previous
        })

        it('draws a chevron beside the focused radio row and moves it with the focus', async () => {
            const prompt = openPrompt(['a'])

            await prompt.press(DOWN)

            const screen = stripVTControlCharacters(prompt.output.text)

            expect(screen).toContain('❯ Containers')
            expect(screen).toContain('❯ Set')

            await prompt.press(ENTER)
            await prompt.result
        })

        it('switches with Right and Left, and returns the chosen option', async () => {
            const prompt = openPrompt(['a'])

            await prompt.press(RIGHT, ENTER)

            expect(await prompt.result).toEqual(['rebuild', 'a'])
        })

        it('applies a selection choice to the tree below it', async () => {
            const prompt = openPrompt(['a'])

            await prompt.press(DOWN, RIGHT, ENTER)

            expect(await prompt.result).toEqual(['existing', 'a', 'b'])
        })

        it('marks neither choice for a custom selection and shows the fallback hint', async () => {
            const prompt = openPrompt(['b'])

            await delay(70)

            expect(stripVTControlCharacters(prompt.output.text)).toContain('Set         ○ Base / ○ All (Custom selection)')

            await prompt.press(ENTER)
            await prompt.result
        })

        it('rejects an empty tree even though a radio row always has a value', async () => {
            const prompt = openPrompt([])

            await prompt.press(ENTER)
            expect(stripVTControlCharacters(prompt.output.text)).toContain('Select at least one option.')

            await prompt.press(DOWN, RIGHT, ENTER)
            expect(await prompt.result).toEqual(['existing', 'a', 'b'])
        })

        it('separates the radio rows from the tree with a line and blank line', async () => {
            const prompt = openPrompt(['a'])

            await prompt.press(DOWN)

            const screen = stripVTControlCharacters(prompt.output.text)

            expect(screen).toMatch(/Rebuild[^\n]*\n│\s+Set/u)
            expect(screen).toMatch(/All[^\n]*\n│\s+─+\n│\s*\n│\s+◼ ▾ First/u)
            expect(screen).toMatch(/service-a\n│\s*\n│\s+◻ ▾ Second/u)

            await prompt.press(ENTER)
            await prompt.result
        })
    })

    it('draws a blank line before the guide text', async () => {
        const fixture = new PromptFixture()

        await fixture.press(DOWN)

        expect(fixture.visibleText()).toMatch(/service-c\n│\s*\n│\s+Arrows move/u)

        await fixture.press(ENTER)
        await fixture.result
    })

    it('colors the focused row green, mutes only unselected rows and the guide', async () => {
        const previous = process.env.FORCE_COLOR

        process.env.FORCE_COLOR = '1'

        const fixture = new PromptFixture(['a'])

        await fixture.press(DOWN)

        const frame = fixture.output.text.slice(fixture.output.text.lastIndexOf('All services'))
        const lineWith = (label: string): string =>
            frame.split('\n').find(line => line.includes(label)) ?? ''

        expect(lineWith('Group')).toContain('\x1b[32mGroup')
        expect(lineWith('service-a')).not.toMatch(/\x1b\[2m[^\n]*service-a/u)
        expect(lineWith('service-b')).toMatch(/\x1b\[2mservice-b/u)
        expect(lineWith('Arrows move')).toMatch(/\x1b\[2mArrows move/u)

        await fixture.press(ENTER)
        await fixture.result

        if (previous === undefined)
            delete process.env.FORCE_COLOR
        else
            process.env.FORCE_COLOR = previous
    })

    it('keeps flat top-level rows together without blank lines', async () => {
        const output = new TerminalOutput()
        const input = new PassThrough()
        const result = new TreeMultiSelectPrompt({
            message: 'Pick',
            roots: [
                {
                    value: 'a',
                    label: 'flat-a',
                },
                {
                    value: 'b',
                    label: 'flat-b',
                },
            ],
            initialValues: ['a'],
            input,
            output,
        }).prompt()

        input.write(DOWN)
        await delay(70)

        expect(stripVTControlCharacters(output.text)).toMatch(/flat-a\n│\s+◻ flat-b/u)

        input.write(ENTER)
        await result
    })

    it('draws a chevron beside the focused tree row', async () => {
        const fixture = new PromptFixture()

        await fixture.press(DOWN, DOWN)

        expect(fixture.visibleText()).toMatch(/❯ [│ ]*├─ ◼ service-a/u)

        await fixture.press(ENTER)
        await fixture.result
    })

    it('highlights only the horizontal connector of the focused row', async () => {
        const previous = process.env.FORCE_COLOR

        process.env.FORCE_COLOR = '1'

        const fixture = new PromptFixture()

        // Root, Group, then service-a inside Group.
        await fixture.press(DOWN, DOWN)

        const frame = fixture.output.text.slice(fixture.output.text.lastIndexOf('\x1b[32m├─'))

        expect(frame.split('\n')[0]).toContain('service-a')

        const rows = fixture.output.text.split('\n')
        const unfocused = rows.findLast(line => line.includes('service-b')) ?? ''

        expect(unfocused).not.toContain('\x1b[32m└─')

        await fixture.press(ENTER)
        await fixture.result

        if (previous === undefined)
            delete process.env.FORCE_COLOR
        else
            process.env.FORCE_COLOR = previous
    })

    it('summarizes the choice after submitting', async () => {
        const fixture = new PromptFixture(['a', 'b'])

        await fixture.press(ENTER)
        await fixture.result

        expect(fixture.visibleText()).toContain('Group')
    })

    it('returns the cancel symbol on Escape', async () => {
        const fixture = new PromptFixture()

        await fixture.press('\x1b')

        expect(isCancel(await fixture.result)).toBe(true)
    })
})
