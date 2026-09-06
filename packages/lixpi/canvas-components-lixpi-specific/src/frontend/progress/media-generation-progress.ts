import {
    createDefaultMediaGenerationRunProgress,
    type MediaGenerationProgressState,
    type OperationProgressItem,
} from '@lixpi/constants'
import {
    createProgressTimeline,
    type ProgressTimelineDetailRender,
    type ProgressTimelineInstance,
    type ProgressTimelineItem,
} from '@lixpi/ui-kit/components/progress-timeline'
import {
    createCollapseExpandIcon,
    type CollapseExpandIconState,
} from '@lixpi/ui-kit/svg'
import {
    type AnimatedSvgIconInstance,
} from '@lixpi/ui-primitives/svg'
import { html } from '@lixpi/ui-primitives/dom'
import { Lifetime } from '@lixpi/canvas-engine/frontend/runtime'
import {
    type MediaGenerationProgressLayoutChange,
} from '../../shared/generation/progress-state.ts'

export type MediaGenerationProgressInstance = {
    element: HTMLElement
    update: (state: MediaGenerationProgressState) => void
    destroy: () => void
}

export type MediaGenerationProgressOptions = {
    id: string
    state: MediaGenerationProgressState
    className?: string
    defaultExpanded?: boolean
    showSummaryWhenCollapsedItemIds?: readonly string[]
    onLayoutChange?: (change: MediaGenerationProgressLayoutChange) => void
    // Expands the durable per-step ExecutionTrace into the timeline's detail
    // block. Hosts own this because trace handles need Asset and Capability
    // lookups to render their hover cards.
    renderItemDetail?: (detail: unknown) => ProgressTimelineDetailRender | null
    getItemDetailKey?: (detail: unknown) => string
}

const toTimelineItem = (
    item: OperationProgressItem,
    operationFailed: boolean,
    showSummaryWhenCollapsedItemIds: ReadonlySet<string>,
): ProgressTimelineItem => {
    const traceDuplicatesSummary = Boolean(
        item.summary?.trim()
            && item.trace?.reasoning?.trim() === item.summary.trim(),
    )

    return {
        ...item,
        status: operationFailed
            && item.status === 'running'
            ? 'failed'
            : item.status,
        ...(showSummaryWhenCollapsedItemIds.has(item.id)
            || traceDuplicatesSummary
            ? { showSummaryWhenCollapsed: true }
            : {}),
        ...(traceDuplicatesSummary ? { hideSummaryWhenExpanded: true } : {}),
        ...(item.trace ? { detail: item.trace } : {}),
        ...(item.children
            ? {
                children: item.children.map(
                    child =>
                        toTimelineItem(
                            child,
                            operationFailed,
                            showSummaryWhenCollapsedItemIds,
                        ),
                ),
            }
            : {}),
    }
}

const collectStatuses = (item: ProgressTimelineItem): ProgressTimelineItem['status'][] => [
    item.status,
    ...(item.children ?? []).flatMap(collectStatuses),
]

const getPipelineStatus = (items: readonly ProgressTimelineItem[]): string => {
    const statuses = items.flatMap(collectStatuses)
    const hasActiveItem = statuses.includes('running')
    const hasIssueItem = statuses.some(
        status => (
            status === 'attention' || status === 'failed' || status === 'cancelled'
        ),
    )

    if (hasActiveItem)
        return hasIssueItem ? 'In progress · Issues found' : 'In progress'

    if (hasIssueItem)
        return 'Needs attention'

    if (
        statuses.length > 0
        && statuses.every(status => status === 'completed' || status === 'skipped')
    )
        return 'Completed'

    return 'Waiting'
}

class MediaGenerationProgress implements MediaGenerationProgressInstance {
    readonly element: HTMLElement
    private readonly lifetime = new Lifetime()
    private layoutFrame: number | null = null

    private readonly timeline: ProgressTimelineInstance
    private readonly disclosureIcon: AnimatedSvgIconInstance<CollapseExpandIconState>
    private readonly disclosureButton: HTMLButtonElement
    private readonly disclosureLabel: HTMLSpanElement
    private readonly pipelineStatus: HTMLSpanElement
    private readonly onLayoutChange?: (change: MediaGenerationProgressLayoutChange) => void
    private readonly resizeObserver: ResizeObserver | null
    private readonly showSummaryWhenCollapsedItemIds: ReadonlySet<string>

