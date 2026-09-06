import {
    type DocumentCanvasNode,
} from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    createErrorPlaceholder,
    createLoadingPlaceholder,
} from '@lixpi/ui-kit/components/loading-placeholder'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type WorkspaceNodeShells,
} from './workspace-node-shells.ts'

export type WorkspaceDocument = {
    documentId: string
    organizationId: string
    title: string
    content?: object
    proseMirrorVersion?: number
}
export type WorkspaceDocumentLeaseState = {
    readOnly: boolean
    holderWorkspaceId?: string
    expiresAt?: number
}
export type WorkspaceDocumentEditorOptions = {
    node: DocumentCanvasNode
    document: WorkspaceDocument
    container: HTMLDivElement
    signal: AbortSignal
    onLeaseStateChange: (state: WorkspaceDocumentLeaseState) => void
}
export type WorkspaceDocumentNodesOptions = {
    mountEditor: (options: WorkspaceDocumentEditorOptions) => { destroy: () => void }
    onError: (
        error: unknown,
        nodeId: string,
    ) => void
}

export class WorkspaceDocumentNodes {
    private readonly views = new Map<string, WorkspaceDocumentNode>()
    private destroyed = false

    constructor(
        private readonly shells: WorkspaceNodeShells,
        private readonly options: WorkspaceDocumentNodesOptions,
    ) {}

    create(
        node: DocumentCanvasNode,
        document: WorkspaceDocument | undefined,
    ): HTMLElement {
        if (this.destroyed)
            throw new Error('Workspace document nodes are disposed')

        const shell = this.shells.create(
            node,
            undefined,
            { assetId: node.assetId },
        )
        const view = new WorkspaceDocumentNode(
            node,
            shell.nodeEl,
            document,
            this.options,
        )
        this.views.set(node.nodeId, view)
        shell.dragOverlay.className = 'document-drag-overlay nopan'
        shell.own(() => {
            if (this.views.get(node.nodeId) === view)
                this.views.delete(node.nodeId)

            view.destroy()
        })

        return shell.nodeEl
    }

    syncDocuments(documents: readonly WorkspaceDocument[]): void {
        const byId = new Map(
            documents.map(document => [document.documentId, document]),
        )

        for (const view of this.views.values()) view.setDocument(
            byId.get(view.assetId),
        )
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true

        for (const view of this.views.values()) view.destroy()

        this.views.clear()
    }
}

class WorkspaceDocumentNode {
    readonly assetId: string
    private readonly container: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private contentLifetime: Lifetime
    private document: WorkspaceDocument | undefined
    private mounted = false

    constructor(
        private readonly node: DocumentCanvasNode,
        private readonly element: HTMLElement,
        document: WorkspaceDocument | undefined,
        private readonly options: WorkspaceDocumentNodesOptions,
    ) {
        this.assetId = node.assetId
        const html = createDocumentHtml(element.ownerDocument)
        this.container = html`<div
                className="document-node-editor nopan"
                data-help-tooltip="aria-description"
            ></div>` as HTMLDivElement
        element.append(this.container)
        this.lifetime.own(() => this.container.remove())
        this.contentLifetime = this.lifetime.child()

        try {
            this.setDocument(document)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    setDocument(document: WorkspaceDocument | undefined): void {
        if (
            this.lifetime.signal.aborted
            || this.mounted
        )
            return

        this.document = document
        this.contentLifetime.destroy()
        this.contentLifetime = this.lifetime.child()
        this.container.replaceChildren()

        if (document?.content === undefined) {
            const loading = createLoadingPlaceholder({ document: this.element.ownerDocument })
            this.contentLifetime.own(() => loading.destroy())
            this.container.append(loading.dom)

            return
        }

        const content = this.contentLifetime

        try {
            const editor = this.options.mountEditor({
                node: this.node,
                document,
                container: this.container,
                signal: content.signal,
                onLeaseStateChange: state => {
                    if (!content.signal.aborted)
                        this.setLease(state)
                },
            })
            content.own(() => editor.destroy())
            this.mounted = true
        } catch (error) {
            content.destroy()
            this.options.onError(error, this.node.nodeId)

            if (this.lifetime.signal.aborted)
                return

            this.contentLifetime = this.lifetime.child()
            const placeholder = createErrorPlaceholder({
                document: this.element.ownerDocument,
                message: 'Failed to load editor',
                retryLabel: 'Retry',
                onRetry: () => this.setDocument(this.document),
            })
            this.contentLifetime.own(() => placeholder.destroy())
            this.container.replaceChildren(placeholder.dom)
        }
    }

    private setLease(state: WorkspaceDocumentLeaseState): void {
        this.element.classList.toggle('is-asset-lease-read-only', state.readOnly)
        const holder = state.holderWorkspaceId ? ` by workspace ${state.holderWorkspaceId}` : ''
        const expiry = state.expiresAt ? ` until ${new Date(state.expiresAt).toLocaleTimeString()}` : ''
        const description = state.readOnly ? `Read-only: Asset edit lease is held${holder}${expiry}` : ''

        if (description)
            this.container.setAttribute('aria-description', description)
        else
            this.container.removeAttribute('aria-description')
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
