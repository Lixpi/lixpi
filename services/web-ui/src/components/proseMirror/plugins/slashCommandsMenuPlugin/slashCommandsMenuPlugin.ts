import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { createEl } from '$src/utils/domTemplates.ts'
import { SLASH_COMMANDS, filterCommands, type SlashCommand } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/commandRegistry.ts'
import { documentTitleNodeType } from '$src/components/proseMirror/customNodes/documentTitleNode.js'

export const slashCommandsMenuPluginKey = new PluginKey('slashCommandsMenu')

type SlashCommandsPluginState = {
    active: boolean
    query: string
    triggerPos: number
    selectedIndex: number
}

const INITIAL_STATE: SlashCommandsPluginState = {
    active: false,
    query: '',
    triggerPos: -1,
    selectedIndex: 0,
}

type SlashCommandsMenuViewOptions = {
    view: EditorView
}

class SlashCommandsMenuView {
    private view: EditorView
    private menu: HTMLElement
    private menuList: HTMLElement
    private menuParent: HTMLElement | null = null
    private filteredCommands: SlashCommand[] = []

    constructor({ view }: SlashCommandsMenuViewOptions) {
        this.view = view

        this.menu = createEl('div', {
            className: 'slash-commands-menu',
            role: 'listbox',
            'aria-label': 'Slash commands',
            style: {
                position: 'absolute',
                visibility: 'hidden',
                zIndex: '100',
            },
        })

        this.menuList = createEl('div', { className: 'slash-commands-menu-list' })
        this.menu.appendChild(this.menuList)

        // Append to editor's parent so menu scales with transformed viewport
        this.menuParent = view.dom.parentNode as HTMLElement
        this.menuParent?.appendChild(this.menu)
    }

    private shouldShow(): boolean {
        const { state } = this.view
        const { selection } = state

        if (!this.view.hasFocus()) return false
        if (!this.view.editable) return false

        const { $from } = selection
        const isCodeBlock = $from.parent.type.name === 'code_block'
        if (isCodeBlock) return false

        const isDocumentTitle = $from.parent.type.name === documentTitleNodeType
        if (isDocumentTitle) return false

        return true
    }

