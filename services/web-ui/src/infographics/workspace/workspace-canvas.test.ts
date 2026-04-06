'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// =============================================================================
// HELPERS
// =============================================================================

function loadScss(): string {
	return readFileSync(
		resolve(__dirname, 'workspace-canvas.scss'),
		'utf-8'
	)
}

function loadTs(): string {
	return readFileSync(
		resolve(__dirname, 'WorkspaceCanvas.ts'),
		'utf-8'
	)
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

	it('no is-selected or focus-within box-shadow override on any node', () => {
		// No box-shadow should appear in selected/focus-within rules
		expect(docNodeBlock).not.toMatch(/is-selected[\s\S]*?box-shadow/)
		expect(docNodeBlock).not.toMatch(/focus-within[\s\S]*?box-shadow/)
	})

	it('no box-shadow transition on any node', () => {
		expect(docNodeBlock).not.toContain('transition: box-shadow')
		expect(docNodeBlock).not.toContain('transition:box-shadow')
	})

	it('.workspace-image-node base has no top-level box-shadow, while anchored mode does', () => {
		// The base .workspace-image-node container itself must not set a root box-shadow.
		// Nested children such as provider badges may still have their own shadows.
		const topLevelSection = imageNodeBlock.split('&.workspace-image-node--anchored')[0]
		expect(topLevelSection).not.toMatch(/^\s*box-shadow:/m)

		// Anchored variant is allowed to have a shadow.
		const anchoredBlock = extractBlock(imageNodeBlock, '&.workspace-image-node--anchored')
		const anchoredShadows = extractBoxShadowValues(anchoredBlock)
		expect(anchoredShadows).toHaveLength(1)

		// Nested provider badge shadow remains allowed.
		const badgeBlock = extractBlock(imageNodeBlock, '.image-model-badge')
		expect(extractBoxShadowValues(badgeBlock)).toHaveLength(1)
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
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node\s+\.ai-chat-thread-node-editor\s+\.ProseMirror\s*\{[^}]*padding-bottom:\s*1rem/)
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

	it('autoGrowThreadNode measures natural height using height:auto technique', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain("threadNodeEl.style.height = 'auto'")
		expect(fnBody).toContain('threadNodeEl.offsetHeight')
	})

	it('autoGrowThreadNode enforces minimum height via AI_CHAT_THREAD_MIN_HEIGHT', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('AI_CHAT_THREAD_MIN_HEIGHT')
	})

	it('autoGrowThreadNode can both grow and shrink (no grow-only guard)', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		// Must use === (skip if equal) not <= (skip if smaller — grow only)
		expect(fnBody).toMatch(/naturalHeight\s*===\s*currentHeight/)
		expect(fnBody).not.toMatch(/naturalHeight\s*<=\s*currentHeight/)
	})

	it('autoGrowThreadNode calls commitCanvasStatePreservingEditors', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('commitCanvasStatePreservingEditors')
	})

	it('autoGrowThreadNode calls repositionAllThreadFloatingInputs', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('repositionAllThreadFloatingInputs')
	})

	it('onEditorChange calls scheduleThreadAutoGrow', () => {
		expect(ts).toMatch(/onEditorChange[\s\S]*?scheduleThreadAutoGrow/)
	})

	it('renderNodes schedules auto-grow for all thread nodes', () => {
		const renderMatch = ts.match(/function\s+renderNodes\(\)[\s\S]*?^    \}/m)
		expect(renderMatch).not.toBeNull()
		const renderBody = renderMatch![0]
		expect(renderBody).toContain('scheduleThreadAutoGrow')
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

	it('createAiChatThreadNode hides node when thread has no messages or is not yet loaded', () => {
		expect(ts).toMatch(/!thread\s*\|\|\s*!threadContentHasMessages/)
		expect(ts).toMatch(/threadContentHasMessages[\s\S]*?hideThreadNode/)
	})

	it('CSS hides thread nodes with data-thread-empty attribute', () => {
		const scss = loadScss()
		expect(scss).toContain('data-thread-empty')
		expect(scss).toMatch(/data-thread-empty[\s\S]*?visibility:\s*hidden/)
	})

	it('onEditorChange calls updateThreadNodeVisibility', () => {
		expect(ts).toMatch(/onEditorChange[\s\S]*?updateThreadNodeVisibility/)
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

	it('autoGrowThreadNode skips hidden threads', () => {
		const fnMatch = ts.match(/function\s+autoGrowThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('hiddenEmptyThreadNodeIds.has')
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

	it('hides .document-title via --hide-title modifier class', () => {
		expect(scss).toMatch(/\.workspace-ai-chat-thread-node--hide-title\s+\.document-title\s*\{[^}]*display:\s*none/)
	})

	it('createAiChatThreadNode adds --hide-title class based on showHeaderOnAiChatThreadNodes setting', () => {
		expect(ts).toContain('showHeaderOnAiChatThreadNodes')
		expect(ts).toContain('workspace-ai-chat-thread-node--hide-title')
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

	it('has __line child with ::before pseudo-element for the visible line', () => {
		expect(scss).toMatch(/&__line/)
		expect(scss).toMatch(/&::before/)
		expect(scss).toMatch(/--rail-width/)
		expect(scss).toMatch(/--rail-gradient/)
		expect(scss).toMatch(/--rail-thread-height/)
	})

	it('has no .is-selected visual change on __line::before (rail always looks the same)', () => {
		expect(scss).not.toMatch(/\.is-selected\s+\.workspace-thread-rail__line::before/)
	})

	it('defines __boundary-circle positioned at bottom of __line', () => {
		expect(scss).toMatch(/&__boundary-circle/)
		expect(scss).toMatch(/bottom:\s*-6px/)
	})
})

// =============================================================================
// Vertical rail — TypeScript infrastructure
// =============================================================================

describe('Vertical rail — TS infrastructure', () => {
	const ts = loadTs()

	it('defines RAIL_OFFSET from theme settings', () => {
		expect(ts).toMatch(/const\s+RAIL_OFFSET\s*=\s*webUiThemeSettings\.aiChatThreadRailOffset/)
	})

	it('defines RAIL_GRAB_WIDTH from webUiSettings', () => {
		expect(ts).toMatch(/const\s+RAIL_GRAB_WIDTH\s*=\s*webUiSettings\.aiChatThreadRailDragGrabWidth/)
	})

	it('defines threadRails Map', () => {
		expect(ts).toMatch(/const\s+threadRails:\s*Map<string,\s*HTMLElement>/)
	})

	it('defines createThreadRail function', () => {
		expect(ts).toContain('function createThreadRail(')
	})

	it('defines repositionThreadRail function', () => {
		expect(ts).toContain('function repositionThreadRail(')
	})

	it('defines destroyAllThreadRails function', () => {
		expect(ts).toContain('function destroyAllThreadRails(')
	})

	it('createAiChatThreadNode calls createThreadRail', () => {
		const fnMatch = ts.match(/function\s+createAiChatThreadNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('createThreadRail(')
	})

	it('repositionAllThreadFloatingInputs also repositions rails', () => {
		const fnMatch = ts.match(/function\s+repositionAllThreadFloatingInputs[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('repositionThreadRail(')
	})

	it('drag mousemove handler repositions the rail', () => {
		expect(ts).toContain('dragRail')
		expect(ts).toMatch(/dragRail\.style\.left/)
	})

	it('resize mousemove handler repositions the rail', () => {
		expect(ts).toContain('resizeRail')
		expect(ts).toMatch(/resizeRail\.style\.height/)
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

	it('createThreadRail creates __line child element', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('workspace-thread-rail__line')
	})

	it('createThreadRail sets z-index above all nodes to prevent overlap', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain("rail.style.zIndex = '9990'")
	})

	it('createThreadRail appends boundary circle to __line', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		expect(fnMatch![0]).toContain('workspace-thread-rail__boundary-circle')
		expect(fnMatch![0]).toContain('aiChatThreadRailBoundaryCircle')
	})

	it('createThreadRail applies theme colors to boundary circle SVG paths', () => {
		const fnMatch = ts.match(/function\s+createThreadRail[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain('aiChatThreadRailBoundaryCircleColors')
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
		expect(fnBody).toContain('workspace-thread-rail__boundary-circle')
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

	it('updateSelectionDrivenUi hides floating input for image and AI chat thread selections', () => {
		const fnMatch = ts.match(/function\s+updateSelectionDrivenUi[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]
		expect(fnBody).toContain("node.type === 'aiChatThread' || node.type === 'image'")
		expect(fnBody).toContain('hideFloatingInput')
	})

	it('bubble menu callbacks include onAskAi', () => {
		expect(ts).toContain('onAskAi')
	})

	it('onAskAi handler creates an AI chat thread and edge', () => {
		expect(ts).toMatch(/onAskAi.*async|async.*onAskAi/)
		expect(ts).toContain('createAiChatThread')
	})

	it('bubble menu callbacks include onTriggerConnection', () => {
		expect(ts).toContain('onTriggerConnection')
	})

	it('onTriggerConnection triggers connection via startConnectionFromMenu', () => {
		expect(ts).toMatch(/onTriggerConnection.*startConnectionFromMenu|startConnectionFromMenu.*onTriggerConnection/s)
	})

	it('passes onReceivingStateChange callback to ProseMirrorEditor', () => {
		expect(ts).toContain('onReceivingStateChange')
		// The callback must bridge plugin state to promptInputController
		expect(ts).toMatch(/onReceivingStateChange.*promptInputController\.setReceiving|promptInputController\.setReceiving.*onReceivingStateChange/s)
	})

	it('onReceivingStateChange calls promptInputController.setReceiving with threadId and receiving', () => {
		// Find the onReceivingStateChange callback block and verify it passes both args
		const callbackMatch = ts.match(/onReceivingStateChange:\s*\(threadId.*?receiving.*?\)\s*=>\s*\{[^}]*\}/s)
		expect(callbackMatch).not.toBeNull()
		expect(callbackMatch![0]).toContain('promptInputController.setReceiving(threadId, receiving)')
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
		expect(ts).toContain('let selectedNodeIds: Set<string> = new Set()')
		expect(ts).toContain('function setSelectedNodes(')
		expect(ts).toContain('function toggleNodeSelection(')
	})

	it('single-target UI is derived from getSingleSelectedNodeId', () => {
		expect(ts).toContain('function getSingleSelectedNodeId(): string | null')
		expect(ts).toContain('const singleSelectedNodeId = getSingleSelectedNodeId()')
		expect(ts).toContain('hideCanvasBubbleMenu()')
		expect(ts).toContain('hideFloatingInput()')
	})

	// -------------------------------------------------------------------------
	// Click interaction rules
	// -------------------------------------------------------------------------

	it('plain click on node selects the node directly without resolving anchored images to parent thread', () => {
		// The click handler must call selectNode(node.nodeId) — the original
		// node, NOT getSelectionTargetNodeId(). This ensures that clicking an
		// anchored image selects the image (showing its bubble menu), not the
		// parent thread.
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

		expect(clickHandler).toContain('selectNode(node.nodeId)')
		expect(clickHandler).not.toContain('selectNode(selectionTargetNodeId)')
		expect(clickHandler).not.toContain('selectNode(getSelectionTargetNodeId')
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

	it('Mod-click still triggers selection toggling even inside editor content', () => {
		// Mod-click must always toggle selection, so the isModSelectionEvent
		// check is in the click handler alongside the editor bypass
		const clickMatch = ts.match(/nodeEl\.addEventListener\('click',[\s\S]*?\}\)/)
		expect(clickMatch).not.toBeNull()
		const clickHandler = clickMatch![0]

		expect(clickHandler).toContain('if (isModSelectionEvent(e))')
		expect(clickHandler).toContain('toggleNodeSelection(selectionTargetNodeId)')
	})

	it('supports Mod-click selection toggling on both node click and drag overlay mousedown', () => {
		expect(ts).toContain('function isModSelectionEvent(event: MouseEvent): boolean')
		expect(ts).toContain('return event.metaKey || event.ctrlKey')
		expect(ts).toContain('toggleNodeSelection(selectionTargetNodeId)')
		expect(ts).toContain('toggleNodeSelection(resolvedNodeId)')
	})

	// -------------------------------------------------------------------------
	// Selection overlay rules
	// -------------------------------------------------------------------------

	it('tracks selection source (marquee vs click) to control overlay visibility', () => {
		// selectionIsFromMarquee flag controls whether a single-node selection
		// shows the overlay. Plain click = no overlay. Marquee = overlay.
		expect(ts).toContain('let selectionIsFromMarquee = false')
		expect(ts).toContain('return selectionIsFromMarquee')

		// setSelectedNodes accepts a fromMarquee parameter
		expect(ts).toContain('function setSelectedNodes(nextSelectedNodeIds: Set<string>, fromMarquee = false): void')
		expect(ts).toContain('selectionIsFromMarquee = fromMarquee && nextSelectedNodeIds.size > 0')
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
		expect(ts).toContain("selectionGroupOverlayEl.className = 'workspace-selection-group-overlay'")
		expect(ts).toContain('function getSelectionOverlayBounds(): Rect | null')
		expect(ts).toContain('function updateSelectionGroupOverlayElement(): void')
		expect(ts).toContain('if (!currentCanvasState || !shouldShowSelectionGroupOverlay()) return null')
		expect(ts).toContain('updateSelectionGroupOverlayElement()')
		expect(scss).toContain('.workspace-selection-group-overlay')
		expect(scss).toMatch(/\.workspace-selection-group-overlay\s*\{[^}]*z-index:\s*10000/s)
		expect(scss).toMatch(/\.workspace-selection-group-overlay\s*\{[^}]*var\(--selection-overlay-border-color/s)
		expect(scss).toMatch(/\.workspace-selection-group-overlay\s*\{[^}]*var\(--selection-overlay-background-color/s)
	})

	it('uses the selection overlay as a drag surface for the whole selected group', () => {
		expect(ts).toContain("selectionGroupOverlayEl.addEventListener('mousedown'")
		expect(ts).toContain('if (!shouldShowSelectionGroupOverlay()) return')
		expect(ts).toContain('const primaryNodeId = Array.from(selectedNodeIds)[0]')
		expect(ts).toContain('handleDragStart(event, primaryNodeId)')
	})

	it('wires selection colors from webUiThemeSettings to CSS custom properties', () => {
		expect(ts).toContain("paneEl.style.setProperty('--selection-marquee-border-color', webUiThemeSettings.selectionMarqueeBorderColor)")
		expect(ts).toContain("paneEl.style.setProperty('--selection-marquee-background-color', webUiThemeSettings.selectionMarqueeBackgroundColor)")
		expect(ts).toContain("paneEl.style.setProperty('--selection-overlay-border-color', webUiThemeSettings.selectionOverlayBorderColor)")
		expect(ts).toContain("paneEl.style.setProperty('--selection-overlay-background-color', webUiThemeSettings.selectionOverlayBackgroundColor)")
		expect(ts).toContain("paneEl.style.setProperty('--selection-outline-color', webUiThemeSettings.selectionOutlineColor)")
		expect(scss).toMatch(/var\(--selection-outline-color/)
	})

	// -------------------------------------------------------------------------
	// Marquee selection
	// -------------------------------------------------------------------------

	it('defines marquee selection helpers and pane mousedown listener', () => {
		expect(ts).toContain('type MarqueeSelectionState = {')
		expect(ts).toContain('function handlePaneMouseDown(event: MouseEvent): void')
		expect(ts).toContain("paneEl.addEventListener('mousedown', handlePaneMouseDown, true)")
		expect(ts).toContain('function ensureSelectionRectElement(): HTMLDivElement | null')
		expect(ts).toContain('function getSelectableNodeIdsInRect(rect: Rect): string[]')
	})

	it('renders and styles the marquee selection rectangle', () => {
		expect(ts).toContain("selectionRectEl.className = 'workspace-selection-rect'")
		expect(scss).toContain('.workspace-selection-rect')
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*pointer-events:\s*none/s)
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*z-index:\s*10001/s)
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*var\(--selection-marquee-border-color/s)
		expect(scss).toMatch(/\.workspace-selection-rect\s*\{[^}]*var\(--selection-marquee-background-color/s)
	})

	it('syncs viewport interaction state before first pan so selection works immediately on load', () => {
		expect(ts).toContain('function syncViewportInteractionState(viewport: Viewport): void')
		expect(ts).toContain('lastTransform = [viewport.x, viewport.y, viewport.zoom]')
		expect(ts).toContain('paneRect = paneEl.getBoundingClientRect()')
		expect(ts).toContain('syncViewportInteractionState(initialViewport)')
		expect(ts).toContain('syncViewportInteractionState(vp)')
	})

	it('treats transparent canvas children as background so marquee and outside-click clear still work', () => {
		expect(ts).toContain('function isCanvasBackgroundTarget(target: EventTarget | null): boolean')
		expect(ts).toContain('if (!isCanvasBackgroundTarget(event.target)) return')
		expect(ts).toContain('if (isCanvasBackgroundTarget(e.target)) {')
		expect(ts).toContain('selectionGroupOverlayEl?.contains(target)')
	})

	// -------------------------------------------------------------------------
	// Anchored AI image resolution
	// -------------------------------------------------------------------------

	it('maps anchored AI-chat images to parent thread for marquee and resolves inside handleDragStart', () => {
		// getSelectionTargetNodeId is used in marquee hit-testing and inside
		// handleDragStart, but NOT in the nodeEl click handler
		expect(ts).toContain('function getSelectionTargetNodeId(nodeId: string): string')
		expect(ts).toContain('const anchor = anchoredImageManager.getAnchor(nodeId)')
		expect(ts).toContain('selectedNodeIdsInRect.add(getSelectionTargetNodeId(node.nodeId))')
		expect(ts).toContain('const resolvedNodeId = getSelectionTargetNodeId(nodeId)')
	})

	it('drag overlay passes original node.nodeId (not pre-resolved) to handleDragStart', () => {
		// The drag overlay must pass the original nodeId so handleDragStart can
		// resolve it internally and also preserve the original for the click path
		expect(ts).toContain('dragOverlay.addEventListener(\'mousedown\', (e) => handleDragStart(e, node.nodeId))')
		expect(ts).not.toContain('dragOverlay.addEventListener(\'mousedown\', (e) => handleDragStart(e, getSelectionTargetNodeId(node.nodeId))')
	})

	it('treats AI chat thread floating input as part of the same selected composite', () => {
		expect(ts).toContain('function getSelectionBoundsForNode(node: CanvasNode): Rect')
		expect(ts).toContain('const threadFloatingInput = threadFloatingInputs.get(node.nodeId)')
		expect(ts).toContain('const inputTop = position.y + getThreadTopOffset(node.nodeId, dimensions.height)')
		expect(ts).toContain('const inputWidth = threadFloatingInput.el.offsetWidth || dimensions.width')
		expect(ts).toContain('const inputHeight = threadFloatingInput.el.offsetHeight')
		expect(ts).toContain('rectsOverlap(rect, getSelectionBoundsForNode(node))')
		expect(ts).toContain("threadFloatingInputs.get(nodeId)?.el.classList.add('is-selected')")
		expect(ts).toContain("threadFloatingInputs.get(nodeId)?.el.classList.remove('is-selected')")
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
		expect(fnBody).toContain('rectsOverlap(rect, getSelectionBoundsForNode(node))')
	})

	it('includes anchored AI images when computing the selection overlay bounds', () => {
		expect(ts).toContain('for (const anchor of anchoredImageManager.getAnchorsForThread(nodeId)) {')
		expect(ts).toContain('overlayNodeIds.add(anchor.imageNodeId)')
		expect(ts).toContain('const rect = getSelectionBoundsForNode(node)')
	})

	// -------------------------------------------------------------------------
	// Deferred selection in handleDragStart (regression: overlay stealing clicks)
	// -------------------------------------------------------------------------

	it('defers selection in handleDragStart so the overlay does not steal mouseup from anchored images', () => {
		// REGRESSION GUARD: the selection overlay (z-index 10000) must not
		// appear between mousedown and mouseup when clicking an anchored image.
		// If selectNode(resolvedNodeId) ran on mousedown, the overlay would
		// appear instantly and intercept mouseup, preventing the image from
		// being selected and its bubble menu from appearing.
		const fnMatch = ts.match(/function\s+handleDragStart[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		// Selection must NOT happen unconditionally on mousedown — it is deferred
		// behind wasAlreadySelected and dragDidMove guards
		expect(fnBody).toContain('const wasAlreadySelected = isNodeSelected(resolvedNodeId)')
		expect(fnBody).not.toMatch(/if \(!isNodeSelected\(resolvedNodeId\)\) \{\s*\n\s*selectNode\(resolvedNodeId\)/)

		// On first meaningful mouse movement → select the resolved (thread) node for drag
		expect(fnBody).toContain('if (!wasAlreadySelected) {')
		expect(fnBody).toContain('selectNode(resolvedNodeId)')

		// On mouseup without movement (click) → select the original nodeId
		// so clicking an anchored image selects the image, not the thread
		expect(fnBody).toContain('selectNode(nodeId)')
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
		expect(ts).toContain('function getDraggableNodeIds(primaryNodeId: string): string[]')
		expect(ts).toContain('const draggedNodeIds = getDraggableNodeIds(resolvedNodeId)')
		expect(ts).toContain('const draggedNodeEntries = new Map<string, {')
		expect(ts).toContain('for (const [draggedNodeId, entry] of draggedNodeEntries)')
	})

	it('preserves multi-selection after drag by suppressing the follow-up click collapse', () => {
		expect(ts).toContain('let suppressNextNodeClick = false')
		expect(ts).toContain('if (suppressNextNodeClick) {')
		expect(ts).toContain('if (dragDidMove) {')
		expect(ts).toContain('suppressNextNodeClick = true')
	})

	it('group drag skips collision resolution for multi-node moves to preserve rigid spacing', () => {
		expect(ts).toContain('if (draggedNodeEntries.size === 1) {')
		expect(ts).toContain('resolveCollisions(nodeBoxes')
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
		// Invariant: shouldShowSelectionGroupOverlay must NOT check node.type
		const fnMatch = ts.match(/function\s+shouldShowSelectionGroupOverlay[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).not.toContain("'aiChatThread'")
		expect(fnBody).not.toContain('node.type')
		// Must not look up individual node objects to check their type
		expect(fnBody).not.toContain('getNode(')
		expect(fnBody).not.toContain('.nodes.find')
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

	it('REGRESSION: clicking anchored image must select the IMAGE (not parent thread)', () => {
		// Root cause: nodeEl click handler called
		// selectNode(getSelectionTargetNodeId(node.nodeId)) which resolved
		// anchored images to their parent thread. This meant clicking an
		// anchored image selected the thread instead, and the image bubble
		// menu never appeared.
		//
		// Invariant: click handler must call selectNode(node.nodeId) with
		// the original nodeId, never pre-resolving through
		// getSelectionTargetNodeId
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
		expect(ts).toContain("dragOverlay.addEventListener('mousedown', (e) => handleDragStart(e, node.nodeId))")
		expect(ts).not.toContain("dragOverlay.addEventListener('mousedown', (e) => handleDragStart(e, getSelectionTargetNodeId(node.nodeId))")
	})

	it('REGRESSION: handleDragStart must NOT select on mousedown (deferred selection)', () => {
		// Root cause: handleDragStart immediately called selectNode(resolvedNodeId)
		// on mousedown. For anchored images, resolvedNodeId = parent thread.
		// Selecting the thread caused shouldShowSelectionGroupOverlay to return
		// true (AI chat thread special case), showing the overlay at z-index 10000.
		// The overlay intercepted mouseup, so the image click handler never fired,
		// preventing bubble menu from appearing.
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
		expect(ts).toContain('return selectionIsFromMarquee')

		// The marquee handler must pass fromMarquee=true
		const paneMouseDownMatch = ts.match(/function\s+handlePaneMouseDown[\s\S]*?^    \}/m)
		expect(paneMouseDownMatch).not.toBeNull()
		expect(paneMouseDownMatch![0]).toContain(', true)')
	})
})

// =============================================================================
// Image loading — canonical URL from workspaceId + fileId
// =============================================================================

describe('Image loading — canonical URL construction', () => {
	const ts = loadTs()

	it('createImageNode builds canonicalPath from workspaceId and node.fileId, not from node.src', () => {
		const fnMatch = ts.match(/function\s+createImageNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		expect(fnBody).toContain('`/api/images/${workspaceId}/${node.fileId}`')
		expect(fnBody).not.toContain('node.src.replace')
	})

	it('createImageNode uses canonicalPath (not rawSrc) in both initial load and retry', () => {
		const fnMatch = ts.match(/function\s+createImageNode[\s\S]*?^    \}/m)
		expect(fnMatch).not.toBeNull()
		const fnBody = fnMatch![0]

		const canonicalRefs = (fnBody.match(/canonicalPath/g) || []).length
		expect(canonicalRefs).toBeGreaterThanOrEqual(2)
		expect(fnBody).not.toContain('rawSrc')
	})

	it('workspaceId is declared as let (mutable) so render() can update it', () => {
		expect(ts).toMatch(/let\s+workspaceId\s*=\s*options\.workspaceId/)
	})

	it('render() accepts optional newWorkspaceId parameter and updates workspaceId', () => {
		expect(ts).toMatch(/render\(.*newWorkspaceId\?: string/)
		expect(ts).toContain('if (newWorkspaceId) workspaceId = newWorkspaceId')
	})
})

// =============================================================================
// Image error placeholder — uses brokenImageIcon from svgIcons
// =============================================================================

describe('Image error placeholder — SVG icon from svgIcons', () => {
	const ts = loadTs()

	it('imports brokenImageIcon from svgIcons', () => {
		expect(ts).toContain('brokenImageIcon')
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
		expect(ts).toContain('`${apiBaseUrl}${imageUrl}')
	})

	it('appends token as query param for API URLs', () => {
		expect(ts).toContain('`?token=${token}`')
	})
})
