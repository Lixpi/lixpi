import { describe, expect, it, vi } from 'vitest'

import {
    MEDIA_PIPELINE_SCHEMA_VERSION,
    createMediaPipelineDocument,
    mediaPipelineSharedDefinition,
    readMediaPipelineDocument,
    validateMediaPipeline,
    type MediaPipeline,
    type MediaPipelineNode,
    type MediaPipelineSource,
} from '../shared/media-pipeline.ts'
import { getExecutableMediaPipelineOperations } from './media-pipeline-catalog.ts'
import {
    type MediaPipelineCatalog,
    type MediaPipelineContext,
    type MediaPipelineExecution,
    type MediaPipelineOperationReceipt,
    type MediaPipelinePorts,
    type MediaPipelineStoredArtifact,
} from './media-pipeline-ports.ts'
import { MediaPipelineService, hashMediaPipelineValue } from './media-pipeline-service.ts'
import { expandMediaPipelineMatrix, type MediaPipelineMatrixInput } from './media-pipeline-matrix.ts'

const context: MediaPipelineContext = {
    userId: 'user-1',
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    conversationAssetId: 'conversation-1',
    turnId: 'turn-1',
    responseMessageId: 'response-1',
    runId: 'run-1',
    epoch: 1,
    continuationEpoch: 1,
    authority: 'trusted-scope',
}
const source = (sourceId: string, kind: MediaPipelineSource['kind'] = 'image'): MediaPipelineSource => ({
    sourceId,
    assetId: `asset-${sourceId}`,
    revision: 1,
    kind,
    blobHash: `hash-${sourceId}`,
})
const node = (nodeId: string): MediaPipelineNode => ({
    nodeId,
    operationKey: 'image.transform',
    modelId: 'test-model',
    parameters: { prompt: 'Use the supplied reference.' },
    inputs: [{
        portId: 'reference',
        kind: 'image',
        required: true,
    }],
    outputs: [{
        portId: 'image',
        kind: 'image',
        required: true,
    }],
})
const pipeline = (): MediaPipeline => ({
    schemaVersion: MEDIA_PIPELINE_SCHEMA_VERSION,
    pipelineId: 'pipeline-1',
    revision: 1,
    origin: {
        conversationAssetId: context.conversationAssetId,
        turnId: context.turnId,
    },
    requestedOutcome: 'Produce the requested derived media.',
    constraints: ['Preserve the referenced subject.'],
    sources: [source('reference')],
    nodes: [node('first')],
    edges: [{
        from: { sourceId: 'reference' },
        to: {
            nodeId: 'first',
            portId: 'reference',
        },
    }],
    executionPolicy: {
        maxConcurrency: 2,
        maxFanout: 2,
    },
    outputBindings: [{
        outputId: 'result',
        nodeId: 'first',
        portId: 'image',
    }],
})
const catalog = (): MediaPipelineCatalog => ({
    operations: [{
        operationKey: 'image.transform',
        family: 'image',
        execution: 'inference',
        ready: true,
        inputPorts: node('first').inputs,
        outputPorts: node('first').outputs,
        parameterSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: { prompt: {
                type: 'string',
                minLength: 1,
            } },
        },
    }],
    modelRoutes: [{
        modelId: 'test-model',
        operationKeys: ['image.transform'],
        inputKinds: ['image'],
        outputKinds: ['image'],
        inferenceProviderCalledByThePlatform: 'aws-bedrock',
        adapterReady: true,
        credentialsReady: true,
        regionReady: true,
        pricingReady: true,
    }],
})

