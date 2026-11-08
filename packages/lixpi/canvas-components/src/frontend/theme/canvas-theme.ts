import { normalizeHexColor } from '@lixpi/ui-primitives/gradients'
import {
    type ConnectionSettings,
} from '@lixpi/canvas-engine/frontend/connectors'
import {
    createCanvasEffectsTheme,
    type CanvasEffectsTheme,
} from './effects-theme.ts'
export * from './effects-theme.ts'
import { createLixpiLightCanvasThemeDefaults } from './light-theme.ts'
export { createCanvasDefaultsFromPreset } from './light-theme.ts'

export type CanvasTheme = {
    name: string
    colorScheme: 'light' | 'dark'
    properties?: Record<`--${string}`, string>
    colors: {
        background: string
        surface: string
        raised: string
        hover: string
        text: string
        muted: string
        border: string
        accent: string
        onAccent: string
        success: string
        warning: string
        danger: string
    }
    typography: {
        panelFontSize: number
        panelLineHeight: number
        fontFamily: string
        fontSize: number
        lineHeight: number
        titleFontSize: number
        titleFontWeight: number
    }
    shape: {
        nodeRadius: number
        mediaRadius: number
        panelRadius: number
        controlRadius: number
        borderWidth: number
    }
    controls: {
        typography: {
            fontSize: number
            fontWeight: number
        }
        slidingSwitch: {
            track: string
            indicator: string
            inactive: string
            hovered: string
            selected: string
            disabled: string
            closeHover: string
            shadow: string
        }
        height: number
        padding: number
    }
    shadows: {
        node: string
        selected: string
    }
    states: {
        disabledOpacity: number
        loadingScrim: string
    }
    selection: {
        border: string
        fill: string
        overlayBorder: string
        overlayFill: string
    }
    connectors: ConnectionSettings
    effects: CanvasEffectsTheme
}

export type CanvasThemePatch<Value = CanvasTheme> = {
    [Key in keyof Value]?: Value[Key] extends readonly unknown[]
        ? Value[Key]
        : Value[Key] extends object
            ? CanvasThemePatch<Value[Key]>
            : Value[Key]
}

export const mergeCanvasTheme = <Value extends object>(
    value: Value,
    patch: CanvasThemePatch<Value>,
): Value => {
    const result = structuredClone(value)

    for (const key of Object.keys(patch) as Array<keyof Value>) {
        const next = patch[key]

        if (next === undefined)
            continue

        const previous = result[key]
        result[key] = previous
            && next
            && typeof previous === 'object'
            && typeof next === 'object'
            && !Array.isArray(previous)
            && !Array.isArray(next)
            ? mergeCanvasTheme(previous, next as CanvasThemePatch<typeof previous>) as Value[typeof key]
            : structuredClone(next) as Value[typeof key]
    }

    return result
}

export const createCanvasTheme = (patch: CanvasThemePatch = {}): CanvasTheme => mergeCanvasTheme(
    createLixpiLightCanvasThemeDefaults(),
    patch,
)

