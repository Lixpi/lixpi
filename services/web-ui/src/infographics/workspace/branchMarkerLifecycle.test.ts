'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'WorkspaceCanvas.ts'), 'utf-8')
const scssSource = readFileSync(resolve(__dirname, 'workspace-canvas.scss'), 'utf-8')

function expectSourceToContain(sourceText: string, snippet: string, label: string): void {
    expect(sourceText.includes(snippet), `${label} should contain:\n${snippet}`).toBe(true)
}

function expectSourceNotToContain(sourceText: string, snippet: string, label: string): void {
    expect(sourceText.includes(snippet), `${label} should not contain:\n${snippet}`).toBe(false)
}

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
    it('places every preflight marker in canvas-world geometry before rendering it', () => {
        const persistedInsertBody = extractFunctionBody('insertPendingBranchMarkerForPersistedCanvasThread')
        const canvasRunInsertBody = extractFunctionBody('insertPendingBranchMarkerForCanvasRun')
        const lineageInsertBody = extractFunctionBody('insertPendingBranchMarkersFromLineagePlan')

        for (const insertBody of [persistedInsertBody, canvasRunInsertBody, lineageInsertBody]) {
            expectSourceToContain(
                insertBody,
                'getRootBranchMarkerPositionBeforeGeneratedMedia(',
                'preflight canvas position',
            )
            expectSourceNotToContain(insertBody, 'screenFixed', 'preflight canvas position')
            expectSourceNotToContain(insertBody, 'pendingBranchMarkerOverlayEl', 'preflight canvas position')
        }
        expectSourceToContain(
            persistedInsertBody,
            'appendBranchLineNodeToDOM(pendingNode)',
            'persisted preflight viewport render',
        )
        expectSourceNotToContain(source, 'workspace-branch-marker-moving', 'branch marker lifecycle')
        expectSourceNotToContain(source, 'syncPendingBranchMarkerScreenPlacements', 'branch marker lifecycle')
        expectSourceNotToContain(scssSource, '.workspace-branch-marker-moving', 'branch marker styles')
        expectSourceNotToContain(scssSource, '.workspace-branch-marker-screen-fixed', 'branch marker styles')
    })

    it('sweeps late viewport preflight markers when the API request completes', () => {
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
        expect(finishBody).toContain('removeOrphanedBranchMarkerElements(')
        expect(
            finishBody.includes('removeOrphanedBranchMarkerElements(\n            viewportEl,'),
            'final run settlement should sweep stale branch-marker copies stranded in the viewport',
        ).toBe(true)
        expect(finishBody).toContain('settleDetachedCanvasRun(threadId)')
        expect(finishBody).toContain('scheduleDetachedCanvasRunTeardown(threadId)')
    })

    it('replaces the preflight viewport element directly with the planned marker', () => {
        const ensureRecordBody = extractFunctionBody('ensurePendingBranchMarkerRecordForApiRun')
        const promoteBody = extractFunctionBody('promotePendingBranchMarkerElement')
        const snapshotSyncBody = extractFunctionBody('syncApiCanvasSnapshotNodesToDOM')
        const syncPlannedBody = extractFunctionBody('syncPlannedBranchMarkerResolution')
        const resolvePlannedBody = extractFunctionBody('resolvePendingBranchMarkerWithLineagePlan')

        expect(ensureRecordBody).toContain('recoverPendingBranchMarkerRecordFromCanvasState(threadId, generationRun)')
        expectSourceToContain(promoteBody, 'replaceBranchMarkerDomCopies({', 'planned marker viewport handoff')
        expectSourceToContain(promoteBody, 'viewportEl,', 'planned marker viewport handoff')
        expectSourceNotToContain(promoteBody, 'overlayEl', 'planned marker viewport handoff')
        expectSourceNotToContain(promoteBody, 'applyStyle(', 'planned marker viewport handoff')
        expect(syncPlannedBody.includes(
            'promotePendingBranchMarkerElement(previousRecord.nodeId, plannedNode)',
        ), 'incremental planned-marker sync should replace the recorded viewport owner').toBe(true)
        expect(resolvePlannedBody).toContain('promotePendingBranchMarkerElement(record.nodeId, plannedNodeWithPending)')
        expectSourceNotToContain(snapshotSyncBody, 'shouldDefer', 'API canvas snapshot marker sync')
        expect(syncPlannedBody.includes(
            "console.info('[CANVAS] incremental branch marker ownership handoff'",
        ), 'incremental ownership handoff should emit a diagnostic').toBe(true)
    })

    it('mounts a Capability Artifact delivered by live API canvas geometry', () => {
        const appendBody = extractFunctionBody('appendCanvasNodeToDOM')
        const snapshotSyncBody = extractFunctionBody('syncApiCanvasSnapshotNodesToDOM')

        expect(
            appendBody.includes("node.type === 'capabilityArtifact'"),
            'generic incremental node append should route Capability Artifacts',
        ).toBe(true)
        expect(
            appendBody.includes('appendCapabilityArtifactNodeToDOM(node)'),
            'Capability Artifact snapshots should receive a DOM shell',
        ).toBe(true)
        expect(
            snapshotSyncBody.includes("node.type === 'capabilityArtifact'"),
            'live API geometry sync should include Capability Artifact snapshots',
        ).toBe(true)
    })

    it('removes detached-run preflight ownership when the API rejects the request', () => {
        const failureBody = extractFunctionBody('failDetachedCanvasRun')
        const editorBody = extractFunctionBody('createDetachedCanvasThreadEditor')

        expect(
            failureBody.includes('settledDetachedCanvasRunThreadIds.add(threadId)'),
            'failed detached runs should not be restored as active after the API rejects them',
        ).toBe(true)
        expect(
            failureBody.includes('pendingGeneratedImagePlacements.delete(threadId)'),
            'failed detached runs should drop pending placement ownership',
        ).toBe(true)
        expect(
            failureBody.includes('removePendingBranchMarkerForRun(threadId)'),
            'failed detached runs should remove their preflight marker',
        ).toBe(true)
        expect(
            editorBody.includes('onError: () => failDetachedCanvasRun(threadId)'),
            'detached AI services should route top-level API errors into canvas cleanup',
        ).toBe(true)
    })

    it('chooses one structural render owner when preflight and planned markers coexist', () => {
        const renderNodesBody = extractFunctionBody('renderNodes')

        expect(renderNodesBody).toContain('resolveBranchMarkerRenderOwnership(')
        expect(renderNodesBody).toContain('branchMarkerRenderOwnership.suppressedNodeIds.has(node.nodeId)')
        expect(renderNodesBody).toContain("console.info('[CANVAS] branch marker structural ownership'")
    })

    it('keeps shared request progress inside the branch marker surface', () => {
        const contentBody = extractFunctionBody('createBranchMarkerContent')
        const progressBody = extractFunctionBody('createBranchMarkerGlobalProgress')
        const chromeSyncBody = extractFunctionBody('syncGeneratedMediaChrome')
        const cleanupBody = extractFunctionBody('cleanupBranchMarkerArtifacts')

        expectSourceToContain(progressBody, "className: 'workspace-branch-marker-progress'", 'branch progress factory')
        expectSourceToContain(progressBody, 'return progress.element', 'branch progress factory')
        expectSourceNotToContain(progressBody, 'workspace-branch-generation-progress-chrome', 'branch progress factory')
        expectSourceToContain(
            progressBody,
            "const reasoningSummary = responseText.replace(/\\s+/g, ' ').trim()",
            'branch reasoning progress',
        )
        expectSourceToContain(progressBody, 'summary: reasoningSummary', 'branch reasoning progress')
        expectSourceToContain(
            progressBody,
            "showSummaryWhenCollapsedItemIds: ['understand-request']",
            'branch reasoning progress',
        )
        expectSourceToContain(
            progressBody,
            'const mediaRequestStatuses = resolveBranchMarkerMediaRequestStatuses(',
            'terminal branch progress',
        )
        expectSourceToContain(
            progressBody,
            'settleBranchMarkerProgressStatusForTerminalMedia(\n                getCapabilityRunStatus(run),',
            'terminal Capability run progress',
        )
        expectSourceToContain(
            progressBody,
            'settleBranchMarkerProgressStatusForTerminalMedia(\n                    step.status,',
            'terminal Capability step progress',
        )
        expectSourceToContain(contentBody, "${globalProgress ? ' has-progress' : ''}", 'branch marker content')
        expectSourceToContain(
            contentBody,
            '${globalProgress ? html`<div className="workspace-branch-marker-separator"></div>` : null}',
            'branch marker content',
        )
        expectSourceToContain(contentBody, '${globalProgress}\n                </div>', 'branch marker main content')
        expectSourceToContain(
            contentBody,
            "content.style.setProperty('--workspace-branch-marker-header-center'",
            'branch marker progress geometry',
        )
        expectSourceToContain(
            chromeSyncBody,
            'destroyGeneratedOutputNodeFooters()',
            'media chrome rebuild',
        )
        expectSourceNotToContain(
            chromeSyncBody,
            'destroyMediaGenerationProgressInstances()',
            'media chrome rebuild',
        )
        expectSourceToContain(
            cleanupBody,
            'destroyMediaGenerationProgressInstance(`branch:${nodeId}`)',
            'branch marker cleanup',
        )
    })

    it('reserves active stop-control space only in the branch marker prompt row', () => {
        expectSourceToContain(
            scssSource,
            `.workspace-branch-marker-content.has-progress.has-stop-control {
    padding-right: 18px;
}`,
            'expanded branch marker content',
        )
        expectSourceToContain(
            scssSource,
            `.workspace-branch-marker-content.has-progress.has-stop-control > .workspace-branch-marker-main > .workspace-branch-marker-message {
    padding-right: 34px;
}`,
            'expanded branch marker prompt row',
        )
    })

    it('anchors review controls below the complete rendered branch marker surface', () => {
        const reviewControlsBody = extractFunctionBody('syncBranchMarkerReviewControls')

        expectSourceToContain(
            reviewControlsBody,
            "nodeEl.querySelector<HTMLElement>(':scope > .workspace-branch-marker-content')",
            'branch review control host',
        )
        expectSourceToContain(
            reviewControlsBody,
            'const controlsHost = content ?? nodeEl',
            'branch review control host',
        )
        expectSourceToContain(
            reviewControlsBody,
            'controlsHost.appendChild(controls)',
            'branch review control host',
        )
    })

    it('shows media attribution after the first frame even before the Asset catalog refresh arrives', () => {
        const syncChromeBody = extractFunctionBody('syncGeneratedMediaChrome')
        const modelBody = extractFunctionBody('getGeneratedMediaModelId')

        expectSourceToContain(syncChromeBody, '|| node.generatedBy', 'generated media chrome eligibility')
        expectSourceToContain(
            syncChromeBody,
            '|| node.generationProgress?.mediaModelId',
            'generated media chrome eligibility',
        )
        expectSourceToContain(
            modelBody,
            "node.generationProgress?.mediaModelId ?? ''",
            'generated media model fallback',
        )
    })
})
