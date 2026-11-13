import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    createCoreDocumentKindRegistry,
    DOCUMENT_TYPE,
} from './document-kinds.ts'
import {
    codeBlockNodeSpec,
    codeBlockNodeType,
    documentTitleNodeSpec,
    documentTitleNodeType,
    taskRowDefaultAttrs,
    taskRowNodeSpec,
    taskRowNodeType,
} from './node-specs.ts'

const registry = createCoreDocumentKindRegistry()
const documentSchema = registry.schema(DOCUMENT_TYPE.ASSET_CONTENT)
const aiChatSchema = registry.schema(DOCUMENT_TYPE.ASSET_CONVERSATION)

describe('custom blocks', () => {
    it('gives code blocks the package theme by default in documents and chat threads', () => {
        expect(codeBlockNodeSpec.attrs?.theme).toEqual({ default: 'gruvboxDark' })
        expect(documentSchema.nodes[codeBlockNodeType]!.spec).toBe(codeBlockNodeSpec)
        expect(aiChatSchema.nodes[codeBlockNodeType]!.spec).toBe(codeBlockNodeSpec)
    })

    it('gives task rows default attributes that match their declaration', () => {
        expect(taskRowDefaultAttrs).toEqual({
            taskKey: 'LIX-1',
            status: 'New Task Status',
            title: 'New Task Title',
            description: 'New Task Description',
        })
        expect(documentSchema.nodes[taskRowNodeType]!.spec).toBe(taskRowNodeSpec)
        expect(aiChatSchema.nodes[taskRowNodeType]!.spec).toBe(taskRowNodeSpec)
    })

    it('keeps the document title a non-selectable container', () => {
        expect(documentTitleNodeSpec.selectable).toBe(false)
        expect(documentSchema.nodes[documentTitleNodeType]!.spec).toBe(documentTitleNodeSpec)
        expect(aiChatSchema.nodes[documentTitleNodeType]!.spec).toBe(documentTitleNodeSpec)
    })
})