export const canvasThemeProperties = (theme: CanvasTheme): Record<`--${string}` | 'color-scheme', string> => ({
    'color-scheme': theme.colorScheme,
    '--canvas-color-scheme': theme.colorScheme,
    '--canvas-background': theme.colors.background,
    '--canvas-surface': theme.colors.surface,
    '--canvas-surface-raised': theme.colors.raised,
    '--canvas-surface-hover': theme.colors.hover,
    '--canvas-text': theme.colors.text,
    '--canvas-text-muted': theme.colors.muted,
    '--canvas-border': theme.colors.border,
    '--canvas-accent': theme.colors.accent,
    '--canvas-on-accent': theme.colors.onAccent,
    '--canvas-success': theme.colors.success,
    '--canvas-warning': theme.colors.warning,
    '--canvas-danger': theme.colors.danger,
    '--canvas-font-family': theme.typography.fontFamily,
    '--canvas-font-size': `${theme.typography.fontSize}px`,
    '--canvas-line-height': String(theme.typography.lineHeight),
    '--canvas-title-font-size': `${theme.typography.titleFontSize}px`,
    '--canvas-title-font-weight': String(theme.typography.titleFontWeight),
    '--canvas-node-radius': `${theme.shape.nodeRadius}px`,
    '--canvas-media-radius': `${theme.shape.mediaRadius}px`,
    '--canvas-panel-radius': `${theme.shape.panelRadius}px`,
    '--canvas-control-radius': `${theme.shape.controlRadius}px`,
    '--canvas-node-border-width': `${theme.shape.borderWidth}px`,
    '--canvas-control-font-size': `${theme.controls.typography.fontSize}px`,
    '--canvas-control-font-weight': String(theme.controls.typography.fontWeight),
    '--canvas-panel-font-size': `${theme.typography.panelFontSize}px`,
    '--canvas-panel-line-height': String(theme.typography.panelLineHeight),
    '--canvas-switch-track': theme.controls.slidingSwitch.track,
    '--canvas-switch-indicator': theme.controls.slidingSwitch.indicator,
    '--canvas-switch-inactive': theme.controls.slidingSwitch.inactive,
    '--canvas-switch-hovered': theme.controls.slidingSwitch.hovered,
    '--canvas-switch-selected': theme.controls.slidingSwitch.selected,
    '--canvas-switch-disabled': theme.controls.slidingSwitch.disabled,
    '--canvas-switch-close-hover': theme.controls.slidingSwitch.closeHover,
    '--canvas-switch-shadow': theme.controls.slidingSwitch.shadow,
    '--canvas-control-height': `${theme.controls.height}px`,
    '--canvas-control-padding': `${theme.controls.padding}px`,
    '--canvas-shadow': theme.shadows.node,
    '--canvas-selected-shadow': theme.shadows.selected,
    '--canvas-disabled-opacity': String(theme.states.disabledOpacity),
    '--canvas-loading-scrim': theme.states.loadingScrim,
    '--selection-marquee-border-color': theme.selection.border,
    '--selection-marquee-background-color': theme.selection.fill,
    '--selection-overlay-border-color': theme.selection.overlayBorder,
    '--selection-overlay-background-color': theme.selection.overlayFill,
    '--connector-line-default-color': theme.connectors.styles.lineDefaultColor,
    '--connector-line-focus-color': theme.connectors.styles.lineFocusColor,
    '--diagram-canvas-background': theme.colors.background,
    '--diagram-canvas-text': theme.colors.text,
    '--diagram-canvas-muted': theme.colors.muted,
    '--diagram-canvas-accent': theme.colors.accent,
    '--canvas-generated-output-title-color': theme.colors.text,
    '--canvas-node-footer-color': theme.colors.muted,
    '--canvas-node-footer-hover-color': theme.colors.accent,
    ...theme.properties,
})

export const resolveCanvasThemeColor = (
    theme: CanvasTheme,
    value: string,
): string => {
    const properties = canvasThemeProperties(theme)
    let result = value

    for (let depth = 0; depth < 8; depth += 1) {
        if (!result.includes('var(')) {
            const mix = /^color-mix\(in srgb,\s*(#[a-f0-9]{6})\s+(\d+(?:\.\d+)?)%,\s*transparent\)$/i.exec(result)

            if (mix) {
                const alpha = Math.round((255 * Math.max(
                    0,
                    Math.min(
                        100,
                        Number(mix[2]),
                    ),
                )) / 100)

                return `${mix[1]}${alpha.toString(16).padStart(2, '0')}`
            }

            return result
        }

        result = result.replace(/var\((--[a-z0-9-]+)\)/g, (_reference, name: string) => {
            const resolved = properties[name as keyof typeof properties]

            if (!resolved)
                throw new Error(`Unknown canvas theme color: ${name}`)

            return resolved
        })
    }

    throw new Error('Canvas theme color references contain a cycle')
}

export const resolveCanvasThemeColors = <Value>(
    theme: CanvasTheme,
    value: Value,
): Value => {
    if (typeof value === 'string')
        return resolveCanvasThemeColor(theme, value) as Value

    if (Array.isArray(value))
        return value.map(child => resolveCanvasThemeColors(theme, child)) as Value

    if (
        value
        && typeof value === 'object'
    )
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, resolveCanvasThemeColors(theme, child)]),
        ) as Value

    return value
}

