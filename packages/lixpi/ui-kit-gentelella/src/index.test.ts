// @vitest-environment node
import {
    existsSync,
    readFileSync,
} from 'node:fs'
import {
    describe,
    expect,
    it,
} from 'vitest'

import { GENTELELLA_RUNTIME_MODULES } from './runtime/modules.ts'

describe('Gentelella UI-kit package boundary', () => {
    it('exports concrete source and style entrypoints', () => {
        const root = new URL('../', import.meta.url)
        const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
            dependencies: Record<string, string>
            exports: Record<string, string | Record<string, string>>
        }
        expect(manifest.dependencies['@lixpi/ui-primitives']).toBe('workspace:*')

        for (const [name, entry] of Object.entries(manifest.exports)) {
            const targets = typeof entry === 'string' ? [entry] : Object.values(entry)

            for (const target of targets) {
                if (target.includes('*'))
                    continue

                expect(existsSync(new URL(target, root)), `Missing public entry ${name}: ${target}`).toBe(true)
            }
        }
    })

    it('provides one facade for every declared typed runtime module', () => {
        const runtimeRoot = new URL('./runtime/', import.meta.url)

        for (const [name, upstreamModule] of Object.entries(GENTELELLA_RUNTIME_MODULES)) {
            const source = readFileSync(new URL(`${name}.ts`, runtimeRoot), 'utf8')
            expect(source.includes(`export * from '${upstreamModule}'`), `${name} must re-export ${upstreamModule}`).toBe(true)
        }
    })

    it('compiles the complete upstream theme entrypoint', () => {
        const source = readFileSync(new URL('./styles/theme.scss', import.meta.url), 'utf8')
        expect(source.includes('gentelella/scss/v4/main.scss')).toBe(true)
    })

    it('does not depend on a consuming service', () => {
        const sourceRoot = new URL('./', import.meta.url)
        const index = readFileSync(new URL('index.ts', sourceRoot), 'utf8')
        expect(index.includes('services/')).toBe(false)
        expect(index.includes('ai-model-registry')).toBe(false)
    })
})
