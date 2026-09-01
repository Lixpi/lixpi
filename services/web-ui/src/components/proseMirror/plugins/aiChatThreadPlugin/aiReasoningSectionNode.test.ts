import {
    describe,
    it,
    expect,
} from 'vitest'
import { testSchema } from '$src/components/proseMirror/plugins/testUtils/testSchema.ts'
import {
    aiReasoningSectionNodeSpec,
    aiReasoningSectionNodeView,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiReasoningSectionNode.ts'

const createReasoningSection = (attrs: Record<string, any>, withText = false) => {
    const textNode = withText ? [testSchema.nodes.paragraph.create(null, [testSchema.text('analysis')])] : []
    return testSchema.nodes.aiReasoningSection.create({
        generationRequestId: '',
        reasoningRunId: '',
        reasoningModelId: '',
        reasoningIndex: null,
        isReceivingAnimation: false,
        ...attrs,
    }, textNode)
}

describe('aiReasoningSectionNodeSpec', () => {
    it('serializes request, model, and index attrs to DOM', () => {
        const node = createReasoningSection({
            generationRequestId: 'req-1',
            reasoningRunId: 'run-1',
            reasoningModelId: 'OpenAI:gpt-4',
            reasoningIndex: 2,
        })
        const domSpec = aiReasoningSectionNodeSpec.toDOM(node) as any[]
        const attrs = domSpec[1]

        expect(domSpec[0]).toBe('div')
        expect(domSpec[1].class).toBe('ai-reasoning-section')
        expect(attrs['data-generation-request-id']).toBe('req-1')
        expect(attrs['data-reasoning-run-id']).toBe('run-1')
        expect(attrs['data-reasoning-model-id']).toBe('OpenAI:gpt-4')
        expect(attrs['data-reasoning-index']).toBe('2')
    })

    it('parses data attrs with receiving and null index fallback', () => {
        const el = document.createElement('div')
        el.className = 'ai-reasoning-section'
        el.setAttribute('data-generation-request-id', 'req-2')
        el.setAttribute('data-reasoning-run-id', 'run-2')
        el.setAttribute('data-reasoning-model-id', 'Anthropic:claude')
        el.setAttribute('data-reasoning-index', '')

        const parseRule = aiReasoningSectionNodeSpec.parseDOM![0]
        const attrs = parseRule.getAttrs!(el as unknown as HTMLElement) as Record<string, any>

        expect(attrs.generationRequestId).toBe('req-2')
        expect(attrs.reasoningModelId).toBe('Anthropic:claude')
        expect(attrs.reasoningIndex).toBe(null)
    })
})

describe('aiReasoningSectionNodeView', () => {
    it('marks empty receiver sections as waiting', () => {
        const node = createReasoningSection({
            generationRequestId: 'req-3',
            reasoningRunId: 'run-3',
            reasoningModelId: 'model-3',
            isReceivingAnimation: true,
        })

        const view = aiReasoningSectionNodeView(node)
        const spinner = view.dom.querySelector('.ai-reasoning-section-spinner') as HTMLElement

        expect(view.dom.classList.contains('is-empty')).toBe(true)
        expect(spinner.classList.contains('is-active')).toBe(true)
    })

    it('returns false on mismatched node type', () => {
        const node = createReasoningSection({
            generationRequestId: 'req-4',
            isReceivingAnimation: false,
        })
        const view = aiReasoningSectionNodeView(node)

        expect(view.update({ type: { name: 'doc' } } as any)).toBe(false)
    })

    it('updates metadata and waiting state across updates', () => {
        const node = createReasoningSection({
            generationRequestId: 'req-5',
            reasoningRunId: 'run-5',
            reasoningModelId: 'model-5',
            isReceivingAnimation: true,
        })
        const nextNode = createReasoningSection({
            generationRequestId: 'req-5',
            reasoningRunId: 'run-5',
            reasoningModelId: 'model-5',
            reasoningIndex: 0,
            isReceivingAnimation: false,
        }, true)

        const view = aiReasoningSectionNodeView(node)
        const spinner = view.dom.querySelector('.ai-reasoning-section-spinner') as HTMLElement

        expect(view.dom.classList.contains('is-empty')).toBe(true)
        expect(spinner.classList.contains('is-active')).toBe(true)
        expect(view.update(nextNode)).toBe(true)
        expect(view.dom.classList.contains('is-empty')).toBe(false)
        expect(spinner.classList.contains('is-active')).toBe(false)
        expect(view.dom.dataset.reasoningIndex).toBe('0')
    })
})
