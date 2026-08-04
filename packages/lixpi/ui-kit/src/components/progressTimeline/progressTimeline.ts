import { html } from '../../dom/domTemplates.ts'

export type ProgressTimelineItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export type ProgressTimelineItem = {
    id: string
    title: string
    status: ProgressTimelineItemStatus
    summary?: string
    children?: ProgressTimelineItem[]
}

export type ProgressTimelineConfig = {
    items?: ProgressTimelineItem[]
    ariaLabel?: string
    className?: string
}

export type ProgressTimelineInstance = {
    readonly element: HTMLElement
    setItems: (items: ProgressTimelineItem[]) => void
    destroy: () => void
}

class ProgressTimeline implements ProgressTimelineInstance {
    readonly element: HTMLElement

    private static readonly rippleCycleMs = 1400

    constructor(private readonly config: ProgressTimelineConfig) {
        this.element = html`
            <ol
                className=${`progress-timeline${config.className ? ` ${config.className}` : ''}`}
                aria-label=${config.ariaLabel ?? 'Progress'}
            ></ol>
        ` as HTMLOListElement
        this.element.style.setProperty(
            '--progress-timeline-ripple-delay',
            `${-(performance.now() % ProgressTimeline.rippleCycleMs)}ms`,
        )
        this.setItems(config.items ?? [])
    }

    setItems(items: ProgressTimelineItem[]): void {
        this.element.replaceChildren(...items.map((item) => this.renderItem(item)))
    }

    destroy(): void {
        this.element.remove()
    }

    private renderItem(item: ProgressTimelineItem): HTMLLIElement {
        const children = item.children?.length
            ? html`<ol className="progress-timeline-children">${item.children.map((child) => this.renderItem(child))}</ol>`
            : null

        return html`
            <li
                className="progress-timeline-item"
                data-status=${item.status}
                data-item-id=${item.id}
                aria-label=${`${item.title}: ${item.status}`}
            >
                <span className="progress-timeline-rail" aria-hidden="true">
                    <span className="progress-timeline-marker"></span>
                </span>
                <span className="progress-timeline-content">
                    <span className="progress-timeline-title-row">
                        <span className="progress-timeline-title">${item.title}</span>
                    </span>
                    ${item.summary ? html`<small className="progress-timeline-summary">${item.summary}</small>` : null}
                    ${children}
                </span>
            </li>
        ` as HTMLLIElement
    }
}

export function createProgressTimeline(config: ProgressTimelineConfig = {}): ProgressTimelineInstance {
    return new ProgressTimeline(config)
}
