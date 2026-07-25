'use strict'

type ReplaceBranchMarkerDomCopiesOptions = {
    overlayEl: HTMLElement | null
    viewportEl: HTMLElement
    previousNodeId: string
    nextNodeId: string
    nextNodeEl: HTMLElement
}

export type PendingBranchMarkerOverlayIdentity = {
    nodeId: string
    reasoningModelId?: string
    reasoningIndex?: number
}

export function getPendingBranchMarkerOverlayIdentities(
    overlayEl: HTMLElement | null,
    conversationAssetId: string,
): PendingBranchMarkerOverlayIdentity[] {
    return [...(overlayEl?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])]
        .filter(nodeEl =>
            Boolean(nodeEl.dataset.nodeId)
            && nodeEl.dataset.conversationAssetId === conversationAssetId
        )
        .map((nodeEl): PendingBranchMarkerOverlayIdentity => {
            const reasoningIndex = nodeEl.dataset.reasoningIndex
            const parsedReasoningIndex = reasoningIndex === undefined || reasoningIndex === ''
                ? Number.NaN
                : Number(reasoningIndex)
            return {
                nodeId: nodeEl.dataset.nodeId!,
                ...(nodeEl.dataset.reasoningModelId
                    ? { reasoningModelId: nodeEl.dataset.reasoningModelId }
                    : {}),
                ...(Number.isFinite(parsedReasoningIndex)
                    ? { reasoningIndex: parsedReasoningIndex }
                    : {}),
            }
        })
}

function getBranchMarkerElements(root: HTMLElement | null, nodeId: string): HTMLElement[] {
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>('[data-node-id]')]
        .filter(nodeEl => nodeEl.dataset.nodeId === nodeId)
}

export function clearBranchMarkerOverlayForStructuralRender(overlayEl: HTMLElement | null): void {
    overlayEl?.replaceChildren()
}

export function findPendingBranchMarkerOverlayIdentity(
    overlayEl: HTMLElement | null,
    conversationAssetId: string,
    reasoningIndex?: number,
    reasoningModelId?: string,
): PendingBranchMarkerOverlayIdentity | null {
    const candidates = getPendingBranchMarkerOverlayIdentities(overlayEl, conversationAssetId)

    if (reasoningIndex != null) {
        const indexMatches = candidates.filter(candidate => candidate.reasoningIndex === reasoningIndex)
        if (indexMatches.length === 1) return indexMatches[0]!
    }
    if (reasoningModelId) {
        const modelMatches = candidates.filter(candidate => candidate.reasoningModelId === reasoningModelId)
        if (modelMatches.length === 1) return modelMatches[0]!
    }
    return candidates.length === 1 ? candidates[0]! : null
}

export function removeBranchMarkerOverlayElementsForConversation(
    overlayEl: HTMLElement | null,
    conversationAssetId: string,
): string[] {
    const removedNodeIds: string[] = []
    for (const nodeEl of overlayEl?.querySelectorAll<HTMLElement>('[data-node-id]') ?? []) {
        const nodeId = nodeEl.dataset.nodeId ?? ''
        if (!nodeId || nodeEl.dataset.conversationAssetId !== conversationAssetId) continue
        removedNodeIds.push(nodeId)
        nodeEl.remove()
    }
    return removedNodeIds
}

export function removeOrphanedBranchMarkerOverlayElements(
    overlayEl: HTMLElement | null,
    retainedNodeIds: ReadonlySet<string>,
    conversationAssetId: string,
): string[] {
    const removedNodeIds: string[] = []
    for (const nodeEl of overlayEl?.querySelectorAll<HTMLElement>('[data-node-id]') ?? []) {
        const nodeId = nodeEl.dataset.nodeId ?? ''
        if (
            !nodeId
            || nodeEl.dataset.conversationAssetId !== conversationAssetId
            || retainedNodeIds.has(nodeId)
        ) continue
        removedNodeIds.push(nodeId)
        nodeEl.remove()
    }
    return removedNodeIds
}

export function replaceBranchMarkerDomCopies({
    overlayEl,
    viewportEl,
    previousNodeId,
    nextNodeId,
    nextNodeEl,
}: ReplaceBranchMarkerDomCopiesOptions): void {
    const nodeIds = new Set([previousNodeId, nextNodeId])
    const staleElements = new Set<HTMLElement>()
    for (const nodeId of nodeIds) {
        for (const nodeEl of getBranchMarkerElements(overlayEl, nodeId)) staleElements.add(nodeEl)
        for (const nodeEl of getBranchMarkerElements(viewportEl, nodeId)) staleElements.add(nodeEl)
    }
    for (const staleElement of staleElements) staleElement.remove()
    viewportEl.appendChild(nextNodeEl)
}
