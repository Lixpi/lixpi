// @vitest-environment node

import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    compileAsync,
    type FileImporter,
} from 'sass'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

const webUiSourceDirectory = resolve(import.meta.dirname, '..')

const packageStylesheetImporter: FileImporter<'async'> = {
    findFileUrl(url) {
        if (url.startsWith('$src/'))
            return pathToFileURL(resolve(webUiSourceDirectory, url.slice(5)))

        const packageImport = url.match(/^@lixpi\/([^/]+)\/(.+)$/)

        if (!packageImport)
            return null

        const [, packageName, subpath] = packageImport
        const packageDirectory = resolve(import.meta.dirname, '../../packages/lixpi', packageName)
        const packageJson = JSON.parse(
            readFileSync(resolve(packageDirectory, 'package.json'), 'utf-8'),
        )
        const exportTarget = packageJson.exports?.[`./${subpath}`]
        const stylesheetPath = typeof exportTarget === 'string'
            ? exportTarget
            : exportTarget?.sass

        return stylesheetPath
            ? pathToFileURL(resolve(packageDirectory, stylesheetPath))
            : null
    },
}

describe('workspace canvas styles', () => {
    it('compiles through the package Sass exports used by the web UI', async () => {
        const stylesheetPath = resolve(
            import.meta.dirname,
            '../../packages/lixpi/canvas-components/src/workspace/frontend/workspace/workspace-canvas.scss',
        )
        const result = await compileAsync(stylesheetPath, {
            importers: [packageStylesheetImporter],
            silenceDeprecations: [
                'color-4-api',
                'import',
            ],
        })

        expect(result.css).toContain('.workspace-pane')
    })

    it('compiles inside the complete web UI stylesheet graph', async () => {
        const result = await compileAsync(resolve(webUiSourceDirectory, 'sass/styles.scss'), {
            importers: [packageStylesheetImporter],
            silenceDeprecations: [
                'color-4-api',
                'color-functions',
                'global-builtin',
                'import',
            ],
        })

        expect(result.css).toContain('.execution-trace')
    })

    it('gives prompt references on the workspace the shared dark chip palette', () => {
        const workspaceScss = readFileSync(resolve(import.meta.dirname, 'workspace-theme.scss'), 'utf-8')

        expect(workspaceScss).toContain('@include prompt-reference-chip-on-dark-surface;')
    })

    // The sidebar tree renders without any layout when its stylesheet is not
    // loaded, so the layout must import it and it must compile.
    it('loads and compiles the workspace sidebar styles', async () => {
        const layoutSource = readFileSync(resolve(webUiSourceDirectory, 'views/layouts/layout.ts'), 'utf-8')
        const result = await compileAsync(
            resolve(webUiSourceDirectory, 'components/navigationSidePanel/workspace-navigation/workspace-navigation.scss'),
            {
                importers: [packageStylesheetImporter],
                silenceDeprecations: [
                    'color-4-api',
                    'import',
                ],
            },
        )

        expect(layoutSource.includes("import '$src/components/navigationSidePanel/workspace-navigation/workspace-navigation.scss'")).toBe(true)
        expect(result.css).toContain('.nested-list-item')
        expect(result.css).toContain('.nested-list-block-trigger')
        expect(result.css).toContain('.nested-list-block-panel')
    })
})
