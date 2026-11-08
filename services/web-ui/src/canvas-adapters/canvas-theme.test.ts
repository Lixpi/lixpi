// @vitest-environment happy-dom

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    lixpiLightTheme,
    oneDarkProMarianaTheme,
} from '@lixpi/themes'

const loadCanvasThemeAdapter = async () => {
    vi.resetModules()

    return import('./canvas-theme.ts')
}

const setThemeTokens = (
    root: HTMLElement,
    background: string,
): void => {
    const tokens = {
        background,
        surface: background,
        'surface-secondary': '#303030',
        'surface-hover': '#404040',
        text: '#f0f0f0',
        'text-muted': '#c0c0c0',
        border: '#505050',
        accent: '#606060',
        success: '#707070',
        warning: '#808080',
        danger: '#909090',
    }

    for (const [role, value] of Object.entries(tokens))
        root.style.setProperty(`--theme-${role}`, value)
}

describe('canvas theme initialization', () => {
    afterEach(() => {
        document.body.replaceChildren()
        vi.restoreAllMocks()
    })

    it('does not read theme tokens from a detached root', async () => {
        const { initializeCanvasThemeStore } = await loadCanvasThemeAdapter()
        const root = document.createElement('div')
        const getComputedStyle = vi.spyOn(
            window,
            'getComputedStyle',
        )

        expect(() => initializeCanvasThemeStore(root)).toThrow(
            'Canvas theme initialization requires its mounted surface root',
        )
        expect(getComputedStyle).not.toHaveBeenCalled()
    })

    it('uses the first mounted root for the shared theme and skips later roots', async () => {
        const {
            canvasThemeStore,
            initializeCanvasThemeStore,
        } = await loadCanvasThemeAdapter()
        const root = document.createElement('div')
        root.dataset.colorTheme = 'Mounted application theme'
        setThemeTokens(
            root,
            '#101010',
        )
        document.body.append(root)

        const laterRoot = document.createElement('div')
        laterRoot.dataset.colorTheme = 'Later application theme'
        setThemeTokens(
            laterRoot,
            '#ababab',
        )
        document.body.append(laterRoot)

        const getComputedStyle = vi.spyOn(window, 'getComputedStyle')

        expect(initializeCanvasThemeStore(root)).toBe(canvasThemeStore)
        expect(canvasThemeStore.value.name).toBe('Mounted application theme')
        expect(canvasThemeStore.value.colors.surface).toBe('#101010')
        expect(canvasThemeStore.value.colors.background).toBe('#101010')

        expect(initializeCanvasThemeStore(laterRoot)).toBe(canvasThemeStore)
        expect(canvasThemeStore.value.colors.surface).toBe('#101010')
        expect(canvasThemeStore.value.colors.background).toBe('#101010')
        expect(getComputedStyle.mock.calls.filter(([element]) => element === root)).toHaveLength(1)
        expect(getComputedStyle.mock.calls.filter(([element]) => element === laterRoot)).toHaveLength(0)
    })
    it.each([
        lixpiLightTheme,
        oneDarkProMarianaTheme,
    ])(
        'keeps the known $name preset canvas transparent',
        async preset => {
            const {
                canvasThemeStore,
                initializeCanvasThemeStore,
            } = await loadCanvasThemeAdapter()
            const root = document.createElement('div')
            root.dataset.colorTheme = preset.name
            root.dataset.theme = preset.colorScheme
            setThemeTokens(
                root,
                '#101010',
            )
            document.body.append(root)

            expect(initializeCanvasThemeStore(root)).toBe(canvasThemeStore)
            expect(canvasThemeStore.value.name).toBe(preset.name)
            expect(canvasThemeStore.value.colors.background).toBe('transparent')
        },
    )

})
