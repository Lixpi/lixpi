import { select } from 'd3-selection'
import { html } from '@lixpi/ui-primitives/dom'
import {
    canvasLibraryTextRows,
    canvasLibraryToggleGeometry,
} from '@lixpi/ui-kit/canvas-library'
import {
    createPureDropdown,
    type PureDropdownInstance,
    type DropdownOption,
} from '@lixpi/ui-kit/components/dropdown'
import { createToggleSwitch } from '@lixpi/ui-kit/components/toggle-switch'
import {
    resolveCanvasThemeColor,
    type CanvasThemeStore,
    type CanvasTheme,
} from '@lixpi/canvas-components/theme'

type ThemeLeaf = string | number | boolean | unknown[]
type ThemeOption = DropdownOption & { value: string }
type ThemeToggle = ReturnType<typeof createToggleSwitch>

const labelFor = (name: string): string =>
    name
        .replace(/^--/, '')
        .replace(/-/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, character => character.toUpperCase())

const readPath = (
    theme: CanvasTheme,
    path: string[],
): ThemeLeaf => {
    let current: unknown = theme

    for (const part of path)
        current = (current as Record<string, unknown>)[part]

    return current as ThemeLeaf
}

export class CanvasThemeEditor {
    readonly el: HTMLElement
    private readonly error = html`
        <output
            className="canvas-theme-error"
            role="status"
        ></output>
    ` as HTMLOutputElement
    private readonly fieldErrors = new Map<string, string>()
    private readonly fields = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
    private readonly colorFields = new Map<string, HTMLInputElement>()
    private readonly toggles = new Map<string, {
        instance: ThemeToggle
        svg: SVGSVGElement
        host: HTMLElement
    }>()
    private readonly dropdowns = new Map<string, PureDropdownInstance<ThemeOption>>()
    private readonly unsubscribe: () => void
    private readonly preset: PureDropdownInstance<ThemeOption>
    private readonly source: HTMLTextAreaElement

    constructor(
        private readonly theme: CanvasThemeStore,
        private readonly hostTheme: CanvasTheme,
        private readonly lightTheme: CanvasTheme,
    ) {
        this.preset = createPureDropdown<ThemeOption>({
            id: 'canvas-theme-preset',
            triggerLabel: 'Canvas theme preset',
            selectedValue: {
                title: this.lightTheme.name,
                value: this.lightTheme.name,
            },
            options: [
                {
                    title: this.lightTheme.name,
                    value: this.lightTheme.name,
                },
                {
                    title: 'One Dark Pro Mariana',
                    value: this.hostTheme.name,
                },
                {
                    title: 'Custom',
                    value: 'custom',
                },
            ],
            renderIconForOptions: false,
            renderIconForSelectedValue: false,
            mountToBody: true,
            popoverClassName: "canvas-library-dropdown-popover",
            onSelect: option => {
                if (option.value === 'custom')
                    return

                const preset = option.value === this.hostTheme.name ? this.hostTheme : this.lightTheme
                const root = this.el.ownerDocument.documentElement
                root.dataset.colorTheme = preset.name
                root.dataset.theme = preset.colorScheme
                this.apply(preset)
            },
        })
        this.source = html`
            <textarea
                aria-label="Canvas theme JSON"
                aria-description="Changes apply when the field loses focus."
                spellcheck="false"
                rows=${canvasLibraryTextRows.theme}
            ></textarea>
        ` as HTMLTextAreaElement
        this.source.addEventListener('change', () => {
            const entered = this.source.value

            try {
                this.theme.set(JSON.parse(entered) as CanvasTheme)
                this.markCustom()
                this.fieldErrors.delete('Theme JSON')
                this.source.removeAttribute('aria-invalid')
            } catch (error) {
                this.fieldErrors.set('Theme JSON', error instanceof Error ? error.message : String(error))
                this.source.setAttribute('aria-invalid', 'true')
            } finally {
                this.source.value = entered
                this.refreshErrors()
            }
        })
        this.el = html`
            <section className="canvas-theme-editor">
                ${this.preset.dom}
                ${this.error}
                ${Object.entries(theme.value).map(
                    ([group, value]) => value
                        && typeof value === "object"
                        ? this.group(
                            group,
                            value,
                            [group],
                        )
                        : this.field(
                            group,
                            value as ThemeLeaf,
                            [group],
                        ),
                )}
                <details className="canvas-theme-group">
                    <summary>Theme JSON</summary>
                    ${this.source}
                </details>
            </section>
        ` as HTMLElement
        this.unsubscribe = theme.subscribe(this.refresh)
        this.refresh(theme.value)
    }

