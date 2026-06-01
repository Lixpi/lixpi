'use strict'

import { describe, expect, it } from 'vitest'

import { extractPosterFrame, extractRepresentativeFrame } from './video-storage.ts'

// =============================================================================
// FRAME EXTRACTION — best-effort contract
// =============================================================================

// Both extractors are best-effort: callers (VideoPublisher, GoogleProvider) do
// not wrap them in try/catch, so they must resolve to null rather than throw
// when ffmpeg is missing or the bytes are not a decodable video. This guards
// the shared ffmpeg wrapper and its temp-dir cleanup against regressions.
describe('video frame extraction — graceful failure', () => {
    const notAVideo = Buffer.from('this is definitely not an mp4 container')

    it('extractPosterFrame returns null for non-video bytes', async () => {
        expect(await extractPosterFrame(notAVideo)).toBeNull()
    })

    it('extractRepresentativeFrame returns null for non-video bytes', async () => {
        expect(await extractRepresentativeFrame(notAVideo, 3)).toBeNull()
    })

    it('extractRepresentativeFrame tolerates a missing seek point', async () => {
        expect(await extractRepresentativeFrame(notAVideo)).toBeNull()
    })
})
