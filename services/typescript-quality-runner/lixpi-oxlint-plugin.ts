import {
    definePlugin,
    defineRule,
} from '@oxlint/plugins'
import { parseSync } from 'oxc-parser'

const isAstNode = (value: unknown): boolean => Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { type?: unknown }).type === 'string',
)

const collectIdentifierNames = (
    node,
    names: Set<string>,
): void => {
    if (node.type === 'Identifier')
        names.add(node.name)

    for (const [key, value] of Object.entries(node)) {
        if (key === 'parent')
            continue

        if (Array.isArray(value)) {
            for (const child of value)
                if (isAstNode(child))
                    collectIdentifierNames(child, names)
        } else if (isAstNode(value))
            collectIdentifierNames(value, names)
    }
}

const getCommentReferencedIdentifierNames = (sourceCode): Set<string> => {
    const names = new Set<string>()
    const commentBlocks: string[] = []
    let currentLines: string[] = []
    let previousLineComment = null

    const flushCurrentLines = (): void => {
        if (currentLines.length > 0)
            commentBlocks.push(
                currentLines.join('\n'),
            )

        currentLines = []
    }

    for (const comment of sourceCode.getAllComments()) {
        if (
            comment.type === 'Line'
            && (previousLineComment == null || comment.loc.start.line === previousLineComment.loc.end.line + 1)
        ) {
            currentLines.push(comment.value)
            previousLineComment = comment

            continue
        }

        flushCurrentLines()
        previousLineComment = null

        if (comment.type === 'Block')
            commentBlocks.push(comment.value)

        if (comment.type === 'Line') {
            currentLines.push(comment.value)
            previousLineComment = comment
        }
    }

    flushCurrentLines()

    for (const commentBlock of commentBlocks)
        for (const commentSource of [commentBlock, ...commentBlock.split('\n')]) {
            const parseResult = parseSync(
                'comment-reference.ts',
                commentSource,
                {
                    astType: 'ts',
                    preserveParens: true,
                    range: true,
                },
            )
            collectIdentifierNames(parseResult.program, names)
        }

    return names
}

const noUnusedImports = defineRule({
    meta: {
        type: 'problem',
        fixable: 'code',
        messages: {
            unusedImport: "Imported identifier '{{name}}' is never used.",
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context
        // `no-native-console-logging` rewrites `console.log(...)` onto the debug-tools
        // specifier of the same name in this very fix round. Removing that specifier as
        // unused in the same round leaves the rewritten call with nothing to bind to, so
        // a specifier the console rule is about to claim counts as used.
        const pendingConsoleImportNames = new Set()

        return {
            CallExpression(node) {
                if (
                    node.callee.type !== 'MemberExpression'
                    || node.callee.computed
                    || node.callee.object.type !== 'Identifier'
                    || node.callee.object.name !== 'console'
                    || node.callee.property.type !== 'Identifier'
                    || !debugLoggingMethods.has(node.callee.property.name)
                )
                    return

                pendingConsoleImportNames.add(debugLoggingMethods.get(node.callee.property.name).importedName)
            },
            'Program:exit'() {
                const commentReferencedNames = getCommentReferencedIdentifierNames(sourceCode)
                const unusedSpecifiersByDeclaration = new Map()

                for (const scope of context.sourceCode.scopeManager.scopes)
                    for (const variable of scope.variables) {
                        if (
                            variable.references.length > 0
                            || commentReferencedNames.has(variable.name)
                        )
                            continue

                        const importDefinition = variable.defs.find(definition => definition.type === 'ImportBinding')

                        if (!importDefinition)
                            continue

                        const specifier = importDefinition.name.parent
                        const declaration = specifier?.parent

                        if (
                            !specifier
                            || declaration?.type !== 'ImportDeclaration'
                        )
                            continue

                        if (
                            declaration.source.value === '@lixpi/debug-tools'
                            && specifier.type === 'ImportSpecifier'
                            && specifier.imported.type === 'Identifier'
                            && pendingConsoleImportNames.has(specifier.imported.name)
                        )
                            continue

                        const unusedSpecifiers = (
                            unusedSpecifiersByDeclaration.get(declaration)
                            ?? []
                        )
                        unusedSpecifiers.push({
                            name: variable.name,
                            specifier,
                        })
                        unusedSpecifiersByDeclaration.set(declaration, unusedSpecifiers)
                    }

                for (const [declaration, unusedSpecifiers] of unusedSpecifiersByDeclaration) {
                    const unusedNodes = new Set(
                        unusedSpecifiers.map(({ specifier }) => specifier),
                    )
                    const remainingSpecifiers = declaration.specifiers.filter(specifier => !unusedNodes.has(specifier))
                    const names = unusedSpecifiers.map(({ name }) => name).join(', ')

                    context.report({
                        node: unusedSpecifiers[0].specifier,
                        messageId: 'unusedImport',
                        data: { name: names },
                        fix: fixer => {
                            if (remainingSpecifiers.length === 0)
                                return fixer.remove(declaration)

                            const defaultSpecifier = remainingSpecifiers.find(specifier => specifier.type === 'ImportDefaultSpecifier')
                            const namespaceSpecifier = remainingSpecifiers.find(specifier => specifier.type === 'ImportNamespaceSpecifier')
                            const namedSpecifiers = remainingSpecifiers.filter(specifier => specifier.type === 'ImportSpecifier')
                            const clauseParts: string[] = []

                            if (defaultSpecifier)
                                clauseParts.push(
                                    sourceCode.getText(defaultSpecifier),
                                )

                            if (namespaceSpecifier)
                                clauseParts.push(
                                    sourceCode.getText(namespaceSpecifier),
                                )

                            if (namedSpecifiers.length > 0)
                                clauseParts.push(`{ ${namedSpecifiers.map(specifier => sourceCode.getText(specifier)).join(', ')} }`)

                            const sourceText = sourceCode.getText(declaration.source)
                            const suffix = sourceCode.text.slice(declaration.source.range[1], declaration.range[1])

                            return fixer.replaceText(declaration, `import ${clauseParts.join(', ')} from ${sourceText}${suffix}`)
                        },
                    })
                }
            },
        }
    },
})

const hasReferenceBeforeDeclaration = (
    context,
    node,
): boolean =>
    context.sourceCode.scopeManager.scopes.some(
        scope =>
            scope.variables.some(
                variable =>
                    variable.name === node.id.name
                    && variable.defs.some(definition => definition.node === node || definition.name === node.id)
                    && variable.references.some(reference => reference.identifier.range[0] < node.range[0]),
            ),
    )

const preferArrowFunctionDeclaration = defineRule({
    meta: {
        type: 'suggestion',
        fixable: 'code',
        messages: {
            preferArrowFunction: 'Use an arrow function instead of a plain function declaration.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            FunctionDeclaration(node) {
                if (
                    !node.id
                    || !node.body
                    || node.generator
                    || node.parent?.type === 'ExportDefaultDeclaration'
                )
                    return

                if (sourceCode.getCommentsInside(node).some(comment => comment.range[1] <= node.id.range[1]))
                    return

                if (hasReferenceBeforeDeclaration(context, node))
                    return

                const replacement = `const ${node.id.name} = ${node.async ? 'async ' : ''}`

                context.report({
                    node,
                    messageId: 'preferArrowFunction',
                    fix: fixer => [
                        fixer.replaceTextRange([node.range[0], node.id.range[1]], replacement),
                        fixer.insertTextBefore(node.body, '=> '),
                    ],
                })
            },
        }
    },
})

