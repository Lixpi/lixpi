import { html } from '../../dom/domTemplates.ts'
import { chevronDownIcon, chevronUpIcon } from '../../svg/svgIcons.ts'
import {
    createProgressRippleIcon,
    type ProgressRippleIconInstance,
} from './progressRippleIcon.ts'

export type ProgressTimelineItemStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'attention'
    | 'failed'
    | 'cancelled'
    | 'skipped'

export type ProgressTimelineItemSourceKind =
    | 'reasoning-model'
    | 'capability'
    | 'tool'
    | 'skill'
    | 'media-model'
    | 'pipeline'

export type ProgressTimelineItemSource = {
    kind: ProgressTimelineItemSourceKind
    icon?: string
    name?: string
}

export type ProgressTimelineItem = {
    id: string
    title?: string
    status: ProgressTimelineItemStatus
    source?: ProgressTimelineItemSource
    summary?: string
    showSummaryWhenCollapsed?: boolean
    meta?: string
    children?: ProgressTimelineItem[]
}

export type ProgressTimelineViewMode = 'all' | 'focused'

export type ProgressTimelineViewState = {
    mode: ProgressTimelineViewMode
    hiddenItemCount: number
    totalItemCount: number
}

export type ProgressTimelineConfig = {
    items?: ProgressTimelineItem[]
    ariaLabel?: string
    className?: string
    rippleClockId?: string
    defaultViewMode?: ProgressTimelineViewMode
}

export type ProgressTimelineInstance = {
    readonly element: HTMLElement
    setItems: (items: ProgressTimelineItem[]) => void
    setViewMode: (mode: ProgressTimelineViewMode) => void
    getViewState: () => ProgressTimelineViewState
    destroy: () => void
}

type ProgressTimelineRenderState = {
    items: ProgressTimelineItem[]
    contextItemKeys: Set<string>
    totalItemCount: number
    renderedItemCount: number
}

const FOCUSED_STATUSES = new Set<ProgressTimelineItemStatus>([
    'running',
    'attention',
    'failed',
    'cancelled',
])

function getSourceKindLabel(kind: ProgressTimelineItemSourceKind): string {
    if (kind === 'reasoning-model') return 'Reasoning'
    if (kind === 'media-model') return 'Media model'
    if (kind === 'capability') return 'Capability'
    if (kind === 'tool') return 'Tool'
    if (kind === 'skill') return 'Skill'
    return 'Pipeline'
}

class ProgressTimeline implements ProgressTimelineInstance {
    readonly element: HTMLElement

    private static readonly sharedExpandedItemIdsByClockId = new Map<string, Set<string>>()
    private static readonly sharedCollapsedItemIdsByClockId = new Map<string, Set<string>>()
    private static readonly sharedItemStatusesByClockId = new Map<string, Map<string, ProgressTimelineItemStatus>>()
    private static readonly sharedViewModesByClockId = new Map<string, ProgressTimelineViewMode>()
    private static nextInstanceId = 0
    private readonly instanceId = ProgressTimeline.nextInstanceId++
    private readonly expandedItemIds: Set<string>
    private readonly collapsedItemIds: Set<string>
    private readonly itemStatusById: Map<string, ProgressTimelineItemStatus>
    private readonly rippleIconsByItemKey = new Map<string, ProgressRippleIconInstance>()
    private readonly renderedRippleIconKeys = new Set<string>()
    private focusedContextItemKeys = new Set<string>()
    private items: ProgressTimelineItem[] = []
    private viewMode: ProgressTimelineViewMode

    constructor(private readonly config: ProgressTimelineConfig) {
        this.expandedItemIds = config.rippleClockId
            ? ProgressTimeline.getSharedExpandedItemIds(config.rippleClockId)
            : new Set<string>()
        this.collapsedItemIds = config.rippleClockId
            ? ProgressTimeline.getSharedCollapsedItemIds(config.rippleClockId)
            : new Set<string>()
        this.itemStatusById = config.rippleClockId
            ? ProgressTimeline.getSharedItemStatuses(config.rippleClockId)
            : new Map<string, ProgressTimelineItemStatus>()
        this.viewMode = config.rippleClockId
            ? ProgressTimeline.getSharedViewMode(config.rippleClockId, config.defaultViewMode ?? 'all')
            : config.defaultViewMode ?? 'all'
        this.element = html`
            <ol
                className=${`progress-timeline${config.className ? ` ${config.className}` : ''}`}
                aria-label=${config.ariaLabel ?? 'Progress'}
            ></ol>
        ` as HTMLOListElement
        this.setItems(config.items ?? [])
    }