class Harness {
    readonly artifacts = new Map<string, MediaPipelineStoredArtifact>()
    readonly mutations = new Map<string, {
        inputHash: string
        artifact: MediaPipelineStoredArtifact
    }>()
    readonly executions = new Map<string, MediaPipelineExecution>()
    readonly receipts = new Map<string, MediaPipelineOperationReceipt>()
    readonly modelCatalog = catalog()
    permitted = true
    current = true
    pending = false
    sourceChanged = false
    readonly ports: MediaPipelinePorts = {
        authorize: vi.fn(async () => this.permitted),
        isContinuationCurrent: vi.fn(async () => this.current),
        catalog: vi.fn(async () => this.modelCatalog),
        recheckSources: vi.fn(async () => this.sourceChanged ? [{
            code: 'SOURCE_CHANGED',
            message: 'The frozen source changed.',
            recoverable: true,
        }] : []),
        readArtifact: vi.fn(async (_context, pipelineId) => this.artifacts.get(pipelineId)),
        readArtifactMutation: vi.fn(async (_context, mutationId) => this.mutations.get(mutationId)),
        commitArtifact: vi.fn(async input => {
            if ((this.artifacts.get(input.pipeline.pipelineId)?.pipeline.revision ?? 0) !== input.expectedRevision)
                throw new Error('REVISION_CONFLICT')

            const artifact = {
                assetId: `artifact-${input.pipeline.pipelineId}`,
                pipeline: input.pipeline,
            }
            this.artifacts.set(input.pipeline.pipelineId, artifact)
            this.mutations.set(input.clientMutationId, {
                inputHash: input.inputHash,
                artifact,
            })

            return artifact
        }),
        createExecution: vi.fn(async execution => {
            if (!this.executions.has(execution.executionId))
                this.executions.set(execution.executionId, structuredClone(execution))

            return this.executions.get(execution.executionId)!
        }),
        readExecution: vi.fn(async id => this.executions.get(id)),
        saveExecution: vi.fn(async (execution, revision) => {
            if (this.executions.get(execution.executionId)?.revision !== revision)
                return false

            this.executions.set(execution.executionId, structuredClone(execution))

            return true
        }),
        readOperation: vi.fn(async (_context, id) => this.receipts.get(id)),
        ensureOperation: vi.fn(async request => {
            if (!this.receipts.has(request.operationId)) {
                this.receipts.set(request.operationId, {
                    operationId: request.operationId,
                    inputHash: request.inputHash,
                    state: this.pending ? 'running' : 'succeeded',
                    outputs: this.pending ? {} : { image: source(request.node.nodeId) },
                })
            }

            return this.receipts.get(request.operationId)!
        }),
        enqueueExecution: vi.fn(async () => {}),
        enqueueContinuation: vi.fn(async () => {}),
    }
    readonly service = new MediaPipelineService(this.ports)

    constructor(plan = pipeline()) {
        this.artifacts.set(plan.pipelineId, {
            assetId: 'artifact-1',
            pipeline: plan,
        })
    }

    async submit(): Promise<string> {
        const result = await this.service.submit(context, {
            pipelineId: 'pipeline-1',
            revision: 1,
            clientSubmissionId: 'submit-1',
        })
        expect(result.status).toBe('pending')

        if (result.status !== 'pending')
            throw new Error('EXPECTED_PENDING')

        return result.operationId
    }

    complete(nodeId: string): void {
        const receipt = [...this.receipts.values()].find(item => item.operationId === [...this.executions.values()][0].receipts[nodeId]?.operationId)!
        this.receipts.set(receipt.operationId, {
            ...receipt,
            state: 'succeeded',
            outputs: { image: source(nodeId) },
        })
    }
}

