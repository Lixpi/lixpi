import {
    type AiModel,
} from '@lixpi/constants'

import {
    type CatalogSchema,
} from './base-schema.ts'
import {
    type ProviderCatalogIndex,
} from './catalog-index.ts'
import { validateModel } from './model-validator.ts'
import {
    PROVIDER_DIRECTORIES,
    type Agreement,
    type DriftFinding,
    type FieldProvenance,
    type MergeStatus,
    type MergedModel,
    type MergedModelFile,
    type ModelBundle,
    type ModelMetaFile,
    type InferenceProviderId,
    type MergedInferenceProvider,
    type SourceId,
    type SourceModelRecord,
} from './types.ts'
import {
    type CatalogBaseIndex,
} from './base-index.ts'
import { familyId } from './model-identity.ts'

// Resolves one model from its source files, the provider's shared `_base.json`, and
// its own authored file, and produces the merged record plus a full account of where
// every value came from.
//
// The authored file wins any field it states, and falls back to the provider base
// for the fields every model in a directory shares. A field it leaves out belongs to the
// sources, and among those the first source in precedence order that answered
// supplies the value. Where two sources disagree, both answers are kept and the
// field is marked. Where the authored file overrides a source, that is marked too
// and reported as drift, which is what turns the fetch into an alarm rather than a
// silent no-op.

// Rate leaves. One only transfers from a source when the units agree.
const RATE_KEYS = new Set([
    'prompt',
    'completion',
    'price',
    'withoutVideoInput',
    'withVideoInput',
])

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object'
    && value !== null
    && !Array.isArray(value)

// Arrays are leaves. A control list or an option list is one authored decision, and
// splicing two of them together would produce a configuration nobody wrote.
const flattenLeaves = (
    node: unknown,
    path: string[],
    out: Map<string, unknown>,
): void => {
    if (!isPlainObject(node)) {
        out.set(
            path.join('.'),
            node,
        )

        return
    }

    for (const [key, value] of Object.entries(node))
        flattenLeaves(
            value,
            [...path, key],
            out,
        )
}

const setPath = (
    target: Record<string, unknown>,
    path: string,
    value: unknown,
): void => {
    const segments = path.split('.')
    let cursor = target

    for (const segment of segments.slice(0, -1)) {
        if (!isPlainObject(cursor[segment]))
            cursor[segment] = {}

        cursor = cursor[segment] as Record<string, unknown>
    }

    cursor[segments.at(-1)!] = value
}

const getPath = (
    source: Record<string, unknown>,
    path: string,
): unknown => path.split('.').reduce<unknown>((cursor, segment) => (isPlainObject(cursor) ? cursor[segment] : undefined), source)

// A blank is a placeholder, not a value: it declares a field's shape and leaves the
// number to a source.
const isBlank = (value: unknown): boolean => value === ''
    || value === null

export class ModelMerger {
    constructor(private readonly schema: CatalogSchema) {}

    // A rate only transfers when both sides measure the same thing. Dollars per image
    // must never land in a field that means credits, which would be wrong by whatever
    // the two units differ by.
    private unitsAgree(
        path: string,
        lixpiLeaves: Map<string, unknown>,
        resolved: Map<string, unknown>,
    ): boolean {
        const bucket = path.split('.').slice(0, -1)
        const unitPath = [...bucket, 'measuringUnit'].join('.')
        const perPath = [...bucket, 'pricePer'].join('.')
        const lixpiUnit = lixpiLeaves.get(unitPath)
        const sourceUnit = resolved.get(unitPath)

        if (
            lixpiUnit === undefined
            || sourceUnit === undefined
        )
            return true

        return lixpiUnit === sourceUnit
            && lixpiLeaves.get(perPath) === resolved.get(perPath)
    }

