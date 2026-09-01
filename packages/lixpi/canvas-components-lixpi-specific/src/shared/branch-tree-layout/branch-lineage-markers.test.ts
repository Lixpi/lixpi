import {
    describe,
    it,
    expect,
} from 'vitest'
import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    DocumentCanvasNode,
    ImageCanvasNode,
    VideoCanvasNode,
} from '@lixpi/constants'

import {
    getGeneratedMediaLineageMarkerIds,
    getGeneratedMediaMidpointMarkerId,
    getStartedLineageMarkerState,
    isBranchLineageMarkerNode,
    isGeneratedMediaNode,
} from './branch-lineage-state.ts'

// =============================================================================
// HELPERS
// =============================================================================

type GeneratedByOverrides = Partial<NonNullable<ImageCanvasNode['generatedBy']>>

function makeGeneratedBy(overrides: GeneratedByOverrides = {}): NonNullable<ImageCanvasNode['generatedBy']> {
    return {
        aiChatThreadId: 'thread-1',
        responseId: 'response-1',
        aiModel: 'image-model' as any,
        revisedPrompt: 'prompt',
        branchId: 'branch-1',
        createdAt: 1,
        ...overrides,
    }
}

function makeImage(
    overrides: Partial<ImageCanvasNode> & {
        nodeId: string
        generatedBy?: GeneratedByOverrides | null
    },
): ImageCanvasNode {
    const { generatedBy, ...rest } = overrides
    return {
        nodeId: rest.nodeId,
        type: 'image',
        fileId: rest.fileId ?? `file-${rest.nodeId}`,
        workspaceId: rest.workspaceId ?? 'workspace-1',
        src: rest.src ?? `/image/${rest.nodeId}`,
        aspectRatio: rest.aspectRatio ?? 1,
        position: rest.position ?? { x: 0, y: 0 },
        dimensions: rest.dimensions ?? { width: 100, height: 100 },
        ...(generatedBy === null
            ? {}
            : { generatedBy: makeGeneratedBy(generatedBy) }),
        ...rest,
    }
}

function makeVideo(
    overrides: Partial<VideoCanvasNode> & {
        nodeId: string
        generatedBy?: Partial<NonNullable<VideoCanvasNode['generatedBy']>> | null
    },
): VideoCanvasNode {
    const { generatedBy, ...rest } = overrides
    return {
        nodeId: rest.nodeId,
        type: 'video',
        fileId: rest.fileId ?? `file-${rest.nodeId}`,
        posterFileId: rest.posterFileId ?? `poster-${rest.nodeId}`,
        workspaceId: rest.workspaceId ?? 'workspace-1',
        src: rest.src ?? `/video/${rest.nodeId}`,
        posterSrc: rest.posterSrc ?? `/poster/${rest.nodeId}`,
        aspectRatio: rest.aspectRatio ?? 1,
        durationSeconds: rest.durationSeconds ?? 4,
        hasAudio: rest.hasAudio ?? false,
        position: rest.position ?? { x: 0, y: 0 },
        dimensions: rest.dimensions ?? { width: 100, height: 100 },
        ...(generatedBy === null
            ? {}
            : {
                generatedBy: {
                    aiChatThreadId: 'thread-1',
                    responseId: 'response-1',
                    videoModel: 'video-model' as any,
                    revisedPrompt: 'prompt',
                    branchId: 'branch-1',
                    createdAt: 1,
                    ...generatedBy,
                },
            }),
        ...rest,
    }
}

function makeDocument(nodeId: string): DocumentCanvasNode {
    return {
        nodeId,
        type: 'document',
        referenceId: `doc-${nodeId}`,
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 100 },
    }
}

function makeBranchOrigin(nodeId: string): BranchOriginCanvasNode {
    return {
        nodeId,
        type: 'branchOrigin',
        branchId: 'branch-1',
        generationRequestId: 'request-1',
        position: { x: 0, y: 0 },
        dimensions: { width: 80, height: 40 },
        temporary: true,
    }
}