const compactIfStatementTypes = new Set([
    'BreakStatement',
    'ContinueStatement',
    'ExpressionStatement',
    'ReturnStatement',
    'ThrowStatement',
])
const separatedBlockStatementTypes = new Set([
    'BlockStatement',
    'DoWhileStatement',
    'ForInStatement',
    'ForOfStatement',
    'ForStatement',
    'IfStatement',
    'SwitchStatement',
    'TryStatement',
    'WhileStatement',
    'WithStatement',
])
const separatedControlFlowStatementTypes = new Set([
    'BreakStatement',
    'ContinueStatement',
    'ReturnStatement',
    'ThrowStatement',
])
const isSeparatedStatementType = (type: string): boolean => separatedBlockStatementTypes.has(type)
    || separatedControlFlowStatementTypes.has(type)
const collectionConstructorNames = new Set([
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
])
const debugLoggingMethods = new Map([
    ['error', {
        importedName: 'err',
        preferredLocalName: 'debugError',
    }],
    ['info', {
        importedName: 'info',
        preferredLocalName: 'debugInfo',
    }],
    ['log', {
        importedName: 'log',
        preferredLocalName: 'debugLog',
    }],
    ['warn', {
        importedName: 'warn',
        preferredLocalName: 'debugWarn',
    }],
])
const rawSyntaxInspectionMethods = new Set([
    'match',
    'matchAll',
    'replace',
    'replaceAll',
    'search',
])
const syntaxSourceNames = new Set([
    'body',
    'condition',
    'formatted',
    'source',
    'text',
])

const getLineIndentation = (
    source: string,
    offset: number,
): string => {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1
    let cursor = lineStart

    while (
        source[cursor] === ' '
        || source[cursor] === '\t'
    )
        cursor++

    return source.slice(lineStart, cursor)
}

const getStatementList = node => {
    if (
        node.type !== 'BlockStatement'
        && node.type !== 'Program'
        && node.type !== 'StaticBlock'
        && node.type !== 'TSModuleBlock'
    )
        return node.type === 'SwitchCase' ? node.consequent : null

    return node.body
}

const getStatementGap = (
    sourceCode,
    previousEnd: number,
    nextStart: number,
): [number, number] | null => {
    let gapStart = previousEnd
    const commentsInGap = sourceCode.getAllComments().filter(
        comment =>
            comment.range[0] >= previousEnd
            && comment.range[1] <= nextStart,
    )

    for (const comment of commentsInGap) {
        const precedingGap = sourceCode.text.slice(gapStart, comment.range[0])

        if (!precedingGap.includes('\n')) {
            gapStart = comment.range[1]

            continue
        }

        if (precedingGap.trim().length > 0)
            return null

        return [gapStart, comment.range[0]]
    }

    if (sourceCode.text.slice(gapStart, nextStart).trim().length > 0)
        return null

    return [gapStart, nextStart]
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

const getLineCommentReplacement = (
    comment,
    sourceCode,
): string => {
    const lines = comment.value.split('\n').map(normalizeCommentLine)

    while (lines[0] === '')
        lines.shift()

    while (lines.at(-1) === '')
        lines.pop()

    if (lines.length === 0)
        lines.push('')

    const indentation = getLineIndentation(sourceCode.text, comment.range[0])
    let replacement = lines.map(line => line.length > 0 ? `// ${line}` : '//')
        .join(`\n${indentation}`)
    const nextToken = sourceCode.getTokenAfter(comment)

    if (
        nextToken
        && nextToken.loc.start.line === comment.loc.end.line
    )
        replacement = `${replacement}\n${getLineIndentation(sourceCode.text, nextToken.range[0])}`

    return replacement
}

const noBlockComments = defineRule({
    meta: {
        type: 'suggestion',
        fixable: 'code',
        messages: {
            useLineComments: 'Use // comments instead of block comments.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            Program() {
                for (const comment of sourceCode.getAllComments()) {
                    if (comment.type !== 'Block')
                        continue

                    context.report({
                        node: comment,
                        messageId: 'useLineComments',
                        fix: fixer => fixer.replaceText(
                            comment,
                            getLineCommentReplacement(comment, sourceCode),
                        ),
                    })
                }
            },
        }
    },
})

const getMemberPropertyName = (member): string | null => {
    if (
        !member.computed
        && member.property.type === 'Identifier'
    )
        return member.property.name

    if (
        member.computed
        && member.property.type === 'Literal'
        && typeof member.property.value === 'string'
    )
        return member.property.value

    return null
}

const getRootIdentifierName = (node): string | null => {
    let current = node

    while (
        current?.type === 'CallExpression'
        || current?.type === 'MemberExpression'
    ) {
        if (current.type === 'CallExpression')
            current = current.callee
        else
            current = current.object
    }

    return current?.type === 'Identifier' ? current.name : null
}

