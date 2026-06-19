'use strict'

import { describe, it, expect } from 'vitest'
import { colorPalette, settings, type Settings } from '$src/settings.ts'

// Testing rule: assert config shape and ownership, not exact values.
// This file protects against structural regressions while letting teams tune UI constants
// (colors, spacing, durations, radii) without forcing unnecessary test churn.

type UnknownRecord = Record<string, unknown>

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

function expectOwnKeys(value: UnknownRecord, keys: string[], path: string): void {
	for (const key of keys) {
		expect(Object.hasOwn(value, key), `${path} should expose ${key}`).toBe(true)
	}
}

function expectNoOwnKeys(value: Record<string, unknown>, keys: string[]): void {
	for (const key of keys) {
		expect(Object.hasOwn(value, key), `settings object should not expose stale key: ${key}`).toBe(false)
	}
}

function expectStringLeaf(value: unknown, path: string): void {
	expect(
		['string', 'number'].includes(typeof value),
		`${path} should be a style token-compatible leaf (${typeof value})`,
	).toBe(true)
}

function expectLeafValuePaths(value: unknown, path = ''): void {
	if (Array.isArray(value)) {
		expect(value.length).toBeGreaterThan(0, `${path} should be a non-empty array`)
		value.forEach((item, index) => expectLeafValuePaths(item, `${path}[${index}]`))
		return
	}

	if (!value || typeof value !== 'object') {
		expectStringLeaf(value, path)
		return
	}

	for (const [key, nested] of Object.entries(value)) {
		expectLeafValuePaths(nested, path ? `${path}.${key}` : key)
	}
}

function expectFiniteNumber(value: unknown, path: string): void {
	expect(typeof value).toBe('number', `${path} should be a number`)
	expect(Number.isFinite(value), `${path} should be a finite number`).toBe(true)
}

// =============================================================================
// CONSOLIDATED SETTINGS
// =============================================================================

