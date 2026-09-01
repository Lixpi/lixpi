import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    branchForkfIcon,
    branchMidIcon,
} from '@lixpi/ui-kit/svg'
import { aiLineageEventNodeType } from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEventNode.ts'
import {
    getAiLineageEventLabel,
    getAiLineageEventsForProjection,
    getReasoningSectionLineageEvents,
    normalizeAiLineageProjectionScope,
    createAiLineageEventMarker,
} from '$src/components/proseMirror/plugins/aiChatThreadPlugin/aiLineageEvents.ts'

describe('lineage scope normalization', () => {
    it('falls back to conversation for unknown projection scopes', () => {
        expect(normalizeAiLineageProjectionScope('conversation')).toBe('conversation')
        expect(normalizeAiLineageProjectionScope('branch-origin')).toBe('branch-origin')
        expect(normalizeAiLineageProjectionScope('media-run')).toBe('media-run')
        expect(normalizeAiLineageProjectionScope('not-a-scope')).toBe('conversation')
        expect(normalizeAiLineageProjectionScope(null)).toBe('conversation')
    })
})

describe('getAiLineageEventsForProjection', () => {
    it('emits both branch-origin and branch-fork markers in conversation scope when ids exist', () => {
        const events = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 0,
        }, 'conversation')

        expect(events).toHaveLength(2)
        expect(events[0]).toEqual({ kind: 'branch-origin', branchOriginNodeId: 'origin-id', branchForkNodeId: undefined })
        expect(events[1]).toEqual({ kind: 'branch-fork', branchOriginNodeId: undefined, branchForkNodeId: 'fork-id' })
    })

    it('emits branch-origin only for section-zero lineage in branch-origin scope', () => {
        const forFirstSection = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: null,
        }, 'branch-origin')
        const forLaterSection = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 4,
        }, 'branch-origin')

        expect(forFirstSection).toHaveLength(1)
        expect(forFirstSection[0]).toEqual({ kind: 'branch-origin', branchOriginNodeId: 'origin-id', branchForkNodeId: undefined })
        expect(forLaterSection).toEqual([{ kind: 'branch-origin', branchOriginNodeId: 'origin-id', branchForkNodeId: undefined }])
    })

    it('emits only branch-fork in branch-fork and media-run scopes', () => {
        const branchFork = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 4,
        }, 'branch-fork')
        const mediaRun = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 4,
        }, 'media-run')

        expect(branchFork).toEqual([
            { kind: 'branch-fork', branchOriginNodeId: undefined, branchForkNodeId: 'fork-id' },
        ])
        expect(mediaRun).toEqual([
            { kind: 'branch-fork', branchOriginNodeId: undefined, branchForkNodeId: 'fork-id' },
        ])
    })

    it('returns an empty list when no ids are provided', () => {
        const events = getAiLineageEventsForProjection({
            reasoningIndex: 0,
        })

        expect(events).toEqual([])
    })
})

describe('getReasoningSectionLineageEvents', () => {
    it('delegates to projection event projector', () => {
        const input = {
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 0,
        }
        const events = getReasoningSectionLineageEvents(input, 'media-run')

        expect(events).toEqual([
            { kind: 'branch-fork', branchOriginNodeId: undefined, branchForkNodeId: 'fork-id' },
        ])
    })
})

describe('getAiLineageEventLabel', () => {
    it('maps branch kinds to stable user-facing labels', () => {
        expect(getAiLineageEventLabel('branch-origin')).toBe('Branch started')
        expect(getAiLineageEventLabel('branch-fork')).toBe('Branch fork created')
    })
})

describe('createAiLineageEventMarker', () => {
    const getFirstPath = (icon: string): string | null => {
        const fixture = document.createElement('div')
        fixture.innerHTML = icon
        return fixture.querySelector('path')?.getAttribute('d') ?? null
    }

    it('builds a DOM marker with expected metadata for branch-origin', () => {
        const marker = createAiLineageEventMarker({
            kind: 'branch-origin',
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
        })

        expect(marker.classList.contains('ai-lineage-event')).toBe(true)
        expect(marker.classList.contains('ai-lineage-event-branch-origin')).toBe(true)
        expect(marker.getAttribute('aria-label')).toBe(getAiLineageEventLabel('branch-origin'))
        expect(marker.dataset.helpTooltip).toBe('aria-label')
        expect(marker.getAttribute('title')).toBeNull()
        expect(marker.dataset.lineageEventKind).toBe('branch-origin')
        expect(marker.dataset.branchOriginNodeId).toBe('origin-id')
        expect(marker.dataset.branchForkNodeId).toBe('fork-id')
        expect(marker.querySelector('.ai-lineage-event-icon')?.querySelector('path')?.getAttribute('d')).toBe(getFirstPath(branchMidIcon))
    })

    it('builds fork markers with the fork icon when the event kind is branch-fork', () => {
        const marker = createAiLineageEventMarker({
            kind: 'branch-fork',
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
        })

        expect(marker.classList.contains('ai-lineage-event-branch-fork')).toBe(true)
        expect(marker.dataset.lineageEventKind).toBe('branch-fork')
        expect(marker.querySelector('.ai-lineage-event-icon')?.querySelector('path')?.getAttribute('d')).toBe(getFirstPath(branchForkfIcon))
        expect(marker.textContent).toContain('Branch fork created')
    })

    it('matches legacy node type constants', () => {
        expect(aiLineageEventNodeType).toBe('aiLineageEvent')
    })
})
