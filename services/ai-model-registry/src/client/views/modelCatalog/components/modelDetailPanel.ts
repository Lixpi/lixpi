// The panel for one model: how it resolved, where the sources disagree with the
// authored file, and the two ways to change it. Editing writes the authored
// half through the server API, which validates the change and keeps the previous
// version; nothing here touches a catalog file directly.

import { html } from '@lixpi/ui-primitives/dom'

import { closeIcon } from '$src/views/layouts/icons.ts'
import {
    createJsonViewer,
    type JsonViewerInstance,
} from '$src/views/modelCatalog/components/jsonViewer.ts'
import {
    formatNumber,
    modelTitle,
    STATUS_LABELS,
    STATUS_TONES,
} from '$src/views/modelCatalog/modelFormatting.ts'
import {
    type CatalogModel,
    type DriftFinding,
} from '$src/views/modelCatalog/types.ts'

export type ModelDetailPanelConfig = {
    onClose: () => void
    onSaveFields: (fields: Record<string, unknown>) => Promise<void>
    onSkip: (
        model: CatalogModel,
        reason: string,
    ) => Promise<void>
    onUnskip: (model: CatalogModel) => Promise<void>
}

// While the panel is open the page behind it does not scroll. Without this, a
// wheel over the sidebar or the backdrop scrolls the catalog underneath, and
// closing the panel leaves the reader somewhere they never chose to be.
const SCROLL_LOCK_CLASS = 'model-catalog-scroll-locked'

export type ModelDetailPanelInstance = {
    el: HTMLElement
    // The dimmed layer behind the drawer. It is a separate element because it
    // covers the page rather than sitting inside the panel.
    backdropEl: HTMLElement
    render: (
        model: CatalogModel | null,
        saving: boolean,
    ) => void
    destroy: () => void
}

// The fields worth a labelled control. Everything else on the authored record is
// a structure, and structures are edited in the JSON editor below the form.
type ScalarField = {
    key: string
    label: string
    type: 'text' | 'number'
}

const SCALAR_FIELDS: ScalarField[] = [
    {
        key: 'title',
        label: 'Title',
        type: 'text',
    },
    {
        key: 'shortTitle',
        label: 'Short title',
        type: 'text',
    },
    {
        key: 'providerTitle',
        label: 'Provider brand',
        type: 'text',
    },
    {
        key: 'modelVersion',
        label: 'Model version',
        type: 'text',
    },
    {
        key: 'color',
        label: 'Colour',
        type: 'text',
    },
    {
        key: 'iconName',
        label: 'Icon name',
        type: 'text',
    },
    {
        key: 'colorIconName',
        label: 'Colour icon name',
        type: 'text',
    },
    {
        key: 'sortingPosition',
        label: 'Sorting position',
        type: 'number',
    },
    {
        key: 'defaultTemperature',
        label: 'Default temperature',
        type: 'number',
    },
    {
        key: 'contextWindow',
        label: 'Context window',
        type: 'number',
    },
    {
        key: 'maxCompletionSize',
        label: 'Max completion size',
        type: 'number',
    },
    {
        key: 'imagePromptMaxChars',
        label: 'Image prompt max chars',
        type: 'number',
    },
]

// A list of field paths. As a comma-joined string it becomes a tall grey blob;
// as chips it wraps across the panel and each field stays readable on its own.
const fieldList = (
    fields: string[],
    emptyLabel: string,
): HTMLElement => fields.length === 0
    ? html`<span className="model-catalog-muted">${emptyLabel}</span>` as HTMLElement
    : html`
        <div className="model-catalog-chips">
            ${fields.map(field => html`<code className="model-catalog-field-chip">${field}</code>`)}
        </div>
    ` as HTMLElement

const formatValue = (value: unknown): string => {
    if (value === null || value === undefined)
        return '—'

    if (typeof value === 'object')
        return JSON.stringify(value)

    return String(value)
}

class ModelDetailPanel implements ModelDetailPanelInstance {
    readonly el: HTMLElement

    private readonly bodyEl: HTMLDivElement
    private readonly titleEl: HTMLDivElement
    private readonly subtitleEl: HTMLDivElement
    readonly backdropEl: HTMLDivElement

    private model: CatalogModel | null = null
    private saving = false
    // What the body was last built from. A filter keystroke re-renders the page,
    // and rebuilding the panel on one of those would throw away whatever is
    // half-typed in the editors.
    private renderedSignature: string | null = null
    // The viewer holds a CodeMirror instance, so it is torn down whenever the
    // body it lives in is rebuilt.
    private jsonViewer: JsonViewerInstance | null = null

