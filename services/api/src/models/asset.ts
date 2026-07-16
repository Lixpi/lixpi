'use strict'

import * as process from 'node:process'
import { v4 as uuid } from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import {
    ACCESS_LEVEL,
    ASSET_EDIT_LEASE_DURATION_MS,
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type Asset,
    type AssetAccessList,
    type AssetDocumentRole,
    type AssetMeta,
    type AssetPrimaryCategory,
    type AssetReference,
    type AssetRequesterContext,
    type AssetScope,
    type BlobRecord,
    type BlobReference,
} from '@lixpi/constants'
import { isTransactionConditionalCheckFailure, type TransactOperation } from '@lixpi/dynamodb-service'
import { PROSEMIRROR_SCHEMA_VERSION } from '@lixpi/prosemirror'

import BlobModel, { buildBlobReferenceBatchOperations } from './blob.ts'
import { ensureOrganizationAssetStorage } from '../services/blob-storage.ts'
import { enqueueAssetDeletion } from '../services/asset-maintenance-queue.ts'

const { ORG_NAME, STAGE } = process.env

const assetsTableName = (): string => getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE)
const assetsMetaTableName = (): string => getDynamoDbTableStageName('ASSETS_META', ORG_NAME, STAGE)
const assetsAccessListTableName = (): string => getDynamoDbTableStageName('ASSETS_ACCESS_LIST', ORG_NAME, STAGE)
const assetReferencesTableName = (): string => getDynamoDbTableStageName('ASSET_REFERENCES', ORG_NAME, STAGE)
const MAX_ASSET_META_PROJECTIONS = 90

export const publishAssetEvent = (subject: string, asset: Asset): void => {
    try {
        NATS_Service.getInstance()?.publish(subject, {
            organizationId: asset.organizationId,
            assetId: asset.assetId,
            revision: asset.revision,
        })
    } catch (error) {
        console.error('Asset event publication failed:', { subject, assetId: asset.assetId, error })
    }
}

export const buildAssetScopeAndOwnerKey = (scope: AssetScope, scopeOwnerId: string): string =>
    `${scope}#${scopeOwnerId}`

export const buildAssetPrincipalScopeKey = (principalId: string): string =>
    `principal#${principalId}`

export const buildAssetCatalogReferenceKey = (scope: AssetScope, scopeOwnerId: string): string =>
    `catalog#${scope}#${scopeOwnerId}`

export const buildAssetWorkspaceReferenceKey = (workspaceId: string): string =>
    `workspace#${workspaceId}`

const derivePrimaryCategory = (asset: Asset): AssetPrimaryCategory => {
    if (asset.media) return asset.media.kind
    if (asset.documents.conversation) return 'conversation'
    return 'document'
}

const isValidDescriptor = (descriptor: unknown): descriptor is NonNullable<Asset['descriptor']> => {
    if (!descriptor || typeof descriptor !== 'object') return false
    const candidate = descriptor as NonNullable<Asset['descriptor']>
    return ['analyzing', 'ready', 'failed'].includes(candidate.status)
        && typeof candidate.summary === 'string'
        && Array.isArray(candidate.entityTags)
        && candidate.entityTags.every((tag) => typeof tag === 'string')
        && Array.isArray(candidate.styleTags)
        && candidate.styleTags.every((tag) => typeof tag === 'string')
        && candidate.source === 'analysis'
        && typeof candidate.version === 'string'
        && Boolean(candidate.version)
        && Number.isSafeInteger(candidate.updatedAt)
}

export const buildAssetMeta = (asset: Asset, scopeAndOwner?: string): AssetMeta => {
    const thumbnail = asset.media?.renditions.thumbnail
    const preview = asset.media?.renditions.preview
    const original = asset.media?.renditions.original
    const canonical = asset.media?.renditions.canonical
    const preferredMedia = canonical?.status === 'ready' ? canonical : original

    return {
        scopeAndOwner: scopeAndOwner ?? buildAssetScopeAndOwnerKey(asset.scope, asset.scopeOwnerId),
        assetId: asset.assetId,
        organizationId: asset.organizationId,
        title: asset.title,
        primaryCategory: derivePrimaryCategory(asset),
        ownerUserId: asset.ownerUserId,
        originWorkspaceId: asset.originWorkspaceId,
        lifecycleStatus: asset.states.lifecycle,
        mediaStatus: asset.states.media,
        ...(thumbnail?.status === 'ready' && thumbnail.blobHash ? { thumbnailBlobHash: thumbnail.blobHash } : {}),
        ...(preview?.status === 'ready' && preview.blobHash ? { previewBlobHash: preview.blobHash } : {}),
        ...(preferredMedia?.status === 'ready' && preferredMedia.mimeType ? { mimeType: preferredMedia.mimeType } : {}),
        ...(preferredMedia?.status === 'ready' && typeof preferredMedia.byteSize === 'number' ? { byteSize: preferredMedia.byteSize } : {}),
        ...(typeof asset.media?.width === 'number' ? { width: asset.media.width } : {}),
        ...(typeof asset.media?.height === 'number' ? { height: asset.media.height } : {}),
        ...(typeof asset.media?.durationSeconds === 'number' ? { durationSeconds: asset.media.durationSeconds } : {}),
        ...(typeof asset.media?.aspectRatio === 'number' ? { aspectRatio: asset.media.aspectRatio } : {}),
        ...(asset.descriptor?.summary ? { descriptorSummary: asset.descriptor.summary } : {}),
        ...(asset.descriptor?.entityTags ? { entityTags: asset.descriptor.entityTags } : {}),
        ...(asset.descriptor?.styleTags ? { styleTags: asset.descriptor.styleTags } : {}),
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
    }
}

export const getAssetRecord = async (assetId: string): Promise<Asset | undefined> =>
    await dynamoDBService.getItem({
        tableName: assetsTableName(),
        key: { assetId },
        consistentRead: true,
        origin: 'Asset.getRecord',
    }) as Asset | undefined

const getAccess = async (assetId: string, principalId: string): Promise<AssetAccessList | undefined> =>
    await dynamoDBService.getItem({
        tableName: assetsAccessListTableName(),
        key: { assetId, principalId },
        consistentRead: true,
        origin: 'Asset.getAccess',
    }) as AssetAccessList | undefined

const listAccess = async (assetId: string): Promise<AssetAccessList[]> => {
    const result = await dynamoDBService.queryItems({
        tableName: assetsAccessListTableName(),
        keyConditions: { assetId },
        limit: 100,
        fetchAllItems: true,
        consistentRead: true,
        origin: 'Asset.listAccess',
    })
    return (result?.items ?? []) as AssetAccessList[]
}

const listReferences = async (assetId: string): Promise<AssetReference[]> => {
    const result = await dynamoDBService.queryItems({
        tableName: assetReferencesTableName(),
        keyConditions: { assetId },
        limit: 100,
        fetchAllItems: true,
        consistentRead: true,
        origin: 'Asset.listReferences',
    })
    return (result?.items ?? []) as AssetReference[]
}

const getReference = async (assetId: string, referenceKey: string): Promise<AssetReference | undefined> =>
    await dynamoDBService.getItem({
        tableName: assetReferencesTableName(),
        key: { assetId, referenceKey },
        consistentRead: true,
        origin: 'Asset.getReference',
    }) as AssetReference | undefined

const canReadBaseScope = (asset: Asset, requester: AssetRequesterContext): boolean => {
    if (asset.ownerUserId === requester.userId) return true
    if (asset.scope === 'workspace') return requester.workspaceIds.includes(asset.scopeOwnerId)
    if (asset.scope === 'user') return asset.scopeOwnerId === requester.userId
    return requester.organizationIds.includes(asset.scopeOwnerId)
}

const getAuthorizedAsset = async ({
    assetId,
    requester,
    includeDeleting = false,
}: {
    assetId: string
    requester: AssetRequesterContext
    includeDeleting?: boolean
}): Promise<Asset | { error: string }> => {
    const asset = await getAssetRecord(assetId)
    if (!asset || (!includeDeleting && asset.states.lifecycle === 'deleting')) return { error: 'NOT_FOUND' }
    if (!requester.organizationIds.includes(asset.organizationId)) return { error: 'PERMISSION_DENIED' }
    if (canReadBaseScope(asset, requester)) return asset
    const workspaceReferences = await Promise.all(requester.workspaceIds.map(async (workspaceId) =>
        await getReference(assetId, buildAssetWorkspaceReferenceKey(workspaceId))))
    if (workspaceReferences.some(Boolean)) return asset
    const access = await getAccess(assetId, requester.userId)
    if (!access) return { error: 'PERMISSION_DENIED' }
    return asset
}

const canEditAsset = async ({
    asset,
    requester,
    workspaceId,
}: {
    asset: Asset
    requester: AssetRequesterContext
    workspaceId: string
}): Promise<boolean> => {
    if (!requester.editableWorkspaceIds.includes(workspaceId)) return false
    if (asset.scope === 'workspace') {
        return asset.scopeOwnerId === workspaceId && requester.editableWorkspaceIds.includes(asset.scopeOwnerId)
    }
    if (asset.scope === 'user') {
        if (asset.scopeOwnerId === requester.userId) return true
        const access = await getAccess(asset.assetId, requester.userId)
        return access?.accessLevel === ACCESS_LEVEL.EDITOR || access?.accessLevel === ACCESS_LEVEL.OWNER
    }
    if (asset.ownerUserId === requester.userId) return true
    const access = await getAccess(asset.assetId, requester.userId)
    return access?.accessLevel === ACCESS_LEVEL.EDITOR || access?.accessLevel === ACCESS_LEVEL.OWNER
}

