import {
    getCapabilityUserEventSubject,
    NATS_SUBJECTS,
    type CapabilityCatalogRecord,
    type CapabilityManifest,
} from '@lixpi/constants'
import { validateCapabilityManifest } from '../shared/capability-validation.ts'
import type {
    CapabilityJsonValue,
    CapabilityKind,
    CapabilityMeta,
    CapabilityRun,
    CapabilityRunEvent,
    CapabilityScope,
} from '@lixpi/constants'

export const CAPABILITY_CATALOG_SUBJECTS = {
    list: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.LIST,
    get: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.GET,
    create: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.CREATE,
    update: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.UPDATE,
    delete: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.DELETE,
    grant: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.GRANT,
    revoke: NATS_SUBJECTS.CAPABILITY_SUBJECTS.CATALOG.REVOKE,
    run: NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.START,
    getRun: NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.GET,
    replay: NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.REPLAY,
} as const

export type CapabilityCatalogItem = CapabilityMeta & {
    scope: CapabilityScope
    icon?: string
}

export type CapabilityCatalogPage = {
    items: CapabilityCatalogItem[]
    cursor?: string
}

export type CapabilityInputSchema = {
    type: 'object'
    title?: string
    description?: string
    properties: Record<string, CapabilityInputSchemaProperty>
    required?: string[]
}

export type CapabilityInputSchemaProperty = {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
    title?: string
    description?: string
    enum?: Array<string | number>
    default?: CapabilityJsonValue
    items?: { type: 'string' | 'number' | 'integer' }
}

export type CapabilityDetails = CapabilityCatalogItem & {
    record: CapabilityCatalogRecord
    manifest: CapabilityManifest
    permissions: CapabilityManagementPermissions
    grants: CapabilityAccessGrant[]
    references: Array<Pick<CapabilityCatalogItem, 'capabilityId' | 'kind' | 'name'>>
    inputSchema?: CapabilityInputSchema
}

export type CapabilityAccessLevel = 'viewer' | 'editor' | 'owner'

export type CapabilityAccessGrant = {
    capabilityId: string
    principalId: string
    accessLevel: CapabilityAccessLevel
    createdAt: number
    updatedAt: number
}

export type CapabilityManagementPermissions = {
    canEdit: boolean
    canDelete: boolean
    canShare: boolean
    canSetStatus: boolean
}

export type CapabilitySaveInput = {
    manifest: CapabilityManifest
    scope: CapabilityScope
    scopeOwnerId: string
    storageOwnerId: string
    summary: string
    tags: string[]
}

export type CapabilityRunReplay = {
    run: CapabilityRun
    events: CapabilityRunEvent[]
    cursor?: string
}

export type CapabilityCatalogTransport = {
    request: <T>(subject: string, payload: Record<string, unknown>) => Promise<T>
    subscribe?: (subject: string, listener: (payload: unknown) => void) => { unsubscribe: () => void }
}

export type CapabilityCatalogClientConfig = {
    transport: CapabilityCatalogTransport
    getToken: () => Promise<string>
    workspaceId: string
    organizationId: string
    getUserId?: () => string
    cacheTtlMs?: number
}

type CachedPage = {
    expiresAt: number
    page: CapabilityCatalogPage
}

export class CapabilityCatalogClient {
    private readonly cache = new Map<string, CachedPage>()
    private readonly pending = new Map<string, Promise<CapabilityCatalogPage>>()
    private readonly cacheTtlMs: number
    private readonly recentSelections = new Map<string, CapabilityCatalogItem>()
    private readonly catalogItems = new Map<string, CapabilityCatalogItem>()

    constructor(private readonly config: CapabilityCatalogClientConfig) {
        this.cacheTtlMs = config.cacheTtlMs ?? 30_000
    }

