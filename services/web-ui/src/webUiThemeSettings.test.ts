'use strict'

import { describe, it, expect } from 'vitest'
import { webUiThemeSettings } from '$src/webUiThemeSettings.ts'

function collectGetterPaths(value: unknown, prefix = ''): string[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return []

	const paths: string[] = []
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		const path = prefix ? `${prefix}.${key}` : key
		if (typeof descriptor.get === 'function') {
			paths.push(path)
			continue
		}

		if ('value' in descriptor) {
			paths.push(...collectGetterPaths(descriptor.value, path))
		}
	}

	return paths
}

// =============================================================================
// CONTEXT REGION THEME SETTINGS
// =============================================================================

describe('webUiThemeSettings — context region configuration', () => {
	it('keeps context-region cloud palettes inside contextRegion.cloud', () => {
		expect(webUiThemeSettings.contextRegion.cloud.palettes.mist).toEqual({
			pool: '#C7DAD4',
			bloom: '#EEF8F5',
			edge: '#A1C3BA',
			ink: '#1F2937',
		})
		expect(webUiThemeSettings.contextRegion.cloud.palettes.seafoam.edge).toBe('#8FB5AB')
		expect(Object.hasOwn(webUiThemeSettings, 'contextRegionCloudPalettes')).toBe(false)
	})

	it('uses a getter only where cloud styles need sibling palettes', () => {
		const cloudSettings = webUiThemeSettings.contextRegion.cloud
		const descriptor = Object.getOwnPropertyDescriptor(cloudSettings, 'styles')

		expect(typeof descriptor?.get).toBe('function')
		expect(cloudSettings.styles[0].palette).toBe(cloudSettings.palettes.mist)
		expect(cloudSettings.styles.some((style) => style.palette === cloudSettings.palettes.seafoam)).toBe(true)
	})

	it('does not use getters for ordinary static settings', () => {
		expect(collectGetterPaths(webUiThemeSettings)).toEqual(['contextRegion.cloud.styles'])
	})

	it('keeps branch lineage and context-region layout knobs in grouped subsections', () => {
		expect(webUiThemeSettings.contextRegion.defaultDimensions.width).toBeGreaterThan(0)
		expect(webUiThemeSettings.contextRegion.defaultDimensions.height).toBeGreaterThan(0)
		expect(webUiThemeSettings.contextRegion.adjacentNodeGap).toBeGreaterThanOrEqual(0)
		expect(webUiThemeSettings.imageBranchLineage.generatedImageSize).toBeGreaterThan(0)
		expect(webUiThemeSettings.imageBranchLineage.contextRegionOutputGap).toBeGreaterThanOrEqual(0)
		expect(webUiThemeSettings.imageBranchLineage.imageToImageGap).toBeGreaterThanOrEqual(0)
		expect(Object.hasOwn(webUiThemeSettings.contextRegion, 'cloud')).toBe(true)
		expect(Object.hasOwn(webUiThemeSettings, 'imageBranchLineage')).toBe(true)
	})
})