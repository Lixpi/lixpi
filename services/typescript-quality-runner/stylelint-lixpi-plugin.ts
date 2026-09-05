import stylelint, {
    type PostcssResult,
} from 'stylelint'
import valueParser from 'postcss-value-parser'

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

type CssValueNode = {
    nodes?: CssValueNode[]
    type: string
    value: string
}

type CssValueRoot = {
    nodes: CssValueNode[]
}

const transitionRuleName = 'lixpi/transition-helpers'
const transitionMessages = stylelint.utils.ruleMessages(
    transitionRuleName,
    {
        expected: value => `Expected "${value}" to use a shared transition helper or custom property`,
    },
)
const blockCommentRuleName = 'lixpi/no-block-comments'
const blockCommentMessages = stylelint.utils.ruleMessages(
    blockCommentRuleName,
    {
        expected: 'Use // comments instead of block comments',
    },
)
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

const isLowercaseIdentifierCharacter = (character: string | undefined): boolean => Boolean(
    character
    && (
        character === '-'
        || character >= '0' && character <= '9'
        || character >= 'a' && character <= 'z'
    ),
)

// Longest first, so `--x-transitions` is not matched as `--x-transition`.
const transitionCustomPropertySuffixes = [
    '-transitions',
    '-transition',
]

const isTransitionCustomProperty = (property: string): boolean => {
    if (!property.startsWith('--'))
        return false

    const suffix = transitionCustomPropertySuffixes.find(candidate => property.endsWith(candidate))

    if (!suffix)
        return false

    const nameEnd = property.length - suffix.length

    if (nameEnd <= 2)
        return false

    for (let index = 2; index < nameEnd; index++) if (!isLowercaseIdentifierCharacter(property[index]))
        return false

    return true
}

const getUnqualifiedFunctionName = (value: string): string => {
    const interpolationOffset = value.startsWith('#{') ? 2 : 0
    let nameStart = interpolationOffset

    for (let index = value.length - 1; index >= interpolationOffset; index--)
        if (value[index] === '.') {
            nameStart = index + 1

            break
        }

    return value.slice(nameStart)
}

const isSharedTransitionFunction = (node: CssValueNode): boolean => node.type === 'function'
    && (
        getUnqualifiedFunctionName(node.value) === 'var'
        || transitionHelpers.has(
            getUnqualifiedFunctionName(
                node.value,
            ),
        )
    )

const getTopLevelValueGroups = (nodes: CssValueNode[]): CssValueNode[][] => {
    const groups: CssValueNode[][] = [[]]

    for (const node of nodes) {
        if (
            node.type === 'div'
            && node.value === ','
        ) {
            groups.push([])

            continue
        }

        if (node.type !== 'space')
            groups.at(-1)!.push(node)
    }

    return groups
}

const isSharedTransitionGroup = (nodes: CssValueNode[]): boolean => {
    if (nodes.length === 1) {
        const node = nodes[0]!

        return node.type === 'word' && cssWideKeywords.has(node.value)
            || isSharedTransitionFunction(node)
    }

    return nodes.length === 2
        && nodes[0]!.type === 'function'
        && nodes[0]!.value.startsWith('#{')
        && isSharedTransitionFunction(nodes[0]!)
        && nodes[1]!.type === 'word'
        && nodes[1]!.value === '}'
}

const isSharedTransitionValue = (value: string): boolean => {
    const parsed = valueParser(value) as CssValueRoot

    return getTopLevelValueGroups(parsed.nodes).every(isSharedTransitionGroup)
}

const transitionHelpersRule = (primary: boolean) => (root: Root, result: PostcssResult) => {
    if (!primary)
        return

    root.walkDecls(
        (declaration: Declaration) => {
            const property = declaration.prop.toLowerCase()
            const isTransitionValue = (
                property === 'transition'
                || isTransitionCustomProperty(property)
            )
            const isSplitTransitionProperty = (
                property === 'transition-delay'
                || property === 'transition-duration'
                || property === 'transition-timing-function'
            )
    
            const isValid = (
                isTransitionValue
                && isSharedTransitionValue(declaration.value)
            )

            if (
                (
                    !isSplitTransitionProperty
                    && !isTransitionValue
                )
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
        },
    )
}

transitionHelpersRule.ruleName = transitionRuleName
transitionHelpersRule.messages = transitionMessages
transitionHelpersRule.meta = {
    url: 'documentation/coding-style-guides/SASS-AND-CSS.md#transitions',
}

const isHorizontalWhitespace = (character: string | undefined): boolean => character === ' ' || character === '\t' || character === '\r'

const normalizeCommentLine = (line: string): string => {
    let start = 0
    let end = line.length

    while (
        start < end
        && isHorizontalWhitespace(line[start])
    )
        start++

    if (line[start] === '*') {
        start++

        if (line[start] === ' ')
            start++
    }

    while (
        end > start
        && isHorizontalWhitespace(line[end - 1])
    )
        end--

    return line.slice(start, end)
}

const getCommentLines = (comment: Comment): string[] => {
    const lines = comment.text.split('\n').map(normalizeCommentLine)

    while (lines[0] === '')
        lines.shift()

    while (lines.at(-1) === '')
        lines.pop()

    return lines.length > 0 ? lines : ['']
}

const getCommentIndentation = (comment: Comment): string => {
    const finalWhitespaceLine = (comment.raws.before ?? '').split('\n').at(-1)
        ?? ''
    let end = 0

    while (
        end < finalWhitespaceLine.length
        && isHorizontalWhitespace(finalWhitespaceLine[end])
    )
        end++

    return finalWhitespaceLine.slice(0, end)
}

const convertBlockComment = (comment: Comment): void => {
    const lines = getCommentLines(comment)
    const indentation = getCommentIndentation(comment)
    const comments = lines.map(
        (line, index) => comment.clone({
            text: line,
            raws: {
                ...comment.raws,
                before: index === 0 ? comment.raws.before : `\n${indentation}`,
                inline: true,
                left: line.length > 0 ? ' ' : '',
                right: '',
            },
        }),
    )
    comment.replaceWith(...comments)
}

const noBlockCommentsRule = (
    primary: boolean,
    _secondaryOptions: unknown,
    context: RuleContext = {},
) =>
(root: Root, result: PostcssResult) => {
    if (!primary)
        return

    root.walkComments(
        comment => {
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
        },
    )
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
