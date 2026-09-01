import * as process from 'node:process'

import {
    getDynamoDbTableStageName,
    type BlobReference,
    type CapabilityCatalogRecord,
    type CapabilityKind,
    type CapabilityManifest,
    type CapabilityMeta,
    type CapabilityPackageExposure,
    type CapabilityResourceRef,
    type CapabilityResourceRole,
    type CapabilityResourceMediaType,
    type CapabilityScope,
    type CapabilityRun,
    type CapabilityStatus,
} from '@lixpi/constants'
import { validateCapabilityManifest } from '@lixpi/capability-system/shared'
import {
    isTransactionConditionalCheckFailure,
    type TransactOperation,
} from '@lixpi/dynamodb-service'

import BlobModel, { buildBlobReferenceBatchOperations } from './blob.ts'
import { getContentAddressedBlob } from '../services/blob-storage.ts'

const { ORG_NAME, STAGE } = process.env
const capabilitiesTableName = (): string => getDynamoDbTableStageName('CAPABILITIES', ORG_NAME, STAGE)
const capabilitiesMetaTableName = (): string => getDynamoDbTableStageName('CAPABILITIES_META', ORG_NAME, STAGE)
const capabilitiesAccessListTableName = (): string => getDynamoDbTableStageName('CAPABILITIES_ACCESS_LIST', ORG_NAME, STAGE)
const capabilityRunsTableName = (): string => getDynamoDbTableStageName('CAPABILITY_RUNS', ORG_NAME, STAGE)
const blobReferencesTableName = (): string => getDynamoDbTableStageName('BLOB_REFERENCES', ORG_NAME, STAGE)
const CAPABILITY_MAX_RUN_DURATION_MS = Number(process.env.CAPABILITY_MAX_RUN_DURATION_MS ?? 24 * 60 * 60 * 1000)
export const CAPABILITY_BLOB_RETIREMENT_GRACE_MS = Math.max(
    Number(process.env.CAPABILITY_BLOB_RETIREMENT_GRACE_MS ?? 7 * 24 * 60 * 60 * 1000),
    CAPABILITY_MAX_RUN_DURATION_MS + 1,
)

export type CapabilityAccessLevel = 'viewer' | 'editor' | 'owner'

export type CapabilityAccessGrant = {
    capabilityId: string
    principalId: string
    accessLevel: CapabilityAccessLevel
    createdAt: number
    updatedAt: number
}

export type CapabilityRequesterContext = {
    userId: string
    organizationIds: string[]
    canManageGlobalCapabilities?: boolean
}

export type CapabilityCatalogCursor = {
    partitions: Record<string, Record<string, unknown>>
    query: string
    kinds: CapabilityKind[]
    buffered?: Array<Pick<CapabilityMeta, 'scopeAndOwner' | 'searchKey'>>
    completed?: string[]
}

export type CapabilityCatalogPage = {
    items: CapabilityMeta[]
    cursor?: string
}

type SaveCapabilityInput = {
    manifest: CapabilityManifest
    scope: CapabilityScope
    scopeOwnerId: string
    storageOwnerId: string
    summary: string
    tags: string[]
    parentModuleId?: string
    catalogExposure: CapabilityPackageExposure
    requester: CapabilityRequesterContext
    expectedManifestBlobHash?: string
    grants?: Array<{ principalId: string; accessLevel: CapabilityAccessLevel }>
    allowedActions: ReadonlySet<string>
    allowInvalidPreviousBuiltInManifest?: boolean
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function normalizeCapabilityName(name: string): string {
    return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalize(item)]),
    )
}

export function serializeCapabilityManifest(manifest: CapabilityManifest): Uint8Array {
    return textEncoder.encode(JSON.stringify(canonicalize(manifest)))
}

export function buildCapabilityScopeAndOwner(scope: CapabilityScope, scopeOwnerId: string): string {
    return scope === 'global' ? 'global#system' : `${scope}#${scopeOwnerId}`
}

export function buildCapabilitySearchKey(kind: CapabilityKind, normalizedName: string, capabilityId: string): string {
    return `${kind}#${normalizedName}#${capabilityId}`
}

function decodeCursor(
    cursor: string | undefined,
    query: string,
    kinds: CapabilityKind[],
    allowedCursorKeys: Map<string, { scopeAndOwner: string; searchPrefix: string }>,
): CapabilityCatalogCursor {
    if (!cursor) return { partitions: {}, query, kinds }
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CapabilityCatalogCursor
        if (
            !parsed || typeof parsed !== 'object' || !parsed.partitions
            || typeof parsed.partitions !== 'object' || Array.isArray(parsed.partitions)
            || parsed.query !== query || JSON.stringify(parsed.kinds) !== JSON.stringify(kinds)
        ) {
            throw new Error('INVALID_CURSOR')
        }
        for (const [cursorKey, lastKey] of Object.entries(parsed.partitions)) {
            const expected = allowedCursorKeys.get(cursorKey)
            if (
                !expected || !lastKey || typeof lastKey !== 'object' || Array.isArray(lastKey)
                || lastKey.scopeAndOwner !== expected.scopeAndOwner
                || typeof lastKey.searchKey !== 'string'
                || !lastKey.searchKey.startsWith(expected.searchPrefix)
            ) throw new Error('INVALID_CURSOR')
        }
        if (
            parsed.completed && (!Array.isArray(parsed.completed)
                || parsed.completed.some((cursorKey) => typeof cursorKey !== 'string' || !allowedCursorKeys.has(cursorKey)))
        ) {
            throw new Error('INVALID_CURSOR')
        }
        if (
            parsed.buffered && (!Array.isArray(parsed.buffered) || parsed.buffered.length > 1000
                || parsed.buffered.some((key) => {
                    if (
                        !key || typeof key !== 'object' || Array.isArray(key)
                        || typeof key.scopeAndOwner !== 'string' || typeof key.searchKey !== 'string'
                    ) return true
                    return ![...allowedCursorKeys.values()].some((expected) => (
                        key.scopeAndOwner === expected.scopeAndOwner
                        && key.searchKey.startsWith(expected.searchPrefix)
                    ))
                }))
        ) throw new Error('INVALID_CURSOR')
        return parsed
    } catch {
        throw new Error('INVALID_CURSOR')
    }
}

