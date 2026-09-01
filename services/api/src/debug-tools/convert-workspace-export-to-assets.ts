import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
    access,
    readFile,
    writeFile,
} from 'node:fs/promises'

import AdmZip from 'adm-zip'
import { v4 as uuid } from 'uuid'
import {
    DOCUMENT_TYPE,
    HeadlessProseMirrorEngine,
} from '@lixpi/prosemirror'

import {
    ASSET_REQUIRED_RENDITIONS,
    type Asset,
    type AssetMediaKind,
    type AssetReference,
    type AssetRenditionName,
    type BlobRecord,
    type ContentDescriptor,
} from '@lixpi/constants'

import { collectEmbeddedAssetIds } from '../services/prosemirror-asset-references.ts'

type LegacyFile = {
    id: string
    name?: string
    mimeType?: string
    kind?: AssetMediaKind
    modelSafe?: boolean
    uploadedAt?: number
    canonicalFileId?: string
    canonicalMimeType?: string
    previewFileId?: string
    thumbnailFileId?: string
    posterFileId?: string
    frameFileId?: string
}

type Revision2BlobManifestEntry = Pick<
    BlobRecord,
    'blobHash' | 'mimeType' | 'byteSize' | 'sourceBlobHash' | 'derivationKind' | 'derivationVersion'
>

const getArg = (name: string): string | undefined => {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const parseDocument = (content: unknown): Record<string, unknown> => {
    const parsed = typeof content === 'string' ? JSON.parse(content) : structuredClone(content)
    if (!parsed || typeof parsed !== 'object') throw new Error('Legacy document content is not JSON')
    return parsed as Record<string, unknown>
}

const titleFreeDocument = (content: unknown): Record<string, unknown> => {
    const doc = parseDocument(content)
    if (Array.isArray(doc.content) && (doc.content[0] as any)?.type === 'documentTitle') doc.content.shift()
    return doc
}

const inputPath = getArg('--input')
const outputPath = getArg('--output')
if (!inputPath || !outputPath) throw new Error('Usage: --input <old.zip> --output <rev2.zip>')
try {
    await access(outputPath, fsConstants.F_OK)
    throw new Error(`Refusing to overwrite existing output: ${outputPath}`)
} catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
}

const oldZip = new AdmZip(await readFile(inputPath))
const manifestEntry = oldZip.getEntry('manifest.json')
if (!manifestEntry) throw new Error('Input archive is missing manifest.json')
const oldManifest = JSON.parse(manifestEntry.getData().toString('utf8')) as any
if (oldManifest.exportVersion !== 1) throw new Error(`Expected export version 1, got ${oldManifest.exportVersion}`)
if (!oldManifest.workspace?.canvasState || !Array.isArray(oldManifest.workspace.files)) {
    throw new Error('Invalid version-1 workspace manifest')
}

const migrationOrganizationId = 'migration-organization'
const migrationUserId = 'migration-user'
const migrationWorkspaceId = oldManifest.workspace.workspaceId ?? 'migration-workspace'
const now = Date.now()
const assets: Asset[] = []
const references: AssetReference[] = []
const blobBytes = new Map<string, Buffer>()
const blobMeta = new Map<string, Revision2BlobManifestEntry>()
const legacyIdToAssetId = new Map<string, string>()
const legacyNodeIdToAssetId = new Map<string, string>()
const files = new Map<string, LegacyFile>(
    (oldManifest.workspace.files as LegacyFile[]).map((file) => [file.id, file]),
)
const canvasNodes = oldManifest.workspace.canvasState.nodes ?? []
const renditionLinkFields = ['posterFileId', 'frameFileId', 'canonicalFileId', 'previewFileId', 'thumbnailFileId'] as const

for (const document of oldManifest.documents ?? []) legacyIdToAssetId.set(document.documentId, uuid())
for (const thread of oldManifest.aiChatThreads ?? []) legacyIdToAssetId.set(thread.threadId, uuid())

