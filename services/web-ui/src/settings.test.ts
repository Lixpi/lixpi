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
		expect(settings.imageBranchLineage.imageToImageGap).toBeGreaterThanOrEqual(0)
		expect(Object.hasOwn(settings, 'imageBranchLineage')).toBe(true)
		expect(settings.branchOrigin.nodeSize).toBeGreaterThan(0)
		expect(Object.hasOwn(settings, 'branchOrigin')).toBe(true)
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