function encodeCursor(cursor: CapabilityCatalogCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function getPrecedence(scopeAndOwner: string): number {
    if (scopeAndOwner.startsWith('user#')) return 0
    if (scopeAndOwner.startsWith('organization#')) return 1
    if (scopeAndOwner === 'global#system') return 2
    return 3
}

async function getAccess(capabilityId: string, principalId: string): Promise<CapabilityAccessGrant | undefined> {
    return await dynamoDBService.getItem({
        tableName: capabilitiesAccessListTableName(),
        key: { capabilityId, principalId },
        consistentRead: true,
        origin: 'Capability.getAccess',
    }) as CapabilityAccessGrant | undefined
}

function canReadBaseScope(record: CapabilityCatalogRecord, requester: CapabilityRequesterContext): boolean {
    if (record.scope === 'global') return true
    if (record.scope === 'user') return record.scopeOwnerId === requester.userId
    return requester.organizationIds.includes(record.scopeOwnerId)
}

function canManageBaseScope(record: CapabilityCatalogRecord, requester: CapabilityRequesterContext): boolean {
    if (record.scope === 'global') return requester.canManageGlobalCapabilities === true
    return record.ownerUserId === requester.userId
}

function normalizeStoredCapabilityRecord(record: CapabilityCatalogRecord): CapabilityCatalogRecord {
    if (record.catalogExposure === 'standalone' || record.catalogExposure === 'module-internal') return record
    const { catalogVisibility: legacyVisibility, ...normalized } = record as CapabilityCatalogRecord & { catalogVisibility?: unknown }
    return {
        ...normalized,
        catalogExposure: legacyVisibility === 'internal' ? 'module-internal' : 'standalone',
    }
}

function normalizeStoredCapabilityMeta(meta: CapabilityMeta): CapabilityMeta {
    if (meta.catalogExposure === 'standalone' || meta.catalogExposure === 'module-internal') return meta
    const { catalogVisibility: legacyVisibility, ...normalized } = meta as CapabilityMeta & { catalogVisibility?: unknown }
    return {
        ...normalized,
        catalogExposure: legacyVisibility === 'internal' ? 'module-internal' : 'standalone',
    }
}

export async function authorizeCapability({
    capabilityId,
    requester,
    access = 'read',
}: {
    capabilityId: string
    requester: CapabilityRequesterContext
    access?: 'read' | 'edit'
}): Promise<CapabilityCatalogRecord | { error: 'NOT_FOUND' | 'PERMISSION_DENIED' }> {
    const record = await dynamoDBService.getItem({
        tableName: capabilitiesTableName(),
        key: { capabilityId },
        consistentRead: true,
        origin: 'Capability.authorize',
    }) as CapabilityCatalogRecord | undefined
    if (!record || record.status === 'removed') return { error: 'NOT_FOUND' }
    const normalizedRecord = normalizeStoredCapabilityRecord(record)
    if (access === 'read' && canReadBaseScope(normalizedRecord, requester)) return normalizedRecord
    if (access === 'edit' && canManageBaseScope(normalizedRecord, requester)) return normalizedRecord
    const grant = await getAccess(capabilityId, requester.userId)
    if (access === 'read' && grant) return normalizedRecord
    if (access === 'edit' && (grant?.accessLevel === 'editor' || grant?.accessLevel === 'owner')) return normalizedRecord
    return { error: 'PERMISSION_DENIED' }
}

export async function getAuthorizedCapabilityRecords({
    capabilityIds,
    requester,
}: {
    capabilityIds: string[]
    requester: CapabilityRequesterContext
}): Promise<Map<string, CapabilityCatalogRecord>> {
    const uniqueIds = [...new Set(capabilityIds)]
    if (uniqueIds.length === 0) return new Map()
    const result = await dynamoDBService.batchReadItems({
        queries: [{
            tableName: capabilitiesTableName(),
            keys: uniqueIds.map((capabilityId) => ({ capabilityId })),
        }],
        fetchAllItems: true,
        scanIndexForward: true,
        origin: 'Capability.getAuthorizedCapabilityRecords',
    })
    const records = (result?.items?.[capabilitiesTableName()] ?? []) as CapabilityCatalogRecord[]
    const authorized = new Map<string, CapabilityCatalogRecord>()
    await Promise.all(records.map(async (record) => {
        if (record.status === 'removed') return
        if (canReadBaseScope(record, requester) || await getAccess(record.capabilityId, requester.userId)) {
            authorized.set(record.capabilityId, normalizeStoredCapabilityRecord(record))
        }
    }))
    return authorized
}

async function authorizeCapabilityRecordSnapshot(
    record: CapabilityCatalogRecord,
    requester: CapabilityRequesterContext,
): Promise<void> {
    if (record.status === 'removed') throw new Error('NOT_FOUND')
    if (canReadBaseScope(record, requester)) return
    if (await getAccess(record.capabilityId, requester.userId)) return
    throw new Error('PERMISSION_DENIED')
}

export async function readAuthorizedCapabilityManifestSnapshot({
    record,
    requester,
}: {
    record: CapabilityCatalogRecord
    requester: CapabilityRequesterContext
}): Promise<{ record: CapabilityCatalogRecord; manifest: CapabilityManifest; bytes: Uint8Array }> {
    await authorizeCapabilityRecordSnapshot(record, requester)
    const bytes = await getContentAddressedBlob({
        organizationId: record.storageOwnerId,
        blobHash: record.manifestBlobHash,
    })
    let manifest: unknown
    try {
        manifest = JSON.parse(textDecoder.decode(bytes))
    } catch {
        throw new Error('INVALID_CAPABILITY_MANIFEST_JSON')
    }
    const validation = validateCapabilityManifest(manifest)
    if (!validation.valid || validation.manifest.capabilityId !== record.capabilityId || validation.manifest.kind !== record.kind) {
        throw new Error('INVALID_CAPABILITY_MANIFEST')
    }
    return { record, manifest: validation.manifest, bytes }
}

export async function readAuthorizedCapabilityManifest({
    capabilityId,
    requester,
    expectedManifestBlobHash,
}: {
    capabilityId: string
    requester: CapabilityRequesterContext
    expectedManifestBlobHash?: string
}): Promise<{ record: CapabilityCatalogRecord; manifest: CapabilityManifest; bytes: Uint8Array }> {
    const record = await authorizeCapability({ capabilityId, requester })
    if ('error' in record) throw new Error(record.error)
    return await readAuthorizedCapabilityManifestSnapshot({
        record: {
            ...record,
            manifestBlobHash: expectedManifestBlobHash ?? record.manifestBlobHash,
        },
        requester,
    })
}

export async function readAuthorizedCapabilityResource({
    capabilityId,
    resourceId,
    requester,
    manifestBlobHash,
}: {
    capabilityId: string
    resourceId: string
    requester: CapabilityRequesterContext
    manifestBlobHash?: string
}): Promise<{ bytes: Uint8Array; mediaType: string; blobHash: string }> {
    const { record, manifest } = await readAuthorizedCapabilityManifest({
        capabilityId,
        requester,
        expectedManifestBlobHash: manifestBlobHash,
    })
    const resource = manifest.resources.find((candidate) => candidate.resourceId === resourceId)
    if (!resource) throw new Error('CAPABILITY_RESOURCE_NOT_FOUND')
    const bytes = await getContentAddressedBlob({
        organizationId: record.storageOwnerId,
        blobHash: resource.blobHash,
    })
    return { bytes, mediaType: resource.mediaType, blobHash: resource.blobHash }
}

export async function readAuthorizedCapabilityResourceSnapshot({
    record,
    manifest,
    resourceId,
    requester,
}: {
    record: CapabilityCatalogRecord
    manifest: CapabilityManifest
    resourceId: string
    requester: CapabilityRequesterContext
}): Promise<{ bytes: Uint8Array; mediaType: string; blobHash: string }> {
    await authorizeCapabilityRecordSnapshot(record, requester)
    if (manifest.capabilityId !== record.capabilityId || manifest.kind !== record.kind) {
        throw new Error('INVALID_CAPABILITY_MANIFEST')
    }
    const resource = manifest.resources.find((candidate) => candidate.resourceId === resourceId)
    if (!resource) throw new Error('CAPABILITY_RESOURCE_NOT_FOUND')
    const bytes = await getContentAddressedBlob({
        organizationId: record.storageOwnerId,
        blobHash: resource.blobHash,
    })
    return { bytes, mediaType: resource.mediaType, blobHash: resource.blobHash }
}

export async function listAuthorizedCapabilities({
    requester,
    query = '',
    kinds = ['tool', 'skill'],
    limit = 20,
    cursor,
}: {
    requester: CapabilityRequesterContext
    query?: string
    kinds?: CapabilityKind[]
    limit?: number
    cursor?: string
}): Promise<CapabilityCatalogPage> {
    if (limit < 1 || limit > 20) throw new Error('INVALID_CAPABILITY_PAGE_LIMIT')
    const normalizedQuery = normalizeCapabilityName(query)
    const uniqueKinds = [...new Set(kinds)]
    const partitions = [
        `user#${requester.userId}`,
        ...requester.organizationIds.map((organizationId) => `organization#${organizationId}`),
        'global#system',
        `principal#${requester.userId}`,
    ]
    const allowedCursorKeys = new Map(partitions.flatMap((partition) =>
        uniqueKinds.map((kind) =>
            [
                `${partition}|${kind}`,
                { scopeAndOwner: partition, searchPrefix: `${kind}#${normalizedQuery}` },
            ] as const
        )
    ))
    const decoded = decodeCursor(cursor, normalizedQuery, uniqueKinds, allowedCursorKeys)
    const bufferedRows = await Promise.all((decoded.buffered ?? []).map(async (key) =>
        await dynamoDBService.getItem({
            tableName: capabilitiesMetaTableName(),
            key,
            consistentRead: true,
            origin: 'Capability.listAuthorizedCapabilities.buffered',
        }) as CapabilityMeta | undefined
    ))
    const requests = partitions.flatMap((partition) =>
        uniqueKinds.map(async (kind) => {
            const cursorKey = `${partition}|${kind}`
            if (decoded.completed?.includes(cursorKey)) {
                return { cursorKey, items: [] as CapabilityMeta[], lastKey: undefined, completed: true }
            }
            const result = await dynamoDBService.queryItems({
                tableName: capabilitiesMetaTableName(),
                keyConditions: { scopeAndOwner: partition },
                sortKeyCondition: {
                    key: 'searchKey',
                    operator: 'begins_with',
                    value: `${kind}#${normalizedQuery}`,
                },
                exclusiveStartKey: decoded.partitions[cursorKey],
                limit,
                scanIndexForward: true,
                origin: 'Capability.listAuthorizedCapabilities',
            })
            return {
                cursorKey,
                items: (result?.items ?? []) as CapabilityMeta[],
                lastKey: result?.lastEvaluatedKey,
                completed: !result?.lastEvaluatedKey,
            }
        })
    )
    const pages = await Promise.all(requests)
    const nextPartitions: Record<string, Record<string, unknown>> = {}
    const completed = new Set(decoded.completed ?? [])
    const merged = new Map<string, CapabilityMeta>()
    const candidates = bufferedRows
        .filter((item): item is CapabilityMeta => item !== undefined)
        .map(normalizeStoredCapabilityMeta)
    for (const page of pages) {
        if (page.lastKey) nextPartitions[page.cursorKey] = page.lastKey
        if (page.completed) completed.add(page.cursorKey)
        candidates.push(...page.items.map(normalizeStoredCapabilityMeta))
    }
    const editVisibilityByCapabilityId = new Map<string, Promise<boolean>>()
    const visibleCandidates = await Promise.all(candidates.map(async item => ({
        item,
        visible: await isCatalogMetaVisible(item, requester, editVisibilityByCapabilityId),
    })))
    for (const { item, visible } of visibleCandidates) {
        if (!visible) continue
        const existing = merged.get(item.capabilityId)
        if (!existing || getPrecedence(item.scopeAndOwner) < getPrecedence(existing.scopeAndOwner)) {
            merged.set(item.capabilityId, item)
        }
    }
    const sortedItems = [...merged.values()]
        .sort((left, right) =>
            left.normalizedName.localeCompare(right.normalizedName)
            || left.kind.localeCompare(right.kind)
            || left.capabilityId.localeCompare(right.capabilityId)
        )
    const items = sortedItems.slice(0, limit)
    const buffered = sortedItems.slice(limit)
    return {
        items,
        ...(Object.keys(nextPartitions).length > 0 || buffered.length > 0
            ? {
                cursor: encodeCursor({
                    partitions: nextPartitions,
                    query: normalizedQuery,
                    kinds: uniqueKinds,
                    completed: [...completed],
                    ...(buffered.length > 0
                        ? {
                            buffered: buffered.map(({ scopeAndOwner, searchKey }) => ({ scopeAndOwner, searchKey })),
                        }
                        : {}),
                }),
            }
            : {}),
    }
}

export async function listAuthorizedStandaloneCapabilities(input: Parameters<typeof listAuthorizedCapabilities>[0]): Promise<CapabilityCatalogPage> {
    return await listAuthorizedCapabilities(input)
}

async function canEditCapability(item: CapabilityMeta, requester: CapabilityRequesterContext): Promise<boolean> {
    const result = await authorizeCapability({ capabilityId: item.capabilityId, requester, access: 'edit' })
    return !('error' in result)
}

async function isCatalogMetaVisible(
    item: CapabilityMeta,
    requester: CapabilityRequesterContext,
    editVisibilityByCapabilityId: Map<string, Promise<boolean>>,
): Promise<boolean> {
    if (item.catalogExposure !== 'standalone' || item.parentModuleId !== undefined) return false
    if (item.status === 'active') return true
    if (item.status !== 'disabled') return false
    let canEdit = editVisibilityByCapabilityId.get(item.capabilityId)
    if (!canEdit) {
        canEdit = canEditCapability(item, requester)
        editVisibilityByCapabilityId.set(item.capabilityId, canEdit)
    }
    return await canEdit
}

function buildMeta(record: CapabilityCatalogRecord, manifest: CapabilityManifest, summary: string, tags: string[]): CapabilityMeta {
    const normalizedName = normalizeCapabilityName(manifest.name)
    return {
        scopeAndOwner: buildCapabilityScopeAndOwner(record.scope, record.scopeOwnerId),
        scope: record.scope,
        scopeOwnerId: record.scopeOwnerId,
        searchKey: buildCapabilitySearchKey(record.kind, normalizedName, record.capabilityId),
        capabilityId: record.capabilityId,
        kind: record.kind,
        name: manifest.name,
        normalizedName,
        summary,
        tags: [...new Set(tags.map((tag) => normalizeCapabilityName(tag)).filter(Boolean))],
        manifestBlobHash: record.manifestBlobHash,
        ...(record.parentModuleId ? { parentModuleId: record.parentModuleId } : {}),
        catalogExposure: record.catalogExposure,
        status: record.status,
        updatedAt: record.updatedAt,
    }
}

async function registerResourceReferences(
    record: CapabilityCatalogRecord,
    manifest: CapabilityManifest,
): Promise<Array<{ blobHash: string; referenceKey: string }>> {
    const created: Array<{ blobHash: string; referenceKey: string }> = []
    try {
        for (const resource of manifest.resources) {
            const referenceKey = `capability#${record.capabilityId}#resource#${resource.resourceId}`
            const result = await BlobModel.addReference({
                organizationId: record.storageOwnerId,
                blobHash: resource.blobHash,
                referenceKey,
                ownerType: 'capability',
                ownerId: record.capabilityId,
            })
            if (result.created) created.push({ blobHash: resource.blobHash, referenceKey })
        }
    } catch (error) {
        await rollbackResourceReferences(record, created)
        throw error
    }
    return created
}

async function rollbackResourceReferences(
    record: CapabilityCatalogRecord,
    references: Array<{ blobHash: string; referenceKey: string }>,
): Promise<void> {
    await Promise.all(references.map(async (reference) => {
        await BlobModel.removeReference({
            organizationId: record.storageOwnerId,
            blobHash: reference.blobHash,
            referenceKey: reference.referenceKey,
        })
    }))
}

type CapabilityBlobRetirementResult = {
    scannedReferences: number
    eligibleReferences: number
    protectedReferences: number
    retiredReferences: number
    unsafeCapabilityIds: string[]
    scanTruncated: boolean
}

export async function retireSupersededCapabilityBlobReferences({
    now = Date.now(),
    limit = 100,
    scanLimit = 1000,
}: {
    now?: number
    limit?: number
    scanLimit?: number
} = {}): Promise<CapabilityBlobRetirementResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('INVALID_CAPABILITY_BLOB_RETIREMENT_LIMIT')
    }
    if (!Number.isSafeInteger(scanLimit) || scanLimit < 1 || scanLimit > 1000) {
        throw new Error('INVALID_CAPABILITY_BLOB_RETIREMENT_SCAN_LIMIT')
    }
    const [referenceResult, capabilityResult, runResult] = await Promise.all([
        dynamoDBService.scanItems({
            tableName: blobReferencesTableName(),
            limit: scanLimit,
            fetchAllItems: false,
            consistentRead: true,
            origin: 'Capability.retireSupersededBlobReferences.references',
        }),
        dynamoDBService.scanItems({
            tableName: capabilitiesTableName(),
            limit: scanLimit,
            fetchAllItems: false,
            consistentRead: true,
            origin: 'Capability.retireSupersededBlobReferences.capabilities',
        }),
        dynamoDBService.scanItems({
            tableName: capabilityRunsTableName(),
            limit: scanLimit,
            fetchAllItems: false,
            consistentRead: true,
            origin: 'Capability.retireSupersededBlobReferences.runs',
        }),
    ])
    const scanTruncated = Boolean(
        referenceResult?.lastEvaluatedKey
            || capabilityResult?.lastEvaluatedKey
            || runResult?.lastEvaluatedKey,
    )
    const references = ((referenceResult?.items ?? []) as BlobReference[])
        .filter(reference => reference.ownerType === 'capability')
    if (scanTruncated) {
        return {
            scannedReferences: references.length,
            eligibleReferences: 0,
            protectedReferences: references.length,
            retiredReferences: 0,
            unsafeCapabilityIds: ['SCAN_TRUNCATED'],
            scanTruncated: true,
        }
    }
    const records = (capabilityResult?.items ?? []) as CapabilityCatalogRecord[]
    const recordsById = new Map(records.map(record => [record.capabilityId, record]))
    const protectedReferenceIds = new Set<string>()
    const unsafeCapabilityIds = new Set<string>()
    const protectedManifestHashes = new Map<string, Set<string>>()

    for (const record of records) {
        if (record.status === 'active') addProtectedManifestHash(protectedManifestHashes, record.capabilityId, record.manifestBlobHash)
    }
    for (const run of (runResult?.items ?? []) as CapabilityRun[]) {
        if (run.status !== 'pending' && run.status !== 'running') continue
        for (const resolved of run.resolvedManifests) {
            addProtectedManifestHash(protectedManifestHashes, resolved.capabilityId, resolved.manifestBlobHash)
        }
    }

    await Promise.all([...protectedManifestHashes].flatMap(([capabilityId, hashes]) =>
        [...hashes].map(async manifestBlobHash => {
            const record = recordsById.get(capabilityId)
            if (!record) {
                unsafeCapabilityIds.add(capabilityId)
                return
            }
            try {
                const manifest = await readCapabilityManifestBlob(record.storageOwnerId, manifestBlobHash, capabilityId)
                protectedReferenceIds.add(buildProtectedReferenceId(
                    capabilityId,
                    manifestBlobHash,
                    `capability#${capabilityId}#manifest`,
                ))
                for (const resource of manifest.resources) {
                    protectedReferenceIds.add(buildProtectedReferenceId(
                        capabilityId,
                        resource.blobHash,
                        `capability#${capabilityId}#resource#${resource.resourceId}`,
                    ))
                }
            } catch {
                unsafeCapabilityIds.add(capabilityId)
            }
        })
    ))

    const cutoff = now - CAPABILITY_BLOB_RETIREMENT_GRACE_MS
    const eligible = references.filter(reference => reference.createdAt <= cutoff)
    let protectedReferences = 0
    const retirementCandidates = eligible.filter(reference => {
        if (unsafeCapabilityIds.has(reference.ownerId)) {
            protectedReferences += 1
            return false
        }
        const isProtected = protectedReferenceIds.has(buildProtectedReferenceId(
            reference.ownerId,
            reference.blobHash,
            reference.referenceKey,
        ))
        if (isProtected) protectedReferences += 1
        return !isProtected
    }).slice(0, limit)
    let retiredReferences = 0
    for (const reference of retirementCandidates) {
        const result = await BlobModel.removeReference({
            organizationId: reference.organizationId,
            blobHash: reference.blobHash,
            referenceKey: reference.referenceKey,
        })
        if (result.removed) retiredReferences += 1
    }
    return {
        scannedReferences: references.length,
        eligibleReferences: eligible.length,
        protectedReferences,
        retiredReferences,
        unsafeCapabilityIds: [...unsafeCapabilityIds].sort(),
        scanTruncated: false,
    }
}

