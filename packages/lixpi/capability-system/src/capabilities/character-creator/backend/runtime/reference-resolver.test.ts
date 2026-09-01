import sharp from 'sharp'
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { buildCharacterSheetLayout } from '../../shared/character-sheet-layout.ts'
import { buildCharacterSheetRenderPlan } from '../../shared/character-sheet-media-plan.ts'
import { resolveCharacterReferences } from './reference-resolver.ts'
import {
    type CharacterReferenceAssetPort,
} from './runtime-ports.ts'

const readyAsset = (overrides: Record<string, unknown> = {}) => ({
    assetId: 'asset-1',
    organizationId: 'org-1',
    media: {
        renditions: {
            canonical: { status: 'ready', blobHash: 'canonical-hash', mimeType: 'image/png' },
            original: { status: 'ready', blobHash: 'original-hash', mimeType: 'image/jpeg' },
        },
    },
    ...overrides,
})

const assets: CharacterReferenceAssetPort = {
    getAuthorizedAsset: vi.fn(),
    readBlob: vi.fn(),
}

const defaultPanels = buildCharacterSheetRenderPlan({
    capabilityRunId: 'run-default',
    sourceAssetIds: ['asset-1'],
    userPrompt: 'Create a character sheet.',
}).panels

const resolve = async () =>
    await resolveCharacterReferences({
        assetIds: ['asset-1'],
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        assets,
        panels: defaultPanels,
    })

