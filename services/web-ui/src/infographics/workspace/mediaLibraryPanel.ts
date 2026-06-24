'use strict'

import { html } from '$src/utils/domTemplates.ts'
import { renderMarkdownStatic } from '$src/utils/markdownStreamRenderer.ts'
import {
    NATS_SUBJECTS,
    MEDIA_LIBRARY_BROWSE_ALL,
    MEDIA_LIBRARY_SCOPE,
    type Feature,
    type FeatureMeta,
    type MediaLibraryImageMeta,
    type MediaLibraryScope,
    type MediaLibraryVideoMeta,
} from '@lixpi/constants'
import { createPureDropdown } from '$src/components/dropdown/index.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import AuthService from '$src/services/auth-service.ts'
import MediaLibraryService from '$src/services/media-library-service.ts'
import { organizationStore } from '$src/stores/organizationStore.ts'
import { userStore } from '$src/stores/userStore.ts'

const SCOPES: Array<{ key: MediaLibraryScope; label: string }> = [
    { key: MEDIA_LIBRARY_SCOPE.WORKSPACE, label: 'Workspace' },
    { key: MEDIA_LIBRARY_SCOPE.USER, label: 'Mine' },
    { key: MEDIA_LIBRARY_SCOPE.ORGANIZATION, label: 'Organization' },
    { key: MEDIA_LIBRARY_SCOPE.PUBLIC, label: 'Public' },
]

type MediaLibraryBrowseMode = MediaLibraryScope | typeof MEDIA_LIBRARY_BROWSE_ALL

// The renderer surfaces two of the right side panel's top-level modes. The third
// mode ('aiThreads') is owned by WorkspaceCanvas and never reaches this renderer.
export type MediaLibraryPanelMode = 'features' | 'media'

export type MediaLibraryPanelInstance = {
    // Root element the host mounts into the right side panel body.
    rootEl: HTMLElement
    mountInto: (hostEl: HTMLElement) => void
    setMode: (mode: MediaLibraryPanelMode) => void
    unmount: () => void
    destroy: () => void
}

type MediaLibraryPanelOptions = {
    workspaceId: string
    onUseFeature?: (feature: FeatureMeta) => boolean
    onInsertImage?: (item: MediaLibraryImageMeta) => Promise<boolean>
    onInsertVideo?: (item: MediaLibraryVideoMeta) => Promise<boolean>
}

type FeatureDetailsState = Feature | { error: string }

type ScopeDropdownOption = { key: string; label: string }

type ScopeDropdownInstance = {
    dom: HTMLElement
    setSelectedKey: (key: string) => void
    destroy: () => void
}

