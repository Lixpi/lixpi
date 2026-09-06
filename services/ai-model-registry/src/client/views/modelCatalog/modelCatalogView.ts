// The model catalog page: what the catalog holds, why each model resolved the
// way it did, and the controls that change it. The store is the source of truth
// for the loaded overview, the filters, and the selected model; this view
// re-renders from it and writes back through the catalog service.

import { LoadingStatus } from '@lixpi/constants'
import { html } from '@lixpi/ui-primitives/dom'

import { modelCatalogService } from '$src/services/model-catalog-service.ts'
import {
    modelCatalogStore,
    modelKey,
    type ModelCatalogFilters,
    type StatusFilter,
} from '$src/stores/modelCatalogStore.ts'
import {
    searchIcon,
    syncIcon,
} from '$src/views/layouts/icons.ts'
import {
    createModelDetailPanel,
    type ModelDetailPanelInstance,
} from '$src/views/modelCatalog/components/modelDetailPanel.ts'
import {
    createModelTable,
    type ModelGroup,
    type ModelTableInstance,
} from '$src/views/modelCatalog/components/modelTable.ts'
import { createProviderGroupHeader } from '$src/views/modelCatalog/components/providerGroupHeader.ts'
import { searchHaystack } from '$src/views/modelCatalog/modelFormatting.ts'
import {
    type CatalogModel,
    type CatalogOverview,
    type ProviderDirectory,
} from '$src/views/modelCatalog/types.ts'
import '$src/views/modelCatalog/model-catalog.scss'

const STATUS_FILTER_OPTIONS: Array<{
    value: StatusFilter
    label: string
}> = [
    {
        value: 'all',
        label: 'Every status',
    },
    {
        value: 'written-to-database',
        label: 'In the database',
    },
    {
        value: 'missing-required-fields',
        label: 'Missing required fields',
    },
    {
        value: 'skipped-by-catalog-index',
        label: 'Excluded by the index',
    },
    {
        value: 'drifting',
        label: 'Drifting from a source',
    },
]

type Tile = {
    label: string
    value: string
    tone: string
}

export type ModelCatalogViewInstance = {
    el: HTMLElement
    mount: () => void
    destroy: () => void
}

class ModelCatalogView implements ModelCatalogViewInstance {
    readonly el: HTMLElement

    private readonly statsEl: HTMLDivElement
    private readonly statusEl: HTMLDivElement
    private readonly searchEl: HTMLInputElement
    private readonly providerFilterEl: HTMLSelectElement
    private readonly statusFilterEl: HTMLSelectElement
    private readonly syncButtonEl: HTMLButtonElement
    private readonly table: ModelTableInstance
    private readonly detailPanel: ModelDetailPanelInstance
    private readonly unsubscribeStore: () => void

    // Read by the group headers as they are built, so a header knows whether a
    // write is in flight without the table having to carry that through.
    private saving = false