    async search(query: string, limit = 20): Promise<CapabilityCatalogPage> {
        const normalizedQuery = normalizeQuery(query)
        const page = await this.fetchPage(CAPABILITY_CATALOG_SUBJECTS.list, {
            query: normalizedQuery,
            limit,
        })
        return normalizedQuery ? page : rankEmptyCapabilityQuery(page, [...this.recentSelections.values()], limit)
    }

    list(options: { cursor?: string; kind?: CapabilityKind; query?: string; limit?: number } = {}): Promise<CapabilityCatalogPage> {
        return this.fetchPage(CAPABILITY_CATALOG_SUBJECTS.list, {
            cursor: options.cursor,
            kinds: options.kind ? [options.kind] : undefined,
            query: normalizeQuery(options.query ?? ''),
            limit: options.limit ?? 20,
        })
    }

    async get(capabilityId: string): Promise<CapabilityDetails> {
        const response = await this.request<{
            record: CapabilityCatalogRecord
            manifest: CapabilityManifest
            references: Array<{
                capabilityId: string
                kind: CapabilityKind
                name?: string
                unavailable?: boolean
            }>
            resources: Array<{
                resourceId: string
                content?: unknown
            }>
            permissions?: Partial<CapabilityManagementPermissions>
            grants?: CapabilityAccessGrant[]
        }>(CAPABILITY_CATALOG_SUBJECTS.get, { capabilityId })
        const inputSchemaResourceId = response.manifest.tool?.inputSchema.resourceId
        const inputSchema = normalizeInputSchema(
            response.resources.find((resource) => resource.resourceId === inputSchemaResourceId)?.content,
        )
        const catalogItem = this.catalogItems.get(response.record.capabilityId)
        return {
            scopeAndOwner: `${response.record.scope}#${response.record.scopeOwnerId}`,
            scopeOwnerId: response.record.scopeOwnerId,
            searchKey: `${response.record.kind}#${response.manifest.name}`,
            capabilityId: response.record.capabilityId,
            kind: response.record.kind,
            scope: response.record.scope,
            name: response.manifest.name,
            normalizedName: normalizeQuery(response.manifest.name),
            summary: catalogItem?.summary ?? response.manifest.description,
            tags: catalogItem?.tags ?? [],
            manifestBlobHash: response.record.manifestBlobHash,
            ...(response.record.parentModuleId ? { parentModuleId: response.record.parentModuleId } : {}),
            catalogExposure: response.record.catalogExposure,
            status: response.record.status,
            updatedAt: response.record.updatedAt,
            references: response.references.map((reference) => ({
                capabilityId: reference.capabilityId,
                kind: reference.kind,
                name: reference.name ?? `${reference.capabilityId} (unavailable)`,
            })),
            inputSchema,
            record: response.record,
            manifest: response.manifest,
            permissions: {
                canEdit: response.permissions?.canEdit === true,
                canDelete: response.permissions?.canDelete === true,
                canShare: response.permissions?.canShare === true,
                canSetStatus: response.permissions?.canSetStatus === true || response.permissions?.canEdit === true,
            },
            grants: response.grants ?? [],
        }
    }

    async create(input: CapabilitySaveInput): Promise<CapabilityCatalogRecord> {
        assertValidCapabilityManifest(input.manifest)
        const record = await this.request<CapabilityCatalogRecord>(CAPABILITY_CATALOG_SUBJECTS.create, { ...input })
        this.invalidate()
        return record
    }

    async update(
        details: CapabilityDetails,
        manifest: CapabilityManifest,
        catalog: { summary: string; tags: string[] } = details,
    ): Promise<CapabilityCatalogRecord> {
        assertValidCapabilityManifest(manifest)
        const record = await this.request<CapabilityCatalogRecord>(CAPABILITY_CATALOG_SUBJECTS.update, {
            manifest,
            scope: details.record.scope,
            scopeOwnerId: details.record.scopeOwnerId,
            storageOwnerId: details.record.storageOwnerId,
            summary: catalog.summary,
            tags: catalog.tags,
            expectedManifestBlobHash: details.record.manifestBlobHash,
        })
        this.invalidate()
        return record
    }

