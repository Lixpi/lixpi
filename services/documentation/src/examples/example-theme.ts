import { CanvasThemeStore } from '@lixpi/canvas-components/theme'
import { createLixpiCanvasThemeFromPreset } from '@lixpi/canvas-components/workspace/settings'
import { LibraryColors } from '@lixpi/canvas-components/library'
import { lixpiLightTheme } from '@lixpi/themes'

let theme: CanvasThemeStore | undefined

export const getExampleTheme = (_element: HTMLElement): CanvasThemeStore => {
    theme ??= new CanvasThemeStore(
        createLixpiCanvasThemeFromPreset(lixpiLightTheme),
    )

    return theme
}

export const exampleColors = (element: HTMLElement): LibraryColors => new LibraryColors(
    getExampleTheme(element),
)
