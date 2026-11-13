import {
    type CapabilityModuleMeta,
    type CapabilityPromptReference,
    type PromptReferenceCatalogPage,
    type PromptReferenceCategory,
} from '@lixpi/constants'

export type WorkspacePromptCatalog = {
    list: (query: {
        category: PromptReferenceCategory
        query?: string
        cursor?: string
        limit?: number
    }) => Promise<PromptReferenceCatalogPage>
    listModules: (query?: string) => Promise<CapabilityModuleMeta[]>
    getModule: (moduleId: string) => Promise<{
        meta: CapabilityModuleMeta
        entry: CapabilityPromptReference
    }>
}
