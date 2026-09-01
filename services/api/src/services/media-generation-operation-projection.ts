'use strict'

import type {
    CanvasGeometryUpdate,
    CanvasNode,
    ImageCanvasNode,
    MediaBranchLineagePlan,
    MediaGenerationProblem,
    MediaGenerationProgressState,
    MediaGenerationRun,
    MediaGenerationRunProgress,
    MediaGenerationRunStatus,
    MediaReferenceBinding,
    MediaRunLineageAssignment,
    OperationStatusCanvasNode,
    VideoCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import {
    createDefaultMediaGenerationRunProgress,
    mediaGenerationLayoutSettings,
    settleMediaGenerationRunProgress,
} from '@lixpi/constants'
import {
    getGeneratedMediaPreFrameSize,
} from '@lixpi/canvas-components-lixpi-specific/shared'
import { info } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'

const DEFAULT_OPERATION_DIMENSIONS = { width: 360, height: 104 }
const DEFAULT_MEDIA_DIMENSIONS = {
    width: mediaGenerationLayoutSettings.generatedMediaSize,
    height: mediaGenerationLayoutSettings.generatedMediaSize,
}

type GeneratedMediaCanvasNode = ImageCanvasNode | VideoCanvasNode

const getPlannedMediaType = (run: MediaGenerationRun): 'image' | 'video' => {
    if (run.mediaType) return run.mediaType
    return /(?:video|veo|seedance|sora)/iu.test(String(run.modelId)) ? 'video' : 'image'
}

const isGeneratedMediaNode = (node: CanvasNode): node is GeneratedMediaCanvasNode => node.type === 'image' || node.type === 'video'

const isBranchMarkerNode = (node: CanvasNode): boolean => node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const stripLegacyMarkerProgress = (node: CanvasNode): CanvasNode => {
    if (!isBranchMarkerNode(node)) return node
    const { mediaGeneration: _mediaGeneration, ...cleanNode } = node as CanvasNode & {
        mediaGeneration?: unknown
    }
    return cleanNode as CanvasNode
}

const toRunStatus = (status: OperationStatusCanvasNode['status']): MediaGenerationRunStatus => {
    if (status === 'failed') return 'failed'
    if (status === 'action-required') return 'awaiting-provider-verification'
    return 'running'
}

const createProgressState = ({
    generationRequestId,
    status,
    message,
    progress,
    mediaModelId,
    mediaModelProvider,
    lineageAssignment,
    generationRun,
    mediaRunId,
    updatedAt = Date.now(),
}: {
    generationRequestId: string
    status: MediaGenerationRunStatus
    message: string
    progress?: MediaGenerationRunProgress
    mediaModelId?: MediaGenerationRun['modelId']
    mediaModelProvider?: MediaGenerationRun['provider']
    lineageAssignment?: MediaRunLineageAssignment
    generationRun?: number
    mediaRunId?: string
    updatedAt?: number
}): MediaGenerationProgressState => ({
    generationRequestId,
    status,
    message,
    progress: progress ?? createDefaultMediaGenerationRunProgress(status, message),
    ...(mediaModelId ? { mediaModelId } : {}),
    ...(mediaModelProvider ? { mediaModelProvider } : {}),
    ...(lineageAssignment ? { lineageAssignment } : {}),
    ...(generationRun === undefined ? {} : { generationRun }),
    ...(mediaRunId ? { mediaRunId } : {}),
    updatedAt,
})

const mediaNodeMatchesRun = (
    node: GeneratedMediaCanvasNode,
    {
        outputNodeId,
        generationRequestId,
        generationRun,
        mediaRunId,
    }: {
        outputNodeId?: string
        generationRequestId: string
        generationRun?: number
        mediaRunId?: string
    },
): boolean => {
    if (outputNodeId && node.nodeId === outputNodeId) return true
    if (node.generationProgress?.generationRequestId === generationRequestId) {
        if (mediaRunId && node.generationProgress.mediaRunId === mediaRunId) return true
        if (generationRun !== undefined && node.generationProgress.generationRun === generationRun) return true
    }
    const generatedBy = node.generatedBy
    if (generatedBy?.generationRequestId !== generationRequestId) return false
    if (mediaRunId && generatedBy.mediaRunId === mediaRunId) return true
    return generationRun !== undefined
        && generatedBy.reasoningIndex !== undefined
        && node.generationProgress?.generationRun === generationRun
}

const projectProgressToMediaNode = ({
    nodes,
    outputNodeId,
    generationRequestId,
    generationRun,
    mediaRunId,
    state,
}: {
    nodes: CanvasNode[]
    outputNodeId?: string
    generationRequestId: string
    generationRun?: number
    mediaRunId?: string
    state: MediaGenerationProgressState
}): { nodes: CanvasNode[]; changed: boolean } => {
    let changed = false
    const projectedNodes = nodes.map(rawNode => {
        const node = stripLegacyMarkerProgress(rawNode)
        if (
            !isGeneratedMediaNode(node) || !mediaNodeMatchesRun(node, {
                outputNodeId,
                generationRequestId,
                generationRun,
                mediaRunId,
            })
        ) return node
        changed = true
        return { ...node, generationProgress: { ...node.generationProgress, ...state } }
    })
    info(`[MediaGenerationNodeProgress] ${changed ? 'projected' : 'output-missing'} ${
        JSON.stringify({
            outputNodeId,
            generationRequestId,
            generationRun,
            mediaRunId,
            status: state.status,
            phase: state.progress.phase,
            completedSteps: state.progress.completedSteps,
            totalSteps: state.progress.totalSteps,
            message: state.message,
        })
    }`)
    return { nodes: projectedNodes, changed }
}

const centerFailedOperationOverReservedOutput = ({
    nodes,
    operationNodeId,
}: {
    nodes: CanvasNode[]
    operationNodeId: string
}): CanvasNode[] => {
    const operation = nodes.find((node): node is OperationStatusCanvasNode => (
        node.type === 'operationStatus'
        && node.nodeId === operationNodeId
        && node.status === 'failed'
    ))
    if (!operation?.outputNodeId) return nodes
    const output = nodes.find((node): node is GeneratedMediaCanvasNode => (
        isGeneratedMediaNode(node)
        && node.nodeId === operation.outputNodeId
        && node.mediaGenerationPhase === 'pending-before-first-frame'
    ))
    if (!output) return nodes

    return nodes.map(node => {
        if (node.nodeId !== operation.nodeId || node.type !== 'operationStatus') return node
        const { parentId: _previousParentId, ...operationWithoutParent } = node
        return {
            ...operationWithoutParent,
            ...(output.parentId ? { parentId: output.parentId } : {}),
            ...(node.lineageAssignment || !output.generationProgress?.lineageAssignment
                ? {}
                : { lineageAssignment: output.generationProgress.lineageAssignment }),
            position: {
                x: output.position.x + (output.dimensions.width - node.dimensions.width) / 2,
                y: output.position.y + (output.dimensions.height - node.dimensions.height) / 2,
            },
        }
    })
}

const getInitialPosition = (
    anchorNode: CanvasNode | undefined,
    generationRun: number,
    runCount: number,
    viewport: { x: number; y: number; zoom: number },
    visibleArea?: { width: number; height: number },
): { x: number; y: number } => {
    const preFrameSize = getGeneratedMediaPreFrameSize(
        DEFAULT_MEDIA_DIMENSIONS,
        mediaGenerationLayoutSettings.preFrameCircleScale,
    )
    const runPitch = preFrameSize + mediaGenerationLayoutSettings.branchRowGap
    const centeredRunOffset = (generationRun - (runCount - 1) / 2) * runPitch
    if (anchorNode) {
        return {
            x: anchorNode.position.x + anchorNode.dimensions.width + 80,
            y: anchorNode.position.y
                + (anchorNode.dimensions.height - DEFAULT_MEDIA_DIMENSIONS.height) / 2
                + centeredRunOffset,
        }
    }
    if (
        visibleArea
        && Number.isFinite(visibleArea.width)
        && visibleArea.width > 0
        && Number.isFinite(visibleArea.height)
        && visibleArea.height > 0
    ) {
        const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
        return {
            x: (visibleArea.width / 2 - viewport.x) / zoom - DEFAULT_MEDIA_DIMENSIONS.width / 2,
            y: (visibleArea.height / 2 - viewport.y) / zoom
                - DEFAULT_MEDIA_DIMENSIONS.height / 2
                + centeredRunOffset,
        }
    }
    return {
        x: 80 + generationRun * (DEFAULT_MEDIA_DIMENSIONS.width + 120),
        y: 80,
    }
}

const getInitialOperationPosition = (
    anchorNode: CanvasNode | undefined,
    generationRun: number,
    viewport: { x: number; y: number; zoom: number },
    visibleArea?: { width: number; height: number },
): { x: number; y: number } => {
    if (anchorNode) {
        return {
            x: anchorNode.position.x + anchorNode.dimensions.width + 80,
            y: anchorNode.position.y + generationRun * (DEFAULT_OPERATION_DIMENSIONS.height + 24),
        }
    }
    if (
        visibleArea
        && Number.isFinite(visibleArea.width)
        && visibleArea.width > 0
        && Number.isFinite(visibleArea.height)
        && visibleArea.height > 0
    ) {
        const zoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
        return {
            x: (visibleArea.width / 2 - viewport.x) / zoom - DEFAULT_OPERATION_DIMENSIONS.width / 2,
            y: (visibleArea.height / 2 - viewport.y) / zoom - DEFAULT_OPERATION_DIMENSIONS.height / 2,
        }
    }
    return { x: 80 + generationRun * 400, y: 80 }
}

const createPendingMediaNode = ({
    run,
    generationRequestId,
    lineageAssignment,
    anchorNode,
    runCount,
    viewport,
    visibleArea,
    now,
}: {
    run: MediaGenerationRun
    generationRequestId: string
    lineageAssignment?: MediaRunLineageAssignment
    anchorNode?: CanvasNode
    runCount: number
    viewport: { x: number; y: number; zoom: number }
    visibleArea?: { width: number; height: number }
    now: number
}): GeneratedMediaCanvasNode | null => {
    if (!run.outputNodeId || !run.outputAssetId) return null
    const message = run.progress?.message ?? 'Preparing the media request.'
    const shared = {
        nodeId: run.outputNodeId,
        assetId: run.outputAssetId,
        mediaGenerationPhase: 'pending-before-first-frame' as const,
        generationProgress: createProgressState({
            generationRequestId,
            status: run.status,
            message,
            progress: run.progress,
            mediaModelId: run.modelId,
            mediaModelProvider: run.provider,
            lineageAssignment,
            generationRun: run.generationRun,
            mediaRunId: run.mediaRunId,
            updatedAt: now,
        }),
        ...(anchorNode?.parentId ? { parentId: anchorNode.parentId } : {}),
        position: getInitialPosition(anchorNode, run.generationRun, runCount, viewport, visibleArea),
        dimensions: DEFAULT_MEDIA_DIMENSIONS,
    }
    return getPlannedMediaType(run) === 'video'
        ? { ...shared, type: 'video' }
        : { ...shared, type: 'image' }
}

const createOperationNode = ({
    run,
    generationRequestId,
    lineageAssignment,
    anchorNode,
    viewport,
    visibleArea,
    now,
}: {
    run: MediaGenerationRun
    generationRequestId: string
    lineageAssignment?: MediaRunLineageAssignment
    anchorNode?: CanvasNode
    viewport: { x: number; y: number; zoom: number }
    visibleArea?: { width: number; height: number }
    now: number
}): OperationStatusCanvasNode => ({
    nodeId: run.operationNodeId,
    type: 'operationStatus',
    operation: 'media-generation',
    status: run.status === 'failed'
        ? 'failed'
        : run.status === 'awaiting-provider-verification'
        ? 'action-required'
        : 'in-progress',
    title: `Generating with ${run.modelId}`,
    message: run.problem?.detail ?? run.progress?.message ?? 'Preparing the media request.',
    progress: run.progress ?? createDefaultMediaGenerationRunProgress(
        run.status,
        run.problem?.detail ?? 'Preparing the media request.',
    ),
    generationRequestId,
    generationRun: run.generationRun,
    ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
    ...(run.outputNodeId ? { outputNodeId: run.outputNodeId } : {}),
    plannedMediaType: getPlannedMediaType(run),
    ...(lineageAssignment ? { lineageAssignment } : {}),
    ...(run.problem ? { problem: run.problem } : {}),
    ...(anchorNode?.parentId ? { parentId: anchorNode.parentId } : {}),
    position: getInitialOperationPosition(anchorNode, run.generationRun, viewport, visibleArea),
    dimensions: DEFAULT_OPERATION_DIMENSIONS,
    createdAt: now,
    updatedAt: now,
})

export const projectMediaGenerationOperationNodes = async ({
    workspaceId,
    generationRequestId,
    runs,
    bindings,
    lineagePlan,
    visibleArea,
}: {
    workspaceId: string
    generationRequestId: string
    runs: MediaGenerationRun[]
    bindings: MediaReferenceBinding[]
    lineagePlan?: MediaBranchLineagePlan
    visibleArea?: { width: number; height: number }
}): Promise<CanvasGeometryUpdate> => {
    const now = Date.now()
    const projection = await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.create',
        allowUnboundGeneratedMediaReservationMutation: true,
        mutate: canvasState => {
            const existingIds = new Set(canvasState.nodes.map(node => node.nodeId))
            const anchorNodeId = bindings.find(binding => binding.nodeId)?.nodeId
            const anchorNode = anchorNodeId
                ? canvasState.nodes.find(node => node.nodeId === anchorNodeId)
                : undefined
            const additions: CanvasNode[] = []
            for (const run of runs) {
                const lineageAssignment = lineagePlan?.runAssignments.find(candidate => (
                    Boolean(run.mediaRunId && candidate.mediaRunId === run.mediaRunId)
                    || (candidate.reasoningIndex === run.reasoningIndex
                        && candidate.mediaModelId === run.modelId
                        && (run.mediaType === undefined || candidate.mediaType === run.mediaType)
                        && (run.mediaIndex === undefined || candidate.mediaIndex === run.mediaIndex))
                ))
                if (!existingIds.has(run.operationNodeId)) {
                    additions.push(createOperationNode({
                        run,
                        generationRequestId,
                        lineageAssignment,
                        anchorNode,
                        viewport: canvasState.viewport,
                        visibleArea,
                        now,
                    }))
                    existingIds.add(run.operationNodeId)
                }
                const pendingMediaNode = createPendingMediaNode({
                    run,
                    generationRequestId,
                    lineageAssignment,
                    anchorNode,
                    runCount: runs.length,
                    viewport: canvasState.viewport,
                    visibleArea,
                    now,
                })
                if (pendingMediaNode && !existingIds.has(pendingMediaNode.nodeId)) {
                    additions.push(pendingMediaNode)
                    existingIds.add(pendingMediaNode.nodeId)
                }
            }
            const nodes = canvasState.nodes.map(stripLegacyMarkerProgress)
            const removedLegacyProgress = nodes.some((node, index) => node !== canvasState.nodes[index])
            return additions.length === 0 && !removedLegacyProgress
                ? { canvasState, changed: false }
                : {
                    canvasState: { ...canvasState, nodes: [...nodes, ...additions] },
                    changed: true,
                }
        },
    })
    if (!projection.canvasState || projection.canvasStateUpdatedAt === null) {
        throw new Error('MEDIA_GENERATION_WORKSPACE_NOT_FOUND')
    }
    const nodeSnapshots = projection.canvasState.nodes.filter(node => (
        (node.type === 'operationStatus'
            && node.operation === 'media-generation'
            && node.generationRequestId === generationRequestId)
        || (isGeneratedMediaNode(node)
            && node.generationProgress?.generationRequestId === generationRequestId)
    ))
    return {
        generationRequestId,
        layoutRevision: projection.canvasStateUpdatedAt,
        nodes: nodeSnapshots.map(node => ({
            nodeId: node.nodeId,
            position: node.position,
            dimensions: node.dimensions,
            ...(node.parentId ? { parentNodeId: node.parentId } : {}),
        })),
        nodeSnapshots,
    }
}

