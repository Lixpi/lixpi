import {
    type CanvasNode,
    type BranchOriginCanvasNode,
    type BranchForkCanvasNode,
    type BranchLineCanvasNode,
} from '@lixpi/constants'
import { createDocumentHtml } from '@lixpi/ui-primitives/dom'
import { imageResizeCornerIcon } from '@lixpi/ui-kit/svg'
import {
    getAdaptiveBoundedZoomScalingOptions,
    getResizeHandleScaledSizes,
    type CanvasEngineRect,
    type BoundedZoomScalingOptions,
    type Dispose,
} from '@lixpi/canvas-engine/shared'
import {
    Lifetime,
    NodeShell,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    type WorkspaceMediaNode,
} from '../media/workspace-media-nodes.ts'

export type WorkspaceResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type WorkspaceNodeInteractionOptions = {
    renderResizeHandles?: boolean
    allowSelection?: boolean
    allowDrag?: boolean
    onClick?: () => void
}
export type WorkspaceNodeShellsOptions = {
    document: Document
    getBounds: (node: CanvasNode) => CanvasEngineRect
    getLayer: () => number
    getZoom: () => number
    getResizeSettings: () => {
        useZoomCompensatedScaling: boolean
        size: number
        offset: number
        minSize: number
        zoomScaling: BoundedZoomScalingOptions
    }
    consumeSuppressedClick: () => boolean
    select: (nodeId: string) => void
    toggleSelection: (nodeId: string) => void
    startDrag: (
        event: MouseEvent,
        nodeId: string,
        options: Pick<WorkspaceNodeInteractionOptions, 'allowSelection' | 'onClick'>,
    ) => void
    startResize: (
        event: MouseEvent,
        nodeId: string,
        corner: WorkspaceResizeCorner,
    ) => void
    onCreate: (
        element: HTMLElement,
        nodeId: string,
    ) => void
    togglePlayback: (nodeId: string) => void
}

type Entry = {
    shell: NodeShell
    lifetime: Lifetime
}
export type WorkspaceNodeElements = {
    nodeEl: HTMLElement
    dragOverlay: HTMLElement
    own: (dispose: Dispose) => Dispose
}

// Product hit surfaces and artwork wrap the engine's structural node shell.
// Content, selection state, geometry commits and playback arrive through ports.
export class WorkspaceNodeShells {
    private readonly entries = new Map<string, Entry>()
    private destroyed = false

    constructor(private readonly options: WorkspaceNodeShellsOptions) {}

    create(
        node: CanvasNode,
        extraClasses?: string,
        data?: Record<string, string>,
        interaction: WorkspaceNodeInteractionOptions = {},
    ): WorkspaceNodeElements {
        if (this.destroyed)
            throw new Error('Workspace node shells are disposed')

        const lifetime = new Lifetime()
        const html = createDocumentHtml(this.options.document)
        let shell: NodeShell

        try {
            shell = new NodeShell({
                document: this.options.document,
                nodeId: node.nodeId,
                bounds: this.options.getBounds(node),
                layer: this.options.getLayer(),
                zoom: this.options.getZoom(),
                className: `workspace-document-node${extraClasses ? ` ${extraClasses}` : ''}`,
                data,
                dragClassName: 'node-drag-overlay',
                onClick: event => this.click(
                    event,
                    node.nodeId,
                    interaction,
                ),
                onDragStart: event => {
                    if (interaction.allowDrag === false) {
                        event.preventDefault()
                        event.stopPropagation()

                        return
                    }

                    this.options.startDrag(
                        event,
                        node.nodeId,
                        {
                            allowSelection: interaction.allowSelection !== false,
                            // Branch details open on the native click. Opening on
                            // mouseup would let that click dismiss the new backdrop.
                            onClick: interaction.allowSelection === false ? undefined : interaction.onClick,
                        },
                    )
                },
                resize: interaction.renderResizeHandles === false ? undefined : {
                    handles: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
                    className: corner => `document-resize-handle document-resize-${corner}`,
                    content: handle => {
                        const content = html`<span innerHTML=${imageResizeCornerIcon}></span>` as HTMLElement
                        handle.append(...Array.from(content.childNodes))

                        return () => handle.replaceChildren()
                    },
                    measure: zoom => {
                        const settings = this.options.getResizeSettings()

                        return settings.useZoomCompensatedScaling
                            ? getResizeHandleScaledSizes(
                                zoom,
                                {
                                    baseSize: settings.size,
                                    baseOffset: settings.offset,
                                    minSize: settings.minSize,
                                    zoomScaling: getAdaptiveBoundedZoomScalingOptions(settings.zoomScaling),
                                },
                            )
                            : {
                                size: settings.size,
                                offset: settings.offset,
                            }
                    },
                    onPointerDown: (event, corner) => this.options.startResize(
                        event,
                        node.nodeId,
                        corner as WorkspaceResizeCorner,
                    ),
                },
            })
            lifetime.own(() => shell.destroy())
            this.options.onCreate(shell.element, node.nodeId)
        } catch (error) {
            lifetime.destroy()

            throw error
        }

        const previous = this.entries.get(node.nodeId)

        if (previous?.shell.element.parentNode)
            previous.shell.element.replaceWith(shell.element)

        this.entries.set(
            node.nodeId,
            {
                shell,
                lifetime,
            },
        )
        previous?.lifetime.destroy()

        return {
            nodeEl: shell.element,
            dragOverlay: shell.dragOverlay,
            own: dispose => lifetime.own(dispose),
        }
    }

