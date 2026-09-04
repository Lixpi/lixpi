import {
    readFile,
    readdir,
    stat,
    writeFile,
} from 'node:fs/promises'
import {
    extname,
    resolve,
} from 'node:path'
import {
    format,
    type FormatConfig,
} from 'oxfmt'
import { parseSync } from 'oxc-parser'
import {
    err,
    log,
} from '@lixpi/debug-tools'
import { canonicalizeImportLayout } from './import-specifier-order.ts'

const ignoredDirectoryNames = new Set([
    'coverage',
    'dist',
    'node_modules',
    'packages-vendor',
])
const formattedExtensions = new Set([
    '.html',
    '.ts',
])
const testDirectoryNames = new Set([
    '__tests__',
    'mocks',
    'test',
    'tests',
    'testUtils',
])
const compactIfStatementTypes = new Set([
    'BreakStatement',
    'ContinueStatement',
    'ExpressionStatement',
    'ReturnStatement',
    'ThrowStatement',
])
const separatedControlFlowStatementTypes = new Set([
    'BreakStatement',
    'ContinueStatement',
    'ReturnStatement',
    'ThrowStatement',
])
const maximumInlineArrowFunctionLength = 150

type FormattingFiles = {
    files: string[]
    prohibitedFiles: string[]
}

type LayoutSpan = {
    end: number
    preserve?: boolean
    start: number
    text: string
}

type AstNode = {
    [key: string]: unknown
    loc?: {
        end: {
            column: number
            line: number
        }
        start: {
            column: number
            line: number
        }
    }
    range?: [number, number]
    type: string
}

type AstComment = {
    end: number
    start: number
}

type TypeScriptLayouts = {
    arrays: LayoutSpan[]
    binaryExpressions: LayoutSpan[]
    callArguments: LayoutSpan[]
    callChains: LayoutSpan[]
    conditionalExpressions: LayoutSpan[]
    functionParameters: LayoutSpan[]
    objectBindings: LayoutSpan[]
    objects: LayoutSpan[]
    types: LayoutSpan[]
}

const isTestFile = (path: string): boolean => {
    if (path.endsWith('.spec.ts') || path.endsWith('.test.ts'))
        return true
    return path.split('/').some((segment) => testDirectoryNames.has(segment))
}

const collectFormattingFiles = async (inputPaths: string[]): Promise<FormattingFiles> => {
    const files: string[] = []
    const prohibitedFiles: string[] = []

    const visit = async (path: string): Promise<void> => {
        const entry = await stat(path)
        if (entry.isFile()) {
            const extension = extname(path)
            if (extension === '.jsx' || extension === '.tsx')
                prohibitedFiles.push(path)
            else if (formattedExtensions.has(extension) && !isTestFile(path))
                files.push(path)
            return
        }
        if (!entry.isDirectory())
            return

        const entries = await readdir(path, { withFileTypes: true })
        for (const child of entries) {
            if (child.isDirectory() && ignoredDirectoryNames.has(child.name))
                continue
            await visit(resolve(path, child.name))
        }
    }

    for (const inputPath of inputPaths) await visit(resolve(inputPath))
    return {
        files: files.sort(),
        prohibitedFiles: prohibitedFiles.sort(),
    }
}

const readFormatConfig = async (): Promise<FormatConfig> => {
    const config = JSON.parse(await readFile('/usr/src/quality-runner/oxfmt.json', 'utf8')) as FormatConfig
    delete config.$schema
    delete config.ignorePatterns
    return config
}

const getNodeRange = (node: AstNode | null | undefined): [number, number] | null => node?.range ?? null

const getLineStart = (source: string, offset: number): number => source.lastIndexOf('\n', offset - 1) + 1

const getLineIndentation = (source: string, offset: number): string => {
    const lineStart = getLineStart(source, offset)
    let cursor = lineStart
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor++
    return source.slice(lineStart, cursor)
}

