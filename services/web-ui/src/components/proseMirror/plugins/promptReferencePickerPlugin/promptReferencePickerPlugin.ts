import { select } from 'd3-selection'
import {
    type PromptReferenceCatalogItem,
    type PromptReferenceCategory,
} from '@lixpi/constants'
import { PROMPT_REFERENCE_NODE_TYPE } from '@lixpi/prosemirror'
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { createSlidingSwitch, type SlidingSwitchInstance } from '$src/components/slidingSwitch/index.ts'
import AuthService from '$src/services/auth-service.ts'
import type { PromptReferenceCatalogClient } from '$src/services/prompt-reference-catalog-client.ts'
import {
    type FloatingMenuPlacement,
    getTransformedAncestorScale,
    resolveFloatingMenuScreenPosition,
    screenPointToLocal,
} from '$src/components/proseMirror/plugins/floatingMenuPosition.ts'
import { applyStyle, html } from '$src/utils/domTemplates.ts'
import { resolveAuthenticatedMediaUrl } from '$src/utils/mediaUrls.ts'

export type PromptReferencePickerMode = 'references' | 'modules'

export type PromptReferencePickerState = {
    active: boolean
    triggerPos: number
    query: string
    selectedIndex: number
    category: PromptReferenceCategory
}

export const promptReferencePickerPluginKey = new PluginKey<PromptReferencePickerState>('promptReferencePicker')
export const capabilityModulePickerPluginKey = new PluginKey<PromptReferencePickerState>('capabilityModulePicker')

const SEARCH_DEBOUNCE_MS = 150
const PAGE_LIMIT = 20
const REFERENCE_CATEGORIES: Array<{ label: string; value: PromptReferenceCategory }> = [
    { label: 'Media', value: 'media' },
    { label: 'Capabilities', value: 'capabilities' },
    { label: 'Tools', value: 'tools' },
    { label: 'Skills', value: 'skills' },
]

const initialState = (mode: PromptReferencePickerMode): PromptReferencePickerState => ({
    active: false,
    triggerPos: -1,
    query: '',
    selectedIndex: 0,
    category: mode === 'modules' ? 'capabilities' : 'media',
})

export function reducePromptReferencePickerState(
    tr: Transaction,
    state: PromptReferencePickerState,
    key: PluginKey<PromptReferencePickerState>,
    mode: PromptReferencePickerMode,
): PromptReferencePickerState {
    const meta = tr.getMeta(key)
    if (meta?.type === 'open') return { ...initialState(mode), active: true, triggerPos: meta.triggerPos }
    if (meta?.type === 'close') return initialState(mode)
    if (meta?.type === 'select') return { ...state, selectedIndex: meta.selectedIndex }
    if (meta?.type === 'category' && mode === 'references') {
        return { ...state, category: meta.category, selectedIndex: 0 }
    }
    if (!state.active) return state

    const triggerPos = tr.mapping.map(state.triggerPos)
    const cursorPos = tr.selection.from
    if (!tr.selection.empty || cursorPos <= triggerPos) return initialState(mode)
    const query = tr.doc.textBetween(triggerPos + 1, cursorPos, ' ')
    if (/\s/.test(query) || query.length > 80) return initialState(mode)
    return {
        ...state,
        triggerPos,
        query,
        selectedIndex: query === state.query ? state.selectedIndex : 0,
    }
}

export function nextPromptReferencePickerIndex(
    selectedIndex: number,
    direction: 'next' | 'previous',
    resultCount: number,
): number {
    if (resultCount <= 0) return 0
    const delta = direction === 'next' ? 1 : -1
    return (selectedIndex + delta + resultCount) % resultCount
}

class PromptReferencePickerMenu {
    private readonly menu: HTMLDivElement
    private readonly list: HTMLDivElement
    private readonly categorySwitch: SlidingSwitchInstance<PromptReferenceCategory> | null
    private readonly rowCache = new Map<string, { element: HTMLButtonElement; signature: string }>()
    private results: PromptReferenceCatalogItem[] = []
    private cursor: string | undefined
    private loading = false
    private menuVisible = false
    private positionedTriggerPos: number | null = null
    private menuPlacement: FloatingMenuPlacement | null = null
    private activeCategory: PromptReferenceCategory | null = null
    private requestSequence = 0
    private lastRequestKey: string | null = null
    private searchTimer: ReturnType<typeof setTimeout> | undefined

