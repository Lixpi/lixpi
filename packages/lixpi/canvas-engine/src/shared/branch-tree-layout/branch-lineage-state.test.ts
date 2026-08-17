'use strict'

import { describe, expect, it } from 'vitest'
import type { BranchLineCanvasNode, CanvasNode, ImageCanvasNode, WorkspaceEdge } from '@lixpi/constants'

import { hasActiveGeneratedOutputLineage } from './branch-lineage-state.ts'

const marker: BranchLineCanvasNode = {
    nodeId: 'line-1',
    type: 'branchLine',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    parentBranchNodeId: 'source-1',
    reasoningRunId: 'reasoning-1',
    reasoningModelId: 'OpenAI:gpt-5-mini',
    reasoningIndex: 0,
    position: { x: 100, y: 0 },
    dimensions: { width: 100, height: 40 },
}

const generatedMedia: ImageCanvasNode = {
    nodeId: 'output-1',
    type: 'image',
    assetId: 'asset-1',
    position: { x: 240, y: 0 },
    dimensions: { width: 200, height: 200 },
    generatedBy: {
        conversationAssetId: 'thread-1',
        responseId: 'response-1',
        aiModel: 'OpenAI:gpt-5-mini',
        revisedPrompt: 'portrait',
        branchId: 'branch-1',
        branchLineNodeId: marker.nodeId,
        lineageParentNodeId: marker.nodeId,
    },
}

const edge: WorkspaceEdge = {
    edgeId: 'edge-line-output',
    sourceNodeId: marker.nodeId,
    targetNodeId: generatedMedia.nodeId,
}

describe('hasActiveGeneratedOutputLineage', () => {
    it('requires the declared live marker and its connector', () => {
        expect(hasActiveGeneratedOutputLineage(
            generatedMedia,
            [marker, generatedMedia],
            [edge],
        )).toBe(true)
        expect(hasActiveGeneratedOutputLineage(
            generatedMedia,
            [marker, generatedMedia],
            [],
        )).toBe(false)
    })

    it('does not treat retained generation provenance as active after acceptance', () => {
        const acceptedMedia = {
            ...generatedMedia,
            generatedBy: {
                ...generatedMedia.generatedBy,
                branchId: undefined,
                branchLineNodeId: undefined,
                lineageParentNodeId: undefined,
            },
        } satisfies CanvasNode

        expect(hasActiveGeneratedOutputLineage(
            acceptedMedia,
            [acceptedMedia],
            [],
        )).toBe(false)
    })
})
