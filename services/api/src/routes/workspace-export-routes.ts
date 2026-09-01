import { createHash } from 'node:crypto'
import * as process from 'node:process'

import AdmZip from 'adm-zip'
import { ZipArchive } from 'archiver'
import { Router } from 'express'
import multer from 'multer'
import {
    v4 as uuid,
    validate as isUuid,
} from 'uuid'

import NATS_Service from '@lixpi/nats-service'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
} from '@lixpi/prosemirror'
import {
    ASSET_REQUIRED_RENDITIONS,
    getDynamoDbTableStageName,
    isAssetDocumentRole,
    type Asset,
    type AssetDocumentRole,
    type AssetMeta,
    type AssetReference,
    type BlobRecord,
    type CanvasState,
} from '@lixpi/constants'

import { capabilityArtifactBackendRegistry } from '../capability-system/capability-artifacts.ts'
import { jwtVerifier } from '../helpers/auth.ts'
import AssetModel, { buildAssetScopeAndOwnerKey } from '../models/asset.ts'
import BlobModel from '../models/blob.ts'
import Organization from '../models/organization.ts'
import Workspace from '../models/workspace.ts'
import { getAssetRequesterContext } from '../services/asset-requester-context.ts'
import AssetDocumentService from '../services/asset-document-service.ts'
import {
    collectEmbeddedAssetIds,
    collectReferencedAssetIds,
} from '../services/prosemirror-asset-references.ts'
import {
    enqueueBlobDeletion,
    enqueueRenditionRetry,
    enqueueWorkspaceReferenceCleanup,
} from '../services/asset-maintenance-queue.ts'

const { ORG_NAME, STAGE } = process.env
const router = Router()
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ARCHIVE_BYTES } })

type Revision2BlobManifestEntry = Pick<
    BlobRecord,
    'blobHash' | 'mimeType' | 'byteSize' | 'sourceBlobHash' | 'derivationKind' | 'derivationVersion'
>

type Revision2Manifest = {
    exportVersion: 2
    exportedAt: string
    workspace: {
        name: string
        canvasState: CanvasState
        createdAt: number
        updatedAt: number
    }
    assets: Asset[]
    references: AssetReference[]
    blobs: Revision2BlobManifestEntry[]
}

const authenticateRequest = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.substring(7)
        : req.query.token
    if (!token) return res.status(401).json({ error: 'No authorization token provided' })
    const { decoded, error } = await jwtVerifier.verify(token)
    if (error || !decoded) return res.status(401).json({ error: 'Invalid or expired token' })
    req.user = { userId: decoded.sub }
    next()
}

const validateWorkspaceAccess = async (req: any, res: any, next: any) => {
    const workspace = await Workspace.getWorkspace({ workspaceId: req.params.workspaceId, userId: req.user.userId })
    if ('error' in workspace) return res.status(workspace.error === 'NOT_FOUND' ? 404 : 403).json(workspace)
    req.workspace = workspace
    next()
}

const getCanvasAssetIds = (canvasState: CanvasState): Set<string> => {
    const assetIds = new Set<string>()
    for (const node of canvasState.nodes ?? []) {
        if ('assetId' in node && node.assetId) assetIds.add(node.assetId)
        if ('conversationAssetId' in node && node.conversationAssetId) assetIds.add(node.conversationAssetId)
        if ((node.type === 'image' || node.type === 'video') && node.generatedBy?.conversationAssetId) {
            assetIds.add(node.generatedBy.conversationAssetId)
        }
    }
    for (const tab of canvasState.aiChatPanel?.tabs ?? []) {
        if (tab.type === 'thread') assetIds.add(tab.refId)
    }
    if (canvasState.lastActiveConversationAssetId) assetIds.add(canvasState.lastActiveConversationAssetId)
    return assetIds
}

const getWorkspaceCatalogAssetIds = async (workspaceId: string): Promise<string[]> => {
    const result = await dynamoDBService.queryItems({
        tableName: getDynamoDbTableStageName('ASSETS_META', ORG_NAME, STAGE),
        indexName: 'updatedAt',
        keyConditions: { scopeAndOwner: buildAssetScopeAndOwnerKey('workspace', workspaceId) },
        limit: 100,
        fetchAllItems: true,
        scanIndexForward: false,
        consistentRead: true,
        origin: 'WorkspaceExport.getWorkspaceCatalogAssetIds',
    })
    return ((result?.items ?? []) as AssetMeta[]).map((item) => item.assetId)
}

const getWorkspaceReferenceAssetIds = async (workspaceId: string): Promise<string[]> => {
    const result = await dynamoDBService.scanItems({
        tableName: getDynamoDbTableStageName('ASSET_REFERENCES', ORG_NAME, STAGE),
        limit: 1000,
        fetchAllItems: true,
        consistentRead: true,
        origin: 'WorkspaceExport.getWorkspaceReferenceAssetIds',
    })
    return ((result?.items ?? []) as AssetReference[])
        .filter((reference) => reference.type === 'workspace' && reference.workspaceId === workspaceId)
        .map((reference) => reference.assetId)
}

const getAssetLineageIds = (asset: Asset): string[] =>
    asset.lineage
        ? [
            asset.lineage.sourceConversationAssetId,
            asset.lineage.parentAssetId,
            ...asset.lineage.sourceAssetIds,
        ].filter((assetId): assetId is string => Boolean(assetId))
        : []

const collectExportAssets = async ({
    initialAssetIds,
    requester,
}: {
    initialAssetIds: Iterable<string>
    requester: Awaited<ReturnType<typeof getAssetRequesterContext>>
}): Promise<Asset[]> => {
    const pending = [...new Set(initialAssetIds)]
    const assets = new Map<string, Asset>()
    while (pending.length) {
        const assetId = pending.shift()!
        if (assets.has(assetId)) continue
        const asset = await AssetModel.get({ assetId, requester })
        if ('error' in asset) throw new Error(`UNEXPORTABLE_REFERENCED_ASSET:${assetId}:${asset.error}`)
        assets.set(asset.assetId, asset)
        for (const lineageAssetId of getAssetLineageIds(asset)) {
            if (!assets.has(lineageAssetId)) pending.push(lineageAssetId)
        }
        for (const role of ['content', 'conversation', 'capabilityArtifact'] as const) {
            if (!asset.documents[role]) continue
            const snapshot = await AssetDocumentService.loadCurrentSnapshot(asset, role)
            for (const referencedAssetId of collectReferencedAssetIds(snapshot?.doc)) {
                if (!assets.has(referencedAssetId)) pending.push(referencedAssetId)
            }
        }
    }
    return [...assets.values()]
}