    private readonly handleWheel = (event: WheelEvent): void => {
        event.stopPropagation()
    }

    constructor(
        private readonly view: EditorView,
        private readonly catalog: PromptReferenceCatalogClient,
        private readonly mode: PromptReferencePickerMode,
        private readonly key: PluginKey<PromptReferencePickerState>,
    ) {
        this.list = html`<div className="prompt-reference-picker-list"></div>` as HTMLDivElement
        const switchSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        switchSvg.classList.add('prompt-reference-picker-switch')
        switchSvg.setAttribute('width', '416')
        switchSvg.setAttribute('height', '32')
        switchSvg.setAttribute('viewBox', '0 0 416 32')
        switchSvg.setAttribute('aria-label', 'Reference category')
        const header = mode === 'references'
            ? html`<div className="prompt-reference-picker-header"></div>` as HTMLDivElement
            : null
        header?.append(switchSvg)
        this.menu = html`
            <div
                className=${`prompt-reference-picker prompt-reference-picker-${mode} nopan nowheel`}
                role="listbox"
                aria-label=${mode === 'modules' ? 'Capabilities' : 'Prompt references'}
                contenteditable="false"
                onwheel=${this.handleWheel}
                style=${{ display: 'none' }}
            >
                ${header}
                ${this.list}
            </div>
        ` as HTMLDivElement
        this.view.dom.parentElement?.appendChild(this.menu)
        this.categorySwitch = mode === 'references'
            ? createSlidingSwitch(select(switchSvg), {
                id: 'prompt-reference-category',
                x: 0,
                y: 2,
                width: 416,
                height: 28,
                options: REFERENCE_CATEGORIES,
                selectedValue: 'media',
                role: 'radiogroup',
                optionRole: 'radio',
                selectedAriaAttribute: 'aria-checked',
                onChange: category => this.changeCategory(category),
            })
            : null
    }

    update(): void {
        const state = this.key.getState(this.view.state)
        if (!state?.active || !this.view.editable) {
            this.hide()
            return
        }
        this.categorySwitch?.setValue(state.category)
        const categoryChanged = this.activeCategory !== null && this.activeCategory !== state.category
        this.activeCategory = state.category
        const requestKey = `${state.category}\n${state.query}`
        if (requestKey !== this.lastRequestKey) {
            this.lastRequestKey = requestKey
            this.loadFirstPage(state.category, state.query, categoryChanged)
        }
        this.updateSelection(state.selectedIndex)
        if (this.menuVisible) this.show(state.triggerPos, categoryChanged)
    }