    private markCustom(): void {
        this.preset.update({
            title: 'Custom',
            value: 'custom',
        })
    }

    private apply(value: CanvasTheme): void {
        try {
            this.theme.set(value)
            this.fieldErrors.clear()
            this.source.removeAttribute('aria-invalid')

            for (const input of this.fields.values())
                input.removeAttribute('aria-invalid')

            this.refresh(value)
            this.refreshErrors()
        } catch (error) {
            this.error.textContent = error instanceof Error ? error.message : String(error)
        }
    }

    private refreshErrors(): void {
        this.error.textContent = [...this.fieldErrors].map(([path, message]) => `${path}: ${message}`)
            .join('\n')
    }

    private group(
        name: string,
        value: object,
        path: string[],
    ): HTMLElement {
        const contents = Object.entries(value).map(([key, child]) => {
            const nextPath = [...path, key]

            return child
                && typeof child === 'object'
                && !Array.isArray(child)
                ? this.group(
                    key,
                    child,
                    nextPath,
                )
                : this.field(
                    key,
                    child as ThemeLeaf,
                    nextPath,
                )
        })

        return html`
            <details
                className="canvas-theme-group"
                open=${name === 'colors'}
            >
                <summary>${labelFor(name)}</summary>
                ${contents}
            </details>
        ` as HTMLElement
    }

    private field(
        name: string,
        value: ThemeLeaf,
        path: string[],
    ): HTMLElement {
        const key = path.join('.')
        const input = Array.isArray(value)
            ? html`
                <textarea
                    rows=${canvasLibraryTextRows.array}
                    spellcheck="false"
                ></textarea>
            ` as HTMLTextAreaElement
            : html`
                <input type=${typeof value === 'boolean'
                    ? 'checkbox'
                    : typeof value === 'number'
                        ? 'number'
                        : 'text'} />
            ` as HTMLInputElement

        if (typeof value === 'number')
            (input as HTMLInputElement).step = 'any'

        input.setAttribute('aria-label', `Theme ${key}`)
        this.fields.set(key, input)
        const update = (): void => {
            const entered = input.value

            try {
                let next: ThemeLeaf = input.value

                if (typeof value === 'boolean')
                    next = (input as HTMLInputElement).checked
                else if (typeof value === 'number') {
                    next = (input as HTMLInputElement).valueAsNumber

                    if (!Number.isFinite(next))
                        throw new Error('Enter a finite number.')
                } else if (Array.isArray(value))
                    next = JSON.parse(input.value) as unknown[]

                const copy = structuredClone(this.theme.value)
                let target: Record<string, unknown> = copy as unknown as Record<string, unknown>

                for (const part of path.slice(0, -1))
                    target = target[part] as Record<string, unknown>

                target[path.at(-1)!] = next
                this.theme.set(copy)
                this.markCustom()
                this.fieldErrors.delete(key)
                input.removeAttribute('aria-invalid')
            } catch (error) {
                this.fieldErrors.set(key, error instanceof Error ? error.message : String(error))
                input.setAttribute('aria-invalid', 'true')
            } finally {
                input.value = entered
                this.refreshErrors()
            }
        }
        input.addEventListener(Array.isArray(value)
            || typeof value === 'boolean'
            ? 'change'
            : 'input', update)
        let control: HTMLElement | SVGSVGElement = input

        if (typeof value === 'boolean') {
            const toggleHost = html`<span className="canvas-theme-toggle"></span>` as HTMLSpanElement
            const svg = select(toggleHost)
                .append("svg")
                .attr("role", "switch")
                .attr("tabindex", 0)
                .attr("aria-label", `Theme ${key}`)
                .attr(
                    "aria-checked",
                    String(value),
                )
                .node()

            if (!svg)
                throw new Error('Theme toggle host must be an SVG element')

            const geometry = canvasLibraryToggleGeometry(this.theme.value.controls.height)
            const instance = createToggleSwitch(
                select(svg),
                {
                    id: `canvas-theme-${key}`,
                    ...geometry.control,
                    checked: value,
                    onChange: checked => {
                        (input as HTMLInputElement).checked = checked
                        update()
                    },
                },
            )
            svg.addEventListener('keydown', event => {
                if (
                    event.key !== 'Enter'
                    && event.key !== ' '
                )
                    return

                event.preventDefault()
                ;(input as HTMLInputElement).checked = !instance.getChecked()
                update()
            })
            this.toggles.set(
                key,
                {
                    instance,
                    svg,
                    host: toggleHost,
                },
            )
            control = toggleHost
        } else if (
            path.at(-1) === 'lineCurve'
            || path.at(-1) === 'colorScheme'
        ) {
            const values = path.at(-1) === 'colorScheme' ? ['light', 'dark'] : ['bezier', 'straight', 'smoothstep', 'horizontal-bezier', 'orthogonal']
            const options = values.map(
                item => ({
                    title: item,
                    value: item,
                }),
            )
            const dropdown = createPureDropdown<ThemeOption>({
                id: `canvas-theme-${key}`,
                triggerLabel: `Theme ${key}`,
                selectedValue: {
                    title: String(value),
                    value: String(value),
                },
                options,
                renderIconForOptions: false,
                renderIconForSelectedValue: false,
                mountToBody: true,
                popoverClassName: "canvas-library-dropdown-popover",
                onSelect: option => {
                    input.value = option.value
                    update()
                },
            })
            this.dropdowns.set(key, dropdown)
            control = dropdown.dom
        } else if (
            typeof value === 'string'
            && (path[0] === 'colors' || name.toLowerCase().includes('color') || value.startsWith('var(--canvas-'))
        ) {
            const picker = html`
                <input
                    type="color"
                    aria-label=${`Pick theme ${key}`}
                />
            ` as HTMLInputElement
            picker.addEventListener('input', () => {
                input.value = picker.value
                update()
            })
            this.colorFields.set(key, picker)
            control = html`<span className="canvas-theme-color">${picker}${input}</span>` as HTMLElement
        }

        return html`<label className="canvas-theme-field"><span>${labelFor(name)}</span>${control}</label>` as HTMLElement
    }

