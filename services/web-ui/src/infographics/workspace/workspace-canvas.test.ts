'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// HELPERS
// =============================================================================

const sourceFileNames = new Map<string, string>()

function readSourceFile(relativePath: string, displayName = relativePath): string {
	const source = readFileSync(
		resolve(__dirname, relativePath),
		'utf-8'
	)
	sourceFileNames.set(source, displayName)
	return source
}

function sourceName(source: string): string {
	return sourceFileNames.get(source) ?? 'source excerpt'
}

function expectSourceToContain(source: string, snippet: string): void {
	expect(
		source.includes(snippet),
		`${sourceName(source)} should contain:\n${snippet}`
	).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
	expect(
		source.includes(snippet),
		`${sourceName(source)} should not contain:\n${snippet}`
	).toBe(false)
}

function expectExcerptToContain(excerpt: string, snippet: string, label = 'source excerpt'): void {
	expect(
		excerpt.includes(snippet),
		`${label} should contain:\n${snippet}`
	).toBe(true)
}

function expectExcerptNotToContain(excerpt: string, snippet: string, label = 'source excerpt'): void {
	expect(
		excerpt.includes(snippet),
		`${label} should not contain:\n${snippet}`
	).toBe(false)
}

function loadScss(): string {
	return readSourceFile('workspace-canvas.scss')
}

function loadTs(): string {
	return readSourceFile('WorkspaceCanvas.ts')
}

function loadPixiMediaLayer(): string {
	return readSourceFile('pixiMediaLayer.ts')
}

function loadViewportBridge(): string {
	return readSourceFile('rendering/viewportBridge.ts', 'rendering/viewportBridge.ts')
}

function loadPixiTravelingOutlineRenderer(): string {
	return readSourceFile('../../../packages/lixpi/canvas-engine/src/frontend/rendering/progress/pixiTravelingOutlineRenderer.ts', 'packages/lixpi/canvas-engine/src/frontend/rendering/progress/pixiTravelingOutlineRenderer.ts')
}

function loadWorkspaceLoadingOutline(): string {
	return readSourceFile('workspaceLoadingOutline.ts')
}

function loadWorkspaceCanvasSvelte(): string {
	return readSourceFile('../../components/WorkspaceCanvas.svelte', 'components/WorkspaceCanvas.svelte')
}

function loadCanvasMembershipStateRebase(): string {
	return readSourceFile('canvasMembershipStateRebase.ts')
}

function loadContextPreview(): string {
	return readSourceFile('../../components/contextPreview/contextPreview.ts', 'components/contextPreview/contextPreview.ts')
}

function loadAiInteractionService(): string {
	return readSourceFile('../../services/ai-interaction-service.ts', 'services/ai-interaction-service.ts')
}

function loadAiChatThreadPlugin(): string {
	return readSourceFile('../../components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts', 'components/proseMirror/plugins/aiChatThreadPlugin/aiChatThreadPlugin.ts')
}

function loadAiGeneratedImageNode(): string {
	return readSourceFile('../../components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts', 'components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedImageNode.ts')
}

function loadAiGeneratedMediaCanvasRouter(): string {
	return readSourceFile('../../components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedMediaCanvasRouter.ts', 'components/proseMirror/plugins/aiChatThreadPlugin/aiGeneratedMediaCanvasRouter.ts')
}

function loadAiPromptComposer(): string {
	return readSourceFile('../../components/proseMirror/aiPromptComposer.ts', 'components/proseMirror/aiPromptComposer.ts')
}

function loadSidePanel(): string {
	return readSourceFile('../../../packages/lixpi/ui-kit/src/components/sidePanel/sidePanel.ts', 'packages/lixpi/ui-kit/src/components/sidePanel/sidePanel.ts')
}

function loadSidePanelScss(): string {
	return readSourceFile('../../../packages/lixpi/ui-kit/src/components/sidePanel/side-panel.scss', 'packages/lixpi/ui-kit/src/components/sidePanel/side-panel.scss')
}

function loadLayout(): string {
	return readSourceFile('../../views/layouts/layout.svelte', 'views/layouts/layout.svelte')
}

function loadNavigationSidePanel(): string {
	return readSourceFile('../../components/navigationSidePanel/navigationSidePanel.ts', 'components/navigationSidePanel/navigationSidePanel.ts')
}

function loadNavigationSidePanelScss(): string {
	return readSourceFile('../../components/navigationSidePanel/navigation-side-panel.scss', 'components/navigationSidePanel/navigation-side-panel.scss')
}

function loadSettings(): string {
	return readSourceFile('../../settings.ts', 'settings.ts')
}

function loadSvgIcons(): string {
	return readSourceFile('../../../packages/lixpi/ui-kit/src/svg/svgIcons.ts', 'ui-kit/svg/svgIcons.ts')
}

function extractBlock(scss: string, selector: string): string {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const pattern = new RegExp(`${escapedSelector}\\s*\\{`)
	const match = pattern.exec(scss)
	if (!match) return ''

	let depth = 0
	let start = match.index + match[0].length
	let end = start

	for (let i = start; i < scss.length; i++) {
		if (scss[i] === '{') depth++
		if (scss[i] === '}') {
			if (depth === 0) {
				end = i
				break
			}
			depth--
		}
	}

	return scss.slice(match.index, end + 1)
}

function extractBlockContainingSelector(scss: string, selector: string): string {
	const selectorIndex = scss.indexOf(selector)
	if (selectorIndex === -1) return ''

	const openIndex = scss.indexOf('{', selectorIndex)
	if (openIndex === -1) return ''

	let depth = 0
	let end = openIndex

	for (let i = openIndex + 1; i < scss.length; i++) {
		if (scss[i] === '{') depth++
		if (scss[i] === '}') {
			if (depth === 0) {
				end = i
				break
			}
			depth--
		}
	}

	return scss.slice(selectorIndex, end + 1)
}

function extractBoxShadowValues(block: string): string[] {
	const matches = [...block.matchAll(/box-shadow:\s*([^;]+);/g)]
	return matches.map(m => m[1].trim())
}

function extractFunctionBody(source: string, functionName: string): string {
	const functionIndex = source.indexOf(`function ${functionName}`)
	if (functionIndex === -1) return ''

	const signatureCloseIndex = source.indexOf(')', functionIndex)
	if (signatureCloseIndex === -1) return ''

	const openIndex = source.indexOf('{', signatureCloseIndex)
	if (openIndex === -1) return ''

	let depth = 0
	let endIndex = openIndex

	for (let i = openIndex + 1; i < source.length; i++) {
		if (source[i] === '{') depth++
		if (source[i] === '}') {
			if (depth === 0) {
				endIndex = i
				break
			}
			depth--
		}
	}

	return source.slice(functionIndex, endIndex + 1)
}

describe('Capability Artifact generated-output chrome parity', () => {
	it('uses the same metadata panel, editable metadata, and Asset details contract as generated media', () => {
		const ts = loadTs()
		const infoPanel = extractFunctionBody(ts, 'createCapabilityArtifactInfoPanelChrome')

		expectExcerptToContain(
			infoPanel,
			'canvas-generated-media-info-panel canvas-generated-media-metadata-panel nopan',
			'createCapabilityArtifactInfoPanelChrome',
		)
		expectExcerptToContain(
			infoPanel,
			"mountAssetMetadataEditor(node, metadataEditorMount, 'details')",
			'createCapabilityArtifactInfoPanelChrome',
		)
		expectExcerptToContain(
			infoPanel,
			'const assetDetails = createAssetDetailsSection(node)',
			'createCapabilityArtifactInfoPanelChrome',
		)
	})
})

describe('Workspace canvas — durable media request recovery and identity', () => {
	const ts = loadTs()
	const identityControl = readSourceFile('assetSubjectIdentityControl.ts')
	const library = readSourceFile('mediaLibraryPanel.ts')

	it('uses the scope selector dropdown for all five subject identity options in both Asset surfaces', () => {
		expectSourceToContain(identityControl, "{ title: 'Unknown', value: 'unknown'")
		expectSourceToContain(identityControl, "{ title: 'No person', value: 'no-person'")
		expectSourceToContain(identityControl, "{ title: 'Fictional', value: 'fictional'")
		expectSourceToContain(identityControl, "{ title: 'Me', value: 'self'")
		expectSourceToContain(identityControl, "{ title: 'Authorized', value: 'authorized-real-person'")
		expectSourceToContain(identityControl, 'this.dropdown = createPureDropdown({')
		expectSourceToContain(identityControl, "theme: 'dark'")
		expectSourceToContain(identityControl, 'ignoreColorValuesForOptions: true')
		expectSourceToContain(identityControl, 'ignoreColorValuesForSelectedValue: true')
		expectSourceToContain(identityControl, 'renderIconForSelectedValue: false')
		expectSourceToContain(identityControl, 'renderIconForOptions: false')
		expectSourceToContain(identityControl, 'mountToBody: false')
		expectSourceToContain(identityControl, 'disableAutoPositioning: true')
		expectSourceToContain(identityControl, 'this.assetService.attestSubjectIdentity(')
		expectSourceToContain(identityControl, 'requestedAssetId,')
		expectSourceToContain(identityControl, 'this.currentAsset.revision,')
		expectSourceToContain(identityControl, 'nextClassification,')
		expectSourceToContain(identityControl, 'this.syncSelectedClassification(previousClassification)')
		expectSourceNotToContain(identityControl, 'createSlidingSwitch')
		expectSourceToContain(ts, 'mountAssetSubjectIdentityControl({')
		expectSourceToContain(library, 'mountAssetSubjectIdentityControl({')
		expectSourceNotToContain(identityControl, 'modal')
	})

	it('subscribes live before replay and deduplicates stream sequences after reload', () => {
		const recovery = extractFunctionBody(ts, 'ensureMediaGenerationOperationRecovery')
		expect(recovery.indexOf("servicesStore.getData('nats')!.subscribe(result.liveSubject")).toBeGreaterThan(-1)
		expect(recovery.indexOf('return replayMediaGenerationRequest({')).toBeGreaterThan(
			recovery.indexOf("servicesStore.getData('nats')!.subscribe(result.liveSubject")
		)
		expectExcerptToContain(recovery, 'if (seenSequences.has(envelope.streamSequence)) return', 'operation recovery')
		expectExcerptToContain(recovery, 'applyRecoveredMediaGenerationRequest(result.request)', 'operation recovery')
		expectExcerptToContain(recovery, 'applyRecoveredMediaGenerationRequestEvent(envelope.event)', 'operation recovery')
		expectExcerptToContain(recovery, 'applyRecoveredMediaGenerationRequest(replay.request)', 'operation recovery')
		expectExcerptToContain(recovery, 'if (seenSequences.has(envelope.streamSequence)) continue', 'operation recovery')
		expectExcerptNotToContain(recovery, 'loadWorkspaceRouteData(workspaceId)', 'operation recovery')
	})

	it('replaces terminal partial media with the live failure card without a workspace reload', () => {
		const recovery = extractFunctionBody(ts, 'applyMediaOperationRecoveryResult')
		expectExcerptToContain(recovery, 'rebalanceGeneratedMediaTrees(result.state.nodes, result.state.edges)', 'failure recovery')
		expectExcerptToContain(recovery, 'commitTransientCanvasStatePreservingEditors({ ...result.state, nodes: rebalancedNodes })', 'failure recovery')
		expectExcerptToContain(recovery, 'syncCanvasNodeDomGeometry(', 'failure recovery')
		expectExcerptToContain(recovery, 'removeApiCanvasRemovedNodesFromDOM(result.removedNodeIds)', 'failure recovery')
		expectExcerptToContain(recovery, "updatedNode?.type === 'operationStatus'", 'failure recovery')
		expectExcerptToContain(recovery, '...replacedGeneratedMediaNodeIds', 'failure recovery')
		expectExcerptToContain(recovery, 'pixiMediaLayer?.setTransientImageSource(nodeId, null)', 'failure recovery')
		expectExcerptToContain(recovery, 'syncExistingOperationStatusNodeToDOM(updatedNode)', 'failure recovery')
		expectExcerptToContain(recovery, 'scheduleGeneratedMediaChromeSync()', 'failure recovery')
		expectExcerptNotToContain(recovery, 'loadWorkspaceRouteData(workspaceId)', 'failure recovery')
	})

	it('attaches reference ambiguity to the submitted prompt with canonical Asset references', () => {
		const markerContent = extractFunctionBody(ts, 'createBranchMarkerContent')
		const referenceResolution = extractFunctionBody(ts, 'createBranchMarkerReferenceResolution')
		const screenPlacement = extractFunctionBody(ts, 'syncPendingBranchMarkerScreenPlacements')
		const resolutionStyles = extractBlock(loadScss(), '.workspace-branch-reference-resolution')
		expectSourceToContain(ts, 'if (isMediaGenerationReferenceResolutionOperation(node)) return false')
		expectExcerptToContain(markerContent, 'getMediaGenerationReferenceResolutionForMarker(currentCanvasState.nodes, node)', 'branch marker content')
		expectExcerptToContain(markerContent, '${referenceResolution}', 'branch marker content')
		expectExcerptToContain(referenceResolution, 'renderBranchMarkerPromptParts([{', 'reference resolution')
		expectExcerptToContain(referenceResolution, "referenceType: 'media'", 'reference resolution')
		expectExcerptToContain(referenceResolution, 'resolveMediaGenerationReference({', 'reference resolution')
		expectExcerptNotToContain(referenceResolution, '<button', 'reference resolution')
		expectExcerptToContain(screenPlacement, 'getMediaGenerationReferenceResolutionOwner(', 'reference resolution placement')
		expectExcerptToContain(screenPlacement, '...referenceResolutionOwners,', 'reference resolution placement')
		expectExcerptToContain(resolutionStyles, 'right: 0', 'reference resolution styles')
		expectExcerptToContain(resolutionStyles, 'bottom: calc(100% + 7px)', 'reference resolution styles')
		expectSourceNotToContain(ts, 'workspace-media-operation-candidate')
	})

	it('renders provider verification, failure, edit, cancel, and dismiss actions', () => {
		expectSourceToContain(ts, "addActionButton('Verify with provider'")
		expectSourceToContain(ts, "addActionButton('Cancel'")
		expectSourceToContain(ts, "addActionButton('Edit request'")
		expectSourceToContain(ts, 'response.checkpoint.selectedReferences.flatMap')
		expectSourceToContain(ts, 'addContextChips(restoredContextNodeIds)')
		expectSourceToContain(ts, "addActionButton('Dismiss'")
		expectSourceToContain(ts, 'node.problem.providerReason ?? node.problem.detail')
	})
})

function extractNodeElClickHandler(source: string): string {
	const listener = "nodeEl.addEventListener('click',"
	const listenerIndex = source.indexOf(listener)
	if (listenerIndex === -1) return ''

	const callbackStart = source.indexOf('(e) => {', listenerIndex)
	if (callbackStart === -1) return ''

	const openIndex = source.indexOf('{', callbackStart)
	if (openIndex === -1) return ''

	let depth = 0
	let endIndex = openIndex

	for (let i = openIndex + 1; i < source.length; i++) {
		if (source[i] === '{') depth++
		if (source[i] === '}') {
			if (depth === 0) {
				endIndex = i
				break
			}
			depth--
		}
	}

	return source.slice(listenerIndex, endIndex + 1)
}

// =============================================================================
// workspace-image-node — consistent box-shadow
// =============================================================================

describe('workspace node CSS — box-shadow consistency', () => {
	const scss = loadScss()
	const docNodeBlock = extractBlock(scss, '.workspace-document-node')
	const imageNodeBlock = extractBlock(scss, '.workspace-image-node')

	it('.workspace-document-node has exactly one box-shadow (base only)', () => {
		const allShadows = extractBoxShadowValues(docNodeBlock)
		expect(allShadows).toHaveLength(1)
		expect(allShadows[0]).not.toBe('none')
	})

	it('no hover box-shadow override on any node', () => {
		const hoverDocBlock = extractBlock(docNodeBlock, '&:hover')
		expect(extractBoxShadowValues(hoverDocBlock)).toHaveLength(0)

		const hoverImgBlock = extractBlock(imageNodeBlock, '&:hover')
		expect(extractBoxShadowValues(hoverImgBlock)).toHaveLength(0)
	})

	it('keeps document selected/focus styling from adding box-shadow', () => {
		expect(docNodeBlock).not.toMatch(/is-selected[\s\S]*?box-shadow/)
		expect(docNodeBlock).not.toMatch(/focus-within[\s\S]*?box-shadow/)
	})

	it('no box-shadow transition on any node', () => {
		expectExcerptNotToContain(docNodeBlock, 'transition: box-shadow')
		expectExcerptNotToContain(docNodeBlock, 'transition:box-shadow')
	})

	it('.workspace-image-node base uses the theme-configured default box-shadow', () => {
		expect(imageNodeBlock).toMatch(/^\s*box-shadow:\s*var\(--workspace-media-node-default-box-shadow\);/m)
	})

	it('keeps generated media model chrome free of badge and button shadows', () => {
		const badgeBlock = extractBlock(scss, '.media-model-badge')
		const infoButtonBlock = extractBlock(scss, '.media-info-button')

		expect(extractBoxShadowValues(badgeBlock)).toHaveLength(0)
		expect(extractBoxShadowValues(infoButtonBlock)).toHaveLength(0)
	})

	it('uses a theme-configured shadow for selected image nodes', () => {
		const selectedBlock = extractBlockContainingSelector(imageNodeBlock, '&.is-selected')
		expectExcerptToContain(selectedBlock, 'box-shadow: var(--workspace-media-node-selected-box-shadow)', 'selected image selector block')
		expectExcerptNotToContain(selectedBlock, 'outline:', 'selected image selector block')
	})

	it('renders generated media icon chrome with bounded screen-space zoom scaling', () => {
		const ts = loadTs()
		const chromeLayerBlock = extractBlock(scss, '.workspace-generated-media-chrome-layer')
		const actionsBlock = extractBlock(scss, '.workspace-generated-media-actions')
		const badgeBlock = extractBlock(scss, '.media-model-badge')
		const badgeIconBlock = extractBlockContainingSelector(scss, '.media-model-badge-icon,\n.media-model-badge svg')
		const infoButtonBlock = extractBlock(scss, '.media-info-button')
		const infoIconBlock = extractBlock(infoButtonBlock, 'svg')
		const panelBlock = extractBlock(scss, '.canvas-generated-media-info-panel')
		const traceDetailsBlock = extractBlock(scss, '.canvas-generated-media-projection-editor .canvas-generated-media-trace-details')
		const promptAndFinalFallbackBlock = scss.match(
			/\.canvas-generated-media-projection-editor \.ai-image-generation-tool-prompt-fallback,[\s\S]*?\.canvas-generated-media-projection-editor \.ai-image-generation-final-prompt \{[\s\S]*?\}/
		)?.[0] ?? ''
		const activeBlock = extractBlock(infoButtonBlock, '&.is-active')

		expectSourceToContain(ts, 'generatedMediaChromeLayerEl = createGeneratedMediaChromeLayer()')
		expectSourceToContain(ts, 'viewportOverlayEls: [mediaChromeViewportEl, generatedMediaInfoPanelLayerEl],')
		expectSourceNotToContain(ts, 'viewportOverlayEls: [mediaChromeViewportEl, generatedMediaChromeLayerEl]')
		expectSourceToContain(ts, 'getCanvasChromeScreenLayout({')
		expectSourceToContain(ts, 'baseGap: settings.mediaNode.generatedMediaChrome.gap,')
		expectSourceToContain(ts, 'zoomScaling: getAdaptiveBoundedZoomScalingOptions(settings.mediaNode.generatedMediaChrome.zoomScaling),')
		expectSourceToContain(ts, 'left: `${chromeLayout.left}px`,')
		expectSourceToContain(ts, 'top: `${chromeLayout.top + extraTopOffsetScreen}px`,')
		expectSourceToContain(ts, 'width: `${chromeLayout.layoutWidth}px`,')
		expectSourceToContain(ts, 'transform: `scale(${chromeLayout.screenScale})`,')
		expectSourceToContain(ts, 'getVisualScale: () => scaleCanvasChromeToScreenForZoom(')
		expectSourceToContain(ts, 'getAdaptiveBoundedZoomScalingOptions(settings.canvasBubbleMenu.zoomScaling),')
		expectSourceToContain(ts, 'scaleCanvasChromeToScreenForZoom(\n            settings.mediaNode.generatedMediaChrome.gap,')
		expectSourceToContain(ts, 'scaleCanvasChromeToScreenForZoom(\n            settings.mediaNode.generatedMediaChrome.iconSize,')
		expectSourceToContain(ts, 'const panelTop = position.y + dimensions.height + (extraTopOffsetScreen + iconStripScreenGap + iconScreenSize + iconStripScreenGap) / zoom')
		expectSourceToContain(ts, 'updateGeneratedMediaChromeLiveTransform(node.nodeId, position, dimensions, getLiveViewport())')
		expectSourceToContain(ts, 'updateGeneratedMediaChromeLayout()')
		expectSourceToContain(ts, 'generatedMediaChromeLayerEl.replaceChildren(')
		expectSourceToContain(ts, 'mediaChromeViewportEl.replaceChildren(')
		expectSourceToContain(ts, 'const modelId = getGeneratedMediaModelId(node)')
		expectSourceToContain(ts, 'const modelProvider = getGeneratedMediaModelProvider(node, modelId)')
		expectSourceToContain(ts, 'const modelBadge = createMediaModelBadge({ modelId, modelProvider })')
		expectSourceNotToContain(ts, 'LIXPI_ZOOM_SCALING_DEBUG')
		expectSourceNotToContain(ts, 'logGeneratedMediaChromeDebug')
		expectSourceNotToContain(ts, 'getDebugRect')
		expectSourceNotToContain(ts, 'getCanvasChromeZoomMultiplier')
		expectSourceNotToContain(ts, 'const localScale = scaleCanvasChromeForZoom(1, zoom)')
		expectSourceNotToContain(ts, 'getTransformedCanvasChromeLayout')
		expectSourceNotToContain(ts, 'zoom: getCurrentViewportZoom(),')
		expectSourceNotToContain(ts, 'zoom: number = getCurrentViewportZoom()')
		expectSourceNotToContain(ts, 'pendingGeneratedMediaChromeZoom')
		expectSourceNotToContain(ts, 'updateGeneratedMediaChromeZoomScaling')
		expectSourceNotToContain(ts, 'function getGeneratedMediaInfoWidth')
		expectExcerptToContain(chromeLayerBlock, 'position: absolute', 'generated media chrome layer block')
		expectExcerptToContain(chromeLayerBlock, 'inset: 0', 'generated media chrome layer block')
		expectExcerptToContain(chromeLayerBlock, 'pointer-events: none', 'generated media chrome layer block')
		expectExcerptToContain(actionsBlock, 'width: 100%', 'generated image actions block')
		expectExcerptToContain(actionsBlock, 'gap: 6px', 'generated image actions block')
		expectExcerptToContain(badgeBlock, 'height: var(--workspace-generated-media-chrome-icon-size, 34px)', 'image model badge block')
		expectExcerptToContain(badgeIconBlock, 'width: var(--workspace-generated-media-chrome-icon-size, 34px)', 'image model badge icon block')
		expectExcerptToContain(badgeIconBlock, 'height: var(--workspace-generated-media-chrome-icon-size, 34px)', 'image model badge icon block')
		expectExcerptNotToContain(badgeBlock, 'border:', 'image model badge block')
		expectExcerptNotToContain(badgeBlock, 'box-shadow:', 'image model badge block')
		expectExcerptToContain(infoButtonBlock, 'width: var(--workspace-generated-media-chrome-icon-size, 34px)', 'image info button block')
		expectExcerptToContain(infoButtonBlock, 'height: var(--workspace-generated-media-chrome-icon-size, 34px)', 'image info button block')
		expectExcerptToContain(infoButtonBlock, 'border: none', 'image info button block')
		expectExcerptToContain(infoIconBlock, 'width: 79.5918%', 'image info icon block')
		expectExcerptToContain(infoIconBlock, 'height: 79.5918%', 'image info icon block')
		expectExcerptNotToContain(infoIconBlock, 'transform:', 'image info icon block')
		expectExcerptToContain(activeBlock, 'color: var(--workspace-media-info-button-hover-color, #181e23)', 'active image info button block')
		expectExcerptToContain(activeBlock, 'background: transparent', 'active image info button block')
		expectExcerptNotToContain(activeBlock, '$steelBlue', 'active image info button block')
		expectExcerptNotToContain(activeBlock, 'border-color:', 'active image info button block')
		expectExcerptToContain(panelBlock, 'overflow: var(--workspace-generated-media-info-panel-overflow, visible)', 'generated image info panel block')
		expectExcerptNotToContain(panelBlock, 'max-height: 440px', 'generated image info panel block')
		expectExcerptNotToContain(panelBlock, 'overflow: auto', 'generated image info panel block')
		expectExcerptToContain(traceDetailsBlock, 'margin: 0.95rem 0 0', 'canvas trace details block')
		expect(promptAndFinalFallbackBlock).toContain('max-height: none')
		expect(promptAndFinalFallbackBlock).toContain('overflow: visible')
	})

})

// =============================================================================
// PIXI media layer — first sync geometry
// =============================================================================

describe('PIXI media layer — first sync geometry', () => {
	const ts = loadPixiMediaLayer()

	it('initializes new image sprite and placeholder geometry during first upsert', () => {
		const start = ts.indexOf('function upsertEntry')
		const end = ts.indexOf('function drawColorRect', start)
		expect(start).toBeGreaterThan(-1)
		expect(end).toBeGreaterThan(start)

		const fnBody = ts.slice(start, end)
		const creationIndex = fnBody.indexOf('if (!entry) {')
		const spritePositionIndex = fnBody.indexOf('entry.sprite.position.set(x, y)')
		const firstReturnAfterCreation = fnBody.indexOf('return', creationIndex)

		expect(creationIndex).toBeGreaterThan(-1)
		expect(spritePositionIndex).toBeGreaterThan(creationIndex)
		expect(firstReturnAfterCreation === -1 || firstReturnAfterCreation > spritePositionIndex).toBe(true)
		expectExcerptToContain(fnBody, 'entry.sprite.width = w')
		expectExcerptToContain(fnBody, 'entry.sprite.height = h')
		expectExcerptToContain(fnBody, 'entry.colorRect.position.set(x, y)')
		expectExcerptToContain(fnBody, 'syncSpriteMask(entry, x, y, w, h)')
		expectExcerptToContain(fnBody, 'drawColorRect(entry.colorRect, w, h)')
		expectExcerptToContain(fnBody, 'entry.colorRectW = w')
		expectExcerptToContain(fnBody, 'entry.colorRectH = h')
	})

	it('clips PIXI image sprites with the configured image border radius', () => {
		expectSourceToContain(ts, "import { settings } from '$src/settings.ts'")
		expectSourceToContain(ts, 'settings.mediaNode.styles.borderRadius')
		expectSourceToContain(ts, 'function getMediaNodeBorderRadius(width: number, height: number): number')
		expectSourceToContain(ts, 'sprite.mask = spriteMask')
		expectSourceToContain(ts, 'function syncSpriteMask(entry: PixiImageEntry')
		expectSourceToContain(ts, 'entry.spriteMask.roundRect(0, 0, width, height, radius)')
		expectSourceToContain(ts, 'entry.spriteMask.fill({ color: 0xffffff, alpha: 1 })')
	})

	it('supports optional fill for selection overlays', () => {
		expectSourceToContain(ts, 'type SelectionOverlayOptions = {')
		expectSourceToContain(ts, 'fill?: boolean')
		expectSourceToContain(ts, 'options: SelectionOverlayOptions = {}')
		expectSourceToContain(ts, 'if (options.fill !== false) groupOverlayGraphics.fill({ color: selectionColors.groupOverlayFill })')
		expectSourceToContain(ts, 'groupOverlayGraphics.stroke({ color: selectionColors.groupOverlayStroke')
	})

	it('reads in-progress outline animation tokens from geometry and style layers separately', () => {
		expectSourceToContain(ts, 'const inProgressOutlineAnimation = settings.mediaNode.inProgressOutlineAnimation')
		expectSourceToContain(ts, 'const inProgressOutlineAnimationStyles = inProgressOutlineAnimation.styles')
		expectSourceToContain(ts, 'radius: inProgressOutlineAnimation.radius')
		expectSourceToContain(ts, 'gap: inProgressOutlineAnimation.gap ?? 0')
		expectSourceToContain(ts, 'snakeHeadWidth: inProgressOutlineAnimation.snakeWidth')
		expectSourceToContain(ts, 'snakeTailWidthFraction: inProgressOutlineAnimation.snakeTailWidthFraction ?? 0.18')
		expectSourceToContain(ts, 'snakeTailAlpha: inProgressOutlineAnimationStyles.snakeTailAlpha')
		expectSourceToContain(ts, 'snakeColors: inProgressOutlineAnimationStyles.snakeColors')
		expectSourceToContain(ts, 'glassMaterial: inProgressOutlineAnimationStyles.glassMaterial')
		expectSourceNotToContain(ts, 'trackColor: generationBorderStyles.trackColor')
		expectSourceNotToContain(ts, 'segmentColors: generationBorder.snakeColors')
	})
})

