import { describe, expect, it } from 'vitest'

import { type MediaSequence, type SequenceRevision } from '../shared/media-sequence.ts'
import { sequenceFixture } from '../shared/sequence-fixture.ts'
import { type MediaPipelineOperationRequest } from '../../media-pipeline/backend/media-pipeline-ports.ts'
import { MediaSequenceService, type MediaSequenceReceipt } from './media-sequence-service.ts'
import { MediaSequencePipelineOperations } from './media-sequence-pipeline.ts'

describe('MediaSequencePipelineOperations', () => {
    it('recovers a create and patch after a lost receipt without creating another sequence revision', async () => {
        const snapshots = new Map<string, Map<number, MediaSequence>>()
        const revisions: SequenceRevision[] = []
        const receipts = new Map<string, MediaSequenceReceipt>()
        const service = new MediaSequenceService({
            authorize: async () => {},
            load: async (_, id, revision) => {
                const versions = snapshots.get(id)

                return structuredClone(versions?.get(revision ?? Math.max(...versions.keys())))
            },
            readMutation: async (_, __, id) => receipts.get(id),
            listRevisions: async (_, id, after) => revisions.filter(item => item.sequenceId === id && item.revision > after),
            resolveSource: async (_, source) => source,
            commit: async (_, request) => {
                const versions = snapshots.get(request.sequence.sequenceId) ?? new Map<number, MediaSequence>()

                if ((versions.size ? Math.max(...versions.keys()) : 0) !== request.expectedRevision)
                    return false

                versions.set(request.sequence.revision, structuredClone(request.sequence))
                snapshots.set(request.sequence.sequenceId, versions)
                revisions.push(request.revision)
                receipts.set(request.revision.clientMutationId, {
                    requestHash: request.revision.requestHash,
                    sequence: request.sequence,
                    revision: request.revision,
                })

                return true
            },
            now: () => '2026-10-24T00:00:00Z',
        })
        const source = sequenceFixture().sources[0]
        const handler = new MediaSequencePipelineOperations(service, {
            resolvePipelineMediaSource: async (_, __, sourceId) => ({
                ...source,
                sourceId,
            }),
            resolvePipelineSource: async (_, input) => ({
                sourceId: input.assetId,
                assetId: input.assetId,
                kind: 'sequence',
                revision: input.revision,
                documentVersion: input.revision,
            }),
        }).handlers().find(item => item.definition.operationKey === 'sequence.create')!
        const request: MediaPipelineOperationRequest = {
            operationId: 'operation',
            inputHash: 'input',
            executionId: 'execution',
            pipelineId: 'pipeline',
            pipelineRevision: 1,
            context: {
                userId: 'user',
                organizationId: 'organization',
                workspaceId: 'workspace',
                conversationAssetId: 'conversation',
                turnId: 'turn',
                responseMessageId: 'response',
                runId: 'run',
                epoch: 1,
                continuationEpoch: 1,
                authority: 'authority',
            },
            inputs: { video: {
                sourceId: 'input',
                assetId: source.assetId,
                kind: 'video',
                revision: 1,
                blobHash: source.blobHash,
                renditionId: source.renditionId,
            } },
            node: {
                nodeId: 'create',
                operationKey: 'sequence.create',
                inputs: handler.definition.inputPorts,
                outputs: handler.definition.outputPorts,
                parameters: {
                    name: 'Cut',
                    sourceBindings: [{
                        inputPort: 'video',
                        sourceId: 'source',
                    }],
                    operations: [{
                        op: 'add-track',
                        track: sequenceFixture().tracks[0],
                    }, {
                        op: 'insert-clip',
                        clip: sequenceFixture().clips[0],
                    }],
                },
            },
        }
        const first = await handler.ensure(request)
        const duplicate = await handler.ensure(request)
        expect(first.state).toBe('succeeded')
        expect(duplicate).toEqual(first)
        expect(first.outputs.sequence.revision).toBe(2)
        expect(revisions).toHaveLength(2)
        expect(snapshots.size).toBe(1)
        expect([...snapshots.values()][0].get(2)?.clips).toHaveLength(1)
    })
})
