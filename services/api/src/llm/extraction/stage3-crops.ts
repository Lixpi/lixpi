'use strict'

import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { warn, err } from '@lixpi/debug-tools'
import NATS_Service from '@lixpi/nats-service'
import type { FeatureSampleRef, FeatureSampleCropRegion, SceneSubject, SceneRegion } from '@lixpi/constants'

import { parseDataUrl, parseNatsObjectRef } from '../utils/attachments.ts'
import type { ExtractionDeps, ExtractionState, StageLogger, ReferenceImage } from './types.ts'
import BlobModel from '../../models/blob.ts'

const MIN_CROP_AXIS_PX = 128
const TARGET_CROP_AXIS_PX = 384
const SUBJECT_CROPS_PER_PRIMARY = 4
const SUBJECT_CROPS_PER_SECONDARY = 1
const REGION_CROPS_PER_REGION = 1

// Seeded RNG so crop positions are deterministic per extractionRunId.
const mulberry32 = (seed: number): (() => number) => {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6d2b79f5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const seedFromString = (s: string): number => {
    const h = createHash('sha256').update(s).digest()
    return h.readUInt32BE(0)
}

const fetchImageBytes = async (url: string): Promise<Buffer> => {
    if (url.startsWith('data:')) {
        const { base64 } = parseDataUrl(url)
        return Buffer.from(base64, 'base64')
    }
    const objRef = parseNatsObjectRef(url)
    if (objRef) {
        const nats = NATS_Service.getInstance()
        if (!nats) throw new Error('NATS service not initialized')
        const data = await nats.getObject(objRef.bucket, objRef.key)
        if (!data) throw new Error(`Source image not found in NATS object store: ${url}`)
        return Buffer.from(data)
    }
    if (url.startsWith('https://') || url.startsWith('http://')) {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Failed to fetch source image ${url}: HTTP ${response.status}`)
        return Buffer.from(await response.arrayBuffer())
    }
    throw new Error(`Unsupported source image URL: ${url.slice(0, 80)}`)
}

// Picks one crop rectangle inside the given bbox at a random position. Returns null
// if the bbox is too small to yield a valid crop above the minimum axis size.
const pickSubCrop = (
    rand: () => number,
    bbox: { left: number; top: number; width: number; height: number },
    desiredAxis: number,
): { left: number; top: number; width: number; height: number } | null => {
    const minSide = Math.min(bbox.width, bbox.height)
    if (minSide < MIN_CROP_AXIS_PX) return null
    const axis = Math.min(desiredAxis, Math.floor(minSide * 0.9))
    if (axis < MIN_CROP_AXIS_PX) return null
    const maxOffX = bbox.width - axis
    const maxOffY = bbox.height - axis
    const offX = maxOffX > 0 ? Math.floor(rand() * maxOffX) : 0
    const offY = maxOffY > 0 ? Math.floor(rand() * maxOffY) : 0
    return { left: bbox.left + offX, top: bbox.top + offY, width: axis, height: axis }
}

const normalizedToPx = (bbox: [number, number, number, number], width: number, height: number) => {
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(bbox[0] * width)))
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(bbox[1] * height)))
    const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(bbox[2] * width)))
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(bbox[3] * height)))
    return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
}

type PlannedCrop = {
    region: FeatureSampleCropRegion
    box: { left: number; top: number; width: number; height: number }
}

const planSubjectCrops = (
    rand: () => number,
    subject: SceneSubject,
    imageRef: string,
    imgWidth: number,
    imgHeight: number,
    count: number,
): PlannedCrop[] => {
    const bbox = normalizedToPx(subject.bbox, imgWidth, imgHeight)
    const plans: PlannedCrop[] = []
    for (let i = 0; i < count; i++) {
        const pick = pickSubCrop(rand, bbox, TARGET_CROP_AXIS_PX)
        if (!pick) break
        plans.push({
            box: pick,
            region: {
                imageRef,
                x: pick.left,
                y: pick.top,
                width: pick.width,
                height: pick.height,
                label: `${subject.label}-detail-${i}`,
                purpose: 'subject-detail-evidence',
            },
        })
    }
    return plans
}

const planRegionCrops = (
    rand: () => number,
    region: SceneRegion,
    imageRef: string,
    imgWidth: number,
    imgHeight: number,
    count: number,
): PlannedCrop[] => {
    const bbox = normalizedToPx(region.bbox, imgWidth, imgHeight)
    const plans: PlannedCrop[] = []
    for (let i = 0; i < count; i++) {
        const pick = pickSubCrop(rand, bbox, TARGET_CROP_AXIS_PX)
        if (!pick) break
        plans.push({
            box: pick,
            region: {
                imageRef,
                x: pick.left,
                y: pick.top,
                width: pick.width,
                height: pick.height,
                label: `${region.label}-${i}`,
                purpose: 'texture-evidence',
            },
        })
    }
    return plans
}

const planCompositionThumbnail = (
    imageRef: string,
    imgWidth: number,
    imgHeight: number,
): PlannedCrop => ({
    box: { left: 0, top: 0, width: imgWidth, height: imgHeight },
    region: {
        imageRef,
        x: 0,
        y: 0,
        width: imgWidth,
        height: imgHeight,
        label: 'composition-thumbnail',
        purpose: 'composition-evidence',
    },
})

const materializeCropsForReference = async (args: {
    extractionRunId: string
    workspaceId: string
    organizationId?: string
    ref: ReferenceImage
    refIdx: number
    sceneEntry: { subjects: SceneSubject[]; regions: SceneRegion[] }
    deps: ExtractionDeps
}): Promise<FeatureSampleRef[]> => {
    const rand = mulberry32(seedFromString(`${args.extractionRunId}:${args.ref.imageRef}`))

    const sourceBytes = await fetchImageBytes(args.ref.url)
    const meta = await sharp(sourceBytes).metadata()
    const imgWidth = meta.width ?? 0
    const imgHeight = meta.height ?? 0
    if (!imgWidth || !imgHeight) {
        throw new Error(`Source image ${args.ref.imageRef} has unknown dimensions`)
    }

    const plans: PlannedCrop[] = []

    // Subject crops — primary subjects get more crops, secondary get fewer.
    for (const subject of args.sceneEntry.subjects) {
        const count = subject.salience === 1 ? SUBJECT_CROPS_PER_PRIMARY : SUBJECT_CROPS_PER_SECONDARY
        plans.push(...planSubjectCrops(rand, subject, args.ref.imageRef, imgWidth, imgHeight, count))
    }

    // Background / region crops.
    for (const region of args.sceneEntry.regions) {
        plans.push(...planRegionCrops(rand, region, args.ref.imageRef, imgWidth, imgHeight, REGION_CROPS_PER_REGION))
    }

    // One composition-preserving thumbnail per reference.
    plans.push(planCompositionThumbnail(args.ref.imageRef, imgWidth, imgHeight))

    const results = await Promise.all(plans.map(async (plan, idx): Promise<FeatureSampleRef | undefined> => {
        try {
            let pipeline = sharp(sourceBytes).extract({
                left: plan.box.left,
                top: plan.box.top,
                width: plan.box.width,
                height: plan.box.height,
            })
            // Composition thumbnails get downscaled aggressively so they stay small.
            if (plan.region.purpose === 'composition-evidence') {
                pipeline = pipeline.resize({ width: 512, height: 512, fit: 'inside' })
            } else if (plan.box.width > 1024 || plan.box.height > 1024) {
                pipeline = pipeline.resize({ width: 1024, height: 1024, fit: 'inside' })
            }
            const cropBuffer = await pipeline.png().toBuffer()
            if (!args.organizationId) throw new Error('Organization context required for crop Blob storage')
            const stored = await BlobModel.store({
                organizationId: args.organizationId,
                bytes: cropBuffer,
                mimeType: 'image/png',
                description: `extraction-${args.extractionRunId}-${args.ref.imageRef}-${plan.region.label}.png`,
            })
            return {
                idx: 0, // assigned after Promise.all settles based on stable order
                subject: plan.region.label,
                aspectRatio: `${plan.box.width}x${plan.box.height}`,
                ext: 'png',
                blobHash: stored.blobHash,
                imageUrl: `data:image/png;base64,${cropBuffer.toString('base64')}`,
                kind: 'source-crop',
                cropRegion: plan.region,
                rationale: `Sub-anatomical / content-free crop from ${args.ref.imageRef} at (${plan.box.left},${plan.box.top}) ${plan.box.width}x${plan.box.height} — ${plan.region.purpose}`,
            }
        } catch (e) {
            warn(`Failed to materialize crop ${plan.region.label} from ${args.ref.imageRef}: ${e instanceof Error ? e.message : String(e)}`)
            return undefined
        }
    }))

    return results.filter((r): r is FeatureSampleRef => r !== undefined)
}

export const materializeSourceCrops = async (state: ExtractionState, logger: StageLogger, deps: ExtractionDeps): Promise<Partial<ExtractionState>> => {
    return await logger.span('crops', 'sharp', async () => {
        const scene = state.sceneAssessment
        if (!scene) return { sourceCrops: [] }

        const allCrops: FeatureSampleRef[] = []
        for (let i = 0; i < state.references.length; i++) {
            const ref = state.references[i]!
            const sceneEntry = scene.references[i] ?? { subjects: [], regions: [] }
            try {
                const crops = await materializeCropsForReference({
                    extractionRunId: state.input.extractionRunId,
                    workspaceId: state.input.workspaceId,
                    organizationId: state.input.organizationId,
                    ref,
                    refIdx: i,
                    sceneEntry,
                    deps,
                })
                allCrops.push(...crops)
            } catch (e) {
                err(`Failed to crop ${ref.imageRef}: ${e instanceof Error ? e.message : String(e)}`)
            }
        }

        // Assign stable idx values across all crops by their order.
        const indexed: FeatureSampleRef[] = allCrops.map((c, idx) => ({ ...c, idx }))
        return { sourceCrops: indexed }
    }, {
        inputSummary: `references=${state.references.length} subjects=${state.sceneAssessment?.references.reduce((sum, r) => sum + r.subjects.length, 0) ?? 0}`,
        outputSummarizer: (result) => `crops=${result.sourceCrops?.length ?? 0}`,
    })
}