    createMedia(node: WorkspaceMediaNode): HTMLElement {
        const name = node.type === 'mediaDocument' ? 'media-document' : node.type
        const {
            nodeEl,
            dragOverlay,
        } = this.create(
            node,
            `workspace-${name}-node`,
            { assetId: node.assetId },
        )
        dragOverlay.className = `canvas-node-drag-overlay ${name}-drag-overlay nopan`

        if (
            node.type === 'video'
            || node.type === 'audio'
        ) {
            const toggle = (event: Event) => {
                event.stopPropagation()
                this.options.togglePlayback(node.nodeId)
            }
            dragOverlay.addEventListener('dblclick', toggle)
            this.entries.get(node.nodeId)!.lifetime.own(() => dragOverlay.removeEventListener('dblclick', toggle))
        }

        return nodeEl
    }

    createBranchMarker(
        node: BranchOriginCanvasNode | BranchForkCanvasNode | BranchLineCanvasNode,
        onClick: () => void,
    ): WorkspaceNodeElements {
        const kind = node.type === 'branchOrigin'
            ? 'origin'
            : node.type === 'branchFork'
                ? 'fork'
                : 'line'
        const data = {
            branchId: node.branchId,
            generationRequestId: node.generationRequestId,
            conversationAssetId: node.conversationAssetId ?? '',
            ...(node.type === 'branchOrigin' ? {} : {
                reasoningRunId: node.reasoningRunId ?? '',
                reasoningModelId: node.reasoningModelId ?? '',
                reasoningIndex: node.reasoningIndex == null ? '' : String(node.reasoningIndex),
            }),
        }
        const elements = this.create(
            node,
            `workspace-branch-${kind}-node`,
            data,
            {
                renderResizeHandles: false,
                allowSelection: false,
                onClick,
            },
        )
        elements.dragOverlay.className = `branch-${kind}-drag-overlay nopan`

        return elements
    }

    private click(
        event: MouseEvent,
        nodeId: string,
        interaction: WorkspaceNodeInteractionOptions,
    ): void {
        event.stopPropagation()

        if (this.options.consumeSuppressedClick())
            return

        const target = event.target as HTMLElement | null

        if (
            target
            && (target.isContentEditable || target.closest('.ProseMirror, .ai-chat-thread-wrapper'))
        )
            return

        if (
            event.metaKey
            || event.ctrlKey
        ) {
            if (interaction.allowSelection !== false)
                this.options.toggleSelection(nodeId)
            else
                interaction.onClick?.()

            return
        }

        if (interaction.allowSelection !== false)
            this.options.select(nodeId)

        interaction.onClick?.()
    }

    setZoom(zoom: number): void {
        for (const { shell } of this.entries.values())
            shell.setZoom(zoom)
    }

    replace(
        nodeId: string,
        mount: () => HTMLElement,
    ): HTMLElement {
        const previous = this.entries.get(nodeId)
        this.entries.delete(nodeId)
        let element: HTMLElement

        try {
            element = mount()
        } catch (error) {
            this.remove(nodeId)

            if (previous)
                this.entries.set(nodeId, previous)

            throw error
        }

        if (previous?.shell.element.parentNode)
            previous.shell.element.replaceWith(element)

        previous?.lifetime.destroy()

        return element
    }

    remove(nodeId: string): void {
        const entry = this.entries.get(nodeId)
        this.entries.delete(nodeId)
        entry?.lifetime.destroy()
    }

    clear(): void {
        for (const id of Array.from(
            this.entries.keys(),
        ))
            this.remove(id)
    }

    destroy(): void {
        if (this.destroyed)
            return

        this.destroyed = true
        this.clear()
    }
}