// A conditional expression may go one level deep. Nesting a second one inside the test,
// the consequent or the alternate hides the branching, and no layout rescues it.
const noNestedTernary = defineRule({
    meta: {
        type: 'suggestion',
        messages: {
            noNestedTernary: 'Nested ternary expressions are not allowed. Rewrite this as an if statement or an early return. When several groups of conditions decide the same value, use a membership test such as [...].includes(value), a lookup object keyed by the value, or a small named helper, instead of chaining ternaries.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context
        const unwrap = node => {
            let current = node

            while (
                current?.type === 'TSAsExpression'
                || current?.type === 'TSNonNullExpression'
            )
                current = current.expression

            return current
        }
        const isConditional = node => unwrap(node)?.type === 'ConditionalExpression'

        return {
            ConditionalExpression(node) {
                // Report the outer expression only, so one nested chain is one error
                // rather than one error for every level in it.
                const parent = sourceCode.getAncestors
                    ? sourceCode.getAncestors(node).at(-1)
                    : node.parent

                if (isConditional(parent))
                    return

                if (
                    !isConditional(node.test)
                    && !isConditional(node.consequent)
                    && !isConditional(node.alternate)
                )
                    return

                context.report({
                    node,
                    messageId: 'noNestedTernary',
                })
            },
        }
    },
})

const requireAstFormatterRules = defineRule({
    meta: {
        type: 'problem',
        messages: {
            requireAst: 'Quality-runner syntax rules must inspect parsed AST nodes instead of searching raw source text.',
        },
        schema: [],
    },
    create(context) {
        const report = (node): void => void context.report({
            node,
            messageId: 'requireAst',
        })

        return {
            CallExpression(node) {
                if (
                    node.callee.type === 'Identifier'
                    && node.callee.name === 'RegExp'
                ) {
                    report(node)

                    return
                }

                if (node.callee.type !== 'MemberExpression')
                    return

                const methodName = getMemberPropertyName(node.callee)

                if (!methodName)
                    return

                if (rawSyntaxInspectionMethods.has(methodName)) {
                    report(node)

                    return
                }

                if (
                    methodName !== 'endsWith'
                    && methodName !== 'startsWith'
                    && methodName !== 'includes'
                    && methodName !== 'indexOf'
                    && methodName !== 'lastIndexOf'
                    && methodName !== 'split'
                )
                    return

                const rootName = getRootIdentifierName(node.callee.object)

                if (
                    !rootName
                    || !syntaxSourceNames.has(rootName)
                )
                    return

                const separator = node.arguments[0]

                if (
                    separator?.type === 'Literal'
                    && separator.value === '\n'
                )
                    return

                report(node)
            },
            Literal(node) {
                if (node.regex)
                    report(node)
            },
            NewExpression(node) {
                if (
                    node.callee.type === 'Identifier'
                    && node.callee.name === 'RegExp'
                )
                    report(node)
            },
        }
    },
})

const countLogicalEvaluations = (node): number => {
    if (node.type === 'ParenthesizedExpression')
        return countLogicalEvaluations(node.expression)

    if (node.type !== 'LogicalExpression')
        return 1

    return countLogicalEvaluations(node.left) + countLogicalEvaluations(node.right)
}

const unwrapParenthesizedExpression = node => {
    let current = node

    while (current.type === 'ParenthesizedExpression')
        current = current.expression

    return current
}

const getAstExpressionText = (
    node,
    sourceCode,
): string => {
    if (node.type === 'ParenthesizedExpression')
        return `(${getAstExpressionText(node.expression, sourceCode)})`

    if (node.type === 'LogicalExpression')
        return `${getAstExpressionText(node.left, sourceCode)} ${node.operator} ${getAstExpressionText(node.right, sourceCode)}`

    return sourceCode.getText(node).trim()
}

const getLogicalConditionParts = (node): {
    operands: unknown[]
    operators: string[]
} | null => {
    const operands = []
    const operators: string[] = []
    const logicalExpression = unwrapParenthesizedExpression(node)

    if (
        logicalExpression.type !== 'LogicalExpression'
        || (logicalExpression.operator !== '&&' && logicalExpression.operator !== '||' && logicalExpression.operator !== '??')
    )
        return null

    const rootOperator = logicalExpression.operator

    const visit = (current): void => {
        if (
            current.type === 'LogicalExpression'
            && current.operator === rootOperator
        ) {
            visit(current.left)
            operators.push(rootOperator)
            visit(current.right)

            return
        }

        operands.push(current)
    }

    visit(logicalExpression)

    return {
        operands,
        operators,
    }
}

// The AST drops grouping parentheses, so a source pair is recognised by the tokens on
// either side of the operand and folded back into the operand's own text.
const getOperandSourceText = (
    node,
    sourceCode,
): string | null => {
    const before = sourceCode.getTokenBefore(node)
    const after = sourceCode.getTokenAfter(node)
    const parenthesized = before?.value === '(' && after?.value === ')'

    return sourceCode.text.slice(parenthesized ? before.range[0] : node.range[0], parenthesized ? after.range[1] : node.range[1]) || null
}

// `wrapInParentheses` says the caller owns a parenthesis pair around this expression:
// the parentheses an `if`, `while` or `for` requires, or a pair the source already
// wrote. The fixer never introduces one of its own, so a group that is not
// parenthesized in the source stays on a single line rather than gaining a bracket.
const getFormattedConditionText = (
    node,
    sourceCode,
    indentation,
    wrapInParentheses,
): string | null => {
    const logicalExpression = unwrapParenthesizedExpression(node)

    if (logicalExpression.type !== 'LogicalExpression')
        return getAstExpressionText(node, sourceCode)

    const conditionParts = getLogicalConditionParts(logicalExpression)

    if (!conditionParts)
        return null

    const operandIndentation = wrapInParentheses ? `${indentation}    ` : indentation
    const lines = conditionParts.operands.map(
        (operand, index) => {
            // An operand is copied out of the source exactly as it was written, on one line
            // or on several. The rule decides where the operands of a chain go, never how an
            // operand is laid out inside itself.
            const operandText = getOperandSourceText(operand, sourceCode)
            const operator = index === 0 ? '' : `${conditionParts.operators[index - 1]} `

            return operandText == null ? null : `${operandIndentation}${operator}${operandText}`
        },
    )

    if (lines.some(line => line == null))
        return null

    const condition = lines.join('\n')

    return wrapInParentheses
        ? `(\n${condition}\n${indentation})`
        : condition
}

// Walks outward from a conditional branch to its own `?` or `:` punctuator. The
// branch node's range excludes any grouping parentheses, so the punctuator is the
// only boundary a rewrite can use without deleting one half of a parenthesis pair.
const getBranchPunctuator = (
    sourceCode,
    node,
    value: string,
    forward: boolean,
) => {
    let token = forward ? sourceCode.getTokenAfter(node) : sourceCode.getTokenBefore(node)

    while (
        token
        && token.value !== value
    ) {
        if (token.value !== (forward ? ')' : '('))
            return null

        token = forward ? sourceCode.getTokenAfter(token) : sourceCode.getTokenBefore(token)
    }

    return token
}

const preferMultilineCondition = defineRule({
    meta: {
        type: 'layout',
        fixable: 'code',
        messages: {
            preferMultilineCondition: 'Split every multi-item condition and its parenthesized subgroups across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context
        const checkParenthesizedCondition = (node): void => {
            const logicalTest = unwrapParenthesizedExpression(node.test)

            if (
                logicalTest.type !== 'LogicalExpression'
                || countLogicalEvaluations(node.test) <= 1
            )
                return

            if (sourceCode.getCommentsInside(node.test).length > 0)
                return

            const openParenthesis = sourceCode.getTokenBefore(node.test)
            const closeParenthesis = sourceCode.getTokenAfter(node.test)

            if (
                openParenthesis?.value !== '('
                || closeParenthesis?.value !== ')'
            )
                return

            const indentation = getLineIndentation(sourceCode.text, node.range[0])
            const operandIndentation = `${indentation}    `
            let directBody = null

            if (node.type === 'IfStatement')
                directBody = node.consequent
            else if (node.type === 'WhileStatement')
                directBody = node.body

            const ownsCompactBodyBoundary = Boolean(
                directBody
                && directBody.type !== 'BlockStatement'
                && compactIfStatementTypes.has(directBody.type)
                && !sourceCode.getAllComments().some(
                    comment =>
                        comment.range[0] >= closeParenthesis.range[1]
                        && comment.range[1] <= directBody.range[0],
                ),
            )
            const replacementRange = [
                openParenthesis.range[0],
                ownsCompactBodyBoundary ? directBody.range[0] : closeParenthesis.range[1],
            ]
            const condition = getFormattedConditionText(
                node.test,
                sourceCode,
                operandIndentation,
                false,
            )

            if (!condition)
                return

            const bodyBoundary = ownsCompactBodyBoundary ? `\n${operandIndentation}` : ''
            const replacement = `(\n${condition}\n${indentation})${bodyBoundary}`

            if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                return

            context.report({
                node: node.test,
                messageId: 'preferMultilineCondition',
                fix: fixer => fixer.replaceTextRange(replacementRange, replacement),
            })
        }

        return {
            ConditionalExpression(node) {
                const logicalTest = unwrapParenthesizedExpression(node.test)

                if (
                    logicalTest.type !== 'LogicalExpression'
                    || countLogicalEvaluations(node.test) <= 1
                )
                    return

                if (sourceCode.getAllComments().some(
                    comment =>
                        comment.range[0] >= node.test.range[0]
                        && comment.range[1] <= node.alternate.range[0],
                ))
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const openParenthesis = sourceCode.getTokenBefore(node.test)
                const ownsOpenParenthesis = Boolean(
                    openParenthesis
                    && openParenthesis.value === '('
                    && openParenthesis.range[0] >= node.range[0],
                )
                // Only a test the source parenthesized keeps a bracket. Every other test
                // leaves its first operand on the line it already sits on.
                const condition = ownsOpenParenthesis
                    ? getFormattedConditionText(
                        node.test,
                        sourceCode,
                        indentation,
                        true,
                    )
                    : getFormattedConditionText(
                        node.test,
                        sourceCode,
                        `${indentation}    `,
                        false,
                    )?.trimStart()

                if (!condition)
                    return

                const conditionStart = ownsOpenParenthesis ? openParenthesis.range[0] : node.test.range[0]
                const questionToken = getBranchPunctuator(
                    sourceCode,
                    node.test,
                    '?',
                    true,
                )
                const colonToken = getBranchPunctuator(
                    sourceCode,
                    node.alternate,
                    ':',
                    false,
                )

                if (
                    !questionToken
                    || !colonToken
                )
                    return

                const branchIndentation = `${indentation}    `
                const conditionRange = [conditionStart, sourceCode.getTokenAfter(questionToken).range[0]]
                const conditionReplacement = `${condition}\n${branchIndentation}? `
                const alternateRange = [
                    sourceCode.getTokenBefore(colonToken).range[1],
                    sourceCode.getTokenAfter(colonToken).range[0],
                ]
                const alternateReplacement = `\n${branchIndentation}: `

                if (
                    sourceCode.text.slice(conditionRange[0], conditionRange[1]) === conditionReplacement
                    && sourceCode.text.slice(alternateRange[0], alternateRange[1]) === alternateReplacement
                )
                    return

                context.report({
                    node: node.test,
                    messageId: 'preferMultilineCondition',
                    fix: fixer => [
                        fixer.replaceTextRange(conditionRange, conditionReplacement),
                        fixer.replaceTextRange(alternateRange, alternateReplacement),
                    ],
                })
            },
            DoWhileStatement: checkParenthesizedCondition,
            ForStatement(node) {
                if (
                    !node.test
                    || countLogicalEvaluations(node.test) <= 1
                )
                    return

                if (sourceCode.getCommentsInside(node).length > 0)
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const clauseIndentation = `${indentation}    `
                const condition = getFormattedConditionText(
                    node.test,
                    sourceCode,
                    clauseIndentation,
                    false,
                )

                if (!condition)
                    return

                const initializer = node.init ? sourceCode.getText(node.init).trim() : ''
                const update = node.update ? sourceCode.getText(node.update).trim() : ''
                const clauses = [
                    'for (',
                    `${clauseIndentation}${initializer};`,
                    `${condition};`,
                ]

                if (update)
                    clauses.push(`${clauseIndentation}${update}`)

                clauses.push(`${indentation})${node.body.type === 'BlockStatement' ? ' ' : `\n${clauseIndentation}`}`)
                const replacement = clauses.join('\n')
                const replacementRange = [node.range[0], node.body.range[0]]

                if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                    return

                context.report({
                    node: node.test,
                    messageId: 'preferMultilineCondition',
                    fix: fixer => fixer.replaceTextRange(replacementRange, replacement),
                })
            },
            IfStatement: checkParenthesizedCondition,
            WhileStatement: checkParenthesizedCondition,
        }
    },
})

const getSeparatedVariableDeclarationText = (
    node,
    sourceCode,
): string => {
    const indentation = getLineIndentation(sourceCode.text, node.range[0])
    const comments = sourceCode.getCommentsInside(node)
    const declarationLines: string[] = []
    const exportPrefix = node.parent?.type === 'ExportNamedDeclaration' ? 'export ' : ''
    const declarePrefix = node.declare ? 'declare ' : ''

    for (let index = 0; index < node.declarations.length; index++) {
        const declaration = node.declarations[index]
        const previousDeclaration = node.declarations[index - 1]
        const nextDeclaration = node.declarations[index + 1]
        const leadingBoundary = previousDeclaration?.range[1]
            ?? node.range[0]
        const trailingBoundary = nextDeclaration?.range[0]
            ?? node.range[1]
        const leadingComments = comments.filter(
            comment =>
                comment.range[0] >= leadingBoundary
                && comment.range[1] <= declaration.range[0]
                && comment.loc.start.line !== previousDeclaration?.loc.end.line,
        )
        const trailingComments = comments.filter(
            comment =>
                comment.range[0] >= declaration.range[1]
                && comment.range[1] <= trailingBoundary
                && comment.loc.start.line === declaration.loc.end.line,
        )

        for (const comment of leadingComments)
            declarationLines.push(
                sourceCode.getText(comment),
            )

        const trailingText = trailingComments.length > 0
            ? ` ${trailingComments.map(comment => sourceCode.getText(comment)).join(' ')}`
            : ''
        declarationLines.push(`${exportPrefix}${declarePrefix}${node.kind} ${sourceCode.getText(declaration)}${trailingText}`)
    }

    return declarationLines.join(`\n${indentation}`)
}

const noCommaSeparatedStatements = defineRule({
    meta: {
        type: 'suggestion',
        fixable: 'code',
        messages: {
            separateDeclarations: 'Declare each variable in a separate statement.',
            separateExpressions: 'Write each comma-separated expression as a separate statement.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            VariableDeclaration(node) {
                if (node.declarations.length <= 1)
                    return

                const parentType = node.parent?.type
                const canFix = (
                    parentType === 'BlockStatement'
                    || parentType === 'ExportNamedDeclaration'
                    || parentType === 'Program'
                    || parentType === 'StaticBlock'
                    || parentType === 'SwitchCase'
                )
                const replacementNode = parentType === 'ExportNamedDeclaration' ? node.parent : node

                context.report({
                    node,
                    messageId: 'separateDeclarations',
                    fix: canFix
                        ? fixer => fixer.replaceText(
                            replacementNode,
                            getSeparatedVariableDeclarationText(node, sourceCode),
                        )
                        : undefined,
                })
            },
            SequenceExpression(node) {
                if (node.parent?.type === 'SequenceExpression')
                    return

                const parent = node.parent
                const canFix = (
                    parent?.type === 'ExpressionStatement'
                    && sourceCode.getCommentsInside(node).length === 0
                )
                const indentation = canFix ? getLineIndentation(sourceCode.text, parent.range[0]) : ''

                context.report({
                    node,
                    messageId: 'separateExpressions',
                    fix: canFix
                        ? fixer =>
                            fixer.replaceText(
                                parent,
                                node.expressions.map(expression => sourceCode.getText(expression)).join(`\n${indentation}`),
                            )
                        : undefined,
                })
            },
        }
    },
})

const preferAttachedTrailingComma = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            attachTrailingComma: 'Keep a trailing comma on the same line as the preceding syntax node.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        const checkLastItem = (
            container,
            items,
        ): void => {
            const lastItem = items.at(-1)

            if (!lastItem)
                return

            const comma = sourceCode.getTokenAfter(lastItem)
            const closeToken = sourceCode.getLastToken(container)

            if (
                comma?.value !== ','
                || !closeToken
                || comma.range[0] >= closeToken.range[0]
                || comma.loc.start.line === lastItem.loc.end.line
                || sourceCode.getCommentsInside(container).some(
                    comment =>
                        comment.range[0] >= lastItem.range[1]
                        && comment.range[1] <= comma.range[0],
                )
            )
                return

            context.report({
                node: comma,
                messageId: 'attachTrailingComma',
                fix: fixer => fixer.replaceTextRange([lastItem.range[1], comma.range[1]], ','),
            })
        }

        return {
            ArrayExpression: node => checkLastItem(node, node.elements),
            ArrayPattern: node => checkLastItem(node, node.elements),
            CallExpression: node => checkLastItem(node, node.arguments),
            ImportExpression: node => checkLastItem(node, node.options ? [node.options] : []),
            NewExpression: node => checkLastItem(node, node.arguments),
            ObjectExpression: node => checkLastItem(node, node.properties),
            ObjectPattern: node => checkLastItem(node, node.properties),
        }
    },
})

