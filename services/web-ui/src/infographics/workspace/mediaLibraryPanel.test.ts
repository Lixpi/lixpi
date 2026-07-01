'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

function expectSourceToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should contain: ${snippet}`).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string): void {
    expect(source.includes(snippet), `source should not contain: ${snippet}`).toBe(false)
}

const panelSource = readFileSync(resolve(__dirname, 'mediaLibraryPanel.ts'), 'utf-8')
const panelStyles = readFileSync(resolve(__dirname, 'media-library-panel.scss'), 'utf-8')
const canvasSource = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')
const workspaceSvelteSource = readFileSync(resolve(__dirname, '../../components/WorkspaceCanvas.svelte'), 'utf-8')
const WORKSPACE_IMPORT_GUARD_SNIPPET =
    'if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return'
const WORKSPACE_IMPORT_FINALIZE_SNIPPET = 'await finalizeIngest(data, token, targetWorkspaceId, placeholderNodeId)'

describe('Media Library panel contract', () => {
    it('is an embedded renderer the right side panel hosts, not a standalone drawer', () => {
        expectSourceToContain(panelSource, 'media-library-panel-embedded')
        expectSourceToContain(panelSource, 'function mountInto')
        expectSourceToContain(panelSource, 'function setMode')
        // No browse-scope filter control — the panel always shows everything available.
        expectSourceNotToContain(panelSource, 'media-library-scope-select')
        // No standalone modal chrome, category tab strip, or backdrop.
        expectSourceNotToContain(panelSource, 'MEDIA_LIBRARY_CATEGORY')
        expectSourceNotToContain(panelSource, 'media-library-category-tabs')
        expectSourceNotToContain(panelSource, 'media-library-backdrop')
        expectSourceNotToContain(panelSource, 'role="tablist"')
    })

    it('colocates saved images and videos under the Media surface', () => {
        expectSourceToContain(panelSource, "mode === 'media'")
        expectSourceToContain(panelSource, 'function loadMedia')
        expectSourceToContain(panelSource, 'media-library-media-group-title')
        expectSourceToContain(panelSource, 'renderImages(browserEl)')
        expectSourceToContain(panelSource, 'renderVideos(browserEl)')
    })

    it('removes the Extract-new button and its color entirely', () => {
        expectSourceNotToContain(panelSource, 'Extract new')
        expectSourceNotToContain(panelSource, 'media-library-footer-new-btn')
        expectSourceNotToContain(panelSource, 'onOpenExtractionTab')
        expectSourceNotToContain(panelStyles, 'media-library-footer-new-btn')
        // The deprecated "Create new element button" green must never reappear.
        expectSourceNotToContain(panelStyles, '85, 150, 124')
        expectSourceNotToContain(panelStyles, '#55967c')
    })

    it('keeps browsing cards concise while retaining complete inspector details', () => {
        expectSourceToContain(panelSource, 'feature-library-inspector-card')
        expectSourceToContain(panelSource, 'media-library-browser-intro')
        expectSourceToContain(panelSource, 'renderMarkdownStatic(feature.instructions')
        expectSourceToContain(panelSource, 'for (const tag of tags)')
        expectSourceNotToContain(panelSource, 'feature.instructions.slice')
        expectSourceToContain(panelStyles, '-webkit-line-clamp: 2')
    })

    it('retains source sample previews and falls back to the durable authorized sample route', () => {
        expectSourceToContain(panelSource, 'function getStoredSampleUrl')
        expectSourceToContain(panelSource, '/api/features/${feature.featureId}/samples/${sampleIndex}')
        expect(panelSource.indexOf('if (featureSample?.imageUrl)')).toBeLessThan(panelSource.indexOf('return getStoredSampleUrl(feature, sampleIndex)'))
        expectSourceToContain(panelSource, 'imageEl.src = getStoredSampleUrl(feature, sampleIndex)')
    })

    it('hosts the embedded library so it fills the right side panel body', () => {
        expectSourceToContain(panelStyles, '.workspace-right-panel-media-host .media-library-panel')
        expectSourceToContain(panelStyles, '@container media-library (max-width: 680px)')
        expectSourceToContain(panelStyles, '.media-library-panel-feature-selected .media-library-inspector')
    })

    it('drives the right side panel surface from a top-level Features / Media / AI Threads switch', () => {
        expectSourceToContain(canvasSource, 'createSlidingSwitch<CanvasRightSidePanelMode>')
        expectSourceToContain(canvasSource, 'workspace-right-panel-mode-switch')
        expectSourceToContain(canvasSource, "{ label: 'Features', value: 'features' }")
        expectSourceToContain(canvasSource, "{ label: 'Media', value: 'media' }")
        expectSourceToContain(canvasSource, "{ label: 'AI Threads', value: 'aiThreads' }")
        expectSourceToContain(canvasSource, 'function openRightSidePanelToMode')
    })

    it('keeps the Media Library trigger in the right-side circular action panel', () => {
        expectSourceToContain(workspaceSvelteSource, 'workspace-canvas-action-panel-right workspace-canvas-action-panel-single')
        expectSourceToContain(workspaceSvelteSource, 'workspace-zoom-indicator')
        expectSourceNotToContain(workspaceSvelteSource, 'workspace-canvas-utility-capsule')
        const leftPanel = workspaceSvelteSource.slice(
            workspaceSvelteSource.indexOf('workspace-canvas-action-panel-left'),
            workspaceSvelteSource.indexOf('workspace-canvas-action-panel-right'),
        )
        expectSourceNotToContain(leftPanel, 'handleToggleMediaLibrary')
    })

    it('restores saved images through materialization and the existing centered insertion path', () => {
        expectSourceToContain(canvasSource, 'mediaLibraryService.materializeImage')
        expectSourceToContain(canvasSource, 'insertNodeAtViewportCenterInternal(imageNode)')
        expectSourceToContain(canvasSource, "type: 'image'")
        expectSourceToContain(workspaceSvelteSource, '/api/files/${targetWorkspaceId}/import-url')
        expectSourceToContain(workspaceSvelteSource, 'insertNodeAtViewportCenter(imageNode)')
    })

    it('imports remote images with the current workspace target and encoded auth token', () => {
        expectSourceToContain(workspaceSvelteSource, "const targetWorkspaceId = workspaceId")
        expectSourceToContain(workspaceSvelteSource, "fetch(`${API_BASE_URL}/api/files/${targetWorkspaceId}/import-url`, {")
        expectSourceToContain(workspaceSvelteSource, "'Authorization': `Bearer ${token}`")
        expectSourceToContain(workspaceSvelteSource, 'const src = tokenizeUrl(result.url, token)')
        expectSourceToContain(workspaceSvelteSource, WORKSPACE_IMPORT_FINALIZE_SNIPPET)
        expectSourceToContain(
            workspaceSvelteSource,
            WORKSPACE_IMPORT_GUARD_SNIPPET,
        )
    })

    it('bails out early if the workspace context changed while importing a remote media sample', () => {
        const guardIndex = workspaceSvelteSource.indexOf(WORKSPACE_IMPORT_GUARD_SNIPPET)
        const finalizeIndex = workspaceSvelteSource.indexOf(WORKSPACE_IMPORT_FINALIZE_SNIPPET)

        expect(guardIndex, 'stale-workspace guard should be present').toBeGreaterThan(-1)
        expect(finalizeIndex, 'import finalize call should be present').toBeGreaterThan(-1)
        expect(finalizeIndex).toBeGreaterThan(guardIndex)
    })
})
