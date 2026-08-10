import { describe, expect, it, vi } from 'vitest'

import type { MediaGenerationProgressState } from '@lixpi/constants'

import {
    createMediaGenerationProgress,
    getMediaGenerationProgressPosition,
} from './mediaGenerationProgress.ts'

const state = (): MediaGenerationProgressState => ({
    generationRequestId: 'request-1',
    status: 'running',
    message: 'Working.',
    updatedAt: 1,
    progress: {
        phase: 'rendering',
        completedSteps: 1,
        totalSteps: 3,
        message: 'Working.',
        items: [
            {
                id: 'completed-root',
                title: 'Completed root',
                status: 'completed',
                children: [{ id: 'completed-child', title: 'Completed child', status: 'completed' }],
            },
            {
                id: 'problem-root',
                title: 'Problem root',
                status: 'failed',
                children: [{
                    id: 'problem-child',
                    title: 'Problem child',
                    status: 'failed',
                    children: [{ id: 'problem-leaf', title: 'Problem leaf', status: 'failed' }],
                }],
            },
            {
                id: 'pending-root',
                title: 'Pending root',
                status: 'pending',
                children: [{ id: 'pending-child', title: 'Pending child', status: 'pending' }],
            },
        ],
    },
})

const renderedItemIds = (element: HTMLElement): string[] => [
    ...element.querySelectorAll<HTMLElement>('[data-item-id]'),
].map(item => item.dataset.itemId!)

describe('media generation progress disclosure', () => {
    it('shows one reasoning-summary line while collapsed and the full response when expanded', () => {
        const fullReasoningResponse = 'I will preserve every detail from this complete reasoning response.'
        const progress = createMediaGenerationProgress({
            id: 'reasoning-run',
            showSummaryWhenCollapsedItemIds: ['understand-request'],
            state: {
                generationRequestId: 'reasoning-request',
                status: 'completed',
                message: 'Completed.',
                updatedAt: 1,
                progress: {
                    phase: 'composing',
                    completedSteps: 1,
                    totalSteps: 1,
                    message: 'Completed.',
                    items: [{
                        id: 'understand-request',
                        title: 'Understand request',
                        status: 'completed',
                        summary: fullReasoningResponse,
                    }],
                },
            },
        })
        const reasoningItem = progress.element.querySelector<HTMLElement>(
            '[data-item-id="understand-request"]',
        )!

        const collapsedSummary = reasoningItem.querySelector<HTMLElement>('.progress-timeline-summary-collapsed')
        expect(collapsedSummary?.textContent).toBe(fullReasoningResponse)

        reasoningItem.querySelector<HTMLButtonElement>('.progress-timeline-toggle')!.click()

        const expandedReasoningItem = progress.element.querySelector<HTMLElement>(
            '[data-item-id="understand-request"]',
        )!
        expect(expandedReasoningItem.querySelector('.progress-timeline-summary-collapsed')).toBeNull()
        expect(expandedReasoningItem.querySelector<HTMLElement>('.progress-timeline-summary')?.textContent)
            .toBe(fullReasoningResponse)
        progress.destroy()
    })

    it('keeps top-level steps visible, focuses problem details, and expands every nested level on demand', () => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0)
            return 1
        })
        const progress = createMediaGenerationProgress({ id: 'run-1', state: state() })
        const disclosure = progress.element.querySelector<HTMLButtonElement>(
            '.workspace-media-generation-pipeline-disclosure',
        )!

        expect(disclosure.textContent).toContain('Expand')
        expect(disclosure.textContent).not.toContain('all')
        expect(renderedItemIds(progress.element)).toEqual([
            'completed-root',
            'problem-root',
            'problem-child',
            'problem-leaf',
            'pending-root',
        ])

        disclosure.click()

        expect(disclosure.textContent).toContain('Collapse')
        expect(disclosure.textContent).not.toContain('all')
        expect(renderedItemIds(progress.element)).toEqual([
            'completed-root',
            'completed-child',
            'problem-root',
            'problem-child',
            'problem-leaf',
            'pending-root',
            'pending-child',
        ])

        disclosure.click()

        expect(disclosure.textContent).toContain('Expand')
        expect(renderedItemIds(progress.element)).not.toContain('completed-child')
        expect(renderedItemIds(progress.element)).not.toContain('pending-child')
        progress.destroy()
        vi.unstubAllGlobals()
    })

    it('centers short progress beside the media outline and top-aligns taller progress', () => {
        const anchor = {
            position: { x: 100, y: 200 },
            dimensions: { width: 800, height: 600 },
        }

        expect(getMediaGenerationProgressPosition(anchor, 200)).toEqual({ x: 936, y: 400 })
        expect(getMediaGenerationProgressPosition(anchor, 700)).toEqual({ x: 936, y: 200 })
    })

    it('adds a caller-owned surface class without replacing the shared progress component', () => {
        const progress = createMediaGenerationProgress({
            id: 'branch-1',
            state: state(),
            className: 'workspace-branch-marker-progress',
        })

        expect(progress.element.classList).toContain('workspace-media-generation-progress')
        expect(progress.element.classList).toContain('workspace-branch-marker-progress')
        progress.destroy()
    })
})