    private refresh = (theme: CanvasTheme): void => {
        for (const [path, input] of this.fields) {
            if (
                input === input.ownerDocument.activeElement
                || this.fieldErrors.has(path)
            )
                continue

            const value = readPath(
                theme,
                path.split('.'),
            )

            if (typeof value === 'boolean') {
                ;(input as HTMLInputElement).checked = value
                const toggle = this.toggles.get(path)
                toggle?.instance.setChecked(value)

                if (toggle) {
                    const geometry = canvasLibraryToggleGeometry(theme.controls.height)
                    toggle.instance.resize(
                        geometry.control.x,
                        geometry.control.y,
                        geometry.control.width,
                        geometry.control.height,
                    )
                    select(toggle.svg)
                        .attr("width", geometry.host.width)
                        .attr("height", geometry.host.height)
                    toggle.host.style.setProperty('--canvas-theme-toggle-width', `${geometry.host.width}px`)
                    toggle.host.style.setProperty('--canvas-theme-toggle-height', `${geometry.host.height}px`)
                }

                toggle?.svg.setAttribute(
                    'aria-checked',
                    String(value),
                )
            } else {
                input.value = Array.isArray(value) ? JSON.stringify(value) : String(value)
                this.dropdowns.get(path)?.update({
                    title: String(value),
                    value: String(value),
                })
            }
        }

        for (const [path, input] of this.colorFields) {
            const value = readPath(
                theme,
                path.split('.'),
            )

            const color = typeof value === 'string' ? resolveCanvasThemeColor(theme, value) : ''
            const hex = /^#[a-f0-9]{6}$/i.test(color)
            input.hidden = !hex

            if (hex)
                input.value = color
        }

        if (
            this.source !== this.source.ownerDocument.activeElement
            && !this.fieldErrors.has('Theme JSON')
        )
            this.source.value = JSON.stringify(
                theme,
                null,
                2,
            )
    }

    destroy(): void {
        this.unsubscribe()
        this.preset.destroy()

        for (const dropdown of this.dropdowns.values())
            dropdown.destroy()

        for (const toggle of this.toggles.values())
            toggle.instance.destroy()

        this.el.remove()
    }
}
