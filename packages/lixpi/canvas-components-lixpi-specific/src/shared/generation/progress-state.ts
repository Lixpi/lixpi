import {
    mediaGenerationLayoutSettings,
    settleMediaGenerationRunProgress,
    type GeneratedOutputReviewStatus,
    type MediaGenerationCanvasPhase,
    type MediaGenerationProgressState,
    type MediaGenerationRunStatus,
    type OperationProgressItem,
} from '@lixpi/constants'
import { getGeneratedMediaProgressCollisionRect } from '../branch-tree-layout/media-fitting.ts'

export type MediaGenerationProgressAnchorGeometry = {
    position: { x: number; y: number }
    dimensions: { width: number; height: number }
}

export type MediaGenerationProgressCollisionRect = {
    x: number
    y: number
    width: number
    height: number
}

export type MediaGenerationProgressLayoutChange = {
    allowCollisionShrink: boolean
}

export type BranchMarkerGlobalProgressStatuses = {
    reasoning: OperationProgressItem['status']
    capability: OperationProgressItem['status']
    lineage: OperationProgressItem['status']
}

export type BranchMarkerMediaRequestStatusSource = {
    kind: 'output' | 'operation'
    nodeId: string
    outputNodeId?: string
    mediaRunId?: string
    status?: string
}

export function isMediaGenerationOperationSupersededByOutput(
    operation: Pick<BranchMarkerMediaRequestStatusSource, 'outputNodeId' | 'mediaRunId'>,
    output: Pick<BranchMarkerMediaRequestStatusSource, 'nodeId' | 'mediaRunId'>,
): boolean {
    return Boolean(
        (operation.outputNodeId && operation.outputNodeId === output.nodeId)
            || (operation.mediaRunId && operation.mediaRunId === output.mediaRunId),
    )
}

export function settleReadyMediaGenerationProgress(
    state: MediaGenerationProgressState,
    mediaGenerationPhase: MediaGenerationCanvasPhase | undefined,
): MediaGenerationProgressState {
    const isActive = state.status === 'pending'
        || state.status === 'running'
        || state.status === 'awaiting-provider-verification'
    if (mediaGenerationPhase !== 'ready' || !isActive) return state

    const message = 'Media generation completed.'
    return {
        ...state,
        status: 'completed',
        message,
        progress: settleMediaGenerationRunProgress(state.progress, 'completed', message),
    }
}

export function resolveMediaGenerationHistoryProgress({
    projectedState,
    liveState,
    matchesLiveTarget,
}: {
    projectedState: MediaGenerationProgressState
    liveState: MediaGenerationProgressState | null
    matchesLiveTarget: boolean
}): MediaGenerationProgressState {
    if (!matchesLiveTarget || !liveState) return projectedState
    if (
        liveState.status !== 'pending'
        && liveState.status !== 'running'
        && liveState.status !== 'awaiting-provider-verification'
    ) return projectedState
    return liveState
}

export function isPersistedMediaGenerationActive({
    progressStatus,
    reviewStatus,
    mediaGenerationPhase,
}: {
    progressStatus: MediaGenerationRunStatus | undefined
    reviewStatus: GeneratedOutputReviewStatus | undefined
    mediaGenerationPhase: MediaGenerationCanvasPhase | undefined
}): boolean {
    if (reviewStatus === 'accepted' || reviewStatus === 'superseded') return false
    if (mediaGenerationPhase === 'ready') return false
    if (progressStatus) {
        return progressStatus === 'pending'
            || progressStatus === 'running'
            || progressStatus === 'awaiting-provider-verification'
    }
    return mediaGenerationPhase === 'pending-before-first-frame'
}

export function shouldRenderLiveMediaGenerationProgress({
    progressStatus,
    reviewStatus,
    hasActiveLineage,
    pendingBeforeFirstFrame,
}: {
    progressStatus: MediaGenerationRunStatus | undefined
    reviewStatus: GeneratedOutputReviewStatus | undefined
    hasActiveLineage: boolean
    pendingBeforeFirstFrame: boolean
}): boolean {
    // Accepted output progress is immutable provenance, not live canvas state.
    // Active topology covers candidates; pre-frame state covers runs that have
    // started before their lineage marker is available.
    if (!progressStatus || reviewStatus === 'accepted' || reviewStatus === 'superseded') return false
    if (hasActiveLineage) return true
    return pendingBeforeFirstFrame && (
        progressStatus === 'pending'
        || progressStatus === 'running'
        || progressStatus === 'awaiting-provider-verification'
    )
}

