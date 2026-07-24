import type { CapabilityKind, CapabilityPromptReference } from '@lixpi/constants'
import { CAPABILITY_REFERENCE_NODE_TYPE } from '@lixpi/prosemirror'
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import type {
    CapabilityCatalogClient,
    CapabilityCatalogItem,
} from '$src/services/capability-catalog-client.ts'
import {
    getTransformedAncestorScale,
    resolveFloatingMenuScreenPosition,
    screenPointToLocal,
} from '$src/components/proseMirror/plugins/floatingMenuPosition.ts'
import { applyStyle, html } from '$src/utils/domTemplates.ts'

export const capabilityMentionPluginKey = new PluginKey<CapabilityMentionState>('capabilityMention')

export type CapabilityMentionState = {
    active: boolean
    triggerPos: number
    query: string
    selectedIndex: number
}

const INITIAL_STATE: CapabilityMentionState = {
    active: false,
    triggerPos: -1,
    query: '',
    selectedIndex: 0,
}

const SEARCH_DEBOUNCE_MS = 150

export function reduceCapabilityMentionState(
    tr: Transaction,
    state: CapabilityMentionState,
): CapabilityMentionState {
    const meta = tr.getMeta(capabilityMentionPluginKey)
    if (meta?.type === 'open') {
        return { active: true, triggerPos: meta.triggerPos, query: '', selectedIndex: 0 }
    }
    if (meta?.type === 'close') return { ...INITIAL_STATE }
    if (meta?.type === 'select') return { ...state, selectedIndex: meta.selectedIndex }
    if (!state.active) return state

    const triggerPos = tr.mapping.map(state.triggerPos)
    const cursorPos = tr.selection.from
    if (!tr.selection.empty || cursorPos <= triggerPos) return { ...INITIAL_STATE }

    const query = tr.doc.textBetween(triggerPos + 1, cursorPos, ' ')
    if (/\n/.test(query) || query.length > 80) return { ...INITIAL_STATE }
    return {
        active: true,
        triggerPos,
        query,
        selectedIndex: query === state.query ? state.selectedIndex : 0,
    }
}

export function isCurrentCapabilityMentionResponse(
    requestSequence: number,
    currentRequestSequence: number,
    requestedQuery: string,
    state: CapabilityMentionState | undefined,
): boolean {
    return requestSequence === currentRequestSequence
        && state?.active === true
        && state.query === requestedQuery
}

export function nextCapabilityMentionIndex(
    selectedIndex: number,
    direction: 'next' | 'previous',
    resultCount: number,
): number {
    if (resultCount <= 0) return 0
    const delta = direction === 'next' ? 1 : -1
    return (selectedIndex + delta + resultCount) % resultCount
}

class CapabilityMentionMenu {
    private readonly menu: HTMLDivElement
    private readonly list: HTMLDivElement
    private results: CapabilityCatalogItem[] = []
    private requestSequence = 0
    private lastQuery: string | null = null
    private searchTimer: ReturnType<typeof setTimeout> | undefined

    constructor(
        private readonly view: EditorView,
        private readonly catalog: Pick<CapabilityCatalogClient, 'search'> & Partial<Pick<CapabilityCatalogClient, 'rememberSelection'>>,
    ) {
        this.list = html`<div className="capability-mention-menu-list"></div>` as HTMLDivElement
        this.menu = html`
            <div
                className="capability-mention-menu"
                role="listbox"
                aria-label="Tools and Skills"
                contenteditable="false"
                style=${{ display: 'none' }}
            >
                ${this.list}
            </div>
        ` as HTMLDivElement
        this.view.dom.parentElement?.appendChild(this.menu)
    }

    update(): void {
        const state = capabilityMentionPluginKey.getState(this.view.state)
        if (!state?.active || !this.view.editable) {
            this.hide()
            return
        }

        if (state.query !== this.lastQuery) {
            this.lastQuery = state.query
            this.load(state.query)
            this.show(state.triggerPos)
            return
        }
        this.render(state.selectedIndex)
        this.show(state.triggerPos)
    }

    handleKeyDown(event: KeyboardEvent): boolean {
        const state = capabilityMentionPluginKey.getState(this.view.state)
        if (!state?.active) return false

        if (event.key === 'Escape') {
            event.preventDefault()
            this.close()
            return true
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (this.results.length === 0) return true
            const selectedIndex = nextCapabilityMentionIndex(
                state.selectedIndex,
                event.key === 'ArrowDown' ? 'next' : 'previous',
                this.results.length,
            )
            this.view.dispatch(this.view.state.tr.setMeta(capabilityMentionPluginKey, { type: 'select', selectedIndex }))
            return true
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && this.results[state.selectedIndex]) {
            event.preventDefault()
            this.insert(this.results[state.selectedIndex])
            return true
        }
        return false
    }

    destroy(): void {
        this.cancelPendingSearch()
        this.menu.remove()
    }

    private load(query: string): void {
        this.cancelPendingSearch()
        const requestSequence = ++this.requestSequence
        this.list.replaceChildren(html`<div className="capability-mention-menu-status">Searching…</div>`)
        this.searchTimer = setTimeout(() => {
            this.searchTimer = undefined
            void this.executeSearch(query, requestSequence)
        }, SEARCH_DEBOUNCE_MS)
    }

    private async executeSearch(query: string, requestSequence: number): Promise<void> {
        try {
            const page = await this.catalog.search(query)
            const state = capabilityMentionPluginKey.getState(this.view.state)
            if (!isCurrentCapabilityMentionResponse(requestSequence, this.requestSequence, query, state)) return
            this.results = page.items
            this.render(state.selectedIndex)
            this.show(state.triggerPos)
        } catch {
            if (requestSequence !== this.requestSequence) return
            this.results = []
            this.list.replaceChildren(html`<div className="capability-mention-menu-status">Could not load Tools and Skills.</div>`)
            const state = capabilityMentionPluginKey.getState(this.view.state)
            if (state?.active) this.show(state.triggerPos)
        }
    }

