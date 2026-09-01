import {
    describe,
    it,
    expect,
    vi,
} from 'vitest'

import {
    MetricsClient,
    type MetricsNats,
    type MetricsClientOptions,
} from './metrics-client.ts'
import {
    type CheckRequest,
    type ConfirmRequest,
} from '@lixpi/constants'

function stubNats(request: MetricsNats['request'] = vi.fn()): MetricsNats {
    return { request }
}

const opts = (over: Partial<MetricsClientOptions> = {}): MetricsClientOptions => ({
    enabled: true,
    requestTimeoutMs: 3000,
    failClosed: true,
    ...over,
})

const check: CheckRequest = {
    orgId: 'org_1',
    userId: 'usr_1',
    workflowId: 'wf_1',
    model: 'OpenAI:gpt-5',
    modality: 'tokens',
    estimatedUnits: 0,
    currency: 'USD',
}

const confirm: ConfirmRequest = {
    providerRequestId: 'req_1',
    orgId: 'org_1',
    userId: 'usr_1',
    workflowId: 'wf_1',
    workflowSeq: 1,
    model: 'OpenAI:gpt-5',
    modality: 'tokens',
    measuringUnit: 'tokens',
    usage: { promptTokens: 100, completionTokens: 50 },
    currency: 'USD',
    occurredAt: '2026-01-01T00:00:00.000Z',
}

describe('MetricsClient.check', () => {
    it('approves without a request when disabled (the plug)', async () => {
        const request = vi.fn()
        const res = await new MetricsClient(stubNats(request), opts({ enabled: false })).check(check)
        expect(res.approved).toBe(true)
        expect(request).not.toHaveBeenCalled()
    })

    it('requests usage.check and returns the decision when enabled', async () => {
        const request = vi.fn().mockResolvedValue({ approved: true, balance: 1000 })
        const res = await new MetricsClient(stubNats(request), opts()).check(check)
        expect(request).toHaveBeenCalledWith('metrics.usage.check', check, 3000)
        expect(res.approved).toBe(true)
    })

    it('fails closed when the request errors', async () => {
        const request = vi.fn().mockRejectedValue(new Error('timeout'))
        const res = await new MetricsClient(stubNats(request), opts({ failClosed: true })).check(check)
        expect(res.approved).toBe(false)
        expect(res.reason).toBe('metrics_unreachable')
    })

    it('fails open when configured', async () => {
        const request = vi.fn().mockRejectedValue(new Error('timeout'))
        const res = await new MetricsClient(stubNats(request), opts({ failClosed: false })).check(check)
        expect(res.approved).toBe(true)
    })
})

describe('MetricsClient.confirm', () => {
    it('is a no-op without a request when disabled (the plug)', async () => {
        const request = vi.fn()
        const res = await new MetricsClient(stubNats(request), opts({ enabled: false })).confirm(confirm)
        expect(res).toBeUndefined()
        expect(request).not.toHaveBeenCalled()
    })

    it('requests usage.confirm when enabled', async () => {
        const request = vi.fn().mockResolvedValue({ transferId: 'txn_1', resaleCost: 1000, balance: 999000 })
        const res = await new MetricsClient(stubNats(request), opts()).confirm(confirm)
        expect(request).toHaveBeenCalledWith('metrics.usage.confirm', confirm, 3000)
        expect(res?.transferId).toBe('txn_1')
    })

    it('swallows request errors (best-effort, never throws)', async () => {
        const request = vi.fn().mockRejectedValue(new Error('nats down'))
        const client = new MetricsClient(stubNats(request), opts())
        await expect(client.confirm(confirm)).resolves.toBeUndefined()
    })
})
