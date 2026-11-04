import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type ProviderUsageClient } from '@lixpi/usage-reporter'
import { type MediaPipelineOperationRequest } from '@lixpi/capability-system/backend'
import { StabilityPipelineExecutor } from './stability-pipeline-executor.ts'
import { AgentExecutionScope, type AgentExecution } from '../llm/agent/agent-execution-scope.ts'
import { createConversationExecutionFixture } from '../llm/agent/conversation-test-support.ts'

const mocks = vi.hoisted(() => ({
    invoke: vi.fn(),
    model: vi.fn(),
    prepareCreate: vi.fn(),
    publish: vi.fn(),
    enqueue: vi.fn(),
}))
vi.mock('../llm/providers/stability-bedrock-call.ts', () => ({ StabilityBedrockCall: class { invoke = mocks.invoke } }))
vi.mock('../llm/providers/bedrock-inference.ts', () => ({ bedrockInference: {
    isEnabledFor: () => true,
    resolveModelId: async () => 'bedrock-model',
} }))
vi.mock('../models/ai-model.ts', () => ({ default: {
    getAiModel: mocks.model,
    getAvailableAiModels: async () => ({ models: [] }),
} }))
vi.mock('../models/asset.ts', () => ({
    default: { prepareCreate: mocks.prepareCreate },
    publishAssetEvent: mocks.publish,
}))
vi.mock('../models/blob.ts', () => ({ default: { store: async input => ({
    blobHash: createHash('sha256').update(input.bytes).digest('hex'),
    byteSize: input.bytes.byteLength,
}) } }))
vi.mock('../services/asset-maintenance-queue.ts', () => ({ enqueueRenditionRetry: mocks.enqueue }))
vi.mock('../services/account-request-context.ts', () => ({ AccountRequestContext: {
    assertActive: () => {},
    prepareCleanup: callback => callback,
} }))

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4VQAAAAASUVORK5CYII='
const fixture = async () => {
    const test = await createConversationExecutionFixture()
    const scope: AgentExecution = {
        owner: test.owner,
        turn: test.turn,
        intent: {
            intent: 'execute',
            operationFamilies: ['image'],
            targetAssetIds: [],
            confidence: 1,
            needsClarification: false,
        },
        responseMessageId: 'response',
        continuationEpoch: 0,
        createdAssetIds: new Set(),
    }
    const request: MediaPipelineOperationRequest = {
        operationId: 'image-operation',
        inputHash: 'input-hash',
        executionId: 'execution',
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
            epoch: test.owner.epoch,
            continuationEpoch: 0,
            authority: 'scope',
        },
        node: {
            nodeId: 'image',
            operationKey: 'image.generate',
            modelId: 'Stability:stability-ultra',
            parameters: {
                prompt: 'A red sphere.',
                imageSize: '1:1',
            },
            inputs: [],
            outputs: [{
                portId: 'image',
                kind: 'image',
                required: true,
            }],
        },
        inputs: {},
        inferenceProvider: 'aws-bedrock',
    }
    const metrics = {
        enabled: true,
        authorizeRequest: vi.fn(async () => ({
            authorized: true,
            authorizationId: 'authorization',
        })),
        recordUsage: vi.fn(async () => {}),
        completeRequest: vi.fn(async () => {}),
    }
    mocks.invoke.mockResolvedValue({
        imageBase64: png,
        seed: 42,
        providerRequestId: 'provider-request',
        filtered: false,
    })
    mocks.model.mockResolvedValue({
        provider: 'Stability',
        model: 'stability-ultra',
        modelVersion: 'stability-ultra-version',
        inferenceProviderCalledByThePlatform: 'aws-bedrock',
        imagePromptMaxChars: 10000,
        imageSizes: [{ value: '1:1' }],
        inferenceProviders: { 'aws-bedrock': { pricing: {
            currency: 'USD',
            image: {
                measuringUnit: 'images',
                pricePer: '1',
                prompt: '0',
                completion: '0.14',
            },
        } } },
    })
    mocks.prepareCreate.mockImplementation(async asset => ({
        asset: {
            ...asset,
            revision: 1,
        },
        operations: [test.repository.put('ASSETS', asset.assetId, asset)],
    }))
    const handler = new StabilityPipelineExecutor(test.repository, metrics as unknown as ProviderUsageClient).handler()

    return {
        ...test,
        scope,
        request,
        metrics,
        handler,
    }
}
beforeEach(() => vi.resetAllMocks())

