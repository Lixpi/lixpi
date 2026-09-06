// What `GET /api/model-catalog/overview` returns. The server assembles it from
// the merged catalog, so these mirror the catalog types without importing server
// code into the browser bundle.

export type ProviderDirectory =
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'stability'
    | 'byteplus'

export type MergeStatus =
    | 'written-to-database'
    | 'missing-required-fields'
    | 'skipped-by-catalog-index'

export type SourceId = 'models.dev' | 'litellm' | 'provider-api' | 'bedrock'

export type SkippedModel = {
    model: string
    reason: string
}

export type CatalogIndex = {
    providerKey: string
    description?: string
    syncMode: 'all' | 'onlyListed'
    modelsToSync: string[]
    modelsToSkip: SkippedModel[]
}

export type ProviderBase = {
    providerKey?: string
    fieldsInheritedByEveryModel?: Record<string, unknown>
}

export type DriftFinding = {
    provider: ProviderDirectory
    modelId: string
    field: string
    lixpiValue: unknown
    fetchedValue: unknown
    source: string
    isPricing: boolean
}

export type ModelSources = {
    sourcesQueried: SourceId[]
    sourcesWithDataForThisModel: SourceId[]
    inferenceProviderCalledByThePlatform: string
    sourcesWithoutRatesForThatProvider: SourceId[]
    confirmedByMoreThanOneSource: boolean
    fieldsWhereSourcesDisagree: string[]
}

export type AuthoredSummary = {
    fieldsOnlyLixpiSupplies: string[]
    fieldsWhereLixpiOverridesSources: string[]
    fieldsInheritedFromProviderBaseFile: string[]
}

export type CatalogModel = {
    provider: ProviderDirectory
    providerTitle: string
    modelId: string
    status: MergeStatus
    mergedAt: string
    // The record that reaches DynamoDB, or null while required fields are missing.
    model: Record<string, any> | null
    // The merged file, which carries the same fields whether or not the model
    // passed validation. The table reads this so an incomplete model still shows
    // what is known about it.
    file: Record<string, any>
    lixpi: Record<string, any> | null
    missingRequiredFields: string[]
    fieldsFilledFromSchemaDefault: string[]
    ratesRefusedBecauseUnitsDiffer: string[]
    sources: ModelSources
    authored: AuthoredSummary
    drift: DriftFinding[]
}

export type CatalogProvider = {
    directory: ProviderDirectory
    title: string
    index: CatalogIndex | null
    base: ProviderBase | null
}

export type InferenceProviderEntry = {
    title: string
    kind: 'vendor-api' | 'cloud-platform'
    servesCatalogDirectories: ProviderDirectory[]
    selectedForDirectoryWhenEnvFlagIsTrue?: Record<string, string>
}

// `_base-index.json`: the settings that belong to the whole catalog rather than to
// one provider directory.
export type CatalogBaseIndex = {
    description?: string
    inferenceProviders: Record<string, InferenceProviderEntry>
}

export type CatalogOverview = {
    baseIndex: CatalogBaseIndex | null
    providers: CatalogProvider[]
    models: CatalogModel[]
    syncEnabled: boolean
    lastSync: string | null
}

export type ConfigPatchResult = {
    provider: string
    file: string
    changed: boolean
    applied: string[]
    previousVersionKeptIn: string | null
}
