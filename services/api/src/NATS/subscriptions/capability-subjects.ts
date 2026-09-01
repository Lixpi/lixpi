import {
    getCapabilityUserEventSubject,
    NATS_SUBJECTS,
    type CapabilityRun,
} from '@lixpi/constants'
import NATS_Service from '@lixpi/nats-service'

import CapabilityModel, {
    type CapabilityRequesterContext,
} from '../../models/capability.ts'
import CapabilityRunModel, {
    type StoredCapabilityRun,
} from '../../models/capability-run.ts'
import Workspace from '../../models/workspace.ts'
import { getAssetRequesterContext } from '../../services/asset-requester-context.ts'
import { CapabilityRunEventLog } from '../../services/capability-run-event-log.ts'
import { ensureCapabilityCatalogEventRelay } from '../../services/capability-catalog-event-relay.ts'
import { capabilityActionRegistry } from '../../capability-system/capability-runtime.ts'

const { CATALOG, RUN } = NATS_SUBJECTS.CAPABILITY_SUBJECTS

export type CapabilityRunDispatcher = {
    start: (input: {
        userId: string
        workspaceId: string
        organizationId: string
        capabilityId: string
        origin: CapabilityRun['origin']
        arguments: Record<string, unknown>
        conversationAssetId?: string
    }) => Promise<StoredCapabilityRun>
    stop: (run: StoredCapabilityRun) => Promise<void>
}

let runDispatcher: CapabilityRunDispatcher | undefined

export function setCapabilityRunDispatcher(dispatcher: CapabilityRunDispatcher): void {
    runDispatcher = dispatcher
}

async function getRequester(userId: string): Promise<CapabilityRequesterContext> {
    const requester = await getAssetRequesterContext(userId)
    const capabilityRequester = {
        userId,
        organizationIds: requester.organizationIds,
        canManageGlobalCapabilities: false,
    }
    ensureCapabilityCatalogEventRelay(capabilityRequester)
    return capabilityRequester
}

async function getAuthorizedWorkspaceOrganizationId(userId: string, workspaceId: string): Promise<string | undefined> {
    const workspace = await Workspace.getWorkspace({ userId, workspaceId })
    return !('error' in workspace) && !workspace.deletingAt ? workspace.organizationId : undefined
}

function publishCatalogInvalidation(payload: Record<string, unknown>): void {
    const connection = NATS_Service.getInstance()?.getConnection()
    if (!connection) return
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    connection.publish(CATALOG.CATALOG_CHANGED, bytes)
}

