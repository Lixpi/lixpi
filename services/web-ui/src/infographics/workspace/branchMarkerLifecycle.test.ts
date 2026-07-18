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
})