// Every run has a hidden operation record and a visible output node. Once the
// output owns durable progress, it is authoritative for that run; retaining the
// operation's older in-progress status would make completed branches pulse.
export function resolveBranchMarkerMediaRequestStatuses(
    sources: readonly BranchMarkerMediaRequestStatusSource[],
): string[] {
    const outputSources = sources.filter(source => source.kind === 'output' && Boolean(source.status))
    const statuses = outputSources.map(source => source.status as string)

    for (const source of sources) {
        if (source.kind !== 'operation' || !source.status) continue
        if (outputSources.some(output => isMediaGenerationOperationSupersededByOutput(source, output))) continue
        statuses.push(source.status)
    }
    return statuses
}

export function isBranchMarkerMediaRequestTerminal(statuses: readonly string[]): boolean {
    return statuses.length > 0 && statuses.every(status => (
        status === 'completed' || status === 'failed' || status === 'cancelled'
    ))
}

export function settleBranchMarkerProgressStatusForTerminalMedia(
    status: OperationProgressItem['status'],
    mediaRequestStatuses: readonly string[],
): OperationProgressItem['status'] {
    if (!isBranchMarkerMediaRequestTerminal(mediaRequestStatuses)) return status
    return status === 'pending' || status === 'running' ? 'completed' : status
}

export function resolveBranchMarkerGlobalProgressStatuses({
    hasReasoningResponse,
    isReasoningReceiving,
    branchPending,
    branchActive,
    requestNodeCount,
    mediaRequestStatuses,
    capabilityRunStatuses,
}: {
    hasReasoningResponse: boolean
    isReasoningReceiving: boolean
    branchPending: boolean
    branchActive: boolean
    requestNodeCount: number
    mediaRequestStatuses: readonly string[]
    capabilityRunStatuses: readonly string[]
}): BranchMarkerGlobalProgressStatuses {
    const hasFailedCapability = capabilityRunStatuses.includes('failed')
    const hasCancelledCapability = capabilityRunStatuses.includes('cancelled')
    const hasTerminalMediaRequest = isBranchMarkerMediaRequestTerminal(mediaRequestStatuses)
    const hasActiveCapability = !hasTerminalMediaRequest
        && capabilityRunStatuses.some(status => status === 'pending' || status === 'running')
    const hasFailedMediaRequest = mediaRequestStatuses.includes('failed')
    const hasCancelledMediaRequest = mediaRequestStatuses.includes('cancelled')
    const hasAttentionMediaRequest = mediaRequestStatuses.some(status => (
        status === 'action-required' || status === 'awaiting-provider-verification'
    ))
    const hasActiveMediaRequest = mediaRequestStatuses.some(status => (
        status === 'pending' || status === 'running' || status === 'in-progress'
    ))
    const hasDurableMediaRequestStatus = mediaRequestStatuses.length > 0
    const requestHasStarted = requestNodeCount > 0

    return {
        // A durable media request can only exist after the reasoning model has
        // understood the request and invoked media generation. Prefer that
        // monotonic fact over transient editor receiving flags, which may toggle
        // while tool output and the final assistant frame are interleaved.
        reasoning: hasReasoningResponse || requestHasStarted
            ? 'completed'
            : isReasoningReceiving || branchPending
            ? 'running'
            : 'completed',
        capability: hasFailedCapability || hasFailedMediaRequest
            ? 'failed'
            : hasCancelledCapability || hasCancelledMediaRequest
            ? 'cancelled'
            : hasAttentionMediaRequest
            ? 'attention'
            : (hasActiveCapability
                    || hasActiveMediaRequest
                    || (!hasDurableMediaRequestStatus && (branchPending || branchActive)))
            ? 'running'
            : 'completed',
        lineage: requestHasStarted
            ? 'completed'
            : branchPending || branchActive
            ? 'running'
            : 'completed',
    }
}

export function getMediaGenerationProgressPosition(
    anchor: MediaGenerationProgressAnchorGeometry,
    progressHeight: number,
    gap = mediaGenerationLayoutSettings.generatedMediaProgress.gap,
): { x: number; y: number } {
    return {
        x: anchor.position.x + anchor.dimensions.width + gap,
        y: progressHeight <= anchor.dimensions.height
            ? anchor.position.y + (anchor.dimensions.height - progressHeight) / 2
            : anchor.position.y,
    }
}

export function getMediaGenerationProgressCollisionRect(
    mediaCollisionRect: MediaGenerationProgressCollisionRect,
    anchor: MediaGenerationProgressAnchorGeometry,
    progressHeight: number,
): MediaGenerationProgressCollisionRect {
    return getGeneratedMediaProgressCollisionRect(mediaCollisionRect, anchor, progressHeight)
}
