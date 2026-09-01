'use strict'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { Lifetime } from './lifetime.ts'

describe('canvas lifetime', () => {
    it('releases a lease once whether explicitly released or disposed with its scope', () => {
        const lifetime = new Lifetime()
        const cleanup = vi.fn()
        const release = lifetime.own(cleanup)
        release()
        lifetime.destroy()
        release()
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(lifetime.signal.aborted).toBe(true)
    })

    it('releases late acquisitions immediately after disposal', () => {
        const lifetime = new Lifetime()
        lifetime.destroy()
        const cleanup = vi.fn()
        lifetime.own(cleanup)
        expect(cleanup).toHaveBeenCalledOnce()
    })

    it('cancels child work without disposing an independent canvas', () => {
        const first = new Lifetime()
        const second = new Lifetime()
        const child = first.child()
        const cleanup = vi.fn()
        child.own(cleanup)
        first.destroy()
        expect(child.signal.aborted).toBe(true)
        expect(cleanup).toHaveBeenCalledOnce()
        expect(second.signal.aborted).toBe(false)
        second.destroy()
    })

    it('attempts every cleanup in reverse ownership order when one fails', () => {
        const lifetime = new Lifetime()
        const calls: number[] = []
        lifetime.own(() => calls.push(1))
        lifetime.own(() => {
            calls.push(2)
            throw new Error('release failed')
        })
        lifetime.own(() => calls.push(3))
        expect(() => lifetime.destroy()).toThrow(AggregateError)
        expect(calls).toEqual([3, 2, 1])
        expect(() => lifetime.destroy()).not.toThrow()
    })
})
