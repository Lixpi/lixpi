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

function expectNoOwnKeys(value: Record<string, unknown>, keys: string[]): void {
	for (const key of keys) {
		expect(Object.hasOwn(value, key), `settings object should not expose stale key: ${key}`).toBe(false)
	}
}

// =============================================================================
// CONSOLIDATED SETTINGS
// =============================================================================

describe('settings - grouped configuration', () => {
	it('exports the shared color palette and critical AI prompt model menu settings', () => {
		expect(colorPalette.steelBlue).toBe('#5d656d')
		expect(colorPalette.offWhite).toBe('#f5f3f3')

		expect(settings.aiPromptInput.modelMenu.styles.infoBubbleBorderRadius).toBe('12px')
		expect(settings.aiPromptInput.modelMenu.styles.helpTooltipBoxShadow).toContain('0 2px 12px')
		expect(settings.dropdown.styles.popoverBoxShadow).toContain('0 2px 12px')
		expect(settings.gradient.styles.shiftingColors).toHaveLength(4)
		expect(settings.helpTooltip.interactiveHideDelayMs).toBe(80)
	})

	it('does not use getters for ordinary static settings', () => {
		expect(collectGetterPaths(settings)).toEqual([])
	})

	it('keeps branch lineage and chat-thread layout knobs in grouped subsections', () => {
		expect(settings.aiChatThread.defaultDimensions.width).toBeGreaterThan(0)
		expect(settings.aiChatThread.defaultDimensions.height).toBeGreaterThan(0)
		expect(settings.aiChatThread.adjacentNodeGap).toBeGreaterThanOrEqual(0)
		expect(settings.imageNode.styles.defaultBoxShadow).not.toBe('none')
		expect(settings.imageNode.defaultInsertionWidth).toBeGreaterThan(0)
		expect(settings.imageNode.styles.borderRadius).toBeGreaterThanOrEqual(0)
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
		expect(settings.connector.styles.lineDefaultColor).toBe('#5d656d')
		expect(settings.aiChatThread.rail.dragGrabWidth).toBe(20)
		expect(settings.connector.styles.lineFocusColor).toBe('#000')
		expect(settings.selection.styles.outlineColor).toBe('rgba(197, 192, 238, 0.75)')
		expect(settings.selection.styles.marqueeBorderColor).toContain('rgba(176, 173, 224')
		expect(settings.imageNode.useZoomCompensatedResizeHandleScaling).toBe(true)
	})

	it('adds configurable AI chat panel tabs settings with finite values', () => {
		expect(Object.hasOwn(settings.aiChatThread, 'panelTabs')).toBe(true)
		expect(settings.aiChatThread.panelTabs.minTabWidth).toBe(96)
		expect(settings.aiChatThread.panelTabs.height).toBe(28)
		expect(settings.aiChatThread.panelTabs.transitionDurationMs).toBe(160)
		expect(settings.aiChatThread.panelTabs.transitionMinDurationMs).toBe(100)
		expect(settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor).toBeGreaterThan(0)
		expect(settings.aiChatThread.panelTabs.styles.activeTabBoxShadow).toBe('none')
		expect(settings.aiChatThread.panelTabs.styles.activeTabInsetShadow.topColor).toBe('rgba(255, 255, 255, 0.86)')
		expect(settings.aiChatThread.panelTabs.styles.activeTabInsetShadow.bottomColor).toBe('rgba(0, 0, 0, 0)')
	})

	it('adds chat thread session history and context preview style groups', () => {
		expect(Object.hasOwn(settings.aiChatThread, 'sessionHistory')).toBe(true)
		expect(settings.aiChatThread.sessionHistory.styles.controlColor).toBe('#697388')
		expect(settings.aiChatThread.sessionHistory.styles.controlHoverColor).toBe('#39455d')
		expect(settings.aiChatThread.sessionHistory.styles.historyToggleHoverBackground).toBe('rgba(105, 115, 136, 0.1)')
		expect(settings.aiChatThread.sessionHistory.styles.actionHoverBackground).toBe('#5d656d')
		expect(settings.aiChatThread.sessionHistory.styles.actionHoverColor).toBe(colorPalette.offWhite)
		expect(settings.aiChatThread.sessionHistory.styles.deleteColor).toBe('#7a8497')
		expect(settings.aiChatThread.sessionHistory.styles.threadMarkerBackground).toBe('#5f8fcf')
		expect(settings.aiChatThread.sessionHistory.styles.threadMarkerBoxShadow).toBe('0 0 0 3px rgba(95, 143, 207, 0.14)')

		expect(Object.hasOwn(settings.aiChatThread, 'contextPreview')).toBe(true)
		expect(settings.aiChatThread.contextPreview.styles.controlsColor).toBe('#39455d')
		expect(settings.aiChatThread.contextPreview.styles.chipBackground).toBe('transparent')
		expect(settings.aiChatThread.contextPreview.styles.popoverTitleColor).toBe('#1a3a47')
		expect(settings.aiChatThread.contextPreview.styles.popoverTextColor).toBe('rgba(57, 69, 93, 0.82)')
		expect(settings.aiChatThread.contextPreview.styles.removeButtonColor).toBe('#39455d')
	})

	it('keeps AI chat rail settings under styles subsection', () => {
		expect(settings.aiChatThread.rail.styles.gradient).toBe('linear-gradient(135deg, #F5EFF9 0%, #E6E9F6 100%)')
		expect(settings.aiChatThread.rail.styles.width).toBe('3px')
		expect(settings.aiChatThread.rail.styles.boundaryCircleColors).toEqual(['#F3E4F2', '#C5C0EE', 'rgb(202, 180, 201)'])
		expect(settings.aiChatThread.rail.styles.boundaryCircleColors).toHaveLength(3)
	})

	it('keeps presentation tokens under styles without duplicating stale root keys', () => {
		expectNoOwnKeys(settings.dropdown, ['popoverBoxShadow'])
		expectNoOwnKeys(settings.gradient, ['shiftingColors'])
		expectNoOwnKeys(settings.aiChatThread, ['responseMessageBubbleColor', 'nodeBoxShadow', 'nodeBorder', 'panelSectionDividerBorder'])
		expectNoOwnKeys(settings.aiChatThread.panelTabs, ['activeTabBoxShadow', 'activeTabInsetShadow'])
		expectNoOwnKeys(settings.aiChatThread.rail, ['gradient', 'width', 'boundaryCircleColors'])
		expectNoOwnKeys(settings.connector, ['lineDefaultColor', 'lineFocusColor'])
		expectNoOwnKeys(settings.selection, [
			'marqueeBorderColor',
			'marqueeBackgroundColor',
			'overlayBorderColor',
			'overlayBackgroundColor',
			'outlineColor',
		])
		expectNoOwnKeys(settings.imageNode, ['defaultBoxShadow', 'selectedBoxShadow', 'borderRadius', 'modelBadgeBoxShadow'])
		expectNoOwnKeys(settings.imageNode.generationBorder, ['trackColor', 'trackAlpha', 'snakeTailAlpha', 'snakeColors'])
	})

	it('keeps model menu settings focused on theme tokens rather than fixed layout mechanics', () => {
		expect(settings.aiPromptInput.modelMenu.styles.triggerColor).toBe(colorPalette.steelBlue)
		expect(settings.aiPromptInput.modelMenu.styles.helpTooltipBackground).toBe(colorPalette.steelBlue)
		expect(settings.aiPromptInput.modelMenu.styles.helpTooltipColor).toBe(colorPalette.offWhite)

		expectNoOwnKeys(settings.aiPromptInput.modelMenu, [
			'openPromptZIndex',
			'infoBubbleZIndex',
			'triggerSize',
			'triggerIconSize',
			'triggerTransition',
			'infoBubbleWidth',
			'infoBubbleMaxWidth',
			'infoBubbleMobileMaxWidth',
			'infoBubblePadding',
			'contentGap',
			'sectionGap',
			'sectionDividerPaddingTop',
			'sectionDividerWidth',
			'sectionHeadingGap',
			'sectionHeadingJustifyContent',
			'sectionTitleFontSize',
			'sectionTitleFontWeight',
			'sectionTitleLineHeight',
			'controlsGridTemplateColumns',
			'controlsMobileGridTemplateColumns',
			'controlsGap',
			'controlsMaxWidth',
			'controlsMobileMaxWidth',
			'controlGap',
			'controlLabelInset',
			'controlLabelFontSize',
			'controlLabelFontWeight',
			'controlLabelLineHeight',
			'dropdownButtonMaxWidth',
			'dropdownButtonMobileMaxWidth',
			'nestedDropdownGap',
			'helpTooltipTriggerSize',
			'helpTooltipIconSize',
			'helpTooltipTriggerFocusOutlineOffset',
			'helpTooltipOffset',
			'helpTooltipViewportMargin',
			'helpTooltipWidth',
			'helpTooltipMaxWidth',
			'helpTooltipPadding',
			'helpTooltipFontSize',
			'helpTooltipFontWeight',
			'helpTooltipLineHeight',
			'helpTooltipContentZIndex',
		])
	})

	it('satisfies the Settings type', () => {
		const configuredSettings: Settings = settings
		expect(configuredSettings).toBe(settings)
	})
})