describe('reviewable pipeline matrices', () => {
    const input = (): MediaPipelineMatrixInput => ({
        baseRevision: 0,
        clientMutationId: 'matrix-draft',
        requestedOutcome: 'Compare two prepared prompts across two selected models.',
        promptVariants: [{
            variantId: 'soft',
            prompt: 'A sphere in soft light.',
        }, {
            variantId: 'hard',
            prompt: 'A sphere in hard light.',
        }],
        imageModelIds: ['model-a', 'model-b'],
        imageSize: '1:1',
        maxConcurrency: 2,
    })

    it('saves all combinations without executing media and preserves stable variant identities', async () => {
        const harness = new Harness()
        const request = input()
        const result = await harness.service.saveMatrix(context, request)
        expect(result.status).toBe('completed')

        if (result.status !== 'completed')
            throw new Error('Expected saved draft')

        expect(result.data.artifact.pipeline.nodes).toHaveLength(4)
        expect(result.data.artifact.pipeline.outputBindings).toHaveLength(4)
        expect(result.data.gaps.length).toBeGreaterThan(0)
        expect(harness.ports.ensureOperation).not.toHaveBeenCalled()
        const reordered = expandMediaPipelineMatrix({
            ...request,
            imageModelIds: [...request.imageModelIds].reverse(),
            promptVariants: [...request.promptVariants].reverse(),
        })
        expect(reordered.nodes!.map(node => node.nodeId).sort()).toEqual(result.data.artifact.pipeline.nodes.map(node => node.nodeId).sort())
        expect(await harness.service.saveMatrix(context, request)).toEqual(result)
    })

    it('preserves frozen sources and constraints when revising a matrix', async () => {
        const harness = new Harness()
        harness.artifacts.set('pipeline-1', {
            assetId: 'pipeline-1',
            pipeline: pipeline(),
        })
        const result = await harness.service.saveMatrix(context, {
            ...input(),
            pipelineId: 'pipeline-1',
            baseRevision: 1,
        })
        expect(result).toMatchObject({
            status: 'completed',
            data: { artifact: { pipeline: {
                revision: 2,
                sources: pipeline().sources,
                constraints: pipeline().constraints,
            } } },
        })
    })

    it('rejects duplicate variants, excessive fanout and unknown fields before persistence', async () => {
        const harness = new Harness()
        const request = input()
        expect(await harness.service.saveMatrix(context, {
            ...request,
            promptVariants: [request.promptVariants[0], request.promptVariants[0]],
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_MATRIX_VARIANT_ID_DUPLICATE' },
        })
        expect(await harness.service.saveMatrix(context, {
            ...request,
            imageModelIds: Array.from({ length: 17 }, (_, index) => `model-${index}`),
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_MATRIX_FANOUT_EXCEEDED' },
        })
        expect(await harness.service.saveMatrix(context, {
            ...request,
            execute: true,
        } as MediaPipelineMatrixInput)).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_MATRIX_INVALID' },
        })
        expect(harness.ports.commitArtifact).not.toHaveBeenCalled()
    })

    it('preflights selected reasoning models, prepares once per model and replays the completed matrix', async () => {
        const harness = new Harness()
        harness.ports.promptModel = {
            validateModels: vi.fn(async () => {}),
            prepare: vi.fn(async (_context, request) => `An image prompt prepared by ${request.modelId}.`),
        }
        const {
            promptVariants: _variants,
            ...matrix
        } = input()
        const request = {
            ...matrix,
            instruction: 'Prepare a sphere comparison.',
            reasoningModelIds: ['reasoning-a', 'reasoning-b'],
        }
        const result = await harness.service.prepareMatrix(context, request)
        expect(result).toMatchObject({
            status: 'completed',
            data: { artifact: { pipeline: { nodes: expect.any(Array) } } },
        })
        expect(harness.ports.promptModel.prepare).toHaveBeenCalledTimes(2)
        expect(harness.ports.promptModel.validateModels).toHaveBeenCalledBefore(harness.ports.promptModel.prepare)
        expect(await harness.service.prepareMatrix(context, request)).toEqual(result)
        expect(harness.ports.promptModel.prepare).toHaveBeenCalledTimes(2)
        expect(harness.ports.ensureOperation).not.toHaveBeenCalled()
    })

    it('rejects stale revisions and unavailable selected reasoning routes before preparing prompts', async () => {
        const harness = new Harness()
        harness.ports.promptModel = {
            validateModels: vi.fn(async () => {}),
            prepare: vi.fn(async () => 'Prepared.'),
        }
        const {
            promptVariants: _variants,
            ...matrix
        } = input()
        expect(await harness.service.prepareMatrix(context, {
            ...matrix,
            baseRevision: 9,
            instruction: 'Prepare.',
            reasoningModelIds: ['reasoning-a'],
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_REVISION_CONFLICT' },
        })
        vi.mocked(harness.ports.promptModel.validateModels).mockRejectedValue(new Error('MODEL_ROUTE_UNAVAILABLE'))
        await expect(harness.service.prepareMatrix(context, {
            ...matrix,
            instruction: 'Prepare.',
            reasoningModelIds: ['reasoning-a'],
        })).rejects.toThrow('MODEL_ROUTE_UNAVAILABLE')
        expect(harness.ports.promptModel.prepare).not.toHaveBeenCalled()
    })
})

const forkedPipeline = (): MediaPipeline => {
    const plan = pipeline()
    plan.nodes.push(node('second'), node('third'))
    plan.edges.push(
        {
            from: {
                nodeId: 'first',
                portId: 'image',
            },
            to: {
                nodeId: 'second',
                portId: 'reference',
            },
        },
        {
            from: {
                nodeId: 'first',
                portId: 'image',
            },
            to: {
                nodeId: 'third',
                portId: 'reference',
            },
        },
    )
    plan.outputBindings = [{
        outputId: 'second',
        nodeId: 'second',
        portId: 'image',
    }, {
        outputId: 'third',
        nodeId: 'third',
        portId: 'image',
    }]

    return plan
}

// =============================================================================
// FROZEN PIPELINE CONTRACT
// =============================================================================

describe('media pipeline validation', () => {
    it('round trips the typed Artifact and rejects direct rich-text mutations', () => {
        const document = createMediaPipelineDocument(pipeline())
        expect(readMediaPipelineDocument(document)).toEqual(pipeline())
        expect(mediaPipelineSharedDefinition.createDocumentSchema().nodeFromJSON(document).check()).toBeUndefined()
        expect(mediaPipelineSharedDefinition.collectReferencedAssetIds(document)).toEqual(['asset-reference'])
        expect(mediaPipelineSharedDefinition.collectOperationKeys!(document)).toEqual([...new Set(pipeline().nodes.map(node => node.operationKey))])
        expect(() => mediaPipelineSharedDefinition.assertEditableMutation(document, createMediaPipelineDocument({
            ...pipeline(),
            revision: 2,
        }))).toThrow('PIPELINE_TYPED_PATCH_REQUIRED')
    })

    it.each([
        ['PIPELINE_CYCLE', (plan: MediaPipeline) => void (plan.edges = [{
            from: {
                nodeId: 'first',
                portId: 'image',
            },
            to: {
                nodeId: 'first',
                portId: 'reference',
            },
        }])],
        ['PIPELINE_PORT_KIND_MISMATCH', (plan: MediaPipeline) => void (plan.sources[0].kind = 'audio')],
        ['PIPELINE_REQUIRED_INPUT_MISSING', (plan: MediaPipeline) => void (plan.edges = [])],
        ['PIPELINE_INPUT_MULTIPLE_BINDINGS', (plan: MediaPipeline) => void plan.edges.push(plan.edges[0])],
        ['PIPELINE_NODE_DUPLICATE', (plan: MediaPipeline) => void plan.nodes.push(plan.nodes[0])],
        ['PIPELINE_SOURCE_DUPLICATE', (plan: MediaPipeline) => void plan.sources.push(plan.sources[0])],
        ['PIPELINE_PORT_DUPLICATE', (plan: MediaPipeline) => void plan.nodes[0].inputs.push(plan.nodes[0].inputs[0])],
        ['PIPELINE_OUTPUT_UNKNOWN', (plan: MediaPipeline) => void (plan.outputBindings[0].portId = 'missing')],
        ['PIPELINE_SCHEMA_INVALID', (plan: MediaPipeline) => void (delete plan.sources[0].blobHash)],
        ['PIPELINE_SCHEMA_INVALID', (plan: MediaPipeline) => void (plan.executionPolicy.maxConcurrency = 100)],
        ['PIPELINE_PARAMETERS_INVALID', (plan: MediaPipeline) => void (plan.nodes[0].parameters.value = Number.NaN)],
    ])('rejects %s before execution', (code, mutate) => {
        const plan = pipeline()
        mutate(plan)
        expect(validateMediaPipeline(plan).map(issue => issue.code)).toContain(code)
    })

    it('bounds fanout independently of concurrency', () => {
        const plan = forkedPipeline()
        plan.executionPolicy.maxFanout = 1
        expect(validateMediaPipeline(plan).map(issue => issue.code)).toContain('PIPELINE_FANOUT_EXCEEDED')
    })

    it('keeps unknown schema versions unavailable for mutation', () => void expect(() => readMediaPipelineDocument({
        type: 'doc',
        content: [{
            type: 'mediaPipeline',
            attrs: { pipeline: {
                ...pipeline(),
                schemaVersion: 'media-pipeline-v2',
            } },
        }],
    })).toThrow('PIPELINE_SCHEMA_INVALID'))
})

// =============================================================================
// AUTHORIZED DRAFTS AND SUBMISSIONS
// =============================================================================

describe('media pipeline actions', () => {
    it('saves drafts with unsupported nodes and no generation side effects', async () => {
        const harness = new Harness()
        const changed = node('first')
        changed.operationKey = 'unsupported.operation'
        const result = await harness.service.save(context, {
            pipelineId: 'pipeline-1',
            baseRevision: 1,
            clientMutationId: 'edit-1',
            patch: { nodes: [changed] },
        })
        expect(result.status).toBe('completed')

        if (result.status === 'completed') {
            expect(result.data.gaps[0].code).toBe('PIPELINE_OPERATION_UNAVAILABLE')
            expect(result.data.artifact.pipeline.constraints).toEqual(pipeline().constraints)
            expect(result.data.artifact.pipeline.revision).toBe(2)
        }

        expect(harness.ports.ensureOperation).not.toHaveBeenCalled()
        expect(harness.ports.createExecution).not.toHaveBeenCalled()
    })

    it('replays an exact patch once and rejects changed content under its mutation ID', async () => {
        const harness = new Harness()
        const input = {
            pipelineId: 'pipeline-1',
            baseRevision: 1,
            clientMutationId: 'edit-1',
            patch: { requestedOutcome: 'An updated outcome.' },
        }
        expect(await harness.service.save(context, input)).toEqual(await harness.service.save(context, input))
        expect(harness.ports.commitArtifact).toHaveBeenCalledTimes(1)
        expect(await harness.service.save(context, {
            ...input,
            patch: { requestedOutcome: 'Different.' },
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_MUTATION_CONFLICT' },
        })
    })

    it('rejects a stale patch and model-supplied authority', async () => {
        const harness = new Harness()
        expect(await harness.service.save(context, {
            pipelineId: 'pipeline-1',
            baseRevision: 0,
            clientMutationId: 'edit',
            patch: { requestedOutcome: 'Change.' },
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_CREATE_ID_UNEXPECTED' },
        })
        const forged = {
            pipelineId: 'pipeline-1',
            baseRevision: 1,
            clientMutationId: 'edit',
            authority: 'execute',
            patch: { requestedOutcome: 'Change.' },
        }
        expect(await harness.service.save(context, forged)).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_PATCH_INVALID' },
        })
        expect(harness.ports.commitArtifact).not.toHaveBeenCalled()
    })

    it('creates a revision-one pipeline with server-bound origin', async () => {
        const harness = new Harness()
        const {
            schemaVersion: _schemaVersion,
            pipelineId: _pipelineId,
            revision: _revision,
            origin: _origin,
            ...patch
        } = pipeline()
        const result = await harness.service.save(context, {
            baseRevision: 0,
            clientMutationId: 'new-1',
            patch,
        })
        expect(result).toMatchObject({
            status: 'completed',
            data: { artifact: { pipeline: {
                revision: 1,
                origin: { turnId: context.turnId },
            } } },
        })
    })

    it.each(['adapterReady', 'credentialsReady', 'regionReady', 'pricingReady'] as const)('rejects a route without %s', async field => {
        const harness = new Harness()
        harness.modelCatalog.modelRoutes[0][field] = false
        expect(getExecutableMediaPipelineOperations(harness.modelCatalog)).toEqual([])
        expect(await harness.service.submit(context, {
            pipelineId: 'pipeline-1',
            revision: 1,
            clientSubmissionId: 'submit',
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_BEDROCK_ROUTE_UNAVAILABLE' },
        })
        expect(harness.ports.createExecution).not.toHaveBeenCalled()
    })

    it('refuses a direct provider route and a metadata-only operation', async () => {
        const harness = new Harness()
        harness.modelCatalog.modelRoutes[0].inferenceProviderCalledByThePlatform = 'direct'
        expect(getExecutableMediaPipelineOperations(harness.modelCatalog)).toEqual([])
        harness.modelCatalog.modelRoutes[0].inferenceProviderCalledByThePlatform = 'aws-bedrock'
        harness.modelCatalog.operations[0].ready = false
        expect(getExecutableMediaPipelineOperations(harness.modelCatalog)).toEqual([])
        expect(await harness.service.listOperations(context)).toEqual([])
    })

    it('checks scope and source snapshots before creating a durable execution', async () => {
        const harness = new Harness()
        harness.permitted = false
        expect(await harness.service.submit(context, {
            pipelineId: 'pipeline-1',
            revision: 1,
            clientSubmissionId: 'submit',
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_ACTION_DENIED' },
        })
        harness.permitted = true
        harness.sourceChanged = true
        expect(await harness.service.submit(context, {
            pipelineId: 'pipeline-1',
            revision: 1,
            clientSubmissionId: 'submit',
        })).toMatchObject({
            status: 'error',
            error: { code: 'SOURCE_CHANGED' },
        })
        expect(harness.ports.createExecution).not.toHaveBeenCalled()
    })

    it('returns one durable handle without awaiting provider work', async () => {
        const harness = new Harness()
        expect(await harness.submit()).toBe(await harness.submit())
        expect(harness.executions.size).toBe(1)
        expect(harness.ports.ensureOperation).not.toHaveBeenCalled()
    })
})

// =============================================================================
// RESUMABLE DAG EXECUTION
// =============================================================================

describe('media pipeline execution', () => {
    it('keeps submission and node identities stable after owner lease replacement', async () => {
        const harness = new Harness()
        const first = await harness.submit()
        const repeated = await harness.service.submit({
            ...context,
            epoch: context.epoch + 1,
        }, {
            pipelineId: 'pipeline-1',
            revision: 1,
            clientSubmissionId: 'submit-1',
        })
        expect(repeated).toEqual({
            status: 'pending',
            operationId: first,
        })
        const stored = harness.executions.get(first)!
        stored.context.epoch++
        await harness.service.advance(first)
        const firstOperation = vi.mocked(harness.ports.ensureOperation).mock.calls[0][0]
        harness.executions.set(first, {
            ...stored,
            receipts: {},
            state: 'queued',
            context: {
                ...stored.context,
                epoch: stored.context.epoch + 1,
            },
        })
        await harness.service.advance(first)
        const replayed = vi.mocked(harness.ports.ensureOperation).mock.calls[1][0]
        expect(replayed.operationId).toBe(firstOperation.operationId)
        expect(replayed.inputHash).toBe(firstOperation.inputHash)
    })
    it('executes a shared dependency once and binds its output into both branches', async () => {
        const harness = new Harness(forkedPipeline())
        const execution = await harness.service.advance(await harness.submit())
        expect(execution.state).toBe('succeeded')
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(3)
        expect(harness.ports.ensureOperation).toHaveBeenCalledWith(expect.objectContaining({
            node: expect.objectContaining({ nodeId: 'second' }),
            inputs: { reference: source('first') },
            inferenceProvider: 'aws-bedrock',
        }))
        expect(Object.keys(execution.outputs)).toEqual(['second', 'third'])
        await harness.service.advance(execution.executionId)
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(3)
        expect(harness.ports.enqueueContinuation).toHaveBeenCalledTimes(1)
    })

    it('waits for submitted jobs without releasing dependencies or submitting twice', async () => {
        const harness = new Harness(forkedPipeline())
        harness.pending = true
        const executionId = await harness.submit()
        expect((await harness.service.advance(executionId)).state).toBe('waiting')
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(1)
        await harness.service.advance(executionId)
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(1)
        harness.complete('first')
        harness.pending = false
        expect((await harness.service.advance(executionId)).state).toBe('succeeded')
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(3)
    })

    it('retains independent output when another branch fails', async () => {
        const plan = forkedPipeline()
        plan.edges[2] = {
            from: { sourceId: 'reference' },
            to: {
                nodeId: 'third',
                portId: 'reference',
            },
        }
        const harness = new Harness(plan)
        const ensure = harness.ports.ensureOperation
        harness.ports.ensureOperation = vi.fn(async request => request.node.nodeId === 'first'
            ? {
                operationId: request.operationId,
                inputHash: request.inputHash,
                state: 'failed',
                outputs: {},
                error: {
                    code: 'GENERATION_FAILED',
                    message: 'Generation failed.',
                    recoverable: true,
                },
            }
            : await ensure(request))
        const execution = await harness.service.advance(await harness.submit())
        expect(execution.state).toBe('failed')
        expect(execution.outputs.third).toEqual(source('third'))
        expect(execution.receipts.second).toBeUndefined()
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(2)
    })

    it('retries a failed branch under a new turn while retaining successful dependencies and independent outputs', async () => {
        const harness = new Harness(forkedPipeline())
        const ensure = harness.ports.ensureOperation
        let failSecond = true
        harness.ports.ensureOperation = vi.fn(async request => request.node.nodeId === 'second'
            && failSecond
            ? {
                operationId: request.operationId,
                inputHash: request.inputHash,
                state: 'failed',
                outputs: {},
                error: {
                    code: 'FAILED',
                    message: 'Generation failed.',
                    recoverable: true,
                },
            }
            : await ensure(request))
        const previous = await harness.service.advance(await harness.submit())
        expect(previous.state).toBe('failed')
        expect(previous.outputs.third).toEqual(source('third'))
        const retryContext = {
            ...context,
            turnId: 'turn-2',
            runId: 'run-2',
            responseMessageId: 'response-2',
        }
        const input = {
            executionId: previous.executionId,
            nodeIds: ['second'],
            clientAttemptId: 'retry-1',
        }
        const queued = await harness.service.retry(retryContext, input)
        expect(queued.status).toBe('pending')

        if (queued.status !== 'pending')
            throw new Error('EXPECTED_PENDING')

        expect(await harness.service.retry(retryContext, input)).toEqual(queued)
        failSecond = false
        const completed = await harness.service.advance(queued.operationId)
        expect(completed.state).toBe('succeeded')
        expect(completed.context.turnId).toBe('turn-2')
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(4)
        expect(completed.receipts.first).toEqual(previous.receipts.first)
        expect(completed.receipts.third).toEqual(previous.receipts.third)
        expect(completed.receipts.second.operationId).not.toBe(previous.receipts.second.operationId)
        expect(completed.outputs).toEqual({
            second: source('second'),
            third: source('third'),
        })
        expect(harness.ports.recheckSources).toHaveBeenCalledWith(retryContext, expect.arrayContaining([source('reference'), source('first'), source('third')]))
        await harness.service.advance(queued.operationId)
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(4)
    })

    it('requires a settled retry, current sources, and the failed upstream branch', async () => {
        const harness = new Harness(forkedPipeline())
        harness.ports.ensureOperation = vi.fn(async request => ({
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'failed',
            outputs: {},
        }))
        const previous = await harness.service.advance(await harness.submit())
        const input = {
            executionId: previous.executionId,
            nodeIds: ['first'],
            clientAttemptId: 'retry-1',
        }
        expect(await harness.service.retry(context, {
            ...input,
            nodeIds: ['second'],
        })).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_RETRY_DEPENDENCY_UNRESOLVED' },
        })
        harness.sourceChanged = true
        expect(await harness.service.retry(context, input)).toMatchObject({
            status: 'error',
            error: { code: 'SOURCE_CHANGED' },
        })
        harness.sourceChanged = false
        previous.receipts.first.state = 'outcome-unknown'
        harness.executions.set(previous.executionId, previous)
        expect(await harness.service.retry(context, input)).toMatchObject({
            status: 'error',
            error: { code: 'PIPELINE_RETRY_UNSETTLED' },
        })
        expect(harness.ports.createExecution).toHaveBeenCalledTimes(1)
    })

    it('does not resubmit an unknown provider outcome', async () => {
        const harness = new Harness()
        harness.ports.ensureOperation = vi.fn(async request => ({
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'outcome-unknown',
            outputs: {},
        }))
        const executionId = await harness.submit()
        const first = await harness.service.advance(executionId)
        const next = await harness.service.advance(executionId)
        expect(first.state).toBe('waiting')
        expect(next.issues[0].code).toBe('PIPELINE_OPERATION_OUTCOME_UNKNOWN')
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(1)
        expect(harness.ports.enqueueContinuation).not.toHaveBeenCalled()
    })

    it('stops a stale continuation before any new submission', async () => {
        const harness = new Harness(forkedPipeline())
        harness.pending = true
        const executionId = await harness.submit()
        await harness.service.advance(executionId)
        harness.complete('first')
        harness.current = false
        expect((await harness.service.advance(executionId)).state).toBe('cancelled')
        expect(harness.ports.ensureOperation).toHaveBeenCalledTimes(1)
        expect(harness.ports.enqueueContinuation).not.toHaveBeenCalled()
        expect([...harness.receipts.values()][0].state).toBe('succeeded')
    })

    it('rechecks frozen sources immediately before dispatch', async () => {
        const harness = new Harness()
        const executionId = await harness.submit()
        harness.sourceChanged = true
        expect((await harness.service.advance(executionId)).state).toBe('failed')
        expect(harness.ports.ensureOperation).not.toHaveBeenCalled()
    })

    it('rejects mismatched operation receipts and missing typed output slots', async () => {
        const harness = new Harness()
        harness.ports.ensureOperation = vi.fn(async request => ({
            operationId: 'wrong',
            inputHash: request.inputHash,
            state: 'succeeded',
            outputs: {},
        }))
        const executionId = await harness.submit()
        await expect(harness.service.advance(executionId)).rejects.toThrow('PIPELINE_OPERATION_IDENTITY_MISMATCH')
        harness.ports.ensureOperation = vi.fn(async request => ({
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'succeeded',
            outputs: {},
        }))
        expect(await harness.service.advance(executionId)).toMatchObject({
            state: 'failed',
            outputs: {},
            issues: [{ code: 'PIPELINE_OUTPUT_INVALID' }],
        })
    })

    it('hashes normalized parameter key order identically', () => void expect(hashMediaPipelineValue({
        b: 2,
        a: {
            d: 4,
            c: 3,
        },
    })).toBe(hashMediaPipelineValue({
        a: {
            c: 3,
            d: 4,
        },
        b: 2,
    })))
})
