'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    type MediaBranchLineagePlan,
    type MediaGenerationRequest,
    type MediaGenerationRun,
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
        transition: vi.fn(),
    },
    blobModel: {
        store: vi.fn(),
        addReference: vi.fn(),
        removeReference: vi.fn(),
    },
    canvasProjection: {
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

vi.mock('./asset-canvas-projection.ts', () => ({
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
