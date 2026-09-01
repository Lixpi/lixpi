import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    createProseMirrorSchema,
    documentTitleNodeSpec,
    documentTitleNodeType,
    DOCUMENT_TYPE,
} from '@lixpi/prosemirror'

const documentSchema = createProseMirrorSchema(DOCUMENT_TYPE.DOCUMENT)
const aiChatSchema = createProseMirrorSchema(DOCUMENT_TYPE.AI_CHAT_THREAD)

describe('documentTitleNode', () => {
    it('keeps document title as a non-selectable inline container used by shared schema', () => {
        expect(documentTitleNodeSpec.selectable).toBe(false)
        expect(documentSchema.nodes[documentTitleNodeType]).toBeDefined()
        expect(documentSchema.nodes[documentTitleNodeType].spec).toBe(documentTitleNodeSpec)
        expect(aiChatSchema.nodes[documentTitleNodeType].spec).toBe(documentTitleNodeSpec)
    })
})
