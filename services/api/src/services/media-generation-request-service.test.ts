'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    type Asset,
    type MediaBranchLineagePlan,
    type MediaGenerationRequest,
    type MediaGenerationRun,
    type MediaReferenceBinding,
    type UnresolvedReferenceBinding,
} from '@lixpi/constants'
import {
    getMediaGenerationOperationNodeId,
    getPendingGeneratedMediaNodeId,
} from '@lixpi/canvas-engine'

const mocks = vi.hoisted(() => ({
    mediaRequestModel: {
        create: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        getAuthorized: vi.fn(),
        transition: vi.fn(),
    },
    blobModel: {
        store: vi.fn(),
        addReference: vi.fn(),
        removeReference: vi.fn(),
    },
    assetModel: {
        get: vi.fn(),
        removeAssetSurfaceReferenceSystem: vi.fn(),
    },
    canvasProjection: {
        settleFailed: vi.fn(),
        upsertLineage: vi.fn(),
    },
    operationProjection: {
        project: vi.fn(),
        rebind: vi.fn(),
        removeOne: vi.fn(),
        removeAll: vi.fn(),
        update: vi.fn(),
    },
}))

vi.mock('../models/media-generation-request.ts', () => ({
    default: mocks.mediaRequestModel,
}))

vi.mock('../models/blob.ts', () => ({
    default: mocks.blobModel,
}))

vi.mock('../models/asset.ts', () => ({
    default: mocks.assetModel,
}))

vi.mock('./asset-canvas-projection.ts', () => ({
    settleFailedGeneratedMediaRunOnCanvas: mocks.canvasProjection.settleFailed,
    upsertMediaLineagePlanToCanvas: mocks.canvasProjection.upsertLineage,
}))

vi.mock('./media-generation-operation-projection.ts', () => ({
    projectMediaGenerationOperationNodes: mocks.operationProjection.project,
    rebindMediaGenerationOperationNodes: mocks.operationProjection.rebind,
    removeMediaGenerationOperationNode: mocks.operationProjection.removeOne,
    removeMediaGenerationOperationNodes: mocks.operationProjection.removeAll,
    updateMediaGenerationOperationNode: mocks.operationProjection.update,
}))

import {
    assertSafeMediaGenerationCheckpoint,
    MediaGenerationRequestService,
} from './media-generation-request-service.ts'

const deferredRequest = (): MediaGenerationRequest => ({
    generationRequestId: 'media-request-1',
    workspaceId: 'workspace-1',
    organizationId: 'organization-1',
    userId: 'user-1',
    conversationAssetId: 'conversation-1',
    status: 'submitted',
    checkpointBlobHash: 'checkpoint-hash',
    checkpointSchemaVersion: 'media-generation-checkpoint-v1',
    bindings: [],
    unresolvedBindings: [],
    resolvedReferences: [],
    runs: [],
    plannedCanvasNodeIds: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    statusUpdatedAt: 1,
})

const pendingRun = (): MediaGenerationRun => ({
    generationRun: 0,
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    reasoningIndex: 0,
    reasoningRunId: 'media-request-1:reasoning:0',
    provider: 'OpenAI',
    modelId: 'OpenAI:gpt-image-2',
    mediaRunId: 'media-request-1:reasoning:0:image:0',
    mediaType: 'image',
    mediaIndex: 0,
    outputAssetId: 'asset-image-1',
    outputNodeId: 'pending-image-1',
    operationNodeId: 'operation-image-1',
    status: 'pending',
})

