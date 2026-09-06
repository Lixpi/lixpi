import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { warn } from '@lixpi/debug-tools'

import {
    INDEX_FILE,
    PROVIDER_DIRECTORIES,
    type CatalogIndex,
    type ProviderDirectory,
} from './types.ts'

// _catalog-index.json decides which of a provider's models the catalog syncs.
// Discovery is separate: the sources report what exists, and this file says what to
// do about it. A provider with no index syncs everything it discovers.
export class ProviderCatalogIndex {
    private constructor(
        readonly provider: ProviderDirectory,
        private readonly index: CatalogIndex,
    ) {}

    static async load(
        rootDir: string,
        provider: ProviderDirectory,
    ): Promise<ProviderCatalogIndex> {
        const path = join(
            rootDir,
            provider,
            INDEX_FILE,
        )

        try {
            const raw = await readFile(path, 'utf8')

            return new ProviderCatalogIndex(provider, JSON.parse(raw) as CatalogIndex)
        } catch {
            warn(`No ${INDEX_FILE} for ${provider}; syncing every discovered model`)

            return new ProviderCatalogIndex(
                provider,
                {
                    providerKey: PROVIDER_DIRECTORIES[provider],
                    syncMode: 'all',
                    modelsToSync: [],
                    modelsToSkip: [],
                },
            )
        }
    }

    get syncMode(): CatalogIndex['syncMode'] {
        return this.index.syncMode
    }

    includes(modelId: string): boolean {
        if (this.index.modelsToSkip.some(entry => entry.model === modelId))
            return false

        if (this.index.syncMode === 'onlyListed')
            return this.index.modelsToSync.includes(modelId)

        return true
    }

    reasonFor(modelId: string): string | null {
        const skipped = this.index.modelsToSkip.find(entry => entry.model === modelId)

        if (skipped)
            return skipped.reason

        if (
            this.index.syncMode === 'onlyListed'
            && !this.index.modelsToSync.includes(modelId)
        )
            return 'not listed in modelsToSync'

        return null
    }
}