    async setStatus(details: CapabilityDetails, status: 'active' | 'disabled'): Promise<CapabilityCatalogRecord> {
        const record = await this.request<CapabilityCatalogRecord>(CAPABILITY_CATALOG_SUBJECTS.update, {
            capabilityId: details.capabilityId,
            expectedManifestBlobHash: details.record.manifestBlobHash,
            status,
        })
        this.invalidate()
        return record
    }

    async delete(details: CapabilityDetails): Promise<CapabilityCatalogRecord> {
        const record = await this.request<CapabilityCatalogRecord>(CAPABILITY_CATALOG_SUBJECTS.delete, {
            capabilityId: details.capabilityId,
            expectedManifestBlobHash: details.record.manifestBlobHash,
        })
        this.invalidate()
        return record
    }

    async grant(capabilityId: string, principalId: string, accessLevel: CapabilityAccessLevel): Promise<CapabilityAccessGrant> {
        const grant = await this.request<CapabilityAccessGrant>(CAPABILITY_CATALOG_SUBJECTS.grant, {
            capabilityId,
            principalId,
            accessLevel,
        })
        this.invalidate()
        return grant
    }

    async revoke(capabilityId: string, principalId: string): Promise<void> {
        await this.request(CAPABILITY_CATALOG_SUBJECTS.revoke, { capabilityId, principalId })
        this.invalidate()
    }

    async run(capabilityId: string, input: Record<string, CapabilityJsonValue>): Promise<CapabilityRun> {
        return this.request<CapabilityRun>(CAPABILITY_CATALOG_SUBJECTS.run, {
            capabilityId,
            arguments: input,
            origin: 'panel',
        })
    }

    async replay(runId: string, cursor?: string): Promise<CapabilityRunReplay> {
        const run = await this.request<CapabilityRun>(CAPABILITY_CATALOG_SUBJECTS.getRun, { runId })
        const response = await this.request<{
            events: Array<{ event: CapabilityRunEvent; streamSequence: number }>
            hasMore: boolean
        }>(CAPABILITY_CATALOG_SUBJECTS.replay, {
            runId,
            startStreamSequence: cursor ? Number(cursor) : 1,
            maxMessages: 1000,
        })
        const lastSequence = response.events.at(-1)?.streamSequence
        return {
            run,
            events: response.events.map((envelope) => envelope.event),
            ...(response.hasMore && lastSequence ? { cursor: String(lastSequence + 1) } : {}),
        }
    }

    subscribeToRunEvents(runId: string, listener: (event: CapabilityRunEvent) => void): () => void {
        const subscribe = this.config.transport.subscribe
        if (!subscribe) return () => undefined
        const userId = this.config.getUserId?.() ?? ''
        if (!userId) throw new Error('Capability run events require an authenticated user')
        const subject = [
            getCapabilityUserEventSubject(userId, NATS_SUBJECTS.CAPABILITY_SUBJECTS.RUN.STATUS),
            this.config.workspaceId.replace(/[^A-Za-z0-9_-]/g, '_'),
            runId.replace(/[^A-Za-z0-9_-]/g, '_'),
        ].join('.')
        const subscription = subscribe(subject, (payload) => {
            const envelope = payload as {
                workspaceId?: unknown
                event?: CapabilityRunEvent
            }
            if (envelope.workspaceId !== this.config.workspaceId || envelope.event?.runId !== runId) return
            listener(envelope.event)
        })
        return () => subscription.unsubscribe()
    }

    rememberSelection(item: CapabilityCatalogItem): void {
        this.recentSelections.delete(item.capabilityId)
        this.recentSelections.set(item.capabilityId, item)
        while (this.recentSelections.size > 20) {
            const oldestCapabilityId = this.recentSelections.keys().next().value
            if (typeof oldestCapabilityId !== 'string') break
            this.recentSelections.delete(oldestCapabilityId)
        }
    }

    invalidate(): void {
        this.cache.clear()
    }

