'use strict'

import { NATS_SUBJECTS } from '@lixpi/constants'
import { warn } from '@lixpi/debug-tools'

import type { CheckRequest, CheckResponse, ConfirmRequest, ConfirmResponse } from './contracts.ts'

// CROSS-REPO WIRE CONTRACT — the metrics.* subjects and check/confirm shapes are
// shared with the hosted metering backend (a separate service, out of this repo).
// Do NOT change without explicit user allowance, and mirror any change on both
// sides (see ./contracts.ts). A one-sided change breaks the wire.
const METRICS_SUBJECTS = (NATS_SUBJECTS as any).METRICS_SUBJECTS as {
    USAGE_CHECK: string
    USAGE_CONFIRM: string
}

// MetricsNats is the minimal slice of the NATS service the client needs: a
// request/reply call. Depending on an interface (not the singleton) keeps the
// client unit-testable. The spend guard is synchronous now, so this is a request,
// not a fire-and-forget publish.
export type MetricsNats = {
    request<Req = any, Res = any>(subject: string, data: Req, timeoutMs: number): Promise<Res>
}

export type MetricsClientOptions = {
    // enabled=false is the open-source plug: check always approves and confirm is a
    // no-op, so Lixpi runs with no metering backend and makes no network call.
    enabled: boolean
    // Request timeout for the synchronous check/confirm calls.
    requestTimeoutMs: number
    // When a check errors or times out, deny (fail-closed, the default) or allow
    // (fail-open). Fail-closed protects the balance at the cost of blocking on an
    // unreachable metering backend.
    failClosed: boolean
}

// metricsConfigFromEnv reads the integration flags from the environment.
export function metricsConfigFromEnv(): MetricsClientOptions {
    return {
        enabled: process.env.METRICS_ENABLED === 'true',
        requestTimeoutMs: Number(process.env.METRICS_REQUEST_TIMEOUT_MS ?? 3000),
        // Fail-closed by default; METRICS_FAIL_OPEN=true trades overspend risk for availability.
        failClosed: process.env.METRICS_FAIL_OPEN !== 'true',
    }
}

// MetricsClient is the hosted binding of the abstract metering port: it issues the
// synchronous check/confirm request/reply to the hosted metering backend. When
// disabled it is the plug — check approves, confirm no-ops — so local/OSS runs are
// unaffected and never touch the network.
export class MetricsClient {
    constructor(
        private readonly nats: MetricsNats,
        private readonly opts: MetricsClientOptions,
    ) {}

    get enabled(): boolean {
        return this.opts.enabled
    }

    // check runs before a paid provider call. Disabled → approve (plug). On a
    // transport error the decision follows the fail-closed/open policy.
    async check(req: CheckRequest): Promise<CheckResponse> {
        if (!this.opts.enabled) return { approved: true }
        try {
            return await this.nats.request<CheckRequest, CheckResponse>(
                METRICS_SUBJECTS.USAGE_CHECK,
                req,
                this.opts.requestTimeoutMs,
            )
        } catch (error: any) {
            warn(`[metrics] check failed: ${error?.message ?? String(error)}`)
            return { approved: !this.opts.failClosed, reason: 'metrics_unreachable' }
        }
    }

    // confirm runs after a paid provider call, reporting the measured usage.
    // Disabled → no-op (plug). Best-effort when enabled: a failure is logged, not
    // thrown, so a metering hiccup never fails the user's completed request. The
    // caller may retry — confirm is idempotent on providerRequestId.
    async confirm(req: ConfirmRequest): Promise<ConfirmResponse | undefined> {
        if (!this.opts.enabled) return undefined
        try {
            return await this.nats.request<ConfirmRequest, ConfirmResponse>(
                METRICS_SUBJECTS.USAGE_CONFIRM,
                req,
                this.opts.requestTimeoutMs,
            )
        } catch (error: any) {
            warn(`[metrics] confirm failed (providerRequestId=${req.providerRequestId}): ${error?.message ?? String(error)}`)
            return undefined
        }
    }
}
