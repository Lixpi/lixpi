import { describe, expect, it } from 'vitest'

import {
    documentTitleNodeSpec as packageDocumentTitleNodeSpec,
    documentTitleNodeType as packageDocumentTitleNodeType,
} from '@lixpi/prosemirror'
import { createProseMirrorSchema, DOCUMENT_TYPE } from '@lixpi/prosemirror'
import {
    documentTitleNodeSpec,
    documentTitleNodeType,
} from '$src/components/proseMirror/customNodes/documentTitleNode.ts'

const documentSchema = createProseMirrorSchema(DOCUMENT_TYPE.DOCUMENT)
const aiChatSchema = createProseMirrorSchema(DOCUMENT_TYPE.AI_CHAT_THREAD)

describe('documentTitleNode re-exports', () => {
    it('re-exports the package document title type', () => {
        expect(documentTitleNodeType).toBe(packageDocumentTitleNodeType)
    })

    it('re-exports the shared document title node spec by reference', () => {
        expect(documentTitleNodeSpec).toBe(packageDocumentTitleNodeSpec)
    })

    it('keeps document title as a non-selectable inline container used by shared schema', () => {
        expect(documentTitleNodeSpec.selectable).toBe(false)
        expect(documentSchema.nodes[documentTitleNodeType]).toBeDefined()
        expect(documentSchema.nodes[documentTitleNodeType].spec).toBe(packageDocumentTitleNodeSpec)
        expect(aiChatSchema.nodes[documentTitleNodeType].spec).toBe(packageDocumentTitleNodeSpec)
    })
})