function makeBranchFork(nodeId: string, parentBranchNodeId?: string): BranchForkCanvasNode {
    return {
        nodeId,
        type: 'branchFork',
        branchId: 'branch-1',
        generationRequestId: 'request-1',
        parentBranchNodeId,
        reasoningRunId: `run-${nodeId}`,
        reasoningModelId: 'reasoning-model' as any,
        reasoningIndex: 0,
        position: { x: 0, y: 0 },
        dimensions: { width: 80, height: 40 },
        temporary: true,
    }
}

function makeBranchLine(nodeId: string, parentBranchNodeId?: string): BranchLineCanvasNode {
    return {
        nodeId,
        type: 'branchLine',
        branchId: 'branch-1',
        generationRequestId: 'request-1',
        parentBranchNodeId,
        reasoningRunId: `run-${nodeId}`,
        reasoningModelId: 'reasoning-model' as any,
        reasoningIndex: 0,
        position: { x: 0, y: 0 },
        dimensions: { width: 80, height: 40 },
        temporary: true,
    }
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

describe('branchLineageState — type guards', () => {
    it('recognizes image and video media nodes without relying on generatedBy', () => {
        expect(isGeneratedMediaNode(makeImage({ nodeId: 'image', generatedBy: null }))).toBe(true)
        expect(isGeneratedMediaNode(makeVideo({ nodeId: 'video', generatedBy: null }))).toBe(true)
        expect(isGeneratedMediaNode(makeDocument('document'))).toBe(false)
        expect(isGeneratedMediaNode(makeBranchFork('fork'))).toBe(false)
    })

    it('recognizes every branch-lineage marker and safely rejects undefined', () => {
        expect(isBranchLineageMarkerNode(makeBranchOrigin('origin'))).toBe(true)
        expect(isBranchLineageMarkerNode(makeBranchFork('fork'))).toBe(true)
        expect(isBranchLineageMarkerNode(makeBranchLine('line'))).toBe(true)
        expect(isBranchLineageMarkerNode(makeImage({ nodeId: 'image' }))).toBe(false)
        expect(isBranchLineageMarkerNode(undefined)).toBe(false)
    })
})

// =============================================================================
// GENERATED-MEDIA MARKER IDS
// =============================================================================

describe('branchLineageState — generated-media marker ids', () => {
    it('returns every unique lineage marker referenced by generated media', () => {
        const media = makeImage({
            nodeId: 'media',
            generatedBy: {
                branchOriginNodeId: 'origin',
                branchForkNodeId: 'origin',
                branchLineNodeId: 'line',
            },
        })

        expect(getGeneratedMediaLineageMarkerIds(media)).toEqual(['origin', 'line'])
    })

    it('keeps connector-midpoint marker selection separate from branch-origin ownership', () => {
        expect(getGeneratedMediaMidpointMarkerId(makeImage({
            nodeId: 'origin-only',
            generatedBy: { branchOriginNodeId: 'origin' },
        }))).toBeUndefined()
        expect(getGeneratedMediaMidpointMarkerId(makeImage({
            nodeId: 'line-only',
            generatedBy: { branchLineNodeId: 'line' },
        }))).toBe('line')
        expect(getGeneratedMediaMidpointMarkerId(makeImage({
            nodeId: 'fork-and-line',
            generatedBy: { branchForkNodeId: 'fork', branchLineNodeId: 'line' },
        }))).toBe('fork')
    })
})

// =============================================================================
// STARTED MARKER STATE
// =============================================================================

describe('branchLineageState — started marker state', () => {
    it('collects started origin/fork/line markers and the parents with started marker children', () => {
        const nodes: CanvasNode[] = [
            makeBranchOrigin('origin'),
            makeBranchFork('fork', 'origin'),
            makeBranchLine('line', 'fork'),
            makeImage({
                nodeId: 'image-child',
                generatedBy: {
                    branchOriginNodeId: 'origin',
                    branchForkNodeId: 'fork',
                },
            }),
            makeVideo({
                nodeId: 'video-child',
                generatedBy: {
                    branchLineNodeId: 'line',
                },
            }),
            makeImage({ nodeId: 'loose-image', generatedBy: null }),
        ]

        const state = getStartedLineageMarkerState(nodes)

        expect(state.markerIdsWithGeneratedChildren).toEqual(new Set(['origin', 'fork', 'line']))
        expect(state.parentIdsWithStartedMarkerChildren).toEqual(new Set(['origin', 'fork']))
    })
})
