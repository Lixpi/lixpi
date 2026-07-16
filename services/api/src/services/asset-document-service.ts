'use strict'

import * as process from 'node:process'

import NATS_Service from '@lixpi/nats-service'
import { isTransactionConditionalCheckFailure } from '@lixpi/dynamodb-service'
import {
    getDynamoDbTableStageName,
    NATS_SUBJECTS,
    type Asset,
    type AssetDocumentPointer,
    type AssetDocumentRole,
    type AssetRequesterContext,
} from '@lixpi/constants'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
    PROSEMIRROR_SCHEMA_VERSION,
    getAssetStepSubject,
    getOrganizationAssetStepStreamName,
    type AssetDocCoordinate,
    type AssetDocSnapshot,
    type AssetSubmitStepsPayload,
    type SubmitResult,
} from '@lixpi/prosemirror'

import {
    buildAssetProjectionOperations,
    getAssetRecord,
    publishAssetEvent,
} from '../models/asset.ts'
import AssetModel from '../models/asset.ts'
import BlobModel, {
    buildBlobReferenceOperations,
    buildBlobReferenceRemovalOperations,
} from '../models/blob.ts'
import { AssetProseMirrorStepTransport } from '../prosemirror/asset-prosemirror-step-transport.ts'
import { enqueueAssetSurfaceCleanup, enqueueBlobDeletion } from './asset-maintenance-queue.ts'
import { ensureAssetDocumentEventRelay } from './asset-document-event-relay.ts'

const { ORG_NAME, STAGE } = process.env
const assetsTableName = (): string => getDynamoDbTableStageName('ASSETS', ORG_NAME, STAGE)
const ASSET_DOCUMENT_ROLES: AssetDocumentRole[] = ['content', 'conversation', 'provenance']
const SETTLED_STEP_REPLAY_GRACE_MS = 5 * 60 * 1000

const getDocumentType = (role: AssetDocumentRole) => {
    if (role === 'content') return DOCUMENT_TYPE.ASSET_CONTENT
    if (role === 'conversation') return DOCUMENT_TYPE.ASSET_CONVERSATION
    return DOCUMENT_TYPE.ASSET_PROVENANCE
}

const loadSnapshot = async (asset: Asset, role: AssetDocumentRole): Promise<AssetDocSnapshot | null> => {
    const pointer = asset.documents[role]
    if (!pointer) return null
    const blob = await BlobModel.get({ organizationId: asset.organizationId, blobHash: pointer.blobHash })
    if (!blob) throw new Error('DOCUMENT_BLOB_NOT_FOUND')
    const natsService = NATS_Service.getInstance()
    if (!natsService) throw new Error('NATS service unavailable')
    const bytes = await natsService.getObject(blob.bucketName, blob.objectKey)
    if (!bytes) throw new Error('DOCUMENT_OBJECT_NOT_FOUND')
    return {
        organizationId: asset.organizationId,
        assetId: asset.assetId,
        role,
        blobHash: pointer.blobHash,
        version: pointer.version,
        schemaVersion: pointer.schemaVersion,
        doc: JSON.parse(Buffer.from(bytes).toString('utf8')) as object,
    }
}

const loadCurrentSnapshot = async (asset: Asset, role: AssetDocumentRole): Promise<AssetDocSnapshot | null> => {
    const settledSnapshot = await loadSnapshot(asset, role)
    const events = await AssetProseMirrorStepTransport.fromSingleton().replay({
        organizationId: asset.organizationId,
        assetId: asset.assetId,
        role,
    }, 1, 10_000)
    if (!settledSnapshot && events.length === 0) return null
    const engine = new HeadlessProseMirrorEngine({
        documentType: getDocumentType(role),
        doc: settledSnapshot?.doc,
        version: settledSnapshot?.version ?? 0,
    })
    for (const event of events) {
        if (event.kind !== 'STEP' || event.version <= engine.version) continue
        engine.applyStepJson(event.step)
    }
    return {
        organizationId: asset.organizationId,
        assetId: asset.assetId,
        role,
        ...(settledSnapshot?.blobHash ? { blobHash: settledSnapshot.blobHash } : {}),
        version: engine.version,
        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        doc: engine.snapshot(),
    }
}