    private render(selectedIndex: number): void {
        if (this.results.length === 0) {
            this.list.replaceChildren(html`<div className="capability-mention-menu-status">No matching Tools or Skills.</div>`)
            return
        }

        const rows = this.results.map((item, index) => {
            const selected = index === selectedIndex
            const handleMouseDown = (event: MouseEvent): void => {
                event.preventDefault()
                event.stopPropagation()
                this.insert(item)
            }
            return html`
                <button
                    type="button"
                    className=${`capability-mention-menu-item${selected ? ' is-selected' : ''}`}
                    role="option"
                    aria-selected=${String(selected)}
                    onmousedown=${handleMouseDown}
                >
                    <span className=${`capability-kind-badge capability-kind-badge-${item.kind}`}>${item.kind}</span>
                    <span className="capability-mention-menu-copy">
                        <strong>${item.name}</strong>
                        <small>${item.summary}</small>
                    </span>
                    <span className="capability-scope-badge">${item.scope}</span>
                </button>
            ` as HTMLButtonElement
        })
        this.list.replaceChildren(...rows)
    }

    private insert(item: CapabilityCatalogItem): void {
        const state = capabilityMentionPluginKey.getState(this.view.state)
        const nodeType = this.view.state.schema.nodes[CAPABILITY_REFERENCE_NODE_TYPE]
        if (!state?.active || !nodeType) return

        const atom = nodeType.create({
            capabilityId: item.capabilityId,
            kind: item.kind,
            displayName: item.name,
        })
        this.catalog.rememberSelection?.(item)
        const tr = this.view.state.tr
            .replaceWith(state.triggerPos, this.view.state.selection.from, atom)
            .insertText(' ')
            .setMeta(capabilityMentionPluginKey, { type: 'close' })
            .scrollIntoView()
        this.view.dispatch(tr)
        this.view.focus()
    }

    private close(): void {
        this.view.dispatch(this.view.state.tr.setMeta(capabilityMentionPluginKey, { type: 'close' }))
    }

    private show(triggerPos: number): void {
        const coords = this.view.coordsAtPos(triggerPos)
        const parent = this.menu.parentElement
        const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 }
        this.menu.style.display = 'block'
        const menuRect = this.menu.getBoundingClientRect()
        const scale = getTransformedAncestorScale(parent)
        const screenPosition = resolveFloatingMenuScreenPosition(
            coords,
            menuRect,
            { width: window.innerWidth, height: window.innerHeight },
            6 * scale,
        )
        const localPosition = screenPointToLocal(parentRect, screenPosition, scale)
        applyStyle(this.menu, {
            display: 'block',
            left: `${localPosition.left}px`,
            top: `${localPosition.top}px`,
        })
        this.menu.dataset.placement = screenPosition.placement
    }

    private hide(): void {
        this.cancelPendingSearch()
        this.lastQuery = null
        this.results = []
        this.menu.style.display = 'none'
    }

    private cancelPendingSearch(): void {
        this.requestSequence += 1
        if (this.searchTimer !== undefined) {
            clearTimeout(this.searchTimer)
            this.searchTimer = undefined
        }
    }
}

export function createCapabilityMentionPlugin(
    catalog: Pick<CapabilityCatalogClient, 'search'> & Partial<Pick<CapabilityCatalogClient, 'rememberSelection'>>,
): Plugin<CapabilityMentionState> {
    let menu: CapabilityMentionMenu | null = null

    return new Plugin<CapabilityMentionState>({
        key: capabilityMentionPluginKey,
        state: {
            init: () => ({ ...INITIAL_STATE }),
            apply: reduceCapabilityMentionState,
        },
        props: {
            handleTextInput(view, from, to, text) {
                if (text !== '@') return false
                const { $from } = view.state.selection
                if ($from.parent.type.name === 'code_block') return false
                const characterBefore = from > 0 ? view.state.doc.textBetween(from - 1, from, '') : ''
                if ($from.parentOffset !== 0 && !/\s/.test(characterBefore)) return false

                view.dispatch(view.state.tr
                    .insertText('@', from, to)
                    .setMeta(capabilityMentionPluginKey, { type: 'open', triggerPos: from }))
                return true
            },
            handleKeyDown: (_view, event) => menu?.handleKeyDown(event) ?? false,
        },
        view(editorView) {
            menu = new CapabilityMentionMenu(editorView, catalog)
            return {
                update: () => menu?.update(),
                destroy: () => {
                    menu?.destroy()
                    menu = null
                },
            }
        },
    })
}

export function collectCapabilityReferences(contentJSON: unknown[]): CapabilityPromptReference[] {
    const references: CapabilityPromptReference[] = []
    const seen = new Set<string>()

    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        const node = value as { type?: unknown; attrs?: unknown; content?: unknown }
        if (node.type === CAPABILITY_REFERENCE_NODE_TYPE && node.attrs && typeof node.attrs === 'object') {
            const attrs = node.attrs as { capabilityId?: unknown; kind?: unknown }
            if (typeof attrs.capabilityId === 'string' && isCapabilityKind(attrs.kind) && !seen.has(attrs.capabilityId)) {
                seen.add(attrs.capabilityId)
                references.push({ capabilityId: attrs.capabilityId, kind: attrs.kind })
            }
        }
        if (Array.isArray(node.content)) node.content.forEach(visit)
    }

    contentJSON.forEach(visit)
    return references
}

function isCapabilityKind(value: unknown): value is CapabilityKind {
    return value === 'tool' || value === 'skill'
}
