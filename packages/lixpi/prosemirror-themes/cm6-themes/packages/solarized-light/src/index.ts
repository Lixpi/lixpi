import { EditorView } from '@codemirror/view'
import {
    type Extension,
} from '@codemirror/state'
import {
    HighlightStyle,
    syntaxHighlighting,
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const base00 = '#657b83'
const base01 = '#586e75'
const base02 = '#073642'
const base03 = '#002b36'
const base0 = '#839496'
const base1 = '#93a1a1'
const base2 = '#eee8d5'
const base3 = '#fdf6e3'
const base_red = '#dc322f'
const base_orange = '#cb4b16'
const base_yellow = '#b58900'
const base_green = '#859900'
const base_cyan = '#2aa198'
const base_blue = '#268bd2'
const base_violet = '#6c71c4'
const base_magenta = '#d33682'

const invalid = '#d30102'
const darkBackground = '#dfd9c8'
const highlightBackground = darkBackground
const background = base3
const tooltipBackground = base01
const selection = darkBackground
const cursor = base01

/// The editor theme styles for Solarized Light.
export const solarizedLightTheme = EditorView.theme(
    {
        '&': {
            color: base00,
            backgroundColor: background,
        },
        '.cm-content': {
            caretColor: cursor,
        },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: cursor },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: selection },
        '.cm-panels': {
            backgroundColor: darkBackground,
            color: base03,
        },
        '.cm-panels.cm-panels-top': { borderBottom: '2px solid black' },
        '.cm-panels.cm-panels-bottom': { borderTop: '2px solid black' },
        '.cm-searchMatch': {
            backgroundColor: '#72a1ff59',
            outline: '1px solid #457dff',
        },
        '.cm-searchMatch.cm-searchMatch-selected': {
            backgroundColor: '#6199ff2f',
        },
        '.cm-activeLine': { backgroundColor: highlightBackground },
        '.cm-selectionMatch': { backgroundColor: '#aafe661a' },
        '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
            outline: `1px solid ${base1}`,
        },
        '.cm-gutters': {
            backgroundColor: '#00000010',
            color: base00,
            border: 'none',
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
                color: base03,
            },
        },
    },
    { dark: false },
)

/// The highlighting style for code in the Solarized Light theme.
export const solarizedLightHighlightStyle = HighlightStyle.define([
    {
        tag: t.keyword,
        color: base_green,
    },
    {
        tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
        color: base_cyan,
    },
    {
        tag: [t.variableName],
        color: base_blue,
    },
    {
        tag: [t.function(t.variableName)],
        color: base_blue,
    },
    {
        tag: [t.labelName],
        color: base_magenta,
    },
    {
        tag: [t.color, t.constant(t.name), t.standard(t.name)],
        color: base_yellow,
    },
    {
        tag: [t.definition(t.name), t.separator],
        color: base_cyan,
    },
    {
        tag: [t.brace],
        color: base_magenta,
    },
    {
        tag: [t.annotation],
        color: invalid,
    },
    {
        tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
        color: base_magenta,
    },
    {
        tag: [t.typeName, t.className],
        color: base_orange,
    },
    {
        tag: [t.operator, t.operatorKeyword],
        color: base_violet,
    },
    {
        tag: [t.tagName],
        color: base_blue,
    },
    {
        tag: [t.squareBracket],
        color: base_red,
    },
    {
        tag: [t.angleBracket],
        color: base02,
    },
    {
        tag: [t.attributeName],
        color: base1,
    },
    {
        tag: [t.regexp],
        color: invalid,
    },
    {
        tag: [t.quote],
        color: base_green,
    },
    {
        tag: [t.string],
        color: base_yellow,
    },
    {
        tag: t.link,
        color: base_cyan,
        textDecoration: 'underline',
        textUnderlinePosition: 'under',
    },
    {
        tag: [t.url, t.escape, t.special(t.string)],
        color: base_yellow,
    },
    {
        tag: [t.meta],
        color: base_red,
    },
    {
        tag: [t.comment],
        color: base02,
        fontStyle: 'italic',
    },
    {
        tag: t.strong,
        fontWeight: 'bold',
        color: base01,
    },
    {
        tag: t.emphasis,
        fontStyle: 'italic',
        color: base_green,
    },
    {
        tag: t.strikethrough,
        textDecoration: 'line-through',
    },
    {
        tag: t.heading,
        fontWeight: 'bold',
        color: base_yellow,
    },
    {
        tag: t.heading1,
        fontWeight: 'bold',
        color: base03,
    },
    {
        tag: [t.heading2, t.heading3, t.heading4],
        fontWeight: 'bold',
        color: base03,
    },
    {
        tag: [t.heading5, t.heading6],
        color: base03,
    },
    {
        tag: [t.atom, t.bool, t.special(t.variableName)],
        color: base_magenta,
    },
    {
        tag: [t.processingInstruction, t.inserted, t.contentSeparator],
        color: base_red,
    },
    {
        tag: [t.contentSeparator],
        color: base_yellow,
    },
    {
        tag: t.invalid,
        color: base02,
        borderBottom: `1px dotted ${base_red}`,
    },
])

/// Extension to enable the Solarized Light theme (both the editor theme and
/// the highlight style).
export const solarizedLight: Extension = [
    solarizedLightTheme,
    syntaxHighlighting(solarizedLightHighlightStyle),
]
