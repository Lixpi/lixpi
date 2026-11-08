// @vitest-environment happy-dom

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    bindCanvasTheme,
    CanvasThemeStore,
    canvasThemeProperties,
    createCanvasTheme,
    createCanvasThemeFromCss,
    resolveCanvasThemeColor,
    resolveCanvasThemeColors,
    type CanvasTheme,
} from './canvas-theme.ts'

describe('canvas theme contract', () => {
    it('keeps body, compact controls, and panel typography independently editable', () => {
        const theme = createCanvasTheme()
        const store = new CanvasThemeStore(theme)
        expect(canvasThemeProperties(theme)['--canvas-font-size']).toBe('15px')
        expect(canvasThemeProperties(theme)['--canvas-control-font-size']).toBe('12px')
        expect(canvasThemeProperties(theme)['--canvas-panel-font-size']).toBe('14px')
        expect(canvasThemeProperties(theme)['--canvas-switch-track']).toBe('rgba(105, 115, 133, 0.09)')
        expect(canvasThemeProperties(theme)['--canvas-switch-indicator']).toBe('rgba(255, 255, 255, 0.72)')

        store.update({ typography: { fontSize: 20 } })
        expect(canvasThemeProperties(store.value)['--canvas-font-size']).toBe('20px')
        expect(canvasThemeProperties(store.value)['--canvas-control-font-size']).toBe('12px')
        expect(canvasThemeProperties(store.value)['--canvas-panel-font-size']).toBe('14px')

        store.update({ controls: { typography: { fontSize: 11 } } })
        expect(canvasThemeProperties(store.value)['--canvas-control-font-size']).toBe('11px')
    })

    it('keeps CSS-derived canvas backgrounds transparent and accepts explicit background overrides', () => {
        const root = document.createElement('div')

        const roles = new Map([
            ['surface', '#123456'],
            ['surface-secondary', '#123456'],
            ['surface-hover', '#123456'],
            ['text', '#123456'],
            ['text-muted', '#123456'],
            ['border', '#123456'],
            ['accent', '#123456'],
            ['background', '#123456'],
            ['success', '#123456'],
            ['warning', '#123456'],
            ['danger', '#123456'],
            ['control-font-size', '11px'],
            ['switch-track', 'rgba(1, 2, 3, 0.4)'],
        ])
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            colorScheme: 'light',
            getPropertyValue: (name: string) => roles.get(name.replace('--theme-', '')) ?? '',
        } as CSSStyleDeclaration)

        const fromCss = createCanvasThemeFromCss(root)

        expect(fromCss.colors.background).toBe('transparent')
        expect(createCanvasThemeFromCss(root, { inheritPageBackground: true }).colors.background).toBe('#123456')
        expect(fromCss.controls.typography.fontSize).toBe(11)
        expect(fromCss.controls.slidingSwitch.track).toBe('rgba(1, 2, 3, 0.4)')
        expect(fromCss.colors.onAccent).toBe('#123456')
        expect(createCanvasTheme({ colors: { background: '#abcdef' } }).colors.background).toBe('#abcdef')
        expect(new CanvasThemeStore(fromCss).value.colors.background).toBe('transparent')
    })

    it('creates independent themes, deep-merges objects, and replaces arrays', () => {
        const first = createCanvasTheme({
            colors: { accent: '#123456' },
            effects: { generationOutline: { colors: ['#111111', '#222222'] } },
        })
        const second = createCanvasTheme()

        expect(first.colors.accent).toBe('#123456')
        expect(first.effects.generationOutline.colors).toEqual(['#111111', '#222222'])
        expect(first.effects.generationOutline.radius).toBe(second.effects.generationOutline.radius)
        expect(first.effects.generationOutline.colors).not.toBe(second.effects.generationOutline.colors)

        const patch = { effects: { generationOutline: { colors: ['#abcdef'] } } }
        const store = new CanvasThemeStore(first)
        store.update(patch)
        expect(store.value.effects.generationOutline.colors).toEqual(['#abcdef'])
        expect(store.value.effects.generationOutline.colors).not.toBe(patch.effects.generationOutline.colors)
        expect(first.effects.generationOutline.colors).toEqual(['#111111', '#222222'])
    })

    it('clones and freezes stored values', () => {
        const input = createCanvasTheme()
        const store = new CanvasThemeStore(input)

        expect(store.value).not.toBe(input)
        expect(Object.isFrozen(store.value)).toBe(true)
        expect(Object.isFrozen(store.value.effects.generationOutline.colors)).toBe(true)
        expect(() => {
            ;(store.value.effects.generationOutline.colors as string[]).push('#ffffff')
        }).toThrow()
    })

    it('rejects malformed values, non-finite numbers, unsupported paths, and cyclic data', () => {
        const malformed = createCanvasTheme() as unknown as Record<string, unknown>
        malformed.colors = { background: '#000000' }
        expect(() => new CanvasThemeStore(malformed as unknown as CanvasTheme)).toThrow(/colors\.surface/)

        const nonFinite = createCanvasTheme({ typography: { fontSize: Number.NaN } })
        expect(() => new CanvasThemeStore(nonFinite)).toThrow(/must be finite/)

        const unsupportedPath = createCanvasTheme()
        ;(unsupportedPath.connectors as { lineCurve: string }).lineCurve = 'curve-ish'
        expect(() => new CanvasThemeStore(unsupportedPath)).toThrow(/supported connector path/)

        const cyclic = createCanvasTheme() as CanvasTheme & { loop?: unknown }
        cyclic.loop = cyclic
        expect(() => new CanvasThemeStore(cyclic)).toThrow(/contains a cycle/)
    })

    it('resolves semantic and nested effects colors, including transparent color mixes', () => {
        const theme = createCanvasTheme({
            colors: {
                accent: '#12ab34',
                background: '#202530',
                muted: '#808890',
                surface: '#303840',
            },
            effects: {
                glassBorder: {
                    bodyColor: 'var(--canvas-surface)',
                    materialColors: ['var(--canvas-background)', 'var(--canvas-surface-raised)'],
                    glassMaterial: { shadowColor: 'var(--canvas-text-muted)' },
                },
                generationOutline: { colors: ['var(--canvas-accent)'] },
            },
        })
        expect(resolveCanvasThemeColor(theme, 'var(--canvas-accent)')).toBe('#12ab34')
        expect(resolveCanvasThemeColor(theme, 'color-mix(in srgb, var(--canvas-accent) 50%, transparent)')).toBe('#12ab3480')

        const effects = resolveCanvasThemeColors(theme, theme.effects)
        expect(effects.glassBorder.bodyColor).toBe('#303840')
        expect(effects.glassBorder.materialColors).toEqual(['#202530', '#ffffff'])
        expect(effects.glassBorder.glassMaterial.shadowColor).toBe('#808890')
        expect(effects.generationOutline.colors).toEqual(['#12ab34'])

        const cyclicRoles = createCanvasTheme({
            colors: {
                background: 'var(--canvas-surface)',
                surface: 'var(--canvas-background)',
            },
        })
        expect(() => resolveCanvasThemeColor(cyclicRoles, 'var(--canvas-background)')).toThrow(/cycle/)
    })

    it('serializes palette and dimension roles as CSS custom properties', () => {
        const theme = createCanvasTheme({
            colors: {
                background: '#101010',
                text: '#eeeeee',
            },
            typography: {
                fontSize: 16,
                lineHeight: 1.25,
            },
            shape: { controlRadius: 8 },
            controls: {
                height: 40,
                padding: 12,
            },
        })
        const properties = canvasThemeProperties(theme)
        expect(properties['--canvas-background']).toBe('#101010')
        expect(properties['--canvas-text']).toBe('#eeeeee')
        expect(properties['--canvas-font-size']).toBe('16px')
        expect(properties['--canvas-line-height']).toBe('1.25')
        expect(properties['--canvas-control-radius']).toBe('8px')
        expect(properties['--canvas-control-height']).toBe('40px')
    })

    it('notifies remaining subscribers if one fails and stops disposed listeners', () => {
        const store = new CanvasThemeStore(createCanvasTheme())
        const failed = vi.fn(() => {
            throw new Error('subscriber failed')
        })
        const remaining = vi.fn()
        const disposeFailed = store.subscribe(failed)
        store.subscribe(remaining)

        expect(() => store.update({ colors: { accent: '#234567' } })).toThrow(AggregateError)
        expect(failed).toHaveBeenCalledOnce()
        expect(remaining).toHaveBeenCalledOnce()
        disposeFailed()
        store.update({ colors: { accent: '#345678' } })
        expect(failed).toHaveBeenCalledOnce()
        expect(remaining).toHaveBeenCalledTimes(2)
    })

    it('binds live updates and restores previous inline values and the theme name', () => {
        const root = document.createElement('div')
        root.dataset.canvasTheme = 'previous'
        root.style.setProperty('--canvas-background', '#010203', 'important')
        root.style.setProperty('--unrelated', 'keep')
        const store = new CanvasThemeStore(createCanvasTheme())
        const dispose = bindCanvasTheme(root, store)

        expect(root.dataset.canvasTheme).toBe('lixpi-light')
        expect(root.style.getPropertyValue('--canvas-background')).toBe('transparent')
        store.update({
            name: 'Updated',
            colors: { background: '#112233' },
        })
        expect(root.dataset.canvasTheme).toBe('Updated')
        expect(root.style.getPropertyValue('--canvas-background')).toBe('#112233')

        dispose()
        store.update({ colors: { background: '#445566' } })
        expect(root.dataset.canvasTheme).toBe('previous')
        expect(root.style.getPropertyValue('--canvas-background')).toBe('#010203')
        expect(root.style.getPropertyPriority('--canvas-background')).toBe('important')
        expect(root.style.getPropertyValue('--unrelated')).toBe('keep')
    })

    it('unsubscribes and restores inline state if the initial bind callback fails', () => {
        const root = document.createElement('div')
        root.dataset.canvasTheme = 'before'
        root.style.setProperty('--canvas-background', '#abcdef')
        const store = new CanvasThemeStore(createCanvasTheme())
        const onChange = vi.fn(() => {
            throw new Error('initial callback failed')
        })

        expect(() => bindCanvasTheme(root, store, onChange)).toThrow('initial callback failed')
        expect(root.dataset.canvasTheme).toBe('before')
        expect(root.style.getPropertyValue('--canvas-background')).toBe('#abcdef')
        store.update({ colors: { background: '#123456' } })
        expect(root.dataset.canvasTheme).toBe('before')
        expect(root.style.getPropertyValue('--canvas-background')).toBe('#abcdef')
        expect(onChange).toHaveBeenCalledOnce()
    })
})
