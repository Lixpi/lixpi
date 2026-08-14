import { describe, expect, it, vi } from 'vitest'

import type { MediaGenerationProgressState } from '@lixpi/constants'

import {
    createMediaGenerationProgress,
    getMediaGenerationProgressCollisionRect,
    getMediaGenerationProgressPosition,
    isPersistedMediaGenerationActive,
    resolveBranchMarkerMediaRequestStatuses,
    resolveBranchMarkerGlobalProgressStatuses,
    settleBranchMarkerProgressStatusForTerminalMedia,
    shouldRenderLiveMediaGenerationProgress,
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
    it('recovers active generation state from persisted output data after reload', () => {
        for (const progressStatus of ['pending', 'running', 'awaiting-provider-verification'] as const) {
            expect(isPersistedMediaGenerationActive({
                progressStatus,
                reviewStatus: 'candidate',
                mediaGenerationPhase: 'ready',
            })).toBe(true)
        }

        for (const progressStatus of ['completed', 'failed', 'cancelled'] as const) {
            expect(isPersistedMediaGenerationActive({
                progressStatus,
                reviewStatus: 'candidate',
                mediaGenerationPhase: 'pending-before-first-frame',
            })).toBe(false)
        }

        expect(isPersistedMediaGenerationActive({
            progressStatus: undefined,
            reviewStatus: 'candidate',
            mediaGenerationPhase: 'pending-before-first-frame',
        })).toBe(true)
        expect(isPersistedMediaGenerationActive({
            progressStatus: 'running',
            reviewStatus: 'accepted',
            mediaGenerationPhase: 'pending-before-first-frame',
        })).toBe(false)
    })

    it('never mounts accepted terminal history as live canvas progress during Asset hydration', () => {
        expect(shouldRenderLiveMediaGenerationProgress({
            progressStatus: 'completed',
            reviewStatus: undefined,
            hasActiveLineage: false,
            pendingBeforeFirstFrame: false,
        })).toBe(false)
        expect(shouldRenderLiveMediaGenerationProgress({
            progressStatus: 'completed',
            reviewStatus: 'accepted',
            hasActiveLineage: true,
            pendingBeforeFirstFrame: false,
        })).toBe(false)
    })

    it('keeps live progress for active candidates and pre-lineage reservations', () => {
        expect(shouldRenderLiveMediaGenerationProgress({
            progressStatus: 'completed',
            reviewStatus: 'candidate',
            hasActiveLineage: true,
            pendingBeforeFirstFrame: false,
        })).toBe(true)
        expect(shouldRenderLiveMediaGenerationProgress({
            progressStatus: 'running',
            reviewStatus: undefined,
            hasActiveLineage: false,
            pendingBeforeFirstFrame: true,
        })).toBe(true)
    })

    it('does not mark branch preparation complete or reactivate reasoning while media work is active', () => {
        expect(resolveBranchMarkerGlobalProgressStatuses({
            hasReasoningResponse: true,
            isReasoningReceiving: false,
            branchPending: false,
            branchActive: false,
            requestNodeCount: 2,
            mediaRequestStatuses: ['running'],
            capabilityRunStatuses: [],
        })).toEqual({
            reasoning: 'completed',
            capability: 'running',
            lineage: 'completed',
        })

        expect(resolveBranchMarkerGlobalProgressStatuses({
            hasReasoningResponse: false,
            isReasoningReceiving: true,
            branchPending: false,
            branchActive: true,
            requestNodeCount: 2,
            mediaRequestStatuses: ['running'],
            capabilityRunStatuses: ['running'],
        })).toEqual({
            reasoning: 'completed',
            capability: 'running',
            lineage: 'completed',
        })
    })

    it('surfaces a terminal media failure in the branch pipeline instead of leaving it completed', () => {
        expect(resolveBranchMarkerGlobalProgressStatuses({
            hasReasoningResponse: true,
            isReasoningReceiving: false,
            branchPending: false,
            branchActive: false,
            requestNodeCount: 1,
            mediaRequestStatuses: ['failed'],
            capabilityRunStatuses: ['completed'],
        }).capability).toBe('failed')
    })

    it('settles terminal media despite stale in-memory branch activity', () => {
        expect(resolveBranchMarkerGlobalProgressStatuses({
            hasReasoningResponse: true,
            isReasoningReceiving: false,
            branchPending: true,
            branchActive: true,
            requestNodeCount: 2,
            mediaRequestStatuses: ['completed', 'completed'],
            capabilityRunStatuses: ['completed'],
        })).toEqual({
            reasoning: 'completed',
            capability: 'completed',
            lineage: 'completed',
        })
    })

    it('settles stale Capability progress after every visible media run is terminal', () => {
        expect(resolveBranchMarkerGlobalProgressStatuses({
            hasReasoningResponse: true,
            isReasoningReceiving: false,
            branchPending: false,
            branchActive: false,
            requestNodeCount: 1,
            mediaRequestStatuses: ['completed'],
            capabilityRunStatuses: ['running'],
        })).toEqual({
            reasoning: 'completed',
            capability: 'completed',
            lineage: 'completed',
        })
        expect(settleBranchMarkerProgressStatusForTerminalMedia(
            'running',
            ['completed'],
        )).toBe('completed')
        expect(settleBranchMarkerProgressStatusForTerminalMedia(
            'failed',
            ['completed'],
        )).toBe('failed')
    })

    it('ignores a stale hidden operation status once its output is terminal', () => {
        expect(resolveBranchMarkerMediaRequestStatuses([
            {
                kind: 'output',
                nodeId: 'output-1',
                mediaRunId: 'run-1',
                status: 'completed',
            },
            {
                kind: 'operation',
                nodeId: 'operation-1',
                outputNodeId: 'output-1',
                mediaRunId: 'run-1',
                status: 'in-progress',
            },
        ])).toEqual(['completed'])
    })

    it('renders the reasoning-authored media prompt at the styled timeline selector path', () => {
        const mediaPrompt = 'Render the generated character sheet from the resolved reference.'
        const progress = createMediaGenerationProgress({
            id: 'media-prompt-run',
            defaultExpanded: true,
            state: {
                generationRequestId: 'media-prompt-request',
                status: 'completed',
                message: 'Completed.',
                updatedAt: 1,
                progress: {
                    phase: 'composing',
                    completedSteps: 1,
                    totalSteps: 1,
                    message: 'Completed.',
                    items: [{
                        id: 'lineage:media-generation-prompt',
                        title: 'Prompt for media generation model written by reasoning model',
                        status: 'completed',
                        summary: mediaPrompt,
                    }],
                },
            },
        })
        const promptSurface = progress.element.querySelector<HTMLElement>([
            ".progress-timeline-item[data-item-id='lineage:media-generation-prompt']",
            '> .progress-timeline-content',
            '> .progress-timeline-details',
            '> .progress-timeline-summary',
        ].join(' '))

        expect(promptSurface?.textContent).toBe(mediaPrompt)
        progress.destroy()
    })

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

    it('reopens provenance with every nested level expanded instead of reusing focused live state', () => {
        const liveProgress = createMediaGenerationProgress({
            id: 'shared-run-1',
            state: state(),
        })
        expect(renderedItemIds(liveProgress.element)).not.toContain('completed-child')
        liveProgress.destroy()

        const progress = createMediaGenerationProgress({
            id: 'shared-run-1',
            state: state(),
            defaultExpanded: true,
        })
        const disclosure = progress.element.querySelector<HTMLButtonElement>(
            '.workspace-media-generation-pipeline-disclosure',
        )!

        expect(disclosure.ariaExpanded).toBe('true')
        expect(disclosure.textContent).toContain('Collapse')
        expect(renderedItemIds(progress.element)).toEqual([
            'completed-root',
            'completed-child',
            'problem-root',
            'problem-child',
            'problem-leaf',
            'pending-root',
            'pending-child',
        ])
        progress.destroy()
    })

    it('centers short progress beside the media outline and top-aligns taller progress', () => {
        const anchor = {
            position: { x: 100, y: 200 },
            dimensions: { width: 800, height: 600 },
        }

        expect(getMediaGenerationProgressPosition(anchor, 200)).toEqual({ x: 936, y: 400 })
        expect(getMediaGenerationProgressPosition(anchor, 700)).toEqual({ x: 936, y: 200 })
    })

    it('reserves the full right-side progress timeline collision envelope', () => {
        const mediaRect = { x: 100, y: 200, width: 800, height: 600 }
        const anchor = {
            position: { x: 100, y: 200 },
            dimensions: { width: 800, height: 600 },
        }

        expect(getMediaGenerationProgressCollisionRect(mediaRect, anchor, 900)).toEqual({
            x: 100,
            y: 200,
            width: 1_196,
            height: 900,
        })
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
