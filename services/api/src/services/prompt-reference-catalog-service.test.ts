'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    searchAvailable: vi.fn(),
    getAsset: vi.fn(),
    listAuthorized: vi.fn(),
    authorizeCapability: vi.fn(),
    readManifest: vi.fn(),
    listRecents: vi.fn(),
    removeRecents: vi.fn(),
}))

vi.mock('../models/asset.ts', () => ({
    default: {
        searchAvailable: mocks.searchAvailable,
        get: mocks.getAsset,
    },
    buildAssetScopeAndOwnerKey: (scope: string, ownerId: string) => `${scope}#${ownerId}`,
    normalizeAssetTitle: (title: string) => title.normalize('NFKC').trim().toLocaleLowerCase('en-US'),
}))
vi.mock('../models/capability.ts', () => ({
    default: {
        listAuthorized: mocks.listAuthorized,
        authorize: mocks.authorizeCapability,
        readManifest: mocks.readManifest,
    },
}))
vi.mock('../models/prompt-reference-recent.ts', () => ({
    default: {
        list: mocks.listRecents,
        remove: mocks.removeRecents,
    },
}))

import { PromptReferenceCatalogService } from './prompt-reference-catalog-service.ts'

const moduleItems = [
    {
        moduleId: 'character-creator',
        name: 'Character Creator',
        normalizedName: 'character creator',
        summary: 'Character sheets.',
        tags: ['character'],
        status: 'active' as const,
    },
    {
        moduleId: 'style-extraction',
        name: 'Style Extraction',
        normalizedName: 'style extraction',
        summary: 'Extracts styles.',
        tags: ['style'],
        status: 'active' as const,
    },
]
const moduleCatalog = {
    listModules: vi.fn((query = '') => moduleItems.filter(item => item.normalizedName.startsWith(query))),
    getModuleMeta: vi.fn((moduleId: string) => moduleItems.find(item => item.moduleId === moduleId)),
    resolveEntry: vi.fn((moduleId: string) => moduleItems.some(item => item.moduleId === moduleId)
        ? { capabilityId: `global.${moduleId}`, kind: 'tool' as const }
        : undefined),
}
const workspace = {
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    canvasState: {
        nodes: [{ nodeId: 'node-portrait', type: 'image', assetId: 'asset-portrait' }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
    },
}
const requester = {
    userId: 'user-1',
    workspaceIds: ['workspace-1'],
    editableWorkspaceIds: ['workspace-1'],
    organizationIds: ['organization-1'],
}
const portrait = {
    scopeAndOwner: 'organization#organization-1',
    searchKey: 'image#portrait#asset-portrait',
    normalizedTitle: 'portrait',
    assetId: 'asset-portrait',
    organizationId: 'organization-1',
    title: 'Portrait',
    primaryCategory: 'image' as const,
    scope: 'organization' as const,
    scopeOwnerId: 'organization-1',
    ownerUserId: 'user-1',
    originWorkspaceId: 'workspace-1',
    lifecycleStatus: 'active' as const,
    mediaStatus: 'ready' as const,
    createdAt: 1,
    updatedAt: 2,
}
const portraitAsset = {
    assetId: 'asset-portrait',
    organizationId: 'organization-1',
    title: 'Portrait',
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    documents: {},
    media: { kind: 'image', renditions: {} },
    states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
    referenceCount: 1,
    revision: 1,
    createdAt: 1,
    updatedAt: 2,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchAvailable.mockResolvedValue({ items: [] })
    mocks.getAsset.mockResolvedValue({ error: 'ASSET_NOT_FOUND' })
    mocks.listAuthorized.mockResolvedValue({ items: [] })
    mocks.listRecents.mockResolvedValue([])
    mocks.removeRecents.mockResolvedValue(undefined)
    mocks.authorizeCapability.mockImplementation(async ({ capabilityId }: { capabilityId: string }) => ({
        capabilityId,
        kind: 'tool',
        parentModuleId: capabilityId.replace(/^global\./, ''),
        catalogExposure: 'module-internal',
        status: 'active',
    }))
})

