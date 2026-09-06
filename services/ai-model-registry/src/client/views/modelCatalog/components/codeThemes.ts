// The CodeMirror highlight styles this client can use: every theme from
// craftzdog's cm6-themes. Only the highlight half of each theme is taken. The
// editor half paints its own background, gutters, and selection, and this viewer
// is a block of text on the page's own surface rather than an editor pretending
// to be one.

import {
    type HighlightStyle,
} from '@codemirror/language'
import {
    basicDarkHighlightStyle,
} from 'cm6-theme-basic-dark'
import {
    basicLightHighlightStyle,
} from 'cm6-theme-basic-light'
import {
    gruvboxDarkHighlightStyle,
} from 'cm6-theme-gruvbox-dark'
import {
    gruvboxLightHighlightStyle,
} from 'cm6-theme-gruvbox-light'
import {
    materialDarkHighlightStyle,
} from 'cm6-theme-material-dark'
import {
    nordHighlightStyle,
} from 'cm6-theme-nord'
import {
    solarizedDarkHighlightStyle,
} from 'cm6-theme-solarized-dark'
import {
    solarizedLightHighlightStyle,
} from 'cm6-theme-solarized-light'

export const CODE_THEMES = {
    basicDark: basicDarkHighlightStyle,
    basicLight: basicLightHighlightStyle,
    gruvboxDark: gruvboxDarkHighlightStyle,
    gruvboxLight: gruvboxLightHighlightStyle,
    materialDark: materialDarkHighlightStyle,
    nord: nordHighlightStyle,
    solarizedDark: solarizedDarkHighlightStyle,
    solarizedLight: solarizedLightHighlightStyle,
} as const satisfies Record<string, HighlightStyle>

export type CodeThemeName = keyof typeof CODE_THEMES
