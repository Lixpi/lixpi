'use strict'

import type { ConfirmRequest } from '@lixpi/constants'

import type { ImageUsageReport, UsageReport, VideoUsageReport } from './usage-reporter.ts'

type ReportHead = {
    eventMeta: { organizationId?: string; userId?: string; workspaceId?: string; [key: string]: unknown }
    aiVendorRequestId: string
    pricingLookup: ConfirmRequest['pricingLookup']
    aiRequestFinishedAt: number
}

const common = (report: ReportHead, workflowId: string, workflowSeq: number) => ({
    providerRequestId: report.aiVendorRequestId,
    orgId: report.eventMeta.organizationId ?? '',
    userId: report.eventMeta.userId ?? '',
    workspaceId: report.eventMeta.workspaceId,
    workflowId,
    workflowSeq,
    pricingLookup: report.pricingLookup,
    currency: 'USD',
    occurredAt: new Date(report.aiRequestFinishedAt || Date.now()).toISOString(),
})

export const tokenUsageConfirm = (report: UsageReport, workflowId: string, workflowSeq: number): ConfirmRequest => ({
    ...common(report, workflowId, workflowSeq),
    modality: 'tokens',
    measuringUnit: 'tokens',
    usage: {
        promptTokens: report.prompt.usageTokens,
        completionTokens: report.completion.usageTokens,
        cachedTokens: report.prompt.cachedTokens,
        reasoningTokens: report.completion.reasoningTokens,
    },
})

export const imageUsageConfirm = (report: ImageUsageReport, workflowId: string, workflowSeq: number): ConfirmRequest => ({
    ...common(report, workflowId, workflowSeq),
    modality: 'image',
    measuringUnit: 'images',
    usage: {
        imageCount: report.image.count,
        imageSize: report.image.size,
        imageQuality: report.image.quality,
    },
})

export const videoUsageConfirm = (report: VideoUsageReport, workflowId: string, workflowSeq: number): ConfirmRequest => {
    const inputVideo = typeof report.video.inputVideoSeconds === 'number' && report.video.inputVideoSeconds > 0
        ? { inputVideoSeconds: report.video.inputVideoSeconds }
        : {}

    if (report.video.measuringUnit === 'tokens') {
        return {
            ...common(report, workflowId, workflowSeq),
            modality: 'video',
            measuringUnit: 'tokens',
            usage: { videoTokens: report.video.totalTokens ?? 0, ...inputVideo },
        }
    }

    return {
        ...common(report, workflowId, workflowSeq),
        modality: 'video',
        measuringUnit: 'seconds',
        usage: { durationSeconds: report.video.durationSeconds, resolution: report.video.resolution, ...inputVideo },
    }
}
