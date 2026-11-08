import {
    type ThemeRoles,
} from '../../template/application.ts'
import {
    marianaShadowPalette,
    type marianaPalette,
} from '../../palettes/mariana.ts'

type MarianaColors = Record<keyof typeof marianaPalette, string>

const sansFontFamily = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export const createMarianaRoles = (palette: MarianaColors) =>
    ({
        typography: {
            root: {
                fontSize: '16px',
            },
            heading: {
                fontWeight: 400,
                sizes: {
                    h1: '30px',
                    h2: '1.63em',
                    h3: '1.5em',
                    h4: '1.3em',
                    h5: '1.1em',
                    h6: '1.03em',
                },
                lineHeight: 1.3,
                letterSpacing: '-0.0167em',
            },
            weight: {
                normal: 400,
                strong: 600,
            },
            codeInlineSize: '0.93rem',
            markdown: {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                codeSize: '11px',
                codeLineHeight: 1.45,
                inlineCodeSize: '0.92em',
                headingWeight: 700,
                headingLineHeight: 1.3,
                headingSizes: {
                    h1: '15px',
                    h2: '14px',
                    h3: '13px',
                    h4: '12px',
                },
            },
            intro: {
                fontSize: '3rem',
                fontWeight: 400,
                accentWeight: 500,
                maskedWeight: 300,
            },
            feedbackTag: {
                fontSize: '11px',
                fontWeight: 400,
            },
            body: {
                fontFamily: sansFontFamily,
                fontSize: '0.875rem',
            },
            control: {
                fontFamily: sansFontFamily,
                fontSize: '12px',
                fontWeight: 400,
            },
            panel: {
                fontSize: '14px',
                lineHeight: 1.45,
            },
            code: {
                fontFamily: '"SF Mono", Monaco, Consolas, "Liberation Mono", monospace',
                fontSize: '0.875rem',
            },
        },
        surface: {
            page: palette.charcoal,
            card: palette.graphiteBlue,
            inset: palette.deepCharcoal,
            hover: palette.charcoalBlue,
            active: palette.graphiteBlue,
        },
        text: {
            body: palette.paleSilver,
            heading: palette.pearlGray,
            secondary: palette.paleBlueGray,
            muted: palette.silverBlue,
            disabled: palette.stormGray,
            strong: palette.pearlGray,
            link: palette.azure,
        },
        border: {
            default: palette.slateBlue,
            subtle: palette.gunmetal,
            divider: palette.midnightGray,
        },
        accent: {
            primary: palette.aqua,
            secondary: palette.azure,
            foreground: palette.charcoal,
        },
        feedback: {
            heartbeat: {
                rest: palette.coralRed,
                alternate: palette.pistachio,
                peak: palette.coralRed,
            },
            info: palette.electricBlue,
            success: palette.pistachio,
            warning: palette.tangerine,
            danger: palette.coralRed,
            tagPresentation: {
                radius: '9px',
                shadow: 'inset 0 0 0 1px',
            },
            tags: {
                success: {
                    background: palette.graphiteBlue,
                    hover: palette.charcoalBlue,
                    foreground: palette.pistachio,
                    border: palette.gunmetal,
                    closeHover: palette.slateBlue,
                },
                warning: {
                    background: palette.graphiteBlue,
                    hover: palette.charcoalBlue,
                    foreground: palette.tangerine,
                    border: palette.gunmetal,
                    closeHover: palette.slateBlue,
                },
                danger: {
                    background: palette.graphiteBlue,
                    hover: palette.charcoalBlue,
                    foreground: palette.coralRed,
                    border: palette.gunmetal,
                    closeHover: palette.slateBlue,
                },
            },
        },
        navigation: {
            sidebar: {
                background: palette.charcoal,
                backdrop: palette.charcoal,
                opaqueBackdrop: palette.charcoal,
                sectionLabel: palette.apricot,
                separator: `linear-gradient(${palette.midnightGray}, ${palette.midnightGray})`,
            },
            topbar: {
                background: palette.charcoal,
            },
            avatar: {
                background: palette.steelGray,
                foreground: palette.pearlGray,
                radius: '99px',
                fontSize: '0.75rem',
            },
            tag: {
                background: palette.tangerine,
                foreground: palette.charcoal,
                radius: '9px',
                fontSize: '0.7rem',
                fontWeight: 400,
            },
            item: {
                radius: '8px',
                fontSize: '0.875rem',
                fontWeight: 500,
                hover: palette.charcoalBlue,
                active: palette.graphiteBlue,
            },
        },
        control: {
            button: {
                background: palette.steelGray,
                hover: palette.deepGraphite,
                foreground: palette.pearlGray,
            },
            slidingSwitch: {
                track: palette.charcoalBlue,
                indicator: palette.graphiteBlue,
                inactive: palette.silverBlue,
                hovered: palette.paleSilver,
                selected: palette.paleSilver,
                disabled: palette.stormGray,
                closeHover: palette.slateBlue,
                shadow: 'none',
            },
            dropdown: {
                background: palette.deepCharcoal,
                indicator: palette.graphiteBlue,
                inactive: palette.silverBlue,
                selected: palette.paleSilver,
                disabled: palette.stormGray,
            },
            scrollbar: {
                thumb: palette.smokeBlue38,
                hover: palette.denimGray50,
                active: palette.dustyBlue50,
            },
        },
        panel: {
            resizeHandle: {
                gradient: `linear-gradient(${palette.slateBlue}, ${palette.slateBlue})`,
                width: '3px',
            },
            toggle: {
                color: palette.silverBlue,
                hover: palette.paleSilver,
            },
            background: palette.deepCharcoal,
            opaqueBackground: palette.deepCharcoal,
        },
        selection: {
            background: palette.blueGray38,
            foreground: palette.paleSilver,
        },
        shadow: {
            sidebar: `2px 0 4px -2px ${marianaShadowPalette.black22}`,
            topbar: `0 2px 4px -2px ${marianaShadowPalette.black14}`,
            card: `0 2px 5px -2px ${marianaShadowPalette.black16}`,
            control: `0 1px 3px -1px ${marianaShadowPalette.black14}`,
        },
        visualization: {
            categorical: [
                palette.electricPurple,
                palette.coralOrange,
                palette.orchid,
            ],
        },
        editor: {
            inlineCode: {
                foreground: palette.coralRed,
            },
            placeholder: {
                foreground: palette.silverBlue,
            },
            referenceChip: {
                onLight: {
                    asset: palette.electricBlue,
                    capability: palette.coralOrange,
                    tool: palette.seaGreen,
                    skill: palette.mauve,
                },
                onDark: {
                    asset: palette.skyBlue,
                    capability: palette.apricot,
                    tool: palette.seaGreen,
                    skill: palette.orchid,
                },
            },
            markdown: {
                heading: palette.pearlGray,
                codeBackground: palette.charcoal,
                inlineCodeBackground: palette.graphiteBlue,
                codeRadius: '4px',
                inlineCodeRadius: '3px',
            },
            code: {
                background: palette.charcoal,
                foreground: palette.paleBlueGray,
            },
            syntax: {
                comment: palette.silverBlue,
                string: palette.sageGreen,
                number: palette.amber,
                constant: palette.salmon,
                keyword: palette.mauve,
                operator: palette.coralOrange,
                function: palette.seaGreen,
                property: palette.cornflowerBlue,
            },
            math: {
                variable: palette.skyBlue,
                greek: palette.mauve,
                number: palette.amber,
                operator: palette.coralOrange,
                function: palette.seaGreen,
            },
        },
    }) as const satisfies ThemeRoles
