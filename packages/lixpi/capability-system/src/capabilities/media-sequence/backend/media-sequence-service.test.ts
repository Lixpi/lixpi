import { describe, expect, it, vi } from 'vitest'

import { type MediaSequence, type SequenceRevision } from '../shared/media-sequence.ts'
import { sequenceFixture } from '../shared/sequence-fixture.ts'
import {
    createMediaSequenceDocument,
    mediaSequenceArtifactDefinition,
    readMediaSequenceDocument,
} from '../shared/media-sequence-artifact.ts'
import { MediaSequenceService, type MediaSequenceAccess, type MediaSequencePorts, type MediaSequenceReceipt } from './media-sequence-service.ts'

const harness = () => {
    const documents = new Map<number, MediaSequence>([[1, sequenceFixture()]])
    const history: SequenceRevision[] = []
    const receipts = new Map<string, MediaSequenceReceipt>()
    const ports: MediaSequencePorts = {
        authorize: async () => {},
        load: async (_, __, revision) => structuredClone(documents.get(revision ?? Math.max(...documents.keys()))),
        readMutation: async (_, __, id) => receipts.get(id),
        listRevisions: async (_, __, after) => history.filter(revision => revision.revision > after),
        resolveSource: async (_, source) => source,
        commit: async (_, input) => {
            if (
                Math.max(...documents.keys()) !== input.expectedRevision
                || receipts.has(input.revision.clientMutationId)
            )
                return false

            const schema = mediaSequenceArtifactDefinition.createDocumentSchema()
            const document = schema.nodeFromJSON(createMediaSequenceDocument(input.sequence))
            document.check()
            documents.set(input.sequence.revision, readMediaSequenceDocument(document.toJSON()))
            history.push(structuredClone(input.revision))
            receipts.set(input.revision.clientMutationId, {
                requestHash: input.revision.requestHash,
                sequence: input.sequence,
                revision: input.revision,
            })

            return true
        },
        now: () => '2026-10-24T00:00:00Z',
    }
    const access = (id: string): MediaSequenceAccess => ({
        userId: 'user',
        organizationId: 'organization',
        workspaceId: 'workspace',
        origin: {
            kind: 'manual',
            userId: 'user',
            clientMutationId: id,
        },
    })

    return {
        ports,
        access,
        history,
        service: new MediaSequenceService(ports),
    }
}

// =============================================================================
// REVISION AUTHORITY, IDEMPOTENCY AND HISTORY
// =============================================================================

