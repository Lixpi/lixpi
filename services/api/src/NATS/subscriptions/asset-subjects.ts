'use strict'

import { v4 as uuid, validate as isUuid } from 'uuid'
import {
    NATS_SUBJECTS,
    type AssetPrimaryCategory,
    type AssetScope,
    type GeneratedOutputReviewRequest,
} from '@lixpi/constants'
import { DOCUMENT_TYPE, HeadlessProseMirrorEngine, PROSEMIRROR_SCHEMA_VERSION } from '@lixpi/prosemirror'

import AssetModel, {
    buildAssetScopeAndOwnerKey,
} from '../../models/asset.ts'
import AssetDocumentService from '../../services/asset-document-service.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import {
    ensureAssetEventRelay,
    rememberAuthorizedAssetEvent,
} from '../../services/asset-event-relay.ts'
import BlobModel from '../../models/blob.ts'
import Workspace from '../../models/workspace.ts'
import GeneratedOutputReviewService from '../../services/generated-output-review-service.ts'

const { ASSET_SUBJECTS } = NATS_SUBJECTS
const generatedOutputReviewService = new GeneratedOutputReviewService()

export const getRequesterContext = async (userId: string) => {
    const requester = await getAssetRequesterContext(userId)
    ensureAssetEventRelay({ requester })
    return requester
}

const authorizeAssetWorkspaceBoundary = async ({
    assetId,
    workspaceId,
    requester,
}: {
    assetId: string
    workspaceId: string
    requester: Awaited<ReturnType<typeof getRequesterContext>>
}) => {
    if (!requester.editableWorkspaceIds.includes(workspaceId)) return { error: 'WORKSPACE_ACCESS_DENIED' as const }
    const [workspace, asset] = await Promise.all([
        Workspace.getWorkspace({ workspaceId, userId: requester.userId }),
        AssetModel.get({ assetId, requester }),
    ])
    if ('error' in workspace) return { error: workspace.error }
    if ('error' in asset) return asset
    if (workspace.deletingAt) return { error: 'WORKSPACE_DELETING' as const }
    if (workspace.organizationId !== asset.organizationId) return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' as const }
    return { workspace, asset }
}

const hasMismatchedConversationIdentity = (node: unknown, assetId: string): boolean => {
    if (!node || typeof node !== 'object') return false
    const record = node as { type?: unknown; attrs?: { threadId?: unknown }; content?: unknown }
    if (record.type === 'aiChatThread' && record.attrs?.threadId !== assetId) return true
    return Array.isArray(record.content)
        && record.content.some((child) => hasMismatchedConversationIdentity(child, assetId))
}

