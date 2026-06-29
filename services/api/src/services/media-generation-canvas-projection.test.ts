'use strict'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasState, MediaBranchLineagePlan, MediaGenerationRunMeta } from '@lixpi/constants'

const workspaceMutateCanvasState = vi.hoisted(() => vi.fn())

vi.mock('../models/workspace.ts', () => ({
    default: {
        mutateCanvasState: workspaceMutateCanvasState,
    },
}))

import {
    upsertGeneratedImageToCanvas,
    upsertGeneratedVideoToCanvas,
    upsertMediaLineagePlanToCanvas,
} from './media-generation-canvas-projection.ts'

const emptyCanvasState = (): CanvasState => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
})

const latestMutator = (): ((canvasState: CanvasState) => { canvasState: CanvasState, changed: boolean }) => {
    const call = workspaceMutateCanvasState.mock.calls.at(-1)
    expect(call).toBeDefined()
    return call![0].mutate
}

const lineagePlan = (): MediaBranchLineagePlan => ({
    planVersion: 'media-branch-lineage-v1',
    generationRequestId: 'request-1',
    branchId: 'branch-1',
    promptText: 'make it brighter',
    referenceNodeIds: ['ref-1'],
    sourceContextNodeIds: ['ctx-1'],
    branchOrigin: {
        nodeId: 'origin-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        provenance: {
            kind: 'branch-root-fork-decision',
            promptText: 'make it brighter',
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            forked: true,
            forkCount: 1,
        },
    },
    branchForks: [{
        nodeId: 'fork-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        parentBranchNodeId: 'origin-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        provenance: {
            kind: 'reasoning-run',
            promptText: 'make it brighter',
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
        },
    }],
    branchLines: [{
        nodeId: 'line-1',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        parentBranchNodeId: 'fork-1',
        reasoningRunId: 'reasoning-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        reasoningIndex: 0,
        mediaRunId: 'media-1',
        mediaModelId: 'Google:gemini-2.5-flash-image',
        mediaType: 'image',
        provenance: {
            kind: 'branch-continuation',
            promptText: 'make it brighter',
            referenceNodeIds: ['ref-1'],
            sourceContextNodeIds: ['ctx-1'],
            reasoningRunId: 'reasoning-1',
            reasoningModelId: 'Anthropic:claude-sonnet-4-6',
            reasoningIndex: 0,
            mediaModelId: 'Google:gemini-2.5-flash-image',
            mediaType: 'image',
        },
    }],
    runAssignments: [],
    createdAt: 123,
})

const generationRun = (): MediaGenerationRunMeta => ({
    requestKind: 'media-generation-matrix',
    generationRequestId: 'request-1',
    reasoningRunId: 'reasoning-1',
    mediaRunId: 'media-1',
    reasoningModelId: 'Anthropic:claude-sonnet-4-6',
    mediaModelId: 'Google:gemini-2.5-flash-image',
    mediaType: 'image',
    reasoningIndex: 0,
    mediaIndex: 0,
    variantIndex: 0,
    lineageAssignment: {
        generationRequestId: 'request-1',
        reasoningRunId: 'reasoning-1',
        mediaRunId: 'media-1',
        reasoningModelId: 'Anthropic:claude-sonnet-4-6',
        mediaModelId: 'Google:gemini-2.5-flash-image',
        mediaType: 'image',
        branchId: 'branch-1',
        branchOriginNodeId: 'origin-1',
        branchForkNodeId: 'fork-1',
        lineageParentNodeId: 'fork-1',
        referenceNodeIds: ['ref-1'],
        sourceContextNodeIds: ['ctx-1'],
        operationKind: 'fresh_branch',
        promptText: 'make it brighter',
        promptFingerprint: 'prompt-fingerprint',
        createdAt: 123,
    },
})

