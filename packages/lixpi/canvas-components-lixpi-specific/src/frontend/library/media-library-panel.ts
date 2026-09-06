import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    ASSET_GENERATION_SEED_HELP_TEXT,
    type Asset,
    type AssetMeta,
    type SubjectIdentityClassification,
} from '@lixpi/constants'
import { questionMarkCircleIcon } from '@lixpi/ui-kit/svg'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { runLibraryAction } from './library-action.ts'
import { createHelpTooltip } from '@lixpi/ui-kit/components/help-tooltip'
import {
    mountAssetSubjectIdentityControl,
    WorkspaceAssetContentEditor,
    type WorkspaceAssetEditorPorts,
} from '../review/index.ts'
import {
    type WorkspaceLibraryPorts,
    type LibraryAssetResult,
} from './library-ports.ts'

export type MediaLibraryPanelInstance = {
    readonly rootEl: HTMLElement
    mountInto: (hostEl: HTMLElement) => void
    showAsset: (assetId: string) => void
    refresh: () => void
    unmount: () => void
    destroy: () => void
}

export type MediaLibraryPanelOptions = WorkspaceLibraryPorts & {
    tooltipHideDelayMs: number
    prepareRenditionUrls: () => Promise<(
        assetId: string,
        rendition: string,
    ) => string>
    mountEditor: WorkspaceAssetEditorPorts['mountEditor']
    attestSubjectIdentity: (
        assetId: string,
        revision: number,
        classification: SubjectIdentityClassification,
    ) => Promise<LibraryAssetResult>
    removeFromLibrary: (assetId: string) => Promise<{ error?: string }>
    onInsertAsset?: (item: AssetMeta) => Promise<boolean>
}

export const stripMediaFileExtension = (name: string): string => name.replace(/\.[^./\\]+$/, '')

export const formatMediaFileSize = (bytes: number): string => {
    if (
        !Number.isFinite(bytes)
        || bytes <= 0
    )
        return '0 KB'

    const mb = bytes / (1024 * 1024)

    if (mb >= 1)
        return `${mb.toFixed(1)} MB`

    return `${Math.max(
        1,
        Math.round(bytes / 1024),
    )} KB`
}

const isAssetAttachableToWorkspace = (
    asset: AssetMeta,
    workspaceId: string,
): boolean => {
    if (asset.scope === 'workspace')
        return asset.scopeOwnerId === workspaceId

    if (
        asset.scope === 'user'
        || asset.scope === 'organization'
    )
        return true

    // Existing projections created before scope fields were added still expose
    // their base scope through the partition key.
    const [scope, scopeOwnerId] = asset.scopeAndOwner.split('#', 2)

    if (scope === 'workspace')
        return scopeOwnerId === workspaceId

    return scope === 'user' || scope === 'organization'
}

class MediaLibraryPanel implements MediaLibraryPanelInstance {
    readonly rootEl: HTMLElement
    private readonly html: ReturnType<typeof createDocumentHtml>
    private destroyed = false
    private viewLifetime = new Lifetime()
    private inspectorSequence = 0
    private readonly browserEl: HTMLElement
    private readonly inspectorEl: HTMLElement
    private readonly feedbackEl: HTMLElement
    private allAssets: AssetMeta[] = []
    private selectedAssetId: string | null = null
    private renditionUrl: ((
        assetId: string,
        rendition: string,
    ) => string) | null = null
    private isMounted = false
    private loadSequence = 0

    constructor(private readonly options: MediaLibraryPanelOptions) {
        this.html = createDocumentHtml(options.document)
        this.rootEl = this.html`
            <div className="media-library-panel media-library-panel-embedded media-library-panel-images nopan nowheel">
            <div className="media-library-controls">
                <span className="media-library-feedback"></span>
            </div>
            <div className="media-library-body">
                <section className="media-library-browser"></section>
                <aside className="media-library-inspector"></aside>
            </div>
        </div>
        ` as HTMLElement
        this.browserEl = this.rootEl.querySelector('.media-library-browser') as HTMLElement
        this.inspectorEl = this.rootEl.querySelector('.media-library-inspector') as HTMLElement
        this.feedbackEl = this.rootEl.querySelector('.media-library-feedback') as HTMLElement
    }

