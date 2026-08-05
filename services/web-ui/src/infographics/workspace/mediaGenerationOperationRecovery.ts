import {
    createDefaultMediaGenerationRunProgress,
    settleMediaGenerationRunProgress,
    type BranchMarkerMediaGenerationState,
    type CanvasState,
    type MediaGenerationProblem,
    type MediaGenerationRun,
    type MediaGenerationRunProgress,
    type MediaGenerationRunStatus,
    type MediaGenerationRequest,
    type MediaGenerationRequestEvent,
    type OperationStatusCanvasNode,
    type OperationProgressItem,
} from '@lixpi/constants'

export type MediaGenerationOperationRecoveryResult = {
    state: CanvasState
    changed: boolean
    updatedNodeIds: string[]
    removedNodeIds: string[]
}

type OperationPatch = {
    status: OperationStatusCanvasNode['status']
    message: string
    problem?: MediaGenerationProblem
    candidateAssetIds?: string[]
    unresolvedBindingId?: string
    requestRevision: number
    verificationAssetId?: string
    progress?: MediaGenerationRunProgress
    updatedAt: number
}

type OperationRemoval = {
    remove: 'completed' | 'cancelled'
}

function isMediaGenerationOperationNodeForRequest(
    node: CanvasState['nodes'][number],
    generationRequestId: string,
): node is OperationStatusCanvasNode {
    return node.type === 'operationStatus'
        && node.operation === 'media-generation'
        && node.generationRequestId === generationRequestId
}

function replaceOperationFields(
    node: OperationStatusCanvasNode,
    patch: OperationPatch,
): OperationStatusCanvasNode {
    const {
        problem: _problem,
        candidateAssetIds: _candidateAssetIds,
        unresolvedBindingId: _unresolvedBindingId,
        verificationAssetId: _verificationAssetId,
        ...stableNode
    } = node

    return {
        ...stableNode,
        ...patch,
    }
}

function isBranchMarkerNode(
    node: CanvasState['nodes'][number],
): node is Extract<CanvasState['nodes'][number], { type: 'branchOrigin' | 'branchFork' | 'branchLine' }> {
    return node.type === 'branchOrigin' || node.type === 'branchFork' || node.type === 'branchLine'
}

function getOperationOwnerNodeIds(state: CanvasState, operationNodeId: string): string[] {
    return state.edges
        .filter(edge => edge.targetNodeId === operationNodeId)
        .map(edge => edge.sourceNodeId)
}

function toMarkerRunStatus(status: OperationStatusCanvasNode['status']): MediaGenerationRunStatus {
    if (status === 'failed') return 'failed'
    if (status === 'action-required') return 'awaiting-provider-verification'
    return 'running'
}

function projectMarkerStates(
    state: CanvasState,
    nodes: CanvasState['nodes'],
    statesByOperationNodeId: ReadonlyMap<string, BranchMarkerMediaGenerationState>,
): { nodes: CanvasState['nodes']; updatedMarkerNodeIds: string[] } {
    const stateByMarkerNodeId = new Map<string, BranchMarkerMediaGenerationState>()
    for (const [operationNodeId, mediaGeneration] of statesByOperationNodeId) {
        for (const ownerNodeId of getOperationOwnerNodeIds(state, operationNodeId)) {
            stateByMarkerNodeId.set(ownerNodeId, mediaGeneration)
        }
    }
    const updatedMarkerNodeIds: string[] = []
    return {
        nodes: nodes.map(node => {
            const mediaGeneration = stateByMarkerNodeId.get(node.nodeId)
            if (!mediaGeneration || !isBranchMarkerNode(node)) return node
            updatedMarkerNodeIds.push(node.nodeId)
            return { ...node, mediaGeneration }
        }),
        updatedMarkerNodeIds,
    }
}

