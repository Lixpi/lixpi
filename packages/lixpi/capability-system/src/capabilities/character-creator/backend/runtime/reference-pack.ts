'use strict'

import sharp from 'sharp'

import type {
    CharacterFidelityObjectCoordinate,
    ImageReferenceCapabilities,
} from '@lixpi/constants'

import type { CharacterEvidenceProfile, CharacterSourceRegion } from './character-evidence.ts'
import type { ResolvedCharacterReference } from './reference-resolver.ts'
import type {
    CharacterImageReference,
    CharacterImageReferenceRole,
    CharacterTransientMediaStorePort,
} from './runtime-ports.ts'

export type CharacterReferencePackEntry = CharacterImageReference & {
    sourceAssetId?: string
    coordinate: CharacterFidelityObjectCoordinate
    width: number
    height: number
}

export type CharacterReferencePack = {
    entries: CharacterReferencePackEntry[]
}

export async function buildCharacterReferencePack(args: {
    sources: readonly ResolvedCharacterReference[]
    evidence: CharacterEvidenceProfile
    capabilities: ImageReferenceCapabilities
    store: CharacterTransientMediaStorePort
}): Promise<CharacterReferencePack> {
    const entries: CharacterReferencePackEntry[] = []
    for (const [sourceIndex, source] of args.sources.entries()) {
        entries.push(await storeReference({
            source,
            role: 'original-source',
            slot: `source-${sourceIndex + 1}`,
            bytes: await fitWithinPixelLimit(source.bytes, args.capabilities.maxOutputPixels),
            store: args.store,
        }))
    }

    const faceFact = bestObservedRegion(args.evidence, 'face')
    const bodyFact = bestObservedRegion(args.evidence, 'body')
        ?? bestObservedRegion(args.evidence, 'outfit')
    if (faceFact) {
        const source = args.sources.find(candidate => candidate.assetId === faceFact.sourceAssetId)
        if (source && faceFact.sourceRegion) {
            entries.push(await storeReference({
                source,
                role: 'face-crop',
                slot: 'face-crop',
                bytes: await cropLossless(source.bytes, faceFact.sourceRegion),
                store: args.store,
            }))
        }
    }
    if (bodyFact) {
        const source = args.sources.find(candidate => candidate.assetId === bodyFact.sourceAssetId)
        if (source && bodyFact.sourceRegion) {
            entries.push(await storeReference({
                source,
                role: 'body-outfit-crop',
                slot: 'body-outfit-crop',
                bytes: await cropLossless(source.bytes, bodyFact.sourceRegion),
                store: args.store,
            }))
        }
    }
    const propFact = bestObservedRegion(args.evidence, 'prop')
    if (propFact) {
        const source = args.sources.find(candidate => candidate.assetId === propFact.sourceAssetId)
        if (source && propFact.sourceRegion) {
            entries.push(await storeReference({
                source,
                role: 'prop-crop',
                slot: 'prop-crop',
                bytes: await cropLossless(source.bytes, propFact.sourceRegion),
                store: args.store,
            }))
        }
    }
    return { entries }
}

const storeReference = async (args: {
    source: ResolvedCharacterReference
    role: CharacterImageReferenceRole
    slot: string
    bytes: Buffer
    store: CharacterTransientMediaStorePort
}): Promise<CharacterReferencePackEntry> => {
    const normalized = await sharp(args.bytes).rotate().png({ compressionLevel: 9 }).toBuffer()
    const metadata = await sharp(normalized).metadata()
    const stored = await args.store.putWithCoordinate({
        mediaKind: 'image',
        slot: args.slot,
        bytes: normalized,
        mimeType: 'image/png',
        revision: 1,
    })
    return {
        url: `data:image/png;base64,${normalized.toString('base64')}`,
        role: args.role,
        fileName: `${args.slot}.png`,
        sourceAssetId: args.source.assetId,
        coordinate: stored.coordinate,
        width: metadata.width!,
        height: metadata.height!,
    }
}

const cropLossless = async (bytes: Buffer, region: CharacterSourceRegion): Promise<Buffer> => {
    const metadata = await sharp(bytes).metadata()
    const sourceWidth = metadata.width ?? 0
    const sourceHeight = metadata.height ?? 0
    if (sourceWidth < 1 || sourceHeight < 1) throw new Error('CHARACTER_REFERENCE_DIMENSIONS_INVALID')
    const left = Math.min(sourceWidth - 1, Math.max(0, Math.round(region.x)))
    const top = Math.min(sourceHeight - 1, Math.max(0, Math.round(region.y)))
    const width = Math.min(sourceWidth - left, Math.max(1, Math.round(region.width)))
    const height = Math.min(sourceHeight - top, Math.max(1, Math.round(region.height)))
    return await sharp(bytes)
        .extract({ left, top, width, height })
        .png({ compressionLevel: 9 })
        .toBuffer()
}

const fitWithinPixelLimit = async (bytes: Buffer, pixelLimit: number): Promise<Buffer> => {
    const metadata = await sharp(bytes).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (width * height <= pixelLimit) return bytes
    const scale = Math.sqrt(pixelLimit / (width * height))
    return await sharp(bytes)
        .resize({
            width: Math.max(1, Math.floor(width * scale)),
            height: Math.max(1, Math.floor(height * scale)),
            fit: 'inside',
            withoutEnlargement: true,
            kernel: 'lanczos3',
        })
        .png({ compressionLevel: 9 })
        .toBuffer()
}

const bestObservedRegion = (
    evidence: CharacterEvidenceProfile,
    feature: string,
): CharacterEvidenceProfile['facts'][number] | undefined => evidence.facts
    .filter(fact => fact.visibility === 'observed'
        && fact.sourceRegion
        && fact.feature.toLocaleLowerCase().includes(feature))
    .sort((left, right) => right.confidence - left.confidence)[0]