    constructor({
        id,
        state,
        className,
        defaultExpanded = false,
        showSummaryWhenCollapsedItemIds = [],
        onLayoutChange,
        renderItemDetail,
        getItemDetailKey,
    }: MediaGenerationProgressOptions) {
        try {
            this.onLayoutChange = onLayoutChange
            this.showSummaryWhenCollapsedItemIds = new Set(showSummaryWhenCollapsedItemIds)
            const items = this.getTimelineItems(state)
            const timelineId = `workspace-media-generation-pipeline-${id.replace(/[^A-Za-z0-9_-]/gu, '-')}-${crypto.randomUUID()}`
            this.timeline = createProgressTimeline({
                ariaLabel: 'Media generation pipeline',
                items,
                // Read-only provenance must reopen fully expanded every time. Live
                // progress keeps its shared disclosure state across streamed rebuilds.
                rippleClockId: defaultExpanded ? undefined : `media-generation:${id}`,
                defaultViewMode: defaultExpanded ? 'all' : 'focused',
                preserveTopLevelItemsInFocusedView: true,
                expandAllItemsInAllView: true,
                ...(renderItemDetail ? { renderItemDetail: (detail: unknown) => renderItemDetail(detail) } : {}),
                ...(getItemDetailKey ? { getItemDetailKey: (detail: unknown) => getItemDetailKey(detail) } : {}),
            })
            this.lifetime.own(() => this.timeline.destroy())
            this.timeline.element.id = timelineId
            this.disclosureIcon = createCollapseExpandIcon({
                state: this.getDisclosureIconState(),
                className: 'workspace-media-generation-pipeline-disclosure-icon',
            })
            this.lifetime.own(() => this.disclosureIcon.destroy())
            this.element = html`
                <section
                    className=${`workspace-media-generation-progress${className ? ` ${className}` : ''}`}
                    aria-live="polite"
                >
                    <header className="workspace-media-generation-pipeline-header">
                        <span className="workspace-media-generation-pipeline-heading">Pipeline</span>
                        <span className="workspace-media-generation-pipeline-status">${getPipelineStatus(items)}</span>
                        <button
                            type="button"
                            className="workspace-media-generation-pipeline-disclosure nopan"
                            aria-controls=${timelineId}
                            data-help-tooltip="aria-label"
                        ></button>
                    </header>
                </section>
            ` as HTMLElement
            this.lifetime.own(() => this.element.remove())
            this.disclosureButton = this.element.querySelector('.workspace-media-generation-pipeline-disclosure') as HTMLButtonElement
            this.pipelineStatus = this.element.querySelector('.workspace-media-generation-pipeline-status') as HTMLSpanElement
            this.disclosureLabel = html`<span className="workspace-media-generation-pipeline-disclosure-label"></span>` as HTMLSpanElement
            this.disclosureButton.append(this.disclosureLabel, this.disclosureIcon.element)
            this.lifetime.own(() => {
                this.disclosureButton.removeEventListener('pointerdown', this.stopEvent)
                this.disclosureButton.removeEventListener('click', this.toggleView)
            })
            this.disclosureButton.addEventListener('pointerdown', this.stopEvent)
            this.disclosureButton.addEventListener('click', this.toggleView)
            this.syncDisclosure(false)
            this.element.appendChild(this.timeline.element)
            this.resizeObserver = onLayoutChange
                && typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(() => {
                    if (!this.lifetime.signal.aborted)
                        onLayoutChange({ allowCollisionShrink: false })
                })
                : null
            this.lifetime.own(() => this.resizeObserver?.disconnect())
            this.lifetime.own(() => {
                if (this.layoutFrame !== null)
                    cancelAnimationFrame(this.layoutFrame)

                this.layoutFrame = null
            })
            this.resizeObserver?.observe(this.element)
        } catch (error) {
            this.lifetime.destroy()

            throw error
        }
    }

    update(state: MediaGenerationProgressState): void {
        if (this.lifetime.signal.aborted)
            return

        const items = this.getTimelineItems(state)
        this.timeline.setItems(items)
        this.pipelineStatus.textContent = getPipelineStatus(items)
        this.syncDisclosure(false)
    }

    destroy(): void {
        this.lifetime.destroy()
    }

    private readonly stopEvent = (event: Event): void => void event.stopPropagation()

    private readonly toggleView = (event: Event): void => {
        event.preventDefault()
        event.stopPropagation()
        const nextView = this.timeline.getViewState().mode === 'focused' ? 'all' : 'focused'
        this.disclosureIcon.setState(nextView === 'all' ? 'expanded' : 'collapsed', { animate: true })
        this.timeline.setViewMode(nextView)
        this.syncDisclosure(true)

        if (this.layoutFrame !== null)
            cancelAnimationFrame(this.layoutFrame)

        this.layoutFrame = requestAnimationFrame(() => {
            this.layoutFrame = null

            if (!this.lifetime.signal.aborted)
                this.onLayoutChange?.({ allowCollisionShrink: true })
        })
    }

    private getDisclosureIconState(): CollapseExpandIconState {
        return this.timeline.getViewState().mode === 'all' ? 'expanded' : 'collapsed'
    }

    private getTimelineItems(state: MediaGenerationProgressState): ProgressTimelineItem[] {
        const fallbackProgress = createDefaultMediaGenerationRunProgress(state.status, state.message)

        return (state.progress.items ?? fallbackProgress.items ?? []).map(
            item => (
                toTimelineItem(
                    item,
                    state.status === 'failed',
                    this.showSummaryWhenCollapsedItemIds,
                )
            ),
        )
    }

    private syncDisclosure(animateIcon: boolean): void {
        const viewState = this.timeline.getViewState()
        const showsAllSteps = viewState.mode === 'all'
        const accessibleLabel = showsAllSteps
            ? 'Collapse pipeline details'
            : 'Expand pipeline details'
        this.disclosureButton.ariaExpanded = String(showsAllSteps)
        this.disclosureButton.ariaLabel = accessibleLabel
        this.disclosureButton.hidden = viewState.totalItemCount === 0
        this.disclosureButton.classList.toggle('is-expanded', showsAllSteps)
        this.disclosureLabel.textContent = showsAllSteps
            ? 'Collapse'
            : 'Expand'
        this.disclosureIcon.setState(
            this.getDisclosureIconState(),
            { animate: animateIcon },
        )
    }
}

export const createMediaGenerationProgress = (options: MediaGenerationProgressOptions): MediaGenerationProgressInstance =>
    new MediaGenerationProgress(options)
