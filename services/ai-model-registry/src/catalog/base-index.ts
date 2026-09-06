import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import {
    BASE_INDEX_FILE,
    type CatalogBaseIndexFile,
    type InferenceProviderEntry,
    type InferenceProviderId,
    type ProviderDirectory,
} from './types.ts'

// `_base-index.json` holds what is true for the whole catalog rather than for one
// directory or one model. Today that is the inference providers: which endpoints
// Lixpi can call, which catalog directories each of them serves, and which
// environment flag hands a directory to a platform provider.
//
// Keeping the list here rather than in code is what lets a model file carry a value
// per inference provider without any of them being special. The merge asks this
// which providers a model can be reached through, records every one of them, and
// separately asks which is being called today.
export class CatalogBaseIndex {
    private constructor(private readonly file: CatalogBaseIndexFile) {}

    static async load(rootDir: string): Promise<CatalogBaseIndex> {
        const raw = await readFile(
            join(rootDir, BASE_INDEX_FILE),
            'utf8',
        )

        return new CatalogBaseIndex(JSON.parse(raw) as CatalogBaseIndexFile)
    }

    private get entries(): Array<[InferenceProviderId, InferenceProviderEntry]> {
        return Object.entries(this.file.inferenceProviders) as Array<[InferenceProviderId, InferenceProviderEntry]>
    }

    allProviders(): InferenceProviderId[] {
        return this.entries.map(([id]) => id)
    }

    titleOf(provider: InferenceProviderId): string {
        return this.file.inferenceProviders[provider]?.title ?? provider
    }

    // Every inference provider that can reach a model in this directory, vendor API
    // first. This is the full set a model file carries values for; whether a
    // particular provider has any is a question for the sources.
    providersFor(directory: ProviderDirectory): InferenceProviderId[] {
        return this.entries
            .filter(([, entry]) => entry.servesCatalogDirectories.includes(directory))
            .sort(([, left], [, right]) => Number(left.kind !== 'vendor-api') - Number(right.kind !== 'vendor-api'))
            .map(([id]) => id)
    }

    // The name a platform provider lists a directory's models under, when it uses one
    // of its own. Bedrock files Stability's models under "Stability AI".
    listedUnderProviderName(provider: InferenceProviderId): Partial<Record<ProviderDirectory, string>> {
        return this.file.inferenceProviders[provider]?.listedUnderProviderName ?? {}
    }

    // The vendor's own API, which is the id matching the directory name.
    vendorApiFor(directory: ProviderDirectory): InferenceProviderId {
        const found = this.entries.find(([, entry]) => entry.kind === 'vendor-api'
            && entry.servesCatalogDirectories.includes(directory))

        if (!found)
            throw new Error(`NO_VENDOR_API_INFERENCE_PROVIDER:${directory}`)

        return found[0]
    }

    // Which provider the platform is calling for this directory. A platform provider
    // takes over when the flag it names is true, and it reads the same flags the
    // API's provider adapters read, so the catalog is priced the way the calls are
    // actually made.
    calledByThePlatformFor(directory: ProviderDirectory): InferenceProviderId {
        for (const [id, entry] of this.entries) {
            const flag = entry.selectedForDirectoryWhenEnvFlagIsTrue?.[directory]

            if (
                flag
                && process.env[flag]?.trim().toLowerCase() === 'true'
            )
                return id
        }

        return this.vendorApiFor(directory)
    }
}
