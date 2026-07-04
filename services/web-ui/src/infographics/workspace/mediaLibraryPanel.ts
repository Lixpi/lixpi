'use strict'

import { html } from '$src/utils/domTemplates.ts'
import { renderMarkdownStatic } from '$src/utils/markdownStreamRenderer.ts'
import {
    NATS_SUBJECTS,
    MEDIA_LIBRARY_BROWSE_ALL,
    FEATURE_SCOPE,
    type CanvasFeatureExtractionState,
    type Feature,
    type FeatureMeta,
    type MediaLibraryImageMeta,
    type MediaLibraryScope,
    type MediaLibraryVideoMeta,
} from '@lixpi/constants'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import MediaLibraryService from '$src/services/media-library-service.ts'
import { organizationStore } from '$src/stores/organizationStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { renderExtractionTabBody } from '$src/infographics/workspace/extractionTab.ts'
import { resolveMediaUrl } from '$src/utils/workspaceFileUrls.ts'

// Features are org-wide — a single scope. 'shared' (external sharing) is deferred.
const FEATURE_SCOPES: Array<{ key: string; label: string }> = [
    { key: FEATURE_SCOPE.ORGANIZATION, label: 'Organization' },
]

// Media display names often carry a file extension (e.g. "generated-image.png");
// artists don't care about extensions, so strip a trailing one for display.
function stripFileExtension(name: string): string {
    return name.replace(/\.[^./\\]+$/, '')
}

