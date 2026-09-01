export type AssetReferenceDocumentRole = 'content' | 'conversation' | 'capabilityArtifact'

function collectAssetIds(
    node: unknown,
    includePromptReferences: boolean,
    assetIds: Set<string>,
): void {
    if (!node || typeof node !== 'object') return
    const record = node as {
        type?: unknown
        attrs?: { assetId?: unknown }
        content?: unknown
    }
    const assetId = record.attrs?.assetId
    const isPromptReference = record.type === 'prompt_reference'
    if (typeof assetId === 'string' && assetId && (includePromptReferences || !isPromptReference)) {
        assetIds.add(assetId)
    }
    if (!Array.isArray(record.content)) return
    for (const child of record.content) collectAssetIds(child, includePromptReferences, assetIds)
}

export function collectReferencedAssetIds(node: unknown): Set<string> {
    const assetIds = new Set<string>()
    collectAssetIds(node, true, assetIds)
    return assetIds
}

export function collectEmbeddedAssetIds(
    node: unknown,
    role: AssetReferenceDocumentRole,
): Set<string> {
    const assetIds = new Set<string>()
    collectAssetIds(node, role !== 'conversation', assetIds)
    return assetIds
}