const isWhitespaceCharacter = (character: string | undefined): boolean => character === ' '
    || character === '\t'
    || character === '\n'
    || character === '\r'

const getTrailingWhitespaceStart = (source: string, start: number, end: number): number => {
    let cursor = end
    while (cursor > start && isWhitespaceCharacter(source[cursor - 1])) cursor--
    return cursor
}

const getLayoutSpan = (start: number, end: number, source: string, preserve = false): LayoutSpan => ({
    end,
    preserve,
    start,
    text: source.slice(start, end),
})

const getFunctionParameterSpan = (node: AstNode, source: string): LayoutSpan | null => {
    const nodeRange = getNodeRange(node)
    const bodyRange = getNodeRange(node.body as AstNode)
    if (!nodeRange || !bodyRange)
        return null
    return getLayoutSpan(nodeRange[0], bodyRange[0], source)
}

const getCallArgumentSpan = (node: AstNode, source: string): LayoutSpan | null => {
    const nodeRange = getNodeRange(node)
    if (!nodeRange)
        return null
    return getLayoutSpan(nodeRange[0], nodeRange[1], source)
}

const isAstNode = (value: unknown): value is AstNode => Boolean(value && typeof value === 'object' && typeof (value as AstNode).type === 'string')

const isPreservedTypeNode = (node: AstNode, parent: AstNode | null, parentKey: string): boolean => node.type === 'TSTypeAnnotation'
    || node.type === 'TSTypeParameterDeclaration'
    || node.type === 'TSTypeParameterInstantiation'
    || (parent?.type === 'TSTypeAliasDeclaration' && parentKey === 'typeAnnotation')

const collectTypeScriptLayouts = (file: string, source: string): TypeScriptLayouts => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const layouts: TypeScriptLayouts = {
        arrays: [],
        binaryExpressions: [],
        callArguments: [],
        callChains: [],
        conditionalExpressions: [],
        functionParameters: [],
        objectBindings: [],
        objects: [],
        types: [],
    }

    const visit = (node: AstNode, parent: AstNode | null = null, grandparent: AstNode | null = null, parentKey = '', insideIfCondition = false): void => {
        const nodeRange = getNodeRange(node)
        const body = node.body as AstNode | undefined
        const bodyRange = getNodeRange(body)

        if (
            !insideIfCondition
            && Array.isArray(node.params)
            && bodyRange
        ) {
            const span = getFunctionParameterSpan(node, source)
            if (span)
                layouts.functionParameters.push(span)
        }

        if (
            !insideIfCondition
            && (node.type === 'CallExpression' || node.type === 'NewExpression')
        ) {
            const span = getCallArgumentSpan(node, source)
            if (span)
                layouts.callArguments.push(span)
        }

        if (
            !insideIfCondition
            && node.type === 'CallExpression'
            && (node.callee as AstNode | undefined)?.type === 'MemberExpression'
            && nodeRange
        ) {
            const isNestedChain = parent?.type === 'MemberExpression' && parent.object === node && grandparent?.type === 'CallExpression' && grandparent.callee === parent
            if (!isNestedChain)
                layouts.callChains.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))
        }

        if (
            !insideIfCondition
            && node.type === 'ObjectPattern'
            && nodeRange
        )
            layouts.objectBindings.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

        if (
            !insideIfCondition
            && node.type === 'ArrayExpression'
            && nodeRange
        )
            layouts.arrays.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

        if (
            !insideIfCondition
            && (node.type === 'BinaryExpression' || node.type === 'LogicalExpression')
            && nodeRange
        )
            layouts.binaryExpressions.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

        if (
            !insideIfCondition
            && node.type === 'ConditionalExpression'
            && nodeRange
        ) {
            const parenthesized = parent?.type === 'ParenthesizedExpression'
            const expressionRange = parenthesized ? getNodeRange(parent) : nodeRange
            if (expressionRange)
                layouts.conditionalExpressions.push(getLayoutSpan(expressionRange[0], expressionRange[1], source, parenthesized))
        }

        if (
            !insideIfCondition
            && node.type === 'ObjectExpression'
            && nodeRange
        )
            layouts.objects.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

        if (
            !insideIfCondition
            && isPreservedTypeNode(node, parent, parentKey)
            && nodeRange
            && parent?.type !== 'TSTypeAnnotation'
        ) {
            let start = nodeRange[0]
            while (start > 0 && isWhitespaceCharacter(source[start - 1])) start--
            layouts.types.push(getLayoutSpan(start, nodeRange[1], source))
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            const childInsideIfCondition = insideIfCondition || (node.type === 'IfStatement' && key === 'test')
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child, node, parent, key, childInsideIfCondition)
            } else if (isAstNode(value))
                visit(value, node, parent, key, childInsideIfCondition)
        }
    }

    visit(parseResult.program as AstNode)
    return layouts
}