const buildPortableWorkspaceReferences = async ({
    assets,
    workspaceId,
}: {
    assets: Asset[]
    workspaceId: string
}): Promise<AssetReference[]> => {
    const exportedAt = Date.now()
    const referencesByAssetId = new Map<string, AssetReference>()
    const allReferencesByAssetId = new Map<string, AssetReference[]>()
    for (const asset of assets) {
        const references = await AssetModel.listReferences(asset.assetId)
        allReferencesByAssetId.set(asset.assetId, references)
        const workspaceReference = references.find((reference) => reference.type === 'workspace' && reference.workspaceId === workspaceId)
        if (workspaceReference) {
            referencesByAssetId.set(asset.assetId, {
                ...workspaceReference,
                nodeIds: [...new Set(workspaceReference.nodeIds ?? [])],
                surfaceIds: [...new Set(workspaceReference.surfaceIds ?? [])],
            })
        }
    }

    const addSurface = (assetId: string, surfaceId: string): void => {
        const existing = referencesByAssetId.get(assetId)
        referencesByAssetId.set(assetId, {
            assetId,
            referenceKey: `workspace#${workspaceId}`,
            type: 'workspace',
            workspaceId,
            nodeIds: existing?.nodeIds ?? [],
            surfaceIds: [...new Set([...(existing?.surfaceIds ?? []), surfaceId])],
            createdAt: existing?.createdAt ?? exportedAt,
            updatedAt: Math.max(existing?.updatedAt ?? 0, exportedAt),
        })
    }

    for (const hostAsset of assets) {
        for (const role of ['content', 'conversation', 'capabilityArtifact'] as const) {
            if (!hostAsset.documents[role]) continue
            const snapshot = await AssetDocumentService.loadCurrentSnapshot(hostAsset, role)
            for (const embeddedAssetId of collectEmbeddedAssetIds(snapshot?.doc, role)) {
                if (role === 'content') {
                    addSurface(embeddedAssetId, `document#${hostAsset.assetId}#content`)
                    continue
                }
                if (role === 'capabilityArtifact') {
                    addSurface(embeddedAssetId, `capabilityArtifact#${hostAsset.assetId}`)
                    continue
                }
                const surfacePrefix = `conversation#${hostAsset.assetId}#media#`
                const matchingSurfaces = (allReferencesByAssetId.get(embeddedAssetId) ?? [])
                    .flatMap((reference) => reference.surfaceIds ?? [])
                    .filter((surfaceId) => surfaceId.startsWith(surfacePrefix))
                if (matchingSurfaces.length === 0) {
                    throw new Error(`EMBEDDED_ASSET_REFERENCE_MISSING:${hostAsset.assetId}:${embeddedAssetId}`)
                }
                for (const surfaceId of matchingSurfaces) addSurface(embeddedAssetId, surfaceId)
            }
        }
    }
    return [...referencesByAssetId.values()]
}

