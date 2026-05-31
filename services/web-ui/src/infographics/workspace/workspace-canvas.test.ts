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

function loadPixiTravelingOutlineRenderer(): string {
	return readSourceFile('../../utils/animations/gradients/pixiTravelingOutlineRenderer.ts', 'utils/animations/gradients/pixiTravelingOutlineRenderer.ts')
}

function loadWorkspaceCanvasSvelte(): string {
	return readSourceFile('../../components/WorkspaceCanvas.svelte', 'components/WorkspaceCanvas.svelte')
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
		expect(docNodeBlock).not.toContain('transition: box-shadow')
		expect(docNodeBlock).not.toContain('transition:box-shadow')
	})

	it('.workspace-image-node base uses the theme-configured default box-shadow', () => {
		const topLevelSection = imageNodeBlock.split('&.workspace-image-node-context-region-child')[0]
		expect(topLevelSection).toMatch(/^\s*box-shadow:\s*var\(--workspace-image-default-box-shadow\);/m)

		// Generated-image chrome provider badge shadow remains allowed.
		const badgeBlock = extractBlock(scss, '.image-model-badge')
		expect(extractBoxShadowValues(badgeBlock)).toHaveLength(1)
	})

	it('uses a theme-configured shadow for selected image nodes', () => {
		const selectedBlock = extractBlockContainingSelector(imageNodeBlock, '&.is-selected')
		expectExcerptToContain(selectedBlock, 'box-shadow: var(--workspace-image-selected-box-shadow)', 'selected image selector block')
		expectExcerptNotToContain(selectedBlock, 'outline:', 'selected image selector block')
	})

	it('sizes generated-image chrome to the full image width with large active controls', () => {
		const ts = loadTs()
		const actionsBlock = extractBlock(scss, '.workspace-generated-image-actions')
		const badgeBlock = extractBlock(scss, '.image-model-badge')
		const infoButtonBlock = extractBlock(scss, '.image-info-button')
		const panelBlock = extractBlock(scss, '.canvas-generated-image-info-panel')
		const traceDetailsBlock = extractBlock(panelBlock, '.canvas-generated-image-trace-details')
		const activeBlock = extractBlock(infoButtonBlock, '&.is-active')

		expectSourceToContain(ts, 'width: `${dimensions.width}px`,')
		expectSourceNotToContain(ts, 'function getGeneratedImageInfoWidth')
		expectExcerptToContain(actionsBlock, 'width: 100%', 'generated image actions block')
		expectExcerptToContain(badgeBlock, 'width: 52px', 'image model badge block')
		expectExcerptToContain(badgeBlock, 'height: 52px', 'image model badge block')
		expectExcerptToContain(badgeBlock, 'width: 30px', 'image model badge icon block')
		expectExcerptToContain(infoButtonBlock, 'width: 52px', 'image info button block')
		expectExcerptToContain(infoButtonBlock, 'height: 52px', 'image info button block')
		expectExcerptToContain(infoButtonBlock, 'width: 30px', 'image info icon block')
		expectExcerptToContain(activeBlock, 'background: $steelBlue', 'active image info button block')
		expectExcerptToContain(activeBlock, 'border-color: $steelBlue', 'active image info button block')
		expectExcerptToContain(panelBlock, 'overflow: visible', 'generated image info panel block')
		expectExcerptNotToContain(panelBlock, 'max-height: 440px', 'generated image info panel block')
		expectExcerptNotToContain(panelBlock, 'overflow: auto', 'generated image info panel block')
		expectExcerptToContain(traceDetailsBlock, 'max-height: none', 'canvas trace details block')
		expectExcerptToContain(traceDetailsBlock, 'overflow: visible', 'canvas trace details block')
	})

	it('scopes the context-region off-white frame to region child image nodes', () => {
		const contextRegionBlock = extractBlock(imageNodeBlock, '&.workspace-image-node-context-region-child')
		expect(contextRegionBlock).toMatch(/background:\s*var\(--workspace-image-context-region-child-image-frame-color\)/)
		expect(contextRegionBlock).toContain('box-shadow: 0 0 0 8px var(--workspace-image-context-region-child-image-frame-color), var(--workspace-image-context-region-child-image-drop-shadow)')
		expect(contextRegionBlock).not.toContain('#fff')

		const topLevelSection = imageNodeBlock.split('&.workspace-image-node-context-region-child')[0]
		expect(topLevelSection).not.toContain('workspace-image-node-context-region-child')
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
		expect(fnBody).toContain('entry.sprite.width = w')
		expect(fnBody).toContain('entry.sprite.height = h')
		expect(fnBody).toContain('entry.colorRect.position.set(x, y)')
		expect(fnBody).toContain('syncSpriteMask(entry, x, y, w, h)')
		expect(fnBody).toContain('drawColorRect(entry.colorRect, w, h)')
		expect(fnBody).toContain('entry.colorRectW = w')
		expect(fnBody).toContain('entry.colorRectH = h')
	})

	it('clips PIXI image sprites with the configured image border radius', () => {
		expectSourceToContain(ts, "import { settings } from '$src/settings.ts'")
		expectSourceToContain(ts, 'settings.imageNode.borderRadius')
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
		expectExcerptToContain(completeHandler, 'partialImageTracker.delete(threadId)')
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

	it('keeps image-to-image lineage continuations on their predecessor center line as image proportions resolve', () => {
		expectSourceToContain(ts, 'computeLineageContinuationPositionToRightOfRect(')
		expectSourceToContain(ts, 'const lineageAnchorRect = getGeneratedImageLineageAnchorRect(imageNode, currentCanvasState.nodes, currentCanvasState.edges)')
		expectSourceToContain(ts, '? computeVerticallyCenteredY(lineageAnchorRect, fittedDimensions.height)')
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
		expectSourceToContain(ts, 'createVideoControls(svg, {')
		expectSourceToContain(ts, 'videoNodeHandler?.getVideoElement(node.nodeId)')
		// Only completed videos (with a stored MP4 src) get the controls.
		expectSourceToContain(ts, "node.type === 'video' && Boolean((node as VideoCanvasNode).src)")
		// The chrome geometry tracks the node during live drag/resize.
		expectSourceToContain(ts, 'applyVideoControlsGeometry(videoChromeEl, position, dimensions)')
	})
})

// =============================================================================
// Context-region child world positioning
// =============================================================================

