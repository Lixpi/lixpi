'use strict'

// Billing contract types shared with the lixpi-billing service.
// Money fields are integer micro-dollars (see ./money.ts).

// WorkflowStarted is the fire-and-forget run-start signal. It is NOT a gate —
// the spend gate is the async allowance flag projected from BalanceChanged.
// Billing records it so a run with zero usage events can be leak-detected.
export interface WorkflowStarted {
    workflowId: string
    orgId: string
    userId: string
    workflowKind: string
}

// Allowance maps each workflow kind to whether the org's balance can cover it
// (balance >= maxCost[kind], computed by billing). The gate reads allowed[kind].
export type Allowance = Record<string, boolean>

// BalanceChanged is emitted by billing on every balance change. It carries the
// recomputed allowance the gate runs on, plus the balance for display.
export interface BalanceChanged {
    orgId: string
    balance: number // micro-dollars
    currency: string
    allowed: Allowance
    reason: string // top_up | ai_charge | adjustment | workflow_started
    transferId: string
    at: string // ISO 8601
}

export type Modality = 'tokens' | 'image' | 'video'
export type MeasuringUnit = 'tokens' | 'images' | 'seconds'

export interface UsageEvent {
    providerRequestId: string
    orgId: string
    userId: string
    workspaceId?: string
    workflowId: string
    workflowSeq: number
    model: string
    modality: Modality
    measuringUnit: MeasuringUnit
    quantity: number
    unitPrice: number // micro-dollars
    purchaseCost: number // micro-dollars
    resaleCost: number // micro-dollars
    currency: string // 'USD' at launch
    occurredAt: string // ISO 8601
}