const reindentLayoutText = (originalSource: string, original: LayoutSpan, formattedSource: string, target: LayoutSpan, layoutType: keyof TypeScriptLayouts): string => {
    const originalIndentation = getLineIndentation(originalSource, original.start)
    const targetIndentation = getLineIndentation(formattedSource, target.start)
    const indentationDifference = targetIndentation.length - originalIndentation.length

    const lines = original.text.split('\n')
    for (let index = 1; index < lines.length; index++) {
        let line = lines[index]!
        if (indentationDifference > 0)
            line = `${' '.repeat(indentationDifference)}${line}`
        else
            line = line.slice(Math.min(-indentationDifference, line.length - line.trimStart().length))

        const trimmed = line.trimStart()
        if (trimmed.length > 0) {
            const firstCharacter = trimmed[0]!
            const alignsWithLayout = ')]}>'.includes(firstCharacter) || (layoutType === 'types' && '|&'.includes(firstCharacter))
            const minimumIndentation = targetIndentation.length + (alignsWithLayout ? 0 : 4)
            const indentation = line.length - trimmed.length
            if (indentation < minimumIndentation)
                line = `${' '.repeat(minimumIndentation)}${trimmed}`
        }
        lines[index] = line
    }
    return lines.join('\n')
}

const preserveExpandedTypeScriptLayouts = (file: string, source: string, formatted: string): string => {
    const originalLayouts = collectTypeScriptLayouts(file, source)
    const formattedLayouts = collectTypeScriptLayouts(file, formatted)
    const replacements: LayoutSpan[] = []

    for (const key of Object.keys(originalLayouts) as Array<keyof TypeScriptLayouts>) {
        const originalSpans = originalLayouts[key]
        const formattedSpans = formattedLayouts[key]
        if (originalSpans.length !== formattedSpans.length)
            throw new Error(`Oxfmt changed the ${key} syntax shape in ${file}`)

        for (let index = 0; index < originalSpans.length; index++) {
            const original = originalSpans[index]!
            if (key !== 'types' && !original.preserve && !original.text.includes('\n'))
                continue

            const target = formattedSpans[index]!
            replacements.push({
                start: target.start,
                end: target.end,
                text: reindentLayoutText(source, original, formatted, target, key),
            })
        }
    }

    const nonOverlappingReplacements: LayoutSpan[] = []
    for (const replacement of replacements.sort((left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start)) {
        const overlapsSelectedReplacement = nonOverlappingReplacements.some((candidate) =>
            replacement.start < candidate.end && replacement.end > candidate.start)
        if (!overlapsSelectedReplacement)
            nonOverlappingReplacements.push(replacement)
    }

    let output = formatted
    for (const replacement of nonOverlappingReplacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const isHtmlTemplateTag = (tag: AstNode | undefined): boolean =>
    tag?.type === 'Identifier' && tag.name === 'html'
    || tag?.type === 'MemberExpression'
        && tag.computed === false
        && isAstNode(tag.property)
        && tag.property.type === 'Identifier'
        && tag.property.name === 'html'

const collectHtmlTemplateLayouts = (file: string, source: string): LayoutSpan[] => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const layouts: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const tag = node.tag as AstNode | undefined
        const nodeRange = getNodeRange(node)
        if (
            node.type === 'TaggedTemplateExpression'
            && isHtmlTemplateTag(tag)
            && nodeRange
        )
            layouts.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(value))
                visit(value)
        }
    }

    visit(parseResult.program as AstNode)
    return layouts
}

