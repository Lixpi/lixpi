import {
    definePlugin,
    defineRule,
} from '@oxlint/plugins'

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

        return {
            'Program:exit'() {
                const unusedSpecifiersByDeclaration = new Map()

                for (const scope of context.sourceCode.scopeManager.scopes)
                    for (const variable of scope.variables) {
                        if (variable.references.length > 0)
                            continue

                        const importDefinition = variable.defs.find(definition => definition.type === 'ImportBinding')
                        if (!importDefinition)
                            continue

                        const specifier = importDefinition.name.parent
                        const declaration = specifier?.parent
                        if (!specifier || declaration?.type !== 'ImportDeclaration')
                            continue

                        const unusedSpecifiers = unusedSpecifiersByDeclaration.get(declaration) ?? []
                        unusedSpecifiers.push({ name: variable.name, specifier })
                        unusedSpecifiersByDeclaration.set(declaration, unusedSpecifiers)
                    }

                for (const [declaration, unusedSpecifiers] of unusedSpecifiersByDeclaration) {
                    const unusedNodes = new Set(unusedSpecifiers.map(({ specifier }) => specifier))
                    const remainingSpecifiers = declaration.specifiers.filter((specifier) => !unusedNodes.has(specifier))
                    const names = unusedSpecifiers.map(({ name }) => name).join(', ')

                    context.report({
                        node: unusedSpecifiers[0].specifier,
                        messageId: 'unusedImport',
                        data: { name: names },
                        fix: (fixer) => {
                            if (remainingSpecifiers.length === 0)
                                return fixer.remove(declaration)

                            const defaultSpecifier = remainingSpecifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier')
                            const namespaceSpecifier = remainingSpecifiers.find((specifier) => specifier.type === 'ImportNamespaceSpecifier')
                            const namedSpecifiers = remainingSpecifiers.filter((specifier) => specifier.type === 'ImportSpecifier')
                            const clauseParts: string[] = []

                            if (defaultSpecifier)
                                clauseParts.push(sourceCode.getText(defaultSpecifier))
                            if (namespaceSpecifier)
                                clauseParts.push(sourceCode.getText(namespaceSpecifier))
                            if (namedSpecifiers.length > 0)
                                clauseParts.push(`{ ${namedSpecifiers.map((specifier) => sourceCode.getText(specifier)).join(', ')} }`)

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
                )
                    return

                if (sourceCode.getCommentsInside(node).some((comment) => comment.range[1] <= node.id.range[1]))
                    return

                const replacement = `const ${node.id.name} = ${node.async ? 'async ' : ''}`

                context.report({
                    node,
                    messageId: 'preferArrowFunction',
                    fix: (fixer) => [
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
const collectionConstructorNames = new Set([
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
])
const debugLoggingMethods = new Map([
    ['error', { importedName: 'err', preferredLocalName: 'debugError' }],
    ['info', { importedName: 'info', preferredLocalName: 'debugInfo' }],
    ['log', { importedName: 'log', preferredLocalName: 'debugLog' }],
    ['warn', { importedName: 'warn', preferredLocalName: 'debugWarn' }],
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

const getLineIndentation = (source: string, offset: number): string => {
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1
    let cursor = lineStart
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor++
    return source.slice(lineStart, cursor)
}

const getMemberPropertyName = (member): string | null => {
    if (!member.computed && member.property.type === 'Identifier')
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
    while (current?.type === 'CallExpression' || current?.type === 'MemberExpression') {
        if (current.type === 'CallExpression')
            current = current.callee
        else
            current = current.object
    }
    return current?.type === 'Identifier' ? current.name : null
}

const requireAstFormatterRules = defineRule({
    meta: {
        type: 'problem',
        messages: {
            requireAst: 'Formatter rules must inspect TypeScript syntax through the parsed AST.',
        },
        schema: [],
    },
    create(context) {
        const report = (node): void => context.report({
            node,
            messageId: 'requireAst',
        })

        return {
            CallExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp') {
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
                if (!rootName || !syntaxSourceNames.has(rootName))
                    return
                const separator = node.arguments[0]
                if (separator?.type === 'Literal' && separator.value === '\n')
                    return
                report(node)
            },
            Literal(node) {
                if (node.regex)
                    report(node)
            },
            NewExpression(node) {
                if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp')
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

const unwrapParenthesizedExpression = (node) => {
    let current = node
    while (current.type === 'ParenthesizedExpression') current = current.expression
    return current
}

const getAstExpressionText = (node, sourceCode): string => {
    if (node.type === 'ParenthesizedExpression')
        return `(${getAstExpressionText(node.expression, sourceCode)})`
    if (node.type === 'LogicalExpression')
        return `${getAstExpressionText(node.left, sourceCode)} ${node.operator} ${getAstExpressionText(node.right, sourceCode)}`
    return sourceCode.getText(node).trim()
}

const getLogicalConditionParts = (node, sourceCode): { operands: string[]; operators: string[] } | null => {
    const operands: string[] = []
    const operators: string[] = []
    const logicalExpression = unwrapParenthesizedExpression(node)
    if (
        logicalExpression.type !== 'LogicalExpression'
        || (logicalExpression.operator !== '&&' && logicalExpression.operator !== '||' && logicalExpression.operator !== '??')
    )
        return null
    const rootOperator = logicalExpression.operator

    const visit = (current): void => {
        if (current.type === 'LogicalExpression' && current.operator === rootOperator) {
            visit(current.left)
            operators.push(rootOperator)
            visit(current.right)
            return
        }

        const operand = getAstExpressionText(current, sourceCode)
        operands.push(current.type === 'LogicalExpression' ? `(${operand})` : operand)
    }

    visit(logicalExpression)
    return { operands, operators }
}

const preferMultilineIfCondition = defineRule({
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        messages: {
            preferMultilineCondition: 'Split an if condition with more than two evaluations across lines.',
        },
        schema: [],
    },
    create(context) {
        const { sourceCode } = context

        return {
            IfStatement(node) {
                const logicalTest = unwrapParenthesizedExpression(node.test)
                if (logicalTest.type !== 'LogicalExpression' || countLogicalEvaluations(node.test) <= 2)
                    return
                if (sourceCode.getCommentsInside(node.test).length > 0)
                    return

                const openParenthesis = sourceCode.getTokenBefore(node.test)
                const closeParenthesis = sourceCode.getTokenAfter(node.test)
                if (openParenthesis?.value !== '(' || closeParenthesis?.value !== ')')
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const operandIndentation = `${indentation}    `
                const replacementRange = [openParenthesis.range[0], closeParenthesis.range[1]]
                const conditionParts = getLogicalConditionParts(node.test, sourceCode)
                if (!conditionParts)
                    return
                const replacement = `(\n${conditionParts.operands.map((operand, index) =>
                    `${operandIndentation}${index === 0 ? '' : `${conditionParts.operators[index - 1]} `}${operand}`).join('\n')}\n${indentation})`
                if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                    return

                context.report({
                    node: node.test,
                    messageId: 'preferMultilineCondition',
                    fix: (fixer) => fixer.replaceTextRange(replacementRange, replacement),
                })
            },
        }
    },
})

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
                const canFix = parentType === 'BlockStatement'
                    || parentType === 'ExportNamedDeclaration'
                    || parentType === 'Program'
                    || parentType === 'StaticBlock'
                    || parentType === 'SwitchCase'
                const indentation = getLineIndentation(sourceCode.text, node.range[0])

                context.report({
                    node,
                    messageId: 'separateDeclarations',
                    fix: canFix && sourceCode.getCommentsInside(node).length === 0
                        ? (fixer) =>
                            fixer.replaceText(node, node.declarations.map((declaration) => `${node.kind} ${sourceCode.getText(declaration)}`).join(`\n${indentation}`))
                        : undefined,
                })
            },
            SequenceExpression(node) {
                if (node.parent?.type === 'SequenceExpression')
                    return

                const parent = node.parent
                const canFix = parent?.type === 'ExpressionStatement' && sourceCode.getCommentsInside(node).length === 0
                const indentation = canFix ? getLineIndentation(sourceCode.text, parent.range[0]) : ''

                context.report({
                    node,
                    messageId: 'separateExpressions',
                    fix: canFix
                        ? (fixer) =>
                            fixer.replaceText(parent, node.expressions.map((expression) => sourceCode.getText(expression)).join(`\n${indentation}`))
                        : undefined,
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

                const openBrace = sourceCode.getTokens(node).find((token) => token.value === '{')
                const closeBrace = sourceCode.getTokens(node).findLast((token) => token.value === '}')
                if (!openBrace || !closeBrace)
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const propertyIndentation = `${indentation}    `
                const replacement = `{\n${node.properties.map((property) =>
                    `${propertyIndentation}${sourceCode.getText(property)}${property.type === 'RestElement' ? '' : ','}`).join('\n')}\n${indentation}}`
                const replacementRange = [openBrace.range[0], closeBrace.range[1]]
                if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                    return

                context.report({
                    node,
                    messageId: 'preferMultilinePattern',
                    fix: (fixer) => fixer.replaceTextRange(replacementRange, replacement),
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
                if (node.callee.type !== 'Identifier' || !collectionConstructorNames.has(node.callee.name))
                    return
                const values = node.arguments[0]
                if (
                    !values
                    || values.type !== 'ArrayExpression'
                    || values.elements.length <= 1
                    || values.elements.some((element) => element == null)
                )
                    return
                if (sourceCode.getCommentsInside(values).length > 0)
                    return

                const indentation = getLineIndentation(sourceCode.text, node.range[0])
                const valueIndentation = `${indentation}    `
                const replacement = `[\n${values.elements.map((element) => `${valueIndentation}${sourceCode.getText(element)},`).join('\n')}\n${indentation}]`
                if (sourceCode.getText(values) === replacement)
                    return

                context.report({
                    node: values,
                    messageId: 'preferMultilineCollection',
                    fix: (fixer) => fixer.replaceText(values, replacement),
                })
            },
        }
    },
})

const isNestedCallChain = (node): boolean =>
    node.parent?.type === 'MemberExpression' && node.parent.object === node && node.parent.parent?.type === 'CallExpression' && node.parent.parent.callee === node.parent

const getCallChain = (node, sourceCode): { attrCount: number; base: unknown; segments: string[] } => {
    const segments: string[] = []
    let attrCount = 0
    let current = node

    while (current.type === 'CallExpression' && current.callee.type === 'MemberExpression' && !current.callee.computed && current.callee.property.type === 'Identifier') {
        if (current.callee.property.name === 'attr')
            attrCount++
        segments.unshift(sourceCode.text.slice(current.callee.object.range[1], current.range[1]).trim())
        current = current.callee.object
    }

    return { attrCount, base: current, segments }
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
                if (chain.attrCount <= 1 || chain.segments.length === 0)
                    return
                if (sourceCode.getCommentsInside(node).length > 0)
                    return

                const parent = node.parent
                const isOnlyCallArgument = parent?.type === 'CallExpression' && parent.arguments.length === 1 && parent.arguments[0] === node
                const indentation = getLineIndentation(sourceCode.text, isOnlyCallArgument ? parent.range[0] : node.range[0])
                const baseText = sourceCode.getText(chain.base)
                const chainIndentation = `${indentation}${isOnlyCallArgument ? '        ' : '    '}`
                const canonicalChain = `${baseText}\n${chain.segments.map((segment) => `${chainIndentation}${segment}`).join('\n')}`
                let replacement = canonicalChain
                let replacementRange = node.range

                if (isOnlyCallArgument) {
                    const parentTokens = sourceCode.getTokens(parent)
                    const openParenthesis = parentTokens.find((token) => token.value === '(' && token.range[0] < node.range[0])
                    const closeParenthesis = parentTokens.findLast((token) => token.value === ')' && token.range[1] > node.range[1])
                    if (!openParenthesis || !closeParenthesis)
                        return

                    replacement = `\n${indentation}    ${canonicalChain},\n${indentation}`
                    replacementRange = [openParenthesis.range[1], closeParenthesis.range[0]]
                }

                if (sourceCode.text.slice(replacementRange[0], replacementRange[1]) === replacement)
                    return

                context.report({
                    node,
                    messageId: 'preferMultilineChain',
                    fix: (fixer) => fixer.replaceTextRange(replacementRange, replacement),
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
                const blocks = [node.consequent, node.alternate].filter(statement => statement?.type === 'BlockStatement')
                for (const block of blocks) {
                    if (block.type !== 'BlockStatement' || block.body.length !== 1)
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
                            fixer.replaceText(block, `\n${bodyIndentation}${sourceCode.getText(statement)}${block === node.consequent && node.alternate ? `\n${indentation}` : ''}`),
                    })
                }

                const directStatements = [node.consequent, node.alternate].filter((statement) =>
                    statement && statement.type !== 'BlockStatement' && compactIfStatementTypes.has(statement.type))
                for (const statement of directStatements) {
                    const precedingToken = sourceCode.getTokenBefore(statement)
                    if (!precedingToken)
                        continue

                    const whitespaceRange = [precedingToken.range[1], statement.range[0]]
                    const whitespace = sourceCode.text.slice(whitespaceRange[0], whitespaceRange[1])
                    const replacement = `\n${bodyIndentation}`
                    if (whitespace === replacement || whitespace.trim().length > 0)
                        continue

                    context.report({
                        node: statement,
                        messageId: 'preferCompactBody',
                        fix: (fixer) => fixer.replaceTextRange(whitespaceRange, replacement),
                    })
                }
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
                if (node.body.type !== 'BlockStatement' || node.body.body.length !== 1)
                    return

                const statement = node.body.body[0]
                if (statement.type !== 'ExpressionStatement' || statement.directive != null)
                    return
                if (sourceCode.getText(statement).includes('\n'))
                    return
                if (sourceCode.getCommentsInside(node.body).length > 0)
                    return

                context.report({
                    node: node.body,
                    messageId: 'preferExpressionBody',
                    fix: (fixer) => {
                        const expression = sourceCode.getText(statement.expression)
                        const replacement = statement.expression.type === 'ObjectExpression'
                            ? `(${expression})`
                            : expression
                        return fixer.replaceText(node.body, replacement)
                    },
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

                const debugImport = program.body.find((node) => node.type === 'ImportDeclaration' && node.source.value === '@lixpi/debug-tools')
                const localNames = new Set(context.sourceCode.scopeManager.scopes.flatMap((scope) => scope.variables.map((variable) => variable.name)))
                const methodLocalNames = new Map()

                if (debugImport) {
                    for (const specifier of debugImport.specifiers) {
                        if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier')
                            continue
                        if (!debugLoggingMethods.has(specifier.imported.name))
                            continue
                        methodLocalNames.set(specifier.imported.name, specifier.local.name)
                    }
                }

                const usedMethods = [...new Set(consoleCalls.map(({ methodName }) => methodName))]
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
                    fix: (fixer) => {
                        const fixes = consoleCalls.map(({
                            member,
                            methodName,
                        }) => {
                            const importedName = debugLoggingMethods.get(methodName).importedName
                            return fixer.replaceText(member, methodLocalNames.get(importedName))
                        })

                        if (addedSpecifiers.length === 0)
                            return fixes

                        if (debugImport && debugImport.specifiers.every((specifier) => specifier.type === 'ImportSpecifier')) {
                            const closeBrace = sourceCode.getTokens(debugImport).findLast((token) => token.value === '}')
                            if (closeBrace) {
                                const importText = sourceCode.getText(debugImport)
                                const insertion = importText.includes('\n')
                                    ? `${getLineIndentation(sourceCode.text, closeBrace.range[0])}    ${addedSpecifiers.join(`,\n${getLineIndentation(sourceCode.text, closeBrace.range[0])}    `)},\n`
                                    : `, ${addedSpecifiers.join(', ')}`
                                fixes.push(fixer.insertTextBefore(closeBrace, insertion))
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
        'no-native-console-logging': noNativeConsoleLogging,
        'no-comma-separated-statements': noCommaSeparatedStatements,
        'no-unused-imports': noUnusedImports,
        'prefer-arrow-function-declaration': preferArrowFunctionDeclaration,
        'prefer-compact-if': preferCompactIf,
        'prefer-expression-arrow-body': preferExpressionArrowBody,
        'prefer-multiline-attr-chain': preferMultilineAttrChain,
        'prefer-multiline-collection': preferMultilineCollection,
        'prefer-multiline-object-pattern': preferMultilineObjectPattern,
        'prefer-multiline-if-condition': preferMultilineIfCondition,
        'require-ast-formatter-rules': requireAstFormatterRules,
    },
})