const verifyLease = (asset: Asset, workspaceId: string, leaseId: string, holderId?: string): boolean =>
    Boolean(
        asset.editLease
        && asset.editLease.workspaceId === workspaceId
        && asset.editLease.leaseId === leaseId
        && asset.editLease.expiresAt > Date.now()
        && (!holderId || asset.editLease.holders.some(holder =>
            holder.holderId === holderId && holder.expiresAt > Date.now()
        )),
    )

const collectEmbeddedAssetIds = (node: unknown, assetIds = new Set<string>()): Set<string> => {
    if (!node || typeof node !== 'object') return assetIds
    const record = node as { attrs?: { assetId?: unknown }; content?: unknown }
    if (typeof record.attrs?.assetId === 'string' && record.attrs.assetId) assetIds.add(record.attrs.assetId)
    if (Array.isArray(record.content)) {
        for (const child of record.content) collectEmbeddedAssetIds(child, assetIds)
    }
    return assetIds
}

const isMatchingAssetRenditionUrl = (value: unknown, assetId: string): boolean => {
    if (typeof value !== 'string' || !value.startsWith('/api/assets/')) return false
    try {
        const url = new URL(value, 'http://asset.local')
        const match = /^\/api\/assets\/([^/]+)\/renditions\/[^/]+$/.exec(url.pathname)
        return Boolean(match
            && decodeURIComponent(match[1]!) === assetId
            && !url.searchParams.has('token'))
    } catch {
        return false
    }
}

export const assertAssetBackedMediaNodes = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const record = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown }
    if (record.type === 'image' || record.type === 'aiGeneratedImage' || record.type === 'aiGeneratedVideo') {
        const assetId = record.attrs?.assetId
        if (typeof assetId !== 'string' || !assetId) throw new Error(`ASSET_ID_REQUIRED_FOR_MEDIA_NODE:${record.type}`)
        const urlFields = record.type === 'image'
            ? ['src']
            : record.type === 'aiGeneratedImage'
                ? ['imageData']
                : ['videoUrl', 'posterUrl']
        for (const field of urlFields) {
            const value = record.attrs?.[field]
            if (value !== undefined && value !== '' && !isMatchingAssetRenditionUrl(value, assetId)) {
                throw new Error(`ASSET_RENDITION_URL_MISMATCH:${record.type}:${field}`)
            }
        }
    }
    for (const traceField of ['imageGenerationTrace', 'videoGenerationTrace']) {
        const trace = record.attrs?.[traceField] as { referenceImages?: unknown } | undefined
        if (!Array.isArray(trace?.referenceImages)) continue
        for (const reference of trace.referenceImages) {
            const imageUrl = (reference as { imageUrl?: unknown })?.imageUrl
            if (imageUrl === undefined || imageUrl === '') continue
            if (typeof imageUrl !== 'string' || !imageUrl.startsWith('/api/')) {
                throw new Error(`ASSET_TRACE_URL_INVALID:${traceField}`)
            }
            const parsed = new URL(imageUrl, 'http://asset.local')
            if (parsed.searchParams.has('token')) throw new Error(`ASSET_TRACE_TOKEN_FORBIDDEN:${traceField}`)
        }
    }
    if (Array.isArray(record.content)) {
        for (const child of record.content) assertAssetBackedMediaNodes(child)
    }
}