    constructor(private readonly config: ModelDetailPanelConfig) {
        this.titleEl = html`<div className="drawer-title"></div>` as HTMLDivElement
        this.subtitleEl = html`<div className="model-catalog-drawer-subtitle"></div>` as HTMLDivElement
        this.bodyEl = html`<div className="drawer-body"></div>` as HTMLDivElement

        this.backdropEl = html`
            <div
                className="drawer-backdrop"
                onclick=${() => this.config.onClose()}
            ></div>
        ` as HTMLDivElement

        this.el = html`
            <aside className="drawer model-catalog-drawer">
                <div className="drawer-header">
                    <div>
                        ${this.titleEl}
                        ${this.subtitleEl}
                    </div>
                    <button
                        className="drawer-close"
                        type="button"
                        aria-label="Close model details"
                        innerHTML=${closeIcon}
                        onclick=${() => this.config.onClose()}
                    ></button>
                </div>
                ${this.bodyEl}
            </aside>
        ` as HTMLElement
    }

    render(
        model: CatalogModel | null,
        saving: boolean,
    ): void {
        this.model = model
        this.saving = saving
        this.el.classList.toggle('open', model !== null)
        this.backdropEl.classList.toggle('open', model !== null)
        document.documentElement.classList.toggle(SCROLL_LOCK_CLASS, model !== null)

        if (!model) {
            this.jsonViewer?.destroy()
            this.jsonViewer = null
            this.bodyEl.replaceChildren()
            this.renderedSignature = null

            return
        }

        this.titleEl.textContent = modelTitle(model)
        this.subtitleEl.textContent = `${model.providerTitle} · ${model.modelId}`

        const signature = `${model.provider}/${model.modelId}:${model.mergedAt}:${saving}`

        if (signature === this.renderedSignature)
            return

        this.renderedSignature = signature
        this.jsonViewer?.destroy()
        this.jsonViewer = null
        this.bodyEl.replaceChildren(
            this.renderStatus(model),
            this.renderProvenance(model),
            this.renderInferenceProviders(model),
            this.renderDrift(model),
            this.renderFieldForm(model),
            this.renderJsonView(model),
            this.renderIndexControls(model),
        )
    }

    // `disabled` is a boolean property, not an attribute with a value: writing
    // `disabled="false"` would still disable the button, so it is set after the
    // element exists.
    private renderSaveButton(
        label: string,
        className: string,
        onClick: () => Promise<void>,
    ): HTMLButtonElement {
        const button = html`
            <button
                className=${className}
                type="button"
                onclick=${() => void onClick()}
            >${label}</button>
        ` as HTMLButtonElement
        button.disabled = this.saving

        return button
    }

    private renderStatus(model: CatalogModel): HTMLElement {
        const missing = model.missingRequiredFields

        return html`
            <section className="model-catalog-section">
                <h3 className="model-catalog-section-title">Status</h3>
                <div className="model-catalog-facts">
                    <span className=${`status ${STATUS_TONES[model.status]}`}>${STATUS_LABELS[model.status]}</span>
                    <span className="model-catalog-muted">Merged ${new Date(model.mergedAt).toLocaleString()}</span>
                </div>
                ${missing.length === 0
                    ? html`<p className="model-catalog-muted">Every required field is filled in.</p>`
                    : html`
                        <div className="banner">
                            <div className="banner-body">
                                <strong>Missing required fields</strong>
                                ${fieldList(missing, 'nothing')}
                            </div>
                        </div>
                    `}
                ${model.ratesRefusedBecauseUnitsDiffer.length === 0
                    ? null
                    : html`
                        <p className="model-catalog-muted">
                            Rates a source publishes in another unit, left for a human:
                            ${model.ratesRefusedBecauseUnitsDiffer.join(', ')}
                        </p>
                    `}
            </section>
        ` as HTMLElement
    }

