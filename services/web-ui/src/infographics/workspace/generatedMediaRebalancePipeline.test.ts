import { describe, it, expect } from 'vitest'
import type {
    BranchForkCanvasNode,
    BranchLineCanvasNode,
    BranchOriginCanvasNode,
    CanvasNode,
    ImageCanvasNode,
} from '@lixpi/constants'

import {
    GeneratedMediaRebalancePipeline,
    reflowStackedBranchMarkers,
    type BranchMarkerNode,
    type GeneratedMediaRebalancePipelineConfig,
    type Point,
    type Rect,
} from '$src/infographics/workspace/generatedMediaRebalancePipeline.ts'

// =============================================================================
// HELPERS
// =============================================================================

type ImageGeneratedByOverrides = Partial<NonNullable<ImageCanvasNode['generatedBy']>>

function generatedBy(overrides: ImageGeneratedByOverrides = {}): NonNullable<ImageCanvasNode['generatedBy']> {
    return {
        aiChatThreadId: 'thread-1',
        responseId: 'response-1',
        aiModel: 'image-model' as any,
        revisedPrompt: 'prompt',
        generationRequestId: 'request-1',
        branchId: 'branch-1',
        createdAt: 1,
        ...overrides,
    }
}

function image(overrides: Partial<ImageCanvasNode> & {
    nodeId: string
    generatedBy?: ImageGeneratedByOverrides | null
}): ImageCanvasNode {
    const { generatedBy: generatedByOverrides, ...rest } = overrides
    return {
        nodeId: rest.nodeId,
        type: 'image',
        fileId: rest.fileId ?? `file-${rest.nodeId}`,
        workspaceId: rest.workspaceId ?? 'workspace-1',
        src: rest.src ?? `/image/${rest.nodeId}`,
        aspectRatio: rest.aspectRatio ?? 1,
        position: rest.position ?? { x: 0, y: 0 },
        dimensions: rest.dimensions ?? { width: 100, height: 100 },
        ...(generatedByOverrides === null
            ? {}
            : { generatedBy: generatedBy(generatedByOverrides) }),
        ...rest,
    }
}

function pendingState(reasoningIndex = 0): NonNullable<BranchForkCanvasNode['pendingState']> {
    return {
        phase: 'planned',
        promptText: `prompt-${reasoningIndex}`,
        reasoningModelIds: ['reasoning-model' as any],
        reasoningModelId: 'reasoning-model' as any,
        reasoningIndex,
        imageModelIds: ['image-model' as any],
        videoModelIds: [],
    }
}

function branchOrigin(overrides: Partial<BranchOriginCanvasNode> & { nodeId: string }): BranchOriginCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'branchOrigin',
        branchId: overrides.branchId ?? 'branch-1',
        generationRequestId: overrides.generationRequestId ?? 'request-1',
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 80, height: 40 },
        temporary: true,
        ...overrides,
    }
}

function branchFork(overrides: Partial<BranchForkCanvasNode> & { nodeId: string }): BranchForkCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'branchFork',
        branchId: overrides.branchId ?? 'branch-1',
        generationRequestId: overrides.generationRequestId ?? 'request-1',
        reasoningRunId: overrides.reasoningRunId ?? `run-${overrides.nodeId}`,
        reasoningModelId: overrides.reasoningModelId ?? 'reasoning-model' as any,
        reasoningIndex: overrides.reasoningIndex ?? 0,
        parentBranchNodeId: overrides.parentBranchNodeId,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 80, height: 32 },
        temporary: true,
        ...overrides,
    }
}

function branchLine(overrides: Partial<BranchLineCanvasNode> & { nodeId: string }): BranchLineCanvasNode {
    return {
        nodeId: overrides.nodeId,
        type: 'branchLine',
        branchId: overrides.branchId ?? 'branch-1',
        generationRequestId: overrides.generationRequestId ?? 'request-1',
        reasoningRunId: overrides.reasoningRunId ?? `run-${overrides.nodeId}`,
        reasoningModelId: overrides.reasoningModelId ?? 'reasoning-model' as any,
        reasoningIndex: overrides.reasoningIndex ?? 0,
        parentBranchNodeId: overrides.parentBranchNodeId,
        position: overrides.position ?? { x: 0, y: 0 },
        dimensions: overrides.dimensions ?? { width: 80, height: 32 },
        temporary: true,
        ...overrides,
    }
}

