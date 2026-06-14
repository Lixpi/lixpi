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
	return readSourceFile('../../utils/animations/gradients/pixiTravelingOutlineRenderer.ts', 'utils/animations/gradients/pixiTravelingOutlineRenderer.ts')
}

function loadWorkspaceCanvasSvelte(): string {
	return readSourceFile('../../components/WorkspaceCanvas.svelte', 'components/WorkspaceCanvas.svelte')
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

function loadLayout(): string {
	return readSourceFile('../../views/layouts/layout.svelte', 'views/layouts/layout.svelte')
}

function loadSidebar(): string {
	return readSourceFile('../../components/Sidebar.svelte', 'components/Sidebar.svelte')
}

function loadSettings(): string {
	return readSourceFile('../../settings.ts', 'settings.ts')
}

function loadSvgIcons(): string {
	return readSourceFile('../../svgIcons/index.ts', 'svgIcons/index.ts')
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
		expect(imageNodeBlock).toMatch(/^\s*box-shadow:\s*var\(--workspace-image-default-box-shadow\);/m)
	})

	it('keeps generated media model chrome free of badge and button shadows', () => {
		const badgeBlock = extractBlock(scss, '.image-model-badge')
		const infoButtonBlock = extractBlock(scss, '.image-info-button')

		expect(extractBoxShadowValues(badgeBlock)).toHaveLength(0)
		expect(extractBoxShadowValues(infoButtonBlock)).toHaveLength(0)
	})

	it('uses a theme-configured shadow for selected image nodes', () => {
		const selectedBlock = extractBlockContainingSelector(imageNodeBlock, '&.is-selected')
		expectExcerptToContain(selectedBlock, 'box-shadow: var(--workspace-image-selected-box-shadow)', 'selected image selector block')
		expectExcerptNotToContain(selectedBlock, 'outline:', 'selected image selector block')
	})

	it('uses helper-driven bounded zoom layout for generated media chrome', () => {
		const ts = loadTs()
		const chromeLayerBlock = extractBlock(scss, '.workspace-generated-media-chrome-layer')
		const actionsBlock = extractBlock(scss, '.workspace-generated-image-actions')
		const badgeBlock = extractBlock(scss, '.image-model-badge')
		const badgeIconBlock = extractBlockContainingSelector(scss, '.image-model-badge-icon,\n.image-model-badge svg')
		const infoButtonBlock = extractBlock(scss, '.image-info-button')
		const infoIconBlock = extractBlock(infoButtonBlock, 'svg')
		const panelBlock = extractBlock(scss, '.canvas-generated-image-info-panel')
		const traceDetailsBlock = extractBlock(scss, '.canvas-generated-media-projection-editor .canvas-generated-image-trace-details')
		const promptAndFinalFallbackBlock = scss.match(
			/\.canvas-generated-media-projection-editor \.ai-image-generation-tool-prompt-fallback,[\s\S]*?\.canvas-generated-media-projection-editor \.ai-image-generation-final-prompt \{[\s\S]*?\}/
		)?.[0] ?? ''
		const activeBlock = extractBlock(infoButtonBlock, '&.is-active')

		expectSourceToContain(ts, 'generatedMediaChromeLayerEl = createGeneratedMediaChromeLayer()')
		expectSourceToContain(ts, 'getCanvasChromeScreenLayout({')
		expectSourceToContain(ts, 'viewport,\n            worldPosition: position,\n            worldDimensions: dimensions,')
		expectSourceToContain(ts, 'baseGap: settings.imageNode.generatedMediaChrome.topGap,')
		expectSourceToContain(ts, 'zoomScaling: settings.imageNode.generatedMediaChrome.zoomScaling,')
		expectSourceToContain(ts, 'left: `${chromeLayout.left}px`,')
		expectSourceToContain(ts, 'top: `${chromeLayout.top}px`,')
		expectSourceToContain(ts, 'width: `${chromeLayout.layoutWidth}px`,')
		expectSourceToContain(ts, 'transform: `scale(${chromeLayout.screenScale})`,')
		expectSourceToContain(ts, 'getVisualScale: () => scaleCanvasChromeToScreenForZoom(')
		expectSourceToContain(ts, 'settings.canvasBubbleMenu.zoomScaling,')
		expectSourceToContain(ts, 'updateGeneratedImageChromeLiveTransform(node.nodeId, position, dimensions, viewport)')
		expectSourceToContain(ts, 'updateGeneratedMediaChromeLayout(vp)')
		expectSourceToContain(ts, 'generatedMediaChromeLayerEl.replaceChildren(')
		expectSourceToContain(ts, 'imageChromeViewportEl.replaceChildren(')
		expectSourceToContain(ts, "return modelMeta?.title ?? ''")
		expectSourceNotToContain(ts, 'getCanvasChromeZoomMultiplier')
		expectSourceNotToContain(ts, 'const localScale = scaleCanvasChromeForZoom(1, zoom)')
		expectSourceNotToContain(ts, 'getTransformedCanvasChromeLayout')
		expectSourceNotToContain(ts, 'zoom: getCurrentViewportZoom(),')
		expectSourceNotToContain(ts, 'zoom: number = getCurrentViewportZoom()')
		expectSourceNotToContain(ts, 'pendingGeneratedMediaChromeZoom')
		expectSourceNotToContain(ts, 'updateGeneratedMediaChromeZoomScaling')
		expectSourceNotToContain(ts, 'function getGeneratedImageInfoWidth')
		expectExcerptToContain(chromeLayerBlock, 'position: absolute', 'generated media chrome layer block')
		expectExcerptToContain(chromeLayerBlock, 'inset: 0', 'generated media chrome layer block')
		expectExcerptToContain(chromeLayerBlock, 'pointer-events: none', 'generated media chrome layer block')
		expectExcerptToContain(actionsBlock, 'width: 100%', 'generated image actions block')
		expectExcerptToContain(actionsBlock, 'gap: 0', 'generated image actions block')
		expectExcerptToContain(badgeBlock, 'height: 34px', 'image model badge block')
		expectExcerptToContain(badgeIconBlock, 'width: 34px', 'image model badge icon block')
		expectExcerptToContain(badgeIconBlock, 'height: 34px', 'image model badge icon block')
		expectExcerptNotToContain(badgeBlock, 'border:', 'image model badge block')
		expectExcerptNotToContain(badgeBlock, 'box-shadow:', 'image model badge block')
		expectExcerptToContain(infoButtonBlock, 'width: 34px', 'image info button block')
		expectExcerptToContain(infoButtonBlock, 'height: 34px', 'image info button block')
		expectExcerptToContain(infoButtonBlock, 'border: none', 'image info button block')
		expectExcerptToContain(infoIconBlock, 'width: 34px', 'image info icon block')
		expectExcerptToContain(infoIconBlock, 'height: 34px', 'image info icon block')
		expectExcerptNotToContain(infoIconBlock, 'transform:', 'image info icon block')
		expectExcerptToContain(activeBlock, 'color: #4d5963', 'active image info button block')
		expectExcerptToContain(activeBlock, 'background: transparent', 'active image info button block')
		expectExcerptNotToContain(activeBlock, '$steelBlue', 'active image info button block')
		expectExcerptNotToContain(activeBlock, 'border-color:', 'active image info button block')
		expectExcerptToContain(panelBlock, 'overflow: visible', 'generated image info panel block')
		expectExcerptNotToContain(panelBlock, 'max-height: 440px', 'generated image info panel block')
		expectExcerptNotToContain(panelBlock, 'overflow: auto', 'generated image info panel block')
		expectExcerptToContain(traceDetailsBlock, 'margin: 0.65rem 0 0', 'canvas trace details block')
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
		expectSourceToContain(ts, 'settings.imageNode.styles.borderRadius')
		expectSourceToContain(ts, 'sprite.mask = spriteMask')
		expectSourceToContain(ts, 'function syncSpriteMask(entry: PixiImageEntry')
		expectSourceToContain(ts, 'entry.spriteMask.roundRect(0, 0, width, height, radius)')
		expectSourceToContain(ts, 'rect.roundRect(0, 0, width, height, getImageBorderRadius(width, height))')
	})

	it('supports optional fill for selection overlays', () => {
		expectSourceToContain(ts, 'type SelectionOverlayOptions = {')
		expectSourceToContain(ts, 'fill?: boolean')
		expectSourceToContain(ts, 'options: SelectionOverlayOptions = {}')
		expectSourceToContain(ts, 'if (options.fill !== false) groupOverlayGraphics.fill({ color: selectionColors.groupOverlayFill })')
		expectSourceToContain(ts, 'groupOverlayGraphics.stroke({ color: selectionColors.groupOverlayStroke')
	})

	it('reads generation-border colors from style tokens while keeping geometry tokens separate', () => {
		expectSourceToContain(ts, 'const generationBorder = settings.imageNode.generationBorder')
		expectSourceToContain(ts, 'const generationBorderStyles = generationBorder.styles')
		expectSourceToContain(ts, 'radius: generationBorder.radius')
		expectSourceToContain(ts, 'trackWidth: generationBorder.trackWidth')
		expectSourceToContain(ts, 'trackColor: generationBorderStyles.trackColor')
		expectSourceToContain(ts, 'trackAlpha: generationBorderStyles.trackAlpha')
		expectSourceToContain(ts, 'segmentTailAlpha: generationBorderStyles.snakeTailAlpha')
		expectSourceToContain(ts, 'segmentColors: generationBorderStyles.snakeColors')
		expectSourceNotToContain(ts, 'trackColor: generationBorder.trackColor')
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
		expectExcerptToContain(partialHandler, "const imageSrc = buildImageSrc(imageUrl, '', false)")
		expectExcerptToContain(partialHandler, 'commitCanvasStatePreservingEditors({ ...currentCanvasState, nodes: updatedNodes })')
		expectExcerptNotToContain(partialHandler, 'imgEl.src', 'partial image handler')
	})

	it('renders the generating-image snake border through PIXI until the image leaves partial state', () => {
		const pixiLayerTs = loadPixiMediaLayer()
		const outlineRendererTs = loadPixiTravelingOutlineRenderer()
		const settingsTs = loadSettings()
		const partialStart = ts.indexOf('onImagePartialToCanvas:')
		const completeStart = ts.indexOf('onImageCompleteToCanvas:', partialStart)
		const partialHandler = ts.slice(partialStart, completeStart)
		const completeEnd = ts.indexOf('onEditInNewThread:', completeStart)
		const completeHandler = ts.slice(completeStart, completeEnd)

		expectSourceToContain(ts, 'pixiMediaLayer?.setGeneratingImageNodes(')
		expectSourceToContain(pixiLayerTs, "const generatingBorderLayer = new Container({ label: 'workspace-pixi-generating-borders' })")
		expectSourceToContain(pixiLayerTs, 'world.addChild(generatingBorderLayer)')
		expectSourceToContain(outlineRendererTs, 'export class PixiTravelingOutlineRenderer {')
		expectSourceToContain(pixiLayerTs, 'new PixiTravelingOutlineRenderer({')
		expectSourceToContain(pixiLayerTs, 'generatingBorderRenderer.sync(datums)')
		expectSourceToContain(outlineRendererTs, "graphics.label = 'pixi-traveling-outline'")
		expectSourceToContain(outlineRendererTs, 'private paint(entry: OutlineEntry, elapsed: number)')
		expectSourceToContain(outlineRendererTs, 'getTravelingOutlineHeadDistance(elapsed, this.style.durationMs, perimeter, this.ease)')
		expectSourceToContain(outlineRendererTs, 'graphics.roundRect(0, 0, width, height, this.style.radius)')
		expectSourceToContain(outlineRendererTs, 'interpolateTravelingOutlineColor(this.style.segmentColors, headProgress)')
		expectSourceToContain(outlineRendererTs, 'this.ease = options.ease ?? Easing.travelingOutlineTransition')
		expectSourceToContain(pixiLayerTs, 'function setGeneratingImageNodes(nodeIds: Set<string>)')
		expectSourceToContain(settingsTs, 'trackWidth: 3')
		expectSourceToContain(settingsTs, 'snakeWidth: 4')
		expectSourceToContain(settingsTs, 'snakeLengthFraction: 0.24')
		expectSourceToContain(settingsTs, "snakeColors: ['#1D57CB', '#2474FF', '#7C4DFF', '#D63FF0', '#FF9933']")
		expectSourceToContain(settingsTs, 'animationDurationMs: 3200')
		expectSourceNotToContain(ts, 'SvgGradientRenderer')
		expectSourceNotToContain(ts, 'image-generating-border')
		expectSourceNotToContain(ts, 'image-generating-spinner')
		expectSourceNotToContain(ts, 'img-dot-bounce')
		expectSourceNotToContain(scss, '.workspace-image-progress-viewport')
		expectExcerptNotToContain(partialHandler, 'partialImageTracker.delete', 'partial image handler')
		expectExcerptToContain(completeHandler, 'partialImageTracker.delete(runKey)')
		expectExcerptToContain(completeHandler, 'commitCanvasState({')
	})

	it('finalizes the same PIXI-backed image node without updating a legacy DOM image', () => {
		const completeStart = ts.indexOf('onImageCompleteToCanvas:')
		const callbackEnd = ts.indexOf('onEditInNewThread:', completeStart)
		expect(completeStart).toBeGreaterThan(-1)
		expect(callbackEnd).toBeGreaterThan(completeStart)

		const completeHandler = ts.slice(completeStart, callbackEnd)
		expectExcerptToContain(completeHandler, "const imageSrc = buildImageSrc(imageUrl, '', false)")
		expectExcerptToContain(completeHandler, 'commitCanvasState({')
		expect([...completeHandler.matchAll(/\.\.\.\(currentCanvasState \?\? \{\}\)/g)]).toHaveLength(2)
		expectExcerptNotToContain(completeHandler, 'imgEl.src', 'complete image handler')
	})

	it('preserves workspace panel metadata when image workflows write canvas state', () => {
		const partialStart = ts.indexOf('onImagePartialToCanvas:')
		const completeStart = ts.indexOf('onImageCompleteToCanvas:', partialStart)
		const editStart = ts.indexOf('onEditInNewThread:')
		const partialHandler = ts.slice(partialStart, completeStart)
		const editHandler = ts.slice(editStart, ts.indexOf('// Visibility detection for lazy loading', editStart))

		expectExcerptToContain(partialHandler, '...(currentCanvasState ?? {})', 'partial image handler')
		expectExcerptToContain(editHandler, '...(currentCanvasState ?? {})', 'edit-in-new-thread handler')
		expectSourceToContain(ts, 'const nextState: CanvasState = {\n                    ...currentCanvasState,')
	})

	it('re-tidies generated-media trees when final image proportions resolve', () => {
		expectSourceToContain(ts, 'computeLineageContinuationPositionToRightOfRect(')
		expectSourceToContain(ts, 'const resolvedNodes = isGeneratedMediaNode(imageNode)')
		expectSourceToContain(ts, 'const resolvedNodes = isGeneratedMediaNode(videoNode)')
		expectSourceToContain(ts, '? rebalanceGeneratedMediaTrees(updatedNodes, currentCanvasState.edges)')
		expectSourceToContain(ts, 'syncCanvasNodeDomGeometry(nextState.nodes)')
		expectSourceNotToContain(ts, 'getGeneratedImageLineageAnchorRect(')
		expectSourceNotToContain(ts, '? computeVerticallyCenteredY(lineageAnchorRect, fittedDimensions.height)')
	})

	it('routes generated-media add/remove through the centralized tree rebalance', () => {
		// One helper re-tidies every branch tree and rigid-separates trees + loose
		// nodes via the unchanged resolver, replacing the per-handler collision block.
		expectSourceToContain(ts, "import { rebalanceBranchTreesAndResolve } from '$src/infographics/workspace/branchTreeLayout.ts'")
		expectSourceToContain(ts, 'function rebalanceGeneratedMediaTrees(nodes: CanvasNode[], edges: WorkspaceEdge[]): CanvasNode[]')
		expectSourceToContain(ts, 'return rebalanceBranchTreesAndResolve(nodes, edges, {')
		expectSourceToContain(ts, 'depthGap: settings.imageBranchLineage.imageToImageGap,')
		expectSourceToContain(ts, 'siblingGap: settings.imageBranchLineage.branchToBranchGap,')
		expectSourceToContain(ts, 'branchFanoutDepthGap: settings.imageBranchLineage.branchFanoutDepthGap,')
		// Wired into every generated-media add path (image partial + complete, video).
		expectSourceToContain(ts, 'const rebalancedNodes = rebalanceGeneratedMediaTrees(nodesWithImage, newEdges)')
		expectSourceToContain(ts, 'const resolvedNodes = rebalanceGeneratedMediaTrees(nodes, edges)')
		expectSourceToContain(ts, 'const resolvedNodes = rebalanceGeneratedMediaTrees(allNodes, newEdges)')
		expectSourceToContain(ts, 'const rebalancedNodes = rebalanceGeneratedMediaTrees(nodesWithVideo, newEdges)')
		// Re-tidies on delete only when the removed node was a lineage member.
		expectSourceToContain(ts, 'deletedNode && isBranchTreeCanvasNode(deletedNode)')
		expectSourceToContain(ts, 'resolveGeneratedMediaTreeState(remainingNodes, updatedEdges)')
		expectSourceNotToContain(ts, ['stripLegacy', 'Branch', 'Origin', 'Nodes'].join(''))
	})

})

