import { describe, expect, it, vi } from 'vitest'

import {
    createProgressTimeline,
    type ProgressTimelineConfig,
    type ProgressTimelineItem,
} from './progressTimeline.ts'

type DetailPayload = { label: string }

function makeDetailRenderer() {
    const destroyed: string[] = []
    const rendered: string[] = []
    const renderItemDetail = vi.fn((detail: unknown) => {
        const payload = detail as DetailPayload
        if (!payload.label) return null
        rendered.push(payload.label)
        const element = document.createElement('div')
        element.dataset.detailLabel = payload.label
        return {
            element,
            destroy: () => { destroyed.push(payload.label) },
        }
    })
    return { renderItemDetail, destroyed, rendered }
}

function makeTimeline(
    items: ProgressTimelineItem[],
    config: Partial<ProgressTimelineConfig> = {},
) {
    return createProgressTimeline({ items, expandAllItemsInAllView: true, ...config })
}

function detailLabels(element: HTMLElement): string[] {
    return [...element.querySelectorAll<HTMLElement>('[data-detail-label]')]
        .map(node => node.dataset.detailLabel ?? '')
}

// =============================================================================
// DETAIL RENDERING
// =============================================================================

describe('createProgressTimeline — item details', () => {
    it('renders a host detail block inside the item disclosure region', () => {
        const { renderItemDetail } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'completed', detail: { label: 'trace' } },
        ], { renderItemDetail })

        expect(detailLabels(timeline.element)).toEqual(['trace'])
        expect(timeline.element.querySelector('.progress-timeline-detail')).not.toBeNull()
        timeline.destroy()
    })

    it('makes an item disclosable on the strength of a detail alone', () => {
        const { renderItemDetail } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'completed', detail: { label: 'trace' } },
        ], { renderItemDetail })

        expect(timeline.element.querySelector('.progress-timeline-toggle')).not.toBeNull()
        timeline.destroy()
    })

    it('does not render or disclose anything when the host declines the payload', () => {
        const { renderItemDetail } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'completed', detail: { label: '' } },
        ], {
            renderItemDetail,
            getItemDetailKey: (detail) => (detail as DetailPayload).label,
        })

        expect(detailLabels(timeline.element)).toEqual([])
        expect(timeline.element.querySelector('.progress-timeline-toggle')).toBeNull()
        expect(renderItemDetail).not.toHaveBeenCalled()
        timeline.destroy()
    })

    it('ignores a detail payload when no host renderer is configured', () => {
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'completed', detail: { label: 'trace' } },
        ])

        expect(timeline.element.querySelector('.progress-timeline-toggle')).toBeNull()
        timeline.destroy()
    })

    it('renders details on nested child items', () => {
        const { renderItemDetail } = makeDetailRenderer()
        const timeline = makeTimeline([
            {
                id: 'parent',
                title: 'Parent',
                status: 'completed',
                children: [
                    { id: 'child', title: 'Child', status: 'completed', detail: { label: 'child-trace' } },
                ],
            },
        ], { renderItemDetail })

        expect(detailLabels(timeline.element)).toEqual(['child-trace'])
        timeline.destroy()
    })
})

// =============================================================================
// DETAIL LIFECYCLE ACROSS UPDATES
// =============================================================================

describe('createProgressTimeline — detail lifecycle', () => {
    it('reuses the same detail block across updates that leave the payload unchanged', () => {
        const { renderItemDetail, destroyed } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'running', detail: { label: 'trace' } },
        ], { renderItemDetail })
        const first = timeline.element.querySelector('[data-detail-label]')

        timeline.setItems([
            { id: 'step', title: 'Step', status: 'running', summary: 'now streaming', detail: { label: 'trace' } },
        ])

        expect(renderItemDetail).toHaveBeenCalledTimes(1)
        expect(destroyed).toEqual([])
        expect(timeline.element.querySelector('[data-detail-label]')).toBe(first)
        timeline.destroy()
    })

    it('rebuilds and destroys the previous block when the payload changes', () => {
        const { renderItemDetail, destroyed, rendered } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'running', detail: { label: 'first' } },
        ], { renderItemDetail })

        timeline.setItems([
            { id: 'step', title: 'Step', status: 'running', detail: { label: 'second' } },
        ])

        expect(rendered).toEqual(['first', 'second'])
        expect(destroyed).toEqual(['first'])
        expect(detailLabels(timeline.element)).toEqual(['second'])
        timeline.destroy()
    })

    it('destroys a detail block once when its item leaves the timeline', () => {
        const { renderItemDetail, destroyed } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'running', detail: { label: 'trace' } },
        ], { renderItemDetail })

        timeline.setItems([{ id: 'other', title: 'Other', status: 'running' }])

        expect(destroyed).toEqual(['trace'])
        timeline.destroy()
        expect(destroyed).toEqual(['trace'])
    })

    it('destroys every rendered detail block when the timeline is destroyed', () => {
        const { renderItemDetail, destroyed } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'a', title: 'A', status: 'completed', detail: { label: 'a-trace' } },
            { id: 'b', title: 'B', status: 'completed', detail: { label: 'b-trace' } },
        ], { renderItemDetail })

        timeline.destroy()

        expect(destroyed.sort()).toEqual(['a-trace', 'b-trace'])
    })

    it('uses the host detail key rather than the payload identity to decide reuse', () => {
        const { renderItemDetail } = makeDetailRenderer()
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'running', detail: { label: 'trace' } },
        ], {
            renderItemDetail,
            getItemDetailKey: (detail) => (detail as DetailPayload).label,
        })

        timeline.setItems([
            { id: 'step', title: 'Step', status: 'running', detail: { label: 'trace' } },
        ])

        expect(renderItemDetail).toHaveBeenCalledTimes(1)
        timeline.destroy()
    })

    it('survives a payload that cannot be serialized by falling back to no detail', () => {
        const { renderItemDetail } = makeDetailRenderer()
        const circular: Record<string, unknown> = { label: 'trace' }
        circular.self = circular
        const timeline = makeTimeline([
            { id: 'step', title: 'Step', status: 'completed', detail: circular },
        ], { renderItemDetail })

        expect(timeline.element.querySelector('.progress-timeline-toggle')).toBeNull()
        expect(renderItemDetail).not.toHaveBeenCalled()
        timeline.destroy()
    })
})
