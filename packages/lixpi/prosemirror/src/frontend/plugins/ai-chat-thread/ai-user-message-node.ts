import {
    type EditorView,
    type NodeView,
    type ViewMutationRecord,
} from 'prosemirror-view'
import {
    type Node as ProseMirrorNode,
} from 'prosemirror-model'
import { createAiUserMessageShell } from './ai-chat-message-shells.ts'
import {
    type EditorContextPreviewTile,
} from '../../editor/editor-host-ports.ts'
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
    createReferencePreview: (nodeId: string) => EditorContextPreviewTile | null
}

export type AiUserMessageNodeViewOptions = {
    contextPreview?: AiUserMessageContextPreviewRenderer
}

const createId = (): string => {
    if (
        typeof crypto !== 'undefined'
        && 'randomUUID' in crypto
    )
        return crypto.randomUUID()

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const createAiUserMessageNodeAttrs = (): {
    id: string
    createdAt: number
} => {
    return {
        id: createId(),
        createdAt: Date.now(),
    }
}

export const aiUserMessageNodeView = (
    node: ProseMirrorNode,
    _view: EditorView,
    _getPos: () => number | undefined,
    options: AiUserMessageNodeViewOptions = {},
): NodeView => {
    const shell = createAiUserMessageShell()
    let tileInstances: EditorContextPreviewTile[] = []

    const destroyReferencePreviews = (): void => {
        for (const tile of tileInstances)
            tile.destroy()

        tileInstances = []
        shell.referencePreviewsEl.replaceChildren()
    }

    const renderReferencePreviews = (messageNode: ProseMirrorNode): void => {
        destroyReferencePreviews()
        const contextPreview = options.contextPreview
        const referenceNodeIds = normalizeReferenceNodeIds(messageNode.attrs.referenceNodeIds)

        if (
            !contextPreview
            || referenceNodeIds.length === 0
        ) {
            shell.referencePreviewsEl.hidden = true

            return
        }

        for (const nodeId of referenceNodeIds) {
            const tile = contextPreview.createReferencePreview(nodeId)

            if (!tile)
                continue

            tileInstances.push(tile)
            shell.referencePreviewsEl.appendChild(tile.dom)
        }

        shell.referencePreviewsEl.hidden = tileInstances.length === 0
    }

    const renderAuthor = (messageNode: ProseMirrorNode): void => {
        const label = typeof messageNode.attrs.authorLabel === 'string' ? messageNode.attrs.authorLabel : ''
        shell.authorEl.textContent = label
        shell.authorEl.hidden = !label
    }

    renderReferencePreviews(node)
    renderAuthor(node)

    return {
        dom: shell.wrapper,
        contentDOM: shell.contentEl,
        ignoreMutation: (mutation: ViewMutationRecord) => {
            if (
                typeof Node !== 'undefined'
                && mutation.target instanceof Node
                && (shell.referencePreviewsEl.contains(mutation.target) || shell.authorEl.contains(mutation.target))
            )
                return true

            // Ignore style attribute changes on the wrapper so ProseMirror
            // does not trigger DOM reconciliation for externally-set styles.
            if (
                mutation.type === 'attributes'
                && mutation.attributeName === 'style'
            )
                return true

            return false
        },
        update: (updatedNode: ProseMirrorNode) => {
            if (updatedNode.type.name !== aiUserMessageNodeType)
                return false

            node = updatedNode
            renderReferencePreviews(node)
            renderAuthor(node)

            return true
        },
        destroy: destroyReferencePreviews,
    }
}
