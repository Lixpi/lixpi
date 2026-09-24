import {
    type AiModel,
} from '@lixpi/constants'
import {
    type AiModelPricing,
    type PricedAiModel,
} from '@lixpi/usage-reporter'

// The model catalog is a directory tree, the same way the parameter registry is.
// There is no database and no index of its own: the layout defines the catalog.
//
//   model-catalog/catalog-settings.json               catalog-wide settings
//   model-catalog/schema.json                         fields every model carries
//   model-catalog/<provider>/base.json                fields every model here inherits
//   model-catalog/<provider>/catalog-settings.json    what to sync and what to skip
//   model-catalog/<provider>/<model>/<source>.json    one file per source, always written
//   model-catalog/<provider>/<model>/lixpi.json       authored, human-owned
//   model-catalog/<provider>/<model>/merged.json      the resolved result
//   model-catalog/<provider>/<model>/_meta.json       how that result was arrived at
//
// One directory per model, so everything about a model sits together.
//
// Every source gets a file for every model whether or not it had anything, so a gap
// reads as "this source has no data" rather than "this source was never asked".

export const LIXPI_FILE = 'lixpi.json'
export const MERGED_FILE = 'merged.json'
export const META_FILE = '_meta.json'
export const BASE_FILE = 'base.json'
export const SCHEMA_FILE = 'schema.json'
// The same file name at two levels: one in the catalog root for the whole catalog,
// one in each provider directory for that provider.
export const CATALOG_SETTINGS_FILE = 'catalog-settings.json'
export const PROVIDER_SETTINGS_FILE = CATALOG_SETTINGS_FILE
// Beside the tree, not in it: it describes the last run rather than the catalog.
export const LAST_SYNC_FILE = '_last-sync.json'

// Directory name per provider. The `provider` field inside a model file keeps the
// internal key the rest of the platform persists, e.g. `BytePlus`.
export const PROVIDER_DIRECTORIES = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    google: 'Google',
    stability: 'Stability',
    byteplus: 'BytePlus',
} as const

export type ProviderDirectory = keyof typeof PROVIDER_DIRECTORIES

export type SourceId = 'models.dev' | 'litellm' | 'provider-api' | 'bedrock'

// An endpoint Lixpi can send a generation request to. A vendor's own API is one and
// AWS Bedrock is another, and the same model reached through each is the same model
// at a different price: Anthropic charges 5.00/25.00 per million for Claude Opus 5
// while Bedrock charges 5.50/27.50 in-region. Every one of them is recorded for every
// model, and the platform calls one of them, which is a separate question from what
// the others cost.
//
// A vendor-API id is the same string as its catalog directory. `catalog-settings.json`
// declares them, their titles, which directories each serves, and which flag hands a
// directory to a platform provider.
export type InferenceProviderId =
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'stability'
    | 'byteplus'
    | 'aws-bedrock'

export type InferenceProviderEntry = {
    title: string
    kind: 'vendor-api' | 'cloud-platform'
    // The directories this provider can serve at all. A source reporting a model on a
    // provider not listed for its directory is ignored.
    servesCatalogDirectories: ProviderDirectory[]
    // The name this provider lists a directory's models under, when it uses one of
    // its own. Bedrock files Stability's models under "Stability AI".
    listedUnderProviderName?: Partial<Record<ProviderDirectory, string>>
    // Per directory, the environment flag that hands it to this provider. Absent on a
    // vendor API, which is a directory's default.
    selectedForDirectoryWhenEnvFlagIsTrue?: Partial<Record<ProviderDirectory, string>>
}

export type CatalogBaseIndexFile = {
    description?: string
    inferenceProviders: Record<InferenceProviderId, InferenceProviderEntry>
}

// File name per source, inside the model's directory. `models.dev` cannot be a file
// name as it stands, and `models.dev` keeps the dot the source spells it with.
export const SOURCE_FILE_NAMES: Record<SourceId, string> = {
    'models.dev': 'models.dev.json',
    litellm: 'litellm.json',
    'provider-api': 'provider-api.json',
    bedrock: 'bedrock.json',
}