// =============================================================================
// Generated image previews — PIXI-backed state and progress rendering
// =============================================================================

describe('Workspace canvas — generated image preview rendering', () => {
	const ts = loadTs()
	const scss = loadScss()

	it('commits progressive preview pixels through canvas state instead of a DOM image', () => {
		const partialStart = ts.indexOf('onImagePartialToCanvas:')
		const completeStart = ts.indexOf('onImageCompleteToCanvas:', partialStart)
		expect(partialStart).toBeGreaterThan(-1)
		expect(completeStart).toBeGreaterThan(partialStart)

		const partialHandler = ts.slice(partialStart, completeStart)
		expectExcerptToContain(partialHandler, "pixiMediaLayer?.setTransientImageSource(existing.nodeId, imageUrl)")
		expectExcerptToContain(partialHandler, 'commitTransientCanvasStatePreservingEditors({ ...currentCanvasState, nodes: resolvedNodes })')
		expectExcerptNotToContain(partialHandler, 'imgEl.src', 'partial image handler')
	})

	it('renders the generating-image snake border through PIXI until the image leaves partial state', () => {
		const pixiLayerTs = loadPixiMediaLayer()
		const outlineRendererTs = loadPixiTravelingOutlineRenderer()
		const settingsTs = loadSettings()
		const partialStart = ts.indexOf('onImagePartialToCanvas:')
		const completeStart = ts.indexOf('onImageCompleteToCanvas:', partialStart)
		const partialHandler = ts.slice(partialStart, completeStart)
		const completeEnd = ts.indexOf('onVideoPendingToCanvas:', completeStart)
		const completeHandler = ts.slice(completeStart, completeEnd)

		expectSourceToContain(ts, 'pixiMediaLayer?.setGeneratingImageNodes(')
		expectSourceToContain(pixiLayerTs, "const generatingBorderLayer = new Container({ label: 'workspace-pixi-generating-borders' })")
		expectSourceToContain(pixiLayerTs, 'world.addChild(generatingBorderLayer)')
		expectSourceToContain(outlineRendererTs, 'export class PixiTravelingOutlineRenderer {')
		expectSourceToContain(pixiLayerTs, 'new PixiTravelingOutlineRenderer({')
		expectSourceToContain(pixiLayerTs, 'generatingBorderRenderer.sync(datums)')
		expectSourceToContain(outlineRendererTs, 'const OUTLINE_GEOMETRY_RING_SIZE = 3')
		expectSourceToContain(outlineRendererTs, 'mesh.label = `pixi-traveling-outline-glass-${index}`')
		expectSourceToContain(outlineRendererTs, 'private paint(entry: OutlineEntry, elapsed: number)')
		expectSourceToContain(outlineRendererTs, 'const headDistance = getTravelingOutlineHeadDistance(elapsed, durationMs, perimeter, this.ease)')
		expectSourceToContain(outlineRendererTs, 'new MeshGeometry({')
		expectSourceToContain(outlineRendererTs, 'positions: buffers.positions')
		expectSourceToContain(outlineRendererTs, 'new Mesh({ geometry, texture: this.texture })')
		expectSourceToContain(outlineRendererTs, 'new TravelingSnakeGlassMaterial(')
		expectSourceToContain(outlineRendererTs, 'this.ease = options.ease ?? Easing.travelingOutlineTransition')
		expectSourceToContain(pixiLayerTs, 'function setGeneratingImageNodes(nodeIds: Set<string>)')
		expectSourceToContain(settingsTs, 'gap: 3')
		expectSourceToContain(settingsTs, 'preFrameCircleScale: mediaGenerationLayoutSettings.preFrameCircleScale')
		expectSourceToContain(settingsTs, 'snakeWidth: 9')
		expectSourceToContain(settingsTs, 'snakeTailWidthFraction: 0.14')
		expectSourceToContain(settingsTs, 'snakeLengthFraction: 0.24')
		expectSourceToContain(settingsTs, "'#ff0084'")
		expectSourceToContain(settingsTs, 'animationDurationMs: 3200')
		expectSourceNotToContain(ts, 'SvgGradientRenderer')
		expectSourceNotToContain(ts, 'image-generating-border')
		expectSourceNotToContain(ts, 'image-generating-spinner')
		expectSourceNotToContain(ts, 'img-dot-bounce')
		expectSourceNotToContain(scss, '.workspace-image-progress-viewport')
		expectExcerptToContain(partialHandler, 'if (existing && !getCurrentCanvasMediaNode(existing.nodeId)) {', 'partial image handler')
		expectExcerptToContain(partialHandler, 'partialImageTracker.delete(runKey)', 'partial image handler')
		expectExcerptToContain(completeHandler, 'keepGeneratedImageCompletionOutlineUntilTextureReady(runKey, completionTracker, completedImageNode)')
		expectExcerptToContain(completeHandler, "'image-complete-apply'")
		expectExcerptNotToContain(completeHandler, 'commitCanvasState({', 'complete image handler')
	})

	it('finalizes generated images only from API-resolved geometry', () => {
		const completeStart = ts.indexOf('onImageCompleteToCanvas:')
		const callbackEnd = ts.indexOf('onVideoPendingToCanvas:', completeStart)
		expect(completeStart).toBeGreaterThan(-1)
		expect(callbackEnd).toBeGreaterThan(completeStart)

		const completeHandler = ts.slice(completeStart, callbackEnd)
		expectExcerptToContain(completeHandler, 'missing image completion geometry; refusing local canvas topology mutation', 'complete image handler')
		expectExcerptToContain(completeHandler, "'image-complete-apply'", 'complete image handler')
		expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'complete image handler')
		expectExcerptToContain(completeHandler, 'appendImageNodeToDOM(completedImageNode)', 'complete image handler')
		expectExcerptNotToContain(completeHandler, "const imageSrc = buildGeneratedImageFrameSrc({", 'complete image handler')
		expectExcerptNotToContain(completeHandler, 'commitCanvasState({', 'complete image handler')
		expectExcerptNotToContain(completeHandler, 'const deduped = withoutGeneratedMediaDuplicateNodes({', 'complete image handler')
		expectExcerptNotToContain(completeHandler, 'rebalanceGeneratedMediaTrees(deduped.state.nodes, deduped.state.edges)', 'complete image handler')
		expectExcerptNotToContain(completeHandler, 'imgEl.src', 'complete image handler')
	})

	it('arms the final original rendition before completion can release the transient frame', () => {
		const completeStart = ts.indexOf('onImageCompleteToCanvas:')
		const callbackEnd = ts.indexOf('onVideoPendingToCanvas:', completeStart)
		expect(completeStart).toBeGreaterThan(-1)
		expect(callbackEnd).toBeGreaterThan(completeStart)

		const completeHandler = ts.slice(completeStart, callbackEnd)
		const handoffIndex = completeHandler.indexOf('prepareGeneratedImageCompletionTextureHandoff(')
		const missingGeometryBranchIndex = completeHandler.indexOf('if (!data.canvasGeometry)')
		const transientReleaseIndex = completeHandler.lastIndexOf('pixiMediaLayer?.setTransientImageSource(pendingNodeId, null)')
		const geometryApplyIndex = completeHandler.indexOf('applyApiCanvasGeometry(data.canvasGeometry)')

		expect(handoffIndex).toBeGreaterThan(-1)
		expect(missingGeometryBranchIndex).toBeGreaterThan(handoffIndex)
		expect(completeHandler.slice(0, missingGeometryBranchIndex)).not.toContain('setTransientImageSource(')
		expect(transientReleaseIndex).toBeGreaterThan(handoffIndex)
		expect(geometryApplyIndex).toBeGreaterThan(handoffIndex)
		expect(transientReleaseIndex).toBeGreaterThan(geometryApplyIndex)
	})

	it('anchors completed-image connectors to the final media rectangle during texture handoff', () => {
		const connectorNodesStart = ts.indexOf('function getNodesForConnectionManager(')
		const connectorEdgesStart = ts.indexOf('function getEdgesForConnectionManager(', connectorNodesStart)
		const clearOutlineStart = ts.indexOf('function clearFinalizingGeneratedImageOutline(')
		const pruneAliasesStart = ts.indexOf('function pruneGeneratedMediaTrackerAliases(', clearOutlineStart)
		expect(connectorNodesStart).toBeGreaterThan(-1)
		expect(connectorEdgesStart).toBeGreaterThan(connectorNodesStart)
		expect(clearOutlineStart).toBeGreaterThan(-1)
		expect(pruneAliasesStart).toBeGreaterThan(clearOutlineStart)

		const connectorNodes = ts.slice(connectorNodesStart, connectorEdgesStart)
		const clearOutline = ts.slice(clearOutlineStart, pruneAliasesStart)
		expectExcerptToContain(
			connectorNodes,
			'finalizingGeneratedImageRunKeysByNodeId.has(node.nodeId)',
			'connector node geometry',
		)
		expectExcerptToContain(
			connectorNodes,
			'? null\n                : getPendingGeneratedMediaBeforeFrameVisualGeometry(',
			'connector node geometry',
		)
		expectExcerptToContain(
			clearOutline,
			'syncConnectionManagerForCurrentCanvasState({ flushPixi: true })',
			'completion texture handoff cleanup',
		)
	})

	it('shows review and regeneration controls only for AI-generated media', () => {
		const acceptStart = ts.indexOf('function createMediaAcceptButton')
		const rejectStart = ts.indexOf('function createMediaRejectButton', acceptStart)
		const regenerateStart = ts.indexOf('function createMediaRegenerationControls', acceptStart)
		const historyStart = ts.indexOf('function createGeneratedOutputHistoryButton', regenerateStart)
		expect(acceptStart).toBeGreaterThan(-1)
		expect(rejectStart).toBeGreaterThan(acceptStart)
		expect(regenerateStart).toBeGreaterThan(acceptStart)
		expect(historyStart).toBeGreaterThan(regenerateStart)

		expectExcerptToContain(ts.slice(acceptStart, rejectStart), 'if (!node.generatedBy) return null', 'accept control')
		expectExcerptToContain(
			ts.slice(rejectStart, regenerateStart),
			'isGeneratedOutputRejectableForCanvas({',
			'reject control',
		)
		expectExcerptToContain(ts.slice(regenerateStart, historyStart), 'if (!node.generatedBy) return null', 'regeneration control')
	})

	it('keeps terminal candidate controls usable while the local Asset cache catches up', () => {
		const readiness = extractFunctionBody(ts, 'isGeneratedOutputReviewReady')
		const accepted = extractFunctionBody(ts, 'isGeneratedOutputAccepted')
		const accept = extractFunctionBody(ts, 'createMediaAcceptButton')
		const reject = extractFunctionBody(ts, 'createMediaRejectButton')
		const regenerate = extractFunctionBody(ts, 'createMediaRegenerationControls')
		const chromeKey = extractFunctionBody(ts, 'getGeneratedMediaNodeChromeKey')

		expectExcerptToContain(readiness, 'isGeneratedOutputReadyForReview(', 'generated output readiness')
		expectExcerptToContain(accepted, 'isGeneratedOutputAcceptedForCanvas({', 'generated output accepted state')
		expectExcerptNotToContain(accept, 'if (!asset ||', 'accept control')
		expectExcerptToContain(reject, 'isGeneratedOutputRejectableForCanvas({', 'reject control')
		expectExcerptNotToContain(regenerate, 'if (!asset ||', 'regeneration control')
		expectExcerptToContain(chromeKey, "node.generatedBy?.generationRequestId ?? ''", 'generated media chrome key')
		expectExcerptToContain(chromeKey, "node.generatedBy?.branchOriginNodeId ?? ''", 'generated media chrome key')
		expectExcerptToContain(chromeKey, "asset?.media?.renditions.original?.status ?? ''", 'generated media chrome key')
		expectExcerptToContain(chromeKey, "asset?.generatedOutputReview?.status ?? ''", 'generated media chrome key')
		expectSourceToContain(ts, 'syncLoadedDocumentEditors()\n                syncBranchMarkerNodeContents()')
	})

	it('preserves workspace panel metadata when image workflows write canvas state', () => {
		const imageCallbacksStart = ts.indexOf('setAiGeneratedImageCallbacks({')
		const errorStart = ts.indexOf('onImageErrorToCanvas:', imageCallbacksStart)
		const partialStart = ts.indexOf('onImagePartialToCanvas:', imageCallbacksStart)
		const completeStart = ts.indexOf('onImageCompleteToCanvas:', imageCallbacksStart)
		const videoStart = ts.indexOf('setAiGeneratedVideoCallbacks', errorStart)
		const partialHandler = ts.slice(partialStart, completeStart)
		const completeHandler = ts.slice(completeStart, videoStart)
		const errorHandler = ts.slice(errorStart, partialStart)

		expectExcerptToContain(partialHandler, '...currentCanvasState,', 'partial image handler')
		expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'complete image handler')
		expectExcerptNotToContain(completeHandler, 'currentCanvasState?.viewport || { x: 0, y: 0, zoom: 1 }', 'complete image handler')
		expectExcerptToContain(errorHandler, 'const existing = partialImageTracker.get(runKey)', 'error image handler')
		expectExcerptNotToContain(errorHandler, 'removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)', 'error image handler')
		expectExcerptToContain(errorHandler, 'finishFailedGeneratedMediaRun(threadId, generationRun)', 'error image handler')
		expectSourceToContain(ts, 'commitCanvasStatePreservingEditors({')
		expectSourceToContain(ts, 'commitCanvasState({')
	})

	it('re-tidies generated-media trees when final image proportions resolve', () => {
		expectSourceToContain(ts, 'computeLineageContinuationPositionToRightOfRect(')
		expectSourceToContain(ts, 'const resolvedNodes = isGeneratedMediaNode(imageNode)')
		expectSourceToContain(ts, 'const resolvedNodes = isGeneratedMediaNode(videoNode)')
		expectSourceToContain(ts, '? rebalanceGeneratedMediaTrees(updatedNodes, currentCanvasState.edges)')
		expectSourceToContain(ts, 'if (!needsRerender) syncCanvasNodeDomGeometry(currentCanvasState.nodes)')
		expectSourceNotToContain(ts, 'getGeneratedImageLineageAnchorRect(')
		expectSourceNotToContain(ts, '? computeVerticallyCenteredY(lineageAnchorRect, fittedDimensions.height)')
	})

	it('routes generated-media add/remove through the centralized tree rebalance', () => {
		// WorkspaceCanvas supplies canvas-specific geometry, but the generated-media
		// rebalance sequence lives in the extracted deterministic pipeline.
		const rebalancePipeline = readSourceFile('generatedMediaRebalancePipeline.ts')
		expectSourceToContain(ts, "from '$src/infographics/workspace/generatedMediaRebalancePipeline.ts'")
		expectSourceToContain(rebalancePipeline, "import { getStartedLineageMarkerState } from '$src/infographics/workspace/branchLineageState.ts'")
		expectSourceToContain(ts, 'function createGeneratedMediaRebalancePipeline(): GeneratedMediaRebalancePipeline')
		expectSourceToContain(ts, 'function rebalanceGeneratedMediaTrees(nodes: CanvasNode[], edges: WorkspaceEdge[]): CanvasNode[]')
		expectSourceToContain(ts, 'const result = createGeneratedMediaRebalancePipeline().rebalance(nodes, edges)')
		expectSourceToContain(ts, 'clearStartedBranchMarkerProjectionOverrides(result.startedMarkerNodeIds)')
		expectSourceToContain(ts, 'pendingMediaPreFrameScale: settings.mediaNode.inProgressOutlineAnimation.preFrameCircleScale,')
		expectSourceToContain(ts, 'depthGap: settings.mediaBranchLineage.mediaToMediaGap,')
		expectSourceToContain(ts, 'siblingGap: settings.mediaBranchLineage.branchRowGap,')
		expectSourceToContain(ts, 'branchFanoutExtraGap: settings.mediaBranchLineage.branchFanoutExtraGap,')
		expectSourceToContain(ts, 'branchOriginMarkerStackGap: getBranchMarkerStackGap(),')
		expectSourceToContain(ts, 'getNodeConnectorAnchorRect: getCanvasNodeConnectorAnchorRect,')
		expectSourceToContain(ts, 'getNodeCollisionMargin: (node: CanvasNode) => getCanvasNodeCollisionSettings(node, collisionSettings).margin,')
		expectSourceToContain(ts, 'isPendingGeneratedMediaBeforeFrame: (node: CanvasNode) => isPendingGeneratedMediaBeforeFirstFrame(node.nodeId),')
		// Layout boxes equal rendered boxes: pending media use the compact
		// pre-frame circle for collision/layout purposes until a frame exists.
		expectSourceToContain(ts, 'getPendingGeneratedMediaBeforeFrameCircleGeometry(')
		expectSourceNotToContain(ts, 'getPendingGeneratedMediaBeforeFrameInsertionPosition')
		expectSourceNotToContain(ts, 'getFullFramePositionFromPendingGeneratedMediaPosition')
		expectSourceNotToContain(ts, "import { rebalanceBranchTreesAndResolve } from '$src/infographics/workspace/branchTreeLayout.ts'")
		// Wired into in-progress generated-media placeholder paths. Completion
		// topology is API-owned and arrives through CanvasGeometryUpdate.
		expectSourceToContain(ts, 'const rebalancedNodes = rebalanceGeneratedMediaTrees(nodesWithImage, newEdges)')
		// Video pending placeholders are now entirely API-owned: onVideoPendingToCanvas
		// applies the server's canvasGeometry instead of building a local node tree.
		expectSourceNotToContain(ts, 'rebalanceGeneratedMediaTrees(nodesWithVideo, newEdges)')
		// Re-tidies on delete only when the removed node was a lineage member.
		expectSourceToContain(ts, 'isBranchTreeCanvasNode(deletedNode)')
		expectSourceToContain(ts, 'resolveGeneratedMediaTreeState(remainingNodes, updatedEdges)')
		expectSourceNotToContain(ts, ['stripLegacy', 'Branch', 'Origin', 'Nodes'].join(''))
	})

	it('applies API-resolved authoritative canvas geometry instead of recomputing generation layout', () => {
		// The API runs the shared branch-tree layout and broadcasts resolved
		// geometry over the chat stream; the client applies it transiently (no
		// re-persist, the API already wrote it) with a monotonic revision guard.
		expectSourceToContain(ts, 'applyCanvasGeometryUpdateToState')
		expectSourceToContain(ts, 'function applyApiCanvasGeometry(canvasGeometry: CanvasGeometryUpdate): void')
		expectSourceToContain(ts, 'if (canvasGeometry.layoutRevision <= lastAppliedApiLayoutRevision) return')
		expectSourceToContain(ts, 'if (canvasGeometry.layoutRevision < highestObservedApiLayoutRevision) return')
		expectSourceToContain(ts, 'const result = applyCanvasGeometryUpdateToState(preflightReconciliation.state, canvasGeometry)')
		expectSourceToContain(ts, 'nodeSnapshotCount: canvasGeometry.nodeSnapshots?.length ?? 0')
		expectSourceToContain(ts, 'edgeSnapshotCount: canvasGeometry.edgeSnapshots?.length ?? 0')
		expectSourceToContain(ts, 'removedNodeIds: canvasGeometry.removedNodeIds ?? []')
		expectSourceToContain(ts, 'upsertedEdgeIds: result.upsertedEdgeIds')
		expectSourceToContain(ts, 'pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(currentCanvasState)')
		expectSourceToContain(ts, 'commitTransientCanvasStatePreservingEditors(result.state)')
		expectSourceToContain(ts, 'removeApiCanvasRemovedNodesFromDOM(result.removedNodeIds)')
		expectSourceToContain(ts, 'const replacedGeneratedMediaNodeIds = result.updatedNodeIds.filter(nodeId => {')
		expectSourceToContain(ts, '...replacedGeneratedMediaNodeIds')
		expectSourceToContain(ts, 'onCanvasGeometryResolvedToCanvas: ({ canvasGeometry }) => {')
		// Complete handlers only apply API geometry and refuse local topology mutation.
		expectSourceToContain(ts, "'image-complete-apply'")
		expectSourceToContain(ts, "'video-complete-apply'")
		expectSourceToContain(ts, 'missing image completion geometry; refusing local canvas topology mutation')
		expectSourceToContain(ts, 'missing video completion geometry; refusing local canvas topology mutation')
		expectSourceToContain(ts, 'appendImageNodeToDOM(completedImageNode)')
		expectSourceToContain(ts, 'appendVideoNodeToDOM(completedVideoNode)')
		expectSourceToContain(ts, 'applyApiCanvasGeometry(data.canvasGeometry)')
		const snapshotSyncStart = ts.indexOf('function syncApiCanvasSnapshotNodesToDOM(')
		const snapshotSyncEnd = ts.indexOf('function removeApiCanvasRemovedNodesFromDOM(', snapshotSyncStart)
		expect(snapshotSyncStart).toBeGreaterThan(-1)
		expect(snapshotSyncEnd).toBeGreaterThan(snapshotSyncStart)
		const snapshotSync = ts.slice(snapshotSyncStart, snapshotSyncEnd)
		expectExcerptToContain(
			snapshotSync,
			"else if (node.type === 'operationStatus') {\n                syncExistingOperationStatusNodeToDOM(node)\n            }",
			'failed operation-status snapshot DOM sync',
		)
		const waitingForFrameStart = ts.indexOf('function isGeneratedMediaCanvasNodeWaitingForFrame')
		const waitingForFrameEnd = ts.indexOf('function isPendingGeneratedMediaBeforeFirstFrame', waitingForFrameStart)
		expect(waitingForFrameStart).toBeGreaterThan(-1)
		expect(waitingForFrameEnd).toBeGreaterThan(waitingForFrameStart)
		const waitingForFrame = ts.slice(waitingForFrameStart, waitingForFrameEnd)
		expectExcerptToContain(waitingForFrame, "['completed', 'failed', 'cancelled'].includes(node.generationProgress.status)", 'terminal media progress guard')
		expectSourceToContain(ts, "if (node.mediaGenerationPhase) return node.mediaGenerationPhase === 'pending-before-first-frame'")
		expectSourceToContain(ts, "return Boolean(node.generatedBy) && asset?.media?.renditions.original?.status !== 'ready'")
	})

	it('swaps partial pixels without replaying geometry or blanking the prior texture', () => {
		const pixiLayerTs = loadPixiMediaLayer()
		const intrinsicStart = ts.indexOf('function handleImageIntrinsicSize')
		const intrinsicEnd = ts.indexOf('function applyApiCanvasGeometry', intrinsicStart)
		expect(intrinsicStart).toBeGreaterThan(-1)
		expect(intrinsicEnd).toBeGreaterThan(intrinsicStart)
		const intrinsicHandler = ts.slice(intrinsicStart, intrinsicEnd)

		expectExcerptToContain(intrinsicHandler, 'if (size.preserveNodeGeometry) return', 'intrinsic image handler')
		expectSourceToContain(pixiLayerTs, 'entry.sourceReloadPending = true')
		expectSourceToContain(pixiLayerTs, 'if (!entry.sourceReloadPending\n            && entry.loadedTier !== null')
		expectSourceToContain(pixiLayerTs, "preserveNodeGeometry: Boolean(oldKey?.includes('/api/transient-media/'))")
		expectSourceNotToContain(pixiLayerTs, 'entry.sprite.texture = Texture.EMPTY')
		expectSourceToContain(ts, 'syncPixiMediaLayer(currentCanvasState)\n                syncCanvasNodeDomGeometry([imageNode])\n                pixiMediaLayer?.renderNow()')
	})

	it('keeps in-progress generated media aligned with API-owned lineage identity', () => {
		expectSourceToContain(ts, 'buildBranchMarkerTurnProjectionFromThreadContent')
		expectSourceToContain(ts, 'getPendingGeneratedMediaNodeId')
		expectSourceToContain(ts, 'allowLatestTurnFallback: canUseLatestBranchMarkerTurnFallback(marker)')
		expectSourceToContain(ts, '|| Boolean(node.pendingState)')
		expectSourceToContain(ts, '|| getBranchMarkerGeneratedArtifactNodes(node).length > 0')
		expectSourceToContain(ts, 'const expectedNodeId = lineageAssignment ? getPendingGeneratedMediaNodeId(lineageAssignment) : \'\'')
		expectSourceToContain(ts, 'const completedNodeId = generationRun?.lineageAssignment\n                ? getPendingGeneratedMediaNodeId(generationRun.lineageAssignment)\n                : \'\'')
		expectSourceToContain(ts, 'const nodeId = getPendingGeneratedMediaNodeId(lineageAssignment)')
		expectSourceToContain(ts, 'const lineageParentNodeId = lineageAssignment?.lineageParentNodeId')
		expectSourceNotToContain(ts, 'const nodeId = `node-${fileId || uuidv4()}`')
	})

})

