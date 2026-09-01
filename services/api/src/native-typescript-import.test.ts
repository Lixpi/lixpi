import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'

describe('API native TypeScript imports', () => {
    it('loads model modules without resolving type-only packages at runtime', () => {
        expect(() => {
            execFileSync(
                process.execPath,
                [
                    '--experimental-transform-types',
                    '--input-type=module',
                    '--eval',
                    "await Promise.all([import('./src/models/user.ts'), import('./src/models/organization.ts'), import('./src/models/ai-model.ts'), import('./src/prosemirror/ai-chat-stream-assembler.ts')])",
                ],
                {
                    cwd: resolve(import.meta.dirname, '..'),
                    stdio: 'pipe',
                },
            )
        }).not.toThrow()
    })
})
