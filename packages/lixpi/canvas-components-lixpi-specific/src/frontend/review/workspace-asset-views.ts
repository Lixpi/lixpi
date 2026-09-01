import type { CanvasNode } from '@lixpi/constants'
import { WorkspaceAssetMetadataEditor } from './workspace-asset-editors.ts'
import {
    WorkspaceAssetDetails,
    type WorkspaceAssetDetailsPorts,
} from './workspace-asset-details.ts'

type AssetNode = Extract<CanvasNode, { type: 'image' | 'video' | 'capabilityArtifact' }>

// Each canvas chrome or details sidebar owns its own collection of Asset views.
export class WorkspaceAssetViews {
    private readonly views = new Map<string, { destroy: () => void }>()
    private destroyed = false

    constructor(private readonly ports: () => WorkspaceAssetDetailsPorts) {}

    mountMetadata(node: AssetNode, host: HTMLElement, mode: 'node' | 'details'): () => void {
        if (this.destroyed) return () => {}
        const ports = this.ports()
        if (!ports.getAsset(node.assetId)) return () => {}
        const key = `${node.nodeId}:metadata:${mode}`
        this.remove(key)
        const view = new WorkspaceAssetMetadataEditor(node.assetId, host, mode, ports)
        this.views.set(key, view)
        return () => {
            if (this.views.get(key) === view) this.views.delete(key)
            view.destroy()
        }
    }

    createDetails(node: AssetNode): HTMLElement | null {
        if (this.destroyed) return null
        const ports = this.ports()
        const asset = ports.getAsset(node.assetId)
        if (!asset) return null
        const key = `${node.nodeId}:details`
        this.remove(key)
        const view = new WorkspaceAssetDetails(asset, node.type === 'capabilityArtifact', ports)
        this.views.set(key, view)
        return view.element
    }

    private remove(key: string): void {
        const view = this.views.get(key)
        this.views.delete(key)
        view?.destroy()
    }

    clear(): void {
        const views = [...this.views.values()]
        this.views.clear()
        const errors: unknown[] = []
        for (const view of views) {
            try {
                view.destroy()
            } catch (error) {
                errors.push(error)
            }
        }
        if (errors.length) throw new AggregateError(errors, 'Asset view cleanup failed')
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.clear()
    }
}
