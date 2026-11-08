import {
    lixpiLightTheme,
    oneDarkProMarianaTheme,
} from '@lixpi/themes'
import { CanvasThemeStore } from '@lixpi/canvas-components/theme'
import {
    createLixpiLightCanvasTheme,
    createLixpiCanvasThemeFromCss,
    createLixpiCanvasThemeFromPreset,
} from '$src/settings.ts'

export const canvasThemeStore = new CanvasThemeStore(
    createLixpiLightCanvasTheme(),
)
let initialized = false

// Explicit application updates before the first canvas mount take precedence over the default.
canvasThemeStore.subscribe(() => void (initialized = true))

export const initializeCanvasThemeStore = (root: HTMLElement): CanvasThemeStore => {
    if (!initialized) {
        if (!root.isConnected)
            throw new Error('Canvas theme initialization requires its mounted surface root')

        const scope = root.closest<HTMLElement>('[data-color-theme]')
        const name = scope?.dataset.colorTheme

        if (
            !name
            || name === lixpiLightTheme.name
        )
            canvasThemeStore.set(
                createLixpiLightCanvasTheme(),
            )
        else if (name === oneDarkProMarianaTheme.name)
            canvasThemeStore.set(
                createLixpiCanvasThemeFromPreset(scope?.dataset.theme === 'light' ? lixpiLightTheme : oneDarkProMarianaTheme),
            )
        else
            canvasThemeStore.set(
                createLixpiCanvasThemeFromCss(root, { inheritPageBackground: true }),
            )
    }

    return canvasThemeStore
}