export const updateMediaGenerationOperationNode = async ({
    workspaceId,
    operationNodeId,
    status,
    message,
    progress,
    problem,
    candidateAssetIds,
    unresolvedBindingId,
    requestRevision,
    verificationAssetId,
    generationRequestId,
    generationRun,
    clearAction = false,
}: {
    workspaceId: string
    operationNodeId: string
    status: OperationStatusCanvasNode['status']
    message: string
    progress?: MediaGenerationRunProgress
    problem?: MediaGenerationProblem
    candidateAssetIds?: string[]
    unresolvedBindingId?: string
    requestRevision?: number
    verificationAssetId?: string
    generationRequestId?: string
    generationRun?: number
    clearAction?: boolean
}): Promise<void> => {
    await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.update',
        mutate: canvasState => {
            const operationNode = canvasState.nodes.find((node): node is OperationStatusCanvasNode => node.type === 'operationStatus' && node.nodeId === operationNodeId)
            const resolvedGenerationRequestId = generationRequestId ?? operationNode?.generationRequestId
            const resolvedGenerationRun = generationRun ?? operationNode?.generationRun
            const projectedRunStatus: MediaGenerationRunStatus = status === 'action-required'
                    && Boolean(candidateAssetIds?.length)
                    && Boolean(unresolvedBindingId)
                ? 'pending'
                : toRunStatus(status)
            const nextProgress = progress ?? operationNode?.progress
                ?? createDefaultMediaGenerationRunProgress(projectedRunStatus, message)
            let changed = false
            let nodes = canvasState.nodes.map(rawNode => {
                const node = stripLegacyMarkerProgress(rawNode)
                if (node !== rawNode) changed = true
                if (node.type !== 'operationStatus' || node.nodeId !== operationNodeId) return node
                changed = true
                const next: OperationStatusCanvasNode = {
                    ...node,
                    status,
                    message,
                    progress: nextProgress,
                    ...(problem ? { problem } : {}),
                    ...(candidateAssetIds ? { candidateAssetIds } : {}),
                    ...(unresolvedBindingId ? { unresolvedBindingId } : {}),
                    ...(requestRevision !== undefined ? { requestRevision } : {}),
                    ...(verificationAssetId ? { verificationAssetId } : {}),
                    updatedAt: Date.now(),
                }
                if (clearAction) {
                    delete next.problem
                    delete next.candidateAssetIds
                    delete next.unresolvedBindingId
                    delete next.verificationAssetId
                }
                return next
            })
            if (resolvedGenerationRequestId) {
                const mediaProjection = projectProgressToMediaNode({
                    nodes,
                    outputNodeId: operationNode?.outputNodeId,
                    generationRequestId: resolvedGenerationRequestId,
                    generationRun: resolvedGenerationRun,
                    state: createProgressState({
                        generationRequestId: resolvedGenerationRequestId,
                        status: projectedRunStatus,
                        message,
                        progress: nextProgress,
                        generationRun: resolvedGenerationRun,
                        mediaRunId: operationNode?.mediaRunId,
                    }),
                })
                nodes = mediaProjection.nodes
                changed ||= mediaProjection.changed
            }
            if (status === 'failed') {
                nodes = centerFailedOperationOverReservedOutput({ nodes, operationNodeId })
            }
            return {
                canvasState: changed
                    ? {
                        ...canvasState,
                        nodes,
                    }
                    : canvasState,
                changed,
            }
        },
    })
}

