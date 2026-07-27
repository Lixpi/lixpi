import type { Asset, AssetMeta } from '@lixpi/constants'

import { ProseMirrorEditor } from '$src/components/proseMirror/components/editor.ts'
import {
    mountReadOnlyAiChatThreadProjection,
    type ReadOnlyAiChatThreadRendererInstance,
} from '$src/components/proseMirror/readOnlyAiChatThreadRenderer.ts'
import AssetService from '$src/services/asset-service.ts'
import AuthService from '$src/services/auth-service.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { html } from '$src/utils/domTemplates.ts'
import { resolveMediaUrl } from '$src/utils/mediaUrls.ts'
import type { AiUserMessageContextPreviewRenderer } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import type { PromptReferencePreviewRenderer } from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'

export type MediaLibraryPanelInstance = {
    readonly rootEl: HTMLElement
    mountInto: (hostEl: HTMLElement) => void
    showAsset: (assetId: string) => void
    refresh: () => void
    unmount: () => void
    destroy: () => void
}

export type MediaLibraryPanelOptions = {
    workspaceId: string
    onInsertAsset?: (item: AssetMeta) => Promise<boolean>
    contextPreview?: AiUserMessageContextPreviewRenderer
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
}

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export function stripMediaFileExtension(name: string): string {
    return name.replace(/\.[^./\\]+$/, '')
}

