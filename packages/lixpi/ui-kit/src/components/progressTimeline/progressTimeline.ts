import { html } from '../../dom/domTemplates.ts'
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

export type ProgressTimelineItem = {
    id: string
    title: string
    status: ProgressTimelineItemStatus
    summary?: string
    meta?: string
    children?: ProgressTimelineItem[]
}

export type ProgressTimelineConfig = {
    items?: ProgressTimelineItem[]
    ariaLabel?: string
    className?: string
    rippleClockId?: string
}

export type ProgressTimelineInstance = {
    readonly element: HTMLElement
    setItems: (items: ProgressTimelineItem[]) => void
    destroy: () => void
}

class ProgressTimeline implements ProgressTimelineInstance {
    readonly element: HTMLElement

    private static readonly sharedExpandedItemIdsByClockId = new Map<string, Set<string>>()
    private static readonly sharedCollapsedItemIdsByClockId = new Map<string, Set<string>>()
    private static readonly sharedItemStatusesByClockId = new Map<string, Map<string, ProgressTimelineItemStatus>>()
    private static nextInstanceId = 0
    private readonly instanceId = ProgressTimeline.nextInstanceId++
    private readonly expandedItemIds: Set<string>
    private readonly collapsedItemIds: Set<string>
    private readonly itemStatusById: Map<string, ProgressTimelineItemStatus>
    private readonly rippleIconsByItemKey = new Map<string, ProgressRippleIconInstance>()
    private readonly renderedRippleIconKeys = new Set<string>()
    private items: ProgressTimelineItem[] = []

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

    destroy(): void {
        this.destroyRippleIcons()
        this.element.remove()
    }

    private renderItem(item: ProgressTimelineItem, parentPath: string[] = []): HTMLLIElement {
        const itemPath = [...parentPath, item.id]
        const itemKey = itemPath.join('/')
        const hasDetails = Boolean(item.summary || item.children?.length)
        const needsAttention = item.status === 'attention'
            || item.status === 'failed'
            || item.status === 'cancelled'
        const isExpanded = hasDetails
            && (item.status === 'running'
                || (!this.collapsedItemIds.has(itemKey)
                    && (needsAttention || this.expandedItemIds.has(itemKey))))
        const detailsId = `progress-timeline-details-${this.instanceId}-${itemKey.replace(/[^A-Za-z0-9_-]/gu, '-')}`
        const children = isExpanded && item.children?.length
            ? html`<ol className="progress-timeline-children">${item.children.map((child) => this.renderItem(child, itemPath))}</ol>`
            : null
        const heading = html`
            <span className="progress-timeline-heading">
                <span className="progress-timeline-title">${item.title}</span>
                ${item.meta ? html`<small className="progress-timeline-meta">${item.meta}</small>` : null}
            </span>
        `
        const titleRow = hasDetails && item.status !== 'running'
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
                    <span className="progress-timeline-chevron" aria-hidden="true"></span>
                </button>
            `
            : html`
                <span className="progress-timeline-title-row">
                    ${heading}
                </span>
            `
        const details = isExpanded
            ? html`
                <span id=${detailsId} className="progress-timeline-details">
                    ${item.summary ? html`<small className="progress-timeline-summary">${item.summary}</small>` : null}
                    ${children}
                </span>
            `
            : null

        const marker = item.status === 'running'
            ? this.createRunningMarker(itemKey)
            : html`<span className="progress-timeline-marker-core"></span>`
        return html`
            <li
                className="progress-timeline-item"
                data-status=${item.status}
                data-item-id=${item.id}
                aria-label=${`${item.title}: ${item.status}${item.meta ? `; ${item.meta}` : ''}`}
            >
                <span className="progress-timeline-rail" aria-hidden="true">
                    <span className="progress-timeline-marker">
                        ${marker}
                    </span>
                </span>
                <span className="progress-timeline-content">
                    ${titleRow}
                    ${details}
                </span>
            </li>
        ` as HTMLLIElement
    }

    private render(): void {
        this.renderedRippleIconKeys.clear()
        this.element.replaceChildren(...this.items.map(item => this.renderItem(item)))
        for (const [itemKey, icon] of this.rippleIconsByItemKey.entries()) {
            if (this.renderedRippleIconKeys.has(itemKey)) continue
            icon.destroy()
            this.rippleIconsByItemKey.delete(itemKey)
        }
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
}

export function createProgressTimeline(config: ProgressTimelineConfig = {}): ProgressTimelineInstance {
    return new ProgressTimeline(config)
}
