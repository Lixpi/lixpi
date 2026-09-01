import {
    describe,
    expect,
    it,
} from 'vitest'
import { planVisualState } from './visual-state.ts'

describe('planVisualState', () => {
    it('preserves pending visual fields while adopting unrelated authoritative fields', () => {
        const pending = { items: ['a', 'b'], revision: 1 }
        const incoming = { items: ['a'], revision: 2 }
        const result = planVisualState({ incomingState: incoming, pendingVisualCommit: { state: pending, visualSyncKey: 'a,b' }, getSyncKey: state => state.items.join(','), coversIncoming: (a, b) => a.items.every(item => b.items.includes(item)), preserveVisuals: (a, b) => ({ ...a, items: b.items }) })
        expect(result.state).toEqual({ items: ['a', 'b'], revision: 2 })
        expect(result.usedPendingVisualState).toBe(true)
        expect(incoming.items).toEqual(['a'])
    })

    it('acknowledges matching visuals and discards a pending commit on structural replacement', () => {
        const options = { pendingVisualCommit: { state: 'pending', visualSyncKey: 'pending' }, getSyncKey: (state: string) => state, coversIncoming: () => false, preserveVisuals: (_a: string, b: string) => b }
        expect(planVisualState({ ...options, incomingState: 'pending' })).toEqual({ state: 'pending', pendingVisualCommit: null, usedPendingVisualState: false, acknowledgedPendingVisualState: true })
        expect(planVisualState({ ...options, incomingState: 'replacement' })).toEqual({ state: 'replacement', pendingVisualCommit: null, usedPendingVisualState: false, acknowledgedPendingVisualState: false })
    })
})
