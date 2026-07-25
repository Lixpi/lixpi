'use strict'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    clearBranchMarkerOverlayForStructuralRender,
    findPendingBranchMarkerOverlayIdentity,
    getPendingBranchMarkerOverlayIdentities,
    removeBranchMarkerOverlayElementsForConversation,
    removeOrphanedBranchMarkerOverlayElements,
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

// =============================================================================
// FULL STRUCTURAL RENDER OWNERSHIP
// =============================================================================

describe('branch marker DOM ownership — structural render', () => {
    let overlayEl: HTMLDivElement

    beforeEach(() => {
        overlayEl = document.createElement('div')
    })

    it('removes an overlay-only orphan after its transient state node is gone', () => {
        const retained = createMarker('retained-preflight')
        const orphan = createMarker('orphan-preflight')
        const concurrentlyPending = createMarker('other-conversation-preflight', 'conversation-2')
        overlayEl.append(retained, orphan, concurrentlyPending)

        const removedNodeIds = removeOrphanedBranchMarkerOverlayElements(
            overlayEl,
            new Set(['retained-preflight']),
            'conversation-1',
        )

        expect(removedNodeIds).toEqual(['orphan-preflight'])
        expect(getMarkers(overlayEl, 'retained-preflight')).toEqual([retained])
        expect(getMarkers(overlayEl, 'orphan-preflight')).toHaveLength(0)
        expect(getMarkers(overlayEl, 'other-conversation-preflight')).toEqual([concurrentlyPending])
    })

    it('removes every retained preflight marker before a structural rebuild', () => {
        overlayEl.append(createMarker('reasoning-0'), createMarker('reasoning-1'))

        clearBranchMarkerOverlayForStructuralRender(overlayEl)

        expect(overlayEl.childElementCount).toBe(0)
    })

    it('is safe when no overlay exists and across repeated rebuilds', () => {
        expect(() => clearBranchMarkerOverlayForStructuralRender(null)).not.toThrow()

        overlayEl.append(createMarker('reasoning-0'))
        clearBranchMarkerOverlayForStructuralRender(overlayEl)
        clearBranchMarkerOverlayForStructuralRender(overlayEl)

        expect(overlayEl.childElementCount).toBe(0)
    })

    it('recovers the exact screen-fixed marker after its in-memory alias is lost', () => {
        const reasoningZero = createMarker('pending-reasoning-0')
        reasoningZero.dataset.reasoningIndex = '0'
        reasoningZero.dataset.reasoningModelId = 'Anthropic:claude-haiku-4-5-20251001'
        const reasoningOne = createMarker('pending-reasoning-1')
        reasoningOne.dataset.reasoningIndex = '1'
        reasoningOne.dataset.reasoningModelId = 'OpenAI:gpt-5-mini'
        overlayEl.append(reasoningZero, reasoningOne)

        expect(findPendingBranchMarkerOverlayIdentity(
            overlayEl,
            'conversation-1',
            0,
            'Anthropic:claude-haiku-4-5-20251001',
        )).toEqual({
            nodeId: 'pending-reasoning-0',
            reasoningIndex: 0,
            reasoningModelId: 'Anthropic:claude-haiku-4-5-20251001',
        })
    })

    it('does not guess when multiple overlay markers have no matching run identity', () => {
        overlayEl.append(createMarker('pending-reasoning-0'), createMarker('pending-reasoning-1'))

        expect(findPendingBranchMarkerOverlayIdentity(
            overlayEl,
            'conversation-1',
            2,
            'missing-model',
        )).toBeNull()
    })

    it('recovers the sole marker for a single-model request without run metadata', () => {
        const marker = createMarker('pending-single-model')
        marker.dataset.reasoningIndex = ''
        overlayEl.append(marker)

        expect(findPendingBranchMarkerOverlayIdentity(
            overlayEl,
            'conversation-1',
        )).toEqual({ nodeId: 'pending-single-model' })
    })

    it('lists every marker owned by one conversation without including concurrent runs', () => {
        const first = createMarker('pending-reasoning-0')
        first.dataset.reasoningIndex = '0'
        first.dataset.reasoningModelId = 'Anthropic:claude-haiku-4-5'
        const second = createMarker('pending-reasoning-1')
        second.dataset.reasoningIndex = '1'
        overlayEl.append(first, second, createMarker('other-run', 'conversation-2'))

        expect(getPendingBranchMarkerOverlayIdentities(overlayEl, 'conversation-1')).toEqual([
            {
                nodeId: 'pending-reasoning-0',
                reasoningIndex: 0,
                reasoningModelId: 'Anthropic:claude-haiku-4-5',
            },
            {
                nodeId: 'pending-reasoning-1',
                reasoningIndex: 1,
            },
        ])
    })

    it('removes every screen-fixed marker for a completed conversation', () => {
        overlayEl.append(
            createMarker('pending-reasoning-0'),
            createMarker('planned-copy'),
            createMarker('other-run', 'conversation-2'),
        )

        expect(removeBranchMarkerOverlayElementsForConversation(
            overlayEl,
            'conversation-1',
        )).toEqual(['pending-reasoning-0', 'planned-copy'])
        expect(getMarkers(overlayEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(overlayEl, 'planned-copy')).toHaveLength(0)
        expect(getMarkers(overlayEl, 'other-run')).toHaveLength(1)
    })

    it('removes a completed preflight marker stranded in the viewport while retaining the planned marker', () => {
        const viewportEl = document.createElement('div')
        const stalePreflight = createMarker('pending-reasoning-0')
        const plannedMarker = createMarker('branch-origin-request-1')
        const concurrentMarker = createMarker('pending-other-run', 'conversation-2')
        viewportEl.append(stalePreflight, plannedMarker, concurrentMarker)

        const removedNodeIds = removeOrphanedBranchMarkerOverlayElements(
            viewportEl,
            new Set(['branch-origin-request-1', 'pending-other-run']),
            'conversation-1',
        )

        expect(removedNodeIds).toEqual(['pending-reasoning-0'])
        expect(getMarkers(viewportEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'branch-origin-request-1')).toEqual([plannedMarker])
        expect(getMarkers(viewportEl, 'pending-other-run')).toEqual([concurrentMarker])
    })

    it('hands an alias-lost overlay marker to one planned viewport marker', () => {
        const pendingMarker = createMarker('pending-single-model')
        pendingMarker.dataset.reasoningIndex = '0'
        overlayEl.append(pendingMarker)
        const identity = findPendingBranchMarkerOverlayIdentity(
            overlayEl,
            'conversation-1',
            0,
        )
        const plannedMarker = createMarker('branch-origin-request-1')

        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl: document.createElement('div'),
            previousNodeId: identity!.nodeId,
            nextNodeId: 'branch-origin-request-1',
            nextNodeEl: plannedMarker,
        })

        expect(overlayEl.childElementCount).toBe(0)
        expect(plannedMarker.parentElement).not.toBeNull()
    })
})

