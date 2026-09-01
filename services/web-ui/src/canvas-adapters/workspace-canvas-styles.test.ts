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

const packageStylesheetImporter: FileImporter<'async'> = {
    findFileUrl(url) {
        const packageImport = url.match(/^@lixpi\/([^/]+)\/(.+)$/)
        if (!packageImport) return null

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
            '../../packages/lixpi/canvas-components-lixpi-specific/src/frontend/workspace/workspace-canvas.scss',
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
})
