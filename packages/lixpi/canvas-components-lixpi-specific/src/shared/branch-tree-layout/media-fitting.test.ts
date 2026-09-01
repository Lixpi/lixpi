'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'
import { mediaGenerationLayoutSettings } from '@lixpi/constants'

import {
    getGeneratedMediaProgressCollisionRect,
    getGeneratedOutputChromeCollisionHeight,
    getGeneratedOutputChromeCollisionInsets,
} from './media-fitting.ts'

describe('generated output chrome collision insets', () => {
    it('reserves the maximum zoom-compensated title and action footprint', () => {
        const chrome = mediaGenerationLayoutSettings.generatedMediaChrome
        const imageInsets = getGeneratedOutputChromeCollisionInsets('image')
        const artifactInsets = getGeneratedOutputChromeCollisionInsets('capabilityArtifact')

        expect(imageInsets.top).toBeGreaterThan(chrome.titleCollisionHeight)
        expect(imageInsets.bottom).toBeGreaterThan(chrome.topGap + chrome.iconSize)
        expect(artifactInsets).toEqual(imageInsets)
        expect(getGeneratedOutputChromeCollisionHeight('image')).toBe(imageInsets.bottom)
    })

    it('adds external video controls to the bottom inset without changing the title inset', () => {
        const imageInsets = getGeneratedOutputChromeCollisionInsets('image')
        const videoInsets = getGeneratedOutputChromeCollisionInsets('video')

        expect(videoInsets.top).toBe(imageInsets.top)
        expect(videoInsets.bottom).toBeGreaterThan(imageInsets.bottom)
    })
})

describe('generated media progress collision envelope', () => {
    it('reserves the fixed right-side timeline width and measured vertical disclosure height', () => {
        expect(getGeneratedMediaProgressCollisionRect(
            { x: 100, y: 150, width: 800, height: 700 },
            { position: { x: 100, y: 200 }, dimensions: { width: 800, height: 600 } },
            900,
        )).toEqual({
            x: 100,
            y: 150,
            width: 1_196,
            height: 950,
        })
    })
})
