'use strict'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadSource(): string {
    return readFileSync(resolve(__dirname, 'pixiContextRegionLayer.ts'), 'utf-8')
}

function extractTopLevelFunction(source: string, functionName: string): string {
    const match = new RegExp(`function\\s+${functionName}\\b[\\s\\S]*?^\\}`, 'm').exec(source)
    expect(match, `${functionName} should exist`).not.toBeNull()
    return match![0]
}

// =============================================================================
// Context-region selected chrome regression guards
// =============================================================================

describe('pixiContextRegionLayer — selected chrome regression guards', () => {
    const source = loadSource()

    it('does not draw cloud-shaped selection chrome', () => {
        expect(source.includes('function drawSelectedCloudChrome'), 'cloud-shaped selection chrome must stay removed').toBe(false)

        const drawChrome = extractTopLevelFunction(source, 'drawChrome')
        expect(drawChrome.includes('datum.selected'), 'drawChrome must not branch on selected state').toBe(false)
        expect(drawChrome.includes('drawSelectedCloudChrome'), 'drawChrome must not call selected-cloud chrome').toBe(false)
    })

    it('purges stale Graphics children before redrawing chrome', () => {
        const drawChrome = extractTopLevelFunction(source, 'drawChrome')

        expect(drawChrome).toContain('for (const child of [...entry.container.children])')
        expect(drawChrome).toContain('if (!(child instanceof Graphics)) continue')
        expect(drawChrome).toContain('entry.container.removeChild(child)')
        expect(drawChrome).toContain('child.destroy()')
        expect(drawChrome).toContain('entry.container.addChildAt(chrome, 1)')
        expect(drawChrome).toContain('entry.chrome = chrome')
    })

    it('keeps live region data aligned during drag transforms', () => {
        const setNodeLiveTransform = extractTopLevelFunction(source, 'setNodeLiveTransform')

        expect(setNodeLiveTransform).toContain('const liveDatum = {')
        expect(setNodeLiveTransform).toContain('currentRegions = currentRegions.map((region) => region.nodeId === nodeId ? liveDatum : region)')
        expect(setNodeLiveTransform).toContain('syncEntry(liveDatum)')
        expect(setNodeLiveTransform).toContain('updateVisibility()')
    })
})