    private findTransformedAncestor(): { element: HTMLElement; scale: number } | null {
        let current: HTMLElement | null = this.menuParent
        while (current) {
            const style = getComputedStyle(current)
            const transform = style.transform
            if (transform && transform !== 'none') {
                const match = transform.match(/matrix\(([^,]+),/)
                if (match) {
                    return { element: current, scale: parseFloat(match[1]) }
                }
            }
            current = current.parentElement
        }
        return null
    }

    private screenToLocal(screenX: number, screenY: number): { x: number; y: number } {
        if (!this.menuParent) {
            return { x: screenX, y: screenY }
        }

        const parentRect = this.menuParent.getBoundingClientRect()
        const transformInfo = this.findTransformedAncestor()
        const scale = transformInfo?.scale ?? 1

        const localX = (screenX - parentRect.left) / scale
        const localY = (screenY - parentRect.top) / scale

        return { x: localX, y: localY }
    }

    private getScale(): number {
        const transformInfo = this.findTransformedAncestor()
        return transformInfo?.scale ?? 1
    }

    private updatePosition(triggerPos: number): void {
        const coords = this.view.coordsAtPos(triggerPos)
        const scale = this.getScale()

        // Convert screen coordinates to local
        const local = this.screenToLocal(coords.left, coords.bottom + 4 * scale)

        Object.assign(this.menu.style, {
            left: `${local.x}px`,
            top: `${local.y}px`,
        })
    }

    private buildMenuItems(commands: SlashCommand[], selectedIndex: number): void {
        this.menuList.innerHTML = ''
        this.filteredCommands = commands

        if (commands.length === 0) {
            const emptyItem = createEl('div', {
                className: 'slash-commands-menu-empty',
            }, 'No commands found')
            this.menuList.appendChild(emptyItem)
            return
        }

        commands.forEach((cmd, index) => {
            const isSelected = index === selectedIndex
            const item = createEl('div', {
                className: `slash-commands-menu-item${isSelected ? ' is-selected' : ''}`,
                role: 'option',
                'aria-selected': isSelected ? 'true' : 'false',
                data: { index: index.toString() },
            })

            const iconWrapper = createEl('span', {
                className: 'slash-commands-menu-item-icon',
                innerHTML: cmd.icon,
            })

            const nameEl = createEl('span', { className: 'slash-commands-menu-item-name' }, cmd.name)

            item.appendChild(iconWrapper)
            item.appendChild(nameEl)

            item.addEventListener('mouseenter', () => {
                this.updateSelectedIndex(index)
            })

            item.addEventListener('mousedown', (e) => {
                e.preventDefault()
                e.stopPropagation()
                this.executeCommand(index)
            })

            this.menuList.appendChild(item)
        })
    }

    private updateSelectedIndex(index: number): void {
        const pluginState = slashCommandsMenuPluginKey.getState(this.view.state) as SlashCommandsPluginState | undefined
        if (!pluginState?.active) return

        const tr = this.view.state.tr.setMeta(slashCommandsMenuPluginKey, {
            type: 'updateSelectedIndex',
            selectedIndex: index,
        })
        this.view.dispatch(tr)
    }

    private executeCommand(index: number): void {
        const command = this.filteredCommands[index]
        if (!command) return

        const pluginState = slashCommandsMenuPluginKey.getState(this.view.state) as SlashCommandsPluginState | undefined
        if (!pluginState?.active) return

        // Delete the slash and query text
        const { triggerPos, query } = pluginState
        const deleteEnd = triggerPos + 1 + query.length // +1 for the `/`
        const tr = this.view.state.tr.delete(triggerPos, deleteEnd)
        tr.setMeta(slashCommandsMenuPluginKey, { type: 'close' })
        this.view.dispatch(tr)

        // Execute the command
        command.execute(this.view)
        this.view.focus()
    }

    private show(): void {
        this.menu.style.visibility = 'visible'
        this.menu.classList.add('is-visible')
    }

    private hide(): void {
        this.menu.style.visibility = 'hidden'
        this.menu.classList.remove('is-visible')
    }

    update(): void {
        const pluginState = slashCommandsMenuPluginKey.getState(this.view.state) as SlashCommandsPluginState | undefined

        if (!pluginState?.active || !this.shouldShow()) {
            this.hide()
            return
        }

        const { query, triggerPos, selectedIndex } = pluginState
        const filteredCommands = filterCommands(query)

        this.buildMenuItems(filteredCommands, selectedIndex)
        this.show()
        this.updatePosition(triggerPos)
    }

    handleKeyDown(event: KeyboardEvent): boolean {
        const pluginState = slashCommandsMenuPluginKey.getState(this.view.state) as SlashCommandsPluginState | undefined
        if (!pluginState?.active) return false

        const { selectedIndex, query } = pluginState
        const filteredCommands = filterCommands(query)
        const commandCount = filteredCommands.length

        switch (event.key) {
            case 'ArrowDown': {
                event.preventDefault()
                const newIndex = (selectedIndex + 1) % commandCount
                this.updateSelectedIndex(newIndex)
                return true
            }
            case 'ArrowUp': {
                event.preventDefault()
                const newIndex = (selectedIndex - 1 + commandCount) % commandCount
                this.updateSelectedIndex(newIndex)
                return true
            }
            case 'Enter':
            case 'Tab': {
                if (commandCount > 0) {
                    event.preventDefault()
                    this.executeCommand(selectedIndex)
                    return true
                }
                return false
            }
            case 'Escape': {
                event.preventDefault()
                const tr = this.view.state.tr.setMeta(slashCommandsMenuPluginKey, { type: 'close' })
                this.view.dispatch(tr)
                return true
            }
            default:
                return false
        }
    }

    destroy(): void {
        this.menu.remove()
    }
}

let menuViewInstance: SlashCommandsMenuView | null = null

export function slashCommandsMenuPlugin(): Plugin<SlashCommandsPluginState> {
    return new Plugin<SlashCommandsPluginState>({
        key: slashCommandsMenuPluginKey,

        state: {
            init(): SlashCommandsPluginState {
                return { ...INITIAL_STATE }
            },

            apply(tr: Transaction, state: SlashCommandsPluginState): SlashCommandsPluginState {
                const meta = tr.getMeta(slashCommandsMenuPluginKey)

                if (meta?.type === 'open') {
                    return {
                        active: true,
                        query: '',
                        triggerPos: meta.triggerPos,
                        selectedIndex: 0,
                    }
                }

                if (meta?.type === 'close') {
                    return { ...INITIAL_STATE }
                }

                if (meta?.type === 'updateSelectedIndex') {
                    return {
                        ...state,
                        selectedIndex: meta.selectedIndex,
                    }
                }

                // If menu is active, track query changes
                if (state.active) {
                    const { from } = tr.selection
                    const newTriggerPos = tr.mapping.map(state.triggerPos)

                    // Check if cursor moved before trigger or selection is empty
                    if (from <= newTriggerPos) {
                        return { ...INITIAL_STATE }
                    }

                    // Extract query text between trigger and cursor
                    const queryStart = newTriggerPos + 1 // after the `/`
                    const queryEnd = from

                    if (queryEnd < queryStart) {
                        return { ...INITIAL_STATE }
                    }

                    const query = tr.doc.textBetween(queryStart, queryEnd, '')

                    // Close if query contains space or newline
                    if (/\s/.test(query)) {
                        return { ...INITIAL_STATE }
                    }

                    // Reset selected index if query changed
                    const selectedIndex = query !== state.query ? 0 : state.selectedIndex

                    return {
                        ...state,
                        triggerPos: newTriggerPos,
                        query,
                        selectedIndex,
                    }
                }

                return state
            },
        },

        props: {
            handleTextInput(view: EditorView, from: number, to: number, text: string) {
                if (text !== '/') return false

                const { state } = view
                const { $from } = state.selection

                // Check exclusion zones
                const isCodeBlock = $from.parent.type.name === 'code_block'
                if (isCodeBlock) return false

                const isDocumentTitle = $from.parent.type.name === documentTitleNodeType
                if (isDocumentTitle) return false

                // Check if at start of line or after whitespace
                const isStartOfLine = $from.parentOffset === 0
                const charBefore = from > 0 ? state.doc.textBetween(from - 1, from, '') : ''
                const isAfterWhitespace = /\s/.test(charBefore)

                if (isStartOfLine || isAfterWhitespace) {
                    // Insert the `/` and open menu
                    const tr = state.tr.insertText(text, from, to)
                    tr.setMeta(slashCommandsMenuPluginKey, {
                        type: 'open',
                        triggerPos: from,
                    })
                    view.dispatch(tr)
                    return true
                }

                return false
            },

            handleKeyDown(view: EditorView, event: KeyboardEvent) {
                if (menuViewInstance) {
                    return menuViewInstance.handleKeyDown(event)
                }
                return false
            },
        },

        view(editorView: EditorView) {
            menuViewInstance = new SlashCommandsMenuView({ view: editorView })
            return menuViewInstance
        },
    })
}

export { SlashCommandsMenuView }
