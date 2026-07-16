'use strict'

import NATS_Service from '@lixpi/nats-service'
import { type Feature, type FeatureSampleRef } from '@lixpi/constants'
import BlobModel from '../models/blob.ts'

const getStorageService = (): NATS_Service => {
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service unavailable')
    return natsService
}

export const findFeatureSampleRef = (feature: Feature, sampleIndex: number): FeatureSampleRef | undefined =>
    feature.sampleImages.find((sample) => sample.idx === sampleIndex) ?? feature.sampleImages[sampleIndex]

export const readFeatureSampleObject = async ({
    feature,
    sample,
}: {
    feature: Feature
    sample: FeatureSampleRef
}): Promise<Uint8Array | null> => {
    const natsService = getStorageService()
    try {
        const blob = await BlobModel.get({ organizationId: feature.scopeOwnerId, blobHash: sample.blobHash })
        if (!blob) return null
        const data = await natsService.getObject(blob.bucketName, blob.objectKey)
        if (data) return data
    } catch {
        // Object missing in the organization Blob bucket — nothing to return.
    }
    return null
}
