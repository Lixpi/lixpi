'use strict'

import {
    describe,
    it,
    expect,
    beforeEach,
} from 'vitest'
import {
    NodeSelection,
    TextSelection,
} from 'prosemirror-state'
import {
    doc,
    p,
    response,
    thread,
    aiImg,
    findNodePosition,
    findAllNodePositions,
    createEditorState,
    createStateWithNodeSelection,
    createStateWithTextSelection,
    selectNodeByType,
    schema as testUtilsSchema,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'

const imageThenPromptDoc = doc(
    p('Hello world'),
    thread(response(p('First thread response'))),
    aiImg({
        imageData: 'data:image/png;base64,test',
        alignment: 'left',
        textWrap: 'none',
        width: null,
        isPartial: false,
        fileId: 'test-file-id',
        revisedPrompt: 'Test prompt',
        responseId: 'test-response-id',
        aiModel: 'dall-e-3',
    }),
)

const nestedThreadDoc = doc(
    thread(
        response(p('First response')),
        response(p('Second response')),
    ),
    p('After thread'),
)

describe('prosemirrorTestUtils — node lookup', () => {
    it('returns the first matching node position in traversal order', () => {
        const firstResponsePos = findNodePosition(nestedThreadDoc, 'aiResponseMessage')
        const allResponsePositions = findAllNodePositions(nestedThreadDoc, 'aiResponseMessage')

        expect(firstResponsePos).not.toBeNull()
        expect(allResponsePositions).toHaveLength(2)
        expect(firstResponsePos).toBe(allResponsePositions[0])
        expect(firstResponsePos).toBeLessThan(allResponsePositions[1])
    })

    it('finds all matching node positions in document order', () => {
        const positions = findAllNodePositions(imageThenPromptDoc, 'paragraph')

        expect(positions).toHaveLength(2)
        expect(positions).toEqual([...positions].sort((a, b) => a - b))
        expect(positions[0]).toBeGreaterThanOrEqual(0)
        expect(positions[0]).toBeLessThan(positions[1])
    })

    it('finds the first node position by type', () => {
        const allResponsePositions = findAllNodePositions(nestedThreadDoc, 'aiResponseMessage')
        const position = findNodePosition(nestedThreadDoc, 'aiResponseMessage')
        expect(position).not.toBeNull()
        expect(position).toBe(allResponsePositions[0])
    })

    it('finds all node positions by type in traversal order', () => {
        const positions = findAllNodePositions(nestedThreadDoc, 'aiResponseMessage')
        expect(positions.length).toBe(2)
        expect(positions[0]).toBeLessThan(positions[1])
    })

    it('returns null when no node matches the query', () => {
        const position = findNodePosition(imageThenPromptDoc, 'video')
        expect(position).toBeNull()
    })

    it('returns the same test schema used by helper test factories', () => {
        expect(testUtilsSchema).toBe(testSchema)
    })
})

describe('prosemirrorTestUtils — state factories', () => {
    let stateDoc = nestedThreadDoc
    beforeEach(() => {
        stateDoc = doc(response(p('first')), response(p('second')))
    })

    it('shares schema object identity in createEditorState', () => {
        const state = createEditorState(stateDoc)
        expect(state.schema).toBe(testSchema)
        expect(state.doc.type.schema).toBe(testSchema)
    })

    it('creates editor state with schema context', () => {
        const state = createEditorState(stateDoc)
        expect(state.doc.type.name).toBe('doc')
        expect(state.schema).toBeDefined()
    })

    it('throws when creating a node selection at non-node positions', () => {
        expect(() => {
            createStateWithNodeSelection(stateDoc, Number.MAX_SAFE_INTEGER)
        }).toThrow()
    })

    it('creates node-selection state at a found node position', () => {
        const responsePos = findNodePosition(stateDoc, 'aiResponseMessage')
        const state = createStateWithNodeSelection(stateDoc, responsePos as number)
        expect(state.selection).toBeInstanceOf(NodeSelection)
        expect((state.selection as NodeSelection).node.type.name).toBe('aiResponseMessage')
    })

    it('creates text-selection state with explicit offsets', () => {
        const paragraphDoc = doc(p('selection works'))
        const state = createStateWithTextSelection(paragraphDoc, 2, 6)
        expect(state.selection).toBeInstanceOf(TextSelection)
        expect(state.selection.$from.pos).toBe(2)
        expect(state.selection.$to.pos).toBe(6)
        expect(state.selection.empty).toBe(false)
    })

    it('allows collapsed text selection at the same offset', () => {
        const paragraphDoc = doc(p('selection works'))
        const state = createStateWithTextSelection(paragraphDoc, 2, 2)
        expect(state.selection).toBeInstanceOf(TextSelection)
        expect(state.selection.empty).toBe(true)
    })

    it('supports selecting a node by type directly from a mixed document', () => {
        const imageSelectionState = selectNodeByType(imageThenPromptDoc, 'aiGeneratedImage')
        expect(imageSelectionState).not.toBeNull()
        expect((imageSelectionState?.selection as NodeSelection | undefined)?.node.type.name).toBe('aiGeneratedImage')

        const responseSelectionState = selectNodeByType(imageThenPromptDoc, 'aiResponseMessage')
        expect(responseSelectionState).not.toBeNull()
        expect((responseSelectionState?.selection as NodeSelection | undefined)?.node.type.name).toBe('aiResponseMessage')
    })

    it('selects nested aiResponseMessage by type with a node-selection state', () => {
        const state = selectNodeByType(nestedThreadDoc, 'aiResponseMessage')
        expect(state).not.toBeNull()
        expect(state?.selection).toBeInstanceOf(NodeSelection)
        expect((state?.selection as NodeSelection | undefined)?.node.type.name).toBe('aiResponseMessage')
    })

    it('returns null when selecting missing node types', () => {
        const result = selectNodeByType(stateDoc, 'aiPromptInput')
        expect(result).toBeNull()
    })
})