    mountInto(hostEl: HTMLElement): void {
        if (this.destroyed)
            return

        if (this.rootEl.parentElement !== hostEl)
            hostEl.appendChild(this.rootEl)

        this.isMounted = true

        if (this.allAssets.length > 0)
            this.render()
        else
            void this.load()
    }

    showAsset(assetId: string): void {
        if (this.destroyed)
            return

        this.selectedAssetId = assetId

        if (this.isMounted)
            this.render()
    }

    refresh(): void {
        if (this.isMounted)
            void this.load()
    }

    unmount(): void {
        this.isMounted = false
        this.loadSequence += 1

        try {
            this.destroyInspectorResources()
        } finally {
            this.rootEl.remove()
        }
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.unmount()
        this.allAssets = []
        this.selectedAssetId = null
    }

    private async load(): Promise<void> {
        const loadSequence = ++this.loadSequence
        this.destroyInspectorResources()
        this.inspectorEl.replaceChildren()
        this.browserEl.replaceChildren(this.html`<div className="media-library-state">Loading media</div>` as HTMLElement)

        try {
            const renditionUrl = await this.options.prepareRenditionUrls()

            if (loadSequence !== this.loadSequence)
                return

            this.renditionUrl = renditionUrl
            const assets: AssetMeta[] = []
            let cursor: string | undefined

            do {
                const page = await this.options.assets.list({
                    workspaceId: this.options.workspaceId,
                    limit: 100,
                    cursor,
                })

                if (loadSequence !== this.loadSequence)
                    return

                assets.push(...page.items)
                cursor = page.cursor
            } while (cursor)

            if (loadSequence !== this.loadSequence)
                return

            this.allAssets = [...new Map(
                assets.map(asset => [asset.assetId, asset]),
            ).values()].filter(asset => asset.primaryCategory !== 'conversation' && asset.primaryCategory !== 'capabilityArtifact').filter(
                asset => isAssetAttachableToWorkspace(asset, this.options.workspaceId),
            )
                .sort((left, right) => right.updatedAt - left.updatedAt)
            this.render()
        } catch (error) {
            if (loadSequence !== this.loadSequence)
                return

            this.options.onError(error)
            this.browserEl.replaceChildren(
                this.html`<div className="media-library-state media-library-state-error">Could not load media.</div>` as HTMLElement,
            )
        }
    }

    private render(): void {
        if (!this.isMounted)
            return

        this.destroyInspectorResources()

        try {
            this.browserEl.replaceChildren(
                this.html`
                    <div className="media-library-browser-intro">
                    <h2>Media</h2>
                    <p>Assets keep one identity across the library, canvas placements, notes, and provenance.</p>
                </div>
                ` as HTMLElement,
            )
            this.inspectorEl.replaceChildren()

            if (this.allAssets.length === 0)
                this.browserEl.appendChild(this.html`<div className="media-library-state">No assets found.</div>` as HTMLElement)
            else {
                const itemsEl = this.html`<div className="capability-library-section-items"></div>` as HTMLElement

                for (const asset of this.allAssets)
                    itemsEl.appendChild(
                        this.buildAssetRow(asset),
                    )

                this.browserEl.appendChild(itemsEl)
            }

            if (this.selectedAssetId)
                void this.renderAssetInspector(this.selectedAssetId)
            else {
                this.inspectorEl.appendChild(
                    this.html`
                        <div className="media-library-inspector-empty">
                        <strong>Select an Asset</strong>
                        <span>Metadata, scope, content, and provenance appear here.</span>
                    </div>
                    ` as HTMLElement,
                )
            }
        } catch (error) {
            this.destroyInspectorResources()
            this.options.onError(error)
            this.browserEl.replaceChildren(
                this.html`<div className="media-library-state media-library-state-error">Could not display media.</div>` as HTMLElement,
            )
        }
    }

