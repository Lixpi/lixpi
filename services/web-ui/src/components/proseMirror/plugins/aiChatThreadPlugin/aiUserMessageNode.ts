import type { EditorView, NodeView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { createAiUserMessageShell } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatMessageShells.ts'
import {
    createContextPreviewTile,
    type ContextPreviewEnvironment,
    type ContextPreviewTileInstance,
} from '$src/components/contextPreview/index.ts'
import type { CanvasNode } from '@lixpi/constants'

export const aiUserMessageNodeType = 'aiUserMessage'

export type AiUserMessageContextPreviewRenderer = {
    getNodeById: (nodeId: string) => CanvasNode | undefined
    environment: ContextPreviewEnvironment
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

function normalizeReferenceNodeIds(value: unknown): string[] {
    const rawIds = Array.isArray(value)
        ? value
        : typeof value === 'string' && value.trim()
            ? parseReferenceNodeIds(value)
            : []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const rawId of rawIds) {
        const nodeId = typeof rawId === 'string' ? rawId.trim() : ''
        if (!nodeId || seen.has(nodeId)) continue
        seen.add(nodeId)
        ids.push(nodeId)
    }
    return ids
}

function parseReferenceNodeIds(value: string): unknown[] {
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return value.split(',')
    }
}

export const aiUserMessageNodeSpec = {
    attrs: {
        id: { default: '' },
        createdAt: { default: 0 },
        referenceNodeIds: { default: [] },
    },
    content: '(paragraph | block)+',
    group: 'block',
    draggable: false,
    parseDOM: [
        {
            tag: 'div.ai-user-message',
            getAttrs(dom: HTMLElement) {
                return {
                    id: dom.getAttribute('data-id') || '',
                    createdAt: Number(dom.getAttribute('data-created-at') || 0),
                    referenceNodeIds: normalizeReferenceNodeIds(dom.getAttribute('data-reference-node-ids') || ''),
                }
            },
        },
    ],
    toDOM(node: any) {
        return [
            'div',
            {
                class: 'ai-user-message',
                'data-id': node.attrs.id,
                'data-created-at': String(node.attrs.createdAt || 0),
                'data-reference-node-ids': JSON.stringify(normalizeReferenceNodeIds(node.attrs.referenceNodeIds)),
            },
            0,
        ]
    },
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
                environment: contextPreview.environment,
                preferredPlacement: 'bottom',
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