export const canEditAssetMetadata = async (
    asset: Asset,
    requester: AssetRequesterContext,
): Promise<boolean> => {
    const access = await getAccess(asset.assetId, requester.userId)
    if (asset.scope === 'workspace') return requester.editableWorkspaceIds.includes(asset.scopeOwnerId)
    if (asset.scope === 'user' && asset.scopeOwnerId === requester.userId) return true
    if (asset.ownerUserId === requester.userId) return true
    return access?.accessLevel === ACCESS_LEVEL.EDITOR || access?.accessLevel === ACCESS_LEVEL.OWNER
}

const buildAssetBlobReferences = async (asset: Asset): Promise<TransactOperation[]> => {
    const pointers: Array<{
        blobHash: string
        referenceKey: string
    }> = []

    for (const role of Object.keys(asset.documents) as AssetDocumentRole[]) {
        const pointer = asset.documents[role]
        if (!pointer) continue
        pointers.push({
            blobHash: pointer.blobHash,
            referenceKey: `asset#${asset.assetId}#document#${role}`,
        })
    }

    for (const [name, rendition] of Object.entries(asset.media?.renditions ?? {})) {
        if (rendition?.status !== 'ready' || !rendition.blobHash) continue
        pointers.push({
            blobHash: rendition.blobHash,
            referenceKey: `asset#${asset.assetId}#rendition#${name}`,
        })
    }

    if (pointers.length > 40) throw new Error('ASSET_BLOB_REFERENCE_LIMIT_EXCEEDED')

    const additions: Array<{ blob: BlobRecord; reference: BlobReference }> = []
    for (const pointer of pointers) {
        const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: pointer.blobHash })
        if (!blob) throw new Error(`BLOB_NOT_FOUND:${pointer.blobHash}`)
        const reference: BlobReference = {
            blobKey: blob.blobKey,
            blobHash: blob.blobHash,
            organizationId: blob.organizationId,
            referenceKey: pointer.referenceKey,
            ownerType: 'asset',
            ownerId: asset.assetId,
            createdAt: asset.createdAt,
        }
        additions.push({ blob, reference })
    }
    return buildBlobReferenceBatchOperations({ additions, now: asset.createdAt }).operations
}

type AssetListCursor = {
    partitions: Record<string, Record<string, unknown>>
}

const decodeCursor = (cursor?: string): AssetListCursor => {
    if (!cursor) return { partitions: {} }
    try {
        return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as AssetListCursor
    } catch {
        throw new Error('INVALID_CURSOR')
    }
}

const encodeCursor = (cursor: AssetListCursor): string =>
    Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')

type AssetCanvasNode = {
    nodeId: string
    assetId?: string
}

type AssetWorkspaceMutation = {
    expectedCanvasStateUpdatedAt: number
    canvasStateUpdatedAt: number
    canvasState: {
        viewport: unknown
        nodes: AssetCanvasNode[]
        edges: unknown[]
        [key: string]: unknown
    }
}

const getAssetMembership = (nodes: AssetCanvasNode[]): Map<string, Set<string>> => {
    const membership = new Map<string, Set<string>>()
    for (const node of nodes) {
        if (!node.assetId) continue
        const nodeIds = membership.get(node.assetId) ?? new Set<string>()
        nodeIds.add(node.nodeId)
        membership.set(node.assetId, nodeIds)
    }
    return membership
}

const assertSingleAssetMembershipMutation = ({
    beforeNodes,
    afterNodes,
    assetId,
    nodeId,
    operation,
}: {
    beforeNodes: AssetCanvasNode[]
    afterNodes: AssetCanvasNode[]
    assetId: string
    nodeId: string
    operation: 'attach' | 'detach'
}): void => {
    const before = getAssetMembership(beforeNodes)
    const after = getAssetMembership(afterNodes)
    const assetIds = new Set([...before.keys(), ...after.keys()])
    for (const currentAssetId of assetIds) {
        const beforeNodeIds = before.get(currentAssetId) ?? new Set<string>()
        const afterNodeIds = after.get(currentAssetId) ?? new Set<string>()
        const added = [...afterNodeIds].filter((currentNodeId) => !beforeNodeIds.has(currentNodeId))
        const removed = [...beforeNodeIds].filter((currentNodeId) => !afterNodeIds.has(currentNodeId))
        const isExpected = currentAssetId === assetId
            && (operation === 'attach'
                ? added.length === 1 && added[0] === nodeId && removed.length === 0
                : removed.length === 1 && removed[0] === nodeId && added.length === 0)
        if ((added.length > 0 || removed.length > 0) && !isExpected) {
            throw new Error('CANVAS_ASSET_MEMBERSHIP_MUTATION_REJECTED')
        }
    }
}

export const buildAssetProjectionOperations = async (
    asset: Asset,
    options: { includeBaseScope?: boolean; excludePrincipalIds?: string[] } = {},
): Promise<TransactOperation[]> => {
    const accessRows = await listAccess(asset.assetId)
    const excludedPrincipalIds = new Set(options.excludePrincipalIds ?? [])
    const scopeKeys = [
        ...(options.includeBaseScope ?? Boolean(await getReference(
            asset.assetId,
            buildAssetCatalogReferenceKey(asset.scope, asset.scopeOwnerId),
        )) ? [buildAssetScopeAndOwnerKey(asset.scope, asset.scopeOwnerId)] : []),
        ...accessRows
            .filter((row) => row.principalId !== asset.ownerUserId && !excludedPrincipalIds.has(row.principalId))
            .map((row) => buildAssetPrincipalScopeKey(row.principalId)),
    ]
    const uniqueScopeKeys = [...new Set(scopeKeys)]
    if (uniqueScopeKeys.length > MAX_ASSET_META_PROJECTIONS) {
        throw new Error('ASSET_PROJECTION_LIMIT_EXCEEDED')
    }
    return uniqueScopeKeys.map((scopeAndOwner) => ({
        type: 'put',
        tableName: assetsMetaTableName(),
        item: buildAssetMeta(asset, scopeAndOwner),
    }))
}

const getWorkspaceMutationOperations = async ({
    workspaceId,
    mutation,
    assetId,
    nodeId,
    operation,
}: {
    workspaceId: string
    mutation: AssetWorkspaceMutation
    assetId: string
    nodeId: string
    operation: 'attach' | 'detach'
}): Promise<TransactOperation[]> => {
    const workspace = await dynamoDBService.getItem({
        tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
        key: { workspaceId },
        consistentRead: true,
        origin: `Asset.${operation}.getWorkspace`,
    }) as {
        canvasState?: { nodes?: AssetCanvasNode[] }
        canvasStateUpdatedAt?: number
        updatedAt?: number
        deletingAt?: number
    } | undefined
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')
    if (workspace.deletingAt) throw new Error('WORKSPACE_DELETING')
    if ((workspace.canvasStateUpdatedAt ?? workspace.updatedAt) !== mutation.expectedCanvasStateUpdatedAt) {
        throw new Error('STALE_CANVAS_STATE')
    }
    assertSingleAssetMembershipMutation({
        beforeNodes: workspace.canvasState?.nodes ?? [],
        afterNodes: mutation.canvasState.nodes,
        assetId,
        nodeId,
        operation,
    })
    for (const node of mutation.canvasState.nodes as Array<AssetCanvasNode & Record<string, unknown>>) {
        for (const field of ['fileId', 'posterFileId', 'frameFileId', 'src', 'posterSrc', 'referenceId', 'aiChatThreadId']) {
            if (field in node) throw new Error(`LEGACY_CANVAS_STORAGE_FIELD_REJECTED:${field}`)
        }
    }
    return [
        {
            type: 'update',
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            updates: {
                canvasState: mutation.canvasState,
                canvasStateUpdatedAt: mutation.canvasStateUpdatedAt,
                updatedAt: mutation.canvasStateUpdatedAt,
            },
            conditionExpression: '(#canvasStateUpdatedAt = :expectedCanvasStateUpdatedAt OR (attribute_not_exists(#canvasStateUpdatedAt) AND #updatedAt = :expectedCanvasStateUpdatedAt)) AND attribute_not_exists(#deletingAt)',
            expressionAttributeNames: {
                '#canvasStateUpdatedAt': 'canvasStateUpdatedAt',
                '#updatedAt': 'updatedAt',
                '#deletingAt': 'deletingAt',
            },
            expressionAttributeValues: { ':expectedCanvasStateUpdatedAt': mutation.expectedCanvasStateUpdatedAt },
        },
        {
            type: 'update',
            tableName: getDynamoDbTableStageName('WORKSPACES_META', ORG_NAME, STAGE),
            key: { workspaceId },
            updates: { updatedAt: mutation.canvasStateUpdatedAt },
        },
    ]
}

type CreateAssetInput = Pick<
    Asset,
    | 'organizationId'
    | 'title'
    | 'scope'
    | 'scopeOwnerId'
    | 'originWorkspaceId'
    | 'ownerUserId'
> & Partial<Pick<
    Asset,
    | 'assetId'
    | 'documents'
    | 'media'
    | 'lineage'
    | 'generatedOutputReview'
    | 'descriptor'
    | 'states'
    | 'importedFromAssetId'
>> & {
    workspaceReference?: Pick<AssetReference, 'workspaceId' | 'nodeIds' | 'surfaceIds'>
}

