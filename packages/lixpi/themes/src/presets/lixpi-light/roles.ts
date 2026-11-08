import {
    type ThemeRoles,
} from '../../template/application.ts'
import {
    type lixpiPalette,
} from '../../palettes/lixpi.ts'

type LixpiColors = Record<keyof typeof lixpiPalette, string>

const sansFontFamily = 'Söhne, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'

export const createLixpiLightRoles = (palette: LixpiColors) =>
    ({
        typography: {
            root: {
                fontSize: '15px',
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
                fontSize: '15px',
            },
            control: {
                fontFamily: 'inherit',
                fontSize: '12px',
                fontWeight: 400,
            },
            panel: {
                fontSize: '14px',
                lineHeight: 1.45,
            },
            code: {
                fontFamily: '"Söhne Mono", Monaco, "Andale Mono", "Ubuntu Mono", monospace',
                fontSize: '13px',
            },
        },
        surface: {
            page: palette.white,
            card: palette.white,
            inset: palette.white,
            hover: palette.cloud,
            active: palette.black09,
        },
        text: {
            body: palette.slate,
            heading: palette.ink,
            secondary: palette.nightBlue,
            muted: palette.steelBlue,
            disabled: palette.lightGrey,
            strong: palette.graphite,
            link: palette.cerulean,
        },
        border: {
            default: palette.silver,
            subtle: palette.black06,
            divider: palette.black14,
        },
        accent: {
            primary: palette.cornflowerBlue,
            secondary: palette.royalBlue,
            foreground: palette.offWhite,
        },
        feedback: {
            heartbeat: {
                rest: palette.signalRed,
                alternate: palette.seafoamGreen,
                peak: palette.pureRed,
            },
            info: palette.cerulean,
            success: palette.sageGreen,
            warning: palette.lemonYellow,
            danger: palette.red,
            tagPresentation: {
                radius: '9px',
                shadow: 'inset 0 0 0 1px',
            },
            tags: {
                success: {
                    background: palette.paleSage,
                    hover: palette.paleOlive,
                    foreground: palette.nightBlue,
                    border: palette.transparent,
                    closeHover: palette.nightBlue10,
                },
                warning: {
                    background: palette.paleCream,
                    hover: palette.offWhite,
                    foreground: palette.nightBlue,
                    border: palette.transparent,
                    closeHover: palette.nightBlue10,
                },
                danger: {
                    background: palette.palePeach,
                    hover: palette.offWhite,
                    foreground: palette.nightBlue,
                    border: palette.transparent,
                    closeHover: palette.nightBlue10,
                },
            },
        },
        navigation: {
            sidebar: {
                background: palette.transparent,
                backdrop: palette.frost94,
                opaqueBackdrop: palette.frost,
                sectionLabel: palette.ink,
                separator: `linear-gradient(90deg, ${palette.black00} 0%, ${palette.black04} 10%, ${palette.black08} 26%, ${palette.black14} 50%, ${palette.black08} 74%, ${palette.black04} 90%, ${palette.black00} 100%)`,
            },
            topbar: {
                background: palette.white,
            },
            avatar: {
                background: palette.blueGraphite,
                foreground: palette.alabaster,
                radius: '99px',
                fontSize: '0.75rem',
            },
            tag: {
                background: palette.tangerineOrange,
                foreground: palette.white,
                radius: '9px',
                fontSize: '0.7rem',
                fontWeight: 400,
            },
            item: {
                radius: '8px',
                fontSize: '0.875rem',
                fontWeight: 500,
                hover: palette.black06,
                active: palette.black09,
            },
        },
        control: {
            button: {
                background: palette.steelBlue,
                hover: palette.nightBlue,
                foreground: palette.offWhite,
            },
            slidingSwitch: {
                track: palette.slate09,
                indicator: palette.white72,
                inactive: palette.navy68,
                hovered: palette.navy,
                selected: palette.navy,
                disabled: palette.navy32,
                closeHover: palette.navy10,
                shadow: 'none',
            },
            dropdown: {
                background: palette.mist,
                indicator: palette.white72,
                inactive: palette.navy68,
                selected: palette.navy,
                disabled: palette.navy32,
            },
            scrollbar: {
                thumb: 'revert',
                hover: 'revert',
                active: 'revert',
            },
        },
        panel: {
            resizeHandle: {
                gradient: `linear-gradient(135deg, ${palette.lavenderBlush} 0%, ${palette.periwinkleFog} 100%)`,
                width: '3px',
            },
            toggle: {
                color: palette.slateGray,
                hover: palette.deepSlate,
            },
            background: palette.frost84,
            opaqueBackground: palette.frost,
        },
        selection: {
            background: palette.systemHighlight,
            foreground: palette.systemHighlightText,
        },
        shadow: {
            sidebar: 'none',
            topbar: 'none',
            card: `0 1px 6px ${palette.black15}`,
            control: `0.05rem 0.05rem 7px 0 ${palette.black20}`,
        },
        visualization: {
            categorical: [
                palette.plum,
                palette.burntOrange,
                palette.plum,
            ],
        },
        editor: {
            inlineCode: {
                foreground: palette.crimson,
            },
            placeholder: {
                foreground: palette.lightGrey,
            },
            referenceChip: {
                onLight: {
                    asset: palette.denimBlue,
                    capability: palette.copper,
                    tool: palette.teal,
                    skill: palette.violet,
                },
                onDark: {
                    asset: palette.iceBlue,
                    capability: palette.apricot,
                    tool: palette.seafoam,
                    skill: palette.lavender,
                },
            },
            markdown: {
                heading: palette.navy,
                codeBackground: palette.navy06,
                inlineCodeBackground: palette.navy08,
                codeRadius: '4px',
                inlineCodeRadius: '3px',
            },
            code: {
                background: palette.fog,
                foreground: palette.espresso,
            },
            syntax: {
                comment: palette.taupe,
                string: palette.espresso,
                number: palette.plum,
                constant: palette.plum,
                keyword: palette.crimson,
                operator: palette.crimson,
                function: palette.oliveGreen,
                property: palette.fernGreen,
            },
            math: {
                variable: palette.petrolBlue,
                greek: palette.crimson,
                number: palette.plum,
                operator: palette.crimson,
                function: palette.oliveGreen,
            },
        },
    }) as const satisfies ThemeRoles
