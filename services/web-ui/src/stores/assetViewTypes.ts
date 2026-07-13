export type AssetDocumentView = {
    documentId: string
    assetId: string
    organizationId: string
    revision: number
    workspaceId?: string
    title: string
    proseMirrorVersion?: number
    content?: object
    createdAt?: number | string
    updatedAt?: number | string
}

export type ConversationAssetView = {
    threadId: string
    assetId: string
    organizationId: string
    revision: number
    workspaceId: string
    title?: string
    content?: object
    proseMirrorVersion?: number
    aiModel?: string
    status: 'idle' | 'receiving' | 'paused' | 'completed' | 'failed' | 'active'
    createdAt: number
    updatedAt: number
}
