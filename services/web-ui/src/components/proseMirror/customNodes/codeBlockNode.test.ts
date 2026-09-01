import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    codeBlockNodeSpec as packageCodeBlockNodeSpec,
    codeBlockNodeType as packageCodeBlockNodeType,
} from '@lixpi/prosemirror'
import {
    createProseMirrorSchema,
    DOCUMENT_TYPE,
} from '@lixpi/prosemirror'
import {
    codeBlockNodeSpec,
    codeBlockNodeType,
} from '$src/components/proseMirror/customNodes/codeBlockNode.js'

const documentSchema = createProseMirrorSchema(DOCUMENT_TYPE.DOCUMENT)
const aiChatSchema = createProseMirrorSchema(DOCUMENT_TYPE.AI_CHAT_THREAD)

describe('codeBlockNode re-exports', () => {
    it('re-exports the same node type constant as the shared package', () => {
        expect(codeBlockNodeType).toBe(packageCodeBlockNodeType)
    })

    it('re-exports the shared code block node spec by reference', () => {
        expect(codeBlockNodeSpec).toBe(packageCodeBlockNodeSpec)
    })

    it('uses the package theme default and appears in shared schema nodes', () => {
        expect(codeBlockNodeSpec.attrs?.theme).toEqual({ default: 'gruvboxDark' })
        expect(documentSchema.nodes[codeBlockNodeType]).toBeDefined()
        expect(documentSchema.nodes[codeBlockNodeType].spec).toBe(packageCodeBlockNodeSpec)
        expect(aiChatSchema.nodes[codeBlockNodeType].spec).toBe(packageCodeBlockNodeSpec)
    })
})
