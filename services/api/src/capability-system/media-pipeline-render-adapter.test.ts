import { describe, expect, it, vi } from 'vitest'
import { type MediaPipelineOperationRequest, type MediaPipelineSource, type MediaSequenceService } from '@lixpi/capability-system/backend'
import { MediaPipelineRenderAdapter } from './media-pipeline-render-adapter.ts'
import { type MediaRenderAdapter, type MediaRenderHandle } from './media-render-adapter.ts'
import { AgentExecutionScope, type AgentExecution } from '../llm/agent/agent-execution-scope.ts'
import { createConversationExecutionFixture } from '../llm/agent/conversation-test-support.ts'

const fixture = async () => {
    const durable = await createConversationExecutionFixture()
    durable.turn.references = [{
        assetId: 'sequence',
        role: 'artifact',
        revision: 4,
        acquiredBy: 'explicit',
        relationshipPath: [],
    }]
    const scope: AgentExecution = {
        owner: durable.owner,
        turn: durable.turn,
        responseMessageId: 'response',
        continuationEpoch: 0,
        intent: {
            intent: 'execute',
            operationFamilies: ['sequence-export'],
            targetAssetIds: ['sequence'],
            confidence: 1,
            needsClarification: false,
        },
        createdAssetIds: new Set(),
    }
    const handle: MediaRenderHandle = {
        jobId: 'render-job',
        outputAssetId: 'render-output',
        sequenceId: 'sequence',
        sequenceRevision: 4,
        state: 'queued',
        attempt: 0,
    }
    const sequence = { get: vi.fn(async () => ({
        sequenceId: 'sequence',
        revision: 4,
    })) }
    const renders = {
        submit: vi.fn(async () => handle),
        get: vi.fn(async () => handle),
        cancel: vi.fn(async () => {}),
    }
    const resolve = vi.fn(async (_context, assetId): Promise<MediaPipelineSource> => {
        await AgentExecutionScope.assertReadTargets([assetId])

        return {
            sourceId: 'video',
            assetId,
            kind: 'video',
            revision: 1,
            blobHash: 'render-hash',
        }
    })
    const handler = new MediaPipelineRenderAdapter(durable.repository, () => ({
        sequence: sequence as unknown as MediaSequenceService,
        renders: renders as unknown as MediaRenderAdapter,
    }), resolve).handler()
    const request: MediaPipelineOperationRequest = {
        operationId: 'export-operation',
        inputHash: 'export-hash',
        executionId: 'pipeline-execution',
        pipelineId: 'pipeline',
        pipelineRevision: 1,
        context: {
            userId: 'user',
            organizationId: 'org',
            workspaceId: 'workspace',
            conversationAssetId: 'conversation',
            turnId: 'turn',
            responseMessageId: 'response',
            runId: 'run-turn',
            epoch: durable.owner.epoch,
            continuationEpoch: 0,
            authority: 'scope',
        },
        node: {
            nodeId: 'export',
            operationKey: 'sequence.export',
            parameters: { preset: {
                presetId: 'mp4-h264-aac',
                quality: 'standard',
            } },
            inputs: [{
                portId: 'sequence',
                kind: 'sequence',
                required: true,
            }],
            outputs: [{
                portId: 'video',
                kind: 'video',
                required: true,
            }],
        },
        inputs: { sequence: {
            sourceId: 'sequence',
            assetId: 'sequence',
            revision: 4,
            documentVersion: 4,
            kind: 'sequence',
        } },
    }

    return {
        ...durable,
        scope,
        handle,
        sequence,
        renders,
        resolve,
        handler,
        request,
    }
}

describe('pipeline sequence export adapter', () => {
    it('freezes the requested revision, replays the job, and admits its completed output', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.scope, async () => {
            expect(await f.handler.ensure(f.request)).toMatchObject({
                state: 'submitted',
                outputs: {},
            })
            expect(await f.handler.ensure(f.request)).toMatchObject({ state: 'submitted' })
            f.handle.state = 'completed'
            f.scope.createdAssetIds.clear()
            expect(await f.handler.read(f.request.context, f.request.operationId)).toMatchObject({
                state: 'succeeded',
                outputs: { video: { assetId: 'render-output' } },
            })
            await f.handler.cancel!(f.request.context, f.request.operationId)
        })
        expect(f.sequence.get).toHaveBeenCalledWith(expect.anything(), 'sequence', 4)
        expect(f.renders.submit).toHaveBeenCalledTimes(1)
        expect(f.renders.cancel).toHaveBeenCalledWith(f.request.context, 'render-job')
        expect(await f.repository.read(f.owner.partition, 'CREATED#render-output')).toMatchObject({
            assetId: 'render-output',
            runId: 'run-turn',
        })
    })

    it('reuses the render mutation key when submission succeeds before mapping persistence fails', async () => {
        const f = await fixture()
        const commit = f.repository.commit.bind(f.repository)
        vi.spyOn(f.repository, 'commit').mockRejectedValueOnce(new Error('MAPPING_WRITE_INTERRUPTED')).mockImplementation(commit)
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.handler.ensure(f.request)).rejects.toThrow('MAPPING_WRITE_INTERRUPTED')
            expect(await f.handler.ensure(f.request)).toMatchObject({ state: 'submitted' })
            await expect(f.handler.ensure({
                ...f.request,
                inputHash: 'changed-hash',
            })).rejects.toThrow('PIPELINE_RENDER_IDEMPOTENCY_CONFLICT')
        })
        expect(f.renders.submit).toHaveBeenCalledTimes(2)
        expect(f.renders.submit.mock.calls[0][1].clientMutationId).toBe(f.renders.submit.mock.calls[1][1].clientMutationId)
    })

    it('rejects an export outside the accepted operation family before creating a render', async () => {
        const f = await fixture()
        f.scope.intent.operationFamilies = ['image']
        await AgentExecutionScope.run(f.scope, async () => void (await expect(f.handler.ensure(f.request)).rejects.toThrow('AGENT_OPERATION_FAMILY_NOT_AUTHORIZED')))
        expect(f.renders.submit).not.toHaveBeenCalled()
    })
})
