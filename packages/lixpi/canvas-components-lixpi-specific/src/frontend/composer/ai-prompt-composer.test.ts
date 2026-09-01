// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { EditorView } from 'prosemirror-view'
import {
    createAiPromptComposer,
    type AiPromptComposerConfig,
    type PromptComposerEditorRequest,
    type AiPromptComposerSubmitData,
} from './ai-prompt-composer.ts'

const gradients = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@lixpi/ui-primitives/gradients', () => ({ createShiftingGradientBackground: gradients.create }))
const owners: ReturnType<typeof createAiPromptComposer>[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.clearAllMocks()
})

function fixture(overrides: Partial<AiPromptComposerConfig> = {}) {
    const editor = { editorView: { focus: vi.fn() } as unknown as EditorView, restoreContent: vi.fn(), destroy: vi.fn() }
    const gradient = { triggerAnimation: vi.fn(), destroy: vi.fn() }
    gradients.create.mockReturnValueOnce(gradient)
    let request: PromptComposerEditorRequest
    const config: AiPromptComposerConfig = {
        document,
        appearance: { popoverBoxShadow: '0 1px 2px black', useShiftingGradientBackground: true, gradientColors: ['#112233', '#445566', '#778899', '#aabbcc'] },
        mountEditor: options => {
            request = options
            return editor
        },
        onSubmit: vi.fn(),
        onContentChange: vi.fn(),
        ...overrides,
    }
    const composer = createAiPromptComposer(config)
    owners.push(composer)
    document.body.appendChild(composer.element)
    return { composer, config, editor, gradient, request: request! }
}

describe('AI prompt composer lifetime', () => {
    it('owns the editor shell, appearance and supplied draft identity without choosing control defaults', () => {
        const initialContent = { type: 'doc' }
        const f = fixture({ initialContent, threadId: 'thread', className: 'workspace-composer' })
        expect(f.request).toMatchObject({ host: f.composer.editorContainer, initialContent, threadId: 'thread' })
        expect(f.composer.element.classList.contains('workspace-composer')).toBe(true)
        expect(f.composer.element.style.getPropertyValue('--dropdown-popover-box-shadow')).toBe('0 1px 2px black')
        expect(gradients.create).toHaveBeenCalledWith(f.composer.element, { colors: ['#112233', '#445566', '#778899', '#aabbcc'] })
    })

    it('forwards live callbacks and suppresses them after disposal', () => {
        const f = fixture()
        const data = { contentJSON: [] } as unknown as AiPromptComposerSubmitData
        f.request.onContentChange({ type: 'doc' })
        f.request.onSubmit(data)
        expect(f.config.onSubmit).toHaveBeenCalledWith(data)
        expect(f.config.onContentChange).toHaveBeenCalledOnce()
        const { destroy } = f.composer
        destroy()
        destroy()
        expect(f.request.signal.aborted).toBe(true)
        f.request.onSubmit(data)
        f.request.onContentChange({ type: 'doc' })
        expect(f.config.onSubmit).toHaveBeenCalledOnce()
        expect(f.config.onContentChange).toHaveBeenCalledOnce()
        expect(f.editor.destroy).toHaveBeenCalledOnce()
        expect(f.gradient.destroy).toHaveBeenCalledOnce()
        expect(f.composer.editorView).toBeNull()
    })

    it('restores content through the editor port and preserves independent instances', () => {
        const first = fixture()
        const second = fixture()
        first.composer.restoreContent({ type: 'doc' })
        expect(first.editor.restoreContent).toHaveBeenCalledWith({ type: 'doc' })
        first.composer.destroy()
        expect(() => first.composer.restoreContent({})).toThrow('AI_PROMPT_COMPOSER_NOT_READY')
        second.composer.focus()
        second.composer.triggerGradientAnimation()
        expect(second.editor.editorView.focus).toHaveBeenCalledOnce()
        expect(second.gradient.triggerAnimation).toHaveBeenCalledOnce()
        expect(second.composer.element.isConnected).toBe(true)
    })

    it('releases a gradient and detached shell when editor mounting fails', () => {
        const gradient = { destroy: vi.fn(), triggerAnimation: vi.fn() }
        gradients.create.mockReturnValueOnce(gradient)
        let request: PromptComposerEditorRequest | undefined
        expect(() =>
            createAiPromptComposer({
                document,
                appearance: { popoverBoxShadow: '', useShiftingGradientBackground: true, gradientColors: ['red', 'blue', 'green', 'white'] },
                onSubmit: vi.fn(),
                mountEditor: options => {
                    request = options
                    document.body.appendChild(options.host.parentElement!)
                    throw new Error('editor failed')
                },
            })
        ).toThrow('editor failed')
        expect(gradient.destroy).toHaveBeenCalledOnce()
        expect(request?.signal.aborted).toBe(true)
        expect(document.body.childElementCount).toBe(0)
    })

    it('removes the shell and gradient even if editor disposal fails', () => {
        const f = fixture()
        f.editor.destroy.mockImplementation(() => {
            throw new Error('editor cleanup')
        })
        expect(() => f.composer.destroy()).toThrow(AggregateError)
        expect(f.composer.element.isConnected).toBe(false)
        expect(f.gradient.destroy).toHaveBeenCalledOnce()
    })
})
