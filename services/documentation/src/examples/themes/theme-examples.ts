import {
    getThemeStylesheet,
    themeNames,
    themePresets,
    themeStylesheetRoles,
    type ApplicationTheme,
} from '@lixpi/themes'
import { ApplicationThemeBinding } from '@lixpi/themes/browser'
import { html } from '@lixpi/ui-primitives/dom'
import { createTextInput } from '@lixpi/ui-kit/components/text-input'

import {
    type ExampleOwner,
} from '../../catalog/catalog.ts'
import { UiExample } from '../ui-example.ts'

type Swatch = {
    label: string
    value: string
}

const colorPattern = /^(#|rgb|hsl)/i

const isColor = (value: unknown): value is string => typeof value === 'string' && colorPattern.test(
    value.trim(),
)

// Flattens a nested role group into labelled color swatches.
const collectSwatches = (
    prefix: string,
    value: unknown,
): Swatch[] => {
    if (isColor(value))
        return [{
            label: prefix,
            value,
        }]

    if (
        !value
        || typeof value !== 'object'
    )
        return []

    return Object.entries(value).flatMap(([key, child]) => collectSwatches(prefix ? `${prefix}.${key}` : key, child))
}

const renderSwatches = (swatches: readonly Swatch[]): HTMLElement =>
    html`
        <div className="documentation-ui-swatches">
            ${swatches.map(swatch => {
                const colorStyle = { background: swatch.value }

                return html`
                    <figure className="documentation-ui-swatch">
                        <span
                            className="documentation-ui-swatch-color"
                            style=${colorStyle}
                        ></span>
                        <figcaption className="documentation-ui-swatch-label">
                            <span>${swatch.label}</span>
                            <br />
                            <span className="documentation-ui-swatch-value">${swatch.value}</span>
                        </figcaption>
                    </figure>
                ` as HTMLElement
            })}
        </div>
    ` as HTMLElement

const themeOptions = (): Record<string, string> => Object.fromEntries(
    themeNames.map(name => [name, name]),
)

class ThemePresetsExample {
    private readonly example: UiExample
    private readonly roles: HTMLElement
    private readonly palette: HTMLElement
    private readonly stylesheet: HTMLElement
    private themeName: string = themeNames[0]

    constructor(host: HTMLElement) {
        this.example = new UiExample(
            host,
            'Each preset is a complete ApplicationTheme. Choose a preset to see its semantic color roles, the palette it is built from and the CSS custom properties its stylesheet publishes.',
        )
        this.roles = this.example.specimen('Semantic roles')
        this.palette = this.example.specimen('Palette')
        this.stylesheet = this.example.specimen('Stylesheet roles')
        this.example.frame.select(
            'Preset',
            this.themeName,
            themeOptions(),
            name => {
                this.themeName = name
                this.render()
            },
        )
        this.example.frame.code(
            () => [
                "import { getTheme, getThemeStylesheet, themeStylesheetRoles } from '@lixpi/themes'",
                '',
                `const theme = getTheme('${this.themeName}')`,
                'const accent = theme.accent.primary',
                `const { palette, selector } = getThemeStylesheet('${this.themeName}')`,
                "const cssRoles = themeStylesheetRoles(theme) // published as --theme-<role>",
            ].join('\n'),
        )
        this.render()
    }

    get frame() {
        return this.example.frame
    }

    private render(): void {
        const stylesheet = getThemeStylesheet(this.themeName)
        const theme: ApplicationTheme = stylesheet.theme
        const roles = (['surface', 'text', 'border', 'accent'] as const).flatMap(group => collectSwatches(group, theme[group]))
        const feedback = (['info', 'success', 'warning', 'danger'] as const).map(
            name => ({
                label: `feedback.${name}`,
                value: theme.feedback[name],
            }),
        )
        this.roles.replaceChildren(
            renderSwatches([...roles, ...feedback]),
        )
        this.palette.replaceChildren(
            renderSwatches(
                Object.entries(stylesheet.palette).flatMap(
                    ([label, value]) => (isColor(value) ? [{
                        label,
                        value,
                    }] : []),
                ),
            ),
        )
        const cssRoles = Object.entries(
            themeStylesheetRoles(theme),
        )
        this.stylesheet.replaceChildren(
            html`
                <pre className="documentation-ui-output">${cssRoles.map(([role, value]) => `--theme-${role}: ${String(value)}`).join('\n')}</pre>
            ` as HTMLElement,
        )
        this.example.frame.report(
            `${theme.name} is a ${theme.colorScheme} theme with ${cssRoles.length} stylesheet roles. Its stylesheet applies to ${stylesheet.selector}.`,
        )
    }

    destroy(): void {
        this.example.destroy()
    }
}

class ThemeScopeExample {
    private readonly example: UiExample
    private readonly scopes: HTMLElement[]

    constructor(host: HTMLElement) {
        this.example = new UiExample(
            host,
            'A data-color-theme attribute scopes a preset to one subtree. Both regions below contain the same markup; every color comes from the inherited --theme-* properties of its own scope.',
        )
        this.scopes = themePresets.map(
            theme => html`
                <section
                    className="documentation-ui-scope"
                    data-color-theme=${theme.name}
                    data-theme=${theme.colorScheme}
                >
                    <strong>${theme.name}</strong>
                    <span className="documentation-ui-scope-muted">Muted text uses --theme-text-muted.</span>
                    <span className="documentation-ui-scope-accent">Accent text uses --theme-accent.</span>
                    <label className="documentation-ui-scope-row">
                        <span>Name</span>
                        ${createTextInput({
                            value: 'Lixpi',
                            ariaLabel: 'Name',
                        }).element}
                    </label>
                    <div className="application-panel-body">
                        <button
                            type="button"
                            className="navigation-side-panel-row navigation-side-panel-row-active"
                        ><span className="navigation-side-panel-row-title">Active row</span></button>
                        <button
                            type="button"
                            className="navigation-side-panel-row"
                        ><span className="navigation-side-panel-row-title">Row</span></button>
                    </div>
                </section>
            ` as HTMLElement,
        )
        this.example.specimen('Side by side', html`<div className="documentation-ui-scopes">${this.scopes}</div>` as HTMLElement)
        this.example.frame.select(
            'Second region',
            themePresets.at(-1)?.name ?? themeNames[0],
            themeOptions(),
            name => {
                const scope = this.scopes.at(-1)

                if (!scope)
                    return

                scope.dataset.colorTheme = name
                scope.dataset.theme = getThemeStylesheet(name).theme.colorScheme
                scope.querySelector('strong')!.textContent = name
            },
        )
        this.example.frame.code(
            () => [
                "import '@lixpi/themes/dist/scss/lixpi-light/theme'",
                "import '@lixpi/themes/dist/scss/one-dark-pro-mariana/theme'",
                '',
                "html`<section data-color-theme='one-dark-pro-mariana' data-theme='dark'>...</section>`",
            ].join('\n'),
        )
    }

    get frame() {
        return this.example.frame
    }

    destroy(): void {
        this.example.destroy()
    }
}

// The binding writes to the document root, so this example changes the whole
// documentation page and restores it when the example closes.
class ThemeBindingExample {
    private readonly example: UiExample
    private readonly listeners = new Set<(preference?: string) => void>()
    private readonly binding: ApplicationThemeBinding
    private readonly log: HTMLElement
    private preference = 'system'

    constructor(host: HTMLElement) {
        this.example = new UiExample(
            host,
            'ApplicationThemeBinding reads a preference from the host and writes data-color-theme and data-theme on the document root. "system" follows the operating system color scheme. Leaving this page destroys the binding, which restores the documentation theme.',
        )
        this.log = html`<pre className="documentation-ui-output"></pre>` as HTMLElement
        this.example.specimen('Applied presets', this.log)
        this.binding = new ApplicationThemeBinding({
            subscribePreference: listener => {
                this.listeners.add(listener)
                listener(this.preference)

                return () => this.listeners.delete(listener)
            },
            onChange: theme => {
                this.log.textContent = `${this.log.textContent ?? ''}${theme.name} (${theme.colorScheme})\n`
                this.example.frame.report(`The document now uses ${theme.name}.`)
            },
        })
        this.example.own(() => this.binding.destroy())
        this.example.frame.select(
            'Preference',
            this.preference,
            {
                system: 'system',
                ...themeOptions(),
            },
            preference => {
                this.preference = preference

                for (const listener of this.listeners)
                    listener(preference)
            },
        )
        this.example.frame.code(
            () => [
                "import { ApplicationThemeBinding } from '@lixpi/themes/browser'",
                '',
                'const binding = new ApplicationThemeBinding({',
                `    subscribePreference: listener => settings.subscribe(() => listener('${this.preference}')),`,
                '    onChange: theme => canvasThemes.apply(theme),',
                '})',
                '',
                '// Restores the previous root theme.',
                'binding.destroy()',
            ].join('\n'),
        )
    }

    get frame() {
        return this.example.frame
    }

    destroy(): void {
        this.example.destroy()
    }
}

export const createExample = (
    host: HTMLElement,
    id: string,
): ExampleOwner => {
    if (id === 'themes-presets')
        return new ThemePresetsExample(host)

    if (id === 'themes-scope')
        return new ThemeScopeExample(host)

    return new ThemeBindingExample(host)
}
