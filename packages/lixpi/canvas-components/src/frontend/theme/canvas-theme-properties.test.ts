// @vitest-environment happy-dom

import {
    describe,
    expect,
    it,
} from 'vitest'
import {
    bindCanvasTheme,
    CanvasThemeStore,
    canvasThemeProperties,
    createCanvasTheme,
    resolveCanvasThemeColor,
    type CanvasTheme,
} from './canvas-theme.ts'

describe('canvas theme extension properties', () => {
    it('keeps optional legacy properties valid and resolves custom aliases with the theme color scheme', () => {
        const legacy = createCanvasTheme()
        const legacyStore = new CanvasThemeStore(legacy)
        const theme = createCanvasTheme({
            properties: {
                '--canvas-lixpi-menu-text': 'var(--canvas-text)',
            },
        })

        expect(legacyStore.value.properties).toBeUndefined()
        expect(theme.colorScheme).toBe('light')
        expect(canvasThemeProperties(theme)['color-scheme']).toBe('light')
        expect(canvasThemeProperties(theme)['--canvas-lixpi-menu-text']).toBe('var(--canvas-text)')
        expect(resolveCanvasThemeColor(theme, 'var(--canvas-lixpi-menu-text)')).toBe(theme.colors.text)
    })

    it('rejects malformed custom names, non-string values, and collisions with shared roles', () => {
        const malformedName = createCanvasTheme({ properties: {} })
        ;(malformedName.properties as unknown as Record<string, unknown>)['canvas-invalid'] = 'value'
        expect(() => new CanvasThemeStore(malformedName)).toThrow(/CSS custom property names and string values/)

        const nonString = createCanvasTheme({ properties: {} })
        ;(nonString.properties as unknown as Record<string, unknown>)['--canvas-lixpi-menu-gap'] = 12
        expect(() => new CanvasThemeStore(nonString)).toThrow(/CSS custom property names and string values/)

        const collision = createCanvasTheme({ properties: { '--canvas-text': '#111111' } })
        expect(() => new CanvasThemeStore(collision)).toThrow(/cannot replace the shared canvas role --canvas-text/)

        const invalidScheme = createCanvasTheme() as CanvasTheme
        ;(invalidScheme as unknown as { colorScheme: string }).colorScheme = 'system'
        expect(() => new CanvasThemeStore(invalidScheme)).toThrow(/colorScheme must be light or dark/)
    })

    it('binds added and removed extension keys and restores the original inline values on dispose', () => {
        const root = document.createElement('div')
        root.style.setProperty('--canvas-lixpi-menu-text', 'original', 'important')
        const store = new CanvasThemeStore(createCanvasTheme({
            properties: {
                '--canvas-lixpi-menu-text': 'var(--canvas-text)',
            },
        }))
        const dispose = bindCanvasTheme(root, store)

        expect(root.style.getPropertyValue('--canvas-lixpi-menu-text')).toBe('var(--canvas-text)')
        store.set(createCanvasTheme({
            properties: {
                '--canvas-lixpi-menu-accent': 'var(--canvas-accent)',
            },
        }))
        expect(root.style.getPropertyValue('--canvas-lixpi-menu-text')).toBe('original')
        expect(root.style.getPropertyPriority('--canvas-lixpi-menu-text')).toBe('important')
        expect(root.style.getPropertyValue('--canvas-lixpi-menu-accent')).toBe('var(--canvas-accent)')

        dispose()
        expect(root.style.getPropertyValue('--canvas-lixpi-menu-text')).toBe('original')
        expect(root.style.getPropertyPriority('--canvas-lixpi-menu-text')).toBe('important')
        expect(root.style.getPropertyValue('--canvas-lixpi-menu-accent')).toBe('')
    })
})