const assertAssetComponents = (asset: Asset): void => {
    if (!asset.media && !asset.lineage && Object.keys(asset.documents).length === 0) {
        throw new Error('ASSET_COMPONENT_REQUIRED')
    }
    for (const [role, pointer] of Object.entries(asset.documents)) {
        if (!['content', 'conversation', 'provenance'].includes(role)
            || !pointer
            || pointer.role !== role
            || !/^[a-f0-9]{64}$/.test(pointer.blobHash)) {
            throw new Error(`INVALID_ASSET_DOCUMENT_POINTER:${role}`)
        }
        if (!Number.isSafeInteger(pointer.version) || pointer.version < 0
            || !Number.isSafeInteger(pointer.byteSize) || pointer.byteSize < 0
            || !pointer.schemaVersion) throw new Error(`INVALID_ASSET_DOCUMENT_POINTER:${role}`)
        if (role === 'provenance' && !Number.isSafeInteger(pointer.sealedAt)) {
            throw new Error('UNSEALED_ASSET_PROVENANCE')
        }
    }
    const hasConversation = Boolean(asset.documents.conversation)
    if (hasConversation === (asset.states.conversation === 'none')) {
        throw new Error('INVALID_ASSET_CONVERSATION_STATE')
    }
    if (asset.documents.provenance && !['sealed', 'failed', 'cancelled'].includes(asset.states.provenance)) {
        throw new Error('INVALID_ASSET_PROVENANCE_STATE')
    }
    if (!asset.documents.provenance && asset.states.provenance !== 'none' && !asset.lineage) {
        throw new Error('INVALID_ASSET_PROVENANCE_STATE')
    }
    if (asset.media) {
        if (!['image', 'video', 'audio', 'document'].includes(asset.media.kind)) {
            throw new Error('INVALID_ASSET_MEDIA_KIND')
        }
        if (asset.states.media === 'none') throw new Error('INVALID_ASSET_MEDIA_STATE')
        const original = asset.media.renditions.original
        if (original?.status !== 'ready' || !original.blobHash) throw new Error('ASSET_ORIGINAL_RENDITION_REQUIRED')
        for (const [name, rendition] of Object.entries(asset.media.renditions)) {
            if (!['original', 'canonical', 'preview', 'thumbnail', 'poster', 'representativeFrame'].includes(name)
                || !rendition
                || rendition.name !== name) throw new Error(`INVALID_ASSET_RENDITION:${name}`)
            if (rendition.status === 'ready'
                && (!rendition.blobHash || !rendition.mimeType || !Number.isSafeInteger(rendition.byteSize))) {
                throw new Error(`INVALID_ASSET_RENDITION:${name}`)
            }
        }
    } else if (!asset.lineage && asset.states.media !== 'none') {
        throw new Error('INVALID_ASSET_MEDIA_STATE')
    }
    if (asset.lineage) {
        if (!Array.isArray(asset.lineage.sourceAssetIds)) throw new Error('INVALID_ASSET_LINEAGE')
        const lineageIds = [
            asset.lineage.sourceConversationAssetId,
            asset.lineage.parentAssetId,
            ...asset.lineage.sourceAssetIds,
        ]
        if (lineageIds.some((lineageId) => lineageId === asset.assetId)) throw new Error('SELF_REFERENTIAL_ASSET_LINEAGE')
    }
    if (asset.generatedOutputReview && !asset.lineage) throw new Error('GENERATED_OUTPUT_REVIEW_REQUIRES_LINEAGE')
    if (asset.descriptor && !isValidDescriptor(asset.descriptor)) throw new Error('INVALID_ASSET_DESCRIPTOR')
}