describe('settings - grouped configuration', () => {
	it('exports expected sections and avoids getter-based static config', () => {
		const topLevelSettingsSections = [
			'modelSelectorDropdown',
			'dropdown',
			'gradient',
			'helpTooltip',
			'canvasBubbleMenu',
			'aiChatThread',
			'aiPromptInput',
			'connector',
			'selection',
			'mediaNode',
			'videoControls',
			'imageBranchLineage',
			'mediaLibrary',
			'contentDescriptor',
		]

		expectOwnKeys(settings, topLevelSettingsSections, 'settings')
		expect(collectGetterPaths(settings)).toEqual([])
	})

	it('stores palette values as editable tokens', () => {
		const paletteKeys = Object.keys(colorPalette)

		expect(paletteKeys.length).toBeGreaterThan(0)
		for (const key of paletteKeys) {
			const token = colorPalette[key as keyof typeof colorPalette]
			expectStringLeaf(token, `colorPalette.${key}`)
		}
	})

	it('keeps scalar UI settings finite and numerically valid', () => {
		expectFiniteNumber(settings.aiChatThread.defaultDimensions.width, 'settings.aiChatThread.defaultDimensions.width')
		expectFiniteNumber(settings.aiChatThread.defaultDimensions.height, 'settings.aiChatThread.defaultDimensions.height')
		expectFiniteNumber(settings.aiChatThread.adjacentNodeGap, 'settings.aiChatThread.adjacentNodeGap')
		expectFiniteNumber(settings.aiChatThread.panelTabs.minTabWidth, 'settings.aiChatThread.panelTabs.minTabWidth')
		expectFiniteNumber(settings.aiChatThread.panelTabs.height, 'settings.aiChatThread.panelTabs.height')
		expectFiniteNumber(
			settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor,
			'settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor',
		)
		expectFiniteNumber(settings.aiChatThread.rail.offset, 'settings.aiChatThread.rail.offset')
		expectFiniteNumber(settings.aiChatThread.rail.edgeMargin, 'settings.aiChatThread.rail.edgeMargin')
		expectFiniteNumber(settings.aiChatThread.rail.minSlideHeight, 'settings.aiChatThread.rail.minSlideHeight')
		expectFiniteNumber(settings.aiChatThread.rail.dragGrabWidth, 'settings.aiChatThread.rail.dragGrabWidth')
		expectFiniteNumber(settings.helpTooltip.interactiveHideDelayMs, 'settings.helpTooltip.interactiveHideDelayMs')
		expectFiniteNumber(settings.connector.proximityConnectThreshold, 'settings.connector.proximityConnectThreshold')
		expectFiniteNumber(settings.connector.menuConnectionSnapRadius, 'settings.connector.menuConnectionSnapRadius')
		expectFiniteNumber(settings.connector.scaling.strokeWidth, 'settings.connector.scaling.strokeWidth')
		expectFiniteNumber(settings.connector.scaling.markerSize, 'settings.connector.scaling.markerSize')
		expectFiniteNumber(settings.connector.scaling.markerOffset.source, 'settings.connector.scaling.markerOffset.source')
		expectFiniteNumber(settings.connector.scaling.markerOffset.target, 'settings.connector.scaling.markerOffset.target')
		expectFiniteNumber(settings.connector.scaling.clickAreaWidth, 'settings.connector.scaling.clickAreaWidth')
		expectFiniteNumber(settings.connector.scaling.zoomScaling.minZoom, 'settings.connector.scaling.zoomScaling.minZoom')
		expectFiniteNumber(settings.canvasBubbleMenu.zoomScaling.minZoom, 'settings.canvasBubbleMenu.zoomScaling.minZoom')
		expectFiniteNumber(settings.mediaNode.generatedMediaChrome.iconSize, 'settings.mediaNode.generatedMediaChrome.iconSize')
		expectFiniteNumber(settings.mediaNode.generatedMediaChrome.topGap, 'settings.mediaNode.generatedMediaChrome.topGap')
		expectFiniteNumber(settings.mediaNode.generatedMediaChrome.zoomScaling.minZoom, 'settings.mediaNode.generatedMediaChrome.zoomScaling.minZoom')
		expectFiniteNumber(settings.mediaNode.resizeHandle.size, 'settings.mediaNode.resizeHandle.size')
		expectFiniteNumber(settings.mediaNode.resizeHandle.offset, 'settings.mediaNode.resizeHandle.offset')
		expectFiniteNumber(settings.mediaNode.resizeHandle.minSize, 'settings.mediaNode.resizeHandle.minSize')
		expectFiniteNumber(settings.mediaNode.resizeHandle.zoomScaling.minZoom, 'settings.mediaNode.resizeHandle.zoomScaling.minZoom')
		expectFiniteNumber(settings.mediaNode.image.defaultInsertionWidth, 'settings.mediaNode.image.defaultInsertionWidth')
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.radius,
			'settings.mediaNode.inProgressOutlineAnimation.radius',
		)
		expectFiniteNumber(settings.mediaNode.inProgressOutlineAnimation.gap, 'settings.mediaNode.inProgressOutlineAnimation.gap')
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale,
			'settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.snakeWidth,
			'settings.mediaNode.inProgressOutlineAnimation.snakeWidth',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.snakeTailWidthFraction,
			'settings.mediaNode.inProgressOutlineAnimation.snakeTailWidthFraction',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.snakeTailThinLengthFraction,
			'settings.mediaNode.inProgressOutlineAnimation.snakeTailThinLengthFraction',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.snakeWidthTaperPower,
			'settings.mediaNode.inProgressOutlineAnimation.snakeWidthTaperPower',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.snakeLengthFraction,
			'settings.mediaNode.inProgressOutlineAnimation.snakeLengthFraction',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.snakeHeadRoundLengthFraction,
			'settings.mediaNode.inProgressOutlineAnimation.snakeHeadRoundLengthFraction',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.animationDurationMs,
			'settings.mediaNode.inProgressOutlineAnimation.animationDurationMs',
		)
		expectFiniteNumber(
			settings.mediaNode.inProgressOutlineAnimation.zoomScaling.minZoom,
			'settings.mediaNode.inProgressOutlineAnimation.zoomScaling.minZoom',
		)
		expectFiniteNumber(settings.imageBranchLineage.generatedImageSize, 'settings.imageBranchLineage.generatedImageSize')
		expectFiniteNumber(settings.imageBranchLineage.rootOutputGap, 'settings.imageBranchLineage.rootOutputGap')
		expectFiniteNumber(settings.imageBranchLineage.branchToBranchGap, 'settings.imageBranchLineage.branchToBranchGap')
		expectFiniteNumber(settings.imageBranchLineage.imageToImageGap, 'settings.imageBranchLineage.imageToImageGap')
		expectFiniteNumber(settings.imageBranchLineage.branchFanoutDepthGap, 'settings.imageBranchLineage.branchFanoutDepthGap')
		expectFiniteNumber(settings.imageBranchLineage.branchOrigin.size, 'settings.imageBranchLineage.branchOrigin.size')
		expectFiniteNumber(settings.imageBranchLineage.branchOrigin.iconSize, 'settings.imageBranchLineage.branchOrigin.iconSize')
		expectFiniteNumber(settings.mediaLibrary.panelWidthFraction, 'settings.mediaLibrary.panelWidthFraction')
		expectFiniteNumber(settings.contentDescriptor.editDebounceMs, 'settings.contentDescriptor.editDebounceMs')
		expectFiniteNumber(settings.contentDescriptor.minTextLength, 'settings.contentDescriptor.minTextLength')
		expectFiniteNumber(settings.aiChatThread.panelTabs.transitionDurationMs, 'settings.aiChatThread.panelTabs.transitionDurationMs')
		expectFiniteNumber(
			settings.aiChatThread.panelTabs.transitionMinDurationMs,
			'settings.aiChatThread.panelTabs.transitionMinDurationMs',
		)
	})

	it('keeps all feature flags as booleans', () => {
		const booleanEntries = [
			['modelSelectorDropdown.useModalityFilter', settings.modelSelectorDropdown.useModalityFilter],
			['aiChatThread.showHeader', settings.aiChatThread.showHeader],
			['aiChatThread.useShiftingGradientBackground', settings.aiChatThread.useShiftingGradientBackground],
			['aiPromptInput.useShiftingGradientBackground', settings.aiPromptInput.useShiftingGradientBackground],
			['mediaNode.useZoomCompensatedResizeHandleScaling', settings.mediaNode.useZoomCompensatedResizeHandleScaling],
			['connector.useZoomCompensatedScaling', settings.connector.useZoomCompensatedScaling],
		]

		for (const [path, value] of booleanEntries) {
			expect(typeof value, `${path} should be boolean`).toBe('boolean')
		}
	})

	it('keeps style buckets containing style tokens and design scalars', () => {
		expectFiniteNumber(settings.gradient.styles.shiftingColors.length, 'settings.gradient.styles.shiftingColors.length')
		expect(settings.gradient.styles.shiftingColors.length, 'settings.gradient.styles.shiftingColors.length').toBe(4)

		const styleGroups = {
			'settings.dropdown.styles': settings.dropdown.styles,
			'settings.aiChatThread.styles': settings.aiChatThread.styles,
			'settings.aiPromptInput.modelMenu.styles': settings.aiPromptInput.modelMenu.styles,
			'settings.aiChatThread.panelTabs.styles': settings.aiChatThread.panelTabs.styles,
			'settings.aiChatThread.rail.styles': settings.aiChatThread.rail.styles,
			'settings.aiChatThread.sessionHistory.styles': settings.aiChatThread.sessionHistory.styles,
			'settings.aiChatThread.contextPreview.styles': settings.aiChatThread.contextPreview.styles,
			'settings.connector.styles': settings.connector.styles,
			'settings.selection.styles': settings.selection.styles,
			'settings.mediaNode.styles': settings.mediaNode.styles,
			'settings.mediaNode.generatedMediaChrome.styles': settings.mediaNode.generatedMediaChrome.styles,
			'settings.mediaNode.inProgressOutlineAnimation.styles': settings.mediaNode.inProgressOutlineAnimation.styles,
			'settings.imageBranchLineage.branchOrigin.styles': settings.imageBranchLineage.branchOrigin.styles,
		}

		for (const [path, group] of Object.entries(styleGroups)) {
			expect(typeof group, `${path} should be object`).toBe('object')
			expectLeafValuePaths(group, path)
		}
	})

	it('keeps video controls scalar values numerically valid', () => {
		const videoControlNumbers = [
			['videoControls.height', settings.videoControls.height],
			['videoControls.canvas.horizontalInset', settings.videoControls.canvas.horizontalInset],
			['videoControls.canvas.compactHorizontalInset', settings.videoControls.canvas.compactHorizontalInset],
			['videoControls.canvas.compactWidthThreshold', settings.videoControls.canvas.compactWidthThreshold],
			['videoControls.canvas.bottomInset', settings.videoControls.canvas.bottomInset],
			['videoControls.canvas.zoomScaling.minZoom', settings.videoControls.canvas.zoomScaling.minZoom],
			['videoControls.chat.horizontalInset', settings.videoControls.chat.horizontalInset],
			['videoControls.chat.bottomInset', settings.videoControls.chat.bottomInset],
			['videoControls.chat.controlsScale', settings.videoControls.chat.controlsScale],
			['videoControls.chat.minWidth', settings.videoControls.chat.minWidth],
			['videoControls.chat.fallbackWidth', settings.videoControls.chat.fallbackWidth],
			['videoControls.layout.padding', settings.videoControls.layout.padding],
			['videoControls.layout.gap', settings.videoControls.layout.gap],
			['videoControls.layout.buttonSize', settings.videoControls.layout.buttonSize],
			['videoControls.layout.iconSize', settings.videoControls.layout.iconSize],
			['videoControls.layout.barRadius', settings.videoControls.layout.barRadius],
			['videoControls.layout.buttonRadius', settings.videoControls.layout.buttonRadius],
			['videoControls.layout.railHeight', settings.videoControls.layout.railHeight],
			['videoControls.layout.scrubberHandleRadius', settings.videoControls.layout.scrubberHandleRadius],
			['videoControls.layout.volumeHandleRadius', settings.videoControls.layout.volumeHandleRadius],
			['videoControls.layout.backgroundHighlightInset', settings.videoControls.layout.backgroundHighlightInset],
			['videoControls.layout.timeWidth', settings.videoControls.layout.timeWidth],
			['videoControls.layout.speedSliderWidth', settings.videoControls.layout.speedSliderWidth],
			['videoControls.layout.compactSpeedSliderWidth', settings.videoControls.layout.compactSpeedSliderWidth],
			['videoControls.layout.speedSliderMinWidth', settings.videoControls.layout.speedSliderMinWidth],
			['videoControls.layout.speedValueWidth', settings.videoControls.layout.speedValueWidth],
			['videoControls.layout.speedValueSliderGap', settings.videoControls.layout.speedValueSliderGap],
			['videoControls.layout.volumeSliderWidth', settings.videoControls.layout.volumeSliderWidth],
			['videoControls.layout.volumeSliderMinWidth', settings.videoControls.layout.volumeSliderMinWidth],
			['videoControls.layout.minSeekWidth', settings.videoControls.layout.minSeekWidth],
			['videoControls.layout.speedScaleTickHeight', settings.videoControls.layout.speedScaleTickHeight],
			['videoControls.typography.timeFontSize', settings.videoControls.typography.timeFontSize],
			['videoControls.typography.timeFontWeight', settings.videoControls.typography.timeFontWeight],
			['videoControls.speed.minRate', settings.videoControls.speed.minRate],
			['videoControls.speed.maxRate', settings.videoControls.speed.maxRate],
			['videoControls.speed.pointerStep', settings.videoControls.speed.pointerStep],
			['videoControls.speed.keyboardStep', settings.videoControls.speed.keyboardStep],
			['videoControls.speed.displayPrecision', settings.videoControls.speed.displayPrecision],
			['videoControls.speed.defaultRate', settings.videoControls.speed.defaultRate],
			['videoControls.speed.guideRate', settings.videoControls.speed.guideRate],
			['videoControls.responsive.speedSliderMinResponsiveWidth', settings.videoControls.responsive.speedSliderMinResponsiveWidth],
			['videoControls.responsive.speedSliderFullResponsiveWidth', settings.videoControls.responsive.speedSliderFullResponsiveWidth],
			['videoControls.responsive.volumeSliderMinResponsiveWidth', settings.videoControls.responsive.volumeSliderMinResponsiveWidth],
			['videoControls.responsive.volumeSliderFullResponsiveWidth', settings.videoControls.responsive.volumeSliderFullResponsiveWidth],
			['videoControls.styles.backgroundStrokeWidth', settings.videoControls.styles.backgroundStrokeWidth],
			['videoControls.styles.glassHighlightStrokeWidth', settings.videoControls.styles.glassHighlightStrokeWidth],
			['videoControls.styles.liquidGlassFilter.displacementScale', settings.videoControls.styles.liquidGlassFilter.displacementScale],
			['videoControls.styles.liquidGlassFilter.numOctaves', settings.videoControls.styles.liquidGlassFilter.numOctaves],
			['videoControls.styles.liquidGlassFilter.seed', settings.videoControls.styles.liquidGlassFilter.seed],
			['videoControls.styles.speedScaleTickWidth', settings.videoControls.styles.speedScaleTickWidth],
		] as const

		for (const [path, value] of videoControlNumbers) {
			expectFiniteNumber(value, path)
		}

		expect(Array.isArray(settings.videoControls.speed.guideRates), 'videoControls.speed.guideRates should be an array').toBe(true)
		for (let index = 0; index < settings.videoControls.speed.guideRates.length; index += 1) {
			expectFiniteNumber(settings.videoControls.speed.guideRates[index], `videoControls.speed.guideRates[${index}]`)
		}

		expect(settings.videoControls.speed.guideRates.length).toBeGreaterThan(0)
		expect(settings.mediaLibrary.panelWidthFraction, 'settings.mediaLibrary.panelWidthFraction').toBeGreaterThan(0)
		expect(settings.mediaLibrary.panelWidthFraction, 'settings.mediaLibrary.panelWidthFraction').toBeLessThan(1)
	})

	it('keeps migrated keys nested, not duplicated at stale roots', () => {
		expectNoOwnKeys(settings.dropdown, ['popoverBoxShadow'])
		expectNoOwnKeys(settings.gradient, ['shiftingColors'])
		expectNoOwnKeys(settings.aiChatThread, [
			'responseMessageBubbleColor',
			'nodeBoxShadow',
			'nodeBorder',
			'panelSectionDividerBorder',
		])
		expectNoOwnKeys(settings.aiChatThread.panelTabs, ['activeTabBoxShadow', 'activeTabInsetShadow'])
		expectNoOwnKeys(settings.aiChatThread.rail, ['gradient', 'width', 'boundaryCircleColors'])
		expectNoOwnKeys(settings.connector, ['lineDefaultColor', 'lineFocusColor', 'lineClickAreaWidth'])
		expectNoOwnKeys(settings.selection, [
			'marqueeBorderColor',
			'marqueeBackgroundColor',
			'overlayBorderColor',
			'overlayBackgroundColor',
			'outlineColor',
		])
		expectNoOwnKeys(settings.mediaNode.image, ['defaultBoxShadow', 'selectedBoxShadow', 'borderRadius', 'modelBadgeBoxShadow'])
		expectNoOwnKeys(settings.mediaNode, ['generationBorder'])
		expectNoOwnKeys(settings.mediaNode.inProgressOutlineAnimation, ['trackColor', 'trackAlpha', 'snakeTailAlpha', 'snakeColors'])
	})

	it('keeps model menu style controls isolated from legacy layout props', () => {
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
