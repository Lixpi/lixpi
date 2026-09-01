import type { ProseMirrorJsonNode } from '@lixpi/prosemirror/shared/thread-doc'
import {
    ASSET_GENERATION_SEED_HELP_TEXT,
    type Asset,
} from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { createPureDropdown } from '@lixpi/ui-kit/components/dropdown'
import { createHelpTooltip } from '@lixpi/ui-kit/components/help-tooltip'
import { questionMarkCircleIcon } from '@lixpi/ui-kit/svg'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    mountAssetSubjectIdentityControl,
    type AssetSubjectIdentityControlOptions,
} from './asset-subject-identity-control.ts'
import {
    WorkspaceAssetContentEditor,
    type WorkspaceAssetEditorPorts,
} from './workspace-asset-editors.ts'

export type WorkspaceAssetDetailsPorts = WorkspaceAssetEditorPorts & {
    document: Document
    workspaceId: string
    userId: string
    tooltipHideDelayMs: number
    getContentDocument: (assetId: string) => { doc: ProseMirrorJsonNode; version: number } | undefined
    changeScope: (assetId: string, revision: number, scope: Asset['scope'], scopeOwnerId: string) => Promise<Asset | { error: string }>
    attestSubjectIdentity: AssetSubjectIdentityControlOptions['attestSubjectIdentity']
}

type ScopeOption = { title: string; scope: Asset['scope'] }
const scopeOptions: ScopeOption[] = [{ title: 'Workspace', scope: 'workspace' }, { title: 'Mine', scope: 'user' }, { title: 'Organization', scope: 'organization' }]

export class WorkspaceAssetDetails {
    readonly element: HTMLElement
    private readonly lifetime = new Lifetime()
    private readonly status: HTMLElement
    private readonly scope: ReturnType<typeof createPureDropdown>
    private changingScope = false

