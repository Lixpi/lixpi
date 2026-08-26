import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenAiActualsAdapter } from './openai-actuals-adapter.ts'

const jsonResponse = (body: unknown, ok = true, status = 200): Response => ({
    ok,
    status,
    json: async () => body,
} as unknown as Response)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// =============================================================================
// PROJECT/LINE-ITEM ATTRIBUTION — NEVER MODEL ATTRIBUTION
// =============================================================================

describe('OpenAiActualsAdapter — attribution grain', () => {
    it('groups only by project and line item, never claims a model dimension OpenAI Costs cannot supply', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [
                { amount: { value: 12.5, currency: 'usd' }, project_id: 'proj_a', line_item: 'gpt-5' },
            ] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')

        expect(actuals).toHaveLength(1)
        expect(actuals[0].grouping).toEqual({ projectId: 'proj_a', lineItem: 'gpt-5' })
        expect(Object.keys(actuals[0].grouping)).not.toContain('model')
        expect(actuals[0].providerRoute).toBe('openai-api')
        expect(actuals[0].providerAccountRef).toBe('lixpi-prod')
        expect(actuals[0].actualProviderCostUsd).toBe('12.500000')
    })

    it('passes a string amount through unchanged instead of re-formatting it', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [{ amount: { value: '3.140000', currency: 'USD' }, project_id: 'proj_a' }] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals[0].actualProviderCostUsd).toBe('3.140000')
    })

    it('drops a result missing both project and line item from grouping without crashing', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [{ amount: { value: 1, currency: 'USD' } }] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals[0].grouping).toEqual({})
    })
})

// =============================================================================
// CURRENCY FILTERING
// =============================================================================

describe('OpenAiActualsAdapter — currency filtering', () => {
    it('excludes a non-USD result', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [
                { amount: { value: 5, currency: 'EUR' }, project_id: 'proj_a' },
                { amount: { value: 5, currency: 'USD' }, project_id: 'proj_a' },
            ] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals).toHaveLength(1)
    })

    it('excludes a result with a missing or non-numeric amount', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [
                { amount: { currency: 'USD' }, project_id: 'proj_a' },
                { amount: { value: null, currency: 'USD' }, project_id: 'proj_a' },
            ] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals).toHaveLength(0)
    })
})

// =============================================================================
// SHARED-ACCOUNT FILTERING (project allowlist)
// =============================================================================

describe('OpenAiActualsAdapter — shared-account filtering', () => {
    it('excludes costs outside the configured project allowlist', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [
                { amount: { value: 10, currency: 'USD' }, project_id: 'proj_lixpi' },
                { amount: { value: 20, currency: 'USD' }, project_id: 'proj_unrelated' },
            ] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', ['proj_lixpi'])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals).toHaveLength(1)
        expect(actuals[0].grouping).toMatchObject({ projectId: 'proj_lixpi' })
    })

    it('excludes a result with no project_id at all when an allowlist is configured', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [{ amount: { value: 10, currency: 'USD' } }] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', ['proj_lixpi'])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals).toHaveLength(0)
    })

    it('includes every project when no allowlist is configured (documented risk on a shared org)', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            data: [{ results: [
                { amount: { value: 10, currency: 'USD' }, project_id: 'proj_lixpi' },
                { amount: { value: 20, currency: 'USD' }, project_id: 'proj_unrelated' },
            ] }],
            has_more: false,
        }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')
        expect(actuals).toHaveLength(2)
    })

    it('sends every configured project id as a project_ids query parameter', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', ['proj_a', 'proj_b'])
        await adapter.fetchDay('2026-08-25')
        const requestedUrl = fetchMock.mock.calls[0][0] as URL
        expect(requestedUrl.searchParams.getAll('project_ids')).toEqual(['proj_a', 'proj_b'])
    })
})

// =============================================================================
// PAGINATION
// =============================================================================

describe('OpenAiActualsAdapter — pagination', () => {
    it('follows has_more/next_page across multiple pages and merges every result', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                data: [{ results: [{ amount: { value: 1, currency: 'USD' }, project_id: 'proj_a' }] }],
                has_more: true,
                next_page: 'cursor-2',
            }))
            .mockResolvedValueOnce(jsonResponse({
                data: [{ results: [{ amount: { value: 2, currency: 'USD' }, project_id: 'proj_a' }] }],
                has_more: false,
            }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        const actuals = await adapter.fetchDay('2026-08-25')

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(actuals.map(a => a.actualProviderCostUsd)).toEqual(['1.000000', '2.000000'])
        const secondCallUrl = fetchMock.mock.calls[1][0] as URL
        expect(secondCallUrl.searchParams.get('page')).toBe('cursor-2')
    })

    it('throws rather than looping forever when has_more is true but next_page is missing', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], has_more: true, next_page: null }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        await expect(adapter.fetchDay('2026-08-25')).rejects.toThrow(/has_more without next_page/)
    })
})

// =============================================================================
// REQUEST SHAPE AND ERROR HANDLING
// =============================================================================

describe('OpenAiActualsAdapter — request shape and errors', () => {
    it('rejects a malformed day before making any request', async () => {
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        await expect(adapter.fetchDay('not-a-day')).rejects.toThrow(/Invalid reconciliation day/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('scopes the request to exactly the requested UTC day with a 1-day bucket width', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        await adapter.fetchDay('2026-08-25')
        const requestedUrl = fetchMock.mock.calls[0][0] as URL
        expect(requestedUrl.searchParams.get('start_time')).toBe(String(Date.parse('2026-08-25T00:00:00.000Z') / 1000))
        expect(requestedUrl.searchParams.get('end_time')).toBe(String(Date.parse('2026-08-26T00:00:00.000Z') / 1000))
        expect(requestedUrl.searchParams.get('bucket_width')).toBe('1d')
        expect(requestedUrl.searchParams.getAll('group_by')).toEqual(['project_id', 'line_item'])
    })

    it('sends the admin key as a bearer token', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ data: [], has_more: false }))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin-key', [])
        await adapter.fetchDay('2026-08-25')
        const options = fetchMock.mock.calls[0][1] as RequestInit
        expect((options.headers as Record<string, string>).Authorization).toBe('Bearer sk-admin-key')
    })

    it('throws on a non-ok HTTP response', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 401))
        const adapter = new OpenAiActualsAdapter('lixpi-prod', 'sk-admin', [])
        await expect(adapter.fetchDay('2026-08-25')).rejects.toThrow(/HTTP 401/)
    })
})