function addProtectedManifestHash(
    protectedHashes: Map<string, Set<string>>,
    capabilityId: string,
    manifestBlobHash: string,
): void {
    const hashes = protectedHashes.get(capabilityId) ?? new Set<string>()
    hashes.add(manifestBlobHash)
    protectedHashes.set(capabilityId, hashes)
}

function buildProtectedReferenceId(capabilityId: string, blobHash: string, referenceKey: string): string {
    return `${capabilityId}\u0000${blobHash}\u0000${referenceKey}`
}

async function readCapabilityManifestBlob(
    storageOwnerId: string,
    manifestBlobHash: string,
    capabilityId: string,
): Promise<CapabilityManifest> {
    const bytes = await getContentAddressedBlob({ organizationId: storageOwnerId, blobHash: manifestBlobHash })
    const parsed = JSON.parse(textDecoder.decode(bytes)) as unknown
    const validation = validateCapabilityManifest(parsed)
    if (!validation.valid || validation.manifest.capabilityId !== capabilityId) throw new Error('INVALID_CAPABILITY_MANIFEST')
    return validation.manifest
}

export async function saveCapability(input: SaveCapabilityInput): Promise<CapabilityCatalogRecord> {
    const validation = validateCapabilityManifest(input.manifest, { allowedActions: input.allowedActions })
    if (!validation.valid) throw new Error(`INVALID_CAPABILITY_MANIFEST:${validation.issues[0]?.code ?? 'UNKNOWN'}`)
    if (input.scope === 'user' && input.scopeOwnerId !== input.requester.userId) throw new Error('PERMISSION_DENIED')
    if (input.scope === 'organization' && !input.requester.organizationIds.includes(input.scopeOwnerId)) throw new Error('PERMISSION_DENIED')
    if (input.scope === 'global' && !input.requester.canManageGlobalCapabilities) throw new Error('PERMISSION_DENIED')
    if (input.scope === 'global' && input.storageOwnerId !== 'system') throw new Error('INVALID_STORAGE_OWNER')
    if (input.scope === 'organization' && input.storageOwnerId !== input.scopeOwnerId) throw new Error('INVALID_STORAGE_OWNER')
    if (input.scope === 'user' && !input.requester.organizationIds.includes(input.storageOwnerId)) {
        throw new Error('INVALID_STORAGE_OWNER')
    }
    if (input.catalogExposure === 'module-internal' && !input.parentModuleId) {
        throw new Error('CAPABILITY_PARENT_MODULE_REQUIRED')
    }
    if (input.catalogExposure === 'standalone' && input.parentModuleId) {
        throw new Error('STANDALONE_CAPABILITY_PARENT_FORBIDDEN')
    }

    const existing = await dynamoDBService.getItem({
        tableName: capabilitiesTableName(),
        key: { capabilityId: input.manifest.capabilityId },
        consistentRead: true,
        origin: 'Capability.save.getCurrent',
    }) as CapabilityCatalogRecord | undefined
    const hasStructuralExposure = existing?.catalogExposure === 'standalone'
        || existing?.catalogExposure === 'module-internal'
    if (existing) {
        const authorized = await authorizeCapability({
            capabilityId: existing.capabilityId,
            requester: input.requester,
            access: 'edit',
        })
        if ('error' in authorized) throw new Error(authorized.error)
        if (
            existing.kind !== input.manifest.kind
            || existing.scope !== input.scope
            || existing.scopeOwnerId !== input.scopeOwnerId
            || existing.storageOwnerId !== input.storageOwnerId
            || (hasStructuralExposure && existing.catalogExposure !== input.catalogExposure)
            || (hasStructuralExposure && existing.parentModuleId !== input.parentModuleId)
        ) {
            throw new Error('IMMUTABLE_CAPABILITY_AUTHORITY_CHANGED')
        }
        if (!input.expectedManifestBlobHash) throw new Error('EXPECTED_MANIFEST_BLOB_HASH_REQUIRED')
    }

    let previousDefinition: Awaited<ReturnType<typeof readAuthorizedCapabilityManifest>> | undefined
    if (existing) {
        try {
            previousDefinition = await readAuthorizedCapabilityManifest({
                capabilityId: existing.capabilityId,
                requester: input.requester,
                expectedManifestBlobHash: existing.manifestBlobHash,
            })
        } catch (error) {
            if (!canReplaceInvalidBuiltInManifest({ input, existing, error })) throw error
        }
    }
    const existingGrantResult = existing
        ? await dynamoDBService.queryItems({
            tableName: capabilitiesAccessListTableName(),
            keyConditions: { capabilityId: existing.capabilityId },
            fetchAllItems: true,
            limit: 100,
            consistentRead: true,
            origin: 'Capability.save.getGrants',
        })
        : undefined
    const existingGrants = (existingGrantResult?.items ?? []) as CapabilityAccessGrant[]
    if ((input.grants?.length ?? 0) > 32) throw new Error('CAPABILITY_GRANT_LIMIT_EXCEEDED')
    const storedManifest = await BlobModel.store({
        organizationId: input.storageOwnerId,
        bytes: serializeCapabilityManifest(input.manifest),
        mimeType: 'application/json',
        description: `Capability manifest ${input.manifest.capabilityId}`,
    })
    const now = Date.now()
    const record: CapabilityCatalogRecord = {
        capabilityId: input.manifest.capabilityId,
        kind: input.manifest.kind,
        scope: input.scope,
        scopeOwnerId: input.scopeOwnerId,
        storageOwnerId: input.storageOwnerId,
        manifestBlobHash: storedManifest.blobHash,
        ...(input.parentModuleId ? { parentModuleId: input.parentModuleId } : {}),
        catalogExposure: input.catalogExposure,
        status: existing?.status ?? 'active',
        ownerUserId: existing?.ownerUserId ?? input.requester.userId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    }
    const registeredResourceReferences = await registerResourceReferences(record, input.manifest)
    const manifestReference: BlobReference = {
        blobKey: storedManifest.blobKey,
        blobHash: storedManifest.blobHash,
        organizationId: storedManifest.organizationId,
        referenceKey: `capability#${record.capabilityId}#manifest`,
        ownerType: 'capability',
        ownerId: record.capabilityId,
        createdAt: now,
    }
    const additions = [{ blob: storedManifest, reference: manifestReference }]
    const referenceOperations = existing?.manifestBlobHash === storedManifest.blobHash
        ? { operations: [], deletionBlobHashes: [] }
        : buildBlobReferenceBatchOperations({ additions, now })
    const meta = buildMeta(record, input.manifest, input.summary, input.tags)
    const primaryMetaOperation: TransactOperation = {
        type: 'put',
        tableName: capabilitiesMetaTableName(),
        item: meta,
    }
    const recordOperation: TransactOperation = existing
        ? {
            type: 'update',
            tableName: capabilitiesTableName(),
            key: { capabilityId: record.capabilityId },
            updates: {
                manifestBlobHash: record.manifestBlobHash,
                catalogExposure: record.catalogExposure,
                ...(record.parentModuleId ? { parentModuleId: record.parentModuleId } : {}),
                updatedAt: now,
            },
            conditionExpression: '#manifestBlobHash = :expectedManifestBlobHash',
            expressionAttributeNames: { '#manifestBlobHash': 'manifestBlobHash' },
            expressionAttributeValues: { ':expectedManifestBlobHash': input.expectedManifestBlobHash },
        }
        : {
            type: 'put',
            tableName: capabilitiesTableName(),
            item: record,
            conditionExpression: 'attribute_not_exists(#capabilityId)',
            expressionAttributeNames: { '#capabilityId': 'capabilityId' },
        }
    const desiredGrants = input.grants ?? existingGrants.map((grant) => ({
        principalId: grant.principalId,
        accessLevel: grant.accessLevel,
    }))
    const desiredPrincipalIds = new Set(desiredGrants.map((grant) => grant.principalId))
    const oldSearchKey = previousDefinition
        ? buildCapabilitySearchKey(
            previousDefinition.record.kind,
            normalizeCapabilityName(previousDefinition.manifest.name),
            previousDefinition.record.capabilityId,
        )
        : undefined
    const projectionCleanupOperations: TransactOperation[] = []
    if (oldSearchKey && oldSearchKey !== meta.searchKey) {
        projectionCleanupOperations.push({
            type: 'delete',
            tableName: capabilitiesMetaTableName(),
            key: {
                scopeAndOwner: buildCapabilityScopeAndOwner(record.scope, record.scopeOwnerId),
                searchKey: oldSearchKey,
            },
        })
        for (const grant of existingGrants) {
            projectionCleanupOperations.push({
                type: 'delete',
                tableName: capabilitiesMetaTableName(),
                key: { scopeAndOwner: `principal#${grant.principalId}`, searchKey: oldSearchKey },
            })
        }
    }
    const removedGrantOperations: TransactOperation[] = existingGrants
        .filter((grant) => !desiredPrincipalIds.has(grant.principalId))
        .flatMap((grant) => [
            {
                type: 'delete' as const,
                tableName: capabilitiesAccessListTableName(),
                key: { capabilityId: record.capabilityId, principalId: grant.principalId },
            },
            {
                type: 'delete' as const,
                tableName: capabilitiesMetaTableName(),
                key: { scopeAndOwner: `principal#${grant.principalId}`, searchKey: meta.searchKey },
            },
        ])
    const grantOperations: TransactOperation[] = desiredGrants.flatMap((grant) => {
        const previousGrant = existingGrants.find((candidate) => candidate.principalId === grant.principalId)
        const access: CapabilityAccessGrant = {
            capabilityId: record.capabilityId,
            principalId: grant.principalId,
            accessLevel: grant.accessLevel,
            createdAt: previousGrant?.createdAt ?? now,
            updatedAt: now,
        }
        return [
            { type: 'put', tableName: capabilitiesAccessListTableName(), item: access },
            {
                type: 'put',
                tableName: capabilitiesMetaTableName(),
                item: { ...meta, scopeAndOwner: `principal#${grant.principalId}` },
            },
        ]
    })
    const operations = [
        recordOperation,
        primaryMetaOperation,
        ...projectionCleanupOperations,
        ...removedGrantOperations,
        ...grantOperations,
        ...referenceOperations.operations,
    ]
    try {
        if (operations.length > 100) throw new Error('CAPABILITY_TRANSACTION_LIMIT_EXCEEDED')
        await dynamoDBService.transactWrite({
            operations,
            logConditionalCheckFailures: false,
            origin: 'Capability.save',
        })
    } catch (error) {
        await rollbackResourceReferences(record, registeredResourceReferences)
        if (isTransactionConditionalCheckFailure(error)) throw new Error('CAPABILITY_CONCURRENT_UPDATE')
        throw error
    }
    return record
}