const reindentHtmlTemplate = (source: string, sourceLayout: LayoutSpan, target: string, targetLayout: LayoutSpan): string => {
    const sourceIndentation = getLineIndentation(source, sourceLayout.start)
    const targetIndentation = getLineIndentation(target, targetLayout.start)
    const indentationDifference = targetIndentation.length - sourceIndentation.length
    const lines = sourceLayout.text.split('\n')

    for (let index = 1; index < lines.length; index++) {
        const line = lines[index]!
        if (indentationDifference > 0)
            lines[index] = `${' '.repeat(indentationDifference)}${line}`
        else
            lines[index] = line.slice(Math.min(-indentationDifference, line.length - line.trimStart().length))
    }

    return lines.join('\n')
}

const applyHtmlTemplateFormatting = (file: string, formatted: string, htmlFormatted: string): string => {
    const formattedLayouts = collectHtmlTemplateLayouts(file, formatted)
    const htmlLayouts = collectHtmlTemplateLayouts(file, htmlFormatted)
    if (formattedLayouts.length !== htmlLayouts.length)
        throw new Error(`Oxfmt changed the html template syntax shape in ${file}`)

    const replacements = formattedLayouts.map((target, index) => ({
        ...target,
        text: reindentHtmlTemplate(htmlFormatted, htmlLayouts[index]!, formatted, target),
    }))
    const nonOverlappingReplacements: LayoutSpan[] = []
    for (const replacement of replacements.sort((left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start)) {
        const overlapsSelectedReplacement = nonOverlappingReplacements.some((candidate) =>
            replacement.start < candidate.end && replacement.end > candidate.start)
        if (!overlapsSelectedReplacement)
            nonOverlappingReplacements.push(replacement)
    }

    let output = formatted
    for (const replacement of nonOverlappingReplacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const canonicalizeExpressionArrowBodies = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const nodeRange = getNodeRange(node)
        const bodyRange = getNodeRange(node.body as AstNode)
        if (
            node.type === 'ArrowFunctionExpression'
            && (node.body as AstNode | undefined)?.type !== 'BlockStatement'
            && nodeRange
            && bodyRange
        ) {
            const bodyText = source.slice(bodyRange[0], bodyRange[1])
            if (!bodyText.includes('\n')) {
                const whitespaceStart = getTrailingWhitespaceStart(source, nodeRange[0], bodyRange[0])
                const currentWhitespace = source.slice(whitespaceStart, bodyRange[0])
                if (currentWhitespace.trim().length === 0) {
                    const arrowLineStart = getLineStart(source, whitespaceStart)
                    const singleLineLength = whitespaceStart + 1 + bodyText.length - arrowLineStart
                    const indentation = `${getLineIndentation(source, whitespaceStart)}    `
                    const replacement = singleLineLength > maximumInlineArrowFunctionLength ? `\n${indentation}` : ' '
                    if (currentWhitespace !== replacement) {
                        replacements.push({
                            start: whitespaceStart,
                            end: bodyRange[0],
                            text: replacement,
                        })
                    }
                }
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(value))
                visit(value)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const canonicalizeHtmlTemplateBoundaries = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const tag = node.tag as AstNode | undefined
        const template = node.quasi as AstNode | undefined
        const nodeRange = getNodeRange(node)
        const templateRange = getNodeRange(template)
        if (
            node.type === 'TaggedTemplateExpression'
            && isHtmlTemplateTag(tag)
            && template?.type === 'TemplateLiteral'
            && nodeRange
            && templateRange
            && templateRange[1] - templateRange[0] >= 2
        ) {
            const contentStart = templateRange[0] + 1
            const contentEnd = templateRange[1] - 1
            let leadingWhitespaceEnd = contentStart
            let trailingWhitespaceStart = contentEnd
            while (leadingWhitespaceEnd < contentEnd && isWhitespaceCharacter(source[leadingWhitespaceEnd])) leadingWhitespaceEnd++
            while (trailingWhitespaceStart > leadingWhitespaceEnd && isWhitespaceCharacter(source[trailingWhitespaceStart - 1])) trailingWhitespaceStart--

            const indentation = getLineIndentation(source, nodeRange[0])
            const isMultiline = node.loc != null && node.loc.start.line !== node.loc.end.line
            const inlineLength = (node.loc?.start.column ?? 0) + nodeRange[1] - nodeRange[0]
            const shouldExpand = isMultiline || inlineLength > maximumInlineArrowFunctionLength
            const leadingWhitespace = shouldExpand ? `\n${indentation}    ` : ''
            const trailingWhitespace = shouldExpand ? `\n${indentation}` : ''

            if (leadingWhitespaceEnd === contentEnd) {
                const whitespace = shouldExpand ? `\n${indentation}` : ''
                if (source.slice(contentStart, contentEnd) !== whitespace) {
                    replacements.push({
                        start: contentStart,
                        end: contentEnd,
                        text: whitespace,
                    })
                }
                return
            }
            if (source.slice(contentStart, leadingWhitespaceEnd) !== leadingWhitespace) {
                replacements.push({
                    start: contentStart,
                    end: leadingWhitespaceEnd,
                    text: leadingWhitespace,
                })
            }
            if (source.slice(trailingWhitespaceStart, contentEnd) !== trailingWhitespace) {
                replacements.push({
                    start: trailingWhitespaceStart,
                    end: contentEnd,
                    text: trailingWhitespace,
                })
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(value))
                visit(value)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const canonicalizeNestedConditionalParentheses = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode, parent: AstNode | null = null): void => {
        const nodeRange = getNodeRange(node)
        if (node.type === 'ConditionalExpression' && parent?.type === 'ConditionalExpression' && nodeRange) {
            replacements.push({
                start: nodeRange[1],
                end: nodeRange[1],
                text: ')',
            })
            replacements.push({
                start: nodeRange[0],
                end: nodeRange[0],
                text: '(',
            })
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child, node)
            } else if (isAstNode(value))
                visit(value, node)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const countLogicalEvaluations = (node: AstNode): number => {
    if (node.type === 'ParenthesizedExpression' && isAstNode(node.expression))
        return countLogicalEvaluations(node.expression)
    if (
        node.type !== 'LogicalExpression'
        || !isAstNode(node.left)
        || !isAstNode(node.right)
    )
        return 1
    return countLogicalEvaluations(node.left) + countLogicalEvaluations(node.right)
}

type LogicalConditionParts = {
    operands: AstNode[]
    operators: string[]
}

const unwrapParenthesizedExpression = (node: AstNode): AstNode => {
    let current = node
    while (current.type === 'ParenthesizedExpression' && isAstNode(current.expression)) current = current.expression
    return current
}

const getAstExpressionText = (node: AstNode, source: string): string | null => {
    if (node.type === 'ParenthesizedExpression' && isAstNode(node.expression)) {
        const expression = getAstExpressionText(node.expression, source)
        return expression == null ? null : `(${expression})`
    }
    if (
        node.type === 'LogicalExpression'
        && isAstNode(node.left)
        && isAstNode(node.right)
        && typeof node.operator === 'string'
    ) {
        const left = getAstExpressionText(node.left, source)
        const right = getAstExpressionText(node.right, source)
        return left == null || right == null ? null : `${left} ${node.operator} ${right}`
    }

    const range = getNodeRange(node)
    if (!range)
        return null
    const expression = source.slice(range[0], range[1]).trim()
    return expression || null
}

const getLogicalConditionParts = (node: AstNode): LogicalConditionParts | null => {
    const operands: AstNode[] = []
    const operators: string[] = []
    const logicalExpression = unwrapParenthesizedExpression(node)
    if (
        logicalExpression.type !== 'LogicalExpression'
        || (
            logicalExpression.operator !== '&&'
            && logicalExpression.operator !== '||'
            && logicalExpression.operator !== '??'
        )
    )
        return null
    const rootOperator = logicalExpression.operator

    const visit = (current: AstNode): boolean => {
        if (
            current.type === 'LogicalExpression'
            && isAstNode(current.left)
            && isAstNode(current.right)
            && current.operator === rootOperator
        ) {
            if (!visit(current.left))
                return false
            operators.push(rootOperator)
            return visit(current.right)
        }

        operands.push(current)
        return true
    }

    if (!visit(logicalExpression) || operators.length === 0)
        return null
    return { operands, operators }
}

const getConditionOperandText = (node: AstNode, source: string, indentation: string): string | null => {
    const logicalExpression = unwrapParenthesizedExpression(node)
    if (logicalExpression.type !== 'LogicalExpression')
        return getAstExpressionText(node, source)

    const inlineExpression = getAstExpressionText(logicalExpression, source)
    if (!inlineExpression)
        return null
    if (countLogicalEvaluations(logicalExpression) <= 2)
        return `(${inlineExpression})`

    const conditionParts = getLogicalConditionParts(logicalExpression)
    if (!conditionParts)
        return null
    const operandIndentation = `${indentation}    `
    const lines: string[] = []
    for (let index = 0; index < conditionParts.operands.length; index++) {
        const operand = getConditionOperandText(conditionParts.operands[index]!, source, operandIndentation)
        if (!operand)
            return null
        const operator = index === 0 ? '' : `${conditionParts.operators[index - 1]} `
        lines.push(`${operandIndentation}${operator}${operand}`)
    }
    return `(\n${lines.join('\n')}\n${indentation})`
}

const getMultilineIfConditionText = (node: AstNode, source: string, indentation: string): string | null => {
    if (node.type === 'ParenthesizedExpression') {
        const operand = getConditionOperandText(node, source, indentation)
        return operand ? `${indentation}${operand}` : null
    }

    const conditionParts = getLogicalConditionParts(node)
    if (!conditionParts)
        return null
    const lines: string[] = []
    for (let index = 0; index < conditionParts.operands.length; index++) {
        const operand = getConditionOperandText(conditionParts.operands[index]!, source, indentation)
        if (!operand)
            return null
        const operator = index === 0 ? '' : `${conditionParts.operators[index - 1]} `
        lines.push(`${indentation}${operator}${operand}`)
    }
    return lines.join('\n')
}

const hasCommentWithinRange = (comments: AstComment[], range: [number, number]): boolean =>
    comments.some((comment) => comment.start >= range[0] && comment.end <= range[1])

const getStatementList = (node: AstNode): AstNode[] | null => {
    if (
        node.type !== 'BlockStatement'
        && node.type !== 'Program'
        && node.type !== 'StaticBlock'
        && node.type !== 'TSModuleBlock'
    ) {
        if (node.type !== 'SwitchCase' || !Array.isArray(node.consequent))
            return null
        return node.consequent.filter(isAstNode)
    }

    if (!Array.isArray(node.body))
        return null
    return node.body.filter(isAstNode)
}

const getStatementGap = (
    source: string,
    comments: AstComment[],
    previousEnd: number,
    nextStart: number,
): [number, number] | null => {
    let gapStart = previousEnd
    const commentsInGap = comments.filter((comment) => comment.start >= previousEnd && comment.end <= nextStart)
    for (const comment of commentsInGap) {
        if (!source.slice(gapStart, comment.start).includes('\n')) {
            gapStart = comment.end
            continue
        }
        if (source.slice(gapStart, comment.start).trim().length > 0)
            return null
        return [gapStart, comment.start]
    }

    if (source.slice(gapStart, nextStart).trim().length > 0)
        return null
    return [gapStart, nextStart]
}

const canonicalizeStatementSpacing = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = (parseResult.comments as AstComment[]).toSorted((left, right) => left.start - right.start)
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const statements = getStatementList(node)
        if (statements) {
            for (let index = 1; index < statements.length; index++) {
                const previous = statements[index - 1]!
                const current = statements[index]!
                if (
                    previous.type !== 'IfStatement'
                    && current.type !== 'IfStatement'
                    && !separatedControlFlowStatementTypes.has(current.type)
                )
                    continue

                const previousRange = getNodeRange(previous)
                const currentRange = getNodeRange(current)
                if (!previousRange || !currentRange)
                    continue
                const gap = getStatementGap(source, comments, previousRange[1], currentRange[0])
                if (!gap)
                    continue

                const replacement = `\n\n${getLineIndentation(source, gap[1])}`
                if (source.slice(gap[0], gap[1]) === replacement)
                    continue
                replacements.push({
                    start: gap[0],
                    end: gap[1],
                    text: replacement,
                })
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(value))
                visit(value)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const canonicalizeIfStatements = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        if (node.type === 'IfStatement') {
            const nodeRange = getNodeRange(node)
            const consequent = node.consequent as AstNode | undefined
            const alternate = node.alternate as AstNode | null | undefined
            const consequentRange = getNodeRange(consequent)
            const alternateRange = getNodeRange(alternate)
            const test = node.test as AstNode | undefined
            const testRange = getNodeRange(test)
            const consequentIsCompact = Boolean(
                consequent
                && consequent.type !== 'BlockStatement'
                && compactIfStatementTypes.has(consequent.type),
            )
            const alternateIsCompact = Boolean(
                alternate
                && alternate.type !== 'BlockStatement'
                && alternate.type !== 'IfStatement'
                && compactIfStatementTypes.has(alternate.type),
            )
            if (
                nodeRange
                && test
                && testRange
                && consequent
                && consequentRange
                && !hasCommentWithinRange(comments, [nodeRange[0], consequentRange[0]])
            ) {
                const indentation = getLineIndentation(source, nodeRange[0])
                const bodyIndentation = `${indentation}    `
                const conditionIsMultiline = countLogicalEvaluations(test) > 2
                const multilineCondition = conditionIsMultiline
                    ? getMultilineIfConditionText(test, source, bodyIndentation)
                    : null
                if (conditionIsMultiline && !multilineCondition)
                    throw new Error(`Could not split the logical if condition in ${file}`)
                const inlineCondition = conditionIsMultiline ? null : getAstExpressionText(test, source)
                if (!conditionIsMultiline && !inlineCondition)
                    throw new Error(`Could not format the inline if condition in ${file}`)
                const condition = multilineCondition
                    ? `\n${multilineCondition}\n${indentation}`
                    : inlineCondition
                const bodySeparator = consequentIsCompact ? `\n${bodyIndentation}` : ' '
                const replacement = `if (${condition})${bodySeparator}`
                if (source.slice(nodeRange[0], consequentRange[0]) !== replacement) {
                    replacements.push({
                        start: nodeRange[0],
                        end: consequentRange[0],
                        text: replacement,
                    })
                }
            }

            if (
                nodeRange
                && alternate
                && alternateRange
                && consequent
                && consequentRange
                && !hasCommentWithinRange(comments, [consequentRange[1], alternateRange[0]])
                && (consequentIsCompact || alternateIsCompact)
            ) {
                const indentation = getLineIndentation(source, nodeRange[0])
                const beforeElse = consequentIsCompact ? `\n${indentation}` : ' '
                const afterElse = alternateIsCompact ? `\n${indentation}    ` : ' '
                const replacement = `${beforeElse}else${afterElse}`
                if (source.slice(consequentRange[1], alternateRange[0]) !== replacement) {
                    replacements.push({
                        start: consequentRange[1],
                        end: alternateRange[0],
                        text: replacement,
                    })
                }
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue
            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(value))
                visit(value)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`
    return output
}

const formatSource = async (file: string, source: string, config: FormatConfig): Promise<string> => {
    const result = await format(file, source, config)
    if (result.errors.length > 0) {
        for (const error of result.errors) {
            err(`${file}: ${error.message}`)
            if (error.codeframe)
                err(error.codeframe)
        }
        throw new Error(`Oxfmt could not format ${file}`)
    }

    if (!file.endsWith('.ts'))
        return result.code

    const htmlResult = await format(file, source, {
        ...config,
        printWidth: maximumInlineArrowFunctionLength,
    })
    if (htmlResult.errors.length > 0)
        throw new Error(`Oxfmt could not format embedded HTML in ${file}`)

    const formattedIfStatements = canonicalizeIfStatements(file, result.code)
    const preserved = preserveExpandedTypeScriptLayouts(file, source, formattedIfStatements)
    const canonicalIfStatements = canonicalizeIfStatements(file, preserved)
    const canonicalArrowBodies = canonicalizeExpressionArrowBodies(file, canonicalIfStatements)
    const canonicalConditionalExpressions = canonicalizeNestedConditionalParentheses(file, canonicalArrowBodies)
    const formattedHtmlTemplates = applyHtmlTemplateFormatting(file, canonicalConditionalExpressions, htmlResult.code)
    const canonicalHtmlTemplates = canonicalizeHtmlTemplateBoundaries(file, formattedHtmlTemplates)
    const canonicalStatementSpacing = canonicalizeStatementSpacing(file, canonicalHtmlTemplates)
    return canonicalizeImportLayout(canonicalStatementSpacing, true, file).output
}

const describeFirstFormattingDifference = (file: string, source: string, formatted: string): void => {
    let offset = 0
    while (offset < source.length && offset < formatted.length && source[offset] === formatted[offset]) offset++
    const line = source.slice(0, offset).split('\n').length
    const contextStart = Math.max(0, source.lastIndexOf('\n', offset - 1) + 1)
    const sourceContextEnd = source.indexOf('\n', offset)
    const formattedContextEnd = formatted.indexOf('\n', offset)
    err(`${file}:${line}: formatting differs`)
    err(`current: ${JSON.stringify(source.slice(contextStart, sourceContextEnd < 0 ? source.length : sourceContextEnd))}`)
    err(`expected: ${JSON.stringify(formatted.slice(contextStart, formattedContextEnd < 0 ? formatted.length : formattedContextEnd))}`)
}

const [mode, ...inputPaths] = process.argv.slice(2)
if (
    (mode !== 'check' && mode !== 'fix')
    || inputPaths.length === 0
) {
    err('Usage: typescript-format-runner.ts {check|fix} <path...>')
    process.exit(1)
}

const {
    files,
    prohibitedFiles,
} = await collectFormattingFiles(inputPaths)
if (prohibitedFiles.length > 0) {
    for (const file of prohibitedFiles) err(`${file}: JSX source files are prohibited; use a .ts module and the repository DOM APIs`)
    process.exit(1)
}

const formatConfig = await readFormatConfig()
let changedFileCount = 0

for (const file of files) {
    const source = await readFile(file, 'utf8')
    const formatted = await formatSource(file, source, formatConfig)
    if (formatted === source)
        continue

    changedFileCount++
    if (mode === 'fix')
        await writeFile(file, formatted)
    else
        describeFirstFormattingDifference(file, source, formatted)
}

if (mode === 'fix') {
    if (changedFileCount > 0)
        log(`Formatted ${changedFileCount} TypeScript and HTML file(s).`)
} else if (changedFileCount > 0) {
    err(`Found ${changedFileCount} TypeScript and HTML formatting violation(s).`)
    process.exit(1)
}
