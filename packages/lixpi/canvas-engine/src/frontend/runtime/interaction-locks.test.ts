import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { InteractionLocks } from './interaction-locks.ts'

describe('InteractionLocks', () => {
    it('keeps other interactions locked after out-of-order and repeated releases', () => {
        const locks = new InteractionLocks()
        const listener = vi.fn()
        locks.subscribe(listener)
        const panel = locks.acquire()
        const marquee = locks.acquire({ selection: true })
        panel()
        panel()
        expect(locks.state).toEqual({ locked: true, selection: true })
        marquee()
        expect(listener).toHaveBeenLastCalledWith({ locked: false, selection: false })
        locks.destroy()
    })

    it('expires existing owners without allowing their late release to unlock a new owner', () => {
        const locks = new InteractionLocks()
        const stale = locks.acquire()
        locks.clear()
        const active = locks.acquire()
        stale()
        expect(locks.state.locked).toBe(true)
        active()
        locks.destroy()
        expect(() => locks.acquire()).toThrow('disposed')
    })
})
