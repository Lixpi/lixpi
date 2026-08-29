'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function readWorkspaceReadme(): string {
	return readFileSync(resolve(__dirname, 'README.md'), 'utf-8')
}

function expectSourceToContain(source: string, snippet: string, label: string): void {
	expect(
		source.includes(snippet),
		`${label} should contain:\n${snippet}`
	).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label: string): void {
	expect(
		source.includes(snippet),
		`${label} should not contain:\n${snippet}`
	).toBe(false)
}

// =============================================================================
// WORKSPACE COLLISION DOCUMENTATION LINKS
// =============================================================================

describe('canvas collision documentation', () => {
	const workspaceReadme = readWorkspaceReadme()

	it('links to the repository-level collision feature documentation', () => {
		expectSourceToContain(workspaceReadme, 'documentation/canvas/COLLISION-RESOLUTION.md', 'workspace README')
		expectSourceToContain(workspaceReadme, 'collision resolution, viewport-centered insertion cleanup, and drag-release collision rules', 'workspace README')
	})

	it('keeps collision ownership out of the canvas view in local documentation', () => {
		expectSourceToContain(workspaceReadme, 'Canvas behavior such as placement, collision resolution, drag and resize planning, and viewport-coordinate math belongs in this `infographics/workspace` module or its utilities, not in the view host.', 'workspace README')
	})

	it('keeps local docs free of stale removed grouping config names', () => {
		expectSourceNotToContain(workspaceReadme, ['context', 'Region', 'Cl', 'oud*'].join(''), 'workspace README')
		expectSourceNotToContain(workspaceReadme, ['context', 'Region', 'Cl', 'oudStyles'].join(''), 'workspace README')
		expectSourceNotToContain(workspaceReadme, ['context', 'Region', 'Cl', 'oudGradientColors'].join(''), 'workspace README')
	})
})