describe('Workspace canvas — generated video canvas state', () => {
	const ts = loadTs()

	it('preserves workspace panel metadata when video workflows use API geometry', () => {
		// Regression: the video callbacks used to build a fresh { viewport, nodes,
		// edges } object, dropping aiChatPanel / sidebar tabs and collapsing the
		// chat panel. Video pending/complete now apply the API's canvasGeometry
		// directly onto currentCanvasState instead of rebuilding it locally.
		const pendingStart = ts.indexOf('onVideoPendingToCanvas:')
		const generatingStart = ts.indexOf('onVideoGeneratingToCanvas:', pendingStart)
		const completeStart = ts.indexOf('onVideoCompleteToCanvas:', generatingStart)
		const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
		const errorEnd = ts.indexOf('// Visibility detection for lazy loading', errorStart)

		expect(pendingStart).toBeGreaterThan(-1)
		expect(completeStart).toBeGreaterThan(pendingStart)
		expect(errorStart).toBeGreaterThan(completeStart)
		expect(errorEnd).toBeGreaterThan(errorStart)

		const pendingHandler = ts.slice(pendingStart, generatingStart)
		const completeHandler = ts.slice(completeStart, errorStart)
		const errorHandler = ts.slice(errorStart, errorEnd)

		expectExcerptToContain(pendingHandler, 'applyApiCanvasGeometry(canvasGeometry)', 'video pending handler')
		expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'video complete handler')
		expectExcerptNotToContain(completeHandler, 'commitCanvasState({', 'video complete handler')
		expectExcerptToContain(errorHandler, 'videoGenerationTracker.delete(runKey)', 'video error handler')
		expectExcerptNotToContain(errorHandler, 'removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)', 'video error handler')
	})

	it('renders shared SVG controls for completed video nodes in the chrome layer', () => {
		// The controls must live in the z-index-3 chrome layer because PIXI paints
		// the video pixels above the DOM node shell.
		expectSourceToContain(ts, 'function createVideoControlsChrome(node: VideoCanvasNode)')
		expectSourceToContain(ts, 'className="workspace-video-chrome"')
		expectSourceToContain(ts, 'createVideoControls(svg, {')
		expectSourceToContain(ts, 'videoNodeHandler?.getVideoElement(node.nodeId)')
		expectSourceToContain(ts, 'if (!videoEl.currentSrc && !videoEl.src) return null')
		expectSourceToContain(ts, "surface.addEventListener('mousemove', (event: MouseEvent) => {")
		expectSourceToContain(ts, "surface.addEventListener('mousedown', (event: MouseEvent) => {")
		expectSourceToContain(ts, 'handleDragStart(event, node.nodeId)')
		expectSourceToContain(ts, 'handleResizeStart(event, node.nodeId, resizeHandle)')
		// Only completed videos (with a ready original rendition) get the controls.
		expectSourceToContain(ts, "node.type === 'video' && assetsStore.get(node.assetId)?.media?.renditions.original?.status === 'ready'")
		// The chrome geometry tracks the node during live drag/resize.
		expectSourceToContain(ts, 'applyVideoControlsGeometry(videoChromeEl, position, dimensions, viewport)')
	})

	it('syncs video chrome after video handler entries exist', () => {
		const renderStart = ts.indexOf('render(newCanvasState: CanvasState | null')
		const pixiSync = ts.indexOf('syncPixiMediaLayer(currentCanvasState)', renderStart)
		const chromeSync = ts.indexOf('syncGeneratedMediaChrome(currentCanvasState)', renderStart)

		expect(renderStart).toBeGreaterThan(-1)
		expect(pixiSync).toBeGreaterThan(-1)
		expect(chromeSync).toBeGreaterThan(pixiSync)
		expectSourceToContain(ts, 'onVideoElementReady: () => scheduleGeneratedMediaChromeSync(),')
	})

	it('counts prior videos as siblings when positioning a new generated output', () => {
		// Regression: getGeneratedChildOutputs used to match only images, so a new
		// video could not see a previously generated video and the two stacked on
		// the same spot. Both media types must qualify as sibling outputs.
		expectSourceToContain(ts, "if ((node.type !== 'image' && node.type !== 'video') || node.parentId) return false")
	})

	it('uses only API geometry when a video completes', () => {
		const completeStart = ts.indexOf('onVideoCompleteToCanvas:')
		const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
		const completeHandler = ts.slice(completeStart, errorStart)

		expectExcerptToContain(completeHandler, 'missing video completion geometry; refusing local canvas topology mutation', 'video complete handler')
		expectExcerptToContain(completeHandler, "'video-complete-apply'", 'video complete handler')
		expectExcerptToContain(completeHandler, 'applyApiCanvasGeometry(data.canvasGeometry)', 'video complete handler')
		expectExcerptNotToContain(completeHandler, 'const edges = currentCanvasState.edges.map((edge: WorkspaceEdge) => {', 'video complete handler')
		expectExcerptNotToContain(completeHandler, 'rebalanceGeneratedMediaTrees(deduped.state.nodes, deduped.state.edges)', 'video complete handler')
	})

	it('queues completed video analysis from the API-materialized node', () => {
		const completeStart = ts.indexOf('onVideoCompleteToCanvas:')
		const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
		const completeHandler = ts.slice(completeStart, errorStart)
		expectExcerptToContain(completeHandler, 'const completedVideoNode = getCurrentCanvasMediaNode(completedNodeId)', 'video complete handler')
		// Analysis queuing is shared between images and videos inside
		// refreshCompletedGeneratedMediaAsset, called with the API-materialized node.
		expectExcerptToContain(completeHandler, 'void refreshCompletedGeneratedMediaAsset(completedVideoNode)', 'video complete handler')
		const refreshStart = ts.indexOf('async function refreshCompletedGeneratedMediaAsset(')
		const refreshEnd = ts.indexOf('\n    }', refreshStart)
		const refreshBody = ts.slice(refreshStart, refreshEnd)
		expectExcerptToContain(refreshBody, 'queueCanvasMediaAnalysis(node.nodeId, getMediaDescriptorStillAssetId(node))', 'refreshCompletedGeneratedMediaAsset')
	})

	it('keeps the bounded icon strip to badge + info button only, with the panel decoupled', () => {
		// The screen-space chrome strip carries ONLY the provider badge + info
		// button for BOTH images and videos. The expandable info panel is built
		// separately as constant-size screen-space content, so the two affordances
		// are fully decoupled.
		const chromeStart = ts.indexOf('function createGeneratedMediaChrome(node: ImageCanvasNode | VideoCanvasNode)')
		const chromeEnd = ts.indexOf('function getCapabilityArtifactProvenance', chromeStart)
		const mediaChrome = ts.slice(chromeStart, chromeEnd)
		expect(chromeStart).toBeGreaterThan(-1)
		expect(chromeEnd).toBeGreaterThan(chromeStart)
		expectExcerptToContain(mediaChrome, 'createMediaInfoButton(node)', 'media chrome strip')
		expectExcerptToContain(mediaChrome, 'applyGeneratedMediaChromeGeometry(', 'media chrome strip')
		expectExcerptNotToContain(mediaChrome, 'createGeneratedMediaInfoPanel', 'media chrome strip')
		expectExcerptNotToContain(mediaChrome, 'createGeneratedOutputHistoryButton(node)', 'media chrome strip')
	})

	it('keeps the video controls overlay free of the info button', () => {
		// Regression: the info button used to share the video overlay, which shoved
		// both affordances to opposite edges of the node. The video controls overlay
		// must contain ONLY the controls now; the info button lives in the
		// below-node media chrome.
		const chromeStart = ts.indexOf('function createVideoControlsChrome(node: VideoCanvasNode)')
		const chromeEnd = ts.indexOf('function destroyVideoControlInstances', chromeStart)
		const controlsChrome = ts.slice(chromeStart, chromeEnd)
		expectExcerptToContain(controlsChrome, 'workspace-video-controls-host', 'video controls chrome')
		expectExcerptToContain(controlsChrome, 'workspace-video-surface', 'video controls chrome')
		expectExcerptNotToContain(controlsChrome, 'createMediaInfoButton(node)', 'video controls chrome')
		expectExcerptNotToContain(controlsChrome, 'workspace-generated-media-actions', 'video controls chrome')
	})

	it('renders media info chrome for both image and video nodes', () => {
		expectSourceToContain(ts, 'generatedMediaChromeLayerEl.replaceChildren(')
		expectSourceToContain(ts, '...mediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => createGeneratedMediaChrome(node)),')
		expectSourceToContain(ts, "(node.type === 'image' || node.type === 'video')")
	})

	it('does not remount generated media chrome when content identity is unchanged', () => {
		const syncChrome = extractFunctionBody(ts, 'syncGeneratedMediaChrome')
		const skipIndex = syncChrome.indexOf('if (nextChromeSyncKey === generatedMediaChromeSyncKey)')
		const skipReturnIndex = syncChrome.indexOf('return', skipIndex)
		const destroyIndex = syncChrome.indexOf('destroyGeneratedMediaInfoRenderers()', skipReturnIndex)
		const generatedChromeReplaceIndex = syncChrome.indexOf('generatedMediaChromeLayerEl.replaceChildren(', skipReturnIndex)
		const mediaChromeReplaceIndex = syncChrome.indexOf('mediaChromeViewportEl.replaceChildren(', skipReturnIndex)

		expectSourceToContain(ts, "const RESET_GENERATED_MEDIA_CHROME_SYNC_KEY = '\\u0000reset-generated-media-chrome'")
		expectSourceToContain(ts, 'generatedMediaChromeSyncKey = RESET_GENERATED_MEDIA_CHROME_SYNC_KEY')
		expectExcerptToContain(syncChrome, 'const nextChromeSyncKey = getGeneratedMediaChromeSyncKey({', 'generated media chrome sync')
		expectExcerptToContain(syncChrome, 'updateGeneratedMediaChromeLayout()', 'generated media chrome sync')
		expectExcerptToContain(syncChrome, "console.info('[CANVAS][generated-media-chrome]', 'sync-skip-same-key'", 'generated media chrome sync')
		expectExcerptToContain(syncChrome, "console.info('[CANVAS][generated-media-chrome]', 'sync-rebuild'", 'generated media chrome sync')
		expectSourceToContain(ts, 'function getPlayableVideoChromeKey(node: VideoCanvasNode): string')
		expectSourceToContain(ts, "videoEl ? 'video-element-ready' : 'video-element-missing'")
		expectSourceToContain(ts, 'function getBranchMarkerPanelChromeKey(')
		expectSourceToContain(ts, "'generated-media-panel',")
		expectSourceToContain(ts, "'branch-marker-panel',")
		expect(skipIndex, 'generated media chrome sync should compare the stable chrome key').toBeGreaterThan(-1)
		expect(skipReturnIndex, 'same-key branch should return before any remount').toBeGreaterThan(skipIndex)
		expect(destroyIndex, 'renderer teardown should happen only after the same-key skip branch').toBeGreaterThan(skipReturnIndex)
		expect(generatedChromeReplaceIndex, 'generated media chrome DOM replacement should happen only after the same-key skip branch').toBeGreaterThan(skipReturnIndex)
		expect(mediaChromeReplaceIndex, 'media chrome DOM replacement should happen only after the same-key skip branch').toBeGreaterThan(skipReturnIndex)
	})

	it('uses the standard chat projection for Capability Artifact lineage history', () => {
		const originPanel = extractFunctionBody(ts, 'createBranchOriginInfoPanel')
		const forkPanel = extractFunctionBody(ts, 'createBranchForkInfoPanel')
		const linePanel = extractFunctionBody(ts, 'createBranchLineInfoPanel')
		const artifactHistory = extractFunctionBody(ts, 'createCapabilityArtifactHistoryPanelChrome')
		const panelKey = extractFunctionBody(ts, 'getBranchMarkerPanelChromeKey')

		for (const panelBody of [originPanel, forkPanel, linePanel]) {
			expectExcerptToContain(panelBody, 'return createBranchMarkerInfoPanel(', 'Capability Artifact branch history')
			expectExcerptNotToContain(panelBody, 'createCapabilityArtifactBranchHistoryPanel', 'Capability Artifact branch history')
		}
		expectExcerptToContain(artifactHistory, 'mountBranchTurnChatProjection({', 'Capability Artifact node history')
		expectExcerptToContain(artifactHistory, 'canvas-generated-media-history-panel', 'Capability Artifact node history')
		expectSourceToContain(ts, 'getAiChatThreadContentForProjection(locator.threadId)')
		expectSourceToContain(ts, 'buildBranchMarkerTurnProjectionFromThreadContent(')
		expectSourceToContain(ts, 'allowLatestTurnFallback: false')
		expectExcerptNotToContain(artifactHistory, '<strong>Generation history</strong>', 'Capability Artifact node history')
		expectExcerptToContain(panelKey, "'branch-marker-panel'", 'Capability Artifact branch history key')
		expectExcerptNotToContain(panelKey, 'generated-artifact-panel', 'Capability Artifact branch history key')
		expectSourceToContain(ts, 'getBranchMarkerGeneratedArtifactNodes(node).length > 0')
		expectSourceNotToContain(ts, 'function getCapabilityArtifactLineageProjection')
		expectSourceNotToContain(ts, 'function createCapabilityArtifactBranchHistoryPanel')
	})

	it('routes Timeline, lineage, and historical message references through the shared preview renderer', () => {
		const capabilityReferenceView = extractFunctionBody(ts, 'createCapabilityArtifactAssetReferenceView')
		const refreshCapabilityArtifact = extractFunctionBody(ts, 'refreshCapabilityArtifactNode')
		const createCapabilityArtifact = extractFunctionBody(ts, 'createCapabilityArtifactNode')
		const previewNodeResolver = extractFunctionBody(ts, 'getPromptReferencePreviewNode')
		const markerContent = extractFunctionBody(ts, 'createBranchMarkerContent')
		const historyButton = extractFunctionBody(ts, 'createGeneratedOutputHistoryButton')

		expectExcerptToContain(capabilityReferenceView, 'createMediaPromptReferencePreview({', 'Timeline references')
		expectExcerptToContain(capabilityReferenceView, 'displayName: asset.title.trim()', 'Timeline reference title')
		expectExcerptToContain(capabilityReferenceView, 'getPromptReferencePreviewRenderer({ inlinePopover: true })', 'Timeline reference hover')
		expectExcerptNotToContain(capabilityReferenceView, "mediaKind === 'audio'", 'Timeline audio references')
		expectExcerptToContain(previewNodeResolver, "reference.mediaKind === 'audio'", 'audio preview nodes')
		expectSourceToContain(ts, 'createAssetReferenceView: createCapabilityArtifactAssetReferenceView')
		expectSourceNotToContain(ts, 'resolveThumbnailUrl: assetId =>')
		expectExcerptToContain(
			refreshCapabilityArtifact,
			'await assetService.ensureAssetsLoaded(result.lineage?.sourceAssetIds ?? [])',
			'Timeline reference metadata hydration',
		)
		expectExcerptToContain(
			createCapabilityArtifact,
			'shared.collectReferencedAssetIds(snapshot.doc)',
			'Timeline persisted reference hydration',
		)
		expectExcerptToContain(
			createCapabilityArtifact,
			'void ensureCapabilityArtifactReferenceAssetsLoaded(node, referencedAssetIds)',
			'Timeline persisted reference hydration',
		)
		expectExcerptToContain(markerContent, 'previewRenderer: getPromptReferencePreviewRenderer({ inlinePopover: true })', 'branch marker references')
		expectExcerptToContain(historyButton, 'previewRenderer: getPromptReferencePreviewRenderer({ inlinePopover: true })', 'history trigger references')
		expectSourceToContain(ts, 'promptReferencePreviewRenderer: getPromptReferencePreviewRenderer({ inlinePopover: true }),')
		expectSourceNotToContain(loadScss(), '.workspace-branch-marker-message-text:has(.context-preview-inline.is-open)')
	})

	it('combines media history into the info panel while retaining the Artifact history trigger', () => {
		const messagePartsResolver = extractFunctionBody(ts, 'getGeneratedOutputUserMessageParts')
		const messageResolver = extractFunctionBody(ts, 'getGeneratedOutputUserMessageText')
		const historyButton = extractFunctionBody(ts, 'createGeneratedOutputHistoryButton')
		const mediaChromeStart = ts.indexOf('function createGeneratedMediaChrome(node: ImageCanvasNode | VideoCanvasNode)')
		const mediaChromeEnd = ts.indexOf('function getCapabilityArtifactProvenance', mediaChromeStart)
		const mediaChrome = ts.slice(mediaChromeStart, mediaChromeEnd)
		const mediaInfoPanel = extractFunctionBody(ts, 'createGeneratedMediaMetadataPanel')
		const projectionMount = extractFunctionBody(ts, 'mountGeneratedMediaChatProjection')
		const artifactChrome = extractFunctionBody(ts, 'createGeneratedCapabilityArtifactChrome')

		expectExcerptToContain(messagePartsResolver, "node.type === 'capabilityArtifact'", 'generated output history message')
		expectExcerptToContain(messagePartsResolver, 'buildCapabilityArtifactTurnProjectionContent(node)', 'generated output history message')
		expectExcerptToContain(messagePartsResolver, 'findAiChatThreadContentNode(root, generatedBy.conversationAssetId)', 'generated output history message')
		expectExcerptToContain(messagePartsResolver, 'userMessage', 'generated output history message')
		expectExcerptToContain(messagePartsResolver, 'generatedBy.promptText?.trim() || inputPrompt', 'generated output history message')
		expectExcerptToContain(messagePartsResolver, 'return getBranchMarkerPromptParts(', 'generated output history message')
		expectExcerptToContain(messageResolver, 'getBranchMarkerPromptDisplayText(getGeneratedOutputUserMessageParts(node))', 'generated output history message')
		expectExcerptToContain(historyButton, 'getGeneratedOutputUserMessageParts(node)', 'generated output history trigger')
		expectExcerptToContain(historyButton, 'getGeneratedOutputUserMessagePreview(messageParts)', 'generated output history trigger')
		expectExcerptToContain(historyButton, 'renderBranchMarkerPromptParts(previewParts, {', 'generated output history trigger')
		expectExcerptToContain(historyButton, 'workspace-branch-marker-message-icon media-history-reasoning-icon', 'generated output history trigger')
		expectExcerptToContain(historyButton, 'title=${message}', 'generated output history trigger')
		expectSourceToContain(ts, 'GENERATED_OUTPUT_HISTORY_PREVIEW_MAX_CHARACTERS = 22')
		expectExcerptNotToContain(mediaChrome, 'createGeneratedOutputHistoryButton(node)', 'generated media chrome')
		expectExcerptToContain(mediaInfoPanel, 'appendGeneratedMediaMetadata(panel, node)', 'generated media info panel')
		expectExcerptToContain(mediaInfoPanel, 'appendGeneratedMediaHistory(historySection, node, {', 'generated media info panel')
		expectExcerptToContain(mediaInfoPanel, 'canvas-generated-media-history-section', 'generated media info panel')
		expectExcerptToContain(projectionMount, 'defaultExpanded: true', 'generated media history pipeline')
		expectExcerptToContain(projectionMount, 'includeGenerationProgressTimeline,', 'generated media history trace')
		expectSourceNotToContain(ts, 'defaultProgressTimelineExpanded')
		expectExcerptToContain(artifactChrome, 'createGeneratedOutputHistoryButton(node)', 'generated Artifact chrome')
		expectSourceNotToContain(ts, 'function createCapabilityArtifactHistoryButton')
		expectSourceNotToContain(ts, '<span className="media-history-button-text">History</span>')
	})

	it('removes the ProseMirror ordered-list indent from every generated-media timeline level', () => {
		const scss = loadScss()
		const timelineBlock = extractBlock(
			scss,
			'.canvas-generated-media-projection-editor .ai-media-generation-progress > .progress-timeline,\n'
				+ '.canvas-generated-media-projection-editor .ai-media-generation-progress .progress-timeline-children',
		)
		const historyTimelineBlock = extractBlock(
			scss,
			'.canvas-generated-media-history-panel > .workspace-media-generation-progress,\n'
				+ '.canvas-generated-media-history-panel .ai-media-generation-progress',
		)

		expectExcerptToContain(timelineBlock, 'padding-left: 0;', 'generated media timeline')
		expectExcerptToContain(historyTimelineBlock, 'margin: 18px 0 0;', 'generated media history timeline')
	})

	it('uses the submitted Capability accent inside accepted-output history triggers', () => {
		const scss = loadScss()
		const historyTextRule = extractBlock(scss, '.media-history-button-text')
		const historyChipRule = extractBlock(scss, '.media-history-button-text .prompt-reference-chip')
		const historyCapabilityRule = extractBlock(
			scss,
			'.media-history-button-text .prompt-reference-chip-capability-module',
		)

		expectExcerptToContain(historyTextRule, '--prompt-reference-capability-module-color: #eca983;', 'history trigger badge')
		expectExcerptToContain(historyChipRule, 'font-size: inherit;', 'history trigger badge')
		expectExcerptToContain(historyCapabilityRule, 'color: var(--prompt-reference-capability-module-color);', 'history trigger badge')
	})

	it('renders the info panel in a viewport-transformed decoupled layer', () => {
		// The info panel is separate from the screen-space icon strip but still
		// belongs to the viewport overlay, so its content scales naturally with
		// the media node while the icon strip uses adaptive screen-space chrome.
		const panelPositionStart = ts.indexOf('function updateGeneratedMediaInfoPanelPosition(')
		const panelPositionEnd = ts.indexOf('// Video chrome', panelPositionStart)
		const panelPosition = ts.slice(panelPositionStart, panelPositionEnd)

		expectSourceToContain(ts, 'generatedMediaInfoPanelLayerEl = createGeneratedMediaInfoPanelLayer()')
		expectSourceToContain(ts, 'viewportOverlayEls: [mediaChromeViewportEl, generatedMediaInfoPanelLayerEl],')
		expectSourceNotToContain(ts, 'viewportOverlayEls: [mediaChromeViewportEl, generatedMediaChromeLayerEl]')
		expectSourceToContain(ts, 'function createGeneratedMediaInfoPanelChrome(node: ImageCanvasNode | VideoCanvasNode)')
		expectSourceToContain(ts, "panel.setAttribute('data-media-info-panel-node-id', node.nodeId)")
		expectSourceToContain(ts, 'generatedMediaInfoPanelLayerEl.replaceChildren(')
		expectSourceToContain(ts, 'const panelTop = position.y + dimensions.height + (extraTopOffsetScreen + iconStripScreenGap + iconScreenSize + iconStripScreenGap) / zoom')
		expectSourceToContain(ts, "transform: 'none',")
		expect(panelPositionStart).toBeGreaterThan(-1)
		expect(panelPositionEnd).toBeGreaterThan(panelPositionStart)
		expectExcerptToContain(panelPosition, 'getVideoControlsOutsideOffsetScreen(nodeId, viewport),', 'media info panel position updater')
		expectExcerptNotToContain(panelPosition, 'const stripRect = strip.getBoundingClientRect()', 'media info panel position updater')
		expectExcerptNotToContain(panelPosition, 'data-media-chrome-node-id', 'media info panel position updater')
	})
})

// =============================================================================
// Video node interaction (drag + resize parity with images)
// =============================================================================

describe('Workspace canvas — video node interaction', () => {
	const scss = loadScss()

	it('gives the video node + drag overlay the same box/pointer wiring as images', () => {
		// Without these the transparent drag overlay has no box, so pointer events
		// fall through to the canvas and a node drag becomes a canvas pan.
		// extractBlock matches the first occurrence of the selector; a nested
		// `.is-pending-generated-media-before-frame .video-drag-overlay` override
		// now precedes the top-level rule, so anchor to line start to get the base rule.
		const overlay = extractBlock(scss, '\n.video-drag-overlay')
		const imageOverlay = extractBlock(scss, '\n.image-drag-overlay')
		expectExcerptToContain(overlay, 'position: absolute', '.video-drag-overlay')
		expectExcerptToContain(overlay, 'z-index: 15', '.video-drag-overlay')
		expectExcerptToContain(overlay, 'top: 0', '.video-drag-overlay')
		expectExcerptToContain(overlay, 'left: 0', '.video-drag-overlay')
		expectExcerptToContain(overlay, 'right: 0', '.video-drag-overlay')
		expectExcerptToContain(overlay, 'bottom: 0', '.video-drag-overlay')
		expectExcerptToContain(overlay, 'background: transparent', '.video-drag-overlay')
		// Keep drag-hit parity with image drag overlays.
		expectExcerptToContain(imageOverlay, 'position: absolute', '.image-drag-overlay')
		expectExcerptToContain(imageOverlay, 'z-index: 15', '.image-drag-overlay')
		expectExcerptToContain(imageOverlay, 'top: 0', '.image-drag-overlay')
		expectExcerptToContain(imageOverlay, 'left: 0', '.image-drag-overlay')
		expectExcerptToContain(imageOverlay, 'right: 0', '.image-drag-overlay')
		expectExcerptToContain(imageOverlay, 'bottom: 0', '.image-drag-overlay')
		const nodeBlock = extractBlock(scss, '.workspace-video-node')
		expectExcerptToContain(nodeBlock, '&.is-dragging', '.workspace-video-node')
	})

	it('lets the visible video chrome and controls own hover while preserving pointer interaction', () => {
		const chrome = extractBlock(scss, '.workspace-video-chrome')
		const surface = extractBlock(scss, '.workspace-video-surface')
		const controlsHost = extractBlock(scss, '.workspace-video-controls-host')

		expectExcerptToContain(chrome, 'pointer-events: none', '.workspace-video-chrome')
		expectExcerptToContain(surface, 'pointer-events: auto', '.workspace-video-surface')
		expectExcerptToContain(controlsHost, 'pointer-events: none', '.workspace-video-controls-host')
		expectExcerptNotToContain(controlsHost, '&.is-visible', '.workspace-video-controls-host')
	})

	it('shows resize handles on video node hover/selection', () => {
		expectSourceToContain(scss, '.workspace-video-node:hover .workspace-handle')
		expectSourceToContain(scss, '.workspace-video-node.is-selected .workspace-handle')
	})
})

