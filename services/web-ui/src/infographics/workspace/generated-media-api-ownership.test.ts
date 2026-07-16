'use strict'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')

function getFunctionBody(name: string, endMarker: string): string {
    const start = source.indexOf(`function ${name}(`)
    const end = source.indexOf(endMarker, start)
    expect(start, `${name} should exist`).toBeGreaterThan(-1)
    expect(end, `${name} should end before ${endMarker}`).toBeGreaterThan(start)
    return source.slice(start, end)
}

function getExcerpt(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    expect(start, `${startMarker} should exist`).toBeGreaterThan(-1)
    expect(end, `${endMarker} should follow ${startMarker}`).toBeGreaterThan(start)
    return source.slice(start, end)
}

function expectSourceToContain(value: string, snippet: string, label: string): void {
    expect(value.includes(snippet), `${label} should contain:\n${snippet}`).toBe(true)
}

function expectSourceNotToContain(value: string, snippet: string, label: string): void {
    expect(value.includes(snippet), `${label} should not contain:\n${snippet}`).toBe(false)
}

describe('generated-media API ownership', () => {
    it('does not promote a preserved regeneration marker through browser-side pending-marker geometry', () => {
        const handler = getFunctionBody('applyMediaBranchLineagePlan', 'function resolvePendingBranchMarkersForLineagePlan')
        const regenerationTargetIndex = handler.indexOf('if (lineagePlan.regenerationTarget)')
        const insertIndex = handler.indexOf('insertPendingBranchMarkersFromLineagePlan(threadId, lineagePlan, generationRun)')

        expect(regenerationTargetIndex).toBeGreaterThan(-1)
        expect(insertIndex).toBeGreaterThan(regenerationTargetIndex)
        expectSourceToContain(handler, 'resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)', 'regeneration lineage handler')
        expectSourceToContain(handler, 'return', 'regeneration lineage handler')
    })

    it('uses the API-declared regeneration target as the only pending UI marker', () => {
        const handler = getFunctionBody('resolvePendingBranchMarkerWithLineagePlan', 'function getLineageAssignmentMediaModelIds')

        expectSourceToContain(handler, 'const regenerationTarget = lineagePlan?.regenerationTarget', 'pending-marker resolver')
        expectSourceToContain(handler, 'node.nodeId === regenerationTarget.lineageParentNodeId', 'pending-marker resolver')
        expectSourceToContain(handler, "branchMarkerUiPhaseByNodeId.set(markerNode.nodeId, 'planned-awaiting-media')", 'pending-marker resolver')
        expectSourceNotToContain(handler, 'preserveCommittedNode', 'pending-marker resolver')
    })

    it('requires API geometry for video placeholders and never locally creates or balances them', () => {
        const handler = getExcerpt('onVideoPendingToCanvas: (data) =>', 'onVideoGeneratingToCanvas:')

        expectSourceToContain(handler, 'missing video pending geometry; refusing local canvas topology mutation', 'video pending handler')
        expectSourceToContain(handler, 'applyApiCanvasGeometry(canvasGeometry)', 'video pending handler')
        expectSourceToContain(handler, 'rememberVideoGenerationTrackerForNode(threadId, generationRun, videoNode)', 'video pending handler')
        expectSourceNotToContain(handler, 'getNextGeneratedMediaPosition(', 'video pending handler')
        expectSourceNotToContain(handler, 'rebalanceGeneratedMediaTrees(', 'video pending handler')
        expectSourceNotToContain(handler, 'commitTransientCanvasStatePreservingEditors(', 'video pending handler')
    })

    it('clears the preserved marker phase by its API lineage parent when the replay settles', () => {
        const handler = getFunctionBody('getBranchMarkerUiPhaseNodeIdsForRun', '// Overwrite-only:')

        expectSourceToContain(handler, 'assignment?.lineageParentNodeId', 'branch-marker phase lookup')
        expectSourceToContain(source, 'function clearBranchMarkerUiPhasesForRun', 'workspace canvas')
        expectSourceToContain(source, 'clearBranchMarkerUiPhasesForRun(threadId, generationRun)', 'workspace canvas')
    })

    it('does not use blocking browser alert dialogs in runtime canvas code', () => {
        expectSourceNotToContain(source, 'alert(', 'workspace canvas')
    })
})
