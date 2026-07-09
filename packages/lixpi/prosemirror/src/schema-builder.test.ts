import { describe, expect, it } from 'vitest'
import { Schema } from 'prosemirror-model'

import { DOCUMENT_TYPE, createProseMirrorSchema, getSupportedNodes, nodesBuilder } from './shared/schema-builder.ts'
import { documentTitleNodeType } from './shared/node-specs.ts'

describe('createProseMirrorSchema', () => {
    it('builds the default document schema with title and block fallback', () => {
        const schema = createProseMirrorSchema()

        expect(schema.nodes.doc.spec.content).toBe('documentTitle block+')
        expect(schema.nodes[documentTitleNodeType]).toBeDefined()
        expect(schema.nodes.image.isAtom).toBe(true)
    })

    it('adds AI chat node types and document+thread ordering constraints', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_CHAT_THREAD)

        expect(schema.nodes.doc.spec.content).toBe('documentTitle aiChatThread+')
        expect(schema.nodes.aiChatThread).toBeDefined()
        expect(schema.nodes.aiUserMessage).toBeDefined()
    })

    it('builds AI prompt input schemas with prompt node only', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.AI_PROMPT_INPUT)

        expect(schema.nodes.doc.spec.content).toBe('aiPromptInput')
        expect(schema.nodes.aiPromptInput).toBeDefined()
        expect(schema.nodes.aiChatThread).toBeUndefined()
        expect(schema.nodes.aiUserMessage).toBeUndefined()
    })

    it('falls back to document supported nodes for unknown document types', () => {
        const schema = createProseMirrorSchema('other' as never)

        expect(schema.nodes.doc.spec.content).toBe('documentTitle block+')
        expect(schema.nodes.aiChatThread).toBeUndefined()
        expect(schema.nodes.aiPromptInput).toBeUndefined()
        expect(schema.nodes.documentTitle).toBeDefined()
    })
})

describe('getSupportedNodes', () => {
    it('returns custom nodes for standard documents and unknown types', () => {
        expect(getSupportedNodes(DOCUMENT_TYPE.DOCUMENT)).toMatchObject({
            documentTitle: expect.objectContaining({ selectable: false }),
            taskRow: expect.anything(),
        })
        expect(getSupportedNodes('invalid' as never)).toMatchObject({
            documentTitle: expect.objectContaining({ selectable: false }),
            taskRow: expect.anything(),
        })
        expect(getSupportedNodes(DOCUMENT_TYPE.AI_CHAT_THREAD).aiChatThread).toBeDefined()
        expect(getSupportedNodes(DOCUMENT_TYPE.AI_PROMPT_INPUT).aiChatThread).toBeUndefined()
    })
})

describe('nodesBuilder', () => {
    it('replaces existing nodes and injects new nodes beside paragraph', () => {
        const baseSchema = createProseMirrorSchema()
        const customTitleSpec = {
            ...(getSupportedNodes(DOCUMENT_TYPE.DOCUMENT)[documentTitleNodeType] ?? {}),
            toDOM: () => ['h2', 0],
        }

        const rebuiltNodes = nodesBuilder(baseSchema, {
            [documentTitleNodeType]: customTitleSpec,
            customAiNode: {
                group: 'block',
                content: 'inline*',
                toDOM: () => ['div', 0],
                parseDOM: [{ tag: 'div.custom-ai-node' }],
            },
        }, DOCUMENT_TYPE.DOCUMENT)
        const rebuilt = new Schema({
            nodes: rebuiltNodes,
            marks: baseSchema.spec.marks,
        })

        expect(rebuilt.nodes.documentTitle.spec.toDOM()).toEqual(['h2', 0])
        expect(rebuilt.nodes.customAiNode).toBeDefined()
        expect(rebuilt.nodes.doc.spec.content).toBe('documentTitle block+')
    })
})
