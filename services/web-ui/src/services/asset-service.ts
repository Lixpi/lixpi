import {
    getAssetEventSubject,
    NATS_SUBJECTS,
    type Asset,
    type AssetDocumentRole,
    type AssetMeta,
    type AssetPrimaryCategory,
    type AssetScope,
} from '@lixpi/constants'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import { assetDocumentsStore } from '$src/stores/assetDocumentsStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { userStore } from '$src/stores/userStore.ts'

const { ASSET_SUBJECTS } = NATS_SUBJECTS
const WORKSPACE_RECONCILIATION_INTERVAL_MS = 5 * 60_000

const request = async <T>(subject: string, payload: Record<string, unknown>): Promise<T> => {
    const nats = servicesStore.getData('nats')
    if (!nats) throw new Error('NATS service unavailable')
    return await nats.request(subject, {
        token: await AuthService.getTokenSilently(),
        ...payload,
    }) as T
}

export class AssetService {
    async get(assetId: string): Promise<Asset | { error: string }> {
        return await request(ASSET_SUBJECTS.GET, { assetId })
    }

    async refresh(assetId: string): Promise<Asset | { error: string }> {
        const asset = await this.get(assetId)
        if ('error' in asset) return asset
        assetsStore.upsert(asset)
        for (const role of Object.keys(asset.documents) as AssetDocumentRole[]) {
            if (role === 'provenance' || assetDocumentsStore.get(asset.assetId, role)) continue
            await this.resumeDocument({
                organizationId: asset.organizationId,
                assetId: asset.assetId,
                role,
            })
        }
        return asset
    }

    startWorkspaceSynchronization(workspaceId: string): () => void {
        let stopped = false
        let running = false
        const synchronize = async (): Promise<void> => {
            if (stopped || running) return
            running = true
            try {
                await this.loadWorkspaceAssets(workspaceId)
            } catch (error) {
                console.error('[AssetService] Asset synchronization failed', error)
            } finally {
                running = false
            }
        }
        const nats = servicesStore.getData('nats')
        const userId = userStore.getData('userId') as string
        const eventSubscriptions = nats && userId
            ? Object.entries(ASSET_SUBJECTS.EVENTS).map(([eventName, canonicalSubject]) => nats.subscribe(
                getAssetEventSubject(userId, canonicalSubject),
                (data: any) => {
                    const assetId = typeof data?.assetId === 'string' ? data.assetId : ''
                    if (eventName === 'DELETED') {
                        if (assetId) assetsStore.remove(assetId)
                        return
                    }
                    if (assetId && assetsStore.get(assetId)) {
                        void this.refresh(assetId).then((result) => {
                            if ('error' in result) assetsStore.remove(assetId)
                        })
                        return
                    }
                    void synchronize()
                },
            ))
            : []
        const timer = setInterval(() => { void synchronize() }, WORKSPACE_RECONCILIATION_INTERVAL_MS)
        return () => {
            stopped = true
            clearInterval(timer)
            for (const subscription of eventSubscriptions) subscription.unsubscribe()
        }
    }

    async list({
        primaryCategory,
        limit = 50,
        cursor,
    }: {
        primaryCategory?: AssetPrimaryCategory
        limit?: number
        cursor?: string
    } = {}): Promise<{ items: AssetMeta[]; cursor?: string }> {
        const result = await request<{ items: AssetMeta[]; cursor?: string } | { error: string }>(
            ASSET_SUBJECTS.LIST,
            { primaryCategory, limit, cursor },
        )
        if ('error' in result) throw new Error(`Asset list failed: ${result.error}`)
        if (!Array.isArray(result.items)) throw new Error('Asset list failed: invalid response')
        return result
    }

    async loadWorkspaceAssets(workspaceId: string): Promise<Asset[]> {
        assetsStore.setLoading(workspaceId)
        try {
            const workspace = workspaceStore.getData()
            const assetIds = new Set<string>()
            for (const node of workspace?.canvasState?.nodes ?? []) {
                if (typeof node.assetId === 'string') assetIds.add(node.assetId)
            }
            for (const tab of workspace?.canvasState?.aiChatPanel?.tabs ?? []) {
                if (tab.type === 'thread' && typeof tab.refId === 'string') assetIds.add(tab.refId)
            }
            if (typeof workspace?.canvasState?.lastActiveConversationAssetId === 'string') {
                assetIds.add(workspace.canvasState.lastActiveConversationAssetId)
            }
            for (const primaryCategory of ['document', 'conversation'] as const) {
                let cursor: string | undefined
                do {
                    const page = await this.list({ primaryCategory, limit: 100, cursor })
                    for (const item of page.items) {
                        if (item.scopeAndOwner === `workspace#${workspaceId}`) assetIds.add(item.assetId)
                    }
                    cursor = page.cursor
                } while (cursor)
            }
            const results = await Promise.all([...assetIds].map(async (assetId) => await this.get(assetId)))
            const assets = results.filter((result): result is Asset => !('error' in result))
            assetsStore.setAssets(workspaceId, Array.isArray(assets) ? assets : [])
            await Promise.all(assets.flatMap((asset) => (Object.keys(asset.documents) as AssetDocumentRole[])
                .filter((role) => role !== 'provenance')
                .map(async (role) => await this.resumeDocument({
                    organizationId: asset.organizationId,
                    assetId: asset.assetId,
                    role,
                }))))
            return assets
        } catch (error) {
            assetsStore.setError(error)
            throw error
        }
    }