const referenceAsset = (assetId: string, title: string): Asset => ({
    assetId,
    organizationId: 'organization-1',
    title,
    scope: 'workspace',
    scopeOwnerId: 'workspace-1',
    originWorkspaceId: 'workspace-1',
    ownerUserId: 'user-1',
    media: {
        kind: 'image',
        originalName: `${title}.png`,
        sourceMimeType: 'image/png',
        modelSafe: true,
        renditions: {},
    },
    descriptor: {
        status: 'ready',
        summary: `${title} character reference`,
        entityTags: ['character'],
        styleTags: ['illustration'],
        source: 'analysis',
        version: '1',
        updatedAt: 1,
    },
    depictionMedium: 'painting',
    subjectIdentity: {
        classification: 'fictional',
        source: 'user-attestation',
        currentAttestationId: `attestation-${assetId}`,
        identityGroupId: `identity-${assetId}`,
        providerVerifications: [],
    },
    documents: {},
    states: {
        lifecycle: 'active',
        media: 'ready',
        conversation: 'none',
        provenance: 'none',
    },
    referenceCount: 1,
    revision: 3,
    createdAt: 1,
    updatedAt: 1,
})

const referenceBinding = (asset: Asset, index: number): MediaReferenceBinding => ({
    assetId: asset.assetId,
    assetRevision: asset.revision,
    mediaKind: 'image',
    alias: `REFERENCE_${index}`,
    displayNameSnapshot: asset.title,
    forbiddenNameVariants: [asset.title.toLocaleLowerCase('en-US')],
    semanticDescriptor: asset.descriptor?.summary ?? 'character reference',
    depictionMedium: asset.depictionMedium,
    subjectIdentity: asset.subjectIdentity,
})

const unresolvedBinding = (
    bindingId: string,
    originalText: string,
    candidateAssetIds: string[],
): UnresolvedReferenceBinding => ({
    bindingId,
    promptRange: { from: 0, to: originalText.length },
    originalText,
    matcherVersion: 'bounded-local-v1',
    candidates: candidateAssetIds.map((assetId, index) => ({
        assetId,
        score: 0.9 - index * 0.1,
        previewRenditionName: 'thumbnail',
    })),
})

const imageLineagePlan = (): MediaBranchLineagePlan => ({
    planVersion: 'media-branch-lineage-v1',
    generationRequestId: 'media-request-1',
    branchId: 'branch-1',
    promptText: 'Draw a cat',
    referenceAssetIds: [],
    referenceNodeIds: [],
    sourceContextNodeIds: [],
    branchOrigin: {
        nodeId: 'branch-origin-1',
        generationRequestId: 'media-request-1',
        branchId: 'branch-1',
        provenance: {
            kind: 'branch-root-fork-decision',
            promptText: 'Draw a cat',
            referenceNodeIds: [],
            sourceContextNodeIds: [],
            forked: false,
            forkCount: 0,
        },
    },
    branchForks: [],
    branchLines: [],
    runAssignments: [{
        assetId: 'asset-image-1',
        generationRequestId: 'media-request-1',
        reasoningRunId: 'media-request-1:reasoning:0',
        mediaRunId: 'media-request-1:reasoning:0:image:0',
        reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
        reasoningIndex: 0,
        mediaModelId: 'Stability:sd3.5-large',
        mediaType: 'image',
        mediaIndex: 0,
        branchId: 'branch-1',
        branchOriginNodeId: 'branch-origin-1',
        lineageParentNodeId: 'branch-origin-1',
        referenceAssetIds: [],
        referenceNodeIds: [],
        sourceContextNodeIds: [],
        promptText: 'Draw a cat',
        createdAt: 2,
    }],
    createdAt: 2,
})

beforeEach(() => {
    vi.clearAllMocks()
    mocks.blobModel.store.mockResolvedValue({ blobHash: 'checkpoint-hash' })
    mocks.blobModel.addReference.mockResolvedValue(undefined)
    mocks.blobModel.removeReference.mockResolvedValue(undefined)
    mocks.mediaRequestModel.create.mockResolvedValue(undefined)
    mocks.assetModel.removeAssetSurfaceReferenceSystem.mockResolvedValue({ success: true })
})

