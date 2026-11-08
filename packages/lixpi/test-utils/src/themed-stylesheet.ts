// Helpers for tests that assert on what a stylesheet renders.
//
// Stylesheets read their values from theme tokens, which compile to
// `var(--theme-<role>, <light default>)`. A test that searches the source for a
// literal value breaks whenever a value moves into a token, even though the
// rendered value is unchanged. Compiling the stylesheet and replacing each
// theme variable with its light default lets the test check the value the
// default theme actually renders.
//
// This entry point is separate from the package root so that only workspaces
// that compile stylesheets need `sass`, an optional peer dependency.
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import {
    compileAsync,
    type FileImporter,
} from 'sass'

// The test runner places every workspace package beside this one, so the
// packages directory is two levels above this file.
const packagesDirectory = resolve(import.meta.dirname, '../..')

const THEME_VARIABLE = 'var(--theme-'

// Resolves `@lixpi/<package>/<subpath>` through the package's `sass` export,
// or straight to the file when the package exports no such entry.
const packageImporter: FileImporter<'async'> = {
    findFileUrl(url) {
        if (!url.startsWith('@lixpi/'))
            return null

        const [packageName, ...subpath] = url.slice('@lixpi/'.length).split('/')
        const packageDirectory = resolve(packagesDirectory, packageName)
        const exports = JSON.parse(
            readFileSync(
                resolve(packageDirectory, 'package.json'),
                'utf-8',
            ),
        ).exports ?? {}
        const exportTarget = exports[`./${subpath.join('/')}`]
        const stylesheetPath = typeof exportTarget === 'string'
            ? exportTarget
            : exportTarget?.sass

        // Sass checks the result against the global URL class, which a DOM test
        // environment replaces, so the URL is rebuilt with the global constructor.
        return new URL(pathToFileURL(
            resolve(packageDirectory, stylesheetPath ?? subpath.join('/')),
        ).href)
    },
}

// Replaces every `var(--theme-<role>, <fallback>)` with its fallback, including
// theme variables nested inside other `var()` fallbacks.
export const withThemeDefaults = (css: string): string => {
    let resolved = ''
    let index = 0

    while (index < css.length) {
        const start = css.indexOf(THEME_VARIABLE, index)

        if (start === -1) {
            resolved += css.slice(index)

            break
        }

        resolved += css.slice(index, start)

        const open = start + 'var'.length
        let depth = 0
        let comma = -1
        let end = -1

        for (let position = open; position < css.length; position++) {
            const character = css[position]

            if (character === '(')
                depth++
            else if (character === ')') {
                depth--

                if (depth === 0) {
                    end = position

                    break
                }
            } else if (
                character === ','
                && depth === 1
                && comma === -1
            )
                comma = position
        }

        if (end === -1)
            throw new Error(`Unterminated theme variable at ${start}`)

        resolved += comma === -1 ? '' : withThemeDefaults(
            css.slice(comma + 1, end).trim(),
        )
        index = end + 1
    }

    return resolved
}

// Compiles a stylesheet and returns the CSS the default light theme renders.
export const compileThemedStylesheet = async (stylesheetPath: string): Promise<string> => {
    const result = await compileAsync(
        stylesheetPath,
        {
            importers: [packageImporter],
            silenceDeprecations: [
                'color-4-api',
                'color-functions',
                'global-builtin',
                'import',
            ],
        },
    )

    return withThemeDefaults(result.css)
}
