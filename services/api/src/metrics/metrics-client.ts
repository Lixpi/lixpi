'use strict'

import { NATS_SUBJECTS } from '@lixpi/constants'
import { warn } from '@lixpi/debug-tools'

import type { WorkflowStarted, BalanceChanged, UsageEvent, Allowance } from './contracts.ts'

const METRICS_SUBJECTS = (NATS_SUBJECTS as any).METRICS_SUBJECTS as {
    WORKFLOW_STARTED: string
    USAGE: string
    BALANCE_GET: string
    BALANCE_CHANGED: string
}

// MetricsNats is the minimal slice of the NATS service the client needs.
// Depending on an interface (not the singleton) keeps the client unit-testable.
// The spend gate is async, so there is no request/reply here — only fire-and-forget
// publishes and a subscription that feeds the allowance projection.
export interface MetricsNats {
    publish<T = any>(subject: string, data: T): void
    subscribe<T = any>(subject: string, handler: (data: T) => void | Promise<void>): unknown
}

export interface MetricsClientOptions {
    enabled: boolean
    // What the gate does when no allowance has been projected yet (cold start —
    // metrics only learns of an org at its first top-up). Local dev sets this true
    // so the happy-path mock isn't blocked; production sets it false (deny until
    // the first top-up emits an allowance).
    gateDefaultAllow: boolean
}

// metricsConfigFromEnv reads the integration flags from the environment.
export function metricsConfigFromEnv(): MetricsClientOptions {
    return {
        enabled: process.env.METRICS_ENABLED === 'true',
        gateDefaultAllow: process.env.METRICS_GATE_DEFAULT_ALLOW === 'true',
    }
}

// MetricsClient talks to lixpi-metrics over NATS without ever sitting on the
// workflow's latency path. It publishes the run-start signal and usage events,
// and subscribes to balance changes so the caller can project the allowance the
// gate reads. When disabled it is inert, so local dev is unaffected.
export class MetricsClient {
    constructor(
        private readonly nats: MetricsNats,
        private readonly opts: MetricsClientOptions,
    ) {}

    get enabled(): boolean {
        return this.opts.enabled
    }

    // gateAllows is the local gate decision: read the projected allowance for the
    // run's kind. When no allowance has been projected yet, fall back to the
    // configured cold-start default. This never calls metrics.
    gateAllows(allowance: Allowance | undefined, workflowKind: string): boolean {
        if (allowance && workflowKind in allowance) {
            return allowance[workflowKind] === true
        }
        return this.opts.gateDefaultAllow
    }

    // Fire-and-forget run-start signal. Never awaited, never blocks the workflow;
    // a failure only weakens that one run's leak check.
    publishWorkflowStarted(ws: WorkflowStarted): void {
        if (!this.opts.enabled) return
        try {
            this.nats.publish(METRICS_SUBJECTS.WORKFLOW_STARTED, ws)
        } catch (error: any) {
            warn(`[metrics] workflow.started publish failed: ${error?.message ?? String(error)}`)
        }
    }

    publishUsage(ev: UsageEvent): void {
        if (!this.opts.enabled) return
        try {
            this.nats.publish(METRICS_SUBJECTS.USAGE, ev)
        } catch (error: any) {
            // Fire-and-forget: never block the user's response on usage publishing.
            warn(`[metrics] usage publish failed: ${error?.message ?? String(error)}`)
        }
    }

    // Subscribe to balance changes. The handler projects the allowance onto the
    // user record the gate later reads. Returns the underlying subscription (or
    // undefined when disabled) so the caller can manage its lifecycle.
    subscribeBalanceChanged(handler: (ev: BalanceChanged) => void | Promise<void>): unknown {
        if (!this.opts.enabled) return undefined
        return this.nats.subscribe<BalanceChanged>(METRICS_SUBJECTS.BALANCE_CHANGED, handler)
    }
}
