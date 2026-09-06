import { createHash } from 'node:crypto'

import {
    type CapabilityCatalogRecord,
    type CapabilityPromptReference,
    type CapabilityResourceRef,
    type ResolvedCapability,
    type ResolvedCapabilityPlan,
} from '@lixpi/constants'

import {
    CAPABILITY_LIMITS,
    validateCapabilityDependencyGraph,
    validateCapabilityManifest,
} from '../shared/capability-validation.ts'
import { CapabilityError } from '../shared/capability-errors.ts'

export type CapabilityRequesterContext = {
    userId: string
    workspaceId: string
    organizationId?: string
}

export type CapabilityResolverStore = {
    batchGetAuthorizedCatalogRecords: (args: {
        capabilityIds: string[]
        requester: CapabilityRequesterContext
        signal?: AbortSignal
    }) => Promise<ReadonlyMap<string, CapabilityCatalogRecord>>
    readManifest: (args: {
        record: CapabilityCatalogRecord
        requester: CapabilityRequesterContext
        signal?: AbortSignal
    }) => Promise<Uint8Array>
    readResource: (args: {
        record: CapabilityCatalogRecord
        resource: CapabilityResourceRef
        requester: CapabilityRequesterContext
        signal?: AbortSignal
    }) => Promise<Uint8Array>
}

export type LoadedCapabilityResource = {
    capabilityId: string
    ref: CapabilityResourceRef
    bytes: Uint8Array
}

export class SealedResolvedCapabilityPlan {
    readonly serializable: ResolvedCapabilityPlan
    private readonly resourcesByKey: ReadonlyMap<string, LoadedCapabilityResource>

    constructor(
        serializable: ResolvedCapabilityPlan,
        resources: LoadedCapabilityResource[],
    ) {
        this.serializable = deepFreeze(
            structuredClone(serializable),
        )
        this.resourcesByKey = new Map(
            resources.map(
                resource => [
                    resourceKey(resource.capabilityId, resource.ref.resourceId),
                    Object.freeze({
                        ...resource,
                        ref: Object.freeze({ ...resource.ref }),
                        bytes: resource.bytes.slice(),
                    }),
                ],
            ),
        )
        Object.freeze(this)
    }

    getResource(
        capabilityId: string,
        resourceId: string,
    ): LoadedCapabilityResource | undefined {
        const resource = this.resourcesByKey.get(
            resourceKey(capabilityId, resourceId),
        )

        return resource ? {
            ...resource,
            bytes: resource.bytes.slice(),
        } : undefined
    }

    getManifest(capabilityId: string): ResolvedCapability | undefined {
        return this.serializable.capabilities.find(capability => capability.capabilityId === capabilityId)
    }
}

export type ResolveCapabilitiesOptions = {
    store: CapabilityResolverStore
    requester: CapabilityRequesterContext
    allowedActions?: ReadonlySet<string>
    signal?: AbortSignal
    maxResolvedCapabilities?: number
    maxResources?: number
    maxDependencyDepth?: number
    maxAggregateResourceBytes?: number
    maxAggregateTextResourceBytes?: number
}

type PendingCapability = {
    capabilityId: string
    expectedKind: CapabilityPromptReference['kind']
    depth: number
}

