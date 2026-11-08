import {
    type ProseMirrorJsonNode,
} from '@lixpi/prosemirror/shared/thread-doc'
import {
    type Asset,
} from '@lixpi/constants'
import { collectProseMirrorText } from '@lixpi/prosemirror'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'

export type WorkspaceAssetEditorRequest = {
    host: HTMLElement
    content: ProseMirrorJsonNode
    documentType: 'assetTitle' | 'assetMetadata' | 'assetContent'
    signal: AbortSignal
    onChange: (content: ProseMirrorJsonNode) => void
    authority?: {
        organizationId: string
        workspaceId: string
        assetId: string
        role: 'content'
        baseVersion: number
        onLeaseStateChange: (state: {
            readOnly: boolean
            holderWorkspaceId?: string
            expiresAt?: number
        }) => void
    }
}

export type WorkspaceAssetEditorPorts = {
    getAsset: (assetId: string) => Asset | undefined
    mountEditor: (request: WorkspaceAssetEditorRequest) => { destroy: () => void }
    updateMetadata: (
        assetId: string,
        revision: number,
        patch: {
            title: string
            descriptor?: Asset['descriptor']
        },
    ) => Promise<Asset | { error: string }>
    onChanged: () => void
    onError: (error: unknown) => void
}

export const buildAssetMetadataEditorDocument = (
    asset: Asset,
    mode: 'node' | 'details',
): ProseMirrorJsonNode => {
    const title = asset.title.trim()
    const description = asset.descriptor?.summary?.trim() ?? ''

    return {
        type: 'doc',
        content: [
            {
                type: 'documentTitle',
                ...(title ? { content: [{
                    type: 'text',
                    text: title,
                }] } : {}),
            },
            ...(mode === 'details' ? [{
                type: 'paragraph',
                ...(description ? { content: [{
                    type: 'text',
                    text: description,
                }] } : {}),
            }] : []),
        ],
    }
}

export const readAssetMetadataEditorDocument = (value: ProseMirrorJsonNode): {
    title: string
    description?: string
} => {
    const title = value.content?.find(node => node.type === 'documentTitle')
    const description = value.content?.find(node => node.type === 'paragraph')

    return {
        title: collectProseMirrorText(title).trim(),
        ...(description ? { description: collectProseMirrorText(description).trim() } : {}),
    }
}

// A metadata editor owns its draft and focus listener. Submitted writes belong
// to the transport port; disposal suppresses view callbacks, not accepted writes.
export class WorkspaceAssetMetadataEditor {
    private readonly lifetime = new Lifetime()
    private draft: ProseMirrorJsonNode
    private requested = false
    private committing = false

    constructor(
        private readonly assetId: string,
        host: HTMLElement,
        mode: 'node' | 'details',
        private readonly ports: WorkspaceAssetEditorPorts,
    ) {
        const asset = ports.getAsset(assetId)

        if (!asset)
            throw new Error(`Missing Asset: ${assetId}`)

        this.draft = buildAssetMetadataEditorDocument(asset, mode)

        try {
            const editor = ports.mountEditor({
                host,
                content: this.draft,
                documentType: mode === 'node' ? 'assetTitle' : 'assetMetadata',
                signal: this.lifetime.signal,
                onChange: content => {
                    if (!this.lifetime.signal.aborted)
                        this.draft = content
                },
            })
            this.lifetime.own(() => editor.destroy())
            const blur = (event: FocusEvent) => {
                const next = event.relatedTarget
                const NodeType = host.ownerDocument.defaultView?.Node

                if (
                    NodeType
                    && next instanceof NodeType
                    && host.contains(next)
                )
                    return

                this.requested = true
                void this.commit()
            }
            host.addEventListener('focusout', blur)
            this.lifetime.own(() => host.removeEventListener('focusout', blur))
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    private async commit(): Promise<void> {
        if (
            this.committing
            || this.lifetime.signal.aborted
        )
            return

        this.committing = true

        try {
            while (
                this.requested
                && !this.lifetime.signal.aborted
            ) {
                this.requested = false
                const current = this.ports.getAsset(this.assetId)

                if (!current)
                    return

                const metadata = readAssetMetadataEditorDocument(this.draft)

                if (!metadata.title)
                    continue

                const descriptionChanged = metadata.description !== undefined && metadata.description !== (current.descriptor?.summary ?? '')

                if (
                    metadata.title === current.title
                    && !descriptionChanged
                )
                    continue

                const descriptor = current.descriptor
                    && metadata.description !== undefined
                    ? {
                        ...current.descriptor,
                        summary: metadata.description,
                        updatedAt: Date.now(),
                    }
                    : undefined
                const updated = await this.ports.updateMetadata(
                    current.assetId,
                    current.revision,
                    {
                        title: metadata.title,
                        ...(descriptor ? { descriptor } : {}),
                    },
                )

                if (this.lifetime.signal.aborted)
                    return

                if ('error' in updated)
                    this.ports.onError(
                        new Error(updated.error),
                    )
                else
                    this.ports.onChanged()
            }
        } catch (error) {
            if (!this.lifetime.signal.aborted)
                this.ports.onError(error)
        } finally {
            this.committing = false
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

export class WorkspaceAssetContentEditor {
    private readonly lifetime = new Lifetime()

    constructor(
        host: HTMLElement,
        content: ProseMirrorJsonNode,
        authority: Omit<NonNullable<WorkspaceAssetEditorRequest['authority']>, 'onLeaseStateChange'>,
        mount: WorkspaceAssetEditorPorts['mountEditor'],
    ) {
        try {
            const editor = mount({
                host,
                content,
                documentType: 'assetContent',
                signal: this.lifetime.signal,
                onChange: () => {},
                authority: {
                    ...authority,
                    onLeaseStateChange: state => {
                        if (this.lifetime.signal.aborted)
                            return

                        host.classList.toggle('is-read-only', state.readOnly)
                        const description = state.readOnly ? `Read-only${state.holderWorkspaceId ? `; lease held by ${state.holderWorkspaceId}` : ''}` : ''

                        if (description)
                            host.setAttribute('aria-description', description)
                        else
                            host.removeAttribute('aria-description')
                    },
                },
            })
            this.lifetime.own(() => editor.destroy())
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}
