import stylelint, {
    type PostcssResult,
} from 'stylelint'

type Declaration = {
    prop: string
    value: string
}

type Root = {
    walkDecls: (callback: (declaration: Declaration) => void) => void
}

const ruleName = 'lixpi/transition-helpers'
const messages = stylelint.utils.ruleMessages(ruleName, {
    expected: (value) => `Expected "${value}" to use a shared transition helper or custom property`,
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

function splitTopLevelCommas(value: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index]
        if (character === '(' || character === '{') {
            depth += 1
        } else if (character === ')' || character === '}') {
            depth -= 1
        } else if (character === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim())
            start = index + 1
        }
    }

    parts.push(value.slice(start).trim())
    return parts
}

function unwrapInterpolation(value: string): string {
    if (value.startsWith('#{') && value.endsWith('}')) {
        return value.slice(2, -1).trim()
    }

    return value
}

function isCompleteFunctionCall(value: string, allowedFunctions: Set<string>): boolean {
    const openParenthesis = value.indexOf('(')
    if (openParenthesis < 1 || !value.endsWith(')')) {
        return false
    }

    const qualifiedName = value.slice(0, openParenthesis).trim()
    const functionName = qualifiedName.split('.').at(-1)
    if (!functionName || !allowedFunctions.has(functionName)) {
        return false
    }

    let depth = 0
    for (let index = openParenthesis; index < value.length; index += 1) {
        const character = value[index]
        if (character === '(') {
            depth += 1
        } else if (character === ')') {
            depth -= 1
            if (depth === 0 && index !== value.length - 1) {
                return false
            }
        }

        if (depth < 0) {
            return false
        }
    }

    return depth === 0
}

function isSharedTransition(value: string): boolean {
    const normalizedValue = unwrapInterpolation(value.trim())
    if (cssWideKeywords.has(normalizedValue)) {
        return true
    }

    return isCompleteFunctionCall(normalizedValue, new Set(['var']))
        || isCompleteFunctionCall(normalizedValue, transitionHelpers)
}

const transitionHelpersRule = (primary: boolean) => {
    return (root: Root, result: PostcssResult) => {
        if (!primary) {
            return
        }

        root.walkDecls((declaration: Declaration) => {
            const property = declaration.prop.toLowerCase()
            const isTransitionValue = property === 'transition'
                || /^--[a-z0-9-]+-transitions?$/.test(property)
            const isSplitTransitionProperty = property === 'transition-delay'
                || property === 'transition-duration'
                || property === 'transition-timing-function'

            const isValid = isTransitionValue
                && splitTopLevelCommas(declaration.value).every(isSharedTransition)
            if (!isSplitTransitionProperty && (!isTransitionValue || isValid)) {
                return
            }

            stylelint.utils.report({
                message: messages.expected(declaration.value),
                node: declaration,
                result,
                ruleName,
                word: declaration.value,
            })
        })
    }
}

transitionHelpersRule.ruleName = ruleName
transitionHelpersRule.messages = messages
transitionHelpersRule.meta = {
    url: 'documentation/coding-style-guides/SASS-AND-CSS.md#transitions',
}

export default stylelint.createPlugin(ruleName, transitionHelpersRule)