    private renderProvenance(model: CatalogModel): HTMLElement {
        const {
            sourcesQueried,
            sourcesWithDataForThisModel,
            sourcesWithoutRatesForThatProvider,
            confirmedByMoreThanOneSource,
            fieldsWhereSourcesDisagree,
            inferenceProviderCalledByThePlatform,
        } = model.sources

        return html`
            <section className="model-catalog-section model-catalog-section-wide">
                <h3 className="model-catalog-section-title">How it resolved</h3>
                <dl className="model-catalog-definitions">
                    <dt>Sources asked</dt>
                    <dd>${sourcesQueried.join(', ') || '—'}</dd>
                    <dt>Sources with data</dt>
                    <dd>${sourcesWithDataForThisModel.join(', ') || 'none'}</dd>
                    <dt>Corroborated</dt>
                    <dd>${confirmedByMoreThanOneSource ? 'By more than one source' : 'By a single source'}</dd>
                    <dt>Called through</dt>
                    <dd>${inferenceProviderCalledByThePlatform}</dd>
                    <dt>No rates for that provider</dt>
                    <dd>${sourcesWithoutRatesForThatProvider.join(', ') || 'none'}</dd>
                    <dt>Sources disagree on</dt>
                    <dd>${fieldList(fieldsWhereSourcesDisagree, 'nothing')}</dd>
                    <dt>Only Lixpi supplies</dt>
                    <dd>${fieldList(model.authored.fieldsOnlyLixpiSupplies, 'nothing')}</dd>
                    <dt>Lixpi overrides</dt>
                    <dd>${fieldList(model.authored.fieldsWhereLixpiOverridesSources, 'nothing')}</dd>
                    <dt>Inherited from _base</dt>
                    <dd>${fieldList(model.authored.fieldsInheritedFromProviderBaseFile, 'nothing')}</dd>
                    <dt>Filled from schema default</dt>
                    <dd>${fieldList(model.fieldsFilledFromSchemaDefault, 'nothing')}</dd>
                </dl>
            </section>
        ` as HTMLElement
    }

    // Every endpoint the model can be reached through, side by side. The top of the
    // panel describes the call the platform makes; this says what the same model
    // costs everywhere else, which is the question a routing change asks.
    private renderInferenceProviders(model: CatalogModel): HTMLElement {
        const providers = Object.entries(model.file.inferenceProviders ?? {}) as Array<[string, Record<string, any>]>
        const rows = providers.map(
            ([id, entry]) => html`
                <tr>
                    <td className="cell-mono">${id}</td>
                    <td>${entry.inferenceProviderTitle ?? ''}</td>
                    <td>${entry.isCalledByThePlatform ? html`<span className="status status-green">Called</span>` : ''}</td>
                    <td>${formatValue(entry.pricing ?? null)}</td>
                    <td>${formatValue(entry.contextWindow ?? null)}</td>
                    <td>${formatValue(entry.maxCompletionSize ?? null)}</td>
                    <td>${(entry.reportedBySources ?? []).join(', ')}</td>
                </tr>
            `,
        )

        return html`
            <section className="model-catalog-section model-catalog-section-wide">
                <h3 className="model-catalog-section-title">Inference providers</h3>
                ${rows.length === 0
                    ? html`<p className="model-catalog-muted">No source reports this model on any inference provider.</p>`
                    : html`
                        <div className="table-responsive">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Provider</th>
                                        <th>Name</th>
                                        <th></th>
                                        <th>Pricing</th>
                                        <th>Context</th>
                                        <th>Max output</th>
                                        <th>Reported by</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    `}
            </section>
        ` as HTMLElement
    }

    private renderDrift(model: CatalogModel): HTMLElement {
        const rows = model.drift.map(
            (finding: DriftFinding) => html`
                <tr>
                    <td className="cell-mono">${finding.field}</td>
                    <td>${formatValue(finding.lixpiValue)}</td>
                    <td>${formatValue(finding.fetchedValue)}</td>
                    <td>${finding.source}</td>
                    <td>${finding.isPricing ? html`<span className="status status-red">Pricing</span>` : ''}</td>
                </tr>
            `,
        )

        return html`
            <section className="model-catalog-section model-catalog-section-wide">
                <h3 className="model-catalog-section-title">Drift</h3>
                ${model.drift.length === 0
                    ? html`<p className="model-catalog-muted">The authored file and the sources agree.</p>`
                    : html`
                        <div className="table-responsive">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Field</th>
                                        <th>Authored</th>
                                        <th>Source</th>
                                        <th>From</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    `}
            </section>
        ` as HTMLElement
    }