export function formatMediaFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
    const mb = bytes / (1024 * 1024)
    if (mb >= 1) return `${mb.toFixed(1)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isAssetAttachableToWorkspace(asset: AssetMeta, workspaceId: string): boolean {
    if (asset.scope === 'workspace') return asset.scopeOwnerId === workspaceId
    if (asset.scope === 'user' || asset.scope === 'organization') return true

    // Existing projections created before scope fields were added still expose
    // their base scope through the partition key.
    const [scope, scopeOwnerId] = asset.scopeAndOwner.split('#', 2)
    if (scope === 'workspace') return scopeOwnerId === workspaceId
    return scope === 'user' || scope === 'organization'
}

class MediaLibraryPanel implements MediaLibraryPanelInstance {
    readonly rootEl: HTMLElement
    private readonly assetService = new AssetService()
    private readonly browserEl: HTMLElement
    private readonly inspectorEl: HTMLElement
    private readonly feedbackEl: HTMLElement
    private allAssets: AssetMeta[] = []
    private selectedAssetId: string | null = null
    private accessToken = ''
    private isMounted = false
    private loadSequence = 0
    private assetDetailEditor: ProseMirrorEditor | null = null
    private provenanceRenderer: ReadOnlyAiChatThreadRendererInstance | null = null

    constructor(private readonly options: MediaLibraryPanelOptions) {
        this.rootEl = html`<div className="media-library-panel media-library-panel-embedded media-library-panel-images nopan nowheel">
            <div className="media-library-controls">
                <span className="media-library-feedback"></span>
            </div>
            <div className="media-library-body">
                <section className="media-library-browser"></section>
                <aside className="media-library-inspector"></aside>
            </div>
        </div>` as HTMLElement
        this.browserEl = this.rootEl.querySelector('.media-library-browser') as HTMLElement
        this.inspectorEl = this.rootEl.querySelector('.media-library-inspector') as HTMLElement
        this.feedbackEl = this.rootEl.querySelector('.media-library-feedback') as HTMLElement
    }

    mountInto(hostEl: HTMLElement): void {
        if (this.rootEl.parentElement !== hostEl) hostEl.appendChild(this.rootEl)
        this.isMounted = true
        if (this.allAssets.length > 0) this.render()
        else void this.load()
    }

    showAsset(assetId: string): void {
        this.selectedAssetId = assetId
        if (this.isMounted) this.render()
    }

    refresh(): void {
        if (this.isMounted) void this.load()
    }

    unmount(): void {
        this.isMounted = false
        this.loadSequence += 1
        this.destroyInspectorResources()
        this.rootEl.remove()
    }

    destroy(): void {
        this.unmount()
        this.allAssets = []
        this.selectedAssetId = null
    }

    private async load(): Promise<void> {
        const loadSequence = ++this.loadSequence
        this.browserEl.replaceChildren(html`<div className="media-library-state">Loading media</div>`)
        try {
            this.accessToken = await AuthService.getTokenSilently()
            const assets: AssetMeta[] = []
            let cursor: string | undefined
            do {
                const page = await this.assetService.list({ limit: 100, cursor })
                assets.push(...page.items)
                cursor = page.cursor
            } while (cursor)
            if (loadSequence !== this.loadSequence) return
            this.allAssets = [...new Map(assets.map((asset) => [asset.assetId, asset])).values()]
                .filter((asset) => asset.primaryCategory !== 'conversation' && asset.primaryCategory !== 'capabilityArtifact')
                .filter((asset) => isAssetAttachableToWorkspace(asset, this.options.workspaceId))
                .sort((left, right) => right.updatedAt - left.updatedAt)
            this.render()
        } catch (error) {
            if (loadSequence !== this.loadSequence) return
            console.error('Failed to load Assets:', error)
            this.browserEl.replaceChildren(html`<div className="media-library-state media-library-state-error">Could not load media.</div>`)
        }
    }

    private render(): void {
        if (!this.isMounted) return
        this.destroyInspectorResources()
        this.browserEl.replaceChildren(html`<div className="media-library-browser-intro">
            <h2>Media</h2>
            <p>Assets keep one identity across the library, canvas placements, notes, and provenance.</p>
        </div>`)
        this.inspectorEl.replaceChildren()

        if (this.allAssets.length === 0) {
            this.browserEl.appendChild(html`<div className="media-library-state">No assets found.</div>`)
        } else {
            const itemsEl = html`<div className="capability-library-section-items"></div>` as HTMLElement
            for (const asset of this.allAssets) itemsEl.appendChild(this.buildAssetRow(asset))
            this.browserEl.appendChild(itemsEl)
        }

        if (this.selectedAssetId) void this.renderAssetInspector(this.selectedAssetId)
        else this.inspectorEl.appendChild(html`<div className="media-library-inspector-empty">
            <strong>Select an Asset</strong>
            <span>Metadata, scope, content, and provenance appear here.</span>
        </div>`)
    }

    private buildAssetRow(asset: AssetMeta): HTMLElement {
        const thumbEl = asset.thumbnailBlobHash
            ? html`<img className="capability-library-row-thumb" src=${this.getAssetRenditionUrl(asset.assetId, 'thumbnail')} alt="" />`
            : html`<div className="capability-library-row-thumb-placeholder" aria-hidden="true"></div>`
        const metadata = [
            asset.primaryCategory,
            typeof asset.byteSize === 'number' ? formatMediaFileSize(asset.byteSize) : '',
            typeof asset.durationSeconds === 'number' ? `${asset.durationSeconds.toFixed(1)}s` : '',
        ].filter(Boolean).join(' · ')
        const rowEl = html`<article
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
            <button type="button" className="capability-library-row-use" data-action="insert" data-side-panel-no-drag="true">Add</button>
        </article>` as HTMLElement
        const selectAsset = (): void => {
            this.selectedAssetId = asset.assetId
            this.render()
        }
        rowEl.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            selectAsset()
        })
        rowEl.addEventListener('click', (event) => {
            const action = (event.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action')
            if (action === 'insert') {
                void this.insertAsset(asset)
                return
            }
            selectAsset()
        })
        return rowEl
    }

    private async insertAsset(asset: AssetMeta): Promise<void> {
        try {
            const inserted = await this.options.onInsertAsset?.(asset)
            this.feedbackEl.textContent = inserted
                ? `Added ${asset.title} to the canvas.`
                : `Could not add ${asset.title} to the canvas.`
        } catch (error) {
            console.error('Failed to add Asset to canvas:', error)
            this.feedbackEl.textContent = error instanceof Error && error.message === 'SCOPE_DENIES_WORKSPACE'
                ? `${asset.title} is not available in this workspace.`
                : `Could not add ${asset.title} to the canvas.`
        }
    }

    private async renderAssetInspector(assetId: string): Promise<void> {
        this.inspectorEl.replaceChildren(html`<div className="media-library-state">Loading Asset…</div>`)
        try {
            const asset = await this.assetService.get(assetId)
            if (!this.isMounted || this.selectedAssetId !== assetId || !this.inspectorEl.isConnected) return
            if ('error' in asset) {
                this.inspectorEl.replaceChildren(html`<div className="media-library-state media-library-state-error">Asset unavailable: ${asset.error}</div>`)
                return
            }
            assetsStore.upsert(asset)
            const detail = this.buildAssetInspector(asset)
            this.inspectorEl.replaceChildren(detail)
            await this.mountAssetDocuments(asset, detail)
        } catch (error) {
            console.error('Failed to render Asset inspector:', error)
            if (this.inspectorEl.isConnected && this.selectedAssetId === assetId) {
                this.inspectorEl.replaceChildren(html`<div className="media-library-state media-library-state-error">Could not load Asset details.</div>`)
            }
        }
    }

    private buildAssetInspector(asset: Asset): HTMLElement {
        const detail = html`<section className="media-library-detail" data-side-panel-no-drag="true">
            <button type="button" className="media-library-detail-back">Back</button>
            <label>Title</label>
            <input type="text" className="media-library-detail-title" />
            <label>Scope</label>
            <select className="media-library-detail-scope">
                <option value="workspace">Workspace</option>
                <option value="user">Mine</option>
                <option value="organization">Organization</option>
            </select>
            <p className="media-library-detail-state"></p>
            <p className="media-library-detail-descriptor"></p>
            <p className="media-library-detail-lineage"></p>
            <button type="button" className="media-library-detail-remove">Remove from library</button>
            <div className="media-library-detail-content"></div>
            <div className="media-library-detail-provenance"></div>
        </section>` as HTMLElement
        const titleInput = detail.querySelector('.media-library-detail-title') as HTMLInputElement
        const scopeSelect = detail.querySelector('.media-library-detail-scope') as HTMLSelectElement
        const stateEl = detail.querySelector('.media-library-detail-state') as HTMLElement
        titleInput.value = asset.title
        scopeSelect.value = asset.scope
        this.refreshAssetState(stateEl, asset)
        ;(detail.querySelector('.media-library-detail-descriptor') as HTMLElement).textContent = asset.descriptor?.summary ?? 'No descriptor'
        ;(detail.querySelector('.media-library-detail-lineage') as HTMLElement).textContent = asset.lineage
            ? `Sources: ${[asset.lineage.parentAssetId, ...asset.lineage.sourceAssetIds].filter(Boolean).join(', ') || 'conversation only'}`
            : 'No lineage'
        detail.querySelector('.media-library-detail-back')?.addEventListener('click', () => {
            this.selectedAssetId = null
            this.render()
        })
        detail.querySelector('.media-library-detail-remove')?.addEventListener('click', () => void this.removeAsset(asset, stateEl))
        titleInput.addEventListener('change', () => void this.updateAssetTitle(asset, titleInput, stateEl))
        scopeSelect.addEventListener('change', () => void this.updateAssetScope(asset, scopeSelect, stateEl))
        return detail
    }

    private async removeAsset(asset: Asset, stateEl: HTMLElement): Promise<void> {
        const result = await this.assetService.detach({ assetId: asset.assetId, referenceType: 'catalog' }) as { error?: string }
        if (result?.error) {
            stateEl.textContent = `Library removal failed: ${result.error}`
            return
        }
        this.allAssets = this.allAssets.filter((item) => item.assetId !== asset.assetId)
        this.selectedAssetId = null
        this.render()
    }

    private async updateAssetTitle(asset: Asset, titleInput: HTMLInputElement, stateEl: HTMLElement): Promise<void> {
        const current = await this.assetService.get(asset.assetId)
        if ('error' in current) return
        const updated = await this.assetService.updateMetadata(current.assetId, current.revision, { title: titleInput.value.trim() })
        if ('error' in updated) {
            stateEl.textContent = `Title update failed: ${updated.error}`
            titleInput.value = current.title
            return
        }
        assetsStore.upsert(updated)
        this.refreshAssetState(stateEl, updated)
    }

    private async updateAssetScope(asset: Asset, scopeSelect: HTMLSelectElement, stateEl: HTMLElement): Promise<void> {
        const current = await this.assetService.get(asset.assetId)
        if ('error' in current) return
        const scope = scopeSelect.value as Asset['scope']
        const scopeOwnerId = scope === 'workspace'
            ? this.options.workspaceId
            : scope === 'user'
                ? userStore.getData('userId')
                : current.organizationId
        if (!scopeOwnerId) return
        const updated = await this.assetService.changeScope(current.assetId, current.revision, scope, scopeOwnerId)
        if ('error' in updated) {
            stateEl.textContent = `Scope update failed: ${updated.error}`
            scopeSelect.value = current.scope
            return
        }
        assetsStore.upsert(updated)
        this.refreshAssetState(stateEl, updated)
    }

    private refreshAssetState(stateEl: HTMLElement, asset: Asset): void {
        stateEl.textContent = `${asset.media?.kind ?? (asset.documents.conversation ? 'conversation' : 'document')} · ${asset.states.lifecycle} · ${asset.states.media}`
    }

    private async mountAssetDocuments(asset: Asset, detail: HTMLElement): Promise<void> {
        if (asset.documents.content) {
            await this.assetService.resumeDocument({ organizationId: asset.organizationId, assetId: asset.assetId, role: 'content' })
            if (!detail.isConnected || this.selectedAssetId !== asset.assetId) return
            const snapshot = assetDocumentsStore.get(asset.assetId, 'content')
            const mount = detail.querySelector('.media-library-detail-content') as HTMLElement
            if (snapshot) {
                this.assetDetailEditor = new ProseMirrorEditor({
                    editorMountElement: mount,
                    content: html`<div></div>` as HTMLDivElement,
                    initialVal: snapshot.doc,
                    isDisabled: false,
                    documentType: 'assetContent',
                    proseMirrorAuthority: {
                        organizationId: asset.organizationId,
                        workspaceId: this.options.workspaceId,
                        assetId: asset.assetId,
                        role: 'content',
                        baseVersion: snapshot.version,
                        onLeaseStateChange: (state: { readOnly: boolean; holderWorkspaceId?: string }) => {
                            mount.classList.toggle('is-read-only', state.readOnly)
                            mount.title = state.readOnly ? `Read-only${state.holderWorkspaceId ? `; lease held by ${state.holderWorkspaceId}` : ''}` : ''
                        },
                    },
                })
            }
        }
        if (!asset.documents.provenance) return
        await this.assetService.resumeDocument({ organizationId: asset.organizationId, assetId: asset.assetId, role: 'provenance' })
        if (!detail.isConnected || this.selectedAssetId !== asset.assetId) return
        const snapshot = assetDocumentsStore.get(asset.assetId, 'provenance')
        const mount = detail.querySelector('.media-library-detail-provenance') as HTMLElement
        if (snapshot) {
            this.provenanceRenderer = mountReadOnlyAiChatThreadProjection({
                mount,
                content: snapshot.doc as any,
                threadId: asset.lineage?.sourceConversationAssetId ?? asset.assetId,
                documentType: 'assetProvenance',
                contextPreview: this.options.contextPreview,
                promptReferencePreviewRenderer: this.options.promptReferencePreviewRenderer,
            })
        }
    }

    private getAssetRenditionUrl(assetId: string, rendition: string): string {
        return resolveMediaUrl(this.assetService.getRenditionUrl(assetId, rendition), {
            apiBaseUrl: API_BASE_URL,
            token: this.accessToken,
        })
    }

    private destroyInspectorResources(): void {
        this.assetDetailEditor?.destroy()
        this.assetDetailEditor = null
        this.provenanceRenderer?.destroy()
        this.provenanceRenderer = null
    }
}

export function createMediaLibraryPanel(options: MediaLibraryPanelOptions): MediaLibraryPanelInstance {
    return new MediaLibraryPanel(options)
}
