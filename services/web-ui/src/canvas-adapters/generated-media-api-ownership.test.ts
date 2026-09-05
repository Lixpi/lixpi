import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.ts'), 'utf-8')

function getFunctionBody(name: string, endMarker: string): string {
    const start = source.indexOf(`private ${name} = (`)
    const end = source.indexOf(endMarker, start)
    expect(start, `${name} should exist`).toBeGreaterThan(-1)
    expect(end, `${name} should end before ${endMarker}`).toBeGreaterThan(start)
    return source.slice(start, end)
}

function getExcerpt(startMarker: string, endMarker: string): string {
    const source = readFileSync(resolve(import.meta.dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/media/workspace-generation-handlers.ts'), 'utf-8')
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    expect(start, `${startMarker} should exist`).toBeGreaterThan(-1)
    expect(end, `${endMarker} should follow ${startMarker}`).toBeGreaterThan(start)
    return source.slice(start, end)
}

// These assertions pin down what the source does, not how the formatter lays it out.
// Line breaks and trailing commas are the formatter's choice and change nothing about
// the behavior, so both sides are compared on tokens alone.
const withoutLayout = (value: string): string => value
    .replace(/\s+/g, '')
    .replace(/,(?=[)\]}])/g, '')
    .replace(/,$/, '')

function expectSourceToContain(value: string, snippet: string, label: string): void {
    expect(withoutLayout(value).includes(withoutLayout(snippet)), `${label} should contain:\n${snippet}`).toBe(true)
}

function expectSourceNotToContain(value: string, snippet: string, label: string): void {
    expect(withoutLayout(value).includes(withoutLayout(snippet)), `${label} should not contain:\n${snippet}`).toBe(false)
}

describe('generated-media API ownership', () => {
    it('does not promote a source-less preserved regeneration marker through browser-side pending-marker geometry', () => {
        const settlementSource = readFileSync(resolve(import.meta.dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-generation-settlement.ts'), 'utf-8')
        const start = settlementSource.indexOf('\n    applyMediaBranchLineagePlan(')
        const end = settlementSource.indexOf('\n    resolvePendingBranchMarkersForLineagePlan(', start)
        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        const handler = settlementSource.slice(start, end)
        // Ordering is what matters here, so compare positions in the layout-free text.
        const normalizedHandler = withoutLayout(handler)
        const regenerationTargetIndex = normalizedHandler.indexOf(
            withoutLayout('if (lineagePlan.regenerationTarget && !lineagePlan.regenerationTarget.sourceMediaNodeId)'),
        )
        const insertIndex = normalizedHandler.indexOf(
            withoutLayout('insertPendingBranchMarkersFromLineagePlan(threadId, lineagePlan, generationRun)'),
        )

        expect(regenerationTargetIndex).toBeGreaterThan(-1)
        expect(insertIndex).toBeGreaterThan(regenerationTargetIndex)
        expectSourceToContain(handler, 'resolvePendingBranchMarkerWithLineagePlan(threadId, generationRun)', 'regeneration lineage handler')
        expectSourceToContain(handler, 'return', 'regeneration lineage handler')
    })

    it('uses the API-declared regeneration target as the only pending UI marker', () => {
        const handler = readFileSync(resolve(import.meta.dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-branch-marker-handoff.ts'), 'utf-8')

        expectSourceToContain(handler, 'const regenerationTarget = lineagePlan?.regenerationTarget', 'pending-marker resolver')
        expectSourceToContain(handler, 'node.nodeId === regenerationTarget.lineageParentNodeId', 'pending-marker resolver')
        expectSourceToContain(handler, "this.ports.placements.phases.set(markerNode.nodeId, 'planned-awaiting-media')", 'pending-marker resolver')
        expectSourceNotToContain(handler, 'preserveCommittedNode', 'pending-marker resolver')
    })

    it('requires API geometry for video placeholders and never locally creates or balances them', () => {
        const handler = getExcerpt('onVideoPendingToCanvas:', 'onVideoGeneratingToCanvas:')

        expectSourceToContain(handler, 'missing video pending geometry; refusing local canvas topology mutation', 'video pending handler')
        expectSourceToContain(handler, 'applyApiCanvasGeometry(canvasGeometry)', 'video pending handler')
        expectSourceToContain(handler, 'rememberVideoGenerationTrackerForNode(threadId, generationRun, videoNode)', 'video pending handler')
        expectSourceNotToContain(handler, 'getNextGeneratedMediaPosition(', 'video pending handler')
        expectSourceNotToContain(handler, 'rebalanceGeneratedMediaTrees(', 'video pending handler')
        expectSourceNotToContain(handler, 'commitTransientCanvasStatePreservingEditors(', 'video pending handler')
    })

    it('clears the preserved marker phase by its API lineage parent when the replay settles', () => {
        const placements = readFileSync(resolve(import.meta.dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-generation-placements.ts'), 'utf-8')
        expectSourceToContain(placements, 'assignment?.lineageParentNodeId,', 'branch-marker phase lookup')
        expectSourceToContain(placements, 'for (const nodeId of this.getBranchMarkerUiPhaseNodeIdsForRun(threadId, generationRun))', 'phase clearing')
        expectSourceToContain(placements, 'this.phases.delete(nodeId)', 'phase clearing')
    })

    it('does not use blocking browser alert dialogs in runtime canvas code', () => {
        expectSourceNotToContain(source, 'alert(', 'workspace canvas')
    })
})