    handleKeyDown(event: KeyboardEvent): boolean {
        const state = this.key.getState(this.view.state)
        if (!state?.active) return false
        if (event.key === 'Escape') {
            event.preventDefault()
            this.close()
            return true
        }
        if (this.loading && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
            event.preventDefault()
            return true
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (event.key === 'ArrowDown'
                && state.selectedIndex === this.results.length - 1
                && this.cursor) {
                void this.loadMore(state.category, state.query)
                return true
            }
            const selectedIndex = nextPromptReferencePickerIndex(
                state.selectedIndex,
                event.key === 'ArrowDown' ? 'next' : 'previous',
                this.results.length,
            )
            this.view.dispatch(this.view.state.tr.setMeta(this.key, { type: 'select', selectedIndex }))
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
        this.categorySwitch?.destroy()
        this.menu.remove()
    }

    private changeCategory(category: PromptReferenceCategory): void {
        const state = this.key.getState(this.view.state)
        if (!state?.active || state.category === category) return
        this.view.dispatch(this.view.state.tr.setMeta(this.key, { type: 'category', category }))
    }

    private loadFirstPage(
        category: PromptReferenceCategory,
        query: string,
        categoryChanged: boolean,
    ): void {
        this.cancelPendingSearch()
        this.loading = true
        this.cursor = undefined
        this.menu.setAttribute('aria-busy', 'true')
        if (!this.menuVisible || categoryChanged) {
            this.results = []
            this.list.replaceChildren(html`<div className="prompt-reference-picker-status" role="status">Searching…</div>`)
        }
        const requestSequence = ++this.requestSequence
        this.searchTimer = setTimeout(() => {
            this.searchTimer = undefined
            void this.executeList({
                category,
                query,
                requestSequence,
                append: false,
            })
        }, SEARCH_DEBOUNCE_MS)
    }

    private async loadMore(category: PromptReferenceCategory, query: string): Promise<void> {
        if (!this.cursor) return
        const requestSequence = ++this.requestSequence
        await this.executeList({ category, query, requestSequence, append: true, cursor: this.cursor })
    }

    private async executeList({
        category,
        query,
        requestSequence,
        append,
        cursor,
    }: {
        category: PromptReferenceCategory
        query: string
        requestSequence: number
        append: boolean
        cursor?: string
    }): Promise<void> {
        try {
            const page = await this.catalog.list({ category, query, cursor, limit: PAGE_LIMIT })
            const state = this.key.getState(this.view.state)
            if (requestSequence !== this.requestSequence || !state?.active
                || state.category !== category || state.query !== query) return
            if (!append) {
                this.loading = false
                this.menu.removeAttribute('aria-busy')
            }
            const existingKeys = new Set(this.results.map(getCatalogItemKey))
            this.results = append
                ? [...this.results, ...page.items.filter(item => !existingKeys.has(getCatalogItemKey(item)))]
                : page.items
            this.cursor = page.cursor
            this.render(state.selectedIndex)
            this.show(state.triggerPos, true)
        } catch {
            if (requestSequence !== this.requestSequence) return
            const state = this.key.getState(this.view.state)
            if (!state?.active || state.category !== category || state.query !== query) return
            if (!append) {
                this.loading = false
                this.menu.removeAttribute('aria-busy')
            }
            this.results = []
            this.cursor = undefined
            this.list.replaceChildren(html`<div className="prompt-reference-picker-status" role="status">Could not load ${categoryLabel(category)}.</div>`)
            this.show(state.triggerPos, true)
        }
    }

    private render(selectedIndex: number): void {
        const state = this.key.getState(this.view.state)
        if (!state) return
        if (this.results.length === 0) {
            this.rowCache.clear()
            this.list.replaceChildren(html`<div className="prompt-reference-picker-status" role="status">No matching ${categoryLabel(state.category)}.</div>`)
            return
        }
        const currentKeys = new Set<string>()
        const rows = this.results.map((item) => {
            const itemKey = getCatalogItemKey(item)
            const signature = getCatalogItemSignature(item)
            currentKeys.add(itemKey)
            const cached = this.rowCache.get(itemKey)
            if (cached?.signature === signature) return cached.element
            const element = this.renderRow(item, itemKey)
            this.rowCache.set(itemKey, { element, signature })
            return element
        })
        for (const itemKey of this.rowCache.keys()) {
            if (!currentKeys.has(itemKey)) this.rowCache.delete(itemKey)
        }
        if (this.cursor) {
            const loadMore = html`
                <button
                    type="button"
                    className="prompt-reference-picker-load-more"
                    onmousedown=${(event: MouseEvent) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void this.loadMore(state.category, state.query)
                    }}
                >Load more</button>
            ` as HTMLButtonElement
            rows.push(loadMore)
        }
        this.list.replaceChildren(...rows)
        this.updateSelection(selectedIndex)
    }

    private renderRow(item: PromptReferenceCatalogItem, itemKey: string): HTMLButtonElement {
        const media = item.referenceType === 'media'
        const label = media ? item.title : item.name
        const summary = media
            ? `${item.source === 'canvas' ? 'Canvas placement' : 'Library Asset'} · ${item.scope}`
            : item.summary
        const badge = item.referenceType === 'media'
            ? item.mediaKind
            : item.referenceType === 'capability-module' ? 'Capability' : item.referenceType
        const thumbnail = media && item.thumbnailAvailable
            ? html`
                <img
                    className="prompt-reference-picker-thumbnail"
                    alt=""
                />
            `
            : html`<span className=${`prompt-reference-picker-glyph prompt-reference-picker-glyph-${item.referenceType}`}>${badge.slice(0, 1)}</span>`
        if (thumbnail instanceof HTMLImageElement) {
            const rendition = item.referenceType === 'media' && item.mediaKind === 'video'
                ? 'representativeFrame'
                : 'thumbnail'
            void resolveAuthenticatedMediaUrl(
                `/api/assets/${encodeURIComponent(item.referenceId)}/renditions/${rendition}`,
                {
                    apiBaseUrl: import.meta.env.VITE_API_URL || '',
                    getAuthToken: () => AuthService.getTokenSilently(),
                },
            ).then((url) => {
                if (url) thumbnail.src = url
            }).catch(() => undefined)
        }
        return html`
            <button
                type="button"
                className="prompt-reference-picker-item"
                role="option"
                aria-selected="false"
                title=${`${label} — ${summary}`}
                onmousedown=${(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (this.loading) return
                    const currentItem = this.results.find(result => getCatalogItemKey(result) === itemKey)
                    if (currentItem) this.insert(currentItem)
                }}
                onmousemove=${() => {
                    if (this.loading) return
                    const current = this.key.getState(this.view.state)
                    const index = this.results.findIndex(result => getCatalogItemKey(result) === itemKey)
                    if (current?.active && current.selectedIndex !== index) {
                        this.view.dispatch(this.view.state.tr.setMeta(this.key, { type: 'select', selectedIndex: index }))
                    }
                }}
            >
                ${thumbnail}
                <span className="prompt-reference-picker-copy">
                    <strong>${label}</strong>
                    <small>${summary}</small>
                </span>
                <span className=${`prompt-reference-picker-badge prompt-reference-picker-badge-${item.referenceType}`}>${badge}</span>
            </button>
        ` as HTMLButtonElement
    }

    private updateSelection(selectedIndex: number): void {
        const rows = this.list.querySelectorAll<HTMLElement>('.prompt-reference-picker-item')
        rows.forEach((row, index) => {
            const selected = index === selectedIndex
            row.classList.toggle('is-selected', selected)
            row.setAttribute('aria-selected', String(selected))
        })
    }

    private insert(item: PromptReferenceCatalogItem): void {
        const state = this.key.getState(this.view.state)
        const nodeType = this.view.state.schema.nodes[PROMPT_REFERENCE_NODE_TYPE]
        if (!state?.active || !nodeType) return
        const atom = nodeType.create(promptReferenceCatalogItemToAtomAttrs(item))
        const tr = this.view.state.tr
            .replaceWith(state.triggerPos, this.view.state.selection.from, atom)
            .insertText(' ')
            .setMeta(this.key, { type: 'close' })
            .scrollIntoView()
        this.view.dispatch(tr)
        this.view.focus()
    }

    private close(): void {
        this.view.dispatch(this.view.state.tr.setMeta(this.key, { type: 'close' }))
    }

    private show(triggerPos: number, forcePosition = false): void {
        this.menu.classList.add('prompt-reference-picker-visible')
        this.menu.style.display = 'flex'
        if (this.menuVisible && this.positionedTriggerPos === triggerPos && !forcePosition) return
        const coords = this.view.coordsAtPos(triggerPos)
        const parent = this.menu.parentElement
        const parentRect = parent?.getBoundingClientRect() ?? { left: 0, top: 0 }
        const scale = getTransformedAncestorScale(parent)
        const positionOptions = this.menuPlacement === null
            ? {}
            : { preferredPlacement: this.menuPlacement }
        const screenPosition = resolveFloatingMenuScreenPosition(
            coords,
            this.menu.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight },
            6 * scale,
            positionOptions,
        )
        const localPosition = screenPointToLocal(parentRect, screenPosition, scale)
        applyStyle(this.menu, {
            display: 'flex',
            left: `${localPosition.left}px`,
            top: `${localPosition.top}px`,
        })
        this.menu.dataset.placement = screenPosition.placement
        this.menuPlacement = screenPosition.placement
        this.menuVisible = true
        this.positionedTriggerPos = triggerPos
    }