const validateEmbeddedAssetReferences = async ({
    hostAsset,
    doc,
    role,
}: {
    hostAsset: Asset
    doc: object
    role: 'content' | 'conversation'
}): Promise<void> => {
    for (const embeddedAssetId of collectEmbeddedAssetIds(doc)) {
        if (embeddedAssetId === hostAsset.assetId) throw new Error('SELF_REFERENTIAL_ASSET_DOCUMENT')
        const embeddedAsset = await getAssetRecord(embeddedAssetId)
        if (!embeddedAsset || embeddedAsset.organizationId !== hostAsset.organizationId) {
            throw new Error(`EMBEDDED_ASSET_TENANT_MISMATCH:${embeddedAssetId}`)
        }
        const references = await AssetModel.listReferences(embeddedAssetId)
        const surfacePrefix = role === 'content'
            ? `document#${hostAsset.assetId}#content`
            : `conversation#${hostAsset.assetId}#media#`
        const referenced = references.some((reference) => reference.type === 'workspace'
            && (role === 'content'
                ? reference.surfaceIds?.includes(surfacePrefix)
                : reference.surfaceIds?.some((surfaceId) => surfaceId.startsWith(surfacePrefix))))
        if (!referenced) throw new Error(`EMBEDDED_ASSET_REFERENCE_MISSING:${embeddedAssetId}`)
    }
}