// Which source wins a field two of them answer. LiteLLM leads because it names each
// cost family separately, so an image model's image-token rate and its text rate are
// different fields; models.dev publishes one cost per model and cannot say which
// family it belongs to. This is the merge's precedence, held apart from the file
// naming above so a rename cannot quietly reorder it.
export const SOURCE_PRECEDENCE: SourceId[] = [
    'litellm',
    'models.dev',
    'provider-api',
    'bedrock',
]

// One JSON file from a model's directory, as the catalog page's file tabs read it.
export type ModelFile = {
    name: string
    content: unknown
    // False when the file is on disk but does not parse, so the page can say so
    // instead of rendering `null` as though that were the content.
    readable: boolean
}

export type FieldOwner = 'lixpi' | 'source' | 'derived'

export type SchemaField = {
    valueType: string
    ownedBy: FieldOwner
    defaultWhenNoSourceHasIt?: unknown
    note?: string
}

export type BaseSchema = {
    schemaVersion: number
    description: string
    requiredForEveryModel: Record<string, SchemaField>
    // Fields a model carries once per inference provider rather than once. Rates are
    // the whole of it: the same model billed through a vendor API and through AWS
    // Bedrock has two prices, and a single one on the model would be wrong for at
    // least one endpoint.
    requiredForEveryInferenceProvider: Record<string, SchemaField>
    requiredForModelsWithModality: Record<string, Record<string, SchemaField>>
    optionalFields: Record<string, SchemaField>
}

// Fields shared by every model in a provider directory: the brand name, the colour,
// the icons. Stated once here rather than repeated in every authored file, and
// overridden by any model that states its own.
export type ProviderBase = {
    providerKey: string
    description?: string
    fieldsInheritedByEveryModel: Record<string, unknown>
    // Leading words a default short title drops, beyond the provider's own name.
    // Anthropic titles every model "Claude something" and shortens to "something", so
    // it lists "Claude" here. A directory whose titles do not carry a brand prefix
    // lists nothing and its titles are shortened only by the provider name.
    shortTitleDropsLeadingWords?: string[]
}

// One entry per skipped model, holding the model and why it is skipped together.
// Splitting the ids from their reasons into parallel structures made it possible for
// the two to drift apart.
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

// Everything a human authors: the fields no source can supply, plus any deliberate
// override of a field a source does supply.
export type LixpiModelRecord = Partial<Omit<AiModel, 'createdAt' | 'updatedAt'>> & {
    // Ids a source files this model under when they differ from the catalog id.
    // Lixpi names Stability's Ultra endpoint `stability-ultra`, while LiteLLM and
    // Bedrock both call it `stable-image-ultra`; without the alias neither source
    // matches and the model looks uncovered when it is not.
    otherIdsUsedBySources?: string[]
    // Authored values that belong to one endpoint rather than to the model. Rates
    // live here, keyed the same way the source files key theirs, so an override
    // states which endpoint's price it is correcting.
    byInferenceProvider?: Partial<Record<InferenceProviderId, AuthoredInferenceProviderValues>>
}

export type AuthoredInferenceProviderValues = {
    pricing?: AiModelPricing
}

// One source's answer for one model. Written even when the source has nothing.
// What one source says about one model on one route.
export type InferenceProviderFacts = Partial<Omit<LixpiModelRecord, 'byInferenceProvider'>> & {
    // What this model costs at this endpoint. Held per endpoint because that is the
    // only level at which a rate is true.
    pricing?: AiModelPricing
    // The key this source files the model under for this inference provider, which is
    // rarely the Lixpi model id.
    modelKeyAtSource: string
    // What this source reports that no model field holds: Bedrock's lifecycle status,
    // the id to invoke, the price-list tiers behind the rates. Recorded here and
    // ignored by the merge, so reading a source file answers more than the merged
    // record can carry.
    sourceOnlyFacts?: Record<string, unknown>
}

// One endpoint a source was asked, and what it was asked with. A source that reads a
// whole-catalog file carries no parameters; one that queries per vendor or per region
// carries the values it actually sent, so a number in the file can be traced back to
// the request that produced it without reading the fetcher.
export type SourceEndpointQuery = {
    // A URL, or the API operation for an SDK call: `bedrock:ListFoundationModels`.
    endpoint: string
    // Absent when the endpoint takes none.
    params?: Record<string, unknown>
    // What the answer covers, when the endpoint answers for more than this model.
    note?: string
}

