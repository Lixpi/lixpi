import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import {
    describe,
    expect,
    it,
} from 'vitest'

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)

    if (entry.isDirectory())
        return sourceFiles(path)

    return entry.name.endsWith('.ts')
        && !entry.name.endsWith('.test.ts')
        ? [path]
        : []
})

const importSpecifiers = (file: string): string[] => [...readFileSync(file, 'utf-8').matchAll(/from '([^']+)'/g)].map(match => match[1]!)

// Browser features may use the UI kit, but no ProseMirror layer imports product or application code.
describe('@lixpi/prosemirror dependency direction', () => {
    it('imports no product editor, workspace or application code', () => {
        const forbidden = sourceFiles(import.meta.dirname).flatMap(file => importSpecifiers(file)
            .filter(specifier => /^@lixpi\/(canvas-components|capability-system|auth-client)\b/.test(specifier) || specifier.startsWith('$src/'))
            .map(specifier => `${file}: ${specifier}`))

        expect(forbidden).toEqual([])
    })

    it('keeps shared and backend code independent of browser features', () => {
        const directories = [
            resolve(import.meta.dirname, 'shared'),
            resolve(import.meta.dirname, 'backend'),
        ]
        const forbidden = directories.flatMap(directory => sourceFiles(directory)).flatMap(file => importSpecifiers(file)
            .filter(specifier => /^@lixpi\/(ui-kit|ui-primitives|themes|prosemirror-themes)\b/.test(specifier)
                || specifier.startsWith('@lixpi/prosemirror/frontend/')
                || specifier.startsWith('../frontend/'))
            .map(specifier => `${file}: ${specifier}`))

        expect(forbidden).toEqual([])
    })
})
