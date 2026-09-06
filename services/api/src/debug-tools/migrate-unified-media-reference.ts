import process from 'node:process'

import DynamoDBService from '@lixpi/dynamodb-service'

const requireEnv = (name: string): string => {
    const value = process.env[name]

    if (!value)
        throw new Error(`Missing required env var ${name}`)

    return value
}

const createDynamoDbService = (): DynamoDBService => {
    const endpoint = process.env.DYNAMODB_ENDPOINT

    return new DynamoDBService({
        region: requireEnv('AWS_REGION'),
        ssoProfile: process.env.AWS_PROFILE ?? '',
        ...(endpoint ? { endpoint } : {}),
    })
}

const main = async (): Promise<void> => {
    ;(globalThis as Record<string, unknown>).dynamoDBService = createDynamoDbService()
    const { UnifiedMediaReferenceMigration } = await import('../migrations/unified-media-reference-migration.ts')
    const migration = new UnifiedMediaReferenceMigration()
    const preflight = await migration.audit()
    process.stdout.write(`${JSON.stringify(
        {
            phase: 'preflight',
            ...preflight,
        },
        null,
        2,
    )}\n`)

    if (!process.argv.includes('--apply'))
        return

    if (preflight.quarantined.length > 0)
        throw new Error('Migration has quarantined records; repair them before applying.')

    const result = await migration.run()
    const postflight = await migration.audit()
    process.stdout.write(`${JSON.stringify(
        {
            phase: 'applied',
            ...result,
            postflight,
        },
        null,
        2,
    )}\n`)

    if (
        postflight.legacyAssetIds.length > 0
        || postflight.legacyWorkspaceIds.length > 0
        || postflight.quarantined.length > 0
    )
        throw new Error('UNIFIED_MEDIA_REFERENCE_MIGRATION_POSTFLIGHT_FAILED')
}

await main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
})
