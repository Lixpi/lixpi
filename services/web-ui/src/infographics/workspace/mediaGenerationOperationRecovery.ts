import type {
    CanvasState,
    MediaGenerationProblem,
    MediaGenerationRequest,
    MediaGenerationRequestEvent,
    OperationStatusCanvasNode,
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
    updatedAt: number
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

function removeOperationNodes(
    state: CanvasState,
    removedNodeIds: Set<string>,
): MediaGenerationOperationRecoveryResult {
    if (removedNodeIds.size === 0) {
        return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
    }

    return {
        state: {
            ...state,
            nodes: state.nodes.filter(node => !removedNodeIds.has(node.nodeId)),
            edges: state.edges.filter(edge => (
                !removedNodeIds.has(edge.sourceNodeId)
                && !removedNodeIds.has(edge.targetNodeId)
            )),
        },
        changed: true,
        updatedNodeIds: [],
        removedNodeIds: [...removedNodeIds],
    }
}

function applyOperationPatches(
    state: CanvasState,
    generationRequestId: string,
    patchForNode: (node: OperationStatusCanvasNode) => OperationPatch | 'remove' | null,
): MediaGenerationOperationRecoveryResult {
    const removedNodeIds = new Set<string>()
    const updatedNodeIds: string[] = []
    const nodes = state.nodes.flatMap(node => {
        if (!isMediaGenerationOperationNodeForRequest(node, generationRequestId)) return [node]
        const patch = patchForNode(node)
        if (patch === 'remove') {
            removedNodeIds.add(node.nodeId)
            return []
        }
        if (!patch) return [node]
        const updatedNode = replaceOperationFields(node, patch)
        if (JSON.stringify(updatedNode) === JSON.stringify(node)) return [node]
        updatedNodeIds.push(node.nodeId)
        return [updatedNode]
    })

    if (removedNodeIds.size === 0 && updatedNodeIds.length === 0) {
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
        updatedNodeIds,
        removedNodeIds: [...removedNodeIds],
    }
}

export function applyMediaGenerationRequestToOperationNodes(
    state: CanvasState,
    request: MediaGenerationRequest,
): MediaGenerationOperationRecoveryResult {
    if (request.status === 'completed' || request.status === 'cancelled') {
        return removeOperationNodes(state, new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, request.generationRequestId))
            .map(node => node.nodeId)))
    }

    const firstUnresolvedBinding = request.unresolvedBindings[0]
    const firstRun = request.runs[0]
    return applyOperationPatches(state, request.generationRequestId, node => {
        const run = request.runs.find(candidate => (
            candidate.operationNodeId === node.nodeId
            || candidate.generationRun === node.generationRun
        ))
        if (!run) return null
        if (run.status === 'completed' || run.status === 'cancelled') return 'remove'

        if (firstUnresolvedBinding && run.generationRun === firstRun?.generationRun) {
            return {
                status: 'action-required',
                message: 'Choose which attached Asset the prompt refers to.',
                candidateAssetIds: [...new Set(request.unresolvedBindings.flatMap(binding => (
                    binding.candidates.map(candidate => candidate.assetId)
                )))],
                unresolvedBindingId: firstUnresolvedBinding.bindingId,
                requestRevision: request.revision,
                updatedAt: request.updatedAt,
            }
        }

        if (run.status === 'awaiting-provider-verification') {
            return {
                status: 'action-required',
                message: run.problem?.detail ?? 'Provider verification is required to continue.',
                ...(run.problem ? { problem: run.problem } : {}),
                ...(run.requiredVerificationAssetIds?.[0] ? {
                    verificationAssetId: run.requiredVerificationAssetIds[0],
                } : {}),
                requestRevision: request.revision,
                updatedAt: request.updatedAt,
            }
        }

        if (run.status === 'failed') {
            return {
                status: 'failed',
                message: run.problem?.detail ?? 'Generation failed.',
                ...(run.problem ? { problem: run.problem } : {}),
                requestRevision: request.revision,
                updatedAt: request.updatedAt,
            }
        }

        return {
            status: 'in-progress',
            message: run.status === 'running'
                ? run.progress?.message ?? 'The provider is generating media.'
                : 'Preparing the media request.',
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

export function applyMediaGenerationRequestEventToOperationNodes(
    state: CanvasState,
    event: MediaGenerationRequestEvent,
): MediaGenerationOperationRecoveryResult {
    const requestStatus = typeof event.payload.status === 'string' ? event.payload.status : undefined
    if (requestStatus === 'completed' || requestStatus === 'cancelled') {
        return removeOperationNodes(state, new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, event.generationRequestId))
            .map(node => node.nodeId)))
    }

    const generationRun = typeof event.payload.generationRun === 'number'
        ? event.payload.generationRun
        : undefined
    const runStatus = typeof event.payload.runStatus === 'string'
        ? event.payload.runStatus
        : undefined
    if (generationRun !== undefined && (runStatus === 'completed' || runStatus === 'cancelled')) {
        return removeOperationNodes(state, new Set(state.nodes
            .filter(node => isMediaGenerationOperationNodeForRequest(node, event.generationRequestId)
                && node.generationRun === generationRun)
            .map(node => node.nodeId)))
    }

    const requestNodes = state.nodes.filter(node => (
        isMediaGenerationOperationNodeForRequest(node, event.generationRequestId)
    ))
    const targetNode = generationRun === undefined
        ? requestNodes[0]
        : requestNodes.find(node => node.generationRun === generationRun)
    if (!targetNode) {
        return { state, changed: false, updatedNodeIds: [], removedNodeIds: [] }
    }

    const problem = readProblem(event.payload.problem)
    const candidateAssetIds = readStringArray(event.payload.candidateAssetIds)
    const verificationAssetIds = readStringArray(event.payload.assetIds)
    const verificationAssetId = typeof event.payload.verificationAssetId === 'string'
        ? event.payload.verificationAssetId
        : verificationAssetIds?.[0]
    const unresolvedBindingId = typeof event.payload.bindingId === 'string'
        ? event.payload.bindingId
        : undefined
    const progressMessage = typeof event.payload.message === 'string'
        ? event.payload.message
        : undefined

    return applyOperationPatches(state, event.generationRequestId, node => {
        if (node.nodeId !== targetNode.nodeId) return null
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
            return {
                status: 'failed',
                message: problem?.detail ?? 'Generation failed.',
                ...(problem ? { problem } : {}),
                requestRevision: event.requestRevision,
                updatedAt: event.createdAt,
            }
        }
        return {
            status: 'in-progress',
            message: progressMessage ?? (runStatus === 'running'
                ? 'The provider is generating media.'
                : 'Resuming the media request.'),
            requestRevision: event.requestRevision,
            updatedAt: event.createdAt,
        }
    })
}