const settle = async ({
    asset,
    role,
    workspaceId,
    leaseId,
    holderId,
    requester,
}: {
    asset: Asset
    role: AssetDocumentRole
    workspaceId: string
    leaseId: string
    holderId?: string
    requester?: AssetRequesterContext
}): Promise<AssetDocumentPointer> => {
    if (!verifyLease(asset, workspaceId, leaseId, holderId)) throw new Error('LEASE_INVALID')
    const snapshot = await loadSnapshot(asset, role)
    const transport = AssetProseMirrorStepTransport.fromSingleton()
    const events = await transport.replay({
        organizationId: asset.organizationId,
        assetId: asset.assetId,
        role,
    }, 1, 10_000)
    const incorporatedStreamSequence = events.reduce(
        (latest, event) => Math.max(latest, event.streamSequence),
        0,
    )
    const engine = new HeadlessProseMirrorEngine({
        documentType: getDocumentType(role),
        doc: snapshot?.doc,
        version: snapshot?.version ?? 0,
    })
    for (const event of events) {
        if (event.kind !== 'STEP') continue
        if (event.version <= engine.version) continue
        engine.applyStepJson(event.step)
    }
    if (snapshot && engine.version <= snapshot.version) return asset.documents[role]!

    const json = engine.snapshot()
    assertAssetBackedMediaNodes(json)
    const tracksEmbeddedAssets = role === 'content' || role === 'conversation'
    const previousEmbeddedAssetIds = tracksEmbeddedAssets
        ? collectEmbeddedAssetIds(snapshot?.doc)
        : new Set<string>()
    const nextEmbeddedAssetIds = tracksEmbeddedAssets
        ? collectEmbeddedAssetIds(json)
        : new Set<string>()
    const embeddedSurfaceId = `document#${asset.assetId}#content`
    const newlyAttachedEmbeddedAssetIds: string[] = []
    const bytes = Buffer.from(JSON.stringify(json), 'utf8')
    const blob = await BlobModel.store({
        organizationId: asset.organizationId,
        bytes,
        mimeType: 'application/json',
        description: `Asset ${asset.assetId} ${role} snapshot v${engine.version}`,
    })
    const now = Date.now()
    const pointer: AssetDocumentPointer = {
        role,
        blobHash: blob.blobHash,
        version: engine.version,
        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        byteSize: bytes.byteLength,
        updatedAt: now,
        ...(role === 'provenance' ? { sealedAt: now } : {}),
    }
    const referenceKey = `asset#${asset.assetId}#document#${role}`
    const operations = asset.documents[role]?.blobHash === blob.blobHash
        ? []
        : buildBlobReferenceOperations({
            blob,
            reference: {
                blobKey: blob.blobKey,
                blobHash: blob.blobHash,
                organizationId: blob.organizationId,
                referenceKey,
                ownerType: 'asset',
                ownerId: asset.assetId,
                createdAt: now,
            },
            now,
        })
    let oldBlobDeletionRequired = false
    const oldBlobHash = asset.documents[role]?.blobHash
    if (oldBlobHash && oldBlobHash !== blob.blobHash) {
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId: asset.organizationId,
            blobHash: oldBlobHash,
            referenceKey,
            now,
        })
        operations.push(...removal.operations)
        oldBlobDeletionRequired = removal.deletionRequired
    }
    const next: Asset = {
        ...asset,
        documents: { ...asset.documents, [role]: pointer },
        revision: asset.revision + 1,
        updatedAt: now,
    }
    const projectionOperations = await buildAssetProjectionOperations(next)
    operations.push({
        type: 'update',
        tableName: assetsTableName(),
        key: { assetId: asset.assetId },
        updates: {
            documents: next.documents,
            revision: next.revision,
            updatedAt: now,
        },
        conditionExpression: '#revision = :expectedRevision AND #editLease = :expectedEditLease AND #editLease.#expiresAt > :now',
        expressionAttributeNames: {
            '#revision': 'revision',
            '#editLease': 'editLease',
            '#expiresAt': 'expiresAt',
        },
        expressionAttributeValues: {
            ':expectedRevision': asset.revision,
            ':expectedEditLease': asset.editLease,
            ':now': now,
        },
    }, ...projectionOperations)
    try {
        if (tracksEmbeddedAssets) {
            if (role === 'content') {
                if (!requester) throw new Error('CONTENT_SETTLEMENT_REQUESTER_REQUIRED')
                for (const embeddedAssetId of nextEmbeddedAssetIds) {
                    if (previousEmbeddedAssetIds.has(embeddedAssetId)) continue
                    const attached = await AssetModel.attachWorkspaceReference({
                        assetId: embeddedAssetId,
                        workspaceId,
                        requester,
                        surfaceId: embeddedSurfaceId,
                    })
                    if ('error' in attached) throw new Error(attached.error)
                    newlyAttachedEmbeddedAssetIds.push(embeddedAssetId)
                }
            }
            await validateEmbeddedAssetReferences({ hostAsset: asset, doc: json, role })
        }
        await dynamoDBService.transactWrite({ operations, origin: 'AssetDocumentService.settle' })
    } catch (error) {
        for (const embeddedAssetId of newlyAttachedEmbeddedAssetIds) {
            await enqueueAssetSurfaceCleanup({
                assetId: embeddedAssetId,
                organizationId: asset.organizationId,
                surfaceId: embeddedSurfaceId,
            }).catch(() => undefined)
        }
        throw error
    }
    publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
    if (incorporatedStreamSequence > 0) {
        const timer = setTimeout(() => {
            void transport.purgeThrough(
                { organizationId: asset.organizationId, assetId: asset.assetId, role },
                incorporatedStreamSequence,
            ).catch((error) => console.error('Settled Asset step purge failed:', {
                assetId: asset.assetId,
                role,
                error,
            }))
        }, SETTLED_STEP_REPLAY_GRACE_MS)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    }
    if (oldBlobDeletionRequired && oldBlobHash) {
        await enqueueBlobDeletion({ organizationId: asset.organizationId, blobHash: oldBlobHash })
    }
    for (const embeddedAssetId of previousEmbeddedAssetIds) {
        if (nextEmbeddedAssetIds.has(embeddedAssetId)) continue
        if (role === 'content') {
            await enqueueAssetSurfaceCleanup({
                assetId: embeddedAssetId,
                organizationId: asset.organizationId,
                surfaceId: embeddedSurfaceId,
            })
            continue
        }
        const references = await AssetModel.listReferences(embeddedAssetId)
        for (const reference of references) {
            for (const surfaceId of reference.surfaceIds?.filter((value) =>
                value.startsWith(`conversation#${asset.assetId}#media#`)) ?? []) {
                await enqueueAssetSurfaceCleanup({
                    assetId: embeddedAssetId,
                    organizationId: asset.organizationId,
                    surfaceId,
                })
            }
        }
    }
    return pointer
}

