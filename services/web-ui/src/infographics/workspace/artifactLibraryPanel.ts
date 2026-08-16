'use strict'

import type {
    Asset,
    AssetMeta,
    CapabilityJsonValue,
} from '@lixpi/constants'

import {
    capabilityArtifactFrontendRegistry,
    capabilityArtifactSharedRegistry,
    ensureCapabilityStyles,
} from '$src/installed-capabilities.ts'
import {
    mountReadOnlyAiChatThreadProjection,
    type ReadOnlyAiChatThreadRendererInstance,
} from '$src/components/proseMirror/readOnlyAiChatThreadRenderer.ts'
import AssetService from '$src/services/asset-service.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { userStore } from '$src/stores/userStore.ts'
import { html } from '$src/utils/domTemplates.ts'
import type { AiUserMessageContextPreviewRenderer } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiUserMessageNode.ts'
import type { PromptReferencePreviewRenderer } from '$src/components/proseMirror/plugins/promptReferencePickerPlugin/index.ts'
import { createExecutionTraceTimelineDetailAdapter } from '$src/components/executionTrace/index.ts'
import { createMediaGenerationProgress } from '$src/infographics/workspace/mediaGenerationProgress.ts'

type ArtifactLibraryEntry = {
    meta: AssetMeta
    displayMetadata: Record<string, CapabilityJsonValue>
}

