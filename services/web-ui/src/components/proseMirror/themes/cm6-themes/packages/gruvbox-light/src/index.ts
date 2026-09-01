import { EditorView } from '@codemirror/view'
import { Extension } from '@codemirror/state'
import {
    HighlightStyle,
    syntaxHighlighting,
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const dark0 = '#282828'
const dark1 = '#3c3836'
const dark2 = '#504945'
const dark3 = '#aaaab7' // Gutter color
const dark4 = '#7c6f64'
const dark4_256 = '#7c6f64'
const gray_245 = '#928374'
const gray_244 = '#928374'
const light0 = '#f7f7f8'
const light1 = '#ebdbb2'
const light2 = '#d5c4a1'
const light3 = '#bdae93'
const light4 = '#a89984'
const light4_256 = '#a89984'
const bright_red = '#fb4934'
const bright_green = '#b8bb26'
const bright_yellow = '#fabd2f'
const bright_blue = '#83a598'
const bright_purple = '#d3869b'
const bright_aqua = '#8ec07c'
const bright_orange = '#fe8019'
const neutral_red = '#cc241d'
const neutral_green = '#98971a'
const neutral_yellow = '#d79921'
const neutral_blue = '#458588'
const neutral_purple = '#b16286'
const neutral_aqua = '#689d6a'
const neutral_orange = '#d65d0e'
const faded_red = '#9d0006'
const faded_green = '#79740e'
const faded_yellow = '#b57614'
const faded_blue = '#076678'
const faded_purple = '#8f3f71'
const faded_aqua = '#427b58'
const faded_orange = '#af3a03'

const bg0 = light0
const bg1 = light1
const bg3 = light3
const gray = gray_244
const fg1 = dark1
const fg2 = dark2
const fg4 = dark4
const red = faded_red
const green = faded_green
const yellow = faded_yellow
const blue = faded_blue
const purple = faded_purple
const aqua = faded_aqua
const orange = faded_orange

const invalid = red
const darkBackground = bg1
const highlightBackground = darkBackground
const background = 'linear-gradient( 45deg, #f7f7f8 0%, rgba(247, 247, 248, 1) 100% )'
const tooltipBackground = bg1
const selectionBackground = '#e5e5e8'
const cursor = orange

// const guttersColor = '#aaaab7'
const guttersColor = '#b9b9c3'
const guttersBackground = 'transparent'

/// The editor theme styles for Gruvbox Light.
export const gruvboxLightTheme = EditorView.theme(
    {
        '&': {
            color: fg1,
            background: background,
        },

        '.cm-content': {
            caretColor: cursor,
        },

        '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: cursor,
        },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: selectionBackground,
        },

        '.cm-panels': {
            backgroundColor: darkBackground,
            color: fg1,
        },
        '.cm-panels.cm-panels-top': {
            borderBottom: '2px solid black',
        },
        '.cm-panels.cm-panels-bottom': {
            borderTop: '2px solid black',
        },

        '.cm-searchMatch': {
            backgroundColor: bg0,
            color: yellow,
            outline: `1px solid ${bg3}`,
        },
        '.cm-searchMatch.cm-searchMatch-selected': {
            backgroundColor: bg3,
        },

        '.cm-activeLine': {
            backgroundColor: highlightBackground,
        },
        '.cm-selectionMatch': {
            backgroundColor: bg3,
        },

        '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
            outline: `1px solid ${bg3}`,
            fontStyle: 'bold',
        },

        '&.cm-focused .cm-matchingBracket': {
            backgroundColor: bg3,
        },

        '.cm-gutters': {
            backgroundColor: guttersBackground,
            color: guttersColor,
            border: 'none',
            userSelect: 'none',
            marginRight: '8px',
        },

        '.cm-activeLineGutter': {
            backgroundColor: highlightBackground,
        },

        '.cm-foldPlaceholder': {
            backgroundColor: 'transparent',
            border: 'none',
            color: '#ddd',
        },

        '.cm-tooltip': {
            border: 'none',
            backgroundColor: tooltipBackground,
        },
        '.cm-tooltip .cm-tooltip-arrow:before': {
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
        },
        '.cm-tooltip .cm-tooltip-arrow:after': {
            borderTopColor: tooltipBackground,
            borderBottomColor: tooltipBackground,
        },
        '.cm-tooltip-autocomplete': {
            '& > ul > li[aria-selected]': {
                backgroundColor: highlightBackground,
                color: fg2,
            },
        },
    },
    { dark: false },
)

/// The highlighting style for code in the Gruvbox Light theme.
export const gruvboxLightHighlightStyle = HighlightStyle.define([
    { tag: t.keyword, color: red },
    {
        tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
        color: aqua,
    },
    { tag: [t.variableName], color: blue },
    { tag: [t.function(t.variableName)], color: green, fontStyle: 'bold' },
    { tag: [t.labelName], color: fg1 },
    {
        tag: [t.color, t.constant(t.name), t.standard(t.name)],
        color: purple,
    },
    { tag: [t.definition(t.name), t.separator], color: fg1 },
    { tag: [t.brace], color: fg1 },
    {
        tag: [t.annotation],
        color: invalid,
    },
    {
        tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
        color: purple,
    },
    {
        tag: [t.typeName, t.className],
        color: yellow,
    },
    {
        tag: [t.operator, t.operatorKeyword],
        color: red,
    },
    {
        tag: [t.tagName],
        color: aqua,
        fontStyle: 'bold',
    },
    {
        tag: [t.squareBracket],
        color: orange,
    },
    {
        tag: [t.angleBracket],
        color: blue,
    },
    {
        tag: [t.attributeName],
        color: aqua,
    },
    {
        tag: [t.regexp],
        color: aqua,
    },
    {
        tag: [t.quote],
        color: gray,
    },
    { tag: [t.string], color: fg1 },
    {
        tag: t.link,
        color: fg4,
        textDecoration: 'underline',
        textUnderlinePosition: 'under',
    },
    {
        tag: [t.url, t.escape, t.special(t.string)],
        color: purple,
    },
    { tag: [t.meta], color: yellow },
    { tag: [t.comment], color: gray, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold', color: orange },
    { tag: t.emphasis, fontStyle: 'italic', color: green },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.heading, fontWeight: 'bold', color: green },
    { tag: [t.heading1, t.heading2], fontWeight: 'bold', color: green },
    {
        tag: [t.heading3, t.heading4],
        fontWeight: 'bold',
        color: yellow,
    },
    {
        tag: [t.heading5, t.heading6],
        color: yellow,
    },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: purple },
    {
        tag: [t.processingInstruction, t.inserted],
        color: blue,
    },
    {
        tag: [t.contentSeparator],
        color: red,
    },
    { tag: t.invalid, color: orange, borderBottom: `1px dotted ${invalid}` },
])

/// Extension to enable the Gruvbox Light theme (both the editor theme and
/// the highlight style).
export const gruvboxLight: Extension = [
    gruvboxLightTheme,
    syntaxHighlighting(gruvboxLightHighlightStyle),
]
