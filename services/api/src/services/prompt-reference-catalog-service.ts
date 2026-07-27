'use strict'

import type {
    Asset,
    AssetRequesterContext,
    AssetSearchRecord,
    CapabilityModuleMeta,
    CapabilityMeta,
    CapabilityArtifactPromptReferenceCatalogItem,
    PromptReferenceCatalogItem,
    PromptReferenceCatalogPage,
    PromptReferenceCategory,
    PromptReferenceRecent,
    PromptReferenceType,
    Workspace,
} from '@lixpi/constants'
import type { CapabilityModuleCatalog } from '@lixpi/capability-system/backend'

import AssetModel, {
    buildAssetScopeAndOwnerKey,
    normalizeAssetTitle,
} from '../models/asset.ts'
import CapabilityModel, { type CapabilityRequesterContext } from '../models/capability.ts'
import PromptReferenceRecentModel from '../models/prompt-reference-recent.ts'
import AssetDocumentService from './asset-document-service.ts'
import { capabilityArtifactBackendRegistry } from '../capability-system/capability-artifacts.ts'

type PromptReferenceCatalogRequester = AssetRequesterContext

type ListPromptReferencesInput = {
    workspace: Workspace
    requester: PromptReferenceCatalogRequester
    category: PromptReferenceCategory
    query?: string
    limit?: number
    cursor?: string
}

type MediaCatalogCursor = {
    category: 'media'
    query: string
    canvasOffset: number
    assetComplete: boolean
    assetCursor?: string
}

type ArtifactCatalogCursor = {
    category: 'artifacts'
    query: string
    canvasOffset: number
    assetComplete: boolean
    assetCursor?: string
}

const categoryReferenceTypes = (category: PromptReferenceCategory): PromptReferenceType[] => {
    if (category === 'media') return ['media']
    if (category === 'artifacts') return ['capability-artifact']
    if (category === 'capabilities') return ['capability-module']
    if (category === 'tools') return ['tool']
    return ['skill']
}

const toCapabilityRequester = (requester: PromptReferenceCatalogRequester): CapabilityRequesterContext => ({
    userId: requester.userId,
    organizationIds: requester.organizationIds,
    canManageGlobalCapabilities: false,
})

const toMediaCatalogItem = (
    record: AssetSearchRecord,
    source: 'canvas' | 'library',
    nodeId?: string,
): PromptReferenceCatalogItem => ({
    referenceType: 'media',
    referenceId: record.assetId,
    assetId: record.assetId,
    ...(nodeId ? { nodeId } : {}),
    mediaKind: record.primaryCategory,
    source,
    title: record.title,
    scope: record.scope,
    updatedAt: record.updatedAt,
    ...(record.thumbnailBlobHash ? { thumbnailAvailable: true } : {}),
})

const toMediaCatalogItemFromAsset = (
    asset: Asset,
    source: 'canvas' | 'library',
    nodeId?: string,
): PromptReferenceCatalogItem | null => {
    const mediaKind = asset.media?.kind ?? (asset.documents.content ? 'document' : undefined)
    if (!mediaKind || asset.documents.conversation) return null
    return {
        referenceType: 'media',
        referenceId: asset.assetId,
        assetId: asset.assetId,
        ...(nodeId ? { nodeId } : {}),
        mediaKind,
        source,
        title: asset.title,
        scope: asset.scope,
        updatedAt: asset.updatedAt,
        ...(asset.media?.renditions.thumbnail?.status === 'ready'
            || (asset.media?.kind === 'video' && asset.media.renditions.representativeFrame?.status === 'ready')
            ? { thumbnailAvailable: true }
            : {}),
    }
}

const toCapabilityCatalogItem = (item: CapabilityMeta): PromptReferenceCatalogItem => ({
    ...item,
    referenceType: item.kind,
    referenceId: item.capabilityId,
})

const getCatalogItemKey = (item: PromptReferenceCatalogItem): string => {
    if (item.referenceType === 'media') return `${item.referenceType}#${item.nodeId ?? item.assetId}`
    if (item.referenceType === 'capability-artifact') {
        return `${item.referenceType}#${item.nodeId ?? item.assetId}`
    }
    return `${item.referenceType}#${item.referenceId}`
}

export class PromptReferenceCatalogService {
    constructor(private readonly moduleCatalog: CapabilityModuleCatalog) {}

