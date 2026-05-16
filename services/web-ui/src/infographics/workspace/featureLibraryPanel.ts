'use strict'

import { html } from '$src/utils/domTemplates.ts'
import { NATS_SUBJECTS, type Feature, type FeatureMeta, type FeatureScope } from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'

const SCOPES: Array<{ key: FeatureScope; label: string }> = [
    { key: 'workspace', label: 'Workspace' },
    { key: 'user', label: 'Mine' },
    { key: 'organization', label: 'Organization' },
    { key: 'public', label: 'Public' },
]

type FeatureLibraryPanelOptions = {
    workspaceId: string
    paneEl: HTMLElement
    onOpenExtractionTab: (extractionRunId: string) => void
    onUseFeature?: (feature: FeatureMeta) => boolean
}

type FeatureDetailsState = Feature | { error: string }

type PaletteColor = {
    name: string
    hex: string
    role?: string | undefined
    usage?: string | number | undefined
    temperature?: string | undefined
    notes?: string | undefined
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const withApiBaseUrl = (url: string): string =>
    url.startsWith('/api/') ? `${API_BASE_URL}${url}` : url

const textValue = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined
    const text = String(value).trim()
    return text.length > 0 ? text : undefined
}

const normalizeHexColor = (value: unknown): string | undefined => {
    const text = textValue(value)
    if (!text) return undefined
    const withHash = text.startsWith('#') ? text : `#${text}`
    return HEX_COLOR_PATTERN.test(withHash) ? withHash.toUpperCase() : undefined
}

const getPaletteSource = (parameters: Record<string, any> | undefined): unknown[] => {
    if (!parameters) return []
    if (Array.isArray(parameters.palette)) return parameters.palette
    if (Array.isArray(parameters.colors)) return parameters.colors
    if (Array.isArray(parameters.colours)) return parameters.colours
    if (Array.isArray(parameters.colorPalette)) return parameters.colorPalette
    return []
}

const getPaletteColors = (feature: Feature | undefined): PaletteColor[] =>
    getPaletteSource(feature?.parameters).map((entry, index): PaletteColor | undefined => {
        if (typeof entry === 'string') {
            const hex = normalizeHexColor(entry)
            if (!hex) return undefined
            return { name: `Color ${index + 1}`, hex }
        }
        if (!entry || typeof entry !== 'object') return undefined
        const rawColor = entry as Record<string, unknown>
        const hex = normalizeHexColor(rawColor.hex ?? rawColor.hexCode ?? rawColor.value ?? rawColor.color ?? rawColor.colour)
        if (!hex) return undefined
        return {
            name: textValue(rawColor.name ?? rawColor.label ?? rawColor.colorName ?? rawColor.colourName) ?? `Color ${index + 1}`,
            hex,
            role: textValue(rawColor.role ?? rawColor.purpose),
            usage: textValue(rawColor.usage ?? rawColor.usageRatio ?? rawColor.ratio ?? rawColor.weight),
            temperature: textValue(rawColor.temperature),
            notes: textValue(rawColor.notes ?? rawColor.note ?? rawColor.description),
        }
    }).filter((color): color is PaletteColor => color !== undefined)

const isFeatureDetails = (details: FeatureDetailsState | undefined): details is Feature =>
    !!details && !('error' in details)

const toFeatureMeta = (feature: Feature | FeatureMeta): FeatureMeta => {
    const fullFeature = 'sampleImages' in feature ? feature : undefined
    const firstSample = fullFeature?.sampleImages?.[0]
    const meta = feature as FeatureMeta
    return {
        featureId: feature.featureId,
        category: feature.category,
        name: feature.name,
        summary: feature.summary,
        tags: feature.tags ?? [],
        scope: feature.scope,
        scopeOwnerId: feature.scopeOwnerId,
        status: feature.status,
        ownerUserId: feature.ownerUserId,
        sampleZeroKey: meta.sampleZeroKey ?? firstSample?.fileId ?? (firstSample ? `features/${feature.featureId}/sample-${firstSample.idx}.${firstSample.ext}` : undefined),
        sampleZeroUrl: meta.sampleZeroUrl ?? firstSample?.imageUrl,
        updatedAt: feature.updatedAt,
    }
}

