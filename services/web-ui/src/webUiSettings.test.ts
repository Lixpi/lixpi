'use strict'

import { describe, it, expect } from 'vitest'
import { webUiSettings, type WebUiSettings } from './webUiSettings.ts'

// =============================================================================
// SETTINGS SHAPE
// =============================================================================

describe('webUiSettings — shape', () => {
	it('exports a WebUiSettings type with exactly the expected keys', () => {
		const keys = Object.keys(webUiSettings).sort()
		expect(keys).toEqual([
			'renderNodeConnectorLineFromAiResponseMessageToTheGeneratedMediaItem',
			'showHeaderOnAiChatThreadNodes',
			'useModalityFilterOnModelSelectorDropdown',
			'useShiftingGradientBackgroundOnAiChatThreadNode',
			'useShiftingGradientBackgroundOnAiUserInputNode',
		])
	})

	it('all values are booleans', () => {
		for (const [key, value] of Object.entries(webUiSettings)) {
			expect(typeof value).toBe('boolean')
		}
	})

	it('object is not empty', () => {
		expect(Object.keys(webUiSettings).length).toBeGreaterThan(0)
	})
})

// =============================================================================
// DEFAULT VALUES
// =============================================================================

describe('webUiSettings — defaults', () => {
	it('useModalityFilterOnModelSelectorDropdown defaults to false', () => {
		expect(webUiSettings.useModalityFilterOnModelSelectorDropdown).toBe(false)
	})

	it('useShiftingGradientBackgroundOnAiChatThreadNode defaults to false', () => {
		expect(webUiSettings.useShiftingGradientBackgroundOnAiChatThreadNode).toBe(false)
	})

	it('useShiftingGradientBackgroundOnAiUserInputNode defaults to true', () => {
		expect(webUiSettings.useShiftingGradientBackgroundOnAiUserInputNode).toBe(true)
	})

	it('showHeaderOnAiChatThreadNodes defaults to false', () => {
		expect(webUiSettings.showHeaderOnAiChatThreadNodes).toBe(false)
	})
})

// =============================================================================
// TYPE SAFETY — compile-time guards
// =============================================================================

describe('webUiSettings — type compatibility', () => {
	it('satisfies the WebUiSettings type', () => {
		const settings: WebUiSettings = webUiSettings
		expect(settings).toBe(webUiSettings)
	})

	it('each gradient setting key references "ShiftingGradient"', () => {
		const gradientKeys = Object.keys(webUiSettings).filter(k =>
			k.includes('ShiftingGradient')
		)
		expect(gradientKeys).toHaveLength(2)
		expect(gradientKeys).toContain('useShiftingGradientBackgroundOnAiChatThreadNode')
		expect(gradientKeys).toContain('useShiftingGradientBackgroundOnAiUserInputNode')
	})
})
