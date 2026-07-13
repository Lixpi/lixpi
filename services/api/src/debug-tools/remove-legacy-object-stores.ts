'use strict'

import NATS_Service from '@lixpi/nats-service'

const OBJECT_STREAM_PREFIX = 'OBJ_'
const CONFIRMATION_FLAG = '--confirm-delete-legacy-object-stores'
const LEGACY_BUCKET_PATTERNS = [
    /^workspace-.+-files$/,
    /^media-library-(?:workspace|user|organization|shared)-.+-files$/,
]

const servers = process.env.NATS_SERVERS
    ?.split(',')
    .map((server) => server.trim())
    .filter(Boolean)
const password = process.env.NATS_REGULAR_USER_PASSWORD
if (!servers?.length || !password) {
    throw new Error('NATS_SERVERS and NATS_REGULAR_USER_PASSWORD are required')
}

const confirmed = process.argv.includes(CONFIRMATION_FLAG)
const natsService = await NATS_Service.init({
    servers,
    name: 'phase11-legacy-object-store-removal',
    user: 'regular_user',
    pass: password,
})

try {
    const bucketNames = (await natsService.listStreamNames())
        .filter((streamName) => streamName.startsWith(OBJECT_STREAM_PREFIX))
        .map((streamName) => streamName.slice(OBJECT_STREAM_PREFIX.length))
    const legacyBucketNames = bucketNames
        .filter((bucketName) => !bucketName.startsWith('blobs-'))
        .filter((bucketName) => LEGACY_BUCKET_PATTERNS.some((pattern) => pattern.test(bucketName)))
        .sort()

    console.log(JSON.stringify({
        mode: confirmed ? 'delete' : 'dry-run',
        legacyBucketNames,
        activeBlobBucketsExcluded: bucketNames.filter((bucketName) => bucketName.startsWith('blobs-')).sort(),
    }, null, 2))

    if (!confirmed) {
        console.log(`Dry run only. Re-run with ${CONFIRMATION_FLAG} after verifying the archive and target account.`)
    } else {
        for (const bucketName of legacyBucketNames) {
            await natsService.deleteObjectStore(bucketName)
        }
        console.log(`Deleted ${legacyBucketNames.length} retired Object Store bucket(s).`)
    }
} finally {
    await natsService.close()
}