export const rebindMediaGenerationOperationNodes = async ({
    workspaceId,
    generationRequestId,
    requestRevision,
    bindings,
}: {
    workspaceId: string
    generationRequestId: string
    requestRevision: number
    bindings: Array<{
        previousNodeId: string
        previousOutputNodeId?: string
        operationNodeId: string
        lineageParentNodeId?: string
        lineageAssignment?: MediaRunLineageAssignment
        run: MediaGenerationRun
    }>
}): Promise<void> => {
    await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.rebindLineage',
        allowUnboundGeneratedMediaReservationMutation: true,
        mutate: canvasState => {
            const previousOperationIds = new Set(bindings.map(binding => binding.previousNodeId))
            const targetOperationIds = new Set(bindings.map(binding => binding.operationNodeId))
            const previousOutputIds = new Set(bindings.flatMap(binding =>
                binding.previousOutputNodeId
                    ? [binding.previousOutputNodeId]
                    : []
            ))
            const targetOutputIds = new Set(bindings.flatMap(binding =>
                binding.run.outputNodeId
                    ? [binding.run.outputNodeId]
                    : []
            ))
            const outputReplacementById = new Map(bindings.flatMap(binding => (
                binding.previousOutputNodeId
                    && binding.run.outputNodeId
                    && binding.previousOutputNodeId !== binding.run.outputNodeId
                    ? [[binding.previousOutputNodeId, binding.run.outputNodeId] as const]
                    : []
            )))
            const oldOperationById = new Map(
                canvasState.nodes
                    .filter((node): node is OperationStatusCanvasNode =>
                        node.type === 'operationStatus'
                        && node.operation === 'media-generation'
                        && node.generationRequestId === generationRequestId
                    )
                    .map(node => [node.nodeId, node]),
            )
            const oldOutputById = new Map(
                canvasState.nodes
                    .filter(isGeneratedMediaNode)
                    .filter(node => previousOutputIds.has(node.nodeId))
                    .map(node => [node.nodeId, node]),
            )
            const retainedNodes = canvasState.nodes
                .filter(node => !previousOperationIds.has(node.nodeId) && !targetOperationIds.has(node.nodeId))
                .filter(node => !previousOutputIds.has(node.nodeId) || targetOutputIds.has(node.nodeId))
                .map(stripLegacyMarkerProgress)
            const nodeById = new Map(retainedNodes.map(node => [node.nodeId, node]))
            const now = Date.now()

            for (const binding of bindings) {
                const run = binding.run
                const message = run.problem?.detail ?? run.progress?.message ?? 'Preparing the media request.'
                const progressState = createProgressState({
                    generationRequestId,
                    status: run.status,
                    message,
                    progress: run.progress,
                    mediaModelId: run.modelId,
                    mediaModelProvider: run.provider,
                    lineageAssignment: binding.lineageAssignment,
                    generationRun: run.generationRun,
                    mediaRunId: run.mediaRunId,
                    updatedAt: now,
                })
                const outputNodeId = run.outputNodeId
                if (outputNodeId) {
                    const currentOutput = nodeById.get(outputNodeId)
                    const previousOutput = binding.previousOutputNodeId
                        ? oldOutputById.get(binding.previousOutputNodeId)
                        : undefined
                    const outputBase = currentOutput && isGeneratedMediaNode(currentOutput)
                        ? currentOutput
                        : previousOutput
                    const outputNode = outputBase
                        ? {
                            ...outputBase,
                            nodeId: outputNodeId,
                            type: getPlannedMediaType(run),
                            ...(run.outputAssetId ? { assetId: run.outputAssetId } : {}),
                            generationProgress: progressState,
                        } as GeneratedMediaCanvasNode
                        : createPendingMediaNode({
                            run,
                            generationRequestId,
                            lineageAssignment: binding.lineageAssignment,
                            runCount: bindings.length,
                            viewport: canvasState.viewport,
                            now,
                        })
                    if (outputNode) nodeById.set(outputNodeId, outputNode)
                }

                const previousOperation = oldOperationById.get(binding.previousNodeId)
                    ?? oldOperationById.get(binding.operationNodeId)
                const operationNode = createOperationNode({
                    run,
                    generationRequestId,
                    lineageAssignment: binding.lineageAssignment,
                    anchorNode: binding.lineageParentNodeId
                        ? nodeById.get(binding.lineageParentNodeId)
                        : undefined,
                    viewport: canvasState.viewport,
                    now,
                })
                nodeById.set(binding.operationNodeId, {
                    ...operationNode,
                    ...(previousOperation
                        ? {
                            title: previousOperation.title,
                            createdAt: previousOperation.createdAt,
                            ...(!binding.lineageParentNodeId
                                ? {
                                    position: previousOperation.position,
                                    dimensions: previousOperation.dimensions,
                                }
                                : {}),
                        }
                        : {}),
                    requestRevision,
                    ...(run.outputNodeId ? { outputNodeId: run.outputNodeId } : {}),
                    ...(run.mediaRunId ? { mediaRunId: run.mediaRunId } : {}),
                })
            }

            const operationIds = new Set([...previousOperationIds, ...targetOperationIds])
            const edgeKeys = new Set<string>()
            const edges = canvasState.edges.flatMap(edge => {
                if (operationIds.has(edge.sourceNodeId) || operationIds.has(edge.targetNodeId)) return []
                const sourceNodeId = outputReplacementById.get(edge.sourceNodeId) ?? edge.sourceNodeId
                const targetNodeId = outputReplacementById.get(edge.targetNodeId) ?? edge.targetNodeId
                if (!nodeById.has(sourceNodeId) || !nodeById.has(targetNodeId)) return []
                const key = `${sourceNodeId}:${targetNodeId}:${edge.sourceHandle ?? ''}:${edge.targetHandle ?? ''}`
                if (edgeKeys.has(key)) return []
                edgeKeys.add(key)
                return sourceNodeId === edge.sourceNodeId && targetNodeId === edge.targetNodeId
                    ? [edge]
                    : [{
                        ...edge,
                        edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
                        sourceNodeId,
                        targetNodeId,
                    }]
            })
            for (const binding of bindings) {
                const outputNodeId = binding.run.outputNodeId
                const lineageParentNodeId = binding.lineageParentNodeId
                if (
                    !outputNodeId
                    || !lineageParentNodeId
                    || !nodeById.has(outputNodeId)
                    || !nodeById.has(lineageParentNodeId)
                ) continue
                const key = `${lineageParentNodeId}:${outputNodeId}:right:left`
                if (edgeKeys.has(key)) continue
                edgeKeys.add(key)
                edges.push(
                    {
                        edgeId: `edge-${lineageParentNodeId}-${outputNodeId}`,
                        sourceNodeId: lineageParentNodeId,
                        targetNodeId: outputNodeId,
                        sourceHandle: 'right',
                        targetHandle: 'left',
                        pathType: 'horizontal-bezier',
                    } satisfies WorkspaceEdge,
                )
            }
            return {
                canvasState: {
                    ...canvasState,
                    nodes: [...nodeById.values()],
                    edges,
                },
                changed: true,
            }
        },
    })
}

