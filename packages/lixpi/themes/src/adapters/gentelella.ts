import {
    type ApplicationTheme,
} from '../template/application.ts'
import { themeStylesheetRoles } from '../projections/scss-roles.ts'

type ThemeRole = keyof ReturnType<typeof themeStylesheetRoles>

// Gentelella owns the property names and selectors on the left. The application
// theme supplies their values, including the three additional chart swatches.
const gentelellaStyleRules = (role: (name: ThemeRole) => string): Record<string, Record<string, string>> => ({
    '&': {
        '--body-bg': role('background'),
        '--bg-surface': role('surface'),
        '--bg-surface-secondary': role('surface-secondary'),
        '--text': role('text'),
        '--text-secondary': role('text-secondary'),
        '--text-muted': role('text-muted'),
        '--text-disabled': role('text-disabled'),
        '--border-color': role('border'),
        '--border-color-light': role('border-subtle'),
        '--border-translucent': role('divider'),
        '--sidebar-bg': role('sidebar-background'),
        '--sidebar-hover': role('surface-hover'),
        '--sidebar-active': role('surface-active'),
        '--sidebar-text': role('text-secondary'),
        '--sidebar-text-hover': role('text'),
        '--sidebar-text-active': role('heading'),
        '--sidebar-border': role('divider'),
        '--primary': role('accent'),
        '--primary-dk': role('syntax-function'),
        '--primary-lt': 'color-mix(in srgb, var(--primary) 14%, transparent)',
        '--blue': role('accent-secondary'),
        '--azure': role('info'),
        '--green': role('success'),
        '--lime': role('success'),
        '--yellow': role('warning'),
        '--orange': role('chart-series-2'),
        '--red': role('danger'),
        '--pink': role('syntax-keyword'),
        '--purple': role('chart-series-1'),
        '--indigo': role('chart-series-3'),
        '--cyan': role('accent'),
        '--green-lt': 'color-mix(in srgb, var(--green) 14%, transparent)',
        '--red-lt': 'color-mix(in srgb, var(--red) 14%, transparent)',
        '--yellow-lt': 'color-mix(in srgb, var(--yellow) 14%, transparent)',
        '--blue-lt': 'color-mix(in srgb, var(--blue) 14%, transparent)',
        '--azure-lt': 'color-mix(in srgb, var(--azure) 14%, transparent)',
        '--purple-lt': 'color-mix(in srgb, var(--purple) 14%, transparent)',
        '--cyan-lt': 'color-mix(in srgb, var(--cyan) 14%, transparent)',
        '--shadow': role('shadow-control'),
        '--shadow-card': role('shadow-surface'),
    },
    '& :is(h1, h2, h3, h4, h5, h6, strong, th)': {
        'color': role('heading'),
    },
    '& .topbar': {
        'background': role('topbar-background'),
        'box-shadow': role('shadow-topbar'),
    },
    '& .sidebar': {
        'box-shadow': role('shadow-sidebar'),
    },
    '& :is(.sidebar, .sidebar-brand, .sidebar-footer, .topbar, .card, .card-header, .card-footer, .form-control, .btn, .form-actions, .input-affix, .input-affix .affix, .table th, .table td, .toggle-row, .banner)': {
        'border': 'none',
    },
    '& .card': {
        'box-shadow': role('shadow-surface'),
    },
    '& .segmented input:checked + span, & .segmented label:has(input:checked)': {
        'box-shadow': role('shadow-control'),
    },
    '& .nav-link .icon': {
        'opacity': '0.85',
    },
    '& .nav-group': {
        'margin-bottom': role('components-navigation-section-group-base-margin-bottom'),
        'padding-inline': '0',
    },
    '& .nav-link': {
        'padding-inline': '20px',
        'border-radius': '0',
    },
    '& .brand-name, & .sidebar-user .name': {
        'color': role('text'),
    },
    '& .nav-label': {
        'font-family': role('font-family'),
        'color': role('sidebar-section'),
        'padding-inline': role('components-navigation-section-heading-base-padding-inline'),
        'padding-block': role('components-navigation-section-heading-base-padding-block'),
        'margin': role('components-navigation-section-heading-base-margin'),
        'font-size': role('components-navigation-section-heading-base-font-size'),
        'line-height': role('components-navigation-section-heading-base-line-height'),
        'font-weight': role('components-navigation-section-heading-base-font-weight'),
        'letter-spacing': role('components-navigation-section-heading-base-letter-spacing'),
        'text-transform': role('components-navigation-section-heading-base-text-transform'),
    },
    '& .brand-icon, & .sidebar-user .avatar, & .btn-primary': {
        'color': role('button-text'),
        'background': role('button-background'),
    },
    '& .btn-primary:hover': {
        'background': role('button-hover'),
    },
})

export const adaptGentelella = (theme: ApplicationTheme): Record<string, Record<string, string>> => {
    const values = themeStylesheetRoles(theme)

    return gentelellaStyleRules(name => values[name])
}

// The SCSS mixin follows the same mapping as the native adapter. References
// keep it scoped to the selected theme and respond to a theme switch.
export const gentelellaStylesheetRules = (): Record<string, Record<string, string>> => gentelellaStyleRules(name => `var(--theme-${name})`)