const rootFileIds = new Set<string>()
const relatedFileIdsByRoot = new Map<string, Set<string>>()
const rootByRelatedFileId = new Map<string, string>()
for (const file of files.values()) {
    for (const field of renditionLinkFields) {
        if (file[field]) rootByRelatedFileId.set(file[field]!, file.id)
    }
}
for (const fileId of files.keys()) {
    if (rootByRelatedFileId.has(fileId)) continue
    rootFileIds.add(fileId)
    const file = files.get(fileId)
    relatedFileIdsByRoot.set(
        fileId,
        new Set([
            fileId,
            ...renditionLinkFields.flatMap((field) => file?.[field] ?? []),
        ]),
    )
}
for (const node of canvasNodes) {
    const nodeFileId = typeof node.fileId === 'string' ? node.fileId : undefined
    if (!nodeFileId) continue
    const rootFileId = rootByRelatedFileId.get(nodeFileId) ?? nodeFileId
    rootFileIds.add(rootFileId)
    const related = relatedFileIdsByRoot.get(rootFileId) ?? new Set<string>()
    related.add(rootFileId)
    related.add(nodeFileId)
    for (const field of renditionLinkFields) {
        if (typeof node[field] === 'string' && node[field]) related.add(node[field])
    }
    const file = files.get(rootFileId)
    for (const field of renditionLinkFields) {
        if (file?.[field]) related.add(file[field]!)
    }
    relatedFileIdsByRoot.set(rootFileId, related)
}
for (const fileId of files.keys()) {
    const belongsToExistingRoot = [...relatedFileIdsByRoot.values()].some((related) => related.has(fileId))
    if (!belongsToExistingRoot) {
        rootFileIds.add(fileId)
        relatedFileIdsByRoot.set(fileId, new Set([fileId]))
    }
}
for (const rootFileId of rootFileIds) {
    const assetId = uuid()
    legacyIdToAssetId.set(rootFileId, assetId)
    for (const relatedFileId of relatedFileIdsByRoot.get(rootFileId) ?? []) {
        legacyIdToAssetId.set(relatedFileId, assetId)
    }
}
for (const node of canvasNodes) {
    const legacyId = node.fileId ?? node.referenceId
    const assetId = typeof legacyId === 'string' ? legacyIdToAssetId.get(legacyId) : undefined
    if (assetId) legacyNodeIdToAssetId.set(node.nodeId, assetId)
}

const registerBlob = (bytes: Buffer, mimeType: string): string => {
    const blobHash = sha256(bytes)
    blobBytes.set(blobHash, bytes)
    blobMeta.set(blobHash, {
        blobHash,
        mimeType,
        byteSize: bytes.byteLength,
    })
    return blobHash
}

const addReference = (assetId: string, nodeIds: string[] = [], surfaceIds: string[] = []): void => {
    const existing = references.find((reference) => reference.assetId === assetId)
    if (existing) {
        existing.nodeIds = [...new Set([...(existing.nodeIds ?? []), ...nodeIds])]
        existing.surfaceIds = [...new Set([...(existing.surfaceIds ?? []), ...surfaceIds])]
        existing.updatedAt = now
        return
    }
    references.push({
        assetId,
        referenceKey: `workspace#${migrationWorkspaceId}`,
        type: 'workspace',
        workspaceId: migrationWorkspaceId,
        nodeIds: [...new Set(nodeIds)],
        surfaceIds: [...new Set(surfaceIds)],
        createdAt: now,
        updatedAt: now,
    })
}

const normalizeLegacyDescriptor = (value: unknown): ContentDescriptor | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const candidate = value as Partial<ContentDescriptor>
    if (
        !['analyzing', 'ready', 'failed'].includes(candidate.status ?? '')
        || typeof candidate.summary !== 'string'
        || !Array.isArray(candidate.entityTags)
        || candidate.entityTags.some((tag) => typeof tag !== 'string')
        || !Array.isArray(candidate.styleTags)
        || candidate.styleTags.some((tag) => typeof tag !== 'string')
    ) return undefined
    return {
        status: candidate.status!,
        summary: candidate.summary,
        entityTags: candidate.entityTags,
        styleTags: candidate.styleTags,
        source: 'analysis',
        version: typeof candidate.version === 'string' && candidate.version
            ? candidate.version
            : 'legacy-workspace-export-v1',
        updatedAt: Number.isSafeInteger(candidate.updatedAt) ? candidate.updatedAt! : now,
    }
}

