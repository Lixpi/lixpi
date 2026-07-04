'use strict'

import type { ConfirmRequest } from '../../metrics/contracts.ts'
import type { UsageReport, ImageUsageReport, VideoUsageReport } from './usage-reporter.ts'

// Maps the usage reporter's per-call reports to metrics ConfirmRequests. One
// confirm per provider call, carrying the measured unit count only — the metering
// backend owns pricing, so no cost crosses the wire (see metrics/contracts.ts).

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

export function tokenUsageConfirm(report: UsageReport, workflowId: string, workflowSeq: number): ConfirmRequest {
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'tokens',
        measuringUnit: 'tokens',
        quantity: report.total.usageTokens,
    }
}

export function imageUsageConfirm(report: ImageUsageReport, workflowId: string, workflowSeq: number): ConfirmRequest {
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'image',
        measuringUnit: 'images',
        quantity: report.image.count,
    }
}

export function videoUsageConfirm(report: VideoUsageReport, workflowId: string, workflowSeq: number): ConfirmRequest {
    const v = report.video

    // Token-metered (Seedance) vs per-second (VEO). Modality stays 'video' either way;
    // only the measuring unit + quantity differ.
    if (v.measuringUnit === 'tokens') {
        return {
            ...common(report, workflowId, workflowSeq),
            modality: 'video',
            measuringUnit: 'tokens',
            quantity: v.totalTokens ?? 0,
        }
    }

    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'video',
        measuringUnit: 'seconds',
        quantity: v.durationSeconds,
    }
}
