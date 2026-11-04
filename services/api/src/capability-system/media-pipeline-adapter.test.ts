import { describe, expect, it, vi } from 'vitest'
import { MediaPipelineService, MediaSequencePipelineOperations, type MediaPipelineContext, type MediaPipelineExecution, type MediaPipelineOperationHandler } from '@lixpi/capability-system/backend'
import { defaultSequenceTransform, defaultSequenceAudio, type MediaPipelinePlan } from '@lixpi/capability-system/shared'
import { MediaPipelineAdapter } from './media-pipeline-adapter.ts'
import { AgentExecutionScope, type AgentExecution } from '../llm/agent/agent-execution-scope.ts'
import { createConversationExecutionFixture } from '../llm/agent/conversation-test-support.ts'
import { ConversationOwner } from '../llm/agent/conversation-owner.ts'
import AssetModel from '../models/asset.ts'

const artifactMocks = vi.hoisted(() => ({
    commit: vi.fn(),
    load: vi.fn(),
    authorize: vi.fn(),
}))
vi.mock('./artifact-revision-store.ts', () => ({ ArtifactRevisionStore: class { commit = artifactMocks.commit; load = artifactMocks.load; authorize = artifactMocks.authorize } }))
vi.mock('../models/asset.ts', () => ({ default: { get: vi.fn() } }))
vi.mock('../models/blob.ts', () => ({
    default: { get: vi.fn(async ({ blobHash }) => ({
        blobHash,
        blobKey: blobHash,
    })) },
    buildBlobReferenceBatchOperations: vi.fn(() => ({ operations: [] })),
}))
vi.mock('../llm/agent/agent-payload-store.ts', () => ({ AgentPayloadStore: class {} }))

const fixture = async () => {
    const test = await createConversationExecutionFixture()
    test.turn.references = [{
        assetId: 'pipeline',
        role: 'artifact',
        revision: 1,
        acquiredBy: 'explicit',
        relationshipPath: [],
    }]
    await test.repository.commit([test.repository.replace(test.partition, 'TURN#turn', test.turn)])
    const scope: AgentExecution = {
        owner: test.owner,
        turn: test.turn,
        intent: {
            intent: 'execute',
            operationFamilies: ['image'],
            targetAssetIds: ['pipeline'],
            confidence: 1,
            needsClarification: false,
        },
        responseMessageId: 'response',
        continuationEpoch: 0,
        createdAssetIds: new Set(),
    }
    const context: MediaPipelineContext = {
        userId: 'user',
        organizationId: 'org',
        workspaceId: 'workspace',
        conversationAssetId: 'conversation',
        turnId: 'turn',
        runId: 'run-turn',
        responseMessageId: 'response',
        epoch: test.owner.epoch,
        continuationEpoch: 0,
        authority: 'scope',
    }
    const handler: MediaPipelineOperationHandler = {
        definition: {
            operationKey: 'local-image',
            family: 'image',
            execution: 'local',
            ready: true,
            inputPorts: [],
            outputPorts: [{
                portId: 'image',
                kind: 'image',
                required: true,
            }],
            parameterSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
        },
        ensure: vi.fn(async request => ({
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'succeeded',
            outputs: { image: {
                sourceId: 'output',
                assetId: 'output',
                revision: 1,
                kind: 'image',
                blobHash: 'hash',
            } },
        })),
        read: vi.fn(async () => undefined),
    }
    const onCompleted = vi.fn(async () => {})
    const handlers = [handler]
    const adapter = new MediaPipelineAdapter(test.repository, {
        handlers: () => handlers,
        modelRoutes: async () => [],
        onCompleted,
        payloads: () => test.payloads,
    })
    const ports = adapter.ports()
    adapter.bind(new MediaPipelineService(ports))
    const execution: MediaPipelineExecution = {
        executionId: 'execution',
        revision: 1,
        inputHash: 'hash',
        context,
        state: 'queued',
        receipts: {},
        outputs: {},
        issues: [],
        pipeline: {
            schemaVersion: 'media-pipeline-v1',
            pipelineId: 'pipeline',
            revision: 1,
            origin: {
                conversationAssetId: 'conversation',
                turnId: 'turn',
            },
            requestedOutcome: 'An image',
            constraints: [],
            sources: [],
            nodes: [{
                nodeId: 'first',
                operationKey: 'local-image',
                parameters: {},
                inputs: [],
                outputs: handler.definition.outputPorts,
            }],
            edges: [],
            executionPolicy: {
                maxConcurrency: 1,
                maxFanout: 1,
            },
            outputBindings: [{
                outputId: 'result',
                nodeId: 'first',
                portId: 'image',
            }],
        },
    }

    return {
        ...test,
        ownerPorts: test.ports,
        scope,
        context,
        handler,
        handlers,
        adapter,
        ports,
        execution,
        onCompleted,
    }
}

