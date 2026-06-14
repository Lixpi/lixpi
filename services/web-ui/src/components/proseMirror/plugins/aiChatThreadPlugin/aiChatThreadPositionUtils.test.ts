'use strict'

import { describe, expect, it } from 'vitest'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

import {
    aiImg,
    createEditorState,
    doc,
    findNodePosition,
    p,
    schema,
    thread,
    userMsg,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

import {
    findThreadFromDescendantPos,
    findUserInputInThread,
    isMeaningfullyEmpty,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPositionUtils.ts'

function createMockThreadNode(childSummaries: Array<{ typeName: string; relPos: number }>): ProseMirrorNode {
    return {
        descendants: (callback) => {
            for (const child of childSummaries) {
                const shouldStop = callback({
                    type: { name: child.typeName },
                    textContent: '',
                    nodeSize: 2,
                } as ProseMirrorNode, child.relPos)

                if (shouldStop === false) break
            }
        },
    } as unknown as ProseMirrorNode
}

describe('findThreadFromDescendantPos', () => {
    it('finds the nearest aiChatThread ancestor for positions inside a thread', () => {
        const state = createEditorState(
            doc(
                p('outside paragraph'),
                thread(userMsg(p('thread message'))),
                p('after paragraph')
            )
        )

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const result = findThreadFromDescendantPos(state, threadPos! + 1)

        expect(result).not.toBeNull()
        expect(result?.threadPos).toBe(threadPos)
        expect(result?.threadNode.type.name).toBe('aiChatThread')
        expect(result?.threadId).toBe('test-thread-id')
    })

    it('returns null when the position is not inside a thread', () => {
        const state = createEditorState(
            doc(
                p('outside paragraph'),
                thread(userMsg(p('thread message'))),
                p('after paragraph')
            )
        )
        const paragraphPos = findNodePosition(state.doc, 'paragraph')
        expect(paragraphPos).not.toBeNull()

        const result = findThreadFromDescendantPos(state, paragraphPos! + 1)

        expect(result).toBeNull()
    })

    it('returns an empty threadId when the stored threadId is not a string', () => {
        const legacyThreadNode = schema.nodes.aiChatThread.create({}, [
            schema.nodes.aiUserMessage.create({}, [schema.nodes.paragraph.create(null, [schema.text('legacy message')])]),
        ])
        const state = createEditorState(doc(legacyThreadNode))

        const threadPos = findNodePosition(state.doc, 'aiChatThread')
        expect(threadPos).not.toBeNull()

        const result = findThreadFromDescendantPos(state, threadPos! + 1)

        expect(result?.threadId).toBe('')
    })
})

describe('findUserInputInThread', () => {
    it('returns the first matching aiUserInput node with resolved absolute position', () => {
        const threadPos = 42
        const userInputNode = schema.nodes.aiUserInput.create({}, [schema.nodes.paragraph.create(null, [schema.text('draft prompt')])])

        const threadNode = {
            descendants: (callback) => {
                callback({ type: { name: 'aiResponseMessage' }, textContent: '', nodeSize: 2 } as ProseMirrorNode, 0)
                const shouldStop = callback(userInputNode, 7)
                if (shouldStop === false) return
                callback({ type: { name: 'aiUserInput' }, textContent: '', nodeSize: 2 } as ProseMirrorNode, 20)
            },
        } as unknown as ProseMirrorNode

        const state = createEditorState(doc(p('context')))
        const inputInfo = findUserInputInThread(state, threadPos, threadNode)

        expect(inputInfo).not.toBeNull()
        expect(inputInfo?.inputNode).toBe(userInputNode)
        expect(inputInfo?.inputPos).toBe(threadPos + 7 + 1)
    })

    it('returns null if no aiUserInput exists in the thread subtree', () => {
        const threadPos = 12
        const threadNode = createMockThreadNode([
            { typeName: 'aiUserMessage', relPos: 0 },
            { typeName: 'aiResponseMessage', relPos: 8 },
            { typeName: 'paragraph', relPos: 16 },
        ])

        const state = createEditorState(doc(p('context')))
        const result = findUserInputInThread(state, threadPos, threadNode)

        expect(result).toBeNull()
    })
})

describe('isMeaningfullyEmpty', () => {
    it('returns true for nodes with only whitespace text content', () => {
        const node = schema.nodes.paragraph.create(null, [schema.text('  \n \t  ')])
        expect(isMeaningfullyEmpty(node)).toBe(true)
    })

    it('returns false when visible text exists', () => {
        const node = schema.nodes.paragraph.create(null, [schema.text('hello world')])
        expect(isMeaningfullyEmpty(node)).toBe(false)
    })

    it('returns true for nodes with no textual content', () => {
        const node = aiImg()
        expect(isMeaningfullyEmpty(node)).toBe(true)
    })
})