export async function storeCapabilityResource({
    storageOwnerId,
    resourceId,
    bytes,
    mediaType,
    role,
    name,
}: {
    storageOwnerId: string
    resourceId: string
    bytes: Uint8Array
    mediaType: CapabilityResourceMediaType
    role: CapabilityResourceRole
    name?: string
}): Promise<CapabilityResourceRef> {
    const blob = await BlobModel.store({
        organizationId: storageOwnerId,
        bytes,
        mimeType: mediaType,
        description: `Capability resource ${resourceId}`,
    })
    return {
        resourceId,
        blobHash: blob.blobHash,
        mediaType,
        role,
        ...(name ? { name } : {}),
    }
}

export async function seedBuiltInCapability({
    manifest,
    summary,
    tags,
    storageOwnerId = 'system',
    allowedActions,
    parentModuleId,
    catalogExposure,
}: {
    manifest: CapabilityManifest
    summary: string
    tags: string[]
    storageOwnerId?: string
    allowedActions: ReadonlySet<string>
    parentModuleId?: string
    catalogExposure: CapabilityPackageExposure
}): Promise<CapabilityCatalogRecord> {
    const requester: CapabilityRequesterContext = {
        userId: 'system',
        organizationIds: [],
        canManageGlobalCapabilities: true,
    }
    const current = await authorizeCapability({ capabilityId: manifest.capabilityId, requester })
    return await saveCapability({
        manifest,
        scope: 'global',
        scopeOwnerId: 'system',
        storageOwnerId,
        summary,
        tags,
        parentModuleId,
        catalogExposure,
        requester,
        allowedActions,
        allowInvalidPreviousBuiltInManifest: true,
        ...(!('error' in current) ? { expectedManifestBlobHash: current.manifestBlobHash } : {}),
    })
}