// An object literal holding more than one property reads as a list, and a list goes one
// item to a line, the same way a named import list does.
const preferMultilineObject = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            preferMultilineObject: 'Split object literals with more than one property across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            ObjectExpression(node) {
                if (node.properties.length <= 1)
                    return

                if (sourceCode.getCommentsInside(node).length > 0)
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const propertyIndentation = `${indentation}    `
                const replacement = `{\n${node.properties.map(property => `${propertyIndentation}${sourceCode.getText(property)},`).join('\n')}\n${indentation}}`

                if (sourceCode.getText(node) === replacement)
                    return

                context.report({
                    node,
                    messageId: 'preferMultilineObject',
                    fix: fixer => fixer.replaceText(node, replacement),
                })
            },
        }
    },
})

const preferMultilineObjectPattern = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            preferMultilinePattern: 'Split object destructuring with more than one element across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            ObjectPattern(node) {
                if (node.properties.length <= 1)
                    return

                if (sourceCode.getCommentsInside(node).length > 0)
                    return

                const patternEnd = (
                    node.typeAnnotation?.range[0]
                    ?? node.range[1]
                )
                const patternTokens = sourceCode.getTokens(node).filter(token => token.range[1] <= patternEnd)
                const openBrace = patternTokens.find(token => token.value === '{')
                const closeBrace = patternTokens.findLast(token => token.value === '}')

                if (
                    !openBrace
                    || !closeBrace
                )
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const propertyIndentation = `${indentation}    `
                const replacement = `{\n${node.properties.map(
                    property => `${propertyIndentation}${sourceCode.getText(property)}${property.type === 'RestElement' ? '' : ','}`,
                ).join('\n')}\n${indentation}}`
                const replacementRange = [openBrace.range[0], closeBrace.range[1]]

                if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                    return

                context.report({
                    node,
                    messageId: 'preferMultilinePattern',
                    fix: fixer => fixer.replaceTextRange(replacementRange, replacement),
                })
            },
        }
    },
})

