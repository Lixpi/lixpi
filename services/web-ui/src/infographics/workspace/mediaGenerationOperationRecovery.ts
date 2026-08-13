import {
    createDefaultMediaGenerationRunProgress,
    settleMediaGenerationRunProgress,
    type CanvasNode,
    type CanvasState,
    type MediaGenerationProblem,
    type MediaGenerationProgressState,
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
    progress?: MediaGenerationRunProgress
}

type GeneratedMediaNode = Extract<CanvasNode, { type: 'image' | 'video' }>

export type MediaGenerationStreamFailure = {
    generationRequestId: string
    mediaRunId?: string
    outputNodeId?: string
    message: string
    requestRevision: number
    updatedAt: number
}

const FAILED_OPERATION_DIMENSIONS = { width: 360, height: 104 } as const

function isMediaGenerationOperationNodeForRequest(
    node: CanvasNode,
    generationRequestId: string,
): node is OperationStatusCanvasNode {
    return node.type === 'operationStatus'
        && node.operation === 'media-generation'
        && node.generationRequestId === generationRequestId
}

function isGeneratedMediaNode(node: CanvasNode): node is GeneratedMediaNode {
    return node.type === 'image' || node.type === 'video'
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
    return { ...stableNode, ...patch }
}

function toRunStatus(status: OperationStatusCanvasNode['status']): MediaGenerationRunStatus {
    if (status === 'failed') return 'failed'
    if (status === 'action-required') return 'awaiting-provider-verification'
    return 'running'
}

function createProgressState({
    generationRequestId,
    status,
    message,
    progress,
    generationRun,
    mediaRunId,
    updatedAt,
}: {
    generationRequestId: string
    status: MediaGenerationRunStatus
    message: string
    progress?: MediaGenerationRunProgress
    generationRun?: number
    mediaRunId?: string
    updatedAt: number
}): MediaGenerationProgressState {
    return {
        generationRequestId,
        status,
        message,
        progress: progress ?? createDefaultMediaGenerationRunProgress(status, message),
        ...(generationRun === undefined ? {} : { generationRun }),
        ...(mediaRunId ? { mediaRunId } : {}),
        updatedAt,
    }
}

function mediaNodeMatches(
    node: GeneratedMediaNode,
    generationRequestId: string,
    generationRun: number | undefined,
    outputNodeId: string | undefined,
    mediaRunId?: string,
): boolean {
    if (outputNodeId && node.nodeId === outputNodeId) return true
    if (node.generationProgress?.generationRequestId === generationRequestId) {
        if (mediaRunId && node.generationProgress.mediaRunId === mediaRunId) return true
        if (generationRun !== undefined && node.generationProgress.generationRun === generationRun) return true
    }
    if (node.generatedBy?.generationRequestId !== generationRequestId) return false
    return Boolean(mediaRunId && node.generatedBy.mediaRunId === mediaRunId)
}

function projectProgressToMediaNodes({
    nodes,
    generationRequestId,
    generationRun,
    outputNodeId,
    mediaRunId,
    progressState,
}: {
    nodes: CanvasNode[]
    generationRequestId: string
    generationRun?: number
    outputNodeId?: string
    mediaRunId?: string
    progressState: MediaGenerationProgressState
}): { nodes: CanvasNode[]; updatedNodeIds: string[] } {
    const updatedNodeIds: string[] = []
    return {
        nodes: nodes.map(node => {
            if (!isGeneratedMediaNode(node) || !mediaNodeMatches(
                node,
                generationRequestId,
                generationRun,
                outputNodeId,
                mediaRunId,
            )) return node
            const nextProgressState = { ...node.generationProgress, ...progressState }
            if (JSON.stringify(node.generationProgress) === JSON.stringify(nextProgressState)) return node
            updatedNodeIds.push(node.nodeId)
            return { ...node, generationProgress: nextProgressState }
        }),
        updatedNodeIds,
    }
}

