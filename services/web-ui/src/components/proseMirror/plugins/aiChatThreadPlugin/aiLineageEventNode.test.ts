import {
    describe,
    expect,
    it,
} from 'vitest'
import { Schema } from 'prosemirror-model'
import {
    aiLineageEventNodeSpec,
    aiLineageEventNodeView,
    aiLineageEventNodeType,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEventNode.ts'

const lineageEventSchema = new Schema({
    nodes: {
        doc: { content: 'block*' },
        aiLineageEvent: aiLineageEventNodeSpec,
        text: { group: 'inline' },
    },
    marks: {},
})

const createLineageEventNode = (attrs: Record<string, unknown> = {}) =>
    lineageEventSchema.nodes.aiLineageEvent.create({
        kind: 'branch-fork',
        branchOriginNodeId: '',
        branchForkNodeId: '',
        ...attrs,
    })

describe('aiLineageEventNodeSpec', () => {
    it('serializes event metadata to DOM attrs and classes', () => {
        const node = createLineageEventNode({
            kind: 'branch-origin',
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
        })
        const domSpec = aiLineageEventNodeSpec.toDOM(node) as any[]

        expect(domSpec[0]).toBe('div')
        expect(domSpec[1].class).toBe('ai-lineage-event ai-lineage-event-branch-origin')
        expect(domSpec[1]['aria-label']).toBe('Branch started')
        expect(domSpec[1]['data-help-tooltip']).toBe('aria-label')
        expect(domSpec[1].title).toBeUndefined()
        expect(domSpec[1]['data-branch-origin-node-id']).toBe('origin-id')
        expect(domSpec[1]['data-branch-fork-node-id']).toBe('fork-id')
    })

    it('parses unknown kinds as branch-fork and stores ids', () => {
        const el = document.createElement('div')
        el.className = 'ai-lineage-event'
        el.setAttribute('data-lineage-event-kind', 'not-a-kind')
        el.setAttribute('data-branch-origin-node-id', 'origin-id')
        el.setAttribute('data-branch-fork-node-id', 'fork-id')

        const parseRule = aiLineageEventNodeSpec.parseDOM![0]
        const attrs = parseRule.getAttrs!(el as unknown as HTMLElement) as Record<string, any>

        expect(attrs.kind).toBe('branch-fork')
        expect(attrs.branchOriginNodeId).toBe('origin-id')
        expect(attrs.branchForkNodeId).toBe('fork-id')
    })
})

describe('aiLineageEventNodeView', () => {
    it('updates marker DOM as nodes change kinds', () => {
        const node = createLineageEventNode({
            kind: 'branch-origin',
            branchOriginNodeId: 'origin-id',
        })
        const nextNode = createLineageEventNode({
            kind: 'branch-fork',
            branchForkNodeId: 'fork-id',
        })

        const view = aiLineageEventNodeView(node as any)

        expect(view.dom.classList.contains('ai-lineage-event-branch-origin')).toBe(true)
        expect(view.dom.dataset.lineageEventKind).toBe('branch-origin')

        expect(view.update(nextNode as any)).toBe(true)
    })

    it('returns false on mismatched node type updates', () => {
        const view = aiLineageEventNodeView(createLineageEventNode() as any)

        expect(view.update({ type: { name: 'doc' } } as any)).toBe(false)
    })

    it('uses the canonical node type constant', () => {
        expect(aiLineageEventNodeType).toBe('aiLineageEvent')
    })
})
