import { execFileSync } from 'node:child_process'
import {
    describe,
    expect,
    it,
} from 'vitest'

import {
    ASSET_DOCUMENT_ROLES,
    isAssetDocumentRole,
} from './asset-types.ts'

describe('Asset document roles', () => {
    it('keeps Capability Artifacts in the canonical runtime role list', () => {
        expect(ASSET_DOCUMENT_ROLES).toEqual([
            'content',
            'conversation',
            'provenance',
            'capabilityArtifact',
        ])
        expect(isAssetDocumentRole('capabilityArtifact')).toBe(true)
        expect(isAssetDocumentRole('unknown')).toBe(false)
    })
})

describe('@lixpi/constants native TypeScript entrypoint', () => {
    it('loads under Node without resolving type-only packages at runtime', () => {
        expect(() => {
            execFileSync(
                process.execPath,
                [
                    '--experimental-transform-types',
                    '--input-type=module',
                    '--eval',
                    "await import('./index.ts')",
                ],
                {
                    cwd: import.meta.dirname,
                    stdio: 'pipe',
                },
            )
        }).not.toThrow()
    })
})