const preferMultilineTypeLiteral = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            preferMultilineTypeLiteral: 'Split type literals with more than one member across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            TSTypeLiteral(node) {
                if (node.members.length <= 1)
                    return

                if (sourceCode.getCommentsInside(node).length > 0)
                    return

                const openBrace = sourceCode.getFirstToken(node)
                const closeBrace = sourceCode.getLastToken(node)

                if (
                    openBrace?.value !== '{'
                    || closeBrace?.value !== '}'
                )
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const memberIndentation = `${indentation}    `
                const replacement = `{\n${node.members.map(
                    member => {
                        const lastToken = sourceCode.getLastToken(member)
                        const memberEnd = (
                            lastToken?.value === ';'
                            || lastToken?.value === ','
                        )
                            ? lastToken.range[0]
                            : member.range[1]

                        return `${memberIndentation}${sourceCode.text.slice(member.range[0], memberEnd)}`
                    },
                ).join('\n')}\n${indentation}}`

                if (sourceCode.getText(node) === replacement)
                    return

                context.report({
                    node,
                    messageId: 'preferMultilineTypeLiteral',
                    fix: fixer => fixer.replaceText(node, replacement),
                })
            },
        }
    },
})

const preferMultilineCollection = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            preferMultilineCollection: 'Split collection initializers with more than one element across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            NewExpression(node) {
                if (
                    node.callee.type !== 'Identifier'
                    || !collectionConstructorNames.has(node.callee.name)
                )
                    return

                const values = node.arguments[0]

                if (
                    !values
                    || values.type !== 'ArrayExpression'
                    || values.elements.length <= 1
                    || values.elements.some(element => element == null)
                )
                    return

                if (sourceCode.getCommentsInside(values).length > 0)
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const valueIndentation = `${indentation}    `
                const replacement = `[\n${values.elements.map(element => `${valueIndentation}${sourceCode.getText(element)},`).join('\n')}\n${indentation}]`

                if (sourceCode.getText(values) === replacement)
                    return

                context.report({
                    node: values,
                    messageId: 'preferMultilineCollection',
                    fix: fixer => fixer.replaceText(values, replacement),
                })
            },
        }
    },
})

