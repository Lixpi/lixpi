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
    WorkspacePromptComposer,
    type WorkspacePromptComposerOptions,
} from './workspace-prompt-composer.ts'
import type { PromptComposerEditorRequest } from './ai-prompt-composer.ts'

const owners: WorkspacePromptComposer[] = []
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
})

function fixture(raw: string | null = null) {
    const requests: PromptComposerEditorRequest[] = []
    const trayDestroy = vi.fn()
    const editorDestroy = vi.fn()
    const options: WorkspacePromptComposerOptions = {
        document,
        workspaceId: 'w',
        appearance: { popoverBoxShadow: '', useShiftingGradientBackground: false, gradientColors: [] },
        storage: { getItem: vi.fn(() => raw), setItem: vi.fn() },
        mountContextTray: () => ({ element: document.createElement('div'), destroy: trayDestroy }),
        mountEditor: request => {
            requests.push(request)
            return { editorView: {} as EditorView, restoreContent: vi.fn(), destroy: editorDestroy }
        },
        onSubmit: vi.fn(),
    }
    const mount = () => {
        const composer = new WorkspacePromptComposer(options)
        owners.push(composer)
        document.body.appendChild(composer.element)
        return composer
    }
    return { options, requests, trayDestroy, editorDestroy, mount }
}

describe('Workspace prompt composer', () => {
    it('restores and stores the workspace draft independently of canvas persistence', () => {
        const f = fixture('{"type":"doc"}')
        const composer = f.mount()
        expect(f.options.storage.getItem).toHaveBeenCalledWith('lixpi:canvas-global-composer-draft:w')
        expect(f.requests[0]?.initialContent).toEqual({ type: 'doc' })
        f.options.workspaceId = 'other'
        f.requests[0]!.onContentChange({ type: 'doc', content: [] })
        expect(f.options.storage.setItem).toHaveBeenCalledWith('lixpi:canvas-global-composer-draft:w', '{"type":"doc","content":[]}')
        expect(composer.element.contains(composer.input.element)).toBe(true)
    })

    it.each(['invalid json', 'null', '42', '[]'])('ignores malformed or non-document draft values: %s', raw => {
        const f = fixture(raw)
        f.mount()
        expect(f.requests[0]?.initialContent).toEqual({})
    })

    it('tolerates unavailable storage and stops writing after destruction', () => {
        const f = fixture()
        vi.mocked(f.options.storage.getItem).mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.mocked(f.options.storage.setItem).mockImplementation(() => {
            throw new Error('quota')
        })
        const composer = f.mount()
        expect(() => f.requests[0]!.onContentChange({})).not.toThrow()
        composer.destroy()
        f.requests[0]!.onContentChange({})
        expect(f.options.storage.setItem).toHaveBeenCalledOnce()
        expect(f.editorDestroy).toHaveBeenCalledOnce()
        expect(f.trayDestroy).toHaveBeenCalledOnce()
    })

    it('releases the mounted tray if editor construction fails', () => {
        const f = fixture()
        f.options.mountEditor = () => {
            throw new Error('editor failed')
        }
        expect(() => f.mount()).toThrow('editor failed')
        expect(f.trayDestroy).toHaveBeenCalledOnce()
        expect(document.body.childElementCount).toBe(0)
    })
})
