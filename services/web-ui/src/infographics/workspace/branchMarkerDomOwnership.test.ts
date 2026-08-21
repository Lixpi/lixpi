'use strict'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    removeOrphanedBranchMarkerElements,
    replaceBranchMarkerDomCopies,
} from './branchMarkerDomOwnership.ts'

function createMarker(nodeId: string, conversationAssetId = 'conversation-1'): HTMLDivElement {
    const marker = document.createElement('div')
    marker.dataset.nodeId = nodeId
    marker.dataset.conversationAssetId = conversationAssetId
    return marker
}

function getMarkers(root: HTMLElement, nodeId: string): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('[data-node-id]')]
        .filter(nodeEl => nodeEl.dataset.nodeId === nodeId)
}

function expectSourceToContain(source: string, snippet: string, label: string): void {
    expect(
        source.includes(snippet),
        `${label} should contain:\n${snippet}`,
    ).toBe(true)
}

function expectSourceNotToContain(source: string, snippet: string, label: string): void {
    expect(
        source.includes(snippet),
        `${label} should not contain:\n${snippet}`,
    ).toBe(false)
}

// =============================================================================
// VIEWPORT CLEANUP
// =============================================================================

describe('branch marker DOM ownership — viewport cleanup', () => {
    let viewportEl: HTMLDivElement

    beforeEach(() => {
        viewportEl = document.createElement('div')
    })

    it('removes only orphaned markers owned by the completed conversation', () => {
        const retained = createMarker('retained-preflight')
        const orphan = createMarker('orphan-preflight')
        const concurrent = createMarker('other-conversation-preflight', 'conversation-2')
        viewportEl.append(retained, orphan, concurrent)

        const removedNodeIds = removeOrphanedBranchMarkerElements(
            viewportEl,
            new Set(['retained-preflight']),
            'conversation-1',
        )

        expect(removedNodeIds).toEqual(['orphan-preflight'])
        expect(getMarkers(viewportEl, 'retained-preflight')).toEqual([retained])
        expect(getMarkers(viewportEl, 'orphan-preflight')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'other-conversation-preflight')).toEqual([concurrent])
    })

    it('retains the planned marker while removing its stale preflight predecessor', () => {
        const stalePreflight = createMarker('pending-reasoning-0')
        const plannedMarker = createMarker('branch-origin-request-1')
        viewportEl.append(stalePreflight, plannedMarker)

        expect(removeOrphanedBranchMarkerElements(
            viewportEl,
            new Set(['branch-origin-request-1']),
            'conversation-1',
        )).toEqual(['pending-reasoning-0'])
        expect(getMarkers(viewportEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'branch-origin-request-1')).toEqual([plannedMarker])
    })
})

// =============================================================================
// PREFLIGHT TO PLANNED VIEWPORT HANDOFF
// =============================================================================

describe('branch marker DOM ownership — viewport promotion', () => {
    let viewportEl: HTMLDivElement

    beforeEach(() => {
        viewportEl = document.createElement('div')
    })

    it('collapses viewport duplicates when identity is unchanged', () => {
        viewportEl.append(createMarker('branch-fork-0'), createMarker('branch-fork-0'))
        const resolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: 'branch-fork-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([resolvedMarker])
    })

    it('removes temporary and pre-existing planned copies when identity changes', () => {
        viewportEl.append(
            createMarker('pending-reasoning-0'),
            createMarker('pending-reasoning-0'),
            createMarker('branch-fork-0'),
        )
        const unrelatedMarker = createMarker('branch-fork-1')
        viewportEl.append(unrelatedMarker)
        const resolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(viewportEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([resolvedMarker])
        expect(getMarkers(viewportEl, 'branch-fork-1')).toEqual([unrelatedMarker])
    })

    it('keeps exactly one resolved marker after repeated promotion events', () => {
        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: createMarker('branch-fork-0'),
        })
        const replayedResolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: replayedResolvedMarker,
        })

        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([replayedResolvedMarker])
    })

    it('promotes one reasoning branch without removing its sibling', () => {
        viewportEl.append(createMarker('pending-reasoning-0'), createMarker('pending-reasoning-1'))
        const reasoningZeroMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: reasoningZeroMarker,
        })

        expect(getMarkers(viewportEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'pending-reasoning-1')).toHaveLength(1)
        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([reasoningZeroMarker])
    })

    it('matches node ids as dataset values instead of CSS selector fragments', () => {
        const hostileNodeId = 'branch:fork/reasoning[0]"quoted'
        viewportEl.append(createMarker(hostileNodeId), createMarker(hostileNodeId))
        const resolvedMarker = createMarker(hostileNodeId)

        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: hostileNodeId,
            nextNodeId: hostileNodeId,
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(viewportEl, hostileNodeId)).toEqual([resolvedMarker])
    })

    it('reuses an already-mounted resolved element without duplicating it', () => {
        const resolvedMarker = createMarker('branch-fork-0')
        viewportEl.append(resolvedMarker)

        replaceBranchMarkerDomCopies({
            viewportEl,
            previousNodeId: 'branch-fork-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([resolvedMarker])
    })
})

// =============================================================================
// WORKSPACE CANVAS INTEGRATION
// =============================================================================

describe('branch marker DOM ownership — WorkspaceCanvas wiring', () => {
    const source = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')

    it('promotes markers entirely within the canvas viewport', () => {
        expectSourceToContain(source, 'replaceBranchMarkerDomCopies({', 'WorkspaceCanvas marker promotion')
        expectSourceNotToContain(source, 'pendingBranchMarkerOverlayEl', 'WorkspaceCanvas marker promotion')
        expectSourceNotToContain(source, 'workspace-branch-marker-screen-fixed', 'WorkspaceCanvas marker promotion')
    })
})