const isNestedCallChain = (node): boolean =>
    node.parent?.type === 'MemberExpression' && node.parent.object === node && node.parent.parent?.type === 'CallExpression' && node.parent.parent.callee === node.parent

const getCallChain = (
    node,
    sourceCode,
): {
    attrCount: number
    base: unknown
    segments: string[]
} => {
    const segments: string[] = []
    let attrCount = 0
    let current = node

    while (
        current.type === 'CallExpression'
        && current.callee.type === 'MemberExpression'
        && !current.callee.computed
        && current.callee.property.type === 'Identifier'
    ) {
        if (current.callee.property.name === 'attr')
            attrCount++

        segments.unshift(
            sourceCode.text.slice(current.callee.object.range[1], current.range[1]).trim(),
        )
        current = current.callee.object
    }

    return {
        attrCount,
        base: current,
        segments,
    }
}

const preferMultilineAttrChain = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            preferMultilineChain: 'Split chained SVG attributes across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            CallExpression(node) {
                if (isNestedCallChain(node))
                    return

                const chain = getCallChain(node, sourceCode)

                if (
                    chain.attrCount <= 1
                    || chain.segments.length === 0
                )
                    return

                if (sourceCode.getCommentsInside(node).length > 0)
                    return

                const parent = node.parent
                const isOnlyCallArgument = (
                    parent?.type === 'CallExpression'
                    && parent.arguments.length === 1
                    && parent.arguments[0] === node
                )
                const indentation = getLineIndentation(sourceCode.text, isOnlyCallArgument ? parent.range[0] : node.range[0])
                const baseText = sourceCode.getText(chain.base)
                const chainIndentation = `${indentation}${isOnlyCallArgument ? '        ' : '    '}`
                const canonicalChain = `${baseText}\n${chain.segments.map(segment => `${chainIndentation}${segment}`).join('\n')}`
                let replacement = canonicalChain
                let replacementRange = node.range

                if (isOnlyCallArgument) {
                    const parentTokens = sourceCode.getTokens(parent)
                    const openParenthesis = parentTokens.find(token => token.value === '(' && token.range[0] < node.range[0])
                    const closeParenthesis = parentTokens.findLast(token => token.value === ')' && token.range[1] > node.range[1])

                    if (
                        !openParenthesis
                        || !closeParenthesis
                    )
                        return

                    replacement = `\n${indentation}    ${canonicalChain},\n${indentation}`
                    replacementRange = [openParenthesis.range[1], closeParenthesis.range[0]]
                }

                if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                    return

                context.report({
                    node,
                    messageId: 'preferMultilineChain',
                    fix: fixer => fixer.replaceTextRange(replacementRange, replacement),
                })
            },
        }
    },
})

