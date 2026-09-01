// AI Model Registry client. Vite serves this in development with HMR
// and builds it into public/ for the image. Rendering is one innerHTML pass per
// load plus targeted row updates, with all input handled by delegation on the
// container.

import './styles.scss'

import {
    type Catalog,
    type CatalogGroup,
    type CatalogParam,
    type CatalogProvider,
    type CategoryMeta,
    type Decision,
    type SelectionEntry,
    type SelectionMap,
    type Status,
    type Summary,
} from './types.ts'

const STATE_LABELS: Record<string, string> = {
    exposed: 'Already exposed',
    hidden: 'Sent but hidden',
    absent: 'Never sent',
}

// Mirrors DEFAULT_DECISION_BY_STATE in src/server.ts. A row nobody has touched
// shows what Lixpi does today, so the page opens describing the live system.
const DEFAULT_DECISION_BY_STATE: Record<string, Decision> = {
    exposed: 'expose',
    hidden: 'internal',
    absent: 'skip',
}

// Top-level sections, in the order they are read.
const MEDIA_SECTIONS: Array<{ mediaType: string; title: string }> = [
    { mediaType: 'text', title: 'Reasoning models' },
    { mediaType: 'image', title: 'Image models' },
    { mediaType: 'video', title: 'Video models' },
]

const AVAILABILITY_LABELS: Record<string, string> = {
    supported: 'Supported',
    unsupported: 'Not on our models',
    unverified: 'Verify first',
}

const CHEVRON = '<svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
    + '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const COLLAPSE_STORAGE_KEY = 'ai-model-registry:collapsed'
const SCROLL_STORAGE_KEY = 'ai-model-registry:scroll'

// Trailing build stamps carry no meaning in a pill, so
// dreamina-seedance-2-5-260628 reads the same with or without its final stamp.
// Only a run of three or more digits is dropped, so claude-opus-4-8 and
// gpt-image-2 keeps the digit that is part of the name.
const shortModel = (model: string): string => String(model).replace(/-\d{3,}$/u, '')

const titleFromSlug = (slug: string): string =>
    String(slug)
        .split('-')
        .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join(' ')

const escapeHtml = (value: unknown): string =>
    String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')

// Which selection field each value control writes to. `fixed` is the value sent
// when a parameter is used but not exposed; `default` is where an exposed
// control starts. Only one is visible at a time, decided by the row's decision.
type ValueControl = { role: 'fixed' | 'default'; label: string }

const VALUE_CONTROLS: ValueControl[] = [
    { role: 'fixed', label: 'Value to send' },
    { role: 'default', label: 'Default value' },
]

const VALUE_PATCH_KEY: Record<string, 'fixedValue' | 'defaultValue'> = { fixed: 'fixedValue', default: 'defaultValue' }

// Sign-off on a decision. Mutually exclusive, so ticking one clears the other.
const STATUSES: Array<{ value: Status; label: string }> = [
    { value: 'needs-param-clarification', label: 'Needs param clarification' },
    { value: 'needs-implementation-investigation', label: 'Needs implementation investigation' },
    { value: 'approved', label: 'Approved' },
]

const STATUS_FILTERS = new Set(STATUSES.map(({ value }) => value))

// The control shape follows what the provider accepts: a picker when there is a
// published value list or a boolean, a free-text field otherwise.
const chipOptionsFor = (parameter: CatalogParam): string[] | null =>
    parameter.values?.length
        ? parameter.values
        : parameter.type === 'boolean'
        ? ['true', 'false']
        : null

const renderValueControl = (id: string, parameter: CatalogParam, { role, label }: ValueControl, value: string): string => {
    // A parameter with a value list is picked straight from its chips, so it
    // needs no control here at all.
    if (chipOptionsFor(parameter)) return ''

    return `<div class="value-control" data-for="${role}">
                <span class="value-label">${escapeHtml(label)}</span>
                <input type="text" data-role="${role}" data-id="${escapeHtml(id)}" value="${escapeHtml(value)}" />
            </div>`
}

type StatusReporter = (state: string, summary?: Summary | null, message?: string) => void

class SelectionsClient {
    #pending: SelectionMap | null = null
    #timer: ReturnType<typeof setTimeout> | undefined
    #onStatus: StatusReporter

