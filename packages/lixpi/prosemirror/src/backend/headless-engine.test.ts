import { describe, expect, it } from 'vitest'

import { createProseMirrorSchema, DOCUMENT_TYPE } from '../shared/schema-builder.ts'
import { HeadlessProseMirrorEngine } from './headless-engine.ts'

function createDocJson() {
    const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONTENT)
    const title = schema.nodes.documentTitle.create(null, schema.text('Title'))
    const paragraph = schema.nodes.paragraph.create(null, schema.text('ready'))
    const doc = schema.nodes.doc.create(null, [title, paragraph])
    return doc.toJSON()
}

describe('HeadlessProseMirrorEngine', () => {
    it('creates a valid default document when no doc snapshot is supplied', () => {
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONTENT,
        })

        expect(engine.version).toBe(0)
        expect(engine.state.doc.type.name).toBe('doc')
        expect(engine.snapshot().type).toBe('doc')
    })

    it('creates a schema-checked document from a provided JSON snapshot', () => {
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONTENT,
            doc: createDocJson(),
        })

        const snapshot = engine.snapshot()
        expect(snapshot).toMatchObject({
            type: 'doc',
            content: expect.any(Array),
        })
    })

    it('starts at the provided version and increases with each applied transaction', () => {
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONTENT,
            version: 7,
        })
        const transaction = engine.state.tr.insertText('inline')
        const applyResult = engine.applyTransaction(transaction)

        expect(applyResult.version).toBe(8)
        expect(applyResult.transaction.steps).toHaveLength(1)
        expect(engine.version).toBe(8)
    })

    it('applies raw steps from JSON and updates snapshot/version consistently', () => {
        const schema = createProseMirrorSchema(DOCUMENT_TYPE.ASSET_CONTENT)
        const engine = new HeadlessProseMirrorEngine({
            documentType: DOCUMENT_TYPE.ASSET_CONTENT,
            doc: createDocJson(),
        })
        const transaction = engine.state.tr.insertText(' plus', 5)
        const step = transaction.steps[0]

        const result = engine.applyStepJson(step.toJSON())
        expect(result.version).toBe(1)
        expect(result.doc.textBetween(0, result.doc.content.size, '\n', '')).toContain('plus')
    })

    it('keeps version unchanged when no steps are applied', () => {
        const engine = new HeadlessProseMirrorEngine({ documentType: DOCUMENT_TYPE.ASSET_CONTENT })
        const result = engine.applyTransaction(engine.state.tr)

        expect(result.version).toBe(0)
        expect(result.transaction.steps).toHaveLength(0)
    })

    it('throws for invalid step JSON and malformed doc JSON', () => {
        const engine = new HeadlessProseMirrorEngine({ documentType: DOCUMENT_TYPE.ASSET_CONTENT })
        expect(() => {
            engine.applyStepJson({} as never)
        }).toThrow()

        expect(() => {
            new HeadlessProseMirrorEngine({
                documentType: DOCUMENT_TYPE.ASSET_CONTENT,
                doc: { type: 'nope', content: [] } as never,
            })
        }).toThrow()
    })
})
