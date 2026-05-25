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

const getDurableFeatureBucketName = (ownerUserId: string): string =>
    `user-${ownerUserId}-features`

export const getFeatureSampleObjectKey = (feature: Feature, sample: FeatureSampleRef): string =>
    sample.fileId ?? `features/${feature.featureId}/sample-${sample.idx}.${sample.ext}`

export const findFeatureSampleRef = (feature: Feature, sampleIndex: number): FeatureSampleRef | undefined =>
    feature.sampleImages.find((sample) => sample.idx === sampleIndex) ?? feature.sampleImages[sampleIndex]

export const getPrimaryFeatureSampleBucketName = (
    feature: Feature,
    scope: FeatureScope = feature.scope,
    scopeOwnerId: string = feature.scopeOwnerId,
): string =>
    scope === 'workspace'
        ? getWorkspaceBucketName(scopeOwnerId)
        : getDurableFeatureBucketName(feature.ownerUserId)

const getFeatureSampleBucketCandidates = (feature: Feature): string[] => {
    const primary = getPrimaryFeatureSampleBucketName(feature)
    const originWorkspace = getWorkspaceBucketName(feature.workspaceId)
    return primary === originWorkspace ? [primary] : [primary, originWorkspace]
}

export const readFeatureSampleObject = async ({
    feature,
    sample,
}: {
    feature: Feature
    sample: FeatureSampleRef
}): Promise<Uint8Array | null> => {
    const natsService = getStorageService()
    const objectKey = getFeatureSampleObjectKey(feature, sample)
    for (const bucketName of getFeatureSampleBucketCandidates(feature)) {
        try {
            const data = await natsService.getObject(bucketName, objectKey)
            if (data) return data
        } catch {
            // Older promoted records can still point at source-workspace bytes.
        }
    }
    return null
}

export const ensureFeatureSamplesForScope = async ({
    feature,
    newScope,
    newScopeOwnerId,
}: {
    feature: Feature
    newScope: FeatureScope
    newScopeOwnerId: string
}): Promise<void> => {
    const destinationBucket = getPrimaryFeatureSampleBucketName(feature, newScope, newScopeOwnerId)
    const natsService = getStorageService()
    const sourceBuckets = getFeatureSampleBucketCandidates(feature)

    for (const sample of feature.sampleImages) {
        const objectKey = getFeatureSampleObjectKey(feature, sample)
        try {
            const existing = await natsService.getObject(destinationBucket, objectKey)
            if (existing) continue
        } catch {
            // Copy below when the destination object is absent.
        }

        let copied = false
        for (const sourceBucket of sourceBuckets) {
            if (sourceBucket === destinationBucket) continue
            try {
                const sourceStream = await natsService.getObjectStream(sourceBucket, objectKey)
                if (!sourceStream) continue
                await natsService.putObjectFromReadable(destinationBucket, objectKey, sourceStream, {
                    name: objectKey,
                    description: sample.subject || feature.name,
                })
                copied = true
                break
            } catch {
                // Try the legacy/source-workspace candidate before failing.
            }
        }
        if (!copied) {
            throw new Error(`Feature sample object not found: ${objectKey}`)
        }
    }
}
