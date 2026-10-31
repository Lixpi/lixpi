import { createHash } from 'node:crypto'

import {
    createMediaSequence,
    type MediaSequence,
    type SequenceMutationOrigin,
    type SequencePatchRequest,
    type SequencePatchResult,
    type SequenceRevision,
    type SequenceSourceBinding,
} from '../shared/media-sequence.ts'
import {
    SequencePatchEditor,
    type AppliedSequencePatch,
} from '../shared/sequence-patch.ts'
import {
    assertMediaSequence,
    assertSequenceId,
} from '../shared/sequence-validation.ts'
import { assertSequenceInteger } from '../shared/sequence-time.ts'

export type MediaSequenceAccess = {
    userId: string
    organizationId: string
    workspaceId: string
    origin: SequenceMutationOrigin
}

export type MediaSequenceReceipt = {
    requestHash: string
    sequence: MediaSequence
    revision: SequenceRevision
}

export type MediaSequencePorts = {
    authorize: (
        access: MediaSequenceAccess,
        sequenceId: string,
        intent: 'read' | 'create' | 'edit',
    ) => Promise<void>
    load: (
        access: MediaSequenceAccess,
        sequenceId: string,
        revision?: number,
    ) => Promise<MediaSequence | undefined>
    readMutation: (
        access: MediaSequenceAccess,
        sequenceId: string,
        clientMutationId: string,
    ) => Promise<MediaSequenceReceipt | undefined>
    listRevisions: (
        access: MediaSequenceAccess,
        sequenceId: string,
        afterRevision: number,
    ) => Promise<SequenceRevision[]>
    resolveSource: (
        access: MediaSequenceAccess,
        source: SequenceSourceBinding,
    ) => Promise<SequenceSourceBinding>
    // Persist the document, immutable revision, and mutation receipt atomically.
    // A concurrent writer or duplicate receipt must return false without writes.
    commit: (
        access: MediaSequenceAccess,
        input: {
            expectedRevision: number
            sequence: MediaSequence
            revision: SequenceRevision
        },
    ) => Promise<boolean>
    now: () => string
}

