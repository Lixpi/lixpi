import { NATS_SUBJECTS } from '@lixpi/constants'
import { warn } from '@lixpi/debug-tools'

import {
    type ProviderRequestAuthorizationRequest,
    type ProviderRequestAuthorizationResult,
    type ProviderUsageRecordRequest,
    type ProviderUsageRecordResult,
} from './provider-usage-contract.ts'

// Both subjects and JSON shapes must change with the paired responder repository.
const PROVIDER_USAGE_SUBJECTS = NATS_SUBJECTS.METRICS_SUBJECTS

export type ProviderUsageTransport = {
    request<Req = unknown, Res = unknown>(
        subject: string,
        data: Req,
        timeoutMs: number,
    ): Promise<Res>
}

export type ProviderUsageOptions = {
    enabled: boolean
    requestTimeoutMs: number
    denyRequestWhenAuthorizationUnavailable: boolean
}

export const providerUsageOptionsFromEnv = (): ProviderUsageOptions => ({
    enabled: process.env.METRICS_ENABLED === 'true',
    requestTimeoutMs: Number(process.env.METRICS_REQUEST_TIMEOUT_MS ?? 3000),
    denyRequestWhenAuthorizationUnavailable: process.env.METRICS_FAIL_OPEN !== 'true',
})

const authorizationResult = (value: unknown): ProviderRequestAuthorizationResult => {
    if (
        !value
        || typeof value !== 'object'
    )
        throw new Error('Invalid authorization result')

    const result = value as Record<string, unknown>

    if (typeof result.authorized !== 'boolean')
        throw new Error('Invalid authorization decision')

    return {
        authorized: result.authorized,
        ...(typeof result.authorizationId === 'string' ? { authorizationId: result.authorizationId } : {}),
        ...(!result.authorized ? { reason: 'request_denied' as const } : {}),
    }
}

export class ProviderUsageClient {
    constructor(
        private readonly transport: ProviderUsageTransport,
        private readonly options: ProviderUsageOptions,
    ) {}

    get enabled(): boolean {
        return this.options.enabled
    }

    async authorizeRequest(request: ProviderRequestAuthorizationRequest): Promise<ProviderRequestAuthorizationResult> {
        if (!this.options.enabled)
            return { authorized: true }

        try {
            const result = await this.transport.request<ProviderRequestAuthorizationRequest, unknown>(
                PROVIDER_USAGE_SUBJECTS.PROVIDER_REQUEST_AUTHORIZE,
                request,
                this.options.requestTimeoutMs,
            )

            return authorizationResult(result)
        } catch {
            warn('[ProviderUsage] request authorization unavailable')

            return {
                authorized: !this.options.denyRequestWhenAuthorizationUnavailable,
                reason: 'authorization_unavailable',
            }
        }
    }

    // A recording failure does not discard a provider response already delivered.
    // Retrying the same providerRequestId is safe.
    async recordUsage(request: ProviderUsageRecordRequest): Promise<ProviderUsageRecordResult | undefined> {
        if (!this.options.enabled)
            return undefined

        try {
            const result = await this.transport.request<ProviderUsageRecordRequest, ProviderUsageRecordResult>(
                PROVIDER_USAGE_SUBJECTS.PROVIDER_USAGE_RECORD,
                request,
                this.options.requestTimeoutMs,
            )

            if (result?.recorded !== true)
                throw new Error('Usage was not acknowledged')

            return { recorded: true }
        } catch {
            warn(`[ProviderUsage] usage recording unavailable (providerRequestId=${request.providerRequestId})`)

            return undefined
        }
    }
}
