import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    type Asset,
    type BranchOriginCanvasNode,
    type CanvasNode,
    type ImageCanvasNode,
    type WorkspaceEdge,
} from '@lixpi/constants'

import {
    isGeneratedOutputAcceptedForCanvas,
    isGeneratedOutputReadyForReview,
    isGeneratedOutputRejectableForCanvas,
} from './generated-output-review-state.ts'

const marker: BranchOriginCanvasNode = {
    nodeId: 'branch-origin-1',
    type: 'branchOrigin',
    branchId: 'branch-1',
    generationRequestId: 'request-1',
    conversationAssetId: 'conversation-1',
    position: { x: 0, y: 0 },
    dimensions: { width: 375, height: 98 },
    temporary: true,
}

const output: ImageCanvasNode = {
    nodeId: 'output-1',
    type: 'image',
    assetId: 'asset-1',
    mediaGenerationPhase: 'ready',
    position: { x: 500, y: 0 },
    dimensions: { width: 600, height: 400 },
    generatedBy: {
        conversationAssetId: 'conversation-1',
        responseId: '',
        aiModel: 'OpenAI:gpt-image-2',
        revisedPrompt: 'persisted request',
        branchId: marker.branchId,
        branchOriginNodeId: marker.nodeId,
        lineageParentNodeId: marker.nodeId,
        generationRequestId: marker.generationRequestId,
    },
}

const edge: WorkspaceEdge = {
    edgeId: 'edge-branch-output',
    sourceNodeId: marker.nodeId,
    targetNodeId: output.nodeId,
}

function makeAsset(reviewStatus: 'candidate' | 'accepted' | 'superseded'): Asset {
    return {
        assetId: output.assetId,
        organizationId: 'organization-1',
        scope: 'workspace',
        scopeOwnerId: 'workspace-1',
        originWorkspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        title: 'Generated output',
        documents: {},
        states: {
            lifecycle: 'active',
            media: 'ready',
            conversation: 'none',
            provenance: 'sealed',
        },
        media: {
            kind: 'image',
            originalName: 'generated.png',
            sourceMimeType: 'image/png',
            modelSafe: true,
            renditions: {
                original: {
                    name: 'original',
                    mimeType: 'image/png',
                    byteSize: 1,
                    blobHash: 'blob-1',
                    status: 'ready',
                    updatedAt: 1,
                },
            },
        },
        generatedOutputReview: { status: reviewStatus },
        referenceCount: 1,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
    }
}

function makeInput(asset: Asset | undefined): {
    node: ImageCanvasNode
    asset: Asset | undefined
    nodes: CanvasNode[]
    edges: WorkspaceEdge[]
} {
    return {
        node: output,
        asset,
        nodes: [marker, output],
        edges: [edge],
    }
}

describe('generated output review state', () => {
    it('keeps a persisted candidate with live lineage ready and rejectable', () => {
        const asset = makeAsset('candidate')

        expect(isGeneratedOutputReadyForReview(output, asset)).toBe(true)
        expect(isGeneratedOutputAcceptedForCanvas(makeInput(asset))).toBe(false)
        expect(isGeneratedOutputRejectableForCanvas(makeInput(asset))).toBe(true)
    })

    it('uses terminal media projection while the Asset cache catches up', () => {
        expect(isGeneratedOutputReadyForReview(output, undefined)).toBe(true)
        expect(isGeneratedOutputRejectableForCanvas(makeInput(undefined))).toBe(true)
    })

    it('does not hide review controls behind a stale accepted Asset while lineage is active', () => {
        const asset = makeAsset('accepted')

        expect(isGeneratedOutputAcceptedForCanvas(makeInput(asset))).toBe(false)
        expect(isGeneratedOutputRejectableForCanvas(makeInput(asset))).toBe(true)
    })

    it('treats acceptance as final after the review topology is removed', () => {
        const asset = makeAsset('accepted')

        expect(isGeneratedOutputAcceptedForCanvas({
            node: output,
            asset,
            nodes: [output],
            edges: [],
        })).toBe(true)
    })
})