describe('MediaSequenceService', () => {
    it('persists an added video track through the production ProseMirror schema', async () => {
        const {
            service,
            access,
        } = harness()
        const result = await service.patch(access('add-video-track'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'add-video-track',
            operations: [{
                op: 'add-track',
                track: {
                    trackId: 'video-track',
                    kind: 'video',
                    name: 'Video',
                    muted: false,
                    locked: false,
                    visible: true,
                    solo: false,
                },
            }],
        })
        expect(result.status).toBe('committed')
        expect((await service.get(access('read'), 'sequence')).tracks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                trackId: 'video-track',
                kind: 'video',
            }),
        ]))
        const emptyDocument = mediaSequenceArtifactDefinition.createDocumentSchema().topNodeType.createAndFill()!
        expect(() => mediaSequenceArtifactDefinition.assertInitialDocument(emptyDocument.toJSON())).toThrow()
    })
    it('loads an exact historical snapshot only after current source Artifact read authorization', async () => {
        const {
            service,
            ports,
            access,
        } = harness()
        const authorize = vi.fn(ports.authorize)
        const load = vi.fn(ports.load)
        ports.authorize = authorize
        ports.load = load
        expect((await service.get(access('read'), 'sequence', 1)).revision).toBe(1)
        expect(authorize).toHaveBeenCalledWith(access('read'), 'sequence', 'read')
        expect(load).toHaveBeenCalledWith(access('read'), 'sequence', 1)
        authorize.mockRejectedValueOnce(new Error('ASSET_ACCESS_DENIED'))
        await expect(service.get(access('read'), 'sequence', 1)).rejects.toThrow('ASSET_ACCESS_DENIED')
        expect(load).toHaveBeenCalledOnce()
    })
    it('restores an accepted removed source after metadata enrichment without rewriting it', async () => {
        const {
            service,
            access,
            ports,
        } = harness()
        await service.patch(access('remove'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'remove',
            operations: [{
                op: 'remove-clip',
                clipId: 'clip',
            }, {
                op: 'remove-source',
                sourceId: 'source',
            }],
        })
        ports.resolveSource = async (_, source) => ({
            ...source,
            channels: 2,
        })
        const restored = await service.restore(access('restore'), {
            sequenceId: 'sequence',
            baseRevision: 2,
            clientMutationId: 'restore',
            action: 'undo',
            revision: 2,
        })
        expect(restored.status).toBe('committed')
        expect(restored.sequence.sources).toEqual(sequenceFixture().sources)
        expect(restored.sequence.clips).toEqual(sequenceFixture().clips)
    })
    it('keeps accepted source metadata immutable when a later probe enriches the same Blob', async () => {
        const {
            service,
            access,
            ports,
        } = harness()
        ports.resolveSource = async (_, source) => ({
            ...source,
            channels: 2,
            hasAudio: true,
        })
        const result = await service.patch(access('probe'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'probe',
            operations: [{
                op: 'set-properties',
                values: { name: 'Keep snapshot timing' },
            }],
        })
        expect(result.status).toBe('committed')
        expect(result.sequence.sources).toEqual(sequenceFixture().sources)
        ports.resolveSource = async (_, source) => ({
            ...source,
            blobHash: 'b'.repeat(64),
        })
        await expect(service.patch(access('changed'), {
            sequenceId: 'sequence',
            baseRevision: 2,
            clientMutationId: 'changed',
            operations: [{
                op: 'set-properties',
                values: { name: 'Reject changed bytes' },
            }],
        })).rejects.toThrow('STALE_SOURCE')
    })
    it('rebases disjoint edits and returns changed objects for conflicts', async () => {
        const {
            service,
            access,
        } = harness()
        await service.patch(access('move'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'move',
            operations: [{
                op: 'set-transform',
                clipId: 'clip',
                values: { x: 10 },
            }],
        })
        const independent = await service.patch(access('name'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'name',
            operations: [{
                op: 'set-properties',
                values: { name: 'Edited' },
            }],
        })
        expect(independent).toMatchObject({
            status: 'committed',
            rebased: true,
            sequence: {
                revision: 3,
                name: 'Edited',
            },
        })
        const conflict = await service.patch(access('competing'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'competing',
            operations: [{
                op: 'set-transform',
                clipId: 'clip',
                values: { x: 50 },
            }],
        })
        expect(conflict).toMatchObject({
            status: 'conflict',
            changedObjectIds: ['clip:clip'],
            sequence: { revision: 3 },
        })
    })

    it('deduplicates a lost acknowledgement and rejects ID reuse with changed content', async () => {
        const {
            service,
            access,
            history,
        } = harness()
        const request = {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'edit',
            operations: [{
                op: 'set-transform' as const,
                clipId: 'clip',
                values: { x: 10 },
            }],
        }
        await service.patch(access('edit'), request)
        expect(await service.patch(access('edit'), request)).toMatchObject({
            status: 'duplicate',
            sequence: { revision: 2 },
        })
        expect(history).toHaveLength(1)
        await expect(service.patch(access('edit'), {
            ...request,
            operations: [{
                op: 'set-transform',
                clipId: 'clip',
                values: { x: 20 },
            }],
        })).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    })

    it('undoes and redoes as new revisions without discarding unrelated edits', async () => {
        const {
            service,
            access,
        } = harness()
        await service.patch(access('edit'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'edit',
            operations: [{
                op: 'set-transform',
                clipId: 'clip',
                values: { x: 10 },
            }],
        })
        await service.patch(access('rename'), {
            sequenceId: 'sequence',
            baseRevision: 2,
            clientMutationId: 'rename',
            operations: [{
                op: 'set-properties',
                values: { name: 'Keep me' },
            }],
        })
        const undone = await service.restore(access('undo'), {
            sequenceId: 'sequence',
            baseRevision: 3,
            clientMutationId: 'undo',
            action: 'undo',
            revision: 2,
        })
        expect(undone.sequence).toMatchObject({
            revision: 4,
            name: 'Keep me',
            clips: [{ transform: { x: 0 } }],
        })
        const redone = await service.restore(access('redo'), {
            sequenceId: 'sequence',
            baseRevision: 4,
            clientMutationId: 'redo',
            action: 'redo',
            revision: 2,
        })
        expect(redone.sequence).toMatchObject({
            revision: 5,
            name: 'Keep me',
            clips: [{ transform: { x: 10 } }],
        })
    })

    it('rejects a stale authorized rendition before any commit', async () => {
        const {
            service,
            ports,
            access,
            history,
        } = harness()
        ports.resolveSource = async (_, source) => ({
            ...source,
            blobHash: 'b'.repeat(64),
        })
        await expect(service.patch(access('edit'), {
            sequenceId: 'sequence',
            baseRevision: 1,
            clientMutationId: 'edit',
            operations: [{
                op: 'set-transform',
                clipId: 'clip',
                values: { x: 10 },
            }],
        })).rejects.toThrow('STALE_SOURCE')
        expect(history).toHaveLength(0)
    })
})
