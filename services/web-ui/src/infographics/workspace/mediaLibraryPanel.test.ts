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

describe('Media Library panel contract', () => {
    it('presents clear content modes with a compact scope selector', () => {
        expectSourceToContain(panelSource, 'Media Library')
        expectSourceToContain(panelSource, "{ key: MEDIA_LIBRARY_CATEGORY.FEATURES, label: 'Features' }")
        expectSourceToContain(panelSource, "{ key: MEDIA_LIBRARY_CATEGORY.IMAGES, label: 'Images' }")
        expectSourceToContain(panelSource, "{ key: MEDIA_LIBRARY_BROWSE_ALL, label: 'All available' }")
        expectSourceToContain(panelSource, 'media-library-scope-select')
        expectSourceToContain(panelSource, 'role="tablist"')
        expectSourceNotToContain(panelSource, 'media-library-filter-tabs')
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

    it('uses the shared close icon and non-shifting card feedback', () => {
        expectSourceToContain(panelSource, "import { xIcon } from '$src/svgIcons/index.ts'")
        expectSourceToContain(panelSource, 'media-library-header-close-icon')
        expectSourceToContain(panelStyles, '.feature-library-row:hover')
        expectSourceToContain(panelStyles, 'transform: none;')
        expectSourceToContain(panelStyles, 'box-shadow: inset 0 0 0 1px')
    })

    it('uses a full-height panel, accounts for the right side panel, and focuses details when narrow', () => {
        expectSourceToContain(panelStyles, 'top: 0;')
        expectSourceToContain(panelStyles, 'bottom: 0;')
        expectSourceToContain(panelStyles, 'right: 0;')
        expectSourceToContain(panelStyles, 'var(--media-library-panel-fraction, 0.666667)')
        expectSourceToContain(panelStyles, '.workspace-canvas-right-side-panel-open .media-library-panel')
        expectSourceToContain(panelStyles, 'var(--workspace-right-side-panel-width)')
        expectSourceToContain(panelStyles, '@container media-library (max-width: 680px)')
        expectSourceToContain(panelStyles, '.media-library-panel-feature-selected .media-library-inspector')
    })

    it('places the Media Library trigger in the right-side circular action panel', () => {
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
        expectSourceToContain(workspaceSvelteSource, '/api/images/${targetWorkspaceId}/import-url')
        expectSourceToContain(workspaceSvelteSource, 'addImageToCanvas({ fileId: data.fileId, src: imageUrl, targetWorkspaceId })')
    })

    it('imports remote images with the current workspace target and encoded auth token', () => {
        expectSourceToContain(workspaceSvelteSource, 'const targetWorkspaceId = workspaceId')
        expectSourceToContain(workspaceSvelteSource, 'fetch(`${API_BASE_URL}/api/images/${targetWorkspaceId}/import-url`, {')
        expectSourceToContain(workspaceSvelteSource, "'Authorization': `Bearer ${token}`")
        expectSourceToContain(workspaceSvelteSource, 'const imageUrl = `${API_BASE_URL}${data.url}?token=${encodeURIComponent(token)}`')
        expectSourceToContain(workspaceSvelteSource, 'if (workspaceId !== targetWorkspaceId || loadedWorkspaceId !== targetWorkspaceId) return')
    })
})