export const resolveCapabilities = async (
    references: readonly CapabilityPromptReference[],
    options: ResolveCapabilitiesOptions,
): Promise<SealedResolvedCapabilityPlan> => {
    throwIfAborted(options.signal)
    const roots = deduplicateReferences(references)

    if (roots.length === 0) {
        return new SealedResolvedCapabilityPlan(
            {
                rootCapabilityIds: [],
                capabilities: [],
                resolvedManifests: [],
            },
            [],
        )
    }

    const maxResolvedCapabilities = options.maxResolvedCapabilities ?? CAPABILITY_LIMITS.maxResolvedCapabilities
    const maxResources = options.maxResources ?? CAPABILITY_LIMITS.maxResources
    const maxDependencyDepth = options.maxDependencyDepth ?? CAPABILITY_LIMITS.maxDependencyDepth
    const maxAggregateResourceBytes = options.maxAggregateResourceBytes
        ?? CAPABILITY_LIMITS.maxAggregateResourceBytes
    const maxAggregateTextResourceBytes = options.maxAggregateTextResourceBytes
        ?? CAPABILITY_LIMITS.maxAggregateTextResourceBytes
    const resolvedById = new Map<string, ResolvedCapability>()
    const catalogById = new Map<string, CapabilityCatalogRecord>()
    const orderedIds: string[] = []
    const queuedIds = new Set(
        roots.map(reference => reference.capabilityId),
    )
    let frontier: PendingCapability[] = roots.map(
        reference => ({
            capabilityId: reference.capabilityId,
            expectedKind: reference.kind,
            depth: 0,
        }),
    )

    while (frontier.length > 0) {
        throwIfAborted(options.signal)

        if (resolvedById.size + frontier.length > maxResolvedCapabilities) {
            throw new CapabilityError(
                'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED',
                `Capability closure exceeds the ${maxResolvedCapabilities} Capability limit`,
            )
        }

        const records = await options.store.batchGetAuthorizedCatalogRecords({
            capabilityIds: frontier.map(item => item.capabilityId),
            requester: options.requester,
            signal: options.signal,
        })
        const nextFrontier: PendingCapability[] = []

        for (const pending of frontier) {
            const record = records.get(pending.capabilityId)

            if (
                !record
                || record.status !== 'active'
            )
                throw inaccessibleCapabilityError(pending.capabilityId)

            if (record.kind !== pending.expectedKind)
                throw new CapabilityError('CAPABILITY_MANIFEST_INVALID', `Capability ${pending.capabilityId} does not match its declared kind`)

            const manifestBytes = await options.store.readManifest({
                record,
                requester: options.requester,
                signal: options.signal,
            })
            verifyHash(
                manifestBytes,
                record.manifestBlobHash,
                'CAPABILITY_MANIFEST_INTEGRITY_FAILED',
                pending.capabilityId,
            )
            const manifest = parseManifest(manifestBytes, pending.capabilityId)
            const validation = validateCapabilityManifest(manifest, { allowedActions: options.allowedActions })

            if (!validation.valid) {
                throw new CapabilityError(
                    'CAPABILITY_MANIFEST_INVALID',
                    `Capability ${pending.capabilityId} has an invalid manifest`,
                    { issues: validation.issues },
                )
            }

            if (
                validation.manifest.capabilityId !== record.capabilityId
                || validation.manifest.kind !== record.kind
            ) {
                throw new CapabilityError(
                    'CAPABILITY_MANIFEST_INVALID',
                    `Capability ${pending.capabilityId} manifest identity does not match its catalog record`,
                )
            }

            resolvedById.set(
                pending.capabilityId,
                {
                    capabilityId: pending.capabilityId,
                    kind: record.kind,
                    manifestBlobHash: record.manifestBlobHash,
                    manifest: validation.manifest,
                },
            )
            catalogById.set(pending.capabilityId, record)
            orderedIds.push(pending.capabilityId)

            for (const reference of validation.manifest.references) {
                if (
                    resolvedById.has(reference.capabilityId)
                    || queuedIds.has(reference.capabilityId)
                )
                    continue

                const depth = pending.depth + 1

                if (depth > maxDependencyDepth) {
                    throw new CapabilityError(
                        'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED',
                        `Capability dependency depth exceeds the ${maxDependencyDepth} level limit`,
                    )
                }

                queuedIds.add(reference.capabilityId)
                nextFrontier.push({
                    capabilityId: reference.capabilityId,
                    expectedKind: reference.kind,
                    depth,
                })
            }
        }

        frontier = nextFrontier
    }

    const capabilities = orderedIds.map(capabilityId => resolvedById.get(capabilityId)!)
    const graphIssues = validateCapabilityDependencyGraph(
        capabilities.map(capability => capability.manifest),
        {
            rootCapabilityIds: roots.map(reference => reference.capabilityId),
            maxDependencyDepth,
            maxResolvedCapabilities,
            maxResources,
        },
    )

    if (graphIssues.length > 0) {
        throw new CapabilityError(
            graphIssues.some(issue => issue.code === 'LIMIT_EXCEEDED')
                ? 'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED'
                : 'CAPABILITY_MANIFEST_INVALID',
            'Capability dependency graph is invalid',
            { issues: graphIssues },
        )
    }

    const resourceRequests = capabilities.flatMap(
        capability =>
            capability.manifest.resources.map(
                ref => ({
                    capabilityId: capability.capabilityId,
                    record: catalogById.get(capability.capabilityId)!,
                    ref,
                }),
            ),
    )

    if (resourceRequests.length > maxResources)
        throw new CapabilityError('CAPABILITY_RESOLUTION_LIMIT_EXCEEDED', `Capability closure exceeds the ${maxResources} resource limit`)

    const resources = await Promise.all(
        resourceRequests.map(async request => {
            throwIfAborted(options.signal)
            const bytes = await options.store.readResource({
                record: request.record,
                resource: request.ref,
                requester: options.requester,
                signal: options.signal,
            })
            verifyHash(
                bytes,
                request.ref.blobHash,
                'CAPABILITY_RESOURCE_INTEGRITY_FAILED',
                `${request.capabilityId}/${request.ref.resourceId}`,
            )

            return {
                capabilityId: request.capabilityId,
                ref: request.ref,
                bytes,
            }
        }),
    )
    const aggregateResourceBytes = resources.reduce((total, resource) => total + resource.bytes.byteLength, 0)

    if (aggregateResourceBytes > maxAggregateResourceBytes) {
        throw new CapabilityError(
            'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED',
            `Capability resources exceed the ${maxAggregateResourceBytes} byte aggregate limit`,
        )
    }

    const aggregateTextResourceBytes = resources.reduce(
        (total, resource) => (isTextResource(resource.ref.mediaType) ? total + resource.bytes.byteLength : total),
        0,
    )

    if (aggregateTextResourceBytes > maxAggregateTextResourceBytes) {
        throw new CapabilityError(
            'CAPABILITY_RESOLUTION_LIMIT_EXCEEDED',
            `Capability text resources exceed the ${maxAggregateTextResourceBytes} byte aggregate limit`,
        )
    }

    return new SealedResolvedCapabilityPlan(
        {
            rootCapabilityIds: roots.map(reference => reference.capabilityId),
            capabilities,
            resolvedManifests: capabilities.map(
                capability => ({
                    capabilityId: capability.capabilityId,
                    manifestBlobHash: capability.manifestBlobHash,
                }),
            ),
        },
        resources,
    )
}

