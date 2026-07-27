'use strict'

import { createHash } from 'node:crypto'

import type {
    CapabilityReasoningModelVariant,
    MediaRunLineageAssignment,
} from '@lixpi/constants'

export function buildActionTimelineLineageAssignment(args: {
    assetId: string
    generationRequestId: string
    reasoningRunId: string
    variant: CapabilityReasoningModelVariant
    prompt: string
    referenceAssetIds: string[]
    createdAt: number
}): MediaRunLineageAssignment {
    const branchId = `branch-${args.generationRequestId}`
    const branchForkNodeId = `branch-fork-${args.generationRequestId}-reasoning-${args.variant.reasoningIndex}`
    return {
        assetId: args.assetId,
        generationRequestId: args.generationRequestId,
        reasoningRunId: args.reasoningRunId,
        reasoningModelId: args.variant.reasoningModelId,
        reasoningIndex: args.variant.reasoningIndex,
        mediaIndex: args.variant.reasoningIndex,
        branchId,
        branchForkNodeId,
        lineageParentNodeId: branchForkNodeId,
        referenceAssetIds: args.referenceAssetIds,
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        promptText: args.prompt,
        promptFingerprint: createHash('sha256').update(args.prompt).digest('hex'),
        createdAt: args.createdAt,
    }
}
