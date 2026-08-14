import {
    createDefaultMediaGenerationRunProgress,
    mediaGenerationLayoutSettings,
    type GeneratedOutputReviewStatus,
    type MediaGenerationCanvasPhase,
    type MediaGenerationProgressState,
    type MediaGenerationRunStatus,
    type OperationProgressItem,
} from '@lixpi/constants'
import { getGeneratedMediaProgressCollisionRect } from '@lixpi/canvas-engine'
import {
    createProgressTimeline,
    type ProgressTimelineInstance,
    type ProgressTimelineItem,
} from '@lixpi/ui-kit/components/progress-timeline'
import {
    createCollapseExpandIcon,
    type AnimatedSvgIconInstance,
    type CollapseExpandIconState,
} from '@lixpi/ui-kit/svg'

import { html } from '$src/utils/domTemplates.ts'

export type MediaGenerationProgressInstance = {
    element: HTMLElement
    destroy: () => void
}

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
    const outputNodeIds = new Set(outputSources.map(source => source.nodeId))
    const outputMediaRunIds = new Set(outputSources.flatMap(source => source.mediaRunId ? [source.mediaRunId] : []))
    const statuses = outputSources.map(source => source.status as string)

    for (const source of sources) {
        if (source.kind !== 'operation' || !source.status) continue
        if (source.outputNodeId && outputNodeIds.has(source.outputNodeId)) continue
        if (source.mediaRunId && outputMediaRunIds.has(source.mediaRunId)) continue
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
            : isReasoningReceiving || branchPending ? 'running' : 'completed',
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
            : branchPending || branchActive ? 'running' : 'completed',
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

type MediaGenerationProgressOptions = {
    id: string
    state: MediaGenerationProgressState
    className?: string
    defaultExpanded?: boolean
    showSummaryWhenCollapsedItemIds?: readonly string[]
    onLayoutChange?: () => void
}

const toTimelineItem = (
    item: OperationProgressItem,
    operationFailed: boolean,
    showSummaryWhenCollapsedItemIds: ReadonlySet<string>,
): ProgressTimelineItem => ({
    ...item,
    status: operationFailed && item.status === 'running' ? 'failed' : item.status,
    ...(showSummaryWhenCollapsedItemIds.has(item.id) ? { showSummaryWhenCollapsed: true } : {}),
    ...(item.children ? {
        children: item.children.map(child => toTimelineItem(
            child,
            operationFailed,
            showSummaryWhenCollapsedItemIds,
        )),
    } : {}),
})

const collectStatuses = (item: ProgressTimelineItem): ProgressTimelineItem['status'][] => [
    item.status,
    ...(item.children ?? []).flatMap(collectStatuses),
]

const getPipelineStatus = (items: readonly ProgressTimelineItem[]): string => {
    const statuses = items.flatMap(collectStatuses)
    const hasActiveItem = statuses.includes('running')
    const hasIssueItem = statuses.some(status => (
        status === 'attention' || status === 'failed' || status === 'cancelled'
    ))
    if (hasActiveItem) return hasIssueItem ? 'In progress · Issues found' : 'In progress'
    if (hasIssueItem) return 'Needs attention'
    if (statuses.length > 0 && statuses.every(status => status === 'completed' || status === 'skipped')) {
        return 'Completed'
    }
    return 'Waiting'
}

class MediaGenerationProgress implements MediaGenerationProgressInstance {
    readonly element: HTMLElement

    private readonly timeline: ProgressTimelineInstance
    private readonly disclosureIcon: AnimatedSvgIconInstance<CollapseExpandIconState>
    private readonly disclosureButton: HTMLButtonElement
    private readonly disclosureLabel: HTMLSpanElement
    private readonly onLayoutChange?: () => void

    constructor({
        id,
        state,
        className,
        defaultExpanded = false,
        showSummaryWhenCollapsedItemIds = [],
        onLayoutChange,
    }: MediaGenerationProgressOptions) {
        this.onLayoutChange = onLayoutChange
        const fallbackProgress = createDefaultMediaGenerationRunProgress(state.status, state.message)
        const collapsedSummaryItemIds = new Set(showSummaryWhenCollapsedItemIds)
        const items = (state.progress.items ?? fallbackProgress.items ?? []).map(item => (
            toTimelineItem(item, state.status === 'failed', collapsedSummaryItemIds)
        ))
        const timelineId = `workspace-media-generation-pipeline-${id.replace(/[^A-Za-z0-9_-]/gu, '-')}`
        this.timeline = createProgressTimeline({
            ariaLabel: 'Media generation pipeline',
            items,
            // Read-only provenance must reopen fully expanded every time. Live
            // progress keeps its shared disclosure state across streamed rebuilds.
            rippleClockId: defaultExpanded ? undefined : `media-generation:${id}`,
            defaultViewMode: defaultExpanded ? 'all' : 'focused',
            preserveTopLevelItemsInFocusedView: true,
            expandAllItemsInAllView: true,
        })
        this.timeline.element.id = timelineId
        this.disclosureIcon = createCollapseExpandIcon({
            state: this.getDisclosureIconState(),
            className: 'workspace-media-generation-pipeline-disclosure-icon',
        })
        this.element = html`
            <section className=${`workspace-media-generation-progress${className ? ` ${className}` : ''}`} aria-live="polite">
                <header className="workspace-media-generation-pipeline-header">
                    <span className="workspace-media-generation-pipeline-heading">Pipeline</span>
                    <span className="workspace-media-generation-pipeline-status">${getPipelineStatus(items)}</span>
                    <button
                        type="button"
                        className="workspace-media-generation-pipeline-disclosure nopan"
                        aria-controls=${timelineId}
                    ></button>
                </header>
            </section>
        ` as HTMLElement
        this.disclosureButton = this.element.querySelector(
            '.workspace-media-generation-pipeline-disclosure',
        ) as HTMLButtonElement
        this.disclosureLabel = html`
            <span className="workspace-media-generation-pipeline-disclosure-label"></span>
        ` as HTMLSpanElement
        this.disclosureButton.append(this.disclosureLabel, this.disclosureIcon.element)
        this.disclosureButton.addEventListener('pointerdown', this.stopEvent)
        this.disclosureButton.addEventListener('click', this.toggleView)
        this.syncDisclosure(false)
        this.element.appendChild(this.timeline.element)
    }

    destroy(): void {
        this.disclosureButton.removeEventListener('pointerdown', this.stopEvent)
        this.disclosureButton.removeEventListener('click', this.toggleView)
        this.timeline.destroy()
        this.disclosureIcon.destroy()
        this.element.remove()
    }

    private readonly stopEvent = (event: Event): void => {
        event.stopPropagation()
    }

    private readonly toggleView = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        const nextView = this.timeline.getViewState().mode === 'focused' ? 'all' : 'focused'
        this.disclosureIcon.setState(nextView === 'all' ? 'expanded' : 'collapsed', { animate: true })
        this.timeline.setViewMode(nextView)
        this.syncDisclosure(true)
        requestAnimationFrame(() => this.onLayoutChange?.())
    }

    private getDisclosureIconState(): CollapseExpandIconState {
        return this.timeline.getViewState().mode === 'all' ? 'expanded' : 'collapsed'
    }

    private syncDisclosure(animateIcon: boolean): void {
        const viewState = this.timeline.getViewState()
        const showsAllSteps = viewState.mode === 'all'
        const accessibleLabel = showsAllSteps
            ? 'Collapse pipeline details'
            : 'Expand pipeline details'
        this.disclosureButton.ariaExpanded = String(showsAllSteps)
        this.disclosureButton.ariaLabel = accessibleLabel
        this.disclosureButton.title = accessibleLabel
        this.disclosureButton.hidden = viewState.totalItemCount === 0
        this.disclosureButton.classList.toggle('is-expanded', showsAllSteps)
        this.disclosureLabel.textContent = showsAllSteps
            ? 'Collapse'
            : 'Expand'
        this.disclosureIcon.setState(this.getDisclosureIconState(), { animate: animateIcon })
    }
}

export function createMediaGenerationProgress(
    options: MediaGenerationProgressOptions,
): MediaGenerationProgressInstance {
    return new MediaGenerationProgress(options)
}
