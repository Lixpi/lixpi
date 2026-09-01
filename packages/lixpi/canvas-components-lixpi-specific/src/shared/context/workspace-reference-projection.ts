import type {
    Asset,
    CanvasNode,
    ExecutionTraceHandle,
    MediaPromptReference,
} from '@lixpi/constants'
import type { BranchMarkerConversationPreview } from '@lixpi/prosemirror/shared/thread-doc'
import {
    resolveBranchMarkerPromptParts,
    type BranchMarkerPromptPart,
} from '../branch-tree-layout/marker-prompt-parts.ts'
import { getBranchMarkerPlacementKeys } from '../generation/workspace-branch-activity.ts'

type BranchMarkerNode = Extract<CanvasNode, { type: 'branchOrigin' | 'branchFork' | 'branchLine' }>
export type WorkspaceReferenceProjectionPorts = {
    getNodes: () => readonly CanvasNode[]
    getAsset: (assetId: string) => Asset | undefined
    getDocumentTitles: () => ReadonlyMap<string, string>
    getSubmittedPromptParts: (placementKey: string) => readonly BranchMarkerPromptPart[] | undefined
}

export function getBranchMarkerPromptText(node: BranchMarkerNode): string {
    return (node.provenance?.promptText ?? node.pendingState?.promptText ?? '').trim().replace(/\s+/g, ' ')
}

export function normalizePromptReferencePreviewNode(
    node: CanvasNode | undefined,
    reference: MediaPromptReference,
): CanvasNode | undefined {
    if (!node || !('assetId' in node) || node.assetId !== reference.assetId) return undefined
    if (reference.mediaKind === 'image' && node.type === 'image') return node
    if (reference.mediaKind === 'video' && node.type === 'video') return node
    if (reference.mediaKind === 'audio' && node.type === 'audio') return node
    if (reference.mediaKind === 'document' && node.type === 'document') return node
    if (reference.mediaKind === 'document' && node.type === 'mediaDocument') {
        return { ...node, type: 'document' }
    }
    return undefined
}

export function getBranchMarkerReasoningResponseText(
    node: BranchMarkerNode,
    preview: BranchMarkerConversationPreview | null | undefined,
): string {
    return preview?.responseText.trim()
        || node.provenance?.reasoningResponseText?.trim()
        || ''
}

// Projects canvas references without changing the API's selected Asset set.
export class WorkspaceReferenceProjection {
    constructor(private readonly ports: WorkspaceReferenceProjectionPorts) {}

    getPromptReferencePreviewNode(reference: MediaPromptReference): CanvasNode | undefined {
        const explicitNode = normalizePromptReferencePreviewNode(
            reference.nodeId ? this.ports.getNodes().find(node => node.nodeId === reference.nodeId) : undefined,
            reference,
        )
        if (explicitNode) return explicitNode

        const matchingNode = this.ports.getNodes().find((node) => (
            'assetId' in node && node.assetId === reference.assetId
        ))
        const normalizedMatchingNode = normalizePromptReferencePreviewNode(matchingNode, reference)
        if (normalizedMatchingNode) return normalizedMatchingNode
        const asset = this.ports.getAsset(reference.assetId)
        const width = Math.max(1, asset?.media?.width ?? 320)
        const height = Math.max(1, asset?.media?.height ?? 240)
        const baseNode = {
            nodeId: reference.nodeId ?? `prompt-reference-${reference.assetId}`,
            assetId: reference.assetId,
            position: { x: 0, y: 0 },
            dimensions: { width, height },
        }
        if (reference.mediaKind === 'image') return { ...baseNode, type: 'image' }
        if (reference.mediaKind === 'video') return { ...baseNode, type: 'video' }
        if (reference.mediaKind === 'audio') return { ...baseNode, type: 'audio' }
        return { ...baseNode, type: 'document' }
    }