// Wrap the shared dropdown primitive so callers work in terms of scope keys
// instead of option objects. Replaces the native <select> controls that looked
// out of place on non-mac platforms.
function createScopeDropdown(config: {
    id: string
    options: ScopeDropdownOption[]
    selectedKey: string
    onSelect: (key: string) => void
}): ScopeDropdownInstance {
    const dropdownOptions = config.options.map((option) => ({ title: option.label, key: option.key }))
    const findOption = (key: string) => dropdownOptions.find((option) => option.key === key) ?? dropdownOptions[0]
    const dropdown = createPureDropdown({
        id: config.id,
        // Match the AI model selector dropdown exactly.
        theme: 'dark',
        ignoreColorValuesForOptions: true,
        renderIconForSelectedValue: false,
        renderIconForOptions: false,
        selectedValue: findOption(config.selectedKey),
        options: dropdownOptions,
        onSelect: (option) => config.onSelect(option.key),
    })
    return {
        dom: dropdown.dom,
        setSelectedKey: (key) => dropdown.update(findOption(key)),
        destroy: dropdown.destroy,
    }
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

export function createMediaLibraryPanel(options: MediaLibraryPanelOptions): MediaLibraryPanelInstance {
    const { workspaceId, onUseFeature, onInsertImage, onInsertVideo } = options
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
    // Row and inspector scope dropdowns are rebuilt on every renderContent and
    // must be destroyed to detach their popovers and document listeners.
    let transientDropdowns: ScopeDropdownInstance[] = []

    function destroyTransientDropdowns() {
        for (const dropdown of transientDropdowns) dropdown.destroy()
        transientDropdowns = []
    }

    function trackTransientDropdown(dropdown: ScopeDropdownInstance): ScopeDropdownInstance {
        transientDropdowns.push(dropdown)
        return dropdown
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
            const scopes = browseMode === MEDIA_LIBRARY_BROWSE_ALL
                ? SCOPES
                : SCOPES.filter((scope) => scope.key === browseMode)
            const results = await Promise.all(scopes.map((scope) =>
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
            const scopes = browseMode === MEDIA_LIBRARY_BROWSE_ALL
                ? Object.values(MEDIA_LIBRARY_SCOPE)
                : [browseMode]
            const includeAllAvailable = browseMode === MEDIA_LIBRARY_BROWSE_ALL
            const [images, videos] = await Promise.all([
                mediaLibraryService.listImages({ workspaceId, scopes, includeAllAvailable }),
                mediaLibraryService.listVideos({ workspaceId, scopes, includeAllAvailable }),
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
        const apiUrl = withApiBaseUrl(url)
        if (!accessToken) return apiUrl
        const separator = apiUrl.includes('?') ? '&' : '?'
        return `${apiUrl}${separator}${new URLSearchParams({ token: accessToken }).toString()}`
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
        panelEl.classList.toggle('media-library-panel-images', !showingFeatures)
        panelEl.classList.toggle('media-library-panel-feature-selected', showingFeatures && selectedFeatureId !== null)
        if (isLoading) {
            browserEl.appendChild(html`<div className="media-library-state">Loading ${showingFeatures ? 'features' : 'media'}</div>` as HTMLElement)
            return
        }
        if (errorMessage) {
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
        if (allFeatures.length === 0) {
            browserEl.appendChild(html`<div className="media-library-state">No features found.</div>` as HTMLElement)
        }

        const groups = new Map<string, FeatureMeta[]>()
        for (const feature of allFeatures) {
            const category = feature.category || 'other'
            if (!groups.has(category)) groups.set(category, [])
            groups.get(category)!.push(feature)
        }

        for (const [category, features] of groups) {
            const sectionEl = html`<div className="feature-library-section">
                <button type="button" className="feature-library-section-header">${category}</button>
                <div className="feature-library-section-items"></div>
            </div>` as HTMLElement
            const itemsEl = sectionEl.querySelector('.feature-library-section-items') as HTMLElement
            let collapsed = false
            sectionEl.querySelector('button')!.addEventListener('click', () => {
                collapsed = !collapsed
                itemsEl.hidden = collapsed
            })
            for (const feature of features) itemsEl.appendChild(buildRow(feature))
            browserEl.appendChild(sectionEl)
        }

        const selectedFeature = allFeatures.find((feature) => feature.featureId === selectedFeatureId)
        if (selectedFeature) {
            inspectorEl.appendChild(buildFeatureInspector(selectedFeature))
        } else {
            selectedFeatureId = null
            panelEl.classList.remove('media-library-panel-feature-selected')
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
                <strong className="media-library-video-name">${item.displayName}</strong>
                <span className="media-library-video-metadata">${`${dimensionsLabel} | ${item.durationSeconds}s | ${item.mimeType} | ${item.byteSize} bytes${item.hasAudio ? ' | audio' : ''}`}</span>
                <span className="media-library-video-scope">${`Scope: ${item.scope}`}</span>
            </div>
            <div className="media-library-video-actions">
                <button type="button" data-action="insert">Add to canvas</button>
                <label>Scope
                    <span className="media-library-video-scope-mount"></span>
                </label>
                <button type="button" data-action="delete">Delete</button>
            </div>
        </article>` as HTMLElement

        // Hover-to-play preview. Released playback is muted so it works without
        // user interaction; full-volume playback only happens after materialize.
        const videoEl = rowEl.querySelector('.media-library-video-preview') as HTMLVideoElement
        rowEl.addEventListener('mouseenter', () => { videoEl.play().catch(() => {}) })
        rowEl.addEventListener('mouseleave', () => { videoEl.pause(); videoEl.currentTime = 0 })

        const organizationId = organizationStore.getData('organizationId') || undefined
        const scopeOptions = SCOPES.filter((scope) => organizationId || scope.key !== MEDIA_LIBRARY_SCOPE.ORGANIZATION)
        const scopeDropdown = trackTransientDropdown(createScopeDropdown({
            id: `media-library-video-scope-${item.itemId}`,
            options: scopeOptions,
            selectedKey: item.scope,
            onSelect: async (key) => {
                const newScope = key as MediaLibraryScope
                const response = await mediaLibraryService.changeItemScope({
                    workspaceId,
                    itemId: item.itemId,
                    newScope,
                    organizationId,
                })
                if (response.error) {
                    scopeDropdown.setSelectedKey(item.scope)
                    setFeedback(`Could not move ${item.displayName}.`)
                    return
                }
                const scopeLabel = SCOPES.find((scope) => scope.key === newScope)?.label ?? newScope
                setFeedback(`Moved ${item.displayName} to ${scopeLabel}.`)
                await loadMedia()
            },
        }))
        ;(rowEl.querySelector('.media-library-video-scope-mount') as HTMLElement).appendChild(scopeDropdown.dom)

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
                <strong className="media-library-image-name">${item.displayName}</strong>
                <span className="media-library-image-metadata">${`${item.width} x ${item.height} pixels | ${item.mimeType} | ${item.byteSize} bytes`}</span>
                <span className="media-library-image-scope">${`Scope: ${item.scope}`}</span>
            </div>
            <div className="media-library-image-actions">
                <button type="button" data-action="insert">Add to canvas</button>
                <label>Scope
                    <span className="media-library-image-scope-mount"></span>
                </label>
                <button type="button" data-action="delete">Delete</button>
            </div>
        </article>` as HTMLElement

        const organizationId = organizationStore.getData('organizationId') || undefined
        const scopeOptions = SCOPES.filter((scope) => organizationId || scope.key !== MEDIA_LIBRARY_SCOPE.ORGANIZATION)
        const scopeDropdown = trackTransientDropdown(createScopeDropdown({
            id: `media-library-image-scope-${item.itemId}`,
            options: scopeOptions,
            selectedKey: item.scope,
            onSelect: async (key) => {
                const newScope = key as MediaLibraryScope
                const response = await mediaLibraryService.changeImageScope({
                    workspaceId,
                    itemId: item.itemId,
                    newScope,
                    organizationId,
                })
                if (response.error) {
                    scopeDropdown.setSelectedKey(item.scope)
                    setFeedback(`Could not move ${item.displayName}.`)
                    return
                }
                const scopeLabel = SCOPES.find((scope) => scope.key === newScope)?.label ?? newScope
                setFeedback(`Moved ${item.displayName} to ${scopeLabel}.`)
                await loadMedia()
            },
        }))
        ;(rowEl.querySelector('.media-library-image-scope-mount') as HTMLElement).appendChild(scopeDropdown.dom)

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
        const response = await nats?.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.DELETE, { token, workspaceId, featureId: feature.featureId })
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

    async function reportFeature(feature: FeatureMeta) {
        const nats = servicesStore.getData('nats')
        const token = await AuthService.getTokenSilently()
        const response = await nats?.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.REPORT_ABUSE, { token, workspaceId, featureId: feature.featureId })
        setFeedback(response?.error ? `Could not report @${feature.name}.` : `Reported @${feature.name}.`)
    }

    async function changeFeatureScope(feature: FeatureMeta, newScope: MediaLibraryScope, revert: () => void) {
        if (newScope === feature.scope) return
        if (newScope === MEDIA_LIBRARY_SCOPE.PUBLIC && !window.confirm(`Make @${feature.name} public? Anyone will be able to discover and use it.`)) {
            revert()
            return
        }
        const nats = servicesStore.getData('nats')
        const token = await AuthService.getTokenSilently()
        const organizationId = organizationStore.getData('organizationId') || undefined
        const response = await nats?.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.CHANGE_SCOPE, {
            token,
            workspaceId,
            organizationId,
            featureId: feature.featureId,
            newScope,
        })
        if (!response || response.error) {
            revert()
            setFeedback(`Could not change sharing for @${feature.name}.`)
            return
        }
        setFeedback(`Moved @${feature.name} to ${SCOPES.find((scope) => scope.key === newScope)?.label ?? newScope}.`)
        await loadFeatures()
    }

    function buildRow(feature: FeatureMeta): HTMLElement {
        const isSelected = selectedFeatureId === feature.featureId
        const rowEl = html`<article className=${`feature-library-row${isSelected ? ' feature-library-row-selected' : ''}`} data=${{ featureId: feature.featureId }} tabindex="0" aria-selected=${isSelected ? 'true' : 'false'}>
            ${feature.sampleZeroKey && accessToken ? html`<img className="feature-library-row-thumb" src=${getSampleUrl(feature)} alt=${`${feature.name} sample`} onerror=${(event: Event) => handleSampleImageError(event, feature)} />` : html`<div className="feature-library-row-thumb-placeholder" aria-hidden="true"></div>`}
            <div className="feature-library-row-info">
                <div className="feature-library-row-meta">
                    <span className="feature-library-row-category">${feature.category || 'feature'}</span>
                    <span className="feature-library-row-scope">${feature.scope}</span>
                </div>
                <div className="feature-library-row-name">@${feature.name}</div>
                <div className="feature-library-row-summary">${feature.summary}</div>
            </div>
            <button type="button" className="feature-library-row-action feature-library-row-action-primary" data-action="use">Use</button>
        </article>` as HTMLElement

        const selectFeature = () => {
            selectedFeatureId = feature.featureId
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
                void handleUseFeature(feature)
                return
            }
            selectFeature()
        })
        return rowEl
    }

    function buildFeatureInspector(feature: FeatureMeta): HTMLElement {
        const details = featureDetails.get(feature.featureId)
        const isOwner = userStore.getData('userId') === feature.ownerUserId
        const organizationId = organizationStore.getData('organizationId') || undefined
        const inspectorEl = html`<article className="feature-library-inspector-card">
            <div className="feature-library-inspector-nav">
                <button type="button" className="feature-library-inspector-back">Back</button>
                <span>Feature details</span>
            </div>
            <div className="feature-library-inspector-heading">
                <div className="feature-library-row-meta">
                    <span className="feature-library-row-category">${feature.category || 'feature'}</span>
                    <span className="feature-library-row-scope">${feature.scope}</span>
                </div>
                <h2>@${feature.name}</h2>
                <p>${feature.summary || 'No summary stored.'}</p>
            </div>
            <div className="feature-library-inspector-actions">
                <button type="button" className="feature-library-row-action feature-library-row-action-primary" data-action="use">Use Feature</button>
                ${isOwner ? html`<button type="button" className="feature-library-row-action" data-action="delete">Delete</button>` : feature.scope === MEDIA_LIBRARY_SCOPE.PUBLIC ? html`<button type="button" className="feature-library-row-action" data-action="report">Report</button>` : null}
            </div>
            ${isOwner ? html`<label className="feature-library-inspector-scope">Sharing
                <span className="feature-library-scope-editor-mount"></span>
            </label>` : null}
            <div className="feature-library-row-detail-grid">
                <div className="feature-library-row-detail-field"><span>Category</span><strong>${feature.category || 'feature'}</strong></div>
                <div className="feature-library-row-detail-field"><span>Scope</span><strong>${feature.scope}</strong></div>
                <div className="feature-library-row-detail-field"><span>Feature ID</span><strong>${feature.featureId}</strong></div>
            </div>
            <div className="feature-library-row-detail-status">${loadingFeatureDetails.has(feature.featureId) ? 'Loading full feature details' : details && 'error' in details ? details.error : ''}</div>
            <div className="feature-library-row-samples-mount"></div>
            <div className="feature-library-row-palette-mount"></div>
            <div className="feature-library-row-instructions-mount"></div>
            <div className="feature-library-row-detail-tags"></div>
        </article>` as HTMLElement

        inspectorEl.querySelector('.feature-library-inspector-back')!.addEventListener('click', () => {
            selectedFeatureId = null
            renderContent()
        })
        const scopeEditorMount = inspectorEl.querySelector('.feature-library-scope-editor-mount') as HTMLElement | null
        if (scopeEditorMount) {
            const sharingOptions = SCOPES.filter((scope) => organizationId || scope.key !== MEDIA_LIBRARY_SCOPE.ORGANIZATION)
            const sharingDropdown = trackTransientDropdown(createScopeDropdown({
                id: `feature-library-scope-${feature.featureId}`,
                options: sharingOptions,
                selectedKey: feature.scope,
                onSelect: (key) => void changeFeatureScope(feature, key as MediaLibraryScope, () => sharingDropdown.setSelectedKey(feature.scope)),
            }))
            scopeEditorMount.appendChild(sharingDropdown.dom)
        }
        inspectorEl.querySelector('.feature-library-inspector-actions')!.addEventListener('click', (event) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
            if (action === 'use') void handleUseFeature(feature)
            else if (action === 'delete') void deleteFeature(feature)
            else if (action === 'report') void reportFeature(feature)
        })

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
                if (isMounted && mode === 'features') renderContent()
            })
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.DELETED, (data: any) => {
                if (!data?.featureId) return
                allFeatures = allFeatures.filter((f) => f.featureId !== data.featureId)
                if (isMounted && mode === 'features') renderContent()
            })
            nats?.subscribe(NATS_SUBJECTS.WORKSPACE_SUBJECTS.FEATURE_SUBJECTS.EVENTS.UPDATED, () => {
                if (isMounted && mode === 'features') void loadFeatures()
            })
        }
        if (!hasMediaEventSubscriptions) {
            hasMediaEventSubscriptions = true
            const nats = servicesStore.getData('nats')
            for (const subject of [
                NATS_SUBJECTS.WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS.EVENTS.CREATED,
                NATS_SUBJECTS.WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS.EVENTS.UPDATED,
                NATS_SUBJECTS.WORKSPACE_SUBJECTS.MEDIA_LIBRARY_SUBJECTS.EVENTS.DELETED,
            ]) {
                nats?.subscribe(subject, () => {
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

    return { get rootEl() { build(); return panelEl! }, mountInto, setMode, unmount, destroy }
}
