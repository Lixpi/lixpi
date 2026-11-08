import { lixpiLightTheme } from './presets/lixpi-light/theme.ts'
import { oneDarkProMarianaTheme } from './presets/one-dark-pro-mariana/theme.ts'
import { lixpiPalette } from './palettes/lixpi.ts'
import { marianaPalette } from './palettes/mariana.ts'
import { lixpiLightStylesheetRoles } from './adapters/lixpi-scss.ts'
import {
    marianaStylesheetPalette,
    oneDarkProMarianaStylesheetRoles,
} from './adapters/mariana-scss.ts'
import {
    type ApplicationTheme,
} from './template/application.ts'

export type ThemeStylesheet = {
    theme: ApplicationTheme
    selector: string
    palette: Readonly<Record<string, string>>
    roles: Readonly<Record<string, string>>
    paletteProperties?: Readonly<Record<string, string>>
}

const registrations = [
    {
        theme: lixpiLightTheme,
        selector: ':root:not([data-color-theme]), [data-color-theme="lixpi-light"]',
        palette: lixpiPalette,
        roles: lixpiLightStylesheetRoles,
    },
    {
        theme: oneDarkProMarianaTheme,
        selector: '[data-color-theme="one-dark-pro-mariana"]:not([data-theme="light"])',
        palette: marianaPalette,
        roles: oneDarkProMarianaStylesheetRoles,
        paletteProperties: marianaStylesheetPalette,
    },
] as const satisfies readonly ThemeStylesheet[]

export const themePresets = Object.freeze(
    registrations.map(({ theme }) => theme),
)
export type ThemeName = typeof themePresets[number]['name']
export const themeNames = Object.freeze(
    themePresets.map(theme => theme.name),
)

const registrationsByName = new Map<string, ThemeStylesheet>(
    registrations.map(registration => [registration.theme.name, registration]),
)

export const getThemeStylesheet = (name: string): ThemeStylesheet => {
    const registration = registrationsByName.get(name)

    if (!registration)
        throw new Error(`Unknown theme: ${name}`)

    return registration
}

export const getTheme = (name: string): ApplicationTheme => getThemeStylesheet(name).theme

export {
    lixpiLightTheme,
    oneDarkProMarianaTheme,
    lixpiPalette,
    marianaPalette,
}
export { marianaShadowPalette } from './palettes/mariana.ts'
export {
    defineTheme,
    type ThemeDefinition,
} from './define-theme.ts'
export { type ApplicationTheme } from './template/application.ts'
export { type ComponentTheme } from './template/components.ts'
export { themeStylesheetRoles } from './projections/scss-roles.ts'
export {
    adaptGentelella,
    gentelellaStylesheetRules,
} from './adapters/gentelella.ts'
