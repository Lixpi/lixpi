import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import type { EditorView } from 'prosemirror-view'
import type { CanvasConversationEditorMount } from '@lixpi/canvas-components-lixpi-specific/frontend/workspace'
import {
    doc,
    p,
    thread,
    createEditorState,
} from '$src/components/proseMirror/plugins/testUtils/prosemirrorTestUtils.ts'
import { USE_AI_CHAT_META } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPluginConstants.ts'
import { createCanvasConversationEditorPort } from './conversation-editor.ts'

const mocks = vi.hoisted(() => ({ mount: vi.fn() }))
vi.mock('$src/components/proseMirror/components/editor.ts', () => ({
    ProseMirrorEditor: class {
        constructor(options: unknown) {
            return mocks.mount(options)
        }
    },
}))
vi.mock('$src/services/ai-interaction-service.ts', () => ({ default: class {} }))

function setup(version = 7) {
    const state = createEditorState(doc(p('prefix'), thread({ threadId: 'conversation' }, p('request'))))
    const dispatch = vi.fn()
    const view = { state, dispatch } as unknown as EditorView
    const destroy = vi.fn()
    mocks.mount.mockReturnValue({ editorView: view, destroy })
    const unregister = vi.fn()
    const register = vi.fn(() => unregister)
    const request: CanvasConversationEditorMount = {
        container: document.createElement('div'),
        workspaceId: 'workspace',
        thread: { threadId: 'conversation', organizationId: 'org', proseMirrorVersion: version, content: state.doc.toJSON() },
        onChange: vi.fn(),
        onStreaming: vi.fn(),
        onSubmit: vi.fn(async () => {}),
        onStop: vi.fn(),
        onReceiving: vi.fn(),
        onSegment: vi.fn(),
    }
    const editor = createCanvasConversationEditorPort({ register })(request)
    return { editor, view, dispatch, destroy, register, unregister, request }
}

beforeEach(() => vi.resetAllMocks())

describe('canvas conversation editor adapter', () => {
    it('mounts receive-only authority with the captured identity and waits before registration', () => {
        const fixture = setup()
        expect(mocks.mount.mock.calls[0][0].proseMirrorAuthority).toEqual({
            organizationId: 'org',
            workspaceId: 'workspace',
            assetId: 'conversation',
            role: 'conversation',
            baseVersion: 7,
            receiveOnly: true,
        })
        expect(fixture.register).not.toHaveBeenCalled()
        fixture.editor.activate()
        fixture.editor.activate()
        expect(fixture.register).toHaveBeenCalledTimes(1)
        fixture.editor.destroy()
        fixture.editor.destroy()
        expect(fixture.unregister).toHaveBeenCalledTimes(1)
        expect(fixture.destroy).toHaveBeenCalledTimes(1)
    })

    it('dispatches the persisted conversation without inserting a second message', () => {
        const fixture = setup()
        fixture.editor.submitPersisted()
        const transaction = fixture.dispatch.mock.calls[0][0]
        expect(transaction.docChanged).toBe(false)
        const position = fixture.view.state.doc.child(0).nodeSize
        expect(transaction.getMeta(USE_AI_CHAT_META)).toEqual({ threadId: 'conversation', nodePos: position })
        expect(fixture.editor.readContent()).toEqual(fixture.view.state.doc.toJSON())
        fixture.editor.destroy()
        fixture.editor.submitPersisted()
        expect(fixture.dispatch).toHaveBeenCalledTimes(1)
        expect(fixture.editor.readContent()).toBeUndefined()
    })

    it('releases registration returned after synchronous disposal', () => {
        const fixture = setup()
        fixture.register.mockImplementation(() => {
            fixture.editor.destroy()
            return fixture.unregister
        })
        fixture.editor.activate()
        expect(fixture.unregister).toHaveBeenCalledTimes(1)
        expect(fixture.destroy).toHaveBeenCalledTimes(1)
    })

    it('releases the editor if registration fails', () => {
        const fixture = setup()
        fixture.register.mockImplementation(() => {
            throw new Error('registration failed')
        })
        expect(() => fixture.editor.activate()).toThrow('registration failed')
        fixture.editor.destroy()
        expect(fixture.destroy).toHaveBeenCalledTimes(1)
    })

    it.each([-1, 1.5, NaN])('uses zero for an invalid document version %s', version => {
        const fixture = setup(version)
        expect(mocks.mount.mock.calls[0][0].proseMirrorAuthority.baseVersion).toBe(0)
        fixture.editor.destroy()
    })

    it('still destroys the editor if controller release fails', () => {
        const fixture = setup()
        fixture.unregister.mockImplementation(() => {
            throw new Error('release failed')
        })
        fixture.editor.activate()
        expect(() => fixture.editor.destroy()).toThrow('Canvas conversation editor cleanup failed')
        expect(fixture.destroy).toHaveBeenCalledTimes(1)
    })
})
