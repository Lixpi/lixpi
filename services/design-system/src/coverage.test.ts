import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'

import * as gentelella from '@lixpi/ui-kit-gentelella'

import {
    CANVAS_ROUTE_PATH,
    DESIGN_SYSTEM_MODES,
    OVERVIEW_ROUTE_PATH,
    getRouteMode,
    routes,
} from '$src/routes.ts'

// The source of every module in this service except tests. Coverage is checked
// by export name, so a new public component fails here until a page shows it.
const sources = Object.entries(
    import.meta.glob<string>(
        ['./**/*.ts', '!./**/*.test.ts'],
        {
            eager: true,
            import: 'default',
            query: '?raw',
        },
    ),
)
const source = sources.map(([, text]) => text).join('\n')

const missingFrom = (names: readonly string[]): string[] => names.filter(name => !new RegExp(`\\b${name}\\b`).test(source))

// The service root holds its workspace copy of the shared packages.
const uiKitExports = (): string[] => {
    const manifest = JSON.parse(
        readFileSync(
            resolve(process.cwd(), 'packages/lixpi/ui-kit/package.json'),
            'utf8',
        ),
    ) as { exports: Record<string, unknown> }

    return Object.keys(manifest.exports).filter(path => path.startsWith('./components/'))
}

// =============================================================================
// COMPONENT COVERAGE
// =============================================================================

describe('design system coverage', () => {
    it('shows every runtime export of the Gentelella UI kit', () => void expect(missingFrom(Object.keys(gentelella))).toEqual([]))

    it('shows every runtime export of each UI-kit component entry point', async () => {
        const missing: string[] = []

        for (const path of uiKitExports()) {
            const module = await import(`@lixpi/ui-kit${path.slice(1)}`) as Record<string, unknown>
            missing.push(...missingFrom(Object.keys(module)).map(name => `${path}: ${name}`))
        }

        expect(missing).toEqual([])
    })

    it('renders the UI-kit icon catalog from the module namespace', () => void expect(missingFrom(['uiKitSvg', 'createCollapseExpandIcon', 'configureUiKit', 'uiKitSettings'])).toEqual([]))
})

// =============================================================================
// ROUTES AND MODES
// =============================================================================

describe('design system routes', () => {
    it('gives each route a unique path', () => {
        const paths = routes.map(route => route.path)

        expect(new Set(paths).size).toBe(paths.length)
    })

    it('starts each mode at one of its own routes', () => {
        expect(DESIGN_SYSTEM_MODES.map(mode => getRouteMode(mode.homePath))).toEqual(DESIGN_SYSTEM_MODES.map(mode => mode.mode))
        expect(getRouteMode(OVERVIEW_ROUTE_PATH)).toBe('components')
        expect(getRouteMode(CANVAS_ROUTE_PATH)).toBe('canvas')
    })

    it('keeps canvas items in canvas mode', () => {
        const misplaced = routes
            .filter(route => route.path.startsWith(CANVAS_ROUTE_PATH) !== (route.mode === 'canvas'))
            .map(route => route.path)

        expect(misplaced).toEqual([])
    })

    it('returns no mode for unknown paths', () => void expect(getRouteMode('/missing')).toBeNull())
})
