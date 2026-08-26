'use strict'

import { canonicalHash } from '../importer/canonical-json.ts'
import type { ReconciliationActualUsage } from '@lixpi/constants'
import type { UsageActualsAdapter } from './types.ts'

type OpenAiCostResult = {
    amount?: { value?: number | string; currency?: string }
    project_id?: string | null
    line_item?: string | null
}

type OpenAiCostsPage = {
    data?: Array<{ results?: OpenAiCostResult[] }>
    has_more?: boolean
    next_page?: string | null
}

type OpenAiUsageResult = {
    input_tokens?: number
    input_cached_tokens?: number
    output_tokens?: number
    images?: number
    num_model_requests?: number
    project_id?: string | null
    api_key_id?: string | null
    model?: string | null
    service_tier?: string | null
    size?: string | null
    source?: string | null
}

type OpenAiUsagePage = {
    data?: Array<{ results?: OpenAiUsageResult[] }>
    has_more?: boolean
    next_page?: string | null
}

type UsageEndpoint = {
    path: 'completions' | 'images'
    groupBy: string[]
}

const quantity = (value: number | undefined): string | undefined =>
    value !== undefined && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined

const definedQuantities = (entries: Array<[string, string | undefined]>): Record<string, string> =>
    Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== undefined))

// OpenAI's Costs endpoint supports project and line-item grouping, but not model
// grouping. This adapter deliberately retains that attribution boundary.
export class OpenAiActualsAdapter implements UsageActualsAdapter {
    readonly route = 'openai-api' as const

    constructor(
        readonly providerAccountRef: string,
        private readonly adminKey: string,
        private readonly projectIds: readonly string[],
        private readonly apiKeyIds: readonly string[] = [],
    ) {}