export type SourceModelRecord = {
    // Provenance first, values second. `_meta` says who was asked, at which endpoint,
    // with which parameters; it describes the fetch rather than the model, so the
    // merge reads `byInferenceProvider` and never carries any of this into the merged
    // record.
    _meta: {
        // What the thing being quoted actually calls itself: "Anthropic Models API",
        // "AWS Bedrock", "models.dev". `sourceId` is the catalog's own key for it,
        // which is what the merge and the file naming use.
        sourceName: string
        sourceId: SourceId
        // Every endpoint consulted for this model's directory, in the order the
        // source calls them.
        queriedEndpoints: SourceEndpointQuery[]
        hasDataForThisModel: boolean
        // Inference providers this source published rates or limits for.
        inferenceProvidersWithData: InferenceProviderId[]
        fetchedAt: string
        // Only the provider API records this: every id the vendor publishes for this
        // model family, and which one is current. The catalog entry is named for the
        // family; this says what to actually call.
        publishedVersions?: {
            currentVersion: string
            allPublishedVersions: string[]
        }
        note?: string
    }
    // One entry per inference provider the source publishes for. A source that only
    // knows the vendor's own API carries only that one.
    byInferenceProvider: Partial<Record<InferenceProviderId, InferenceProviderFacts>>
}

// Whether the sources that answered for a field said the same thing.
export type Agreement =
    | 'only-one-source-answered'
    | 'all-sources-agree'
    | 'sources-disagree'

// Where one field's value came from, and nothing about what the value is. The
// values themselves live in the merged file and in each source's own file; this
// only says who supplied it and whether anyone disagreed.
export type FieldProvenance = {
    // A source name, `lixpi-authored-file` when the model's own file states it,
    // `provider-base-file` when it comes from `base.json`, or `derived-from-file-name`
    // when the tree itself decides it.
    valueCameFrom: string
    sourceAgreement: Agreement
    // Sources that had an answer for this field. Open their files to compare.
    sourcesThatAnswered: SourceId[]
    // Set when the authored file overrode a value a source also supplied.
    lixpiOverridesSource?: boolean
}

export type MergeStatus =
    | 'written-to-database'
    | 'missing-required-fields'
    | 'skipped-by-catalog-index'

// One inference provider's own view of a model, as the sources report it: what it
// costs there, the limits it carries there, and the key each source files it under.
// Held apart from the top-level fields, which describe the call the platform makes
// today, so switching the flag that chooses a provider never destroys what the others
// said. Rates only exist here: an authored price override names its endpoint and is
// resolved into that endpoint's block, so no rate is ever stated for the model as a
// whole.
export type MergedInferenceProvider = Partial<Pick<AiModel, 'contextWindow' | 'maxCompletionSize' | 'title'>> & {
    pricing?: AiModelPricing
    // The endpoint's own name. `title`, when a source reports one, is what that
    // endpoint calls the model, which is not always what the vendor calls it.
    inferenceProviderTitle: string
    isCalledByThePlatform: boolean
    reportedBySources: SourceId[]
    modelKeyAtSource: Partial<Record<SourceId, string>>
    // What the provider reports that no model field holds, such as Bedrock's
    // lifecycle status and the id to invoke.
    providerReportedFacts?: Record<string, unknown>
}

// The resolved model, and nothing else. How it was resolved lives beside it in the
// meta file, so a reader who wants the catalog is not wading through provenance.
export type MergedModelFile = Partial<PricedAiModel>