const preferCompactIf = defineRule({
    meta: {
        type: 'suggestion',
        fixable: 'code',
        messages: {
            preferCompactBody: 'Use the simple statement directly as the if body.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            IfStatement(node) {
                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const bodyIndentation = `${indentation}    `
                const conditionRuleOwnsConsequentBoundary = (
                    unwrapParenthesizedExpression(node.test).type === 'LogicalExpression'
                    && countLogicalEvaluations(node.test) > 1
                    && sourceCode.getCommentsInside(node.test).length === 0
                )
                const blocks = [node.consequent, node.alternate].filter(statement => statement?.type === 'BlockStatement')

                for (const block of blocks) {
                    if (
                        block.type !== 'BlockStatement'
                        || block.body.length !== 1
                    )
                        continue

                    const statement = block.body[0]

                    if (!compactIfStatementTypes.has(statement.type))
                        continue

                    if (sourceCode.getText(statement).includes('\n'))
                        continue

                    if (sourceCode.getCommentsInside(block).length > 0)
                        continue

                    context.report({
                        node: block,
                        messageId: 'preferCompactBody',
                        fix: fixer =>
                            fixer.replaceText(
                                block,
                                `\n${bodyIndentation}${sourceCode.getText(statement)}${(
                                    block === node.consequent
                                    && node.alternate
                                )
                                    ? `\n${indentation}`
                                    : ''}`,
                            ),
                    })
                }

                const directStatements = [node.consequent, node.alternate].filter(
                    statement => statement && statement.type !== 'BlockStatement' && compactIfStatementTypes.has(statement.type),
                )

                for (const statement of directStatements) {
                    if (
                        statement === node.consequent
                        && conditionRuleOwnsConsequentBoundary
                    )
                        continue

                    const precedingToken = sourceCode.getTokenBefore(statement)

                    if (!precedingToken)
                        continue

                    const whitespaceRange = [precedingToken.range[1], statement.range[0]]
                    const whitespace = sourceCode.text.slice(whitespaceRange[0], whitespaceRange[1])
                    const replacement = `\n${bodyIndentation}`

                    if (
                        whitespace === replacement
                        || whitespace.trim().length > 0
                    )
                        continue

                    context.report({
                        node: statement,
                        messageId: 'preferCompactBody',
                        fix: fixer => fixer.replaceTextRange(whitespaceRange, replacement),
                    })
                }
            },
        }
    },
})

const preferSeparatedStatements = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            joinCases: 'Keep adjacent switch cases together without a blank line.',
            separateStatements: 'Separate grouped statements from adjacent siblings with one blank line.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context
        const reportSiblingGap = (
            previous,
            current,
            blankLine: boolean,
            messageId: string,
        ): void => {
            const gap = getStatementGap(
                sourceCode,
                previous.range[1],
                current.range[0],
            )

            if (!gap)
                return

            let replacementRange = gap
            let lineBreaks = blankLine ? '\n\n' : '\n'

            if (
                blankLine
                && sourceCode.text[gap[0]] === '\n'
            ) {
                replacementRange = [gap[0] + 1, gap[1]]
                lineBreaks = '\n'
            } else if (
                blankLine
                && sourceCode.text[gap[0]] === '\r'
                && sourceCode.text[gap[0] + 1] === '\n'
            ) {
                replacementRange = [gap[0] + 2, gap[1]]
                lineBreaks = '\r\n'
            }

            const replacement = `${lineBreaks}${getLineIndentation(sourceCode.text, gap[1])}`

            if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                return

            context.report({
                node: current,
                messageId,
                fix: fixer => fixer.replaceTextRange(replacementRange, replacement),
            })
        }
        const checkStatementList = (node): void => {
            const statements = getStatementList(node)

            if (!statements)
                return

            for (let index = 1; index < statements.length; index++) {
                const previous = statements[index - 1]
                const current = statements[index]

                if (
                    !isSeparatedStatementType(previous.type)
                    && !isSeparatedStatementType(current.type)
                )
                    continue

                reportSiblingGap(
                    previous,
                    current,
                    true,
                    'separateStatements',
                )
            }
        }
        const checkSwitchCases = (node): void => {
            for (let index = 1; index < node.cases.length; index++)
                reportSiblingGap(
                    node.cases[index - 1],
                    node.cases[index],
                    false,
                    'joinCases',
                )
        }

        return {
            BlockStatement: checkStatementList,
            Program: checkStatementList,
            StaticBlock: checkStatementList,
            SwitchCase: checkStatementList,
            SwitchStatement: checkSwitchCases,
            TSModuleBlock: checkStatementList,
        }
    },
})

const directVoidExpressionTypes = new Set([
    'CallExpression',
    'NewExpression',
    'TaggedTemplateExpression',
])

const getVoidExpressionText = (
    expressionNode,
    sourceCode,
): string => {
    const expression = sourceCode.getText(expressionNode)

    if (
        expressionNode.type === 'UnaryExpression'
        && expressionNode.operator === 'void'
    )
        return expression

    return directVoidExpressionTypes.has(expressionNode.type)
        ? `void ${expression}`
        : `void (${expression})`
}

const getConciseArrowBodyText = (
    statement,
    sourceCode,
): string => {
    const isExpressionStatement = statement.type === 'ExpressionStatement'
    const expressionNode = isExpressionStatement ? statement.expression : statement.argument
    const expression = sourceCode.getText(expressionNode)

    if (isExpressionStatement)
        return getVoidExpressionText(expressionNode, sourceCode)

    return expressionNode.type === 'ObjectExpression' ? `(${expression})` : expression
}

const isWindowOpenCall = (node): boolean => node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.object.type === 'Identifier'
    && node.callee.object.name === 'window'
    && node.callee.property.type === 'Identifier'
    && node.callee.property.name === 'open'

const preferVoidArrowBody = defineRule({
    meta: {
        type: 'problem',
        fixable: 'code',
        messages: {
            discardReturnValue: 'Discard the expression value so this arrow function still returns undefined.',
        },
        schema: [],
    },
    create(context) {
        return {
            ArrowFunctionExpression(node) {
                if (node.body.type === 'BlockStatement')
                    return

                if (
                    node.body.type === 'UnaryExpression'
                    && node.body.operator === 'void'
                )
                    return

                const hasVoidReturnType = node.returnType?.typeAnnotation?.type === 'TSVoidKeyword'
                const isEffectOnlyExpression = (
                    node.body.type === 'AssignmentExpression'
                    || node.body.type === 'UpdateExpression'
                    || isWindowOpenCall(node.body)
                )

                if (
                    !hasVoidReturnType
                    && !isEffectOnlyExpression
                )
                    return

                context.report({
                    node: node.body,
                    messageId: 'discardReturnValue',
                    fix: fixer => directVoidExpressionTypes.has(node.body.type)
                        ? fixer.insertTextBefore(node.body, 'void ')
                        : [
                            fixer.insertTextBefore(node.body, 'void ('),
                            fixer.insertTextAfter(node.body, ')'),
                        ],
                })
            },
        }
    },
})