describe('media generation checkpoint safety', () => {
    it('accepts structured prompt, stable references, and model configuration', () => {
        expect(() => assertSafeMediaGenerationCheckpoint({
            promptDocument: { type: 'doc', content: [{ type: 'text', text: 'Animate REFERENCE_1' }] },
            selectedReferences: [{ assetId: 'asset-1', nodeId: 'node-1' }],
            modelSelection: { mediaModelIds: ['Google:veo-3.1'] },
        })).not.toThrow()
    })

    it.each([
        [{ configuration: { accessToken: 'secret' } }, 'MEDIA_REQUEST_CHECKPOINT_SECRET_FORBIDDEN:$.configuration.accessToken'],
        [{ configuration: { nested: { apiKey: 'secret' } } }, 'MEDIA_REQUEST_CHECKPOINT_SECRET_FORBIDDEN:$.configuration.nested.apiKey'],
        [{ configuration: { 'Byted_Token': 'secret' } }, 'MEDIA_REQUEST_CHECKPOINT_SECRET_FORBIDDEN:$.configuration.Byted_Token'],
        [{ selectedReferences: [{ preview: 'data:image/png;base64,AAAA' }] }, 'MEDIA_REQUEST_CHECKPOINT_MEDIA_BYTES_FORBIDDEN:$.selectedReferences[0].preview'],
        [{ payload: new Uint8Array([1, 2, 3]) }, 'MEDIA_REQUEST_CHECKPOINT_BINARY_FORBIDDEN:$.payload'],
    ])('rejects secret or media-byte checkpoint payloads', (checkpoint, expected) => {
        expect(() => assertSafeMediaGenerationCheckpoint(checkpoint)).toThrow(expected)
    })
})

describe('media generation reference resolution actions', () => {
    it('projects only the candidates authorized for the first unresolved binding', async () => {
        const assets = [
            referenceAsset('asset-1', 'Source Drawing'),
            referenceAsset('asset-2', 'Character Sheet'),
            referenceAsset('asset-3', 'Alternate Sheet'),
        ]
        const unresolvedBindings = [
            unresolvedBinding('binding-reference-drawing', 'reference drawing', ['asset-1', 'asset-2']),
            unresolvedBinding('binding-character-sheet', 'character sheet', ['asset-2', 'asset-3']),
        ]
        const run = pendingRun()
        mocks.operationProjection.project.mockResolvedValue({
            generationRequestId: 'media-request-1',
            layoutRevision: 1,
            nodes: [],
        })
        const eventLog = { append: vi.fn(async () => undefined) }

        await new MediaGenerationRequestService(eventLog as never).create({
            generationRequestId: 'media-request-1',
            workspaceId: 'workspace-1',
            organizationId: 'organization-1',
            userId: 'user-1',
            conversationAssetId: 'conversation-1',
            checkpoint: {
                promptDocument: { type: 'doc' },
                selectedReferences: assets.map(asset => ({ assetId: asset.assetId })),
                modelSelection: {},
                configuration: {},
            },
            bindings: assets.map((asset, index) => referenceBinding(asset, index + 1)),
            unresolvedBindings,
            runs: [run],
        })

        expect(mocks.operationProjection.update).toHaveBeenCalledWith(expect.objectContaining({
            candidateAssetIds: ['asset-1', 'asset-2'],
            unresolvedBindingId: 'binding-reference-drawing',
        }))
        expect(eventLog.append).toHaveBeenCalledWith(expect.objectContaining({
            event: expect.objectContaining({
                status: 'MEDIA_GENERATION_ACTION_REQUIRED',
                payload: expect.objectContaining({
                    bindingId: 'binding-reference-drawing',
                    candidateAssetIds: ['asset-1', 'asset-2'],
                }),
            }),
        }))
    })

    it('publishes the next binding and its candidates after resolving one phrase', async () => {
        const assets = [
            referenceAsset('asset-1', 'Source Drawing'),
            referenceAsset('asset-2', 'Character Sheet'),
            referenceAsset('asset-3', 'Alternate Sheet'),
        ]
        const request: MediaGenerationRequest = {
            ...deferredRequest(),
            status: 'awaiting-reference-resolution',
            bindings: assets.map((asset, index) => referenceBinding(asset, index + 1)),
            unresolvedBindings: [
                unresolvedBinding('binding-reference-drawing', 'reference drawing', ['asset-1', 'asset-2']),
                unresolvedBinding('binding-character-sheet', 'character sheet', ['asset-2', 'asset-3']),
            ],
            runs: [pendingRun()],
        }
        const eventLog = { append: vi.fn(async () => undefined) }
        mocks.mediaRequestModel.getAuthorized.mockResolvedValue(request)
        mocks.mediaRequestModel.transition.mockResolvedValue(undefined)
        mocks.assetModel.get.mockImplementation(async ({ assetId }: { assetId: string }) => (
            assets.find(asset => asset.assetId === assetId)!
        ))

        const result = await new MediaGenerationRequestService(eventLog as never).resolveReference({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            userId: request.userId,
            requestRevision: request.revision,
            bindingId: 'binding-reference-drawing',
            assetId: 'asset-1',
            requester: {} as never,
        })

        expect(result.unresolvedBindings.map(binding => binding.bindingId)).toEqual([
            'binding-character-sheet',
        ])
        expect(mocks.operationProjection.update).toHaveBeenCalledWith(expect.objectContaining({
            candidateAssetIds: ['asset-2', 'asset-3'],
            unresolvedBindingId: 'binding-character-sheet',
            requestRevision: 2,
        }))
        expect(eventLog.append).toHaveBeenCalledWith(expect.objectContaining({
            event: expect.objectContaining({
                status: 'MEDIA_GENERATION_ACTION_REQUIRED',
                requestRevision: 2,
                payload: {
                    status: 'awaiting-reference-resolution',
                    bindingId: 'binding-character-sheet',
                    candidateAssetIds: ['asset-2', 'asset-3'],
                    resolvedBindingId: 'binding-reference-drawing',
                    resolvedAssetId: 'asset-1',
                },
            }),
        }))
    })
})

