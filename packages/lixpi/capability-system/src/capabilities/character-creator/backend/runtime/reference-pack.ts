import sharp from 'sharp'

import {
    type CharacterFidelityObjectCoordinate,
    type ImageReferenceCapabilities,
} from '@lixpi/constants'

import {
    type CharacterEvidenceProfile,
    type CharacterEvidenceRegion,
    type CharacterSourceRegion,
} from './character-evidence.ts'
import {
    type ResolvedCharacterReference,
} from './reference-resolver.ts'
import {
    type CharacterImageReference,
    type CharacterImageReferenceRole,
    type CharacterTransientMediaStorePort,
} from './runtime-ports.ts'

export type CharacterReferencePackEntry = CharacterImageReference & {
    sourceAssetId?: string
    componentId?: string
    compositionAssetId?: string
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
    editTargetAssetId?: string
    referenceAliases?: ReadonlyArray<{ assetId: string; alias: string }>
    capabilities: ImageReferenceCapabilities
    store: CharacterTransientMediaStorePort
}): Promise<CharacterReferencePack> {
    const entries: CharacterReferencePackEntry[] = []
    const aliases = new Map((args.referenceAliases ?? []).map(reference => [
        reference.assetId,
        normalizeReferenceSlot(reference.alias),
    ]))
    let originalSourceIndex = 0
    for (const [sourceIndex, source] of args.sources.entries()) {
        const isEditTarget = source.sourceKind === 'composition-component'
            && source.assetId === args.editTargetAssetId
        if (
            isEditTarget && (args.evidence.editTargetPolicy === 'identity-only'
                || args.evidence.editTargetPolicy === 'discard')
        ) {
            continue
        }
        if (!isEditTarget) originalSourceIndex += 1
        const alias = aliases.get(source.assetId)
        entries.push(
            await storeReference({
                source,
                role: isEditTarget ? 'edit-target' : 'original-source',
                slot: isEditTarget
                    ? `EDIT_TARGET_${alias ? `${alias}_` : ''}${source.componentId ?? sourceIndex + 1}`
                    : alias ?? `source-${originalSourceIndex}`,
                bytes: await fitWithinPixelLimit(source.bytes, args.capabilities.maxOutputPixels),
                store: args.store,
            }),
        )
    }

    if (args.evidence.editTargetPolicy === 'identity-only') {
        const identityPanel = args.sources.find(source =>
            source.sourceKind === 'composition-component'
            && source.assetId === args.editTargetAssetId
            && source.componentId === 'head-front-neutral'
        )
        if (identityPanel) {
            entries.push(
                await storeReference({
                    source: identityPanel,
                    role: 'edit-target-identity',
                    slot: 'EDIT_TARGET_IDENTITY_FACE',
                    bytes: await cropStandardHeadPanelIdentity(identityPanel.bytes),
                    store: args.store,
                }),
            )
        }
    }

    const faceFact = bestObservedRegion(args.evidence, 'face')
    const bodyFact = bestObservedRegion(args.evidence, 'body')
        ?? bestObservedRegion(args.evidence, 'outfit')
    if (faceFact) {
        const source = args.sources.find(candidate => candidate.assetId === faceFact.sourceAssetId)
        if (source && faceFact.sourceRegion) {
            const alias = aliases.get(source.assetId)
            entries.push(
                await storeReference({
                    source,
                    role: 'face-crop',
                    slot: alias ? `${alias}_FACE_CROP` : 'face-crop',
                    bytes: await cropLossless(source.bytes, faceFact.sourceRegion),
                    store: args.store,
                }),
            )
        }
    }
    if (bodyFact) {
        const source = args.sources.find(candidate => candidate.assetId === bodyFact.sourceAssetId)
        if (source && bodyFact.sourceRegion) {
            const alias = aliases.get(source.assetId)
            entries.push(
                await storeReference({
                    source,
                    role: 'body-outfit-crop',
                    slot: alias ? `${alias}_BODY_OUTFIT_CROP` : 'body-outfit-crop',
                    bytes: await cropLossless(source.bytes, bodyFact.sourceRegion),
                    store: args.store,
                }),
            )
        }
    }
    const propFact = bestObservedRegion(args.evidence, 'prop')
    if (propFact) {
        const source = args.sources.find(candidate => candidate.assetId === propFact.sourceAssetId)
        if (source && propFact.sourceRegion) {
            const alias = aliases.get(source.assetId)
            entries.push(
                await storeReference({
                    source,
                    role: 'prop-crop',
                    slot: alias ? `${alias}_PROP_CROP` : 'prop-crop',
                    bytes: await cropLossless(source.bytes, propFact.sourceRegion),
                    store: args.store,
                }),
            )
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
        ...(args.source.componentId ? { componentId: args.source.componentId } : {}),
        ...(args.source.compositionAssetId ? { compositionAssetId: args.source.compositionAssetId } : {}),
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

const cropStandardHeadPanelIdentity = async (bytes: Buffer): Promise<Buffer> => {
    const metadata = await sharp(bytes).metadata()
    const sourceWidth = metadata.width ?? 0
    const sourceHeight = metadata.height ?? 0
    if (sourceWidth < 8 || sourceHeight < 8) throw new Error('CHARACTER_EDIT_TARGET_IDENTITY_DIMENSIONS_INVALID')
    const left = Math.round(sourceWidth * 0.26)
    const top = Math.round(sourceHeight * 0.2)
    const width = Math.max(1, Math.min(sourceWidth - left, Math.round(sourceWidth * 0.48)))
    const height = Math.max(1, Math.min(sourceHeight - top, Math.round(sourceHeight * 0.35)))
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
    region: CharacterEvidenceRegion,
): CharacterEvidenceProfile['facts'][number] | undefined =>
    evidence.facts
        .filter(fact =>
            fact.visibility === 'observed'
            && fact.sourceRegion
            && (fact.region === region
                || (!fact.region && fact.feature.toLocaleLowerCase().includes(region)))
        )
        .sort((left, right) =>
            requestAuthorityPriority(right.requestAuthority)
                - requestAuthorityPriority(left.requestAuthority)
            || right.confidence - left.confidence
        )[0]

const requestAuthorityPriority = (
    authority: CharacterEvidenceProfile['facts'][number]['requestAuthority'],
): number => authority === 'assigned' ? 2 : authority === 'supporting' ? 1 : 0

const normalizeReferenceSlot = (value: string): string =>
    value
        .trim()
        .replace(/[^A-Za-z0-9_-]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
