'use strict'

import sharp from 'sharp'

import type { CharacterReferenceAssetPort } from './runtime-ports.ts'

export type ResolvedCharacterReference = {
    assetId: string
    organizationId: string
    rendition: 'canonical' | 'original'
    blobHash: string
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
    bytes: Buffer
    width: number
    height: number
}

export async function resolveCharacterReferences(args: {
    assetIds: readonly string[]
    organizationId: string
    workspaceId: string
    userId: string
    assets: CharacterReferenceAssetPort
}): Promise<ResolvedCharacterReference[]> {
    return await Promise.all(args.assetIds.map(async assetId => {
        const asset = await args.assets.getAuthorizedAsset({
            assetId,
            userId: args.userId,
            workspaceId: args.workspaceId,
            organizationId: args.organizationId,
        })
        if (asset.organizationId !== args.organizationId) throw new Error(`CHARACTER_REFERENCE_ORGANIZATION_MISMATCH:${assetId}`)
        const canonical = asset.media?.renditions.canonical
        const original = asset.media?.renditions.original
        const selected = canonical?.status === 'ready' ? canonical : original?.status === 'ready' ? original : undefined
        const rendition = canonical?.status === 'ready' ? 'canonical' : 'original'
        if (!selected?.blobHash || !selected.mimeType || !isSupportedImageMimeType(selected.mimeType)) {
            throw new Error(`CHARACTER_REFERENCE_NOT_MODEL_READY:${assetId}`)
        }
        const bytes = Buffer.from(await args.assets.readBlob({
            organizationId: args.organizationId,
            blobHash: selected.blobHash,
        }))
        const metadata = await sharp(bytes).metadata()
        if (!metadata.width || !metadata.height) throw new Error(`CHARACTER_REFERENCE_DIMENSIONS_INVALID:${assetId}`)
        return {
            assetId,
            organizationId: args.organizationId,
            rendition,
            blobHash: selected.blobHash,
            mimeType: selected.mimeType,
            bytes,
            width: metadata.width,
            height: metadata.height,
        }
    }))
}

const isSupportedImageMimeType = (value: string): value is ResolvedCharacterReference['mimeType'] =>
    value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