describe('media generation request lineage binding', () => {
    it('materializes only the selected image run for a deferred scalar request', async () => {
        const request = deferredRequest()
        const lineagePlan = imageLineagePlan()
        const operationNodeId = getMediaGenerationOperationNodeId(lineagePlan.runAssignments[0]!)
        mocks.mediaRequestModel.get.mockResolvedValue(request)
        mocks.mediaRequestModel.transition.mockImplementation(async ({ request: next }) => next)

        const result = await new MediaGenerationRequestService().bindRunsToLineagePlan({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            lineagePlan,
        })

        expect(result.runs).toEqual([{
            generationRun: 0,
            reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
            reasoningIndex: 0,
            reasoningRunId: 'media-request-1:reasoning:0',
            provider: 'Stability',
            modelId: 'Stability:sd3.5-large',
            mediaRunId: 'media-request-1:reasoning:0:image:0',
            mediaType: 'image',
            mediaIndex: 0,
            outputAssetId: 'asset-image-1',
            outputNodeId: getPendingGeneratedMediaNodeId(lineagePlan.runAssignments[0]!),
            status: 'pending',
            operationNodeId,
        }])
        expect(result.plannedCanvasNodeIds).toEqual([
            operationNodeId,
            getPendingGeneratedMediaNodeId(lineagePlan.runAssignments[0]!),
            'branch-origin-1',
        ])
        expect(mocks.mediaRequestModel.transition).toHaveBeenCalledWith({
            request: expect.objectContaining({
                runs: result.runs,
                plannedCanvasNodeIds: result.plannedCanvasNodeIds,
                revision: 2,
            }),
            expectedRevision: 1,
        })
        expect(mocks.operationProjection.rebind).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            generationRequestId: 'media-request-1',
            requestRevision: 2,
            bindings: [{
                previousNodeId: operationNodeId,
                previousOutputNodeId: getPendingGeneratedMediaNodeId(lineagePlan.runAssignments[0]!),
                operationNodeId,
                lineageParentNodeId: 'branch-origin-1',
                lineageAssignment: lineagePlan.runAssignments[0],
                run: result.runs[0],
            }],
        })
    })

    it('projects a provisional lineage marker in the same create transaction as pending media slots', async () => {
        const lineagePlan = imageLineagePlan()
        const assignment = lineagePlan.runAssignments[0]!
        const run: MediaGenerationRun = {
            generationRun: 0,
            reasoningModelId: assignment.reasoningModelId!,
            reasoningIndex: assignment.reasoningIndex!,
            reasoningRunId: assignment.reasoningRunId,
            provider: 'Stability',
            modelId: assignment.mediaModelId!,
            mediaRunId: assignment.mediaRunId,
            mediaType: 'image',
            mediaIndex: 0,
            outputAssetId: assignment.assetId,
            outputNodeId: getPendingGeneratedMediaNodeId(assignment),
            status: 'pending',
            operationNodeId: getMediaGenerationOperationNodeId(assignment),
        }
        mocks.operationProjection.project.mockResolvedValue({
            generationRequestId: 'media-request-1',
            layoutRevision: 10,
            nodes: [{ nodeId: run.outputNodeId!, position: { x: 0, y: 0 }, dimensions: { width: 800, height: 800 } }],
        })
        mocks.canvasProjection.upsertLineage.mockResolvedValue({
            generationRequestId: 'media-request-1',
            layoutRevision: 11,
            nodes: [{ nodeId: 'branch-origin-1', position: { x: -200, y: 0 }, dimensions: { width: 120, height: 60 } }],
        })
        const eventLog = { append: vi.fn(async () => undefined) }
        const onCanvasGeometryProjected = vi.fn()

        const result = await new MediaGenerationRequestService(eventLog as never).create({
            generationRequestId: 'media-request-1',
            workspaceId: 'workspace-1',
            organizationId: 'organization-1',
            userId: 'user-1',
            conversationAssetId: 'conversation-1',
            checkpoint: {
                promptDocument: { type: 'doc' },
                selectedReferences: [],
                modelSelection: {},
                configuration: {},
            },
            bindings: [],
            unresolvedBindings: [],
            runs: [run],
            initialLineagePlan: lineagePlan,
            onCanvasGeometryProjected,
        })

        expect(mocks.operationProjection.project).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            generationRequestId: 'media-request-1',
            runs: [run],
            bindings: [],
            lineagePlan,
        })
        expect(mocks.canvasProjection.upsertLineage).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            conversationAssetId: 'conversation-1',
            lineagePlan,
        })
        expect(result.plannedCanvasNodeIds).toEqual([
            run.operationNodeId,
            run.outputNodeId,
            'branch-origin-1',
        ])
        expect(onCanvasGeometryProjected).toHaveBeenCalledWith(expect.objectContaining({
            layoutRevision: 11,
            nodes: expect.arrayContaining([
                expect.objectContaining({ nodeId: run.outputNodeId }),
                expect.objectContaining({ nodeId: 'branch-origin-1' }),
            ]),
        }))
    })
})