// =============================================================================
// PREFLIGHT TO PLANNED IDENTITY HANDOFF
// =============================================================================

describe('branch marker DOM ownership — promotion', () => {
    let overlayEl: HTMLDivElement
    let viewportEl: HTMLDivElement

    beforeEach(() => {
        overlayEl = document.createElement('div')
        viewportEl = document.createElement('div')
    })

    it('collapses overlay and viewport duplicates when identity is unchanged', () => {
        overlayEl.append(createMarker('branch-fork-0'), createMarker('branch-fork-0'))
        viewportEl.append(createMarker('branch-fork-0'))
        const resolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl,
            previousNodeId: 'branch-fork-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(overlayEl, 'branch-fork-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([resolvedMarker])
    })

    it('removes every temporary and pre-existing planned copy when identity changes', () => {
        overlayEl.append(createMarker('pending-reasoning-0'), createMarker('pending-reasoning-0'))
        viewportEl.append(createMarker('pending-reasoning-0'), createMarker('branch-fork-0'))
        const unrelatedMarker = createMarker('branch-fork-1')
        viewportEl.append(unrelatedMarker)
        const resolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(overlayEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([resolvedMarker])
        expect(getMarkers(viewportEl, 'branch-fork-1')).toEqual([unrelatedMarker])
    })

    it('keeps exactly one resolved marker after repeated promotion events', () => {
        const firstResolvedMarker = createMarker('branch-fork-0')
        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: firstResolvedMarker,
        })
        const replayedResolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: replayedResolvedMarker,
        })

        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([replayedResolvedMarker])
    })

    it('promotes one reasoning branch without removing its sibling', () => {
        overlayEl.append(createMarker('pending-reasoning-0'), createMarker('pending-reasoning-1'))
        const reasoningZeroMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: reasoningZeroMarker,
        })

        expect(getMarkers(overlayEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(overlayEl, 'pending-reasoning-1')).toHaveLength(1)
        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([reasoningZeroMarker])
    })

    it('matches node ids as dataset values instead of CSS selector fragments', () => {
        const hostileNodeId = 'branch:fork/reasoning[0]"quoted'
        overlayEl.append(createMarker(hostileNodeId), createMarker(hostileNodeId))
        const resolvedMarker = createMarker(hostileNodeId)

        replaceBranchMarkerDomCopies({
            overlayEl,
            viewportEl,
            previousNodeId: hostileNodeId,
            nextNodeId: hostileNodeId,
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(overlayEl, hostileNodeId)).toHaveLength(0)
        expect(getMarkers(viewportEl, hostileNodeId)).toEqual([resolvedMarker])
    })

    it('promotes safely when the overlay has already been destroyed', () => {
        viewportEl.append(createMarker('pending-reasoning-0'))
        const resolvedMarker = createMarker('branch-fork-0')

        replaceBranchMarkerDomCopies({
            overlayEl: null,
            viewportEl,
            previousNodeId: 'pending-reasoning-0',
            nextNodeId: 'branch-fork-0',
            nextNodeEl: resolvedMarker,
        })

        expect(getMarkers(viewportEl, 'pending-reasoning-0')).toHaveLength(0)
        expect(getMarkers(viewportEl, 'branch-fork-0')).toEqual([resolvedMarker])
    })

    it('reuses an already-mounted resolved element without duplicating it', () => {
        const resolvedMarker = createMarker('branch-fork-0')
        viewportEl.append(resolvedMarker)

        replaceBranchMarkerDomCopies({
            overlayEl,
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

    it('clears overlay ownership during full renders and atomically promotes markers', () => {
        expectSourceToContain(
            source,
            'clearBranchMarkerOverlayForStructuralRender(pendingBranchMarkerOverlayEl)',
            'WorkspaceCanvas structural render',
        )
        expectSourceToContain(
            source,
            'replaceBranchMarkerDomCopies({',
            'WorkspaceCanvas marker promotion',
        )
    })
})