    // One inference provider's own values, resolved from the sources that answered
    // for it. Nothing about the provider the platform happens to be calling enters
    // here, so every endpoint's rates survive the merge instead of the unused ones
    // being dropped.
    private resolveOneProvider(
        covered: SourceModelRecord[],
        inferenceProvider: InferenceProviderId,
        order: SourceId[],
        baseIndex: CatalogBaseIndex,
        isCalledByThePlatform: boolean,
    ): MergedInferenceProvider {
        const bySourcePerField = new Map<string, Map<SourceId, unknown>>()
        const reportedBySources: SourceId[] = []
        const modelKeyAtSource: Partial<Record<SourceId, string>> = {}
        let providerReportedFacts: Record<string, unknown> | undefined

        for (const record of covered) {
            const facts = record.byInferenceProvider[inferenceProvider]

            if (!facts)
                continue

            const sourceName = record._fetchedFrom.sourceName
            reportedBySources.push(sourceName)
            modelKeyAtSource[sourceName] = facts.modelKeyAtSource

            if (facts.sourceOnlyFacts) {
                providerReportedFacts = {
                    ...providerReportedFacts,
                    ...facts.sourceOnlyFacts,
                }
            }

            const {
                modelKeyAtSource: keyAtSource,
                sourceOnlyFacts,
                ...fields
            } = facts
            const leaves = new Map<string, unknown>()
            flattenLeaves(
                fields,
                [],
                leaves,
            )

            for (const [path, value] of leaves) {
                // Identity is the model's, not one endpoint's. It is resolved once at
                // the top level and repeating it here would suggest the endpoints
                // could disagree about which model this is.
                if (
                    path === 'model'
                    || path === 'modelVersion'
                )
                    continue

                const perSource = bySourcePerField.get(path) ?? new Map<SourceId, unknown>()

                if (!perSource.has(sourceName))
                    perSource.set(sourceName, value)

                bySourcePerField.set(path, perSource)
            }
        }

        // An endpoint nobody publishes for still gets an entry. Every provider that
        // can serve this model is listed whether or not a source covers it, so an
        // empty one reads as "nobody prices this here" instead of the endpoint
        // looking as though it does not exist.
        const values: Record<string, unknown> = {}

        for (const [path, perSource] of bySourcePerField) {
            // The same rule the top-level merge follows: for Bedrock, the AWS price
            // list is the bill and outranks an aggregator's copy of it.
            const winner = inferenceProvider === 'aws-bedrock'
                && path.startsWith('pricing')
                && perSource.has('bedrock')
                ? 'bedrock'
                : order.find(id => perSource.has(id))

            setPath(
                values,
                path,
                perSource.get(winner!),
            )
        }

        return {
            inferenceProviderTitle: baseIndex.titleOf(inferenceProvider),
            isCalledByThePlatform,
            reportedBySources,
            modelKeyAtSource,
            ...values,
            ...(providerReportedFacts && { providerReportedFacts }),
        }
    }

