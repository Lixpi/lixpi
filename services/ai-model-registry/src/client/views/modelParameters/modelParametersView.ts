// The parameter registry page. It owns the toolbar the picker reads its filters
// from and the container the picker renders into; the picker itself is unchanged
// and still owns every row, selection, and save.

import { html } from '@lixpi/ui-primitives/dom'

import { ParamPicker } from '$src/views/modelParameters/paramPicker.ts'

export type ModelParametersViewInstance = {
    el: HTMLElement
    // Called once the element is in the document. The picker looks its toolbar
    // up by id, so starting it any earlier finds nothing.
    mount: () => void
    destroy: () => void
}

const escapeHtml = (value: unknown): string =>
    String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')

class ModelParametersView implements ModelParametersViewInstance {
    readonly el: HTMLElement

    private readonly providersEl: HTMLElement
    private picker: ParamPicker | null = null

    constructor() {
        this.providersEl = html`
            <main
                id="providers"
                className="providers"
            ></main>
        ` as HTMLElement

        this.el = html`
            <div className="model-parameters-page">
                ${this.renderToolbar()}
                ${this.providersEl}
            </div>
        ` as HTMLElement
    }

    mount(): void {
        void this.start()
    }

    // The ids are the picker's contract: it reads the search box, both filters,
    // the tally, and the save indicator by id.
    private renderToolbar(): HTMLElement {
        return html`
            <nav className="toolbar">
                <input
                    id="search"
                    type="search"
                    autocomplete="off"
                    aria-label="Search parameters"
                />
                <select
                    id="state-filter"
                    aria-label="Filter by state"
                >
                    <option value="all">All</option>
                    <option value="exposed">Already exposed</option>
                    <option value="hidden">Sent but hidden</option>
                    <option value="absent">Never sent</option>
                    <option value="unreviewed">Unreviewed</option>
                    <option value="approved">Approved</option>
                    <option value="needs-param-clarification">Param clarification</option>
                    <option value="needs-implementation-investigation">Impl. investigation</option>
                </select>
                <select
                    id="model-filter"
                    aria-label="Filter by model"
                >
                    <option value="all">All models</option>
                </select>
                <div
                    className="tally"
                    id="tally"
                ></div>
                <div
                    id="save-state"
                    className="save-state"
                    data-state="idle"
                >Loading</div>
            </nav>
        ` as HTMLElement
    }

    private async start(): Promise<void> {
        const picker = new ParamPicker(this.providersEl)
        this.picker = picker

        try {
            await picker.init()
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            this.providersEl.innerHTML = `<p class="fatal">Could not start: ${escapeHtml(message)}</p>`
        }
    }

    destroy(): void {
        this.picker?.destroy()
        this.picker = null
        this.el.remove()
    }
}

export const createModelParametersView = (): ModelParametersViewInstance => new ModelParametersView()