export const canvasThemeConnectorSettings = (theme: CanvasTheme): ConnectionSettings => ({
    ...structuredClone(theme.connectors),
    styles: {
        lineDefaultColor: resolveCanvasThemeColor(theme, theme.connectors.styles.lineDefaultColor),
        lineFocusColor: resolveCanvasThemeColor(theme, theme.connectors.styles.lineFocusColor),
    },
})

export const createCanvasThemeFromCss = (
    root: HTMLElement,
    options: {
        inheritPageBackground?: boolean
    } = {},
): CanvasTheme => {
    const view = root.ownerDocument.defaultView

    if (!view)
        throw new Error('Canvas theme requires a browser document')

    const styles = view.getComputedStyle(root)
    const defaults = createLixpiLightCanvasThemeDefaults()
    const optional = (
        role: string,
        fallback: string,
    ): string => styles.getPropertyValue(`--theme-${role}`).trim() || fallback
    const read = (role: string): string => {
        const value = styles.getPropertyValue(`--theme-${role}`).trim()

        if (!value)
            throw new Error(`Missing shared theme token --theme-${role}`)

        return value
    }

    return createCanvasTheme({
        name: styles.getPropertyValue('--theme-name').trim() || root.closest<HTMLElement>('[data-color-theme]')?.dataset.colorTheme || 'Host theme',
        colorScheme: styles.colorScheme === 'dark'
            || root.closest<HTMLElement>('[data-theme]')?.dataset.theme === 'dark'
            ? 'dark'
            : 'light',
        effects: createCanvasEffectsTheme(),
        typography: {
            panelFontSize: Number.parseFloat(
                optional(
                    'panel-font-size',
                    String(defaults.typography.panelFontSize),
                ),
            ),
            panelLineHeight: Number.parseFloat(
                optional(
                    'panel-line-height',
                    String(defaults.typography.panelLineHeight),
                ),
            ),
        },
        controls: {
            typography: {
                fontSize: Number.parseFloat(
                    optional(
                        'control-font-size',
                        String(defaults.controls.typography.fontSize),
                    ),
                ),
                fontWeight: Number(
                    optional(
                        'control-font-weight',
                        String(defaults.controls.typography.fontWeight),
                    ),
                ),
            },
            slidingSwitch: {
                track: optional('switch-track', defaults.controls.slidingSwitch.track),
                indicator: optional('switch-indicator', defaults.controls.slidingSwitch.indicator),
                inactive: optional('switch-inactive', defaults.controls.slidingSwitch.inactive),
                hovered: optional('switch-hovered', defaults.controls.slidingSwitch.hovered),
                selected: optional('switch-selected', defaults.controls.slidingSwitch.selected),
                disabled: optional('switch-disabled', defaults.controls.slidingSwitch.disabled),
                closeHover: optional('switch-close-hover', defaults.controls.slidingSwitch.closeHover),
                shadow: optional('switch-shadow', defaults.controls.slidingSwitch.shadow),
            },
        },
        connectors: {
            styles: {
                lineDefaultColor: 'var(--canvas-text-muted)',
                lineFocusColor: 'var(--canvas-accent)',
            },
        },
        colors: {
            background: options.inheritPageBackground ? read('background') : defaults.colors.background,
            surface: read('surface'),
            raised: read('surface-secondary'),
            hover: read('surface-hover'),
            text: read('text'),
            muted: read('text-muted'),
            border: read('border'),
            accent: read('accent'),
            onAccent: styles.getPropertyValue('--theme-on-accent').trim() || read('background'),
            success: read('success'),
            warning: read('warning'),
            danger: read('danger'),
        },
    })
}

