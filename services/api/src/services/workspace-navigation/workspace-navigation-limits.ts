import { Buffer } from 'node:buffer'
import {
    type SaveWorkspaceNavigationRequest,
} from '@lixpi/constants'
import { WorkspaceTreeError } from './workspace-tree-errors.ts'

export type NavigationPersistenceSettings = {
    requestIntervalMs: number
    requestBurst: number
    maxDocumentBytes: number
    maxNodes: number
    maxDepth: number
    maxWorkspaceChanges: number
}

export const nextNavigationAdmission = (
    previous: number | undefined,
    now: number,
    settings: Pick<NavigationPersistenceSettings, 'requestIntervalMs' | 'requestBurst'>,
): {
    nextAt: number
    retryAfterMs: number
} => {
    const nextAt = Math.max(now, previous ?? now)
    const retryAfterMs = Math.max(0, nextAt - (settings.requestBurst - 1) * settings.requestIntervalMs - now)

    return {
        nextAt: nextAt + settings.requestIntervalMs,
        retryAfterMs,
    }
}

// Inspect untrusted JSON iteratively before ProseMirror's recursive parser.
// The value budget also bounds unknown attributes that its schema would drop.
export const assertNavigationRequestBounds = (
    request: SaveWorkspaceNavigationRequest,
    settings: NavigationPersistenceSettings,
): void => {
    const invalid = (): never => {
        throw new WorkspaceTreeError('WORKSPACE_NAVIGATION_INVALID')
    }
    const identity = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 200

    if (
        !request
        || !identity(request.organizationId)
        || !identity(request.mutationId)
        || !Number.isSafeInteger(request.baseRevision)
        || request.baseRevision < 0
    )
        invalid()

    const changes = [request.createdWorkspaceIds ?? [], request.deletedWorkspaceIds ?? []]

    if (
        changes.some(ids => !Array.isArray(ids) || ids.length > settings.maxWorkspaceChanges || ids.some(id => !identity(id)))
        || changes.reduce((count, ids) => count + ids.length, 0) > settings.maxWorkspaceChanges
    )
        invalid()

    const pending: Array<{
        value: unknown
        depth: number
    }> = [{
        value: request.document,
        depth: 0,
    }]
    const seen = new Set<object>()
    const maxValues = settings.maxNodes * 16
    let values = 0
    let stringBytes = 0

    while (pending.length) {
        const {
            value,
            depth,
        } = pending.pop()!
        values += 1

        if (
            values > maxValues
            || depth > settings.maxDepth * 3
        )
            invalid()

        if (typeof value === 'string') {
            stringBytes += Buffer.byteLength(value)

            if (stringBytes > settings.maxDocumentBytes)
                invalid()
        } else if (
            value !== null
            && typeof value === 'object'
        ) {
            if (seen.has(value))
                invalid()

            seen.add(value)
            const entries = Array.isArray(value) ? value : Object.keys(value)
            const entryCount = entries.length * (Array.isArray(value) ? 1 : 2)

            if (values + pending.length + entryCount > maxValues)
                invalid()

            if (Array.isArray(value)) {
                for (const child of value)
                    pending.push({
                        value: child,
                        depth: depth + 1,
                    })
            } else {
                for (const key of entries as string[]) {
                    pending.push({
                        value: key,
                        depth: depth + 1,
                    })
                    pending.push({
                        value: (value as Record<string, unknown>)[key],
                        depth: depth + 1,
                    })
                }
            }
        } else if (
            value !== null
            && typeof value !== 'boolean'
            && (typeof value !== 'number' || !Number.isFinite(value))
        )
            invalid()
    }

    const nodes: Array<{
        node: unknown
        depth: number
    }> = [{
        node: request.document,
        depth: 1,
    }]
    let count = 0

    while (nodes.length) {
        const {
            node,
            depth,
        } = nodes.pop()!
        count += 1

        if (
            count > settings.maxNodes
            || depth > settings.maxDepth
            || !node
            || typeof node !== 'object'
            || Array.isArray(node)
        )
            invalid()

        const attrs = (node as { attrs?: Record<string, unknown> }).attrs

        if (
            attrs
            && Object.hasOwn(attrs, 'entryId')
            && !identity(attrs.entryId)
        )
            invalid()

        const content = (node as { content?: unknown }).content

        if (content !== undefined) {
            if (!Array.isArray(content))
                invalid()

            for (const child of content as unknown[])
                nodes.push({
                    node: child,
                    depth: depth + 1,
                })
        }
    }

    if (Buffer.byteLength(
        JSON.stringify(request.document),
    ) > settings.maxDocumentBytes)
        invalid()
}
