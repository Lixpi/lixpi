import {
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    unlink,
    writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

import { err as debugError } from '@lixpi/debug-tools'

import { VersionedJsonStore } from '../versioned-json-store.ts'

import {
    BASE_FILE,
    INDEX_FILE,
    LIXPI_FILE,
    MERGED_FILE,
    META_FILE,
    PROVIDER_DIRECTORIES,
    SOURCE_FILE_NAMES,
    SOURCE_PRECEDENCE,
    type LixpiModelRecord,
    type MergedModelFile,
    type ModelBundle,
    type ModelMetaFile,
    type ProviderBase,
    type ProviderDirectory,
    type SourceId,
    type SourceModelRecord,
} from './types.ts'

// Reads and writes the model-catalog tree. Each model owns a directory, so
// everything about it sits together and a model can be added or removed as a unit.
//
// It writes the per-source files, the merged file, and the meta file. A model's
// `lixpi.json` is only ever created, never modified: a model discovered on a
// provider gets an empty scaffold, and after that the file belongs to whoever is
// filling it in.
export class ModelCatalogStore {
    private readonly versioned: VersionedJsonStore

    constructor(readonly rootDir: string) {
        this.versioned = new VersionedJsonStore(
            rootDir,
            join(
                rootDir,
                '..',
                'history',
            ),
            'model-catalog-',
        )
    }

    providerDir(provider: ProviderDirectory): string {
        return join(this.rootDir, provider)
    }

    modelDir(
        provider: ProviderDirectory,
        modelId: string,
    ): string {
        return join(
            this.providerDir(provider),
            modelId,
        )
    }

    private modelPath(
        provider: ProviderDirectory,
        modelId: string,
        fileName: string,
    ): string {
        return join(
            this.modelDir(provider, modelId),
            fileName,
        )
    }

    listProviders(): ProviderDirectory[] {
        return Object.keys(PROVIDER_DIRECTORIES) as ProviderDirectory[]
    }

    // A model belongs to the tree once it has a directory holding a lixpi.json,
    // scaffolded or filled.
    async listModels(provider: ProviderDirectory): Promise<string[]> {
        try {
            const entries = await readdir(
                this.providerDir(provider),
                { withFileTypes: true },
            )
            const models: string[] = []

            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue

                const record = await this.readJson<LixpiModelRecord>(
                    this.modelPath(
                        provider,
                        entry.name,
                        LIXPI_FILE,
                    ),
                )

                if (record)
                    models.push(entry.name)
            }

            return models.sort()
        } catch {
            return []
        }
    }

    private async readJson<T>(path: string): Promise<T | null> {
        try {
            return JSON.parse(await readFile(path, 'utf8')) as T
        } catch {
            return null
        }
    }

    // Written through a temp file and a rename so an interrupted run never leaves a
    // half-written model behind.
    private async writeJson(
        path: string,
        content: unknown,
    ): Promise<void> {
        const temp = `${path}.tmp`

        await writeFile(
            temp,
            `${JSON.stringify(
                content,
                null,
                4,
            )}\n`,
            'utf8',
        )

        try {
            await rename(temp, path)
        } catch (error) {
            debugError(`Failed to write ${path}:`, error)
            await unlink(temp).catch(() => undefined)

            throw error
        }
    }

    async hasLixpiRecord(
        provider: ProviderDirectory,
        modelId: string,
    ): Promise<boolean> {
        const record = await this.readJson<LixpiModelRecord>(
            this.modelPath(
                provider,
                modelId,
                LIXPI_FILE,
            ),
        )

        return record !== null
    }

    // Only ever creates. An existing authored file is left exactly as it is.
    async createLixpiRecordIfMissing(
        provider: ProviderDirectory,
        modelId: string,
        scaffold: LixpiModelRecord,
    ): Promise<boolean> {
        if (await this.hasLixpiRecord(provider, modelId))
            return false

        await mkdir(
            this.modelDir(provider, modelId),
            { recursive: true },
        )
        await this.writeJson(
            this.modelPath(
                provider,
                modelId,
                LIXPI_FILE,
            ),
            scaffold,
        )

        return true
    }

    async readLixpiRecord(
        provider: ProviderDirectory,
        modelId: string,
    ): Promise<LixpiModelRecord> {
        return await this.readJson<LixpiModelRecord>(
            this.modelPath(
                provider,
                modelId,
                LIXPI_FILE,
            ),
        ) ?? {}
    }

    async writeSourceRecord(
        provider: ProviderDirectory,
        modelId: string,
        source: SourceId,
        record: SourceModelRecord,
    ): Promise<void> {
        await mkdir(
            this.modelDir(provider, modelId),
            { recursive: true },
        )
        await this.writeJson(
            this.modelPath(
                provider,
                modelId,
                SOURCE_FILE_NAMES[source],
            ),
            record,
        )
    }

    // Returned in precedence order, so whoever merges them does not have to know the
    // file naming to get the priority right.
    async readSourceRecords(
        provider: ProviderDirectory,
        modelId: string,
    ): Promise<SourceModelRecord[]> {
        const records: SourceModelRecord[] = []

        for (const source of SOURCE_PRECEDENCE) {
            const record = await this.readJson<SourceModelRecord>(
                this.modelPath(
                    provider,
                    modelId,
                    SOURCE_FILE_NAMES[source],
                ),
            )

            if (record)
                records.push(record)
        }

        return records
    }

    async readProviderBase(provider: ProviderDirectory): Promise<ProviderBase | null> {
        return await this.readJson<ProviderBase>(
            join(
                this.providerDir(provider),
                BASE_FILE,
            ),
        )
    }

    async writeMergedRecord(
        provider: ProviderDirectory,
        modelId: string,
        record: MergedModelFile,
    ): Promise<void> {
        await this.writeJson(
            this.modelPath(
                provider,
                modelId,
                MERGED_FILE,
            ),
            record,
        )
    }

    async writeMetaRecord(
        provider: ProviderDirectory,
        modelId: string,
        record: ModelMetaFile,
    ): Promise<void> {
        await this.writeJson(
            this.modelPath(
                provider,
                modelId,
                META_FILE,
            ),
            record,
        )
    }

    async loadBundle(
        provider: ProviderDirectory,
        modelId: string,
    ): Promise<ModelBundle> {
        return {
            provider,
            modelId,
            base: await this.readProviderBase(provider),
            lixpi: await this.readLixpiRecord(provider, modelId),
            sources: await this.readSourceRecords(provider, modelId),
        }
    }

    // Removes a model from the catalog: its directory and everything in it, the
    // authored file included. Everything is copied into history/ first, because the
    // authored file is hand-written work and a model can be un-skipped later.
    async removeModel(
        provider: ProviderDirectory,
        modelId: string,
    ): Promise<string | null> {
        if (
            modelId === INDEX_FILE
            || modelId === BASE_FILE
        )
            return null

        const dir = this.modelDir(provider, modelId)
        let files: string[] = []

        try {
            files = (await readdir(dir)).map(file => join(dir, file))
        } catch {
            return null
        }

        const snapshotDir = await this.versioned.snapshot(files)

        await rm(
            dir,
            {
                recursive: true,
                force: true,
            },
        )

        return snapshotDir
    }
}