function nodesById(nodes: CanvasNode[]): Map<string, CanvasNode> {
    return new Map(nodes.map((node: CanvasNode) => [node.nodeId, node]))
}

function worldPosition(node: CanvasNode): Point {
    return node.position
}

function worldRect(node: CanvasNode): Rect {
    return {
        x: node.position.x,
        y: node.position.y,
        width: node.dimensions.width,
        height: node.dimensions.height,
    }
}

function config(overrides: Partial<GeneratedMediaRebalancePipelineConfig> = {}): GeneratedMediaRebalancePipelineConfig {
    return {
        workspaceId: 'workspace-1',
        mediaSize: 100,
        depthGap: 50,
        branchOriginDepthGap: 40,
        rootMarkerDepthGap: 40,
        siblingGap: 30,
        branchFanoutExtraGap: 0,
        branchOriginMarkerStackGap: 8,
        collisionIterations: 0,
        collisionMargin: 0,
        getPendingGeneratedMediaLayoutGeometry: () => null,
        getPendingGeneratedMediaCircleInset: (dimensions: { width: number; height: number }) => ({
            x: 40,
            y: 40,
            size: Math.max(1, dimensions.width - 80),
        }),
        getNodeWorldPosition: (node: CanvasNode) => worldPosition(node),
        getNodeWorldRect: (node: CanvasNode) => worldRect(node),
        getNodeCollisionRect: (node: CanvasNode, position: Point) => ({
            x: position.x,
            y: position.y,
            width: node.dimensions.width,
            height: node.dimensions.height,
        }),
        getNodeCollisionMargin: () => 0,
        getNodeCollisionOverlapThreshold: () => 0.5,
        ...overrides,
    }
}

// =============================================================================
// GENERATED-MEDIA REBALANCE PIPELINE
// =============================================================================

describe('GeneratedMediaRebalancePipeline', () => {
    it('lays out pending media by visible pre-frame geometry and restores persisted dimensions', () => {
        const root = image({
            nodeId: 'root',
            position: { x: 0, y: 0 },
            dimensions: { width: 100, height: 100 },
            generatedBy: { createdAt: 1 },
        })
        const pending = image({
            nodeId: 'pending',
            position: { x: 1000, y: 1000 },
            dimensions: { width: 100, height: 100 },
            generatedBy: {
                parentMediaNodeId: 'root',
                createdAt: 2,
            },
        })
        const pipeline = new GeneratedMediaRebalancePipeline(config({
            getPendingGeneratedMediaLayoutGeometry: (node: CanvasNode) =>
                node.nodeId === 'pending'
                    ? {
                        position: {
                            x: node.position.x + 40,
                            y: node.position.y + 40,
                        },
                        dimensions: { width: 20, height: 20 },
                    }
                    : null,
        }))

        const result = pipeline.rebalance([root, pending], [])
        const out = nodesById(result.nodes)
        const resolvedPending = out.get('pending')!

        expect(out.get('root')!.position).toEqual({ x: 0, y: 0 })
        expect(resolvedPending.dimensions).toEqual({ width: 100, height: 100 })
        expect(resolvedPending.position).toEqual({ x: 110, y: 0 })
        expect({
            x: resolvedPending.position.x + 40,
            y: resolvedPending.position.y + 40,
        }).toEqual({ x: 150, y: 40 })
        expect(result.startedMarkerNodeIds).toEqual(new Set<string>())
    })

    it('uses planned media proxies to place not-yet-started sibling markers and removes proxy nodes afterward', () => {
        const origin = branchOrigin({
            nodeId: 'origin',
            position: { x: 0, y: 0 },
            dimensions: { width: 80, height: 40 },
        })
        const startedMarker = branchFork({
            nodeId: 'started-fork',
            parentBranchNodeId: 'origin',
            reasoningIndex: 0,
            position: { x: -400, y: -400 },
            dimensions: { width: 60, height: 24 },
        })
        const plannedMarker = branchLine({
            nodeId: 'planned-line',
            parentBranchNodeId: 'origin',
            reasoningIndex: 1,
            pendingState: pendingState(1),
            position: { x: -500, y: -500 },
            dimensions: { width: 60, height: 24 },
        })
        const startedMedia = image({
            nodeId: 'started-media',
            position: { x: 900, y: 900 },
            dimensions: { width: 100, height: 100 },
            generatedBy: {
                branchOriginNodeId: 'origin',
                branchForkNodeId: 'started-fork',
                createdAt: 2,
            },
        })
        const pipeline = new GeneratedMediaRebalancePipeline(config({
            branchOriginMarkerStackGap: 8,
            getPendingGeneratedMediaCircleInset: () => ({ x: 20, y: 20, size: 60 }),
        }))

        const result = pipeline.rebalance([origin, startedMarker, plannedMarker, startedMedia], [])
        const out = nodesById(result.nodes)

        expect(result.nodes.some((node: CanvasNode) => node.nodeId.includes(':planned-media-layout-proxy'))).toBe(false)
        expect(result.startedMarkerNodeIds).toEqual(new Set(['origin', 'started-fork']))
        expect(out.get('planned-line')!.position).not.toEqual({ x: -500, y: -500 })
        expect(out.get('planned-line')!.position.y).toBeGreaterThanOrEqual(
            out.get('origin')!.position.y + out.get('origin')!.dimensions.height + 8
        )
    })
})

