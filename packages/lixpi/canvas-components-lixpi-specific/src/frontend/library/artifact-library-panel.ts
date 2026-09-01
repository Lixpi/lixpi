'use strict'

import type {
    Asset,
    AssetMeta,
    CapabilityJsonValue,
} from '@lixpi/constants'

import type { CapabilityArtifactFrontendRegistry } from '@lixpi/capability-system/frontend'
import type { CapabilityArtifactSharedRegistry } from '@lixpi/capability-system/shared'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { runLibraryAction } from './library-action.ts'
import type { WorkspaceLibraryPorts } from './library-ports.ts'

type ArtifactLibraryEntry = {
    meta: AssetMeta
    displayMetadata: Record<string, CapabilityJsonValue>
}

export type ArtifactLibraryPanelOptions = WorkspaceLibraryPorts & {
    frontendRegistry: Pick<CapabilityArtifactFrontendRegistry, 'get' | 'require'>
    sharedRegistry: Pick<CapabilityArtifactSharedRegistry, 'get'>
    ensureStyles: (document: Document) => void
    onInsertAsset?: (item: AssetMeta) => Promise<boolean>
    onAcceptAsset?: (item: Asset) => Promise<boolean>
}

export type ArtifactLibraryPanelInstance = {
    readonly rootEl: HTMLElement
    mountInto: (hostEl: HTMLElement) => void
    showAsset: (assetId: string) => void
    refresh: () => void
    unmount: () => void
    destroy: () => void
}

function isAttachableToWorkspace(asset: AssetMeta, workspaceId: string): boolean {
    if (asset.scope === 'workspace') return asset.scopeOwnerId === workspaceId
    return asset.scope === 'user' || asset.scope === 'organization'
}

class ArtifactLibraryPanel implements ArtifactLibraryPanelInstance {
    readonly rootEl: HTMLElement
    private readonly browserEl: HTMLElement
    private readonly inspectorEl: HTMLElement
    private readonly feedbackEl: HTMLElement
    private readonly html: ReturnType<typeof createDocumentHtml>
    private destroyed = false
    private viewLifetime = new Lifetime()
    private inspectorSequence = 0
    private entries: ArtifactLibraryEntry[] = []
    private selectedAssetId: string | null = null
    private mounted = false
    private loadSequence = 0

