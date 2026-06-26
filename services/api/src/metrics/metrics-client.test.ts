'use strict'

import { describe, it, expect, vi } from 'vitest'

import { MetricsClient, type MetricsNats } from './metrics-client.ts'
import type { WorkflowStarted, BalanceChanged, UsageEvent } from './contracts.ts'

function stubNats(over: Partial<MetricsNats> = {}): MetricsNats {
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

describe('MetricsClient.publishWorkflowStarted', () => {
    it('does not publish when disabled', () => {
        const publish = vi.fn()
        new MetricsClient(stubNats({ publish }), opts(false)).publishWorkflowStarted(ws)
        expect(publish).not.toHaveBeenCalled()
    })

    it('publishes the run-start signal when enabled', () => {
        const publish = vi.fn()
        new MetricsClient(stubNats({ publish }), opts(true)).publishWorkflowStarted(ws)
        expect(publish).toHaveBeenCalledTimes(1)
        expect(publish).toHaveBeenCalledWith('metrics.workflow.started', ws)
    })

    it('swallows publish errors (fire-and-forget)', () => {
        const publish = vi.fn(() => {
            throw new Error('nats down')
        })
        expect(() =>
            new MetricsClient(stubNats({ publish }), opts(true)).publishWorkflowStarted(ws),
        ).not.toThrow()
    })
})

describe('MetricsClient.publishUsage', () => {
    const ev = { providerRequestId: 'r1' } as UsageEvent

    it('does not publish when disabled', () => {
        const publish = vi.fn()
        new MetricsClient(stubNats({ publish }), opts(false)).publishUsage(ev)
        expect(publish).not.toHaveBeenCalled()
    })

    it('publishes when enabled', () => {
        const publish = vi.fn()
        new MetricsClient(stubNats({ publish }), opts(true)).publishUsage(ev)
        expect(publish).toHaveBeenCalledTimes(1)
    })

    it('swallows publish errors (fire-and-forget)', () => {
        const publish = vi.fn(() => {
            throw new Error('nats down')
        })
        expect(() => new MetricsClient(stubNats({ publish }), opts(true)).publishUsage(ev)).not.toThrow()
    })
})

describe('MetricsClient.gateAllows', () => {
    it('allows when the kind is true in the allowance', () => {
        const c = new MetricsClient(stubNats(), opts(true, false))
        expect(c.gateAllows({ chat_text: true, chat_video: false }, 'chat_text')).toBe(true)
    })

    it('denies when the kind is false in the allowance', () => {
        const c = new MetricsClient(stubNats(), opts(true, true))
        expect(c.gateAllows({ chat_text: true, chat_video: false }, 'chat_video')).toBe(false)
    })

    it('uses the cold-start default when no allowance is projected yet', () => {
        expect(new MetricsClient(stubNats(), opts(true, true)).gateAllows(undefined, 'chat_text')).toBe(true)
        expect(new MetricsClient(stubNats(), opts(true, false)).gateAllows(undefined, 'chat_text')).toBe(false)
    })

    it('uses the cold-start default when the kind is absent from a partial allowance', () => {
        const c = new MetricsClient(stubNats(), opts(true, false))
        expect(c.gateAllows({ chat_text: true }, 'chat_video')).toBe(false)
    })
})

describe('MetricsClient.subscribeBalanceChanged', () => {
    const handler = (_ev: BalanceChanged) => {}

    it('does not subscribe when disabled', () => {
        const subscribe = vi.fn()
        new MetricsClient(stubNats({ subscribe }), opts(false)).subscribeBalanceChanged(handler)
        expect(subscribe).not.toHaveBeenCalled()
    })

    it('subscribes to balance.changed when enabled', () => {
        const subscribe = vi.fn(() => ({ unsubscribe: vi.fn() }))
        new MetricsClient(stubNats({ subscribe }), opts(true)).subscribeBalanceChanged(handler)
        expect(subscribe).toHaveBeenCalledTimes(1)
        expect(subscribe).toHaveBeenCalledWith('metrics.balance.changed', handler)
    })
})
