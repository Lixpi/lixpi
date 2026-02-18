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

function loadTs(): string {
	return readFileSync(
		resolve(__dirname, 'WorkspaceCanvas.ts'),
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

// =============================================================================
// AI chat thread — auto-grow CSS overrides
// =============================================================================

describe('AI chat thread — workspace CSS overrides for auto-grow', () => {
	const scss = loadScss()

	it('zeroes padding-bottom on .ai-chat-thread-wrapper inside workspace thread', () => {
		const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper')
		expect(block).toMatch(/padding-bottom:\s*0/)
	})

	it('zeroes padding-bottom on .ai-chat-thread-content inside workspace thread', () => {
		const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper .ai-chat-thread-content')
		expect(block).toMatch(/padding-bottom:\s*0/)
	})

	it('hides the in-editor composer (.ai-user-input-wrapper) inside workspace thread', () => {
		const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper .ai-user-input-wrapper')
		expect(block).toMatch(/display:\s*none/)
	})

	it('overrides ProseMirror min-height to 0 inside workspace thread', () => {
		// There are two rules with this selector — search the raw SCSS for
		// the min-height declaration scoped to the workspace thread.
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*min-height:\s*0/)
	})

	it('sets ProseMirror padding-bottom to 1rem inside workspace thread', () => {
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*padding-bottom:\s*1rem/)
	})
})

// =============================================================================
// AI chat thread — auto-grow TypeScript infrastructure
// =============================================================================

describe('AI chat thread — auto-grow TS infrastructure', () => {
	const ts = loadTs()

	it('defines AI_CHAT_THREAD_MIN_HEIGHT constant', () => {
		expect(ts).toMatch(/const\s+AI_CHAT_THREAD_MIN_HEIGHT\s*=\s*\d+/)
	})

	it('defines autoGrowThreadNode function', () => {
		expect(ts).toMatch(/function\s+autoGrowThreadNode\s*\(\s*threadNodeId:\s*string\s*\)/)
	})

	it('defines scheduleThreadAutoGrow function', () => {
		expect(ts).toMatch(/function\s+scheduleThreadAutoGrow\s*\(\s*threadNodeId:\s*string\s*\)/)
	})

	it('autoGrowThreadNode measures natural height using height:auto technique', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain("threadNodeEl.style.height = 'auto'")
		expect(fnBody).toContain('threadNodeEl.offsetHeight')
	})

	it('autoGrowThreadNode enforces minimum height via AI_CHAT_THREAD_MIN_HEIGHT', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('AI_CHAT_THREAD_MIN_HEIGHT')
	})

	it('autoGrowThreadNode can both grow and shrink (no grow-only guard)', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		// Must use === (skip if equal) not <= (skip if smaller — grow only)
		expect(fnBody).toMatch(/naturalHeight\s*===\s*currentHeight/)
		expect(fnBody).not.toMatch(/naturalHeight\s*<=\s*currentHeight/)
	})

	it('autoGrowThreadNode calls commitCanvasStatePreservingEditors', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('commitCanvasStatePreservingEditors')
	})

	it('autoGrowThreadNode calls repositionAllThreadFloatingInputs', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('repositionAllThreadFloatingInputs')
	})

	it('onEditorChange calls scheduleThreadAutoGrow', () => {
		expect(ts).toMatch(/onEditorChange[\s\S]*?scheduleThreadAutoGrow/)
	})

	it('renderNodes schedules auto-grow for all thread nodes', () => {
		const renderMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(renderMatch).not.toBeNull()
		const renderBody = renderMatch![0]
		expect(renderBody).toContain('scheduleThreadAutoGrow')
	})

	it('destroy() cleans up autoGrowRaf and pendingAutoGrowThreadNodeIds', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		const destroyBody = destroyMatch![0]
		expect(destroyBody).toContain('autoGrowRaf')
		expect(destroyBody).toContain('pendingAutoGrowThreadNodeIds')
	})
})
