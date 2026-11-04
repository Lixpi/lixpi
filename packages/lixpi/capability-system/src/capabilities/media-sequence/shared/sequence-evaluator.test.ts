import { describe, expect, it } from 'vitest'
import { evaluateMediaSequence, evaluateSequenceProperty } from './sequence-evaluator.ts'
import { sequenceFixture } from './sequence-fixture.ts'
import { type SequenceKeyframe } from './media-sequence.ts'

describe('sequence preview automation', () => {
    it('preserves clip array order for equal-start overlays on the same track', () => {
        const sequence = sequenceFixture()
        const clip = sequence.clips[0]
        sequence.clips = [
            {
                ...structuredClone(clip),
                clipId: 'z',
            },
            {
                ...structuredClone(clip),
                clipId: 'a',
            },
        ]
        expect(evaluateMediaSequence(sequence, 0).clips.map(item => item.clip.clipId)).toEqual(['z', 'a'])
    })

    it('interpolates initial transform and audio values before their first explicit keyframe', () => {
        const sequence = sequenceFixture()
        const clip = sequence.clips[0]
        clip.transform.x = 10
        clip.transform.opacity = 0
        clip.audio.gain = 0
        clip.keyframes = [
            {
                keyframeId: 'x',
                property: 'x',
                time: 120000,
                value: 110,
                interpolation: 'linear',
            },
            {
                keyframeId: 'opacity',
                property: 'opacity',
                time: 120000,
                value: 1,
                interpolation: 'linear',
            },
            {
                keyframeId: 'gain',
                property: 'gain',
                time: 120000,
                value: 1,
                interpolation: 'linear',
            },
        ]
        const before = structuredClone(sequence)

        for (const [time, weight] of [[0, 0], [60000, 0.5], [120000, 1]]) {
            const evaluated = evaluateMediaSequence(sequence, time).clips[0]
            expect(evaluated.transform.x).toBe(10 + weight * 100)
            expect(evaluated.transform.opacity).toBe(weight)
            expect(evaluated.audio.gain).toBe(weight)
        }

        expect(sequence).toEqual(before)
    })

    it('keeps explicit time-zero keys and hold interpolation after the first key', () => {
        const keys: SequenceKeyframe[] = [
            {
                keyframeId: 'first',
                property: 'gain',
                time: 0,
                value: 0.2,
                interpolation: 'hold',
            },
            {
                keyframeId: 'next',
                property: 'gain',
                time: 100,
                value: 0.8,
                interpolation: 'linear',
            },
        ]
        expect(evaluateSequenceProperty(keys, 'gain', 0, 1)).toBe(0.2)
        expect(evaluateSequenceProperty(keys, 'gain', 50, 1)).toBe(0.2)
        expect(evaluateSequenceProperty(keys, 'gain', 100, 1)).toBe(0.8)
        expect(evaluateSequenceProperty(keys, 'gain', 200, 1)).toBe(0.8)
        keys[0].time = 20
        expect(evaluateSequenceProperty(keys, 'gain', 10, 0)).toBe(0.1)
        expect(evaluateSequenceProperty(keys, 'gain', 50, 0)).toBe(0.2)
    })
})
