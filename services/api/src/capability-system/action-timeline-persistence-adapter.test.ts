'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildActionTimelineDocument } from '@lixpi/capability-system'

const mocks = vi.hoisted(() => ({
    assetCreate: vi.fn(),
    attachWorkspaceReference: vi.fn(),
    detachWorkspaceReference: vi.fn(),
    detachCatalogReference: vi.fn(),
    blobStore: vi.fn(),
    getAssetRecord: vi.fn(),
    getAssetRequesterContext: vi.fn(),
    getWorkspace: vi.fn(),
    getOrganization: vi.fn(),
    projectGeneratedArtifactNode: vi.fn(),
    buildAssetCanvasGeometryUpdate: vi.fn(),
}))

vi.mock('../models/asset.ts', () => ({
    default: {
        create: mocks.assetCreate,
        attachWorkspaceReference: mocks.attachWorkspaceReference,
        detachWorkspaceReference: mocks.detachWorkspaceReference,
        detachCatalogReference: mocks.detachCatalogReference,
    },
    getAssetRecord: mocks.getAssetRecord,
}))
vi.mock('../models/blob.ts', () => ({
    default: { store: mocks.blobStore },
}))
vi.mock('../models/workspace.ts', () => ({
    default: { getWorkspace: mocks.getWorkspace },
}))
vi.mock('../models/organization.ts', () => ({
    default: { getOrganization: mocks.getOrganization },
}))
vi.mock('../services/asset-requester-context.ts', () => ({
    getAssetRequesterContext: mocks.getAssetRequesterContext,
}))
vi.mock('../services/asset-canvas-projection.ts', () => ({
    projectGeneratedArtifactNode: mocks.projectGeneratedArtifactNode,
    buildAssetCanvasGeometryUpdate: mocks.buildAssetCanvasGeometryUpdate,
}))
vi.mock('../services/asset-maintenance-queue.ts', () => ({
    enqueueBlobDeletion: vi.fn(),
}))

import {
    discardStagedActionTimelineArtifact,
    finalizeActionTimelineArtifact,
    persistActionTimelineArtifact,
} from './action-timeline-persistence-adapter.ts'

const input = {
    prompt: 'Create a timed chase',
    durationMs: 2000,
    precisionMs: 1000,
    referenceAssetIds: ['source-1'],
}
const variant = {
    axis: 'reasoning-model' as const,
    variantKey: 'reasoning:0:Anthropic:claude',
    reasoningIndex: 0,
    reasoningModelId: 'Anthropic:claude',
    provider: 'Anthropic' as const,
    modelVersion: 'claude',
    contextWindow: 100000,
    maxCompletionSize: 8192,
}
const generationRun = {
    requestKind: 'capability-output' as const,
    generationRequestId: 'request-1',
    reasoningRunId: 'request-1:reasoning:0',
    reasoningModelId: 'Anthropic:claude',
    reasoningIndex: 0,
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAssetRequesterContext.mockResolvedValue({
        userId: 'user-1',
        editableWorkspaceIds: ['workspace-1'],
        workspaceIds: ['workspace-1'],
        organizationIds: ['organization-1'],
    })
    mocks.getWorkspace.mockResolvedValue({
        workspaceId: 'workspace-1',
        organizationId: 'organization-1',
        accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
        updatedAt: 5,
        canvasStateUpdatedAt: 5,
        canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
    })
    mocks.getOrganization.mockResolvedValue({ organizationId: 'organization-1' })
    mocks.blobStore
        .mockResolvedValueOnce({ blobHash: 'artifact-hash' })
        .mockResolvedValueOnce({ blobHash: 'provenance-hash' })
    mocks.attachWorkspaceReference.mockResolvedValue({ referenceKey: 'attached' })
    mocks.detachWorkspaceReference.mockResolvedValue({ referenceKey: 'detached' })
    mocks.detachCatalogReference.mockResolvedValue({ referenceKey: 'catalog-detached' })
})

