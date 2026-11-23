import {
    type Asset,
    type AssetScope,
    type CanvasCollaborationLease,
    type DepictionMedium,
    type GeneratedOutputReviewResponse,
    type GeneratedOutputReviewScope,
    type MediaGenerationRequest,
} from '@lixpi/constants'
import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'

// An Asset is addressed through its canvas placement or by an ID the
// conversation has already admitted. The host decides whether an unplaced
// Asset is readable in the current turn.
export type CanvasAssetTarget =
    | { nodeId: string }
    | { assetId: string }

export type CanvasAssetMetadataPatch = {
    title?: string
    depictionMedium?: DepictionMedium
}

export type CanvasGeneratedOutputReview =
    | {
        scope: GeneratedOutputReviewScope
        action: 'accept' | 'reject'
        nodeId: string
    }
    | {
        scope: 'output-node'
        action: 'supersede'
        nodeId: string
        preserveLineage: true
    }
    | {
        scope: 'branch-lineage'
        action: 'supersede'
        nodeId: string
        preserveLineage: boolean
    }

export type CanvasGeneratedOutputReviewPlan = {
    nodeIds: string[]
    edgeIds: string[]
    assetIds: string[]
}

// Every operation runs as the conversation owner in the active workspace.
// Inputs never carry a user, workspace, organization or scope owner. The
// host derives them from the authorized execution and rejects anything
// outside that boundary.
export type CanvasExtendedSession = {
    readAsset: (assetId: string) => Promise<Asset>
    updateAssetMetadata: (
        assetId: string,
        patch: CanvasAssetMetadataPatch,
        expectedRevision: number,
        lease: CanvasCollaborationLease,
    ) => Promise<Asset>
    removeLibraryEntry: (
        assetId: string,
        expectedRevision: number,
        lease: CanvasCollaborationLease,
    ) => Promise<{
        success: true
        deleting: boolean
    }>
    changeAssetScope: (
        assetId: string,
        scope: AssetScope,
        expectedRevision: number,
        lease: CanvasCollaborationLease,
    ) => Promise<Asset>
    planGeneratedOutputReview: (review: CanvasGeneratedOutputReview) => Promise<CanvasGeneratedOutputReviewPlan>
    reviewGeneratedOutput: (
        review: CanvasGeneratedOutputReview,
        leases: CanvasCollaborationLease[],
    ) => Promise<GeneratedOutputReviewResponse>
    readGeneration: (generationRequestId: string) => Promise<MediaGenerationRequest>
    cancelGeneration: (
        generationRequestId: string,
        expectedRevision: number,
        leases: CanvasCollaborationLease[],
    ) => Promise<MediaGenerationRequest>
}

export type CanvasExtendedAccess = (context: CapabilityActionAuthorizationContext) => Promise<CanvasExtendedSession>