describe('Workspace canvas — context-region child world positioning', () => {
	const ts = loadTs()

	it('feeds world-space nodes into the connection manager', () => {
		const fnMatch = ts.match(/function\s+getNodesForConnectionManager[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('getNodeWorldPosition(node, nodesById)')
		expect(fnBody).toContain('delete nodeForConnection.parentId')
		expect(fnBody).toContain('delete nodeForConnection.expandParent')
		expect(fnBody).toContain('delete nodeForConnection.extent')
		expect(ts).not.toContain('connectionManager?.syncNodes(nextState.nodes)')
		expect(ts).not.toContain('connectionManager.syncNodes(currentCanvasState.nodes)')
	})

	it('checks viewport visibility against world-space node rectangles', () => {
		const fnMatch = ts.match(/function\s+isNodeInViewport[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('const worldRect = getNodeWorldRect(node)')
		expect(fnBody).toContain('const screenLeft = worldRect.x * zoom + x')
		expect(fnBody).not.toContain('node.position.x * zoom')
	})
})

// =============================================================================
// Workspace AI chat panel — stable reload path
// =============================================================================

describe('Workspace canvas — AI panel reload stability', () => {
	const ts = loadTs()

	it('tracks the mounted panel thread separately from the selected active thread', () => {
		expectSourceToContain(ts, 'let activeAiChatPanelThreadId: string | null = null')
		expectSourceToContain(ts, 'function destroyActiveAiChatPanel(clearActive = false, panelThreadId = activeAiChatPanelThreadId ?? activeAiChatThreadId): void')
		expectSourceToContain(ts, 'threadEditors.get(panelThreadId)')
		expectSourceToContain(ts, 'promptInputController.unregisterThreadEditor(panelThreadId)')
		expectSourceToContain(ts, 'activeAiChatPanelThreadId = panelThreadId')
	})

	it('captures panel thread id in editor callbacks instead of reading mutable active thread state', () => {
		const fnMatch = ts.match(/function\s+renderActiveAiChatPanel[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain("const panelThreadId = activeSidebarTab?.type === 'thread' ? activeSidebarTab.refId : null")
		expect(fnBody).toContain('aiChatThreadId: panelThreadId')
		expect(fnBody).toContain('threadId: panelThreadId')
		expect(fnBody).toContain('threadEditors.set(panelThreadId')
		expect(fnBody).toContain('promptInputController.registerThreadEditor(panelThreadId')
		expect(fnBody).not.toContain('threadId: activeAiChatThreadId!')
		expect(fnBody).not.toContain('referenceId: activeAiChatThreadId!')
	})

	it('does not treat AI chat thread content load as a full canvas rerender signal', () => {
		const fnMatch = ts.match(/function\s+getAiChatThreadsKey[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('return threads.map(t => t.threadId).join')
		expect(fnBody).not.toContain('t.content')
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

	it('autoGrowThreadNode is disabled for context region nodes', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('Disabled for context region nodes')
		expect(fnBody).toContain('expandRegionsToFitChildren()')
		expect(fnBody).not.toMatch(/threadNodeEl\.style\.height\s*=\s*['"]auto['"]/)
		expect(fnBody).not.toContain('threadNodeEl.offsetHeight')
	})

	it('scheduleThreadAutoGrow is disabled with autoGrowThreadNode', () => {
		const fnMatch = ts.match(/function\s+scheduleThreadAutoGrow[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('Disabled')
		expect(fnBody).not.toContain('requestAnimationFrame')
	})

	it('updateThreadNodeVisibility still repositions thread companions when visibility changes', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('repositionAllThreadFloatingInputs')
	})

	it('updateThreadNodeVisibility schedules disabled auto-grow for compatibility', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('scheduleThreadAutoGrow(nodeId)')
	})

	it('renderNodes does not schedule auto-grow for context regions', () => {
		const renderMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(renderMatch).not.toBeNull()
		const renderBody = renderMatch![0]
		expect(renderBody).not.toContain('scheduleThreadAutoGrow')
	})

	it('destroy() cleans up autoGrowRaf and pendingAutoGrowThreadNodeIds', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		const destroyBody = destroyMatch![0]
		expect(destroyBody).toContain('autoGrowRaf')
		expect(destroyBody).toContain('pendingAutoGrowThreadNodeIds')
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
		expect(fnBody).toContain('ai-user-message-wrapper')
		expect(fnBody).toContain('ai-response-message-wrapper')
	})

	it('updateThreadNodeVisibility hides or shows thread nodes from message state', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('threadContentHasMessages')
		expect(fnBody).toContain('hideThreadNode')
		expect(fnBody).toContain('showThreadNode')
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
		expect(fnBody).toContain('contentJSON')
		expect(fnBody).toContain('threadNodeEl.querySelector')
	})

	it('positionElementBelowNode accounts for hidden thread nodes', () => {
		const fnMatch = ts.match(/function\s+positionElementBelowNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('getThreadTopOffset')
	})

	it('renderNodes clears hiddenEmptyThreadNodeIds', () => {
		const renderMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(renderMatch).not.toBeNull()
		const renderBody = renderMatch![0]
		expect(renderBody).toContain('hiddenEmptyThreadNodeIds.clear()')
	})

	it('destroy() clears hiddenEmptyThreadNodeIds', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		const destroyBody = destroyMatch![0]
		expect(destroyBody).toContain('hiddenEmptyThreadNodeIds')
	})

	it('defines hideThreadNode helper that sets data-thread-empty attribute', () => {
		const fnMatch = ts.match(/function\s+hideThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain("threadEmpty")
		expect(fnBody).toContain("hiddenEmptyThreadNodeIds.add")
	})

	it('defines showThreadNode helper that removes data-thread-empty attribute', () => {
		const fnMatch = ts.match(/function\s+showThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain("threadEmpty")
		expect(fnBody).toContain("hiddenEmptyThreadNodeIds.delete")
	})

	it('defines getThreadTopOffset helper', () => {
		const fnMatch = ts.match(/function\s+getThreadTopOffset[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('hiddenEmptyThreadNodeIds')
	})

	it('updateThreadNodeVisibility uses hideThreadNode and showThreadNode', () => {
		const fnMatch = ts.match(/function\s+updateThreadNodeVisibility[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('showThreadNode')
		expect(fnBody).toContain('hideThreadNode')
	})

	it('hidden thread state collapses thread top offset', () => {
		const fnMatch = ts.match(/function\s+getThreadTopOffset[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('hiddenEmptyThreadNodeIds.has')
		expect(fnBody).toContain('? 0 : threadHeight + 16')
	})

	it('drag mousemove uses getThreadTopOffset for floating input positioning', () => {
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('getThreadTopOffset')
	})

	it('resize mousemove uses getThreadTopOffset for floating input positioning', () => {
		const fnMatch = ts.match(/function\s+handleResizeStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('getThreadTopOffset')
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

		expect(block).not.toContain('&:hover .document-resize-handle')
		expect(block).not.toContain('&.is-selected .document-resize-handle')
		expect(block).not.toContain('&.is-resizing .document-resize-handle')
	})

	it('keeps handles as invisible corner hitboxes that reveal only on direct hover or drag', () => {
		const block = extractBlock(scss, '.document-resize-handle')

		expect(block).toMatch(/opacity:\s*0/)
		expect(block).toMatch(/pointer-events:\s*auto/)
		expect(block).toContain('&:hover,')
		expect(block).toContain('&.is-dragging')
		expect(block).toMatch(/&:hover,[\s\S]*&\.is-dragging\s*\{[\s\S]*opacity:\s*1/)
	})

	it('does not reveal floating input resize handles from thread selection', () => {
		const block = extractBlock(scss, '.ai-prompt-input-thread-persistent')

		expect(block).not.toContain('&.is-selected .document-resize-handle')
		expect(block).not.toContain('&.thread-hovered .document-resize-handle')
	})

	it('does not create DOM resize handles for context region proxies', () => {
		const fnMatch = ts.match(/function\s+createBaseNodeElement[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		sourceFileNames.set(fnBody, 'createBaseNodeElement')

		expectSourceToContain(fnBody, "const isContextRegion = isContextRegionCanvasNode(node) && Boolean(extraClasses?.includes('workspace-context-region-node'))")
		expectSourceToContain(fnBody, 'if (!isContextRegion) {')
		expectSourceToContain(fnBody, "if (node.type === 'aiChatThread' && corner.startsWith('bottom')) continue")
		expectSourceToContain(fnBody, 'nodeEl.appendChild(createResizeHandle(node.nodeId, corner))')
		expectSourceNotToContain(fnBody, "if (node.type === 'aiChatThread' && !isContextRegion && corner.startsWith('bottom')) continue")
	})

	it('routes context region resize through cloud-edge hit testing', () => {
		expectSourceToContain(ts, "type ResizeHandle = ResizeCorner | ContextRegionCloudResizeHandle")
		expectSourceToContain(ts, 'function handlePaneMouseMove(event: MouseEvent): void')
		expectSourceToContain(ts, "paneEl.style.cursor = regionHit.kind === 'resize' ? regionHit.cursor : ''")
		expectSourceToContain(ts, "if (regionHit.kind === 'resize') {")
		expectSourceToContain(ts, 'handleResizeStart(event, regionHit.nodeId, regionHit.handle)')
	})
})

// =============================================================================
// AI chat region sizing
// =============================================================================

describe('AI chat region sizing', () => {
	const ts = loadTs()

	it('preserves manually resized empty region dimensions', () => {
		const fnMatch = ts.match(/function\s+expandRegionsToFitChildren[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('Empty regions keep their persisted size')
		expect(fnBody).toContain('node.dimensions.width <= 0 || node.dimensions.height <= 0')
		expect(fnBody).not.toContain('node.dimensions.width !== 300 || node.dimensions.height !== 200')
	})

	it('does not shrink manually enlarged regions when children are dropped inside', () => {
		const fnMatch = ts.match(/function\s+expandRegionsToFitChildren[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('Dropping a small image into a manually enlarged')
		expect(fnBody).toContain('let width = Math.max(200, node.dimensions.width)')
		expect(fnBody).toContain('let height = Math.max(120, node.dimensions.height)')
		expect(fnBody).not.toContain('let width = 200')
		expect(fnBody).not.toContain('let height = 120')
	})
})

// =============================================================================
// AI chat region layering
// =============================================================================

describe('AI chat region layering', () => {
	const ts = loadTs()

	it('keeps context regions on the background layer even when selected or dragged with a group', () => {
		expectSourceToContain(ts, 'function isContextRegionNodeElement(nodeEl: HTMLElement): boolean')
		expectSourceToContain(ts, "nodeEl.classList.contains('workspace-context-region-node')")
		expectSourceToContain(ts, 'String(nodeLayerManager.backgroundIndex())')
		expectSourceToContain(ts, 'nodeLayerManager.sendToBackground(nextNode)')
		expectSourceToContain(ts, 'nodeLayerManager.sendToBackground(entry.el)')
	})
})

// =============================================================================
// AI chat region proximity connect
// =============================================================================

describe('AI chat region proximity connect', () => {
	const ts = loadTs()

	it('excludes context region cards from proximity connect candidates', () => {
		expectSourceToContain(ts, 'function isContextRegionCanvasNode(node: CanvasNode): node is ContextRegionNode')
		expectSourceToContain(ts, "return node.type === 'contextRegion' || node.type === 'aiChatThread'")
		expectSourceToContain(ts, 'isContextRegionNode: isContextRegionCanvasNode')
	})
})

// =============================================================================
// AI chat region image frame
// =============================================================================

describe('AI chat region image frame', () => {
	const ts = loadTs()
	const configuredSettings = loadSettings()

	it('marks images with the frame only when their parent is a context region', () => {
		expectSourceToContain(ts, "const CONTEXT_REGION_IMAGE_CLASS = 'workspace-image-node-context-region-child'")
		expectSourceToContain(ts, 'function isImageInsideContextRegion(node: ImageCanvasNode')
		expectSourceToContain(ts, 'candidate.nodeId === node.parentId && isContextRegionCanvasNode(candidate)')
		expectSourceToContain(ts, "node.type === 'image' && isImageInsideContextRegion(node as ImageCanvasNode, nodes)")
		expectSourceToContain(ts, 'nodeEl.classList.toggle(CONTEXT_REGION_IMAGE_CLASS, hasContextRegionFrame)')
		expectSourceToContain(ts, 'syncContextRegionImageFrame(nodeEl, node)')
	})

	it('uses the theme-configured off-white frame color', () => {
		expectSourceToContain(configuredSettings, 'type ImageNodeSettings = {')
		expectSourceToContain(configuredSettings, 'contextRegionChildImageFrameColor: string')
		expectSourceToContain(configuredSettings, "contextRegionChildImageFrameColor: '#FCFCFA'")
		expectSourceNotToContain(configuredSettings, "contextRegionChildImageFrameColor: '#fff'")
		expectSourceNotToContain(configuredSettings, 'contextRegionImageFrameColor')
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-context-region-child-image-frame-color', settings.imageNode.contextRegionChildImageFrameColor)")
	})

	it('updates the frame immediately when an image is adopted into or released from a region', () => {
		expectSourceToContain(ts, 'syncContextRegionImageFrame(nodeEl, { ...node, parentId: containingRegion.nodeId }, currentCanvasState.nodes)')
		expectSourceToContain(ts, 'if (nodeEl) syncContextRegionImageFrame(nodeEl, releasedNode, currentCanvasState.nodes)')
	})
})

// =============================================================================
// AI chat region PIXI cloud layer
// =============================================================================

describe('AI chat region PIXI cloud layer', () => {
	const ts = loadTs()
	const scss = loadScss()
	const configuredSettings = loadSettings()
	const cloudTs = readSourceFile('rendering/contextRegionClouds.ts')
	const cloudLayerTs = readSourceFile('rendering/pixiContextRegionLayer.ts')
	const viewportBridgeTs = readSourceFile('rendering/viewportBridge.ts')

	it('creates a dedicated PIXI context region layer below DOM nodes', () => {
		expectSourceToContain(ts, 'createPixiContextRegionLayer')
		expectSourceToContain(ts, 'let contextRegionLayer: PixiContextRegionLayer | null = null')
		expectSourceToContain(ts, 'contextRegionLayer = createPixiContextRegionLayer({')
		expectSourceToContain(cloudLayerTs, 'className="workspace-pixi-context-region-layer"')
		expectSourceToContain(scss, '.workspace-pixi-context-region-layer')
		expectSourceToContain(scss, 'z-index: 0')
	})

	it('keeps context region DOM nodes as non-visual PIXI-owned proxies', () => {
		expectSourceToContain(ts, 'workspace-context-region-node-pixi-owned')
		expectSourceNotToContain(configuredSettings, 'contextRegionAreaShiftingGradientColors')
		expectSourceToContain(configuredSettings, 'contextRegion: ContextRegionSettings')
		expectSourceToContain(configuredSettings, 'cloud: WebUiContextRegionCloudThemeSettings')
		expectSourceToContain(configuredSettings, 'palettes: ContextRegionCloudThemePalettes')
		expectSourceToContain(cloudTs, 'const contextRegionCloudTheme = settings.contextRegion.cloud')
		expectSourceToContain(cloudLayerTs, 'const contextRegionCloudTheme = settings.contextRegion.cloud')
		expectSourceNotToContain(configuredSettings, 'contextRegionCloudStyles')
		expectSourceNotToContain(configuredSettings, 'contextRegionCloudGradientColors')
		expectSourceNotToContain(configuredSettings, 'contextRegionCloudPalettes')
		expectSourceNotToContain(cloudTs, 'settings.contextRegionCloud')
		expectSourceNotToContain(cloudLayerTs, 'settings.contextRegionCloud')
		expectSourceNotToContain(ts, 'workspace-ai-chat-thread-region-title-bar')
		expectSourceToContain(scss, 'pointer-events: none')
		expectSourceToContain(scss, 'background: transparent')
	})

	it('syncs cloud datums through render, commit, selection, and viewport changes', () => {
		expectSourceToContain(ts, 'function getContextRegionCloudDatums')
		expectSourceToContain(ts, 'function syncContextRegionLayer')
		expectSourceToContain(ts, 'syncContextRegionLayer(nextState)')
		expectSourceToContain(ts, 'syncContextRegionLayer(undefined)')
		expectSourceToContain(ts, 'syncContextRegionLayer(currentCanvasState)')
		expectSourceToContain(viewportBridgeTs, 'getContextRegionLayer?.()?.setViewport(viewport)')
	})

	it('routes pane hits through irregular cloud hit testing before marquee selection', () => {
		const fnMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('contextRegionLayer?.hitTest(start)')
		expect(fnBody).toContain("regionHit.kind === 'resize'")
		expect(fnBody).toContain('handleResizeStart(event, regionHit.nodeId, regionHit.handle)')
		expect(fnBody).toContain('handleDragStart(event, regionHit.nodeId, {')
		expect(fnBody).toContain('activateAiChatPanel(regionNode, thread)')
	})

	it('uses shared cloud styles for hit testing and adoption scoring', () => {
		expectSourceToContain(cloudTs, 'const contextRegionCloudTheme = settings.contextRegion.cloud')
		expectSourceToContain(cloudTs, 'export const CONTEXT_REGION_CLOUD_STYLES: ContextRegionCloudStyle[] = contextRegionCloudTheme.styles')
		expectSourceToContain(cloudTs, 'hitTestContextRegionCloud')
		expectSourceToContain(cloudTs, 'rectIntersectsContextRegionCloud')
		expectSourceToContain(cloudTs, 'scoreRectAgainstContextRegionCloud')
		expectSourceToContain(ts, 'rectIntersectsContextRegionCloud(datum, rect)')
		expectSourceToContain(ts, 'scoreRectAgainstContextRegionCloud(regionDatum, draggedRect, dropPoint)')
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

	it('createContextRegionNode leaves rail creation outside the region card renderer', () => {
		const fnMatch = ts.match(/function\s+createContextRegionNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).not.toContain('createThreadRail(')
	})

	it('repositionAllThreadFloatingInputs also repositions rails', () => {
		const fnMatch = ts.match(/function\s+repositionAllThreadFloatingInputs[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('repositionThreadRail(')
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
		expect(fnBody).toContain("threadRails.get(nodeId)?.classList.add('is-selected')")
		expect(fnBody).toContain("threadRails.get(nodeId)?.classList.remove('is-selected')")
	})

	it('renderNodes calls destroyAllThreadRails', () => {
		const fnMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('destroyAllThreadRails()')
	})

	it('destroy() calls destroyAllThreadRails', () => {
		const destroyMatch = ts.match(/destroy\(\)\s*\{[\s\S]*?^        \}/m)
		expect(destroyMatch).not.toBeNull()
		expect(destroyMatch![0]).toContain('destroyAllThreadRails()')
	})

	it('passes railOffset to WorkspaceConnectionManager', () => {
		expect(ts).toMatch(/railOffset:\s*RAIL_OFFSET/)
	})

	it('createThreadRail creates line child element', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('workspace-thread-rail-line')
	})

	it('createThreadRail sets z-index above all nodes to prevent overlap', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain("zIndex: '9990'")
	})

	it('createThreadRail appends boundary circle to line', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('workspace-thread-rail-boundary-circle')
		expect(fnMatch![0]).toContain('aiChatThreadRailBoundaryCircle')
	})

	it('createThreadRail applies configured colors to boundary circle SVG paths', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('settings.aiChatThread.rail.boundaryCircleColors')
		expect(fnBody).toContain("setAttribute('fill'")
	})

	it('repositionThreadRail sets --rail-thread-height CSS var', () => {
		const fnMatch = ts.match(/function\s+repositionThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('--rail-thread-height')
	})

	it('repositionThreadRail hides boundary circle when thread is hidden', () => {
		const fnMatch = ts.match(/function\s+repositionThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('workspace-thread-rail-boundary-circle')
		expect(fnBody).toContain("isHidden ? 'none' : ''")
	})

	it('resize handler updates --rail-thread-height CSS var', () => {
		expect(ts).toMatch(/resizeRail\.style\.setProperty\('--rail-thread-height'/)
	})

	it('repositionThreadRail calls connectionManager.setRailHeight', () => {
		const fnMatch = ts.match(/function\s+repositionThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('connectionManager?.setRailHeight(')
	})

	it('destroyAllThreadRails calls connectionManager.clearRailHeights', () => {
		const fnMatch = ts.match(/function\s+destroyAllThreadRails[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('connectionManager?.clearRailHeights()')
	})

	it('updateSelectionDrivenUi never shows the detached floating input under any node', () => {
		const fnMatch = ts.match(/function\s+updateSelectionDrivenUi[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		// The deprecated detached prompt-input-below-node must never render for any
		// node type (documents, threads, images, video).
		expect(fnBody).not.toContain('showFloatingInput')
		expect(fnBody).toContain('hideFloatingInput')
		// Context-region selections still set the docked panel's prompt target.
		expect(fnBody).toContain('isContextRegionCanvasNode(node)')
		expect(fnBody).toContain('promptInputController.setTarget')
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

		expect(fnBody).toContain('workspace-ai-chat-floating-panel workspace-ai-chat-thread-node')
		expect(fnBody).toContain('new ProseMirrorEditor')
		expect(fnBody).toContain('workspace-thread-rail workspace-ai-chat-floating-panel-rail')
		expect(fnBody).toContain('const backdropEl = html`<div className="workspace-ai-chat-panel-backdrop"')
		expect(fnBody).toContain('paneEl.appendChild(backdropEl)')
		expect(fnBody).toContain('handleActiveAiChatPanelResizeStart')
		expect(fnBody).toContain('aiChatThreadRailBoundaryCircle')
		expect(fnBody).toContain("'--dropdown-popover-box-shadow'")
		expect(fnBody).toContain('settings.dropdown.popoverBoxShadow')
		expectSourceNotToContain(ts, `AiChat${'Panel.svelte'}`)
	})

	it('opens the panel without requiring a context-region thread and creates standalone history on submit', () => {
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

	it('provides persisted selection-context controls for standalone chat sends', () => {
		expectSourceToContain(ts, "{ label: 'Follow', value: 'followSelection' }")
		expectSourceToContain(ts, "{ label: 'Pinned', value: 'pinnedContext' }")
		expectSourceToContain(ts, '>With Sources</span>')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-divider')
		expectSourceToContain(ts, 'aria-label="Include Upstream Context"')
		expectSourceToContain(ts, 'aiChatPanelToggleHistoryIcon')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-control')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-history-toggle')
		expectSourceToContain(ts, 'const isSessionHistoryOpen = !aiChatPanelState.isSessionHistoryOpen')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-sessions-hidden')
		expectSourceToContain(ts, "import { select } from 'd3-selection'")
		expectSourceToContain(ts, "import { createSlidingSwitch } from '$src/components/slidingSwitch/index.ts'")
		expectSourceToContain(ts, "import { createToggleSwitch } from '$src/components/toggleSwitch/index.ts'")
		expectSourceToContain(ts, "const contextSelector = createSlidingSwitch<CanvasAiChatPanelState['contextMode']>(select(contextSelectorSvg), {")
		expectSourceToContain(ts, 'const slidingSwitchMarkup = `<svg class="workspace-ai-chat-panel-context-selector-svg"')
		expectSourceToContain(ts, 'const lineageSwitch = createToggleSwitch(select(lineageSwitchSvg), {')
		expectSourceToContain(ts, 'const lineageSwitchMarkup = `<svg class="workspace-ai-chat-panel-lineage-switch-svg"')
		expectSourceToContain(ts, 'innerHTML=${lineageSwitchMarkup}')
		expectSourceNotToContain(ts, 'const lineageSwitchSvg = html`<svg')
		expectSourceNotToContain(ts, 'type="checkbox"')
		expectSourceNotToContain(ts, '<select>')
		expectSourceToContain(ts, 'workspace-ai-chat-panel-context-selector')
		expectSourceToContain(ts, 'extractSelectedContext({')
		expectSourceToContain(ts, 'includeUpstream: aiChatPanelState.includeUpstreamContext')
	})

	it('removes drafts only when a session is deleted, not when its tab is closed', () => {
		const closeStart = ts.indexOf('function closeAiChatSidebarTab')
		const removeDraftStart = ts.indexOf('function removeAiChatPanelDraft', closeStart)
		const deleteChatStart = ts.indexOf('async function deleteAiChatSession', removeDraftStart)
		const deleteExtractionStart = ts.indexOf('async function deleteExtractionSession', deleteChatStart)
		const closeBody = ts.slice(closeStart, removeDraftStart)
		const deleteChatBody = ts.slice(deleteChatStart, deleteExtractionStart)
		const deleteExtractionBody = ts.slice(deleteExtractionStart, ts.indexOf('async function loadExtractionSessionHistory', deleteExtractionStart))

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
		expectSourceToContain(scss, 'width: calc(var(--workspace-ai-chat-sidebar-width) + 116px + var(--workspace-ai-chat-sidebar-edge-gap))')
		expectSourceToContain(scss, 'backdrop-filter: blur(28px) saturate(145%)')
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
		expectSourceToContain(scss, 'right: calc(var(--workspace-ai-chat-sidebar-edge-gap) - var(--workspace-canvas-padding-inline))')
		expectSourceToContain(scss, 'bottom: calc(var(--workspace-ai-chat-sidebar-edge-gap) - var(--workspace-canvas-padding-bottom))')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'top: 0px', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'border-radius: 10px', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel'), 'background: transparent', 'outer chat panel')
		expectExcerptToContain(extractBlock(scss, '.workspace-ai-chat-floating-panel-prompt'), 'width: 100% !important', 'chat composer')
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
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

		expect(clickHandler).toContain('selectNode(node.nodeId)')
		expect(clickHandler).not.toContain('selectNode(selectionTargetNodeId)')
		expect(clickHandler).not.toContain('selectNode(getSelectionTargetNodeId')
	})

	it('marquee selection stores intersected node ids directly', () => {
		const fnMatch = ts.match(/function\s+getSelectableNodeIdsInRect[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('selectedNodeIdsInRect.add(node.nodeId)')
		expect(fnBody).not.toContain('getSelectionTargetNodeId')
	})

	it('clicking inside editor content (ProseMirror, contenteditable) does not trigger node selection', () => {
		// CRITICAL: clicks inside AI chat thread content must reach ProseMirror
		// editors without triggering selectNode, which would cause the selection
		// overlay and resize handles to appear, blocking text editing.
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

		// Must check all three selectors to cover:
		// - contenteditable: any contenteditable element (ProseMirror root)
		// - .ProseMirror: the ProseMirror editor container class
		// - .ai-chat-thread-wrapper: the AI chat thread content container
		expect(clickHandler).toContain('clickTarget.isContentEditable')
		expect(clickHandler).toContain(".closest('.ProseMirror')")
		expect(clickHandler).toContain(".closest('.ai-chat-thread-wrapper')")

		// The handler must bail out (return) before reaching selectNode
		// when the click target matches any of these selectors
		const editorCheckIndex = clickHandler.indexOf('isContentEditable')
		const selectNodeIndex = clickHandler.indexOf('selectNode(node.nodeId)')
		expect(editorCheckIndex).toBeLessThan(selectNodeIndex)
	})

	it('Mod-click triggers selection toggling from node chrome', () => {
		// Mod-click on node chrome toggles selection from the click handler.
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

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
		// the overlay. Plain clicks on any node, including context regions, do
		// not draw a selection rectangle. Marquee selection does.
		expectSourceToContain(ts, 'let selectionIsFromMarquee = false')
		expectSourceToContain(ts, 'return selectionIsFromMarquee')

		// setSelectedNodes accepts a fromMarquee parameter
		expectSourceToContain(ts, 'function setSelectedNodes(nextSelectedNodeIds: Set<string>, fromMarquee = false): void')
		expectSourceToContain(ts, 'selectionIsFromMarquee = fromMarquee && nextSelectedNodeIds.size > 0')
	})

	it('shouldShowSelectionGroupOverlay returns true for multi-select or marquee, false for plain click', () => {
		const fnMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Empty selection = no overlay
		expect(fnBody).toContain('selectedNodeIds.size === 0) return false')

		// 2+ nodes = always overlay (regardless of source)
		expect(fnBody).toContain('if (selectedNodeIds.size > 1) return true')

		// Single node = overlay only if selected via marquee
		expect(fnBody).toContain('return selectionIsFromMarquee')
		expect(fnBody).not.toContain('const selectedNodeId = getSingleSelectedNodeId()')
		expect(fnBody).not.toContain('const selectedNode = currentCanvasState.nodes.find')

		// Must NOT contain any node-type special casing (e.g. aiChatThread)
		expect(fnBody).not.toContain("'aiChatThread'")
		expect(fnBody).not.toContain('node.type')
	})

	it('marquee handler passes fromMarquee=true so even a single marquee node gets the overlay', () => {
		const paneMouseDownMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(paneMouseDownMatch).not.toBeNull()
		const fnBody = paneMouseDownMatch![0]

		expect(fnBody).toContain('setSelectedNodes(new Set(selectedIds), true)')
	})

	it('selectNode (plain click) does NOT pass fromMarquee so single-click never shows overlay', () => {
		const fnMatch = ts.match(/function\s+selectNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// selectNode calls setSelectedNodes with default fromMarquee=false
		expect(fnBody).toContain('setSelectedNodes(nodeId ? new Set([nodeId]) : new Set())')
		expect(fnBody).not.toContain('true)')
	})

	it('toggleNodeSelection does NOT pass fromMarquee', () => {
		const fnMatch = ts.match(/function\s+toggleNodeSelection[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('setSelectedNodes(nextSelectedNodeIds)')
		expect(fnBody).not.toContain(', true)')
	})

	it('clearNodeSelection resets selection and hides overlay', () => {
		const fnMatch = ts.match(/function\s+clearNodeSelection[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('setSelectedNodes(new Set())')
		expect(fnBody).toContain('updateSelectionGroupOverlayElement()')
	})

	it('defines and styles the persistent selection overlay', () => {
		expectSourceToContain(ts, 'className="workspace-selection-group-overlay"')
		expectSourceToContain(ts, 'function getSelectionOverlayBounds(): Rect | null')
		expectSourceToContain(ts, 'function getSelectionOverlayBoundsForNode(')
		expectSourceToContain(ts, 'function updateSelectionGroupOverlayElement(): void')
		expectSourceToContain(ts, 'if (!currentCanvasState || !shouldShowSelectionGroupOverlay()) return null')
		expectSourceToContain(ts, 'getContextRegionCloudBounds(datum)')
		expectSourceToContain(ts, 'updateSelectionGroupOverlayElement()')
		expectSourceToContain(scss, '.workspace-selection-group-overlay')
		expect(scss).toMatch(/\.workspace-selection-group-overlay\s*\{[^}]*z-index:\s*10000/s)
		expect(scss).toMatch(/\.workspace-selection-group-overlay\s*\{[^}]*cursor:\s*move/s)
		expect(scss).toMatch(/\.workspace-selection-group-overlay\s*\{[^}]*box-sizing:\s*border-box/s)
	})

	it('uses the selection overlay as a drag surface for the whole selected group', () => {
		expectSourceToContain(ts, "selectionGroupOverlayEl.addEventListener('mousedown'")
		expectSourceToContain(ts, 'if (!shouldShowSelectionGroupOverlay()) return')
		expectSourceToContain(ts, 'const primaryNodeId = Array.from(selectedNodeIds)[0]')
		expectSourceToContain(ts, 'handleDragStart(event, primaryNodeId)')
	})

	it('keeps connector lines visible when context regions are selected', () => {
		expectSourceNotToContain(ts, 'function getEdgesForConnectionManager')
		expectSourceNotToContain(ts, 'syncEdges(getEdgesForConnectionManager')
		expectSourceNotToContain(ts, 'selectedContextRegionNodeIds')
		expectSourceToContain(ts, 'connectionManager?.syncEdges(nextState.edges)')
		expectSourceToContain(ts, 'connectionManager.syncEdges(currentCanvasState.edges)')
	})

	it('keeps the overlay hit target active for multi-region group drag but hidden for a single region', () => {
		const fnMatch = ts.match(/function\s+shouldUseSelectionGroupOverlayHitTarget[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('if (selectedNodeIds.size > 1) return true')
		expect(fnBody).toContain('if (node && !isContextRegionCanvasNode(node)) return true')
		expect(fnBody).toContain('return false')
	})

	it('wires selection colors from settings to CSS custom properties', () => {
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-marquee-border-color', settings.selection.marqueeBorderColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-marquee-background-color', settings.selection.marqueeBackgroundColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-overlay-border-color', settings.selection.overlayBorderColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-overlay-background-color', settings.selection.overlayBackgroundColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--selection-outline-color', settings.selection.outlineColor)")
		expect(scss).toMatch(/var\(--selection-outline-color/)
	})

	it('wires image settings to CSS custom properties', () => {
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-default-box-shadow', settings.imageNode.defaultBoxShadow)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-selected-box-shadow', settings.imageNode.selectedBoxShadow)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-border-radius', `${settings.imageNode.borderRadius}px`)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-context-region-child-image-frame-color', settings.imageNode.contextRegionChildImageFrameColor)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-context-region-child-image-drop-shadow', settings.imageNode.contextRegionChildImageDropShadow)")
		expectSourceToContain(ts, "paneEl.style.setProperty('--workspace-image-model-badge-box-shadow', settings.imageNode.modelBadgeBoxShadow)")
		expect(scss).toMatch(/border-radius:\s*var\(--workspace-image-border-radius\)/)
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
		expectSourceToContain(ts, 'rectIntersectsContextRegionCloud(datum, rect)')
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
		expect(fnMatch![0]).toContain("'.workspace-ai-chat-floating-panel'")
	})

	it('does not start marquee when mousedown is inside a context-region node bounds', () => {
		expectSourceToContain(ts, 'function getContextRegionBoundsHit(point: { x: number; y: number }): ContextRegionNode | null')
		expectSourceToContain(ts, 'const threadMap = new Map<string, AiChatThread>(currentAiChatThreads.map((thread) => [thread.threadId, thread]))')
		expectSourceToContain(ts, 'if (!isContextRegionCanvasNode(node)) continue')
		expectSourceToContain(ts, 'const rect = getSelectionOverlayBoundsForNode(node, nodesById, threadMap)')
		expectSourceToContain(ts, 'if (rectContainsCanvasPoint(rect, point)) return node')

		const paneMouseDownMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(paneMouseDownMatch).not.toBeNull()
		const fnBody = paneMouseDownMatch![0]

		const boundsHitIndex = fnBody.indexOf('const regionBoundsHit = getContextRegionBoundsHit(start)')
		const boundsReturnIndex = fnBody.indexOf('if (regionBoundsHit) {')
		const marqueeIndex = fnBody.indexOf('marqueeSelection = {')

		expect(boundsHitIndex).toBeGreaterThanOrEqual(0)
		expect(boundsReturnIndex).toBeGreaterThan(boundsHitIndex)
		expect(marqueeIndex).toBeGreaterThan(boundsReturnIndex)
		expect(fnBody).toContain('handleDragStart(event, regionBoundsHit.nodeId, {')
		expect(fnBody).toContain('return')
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
		expect(fnBody).toContain('moved: true')
	})

	it('does not draw any overlay for a plain single context-region click', () => {
		const showMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
		expect(showMatch).not.toBeNull()
		const showBody = showMatch![0]

		expect(showBody).toContain('return selectionIsFromMarquee')
		expect(showBody).not.toContain('isContextRegionCanvasNode(selectedNode)')

		const fillMatch = ts.match(/function\s+shouldFillSelectionOverlayBounds[\s\S]*?^    \}/m)
		expect(fillMatch).not.toBeNull()
		const fillBody = fillMatch![0]

		expect(fillBody).toContain('if (selectedNodeIds.size !== 1) return true')
		expect(fillBody).toContain('if (selectionIsFromMarquee) return true')
		expect(fillBody).toContain('return !(selectedNode && isContextRegionCanvasNode(selectedNode))')
		expectSourceToContain(ts, 'pixiMediaLayer?.setSelectionOverlayBounds(bounds, { fill: shouldFillSelectionOverlayBounds() })')
		expectSourceToContain(ts, 'pixiMediaLayer?.setSelectionOverlayBounds(getSelectionOverlayBounds(), { fill: shouldFillSelectionOverlayBounds() })')
	})

	it('treats context-region bounds as node hits before pan/zoom can start marquee', () => {
		const panePointerDownMatch = ts.match(/function\s+handlePanePointerDown[\s\S]*?^    \}/m)
		expect(panePointerDownMatch).not.toBeNull()
		const fnBody = panePointerDownMatch![0]

		expect(fnBody).toContain("const regionBoundsHit = nodeHit || regionHit.kind !== 'none' ? null : getContextRegionBoundsHit(start)")
		expect(fnBody).toContain("const hitNodeId = nodeHit?.nodeId ?? (regionHit.kind !== 'none' ? regionHit.nodeId : regionBoundsHit?.nodeId ?? null)")
		expect(fnBody).toContain('suspendPanZoomForNodePointer(hitNodeId)')
	})

	it('drag overlay passes original node.nodeId (not pre-resolved) to handleDragStart', () => {
		// The drag overlay must pass the original nodeId so handleDragStart can
		// preserve the original for the click path.
		expectSourceToContain(ts, 'onmousedown=${(e: MouseEvent) => handleDragStart(e, node.nodeId,')
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
		expect(fnBody).toContain('const isHidden = hiddenEmptyThreadNodeIds.has(node.nodeId)')
		expect(fnBody).toContain('if (isHidden) {')
		expect(fnBody).toContain('right = position.x + inputWidth')
		expect(fnBody).toContain('bottom = inputTop + inputHeight')

		// Visible threads still use Math.max to combine both bounds
		expect(fnBody).toContain('right = Math.max(right, position.x + inputWidth)')
		expect(fnBody).toContain('bottom = Math.max(bottom, inputTop + inputHeight)')
	})

	it('marquee selection includes hidden empty threads (they are selectable via their floating input)', () => {
		const fnMatch = ts.match(/function\s+getSelectableNodeIdsInRect[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Must NOT filter out hidden empty threads — they are still visible
		// via their floating input and must be selectable
		expect(fnBody).not.toContain('hiddenEmptyThreadNodeIds')
		expect(fnBody).toContain('selectionRectIntersectsNode(rect, node, nodesById, threadMap)')
		expectSourceToContain(ts, "node.type === 'aiChatThread' && hiddenEmptyThreadNodeIds.has(node.nodeId) && rectsOverlap(rect, getSelectionBoundsForNode(node))")
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
		expect(fnBody).toContain('if (!dragDidMove) return')
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

	it('context-region drag skips proximity checks during movement', () => {
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('if (dragPlan.allowProximityConnection) {')
		expect(fnBody).toContain('connectionManager?.checkProximity(resolvedNodeId, currentPos, currentDims)')
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
		expectSourceToContain(svelte, 'renderer?.insertNodeAtViewportCenter(contextRegionNode, {')
		expectSourceToContain(svelte, 'lastActiveAiChatThreadId: thread.threadId,')
		expectSourceToContain(svelte, 'aiChatPanel: { ...panelState, isOpen: true, tabs, activeTabId: tabId },')
		expectSourceNotToContain(svelte, "from '$src/infographics/utils/resolveCollisions.ts'")
		expectSourceNotToContain(svelte, 'resolveInsertionCollisions')
		expectSourceNotToContain(svelte, 'computeViewportCenterInsertionPosition')
		expectSourceNotToContain(svelte, 'contextRegionCloudsIntersect')
		expectSourceNotToContain(svelte, 'rectIntersectsContextRegionCloud')
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

	it('builds shape-aware collision boxes around context-region cloud bounds', () => {
		expectSourceToContain(ts, 'function createShapeAwareCollisionPlan(nodes: CanvasNode[], topLevelOnly = false): CollisionPlan')
		expectSourceToContain(ts, 'const worldPosition = getNodeWorldPosition(node, nodesById)')
		expectSourceToContain(ts, 'const cloudBounds = getContextRegionCloudBounds(datum)')
		expectSourceToContain(ts, 'x: worldPosition.x - cloudBounds.x')
		expectSourceToContain(ts, 'return { id: node.nodeId, ...cloudBounds }')
	})

	it('filters broad-phase overlaps through context-region cloud geometry', () => {
		expectSourceToContain(ts, 'const shouldResolvePair = (a: CollisionBox, b: CollisionBox): boolean => {')
		expectSourceToContain(ts, 'contextRegionCloudGeometry.contextRegionCloudsIntersect(datumA, datumB)')
		expectSourceToContain(ts, 'contextRegionCloudGeometry.rectIntersectsContextRegionCloud(datumA, b)')
		expectSourceToContain(ts, 'contextRegionCloudGeometry.rectIntersectsContextRegionCloud(datumB, a)')
	})

	it('uses the shared generic resolver rather than a workspace-specific duplicate', () => {
		expectSourceToContain(collisionTs, 'export function resolveCollisions(')
		expectSourceToContain(collisionTs, 'shouldResolvePair?: (a: NodeBox, b: NodeBox) => boolean')
		expectSourceToContain(ts, "import { resolveCollisions } from '$src/infographics/utils/resolveCollisions.ts'")
		expectSourceToContain(ts, 'resolveCollisions(collisionPlan.nodeBoxes')
	})

	it('keeps parent-child containment out of collision pushes', () => {
		expectSourceToContain(ts, 'if (child.parentId) collisionExclusions.add(`${child.parentId}-${child.nodeId}`)')
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
		// the aiChatThread string, or context-region node types. Plain single-node
		// clicks never draw the group overlay; marquee/multi-selection does.
		const fnMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).not.toContain("'aiChatThread'")
		expect(fnBody).not.toContain('node.type')
		expect(fnBody).not.toContain('isContextRegionCanvasNode(selectedNode)')
		expect(fnBody).toContain('return selectionIsFromMarquee')
	})

	it('REGRESSION: clicking AI chat thread content must NOT trigger selectNode', () => {
		// Root cause: nodeEl click handler called selectNode for all clicks
		// inside the node, including clicks on ProseMirror editor content.
		// This activated the node selection UI (resize handles, outline)
		// which blocked text editing in AI chat threads.
		//
		// Invariant: clicks on contenteditable, .ProseMirror, or
		// .ai-chat-thread-wrapper elements must bail out before selectNode
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

		// All three checks must be present — they cover overlapping DOM trees
		expect(clickHandler).toContain('clickTarget.isContentEditable')
		expect(clickHandler).toContain(".closest('.ProseMirror')")
		expect(clickHandler).toContain(".closest('.ai-chat-thread-wrapper')")

		// The bail-out must happen BEFORE selectNode
		const bailOutIndex = clickHandler.indexOf('return')
		const selectNodeIndex = clickHandler.lastIndexOf('selectNode(node.nodeId)')
		expect(bailOutIndex).toBeLessThan(selectNodeIndex)
	})

	it('REGRESSION: clicking an image node selects the image node directly', () => {
		// Invariant: click handler must call selectNode(node.nodeId) with
		// the original nodeId, never pre-resolving through deprecated
		// generated-image placement state.
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

		expect(clickHandler).toContain('selectNode(node.nodeId)')
		expect(clickHandler).not.toContain('selectNode(selectionTargetNodeId)')
		expect(clickHandler).not.toContain('selectNode(getSelectionTargetNodeId')
	})

	it('REGRESSION: drag overlay must NOT pre-resolve nodeId to parent thread', () => {
		// Root cause: dragOverlay mousedown passed
		// getSelectionTargetNodeId(node.nodeId) to handleDragStart, which
		// meant handleDragStart never had access to the original nodeId. On
		// mouseup-without-drag (click), it would select the thread instead
		// of the image.
		//
		// Invariant: dragOverlay must pass node.nodeId directly
		expectSourceToContain(ts, 'onmousedown=${(e: MouseEvent) => handleDragStart(e, node.nodeId,')
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
		expect(fnBody).toContain('const wasAlreadySelected = isNodeSelected(resolvedNodeId)')

		// Both selection paths must exist
		expect(fnBody).toContain('selectNode(resolvedNodeId)')
		expect(fnBody).toContain('selectNode(nodeId)')

		// selectNode(resolvedNodeId) must be inside a dragDidMove guard
		const dragMoveSection = fnBody.match(/if \(!dragDidMove[\s\S]*?dragDidMove = true[\s\S]*?\}/)?.[0]
		expect(dragMoveSection).toBeDefined()
		expect(dragMoveSection).toContain('selectNode(resolvedNodeId)')
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
		expect(paneMouseDownMatch![0]).toContain(', true)')
	})

	it('REGRESSION: generated output images are not adopted into context regions on drag release', () => {
		expectSourceToContain(ts, 'canAdoptNodeIntoContextRegion,')
		expectSourceToContain(ts, `} from '$src/infographics/workspace/workspaceImageNodePlan.ts'`)

		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('if (canAdoptNodeIntoContextRegion(node))')
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
// Image error placeholder — uses brokenImageIcon from svgIcons
// =============================================================================

describe('Image error placeholder — SVG icon from svgIcons', () => {
	const ts = loadTs()

	it('imports brokenImageIcon from svgIcons', () => {
		expectSourceToContain(ts, 'brokenImageIcon')
		expect(ts).toMatch(/import\s*\{[^}]*brokenImageIcon[^}]*\}\s*from\s*['"]\$src\/svgIcons\/index\.ts['"]/)
	})

	it('showImageErrorPlaceholder uses innerHTML to inject brokenImageIcon (not raw interpolation)', () => {
		const fnMatch = ts.match(/function\s+showImageErrorPlaceholder[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('innerHTML=${brokenImageIcon}')
		// brokenImageIcon should only appear inside an innerHTML= binding
		const allOccurrences = fnBody.match(/brokenImageIcon/g) || []
		const inlineHtmlOccurrences = fnBody.match(/innerHTML=\$\{brokenImageIcon\}/g) || []
		expect(allOccurrences.length).toBe(inlineHtmlOccurrences.length)
	})

	it('showImageErrorPlaceholder deduplicates (checks for existing placeholder before appending)', () => {
		const fnMatch = ts.match(/function\s+showImageErrorPlaceholder[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain("nodeEl.querySelector('.image-error-placeholder')")
		expect(fnBody).toContain('return')
	})

	it('no inline SVG markup in showImageErrorPlaceholder', () => {
		const fnMatch = ts.match(/function\s+showImageErrorPlaceholder[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).not.toContain('<svg')
		expect(fnBody).not.toContain('viewBox')
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

		expect(fnBody!).toContain('if (!marqueeSelection && movedX <= 3 && movedY <= 3) return')

		const clearIndex = fnBody!.indexOf('if (selectedNodeIds.size > 0) setSelectedNodes(new Set())')
		const marqueeStartIndex = fnBody!.indexOf('marqueeSelection = {')
		expect(clearIndex).toBeGreaterThan(-1)
		expect(marqueeStartIndex).toBeGreaterThan(clearIndex)
		expect(fnBody!).toContain('moved: true')

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
		const contextRegionLayerTs = readSourceFile('rendering/pixiContextRegionLayer.ts')

		expectSourceNotToContain(ts, 'backfillDomImageSrcs')
		expectSourceNotToContain(ts, 'imageResolvedSrcByNodeId')
		expectSourceNotToContain(ts, "pixiHealth === 'failed'")
		expectSourceNotToContain(pixiLayerTs, "setHealth('failed')")
		expectSourceNotToContain(contextRegionLayerTs, "setHealth('failed')")
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

	it('feeds the PIXI traveling outline with both image and video pending nodes', () => {
		// Phase 5 v1.1: the snake outline must frame VEO video placeholders
		// during the 11s–6min wait, not just images. Regression-guards the
		// merged set returned from syncPixiGeneratingImageNodes.
		const pixiLayerTs = loadPixiMediaLayer()
		expectSourceToContain(ts, 'function syncPixiGeneratingImageNodes()')
		expectSourceToContain(ts, 'for (const partial of partialImageTracker.values())')
		expectSourceToContain(ts, 'for (const pending of videoGenerationTracker.values())')
		expectSourceToContain(ts, 'pixiMediaLayer?.setGeneratingImageNodes(generatingIds)')
		// Video bounds come from the canvas state (no PIXI image entry exists
		// for them) — the outline renderer reads dimensions directly off the
		// CanvasNode and feeds them into PixiTravelingOutlineDatum.
		expectSourceToContain(pixiLayerTs, 'fallbackNode.dimensions.width')
		expectSourceToContain(pixiLayerTs, 'fallbackNode.dimensions.height')
	})

	it('keeps no DOM bounce-dot spinner for generating videos either', () => {
		// PR #202 regression: PIXI outline is the sole canvas indicator for
		// both kinds. The video placeholder must not reintroduce any of the
		// removed DOM-spinner CSS classes.
		expectSourceNotToContain(ts, 'video-generating-spinner')
		expectSourceNotToContain(ts, 'video-dot-bounce')
	})

	it('wires the bubble menu for video nodes (Extend + Connect + Delete)', () => {
		// Phase 6: video nodes share Connect with image, but get a dedicated
		// Extend-in-new-thread entry and a video-specific Delete.
		const bubbleMenuTs = readSourceFile('canvasBubbleMenuItems.ts')
		expectSourceToContain(ts, "import { buildCanvasBubbleMenuItems, CANVAS_IMAGE_CONTEXT, CANVAS_VIDEO_CONTEXT")
		expectSourceToContain(ts, "node.type !== 'image' && node.type !== 'video'")
		expectSourceToContain(ts, "node.type === 'video' ? CANVAS_VIDEO_CONTEXT : CANVAS_IMAGE_CONTEXT")
		expectSourceToContain(ts, 'onExtendVideoInNewThread: async (nodeId) => {')
		expectSourceToContain(bubbleMenuTs, "export const CANVAS_VIDEO_CONTEXT = 'canvasVideo'")
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