    constructor() {
        this.statsEl = html`<div className="model-catalog-stats"></div>` as HTMLDivElement
        this.statusEl = html`<div className="model-catalog-status"></div>` as HTMLDivElement

        this.searchEl = html`
            <input
                className="form-control"
                type="search"
                placeholder="Search models"
                autocomplete="off"
                aria-label="Search models"
                oninput=${() => modelCatalogStore.setFilters({ query: this.searchEl.value.trim().toLowerCase() })}
            />
        ` as HTMLInputElement

        this.providerFilterEl = html`
            <select
                className="form-control"
                aria-label="Filter by provider"
                onchange=${() => modelCatalogStore.setFilters({
                    provider: this.providerFilterEl.value as ModelCatalogFilters['provider'],
                })}
            >
                <option value="all">Every provider</option>
            </select>
        ` as HTMLSelectElement

        this.statusFilterEl = html`
            <select
                className="form-control"
                aria-label="Filter by status"
                onchange=${() => modelCatalogStore.setFilters({ status: this.statusFilterEl.value as StatusFilter })}
            >
                ${STATUS_FILTER_OPTIONS.map(
                    option => html`<option value=${option.value}>${option.label}</option>`,
                )}
            </select>
        ` as HTMLSelectElement

        this.syncButtonEl = html`
            <button
                className="btn btn-primary"
                type="button"
                onclick=${() => void modelCatalogService.runSync()}
            >
                <span innerHTML=${syncIcon}></span>
                Run sync
            </button>
        ` as HTMLButtonElement

        this.table = createModelTable({
            onSelect: model => this.selectModel(model),
            renderGroupHeader: group => createProviderGroupHeader({
                provider: group.provider,
                shownModels: group.models.length,
                totalModels: group.totalModels,
                saving: this.saving,
                collapsed: group.collapsed,
                onToggleCollapsed: provider => modelCatalogStore.toggleProviderCollapsed(provider),
                onPatchIndex: async (
                    provider,
                    patch,
                ) => await modelCatalogService.patchCatalogIndex(provider, patch),
                onPatchBase: async (
                    provider,
                    fields,
                ) => await modelCatalogService.patchProviderBase(provider, fields),
            }).el,
        })

        this.detailPanel = createModelDetailPanel({
            onClose: () => modelCatalogStore.setDataValues({ selectedModelKey: null }),
            onSaveFields: async fields => await this.saveFields(fields),
            onSkip: async (
                model,
                reason,
            ) => await modelCatalogService.patchCatalogIndex(
                model.provider,
                {
                    skipModels: [{
                        model: model.modelId,
                        reason,
                    }],
                },
            ),
            onUnskip: async model => await modelCatalogService.patchCatalogIndex(
                model.provider,
                { unskipModels: [model.modelId] },
            ),
        })

        this.el = html`
            <div className="page-wrapper model-catalog-page">
                <div className="page-header">
                    <div className="page-header-row">
                        <div>
                            <div className="page-pretitle">Catalog</div>
                            <h1 className="page-title">AI models</h1>
                        </div>
                        <div className="page-actions">
                            ${this.syncButtonEl}
                        </div>
                    </div>
                </div>

                ${this.statusEl}
                ${this.statsEl}

                <div className="card">
                    <div className="card-header model-catalog-filters">
                        <div>
                            <div className="card-title">Models by provider</div>
                            <div className="card-subtitle">Click a model to see how it resolved and to edit its authored file.</div>
                        </div>
                        <div className="model-catalog-filter-controls">
                            <div className="input-group model-catalog-search">
                                <span
                                    className="input-icon"
                                    innerHTML=${searchIcon}
                                ></span>
                                ${this.searchEl}
                            </div>
                            ${this.providerFilterEl}
                            ${this.statusFilterEl}
                        </div>
                    </div>
                    ${this.table.el}
                </div>

                ${this.detailPanel.backdropEl}
                ${this.detailPanel.el}
            </div>
        ` as HTMLElement

        this.unsubscribeStore = modelCatalogStore.subscribe(() => this.render())
    }

    // Nothing to do on mount: this view renders from the store, and the store
    // delivers its current value the moment it is subscribed to.
    mount(): void {}

    private selectModel(model: CatalogModel): void {
        const key = modelKey(model)
        const current = modelCatalogStore.getData('selectedModelKey')
        modelCatalogStore.setDataValues({ selectedModelKey: current === key ? null : key })
    }

    private async saveFields(fields: Record<string, unknown>): Promise<void> {
        const selected = this.selectedModel()

        if (!selected)
            return

        await modelCatalogService.patchModelFields(
            selected.provider,
            selected.modelId,
            fields,
        )
    }

    private selectedModel(): CatalogModel | null {
        const overview = modelCatalogStore.getData('overview') as CatalogOverview | null
        const key = modelCatalogStore.getData('selectedModelKey') as string | null

        if (!overview || !key)
            return null

        return overview.models.find(model => modelKey(model) === key) ?? null
    }

    private visibleModels(overview: CatalogOverview): CatalogModel[] {
        const filters = modelCatalogStore.getData('filters') as ModelCatalogFilters

        return overview.models.filter(model => {
            if (
                filters.provider !== 'all'
                && model.provider !== filters.provider
            )
                return false

            if (filters.status === 'drifting' && model.drift.length === 0)
                return false

            if (
                filters.status !== 'all'
                && filters.status !== 'drifting'
                && model.status !== filters.status
            )
                return false

            return filters.query === '' || searchHaystack(model).includes(filters.query)
        })
    }