export type ArtifactLibraryPanelOptions = {
    workspaceId: string
    onInsertAsset?: (item: AssetMeta) => Promise<boolean>
    onAcceptAsset?: (item: Asset) => Promise<boolean>
    contextPreview?: AiUserMessageContextPreviewRenderer
    promptReferencePreviewRenderer?: PromptReferencePreviewRenderer
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
    private readonly assetService = new AssetService()
    private entries: ArtifactLibraryEntry[] = []
    private selectedAssetId: string | null = null
    private mounted = false
    private loadSequence = 0
    private mountedViews: Array<{ destroy: () => void }> = []
    private historyRenderer: ReadOnlyAiChatThreadRendererInstance | null = null

    constructor(private readonly options: ArtifactLibraryPanelOptions) {
        this.rootEl = html`<div className="media-library-panel media-library-panel-embedded artifact-library-panel nopan nowheel">
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
        ensureCapabilityStyles(hostEl.ownerDocument)
        if (this.rootEl.parentElement !== hostEl) hostEl.appendChild(this.rootEl)
        this.mounted = true
        if (this.entries.length > 0) this.render()
        else void this.load()
    }

    showAsset(assetId: string): void {
        this.selectedAssetId = assetId
        if (this.mounted) this.render()
    }

    refresh(): void {
        if (this.mounted) void this.load()
    }

    unmount(): void {
        this.mounted = false
        this.loadSequence += 1
        this.destroyViews()
        this.rootEl.remove()
    }

    destroy(): void {
        this.unmount()
        this.entries = []
        this.selectedAssetId = null
    }

    private async load(): Promise<void> {
        const sequence = ++this.loadSequence
        this.browserEl.replaceChildren(html`<div className="media-library-state">Loading Artifacts…</div>`)
        try {
            const metadata: AssetMeta[] = []
            let cursor: string | undefined
            do {
                const page = await this.assetService.list({
                    workspaceId: this.options.workspaceId,
                    primaryCategory: 'capabilityArtifact',
                    limit: 100,
                    cursor,
                })
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
            console.error('Failed to load Capability Artifacts:', error)
            this.browserEl.replaceChildren(html`<div className="media-library-state media-library-state-error">Could not load Artifacts.</div>`)
        }
    }

    private async loadEntry(meta: AssetMeta): Promise<ArtifactLibraryEntry | null> {
        const asset = await this.assetService.refresh(meta.assetId, this.options.workspaceId)
        if ('error' in asset || !asset.artifact) return null
        const definition = capabilityArtifactSharedRegistry.get(asset.artifact.artifactTypeId)
        const snapshot = assetDocumentsStore.get(asset.assetId, 'capabilityArtifact')
        if (!definition || !snapshot || definition.schemaVersion !== asset.artifact.schemaVersion) return null
        definition.assertInitialDocument(snapshot.doc)
        return { meta, displayMetadata: definition.buildCatalogMetadata(snapshot.doc) }
    }

    private render(): void {
        if (!this.mounted) return
        this.destroyViews()
        this.browserEl.replaceChildren(html`<div className="media-library-browser-intro">
            <h2>Artifacts</h2>
            <p>Reusable structured outputs keep their identity, citations, review state, and generation history.</p>
        </div>`)
        this.inspectorEl.replaceChildren()
        if (this.entries.length === 0) {
            this.browserEl.appendChild(html`<div className="media-library-state">No Artifacts found.</div>`)
        } else {
            const list = html`<div className="capability-library-section-items"></div>` as HTMLElement
            for (const entry of this.entries) list.appendChild(this.createRow(entry))
            this.browserEl.appendChild(list)
        }
        if (this.selectedAssetId) void this.renderInspector(this.selectedAssetId)
        else this.inspectorEl.appendChild(html`<div className="media-library-inspector-empty">
            <strong>Select an Artifact</strong><span>Scope, review state, details, and history appear here.</span>
        </div>`)
    }

    private createRow(entry: ArtifactLibraryEntry): HTMLElement {
        const artifactTypeId = entry.meta.artifactTypeId!
        const host = html`<article
            className=${`capability-library-row artifact-library-row${this.selectedAssetId === entry.meta.assetId ? ' capability-library-row-selected' : ''}`}
            tabindex="0"
            data-side-panel-no-drag="true"
        ><div className="artifact-library-item-host"></div><button type="button" className="capability-library-row-use" data-action="inspect">Details</button></article>` as HTMLElement
        const itemHost = host.querySelector('.artifact-library-item-host') as HTMLElement
        const view = capabilityArtifactFrontendRegistry.require(artifactTypeId).createLibraryItemView({
            container: itemHost,
            title: entry.meta.title,
            displayMetadata: entry.displayMetadata,
            scope: entry.meta.scope,
            onAddToCanvas: () => void this.insert(entry.meta),
        })
        this.mountedViews.push(view)
        const select = (): void => {
            this.selectedAssetId = entry.meta.assetId
            this.render()
        }
        host.addEventListener('click', event => {
            if ((event.target as HTMLElement).closest('[data-action="inspect"]')) {
                select()
                return
            }
            if ((event.target as HTMLElement).closest('button')) return
            select()
        })
        host.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            select()
        })
        return host
    }

    private async insert(meta: AssetMeta): Promise<void> {
        try {
            const inserted = await this.options.onInsertAsset?.(meta)
            this.feedbackEl.textContent = inserted ? `Added ${meta.title} to the canvas.` : `Could not add ${meta.title}.`
        } catch (error) {
            console.error('Failed to add Capability Artifact:', error)
            this.feedbackEl.textContent = `Could not add ${meta.title}.`
        }
    }

    private async renderInspector(assetId: string): Promise<void> {
        this.inspectorEl.replaceChildren(html`<div className="media-library-state">Loading Artifact…</div>`)
        const asset = await this.assetService.refresh(assetId, this.options.workspaceId)
        if (!this.mounted || this.selectedAssetId !== assetId) return
        if ('error' in asset || !asset.artifact) {
            this.inspectorEl.replaceChildren(html`<div className="media-library-state media-library-state-error">Artifact unavailable.</div>`)
            return
        }
        const snapshot = assetDocumentsStore.get(asset.assetId, 'capabilityArtifact')
        const frontend = capabilityArtifactFrontendRegistry.get(asset.artifact.artifactTypeId)
        if (!snapshot || !frontend) {
            this.inspectorEl.replaceChildren(html`<div className="media-library-state media-library-state-error">Artifact definition unavailable.</div>`)
            return
        }
        const detail = this.createInspector(asset)
        this.inspectorEl.replaceChildren(detail)
        const infoHost = detail.querySelector('.artifact-library-detail-info') as HTMLElement
        this.mountedViews.push(frontend.createGeneratedOutputInfoView({ container: infoHost, document: snapshot.doc }))
        await this.mountHistory(asset, detail)
    }

    private createInspector(asset: Asset): HTMLElement {
        const detail = html`<section className="media-library-detail artifact-library-detail" data-side-panel-no-drag="true">
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
            const accept = html`<button type="button" className="capability-library-row-use">Accept candidate</button>` as HTMLButtonElement
            accept.addEventListener('click', () => void this.accept(asset, state))
            review.appendChild(accept)
        }
        detail.querySelector('.media-library-detail-back')?.addEventListener('click', () => {
            this.selectedAssetId = null
            this.render()
        })
        title.addEventListener('change', () => void this.updateTitle(asset, title, state))
        scope.addEventListener('change', () => void this.updateScope(asset, scope, state))
        return detail
    }

    private async accept(asset: Asset, state: HTMLElement): Promise<void> {
        if (!this.options.onAcceptAsset) {
            state.textContent = 'Accept is available from the generated canvas output.'
            return
        }
        state.textContent = await this.options.onAcceptAsset(asset) ? 'Accepted' : 'Accept failed'
        this.refresh()
    }

    private async updateTitle(asset: Asset, input: HTMLInputElement, state: HTMLElement): Promise<void> {
        const result = await this.assetService.updateMetadata(asset.assetId, asset.revision, { title: input.value.trim() })
        state.textContent = 'error' in result ? `Title update failed: ${result.error}` : 'Title saved'
        if (!('error' in result)) this.refresh()
    }

    private async updateScope(asset: Asset, select: HTMLSelectElement, state: HTMLElement): Promise<void> {
        const scope = select.value as Asset['scope']
        const scopeOwnerId = scope === 'workspace'
            ? this.options.workspaceId
            : scope === 'user'
                ? userStore.getData('userId') as string
                : asset.organizationId
        const result = await this.assetService.changeScope(asset.assetId, asset.revision, scope, scopeOwnerId)
        state.textContent = 'error' in result ? `Scope update failed: ${result.error}` : 'Scope saved'
        if (!('error' in result)) this.refresh()
    }

    private async mountHistory(asset: Asset, detail: HTMLElement): Promise<void> {
        if (!asset.documents.provenance) return
        await this.assetService.resumeDocument({ organizationId: asset.organizationId, assetId: asset.assetId, role: 'provenance' })
        if (!detail.isConnected || this.selectedAssetId !== asset.assetId) return
        const snapshot = assetDocumentsStore.get(asset.assetId, 'provenance')
        if (!snapshot) return
        this.historyRenderer = mountReadOnlyAiChatThreadProjection({
            mount: detail.querySelector('.artifact-library-detail-history') as HTMLElement,
            content: snapshot.doc as never,
            threadId: asset.lineage?.sourceConversationAssetId ?? asset.assetId,
            documentType: 'assetProvenance',
            contextPreview: this.options.contextPreview,
            promptReferencePreviewRenderer: this.options.promptReferencePreviewRenderer,
            mediaGenerationProgress: ({ id, state, showSummaryWhenCollapsedItemIds }) => createMediaGenerationProgress({
                id: `provenance:${asset.assetId}:${id}`,
                state,
                defaultExpanded: true,
                showSummaryWhenCollapsedItemIds,
                ...createExecutionTraceTimelineDetailAdapter({
                    ...(this.options.promptReferencePreviewRenderer
                        ? { previewRenderer: this.options.promptReferencePreviewRenderer }
                        : {}),
                }),
            }),
        })
    }

    private destroyViews(): void {
        for (const view of this.mountedViews) view.destroy()
        this.mountedViews = []
        this.historyRenderer?.destroy()
        this.historyRenderer = null
    }
}

export function createArtifactLibraryPanel(options: ArtifactLibraryPanelOptions): ArtifactLibraryPanelInstance {
    return new ArtifactLibraryPanel(options)
}