function canReplaceInvalidBuiltInManifest({
    input,
    existing,
    error,
}: {
    input: SaveCapabilityInput
    existing: CapabilityCatalogRecord
    error: unknown
}): boolean {
    const message = error instanceof Error ? error.message : ''
    return input.allowInvalidPreviousBuiltInManifest === true
        && (message === 'INVALID_CAPABILITY_MANIFEST' || message === 'INVALID_CAPABILITY_MANIFEST_JSON')
        && input.requester.userId === 'system'
        && input.requester.canManageGlobalCapabilities === true
        && input.scope === 'global'
        && input.scopeOwnerId === 'system'
        && input.storageOwnerId === 'system'
        && existing.scope === 'global'
        && existing.scopeOwnerId === 'system'
        && existing.storageOwnerId === 'system'
}

async function getAuthoritativeCapabilityMeta(
    record: CapabilityCatalogRecord,
    manifest: CapabilityManifest,
): Promise<CapabilityMeta> {
    const scopeAndOwner = buildCapabilityScopeAndOwner(record.scope, record.scopeOwnerId)
    const searchKey = buildCapabilitySearchKey(record.kind, normalizeCapabilityName(manifest.name), record.capabilityId)
    const meta = await dynamoDBService.getItem({
        tableName: capabilitiesMetaTableName(),
        key: { scopeAndOwner, searchKey },
        consistentRead: true,
        origin: 'Capability.getAuthoritativeMeta',
    }) as CapabilityMeta | undefined
    if (!meta) throw new Error('CAPABILITY_META_NOT_FOUND')
    return meta
}

