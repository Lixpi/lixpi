import { describe, expect, it } from 'vitest'

import {
    marks as packageMarks,
    nodes as packageNodes,
    schema as packageSchema,
} from '@lixpi/prosemirror'
import { marks, nodes, schema } from '$src/components/proseMirror/components/schema.ts'

describe('schema module — pass-through exports', () => {
    it('re-exports marks, nodes, and schema objects by reference', () => {
        expect(marks).toBe(packageMarks)
        expect(nodes).toBe(packageNodes)
        expect(schema).toBe(packageSchema)
    })

    it('keeps schema spec linked to the exported node and mark definitions', () => {
        expect(schema.spec.nodes.toObject()).toEqual(packageNodes)
        expect(schema.spec.marks.toObject()).toEqual(packageMarks)
    })

    it('keeps shared schema shape for document-level checks', () => {
        expect(schema.spec.nodes.toObject().doc.content).toBe(packageNodes.doc.content)
        expect(nodes.doc.content).toBe('block+')
        expect(Object.keys(schema.spec.nodes.toObject())).toContain('code_block')
        expect(Object.keys(nodes)).toEqual(expect.arrayContaining([
            'doc',
            'paragraph',
            'blockquote',
            'horizontal_rule',
            'heading',
            'hard_break',
            'text',
            'image',
            'code_block',
            'feature_reference',
        ]))
    })
})
