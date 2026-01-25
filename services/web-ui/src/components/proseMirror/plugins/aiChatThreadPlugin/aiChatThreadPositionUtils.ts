import type { EditorState } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

const AI_CHAT_THREAD_NODE_TYPE = 'aiChatThread'
const AI_USER_INPUT_NODE_TYPE = 'aiUserInput'

type ThreadInfo = {
    threadNode: ProseMirrorNode
    threadPos: number
    threadId: string
}

type UserInputInfo = {
    inputNode: ProseMirrorNode
    inputPos: number
}

export function findThreadFromDescendantPos(state: EditorState, descendantPos: number): ThreadInfo | null {
    const $pos = state.doc.resolve(descendantPos)

    for (let depth = $pos.depth; depth >= 0; depth--) {
        const node = $pos.node(depth)
        if (node.type.name !== AI_CHAT_THREAD_NODE_TYPE) continue

        const threadPos = depth === 0 ? 0 : $pos.before(depth)
        const threadId = typeof node.attrs?.threadId === 'string' ? node.attrs.threadId : ''
        return { threadNode: node, threadPos, threadId }
    }

    return null
}

export function findUserInputInThread(state: EditorState, threadPos: number, threadNode: ProseMirrorNode): UserInputInfo | null {
    let found: UserInputInfo | null = null

    threadNode.descendants((child: ProseMirrorNode, relPos: number) => {
        if (child.type.name !== AI_USER_INPUT_NODE_TYPE) return

        const inputPos = threadPos + relPos + 1
        found = { inputNode: child, inputPos }
        return false
    })

    return found
}

export function isMeaningfullyEmpty(node: ProseMirrorNode): boolean {
    return node.textContent.trim() === ''
}