describe('resolveCharacterReferences', () => {
    beforeEach(async () => {
        vi.clearAllMocks()
        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset())
        vi.mocked(assets.readBlob).mockResolvedValue(
            await sharp({
                create: { width: 640, height: 480, channels: 3, background: '#446688' },
            }).png().toBuffer(),
        )
    })

    it('reauthorizes the Asset and resolves the canonical rendition at original dimensions', async () => {
        const result = await resolve()

        expect(assets.getAuthorizedAsset).toHaveBeenCalledWith({
            assetId: 'asset-1',
            userId: 'user-1',
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
        })
        expect(assets.readBlob).toHaveBeenCalledWith({ organizationId: 'org-1', blobHash: 'canonical-hash' })
        expect(result[0]).toMatchObject({
            assetId: 'asset-1',
            rendition: 'canonical',
            sourceKind: 'asset-rendition',
            blobHash: 'canonical-hash',
            width: 640,
            height: 480,
        })
    })

    it('falls back to the original rendition but never to preview', async () => {
        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset({
            media: {
                renditions: {
                    canonical: { status: 'processing' },
                    original: { status: 'ready', blobHash: 'original-hash', mimeType: 'image/png' },
                },
            },
        }))

        const result = await resolve()

        expect(result[0]?.rendition).toBe('original')
        expect(assets.readBlob).toHaveBeenCalledWith({ organizationId: 'org-1', blobHash: 'original-hash' })

        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset({
            media: {
                renditions: {
                    canonical: { status: 'processing' },
                    original: { status: 'failed' },
                },
            },
        }))
        await expect(resolve()).rejects.toThrow('CHARACTER_REFERENCE_NOT_MODEL_READY:asset-1')
    })

    it('rejects an Asset returned outside the active organization', async () => {
        vi.mocked(assets.getAuthorizedAsset).mockResolvedValue(readyAsset({ organizationId: 'org-2' }))

        await expect(resolve()).rejects.toThrow('CHARACTER_REFERENCE_ORGANIZATION_MISMATCH:asset-1')
        expect(assets.readBlob).not.toHaveBeenCalled()
    })

    it('expands a stored character sheet into its original sources and isolated component shots', async () => {
        vi.mocked(assets.getAuthorizedAsset).mockImplementation(async ({ assetId }) =>
            assetId === 'sheet-1'
                ? readyAsset({
                    assetId: 'sheet-1',
                    composition: {
                        schemaVersion: 'asset-media-composition-v1',
                        kind: 'character-sheet',
                        capabilityId: 'global.character-creator',
                        sourceAssetIds: ['source-1'],
                        components: [
                            {
                                componentId: 'head-front-neutral',
                                role: 'character-sheet-panel',
                                title: 'Neutral front identity portrait',
                                blobHash: 'head-hash',
                                mimeType: 'image/png',
                                byteSize: 100,
                            },
                            {
                                componentId: 'body-front',
                                role: 'character-sheet-panel',
                                title: 'Front body',
                                blobHash: 'front-hash',
                                mimeType: 'image/png',
                                byteSize: 100,
                            },
                            {
                                componentId: 'body-back',
                                role: 'character-sheet-panel-review-only',
                                title: 'Back body',
                                blobHash: 'back-review-hash',
                                mimeType: 'image/png',
                                byteSize: 100,
                            },
                        ],
                    },
                })
                : readyAsset({ assetId: 'source-1' })
        )

        const result = await resolveCharacterReferences({
            assetIds: ['sheet-1', 'source-1'],
            organizationId: 'org-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            assets,
            panels: defaultPanels,
        })

        expect(result.map(reference => ({
            assetId: reference.assetId,
            sourceKind: reference.sourceKind,
            componentId: reference.componentId,
            blobHash: reference.blobHash,
        }))).toEqual([
            {
                assetId: 'source-1',
                sourceKind: 'asset-rendition',
                componentId: undefined,
                blobHash: 'canonical-hash',
            },
            {
                assetId: 'sheet-1',
                sourceKind: 'composition-component',
                componentId: 'head-front-neutral',
                blobHash: 'head-hash',
            },
            {
                assetId: 'sheet-1',
                sourceKind: 'composition-component',
                componentId: 'body-front',
                blobHash: 'front-hash',
            },
        ])
        expect(assets.getAuthorizedAsset).toHaveBeenCalledTimes(2)
        expect(assets.readBlob).not.toHaveBeenCalledWith(expect.objectContaining({
            blobHash: 'back-review-hash',
        }))
    })

    it('recovers isolated panel references from every legacy flattened character sheet', async () => {
        const panels = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Edit the existing sheet.',
        }).panels
        const layout = buildCharacterSheetLayout(panels)
        const width = 1200
        const height = 800
        const overlays = await Promise.all(layout.cells.map(async (cell, index) => {
            const scaledCellX = Math.round(cell.x * width / layout.width)
            const scaledCellY = Math.round(cell.y * height / layout.height)
            const scaledCellWidth = Math.round(cell.width * width / layout.width)
            const scaledCellHeight = Math.round(cell.height * height / layout.height)
            const blockWidth = Math.max(20, Math.round(scaledCellWidth * 0.2))
            const blockHeight = Math.max(40, Math.round(scaledCellHeight * 0.65))
            return {
                input: await sharp({
                    create: {
                        width: blockWidth,
                        height: blockHeight,
                        channels: 3 as const,
                        background: index === 0 ? '#223344' : index === 1 ? '#445566' : '#667788',
                    },
                }).png().toBuffer(),
                left: scaledCellX + Math.round((scaledCellWidth - blockWidth) / 2),
                top: scaledCellY + Math.round((scaledCellHeight - blockHeight) / 2),
            }
        }))
        const flattenedSheet = await sharp({
            create: { width, height, channels: 3, background: '#ffffff' },
        }).composite(overlays).png().toBuffer()
        vi.mocked(assets.readBlob).mockResolvedValue(flattenedSheet)

        const result = await resolveCharacterReferences({
            assetIds: ['asset-1'],
            organizationId: 'org-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            assets,
            panels,
        })

        expect(result).toHaveLength(3)
        expect(result.map(reference => reference.componentId)).toEqual(panels.map(panel => panel.panelId))
        expect(result.every(reference => reference.sourceKind === 'composition-component')).toBe(true)
        expect(result.every(reference => reference.compositionAssetId === 'asset-1')).toBe(true)
        expect(result.every(reference => reference.width < width && reference.height < height)).toBe(true)
    })

    it('does not split an arbitrary blank 3:2 source', async () => {
        vi.mocked(assets.readBlob).mockResolvedValue(
            await sharp({
                create: { width: 1200, height: 800, channels: 3, background: '#ffffff' },
            }).png().toBuffer(),
        )
        const panels = buildCharacterSheetRenderPlan({
            capabilityRunId: 'run-1',
            sourceAssetIds: ['asset-1'],
            userPrompt: 'Edit the existing sheet.',
        }).panels

        const result = await resolveCharacterReferences({
            assetIds: ['asset-1'],
            organizationId: 'org-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            assets,
            panels,
        })

        expect(result).toEqual([
            expect.objectContaining({ sourceKind: 'asset-rendition', assetId: 'asset-1' }),
        ])
    })
})
