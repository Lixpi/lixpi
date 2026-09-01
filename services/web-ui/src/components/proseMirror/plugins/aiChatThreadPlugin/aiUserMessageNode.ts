import type {
    EditorView,
    NodeView,
} from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { createAiUserMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'
import {
    createContextPreviewTile,
    type ContextPreviewEnvironment,
    type ContextPreviewTileInstance,
} from '@lixpi/canvas-components-lixpi-specific/frontend/context'
import type { CanvasNode } from '@lixpi/constants'
import {
    aiUserMessageNodeSpec,
    aiUserMessageNodeType,
    normalizeReferenceNodeIds,
} from '@lixpi/prosemirror'

export {
    aiUserMessageNodeSpec,
    aiUserMessageNodeType,
    normalizeReferenceNodeIds,
}

export type AiUserMessageContextPreviewRenderer = {
    getNodeById: (nodeId: string) => CanvasNode | undefined
    environment: ContextPreviewEnvironment
    inlinePopover?: boolean
}

export type AiUserMessageNodeViewOptions = {
    contextPreview?: AiUserMessageContextPreviewRenderer
}

function createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createAiUserMessageNodeAttrs(): { id: string; createdAt: number } {
    return { id: createId(), createdAt: Date.now() }
}

export const aiUserMessageNodeView = (
    node: ProseMirrorNode,
    _view: EditorView,
    _getPos: () => number | undefined,
    options: AiUserMessageNodeViewOptions = {},
): NodeView => {
    const shell = createAiUserMessageShell()
    let tileInstances: ContextPreviewTileInstance[] = []

    const destroyReferencePreviews = (): void => {
        for (const tile of tileInstances) tile.destroy()
        tileInstances = []
        shell.referencePreviewsEl.replaceChildren()
    }

    const renderReferencePreviews = (messageNode: ProseMirrorNode): void => {
        destroyReferencePreviews()
        const contextPreview = options.contextPreview
        const referenceNodeIds = normalizeReferenceNodeIds(messageNode.attrs.referenceNodeIds)
        if (!contextPreview || referenceNodeIds.length === 0) {
            shell.referencePreviewsEl.hidden = true
            return
        }

        for (const nodeId of referenceNodeIds) {
            const canvasNode = contextPreview.getNodeById(nodeId)
            if (!canvasNode) continue
            const tile = createContextPreviewTile({
                node: canvasNode,
                getNode: () => contextPreview.getNodeById(nodeId) ?? canvasNode,
                environment: contextPreview.environment,
                preferredPlacement: 'bottom',
                inlinePopover: contextPreview.inlinePopover,
            })
            tileInstances.push(tile)
            shell.referencePreviewsEl.appendChild(tile.dom)
        }

        shell.referencePreviewsEl.hidden = tileInstances.length === 0
    }

    renderReferencePreviews(node)

    return {
        dom: shell.wrapper,
        contentDOM: shell.contentEl,
        ignoreMutation: (mutation: MutationRecord) => {
            if (typeof Node !== 'undefined' && mutation.target instanceof Node && shell.referencePreviewsEl.contains(mutation.target)) {
                return true
            }
            // Ignore style attribute changes on the wrapper so ProseMirror
            // does not trigger DOM reconciliation for externally-set styles.
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                return true
            }
            return false
        },
        update: (updatedNode: ProseMirrorNode) => {
            if (updatedNode.type.name !== aiUserMessageNodeType) return false
            node = updatedNode
            renderReferencePreviews(node)
            return true
        },
        destroy: destroyReferencePreviews,
    }
}
