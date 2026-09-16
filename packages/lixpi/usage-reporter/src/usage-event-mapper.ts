import {
    type ProviderUsageRecordRequest,
} from './provider-usage-contract.ts'
import {
    type TextProviderUsage,
    type ImageProviderUsage,
    type VideoProviderUsage,
} from './usage-reporter.ts'

// One dimensioned usage record per provider call.
type ProviderCallIdentity = {
    eventMeta: {
        organizationId?: string
        userId?: string
        workspaceId?: string
        [k: string]: unknown
    }
    aiVendorRequestId: string
    modelVersion: string // canonical vendor id: must match what the authorization sent, and the LiteLLM dataset key
    aiRequestFinishedAt: number
}

const sharedRecordFields = (
    call: ProviderCallIdentity,
    workflowId: string,
    workflowSeq: number,
) => ({
    providerRequestId: call.aiVendorRequestId,
    orgId: call.eventMeta?.organizationId ?? '',
    userId: call.eventMeta?.userId ?? '',
    workspaceId: call.eventMeta?.workspaceId,
    workflowId,
    workflowSeq,
    model: call.modelVersion,
    occurredAt: new Date(call.aiRequestFinishedAt || Date.now()).toISOString(),
})

export const usageRecordForTextCall = (
    call: TextProviderUsage,
    workflowId: string,
    workflowSeq: number,
): ProviderUsageRecordRequest => {
    return {
        ...sharedRecordFields(
            call,
            workflowId,
            workflowSeq,
        ),
        modality: 'tokens',
        measuringUnit: 'tokens',
        usage: {
            promptTokens: call.prompt.usageTokens,
            completionTokens: call.completion.usageTokens,
            cachedTokens: call.prompt.cachedTokens,
            reasoningTokens: call.completion.reasoningTokens,
        },
    }
}

export const usageRecordForImageCall = (
    call: ImageProviderUsage,
    workflowId: string,
    workflowSeq: number,
): ProviderUsageRecordRequest => {
    return {
        ...sharedRecordFields(
            call,
            workflowId,
            workflowSeq,
        ),
        modality: 'image',
        measuringUnit: 'images',
        usage: {
            imageCount: call.image.count,
            imageSize: call.image.size,
            imageQuality: call.image.quality,
        },
    }
}

export const usageRecordForVideoCall = (
    call: VideoProviderUsage,
    workflowId: string,
    workflowSeq: number,
): ProviderUsageRecordRequest => {
    const video = call.video

    // Preserve the source-video dimension when present.
    const inputVideoFields = typeof video.inputVideoSeconds === 'number'
        && video.inputVideoSeconds > 0
        ? { inputVideoSeconds: video.inputVideoSeconds }
        : {}

    // Token-metered (Seedance) or per-second (VEO). The modality stays 'video' either
    // way; only the unit and the dimensions differ.
    if (video.measuringUnit === 'tokens') {
        return {
            ...sharedRecordFields(
                call,
                workflowId,
                workflowSeq,
            ),
            modality: 'video',
            measuringUnit: 'tokens',
            usage: {
                videoTokens: video.totalTokens ?? 0,
                resolution: video.resolution,
                ...inputVideoFields,
            },
        }
    }

    return {
        ...sharedRecordFields(
            call,
            workflowId,
            workflowSeq,
        ),
        modality: 'video',
        measuringUnit: 'seconds',
        usage: {
            durationSeconds: video.durationSeconds,
            resolution: video.resolution,
            ...inputVideoFields,
        },
    }
}