const validateThemeValues = (
    value: unknown,
    path = 'theme',
    seen = new WeakSet<object>(),
): void => {
    if (
        typeof value === 'number'
        && !Number.isFinite(value)
    )
        throw new Error(`${path} must be finite`)

    if (
        value
        && typeof value === 'object'
    ) {
        if (seen.has(value))
            throw new Error(`${path} contains a cycle`)

        seen.add(value)

        for (const [key, child] of Object.entries(value))
            validateThemeValues(
                child,
                `${path}.${key}`,
                seen,
            )

        seen.delete(value)
    }
}

const validateThemeShape = (
    value: unknown,
    template: unknown,
    path = 'theme',
): void => {
    if (
        typeof value !== typeof template
        || value === null
    )
        throw new Error(`${path} must be ${typeof template}`)

    if (Array.isArray(template)) {
        if (!Array.isArray(value))
            throw new Error(`${path} must be an array`)

        for (const entry of value)
            if (template.length)
                validateThemeShape(
                    entry,
                    template[0],
                    `${path}[]`,
                )
    } else if (
        template
        && typeof template === 'object'
    ) {
        for (const [key, child] of Object.entries(template))
            validateThemeShape(
                (value as Record<string, unknown>)[key],
                child,
                `${path}.${key}`,
            )
    }
}

const freezeTheme = <Value>(value: Value): Value => {
    if (
        value
        && typeof value === 'object'
    ) {
        for (const child of Object.values(value))
            freezeTheme(child)

        Object.freeze(value)
    }

    return value
}

const validateCanvasTheme = (theme: CanvasTheme): void => {
    validateThemeValues(theme)

    if (!['light', 'dark'].includes(theme.colorScheme))
        throw new Error('theme.colorScheme must be light or dark')

    validateThemeShape(
        theme,
        createCanvasTheme(),
    )

    if (!['bezier', 'straight', 'smoothstep', 'horizontal-bezier', 'orthogonal'].includes(theme.connectors.lineCurve))
        throw new Error('theme.connectors.lineCurve is not a supported connector path')

    for (const [key, value] of Object.entries({
        ...theme.shape,
        ...theme.controls,
        ...theme.controls.typography,
        ...theme.typography,
    })) {
        if (
            typeof value === 'number'
            && value < 0
        )
            throw new Error(`theme.${key} cannot be negative`)
    }

    if (
        theme.states.disabledOpacity < 0
        || theme.states.disabledOpacity > 1
    )
        throw new Error('theme.states.disabledOpacity must be between 0 and 1')

    if (
        theme.properties !== undefined
        && (!theme.properties || typeof theme.properties !== 'object' || Array.isArray(theme.properties))
    )
        throw new Error('theme.properties must be a CSS custom property record')

    const baseProperties = canvasThemeProperties({
        ...theme,
        properties: undefined,
    })

    for (const [name, value] of Object.entries(theme.properties ?? {})) {
        if (
            !/^--[a-z0-9_-]+$/i.test(name)
            || typeof value !== 'string'
        )
            throw new Error('theme.properties requires CSS custom property names and string values')

        if (Object.hasOwn(baseProperties, name))
            throw new Error(`theme.properties cannot replace the shared canvas role ${name}`)
    }

    canvasThemeConnectorSettings(theme)

    for (const [name, color] of Object.entries(theme.colors)) {
        const resolved = resolveCanvasThemeColor(theme, color)

        if (
            name === 'background'
            && resolved === 'transparent'
        )
            continue

        if (!normalizeHexColor(resolved))
            throw new Error(`theme.colors.${name} requires a six-digit hex color`)
    }

    const validateEffectColors = (
        value: unknown,
        path: string,
    ): void => {
        if (
            typeof value === 'string'
            && !normalizeHexColor(
                resolveCanvasThemeColor(theme, value),
            )
        )
            throw new Error(`${path} requires a six-digit hex color or canvas color reference`)

        if (
            Array.isArray(value)
            && value.length === 0
        )
            throw new Error(`${path} cannot be empty`)

        if (
            value
            && typeof value === 'object'
        ) for (const [name, child] of Object.entries(value))
            validateEffectColors(child, `${path}.${name}`)
    }
    validateEffectColors(theme.effects, 'theme.effects')
}

