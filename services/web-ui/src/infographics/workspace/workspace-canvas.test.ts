'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// HELPERS
// =============================================================================

function loadScss(): string {
	return readFileSync(
		resolve(__dirname, 'workspace-canvas.scss'),
		'utf-8'
	)
}

function extractBlock(scss: string, selector: string): string {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const pattern = new RegExp(`${escapedSelector}\\s*\\{`)
	const match = pattern.exec(scss)
	if (!match) return ''

	let depth = 0
	let start = match.index + match[0].length
	let end = start

	for (let i = start; i < scss.length; i++) {
		if (scss[i] === '{') depth++
		if (scss[i] === '}') {
			if (depth === 0) {
				end = i
				break
			}
			depth--
		}
	}

	return scss.slice(match.index, end + 1)
}

function extractBoxShadowValues(block: string): string[] {
	const matches = [...block.matchAll(/box-shadow:\s*([^;]+);/g)]
	return matches.map(m => m[1].trim())
}

// =============================================================================
// workspace-image-node — consistent box-shadow
// =============================================================================

describe('workspace node CSS — box-shadow consistency', () => {
	const scss = loadScss()
	const docNodeBlock = extractBlock(scss, '.workspace-document-node')
	const imageNodeBlock = extractBlock(scss, '.workspace-image-node')

	it('.workspace-document-node has exactly one box-shadow (base only)', () => {
		const allShadows = extractBoxShadowValues(docNodeBlock)
		expect(allShadows).toHaveLength(1)
		expect(allShadows[0]).not.toBe('none')
	})

	it('no hover box-shadow override on any node', () => {
		const hoverDocBlock = extractBlock(docNodeBlock, '&:hover')
		expect(extractBoxShadowValues(hoverDocBlock)).toHaveLength(0)

		const hoverImgBlock = extractBlock(imageNodeBlock, '&:hover')
		expect(extractBoxShadowValues(hoverImgBlock)).toHaveLength(0)
	})

	it('no is-selected or focus-within box-shadow override on any node', () => {
		// No box-shadow should appear in selected/focus-within rules
		expect(docNodeBlock).not.toMatch(/is-selected[\s\S]*?box-shadow/)
		expect(docNodeBlock).not.toMatch(/focus-within[\s\S]*?box-shadow/)
	})

	it('no box-shadow transition on any node', () => {
		expect(docNodeBlock).not.toContain('transition: box-shadow')
		expect(docNodeBlock).not.toContain('transition:box-shadow')
	})

	it('.workspace-image-node base has no own box-shadow, only anchored variant does', () => {
		// The base .workspace-image-node must not set box-shadow.
		// Only the nested .workspace-image-node--anchored modifier may.
		const baseScss = imageNodeBlock.replace(
			/&\.workspace-image-node--anchored\s*\{[^}]*\}/g,
			''
		)
		const baseShadows = extractBoxShadowValues(baseScss)
		expect(baseShadows).toHaveLength(0)

		// Anchored variant is allowed to have a shadow
		const anchoredBlock = extractBlock(imageNodeBlock, '&.workspace-image-node--anchored')
		const anchoredShadows = extractBoxShadowValues(anchoredBlock)
		expect(anchoredShadows).toHaveLength(1)
	})
})
