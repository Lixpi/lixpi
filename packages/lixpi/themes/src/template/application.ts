import {
    type ComponentTheme,
} from './components.ts'

type Font = {
    fontFamily: string
    fontSize: `${number}px` | `${number}rem`
}

type ReferenceChipColors = {
    asset: string
    capability: string
    tool: string
    skill: string
}

type FeedbackTag = {
    background: string
    hover: string
    foreground: string
    border: string
    closeHover: string
}

// Every theme supplies every role. A component can read these values directly in TypeScript.
export type ApplicationTheme = {
    name: string
    colorScheme: 'light' | 'dark'
    components: ComponentTheme
    typography: {
        root: {
            fontSize: `${number}px`
        }
        body: Font
        heading: {
            fontWeight: number
            sizes: {
                h1: string
                h2: string
                h3: string
                h4: string
                h5: string
                h6: string
            }
            lineHeight: number
            letterSpacing: string
        }
        weight: {
            normal: number
            strong: number
        }
        codeInlineSize: string
        markdown: {
            fontFamily: string
            codeSize: string
            codeLineHeight: number
            inlineCodeSize: string
            headingWeight: number
            headingLineHeight: number
            headingSizes: {
                h1: string
                h2: string
                h3: string
                h4: string
            }
        }
        intro: {
            fontSize: string
            fontWeight: number
            accentWeight: number
            maskedWeight: number
        }
        feedbackTag: {
            fontSize: string
            fontWeight: number
        }
        code: Font
        control: Font & {
            fontWeight: number
        }
        panel: {
            fontSize: `${number}px`
            lineHeight: number
        }
    }
    surface: {
        page: string
        card: string
        inset: string
        hover: string
        active: string
    }
    text: {
        body: string
        heading: string
        secondary: string
        muted: string
        disabled: string
        strong: string
        link: string
    }
    border: {
        default: string
        subtle: string
        divider: string
    }
    accent: {
        primary: string
        secondary: string
        foreground: string
    }
    feedback: {
        heartbeat: {
            rest: string
            alternate: string
            peak: string
        }
        info: string
        success: string
        warning: string
        danger: string
        tagPresentation: {
            radius: string
            shadow: string
        }
        tags: {
            success: FeedbackTag
            warning: FeedbackTag
            danger: FeedbackTag
        }
    }
    navigation: {
        sidebar: {
            background: string
            backdrop: string
            opaqueBackdrop: string
            sectionLabel: string
            separator: string
            resizeHandleWidth: string
        }
        topbar: {
            background: string
        }
        avatar: {
            background: string
            foreground: string
            radius: string
            fontSize: string
        }
        tag: {
            background: string
            foreground: string
            radius: string
            fontSize: string
            fontWeight: number
        }
        item: {
            radius: string
            fontSize: string
            fontWeight: number
            hover: string
            active: string
        }
    }
    control: {
        button: {
            background: string
            hover: string
            foreground: string
        }
        slidingSwitch: {
            track: string
            indicator: string
            inactive: string
            hovered: string
            selected: string
            disabled: string
            closeHover: string
            shadow: string
        }
        dropdown: {
            background: string
            indicator: string
            inactive: string
            selected: string
            disabled: string
        }
        scrollbar: {
            thumb: string
            hover: string
            active: string
        }
    }
    panel: {
        resizeHandle: {
            gradient: string
            width: string
        }
        toggle: {
            color: string
            hover: string
        }
        background: string
        opaqueBackground: string
    }
    selection: {
        background: string
        foreground: string
    }
    shadow: {
        sidebar: string
        topbar: string
        card: string
        control: string
    }
    visualization: {
        categorical: readonly [string, string, string]
    }
    editor: {
        inlineCode: {
            foreground: string
        }
        placeholder: {
            foreground: string
        }
        referenceChip: {
            onLight: ReferenceChipColors
            onDark: ReferenceChipColors
        }
        markdown: {
            heading: string
            codeBackground: string
            inlineCodeBackground: string
            codeRadius: string
            inlineCodeRadius: string
        }
        code: {
            foreground: string
            background: string
        }
        syntax: {
            comment: string
            string: string
            number: string
            constant: string
            keyword: string
            operator: string
            function: string
            property: string
        }
        math: {
            variable: string
            greek: string
            number: string
            operator: string
            function: string
        }
    }
}

export type ThemeRoles = Omit<ApplicationTheme, 'name' | 'colorScheme' | 'components'>
