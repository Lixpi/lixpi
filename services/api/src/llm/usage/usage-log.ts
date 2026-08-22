'use strict'

import type { CheckResponse, ConfirmRequest, ConfirmResponse } from '@lixpi/constants'
import { info, warn } from '@lixpi/debug-tools'

import type { CheckMeteringBasis } from './usage-estimator.ts'

// One readable shape for the two halves of metering, so a run's spend reads off
// `docker logs lixpi-api` in one place. Both lines share the `[Metrics]` tag, lead
// with pricing key and modality, and put the usage dimensions next to their unit
// in.
//
//   [Metrics] usage check {"pricingKey":"...","modality":"tokens",...}
//   [Metrics] usage confirm {"pricingKey":"...","modality":"tokens",...}
//
// Follows the repo's structured-log convention: a tagged prefix, a short phrase,
// then one flat JSON object (see BaseProvider and ImageRouter).

// Micro-dollars are what the metering backend speaks; logs show plain USD.
const MICRO_DOLLARS_PER_USD = 1_000_000

export function logUsageCheck(entry: {
    pricingKey: string
    workflowId: string
    estimatedUsage: Record<string, unknown>
    basis: CheckMeteringBasis
    response: CheckResponse
    modality: string
}): void {
    const { basis, response } = entry
    const line = `[Metrics] usage check ${JSON.stringify({
        pricingKey: entry.pricingKey,
        modality: entry.modality,
        estimatedUsage: entry.estimatedUsage,
        unit: basis.measuringUnit,
        ...basisDetail(basis),
        approved: response.approved,
        ...(response.reason ? { reason: response.reason } : {}),
        estimatedCostUsd: usd(response.estimatedCost),
        balanceUsd: usd(response.balance),
        workflowId: entry.workflowId,
        ...(response.operationId ? { operationId: response.operationId } : {}),
    }, null, 0)}`

    // A denied run and a placeholder-derived charge estimate both need to stand
    // out. A provisional frame size means the number is arithmetic over guessed
    // dimensions, so it must never be read as a real cost.
    if (!response.approved || basis.provisionalVideoFrame) {
        warn(line)
        return
    }
    info(line)
}

export function logUsageConfirm(entry: {
    request: ConfirmRequest
    response: ConfirmResponse | undefined
}): void {
    const { request, response } = entry
    info(`[Metrics] usage confirm ${JSON.stringify({
        pricingKey: request.pricingLookup.pricingKey,
        modality: request.modality,
        unit: request.measuringUnit,
        ...request.usage,
        chargedUsd: usd(response?.resaleCost),
        balanceUsd: usd(response?.balance),
        workflowId: request.workflowId,
        workflowSeq: request.workflowSeq,
        providerRequestId: request.providerRequestId,
        ...(request.operationId ? { operationId: request.operationId } : {}),
    }, null, 0)}`)
}

// Spreads only the fields the modality actually set, so a tokens line carries no
// empty video keys and vice versa.
function basisDetail(basis: CheckMeteringBasis): Record<string, unknown> {
    const { measuringUnit: _measuringUnit, ...detail } = basis
    return Object.fromEntries(
        Object.entries(detail).filter(([, value]) => value !== undefined),
    )
}

function usd(microDollars: number | undefined): number | undefined {
    return typeof microDollars === 'number'
        ? microDollars / MICRO_DOLLARS_PER_USD
        : undefined
}
