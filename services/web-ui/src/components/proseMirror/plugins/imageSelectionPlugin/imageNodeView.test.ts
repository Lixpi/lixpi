'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// HELPERS
// =============================================================================

function loadTs(): string {
	return readFileSync(
		resolve(__dirname, 'imageNodeView.ts'),
		'utf-8'
	)
}

// =============================================================================
// Imports — brokenImageIcon from svgIcons, html from domTemplates
// =============================================================================

describe('ImageNodeView — imports', () => {
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

describe('ImageNodeView — error placeholder', () => {
	const ts = loadTs()

	it('uses html template for the error placeholder, not document.createElement', () => {
		// Find the error handler block
		const errorBlock = ts.match(/addEventListener\('error'[\s\S]*?\}\)/)
		expect(errorBlock).not.toBeNull()
		const block = errorBlock![0]

		expect(block).toContain('html`')
		expect(block).not.toContain('document.createElement')
	})

	it('injects brokenImageIcon via innerHTML attribute, not string interpolation', () => {
		const errorBlock = ts.match(/addEventListener\('error'[\s\S]*?\}\)/)
		expect(errorBlock).not.toBeNull()
		const block = errorBlock![0]

		expect(block).toContain('innerHTML=${brokenImageIcon}')
	})

	it('checks for existing placeholder before appending (deduplication)', () => {
		const errorBlock = ts.match(/addEventListener\('error'[\s\S]*?\}\)/)
		expect(errorBlock).not.toBeNull()
		const block = errorBlock![0]

		expect(block).toContain(".querySelector('.image-error-placeholder')")
	})

	it('hides the img element on error', () => {
		const errorBlock = ts.match(/addEventListener\('error'[\s\S]*?\}\)/)
		expect(errorBlock).not.toBeNull()
		const block = errorBlock![0]

		expect(block).toContain("display = 'none'")
	})

	it('no inline SVG markup in source', () => {
		const errorBlock = ts.match(/addEventListener\('error'[\s\S]*?\}\)/)
		expect(errorBlock).not.toBeNull()
		const block = errorBlock![0]

		expect(block).not.toContain('<svg')
		expect(block).not.toContain('viewBox')
	})
})

// =============================================================================
// Partial generated image placeholder
// =============================================================================

describe('ImageNodeView — partial generated image placeholder', () => {
	const ts = loadTs()

	it('renders a generating placeholder for partial image nodes without image data', () => {
		expect(ts).toContain('syncPartialPlaceholder')
		expect(ts).toContain('pm-image-generating-placeholder')
		expect(ts).toContain('pm-image-generating-dot')
		expect(ts).toContain('Boolean(this.node.attrs.isPartial) && !getImageSrcAttr(this.node)')
	})

	it('does not assign an empty string as an img src', () => {
		const updateBlock = ts.match(/private async updateImageSrc[\s\S]*?\n    \}/)
		expect(updateBlock).not.toBeNull()
		const block = updateBlock![0]

		expect(block).toContain("if (!src)")
		expect(block).toContain("this.img.removeAttribute('src')")
		expect(block).toContain("this.img.style.display = 'none'")
	})
})

// =============================================================================
// buildImageSrc — handles various URL formats
// =============================================================================

describe('ImageNodeView — buildImageSrc', () => {
	const ts = loadTs()

	it('returns empty string for empty src', () => {
		expect(ts).toMatch(/if\s*\(\s*!src\s*\)\s*return\s*['"]/)
	})

	it('passes through data: and blob: URLs without auth', () => {
		expect(ts).toContain("src.startsWith('data:')")
		expect(ts).toContain("src.startsWith('blob:')")
	})

	it('prepends API base URL and appends token for /api/ paths', () => {
		expect(ts).toContain("src.startsWith('/api/')")
		expect(ts).toContain('`${API_BASE_URL}${src}')
	})

	it('strips stale tokens from full URLs pointing to /api/images/', () => {
		expect(ts).toContain("src.includes('/api/images/')")
		expect(ts).toMatch(/src\.replace\([^)]*token[^)]*\)/)
	})
})