export async function grantCapabilityAccess({
    capabilityId,
    principalId,
    accessLevel,
    requester,
}: {
    capabilityId: string
    principalId: string
    accessLevel: CapabilityAccessLevel
    requester: CapabilityRequesterContext
}): Promise<CapabilityAccessGrant> {
    if (!principalId) throw new Error('INVALID_PRINCIPAL_ID')
    if (!['viewer', 'editor', 'owner'].includes(accessLevel)) throw new Error('INVALID_ACCESS_LEVEL')
    const definition = await readAuthorizedCapabilityManifest({ capabilityId, requester })
    const editable = await authorizeCapability({ capabilityId, requester, access: 'edit' })
    if ('error' in editable) throw new Error(editable.error)
    const meta = await getAuthoritativeCapabilityMeta(definition.record, definition.manifest)
    const current = await getAccess(capabilityId, principalId)
    const now = Date.now()
    const grant: CapabilityAccessGrant = {
        capabilityId,
        principalId,
        accessLevel,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
    }
    await dynamoDBService.transactWrite({
        operations: [
            { type: 'put', tableName: capabilitiesAccessListTableName(), item: grant },
            {
                type: 'put',
                tableName: capabilitiesMetaTableName(),
                item: { ...meta, scopeAndOwner: `principal#${principalId}` },
            },
        ],
        origin: 'Capability.grantAccess',
    })
    return grant
}

