// Shapes the client receives from /api/catalog and /api/selections. They mirror
// what src/store.ts writes, narrowed to the fields the page actually reads.

export type Decision = 'skip' | 'internal' | 'expose'

export type Status = 'none' | 'approved' | 'needs-param-clarification' | 'needs-implementation-investigation'

export type SelectionEntry = {
    decision: Decision
    reviewed: boolean
    status: Status
    irrelevant: boolean
    fixedValue: string
    defaultValue: string
    note: string
}

export type SelectionMap = Record<string, SelectionEntry>

export type CatalogParam = SelectionEntry & {
    key: string
    category: string
    apiField: string
    controlKey: string | null
    type: string
    values?: string[]
    range?: string
    providerDefault: string | null
    lixpiValue: string | null
    currentState: 'exposed' | 'hidden' | 'absent'
    availability: 'supported' | 'unsupported' | 'unverified'
    summary: string
    combines: string[]
    usage?: { setIn: string; code: string; from: string; what: string }
    supportedModels: string[]
    unsupportedModels: string[]
    supportedApis: string[]
    unsupportedApis: string[]
    sources: string[]
}

export type CatalogGroup = {
    id: string
    title: string
    mediaType: string
    mediaTitle: string
    models: string[]
    docs: string
    supportedModels: string[]
    supportedApis: string[]
    categories: string[]
    parameters: CatalogParam[]
}

export type CatalogProvider = {
    id: string
    title: string
    apiName: string
    groups: CatalogGroup[]
}

export type CategoryMeta = { title: string; order: number }

export type Catalog = {
    catalogVersion: string
    source: string
    capturedAt: string
    legend: Record<string, Record<string, string>>
    categories?: Record<string, CategoryMeta>
    providers: CatalogProvider[]
}

export type Summary = Record<string, number>
