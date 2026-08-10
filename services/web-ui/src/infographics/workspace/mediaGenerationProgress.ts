import {
    createDefaultMediaGenerationRunProgress,
    type MediaGenerationProgressState,
    type OperationProgressItem,
} from '@lixpi/constants'
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

export function getMediaGenerationProgressPosition(
    anchor: MediaGenerationProgressAnchorGeometry,
    progressHeight: number,
    gap = 36,
): { x: number; y: number } {
    return {
        x: anchor.position.x + anchor.dimensions.width + gap,
        y: progressHeight <= anchor.dimensions.height
            ? anchor.position.y + (anchor.dimensions.height - progressHeight) / 2
            : anchor.position.y,
    }
}

type MediaGenerationProgressOptions = {
    id: string
    state: MediaGenerationProgressState
    className?: string
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
            rippleClockId: `media-generation:${id}`,
            defaultViewMode: 'focused',
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
