'use strict'

// Metrics contract types for the abstract usage-metering port. Lixpi calls this
// port (check before a paid provider call, confirm after) and never names billing;
// the hosted implementation is lixpi-billing, reached over the metrics.usage.*
// subjects. In the open-source build the port is a no-op plug.
//
// Lixpi sends unit counts, never money — the hosted implementation owns pricing.

export type Modality = 'tokens' | 'image' | 'video'
export type MeasuringUnit = 'tokens' | 'images' | 'seconds'

// CheckRequest asks whether the org's balance covers an upcoming paid provider
// call. The implementation prices estimatedUnits as an upper bound.
export interface CheckRequest {
    orgId: string
    userId: string
    workspaceId?: string
    workflowId: string
    model: string
    modality: Modality
    estimatedUnits: number // upper-bound unit count for the estimate
    currency: string // 'USD' at launch
}

// CheckResponse is the admission decision.
export interface CheckResponse {
    approved: boolean
    estimatedCost?: number // micro-dollars, for display/telemetry
    balance?: number // micro-dollars
    reason?: string // e.g. insufficient_balance (when denied)
}

// ConfirmRequest reports one provider call's measured usage after it returns.
// It carries unit counts only — the implementation prices them. Idempotent on
// providerRequestId.
export interface ConfirmRequest {
    providerRequestId: string
    orgId: string
    userId: string
    workspaceId?: string
    workflowId: string
    workflowSeq: number
    model: string
    modality: Modality
    measuringUnit: MeasuringUnit
    quantity: number // measured units from the provider response
    currency: string // 'USD' at launch
    occurredAt: string // ISO 8601
}

// ConfirmResponse is the posted charge and resulting balance.
export interface ConfirmResponse {
    transferId?: string
    resaleCost?: number // micro-dollars, amount charged to the org
    balance?: number // micro-dollars, new balance after the debit
}