    private hide(): void {
        this.cancelPendingSearch()
        this.lastRequestKey = null
        this.results = []
        this.cursor = undefined
        this.loading = false
        this.menuVisible = false
        this.positionedTriggerPos = null
        this.menuPlacement = null
        this.activeCategory = null
        this.menu.removeAttribute('aria-busy')
        this.menu.classList.remove('prompt-reference-picker-visible')
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

function createPromptReferencePickerPlugin(
    catalog: PromptReferenceCatalogClient,
    mode: PromptReferencePickerMode,
): Plugin<PromptReferencePickerState> {
    const key = mode === 'modules' ? capabilityModulePickerPluginKey : promptReferencePickerPluginKey
    const trigger = mode === 'modules' ? '/' : '@'
    let menu: PromptReferencePickerMenu | null = null
    return new Plugin<PromptReferencePickerState>({
        key,
        state: {
            init: () => initialState(mode),
            apply: (tr, state) => reducePromptReferencePickerState(tr, state, key, mode),
        },
        props: {
            handleTextInput(view, from, to, text) {
                if (text !== trigger) return false
                const { $from } = view.state.selection
                if ($from.parent.type.name === 'code_block') return false
                const characterBefore = from > 0 ? view.state.doc.textBetween(from - 1, from, '') : ''
                if ($from.parentOffset !== 0 && !/\s/.test(characterBefore)) return false
                view.dispatch(view.state.tr
                    .insertText(trigger, from, to)
                    .setMeta(key, { type: 'open', triggerPos: from }))
                return true
            },
            handleKeyDown: (_view, event) => menu?.handleKeyDown(event) ?? false,
        },
        view(editorView) {
            menu = new PromptReferencePickerMenu(editorView, catalog, mode, key)
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

export const createAtPromptReferencePickerPlugin = (catalog: PromptReferenceCatalogClient): Plugin =>
    createPromptReferencePickerPlugin(catalog, 'references')

export const createSlashCapabilityModulePickerPlugin = (catalog: PromptReferenceCatalogClient): Plugin =>
    createPromptReferencePickerPlugin(catalog, 'modules')

export function promptReferenceCatalogItemToAtomAttrs(item: PromptReferenceCatalogItem): Record<string, string> {
    if (item.referenceType === 'media') {
        return {
            referenceType: 'media',
            assetId: item.assetId,
            nodeId: item.nodeId ?? '',
            mediaKind: item.mediaKind,
            displayName: item.title,
        }
    }
    if (item.referenceType === 'capability-module') {
        return {
            referenceType: 'capability-module',
            moduleId: item.moduleId,
            displayName: item.name,
        }
    }
    return {
        referenceType: item.referenceType,
        capabilityId: item.capabilityId,
        displayName: item.name,
    }
}

function getCatalogItemKey(item: PromptReferenceCatalogItem): string {
    if (item.referenceType === 'media') return `media:${item.assetId}:${item.nodeId ?? ''}`
    return `${item.referenceType}:${item.referenceId}`
}

function getCatalogItemSignature(item: PromptReferenceCatalogItem): string {
    if (item.referenceType === 'media') {
        return [
            item.title,
            item.source,
            item.scope,
            item.mediaKind,
            String(item.thumbnailAvailable),
            String(item.updatedAt),
        ].join('\n')
    }
    return [item.name, item.summary, item.referenceType].join('\n')
}

function categoryLabel(category: PromptReferenceCategory): string {
    if (category === 'capabilities') return 'Capabilities'
    return category[0]!.toLocaleUpperCase('en-US') + category.slice(1)
}