describe('Workspace canvas — generated video canvas state', () => {
	const ts = loadTs()

	it('preserves workspace panel metadata when video workflows write canvas state', () => {
		// Regression: the video callbacks used to build a fresh { viewport, nodes,
		// edges } object, dropping aiChatPanel / sidebar tabs and collapsing the
		// chat panel. Every video write must spread the existing canvas state.
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

		expectExcerptToContain(pendingHandler, '...(currentCanvasState ?? {})', 'video pending handler')
		expectExcerptToContain(completeHandler, '...currentCanvasState', 'video complete handler')
		expectExcerptToContain(errorHandler, '...currentCanvasState', 'video error handler')
	})

	it('renders shared SVG controls for completed video nodes in the chrome layer', () => {
		// The controls must live in the z-index-3 chrome layer because PIXI paints
		// the video pixels above the DOM node shell.
		expectSourceToContain(ts, 'function createVideoControlsChrome(node: VideoCanvasNode)')
		expectSourceToContain(ts, 'className="workspace-video-chrome nopan"')
		expectSourceToContain(ts, 'createVideoControls(svg, {')
		expectSourceToContain(ts, 'videoNodeHandler?.getVideoElement(node.nodeId)')
		expectSourceToContain(ts, 'if (!videoEl.currentSrc && !videoEl.src) return null')
		expectSourceToContain(ts, "chromeEl.addEventListener('mouseenter', () => showVideoControls(node.nodeId))")
		expectSourceToContain(ts, "chromeEl.addEventListener('mousemove', (event: MouseEvent) => {")
		expectSourceToContain(ts, 'handleDragStart(event, node.nodeId)')
		expectSourceToContain(ts, 'handleResizeStart(event, node.nodeId, resizeHandle)')
		// Only completed videos (with a stored MP4 src) get the controls.
		expectSourceToContain(ts, "node.type === 'video' && Boolean((node as VideoCanvasNode).src)")
		// The chrome geometry tracks the node during live drag/resize.
		expectSourceToContain(ts, 'applyVideoControlsGeometry(videoChromeEl, position, dimensions)')
	})

	it('syncs video chrome after video handler entries exist', () => {
		const renderStart = ts.indexOf('render(newCanvasState: CanvasState | null')
		const pixiSync = ts.indexOf('syncPixiMediaLayer(currentCanvasState)', renderStart)
		const chromeSync = ts.indexOf('syncGeneratedImageChrome(currentCanvasState)', renderStart)

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

	it('rebalances branch-lineage trees when a video completes, mirroring images', () => {
		const completeStart = ts.indexOf('onVideoCompleteToCanvas:')
		const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
		const completeHandler = ts.slice(completeStart, errorStart)

		expectExcerptToContain(completeHandler, 'rebalanceGeneratedMediaTrees(nodes, currentCanvasState.edges)', 'video complete handler')
		expectExcerptToContain(completeHandler, 'nodes: resolvedNodes,', 'video complete handler')
		expectExcerptToContain(completeHandler, 'edges: currentCanvasState.edges,', 'video complete handler')
	})

	it('threads the representative mid-frame fileId onto the completed video node', () => {
		const completeStart = ts.indexOf('onVideoCompleteToCanvas:')
		const errorStart = ts.indexOf('onVideoErrorToCanvas:', completeStart)
		const completeHandler = ts.slice(completeStart, errorStart)
		expectExcerptToContain(completeHandler, 'frameFileId: frameFileId || videoNode.frameFileId,', 'video complete handler')
	})

	it('renders the info button + panel in the below-node media chrome (image+video parity)', () => {
		// The shared media chrome (a strip below the node) carries the info button
		// and descriptor panel for BOTH images and videos.
		const chromeStart = ts.indexOf('function createGeneratedMediaChrome(node: ImageCanvasNode | VideoCanvasNode, viewport: Viewport)')
		const chromeEnd = ts.indexOf('function createVideoControlsChrome', chromeStart)
		const mediaChrome = ts.slice(chromeStart, chromeEnd)
		expect(chromeStart).toBeGreaterThan(-1)
		expectExcerptToContain(mediaChrome, 'createMediaInfoButton(node)', 'media chrome')
		expectExcerptToContain(mediaChrome, 'createGeneratedMediaInfoPanel(node)', 'media chrome')
		expectExcerptToContain(mediaChrome, 'applyGeneratedImageChromeGeometry(', 'media chrome')
	})

	it('keeps the video controls overlay free of the info button', () => {
		// Regression: the info button used to share the video overlay, which shoved
		// both affordances to opposite edges of the node. The video controls overlay
		// must contain ONLY the controls now; the info button lives in the
		// below-node media chrome.
		const chromeStart = ts.indexOf('function createVideoControlsChrome(node: VideoCanvasNode)')
		const chromeEnd = ts.indexOf('function destroyVideoControlInstances', chromeStart)
		const controlsChrome = ts.slice(chromeStart, chromeEnd)
		expectExcerptToContain(controlsChrome, 'workspace-video-controls-host nopan', 'video controls chrome')
		expectExcerptNotToContain(controlsChrome, 'createMediaInfoButton(node)', 'video controls chrome')
		expectExcerptNotToContain(controlsChrome, 'workspace-generated-image-actions', 'video controls chrome')
	})

	it('renders media info chrome for both image and video nodes', () => {
		expectSourceToContain(ts, 'generatedMediaChromeLayerEl.replaceChildren(')
		expectSourceToContain(ts, '...mediaInfoNodes.map((node: ImageCanvasNode | VideoCanvasNode) => createGeneratedMediaChrome(node, viewport)),')
		expectSourceToContain(ts, "(node.type === 'image' || node.type === 'video')")
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
		const overlay = extractBlock(scss, '.video-drag-overlay')
		const imageOverlay = extractBlock(scss, '.image-drag-overlay')
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
		const controlsHost = extractBlock(scss, '.workspace-video-controls-host')

		expectExcerptToContain(chrome, 'pointer-events: auto', '.workspace-video-chrome')
		expectExcerptToContain(controlsHost, 'pointer-events: auto', '.workspace-video-controls-host')
		expectExcerptToContain(controlsHost, '&.is-visible', '.workspace-video-controls-host')
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
	const scss = loadScss()

	it('derives a descriptor from generated media metadata for free (no extra model call)', () => {
		expectSourceToContain(ts, 'function buildDescriptorFromGeneratedBy(')
		// Generated image and video completion both stamp the descriptor.
		expectSourceToContain(ts, 'descriptor: buildDescriptorFromGeneratedBy(generatedBy)')
		expectSourceToContain(ts, "source: 'generation',")
	})

	it('captions uploaded media from a still (never the MP4) with an analyzing → ready flow', () => {
		expectSourceToContain(ts, 'async function analyzeUploadedMedia(nodeId: string, stillFileId: string)')
		expectSourceToContain(ts, 'descriptor: buildAnalyzingDescriptor(),')
		// Uploaded video is captioned from the poster still, not the MP4.
		expectSourceToContain(ts, 'void analyzeUploadedMedia(videoNodeId, posterFileId)')
		expectSourceToContain(ts, 'void analyzeUploadedMedia(imageNodeId, materialized.fileId)')
	})

	it('shows an unobtrusive animated analyzing indicator with an explanation', () => {
		expectSourceToContain(ts, "node.descriptor?.status === 'analyzing'")
		const buttonBlock = extractBlock(scss, '.image-info-button')
		expectExcerptToContain(buttonBlock, '&.is-analyzing', '.image-info-button')
		expectSourceToContain(scss, '@keyframes workspace-media-analyzing-pulse')
		const descriptorBlock = extractBlock(scss, '.canvas-media-descriptor')
		expectExcerptToContain(descriptorBlock, '&.is-analyzing', '.canvas-media-descriptor')
	})
})

// =============================================================================
// Content descriptors (documents & threads)
// =============================================================================

describe('Workspace canvas — content descriptors (documents & threads)', () => {
	const ts = loadTs()

	it('summarizes a text node from its plain text (no pixels) with an analyzing → ready/failed flow', () => {
		expectSourceToContain(ts, 'async function analyzeTextNode(nodeId: string, text: string, title?: string)')
		expectSourceToContain(ts, 'patchTextNodeDescriptor(nodeId, buildAnalyzingDescriptor())')
		expectSourceToContain(ts, 'const result = await describeText({ workspaceId, text, title, aiModel })')
		// Same analysis source + version stamp as captioned media.
		expectSourceToContain(ts, "source: 'analysis',")
	})

	it('patches the descriptor only on document/thread nodes', () => {
		expectSourceToContain(ts, 'function patchTextNodeDescriptor(nodeId: string, descriptor: ContentDescriptor)')
		expectSourceToContain(ts, "node.type !== 'document' && node.type !== 'aiChatThread'")
	})

	it('debounces descriptor regeneration and skips too-thin content via settings (no magic numbers)', () => {
		expectSourceToContain(ts, 'function scheduleTextNodeDescriptor(nodeId: string, content: unknown, title?: string)')
		expectSourceToContain(ts, 'text.trim().length < settings.contentDescriptor.minTextLength')
		expectSourceToContain(ts, 'settings.contentDescriptor.editDebounceMs')
	})

	it('triggers a descriptor refresh on document and thread edits, and on node creation', () => {
		// Edit triggers: document editor + AI chat panel thread editor.
		expectSourceToContain(ts, 'scheduleTextNodeDescriptor(node.nodeId, value, doc.title)')
		expectSourceToContain(ts, 'if (rootNode) scheduleTextNodeDescriptor(rootNode.nodeId, value)')
		// Create trigger: a newly inserted document/thread node with existing content.
		expectSourceToContain(ts, 'scheduleTextNodeDescriptor(positionedNode.nodeId, doc.content, doc.title)')
		expectSourceToContain(ts, 'scheduleTextNodeDescriptor(positionedNode.nodeId, thread.content)')
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
		expectExcerptToContain(fnBody, 'aiChatThreadId: panelThreadId')
		expectExcerptToContain(fnBody, 'threadId: panelThreadId')
		expectExcerptToContain(fnBody, 'threadEditors.set(panelThreadId')
		expectExcerptToContain(fnBody, 'promptInputController.registerThreadEditor(panelThreadId')
		expectExcerptNotToContain(fnBody, 'threadId: activeAiChatThreadId!')
		expectExcerptNotToContain(fnBody, 'referenceId: activeAiChatThreadId!')
	})

	it('does not treat AI chat thread content load as a full canvas rerender signal', () => {
		const fnMatch = ts.match(/function\s+getAiChatThreadsKey[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'return threads.map(t => t.threadId).join')
		expectExcerptNotToContain(fnBody, 't.content')
	})

	it('refreshes only the active panel when deferred thread content arrives', () => {
		expectSourceToContain(ts, 'function refreshActiveAiChatPanelWhenContentLoads(): void')
		expectSourceToContain(ts, 'if (activeAiChatPanelHadContent) return')
		expectSourceToContain(ts, 'renderActiveAiChatPanel(undefined, thread)')
		expectSourceToContain(ts, 'refreshActiveAiChatPanelWhenContentLoads()')
		expectSourceToContain(ts, 'if (aiChatPanelState.isOpen && !activeAiChatPanelEl) renderActiveAiChatPanel()')
	})

	it('preserves local visual drag commits when active-panel renders arrive stale', () => {
		expectSourceToContain(ts, 'mergeIncomingCanvasStateWithPendingVisualCommit,')
		expectSourceToContain(ts, 'let pendingLocalCanvasVisualCommit: PendingCanvasVisualCommit | null = null')
		expectSourceToContain(ts, 'pendingLocalCanvasVisualCommit = createPendingCanvasVisualCommit(nextState)')
		expectSourceToContain(ts, 'const renderStatePlan = mergeIncomingCanvasStateWithPendingVisualCommit({')
		expectSourceToContain(ts, 'const effectiveCanvasState = renderStatePlan.state')
		expectSourceToContain(ts, 'currentCanvasState = shouldPreserveLiveViewport && effectiveCanvasState')
	})
})

// =============================================================================
// Workspace canvas — viewport ownership during store renders
// =============================================================================

describe('Workspace canvas — viewport ownership during store renders', () => {
	const ts = loadTs()
	const svelte = loadWorkspaceCanvasSvelte()

	it('routes viewport-only render decisions through the stale viewport planner', () => {
		expectSourceToContain(ts, 'shouldPreserveLiveViewportForViewportOnlyRender({')
		expectSourceToContain(ts, 'incomingViewport: effectiveCanvasState?.viewport,')
		expectSourceToContain(ts, 'liveViewport,')
		expectSourceToContain(ts, 'viewportChanged,')
		expectSourceToContain(ts, 'visualStateChanged,')
		expectSourceToContain(ts, 'needsRerender,')
		expectSourceToContain(ts, 'workspaceChanged,')
	})

	it('keeps viewport-only stale renders from applying a transform jump', () => {
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
		expectSourceToContain(svelte, 'viewport,')
		expectSourceToContain(svelte, 'workspaceStore.updateCanvasState(stateToPersist)')
		expectSourceToContain(svelte, 'canvasState: stateToPersist')
	})

	it('refuses to persist a debounced viewport after a newer viewport arrives', () => {
		expectSourceToContain(svelte, 'const scheduledViewport = newViewport')
		expectSourceToContain(svelte, 'viewport.x !== scheduledViewport.x')
		expectSourceToContain(svelte, 'viewport.y !== scheduledViewport.y')
		expectSourceToContain(svelte, 'viewport.zoom !== scheduledViewport.zoom')
		expectSourceToContain(svelte, 'viewport: scheduledViewport')
	})
})

// =============================================================================
// Workspace AI chat panel — session history interactions
// =============================================================================

describe('Workspace AI chat panel — session history interactions', () => {
	const ts = loadTs()
	const scss = loadScss()
	const svgIcons = loadSvgIcons()

	it('uses the circle icon as the new-chat control and binds a start-new-draft action', () => {
		expectSourceToContain(ts, 'xCircleIcon,')
		expectSourceNotToContain(ts, 'xCircleIcon as plusIcon')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-new-chat')
		expectSourceToContain(ts, 'aria-label="Start new chat"')
		expectSourceToContain(ts, 'innerHTML=${xCircleIcon}')
		expectSourceToContain(ts, 'const newChatEl = controlsEl.querySelector<HTMLButtonElement>(\'.workspace-ai-chat-panel-new-chat\')!')
		expectSourceToContain(ts, 'newChatEl.addEventListener(\'click\', () => startNewAiChatDraft())')
		expectSourceToContain(svgIcons, 'export const xCircleIcon')
	})

	it('styles the session control row and session entry details consistently', () => {
		const historyToggleBlock = extractBlockContainingSelector(scss, '.workspace-ai-chat-panel-history-toggle,\n.workspace-ai-chat-panel-new-chat')
		const newChatBlock = extractBlock(scss, '.workspace-ai-chat-panel-new-chat')
		const sessionBlock = extractBlock(scss, '.workspace-ai-chat-panel-session')
		const titleBlock = extractBlock(scss, '.workspace-ai-chat-panel-session-title')
		expectExcerptToContain(historyToggleBlock, 'display: grid', 'session controls block')
		expectExcerptToContain(historyToggleBlock, 'place-items: center', 'session controls block')
		expectExcerptToContain(newChatBlock, 'border-radius: 99px', 'new chat block')
		expectExcerptToContain(newChatBlock, 'background: transparent', 'new chat block')
		const sessionHoverBlock = extractBlock(scss, '.workspace-ai-chat-panel-session:focus-within')
		const historyToggleHoverBlock = extractBlock(scss, '.workspace-ai-chat-panel-history-toggle:focus-visible')
		const newChatHoverBlock = extractBlock(scss, '.workspace-ai-chat-panel-new-chat:focus-visible')
		expectExcerptToContain(historyToggleHoverBlock, 'background: var(--workspace-ai-chat-panel-session-history-toggle-hover-background, rgba(105, 115, 136, 0.1))', 'session history toggle focus block')
		expectExcerptToContain(historyToggleHoverBlock, 'outline: none', 'session history toggle focus block')
		expectExcerptToContain(newChatHoverBlock, 'color: var(--workspace-ai-chat-panel-session-action-hover-background, #{$steelBlue})', 'new chat focus block')
		expectExcerptToContain(newChatHoverBlock, 'outline: none', 'new chat focus block')
		expectExcerptToContain(sessionHoverBlock, 'background-image:', 'session focus block')
		expectExcerptToContain(sessionHoverBlock, '--workspace-ai-chat-panel-session-hover-background-image', 'session focus block')
		expectExcerptToContain(sessionHoverBlock, 'linear-gradient(135deg, #e8f2ff 0%, #eaf1ff 100%)', 'session focus block')
		expectSourceToContain(scss, 'max-height: 236px')
		expectExcerptToContain(sessionBlock, 'display: flex', 'session block')
		expectExcerptToContain(sessionBlock, 'min-height: 58px', 'session block')
		expectExcerptToContain(titleBlock, 'font-size: 13px', 'session title block')
		expectExcerptToContain(titleBlock, 'font-weight: 620', 'session title block')
	})

	it('starts a fresh standalone draft when last session tab is closed', () => {
		const closeBody = extractFunctionBody(ts, 'closeAiChatSidebarTab')
		const startNewBody = extractFunctionBody(ts, 'startNewAiChatDraft')
		const emptyBranchIndex = closeBody.indexOf('if (aiChatSidebarTabs.length === 0) {')
		const startFreshIndex = closeBody.indexOf('startNewAiChatDraft({ preserveOpenTabs: false, syncFromState: false })')
		const returnIndex = closeBody.indexOf('return', startFreshIndex)

		expect(emptyBranchIndex).toBeGreaterThan(-1)
		expect(startFreshIndex).toBeGreaterThan(emptyBranchIndex)
		expect(returnIndex).toBeGreaterThan(startFreshIndex)
		expectExcerptToContain(closeBody, 'startNewAiChatDraft({ preserveOpenTabs: false, syncFromState: false })', 'closeAiChatSidebarTab')
		expectExcerptToContain(closeBody, 'return', 'closeAiChatSidebarTab')
		expectExcerptToContain(startNewBody, 'const drafts = { ...(aiChatPanelState.drafts ?? {}) }', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'delete drafts[NEW_CHAT_DRAFT_KEY]', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'aiChatSidebarTabs = []', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'preserveOpenTabs = true', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'syncFromState = true', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'if (preserveOpenTabs && aiChatSidebarTabs.length > 0)', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'createAiChatDraftSidebarTab()', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'activeAiChatSidebarTabId = null', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'activeAiChatSidebarThreadId = null', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'activeAiChatThreadId = null', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'activeAiChatRootNodeId = null', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'contextChips: [],', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'promptInputController.setTarget(null)', 'startNewAiChatDraft')
		expectExcerptToContain(startNewBody, 'syncActiveAiChatPanelFromState()', 'startNewAiChatDraft')
	})

	it('turns a submitted draft tab into a thread tab and removes only that draft payload', () => {
		const replaceBody = extractFunctionBody(ts, 'replaceAiChatDraftSidebarTab')
		const submitBody = extractFunctionBody(ts, 'createStandaloneThreadAndSubmit')

		expectExcerptToContain(replaceBody, 'if (tab.tabId !== draftTabId) return tab', 'replaceAiChatDraftSidebarTab')
		expectExcerptToContain(replaceBody, 'replacedDraftTab = true', 'replaceAiChatDraftSidebarTab')
		expectExcerptToContain(replaceBody, 'return threadTab', 'replaceAiChatDraftSidebarTab')
		expectExcerptToContain(replaceBody, 'delete drafts[draftTabId]', 'replaceAiChatDraftSidebarTab')
		expectExcerptToContain(replaceBody, 'aiChatPanelState = { ...aiChatPanelState, drafts }', 'replaceAiChatDraftSidebarTab')
		expectExcerptToContain(submitBody, "const submittedDraftTabId = submittedTab?.type === 'draft' ? submittedTab.tabId : null", 'createStandaloneThreadAndSubmit')
		expectExcerptToContain(submitBody, 'replaceAiChatDraftSidebarTab(submittedDraftTabId, threadId)', 'createStandaloneThreadAndSubmit')
		expectExcerptToContain(submitBody, 'activeAiChatSidebarTabId = `thread:${threadId}`', 'createStandaloneThreadAndSubmit')
		expectSourceToContain(ts, 'buildAiPromptDraftAttrsFromSubmitData,')
		expectSourceToContain(ts, 'buildAiPromptDraftFromText,')
		expectExcerptToContain(submitBody, 'const submittedThreadDraftKey = `thread:${threadId}`', 'createStandaloneThreadAndSubmit')
		expectExcerptToContain(submitBody, "const submittedThreadDraft = buildAiPromptDraftFromText('', buildAiPromptDraftAttrsFromSubmitData(data))", 'createStandaloneThreadAndSubmit')
		expectExcerptToContain(submitBody, '[submittedThreadDraftKey]: { content: submittedThreadDraft }', 'createStandaloneThreadAndSubmit')
	})

	it('keeps thread sessions renderable with message count and status metadata', () => {
		expectSourceToContain(ts, 'function countProseMirrorNodesByType(value: unknown, nodeTypes: Set<string>): number')
		expectSourceToContain(ts, 'countAiChatSessionMessages(session.content)')
		expectSourceToContain(ts, '${getAiChatSessionMeta(session)}')
		expectSourceToContain(ts, 'pluralizeSessionCount(messageCount, \'message\')')
	})

	it('renders session history entries with thread/extraction markers and timestamps', () => {
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-marker-thread')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-marker-extraction')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-content')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-title')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-date')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-session-meta')
		expectSourceToContain(ts, 'formatSessionUpdatedAt(session.updatedAt)')
		expectSourceToContain(ts, 'formatSessionUpdatedAt(extractionState.updatedAt)')
		expectSourceToContain(ts, 'sessionEl.querySelector(\'.workspace-ai-chat-panel-session-open\')?.addEventListener(\'click\', () => {')
		expectSourceToContain(ts, 'activeAiChatSidebarTabId = `thread:${session.threadId}`')
		expectSourceToContain(ts, 'openFeatureExtractionTab(extractionState.extractionRunId)')
	})

	it('defines stable session metadata formatters for deterministic labels', () => {
		expectSourceToContain(ts, 'function formatSessionStatus(status: string): string')
		expectSourceToContain(ts, ".split(/[-_]/)")
		expectSourceToContain(ts, 'const minuteMs = 60_000')
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

	it('hides the in-editor composer (.ai-user-input-wrapper) inside workspace thread', () => {
		const block = extractBlock(scss, '.workspace-ai-chat-thread-node .ai-chat-thread-wrapper .ai-user-input-wrapper')
		expect(block).toMatch(/display:\s*none/)
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
// AI chat thread — auto-grow TypeScript infrastructure
// =============================================================================

describe('AI chat thread — auto-grow TS infrastructure', () => {
	const ts = loadTs()

	it('defines AI_CHAT_THREAD_MIN_HEIGHT constant', () => {
		expect(ts).toMatch(/const\s+AI_CHAT_THREAD_MIN_HEIGHT\s*=\s*\d+/)
	})

	it('defines autoGrowThreadNode function', () => {
		expect(ts).toMatch(/function\s+autoGrowThreadNode\s*\(\s*threadNodeId:\s*string\s*\)/)
	})

	it('defines scheduleThreadAutoGrow function', () => {
		expect(ts).toMatch(/function\s+scheduleThreadAutoGrow\s*\(\s*threadNodeId:\s*string\s*\)/)
	})

	it('autoGrowThreadNode is disabled because canvas node dimensions stay explicit', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'The canvas keeps thread node dimensions explicit')
		expect(fnBody).not.toMatch(/threadNodeEl\.style\.height\s*=\s*['"]auto['"]/)
		expectExcerptNotToContain(fnBody, 'threadNodeEl.offsetHeight')
	})

	it('scheduleThreadAutoGrow is disabled with autoGrowThreadNode', () => {
		const fnMatch = ts.match(/function\s+scheduleThreadAutoGrow[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'Disabled')
		expectExcerptNotToContain(fnBody, 'requestAnimationFrame')
	})

	it('updateThreadNodeVisibility still repositions thread companions when visibility changes', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'repositionAllThreadFloatingInputs')
	})

	it('updateThreadNodeVisibility schedules disabled auto-grow for compatibility', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'scheduleThreadAutoGrow(nodeId)')
	})

	it('renderNodes does not schedule parent growth during rendering', () => {
		const renderMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(renderMatch).not.toBeNull()
		const renderBody = renderMatch![0]
		expectExcerptNotToContain(renderBody, 'scheduleThreadAutoGrow')
	})

	it('destroy() cleans up autoGrowRaf and pendingAutoGrowThreadNodeIds', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		const destroyBody = destroyMatch![0]
		expectExcerptToContain(destroyBody, 'autoGrowRaf')
		expectExcerptToContain(destroyBody, 'pendingAutoGrowThreadNodeIds')
	})
})

// =============================================================================
// AI chat thread — empty thread hidden until messages appear
// =============================================================================

describe('AI chat thread — empty thread visibility', () => {
	const ts = loadTs()

	it('defines threadContentHasMessages helper', () => {
		expect(ts).toMatch(/function\s+threadContentHasMessages\s*\(\s*content:\s*any\s*\):\s*boolean/)
	})

	it('defines hiddenEmptyThreadNodeIds set', () => {
		expect(ts).toMatch(/const\s+hiddenEmptyThreadNodeIds:\s*Set<string>\s*=\s*new\s+Set/)
	})

	it('defines updateThreadNodeVisibility function', () => {
		expect(ts).toMatch(/function\s+updateThreadNodeVisibility\s*\(/)
	})

	it('updateThreadNodeVisibility checks for message wrapper elements', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'ai-user-message-wrapper')
		expectExcerptToContain(fnBody, 'ai-response-message-wrapper')
	})

	it('updateThreadNodeVisibility hides or shows thread nodes from message state', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'threadContentHasMessages')
		expectExcerptToContain(fnBody, 'hideThreadNode')
		expectExcerptToContain(fnBody, 'showThreadNode')
	})

	it('CSS hides thread nodes with data-thread-empty attribute', () => {
		const scss = loadScss()
		expectSourceToContain(scss, 'data-thread-empty')
		expect(scss).toMatch(/data-thread-empty[\s\S]*?visibility:\s*hidden/)
	})

	it('updateThreadNodeVisibility accepts contentJSON and falls back to message wrappers', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'contentJSON')
		expectExcerptToContain(fnBody, 'threadNodeEl.querySelector')
	})

	it('positionElementBelowNode accounts for hidden thread nodes', () => {
		const fnMatch = ts.match(/function\s+positionElementBelowNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'getThreadTopOffset')
	})

	it('renderNodes clears hiddenEmptyThreadNodeIds', () => {
		const renderMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(renderMatch).not.toBeNull()
		const renderBody = renderMatch![0]
		expectExcerptToContain(renderBody, 'hiddenEmptyThreadNodeIds.clear()')
	})

	it('destroy() clears hiddenEmptyThreadNodeIds', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		const destroyBody = destroyMatch![0]
		expectExcerptToContain(destroyBody, 'hiddenEmptyThreadNodeIds')
	})

	it('defines hideThreadNode helper that sets data-thread-empty attribute', () => {
		const fnMatch = ts.match(/function\s+hideThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, "threadEmpty")
		expectExcerptToContain(fnBody, "hiddenEmptyThreadNodeIds.add")
	})

	it('defines showThreadNode helper that removes data-thread-empty attribute', () => {
		const fnMatch = ts.match(/function\s+showThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, "threadEmpty")
		expectExcerptToContain(fnBody, "hiddenEmptyThreadNodeIds.delete")
	})

	it('defines getThreadTopOffset helper', () => {
		const fnMatch = ts.match(/function\s+getThreadTopOffset[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'hiddenEmptyThreadNodeIds')
	})

	it('updateThreadNodeVisibility uses hideThreadNode and showThreadNode', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'showThreadNode')
		expectExcerptToContain(fnBody, 'hideThreadNode')
	})

	it('hidden thread state collapses thread top offset', () => {
		const fnMatch = ts.match(/function\s+getThreadTopOffset[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'hiddenEmptyThreadNodeIds.has')
		expectExcerptToContain(fnBody, '? 0 : threadHeight + 16')
	})

	it('drag mousemove uses getThreadTopOffset for floating input positioning', () => {
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'getThreadTopOffset')
	})

	it('resize mousemove uses getThreadTopOffset for floating input positioning', () => {
		const fnMatch = ts.match(/function\s+handleResizeStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'getThreadTopOffset')
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
		const block = extractBlock(scss, '.document-resize-handle')

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

	it('does not create bottom resize handles for AI chat thread nodes', () => {
		const fnMatch = ts.match(/function\s+createBaseNodeElement[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		sourceFileNames.set(fnBody, 'createBaseNodeElement')

		expectSourceToContain(fnBody, "if (node.type === 'aiChatThread' && corner.startsWith('bottom')) continue")
		expectSourceToContain(fnBody, 'nodeEl.appendChild(createResizeHandle(node.nodeId, corner))')
	})
})

// =============================================================================
// AI chat thread sizing
// =============================================================================

describe('AI chat thread sizing', () => {
	const ts = loadTs()

	it('preserves manually resized empty thread dimensions', () => {
		const fnMatch = ts.match(/function\s+expandParentContainersToFitChildren[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, 'Empty parent containers keep their persisted size')
		expectExcerptToContain(fnBody, 'node.dimensions.width <= 0 || node.dimensions.height <= 0')
		expectExcerptNotToContain(fnBody, 'node.dimensions.width !== 300 || node.dimensions.height !== 200')
	})

	it('does not shrink manually enlarged threads when children are dragged with them', () => {
		const fnMatch = ts.match(/function\s+expandParentContainersToFitChildren[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, 'Dropping a small image into a manually enlarged')
		expectExcerptToContain(fnBody, 'let width = Math.max(200, node.dimensions.width)')
		expectExcerptToContain(fnBody, 'let height = Math.max(120, node.dimensions.height)')
		expectExcerptNotToContain(fnBody, 'let width = 200')
		expectExcerptNotToContain(fnBody, 'let height = 120')
	})
})

// =============================================================================
// Vertical rail — CSS styling
// =============================================================================

describe('Vertical rail — CSS styling', () => {
	const scss = loadScss()

	it('defines .workspace-thread-rail with absolute positioning', () => {
		const block = extractBlock(scss, '.workspace-thread-rail')
		expect(block).toMatch(/position:\s*absolute/)
	})

	it('sets cursor: move on rail', () => {
		const block = extractBlock(scss, '.workspace-thread-rail')
		expect(block).toMatch(/cursor:\s*move/)
	})

	it('has line child with ::before pseudo-element for the visible line', () => {
		expect(scss).toMatch(/\.workspace-thread-rail-line\s*\{/)
		expect(scss).toMatch(/&::before/)
		expect(scss).toMatch(/--rail-width/)
		expect(scss).toMatch(/--rail-gradient/)
		expect(scss).toMatch(/--rail-thread-height/)
	})

	it('has no .is-selected visual change on line::before (rail always looks the same)', () => {
		expect(scss).not.toMatch(/\.is-selected\s+\.workspace-thread-rail-line::before/)
	})

	it('defines boundary-circle positioned at bottom of line', () => {
		expect(scss).toMatch(/\.workspace-thread-rail-boundary-circle\s*\{/)
		expect(scss).toMatch(/bottom:\s*-6px/)
	})
})

// =============================================================================
// Vertical rail — TypeScript infrastructure
// =============================================================================

describe('Vertical rail — TS infrastructure', () => {
	const ts = loadTs()

	it('defines RAIL_OFFSET from settings', () => {
		expect(ts).toMatch(/const\s+RAIL_OFFSET\s*=\s*settings\.aiChatThread\.rail\.offset/)
	})

	it('defines RAIL_GRAB_WIDTH from settings', () => {
		expect(ts).toMatch(/const\s+RAIL_GRAB_WIDTH\s*=\s*settings\.aiChatThread\.rail\.dragGrabWidth/)
	})

	it('defines threadRails Map', () => {
		expect(ts).toMatch(/const\s+threadRails:\s*Map<string,\s*HTMLElement>/)
	})

	it('defines active AI chat panel resize width state', () => {
		expectSourceToContain(ts, 'const AI_CHAT_PANEL_MIN_WIDTH = 320')
		expectSourceToContain(ts, 'let activeAiChatPanelWidth: number | null = null')
		expectSourceToContain(ts, "style.setProperty('--workspace-ai-chat-sidebar-width', widthValue)")
	})

	it('defines createThreadRail function', () => {
		expectSourceToContain(ts, 'function createThreadRail(')
	})

	it('defines repositionThreadRail function', () => {
		expectSourceToContain(ts, 'function repositionThreadRail(')
	})

	it('defines destroyAllThreadRails function', () => {
		expectSourceToContain(ts, 'function destroyAllThreadRails(')
	})

	it('repositionAllThreadFloatingInputs also repositions rails', () => {
		const fnMatch = ts.match(/function\s+repositionAllThreadFloatingInputs[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'repositionThreadRail(')
	})

	it('drag mousemove handler repositions the rail', () => {
		expectSourceToContain(ts, 'dragRail')
		expectSourceToContain(ts, 'applyStyle(dragRail, { left:')
	})

	it('resize mousemove handler repositions the rail', () => {
		expectSourceToContain(ts, 'resizeRail')
		expectSourceToContain(ts, 'applyStyle(resizeRail, { left:')
		expectSourceToContain(ts, 'height: `${totalH}px`')
	})

	it('updateNodeSelectionClasses toggles is-selected on the rail', () => {
		const fnMatch = ts.match(/function\s+updateNodeSelectionClasses[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, "threadRails.get(nodeId)?.classList.add('is-selected')")
		expectExcerptToContain(fnBody, "threadRails.get(nodeId)?.classList.remove('is-selected')")
	})

	it('renderNodes calls destroyAllThreadRails', () => {
		const fnMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'destroyAllThreadRails()')
	})

	it('destroy() calls destroyAllThreadRails', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		expectExcerptToContain(destroyMatch![0], 'destroyAllThreadRails()')
	})

	it('passes railOffset to WorkspaceConnectionManager', () => {
		expect(ts).toMatch(/railOffset:\s*RAIL_OFFSET/)
	})

	it('createThreadRail creates line child element', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'workspace-thread-rail-line')
	})

	it('createThreadRail sets z-index above all nodes to prevent overlap', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], "zIndex: '9990'")
	})

	it('createThreadRail appends boundary circle to line', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'workspace-thread-rail-boundary-circle')
		expectExcerptToContain(fnMatch![0], 'aiChatThreadRailBoundaryCircle')
	})

	it('createThreadRail applies configured colors to boundary circle SVG paths', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'settings.aiChatThread.rail.styles.boundaryCircleColors')
		expectExcerptToContain(fnBody, "setAttribute('fill'")
	})

	it('repositionThreadRail sets --rail-thread-height CSS var', () => {
		const fnMatch = ts.match(/function\s+repositionThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], '--rail-thread-height')
	})

	it('repositionThreadRail hides boundary circle when thread is hidden', () => {
		const fnMatch = ts.match(/function\s+repositionThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expectExcerptToContain(fnBody, 'workspace-thread-rail-boundary-circle')
		expectExcerptToContain(fnBody, "isHidden ? 'none' : ''")
	})

	it('resize handler updates --rail-thread-height CSS var', () => {
		expect(ts).toMatch(/resizeRail\.style\.setProperty\('--rail-thread-height'/)
	})

	it('repositionThreadRail calls connectionManager.setRailHeight', () => {
		const fnMatch = ts.match(/function\s+repositionThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'connectionManager?.setRailHeight(')
	})

	it('destroyAllThreadRails calls connectionManager.clearRailHeights', () => {
		const fnMatch = ts.match(/function\s+destroyAllThreadRails[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expectExcerptToContain(fnMatch![0], 'connectionManager?.clearRailHeights()')
	})

	it('updateSelectionDrivenUi never shows the detached floating input under any node', () => {
		const fnMatch = ts.match(/function\s+updateSelectionDrivenUi[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		// The deprecated detached prompt-input-below-node must never render for any
		// node type (documents, threads, images, video).
		expectExcerptNotToContain(fnBody, 'showFloatingInput')
		expectExcerptToContain(fnBody, 'hideFloatingInput')
		expectExcerptNotToContain(fnBody, 'promptInputController.setTarget')
	})

	it('bubble menu callbacks include onAskAi', () => {
		expectSourceToContain(ts, 'onAskAi')
	})

	it('onAskAi opens a persisted extraction session without creating a context region', () => {
		expect(ts).toMatch(/onAskAi.*async|async.*onAskAi/)
		expectSourceToContain(ts, 'persistFeatureExtractionState({')
		expectSourceToContain(ts, 'openFeatureExtractionTab(extractionRunId)')
	})

	it('rehydrates pending extraction context from the persisted snapshot when reopening a tab', () => {
		expectSourceToContain(ts, 'if (extractionState?.sourceContextSnapshot && !getPendingExtractionContext(activeSidebarTab.refId)) {')
		expectSourceToContain(ts, 'setPendingExtractionContext(activeSidebarTab.refId, extractionState.sourceContextSnapshot as any)')
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
		const end = ts.indexOf('function createFloatingInput', start)
		expect(end).toBeGreaterThan(start)
		const fnBody = ts.slice(start, end)

		expectExcerptToContain(fnBody, 'workspace-ai-chat-floating-panel workspace-ai-chat-thread-node')
		expectExcerptToContain(fnBody, 'new ProseMirrorEditor')
		expectExcerptToContain(fnBody, 'workspace-thread-rail workspace-ai-chat-floating-panel-rail')
		expectExcerptToContain(fnBody, 'const backdropEl = html`<div className="workspace-ai-chat-panel-backdrop"')
		expectExcerptToContain(fnBody, 'paneEl.appendChild(backdropEl)')
		expectExcerptToContain(fnBody, 'handleActiveAiChatPanelResizeStart')
		expectExcerptToContain(fnBody, 'aiChatThreadRailBoundaryCircle')
		expectSourceToContain(ts, 'function createFloatingInput(): void')
		expectSourceToContain(ts, 'const promptEl = html`<div className="ai-prompt-input-floating workspace-ai-chat-floating-panel-prompt nopan"></div>`')
		expectSourceToContain(ts, 'applyAiPromptInputStyleSettings(promptEl)')
		expectSourceNotToContain(ts, `AiChat${'Panel.svelte'}`)
	})

	it('keeps AI prompt input style values in one helper', () => {
		const fnMatch = ts.match(/function\s+applyAiPromptInputStyleSettings[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expectExcerptToContain(fnBody, "promptEl.style.setProperty('--dropdown-popover-box-shadow', settings.dropdown.styles.popoverBoxShadow)")
		expect(fnBody).not.toMatch(/open-prompt-z-index/)
	})

	it('opens the panel without requiring an existing thread and creates standalone history on submit', () => {
		expectSourceToContain(ts, 'function openAiChatPanel(): void')
		expectSourceToContain(ts, 'aiChatPanelState = { ...aiChatPanelState, isOpen: true }')
		expectSourceToContain(ts, 'async function createStandaloneThreadAndSubmit(data: any): Promise<void>')
		expectSourceToContain(ts, "owner: { type: 'standalone' }")
		expectSourceToContain(ts, 'if (!panelThreadId) {')
		expectSourceToContain(ts, 'void loadExtractionSessionHistory()')
		expectSourceToContain(ts, 'extractionSessionHistoryLoaded = false')
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
		expectSourceToContain(ts, 'function destroyContextPreviewTooltips(): void')
		expectSourceToContain(ts, 'activeContextPreviewTooltips.clear()')
		expectSourceToContain(ts, 'function addContextChips(nodeIds: Iterable<string>): void')
		expectSourceToContain(ts, 'function removeContextChip(nodeId: string): void')
		expectSourceToContain(ts, 'function clearExplicitContextChips(): void')
		expectSourceToContain(ts, 'function createAiChatPanelContextTrayElement(): HTMLDivElement')
		expectSourceToContain(ts, 'removeContextChip(nodeId)')
		expectSourceToContain(ts, 'activeContextPreviewTooltips.add(previewTooltip)')
		// Submitting a standalone chat force-includes the explicit chips.
		expectSourceToContain(ts, 'const chipNodeIds = aiChatPanelState.contextChips')
		expectSourceToContain(ts, 'extractSelectedContext({ nodeIds: chipNodeIds, includeUpstream: false })')
		// The session-history toggle is retained.
		expectSourceToContain(ts, 'aiChatPanelToggleHistoryIcon')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-control')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-toggle')
		expectSourceToContain(ts, 'const isSessionHistoryOpen = !aiChatPanelState.isSessionHistoryOpen')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-sessions-hidden')
		expectSourceToContain(scss, '--workspace-ai-chat-panel-content-inset')
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
		expectSourceToContain(ts, 'renderActiveAiChatPanel(undefined, undefined, { preserveTabsSwitch: true })')
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
		expectSourceToContain(ts, 'function destroyContextPreviewTooltips(): void')
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
		expectSourceToContain(ts, 'const AI_CHAT_PANEL_CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES = [')
		expectSourceToContain(ts, '\'--workspace-ai-chat-panel-context-preview-tooltip-background\'')
		expectSourceToContain(ts, '\'--workspace-ai-chat-panel-context-preview-tooltip-box-shadow\'')
		expectSourceToContain(ts, '\'--workspace-ai-chat-panel-context-preview-border-radius\'')
		expectSourceToContain(ts, '\'--workspace-ai-chat-panel-context-preview-video-glyph-background\'')
		expectSourceToContain(ts, '\'--workspace-ai-chat-panel-context-preview-document-icon-color\'')
		expectSourceToContain(ts, '\'--workspace-ai-chat-panel-context-preview-popover-text-color\'')
		expectSourceToContain(ts, 'contentCssVariableNames: AI_CHAT_PANEL_CONTEXT_PREVIEW_CONTENT_CSS_VARIABLES')
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
		expectSourceToContain(ts, 'function rememberStandaloneGeneratedImagePlacement(')
		expectSourceToContain(ts, 'const referenceNodeIds = getStandaloneGeneratedMediaReferenceNodeIds()')
		expectSourceToContain(ts, '...aiChatPanelState.contextChips,')
		expectSourceToContain(ts, '...Array.from(selectedNodeIds),')
		expectSourceToContain(ts, 'const placementAnchorNodeId = referenceNodeIds[0] ?? activeTargetNodeId ?? candidateNodeIds[0]')
		expectSourceToContain(ts, '...(placementAnchorNodeId ? { placementAnchorNodeId } : {}),')
		expectSourceToContain(ts, 'referenceNodeIds: candidateNodeIds,')
		expectSourceToContain(ts, ': rememberStandaloneGeneratedImagePlacement(panelThreadId, messages, hasMediaModel)')
		expectSourceToContain(ts, 'const placementNode = getGeneratedMediaPlacementNode(threadId, generationRun)')
		expectSourceToContain(ts, 'const edgeSourceNode = getGeneratedMediaEdgeSourceNode(threadId, generationRun) ?? branchOriginNode')
		expectSourceToContain(ts, 'partialImageTracker.set(runKey, { nodeId, fileId: fileId || \'\', placementKey, ...(edgeSourceNode ? { sourceNodeId: edgeSourceNode.nodeId } : {}) })')
		expectSourceToContain(ts, 'updatePendingGeneratedImageReferencesFromWorkspaceContext(threadId, resolution, generationRun)')
		expectSourceToContain(ts, 'placementAnchorNodeId: placement.placementAnchorNodeId ?? referenceNodeIds[0]')
		expectSourceToContain(ts, 'branchId: resolution.branchId ?? placement.branchId')
		expectSourceToContain(ts, 'imageBranchResolution: resolution')
		expectSourceToContain(ts, 'const referenceNodeIds = getExistingMediaNodeIds([')
		expectSourceToContain(ts, 'const referenceNodeIds = getExistingMediaNodeIds(resolution.referenceImageNodeIds)')
		expectSourceToContain(ts, 'operationKind: resolution.operationKind')
		expectSourceToContain(ts, 'referenceImageNodeIds: resolution.referenceImageNodeIds')
		expectSourceToContain(ts, 'const referenceNodeIds = getExistingMediaNodeIds([')
		expectSourceToContain(ts, 'setGeneratingReferenceNodeIds(getGeneratedMediaPlacementKey(threadId, generationRun), referenceNodeIds)')
		expectSourceToContain(ts, 'function getReferenceGroupRectForGeneratedMedia(threadId: string, generationRun?: MediaGenerationRunMeta): Rect | undefined')
		expectSourceToContain(ts, 'function getReferenceGroupGeneratedMediaPosition(threadId: string, mediaHeight: number, generationRun?: MediaGenerationRunMeta): { x: number; y: number } | undefined')
		expectSourceToContain(ts, 'settings.imageBranchLineage.rootOutputGap')
		expectSourceToContain(ts, 'const position = getGeneratedMediaInsertionPosition(threadId, imageHeight, generationRun)')
		expectSourceNotToContain(ts, 'if (!sourceThread) return\n            const sourceNode = getGeneratedImageSourceNode(threadId, sourceThread)')
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
		expectSourceToContain(aiChatThreadPlugin, 'callbacks.onWorkspaceContextResolvedToCanvas?.({')
		expectSourceToContain(aiGeneratedImageNode, 'onWorkspaceContextResolvedToCanvas?: (data: {')
		expectSourceToContain(aiGeneratedImageNode, 'onImageErrorToCanvas?: (data: {')
		expectSourceToContain(aiGeneratedImageNode, 'resolution: WorkspaceContextResolution')
	})

	it('keeps submitted-session drafts until deletion and removes unsent draft payloads when draft tabs close', () => {
		const closeStart = ts.indexOf('function closeAiChatSidebarTab')
		const removeDraftStart = ts.indexOf('function removeAiChatPanelDraft', closeStart)
		const deleteChatStart = ts.indexOf('async function deleteAiChatSession', removeDraftStart)
		const deleteExtractionStart = ts.indexOf('async function deleteExtractionSession', deleteChatStart)
		const closeBody = ts.slice(closeStart, removeDraftStart)
		const deleteChatBody = ts.slice(deleteChatStart, deleteExtractionStart)
		const deleteExtractionBody = ts.slice(deleteExtractionStart, ts.indexOf('async function loadExtractionSessionHistory', deleteExtractionStart))

		expectExcerptToContain(closeBody, "if (closedTab?.type === 'draft')", 'close-tab handler')
		expectExcerptToContain(closeBody, 'delete drafts[closedTab.tabId]', 'close-tab handler')
		expectExcerptNotToContain(closeBody, 'removeAiChatPanelDraft', 'close-tab handler')
		expectExcerptToContain(deleteChatBody, 'removeAiChatPanelDraft(`thread:${threadId}`)', 'delete-chat handler')
		expectExcerptToContain(deleteExtractionBody, 'removeAiChatPanelDraft(`extraction:${extractionRunId}`)', 'delete-extraction handler')
	})

	it('uses the floating panel rail as the horizontal resize handle', () => {
		const scss = loadScss()

		expectSourceToContain(ts, 'function handleActiveAiChatPanelResizeStart(')
		expectSourceToContain(ts, "applyStyle(document.body, { cursor: 'ew-resize', userSelect: 'none' })")
		expectSourceToContain(scss, '.workspace-thread-rail.workspace-ai-chat-floating-panel-rail')
		expectSourceToContain(scss, 'cursor: ew-resize')
	})

	it('uses a full-height right-edge chat panel with zoom and avatar offsets', () => {
		const scss = loadScss()
		const svelte = loadWorkspaceCanvasSvelte()
		const layout = loadLayout()
		const sidebar = loadSidebar()

		expectSourceToContain(scss, '--workspace-ai-chat-sidebar-width')
		expectSourceToContain(scss, '--workspace-ai-chat-sidebar-edge-gap: 15px')
		expectSourceToContain(scss, '.workspace-ai-chat-panel-backdrop')
		expectSourceToContain(scss, 'z-index: 90')
		expectSourceToContain(scss, 'width: var(--workspace-ai-chat-sidebar-width)')
		expectSourceToContain(scss, 'backdrop-filter: blur(24px) saturate(145%)')
		expectSourceToContain(scss, '-webkit-backdrop-filter: blur(24px) saturate(145%)')
		expectSourceToContain(scss, 'mask-image: linear-gradient')
		expectSourceToContain(scss, '@media (prefers-reduced-transparency: reduce)')
		expectSourceToContain(svelte, 'class:workspace-canvas-chat-panel-open')
		expectSourceToContain(svelte, 'workspace-media-library-launcher')
		expectSourceToContain(svelte, 'workspace-ai-chat-launcher')
		expectSourceToContain(svelte, 'aiChatIcon')
		expectSourceToContain(svelte, 'aiChatPanelCollapseIcon')
		expectSourceToContain(svelte, "aria-label={isAiChatPanelOpen ? 'Collapse AI Chat' : 'Open AI Chat'}")
		expectSourceNotToContain(svelte, 'workspace-ai-chat-launcher-tooltip')
		expectSourceToContain(svelte, 'workspace-zoom-indicator')
		expectSourceNotToContain(svelte, 'workspace-canvas-utility-capsule')
		expectSourceToContain(scss, '.workspace-canvas-chat-panel-open .workspace-media-library-launcher')
		expectSourceToContain(scss, '.workspace-canvas-chat-panel-open .workspace-ai-chat-launcher')
		expectSourceToContain(scss, 'top: 15px')
		expectSourceToContain(scss, 'right: calc(var(--workspace-ai-chat-sidebar-width) + var(--workspace-ai-chat-sidebar-edge-gap) + 5px)')
		expectSourceToContain(scss, 'right: calc(var(--workspace-ai-chat-sidebar-width) + var(--workspace-ai-chat-sidebar-edge-gap) + var(--workspace-ai-chat-sidebar-zoom-gap) + 3px)')
		expectSourceToContain(scss, 'right: calc(0px - var(--workspace-canvas-padding-inline))')
		expectSourceToContain(scss, 'bottom: calc(var(--workspace-ai-chat-sidebar-edge-gap) - var(--workspace-canvas-padding-bottom))')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'top: 0px', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'border-radius: 10px', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'background: transparent', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel-prompt'), 'width: calc(', 'chat composer')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel-prompt'), 'margin-top: 12px', 'chat composer')
		expectSourceToContain(layout, 'workspace-sidebar-shell')
		expectSourceToContain(layout, 'workspace-sidebar-body')
		expectSourceToContain(layout, 'workspace-sidebar-footer')
		expectSourceToContain(layout, '<Separator />')
		expectSourceToContain(layout, 'sidebar-user-menu')
		expectSourceNotToContain(layout, 'user-menu-workspace-chat-panel')
		expectSourceToContain(sidebar, 'height: auto !important')
		expectSourceToContain(sidebar, 'flex: 1 1 auto')
		expectSourceToContain(sidebar, 'max-height: none !important')
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
		expectSourceToContain(ts, 'hideFloatingInput()')
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
			expectSourceNotToContain(ts, 'function getEdgesForConnectionManager')
			expectSourceNotToContain(ts, 'syncEdges(getEdgesForConnectionManager')
			expectSourceNotToContain(ts, ['selectedContext', 'RegionNodeIds'].join(''))
		expectSourceToContain(ts, 'connectionManager?.syncEdges(nextState.edges)')
		expectSourceToContain(ts, 'connectionManager.syncEdges(currentCanvasState.edges)')
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
			expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-default-box-shadow', imageNodeStyles.defaultBoxShadow)")
			expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-selected-box-shadow', imageNodeStyles.selectedBoxShadow)")
			expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-border-radius', `${imageNodeStyles.borderRadius}px`)")
			expectSourceNotToContain(ts, "paneEl.style.setProperty('--workspace-image-model-badge-box-shadow', imageNodeStyles.modelBadgeBoxShadow)")
			expect(scss).toMatch(/border-radius:\s*var\(--workspace-image-border-radius\)/)
	})

	it('wires resize handles through configured bounded zoom scaling', () => {
		expectSourceToContain(ts, 'const resizeHandleSettings = settings.imageNode.resizeHandle')
		expectSourceToContain(ts, 'baseSize: resizeHandleSettings.size,')
		expectSourceToContain(ts, 'baseOffset: resizeHandleSettings.offset,')
		expectSourceToContain(ts, 'minSize: resizeHandleSettings.minSize,')
		expectSourceToContain(ts, 'zoomScaling: resizeHandleSettings.zoomScaling,')
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

	it('treats AI chat thread floating input as part of the same selected composite', () => {
		expectSourceToContain(ts, 'function getSelectionBoundsForNode(node: CanvasNode): Rect')
		expectSourceToContain(ts, 'const threadFloatingInput = threadFloatingInputs.get(node.nodeId)')
		expectSourceToContain(ts, 'const inputTop = position.y + getThreadTopOffset(node.nodeId, dimensions.height)')
		expectSourceToContain(ts, 'const inputWidth = threadFloatingInput.el.offsetWidth || dimensions.width')
		expectSourceToContain(ts, 'const inputHeight = threadFloatingInput.el.offsetHeight')
		expectSourceToContain(ts, 'rectsOverlap(rect, getSelectionBoundsForNode(node))')
		expectSourceToContain(ts, "threadFloatingInputs.get(nodeId)?.el.classList.add('is-selected')")
		expectSourceToContain(ts, "threadFloatingInputs.get(nodeId)?.el.classList.remove('is-selected')")
		expect(scss).toMatch(/\.ai-prompt-input-thread-persistent\s*\{[\s\S]*?&\.is-selected/)
	})

	it('uses only floating input bounds for hidden empty threads in selection hit-testing', () => {
		const fnMatch = ts.match(/function\s+getSelectionBoundsForNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Hidden empty threads must use only the floating input bounds,
		// not the invisible thread node dimensions, to prevent phantom
		// selection over areas the user cannot see
		expectExcerptToContain(fnBody, 'const isHidden = hiddenEmptyThreadNodeIds.has(node.nodeId)')
		expectExcerptToContain(fnBody, 'if (isHidden) {')
		expectExcerptToContain(fnBody, 'right = position.x + inputWidth')
		expectExcerptToContain(fnBody, 'bottom = inputTop + inputHeight')

		// Visible threads still use Math.max to combine both bounds
		expectExcerptToContain(fnBody, 'right = Math.max(right, position.x + inputWidth)')
		expectExcerptToContain(fnBody, 'bottom = Math.max(bottom, inputTop + inputHeight)')
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
	const collisionTs = readSourceFile('../utils/resolveCollisions.ts', 'utils/resolveCollisions.ts')

	it('keeps toolbar insertion collision logic out of the Svelte wrapper', () => {
		expectSourceToContain(svelte, 'renderer?.insertNodeAtViewportCenter(documentNode)')
		expectSourceToContain(svelte, 'renderer?.insertNodeAtViewportCenter(imageNode)')
		expectSourceNotToContain(svelte, ['context', 'RegionNode'].join(''))
		expectSourceNotToContain(svelte, "from '$src/infographics/utils/resolveCollisions.ts'")
		expectSourceNotToContain(svelte, 'resolveInsertionCollisions')
		expectSourceNotToContain(svelte, 'computeViewportCenterInsertionPosition')
		expectSourceNotToContain(svelte, ['context', 'RegionCl', 'oudsIntersect'].join(''))
		expectSourceNotToContain(svelte, ['rectIntersectsContext', 'RegionCl', 'oud'].join(''))
	})

	it('routes toolbar insertion through the workspace renderer collision path', () => {
		expectSourceToContain(ts, 'insertNodeAtViewportCenter(node: WorkspaceCanvasNodeInsertion, statePatch: WorkspaceCanvasInsertionStatePatch = {})')
		expectSourceToContain(ts, 'position: getCenteredInsertionPosition(node.dimensions),')
		expectSourceToContain(ts, 'nodes: resolveTopLevelNodeCollisions([...baseCanvasState.nodes, positionedNode]),')
		expectSourceToContain(ts, 'onCanvasStateChange?.(newCanvasState)')
		expectSourceNotToContain(ts, 'screenDimensionsToWorldDimensions(node.dimensions')
	})

	it('uses the image-node theme width for toolbar image insertion sizing', () => {
		expectSourceToContain(svelte, 'const width = settings.imageNode.defaultInsertionWidth')
		expectSourceToContain(svelte, 'const dimensions = getImageInsertionDimensions(aspectRatio)')
		expectSourceToContain(svelte, 'const dimensions = getImageInsertionDimensions(1)')
		expectSourceNotToContain(svelte, 'const maxWidth = 400')
		expectSourceNotToContain(svelte, 'FALLBACK_IMAGE_DIMENSIONS')
	})

	it('builds rectangular collision boxes from node world bounds', () => {
		expectSourceToContain(ts, 'function createCollisionPlan(nodes: CanvasNode[], topLevelOnly = false): CollisionPlan')
		expectSourceToContain(ts, 'const worldPosition = getNodeWorldPosition(node, nodesById)')
		expectSourceToContain(ts, 'x: worldPosition.x,')
		expectSourceToContain(ts, 'width: node.dimensions.width,')
		expectSourceNotToContain(ts, ['getContext', 'Region', 'Cl', 'oudBounds'].join(''))
	})

	it('uses plain rectangle overlap filtering for collision pairs', () => {
		expectSourceToContain(ts, 'const shouldResolvePair = (): boolean => true')
		expectSourceNotToContain(ts, ['context', 'RegionCl', 'oudGeometry'].join(''))
	})

	it('uses the shared generic resolver rather than a workspace-specific duplicate', () => {
		expectSourceToContain(collisionTs, 'export function resolveCollisions(')
		expectSourceToContain(collisionTs, 'shouldResolvePair?: (a: NodeBox, b: NodeBox) => boolean')
		expectSourceToContain(ts, "import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'")
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

	it('PIXI uses canonical workspaceId path for stored API images', () => {
		expectSourceToContain(pixiLogicTs, '`/api/images/${workspaceId}/${node.fileId}`')
		expectSourceToContain(pixiLogicTs, 'isStoredImageSrc(strippedSrc)')
	})

	it('PIXI strips stale tokens from node sources before resolving them', () => {
		expect(pixiLogicTs).toMatch(/node\.src\.replace\([^)]*token[^)]*\)/)
	})

	it('PIXI passes through data and external sources without DOM loading', () => {
		expectSourceToContain(pixiLogicTs, "if (imageUrl.startsWith('data:')) return imageUrl")
		expectSourceToContain(pixiLayerTs, 'const resolvedSrc = resolveStoredImagePath(node, workspaceId)')
	})

	it('workspaceId is declared as let (mutable) so render() can update it', () => {
		expect(ts).toMatch(/let\s+workspaceId\s*=\s*options\.workspaceId/)
	})

	it('render() accepts optional newWorkspaceId parameter and updates workspaceId', () => {
		expect(ts).toMatch(/render\(.*newWorkspaceId\?: string/)
		expectSourceToContain(ts, 'if (newWorkspaceId) workspaceId = newWorkspaceId')
	})
})

// =============================================================================
// Image generation error cleanup
// =============================================================================

describe('Image generation error cleanup', () => {
	const ts = loadTs()

	function getImageErrorHandler(): string {
		const start = ts.indexOf('onImageErrorToCanvas: ({ threadId, generationRun }) => {')
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

	it('removes the failed partial image node from state and DOM immediately', () => {
		const handler = getImageErrorHandler()

		expectExcerptToContain(handler, 'partialImageTracker.delete(runKey)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'selectedNodeIds.delete(existing.nodeId)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'const remainingNodes = currentCanvasState.nodes.filter', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'const remainingEdges = currentCanvasState.edges.filter', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'resolveGeneratedMediaTreeState(remainingNodes, remainingEdges)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'commitCanvasStatePreservingEditors(nextState)', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'nodeEl?.remove()', 'onImageErrorToCanvas')
		expectExcerptToContain(handler, 'finishGeneratedMediaRun(threadId, generationRun)', 'onImageErrorToCanvas')
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

	it('returns transparent pixel for empty imageUrl', () => {
		expect(ts).toMatch(/if\s*\(\s*!imageUrl\s*\)\s*return\s*['"]data:image\/png;base64,/)
	})

	it('returns data: URLs unchanged', () => {
		expect(ts).toMatch(/if\s*\(\s*imageUrl\.startsWith\(\s*['"]data:['"]\s*\)\s*\)\s*return\s+imageUrl/)
	})

	it('prepends apiBaseUrl for /api/ paths', () => {
		expect(ts).toMatch(/if\s*\(\s*imageUrl\.startsWith\(\s*['"]\/api\/['"]\s*\)/)
		expectSourceToContain(ts, '`${apiBaseUrl}${imageUrl}')
	})

	it('appends token as query param for API URLs', () => {
		expectSourceToContain(ts, '`?token=${token}`')
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
		expectSourceToContain(ts, 'videoGenerationTracker')
		expectSourceToContain(ts, 'createVideoNodeHandler')
		expectSourceToContain(ts, 'createCanvasVideoLifecycleTracker')
		expectSourceToContain(ts, "type: 'video'")
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
		expectSourceToContain(ts, 'function syncPixiGeneratingImageNodes()')
		expectSourceToContain(ts, 'for (const partial of partialImageTracker.values())')
		expectSourceToContain(ts, 'for (const pending of videoGenerationTracker.values())')
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

	it('wires the bubble menu for video nodes (Replace + Download + Extend + Connect + Delete)', () => {
		// Video nodes share Replace, Download, Add to Media Library, and Connect
		// with images, while keeping dedicated Extend and Delete entries.
		const bubbleMenuTs = readSourceFile('canvasBubbleMenuItems.ts')
		expectSourceToContain(ts, "import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT")
		expectSourceToContain(ts, "node.type !== 'image' && node.type !== 'video'")
		expectSourceToContain(ts, "node.type === 'video' ? CANVAS_VIDEO_CONTEXT : CANVAS_IMAGE_CONTEXT")
		expectSourceToContain(ts, 'onDownloadMedia: (nodeId) => {')
		expectSourceToContain(ts, 'onReplaceMedia: (nodeId) => {')
		expectSourceToContain(ts, 'onExtendVideoInNewThread: async (nodeId) => {')
		expectSourceToContain(bubbleMenuTs, "export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'")
		expectSourceToContain(bubbleMenuTs, "title: 'Replace media'")
		expectSourceToContain(bubbleMenuTs, "title: 'Download media'")
		expectSourceToContain(bubbleMenuTs, "title: 'Extend video in new thread'")
		expectSourceToContain(bubbleMenuTs, "title: 'Delete video'")
		expectSourceToContain(bubbleMenuTs, 'context: [CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT]')
	})

	it('resolves sourceVideoNodeId to a workspace Object Store URI at submit time', () => {
		// Phase 6: the chat plugin forwards `sourceVideoNodeId` only via thread
		// attrs; WorkspaceCanvas converts it to a `nats-obj://` URI just before
		// publishing to NATS. VEO's precedence is extension > first-frame >
		// references > text-only.
		expectSourceToContain(ts, 'let videoSourceForExtension: string | undefined')
		expectSourceToContain(ts, "videoOptions?.sourceVideoNodeId")
		expectSourceToContain(ts, "`nats-obj://workspace-${workspaceId}-files/${sourceVideoNode.fileId}`")
		expectSourceToContain(ts, 'videoSourceForExtension,')
	})

	it('emits video context items with poster + metadata for downstream threads', () => {
		// Phase 7: vision-capable text models can't ingest MP4, so an upstream
		// video is fed as its ffmpeg poster + a JSON text block describing
		// duration/aspect/audio.
		const serviceTs = readSourceFile('../../services/ai-chat-thread-service.ts')
		expectSourceToContain(serviceTs, "export type ContextItemType = 'document' | 'image' | 'aiChatThread' | 'video'")
		expectSourceToContain(serviceTs, "node.type === 'video'")
		expectSourceToContain(serviceTs, 'posterFileId: videoNode.posterFileId')
		expectSourceToContain(serviceTs, 'durationSeconds: videoNode.durationSeconds')
		expectSourceToContain(serviceTs, 'aspectRatio: videoNode.aspectRatio')
		expectSourceToContain(serviceTs, 'hasAudio: videoNode.hasAudio')
		expectSourceToContain(serviceTs, "type: 'standalone_video'")
		expectSourceToContain(serviceTs, '`nats-obj://workspace-${item.workspaceId}-files/${item.posterFileId}`')
	})
})
