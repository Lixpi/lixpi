'use strict'

import { describe, it, expect } from 'vitest'
import { settings, type Settings } from '$src/settings.ts'

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
// CONSOLIDATED SETTINGS
// =============================================================================

describe('settings - grouped configuration', () => {
	it('keeps context-region cloud palettes inside contextRegion.cloud', () => {
		expect(settings.contextRegion.cloud.palettes.mist).toEqual({
			pool: '#C7DAD4',
			bloom: '#EEF8F5',
			edge: '#A1C3BA',
			ink: '#1F2937',
		})
		expect(settings.contextRegion.cloud.palettes.seafoam.edge).toBe('#8FB5AB')
		expect(settings.contextRegion.cloud.palettes.surfaceGradient).toEqual({
			color1: '#DDECE7',
			color2: '#C7DAD4',
			color3: '#EEF8F5',
			color4: '#D6E7E1',
		})
		expect(settings.contextRegion.cloud.palettes.activeThoughtCircle).toEqual({
			color1: '#A7C39A',
			color2: '#9CBB91',
			color3: '#91AD86',
			color4: '#AFCB9E',
		})
		expect(Object.hasOwn(settings, 'contextRegionCloudPalettes')).toBe(false)
	})

	it('uses getters only where cloud settings need sibling palettes', () => {
		const cloudSettings = settings.contextRegion.cloud
		const surfaceGradientDescriptor = Object.getOwnPropertyDescriptor(cloudSettings, 'gradientColors')
		const activeThoughtCircleGradientDescriptor = Object.getOwnPropertyDescriptor(cloudSettings, 'activeThoughtCircleGradientColors')
		const stylesDescriptor = Object.getOwnPropertyDescriptor(cloudSettings, 'styles')

		expect(typeof surfaceGradientDescriptor?.get).toBe('function')
		expect(typeof activeThoughtCircleGradientDescriptor?.get).toBe('function')
		expect(typeof stylesDescriptor?.get).toBe('function')
		expect(cloudSettings.gradientColors).toEqual(['#DDECE7', '#C7DAD4', '#EEF8F5', '#D6E7E1'])
		expect(cloudSettings.activeThoughtCircleGradientColors).toEqual(['#A7C39A', '#9CBB91', '#91AD86', '#AFCB9E'])
		expect(cloudSettings.styles[0].palette).toBe(cloudSettings.palettes.mist)
		expect(cloudSettings.styles.some((style) => style.palette === cloudSettings.palettes.seafoam)).toBe(true)
	})

	it('does not use getters for ordinary static settings', () => {
		expect(collectGetterPaths(settings)).toEqual([
			'contextRegion.cloud.gradientColors',
			'contextRegion.cloud.activeThoughtCircleGradientColors',
			'contextRegion.cloud.styles',
		])
	})

	it('keeps branch lineage and context-region layout knobs in grouped subsections', () => {
		expect(settings.contextRegion.defaultDimensions.width).toBeGreaterThan(0)
		expect(settings.contextRegion.defaultDimensions.height).toBeGreaterThan(0)
		expect(settings.contextRegion.adjacentNodeGap).toBeGreaterThanOrEqual(0)
		expect(settings.contextRegion.cloud.activeThoughtCircleAlpha).toBeLessThan(1)
		expect(settings.contextRegion.cloud.activeThoughtCircleAnimationDurationMs).toBeGreaterThan(0)
		expect(settings.contextRegion.cloud.activeThoughtCircleBloomAlphaLift).toBeGreaterThan(0)
		expect(settings.imageNode.defaultBoxShadow).not.toBe('none')
		expect(settings.imageNode.defaultInsertionWidth).toBeGreaterThan(0)
		expect(settings.imageNode.borderRadius).toBeGreaterThanOrEqual(0)
		expect(settings.imageBranchLineage.generatedImageSize).toBeGreaterThan(0)
		expect(settings.imageBranchLineage.contextRegionOutputGap).toBeGreaterThanOrEqual(0)
		expect(settings.imageBranchLineage.branchToBranchGap).toBeGreaterThanOrEqual(0)
		expect(settings.imageBranchLineage.imageToImageGap).toBeGreaterThanOrEqual(0)
		expect(Object.hasOwn(settings.contextRegion, 'cloud')).toBe(true)
		expect(Object.hasOwn(settings, 'imageBranchLineage')).toBe(true)
	})

	it('keeps migrated behavior and rail hit-target values in their sections', () => {
		expect(settings.modelSelectorDropdown.useModalityFilter).toBe(false)
		expect(settings.aiChatThread.showHeader).toBe(false)
		expect(settings.aiChatThread.useShiftingGradientBackground).toBe(false)
		expect(settings.aiPromptInput.useShiftingGradientBackground).toBe(true)
		expect(settings.connector.proximityConnectThreshold).toBeGreaterThan(0)
		expect(settings.connector.menuConnectionSnapRadius).toBe(110)
		expect(settings.aiChatThread.rail.dragGrabWidth).toBe(20)
		expect(settings.imageNode.useZoomCompensatedResizeHandleScaling).toBe(true)
	})

	it('satisfies the Settings type', () => {
		const configuredSettings: Settings = settings
		expect(configuredSettings).toBe(settings)
	})
})
