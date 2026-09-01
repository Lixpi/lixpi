import { readFileSync } from 'node:fs'
import {
    describe,
    expect,
    it,
} from 'vitest'

const read = (filename: string): string => readFileSync(new URL(filename, import.meta.url), 'utf8')

describe('workspace canvas contracts', () => {
    it('keeps public canvas contracts isolated and exported by the workspace barrel', () => {
        const contracts = read('./workspace-canvas-contracts.ts')
        const workspace = read('./workspace-canvas.ts')
        const barrel = read('./index.ts')

        expect(contracts).toContain('export type WorkspaceCanvasOptions')
        expect(contracts).toContain('export type WorkspaceCanvasNodeInsertion')
        expect(workspace).toContain("from './workspace-canvas-contracts.ts'")
        expect(barrel).toContain("export * from './workspace-canvas-contracts.ts'")
    })
})