// =============================================================================
// Media descriptors
// =============================================================================

	describe('Workspace canvas — media descriptors', () => {
		const ts = loadTs()
		const svelte = loadWorkspaceCanvasSvelte()
		const scss = loadScss()

	it('derives a descriptor from generated media metadata for free (no extra model call)', () => {
		expectSourceToContain(ts, 'async function analyzeCanvasMediaStill(nodeId: string, stillAssetId: string, analysisAttempt = 0): Promise<void>')
		expectSourceToContain(ts, 'function getMediaDescriptorStillAssetId(node: ImageCanvasNode | VideoCanvasNode): string | undefined')
		expectSourceToContain(ts, 'patchMediaNodeDescriptor(nodeId, {')
		expectSourceToContain(ts, 'source: \'analysis\'')
		expectSourceToContain(ts, 'queueCanvasMediaAnalysis(')
	})

	it('captions uploaded media from a still (never the MP4) with an analyzing → ready flow', () => {
		// Images and videos share one Asset-owned still resolver: the API always
		// exposes a still-image rendition (the video's representative frame for
		// video Assets), so there is no separate fileId/posterFileId branch anymore.
		expectSourceToContain(ts, 'queueCanvasMediaAnalysis(preparedNode.nodeId, getMediaDescriptorStillAssetId(preparedNode))')
		expectSourceToContain(ts, 'queueCanvasMediaAnalysis(node.nodeId, getMediaDescriptorStillAssetId(node))')
		expectSourceToContain(ts, 'function getMediaDescriptorStillAssetId(node: ImageCanvasNode | VideoCanvasNode): string | undefined {\n        return node.assetId || undefined\n    }')
		expectSourceToContain(ts, 'function queueCanvasMediaAnalysis(nodeId: string, stillAssetId: string | undefined, attempt = 0, analysisAttempt = 0): void')
	})

	it('lets a Media Library insert carry its Asset-owned descriptor without a separate analysis pass', () => {
		// The descriptor lives on the shared Asset record now (assetsStore), not a
		// per-node copy that had to be captured and restored on re-insert. Inserting
		// an existing Asset onto the canvas does not re-trigger media analysis.
		const insertStart = ts.indexOf('onInsertAsset: async (item: AssetMeta) => {')
		const insertEnd = ts.indexOf('},', insertStart)
		expect(insertStart).toBeGreaterThan(-1)
		expect(insertEnd).toBeGreaterThan(insertStart)
		const insertHandler = ts.slice(insertStart, insertEnd)
		expectExcerptToContain(insertHandler, 'assetId: item.assetId,', 'media library insert handler')
		expectExcerptNotToContain(insertHandler, 'queueCanvasMediaAnalysis', 'media library insert handler')
	})

		it('shows an unobtrusive animated analyzing indicator with an explanation', () => {
			expectSourceToContain(ts, "getAssetDescriptor(node)?.status === 'analyzing'")
			const buttonBlock = extractBlock(scss, '.media-info-button')
			expectExcerptToContain(buttonBlock, '&.is-analyzing', '.media-info-button')
			expectSourceToContain(scss, '@keyframes workspace-media-analyzing-pulse')
			const descriptorBlock = extractBlock(scss, '.canvas-media-descriptor')
			expectExcerptToContain(descriptorBlock, '&.is-analyzing', '.canvas-media-descriptor')
		})

		it('keeps uploaded exotic media inert until the canonical object is returned', () => {
			expectSourceToContain(svelte, "type: 'operationStatus',")
			expectSourceToContain(svelte, "operation: 'upload',")
			expectSourceToContain(svelte, 'placeholderNodeId = insertUploadPlaceholder(file.name)')
			expectSourceToContain(svelte, 'placeholderNodeId = insertUploadPlaceholder(getRemotePlaceholderName(url))')
			expectSourceToContain(svelte, 'renderer?.replaceUploadPlaceholder(placeholderNodeId, node, false)')
			expectSourceToContain(svelte, 'renderer?.commitTransientCanvasNodeInsertion(nextCanvasState, nodeId, placeholderNodeId ?? undefined)')
			expectSourceToContain(ts, "candidate.type === 'operationStatus' && candidate.operation === 'upload' && candidate.nodeId === placeholderNodeId")
			expectSourceToContain(ts, 'viewportEl.querySelector(`[data-node-id="${replacedPlaceholderNodeId}"]`)?.remove()')
			expectSourceToContain(ts, 'appendCanvasNodeToDOM(insertedNode)')
			expectSourceToContain(ts, 'queueCanvasMediaAnalysis(preparedNode.nodeId, getMediaDescriptorStillAssetId(preparedNode))')
			expectSourceToContain(ts, 'if (observedAssetRevisions.get(assetId) !== revision) changedAssetIds.add(assetId)')
			expectSourceToContain(ts, 'pixiMediaLayer?.retryAssetTextures(changedAssetIds)')
			const insertionCommitStart = ts.indexOf('function commitTransientCanvasNodeInsertion(')
			const insertionCommitEnd = ts.indexOf('function commitCanvasMetadataState(', insertionCommitStart)
			const insertionCommit = ts.slice(insertionCommitStart, insertionCommitEnd)
			expectExcerptNotToContain(insertionCommit, 'selectNode(', 'transient upload insertion commit')
			expectSourceNotToContain(svelte, 'new Image()')
		})

		it('renders generic operation status and non-image upload node shells after reload', () => {
			expectSourceToContain(ts, "node.type === 'mediaDocument'")
			expectSourceToContain(ts, "node.type === 'audio'")
			expectSourceToContain(ts, "node.type === 'operationStatus'")
			expectSourceToContain(ts, 'function createOperationStatusNode(node: OperationStatusCanvasNode): HTMLElement')
			expectSourceToContain(scss, '.workspace-upload-placeholder-node')
			expectSourceToContain(ts, 'workspace-upload-placeholder-loading-spinner ai-response-loading-spinner')
			const loadingSpinnerBlock = extractBlock(scss, '.workspace-upload-placeholder-loading-spinner')
			expectExcerptNotToContain(loadingSpinnerBlock, 'border:', '.workspace-upload-placeholder-loading-spinner')
			expectExcerptNotToContain(loadingSpinnerBlock, 'animation: spin', '.workspace-upload-placeholder-loading-spinner')
		})
	})

// =============================================================================
// Content descriptors (documents & threads)
// =============================================================================

describe('Workspace canvas — content descriptors (documents & threads)', () => {
	const ts = loadTs()

	it('lets the API self-heal weak or missing text descriptors instead of analyzing text on the client', () => {
		// Text/document descriptor generation used to run client-side
		// (analyzeTextNode/patchTextNodeDescriptor/scheduleTextNodeDescriptor). It
		// now happens server-side: workspace-context resolution reports which
		// descriptors it improved, and the client just reloads those Assets.
		expectSourceNotToContain(ts, 'async function analyzeTextNode(')
		expectSourceNotToContain(ts, 'function patchTextNodeDescriptor(')
		expectSourceNotToContain(ts, 'function scheduleTextNodeDescriptor(')
		expectSourceToContain(ts, 'function patchWorkspaceContextImprovedDescriptors(improvedDescriptors: Record<string, ContentDescriptor> | undefined): void')
		expectSourceToContain(ts, 'if (!improvedDescriptors || Object.keys(improvedDescriptors).length === 0) return')
		expectSourceToContain(ts, 'void assetService.loadWorkspaceAssets(workspaceId).then(() => {')
	})

	it('feeds improved descriptors from workspace-context resolution into the Asset reload path', () => {
		const resolutionStart = ts.indexOf('function handleWorkspaceContextResolution(')
		const resolutionEnd = ts.indexOf('\n    }', resolutionStart)
		expect(resolutionStart).toBeGreaterThan(-1)
		expect(resolutionEnd).toBeGreaterThan(resolutionStart)
		const resolutionBody = ts.slice(resolutionStart, resolutionEnd)
		expectExcerptToContain(resolutionBody, 'patchWorkspaceContextImprovedDescriptors(resolution.improvedDescriptors)', 'handleWorkspaceContextResolution')
	})

	it('clears pending descriptor timers on destroy', () => {
		expectSourceToContain(ts, 'for (const timer of textDescriptorTimers.values()) clearTimeout(timer)')
	})
})

// =============================================================================
// Parent-child world positioning
// =============================================================================

describe('Workspace canvas — parent-child world positioning', () => {
	const ts = loadTs()

	it('feeds world-space nodes into the connection manager', () => {
		const fnMatch = ts.match(/function\s+getNodesForConnectionManager[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'getNodeWorldPosition(node, nodesById)')
		expectExcerptToContain(fnBody, 'delete nodeForConnection.parentId')
		expectExcerptToContain(fnBody, 'delete nodeForConnection.expandParent')
		expectExcerptToContain(fnBody, 'delete nodeForConnection.extent')
		expectExcerptNotToContain(ts, 'connectionManager?.syncNodes(nextState.nodes)')
		expectExcerptNotToContain(ts, 'connectionManager.syncNodes(currentCanvasState.nodes)')
	})

	it('keeps existing branch-marker DOM geometry in lockstep with rebalanced pending media', () => {
		const syncMatch = ts.match(/function\s+syncExistingBranchMarkerNodeToDOM[\s\S]*?^    \}/m)
		expect(syncMatch).not.toBeNull()
		const syncBody = syncMatch![0]
		expectExcerptToContain(syncBody, 'syncCanvasNodeDomGeometry([branchMarkerNode])')
		expectExcerptToContain(syncBody, 'syncBranchMarkerNodeContent(branchMarkerNode, nodeEl)')
		expectExcerptToContain(syncBody, 'syncConnectionsAfterManualNodeAppend()')

		const originMatch = ts.match(/function\s+appendBranchOriginNodeToDOM[\s\S]*?^    \}/m)
		const forkMatch = ts.match(/function\s+appendBranchForkNodeToDOM[\s\S]*?^    \}/m)
		const lineMatch = ts.match(/function\s+appendBranchLineNodeToDOM[\s\S]*?^    \}/m)
		expect(originMatch).not.toBeNull()
		expect(forkMatch).not.toBeNull()
		expect(lineMatch).not.toBeNull()
		expectExcerptToContain(originMatch![0], 'syncExistingBranchMarkerNodeToDOM(branchOriginNode)')
		expectExcerptToContain(forkMatch![0], 'syncExistingBranchMarkerNodeToDOM(branchForkNode)')
		expectExcerptToContain(lineMatch![0], 'syncExistingBranchMarkerNodeToDOM(branchLineNode)')
	})

	it('checks viewport visibility against world-space node rectangles', () => {
		const fnMatch = ts.match(/function\s+isNodeInViewport[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'const worldRect = getNodeWorldRect(node)')
		expectExcerptToContain(fnBody, 'const screenLeft = worldRect.x * zoom + x')
		expectExcerptNotToContain(fnBody, 'node.position.x * zoom')
	})
})

// =============================================================================
// Workspace AI chat panel — stable reload path
// =============================================================================

describe('Workspace canvas — AI panel reload stability', () => {
	const ts = loadTs()

	it('tracks the mounted panel thread separately from the selected active thread', () => {
		expectSourceToContain(ts, 'let activeAiChatPanelThreadId: string | null = null')
		expectSourceToContain(ts, 'function destroyActiveAiChatPanel(')
		expectSourceToContain(ts, 'clearActive = false')
		expectSourceToContain(ts, 'panelThreadId = activeAiChatPanelThreadId ?? activeAiChatThreadId')
		expectSourceToContain(ts, 'preserveTabsSwitch = false')
		expectSourceToContain(ts, 'threadEditors.get(panelThreadId)')
		expectSourceToContain(ts, 'promptInputController.unregisterThreadEditor(panelThreadId)')
		expectSourceToContain(ts, 'activeAiChatPanelThreadId = panelThreadId')
	})

	it('captures panel thread id in editor callbacks instead of reading mutable active thread state', () => {
		const fnMatch = ts.match(/function\s+renderActiveAiChatPanel[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, "const panelThreadId = activeSidebarTab?.type === 'thread' ? activeSidebarTab.refId : null")
		expectExcerptToContain(fnBody, 'conversationAssetId: panelThreadId')
		expectExcerptToContain(fnBody, 'threadId: panelThreadId')
		expectExcerptToContain(fnBody, 'threadEditors.set(panelThreadId')
		expectExcerptToContain(fnBody, 'promptInputController.registerThreadEditor(panelThreadId')
		expectExcerptNotToContain(fnBody, 'threadId: activeAiChatThreadId!')
		expectExcerptNotToContain(fnBody, 'referenceId: activeAiChatThreadId!')
	})

	it('keys canvas rerender detection on thread id plus loaded/pending content state', () => {
		const fnMatch = ts.match(/function\s+getAiChatThreadsKey[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'return threads')
		expectExcerptToContain(fnBody, '.filter(t => !isDetachedCanvasThreadId(t.threadId))')
		expectExcerptToContain(fnBody, '.map(t => `${t.threadId}:${t.content ? \'loaded\' : \'pending\'}`)')
		expectExcerptToContain(fnBody, '.join(\',\')')
	})

	it('refreshes only the active panel when deferred thread content arrives', () => {
		expectSourceToContain(ts, 'function refreshActiveAiChatPanelWhenContentLoads(): void')
		expectSourceToContain(ts, 'if (activeAiChatPanelHadContent) return')
		expectSourceToContain(ts, 'renderActiveAiChatPanel(thread)')
		expectSourceToContain(ts, 'refreshActiveAiChatPanelWhenContentLoads()')
		expectSourceToContain(ts, 'if (aiChatPanelState.isOpen && !activeAiChatPanelEl) renderActiveAiChatPanel()')
	})

	it('preserves local visual drag commits when active-panel renders arrive stale', () => {
		expectSourceToContain(ts, 'mergeIncomingCanvasStateWithPendingVisualCommit,')
		expectSourceToContain(ts, 'let pendingLocalCanvasVisualCommit: PendingCanvasVisualCommit | null = null')
		expectSourceToContain(ts, 'pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(persistedCanvasState)')
		expectSourceToContain(ts, 'const renderStatePlan = mergeIncomingCanvasStateWithPendingVisualCommit({')
		expectSourceToContain(ts, 'const normalizedCanvasState = renderStatePlan.state')
		expectSourceToContain(ts, 'preserveActiveGeneratedMediaTrackersInState(persistedCanvasState)')
		expectSourceToContain(ts, 'currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState')
	})
})

// =============================================================================
// Workspace canvas — detached generation resume stability
// =============================================================================

describe('Workspace canvas — detached generation resume stability', () => {
	const ts = loadTs()

	it('reattaches hidden receive-only editors for active detached canvas runs after reload', () => {
		const getActiveThreadIdsBody = extractFunctionBody(ts, 'getActiveDetachedCanvasRunThreadIds')
		const reattachBody = extractFunctionBody(ts, 'reattachDetachedCanvasRunListenersForActiveMarkers')
		const createEditorBody = extractFunctionBody(ts, 'createDetachedCanvasThreadEditor')

		expectExcerptToContain(getActiveThreadIdsBody, 'if (currentCanvasState) {', 'detached run active thread lookup')
		expectExcerptToContain(getActiveThreadIdsBody, 'for (const node of currentCanvasState.nodes)', 'detached run active thread lookup')
		expectExcerptToContain(getActiveThreadIdsBody, 'for (const thread of currentAiChatThreads)', 'detached run active thread lookup')
		expectExcerptToContain(getActiveThreadIdsBody, "thread.owner?.type !== 'standalone'", 'detached run active thread lookup')
		expectExcerptToContain(getActiveThreadIdsBody, 'hasDetachedCanvasRunCanvasProjection(thread.threadId)', 'detached run active thread lookup')
		expectExcerptToContain(getActiveThreadIdsBody, 'isRecentDetachedCanvasThreadUpdate(thread)', 'detached run active thread lookup')
		expectExcerptToContain(getActiveThreadIdsBody, 'aiChatThreadHasRecoverableDetachedCanvasTurn(thread)', 'detached run active thread lookup')
		expectSourceNotToContain(ts, 'aiChatThreadHasSubmittedUserMessageWithoutResponse')
		const restoreIndex = reattachBody.indexOf('restoreDetachedCanvasPreflightMarkersForActiveThreads()')
		const loopIndex = reattachBody.indexOf('for (const threadId of getActiveDetachedCanvasRunThreadIds())')
		expect(restoreIndex).toBeGreaterThan(-1)
		expect(loopIndex).toBeGreaterThan(restoreIndex)
		expectExcerptToContain(reattachBody, 'for (const threadId of getActiveDetachedCanvasRunThreadIds())', 'detached run reattach')
		expectExcerptToContain(reattachBody, 'ensureDetachedCanvasRunTeardown(threadId)', 'detached run reattach')
		expectExcerptToContain(reattachBody, 'promptInputController.setReceiving(threadId, true)', 'detached run reattach')
		expectExcerptToContain(reattachBody, 'createDetachedCanvasThreadEditor({ thread })', 'detached run reattach')
		expectExcerptToContain(createEditorBody, 'receiveOnly: true', 'detached canvas editor')
		expectExcerptToContain(createEditorBody, 'baseVersion: getStoredProseMirrorVersion(thread)', 'detached canvas editor')
		expectSourceToContain(ts, 'reattachDetachedCanvasRunListenersForActiveMarkers()')
	})

	it('creates detached canvas threads with the submitted user message already persisted', () => {
		const submitBody = extractFunctionBody(ts, 'submitCanvasGenerationRun')
		const submitPersistedBody = extractFunctionBody(ts, 'submitPersistedDetachedCanvasThreadMessage')
		const markerContentBody = extractFunctionBody(ts, 'createBranchMarkerContent')

		expectExcerptToContain(submitBody, 'const initialContent = {', 'detached run submit')
		expectExcerptToContain(submitBody, "type: 'aiUserMessage'", 'detached run submit')
		expectExcerptToContain(submitBody, 'referenceNodeIds: explicitContextNodeIds', 'detached run submit')
		expectExcerptToContain(submitBody, 'content: initialContent', 'detached run submit')
		expectExcerptToContain(submitBody, 'createDetachedCanvasThreadEditor({', 'detached run submit')
		expectExcerptToContain(submitBody, 'submitPersistedDetachedCanvasThreadMessage(threadId)', 'detached run submit')
		expectExcerptNotToContain(submitBody, 'promptInputController.submitMessage', 'detached run submit')
		expectExcerptToContain(submitPersistedBody, 'editorView.state.doc.descendants', 'persisted detached submit')
		expectExcerptToContain(submitPersistedBody, 'node.type?.name === \'aiChatThread\' && node.attrs?.threadId === threadId', 'persisted detached submit')
		expectExcerptToContain(submitPersistedBody, 'setMeta(USE_AI_CHAT_META, { threadId, nodePos })', 'persisted detached submit')
		expectExcerptToContain(markerContentBody, 'getBranchMarkerPromptPartsForNode(node, threadPreview)', 'detached marker Capability badge order')
		expectExcerptToContain(markerContentBody, 'renderBranchMarkerPromptParts(promptPreviewParts, {', 'detached marker Capability badge order')
		expectExcerptNotToContain(markerContentBody, '${promptReferenceBadges}', 'detached marker Capability badge order')
	})

	it('keeps exact submitted prompt atoms in the preflight marker and uses deterministic sizing', () => {
		const submitBody = extractFunctionBody(ts, 'createDetachedCanvasThreadEditor')
		const promptPartsBody = extractFunctionBody(ts, 'getBranchMarkerPromptPartsForNode')
		const screenProjectionBody = extractFunctionBody(ts, 'applyPendingBranchMarkerScreenProjection')

		expectExcerptToContain(submitBody, 'const promptParts = getBranchMarkerPromptParts({', 'preflight prompt snapshot')
		expectExcerptToContain(submitBody, 'promptParts,', 'preflight prompt snapshot')
		expectExcerptToContain(promptPartsBody, 'pendingGeneratedImagePlacements.get(placementKey)?.promptParts', 'preflight prompt snapshot')
		expectExcerptToContain(promptPartsBody, 'resolveBranchMarkerPromptParts({', 'preflight prompt snapshot')
		expectExcerptToContain(promptPartsBody, 'persistedUserMessage: preview?.userMessage', 'preflight prompt snapshot')
		expectExcerptNotToContain(promptPartsBody, 'if (node.pendingState)', 'preflight prompt snapshot')
		expectExcerptNotToContain(screenProjectionBody, 'scrollWidth', 'preflight marker sizing')
		expectExcerptNotToContain(screenProjectionBody, "width: 'max-content'", 'preflight marker sizing')
	})

	it('restores preflight markers from persisted standalone canvas threads after early reload', () => {
		const restoreBody = extractFunctionBody(ts, 'restoreDetachedCanvasPreflightMarkersForActiveThreads')
		const insertBody = extractFunctionBody(ts, 'insertPendingBranchMarkerForPersistedCanvasThread')
		const activeTurnBody = extractFunctionBody(ts, 'aiChatThreadHasRecoverableDetachedCanvasTurn')

		expectExcerptToContain(activeTurnBody, 'aiChatThreadHasSubmittedUserMessage(thread)', 'recoverable detached turn')
		expectExcerptToContain(activeTurnBody, 'aiChatThreadHasInProgressContent(thread)', 'recoverable detached turn')
		expectExcerptToContain(restoreBody, 'for (const threadId of getActiveDetachedCanvasRunThreadIds())', 'detached preflight restore')
		expectExcerptToContain(restoreBody, 'getPersistedAiChatThread(threadId)', 'detached preflight restore')
		expectExcerptToContain(restoreBody, 'insertPendingBranchMarkerForPersistedCanvasThread(thread)', 'detached preflight restore')
		expectExcerptToContain(insertBody, 'const promptText = getLatestAiUserMessageText(thread)', 'persisted marker restore')
		expectExcerptToContain(insertBody, 'getDetachedThreadPendingModelStates(thread, promptText)', 'persisted marker restore')
		expectExcerptToContain(insertBody, 'const nodeId = `pending-branch-${threadId}-${index}`', 'persisted marker restore')
		expectExcerptToContain(
			insertBody,
			'const generationRequestId = pendingGeneratedImagePlacements.get(threadId)?.generationRequestId ?? threadId',
			'persisted marker restore',
		)
		expectExcerptToContain(insertBody, 'generationRequestId,', 'persisted marker restore')
		expectExcerptToContain(insertBody, 'commitTransientCanvasStatePreservingEditors({', 'persisted marker restore')
		expectExcerptToContain(insertBody, 'syncPendingBranchMarkerScreenPlacements()', 'persisted marker restore')
	})

	it('recovers pending branch marker records from persisted canvas state when memory maps are empty', () => {
		const recoverBody = extractFunctionBody(ts, 'recoverPendingBranchMarkerRecordFromCanvasState')
		const getRecordBody = extractFunctionBody(ts, 'getPendingBranchMarkerRecord')
		const ensureRecordBody = extractFunctionBody(ts, 'ensurePendingBranchMarkerRecordForApiRun')

		expectExcerptToContain(recoverBody, 'isBranchMarkerNode(node)\n            && Boolean(node.pendingState)\n            && getBranchMarkerThreadId(node) === threadId', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'lineageAssignment?.branchForkNodeId', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'lineageAssignment?.branchLineNodeId', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'lineageAssignment?.branchOriginNodeId', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'generationRun?.reasoningRunId && runNode.reasoningRunId === generationRun.reasoningRunId', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'generationRun?.mediaRunId && runNode.mediaRunId === generationRun.mediaRunId', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'node.pendingState?.reasoningIndex === generationRun.reasoningIndex', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'normalizeBranchMarkerModelValue(node.pendingState?.reasoningModelId)', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'requestMatches.length === 1 ? requestMatches[0] : undefined', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'pendingBranchMarkers.set(placementKey, record)', 'pending marker recovery')
		expectExcerptToContain(recoverBody, 'setPendingBranchMarkerRecordAliases(threadId, generationRun, record)', 'pending marker recovery')
		expectExcerptToContain(getRecordBody, 'return recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)', 'pending marker lookup')
		expectExcerptToContain(ensureRecordBody, 'return recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)', 'pending marker lookup')
	})

	it('recreates preflight pending branch markers from replayed lineage plans after early reload', () => {
		const insertBody = extractFunctionBody(ts, 'insertPendingBranchMarkersFromLineagePlan')
		const specBody = extractFunctionBody(ts, 'buildPendingBranchMarkerSpecsFromLineagePlan')
		const applyLineageBody = extractFunctionBody(ts, 'applyMediaBranchLineagePlan')
		const insertIndex = applyLineageBody.indexOf('insertPendingBranchMarkersFromLineagePlan(threadId, lineagePlan, generationRun)')
		const resolveIndex = applyLineageBody.indexOf('resolvePendingBranchMarkersForLineagePlan(threadId, lineagePlan, generationRun)')

		expectExcerptToContain(specBody, 'getUniqueLineageAssignmentsForMarkers(lineagePlan)', 'lineage preflight marker specs')
		expectExcerptToContain(specBody, 'buildGenerationRunFromLineageAssignment(lineagePlan, assignment, sourceGenerationRun)', 'lineage preflight marker specs')
		expectExcerptToContain(specBody, "phase: 'preflight'", 'lineage preflight marker specs')
		expectExcerptToContain(specBody, 'promptText: assignment.promptText || lineagePlan.promptText', 'lineage preflight marker specs')
		expectExcerptToContain(insertBody, 'const lineagePlacementKey = `${threadId}:${lineagePlan.generationRequestId}`', 'lineage preflight marker insert')
		expectExcerptToContain(insertBody, 'hasPendingBranchMarkerForPlacement(lineagePlacementKey)', 'lineage preflight marker insert')
		expectExcerptToContain(insertBody, 'hasCanvasBranchMarkerForPlacement(lineagePlacementKey)', 'lineage preflight marker insert')
		expectExcerptToContain(insertBody, 'generationRequestId: lineagePlan.generationRequestId', 'lineage preflight marker insert')
		expectExcerptToContain(insertBody, 'conversationAssetId: threadId', 'lineage preflight marker insert')
		expectExcerptToContain(insertBody, 'setPendingBranchMarkerRecordAliases(threadId, spec.generationRun, record)', 'lineage preflight marker insert')
		expectExcerptToContain(insertBody, 'commitTransientCanvasStatePreservingEditors({', 'lineage preflight marker insert')
		expectExcerptToContain(applyLineageBody, '!hasCompletePlannedBranchMarkerGeometry(currentCanvasState.nodes, lineagePlan)', 'lineage marker geometry gate')
		expect(insertIndex).toBeGreaterThan(-1)
		expect(resolveIndex).toBeGreaterThan(insertIndex)
	})

	it('never rewrites API-planned branch marker geometry during lineage handoff', () => {
		const ensureOriginBody = extractFunctionBody(ts, 'ensureBranchOriginForGeneratedMedia')
		const ensureForkBody = extractFunctionBody(ts, 'ensureBranchForkForGeneratedMedia')
		const ensureLineBody = extractFunctionBody(ts, 'ensureBranchLineForGeneratedMedia')
		const resolveBody = extractFunctionBody(ts, 'resolvePendingBranchMarkerWithLineagePlan')
		const applyApiGeometryBody = extractFunctionBody(ts, 'applyApiCanvasGeometry')

		expectExcerptToContain(ensureOriginBody, "if (existing?.type === 'branchOrigin') {\n            return existing as BranchOriginCanvasNode", 'branch origin geometry ownership')
		expectExcerptToContain(ensureForkBody, "if (existing?.type === 'branchFork') {\n            return existing as BranchForkCanvasNode", 'branch fork geometry ownership')
		expectExcerptToContain(ensureLineBody, "if (existing?.type === 'branchLine' && existing.pendingState?.phase !== 'preflight') {\n            return existing as BranchLineCanvasNode", 'branch line geometry ownership')
		expectExcerptNotToContain(resolveBody, 'positionPendingBranchMarkerBeforeGeneratedMedia', 'pending marker promotion')
		expectExcerptToContain(applyApiGeometryBody, 'resolvePendingBranchMarkersAfterApiGeometry(canvasGeometry.generationRequestId)', 'API geometry lineage handoff')
		expectSourceNotToContain(ts, 'shouldReplaceApiFallbackFreshRootPosition')
	})

	it('keeps branch marker planning and pending-state clearing transient so they cannot overwrite API-owned media membership', () => {
		const resolveBody = extractFunctionBody(ts, 'resolvePendingBranchMarkerWithLineagePlan')
		const clearBody = extractFunctionBody(ts, 'clearPendingBranchMarkerStateForRun')

		expectExcerptToContain(resolveBody, 'commitTransientCanvasStatePreservingEditors({', 'pending marker promotion')
		expectExcerptNotToContain(resolveBody, 'commitCanvasStatePreservingEditors({', 'pending marker promotion')
		expectExcerptToContain(clearBody, 'commitTransientCanvasStatePreservingEditors({', 'pending marker clearing')
		expectExcerptNotToContain(clearBody, 'commitCanvasStatePreservingEditors({', 'pending marker clearing')
	})

	it('allows branch marker details once generated media has taken over stale pending state', () => {
		const phaseBody = extractFunctionBody(ts, 'getBranchMarkerUiPhase')
		const activeBody = extractFunctionBody(ts, 'isBranchMarkerGenerationActive')
		const pendingBody = extractFunctionBody(ts, 'isCurrentBranchMarkerPending')
		const clickBody = extractFunctionBody(ts, 'handleBranchMarkerInfoClick')
		const branchOriginBody = extractFunctionBody(ts, 'createBranchOriginNode')
		const branchForkBody = extractFunctionBody(ts, 'createBranchForkNode')
		const branchLineBody = extractFunctionBody(ts, 'createBranchLineNode')

		expectExcerptToContain(phaseBody, "if (hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)) return 'media-placeholder'", 'branch marker UI phase')
		expectExcerptToContain(activeBody, 'if (hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)) return false', 'branch marker active check')
		expectExcerptToContain(pendingBody, '&& !hasStartedGeneratedMediaForBranchMarkerNode(node.nodeId)', 'branch marker pending click guard')
		expectExcerptToContain(clickBody, "console.info('[CANVAS][branch-marker-info]', 'info-click'", 'branch marker info click')
		expectExcerptToContain(clickBody, 'wouldHaveBeenBlockedByPendingState', 'branch marker info click')
		expectExcerptToContain(clickBody, "if (node.type === 'branchOrigin')", 'branch marker info click')
		expectExcerptNotToContain(clickBody, 'if (blocked) return', 'branch marker info click')
		expectExcerptNotToContain(clickBody, 'if (wouldHaveBeenBlockedByPendingState) return', 'branch marker info click')
		expectExcerptToContain(branchOriginBody, 'handleBranchMarkerInfoClick(node.nodeId)', 'branch origin node')
		expectExcerptToContain(branchForkBody, 'handleBranchMarkerInfoClick(node.nodeId)', 'branch fork node')
		expectExcerptToContain(branchLineBody, 'handleBranchMarkerInfoClick(node.nodeId)', 'branch line node')
		expectExcerptNotToContain(branchOriginBody, 'if (!isCurrentBranchMarkerPending(node.nodeId)) toggleBranchOriginGeneratedMediaInfo(node.nodeId)', 'branch origin node')
		expectExcerptNotToContain(branchForkBody, 'if (!isCurrentBranchMarkerPending(node.nodeId)) toggleBranchForkGeneratedMediaInfo(node.nodeId)', 'branch fork node')
		expectExcerptNotToContain(branchLineBody, 'if (!isCurrentBranchMarkerPending(node.nodeId)) toggleBranchLineGeneratedMediaInfo(node.nodeId)', 'branch line node')
	})

	it('restores branch cancellation controls from persisted nonterminal output state after reload', () => {
		const activeBody = extractFunctionBody(ts, 'isBranchMarkerGenerationGroupActive')
		const stopBody = extractFunctionBody(ts, 'stopBranchMarkerGeneration')

		expectExcerptToContain(activeBody, 'const hasPersistedActiveOutput = generatedOutputNodes.some', 'branch group activity recovery')
		expectExcerptToContain(activeBody, 'isPersistedMediaGenerationActive({', 'branch group activity recovery')
		expectExcerptToContain(activeBody, 'progressStatus: outputNode.generationProgress?.status', 'branch group activity recovery')
		expectExcerptToContain(activeBody, 'mediaGenerationPhase: outputNode.mediaGenerationPhase', 'branch group activity recovery')
		expectExcerptToContain(activeBody, 'if (hasPersistedActiveOutput) return true', 'branch group activity recovery')
		expectExcerptToContain(stopBody, 'conversationAssetId: threadId', 'reloaded branch cancellation')
		expectExcerptToContain(stopBody, 'generationRequestId: projectionGenerationRequestId', 'reloaded branch cancellation')
	})

	it('clears pending marker state and refreshes persisted thread content when a media run finishes', () => {
		const finishBody = extractFunctionBody(ts, 'finishGeneratedMediaRun')
		const clearIndex = finishBody.indexOf('clearPendingBranchMarkerStateForRun(threadId, generationRun)')
		const refreshIndex = finishBody.indexOf('schedulePersistedAiChatThreadRefreshForBranchMarkers(threadId)')
		const activeRunIndex = finishBody.indexOf('if (activeRunKeys.size > 0)')

		expect(clearIndex).toBeGreaterThan(-1)
		expect(refreshIndex).toBeGreaterThan(clearIndex)
		expect(activeRunIndex).toBeGreaterThan(refreshIndex)
		expectExcerptToContain(finishBody, 'if (generationRun.reasoningRunId) activeRunKeys.delete(generationRun.reasoningRunId)', 'finish generated media run')
		expectExcerptToContain(finishBody, 'if (generationRun.mediaRunId) activeRunKeys.delete(generationRun.mediaRunId)', 'finish generated media run')
		// The final settling run now schedules detached-canvas-run teardown so a
		// resumed background generation cleans up its hidden receive-only editor.
		expectExcerptToContain(finishBody, 'settleDetachedCanvasRun(threadId)', 'finish generated media run')
		expectExcerptToContain(finishBody, 'scheduleDetachedCanvasRunTeardown(threadId)', 'finish generated media run')
	})

	it('performs bounded post-completion fetches to replace live thread overrides with persisted content', () => {
		const refreshBody = extractFunctionBody(ts, 'refreshPersistedAiChatThreadForBranchMarkers')
		const scheduleBody = extractFunctionBody(ts, 'schedulePersistedAiChatThreadRefreshForBranchMarkers')

		// The thread's persisted content now resolves through the Asset document
		// model (assetService + assetDocumentsStore) instead of a dedicated
		// aiChatThreadService lookup.
		expectExcerptToContain(refreshBody, 'const asset = await assetService.get(threadId, workspaceId)', 'persisted AI thread refresh')
		expectExcerptToContain(refreshBody, "await assetService.resumeDocument({", 'persisted AI thread refresh')
		expectExcerptToContain(refreshBody, "const snapshot = assetDocumentsStore.get(asset.assetId, 'conversation')", 'persisted AI thread refresh')
		expectExcerptToContain(refreshBody, 'if (fetchedVersion < currentVersion) return', 'persisted AI thread refresh')
		expectExcerptToContain(refreshBody, 'rememberAiChatThreadRecord(thread)', 'persisted AI thread refresh')
		expectExcerptToContain(refreshBody, 'liveAiChatThreadContentOverrides.delete(threadId)', 'persisted AI thread refresh')
		expectExcerptToContain(refreshBody, 'refreshBranchMarkersForAiChatThread(threadId)', 'persisted AI thread refresh')
		expectExcerptToContain(scheduleBody, 'window.clearTimeout(timer)', 'persisted AI thread refresh scheduler')
		expectExcerptToContain(scheduleBody, 'const retryDelaysMs = [400, 1000, 1600, 3000]', 'persisted AI thread refresh scheduler')
		expectExcerptToContain(scheduleBody, 'void refreshPersistedAiChatThreadForBranchMarkers(threadId)', 'persisted AI thread refresh scheduler')
		expectExcerptToContain(scheduleBody, 'scheduleAttempt(attempt + 1)', 'persisted AI thread refresh scheduler')
	})
})

// =============================================================================
// Workspace canvas — viewport ownership during store renders
// =============================================================================

describe('Workspace canvas — viewport ownership during store renders', () => {
	const ts = loadTs()
	const svelte = loadWorkspaceCanvasSvelte()

	it('routes same-workspace render decisions through the stale viewport planner', () => {
		expectSourceToContain(ts, 'shouldPreserveLiveViewportForSameWorkspaceRender({')
		expectSourceToContain(ts, 'incomingViewport: effectiveCanvasState?.viewport,')
		expectSourceToContain(ts, 'liveViewport,')
		expectSourceToContain(ts, 'workspaceChanged,')
	})

	it('keeps stale same-workspace renders from applying a transform jump', () => {
		expectSourceToContain(ts, 'const liveViewport = getLiveViewport()')
		expectSourceToContain(ts, 'currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState')
		expectSourceToContain(ts, 'panZoom?.syncViewport(liveViewport)')
		expectSourceNotToContain(ts, 'viewportBridge?.applyViewport(liveViewport)')
	})

	it('updates local canvas and pending commit viewports immediately during live pan or zoom', () => {
		expectSourceToContain(ts, 'function updateCurrentCanvasViewport(viewport: Viewport): void')
		expectSourceToContain(ts, 'pendingLocalCanvasVisualCommit = updatePendingCanvasVisualCommitViewport(pendingLocalCanvasVisualCommit, viewport)')
		expectSourceToContain(ts, 'syncViewportInteractionState(vp)')
		expectSourceToContain(ts, 'updateCurrentCanvasViewport(vp)')
		expectSourceToContain(ts, 'viewportBridge?.applyViewport(vp)')
		expectSourceToContain(ts, 'onViewportChange?.(vp)')
	})

	it('persists every Svelte-side canvas save with the current live viewport', () => {
		expectSourceToContain(svelte, 'const stateToPersist = {')
		expectSourceToContain(svelte, '...newCanvasState,')
		expectSourceToContain(svelte, 'viewport: stateViewport,')
		expectSourceToContain(svelte, 'workspaceStore.updateCanvasState(stateToPersist)')
		expectSourceToContain(svelte, 'canvasState: stateToPersist')
	})

	it('does not expose route workspace canvas state until the workspace load succeeds', () => {
		expectSourceToContain(svelte, 'LoadingStatus')
		expectSourceToContain(svelte, 'let canvasState = $derived(isRouteWorkspaceLoaded && $workspaceStore.meta.loadingStatus === LoadingStatus.success ? $workspaceStore.data.canvasState : null)')
	})

	it('keeps workspace load feedback in the TypeScript canvas layer', () => {
		const loadingOutlineTs = loadWorkspaceLoadingOutline()

		expectSourceToContain(ts, 'workspaceLoadingOutline = createWorkspaceLoadingOutline({')
		expectSourceToContain(ts, 'workspaceLoadingOutline?.setErrorMessage(getWorkspaceLoadErrorMessage(data.error))')
		expectSourceToContain(loadingOutlineTs, 'class WorkspaceLoadingOutline implements WorkspaceLoadingOutlineInstance')
		expectSourceToContain(loadingOutlineTs, 'setErrorMessage = (message: string | null): void')
		expectSourceToContain(loadingOutlineTs, 'className="workspace-loading-error"')
		expectSourceNotToContain(svelte, 'workspace-loading-error')
	})

	it('refuses to persist a debounced viewport after a newer viewport arrives', () => {
		expectSourceToContain(svelte, 'const scheduledViewport = nextViewport')
		expectSourceToContain(svelte, 'viewport.x !== scheduledViewport.x')
		expectSourceToContain(svelte, 'viewport.y !== scheduledViewport.y')
		expectSourceToContain(svelte, 'viewport.zoom !== scheduledViewport.zoom')
		expectSourceToContain(svelte, 'if (persistViewportState(scheduledViewport)) pendingViewportSave = null')
	})

	it('no longer owns a fallback document-save debounce in the Svelte canvas host', () => {
		// Document/thread persistence moved to the ProseMirror authority service's
		// own collab flow; the Svelte host wires these callbacks as no-ops instead
		// of maintaining its own per-document debounce-and-POST bookkeeping.
		expectSourceToContain(svelte, 'onDocumentContentChange: () => {},')
		expectSourceToContain(svelte, 'onAiChatThreadContentChange: () => {},')
		expectSourceNotToContain(svelte, 'const documentSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()')
		expectSourceNotToContain(svelte, 'const pendingDocumentUpdates = new Map<string, PendingDocumentUpdate>()')
		expectSourceNotToContain(svelte, 'function scheduleDocumentUpdate(update: PendingDocumentUpdate): void')
	})
})

// =============================================================================
// Workspace AI chat panel — session history interactions
// =============================================================================

describe('Workspace AI chat panel — session history interactions', () => {
	const ts = loadTs()
	const scss = loadScss()
	const svgIcons = loadSvgIcons()

	it('uses only the history toggle control in the chat session header', () => {
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-toggle')
		expectSourceToContain(ts, 'aria-label="Toggle session history"')
		expectSourceToContain(ts, 'aria-controls="workspace-ai-chat-panel-sessions"')
		expectSourceToContain(ts, 'const historyToggleEl = controlsEl.querySelector<HTMLButtonElement>(\'.workspace-ai-chat-panel-history-toggle\')!')
		expectSourceToContain(ts, 'historyToggleEl.addEventListener(\'click\', () => {')
		expectSourceNotToContain(ts, 'workspace-ai-chat-panel-new-chat')
		expectSourceNotToContain(ts, 'startNewAiChatDraft')
		const sessionHeaderStart = ts.indexOf('const controlsEl = html`<div className="workspace-ai-chat-panel-context-controls">')
		const sessionsListStart = ts.indexOf('const sessionsEl =', sessionHeaderStart)
		expect(sessionHeaderStart).toBeGreaterThan(-1)
		expect(sessionsListStart).toBeGreaterThan(sessionHeaderStart)
		const sessionHeaderBlock = ts.slice(sessionHeaderStart, sessionsListStart)
		expectExcerptNotToContain(sessionHeaderBlock, 'xCircleIcon', 'chat session header')
		expectSourceToContain(svgIcons, 'export const aiChatPanelToggleHistoryIcon')
	})

	it('styles the session control row and session entry details consistently', () => {
		const historyToggleBlock = extractBlock(scss, '.workspace-ai-chat-panel-history-toggle')
		const sessionBlock = extractBlock(scss, '.workspace-ai-chat-panel-session')
		const titleBlock = extractBlock(scss, '.workspace-ai-chat-panel-session-title')
		expectExcerptToContain(historyToggleBlock, 'display: grid', 'session controls block')
		expectExcerptToContain(historyToggleBlock, 'place-items: center', 'session controls block')
		expectExcerptToContain(historyToggleBlock, 'background: transparent', 'session controls block')
		const sessionHoverBlock = extractBlock(scss, '.workspace-ai-chat-panel-session:focus-within')
		const historyToggleHoverBlock = extractBlock(scss, '.workspace-ai-chat-panel-history-toggle:focus-visible')
		expectExcerptToContain(historyToggleHoverBlock, 'background: var(--workspace-ai-chat-panel-session-history-toggle-hover-background, rgba(105, 115, 136, 0.1))', 'session history toggle focus block')
		expectExcerptToContain(historyToggleHoverBlock, 'outline: none', 'session history toggle focus block')
		expectExcerptToContain(sessionHoverBlock, 'background-image:', 'session focus block')
		expectExcerptToContain(sessionHoverBlock, '--workspace-ai-chat-panel-session-hover-background-image', 'session focus block')
		expectExcerptToContain(sessionHoverBlock, 'linear-gradient(135deg, #e8f2ff 0%, #eaf1ff 100%)', 'session focus block')
		expectSourceToContain(scss, 'max-height: 236px')
		expectExcerptToContain(sessionBlock, 'display: flex', 'session block')
		expectExcerptToContain(sessionBlock, 'min-height: 58px', 'session block')
		expectExcerptToContain(titleBlock, 'font-size: 13px', 'session title block')
		expectExcerptToContain(titleBlock, 'font-weight: 620', 'session title block')
	})

	it('keeps an empty-openable panel state when the last tab is closed', () => {
		const closeBody = extractFunctionBody(ts, 'closeAiChatSidebarTab')
		const emptyBranchIndex = closeBody.indexOf('if (aiChatSidebarTabs.length === 0) {')
		const returnIndex = closeBody.indexOf('return', emptyBranchIndex)

		expect(emptyBranchIndex).toBeGreaterThan(-1)
		expect(returnIndex).toBeGreaterThan(emptyBranchIndex)
		expectExcerptToContain(closeBody, 'activeAiChatSidebarTabId = null', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'activeAiChatSidebarThreadId = null', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'activeAiChatThreadId = null', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'persistAiChatSidebarState()', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'syncActiveAiChatPanelFromState()', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'renderActiveAiChatPanel()', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'return', 'closeAiChatSidebarTab')
	})

	it('opens the capability library on the Tools surface', () => {
		expectSourceToContain(ts, "openRightSidePanelToMode('capabilities')")
		expectSourceToContain(ts, "window.addEventListener('lixpi:open-capability-library', onOpenCapabilityLibrary)")
	})

	it('adds thread tabs idempotently when opening existing chat sessions', () => {
		const ensureThreadBody = extractFunctionBody(ts, 'ensureAiChatSidebarThreadTab')

		expectExcerptToContain(ensureThreadBody, 'const threadTabId = `thread:${threadId}`', 'ensureAiChatSidebarThreadTab')
		expectExcerptToContain(ensureThreadBody, 'if (!aiChatSidebarTabs.some((tab) => tab.tabId === threadTabId))', 'ensureAiChatSidebarThreadTab')
		expectExcerptToContain(ensureThreadBody, 'unshift(createAiChatThreadSidebarTab(threadId))', 'ensureAiChatSidebarThreadTab')
		expectExcerptToContain(ensureThreadBody, 'activeAiChatSidebarThreadId = threadId', 'ensureAiChatSidebarThreadTab')
	})

	it('keeps thread sessions renderable with message count and status metadata', () => {
		expectSourceToContain(ts, 'function countProseMirrorNodesByType(value: unknown, nodeTypes: Set<string>): number')
		expectSourceToContain(ts, 'countAiChatSessionMessages(session.content)')
		expectSourceToContain(ts, '${getAiChatSessionMeta(session)}')
		expectSourceToContain(ts, 'pluralizeSessionCount(messageCount, \'message\')')
	})

	it('renders thread session history entries with timestamps', () => {
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-marker-thread')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-content')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-title')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-date')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-meta')
		expectSourceToContain(ts, 'formatSessionUpdatedAt(session.updatedAt)')
		expectSourceToContain(ts, 'sessionEl.querySelector(\'.workspace-ai-chat-panel-session-open\')?.addEventListener(\'click\', () => {')
		expectSourceToContain(ts, 'activeAiChatSidebarTabId = `thread:${session.threadId}`')
		expectSourceNotToContain(ts, 'workspace-ai-chat-panel-session-marker-extraction')
	})

	it('defines stable session metadata formatters for deterministic labels', () => {
		expectSourceToContain(ts, 'function formatSessionStatus(status: string): string')
		expectSourceToContain(ts, ".split(/[-_]/)")
		expectSourceToContain(ts, 'const minuteMs = 60000')
		expectSourceToContain(ts, 'return `${days} ${days === 1 ? \'day\' : \'days\'} ago`')
		expectSourceToContain(ts, 'return `${weeks} ${weeks === 1 ? \'week\' : \'weeks\'} ago`')
		expectSourceToContain(ts, 'formatSessionUpdatedAt')
		expectSourceToContain(ts, 'formatSessionTimestamp(updatedAt)')
		expectSourceToContain(ts, 'Date unavailable')
	})
})