    async listModules(
        requester: PromptReferenceCatalogRequester,
        query = '',
    ): Promise<CapabilityModuleMeta[]> {
        const resolved = await Promise.all(this.moduleCatalog.listModules(query).map(async (meta) => {
            const entry = this.moduleCatalog.resolveEntry(meta.moduleId)
            if (!entry) return null
            const record = await CapabilityModel.authorize({
                capabilityId: entry.capabilityId,
                requester: toCapabilityRequester(requester),
            })
            if ('error' in record || record.status !== 'active'
                || record.kind !== entry.kind
                || record.parentModuleId !== meta.moduleId
                || record.catalogExposure !== 'module-internal') return null
            return meta
        }))
        return resolved.filter((item): item is NonNullable<typeof item> => item !== null)
    }

    async getModule(
        requester: PromptReferenceCatalogRequester,
        moduleId: string,
    ): Promise<{
        meta: CapabilityModuleMeta
        entry: { capabilityId: string; kind: 'tool' | 'skill' }
    } | null> {
        const entry = this.moduleCatalog.resolveEntry(moduleId)
        const meta = this.moduleCatalog.getModuleMeta(moduleId)
        if (!entry || !meta) return null
        const items = await this.listModules(requester, meta.normalizedName)
        const authorizedMeta = items.find((item) => item.moduleId === moduleId)
        return authorizedMeta ? { meta: authorizedMeta, entry } : null
    }

    async list(input: ListPromptReferencesInput): Promise<PromptReferenceCatalogPage> {
        const limit = input.limit ?? 20
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('INVALID_PROMPT_REFERENCE_LIMIT')
        const query = typeof input.query === 'string' ? input.query : ''
        if (query.trim() || input.cursor) return await this.listCategory({ ...input, query, limit })

        const recents = await PromptReferenceRecentModel.list({
            userId: input.requester.userId,
            referenceTypes: categoryReferenceTypes(input.category),
            limit: 5,
        })
        const { items: recentItems, staleKeys } = await this.resolveRecents(input, recents)
        await PromptReferenceRecentModel.remove({
            userId: input.requester.userId,
            referenceKeys: staleKeys,
        }).catch(() => undefined)
        const merged = new Map<string, PromptReferenceCatalogItem>()
        for (const item of recentItems) {
            const key = getCatalogItemKey(item)
            if (!merged.has(key)) merged.set(key, item)
        }
        let catalogCursor: string | undefined
        while (merged.size < limit) {
            const page = await this.listCategory({
                ...input,
                query,
                limit: limit - merged.size,
                cursor: catalogCursor,
            })
            for (const item of page.items) {
                const key = getCatalogItemKey(item)
                if (!merged.has(key)) merged.set(key, item)
            }
            const nextCursor = page.cursor
            if (!nextCursor || nextCursor === catalogCursor) {
                catalogCursor = nextCursor
                break
            }
            catalogCursor = nextCursor
        }
        return {
            items: [...merged.values()].slice(0, limit),
            ...(catalogCursor ? { cursor: catalogCursor } : {}),
        }
    }

    private async listCategory(input: ListPromptReferencesInput & { query: string; limit: number }): Promise<PromptReferenceCatalogPage> {
        if (input.category === 'capabilities') {
            const items = (await this.listModules(input.requester, input.query))
                .map((item): PromptReferenceCatalogItem => ({
                    ...item,
                    referenceType: 'capability-module',
                    referenceId: item.moduleId,
                }))
            const offset = this.decodeModuleCursor(input.cursor, input.query)
            const pageItems = items.slice(offset, offset + input.limit)
            const nextOffset = offset + pageItems.length
            return {
                items: pageItems,
                ...(nextOffset < items.length ? { cursor: this.encodeModuleCursor(nextOffset, input.query) } : {}),
            }
        }

        if (input.category === 'tools' || input.category === 'skills') {
            const page = await CapabilityModel.listAuthorized({
                requester: toCapabilityRequester(input.requester),
                query: input.query,
                kinds: [input.category === 'tools' ? 'tool' : 'skill'],
                limit: input.limit,
                cursor: input.cursor,
            })
            return {
                items: page.items.map(toCapabilityCatalogItem),
                ...(page.cursor ? { cursor: page.cursor } : {}),
            }
        }

        if (input.category === 'artifacts') return await this.listArtifactCategory(input)

        return await this.listMediaCategory(input)
    }

