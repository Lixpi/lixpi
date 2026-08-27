'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { formatMediaFileSize, stripMediaFileExtension } from './mediaLibraryPanel.ts'

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
const WORKSPACE_IMPORT_FINALIZE_SNIPPET = 'await addAssetToCanvas(data, targetWorkspaceId, placeholderNodeId)'

describe('Media Library panel contract', () => {
    it('is an embedded renderer the right side panel hosts, not a standalone drawer', () => {
        expectSourceToContain(panelSource, 'media-library-panel-embedded')
        expectSourceToContain(panelSource, 'mountInto(hostEl: HTMLElement): void')
        // No browse-scope filter control — the panel always shows everything available.
        expectSourceNotToContain(panelSource, 'media-library-scope-select')
        // No standalone modal chrome, category tab strip, or backdrop.
        expectSourceNotToContain(panelSource, 'MEDIA_LIBRARY_CATEGORY')
        expectSourceNotToContain(panelSource, 'media-library-category-tabs')
        expectSourceNotToContain(panelSource, 'media-library-backdrop')
        expectSourceNotToContain(panelSource, 'role="tablist"')
    })

    it('loads cataloged Assets and excludes conversation and Artifact records', () => {
        expectSourceToContain(panelSource, 'workspaceId: this.options.workspaceId,')
        expectSourceToContain(panelSource, 'limit: 100,')
        expectSourceToContain(panelSource, "asset.primaryCategory !== 'conversation' && asset.primaryCategory !== 'capabilityArtifact'")
        expectSourceToContain(panelSource, 'for (const asset of this.allAssets)')
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

    it('keeps browsing rows concise while retaining complete inspector details', () => {
        expectSourceToContain(panelSource, 'media-library-browser-intro')
        expectSourceToContain(panelSource, 'media-library-panel-images')
        expectSourceToContain(panelSource, 'capability-library-section-items')
        expectSourceToContain(panelSource, 'capability-library-row-thumb')
        expectSourceToContain(panelSource, 'capability-library-row-use')
        expectSourceNotToContain(panelSource, 'media-library-item-thumb')
        expectSourceNotToContain(panelSource, 'media-library-item-info')
        expectSourceNotToContain(panelStyles, '.media-library-item-thumb')
        expectSourceNotToContain(panelStyles, '.media-library-item-info')
        expectSourceToContain(panelSource, 'private buildAssetInspector(asset: Asset): HTMLElement')
        expectSourceToContain(panelSource, 'private async mountAssetDocuments')
        expectSourceToContain(panelSource, "role: 'provenance'")
    })

    it('formats media names and byte sizes consistently', () => {
        expect(stripMediaFileExtension('reference.image.png')).toBe('reference.image')
        expect(stripMediaFileExtension('untitled')).toBe('untitled')
        expect(formatMediaFileSize(512)).toBe('1 KB')
        expect(formatMediaFileSize(1024 * 1024)).toBe('1.0 MB')
    })

    it('hosts the embedded library so it fills the right side panel body', () => {
        expectSourceToContain(panelStyles, '.workspace-right-panel-media-host .media-library-panel')
        expectSourceToContain(panelStyles, '@container media-library (min-width: 680px)')
        expectSourceToContain(panelStyles, '.media-library-panel-images .media-library-body')
        expectSourceToContain(panelStyles, '.media-library-panel-images .media-library-inspector')
    })

    it('drives the right side panel surface from the four top-level modes', () => {
        expectSourceToContain(canvasSource, 'createSlidingSwitch<CanvasRightSidePanelMode>')
        expectSourceToContain(canvasSource, 'workspace-right-panel-mode-switch')
        expectSourceToContain(canvasSource, "{ label: 'Capabilities', value: 'capabilities' }")
        expectSourceToContain(canvasSource, "{ label: 'Artifacts', value: 'artifacts' }")
        expectSourceToContain(canvasSource, "{ label: 'Media', value: 'media' }")
        expectSourceToContain(canvasSource, "{ label: 'AI Threads', value: 'aiThreads' }")
        expectSourceToContain(canvasSource, 'function openRightSidePanelToMode')
        expectSourceToContain(canvasSource, 'ensureCapabilityLibraryPanel()')
    })

    it('keeps the Media Library trigger in the left-side circular action panel', () => {
        expectSourceToContain(
            workspaceSvelteSource,
            'workspace-canvas-action-panel workspace-canvas-media-library-panel workspace-canvas-action-panel-single',
        )
        expectSourceToContain(workspaceSvelteSource, 'workspace-zoom-indicator')
        expectSourceNotToContain(workspaceSvelteSource, 'workspace-canvas-utility-capsule')
        const leftRail = workspaceSvelteSource.slice(
            workspaceSvelteSource.indexOf('workspace-canvas-left-control-rail'),
            workspaceSvelteSource.indexOf('workspace-canvas-right-control-rail'),
        )
        const rightRail = workspaceSvelteSource.slice(
            workspaceSvelteSource.indexOf('workspace-canvas-right-control-rail'),
            workspaceSvelteSource.indexOf('<input'),
        )
        expectSourceToContain(leftRail, 'handleToggleMediaLibrary')
        expectSourceNotToContain(rightRail, 'handleToggleMediaLibrary')
    })

    it('inserts catalog Assets through the existing centered insertion path', () => {
        expectSourceToContain(canvasSource, 'onInsertAsset: async (item: AssetMeta) => {')
        expectSourceToContain(canvasSource, 'insertNodeAtViewportCenterInternal(insertion, {}, false)')
        expectSourceToContain(canvasSource, 'await onAssetAttach({ assetId: item.assetId, nodeId, canvasState: nextState })')
        expectSourceToContain(workspaceSvelteSource, 'await addAssetToCanvas(data, targetWorkspaceId, placeholderNodeId)')
    })

    it('imports remote images with the current workspace target and encoded auth token', () => {
        expectSourceToContain(workspaceSvelteSource, "const targetWorkspaceId = workspaceId")
        expectSourceToContain(workspaceSvelteSource, "fetch(`${API_BASE_URL}/api/assets/workspaces/${targetWorkspaceId}/import-url`, {")
        expectSourceToContain(workspaceSvelteSource, "'Authorization': `Bearer ${token}`")
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
