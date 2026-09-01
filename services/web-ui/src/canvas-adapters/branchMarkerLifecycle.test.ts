'use strict'

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'

const source = readFileSync(resolve(__dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.ts'), 'utf-8')
const scssSource = readFileSync(resolve(__dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/nodes/branch-marker-content.scss'), 'utf-8')

function preflightMethod(name: string, module = 'workspace-preflight-markers'): string {
    const source = readFileSync(resolve(__dirname, `../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/${module}.ts`), 'utf-8')
    const start = source.indexOf(`\n    ${name}(`)
    const end = source.indexOf('\n    }\n', start)
    expect(start, `Missing preflight method ${name}`).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
}

function expectSourceToContain(sourceText: string, snippet: string, label: string): void {
    expect(sourceText.includes(snippet), `${label} should contain:\n${snippet}`).toBe(true)
}

function expectSourceNotToContain(sourceText: string, snippet: string, label: string): void {
    expect(sourceText.includes(snippet), `${label} should not contain:\n${snippet}`).toBe(false)
}

function extractFunctionBody(functionName: string): string {
    const signatureIndex = source.indexOf(`private ${functionName} =`)
    if (signatureIndex < 0) throw new Error(`Missing function: ${functionName}`)
    const signatureEnd = source.indexOf(')', signatureIndex)
    if (signatureEnd < 0) throw new Error(`Missing function signature: ${functionName}`)
    const bodyStart = source.indexOf('=> {', signatureEnd) + 3
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
        const persistedInsertBody = preflightMethod('insertPendingBranchMarkerForPersistedCanvasThread')
        const canvasRunInsertBody = preflightMethod('insertPendingBranchMarkerForCanvasRun')
        const lineageInsertBody = preflightMethod('insertPendingBranchMarkersFromLineagePlan')

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
            'this.ports.append(pendingNode)',
            'persisted preflight viewport render',
        )
        expectSourceNotToContain(source, 'workspace-branch-marker-moving', 'branch marker lifecycle')
        expectSourceNotToContain(source, 'syncPendingBranchMarkerScreenPlacements', 'branch marker lifecycle')
        expectSourceNotToContain(scssSource, '.workspace-branch-marker-moving', 'branch marker styles')
        expectSourceNotToContain(scssSource, '.workspace-branch-marker-screen-fixed', 'branch marker styles')
    })

    it('sweeps late viewport preflight markers when the API request completes', () => {
        const settleBody = preflightMethod('settleMediaGenerationRequest', 'workspace-generation-settlement')

        expectSourceToContain(settleBody, 'removePreflightBranchMarkersForThread(this.currentCanvasState, threadId)', 'request settlement')
        expectSourceToContain(settleBody, 'this.ports.cleanup(preflightSettlement.removedNodeIds)', 'request settlement')
        expectSourceToContain(settleBody, 'this.ports.commit(preflightSettlement.state)', 'request settlement')
    })

    it('settles a single-model detached run immediately when its final media completes', () => {
        const finishBody = preflightMethod('finishGeneratedMediaRun', 'workspace-generation-settlement')

        expectSourceToContain(finishBody, 'if (activeRunKeys.size > 0)', 'run settlement')
        expect(
            finishBody.includes('this.ports.placements.placements.delete(threadId)'),
            'final run settlement should remove the thread-scoped placement alias',
        ).toBe(true)
        expectSourceToContain(finishBody, 'removePreflightBranchMarkersForThread(this.currentCanvasState, threadId)', 'run settlement')
        expectSourceToContain(finishBody, 'this.ports.syncMedia(this.currentCanvasState)', 'run settlement')
        expectSourceToContain(finishBody, 'this.ports.settleConversation(threadId)', 'run settlement')
        expectSourceToContain(finishBody, 'this.ports.scheduleTeardown(threadId)', 'run settlement')
    })

    it('reconciles planned marker ownership through the scene without replacing editors', () => {
        const snapshotSyncBody = preflightMethod('syncApiCanvasSnapshotNodesToDOM', '../scene/workspace-api-canvas-geometry')
        const handoff = readFileSync(resolve(__dirname, '../../packages/lixpi/canvas-components-lixpi-specific/src/shared/generation/workspace-branch-marker-handoff.ts'), 'utf-8')
        expectSourceToContain(handoff, 'this.ports.placements.ensurePendingBranchMarkerRecordForApiRun(threadId, generationRun)', 'pending marker adoption')
        expectSourceToContain(handoff, 'this.syncPlannedBranchMarkerResolution(', 'marker handoff owner')
        expectSourceToContain(source, 'commit: this.commitTransientCanvasStatePreservingEditors,', 'transient handoff commit')
        expectSourceNotToContain(snapshotSyncBody, 'shouldDefer', 'API canvas snapshot marker sync')
        expectSourceToContain(handoff, "this.ports.log('info', '[CANVAS] incremental branch marker ownership handoff'", 'incremental ownership handoff')
    })

    it('mounts a Capability Artifact delivered by live API canvas geometry', () => {
        const appendBody = extractFunctionBody('appendCanvasNodeToDOM')
        const snapshotSyncBody = preflightMethod('syncApiCanvasSnapshotNodesToDOM', '../scene/workspace-api-canvas-geometry')

        expect(appendBody).toContain('this.syncCanvasMediaLayer(this.currentCanvasState)')
        expect(source).toContain('capability: this.createCapabilityArtifactNode,')
        expect(
            snapshotSyncBody.includes("node.type === 'capabilityArtifact'"),
            'live API geometry sync should include Capability Artifact snapshots',
        ).toBe(true)
    })

    it('removes detached-run preflight ownership when the API rejects the request', () => {
        const failureBody = extractFunctionBody('failDetachedCanvasRun')
        const editorBody = extractFunctionBody('createDetachedCanvasThreadEditor')

        expect(
            failureBody.includes('detachedAiChatThreadEditors.settle(threadId)'),
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
            editorBody.includes('fail: () => this.failDetachedCanvasRun(threadId)'),
            'only the current detached AI service should route API errors into canvas cleanup',
        ).toBe(true)
    })

    it('chooses one structural render owner when preflight and planned markers coexist', () => {
        const renderNodesBody = extractFunctionBody('getVisibleCanvasNodes')

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
        expectSourceToContain(progressBody, 'buildBranchMarkerProgress({', 'branch progress projection')
        expectSourceToContain(progressBody, "showSummaryWhenCollapsedItemIds: ['understand-request']", 'branch reasoning progress')
        expectSourceToContain(contentBody, 'new BranchMarkerContent({', 'branch marker content')
        expectSourceToContain(contentBody, 'progress: globalProgress ? { element: globalProgress', 'branch marker progress port')
        expectSourceToContain(contentBody, 'headerHeight: node.dimensions.height', 'branch marker progress geometry')
        expectSourceToContain(
            chromeSyncBody,
            'outputChrome.sync(canvasState)',
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
        const reviewControlsBody = extractFunctionBody('syncBranchMarkerActions')

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
            'controlsHost.appendChild(controls.reviewControls)',
            'branch review control host',
        )
    })
})