    private async listArtifactCategory(
        input: ListPromptReferencesInput & { query: string; limit: number },
    ): Promise<PromptReferenceCatalogPage> {
        const cursor = this.decodeArtifactCursor(input.cursor, input.query)
        const placements = new Map<string, string[]>()
        for (const node of input.workspace.canvasState?.nodes ?? []) {
            if (node.type !== 'capabilityArtifact') continue
            const nodeIds = placements.get(node.assetId) ?? []
            nodeIds.push(node.nodeId)
            placements.set(node.assetId, nodeIds)
        }
        const canvasItems = await this.listCanvasArtifactItems(input, placements)
        const canvasOffset = Math.min(cursor.canvasOffset, canvasItems.length)
        const canvasPage = canvasItems.slice(canvasOffset, canvasOffset + input.limit)
        const items = [...canvasPage]
        const nextCanvasOffset = canvasOffset + canvasPage.length
        let assetCursor = cursor.assetCursor
        let assetComplete = cursor.assetComplete

        while (items.length < input.limit && !assetComplete) {
            const page = await AssetModel.searchAvailable({
                scopeAndOwners: [
                    ...input.requester.workspaceIds.map(workspaceId => buildAssetScopeAndOwnerKey('workspace', workspaceId)),
                    buildAssetScopeAndOwnerKey('user', input.requester.userId),
                    buildAssetScopeAndOwnerKey('organization', input.workspace.organizationId),
                ],
                principalId: input.requester.userId,
                organizationIds: [input.workspace.organizationId],
                query: input.query,
                categories: ['capabilityArtifact'],
                limit: input.limit - items.length,
                cursor: assetCursor,
            })
            for (const record of page.items) {
                if (placements.has(record.assetId)) continue
                const item = await this.resolveArtifactCatalogItem(input, record.assetId, 'library')
                if (item) items.push(item)
            }
            if (!page.cursor || page.cursor === assetCursor) {
                assetComplete = true
                assetCursor = undefined
            } else {
                assetCursor = page.cursor
            }
        }

        const hasMoreCanvas = nextCanvasOffset < canvasItems.length
        const hasMore = hasMoreCanvas || !assetComplete
        return {
            items,
            ...(hasMore ? {
                cursor: this.encodeArtifactCursor({
                    category: 'artifacts',
                    query: input.query,
                    canvasOffset: nextCanvasOffset,
                    assetComplete,
                    ...(assetCursor ? { assetCursor } : {}),
                }),
            } : {}),
        }
    }

    private async listCanvasArtifactItems(
        input: ListPromptReferencesInput & { query: string },
        placements: Map<string, string[]>,
    ): Promise<CapabilityArtifactPromptReferenceCatalogItem[]> {
        const normalizedQuery = normalizeAssetTitle(input.query)
        const groups = await Promise.all([...placements].map(async ([assetId, nodeIds]) => {
            const asset = await AssetModel.get({ assetId, requester: input.requester })
            if ('error' in asset || !normalizeAssetTitle(asset.title).startsWith(normalizedQuery)) return []
            const items = await Promise.all(nodeIds.map(async nodeId =>
                await this.resolveArtifactCatalogItem(input, assetId, 'canvas', nodeId, asset)))
            return items.filter((item): item is CapabilityArtifactPromptReferenceCatalogItem => item !== null)
        }))
        return groups.flat()
    }

