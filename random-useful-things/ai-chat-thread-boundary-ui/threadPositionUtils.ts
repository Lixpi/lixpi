// @ts-nocheck
import type { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

// Get position information for a specific thread in the document
export function getThreadPositionInfo(
    view: EditorView,
    threadId: string,
    threadNodeType: string = 'aiChatThread'
): { index: number; totalCount: number } | null {
    const threads: Array<{ threadId: string; pos: number }> = []

    // Scan document for all aiChatThread nodes
    view.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === threadNodeType) {
            threads.push({
                threadId: node.attrs.threadId,
                pos
            })
        }
    })

    // Find the index of the current thread
    const currentIndex = threads.findIndex(t => t.threadId === threadId)

    if (currentIndex === -1) {
        return null
    }

    return {
        index: currentIndex,
        totalCount: threads.length
    }
}