// =============================================================================
// AI chat thread — auto-grow CSS overrides
// =============================================================================

describe('AI chat thread — workspace CSS overrides for auto-grow', () => {
	const scss = loadScss()

	it('zeroes padding-bottom on .ai-chat-thread-wrapper inside workspace thread', () => {
		const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper')
		expect(block).toMatch(/padding-bottom:\s*0/)
	})

	it('zeroes padding-bottom on .ai-chat-thread-content inside workspace thread', () => {
		const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper .ai-chat-thread-content')
		expect(block).toMatch(/padding-bottom:\s*0/)
	})

	it('overrides ProseMirror min-height to 0 inside workspace thread', () => {
		// There are two rules with this selector — search the raw SCSS for
		// the min-height declaration scoped to the workspace thread.
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*min-height:\s*0/)
	})

	it('sets ProseMirror padding-bottom to 1rem inside workspace thread', () => {
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*padding:\s*0\s+0\s+1rem/)
	})
})


// =============================================================================
// AI chat thread — document title hidden (controlled by setting)
// =============================================================================

describe('AI chat thread — document title hidden in workspace', () => {
	const scss = loadScss()
	const ts = loadTs()

	it('hides .document-title via the hide-title modifier class', () => {
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node-hide-title\s+\.document-title\s*\{[^}]*display:\s*none/)
	})

	it('applies document title visibility to the canvas-owned chat panel', () => {
		expectSourceToContain(ts, 'settings.aiChatThread.showHeader')
		expectSourceToContain(ts, 'workspace-ai-chat-thread-node-hide-title')
	})
})

// =============================================================================
// Resize handles - corner-hover visibility
// =============================================================================

