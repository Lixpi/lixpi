import { describe, expect, it } from 'vitest'

import {
    getAiLineageEventLabel,
    getAiLineageEventsForProjection,
    getReasoningSectionLineageEvents,
    normalizeAiLineageEventKind,
    normalizeAiLineageProjectionScope,
} from './shared/lineage-events.ts'

describe('lineage kind normalization and labels', () => {
    it('falls back to branch-fork for unknown kinds', () => {
        expect(normalizeAiLineageEventKind('branch-origin')).toBe('branch-origin')
        expect(normalizeAiLineageEventKind('branch-line')).toBe('branch-line')
        expect(normalizeAiLineageEventKind('not-a-kind' as unknown as 'branch-origin')).toBe('branch-fork')
        expect(getAiLineageEventLabel('branch-fork')).toBe('Branch fork created')
        expect(getAiLineageEventLabel('branch-line')).toBe('Branch continued')
        expect(getAiLineageEventLabel('branch-origin')).toBe('Branch started')
    })

    it('normalizes unknown projection scopes to conversation', () => {
        expect(normalizeAiLineageProjectionScope('media-run')).toBe('media-run')
        expect(normalizeAiLineageProjectionScope('branch-fork')).toBe('branch-fork')
        expect(normalizeAiLineageProjectionScope('conversation')).toBe('conversation')
        expect(normalizeAiLineageProjectionScope('bad-scope' as never)).toBe('conversation')
    })
})

describe('getAiLineageEventsForProjection', () => {
    it('emits only branch-fork in conversation scope after first reasoning section', () => {
        const events = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 4,
        }, 'conversation')

        expect(events).toEqual([{ kind: 'branch-fork', branchForkNodeId: 'fork-id' }])
    })

    it('emits branch-origin before branch-fork in conversation scope for the first section', () => {
        const events = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
            reasoningIndex: 0,
        }, 'conversation')

        expect(events).toEqual([
            { kind: 'branch-origin', branchOriginNodeId: 'origin-id' },
            { kind: 'branch-fork', branchForkNodeId: 'fork-id' },
        ])
    })

    it('includes branch-origin in branch-origin scope every time branch-origin scope is requested', () => {
        const firstSection = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            reasoningIndex: 0,
        }, 'branch-origin')
        const laterSection = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            reasoningIndex: 2,
        }, 'branch-origin')

        expect(firstSection).toEqual([{ kind: 'branch-origin', branchOriginNodeId: 'origin-id' }])
        expect(laterSection).toEqual([{ kind: 'branch-origin', branchOriginNodeId: 'origin-id' }])
    })

    it('scopes branch-line independently from fork flags', () => {
        const events = getAiLineageEventsForProjection({
            branchOriginNodeId: 'origin-id',
            branchLineNodeId: 'line-id',
        }, 'media-run')

        expect(events).toEqual([{ kind: 'branch-line', branchLineNodeId: 'line-id' }])
    })

    it('defaults to empty list for null ids', () => {
        expect(getAiLineageEventsForProjection({ reasoningIndex: 0 })).toEqual([])
    })
})

describe('getReasoningSectionLineageEvents', () => {
    it('delegates to projection projector', () => {
        expect(getReasoningSectionLineageEvents({
            branchOriginNodeId: 'origin-id',
            branchForkNodeId: 'fork-id',
        }, 'media-run')).toEqual([
            { kind: 'branch-fork', branchForkNodeId: 'fork-id' },
        ])
    })
})