function isTextResource(mediaType: CapabilityResourceRef['mediaType']): boolean {
    return mediaType === 'text/markdown'
        || mediaType === 'application/json'
        || mediaType === 'application/schema+json'
}

function deduplicateReferences(references: readonly CapabilityPromptReference[]): CapabilityPromptReference[] {
    const byId = new Map<string, CapabilityPromptReference>()

    for (const reference of references) {
        const existing = byId.get(reference.capabilityId)

        if (
            existing
            && existing.kind !== reference.kind
        )
            throw new CapabilityError('CAPABILITY_MANIFEST_INVALID', `Capability ${reference.capabilityId} is referenced with conflicting kinds`)

        if (!existing)
            byId.set(reference.capabilityId, { ...reference })
    }

    return [...byId.values()]
}

function parseManifest(
    bytes: Uint8Array,
    capabilityId: string,
): unknown {
    try {
        return JSON.parse(
            new TextDecoder().decode(bytes),
        )
    } catch (error) {
        throw new CapabilityError(
            'CAPABILITY_MANIFEST_INVALID',
            `Capability ${capabilityId} manifest is not valid JSON`,
            {},
            { cause: error },
        )
    }
}

function verifyHash(
    bytes: Uint8Array,
    expectedHash: string,
    code: 'CAPABILITY_MANIFEST_INTEGRITY_FAILED' | 'CAPABILITY_RESOURCE_INTEGRITY_FAILED',
    subject: string,
): void {
    const expected = expectedHash.startsWith('sha256:') ? expectedHash.slice(7) : expectedHash
    const actual = createHash('sha256').update(bytes).digest('hex')

    if (
        !/^[a-f0-9]{64}$/i.test(expected)
        || actual.toLowerCase() !== expected.toLowerCase()
    )
        throw new CapabilityError(code, `Integrity verification failed for ${subject}`)
}

function resourceKey(
    capabilityId: string,
    resourceId: string,
): string {
    return `${capabilityId}\u0000${resourceId}`
}

function inaccessibleCapabilityError(capabilityId: string): CapabilityError {
    return new CapabilityError('CAPABILITY_NOT_FOUND_OR_FORBIDDEN', `Capability ${capabilityId} was not found or is not accessible`)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted)
        throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function deepFreeze<T>(value: T): T {
    if (
        !value
        || typeof value !== 'object'
        || Object.isFrozen(value)
    )
        return value

    Object.freeze(value)

    for (const child of Object.values(value))
        deepFreeze(child)

    return value
}