function projectRequestStateToMarkers(
    state: CanvasState,
    generationRequestId: string,
    generationRun: number | undefined,
    mediaGeneration: BranchMarkerMediaGenerationState,
): MediaGenerationOperationRecoveryResult {
    const updatedNodeIds: string[] = []
    const nodes = state.nodes.map(node => {
        if (!isBranchMarkerNode(node)
            || node.generationRequestId !== generationRequestId
            || (generationRun !== undefined
                && node.mediaGeneration?.generationRun !== undefined
                && node.mediaGeneration.generationRun !== generationRun)) return node
        updatedNodeIds.push(node.nodeId)
        return { ...node, mediaGeneration }
    })
    return updatedNodeIds.length === 0
        ? { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
        : {
            state: { ...state, nodes },
            changed: true,
            updatedNodeIds,
            removedNodeIds: [],
        }
}

function removeOperationNodes(
    state: CanvasState,
    removedNodeIds: Set<string>,
    terminalStatus: 'completed' | 'cancelled',
): MediaGenerationOperationRecoveryResult {
    if (removedNodeIds.size === 0) {
        return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
    }

    const terminalStates = new Map<string, BranchMarkerMediaGenerationState>()
    for (const node of state.nodes) {
        if (node.type !== 'operationStatus' || !removedNodeIds.has(node.nodeId)) continue
        const message = node.progress?.message
            ?? (terminalStatus === 'completed' ? 'Media generation completed.' : 'Media generation cancelled.')
        terminalStates.set(node.nodeId, {
            status: terminalStatus,
            message,
            progress: settleMediaGenerationRunProgress(node.progress, terminalStatus, message),
            ...(node.generationRun !== undefined ? { generationRun: node.generationRun } : {}),
            updatedAt: Date.now(),
        })
    }
    const markerProjection = projectMarkerStates(
        state,
        state.nodes.filter(node => !removedNodeIds.has(node.nodeId)),
        terminalStates,
    )
    return {
        state: {
            ...state,
            nodes: markerProjection.nodes,
            edges: state.edges.filter(edge => (
                !removedNodeIds.has(edge.sourceNodeId)
                && !removedNodeIds.has(edge.targetNodeId)
            )),
        },
        changed: true,
        updatedNodeIds: markerProjection.updatedMarkerNodeIds,
        removedNodeIds: [...removedNodeIds],
    }
}

function settleTerminalBranchMarkerProgress(
    result: MediaGenerationOperationRecoveryResult,
    generationRequestId: string,
    runs: readonly Pick<MediaGenerationRun, 'generationRun' | 'status' | 'progress' | 'problem'>[],
    requestStatus?: 'completed' | 'cancelled',
): MediaGenerationOperationRecoveryResult {
    const updatedNodeIds = new Set(result.updatedNodeIds)
    let changed = result.changed
    const nodes = result.state.nodes.map(node => {
        if (!isBranchMarkerNode(node)
            || node.generationRequestId !== generationRequestId
            || !node.mediaGeneration) return node
        const run = runs.find(candidate => candidate.generationRun === node.mediaGeneration?.generationRun)
            ?? (runs.length === 1 ? runs[0] : undefined)
        const status = requestStatus === 'cancelled'
            ? 'cancelled'
            : requestStatus === 'completed' ? run?.status ?? 'completed' : run?.status
        if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return node
        const message = status === 'completed'
            ? run?.progress?.message ?? 'Media generation completed.'
            : status === 'cancelled'
                ? 'Media generation cancelled.'
                : run?.problem?.detail ?? 'Media generation failed.'
        const progress = settleMediaGenerationRunProgress(
            run?.progress ?? node.mediaGeneration.progress,
            status,
            message,
        )
        if (node.mediaGeneration.status === status
            && node.mediaGeneration.message === message
            && JSON.stringify(node.mediaGeneration.progress) === JSON.stringify(progress)) return node
        changed = true
        updatedNodeIds.add(node.nodeId)
        return {
            ...node,
            mediaGeneration: {
                ...node.mediaGeneration,
                status,
                message,
                progress,
                updatedAt: Date.now(),
            },
        }
    })
    return {
        ...result,
        state: changed ? { ...result.state, nodes } : result.state,
        changed,
        updatedNodeIds: [...updatedNodeIds],
    }
}

function applyOperationPatches(
    state: CanvasState,
    generationRequestId: string,
    patchForNode: (node: OperationStatusCanvasNode) => OperationPatch | OperationRemoval | null,
): MediaGenerationOperationRecoveryResult {
    const removedNodeIds = new Set<string>()
    const updatedNodeIds: string[] = []
    const markerStatesByOperationNodeId = new Map<string, BranchMarkerMediaGenerationState>()
    const nodes = state.nodes.flatMap(node => {
        if (!isMediaGenerationOperationNodeForRequest(node, generationRequestId)) return [node]
        const patch = patchForNode(node)
        if (!patch) return [node]
        if ('remove' in patch) {
            removedNodeIds.add(node.nodeId)
            const message = node.progress?.message
                ?? (patch.remove === 'completed' ? 'Media generation completed.' : 'Media generation cancelled.')
            markerStatesByOperationNodeId.set(node.nodeId, {
                status: patch.remove,
                message,
                progress: settleMediaGenerationRunProgress(node.progress, patch.remove, message),
                ...(node.generationRun !== undefined ? { generationRun: node.generationRun } : {}),
                updatedAt: Date.now(),
            })
            return []
        }
        const updatedNode = replaceOperationFields(node, patch)
        if (JSON.stringify(updatedNode) === JSON.stringify(node)) return [node]
        updatedNodeIds.push(node.nodeId)
        markerStatesByOperationNodeId.set(node.nodeId, {
            status: toMarkerRunStatus(updatedNode.status),
            message: updatedNode.message,
            progress: updatedNode.progress ?? createDefaultMediaGenerationRunProgress(
                toMarkerRunStatus(updatedNode.status),
                updatedNode.message,
            ),
            ...(updatedNode.generationRun !== undefined ? { generationRun: updatedNode.generationRun } : {}),
            updatedAt: updatedNode.updatedAt,
        })
        return [updatedNode]
    })

    if (removedNodeIds.size === 0 && updatedNodeIds.length === 0) {
        return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
    }

    const markerProjection = projectMarkerStates(state, nodes, markerStatesByOperationNodeId)
    return {
        state: {
            ...state,
            nodes: markerProjection.nodes,
            edges: removedNodeIds.size === 0
                ? state.edges
                : state.edges.filter(edge => (
                    !removedNodeIds.has(edge.sourceNodeId)
                    && !removedNodeIds.has(edge.targetNodeId)
                )),
        },
        changed: true,
        updatedNodeIds: [...updatedNodeIds, ...markerProjection.updatedMarkerNodeIds],
        removedNodeIds: [...removedNodeIds],
    }
}

export function applyMediaGenerationRequestToOperationNodes(
    state: CanvasState,
    request: MediaGenerationRequest,
): MediaGenerationOperationRecoveryResult {
    if (request.status === 'completed' || request.status === 'cancelled') {
        const removal = removeOperationNodes(state, new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, request.generationRequestId))
            .map(node => node.nodeId)), request.status)
        return settleTerminalBranchMarkerProgress(
            removal,
            request.generationRequestId,
            request.runs,
            request.status,
        )
    }

    const firstUnresolvedBinding = request.unresolvedBindings[0]
    const firstRun = request.runs[0]
    return applyOperationPatches(state, request.generationRequestId, node => {
        if ((node.requestRevision ?? 0) > request.revision) return null
        const run = request.runs.find(candidate => (
            candidate.operationNodeId === node.nodeId
            || candidate.generationRun === node.generationRun
        ))
        if (!run) return null
        if (run.status === 'completed' || run.status === 'cancelled') return { remove: run.status }

        if (firstUnresolvedBinding && run.generationRun === firstRun?.generationRun) {
            const message = 'Choose which attached Asset the prompt refers to.'
            return {
                status: 'action-required',
                message,
                progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
                candidateAssetIds: [...new Set(request.unresolvedBindings.flatMap(binding => (
                    binding.candidates.map(candidate => candidate.assetId)
                )))],
                unresolvedBindingId: firstUnresolvedBinding.bindingId,
                requestRevision: request.revision,
                updatedAt: request.updatedAt,
            }
        }

        if (run.status === 'awaiting-provider-verification') {
            const message = run.problem?.detail ?? 'Provider verification is required to continue.'
            return {
                status: 'action-required',
                message,
                progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
                ...(run.problem ? { problem: run.problem } : {}),
                ...(run.requiredVerificationAssetIds?.[0] ? {
                    verificationAssetId: run.requiredVerificationAssetIds[0],
                } : {}),
                requestRevision: request.revision,
                updatedAt: request.updatedAt,
            }
        }

        if (run.status === 'failed') {
            const message = run.problem?.detail ?? 'Generation failed.'
            return {
                status: 'failed',
                message,
                progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
                ...(run.problem ? { problem: run.problem } : {}),
                requestRevision: request.revision,
                updatedAt: request.updatedAt,
            }
        }

        const message = run.status === 'running'
            ? run.progress?.message ?? 'The provider is generating media.'
            : 'Preparing the media request.'
        return {
            status: 'in-progress',
            message,
            progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
            requestRevision: request.revision,
            updatedAt: request.updatedAt,
        }
    })
}

function readStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const strings = value.filter((candidate): candidate is string => typeof candidate === 'string')
    return strings.length > 0 ? strings : undefined
}

function readProblem(value: unknown): MediaGenerationProblem | undefined {
    return value && typeof value === 'object' ? value as MediaGenerationProblem : undefined
}

function readProgressItem(value: unknown): OperationProgressItem | undefined {
    if (!value || typeof value !== 'object') return undefined
    const candidate = value as Record<string, unknown>
    const validStatuses = new Set([
        'pending',
        'running',
        'completed',
        'attention',
        'failed',
        'cancelled',
        'skipped',
    ])
    if (typeof candidate.id !== 'string'
        || typeof candidate.title !== 'string'
        || typeof candidate.status !== 'string'
        || !validStatuses.has(candidate.status)) return undefined
    const children = Array.isArray(candidate.children)
        ? candidate.children.map(readProgressItem).filter((item): item is OperationProgressItem => Boolean(item))
        : undefined
    return {
        id: candidate.id,
        title: candidate.title,
        status: candidate.status as OperationProgressItem['status'],
        ...(typeof candidate.summary === 'string' ? { summary: candidate.summary } : {}),
        ...(typeof candidate.meta === 'string' ? { meta: candidate.meta } : {}),
        ...(children?.length ? { children } : {}),
    }
}