describe('Resize handles - corner-hover visibility', () => {
	const scss = loadScss()
	const ts = loadTs()

	it('does not reveal all resize handles from node hover, selection, or resizing state', () => {
		const block = extractBlock(scss, '.workspace-document-node')

		expectExcerptNotToContain(block, '&:hover .document-resize-handle')
		expectExcerptNotToContain(block, '&.is-selected .document-resize-handle')
		expectExcerptNotToContain(block, '&.is-resizing .document-resize-handle')
	})

	it('keeps handles as invisible corner hitboxes that reveal only on direct hover or drag', () => {
		// extractBlock matches the first occurrence; a nested pending-media-hover
		// override of the same selector now precedes the top-level base rule.
		const block = extractBlock(scss, '\n.document-resize-handle')

		expect(block).toMatch(/opacity:\s*0/)
		expect(block).toMatch(/pointer-events:\s*auto/)
		expectExcerptToContain(block, '&:hover,')
		expectExcerptToContain(block, '&.is-dragging')
		expect(block).toMatch(/&:hover,[\s\S]*&\.is-dragging\s*\{[\s\S]*opacity:\s*1/)
	})

	it('does not reveal floating input resize handles from thread selection', () => {
		const block = extractBlock(scss, '.ai-prompt-input-thread-persistent')

		expectExcerptNotToContain(block, '&.is-selected .document-resize-handle')
		expectExcerptNotToContain(block, '&.thread-hovered .document-resize-handle')
	})

	it('compares completed-video resize hitboxes in screen pixels', () => {
		const fnBody = extractFunctionBody(ts, 'getVideoChromeResizeHandle')
		sourceFileNames.set(fnBody, 'getVideoChromeResizeHandle')

		expectSourceToContain(fnBody, 'const rect = surface?.getBoundingClientRect() ?? chromeEl.getBoundingClientRect()')
		expectSourceToContain(fnBody, 'const x = event.clientX - rect.left')
		expectSourceToContain(fnBody, 'const y = event.clientY - rect.top')
		expectSourceToContain(fnBody, 'const zoom = getCurrentViewportZoom()')
		expectSourceToContain(fnBody, 'getResizeHandleScaledSizes(zoom, {')
		expectSourceToContain(fnBody, 'zoomScaling: getAdaptiveBoundedZoomScalingOptions(resizeHandleSettings.zoomScaling),')
		expectSourceToContain(fnBody, 'const hitSize = Math.max(16, (size + Math.max(0, offset)) * zoom)')
		expectSourceNotToContain(fnBody, 'const hitSize = Math.max(16, size + Math.max(0, offset))')
	})
})

// =============================================================================
// Right side panel — TypeScript infrastructure
// =============================================================================

describe('Right side panel — TS infrastructure', () => {
	const ts = loadTs()

	it('delegates right side panel state to SidePanel with content-agnostic settings', () => {
		expectSourceToContain(ts, 'const RIGHT_SIDE_PANEL_SETTINGS = settings.rightSidePanel')
		expectSourceToContain(ts, 'function ensureActiveRightSidePanel(): SidePanelInstance')
		expectSourceToContain(ts, 'const { defaultDimensions, dimensions, resizeHandle, toggle, animation, overlay, drag } = RIGHT_SIDE_PANEL_SETTINGS')
		expectSourceToContain(ts, 'minWidth: dimensions.minWidth')
		expectSourceToContain(ts, 'defaultWidth: defaultDimensions.width')
		expectSourceToContain(ts, 'getMaxWidth: getRightSidePanelMaxWidth')
		expectSourceToContain(ts, 'animation,')
		expectSourceToContain(ts, 'overlay,')
		expectSourceToContain(ts, 'drag,')
		expectSourceToContain(ts, 'function reflectRightSidePanelWidth(width: number)')
		expectSourceToContain(ts, "style.setProperty('--workspace-right-side-panel-width', widthValue)")
		expectSourceNotToContain(ts, 'settings.aiChatThread.rightSidePanel')
		expectSourceNotToContain(ts, 'AI_CHAT_PANEL_MIN_WIDTH')
		expectSourceNotToContain(ts, 'workspace-ai-chat-sidebar')
	})

	it('updateSelectionDrivenUi never references a detached floating input under any node', () => {
		const fnMatch = ts.match(/function\s+updateSelectionDrivenUi[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		// The deprecated detached prompt-input-below-node was removed entirely in
		// favor of the screen-fixed canvas composer; selection UI must not touch a
		// per-node floating input at all.
		expectExcerptNotToContain(fnBody, 'FloatingInput')
		expectExcerptNotToContain(fnBody, 'promptInputController.setTarget')
	})

	it('removes the extraction-only image bubble menu callback', () => {
		expectSourceNotToContain(ts, `on${'AskAi'}`)
	})

	it('bubble menu callbacks include onTriggerConnection', () => {
		expectSourceToContain(ts, 'onTriggerConnection')
	})

	it('anchors the canvas image bubble menu to the image node box', () => {
		expectSourceToContain(ts, 'function getCanvasImageBubbleMenuTargetRect(nodeEl: HTMLElement): DOMRect')
		expectSourceToContain(ts, 'return nodeEl.getBoundingClientRect()')
		expect([...ts.matchAll(/const targetRect = getCanvasImageBubbleMenuTargetRect\(nodeEl\)/g)]).toHaveLength(2)
		expect([...ts.matchAll(/clampToParent: false/g)]).toHaveLength(2)
		expect([...ts.matchAll(/animateOnShow: false/g)]).toHaveLength(2)
		expectSourceNotToContain(ts, "const imgEl = nodeEl.querySelector('img') as HTMLImageElement\n        const targetEl = imgEl || nodeEl")
	})

	it('onTriggerConnection triggers connection via startConnectionFromMenu', () => {
		expect(ts).toMatch(/onTriggerConnection.*startConnectionFromMenu|startConnectionFromMenu.*onTriggerConnection/s)
	})

	it('keeps AI chat thread editor in the canvas-owned singleton panel', () => {
		const start = ts.indexOf('function renderActiveAiChatPanel')
		expect(start).toBeGreaterThan(-1)
		const end = ts.indexOf('function createGlobalCanvasComposer', start)
		expect(end).toBeGreaterThan(start)
		const fnBody = ts.slice(start, end)

		expectExcerptToContain(fnBody, 'workspace-ai-chat-floating-panel workspace-ai-chat-thread-node')
		expectExcerptToContain(fnBody, 'new ProseMirrorEditor')
		expectExcerptToContain(fnBody, 'ensureActiveRightSidePanel()')
		expectExcerptToContain(fnBody, "const resizeHandle = activeRightSidePanel.element")
		expectExcerptToContain(fnBody, 'panelEl.appendChild(resizeHandle)')
		// The glass backdrop element is owned by the SidePanel component.
		expectExcerptToContain(fnBody, 'paneEl.appendChild(activeRightSidePanel.backdropElement)')
		expectSourceToContain(ts, 'function handleRightSidePanelResizeStart()')
		// Prompt entry is rendered by the detached/shared composer below the canvas.
		expectSourceToContain(ts, 'function createGlobalCanvasComposer(): void')
		expectSourceToContain(ts, "className: 'workspace-canvas-global-composer'")
		expectSourceNotToContain(ts, `AiChat${'Panel.svelte'}`)
	})

	it('keeps AI prompt input style values in the shared composer component', () => {
		const composer = loadAiPromptComposer()
		expectSourceToContain(composer, "this.element.style.setProperty('--dropdown-popover-box-shadow', settings.dropdown.styles.popoverBoxShadow)")
		expectSourceNotToContain(composer, 'open-prompt-z-index')
	})

	it('raises the global composer above its action panels only while a reference picker is visible', () => {
		const scss = loadScss()
		const actionPanel = extractBlock(scss, '.workspace-canvas-action-panel')
		const composerHost = extractBlock(scss, '.workspace-canvas-global-composer-host')
		const composerHostWithPicker = extractBlock(
			scss,
			'.workspace-canvas-global-composer-host:has(.prompt-reference-picker-visible)'
		)

		expectExcerptToContain(actionPanel, 'z-index: 9991;', '.workspace-canvas-action-panel')
		expectExcerptToContain(composerHost, 'z-index: 9990;', '.workspace-canvas-global-composer-host')
		expectExcerptToContain(composerHostWithPicker, 'z-index: 9992;', 'visible picker composer host')
		expectSourceNotToContain(ts, "zIndex: '9990',")
	})

	it('opens the panel without requiring an existing thread and creates standalone history on submit', () => {
		expectSourceToContain(ts, 'function openAiChatPanel(): void')
		expectSourceToContain(ts, 'aiChatPanelState = { ...aiChatPanelState, isOpen: true }')
		expectSourceToContain(ts, 'async function submitCanvasGenerationRun(\n        data: AiPromptComposerSubmitData,')
		// Standalone thread ownership is now server-determined (Asset model); the
		// client only reads it back, it never constructs a local thread record.
		expectSourceToContain(ts, "if (thread.owner?.type !== 'standalone') continue")
		const openAiChatPanelMatch = ts.match(/function openAiChatPanel\(\): void \{[\s\S]*?^    \}/m)
		expect(openAiChatPanelMatch).not.toBeNull()
		expectExcerptNotToContain(openAiChatPanelMatch![0], 'addContextChips')
		expectSourceNotToContain(ts, 'workspace-ai-chat-panel-title')
		expectSourceNotToContain(ts, 'workspace-ai-chat-panel-close')
	})

	it('renders a removable context chip tray and sends chip context for standalone chats', () => {
		// The chip tray replaces the old Follow / Pinned / With Sources controls.
		const scss = loadScss()

		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-chips')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-chip')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-chip-remove')
		expectSourceToContain(ts, 'function refreshContextChipTray(): void')
		expectSourceToContain(ts, 'function destroyContextPreviewTiles(): void')
		expectSourceToContain(ts, 'contextPreviewTilesByTray: Map<HTMLDivElement, Set<ContextPreviewTileInstance>>')
		expectSourceToContain(ts, 'for (const trayEl of Array.from(contextPreviewTilesByTray.keys()))')
		expectSourceToContain(ts, 'function addContextChips(nodeIds: Iterable<string>): void')
		expectSourceToContain(ts, "node.type === 'capabilityArtifact'")
		expectSourceToContain(ts, 'function removeContextChip(nodeId: string): void')
		expectSourceToContain(ts, 'function clearExplicitContextChips(): void')
		expectSourceToContain(ts, 'function createAiChatPanelContextTrayElement(): HTMLDivElement')
		expectSourceToContain(ts, 'removeContextChip(nodeId)')
		expectSourceToContain(ts, 'trayTiles.add(previewTile)')
		expectSourceToContain(ts, 'const previewTile = createContextPreviewTile({')
		// Submitting a standalone chat force-includes the explicit chips: context
		// relevance now resolves server-side from a whole-workspace snapshot, so the
		// client just flags the chip node ids into that snapshot instead of locally
		// extracting a selected-context subset.
		expectSourceToContain(ts, 'const chipNodeIds = aiChatPanelState.contextChips.slice()')
		expectSourceToContain(ts, 'contextChipNodeIds: explicitContextNodeIds,')
		// The session-history toggle is retained.
		expectSourceToContain(ts, 'aiChatPanelToggleHistoryIcon')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-control')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-toggle')
		expectSourceToContain(ts, 'const isSessionHistoryOpen = !aiChatPanelState.isSessionHistoryOpen')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-sessions-hidden')
		expectSourceToContain(scss, '--workspace-right-side-panel-content-inset')
		expectSourceToContain(scss, '.workspace-ai-chat-panel-tabs-switch')
		// Open tabs are now a D3 sliding switch, not DOM tag-style buttons.
		expectSourceToContain(ts, "createSlidingTabsSwitch")
		expectSourceToContain(ts, 'workspace-ai-chat-panel-tabs-switch')
		expectSourceToContain(ts, "id: 'workspace-ai-chat-panel-tabs'")
		expectSourceToContain(ts, "onClose: (tabId) => closeAiChatSidebarTab(tabId)")
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.minTabWidth')
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.height')
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.transitionDurationMs')
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.transitionMinDurationMs')
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.transitionDistanceSpeedupFactor')
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.styles.activeTabBoxShadow')
		expectSourceToContain(ts, 'settings.aiChatThread.panelTabs.styles.activeTabInsetShadow')
		expectSourceNotToContain(ts, 'createTagPill')
		expectSourceNotToContain(ts, 'workspace-ai-chat-panel-tab-title')
		expectSourceNotToContain(ts, 'workspace-ai-chat-panel-tab-close')
		expectSourceNotToContain(scss, '.workspace-ai-chat-panel-tab {')
		// The removed context-mode controls must leave no dangling code.
		expectSourceNotToContain(ts, "value: 'followSelection'")
		expectSourceNotToContain(ts, "value: 'pinnedContext'")
		expectSourceNotToContain(ts, '>With Sources</span>')
		expectSourceNotToContain(ts, 'createToggleSwitch')
		expectSourceNotToContain(ts, 'includeUpstreamContext')
		expectSourceNotToContain(ts, 'contextMode')
		expectSourceNotToContain(ts, 'getStandaloneContextNodeIds')
	})

	it('preserves chat tab switch state and resets scroll position when changing tabs', () => {
		expectSourceToContain(ts, 'const preservedTabsEl = options.preserveTabsSwitch')
		expectSourceToContain(ts, 'const preservedTabsScrollLeft = preservedTabsEl?.scrollLeft ?? 0')
		expectSourceToContain(ts, 'preservedTabsEl?.remove()')
		expectSourceToContain(ts, 'renderActiveAiChatPanel(undefined, { preserveTabsSwitch: true })')
		expectSourceToContain(ts, 'tabsInitialScrollLeft = getAiChatPanelActiveTabScrollLeft(')
		expectSourceToContain(ts, 'tabsEl.scrollLeft = tabsInitialScrollLeft')
		expectSourceToContain(ts, 'resizeActiveAiChatPanelTabsSwitch()')
		expectSourceToContain(ts, 'function resizeActiveAiChatPanelTabsSwitch(): void')
		expectSourceToContain(ts, 'function getAiChatPanelActiveTabScrollLeft(')
		expectSourceToContain(ts, 'function getAiChatPanelTabsViewportWidth(')
	})

	it('renders a single-tab divider instead of an empty tabs switch and hides it behind history', () => {
		const scss = loadScss()

		expectSourceToContain(ts, 'const shouldRenderTabs = aiChatSidebarTabs.length > 1')
		expectSourceToContain(ts, 'const singleTabDividerEl = shouldRenderTabs')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-single-tab-divider')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-single-tab-divider-hidden')
		expectSourceToContain(ts, 'singleTabDividerEl?.classList.toggle(\'workspace-ai-chat-panel-single-tab-divider-hidden\', isSessionHistoryOpen)')
		expectSourceToContain(scss, '.workspace-ai-chat-panel-single-tab-divider')
		expectSourceToContain(scss, 'border-top: var(--workspace-ai-chat-panel-divider-border')
	})

	it('renders removable explicit context chips and patches improved descriptors', () => {
		const scss = loadScss()

		expectSourceToContain(ts, 'function clearExplicitContextChips(): void')
		expectSourceToContain(ts, 'function renderContextChip({')
		expectSourceToContain(ts, 'function destroyContextPreviewTiles(): void')
		expectSourceToContain(ts, 'contextKind: \'explicit\'')
		expectSourceToContain(ts, 'function patchWorkspaceContextImprovedDescriptors(improvedDescriptors: Record<string, ContentDescriptor> | undefined): void')
		expectSourceToContain(ts, 'function handleWorkspaceContextResolution(threadId: string | undefined, resolution: WorkspaceContextResolution, generationRun?: MediaGenerationRunMeta): void')
		expectSourceToContain(ts, 'patchWorkspaceContextImprovedDescriptors(resolution.improvedDescriptors)')
		expectSourceToContain(ts, 'updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution, generationRun)')
		expectSourceToContain(ts, 'placementAnchorNodeId: placement.placementAnchorNodeId ?? referenceNodeIds[0]')
		expectSourceToContain(ts, 'setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)')
		expectSourceToContain(ts, 'onWorkspaceContextResolvedToCanvas: ({ threadId, resolution, generationRun }) =>')
		expectSourceToContain(scss, '.workspace-ai-chat-panel-context-chip-explicit')
		expectSourceNotToContain(scss, '.workspace-ai-chat-panel-context-chip-auto')
	})

	it('applies context-preview styling helper variables to the panel shell', () => {
		expectSourceToContain(ts, 'function applyAiChatPanelContextPreviewSettings(panelEl: HTMLElement): void')
		expectSourceToContain(ts, 'settings.aiChatThread.contextPreview.styles')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-controls')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-preview-tooltip')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-preview-trigger')
		expectSourceToContain(ts, '--workspace-ai-chat-panel-context-chip-remove-box-shadow')
	})

	it('passes panel context-preview CSS variables through to detached tooltip content', () => {
		const contextPreview = loadContextPreview()
		expectSourceToContain(contextPreview, 'export const CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES = [')
		expectSourceToContain(contextPreview, "contentCssVariableNames: CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES,")
		expectSourceToContain(contextPreview, "'--workspace-ai-chat-panel-context-preview-popover-text-color'")
		expectSourceToContain(ts, 'const previewTile = createContextPreviewTile({')
	})

	it('applies session-history styling helper variables to the panel shell', () => {
		expectSourceToContain(ts, 'function applyAiChatPanelSessionHistorySettings(panelEl: HTMLElement): void')
		expectSourceToContain(ts, 'settings.aiChatThread.sessionHistory.styles')
		expectSourceToContain(ts, '--workspace-ai-chat-panel-session-control-color')
		expectSourceToContain(ts, '--workspace-ai-chat-panel-session-control-hover-color')
		expectSourceToContain(ts, '--workspace-ai-chat-panel-session-delete-color')
		expectSourceToContain(ts, '--workspace-ai-chat-panel-session-thread-marker-box-shadow')
	})

	it('prepares standalone panel media generations for canvas placeholders and branch origins', () => {
		const settingsTs = loadSettings()

		expectSourceToContain(ts, 'function rememberStandaloneGeneratedImagePlacement(')
		expectSourceToContain(ts, 'const referenceNodeIds = getExistingMediaNodeIds(explicitReferenceNodeIds)')
		expectSourceToContain(ts, 'setGeneratingReferenceNodeIds(threadId, candidateNodeIds)')
		expectSourceNotToContain(ts, '...Array.from(selectedNodeIds),')
		expectSourceToContain(ts, 'const inferredActiveTargetNodeId = getMediaBranchSnapshotActiveTargetNodeId(mediaBranchCandidateSnapshot)')
		expectSourceToContain(ts, 'const placementAnchorNodeId = inferredActiveTargetNodeId')
		expectSourceToContain(ts, '?? activeTargetNodeId')
		expectSourceToContain(ts, '?? referenceNodeIds[0]')
		expectSourceToContain(ts, '?? candidateNodeIds[0]')
		expectSourceToContain(ts, '...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),')
		expectSourceToContain(ts, 'referenceNodeIds: candidateNodeIds,')
		expectSourceToContain(ts, 'rememberStandaloneGeneratedImagePlacement(')
		expectSourceToContain(ts, 'explicitContextNodeIds,')
		expectSourceToContain(ts, 'const placement = getPendingGeneratedMediaPlacement(threadId, generationRun)')
		expectSourceToContain(ts, 'const edgeSourceNode = getGeneratedMediaEdgeSourceNode(generationRun, [branchOriginNode, branchForkNode, branchLineNode])')
		expectSourceToContain(ts, 'partialImageTracker.set(runKey, {')
		expectSourceToContain(ts, 'nodeId,')
		expectSourceToContain(ts, 'assetId: assetId || lineageAssignment.assetId,')
		expectSourceToContain(ts, 'placementKey,')
		expectSourceToContain(ts, 'hasReceivedFrame: Boolean(imageUrl),')
		expectSourceToContain(ts, 'sourceNodeId: edgeSourceNode.nodeId,')
		expectSourceToContain(ts, 'updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution, generationRun)')
		expectSourceToContain(ts, 'placementAnchorNodeId: placement.placementAnchorNodeId ?? referenceNodeIds[0]')
		expectSourceToContain(ts, 'mediaBranchResolution: resolution')
		expectSourceToContain(ts, 'mediaBranchResolution: resolution')
		expectSourceToContain(ts, 'const referenceNodeIds = getExistingMediaNodeIds([')
		expectSourceToContain(ts, 'resolution.referenceCandidateIds.flatMap(candidateId => {')
		expectSourceToContain(ts, 'operationKind: resolution.operationKind')
		expectSourceToContain(ts, 'referenceCandidateIds: resolution.referenceCandidateIds')
		expectSourceToContain(ts, 'const referenceNodeIds = getExistingMediaNodeIds([')
		expectSourceToContain(ts, 'setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)')
		expectSourceToContain(ts, 'function getReferenceGroupRectForGeneratedMedia(threadId: string, generationRun?: MediaGenerationRunMeta): Rect | undefined')
		expectSourceToContain(ts, "import {\n    applyBranchLineageNodeGap,\n    normalizeBranchLineageNodeGap,\n} from '$src/infographics/workspace/branchLineageNodeSpacing.ts'")
		expectSourceToContain(ts, "import { computeReferenceBranchRootMarkerPosition } from '$src/infographics/workspace/referenceBranchRootPlacement.ts'")
		expectSourceToContain(ts, 'function getBranchLineageNodeGap(): number')
		expectSourceToContain(ts, 'return normalizeBranchLineageNodeGap(settings.mediaBranchLineage.nodeGap)')
		expectSourceToContain(ts, 'function getBranchLineageCollisionSettings(')
		expectSourceToContain(ts, 'return applyBranchLineageNodeGap(nodeSettings, getBranchLineageNodeGap())')
		expectSourceToContain(ts, 'return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchOrigin)')
		expectSourceToContain(ts, 'return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchFork)')
		expectSourceToContain(ts, 'return getBranchLineageCollisionSettings(collisionSettings.nodeTypes.branchLine)')
		expectSourceToContain(ts, 'function getReferenceBranchRootMarkerPositionForGeneratedMedia(')
		expectSourceToContain(ts, 'referenceToMarkerMinGap: getBranchLineageNodeGap(),')
		expectSourceToContain(ts, 'settings.mediaBranchLineage.rootToFirstMediaGap')
		expectSourceToContain(settingsTs, 'nodeGap: number')
		expectSourceToContain(settingsTs, 'nodeGap: mediaGenerationLayoutSettings.nodeGap')
		expectSourceToContain(settingsTs, 'workspaceCollision: workspaceCollisionSettings')
		expectSourceToContain(ts, 'const referenceRootPosition = getReferenceBranchRootMarkerPositionForGeneratedMedia(')
		expectSourceNotToContain(ts, 'referencePosition.x - getRootBranchMarkerOutputGap() - markerDimensions.width')
		expectSourceNotToContain(ts, 'referencePosition.x - getBranchOriginOutputGap() - dimensions.width')
		expectSourceNotToContain(ts, 'if (!sourceThread) return\n            const sourceNode = getGeneratedImageSourceNode(threadId, sourceThread)')
	})

	it('returns live viewport-aware canvas state from the canvas API', () => {
		expectSourceToContain(ts, 'return currentCanvasState')
		expectSourceToContain(ts, 'viewport: getLiveViewport()')
		expectSourceToContain(ts, 'return null')
		expectSourceToContain(ts, 'getViewport() {')
		expectSourceToContain(ts, 'return getLiveViewport()')
	})

	it('maps media generation request completion callbacks back into generation-settling', () => {
		expectSourceToContain(ts, 'onMediaGenerationRequestCompleteToCanvas: ({ threadId, generationRequestId, generationRun }) => {')
		expectSourceToContain(ts, 'if (!shouldAcceptGeneratedMediaEvent(threadId)) return')
		expectSourceToContain(ts, 'settleMediaGenerationRequest(threadId, generationRequestId, generationRun)')
	})

	it('routes workspace context relevance events around markdown parsing', () => {
		const aiInteractionService = loadAiInteractionService()
		const aiChatThreadPlugin = loadAiChatThreadPlugin()
		const aiGeneratedImageNode = loadAiGeneratedImageNode()

		expectSourceToContain(aiInteractionService, 'content.status === STREAM_STATUS.CONTEXT_RELEVANCE_RESOLVED')
		expectSourceToContain(aiInteractionService, "type: 'context_relevance_resolved'")
		expectSourceToContain(aiInteractionService, 'workspaceContextResolution')
		expectSourceToContain(aiInteractionService, 'content.status === STREAM_STATUS.CONTEXT_RELEVANCE_ERROR')
		expectSourceToContain(aiInteractionService, "type: 'context_relevance_error'")
		expectSourceToContain(aiInteractionService, 'content.status === STREAM_STATUS.IMAGE_ERROR')
		expectSourceToContain(aiInteractionService, "type: 'image_error'")
		expectSourceToContain(aiChatThreadPlugin, "type WorkspaceContextSegmentType = 'context_relevance_resolved' | 'context_relevance_error'")
		expectSourceToContain(aiChatThreadPlugin, "if (type === 'image_error')")
		expectSourceToContain(aiChatThreadPlugin, 'this.handleImageError(view, event)')
		expectSourceToContain(aiChatThreadPlugin, "if (type === 'context_relevance_resolved')")
		// Canvas placement dispatch is centralized in the shared router, used by
		// both the chat plugin and the thread-less canvas composer.
		expectSourceToContain(aiChatThreadPlugin, 'routeSegmentEventToCanvas(event)')
		const canvasRouter = loadAiGeneratedMediaCanvasRouter()
		expectSourceToContain(canvasRouter, 'onWorkspaceContextResolvedToCanvas?.({')
		expectSourceToContain(aiGeneratedImageNode, 'onWorkspaceContextResolvedToCanvas?: (data: {')
		expectSourceToContain(aiGeneratedImageNode, 'onImageErrorToCanvas?: (data: {')
		expectSourceToContain(aiGeneratedImageNode, 'resolution: WorkspaceContextResolution')
	})

	it('keeps submitted-session tabs until explicit delete handlers remove them', () => {
		const closeStart = ts.indexOf('function closeAiChatSidebarTab')
		const deleteChatStart = ts.indexOf('async function deleteAiChatSession', closeStart)
		const closeBody = ts.slice(closeStart, deleteChatStart)
		const deleteChatBody = ts.slice(deleteChatStart, ts.indexOf('function renderActiveAiChatPanel', deleteChatStart))

		expectExcerptToContain(closeBody, 'aiChatSidebarTabs = aiChatSidebarTabs.filter((tab) => tab.tabId !== tabId)', 'close-tab handler')
		expectExcerptToContain(closeBody, 'if (aiChatSidebarTabs.length === 0)', 'close-tab handler')
		expectExcerptToContain(deleteChatBody, 'closeAiChatSidebarTab(`thread:${threadId}`)', 'delete-chat handler')
	})

	it('uses the reusable SidePanel component as the horizontal resize handle', () => {
		const sidePanel = loadSidePanel()

		expectSourceToContain(ts, 'function handleRightSidePanelResizeStart(')
		expectSourceToContain(ts, 'createSidePanel({')
		expectSourceToContain(ts, "side: 'right'")
		expectSourceToContain(ts, 'offset: resizeHandle.offset')
		expectSourceToContain(ts, 'grabWidth: resizeHandle.grabWidth')
		expectSourceToContain(sidePanel, "applyStyle(document.body, { cursor: 'ew-resize', userSelect: 'none' })")
		expectSourceToContain(sidePanel, 'side-panel-resize-handle')
		// Touch support: the resize gesture is driven by Pointer Events, not mouse.
		expectSourceToContain(sidePanel, "addEventListener('pointerdown', this.handleResizeStart)")
		expectSourceToContain(sidePanel, "addEventListener('pointermove', handlePointerMove)")
	})

	it('plays the drawer slide animation through the SidePanel component', () => {
		const sidePanel = loadSidePanel()

		// The component owns the open/close slide; the host only triggers it.
		expectSourceToContain(sidePanel, 'playOpen = (panelElement: HTMLElement)')
		expectSourceToContain(sidePanel, 'playClose = (): Promise<void>')
		expectSourceToContain(sidePanel, 'private runSlide = async (panelElement: HTMLElement | null, direction: \'in\' | \'out\'): Promise<void>')
		expectSourceToContain(sidePanel, 'this.applyAnimationSettings(target.element, direction)')
		expectSourceToContain(sidePanel, 'transition: SLIDE_TRANSITION')
		expectSourceToContain(sidePanel, 'this.getSlideDurationMs() + SLIDE_FALLBACK_BUFFER_MS')

		// Host wiring: slide in only on a fresh open, slide out before teardown.
		expectSourceToContain(ts, 'void playRightSidePanelOpen(activeRightSidePanel, panelEl)')
		expectSourceToContain(ts, 'await closingSidePanel.playClose()')
	})

	it('uses content-agnostic right side panel sizing for right-edge surfaces', () => {
		const scss = loadScss()
		const svelte = loadWorkspaceCanvasSvelte()
		const layout = loadLayout()
		const navigationSidePanel = loadNavigationSidePanel()
		const navigationSidePanelScss = loadNavigationSidePanelScss()

		const sidePanelScss = loadSidePanelScss()
		expectSourceToContain(svelte, 'const rightSidePanelSettings = settings.rightSidePanel')
		expectSourceToContain(svelte, '--workspace-right-side-panel-width')
		expectSourceToContain(svelte, '--side-panel-backdrop-width: var(--workspace-right-side-panel-width)')
		expectSourceToContain(svelte, 'class:workspace-canvas-right-side-panel-open')
		// The glass backdrop is owned by the SidePanel component.
		expectSourceToContain(sidePanelScss, '.side-panel-backdrop')
		expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-backdrop-z-index, 90)')
		expectSourceToContain(sidePanelScss, '--side-panel-backdrop-width')
		expectSourceToContain(sidePanelScss, 'backdrop-filter: blur(24px) saturate(145%)')
		expectSourceToContain(sidePanelScss, '-webkit-backdrop-filter: blur(24px) saturate(145%)')
		expectSourceToContain(sidePanelScss, '@media (prefers-reduced-transparency: reduce)')
		expectSourceToContain(svelte, 'workspace-canvas-action-panel-right workspace-canvas-action-panel-single')
		expectSourceToContain(svelte, 'mediaFoloderIcon')
		expectSourceToContain(svelte, 'workspace-zoom-indicator')
		expectSourceNotToContain(svelte, 'workspace-canvas-utility-capsule')
		expectSourceToContain(scss, '.workspace-canvas-right-side-panel-open .workspace-zoom-indicator')
		expectSourceToContain(scss, 'right: calc(var(--workspace-right-side-panel-width) + 5px)')
		expectSourceToContain(scss, 'right: calc(0px - var(--workspace-canvas-padding-inline))')
		expectSourceToContain(scss, 'bottom: calc(0px - var(--workspace-canvas-padding-bottom))')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'top: 0px', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'border-radius: 10px', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'background: transparent', 'outer chat panel')
		expectSourceToContain(scss, '.ai-prompt-input-floating.workspace-canvas-global-composer')
		expectExcerptToContain(
			extractBlock(scss, '.ai-prompt-input-floating.workspace-canvas-global-composer'),
			'width: 100%',
			'global composer'
		)
		expectSourceToContain(layout, 'navigation-side-panel-pane')
		expectSourceToContain(layout, 'createNavigationSidePanel')
		expectSourceNotToContain(layout, 'Resizable.PaneGroup')
		expectSourceNotToContain(layout, 'user-menu-workspace-chat-panel')
		expectSourceToContain(navigationSidePanel, "side: 'left'")
		expectSourceToContain(navigationSidePanel, 'createSidePanel')
		expectSourceToContain(navigationSidePanelScss, '.navigation-side-panel {')
		expectSourceToContain(navigationSidePanelScss, 'position: fixed')
	})

	it('lifts the canvas-hosted side-panel overlay/backdrop above canvas content via workspace-canvas-scoped z-index variables', () => {
		const scss = loadScss()
		const sidePanelScss = loadSidePanelScss()

		expectExcerptToContain(
			extractBlock(scss, '.workspace-canvas'),
			'--side-panel-resize-handle-z-index: 9990',
			'.workspace-canvas'
		)
		expectExcerptToContain(
			extractBlock(scss, '.workspace-canvas'),
			'--side-panel-overlay-z-index: 10010',
			'.workspace-canvas'
		)
		expectExcerptToContain(
			extractBlock(scss, '.workspace-canvas'),
			'--side-panel-backdrop-z-index: 10020',
			'.workspace-canvas'
		)
		expectExcerptToContain(
			extractBlock(scss, '.workspace-canvas'),
			'--side-panel-surface-z-index: 10030',
			'.workspace-canvas'
		)
		expectExcerptToContain(
			extractBlock(scss, '.workspace-canvas'),
			'--side-panel-toggle-z-index: 10040',
			'.workspace-canvas'
		)

		// The component now reads its own z-index custom properties (with the
		// component's low-stacking defaults) instead of the host overriding
		// .side-panel-overlay-right/.side-panel-backdrop-right by selector.
		expectSourceNotToContain(scss, '.side-panel-overlay-right')
		expectSourceNotToContain(scss, '.side-panel-backdrop-right')
		expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-overlay-z-index, 80)')
		expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-toggle-z-index, 10040)')
		expectSourceToContain(sidePanelScss, 'z-index: var(--side-panel-resize-handle-z-index, 9990)')
	})
})

// =============================================================================
// Multi-selection and group drag
// =============================================================================