const newestLegacyDescriptor = (nodes: any[]): ContentDescriptor | undefined =>
    nodes
        .map((node) => normalizeLegacyDescriptor(node?.descriptor))
        .filter((descriptor): descriptor is ContentDescriptor => Boolean(descriptor))
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]

const remapLegacyJson = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remapLegacyJson)
    if (!value || typeof value !== 'object') return value
    const source = value as Record<string, unknown>
    const target: Record<string, unknown> = {}
    const legacyStorageId = typeof source.fileId === 'string'
        ? source.fileId
        : typeof source.referenceId === 'string'
        ? source.referenceId
        : undefined
    if (legacyStorageId && legacyIdToAssetId.has(legacyStorageId)) {
        const assetId = legacyIdToAssetId.get(legacyStorageId)!
        target.assetId = assetId
        if (source.type === 'image' && 'src' in source) target.src = `/api/assets/${assetId}/renditions/original`
        if ('imageUrl' in source) target.imageUrl = `/api/assets/${assetId}/renditions/original`
        if ('videoUrl' in source) target.videoUrl = `/api/assets/${assetId}/renditions/original`
        if ('posterUrl' in source) target.posterUrl = `/api/assets/${assetId}/renditions/poster`
        if ('frameUrl' in source) target.frameUrl = `/api/assets/${assetId}/renditions/representativeFrame`
    }
    for (const [key, child] of Object.entries(source)) {
        if (
            [
                'fileId',
                'posterFileId',
                'frameFileId',
                'src',
                'posterSrc',
                'referenceId',
                'workspaceId',
                'descriptor',
                'imageUrl',
                'videoUrl',
                'posterUrl',
                'frameUrl',
            ].includes(key)
        ) continue
        if (['aiChatThreadId', 'conversationAssetId', 'threadId', 'documentId'].includes(key) && typeof child === 'string') {
            const mapped = legacyIdToAssetId.get(child)
            target[key === 'aiChatThreadId' ? 'conversationAssetId' : key] = mapped ?? child
            continue
        }
        if (key === 'refId' && source.type === 'thread' && typeof child === 'string') {
            target.refId = legacyIdToAssetId.get(child) ?? child
            continue
        }
        target[key] = remapLegacyJson(child)
    }
    return target
}

for (const document of oldManifest.documents ?? []) {
    const assetId = legacyIdToAssetId.get(document.documentId)!
    const documentNodes = canvasNodes.filter((node: any) => node.referenceId === document.documentId)
    const descriptor = newestLegacyDescriptor(documentNodes)
    const snapshot = Buffer.from(JSON.stringify(remapLegacyJson(titleFreeDocument(document.content))), 'utf8')
    const blobHash = registerBlob(snapshot, 'application/json')
    assets.push({
        assetId,
        organizationId: migrationOrganizationId,
        title: document.title ?? 'Untitled',
        scope: 'workspace',
        scopeOwnerId: migrationWorkspaceId,
        originWorkspaceId: migrationWorkspaceId,
        ownerUserId: migrationUserId,
        documents: {
            content: {
                role: 'content',
                blobHash,
                version: document.proseMirrorVersion ?? 0,
                schemaVersion: 'prosemirror-schema-v1',
                byteSize: snapshot.byteLength,
                updatedAt: document.updatedAt ?? now,
            },
        },
        ...(descriptor ? { descriptor } : {}),
        states: { lifecycle: 'active', media: 'none', conversation: 'none', provenance: 'none' },
        referenceCount: 2,
        revision: 1,
        importedFromAssetId: document.documentId,
        createdAt: document.createdAt ?? now,
        updatedAt: document.updatedAt ?? now,
    })
    addReference(assetId, documentNodes.map((node: any) => node.nodeId), [
        `document#${assetId}`,
    ])
}

