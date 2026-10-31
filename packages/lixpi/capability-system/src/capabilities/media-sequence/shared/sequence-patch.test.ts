import { describe, expect, it } from 'vitest'

import { sequenceFixture } from './sequence-fixture.ts'
import { SequencePatchEditor } from './sequence-patch.ts'
import { convertTicks, frameTimeBase } from './sequence-time.ts'
import { assertMediaSequence } from './sequence-validation.ts'
import { evaluateMediaSequence } from './sequence-evaluator.ts'
import { MEDIA_SEQUENCE_MAX_SOURCES } from './media-sequence.ts'

// =============================================================================
// INTEGER TIME AND NONDESTRUCTIVE EDITS
// =============================================================================

describe('Media sequence timing and edits', () => {
    it('rejects source collections above the atomic revision limit without truncation', () => {
        const sequence = sequenceFixture()
        const source = sequence.sources[0]
        sequence.sources = Array.from({ length: MEDIA_SEQUENCE_MAX_SOURCES }, (_, index) => ({
            ...source,
            sourceId: index ? `source-${index}` : source.sourceId,
        }))
        expect(() => assertMediaSequence(sequence)).not.toThrow()
        sequence.sources.push({
            ...source,
            sourceId: 'overflow',
        })
        expect(() => assertMediaSequence(sequence)).toThrow('MEDIA_SEQUENCE_SOURCE_LIMIT')
        expect(sequence.sources).toHaveLength(MEDIA_SEQUENCE_MAX_SOURCES + 1)
    })
    it('converts 29.97 frames and 48 kHz samples without accumulated rounding', () => {
        const timeBase = {
            numerator: 1,
            denominator: 240000,
        }
        expect(convertTicks(30000, frameTimeBase({
            numerator: 30000,
            denominator: 1001,
        }), timeBase)).toBe(240240000)
        expect(convertTicks(48000, {
            numerator: 1,
            denominator: 48000,
        }, timeBase)).toBe(240000)
        expect(convertTicks(1, {
            numerator: 1,
            denominator: 3,
        }, {
            numerator: 1,
            denominator: 10,
        }, 'floor')).toBe(3)
        expect(convertTicks(1, {
            numerator: 1,
            denominator: 3,
        }, {
            numerator: 1,
            denominator: 10,
        }, 'ceil')).toBe(4)
    })

    it('splits source ranges, preserves boundary automation, and restores exactly', () => {
        const original = sequenceFixture()
        original.clips[0].keyframes = [
            {
                keyframeId: 'a',
                property: 'opacity',
                time: 0,
                value: 0,
                interpolation: 'linear',
            },
            {
                keyframeId: 'b',
                property: 'opacity',
                time: 2400000,
                value: 1,
                interpolation: 'linear',
            },
        ]
        const applied = new SequencePatchEditor(original).apply([{
            op: 'split-clip',
            clipId: 'clip',
            time: 1200000,
            newClipId: 'right',
        }])
        expect(applied.sequence.clips.map(clip => [clip.sourceIn, clip.sourceOut, clip.start, clip.duration])).toEqual([[0, 240000, 0, 1200000], [240000, 480000, 1200000, 1200000]])
        expect(evaluateMediaSequence(applied.sequence, 1200000).clips[0].transform.opacity).toBe(0.5)
        expect(new SequencePatchEditor(applied.sequence).restore(applied.inverse).sequence).toEqual(original)
        expect(original.clips).toHaveLength(1)
    })

    it('trims and changes playback rate using source ticks', () => {
        const result = new SequencePatchEditor(sequenceFixture()).apply([
            {
                op: 'trim-clip',
                clipId: 'clip',
                sourceIn: 48000,
                sourceOut: 240000,
                start: 240000,
                duration: 960000,
            },
            {
                op: 'set-rate',
                clipId: 'clip',
                rate: {
                    numerator: 2,
                    denominator: 1,
                },
            },
        ])
        expect(result.sequence.clips[0]).toMatchObject({
            sourceIn: 48000,
            sourceOut: 240000,
            duration: 480000,
        })
        expect(evaluateMediaSequence(result.sequence, 480000).clips[0].sourceTime).toBe(144000)
    })

    it('ripple deletion splits a spanning clip and shifts the remaining source', () => {
        const original = sequenceFixture()
        const applied = new SequencePatchEditor(original).apply([{
            op: 'ripple-edit',
            trackId: 'video',
            start: 480000,
            deleteDuration: 480000,
            insertDuration: 0,
            splitClipIds: { clip: 'right' },
        }])
        expect(applied.sequence.clips.map(clip => [clip.clipId, clip.start, clip.sourceIn, clip.sourceOut])).toEqual([['clip', 0, 0, 96000], ['right', 480000, 192000, 480000]])
        expect(applied.sequence.duration).toBe(1920000)
        expect(new SequencePatchEditor(applied.sequence).restore(applied.inverse).sequence).toEqual(original)
    })

    it('reverses removal of a track together with its dependent clips', () => {
        const original = sequenceFixture()
        const applied = new SequencePatchEditor(original).apply([{
            op: 'remove-track',
            trackId: 'video',
        }])
        expect(new SequencePatchEditor(applied.sequence).restore(applied.inverse).sequence).toEqual(original)
        const inserted = new SequencePatchEditor(applied.sequence).restore(applied.inverse)
        expect(new SequencePatchEditor(inserted.sequence).restore(inserted.inverse).sequence).toEqual(applied.sequence)
    })

    it('rejects source overflow, incompatible tracks, unknown versions and locked edits', () => {
        const original = sequenceFixture()
        expect(() => new SequencePatchEditor(original).apply([{
            op: 'trim-clip',
            clipId: 'clip',
            sourceIn: 0,
            sourceOut: 480001,
            start: 0,
            duration: 2400005,
        }])).toThrow()
        const locked = new SequencePatchEditor(original).apply([{
            op: 'set-track',
            trackId: 'video',
            values: { locked: true },
        }]).sequence
        expect(() => new SequencePatchEditor(locked).apply([{
            op: 'set-transform',
            clipId: 'clip',
            values: { x: 1 },
        }])).toThrow('TRACK_LOCKED')
        expect(() => new SequencePatchEditor(locked).apply([{
            op: 'set-track',
            trackId: 'video',
            values: {
                locked: false,
                muted: true,
            },
        }])).toThrow('TRACK_LOCKED')
        expect(() => assertMediaSequence({
            ...original,
            schemaVersion: 'media-sequence-v2',
        })).toThrow('READ_ONLY_VERSION')
    })

    it('evaluates complementary audio fades and incoming visual opacity', () => {
        const original = sequenceFixture()
        original.clips[0].duration = 1440000
        original.clips[0].sourceOut = 288000
        original.clips.push({
            ...structuredClone(original.clips[0]),
            clipId: 'incoming',
            start: 960000,
        })
        original.transitions = [{
            transitionId: 'dissolve',
            kind: 'cross-dissolve',
            clipId: 'clip',
            otherClipId: 'incoming',
            duration: 480000,
        }]
        assertMediaSequence(original)
        const state = evaluateMediaSequence(original, 1200000)
        expect(state.clips.map(clip => clip.transform.opacity)).toEqual([1, 0.5])
        expect(state.clips.map(clip => clip.audio.gain)).toEqual([0.5, 0.5])
    })
})
