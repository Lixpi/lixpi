'use strict'

import { toMicroDollars } from '../../billing/money.ts'
import type { UsageEvent } from '../../billing/contracts.ts'
import type { UsageReport, ImageUsageReport, VideoUsageReport } from './usage-reporter.ts'

// Maps the usage reporter's decimal-dollar reports to billing UsageEvents with
// integer micro-dollar amounts (the wire encoding billing expects). One event per
// provider call; the resaleCost is the authoritative debit on the billing side.

// perUnit derives an integer micro-dollar unit price from a total resale cost and
// quantity. For token calls (prompt + completion priced differently) this is a
// blended figure — informational only; billing debits resaleCost, not this.
const perUnit = (resaleMicro: number, quantity: number): number =>
    quantity > 0 ? Math.round(resaleMicro / quantity) : 0

type ReportHead = {
    eventMeta: { organizationId?: string; userId?: string; workspaceId?: string; [k: string]: unknown }
    aiVendorRequestId: string
    aiModel: string
    aiRequestFinishedAt: number
}

const common = (report: ReportHead, workflowId: string, workflowSeq: number) => ({
    providerRequestId: report.aiVendorRequestId,
    orgId: report.eventMeta?.organizationId ?? '',
    userId: report.eventMeta?.userId ?? '',
    workspaceId: report.eventMeta?.workspaceId,
    workflowId,
    workflowSeq,
    model: report.aiModel,
    currency: 'USD',
    occurredAt: new Date(report.aiRequestFinishedAt || Date.now()).toISOString(),
})

export function tokenUsageEvent(report: UsageReport, workflowId: string, workflowSeq: number): UsageEvent {
    const quantity = report.total.usageTokens
    const purchaseCost = toMicroDollars(report.total.purchasedFor)
    const resaleCost = toMicroDollars(report.total.soldToClientFor)
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'tokens',
        measuringUnit: 'tokens',
        quantity,
        unitPrice: perUnit(resaleCost, quantity),
        purchaseCost,
        resaleCost,
    }
}

export function imageUsageEvent(report: ImageUsageReport, workflowId: string, workflowSeq: number): UsageEvent {
    const quantity = report.image.count
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'image',
        measuringUnit: 'images',
        quantity,
        unitPrice: toMicroDollars(report.image.pricePerImageResale),
        purchaseCost: toMicroDollars(report.image.purchasedFor),
        resaleCost: toMicroDollars(report.image.soldToClientFor),
    }
}

export function videoUsageEvent(report: VideoUsageReport, workflowId: string, workflowSeq: number): UsageEvent {
    const v = report.video
    const purchaseCost = toMicroDollars(v.purchasedFor)
    const resaleCost = toMicroDollars(v.soldToClientFor)

    // Token-metered (Seedance) vs per-second (VEO). Modality stays 'video' either way;
    // only the measuring unit + quantity differ. Billing accepts video+tokens.
    if (v.measuringUnit === 'tokens') {
        const quantity = v.totalTokens ?? 0
        return {
            ...common(report, workflowId, workflowSeq),
            modality: 'video',
            measuringUnit: 'tokens',
            quantity,
            unitPrice: perUnit(resaleCost, quantity),
            purchaseCost,
            resaleCost,
        }
    }

    const quantity = v.durationSeconds
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'video',
        measuringUnit: 'seconds',
        quantity,
        unitPrice: toMicroDollars(v.pricePerSecondResale ?? '0'),
        purchaseCost,
        resaleCost,
    }
}
