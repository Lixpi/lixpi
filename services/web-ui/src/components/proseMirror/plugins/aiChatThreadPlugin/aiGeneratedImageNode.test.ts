'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// HELPERS
// =============================================================================

function loadTs(): string {
	return readFileSync(
		resolve(__dirname, 'aiGeneratedImageNode.ts'),
		'utf-8'
	)
}

// =============================================================================
// Imports — brokenImageIcon from svgIcons, html from domTemplates
// =============================================================================

describe('aiGeneratedImageNodeView — imports', () => {
	const ts = loadTs()

	it('imports brokenImageIcon from svgIcons', () => {
		expect(ts).toMatch(/import\s*\{[^}]*brokenImageIcon[^}]*\}\s*from\s*['"]\$src\/svgIcons\/index\.ts['"]/)
	})

	it('imports html from domTemplates', () => {
		expect(ts).toMatch(/import\s*\{[^}]*html[^}]*\}\s*from\s*['"]\$src\/utils\/domTemplates\.ts['"]/)
	})
})

// =============================================================================
// Image error placeholder — uses html template + innerHTML for SVG
// =============================================================================

describe('aiGeneratedImageNodeView — error placeholder', () => {
	const ts = loadTs()

	it('uses html template for the error placeholder', () => {
		const onerrorMatch = ts.match(/imageElement\.onerror\s*=[\s\S]*?(?=\n    \w|\n    \/\/|\n\n    const|\n    updateDisplay)/)
		expect(onerrorMatch).not.toBeNull()
		const block = onerrorMatch![0]

		expect(block).toContain('html`')
	})

	it('injects brokenImageIcon via innerHTML attribute', () => {
		const onerrorMatch = ts.match(/imageElement\.onerror\s*=[\s\S]*?(?=\n    \w|\n    \/\/|\n\n    const|\n    updateDisplay)/)
		expect(onerrorMatch).not.toBeNull()
		const block = onerrorMatch![0]

		expect(block).toContain('innerHTML=${brokenImageIcon}')
	})

	it('checks for existing placeholder before appending', () => {
		const onerrorMatch = ts.match(/imageElement\.onerror\s*=[\s\S]*?(?=\n    \w|\n    \/\/|\n\n    const|\n    updateDisplay)/)
		expect(onerrorMatch).not.toBeNull()
		const block = onerrorMatch![0]

		expect(block).toContain(".querySelector('.image-error-placeholder')")
	})

	it('hides the image element on error', () => {
		const onerrorMatch = ts.match(/imageElement\.onerror\s*=[\s\S]*?(?=\n    \w|\n    \/\/|\n\n    const|\n    updateDisplay)/)
		expect(onerrorMatch).not.toBeNull()
		const block = onerrorMatch![0]

		expect(block).toContain("display = 'none'")
	})

	it('no inline SVG markup', () => {
		const onerrorMatch = ts.match(/imageElement\.onerror\s*=[\s\S]*?(?=\n    \w|\n    \/\/|\n\n    const|\n    updateDisplay)/)
		expect(onerrorMatch).not.toBeNull()
		const block = onerrorMatch![0]

		expect(block).not.toContain('<svg')
	})
})

// =============================================================================
// Image URL construction — handles data:, /api/, http, and base64
// =============================================================================

describe('aiGeneratedImageNodeView — image URL construction', () => {
	const ts = loadTs()

	it('handles data: URLs directly', () => {
		expect(ts).toContain("imageData.startsWith('data:')")
	})

	it('handles /api/ paths with API base URL and token', () => {
		expect(ts).toContain("imageData.startsWith('/api/')")
		expect(ts).toContain('`${API_BASE_URL}${imageData}')
	})

	it('handles full http URLs with /api/images/ by stripping stale tokens', () => {
		expect(ts).toContain("stripped.includes('/api/images/')")
		expect(ts).toMatch(/imageData\.replace\([^)]*token[^)]*\)/)
	})

	it('handles legacy base64 data by prepending data: prefix', () => {
		expect(ts).toContain('`data:image/png;base64,${imageData}`')
	})
})