export const assetSubjects = [
    {
        subject: ASSET_SUBJECTS.CREATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.CREATE] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const userId = data.user.userId as string
            const requester = await getRequesterContext(userId)
            if (!['workspace', 'user', 'organization'].includes(data.scope)) return { error: 'INVALID_SCOPE' }
            if (typeof data.title !== 'string' || !data.title.trim()) return { error: 'TITLE_REQUIRED' }
            if (!requester.organizationIds.includes(data.organizationId)) return { error: 'ORGANIZATION_ACCESS_DENIED' }
            if (!requester.editableWorkspaceIds.includes(data.originWorkspaceId)) return { error: 'WORKSPACE_ACCESS_DENIED' }
            const workspace = await Workspace.getWorkspace({ workspaceId: data.originWorkspaceId, userId })
            if ('error' in workspace) return workspace
            if (workspace.organizationId !== data.organizationId) return { error: 'ORGANIZATION_BOUNDARY_VIOLATION' }
            if (data.scope === 'workspace' && data.scopeOwnerId !== data.originWorkspaceId) return { error: 'INVALID_SCOPE_OWNER' }
            if (data.scope === 'user' && data.scopeOwnerId !== userId) return { error: 'INVALID_SCOPE_OWNER' }
            if (data.scope === 'organization' && data.scopeOwnerId !== data.organizationId) return { error: 'INVALID_SCOPE_OWNER' }
            const primaryCategory = data.primaryCategory as AssetPrimaryCategory | undefined
            if (primaryCategory !== 'document' && primaryCategory !== 'conversation') return { error: 'INVALID_PRIMARY_CATEGORY' }
            if (data.assetId !== undefined && (typeof data.assetId !== 'string' || !isUuid(data.assetId))) {
                return { error: 'INVALID_ASSET_ID' }
            }
            const assetId = data.assetId ?? uuid()
            const role = primaryCategory === 'conversation' ? 'conversation' : 'content'
            const defaultSnapshot = primaryCategory === 'conversation'
                ? { type: 'doc', content: [{ type: 'aiChatThread', attrs: { threadId: assetId, status: 'active' } }] }
                : { type: 'doc', content: [{ type: 'paragraph' }] }
            const initialDoc = data.initialDoc ?? defaultSnapshot
            if (primaryCategory === 'conversation' && hasMismatchedConversationIdentity(initialDoc, assetId)) {
                return { error: 'CONVERSATION_IDENTITY_MISMATCH' }
            }
            AssetDocumentService.assertAssetBackedMediaNodes(initialDoc)
            if (AssetDocumentService.getEmbeddedAssetIds(initialDoc).length > 0) {
                return { error: 'INITIAL_EMBEDDED_ASSETS_REQUIRE_ATTACH' }
            }
            const snapshot = new HeadlessProseMirrorEngine({
                documentType: primaryCategory === 'conversation' ? DOCUMENT_TYPE.ASSET_CONVERSATION : DOCUMENT_TYPE.ASSET_CONTENT,
                doc: initialDoc,
                version: 0,
            }).snapshot()
            const snapshotBytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
            const snapshotBlob = await BlobModel.store({
                organizationId: data.organizationId,
                bytes: snapshotBytes,
                mimeType: 'application/json',
                description: `Initial ${role} snapshot for Asset ${assetId}`,
            })
            const now = Date.now()
            const asset = await AssetModel.create({
                assetId,
                organizationId: data.organizationId,
                title: data.title,
                scope: data.scope as AssetScope,
                scopeOwnerId: data.scopeOwnerId,
                originWorkspaceId: data.originWorkspaceId,
                ownerUserId: userId,
                documents: {
                    [role]: {
                        role,
                        blobHash: snapshotBlob.blobHash,
                        version: 0,
                        schemaVersion: PROSEMIRROR_SCHEMA_VERSION,
                        byteSize: snapshotBytes.byteLength,
                        updatedAt: now,
                    },
                },
                states: primaryCategory === 'conversation'
                    ? { lifecycle: 'active', media: 'none', conversation: 'idle', provenance: 'none' }
                    : { lifecycle: 'active', media: 'none', conversation: 'none', provenance: 'none' },
                workspaceReference: {
                    workspaceId: data.originWorkspaceId,
                    surfaceIds: [`${primaryCategory}#${assetId}`],
                },
            })
            return asset
        },
    },
    {
        subject: ASSET_SUBJECTS.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.GET] },
            sub: {
                allow: Object.values(ASSET_SUBJECTS.EVENTS).map((subject) => `${subject}.{userIdToken}`),
            },
        },
        handler: async (data: any) => {
            const userId = data.user.userId as string
            const result = await AssetModel.get({
                assetId: data.assetId,
                requester: await getRequesterContext(userId),
            })
            if (!('error' in result)) rememberAuthorizedAssetEvent(userId, result.assetId)
            return result
        },
    },
    {
        subject: ASSET_SUBJECTS.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.LIST] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const requester = await getRequesterContext(data.user.userId)
            const result = await AssetModel.listAvailable({
                scopeAndOwners: [
                    ...requester.workspaceIds.map((workspaceId) => buildAssetScopeAndOwnerKey('workspace', workspaceId)),
                    buildAssetScopeAndOwnerKey('user', requester.userId),
                    ...requester.organizationIds.map((organizationId) => buildAssetScopeAndOwnerKey('organization', organizationId)),
                ],
                principalId: requester.userId,
                organizationIds: requester.organizationIds,
                limit: data.limit,
                cursor: data.cursor,
                primaryCategory: data.primaryCategory as AssetPrimaryCategory | undefined,
            })
            for (const item of result.items) rememberAuthorizedAssetEvent(requester.userId, item.assetId)
            return result
        },
    },
    {
        subject: ASSET_SUBJECTS.UPDATE_METADATA,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.UPDATE_METADATA] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const result = await AssetModel.updateMetadata({
                assetId: data.assetId,
                requester: await getRequesterContext(data.user.userId),
                expectedRevision: data.expectedRevision,
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.descriptor !== undefined ? { descriptor: data.descriptor } : {}),
            })
            return result
        },
    },
    {
        subject: ASSET_SUBJECTS.CHANGE_SCOPE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.CHANGE_SCOPE] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            if (!['workspace', 'user', 'organization'].includes(data.scope)) return { error: 'INVALID_SCOPE' }
            const requester = await getRequesterContext(data.user.userId)
            if (data.scope === 'workspace') {
                const boundary = await authorizeAssetWorkspaceBoundary({
                    assetId: data.assetId,
                    workspaceId: data.scopeOwnerId,
                    requester,
                })
                if ('error' in boundary) return boundary
            }
            return await AssetModel.changeScope({
                assetId: data.assetId,
                requester,
                expectedRevision: data.expectedRevision,
                scope: data.scope,
                scopeOwnerId: data.scopeOwnerId,
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.REVIEW_GENERATED_OUTPUT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.REVIEW_GENERATED_OUTPUT] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            if (!['output-node', 'branch-lineage'].includes(data.scope)) return { error: 'INVALID_REVIEW_SCOPE' }
            if (!['accept', 'supersede'].includes(data.action)) return { error: 'INVALID_REVIEW_ACTION' }
            if (data.action === 'supersede' && data.scope === 'output-node' && data.preserveLineage !== true) {
                return { error: 'MEDIA_NODE_PROMPT_REGENERATION_NOT_SUPPORTED' }
            }
            if (typeof data.workspaceId !== 'string' || typeof data.nodeId !== 'string') {
                return { error: 'INVALID_REVIEW_TARGET' }
            }
            return await generatedOutputReviewService.review({
                request: {
                    workspaceId: data.workspaceId,
                    scope: data.scope,
                    action: data.action,
                    nodeId: data.nodeId,
                    ...(data.action === 'supersede' ? { preserveLineage: data.preserveLineage === true } : {}),
                } as GeneratedOutputReviewRequest,
                requester: await getRequesterContext(data.user.userId),
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.ATTACH,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.ATTACH] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const requester = await getRequesterContext(data.user.userId)
            const boundary = await authorizeAssetWorkspaceBoundary({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                requester,
            })
            if ('error' in boundary) return boundary
            return await AssetModel.attachWorkspaceReference({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                requester,
                nodeId: data.nodeId,
                surfaceId: data.surfaceId,
                workspaceMutation: data.workspaceMutation,
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.DETACH,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.DETACH] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            const requester = await getRequesterContext(data.user.userId)
            if (data.referenceType === 'catalog') {
                return await AssetModel.detachCatalogReference({ assetId: data.assetId, requester })
            }
            const boundary = await authorizeAssetWorkspaceBoundary({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                requester,
            })
            if ('error' in boundary) return boundary
            if (boundary.asset.documents.conversation && data.surfaceId === `conversation#${data.assetId}`) {
                await AssetModel.removeWorkspaceSurfaceReferencesByPrefix({
                    workspaceId: data.workspaceId,
                    surfacePrefix: `conversation#${data.assetId}#media#`,
                    requester,
                })
            }
            return await AssetModel.detachWorkspaceReference({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                requester,
                nodeId: data.nodeId,
                surfaceId: data.surfaceId,
                workspaceMutation: data.workspaceMutation,
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.ACQUIRE_LEASE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.ACQUIRE_LEASE] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            if (typeof data.holderId !== 'string' || !data.holderId) return { error: 'LEASE_HOLDER_REQUIRED' }
            const requester = await getRequesterContext(data.user.userId)
            const boundary = await authorizeAssetWorkspaceBoundary({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                requester,
            })
            if ('error' in boundary) return boundary
            return await AssetModel.acquireLease({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                holderId: data.holderId,
                requester,
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.RENEW_LEASE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.RENEW_LEASE] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            if (typeof data.holderId !== 'string' || !data.holderId) return { error: 'LEASE_HOLDER_REQUIRED' }
            const requester = await getRequesterContext(data.user.userId)
            const boundary = await authorizeAssetWorkspaceBoundary({ assetId: data.assetId, workspaceId: data.workspaceId, requester })
            if ('error' in boundary) return boundary
            return await AssetModel.renewLease({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                leaseId: data.leaseId,
                holderId: data.holderId,
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.RELEASE_LEASE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.RELEASE_LEASE] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            if (typeof data.holderId !== 'string' || !data.holderId) return { error: 'LEASE_HOLDER_REQUIRED' }
            const requester = await getRequesterContext(data.user.userId)
            const boundary = await authorizeAssetWorkspaceBoundary({ assetId: data.assetId, workspaceId: data.workspaceId, requester })
            if ('error' in boundary) return boundary
            return await AssetModel.releaseLease({
                assetId: data.assetId,
                workspaceId: data.workspaceId,
                leaseId: data.leaseId,
                holderId: data.holderId,
            })
        },
    },
    {
        subject: ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS,
        type: 'reply',
        queue: 'assetDocumentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.DOCUMENT_SUBMIT_STEPS] },
            sub: { allow: [] },
        },
        handler: async (data: any) => {
            if (typeof data.holderId !== 'string' || !data.holderId) return { error: 'LEASE_HOLDER_REQUIRED' }
            const requester = await getRequesterContext(data.user.userId)
            const boundary = await authorizeAssetWorkspaceBoundary({ assetId: data.assetId, workspaceId: data.workspaceId, requester })
            if ('error' in boundary) return boundary
            return await AssetDocumentService.submitSteps({ payload: data, requester })
        },
    },
    {
        subject: ASSET_SUBJECTS.DOCUMENT_RESUME,
        type: 'reply',
        queue: 'assetDocumentSteps',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ASSET_SUBJECTS.DOCUMENT_RESUME] },
            sub: { allow: [`${ASSET_SUBJECTS.DOCUMENT_EVENTS}.{userIdToken}.>`] },
        },
        handler: async (data: any) => await AssetDocumentService.resume({
            coordinate: {
                organizationId: data.organizationId,
                assetId: data.assetId,
                role: data.role,
            },
            requester: await getRequesterContext(data.user.userId),
            localVersion: data.localVersion,
            localStreamSeq: data.localStreamSeq,
            acceptSnapshot: data.acceptSnapshot !== false,
            activateLiveRelay: data.activateLiveRelay === true,
        }),
    },
]
