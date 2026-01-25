import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { USE_AI_CHAT_META, STOP_AI_CHAT_META, AI_CHAT_THREAD_PLUGIN_KEY } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import {
    findThreadFromDescendantPos,
    findUserInputInThread,
    isMeaningfullyEmpty
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPositionUtils.ts'

const AI_USER_MESSAGE_NODE_TYPE = 'aiUserMessage'

function createId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function dispatchStopAiChatForThread(view: EditorView, threadId: string): void {
    const tr = view.state.tr.setMeta(STOP_AI_CHAT_META, { threadId })
    view.dispatch(tr)
}

export function dispatchSendAiChatFromUserInput(view: EditorView, descendantPos: number): void {
    const threadInfo = findThreadFromDescendantPos(view.state, descendantPos)
    if (!threadInfo) return

    const { threadNode, threadPos, threadId } = threadInfo

    const inputInfo = findUserInputInThread(view.state, threadPos, threadNode)
    if (!inputInfo) return

    if (isMeaningfullyEmpty(inputInfo.inputNode)) {
        const selectionPos = Math.min(descendantPos, view.state.doc.content.size)
        const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, selectionPos))
        view.dispatch(tr)
        return
    }

    const userMessageType = view.state.schema.nodes[AI_USER_MESSAGE_NODE_TYPE]
    const paragraphType = view.state.schema.nodes.paragraph

    if (!userMessageType || !paragraphType) return

    const messageNode = userMessageType.create(
        { id: createId(), createdAt: Date.now() },
        inputInfo.inputNode.content
    )

    const emptyParagraph = paragraphType.createAndFill()
    if (!emptyParagraph) return

    let tr = view.state.tr

    // Insert message before the user input node
    tr = tr.insert(inputInfo.inputPos, messageNode)

    // Clear user input content to a single empty paragraph
    const mappedInputPos = tr.mapping.map(inputInfo.inputPos)
    const inputContentFrom = mappedInputPos + 1
    const inputContentTo = mappedInputPos + inputInfo.inputNode.nodeSize - 1
    tr = tr.replaceWith(inputContentFrom, inputContentTo, emptyParagraph)

    // Put cursor back into the cleared input paragraph
    const selectionPos = mappedInputPos + 2
    tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos))

    // Trigger AI chat send for this thread using the same transaction
    tr = tr.setMeta(USE_AI_CHAT_META, { threadId, nodePos: threadPos })

    view.dispatch(tr)
}

export function isThreadReceiving(view: EditorView, threadId: string): boolean {
    const pluginState = AI_CHAT_THREAD_PLUGIN_KEY.getState(view.state)
    return Boolean(pluginState?.receivingThreadIds?.has?.(threadId))
}