    getReferenceResolutionMediaKind(
        assetId: string,
    ): MediaPromptReference['mediaKind'] | undefined {
        const assetMediaKind = this.ports.getAsset(assetId)?.media?.kind
        if (
            assetMediaKind === 'image'
            || assetMediaKind === 'video'
            || assetMediaKind === 'audio'
            || assetMediaKind === 'document'
        ) return assetMediaKind

        const candidateNode = this.ports.getNodes().find(candidate => (
            'assetId' in candidate && candidate.assetId === assetId
        ))
        if (
            candidateNode?.type === 'image'
            || candidateNode?.type === 'video'
            || candidateNode?.type === 'audio'
        ) return candidateNode.type
        if (candidateNode?.type === 'document' || candidateNode?.type === 'mediaDocument') return 'document'
        return undefined
    }

    getBranchMarkerPromptTraceHandles(
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): ExecutionTraceHandle[] {
        const promptParts = this.getBranchMarkerPromptPartsForNode(node, preview)
        const promptMediaReferences = new Map(promptParts.flatMap(part => (
            part.type === 'media'
                ? [[part.reference.assetId, part.reference] as const]
                : []
        )))
        const provenanceAssetIds = node.provenance?.referenceAssetIds
        const referenceAssetIds = provenanceAssetIds ?? (
            node.provenance?.referenceNodeIds ?? []
        ).flatMap(referenceNodeId => {
            const referenceNode = this.ports.getNodes().find(candidate => (
                candidate.nodeId === referenceNodeId && 'assetId' in candidate
            ))
            return referenceNode && 'assetId' in referenceNode && referenceNode.assetId
                ? [referenceNode.assetId]
                : []
        })
        const mediaHandles: ExecutionTraceHandle[] = referenceAssetIds.map(assetId => {
            const promptReference = promptMediaReferences.get(assetId)
            const asset = this.ports.getAsset(assetId)
            const referenceNode = this.ports.getNodes().find(candidate => (
                'assetId' in candidate && candidate.assetId === assetId
            ))
            const mediaKind = this.getReferenceResolutionMediaKind(assetId)
                ?? promptReference?.mediaKind
            return {
                kind: 'media',
                id: assetId,
                displayName: asset?.title.trim()
                    || promptReference?.displayName.trim()
                    || assetId,
                ...(mediaKind ? { mediaKind } : {}),
                ...(referenceNode
                    ? { nodeId: referenceNode.nodeId }
                    : promptReference?.nodeId
                    ? { nodeId: promptReference.nodeId }
                    : {}),
                role: 'message-reference',
            }
        })
        const nonMediaHandles = promptParts.flatMap((part): ExecutionTraceHandle[] => {
            if (part.type === 'text' || part.type === 'media') return []
            return [{
                kind: part.type,
                id: part.type === 'capability-module'
                    ? part.reference.moduleId
                    : part.reference.capabilityId,
                displayName: part.reference.displayName,
                role: 'requested-by-user',
            }]
        })
        return [...nonMediaHandles, ...mediaHandles]
    }

    getBranchMarkerPromptPartsForNode(
        node: BranchMarkerNode,
        preview: BranchMarkerConversationPreview | null | undefined,
    ): BranchMarkerPromptPart[] {
        let submittedParts: readonly BranchMarkerPromptPart[] = []
        for (const placementKey of getBranchMarkerPlacementKeys(node)) {
            const placementParts = this.ports.getSubmittedPromptParts(placementKey)
            if (!placementParts?.length) continue
            submittedParts = placementParts
            break
        }
        return resolveBranchMarkerPromptParts({
            persistedUserMessage: preview?.userMessage,
            submittedParts,
            fallbackText: preview?.userText ?? getBranchMarkerPromptText(node),
        })
    }

    buildWorkspaceContextTitlesByNodeId(nodes: CanvasNode[]): Record<string, string> {
        const assetTitleById = this.ports.getDocumentTitles()
        const titlesByNodeId: Record<string, string> = {}
        for (const node of nodes) {
            if (node.type === 'document') {
                const title = assetTitleById.get(node.assetId)
                if (title) titlesByNodeId[node.nodeId] = title
            }
        }
        return titlesByNodeId
    }
}
