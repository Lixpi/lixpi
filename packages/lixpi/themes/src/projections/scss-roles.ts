import {
    type ApplicationTheme,
} from '../template/application.ts'

type KebabCase<Value extends string> = Value extends `${infer First}${infer Rest}`
    ? `${First extends Lowercase<First> ? First : `-${Lowercase<First>}`}${KebabCase<Rest>}`
    : Value

type ComponentStylesheetPath<Value, Prefix extends string = 'components'> = {
    [Key in keyof Value & string]: Value[Key] extends string | number
        ? `${Prefix}-${KebabCase<Key>}`
        : ComponentStylesheetPath<Value[Key], `${Prefix}-${KebabCase<Key>}`>
}[keyof Value & string]

type ComponentStylesheetRoles = Record<ComponentStylesheetPath<ApplicationTheme['components']>, string>

const componentStylesheetRoles = (
    value: unknown,
    path = 'components',
): Record<string, string> => {
    if (
        typeof value === 'string'
        || typeof value === 'number'
    )
        return { [path]: String(value) }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).flatMap(
            ([name, child]) => Object.entries(
                componentStylesheetRoles(child, `${path}-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`),
            ),
        ),
    )
}

// Existing Sass consumers use these flat names. TypeScript consumers use the theme domains.
export const themeStylesheetRoles = (theme: ApplicationTheme) => ({
    ...componentStylesheetRoles(theme.components) as ComponentStylesheetRoles,
    'font-family': theme.typography.body.fontFamily,
    'font-mono': theme.typography.code.fontFamily,
    'root-font-size': theme.typography.root.fontSize,
    'font-size': theme.typography.body.fontSize,
    'code-size': theme.typography.code.fontSize,
    'code-inline-size': theme.typography.codeInlineSize,
    'font-weight': String(theme.typography.weight.normal),
    'font-weight-strong': String(theme.typography.weight.strong),
    'heading-font-weight': String(theme.typography.heading.fontWeight),
    'heading-line-height': String(theme.typography.heading.lineHeight),
    'heading-letter-spacing': theme.typography.heading.letterSpacing,
    'h1-size': theme.typography.heading.sizes.h1,
    'h2-size': theme.typography.heading.sizes.h2,
    'h3-size': theme.typography.heading.sizes.h3,
    'h4-size': theme.typography.heading.sizes.h4,
    'h5-size': theme.typography.heading.sizes.h5,
    'h6-size': theme.typography.heading.sizes.h6,
    'markdown-font-mono': theme.typography.markdown.fontFamily,
    'markdown-code-size': theme.typography.markdown.codeSize,
    'markdown-code-line-height': String(theme.typography.markdown.codeLineHeight),
    'markdown-inline-code-size': theme.typography.markdown.inlineCodeSize,
    'markdown-heading-weight': String(theme.typography.markdown.headingWeight),
    'markdown-heading-line-height': String(theme.typography.markdown.headingLineHeight),
    'markdown-h1-size': theme.typography.markdown.headingSizes.h1,
    'markdown-h2-size': theme.typography.markdown.headingSizes.h2,
    'markdown-h3-size': theme.typography.markdown.headingSizes.h3,
    'markdown-h4-size': theme.typography.markdown.headingSizes.h4,
    'markdown-heading': theme.editor.markdown.heading,
    'markdown-code-background': theme.editor.markdown.codeBackground,
    'markdown-inline-code-background': theme.editor.markdown.inlineCodeBackground,
    'markdown-code-radius': theme.editor.markdown.codeRadius,
    'markdown-inline-code-radius': theme.editor.markdown.inlineCodeRadius,
    'intro-font-size': theme.typography.intro.fontSize,
    'intro-font-weight': String(theme.typography.intro.fontWeight),
    'intro-accent-weight': String(theme.typography.intro.accentWeight),
    'intro-masked-weight': String(theme.typography.intro.maskedWeight),
    'feedback-tag-font-size': theme.typography.feedbackTag.fontSize,
    'feedback-tag-font-weight': String(theme.typography.feedbackTag.fontWeight),
    'feedback-tag-radius': theme.feedback.tagPresentation.radius,
    'feedback-tag-shadow': `${theme.feedback.tagPresentation.shadow} var(--feedback-tag-border-color)`,
    'control-font-family': theme.typography.control.fontFamily,
    'control-font-size': theme.typography.control.fontSize,
    'control-font-weight': String(theme.typography.control.fontWeight),
    'panel-font-size': theme.typography.panel.fontSize,
    'panel-line-height': String(theme.typography.panel.lineHeight),
    'panel-resize-handle-gradient': theme.panel.resizeHandle.gradient,
    'panel-resize-handle-width': theme.panel.resizeHandle.width,
    'panel-toggle-color': theme.panel.toggle.color,
    'panel-toggle-hover': theme.panel.toggle.hover,
    'panel-background': theme.panel.background,
    'panel-background-opaque': theme.panel.opaqueBackground,
    'switch-track': theme.control.slidingSwitch.track,
    'switch-indicator': theme.control.slidingSwitch.indicator,
    'switch-inactive': theme.control.slidingSwitch.inactive,
    'switch-hovered': theme.control.slidingSwitch.hovered,
    'switch-selected': theme.control.slidingSwitch.selected,
    'switch-disabled': theme.control.slidingSwitch.disabled,
    'switch-close-hover': theme.control.slidingSwitch.closeHover,
    'switch-shadow': theme.control.slidingSwitch.shadow,
    'dropdown-background': theme.control.dropdown.background,
    'dropdown-indicator': theme.control.dropdown.indicator,
    'dropdown-inactive': theme.control.dropdown.inactive,
    'dropdown-selected': theme.control.dropdown.selected,
    'dropdown-disabled': theme.control.dropdown.disabled,
    background: theme.surface.page,
    surface: theme.surface.card,
    'surface-secondary': theme.surface.inset,
    'surface-hover': theme.surface.hover,
    'surface-active': theme.surface.active,
    'sidebar-background': theme.navigation.sidebar.background,
    'navigation-backdrop': theme.navigation.sidebar.backdrop,
    'navigation-backdrop-opaque': theme.navigation.sidebar.opaqueBackdrop,
    'sidebar-section': theme.navigation.sidebar.sectionLabel,
    'topbar-background': theme.navigation.topbar.background,
    'shadow-sidebar': theme.shadow.sidebar,
    'shadow-topbar': theme.shadow.topbar,
    'shadow-surface': theme.shadow.card,
    'shadow-control': theme.shadow.control,
    text: theme.text.body,
    heading: theme.text.heading,
    'text-secondary': theme.text.secondary,
    'text-muted': theme.text.muted,
    'editor-inline-code-foreground': theme.editor.inlineCode.foreground,
    'editor-placeholder-foreground': theme.editor.placeholder.foreground,
    'code-text': theme.editor.code.foreground,
    'code-background': theme.editor.code.background,
    'text-disabled': theme.text.disabled,
    border: theme.border.default,
    'border-subtle': theme.border.subtle,
    divider: theme.border.divider,
    accent: theme.accent.primary,
    'accent-secondary': theme.accent.secondary,
    'heartbeat-rest': theme.feedback.heartbeat.rest,
    'heartbeat-alternate': theme.feedback.heartbeat.alternate,
    'heartbeat-peak': theme.feedback.heartbeat.peak,
    info: theme.feedback.info,
    success: theme.feedback.success,
    warning: theme.feedback.warning,
    danger: theme.feedback.danger,
    'feedback-tag-success-background': theme.feedback.tags.success.background,
    'feedback-tag-success-hover': theme.feedback.tags.success.hover,
    'feedback-tag-success-text': theme.feedback.tags.success.foreground,
    'feedback-tag-success-border': theme.feedback.tags.success.border,
    'feedback-tag-success-close-hover': theme.feedback.tags.success.closeHover,
    'feedback-tag-warning-background': theme.feedback.tags.warning.background,
    'feedback-tag-warning-hover': theme.feedback.tags.warning.hover,
    'feedback-tag-warning-text': theme.feedback.tags.warning.foreground,
    'feedback-tag-warning-border': theme.feedback.tags.warning.border,
    'feedback-tag-warning-close-hover': theme.feedback.tags.warning.closeHover,
    'feedback-tag-danger-background': theme.feedback.tags.danger.background,
    'feedback-tag-danger-hover': theme.feedback.tags.danger.hover,
    'feedback-tag-danger-text': theme.feedback.tags.danger.foreground,
    'feedback-tag-danger-border': theme.feedback.tags.danger.border,
    'feedback-tag-danger-close-hover': theme.feedback.tags.danger.closeHover,
    'button-background': theme.control.button.background,
    'button-hover': theme.control.button.hover,
    'button-text': theme.control.button.foreground,
    'selection-background': theme.selection.background,
    'selection-text': theme.selection.foreground,
    scrollbar: theme.control.scrollbar.thumb,
    'scrollbar-hover': theme.control.scrollbar.hover,
    'scrollbar-active': theme.control.scrollbar.active,
    'reference-chip-light-asset': theme.editor.referenceChip.onLight.asset,
    'reference-chip-light-capability': theme.editor.referenceChip.onLight.capability,
    'reference-chip-light-tool': theme.editor.referenceChip.onLight.tool,
    'reference-chip-light-skill': theme.editor.referenceChip.onLight.skill,
    'reference-chip-dark-asset': theme.editor.referenceChip.onDark.asset,
    'reference-chip-dark-capability': theme.editor.referenceChip.onDark.capability,
    'reference-chip-dark-tool': theme.editor.referenceChip.onDark.tool,
    'reference-chip-dark-skill': theme.editor.referenceChip.onDark.skill,
    'syntax-comment': theme.editor.syntax.comment,
    'syntax-string': theme.editor.syntax.string,
    'syntax-number': theme.editor.syntax.number,
    'syntax-constant': theme.editor.syntax.constant,
    'syntax-keyword': theme.editor.syntax.keyword,
    'syntax-operator': theme.editor.syntax.operator,
    'syntax-function': theme.editor.syntax.function,
    'syntax-property': theme.editor.syntax.property,
    'math-variable': theme.editor.math.variable,
    'math-greek': theme.editor.math.greek,
    'math-number': theme.editor.math.number,
    'math-operator': theme.editor.math.operator,
    'math-function': theme.editor.math.function,
    'text-strong': theme.text.strong,
    link: theme.text.link,
    'navigation-separator': theme.navigation.sidebar.separator,
    'navigation-item-radius': theme.navigation.item.radius,
    'navigation-item-font-size': theme.navigation.item.fontSize,
    'navigation-item-font-weight': String(theme.navigation.item.fontWeight),
    'navigation-avatar-background': theme.navigation.avatar.background,
    'navigation-avatar-foreground': theme.navigation.avatar.foreground,
    'navigation-avatar-radius': theme.navigation.avatar.radius,
    'navigation-avatar-font-size': theme.navigation.avatar.fontSize,
    'navigation-tag-background': theme.navigation.tag.background,
    'navigation-tag-foreground': theme.navigation.tag.foreground,
    'navigation-tag-radius': theme.navigation.tag.radius,
    'navigation-tag-font-size': theme.navigation.tag.fontSize,
    'navigation-tag-font-weight': String(theme.navigation.tag.fontWeight),
    'navigation-hover': theme.navigation.item.hover,
    'navigation-active': theme.navigation.item.active,
    'on-accent': theme.accent.foreground,
    'chart-series-1': theme.visualization.categorical[0],
    'chart-series-2': theme.visualization.categorical[1],
    'chart-series-3': theme.visualization.categorical[2],
})

type StylesheetRoles = ReturnType<typeof themeStylesheetRoles>
type StylesheetRole = keyof StylesheetRoles

// Keep an existing CSS override relationship when both roles still resolve to the same theme value.
export const withStylesheetAliases = (
    roles: StylesheetRoles,
    aliases: Partial<Record<StylesheetRole, StylesheetRole>>,
) => {
    const result: Record<StylesheetRole, string> = { ...roles }

    for (const key of Object.keys(aliases) as StylesheetRole[]) {
        const source = aliases[key]

        if (
            source
            && roles[key] === roles[source]
        )
            result[key] = `var(--theme-${source})`
    }

    return result
}