    private buildAssetRow(asset: AssetMeta): HTMLElement {
        const thumbEl = asset.thumbnailBlobHash
            ? this.html`
                <img
                    className="capability-library-row-thumb"
                    src=${this.getAssetRenditionUrl(asset.assetId, 'thumbnail')}
                    alt=""
                />
            ` as HTMLElement
            : this.html`<div
                    className="capability-library-row-thumb-placeholder"
                    aria-hidden="true"
                ></div>` as HTMLElement
        const metadata = [
            asset.primaryCategory,
            typeof asset.byteSize === 'number' ? formatMediaFileSize(asset.byteSize) : '',
            typeof asset.durationSeconds === 'number' ? `${asset.durationSeconds.toFixed(1)}s` : '',
        ].filter(Boolean).join(' · ')
        const rowEl = this.html`
            <article
                className=${`capability-library-row${this.selectedAssetId === asset.assetId ? ' capability-library-row-selected' : ''}`}
                data=${{ assetId: asset.assetId }}
                tabindex="0"
                data-side-panel-no-drag="true"
            >
            ${thumbEl}
            <div className="capability-library-row-info">
                <div className="capability-library-row-meta">
                    <span className="capability-library-row-category">${metadata}</span>
                </div>
                <div className="capability-library-row-name">${stripMediaFileExtension(asset.title)}</div>
                <div className="capability-library-row-summary">${asset.descriptorSummary ?? ''}</div>
            </div>
            <button
                type="button"
                className="capability-library-row-action capability-library-row-action-primary"
                data-action="insert"
                data-side-panel-no-drag="true"
            >Add</button>
        </article>
        ` as HTMLElement
        const selectAsset = (): void => {
            this.selectedAssetId = asset.assetId
            this.render()
        }
        const keydown = (event: KeyboardEvent) => {
            if (
                event.key !== 'Enter'
                && event.key !== ' '
            )
                return

            event.preventDefault()
            selectAsset()
        }
        const click = (event: MouseEvent) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')

            if (action === 'insert') {
                void this.insertAsset(asset)

                return
            }

            selectAsset()
        }
        rowEl.addEventListener('click', click)
        rowEl.addEventListener('keydown', keydown)
        this.viewLifetime.own(() => rowEl.removeEventListener('click', click))
        this.viewLifetime.own(() => rowEl.removeEventListener('keydown', keydown))

