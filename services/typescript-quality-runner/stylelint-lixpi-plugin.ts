import stylelint, {
    type PostcssResult,
} from 'stylelint'

type Declaration = {
    prop: string
    value: string
}

type Comment = {
    clone: (overrides: {
        raws: CommentRaws
        text: string
    }) => Comment
    raws: CommentRaws
    replaceWith: (...comments: Comment[]) => void
    text: string
}

type CommentRaws = {
    before?: string
    inline?: boolean
    left?: string
    right?: string
}

type Root = {
    walkComments: (callback: (comment: Comment) => void) => void
    walkDecls: (callback: (declaration: Declaration) => void) => void
}

type RuleContext = {
    fix?: boolean
}

const transitionRuleName = 'lixpi/transition-helpers'
const transitionMessages = stylelint.utils.ruleMessages(transitionRuleName, {
    expected: value => `Expected "${value}" to use a shared transition helper or custom property`,
})
const blockCommentRuleName = 'lixpi/no-block-comments'
const blockCommentMessages = stylelint.utils.ruleMessages(blockCommentRuleName, {
    expected: 'Use // comments instead of block comments',
})
const transitionHelpers = new Set([
    'hoverTransition',
    'overlayVisibilityTransition',
    'panelSlideTransition',
    'pupOutTransition',
    'standardTransition',
])
const cssWideKeywords = new Set([
    'inherit',
    'initial',
    'none',
    'revert',
    'revert-layer',
    'unset',
])

const splitTopLevelCommas = (value: string): string[] => {
    const parts: string[] = []
    let depth = 0
    let start = 0

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]
        if (character === '(' || character === '{')
            depth += 1
        else if (character === ')' || character === '}')
            depth -= 1
        else if (character === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim())
            start = index + 1
        }
    }

    parts.push(value.slice(start).trim())
    return parts
}

const unwrapInterpolation = (value: string): string => {
    if (value.startsWith('#{') && value.endsWith('}'))
        return value.slice(2, -1).trim()

    return value
}

const isCompleteFunctionCall = (value: string, allowedFunctions: Set<string>): boolean => {
    const openParenthesis = value.indexOf('(')
    if (openParenthesis < 1 || !value.endsWith(')'))
        return false

    const qualifiedName = value.slice(0, openParenthesis).trim()
    const functionName = qualifiedName.split('.').at(-1)
    if (!functionName || !allowedFunctions.has(functionName))
        return false

    let depth = 0
    for (let index = openParenthesis; index < value.length; index += 1) {
        const character = value[index]
        if (character === '(')
            depth += 1
        else if (character === ')') {
            depth -= 1
            if (depth === 0 && index !== value.length - 1)
                return false
        }

        if (depth < 0)
            return false
    }

    return depth === 0
}

const isSharedTransition = (value: string): boolean => {
    const normalizedValue = unwrapInterpolation(value.trim())
    if (cssWideKeywords.has(normalizedValue))
        return true

    return isCompleteFunctionCall(normalizedValue, new Set(['var'])) || isCompleteFunctionCall(normalizedValue, transitionHelpers)
}

const transitionHelpersRule = (primary: boolean) => (root: Root, result: PostcssResult) => {
    if (!primary)
        return

    root.walkDecls((declaration: Declaration) => {
        const property = declaration.prop.toLowerCase()
        const isTransitionValue = property === 'transition' || /^--[a-z0-9-]+-transitions?$/.test(property)
        const isSplitTransitionProperty = property === 'transition-delay' || property === 'transition-duration' || property === 'transition-timing-function'

        const isValid = isTransitionValue && splitTopLevelCommas(declaration.value).every(isSharedTransition)
        if (
            (!isSplitTransitionProperty && !isTransitionValue)
            || isValid
        )
            return

        stylelint.utils.report({
            message: transitionMessages.expected(declaration.value),
            node: declaration,
            result,
            ruleName: transitionRuleName,
            word: declaration.value,
        })
    })
}

transitionHelpersRule.ruleName = transitionRuleName
transitionHelpersRule.messages = transitionMessages
transitionHelpersRule.meta = {
    url: 'documentation/coding-style-guides/SASS-AND-CSS.md#transitions',
}

const isHorizontalWhitespace = (character: string | undefined): boolean =>
    character === ' ' || character === '\t' || character === '\r'

const normalizeCommentLine = (line: string): string => {
    let start = 0
    let end = line.length
    while (start < end && isHorizontalWhitespace(line[start])) start++
    if (line[start] === '*') {
        start++
        if (line[start] === ' ')
            start++
    }
    while (end > start && isHorizontalWhitespace(line[end - 1])) end--
    return line.slice(start, end)
}

const getCommentLines = (comment: Comment): string[] => {
    const lines = comment.text.split('\n').map(normalizeCommentLine)
    while (lines[0] === '') lines.shift()
    while (lines.at(-1) === '') lines.pop()
    return lines.length > 0 ? lines : ['']
}

const getCommentIndentation = (comment: Comment): string => {
    const finalWhitespaceLine = (comment.raws.before ?? '').split('\n').at(-1) ?? ''
    let end = 0
    while (end < finalWhitespaceLine.length && isHorizontalWhitespace(finalWhitespaceLine[end])) end++
    return finalWhitespaceLine.slice(0, end)
}

const convertBlockComment = (comment: Comment): void => {
    const lines = getCommentLines(comment)
    const indentation = getCommentIndentation(comment)
    const comments = lines.map((line, index) => comment.clone({
        text: line,
        raws: {
            ...comment.raws,
            before: index === 0 ? comment.raws.before : `\n${indentation}`,
            inline: true,
            left: line.length > 0 ? ' ' : '',
            right: '',
        },
    }))
    comment.replaceWith(...comments)
}

const noBlockCommentsRule = (primary: boolean, _secondaryOptions: unknown, context: RuleContext = {}) => (root: Root, result: PostcssResult) => {
    if (!primary)
        return

    root.walkComments((comment) => {
        if (comment.raws.inline)
            return
        if (context.fix) {
            convertBlockComment(comment)
            return
        }

        stylelint.utils.report({
            message: blockCommentMessages.expected,
            node: comment,
            result,
            ruleName: blockCommentRuleName,
        })
    })
}

noBlockCommentsRule.ruleName = blockCommentRuleName
noBlockCommentsRule.messages = blockCommentMessages
noBlockCommentsRule.meta = {
    fixable: true,
    url: 'documentation/coding-style-guides/SASS-AND-CSS.md',
}

export default [
    stylelint.createPlugin(transitionRuleName, transitionHelpersRule),
    stylelint.createPlugin(blockCommentRuleName, noBlockCommentsRule),
]