export function createFeatureLibraryPanel(options: FeatureLibraryPanelOptions) {
    const { workspaceId, paneEl, onOpenExtractionTab, onUseFeature } = options
    let isOpen = false
    let currentScope: FeatureScope = 'workspace'
    let searchQuery = ''
    let allFeatures: FeatureMeta[] = []
    let isLoading = false
    let errorMessage = ''
    let feedbackMessage = ''
    let accessToken = ''
    let selectedFeatureId: string | null = null
    const featureDetails = new Map<string, FeatureDetailsState>()
    const loadingFeatureDetails = new Set<string>()
    let panelEl: HTMLElement | null = null
    let backdropEl: HTMLElement | null = null
    let hasFeatureEventSubscriptions = false

    async function loadFeatures() {
        isLoading = true
        errorMessage = ''
        renderFeatureList()
        try {
            const nats = servicesStore.getData('nats')
            if (!nats) {
                errorMessage = 'Feature library is offline.'
                return
            }
            const token = await AuthService.getTokenSilently()
            accessToken = token
            const result = await nats.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.LIST_BY_SCOPE, { token, workspaceId, scope: currentScope, scopeOwnerId: currentScope === 'workspace' ? workspaceId : '' })
            allFeatures = result?.items ?? []
        } catch (e) {
            console.error('Failed to load features:', e)
            errorMessage = 'Could not load features.'
        } finally {
            isLoading = false
            renderFeatureList()
        }
    }

    function setFeedback(message: string) {
        feedbackMessage = message
        const feedbackEl = panelEl?.querySelector('.feature-library-feedback') as HTMLElement | null
        if (feedbackEl) feedbackEl.textContent = feedbackMessage
    }

    function appendImageAuth(url: string): string {
        const apiUrl = withApiBaseUrl(url)
        if (!accessToken) return apiUrl
        const separator = apiUrl.includes('?') ? '&' : '?'
        return `${apiUrl}${separator}${new URLSearchParams({ token: accessToken }).toString()}`
    }

    function getSampleUrl(feature: FeatureMeta, sampleIndex = 0): string {
        if (sampleIndex === 0 && feature.sampleZeroUrl) return appendImageAuth(feature.sampleZeroUrl)
        const details = featureDetails.get(feature.featureId)
        const featureSample = isFeatureDetails(details) ? details.sampleImages?.find((sample) => sample.idx === sampleIndex) ?? details.sampleImages?.[sampleIndex] : undefined
        if (featureSample?.imageUrl) return appendImageAuth(featureSample.imageUrl)
        const params = new URLSearchParams({ workspaceId, token: accessToken })
        return withApiBaseUrl(`/api/features/${feature.featureId}/samples/${sampleIndex}?${params.toString()}`)
    }

    function handleSampleImageError(event: Event, feature: FeatureMeta, sampleIndex = 0) {
        const imageEl = event.currentTarget as HTMLImageElement
        if (imageEl.dataset.sampleFallbackTried === 'true') {
            imageEl.replaceWith(
                imageEl.classList.contains('feature-library-row__thumb')
                    ? html`<div className="feature-library-row__thumb-placeholder" aria-hidden="true"></div>` as HTMLElement
                    : html`<div className="feature-library-row__detail-empty">Sample image could not be loaded.</div>` as HTMLElement,
            )
            return
        }
        imageEl.dataset.sampleFallbackTried = 'true'
        const params = new URLSearchParams({ workspaceId, token: accessToken })
        imageEl.src = withApiBaseUrl(`/api/features/${feature.featureId}/samples/${sampleIndex}?${params.toString()}`)
    }

    async function ensureFeatureDetails(featureId: string) {
        if (featureDetails.has(featureId) || loadingFeatureDetails.has(featureId)) return
        loadingFeatureDetails.add(featureId)
        try {
            const nats = servicesStore.getData('nats')
            if (!nats) {
                featureDetails.set(featureId, { error: 'Feature details are offline.' })
                return
            }
            const token = accessToken || await AuthService.getTokenSilently()
            accessToken = token
            const result = await nats.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.GET, { token, workspaceId, featureId })
            featureDetails.set(featureId, result?.error ? { error: result.error } : result as Feature)
        } catch (error) {
            console.error('Failed to load feature details:', error)
            featureDetails.set(featureId, { error: 'Could not load feature details.' })
        } finally {
            loadingFeatureDetails.delete(featureId)
            renderFeatureList()
        }
    }

    function getFiltered(): FeatureMeta[] {
        if (!searchQuery) return allFeatures
        const normalizedQuery = searchQuery.toLowerCase()
        return allFeatures.filter((feature) => feature.name.toLowerCase().includes(normalizedQuery) || feature.summary.toLowerCase().includes(normalizedQuery) || feature.category.toLowerCase().includes(normalizedQuery) || (feature.tags ?? []).some((tag) => tag.toLowerCase().includes(normalizedQuery)))
    }

    function renderFeatureList() {
        if (!panelEl) return
        const listEl = panelEl.querySelector('.feature-library-body') as HTMLElement
        if (!listEl) return
        listEl.replaceChildren()
        if (isLoading) {
            listEl.appendChild(html`<div className="feature-library-state">Loading features…</div>` as HTMLElement)
            return
        }
        if (errorMessage) {
            listEl.appendChild(html`<div className="feature-library-state feature-library-state--error">${errorMessage}</div>` as HTMLElement)
            return
        }
        const filtered = getFiltered()
        if (filtered.length === 0) { listEl.appendChild(html`<div className="feature-library-state">No features found.</div>` as HTMLElement); return }

        const groups = new Map<string, FeatureMeta[]>()
        for (const feature of filtered) {
            const category = feature.category || 'other'
            if (!groups.has(category)) groups.set(category, [])
            groups.get(category)!.push(feature)
        }

        for (const [category, features] of groups) {
            const sectionEl = html`<div className="feature-library-section">
                <button type="button" className="feature-library-section__header">${category}</button>
                <div className="feature-library-section__items"></div>
            </div>` as HTMLElement
            const itemsEl = sectionEl.querySelector('.feature-library-section__items') as HTMLElement
            let collapsed = false
            sectionEl.querySelector('button')!.addEventListener('click', () => {
                collapsed = !collapsed
                itemsEl.hidden = collapsed
            })
            for (const feature of features) itemsEl.appendChild(buildRow(feature))
            listEl.appendChild(sectionEl)
        }
    }

    function buildPaletteDetails(colors: PaletteColor[]): HTMLElement {
        const paletteEl = html`<div className="feature-library-palette">
            <div className="feature-library-palette__title">Palette breakdown</div>
            <div className="feature-library-palette__swatches"></div>
            <div className="feature-library-palette__list"></div>
        </div>` as HTMLElement

        const swatchesEl = paletteEl.querySelector('.feature-library-palette__swatches') as HTMLElement
        const listEl = paletteEl.querySelector('.feature-library-palette__list') as HTMLElement
        for (const color of colors) {
            const swatchStyle = { backgroundColor: color.hex }
            swatchesEl.appendChild(html`<span className="feature-library-palette__swatch" style=${swatchStyle} title=${`${color.name} ${color.hex}`}></span>` as HTMLElement)
            listEl.appendChild(html`<div className="feature-library-palette__color">
                <span className="feature-library-palette__chip" style=${swatchStyle}></span>
                <div className="feature-library-palette__color-copy">
                    <strong>${color.name}</strong>
                    <span>${color.hex}${color.role ? ` · ${color.role}` : ''}${color.usage ? ` · ${color.usage}` : ''}</span>
                    ${color.notes || color.temperature ? html`<em>${[color.temperature, color.notes].filter(Boolean).join(' · ')}</em>` : null}
                </div>
            </div>` as HTMLElement)
        }
        return paletteEl
    }

    function buildInstructionsPreview(feature: Feature): HTMLElement | null {
        if (!feature.instructions?.trim()) return null
        const preview = feature.instructions.length > 900 ? `${feature.instructions.slice(0, 900).trim()}…` : feature.instructions
        return html`<div className="feature-library-instructions">
            <div className="feature-library-instructions__title">Application notes</div>
            <div className="feature-library-instructions__body">${preview}</div>
        </div>` as HTMLElement
    }

    function buildSampleGallery(feature: FeatureMeta, details: FeatureDetailsState | undefined): HTMLElement {
        const samples = isFeatureDetails(details) ? details.sampleImages ?? [] : []
        const galleryEl = html`<div className="feature-library-row__samples"></div>` as HTMLElement
        if (samples.length === 0) {
            if (feature.sampleZeroKey && accessToken) {
                galleryEl.appendChild(html`<img className="feature-library-row__detail-image" src=${getSampleUrl(feature)} alt=${`${feature.name} sample preview`} onerror=${(event: Event) => handleSampleImageError(event, feature)} />` as HTMLElement)
                return galleryEl
            }
            galleryEl.appendChild(html`<div className="feature-library-row__detail-empty">No sample image saved.</div>` as HTMLElement)
            return galleryEl
        }

        for (const sample of samples) {
            galleryEl.appendChild(html`<figure className="feature-library-row__sample-card">
                <img className="feature-library-row__sample-image" src=${getSampleUrl(feature, sample.idx)} alt=${sample.subject || `${feature.name} sample ${sample.idx + 1}`} onerror=${(event: Event) => handleSampleImageError(event, feature, sample.idx)} />
                <figcaption>${sample.subject || `Sample ${sample.idx + 1}`}</figcaption>
            </figure>` as HTMLElement)
        }
        return galleryEl
    }

    function buildRow(feature: FeatureMeta): HTMLElement {
        const isExpanded = selectedFeatureId === feature.featureId
        const details = featureDetails.get(feature.featureId)
        if (isExpanded) void ensureFeatureDetails(feature.featureId)
        const rowEl = html`<div className=${`feature-library-row${isExpanded ? ' feature-library-row--expanded' : ''}`} data=${{ featureId: feature.featureId }} tabindex="0" aria-expanded=${isExpanded ? 'true' : 'false'}>
            ${feature.sampleZeroKey && accessToken ? html`<img className="feature-library-row__thumb" src=${getSampleUrl(feature)} alt=${`${feature.name} sample`} width="48" height="48" onerror=${(event: Event) => handleSampleImageError(event, feature)} />` : html`<div className="feature-library-row__thumb-placeholder" aria-hidden="true"></div>`}
            <div className="feature-library-row__info">
                <div className="feature-library-row__meta">
                    <span className="feature-library-row__category">${feature.category || 'feature'}</span>
                    <span className="feature-library-row__scope">${feature.scope}</span>
                </div>
                <div className="feature-library-row__name">@${feature.name}</div>
                <div className="feature-library-row__summary">${feature.summary}</div>
                <div className="feature-library-row__tags"></div>
            </div>
            <div className="feature-library-row__actions">
                <button type="button" className="feature-library-row__action feature-library-row__action--primary" data-action="use">Use</button>
                ${feature.scope === 'public' ? html`<button type="button" className="feature-library-row__action" data-action="report">Report</button>` : html`<button type="button" className="feature-library-row__action" data-action="delete">Delete</button>`}
            </div>
            ${isExpanded ? html`<div className="feature-library-row__details">
                <div className="feature-library-row__detail-summary">${feature.summary || 'No summary stored.'}</div>
                <div className="feature-library-row__detail-grid">
                    <div className="feature-library-row__detail-field"><span>Category</span><strong>${feature.category || 'feature'}</strong></div>
                    <div className="feature-library-row__detail-field"><span>Scope</span><strong>${feature.scope}</strong></div>
                    <div className="feature-library-row__detail-field"><span>Feature ID</span><strong>${feature.featureId}</strong></div>
                </div>
                <div className="feature-library-row__detail-status">${loadingFeatureDetails.has(feature.featureId) ? 'Loading full feature details…' : details && 'error' in details ? details.error : ''}</div>
                <div className="feature-library-row__palette-mount"></div>
                <div className="feature-library-row__instructions-mount"></div>
                <div className="feature-library-row__detail-tags"></div>
                <div className="feature-library-row__samples-mount"></div>
            </div>` : null}
        </div>` as HTMLElement

        if (isExpanded) {
            const samplesMount = rowEl.querySelector('.feature-library-row__samples-mount') as HTMLElement | null
            if (samplesMount) samplesMount.appendChild(buildSampleGallery(feature, details))
        }

        if (isExpanded && isFeatureDetails(details)) {
            const paletteMount = rowEl.querySelector('.feature-library-row__palette-mount') as HTMLElement | null
            const instructionsMount = rowEl.querySelector('.feature-library-row__instructions-mount') as HTMLElement | null
            const colors = getPaletteColors(details)
            if (paletteMount) {
                if (colors.length > 0) paletteMount.appendChild(buildPaletteDetails(colors))
                else if (feature.category === 'color-palette') paletteMount.appendChild(html`<div className="feature-library-row__detail-empty">No structured palette colors saved.</div>` as HTMLElement)
            }
            const instructionsPreview = buildInstructionsPreview(details)
            if (instructionsMount && instructionsPreview) instructionsMount.appendChild(instructionsPreview)
        }

        const tagsEl = rowEl.querySelector('.feature-library-row__tags') as HTMLElement
        for (const tag of (feature.tags ?? []).slice(0, 4)) {
            tagsEl.appendChild(html`<span className="feature-library-row__tag">${tag}</span>` as HTMLElement)
        }

        const detailTagsEl = rowEl.querySelector('.feature-library-row__detail-tags') as HTMLElement | null
        if (detailTagsEl) {
            const tags = feature.tags ?? []
            if (tags.length === 0) detailTagsEl.appendChild(html`<span className="feature-library-row__detail-empty">No tags.</span>` as HTMLElement)
            for (const tag of tags) {
                detailTagsEl.appendChild(html`<span className="feature-library-row__tag">${tag}</span>` as HTMLElement)
            }
        }

        const toggleDetails = () => {
            selectedFeatureId = selectedFeatureId === feature.featureId ? null : feature.featureId
            renderFeatureList()
        }

        rowEl.addEventListener('keydown', (event) => {
            if (event.target instanceof HTMLElement && event.target.closest('[data-action]')) return
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            toggleDetails()
        })

        rowEl.addEventListener('click', async (event) => {
            const target = event.target as HTMLElement
            const actionButton = target.closest('[data-action]') as HTMLElement | null
            if (!actionButton) {
                if (!target.closest('.feature-library-row__details')) toggleDetails()
                return
            }
            const action = actionButton.dataset.action
            if (action === 'use') {
                const inserted = onUseFeature?.(feature) ?? false
                if (!inserted) {
                    try {
                        await navigator.clipboard?.writeText(`/use ${feature.name}`)
                    } catch (clipboardError) {
                        console.warn('Failed to copy feature use command:', clipboardError)
                    }
                }
                setFeedback(inserted ? `Added @${feature.name} to the prompt.` : `Copied /use ${feature.name}.`)
            }
            else if (action === 'delete') {
                if (!window.confirm(`Delete "${feature.name}"?`)) return
                const nats = servicesStore.getData('nats')
                const token = await AuthService.getTokenSilently()
                await nats?.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.DELETE, { token, workspaceId, featureId: feature.featureId })
                allFeatures = allFeatures.filter((storedFeature) => storedFeature.featureId !== feature.featureId)
                if (selectedFeatureId === feature.featureId) selectedFeatureId = null
                renderFeatureList()
                setFeedback(`Deleted @${feature.name}.`)
            }
            else if (action === 'report') {
                const nats = servicesStore.getData('nats')
                const token = await AuthService.getTokenSilently()
                await nats?.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.REPORT_ABUSE, { token, workspaceId, featureId: feature.featureId })
                setFeedback(`Reported @${feature.name}.`)
            }
        })
        return rowEl
    }

    function open() {
        if (isOpen) return
        isOpen = true
        backdropEl = html`<div className="feature-library-backdrop"></div>` as HTMLElement
        backdropEl.addEventListener('click', close)
        paneEl.appendChild(backdropEl)

        panelEl = html`<div className="feature-library-panel nopan nowheel">
            <div className="feature-library-header">
                <div className="feature-library-header__title-group">
                    <span className="feature-library-header__title">Feature Library</span>
                    <span className="feature-library-feedback"></span>
                </div>
                <input type="text" className="feature-library-header__search" placeholder="Search features…" />
                <button type="button" className="feature-library-header__close">×</button>
            </div>
            <div className="feature-library-scope-tabs"></div>
            <div className="feature-library-body"></div>
            <div className="feature-library-footer">
                <button type="button" className="feature-library-footer__new-btn">+ Extract new</button>
            </div>
        </div>` as HTMLElement

        const searchInput = panelEl.querySelector('.feature-library-header__search') as HTMLInputElement
        searchInput.addEventListener('input', () => { searchQuery = searchInput.value; renderFeatureList() })
        panelEl.querySelector('.feature-library-header__close')!.addEventListener('click', close)

        const scopeTabsEl = panelEl.querySelector('.feature-library-scope-tabs') as HTMLElement
        for (const scope of SCOPES) {
            const btn = html`<button type="button" className=${`feature-library-scope-tab${currentScope === scope.key ? ' feature-library-scope-tab--active' : ''}`} data=${{ scope: scope.key }}>${scope.label}</button>` as HTMLButtonElement
            btn.addEventListener('click', () => {
                currentScope = scope.key
                scopeTabsEl.querySelectorAll('.feature-library-scope-tab').forEach((el) => el.classList.toggle('feature-library-scope-tab--active', (el as HTMLElement).dataset.scope === scope.key))
                loadFeatures()
            })
            scopeTabsEl.appendChild(btn)
        }

        panelEl.querySelector('.feature-library-footer__new-btn')!.addEventListener('click', () => {
            const id = crypto.randomUUID?.() ?? `run-${Date.now()}`
            onOpenExtractionTab(id); close()
        })

        paneEl.appendChild(panelEl)
        loadFeatures()

        if (!hasFeatureEventSubscriptions) {
            hasFeatureEventSubscriptions = true
            const nats = servicesStore.getData('nats')
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.CREATED, (data: any) => {
                if (!data?.feature) return
                if ('sampleImages' in data.feature) featureDetails.set(data.feature.featureId, data.feature as Feature)
                allFeatures = [toFeatureMeta(data.feature), ...allFeatures.filter((feature) => feature.featureId !== data.feature.featureId)]
                renderFeatureList()
            })
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.DELETED, (data: any) => { if (data?.featureId) { allFeatures = allFeatures.filter((f) => f.featureId !== data.featureId); renderFeatureList() } })
        }
    }

    function close() {
        if (!isOpen) return; isOpen = false
        panelEl?.remove(); backdropEl?.remove()
        panelEl = null; backdropEl = null
    }

    function toggle() { isOpen ? close() : open() }

    return { open, close, toggle }
}