const AssetModel = {
    create: async ({
        assetId: requestedAssetId,
        organizationId,
        title,
        scope,
        scopeOwnerId,
        originWorkspaceId,
        ownerUserId,
        documents = {},
        media,
        lineage,
        generatedOutputReview,
        descriptor,
        states,
        importedFromAssetId,
        workspaceReference,
    }: CreateAssetInput): Promise<Asset> => {
        if (!title.trim()) throw new Error('TITLE_REQUIRED')
        if (scope === 'organization' && scopeOwnerId !== organizationId) throw new Error('INVALID_ORGANIZATION_SCOPE_OWNER')
        if (scope === 'workspace' && scopeOwnerId !== originWorkspaceId) throw new Error('INVALID_WORKSPACE_SCOPE_OWNER')
        if (scope === 'user' && scopeOwnerId !== ownerUserId) throw new Error('INVALID_USER_SCOPE_OWNER')

        const originWorkspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId: originWorkspaceId },
            consistentRead: true,
            origin: 'Asset.create.validateOriginWorkspace',
        }) as { organizationId?: string; deletingAt?: number } | undefined
        if (!originWorkspace) throw new Error('WORKSPACE_NOT_FOUND')
        if (originWorkspace.organizationId !== organizationId) throw new Error('ORGANIZATION_BOUNDARY_VIOLATION')
        if (originWorkspace.deletingAt) throw new Error('WORKSPACE_DELETING')

        await ensureOrganizationAssetStorage(organizationId)
        const now = Date.now()
        const assetId = requestedAssetId ?? uuid()
        let resolvedDocuments = documents
        if (Object.keys(resolvedDocuments).length === 0 && (media || lineage)) {
            const snapshotBytes = Buffer.from(JSON.stringify({
                type: 'doc',
                content: [{ type: 'paragraph' }],
            }), 'utf8')
            const snapshotBlob = await BlobModel.store({
                organizationId,
                bytes: snapshotBytes,
                mimeType: 'application/json',
                description: `Initial content snapshot for Asset ${assetId}`,
            })
            resolvedDocuments = {
                content: {
                    role: 'content',
                    blobHash: snapshotBlob.blobHash,
                    version: 0,
                    schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                    byteSize: snapshotBytes.byteLength,
                    updatedAt: now,
                },
            }
        }
        const catalogReference: AssetReference = {
            assetId,
            referenceKey: buildAssetCatalogReferenceKey(scope, scopeOwnerId),
            type: 'catalog',
            scope,
            scopeOwnerId,
            createdAt: now,
            updatedAt: now,
        }
        const initialWorkspaceReference = workspaceReference?.workspaceId
            ? {
                assetId,
                referenceKey: buildAssetWorkspaceReferenceKey(workspaceReference.workspaceId),
                type: 'workspace' as const,
                workspaceId: workspaceReference.workspaceId,
                nodeIds: [...new Set(workspaceReference.nodeIds ?? [])],
                surfaceIds: [...new Set(workspaceReference.surfaceIds ?? [])],
                createdAt: now,
                updatedAt: now,
            }
            : undefined
        if (initialWorkspaceReference
            && (initialWorkspaceReference.workspaceId !== originWorkspaceId
                || (initialWorkspaceReference.nodeIds.length === 0 && initialWorkspaceReference.surfaceIds.length === 0))) {
            throw new Error('INVALID_INITIAL_WORKSPACE_REFERENCE')
        }
        const asset: Asset = {
            assetId,
            organizationId,
            title: title.trim(),
            scope,
            scopeOwnerId,
            originWorkspaceId,
            ownerUserId,
            documents: resolvedDocuments,
            ...(media ? { media } : {}),
            ...(lineage ? { lineage } : {}),
            ...(generatedOutputReview ? { generatedOutputReview } : {}),
            ...(descriptor ? { descriptor } : {}),
            states: states ?? {
                lifecycle: media ? 'creating' : 'active',
                media: media ? 'processing' : 'none',
                conversation: resolvedDocuments.conversation ? 'idle' : 'none',
                provenance: resolvedDocuments.provenance ? 'sealed' : 'none',
            },
            referenceCount: initialWorkspaceReference ? 2 : 1,
            revision: 1,
            ...(importedFromAssetId ? { importedFromAssetId } : {}),
            createdAt: now,
            updatedAt: now,
        }
        assertAssetComponents(asset)
        const ownerAccess: AssetAccessList = {
            assetId,
            principalId: ownerUserId,
            accessLevel: ACCESS_LEVEL.OWNER,
            createdAt: now,
            updatedAt: now,
        }
        const blobReferences = await buildAssetBlobReferences(asset)

        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId: originWorkspaceId },
                    updateExpression: 'SET #updatedAt = #updatedAt',
                    conditionExpression: '#organizationId = :organizationId AND attribute_not_exists(#deletingAt)',
                    expressionAttributeNames: {
                        '#updatedAt': 'updatedAt',
                        '#organizationId': 'organizationId',
                        '#deletingAt': 'deletingAt',
                    },
                    expressionAttributeValues: { ':organizationId': organizationId },
                },
                {
                    type: 'put',
                    tableName: assetsTableName(),
                    item: asset,
                    conditionExpression: 'attribute_not_exists(#assetId)',
                    expressionAttributeNames: { '#assetId': 'assetId' },
                },
                { type: 'put', tableName: assetsMetaTableName(), item: buildAssetMeta(asset) },
                { type: 'put', tableName: assetsAccessListTableName(), item: ownerAccess },
                { type: 'put', tableName: assetReferencesTableName(), item: catalogReference },
                ...(initialWorkspaceReference
                    ? [{ type: 'put' as const, tableName: assetReferencesTableName(), item: initialWorkspaceReference }]
                    : []),
                ...blobReferences,
            ],
            origin: 'Asset.create',
        })

        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.CREATED, asset)
        return asset
    },

    get: async ({
        assetId,
        requester,
    }: {
        assetId: string
        requester: AssetRequesterContext
    }): Promise<Asset | { error: string }> => await getAuthorizedAsset({ assetId, requester }),

    listAvailable: async ({
        scopeAndOwners,
        principalId,
        organizationIds,
        limit = 25,
        cursor,
        primaryCategory,
    }: {
        scopeAndOwners: string[]
        principalId: string
        organizationIds: string[]
        limit?: number
        cursor?: string
        primaryCategory?: AssetPrimaryCategory
    }): Promise<{ items: AssetMeta[]; cursor?: string }> => {
        const pageSize = Math.min(Math.max(limit, 1), 100)
        const allowedOrganizationIds = new Set(organizationIds)
        const partitions = [...new Set([...scopeAndOwners, buildAssetPrincipalScopeKey(principalId)])]
        const decoded = decodeCursor(cursor)
        const fetchLimit = Math.min(Math.max(pageSize * 2, 25), 100)
        const pages = await Promise.all(partitions.map(async (scopeAndOwner) => {
            const result = await dynamoDBService.queryItems({
                tableName: assetsMetaTableName(),
                indexName: 'updatedAt',
                keyConditions: { scopeAndOwner },
                limit: fetchLimit,
                scanIndexForward: false,
                consistentRead: true,
                exclusiveStartKey: decoded.partitions[scopeAndOwner],
                origin: `Asset.listAvailable(${scopeAndOwner})`,
            })
            return {
                scopeAndOwner,
                items: (result?.items ?? []) as AssetMeta[],
                lastEvaluatedKey: result?.lastEvaluatedKey as Record<string, unknown> | undefined,
            }
        }))
        const merged = pages
            .flatMap((page) => page.items.map((item) => ({ item, partition: page.scopeAndOwner })))
            .sort((left, right) => right.item.updatedAt - left.item.updatedAt || left.item.assetId.localeCompare(right.item.assetId))

        const items: AssetMeta[] = []
        const seen = new Set<string>()
        const nextPartitions = { ...decoded.partitions }
        let stoppedBeforeEnd = false
        for (const entry of merged) {
            const isDuplicate = seen.has(entry.item.assetId)
            if (items.length >= pageSize && !isDuplicate) {
                stoppedBeforeEnd = true
                break
            }
            nextPartitions[entry.partition] = {
                scopeAndOwner: entry.item.scopeAndOwner,
                assetId: entry.item.assetId,
                updatedAt: entry.item.updatedAt,
            }
            if (!allowedOrganizationIds.has(entry.item.organizationId)) continue
            if (entry.item.lifecycleStatus === 'deleting') continue
            if (primaryCategory && entry.item.primaryCategory !== primaryCategory) continue
            if (isDuplicate) continue
            seen.add(entry.item.assetId)
            items.push(entry.item)
        }

        const hasMore = stoppedBeforeEnd || pages.some((page) => page.lastEvaluatedKey)
        return {
            items,
            ...(hasMore ? { cursor: encodeCursor({ partitions: nextPartitions }) } : {}),
        }
    },

    updateMetadata: async ({
        assetId,
        requester,
        expectedRevision,
        title,
        descriptor,
    }: {
        assetId: string
        requester: AssetRequesterContext
        expectedRevision: number
        title?: string
        descriptor?: Asset['descriptor']
    }): Promise<Asset | { error: string }> => {
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (!await canEditAssetMetadata(authorized, requester)) return { error: 'PERMISSION_DENIED' }
        if (authorized.revision !== expectedRevision) return { error: 'REVISION_CONFLICT' }
        if (title !== undefined && !title.trim()) return { error: 'TITLE_REQUIRED' }
        if (descriptor !== undefined && !isValidDescriptor(descriptor)) return { error: 'INVALID_DESCRIPTOR' }

        const now = Date.now()
        const next: Asset = {
            ...authorized,
            ...(title !== undefined ? { title: title.trim() } : {}),
            ...(descriptor !== undefined ? { descriptor } : {}),
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        title: next.title,
                        ...(descriptor !== undefined ? { descriptor } : {}),
                        revision: next.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': expectedRevision },
                },
                ...await buildAssetProjectionOperations(next),
            ],
            origin: 'Asset.updateMetadata',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        return next
    },

    updateGeneratedOutputReview: async ({
        assetId,
        requester,
        status,
        supersededByAssetId,
        regenerationMode,
    }: {
        assetId: string
        requester: AssetRequesterContext
        status: 'accepted' | 'superseded'
        supersededByAssetId?: string
        regenerationMode?: 'existing-prompt' | 'regenerate-prompt'
    }): Promise<Asset | { error: string }> => {
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (!await canEditAssetMetadata(authorized, requester)) return { error: 'PERMISSION_DENIED' }
        if (!authorized.lineage) return { error: 'NOT_GENERATED_OUTPUT' }
        if (authorized.generatedOutputReview?.status === status) return authorized
        if (authorized.generatedOutputReview?.status === 'accepted') return { error: 'ACCEPTED_OUTPUT_IMMUTABLE' }
        if (status === 'accepted') {
            if (authorized.media?.renditions.original?.status !== 'ready') return { error: 'GENERATED_OUTPUT_NOT_READY' }
            if (!authorized.documents.provenance || authorized.states.provenance !== 'sealed') {
                return { error: 'GENERATED_OUTPUT_PROVENANCE_NOT_READY' }
            }
        }

        const now = Date.now()
        const generatedOutputReview = status === 'accepted'
            ? {
                status,
                acceptedAt: now,
                acceptedBy: requester.userId,
            } as const
            : {
                status,
                supersededAt: now,
                ...(supersededByAssetId ? { supersededByAssetId } : {}),
                ...(regenerationMode ? { regenerationMode } : {}),
            } as const
        const next: Asset = {
            ...authorized,
            generatedOutputReview,
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        generatedOutputReview,
                        revision: next.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': authorized.revision },
                },
                ...await buildAssetProjectionOperations(next),
            ],
            origin: 'Asset.updateGeneratedOutputReview',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        return next
    },

    changeScope: async ({
        assetId,
        requester,
        expectedRevision,
        scope,
        scopeOwnerId,
    }: {
        assetId: string
        requester: AssetRequesterContext
        expectedRevision: number
        scope: AssetScope
        scopeOwnerId: string
    }): Promise<Asset | { error: string }> => {
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (authorized.ownerUserId !== requester.userId) return { error: 'PERMISSION_DENIED' }
        if (authorized.revision !== expectedRevision) return { error: 'REVISION_CONFLICT' }
        if (authorized.scope === scope && authorized.scopeOwnerId === scopeOwnerId) return authorized
        if (scope === 'organization' && scopeOwnerId !== authorized.organizationId) return { error: 'INVALID_SCOPE_OWNER' }
        if (scope === 'user' && scopeOwnerId !== authorized.ownerUserId) return { error: 'INVALID_SCOPE_OWNER' }
        if (scope === 'workspace') {
            if (!requester.editableWorkspaceIds.includes(scopeOwnerId)) return { error: 'INVALID_SCOPE_OWNER' }
            const targetWorkspace = await dynamoDBService.getItem({
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId: scopeOwnerId },
                consistentRead: true,
                origin: 'Asset.changeScope.validateTargetWorkspace',
            }) as { organizationId?: string; deletingAt?: number } | undefined
            if (!targetWorkspace
                || targetWorkspace.organizationId !== authorized.organizationId
                || targetWorkspace.deletingAt) return { error: 'INVALID_SCOPE_OWNER' }
        }

        const references = await listReferences(assetId)
        const referencedWorkspaceIds = references
            .filter((reference) => reference.type === 'workspace' && reference.workspaceId)
            .map((reference) => reference.workspaceId!)
        if (scope === 'workspace' && referencedWorkspaceIds.some((workspaceId) => workspaceId !== scopeOwnerId)) {
            return { error: 'SCOPE_WOULD_BREAK_REFERENCE' }
        }
        if (scope === 'user') {
            const allowedWorkspaces = new Set(requester.workspaceIds)
            if (referencedWorkspaceIds.some((workspaceId) => !allowedWorkspaces.has(workspaceId))) {
                return { error: 'SCOPE_WOULD_BREAK_REFERENCE' }
            }
        }
        if (scope === 'organization') {
            const workspaces = await Promise.all(referencedWorkspaceIds.map(async (workspaceId) =>
                await dynamoDBService.getItem({
                    tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                    key: { workspaceId },
                    consistentRead: true,
                    origin: 'Asset.changeScope.validateOrganizationWorkspace',
                }) as { organizationId?: string } | undefined))
            if (workspaces.some((workspace) => workspace?.organizationId !== scopeOwnerId)) {
                return { error: 'SCOPE_WOULD_BREAK_REFERENCE' }
            }
        }

        const now = Date.now()
        const next: Asset = {
            ...authorized,
            scope,
            scopeOwnerId,
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        const oldScopeKey = buildAssetScopeAndOwnerKey(authorized.scope, authorized.scopeOwnerId)
        const oldCatalogKey = buildAssetCatalogReferenceKey(authorized.scope, authorized.scopeOwnerId)
        const oldCatalogReference = references.find((reference) => reference.referenceKey === oldCatalogKey)
        if (!oldCatalogReference) return { error: 'ASSET_NOT_CATALOGED' }
        const newCatalogReference: AssetReference = {
            assetId,
            referenceKey: buildAssetCatalogReferenceKey(scope, scopeOwnerId),
            type: 'catalog',
            scope,
            scopeOwnerId,
            createdAt: oldCatalogReference.createdAt,
            updatedAt: now,
        }

        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: { scope, scopeOwnerId, revision: next.revision, updatedAt: now },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': expectedRevision },
                },
                { type: 'delete', tableName: assetsMetaTableName(), key: { scopeAndOwner: oldScopeKey, assetId } },
                ...await buildAssetProjectionOperations(next, { includeBaseScope: true }),
                { type: 'delete', tableName: assetReferencesTableName(), key: { assetId, referenceKey: oldCatalogKey } },
                { type: 'put', tableName: assetReferencesTableName(), item: newCatalogReference },
            ],
            origin: 'Asset.changeScope',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        return next
    },

    grantAccess: async ({
        assetId,
        requester,
        principalId,
        accessLevel,
    }: {
        assetId: string
        requester: AssetRequesterContext
        principalId: string
        accessLevel: 'viewer' | 'editor'
    }): Promise<AssetAccessList | { error: string }> => {
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (authorized.ownerUserId !== requester.userId) return { error: 'PERMISSION_DENIED' }
        if (principalId === authorized.ownerUserId) return { error: 'PERMISSION_DENIED' }
        const now = Date.now()
        const existing = await getAccess(assetId, principalId)
        const next: Asset = {
            ...authorized,
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        const grant: AssetAccessList = {
            assetId,
            principalId,
            accessLevel,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        }
        const projectionOperations = await buildAssetProjectionOperations(next)
        if (!existing && projectionOperations.length >= MAX_ASSET_META_PROJECTIONS) {
            return { error: 'ASSET_PROJECTION_LIMIT_EXCEEDED' }
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: { revision: next.revision, updatedAt: now },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': authorized.revision },
                },
                {
                    type: 'put',
                    tableName: assetsAccessListTableName(),
                    item: grant,
                    conditionExpression: existing ? '#updatedAt = :expectedUpdatedAt' : 'attribute_not_exists(#principalId)',
                    expressionAttributeNames: existing
                        ? { '#updatedAt': 'updatedAt' }
                        : { '#principalId': 'principalId' },
                    ...(existing ? { expressionAttributeValues: { ':expectedUpdatedAt': existing.updatedAt } } : {}),
                },
                ...projectionOperations,
                ...(!existing ? [{
                    type: 'put',
                    tableName: assetsMetaTableName(),
                    item: buildAssetMeta(next, buildAssetPrincipalScopeKey(principalId)),
                } as TransactOperation] : []),
            ],
            origin: 'Asset.grantAccess',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        return grant
    },

    revokeAccess: async ({
        assetId,
        requester,
        principalId,
    }: {
        assetId: string
        requester: AssetRequesterContext
        principalId: string
    }): Promise<{ success: true } | { error: string }> => {
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (authorized.ownerUserId !== requester.userId || principalId === authorized.ownerUserId) {
            return { error: 'PERMISSION_DENIED' }
        }
        const existing = await getAccess(assetId, principalId)
        if (!existing) return { success: true }
        const now = Date.now()
        const next: Asset = {
            ...authorized,
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: { revision: next.revision, updatedAt: now },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': authorized.revision },
                },
                {
                    type: 'delete',
                    tableName: assetsAccessListTableName(),
                    key: { assetId, principalId },
                    conditionExpression: '#updatedAt = :expectedUpdatedAt',
                    expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                    expressionAttributeValues: { ':expectedUpdatedAt': existing.updatedAt },
                },
                {
                    type: 'delete',
                    tableName: assetsMetaTableName(),
                    key: { scopeAndOwner: buildAssetPrincipalScopeKey(principalId), assetId },
                },
                ...await buildAssetProjectionOperations(next, { excludePrincipalIds: [principalId] }),
            ],
            origin: 'Asset.revokeAccess',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        return { success: true }
    },

    acquireLease: async ({
        assetId,
        workspaceId,
        holderId,
        requester,
    }: {
        assetId: string
        workspaceId: string
        holderId: string
        requester: AssetRequesterContext
    }): Promise<Asset['editLease'] | { error: string }> => {
        if (!holderId) return { error: 'LEASE_HOLDER_REQUIRED' }
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const authorized = await getAuthorizedAsset({ assetId, requester })
            if ('error' in authorized) return authorized
            if (!await canEditAsset({ asset: authorized, requester, workspaceId })) return { error: 'PERMISSION_DENIED' }
            const now = Date.now()
            const current = authorized.editLease
            if (current && current.expiresAt > now && current.workspaceId !== workspaceId) {
                return { error: 'LEASE_HELD' }
            }
            const expiresAt = now + ASSET_EDIT_LEASE_DURATION_MS
            const activeHolders = current?.workspaceId === workspaceId && current.expiresAt > now
                ? current.holders.filter((holder) => holder.expiresAt > now && holder.holderId !== holderId)
                : []
            const editLease: NonNullable<Asset['editLease']> = {
                workspaceId,
                leaseId: current?.workspaceId === workspaceId && current.expiresAt > now ? current.leaseId : uuid(),
                holders: [...activeHolders, { holderId, expiresAt }],
                acquiredAt: current?.workspaceId === workspaceId && current.expiresAt > now ? current.acquiredAt : now,
                renewedAt: now,
                expiresAt,
            }
            try {
                await dynamoDBService.updateItem({
                    tableName: assetsTableName(),
                    key: { assetId },
                    updateExpression: 'SET #editLease = :editLease',
                    conditionExpression: current
                        ? '#editLease = :expectedEditLease'
                        : 'attribute_not_exists(#editLease)',
                    expressionAttributeNames: { '#editLease': 'editLease' },
                    expressionAttributeValues: {
                        ':editLease': editLease,
                        ...(current ? { ':expectedEditLease': current } : {}),
                    },
                    logConditionalCheckFailures: false,
                    origin: 'Asset.acquireLease',
                })
                return editLease
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error)) throw error
            }
        }
        return { error: 'LEASE_CONFLICT' }
    },

    renewLease: async ({
        assetId,
        workspaceId,
        leaseId,
        holderId,
    }: {
        assetId: string
        workspaceId: string
        leaseId: string
        holderId: string
    }): Promise<Asset['editLease'] | { error: string }> => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const asset = await getAssetRecord(assetId)
            const now = Date.now()
            const current = asset?.editLease
            if (!asset || asset.states.lifecycle === 'deleting'
                || !current
                || current.workspaceId !== workspaceId
                || current.leaseId !== leaseId
                || current.expiresAt <= now
                || !current.holders.some((holder) => holder.holderId === holderId && holder.expiresAt > now)) {
                return { error: 'LEASE_INVALID' }
            }
            const holderExpiresAt = now + ASSET_EDIT_LEASE_DURATION_MS
            const holders = current.holders
                .filter((holder) => holder.expiresAt > now && holder.holderId !== holderId)
                .concat({ holderId, expiresAt: holderExpiresAt })
            const editLease: NonNullable<Asset['editLease']> = {
                ...current,
                holders,
                renewedAt: now,
                expiresAt: Math.max(...holders.map((holder) => holder.expiresAt)),
            }
            try {
                await dynamoDBService.updateItem({
                    tableName: assetsTableName(),
                    key: { assetId },
                    updateExpression: 'SET #editLease = :editLease',
                    conditionExpression: '#editLease = :expectedEditLease',
                    expressionAttributeNames: { '#editLease': 'editLease' },
                    expressionAttributeValues: { ':editLease': editLease, ':expectedEditLease': current },
                    logConditionalCheckFailures: false,
                    origin: 'Asset.renewLease',
                })
                return editLease
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error)) throw error
            }
        }
        return { error: 'LEASE_CONFLICT' }
    },

    releaseLease: async ({
        assetId,
        workspaceId,
        leaseId,
        holderId,
    }: {
        assetId: string
        workspaceId: string
        leaseId: string
        holderId: string
    }): Promise<{ success: true } | { error: string }> => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const asset = await getAssetRecord(assetId)
            const current = asset?.editLease
            if (!current) return { success: true }
            if (current.workspaceId !== workspaceId || current.leaseId !== leaseId) return { error: 'LEASE_INVALID' }
            if (!current.holders.some((holder) => holder.holderId === holderId)) return { success: true }
            const now = Date.now()
            const holders = current.holders.filter((holder) => holder.holderId !== holderId && holder.expiresAt > now)
            try {
                await dynamoDBService.updateItem({
                    tableName: assetsTableName(),
                    key: { assetId },
                    updateExpression: holders.length > 0 ? 'SET #editLease = :editLease' : 'REMOVE #editLease',
                    conditionExpression: '#editLease = :expectedEditLease',
                    expressionAttributeNames: { '#editLease': 'editLease' },
                    expressionAttributeValues: {
                        ':expectedEditLease': current,
                        ...(holders.length > 0 ? {
                            ':editLease': {
                                ...current,
                                holders,
                                renewedAt: now,
                                expiresAt: Math.max(...holders.map((holder) => holder.expiresAt)),
                            },
                        } : {}),
                    },
                    logConditionalCheckFailures: false,
                    origin: 'Asset.releaseLease',
                })
                return { success: true }
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error)) throw error
            }
        }
        return { error: 'LEASE_CONFLICT' }
    },

    updateConversationStateSystem: async ({
        assetId,
        organizationId,
        conversation,
        expectedConversation,
    }: {
        assetId: string
        organizationId: string
        conversation: Asset['states']['conversation']
        expectedConversation?: Asset['states']['conversation']
    }): Promise<Asset> => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const asset = await getAssetRecord(assetId)
            if (!asset || asset.organizationId !== organizationId || !asset.documents.conversation) {
                throw new Error('CONVERSATION_ASSET_NOT_FOUND')
            }
            if (asset.states.lifecycle === 'deleting') throw new Error('CONVERSATION_ASSET_NOT_FOUND')
            if (expectedConversation && asset.states.conversation !== expectedConversation) return asset
            if (asset.states.conversation === conversation) return asset
            const now = Date.now()
            const next: Asset = {
                ...asset,
                states: { ...asset.states, conversation },
                revision: asset.revision + 1,
                updatedAt: now,
            }
            try {
                await dynamoDBService.transactWrite({
                    operations: [
                        {
                            type: 'update',
                            tableName: assetsTableName(),
                            key: { assetId },
                            updates: { states: next.states, revision: next.revision, updatedAt: now },
                            conditionExpression: expectedConversation
                                ? '#revision = :expectedRevision AND #states.#conversation = :expectedConversation'
                                : '#revision = :expectedRevision',
                            expressionAttributeNames: {
                                '#revision': 'revision',
                                ...(expectedConversation ? { '#states': 'states', '#conversation': 'conversation' } : {}),
                            },
                            expressionAttributeValues: {
                                ':expectedRevision': asset.revision,
                                ...(expectedConversation ? { ':expectedConversation': expectedConversation } : {}),
                            },
                        },
                        ...await buildAssetProjectionOperations(next),
                    ],
                    logConditionalCheckFailures: false,
                    origin: 'Asset.updateConversationStateSystem',
                })
                publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
                return next
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error)) throw error
            }
        }
        throw new Error('CONVERSATION_STATE_CONFLICT')
    },

    claimConversationReceivingSystem: async ({
        assetId,
        organizationId,
    }: {
        assetId: string
        organizationId: string
    }): Promise<Asset | { error: 'CONVERSATION_BUSY' }> => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const asset = await getAssetRecord(assetId)
            if (!asset || asset.organizationId !== organizationId || !asset.documents.conversation
                || asset.states.lifecycle === 'deleting') {
                throw new Error('CONVERSATION_ASSET_NOT_FOUND')
            }
            if (asset.states.conversation === 'receiving') return { error: 'CONVERSATION_BUSY' }
            const now = Date.now()
            const next: Asset = {
                ...asset,
                states: { ...asset.states, conversation: 'receiving' },
                revision: asset.revision + 1,
                updatedAt: now,
            }
            try {
                await dynamoDBService.transactWrite({
                    operations: [
                        {
                            type: 'update',
                            tableName: assetsTableName(),
                            key: { assetId },
                            updates: { states: next.states, revision: next.revision, updatedAt: now },
                            conditionExpression: '#revision = :expectedRevision AND #states.#conversation = :expectedConversation',
                            expressionAttributeNames: {
                                '#revision': 'revision',
                                '#states': 'states',
                                '#conversation': 'conversation',
                            },
                            expressionAttributeValues: {
                                ':expectedRevision': asset.revision,
                                ':expectedConversation': asset.states.conversation,
                            },
                        },
                        ...await buildAssetProjectionOperations(next),
                    ],
                    logConditionalCheckFailures: false,
                    origin: 'Asset.claimConversationReceivingSystem',
                })
                publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
                return next
            } catch (error) {
                if (!isTransactionConditionalCheckFailure(error)) throw error
            }
        }
        return { error: 'CONVERSATION_BUSY' }
    },

    attachWorkspaceReference: async ({
        assetId,
        workspaceId,
        requester,
        nodeId,
        surfaceId,
        workspaceMutation,
    }: {
        assetId: string
        workspaceId: string
        requester: AssetRequesterContext
        nodeId?: string
        surfaceId?: string
        workspaceMutation?: AssetWorkspaceMutation
    }): Promise<AssetReference | { error: string }> => {
        if (!nodeId && !surfaceId) return { error: 'PLACEMENT_REQUIRED' }
        if (nodeId && !workspaceMutation) return { error: 'CANVAS_MUTATION_REQUIRED' }
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (!requester.editableWorkspaceIds.includes(workspaceId)) return { error: 'PERMISSION_DENIED' }
        if (authorized.states.lifecycle !== 'active' && authorized.states.lifecycle !== 'creating') {
            return { error: 'ASSET_NOT_ATTACHABLE' }
        }
        if (authorized.scope === 'workspace' && authorized.scopeOwnerId !== workspaceId) {
            return { error: 'SCOPE_DENIES_WORKSPACE' }
        }
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            consistentRead: true,
            origin: 'Asset.attachWorkspaceReference.validateWorkspace',
        }) as { organizationId?: string; deletingAt?: number } | undefined
        if (!workspace) return { error: 'WORKSPACE_NOT_FOUND' }
        if (workspace.organizationId !== authorized.organizationId) return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
        if (workspace.deletingAt) return { error: 'WORKSPACE_DELETING' }

        const referenceKey = buildAssetWorkspaceReferenceKey(workspaceId)
        const existing = await getReference(assetId, referenceKey)
        const nextNodeIds = [...new Set([...(existing?.nodeIds ?? []), ...(nodeId ? [nodeId] : [])])]
        const nextSurfaceIds = [...new Set([...(existing?.surfaceIds ?? []), ...(surfaceId ? [surfaceId] : [])])]
        if (
            existing
            && nextNodeIds.length === (existing.nodeIds ?? []).length
            && nextSurfaceIds.length === (existing.surfaceIds ?? []).length
        ) {
            return existing
        }

        const now = workspaceMutation?.canvasStateUpdatedAt ?? Date.now()
        const reference: AssetReference = {
            assetId,
            referenceKey,
            type: 'workspace',
            workspaceId,
            nodeIds: nextNodeIds,
            surfaceIds: nextSurfaceIds,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        }
        const nextAsset: Asset = {
            ...authorized,
            referenceCount: authorized.referenceCount + (existing ? 0 : 1),
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        const workspaceOperations = nodeId && workspaceMutation
            ? await getWorkspaceMutationOperations({
                workspaceId,
                mutation: workspaceMutation,
                assetId,
                nodeId,
                operation: 'attach',
            })
            : []
        const workspaceGuardOperations: TransactOperation[] = workspaceOperations.length === 0
            ? [{
                type: 'update',
                tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
                key: { workspaceId },
                updateExpression: 'SET #updatedAt = #updatedAt',
                conditionExpression: '#organizationId = :organizationId AND attribute_not_exists(#deletingAt)',
                expressionAttributeNames: {
                    '#updatedAt': 'updatedAt',
                    '#organizationId': 'organizationId',
                    '#deletingAt': 'deletingAt',
                },
                expressionAttributeValues: { ':organizationId': authorized.organizationId },
            }]
            : []

        await dynamoDBService.transactWrite({
            operations: [
                ...workspaceOperations,
                ...workspaceGuardOperations,
                {
                    type: 'put',
                    tableName: assetReferencesTableName(),
                    item: reference,
                    conditionExpression: existing
                        ? '#updatedAt = :expectedUpdatedAt'
                        : 'attribute_not_exists(#referenceKey)',
                    expressionAttributeNames: existing
                        ? { '#updatedAt': 'updatedAt' }
                        : { '#referenceKey': 'referenceKey' },
                    ...(existing ? { expressionAttributeValues: { ':expectedUpdatedAt': existing.updatedAt } } : {}),
                },
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        referenceCount: nextAsset.referenceCount,
                        revision: nextAsset.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision AND #referenceCount = :expectedReferenceCount AND (#states.#lifecycle = :active OR #states.#lifecycle = :creating)',
                    expressionAttributeNames: {
                        '#revision': 'revision',
                        '#referenceCount': 'referenceCount',
                        '#states': 'states',
                        '#lifecycle': 'lifecycle',
                    },
                    expressionAttributeValues: {
                        ':expectedRevision': authorized.revision,
                        ':expectedReferenceCount': authorized.referenceCount,
                        ':active': 'active',
                        ':creating': 'creating',
                    },
                },
                ...await buildAssetProjectionOperations(nextAsset),
            ],
            origin: 'Asset.attachWorkspaceReference',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, nextAsset)
        return reference
    },

    detachWorkspaceReference: async ({
        assetId,
        workspaceId,
        requester,
        nodeId,
        surfaceId,
        workspaceMutation,
    }: {
        assetId: string
        workspaceId: string
        requester: AssetRequesterContext
        nodeId?: string
        surfaceId?: string
        workspaceMutation?: AssetWorkspaceMutation
    }): Promise<{ success: true; deleting: boolean } | { error: string }> => {
        if (!nodeId && !surfaceId) return { error: 'PLACEMENT_REQUIRED' }
        if (nodeId && !workspaceMutation) return { error: 'CANVAS_MUTATION_REQUIRED' }
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (!requester.editableWorkspaceIds.includes(workspaceId)) return { error: 'PERMISSION_DENIED' }

        const referenceKey = buildAssetWorkspaceReferenceKey(workspaceId)
        const existing = await getReference(assetId, referenceKey)
        if (!existing) return { success: true, deleting: false }
        const nextNodeIds = (existing.nodeIds ?? []).filter((currentNodeId) => currentNodeId !== nodeId)
        const nextSurfaceIds = (existing.surfaceIds ?? []).filter((currentSurfaceId) => currentSurfaceId !== surfaceId)
        if (
            nextNodeIds.length === (existing.nodeIds ?? []).length
            && nextSurfaceIds.length === (existing.surfaceIds ?? []).length
        ) {
            return { success: true, deleting: false }
        }

        const removesReference = nextNodeIds.length === 0 && nextSurfaceIds.length === 0
        const nextReferenceCount = authorized.referenceCount - (removesReference ? 1 : 0)
        if (nextReferenceCount < 0) return { error: 'REFERENCE_COUNT_CORRUPT' }
        const deleting = nextReferenceCount === 0
        const now = workspaceMutation?.canvasStateUpdatedAt ?? Date.now()
        const nextAsset: Asset = {
            ...authorized,
            states: deleting
                ? { ...authorized.states, lifecycle: 'deleting' }
                : authorized.states,
            referenceCount: nextReferenceCount,
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        const workspaceOperations = nodeId && workspaceMutation
            ? await getWorkspaceMutationOperations({
                workspaceId,
                mutation: workspaceMutation,
                assetId,
                nodeId,
                operation: 'detach',
            })
            : []
        const referenceOperation: TransactOperation = removesReference
            ? {
                type: 'delete',
                tableName: assetReferencesTableName(),
                key: { assetId, referenceKey },
                conditionExpression: '#updatedAt = :expectedUpdatedAt',
                expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                expressionAttributeValues: { ':expectedUpdatedAt': existing.updatedAt },
            }
            : {
                type: 'put',
                tableName: assetReferencesTableName(),
                item: {
                    ...existing,
                    nodeIds: nextNodeIds,
                    surfaceIds: nextSurfaceIds,
                    updatedAt: now,
                },
                conditionExpression: '#updatedAt = :expectedUpdatedAt',
                expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                expressionAttributeValues: { ':expectedUpdatedAt': existing.updatedAt },
            }

        await dynamoDBService.transactWrite({
            operations: [
                ...workspaceOperations,
                referenceOperation,
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        states: nextAsset.states,
                        referenceCount: nextReferenceCount,
                        revision: nextAsset.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision AND #referenceCount = :expectedReferenceCount',
                    expressionAttributeNames: {
                        '#revision': 'revision',
                        '#referenceCount': 'referenceCount',
                    },
                    expressionAttributeValues: {
                        ':expectedRevision': authorized.revision,
                        ':expectedReferenceCount': authorized.referenceCount,
                    },
                },
                ...await buildAssetProjectionOperations(nextAsset),
            ],
            origin: 'Asset.detachWorkspaceReference',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, nextAsset)
        if (deleting) {
            await enqueueAssetDeletion({
                organizationId: authorized.organizationId,
                assetId,
            })
        }
        return { success: true, deleting }
    },

    detachCatalogReference: async ({
        assetId,
        requester,
    }: {
        assetId: string
        requester: AssetRequesterContext
    }): Promise<{ success: true; deleting: boolean } | { error: string }> => {
        const authorized = await getAuthorizedAsset({ assetId, requester })
        if ('error' in authorized) return authorized
        if (authorized.ownerUserId !== requester.userId) return { error: 'PERMISSION_DENIED' }
        const referenceKey = buildAssetCatalogReferenceKey(authorized.scope, authorized.scopeOwnerId)
        const reference = await getReference(assetId, referenceKey)
        if (!reference) return { success: true, deleting: authorized.referenceCount === 0 }
        const nextReferenceCount = authorized.referenceCount - 1
        if (nextReferenceCount < 0) return { error: 'REFERENCE_COUNT_CORRUPT' }
        const deleting = nextReferenceCount === 0
        const now = Date.now()
        const nextAsset: Asset = {
            ...authorized,
            states: deleting ? { ...authorized.states, lifecycle: 'deleting' } : authorized.states,
            referenceCount: nextReferenceCount,
            revision: authorized.revision + 1,
            updatedAt: now,
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'delete',
                    tableName: assetReferencesTableName(),
                    key: { assetId, referenceKey },
                    conditionExpression: '#updatedAt = :expectedUpdatedAt',
                    expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                    expressionAttributeValues: { ':expectedUpdatedAt': reference.updatedAt },
                },
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        states: nextAsset.states,
                        referenceCount: nextReferenceCount,
                        revision: nextAsset.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision AND #referenceCount = :expectedReferenceCount',
                    expressionAttributeNames: {
                        '#revision': 'revision',
                        '#referenceCount': 'referenceCount',
                    },
                    expressionAttributeValues: {
                        ':expectedRevision': authorized.revision,
                        ':expectedReferenceCount': authorized.referenceCount,
                    },
                },
                {
                    type: 'delete',
                    tableName: assetsMetaTableName(),
                    key: {
                        scopeAndOwner: buildAssetScopeAndOwnerKey(authorized.scope, authorized.scopeOwnerId),
                        assetId,
                    },
                },
                ...await buildAssetProjectionOperations(nextAsset, { includeBaseScope: false }),
            ],
            origin: 'Asset.detachCatalogReference',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, nextAsset)
        if (deleting) {
            await enqueueAssetDeletion({
                organizationId: authorized.organizationId,
                assetId,
            })
        }
        return { success: true, deleting }
    },

    removeWorkspaceReferenceForImport: async ({
        assetId,
        workspaceId,
        requester,
    }: {
        assetId: string
        workspaceId: string
        requester: AssetRequesterContext
    }): Promise<void> => {
        if (!requester.editableWorkspaceIds.includes(workspaceId)) throw new Error('PERMISSION_DENIED')
        const asset = await getAssetRecord(assetId)
        if (!asset) return
        const referenceKey = buildAssetWorkspaceReferenceKey(workspaceId)
        const reference = await getReference(assetId, referenceKey)
        if (!reference) return
        const now = Date.now()
        const referenceCount = asset.referenceCount - 1
        const next: Asset = {
            ...asset,
            referenceCount,
            states: referenceCount === 0 ? { ...asset.states, lifecycle: 'deleting' } : asset.states,
            revision: asset.revision + 1,
            updatedAt: now,
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'delete',
                    tableName: assetReferencesTableName(),
                    key: { assetId, referenceKey },
                    conditionExpression: '#updatedAt = :expectedUpdatedAt',
                    expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                    expressionAttributeValues: { ':expectedUpdatedAt': reference.updatedAt },
                },
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        referenceCount,
                        states: next.states,
                        revision: next.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision AND #referenceCount = :expectedReferenceCount',
                    expressionAttributeNames: { '#revision': 'revision', '#referenceCount': 'referenceCount' },
                    expressionAttributeValues: {
                        ':expectedRevision': asset.revision,
                        ':expectedReferenceCount': asset.referenceCount,
                    },
                },
                ...await buildAssetProjectionOperations(next),
            ],
            origin: 'Asset.removeWorkspaceReferenceForImport',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        if (referenceCount === 0) await enqueueAssetDeletion({ organizationId: asset.organizationId, assetId })
    },

    removeWorkspaceCatalogForImport: async ({
        assetId,
        workspaceId,
        requester,
    }: {
        assetId: string
        workspaceId: string
        requester: AssetRequesterContext
    }): Promise<void> => {
        if (!requester.editableWorkspaceIds.includes(workspaceId)) throw new Error('PERMISSION_DENIED')
        const asset = await getAssetRecord(assetId)
        if (!asset || asset.scope !== 'workspace' || asset.scopeOwnerId !== workspaceId) return
        const referenceKey = buildAssetCatalogReferenceKey('workspace', workspaceId)
        const reference = await getReference(assetId, referenceKey)
        if (!reference) return
        const referenceCount = asset.referenceCount - 1
        if (referenceCount < 0) throw new Error('REFERENCE_COUNT_CORRUPT')
        const now = Date.now()
        const next: Asset = {
            ...asset,
            referenceCount,
            states: referenceCount === 0 ? { ...asset.states, lifecycle: 'deleting' } : asset.states,
            revision: asset.revision + 1,
            updatedAt: now,
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'delete',
                    tableName: assetReferencesTableName(),
                    key: { assetId, referenceKey },
                    conditionExpression: '#updatedAt = :expectedUpdatedAt',
                    expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                    expressionAttributeValues: { ':expectedUpdatedAt': reference.updatedAt },
                },
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        referenceCount,
                        states: next.states,
                        revision: next.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision AND #referenceCount = :expectedReferenceCount',
                    expressionAttributeNames: { '#revision': 'revision', '#referenceCount': 'referenceCount' },
                    expressionAttributeValues: {
                        ':expectedRevision': asset.revision,
                        ':expectedReferenceCount': asset.referenceCount,
                    },
                },
                {
                    type: 'delete',
                    tableName: assetsMetaTableName(),
                    key: { scopeAndOwner: buildAssetScopeAndOwnerKey('workspace', workspaceId), assetId },
                },
                ...await buildAssetProjectionOperations(next, { includeBaseScope: false }),
            ],
            origin: 'Asset.removeWorkspaceCatalogForImport',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        if (referenceCount === 0) await enqueueAssetDeletion({ organizationId: asset.organizationId, assetId })
    },

    cleanupImportedWorkspaceAsset: async ({
        assetId,
        workspaceId,
        organizationId,
        ownerUserId,
        removeCatalog,
    }: {
        assetId: string
        workspaceId: string
        organizationId: string
        ownerUserId: string
        removeCatalog: boolean
    }): Promise<void> => {
        const workspace = await dynamoDBService.getItem({
            tableName: getDynamoDbTableStageName('WORKSPACES', ORG_NAME, STAGE),
            key: { workspaceId },
            consistentRead: true,
            origin: 'Asset.cleanupImportedWorkspaceAsset.getWorkspace',
        }) as { organizationId?: string } | undefined
        const asset = await getAssetRecord(assetId)
        if (!workspace || workspace.organizationId !== organizationId) throw new Error('WORKSPACE_TENANT_MISMATCH')
        if (!asset) return
        if (asset.organizationId !== organizationId) throw new Error('ASSET_TENANT_MISMATCH')
        const requester: AssetRequesterContext = {
            userId: ownerUserId,
            workspaceIds: [workspaceId],
            editableWorkspaceIds: [workspaceId],
            organizationIds: [organizationId],
        }
        await AssetModel.removeWorkspaceReferenceForImport({ assetId, workspaceId, requester })
        const current = await getAssetRecord(assetId)
        if (!current || current.states.lifecycle === 'deleting') return
        if (removeCatalog && current.scope === 'workspace' && current.scopeOwnerId === workspaceId) {
            await AssetModel.removeWorkspaceCatalogForImport({ assetId, workspaceId, requester })
        }
    },

    removeAllWorkspaceReferences: async ({
        workspaceId,
        requester,
    }: {
        workspaceId: string
        requester: AssetRequesterContext
    }): Promise<number> => {
        if (!requester.editableWorkspaceIds.includes(workspaceId)) throw new Error('PERMISSION_DENIED')
        const result = await dynamoDBService.scanItems({
            tableName: assetReferencesTableName(),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'Asset.removeAllWorkspaceReferences',
        })
        const references = ((result?.items ?? []) as AssetReference[])
            .filter((reference) => reference.type === 'workspace' && reference.workspaceId === workspaceId)
        for (const reference of references) {
            await AssetModel.removeWorkspaceReferenceForImport({
                assetId: reference.assetId,
                workspaceId,
                requester,
            })
        }
        const catalogResult = await dynamoDBService.queryItems({
            tableName: assetsMetaTableName(),
            indexName: 'updatedAt',
            keyConditions: { scopeAndOwner: buildAssetScopeAndOwnerKey('workspace', workspaceId) },
            limit: 100,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'Asset.removeAllWorkspaceReferences.catalogs',
        })
        const catalogAssetIds = [...new Set(((catalogResult?.items ?? []) as AssetMeta[]).map((item) => item.assetId))]
        for (const assetId of catalogAssetIds) {
            const asset = await getAssetRecord(assetId)
            if (!asset || asset.scope !== 'workspace' || asset.scopeOwnerId !== workspaceId) continue
            const referenceKey = buildAssetCatalogReferenceKey(asset.scope, asset.scopeOwnerId)
            const reference = await getReference(assetId, referenceKey)
            if (!reference) continue
            const now = Date.now()
            const referenceCount = asset.referenceCount - 1
            if (referenceCount < 0) throw new Error('REFERENCE_COUNT_CORRUPT')
            const next: Asset = {
                ...asset,
                referenceCount,
                states: referenceCount === 0 ? { ...asset.states, lifecycle: 'deleting' } : asset.states,
                revision: asset.revision + 1,
                updatedAt: now,
            }
            await dynamoDBService.transactWrite({
                operations: [
                    {
                        type: 'delete',
                        tableName: assetReferencesTableName(),
                        key: { assetId, referenceKey },
                        conditionExpression: '#updatedAt = :expectedUpdatedAt',
                        expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                        expressionAttributeValues: { ':expectedUpdatedAt': reference.updatedAt },
                    },
                    {
                        type: 'update',
                        tableName: assetsTableName(),
                        key: { assetId },
                        updates: {
                            referenceCount,
                            states: next.states,
                            revision: next.revision,
                            updatedAt: now,
                        },
                        conditionExpression: '#revision = :expectedRevision AND #referenceCount = :expectedReferenceCount',
                        expressionAttributeNames: { '#revision': 'revision', '#referenceCount': 'referenceCount' },
                        expressionAttributeValues: {
                            ':expectedRevision': asset.revision,
                            ':expectedReferenceCount': asset.referenceCount,
                        },
                    },
                    {
                        type: 'delete',
                        tableName: assetsMetaTableName(),
                        key: {
                            scopeAndOwner: buildAssetScopeAndOwnerKey(asset.scope, asset.scopeOwnerId),
                            assetId,
                        },
                    },
                    ...await buildAssetProjectionOperations(next, { includeBaseScope: false }),
                ],
                origin: 'Asset.removeWorkspaceCatalogForDeletion',
            })
            publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
            if (referenceCount === 0) {
                await enqueueAssetDeletion({ organizationId: asset.organizationId, assetId })
            }
        }
        return references.length + catalogAssetIds.length
    },

    removeWorkspaceSurfaceReferencesByPrefix: async ({
        workspaceId,
        surfacePrefix,
        requester,
    }: {
        workspaceId: string
        surfacePrefix: string
        requester: AssetRequesterContext
    }): Promise<number> => {
        if (!requester.editableWorkspaceIds.includes(workspaceId)) throw new Error('PERMISSION_DENIED')
        const result = await dynamoDBService.scanItems({
            tableName: assetReferencesTableName(),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'Asset.removeWorkspaceSurfaceReferencesByPrefix',
        })
        const references = ((result?.items ?? []) as AssetReference[])
            .filter((reference) => reference.type === 'workspace'
                && reference.workspaceId === workspaceId
                && reference.surfaceIds?.some((surfaceId) => surfaceId.startsWith(surfacePrefix)))
        let removed = 0
        for (const reference of references) {
            for (const surfaceId of reference.surfaceIds?.filter((value) => value.startsWith(surfacePrefix)) ?? []) {
                const detached = await AssetModel.detachWorkspaceReference({
                    assetId: reference.assetId,
                    workspaceId,
                    requester,
                    surfaceId,
                })
                if ('error' in detached) throw new Error(detached.error)
                removed += 1
            }
        }
        return removed
    },

    removeSurfaceReferencesByPrefixSystem: async ({
        organizationId,
        surfacePrefix,
    }: {
        organizationId: string
        surfacePrefix: string
    }): Promise<number> => {
        const result = await dynamoDBService.scanItems({
            tableName: assetReferencesTableName(),
            limit: 1000,
            fetchAllItems: true,
            consistentRead: true,
            origin: 'Asset.removeSurfaceReferencesByPrefixSystem',
        })
        const references = ((result?.items ?? []) as AssetReference[])
            .filter((reference) => reference.type === 'workspace'
                && reference.workspaceId
                && reference.surfaceIds?.some((surfaceId) => surfaceId.startsWith(surfacePrefix)))
        let removed = 0
        for (const reference of references) {
            const asset = await getAssetRecord(reference.assetId)
            if (!asset || asset.organizationId !== organizationId) continue
            const requester: AssetRequesterContext = {
                userId: asset.ownerUserId,
                workspaceIds: [reference.workspaceId!],
                editableWorkspaceIds: [reference.workspaceId!],
                organizationIds: [organizationId],
            }
            for (const surfaceId of reference.surfaceIds?.filter((value) => value.startsWith(surfacePrefix)) ?? []) {
                const detached = await AssetModel.detachWorkspaceReference({
                    assetId: reference.assetId,
                    workspaceId: reference.workspaceId!,
                    requester,
                    surfaceId,
                })
                if ('error' in detached) throw new Error(detached.error)
                removed += 1
            }
        }
        return removed
    },

    removeAssetSurfaceReferenceSystem: async ({
        assetId,
        organizationId,
        surfaceId,
    }: {
        assetId: string
        organizationId: string
        surfaceId: string
    }): Promise<void> => {
        const asset = await getAssetRecord(assetId)
        if (!asset || asset.organizationId !== organizationId) return
        const references = await listReferences(assetId)
        for (const reference of references) {
            if (reference.type !== 'workspace' || !reference.workspaceId || !reference.surfaceIds?.includes(surfaceId)) continue
            const requester: AssetRequesterContext = {
                userId: asset.ownerUserId,
                workspaceIds: [reference.workspaceId],
                editableWorkspaceIds: [reference.workspaceId],
                organizationIds: [organizationId],
            }
            const detached = await AssetModel.detachWorkspaceReference({
                assetId,
                workspaceId: reference.workspaceId,
                requester,
                surfaceId,
            })
            if ('error' in detached) throw new Error(detached.error)
        }
    },

    repairProjections: async ({ assetId }: { assetId: string }): Promise<Asset | null> => {
        const asset = await getAssetRecord(assetId)
        if (!asset) return null
        const [references, accessRows, metaResult] = await Promise.all([
            listReferences(assetId),
            listAccess(assetId),
            dynamoDBService.scanItems({
                tableName: assetsMetaTableName(),
                limit: 1000,
                fetchAllItems: true,
                consistentRead: true,
                origin: 'Asset.repairProjections.listActualMeta',
            }),
        ])
        const referenceCount = references.length
        const now = Date.now()
        const next: Asset = {
            ...asset,
            referenceCount,
            states: referenceCount === 0
                ? { ...asset.states, lifecycle: 'deleting' }
                : asset.states.lifecycle === 'deleting'
                    ? { ...asset.states, lifecycle: 'active' }
                    : asset.states,
            revision: asset.revision + 1,
            updatedAt: now,
        }
        const hasCatalog = references.some((reference) =>
            reference.referenceKey === buildAssetCatalogReferenceKey(asset.scope, asset.scopeOwnerId))
        const expectedScopeKeys = new Set([
            ...(hasCatalog ? [buildAssetScopeAndOwnerKey(asset.scope, asset.scopeOwnerId)] : []),
            ...accessRows
                .filter((access) => access.principalId !== asset.ownerUserId)
                .map((access) => buildAssetPrincipalScopeKey(access.principalId)),
        ])
        const actualMetaRows = ((metaResult?.items ?? []) as AssetMeta[])
            .filter((meta) => meta.assetId === assetId)
        const actualMetaByScope = new Map(actualMetaRows.map((meta) => [meta.scopeAndOwner, meta]))
        const expectedMetaRows = [...expectedScopeKeys].map((scopeAndOwner) => buildAssetMeta(next, scopeAndOwner))
        const staleMetaDeletes: TransactOperation[] = actualMetaRows
            .filter((meta) => !expectedScopeKeys.has(meta.scopeAndOwner))
            .map((meta) => ({
                type: 'delete',
                tableName: assetsMetaTableName(),
                key: { scopeAndOwner: meta.scopeAndOwner, assetId },
                conditionExpression: '#updatedAt = :expectedUpdatedAt',
                expressionAttributeNames: { '#updatedAt': 'updatedAt' },
                expressionAttributeValues: { ':expectedUpdatedAt': meta.updatedAt },
            }))
        const expectedMetaPuts: TransactOperation[] = expectedMetaRows
            .filter((meta) => JSON.stringify(actualMetaByScope.get(meta.scopeAndOwner)) !== JSON.stringify(meta))
            .map((meta) => ({ type: 'put', tableName: assetsMetaTableName(), item: meta }))
        if (1 + staleMetaDeletes.length + expectedMetaPuts.length > 100) {
            throw new Error('ASSET_PROJECTION_REPAIR_TOO_LARGE')
        }
        await dynamoDBService.transactWrite({
            operations: [
                {
                    type: 'update',
                    tableName: assetsTableName(),
                    key: { assetId },
                    updates: {
                        referenceCount,
                        states: next.states,
                        revision: next.revision,
                        updatedAt: now,
                    },
                    conditionExpression: '#revision = :expectedRevision',
                    expressionAttributeNames: { '#revision': 'revision' },
                    expressionAttributeValues: { ':expectedRevision': asset.revision },
                },
                ...staleMetaDeletes,
                ...expectedMetaPuts,
            ],
            origin: 'Asset.repairProjections',
        })
        publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
        if (referenceCount === 0) {
            await enqueueAssetDeletion({ organizationId: asset.organizationId, assetId })
        }
        return next
    },

    listReferences,
}

export default AssetModel
