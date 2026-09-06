// The model list, grouped by provider. Each group opens with the provider's own
// band, which carries its counts and its sync configuration, and is followed by
// that provider's models. Clicking a row opens the detail panel.

import { html } from '@lixpi/ui-primitives/dom'

import {
    formatNumber,
    modalityTitles,
    modelTitle,
    pricingSummary,
    shortModel,
    STATUS_LABELS,
    STATUS_TONES,
} from '$src/views/modelCatalog/modelFormatting.ts'
import {
    type CatalogModel,
    type CatalogProvider,
} from '$src/views/modelCatalog/types.ts'

export type ModelGroup = {
    provider: CatalogProvider
    models: CatalogModel[]
    totalModels: number
    collapsed: boolean
}

export type ModelTableConfig = {
    onSelect: (model: CatalogModel) => void
    // The provider band. The view owns it because it writes to the registry,
    // which is not the table's business.
    renderGroupHeader: (group: ModelGroup) => HTMLElement
}

export type ModelTableInstance = {
    el: HTMLElement
    render: (
        groups: ModelGroup[],
        selectedKey: string | null,
    ) => void
    destroy: () => void
}

const COLUMN_COUNT = 7

class ModelTable implements ModelTableInstance {
    readonly el: HTMLElement

    private readonly tableEl: HTMLTableElement
    private readonly headEl: HTMLTableSectionElement

    constructor(private readonly config: ModelTableConfig) {
        this.headEl = html`
            <thead>
                <tr>
                    <th>Model</th>
                    <th>Modalities</th>
                    <th>Context</th>
                    <th>Rate</th>
                    <th>Sources</th>
                    <th>Drift</th>
                    <th>Status</th>
                </tr>
            </thead>
        ` as HTMLTableSectionElement

        this.tableEl = html`
            <table className="table model-catalog-table">
                ${this.headEl}
            </table>
        ` as HTMLTableElement

        this.el = html`
            <div className="table-responsive">
                ${this.tableEl}
            </div>
        ` as HTMLElement
    }

    render(
        groups: ModelGroup[],
        selectedKey: string | null,
    ): void {
        this.tableEl.replaceChildren(this.headEl)

        if (groups.length === 0) {
            this.tableEl.append(
                html`
                    <tbody>
                        <tr>
                            <td colspan=${COLUMN_COUNT}>
                                <div className="empty-state">
                                    <div className="empty-state-title">No models match</div>
                                    <div className="empty-state-desc">Loosen the filters, or clear the search box.</div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                ` as HTMLTableSectionElement,
            )

            return
        }

        for (const group of groups) {
            const body = html`<tbody className="model-catalog-group-body"></tbody>` as HTMLTableSectionElement

            body.append(
                html`
                    <tr className="model-catalog-group-header-row">
                        <td colspan=${COLUMN_COUNT}>${this.config.renderGroupHeader(group)}</td>
                    </tr>
                ` as HTMLTableRowElement,
            )

            for (const model of group.collapsed ? [] : group.models) {
                const key = `${model.provider}/${model.modelId}`
                const row = this.renderRow(model)
                row.classList.toggle('model-catalog-row-selected', key === selectedKey)
                body.append(row)
            }

            this.tableEl.append(body)
        }
    }

    private renderRow(model: CatalogModel): HTMLTableRowElement {
        const modalities = modalityTitles(model)
        const contextWindow = model.model?.contextWindow ?? model.file.contextWindow
        const driftCount = model.drift.length
        const sources = model.sources.sourcesWithDataForThisModel

        return html`
            <tr
                className="model-catalog-row"
                onclick=${() => this.config.onSelect(model)}
            >
                <td>
                    <div className="model-catalog-cell-name">
                        <span className="cell-strong">${modelTitle(model)}</span>
                        <code className="model-catalog-model-id">${shortModel(model.modelId)}</code>
                    </div>
                </td>
                <td>
                    <div className="model-catalog-chips">
                        ${modalities.length === 0
                            ? html`<span className="model-catalog-muted">—</span>`
                            : modalities.map(
                                modality => html`<span className="chip">${modality}</span>`,
                            )}
                    </div>
                </td>
                <td className="cell-mono">${formatNumber(contextWindow)}</td>
                <td className="model-catalog-muted">${pricingSummary(model)}</td>
                <td>
                    <span
                        className="model-catalog-sources"
                        aria-label=${`${sources.length} of ${model.sources.sourcesQueried.length} sources have data`}
                    >${sources.length}/${model.sources.sourcesQueried.length}</span>
                </td>
                <td>
                    ${driftCount === 0
                        ? html`<span className="model-catalog-muted">—</span>`
                        : html`
                            <span className=${model.drift.some(finding => finding.isPricing)
                                ? 'status status-red'
                                : 'status status-yellow'}>${driftCount}</span>
                        `}
                </td>
                <td><span className=${`status ${STATUS_TONES[model.status]}`}>${STATUS_LABELS[model.status]}</span></td>
            </tr>
        ` as HTMLTableRowElement
    }

    destroy(): void {
        this.el.remove()
    }
}

export const createModelTable = (config: ModelTableConfig): ModelTableInstance => new ModelTable(config)