// Human-friendly file size — regular users shouldn't have to parse raw byte counts.
function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
    const mb = bytes / (1024 * 1024)
    if (mb >= 1) return `${mb.toFixed(1)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type MediaLibraryBrowseMode = MediaLibraryScope | typeof MEDIA_LIBRARY_BROWSE_ALL

// The renderer surfaces two of the right side panel's top-level modes. The third
// mode ('aiThreads') is owned by WorkspaceCanvas and never reaches this renderer.
export type MediaLibraryPanelMode = 'features' | 'media'

export type MediaLibraryPanelInstance = {
    // Root element the host mounts into the right side panel body.
    rootEl: HTMLElement
    mountInto: (hostEl: HTMLElement) => void
    setMode: (mode: MediaLibraryPanelMode) => void
    showExtractionRun: (extractionRunId: string) => void
    refresh: () => void
    unmount: () => void
    destroy: () => void
}

export type FeatureExtractionModelContext = {
    aiModel?: string
    aiImageModel?: string
}

export type FeatureExtractionModelControlsInstance = {
    dom: HTMLElement
    getModelContext: () => FeatureExtractionModelContext
    destroy: () => void
}

type MediaLibraryPanelOptions = {
    workspaceId: string
    onUseFeature?: (feature: FeatureMeta) => boolean
    onInsertImage?: (item: MediaLibraryImageMeta) => Promise<boolean>
    onInsertVideo?: (item: MediaLibraryVideoMeta) => Promise<boolean>
    getFeatureExtractionRuns?: () => CanvasFeatureExtractionState[]
    createFeatureExtractionModelControls?: (extractionRunId: string) => FeatureExtractionModelControlsInstance
    onConfirmFeatureExtraction?: (extractionRunId: string, bodyEl: HTMLElement, modelContext: FeatureExtractionModelContext) => void | Promise<void>
}

type FeatureDetailsState = Feature | { error: string }

type FeatureLibraryRowShellConfig = {
    className?: string
    data: Record<string, string>
    selected: boolean
    thumbEl: HTMLElement
    categoryLabel: string
    scopeLabel: string
    name: string
    summary: string
    actionEl?: HTMLElement
}

type FeatureLibraryRowShellInstance = {
    dom: HTMLElement
    destroy: () => void
}

class FeatureLibraryRowShell implements FeatureLibraryRowShellInstance {
    readonly dom: HTMLElement

    constructor(private readonly config: FeatureLibraryRowShellConfig) {
        this.dom = this.render()
    }

    private render(): HTMLElement {
        const rowClassName = `feature-library-row${this.config.className ? ` ${this.config.className}` : ''}${this.config.selected ? ' feature-library-row-selected' : ''}`
        return html`<article className=${rowClassName} data=${this.config.data} tabindex="0" aria-selected=${this.config.selected ? 'true' : 'false'} data-side-panel-no-drag="true">
            ${this.config.thumbEl}
            <div className="feature-library-row-info">
                <div className="feature-library-row-meta">
                    <span className="feature-library-row-category">${this.config.categoryLabel}</span>
                    ${this.config.scopeLabel ? html`<span className="feature-library-row-scope">${this.config.scopeLabel}</span>` : null}
                </div>
                <div className="feature-library-row-name">${this.config.name}</div>
                <div className="feature-library-row-summary">${this.config.summary}</div>
            </div>
            ${this.config.actionEl ?? null}
        </article>` as HTMLElement
    }

    destroy(): void {
        this.dom.remove()
    }
}

function createFeatureLibraryRowShell(config: FeatureLibraryRowShellConfig): FeatureLibraryRowShellInstance {
    return new FeatureLibraryRowShell(config)
}

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
    resolveMediaUrl(url, { apiBaseUrl: API_BASE_URL })

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

export function createMediaLibraryPanel(options: MediaLibraryPanelOptions): MediaLibraryPanelInstance {
    const { workspaceId, onUseFeature, onInsertImage, onInsertVideo, getFeatureExtractionRuns, createFeatureExtractionModelControls, onConfirmFeatureExtraction } = options
    const mediaLibraryService = new MediaLibraryService()
    let isMounted = false
    let mode: MediaLibraryPanelMode = 'features'
    // No scope filter in the UI — always browse everything the user can access.
    const browseMode: MediaLibraryBrowseMode = MEDIA_LIBRARY_BROWSE_ALL
    let allFeatures: FeatureMeta[] = []
    let allImages: MediaLibraryImageMeta[] = []
    let allVideos: MediaLibraryVideoMeta[] = []
    let isLoading = false
    let errorMessage = ''
    let feedbackMessage = ''
    let accessToken = ''
    let selectedFeatureId: string | null = null
    let selectedExtractionRunId: string | null = null
    const featureDetails = new Map<string, FeatureDetailsState>()
    const loadingFeatureDetails = new Set<string>()
    let panelEl: HTMLElement | null = null
    let hasFeatureEventSubscriptions = false
    let hasMediaEventSubscriptions = false
    // Track which surface's data is in memory and for which browse scope, so a
    // re-mount or mode re-entry renders cached rows instead of flashing through a
    // loading state and refetching every time.
    let loadedFeaturesBrowseMode: MediaLibraryBrowseMode | null = null
    let loadedMediaBrowseMode: MediaLibraryBrowseMode | null = null
    // Transient extraction-model controls are rebuilt on every renderContent and
    // must be destroyed to detach their popovers and document listeners.
    let transientExtractionModelControls: FeatureExtractionModelControlsInstance[] = []

    function destroyTransientDropdowns() {
        for (const controls of transientExtractionModelControls) controls.destroy()
        transientExtractionModelControls = []
    }

    function trackTransientExtractionModelControls(controls: FeatureExtractionModelControlsInstance): FeatureExtractionModelControlsInstance {
        transientExtractionModelControls.push(controls)
        return controls
    }

    async function loadFeatures() {
        isLoading = true
        errorMessage = ''
        renderContent()
        try {
            const nats = servicesStore.getData('nats')
            if (!nats) {
                errorMessage = 'Feature library is offline.'
                return
            }
            const token = await AuthService.getTokenSilently()
            accessToken = token
            const organizationId = organizationStore.getData('organizationId') || undefined
            const results = await Promise.all(FEATURE_SCOPES.map((scope) =>
                nats.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.LIST_BY_SCOPE, {
                    token,
                    workspaceId,
                    organizationId,
                    scope: scope.key,
                }),
            ))
            allFeatures = results.flatMap((result) => result?.items ?? [])
            loadedFeaturesBrowseMode = browseMode
        } catch (e) {
            console.error('Failed to load features:', e)
            errorMessage = 'Could not load features.'
        } finally {
            isLoading = false
            renderContent()
        }
    }

    // Media mode colocates saved images and videos, so both lists load together.
    async function loadMedia() {
        isLoading = true
        errorMessage = ''
        renderContent()
        try {
            accessToken = await AuthService.getTokenSilently()
            const [images, videos] = await Promise.all([
                mediaLibraryService.listImages(),
                mediaLibraryService.listVideos(),
            ])
            allImages = images
            allVideos = videos
            loadedMediaBrowseMode = browseMode
        } catch (e) {
            console.error('Failed to load Media Library items:', e)
            errorMessage = 'Could not load media.'
        } finally {
            isLoading = false
            renderContent()
        }
    }

    function loadActiveMode() {
        return mode === 'features' ? loadFeatures() : loadMedia()
    }

    // True when the current surface already has rows in memory for the active
    // browse scope, so we can render cached content instead of reloading.
    function hasFreshDataForMode(): boolean {
        return mode === 'features'
            ? loadedFeaturesBrowseMode === browseMode
            : loadedMediaBrowseMode === browseMode
    }

    function setFeedback(message: string) {
        feedbackMessage = message
        const feedbackEl = panelEl?.querySelector('.media-library-feedback') as HTMLElement | null
        if (feedbackEl) feedbackEl.textContent = feedbackMessage
    }

    function appendImageAuth(url: string): string {
        return resolveMediaUrl(url, { apiBaseUrl: API_BASE_URL, token: accessToken })
    }

    function getStoredSampleUrl(feature: FeatureMeta, sampleIndex: number): string {
        const params = new URLSearchParams({ workspaceId, token: accessToken })
        const organizationId = organizationStore.getData('organizationId')
        if (organizationId) params.set('organizationId', organizationId)
        return withApiBaseUrl(`/api/features/${feature.featureId}/samples/${sampleIndex}?${params.toString()}`)
    }

    function getSampleUrl(feature: FeatureMeta, sampleIndex = 0): string {
        const details = featureDetails.get(feature.featureId)
        const featureSample = isFeatureDetails(details) ? details.sampleImages?.find((sample) => sample.idx === sampleIndex) ?? details.sampleImages?.[sampleIndex] : undefined
        if (sampleIndex === 0 && feature.sampleZeroUrl) return appendImageAuth(feature.sampleZeroUrl)
        if (featureSample?.imageUrl) return appendImageAuth(featureSample.imageUrl)
        return getStoredSampleUrl(feature, sampleIndex)
    }

    function handleSampleImageError(event: Event, feature: FeatureMeta, sampleIndex = 0) {
        const imageEl = event.currentTarget as HTMLImageElement
        if (imageEl.dataset.sampleFallbackTried === 'true') {
            imageEl.replaceWith(
                imageEl.classList.contains('feature-library-row-thumb')
                    ? html`<div className="feature-library-row-thumb-placeholder" aria-hidden="true"></div>` as HTMLElement
                    : html`<div className="feature-library-row-detail-empty">Sample image could not be loaded.</div>` as HTMLElement,
            )
            return
        }
        imageEl.dataset.sampleFallbackTried = 'true'
        imageEl.src = getStoredSampleUrl(feature, sampleIndex)
    }

    function getExtractionRunsForPanel(): CanvasFeatureExtractionState[] {
        return (getFeatureExtractionRuns?.() ?? [])
            .filter((run) => run.status !== 'completed' || run.extractionRunId === selectedExtractionRunId)
            .sort((a, b) => b.updatedAt - a.updatedAt)
    }

    function getExtractionRunState(extractionRunId: string): CanvasFeatureExtractionState | undefined {
        return (getFeatureExtractionRuns?.() ?? []).find((run) => run.extractionRunId === extractionRunId)
    }

    function isTerminalExtractionStatus(status: CanvasFeatureExtractionState['status'] | undefined): boolean {
        return status === 'completed' || status === 'failed'
    }

    function shouldDeferFeatureListRenderForActiveExtraction(): boolean {
        if (!selectedExtractionRunId) return false
        const extractionRun = getExtractionRunState(selectedExtractionRunId)
        return Boolean(extractionRun && !isTerminalExtractionStatus(extractionRun.status))
    }

    function renderAfterFeatureLibraryEvent(): void {
        if (!isMounted || mode !== 'features') return
        if (shouldDeferFeatureListRenderForActiveExtraction()) return
        renderContent()
    }

    function getExtractionStatusLabel(status: CanvasFeatureExtractionState['status']): string {
        switch (status) {
            case 'pending': return 'Needs confirmation'
            case 'analyzing': return 'Analyzing'
            case 'routing': return 'Routing'
            case 'extracting':
            case 'extracting_axes': return 'Extracting'
            case 'materializing_crops': return 'Cropping'
            case 'synthesizing': return 'Synthesizing'
            case 'generating_samples': return 'Sampling'
            case 'saving': return 'Saving'
            case 'completed': return 'Saved'
            case 'failed': return 'Failed'
            default: return 'Running'
        }
    }

    function getExtractionRunTitle(run: CanvasFeatureExtractionState): string {
        const featureName = typeof run.featureCard?.name === 'string' ? run.featureCard.name.trim() : ''
        if (featureName) return `@${featureName}`
        const userText = run.userText?.trim()
        if (userText) return userText.length > 52 ? `${userText.slice(0, 49)}...` : userText
        return 'Pending extracted feature'
    }

    function getExtractionRunSummary(run: CanvasFeatureExtractionState): string {
        if (run.status === 'pending') return 'Confirm to start extraction from the selected source.'
        if (run.status === 'failed') return run.error ? `Failed: ${run.error}` : 'Extraction failed.'
        if (run.status === 'completed') return run.featureCard?.summary ?? 'Feature saved to the library.'
        return 'Feature extraction is running. Progress renders in the inspector.'
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
            const organizationId = organizationStore.getData('organizationId') || undefined
            const result = await nats.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.GET, { token, workspaceId, organizationId, featureId })
            featureDetails.set(featureId, result?.error ? { error: result.error } : result as Feature)
        } catch (error) {
            console.error('Failed to load feature details:', error)
            featureDetails.set(featureId, { error: 'Could not load feature details.' })
        } finally {
            loadingFeatureDetails.delete(featureId)
            renderContent()
        }
    }

    function renderContent() {
        if (!panelEl) return
        const browserEl = panelEl.querySelector('.media-library-browser') as HTMLElement
        const inspectorEl = panelEl.querySelector('.media-library-inspector') as HTMLElement
        if (!browserEl || !inspectorEl) return
        destroyTransientDropdowns()
        browserEl.replaceChildren()
        inspectorEl.replaceChildren()
        const showingFeatures = mode === 'features'
        const extractionRuns = showingFeatures ? getExtractionRunsForPanel() : []
        panelEl.classList.toggle('media-library-panel-images', !showingFeatures)
        panelEl.classList.toggle('media-library-panel-feature-selected', showingFeatures && (selectedFeatureId !== null || selectedExtractionRunId !== null))
        panelEl.classList.toggle('media-library-panel-extraction-selected', showingFeatures && selectedExtractionRunId !== null)
        if (isLoading && (!showingFeatures || extractionRuns.length === 0)) {
            browserEl.appendChild(html`<div className="media-library-state">Loading ${showingFeatures ? 'features' : 'media'}</div>` as HTMLElement)
            return
        }
        if (errorMessage && (!showingFeatures || extractionRuns.length === 0)) {
            browserEl.appendChild(html`<div className="media-library-state media-library-state-error">${errorMessage}</div>` as HTMLElement)
            return
        }
        if (mode === 'media') {
            browserEl.appendChild(html`<div className="media-library-browser-intro">
                <h2>Media</h2>
                <p>Saved images and videos you can add back to the canvas. Hover a video to preview.</p>
            </div>` as HTMLElement)
            browserEl.appendChild(html`<h3 className="media-library-media-group-title">Images</h3>` as HTMLElement)
            renderImages(browserEl)
            browserEl.appendChild(html`<h3 className="media-library-media-group-title">Videos</h3>` as HTMLElement)
            renderVideos(browserEl)
            return
        }
        browserEl.appendChild(html`<div className="media-library-browser-intro">
            <h2>Features</h2>
            <p>Reusable visual properties extracted from images. Select one to inspect its guidance and samples.</p>
        </div>` as HTMLElement)
        if (allFeatures.length === 0 && extractionRuns.length === 0) {
            browserEl.appendChild(html`<div className="media-library-state">No features found.</div>` as HTMLElement)
        }

        if (extractionRuns.length > 0) {
            const extractionSectionEl = html`<div className="feature-library-section feature-extraction-section">
                <div className="feature-library-section-header">Feature extraction</div>
                <div className="feature-library-section-items"></div>
            </div>` as HTMLElement
            const itemsEl = extractionSectionEl.querySelector('.feature-library-section-items') as HTMLElement
            for (const run of extractionRuns) itemsEl.appendChild(buildExtractionRow(run))
            browserEl.appendChild(extractionSectionEl)
        }
        if (isLoading) {
            browserEl.appendChild(html`<div className="media-library-state">Loading saved features</div>` as HTMLElement)
        }
        if (errorMessage) {
            browserEl.appendChild(html`<div className="media-library-state media-library-state-error">${errorMessage}</div>` as HTMLElement)
        }

        const groups = new Map<string, FeatureMeta[]>()
        for (const feature of allFeatures) {
            const category = feature.category || 'other'
            if (!groups.has(category)) groups.set(category, [])
            groups.get(category)!.push(feature)
        }

        for (const [category, features] of groups) {
            const sectionEl = html`<div className="feature-library-section">
                <div className="feature-library-section-header">${category}</div>
                <div className="feature-library-section-items"></div>
            </div>` as HTMLElement
            const itemsEl = sectionEl.querySelector('.feature-library-section-items') as HTMLElement
            for (const feature of features) itemsEl.appendChild(buildRow(feature))
            browserEl.appendChild(sectionEl)
        }

        const selectedExtractionRun = selectedExtractionRunId ? getExtractionRunState(selectedExtractionRunId) : undefined
        const selectedFeature = selectedExtractionRun ? undefined : allFeatures.find((feature) => feature.featureId === selectedFeatureId)
        if (selectedExtractionRun) {
            inspectorEl.appendChild(buildExtractionInspector(selectedExtractionRun))
        } else if (selectedFeature) {
            inspectorEl.appendChild(buildFeatureInspector(selectedFeature))
        } else {
            selectedFeatureId = null
            selectedExtractionRunId = null
            panelEl.classList.remove('media-library-panel-feature-selected')
            panelEl.classList.remove('media-library-panel-extraction-selected')
            inspectorEl.appendChild(html`<div className="feature-library-inspector-empty">
                <strong>Select a Feature</strong>
                <span>Full instructions, palette details, samples, and sharing controls appear here.</span>
            </div>` as HTMLElement)
        }
    }

    function getImagePreviewUrl(item: MediaLibraryImageMeta): string {
        const params = new URLSearchParams({ workspaceId, token: accessToken })
        const organizationId = organizationStore.getData('organizationId')
        if (organizationId) params.set('organizationId', organizationId)
        return withApiBaseUrl(`${item.previewUrl}?${params.toString()}`)
    }

    function renderImages(listEl: HTMLElement) {
        if (allImages.length === 0) {
            listEl.appendChild(html`<div className="media-library-state">No images found.</div>` as HTMLElement)
            return
        }
        const imagesEl = html`<div className="media-library-images"></div>` as HTMLElement
        for (const item of allImages) imagesEl.appendChild(buildImageRow(item))
        listEl.appendChild(imagesEl)
    }

    function getVideoPreviewUrl(item: MediaLibraryVideoMeta): string {
        const params = new URLSearchParams({ workspaceId, token: accessToken })
        const organizationId = organizationStore.getData('organizationId')
        if (organizationId) params.set('organizationId', organizationId)
        return withApiBaseUrl(`${item.previewUrl}?${params.toString()}`)
    }

    function getVideoPosterUrl(item: MediaLibraryVideoMeta): string | null {
        if (!item.posterPreviewUrl) return null
        const params = new URLSearchParams({ workspaceId, token: accessToken })
        const organizationId = organizationStore.getData('organizationId')
        if (organizationId) params.set('organizationId', organizationId)
        return withApiBaseUrl(`${item.posterPreviewUrl}?${params.toString()}`)
    }

    function renderVideos(listEl: HTMLElement) {
        if (allVideos.length === 0) {
            listEl.appendChild(html`<div className="media-library-state">No videos found.</div>` as HTMLElement)
            return
        }
        const videosEl = html`<div className="media-library-videos"></div>` as HTMLElement
        for (const item of allVideos) videosEl.appendChild(buildVideoRow(item))
        listEl.appendChild(videosEl)
    }

    function buildVideoRow(item: MediaLibraryVideoMeta): HTMLElement {
        const posterUrl = getVideoPosterUrl(item)
        const dimensionsLabel = (typeof item.width === 'number' && typeof item.height === 'number')
            ? `${item.width} x ${item.height} pixels`
            : `${item.aspectRatio.toFixed(2)}:1`
        const rowEl = html`<article className="media-library-video">
            <div className="media-library-video-preview-wrap">
                ${posterUrl
                    ? html`<img className="media-library-video-poster" src=${posterUrl} alt=${item.displayName} />`
                    : html`<div className="media-library-video-poster media-library-video-poster-missing"></div>`}
                <video
                    className="media-library-video-preview"
                    src=${getVideoPreviewUrl(item)}
                    muted
                    playsinline
                    preload="metadata"
                    loop
                ></video>
            </div>
            <div className="media-library-video-copy">
                <strong className="media-library-video-name">${stripFileExtension(item.displayName)}</strong>
                <span className="media-library-video-metadata">${`${dimensionsLabel} | ${item.durationSeconds}s | ${formatFileSize(item.byteSize)}${item.hasAudio ? ' | audio' : ''}`}</span>
            </div>
            <div className="media-library-video-actions">
                <button type="button" data-action="insert">Add to canvas</button>
                <button type="button" data-action="delete">Delete</button>
            </div>
        </article>` as HTMLElement

        // Hover-to-play preview. Released playback is muted so it works without
        // user interaction; full-volume playback only happens after materialize.
        const videoEl = rowEl.querySelector('.media-library-video-preview') as HTMLVideoElement
        rowEl.addEventListener('mouseenter', () => { videoEl.play().catch(() => {}) })
        rowEl.addEventListener('mouseleave', () => { videoEl.pause(); videoEl.currentTime = 0 })

        rowEl.addEventListener('click', async (event) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
            if (!action) return
            if (action === 'insert') {
                const inserted = await onInsertVideo?.(item)
                setFeedback(inserted ? `Added ${item.displayName} to the canvas.` : `Could not add ${item.displayName} to the canvas.`)
                return
            }
            if (action === 'delete') {
                if (!window.confirm(`Delete "${item.displayName}"?`)) return
                const response = await mediaLibraryService.deleteItem(item.itemId)
                if (response.error) {
                    setFeedback(`Could not delete ${item.displayName}.`)
                    return
                }
                allVideos = allVideos.filter((storedItem) => storedItem.itemId !== item.itemId)
                renderContent()
                setFeedback(`Deleted ${item.displayName}.`)
                return
            }
        })
        return rowEl
    }

    function buildImageRow(item: MediaLibraryImageMeta): HTMLElement {
        const rowEl = html`<article className="media-library-image">
            <img className="media-library-image-preview" src=${getImagePreviewUrl(item)} alt=${item.displayName} />
            <div className="media-library-image-copy">
                <strong className="media-library-image-name">${stripFileExtension(item.displayName)}</strong>
                <span className="media-library-image-metadata">${`${item.width} x ${item.height} pixels | ${formatFileSize(item.byteSize)}`}</span>
            </div>
            <div className="media-library-image-actions">
                <button type="button" data-action="insert">Add to canvas</button>
                <button type="button" data-action="delete">Delete</button>
            </div>
        </article>` as HTMLElement

        rowEl.addEventListener('click', async (event) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
            if (!action) return
            if (action === 'insert') {
                const inserted = await onInsertImage?.(item)
                setFeedback(inserted ? `Added ${item.displayName} to the canvas.` : `Could not add ${item.displayName} to the canvas.`)
                return
            }
            if (action === 'delete') {
                if (!window.confirm(`Delete "${item.displayName}"?`)) return
                const response = await mediaLibraryService.deleteImage(item.itemId)
                if (response.error) {
                    setFeedback(`Could not delete ${item.displayName}.`)
                    return
                }
                allImages = allImages.filter((storedItem) => storedItem.itemId !== item.itemId)
                renderContent()
                setFeedback(`Deleted ${item.displayName}.`)
                return
            }
        })
        return rowEl
    }

    function buildPaletteDetails(colors: PaletteColor[]): HTMLElement {
        const paletteEl = html`<div className="feature-library-palette">
            <div className="feature-library-palette-title">Palette breakdown</div>
            <div className="feature-library-palette-swatches"></div>
            <div className="feature-library-palette-list"></div>
        </div>` as HTMLElement

        const swatchesEl = paletteEl.querySelector('.feature-library-palette-swatches') as HTMLElement
        const listEl = paletteEl.querySelector('.feature-library-palette-list') as HTMLElement
        for (const color of colors) {
            const swatchStyle = { backgroundColor: color.hex }
            swatchesEl.appendChild(html`<span className="feature-library-palette-swatch" style=${swatchStyle} title=${`${color.name} ${color.hex}`}></span>` as HTMLElement)
            listEl.appendChild(html`<div className="feature-library-palette-color">
                <span className="feature-library-palette-chip" style=${swatchStyle}></span>
                <div className="feature-library-palette-color-copy">
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
        // Render instructions through the unified markdown renderer, not as raw text.
        const wrapEl = html`<div className="feature-library-instructions">
            <div className="feature-library-instructions-title">Application notes</div>
        </div>` as HTMLElement
        wrapEl.appendChild(renderMarkdownStatic(feature.instructions, `feature:${feature.featureId}`, 'feature-library-instructions-body lixpi-markdown'))
        return wrapEl
    }

    function buildSampleGallery(feature: FeatureMeta, details: FeatureDetailsState | undefined): HTMLElement {
        const samples = isFeatureDetails(details) ? details.sampleImages ?? [] : []
        const galleryEl = html`<div className="feature-library-row-samples"></div>` as HTMLElement
        if (samples.length === 0) {
            if (feature.sampleZeroKey && accessToken) {
                galleryEl.appendChild(html`<img className="feature-library-row-detail-image" src=${getSampleUrl(feature)} alt=${`${feature.name} sample preview`} onerror=${(event: Event) => handleSampleImageError(event, feature)} />` as HTMLElement)
                return galleryEl
            }
            galleryEl.appendChild(html`<div className="feature-library-row-detail-empty">No sample image saved.</div>` as HTMLElement)
            return galleryEl
        }

        for (const sample of samples) {
            galleryEl.appendChild(html`<figure className="feature-library-row-sample-card">
                <img className="feature-library-row-sample-image" src=${getSampleUrl(feature, sample.idx)} alt=${sample.subject || `${feature.name} sample ${sample.idx + 1}`} onerror=${(event: Event) => handleSampleImageError(event, feature, sample.idx)} />
                <figcaption>${sample.subject || `Sample ${sample.idx + 1}`}</figcaption>
            </figure>` as HTMLElement)
        }
        return galleryEl
    }

    async function handleUseFeature(feature: FeatureMeta) {
        const inserted = onUseFeature?.(feature) ?? false
        if (!inserted) {
            try {
                await navigator.clipboard?.writeText(`/use ${feature.name}`)
            } catch (clipboardError) {
                console.warn('Failed to copy feature use command:', clipboardError)
            }
        }
        setFeedback(inserted ? `Added feature:${feature.name} to the prompt.` : `Copied /use ${feature.name}.`)
    }

    async function deleteFeature(feature: FeatureMeta) {
        if (!window.confirm(`Delete "${feature.name}"?`)) return
        const nats = servicesStore.getData('nats')
        const token = await AuthService.getTokenSilently()
        const organizationId = organizationStore.getData('organizationId') || undefined
        const response = await nats?.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.DELETE, { token, workspaceId, organizationId, featureId: feature.featureId })
        if (response?.error) {
            setFeedback(`Could not delete @${feature.name}.`)
            return
        }
        allFeatures = allFeatures.filter((storedFeature) => storedFeature.featureId !== feature.featureId)
        featureDetails.delete(feature.featureId)
        if (selectedFeatureId === feature.featureId) selectedFeatureId = null
        renderContent()
        setFeedback(`Deleted @${feature.name}.`)
    }

    function selectExtractionRun(extractionRunId: string): void {
        selectedExtractionRunId = extractionRunId
        selectedFeatureId = null
        renderContent()
    }

    function getExtractionRunFeatureId(run: CanvasFeatureExtractionState): string | undefined {
        if (run.featureId) return run.featureId
        return typeof run.featureCard?.featureId === 'string' ? run.featureCard.featureId : undefined
    }

    function getFeatureMetaFromExtractionRun(run: CanvasFeatureExtractionState): FeatureMeta | undefined {
        const featureCard = run.featureCard
        const featureId = getExtractionRunFeatureId(run)
        if (!featureId || !featureCard) return undefined

        const firstSample = Array.isArray(featureCard.sampleImages) ? featureCard.sampleImages[0] : undefined
        const scope = FEATURE_SCOPE.ORGANIZATION
        const ownerUserId = userStore.getData('userId') || ''
        const scopeOwnerId = organizationStore.getData('organizationId') || ''
        return {
            featureId,
            category: textValue(featureCard.category) ?? 'other',
            name: textValue(featureCard.name) ?? 'Extracted feature',
            summary: textValue(featureCard.summary) ?? 'Feature saved to the library.',
            tags: Array.isArray(featureCard.tags) ? featureCard.tags.map((tag) => String(tag)) : [],
            scope,
            scopeOwnerId,
            status: 'active',
            ownerUserId,
            sampleZeroKey: textValue(firstSample?.fileId) ?? (firstSample?.idx != null && firstSample?.ext ? `features/${featureId}/sample-${firstSample.idx}.${firstSample.ext}` : undefined),
            sampleZeroUrl: textValue(firstSample?.imageUrl),
            updatedAt: run.updatedAt,
        }
    }

    function openExtractionRun(run: CanvasFeatureExtractionState): void {
        const featureId = getExtractionRunFeatureId(run)
        if (run.status === 'completed' && featureId) {
            const hasFeatureRow = allFeatures.some((feature) => feature.featureId === featureId)
            const featureMeta = hasFeatureRow ? undefined : getFeatureMetaFromExtractionRun(run)
            if (featureMeta) allFeatures = [featureMeta, ...allFeatures]
            selectedFeatureId = featureId
            selectedExtractionRunId = null
            void ensureFeatureDetails(featureId)
            renderContent()
            return
        }

        selectExtractionRun(run.extractionRunId)
    }

    function buildExtractionRow(run: CanvasFeatureExtractionState): HTMLElement {
        const isSelected = selectedExtractionRunId === run.extractionRunId
        const thumbEl = html`<div className="feature-extraction-row-thumb" aria-hidden="true">
                <span className="feature-extraction-row-thumb-mark"></span>
            </div>` as HTMLElement
        const rowEl = createFeatureLibraryRowShell({
            className: `feature-extraction-row feature-extraction-row-${run.status}`,
            data: { extractionRunId: run.extractionRunId },
            selected: isSelected,
            thumbEl,
            categoryLabel: 'extracting',
            scopeLabel: getExtractionStatusLabel(run.status),
            name: getExtractionRunTitle(run),
            summary: getExtractionRunSummary(run),
        }).dom

        const openRun = () => openExtractionRun(run)
        rowEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            openRun()
        })
        rowEl.addEventListener('click', () => openRun())
        return rowEl
    }

    function buildExtractionConfirmation(run: CanvasFeatureExtractionState, pipelineMountEl: HTMLElement): HTMLElement {
        const modelControls = createFeatureExtractionModelControls
            ? trackTransientExtractionModelControls(createFeatureExtractionModelControls(run.extractionRunId))
            : undefined
        const confirmationEl = html`<section className="feature-extraction-confirmation">
            <div className="feature-extraction-confirmation-copy">
                <h3>Confirm Feature Extraction</h3>
                <p>Lixpi will analyze the selected source and connected context, generate source-safe feature samples, then save a reusable workspace Feature.</p>
                <p>The source stays on the canvas. The resulting Feature appears in this tab when the pipeline finishes.</p>
            </div>
            ${modelControls?.dom ?? null}
            <button type="button" className="feature-extraction-confirm-button">Start extraction</button>
        </section>` as HTMLElement
        const buttonEl = confirmationEl.querySelector('.feature-extraction-confirm-button') as HTMLButtonElement
        buttonEl.addEventListener('click', () => {
            buttonEl.disabled = true
            buttonEl.textContent = 'Starting...'
            void onConfirmFeatureExtraction?.(run.extractionRunId, pipelineMountEl, modelControls?.getModelContext() ?? {})
            confirmationEl.classList.add('feature-extraction-confirmation-started')
        })
        return confirmationEl
    }

    function buildExtractionInspector(run: CanvasFeatureExtractionState): HTMLElement {
        const inspectorEl = html`<article className="feature-library-inspector-card feature-extraction-inspector">
            <div className="feature-library-inspector-nav">
                <button type="button" className="feature-library-inspector-back">Back</button>
                <span>Feature extraction</span>
            </div>
            <div className="feature-library-inspector-heading">
                <div className="feature-library-row-meta">
                    <span className="feature-library-row-category">extraction</span>
                    <span className="feature-library-row-scope">${getExtractionStatusLabel(run.status)}</span>
                </div>
                <h2>${getExtractionRunTitle(run)}</h2>
                <p>${getExtractionRunSummary(run)}</p>
            </div>
            <div className="feature-extraction-confirmation-mount"></div>
            <div className="feature-extraction-pipeline-mount"></div>
        </article>` as HTMLElement

        inspectorEl.querySelector('.feature-library-inspector-back')!.addEventListener('click', () => {
            selectedExtractionRunId = null
            renderContent()
        })

        const pipelineMountEl = inspectorEl.querySelector('.feature-extraction-pipeline-mount') as HTMLElement
        if (run.status === 'pending') {
            const confirmationMountEl = inspectorEl.querySelector('.feature-extraction-confirmation-mount') as HTMLElement
            confirmationMountEl.appendChild(buildExtractionConfirmation(run, pipelineMountEl))
        } else {
            renderExtractionTabBody(`feature-extraction:${run.extractionRunId}`, run.extractionRunId, pipelineMountEl, workspaceId, {
                getState: getExtractionRunState,
                surface: 'feature',
            })
        }
        return inspectorEl
    }

    function buildRow(feature: FeatureMeta): HTMLElement {
        const isSelected = selectedFeatureId === feature.featureId
        const thumbEl = feature.sampleZeroKey && accessToken
            ? html`<img className="feature-library-row-thumb" src=${getSampleUrl(feature)} alt=${`${feature.name} sample`} onerror=${(event: Event) => handleSampleImageError(event, feature)} />` as HTMLElement
            : html`<div className="feature-library-row-thumb-placeholder" aria-hidden="true"></div>` as HTMLElement
        const actionEl = html`<button type="button" className="feature-library-row-action feature-library-row-action-primary" data-action="use">Use</button>` as HTMLElement
        const rowEl = createFeatureLibraryRowShell({
            data: { featureId: feature.featureId },
            selected: isSelected,
            thumbEl,
            categoryLabel: feature.category || 'feature',
            scopeLabel: '',
            name: `@${feature.name}`,
            summary: feature.summary,
            actionEl,
        }).dom

        const selectFeature = () => {
            selectedFeatureId = feature.featureId
            selectedExtractionRunId = null
            void ensureFeatureDetails(feature.featureId)
            renderContent()
        }
        rowEl.addEventListener('keydown', (event) => {
            if (event.target instanceof HTMLElement && event.target.closest('[data-action]')) return
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            selectFeature()
        })
        rowEl.addEventListener('click', (event) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
            if (action === 'use') {
                selectFeature()
                void handleUseFeature(feature)
                return
            }
            selectFeature()
        })
        return rowEl
    }

    function buildFeatureInspector(feature: FeatureMeta): HTMLElement {
        const details = featureDetails.get(feature.featureId)
        const inspectorEl = html`<article className="feature-library-inspector-card">
            <div className="feature-library-inspector-nav">
                <button type="button" className="feature-library-inspector-back">Back</button>
                <span>Feature details</span>
            </div>
            <div className="feature-library-inspector-heading">
                <div className="feature-library-row-meta">
                    <span className="feature-library-row-category">${feature.category || 'feature'}</span>
                </div>
                <h2>@${feature.name}</h2>
                <p>${feature.summary || 'No summary stored.'}</p>
            </div>
            <div className="feature-library-inspector-actions">
                <button type="button" className="feature-library-row-action feature-library-row-action-primary" data-action="use">Use Feature</button>
            </div>
            <div className="feature-library-row-detail-status">${loadingFeatureDetails.has(feature.featureId) ? 'Loading full feature details' : details && 'error' in details ? details.error : ''}</div>
            <div className="feature-library-row-samples-mount"></div>
            <div className="feature-library-row-palette-mount"></div>
            <div className="feature-library-row-instructions-mount"></div>
            <div className="feature-library-row-detail-tags"></div>
            <div className="feature-library-inspector-danger-zone">
                <button type="button" className="feature-library-row-action feature-library-row-action-danger" data-action="delete">Delete feature</button>
            </div>
        </article>` as HTMLElement

        inspectorEl.querySelector('.feature-library-inspector-back')!.addEventListener('click', () => {
            selectedFeatureId = null
            renderContent()
        })
        inspectorEl.querySelector('.feature-library-inspector-actions')!.addEventListener('click', (event) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
            if (action === 'use') void handleUseFeature(feature)
        })
        inspectorEl.querySelector('.feature-library-inspector-danger-zone [data-action="delete"]')!.addEventListener('click', () => void deleteFeature(feature))

        const samplesMount = inspectorEl.querySelector('.feature-library-row-samples-mount') as HTMLElement
        samplesMount.appendChild(buildSampleGallery(feature, details))
        if (isFeatureDetails(details)) {
            const colors = getPaletteColors(details)
            const paletteMount = inspectorEl.querySelector('.feature-library-row-palette-mount') as HTMLElement
            if (colors.length > 0) paletteMount.appendChild(buildPaletteDetails(colors))
            else if (feature.category === 'color-palette') paletteMount.appendChild(html`<div className="feature-library-row-detail-empty">No structured palette colors saved.</div>` as HTMLElement)
            const instructionsPreview = buildInstructionsPreview(details)
            const instructionsMount = inspectorEl.querySelector('.feature-library-row-instructions-mount') as HTMLElement
            if (instructionsPreview) instructionsMount.appendChild(instructionsPreview)
        }
        const tagsEl = inspectorEl.querySelector('.feature-library-row-detail-tags') as HTMLElement
        const tags = feature.tags ?? []
        if (tags.length === 0) tagsEl.appendChild(html`<span className="feature-library-row-detail-empty">No tags.</span>` as HTMLElement)
        for (const tag of tags) tagsEl.appendChild(html`<span className="feature-library-row-tag">${tag}</span>` as HTMLElement)
        return inspectorEl
    }

    function ensureEventSubscriptions() {
        if (!hasFeatureEventSubscriptions) {
            hasFeatureEventSubscriptions = true
            const nats = servicesStore.getData('nats')
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.CREATED, (data: any) => {
                if (!data?.feature) return
                if ('sampleImages' in data.feature) featureDetails.set(data.feature.featureId, data.feature as Feature)
                allFeatures = [toFeatureMeta(data.feature), ...allFeatures.filter((feature) => feature.featureId !== data.feature.featureId)]
                renderAfterFeatureLibraryEvent()
            })
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.DELETED, (data: any) => {
                if (!data?.featureId) return
                allFeatures = allFeatures.filter((f) => f.featureId !== data.featureId)
                renderAfterFeatureLibraryEvent()
            })
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.UPDATED, () => {
                if (!isMounted || mode !== 'features') return
                if (shouldDeferFeatureListRenderForActiveExtraction()) return
                void loadFeatures()
            })
        }
        if (!hasMediaEventSubscriptions) {
            hasMediaEventSubscriptions = true
            const nats = servicesStore.getData('nats')
            for (const subject of [
                NATS_SUBJECTS.WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS.EVENTS.CREATED,
                NATS_SUBJECTS.WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS.EVENTS.DELETED,
            ]) {
                nats?.subscribe(subject, () => {
                    // Invalidate the cached media list so the next time the Media tab is
                    // shown it refetches — an item added from the canvas while another tab
                    // is active must still appear without a page reload.
                    loadedMediaBrowseMode = null
                    if (isMounted && mode === 'media') void loadMedia()
                })
            }
        }
    }

    // Build the embedded DOM once. The right side panel hosts this root element;
    // the top-level Features / Media / AI Threads switch lives in the host above it.
    function build() {
        if (panelEl) return
        panelEl = html`<div className="media-library-panel media-library-panel-embedded nopan nowheel">
            <div className="media-library-controls">
                <span className="media-library-feedback"></span>
            </div>
            <div className="media-library-body">
                <section className="media-library-browser"></section>
                <aside className="media-library-inspector"></aside>
            </div>
        </div>` as HTMLElement

        ensureEventSubscriptions()
    }

    // Render the active surface: reuse in-memory rows when they are fresh,
    // otherwise reload (which shows the loading state). Set the mode first so a
    // freshly mounted panel does not flash the previous surface.
    function refreshActiveMode() {
        const hasFreshData = hasFreshDataForMode()
        if (hasFreshData) renderContent()
        else void loadActiveMode()
    }

    function mountInto(hostEl: HTMLElement) {
        build()
        if (panelEl && panelEl.parentElement !== hostEl) hostEl.appendChild(panelEl)
        isMounted = true
        refreshActiveMode()
    }

    function setMode(nextMode: MediaLibraryPanelMode) {
        if (mode === nextMode && isMounted) return
        mode = nextMode
        selectedFeatureId = null
        if (nextMode !== 'features') selectedExtractionRunId = null
        if (isMounted) refreshActiveMode()
    }

    function showExtractionRun(extractionRunId: string) {
        mode = 'features'
        selectedExtractionRunId = extractionRunId
        selectedFeatureId = null
        if (isMounted) refreshActiveMode()
    }

    function refresh() {
        if (isMounted) refreshActiveMode()
    }

    function unmount() {
        isMounted = false
        panelEl?.remove()
    }

    function destroy() {
        unmount()
        destroyTransientDropdowns()
        panelEl = null
    }

    return { get rootEl() { build(); return panelEl! }, mountInto, setMode, showExtractionRun, refresh, unmount, destroy }
}
