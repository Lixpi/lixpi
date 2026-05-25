'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const panelSource = readFileSync(resolve(__dirname, 'mediaLibraryPanel.ts'), 'utf-8')
const panelStyles = readFileSync(resolve(__dirname, 'media-library-panel.scss'), 'utf-8')
const canvasSource = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')
const workspaceSvelteSource = readFileSync(resolve(__dirname, '../../components/WorkspaceCanvas.svelte'), 'utf-8')

describe('Media Library panel contract', () => {
    it('presents clear content modes with a compact scope selector', () => {
        expect(panelSource).toContain('Media Library')
        expect(panelSource).toContain("{ key: MEDIA_LIBRARY_CATEGORY.FEATURES, label: 'Features' }")
        expect(panelSource).toContain("{ key: MEDIA_LIBRARY_CATEGORY.IMAGES, label: 'Images' }")
        expect(panelSource).toContain("{ key: MEDIA_LIBRARY_BROWSE_ALL, label: 'All available' }")
        expect(panelSource).toContain('media-library-scope-select')
        expect(panelSource).toContain('role="tablist"')
        expect(panelSource).not.toContain('media-library-filter-tabs')
    })

    it('keeps browsing cards concise while retaining complete inspector details', () => {
        expect(panelSource).toContain('feature-library-inspector-card')
        expect(panelSource).toContain('media-library-browser-intro')
        expect(panelSource).toContain('renderMarkdownStatic(feature.instructions')
        expect(panelSource).toContain('for (const tag of tags)')
        expect(panelSource).not.toContain('feature.instructions.slice')
        expect(panelStyles).toContain('-webkit-line-clamp: 2')
    })

    it('retains source sample previews and falls back to the durable authorized sample route', () => {
        expect(panelSource).toContain('function getStoredSampleUrl')
        expect(panelSource).toContain('/api/features/${feature.featureId}/samples/${sampleIndex}')
        expect(panelSource.indexOf('if (featureSample?.imageUrl)')).toBeLessThan(panelSource.indexOf('return getStoredSampleUrl(feature, sampleIndex)'))
        expect(panelSource).toContain('imageEl.src = getStoredSampleUrl(feature, sampleIndex)')
    })

    it('uses the shared close icon and non-shifting card feedback', () => {
        expect(panelSource).toContain("import { xIcon } from '$src/svgIcons/index.ts'")
        expect(panelSource).toContain('media-library-header-close-icon')
        expect(panelStyles).toContain('.feature-library-row:hover')
        expect(panelStyles).toContain('transform: none;')
        expect(panelStyles).toContain('box-shadow: inset 0 0 0 1px')
    })

    it('uses a full-height panel, accounts for AI chat, and focuses details when narrow', () => {
        expect(panelStyles).toContain('top: 0;')
        expect(panelStyles).toContain('bottom: 0;')
        expect(panelStyles).toContain('right: 0;')
        expect(panelStyles).toContain('var(--media-library-panel-fraction, 0.666667)')
        expect(panelStyles).toContain('.workspace-canvas-chat-panel-open .media-library-panel')
        expect(panelStyles).toContain('var(--workspace-ai-chat-sidebar-width)')
        expect(panelStyles).toContain('@container media-library (max-width: 680px)')
        expect(panelStyles).toContain('.media-library-panel-feature-selected .media-library-inspector')
    })

    it('places an independent Media Library trigger above the standalone zoom indicator', () => {
        expect(workspaceSvelteSource).toContain('workspace-media-library-launcher')
        expect(workspaceSvelteSource).toContain('workspace-zoom-indicator')
        expect(workspaceSvelteSource).not.toContain('workspace-canvas-utility-capsule')
        const leftToolbar = workspaceSvelteSource.slice(
            workspaceSvelteSource.indexOf('<div class="workspace-floating-toolbar">'),
            workspaceSvelteSource.indexOf('<button class="workspace-media-library-launcher"'),
        )
        expect(leftToolbar).not.toContain('handleToggleMediaLibrary')
    })

    it('restores saved images through materialization and the existing centered insertion path', () => {
        expect(canvasSource).toContain('mediaLibraryService.materializeImage')
        expect(canvasSource).toContain('insertNodeAtViewportCenterInternal(imageNode)')
        expect(canvasSource).toContain("type: 'image'")
        expect(workspaceSvelteSource).toContain('/api/images/${workspaceId}/import-url')
        expect(workspaceSvelteSource).toContain('addImageToCanvas({ fileId: data.fileId, src: imageUrl })')
    })
})
