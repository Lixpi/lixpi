'use strict'

import sharp from 'sharp'

import type { CharacterReferenceAssetPort } from './runtime-ports.ts'

export type ResolvedCharacterReference = {
    assetId: string
    organizationId: string
    rendition: 'canonical' | 'original' | 'composition-component'
    sourceKind: 'asset-rendition' | 'composition-component'
    componentId?: string
    compositionAssetId?: string
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
    const resolved: ResolvedCharacterReference[] = []
    const resolvedKeys = new Set<string>()
    const authorizedAssets = new Map<string, Awaited<ReturnType<CharacterReferenceAssetPort['getAuthorizedAsset']>>>()
    const resolvingAssetIds = new Set<string>()

    const getAuthorizedAsset = async (assetId: string) => {
        const existing = authorizedAssets.get(assetId)
        if (existing) return existing
        const asset = await args.assets.getAuthorizedAsset({
            assetId,
            userId: args.userId,
            workspaceId: args.workspaceId,
            organizationId: args.organizationId,
        })
        if (asset.organizationId !== args.organizationId) throw new Error(`CHARACTER_REFERENCE_ORGANIZATION_MISMATCH:${assetId}`)
        authorizedAssets.set(assetId, asset)
        return asset
    }
    const resolveAsset = async (assetId: string): Promise<void> => {
        if (resolvedKeys.has(`asset:${assetId}`)) return
        if (resolvingAssetIds.has(assetId)) throw new Error(`CHARACTER_REFERENCE_COMPOSITION_CYCLE:${assetId}`)
        resolvingAssetIds.add(assetId)
        try {
            const asset = await getAuthorizedAsset(assetId)
            const composition = asset.composition
            if (composition?.kind === 'character-sheet'
                && composition.capabilityId === 'global.character-creator') {
                for (const sourceAssetId of composition.sourceAssetIds) await resolveAsset(sourceAssetId)
                for (const component of composition.components) {
                    const componentKey = `component:${assetId}:${component.componentId}`
                    if (resolvedKeys.has(componentKey)) continue
                    const bytes = Buffer.from(await args.assets.readBlob({
                        organizationId: args.organizationId,
                        blobHash: component.blobHash,
                    }))
                    const metadata = await sharp(bytes).metadata()
                    if (!metadata.width || !metadata.height) {
                        throw new Error(`CHARACTER_REFERENCE_DIMENSIONS_INVALID:${assetId}:${component.componentId}`)
                    }
                    resolvedKeys.add(componentKey)
                    resolved.push({
                        assetId,
                        organizationId: args.organizationId,
                        rendition: 'composition-component',
                        sourceKind: 'composition-component',
                        componentId: component.componentId,
                        compositionAssetId: assetId,
                        blobHash: component.blobHash,
                        mimeType: component.mimeType,
                        bytes,
                        width: metadata.width,
                        height: metadata.height,
                    })
                }
                resolvedKeys.add(`asset:${assetId}`)
                return
            }

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
            if (!metadata.width || !metadata.height) {
                throw new Error(`CHARACTER_REFERENCE_DIMENSIONS_INVALID:${assetId}`)
            }
            resolvedKeys.add(`asset:${assetId}`)
            resolved.push({
                assetId,
                organizationId: args.organizationId,
                rendition,
                sourceKind: 'asset-rendition',
                blobHash: selected.blobHash,
                mimeType: selected.mimeType,
                bytes,
                width: metadata.width,
                height: metadata.height,
            })
        } finally {
            resolvingAssetIds.delete(assetId)
        }
    }

    for (const assetId of args.assetIds) await resolveAsset(assetId)
    return resolved
}

const isSupportedImageMimeType = (value: string): value is ResolvedCharacterReference['mimeType'] =>
    value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
