'use strict'

import { describe, it, expect, beforeEach } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import {
    doc,
    p,
    response,
    thread,
    findNodePosition,
    findAllNodePositions,
    createEditorState,
    createStateWithNodeSelection,
    createStateWithTextSelection,
    selectNodeByType,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'

const baseDoc = doc(thread(response(p('first')), response(p('second'))))

describe('prosemirrorTestUtils — node lookup', () => {
    it('finds the first node position by type', () => {
        const position = findNodePosition(baseDoc, 'aiResponseMessage')
        expect(position).not.toBeNull()
        expect(position).toBe(1)
    })

    it('finds all node positions by type in traversal order', () => {
        const positions = findAllNodePositions(baseDoc, 'aiResponseMessage')
        expect(positions.length).toBe(2)
        expect(positions[0]).toBeLessThan(positions[1])
    })
})

describe('prosemirrorTestUtils — state factories', () => {
    let stateDoc = baseDoc
    beforeEach(() => {
        stateDoc = doc(response(p('first')), response(p('second')))
    })

    it('creates editor state with schema context', () => {
        const state = createEditorState(stateDoc)
        expect(state.doc.type.name).toBe('doc')
        expect(state.schema).toBeDefined()
    })

    it('creates node-selection state at a found node position', () => {
        const responsePos = findNodePosition(stateDoc, 'aiResponseMessage')
        const state = createStateWithNodeSelection(stateDoc, responsePos as number)
        expect(state.selection).toBeInstanceOf(NodeSelection)
        expect((state.selection as NodeSelection).node.type.name).toBe('aiResponseMessage')
    })

    it('creates text-selection state with explicit offsets', () => {
        const state = createStateWithTextSelection(stateDoc, 1, 3)
        expect(state.selection).toBeInstanceOf(TextSelection)
    })

    it('returns null when selecting missing node types', () => {
        const result = selectNodeByType(stateDoc, 'aiPromptInput')
        expect(result).toBeNull()
    })
})