export async function revokeCapabilityAccess({
    capabilityId,
    principalId,
    requester,
}: {
    capabilityId: string
    principalId: string
    requester: CapabilityRequesterContext
}): Promise<void> {
    if (!principalId) throw new Error('INVALID_PRINCIPAL_ID')
    const definition = await readAuthorizedCapabilityManifest({ capabilityId, requester })
    const editable = await authorizeCapability({ capabilityId, requester, access: 'edit' })
    if ('error' in editable) throw new Error(editable.error)
    const meta = await getAuthoritativeCapabilityMeta(definition.record, definition.manifest)
    await dynamoDBService.transactWrite({
        operations: [
            {
                type: 'delete',
                tableName: capabilitiesAccessListTableName(),
                key: { capabilityId, principalId },
            },
            {
                type: 'delete',
                tableName: capabilitiesMetaTableName(),
                key: { scopeAndOwner: `principal#${principalId}`, searchKey: meta.searchKey },
            },
        ],
        origin: 'Capability.revokeAccess',
    })
}

export async function listCapabilityAccessGrants({
    capabilityId,
    requester,
}: {
    capabilityId: string
    requester: CapabilityRequesterContext
}): Promise<CapabilityAccessGrant[]> {
    const editable = await authorizeCapability({ capabilityId, requester, access: 'edit' })
    if ('error' in editable) throw new Error(editable.error)
    const result = await dynamoDBService.queryItems({
        tableName: capabilitiesAccessListTableName(),
        keyConditions: { capabilityId },
        fetchAllItems: true,
        consistentRead: true,
        limit: 100,
        origin: 'Capability.listAccessGrants',
    })
    return ((result?.items ?? []) as CapabilityAccessGrant[])
        .sort((left, right) => left.principalId.localeCompare(right.principalId))
}