    setItems(items: ProgressTimelineItem[]): void {
        this.items = items
        const currentIds = new Set<string>()
        const collectItemStatuses = (candidates: ProgressTimelineItem[], parentPath: string[] = []): void => {
            for (const item of candidates) {
                const itemPath = [...parentPath, item.id]
                const itemKey = itemPath.join('/')
                const previousStatus = this.itemStatusById.get(itemKey)
                currentIds.add(itemKey)
                if (previousStatus !== undefined && previousStatus !== item.status) {
                    this.expandedItemIds.delete(itemKey)
                    this.collapsedItemIds.delete(itemKey)
                }
                this.itemStatusById.set(itemKey, item.status)
                if (item.children) collectItemStatuses(item.children, itemPath)
            }
        }
        collectItemStatuses(items)
        for (const itemId of this.itemStatusById.keys()) {
            if (currentIds.has(itemId)) continue
            this.itemStatusById.delete(itemId)
            this.expandedItemIds.delete(itemId)
            this.collapsedItemIds.delete(itemId)
        }
        this.render()
    }

    setViewMode(mode: ProgressTimelineViewMode): void {
        if (this.viewMode === mode) return
        this.viewMode = mode
        if (this.config.rippleClockId) {
            ProgressTimeline.sharedViewModesByClockId.set(this.config.rippleClockId, mode)
        }
        this.render()
    }

    getViewState(): ProgressTimelineViewState {
        const renderState = this.buildRenderState()
        return {
            mode: this.viewMode,
            hiddenItemCount: Math.max(0, renderState.totalItemCount - renderState.renderedItemCount),
            totalItemCount: renderState.totalItemCount,
        }
    }

    destroy(): void {
        this.destroyRippleIcons()
        this.element.remove()
    }

    private renderItem(item: ProgressTimelineItem, parentPath: string[] = []): HTMLLIElement {
        const itemPath = [...parentPath, item.id]
        const itemKey = itemPath.join('/')
        const isFocusedContext = this.viewMode === 'focused' && this.focusedContextItemKeys.has(itemKey)
        const hasDetails = Boolean(item.summary || item.children?.length)
        const needsAttention = item.status === 'attention'
            || item.status === 'failed'
            || item.status === 'cancelled'
        const isExpanded = hasDetails
            && (isFocusedContext
                || item.status === 'running'
                || (!this.collapsedItemIds.has(itemKey)
                    && (needsAttention || this.expandedItemIds.has(itemKey))))
        const detailsId = `progress-timeline-details-${this.instanceId}-${itemKey.replace(/[^A-Za-z0-9_-]/gu, '-')}`
        const children = isExpanded && item.children?.length
            ? html`<ol className="progress-timeline-children">${item.children.map((child) => this.renderItem(child, itemPath))}</ol>`
            : null
        const source = item.source
            ? html`
                <span
                    className=${`progress-timeline-source${item.title ? '' : ' progress-timeline-source-primary'}`}
                    data-source-kind=${item.source.kind}
                >
                    <span className="progress-timeline-source-kind">${getSourceKindLabel(item.source.kind)}</span>
                    ${item.source.icon
                        ? html`
                            <span
                                className="progress-timeline-source-icon"
                                innerHTML=${item.source.icon}
                                aria-hidden="true"
                            ></span>
                        `
                        : null}
                    ${item.source.name
                        ? html`<span className="progress-timeline-source-name">${item.source.name}</span>`
                        : null}
                </span>
            `
            : null
        const heading = item.title
            ? html`
                <span className="progress-timeline-heading">
                    <span className="progress-timeline-title">${item.title}</span>
                    ${item.meta ? html`<small className="progress-timeline-meta">${item.meta}</small>` : null}
                </span>
            `
            : source
        const titleRow = hasDetails && item.status !== 'running' && !isFocusedContext
            ? html`
                <button
                    type="button"
                    className="progress-timeline-toggle"
                    aria-expanded=${String(isExpanded)}
                    aria-controls=${detailsId}
                    onpointerdown=${(event: Event) => event.stopPropagation()}
                    onclick=${(event: Event) => this.toggleItem(event, itemKey, isExpanded)}
                >
                    ${heading}
                    <span
                        className="progress-timeline-chevron"
                        innerHTML=${isExpanded ? chevronUpIcon : chevronDownIcon}
                        aria-hidden="true"
                    ></span>
                </button>
            `
            : html`
                <span className="progress-timeline-title-row">
                    ${heading}
                </span>
            `
        const collapsedSummary = item.summary
            && item.showSummaryWhenCollapsed
            && !isExpanded
            && !isFocusedContext
            ? html`<small className="progress-timeline-summary progress-timeline-summary-collapsed">${item.summary}</small>`
            : null
        const details = isExpanded
            ? html`
                <span id=${detailsId} className="progress-timeline-details">
                    ${item.summary && !isFocusedContext
                        ? html`<small className="progress-timeline-summary">${item.summary}</small>`
                        : null}
                    ${children}
                </span>
            `
            : null

        const marker = item.status === 'running'
            ? this.createRunningMarker(itemKey)
            : html`<span className="progress-timeline-marker-core"></span>`
        const sourceDescription = item.source
            ? `${getSourceKindLabel(item.source.kind)}${item.source.name ? ` ${item.source.name}` : ''}`
            : ''
        const itemDescription = [sourceDescription, item.title].filter(Boolean).join('; ') || 'Progress item'
        return html`
            <li
                className="progress-timeline-item"
                data-status=${item.status}
                data-item-id=${item.id}
                aria-label=${`${itemDescription}: ${item.status}${item.meta ? `; ${item.meta}` : ''}`}
            >
                <span className="progress-timeline-rail" aria-hidden="true">
                    <span className="progress-timeline-marker">
                        ${marker}
                    </span>
                </span>
                <span className="progress-timeline-content">
                    ${item.title ? source : null}
                    ${titleRow}
                    ${collapsedSummary}
                    ${details}
                </span>
            </li>
        ` as HTMLLIElement
    }

