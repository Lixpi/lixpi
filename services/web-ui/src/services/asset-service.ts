import {
    getAssetEventSubject,
    NATS_SUBJECTS,
    type Asset,
    type CanvasState,
    type AssetDocumentRole,
    type AssetMeta,
    type AssetPrimaryCategory,
    type AssetScope,
    type SubjectIdentityClassification,
    type GeneratedOutputReviewRequest,
    type GeneratedOutputReviewResponse,
} from '@lixpi/constants'
import {
    type AssetDocResumeResult,
    type AssetDocSnapshot,
    type AssetDocSnapshotReference,
} from '@lixpi/prosemirror'

import AuthService from '$src/services/auth-service.ts'
import { servicesStore } from '$src/stores/servicesStore.ts'
import { assetsStore } from '$src/stores/assetsStore.ts'
import {
    assetDocumentsStore,
    type AssetDocumentSnapshot,
} from '$src/stores/assetDocumentsStore.ts'
import { workspaceStore } from '$src/stores/workspaceStore.ts'
import { userStore } from '$src/stores/userStore.ts'

const { ASSET_SUBJECTS } = NATS_SUBJECTS
const WORKSPACE_RECONCILIATION_INTERVAL_MS = 5 * 60000
const ASSET_LOAD_CONCURRENCY = 8
const ASSET_DOCUMENT_RESUME_CONCURRENCY = 4
const ASSET_DOCUMENT_STORE_BATCH_SIZE = 16
const ASSET_DOCUMENT_RESUME_TIMEOUT_MS = 15000
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

const request = async <T>(
    subject: string,
    payload: Record<string, unknown>,
    timeout?: number,
): Promise<T> => {
    const nats = servicesStore.getData('nats')
    if (!nats) throw new Error('NATS service unavailable')
    return await nats.request(subject, {
        token: await AuthService.getTokenSilently(),
        ...payload,
    }, timeout) as T
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapItem: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length)
    const entries = items.entries()

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (true) {
                const entry = entries.next()
                if (entry.done) return
                const [index, item] = entry.value
                results[index] = await mapItem(item)
            }
        },
    )
    await Promise.all(workers)
    return results
}

export function getWorkspaceCanvasAssetIds(canvasState: CanvasState | undefined): string[] {
    if (!canvasState) return []

    const assetIds = new Set<string>()
    for (const node of canvasState.nodes) {
        if ('assetId' in node && typeof node.assetId === 'string' && node.assetId) {
            assetIds.add(node.assetId)
        }
        if ('conversationAssetId' in node
            && typeof node.conversationAssetId === 'string'
            && node.conversationAssetId) {
            assetIds.add(node.conversationAssetId)
        }
        if ('generatedBy' in node
            && node.generatedBy
            && typeof node.generatedBy.conversationAssetId === 'string'
            && node.generatedBy.conversationAssetId) {
            assetIds.add(node.generatedBy.conversationAssetId)
        }
    }
    for (const tab of canvasState.aiChatPanel?.tabs ?? []) {
        if (tab.type === 'thread' && typeof tab.refId === 'string' && tab.refId) {
            assetIds.add(tab.refId)
        }
    }
    if (canvasState.lastActiveConversationAssetId) {
        assetIds.add(canvasState.lastActiveConversationAssetId)
    }
    return [...assetIds]
}

export class AssetService {
    private async loadAssetsById(assetIds: readonly string[], workspaceId?: string): Promise<Asset[]> {
        const results = await mapWithConcurrency([...assetIds], ASSET_LOAD_CONCURRENCY, async (assetId) => {
            try {
                return await this.get(assetId, workspaceId)
            } catch (error) {
                console.warn('[AssetService] Asset load failed; synchronization will retry it', { assetId, error })
                return { error: 'ASSET_LOAD_FAILED' }
            }
        })
        return results.filter((result): result is Asset => !('error' in result))
    }

    async fetchDocumentSnapshot(reference: AssetDocSnapshotReference): Promise<AssetDocSnapshot> {
        const response = await fetch(`${API_BASE_URL}${reference.url}`, {
            headers: { Authorization: `Bearer ${await AuthService.getTokenSilently()}` },
        })
        if (!response.ok) throw new Error(`Asset document snapshot fetch failed: ${response.status}`)
        const snapshot = await response.json() as AssetDocSnapshot
        if (snapshot.assetId !== reference.assetId
            || snapshot.organizationId !== reference.organizationId
            || snapshot.role !== reference.role) {
            throw new Error('ASSET_DOCUMENT_SNAPSHOT_COORDINATE_MISMATCH')
        }
        return snapshot
    }