    private fetchPage(subject: string, payload: Record<string, unknown>): Promise<CapabilityCatalogPage> {
        const cacheKey = `${subject}:${stablePayloadKey(payload)}`
        const cached = this.cache.get(cacheKey)
        if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.page)

        const inFlight = this.pending.get(cacheKey)
        if (inFlight) return inFlight

        const request = this.loadAndCachePage(cacheKey, subject, payload)
        this.pending.set(cacheKey, request)
        return request
    }

    private async loadAndCachePage(
        cacheKey: string,
        subject: string,
        payload: Record<string, unknown>,
    ): Promise<CapabilityCatalogPage> {
        try {
            const rawPage = await this.request<{ items: CapabilityMeta[]; cursor?: string }>(subject, payload)
            const page: CapabilityCatalogPage = {
                items: rawPage.items.map((item) => ({
                    ...item,
                    scope: item.scope,
                })),
                cursor: rawPage.cursor,
            }
            for (const item of page.items) this.catalogItems.set(item.capabilityId, item)
            this.cache.set(cacheKey, { page, expiresAt: Date.now() + this.cacheTtlMs })
            return page
        } finally {
            this.pending.delete(cacheKey)
        }
    }

    private async request<T>(subject: string, payload: Record<string, unknown>): Promise<T> {
        const token = await this.config.getToken()
        const response = await this.config.transport.request<T>(subject, {
            token,
            workspaceId: this.config.workspaceId,
            organizationId: this.config.organizationId,
            ...withoutUndefinedValues(payload),
        }) as T & { error?: string }
        if (response?.error) throw new Error(response.error)
        return response
    }
}

export function rankEmptyCapabilityQuery(
    page: CapabilityCatalogPage,
    recentSelections: CapabilityCatalogItem[],
    limit = 20,
): CapabilityCatalogPage {
    const ranked: CapabilityCatalogItem[] = []
    const seen = new Set<string>()
    const push = (item: CapabilityCatalogItem): void => {
        if (seen.has(item.capabilityId) || ranked.length >= limit) return
        seen.add(item.capabilityId)
        ranked.push(item)
    }
    recentSelections.slice().reverse().forEach(push)
    page.items
        .filter((item) => item.tags.includes('recommended'))
        .sort(compareCapabilityCatalogItems)
        .forEach(push)
    page.items.forEach(push)
    return { items: ranked, cursor: page.cursor }
}

function compareCapabilityCatalogItems(left: CapabilityCatalogItem, right: CapabilityCatalogItem): number {
    return left.normalizedName.localeCompare(right.normalizedName)
        || left.kind.localeCompare(right.kind)
        || left.capabilityId.localeCompare(right.capabilityId)
}

function normalizeInputSchema(value: unknown): CapabilityInputSchema | undefined {
    if (!value || typeof value !== 'object') return undefined
    const candidate = value as Partial<CapabilityInputSchema>
    if (candidate.type !== 'object' || !candidate.properties || typeof candidate.properties !== 'object') return undefined
    return candidate as CapabilityInputSchema
}

export function parseCapabilityManifestJson(value: string): CapabilityManifest {
    let parsed: unknown
    try {
        parsed = JSON.parse(value)
    } catch {
        throw new Error('Manifest must be valid JSON')
    }
    assertValidCapabilityManifest(parsed)
    return parsed
}

function assertValidCapabilityManifest(value: unknown): asserts value is CapabilityManifest {
    const validation = validateCapabilityManifest(value)
    if (!validation.valid) {
        throw new Error(`Invalid manifest: ${validation.issues[0]?.message ?? validation.issues[0]?.code ?? 'unknown issue'}`)
    }
}

export function normalizeQuery(query: string): string {
    return query.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function stablePayloadKey(payload: Record<string, unknown>): string {
    return JSON.stringify(Object.entries(withoutUndefinedValues(payload)).sort(([left], [right]) => left.localeCompare(right)))
}

function withoutUndefinedValues(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
}