    // Every provider the catalog knows, each with the models the filters left. A
    // provider whose models are all filtered out drops off the page rather than
    // sitting there as an empty band.
    private groupsByProvider(overview: CatalogOverview): ModelGroup[] {
        const visible = this.visibleModels(overview)
        const collapsed = modelCatalogStore.getData('collapsedProviders') as string[]
        const groups: ModelGroup[] = []

        for (const provider of overview.providers) {
            const models = visible.filter(model => model.provider === provider.directory)

            if (models.length === 0)
                continue

            groups.push({
                provider,
                models,
                totalModels: overview.models.filter(model => model.provider === provider.directory).length,
                collapsed: collapsed.includes(provider.directory),
            })
        }

        return groups
    }

    private render(): void {
        const meta = modelCatalogStore.getMeta()
        const overview = modelCatalogStore.getData('overview') as CatalogOverview | null
        const saving = meta.saving as boolean
        this.saving = saving

        this.syncButtonEl.disabled = saving || !(overview?.syncEnabled ?? false)
        this.renderStatus(meta, overview)

        if (!overview) {
            this.statsEl.replaceChildren()
            this.table.render([], null)
            this.detailPanel.render(null, saving)

            return
        }

        this.syncProviderOptions(overview)
        this.renderStats(overview)

        const selectedKey = modelCatalogStore.getData('selectedModelKey') as string | null
        this.table.render(
            this.groupsByProvider(overview),
            selectedKey,
        )
        this.detailPanel.render(this.selectedModel(), saving)
    }

    private renderStatus(
        meta: Record<string, any>,
        overview: CatalogOverview | null,
    ): void {
        const notes: HTMLElement[] = []

        if (meta.loadingStatus === LoadingStatus.loading)
            notes.push(html`<div className="model-catalog-note">Loading the catalog…</div>` as HTMLElement)

        if (meta.error)
            notes.push(html`<div className="banner model-catalog-error"><div className="banner-body">${meta.error}</div></div>` as HTMLElement)

        if (meta.lastSaveMessage)
            notes.push(html`<div className="model-catalog-note">${meta.lastSaveMessage}</div>` as HTMLElement)

        if (overview && !overview.syncEnabled)
            notes.push(
                html`
                    <div className="model-catalog-note">
                        Scheduled sync is off in this environment, so Run sync is disabled. Run one from the container with
                        <code>node --experimental-transform-types ./src/catalog/cli.ts</code>.
                    </div>
                ` as HTMLElement,
            )

        this.statusEl.replaceChildren(...notes)
    }

    private syncProviderOptions(overview: CatalogOverview): void {
        const existing = new Set(
            [...this.providerFilterEl.options].map(option => option.value),
        )

        for (const provider of overview.providers) {
            if (existing.has(provider.directory))
                continue

            this.providerFilterEl.append(
                html`<option value=${provider.directory}>${provider.title}</option>` as HTMLOptionElement,
            )
        }

        const filters = modelCatalogStore.getData('filters') as ModelCatalogFilters
        this.providerFilterEl.value = filters.provider as ProviderDirectory | 'all'
        this.statusFilterEl.value = filters.status
    }

    private renderStats(overview: CatalogOverview): void {
        const tiles: Tile[] = [
            {
                label: 'Models in the tree',
                value: String(overview.models.length),
                tone: 'model-catalog-stat-lead',
            },
            {
                label: 'In the database',
                value: String(overview.models.filter(model => model.status === 'written-to-database').length),
                tone: 'model-catalog-stat-good',
            },
            {
                label: 'Missing fields',
                value: String(overview.models.filter(model => model.status === 'missing-required-fields').length),
                tone: 'model-catalog-stat-warn',
            },
            {
                label: 'Excluded',
                value: String(overview.models.filter(model => model.status === 'skipped-by-catalog-index').length),
                tone: '',
            },
            {
                label: 'Drift findings',
                value: String(overview.models.reduce((total, model) => total + model.drift.length, 0)),
                tone: 'model-catalog-stat-warn',
            },
        ]

        this.statsEl.replaceChildren(
            ...tiles.map(
                tile => html`
                    <div className=${`model-catalog-stat ${tile.tone}`}>
                        <span className="model-catalog-stat-value">${tile.value}</span>
                        <span className="model-catalog-stat-label">${tile.label}</span>
                    </div>
                ` as HTMLElement,
            ),
        )
    }

    destroy(): void {
        this.unsubscribeStore()
        this.table.destroy()
        this.detailPanel.destroy()
        this.el.remove()
    }
}

export const createModelCatalogView = (): ModelCatalogViewInstance => new ModelCatalogView()
