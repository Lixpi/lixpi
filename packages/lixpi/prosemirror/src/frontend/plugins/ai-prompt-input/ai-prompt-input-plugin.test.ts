// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { EditorState } from 'prosemirror-state'
import {
    type EditorView,
} from 'prosemirror-view'
import { testSchema } from '@lixpi/prosemirror/test-helpers'
import {
    createAiPromptInputPlugin,
    type AiPromptInputPluginOptions,
} from './ai-prompt-input-plugin.ts'

const fixture = (models: string[] = [], requireReasoningModel = true) => {
    const onSubmit = vi.fn(async () => {})
    const onSubmitError = vi.fn()
    const plugin = createAiPromptInputPlugin({
        submitOnEnter: true,
        requireReasoningModel,
        onSubmit,
        onSubmitError,
    } as unknown as AiPromptInputPluginOptions)
    const prompt = testSchema.nodes.aiPromptInput.create(
        { aiReasoningModels: JSON.stringify(models) },
        testSchema.nodes.paragraph.create(null, testSchema.text('Keep this draft')),
    )
    const view = {
        state: EditorState.create({ doc: testSchema.nodes.doc.create(null, prompt) }),
        isDestroyed: false,
        composing: false,
        dispatch: vi.fn(transaction => void (view.state = view.state.apply(transaction))),
    }
    const submit = () => plugin.props.handleKeyDown!.call(
        plugin,
        view as unknown as EditorView,
        new KeyboardEvent('keydown', {
            key: 'Enter',
            cancelable: true,
        }),
    )

    return {
        view,
        onSubmit,
        onSubmitError,
        submit,
    }
}

describe('Prompt submission feedback', () => {
    it('reports the missing reasoning selection and preserves the draft', () => {
        const f = fixture()
        expect(f.submit()).toBe(true)
        expect(f.onSubmit).not.toHaveBeenCalled()
        expect(f.onSubmitError).toHaveBeenCalledOnce()
        expect(f.onSubmitError.mock.calls[0][0].message).toBe('Choose a reasoning model before sending.')
        expect(f.view.state.doc.textContent).toBe('Keep this draft')
    })

    it('accepts an empty selection for a conversation resolved by the server', async () => {
        const f = fixture([], false)
        f.submit()
        await vi.waitFor(() => expect(f.view.state.doc.textContent).toBe(''))
        expect(f.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ aiReasoningModels: [] }))
        expect(f.onSubmitError).not.toHaveBeenCalled()
    })

    it('reports a rejected submission and preserves the draft for retry', async () => {
        const f = fixture(['test:reasoning'])
        f.onSubmit.mockRejectedValueOnce(new Error('Connection unavailable'))
        f.submit()
        await vi.waitFor(() => expect(f.onSubmitError).toHaveBeenCalledOnce())
        expect(f.onSubmitError.mock.calls[0][0].message).toBe('Connection unavailable')
        expect(f.view.state.doc.textContent).toBe('Keep this draft')
    })

    it('clears an acknowledged draft without displaying an error', async () => {
        const f = fixture(['test:reasoning'])
        f.submit()
        await vi.waitFor(() => expect(f.view.state.doc.textContent).toBe(''))
        expect(f.onSubmit).toHaveBeenCalledOnce()
        expect(f.onSubmitError).not.toHaveBeenCalled()
    })
})
