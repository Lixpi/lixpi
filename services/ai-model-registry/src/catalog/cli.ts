import process from 'node:process'

import {
    err,
    info,
} from '@lixpi/debug-tools'

import { CatalogSync } from './catalog-sync.ts'
import { CredentialsExpiredError } from './sources/credentials-error.ts'

// Manual sync entry point, run inside the container:
//   node --experimental-transform-types ./src/catalog/cli.ts [--no-fetch] [--no-write]
//
// The flags exist so a run can validate the merged catalog without touching either
// the fetched files or DynamoDB.
const args = new Set(
    process.argv.slice(2),
)

const sync = new CatalogSync({
    catalogDir: process.env.MODEL_CATALOG_DIR ?? '/usr/src/service/data/model-catalog',
    writeCatalogFiles: !args.has('--no-fetch'),
    writeDynamoDb: !args.has('--no-write'),
})

try {
    const result = await sync.run()
    info(
        JSON.stringify(
            {
                ranAt: result.ranAt,
                models: result.models,
                included: result.included,
                incomplete: result.incomplete.length,
                excluded: result.excluded.length,
                drift: {
                    pricing: result.drift.pricing.length,
                    other: result.drift.other.length,
                },
                totalNew: result.totalNew,
                totalUpdated: result.totalUpdated,
                totalDeleted: result.totalDeleted,
            },
            null,
            4,
        ),
    )
} catch (error) {
    if (error instanceof CredentialsExpiredError) {
        err(`Catalog sync stopped. ${error.message}`)
        process.exitCode = 2
    } else {
        err('Catalog sync failed:', error)
        process.exitCode = 1
    }
}