const getAssetBlobHashes = (asset: Asset): string[] => {
    const hashes = new Set<string>()
    for (const pointer of Object.values(asset.documents)) {
        if (pointer?.blobHash) hashes.add(pointer.blobHash)
    }
    for (const rendition of Object.values(asset.media?.renditions ?? {})) {
        if (rendition?.status === 'ready' && rendition.blobHash) hashes.add(rendition.blobHash)
    }
    return [...hashes]
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const getDocumentType = (role: AssetDocumentRole): string =>
    role === 'content'
        ? DOCUMENT_TYPE.ASSET_CONTENT
        : role === 'conversation'
        ? DOCUMENT_TYPE.ASSET_CONVERSATION
        : role === 'provenance'
        ? DOCUMENT_TYPE.ASSET_PROVENANCE
        : 'capabilityArtifact'

const buildPortableAssets = async (assets: Asset[], exportedAt: number): Promise<{
    assets: Asset[]
    virtualBlobs: Map<string, { bytes: Buffer; meta: Revision2BlobManifestEntry }>
}> => {
    const virtualBlobs = new Map<string, { bytes: Buffer; meta: Revision2BlobManifestEntry }>()
    const portableAssets: Asset[] = []
    for (const sourceAsset of assets) {
        const { editLease: _editLease, ...withoutLease } = sourceAsset
        const documents = { ...withoutLease.documents }
        for (const role of Object.keys(documents) as AssetDocumentRole[]) {
            const pointer = documents[role]
            if (!pointer) continue
            const snapshot = await AssetDocumentService.loadCurrentSnapshot(sourceAsset, role)
            if (!snapshot || snapshot.version <= pointer.version) continue
            const bytes = Buffer.from(JSON.stringify(snapshot.doc), 'utf8')
            const blobHash = sha256(bytes)
            documents[role] = {
                ...pointer,
                blobHash,
                version: snapshot.version,
                schemaVersion: snapshot.schemaVersion,
                byteSize: bytes.byteLength,
                updatedAt: exportedAt,
            }
            virtualBlobs.set(blobHash, {
                bytes,
                meta: {
                    blobHash,
                    mimeType: 'application/json',
                    byteSize: bytes.byteLength,
                },
            })
        }
        portableAssets.push({ ...withoutLease, documents })
    }
    return { assets: portableAssets, virtualBlobs }
}

const validateRevision2Manifest = (manifest: unknown, zip: AdmZip): Revision2Manifest => {
    if (!manifest || typeof manifest !== 'object') throw new Error('INVALID_REVISION_2_MANIFEST')
    const candidate = manifest as Partial<Revision2Manifest>
    if (candidate.exportVersion !== 2) throw new Error('REVISION_2_ARCHIVE_REQUIRED')
    if (!candidate.workspace?.canvasState || !Array.isArray(candidate.assets) || !Array.isArray(candidate.references) || !Array.isArray(candidate.blobs)) {
        throw new Error('INVALID_REVISION_2_MANIFEST')
    }
    if (
        typeof candidate.workspace.name !== 'string'
        || !Array.isArray(candidate.workspace.canvasState.nodes)
        || !Array.isArray(candidate.workspace.canvasState.edges)
        || !Number.isSafeInteger(candidate.workspace.createdAt)
        || !Number.isSafeInteger(candidate.workspace.updatedAt)
    ) {
        throw new Error('INVALID_REVISION_2_WORKSPACE')
    }
    const assetIds = new Set<string>()
    const sourceOrganizationIds = new Set<string>()
    for (const asset of candidate.assets) {
        if (!isUuid(asset?.assetId) || assetIds.has(asset.assetId)) throw new Error('DUPLICATE_OR_INVALID_ASSET_ID')
        if (!asset.organizationId || typeof asset.title !== 'string' || !asset.title.trim()) {
            throw new Error(`INVALID_ASSET:${asset.assetId}`)
        }
        if (
            !asset.documents
            || !asset.states
            || !Number.isSafeInteger(asset.revision)
            || asset.revision < 1
            || !Number.isSafeInteger(asset.referenceCount)
            || asset.referenceCount < 1
            || !Number.isSafeInteger(asset.createdAt)
            || !Number.isSafeInteger(asset.updatedAt)
        ) {
            throw new Error(`INVALID_ASSET_STATE:${asset.assetId}`)
        }
        if (
            !['workspace', 'user', 'organization'].includes(asset.scope)
            || !asset.scopeOwnerId
            || !asset.originWorkspaceId
            || !asset.ownerUserId
            || !['creating', 'active', 'deleting', 'failed'].includes(asset.states.lifecycle)
            || !['none', 'processing', 'ready', 'degraded', 'failed', 'cancelled'].includes(asset.states.media)
            || !['none', 'idle', 'receiving', 'paused', 'completed', 'failed'].includes(asset.states.conversation)
            || !['none', 'building', 'sealed', 'failed', 'cancelled'].includes(asset.states.provenance)
        ) {
            throw new Error(`INVALID_ASSET_COMPONENT_STATE:${asset.assetId}`)
        }
        if (asset.states.lifecycle === 'deleting') throw new Error(`DELETING_ASSET_NOT_PORTABLE:${asset.assetId}`)
        if (!asset.media && !asset.lineage && Object.keys(asset.documents).length === 0) {
            throw new Error(`ASSET_COMPONENT_REQUIRED:${asset.assetId}`)
        }
        if (Boolean(asset.documents.conversation) === (asset.states.conversation === 'none')) {
            throw new Error(`INVALID_ASSET_CONVERSATION_STATE:${asset.assetId}`)
        }
        if (asset.documents.provenance && !['sealed', 'failed', 'cancelled'].includes(asset.states.provenance)) {
            throw new Error(`INVALID_ASSET_PROVENANCE_STATE:${asset.assetId}`)
        }
        if (!asset.documents.provenance && asset.states.provenance !== 'none' && !asset.lineage) {
            throw new Error(`INVALID_ASSET_PROVENANCE_STATE:${asset.assetId}`)
        }
        if (asset.media) {
            if (
                !['image', 'video', 'audio', 'document'].includes(asset.media.kind)
                || typeof asset.media.originalName !== 'string'
                || typeof asset.media.sourceMimeType !== 'string'
                || typeof asset.media.modelSafe !== 'boolean'
                || !asset.media.renditions
                || asset.states.media === 'none'
            ) {
                throw new Error(`INVALID_ASSET_MEDIA:${asset.assetId}`)
            }
            const original = asset.media.renditions.original
            if (original?.status !== 'ready' || !original.blobHash) {
                throw new Error(`ASSET_ORIGINAL_RENDITION_REQUIRED:${asset.assetId}`)
            }
        } else if (!asset.lineage && asset.states.media !== 'none') {
            throw new Error(`INVALID_ASSET_MEDIA_STATE:${asset.assetId}`)
        }
        if (asset.lineage) {
            if (
                !Array.isArray(asset.lineage.sourceAssetIds)
                || asset.lineage.sourceAssetIds.some((assetId) => !isUuid(assetId))
                || (asset.lineage.sourceConversationAssetId && !isUuid(asset.lineage.sourceConversationAssetId))
                || (asset.lineage.parentAssetId && !isUuid(asset.lineage.parentAssetId))
            ) {
                throw new Error(`INVALID_ASSET_LINEAGE:${asset.assetId}`)
            }
            if (getAssetLineageIds(asset).includes(asset.assetId)) {
                throw new Error(`SELF_REFERENTIAL_ASSET_LINEAGE:${asset.assetId}`)
            }
        }
        if (
            asset.descriptor && (
                !['analyzing', 'ready', 'failed'].includes(asset.descriptor.status)
                || typeof asset.descriptor.summary !== 'string'
                || !Array.isArray(asset.descriptor.entityTags)
                || asset.descriptor.entityTags.some((tag) => typeof tag !== 'string')
                || !Array.isArray(asset.descriptor.styleTags)
                || asset.descriptor.styleTags.some((tag) => typeof tag !== 'string')
                || asset.descriptor.source !== 'analysis'
                || typeof asset.descriptor.version !== 'string'
                || !asset.descriptor.version
                || !Number.isSafeInteger(asset.descriptor.updatedAt)
            )
        ) throw new Error(`INVALID_ASSET_DESCRIPTOR:${asset.assetId}`)
        assetIds.add(asset.assetId)
        sourceOrganizationIds.add(asset.organizationId)
    }
    if (sourceOrganizationIds.size > 1) throw new Error('CROSS_ORGANIZATION_ASSET_GRAPH_NOT_PORTABLE')
    const embeddedReferenceRequirements: Array<{
        embeddedAssetId: string
        hostAssetId: string
        role: 'content' | 'conversation' | 'capabilityArtifact'
    }> = []
    const blobHashes = new Set<string>()
    let totalBlobBytes = 0
    for (const blob of candidate.blobs) {
        if (!isSha256(blob?.blobHash) || blobHashes.has(blob.blobHash)) throw new Error('DUPLICATE_OR_INVALID_BLOB_HASH')
        if (!Number.isSafeInteger(blob.byteSize) || blob.byteSize < 0 || typeof blob.mimeType !== 'string' || !blob.mimeType) {
            throw new Error(`INVALID_BLOB_METADATA:${blob.blobHash}`)
        }
        if (blob.sourceBlobHash && !isSha256(blob.sourceBlobHash)) throw new Error(`INVALID_SOURCE_BLOB_HASH:${blob.blobHash}`)
        blobHashes.add(blob.blobHash)
        totalBlobBytes += blob.byteSize
        if (totalBlobBytes > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_BLOBS_TOO_LARGE')
        const entry = zip.getEntry(`blobs/${blob.blobHash}`)
        if (!entry || entry.isDirectory) throw new Error(`MISSING_BLOB:${blob.blobHash}`)
        if (entry.header.size !== blob.byteSize) throw new Error(`BLOB_SIZE_MISMATCH:${blob.blobHash}`)
        const bytes = entry.getData()
        if (bytes.byteLength !== blob.byteSize) throw new Error(`BLOB_SIZE_MISMATCH:${blob.blobHash}`)
        if (sha256(bytes) !== blob.blobHash) throw new Error(`BLOB_HASH_MISMATCH:${blob.blobHash}`)
    }
    for (const blob of candidate.blobs) {
        if (blob.sourceBlobHash && !blobHashes.has(blob.sourceBlobHash)) {
            throw new Error(`MISSING_SOURCE_BLOB:${blob.blobHash}`)
        }
    }
    for (const asset of candidate.assets) {
        const hasArtifactDocument = Boolean(asset.documents.capabilityArtifact)
        if (hasArtifactDocument !== Boolean(asset.artifact)) {
            throw new Error(`INVALID_ASSET_ARTIFACT_COMPONENTS:${asset.assetId}`)
        }
        const artifactDefinition = asset.artifact
            ? capabilityArtifactBackendRegistry.get(asset.artifact.artifactTypeId)
            : undefined
        if (
            asset.artifact && (!artifactDefinition
                || asset.documents.capabilityArtifact?.schemaVersion !== asset.artifact.schemaVersion
                || artifactDefinition.shared.schemaVersion !== asset.artifact.schemaVersion)
        ) {
            throw new Error(`INVALID_ASSET_ARTIFACT:${asset.assetId}`)
        }
        for (const [role, pointer] of Object.entries(asset.documents)) {
            if (!pointer) continue
            if (!isAssetDocumentRole(role)) {
                throw new Error(`INVALID_DOCUMENT_ROLE:${asset.assetId}:${role}`)
            }
            if (pointer.role !== role || !Number.isSafeInteger(pointer.version) || !Number.isSafeInteger(pointer.byteSize)) {
                throw new Error(`INVALID_DOCUMENT_POINTER:${asset.assetId}:${role}`)
            }
            if (role === 'provenance' && !Number.isSafeInteger(pointer.sealedAt)) {
                throw new Error(`UNSEALED_PROVENANCE_POINTER:${asset.assetId}`)
            }
            if (!blobHashes.has(pointer.blobHash)) throw new Error(`MISSING_DOCUMENT_BLOB:${asset.assetId}`)
            const blob = candidate.blobs.find((entry) => entry.blobHash === pointer.blobHash)
            if (blob?.byteSize !== pointer.byteSize) throw new Error(`DOCUMENT_SIZE_MISMATCH:${asset.assetId}:${role}`)
            const bytes = zip.getEntry(`blobs/${pointer.blobHash}`)!.getData()
            let doc: object
            try {
                doc = JSON.parse(bytes.toString('utf8')) as object
            } catch {
                throw new Error(`INVALID_DOCUMENT_JSON:${asset.assetId}:${role}`)
            }
            if (role === 'capabilityArtifact' && !artifactDefinition) {
                throw new Error(`INVALID_ASSET_ARTIFACT:${asset.assetId}`)
            }
            new HeadlessProseMirrorEngine({
                documentType: getDocumentType(role),
                ...(role === 'capabilityArtifact'
                    ? { schema: artifactDefinition.shared.createDocumentSchema() }
                    : {}),
                doc,
                version: pointer.version,
            })
            if (role === 'capabilityArtifact') artifactDefinition.shared.assertInitialDocument(doc)
            AssetDocumentService.assertAssetBackedMediaNodes(doc)
            for (const referencedAssetId of collectReferencedAssetIds(doc)) {
                if (!assetIds.has(referencedAssetId)) {
                    throw new Error(`MISSING_EMBEDDED_ASSET:${asset.assetId}:${referencedAssetId}`)
                }
                if (
                    (role === 'content' || role === 'conversation' || role === 'capabilityArtifact')
                    && referencedAssetId === asset.assetId
                ) {
                    throw new Error(`SELF_REFERENTIAL_ASSET_DOCUMENT:${asset.assetId}:${role}`)
                }
            }
            if (role === 'content' || role === 'conversation' || role === 'capabilityArtifact') {
                for (const embeddedAssetId of collectEmbeddedAssetIds(doc, role)) {
                    embeddedReferenceRequirements.push({
                        embeddedAssetId,
                        hostAssetId: asset.assetId,
                        role,
                    })
                }
            }
        }
        for (const [name, rendition] of Object.entries(asset.media?.renditions ?? {})) {
            if (
                !['original', 'canonical', 'preview', 'thumbnail', 'poster', 'representativeFrame'].includes(name)
                || rendition?.name !== name
                || !['pending', 'ready', 'failed'].includes(rendition.status)
                || !Number.isSafeInteger(rendition.updatedAt)
            ) {
                throw new Error(`INVALID_RENDITION:${asset.assetId}:${name}`)
            }
            if (rendition?.status === 'ready' && (!rendition.blobHash || !blobHashes.has(rendition.blobHash))) {
                throw new Error(`MISSING_RENDITION_BLOB:${asset.assetId}:${rendition.name}`)
            }
            if (rendition?.status === 'ready') {
                if (
                    !isSha256(rendition.blobHash)
                    || typeof rendition.mimeType !== 'string'
                    || !rendition.mimeType
                    || !Number.isSafeInteger(rendition.byteSize)
                    || rendition.byteSize! < 0
                ) {
                    throw new Error(`INVALID_RENDITION:${asset.assetId}:${name}`)
                }
                const blob = candidate.blobs.find((entry) => entry.blobHash === rendition.blobHash)
                if (blob?.byteSize !== rendition.byteSize || blob.mimeType !== rendition.mimeType) {
                    throw new Error(`RENDITION_BLOB_METADATA_MISMATCH:${asset.assetId}:${name}`)
                }
            }
        }
        for (const lineageAssetId of getAssetLineageIds(asset)) {
            if (!assetIds.has(lineageAssetId)) throw new Error(`MISSING_LINEAGE_ASSET:${lineageAssetId}`)
        }
    }
    const referenceKeys = new Set<string>()
    const referenceAssetIds = new Set<string>()
    const referenceWorkspaceIds = new Set<string>()
    for (const reference of candidate.references) {
        if (!assetIds.has(reference.assetId)) throw new Error(`REFERENCE_ASSET_MISSING:${reference.assetId}`)
        const key = `${reference.assetId}#${reference.referenceKey}`
        if (referenceKeys.has(key)) throw new Error(`DUPLICATE_REFERENCE:${key}`)
        referenceKeys.add(key)
        if (reference.type !== 'workspace' || !reference.workspaceId) throw new Error(`INVALID_PORTABLE_REFERENCE:${key}`)
        if (
            reference.referenceKey !== `workspace#${reference.workspaceId}`
            || referenceAssetIds.has(reference.assetId)
            || !Array.isArray(reference.nodeIds)
            || !Array.isArray(reference.surfaceIds)
            || reference.nodeIds.some((nodeId) => typeof nodeId !== 'string' || !nodeId)
            || reference.surfaceIds.some((surfaceId) => typeof surfaceId !== 'string' || !surfaceId)
            || (reference.nodeIds.length === 0 && reference.surfaceIds.length === 0)
        ) {
            throw new Error(`INVALID_PORTABLE_REFERENCE:${key}`)
        }
        referenceAssetIds.add(reference.assetId)
        referenceWorkspaceIds.add(reference.workspaceId)
    }
    if (referenceWorkspaceIds.size > 1) throw new Error('MULTIPLE_SOURCE_WORKSPACES_NOT_PORTABLE')
    for (const requirement of embeddedReferenceRequirements) {
        const reference = candidate.references.find((entry) => entry.assetId === requirement.embeddedAssetId)
        const expectedPrefix = requirement.role === 'content'
            ? `document#${requirement.hostAssetId}#content`
            : requirement.role === 'capabilityArtifact'
            ? `capabilityArtifact#${requirement.hostAssetId}`
            : `conversation#${requirement.hostAssetId}#media#`
        const hasSurface = requirement.role === 'content' || requirement.role === 'capabilityArtifact'
            ? reference?.surfaceIds?.includes(expectedPrefix)
            : reference?.surfaceIds?.some((surfaceId) => surfaceId.startsWith(expectedPrefix))
        if (!hasSurface) {
            throw new Error(`EMBEDDED_ASSET_REFERENCE_MISSING:${requirement.hostAssetId}:${requirement.embeddedAssetId}`)
        }
    }
    for (const assetId of getCanvasAssetIds(candidate.workspace.canvasState)) {
        if (!assetIds.has(assetId)) throw new Error(`CANVAS_ASSET_MISSING:${assetId}`)
        if (!referenceAssetIds.has(assetId)) throw new Error(`CANVAS_ASSET_REFERENCE_MISSING:${assetId}`)
    }
    for (const node of candidate.workspace.canvasState.nodes ?? []) {
        const record = node as unknown as Record<string, unknown>
        for (const field of ['fileId', 'posterFileId', 'frameFileId', 'src', 'posterSrc', 'referenceId', 'aiChatThreadId']) {
            if (field in record) throw new Error(`LEGACY_CANVAS_FIELD:${field}`)
        }
        if ('assetId' in node && node.assetId && !assetIds.has(node.assetId)) {
            throw new Error(`CANVAS_ASSET_MISSING:${node.assetId}`)
        }
        if ('assetId' in node && node.assetId) {
            const reference = candidate.references.find((entry) =>
                entry.assetId === node.assetId
                && entry.type === 'workspace'
                && entry.nodeIds?.includes(node.nodeId)
            )
            if (!reference) throw new Error(`CANVAS_ASSET_REFERENCE_MISSING:${node.assetId}:${node.nodeId}`)
        }
    }
    return candidate as Revision2Manifest
}

const ASSET_ID_FIELDS = new Set([
    'assetId',
    'conversationAssetId',
    'sourceConversationAssetId',
    'parentAssetId',
    'threadId',
    'lastActiveConversationAssetId',
])
const ASSET_ID_ARRAY_FIELDS = new Set(['sourceAssetIds'])

const remapAssetIdsInJson = (value: unknown, assetIdMap: Map<string, string>): unknown => {
    if (Array.isArray(value)) return value.map((item) => remapAssetIdsInJson(item, assetIdMap))
    if (typeof value === 'string') {
        let remapped = value
        for (const [sourceAssetId, targetAssetId] of assetIdMap) {
            remapped = remapped.replaceAll(
                `/api/assets/${encodeURIComponent(sourceAssetId)}/`,
                `/api/assets/${encodeURIComponent(targetAssetId)}/`,
            )
        }
        return remapped
    }
    if (!value || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    const target: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) {
        if (ASSET_ID_FIELDS.has(key) && typeof child === 'string') {
            target[key] = assetIdMap.get(child) ?? child
            continue
        }
        if (key === 'refId' && source.type === 'thread' && typeof child === 'string') {
            target[key] = assetIdMap.get(child) ?? child
            continue
        }
        if (ASSET_ID_ARRAY_FIELDS.has(key) && Array.isArray(child)) {
            target[key] = child.map((item) => typeof item === 'string' ? assetIdMap.get(item) ?? item : item)
            continue
        }
        target[key] = remapAssetIdsInJson(child, assetIdMap)
    }
    return target
}

const remapSurfaceId = (surfaceId: string, assetIdMap: Map<string, string>): string => surfaceId.split('#').map((part) => assetIdMap.get(part) ?? part).join('#')

const normalizeImportedAsset = (source: Asset): Asset => {
    const renditions = source.media
        ? Object.fromEntries(
            Object.entries(source.media.renditions).map(([name, rendition]) => [
                name,
                rendition?.status === 'pending'
                    ? { ...rendition, status: 'failed', errorCode: 'IMPORT_PENDING_RENDITION_NOT_PORTABLE' }
                    : rendition,
            ]),
        ) as NonNullable<Asset['media']>['renditions']
        : undefined
    const media = source.media ? { ...source.media, renditions } : undefined
    const originalReady = media?.renditions.original?.status === 'ready'
    const requiredRenditions = media
        ? [
            ...ASSET_REQUIRED_RENDITIONS[media.kind],
            ...(!media.modelSafe ? ['canonical' as const] : []),
        ]
        : []
    const requiredReady = requiredRenditions.every((name) => media?.renditions[name]?.status === 'ready')
    const mediaState = !media
        ? 'none'
        : requiredReady
        ? 'ready'
        : originalReady
        ? 'degraded'
        : source.states.media === 'cancelled'
        ? 'cancelled'
        : 'failed'
    return {
        ...source,
        ...(media ? { media } : {}),
        states: {
            lifecycle: mediaState === 'failed' || mediaState === 'cancelled' ? 'failed' : 'active',
            media: mediaState,
            conversation: source.states.conversation === 'receiving' ? 'paused' : source.states.conversation,
            provenance: source.states.provenance === 'building' ? 'failed' : source.states.provenance,
        },
    }
}

router.get('/:workspaceId/export', authenticateRequest, validateWorkspaceAccess, async (req: any, res: any) => {
    try {
        const requester = await getAssetRequesterContext(req.user.userId)
        const initialAssetIds = getCanvasAssetIds(req.workspace.canvasState)
        for (const assetId of await getWorkspaceCatalogAssetIds(req.params.workspaceId)) initialAssetIds.add(assetId)
        for (const assetId of await getWorkspaceReferenceAssetIds(req.params.workspaceId)) initialAssetIds.add(assetId)
        const assets = await collectExportAssets({ initialAssetIds, requester })
        if (assets.some((asset) => asset.organizationId !== req.workspace.organizationId)) {
            throw new Error('CROSS_ORGANIZATION_ASSET_GRAPH_NOT_PORTABLE')
        }
        const references = await buildPortableWorkspaceReferences({
            assets,
            workspaceId: req.params.workspaceId,
        })
        const exportedAt = Date.now()
        const portable = await buildPortableAssets(assets, exportedAt)
        const organizationId = req.workspace.organizationId as string
        const storedBlobs = new Map<string, BlobRecord>()
        const pendingBlobHashes = portable.assets.flatMap(getAssetBlobHashes)
        while (pendingBlobHashes.length) {
            const blobHash = pendingBlobHashes.shift()!
            if (storedBlobs.has(blobHash)) continue
            const blob = await BlobModel.get({ organizationId, blobHash })
            if (!blob) {
                if (portable.virtualBlobs.has(blobHash)) continue
                throw new Error(`BLOB_REGISTRY_ENTRY_MISSING:${blobHash}`)
            }
            storedBlobs.set(blobHash, blob)
            if (blob.sourceBlobHash) pendingBlobHashes.push(blob.sourceBlobHash)
        }
        const blobManifest = new Map<string, Revision2BlobManifestEntry>()
        for (const [blobHash, virtualBlob] of portable.virtualBlobs) {
            blobManifest.set(blobHash, virtualBlob.meta)
        }
        for (const blob of storedBlobs.values()) {
            blobManifest.set(blob.blobHash, {
                blobHash: blob.blobHash,
                mimeType: blob.mimeType,
                byteSize: blob.byteSize,
                ...(blob.sourceBlobHash ? { sourceBlobHash: blob.sourceBlobHash } : {}),
                ...(blob.derivationKind ? { derivationKind: blob.derivationKind } : {}),
                ...(blob.derivationVersion ? { derivationVersion: blob.derivationVersion } : {}),
            })
        }
        const manifest: Revision2Manifest = {
            exportVersion: 2,
            exportedAt: new Date(exportedAt).toISOString(),
            workspace: {
                name: req.workspace.name,
                canvasState: req.workspace.canvasState,
                createdAt: req.workspace.createdAt,
                updatedAt: req.workspace.updatedAt,
            },
            assets: portable.assets,
            references,
            blobs: [...blobManifest.values()],
        }
        const archive = new ZipArchive({ zlib: { level: 5 } })
        const blobBytes = new Map<string, Buffer>()
        const natsService = NATS_Service.getInstance()
        if (!natsService) throw new Error('NATS service unavailable')
        for (const [blobHash, virtualBlob] of portable.virtualBlobs) {
            blobBytes.set(blobHash, virtualBlob.bytes)
        }
        for (const blob of storedBlobs.values()) {
            const bytes = await natsService.getObject(blob.bucketName, blob.objectKey)
            if (!bytes || bytes.byteLength !== blob.byteSize || sha256(bytes) !== blob.blobHash) {
                throw new Error(`BLOB_OBJECT_INVALID:${blob.blobHash}`)
            }
            blobBytes.set(blob.blobHash, Buffer.from(bytes))
        }
        res.setHeader('Content-Type', 'application/zip')
        res.setHeader('Content-Disposition', 'attachment; filename="workspace-assets-v2.zip"')
        archive.pipe(res)
        archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })
        for (const blob of manifest.blobs) {
            archive.append(blobBytes.get(blob.blobHash)!, { name: `blobs/${blob.blobHash}` })
        }
        await archive.finalize()
    } catch (error) {
        console.error('Revision-2 workspace export failed:', error)
        if (!res.headersSent) res.status(500).json({ error: 'EXPORT_FAILED' })
    }
})

