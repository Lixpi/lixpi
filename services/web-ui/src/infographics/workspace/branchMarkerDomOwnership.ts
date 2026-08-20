'use strict'

type ReplaceBranchMarkerDomCopiesOptions = {
    viewportEl: HTMLElement
    previousNodeId: string
    nextNodeId: string
    nextNodeEl: HTMLElement
}

function getBranchMarkerElements(root: HTMLElement, nodeId: string): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('[data-node-id]')]
        .filter(nodeEl => nodeEl.dataset.nodeId === nodeId)
}

export function removeOrphanedBranchMarkerElements(
    viewportEl: HTMLElement,
    retainedNodeIds: ReadonlySet<string>,
    conversationAssetId: string,
): string[] {
    const removedNodeIds: string[] = []
    for (const nodeEl of viewportEl.querySelectorAll<HTMLElement>('[data-node-id]')) {
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
    viewportEl,
    previousNodeId,
    nextNodeId,
    nextNodeEl,
}: ReplaceBranchMarkerDomCopiesOptions): void {
    const nodeIds = new Set([previousNodeId, nextNodeId])
    const staleElements = new Set<HTMLElement>()
    for (const nodeId of nodeIds) {
        for (const nodeEl of getBranchMarkerElements(viewportEl, nodeId)) staleElements.add(nodeEl)
    }
    for (const staleElement of staleElements) staleElement.remove()
    viewportEl.appendChild(nextNodeEl)
}
