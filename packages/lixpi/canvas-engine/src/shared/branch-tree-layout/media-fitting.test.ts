'use strict'

import { describe, expect, it } from 'vitest'
import { mediaGenerationLayoutSettings } from '@lixpi/constants'

import {
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