    async fetchDay(day: string) {
        const start = Date.parse(`${day}T00:00:00.000Z`)
        if (!Number.isFinite(start)) throw new Error(`Invalid reconciliation day ${day}`)
        const end = start + 24 * 60 * 60 * 1000
        const actuals = []
        let page: string | undefined
        do {
            const url = new URL('https://api.openai.com/v1/organization/costs')
            url.searchParams.set('start_time', String(Math.floor(start / 1000)))
            url.searchParams.set('end_time', String(Math.floor(end / 1000)))
            url.searchParams.set('bucket_width', '1d')
            url.searchParams.append('group_by', 'project_id')
            url.searchParams.append('group_by', 'line_item')
            url.searchParams.set('limit', '180')
            if (page) url.searchParams.set('page', page)
            for (const projectId of this.projectIds) url.searchParams.append('project_ids', projectId)
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${this.adminKey}`, 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(15_000),
            })
            if (!response.ok) throw new Error(`OpenAI Costs API returned HTTP ${response.status}`)
            const body = await response.json() as OpenAiCostsPage
            for (const bucket of body.data ?? []) {
                for (const result of bucket.results ?? []) {
                    const currency = result.amount?.currency?.toUpperCase()
                    const amount = result.amount?.value
                    if (currency !== 'USD' || (typeof amount !== 'string' && typeof amount !== 'number')) continue
                    if (this.projectIds.length > 0 && (!result.project_id || !this.projectIds.includes(result.project_id))) continue
                    const actualProviderCostUsd = typeof amount === 'number' ? amount.toFixed(6) : amount
                    const grouping = {
                        ...(result.project_id && { projectId: result.project_id }),
                        ...(result.line_item && { lineItem: result.line_item }),
                    }
                    actuals.push({
                        providerRoute: this.route,
                        providerAccountRef: this.providerAccountRef,
                        day,
                        grouping,
                        actualProviderCostUsd,
                        sourceId: 'openai:organization-costs',
                        sourceHash: canonicalHash({ day, grouping, actualProviderCostUsd }),
                        observedAt: new Date().toISOString(),
                    })
                }
            }
            page = body.has_more ? body.next_page ?? undefined : undefined
            if (body.has_more && !page) throw new Error('OpenAI Costs API returned has_more without next_page')
        } while (page)
        return actuals
    }

    async fetchUsageDay(day: string): Promise<ReconciliationActualUsage[]> {
        const endpoints: UsageEndpoint[] = [
            { path: 'completions', groupBy: ['project_id', 'api_key_id', 'model', 'service_tier'] },
            { path: 'images', groupBy: ['project_id', 'api_key_id', 'model', 'size', 'source'] },
        ]
        const actuals: ReconciliationActualUsage[] = []
        for (const endpoint of endpoints) {
            actuals.push(...await this.fetchUsageEndpoint(day, endpoint))
        }
        return actuals
    }

    private async fetchUsageEndpoint(day: string, endpoint: UsageEndpoint): Promise<ReconciliationActualUsage[]> {
        const start = Date.parse(`${day}T00:00:00.000Z`)
        if (!Number.isFinite(start)) throw new Error(`Invalid reconciliation day ${day}`)
        const end = start + 24 * 60 * 60 * 1000
        const actuals: ReconciliationActualUsage[] = []
        let page: string | undefined
        do {
            const url = new URL(`https://api.openai.com/v1/organization/usage/${endpoint.path}`)
            url.searchParams.set('start_time', String(Math.floor(start / 1000)))
            url.searchParams.set('end_time', String(Math.floor(end / 1000)))
            url.searchParams.set('bucket_width', '1d')
            url.searchParams.set('limit', '31')
            for (const grouping of endpoint.groupBy) url.searchParams.append('group_by', grouping)
            for (const projectId of this.projectIds) url.searchParams.append('project_ids', projectId)
            for (const apiKeyId of this.apiKeyIds) url.searchParams.append('api_key_ids', apiKeyId)
            if (page) url.searchParams.set('page', page)
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${this.adminKey}`, 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(15_000),
            })
            if (!response.ok) throw new Error(`OpenAI ${endpoint.path} Usage API returned HTTP ${response.status}`)
            const body = await response.json() as OpenAiUsagePage
            for (const bucket of body.data ?? []) {
                for (const result of bucket.results ?? []) {
                    if (!result.model) continue
                    if (this.projectIds.length > 0 && (!result.project_id || !this.projectIds.includes(result.project_id))) continue
                    if (this.apiKeyIds.length > 0 && (!result.api_key_id || !this.apiKeyIds.includes(result.api_key_id))) continue
                    const usage = endpoint.path === 'completions'
                        ? definedQuantities([
                            ['inputTokens', quantity(result.input_tokens)],
                            ['inputCachedTokens', quantity(result.input_cached_tokens)],
                            ['outputTokens', quantity(result.output_tokens)],
                            ['numModelRequests', quantity(result.num_model_requests)],
                        ])
                        : definedQuantities([
                            ['images', quantity(result.images)],
                            ['numModelRequests', quantity(result.num_model_requests)],
                        ])
                    if (Object.keys(usage).length === 0) continue
                    const grouping = {
                        model: result.model,
                        usageKind: endpoint.path,
                        ...(result.project_id && { projectId: result.project_id }),
                        ...(result.api_key_id && { apiKeyId: result.api_key_id }),
                        ...(result.service_tier && { serviceTier: result.service_tier }),
                        ...(result.size && { size: result.size }),
                        ...(result.source && { source: result.source }),
                    }
                    const sourceId = `openai:organization-usage:${endpoint.path}`
                    actuals.push({
                        providerRoute: this.route,
                        providerAccountRef: this.providerAccountRef,
                        day,
                        grouping,
                        usage,
                        sourceId,
                        sourceHash: canonicalHash({ day, grouping, usage, sourceId }),
                        observedAt: new Date().toISOString(),
                    })
                }
            }
            page = body.has_more ? body.next_page ?? undefined : undefined
            if (body.has_more && !page) throw new Error(`OpenAI ${endpoint.path} Usage API returned has_more without next_page`)
        } while (page)
        return actuals
    }
}
