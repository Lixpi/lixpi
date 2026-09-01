import type {
    Asset,
    CapabilityArtifactCanvasNode,
} from '@lixpi/constants'
import type {
    CapabilityArtifactCanvasHost,
    CapabilityArtifactFrontendDefinition,
} from '@lixpi/capability-system/frontend'
import type { CapabilityArtifactSharedDefinition } from '@lixpi/capability-system/shared'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    createErrorPlaceholder,
    createLoadingPlaceholder,
} from '@lixpi/ui-kit/components/loading-placeholder'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import type { WorkspaceNodeShells } from './workspace-node-shells.ts'

type EditorRequest = Parameters<NonNullable<CapabilityArtifactCanvasHost['mountEditor']>>[0]
export type WorkspaceCapabilityEditorOptions = EditorRequest & {
    node: CapabilityArtifactCanvasNode
    asset: Asset
    version: number
    signal: AbortSignal
    onLeaseStateChange: (state: { readOnly: boolean }) => void
    onContentChange: () => void
}
export type WorkspaceCapabilityNodePorts = {
    ensureStyles: (document: Document) => void
    getAsset: (assetId: string) => Asset | undefined
    getDocument: (assetId: string) => { doc: object; version: number } | undefined
    refreshAsset: (assetId: string) => Promise<Asset | { error: string }>
    ensureAssetsLoaded: (assetIds: readonly string[]) => Promise<readonly Asset[]>
    getDefinitions: (artifactTypeId: string) => { frontend: CapabilityArtifactFrontendDefinition; shared: CapabilityArtifactSharedDefinition }
    createAssetReferenceView: CapabilityArtifactCanvasHost['createAssetReferenceView']
    mountEditor: (options: WorkspaceCapabilityEditorOptions) => ReturnType<NonNullable<CapabilityArtifactCanvasHost['mountEditor']>>
    onHeightChange: (nodeId: string, height: number) => void
    onError: (error: unknown, nodeId: string) => void
}

export class WorkspaceCapabilityNode {
    readonly element: HTMLElement
    private readonly host: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private content: Lifetime
    private referenceLoad = false
    private heightFrame: number | null = null

    constructor(private readonly node: CapabilityArtifactCanvasNode, shells: WorkspaceNodeShells, private readonly ports: WorkspaceCapabilityNodePorts) {
        const shell = shells.create(node, 'workspace-capability-artifact-node', { assetId: node.assetId, artifactTypeId: node.artifactTypeId })
        this.element = shell.nodeEl
        shell.own(() => this.destroy())
        shell.dragOverlay.className = 'capability-artifact-drag-overlay nopan'
        const html = createDocumentHtml(this.element.ownerDocument)
        this.host = html`<div className="capability-artifact-node-host nopan"></div>` as HTMLDivElement
        this.element.append(this.host)
        this.lifetime.own(() => this.host.remove())
        this.lifetime.own(() => this.cancelHeight())
        this.content = this.lifetime.child()
        try {
            ports.ensureStyles(this.element.ownerDocument)
            if (!this.render()) void this.refresh()
        } catch (error) {
            this.lifetime.destroy()
            throw error
        }
    }

    private resetContent(): Lifetime {
        this.cancelHeight()
        this.content.destroy()
        this.content = this.lifetime.child()
        this.host.replaceChildren()
        return this.content
    }

    private render(): boolean {
        if (this.lifetime.signal.aborted) return false
        const content = this.resetContent()
        const asset = this.ports.getAsset(this.node.assetId)
        const snapshot = this.ports.getDocument(this.node.assetId)
        if (!asset || !snapshot) {
            const loading = createLoadingPlaceholder({ document: this.element.ownerDocument })
            content.own(() => loading.destroy())
            this.host.append(loading.dom)
            return false
        }
        try {
            const { shared, frontend } = this.ports.getDefinitions(this.node.artifactTypeId)
            shared.assertInitialDocument(snapshot.doc)
            void this.ensureReferences(shared.collectReferencedAssetIds(snapshot.doc))
            const view = frontend.createCanvasNodeView({
                container: this.host,
                node: this.node,
                document: snapshot.doc,
                createAssetReferenceView: request => {
                    if (content.signal.aborted) return undefined
                    const reference = this.ports.createAssetReferenceView(request)
                    if (!reference) return undefined
                    return { dom: reference.dom, destroy: content.own(() => reference.destroy()) }
                },
                onHeightChange: height => this.scheduleHeight(height, content),
                mountEditor: request => {
                    content.signal.throwIfAborted()
                    const onContentChange = () => this.scheduleHeight(this.host.scrollHeight, content)
                    const editor = this.ports.mountEditor({
                        ...request,
                        node: this.node,
                        asset,
                        version: snapshot.version,
                        signal: content.signal,
                        onLeaseStateChange: state => {
                            if (!content.signal.aborted) this.element.classList.toggle('is-asset-lease-read-only', state.readOnly)
                        },
                        onContentChange,
                    })
                    const releaseEditor = content.own(() => editor.destroy())
                    const observer = new ResizeObserver(onContentChange)
                    const releaseObserver = content.own(() => observer.disconnect())
                    observer.observe(request.container)
                    return {
                        updateDocument: document => {
                            if (!content.signal.aborted) editor.updateDocument(document)
                        },
                        destroy: () => {
                            releaseObserver()
                            releaseEditor()
                        },
                    }
                },
            })
            content.own(() => view.destroy())
        } catch (error) {
            this.showError(error, 'This Artifact cannot be rendered', () => {
                this.render()
            })
        }
        return true
    }

    private async refresh(): Promise<void> {
        try {
            const asset = await this.ports.refreshAsset(this.node.assetId)
            if (this.lifetime.signal.aborted) return
            if ('error' in asset) throw new Error(asset.error)
            await this.ports.ensureAssetsLoaded(asset.lineage?.sourceAssetIds ?? [])
            if (!this.lifetime.signal.aborted) this.render()
        } catch (error) {
            if (!this.lifetime.signal.aborted) {
                this.showError(error, 'This Artifact could not be loaded', () => {
                    void this.refresh()
                })
            }
        }
    }

    private cancelHeight(): void {
        if (this.heightFrame !== null) cancelAnimationFrame(this.heightFrame)
        this.heightFrame = null
    }

    private scheduleHeight(height: number, content: Lifetime): void {
        if (content.signal.aborted) return
        this.cancelHeight()
        this.heightFrame = requestAnimationFrame(() => {
            this.heightFrame = null
            if (!content.signal.aborted) this.ports.onHeightChange(this.node.nodeId, height)
        })
    }

    private async ensureReferences(assetIds: readonly string[]): Promise<void> {
        if (this.referenceLoad || this.lifetime.signal.aborted) return
        const missing = [...new Set(assetIds)].filter(assetId => !this.ports.getAsset(assetId))
        if (!missing.length) return
        this.referenceLoad = true
        try {
            await this.ports.ensureAssetsLoaded(missing)
            if (!this.lifetime.signal.aborted && missing.some(assetId => this.ports.getAsset(assetId))) this.render()
        } catch (error) {
            if (!this.lifetime.signal.aborted) this.ports.onError(error, this.node.nodeId)
        } finally {
            this.referenceLoad = false
        }
    }

    private showError(error: unknown, message: string, retry: () => void): void {
        const content = this.resetContent()
        this.ports.onError(error, this.node.nodeId)
        if (content.signal.aborted) return
        const placeholder = createErrorPlaceholder({ document: this.element.ownerDocument, message, retryLabel: 'Retry', onRetry: retry })
        content.own(() => placeholder.destroy())
        this.host.append(placeholder.dom)
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
