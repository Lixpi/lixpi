// Talks to the registry's model-catalog endpoints and writes what comes back
// into the store. Every mutation goes through the same server API that guards
// the tree: nothing here edits a catalog file directly, and every write is
// followed by a reload so the page shows what the tree now holds.

import { LoadingStatus } from '@lixpi/constants'

import { modelCatalogStore } from '$src/stores/modelCatalogStore.ts'

import {
    type CatalogOverview,
    type ConfigPatchResult,
    type ProviderDirectory,
} from '$src/views/modelCatalog/types.ts'

export type CatalogIndexPatch = {
    syncMode?: 'all' | 'onlyListed'
    skipModels?: Array<{
        model: string
        reason: string
    }>
    unskipModels?: string[]
    syncModels?: string[]
    unsyncModels?: string[]
}

const readError = async (response: Response): Promise<string> => {
    try {
        const body = await response.json() as {
            error?: string
            detail?: string
        }

        return body.detail ?? body.error ?? `Request failed with ${response.status}`
    } catch {
        return `Request failed with ${response.status}`
    }
}

class ModelCatalogService {
    private static instance: ModelCatalogService | null

    static getInstance(): ModelCatalogService {
        return ModelCatalogService.instance ?? (ModelCatalogService.instance = new ModelCatalogService())
    }

    async load(): Promise<void> {
        modelCatalogStore.setMetaValues({
            loadingStatus: LoadingStatus.loading,
            error: null,
        })

        try {
            const response = await fetch('/api/model-catalog/overview')

            if (!response.ok)
                throw new Error(
                    await readError(response),
                )

            const overview = await response.json() as CatalogOverview
            modelCatalogStore.setDataValues({ overview })
            modelCatalogStore.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error: unknown) {
            modelCatalogStore.setMetaValues({
                loadingStatus: LoadingStatus.error,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    // Merges fields into a model's authored file. A null value removes a field,
    // which is the server's contract, so the caller never resends a whole record.
    async patchModelFields(
        provider: ProviderDirectory,
        modelId: string,
        fields: Record<string, unknown>,
    ): Promise<boolean> {
        return await this.write(
            `/api/model-catalog/${provider}/models/${encodeURIComponent(modelId)}/lixpi`,
            { fields },
        )
    }

    async patchCatalogIndex(
        provider: ProviderDirectory,
        patch: CatalogIndexPatch,
    ): Promise<boolean> {
        return await this.write(
            `/api/model-catalog/${provider}/catalog-index`,
            patch,
        )
    }

    async patchProviderBase(
        provider: ProviderDirectory,
        fieldsInheritedByEveryModel: Record<string, unknown>,
    ): Promise<boolean> {
        return await this.write(
            `/api/model-catalog/${provider}/base`,
            { fieldsInheritedByEveryModel },
        )
    }

    // Runs a sync in the service. It is off unless the deployment turned it on,
    // and the server says so with a 409 the page reports as it stands.
    async runSync(): Promise<boolean> {
        modelCatalogStore.setMetaValues({
            saving: true,
            lastSaveMessage: null,
        })

        try {
            const response = await fetch(
                '/api/models/sync',
                { method: 'POST' },
            )

            if (!response.ok)
                throw new Error(
                    await readError(response),
                )

            modelCatalogStore.setMetaValues({ lastSaveMessage: 'Sync finished' })
            await this.load()

            return true
        } catch (error: unknown) {
            modelCatalogStore.setMetaValues({
                lastSaveMessage: error instanceof Error ? error.message : String(error),
            })

            return false
        } finally {
            modelCatalogStore.setMetaValues({ saving: false })
        }
    }

    private async write(
        url: string,
        body: unknown,
    ): Promise<boolean> {
        modelCatalogStore.setMetaValues({
            saving: true,
            lastSaveMessage: null,
        })

        try {
            const response = await fetch(
                url,
                {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(body),
                },
            )

            if (!response.ok)
                throw new Error(
                    await readError(response),
                )

            const result = await response.json() as ConfigPatchResult
            modelCatalogStore.setMetaValues({
                lastSaveMessage: result.changed
                    ? `Saved: ${result.applied.join(', ')}`
                    : 'Nothing changed',
            })
            await this.load()

            return true
        } catch (error: unknown) {
            modelCatalogStore.setMetaValues({
                lastSaveMessage: error instanceof Error ? error.message : String(error),
            })

            return false
        } finally {
            modelCatalogStore.setMetaValues({ saving: false })
        }
    }
}

export const modelCatalogService = ModelCatalogService.getInstance()
