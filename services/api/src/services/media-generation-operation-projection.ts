'use strict'

import type {
    BranchMarkerMediaGenerationState,
    CanvasNode,
    MediaGenerationProblem,
    MediaGenerationRun,
    MediaGenerationRunProgress,
    MediaGenerationRunStatus,
    MediaReferenceBinding,
    OperationStatusCanvasNode,
    WorkspaceEdge,
} from '@lixpi/constants'
import {
    createDefaultMediaGenerationRunProgress,
    settleMediaGenerationRunProgress,
} from '@lixpi/constants'
import { info } from '@lixpi/debug-tools'

import Workspace from '../models/workspace.ts'

const DEFAULT_DIMENSIONS = { width: 360, height: 104 }
type BranchMarkerCanvasNode = Extract<CanvasNode, {
    type: 'branchOrigin' | 'branchFork' | 'branchLine'
}>
const getPlannedMediaType = (modelId: string): OperationStatusCanvasNode['plannedMediaType'] =>
    /(?:video|veo|seedance|sora)/iu.test(modelId) ? 'video' : 'image'

const isBranchMarkerNode = (node: CanvasNode): node is BranchMarkerCanvasNode =>
    node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'

const toRunStatus = (status: OperationStatusCanvasNode['status']): MediaGenerationRunStatus => {
    if (status === 'failed') return 'failed'
    if (status === 'action-required') return 'awaiting-provider-verification'
    return 'running'
}

const getOperationOwnerNodeIds = (
    edges: readonly WorkspaceEdge[],
    operationNodeId: string,
): Set<string> => new Set(edges
    .filter(edge => edge.targetNodeId === operationNodeId)
    .map(edge => edge.sourceNodeId))

const projectMediaGenerationStateToOwners = ({
    nodes,
    edges,
    operationNodeId,
    state,
}: {
    nodes: CanvasNode[]
    edges: readonly WorkspaceEdge[]
    operationNodeId: string
    state: BranchMarkerMediaGenerationState
}): { nodes: CanvasNode[]; changed: boolean } => {
    const ownerNodeIds = getOperationOwnerNodeIds(edges, operationNodeId)
    if (ownerNodeIds.size === 0) {
        info(`[MediaGenerationMarkerProgress] owner-missing ${JSON.stringify({
            operationNodeId,
            status: state.status,
            phase: state.progress.phase,
            message: state.message,
        })}`)
        return { nodes, changed: false }
    }
    info(`[MediaGenerationMarkerProgress] projected ${JSON.stringify({
        operationNodeId,
        ownerNodeIds: [...ownerNodeIds],
        status: state.status,
        phase: state.progress.phase,
        completedSteps: state.progress.completedSteps,
        totalSteps: state.progress.totalSteps,
        message: state.message,
    })}`)
    let changed = false
    return {
        nodes: nodes.map(node => {
            if (!ownerNodeIds.has(node.nodeId) || !isBranchMarkerNode(node)) return node
            changed = true
            return { ...node, mediaGeneration: state }
        }),
        changed,
    }
}

const projectMediaGenerationStateToRequestMarkers = ({
    nodes,
    generationRequestId,
    generationRun,
    state,
}: {
    nodes: CanvasNode[]
    generationRequestId: string
    generationRun?: number
    state: BranchMarkerMediaGenerationState
}): { nodes: CanvasNode[]; changed: boolean } => {
    let changed = false
    const projectedNodes = nodes.map(node => {
        if (!isBranchMarkerNode(node)
            || node.generationRequestId !== generationRequestId
            || (generationRun !== undefined
                && node.mediaGeneration?.generationRun !== undefined
                && node.mediaGeneration.generationRun !== generationRun)) return node
        changed = true
        return { ...node, mediaGeneration: state }
    })
    info(`[MediaGenerationMarkerProgress] ${changed ? 'direct-projection' : 'request-marker-missing'} ${JSON.stringify({
        generationRequestId,
        generationRun,
        status: state.status,
        phase: state.progress.phase,
        completedSteps: state.progress.completedSteps,
        totalSteps: state.progress.totalSteps,
        message: state.message,
    })}`)
    return { nodes: projectedNodes, changed }
}