    private async resolveArtifactCatalogItem(
        input: ListPromptReferencesInput,
        assetId: string,
        source: 'canvas' | 'library',
        nodeId?: string,
        resolvedAsset?: Awaited<ReturnType<typeof AssetModel.get>>,
    ): Promise<CapabilityArtifactPromptReferenceCatalogItem | null> {
        const asset = resolvedAsset ?? await AssetModel.get({ assetId, requester: input.requester })
        if ('error' in asset || !asset.artifact || !asset.documents.capabilityArtifact
            || asset.organizationId !== input.workspace.organizationId
            || asset.states.lifecycle !== 'active') return null
        const registered = capabilityArtifactBackendRegistry.get(asset.artifact.artifactTypeId)
        if (!registered || registered.shared.schemaVersion !== asset.artifact.schemaVersion) return null
        const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, 'capabilityArtifact')
        if (!snapshot) return null
        try {
            registered.shared.assertInitialDocument(snapshot.doc)
        } catch {
            return null
        }
        return {
            referenceType: 'capability-artifact',
            referenceId: asset.assetId,
            artifactTypeId: asset.artifact.artifactTypeId,
            assetId: asset.assetId,
            ...(nodeId ? { nodeId } : {}),
            title: asset.title,
            scope: asset.scope,
            source,
            updatedAt: asset.updatedAt,
            displayMetadata: registered.shared.buildCatalogMetadata(snapshot.doc),
            referenceThumbnailAssetIds: registered.shared.collectReferencedAssetIds(snapshot.doc).slice(0, 4),
        }
    }

    private async listMediaCategory(
        input: ListPromptReferencesInput & { query: string; limit: number },
    ): Promise<PromptReferenceCatalogPage> {
        const cursor = this.decodeMediaCursor(input.cursor, input.query)
        const placementsByAsset = new Map<string, string[]>()
        for (const node of input.workspace.canvasState?.nodes ?? []) {
            if (!('assetId' in node) || typeof node.assetId !== 'string'
                || !['image', 'video', 'audio', 'document', 'mediaDocument'].includes(node.type)) continue
            const placements = placementsByAsset.get(node.assetId) ?? []
            placements.push(node.nodeId)
            placementsByAsset.set(node.assetId, placements)
        }
        const canvasItems = await this.listCanvasMediaItems(input, placementsByAsset)
        const canvasOffset = Math.min(cursor.canvasOffset, canvasItems.length)
        const canvasPage = canvasItems.slice(canvasOffset, canvasOffset + input.limit)
        const items = [...canvasPage]
        const nextCanvasOffset = canvasOffset + canvasPage.length
        let assetCursor = cursor.assetCursor
        let assetComplete = cursor.assetComplete

        while (items.length < input.limit && !assetComplete) {
            const page = await AssetModel.searchAvailable({
                scopeAndOwners: [
                    ...input.requester.workspaceIds.map((workspaceId) => buildAssetScopeAndOwnerKey('workspace', workspaceId)),
                    buildAssetScopeAndOwnerKey('user', input.requester.userId),
                    buildAssetScopeAndOwnerKey('organization', input.workspace.organizationId),
                ],
                principalId: input.requester.userId,
                organizationIds: [input.workspace.organizationId],
                query: input.query,
                limit: input.limit - items.length,
                cursor: assetCursor,
            })
            for (const record of page.items) {
                if (placementsByAsset.has(record.assetId)) continue
                items.push(toMediaCatalogItem(record, 'library'))
            }
            if (!page.cursor || page.cursor === assetCursor) {
                assetComplete = true
                assetCursor = undefined
            } else {
                assetCursor = page.cursor
            }
        }

        const hasMoreCanvas = nextCanvasOffset < canvasItems.length
        const hasMore = hasMoreCanvas || !assetComplete
        return {
            items,
            ...(hasMore ? {
                cursor: this.encodeMediaCursor({
                    category: 'media',
                    query: input.query,
                    canvasOffset: nextCanvasOffset,
                    assetComplete,
                    ...(assetCursor ? { assetCursor } : {}),
                }),
            } : {}),
        }
    }

    private async listCanvasMediaItems(
        input: ListPromptReferencesInput & { query: string },
        placementsByAsset: Map<string, string[]>,
    ): Promise<PromptReferenceCatalogItem[]> {
        const normalizedQuery = normalizeAssetTitle(input.query)
        const assets = await Promise.all([...placementsByAsset.keys()].map(async (assetId) =>
            await AssetModel.get({ assetId, requester: input.requester })))
        return assets.flatMap((asset): PromptReferenceCatalogItem[] => {
            if ('error' in asset || asset.organizationId !== input.workspace.organizationId
                || asset.states.lifecycle !== 'active'
                || (asset.media && !['ready', 'degraded'].includes(asset.states.media))
                || !normalizeAssetTitle(asset.title).startsWith(normalizedQuery)) return []
            const placements = placementsByAsset.get(asset.assetId) ?? []
            return placements.flatMap((nodeId) => {
                const item = toMediaCatalogItemFromAsset(asset, 'canvas', nodeId)
                return item ? [item] : []
            })
        })
    }

    private encodeMediaCursor(cursor: MediaCatalogCursor): string {
        return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
    }

    private decodeMediaCursor(cursor: string | undefined, query: string): MediaCatalogCursor {
        if (!cursor) return { category: 'media', query, canvasOffset: 0, assetComplete: false }
        try {
            const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as MediaCatalogCursor
            if (!parsed || parsed.category !== 'media' || parsed.query !== query
                || !Number.isSafeInteger(parsed.canvasOffset) || parsed.canvasOffset < 0
                || typeof parsed.assetComplete !== 'boolean'
                || (parsed.assetCursor !== undefined && typeof parsed.assetCursor !== 'string')) {
                throw new Error('INVALID_CURSOR')
            }
            return parsed
        } catch {
            throw new Error('INVALID_CURSOR')
        }
    }

    private async resolveRecents(
        input: ListPromptReferencesInput,
        recents: PromptReferenceRecent[],
    ): Promise<{ items: PromptReferenceCatalogItem[]; staleKeys: string[] }> {
        const items: PromptReferenceCatalogItem[] = []
        const staleKeys: string[] = []
        for (const recent of recents) {
            const item = await this.resolveRecent(input, recent)
            if (item) items.push(item)
            else staleKeys.push(recent.referenceKey)
        }
        return { items, staleKeys }
    }

    private async resolveRecent(
        input: ListPromptReferencesInput,
        recent: PromptReferenceRecent,
    ): Promise<PromptReferenceCatalogItem | null> {
        if (recent.referenceType === 'capability-module') {
            const module = await this.getModule(input.requester, recent.referenceId)
            return module ? {
                ...module.meta,
                referenceType: 'capability-module',
                referenceId: module.meta.moduleId,
            } : null
        }
        if (recent.referenceType === 'tool' || recent.referenceType === 'skill') {
            const record = await CapabilityModel.authorize({
                capabilityId: recent.referenceId,
                requester: toCapabilityRequester(input.requester),
            })
            if ('error' in record || record.kind !== recent.referenceType
                || record.catalogExposure !== 'standalone' || record.parentModuleId !== undefined
                || record.status !== 'active') return null
            const manifest = await CapabilityModel.readManifest({
                capabilityId: record.capabilityId,
                requester: toCapabilityRequester(input.requester),
            }).catch(() => null)
            if (!manifest) return null
            return toCapabilityCatalogItem({
                scopeAndOwner: `${record.scope}#${record.scopeOwnerId}`,
                scope: record.scope,
                scopeOwnerId: record.scopeOwnerId,
                searchKey: `${record.kind}#${manifest.manifest.name}`,
                capabilityId: record.capabilityId,
                kind: record.kind,
                name: manifest.manifest.name,
                normalizedName: manifest.manifest.name.normalize('NFKC').trim().toLocaleLowerCase('en-US'),
                summary: manifest.manifest.description,
                tags: [],
                manifestBlobHash: record.manifestBlobHash,
                catalogExposure: record.catalogExposure,
                status: record.status,
                updatedAt: record.updatedAt,
            })
        }
        if (recent.referenceType === 'capability-artifact') {
            const page = await this.listArtifactCategory({ ...input, category: 'artifacts', query: '', limit: 20 })
            return page.items.find(item => item.referenceType === 'capability-artifact'
                && item.assetId === recent.referenceId) ?? null
        }
        const asset = await AssetModel.get({ assetId: recent.referenceId, requester: input.requester })
        if ('error' in asset || asset.organizationId !== input.workspace.organizationId
            || asset.states.lifecycle !== 'active') return null
        const placement = (input.workspace.canvasState?.nodes ?? []).find((node) =>
            'assetId' in node && node.assetId === asset.assetId && ['image', 'video', 'audio', 'document', 'mediaDocument'].includes(node.type))
        return toMediaCatalogItemFromAsset(asset, placement ? 'canvas' : 'library', placement?.nodeId)
    }

    private encodeModuleCursor(offset: number, query: string): string {
        return Buffer.from(JSON.stringify({ category: 'capabilities', query, offset }), 'utf8').toString('base64url')
    }

    private encodeArtifactCursor(cursor: ArtifactCatalogCursor): string {
        return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
    }

    private decodeArtifactCursor(cursor: string | undefined, query: string): ArtifactCatalogCursor {
        if (!cursor) return { category: 'artifacts', query, canvasOffset: 0, assetComplete: false }
        try {
            const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as ArtifactCatalogCursor
            if (parsed.category !== 'artifacts' || parsed.query !== query
                || !Number.isSafeInteger(parsed.canvasOffset) || parsed.canvasOffset < 0
                || typeof parsed.assetComplete !== 'boolean'
                || (parsed.assetCursor !== undefined && typeof parsed.assetCursor !== 'string')) {
                throw new Error('INVALID_CURSOR')
            }
            return parsed
        } catch {
            throw new Error('INVALID_CURSOR')
        }
    }

    private decodeModuleCursor(cursor: string | undefined, query: string): number {
        if (!cursor) return 0
        try {
            const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
            if (parsed.category !== 'capabilities' || parsed.query !== query
                || !Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0) throw new Error('INVALID_CURSOR')
            return Number(parsed.offset)
        } catch {
            throw new Error('INVALID_CURSOR')
        }
    }
}
