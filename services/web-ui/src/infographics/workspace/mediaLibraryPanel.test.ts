'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const panelSource = readFileSync(resolve(__dirname, 'mediaLibraryPanel.ts'), 'utf-8')
const panelStyles = readFileSync(resolve(__dirname, 'media-library-panel.scss'), 'utf-8')
const canvasSource = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')
const workspaceSvelteSource = readFileSync(resolve(__dirname, '../../components/WorkspaceCanvas.svelte'), 'utf-8')

describe('Media Library panel contract', () => {
    it('presents generic categories and explicit scope filters', () => {
        expect(panelSource).toContain('Media Library')
        expect(panelSource).toContain("{ key: MEDIA_LIBRARY_CATEGORY.FEATURES, label: 'Features' }")
        expect(panelSource).toContain("{ key: MEDIA_LIBRARY_CATEGORY.IMAGES, label: 'Images' }")
        expect(panelSource).toContain("{ key: MEDIA_LIBRARY_BROWSE_ALL, label: 'All available' }")
        expect(panelSource).toContain('...SCOPES')
    })

    it('does not truncate feature instructions or tags', () => {
        // Instructions render through the unified markdown stream renderer, untruncated.
        expect(panelSource).toContain('renderMarkdownStatic(feature.instructions')
        expect(panelSource).toContain('for (const tag of feature.tags ?? [])')
        expect(panelSource).not.toContain('feature.instructions.slice')
        expect(panelSource).not.toContain('feature.tags?.slice')
        expect(panelStyles).not.toContain('text-overflow: ellipsis')
        expect(panelStyles).not.toContain('-webkit-line-clamp')
    })

    it('positions a large panel from the right and accounts for AI chat', () => {
        expect(panelStyles).toContain('right: var(--media-library-panel-edge-gap, 15px);')
        expect(panelStyles).toContain('var(--media-library-panel-fraction, 0.666667)')
        expect(panelStyles).toContain('.workspace-canvas-chat-panel-open .media-library-panel')
        expect(panelStyles).toContain('var(--workspace-ai-chat-sidebar-width)')
    })

    it('restores saved images through materialization and the existing centered insertion path', () => {
        expect(canvasSource).toContain('mediaLibraryService.materializeImage')
        expect(canvasSource).toContain('insertNodeAtViewportCenterInternal(imageNode)')
        expect(canvasSource).toContain("type: 'image'")
        expect(workspaceSvelteSource).toContain('/api/images/${workspaceId}/import-url')
        expect(workspaceSvelteSource).toContain('addImageToCanvas({ fileId: data.fileId, src: imageUrl })')
    })
})
