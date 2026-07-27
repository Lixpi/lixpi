'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const panelSource = readFileSync(resolve(__dirname, 'artifactLibraryPanel.ts'), 'utf-8')
const canvasSource = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')

describe('Artifact Library panel contract', () => {
    it('is generic and delegates views by registered artifactTypeId', () => {
        expect(panelSource).toContain("primaryCategory: 'capabilityArtifact'")
        expect(panelSource).toContain('capabilityArtifactSharedRegistry.get')
        expect(panelSource).toContain('definition.buildCatalogMetadata(snapshot.doc)')
        expect(panelSource).toContain('createLibraryItemView')
        expect(panelSource).toContain('createGeneratedOutputInfoView')
        expect(panelSource).not.toContain("artifactTypeId === 'action-timeline'")
    })

    it('supports attach, scope, review, and sealed generation history', () => {
        expect(panelSource).toContain('onInsertAsset')
        expect(panelSource).toContain('onAcceptAsset')
        expect(panelSource).toContain('changeScope')
        expect(panelSource).toContain("role: 'provenance'")
        expect(canvasSource).toContain("topLevelMode === 'artifacts'")
        expect(canvasSource).toContain("type: 'capabilityArtifact'")
    })
})