    constructor(private readonly options: ArtifactLibraryPanelOptions) {
        this.html = createDocumentHtml(options.document)
        this.rootEl = this.html`<div className="media-library-panel media-library-panel-embedded artifact-library-panel nopan nowheel">
            <div className="media-library-controls"><span className="media-library-feedback"></span></div>
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
        if (this.destroyed) return
        this.options.ensureStyles(hostEl.ownerDocument)
        if (this.rootEl.parentElement !== hostEl) hostEl.appendChild(this.rootEl)
        this.mounted = true
        if (this.entries.length > 0) this.render()
        else void this.load()
    }

    showAsset(assetId: string): void {
        if (this.destroyed) return
        this.selectedAssetId = assetId
        if (this.mounted) this.render()
    }

    refresh(): void {
        if (this.mounted) void this.load()
    }

    unmount(): void {
        this.mounted = false
        this.loadSequence += 1
        try {
            this.destroyViews()
        } finally {
            this.rootEl.remove()
        }
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.unmount()
        this.entries = []
        this.selectedAssetId = null
    }

    private async load(): Promise<void> {
        const sequence = ++this.loadSequence
        this.destroyViews()
        this.inspectorEl.replaceChildren()
        this.browserEl.replaceChildren(this.html`<div className="media-library-state">Loading Artifacts…</div>` as HTMLElement)
        try {
            const metadata: AssetMeta[] = []
            let cursor: string | undefined
            do {
                const page = await this.options.assets.list({
                    workspaceId: this.options.workspaceId,
                    primaryCategory: 'capabilityArtifact',
                    limit: 100,
                    cursor,
                })
                if (sequence !== this.loadSequence) return
                metadata.push(...page.items)
                cursor = page.cursor
            } while (cursor)
            const attachable = metadata
                .filter(item => isAttachableToWorkspace(item, this.options.workspaceId))
                .filter(item => Boolean(item.artifactTypeId))
                .sort((left, right) => right.updatedAt - left.updatedAt)
            const entries = await Promise.all(attachable.map(async meta => await this.loadEntry(meta)))
            if (sequence !== this.loadSequence) return
            this.entries = entries.filter((entry): entry is ArtifactLibraryEntry => entry !== null)
            this.render()
        } catch (error) {
            if (sequence !== this.loadSequence) return
            this.options.onError(error)
            this.browserEl.replaceChildren(this.html`<div className="media-library-state media-library-state-error">Could not load Artifacts.</div>` as HTMLElement)
        }
    }

    private async loadEntry(meta: AssetMeta): Promise<ArtifactLibraryEntry | null> {
        const asset = await this.options.assets.refresh(meta.assetId, this.options.workspaceId)
        if ('error' in asset || !asset.artifact) return null
        const definition = this.options.sharedRegistry.get(asset.artifact.artifactTypeId)
        const snapshot = this.options.assets.getDocument(asset.assetId, 'capabilityArtifact')
        if (!definition || !snapshot || definition.schemaVersion !== asset.artifact.schemaVersion) return null
        definition.assertInitialDocument(snapshot.doc)
        return { meta, displayMetadata: definition.buildCatalogMetadata(snapshot.doc) }
    }

    private render(): void {
        if (!this.mounted) return
        this.destroyViews()
        try {
            this.browserEl.replaceChildren(this.html`<div className="media-library-browser-intro">
                <h2>Artifacts</h2>
                <p>Reusable structured outputs keep their identity, citations, review state, and generation history.</p>
            </div>` as HTMLElement)
            this.inspectorEl.replaceChildren()
            if (this.entries.length === 0) {
                this.browserEl.appendChild(this.html`<div className="media-library-state">No Artifacts found.</div>` as HTMLElement)
            } else {
                const list = this.html`<div className="capability-library-section-items"></div>` as HTMLElement
                for (const entry of this.entries) list.appendChild(this.createRow(entry))
                this.browserEl.appendChild(list)
            }
            if (this.selectedAssetId) void this.renderInspector(this.selectedAssetId)
            else {this.inspectorEl.appendChild(this.html`<div className="media-library-inspector-empty">
                <strong>Select an Artifact</strong><span>Scope, review state, details, and history appear here.</span>
            </div>` as HTMLElement)}
        } catch (error) {
            this.destroyViews()
            this.options.onError(error)
            this.browserEl.replaceChildren(this.html`<div className="media-library-state media-library-state-error">Could not display Artifacts.</div>` as HTMLElement)
        }
    }

    private createRow(entry: ArtifactLibraryEntry): HTMLElement {
        const lifetime = this.viewLifetime
        const artifactTypeId = entry.meta.artifactTypeId!
        const host = this.html`<article
            className=${`capability-library-row artifact-library-row${this.selectedAssetId === entry.meta.assetId ? ' capability-library-row-selected' : ''}`}
            tabindex="0"
            data-side-panel-no-drag="true"
        ><div className="artifact-library-item-host"></div><button type="button" className="capability-library-row-action" data-action="inspect">Details</button></article>` as HTMLElement
        const itemHost = host.querySelector('.artifact-library-item-host') as HTMLElement
        const view = this.options.frontendRegistry.require(artifactTypeId).createLibraryItemView({
            container: itemHost,
            title: entry.meta.title,
            displayMetadata: entry.displayMetadata,
            scope: entry.meta.scope,
            onAddToCanvas: () => {
                if (!lifetime.signal.aborted) void this.insert(entry.meta)
            },
        })
        this.viewLifetime.own(() => view.destroy())
        const select = (): void => {
            this.selectedAssetId = entry.meta.assetId
            this.render()
        }
        const click = (event: MouseEvent) => {
            if ((event.target as HTMLElement).closest('[data-action="inspect"]')) {
                select()
                return
            }
            if ((event.target as HTMLElement).closest('button')) return
            select()
        }
        const keydown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            select()
        }
        host.addEventListener('click', click)
        host.addEventListener('keydown', keydown)
        lifetime.own(() => host.removeEventListener('click', click))
        lifetime.own(() => host.removeEventListener('keydown', keydown))
        return host
    }

    private async insert(meta: AssetMeta): Promise<void> {
        const lifetime = this.viewLifetime
        if (!this.mounted || lifetime.signal.aborted) return
        try {
            const inserted = await this.options.onInsertAsset?.(meta)
            if (lifetime.signal.aborted) return
            this.feedbackEl.textContent = inserted ? `Added ${meta.title} to the canvas.` : `Could not add ${meta.title}.`
        } catch (error) {
            if (lifetime.signal.aborted) return
            this.options.onError(error)
            this.feedbackEl.textContent = `Could not add ${meta.title}.`
        }
    }

    private async renderInspector(assetId: string): Promise<void> {
        const sequence = ++this.inspectorSequence
        const lifetime = this.viewLifetime.child()
        this.inspectorEl.replaceChildren(this.html`<div className="media-library-state">Loading Artifact…</div>` as HTMLElement)
        try {
            const asset = await this.options.assets.refresh(assetId, this.options.workspaceId)
            if (lifetime.signal.aborted || sequence !== this.inspectorSequence) return
            if ('error' in asset || !asset.artifact) {
                this.inspectorEl.replaceChildren(this.html`<div className="media-library-state media-library-state-error">Artifact unavailable.</div>` as HTMLElement)
                return
            }
            const snapshot = this.options.assets.getDocument(asset.assetId, 'capabilityArtifact')
            const frontend = this.options.frontendRegistry.get(asset.artifact.artifactTypeId)
            if (!snapshot || !frontend) {
                this.inspectorEl.replaceChildren(this.html`<div className="media-library-state media-library-state-error">Artifact definition unavailable.</div>` as HTMLElement)
                return
            }
            const detail = this.createInspector(asset)
            this.inspectorEl.replaceChildren(detail)
            const infoHost = detail.querySelector('.artifact-library-detail-info') as HTMLElement
            const view = frontend.createGeneratedOutputInfoView({ container: infoHost, document: snapshot.doc })
            lifetime.own(() => view.destroy())
            await this.mountHistory(asset, detail, lifetime)
        } catch (error) {
            if (lifetime.signal.aborted || sequence !== this.inspectorSequence) return
            this.options.onError(error)
            this.inspectorEl.replaceChildren(this.html`<div className="media-library-state media-library-state-error">Could not load Artifact details.</div>` as HTMLElement)
        }
    }

    private createInspector(asset: Asset): HTMLElement {
        const detail = this.html`<section className="media-library-detail artifact-library-detail" data-side-panel-no-drag="true">
            <button type="button" className="media-library-detail-back">Back</button>
            <label>Title</label><input type="text" className="media-library-detail-title" />
            <label>Scope</label><select className="media-library-detail-scope">
                <option value="workspace">Workspace</option><option value="user">Mine</option><option value="organization">Organization</option>
            </select>
            <p className="media-library-detail-state"></p>
            <div className="artifact-library-detail-info"></div>
            <div className="artifact-library-detail-review"></div>
            <div className="artifact-library-detail-history"></div>
        </section>` as HTMLElement
        const title = detail.querySelector('.media-library-detail-title') as HTMLInputElement
        const scope = detail.querySelector('.media-library-detail-scope') as HTMLSelectElement
        const state = detail.querySelector('.media-library-detail-state') as HTMLElement
        const review = detail.querySelector('.artifact-library-detail-review') as HTMLElement
        title.value = asset.title
        scope.value = asset.scope
        state.textContent = `${asset.artifact?.artifactTypeId ?? 'Artifact'} · ${asset.generatedOutputReview?.status ?? 'saved'} · ${asset.states.lifecycle}`
        if (asset.generatedOutputReview?.status === 'candidate') {
            const accept = this.html`<button type="button" className="capability-library-row-action capability-library-row-action-primary">Accept candidate</button>` as HTMLButtonElement
            this.listen(accept, 'click', () => void this.accept(asset, state))
            review.appendChild(accept)
        }
        this.listen(detail.querySelector('.media-library-detail-back')!, 'click', () => {
            this.selectedAssetId = null
            this.render()
        })
        this.listen(title, 'change', () => void this.updateTitle(asset, title, state))
        this.listen(scope, 'change', () => void this.updateScope(asset, scope, state))
        return detail
    }

    private async accept(asset: Asset, state: HTMLElement): Promise<void> {
        if (!this.options.onAcceptAsset) {
            state.textContent = 'Accept is available from the generated canvas output.'
            return
        }
        await runLibraryAction(this.viewLifetime.signal, () => this.options.onAcceptAsset!(asset), accepted => {
            state.textContent = accepted ? 'Accepted' : 'Accept failed'
            this.refresh()
        }, this.options.onError)
    }

    private async updateTitle(asset: Asset, input: HTMLInputElement, state: HTMLElement): Promise<void> {
        const title = input.value.trim()
        await runLibraryAction(this.viewLifetime.signal, () => this.options.assets.updateMetadata(asset.assetId, asset.revision, { title }), result => {
            state.textContent = 'error' in result ? `Title update failed: ${result.error}` : 'Title saved'
            if (!('error' in result)) this.refresh()
        }, this.options.onError)
    }

    private async updateScope(asset: Asset, select: HTMLSelectElement, state: HTMLElement): Promise<void> {
        const scope = select.value as Asset['scope']
        const scopeOwnerId = scope === 'workspace' ? this.options.workspaceId : scope === 'user' ? this.options.userId : asset.organizationId
        await runLibraryAction(this.viewLifetime.signal, () => this.options.assets.changeScope(asset.assetId, asset.revision, scope, scopeOwnerId), result => {
            state.textContent = 'error' in result ? `Scope update failed: ${result.error}` : 'Scope saved'
            if (!('error' in result)) this.refresh()
        }, this.options.onError)
    }

    private async mountHistory(asset: Asset, detail: HTMLElement, lifetime: Lifetime): Promise<void> {
        if (!asset.documents.provenance) return
        await this.options.assets.resumeDocument({ organizationId: asset.organizationId, assetId: asset.assetId, role: 'provenance' })
        if (lifetime.signal.aborted) return
        const snapshot = this.options.assets.getDocument(asset.assetId, 'provenance')
        if (!snapshot) return
        const history = this.options.mountHistory({
            host: detail.querySelector('.artifact-library-detail-history') as HTMLElement,
            asset,
            content: snapshot.doc,
            signal: lifetime.signal,
        })
        lifetime.own(() => history.destroy())
    }

    private listen(element: Element, type: string, callback: () => void): void {
        element.addEventListener(type, callback)
        this.viewLifetime.own(() => element.removeEventListener(type, callback))
    }

    private destroyViews(): void {
        this.inspectorSequence += 1
        const lifetime = this.viewLifetime
        this.viewLifetime = new Lifetime()
        lifetime.destroy()
    }
}

export function createArtifactLibraryPanel(options: ArtifactLibraryPanelOptions): ArtifactLibraryPanelInstance {
    return new ArtifactLibraryPanel(options)
}
