'use strict'

import { describe, expect, it } from 'vitest'

import { mediaGenerationLayoutSettings } from '@lixpi/constants'

import {
    estimateBranchMarkerDimensions,
    getBranchMarkerMinWidth,
    getBranchMarkerPromptPreview,
    getBranchMarkerResponsePreview,
    getBranchMarkerScreenFixedMinWidth,
} from './marker-dimensions.ts'

const marker = mediaGenerationLayoutSettings.marker
const messageLineHeight = Math.ceil(marker.text.messageFontSize * marker.text.messageLineHeight)
const responseLineHeight = Math.ceil(marker.text.responseFontSize * marker.text.responseLineHeight)

describe('estimateBranchMarkerDimensions', () => {
    it('sizes a short prompt to the comfortable minimum, single line', () => {
        const dimensions = estimateBranchMarkerDimensions('hi')
        expect(dimensions.width).toBe(getBranchMarkerMinWidth())
        expect(dimensions.height).toBe(marker.verticalPadding + messageLineHeight)
    })

    it('adds exactly one separator + response line when the response row is shown', () => {
        const withoutResponse = estimateBranchMarkerDimensions('hi')
        const withResponse = estimateBranchMarkerDimensions('hi', { responseLine: true })
        expect(withResponse.width).toBe(withoutResponse.width)
        expect(withResponse.height - withoutResponse.height).toBe(marker.separatorHeight + responseLineHeight)
    })

    it('wraps a long prompt to a second line at the width ceiling', () => {
        const longPrompt = 'a'.repeat(marker.promptPreviewMaxChars)
        const dimensions = estimateBranchMarkerDimensions(longPrompt)
        expect(dimensions.width).toBe(Math.round(getBranchMarkerMinWidth() * marker.maxWidthGrowth))
        expect(dimensions.height).toBe(marker.verticalPadding + 2 * messageLineHeight)
    })

    it('uses the shorter, wider screen-fixed pose when screenFixed is set', () => {
        const onCanvas = estimateBranchMarkerDimensions('a'.repeat(60))
        const screenFixed = estimateBranchMarkerDimensions('a'.repeat(60), { screenFixed: true })
        expect(screenFixed.height).toBeLessThan(onCanvas.height)
        expect(screenFixed.width).toBeGreaterThanOrEqual(getBranchMarkerScreenFixedMinWidth())
        expect(screenFixed.height).toBe(marker.screenFixedVerticalPadding + messageLineHeight)
    })

    it('is deterministic — identical inputs give identical dimensions on API and client', () => {
        expect(estimateBranchMarkerDimensions('draw a watercolor', { responseLine: true }))
            .toEqual(estimateBranchMarkerDimensions('draw a watercolor', { responseLine: true }))
    })
})

describe('marker previews', () => {
    it('truncates the prompt preview at the configured max chars', () => {
        const long = 'x'.repeat(marker.promptPreviewMaxChars + 10)
        expect(getBranchMarkerPromptPreview(long)).toBe(`${'x'.repeat(marker.promptPreviewMaxChars)}...`)
        expect(getBranchMarkerPromptPreview('short')).toBe('short')
    })

    it('tails the response preview while receiving and heads it when settled', () => {
        const long = `${'y'.repeat(marker.responsePreviewMaxChars)}TAIL`
        expect(getBranchMarkerResponsePreview(long, { isReceiving: true }).endsWith('TAIL')).toBe(true)
        expect(getBranchMarkerResponsePreview(long).startsWith('y')).toBe(true)
    })
})