describe('durable pipeline adapter', () => {
    it('saves the requested Blue hold draft under plan scope without authorizing sequence execution', async () => {
        const f = await fixture()
        const prompt = 'Save a draft local pipeline named Blue hold that creates a five-second 320 by 180 sequence using only the existing workspace image Solid Blue Field, then exports an MP4. Do not execute it yet. Do not generate any new media.'
        f.turn.fragment = {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: prompt,
                }],
            }],
        }
        f.turn.references = [{
            assetId: 'blue-image',
            role: 'media',
            revision: 5,
            blobHash: 'blue-hash',
            acquiredBy: 'discovery',
            relationshipPath: ['blue-image'],
        }]
        f.scope.intent = {
            intent: 'plan',
            operationFamilies: ['sequence-edit', 'sequence-export'],
            targetAssetIds: ['blue-image'],
            confidence: 0.95,
            needsClarification: false,
        }
        vi.mocked(AssetModel.get).mockResolvedValue({
            assetId: 'blue-image',
            organizationId: 'org',
            revision: 5,
            states: { lifecycle: 'active' },
            media: {
                kind: 'image',
                renditions: { original: {
                    name: 'original',
                    status: 'ready',
                    blobHash: 'blue-hash',
                    byteSize: 630,
                    width: 320,
                    height: 180,
                } },
            },
        } as never)
        artifactMocks.commit.mockClear().mockResolvedValue(true)
        const createSequence = vi.fn()
        const exportSequence = vi.fn()
        const local = new MediaSequencePipelineOperations({ create: createSequence } as never, {
            resolvePipelineSource: vi.fn(),
            resolvePipelineMediaSource: vi.fn(),
            exportHandler: {
                ensure: exportSequence,
                read: vi.fn(),
            },
        }).handlers()
        f.handlers.splice(0, f.handlers.length, ...local)
        const patch: MediaPipelinePlan = {
            name: 'Blue hold',
            requestedOutcome: 'Create a five-second 320 by 180 sequence using Solid Blue Field, then export MP4.',
            constraints: ['Do not execute yet.', 'Do not generate new media.'],
            sources: [{
                sourceId: 'blue',
                assetId: 'blue-image',
                revision: 5,
                kind: 'image',
                blobHash: 'blue-hash',
            }],
            nodes: [
                {
                    nodeId: 'create-sequence',
                    operationKey: 'sequence.create',
                    parameters: {
                        name: 'Blue hold',
                        sourceBindings: [{
                            inputPort: 'image',
                            sourceId: 'blue',
                        }],
                        operations: [
                    {
                        op: 'set-properties',
                        values: {
                            width: 320,
                            height: 180,
                            duration: 1_200_000,
                        },
                    },
                    {
                        op: 'add-track',
                        track: {
                            trackId: 'video-track',
                            kind: 'video',
                            name: 'Video',
                            locked: false,
                            visible: true,
                            muted: false,
                            solo: false,
                        },
                    },
                    {
                        op: 'insert-clip',
                        clip: {
                            clipId: 'blue-clip',
                            trackId: 'video-track',
                            sourceId: 'blue',
                            sourceIn: 0,
                            sourceOut: 0,
                            start: 0,
                            duration: 1_200_000,
                            rate: {
                                numerator: 1,
                                denominator: 1,
                            },
                            transform: defaultSequenceTransform(),
                            audio: defaultSequenceAudio(),
                            keyframes: [],
                        },
                    },
                ],
                    },
                    inputs: local[0].definition.inputPorts,
                    outputs: local[0].definition.outputPorts,
                },
                {
                    nodeId: 'export-mp4',
                    operationKey: 'sequence.export',
                    parameters: { preset: {
                        presetId: 'mp4-h264-aac',
                        quality: 'standard',
                    } },
                    inputs: local[2].definition.inputPorts,
                    outputs: local[2].definition.outputPorts,
                },
            ],
            edges: [{
                from: { sourceId: 'blue' },
                to: {
                    nodeId: 'create-sequence',
                    portId: 'image',
                },
            }, {
                from: {
                    nodeId: 'create-sequence',
                    portId: 'sequence',
                },
                to: {
                    nodeId: 'export-mp4',
                    portId: 'sequence',
                },
            }],
            outputBindings: [{
                outputId: 'blue-mp4',
                nodeId: 'export-mp4',
                portId: 'video',
            }],
            executionPolicy: {
                maxConcurrency: 1,
                maxFanout: 1,
            },
        }
        const service = new MediaPipelineService(f.ports)
        await AgentExecutionScope.run(f.scope, async () => {
            expect(await service.save(f.context, {
                pipelineId: 'Blue hold',
                baseRevision: 0,
                clientMutationId: 'blue-draft',
                patch,
            })).toMatchObject({
                status: 'error',
                error: {
                    code: 'PIPELINE_CREATE_ID_UNEXPECTED',
                    recoverable: true,
                },
            })
            const saved = await service.save(f.context, {
                baseRevision: 0,
                clientMutationId: 'blue-draft',
                patch,
            })
            expect(saved).toMatchObject({
                status: 'completed',
                data: {
                    gaps: [],
                    artifact: { pipeline: {
                        name: 'Blue hold',
                        revision: 1,
                        constraints: patch.constraints,
                    } },
                },
            })
            expect(artifactMocks.commit).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Blue hold',
                expectedRevision: 0,
            }))
            expect(artifactMocks.commit).toHaveBeenCalledTimes(1)

            if (saved.status !== 'completed')
                throw new Error('EXPECTED_SAVED_DRAFT')

            expect(await service.submit(f.context, {
                pipelineId: saved.data.artifact.assetId,
                revision: 1,
                clientSubmissionId: 'forbidden-execution',
            })).toMatchObject({
                status: 'error',
                error: { code: 'PIPELINE_ACTION_DENIED' },
            })
            expect(await service.save(f.context, {
                pipelineId: 'other-existing-pipeline',
                baseRevision: 1,
                clientMutationId: 'forbidden-target',
                patch: { requestedOutcome: 'Change another pipeline.' },
            })).toMatchObject({
                status: 'error',
                error: { code: 'PIPELINE_ACTION_DENIED' },
            })
        })
        expect(createSequence).not.toHaveBeenCalled()
        expect(exportSequence).not.toHaveBeenCalled()
        expect([...f.database.rows.values()].some(row => String(row.sk).startsWith('PIPELINE#'))).toBe(false)
    })

    it('retains an accepted discovered pipeline and frozen sources without broadening the narrowed model context', async () => {
        const f = await fixture()
        f.turn.references = []
        f.turn.settings.contextMode = 'discovery'
        await f.repository.commit([f.repository.replace(f.partition, 'TURN#turn', f.turn)])
        f.execution.pipeline.sources = [{
            sourceId: 'frozen',
            assetId: 'frozen',
            kind: 'image',
            revision: 1,
            blobHash: 'frozen-hash',
        }]
        vi.mocked(AssetModel.get).mockResolvedValue({
            assetId: 'frozen',
            organizationId: 'org',
            revision: 1,
            states: { lifecycle: 'active' },
            media: {
                kind: 'image',
                renditions: { original: {
                    name: 'original',
                    blobHash: 'frozen-hash',
                    status: 'ready',
                } },
            },
        } as never)
        f.scope.assertReadTarget = async () => {}
        await AgentExecutionScope.run(f.scope, () => f.ports.createExecution(f.execution))
        await f.owner.mutate(meta => ({
            ...meta,
            settings: {
                ...meta.settings,
                contextMode: 'explicit',
            },
        }))
        f.scope.assertReadTarget = async () => { throw new Error('SOURCE_NOT_ADMITTED') }
        await AgentExecutionScope.run(f.scope, async () => {
            expect((await f.adapter.advanceForRun(f.owner)).completed[0].state).toBe('succeeded')
            await expect(AgentExecutionScope.authorize('execute', ['image'], ['pipeline'])).rejects.toThrow('SOURCE_NOT_ADMITTED')
            await expect(AgentExecutionScope.assertReadTargets(['frozen'])).rejects.toThrow('SOURCE_NOT_ADMITTED')
        })
        expect(f.handler.ensure).toHaveBeenCalledOnce()
    })

    it('does not admit a frozen source after its Asset access is revoked', async () => {
        const f = await fixture()
        f.execution.pipeline.sources = [{
            sourceId: 'frozen',
            assetId: 'frozen',
            kind: 'image',
            revision: 1,
            blobHash: 'frozen-hash',
        }]
        vi.mocked(AssetModel.get).mockResolvedValue({ error: 'NOT_FOUND' })
        await AgentExecutionScope.run(f.scope, () => f.ports.createExecution(f.execution))
        const result = await f.adapter.advanceForRun(f.owner)
        expect(result.completed[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PIPELINE_SOURCE_CHANGED' })]))
        expect(f.handler.ensure).not.toHaveBeenCalled()
    })

    it('admits a recovered asynchronous output before executing a dependent mutation', async () => {
        const f = await fixture()
        const output = {
            sourceId: 'generated',
            assetId: 'output',
            kind: 'image' as const,
            revision: 1,
            blobHash: 'output-hash',
        }
        vi.mocked(f.handler.ensure).mockImplementation(async request => ({
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'submitted',
            outputs: {},
        }))
        vi.mocked(f.handler.read).mockImplementation(async (_context, operationId) => {
            const request = vi.mocked(f.handler.ensure).mock.calls[0][0]

            return {
                operationId,
                inputHash: request.inputHash,
                state: 'succeeded',
                outputs: { image: output },
            }
        })
        vi.mocked(AssetModel.get).mockResolvedValue({
            assetId: 'output',
            organizationId: 'org',
            revision: 1,
            states: { lifecycle: 'active' },
            media: {
                kind: 'image',
                renditions: { original: {
                    name: 'original',
                    blobHash: 'output-hash',
                    status: 'ready',
                } },
            },
        } as never)
        const dependent: MediaPipelineOperationHandler = {
            definition: {
                ...f.handler.definition,
                operationKey: 'local-edit',
                inputPorts: [{
                    portId: 'image',
                    kind: 'image',
                    required: true,
                }],
            },
            ensure: vi.fn(async request => {
                await AgentExecutionScope.authorize('execute', ['image'], [request.inputs.image.assetId])

                return {
                    operationId: request.operationId,
                    inputHash: request.inputHash,
                    state: 'succeeded',
                    outputs: { image: output },
                }
            }),
            read: async () => undefined,
        }
        f.handlers.push(dependent)
        f.execution.pipeline.nodes.push({
            nodeId: 'second',
            operationKey: 'local-edit',
            parameters: {},
            inputs: dependent.definition.inputPorts,
            outputs: dependent.definition.outputPorts,
        })
        f.execution.pipeline.edges.push({
            from: {
                nodeId: 'first',
                portId: 'image',
            },
            to: {
                nodeId: 'second',
                portId: 'image',
            },
        })
        f.execution.pipeline.outputBindings[0].nodeId = 'second'
        await AgentExecutionScope.run(f.scope, () => f.ports.createExecution(f.execution))
        expect((await f.adapter.advanceForRun(f.owner)).pending).toBe(true)
        expect(dependent.ensure).not.toHaveBeenCalled()
        expect((await f.adapter.advanceForRun(f.owner)).completed[0].state).toBe('succeeded')
        expect(dependent.ensure).toHaveBeenCalledOnce()
        expect(await f.repository.read(f.partition, 'CREATED#output')).toMatchObject({
            assetId: 'output',
            runId: 'run-turn',
        })
    })

    it('publishes committed draft output without exposing its private execution authority', async () => {
        const f = await fixture()
        artifactMocks.commit.mockResolvedValue(true)
        await AgentExecutionScope.run(f.scope, async () => void (await f.ports.commitArtifact({
            context: f.context,
            pipeline: f.execution.pipeline,
            expectedRevision: 0,
            clientMutationId: 'draft',
            inputHash: 'draft-hash',
        })))
        const operations = await f.repository.query<{
            state: string
            outputAssetIds: unknown
        }>(f.owner.partition, 'PUBLIC_OPERATION#')
        expect(operations.items).toHaveLength(1)
        expect(operations.items[0]).toMatchObject({
            state: 'succeeded',
            outputAssetIds: { artifact: 'pipeline' },
        })
        const events = [...f.database.rows.values()].filter(row => String(row.sk).startsWith('EVENT#'))
        expect(events).toContainEqual(expect.objectContaining({
            type: 'output.committed',
            payload: expect.objectContaining({
                assetId: 'pipeline',
                outputSlot: 'artifact',
            }),
        }))
        expect(JSON.stringify(operations)).not.toContain('authority')
    })
    it('reads bounded operation projections and cancels only this active conversation run', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.scope, async () => {
            await f.ports.createExecution(f.execution)
            expect(await f.adapter.getOperation(f.owner, 'execution')).toMatchObject({
                operationId: 'execution',
                kind: 'pipeline',
                state: 'queued',
            })
            expect(JSON.stringify(await f.adapter.getOperation(f.owner, 'execution'))).not.toContain('authority')
            await expect(f.adapter.getOperation(f.owner, 'another-operation')).rejects.toThrow('AGENT_OPERATION_NOT_FOUND')
            await expect(f.adapter.cancelOperation(f.owner, 'another-operation')).rejects.toThrow('AGENT_OPERATION_SCOPE_MISMATCH')
            expect(await f.adapter.cancelOperation(f.owner, 'execution')).toMatchObject({ state: 'cancelled' })
        })
        expect(f.handler.ensure).not.toHaveBeenCalled()
    })
    it('returns completion repeatedly until its continuation is durably acknowledged', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.scope, async () => {
            await f.ports.createExecution(f.execution)
            expect(await f.adapter.listPending(f.context)).toEqual(['execution'])
        })
        const first = await f.adapter.advanceForRun(f.owner)
        expect(first.pending).toBe(false)
        expect(first.completed[0].outputs.result.assetId).toBe('output')
        expect(await f.repository.read(f.owner.partition, 'PUBLIC_OPERATION#response#execution')).toMatchObject({
            operationKey: 'media-pipeline.execute',
            executionId: 'execution',
            state: 'succeeded',
            outputAssetIds: { result: 'output' },
        })
        expect((await f.adapter.advanceForRun(f.owner)).completed).toHaveLength(1)
        await f.adapter.acknowledgeCompletion(f.owner, 'execution')
        expect((await f.adapter.advanceForRun(f.owner)).completed).toHaveLength(0)
        expect(f.handler.ensure).toHaveBeenCalledTimes(1)
    })

    it('reads settled prior executions only through the explicit historical retry boundary', async () => {
        const f = await fixture()
        const previous = {
            ...f.execution,
            state: 'failed' as const,
            context: {
                ...f.context,
                runId: 'prior-run',
            },
        }
        const prepared = await f.payloads.prepare('json', Buffer.from(JSON.stringify(previous)), 'PIPELINE#execution#1')
        await f.repository.commit([f.repository.put(f.owner.partition, 'PIPELINE#execution', {
            executionId: 'execution',
            revision: 1,
            inputHash: 'hash',
            runId: 'prior-run',
            state: 'failed',
            payload: prepared.payload,
        })])
        await AgentExecutionScope.run(f.scope, async () => {
            await expect(f.ports.readExecution('execution')).rejects.toThrow('PIPELINE_RUN_MISMATCH')
            expect(await f.ports.readExecution('execution', true)).toMatchObject({
                state: 'failed',
                context: { runId: 'prior-run' },
            })
        })
        const pending = await f.payloads.prepare('json', Buffer.from(JSON.stringify({
            ...previous,
            state: 'waiting',
        })), 'PIPELINE#execution#2')
        await f.repository.commit([f.repository.replace(f.owner.partition, 'PIPELINE#execution', {
            executionId: 'execution',
            revision: 2,
            inputHash: 'hash',
            runId: 'prior-run',
            state: 'waiting',
            payload: pending.payload,
        })])
        await AgentExecutionScope.run(f.scope, async () => void await expect(f.ports.readExecution('execution', true)).rejects.toThrow('PIPELINE_RUN_MISMATCH'))
    })

    it('rehydrates the accepted grant with a replacement owner epoch', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.scope, () => f.ports.createExecution(f.execution))
        await f.owner.release()
        const replacement = (await ConversationOwner.acquire(f.job, f.repository, f.ownerPorts))!
        expect((await f.adapter.advanceForRun(replacement)).completed[0].state).toBe('succeeded')
        expect(vi.mocked(f.handler.ensure).mock.calls[0][0].context.epoch).toBe(replacement.epoch)
        expect(replacement.epoch).toBeGreaterThan(f.owner.epoch)
    })

    it('retries a prepared local operation after a crash without changing its id', async () => {
        const f = await fixture()
        vi.mocked(f.handler.ensure).mockRejectedValueOnce(new Error('PROCESS_INTERRUPTED'))
        await AgentExecutionScope.run(f.scope, () => f.ports.createExecution(f.execution))
        await expect(f.adapter.advanceForRun(f.owner)).rejects.toThrow('PROCESS_INTERRUPTED')
        expect((await f.adapter.advanceForRun(f.owner)).completed[0].state).toBe('succeeded')
        expect(vi.mocked(f.handler.ensure).mock.calls[0][0].operationId).toBe(vi.mocked(f.handler.ensure).mock.calls[1][0].operationId)
    })

    it('keeps an unknown provider operation pending without repeating it', async () => {
        const f = await fixture()
        vi.mocked(f.handler.ensure).mockImplementation(async request => ({
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'outcome-unknown',
            outputs: {},
        }))
        await AgentExecutionScope.run(f.scope, () => f.ports.createExecution(f.execution))
        expect((await f.adapter.advanceForRun(f.owner)).pending).toBe(true)
        expect((await f.adapter.advanceForRun(f.owner)).pending).toBe(true)
        expect(f.handler.ensure).toHaveBeenCalledTimes(1)
    })

    it('rejects an identity copied into another workspace before any work', async () => {
        const f = await fixture()
        await AgentExecutionScope.run(f.scope, async () => void (await expect(f.ports.createExecution({
            ...f.execution,
            context: {
                ...f.context,
                workspaceId: 'other',
            },
        })).rejects.toThrow('PIPELINE_EXECUTION_SCOPE_MISMATCH')))
        expect(f.handler.ensure).not.toHaveBeenCalled()
    })
})
