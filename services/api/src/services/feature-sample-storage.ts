'use strict'

import NATS_Service from '@lixpi/nats-service'
import { type Feature, type FeatureSampleRef, type FeatureScope } from '@lixpi/constants'

const getStorageService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service unavailable')
    return natsService
}

const getWorkspaceBucketName = (workspaceId: string): string =>
    `workspace-${workspaceId}-files`

// Durable feature bucket, keyed on the feature's scope owner (the organization — a
// UUID). Deliberately NOT keyed on the workspace (so samples outlive the workspace)
// nor on the owner's userId (which is an email-like string containing characters that
// are invalid in a NATS bucket name). Mirrors the media library's org-scoped bucket.
const getDurableFeatureBucketName = (scope: FeatureScope, scopeOwnerId: string): string =>
    `feature-${scope}-${scopeOwnerId}-files`

export const getFeatureSampleObjectKey = (feature: Feature, sample: FeatureSampleRef): string =>
    sample.fileId ?? `features/${feature.featureId}/sample-${sample.idx}.${sample.ext}`

export const findFeatureSampleRef = (feature: Feature, sampleIndex: number): FeatureSampleRef | undefined =>
    feature.sampleImages.find((sample) => sample.idx === sampleIndex) ?? feature.sampleImages[sampleIndex]

export const getPrimaryFeatureSampleBucketName = (
    feature: Feature,
    scope: FeatureScope = feature.scope,
    scopeOwnerId: string = feature.scopeOwnerId,
): string =>
    getDurableFeatureBucketName(scope, scopeOwnerId)

// The durable bucket is created on demand the first time a feature is saved for an
// owner. open() rejects when a bucket is missing, so we create it then.
const ensureDurableFeatureBucket = async (natsService: NATS_Service, bucketName: string): Promise<void> => {
    try {
        await natsService.getObjectStore(bucketName)
    } catch {
        await natsService.createObjectStore(bucketName, {
            description: `Durable feature samples for ${bucketName}`,
        }).catch(() => {})
    }
}

export const readFeatureSampleObject = async ({
    feature,
    sample,
}: {
    feature: Feature
    sample: FeatureSampleRef
}): Promise<Uint8Array | null> => {
    // Reads come ONLY from the durable bucket — features are fully decoupled from the
    // workspace they were created in.
    const natsService = getStorageService()
    const objectKey = getFeatureSampleObjectKey(feature, sample)
    try {
        const data = await natsService.getObject(getDurableFeatureBucketName(feature.scope, feature.scopeOwnerId), objectKey)
        if (data) return data
    } catch {
        // Object missing in the durable bucket — nothing to return.
    }
    return null
}

// Persist a freshly extracted feature's samples into the durable bucket. The raw bytes
// are produced into the origin workspace bucket as scratch during extraction; this copies
// them into the durable, workspace-independent bucket so the feature is self-contained.
// Called once at creation. Throws only if a sample's source bytes cannot be found AND it
// is not already durable.
export const ensureFeatureSamplesForScope = async ({
    feature,
}: {
    feature: Feature
    newScope?: FeatureScope
    newScopeOwnerId?: string
}): Promise<void> => {
    const natsService = getStorageService()
    const destinationBucket = getDurableFeatureBucketName(feature.scope, feature.scopeOwnerId)
    const sourceWorkspaceBucket = getWorkspaceBucketName(feature.workspaceId)
    await ensureDurableFeatureBucket(natsService, destinationBucket)

    for (const sample of feature.sampleImages) {
        const objectKey = getFeatureSampleObjectKey(feature, sample)
        try {
            const existing = await natsService.getObject(destinationBucket, objectKey)
            if (existing) continue
        } catch {
            // Copy below when the destination object is absent.
        }

        const sourceStream = await natsService.getObjectStream(sourceWorkspaceBucket, objectKey).catch(() => null)
        if (!sourceStream) {
            throw new Error(`Feature sample object not found: ${objectKey}`)
        }
        await natsService.putObjectFromReadable(destinationBucket, objectKey, sourceStream, {
            name: objectKey,
            description: sample.subject || feature.name,
        })
    }
}
