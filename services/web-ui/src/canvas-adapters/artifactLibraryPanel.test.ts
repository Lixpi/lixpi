import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'

const canvasSource = [
    'workspace-canvas.ts',
    'workspace-canvas-assets.ts',
    'workspace-canvas-libraries.ts',
].map(filename => readFileSync(resolve(import.meta.dirname, `../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/${filename}`), 'utf-8')).join('\n')

describe('Artifact Library panel contract', () => {
    it('supports attach, scope, review, and sealed generation history', () => {
        for (const snippet of ['onInsertAsset', 'onAcceptAsset', 'changeScope', "mode === 'artifacts'", "type: 'capabilityArtifact'"]) {
            expect(canvasSource.includes(snippet), `workspace host should contain ${snippet}`).toBe(true)
        }
    })
})