        return rowEl
    }

    private async insertAsset(asset: AssetMeta): Promise<void> {
        const lifetime = this.viewLifetime

        if (
            !this.isMounted
            || lifetime.signal.aborted
        )
            return

        try {
            const inserted = await this.options.onInsertAsset?.(asset)

            if (lifetime.signal.aborted)
                return

            this.feedbackEl.textContent = inserted
                ? `Added ${asset.title} to the canvas.`
                : `Could not add ${asset.title} to the canvas.`
        } catch (error) {
            if (lifetime.signal.aborted)
                return

            this.options.onError(error)
            this.feedbackEl.textContent = error instanceof Error
                && error.message === 'SCOPE_DENIES_WORKSPACE'
                ? `${asset.title} is not available in this workspace.`
                : `Could not add ${asset.title} to the canvas.`
        }
    }

    private async renderAssetInspector(assetId: string): Promise<void> {
        const sequence = ++this.inspectorSequence
        const lifetime = this.viewLifetime.child()
        this.inspectorEl.replaceChildren(this.html`<div className="media-library-state">Loading Asset…</div>` as HTMLElement)

        try {
            const asset = await this.options.assets.get(assetId, this.options.workspaceId)

            if (
                lifetime.signal.aborted
                || sequence !== this.inspectorSequence
            )
                return

            if ('error' in asset) {
                this.inspectorEl.replaceChildren(
                    this.html`<div className="media-library-state media-library-state-error">Asset unavailable: ${asset.error}</div>` as HTMLElement,
                )

                return
            }

            const detail = this.buildAssetInspector(asset)
            this.inspectorEl.replaceChildren(detail)
            await this.mountAssetDocuments(
                asset,
                detail,
                lifetime,
            )
        } catch (error) {
            if (
                !lifetime.signal.aborted
                && sequence === this.inspectorSequence
            ) {
                this.options.onError(error)
                this.inspectorEl.replaceChildren(
                    this.html`<div className="media-library-state media-library-state-error">Could not load Asset details.</div>` as HTMLElement,
                )
            }
        }
    }

    private buildAssetInspector(asset: Asset): HTMLElement {
        const lifetime = this.viewLifetime
        const detail = this.html`
            <section
                className="media-library-detail"
                data-side-panel-no-drag="true"
            >
            <button
                type="button"
                className="media-library-detail-back"
            >Back</button>
            <label>Title</label>
            <input
                type="text"
                className="media-library-detail-title"
            />
            <label>Scope</label>
            <select className="media-library-detail-scope">
                <option value="workspace">Workspace</option>
                <option value="user">Mine</option>
                <option value="organization">Organization</option>
            </select>
            <p className="media-library-detail-state"></p>
            <label>Subject identity</label>
            <div className="media-library-detail-subject-identity"></div>
            <p className="media-library-detail-descriptor"></p>
            <p className="media-library-detail-lineage"></p>
            <p className="media-library-detail-seed"></p>
            <button
                type="button"
                className="media-library-detail-remove"
            >Remove from library</button>
            <div
                className="media-library-detail-content"
                data-help-tooltip="aria-description"
            ></div>
            <div className="media-library-detail-provenance"></div>
        </section>
        ` as HTMLElement
        const titleInput = detail.querySelector('.media-library-detail-title') as HTMLInputElement
        const scopeSelect = detail.querySelector('.media-library-detail-scope') as HTMLSelectElement
        const stateEl = detail.querySelector('.media-library-detail-state') as HTMLElement
        titleInput.value = asset.title
        scopeSelect.value = asset.scope
        this.refreshAssetState(stateEl, asset)
        const identityMount = detail.querySelector('.media-library-detail-subject-identity') as HTMLElement
        const subjectIdentityControl = mountAssetSubjectIdentityControl({
            host: identityMount,
            asset,
            attestSubjectIdentity: (
                assetId,
                revision,
                classification,
            ) => this.options.attestSubjectIdentity(
                assetId,
                revision,
                classification,
            ),
            onUpdated: updated => void this.refreshAssetState(stateEl, updated),
            onError: message => void (stateEl.textContent = `Subject identity update failed: ${message}`),
        })
        lifetime.own(() => subjectIdentityControl.destroy())
        ;(detail.querySelector('.media-library-detail-descriptor') as HTMLElement).textContent = asset.descriptor?.summary ?? 'No descriptor'
        ;(detail.querySelector('.media-library-detail-lineage') as HTMLElement).textContent = asset.lineage
            ? `Sources: ${[asset.lineage.parentAssetId, ...asset.lineage.sourceAssetIds].filter(Boolean).join(', ') || 'conversation only'}`
            : 'No lineage'
        const seedEl = detail.querySelector('.media-library-detail-seed') as HTMLElement
        const generationSeed = asset.lineage?.generationSeed

        if (generationSeed === undefined)
            seedEl.remove()
        else {
            const seedHelpTooltip = createHelpTooltip({
                icon: questionMarkCircleIcon,
                hideDelayMs: this.options.tooltipHideDelayMs,
                label: 'Seed details',
                text: ASSET_GENERATION_SEED_HELP_TEXT,
                className: 'media-library-detail-seed-help',
            })
            seedEl.textContent = `Seed: ${generationSeed}`
            seedEl.append(seedHelpTooltip.dom)
            lifetime.own(() => seedHelpTooltip.destroy())
        }

        this.listen(
            detail.querySelector('.media-library-detail-back')!,
            'click',
            () => {
                this.selectedAssetId = null
                this.render()
            },
        )
        this.listen(
            detail.querySelector('.media-library-detail-remove')!,
            'click',
            () => void this.removeAsset(asset, stateEl),
        )
        this.listen(
            titleInput,
            'change',
            () => void this.updateAssetTitle(
                asset,
                titleInput,
                stateEl,
            ),
        )
        this.listen(
            scopeSelect,
            'change',
            () => void this.updateAssetScope(
                asset,
                scopeSelect,
                stateEl,
            ),
        )

        return detail
    }

    private async removeAsset(
        asset: Asset,
        stateEl: HTMLElement,
    ): Promise<void> {
        await runLibraryAction(
            this.viewLifetime.signal,
            () => this.options.removeFromLibrary(asset.assetId),
            result => {
                if (result?.error) {
                    stateEl.textContent = `Library removal failed: ${result.error}`

                    return
                }

                this.allAssets = this.allAssets.filter(item => item.assetId !== asset.assetId)
                this.selectedAssetId = null
                this.render()
            },
            this.options.onError,
        )
    }

    private async updateAssetTitle(
        asset: Asset,
        titleInput: HTMLInputElement,
        stateEl: HTMLElement,
    ): Promise<void> {
        const signal = this.viewLifetime.signal
        const title = titleInput.value.trim()
        await runLibraryAction(
            signal,
            async () => {
                const current = await this.options.assets.get(asset.assetId, this.options.workspaceId)

                if (
                    signal.aborted
                    || 'error' in current
                )
                    return

                const updated = await this.options.assets.updateMetadata(
                    current.assetId,
                    current.revision,
                    { title },
                )

                return {
                    current,
                    updated,
                }
            },
            result => {
                if (!result)
                    return

                if ('error' in result.updated) {
                    stateEl.textContent = `Title update failed: ${result.updated.error}`
                    titleInput.value = result.current.title
                } else
                    this.refreshAssetState(stateEl, result.updated)
            },
            this.options.onError,
        )
    }

    private async updateAssetScope(
        asset: Asset,
        scopeSelect: HTMLSelectElement,
        stateEl: HTMLElement,
    ): Promise<void> {
        const signal = this.viewLifetime.signal
        const scope = scopeSelect.value as Asset['scope']
        await runLibraryAction(
            signal,
            async () => {
                const current = await this.options.assets.get(asset.assetId, this.options.workspaceId)

                if (
                    signal.aborted
                    || 'error' in current
                )
                    return

                const scopeOwnerId = scope === 'workspace'
                    ? this.options.workspaceId
                    : scope === 'user'
                        ? this.options.userId
                        : current.organizationId

                if (!scopeOwnerId)
                    return

                const updated = await this.options.assets.changeScope(
                    current.assetId,
                    current.revision,
                    scope,
                    scopeOwnerId,
                )

                return {
                    current,
                    updated,
                }
            },
            result => {
                if (!result)
                    return

                if ('error' in result.updated) {
                    stateEl.textContent = `Scope update failed: ${result.updated.error}`
                    scopeSelect.value = result.current.scope
                } else
                    this.refreshAssetState(stateEl, result.updated)
            },
            this.options.onError,
        )
    }

    private refreshAssetState(
        stateEl: HTMLElement,
        asset: Asset,
    ): void {
        stateEl.textContent = `${asset.media?.kind ?? (asset.documents.conversation ? 'conversation' : 'document')} · ${asset.states.lifecycle} · ${asset.states.media}`
    }

    private async mountAssetDocuments(
        asset: Asset,
        detail: HTMLElement,
        lifetime: Lifetime,
    ): Promise<void> {
        if (asset.documents.content) {
            await this.options.assets.resumeDocument({
                organizationId: asset.organizationId,
                assetId: asset.assetId,
                role: 'content',
            })

            if (lifetime.signal.aborted)
                return

            const snapshot = this.options.assets.getDocument(asset.assetId, 'content')

            if (snapshot) {
                const editor = new WorkspaceAssetContentEditor(
                    detail.querySelector('.media-library-detail-content') as HTMLElement,
                    snapshot.doc as ProseMirrorJsonNode,
                    {
                        organizationId: asset.organizationId,
                        workspaceId: this.options.workspaceId,
                        assetId: asset.assetId,
                        role: 'content',
                        baseVersion: snapshot.version,
                    },
                    this.options.mountEditor,
                )
                lifetime.own(() => editor.destroy())
            }
        }

        if (!asset.documents.provenance)
            return

        await this.options.assets.resumeDocument({
            organizationId: asset.organizationId,
            assetId: asset.assetId,
            role: 'provenance',
        })

        if (lifetime.signal.aborted)
            return

        const snapshot = this.options.assets.getDocument(asset.assetId, 'provenance')

        if (snapshot) {
            const history = this.options.mountHistory({
                host: detail.querySelector('.media-library-detail-provenance') as HTMLElement,
                asset,
                content: snapshot.doc,
                signal: lifetime.signal,
            })
            lifetime.own(() => history.destroy())
        }
    }

    private getAssetRenditionUrl(
        assetId: string,
        rendition: string,
    ): string {
        return this.renditionUrl?.(assetId, rendition) ?? ''
    }

    private listen(
        element: Element,
        type: string,
        callback: () => void,
    ): void {
        element.addEventListener(type, callback)
        this.viewLifetime.own(() => element.removeEventListener(type, callback))
    }

    private destroyInspectorResources(): void {
        this.inspectorSequence += 1
        const lifetime = this.viewLifetime
        this.viewLifetime = new Lifetime()
        lifetime.destroy()
    }
}

export const createMediaLibraryPanel = (options: MediaLibraryPanelOptions): MediaLibraryPanelInstance => new MediaLibraryPanel(options)