// =============================================================================
// PENDING MARKER STACK REFLOW
// =============================================================================

describe('reflowStackedBranchMarkers', () => {
    it('reflows only pending markers that do not already own generated media children', () => {
        const origin = branchOrigin({
            nodeId: 'origin',
            position: { x: 100, y: 200 },
            dimensions: { width: 80, height: 40 },
        })
        const firstPending = branchFork({
            nodeId: 'first-pending',
            parentBranchNodeId: 'origin',
            reasoningIndex: 0,
            pendingState: pendingState(0),
            position: { x: 300, y: 20 },
            dimensions: { width: 90, height: 20 },
        })
        const started = branchFork({
            nodeId: 'started',
            parentBranchNodeId: 'origin',
            reasoningIndex: 1,
            pendingState: pendingState(1),
            position: { x: 300, y: 40 },
            dimensions: { width: 90, height: 20 },
        })
        const secondPending = branchFork({
            nodeId: 'second-pending',
            parentBranchNodeId: 'origin',
            reasoningIndex: 2,
            pendingState: pendingState(2),
            position: { x: 300, y: 60 },
            dimensions: { width: 90, height: 20 },
        })
        const startedMedia = image({
            nodeId: 'started-media',
            generatedBy: {
                branchForkNodeId: 'started',
            },
        })

        const reflowed = reflowStackedBranchMarkers({
            markers: [firstPending, started, secondPending],
            allNodes: [origin, firstPending, started, secondPending, startedMedia],
            manuallyPositionedMarkerNodeIds: new Set<string>(),
            branchMarkerStackGap: 8,
            getNodeWorldRect: (node: CanvasNode) => worldRect(node),
        })

        expect(reflowed.has('started')).toBe(false)
        expect(reflowed.get('first-pending')!.position).toEqual({ x: 300, y: 248 })
        expect(reflowed.get('second-pending')!.position).toEqual({ x: 300, y: 276 })
    })

    it('does not reflow a stack after the user manually positions any marker in that stack', () => {
        const firstPending = branchFork({
            nodeId: 'first-pending',
            parentBranchNodeId: 'origin',
            pendingState: pendingState(0),
        })
        const secondPending = branchFork({
            nodeId: 'second-pending',
            parentBranchNodeId: 'origin',
            pendingState: pendingState(1),
        })

        const reflowed = reflowStackedBranchMarkers({
            markers: [firstPending, secondPending],
            allNodes: [branchOrigin({ nodeId: 'origin' }), firstPending, secondPending],
            manuallyPositionedMarkerNodeIds: new Set(['second-pending']),
            branchMarkerStackGap: 8,
            getNodeWorldRect: (node: CanvasNode) => worldRect(node),
        })

        expect(reflowed.size).toBe(0)
    })
})