export const removeMediaGenerationOperationNodes = async ({
    workspaceId,
    generationRequestId,
    terminalStatus = 'completed',
    discardUnboundOutputNodes = false,
}: {
    workspaceId: string
    generationRequestId: string
    terminalStatus?: 'completed' | 'cancelled'
    discardUnboundOutputNodes?: boolean
}): Promise<void> => {
    await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.remove',
        allowUnboundGeneratedMediaReservationMutation: discardUnboundOutputNodes,
        mutate: canvasState => {
            const removedOperations = canvasState.nodes
                .filter((node): node is OperationStatusCanvasNode =>
                    node.type === 'operationStatus'
                    && node.operation === 'media-generation'
                    && node.generationRequestId === generationRequestId
                )
            const removedIds = new Set(removedOperations.map(node => node.nodeId))
            const operationByOutputNodeId = new Map(removedOperations.flatMap(operation =>
                operation.outputNodeId
                    ? [[operation.outputNodeId, operation] as const]
                    : []
            ))
            const discardedOutputNodeIds = new Set<string>()
            let changed = removedIds.size > 0
            const nodes = canvasState.nodes.flatMap(rawNode => {
                if (removedIds.has(rawNode.nodeId)) return []
                const node = stripLegacyMarkerProgress(rawNode)
                if (node !== rawNode) changed = true
                if (!isGeneratedMediaNode(node)) return [node]
                const operation = operationByOutputNodeId.get(node.nodeId)
                if (
                    discardUnboundOutputNodes
                    && !node.generatedBy
                    && node.generationProgress?.generationRequestId === generationRequestId
                ) {
                    discardedOutputNodeIds.add(node.nodeId)
                    changed = true
                    return []
                }
                const hasActiveRequestProgress = node.generationProgress?.generationRequestId === generationRequestId
                    && !['completed', 'failed', 'cancelled'].includes(node.generationProgress.status)
                const belongsToRequest = terminalStatus === 'cancelled'
                    ? operation || hasActiveRequestProgress
                    : operation
                        || node.generationProgress?.generationRequestId === generationRequestId
                        || node.generatedBy?.generationRequestId === generationRequestId
                if (!belongsToRequest || !node.generationProgress) return [node]
                const message = operation?.progress?.message
                    ?? node.generationProgress.progress.message
                    ?? (terminalStatus === 'completed'
                        ? 'Media generation completed.'
                        : 'Media generation cancelled.')
                changed = true
                return [{
                    ...node,
                    generationProgress: {
                        ...node.generationProgress,
                        status: terminalStatus,
                        message,
                        progress: settleMediaGenerationRunProgress(
                            operation?.progress ?? node.generationProgress.progress,
                            terminalStatus,
                            message,
                        ),
                        updatedAt: Date.now(),
                    },
                }]
            })
            return {
                canvasState: changed
                    ? {
                        ...canvasState,
                        nodes,
                        edges: canvasState.edges.filter(edge => (
                            !removedIds.has(edge.sourceNodeId)
                            && !removedIds.has(edge.targetNodeId)
                            && !discardedOutputNodeIds.has(edge.sourceNodeId)
                            && !discardedOutputNodeIds.has(edge.targetNodeId)
                        )),
                    }
                    : canvasState,
                changed,
            }
        },
    })
}