describe('PromptReferenceCatalogService', () => {
    it('routes Capability queries to top-level module metadata with query-bound cursors', async () => {
        const service = new PromptReferenceCatalogService(moduleCatalog as any)
        const page = await service.list({
            workspace: workspace as any,
            requester,
            category: 'capabilities',
            query: '',
            limit: 1,
        })

        expect(page.items).toEqual([expect.objectContaining({
            referenceType: 'capability-module',
            referenceId: 'character-creator',
        })])
        expect(page.cursor).toEqual(expect.any(String))
        await expect(service.list({
            workspace: workspace as any,
            requester,
            category: 'capabilities',
            query: 'style',
            limit: 1,
            cursor: page.cursor,
        })).rejects.toThrow('INVALID_CURSOR')
    })

    it('hides a module whose internal entry package is not active and authorized', async () => {
        mocks.authorizeCapability.mockResolvedValue({
            capabilityId: 'global.character-creator',
            kind: 'tool',
            parentModuleId: 'character-creator',
            catalogExposure: 'module-internal',
            status: 'disabled',
        })

        const page = await new PromptReferenceCatalogService(moduleCatalog as any).list({
            workspace: workspace as any,
            requester,
            category: 'capabilities',
            query: 'character',
        })

        expect(page.items).toEqual([])
    })

    it('ranks current-canvas media placements before library-only rows', async () => {
        mocks.getAsset.mockResolvedValue(portraitAsset)
        mocks.searchAvailable.mockResolvedValue({
            items: [
                { ...portrait, assetId: 'asset-library', searchKey: 'image#library#asset-library', normalizedTitle: 'library', title: 'Library' },
                portrait,
            ],
        })
        const page = await new PromptReferenceCatalogService(moduleCatalog as any).list({
            workspace: workspace as any,
            requester,
            category: 'media',
            query: 'p',
        })

        expect(page.items).toEqual([
            expect.objectContaining({ assetId: 'asset-portrait', nodeId: 'node-portrait', source: 'canvas' }),
            expect.objectContaining({ assetId: 'asset-library', source: 'library' }),
        ])
        expect(mocks.searchAvailable).toHaveBeenCalledWith(expect.objectContaining({
            organizationIds: ['organization-1'],
        }))
    })

    it('lists authorized current-canvas media even when its catalog search projection is absent', async () => {
        mocks.getAsset.mockResolvedValue(portraitAsset)

        const page = await new PromptReferenceCatalogService(moduleCatalog as any).list({
            workspace: workspace as any,
            requester,
            category: 'media',
            query: 'por',
        })

        expect(page.items).toEqual([expect.objectContaining({
            assetId: 'asset-portrait',
            nodeId: 'node-portrait',
            source: 'canvas',
        })])
    })

    it('pages every distinct current-canvas placement before library results', async () => {
        mocks.getAsset.mockResolvedValue(portraitAsset)
        const multiPlacementWorkspace = {
            ...workspace,
            canvasState: {
                ...workspace.canvasState,
                nodes: ['one', 'two', 'three'].map((suffix) => ({
                    nodeId: `node-${suffix}`,
                    type: 'image',
                    assetId: 'asset-portrait',
                })),
            },
        }
        const service = new PromptReferenceCatalogService(moduleCatalog as any)
        const first = await service.list({
            workspace: multiPlacementWorkspace as any,
            requester,
            category: 'media',
            query: 'por',
            limit: 2,
        })
        const second = await service.list({
            workspace: multiPlacementWorkspace as any,
            requester,
            category: 'media',
            query: 'por',
            limit: 2,
            cursor: first.cursor,
        })

        expect(first.items.map(item => item.referenceType === 'media' ? item.nodeId : undefined))
            .toEqual(['node-one', 'node-two'])
        expect(second.items.map(item => item.referenceType === 'media' ? item.nodeId : undefined))
            .toEqual(['node-three'])
        await expect(service.list({
            workspace: multiPlacementWorkspace as any,
            requester,
            category: 'media',
            query: 'different',
            limit: 2,
            cursor: first.cursor,
        })).rejects.toThrow('INVALID_CURSOR')
    })

    it('resolves same-organization cross-workspace Asset recents without showing another organization', async () => {
        mocks.listRecents.mockResolvedValue([{
            userId: 'user-1',
            referenceKey: 'media#asset-recent',
            referenceType: 'media',
            referenceId: 'asset-recent',
            updatedAt: 10,
        }])
        mocks.getAsset.mockResolvedValue({
            assetId: 'asset-recent',
            organizationId: 'organization-1',
            title: 'Other workspace portrait',
            scope: 'workspace',
            scopeOwnerId: 'workspace-2',
            originWorkspaceId: 'workspace-2',
            ownerUserId: 'user-1',
            documents: {},
            media: { kind: 'image', renditions: {} },
            states: { lifecycle: 'active', media: 'ready', conversation: 'none', provenance: 'none' },
            referenceCount: 1,
            revision: 1,
            createdAt: 1,
            updatedAt: 10,
        })

        const service = new PromptReferenceCatalogService(moduleCatalog as any)
        const page = await service.list({
            workspace: workspace as any,
            requester,
            category: 'media',
            query: '',
            limit: 5,
        })
        expect(page.items).toEqual([expect.objectContaining({
            assetId: 'asset-recent',
            source: 'library',
        })])

        mocks.getAsset.mockResolvedValue({
            assetId: 'asset-recent',
            organizationId: 'organization-2',
            states: { lifecycle: 'active' },
        })
        const crossOrganizationPage = await service.list({
            workspace: workspace as any,
            requester,
            category: 'media',
            query: '',
            limit: 5,
        })
        expect(crossOrganizationPage.items).toEqual([])
        expect(mocks.removeRecents).toHaveBeenLastCalledWith({
            userId: 'user-1',
            referenceKeys: ['media#asset-recent'],
        })
    })

    it('removes stale recents and fills the page from currently authorized results', async () => {
        mocks.listRecents.mockResolvedValue([{
            userId: 'user-1',
            referenceKey: 'media#asset-stale',
            referenceType: 'media',
            referenceId: 'asset-stale',
            updatedAt: 10,
        }])
        mocks.getAsset.mockImplementation(async ({ assetId }: { assetId: string }) =>
            assetId === 'asset-stale' ? { error: 'ASSET_NOT_FOUND' } : portraitAsset)
        mocks.searchAvailable.mockResolvedValue({ items: [portrait] })

        const page = await new PromptReferenceCatalogService(moduleCatalog as any).list({
            workspace: workspace as any,
            requester,
            category: 'media',
            query: '',
            limit: 5,
        })

        expect(page.items).toEqual([expect.objectContaining({ assetId: 'asset-portrait' })])
        expect(mocks.removeRecents).toHaveBeenCalledWith({
            userId: 'user-1',
            referenceKeys: ['media#asset-stale'],
        })
    })

    it('fills past catalog rows duplicated by recents without skipping the next result', async () => {
        mocks.listRecents.mockResolvedValue([{
            userId: 'user-1',
            referenceKey: 'capability-module#character-creator',
            referenceType: 'capability-module',
            referenceId: 'character-creator',
            updatedAt: 10,
        }])

        const page = await new PromptReferenceCatalogService(moduleCatalog as any).list({
            workspace: workspace as any,
            requester,
            category: 'capabilities',
            query: '',
            limit: 2,
        })

        expect(page.items.map(item => item.referenceId)).toEqual([
            'character-creator',
            'style-extraction',
        ])
    })

    it('routes Tool and Skill categories through standalone package listing', async () => {
        await new PromptReferenceCatalogService(moduleCatalog as any).list({
            workspace: workspace as any,
            requester,
            category: 'skills',
            query: 'shot',
        })

        expect(mocks.listAuthorized).toHaveBeenCalledWith(expect.objectContaining({
            query: 'shot',
            kinds: ['skill'],
        }))
        expect(moduleCatalog.listModules).not.toHaveBeenCalled()
    })
})