const preferExpressionArrowBody = defineRule({
    meta: {
        type: 'suggestion',
        fixable: 'code',
        messages: {
            preferExpressionBody: 'Use the expression directly as the arrow function body.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            ArrowFunctionExpression(node) {
                if (
                    node.body.type !== 'BlockStatement'
                    || node.body.body.length !== 1
                )
                    return

                const statement = node.body.body[0]
                const isExpressionStatement = (
                    statement.type === 'ExpressionStatement'
                    && statement.directive == null
                )
                const isReturningExpression = (
                    statement.type === 'ReturnStatement'
                    && statement.argument != null
                )

                if (
                    !isExpressionStatement
                    && !isReturningExpression
                )
                    return

                if (sourceCode.getText(statement).includes('\n'))
                    return

                if (sourceCode.getCommentsInside(node.body).length > 0)
                    return

                context.report({
                    node: node.body,
                    messageId: 'preferExpressionBody',
                    fix: fixer => fixer.replaceText(
                        node.body,
                        getConciseArrowBodyText(statement, sourceCode),
                    ),
                })
            },
        }
    },
})

const noNativeConsoleLogging = defineRule({
    meta: {
        type: 'problem',
        fixable: 'code',
        messages: {
            useDebugTools: "Use '@lixpi/debug-tools' instead of native console logging.",
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context
        const consoleCalls = []

        return {
            CallExpression(node) {
                if (
                    node.callee.type !== 'MemberExpression'
                    || node.callee.computed
                    || node.callee.object.type !== 'Identifier'
                    || node.callee.object.name !== 'console'
                    || node.callee.property.type !== 'Identifier'
                    || !debugLoggingMethods.has(node.callee.property.name)
                )
                    return

                consoleCalls.push({
                    member: node.callee,
                    methodName: node.callee.property.name,
                })
            },
            'Program:exit'(program) {
                if (consoleCalls.length === 0)
                    return

                const debugImport = program.body.find(node => node.type === 'ImportDeclaration' && node.source.value === '@lixpi/debug-tools')
                const localNames = new Set(
                    context.sourceCode.scopeManager.scopes.flatMap(scope => scope.variables.map(variable => variable.name)),
                )
                const methodLocalNames = new Map()

                if (debugImport) {
                    for (const specifier of debugImport.specifiers) {
                        if (
                            specifier.type !== 'ImportSpecifier'
                            || specifier.imported.type !== 'Identifier'
                        )
                            continue

                        if (!debugLoggingMethods.has(specifier.imported.name))
                            continue

                        methodLocalNames.set(specifier.imported.name, specifier.local.name)
                    }
                }

                const usedMethods = [...new Set(
                    consoleCalls.map(({ methodName }) => methodName),
                )]
                const addedSpecifiers = []

                for (const methodName of usedMethods) {
                    const config = debugLoggingMethods.get(methodName)

                    if (methodLocalNames.has(config.importedName))
                        continue

                    let localName = config.preferredLocalName
                    let suffix = 2

                    while (localNames.has(localName)) {
                        localName = `${config.preferredLocalName}${suffix}`
                        suffix++
                    }

                    localNames.add(localName)
                    methodLocalNames.set(config.importedName, localName)
                    addedSpecifiers.push(`${config.importedName} as ${localName}`)
                }

                context.report({
                    node: consoleCalls[0].member,
                    messageId: 'useDebugTools',
                    fix: fixer => {
                        const fixes = consoleCalls.map(
                            ({
                                member,
                                methodName,
                            }) => {
                                const importedName = debugLoggingMethods.get(methodName).importedName

                                return fixer.replaceText(
                                    member,
                                    methodLocalNames.get(importedName),
                                )
                            },
                        )

                        if (addedSpecifiers.length === 0)
                            return fixes

                        if (
                            debugImport
                            && debugImport.specifiers.every(specifier => specifier.type === 'ImportSpecifier')
                        ) {
                            const closeBrace = sourceCode.getTokens(debugImport).findLast(token => token.value === '}')

                            if (closeBrace) {
                                const importText = sourceCode.getText(debugImport)
                                const insertion = importText.includes('\n')
                                    ? `${getLineIndentation(sourceCode.text, closeBrace.range[0])}    ${addedSpecifiers.join(
                                        `,\n${getLineIndentation(sourceCode.text, closeBrace.range[0])}    `,
                                    )},\n`
                                    : `, ${addedSpecifiers.join(', ')}`
                                fixes.push(
                                    fixer.insertTextBefore(closeBrace, insertion),
                                )

                                return fixes
                            }
                        }

                        const declaration = `import { ${addedSpecifiers.join(', ')} } from '@lixpi/debug-tools'\n`
                        const firstStatement = program.body[0]
                        fixes.push(firstStatement ? fixer.insertTextBefore(firstStatement, declaration) : fixer.insertTextAfter(program, declaration))

                        return fixes
                    },
                })
            },
        }
    },
})

export default definePlugin({
    meta: {
        name: 'lixpi',
    },
    rules: {
        'no-block-comments': noBlockComments,
        'no-native-console-logging': noNativeConsoleLogging,
        'no-comma-separated-statements': noCommaSeparatedStatements,
        'no-unused-imports': noUnusedImports,
        'prefer-attached-trailing-comma': preferAttachedTrailingComma,
        'prefer-arrow-function-declaration': preferArrowFunctionDeclaration,
        'prefer-compact-if': preferCompactIf,
        'prefer-expression-arrow-body': preferExpressionArrowBody,
        'prefer-void-arrow-body': preferVoidArrowBody,
        'prefer-multiline-attr-chain': preferMultilineAttrChain,
        'prefer-multiline-collection': preferMultilineCollection,
        'prefer-multiline-object-pattern': preferMultilineObjectPattern,
        'prefer-multiline-object': preferMultilineObject,
        'prefer-separated-statements': preferSeparatedStatements,
        'prefer-multiline-type-literal': preferMultilineTypeLiteral,
        'prefer-multiline-condition': preferMultilineCondition,
        'no-nested-ternary': noNestedTernary,
        'require-ast-formatter-rules': requireAstFormatterRules,
    },
})