    constructor(onStatus: StatusReporter) {
        this.#onStatus = onStatus
    }

    async load(): Promise<{ catalog: Catalog; selections: SelectionMap; path: string }> {
        const [catalogRes, selectionsRes] = await Promise.all([
            fetch('/api/catalog'),
            fetch('/api/selections'),
        ])
        if (!catalogRes.ok || !selectionsRes.ok) throw new Error('Failed to load catalog or selections')
        const catalog = await catalogRes.json()
        const { selections, path } = await selectionsRes.json()
        return { catalog, selections, path }
    }

    // Saves are debounced so dragging through a column of checkboxes produces one
    // write, not twenty. The latest map always wins.
    queue(selections: SelectionMap): void {
        this.#pending = selections
        this.#onStatus('saving')
        clearTimeout(this.#timer)
        this.#timer = setTimeout(() => void this.#flush(), 350)
    }

    async #flush(): Promise<void> {
        const payload = this.#pending
        this.#pending = null
        try {
            const res = await fetch('/api/selections', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ selections: payload }),
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const { summary } = await res.json()
            this.#onStatus('saved', summary)
        } catch (error) {
            this.#onStatus('error', null, error.message)
        }
    }
}

class ParamPicker {
    #catalog!: Catalog
    #categories: Record<string, CategoryMeta> = {}
    #selections: SelectionMap = {}
    #filter = 'all'
    #modelFilter = 'all'
    #query = ''
    #client
    #collapsed = new Set<string>()

    readonly root: HTMLElement
    saveState!: HTMLElement
    tally!: HTMLElement

    constructor(root: HTMLElement) {
        this.root = root
        this.saveState = document.getElementById('save-state')
        this.tally = document.getElementById('tally')
        // Collapse state is a per-browser convenience, so it lives in
        // localStorage rather than in the selections file.
        try {
            this.#collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) ?? '[]'))
        } catch {
            this.#collapsed = new Set()
        }
        this.#client = new SelectionsClient((state, summary, message) => this.#renderStatus(state, summary, message))
    }

    async init(): Promise<void> {
        const { catalog, selections } = await this.#client.load()
        this.#catalog = catalog
        this.#categories = catalog.categories ?? {}
        this.#selections = selections
        this.#render()
        this.#renderStatus('idle')
        this.#renderTally()
        this.#bind()
        this.#populateModelFilter()
        this.#trackToolbarHeight()
        this.#measureHeaderHeights()
        // Run the filter once on load so each group header shows its row count
        // instead of an empty span until the first filter click.
        this.#applyFilter()
        this.#restoreScroll()
    }

