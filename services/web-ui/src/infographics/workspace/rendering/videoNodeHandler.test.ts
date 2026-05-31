'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// The video node handler renders the VEO poster and the click-to-play video
// through PIXI, which needs a real PIXI/DOM runtime to execute. These are
// source-level guards on the texture-load contract that keeps the poster from
// rendering as a black rectangle.
const source = readFileSync(resolve(__dirname, 'videoNodeHandler.ts'), 'utf-8')

describe('videoNodeHandler — poster texture loading', () => {
	it('decodes the poster through the shared worker pool, not Texture.from(url)', () => {
		// PIXI v8 Texture.from(urlString) does not fetch remote URLs; loading the
		// poster that way leaves the sprite empty so the dark colorRect shows
		// through as a black rectangle. The poster must be decoded to an
		// ImageBitmap first (the same path the image media layer uses).
		expect(source).toContain("import { decodeImageInWorker } from '$src/infographics/workspace/pixiImageDecoder.ts'")
		expect(source).toContain('const bitmap = await decodeImageInWorker(posterSrc)')
		expect(source).toContain('const posterTexture = Texture.from(bitmap)')
		expect(source).not.toContain('await Texture.from(posterSrc)')
	})

	it('builds the live playback texture from the video element', () => {
		// Texture.from(HTMLVideoElement) IS valid in PIXI v8 — it creates a
		// VideoSource — so the play path legitimately keeps that form.
		expect(source).toContain('Texture.from(entry.videoElement')
	})
})
