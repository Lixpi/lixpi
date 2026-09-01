// @vitest-environment happy-dom
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { WorkspaceConversationRuns } from './workspace-conversation-runs.ts'

function setup() {
    const timers: Array<() => void> = []
    const receiving = vi.fn()
    const owner = new WorkspaceConversationRuns<{ id: string }>({
        pane: document.createElement('div'),
        setReceiving: receiving,
        setTimer: callback => {
            timers.push(callback)
            return timers.length
        },
        clearTimer: vi.fn(),
    })
    const mount = (id: string, destroy = vi.fn()) =>
        owner.mount(id, scope => {
            scope.own(destroy)
            return { id }
        })
    return { owner, receiving, timers, mount }
}

describe('workspace conversation runs', () => {
    it('separates active and settled runs while keeping settled editors until teardown', () => {
        const { owner, receiving, mount } = setup()
        owner.activate('one')
        mount('one')
        owner.settle('one')
        expect(owner.isActive('one')).toBe(false)
        expect(owner.isSettled('one')).toBe(true)
        expect(owner.has('one')).toBe(true)
        owner.teardown('one')
        expect(owner.has('one')).toBe(false)
        expect(owner.isSettled('one')).toBe(true)
        owner.activate('one')
        expect(owner.isSettled('one')).toBe(false)
        expect([...owner.activeIds()]).toEqual(['one'])
        expect(receiving).toHaveBeenLastCalledWith('one', true)
        owner.destroy()
    })

    it('clears pending activation and every editor when changing scenes', () => {
        const { owner, receiving, mount } = setup()
        const dispose = vi.fn()
        owner.activate('pending')
        owner.activate('mounted')
        mount('mounted', dispose)
        owner.settle('settled')
        owner.clear()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(receiving).toHaveBeenCalledWith('pending', false)
        expect(receiving).toHaveBeenCalledWith('mounted', false)
        expect([...owner.activeIds()]).toEqual([])
        expect([...owner.keys()]).toEqual([])
        expect(owner.isSettled('settled')).toBe(false)
        owner.activate('next-scene')
        mount('next-scene')
        expect(owner.has('next-scene')).toBe(true)
        owner.destroy()
    })

    it('does not let an old deferred teardown remove a replacement editor', () => {
        const { owner, timers, mount } = setup()
        owner.activate('conversation')
        mount('conversation')
        owner.defer('conversation', 1500)
        const replacement = mount('conversation')
        timers[0]()
        expect(owner.get('conversation')).toBe(replacement)
        expect(owner.isActive('conversation')).toBe(true)
        owner.destroy()
    })

    it('releases every editor and receiving flag even if cleanup fails', () => {
        const { owner, receiving, mount } = setup()
        const second = vi.fn()
        owner.activate('one')
        owner.activate('two')
        mount('one', () => {
            throw new Error('editor failed')
        })
        mount('two', second)
        receiving.mockImplementation(id => {
            if (id === 'one') throw new Error('receiver failed')
        })
        expect(() => owner.clear()).toThrow('Workspace conversation cleanup failed')
        expect(second).toHaveBeenCalledTimes(1)
        expect(receiving).toHaveBeenCalledWith('two', false)
        expect([...owner.keys()]).toEqual([])
        expect([...owner.activeIds()]).toEqual([])
        owner.destroy()
    })

    it('clears receiving state even when a single editor teardown fails', () => {
        const { owner, receiving, mount } = setup()
        owner.activate('one')
        mount('one', () => {
            throw new Error('failed')
        })
        expect(() => owner.teardown('one')).toThrow('Workspace conversation teardown failed')
        expect(receiving).toHaveBeenLastCalledWith('one', false)
        expect(owner.isActive('one')).toBe(false)
        owner.destroy()
    })

    it('is terminal and idempotent after destruction', () => {
        const { owner, mount } = setup()
        const dispose = vi.fn()
        mount('one', dispose)
        owner.destroy()
        owner.destroy()
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(() => mount('two')).toThrow('Workspace conversation runs are disposed')
        expect(() => owner.activate('two')).toThrow('Workspace conversation runs are disposed')
    })

    it('does not release a sibling canvas with the same thread identity', () => {
        const first = setup()
        const second = setup()
        first.owner.activate('same')
        second.owner.activate('same')
        first.mount('same')
        second.mount('same')
        first.owner.clear()
        expect(second.owner.isActive('same')).toBe(true)
        expect(second.owner.has('same')).toBe(true)
        first.owner.destroy()
        second.owner.destroy()
    })
})
