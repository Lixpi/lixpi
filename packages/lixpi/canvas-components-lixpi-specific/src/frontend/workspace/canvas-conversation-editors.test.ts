// @vitest-environment happy-dom
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    CanvasConversationEditors,
    type CanvasConversationEditorScope,
    type CanvasConversationEditorsPorts,
} from './canvas-conversation-editors.ts'

type Entry = { id: string; destroy: ReturnType<typeof vi.fn> }
const owners: CanvasConversationEditors<Entry>[] = []
function fixture() {
    const pane = document.createElement('div')
    document.body.appendChild(pane)
    const timers = new Map<number, () => void>()
    const ports: CanvasConversationEditorsPorts = {
        pane,
        setTimer: vi.fn(callback => {
            const id = timers.size + 1
            timers.set(id, callback)
            return id
        }),
        clearTimer: vi.fn(),
    }
    const owner = new CanvasConversationEditors<Entry>(ports)
    owners.push(owner)
    const mount = (id = 'thread') => {
        let scope!: CanvasConversationEditorScope
        const entry = owner.mount(id, current => {
            scope = current
            const destroy = vi.fn()
            current.own(destroy)
            return { id, destroy }
        })
        return { entry, scope }
    }
    return { owner, ports, timers, pane, mount }
}
afterEach(() => {
    for (const owner of owners.splice(0)) owner.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('CanvasConversationEditors', () => {
    it('uses one hidden host and one independent editor scope per conversation', () => {
        const f = fixture()
        const first = f.mount('first')
        const second = f.mount('second')
        expect(f.pane.querySelectorAll('.workspace-detached-ai-chat-thread-host')).toHaveLength(1)
        expect(f.pane.querySelectorAll('.workspace-detached-ai-chat-thread-instance')).toHaveLength(2)
        expect([...f.owner.keys()]).toEqual(['first', 'second'])
        expect(f.owner.get('first')).toBe(first.entry)
        f.owner.remove('first')
        expect(first.scope.signal.aborted).toBe(true)
        expect(first.entry.destroy).toHaveBeenCalledOnce()
        expect(second.scope.isCurrent()).toBe(true)
        expect(second.entry.destroy).not.toHaveBeenCalled()
    })

    it('destroys an existing editor before mounting a replacement for the same thread', () => {
        const f = fixture()
        const first = f.mount()
        const second = f.owner.mount('thread', scope => {
            expect(first.scope.signal.aborted).toBe(true)
            expect(first.entry.destroy).toHaveBeenCalledOnce()
            expect(first.scope.container.isConnected).toBe(false)
            expect(scope.isCurrent()).toBe(true)
            return { id: 'new', destroy: vi.fn() }
        })
        expect(f.owner.get('thread')).toBe(second)
        expect(first.scope.isCurrent()).toBe(false)
    })

    it('cleans up every partial resource even when a child disposer fails', () => {
        const f = fixture()
        const editor = vi.fn()
        const service = vi.fn(() => {
            throw new Error('disconnect failed')
        })
        expect(() =>
            f.owner.mount('thread', scope => {
                scope.own(editor)
                scope.own(service)
                throw new Error('register failed')
            })
        ).toThrow(AggregateError)
        expect(editor).toHaveBeenCalledOnce()
        expect(service).toHaveBeenCalledOnce()
        expect(f.owner.has('thread')).toBe(false)
        expect(f.pane.querySelectorAll('.workspace-detached-ai-chat-thread-instance')).toHaveLength(0)
    })

    it('keeps a newer reentrant mount when the original factory returns late', () => {
        const f = fixture()
        let replacement!: Entry
        const releaseLateResource = vi.fn()
        expect(() =>
            f.owner.mount('thread', scope => {
                replacement = f.mount().entry
                scope.own(releaseLateResource)
                return { id: 'old', destroy: vi.fn() }
            })
        ).toThrow('replaced during mounting')
        expect(f.owner.get('thread')).toBe(replacement)
        expect(releaseLateResource).toHaveBeenCalledOnce()
        expect(replacement.destroy).not.toHaveBeenCalled()
    })

    it('rejects a deferred teardown after a new editor takes the same thread ID', () => {
        const f = fixture()
        f.mount()
        const callback = vi.fn(() => f.owner.remove('thread'))
        f.owner.defer('thread', 1500, callback)
        const replacement = f.mount()
        f.timers.get(1)!()
        expect(callback).not.toHaveBeenCalled()
        expect(f.owner.get('thread')).toBe(replacement.entry)
        expect(f.ports.clearTimer).toHaveBeenCalledWith(1)
    })

    it('runs only the latest deferred teardown and releases its timer once', () => {
        const f = fixture()
        f.mount()
        const first = vi.fn()
        const second = vi.fn(() => f.owner.remove('thread'))
        f.owner.defer('thread', 1500, first)
        f.owner.defer('thread', 1500, second)
        f.timers.get(1)!()
        f.timers.get(2)!()
        f.timers.get(2)!()
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledOnce()
        expect(f.ports.clearTimer).toHaveBeenCalledTimes(2)
    })

    it('clears all editors even when one destroy fails and allows a later mount', () => {
        const f = fixture()
        const first = f.mount('first')
        const second = f.mount('second')
        first.entry.destroy.mockImplementationOnce(() => {
            throw new Error('destroy failed')
        })
        expect(() => f.owner.clear()).toThrow()
        expect(second.entry.destroy).toHaveBeenCalledOnce()
        expect([...f.owner.keys()]).toEqual([])
        expect(f.pane.querySelectorAll('.workspace-detached-ai-chat-thread-instance')).toHaveLength(0)
        expect(f.mount('new').scope.isCurrent()).toBe(true)
    })

    it('destroys the host and prevents new work and deferred callbacks', () => {
        const f = fixture()
        const mounted = f.mount()
        const callback = vi.fn()
        f.owner.defer('thread', 1500, callback)
        f.owner.destroy()
        f.timers.get(1)!()
        expect(callback).not.toHaveBeenCalled()
        expect(mounted.scope.signal.aborted).toBe(true)
        expect(f.pane.childElementCount).toBe(0)
        expect(() => f.mount()).toThrow('disposed')
        f.owner.defer('thread', 1500, callback)
        expect(f.ports.setTimer).toHaveBeenCalledOnce()
    })

    it('keeps editors in separate canvas instances independent', () => {
        const first = fixture()
        const second = fixture()
        first.mount()
        const retained = second.mount()
        first.owner.destroy()
        expect(retained.scope.isCurrent()).toBe(true)
        expect(retained.entry.destroy).not.toHaveBeenCalled()
        expect(retained.scope.container.isConnected).toBe(true)
    })

    it('can retry deferred cleanup after timer allocation fails', () => {
        const f = fixture()
        f.mount()
        vi.mocked(f.ports.setTimer).mockImplementationOnce(() => {
            throw new Error('timer failed')
        })
        expect(() => f.owner.defer('thread', 1500, vi.fn())).toThrow('timer failed')
        const callback = vi.fn()
        f.owner.defer('thread', 1500, callback)
        f.timers.get(1)!()
        expect(callback).toHaveBeenCalledOnce()
    })
})