describe('durable Stability pipeline executor', () => {
    it('rejects silently changed image preferences before authorization or provider work', async () => {
        const f = await fixture()
        f.scope.turn.settings.models.imageModelIds = ['Stability:other']
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.handler.ensure(f.request)).rejects.toThrow('PIPELINE_IMAGE_MODEL_NOT_SELECTED')
            f.scope.turn.settings.models.imageModelIds = []
            f.scope.turn.settings.models.imageOptions = { imageSize: '16:9' }
            await expect(f.handler.ensure(f.request)).rejects.toThrow('PIPELINE_IMAGE_PREFERENCE_CONFLICT')
            f.scope.turn.settings.models.imageOptions = {
                imageSize: 'auto',
                configGroups: [{
                    groupId: 'image',
                    modelIds: [f.request.node.modelId!],
                    values: { quality: 'high' },
                }],
            }
            await expect(f.handler.ensure(f.request)).rejects.toThrow('PIPELINE_IMAGE_CONTROL_UNSUPPORTED:quality')
        })
        expect(f.metrics.authorizeRequest).not.toHaveBeenCalled()
        expect(mocks.invoke).not.toHaveBeenCalled()
    })
    it('commits one output slot and replays without another provider call', async () => {
        const f = await fixture()
        f.request.sourceSnapshots = [{
            sourceId: 'brief',
            assetId: 'source-brief',
            kind: 'text',
            revision: 2,
            documentVersion: 2,
            blobHash: 'source-hash',
        }]
        await AgentExecutionScope.run(f.scope, async () => {
            const first = await f.handler.ensure(f.request)
            expect(first.state).toBe('succeeded')
            expect(await f.handler.ensure(f.request)).toEqual(first)
            expect(first.outputs.image.blobHash).toHaveLength(64)
        })
        expect(mocks.invoke).toHaveBeenCalledTimes(1)
        expect(mocks.prepareCreate).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(mocks.prepareCreate.mock.calls[0])).toContain('source-brief')
        const operation = await f.repository.read<{ sources: unknown[] }>(f.owner.partition, 'OPERATION#image-operation')
        expect(operation?.sources).toEqual([expect.objectContaining({
            assetId: 'source-brief',
            role: 'content',
            documentVersion: 2,
        })])
        expect(f.metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({
            model: 'stability-ultra-version',
            providerRequestId: 'provider-request',
            usage: { imageCount: 1 },
        }))
        expect(f.metrics.authorizeRequest).toHaveBeenCalledWith(expect.objectContaining({ model: 'stability-ultra-version' }))
        expect(operation).toMatchObject({
            modelId: 'Stability:stability-ultra',
            providerModelVersion: 'stability-ultra-version',
        })
        const events = [...f.database.rows.values()].filter(row => String(row.sk).startsWith('EVENT#'))
        expect(JSON.stringify(events)).not.toContain('imageBase64')
        expect(JSON.stringify(events)).not.toContain('inline')
    })

    it('records an unknown outcome and never repeats a disconnected request', async () => {
        const f = await fixture()
        mocks.invoke.mockRejectedValue(new Error('SOCKET_CLOSED'))
        await AgentExecutionScope.run(f.scope, async () => {
            expect((await f.handler.ensure(f.request)).state).toBe('outcome-unknown')
            expect((await f.handler.ensure(f.request)).state).toBe('outcome-unknown')
        })
        expect(mocks.invoke).toHaveBeenCalledTimes(1)
        expect(f.metrics.recordUsage).not.toHaveBeenCalled()
        expect(mocks.prepareCreate).not.toHaveBeenCalled()
    })

    it('keeps the authorized provider model version when the registry changes before submission', async () => {
        const f = await fixture()
        f.database.beforeCommit = operations => {
            if (operations.some(operation => operation.type === 'put'
                && operation.item.sk === 'OPERATION#image-operation'
                && operation.item.state === 'submitted'))
                throw new Error('PROCESS_STOPPED_BEFORE_SUBMISSION')
        }
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.handler.ensure(f.request)).rejects.toThrow('PROCESS_STOPPED_BEFORE_SUBMISSION')
            expect(mocks.invoke).not.toHaveBeenCalled()
            f.database.beforeCommit = undefined
            mocks.model.mockResolvedValue({
                ...await mocks.model(),
                modelVersion: 'stability-ultra-updated',
            })
            expect((await f.handler.ensure(f.request)).state).toBe('succeeded')
        })
        expect(f.metrics.authorizeRequest).toHaveBeenCalledTimes(1)
        expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ modelVersion: 'stability-ultra-version' }), expect.any(AbortSignal))
        expect(f.metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'stability-ultra-version' }))
    })

    it('recovers a saved provider result after output storage fails', async () => {
        const f = await fixture()
        mocks.prepareCreate.mockRejectedValueOnce(new Error('STORAGE_INTERRUPTED'))
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.handler.ensure(f.request)).rejects.toThrow('STORAGE_INTERRUPTED')
            expect((await f.handler.ensure(f.request)).state).toBe('succeeded')
        })
        expect(mocks.invoke).toHaveBeenCalledTimes(1)
        expect(f.metrics.completeRequest).toHaveBeenCalled()
    })

    it('settles a known provider rejection with zero images', async () => {
        const f = await fixture()
        mocks.invoke.mockRejectedValue({ $metadata: { httpStatusCode: 400 } })
        await AgentExecutionScope.run(f.scope, async () => expect((await f.handler.ensure(f.request)).state).toBe('failed'))
        expect(f.metrics.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: { imageCount: 0 } }))
    })

    it('refuses a direct route and an ungranted intent before authorization', async () => {
        const f = await fixture()
        mocks.model.mockResolvedValue({ inferenceProviderCalledByThePlatform: 'stability' })
        await AgentExecutionScope.run(f.scope, async () => await expect(f.handler.ensure(f.request)).rejects.toThrow('STABILITY_PIPELINE_ROUTE_UNAVAILABLE'))
        await AgentExecutionScope.run({
            ...f.scope,
            intent: {
                ...f.scope.intent,
                intent: 'chat',
            },
        }, async () => await expect(f.handler.ensure(f.request)).rejects.toThrow('AGENT_INTENT_DOES_NOT_AUTHORIZE_OPERATION'))
        expect(f.metrics.authorizeRequest).not.toHaveBeenCalled()
        expect(mocks.invoke).not.toHaveBeenCalled()
    })
})