export const projectMediaGenerationOperationNodes = async ({
    workspaceId,
    generationRequestId,
    runs,
    bindings,
}: {
    workspaceId: string
    generationRequestId: string
    runs: MediaGenerationRun[]
    bindings: MediaReferenceBinding[]
}): Promise<void> => {
    const now = Date.now()
    const projection = await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.create',
        mutate: canvasState => {
            const existingIds = new Set(canvasState.nodes.map(node => node.nodeId))
            const anchorNodeId = bindings.find(binding => binding.nodeId)?.nodeId
            const anchorNode = anchorNodeId
                ? canvasState.nodes.find(node => node.nodeId === anchorNodeId)
                : undefined
            const additions: OperationStatusCanvasNode[] = runs
                .filter(run => !existingIds.has(run.operationNodeId))
                .map((run, index) => ({
                    nodeId: run.operationNodeId,
                    type: 'operationStatus',
                    operation: 'media-generation',
                    status: 'in-progress',
                    title: `Generating with ${run.modelId}`,
                    message: 'Preparing the media request.',
                    progress: run.progress ?? createDefaultMediaGenerationRunProgress(
                        run.status,
                        'Preparing the media request.',
                    ),
                    generationRequestId,
                    generationRun: run.generationRun,
                    plannedMediaType: getPlannedMediaType(String(run.modelId)),
                    ...(anchorNode?.parentId ? { parentId: anchorNode.parentId } : {}),
                    position: anchorNode
                        ? {
                            x: anchorNode.position.x + anchorNode.dimensions.width + 80,
                            y: anchorNode.position.y + index * (DEFAULT_DIMENSIONS.height + 24),
                        }
                        : { x: 80 + index * 400, y: 80 },
                    dimensions: DEFAULT_DIMENSIONS,
                    createdAt: now,
                    updatedAt: now,
                }))
            const existingEdgeIds = new Set(canvasState.edges.map(edge => edge.edgeId))
            const edges: WorkspaceEdge[] = anchorNode
                ? additions.flatMap(node => {
                    const edgeId = `edge-${anchorNode.nodeId}-${node.nodeId}`
                    return existingEdgeIds.has(edgeId) ? [] : [{
                        edgeId,
                        sourceNodeId: anchorNode.nodeId,
                        targetNodeId: node.nodeId,
                        sourceHandle: 'right',
                        targetHandle: 'left',
                        pathType: 'horizontal-bezier',
                    }]
                })
                : []
            return additions.length === 0
                ? { canvasState, changed: false }
                : {
                    canvasState: {
                        ...canvasState,
                        nodes: [...canvasState.nodes, ...additions],
                        edges: [...canvasState.edges, ...edges],
                    },
                    changed: true,
                }
        },
    })
    if (!projection.canvasState) throw new Error('MEDIA_GENERATION_WORKSPACE_NOT_FOUND')
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
            const operationNode = canvasState.nodes.find((node): node is OperationStatusCanvasNode =>
                node.type === 'operationStatus' && node.nodeId === operationNodeId)
            let changed = false
            let nodes = canvasState.nodes.map(node => {
                if (node.type !== 'operationStatus' || node.nodeId !== operationNodeId) return node
                changed = true
                const next = {
                    ...node,
                    status,
                    message,
                    ...(progress ? { progress } : {}),
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
            if (operationNode) {
                const markerProjection = projectMediaGenerationStateToOwners({
                    nodes,
                    edges: canvasState.edges,
                    operationNodeId,
                    state: {
                        status: toRunStatus(status),
                        message,
                        progress: progress ?? operationNode.progress
                            ?? createDefaultMediaGenerationRunProgress(toRunStatus(status), message),
                        ...(operationNode.generationRun !== undefined ? {
                            generationRun: operationNode.generationRun,
                        } : {}),
                        updatedAt: Date.now(),
                    },
                })
                nodes = markerProjection.nodes
                changed ||= markerProjection.changed
                if (!markerProjection.changed && generationRequestId) {
                    const directProjection = projectMediaGenerationStateToRequestMarkers({
                        nodes,
                        generationRequestId,
                        ...(generationRun === undefined ? {} : { generationRun }),
                        state: {
                            status: toRunStatus(status),
                            message,
                            progress: progress ?? operationNode.progress
                                ?? createDefaultMediaGenerationRunProgress(toRunStatus(status), message),
                            ...(generationRun === undefined ? {} : { generationRun }),
                            updatedAt: Date.now(),
                        },
                    })
                    nodes = directProjection.nodes
                    changed ||= directProjection.changed
                }
            } else if (generationRequestId) {
                const markerProjection = projectMediaGenerationStateToRequestMarkers({
                    nodes,
                    generationRequestId,
                    ...(generationRun === undefined ? {} : { generationRun }),
                    state: {
                        status: toRunStatus(status),
                        message,
                        progress: progress ?? createDefaultMediaGenerationRunProgress(toRunStatus(status), message),
                        ...(generationRun === undefined ? {} : { generationRun }),
                        updatedAt: Date.now(),
                    },
                })
                nodes = markerProjection.nodes
                changed ||= markerProjection.changed
            }
            return { canvasState: { ...canvasState, nodes }, changed }
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
        operationNodeId: string
        lineageParentNodeId: string
        run: MediaGenerationRun
    }>
}): Promise<void> => {
    await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.rebindLineage',
        mutate: canvasState => {
            const replacementByOldId = new Map(bindings.map(binding => [binding.previousNodeId, binding.operationNodeId]))
            const bindingByTargetId = new Map(bindings.map(binding => [binding.operationNodeId, binding]))
            const oldNodeById = new Map(canvasState.nodes
                .filter((node): node is OperationStatusCanvasNode => node.type === 'operationStatus'
                    && node.operation === 'media-generation'
                    && node.generationRequestId === generationRequestId)
                .map(node => [node.nodeId, node]))
            let changed = false
            const nodes = canvasState.nodes.flatMap(node => {
                const replacementId = replacementByOldId.get(node.nodeId)
                if (replacementId && replacementId !== node.nodeId) {
                    changed = true
                    return []
                }
                const binding = bindingByTargetId.get(node.nodeId)
                if (!binding) return [node]
                const previous = oldNodeById.get(binding.previousNodeId)
                    ?? (node.type === 'operationStatus' ? node : undefined)
                const status = binding.run.status === 'failed'
                    ? 'failed' as const
                    : binding.run.status === 'awaiting-provider-verification'
                        ? 'action-required' as const
                        : 'in-progress' as const
                const operationNode: OperationStatusCanvasNode = {
                    nodeId: binding.operationNodeId,
                    type: 'operationStatus',
                    operation: 'media-generation',
                    status,
                    title: previous?.title ?? `Generating with ${binding.run.modelId}`,
                    message: binding.run.problem?.detail
                        ?? previous?.message
                        ?? 'The provider is generating media.',
                    progress: binding.run.progress ?? createDefaultMediaGenerationRunProgress(
                        binding.run.status,
                        binding.run.problem?.detail ?? 'The provider is generating media.',
                    ),
                    generationRequestId,
                    generationRun: binding.run.generationRun,
                    plannedMediaType: node.type === 'video' ? 'video' : node.type === 'image'
                        ? 'image'
                        : previous?.plannedMediaType,
                    ...(binding.run.problem ? { problem: binding.run.problem } : {}),
                    ...(binding.run.requiredVerificationAssetIds?.[0] ? {
                        verificationAssetId: binding.run.requiredVerificationAssetIds[0],
                    } : {}),
                    requestRevision,
                    ...('assetId' in node && typeof node.assetId === 'string' ? { assetId: node.assetId } : {}),
                    ...(node.parentId ? { parentId: node.parentId } : {}),
                    ...(node.extent ? { extent: node.extent } : {}),
                    ...(node.expandParent !== undefined ? { expandParent: node.expandParent } : {}),
                    position: (() => {
                        const parent = canvasState.nodes.find(candidate => candidate.nodeId === binding.lineageParentNodeId)
                        return parent && node.type === 'operationStatus'
                            ? {
                                x: parent.position.x + parent.dimensions.width + 80,
                                y: parent.position.y + binding.run.generationRun * (node.dimensions.height + 24),
                            }
                            : node.position
                    })(),
                    dimensions: node.dimensions,
                    createdAt: previous?.createdAt ?? Date.now(),
                    updatedAt: Date.now(),
                }
                if (node.type !== 'operationStatus' || JSON.stringify(node) !== JSON.stringify(operationNode)) changed = true
                return [operationNode]
            })
            for (const binding of bindings) {
                if (nodes.some(node => node.nodeId === binding.operationNodeId)) continue
                changed = true
                // Runs deferred until the lineage plan have no node to rebind
                // from: the request was created before the model axes were
                // resolved, so this is the operation card's first projection.
                const previous = oldNodeById.get(binding.previousNodeId)
                const dimensions = previous?.dimensions ?? DEFAULT_DIMENSIONS
                const parent = nodes.find(node => node.nodeId === binding.lineageParentNodeId)
                const now = Date.now()
                nodes.push({
                    ...(previous ?? {
                        nodeId: binding.operationNodeId,
                        type: 'operationStatus',
                        operation: 'media-generation',
                        title: `Generating with ${binding.run.modelId}`,
                        generationRequestId,
                        generationRun: binding.run.generationRun,
                        dimensions,
                        createdAt: now,
                    }),
                    nodeId: binding.operationNodeId,
                    status: binding.run.status === 'failed'
                        ? 'failed'
                        : binding.run.status === 'awaiting-provider-verification' ? 'action-required' : 'in-progress',
                    message: binding.run.problem?.detail ?? previous?.message ?? 'Preparing the media request.',
                    progress: binding.run.progress ?? createDefaultMediaGenerationRunProgress(
                        binding.run.status,
                        binding.run.problem?.detail ?? 'Preparing the media request.',
                    ),
                    plannedMediaType: getPlannedMediaType(String(binding.run.modelId)),
                    ...(binding.run.problem ? { problem: binding.run.problem } : {}),
                    ...(binding.run.requiredVerificationAssetIds?.[0] ? {
                        verificationAssetId: binding.run.requiredVerificationAssetIds[0],
                    } : {}),
                    requestRevision,
                    position: parent ? {
                        x: parent.position.x + parent.dimensions.width + 80,
                        y: parent.position.y + binding.run.generationRun * (dimensions.height + 24),
                    } : previous?.position ?? { x: 80, y: 80 },
                    updatedAt: now,
                })
            }
            const edgeKeys = new Set<string>()
            const edges = canvasState.edges.flatMap(edge => {
                const sourceNodeId = replacementByOldId.get(edge.sourceNodeId) ?? edge.sourceNodeId
                const targetNodeId = replacementByOldId.get(edge.targetNodeId) ?? edge.targetNodeId
                const targetsOperationNode = bindingByTargetId.has(targetNodeId)
                const sourceHandle = targetsOperationNode ? edge.sourceHandle ?? 'right' : edge.sourceHandle
                const targetHandle = targetsOperationNode ? edge.targetHandle ?? 'left' : edge.targetHandle
                const key = [sourceNodeId, targetNodeId, sourceHandle ?? '', targetHandle ?? ''].join(':')
                if (edgeKeys.has(key)) {
                    changed = true
                    return []
                }
                edgeKeys.add(key)
                if (sourceNodeId === edge.sourceNodeId
                    && targetNodeId === edge.targetNodeId
                    && sourceHandle === edge.sourceHandle
                    && targetHandle === edge.targetHandle) return [edge]
                changed = true
                return [{
                    ...edge,
                    sourceNodeId,
                    targetNodeId,
                    ...(targetsOperationNode ? {
                        sourceHandle: edge.sourceHandle ?? 'right',
                        targetHandle: edge.targetHandle ?? 'left',
                    } : {}),
                    edgeId: `edge-${sourceNodeId}-${targetNodeId}`,
                }]
            })
            for (const binding of bindings) {
                if (!nodes.some(node => node.nodeId === binding.lineageParentNodeId)
                    || !nodes.some(node => node.nodeId === binding.operationNodeId)) continue
                const key = [binding.lineageParentNodeId, binding.operationNodeId, 'right', 'left'].join(':')
                if (edgeKeys.has(key)) continue
                edgeKeys.add(key)
                changed = true
                edges.push({
                    edgeId: `edge-${binding.lineageParentNodeId}-${binding.operationNodeId}`,
                    sourceNodeId: binding.lineageParentNodeId,
                    targetNodeId: binding.operationNodeId,
                    sourceHandle: 'right',
                    targetHandle: 'left',
                    pathType: 'horizontal-bezier',
                })
            }
            const mediaGenerationByMarkerNodeId = new Map<string, BranchMarkerMediaGenerationState>(bindings.map(binding => [
                binding.lineageParentNodeId,
                {
                    status: binding.run.status,
                    message: binding.run.problem?.detail
                        ?? binding.run.progress?.message
                        ?? 'Preparing the media request.',
                    progress: binding.run.progress ?? createDefaultMediaGenerationRunProgress(
                        binding.run.status,
                        binding.run.problem?.detail ?? 'Preparing the media request.',
                    ),
                    generationRun: binding.run.generationRun,
                    updatedAt: Date.now(),
                } satisfies BranchMarkerMediaGenerationState,
            ] as const))
            const nodesWithMarkerProgress = nodes.map(node => {
                const mediaGeneration = mediaGenerationByMarkerNodeId.get(node.nodeId)
                if (!mediaGeneration || !isBranchMarkerNode(node)) return node
                changed = true
                return { ...node, mediaGeneration }
            })
            return { canvasState: { ...canvasState, nodes: nodesWithMarkerProgress, edges }, changed }
        },
    })
}

