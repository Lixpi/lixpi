'use strict'

import { describe, it, expect, vi } from 'vitest'

import { BillingClient, type BillingNats } from './billing-client.ts'
import type { WorkflowStarted, BalanceChanged, UsageEvent } from './contracts.ts'

function stubNats(over: Partial<BillingNats> = {}): BillingNats {
    return {
        publish: vi.fn(),
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
        ...over,
    }
}

const ws: WorkflowStarted = {
    workflowId: 'wf_1',
    orgId: 'org_1',
    userId: 'usr_1',
    workflowKind: 'chat_text',
}

const opts = (enabled: boolean, gateDefaultAllow = false) => ({ enabled, gateDefaultAllow })

describe('BillingClient.publishWorkflowStarted', () => {
    it('does not publish when disabled', () => {
        const publish = vi.fn()
        new BillingClient(stubNats({ publish }), opts(false)).publishWorkflowStarted(ws)
        expect(publish).not.toHaveBeenCalled()
    })

    it('publishes the run-start signal when enabled', () => {
        const publish = vi.fn()
        new BillingClient(stubNats({ publish }), opts(true)).publishWorkflowStarted(ws)
        expect(publish).toHaveBeenCalledTimes(1)
        expect(publish).toHaveBeenCalledWith('billing.workflow.started', ws)
    })

    it('swallows publish errors (fire-and-forget)', () => {
        const publish = vi.fn(() => {
            throw new Error('nats down')
        })
        expect(() =>
            new BillingClient(stubNats({ publish }), opts(true)).publishWorkflowStarted(ws),
        ).not.toThrow()
    })
})

describe('BillingClient.publishUsage', () => {
    const ev = { providerRequestId: 'r1' } as UsageEvent

    it('does not publish when disabled', () => {
        const publish = vi.fn()
        new BillingClient(stubNats({ publish }), opts(false)).publishUsage(ev)
        expect(publish).not.toHaveBeenCalled()
    })

    it('publishes when enabled', () => {
        const publish = vi.fn()
        new BillingClient(stubNats({ publish }), opts(true)).publishUsage(ev)
        expect(publish).toHaveBeenCalledTimes(1)
    })

    it('swallows publish errors (fire-and-forget)', () => {
        const publish = vi.fn(() => {
            throw new Error('nats down')
        })
        expect(() => new BillingClient(stubNats({ publish }), opts(true)).publishUsage(ev)).not.toThrow()
    })
})

describe('BillingClient.gateAllows', () => {
    it('allows when the kind is true in the allowance', () => {
        const c = new BillingClient(stubNats(), opts(true, false))
        expect(c.gateAllows({ chat_text: true, chat_video: false }, 'chat_text')).toBe(true)
    })

    it('denies when the kind is false in the allowance', () => {
        const c = new BillingClient(stubNats(), opts(true, true))
        expect(c.gateAllows({ chat_text: true, chat_video: false }, 'chat_video')).toBe(false)
    })

    it('uses the cold-start default when no allowance is projected yet', () => {
        expect(new BillingClient(stubNats(), opts(true, true)).gateAllows(undefined, 'chat_text')).toBe(true)
        expect(new BillingClient(stubNats(), opts(true, false)).gateAllows(undefined, 'chat_text')).toBe(false)
    })

    it('uses the cold-start default when the kind is absent from a partial allowance', () => {
        const c = new BillingClient(stubNats(), opts(true, false))
        expect(c.gateAllows({ chat_text: true }, 'chat_video')).toBe(false)
    })
})

describe('BillingClient.subscribeBalanceChanged', () => {
    const handler = (_ev: BalanceChanged) => {}

    it('does not subscribe when disabled', () => {
        const subscribe = vi.fn()
        new BillingClient(stubNats({ subscribe }), opts(false)).subscribeBalanceChanged(handler)
        expect(subscribe).not.toHaveBeenCalled()
    })

    it('subscribes to balance.changed when enabled', () => {
        const subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }))
        new BillingClient(stubNats({ subscribe }), opts(true)).subscribeBalanceChanged(handler)
        expect(subscribe).toHaveBeenCalledTimes(1)
        expect(subscribe).toHaveBeenCalledWith('billing.balance.changed', handler)
    })
})