const replaceSystemSnapshot = async ({
    asset,
    role,
    doc,
    version,
}: {
    asset: Asset
    role: AssetDocumentRole
    doc: object
    version: number
}): Promise<AssetDocumentPointer> => {
    if (role === 'provenance') throw new Error('USE_PROVENANCE_MATERIALIZER')
    new HeadlessProseMirrorEngine({ documentType: getDocumentType(role), doc, version })
    assertAssetBackedMediaNodes(doc)
    const bytes = Buffer.from(JSON.stringify(doc), 'utf8')
    const blob = await BlobModel.store({
        organizationId: asset.organizationId,
        bytes,
        mimeType: 'application/json',
        description: `Asset ${asset.assetId} ${role} system snapshot v${version}`,
    })
    const now = Date.now()
    const pointer: AssetDocumentPointer = {
        role,
        blobHash: blob.blobHash,
        version,
        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
        byteSize: bytes.byteLength,
        updatedAt: now,
    }
    const referenceKey = `asset#${asset.assetId}#document#${role}`
    const operations = asset.documents[role]?.blobHash === blob.blobHash
        ? []
        : buildBlobReferenceOperations({
            blob,
            reference: {
                blobKey: blob.blobKey,
                blobHash: blob.blobHash,
                organizationId: blob.organizationId,
                referenceKey,
                ownerType: 'asset',
                ownerId: asset.assetId,
                createdAt: now,
            },
            now,
        })
    const oldBlobHash = asset.documents[role]?.blobHash
    let oldBlobDeletionRequired = false
    if (oldBlobHash && oldBlobHash !== blob.blobHash) {
        const removal = await buildBlobReferenceRemovalOperations({
            organizationId: asset.organizationId,
            blobHash: oldBlobHash,
            referenceKey,
            now,
        })
        operations.push(...removal.operations)
        oldBlobDeletionRequired = removal.deletionRequired
    }
    const next: Asset = {
        ...asset,
        documents: { ...asset.documents, [role]: pointer },
        revision: asset.revision + 1,
        updatedAt: now,
    }
    operations.push({
        type: 'update',
        tableName: assetsTableName(),
        key: { assetId: asset.assetId },
        updates: { documents: next.documents, revision: next.revision, updatedAt: now },
        conditionExpression: '#revision = :expectedRevision',
        expressionAttributeNames: { '#revision': 'revision' },
        expressionAttributeValues: { ':expectedRevision': asset.revision },
    }, ...await buildAssetProjectionOperations(next))
    await dynamoDBService.transactWrite({ operations, origin: 'AssetDocumentService.replaceSystemSnapshot' })
    publishAssetEvent(NATS_SUBJECTS.ASSET_SUBJECTS.EVENTS.UPDATED, next)
    if (oldBlobDeletionRequired && oldBlobHash) {
        await enqueueBlobDeletion({ organizationId: asset.organizationId, blobHash: oldBlobHash })
    }
    return pointer
}