// The account of one merge: which sources were consulted, which of them supplied
// each field, whether they agreed, and where the authored file overrode them.
export type ModelMetaFile = {
    // The catalog entry this describes, which is the file name. Every other
    // identifier is a value and lives in the merged file.
    modelFamily: string
    mergedAt: string
    baseSchemaVersion: number
    syncStatus: MergeStatus
    sources: {
        sourcesQueried: SourceId[]
        sourcesWithDataForThisModel: SourceId[]
        // Which inference provider the top-level rates are for. Every provider's own
        // rates are in the merged file too; this is the one the platform is calling.
        inferenceProviderCalledByThePlatform: InferenceProviderId
        // Sources that know this model but publish no rates for the inference provider
        // Lixpi calls. Their rates for the others are still recorded.
        sourcesWithoutRatesForThatProvider: SourceId[]
        // True when more than one source supplied at least one field, so the model's
        // facts are corroborated rather than resting on a single catalog.
        confirmedByMoreThanOneSource: boolean
        fieldsWhereSourcesDisagree: string[]
    }
    lixpi: {
        fieldsOnlyLixpiSupplies: string[]
        fieldsWhereLixpiOverridesSources: string[]
        fieldsInheritedFromProviderBaseFile: string[]
    }
    // Required or conditionally required fields nothing supplied. A model with any of
    // these is not written to the database.
    requiredFieldsStillMissing: string[]
    // Source-owned fields nothing supplied, filled from the schema's default.
    fieldsFilledFromSchemaDefault: string[]
    // Blank rates a source carries in a different unit, refused rather than converted
    // by guesswork.
    ratesRefusedBecauseUnitsDiffer: string[]
    fieldOrigins: Record<string, FieldProvenance>
    note?: string
}

export type ModelBundle = {
    provider: ProviderDirectory
    modelId: string
    base: ProviderBase | null
    lixpi: LixpiModelRecord
    sources: SourceModelRecord[]
}

export type DriftFinding = {
    provider: ProviderDirectory
    modelId: string
    // Dotted path into the model, e.g. `pricing.text.tiers.default.prompt`.
    field: string
    lixpiValue: unknown
    fetchedValue: unknown
    source: string
    // Usage reporting consumes pricing over `metrics.*`; a mismatch is a
    // money bug and is reported apart from ordinary field drift.
    isPricing: boolean
}

export type MergedModel = {
    provider: ProviderDirectory
    modelId: string
    file: MergedModelFile
    meta: ModelMetaFile
    model: PricedAiModel | null
    drift: DriftFinding[]
    // Fields the merge worked out a default for that belong to the authored file. The
    // sync writes them there through the same API a person edits with, so the default
    // becomes an authored value somebody can change rather than something the merge
    // silently re-decides on every run. Only ever set for a field the authored file
    // left blank.
    authoredFieldsToBackfill?: Record<string, unknown>
}

// A source that could not answer, and for which directory. Every one of these stops
// the fetch: a run missing a source is not a run, and the tree must keep what the
// last complete one wrote.
export type SourceFailure = {
    sourceId: SourceId
    sourceName: string
    // Absent when the source failed outright rather than for one directory.
    provider?: ProviderDirectory
    message: string
}

// What the last run did, kept next to the tree so the page can say whether the
// catalog it is showing is current, whoever ran the sync.
export type LastSyncOutcome = {
    ranAt: string
    finishedAt: string
    status: 'completed' | 'failed'
    // Set when the run failed. Names what went wrong in the words the operator needs.
    error?: {
        name: string
        message: string
        sourceFailures: SourceFailure[]
    }
    models?: number
    written?: number
}

// What a run is doing, as it does it. The page shows a sync happening rather than a
// button that goes quiet for a minute, so every provider and every model reports when
// it starts and when it is done.
export type SyncProgressEvent =
    | {
        type: 'run-started'
        ranAt: string
    }
    | {
        type: 'phase'
        phase: 'fetching' | 'merging' | 'writing'
    }
    | {
        type: 'provider-started'
        provider: ProviderDirectory
    }
    | {
        type: 'provider-finished'
        provider: ProviderDirectory
    }
    | {
        type: 'model-started'
        provider: ProviderDirectory
        modelId: string
    }
    | {
        type: 'model-finished'
        provider: ProviderDirectory
        modelId: string
    }
    | {
        type: 'run-finished'
        status: 'completed' | 'failed'
        message?: string
    }

export type SyncProgressListener = (event: SyncProgressEvent) => void

export type DiscoveredModel = {
    provider: ProviderDirectory
    modelId: string
    source: SourceId
}
