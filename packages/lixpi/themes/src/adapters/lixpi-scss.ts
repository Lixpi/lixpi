import {
    themeStylesheetRoles,
    withStylesheetAliases,
} from '../projections/scss-roles.ts'
import { lixpiLightTheme } from '../presets/lixpi-light/theme.ts'

export const lixpiLightStylesheetRoles = withStylesheetAliases(
    themeStylesheetRoles(lixpiLightTheme),
    {
        surface: 'background',
        'surface-secondary': 'surface',
        'surface-active': 'navigation-active',
        'sidebar-section': 'heading',
        'topbar-background': 'background',
        info: 'link',
        'syntax-string': 'code-text',
        'syntax-constant': 'syntax-number',
        'syntax-operator': 'syntax-keyword',
        'math-greek': 'syntax-keyword',
        'math-number': 'syntax-number',
        'math-operator': 'syntax-operator',
        'math-function': 'syntax-function',
    },
)