function replaceFailedPendingOutputWithOperation({
    state,
    generationRequestId,
    generationRun,
    mediaRunId,
    outputNodeId,
    operationNodeId,
    message,
    problem,
    requestRevision,
    progress,
    updatedAt,
}: {
    state: CanvasState
    generationRequestId: string
    generationRun?: number
    mediaRunId?: string
    outputNodeId?: string
    operationNodeId?: string
    message: string
    problem?: MediaGenerationProblem
    requestRevision: number
    progress?: MediaGenerationRunProgress
    updatedAt: number
}): MediaGenerationOperationRecoveryResult {
    const output = state.nodes.find((node): node is GeneratedMediaNode => (
        isGeneratedMediaNode(node)
        && node.mediaGenerationPhase === 'pending-before-first-frame'
        && mediaNodeMatches(node, generationRequestId, generationRun, outputNodeId, mediaRunId)
    ))
    if (!output) return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }

    const existingOperation = state.nodes.find((node): node is OperationStatusCanvasNode => (
        isMediaGenerationOperationNodeForRequest(node, generationRequestId)
        && (
            Boolean(operationNodeId && node.nodeId === operationNodeId)
            || Boolean(mediaRunId && node.mediaRunId === mediaRunId)
            || Boolean(outputNodeId && node.outputNodeId === outputNodeId)
            || (generationRun !== undefined && node.generationRun === generationRun)
        )
    ))
    const dimensions = existingOperation?.dimensions ?? FAILED_OPERATION_DIMENSIONS
    const { parentId: _existingParentId, ...existingOperationWithoutParent } = existingOperation ?? {}
    const failedOperation: OperationStatusCanvasNode = {
        ...existingOperationWithoutParent,
        nodeId: output.nodeId,
        type: 'operationStatus',
        operation: 'media-generation',
        status: 'failed',
        title: existingOperation?.title
            ?? `Generating with ${output.generationProgress?.mediaModelId ?? 'media provider'}`,
        message,
        generationRequestId,
        ...(generationRun === undefined ? {} : { generationRun }),
        ...(mediaRunId ? { mediaRunId } : {}),
        outputNodeId: output.nodeId,
        plannedMediaType: output.type,
        ...(output.generationProgress?.lineageAssignment
            ? { lineageAssignment: output.generationProgress.lineageAssignment }
            : {}),
        ...(problem ? { problem } : {}),
        requestRevision,
        progress: settleMediaGenerationRunProgress(
            progress ?? existingOperation?.progress ?? output.generationProgress?.progress,
            'failed',
            message,
        ),
        ...(output.parentId ? { parentId: output.parentId } : {}),
        position: {
            x: output.position.x + (output.dimensions.width - dimensions.width) / 2,
            y: output.position.y + (output.dimensions.height - dimensions.height) / 2,
        },
        dimensions,
        createdAt: existingOperation?.createdAt ?? updatedAt,
        updatedAt,
    }
    const replacedOperationNodeId = existingOperation?.nodeId !== output.nodeId
        ? existingOperation?.nodeId
        : undefined
    const edges = state.edges.filter(edge => (
        edge.sourceNodeId !== replacedOperationNodeId
        && edge.targetNodeId !== replacedOperationNodeId
    ))
    const nodes = state.nodes.flatMap(node => {
        if (node.nodeId === output.nodeId) return [failedOperation]
        if (node.nodeId === replacedOperationNodeId) return []
        return [node]
    })

    return {
        state: { ...state, nodes, edges },
        changed: true,
        updatedNodeIds: [failedOperation.nodeId],
        removedNodeIds: replacedOperationNodeId ? [replacedOperationNodeId] : [],
    }
}

export function applyMediaGenerationStreamFailureToOperationNodes(
    state: CanvasState,
    failure: MediaGenerationStreamFailure,
): MediaGenerationOperationRecoveryResult {
    const output = state.nodes.find((node): node is GeneratedMediaNode => (
        isGeneratedMediaNode(node)
        && mediaNodeMatches(
            node,
            failure.generationRequestId,
            undefined,
            failure.outputNodeId,
            failure.mediaRunId,
        )
    ))
    if (!output) return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }

    const generationRun = output.generationProgress?.generationRun
    const progress = settleMediaGenerationRunProgress(
        output.generationProgress?.progress,
        'failed',
        failure.message,
    )
    const projection = projectProgressToMediaNodes({
        nodes: state.nodes,
        generationRequestId: failure.generationRequestId,
        generationRun,
        outputNodeId: output.nodeId,
        mediaRunId: failure.mediaRunId ?? output.generationProgress?.mediaRunId,
        progressState: createProgressState({
            generationRequestId: failure.generationRequestId,
            status: 'failed',
            message: failure.message,
            progress,
            generationRun,
            mediaRunId: failure.mediaRunId ?? output.generationProgress?.mediaRunId,
            updatedAt: failure.updatedAt,
        }),
    })
    const projectedResult: MediaGenerationOperationRecoveryResult = {
        state: { ...state, nodes: projection.nodes },
        changed: projection.updatedNodeIds.length > 0,
        updatedNodeIds: projection.updatedNodeIds,
        removedNodeIds: [],
    }
    const replacement = replaceFailedPendingOutputWithOperation({
        state: projectedResult.state,
        generationRequestId: failure.generationRequestId,
        generationRun,
        mediaRunId: failure.mediaRunId ?? output.generationProgress?.mediaRunId,
        outputNodeId: output.nodeId,
        message: failure.message,
        requestRevision: failure.requestRevision,
        progress,
        updatedAt: failure.updatedAt,
    })
    if (!replacement.changed) return projectedResult
    return {
        ...replacement,
        updatedNodeIds: [...new Set([
            ...projectedResult.updatedNodeIds.filter(nodeId => !replacement.removedNodeIds.includes(nodeId)),
            ...replacement.updatedNodeIds,
        ])],
    }
}