    async resumeDocument({
        organizationId,
        assetId,
        role,
        localVersion = 0,
        localStreamSeq = 0,
    }: {
        organizationId: string
        assetId: string
        role: AssetDocumentRole
        localVersion?: number
        localStreamSeq?: number
    }): Promise<any> {
        const result = await request<any>(ASSET_SUBJECTS.DOCUMENT_RESUME, {
            organizationId,
            assetId,
            role,
            localVersion,
            localStreamSeq,
        })
        if (result?.snapshot?.doc) {
            assetDocumentsStore.set({
                assetId,
                role,
                version: result.snapshot.version,
                doc: result.snapshot.doc,
            })
        }
        return result
    }

    async create({
        organizationId,
        workspaceId,
        title,
        primaryCategory,
        initialDoc,
        assetId,
    }: {
        organizationId: string
        workspaceId: string
        title: string
        primaryCategory: 'document' | 'conversation'
        initialDoc?: object
        assetId?: string
    }): Promise<Asset> {
        const asset = await request<Asset>(ASSET_SUBJECTS.CREATE, {
            organizationId,
            originWorkspaceId: workspaceId,
            scope: 'workspace',
            scopeOwnerId: workspaceId,
            title,
            primaryCategory,
            ...(assetId ? { assetId } : {}),
            ...(initialDoc ? { initialDoc } : {}),
        })
        assetsStore.upsert(asset)
        return asset
    }

    async updateMetadata(assetId: string, expectedRevision: number, updates: {
        title?: string
        descriptor?: Asset['descriptor']
    }): Promise<Asset | { error: string }> {
        const result = await request<Asset | { error: string }>(ASSET_SUBJECTS.UPDATE_METADATA, { assetId, expectedRevision, ...updates })
        if (!('error' in result)) assetsStore.upsert(result)
        return result
    }

    async changeScope(assetId: string, expectedRevision: number, scope: AssetScope, scopeOwnerId: string): Promise<Asset | { error: string }> {
        const result = await request<Asset | { error: string }>(ASSET_SUBJECTS.CHANGE_SCOPE, { assetId, expectedRevision, scope, scopeOwnerId })
        if (!('error' in result)) assetsStore.upsert(result)
        return result
    }

    async attach(payload: {
        assetId: string
        workspaceId: string
        nodeId?: string
        surfaceId?: string
        workspaceMutation?: Record<string, unknown>
    }): Promise<unknown> {
        return await request(ASSET_SUBJECTS.ATTACH, payload)
    }

    async detach(payload: {
        assetId: string
        workspaceId?: string
        nodeId?: string
        surfaceId?: string
        referenceType?: 'workspace' | 'catalog'
        workspaceMutation?: Record<string, unknown>
    }): Promise<unknown> {
        return await request(ASSET_SUBJECTS.DETACH, payload)
    }

    async acquireLease(assetId: string, workspaceId: string, holderId: string): Promise<Asset['editLease'] | { error: string }> {
        return await request(ASSET_SUBJECTS.ACQUIRE_LEASE, { assetId, workspaceId, holderId })
    }

    async renewLease(assetId: string, workspaceId: string, leaseId: string, holderId: string): Promise<Asset['editLease'] | { error: string }> {
        return await request(ASSET_SUBJECTS.RENEW_LEASE, { assetId, workspaceId, leaseId, holderId })
    }

    async releaseLease(assetId: string, workspaceId: string, leaseId: string, holderId: string): Promise<void> {
        await request(ASSET_SUBJECTS.RELEASE_LEASE, { assetId, workspaceId, leaseId, holderId })
    }

    getRenditionUrl(assetId: string, rendition: string): string {
        return `/api/assets/${assetId}/renditions/${rendition}`
    }
}

export default AssetService
