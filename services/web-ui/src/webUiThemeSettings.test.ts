'use strict'

import { describe, it, expect } from 'vitest'
import { webUiThemeSettings, type WebUiThemeSettings } from './webUiThemeSettings.ts'

// =============================================================================
// SETTINGS SHAPE
// =============================================================================

describe('webUiThemeSettings — shape', () => {
	it('exports a WebUiThemeSettings type with exactly the expected keys', () => {
		const keys = Object.keys(webUiThemeSettings).sort()
		expect(keys).toEqual([
			'aiChatThreadNodeBorder',
			'aiChatThreadNodeBoxShadow',
			'aiChatThreadRailEdgeMargin',
			'aiChatThreadRailGradient',
			'aiChatThreadRailOffset',
			'aiChatThreadRailWidth',
			'aiResponseMessageBubbleColor',
		])
	})

	it('object is not empty', () => {
		expect(Object.keys(webUiThemeSettings).length).toBeGreaterThan(0)
	})
})

// =============================================================================
// DEFAULT VALUES
// =============================================================================

describe('webUiThemeSettings — defaults', () => {
	it('aiResponseMessageBubbleColor defaults to #f7f7fd', () => {
		expect(webUiThemeSettings.aiResponseMessageBubbleColor).toBe('#f7f7fd')
	})

	it('aiChatThreadNodeBoxShadow defaults to none', () => {
		expect(webUiThemeSettings.aiChatThreadNodeBoxShadow).toBe('none')
	})

	it('aiChatThreadNodeBorder defaults to none', () => {
		expect(webUiThemeSettings.aiChatThreadNodeBorder).toBe('none')
	})

	it('aiChatThreadRailGradient uses the model selector dropdown gradient', () => {
		expect(webUiThemeSettings.aiChatThreadRailGradient).toBe(
			'linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)'
		)
	})

	it('aiChatThreadRailWidth defaults to 3px', () => {
		expect(webUiThemeSettings.aiChatThreadRailWidth).toBe('3px')
	})

	it('aiChatThreadRailOffset defaults to -1', () => {
		expect(webUiThemeSettings.aiChatThreadRailOffset).toBe(-1)
	})

	it('aiChatThreadRailEdgeMargin defaults to 0.025', () => {
		expect(webUiThemeSettings.aiChatThreadRailEdgeMargin).toBe(0.025)
	})
})

// =============================================================================
// TYPE SAFETY — compile-time guards
// =============================================================================

describe('webUiThemeSettings — type compatibility', () => {
	it('satisfies the WebUiThemeSettings type', () => {
		const settings: WebUiThemeSettings = webUiThemeSettings
		expect(settings).toBe(webUiThemeSettings)
	})

	it('string settings are strings', () => {
		const stringKeys: (keyof WebUiThemeSettings)[] = [
			'aiResponseMessageBubbleColor',
			'aiChatThreadNodeBoxShadow',
			'aiChatThreadNodeBorder',
			'aiChatThreadRailGradient',
			'aiChatThreadRailWidth',
		]
		for (const key of stringKeys) {
			expect(typeof webUiThemeSettings[key]).toBe('string')
		}
	})

	it('numeric settings are numbers', () => {
		const numericKeys: (keyof WebUiThemeSettings)[] = [
			'aiChatThreadRailOffset',
			'aiChatThreadRailEdgeMargin',
		]
		for (const key of numericKeys) {
			expect(typeof webUiThemeSettings[key]).toBe('number')
		}
	})
})
