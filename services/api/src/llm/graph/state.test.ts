'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    channels,
    getVideoMaxReferenceImages,
} from './state.ts'

describe('state defaults and helpers', () => {
    it('defaults channel values for newly initialized fields', () => {
        expect(channels.messages.default?.()).toEqual([])
        expect(channels.temperature.default?.()).toBe(0.7)
        expect(channels.streamActive.default?.()).toBe(false)
        expect(channels.preflightResolved.default?.()).toBe(false)
        expect(channels.enableImageGeneration.default?.()).toBe(false)
        expect(channels.enableVideoGeneration.default?.()).toBe(false)
        expect(channels.imagePromptRetryCount.default?.()).toBe(0)
    })

    it('keeps previous values when an update is undefined', () => {
        expect(channels.imagePromptRetryCount.reducer(3, undefined)).toBe(3)
        expect(channels.imageModelMetaInfo.reducer(undefined, undefined)).toBeUndefined()
        expect(channels.imagePromptRetryCount.reducer(undefined, 2)).toBe(2)
    })

    it('defaults image-reference limits to 3 when metadata is missing or invalid', () => {
        expect(getVideoMaxReferenceImages(undefined)).toBe(3)
        expect(getVideoMaxReferenceImages({} as any)).toBe(3)
        expect(getVideoMaxReferenceImages({ videoMaxReferenceImages: 0 } as any)).toBe(3)
        expect(getVideoMaxReferenceImages({ videoMaxReferenceImages: 1 } as any)).toBe(1)
        expect(getVideoMaxReferenceImages({ videoMaxReferenceImages: -2 } as any)).toBe(3)
        expect(getVideoMaxReferenceImages({ videoMaxReferenceImages: Number.NaN } as any)).toBe(3)
    })

    it('keeps previous values when reducer input is undefined', () => {
        expect(channels.streamActive.reducer(false, undefined)).toBe(false)
        expect(channels.enableImageGeneration.reducer(false, undefined)).toBe(false)
        expect(channels.preflightResolved.reducer(true, undefined)).toBe(true)
        expect(channels.imagePromptRetryCount.reducer(2, undefined)).toBe(2)
    })
})