export type CanvasThemeSource<Theme extends CanvasTheme = CanvasTheme> = {
    readonly value: Theme
    subscribe(listener: (theme: Theme) => void): () => void
}

export class CanvasThemeStore<Theme extends CanvasTheme = CanvasTheme> implements CanvasThemeSource<Theme> {
    private current: Theme
    private readonly listeners = new Set<(theme: Theme) => void>()

    constructor(theme: Theme) {
        validateCanvasTheme(theme)
        this.current = freezeTheme(
            structuredClone(theme),
        )
    }

    get value(): Theme {
        return this.current
    }

    set(theme: Theme): void {
        validateCanvasTheme(theme)
        this.current = freezeTheme(
            structuredClone(theme),
        )
        const errors: unknown[] = []

        for (const listener of [...this.listeners]) {
            try {
                listener(this.current)
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length)
            throw new AggregateError(errors, 'A canvas theme subscriber failed')
    }

    update(patch: CanvasThemePatch<Theme>): void {
        this.set(
            mergeCanvasTheme(this.current, patch),
        )
    }

    subscribe(listener: (theme: Theme) => void): () => void {
        this.listeners.add(listener)

        return () => void this.listeners.delete(listener)
    }
}

export const applyCanvasTheme = (
    root: HTMLElement,
    theme: CanvasTheme,
): void => {
    root.dataset.canvasTheme = theme.name

    for (const [name, value] of Object.entries(
        canvasThemeProperties(theme),
    ))
        root.style.setProperty(name, value)
}

export const bindCanvasTheme = <Theme extends CanvasTheme>(
    root: HTMLElement,
    source: CanvasThemeSource<Theme>,
    onChange: (theme: Theme) => void = () => {},
): (() => void) => {
    const previousName = root.getAttribute('data-canvas-theme')
    const properties = Object.keys(
        canvasThemeProperties(source.value),
    )
    const previous = new Map(
        properties.map(
            name => [name, {
                value: root.style.getPropertyValue(name),
                priority: root.style.getPropertyPriority(name),
            }],
        ),
    )
    let applied = new Set<string>()
    const update = (theme: Theme): void => {
        const nextProperties = canvasThemeProperties(theme)

        for (const name of applied)
            if (!Object.hasOwn(nextProperties, name)) {
                const original = previous.get(name)

                if (original?.value)
                    root.style.setProperty(
                        name,
                        original.value,
                        original.priority,
                    )
                else
                    root.style.removeProperty(name)
            }

        applied = new Set(
            Object.keys(nextProperties),
        )

        for (const name of applied)
            if (!previous.has(name))
                previous.set(
                    name,
                    {
                        value: root.style.getPropertyValue(name),
                        priority: root.style.getPropertyPriority(name),
                    },
                )

        applyCanvasTheme(root, theme)
        onChange(theme)
    }
    const release = source.subscribe(update)
    let disposed = false
    const dispose = (): void => {
        if (disposed)
            return

        disposed = true
        release()

        for (const [name, style] of previous)
            if (style.value)
                root.style.setProperty(
                    name,
                    style.value,
                    style.priority,
                )
            else
                root.style.removeProperty(name)

        if (previousName === null)
            root.removeAttribute('data-canvas-theme')
        else
            root.setAttribute('data-canvas-theme', previousName)
    }

    try {
        update(source.value)
    } catch (error) {
        dispose()

        throw error
    }

    return dispose
}