export async function setCapabilityStatus({
    capabilityId,
    expectedManifestBlobHash,
    status,
    requester,
}: {
    capabilityId: string
    expectedManifestBlobHash: string
    status: Extract<CapabilityStatus, 'active' | 'disabled'>
    requester: CapabilityRequesterContext
}): Promise<{ record: CapabilityCatalogRecord; audienceUserIds: string[] }> {
    if (status !== 'active' && status !== 'disabled') throw new Error('INVALID_CAPABILITY_STATUS')
    const definition = await readAuthorizedCapabilityManifest({ capabilityId, requester })
    const editable = await authorizeCapability({ capabilityId, requester, access: 'edit' })
    if ('error' in editable) throw new Error(editable.error)
    if (definition.record.manifestBlobHash !== expectedManifestBlobHash) throw new Error('CAPABILITY_CONCURRENT_UPDATE')
    const currentMeta = await getAuthoritativeCapabilityMeta(definition.record, definition.manifest)
    const grants = await listCapabilityAccessGrants({ capabilityId, requester })
    const now = Date.now()
    const record: CapabilityCatalogRecord = { ...definition.record, status, updatedAt: now }
    const meta: CapabilityMeta = { ...currentMeta, status, updatedAt: now }
    const operations: TransactOperation[] = [
        {
            type: 'update',
            tableName: capabilitiesTableName(),
            key: { capabilityId },
            updates: { status, updatedAt: now },
            conditionExpression: '#manifestBlobHash = :expectedManifestBlobHash AND #status <> :removed',
            expressionAttributeNames: { '#manifestBlobHash': 'manifestBlobHash', '#status': 'status' },
            expressionAttributeValues: { ':expectedManifestBlobHash': expectedManifestBlobHash, ':removed': 'removed' },
        },
        { type: 'put', tableName: capabilitiesMetaTableName(), item: meta },
        ...grants.map((grant): TransactOperation => ({
            type: 'put',
            tableName: capabilitiesMetaTableName(),
            item: { ...meta, scopeAndOwner: `principal#${grant.principalId}` },
        })),
    ]
    if (operations.length > 100) throw new Error('CAPABILITY_TRANSACTION_LIMIT_EXCEEDED')
    try {
        await dynamoDBService.transactWrite({
            operations,
            logConditionalCheckFailures: false,
            origin: 'Capability.setStatus',
        })
    } catch (error) {
        if (isTransactionConditionalCheckFailure(error)) throw new Error('CAPABILITY_CONCURRENT_UPDATE')
        throw error
    }
    return { record, audienceUserIds: grants.map(grant => grant.principalId) }
}

export async function removeCapability({
    capabilityId,
    expectedManifestBlobHash,
    requester,
}: {
    capabilityId: string
    expectedManifestBlobHash: string
    requester: CapabilityRequesterContext
}): Promise<{ record: CapabilityCatalogRecord; audienceUserIds: string[] }> {
    const definition = await readAuthorizedCapabilityManifest({ capabilityId, requester })
    const editable = await authorizeCapability({ capabilityId, requester, access: 'edit' })
    if ('error' in editable) throw new Error(editable.error)
    if (definition.record.manifestBlobHash !== expectedManifestBlobHash) throw new Error('CAPABILITY_CONCURRENT_UPDATE')
    const meta = await getAuthoritativeCapabilityMeta(definition.record, definition.manifest)
    const grantsResult = await dynamoDBService.queryItems({
        tableName: capabilitiesAccessListTableName(),
        keyConditions: { capabilityId },
        fetchAllItems: true,
        consistentRead: true,
        limit: 100,
        origin: 'Capability.remove.getGrants',
    })
    const grants = (grantsResult?.items ?? []) as CapabilityAccessGrant[]
    const now = Date.now()
    const removed = { ...definition.record, status: 'removed' as const, updatedAt: now }
    const operations: TransactOperation[] = [
        {
            type: 'update',
            tableName: capabilitiesTableName(),
            key: { capabilityId },
            updates: { status: 'removed', updatedAt: now },
            conditionExpression: '#manifestBlobHash = :expectedManifestBlobHash AND #status <> :removed',
            expressionAttributeNames: { '#manifestBlobHash': 'manifestBlobHash', '#status': 'status' },
            expressionAttributeValues: { ':expectedManifestBlobHash': expectedManifestBlobHash, ':removed': 'removed' },
        },
        {
            type: 'delete',
            tableName: capabilitiesMetaTableName(),
            key: { scopeAndOwner: meta.scopeAndOwner, searchKey: meta.searchKey },
        },
        ...grants.flatMap((grant): TransactOperation[] => [
            {
                type: 'delete',
                tableName: capabilitiesAccessListTableName(),
                key: { capabilityId, principalId: grant.principalId },
            },
            {
                type: 'delete',
                tableName: capabilitiesMetaTableName(),
                key: { scopeAndOwner: `principal#${grant.principalId}`, searchKey: meta.searchKey },
            },
        ]),
    ]
    if (operations.length > 100) throw new Error('CAPABILITY_TRANSACTION_LIMIT_EXCEEDED')
    await dynamoDBService.transactWrite({ operations, origin: 'Capability.remove' })
    return { record: removed, audienceUserIds: grants.map((grant) => grant.principalId) }
}

export async function getCapabilityAudienceUserIds(capabilityId: string): Promise<string[]> {
    const result = await dynamoDBService.queryItems({
        tableName: capabilitiesAccessListTableName(),
        keyConditions: { capabilityId },
        fetchAllItems: true,
        consistentRead: true,
        limit: 100,
        origin: 'Capability.getAudience',
    })
    return ((result?.items ?? []) as CapabilityAccessGrant[]).map((grant) => grant.principalId)
}

const CapabilityModel = {
    authorize: authorizeCapability,
    getAuthorizedRecords: getAuthorizedCapabilityRecords,
    listAuthorized: listAuthorizedStandaloneCapabilities,
    readManifest: readAuthorizedCapabilityManifest,
    readManifestSnapshot: readAuthorizedCapabilityManifestSnapshot,
    readResource: readAuthorizedCapabilityResource,
    readResourceSnapshot: readAuthorizedCapabilityResourceSnapshot,
    save: saveCapability,
    storeResource: storeCapabilityResource,
    seedBuiltIn: seedBuiltInCapability,
    grantAccess: grantCapabilityAccess,
    revokeAccess: revokeCapabilityAccess,
    listAccessGrants: listCapabilityAccessGrants,
    setStatus: setCapabilityStatus,
    remove: removeCapability,
    retireSupersededBlobReferences: retireSupersededCapabilityBlobReferences,
    getAudienceUserIds: getCapabilityAudienceUserIds,
}

export default CapabilityModel