describe('Workspace canvas — multi-selection and group drag', () => {
	const ts = loadTs()
	const scss = loadScss()

	// -------------------------------------------------------------------------
	// Selection state model
	// -------------------------------------------------------------------------

	it('stores selected nodes in a Set instead of a single selectedNodeId', () => {
		expectSourceToContain(ts, 'let selectedNodeIds: Set<string> = new Set()')
		expectSourceToContain(ts, 'function setSelectedNodes(')
		expectSourceToContain(ts, 'function toggleNodeSelection(')
	})

	it('single-target UI is derived from getSingleSelectedNodeId', () => {
		expectSourceToContain(ts, 'function getSingleSelectedNodeId(): string | null')
		expectSourceToContain(ts, 'const singleSelectedNodeId = getSingleSelectedNodeId()')
		expectSourceToContain(ts, 'hideCanvasBubbleMenu()')
	})

	// -------------------------------------------------------------------------
	// Click interaction rules
	// -------------------------------------------------------------------------

	it('plain click on node selects the node directly', () => {
		// The click handler must call selectNode(node.nodeId) — the original
		// node, with no pre-resolution through deprecated placement state.
		const clickHandler = extractNodeElClickHandler(ts)
		expect(clickHandler).not.toBe('')

		expectExcerptToContain(clickHandler, 'selectNode(node.nodeId)')
		expectExcerptNotToContain(clickHandler, 'selectNode(selectionTargetNodeId)')
		expectExcerptNotToContain(clickHandler, 'selectNode(getSelectionTargetNodeId')
	})

	it('marquee selection stores intersected node ids directly', () => {
		const fnMatch = ts.match(/function\s+getSelectableNodeIdsInRect[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, 'selectedNodeIdsInRect.add(node.nodeId)')
		expectExcerptNotToContain(fnBody, 'getSelectionTargetNodeId')
	})

	it('includes branch lineage markers in marquee selection while preserving their click-to-inspect behavior', () => {
		const intersection = extractFunctionBody(ts, 'selectionRectIntersectsNode')
		const filter = extractFunctionBody(ts, 'filterSelectableNodeIds')
		const branchOrigin = extractFunctionBody(ts, 'createBranchOriginNode')
		const branchFork = extractFunctionBody(ts, 'createBranchForkNode')
		const branchLine = extractFunctionBody(ts, 'createBranchLineNode')

		expectExcerptToContain(intersection, 'rectsOverlap(rect, getSelectionBoundsForNode(node))', 'selectionRectIntersectsNode')
		expectExcerptNotToContain(intersection, "node.type !== 'branchOrigin'", 'selectionRectIntersectsNode')
		expectExcerptToContain(filter, 'currentCanvasState.nodes.map((node: CanvasNode) => node.nodeId)', 'filterSelectableNodeIds')
		expectExcerptNotToContain(filter, '.filter(isSelectableCanvasNode)', 'filterSelectableNodeIds')
		for (const [label, source] of [
			['createBranchOriginNode', branchOrigin],
			['createBranchForkNode', branchFork],
			['createBranchLineNode', branchLine],
		] as const) {
			expectExcerptToContain(source, 'allowSelection: false', label)
			expectExcerptToContain(source, 'handleBranchMarkerInfoClick(node.nodeId)', label)
		}
	})

	it('clicking inside editor content (ProseMirror, contenteditable) does not trigger node selection', () => {
		// CRITICAL: clicks inside AI chat thread content must reach ProseMirror
		// editors without triggering selectNode, which would cause the selection
		// overlay and resize handles to appear, blocking text editing.
		const clickHandler = extractNodeElClickHandler(ts)
		expect(clickHandler).not.toBe('')

		// Must check all three selectors to cover:
		// - contenteditable: any contenteditable element (ProseMirror root)
		// - .ProseMirror: the ProseMirror editor container class
		// - .ai-chat-thread-wrapper: the AI chat thread content container
		expectExcerptToContain(clickHandler, 'clickTarget.isContentEditable')
		expectExcerptToContain(clickHandler, ".closest('.ProseMirror')")
		expectExcerptToContain(clickHandler, ".closest('.ai-chat-thread-wrapper')")

		// The handler must bail out (return) before reaching selectNode
		// when the click target matches any of these selectors
		const editorCheckIndex = clickHandler.indexOf('isContentEditable')
		const selectNodeIndex = clickHandler.indexOf('selectNode(node.nodeId)')
		expect(editorCheckIndex).toBeLessThan(selectNodeIndex)
	})

	it('Mod-click triggers selection toggling from node chrome', () => {
		// Mod-click on node chrome toggles selection from the click handler.
		const clickHandler = extractNodeElClickHandler(ts)
		expect(clickHandler).not.toBe('')

		expectExcerptToContain(clickHandler, 'if (isModSelectionEvent(e))', 'node click handler')
		expectExcerptToContain(clickHandler, 'toggleNodeSelection(node.nodeId)', 'node click handler')
	})

	it('supports Mod-click selection toggling on both node click and drag overlay mousedown', () => {
		expectSourceToContain(ts, 'function isModSelectionEvent(event: MouseEvent): boolean')
		expectSourceToContain(ts, 'return event.metaKey || event.ctrlKey')
		expectSourceToContain(ts, 'toggleNodeSelection(node.nodeId)')
		expectSourceToContain(ts, 'toggleNodeSelection(resolvedNodeId)')
	})

	// -------------------------------------------------------------------------
	// Selection overlay rules
	// -------------------------------------------------------------------------

	it('tracks selection source to control overlay visibility', () => {
		// selectionIsFromMarquee controls whether a single-node selection shows
		// the overlay. Plain clicks on any node type do
		// not draw a selection rectangle. Marquee selection does.
		expectSourceToContain(ts, 'let selectionIsFromMarquee = false')
		expectSourceToContain(ts, 'return selectionIsFromMarquee')

		// setSelectedNodes accepts a fromMarquee parameter
		expectSourceToContain(ts, 'function setSelectedNodes(nextSelectedNodeIds: Set<string>, fromMarquee = false): void')
		expectSourceToContain(ts, 'selectionIsFromMarquee = fromMarquee && selectedNodeIds.size > 0')
	})

	it('shouldShowSelectionGroupOverlay returns true for multi-select or marquee, false for plain click', () => {
		const fnMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Empty selection = no overlay
		expectExcerptToContain(fnBody, 'selectedNodeIds.size === 0) return false')

		// 2+ nodes = always overlay (regardless of source)
		expectExcerptToContain(fnBody, 'if (selectedNodeIds.size > 1) return true')

		// Single node = overlay only if selected via marquee
		expectExcerptToContain(fnBody, 'return selectionIsFromMarquee')
		expectExcerptNotToContain(fnBody, 'const selectedNodeId = getSingleSelectedNodeId()')
		expectExcerptNotToContain(fnBody, 'const selectedNode = currentCanvasState.nodes.find')

		// Must NOT contain any node-type special casing (e.g. aiChatThread)
		expectExcerptNotToContain(fnBody, "'aiChatThread'")
		expectExcerptNotToContain(fnBody, 'node.type')
	})

	it('marquee handler passes fromMarquee=true so even a single marquee node gets the overlay', () => {
		const paneMouseDownMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(paneMouseDownMatch).not.toBeNull()
		const fnBody = paneMouseDownMatch![0]

		expectExcerptToContain(fnBody, 'setSelectedNodes(new Set(selectedIds), true)')
	})

	it('selectNode (plain click) does NOT pass fromMarquee so single-click never shows overlay', () => {
		const fnMatch = ts.match(/function\s+selectNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// selectNode calls setSelectedNodes with default fromMarquee=false
		expectExcerptToContain(fnBody, 'setSelectedNodes(nodeId ? new Set([nodeId]) : new Set())')
		expectExcerptNotToContain(fnBody, 'true)')
	})

	it('toggleNodeSelection does NOT pass fromMarquee', () => {
		const fnMatch = ts.match(/function\s+toggleNodeSelection[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, 'setSelectedNodes(nextSelectedNodeIds)')
		expectExcerptNotToContain(fnBody, ', true)')
	})

	it('clearNodeSelection resets selection and hides overlay', () => {
		const fnMatch = ts.match(/function\s+clearNodeSelection[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, 'setSelectedNodes(new Set())')
		expectExcerptToContain(fnBody, 'updateSelectionGroupOverlayElement()')
	})

		it('defines and styles the persistent selection overlay', () => {
			expectSourceToContain(ts, 'className="workspace-selection-group-overlay"')
			expectSourceToContain(ts, 'function getSelectionOverlayBounds(): Rect | null')
			expectSourceToContain(ts, 'function getSelectionOverlayBoundsForNode(')
			expectSourceToContain(ts, 'function updateSelectionGroupOverlayElement(): void')
			expectSourceToContain(ts, 'if (!currentCanvasState || !shouldShowSelectionGroupOverlay()) return null')
			expectSourceNotToContain(ts, ['getContext', 'Region', 'Cl', 'oudBounds'].join(''))
			expectSourceToContain(ts, 'updateSelectionGroupOverlayElement()')
			expectSourceToContain(scss, '.workspace-selection-group-overlay')
			const selectionGroupOverlay = extractBlock(scss, '.workspace-selection-group-overlay')
			expectExcerptToContain(selectionGroupOverlay, 'position: absolute', 'selection group overlay')
			expectExcerptToContain(selectionGroupOverlay, 'z-index: 10000', 'selection group overlay')
			expectExcerptToContain(selectionGroupOverlay, 'box-sizing: border-box', 'selection group overlay')
	})

	it('uses the selection overlay as a drag surface for the whole selected group', () => {
		expectSourceToContain(ts, "selectionGroupOverlayEl.addEventListener('mousedown'")
		expectSourceToContain(ts, 'if (!shouldShowSelectionGroupOverlay()) return')
		expectSourceToContain(ts, 'const primaryNodeId = Array.from(selectedNodeIds)[0]')
		expectSourceToContain(ts, 'handleDragStart(event, primaryNodeId)')
	})

	it('keeps connector lines visible when nodes are selected', () => {
		const edgeProjection = extractFunctionBody(ts, 'getEdgesForConnectionManager')
		expectExcerptToContain(edgeProjection, 'if (hiddenNodeIds.size === 0) return state.edges', 'connection edge projection')
		expectExcerptToContain(edgeProjection, 'state.edges.filter', 'connection edge projection')
		expectExcerptNotToContain(edgeProjection, 'selectedNodeIds', 'connection edge projection')
		expectExcerptNotToContain(edgeProjection, ['selectedContext', 'RegionNodeIds'].join(''), 'connection edge projection')
		expectSourceToContain(ts, 'connectionManager?.syncEdges(getEdgesForConnectionManager(currentCanvasState))')
		expectSourceToContain(ts, 'connectionManager.syncEdges(getEdgesForConnectionManager(currentCanvasState))')
	})

		it('keeps the overlay hit target active for any visible overlay selection', () => {
			const fnMatch = ts.match(/function\s+shouldUseSelectionGroupOverlayHitTarget[\s\S]*?^    \}/m)
			expect(fnMatch).not.toBeNull()
			const fnBody = fnMatch![0]

			expectExcerptToContain(fnBody, 'return selectedNodeIds.size > 0')
			expectExcerptNotToContain(fnBody, ['isContext', 'RegionCanvasNode'].join(''))
		})

	it('wires selection colors from settings to CSS custom properties', () => {
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-marquee-border-color', selectionStyles.marqueeBorderColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-marquee-background-color', selectionStyles.marqueeBackgroundColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-overlay-border-color', selectionStyles.overlayBorderColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-overlay-background-color', selectionStyles.overlayBackgroundColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-outline-color', selectionStyles.outlineColor)")
		expect(scss).toMatch(/var\(--selection-outline-color/)
	})

	it('wires image settings to CSS custom properties', () => {
			expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-media-node-default-box-shadow', mediaNodeStyles.defaultBoxShadow)")
			expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-media-node-selected-box-shadow', mediaNodeStyles.selectedBoxShadow)")
			expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-media-node-border-radius', `${mediaNodeStyles.borderRadius}px`)")
			expectSourceNotToContain(ts, "paneEl.style.setProperty('--workspace-media-model-badge-box-shadow', mediaNodeStyles.modelBadgeBoxShadow)")
			expect(scss).toMatch(/border-radius:\s*var\(--workspace-media-node-border-radius\)/)
	})

	it('wires resize handles through configured bounded zoom scaling', () => {
		expectSourceToContain(ts, 'const resizeHandleSettings = settings.mediaNode.resizeHandle')
		expectSourceToContain(ts, 'baseSize: resizeHandleSettings.size,')
		expectSourceToContain(ts, 'baseOffset: resizeHandleSettings.offset,')
		expectSourceToContain(ts, 'minSize: resizeHandleSettings.minSize,')
		expectSourceToContain(ts, 'zoomScaling: getAdaptiveBoundedZoomScalingOptions(resizeHandleSettings.zoomScaling),')
		expectSourceNotToContain(ts, ': { size: 24, offset: 6 }')
	})

	// -------------------------------------------------------------------------
	// Marquee selection
	// -------------------------------------------------------------------------

	it('defines marquee selection helpers and pane mousedown listener', () => {
		expectSourceToContain(ts, 'type MarqueeSelectionState = {')
		expectSourceToContain(ts, 'function handlePaneMouseDown(event: MouseEvent): void')
		expectSourceToContain(ts, "paneEl.addEventListener('mousedown', handlePaneMouseDown, true)")
			expectSourceToContain(ts, 'function ensureSelectionRectElement(): HTMLDivElement | null')
			expectSourceToContain(ts, 'function selectionRectIntersectsNode(')
			expectSourceToContain(ts, 'function getSelectableNodeIdsInRect(rect: Rect): string[]')
			expectSourceNotToContain(ts, ['rectIntersectsContext', 'RegionCl', 'oud'].join(''))
		})

	it('renders and styles the marquee selection rectangle', () => {
		expectSourceToContain(ts, 'className="workspace-selection-rect"')
		expectSourceToContain(scss, '.workspace-selection-rect')
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*pointer-events:\s*none/s)
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*z-index:\s*10001/s)
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*var\(--selection-marquee-border-color/s)
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*var\(--selection-marquee-background-color/s)
	})

	it('syncs viewport interaction state before first pan so selection works immediately on load', () => {
		expectSourceToContain(ts, 'function syncViewportInteractionState(viewport: Viewport): void')
		expectSourceToContain(ts, 'lastTransform = [viewport.x, viewport.y, viewport.zoom]')
		expectSourceToContain(ts, 'paneRect = paneEl.getBoundingClientRect()')
		expectSourceToContain(ts, 'syncViewportInteractionState(initialViewport)')
		expectSourceToContain(ts, 'syncViewportInteractionState(vp)')
	})

	it('treats transparent canvas children as background so marquee and outside-click clear still work', () => {
		expectSourceToContain(ts, 'function isCanvasBackgroundTarget(target: EventTarget | null): boolean')
		expectSourceToContain(ts, 'if (!isCanvasBackgroundTarget(event.target)) return')
		expectSourceToContain(ts, 'if (isCanvasBackgroundTarget(e.target)) {')
		expectSourceToContain(ts, 'selectionGroupOverlayEl?.contains(target)')
	})

	it('does not treat the floating AI chat panel as canvas background', () => {
		const fnMatch = ts.match(/function\s+isCanvasBackgroundTarget[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], "'.workspace-ai-chat-floating-panel'")
	})

		it('creates marquee selection state only after empty-canvas pointer movement', () => {
		const paneMouseDownMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(paneMouseDownMatch).not.toBeNull()
		const fnBody = paneMouseDownMatch![0]

		const moveHandlerIndex = fnBody.indexOf('const handleMouseMove = (moveEvent: MouseEvent) => {')
		const movementGateIndex = fnBody.indexOf('if (!marqueeSelection && movedX <= 3 && movedY <= 3) return')
		const marqueeCreateIndex = fnBody.indexOf('marqueeSelection = {')
		const selectedClearIndex = fnBody.indexOf('if (selectedNodeIds.size > 0) setSelectedNodes(new Set())')

		expect(moveHandlerIndex).toBeGreaterThanOrEqual(0)
		expect(movementGateIndex).toBeGreaterThan(moveHandlerIndex)
		expect(selectedClearIndex).toBeGreaterThan(movementGateIndex)
		expect(marqueeCreateIndex).toBeGreaterThan(selectedClearIndex)
		expectExcerptToContain(fnBody, 'moved: true')
	})

		it('does not draw any overlay for a plain single-node click', () => {
			const showMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
			expect(showMatch).not.toBeNull()
		const showBody = showMatch![0]

			expectExcerptToContain(showBody, 'return selectionIsFromMarquee')
			expectExcerptNotToContain(showBody, ['isContext', 'RegionCanvasNode(selectedNode)'].join(''))

			const fillMatch = ts.match(/function\s+shouldFillSelectionOverlayBounds[\s\S]*?^    \}/m)
			expect(fillMatch).not.toBeNull()
			const fillBody = fillMatch![0]

			expectExcerptToContain(fillBody, 'return Boolean(currentCanvasState)')
			expectExcerptNotToContain(fillBody, ['isContext', 'RegionCanvasNode'].join(''))
			expectSourceToContain(ts, 'pixiMediaLayer?.setSelectionOverlayBounds(bounds, { fill: shouldFillSelectionOverlayBounds() })')
			expectSourceToContain(ts, 'pixiMediaLayer?.setSelectionOverlayBounds(getSelectionOverlayBounds(), { fill: shouldFillSelectionOverlayBounds() })')
		})

		it('treats foreground node bounds as hits before pan/zoom can start marquee', () => {
			const panePointerDownMatch = ts.match(/function\s+handlePanePointerDown[\s\S]*?^    \}/m)
			expect(panePointerDownMatch).not.toBeNull()
			const fnBody = panePointerDownMatch![0]

			expectExcerptToContain(fnBody, 'const hitNodeId = getForegroundNodeHit(start)?.nodeId ?? null')
			expectExcerptToContain(fnBody, 'suspendPanZoomForNodePointer(hitNodeId)')
		})

	it('drag overlay passes original node.nodeId (not pre-resolved) to handleDragStart', () => {
		// The drag overlay must pass the original nodeId so handleDragStart can
		// preserve the original for the click path.
		expectSourceToContain(ts, 'handleDragStart(e, node.nodeId, {')
		expectSourceNotToContain(ts, 'onmousedown=${(e: MouseEvent) => handleDragStart(e, getSelectionTargetNodeId(node.nodeId))}')
	})

	it('marquee selection includes hidden empty threads (they are selectable via their floating input)', () => {
		const fnMatch = ts.match(/function\s+getSelectableNodeIdsInRect[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Must NOT filter out hidden empty threads — they are still visible
		// via their floating input and must be selectable
		expectExcerptNotToContain(fnBody, 'hiddenEmptyThreadNodeIds')
		expectExcerptToContain(fnBody, 'selectionRectIntersectsNode(rect, node)')
		expectSourceToContain(ts, 'rectsOverlap(rect, getSelectionBoundsForNode(node))')
	})

	// -------------------------------------------------------------------------
	// Deferred selection in handleDragStart (regression: overlay stealing clicks)
	// -------------------------------------------------------------------------

	it('defers selection in handleDragStart so the overlay does not steal mouseup', () => {
		// REGRESSION GUARD: the selection overlay (z-index 10000) must not
		// appear between mousedown and mouseup. If selectNode(resolvedNodeId)
		// ran on mousedown, the overlay could intercept mouseup/click.
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Selection must NOT happen unconditionally on mousedown — it is deferred
		// behind wasAlreadySelected and dragDidMove guards
		expectSourceToContain(fnBody, 'const wasAlreadySelected = isNodeSelected(resolvedNodeId)')
		expect(fnBody).not.toMatch(/if \(!isNodeSelected\(resolvedNodeId\)\) \{\s*\n\s*selectNode\(resolvedNodeId\)/)

		// On first meaningful mouse movement → select the resolved (thread) node for drag
		expectSourceToContain(fnBody, 'if (allowSelection && !wasAlreadySelected) {')
		expectSourceToContain(fnBody, 'selectNode(resolvedNodeId)')

		// On mouseup without movement (click) → select the original nodeId.
		expectSourceToContain(fnBody, 'selectNode(nodeId)')
	})

	it('does not move nodes in handleMouseMove until the drag threshold is exceeded', () => {
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// handleMouseMove must bail out before moving nodes when drag hasn't started
		expectExcerptToContain(fnBody, 'if (!dragDidMove) return')
	})

	// -------------------------------------------------------------------------
	// Group drag
	// -------------------------------------------------------------------------

	it('group drag uses selected nodes as drag participants', () => {
		expectSourceToContain(ts, 'const dragPlan = computeWorkspaceDragPlan({')
		expectSourceToContain(ts, 'selectedNodeIds,')
		expectSourceToContain(ts, 'const draggedNodeIds = dragPlan.draggedNodeIds')
		expectSourceToContain(ts, 'const draggedNodeEntries = new Map<string, {')
		expectSourceToContain(ts, 'for (const [draggedNodeId, entry] of draggedNodeEntries)')
	})

	it('preserves multi-selection after drag by suppressing the follow-up click collapse', () => {
		expectSourceToContain(ts, 'let suppressNextNodeClick = false')
		expectSourceToContain(ts, 'if (suppressNextNodeClick) {')
		expectSourceToContain(ts, 'if (!dragDidMove) {')
		expectSourceToContain(ts, 'suppressNextNodeClick = true')
	})

	it('group drag skips collision resolution for multi-node moves to preserve rigid spacing', () => {
		expectSourceToContain(ts, 'if (dragPlan.allowCollisionResolution) {')
		expectSourceToContain(ts, 'resolveCollisions(collisionPlan.nodeBoxes')
	})

		it('parent-container drag skips proximity checks during movement', () => {
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, 'if (dragPlan.allowProximityConnection) {')
		expectExcerptToContain(fnBody, 'connectionManager?.checkProximity(resolvedNodeId, currentPos, currentDims)')
	})
})

// =============================================================================
// Collision resolution ownership
// =============================================================================

describe('Workspace canvas — collision resolution ownership', () => {
	const ts = loadTs()
	const svelte = loadWorkspaceCanvasSvelte()
	const collisionTs = readSourceFile('../../../packages/lixpi/canvas-engine/src/shared/collision/resolve-collisions.ts', 'packages/lixpi/canvas-engine/src/shared/collision/resolve-collisions.ts')

	it('keeps toolbar insertion collision logic out of the Svelte wrapper', () => {
		// Toolbar/upload/URL-import insertion is now unified through
		// addAssetToCanvas, which routes both replace-placeholder and fresh
		// insertion through the renderer instead of a separate document/image path.
		expectSourceToContain(svelte, 'renderer?.replaceUploadPlaceholder(placeholderNodeId, node, false)')
		expectSourceToContain(svelte, 'renderer?.insertNodeAtViewportCenter(node, {}, false)')
		expectSourceNotToContain(svelte, ['context', 'RegionNode'].join(''))
		expectSourceNotToContain(svelte, 'resolveCollisions')
		expectSourceNotToContain(svelte, 'resolveInsertionCollisions')
		expectSourceNotToContain(svelte, 'computeViewportCenterInsertionPosition')
		expectSourceNotToContain(svelte, ['context', 'RegionCl', 'oudsIntersect'].join(''))
		expectSourceNotToContain(svelte, ['rectIntersectsContext', 'RegionCl', 'oud'].join(''))
	})

	it('routes toolbar insertion through the workspace renderer collision path', () => {
		expectSourceToContain(ts, 'insertNodeAtViewportCenter(node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {}, commit = true) {')
		expectSourceToContain(ts, 'position: getCenteredInsertionPosition(node.dimensions),')
		expectSourceToContain(ts, 'nodes: resolveTopLevelNodeCollisions([...baseCanvasState.nodes, preparedNode]),')
		expectSourceToContain(ts, 'onCanvasStateChange?.(newCanvasState)')
		expectSourceNotToContain(ts, 'screenDimensionsToWorldDimensions(node.dimensions')
	})

	it('uses the image-node theme width for Asset upload insertion sizing', () => {
		expectSourceToContain(svelte, 'const width = settings.mediaNode.image.defaultInsertionWidth')
		expectSourceToContain(svelte, 'getImageInsertionDimensions(result.kind === \'document\' ? 0.7727 : 1)')
		expectSourceToContain(svelte, 'dimensions,')
		expectSourceNotToContain(svelte, 'const maxWidth = 400')
		expectSourceNotToContain(svelte, 'FALLBACK_IMAGE_DIMENSIONS')
	})

	it('builds rectangular collision boxes from node world bounds', () => {
		expectSourceToContain(ts, 'function createCollisionPlan(\n        nodes: CanvasNode[],')
		expectSourceToContain(ts, 'const worldPosition = getNodeWorldPosition(node, nodesById)')
		expectSourceToContain(ts, 'const collisionRect = getCanvasNodeCollisionRect(node, worldPosition)')
		expectSourceToContain(ts, 'x: collisionRect.x,')
		expectSourceToContain(ts, 'width: collisionRect.width,')
		expectSourceNotToContain(ts, ['getContext', 'Region', 'Cl', 'oudBounds'].join(''))
	})

	it('includes resolved media title and action chrome in collision boxes', () => {
		expectSourceToContain(ts, 'getGeneratedOutputChromeCollisionInsets,')
		expectSourceToContain(ts, 'const chromeInsets = getMediaChromeCollisionInsets(node)')
		expectSourceToContain(ts, 'y: worldPosition.y - chromeInsets.top,')
		expectSourceToContain(ts, 'height: chromeInsets.top + dimensions.height + chromeInsets.bottom,')
		expectSourceToContain(ts, 'if (pendingCircleGeometry) {')
	})

	it('uses plain rectangle overlap filtering for collision pairs', () => {
		expectSourceToContain(ts, 'const shouldResolvePair = (): boolean => true')
		expectSourceNotToContain(ts, ['context', 'RegionCl', 'oudGeometry'].join(''))
	})

	it('uses the shared generic resolver rather than a workspace-specific duplicate', () => {
		expectSourceToContain(collisionTs, 'export function resolveCollisions(')
		expectSourceToContain(collisionTs, 'shouldResolvePair && !shouldResolvePair(originalA, originalB)')
		expectSourceToContain(ts, "from '@lixpi/canvas-engine'")
		expectSourceToContain(ts, 'resolveCollisions(collisionPlan.nodeBoxes')
	})

	it('keeps parent-child containment out of collision pushes', () => {
		expectSourceToContain(ts, 'collisionExclusions.add(`${child.parentId}-${child.nodeId}`)')
		expectSourceToContain(ts, 'excludePairs: collisionExclusions.size > 0 ? collisionExclusions : undefined')
		expectSourceToContain(ts, 'toParentRelativePosition(resolvedPosition, n.parentId, getCanvasNodesById(updatedNodes))')
	})
})

// =============================================================================
// Selection interaction regression guards
// =============================================================================

describe('Workspace canvas — selection interaction regression guards', () => {
	const ts = loadTs()

	// These tests guard against specific regressions that were introduced and
	// caught during the multi-selection feature development. Each test
	// documents the root cause and the invariant that must hold.

	it('REGRESSION: clicking AI chat thread must NOT show selection overlay (must allow text editing)', () => {
		// Root cause: shouldShowSelectionGroupOverlay had a special case that
		// returned true for any single aiChatThread selection. This caused the
		// overlay to appear on every click, blocking ProseMirror editor
		// interaction because:
		//   1. Click on thread → selectNode(threadId) → overlay appears at z-index 10000
		//   2. Overlay covers the thread content → resize handles activate
		//   3. User cannot click into ProseMirror to edit text
		//
		// Invariant: shouldShowSelectionGroupOverlay must NOT check raw node.type,
			// the aiChatThread string. Plain single-node
		// clicks never draw the group overlay; marquee/multi-selection does.
		const fnMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptNotToContain(fnBody, "'aiChatThread'")
		expectExcerptNotToContain(fnBody, 'node.type')
			expectExcerptNotToContain(fnBody, ['isContext', 'RegionCanvasNode(selectedNode)'].join(''))
		expectExcerptToContain(fnBody, 'return selectionIsFromMarquee')
	})

	it('REGRESSION: clicking AI chat thread content must NOT trigger selectNode', () => {
		// Root cause: nodeEl click handler called selectNode for all clicks
		// inside the node, including clicks on ProseMirror editor content.
		// This activated the node selection UI (resize handles, outline)
		// which blocked text editing in AI chat threads.
		//
		// Invariant: clicks on contenteditable, .ProseMirror, or
		// .ai-chat-thread-wrapper elements must bail out before selectNode
		const clickHandler = extractNodeElClickHandler(ts)
		expect(clickHandler).not.toBe('')

		// All three checks must be present — they cover overlapping DOM trees
		expectExcerptToContain(clickHandler, 'clickTarget.isContentEditable')
		expectExcerptToContain(clickHandler, ".closest('.ProseMirror')")
		expectExcerptToContain(clickHandler, ".closest('.ai-chat-thread-wrapper')")

		// The bail-out must happen BEFORE selectNode
		const bailOutIndex = clickHandler.indexOf('return')
		const selectNodeIndex = clickHandler.lastIndexOf('selectNode(node.nodeId)')
		expect(bailOutIndex).toBeLessThan(selectNodeIndex)
	})

	it('REGRESSION: clicking an image node selects the image node directly', () => {
		// Invariant: click handler must call selectNode(node.nodeId) with
		// the original nodeId, never pre-resolving through deprecated
		// generated-image placement state.
		const clickHandler = extractNodeElClickHandler(ts)
		expect(clickHandler).not.toBe('')

		expectExcerptToContain(clickHandler, 'selectNode(node.nodeId)')
		expectExcerptNotToContain(clickHandler, 'selectNode(selectionTargetNodeId)')
		expectExcerptNotToContain(clickHandler, 'selectNode(getSelectionTargetNodeId')
	})

	it('REGRESSION: drag overlay must NOT pre-resolve nodeId to parent thread', () => {
		// Root cause: dragOverlay mousedown passed
		// getSelectionTargetNodeId(node.nodeId) to handleDragStart, which
		// meant handleDragStart never had access to the original nodeId. On
		// mouseup-without-drag (click), it would select the thread instead
		// of the image.
		//
		// Invariant: dragOverlay must pass node.nodeId directly
		expectSourceToContain(ts, 'handleDragStart(e, node.nodeId, {')
		expectSourceNotToContain(ts, 'onmousedown=${(e: MouseEvent) => handleDragStart(e, getSelectionTargetNodeId(node.nodeId))}')
	})

	it('REGRESSION: handleDragStart must NOT select on mousedown (deferred selection)', () => {
		// Root cause: handleDragStart immediately called selectNode(resolvedNodeId)
		// on mousedown. That could show the overlay at z-index 10000 and
		// intercept mouseup before the click path ran.
		//
		// Invariant: selection must be deferred:
		//   - On drag movement → selectNode(resolvedNodeId) for group drag
		//   - On click (no movement) → selectNode(nodeId) for original node
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// The deferred selection pattern
		expectExcerptToContain(fnBody, 'const wasAlreadySelected = isNodeSelected(resolvedNodeId)')

		// Both selection paths must exist
		expectExcerptToContain(fnBody, 'selectNode(resolvedNodeId)')
		expectExcerptToContain(fnBody, 'selectNode(nodeId)')

		// selectNode(resolvedNodeId) must be inside a dragDidMove guard
		const dragMoveSection = fnBody.match(/if \(!dragDidMove[\s\S]*?dragDidMove = true[\s\S]*?\}/)?.[0]
		expect(dragMoveSection).toBeDefined()
		expectExcerptToContain(dragMoveSection, 'selectNode(resolvedNodeId)')
	})

	it('REGRESSION: marquee selecting a single node must show the overlay', () => {
		// Root cause: shouldShowSelectionGroupOverlay required size > 1 for
		// non-special-cased nodes. Marquee-selecting a single image resulted
		// in no overlay, which was inconsistent — marquee selection should
		// always produce a visible overlay regardless of count.
		//
		// Invariant: selectionIsFromMarquee must make the overlay visible
		expectSourceToContain(ts, 'return selectionIsFromMarquee')

		// The marquee handler must pass fromMarquee=true
		const paneMouseDownMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(paneMouseDownMatch).not.toBeNull()
		expectExcerptToContain(paneMouseDownMatch![0], ', true)')
	})

	it('REGRESSION: generated output images are not adopted into deleted container types on drag release', () => {
		expectSourceNotToContain(ts, ['canAdoptNodeIntoContext', 'Region'].join(''))
		expectSourceNotToContain(ts, ['workspace', 'ImageNodePlan'].join(''))
	})
})

// =============================================================================
// Image loading — PIXI is the only canvas image renderer
// =============================================================================

describe('Image loading — PIXI ownership and URL resolution strategy', () => {
	const ts = loadTs()
	const pixiLayerTs = loadPixiMediaLayer()
	const pixiLogicTs = readSourceFile('pixiMediaLayerLogic.ts')

	it('createImageNode contains no hidden DOM image loader or pixel fallback', () => {
		const fnMatch = ts.match(/function\s+createImageNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptNotToContain(fnBody, 'image-node-img', 'createImageNode')
		expectExcerptNotToContain(fnBody, '<img', 'createImageNode')
		expectExcerptNotToContain(fnBody, 'imgEl', 'createImageNode')
		expectExcerptNotToContain(fnBody, 'image-generating-spinner', 'createImageNode')
		expectExcerptNotToContain(fnBody, 'img-dot-bounce', 'createImageNode')
		expectSourceNotToContain(pixiLayerTs, 'workspace-image-node-pixi-owned')
	})

	it('PIXI resolves the canonical Asset rendition path for stored images', () => {
		// The canvas node model is Asset-owned now (assetId, no fileId/src/workspaceId
		// fields), so PIXI resolves images through the Asset rendition path rather
		// than a workspace-scoped file path.
		expectSourceToContain(pixiLogicTs, 'export function resolveStoredImagePath(node: ImageCanvasNode, _workspaceId: string): string {')
		expectSourceToContain(pixiLogicTs, 'return `/api/assets/${encodeURIComponent(node.assetId)}/renditions/preview`')
	})

	it('PIXI strips auth tokens before classifying a source as an Asset-backed API endpoint', () => {
		expectSourceToContain(pixiLogicTs, 'export function isStoredImageSrc(src: string): boolean {')
		expectSourceToContain(pixiLogicTs, 'const stripped = stripAuthTokenFromUrl(src)')
		expectSourceToContain(pixiLogicTs, 'return isApiEndpoint(stripped)')
	})

	it('PIXI passes through data and external sources without DOM loading', () => {
		expectSourceToContain(pixiLogicTs, 'export function buildPixiImageSrc(imageUrl: string, apiBaseUrl: string, token: string | false): string {')
		expectSourceToContain(pixiLogicTs, 'return resolveMediaUrl(imageUrl, { apiBaseUrl, emptyFallback: transparentPixel, token })')
		expectSourceToContain(pixiLayerTs, 'const resolvedSrc = storedImagePath ?? resolveStoredImagePath(node, workspaceId)')
	})

	it('workspaceId is declared as let (mutable) so render() can update it', () => {
		expect(ts).toMatch(/let\s+workspaceId\s*=\s*options\.workspaceId/)
	})

	it('render() accepts optional newWorkspaceId parameter and updates workspaceId', () => {
		expect(ts).toMatch(/render\(.*newWorkspaceId\?: string/)
		expectSourceToContain(ts, 'const transitionPlan = planWorkspaceRenderTransition({')
		expectSourceToContain(ts, 'workspaceId = transitionPlan.routeWorkspaceId')
		expectSourceToContain(ts, 'renderedWorkspaceId')
	})
})

// =============================================================================
// Image generation error cleanup
// =============================================================================

describe('Image generation error cleanup', () => {
	const ts = loadTs()

	function getImageErrorHandler(): string {
		const start = ts.indexOf('onImageErrorToCanvas: ({ threadId, error, generationRun }) => {')
		expect(start, 'WorkspaceCanvas.ts should contain onImageErrorToCanvas handler').toBeGreaterThan(-1)
		const end = ts.indexOf('onImagePartialToCanvas:', start)
		expect(end, 'onImageErrorToCanvas handler should end before onImagePartialToCanvas').toBeGreaterThan(start)
		return ts.slice(start, end)
	}

	it('does not keep the old broken-image placeholder path', () => {
		expectSourceNotToContain(ts, 'showImageErrorPlaceholder')
		expectSourceNotToContain(ts, 'brokenImageIcon')
		expectSourceNotToContain(ts, 'image-error-placeholder')
	})

	it('retains the failed planned node for visible terminal status and explicit user action', () => {
		const handler = getImageErrorHandler()

		expectExcerptToContain(handler, 'const runKey = getGeneratedMediaRunKey(threadId, generationRun)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'const existing = partialImageTracker.get(runKey)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'applyMediaGenerationStreamFailureToOperationNodes(currentCanvasState', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'message: error', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'partialImageTracker.delete(runKey)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'selectedNodeIds.delete(existing.nodeId)', 'onImageErrorToCanvas')
		expectExcerptNotToContain(handler, 'removeFailedGeneratedMediaNodeFromCanvas(existing.nodeId)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'finishFailedGeneratedMediaRun(threadId, generationRun)', 'onImageErrorToCanvas')
		expectExcerptNotToContain(handler, 'setTimeout', 'onImageErrorToCanvas')
	})

	it('keeps cleanup scoped to the matching generation run key', () => {
		const handler = getImageErrorHandler()

		expectExcerptToContain(handler, 'const runKey = getGeneratedMediaRunKey(threadId, generationRun)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'const existing = partialImageTracker.get(runKey)', 'onImageErrorToCanvas')
	})
})

// =============================================================================
// buildImageSrc — URL construction logic
// =============================================================================

describe('buildImageSrc — URL construction logic', () => {
	const ts = loadTs()
	const buildImageSrcFn = extractFunctionBody(ts, 'buildImageSrc')

	it('returns transparent pixel for empty imageUrl', () => {
		expect(buildImageSrcFn).not.toBe('')
		expectExcerptToContain(buildImageSrcFn, "base64MimeType: 'image/png'")
		expectExcerptToContain(
			buildImageSrcFn,
			'emptyFallback: \'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=\'',
		)
	})

	it('returns data: URLs unchanged', () => {
		expectExcerptToContain(buildImageSrcFn, 'return resolveMediaUrl(imageUrl, {')
	})

	it('prepends apiBaseUrl for /api/ paths', () => {
		expectExcerptToContain(buildImageSrcFn, 'apiBaseUrl,')
	})

	it('appends token as query param for API URLs', () => {
		expectExcerptToContain(buildImageSrcFn, 'token,')
	})
})

// =============================================================================
// Marquee selection — stale group overlay artifact fix
// =============================================================================

describe('Marquee selection — stale group overlay suppressed during active marquee', () => {
	const ts = loadTs()

	it('getSelectionOverlayBounds returns null when marqueeSelection is active', () => {
		const fnMatch = ts.match(/function\s+getSelectionOverlayBounds\(\)[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectSourceToContain(fnBody, 'if (marqueeSelection) return null')
	})

	it('clears stale selection before creating marquee selection state', () => {
		// Marquee state is now deferred until the pointer actually moves from empty
		// canvas. Any old group overlay must be cleared before marqueeSelection is
		// assigned, and marquee-selected nodes must be applied while marqueeSelection
		// is active so getSelectionOverlayBounds suppresses the stale overlay.
		const mouseMoveMatches = Array.from(
			ts.matchAll(/const handleMouseMove = \(moveEvent: MouseEvent\) => \{[\s\S]*?const handleMouseUp = \(\) => \{/g),
			(match) => match[0],
		)

		const fnBody = mouseMoveMatches.find((body) =>
			body.includes('getSelectableNodeIdsInRect(getCanvasRectFromSelection(marqueeSelection))'),
		)
		expect(fnBody).toBeDefined()

		expectExcerptToContain(fnBody!, 'if (!marqueeSelection && movedX <= 3 && movedY <= 3) return')

		const clearIndex = fnBody!.indexOf('if (selectedNodeIds.size > 0) setSelectedNodes(new Set())')
		const marqueeStartIndex = fnBody!.indexOf('marqueeSelection = {')
		expect(clearIndex).toBeGreaterThan(-1)
		expect(marqueeStartIndex).toBeGreaterThan(clearIndex)
		expectExcerptToContain(fnBody!, 'moved: true')

		const updateRectIndex = fnBody!.indexOf('updateSelectionRectElement()')
		const marqueeSelectIndex = fnBody!.indexOf('setSelectedNodes(new Set(selectedIds), true)')
		expect(updateRectIndex).toBeGreaterThan(marqueeStartIndex)
		expect(marqueeSelectIndex).toBeGreaterThan(updateRectIndex)
	})

	it('calls updateSelectionGroupOverlayElement on mouseup after clearing marqueeSelection', () => {
		// The overlay must be restored for the final selection once marqueeSelection is nulled.
		const mouseUpMatch = ts.match(
			/marqueeSelection\s*=\s*null[\s\S]*?hideSelectionRectElement\(\)[\s\S]*?updateSelectionGroupOverlayElement\(\)/
		)
		expect(mouseUpMatch).not.toBeNull()
	})
})

// =============================================================================
// Workspace connector rendering
// =============================================================================

describe('workspace connectors — PIXI owns visible pixels', () => {
	const ts = loadTs()
	const scss = loadScss()

	it('does not use CSS readiness classes to hide SVG connector pixels', () => {
		expectSourceNotToContain(ts, 'workspace-pixi-media-ready')
		expectSourceNotToContain(scss, 'workspace-pixi-media-ready')
	})

	it('does not create a workspace SVG connector layer', () => {
		expectSourceToContain(ts, 'onPixiEdgesReady: (edges) => {')
		const managerTs = readSourceFile('WorkspaceConnectionManager.ts')
		expectSourceNotToContain(ts, 'workspace-edges-layer')
		expectSourceNotToContain(scss, 'workspace-edges-layer')
		expectSourceNotToContain(managerTs, 'createConnectorRenderer')
		expectSourceNotToContain(managerTs, 'isPointInStroke')
		expectSourceNotToContain(managerTs, 'SVGPathElement')
		expectSourceNotToContain(managerTs, 'svgVisible: false')
		expectSourceToContain(managerTs, 'cachedPixiEdgeData')
		expectSourceToContain(managerTs, 'getEdgeMidpointRect(edgeId: string)')
		expectSourceToContain(managerTs, 'addPixiEdgeDatum(edgeConfig, isSelected)')
		expectSourceToContain(managerTs, 'addPixiEdgeDatum(tempEdge, false)')
		expectSourceToContain(managerTs, 'addPixiEdgeDatum(ghostEdge, false)')
	})

	it('renders PIXI connectors in an unscaled screen-space layer', () => {
		const pixiLayerTs = readSourceFile('pixiMediaLayer.ts')
		expectSourceToContain(pixiLayerTs, 'app.stage.addChild(edgeLayer)')
		expectSourceToContain(pixiLayerTs, 'app.stage.addChild(world)')
		expectSourceNotToContain(pixiLayerTs, 'world.addChild(edgeLayer)')
		expectSourceToContain(pixiLayerTs, 'edgeRenderer.render(latestPixiEdges, currentViewport)')
		expectSourceToContain(pixiLayerTs, 'edgeRenderer?.render(latestPixiEdges, viewport)')
	})

		it('does not provide a DOM image fallback for PIXI initialization failure', () => {
			const pixiLayerTs = readSourceFile('pixiMediaLayer.ts')
			const pixiLogicTs = readSourceFile('pixiMediaLayerLogic.ts')

			expectSourceNotToContain(ts, 'backfillDomImageSrcs')
			expectSourceNotToContain(ts, 'imageResolvedSrcByNodeId')
			expectSourceNotToContain(ts, "pixiHealth === 'failed'")
			expectSourceNotToContain(pixiLayerTs, "setHealth('failed')")
			expectSourceNotToContain(pixiLogicTs, "'failed'")
		})
})

// =============================================================================
// Video generation pipeline — VideoCanvasNode + VEO
// =============================================================================

describe('video generation — canvas + plugin source shape', () => {
	const ts = loadTs()

	it('registers the VideoCanvasNode lifecycle alongside images', () => {
		// Phase 5: video nodes share the same generation tracker pattern as
		// images, but never live in the PIXI image entries map — they're
		// dispatched through the mediaNodeRegistry (videoNodeHandler).
		expectSourceToContain(ts, 'const videoGenerationTracker = new Map<string, PendingGeneratedMediaTracker>()')
		expectSourceToContain(ts, 'createVideoNodeHandler')
		expectSourceToContain(ts, "videoNode?.type !== 'video'")
		expectSourceToContain(ts, 'setAiGeneratedVideoCallbacks({')
		expectSourceToContain(ts, 'onVideoPendingToCanvas:')
		expectSourceToContain(ts, 'onVideoCompleteToCanvas:')
		expectSourceToContain(ts, 'onVideoErrorToCanvas:')
	})

	it('feeds the PIXI traveling outline with image, video, and reference nodes', () => {
		// Phase 5 v1.1+: the snake outline must frame VEO video placeholders
		// plus selected/reference media before the first variant arrives.
		// Regression-guards both the merged id set and unified canvas-state bounds.
		const pixiLayerTs = loadPixiMediaLayer()
		expectSourceToContain(ts, 'function syncPixiGeneratingImageNodes(canvasState: CanvasState | null = currentCanvasState): void')
		expectSourceToContain(ts, 'for (const partial of partialImageTracker.values())')
		expectSourceToContain(ts, 'for (const pending of videoGenerationTracker.values())')
		expectSourceToContain(ts, 'for (const node of canvasState?.nodes ?? [])')
		expectSourceToContain(ts, 'if (generatingIds.has(node.nodeId) || !isGeneratedMediaCanvasNodeWaitingForFrame(node)) continue')
		expectSourceToContain(ts, "shape: 'preFrameCircle',")
		expectSourceToContain(ts, 'function isGeneratedMediaCanvasNodeWaitingForFrame(node: CanvasNode): node is ImageCanvasNode | VideoCanvasNode')
		expectSourceToContain(ts, 'for (const referenceNodeIds of generatingReferenceNodeIdsByThread.values())')
		expectSourceToContain(ts, 'pixiMediaLayer?.setGeneratingImageNodes(generatingIds)')
		expectSourceToContain(pixiLayerTs, 'const nodesById = lastState ? buildNodesById(lastState.nodes) : new Map()')
		expectSourceToContain(pixiLayerTs, 'const node = nodesById.get(nodeId)')
		expectSourceToContain(pixiLayerTs, 'width: node.dimensions.width')
		expectSourceToContain(pixiLayerTs, 'height: node.dimensions.height')
		expectSourceToContain(pixiLayerTs, 'visible: true,')
		expectSourceNotToContain(pixiLayerTs, "if (!fallbackNode || fallbackNode.type === 'image') continue")
	})

	it('keeps no DOM bounce-dot spinner for generating videos either', () => {
		// PR #202 regression: PIXI outline is the sole canvas indicator for
		// both kinds. The video placeholder must not reintroduce any of the
		// removed DOM-spinner CSS classes.
		expectSourceNotToContain(ts, 'video-generating-spinner')
		expectSourceNotToContain(ts, 'video-dot-bounce')
	})

	it('wires the bubble menu for video nodes (Replace + Download + Connect + Add to Media Library + Delete)', () => {
		// Video nodes share Replace, Download, Add to Media Library, and Connect
		// with images, while keeping dedicated Delete behavior.
		const bubbleMenuTs = readSourceFile('canvasBubbleMenuItems.ts')
		expectSourceToContain(ts, "import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT")
		// Every uploaded media kind maps to a bubble-menu context (image, video,
		// mediaDocument, audio) — so documents/audio also get a menu (Delete).
		expectSourceToContain(ts, "video: CANVAS_VIDEO_CONTEXT,")
		expectSourceToContain(ts, "mediaDocument: CANVAS_DOCUMENT_CONTEXT,")
		expectSourceToContain(ts, "const context = node ? bubbleContextByType[node.type] : undefined")
		expectSourceToContain(ts, 'onDownloadMedia: (nodeId) => {')
		expectSourceToContain(ts, 'onReplaceMedia: (nodeId) => {')
		expectSourceToContain(bubbleMenuTs, "export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'")
		expectSourceToContain(bubbleMenuTs, "title: 'Replace media'")
		expectSourceToContain(bubbleMenuTs, "title: 'Download media'")
		expectSourceToContain(bubbleMenuTs, "title: 'Delete video'")
		expectSourceToContain(bubbleMenuTs, 'context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT]')
	})

	it('resolves sourceVideoNodeId to an Asset id at submit time', () => {
		// Phase 6: the chat plugin forwards `sourceVideoNodeId` only via thread
		// attrs; WorkspaceCanvas resolves it to the source video's Asset id just
		// before publishing to NATS — the API resolves the authorized
		// organization Blob coordinate from that Asset id. VEO's precedence is
		// extension > first-frame > references > text-only.
		expectSourceToContain(ts, 'let videoSourceForExtension: string | undefined')
		expectSourceToContain(ts, "videoOptions?.sourceVideoNodeId")
		expectSourceToContain(ts, 'if (sourceVideoNode?.assetId) {')
		expectSourceToContain(ts, 'videoSourceForExtension = sourceVideoNode.assetId')
		expectSourceToContain(ts, 'videoSourceForExtension,')
	})

	it('feeds videos into downstream context as their representative frame, never the MP4', () => {
		// The old ai-chat-thread-service.ts poster+metadata context-item path is
		// gone. Video context now flows through ai-image-branching.ts's Asset
		// rendition resolver: videos resolve to the representativeFrame rendition
		// (falling back to the frame-0 poster), the MP4 itself is never sent.
		const branchingTs = readSourceFile('../../services/ai-image-branching.ts')
		expectSourceToContain(branchingTs, "return buildAssetRenditionPath(node.assetId, node.type === 'video' ? 'representativeFrame' : 'preview')")
		expectSourceNotToContain(branchingTs, "'.mp4'")
	})
})

// =============================================================================
// Asset membership persistence
// =============================================================================

describe('asset membership persistence', () => {
	const ts = loadTs()
	const svelte = loadWorkspaceCanvasSvelte()

	it('requires explicit membership confirmation before committing upload state', () => {
		const uploadHandlerStart = svelte.indexOf('async function addAssetToCanvas(')
		const uploadHandlerEnd = svelte.indexOf('\n    onMount(() => {', uploadHandlerStart)
		const uploadHandler = svelte.slice(uploadHandlerStart, uploadHandlerEnd)
		const assertionIndex = uploadHandler.indexOf('assertAssetAttached(response, result.assetId, nodeId)')
		const commitIndex = uploadHandler.indexOf('renderer?.commitTransientCanvasNodeInsertion(')

		expect(uploadHandlerStart).toBeGreaterThan(-1)
		expect(uploadHandlerEnd).toBeGreaterThan(uploadHandlerStart)
		expect(assertionIndex).toBeGreaterThan(-1)
		expect(commitIndex).toBeGreaterThan(assertionIndex)
		expectSourceToContain(svelte, 'if (attached.assetId !== assetId')
		expectSourceToContain(svelte, '!attached.nodeIds.includes(nodeId)')
		expectSourceToContain(svelte, "throw new Error('INVALID_ASSET_ATTACH_RESPONSE')")
		expectSourceToContain(svelte, 'assertAssetDetached(response)')
	})

	it('uses the per-workspace mutation lane and commits the rebased accepted state', () => {
		const membershipRebase = loadCanvasMembershipStateRebase()

		expectSourceToContain(svelte, 'return await workspaceService.runCanvasMembershipMutation({')
		expectSourceToContain(svelte, 'const nextCanvasState = rebaseRequestedCanvasMembershipState(requestedCanvasState, \'attach\')')
		expectSourceToContain(svelte, "'detach',\n                        removedNodeIds,")
		expectSourceToContain(membershipRebase, 'const removedNodeIdSet = new Set(removedNodeIds)')
		expectSourceToContain(membershipRebase, 'removedNodeIdSet.has(node.nodeId)')
		expectSourceToContain(membershipRebase, 'removedNodeIdSet.has(edge.sourceNodeId)')
		expectSourceToContain(svelte, 'const canvasStateUpdatedAt = getNextCanvasMembershipRevision(expectedCanvasStateUpdatedAt)')
		expectSourceToContain(ts, 'removedNodeIds: string[]')
		expectSourceToContain(ts, 'onAssetAttach?: (params: { assetId: string; nodeId: string; canvasState: CanvasState }) => Promise<CanvasState>')
		expectSourceToContain(ts, 'const committedState = await onAssetAttach({ assetId: item.assetId, nodeId, canvasState: nextState })')
		expectSourceToContain(ts, 'commitTransientCanvasStatePreservingEditors(committedState)')
	})
})

describe('canvas node deletion', () => {
	const ts = loadTs()

	it('deletes marquee selections from the keyboard without intercepting editor input', () => {
		const start = ts.indexOf('const onKeyDown = (e: KeyboardEvent) => {')
		const end = ts.indexOf('\n    function ensureMediaLibraryPanel()', start)
		const handler = ts.slice(start, end)

		expect(start).toBeGreaterThan(-1)
		expect(end).toBeGreaterThan(start)
		expectExcerptToContain(handler, 'if (isTyping) return', 'canvas keydown handler')
		expectExcerptToContain(handler, "(e.key === 'Backspace' || e.key === 'Delete') && selectedNodeIds.size > 0", 'canvas keydown handler')
		expectExcerptToContain(handler, 'void deleteCanvasNodes(new Set(selectedNodeIds))', 'canvas keydown handler')
	})

	it('uses one deletion path for node menus and generated-output rejection', () => {
		expectSourceToContain(ts, 'void deleteCanvasNodes(new Set([nodeId]))')
		expectSourceToContain(ts, 'async function deleteCanvasNodes(nodeIds: ReadonlySet<string>): Promise<void>')
		expectSourceToContain(ts, 'return isGeneratedOutputRejectableForCanvas({')
		expectSourceToContain(ts, "action: 'reject'")
		expectSourceToContain(ts, 'aria-label="Reject and delete generated output"')
		expectSourceToContain(ts, 'innerHTML=${trashBinIcon}')
	})

	it('keeps rejection enabled while an output is still generating', () => {
		const rejectButton = extractFunctionBody(ts, 'createMediaRejectButton')

		expectExcerptToContain(
			rejectButton,
			"? 'Cancel generation and delete output'",
			'createMediaRejectButton',
		)
		expect(
			rejectButton.includes('button.disabled'),
			'createMediaRejectButton should not disable pending-output deletion',
		).toBe(false)
	})

	it('rejects a selected lineage marker authoritatively and locally removes an unpersisted orphan', () => {
		const deletion = extractFunctionBody(ts, 'deleteCanvasNodes')

		expectExcerptToContain(deletion, 'if (isBranchMarkerNode(node))', 'deleteCanvasNodes')
		expectExcerptToContain(deletion, "await rejectGeneratedOutput('branch-lineage', node.nodeId)", 'deleteCanvasNodes')
		expectExcerptToContain(deletion, "if (outcome === 'not-found')", 'deleteCanvasNodes branch marker handling')
		expectExcerptToContain(deletion, 'await detachCanvasNode(node.nodeId)', 'deleteCanvasNodes branch marker handling')
		expectSourceToContain(ts, "if (result.error === 'GENERATED_OUTPUT_NOT_FOUND') return 'not-found'")
	})

	it('passes every pruned marker id through the authoritative Asset detach rebase', () => {
		expectSourceToContain(ts, 'const removedNodeIds = getRemovedCanvasNodeIds(previousState, unprunedNextState)')
		expectSourceToContain(ts, 'const nextState = pruneCanvasContextChips(unprunedNextState, removedNodeIds)')
		expectSourceToContain(ts, 'resolveGeneratedMediaTreeState(remainingNodes, updatedEdges)')
		expectSourceToContain(ts, 'commitTransientCanvasStatePreservingEditors(committedState)')
	})
})