describe('media-generation-canvas-projection', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('projects API media lineage plans into durable branch marker nodes and edges idempotently', async () => {
        const plan = lineagePlan()

        await upsertMediaLineagePlanToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            lineagePlan: plan,
        })

        expect(workspaceMutateCanvasState).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: 'workspace-1',
            origin: 'upsertMediaLineagePlanToCanvas',
        }))

        const first = latestMutator()(emptyCanvasState())
        expect(first.changed).toBe(true)
        expect(first.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin', aiChatThreadId: 'thread-1' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork', parentBranchNodeId: 'origin-1' }),
            expect.objectContaining({ nodeId: 'line-1', type: 'branchLine', parentBranchNodeId: 'fork-1', mediaRunId: 'media-1' }),
        ]))
        expect(first.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ edgeId: 'edge-origin-1-fork-1', sourceNodeId: 'origin-1', targetNodeId: 'fork-1' }),
            expect.objectContaining({ edgeId: 'edge-fork-1-line-1', sourceNodeId: 'fork-1', targetNodeId: 'line-1' }),
        ]))

        const second = latestMutator()(first.canvasState)
        expect(second.changed).toBe(false)
    })

    it('persists final generated images with API lineage metadata and connector edges', async () => {
        const run = generationRun()

        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            responseId: 'response-1',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun: run,
        })

        const first = latestMutator()(emptyCanvasState())
        expect(first.changed).toBe(true)
        expect(first.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork' }),
            expect.objectContaining({
                nodeId: 'node-file-1',
                type: 'image',
                fileId: 'file-1',
                src: '/api/images/workspace-1/file-1',
                generatedBy: expect.objectContaining({
                    aiChatThreadId: 'thread-1',
                    responseId: 'response-1',
                    generationRequestId: 'request-1',
                    reasoningRunId: 'reasoning-1',
                    mediaRunId: 'media-1',
                    branchId: 'branch-1',
                    branchForkNodeId: 'fork-1',
                    referenceImageNodeIds: ['ref-1'],
                    sourceContextNodeIds: ['ctx-1'],
                    promptText: 'make it brighter',
                }),
            }),
        ]))
        expect(first.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'origin-1', targetNodeId: 'fork-1' }),
            expect.objectContaining({ sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' }),
        ]))

        const second = latestMutator()(first.canvasState)
        expect(second.changed).toBe(false)
    })

    it('still reports a changed canvas when an existing media node only needs missing lineage markers', async () => {
        const run = generationRun()
        await upsertGeneratedImageToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            imageUrl: '/api/images/workspace-1/file-1',
            fileId: 'file-1',
            responseId: 'response-1',
            revisedPrompt: 'a brighter image',
            aiProvider: 'Google',
            imageModelProvider: 'Google',
            imageModelId: 'gemini-2.5-flash-image',
            generationRun: run,
        })

        const canvasWithExistingImageOnly: CanvasState = {
            ...emptyCanvasState(),
            nodes: [{
                nodeId: 'node-file-1',
                type: 'image',
                fileId: 'file-1',
                workspaceId: 'workspace-1',
                src: '/api/images/workspace-1/file-1',
                aspectRatio: 1,
                position: { x: 0, y: 0 },
                dimensions: { width: 600, height: 600 },
                generatedBy: {
                    aiChatThreadId: 'thread-1',
                    responseId: 'response-1',
                    aiModel: 'Anthropic:claude-sonnet-4-6',
                    imageModelProvider: 'Google',
                    revisedPrompt: 'a brighter image',
                    mediaRunId: 'media-1',
                },
            }],
        }

        const result = latestMutator()(canvasWithExistingImageOnly)
        expect(result.changed).toBe(true)
        expect(result.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'origin-1', type: 'branchOrigin' }),
            expect.objectContaining({ nodeId: 'fork-1', type: 'branchFork' }),
            expect.objectContaining({ nodeId: 'node-file-1', type: 'image' }),
        ]))
        expect(result.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'fork-1', targetNodeId: 'node-file-1' }),
        ]))
    })

    it('persists final generated videos with poster metadata and parsed dimensions', async () => {
        const run: MediaGenerationRunMeta = {
            ...generationRun(),
            mediaModelId: 'Google:veo-3.1-generate-preview',
            mediaType: 'video',
            lineageAssignment: {
                ...generationRun().lineageAssignment!,
                mediaModelId: 'Google:veo-3.1-generate-preview',
                mediaType: 'video',
                branchLineNodeId: 'line-1',
                lineageParentNodeId: 'line-1',
            },
        }

        await upsertGeneratedVideoToCanvas({
            workspaceId: 'workspace-1',
            aiChatThreadId: 'thread-1',
            videoUrl: '/api/videos/workspace-1/video-1',
            fileId: 'video-1',
            posterUrl: '/api/images/workspace-1/poster-1',
            posterFileId: 'poster-1',
            frameUrl: '/api/images/workspace-1/frame-1',
            frameFileId: 'frame-1',
            durationSeconds: 8,
            aspectRatio: '16:9',
            hasAudio: true,
            responseId: 'response-1',
            revisedPrompt: 'a brighter video',
            aiProvider: 'Google',
            videoModelProvider: 'Google',
            videoModelId: 'veo-3.1-generate-preview',
            generationRun: run,
        })

        const result = latestMutator()(emptyCanvasState())
        expect(result.changed).toBe(true)
        expect(result.canvasState.nodes).toEqual(expect.arrayContaining([
            expect.objectContaining({ nodeId: 'line-1', type: 'branchLine', mediaType: 'video' }),
            expect.objectContaining({
                nodeId: 'node-video-1',
                type: 'video',
                fileId: 'video-1',
                posterFileId: 'poster-1',
                frameFileId: 'frame-1',
                aspectRatio: 16 / 9,
                generatedBy: expect.objectContaining({
                    videoModel: 'Google:veo-3.1-generate-preview',
                    videoModelProvider: 'Google',
                    branchLineNodeId: 'line-1',
                    durationSeconds: 8,
                    aspectRatio: '16:9',
                    hasAudio: true,
                }),
            }),
        ]))
        expect(result.canvasState.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceNodeId: 'line-1', targetNodeId: 'node-video-1' }),
        ]))
    })
})
