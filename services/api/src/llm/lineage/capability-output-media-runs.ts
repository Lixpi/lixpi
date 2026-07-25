'use strict'

import type { AiModelId } from '@lixpi/constants'

import { getAssetRecord } from '../../models/asset.ts'

export type PreassignedCapabilityMediaRun = {
    assetId: string
    reasoningModelId: AiModelId
    reasoningRunId: string
    reasoningIndex: number
    mediaModelId: AiModelId
    mediaType: 'image' | 'video'
    mediaIndex: number
    mediaRunId: string
}

export async function resolveCapabilityOutputMediaRuns(
    assetIds: readonly string[],
): Promise<PreassignedCapabilityMediaRun[]> {
    return await Promise.all(assetIds.map(async (assetId, index) => {
        const asset = await getAssetRecord(assetId)
        if (!asset) throw new Error(`Capability output Asset ${assetId} was not found`)
        const mediaType = asset.media?.kind
        if (mediaType !== 'image' && mediaType !== 'video') {
            throw new Error(`Capability output Asset ${assetId} is not generated media`)
        }
        const lineage = asset.lineage
        if (!lineage?.reasoningRunId || !lineage.reasoningModelId || !lineage.mediaRunId || !lineage.mediaModelId) {
            throw new Error(`Capability output Asset ${assetId} is missing generation lineage`)
        }
        return {
            assetId,
            reasoningModelId: lineage.reasoningModelId,
            reasoningRunId: lineage.reasoningRunId,
            reasoningIndex: index,
            mediaModelId: lineage.mediaModelId,
            mediaType,
            mediaIndex: index,
            mediaRunId: lineage.mediaRunId,
        }
    }))
}
