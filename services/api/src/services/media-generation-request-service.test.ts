'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    type MediaBranchLineagePlan,
    type MediaGenerationRequest,
} from '@lixpi/constants'
import { getMediaGenerationOperationNodeId } from '@lixpi/canvas-engine'

const mocks = vi.hoisted(() => ({
    mediaRequestModel: {
        get: vi.fn(),
        transition: vi.fn(),
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
            provider: 'Stability',
            modelId: 'Stability:sd3.5-large',
            status: 'pending',
            operationNodeId,
        }])
        expect(result.plannedCanvasNodeIds).toEqual([operationNodeId])
        expect(mocks.mediaRequestModel.transition).toHaveBeenCalledWith({
            request: expect.objectContaining({
                runs: result.runs,
                plannedCanvasNodeIds: [operationNodeId],
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
                operationNodeId,
                lineageParentNodeId: 'branch-origin-1',
                run: result.runs[0],
            }],
        })
    })
})