    private render(): void {
        this.renderedRippleIconKeys.clear()
        const renderState = this.buildRenderState()
        this.focusedContextItemKeys = renderState.contextItemKeys
        this.element.replaceChildren(...renderState.items.map(item => this.renderItem(item)))
        for (const [itemKey, icon] of this.rippleIconsByItemKey.entries()) {
            if (this.renderedRippleIconKeys.has(itemKey)) continue
            icon.destroy()
            this.rippleIconsByItemKey.delete(itemKey)
        }
    }

    private buildRenderState(): ProgressTimelineRenderState {
        const totalItemCount = this.countItems(this.items)
        if (this.viewMode === 'all') {
            return {
                items: this.items,
                contextItemKeys: new Set<string>(),
                totalItemCount,
                renderedItemCount: totalItemCount,
            }
        }

        const contextItemKeys = new Set<string>()
        const collectFocusedItems = (
            candidates: ProgressTimelineItem[],
            parentPath: string[] = [],
        ): ProgressTimelineItem[] => candidates.flatMap((item) => {
            const itemPath = [...parentPath, item.id]
            const itemKey = itemPath.join('/')
            const children = collectFocusedItems(item.children ?? [], itemPath)
            const isDirectlyVisible = FOCUSED_STATUSES.has(item.status)
            if (!isDirectlyVisible && children.length === 0) return []
            if (!isDirectlyVisible) contextItemKeys.add(itemKey)
            return [{
                ...item,
                ...(children.length > 0 ? { children } : { children: undefined }),
            }]
        })
        const focusedItems = collectFocusedItems(this.items)
        return {
            items: focusedItems,
            contextItemKeys,
            totalItemCount,
            renderedItemCount: this.countItems(focusedItems),
        }
    }

    private countItems(items: readonly ProgressTimelineItem[]): number {
        return items.reduce((total, item) => total + 1 + this.countItems(item.children ?? []), 0)
    }

    private createRunningMarker(itemKey: string): HTMLElement {
        this.renderedRippleIconKeys.add(itemKey)
        const existing = this.rippleIconsByItemKey.get(itemKey)
        if (existing) return existing.element
        const rippleIcon = createProgressRippleIcon()
        this.rippleIconsByItemKey.set(itemKey, rippleIcon)
        return rippleIcon.element
    }

    private destroyRippleIcons(): void {
        this.rippleIconsByItemKey.forEach(icon => icon.destroy())
        this.rippleIconsByItemKey.clear()
        this.renderedRippleIconKeys.clear()
    }

    private toggleItem(event: Event, itemId: string, isExpanded: boolean): void {
        event.preventDefault()
        event.stopPropagation()
        if (isExpanded) {
            this.expandedItemIds.delete(itemId)
            this.collapsedItemIds.add(itemId)
        } else {
            this.collapsedItemIds.delete(itemId)
            this.expandedItemIds.add(itemId)
        }
        this.render()
    }

    private static getSharedExpandedItemIds(clockId: string): Set<string> {
        const existing = ProgressTimeline.sharedExpandedItemIdsByClockId.get(clockId)
        if (existing) return existing
        const expandedItemIds = new Set<string>()
        ProgressTimeline.sharedExpandedItemIdsByClockId.set(clockId, expandedItemIds)
        return expandedItemIds
    }

    private static getSharedCollapsedItemIds(clockId: string): Set<string> {
        const existing = ProgressTimeline.sharedCollapsedItemIdsByClockId.get(clockId)
        if (existing) return existing
        const collapsedItemIds = new Set<string>()
        ProgressTimeline.sharedCollapsedItemIdsByClockId.set(clockId, collapsedItemIds)
        return collapsedItemIds
    }

    private static getSharedItemStatuses(clockId: string): Map<string, ProgressTimelineItemStatus> {
        const existing = ProgressTimeline.sharedItemStatusesByClockId.get(clockId)
        if (existing) return existing
        const itemStatuses = new Map<string, ProgressTimelineItemStatus>()
        ProgressTimeline.sharedItemStatusesByClockId.set(clockId, itemStatuses)
        return itemStatuses
    }

    private static getSharedViewMode(
        clockId: string,
        defaultViewMode: ProgressTimelineViewMode,
    ): ProgressTimelineViewMode {
        const existing = ProgressTimeline.sharedViewModesByClockId.get(clockId)
        if (existing) return existing
        ProgressTimeline.sharedViewModesByClockId.set(clockId, defaultViewMode)
        return defaultViewMode
    }
}

export function createProgressTimeline(config: ProgressTimelineConfig = {}): ProgressTimelineInstance {
    return new ProgressTimeline(config)
}
