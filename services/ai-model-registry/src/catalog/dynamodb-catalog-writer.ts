import process from 'node:process'

import DynamoDBService from '@lixpi/dynamodb-service'
import {
    err,
    info,
} from '@lixpi/debug-tools'
import {
    getDynamoDbTableStageName,
    type AiModel,
} from '@lixpi/constants'

export type CatalogWriteResult = {
    processed: number
    newModels: number
    updatedModels: number
    deletedModels: number
}

// Writes the merged catalog to the AI_MODELS_LIST table, which is where the API
// reads models from. The table is keyed by provider and model, so a provider's rows
// are replaced as a set: anything present in the table but absent from the catalog
// is deleted.
export class DynamoDbCatalogWriter {
    private readonly dynamoDBService: DynamoDBService
    private readonly tableName: string
    private readonly origin = 'Service::ai-model-registry'

    constructor(dynamoDBService?: DynamoDBService) {
        const env = process.env

        this.dynamoDBService = dynamoDBService ?? new DynamoDBService({
            region: env.AWS_REGION,
            ssoProfile: env.AWS_PROFILE,
            // Local DynamoDB only. The service supplies its own static credentials
            // when an endpoint is set, so no SSO session is needed to run this
            // against the compose stack.
            ...(env.DYNAMODB_ENDPOINT && { endpoint: env.DYNAMODB_ENDPOINT }),
        })

        this.tableName = getDynamoDbTableStageName(
            'AI_MODELS_LIST',
            env.ORG_NAME!,
            env.STAGE!,
        )
    }

    private async readExisting(provider: string): Promise<AiModel[]> {
        const result = await this.dynamoDBService.queryItems({
            tableName: this.tableName,
            keyConditions: { provider },
            fetchAllItems: true,
            origin: this.origin,
        })

        return (result?.items ?? []) as AiModel[]
    }

    // Updates go one at a time so a single rejected item cannot fail a batch that
    // also carries good rows.
    private async updateAll(models: AiModel[]): Promise<void> {
        for (const model of models) {
            await this.dynamoDBService.putItem({
                tableName: this.tableName,
                item: model,
                origin: this.origin,
            })
        }
    }

    private async deleteAll(models: AiModel[]): Promise<void> {
        for (const model of models) {
            await this.dynamoDBService.deleteItems({
                tableName: this.tableName,
                key: {
                    provider: model.provider,
                    model: model.model,
                },
                origin: this.origin,
            })
        }
    }

    async writeProvider(
        provider: string,
        models: AiModel[],
    ): Promise<CatalogWriteResult> {
        const existing = await this.readExisting(provider)
        const existingIds = new Set(
            existing.map(model => model.model),
        )
        const catalogIds = new Set(
            models.map(model => model.model),
        )

        const newModels = models.filter(model => !existingIds.has(model.model))
        const updatedModels = models.filter(model => existingIds.has(model.model))
        const deletedModels = existing.filter(model => !catalogIds.has(model.model))

        try {
            await this.deleteAll(deletedModels)

            if (newModels.length > 0)
                await this.dynamoDBService.batchWriteItems({
                    tableName: this.tableName,
                    items: newModels,
                    origin: this.origin,
                })

            await this.updateAll(updatedModels)
        } catch (error) {
            err(`Failed to write ${provider} catalog to DynamoDB:`, error)

            throw error
        }

        info(`${provider}: ${newModels.length} new, ${updatedModels.length} updated, ${deletedModels.length} deleted`)

        return {
            processed: models.length,
            newModels: newModels.length,
            updatedModels: updatedModels.length,
            deletedModels: deletedModels.length,
        }
    }
}