    merge(
        bundle: ModelBundle,
        index: ProviderCatalogIndex,
        baseIndex: CatalogBaseIndex,
    ): MergedModel {
        const {
            provider,
            modelId,
        } = bundle

        // Every inference provider this model can be reached through, and the one the
        // platform is calling today. The top-level fields describe that call; each
        // provider's own values are kept beside them, because a rate Lixpi is not
        // billing on today is still a fact about the model and the flag that switches
        // between them changes nothing about the others.
        const inferenceProviders = baseIndex.providersFor(provider)
        const activeProvider = baseIndex.calledByThePlatformFor(provider)

        // What each source said for the provider being called, per leaf path.
        const bySourcePerField = new Map<string, Map<string, unknown>>()
        const covered: SourceModelRecord[] = bundle.sources.filter(record => record._fetchedFrom.hasDataForThisModel)
        const sourcesOnAnotherRoute: SourceId[] = []

        for (const record of covered) {
            const activeFacts = record.byInferenceProvider[activeProvider]

            if (!activeFacts)
                sourcesOnAnotherRoute.push(record._fetchedFrom.sourceName)

            // Only rates differ per inference provider. A model's context window,
            // output ceiling, and name are the same whichever endpoint serves it, so
            // those merge from any provider the source knows. Taking everything from
            // the active one alone would throw away the vendor API's limits for a
            // model Lixpi calls through Bedrock.
            const claimed = new Set<string>()

            const collect = (
                facts: typeof activeFacts,
                pricingCountsToo: boolean,
            ): void => {
                if (!facts)
                    return

                // Neither the source's own key for the model nor the facts it reports
                // outside the model record are values to merge.
                const {
                    modelKeyAtSource,
                    sourceOnlyFacts,
                    ...fields
                } = facts
                const leaves = new Map<string, unknown>()
                flattenLeaves(
                    fields,
                    [],
                    leaves,
                )

                for (const [path, value] of leaves) {
                    if (
                        !pricingCountsToo
                        && path.startsWith('pricing')
                    )
                        continue

                    if (claimed.has(path))
                        continue

                    claimed.add(path)
                    const perSource = bySourcePerField.get(path) ?? new Map<string, unknown>()
                    perSource.set(record._fetchedFrom.sourceName, value)
                    bySourcePerField.set(path, perSource)
                }
            }

            collect(activeFacts, true)

            for (const inferenceProvider of inferenceProviders) {
                if (inferenceProvider === activeProvider)
                    continue

                collect(record.byInferenceProvider[inferenceProvider], false)
            }
        }

        // Precedence is the order the source files were written in, which is the order
        // the fetcher consulted them, with one exception. For AWS Bedrock the price
        // list is not another catalog's copy of a published rate, it is the line item
        // on the account's own bill, so it wins any pricing field it answers.
        // Everything else, including Bedrock's own limits and names, keeps the
        // ordinary order.
        const order = bundle.sources.map(record => record._fetchedFrom.sourceName)

        const winnerFor = (path: string): SourceId | undefined => {
            const perSource = bySourcePerField.get(path)

            if (!perSource)
                return undefined

            if (
                activeProvider === 'aws-bedrock'
                && path.startsWith('pricing')
                && perSource.has('bedrock')
            )
                return 'bedrock'

            return order.find(id => perSource.has(id))
        }

        const resolvedFromSources = new Map<string, unknown>()

        for (const [path, perSource] of bySourcePerField) {
            resolvedFromSources.set(
                path,
                perSource.get(winnerFor(path)!),
            )
        }

        const modelLeaves = new Map<string, unknown>()
        flattenLeaves(
            bundle.lixpi,
            [],
            modelLeaves,
        )

        const baseLeaves = new Map<string, unknown>()
        flattenLeaves(
            bundle.base?.fieldsInheritedByEveryModel ?? {},
            [],
            baseLeaves,
        )

        // The model's own file wins; the provider base fills what it leaves out.
        const lixpiLeaves = new Map<string, unknown>(baseLeaves)
        const inherited: string[] = []

        for (const [path, value] of baseLeaves) {
            const own = modelLeaves.get(path)

            if (
                own === undefined
                || isBlank(own)
            )
                inherited.push(path)
        }

        for (const [path, value] of modelLeaves) {
            if (
                isBlank(value)
                && baseLeaves.has(path)
            )
                continue

            lixpiLeaves.set(path, value)
        }

        const fields: Record<string, FieldProvenance> = {}
        const authored: string[] = []
        const overrides: string[] = []
        const conflicts: string[] = []
        const drift: DriftFinding[] = []
        const unitMismatches: string[] = []
        const values: Record<string, unknown> = {}

        // Who answered for a field and whether they agreed. Deliberately says nothing
        // about the values: those are in the merged file and in each source's file.
        const describe = (path: string): {
            agreement: Agreement
            answeredBy: SourceId[]
        } => {
            const perSource = bySourcePerField.get(path)

            if (!perSource)
                return {
                    agreement: 'only-one-source-answered',
                    answeredBy: [],
                }

            const distinct = new Set(
                [...perSource.values()].map(value => JSON.stringify(value)),
            )

            return {
                agreement: perSource.size === 1
                    ? 'only-one-source-answered'
                    : distinct.size === 1
                        ? 'all-sources-agree'
                        : 'sources-disagree',
                answeredBy: [...perSource.keys()] as SourceId[],
            }
        }

        const paths = new Set([
            ...lixpiLeaves.keys(),
            ...resolvedFromSources.keys(),
        ])

        for (const path of paths) {
            const lixpiValue = lixpiLeaves.get(path)
            const sourceValue = resolvedFromSources.get(path)
            const stated = lixpiLeaves.has(path) && !isBlank(lixpiValue)
            const {
                agreement,
                answeredBy,
            } = describe(path)

            if (agreement === 'sources-disagree')
                conflicts.push(path)

            const fromLixpi = inherited.includes(path)
                ? 'provider-base-file'
                : 'lixpi-authored-file'

            if (stated) {
                const overridesSource = sourceValue !== undefined
                    && JSON.stringify(sourceValue) !== JSON.stringify(lixpiValue)

                if (overridesSource)
                    overrides.push(path)
                else if (
                    sourceValue === undefined
                    && !inherited.includes(path)
                )
                    authored.push(path)

                if (overridesSource) {
                    drift.push({
                        provider,
                        modelId,
                        field: path,
                        lixpiValue,
                        fetchedValue: sourceValue,
                        source: agreement === 'sources-disagree'
                            ? `${winnerFor(path)} (sources differ)`
                            : String(winnerFor(path)),
                        isPricing: path.startsWith('pricing'),
                    })
                }

                fields[path] = {
                    valueCameFrom: fromLixpi,
                    sourceAgreement: agreement,
                    sourcesThatAnswered: answeredBy,
                    ...(overridesSource && { lixpiOverridesSource: true }),
                }
                setPath(
                    values,
                    path,
                    lixpiValue,
                )

                continue
            }

            if (sourceValue === undefined) {
                fields[path] = {
                    valueCameFrom: fromLixpi,
                    sourceAgreement: agreement,
                    sourcesThatAnswered: answeredBy,
                }
                setPath(
                    values,
                    path,
                    lixpiValue,
                )

                continue
            }

            const leafKey = path.split('.').at(-1)!

            if (
                RATE_KEYS.has(leafKey)
                && lixpiLeaves.has(path)
                && !this.unitsAgree(
                    path,
                    lixpiLeaves,
                    resolvedFromSources,
                )
            ) {
                unitMismatches.push(path)
                fields[path] = {
                    valueCameFrom: fromLixpi,
                    sourceAgreement: agreement,
                    sourcesThatAnswered: answeredBy,
                }
                setPath(
                    values,
                    path,
                    lixpiValue,
                )

                continue
            }

            fields[path] = {
                valueCameFrom: String(winnerFor(path)),
                sourceAgreement: agreement,
                sourcesThatAnswered: answeredBy,
            }
            setPath(
                values,
                path,
                sourceValue,
            )
        }

        // Identity. The catalog entry is named for the model family; the id to call
        // is the current version the provider publishes, which the provider-api
        // record resolves. Without one, the authored file decides, and failing that
        // the family name is the id.
        const providerApi = bundle.sources.find(record => record._fetchedFrom.sourceName === 'provider-api')
        const resolvedId = providerApi?._fetchedFrom.publishedVersions?.currentVersion
            ?? (typeof bundle.lixpi.model === 'string' ? bundle.lixpi.model : null)
            ?? modelId

        values.provider = PROVIDER_DIRECTORIES[provider]
        values.model = resolvedId
        values.modelVersion = resolvedId

        // Every endpoint this model can be reached through, whether or not the
        // platform is calling it today. The top-level fields describe the current
        // call; these say what the same model costs and allows everywhere else.
        const perProvider: Partial<Record<InferenceProviderId, MergedInferenceProvider>> = {}

        for (const inferenceProvider of inferenceProviders) {
            perProvider[inferenceProvider] = this.resolveOneProvider(
                covered,
                inferenceProvider,
                order,
                baseIndex,
                inferenceProvider === activeProvider,
            )
        }

        values.inferenceProviderCalledByThePlatform = activeProvider
        values.inferenceProviders = perProvider

        fields.provider = {
            valueCameFrom: 'derived-from-file-name',
            sourceAgreement: 'only-one-source-answered',
            sourcesThatAnswered: [],
        }

        for (const identity of ['model', 'modelVersion']) {
            fields[identity] = {
                valueCameFrom: providerApi?._fetchedFrom.publishedVersions
                    ? 'provider-api'
                    : 'lixpi-authored-file',
                sourceAgreement: 'only-one-source-answered',
                sourcesThatAnswered: providerApi?._fetchedFrom.publishedVersions ? ['provider-api'] : [],
            }
        }

        const modalities = Array.isArray(values.modalities)
            ? (values.modalities as Array<{ modality?: string }>).map(entry => entry.modality ?? '')
            : []
        const expected = this.schema.fieldsForModalities(modalities)
        const missingRequired: string[] = []
        const usedFallback: string[] = []

        for (const [name, field] of Object.entries(expected)) {
            const value = getPath(values, name)
            const empty = value === undefined
                || isBlank(value)
                || (Array.isArray(value) && value.length === 0)
                || (isPlainObject(value) && Object.keys(value).length === 0)

            if (!empty)
                continue

            if (field.defaultWhenNoSourceHasIt !== undefined) {
                setPath(
                    values,
                    name,
                    field.defaultWhenNoSourceHasIt,
                )

                // Only a source-owned field is worth reporting here. A Lixpi-owned
                // field with a standing default is not a gap in anyone's data.
                if (field.ownedBy === 'source')
                    usedFallback.push(name)

                continue
            }

            missingRequired.push(name)
        }

        const excluded = !index.includes(modelId)
        const status: MergeStatus = excluded
            ? 'skipped-by-catalog-index'
            : missingRequired.length > 0
                ? 'missing-required-fields'
                : 'written-to-database'

        const sourcesQueried = bundle.sources.map(record => record._fetchedFrom.sourceName)
        const sourcesWithData = covered.map(record => record._fetchedFrom.sourceName)

        const file: MergedModelFile = values as MergedModelFile

        const meta: ModelMetaFile = {
            modelFamily: familyId(modelId),
            mergedAt: new Date().toISOString(),
            baseSchemaVersion: this.schema.version,
            syncStatus: status,
            sources: {
                sourcesQueried,
                sourcesWithDataForThisModel: sourcesWithData,
                inferenceProviderCalledByThePlatform: activeProvider,
                sourcesWithoutRatesForThatProvider: sourcesOnAnotherRoute,
                confirmedByMoreThanOneSource: sourcesWithData.length > 1,
                fieldsWhereSourcesDisagree: conflicts,
            },
            lixpi: {
                fieldsOnlyLixpiSupplies: authored.sort(),
                fieldsWhereLixpiOverridesSources: overrides.sort(),
                fieldsInheritedFromProviderBaseFile: inherited.sort(),
            },
            requiredFieldsStillMissing: missingRequired,
            fieldsFilledFromSchemaDefault: usedFallback,
            ratesRefusedBecauseUnitsDiffer: unitMismatches,
            fieldOrigins: fields,
            ...(excluded && { note: `Skipped by _catalog-index.json: ${index.reasonFor(modelId)}` }),
            ...(status === 'missing-required-fields' && { note: 'Not written to the database: its authored fields are not filled in yet.' }),
            ...(sourcesWithData.length === 0 && { note: 'No source has data for this model. Every field comes from the authored file.' }),
        }

        // Only a complete, included model becomes an AiModel. Anything else stays a
        // file on disk with its meta saying why.
        let model: AiModel | null = null

        if (status === 'written-to-database') {
            const now = Date.now()
            model = validateModel({
                ...values,
                createdAt: now,
                updatedAt: now,
            } as unknown as AiModel)
        }

        return {
            provider,
            modelId,
            file,
            meta,
            model,
            drift,
        }
    }
}