router.post('/:workspaceId/import', authenticateRequest, validateWorkspaceAccess, importUpload.single('file'), async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' })
    const createdAssetIds: string[] = []
    const importedMediaAssetIds: string[] = []
    const touchedBlobHashes = new Set<string>()
    let requester: Awaited<ReturnType<typeof getAssetRequesterContext>> | undefined
    let importOrganizationId: string | undefined
    let importedAssetCount = 0
    let workspaceReplaced = false
    let cleanupPending = false
    try {
        const zip = new AdmZip(req.file.buffer)
        const entry = zip.getEntry('manifest.json')
        if (!entry) return res.status(400).json({ error: 'MISSING_MANIFEST' })
        if (entry.header.size > 10 * 1024 * 1024) return res.status(400).json({ error: 'MANIFEST_TOO_LARGE' })
        const manifest = validateRevision2Manifest(JSON.parse(entry.getData().toString('utf8')), zip)
        const organizations = await Organization.getUserOrganizations({ userId: req.user.userId })
        const organizationId = req.workspace.organizationId as string
        importOrganizationId = organizationId
        if (!organizations.some((organization) => organization.organizationId === organizationId)) {
            return res.status(403).json({ error: 'ORGANIZATION_ACCESS_DENIED' })
        }
        requester = await getAssetRequesterContext(req.user.userId)
        const workspaceId = req.params.workspaceId
        if (!requester.editableWorkspaceIds.includes(workspaceId)) return res.status(403).json({ error: 'PERMISSION_DENIED' })

        const assetIdMap = new Map<string, string>(manifest.assets.map((asset) => [asset.assetId, uuid()]))
        importedAssetCount = assetIdMap.size
        const sourceBlobBytes = new Map<string, Buffer>()
        const remappedDocumentBytes = new Map<string, Buffer>()
        for (const blobMeta of manifest.blobs) {
            const bytes = zip.getEntry(`blobs/${blobMeta.blobHash}`)!.getData()
            sourceBlobBytes.set(blobMeta.blobHash, bytes)
        }
        for (const sourceAsset of manifest.assets) {
            for (const role of Object.keys(sourceAsset.documents) as AssetDocumentRole[]) {
                const pointer = sourceAsset.documents[role]
                if (!pointer) continue
                const sourceBytes = sourceBlobBytes.get(pointer.blobHash)
                if (!sourceBytes) throw new Error(`MISSING_DOCUMENT_BLOB:${sourceAsset.assetId}:${role}`)
                const sourceDocument = JSON.parse(sourceBytes.toString('utf8'))
                const remappedDocument = remapAssetIdsInJson(sourceDocument, assetIdMap) as object
                remappedDocumentBytes.set(
                    `${sourceAsset.assetId}#${role}`,
                    Buffer.from(JSON.stringify(remappedDocument), 'utf8'),
                )
            }
        }

        for (const blobMeta of manifest.blobs) {
            const bytes = sourceBlobBytes.get(blobMeta.blobHash)!
            const stored = await BlobModel.store({
                organizationId,
                bytes,
                mimeType: blobMeta.mimeType,
                sourceBlobHash: blobMeta.sourceBlobHash,
                derivationKind: blobMeta.derivationKind,
                derivationVersion: blobMeta.derivationVersion,
            })
            if (stored.blobHash !== blobMeta.blobHash) throw new Error('BLOB_HASH_MISMATCH')
            touchedBlobHashes.add(stored.blobHash)
        }

        for (const sourceAsset of manifest.assets) {
            const normalized = normalizeImportedAsset(sourceAsset)
            const assetId = assetIdMap.get(sourceAsset.assetId)!
            const documents = { ...normalized.documents }
            for (const role of Object.keys(documents) as AssetDocumentRole[]) {
                const pointer = documents[role]
                if (!pointer) continue
                const remappedBytes = remappedDocumentBytes.get(`${sourceAsset.assetId}#${role}`)!
                const remappedBlob = await BlobModel.store({
                    organizationId,
                    bytes: remappedBytes,
                    mimeType: 'application/json',
                    description: `Imported ${role} snapshot for ${assetId}`,
                })
                touchedBlobHashes.add(remappedBlob.blobHash)
                documents[role] = {
                    ...pointer,
                    blobHash: remappedBlob.blobHash,
                    byteSize: remappedBytes.byteLength,
                    updatedAt: Date.now(),
                }
            }
            const sourceReference = manifest.references.find((reference) => reference.assetId === sourceAsset.assetId)
            const lineage = normalized.lineage
                ? {
                    ...normalized.lineage,
                    ...(normalized.lineage.sourceConversationAssetId
                        ? { sourceConversationAssetId: assetIdMap.get(normalized.lineage.sourceConversationAssetId) }
                        : {}),
                    ...(normalized.lineage.parentAssetId
                        ? { parentAssetId: assetIdMap.get(normalized.lineage.parentAssetId) }
                        : {}),
                    sourceAssetIds: normalized.lineage.sourceAssetIds.map((sourceAssetId) => assetIdMap.get(sourceAssetId)!),
                }
                : undefined
            await AssetModel.create({
                ...normalized,
                assetId,
                organizationId,
                scope: 'workspace',
                scopeOwnerId: workspaceId,
                originWorkspaceId: workspaceId,
                ownerUserId: req.user.userId,
                documents,
                importedFromAssetId: sourceAsset.assetId,
                ...(lineage ? { lineage } : {}),
                ...(sourceReference
                    ? {
                        workspaceReference: {
                            workspaceId,
                            nodeIds: sourceReference.nodeIds,
                            surfaceIds: sourceReference.surfaceIds?.map((surfaceId) => remapSurfaceId(surfaceId, assetIdMap)),
                        },
                    }
                    : {}),
            })
            createdAssetIds.push(assetId)
            if (normalized.media && normalized.states.media !== 'ready') importedMediaAssetIds.push(assetId)
        }

        for (const sourceAsset of manifest.assets) {
            const hostAssetId = assetIdMap.get(sourceAsset.assetId)!
            for (const role of ['content', 'capabilityArtifact'] as const) {
                const documentBytes = remappedDocumentBytes.get(`${sourceAsset.assetId}#${role}`)
                if (!documentBytes) continue
                const document = JSON.parse(documentBytes.toString('utf8'))
                for (const embeddedAssetId of collectEmbeddedAssetIds(document, role)) {
                    if (embeddedAssetId === hostAssetId) throw new Error('SELF_REFERENTIAL_ASSET_DOCUMENT')
                    const attached = await AssetModel.attachWorkspaceReference({
                        assetId: embeddedAssetId,
                        workspaceId,
                        requester,
                        surfaceId: role === 'content'
                            ? `document#${hostAssetId}#content`
                            : `capabilityArtifact#${hostAssetId}`,
                    })
                    if ('error' in attached) throw new Error(attached.error)
                }
            }
        }

        const canvasState = remapAssetIdsInJson(manifest.workspace.canvasState, assetIdMap) as CanvasState
        const previousAssetIds = new Set([
            ...getCanvasAssetIds(req.workspace.canvasState),
            ...await getWorkspaceCatalogAssetIds(workspaceId),
            ...await getWorkspaceReferenceAssetIds(workspaceId),
        ])
        await Workspace.replaceWorkspaceContent({
            workspaceId,
            canvasState,
            expectedCanvasStateUpdatedAt: req.workspace.canvasStateUpdatedAt,
        })
        workspaceReplaced = true
        for (const previousAssetId of previousAssetIds) {
            if (createdAssetIds.includes(previousAssetId)) continue
            let workspaceReferenceRemoved = false
            let cleanupError: unknown
            for (let attempt = 0; attempt < 5 && !workspaceReferenceRemoved; attempt += 1) {
                try {
                    await AssetModel.removeWorkspaceReferenceForImport({
                        assetId: previousAssetId,
                        workspaceId,
                        requester,
                    })
                    workspaceReferenceRemoved = true
                } catch (error) {
                    cleanupError = error
                    if (!isTransactionConditionalCheckFailure(error)) break
                }
            }
            if (!workspaceReferenceRemoved) {
                console.error('Post-import workspace reference cleanup queued:', { previousAssetId, cleanupError })
                await enqueueWorkspaceReferenceCleanup({
                    organizationId,
                    assetId: previousAssetId,
                    workspaceId,
                    ownerUserId: req.user.userId,
                    removeCatalog: true,
                }).catch((error) => {
                    cleanupPending = true
                    console.error('Unable to queue post-import workspace reference cleanup:', { previousAssetId, error })
                })
                continue
            }
            const previousAsset = await AssetModel.get({ assetId: previousAssetId, requester })
            if (
                !('error' in previousAsset)
                && previousAsset.scope === 'workspace'
                && previousAsset.scopeOwnerId === workspaceId
            ) {
                const detached = await AssetModel.removeWorkspaceCatalogForImport({
                    assetId: previousAssetId,
                    workspaceId,
                    requester,
                })
                    .then(() => ({ success: true as const }))
                    .catch((error) => ({ error: String(error) }))
                if ('error' in detached) {
                    await enqueueWorkspaceReferenceCleanup({
                        organizationId,
                        assetId: previousAssetId,
                        workspaceId,
                        ownerUserId: req.user.userId,
                        removeCatalog: true,
                    }).catch((error) => {
                        cleanupPending = true
                        console.error('Unable to queue post-import catalog cleanup:', { previousAssetId, error })
                    })
                }
            }
        }
        for (const blobHash of touchedBlobHashes) {
            await enqueueBlobDeletion({ organizationId, blobHash }).catch((error) => {
                cleanupPending = true
                console.error('Unable to queue imported staging Blob cleanup:', { blobHash, error })
            })
        }
        for (const assetId of importedMediaAssetIds) {
            await enqueueRenditionRetry({ organizationId, assetId, retryAttempt: 1 }).catch((error) => {
                cleanupPending = true
                console.error('Unable to queue imported Asset rendition reconstruction:', { assetId, error })
            })
        }
        return res.json({ success: true, importedAssets: assetIdMap.size, ...(cleanupPending ? { cleanupPending: true } : {}) })
    } catch (error) {
        console.error('Revision-2 workspace import failed:', error)
        if (workspaceReplaced) {
            return res.status(202).json({
                success: true,
                importedAssets: importedAssetCount,
                cleanupPending: true,
                error: 'IMPORT_COMMITTED_CLEANUP_PENDING',
            })
        }
        if (requester) {
            for (const assetId of createdAssetIds.reverse()) {
                await AssetModel.removeWorkspaceReferenceForImport({
                    assetId,
                    workspaceId: req.params.workspaceId,
                    requester,
                }).catch(() => {})
                await AssetModel.detachCatalogReference({ assetId, requester }).catch(() => {})
            }
        }
        if (importOrganizationId) {
            for (const blobHash of touchedBlobHashes) {
                await enqueueBlobDeletion({ organizationId: importOrganizationId, blobHash }).catch(() => {})
            }
        }
        const message = error instanceof Error ? error.message : 'IMPORT_FAILED'
        const isValidationError = /INVALID|MISSING|MISMATCH|DUPLICATE|REQUIRED|NOT_PORTABLE|TOO_LARGE/.test(message)
        return res.status(isValidationError ? 400 : 500).json({ error: message })
    }
})

export default router