const canonical = (value: unknown): string => {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`

    if (
        value
        && typeof value === 'object'
    )
        return `{${Object
            .entries(value)
            .filter(([, child]) => child !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
            .join(',')}}`

    return JSON.stringify(value)
}

export class MediaSequenceService {
    constructor(private readonly ports: MediaSequencePorts) {}

    async get(
        access: MediaSequenceAccess,
        sequenceId: string,
        revision?: number,
    ): Promise<MediaSequence> {
        assertSequenceId(sequenceId)

        if (revision !== undefined)
            assertSequenceInteger(
                revision,
                'REVISION',
                1,
            )

        await this.ports.authorize(
            access,
            sequenceId,
            'read',
        )
        const sequence = await this.ports.load(
            access,
            sequenceId,
            revision,
        )

        if (!sequence)
            throw new Error('MEDIA_SEQUENCE_NOT_FOUND')

        return structuredClone(sequence)
    }

    async history(
        access: MediaSequenceAccess,
        sequenceId: string,
        afterRevision = 0,
    ): Promise<SequenceRevision[]> {
        await this.get(access, sequenceId)
        assertSequenceInteger(afterRevision, 'REVISION')

        return await this.ports.listRevisions(
            access,
            sequenceId,
            afterRevision,
        )
    }

    async create(
        access: MediaSequenceAccess,
        input: {
            sequenceId: string
            name: string
            clientMutationId: string
        },
    ): Promise<SequencePatchResult> {
        assertSequenceId(input.sequenceId)
        assertSequenceId(input.clientMutationId)
        this.assertOrigin(access, input.clientMutationId)
        await this.ports.authorize(
            access,
            input.sequenceId,
            'create',
        )
        const requestHash = this.hash({
            action: 'create',
            ...input,
        })
        const receipt = await this.duplicate(
            access,
            input.sequenceId,
            input.clientMutationId,
            requestHash,
        )

        if (receipt)
            return receipt

        const sequence = createMediaSequence(input.sequenceId, input.name)
        assertMediaSequence(sequence)
        const revision: SequenceRevision = {
            sequenceId: sequence.sequenceId,
            revision: 1,
            baseRevision: 0,
            clientMutationId: input.clientMutationId,
            requestHash,
            origin: structuredClone(access.origin),
            changedObjectIds: ['sequence'],
            readObjectIds: [],
            inverse: [],
            forward: [],
            createdAt: this.ports.now(),
        }

        if (await this.ports.commit(
            access,
            {
                expectedRevision: 0,
                sequence,
                revision,
            },
        ))
            return {
                status: 'committed',
                sequence,
                revision,
                rebased: false,
            }

        const duplicate = await this.duplicate(
            access,
            sequence.sequenceId,
            input.clientMutationId,
            requestHash,
        )

        if (duplicate)
            return duplicate

        throw new Error('MEDIA_SEQUENCE_ALREADY_EXISTS')
    }

    async patch(
        access: MediaSequenceAccess,
        request: SequencePatchRequest,
    ): Promise<SequencePatchResult> {
        this.assertRequest(access, request)
        await this.ports.authorize(
            access,
            request.sequenceId,
            'edit',
        )
        const requestHash = this.hash({
            action: 'patch',
            ...request,
        })
        const duplicate = await this.duplicate(
            access,
            request.sequenceId,
            request.clientMutationId,
            requestHash,
        )

        if (duplicate)
            return duplicate

        const base = await this.get(
            access,
            request.sequenceId,
            request.baseRevision,
        )
        const intended = new SequencePatchEditor(base).apply(request.operations)

        return await this.commitEdit(
            access,
            request,
            requestHash,
            intended,
            latest => new SequencePatchEditor(latest).apply(request.operations),
        )
    }

    async restore(
        access: MediaSequenceAccess,
        request: {
            sequenceId: string
            baseRevision: number
            clientMutationId: string
            action: 'undo' | 'redo'
            revision: number
        },
    ): Promise<SequencePatchResult> {
        this.assertRequest(access, request)
        assertSequenceInteger(
            request.revision,
            'REVISION',
            2,
        )

        if (
            request.action !== 'undo'
            && request.action !== 'redo'
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_HISTORY_ACTION')

        await this.ports.authorize(
            access,
            request.sequenceId,
            'edit',
        )
        const requestHash = this.hash(request)
        const duplicate = await this.duplicate(
            access,
            request.sequenceId,
            request.clientMutationId,
            requestHash,
        )

        if (duplicate)
            return duplicate

        const history = await this.ports.listRevisions(
            access,
            request.sequenceId,
            0,
        )
        const target = history.find(revision => revision.revision === request.revision)

        if (
            !target
            || target.historyAction
            || target.revision > request.baseRevision
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_HISTORY_REVISION')

        const priorAction = history.filter(revision => revision.historyAction?.revision === target.revision).at(-1)

        if (
            (request.action === 'undo' && priorAction?.historyAction?.action === 'undo')
            || (request.action === 'redo' && priorAction?.historyAction?.action !== 'undo')
        )
            throw new Error('MEDIA_SEQUENCE_HISTORY_ALREADY_APPLIED')

        const sinceTarget = history.filter(revision => revision.revision > (priorAction?.revision ?? target.revision))
        const targetObjects = new Set(target.changedObjectIds)
        const changed = sinceTarget.flatMap(revision => revision.changedObjectIds).filter(id => targetObjects.has(id))
        const latest = await this.get(access, request.sequenceId)

        if (changed.length)
            return this.conflict(latest, changed)

        const restores = request.action === 'undo' ? target.inverse : target.forward
        const base = await this.get(
            access,
            request.sequenceId,
            request.baseRevision,
        )
        const intended = new SequencePatchEditor(base).restore(restores)

        return await this.commitEdit(
            access,
            request,
            requestHash,
            intended,
            current => new SequencePatchEditor(current).restore(restores),
            {
                action: request.action,
                revision: target.revision,
            },
        )
    }

    private async commitEdit(
        access: MediaSequenceAccess,
        request: {
            sequenceId: string
            baseRevision: number
            clientMutationId: string
        },
        requestHash: string,
        intended: AppliedSequencePatch,
        apply: (latest: MediaSequence) => AppliedSequencePatch,
        historyAction?: SequenceRevision['historyAction'],
    ): Promise<SequencePatchResult> {
        for (let attempt = 0; attempt < 4; attempt++) {
            const current = await this.get(access, request.sequenceId)

            if (current.revision < request.baseRevision)
                throw new Error('MEDIA_SEQUENCE_FUTURE_REVISION')

            const intervening = await this.ports.listRevisions(
                access,
                request.sequenceId,
                request.baseRevision,
            )
            const touched = new Set([
                ...intended.changedObjectIds,
                ...intended.readObjectIds,
            ])
            const changed = intervening
                .filter(revision => revision.revision <= current.revision)
                .flatMap(revision => revision.changedObjectIds)
                .filter(id => touched.has(id))

            if (changed.length)
                return this.conflict(current, changed)

            const applied = current.revision === request.baseRevision ? intended : apply(current)

            // Source bindings are immutable and resolved under the same workspace
            // authority for manual edits, pipeline output insertion, and agent tools.
            for (const source of applied.sequence.sources) {
                const resolved = await this.ports.resolveSource(access, source)
                const existing = current.sources.find(binding => binding.sourceId === source.sourceId)
                const identity = (binding: SequenceSourceBinding) => ({
                    sourceId: binding.sourceId,
                    assetId: binding.assetId,
                    renditionId: binding.renditionId,
                    blobHash: binding.blobHash,
                    byteSize: binding.byteSize,
                    kind: binding.kind,
                })

                const identityChanged = canonical(
                    identity(resolved),
                ) !== canonical(
                    identity(source),
                )
                const bindingChanged = existing ? canonical(existing) !== canonical(source) : !historyAction && canonical(resolved) !== canonical(source)

                if (
                    identityChanged
                    || bindingChanged
                )
                    throw new Error(`MEDIA_SEQUENCE_STALE_SOURCE:${source.sourceId}`)
            }

            const sequence = {
                ...applied.sequence,
                revision: current.revision + 1,
            }
            const revision: SequenceRevision = {
                sequenceId: sequence.sequenceId,
                revision: sequence.revision,
                baseRevision: request.baseRevision,
                clientMutationId: request.clientMutationId,
                requestHash,
                origin: structuredClone(access.origin),
                changedObjectIds: applied.changedObjectIds,
                readObjectIds: applied.readObjectIds,
                inverse: applied.inverse,
                forward: applied.forward,
                createdAt: this.ports.now(),
                ...(historyAction ? { historyAction } : {}),
            }

            if (await this.ports.commit(
                access,
                {
                    expectedRevision: current.revision,
                    sequence,
                    revision,
                },
            ))
                return {
                    status: 'committed',
                    sequence,
                    revision,
                    rebased: current.revision !== request.baseRevision,
                }

            const duplicate = await this.duplicate(
                access,
                request.sequenceId,
                request.clientMutationId,
                requestHash,
            )

            if (duplicate)
                return duplicate
        }

        return this.conflict(await this.get(access, request.sequenceId), ['sequence'])
    }

    private assertRequest(
        access: MediaSequenceAccess,
        request: {
            sequenceId: string
            baseRevision: number
            clientMutationId: string
        },
    ): void {
        assertSequenceId(request.sequenceId)
        assertSequenceId(request.clientMutationId)
        assertSequenceInteger(
            request.baseRevision,
            'REVISION',
            1,
        )
        this.assertOrigin(access, request.clientMutationId)
    }

    private assertOrigin(
        access: MediaSequenceAccess,
        clientMutationId: string,
    ): void {
        if (
            access.origin.kind === 'manual'
            && (access.origin.userId !== access.userId || access.origin.clientMutationId !== clientMutationId)
        )
            throw new Error('MEDIA_SEQUENCE_INVALID_MUTATION_ORIGIN')
    }

    private hash(value: unknown): string {
        return createHash('sha256').update(
            canonical(value),
        ).digest('hex')
    }

    private async duplicate(
        access: MediaSequenceAccess,
        sequenceId: string,
        clientMutationId: string,
        requestHash: string,
    ): Promise<SequencePatchResult | undefined> {
        const receipt = await this.ports.readMutation(
            access,
            sequenceId,
            clientMutationId,
        )

        if (!receipt)
            return undefined

        if (receipt.requestHash !== requestHash)
            throw new Error('MEDIA_SEQUENCE_IDEMPOTENCY_CONFLICT')

        return {
            status: 'duplicate',
            sequence: structuredClone(receipt.sequence),
            revision: structuredClone(receipt.revision),
            rebased: receipt.revision.baseRevision !== receipt.revision.revision - 1,
        }
    }

    private conflict(
        sequence: MediaSequence,
        changedObjectIds: string[],
    ): SequencePatchResult {
        return {
            status: 'conflict',
            sequence,
            changedObjectIds: [...new Set(changedObjectIds)].sort(),
            message: 'The sequence changed. Reconcile these objects against the latest revision before retrying.',
        }
    }
}
