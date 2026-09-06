import { join } from 'node:path'

import {
    BASE_FILE,
    BASE_INDEX_FILE,
    INDEX_FILE,
    LIXPI_FILE,
    PROVIDER_DIRECTORIES,
    type CatalogBaseIndexFile,
    type CatalogIndex,
    type LixpiModelRecord,
    type ProviderBase,
    type ProviderDirectory,
} from './types.ts'
import {
    VersionedJsonStore,
    type VersionedEdit,
} from '../versioned-json-store.ts'

// The only supported way to change a model-catalog config file. Direct edits are not
// how these are maintained: every change goes through here so it is validated
// against what the catalog actually holds and the previous version is kept, the same
// way parameter edits already work.
//
// Operations are declarative and additive rather than a whole-file replacement, so a
// caller cannot silently drop a field it did not know about.
export type CatalogIndexPatch = {
    syncMode?: CatalogIndex['syncMode']
    // Models to start skipping, with the reason recorded against each one.
    skipModels?: Array<{
        model: string
        reason: string
    }>
    // Models to stop skipping.
    unskipModels?: string[]
    // Models to add to the explicit sync list, which only applies in onlyListed mode.
    syncModels?: string[]
    unsyncModels?: string[]
}

// A model's authored file. Fields are merged rather than replaced, and a null
// removes one, so a caller never has to resend the whole record to change a field.
export type ModelRecordPatch = {
    fields: Record<string, unknown>
}

export type ProviderBasePatch = {
    // Fields every model in the directory inherits. A null value removes one.
    fieldsInheritedByEveryModel?: Record<string, unknown>
}

export type ConfigPatchResult = {
    provider: string
    file: string
    changed: boolean
    // What the operation actually did, so a caller can see a no-op for what it is.
    applied: string[]
    previousVersionKeptIn: string | null
}

export type ConfigPatchError = {
    error: string
    detail: string
    hint?: string
}

const isProviderDirectory = (value: string): value is ProviderDirectory => Object.hasOwn(PROVIDER_DIRECTORIES, value)

export class CatalogConfigApi {
    private readonly store: VersionedJsonStore

    constructor(
        private readonly rootDir: string,
        historyDir: string,
    ) {
        this.store = new VersionedJsonStore(
            rootDir,
            historyDir,
            'model-catalog-',
        )
    }

    providers(): ProviderDirectory[] {
        return Object.keys(PROVIDER_DIRECTORIES) as ProviderDirectory[]
    }

    resolveProvider(value: string): ProviderDirectory | null {
        return isProviderDirectory(value) ? value : null
    }

    private path(
        provider: ProviderDirectory,
        file: string,
    ): string {
        return join(
            this.rootDir,
            provider,
            file,
        )
    }

    private modelPath(
        provider: ProviderDirectory,
        modelId: string,
    ): string {
        return join(
            this.rootDir,
            provider,
            modelId,
            LIXPI_FILE,
        )
    }

    async readIndex(provider: ProviderDirectory): Promise<CatalogIndex | null> {
        return await this.store.read<CatalogIndex>(
            this.path(provider, INDEX_FILE),
        )
    }

    async readBase(provider: ProviderDirectory): Promise<ProviderBase | null> {
        return await this.store.read<ProviderBase>(
            this.path(provider, BASE_FILE),
        )
    }

    // The catalog-wide settings, which today are the inference providers. Served with
    // the overview so the page can name an endpoint rather than print its id.
    async readBaseIndex(): Promise<CatalogBaseIndexFile | null> {
        return await this.store.read<CatalogBaseIndexFile>(
            join(this.rootDir, BASE_INDEX_FILE),
        )
    }

    // Model ids the patch names that the catalog has never heard of. Skipping a model
    // that does not exist is almost always a typo, so it is refused rather than
    // written into a file where it would sit unnoticed forever.
    private unknownModels(
        named: string[],
        known: Set<string>,
    ): string[] {
        return named.filter(model => !known.has(model))
    }

