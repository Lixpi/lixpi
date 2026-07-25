'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')

function extractFunctionBody(functionName: string): string {
    const signatureIndex = source.indexOf(`function ${functionName}`)
    if (signatureIndex < 0) throw new Error(`Missing function: ${functionName}`)
    const signatureEnd = source.indexOf(')', signatureIndex)
    if (signatureEnd < 0) throw new Error(`Missing function signature: ${functionName}`)
    const bodyStart = source.indexOf('{', signatureEnd)
    if (bodyStart < 0) throw new Error(`Missing function body: ${functionName}`)

    let depth = 0
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1
        if (source[index] !== '}') continue
        depth -= 1
        if (depth === 0) return source.slice(bodyStart + 1, index)
    }
    throw new Error(`Unterminated function body: ${functionName}`)
}

describe('branch marker lifecycle', () => {
    it('retires the screen-fixed preflight marker as soon as API media placeholders take over', () => {
        const rememberBody = extractFunctionBody('rememberPlannedBranchMarkerRecord')
        const clearBody = extractFunctionBody('clearPendingBranchMarkerStateForRun')
        const screenPlacementBody = extractFunctionBody('syncPendingBranchMarkerScreenPlacements')

        expect(rememberBody).toContain('deletePendingBranchMarkerAliasesForNodeId(previousRecord.nodeId)')
        expect(clearBody).toContain('syncPendingBranchMarkerScreenPlacements()')
        expect(screenPlacementBody).toContain('if (!branchMarker) {')
        expect(screenPlacementBody).toContain('cleanupBranchMarkerArtifacts([nodeId])')
    })

    it('removes superseded preflight DOM before measuring the composer stack', () => {
        const screenPlacementBody = extractFunctionBody('syncPendingBranchMarkerScreenPlacements')

        expect(
            screenPlacementBody.includes('resolvePreflightBranchMarkerScreenOwnership('),
            'screen placement should resolve visible preflight ownership',
        ).toBe(true)
        expect(
            screenPlacementBody.includes('cleanupBranchMarkerArtifacts(screenOwnership.supersededPreflightNodeIds)'),
            'screen placement should remove superseded preflight DOM from every marker root',
        ).toBe(true)
        expect(
            screenPlacementBody.includes('const pendingNodes = screenOwnership.visiblePreflightNodes'),
            'composer stack measurement should include only visible preflight owners',
        ).toBe(true)
    })

    it('sweeps late composer preflight markers when the API request completes', () => {
        const settleBody = extractFunctionBody('settleMediaGenerationRequest')

        expect(settleBody).toContain('removePreflightBranchMarkersForThread(currentCanvasState, threadId)')
        expect(settleBody).toContain('cleanupBranchMarkerArtifacts(preflightSettlement.removedNodeIds)')
        expect(settleBody).toContain('commitTransientCanvasStatePreservingEditors(preflightSettlement.state)')
    })

    it('settles a single-model detached run immediately when its final media completes', () => {
        const finishBody = extractFunctionBody('finishGeneratedMediaRun')

        expect(finishBody).toContain('if (activeRunKeys.size > 0)')
        expect(
            finishBody.includes('pendingGeneratedImagePlacements.delete(threadId)'),
            'final run settlement should remove the thread-scoped placement alias',
        ).toBe(true)
        expect(finishBody).toContain('removePreflightBranchMarkersForThread(currentCanvasState, threadId)')
        expect(finishBody).toContain('removeOrphanedBranchMarkerOverlayElements(')
        expect(
            finishBody.includes('removeOrphanedBranchMarkerOverlayElements(\n            viewportEl,'),
            'final run settlement should sweep stale branch-marker copies stranded in the viewport',
        ).toBe(true)
        expect(finishBody).toContain('removeBranchMarkerOverlayElementsForConversation(')
        expect(finishBody).toContain('settleDetachedCanvasRun(threadId)')
        expect(finishBody).toContain('scheduleDetachedCanvasRunTeardown(threadId)')
    })

    it('recovers an alias-lost overlay marker before appending the planned marker', () => {
        const ensureRecordBody = extractFunctionBody('ensurePendingBranchMarkerRecordForApiRun')
        const deferSnapshotBody = extractFunctionBody('shouldDeferApiCanvasSnapshotBranchMarkerRender')
        const snapshotSyncBody = extractFunctionBody('syncApiCanvasSnapshotNodesToDOM')
        const syncPlannedBody = extractFunctionBody('syncPlannedBranchMarkerResolution')
        const resolvePlannedBody = extractFunctionBody('resolvePendingBranchMarkerWithLineagePlan')

        expect(ensureRecordBody).toContain('recoverPendingBranchMarkerRecordFromOverlay(threadId, generationRun)')
        expect(deferSnapshotBody).toContain('findPendingBranchMarkerOverlayIdentity(')
        expect(snapshotSyncBody.match(/shouldDeferApiCanvasSnapshotBranchMarkerRender\(node\)/g)).toHaveLength(3)
        expect(syncPlannedBody.includes(
            'promotePendingBranchMarkerElement(previousRecord.nodeId, plannedNode)',
        ), 'incremental planned-marker sync should not trust a stale record id').toBe(false)
        expect(syncPlannedBody).toContain('resolveVisiblePendingBranchMarkerOwner(')
        expect(syncPlannedBody.includes(
            'promotePendingBranchMarkerElement(screenFixedOwnerNodeId, plannedNode)',
        ), 'incremental planned-marker sync should consume the recovered screen-fixed owner').toBe(true)
        expect(resolvePlannedBody).toContain('resolveVisiblePendingBranchMarkerOwner(')
        expect(resolvePlannedBody).toContain('promotePendingBranchMarkerElement(visibleOwnerNodeId, plannedNodeWithPending)')
        expect(syncPlannedBody.includes(
            "console.info('[CANVAS] incremental branch marker ownership handoff'",
        ), 'incremental ownership handoff should emit a diagnostic').toBe(true)
    })

    it('keeps preflight ownership while structural render has not moved it into the overlay yet', () => {
        const matchingRecordBody = extractFunctionBody('getMatchingScreenFixedPendingBranchMarkerRecord')
        const threadRecordBody = extractFunctionBody('getScreenFixedPendingBranchMarkerRecordForThread')

        expect(matchingRecordBody).toContain('if (markerEl) return record')
        expect(threadRecordBody).toContain('if (markerEl) return record')
        expect(matchingRecordBody).not.toContain('markerEl?.parentElement === pendingBranchMarkerOverlayEl')
        expect(threadRecordBody).not.toContain('markerEl?.parentElement === pendingBranchMarkerOverlayEl')
    })

    it('chooses one structural render owner when preflight and planned markers coexist', () => {
        const renderNodesBody = extractFunctionBody('renderNodes')

        expect(renderNodesBody).toContain('resolveBranchMarkerRenderOwnership(')
        expect(renderNodesBody).toContain('branchMarkerRenderOwnership.suppressedNodeIds.has(node.nodeId)')
        expect(renderNodesBody).toContain("console.info('[CANVAS] branch marker structural ownership'")
    })
})
