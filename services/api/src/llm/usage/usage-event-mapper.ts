'use strict'

import type { ConfirmRequest } from '@lixpi/constants'
import type {
    UsageReport,
    ImageUsageReport,
    VideoUsageReport,
} from './usage-reporter.ts'

// Maps the usage reporter's per-call reports to metrics ConfirmRequests. One
// confirm per provider call, carrying the measured unit count only — the metering
// backend owns pricing, so no cost crosses the wire (see
// packages/lixpi/constants/ts/metrics-contracts.ts).

type ReportHead = {
    eventMeta: { organizationId?: string; userId?: string; workspaceId?: string; [k: string]: unknown }
    aiVendorRequestId: string
    modelVersion: string // canonical vendor id — must match what check sent, and the LiteLLM dataset key
    aiRequestFinishedAt: number
}

const common = (report: ReportHead, workflowId: string, workflowSeq: number) => ({
    providerRequestId: report.aiVendorRequestId,
    orgId: report.eventMeta?.organizationId ?? '',
    userId: report.eventMeta?.userId ?? '',
    workspaceId: report.eventMeta?.workspaceId,
    workflowId,
    workflowSeq,
    model: report.modelVersion,
    currency: 'USD',
    occurredAt: new Date(report.aiRequestFinishedAt || Date.now()).toISOString(),
})

export function tokenUsageConfirm(report: UsageReport, workflowId: string, workflowSeq: number): ConfirmRequest {
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'tokens',
        measuringUnit: 'tokens',
        usage: {
            promptTokens: report.prompt.usageTokens,
            completionTokens: report.completion.usageTokens,
            cachedTokens: report.prompt.cachedTokens,
            reasoningTokens: report.completion.reasoningTokens,
        },
    }
}

export function imageUsageConfirm(report: ImageUsageReport, workflowId: string, workflowSeq: number): ConfirmRequest {
    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'image',
        measuringUnit: 'images',
        usage: {
            imageCount: report.image.count,
            imageSize: report.image.size,
            imageQuality: report.image.quality,
        },
    }
}

export function videoUsageConfirm(report: VideoUsageReport, workflowId: string, workflowSeq: number): ConfirmRequest {
    const v = report.video

    // Seconds of source video fed in. Omitted for text-to-video, which is what
    // absent means on the wire. The backend prices a run with video input at a
    // different rate from one without, so this selects the tariff.
    const inputVideo = typeof v.inputVideoSeconds === 'number' && v.inputVideoSeconds > 0
        ? { inputVideoSeconds: v.inputVideoSeconds }
        : {}

    // Token-metered (Seedance) vs per-second (VEO). Modality stays 'video' either way;
    // only the measuring unit + dimensions differ.
    if (v.measuringUnit === 'tokens') {
        return {
            ...common(report, workflowId, workflowSeq),
            modality: 'video',
            measuringUnit: 'tokens',
            usage: { videoTokens: v.totalTokens ?? 0, ...inputVideo },
        }
    }

    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'video',
        measuringUnit: 'seconds',
        usage: { durationSeconds: v.durationSeconds, resolution: v.resolution, ...inputVideo },
    }
}
