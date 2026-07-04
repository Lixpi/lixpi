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

// CheckResponse is the admission decision. operationId correlates this admission
// to the later confirm (opaque to Lixpi; the metering side's handle for the call).
export interface CheckResponse {
    approved: boolean
    operationId?: string
    estimatedCost?: number // micro-dollars, for display/telemetry
    balance?: number // micro-dollars
    reason?: string // e.g. insufficient_balance (when denied)
}

// UsageBreakdown carries the measured, cost-relevant dimensions of one provider
// call. Only the fields relevant to the modality are set; the implementation
// prices from these, so the split (prompt vs completion, image size/quality,
// video seconds-vs-tokens) is what makes accurate pricing possible.
export interface UsageBreakdown {
    // Text tokens — kept split because input and output are priced differently.
    // Invariants the backend relies on (normalize per-provider before sending):
    //   promptTokens INCLUDES cachedTokens (cached ⊆ prompt);
    //   completionTokens INCLUDES reasoningTokens (reasoning ⊆ completion).
    // cachedTokens/reasoningTokens are the priced-differently / informational subsets.
    promptTokens?: number
    completionTokens?: number
    cachedTokens?: number
    reasoningTokens?: number
    // Image — count plus the size/quality that drive the per-image rate.
    imageCount?: number
    imageSize?: string
    imageQuality?: string
    // Video — per-second metered (VEO) uses durationSeconds (+ resolution tier);
    // token-metered (Seedance) uses videoTokens.
    durationSeconds?: number
    resolution?: string
    videoTokens?: number
}

// ConfirmRequest reports one provider call's measured usage after it returns.
// It carries dimensioned unit counts only — the implementation prices them.
// measuringUnit is the primary unit for the modality (and disambiguates video:
// seconds vs tokens). Idempotent on providerRequestId.
export interface ConfirmRequest {
    providerRequestId: string
    operationId?: string // from the matching check; empty/unknown → the backend charges by actuals
    orgId: string
    userId: string
    workspaceId?: string
    workflowId: string
    workflowSeq: number
    model: string
    modality: Modality
    measuringUnit: MeasuringUnit
    usage: UsageBreakdown
    currency: string // 'USD' at launch
    occurredAt: string // ISO 8601
}

// ConfirmResponse is the posted charge and resulting balance.
export interface ConfirmResponse {
    transferId?: string
    resaleCost?: number // micro-dollars, amount charged to the org
    balance?: number // micro-dollars, new balance after the debit
}