describe('Action Timeline Artifact publication', () => {
    it('stages the Asset without mutating Workspace canvas membership', async () => {
        const document = buildActionTimelineDocument(input, [{
            slotIndex: 0,
            runs: [{ text: 'Run through the rain' }],
        }, {
            slotIndex: 1,
            runs: [{ assetId: 'source-1' }],
        }])

        const result = await persistActionTimelineArtifact({
            input,
            document,
            referencedAssetIds: ['source-1'],
            context: {
                userId: 'user-1',
                workspaceId: 'workspace-1',
                organizationId: 'organization-1',
                conversationAssetId: 'conversation-1',
                rootCapabilityId: 'action-timeline',
                runId: 'run-1',
                origin: 'model',
                invocationGenerationRequestId: 'request-1',
                variant,
            } as any,
        })

        expect(result).toEqual({ assetId: expect.any(String) })
        expect(mocks.assetCreate).toHaveBeenCalledWith(expect.objectContaining({
            states: expect.objectContaining({ lifecycle: 'creating' }),
        }))
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledTimes(1)
        expect(mocks.attachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'source-1',
            surfaceId: expect.stringMatching(/^capabilityArtifact#/),
        }))
        expect(mocks.getWorkspace).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            userId: 'user-1',
        })
        expect(mocks.projectGeneratedArtifactNode).not.toHaveBeenCalled()
    })

    it('attaches and activates the staged Artifact only during finalization', async () => {
        mocks.getAssetRecord.mockResolvedValue({
            assetId: 'artifact-1',
            organizationId: 'organization-1',
            originWorkspaceId: 'workspace-1',
            artifact: { artifactTypeId: 'action-timeline' },
            lineage: {
                sourceConversationAssetId: 'conversation-1',
                generationRequestId: 'request-1',
                reasoningRunId: 'request-1:reasoning:0',
                reasoningModelId: 'Anthropic:claude',
                sourceAssetIds: ['source-1'],
            },
            states: { lifecycle: 'creating' },
            createdAt: 1,
        })
        mocks.getWorkspace.mockResolvedValue({
            workspaceId: 'workspace-1',
            organizationId: 'organization-1',
            accessList: [{ userId: 'user-1', accessLevel: 'owner' }],
            updatedAt: 5,
            canvasStateUpdatedAt: 5,
            canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
        })
        mocks.projectGeneratedArtifactNode.mockReturnValue({
            canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
            nodeId: 'capability-artifact-artifact-1',
            geometryNodes: [],
        })
        mocks.buildAssetCanvasGeometryUpdate.mockReturnValue({ layoutRevision: 6, nodes: [] })

        await expect(finalizeActionTimelineArtifact({
            assetId: 'artifact-1',
            capabilityRunId: 'run-1',
            input,
            variant,
            generationRun,
            workspaceId: 'workspace-1',
            userId: 'user-1',
            organizationId: 'organization-1',
            conversationAssetId: 'conversation-1',
        })).resolves.toEqual({
            canvasGeometry: { layoutRevision: 6, nodes: [] },
            generationRun: expect.objectContaining({
                requestKind: 'capability-output',
                lineageAssignment: expect.objectContaining({
                    assetId: 'artifact-1',
                    promptText: input.prompt,
                    referenceAssetIds: ['source-1'],
                }),
            }),
        })

        expect(mocks.attachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'artifact-1',
            nodeId: 'capability-artifact-artifact-1',
            activateOnAttach: true,
            workspaceMutation: expect.objectContaining({ expectedCanvasStateUpdatedAt: 5 }),
        }))
        expect(mocks.projectGeneratedArtifactNode).toHaveBeenCalledWith(expect.objectContaining({
            generationRun: expect.objectContaining({
                lineageAssignment: expect.objectContaining({ assetId: 'artifact-1' }),
            }),
        }))
    })

    it('removes a staged Artifact and its source surfaces after a failed continuation', async () => {
        mocks.getAssetRecord.mockResolvedValue({
            assetId: 'artifact-1',
            organizationId: 'organization-1',
            originWorkspaceId: 'workspace-1',
            lineage: { sourceAssetIds: ['source-1'] },
            states: { lifecycle: 'creating' },
        })

        await discardStagedActionTimelineArtifact({
            assetId: 'artifact-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            organizationId: 'organization-1',
        })

        expect(mocks.detachWorkspaceReference).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'source-1',
            surfaceId: 'capabilityArtifact#artifact-1',
        }))
        expect(mocks.detachCatalogReference).toHaveBeenCalledWith(expect.objectContaining({
            assetId: 'artifact-1',
        }))
    })
})
