import {
    type CanvasNode,
    type CanvasState,
    type ImageCanvasNode,
    type VideoCanvasNode,
} from '@lixpi/constants'
import {
    type Lifetime,
} from '@lixpi/canvas-engine/frontend/runtime'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import {
    type WorkspaceCanvasCallbacks,
} from './workspace-canvas-contracts.ts'
import {
    type WorkspaceCanvasHost,
} from './workspace-canvas-host.ts'

export type WorkspaceMediaReplacementPorts = {
    host: WorkspaceCanvasHost
    document: Document
    lifetime: Lifetime
    canAct: () => boolean
    getWorkspaceId: () => string
    getSceneKey: () => string
    isCurrentScene: (workspaceId: string, sceneKey: string) => boolean
    getState: () => CanvasState | null
    findNode: (nodeId: string) => CanvasNode | undefined
    detach?: WorkspaceCanvasCallbacks['onAssetDetach']
    attach?: WorkspaceCanvasCallbacks['onAssetAttach']
    commitTransient: (state: CanvasState) => void
    reportError: (message: string, error: unknown) => void
}

export class WorkspaceMediaReplacement {
    private readonly html: ReturnType<typeof createDocumentHtml>

    constructor(private readonly ports: WorkspaceMediaReplacementPorts) {
        this.html = createDocumentHtml(ports.document)
    }

    download = async (assetId: string, rendition: string, attachment: boolean): Promise<void> => {
        if (!this.ports.canAct()) return
        try {
            await this.ports.host.media.download({
                assetId,
                rendition,
                attachment,
                document: this.ports.document,
                signal: this.ports.lifetime.signal,
            })
        } catch (error) {
            if (this.ports.canAct()) this.ports.reportError('Canvas download failed:', error)
        }
    }

    choose = (nodeId: string): void => {
        if (!this.ports.canAct()) return
        const node = this.ports.findNode(nodeId)
        if (!node || (node.type !== 'image' && node.type !== 'video')) return
        const workspaceId = this.ports.getWorkspaceId()
        const sceneKey = this.ports.getSceneKey()
        const pending = this.ports.lifetime.child()
        const input = this.html`<input type="file" accept=${node.type === 'video' ? 'video/mp4' : 'image/*'} style=${{ display: 'none' }}></input>` as HTMLInputElement
        const current = () => !pending.signal.aborted && this.ports.isCurrentScene(workspaceId, sceneKey)
        const changed = () => {
            const file = input.files?.[0]
            input.remove()
            if (!file || !file.type.startsWith(node.type === 'video' ? 'video/' : 'image/') || !current()) {
                pending.destroy()
                return
            }
            void this.replace(node, file, workspaceId, current, pending)
        }
        const cancelled = () => pending.destroy()
        pending.own(() => input.remove())
        input.addEventListener('change', changed, { once: true })
        input.addEventListener('cancel', cancelled, { once: true })
        pending.own(() => input.removeEventListener('change', changed))
        pending.own(() => input.removeEventListener('cancel', cancelled))
        try {
            this.ports.document.body.append(input)
            input.click()
        } catch (error) {
            pending.destroy()
            throw error
        }
    }

    private replace = async (
        node: ImageCanvasNode | VideoCanvasNode,
        file: File,
        workspaceId: string,
        current: () => boolean,
        pending: Lifetime,
    ): Promise<void> => {
        try {
            const nodeStillCurrent = () =>
                current() && this.ports.getState()?.nodes.some(candidate => (
                        candidate.nodeId === node.nodeId && 'assetId' in candidate && candidate.assetId === node.assetId
                    )
                    ) === true
            const uploaded = await this.ports.host.media.uploadReplacement({
                workspaceId,
                file,
                signal: pending.signal,
                isCurrent: nodeStillCurrent,
            })
            const state = this.ports.getState()
            if (!uploaded?.assetId || uploaded.kind !== node.type || !nodeStillCurrent() || !state || !this.ports.detach || !this.ports.attach) return
            const detachedState: CanvasState = {
                ...state,
                nodes: state.nodes.filter(candidate => candidate.nodeId !== node.nodeId),
                edges: state.edges.filter(edge => edge.sourceNodeId !== node.nodeId && edge.targetNodeId !== node.nodeId),
            }
            const committedDetachedState = await this.ports.detach({
                assetId: node.assetId,
                nodeId: node.nodeId,
                removedNodeIds: [node.nodeId],
                canvasState: detachedState,
            })
            if (!current()) return
            this.ports.commitTransient(committedDetachedState)
            if (!current()) return
            const attachedState: CanvasState = {
                ...committedDetachedState,
                nodes: [...committedDetachedState.nodes, { ...node, assetId: uploaded.assetId }],
                edges: state.edges,
            }
            const committedAttachedState = await this.ports.attach({
                assetId: uploaded.assetId,
                nodeId: node.nodeId,
                canvasState: attachedState,
            })
            if (current()) this.ports.commitTransient(committedAttachedState)
        } catch (error) {
            if (current()) this.ports.reportError('Canvas media replacement failed:', error)
        } finally {
            pending.destroy()
        }
    }
}