export const removeMediaGenerationOperationNode = async ({
    workspaceId,
    operationNodeId,
    generationRequestId,
    generationRun,
    progress,
}: {
    workspaceId: string
    operationNodeId: string
    generationRequestId: string
    generationRun?: number
    progress?: MediaGenerationRunProgress
}): Promise<void> => {
    await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.removeOne',
        mutate: canvasState => {
            const operationNode = canvasState.nodes.find((node): node is OperationStatusCanvasNode => node.nodeId === operationNodeId && node.type === 'operationStatus')
            const message = progress?.message ?? operationNode?.progress?.message ?? 'Media generation completed.'
            const terminalProgress = settleMediaGenerationRunProgress(
                progress ?? operationNode?.progress,
                'completed',
                message,
            )
            const projection = projectProgressToMediaNode({
                nodes: canvasState.nodes.filter(node => node.nodeId !== operationNodeId),
                outputNodeId: operationNode?.outputNodeId,
                generationRequestId,
                generationRun: generationRun ?? operationNode?.generationRun,
                state: createProgressState({
                    generationRequestId,
                    status: 'completed',
                    message,
                    progress: terminalProgress,
                    generationRun: generationRun ?? operationNode?.generationRun,
                    mediaRunId: operationNode?.mediaRunId,
                }),
            })
            return {
                canvasState: {
                    ...canvasState,
                    nodes: projection.nodes,
                    edges: canvasState.edges.filter(edge => (
                        edge.sourceNodeId !== operationNodeId
                        && edge.targetNodeId !== operationNodeId
                    )),
                },
                changed: Boolean(operationNode) || projection.changed,
            }
        },
    })
}