    async patchIndex(
        provider: ProviderDirectory,
        patch: CatalogIndexPatch,
        knownModels: Set<string>,
    ): Promise<ConfigPatchResult | ConfigPatchError> {
        const current = await this.readIndex(provider)

        if (!current)
            return {
                error: 'NO_CATALOG_INDEX',
                detail: `${provider} has no ${INDEX_FILE}.`,
            }

        const named = [
            ...(patch.skipModels ?? []).map(entry => entry.model),
            ...(patch.syncModels ?? []),
        ]
        const unknown = this.unknownModels(named, knownModels)

        if (unknown.length > 0)
            return {
                error: 'UNKNOWN_MODEL',
                detail: `Not in the ${provider} catalog: ${unknown.join(', ')}`,
                hint: 'Only a model the catalog already holds can be listed. Check the id against the directory names under this provider.',
            }

        const next: CatalogIndex = {
            ...current,
            modelsToSkip: current.modelsToSkip.map(entry => ({ ...entry })),
            modelsToSync: [...current.modelsToSync],
        }
        const applied: string[] = []

        if (
            patch.syncMode
            && patch.syncMode !== current.syncMode
        ) {
            next.syncMode = patch.syncMode
            applied.push(`syncMode set to ${patch.syncMode}`)
        }

        for (const entry of patch.skipModels ?? []) {
            const existing = next.modelsToSkip.find(skipped => skipped.model === entry.model)

            if (existing) {
                if (existing.reason !== entry.reason) {
                    existing.reason = entry.reason
                    applied.push(`reason for skipping ${entry.model} updated`)
                }

                continue
            }

            next.modelsToSkip.push({
                model: entry.model,
                reason: entry.reason,
            })
            applied.push(`skipping ${entry.model}`)
        }

        for (const model of patch.unskipModels ?? []) {
            if (!next.modelsToSkip.some(entry => entry.model === model))
                continue

            next.modelsToSkip = next.modelsToSkip.filter(entry => entry.model !== model)
            applied.push(`no longer skipping ${model}`)
        }

        for (const model of patch.syncModels ?? []) {
            if (next.modelsToSync.includes(model))
                continue

            next.modelsToSync.push(model)
            applied.push(`added ${model} to modelsToSync`)
        }

        for (const model of patch.unsyncModels ?? []) {
            if (!next.modelsToSync.includes(model))
                continue

            next.modelsToSync = next.modelsToSync.filter(entry => entry !== model)
            applied.push(`removed ${model} from modelsToSync`)
        }

        next.modelsToSkip.sort((left, right) => left.model.localeCompare(right.model))
        next.modelsToSync.sort()

        return await this.commit(
            provider,
            INDEX_FILE,
            current,
            next,
            applied,
        )
    }

    async readModel(
        provider: ProviderDirectory,
        modelId: string,
    ): Promise<LixpiModelRecord | null> {
        return await this.store.read<LixpiModelRecord>(
            this.modelPath(provider, modelId),
        )
    }

    async patchModel(
        provider: ProviderDirectory,
        modelId: string,
        patch: ModelRecordPatch,
        knownModels: Set<string>,
    ): Promise<ConfigPatchResult | ConfigPatchError> {
        if (!knownModels.has(modelId))
            return {
                error: 'UNKNOWN_MODEL',
                detail: `Not in the ${provider} catalog: ${modelId}`,
                hint: 'A model is created by the sync discovering it, not by this endpoint. Check the id against the directory names under this provider.',
            }

        const current = await this.readModel(provider, modelId)

        if (!current)
            return {
                error: 'NO_AUTHORED_FILE',
                detail: `${provider}/${modelId} has no ${LIXPI_FILE}.`,
            }

        const next: LixpiModelRecord = { ...current }
        const applied: string[] = []

        for (const [field, value] of Object.entries(patch.fields ?? {})) {
            if (value === null) {
                if (!(field in next))
                    continue

                delete (next as Record<string, unknown>)[field]
                applied.push(`removed ${field}`)

                continue
            }

            if (JSON.stringify((next as Record<string, unknown>)[field]) === JSON.stringify(value))
                continue

            ;

            (next as Record<string, unknown>)[field] = value
            applied.push(`set ${field}`)
        }

        return await this.commit(
            provider,
            `${modelId}/${LIXPI_FILE}`,
            current,
            next,
            applied,
            this.modelPath(provider, modelId),
        )
    }

    async patchBase(
        provider: ProviderDirectory,
        patch: ProviderBasePatch,
    ): Promise<ConfigPatchResult | ConfigPatchError> {
        const current = await this.readBase(provider)

        if (!current)
            return {
                error: 'NO_PROVIDER_BASE',
                detail: `${provider} has no ${BASE_FILE}.`,
            }

        const next: ProviderBase = {
            ...current,
            fieldsInheritedByEveryModel: { ...current.fieldsInheritedByEveryModel },
        }
        const applied: string[] = []

        for (const [field, value] of Object.entries(patch.fieldsInheritedByEveryModel ?? {})) {
            if (value === null) {
                if (!(field in next.fieldsInheritedByEveryModel))
                    continue

                delete next.fieldsInheritedByEveryModel[field]
                applied.push(`stopped inheriting ${field}`)

                continue
            }

            if (JSON.stringify(next.fieldsInheritedByEveryModel[field]) === JSON.stringify(value))
                continue

            next.fieldsInheritedByEveryModel[field] = value
            applied.push(`inherited ${field} set`)
        }

        return await this.commit(
            provider,
            BASE_FILE,
            current,
            next,
            applied,
        )
    }

    private async commit(
        provider: ProviderDirectory,
        file: string,
        current: unknown,
        next: unknown,
        applied: string[],
        path?: string,
    ): Promise<ConfigPatchResult> {
        if (JSON.stringify(current) === JSON.stringify(next))
            return {
                provider: PROVIDER_DIRECTORIES[provider],
                file,
                changed: false,
                applied: [],
                previousVersionKeptIn: null,
            }

        const edit: VersionedEdit = {
            path: path ?? this.path(provider, file),
            content: next,
        }
        const { snapshotDir } = await this.store.writeMany([edit])

        return {
            provider: PROVIDER_DIRECTORIES[provider],
            file,
            changed: true,
            applied,
            previousVersionKeptIn: snapshotDir,
        }
    }
}