    constructor(private readonly asset: Asset, documentStorage: boolean, private readonly ports: WorkspaceAssetDetailsPorts) {
        const html = createDocumentHtml(ports.document)
        this.element = html`
            <section className="canvas-asset-details">
                <div className="canvas-asset-details-toolbar">
                    <span className="canvas-asset-details-heading">Asset details</span>
                    <div className="canvas-asset-scope-control">
                        <span className="canvas-asset-details-label">Scope</span>
                        <div className="canvas-asset-scope-dropdown"></div>
                    </div>
                </div>
                <div className="canvas-asset-storage-lineage">
                    <div className="canvas-asset-detail-row canvas-asset-subject-identity-row">
                        <span className="canvas-asset-diagnostics-label">Subject identity</span>
                        <div className="canvas-asset-subject-identity-control"></div>
                    </div>
                    <div className="canvas-asset-detail-row">
                        <span className="canvas-asset-diagnostics-label">Status</span>
                        <div className="canvas-asset-details-status"></div>
                    </div>
                    <div className="canvas-asset-detail-row">
                        <span className="canvas-asset-diagnostics-label canvas-asset-storage-label">Renditions</span>
                        <div className="canvas-asset-renditions"></div>
                    </div>
                    <div className="canvas-asset-detail-row">
                        <span className="canvas-asset-diagnostics-label">Lineage</span>
                        <div className="canvas-asset-lineage"></div>
                    </div>
                    <div className="canvas-asset-detail-row canvas-asset-seed-row">
                        <span className="canvas-asset-diagnostics-label canvas-asset-seed-label"></span>
                        <div className="canvas-asset-seed"></div>
                    </div>
                </div>
            </section>
        ` as HTMLElement
        this.status = this.find('.canvas-asset-details-status')
        this.lifetime.own(() => this.element.remove())
        try {
            this.reflectStatus(asset)
            const identity = mountAssetSubjectIdentityControl({
                host: this.find('.canvas-asset-subject-identity-control'),
                asset,
                attestSubjectIdentity: ports.attestSubjectIdentity,
                onUpdated: updated => this.reflectStatus(updated),
                onError: message => this.error(`Subject identity update failed: ${message}`),
            })
            this.lifetime.own(() => identity.destroy())
            const renditions = this.find('.canvas-asset-renditions')
            if (documentStorage) {
                this.find('.canvas-asset-storage-label').textContent = 'Documents'
                renditions.textContent = Object.keys(asset.documents).join(' · ') || 'No documents'
            } else {
                renditions.textContent = Object.entries(asset.media?.renditions ?? {}).map(([name, rendition]) => `${name}: ${rendition?.status ?? 'missing'}`).join(' · ') || 'No media renditions'
            }
            this.find('.canvas-asset-lineage').textContent = [
                asset.lineage?.sourceConversationAssetId ? `conversation ${asset.lineage.sourceConversationAssetId}` : '',
                asset.lineage?.parentAssetId ? `parent ${asset.lineage.parentAssetId}` : '',
                ...(asset.lineage?.sourceAssetIds ?? []).map(assetId => `source ${assetId}`),
            ].filter(Boolean).join('\n') || 'No lineage'
            const seed = asset.lineage?.generationSeed
            if (seed === undefined) this.find('.canvas-asset-seed-row').remove()
            else {
                const tooltip = createHelpTooltip({ icon: questionMarkCircleIcon, hideDelayMs: ports.tooltipHideDelayMs, label: 'Seed details', text: ASSET_GENERATION_SEED_HELP_TEXT, className: 'canvas-asset-seed-help' })
                this.lifetime.own(() => tooltip.destroy())
                const label = this.find('.canvas-asset-seed-label')
                label.textContent = 'Seed'
                label.appendChild(tooltip.dom)
                this.find('.canvas-asset-seed').textContent = String(seed)
            }
            this.scope = createPureDropdown({
                id: `asset-scope-${asset.assetId}-${crypto.randomUUID()}`,
                selectedValue: this.scopeOption(asset.scope),
                options: scopeOptions,
                theme: 'dark',
                ignoreColorValuesForOptions: true,
                ignoreColorValuesForSelectedValue: true,
                renderIconForSelectedValue: false,
                renderIconForOptions: false,
                mountToBody: false,
                disableAutoPositioning: true,
                onSelect: option => {
                    void this.changeScope(option.scope as Asset['scope'])
                },
            })
            this.lifetime.own(() => this.scope.destroy())
            this.find('.canvas-asset-scope-dropdown').appendChild(this.scope.dom)
            const snapshot = ports.getContentDocument(asset.assetId)
            if (asset.documents.content && snapshot) {
                const host = html`<div className="canvas-asset-content-editor nopan" data-help-tooltip="aria-description"></div>` as HTMLElement
                this.element.appendChild(host)
                const editor = new WorkspaceAssetContentEditor(host, snapshot.doc, { organizationId: asset.organizationId, workspaceId: ports.workspaceId, assetId: asset.assetId, role: 'content', baseVersion: snapshot.version }, ports.mountEditor)
                this.lifetime.own(() => editor.destroy())
            }
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    private find(selector: string): HTMLElement {
        return this.element.querySelector(selector)!
    }
    private scopeOption(scope: Asset['scope']): ScopeOption {
        return scopeOptions.find(option => option.scope === scope) ?? scopeOptions[0]!
    }

    private reflectStatus(asset: Asset): void {
        if (this.lifetime.signal.aborted) return
        this.status.classList.remove('is-error')
        this.status.textContent = `${asset.states.lifecycle} · ${asset.states.media} · ${asset.states.provenance}`
    }

    private error(message: string): void {
        if (this.lifetime.signal.aborted) return
        this.status.textContent = message
        this.status.classList.add('is-error')
    }

    private async changeScope(scope: Asset['scope']): Promise<void> {
        if (this.changingScope || this.lifetime.signal.aborted) return
        const current = this.ports.getAsset(this.asset.assetId)
        if (!current || current.scope === scope) return
        this.changingScope = true
        try {
            const ownerId = scope === 'workspace' ? this.ports.workspaceId : scope === 'user' ? this.ports.userId : current.organizationId
            const updated = await this.ports.changeScope(current.assetId, current.revision, scope, ownerId)
            if (this.lifetime.signal.aborted) return
            if ('error' in updated) {
                this.scope.update(this.scopeOption(current.scope))
                this.error(`Scope update failed: ${updated.error}`)
            } else {
                this.scope.update(this.scopeOption(updated.scope))
                this.reflectStatus(updated)
                this.ports.onChanged()
            }
        } catch (error) {
            if (!this.lifetime.signal.aborted) {
                this.scope.update(this.scopeOption(current.scope))
                this.error(`Scope update failed: ${error instanceof Error ? error.message : String(error)}`)
            }
        } finally {
            this.changingScope = false
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
