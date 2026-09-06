import {
    type CanvasNode,
} from '@lixpi/constants'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { xCircleIcon } from '@lixpi/ui-kit/svg'
import {
    createContextPreviewTile,
    getContextPreviewAccessibleLabel,
    type ContextPreviewEnvironment,
} from './context-preview.ts'

export type WorkspaceContextTrayPorts = {
    document: Document
    getNode: (nodeId: string) => CanvasNode | undefined
    getContextNodeIds: () => readonly string[]
    getEnvironment: () => ContextPreviewEnvironment
    onRemove: (nodeId: string) => void
    requestFrame: (callback: () => void) => number
    cancelFrame: (id: number) => void
}

class WorkspaceContextTray {
    readonly element: HTMLDivElement
    private readonly lifetime = new Lifetime()
    private content = new Lifetime()

    constructor(
        private readonly ports: WorkspaceContextTrayPorts,
        kind: 'canvas' | 'chat',
        refresh: () => void,
    ) {
        const html = createDocumentHtml(ports.document)
        const className = kind === 'canvas' ? 'workspace-canvas-global-context-chips' : 'workspace-ai-chat-panel-context-chips-panel'
        const label = kind === 'canvas' ? 'Canvas prompt context previews' : 'Chat context previews'
        this.element = html`
            <div
                className=${`workspace-ai-chat-panel-context-chips ${className}`}
                role="list"
                aria-label=${label}
                contenteditable="false"
            ></div>
        ` as HTMLDivElement
        this.element.hidden = true
        this.lifetime.own(() => this.element.remove())
        this.lifetime.own(() => this.content.destroy())
        const frame = ports.requestFrame(() => {
            if (
                !this.lifetime.signal.aborted
                && this.element.isConnected
            )
                refresh()
        })
        this.lifetime.own(() => ports.cancelFrame(frame))
    }

    render(
        nodes: readonly CanvasNode[],
        environment: ContextPreviewEnvironment,
    ): void {
        if (this.lifetime.signal.aborted)
            return

        this.content.destroy()
        this.content = new Lifetime()
        this.element.replaceChildren()
        this.element.hidden = nodes.length === 0
        const html = createDocumentHtml(this.ports.document)

        try {
            for (const node of nodes) {
                const preview = createContextPreviewTile({
                    node,
                    getNode: () => this.ports.getNode(node.nodeId) ?? node,
                    environment,
                })
                this.content.own(() => preview.destroy())
                const label = `Remove ${getContextPreviewAccessibleLabel(node, environment)} from context`
                const chip = html`
                    <div
                        className="workspace-ai-chat-panel-context-chip workspace-ai-chat-panel-context-chip-explicit"
                        data=${{
                            nodeId: node.nodeId,
                            contextKind: 'explicit',
                            contextRole: 'forced-chip',
                        }}
                        role="listitem"
                    >
                    ${preview.dom}
                    <button
                        type="button"
                        className="workspace-ai-chat-panel-context-chip-remove"
                        aria-label=${label}
                        innerHTML=${xCircleIcon}
                    ></button>
                </div>
                ` as HTMLDivElement
                const remove = chip.querySelector('button')!
                const click = () => this.ports.onRemove(node.nodeId)
                remove.addEventListener('click', click)
                this.content.own(() => remove.removeEventListener('click', click))
                this.element.appendChild(chip)
            }
        } catch (error) {
            this.content.destroy()
            this.element.replaceChildren()
            environment.onError(error)
        }
    }

    destroy(): void {
        this.lifetime.destroy()
    }
}

// Replacing chips updates only the tray; it never remounts the composer editor.
export class WorkspaceContextTrays {
    private readonly entries = new Map<HTMLDivElement, WorkspaceContextTray>()
    private destroyed = false

    constructor(private readonly ports: WorkspaceContextTrayPorts) {}

    create(kind: 'canvas' | 'chat'): HTMLDivElement {
        if (this.destroyed)
            throw new Error('Workspace context trays are disposed')

        const tray = new WorkspaceContextTray(
            this.ports,
            kind,
            () => this.refresh(),
        )
        this.entries.set(tray.element, tray)

        return tray.element
    }

    release(element: HTMLDivElement): void {
        const tray = this.entries.get(element)
        this.entries.delete(element)
        tray?.destroy()
    }

    refresh(): void {
        if (this.destroyed)
            return

        const nodes = this.ports
            .getContextNodeIds().map(id => this.ports.getNode(id)).filter((node): node is CanvasNode => Boolean(node))
        const environment = this.ports.getEnvironment()

        for (const [element, tray] of this.entries) {
            if (!element.isConnected)
                this.release(element)
            else
                tray.render(nodes, environment)
        }
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        const lifetime = new Lifetime()

        for (const tray of this.entries.values()) lifetime.own(() => tray.destroy())

        this.entries.clear()
        lifetime.destroy()
    }
}