const AssetDocumentService = {
    loadSnapshot,
    loadCurrentSnapshot,
    getEmbeddedAssetIds: (doc: object): string[] => [...collectEmbeddedAssetIds(doc)],
    replaceSystemSnapshot,
    assertAssetBackedMediaNodes,
    submitSteps: async ({
        payload,
        requester,
    }: {
        payload: AssetSubmitStepsPayload
        requester: AssetRequesterContext
    }): Promise<SubmitResult | { error: string }> => {
        if (!ASSET_DOCUMENT_ROLES.includes(payload.role)) return { error: 'INVALID_DOCUMENT_ROLE' }
        if (payload.role === 'provenance') return { error: 'PROVENANCE_IS_READ_ONLY' }
        if (!Array.isArray(payload.steps) || payload.steps.length < 1 || payload.steps.length > 50) {
            return { error: 'INVALID_STEP_BATCH' }
        }
        if (!Number.isSafeInteger(payload.baseVersion)
            || payload.baseVersion < 0
            || !Number.isSafeInteger(payload.expectedVersion)
            || payload.expectedVersion < 0) return { error: 'INVALID_DOCUMENT_VERSION' }
        const authorized = await AssetModel.get({ assetId: payload.assetId, requester })
        if ('error' in authorized) return authorized
        const asset = authorized
        if (asset.organizationId !== payload.organizationId) return { error: 'NOT_FOUND' }
        if (!asset.documents[payload.role]) return { error: 'DOCUMENT_ROLE_NOT_FOUND' }
        if (!requester.editableWorkspaceIds.includes(payload.workspaceId)) return { error: 'PERMISSION_DENIED' }
        if (!verifyLease(asset, payload.workspaceId, payload.leaseId, payload.holderId)) return { error: 'LEASE_INVALID' }
        const result = await AssetProseMirrorStepTransport.fromSingleton().submitSteps(payload)
        if (result.status === 'ACCEPTED') {
            const timer = setTimeout(() => {
                void (async () => {
                    try {
                        for (let attempt = 0; attempt < 5; attempt += 1) {
                            const current = await getAssetRecord(payload.assetId)
                            if (!current) return
                            try {
                                await settle({
                                    asset: current,
                                    role: payload.role,
                                    workspaceId: payload.workspaceId,
                                    leaseId: payload.leaseId,
                                    holderId: payload.holderId,
                                    requester,
                                })
                                return
                            } catch (error) {
                                if (!isTransactionConditionalCheckFailure(error) || attempt === 4) throw error
                            }
                        }
                    } catch (error) {
                        console.error('Asset document settlement failed:', error)
                    }
                })()
            }, 1000)
            if (typeof timer === 'object' && 'unref' in timer) timer.unref()
        }
        return result
    },

    resume: async ({
        coordinate,
        requester,
        localVersion = 0,
        localStreamSeq = 0,
        activateLiveRelay = false,
    }: {
        coordinate: AssetDocCoordinate
        requester: AssetRequesterContext
        localVersion?: number
        localStreamSeq?: number
        activateLiveRelay?: boolean
    }) => {
        if (!ASSET_DOCUMENT_ROLES.includes(coordinate.role)) return { error: 'INVALID_DOCUMENT_ROLE' }
        if (!Number.isSafeInteger(localVersion) || localVersion < 0
            || !Number.isSafeInteger(localStreamSeq) || localStreamSeq < 0) {
            return { error: 'INVALID_DOCUMENT_CURSOR' }
        }
        const authorized = await AssetModel.get({ assetId: coordinate.assetId, requester })
        if ('error' in authorized) return authorized
        if (authorized.organizationId !== coordinate.organizationId) return { error: 'NOT_FOUND' }
        if (!authorized.documents[coordinate.role]) return { error: 'DOCUMENT_ROLE_NOT_FOUND' }
        const asset = authorized
        const liveSubject = activateLiveRelay
            ? ensureAssetDocumentEventRelay({ coordinate, requester })
            : undefined
        const snapshot = await loadSnapshot(asset, coordinate.role)
        const transport = AssetProseMirrorStepTransport.fromSingleton()
        const state = await transport.getCurrentSubjectState(coordinate)
        const events = state.streamSequence > localStreamSeq
            ? (await transport.replay(coordinate, localStreamSeq + 1, 10_000)).filter((event) =>
                event.kind !== 'STEP' || event.version > localVersion)
            : []
        return {
            snapshot,
            currentVersion: Math.max(snapshot?.version ?? 0, state.documentVersion),
            currentStreamSeq: state.streamSequence,
            streamName: getOrganizationAssetStepStreamName(coordinate.organizationId),
            subject: getAssetStepSubject(coordinate),
            ...(liveSubject ? { liveSubject } : {}),
            events,
        }
    },

    settle,
}

export default AssetDocumentService
