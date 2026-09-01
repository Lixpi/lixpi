import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    describe,
    expect,
    it,
} from 'vitest'

describe('shared package boundary', () => {
    it('keeps the root and shared dependency graphs free of browser and product modules', () => {
        const pending = [new URL('../index.ts', import.meta.url), new URL('./index.ts', import.meta.url)]
        const visited = new Set<string>()
        while (pending.length > 0) {
            const file = pending.pop()!
            if (visited.has(file.href)) continue
            visited.add(file.href)
            const source = readFileSync(file, 'utf8')
            for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
                const target = match[1]
                expect(target.startsWith('.'), `${fileURLToPath(file)} imports external dependency ${target}`).toBe(true)
                const dependency = new URL(target, file)
                expect(dependency.pathname.includes('/src/shared/'), `Shared dependency escapes its runtime boundary: ${target}`).toBe(true)
                pending.push(dependency)
            }
        }
    })
})