    async get(assetId: string, workspaceId?: string): Promise<Asset | { error: string }> {
        return await request(ASSET_SUBJECTS.GET, {
            assetId,
            ...(workspaceId ? { workspaceId } : {}),
        })
    }

    async ensureAssetsLoaded(assetIds: readonly string[]): Promise<Asset[]> {
        const missingAssetIds = [...new Set(assetIds)]
            .filter(assetId => assetId && !assetsStore.get(assetId))
        const loadedAssets = await this.loadAssetsById(missingAssetIds)
        for (const asset of loadedAssets) assetsStore.upsert(asset)
        return loadedAssets
    }

    async refresh(assetId: string, workspaceId?: string): Promise<Asset | { error: string }> {
        const asset = await this.get(assetId, workspaceId)
        if ('error' in asset) return asset
        assetsStore.upsert(asset)
        for (const role of Object.keys(asset.documents) as AssetDocumentRole[]) {
            if (assetDocumentsStore.get(asset.assetId, role)) continue
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
                        void this.refresh(assetId, workspaceId).then((result) => {
                            if ('error' in result) assetsStore.remove(assetId)
                        })
                    }
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
        workspaceId,
        primaryCategory,
        limit = 50,
        cursor,
    }: {
        workspaceId?: string
        primaryCategory?: AssetPrimaryCategory
        limit?: number
        cursor?: string
    } = {}): Promise<{ items: AssetMeta[]; cursor?: string }> {
        const result = await request<{ items: AssetMeta[]; cursor?: string } | { error: string }>(
            ASSET_SUBJECTS.LIST,
            { workspaceId, primaryCategory, limit, cursor },
        )
        if ('error' in result) throw new Error(`Asset list failed: ${result.error}`)
        if (!Array.isArray(result.items)) throw new Error('Asset list failed: invalid response')
        return result
    }

    async loadWorkspaceAssets(workspaceId: string): Promise<Asset[]> {
        assetsStore.setLoading(workspaceId)
        try {
            const workspace = workspaceStore.getData()
            const prioritizedAssetIds = getWorkspaceCanvasAssetIds(workspace?.canvasState)
                .sort((left, right) => {
                    const activeConversationAssetId = workspace?.canvasState?.lastActiveConversationAssetId
                    if (left === activeConversationAssetId) return -1
                    if (right === activeConversationAssetId) return 1
                    return 0
                })
            const directAssets = await this.loadAssetsById(prioritizedAssetIds, workspaceId)
            const directAssetIds = new Set(directAssets.map(asset => asset.assetId))
            const lineageSourceAssetIds = [...new Set(directAssets.flatMap(asset => asset.lineage?.sourceAssetIds ?? []))]
                .filter(assetId => !directAssetIds.has(assetId))
            const lineageSourceAssets = await this.loadAssetsById(lineageSourceAssetIds, workspaceId)
            const assets = [...directAssets, ...lineageSourceAssets]
            assetsStore.setAssets(workspaceId, Array.isArray(assets) ? assets : [])
            const documentCoordinates = assets
                .flatMap((asset) => (Object.keys(asset.documents) as AssetDocumentRole[]).map((role) => ({
                    organizationId: asset.organizationId,
                    assetId: asset.assetId,
                    role,
                })))
                .filter(({ assetId, role }) => !assetDocumentsStore.get(assetId, role))
                .sort((left, right) => {
                    if (left.role === 'conversation' && right.role !== 'conversation') return -1
                    if (right.role === 'conversation' && left.role !== 'conversation') return 1
                    return 0
                })
            const pendingSnapshots: AssetDocumentSnapshot[] = []
            const flushPendingSnapshots = (): void => {
                if (pendingSnapshots.length === 0) return
                assetDocumentsStore.setMany(pendingSnapshots.splice(0, pendingSnapshots.length))
            }
            await mapWithConcurrency(documentCoordinates, ASSET_DOCUMENT_RESUME_CONCURRENCY, async (coordinate) => {
                try {
                    const snapshot = await this.resumeDocumentSnapshot(coordinate)
                    if (snapshot) pendingSnapshots.push(snapshot)
                    if (pendingSnapshots.length >= ASSET_DOCUMENT_STORE_BATCH_SIZE) flushPendingSnapshots()
                } catch (error) {
                    console.warn('[AssetService] Asset document resume failed; synchronization will retry it', {
                        assetId: coordinate.assetId,
                        role: coordinate.role,
                        error,
                    })
                }
            })
            flushPendingSnapshots()
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
        const { result, snapshot } = await this.requestDocumentResume({
            organizationId,
            assetId,
            role,
            localVersion,
            localStreamSeq,
        })
        if (snapshot) assetDocumentsStore.set(snapshot)
        return result
    }

    private async resumeDocumentSnapshot({
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
    }): Promise<AssetDocumentSnapshot | null> {
        const { snapshot } = await this.requestDocumentResume({
            organizationId,
            assetId,
            role,
            localVersion,
            localStreamSeq,
        })
        return snapshot
    }

    private async requestDocumentResume({
        organizationId,
        assetId,
        role,
        localVersion,
        localStreamSeq,
    }: {
        organizationId: string
        assetId: string
        role: AssetDocumentRole
        localVersion: number
        localStreamSeq: number
    }): Promise<{ result: AssetDocResumeResult; snapshot: AssetDocumentSnapshot | null }> {
        const result = await request<AssetDocResumeResult>(ASSET_SUBJECTS.DOCUMENT_RESUME, {
            organizationId,
            assetId,
            role,
            localVersion,
            localStreamSeq,
        }, ASSET_DOCUMENT_RESUME_TIMEOUT_MS)
        if (result.snapshot) {
            const snapshot = await this.fetchDocumentSnapshot(result.snapshot)
            return {
                result,
                snapshot: {
                    assetId,
                    role,
                    version: snapshot.version,
                    doc: snapshot.doc,
                },
            }
        }
        return { result, snapshot: null }
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
        const result = await request<Asset | { error: string }>(ASSET_SUBJECTS.CREATE, {
            organizationId,
            originWorkspaceId: workspaceId,
            scope: 'workspace',
            scopeOwnerId: workspaceId,
            title,
            primaryCategory,
            ...(assetId ? { assetId } : {}),
            ...(initialDoc ? { initialDoc } : {}),
        })
        if ('error' in result) throw new Error(`Asset creation failed: ${result.error}`)
        assetsStore.upsert(result)
        return result
    }

    async updateMetadata(assetId: string, expectedRevision: number, updates: {
        title?: string
        descriptor?: Asset['descriptor']
    }): Promise<Asset | { error: string }> {
        const result = await request<Asset | { error: string }>(ASSET_SUBJECTS.UPDATE_METADATA, { assetId, expectedRevision, ...updates })
        if (!('error' in result)) assetsStore.upsert(result)
        return result
    }

    async attestSubjectIdentity(
        assetId: string,
        assetRevision: number,
        classification: SubjectIdentityClassification,
    ): Promise<Asset | { error: string }> {
        const result = await request<Asset | { error: string }>(ASSET_SUBJECTS.SUBJECT_IDENTITY_ATTEST, {
            assetId,
            assetRevision,
            classification,
        })
        if (!('error' in result)) assetsStore.upsert(result)
        return result
    }

    async changeScope(assetId: string, expectedRevision: number, scope: AssetScope, scopeOwnerId: string): Promise<Asset | { error: string }> {
        const result = await request<Asset | { error: string }>(ASSET_SUBJECTS.CHANGE_SCOPE, { assetId, expectedRevision, scope, scopeOwnerId })
        if (!('error' in result)) assetsStore.upsert(result)
        return result
    }

    async reviewGeneratedOutput(
        payload: GeneratedOutputReviewRequest,
    ): Promise<GeneratedOutputReviewResponse | { error: string }> {
        const result = await request<GeneratedOutputReviewResponse | { error: string }>(
            ASSET_SUBJECTS.REVIEW_GENERATED_OUTPUT,
            payload,
        )
        if (!('error' in result)) {
            await Promise.all(result.affectedAssetIds.map(async (assetId) => await this.refresh(assetId)))
        }
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
