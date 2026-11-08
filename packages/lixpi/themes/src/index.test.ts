import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    adaptGentelella,
    getTheme,
    getThemeStylesheet,
    lixpiLightTheme,
    oneDarkProMarianaTheme,
    themeNames,
    themePresets,
    themeStylesheetRoles,
} from './index.ts'
import { createSharedComponentValues } from './shared/components.ts'

const leafKinds = (value: unknown, path = ''): Record<string, string> => {
    if (
        value === null
        || typeof value !== 'object'
    )
        return { [path]: typeof value }

    return Object.fromEntries(
        Object.entries(value).flatMap(([key, child]) =>
            Object.entries(leafKinds(child, path ? `${path}.${key}` : key)),
        ),
    )
}

// =============================================================================
// COMPLETE PRESET CONTRACT
// =============================================================================

describe('theme definitions', () => {
    it('gives every preset the same complete nested roles and leaf kinds', () => void expect(leafKinds(oneDarkProMarianaTheme)).toEqual(leafKinds(lixpiLightTheme)))

    it('keeps deliberately shared component values equal and independently owned', () => {
        expect(oneDarkProMarianaTheme.components).toEqual(lixpiLightTheme.components)
        expect(oneDarkProMarianaTheme.components).not.toBe(lixpiLightTheme.components)
        const first = createSharedComponentValues()
        const second = createSharedComponentValues()
        first.slidingDropdown.workspace.indicator.openBorderWidth = 99
        first.contextPreview.styles.tooltipColor = 'changed'

        expect(second.slidingDropdown.workspace.indicator.openBorderWidth).toBe(1)
        expect(second.contextPreview.styles.tooltipColor).toBe(lixpiLightTheme.components.contextPreview.styles.tooltipColor)
        expect(first.slidingDropdown.standalone.indicator.openBorderWidth).toBe(1.5)
    })
})

// =============================================================================
// PUBLIC REGISTRY AND SCSS ADAPTATION
// =============================================================================

describe('theme registry', () => {
    it('publishes one TypeScript entrypoint and labels every generated Sass export', () => {
        const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { exports: Record<string, string | {
            types: string
            sass: string
            style: string
            default: string
        }> }
        const entrypoints = Object.entries(manifest.exports).map(([name, target]) => [name, typeof target === 'string' ? target : target.default])
        const typescriptExports = entrypoints.filter(([, path]) => path.endsWith('.ts'))
        expect(typescriptExports).toEqual([['.', './src/index.ts']])
        const generatedExports = entrypoints.filter(([, path]) => path.startsWith('./dist/scss/'))
        expect(generatedExports.length).toBeGreaterThan(0)
        expect(generatedExports.every(([name]) => name.startsWith('./dist/scss'))).toBe(true)
    })

    it('derives unique names and both lookups from the registered presets', () => {
        expect(new Set(themeNames).size).toBe(themePresets.length)
        expect(Object.isFrozen(themePresets)).toBe(true)
        expect(Object.isFrozen(themeNames)).toBe(true)

        for (const theme of themePresets) {
            expect(getTheme(theme.name)).toBe(theme)
            expect(getThemeStylesheet(theme.name).theme).toBe(theme)
        }
    })

    it('rejects an unknown theme instead of falling back to another preset', () => {
        expect(() => getTheme('missing')).toThrow('Unknown theme: missing')
        expect(() => getThemeStylesheet('missing')).toThrow('Unknown theme: missing')
    })

    it('projects the same complete stylesheet role set for every preset', () => {
        const lightRoles = themeStylesheetRoles(lixpiLightTheme)
        const darkRoles = themeStylesheetRoles(oneDarkProMarianaTheme)
        expect(Object.keys(darkRoles).sort()).toEqual(Object.keys(lightRoles).sort())

        for (const theme of themePresets)
            expect(Object.keys(getThemeStylesheet(theme.name).roles).sort()).toEqual(Object.keys(lightRoles).sort())
    })

    it('preserves Mariana sidebar labels while projecting changes from the shared theme', () => {
        expect(adaptGentelella(oneDarkProMarianaTheme)['& .nav-label']).toEqual({
            'color': '#d19a66',
            'padding-inline': '20px',
            'padding-block': '16px 4px',
            'margin': '0',
            'font-family': oneDarkProMarianaTheme.typography.body.fontFamily,
            'font-size': '14px',
            'line-height': '1.5',
            'font-weight': '500',
            'letter-spacing': 'normal',
            'text-transform': 'none',
        })
        const customTheme = structuredClone(oneDarkProMarianaTheme)
        customTheme.components.navigation.sectionHeading.base.fontSize = '17px'
        customTheme.components.navigation.sectionHeading.base.paddingInline = '24px'

        expect(adaptGentelella(customTheme)['& .nav-label']).toMatchObject({
            'font-size': '17px',
            'padding-inline': '24px',
        })
        expect(getThemeStylesheet('one-dark-pro-mariana').roles['components-navigation-section-heading-base-font-size']).toBe('14px')
    })

    it('keeps upstream Mariana CSS variables in its adapter and concrete paints in native values', () => {
        expect(oneDarkProMarianaTheme.surface.page).toBe('#282c34')
        const stylesheet = getThemeStylesheet('one-dark-pro-mariana')
        expect(stylesheet.roles.background).toBe('var(--mariana-editor-background)')
        expect(stylesheet.paletteProperties?.['--mariana-editor-background']).toBe(oneDarkProMarianaTheme.surface.page)
        expect(stylesheet.selector).toBe('[data-color-theme="one-dark-pro-mariana"]:not([data-theme="light"])')
    })
})
