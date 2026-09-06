// Client settings. Values here are meant to be changed: they are the knobs this
// UI exposes to whoever maintains it, not constants the code depends on.

import {
    type CodeThemeName,
} from '$src/views/modelCatalog/components/codeThemes.ts'

export type ClientSettings = {
    jsonViewer: {
        // Which cm6-themes theme highlights the read-only JSON blocks. Every
        // theme in the set is installed, so any of these works:
        // basicDark, basicLight, gruvboxDark, gruvboxLight, materialDark, nord,
        // solarizedDark, solarizedLight.
        theme: CodeThemeName
        // Font size of the highlighted JSON, in pixels.
        fontSize: number
    }
}

export const settings: ClientSettings = {
    jsonViewer: {
        theme: 'solarizedDark',
        fontSize: 13,
    },
}
