// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { EditorState } from 'prosemirror-state'
import { testSchema } from '@lixpi/prosemirror/test-helpers'
import { aiChatThreadNodeType } from './ai-chat-thread-node.ts'
import { insertAiChatThread } from './insert-ai-chat-thread.ts'

vi.spyOn(crypto, 'randomUUID').mockReturnValue('thread-uuid-fixed' as never)

const createState = () => {
    return EditorState.create({
        schema: testSchema,
        doc: testSchema.nodes.doc.createAndFill()!,
    })
}

describe('insertAiChatThread', () => {
    it('dispatches a transaction with generated thread metadata', () => {
        const state = createState()
        const dispatch = vi.fn()

        const result = insertAiChatThread(state, dispatch)

        expect(result).toBe(true)
        expect(dispatch).toHaveBeenCalledOnce()
        const tr = dispatch.mock.calls[0][0]
        expect(tr.getMeta(`insert:${aiChatThreadNodeType}`)).toEqual({
            threadId: 'thread-uuid-fixed',
            status: 'active',
        })
    })

    it('returns false and skips dispatch when dispatch callback is not provided', () => {
        const state = createState()

        const result = insertAiChatThread(state)

        expect(result).toBe(false)
    })
})