function sanitizeSubjectToken(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

async function searchCatalog(data: any): Promise<unknown> {
    return await CapabilityModel.listAuthorized({
        requester: await getRequester(data.user.userId),
        query: typeof data.query === 'string' ? data.query : '',
        kinds: Array.isArray(data.kinds) ? data.kinds : undefined,
        limit: typeof data.limit === 'number' ? data.limit : undefined,
        cursor: typeof data.cursor === 'string' ? data.cursor : undefined,
    })
}

async function saveCatalog(data: any, operation: 'create' | 'update' | 'save'): Promise<unknown> {
    try {
        if (operation === 'create' && data.expectedManifestBlobHash !== undefined) {
            throw new Error('EXPECTED_MANIFEST_BLOB_HASH_NOT_ALLOWED')
        }
        if (operation === 'update' && typeof data.expectedManifestBlobHash !== 'string') {
            throw new Error('EXPECTED_MANIFEST_BLOB_HASH_REQUIRED')
        }
        const requester = await getRequester(data.user.userId)
        if (operation === 'update') {
            const existing = await CapabilityModel.authorize({
                capabilityId: data.manifest?.capabilityId,
                requester,
                access: 'edit',
            })
            if ('error' in existing) throw new Error(existing.error)
        }
        const record = await CapabilityModel.save({
            manifest: data.manifest,
            scope: data.scope,
            scopeOwnerId: data.scopeOwnerId,
            storageOwnerId: data.storageOwnerId,
            summary: data.summary ?? '',
            tags: data.tags ?? [],
            catalogExposure: 'standalone',
            expectedManifestBlobHash: data.expectedManifestBlobHash,
            grants: data.grants,
            requester,
            allowedActions: capabilityActionRegistry.allowedActionKeys(),
        })
        publishCatalogInvalidation({
            kind: 'CAPABILITY_CATALOG_CHANGED',
            action: operation,
            capabilityId: record.capabilityId,
            scope: record.scope,
            scopeOwnerId: record.scopeOwnerId,
            audienceUserIds: await CapabilityModel.getAudienceUserIds(record.capabilityId),
            manifestBlobHash: record.manifestBlobHash,
            updatedAt: record.updatedAt,
        })
        return record
    } catch (error) {
        return { error: (error as Error).message }
    }
}

async function updateCatalog(data: any): Promise<unknown> {
    if (data.status === undefined) return await saveCatalog(data, 'update')
    try {
        if (data.manifest !== undefined) throw new Error('CAPABILITY_STATUS_UPDATE_MUST_NOT_INCLUDE_MANIFEST')
        if (typeof data.capabilityId !== 'string' || typeof data.expectedManifestBlobHash !== 'string') {
            throw new Error('CAPABILITY_STATUS_UPDATE_INVALID')
        }
        const updated = await CapabilityModel.setStatus({
            capabilityId: data.capabilityId,
            expectedManifestBlobHash: data.expectedManifestBlobHash,
            status: data.status,
            requester: await getRequester(data.user.userId),
        })
        publishCatalogInvalidation({
            kind: 'CAPABILITY_CATALOG_CHANGED',
            action: data.status === 'active' ? 'enable' : 'disable',
            capabilityId: updated.record.capabilityId,
            scope: updated.record.scope,
            scopeOwnerId: updated.record.scopeOwnerId,
            audienceUserIds: updated.audienceUserIds,
            manifestBlobHash: updated.record.manifestBlobHash,
            updatedAt: updated.record.updatedAt,
        })
        return updated.record
    } catch (error) {
        return { error: (error as Error).message }
    }
}

const catalogEventPermission = { sub: { allow: [`${CATALOG.CATALOG_CHANGED}.{userIdToken}`] } }

export const capabilitySubjects = [
    {
        subject: CATALOG.SEARCH,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.SEARCH] }, sub: { allow: [] } },
        handler: searchCatalog,
    },
    {
        subject: CATALOG.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.GET] }, sub: { allow: [] } },
        handler: async (data: any) => {
            try {
                const requester = await getRequester(data.user.userId)
                const result = await CapabilityModel.readManifest({
                    capabilityId: data.capabilityId,
                    requester,
                })
                const references = await Promise.all(result.manifest.references.map(async (reference) => {
                    try {
                        const resolved = await CapabilityModel.readManifest({
                            capabilityId: reference.capabilityId,
                            requester,
                        })
                        return {
                            capabilityId: reference.capabilityId,
                            kind: reference.kind,
                            name: resolved.manifest.name,
                            manifestBlobHash: resolved.record.manifestBlobHash,
                            status: resolved.record.status,
                        }
                    } catch {
                        return { capabilityId: reference.capabilityId, kind: reference.kind, unavailable: true }
                    }
                }))
                const resources = await Promise.all(result.manifest.resources.map(async (resource) => {
                    const detail = {
                        ...resource,
                        url: `/api/capabilities/${encodeURIComponent(result.record.capabilityId)}/resources/${encodeURIComponent(resource.resourceId)}?manifestBlobHash=${encodeURIComponent(result.record.manifestBlobHash)}`,
                    }
                    if (resource.mediaType.startsWith('image/')) return detail
                    const resolved = await CapabilityModel.readResource({
                        capabilityId: result.record.capabilityId,
                        resourceId: resource.resourceId,
                        requester,
                        manifestBlobHash: result.record.manifestBlobHash,
                    })
                    const text = new TextDecoder().decode(resolved.bytes)
                    if (resource.mediaType === 'application/json' || resource.mediaType === 'application/schema+json') {
                        return { ...detail, content: JSON.parse(text) }
                    }
                    return { ...detail, content: text }
                }))
                const editable = await CapabilityModel.authorize({
                    capabilityId: result.record.capabilityId,
                    requester,
                    access: 'edit',
                })
                const canManage = !('error' in editable)
                const grants = canManage
                    ? await CapabilityModel.listAccessGrants({ capabilityId: result.record.capabilityId, requester })
                    : []
                return {
                    record: result.record,
                    manifest: result.manifest,
                    references,
                    resources,
                    permissions: {
                        canEdit: canManage,
                        canDelete: canManage,
                        canShare: canManage,
                    },
                    grants,
                }
            } catch (error) {
                return { error: (error as Error).message }
            }
        },
    },
    {
        subject: CATALOG.CREATE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [CATALOG.CREATE] },
            ...catalogEventPermission,
        },
        handler: async (data: any) => await saveCatalog(data, 'create'),
    },
    {
        subject: CATALOG.UPDATE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.UPDATE] }, ...catalogEventPermission },
        handler: updateCatalog,
    },
    {
        subject: CATALOG.DELETE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.DELETE] }, ...catalogEventPermission },
        handler: async (data: any) => {
            try {
                const removed = await CapabilityModel.remove({
                    capabilityId: data.capabilityId,
                    expectedManifestBlobHash: data.expectedManifestBlobHash,
                    requester: await getRequester(data.user.userId),
                })
                publishCatalogInvalidation({
                    kind: 'CAPABILITY_CATALOG_CHANGED',
                    action: 'delete',
                    capabilityId: removed.record.capabilityId,
                    scope: removed.record.scope,
                    scopeOwnerId: removed.record.scopeOwnerId,
                    audienceUserIds: removed.audienceUserIds,
                    manifestBlobHash: removed.record.manifestBlobHash,
                    updatedAt: removed.record.updatedAt,
                })
                return removed.record
            } catch (error) {
                return { error: (error as Error).message }
            }
        },
    },
    {
        subject: CATALOG.GRANT,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.GRANT] }, ...catalogEventPermission },
        handler: async (data: any) => {
            try {
                const requester = await getRequester(data.user.userId)
                const record = await CapabilityModel.authorize({ capabilityId: data.capabilityId, requester })
                if ('error' in record) throw new Error(record.error)
                const grant = await CapabilityModel.grantAccess({
                    capabilityId: data.capabilityId,
                    principalId: data.principalId,
                    accessLevel: data.accessLevel,
                    requester,
                })
                publishCatalogInvalidation({
                    kind: 'CAPABILITY_CATALOG_CHANGED',
                    action: 'grant',
                    capabilityId: record.capabilityId,
                    scope: record.scope,
                    scopeOwnerId: record.scopeOwnerId,
                    audienceUserIds: [grant.principalId],
                    manifestBlobHash: record.manifestBlobHash,
                    updatedAt: grant.updatedAt,
                })
                return grant
            } catch (error) {
                return { error: (error as Error).message }
            }
        },
    },
    {
        subject: CATALOG.REVOKE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.REVOKE] }, ...catalogEventPermission },
        handler: async (data: any) => {
            try {
                const requester = await getRequester(data.user.userId)
                const record = await CapabilityModel.authorize({ capabilityId: data.capabilityId, requester })
                if ('error' in record) throw new Error(record.error)
                await CapabilityModel.revokeAccess({
                    capabilityId: data.capabilityId,
                    principalId: data.principalId,
                    requester,
                })
                publishCatalogInvalidation({
                    kind: 'CAPABILITY_CATALOG_CHANGED',
                    action: 'revoke',
                    capabilityId: record.capabilityId,
                    scope: record.scope,
                    scopeOwnerId: record.scopeOwnerId,
                    audienceUserIds: [data.principalId],
                    manifestBlobHash: record.manifestBlobHash,
                    updatedAt: Date.now(),
                })
                return { success: true, capabilityId: data.capabilityId, principalId: data.principalId }
            } catch (error) {
                return { error: (error as Error).message }
            }
        },
    },
    {
        subject: CATALOG.LIST,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.LIST] }, sub: { allow: [] } },
        handler: searchCatalog,
    },
    {
        subject: CATALOG.SAVE,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [CATALOG.SAVE] }, ...catalogEventPermission },
        handler: async (data: any) => await saveCatalog(data, 'save'),
    },
    {
        subject: RUN.START,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [RUN.START] },
            sub: { allow: [`${RUN.STATUS}.{userIdToken}.>`] },
        },
        handler: async (data: any) => {
            const userId = data.user.userId
            if (!runDispatcher) return { error: 'CAPABILITY_RUNNER_NOT_INITIALIZED' }
            const organizationId = await getAuthorizedWorkspaceOrganizationId(userId, data.workspaceId)
            if (!organizationId) return { error: 'WORKSPACE_ACCESS_DENIED' }
            return await runDispatcher.start({
                userId,
                workspaceId: data.workspaceId,
                organizationId,
                capabilityId: data.capabilityId,
                origin: data.origin ?? 'panel',
                arguments: data.arguments ?? {},
                ...(data.conversationAssetId ? { conversationAssetId: data.conversationAssetId } : {}),
            })
        },
    },
    {
        subject: RUN.STATUS,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [RUN.STATUS] }, sub: { allow: [] } },
        handler: async (data: any) =>
            await CapabilityRunModel.getAuthorized({
                runId: data.runId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
            }),
    },
    {
        subject: RUN.RESUME,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [RUN.RESUME] }, sub: { allow: [`${RUN.STATUS}.{userIdToken}.>`] } },
        handler: async (data: any) => {
            const run = await CapabilityRunModel.getAuthorized({
                runId: data.runId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
            })
            if ('error' in run) return run
            const startStreamSequence = typeof data.startStreamSequence === 'number'
                ? data.startStreamSequence
                : typeof data.cursor === 'string' && Number.isSafeInteger(Number(data.cursor))
                ? Number(data.cursor)
                : 1
            const replay = await CapabilityRunEventLog.fromSingleton().replay({
                workspaceId: run.workspaceId,
                runId: run.runId,
                startStreamSequence,
                maxMessages: data.maxMessages,
            })
            return {
                run,
                liveSubject: [
                    getCapabilityUserEventSubject(data.user.userId, RUN.STATUS),
                    sanitizeSubjectToken(run.workspaceId),
                    sanitizeSubjectToken(run.runId),
                ].join('.'),
                replay,
            }
        },
    },
    {
        subject: RUN.STOP,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [RUN.STOP] }, sub: { allow: [] } },
        handler: async (data: any) => {
            if (!runDispatcher) return { error: 'CAPABILITY_RUNNER_NOT_INITIALIZED' }
            const run = await CapabilityRunModel.getAuthorized({
                runId: data.runId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
            })
            if ('error' in run) return run
            if (!['pending', 'running'].includes(run.status)) return { error: 'CAPABILITY_RUN_NOT_ACTIVE' }
            await runDispatcher.stop(run)
            return { success: true, runId: run.runId }
        },
    },
    {
        subject: RUN.GET,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [RUN.GET] }, sub: { allow: [] } },
        handler: async (data: any) =>
            await CapabilityRunModel.getAuthorized({
                runId: data.runId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
            }),
    },
    {
        subject: RUN.REPLAY,
        type: 'reply',
        payloadType: 'json',
        permissions: { pub: { allow: [RUN.REPLAY] }, sub: { allow: [] } },
        handler: async (data: any) => {
            const run = await CapabilityRunModel.getAuthorized({
                runId: data.runId,
                workspaceId: data.workspaceId,
                userId: data.user.userId,
            })
            if ('error' in run) return run
            return await CapabilityRunEventLog.fromSingleton().replay({
                workspaceId: data.workspaceId,
                runId: data.runId,
                startStreamSequence: data.startStreamSequence,
                maxMessages: data.maxMessages,
            })
        },
    },
]