for (const thread of oldManifest.aiChatThreads ?? []) {
    const assetId = legacyIdToAssetId.get(thread.threadId)!
    const snapshot = Buffer.from(JSON.stringify(remapLegacyJson(titleFreeDocument(thread.content))), 'utf8')
    const blobHash = registerBlob(snapshot, 'application/json')
    assets.push({
        assetId,
        organizationId: migrationOrganizationId,
        title: thread.title ?? 'Conversation',
        scope: 'workspace',
        scopeOwnerId: migrationWorkspaceId,
        originWorkspaceId: migrationWorkspaceId,
        ownerUserId: migrationUserId,
        documents: {
            conversation: {
                role: 'conversation',
                blobHash,
                version: thread.proseMirrorVersion ?? 0,
                schemaVersion: 'prosemirror-schema-v1',
                byteSize: snapshot.byteLength,
                updatedAt: thread.updatedAt ?? now,
            },
        },
        states: { lifecycle: 'active', media: 'none', conversation: 'idle', provenance: 'none' },
        referenceCount: 2,
        revision: 1,
        importedFromAssetId: thread.threadId,
        createdAt: thread.createdAt ?? now,
        updatedAt: thread.updatedAt ?? now,
    })
    addReference(assetId, [], [`conversation#${assetId}`])
}

const archivedObjectByFileId = new Map<string, Buffer>()
for (const entry of oldZip.getEntries().filter((candidate) => candidate.entryName.startsWith('images/') && !candidate.isDirectory)) {
    const filename = entry.entryName.slice('images/'.length)
    const matchingId = [...files.keys()]
        .sort((left, right) => right.length - left.length)
        .find((fileId) => filename === fileId || filename.startsWith(`${fileId}.`))
    if (matchingId) archivedObjectByFileId.set(matchingId, entry.getData())
}

const renditionFileId = (root: LegacyFile | undefined, nodes: any[], name: AssetRenditionName): string | undefined => {
    const node = nodes[0]
    if (name === 'original') return root?.id
    if (name === 'canonical') return root?.canonicalFileId ?? node?.canonicalFileId
    if (name === 'preview') return root?.previewFileId ?? node?.previewFileId
    if (name === 'thumbnail') return root?.thumbnailFileId ?? node?.thumbnailFileId
    if (name === 'poster') return root?.posterFileId ?? node?.posterFileId
    if (name === 'representativeFrame') return root?.frameFileId ?? node?.frameFileId
    return undefined
}