    // A row with no stored decision starts at whatever Lixpi does today, so the
    // page opens describing the live system rather than a blank slate.
    #entry(id: string, currentState: string): SelectionEntry {
        return this.#selections[id] ?? {
            decision: DEFAULT_DECISION_BY_STATE[currentState] ?? 'skip',
            reviewed: false,
            fixedValue: '',
            defaultValue: '',
            status: 'none',
            irrelevant: false,
            note: '',
        }
    }

    // Every edit marks the row reviewed: that is what separates a seeded value
    // from a call somebody actually made.
    #set(id: string, currentState: string, patch: Partial<SelectionEntry>): void {
        this.#selections[id] = { ...this.#entry(id, currentState), reviewed: true, ...patch }
        this.#client.queue(this.#selections)
        this.#renderTally()
    }

    // Flagging a row for research is the opposite of having decided it, so this
    // is the one edit that leaves `reviewed` alone.
    #setFlag(id: string, currentState: string, patch: Partial<SelectionEntry>): void {
        this.#selections[id] = { ...this.#entry(id, currentState), ...patch }
        this.#client.queue(this.#selections)
        this.#renderTally()
    }

    // Section headers stick below the toolbar, whose height changes when the
    // filter chips wrap, so it is measured instead of hardcoded.
    #trackToolbarHeight(): void {
        const toolbar = document.querySelector('.toolbar')
        if (!toolbar) return
        const apply = () => {
            document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`)
            // Header offsets hang off the toolbar's lower edge, so they are
            // recomputed whenever that edge moves.
            this.#measureHeaderHeights()
        }
        apply()
        new ResizeObserver(apply).observe(toolbar)
    }

    // Each sticky level parks under the one above, so its offset is the sum of
    // the heights above it. Those are measured rather than assumed: a hardcoded
    // offset leaves a band of scrolled content showing between two headers.
    #measureHeaderHeights(): void {
        for (
            const [selector, property, fallback] of [
                ['.section-head', '--section-h', 32],
                ['.group-head', '--group-h', 52],
            ]
        ) {
            const head = this.root.querySelector(selector)
            document.documentElement.style.setProperty(property, `${head?.offsetHeight ?? fallback}px`)
        }
    }

    // The model list is whatever the tree declares, so a new model appears in
    // the filter as soon as a parameter names it.
    #populateModelFilter(): void {
        const models = new Set()
        for (const provider of this.#catalog.providers) {
            for (const group of provider.groups) {
                for (const model of group.supportedModels ?? []) models.add(model)
            }
        }
        const select = document.getElementById('model-filter')
        select.innerHTML = `<option value="all">All models</option>${[...models].sort().map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(shortModel(m))}</option>`).join('')}`
    }

    // Reloading in the middle of a long list should not throw away your place.
    // Restored after the first render and filter pass, when the page is finally
    // tall enough for the offset to mean anything.
    #restoreScroll(): void {
        let saved = 0
        try {
            saved = Number(sessionStorage.getItem(SCROLL_STORAGE_KEY)) || 0
        } catch {
            return
        }
        if (saved > 0) requestAnimationFrame(() => window.scrollTo(0, saved))

        let pending = null
        window.addEventListener('scroll', () => {
            if (pending !== null) return
            // One write per frame at most, so scrolling stays cheap.
            pending = requestAnimationFrame(() => {
                pending = null
                try {
                    sessionStorage.setItem(SCROLL_STORAGE_KEY, String(Math.round(window.scrollY)))
                } catch {
                    // Storage disabled. Scrolling still works, it just forgets.
                }
            })
        }, { passive: true })
    }

    #bind(): void {
        this.root.addEventListener('change', (event) => {
            const target = event.target
            const id = target.dataset.id
            if (!id) return
            const currentState = target.closest('[data-row]').dataset.currentState

            if (target.dataset.role === 'use') {
                // Unticking Use collapses the row back to skip, which also clears
                // any "expose" that was set on it. Ticking it clears Hide, whose
                // checkbox only exists while Use is off.
                const cleared = !target.checked && this.#entry(id, currentState).status === 'approved'
                this.#set(id, currentState, {
                    decision: target.checked ? 'internal' : 'skip',
                    ...(target.checked ? { irrelevant: false } : {}),
                    ...(cleared ? { status: 'none' } : {}),
                })
                this.#syncRow(id)
                return
            }

            if (target.dataset.role === 'expose') {
                this.#set(id, currentState, { decision: target.checked ? 'expose' : 'internal' })
                this.#syncRow(id)
                return
            }

            if (target.dataset.role === 'irrelevant') {
                // Out of scope is not a decision, so like the sign-off flags this
                // leaves `reviewed` alone.
                this.#setFlag(id, currentState, { irrelevant: target.checked })
                const row = target.closest('[data-row]')
                row.dataset.irrelevant = String(target.checked)
                row.querySelector('[data-role="use"]').disabled = target.checked
                return
            }

            if (target.dataset.role === 'status') {
                // Unticking returns the row to `none`; ticking one clears the other,
                // because the two are mutually exclusive.
                const status = target.checked ? target.dataset.status : 'none'
                this.#setFlag(id, currentState, { status })
                const row = target.closest('[data-row]')
                row.dataset.status = status
                for (const box of row.querySelectorAll('[data-role="status"]')) {
                    box.checked = box.dataset.status === status
                }
                this.#applyFilter()
                return
            }

            const patchKey = VALUE_PATCH_KEY[target.dataset.role]
            if (patchKey) {
                this.#set(id, currentState, { [patchKey]: target.value })
                this.#syncChips(target.closest('[data-row]'), id)
            }
        })

        this.root.addEventListener('input', (event) => {
            const target = event.target
            const role = target.dataset.role
            const patchKey = role === 'note' ? 'note' : VALUE_PATCH_KEY[role]
            if (!patchKey) return
            const row = target.closest('[data-row]')
            this.#set(target.dataset.id, row.dataset.currentState, { [patchKey]: target.value })
            if (patchKey !== 'note') this.#syncChips(row, target.dataset.id)
        })

        this.root.addEventListener('click', (event) => {
            const chip = event.target.closest('[data-role="chip"]')
            if (chip) {
                const row = chip.closest('[data-row]')
                const id = row.dataset.row
                const { decision } = this.#entry(id, row.dataset.currentState)
                if (decision === 'skip') return
                const patchKey = decision === 'expose' ? 'defaultValue' : 'fixedValue'
                const current = this.#activeValue(id, row.dataset.currentState)
                this.#set(id, row.dataset.currentState, {
                    [patchKey]: chip.dataset.value === current ? '' : chip.dataset.value,
                })
                this.#syncChips(row, id)
                return
            }

            const header = event.target.closest('[data-toggle-key]')
            if (!header) return
            const key = header.dataset.toggleKey
            const host = header.parentElement
            const collapsed = host.dataset.collapsed !== 'true'
            host.dataset.collapsed = String(collapsed)
            if (collapsed) this.#collapsed.add(key)
            else this.#collapsed.delete(key)
            try {
                localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...this.#collapsed]))
            } catch {
                // A browser with storage disabled still collapses, it just forgets.
            }
        })

        document.getElementById('search').addEventListener('input', (event) => {
            this.#query = event.target.value.trim().toLowerCase()
            this.#applyFilter()
        })

        document.getElementById('state-filter').addEventListener('change', (event) => {
            this.#filter = event.target.value
            this.#applyFilter()
        })

        document.getElementById('model-filter').addEventListener('change', (event) => {
            this.#modelFilter = event.target.value
            this.#applyFilter()
        })
    }

    #activeValue(id: string, currentState: string): string {
        const entry = this.#entry(id, currentState)
        if (entry.decision === 'expose') return entry.defaultValue
        if (entry.decision === 'internal') return entry.fixedValue
        return ''
    }

    #syncChips(row: HTMLElement, id: string): void {
        const chosen = this.#activeValue(id, row.dataset.currentState)
        for (const chip of row.querySelectorAll('.values code[data-value]')) {
            chip.classList.toggle('is-selected', chosen !== '' && chip.dataset.value === chosen)
        }
    }

    #syncRow(id: string): void {
        const row = this.root.querySelector(`[data-row="${CSS.escape(id)}"]`)
        if (!row) return
        const { decision, reviewed, irrelevant, status } = this.#entry(id, row.dataset.currentState)
        row.dataset.decision = decision
        row.dataset.status = status
        row.dataset.reviewed = String(reviewed)
        row.dataset.irrelevant = String(irrelevant)
        row.querySelector('[data-role="irrelevant"]').checked = irrelevant
        const use = row.querySelector('[data-role="use"]')
        use.checked = decision === 'internal' || decision === 'expose'
        use.disabled = irrelevant
        for (const box of row.querySelectorAll('[data-role="status"]')) {
            box.checked = box.dataset.status === status
            if (box.dataset.status === 'approved') box.disabled = decision === 'skip'
        }
        const expose = row.querySelector('[data-role="expose"]')
        expose.checked = decision === 'expose'
        expose.disabled = decision !== 'internal' && decision !== 'expose'
        this.#syncChips(row, id)
        this.#applyFilter()
    }

    #renderStatus(state: string, summary?: Summary | null, message?: string): void {
        const text = {
            idle: 'Ready',
            saving: 'Saving',
            saved: 'Saved',
            error: `Save failed: ${message ?? ''}`,
        }[state]
        this.saveState.dataset.state = state
        this.saveState.textContent = text
        if (summary) this.#renderTally(summary)
    }

    #renderTally(summary?: Summary): void {
        const counts = summary ?? { total: 0, expose: 0, internal: 0, skip: 0, reviewed: 0, unreviewed: 0, approved: 0, needsParamClarification: 0, needsImplementationInvestigation: 0 }

        if (!summary) {
            for (const provider of this.#catalog?.providers ?? []) {
                for (const group of provider.groups) {
                    for (const parameter of group.parameters) {
                        const entry = this.#entry(`${provider.id}/${group.id}/${parameter.key}`, parameter.currentState)
                        counts.total += 1
                        counts[entry.decision] += 1
                        counts[entry.reviewed ? 'reviewed' : 'unreviewed'] += 1
                        if (entry.status === 'approved') counts.approved += 1
                        if (entry.status === 'needs-param-clarification') counts.needsParamClarification += 1
                        if (entry.status === 'needs-implementation-investigation') counts.needsImplementationInvestigation += 1
                    }
                }
            }
        }

        this.tally.innerHTML = `
            <span class="tally-item" data-kind="expose"><b>${counts.expose}</b> in UI</span>
            <span class="tally-item" data-kind="internal"><b>${counts.internal}</b> internal</span>
            <span class="tally-item" data-kind="skip"><b>${counts.skip}</b> skipped</span>
            <span class="tally-item" data-kind="unreviewed"><b>${counts.unreviewed}</b> unreviewed</span>
            <span class="tally-item" data-kind="approved"><b>${counts.approved}</b> approved</span>
            <span class="tally-item" data-kind="needs-param-clarification"><b>${counts.needsParamClarification}</b> param</span>
            <span class="tally-item" data-kind="needs-implementation-investigation"><b>${counts.needsImplementationInvestigation}</b> impl</span>
        `
    }

    #applyFilter(): void {
        for (const row of this.root.querySelectorAll('[data-row]')) {
            const matchesState = this.#filter === 'all'
                || (this.#filter === 'unreviewed'
                    ? row.dataset.reviewed === 'false'
                    : STATUS_FILTERS.has(this.#filter)
                    ? row.dataset.status === this.#filter
                    : row.dataset.currentState === this.#filter)
            const matchesQuery = this.#query === '' || row.dataset.haystack.includes(this.#query)
            const matchesModel = this.#modelFilter === 'all'
                || (row.dataset.models ?? '').split('\u0001').includes(this.#modelFilter)
            row.hidden = !(matchesState && matchesQuery && matchesModel)
        }
        for (const category of this.root.querySelectorAll('.category')) {
            const visible = category.querySelectorAll('[data-row]:not([hidden])').length
            category.hidden = visible === 0
            category.querySelector('.category-count').textContent = String(visible)
        }
        for (const group of this.root.querySelectorAll('.group')) {
            const visible = group.querySelectorAll('[data-row]:not([hidden])').length
            group.hidden = visible === 0
            group.querySelector('.group-count').textContent = `${visible} shown`
        }
        for (const section of this.root.querySelectorAll('.section')) {
            section.hidden = section.querySelectorAll('.group:not([hidden])').length === 0
        }
    }

    // The page is organised by what the model produces, not by who sells it, so
    // reviewing all the image knobs means reading one section instead of hopping
    // between four providers. Provider stays on each group header.
    #render(): void {
        this.root.innerHTML = MEDIA_SECTIONS.map(({ mediaType, title }) => {
            const groups = this.#catalog.providers.flatMap((provider) =>
                provider.groups
                    .filter((group) => group.mediaType === mediaType)
                    .map((group) => this.#renderGroup(provider, group))
            )
            if (groups.length === 0) return ''
            return `
                <section class="section" data-collapsed="${this.#collapsed.has(mediaType)}">
                    <h2 class="section-head" data-toggle-key="${escapeHtml(mediaType)}">
                        ${CHEVRON}${escapeHtml(title)}
                    </h2>
                    <div class="section-body">${groups.join('')}</div>
                </section>
            `
        }).join('')
    }

    #renderGroup(provider: CatalogProvider, group: CatalogGroup): string {
        const key = `${provider.id}/${group.id}`
        return `
            <section class="group" data-collapsed="${this.#collapsed.has(key)}">
                <header class="group-head" data-toggle-key="${escapeHtml(key)}">
                    ${CHEVRON}
                    <div>
                        <h3>
                            <span class="provider-name">${escapeHtml(provider.title)}</span>
                            ${escapeHtml(group.title)}
                        </h3>
                        <p class="models">${escapeHtml(provider.apiName)} &middot; ${escapeHtml(group.models.join(', '))}</p>
                    </div>
                    <span class="group-count"></span>
                </header>
                <div class="group-body">
                    ${this.#renderCategories(provider, group)}
                </div>
            </section>
        `
    }

    // Parameters are grouped by what they do, so a provider's list reads as a
    // handful of named concerns rather than one long alphabetical run.
    #renderCategories(provider: CatalogProvider, group: CatalogGroup): string {
        const buckets = new Map()
        for (const parameter of group.parameters) {
            const category = parameter.category ?? 'uncategorised'
            if (!buckets.has(category)) buckets.set(category, [])
            buckets.get(category).push(parameter)
        }

        const ordered = [...buckets.keys()].sort((a, b) => {
            const orderA = this.#categories[a]?.order ?? Number.MAX_SAFE_INTEGER
            const orderB = this.#categories[b]?.order ?? Number.MAX_SAFE_INTEGER
            return orderA - orderB || a.localeCompare(b)
        })

        return ordered.map((category) => {
            const key = `${provider.id}/${group.id}/${category}`
            return `
            <section class="category" data-category="${escapeHtml(category)}" data-collapsed="${this.#collapsed.has(key)}">
                <h4 class="category-head" data-toggle-key="${escapeHtml(key)}">
                    ${CHEVRON}
                    ${escapeHtml(this.#categories[category]?.title ?? titleFromSlug(category))}
                    <span class="category-count"></span>
                </h4>
                <div class="rows">
                    ${buckets.get(category)!.map((parameter) => this.#renderRow(provider, group, parameter)).join('')}
                </div>
            </section>
        `
        }).join('')
    }

    #renderRow(provider: CatalogProvider, group: CatalogGroup, parameter: CatalogParam): string {
        const id = `${provider.id}/${group.id}/${parameter.key}`
        const { decision, reviewed, fixedValue, defaultValue, status, irrelevant, note } = this.#entry(id, parameter.currentState)
        const valueByRole = { fixed: fixedValue, default: defaultValue }
        const used = decision === 'internal' || decision === 'expose'
        const haystack = [
            parameter.key,
            parameter.apiField,
            parameter.summary,
            parameter.values?.join(' ') ?? '',
            parameter.combines.join(' '),
        ].join(' ').toLowerCase()

        const chosenValue = decision === 'expose' ? defaultValue : decision === 'internal' ? fixedValue : ''
        const providerDefault = parameter.providerDefault ?? ''
        const chipOptions = chipOptionsFor(parameter)
        const values = chipOptions
            ? `<div class="values is-pickable">
                   ${
                chipOptions.map((v) => {
                    const classes = [
                        v === providerDefault ? 'is-provider-default' : '',
                        v !== '' && v === chosenValue ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')
                    return `<code data-role="chip" data-value="${escapeHtml(v)}"${classes ? ` class="${classes}"` : ''}>${escapeHtml(v)}</code>`
                }).join('')
            }
               </div>`
            : parameter.range
            ? `<div class="values"><code>${escapeHtml(parameter.range)}</code></div>`
            : ''

        const combines = parameter.combines.length
            ? `<ul class="combines">${parameter.combines.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
            : ''

        const pills = (items, kind) => items.map((item) => `<span class="pill" data-kind="${kind}">${escapeHtml(shortModel(item))}</span>`).join('')
        const compatRow = (label, supported, unsupported) =>
            (supported.length || unsupported.length)
                ? `<div class="compat-row"><span class="compat-label">${label}</span>
                   <div class="pills">${pills(supported, 'yes')}${pills(unsupported, 'no')}</div></div>`
                : ''
        // Hostname alone is useless when a parameter cites two pages on the same
        // site, so the last path segment comes along to tell them apart.
        const sourceLabel = (url) => {
            try {
                const { hostname, pathname } = new URL(url)
                const last = pathname.split('/').filter(Boolean).at(-1)
                return last ? `${hostname.replace(/^www\./u, '')}/${last}` : hostname.replace(/^www\./u, '')
            } catch {
                return url
            }
        }
        const sources = (parameter.sources ?? []).length
            ? `<div class="compat-row"><span class="compat-label">Source</span>
                   <span class="source-links">${parameter.sources.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel(url))}</a>`).join(', ')}</span></div>`
            : ''

        const compatibility = `<div class="compat">
                ${compatRow('Models', parameter.supportedModels ?? [], parameter.unsupportedModels ?? [])}
                ${compatRow('APIs', parameter.supportedApis ?? [], parameter.unsupportedApis ?? [])}
                ${sources}
            </div>`

        // Only parameters Lixpi already sends have a call site to point at.
        const usage = parameter.usage
            ? `<div class="usage">
                   <div class="usage-head">Used in this repo</div>
                   <p class="usage-what">${escapeHtml(parameter.usage.what)}</p>
                   <dl class="facts">
                       <dt>Set in</dt><dd><code>${escapeHtml(parameter.usage.setIn)}</code></dd>
                       <dt>Value from</dt><dd>${escapeHtml(parameter.usage.from)}</dd>
                   </dl>
                   <pre class="usage-code"><code>${escapeHtml(parameter.usage.code)}</code></pre>
               </div>`
            : ''

        return `
            <article class="row" data-row="${escapeHtml(id)}" data-decision="${decision}" data-reviewed="${reviewed}"
                data-current-state="${escapeHtml(parameter.currentState)}" data-status="${status}"
                data-models="${escapeHtml((parameter.supportedModels ?? []).join('\u0001'))}"
                data-provider-default="${escapeHtml(parameter.providerDefault ?? '')}"
                data-irrelevant="${irrelevant}" data-haystack="${escapeHtml(haystack)}">
                <div class="row-title">
                    <code class="param-name">${escapeHtml(parameter.apiField)}</code>
                    <span class="badge" data-state="${escapeHtml(parameter.currentState)}">${escapeHtml(STATE_LABELS[parameter.currentState])}</span>
                    <span class="badge" data-availability="${escapeHtml(parameter.availability)}">${escapeHtml(AVAILABILITY_LABELS[parameter.availability])}</span>
                    ${parameter.controlKey ? `<span class="badge" data-control>control key: ${escapeHtml(parameter.controlKey)}</span>` : ''}
                    <div class="row-choices">
                        <label class="check">
                            <input type="checkbox" data-role="use" data-id="${escapeHtml(id)}"
                                ${used ? 'checked' : ''} ${irrelevant ? 'disabled' : ''} />
                            <span>Use</span>
                        </label>
                        <label class="check">
                            <input type="checkbox" data-role="expose" data-id="${escapeHtml(id)}"
                                ${decision === 'expose' ? 'checked' : ''} ${used ? '' : 'disabled'} />
                            <span>Show in UI</span>
                        </label>
                    </div>
                    <label class="check row-flag">
                        <input type="checkbox" data-role="irrelevant" data-id="${escapeHtml(id)}" ${irrelevant ? 'checked' : ''} />
                        <span>Hide</span>
                    </label>
                </div>
                <p class="summary">${escapeHtml(parameter.summary)}</p>
                ${values}
                <dl class="facts">
                    <dt>Provider default</dt><dd>${escapeHtml(parameter.providerDefault ?? 'none')}</dd>
                    <dt>Lixpi sends</dt><dd>${escapeHtml(parameter.lixpiValue ?? 'nothing')}</dd>
                </dl>
                ${combines}
                ${compatibility}
                ${usage}
                ${VALUE_CONTROLS.map((control) => renderValueControl(id, parameter, control, valueByRole[control.role])).join('')}
                <input class="note" type="text" data-role="note" data-id="${escapeHtml(id)}"
                    value="${escapeHtml(note)}" />
                <div class="row-footer">
                    ${
            STATUSES.map(({ value, label }) => `
                        <label class="check">
                            <input type="checkbox" data-role="status" data-status="${value}" data-id="${escapeHtml(id)}"
                                ${status === value ? 'checked' : ''}
                                ${value === 'approved' && decision === 'skip' ? 'disabled' : ''} />
                            <span>${escapeHtml(label)}</span>
                        </label>
                    `).join('')
        }
                </div>
            </article>
        `
    }
}

const picker = new ParamPicker(document.getElementById('providers') as HTMLElement)
try {
    await picker.init()
} catch (error) {
    document.getElementById('providers')!.innerHTML = `<p class="fatal">Could not start: ${escapeHtml(error.message)}</p>`
}
