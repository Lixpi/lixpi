import type { CapabilityPromptReference } from '@lixpi/constants'

import {
    type CapabilityCatalogClient,
    type CapabilityCatalogItem,
    type CapabilityCatalogPage,
    type CapabilityDetails,
} from '$src/services/capability-catalog-client.ts'
import { html } from '$src/utils/domTemplates.ts'

export type CapabilityLibraryPanelConfig = {
    client: CapabilityCatalogClient
    onAttach?: (reference: CapabilityPromptReference & { displayName: string }) => void
}

export type CapabilityLibraryPanelInstance = {
    readonly element: HTMLElement
    load: () => Promise<void>
    refresh: () => Promise<void>
    destroy: () => void
}

export function mergeCapabilityCatalogPage(
    currentItems: CapabilityCatalogItem[],
    page: CapabilityCatalogPage,
    append: boolean,
): CapabilityCatalogItem[] {
    const byId = new Map<string, CapabilityCatalogItem>()
    if (append) {
        currentItems
            .filter((item) => item.kind === 'tool')
            .forEach((item) => byId.set(item.capabilityId, item))
    }
    page.items
        .filter((item) => item.kind === 'tool')
        .forEach((item) => byId.set(item.capabilityId, item))
    return [...byId.values()]
}

class CapabilityLibraryPanel implements CapabilityLibraryPanelInstance {
    readonly element: HTMLElement
    private readonly browserElement: HTMLElement
    private readonly inspectorElement: HTMLElement
    private items: CapabilityCatalogItem[] = []
    private selected: CapabilityDetails | null = null
    private loadSequence = 0
    private detailsSequence = 0

    constructor(private readonly config: CapabilityLibraryPanelConfig) {
        this.element = html`<div className="media-library-panel capability-library-panel nopan nowheel">
            <div className="media-library-controls"></div>
            <div className="media-library-body">
                <section className="media-library-browser"></section>
                <aside className="media-library-inspector"></aside>
            </div>
        </div>` as HTMLElement
        this.browserElement = this.element.querySelector('.media-library-browser') as HTMLElement
        this.inspectorElement = this.element.querySelector('.media-library-inspector') as HTMLElement
        this.render()
    }

    async load(): Promise<void> {
        const loadSequence = ++this.loadSequence
        this.browserElement.replaceChildren(html`<div className="media-library-state">Loading Capabilities</div>`)
        try {
            let items: CapabilityCatalogItem[] = []
            let cursor: string | undefined
            do {
                const page = await this.config.client.list({ cursor, kind: 'tool' })
                if (loadSequence !== this.loadSequence) return
                items = mergeCapabilityCatalogPage(items, page, Boolean(cursor))
                cursor = page.cursor
            } while (cursor)
            this.items = items
            this.render()
        } catch {
            if (loadSequence !== this.loadSequence) return
            this.browserElement.replaceChildren(html`<div className="media-library-state media-library-state-error">Could not load Capabilities.</div>`)
        }
    }

    async refresh(): Promise<void> {
        this.config.client.invalidate()
        this.items = []
        this.selected = null
        await this.load()
    }

    destroy(): void {
        this.loadSequence += 1
        this.detailsSequence += 1
        this.element.remove()
    }

    private render(): void {
        this.element.classList.toggle('media-library-panel-item-selected', this.selected !== null)
        this.browserElement.replaceChildren(html`<div className="media-library-browser-intro">
            <h2>Capabilities</h2>
            <p>Reusable capabilities available to your prompts.</p>
        </div>`)
        this.inspectorElement.replaceChildren()

        if (this.items.length === 0) {
            this.browserElement.appendChild(html`<div className="media-library-state">No Tools found.</div>`)
        } else {
            const itemsElement = html`<div className="capability-library-section-items"></div>` as HTMLElement
            for (const item of this.items) itemsElement.appendChild(this.buildRow(item))
            this.browserElement.appendChild(itemsElement)
        }

        if (this.selected) this.inspectorElement.appendChild(this.buildInspector(this.selected))
        else this.inspectorElement.appendChild(html`<div className="capability-library-inspector-empty">
            <strong>Select a Tool</strong>
            <span>Details and prompt controls appear here.</span>
        </div>`)
    }

    private buildRow(item: CapabilityCatalogItem): HTMLElement {
        const row = html`<article
            className=${`capability-library-row${this.selected?.capabilityId === item.capabilityId ? ' capability-library-row-selected' : ''}`}
            data=${{ capabilityId: item.capabilityId }}
            tabindex="0"
            data-side-panel-no-drag="true"
        >
            <div className="capability-library-row-thumb-placeholder" aria-hidden="true"></div>
            <div className="capability-library-row-info">
                <div className="capability-library-row-meta">
                    <span className="capability-library-row-category">Tool</span>
                    <span className="capability-library-row-scope">${item.scope}</span>
                </div>
                <div className="capability-library-row-name">${item.name}</div>
                <div className="capability-library-row-summary">${item.summary}</div>
            </div>
            <button type="button" className="capability-library-row-action capability-library-row-action-primary" data-action="attach" data-side-panel-no-drag="true">Use</button>
        </article>` as HTMLElement
        const select = (): void => { void this.select(item.capabilityId) }
        row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            select()
        })
        row.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('[data-action="attach"]')) {
                this.attach(item)
                return
            }
            select()
        })
        return row
    }

    private async select(capabilityId: string): Promise<void> {
        const detailsSequence = ++this.detailsSequence
        this.inspectorElement.replaceChildren(html`<div className="media-library-state">Loading Capability…</div>`)
        try {
            const details = await this.config.client.get(capabilityId)
            if (detailsSequence !== this.detailsSequence) return
            this.selected = details
            this.render()
        } catch {
            if (detailsSequence !== this.detailsSequence) return
            this.inspectorElement.replaceChildren(html`<div className="media-library-state media-library-state-error">Could not load Capability details.</div>`)
        }
    }

    private buildInspector(details: CapabilityDetails): HTMLElement {
        const inspector = html`<section className="capability-library-inspector-card" data-side-panel-no-drag="true">
            <button type="button" className="capability-library-row-action capability-library-back">Back</button>
            <div className="capability-library-row-meta">
                <span className="capability-library-row-category">Tool</span>
                <span className="capability-library-row-scope">${details.scope}</span>
            </div>
            <h2>${details.name}</h2>
            <p className="capability-library-row-detail-summary">${details.summary}</p>
            <button type="button" className="capability-library-row-action capability-library-row-action-primary capability-library-attach">Add to prompt</button>
        </section>` as HTMLElement
        inspector.querySelector('.capability-library-back')?.addEventListener('click', () => {
            this.selected = null
            this.render()
        })
        inspector.querySelector('.capability-library-attach')?.addEventListener('click', () => this.attach(details))
        return inspector
    }

    private attach(item: Pick<CapabilityCatalogItem, 'capabilityId' | 'kind' | 'name'>): void {
        this.config.onAttach?.({
            capabilityId: item.capabilityId,
            kind: item.kind,
            displayName: item.name,
        })
    }
}

export function createCapabilityLibraryPanel(config: CapabilityLibraryPanelConfig): CapabilityLibraryPanelInstance {
    return new CapabilityLibraryPanel(config)
}
