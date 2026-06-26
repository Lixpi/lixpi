'use strict'

import { info, warn } from '@lixpi/debug-tools'

import type { MetricsClient } from './metrics-client.ts'
import type { BalanceChanged } from './contracts.ts'

// Dependencies the projection needs, injected so the core logic stays testable
// without DynamoDB or NATS.
export interface AllowanceProjectionDeps {
    getOrganizationMembers: (orgId: string) => Promise<string[]>
    setUserAllowance: (args: { userId: string; allowed: Record<string, boolean>; balance: number }) => Promise<void>
}

// projectBalanceChange fans a single balance.changed event out to the org's
// members' user records, where the pre-flight gate later reads it as a field.
// Metrics is per-org; the gate reads the user record, so the org's allowance is
// denormalized onto each member (a single owner at launch).
export async function projectBalanceChange(ev: BalanceChanged, deps: AllowanceProjectionDeps): Promise<void> {
    if (!ev?.orgId) return
    const members = await deps.getOrganizationMembers(ev.orgId)
    await Promise.all(
        members.map((userId) =>
            deps.setUserAllowance({ userId, allowed: ev.allowed ?? {}, balance: ev.balance ?? 0 }),
        ),
    )
}

// startAllowanceProjection subscribes to metrics.balance.changed and keeps the
// user-record allowance up to date. A projection failure is logged, never thrown —
// a stale flag must not take down the subscriber.
export function startAllowanceProjection(metrics: MetricsClient, deps: AllowanceProjectionDeps): void {
    if (!metrics.enabled) return
    metrics.subscribeBalanceChanged(async (ev: BalanceChanged) => {
        try {
            await projectBalanceChange(ev, deps)
        } catch (error: any) {
            warn(`[metrics] allowance projection failed: ${error?.message ?? String(error)}`)
        }
    })
    info('[metrics] allowance projection subscribed to metrics.balance.changed')
}