describe('media generation request terminal settlement', () => {
    it('publishes live progress without rewriting the Workspace canvas projection', async () => {
        const run = {
            ...pendingRun(),
            status: 'running' as const,
            progress: {
                phase: 'rendering' as const,
                completedSteps: 1,
                totalSteps: 3,
                message: 'Provider rendering is active: 2m elapsed.',
            },
        }
        const request: MediaGenerationRequest = {
            ...deferredRequest(),
            status: 'running',
            runs: [run],
        }
        const eventLog = { append: vi.fn(async () => undefined) }
        mocks.mediaRequestModel.get.mockResolvedValue(request)
        mocks.mediaRequestModel.transition.mockResolvedValue(undefined)

        const result = await new MediaGenerationRequestService(eventLog as never).recordRunProgress({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
            mediaModelId: run.modelId,
            reasoningIndex: run.reasoningIndex,
            mediaRunId: run.mediaRunId,
            progress: {
                ...run.progress,
                message: 'Provider rendering is active: 2m 5s elapsed.',
            },
        })

        expect(result.revision).toBe(2)
        expect(mocks.mediaRequestModel.transition).toHaveBeenCalledOnce()
        expect(mocks.operationProjection.update).not.toHaveBeenCalled()
        expect(eventLog.append).toHaveBeenCalledWith(expect.objectContaining({
            event: expect.objectContaining({
                status: 'MEDIA_GENERATION_PROGRESS',
                payload: expect.objectContaining({
                    message: 'Provider rendering is active: 2m 5s elapsed.',
                }),
            }),
        }))
    })

    it('ignores late progress and status writes after durable cancellation', async () => {
        const cancelledRequest: MediaGenerationRequest = {
            ...deferredRequest(),
            status: 'cancelled',
            runs: [{ ...pendingRun(), status: 'running' }],
        }
        mocks.mediaRequestModel.get.mockResolvedValue(cancelledRequest)
        const service = new MediaGenerationRequestService()
        const run = cancelledRequest.runs[0]!

        const progressResult = await service.recordRunProgress({
            generationRequestId: cancelledRequest.generationRequestId,
            workspaceId: cancelledRequest.workspaceId,
            mediaModelId: run.modelId,
            reasoningIndex: run.reasoningIndex,
            mediaRunId: run.mediaRunId,
            progress: {
                phase: 'rendering',
                completedSteps: 1,
                totalSteps: 3,
                message: 'Late provider progress',
            },
        })
        const statusResult = await service.recordRunStatus({
            generationRequestId: cancelledRequest.generationRequestId,
            workspaceId: cancelledRequest.workspaceId,
            mediaModelId: run.modelId,
            reasoningIndex: run.reasoningIndex,
            mediaRunId: run.mediaRunId,
            status: 'failed',
        })

        expect(progressResult).toBe(cancelledRequest)
        expect(statusResult).toBe(cancelledRequest)
        expect(mocks.mediaRequestModel.transition).not.toHaveBeenCalled()
        expect(mocks.operationProjection.update).not.toHaveBeenCalled()
        expect(mocks.canvasProjection.settleFailed).not.toHaveBeenCalled()
    })

    it('cancels the latest active request revision for an authoritative output deletion', async () => {
        const activeRequest: MediaGenerationRequest = {
            ...deferredRequest(),
            status: 'running',
            revision: 5,
            runs: [{ ...pendingRun(), status: 'running' }],
        }
        const eventLog = {
            append: vi.fn(async () => undefined),
            purgeRequest: vi.fn(async () => undefined),
        }
        mocks.mediaRequestModel.getAuthorized.mockResolvedValue(activeRequest)
        mocks.mediaRequestModel.transition.mockImplementation(async ({ request }) => request)

        const result = await new MediaGenerationRequestService(eventLog as never).cancelCurrent({
            generationRequestId: activeRequest.generationRequestId,
            workspaceId: activeRequest.workspaceId,
            userId: activeRequest.userId,
        })

        expect(result).toMatchObject({ status: 'cancelled', revision: 6 })
        expect(mocks.mediaRequestModel.transition).toHaveBeenCalledWith({
            request: expect.objectContaining({ status: 'cancelled', revision: 6 }),
            expectedRevision: 5,
        })
        expect(mocks.operationProjection.removeAll).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            generationRequestId: 'media-request-1',
            terminalStatus: 'cancelled',
            discardUnboundOutputNodes: true,
        })
        expect(mocks.assetModel.removeAssetSurfaceReferenceSystem).toHaveBeenCalledWith({
            assetId: 'asset-image-1',
            organizationId: 'organization-1',
            surfaceId: 'conversation#conversation-1#media#media-request-1:reasoning:0:image:0',
        })
        expect(mocks.blobModel.removeReference).toHaveBeenCalledWith(expect.objectContaining({
            referenceKey: 'mediaGenerationRequest#media-request-1#checkpoint',
        }))
    })

    it('dismisses an already-terminal request even when the rendered card revision is stale', async () => {
        const terminalRequest: MediaGenerationRequest = {
            ...deferredRequest(),
            status: 'completed-with-errors',
            revision: 7,
            runs: [{ ...pendingRun(), status: 'failed' }],
        }
        mocks.mediaRequestModel.getAuthorized.mockResolvedValue(terminalRequest)

        const result = await new MediaGenerationRequestService().cancel({
            generationRequestId: terminalRequest.generationRequestId,
            workspaceId: terminalRequest.workspaceId,
            userId: terminalRequest.userId,
            requestRevision: 2,
        })

        expect(result).toBe(terminalRequest)
        expect(mocks.operationProjection.removeAll).toHaveBeenCalledWith({
            workspaceId: terminalRequest.workspaceId,
            generationRequestId: terminalRequest.generationRequestId,
            terminalStatus: 'completed',
            discardUnboundOutputNodes: true,
        })
        expect(mocks.mediaRequestModel.transition).not.toHaveBeenCalled()
    })

    it('fails a pending durable run and projects an actionable problem before request completion', async () => {
        const request = {
            ...deferredRequest(),
            runs: [pendingRun()],
        }
        const eventLog = { append: vi.fn(async () => undefined) }
        mocks.mediaRequestModel.get.mockResolvedValue(request)
        mocks.mediaRequestModel.transition.mockResolvedValue(undefined)

        const result = await new MediaGenerationRequestService(eventLog as never).failUnfinishedRuns({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
        })

        expect(result).toMatchObject({ status: 'failed' })
        expect(mocks.mediaRequestModel.transition).toHaveBeenCalledWith({
            request: expect.objectContaining({
                status: 'failed',
                revision: 2,
                runs: [expect.objectContaining({
                    status: 'failed',
                    problem: expect.objectContaining({
                        type: 'urn:lixpi:media-problem:media-invocation-missing',
                        action: 'none',
                    }),
                })],
            }),
            expectedRevision: 1,
        })
        expect(mocks.canvasProjection.settleFailed).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            outputNodeId: 'pending-image-1',
            assetId: 'asset-image-1',
            requestRevision: 2,
            problem: expect.objectContaining({
                type: 'urn:lixpi:media-problem:media-invocation-missing',
            }),
            generationRun: expect.objectContaining({
                generationRequestId: 'media-request-1',
                mediaRunId: 'media-request-1:reasoning:0:image:0',
                mediaIndex: 0,
                variantIndex: 0,
            }),
        }))
        expect(mocks.operationProjection.update).not.toHaveBeenCalled()
        expect(eventLog.append).toHaveBeenCalledWith(expect.objectContaining({
            event: expect.objectContaining({
                status: 'MEDIA_GENERATION_PROBLEM',
                payload: expect.objectContaining({ runStatus: 'failed' }),
            }),
        }))
    })

    it('preserves a reference-resolution pause instead of terminalizing its pending runs', async () => {
        const request = {
            ...deferredRequest(),
            status: 'awaiting-reference-resolution' as const,
            runs: [pendingRun()],
        }
        mocks.mediaRequestModel.get.mockResolvedValue(request)

        const result = await new MediaGenerationRequestService().failUnfinishedRuns({
            generationRequestId: request.generationRequestId,
            workspaceId: request.workspaceId,
        })

        expect(result).toBe(request)
        expect(mocks.mediaRequestModel.transition).not.toHaveBeenCalled()
        expect(mocks.operationProjection.update).not.toHaveBeenCalled()
    })
})