function settleMediaNodesForRuns(
    state: CanvasState,
    generationRequestId: string,
    runs: readonly Pick<MediaGenerationRun, 'generationRun' | 'mediaRunId' | 'outputNodeId' | 'status' | 'progress' | 'problem'>[],
    requestStatus?: 'completed' | 'cancelled',
): MediaGenerationOperationRecoveryResult {
    const updatedNodeIds: string[] = []
    const nodes = state.nodes.map(node => {
        if (!isGeneratedMediaNode(node)) return node
        const belongsToRequest = node.generationProgress?.generationRequestId === generationRequestId
            || node.generatedBy?.generationRequestId === generationRequestId
            || runs.some(candidate => candidate.outputNodeId === node.nodeId)
        if (!belongsToRequest) return node
        const matchingRun = runs.find(candidate => mediaNodeMatches(
            node,
            generationRequestId,
            candidate.generationRun,
            candidate.outputNodeId,
            candidate.mediaRunId,
        ))
        const run = matchingRun ?? (runs.length === 1 ? runs[0] : undefined)
        const existingTerminalStatus = node.generationProgress
            && ['completed', 'failed', 'cancelled'].includes(node.generationProgress.status)
            ? node.generationProgress.status as 'completed' | 'failed' | 'cancelled'
            : undefined
        const status = requestStatus === 'cancelled'
            ? run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled'
                ? run.status
                : existingTerminalStatus ?? 'cancelled'
            : run?.status === 'failed' ? 'failed'
                : run?.status === 'cancelled' ? 'cancelled' : 'completed'
        const message = status === 'completed'
            ? run?.progress?.message ?? 'Media generation completed.'
            : status === 'cancelled'
                ? 'Media generation cancelled.'
                : run?.problem?.detail ?? 'Media generation failed.'
        const progress = settleMediaGenerationRunProgress(
            run?.progress ?? node.generationProgress?.progress,
            status,
            message,
        )
        const nextProgress = createProgressState({
            generationRequestId,
            status,
            message,
            progress,
            generationRun: run?.generationRun ?? node.generationProgress?.generationRun,
            mediaRunId: run?.mediaRunId ?? node.generationProgress?.mediaRunId,
            updatedAt: Date.now(),
        })
        if (JSON.stringify(node.generationProgress) === JSON.stringify(nextProgress)) return node
        updatedNodeIds.push(node.nodeId)
        return { ...node, generationProgress: nextProgress }
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

function applyOperationPatches(
    state: CanvasState,
    generationRequestId: string,
    patchForNode: (node: OperationStatusCanvasNode) => OperationPatch | OperationRemoval | null,
): MediaGenerationOperationRecoveryResult {
    const removedNodeIds = new Set<string>()
    const updatedNodeIds = new Set<string>()
    const mediaProjections: Array<{
        operation: OperationStatusCanvasNode
        progressState: MediaGenerationProgressState
    }> = []
    let nodes = state.nodes.flatMap(node => {
        if (!isMediaGenerationOperationNodeForRequest(node, generationRequestId)) return [node]
        const patch = patchForNode(node)
        if (!patch) return [node]
        const status = 'remove' in patch ? patch.remove : toRunStatus(patch.status)
        const message = 'remove' in patch
            ? patch.progress?.message ?? node.progress?.message
                ?? (status === 'completed' ? 'Media generation completed.' : 'Media generation cancelled.')
            : patch.message
        const progress = 'remove' in patch
            ? settleMediaGenerationRunProgress(patch.progress ?? node.progress, patch.remove, message)
            : patch.progress ?? node.progress
                ?? createDefaultMediaGenerationRunProgress(status, message)
        mediaProjections.push({
            operation: node,
            progressState: createProgressState({
                generationRequestId,
                status,
                message,
                progress,
                generationRun: node.generationRun,
                mediaRunId: node.mediaRunId,
                updatedAt: 'remove' in patch ? Date.now() : patch.updatedAt,
            }),
        })
        if ('remove' in patch) {
            removedNodeIds.add(node.nodeId)
            return []
        }
        const updatedNode = replaceOperationFields(node, { ...patch, progress })
        if (JSON.stringify(updatedNode) !== JSON.stringify(node)) updatedNodeIds.add(node.nodeId)
        return [updatedNode]
    })

    for (const projection of mediaProjections) {
        const mediaProjection = projectProgressToMediaNodes({
            nodes,
            generationRequestId,
            generationRun: projection.operation.generationRun,
            outputNodeId: projection.operation.outputNodeId,
            mediaRunId: projection.operation.mediaRunId,
            progressState: projection.progressState,
        })
        for (const nodeId of mediaProjection.updatedNodeIds) updatedNodeIds.add(nodeId)
        nodes = mediaProjection.nodes
    }

    if (removedNodeIds.size === 0 && updatedNodeIds.size === 0) {
        return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
    }
    return {
        state: {
            ...state,
            nodes,
            edges: removedNodeIds.size === 0
                ? state.edges
                : state.edges.filter(edge => (
                    !removedNodeIds.has(edge.sourceNodeId)
                    && !removedNodeIds.has(edge.targetNodeId)
                )),
        },
        changed: true,
        updatedNodeIds: [...updatedNodeIds],
        removedNodeIds: [...removedNodeIds],
    }
}

export function applyMediaGenerationRequestToOperationNodes(
    state: CanvasState,
    request: MediaGenerationRequest,
): MediaGenerationOperationRecoveryResult {
    if (request.status === 'completed' || request.status === 'cancelled') {
        const operationNodeIds = new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, request.generationRequestId))
            .map(node => node.nodeId))
        const withoutOperations: CanvasState = {
            ...state,
            nodes: state.nodes.filter(node => !operationNodeIds.has(node.nodeId)),
            edges: state.edges.filter(edge => (
                !operationNodeIds.has(edge.sourceNodeId)
                && !operationNodeIds.has(edge.targetNodeId)
            )),
        }
        const settled = settleMediaNodesForRuns(
            withoutOperations,
            request.generationRequestId,
            request.runs,
            request.status,
        )
        return {
            ...settled,
            changed: settled.changed || operationNodeIds.size > 0,
            removedNodeIds: [...operationNodeIds],
        }
    }

    const firstUnresolvedBinding = request.unresolvedBindings[0]
    const firstRun = request.runs[0]
    const operationResult = applyOperationPatches(state, request.generationRequestId, node => {
        if ((node.requestRevision ?? 0) > request.revision) return null
        const run = request.runs.find(candidate => (
            candidate.operationNodeId === node.nodeId
            || candidate.generationRun === node.generationRun
        ))
        if (!run) return null
        if (run.status === 'completed' || run.status === 'cancelled') {
            return { remove: run.status, progress: run.progress }
        }
        if (firstUnresolvedBinding && run.generationRun === firstRun?.generationRun) {
            const message = 'Choose which attached Asset the prompt refers to.'
            return {
                status: 'action-required',
                message,
                progress: run.progress ?? createDefaultMediaGenerationRunProgress(run.status, message),
                candidateAssetIds: [...new Set(firstUnresolvedBinding.candidates.map(candidate => candidate.assetId))],
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
    let nodes = operationResult.state.nodes
    const updatedNodeIds = new Set(operationResult.updatedNodeIds)
    for (const run of request.runs) {
        const status: MediaGenerationRunStatus = firstUnresolvedBinding
            && run.generationRun === firstRun?.generationRun
            ? 'awaiting-provider-verification'
            : run.status
        const message = firstUnresolvedBinding && run.generationRun === firstRun?.generationRun
            ? 'Choose which attached Asset the prompt refers to.'
            : run.problem?.detail
                ?? run.progress?.message
                ?? (status === 'completed'
                    ? 'Media generation completed.'
                    : status === 'cancelled'
                        ? 'Media generation cancelled.'
                        : status === 'failed'
                            ? 'Media generation failed.'
                            : status === 'running'
                                ? 'The provider is generating media.'
                                : 'Preparing the media request.')
        const progress = status === 'completed' || status === 'failed' || status === 'cancelled'
            ? settleMediaGenerationRunProgress(run.progress, status, message)
            : run.progress
        const mediaProjection = projectProgressToMediaNodes({
            nodes,
            generationRequestId: request.generationRequestId,
            generationRun: run.generationRun,
            outputNodeId: run.outputNodeId,
            mediaRunId: run.mediaRunId,
            progressState: createProgressState({
                generationRequestId: request.generationRequestId,
                status,
                message,
                progress,
                generationRun: run.generationRun,
                mediaRunId: run.mediaRunId,
                updatedAt: request.updatedAt,
            }),
        })
        nodes = mediaProjection.nodes
        for (const nodeId of mediaProjection.updatedNodeIds) updatedNodeIds.add(nodeId)
    }
    let resultState = { ...operationResult.state, nodes }
    let changed = operationResult.changed || updatedNodeIds.size > operationResult.updatedNodeIds.length
    const removedNodeIds = new Set(operationResult.removedNodeIds)
    for (const run of request.runs) {
        if (run.status !== 'failed') continue
        const message = run.problem?.detail ?? run.progress?.message ?? 'Media generation failed.'
        const replacement = replaceFailedPendingOutputWithOperation({
            state: resultState,
            generationRequestId: request.generationRequestId,
            generationRun: run.generationRun,
            mediaRunId: run.mediaRunId,
            outputNodeId: run.outputNodeId,
            operationNodeId: run.operationNodeId,
            message,
            problem: run.problem,
            requestRevision: request.revision,
            progress: run.progress,
            updatedAt: request.updatedAt,
        })
        if (!replacement.changed) continue
        resultState = replacement.state
        changed = true
        for (const nodeId of replacement.removedNodeIds) {
            removedNodeIds.add(nodeId)
            updatedNodeIds.delete(nodeId)
        }
        for (const nodeId of replacement.updatedNodeIds) updatedNodeIds.add(nodeId)
    }
    return changed
        ? {
            state: resultState,
            changed: true,
            updatedNodeIds: [...updatedNodeIds],
            removedNodeIds: [...removedNodeIds],
        }
        : operationResult
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
    const mediaRunId = typeof event.payload.mediaRunId === 'string'
        ? event.payload.mediaRunId
        : undefined
    const outputNodeId = typeof event.payload.outputNodeId === 'string'
        ? event.payload.outputNodeId
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
        const operationNodeIds = new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, event.generationRequestId))
            .map(node => node.nodeId))
        const withoutOperations: CanvasState = {
            ...state,
            nodes: state.nodes.filter(node => !operationNodeIds.has(node.nodeId)),
            edges: state.edges.filter(edge => (
                !operationNodeIds.has(edge.sourceNodeId)
                && !operationNodeIds.has(edge.targetNodeId)
            )),
        }
        const terminalRuns = generationRun === undefined || !mediaRunStatus
            ? []
            : [{
                generationRun,
                ...(mediaRunId ? { mediaRunId } : {}),
                ...(outputNodeId ? { outputNodeId } : {}),
                status: mediaRunStatus,
                ...(progress ? { progress } : {}),
                ...(problem ? { problem } : {}),
            }]
        const settled = settleMediaNodesForRuns(
            withoutOperations,
            event.generationRequestId,
            terminalRuns,
            requestStatus,
        )
        return {
            ...settled,
            changed: settled.changed || operationNodeIds.size > 0,
            removedNodeIds: [...operationNodeIds],
        }
    }

    const requestNodes = state.nodes.filter(node => (
        isMediaGenerationOperationNodeForRequest(node, event.generationRequestId)
    ))
    const targetNode = requestNodes.find(node => (
        Boolean(mediaRunId && node.mediaRunId === mediaRunId)
        || Boolean(outputNodeId && node.outputNodeId === outputNodeId)
        || (generationRun !== undefined && node.generationRun === generationRun)
    )) ?? (generationRun === undefined && !mediaRunId && !outputNodeId ? requestNodes[0] : undefined)
    if (!targetNode) {
        if (!progress && runStatus !== 'running' && runStatus !== 'failed') {
            return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
        }
        const status = runStatus === 'failed' ? 'failed' : 'running'
        const message = problem?.detail
            ?? progressMessage
            ?? progress?.message
            ?? (status === 'failed' ? 'Generation failed.' : 'The provider is generating media.')
        const projection = projectProgressToMediaNodes({
            nodes: state.nodes,
            generationRequestId: event.generationRequestId,
            generationRun,
            outputNodeId,
            mediaRunId,
            progressState: createProgressState({
                generationRequestId: event.generationRequestId,
                status,
                message,
                progress,
                generationRun,
                mediaRunId,
                updatedAt: event.createdAt,
            }),
        })
        const projectedResult: MediaGenerationOperationRecoveryResult = projection.updatedNodeIds.length === 0
            ? { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
            : {
                state: { ...state, nodes: projection.nodes },
                changed: true,
                updatedNodeIds: projection.updatedNodeIds,
                removedNodeIds: [],
            }
        if (status !== 'failed') return projectedResult
        const replacement = replaceFailedPendingOutputWithOperation({
            state: projectedResult.state,
            generationRequestId: event.generationRequestId,
            generationRun,
            mediaRunId,
            outputNodeId,
            message,
            problem,
            requestRevision: event.requestRevision,
            progress,
            updatedAt: event.createdAt,
        })
        return replacement.changed ? replacement : projectedResult
    }

    const candidateAssetIds = readStringArray(event.payload.candidateAssetIds)
    const verificationAssetIds = readStringArray(event.payload.assetIds)
    const verificationAssetId = typeof event.payload.verificationAssetId === 'string'
        ? event.payload.verificationAssetId
        : verificationAssetIds?.[0]
    const unresolvedBindingId = typeof event.payload.bindingId === 'string'
        ? event.payload.bindingId
        : undefined
    const hasCompleteReferenceAction = Boolean(candidateAssetIds) === Boolean(unresolvedBindingId)
    const hasActionPayload = Boolean(candidateAssetIds || verificationAssetId || problem)
    const operationResult = applyOperationPatches(state, event.generationRequestId, node => {
        if (node.nodeId !== targetNode.nodeId || (node.requestRevision ?? 0) > event.requestRevision) return null
        if (runStatus === 'completed' || runStatus === 'cancelled') {
            return { remove: runStatus, ...(progress ? { progress } : {}) }
        }
        if (event.status === 'MEDIA_GENERATION_ACTION_REQUIRED') {
            if (!hasCompleteReferenceAction || !hasActionPayload) return null
            const nextProblem = problem ?? node.problem
            const nextCandidateAssetIds = candidateAssetIds
            const nextUnresolvedBindingId = unresolvedBindingId
            const nextVerificationAssetId = verificationAssetId
            const message = nextProblem?.detail
                ?? (nextCandidateAssetIds
                    ? 'Choose which attached Asset the prompt refers to.'
                    : nextVerificationAssetId
                        ? 'Provider verification is required to continue.'
                        : node.message)
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
            ...(progress ? { progress } : {}),
            requestRevision: event.requestRevision,
            updatedAt: event.createdAt,
        }
    })
    if (event.status !== 'MEDIA_GENERATION_PROBLEM' && runStatus !== 'failed') return operationResult
    const message = problem?.detail ?? progressMessage ?? progress?.message ?? 'Generation failed.'
    const replacement = replaceFailedPendingOutputWithOperation({
        state: operationResult.state,
        generationRequestId: event.generationRequestId,
        generationRun,
        mediaRunId,
        outputNodeId: outputNodeId ?? targetNode.outputNodeId,
        operationNodeId: targetNode.nodeId,
        message,
        problem,
        requestRevision: event.requestRevision,
        progress,
        updatedAt: event.createdAt,
    })
    if (!replacement.changed) return operationResult
    return {
        ...replacement,
        updatedNodeIds: [...new Set([
            ...operationResult.updatedNodeIds.filter(nodeId => !replacement.removedNodeIds.includes(nodeId)),
            ...replacement.updatedNodeIds,
        ])],
        removedNodeIds: [...new Set([
            ...operationResult.removedNodeIds,
            ...replacement.removedNodeIds,
        ])],
    }
}
