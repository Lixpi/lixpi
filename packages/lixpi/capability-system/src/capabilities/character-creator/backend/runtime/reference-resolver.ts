'use strict'

import { createHash } from 'node:crypto'

import sharp from 'sharp'

import {
    buildCharacterSheetLayout,
    type CharacterSheetLayout,
} from '../../shared/character-sheet-layout.ts'
import type { CharacterPanelSpec } from '../../shared/character-sheet-media-plan.ts'
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
    panels: readonly CharacterPanelSpec[]
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
            if (
                composition?.kind === 'character-sheet'
                && composition.capabilityId === 'global.character-creator'
            ) {
                for (const sourceAssetId of composition.sourceAssetIds) await resolveAsset(sourceAssetId)
                for (const component of composition.components) {
                    if (component.role === 'character-sheet-panel-review-only') continue
                    const componentKey = `component:${assetId}:${component.componentId}`
                    if (resolvedKeys.has(componentKey)) continue
                    const bytes = Buffer.from(
                        await args.assets.readBlob({
                            organizationId: args.organizationId,
                            blobHash: component.blobHash,
                        }),
                    )
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
            const bytes = Buffer.from(
                await args.assets.readBlob({
                    organizationId: args.organizationId,
                    blobHash: selected.blobHash,
                }),
            )
            const metadata = await sharp(bytes).metadata()
            if (!metadata.width || !metadata.height) {
                throw new Error(`CHARACTER_REFERENCE_DIMENSIONS_INVALID:${assetId}`)
            }
            const legacyComponents = await extractLegacyCharacterSheetComponents({
                assetId,
                organizationId: args.organizationId,
                bytes,
                width: metadata.width,
                height: metadata.height,
                panels: args.panels,
            })
            if (legacyComponents.length > 0) {
                for (const component of legacyComponents) {
                    resolvedKeys.add(`component:${assetId}:${component.componentId}`)
                    resolved.push(component)
                }
                resolvedKeys.add(`asset:${assetId}`)
                return
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

const isSupportedImageMimeType = (value: string): value is ResolvedCharacterReference['mimeType'] => value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'

const LEGACY_SHEET_ASPECT_RATIO = 3 / 2
const LEGACY_SHEET_ASPECT_RATIO_TOLERANCE = 0.02
const LEGACY_SHEET_MINIMUM_WHITE_RATIO = 0.55
const LEGACY_SHEET_MINIMUM_CELL_CONTENT_RATIO = 0.002
const LEGACY_SHEET_MINIMUM_SEPARATOR_WHITE_RATIO = 0.9

const extractLegacyCharacterSheetComponents = async (args: {
    assetId: string
    organizationId: string
    bytes: Buffer
    width: number
    height: number
    panels: readonly CharacterPanelSpec[]
}): Promise<ResolvedCharacterReference[]> => {
    if (args.panels.length < 3) return []
    if (Math.abs(args.width / args.height - LEGACY_SHEET_ASPECT_RATIO) > LEGACY_SHEET_ASPECT_RATIO_TOLERANCE) {
        return []
    }
    if (await getNearWhitePixelRatio(args.bytes) < LEGACY_SHEET_MINIMUM_WHITE_RATIO) return []

    const candidatePanelSets = args.panels.length > 3
        ? [args.panels, args.panels.slice(0, 3)]
        : [args.panels]
    for (const panels of candidatePanelSets) {
        const layout = buildCharacterSheetLayout(panels)
        if (!await hasExpectedLegacySheetSeparators(args.bytes, layout, args.width, args.height)) continue
        const components = await extractLegacyLayoutComponents({ ...args, panels, layout })
        if (components.length === panels.length) return components
    }
    return []
}

const extractLegacyLayoutComponents = async (args: {
    assetId: string
    organizationId: string
    bytes: Buffer
    width: number
    height: number
    panels: readonly CharacterPanelSpec[]
    layout: CharacterSheetLayout
}): Promise<ResolvedCharacterReference[]> => {
    const components: ResolvedCharacterReference[] = []
    for (const [index, panel] of args.panels.entries()) {
        const cell = args.layout.cells[index]
        if (!cell) return []
        const region = scaleLayoutRegion(cell, args.layout, args.width, args.height)
        const componentBytes = await sharp(args.bytes)
            .extract(region)
            .png({ compressionLevel: 9 })
            .toBuffer()
        if (await getNonWhitePixelRatio(componentBytes) < LEGACY_SHEET_MINIMUM_CELL_CONTENT_RATIO) return []
        components.push({
            assetId: args.assetId,
            organizationId: args.organizationId,
            rendition: 'composition-component',
            sourceKind: 'composition-component',
            componentId: panel.panelId,
            compositionAssetId: args.assetId,
            blobHash: createHash('sha256').update(componentBytes).digest('hex'),
            mimeType: 'image/png',
            bytes: componentBytes,
            width: region.width,
            height: region.height,
        })
    }
    return components
}

const hasExpectedLegacySheetSeparators = async (
    bytes: Buffer,
    layout: CharacterSheetLayout,
    width: number,
    height: number,
): Promise<boolean> => {
    const rows = [...new Set(layout.cells.map(cell => cell.y))].sort((left, right) => left - right)
    for (let index = 1; index < rows.length; index += 1) {
        const previousRow = layout.cells.find(cell => cell.y === rows[index - 1])
        if (!previousRow) return false
        const gapStart = previousRow.y + previousRow.height
        const gapEnd = rows[index]!
        if (gapEnd <= gapStart) continue
        const separator = scaleLayoutRegion(
            {
                x: 0,
                y: gapStart,
                width: layout.width,
                height: gapEnd - gapStart,
            },
            layout,
            width,
            height,
        )
        const separatorBytes = await sharp(bytes).extract(separator).toBuffer()
        if (await getNearWhitePixelRatio(separatorBytes) < LEGACY_SHEET_MINIMUM_SEPARATOR_WHITE_RATIO) return false
    }
    return true
}

const scaleLayoutRegion = (
    region: { x: number; y: number; width: number; height: number },
    layout: CharacterSheetLayout,
    width: number,
    height: number,
): { left: number; top: number; width: number; height: number } => {
    const left = Math.max(0, Math.round(region.x * width / layout.width))
    const top = Math.max(0, Math.round(region.y * height / layout.height))
    return {
        left,
        top,
        width: Math.max(1, Math.min(width - left, Math.round(region.width * width / layout.width))),
        height: Math.max(1, Math.min(height - top, Math.round(region.height * height / layout.height))),
    }
}

const getNearWhitePixelRatio = async (bytes: Buffer): Promise<number> => {
    const { data, info } = await sharp(bytes)
        .flatten({ background: '#ffffff' })
        .resize({ width: 120, height: 80, fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    let nearWhitePixels = 0
    for (let offset = 0; offset < data.length; offset += info.channels) {
        if (data[offset]! >= 245 && data[offset + 1]! >= 245 && data[offset + 2]! >= 245) nearWhitePixels += 1
    }
    return nearWhitePixels / (info.width * info.height)
}

const getNonWhitePixelRatio = async (bytes: Buffer): Promise<number> => 1 - await getNearWhitePixelRatio(bytes)