export const removeMediaGenerationOperationNodes = async ({
    workspaceId,
    generationRequestId,
    terminalStatus = 'completed',
}: {
    workspaceId: string
    generationRequestId: string
    terminalStatus?: 'completed' | 'cancelled'
}): Promise<void> => {
    await Workspace.mutateCanvasState({
        workspaceId,
        origin: 'MediaGenerationOperationProjection.remove',
        mutate: canvasState => {
            const removedOperations = canvasState.nodes
                .filter((node): node is OperationStatusCanvasNode => node.type === 'operationStatus'
                    && node.operation === 'media-generation'
                    && node.generationRequestId === generationRequestId)
            const removedIds = new Set(removedOperations.map(node => node.nodeId))
            if (removedIds.size === 0) {
                let changed = false
                const nodes = canvasState.nodes.map(node => {
                    if (!isBranchMarkerNode(node)
                        || node.generationRequestId !== generationRequestId
                        || !node.mediaGeneration) return node
                    changed = true
                    const message = node.mediaGeneration.progress.message
                        || (terminalStatus === 'completed'
                            ? 'Media generation completed.'
                            : 'Media generation cancelled.')
                    return {
                        ...node,
                        mediaGeneration: {
                            ...node.mediaGeneration,
                            status: terminalStatus,
                            message,
                            progress: settleMediaGenerationRunProgress(
                                node.mediaGeneration.progress,
                                terminalStatus,
                                message,
                            ),
                            updatedAt: Date.now(),
                        },
                    }
                })
                return {
                    canvasState: changed ? { ...canvasState, nodes } : canvasState,
                    changed,
                }
            }
            let nodes = canvasState.nodes
            for (const operationNode of removedOperations) {
                const message = operationNode.progress?.message
                    ?? (terminalStatus === 'completed'
                        ? 'Media generation completed.'
                        : 'Media generation cancelled.')
                const ownerProjection = projectMediaGenerationStateToOwners({
                    nodes,
                    edges: canvasState.edges,
                    operationNodeId: operationNode.nodeId,
                    state: {
                        status: terminalStatus,
                        message,
                        progress: settleMediaGenerationRunProgress(
                            operationNode.progress,
                            terminalStatus,
                            message,
                        ),
                        ...(operationNode.generationRun !== undefined ? {
                            generationRun: operationNode.generationRun,
                        } : {}),
                        updatedAt: Date.now(),
                    },
                })
                nodes = ownerProjection.changed
                    ? ownerProjection.nodes
                    : projectMediaGenerationStateToRequestMarkers({
                        nodes: ownerProjection.nodes,
                        generationRequestId,
                        ...(operationNode.generationRun === undefined
                            ? {}
                            : { generationRun: operationNode.generationRun }),
                        state: {
                            status: terminalStatus,
                            message,
                            progress: settleMediaGenerationRunProgress(
                                operationNode.progress,
                                terminalStatus,
                                message,
                            ),
                            ...(operationNode.generationRun === undefined
                                ? {}
                                : { generationRun: operationNode.generationRun }),
                            updatedAt: Date.now(),
                        },
                    }).nodes
            }
            return {
                canvasState: {
                    ...canvasState,
                    nodes: nodes.filter(node => !removedIds.has(node.nodeId)),
                    edges: canvasState.edges.filter(edge =>
                        !removedIds.has(edge.sourceNodeId) && !removedIds.has(edge.targetNodeId)),
                },
                changed: true,
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
            const operationNode = canvasState.nodes.find((node): node is OperationStatusCanvasNode =>
                node.nodeId === operationNodeId && node.type === 'operationStatus')
            if (!operationNode) {
                const message = progress?.message ?? 'Media generation completed.'
                const projection = projectMediaGenerationStateToRequestMarkers({
                    nodes: canvasState.nodes,
                    generationRequestId,
                    ...(generationRun === undefined ? {} : { generationRun }),
                    state: {
                        status: 'completed',
                        message,
                        progress: settleMediaGenerationRunProgress(progress, 'completed', message),
                        ...(generationRun === undefined ? {} : { generationRun }),
                        updatedAt: Date.now(),
                    },
                })
                return {
                    canvasState: projection.changed
                        ? { ...canvasState, nodes: projection.nodes }
                        : canvasState,
                    changed: projection.changed,
                }
            }
            const message = progress?.message ?? operationNode.progress?.message ?? 'Media generation completed.'
            const projection = projectMediaGenerationStateToOwners({
                nodes: canvasState.nodes,
                edges: canvasState.edges,
                operationNodeId,
                state: {
                    status: 'completed',
                    message,
                    progress: settleMediaGenerationRunProgress(
                        progress ?? operationNode.progress,
                        'completed',
                        message,
                    ),
                    ...(operationNode.generationRun !== undefined ? {
                        generationRun: operationNode.generationRun,
                    } : {}),
                    updatedAt: Date.now(),
                },
            })
            const directProjection = projection.changed
                ? projection
                : projectMediaGenerationStateToRequestMarkers({
                    nodes: projection.nodes,
                    generationRequestId,
                    ...(generationRun === undefined ? {} : { generationRun }),
                    state: {
                        status: 'completed',
                        message,
                        progress: settleMediaGenerationRunProgress(
                            progress ?? operationNode.progress,
                            'completed',
                            message,
                        ),
                        ...(generationRun === undefined ? {} : { generationRun }),
                        updatedAt: Date.now(),
                    },
                })
            return {
                canvasState: {
                    ...canvasState,
                    nodes: directProjection.nodes.filter(node => node.nodeId !== operationNodeId),
                    edges: canvasState.edges.filter(edge =>
                        edge.sourceNodeId !== operationNodeId && edge.targetNodeId !== operationNodeId),
                },
                changed: true,
            }
        },
    })
}
