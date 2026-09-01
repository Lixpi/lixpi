// @vitest-environment node
import {
    readFileSync,
    readdirSync,
    existsSync,
} from 'node:fs'
import {
    describe,
    expect,
    it,
} from 'vitest'

describe('UI-kit package boundary', () => {
    it('exposes its source and styles without a canvas package dependency', () => {
        const root = new URL('../', import.meta.url)
        const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
        const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
        expect(dependencies.filter(name => name.startsWith('@lixpi/canvas-'))).toEqual([])
        for (const [name, entry] of Object.entries(manifest.exports)) {
            for (const target of typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, string>)) {
                expect(existsSync(new URL(target, root)), `Missing public entry ${name}: ${target}`).toBe(true)
            }
        }
        const sourceRoot = new URL('./', import.meta.url)
        for (const path of readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })) {
            if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue
            const source = readFileSync(new URL(path, sourceRoot), 'utf8')
            const imports = Array.from(source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g), match => match[1])
            expect(imports.filter(name => name.startsWith('@lixpi/canvas-')), `${path} must not import a canvas package`).toEqual([])
        }
    })
})
