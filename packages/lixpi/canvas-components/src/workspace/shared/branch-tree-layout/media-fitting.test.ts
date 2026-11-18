import {
    describe,
    expect,
    it,
} from 'vitest'
import { mediaGenerationLayoutSettings } from '@lixpi/constants'

import {
    getGeneratedMediaProgressCollisionRect,
    getGeneratedOutputControlsCollisionHeight,
    getGeneratedOutputControlsCollisionInsets,
} from './media-fitting.ts'

describe('generated output controls collision insets', () => {
    it('reserves the maximum zoom-compensated title and action footprint', () => {
        const controls = mediaGenerationLayoutSettings.generatedMediaControls
        const imageInsets = getGeneratedOutputControlsCollisionInsets('image')
        const artifactInsets = getGeneratedOutputControlsCollisionInsets('capabilityArtifact')

        expect(imageInsets.top).toBeGreaterThan(controls.titleCollisionHeight)
        expect(imageInsets.bottom).toBeGreaterThan(controls.topGap + controls.iconSize)
        expect(artifactInsets).toEqual(imageInsets)
        expect(getGeneratedOutputControlsCollisionInsets('audio')).toEqual(imageInsets)
        expect(getGeneratedOutputControlsCollisionHeight('image')).toBe(imageInsets.bottom)
    })

    it('adds external video controls to the bottom inset without changing the title inset', () => {
        const imageInsets = getGeneratedOutputControlsCollisionInsets('image')
        const videoInsets = getGeneratedOutputControlsCollisionInsets('video')

        expect(videoInsets.top).toBe(imageInsets.top)
        expect(videoInsets.bottom).toBeGreaterThan(imageInsets.bottom)
    })
})

describe('generated media progress collision envelope', () => {
    it('reserves the fixed right-side timeline width and measured vertical disclosure height', () => {
        expect(getGeneratedMediaProgressCollisionRect(
            {
                x: 100,
                y: 150,
                width: 800,
                height: 700,
            },
            {
                position: {
                    x: 100,
                    y: 200,
                },
                dimensions: {
                    width: 800,
                    height: 600,
                },
            },
            900,
        )).toEqual({
            x: 100,
            y: 150,
            width: 1_196,
            height: 950,
        })
    })
})
