import {
    themeStylesheetRoles,
    withStylesheetAliases,
} from '../projections/scss-roles.ts'
import { marianaPalette } from '../palettes/mariana.ts'
import { oneDarkProMarianaTheme } from '../presets/one-dark-pro-mariana/theme.ts'
import { createMarianaRoles } from '../presets/one-dark-pro-mariana/roles.ts'

type Swatch = keyof typeof marianaPalette

// External stylesheets can override these upstream variables independently.
const upstreamProperties = {
    charcoal: '--mariana-editor-background',
    silverBlue: '--mariana-editor-foreground',
    paleBlueGray: '--mariana-activity-foreground',
    deepCharcoal: '--mariana-widget-background',
    graphiteBlue: '--mariana-line-background',
    charcoalBlue: '--mariana-hover-background',
    blueGray38: '--mariana-selection-background',
    paleSilver: '--mariana-selection-foreground',
    ashGray: '--mariana-sidebar-foreground',
    mistBlue: '--mariana-title-foreground',
    slateGray: '--mariana-inactive-foreground',
    stormGray: '--mariana-ignored-foreground',
    midnightGray: '--mariana-group-border',
    slateBlue: '--mariana-panel-border',
    gunmetal: '--mariana-guide-border',
    steelGray: '--mariana-button-background',
    deepGraphite: '--mariana-button-secondary-background',
    smokeBlue38: '--mariana-scrollbar',
    denimGray50: '--mariana-scrollbar-hover',
    dustyBlue50: '--mariana-scrollbar-active',
    skyBlue: '--mariana-highlight-blue',
    apricot: '--mariana-bracket-orange',
    orchid: '--mariana-bracket-purple',
    turquoise: '--mariana-bracket-cyan',
    azure: '--mariana-terminal-blue',
    electricBlue: '--mariana-terminal-bright-blue',
    aqua: '--mariana-terminal-bright-cyan',
    pistachio: '--mariana-terminal-bright-green',
    tangerine: '--mariana-terminal-bright-yellow',
    coralRed: '--mariana-terminal-bright-red',
    electricPurple: '--mariana-terminal-bright-purple',
    pearlGray: '--mariana-terminal-bright-white',
    white44: '--mariana-syntax-comment',
    sageGreen: '--mariana-syntax-string',
    amber: '--mariana-syntax-number',
    salmon: '--mariana-syntax-constant',
    mauve: '--mariana-syntax-keyword',
    coralOrange: '--mariana-syntax-operator',
    seaGreen: '--mariana-syntax-function',
    cornflowerBlue: '--mariana-syntax-property',
} as const satisfies Record<Swatch, string>

const swatches = Object.keys(upstreamProperties) as Swatch[]

export const marianaStylesheetPalette = Object.fromEntries(
    swatches.map(
        swatch => [
            upstreamProperties[swatch],
            marianaPalette[swatch],
        ],
    ),
)

const paletteReferences = Object.fromEntries(
    swatches.map(
        swatch => [
            swatch,
            `var(${upstreamProperties[swatch]})`,
        ],
    ),
) as Record<Swatch, string>

export const oneDarkProMarianaStylesheetRoles = withStylesheetAliases(
    themeStylesheetRoles({
        ...oneDarkProMarianaTheme,
        ...createMarianaRoles(paletteReferences),
    }),
    {
        'code-background': 'background',
        'button-text': 'heading',
        'syntax-comment': 'text-muted',
        'text-strong': 'heading',
        link: 'accent-secondary',
        'navigation-hover': 'surface-hover',
        'navigation-active': 'surface-active',
        'on-accent': 'background',
    },
)
