// @vitest-environment node
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { API } from 'typescript/unstable/sync'
import {
    describe,
    expect,
    it,
} from 'vitest'

function typescriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) return typescriptFiles(path)
        return entry.name.endsWith('.ts') ? [path] : []
    })
}

describe('components directory layout', () => {
    it('keeps every direct child in a dedicated directory', () => {
        const files = readdirSync(resolve(__dirname, '../components'), { withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
        expect(files).toEqual([])
    })
})

describe('canvas source integrity', () => {
    it('checks extracted runtime and renderer composition contracts without emitting files', () => {
        const files = [
            ...['canvas-engine', 'canvas-components'].flatMap(name => typescriptFiles(resolve(__dirname, '../../packages/lixpi', name, 'examples'))),
            ...['canvas-engine', 'canvas-components', 'canvas-components-lixpi-specific', 'ui-primitives'].flatMap(name => typescriptFiles(resolve(__dirname, '../../packages/lixpi', name, 'src'))),
            ...typescriptFiles(resolve(__dirname, '../canvas-adapters')),
            resolve(__dirname, '../components/workspaceCanvasView/workspaceCanvasView.ts'),
            resolve(__dirname, '../services/asset-service.ts'),
        ].filter(file => !file.endsWith('.test.ts'))
        const api = new API()
        try {
            const snapshot = api.updateSnapshot({ openFiles: files })
            const diagnostics = files.flatMap(file => {
                const project = snapshot.getDefaultProjectForFile(file)
                if (!project) return [`No TypeScript project for ${file}`]
                return project.program.getSemanticDiagnostics(file)
                    .map(diagnostic => `${diagnostic.fileName}:${diagnostic.pos}: ${diagnostic.text}`)
            })
            expect(diagnostics).toEqual([])
        } finally {
            api.close()
        }
    })

    it('parses native TypeScript sources without emitting files or initializing browser rendering', () => {
        const files = [
            ...['canvas-engine', 'canvas-components'].flatMap(name => typescriptFiles(resolve(__dirname, '../../packages/lixpi', name, 'examples'))),
            ...typescriptFiles(__dirname),
            ...typescriptFiles(resolve(__dirname, '../canvas-adapters')),
            resolve(__dirname, '../components/workspaceCanvasView/workspaceCanvasView.ts'),
            ...['canvas-engine', 'canvas-components', 'canvas-components-lixpi-specific', 'ui-primitives'].flatMap(name => typescriptFiles(resolve(__dirname, '../../packages/lixpi', name, 'src'))),
        ]
        const api = new API()
        try {
            const snapshot = api.updateSnapshot({ openFiles: files })
            const diagnostics = files.flatMap(file => {
                const project = snapshot.getDefaultProjectForFile(file)
                if (!project) return [`No TypeScript project for ${file}`]
                return [...project.program.getSyntacticDiagnostics(file), ...project.program.getBindDiagnostics(file)]
                    .map(diagnostic => `${diagnostic.fileName}:${diagnostic.pos}: ${diagnostic.text}`)
            })
            expect(diagnostics).toEqual([])
        } finally {
            api.close()
        }
    })
})
