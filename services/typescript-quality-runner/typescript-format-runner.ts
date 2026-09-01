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
const testFilePattern = /(?:\.(?:spec|test)\.ts$|\/(?:__tests__|mocks|test|tests|testUtils)\/)/
const compactIfStatementTypes = new Set([
    'BreakStatement',
    'ContinueStatement',
    'ExpressionStatement',
    'ReturnStatement',
    'ThrowStatement',
])

type FormattingFiles = {
    files: string[]
    prohibitedFiles: string[]
}

type LayoutSpan = {
    end: number
    start: number
    text: string
}

type AstNode = {
    [key: string]: unknown
    range?: [number, number]
    type: string
}

type TypeScriptLayouts = {
    arrays: LayoutSpan[]
    binaryExpressions: LayoutSpan[]
    callArguments: LayoutSpan[]
    callChains: LayoutSpan[]
    conditionalExpressions: LayoutSpan[]
    functionParameters: LayoutSpan[]
    ifConditions: LayoutSpan[]
    objectBindings: LayoutSpan[]
    objects: LayoutSpan[]
    types: LayoutSpan[]
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
            else if (formattedExtensions.has(extension) && !testFilePattern.test(path))
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

const getLayoutSpan = (start: number, end: number, source: string): LayoutSpan => ({
    end,
    start,
    text: source.slice(start, end),
})

const getFunctionParameterSpan = (node: AstNode, source: string): LayoutSpan | null => {
    const nodeRange = getNodeRange(node)
    const bodyRange = getNodeRange(node.body as AstNode)
    const parameters = Array.isArray(node.params) ? (node.params as AstNode[]) : []
    if (!nodeRange || !bodyRange)
        return null

    const signatureEnd = node.type === 'ArrowFunctionExpression' ? source.lastIndexOf('=>', bodyRange[0]) : bodyRange[0]
    if (signatureEnd < nodeRange[0])
        return null

    if (node.type === 'ArrowFunctionExpression' && parameters.length === 1) {
        const parameterRange = getNodeRange(parameters[0])
        if (parameterRange) {
            const precedingText = source.slice(nodeRange[0], parameterRange[0])
            if (!precedingText.includes('('))
                return getLayoutSpan(parameterRange[0], parameterRange[1], source)
        }
    }

    const firstParameterRange = getNodeRange(parameters[0])
    const openParenthesis = firstParameterRange ? source.lastIndexOf('(', firstParameterRange[0]) : source.indexOf('(', nodeRange[0])
    const closeParenthesis = source.lastIndexOf(')', signatureEnd)
    if (openParenthesis < nodeRange[0] || closeParenthesis < openParenthesis)
        return null

    return getLayoutSpan(openParenthesis, closeParenthesis + 1, source)
}

const getCallArgumentSpan = (node: AstNode, source: string): LayoutSpan | null => {
    const nodeRange = getNodeRange(node)
    const calleeRange = getNodeRange(node.callee as AstNode)
    if (!nodeRange || !calleeRange)
        return null

    const openParenthesis = source.indexOf('(', calleeRange[1])
    const closeParenthesis = source.lastIndexOf(')', nodeRange[1])
    if (
        openParenthesis < calleeRange[1]
        || closeParenthesis < openParenthesis
        || openParenthesis > nodeRange[1]
    )
        return null

    return getLayoutSpan(openParenthesis, closeParenthesis + 1, source)
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
        ifConditions: [],
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
            && node.type === 'CallExpression'
            || node.type === 'NewExpression'
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

        if (node.type === 'IfStatement') {
            const testRange = getNodeRange(node.test as AstNode)
            if (nodeRange && testRange) {
                const openParenthesis = source.lastIndexOf('(', testRange[0])
                const closeParenthesis = source.indexOf(')', testRange[1])
                if (openParenthesis >= nodeRange[0] && closeParenthesis >= testRange[1]) {
                    const condition = source.slice(openParenthesis, closeParenthesis + 1)
                    if (condition.includes('=>') || /\bfunction(?:\s+[$\w]+)?\s*\(/.test(condition))
                        layouts.ifConditions.push(getLayoutSpan(openParenthesis, closeParenthesis + 1, source))
                }
            }
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
            && node.type === 'BinaryExpression'
            || node.type === 'LogicalExpression'
            && nodeRange
        )
            layouts.binaryExpressions.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

        if (
            !insideIfCondition
            && node.type === 'ConditionalExpression'
            && nodeRange
        )
            layouts.conditionalExpressions.push(getLayoutSpan(nodeRange[0], nodeRange[1], source))

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
            while (start > 0 && /[\t\n\r ]/.test(source[start - 1]!)) start--
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
    const originalIndentation = originalSource.slice(originalSource.lastIndexOf('\n', original.start - 1) + 1).match(/^[\t ]*/)?.[0] ?? ''
    const targetIndentation = formattedSource.slice(formattedSource.lastIndexOf('\n', target.start - 1) + 1).match(/^[\t ]*/)?.[0] ?? ''
    const indentationDifference = targetIndentation.length - originalIndentation.length

    const lines = original.text.split('\n')
    for (let index = 1; index < lines.length; index++) {
        let line = lines[index]!
        if (indentationDifference > 0)
            line = `${' '.repeat(indentationDifference)}${line}`
        else
            line = line.slice(Math.min(-indentationDifference, line.match(/^[\t ]*/)?.[0].length ?? 0))

        const trimmed = line.trimStart()
        if (trimmed.length > 0) {
            const alignsWithLayout = /^[)\]}>]/.test(trimmed) || (layoutType === 'types' && /^[|&]/.test(trimmed))
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
            if (key !== 'types' && !original.text.includes('\n'))
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
            const lineStart = source.lastIndexOf('\n', nodeRange[0] - 1) + 1
            const arrowStart = source.lastIndexOf('=>', bodyRange[0])
            const bodyText = source.slice(bodyRange[0], bodyRange[1])
            if (
                arrowStart >= nodeRange[0]
                && !source.slice(nodeRange[0], arrowStart).includes('\n')
                && !bodyText.includes('\n')
            ) {
                const currentWhitespace = source.slice(arrowStart + 2, bodyRange[0])
                if (currentWhitespace.trim().length === 0) {
                    const singleLineLength = arrowStart + 3 + bodyText.length - lineStart
                    const indentation = `${source.slice(lineStart).match(/^[\t ]*/)?.[0] ?? ''}    `
                    const replacement = singleLineLength > 150 ? `\n${indentation}` : ' '
                    if (currentWhitespace !== replacement) {
                        replacements.push({
                            start: arrowStart + 2,
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

const collapseConditionWhitespace = (condition: string): string | null => {
    let output = ''
    let quote = ''
    let escaped = false
    for (let index = 0; index < condition.length; index++) {
        const character = condition[index]!
        if (quote) {
            output += character
            if (escaped)
                escaped = false
            else if (character === '\\')
                escaped = true
            else if (character === quote)
                quote = ''
            continue
        }

        if (character === '`')
            return null
        if (character === "'" || character === '"') {
            quote = character
            output += character
            continue
        }
        const startsLineComment = character === '/' && condition[index + 1] === '/'
        const startsBlockComment = character === '/' && condition[index + 1] === '*'
        if (startsLineComment || startsBlockComment)
            return null
        if (/\s/.test(character)) {
            if (output.length > 0 && !output.endsWith(' '))
                output += ' '
            continue
        }
        output += character
    }
    return output.trim()
}

type LogicalConditionParts = {
    operands: string[]
    operators: string[]
}

const splitTopLevelLogicalCondition = (condition: string): LogicalConditionParts | null => {
    const operands: string[] = []
    const operators: string[] = []
    const closingDelimiters: string[] = []
    let escaped = false
    let quote = ''
    let operandStart = 0

    for (let index = 0; index < condition.length; index++) {
        const character = condition[index]!
        if (quote) {
            if (escaped)
                escaped = false
            else if (character === '\\')
                escaped = true
            else if (character === quote)
                quote = ''
            continue
        }

        if (character === '`')
            return null
        if (character === "'" || character === '"') {
            quote = character
            continue
        }
        if (character === '(')
            closingDelimiters.push(')')
        else if (character === '[')
            closingDelimiters.push(']')
        else if (character === '{')
            closingDelimiters.push('}')
        else if (character === closingDelimiters.at(-1))
            closingDelimiters.pop()
        else if (closingDelimiters.length === 0) {
            const operator = condition.slice(index, index + 2)
            if (operator === '&&' || operator === '||') {
                const operand = collapseConditionWhitespace(condition.slice(operandStart, index))
                if (!operand)
                    return null
                operands.push(operand)
                operators.push(operator)
                index++
                operandStart = index + 1
            }
        }
    }

    const finalOperand = collapseConditionWhitespace(condition.slice(operandStart))
    if (!finalOperand || operators.length === 0)
        return null
    operands.push(finalOperand)
    return { operands, operators }
}

const canonicalizeIfConditions = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        if (node.type === 'IfStatement') {
            const nodeRange = getNodeRange(node)
            const test = node.test as AstNode
            const testRange = getNodeRange(test)
            if (nodeRange && testRange) {
                const openParenthesis = source.indexOf('(', nodeRange[0])
                const closeParenthesis = source.indexOf(')', testRange[1])
                if (openParenthesis >= nodeRange[0] && closeParenthesis >= testRange[1]) {
                    const condition = source.slice(openParenthesis + 1, closeParenthesis)
                    if (
                        test.type === 'LogicalExpression'
                        && countLogicalEvaluations(test) > 2
                        && collapseConditionWhitespace(condition) != null
                    ) {
                        const conditionParts = splitTopLevelLogicalCondition(condition)
                        if (!conditionParts)
                            throw new Error(`Could not split the logical if condition in ${file}`)
                        const indentation = source.slice(source.lastIndexOf('\n', nodeRange[0] - 1) + 1).match(/^[\t ]*/)?.[0] ?? ''
                        const operandIndentation = `${indentation}    `
                        const replacement = `(\n${conditionParts.operands.map((operand, index) =>
                            `${operandIndentation}${index === 0 ? '' : `${conditionParts.operators[index - 1]} `}${operand}`).join('\n')}\n${indentation})`
                        if (source.slice(openParenthesis, closeParenthesis + 1) !== replacement) {
                            replacements.push({
                                start: openParenthesis,
                                end: closeParenthesis + 1,
                                text: replacement,
                            })
                        }
                    } else if (!condition.includes('=>') && !/\bfunction(?:\s+[$\w]+)?\s*\(/.test(condition)) {
                        const collapsed = collapseConditionWhitespace(condition)
                        if (collapsed != null) {
                            const replacement = `(${collapsed})`
                            if (source.slice(openParenthesis, closeParenthesis + 1) !== replacement) {
                                replacements.push({
                                    start: openParenthesis,
                                    end: closeParenthesis + 1,
                                    text: replacement,
                                })
                            }
                        }
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

const canonicalizeCompactIfBodies = (file: string, source: string): string => {
    const parseResult = parseSync(file, source, {
        astType: 'ts',
        preserveParens: true,
        range: true,
    })
    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        if (node.type === 'IfStatement') {
            const nodeRange = getNodeRange(node)
            const consequent = node.consequent as AstNode | undefined
            const alternate = node.alternate as AstNode | null | undefined
            const consequentRange = getNodeRange(consequent)
            const alternateRange = getNodeRange(alternate)
            if (
                nodeRange
                && consequent
                && consequentRange
                && consequent.type !== 'BlockStatement'
                && compactIfStatementTypes.has(consequent.type)
            ) {
                const closeParenthesis = source.lastIndexOf(')', consequentRange[0])
                const indentation = source.slice(source.lastIndexOf('\n', nodeRange[0] - 1) + 1).match(/^[\t ]*/)?.[0] ?? ''
                const bodyIndentation = `${indentation}    `
                if (closeParenthesis >= nodeRange[0]) {
                    const whitespace = source.slice(closeParenthesis + 1, consequentRange[0])
                    if (whitespace.trim().length === 0 && whitespace !== `\n${bodyIndentation}`) {
                        replacements.push({
                            start: closeParenthesis + 1,
                            end: consequentRange[0],
                            text: `\n${bodyIndentation}`,
                        })
                    }
                }

                if (alternateRange) {
                    const elseStart = source.lastIndexOf('else', alternateRange[0])
                    if (elseStart >= consequentRange[1]) {
                        const beforeElse = source.slice(consequentRange[1], elseStart)
                        if (beforeElse.trim().length === 0 && beforeElse !== `\n${indentation}`) {
                            replacements.push({
                                start: consequentRange[1],
                                end: elseStart,
                                text: `\n${indentation}`,
                            })
                        }
                    }
                }
            }

            if (
                nodeRange
                && alternate
                && alternateRange
                && alternate.type !== 'BlockStatement'
                && alternate.type !== 'IfStatement'
                && compactIfStatementTypes.has(alternate.type)
            ) {
                const elseStart = source.lastIndexOf('else', alternateRange[0])
                if (elseStart >= nodeRange[0]) {
                    const indentation = source.slice(source.lastIndexOf('\n', nodeRange[0] - 1) + 1).match(/^[\t ]*/)?.[0] ?? ''
                    const whitespace = source.slice(elseStart + 4, alternateRange[0])
                    const replacement = `\n${indentation}    `
                    if (whitespace.trim().length === 0 && whitespace !== replacement) {
                        replacements.push({
                            start: elseStart + 4,
                            end: alternateRange[0],
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

    const formattedIfConditions = canonicalizeIfConditions(file, result.code)
    const formattedIfBodies = canonicalizeCompactIfBodies(file, formattedIfConditions)
    const preserved = preserveExpandedTypeScriptLayouts(file, source, formattedIfBodies)
    const canonicalIfConditions = canonicalizeIfConditions(file, preserved)
    const canonicalIfBodies = canonicalizeCompactIfBodies(file, canonicalIfConditions)
    return canonicalizeImportLayout(canonicalizeExpressionArrowBodies(file, canonicalIfBodies), true).output
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
    mode !== 'check'
    && mode !== 'fix'
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