function readProgress(value: unknown): MediaGenerationRunProgress | undefined {
    if (!value || typeof value !== 'object') return undefined
    const candidate = value as Record<string, unknown>
    const validPhases = new Set(['preparing', 'rendering', 'assessing', 'composing'])
    if (typeof candidate.phase !== 'string'
        || !validPhases.has(candidate.phase)
        || typeof candidate.completedSteps !== 'number'
        || typeof candidate.totalSteps !== 'number'
        || typeof candidate.message !== 'string') return undefined
    const items = Array.isArray(candidate.items)
        ? candidate.items.map(readProgressItem).filter((item): item is OperationProgressItem => Boolean(item))
        : undefined
    return {
        phase: candidate.phase as MediaGenerationRunProgress['phase'],
        completedSteps: candidate.completedSteps,
        totalSteps: candidate.totalSteps,
        message: candidate.message,
        ...(items?.length ? { items } : {}),
    }
}

export function applyMediaGenerationRequestEventToOperationNodes(
    state: CanvasState,
    event: MediaGenerationRequestEvent,
): MediaGenerationOperationRecoveryResult {
    const generationRun = typeof event.payload.generationRun === 'number'
        ? event.payload.generationRun
        : undefined
    const runStatus = typeof event.payload.runStatus === 'string'
        ? event.payload.runStatus
        : undefined
    const validRunStatuses = new Set<MediaGenerationRunStatus>([
        'pending',
        'awaiting-provider-verification',
        'running',
        'completed',
        'failed',
        'cancelled',
    ])
    const mediaRunStatus = runStatus && validRunStatuses.has(runStatus as MediaGenerationRunStatus)
        ? runStatus as MediaGenerationRunStatus
        : undefined
    const problem = readProblem(event.payload.problem)
    const progressMessage = typeof event.payload.message === 'string'
        ? event.payload.message
        : undefined
    const progress = readProgress(event.payload.progress)
    const requestStatus = typeof event.payload.status === 'string' ? event.payload.status : undefined
    if (requestStatus === 'completed' || requestStatus === 'cancelled') {
        const removal = removeOperationNodes(state, new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, event.generationRequestId))
            .map(node => node.nodeId)), requestStatus)
        const terminalRuns = generationRun === undefined || !mediaRunStatus
            ? []
            : [{
                generationRun,
                status: mediaRunStatus,
                ...(progress ? { progress } : {}),
                ...(problem ? { problem } : {}),
            }]
        return settleTerminalBranchMarkerProgress(
            removal,
            event.generationRequestId,
            terminalRuns,
            requestStatus,
        )
    }
    if (generationRun !== undefined && (runStatus === 'completed' || runStatus === 'cancelled')) {
        const removal = removeOperationNodes(state, new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, event.generationRequestId)
                && node.generationRun === generationRun)
            .map(node => node.nodeId)), runStatus)
        return settleTerminalBranchMarkerProgress(removal, event.generationRequestId, [{
            generationRun,
            status: runStatus,
            ...(progress ? { progress } : {}),
            ...(problem ? { problem } : {}),
        }])
    }

    const requestNodes = state.nodes.filter(node => (
        isMediaGenerationOperationNodeForRequest(node, event.generationRequestId)
    ))
    const candidateAssetIds = readStringArray(event.payload.candidateAssetIds)
    const verificationAssetIds = readStringArray(event.payload.assetIds)
    const verificationAssetId = typeof event.payload.verificationAssetId === 'string'
        ? event.payload.verificationAssetId
        : verificationAssetIds?.[0]
    const unresolvedBindingId = typeof event.payload.bindingId === 'string'
        ? event.payload.bindingId
        : undefined
    const targetNode = generationRun === undefined
        ? requestNodes[0]
        : requestNodes.find(node => node.generationRun === generationRun)
    if (!targetNode) {
        if (progress || runStatus === 'running' || runStatus === 'failed') {
            const status = runStatus === 'failed' ? 'failed' : 'running'
            const message = problem?.detail
                ?? progressMessage
                ?? progress?.message
                ?? (status === 'failed' ? 'Generation failed.' : 'The provider is generating media.')
            return projectRequestStateToMarkers(
                state,
                event.generationRequestId,
                generationRun,
                {
                    status,
                    message,
                    progress: progress ?? createDefaultMediaGenerationRunProgress(status, message),
                    ...(generationRun === undefined ? {} : { generationRun }),
                    updatedAt: event.createdAt,
                },
            )
        }
        return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
    }

    return applyOperationPatches(state, event.generationRequestId, node => {
        if (node.nodeId !== targetNode.nodeId) return null
        if ((node.requestRevision ?? 0) > event.requestRevision) return null
        if (event.status === 'MEDIA_GENERATION_ACTION_REQUIRED') {
            const nextProblem = problem ?? node.problem
            const nextCandidateAssetIds = candidateAssetIds ?? node.candidateAssetIds
            const nextUnresolvedBindingId = unresolvedBindingId ?? node.unresolvedBindingId
            const nextVerificationAssetId = verificationAssetId ?? node.verificationAssetId
            let message = node.message
            if (nextProblem) message = nextProblem.detail
            else if (nextCandidateAssetIds) message = 'Choose which attached Asset the prompt refers to.'
            else if (nextVerificationAssetId) message = 'Provider verification is required to continue.'
            return {
                status: 'action-required',
                message,
                ...(nextProblem ? { problem: nextProblem } : {}),
                ...(nextCandidateAssetIds ? { candidateAssetIds: nextCandidateAssetIds } : {}),
                ...(nextUnresolvedBindingId ? { unresolvedBindingId: nextUnresolvedBindingId } : {}),
                ...(nextVerificationAssetId ? { verificationAssetId: nextVerificationAssetId } : {}),
                requestRevision: event.requestRevision,
                updatedAt: event.createdAt,
            }
        }
        if (event.status === 'MEDIA_GENERATION_PROBLEM' || runStatus === 'failed') {
            const message = problem?.detail ?? 'Generation failed.'
            return {
                status: 'failed',
                message,
                progress: settleMediaGenerationRunProgress(progress ?? node.progress, 'failed', message),
                ...(problem ? { problem } : {}),
                requestRevision: event.requestRevision,
                updatedAt: event.createdAt,
            }
        }
        const message = progressMessage ?? (runStatus === 'running'
            ? 'The provider is generating media.'
            : 'Resuming the media request.')
        return {
            status: 'in-progress',
            message,
            ...(progress
                ? { progress }
                : mediaRunStatus ? { progress: createDefaultMediaGenerationRunProgress(mediaRunStatus, message) } : {}),
            requestRevision: event.requestRevision,
            updatedAt: event.createdAt,
        }
    })
}
