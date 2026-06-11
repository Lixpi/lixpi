'use strict'

import { describe, it, expect } from 'vitest'
import { colorPalette, settings, type Settings } from '$src/settings.ts'

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
	it('exports the shared color palette and critical AI prompt model menu settings', () => {
		expect(colorPalette.steelBlue).toBe('#5d656d')
		expect(colorPalette.offWhite).toBe('#f5f3f3')

		expect(settings.aiPromptInput.modelMenu.openPromptZIndex).toBe('10000')
		expect(settings.aiPromptInput.modelMenu.infoBubbleZIndex).toBe('10080')
		expect(settings.aiPromptInput.modelMenu.helpTooltipContentZIndex).toBe('10120')
		expect(settings.aiPromptInput.modelMenu.controlsMaxWidth).toContain('612px')
	})

	it('does not use getters for ordinary static settings', () => {
		expect(collectGetterPaths(settings)).toEqual([])
	})

	it('keeps branch lineage and chat-thread layout knobs in grouped subsections', () => {
		expect(settings.aiChatThread.defaultDimensions.width).toBeGreaterThan(0)
		expect(settings.aiChatThread.defaultDimensions.height).toBeGreaterThan(0)
		expect(settings.aiChatThread.adjacentNodeGap).toBeGreaterThanOrEqual(0)
		expect(settings.imageNode.defaultBoxShadow).not.toBe('none')
		expect(settings.imageNode.defaultInsertionWidth).toBeGreaterThan(0)
		expect(settings.imageNode.borderRadius).toBeGreaterThanOrEqual(0)
		expect(settings.imageBranchLineage.generatedImageSize).toBeGreaterThan(0)
		expect(settings.imageBranchLineage.rootOutputGap).toBeGreaterThanOrEqual(0)
		expect(settings.imageBranchLineage.branchToBranchGap).toBeGreaterThanOrEqual(0)
		expect(settings.imageBranchLineage.imageToImageGap).toBe(512)
		expect(settings.imageBranchLineage.branchFanoutDepthGap).toBe(96)
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

	it('adds configurable AI chat panel tabs settings with finite values', () => {
		expect(Object.hasOwn(settings.aiChatThread, 'panelTabs')).toBe(true)
		expect(settings.aiChatThread.panelTabs.minTabWidth).toBe(96)
		expect(settings.aiChatThread.panelTabs.height).toBe(28)
		expect(settings.aiChatThread.panelTabs.transitionDurationMs).toBe(160)
		expect(settings.aiChatThread.panelTabs.transitionMinDurationMs).toBe(100)
		expect(settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor).toBeGreaterThan(0)
		expect(settings.aiChatThread.panelTabs.activeTabBoxShadow).toBe('none')
		expect(settings.aiChatThread.panelTabs.activeTabInsetShadow.topColor).toBe('rgba(255, 255, 255, 0.86)')
		expect(settings.aiChatThread.panelTabs.activeTabInsetShadow.bottomColor).toBe('rgba(0, 0, 0, 0)')
	})

	it('satisfies the Settings type', () => {
		const configuredSettings: Settings = settings
		expect(configuredSettings).toBe(settings)
	})
})