    // The common scalars. A cleared box sends null, which is how the server
    // removes a field, so emptying one is a deliberate delete rather than a
    // silent no-op.
    private renderFieldForm(model: CatalogModel): HTMLElement {
        const authored = model.lixpi ?? {}
        const inputs = new Map<string, HTMLInputElement>()

        const controls = SCALAR_FIELDS.map(field => {
            const current = authored[field.key]
            const input = html`
                <input
                    className="form-control"
                    type=${field.type}
                    value=${current === undefined || current === null ? '' : String(current)}
                />
            ` as HTMLInputElement
            inputs.set(field.key, input)

            return html`
                <div className="form-group">
                    <label className="form-label">${field.label}</label>
                    ${input}
                </div>
            `
        })

        const save = async (): Promise<void> => {
            const patch: Record<string, unknown> = {}

            for (const field of SCALAR_FIELDS) {
                const raw = inputs.get(field.key)!.value.trim()
                const before = authored[field.key]
                const next = raw === ''
                    ? null
                    : field.type === 'number'
                        ? Number(raw)
                        : raw

                if (next === null && before === undefined)
                    continue

                if (next !== null && String(before) === String(next))
                    continue

                patch[field.key] = next
            }

            if (Object.keys(patch).length > 0)
                await this.config.onSaveFields(patch)
        }

        return html`
            <section className="model-catalog-section model-catalog-section-wide">
                <h3 className="model-catalog-section-title">Authored fields</h3>
                <p className="model-catalog-muted">
                    These live in the model's own file. Clearing a box removes the field, which hands it back to the sources.
                </p>
                <div className="model-catalog-form-grid">${controls}</div>
                <div className="form-actions">
                    ${this.renderSaveButton('Save fields', 'btn btn-primary', save)}
                </div>
            </section>
        ` as HTMLElement
    }

    // The authored file as it stands, for reading. Editing happens in the form
    // above, so a field is changed in one place with the server validating it,
    // rather than by hand-editing a record that has to parse.
    private renderJsonView(model: CatalogModel): HTMLElement {
        this.jsonViewer = createJsonViewer({
            value: model.lixpi ?? {},
            ariaLabel: `Authored record for ${model.modelId}`,
        })

        return html`
            <section className="model-catalog-section model-catalog-section-wide">
                <h3 className="model-catalog-section-title">Authored record</h3>
                <p className="model-catalog-muted">The whole file, as the tree holds it.</p>
                ${this.jsonViewer.el}
            </section>
        ` as HTMLElement
    }

    // Whether the model syncs at all. Skipping asks for a reason because the
    // server records one against the model and an unexplained skip outlives
    // whoever made it.
    private renderIndexControls(model: CatalogModel): HTMLElement {
        const isSkipped = model.status === 'skipped-by-catalog-index'
        const reasonEl = html`
            <input
                className="form-control"
                type="text"
                placeholder="Why this model is not shipped"
            />
        ` as HTMLInputElement

        const skip = async (): Promise<void> => {
            const reason = reasonEl.value.trim()

            if (reason === '') {
                reasonEl.focus()

                return
            }

            await this.config.onSkip(model, reason)
        }

        return html`
            <section className="model-catalog-section">
                <h3 className="model-catalog-section-title">Catalog index</h3>
                ${isSkipped
                    ? html`
                        <div className="form-actions">
                            ${this.renderSaveButton(
                                'Stop skipping this model',
                                'btn btn-primary',
                                async () => await this.config.onUnskip(model),
                            )}
                        </div>
                    `
                    : html`
                        <div className="form-group">
                            <label className="form-label">Reason</label>
                            ${reasonEl}
                        </div>
                        <div className="form-actions">
                            ${this.renderSaveButton('Skip this model', 'btn btn-danger', skip)}
                        </div>
                    `}
                <dl className="model-catalog-definitions">
                    <dt>Context window</dt>
                    <dd>${formatNumber(model.model?.contextWindow ?? model.file.contextWindow)}</dd>
                    <dt>Max completion</dt>
                    <dd>${formatNumber(model.model?.maxCompletionSize ?? model.file.maxCompletionSize)}</dd>
                </dl>
            </section>
        ` as HTMLElement
    }

    destroy(): void {
        this.model = null
        document.documentElement.classList.remove(SCROLL_LOCK_CLASS)
        this.jsonViewer?.destroy()
        this.jsonViewer = null
        this.backdropEl.remove()
        this.el.remove()
    }
}

export const createModelDetailPanel = (config: ModelDetailPanelConfig): ModelDetailPanelInstance =>
    new ModelDetailPanel(config)