for (const rootFileId of rootFileIds) {
    const file = files.get(rootFileId) ?? { id: rootFileId }
    const relatedNodes = canvasNodes.filter((node: any) => {
        if (typeof node.fileId !== 'string') return false
        return (rootByRelatedFileId.get(node.fileId) ?? node.fileId) === rootFileId
    })
    const nodeType = relatedNodes[0]?.type
    const kind: AssetMediaKind = file.kind
        ?? (nodeType === 'video' || nodeType === 'audio' || nodeType === 'mediaDocument' ? (nodeType === 'mediaDocument' ? 'document' : nodeType) : 'image')
    const mimeType = file.mimeType ?? (
        kind === 'video'
            ? 'video/mp4'
            : kind === 'audio'
            ? 'audio/mpeg'
            : kind === 'document'
            ? 'application/pdf'
            : 'image/png'
    )
    const assetId = legacyIdToAssetId.get(rootFileId)!
    const renditionNames: AssetRenditionName[] = ['original', 'canonical', 'preview', 'thumbnail', 'poster', 'representativeFrame']
    const renditions: NonNullable<Asset['media']>['renditions'] = {}
    for (const name of renditionNames) {
        const fileId = renditionFileId(file, relatedNodes, name)
        if (!fileId) continue
        const bytes = archivedObjectByFileId.get(fileId)
        if (!bytes) {
            if (name === 'original') throw new Error(`Version-1 archive is missing required object for ${fileId}`)
            continue
        }
        const renditionFile = files.get(fileId)
        const renditionMimeType = renditionFile?.mimeType
            ?? (name === 'original'
                ? mimeType
                : name === 'canonical'
                ? file.canonicalMimeType ?? mimeType
                : name === 'preview'
                ? (kind === 'video' ? 'video/mp4' : 'image/webp')
                : name === 'thumbnail'
                ? 'image/webp'
                : 'image/png')
        const blobHash = registerBlob(bytes, renditionMimeType)
        renditions[name] = {
            name,
            status: 'ready',
            blobHash,
            mimeType: renditionMimeType,
            byteSize: bytes.byteLength,
            updatedAt: file.uploadedAt ?? now,
        }
    }
    if (renditions.original?.status !== 'ready') throw new Error(`Version-1 archive has no original bytes for ${rootFileId}`)
    const requestedRenditions = [...ASSET_REQUIRED_RENDITIONS[kind]]
    if (file.modelSafe === false && !requestedRenditions.includes('canonical')) requestedRenditions.push('canonical')
    const requiredReady = requestedRenditions.every((name) => renditions[name]?.status === 'ready')
    const parentNodeId = relatedNodes[0]?.generatedBy?.parentMediaNodeId ?? relatedNodes[0]?.generatedBy?.parentImageNodeId
    const sourceNodeIds = [
        ...(relatedNodes[0]?.generatedBy?.referenceImageNodeIds ?? []),
        ...(relatedNodes[0]?.generatedBy?.sourceContextNodeIds ?? []),
    ]
    const generatedBy = relatedNodes[0]?.generatedBy
    const descriptor = newestLegacyDescriptor(relatedNodes)
    const sourceConversationId = generatedBy?.aiChatThreadId ?? generatedBy?.conversationAssetId
    const sourceConversationAssetId = sourceConversationId
        ? legacyIdToAssetId.get(sourceConversationId)
        : undefined
    const parentAssetId = parentNodeId ? legacyNodeIdToAssetId.get(parentNodeId) : undefined
    assets.push({
        assetId,
        organizationId: migrationOrganizationId,
        title: file.name ?? rootFileId,
        scope: 'workspace',
        scopeOwnerId: migrationWorkspaceId,
        originWorkspaceId: migrationWorkspaceId,
        ownerUserId: migrationUserId,
        documents: {},
        media: {
            kind,
            originalName: file.name ?? rootFileId,
            sourceMimeType: mimeType,
            modelSafe: file.modelSafe ?? true,
            renditions,
        },
        ...(descriptor ? { descriptor } : {}),
        ...(generatedBy
            ? {
                lineage: {
                    ...(sourceConversationAssetId ? { sourceConversationAssetId } : {}),
                    ...(parentAssetId ? { parentAssetId } : {}),
                    sourceAssetIds: [...new Set(sourceNodeIds.flatMap((nodeId: string) => legacyNodeIdToAssetId.get(nodeId) ?? []))],
                    ...(generatedBy.generationRequestId ? { generationRequestId: generatedBy.generationRequestId } : {}),
                    ...(generatedBy.reasoningRunId ? { reasoningRunId: generatedBy.reasoningRunId } : {}),
                    ...(generatedBy.mediaRunId ? { mediaRunId: generatedBy.mediaRunId } : {}),
                    ...(generatedBy.reasoningModelId ? { reasoningModelId: generatedBy.reasoningModelId } : {}),
                    ...(generatedBy.mediaModelId ? { mediaModelId: generatedBy.mediaModelId } : {}),
                    ...(generatedBy.promptFingerprint ? { promptFingerprint: generatedBy.promptFingerprint } : {}),
                },
            }
            : {}),
        states: {
            lifecycle: 'active',
            media: requiredReady ? 'ready' : 'degraded',
            conversation: 'none',
            provenance: generatedBy ? 'failed' : 'none',
        },
        referenceCount: relatedNodes.length > 0 ? 2 : 1,
        revision: 1,
        importedFromAssetId: rootFileId,
        createdAt: file.uploadedAt ?? generatedBy?.createdAt ?? now,
        updatedAt: file.uploadedAt ?? now,
    })
    if (relatedNodes.length > 0) addReference(assetId, relatedNodes.map((node: any) => node.nodeId))
}

