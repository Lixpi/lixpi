import type {
    Asset,
    AssetDocumentRole,
    AssetMeta,
    AssetPrimaryCategory,
} from '@lixpi/constants'

export type LibraryAssetResult = Asset | { error: string }

export type LibraryAssetPorts = {
    list: (query: { workspaceId: string; primaryCategory?: AssetPrimaryCategory; limit: number; cursor?: string }) => Promise<{ items: AssetMeta[]; cursor?: string }>
    get: (assetId: string, workspaceId: string) => Promise<LibraryAssetResult>
    refresh: (assetId: string, workspaceId: string) => Promise<LibraryAssetResult>
    updateMetadata: (assetId: string, revision: number, patch: { title: string }) => Promise<LibraryAssetResult>
    changeScope: (assetId: string, revision: number, scope: Asset['scope'], scopeOwnerId: string) => Promise<LibraryAssetResult>
    resumeDocument: (coordinate: { organizationId: string; assetId: string; role: AssetDocumentRole }) => Promise<unknown>
    getDocument: (assetId: string, role: AssetDocumentRole) => { doc: object; version: number } | undefined
}

export type LibraryHistoryRequest = {
    host: HTMLElement
    asset: Asset
    content: object
    signal: AbortSignal
}

export type WorkspaceLibraryPorts = {
    document: Document
    workspaceId: string
    userId: string
    assets: LibraryAssetPorts
    mountHistory: (request: LibraryHistoryRequest) => { destroy: () => void }
    onError: (error: unknown) => void
}
