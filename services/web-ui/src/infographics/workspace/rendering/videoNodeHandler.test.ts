'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// The video node handler renders the VEO poster through PIXI and exposes an
// attached DOM video element for the workspace chrome. These are source-level
// guards on the texture-load contract that keeps the poster from rendering as a
// black rectangle without requiring a real PIXI/DOM runtime.
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

	it('exposes the attached video element without starting a PIXI video texture loop', () => {
		expect(source).toContain('getVideoElement: (nodeId: string) => entries.get(nodeId)?.videoElement ?? null')
		expect(source).toContain('ensureHiddenVideoHost().appendChild(videoElement)')
		expect(source).toContain('onVideoElementReady?.(node.nodeId)')
		expect(source).toContain("videoElement.addEventListener('play', handlePlay)")
		expect(source).toContain("videoElement.addEventListener('pause', handlePause)")
		expect(source).not.toContain('Texture.from(entry.videoElement')
		expect(source).not.toContain('videoSource?.update?.()')
	})
})