for (const hostAsset of assets) {
    for (const role of ['content', 'conversation'] as const) {
        const pointer = hostAsset.documents[role]
        if (!pointer) continue
        const bytes = blobBytes.get(pointer.blobHash)
        if (!bytes) throw new Error(`Converter produced missing document bytes ${pointer.blobHash}`)
        for (const embeddedAssetId of collectEmbeddedAssetIds(JSON.parse(bytes.toString('utf8')), role)) {
            if (embeddedAssetId === hostAsset.assetId) throw new Error('Converter produced a self-referential editable document')
            const embeddedAsset = assets.find((asset) => asset.assetId === embeddedAssetId)
            if (!embeddedAsset) throw new Error(`Converter produced dangling embedded Asset ID ${embeddedAssetId}`)
            const surfaceId = role === 'content'
                ? `document#${hostAsset.assetId}#content`
                : `conversation#${hostAsset.assetId}#media#${embeddedAssetId}`
            const hadWorkspaceReference = references.some((reference) => reference.assetId === embeddedAssetId)
            addReference(embeddedAssetId, [], [surfaceId])
            if (!hadWorkspaceReference) embeddedAsset.referenceCount += 1
        }
    }
}

const canvasState = remapLegacyJson(oldManifest.workspace.canvasState) as any
if (oldManifest.workspace.canvasState.lastActiveAiChatThreadId) {
    canvasState.lastActiveConversationAssetId = legacyIdToAssetId.get(oldManifest.workspace.canvasState.lastActiveAiChatThreadId)
    delete canvasState.lastActiveAiChatThreadId
}
delete canvasState.aiChatSidebarTabs
delete canvasState.activeAiChatSidebarTabId
for (const node of canvasState.nodes ?? []) {
    if (['image', 'video', 'audio', 'mediaDocument', 'document'].includes(node.type) && !node.assetId) {
        throw new Error(`Unable to map canvas node ${node.nodeId} to an Asset`)
    }
}

const outputManifest = {
    exportVersion: 2,
    exportedAt: new Date().toISOString(),
    workspace: {
        name: oldManifest.workspace.name ?? 'Imported workspace',
        canvasState,
        createdAt: oldManifest.workspace.createdAt ?? now,
        updatedAt: oldManifest.workspace.updatedAt ?? now,
    },
    assets,
    references,
    blobs: [...blobMeta.values()],
    migration: { sourceExportVersion: 1 },
}

const assetIds = new Set(assets.map((asset) => asset.assetId))
if (assetIds.size !== assets.length) throw new Error('Converter produced duplicate Asset IDs')
for (const asset of assets) {
    for (
        const lineageId of [
            asset.lineage?.sourceConversationAssetId,
            asset.lineage?.parentAssetId,
            ...(asset.lineage?.sourceAssetIds ?? []),
        ]
    ) {
        if (lineageId && !assetIds.has(lineageId)) throw new Error(`Converter produced dangling lineage Asset ID ${lineageId}`)
    }
    for (const [role, pointer] of Object.entries(asset.documents)) {
        if (pointer && !blobMeta.has(pointer.blobHash)) throw new Error(`Converter produced missing document Blob ${pointer.blobHash}`)
        if (pointer) {
            const bytes = blobBytes.get(pointer.blobHash)
            if (!bytes) throw new Error(`Converter produced missing document bytes ${pointer.blobHash}`)
            new HeadlessProseMirrorEngine({
                documentType: role === 'content'
                    ? DOCUMENT_TYPE.ASSET_CONTENT
                    : role === 'conversation'
                    ? DOCUMENT_TYPE.ASSET_CONVERSATION
                    : DOCUMENT_TYPE.ASSET_PROVENANCE,
                doc: JSON.parse(bytes.toString('utf8')),
                version: pointer.version,
            })
        }
    }
    for (const rendition of Object.values(asset.media?.renditions ?? {})) {
        if (rendition?.status === 'ready' && (!rendition.blobHash || !blobMeta.has(rendition.blobHash))) {
            throw new Error(`Converter produced missing rendition Blob for ${asset.assetId}`)
        }
    }
}

const outputZip = new AdmZip()
outputZip.addFile('manifest.json', Buffer.from(JSON.stringify(outputManifest, null, 2)))
for (const [blobHash, bytes] of blobBytes) outputZip.addFile(`blobs/${blobHash}`, bytes)
await writeFile(outputPath, outputZip.toBuffer(), { flag: 'wx' })
