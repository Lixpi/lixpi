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
    parse,
    parseFragment,
} from 'parse5'
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
const iteratorMethodNames = new Set([
    'drop',
    'entries',
    'every',
    'filter',
    'find',
    'findIndex',
    'findLast',
    'findLastIndex',
    'flatMap',
    'forEach',
    'keys',
    'map',
    'reduce',
    'reduceRight',
    'some',
    'take',
    'toArray',
    'values',
])
const maximumInlineArrowFunctionLength = 150
const maximumInlineIteratorChainLength = 150

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

type HtmlAttributeLocation = {
    endOffset: number
    startOffset: number
}

type HtmlNode = {
    attrs?: unknown[]
    childNodes?: HtmlNode[]
    content?: HtmlNode
    sourceCodeLocation?: {
        attrs?: Record<
            string,
            HtmlAttributeLocation,
        >
        startTag?: HtmlAttributeLocation
    }
}

type HtmlTemplateContent = {
    end: number
    interpolationRanges: Array<[number, number]>
    indentation: string
    start: number
}

type CallChainSegment = {
    boundaryEnd: number
    boundaryStart: number
    isIterator: boolean
    leadingWhitespace: string
    text: string
}

type CallChain = {
    base: AstNode
    iteratorCount: number
    segments: CallChainSegment[]
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
    if (
        path.endsWith('.spec.ts')
        || path.endsWith('.test.ts')
    )
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

            if (
                extension === '.jsx'
                || extension === '.tsx'
            )
                prohibitedFiles.push(path)
            else if (
                formattedExtensions.has(extension)
                && !isTestFile(path)
            )
                files.push(path)

            return
        }

        if (!entry.isDirectory())
            return

        const entries = await readdir(
            path,
            { withFileTypes: true },
        )

        for (const child of entries) {
            if (
                child.isDirectory()
                && ignoredDirectoryNames.has(child.name)
            )
                continue

            await visit(resolve(
                path,
                child.name,
            ))
        }
    }

    for (const inputPath of inputPaths) await visit(resolve(inputPath))

    return {
        files: files.sort(),
        prohibitedFiles: prohibitedFiles.sort(),
    }
}

const readFormatConfig = async (): Promise<FormatConfig> => {
    const config = JSON.parse(await readFile(
        '/usr/src/quality-runner/oxfmt.json',
        'utf8',
    )) as FormatConfig
    delete config.$schema
    delete config.ignorePatterns

    return config
}

const getNodeRange = (node: AstNode | null | undefined): [number, number] | null => node?.range ?? null

const getLineStart = (
    source: string,
    offset: number,
): number => source.lastIndexOf(
    '\n',
    offset - 1,
) + 1

const getLineIndentation = (
    source: string,
    offset: number,
): string => {
    const lineStart = getLineStart(
        source,
        offset,
    )
    let cursor = lineStart

    while (
        source[cursor] === ' '
        || source[cursor] === '\t'
    )
        cursor++

    return source.slice(
        lineStart,
        cursor,
    )
}

const isWhitespaceCharacter = (character: string | undefined): boolean => character === ' '
    || character === '\t'
    || character === '\n'
    || character === '\r'

const getTrailingWhitespaceStart = (
    source: string,
    start: number,
    end: number,
): number => {
    let cursor = end

    while (
        cursor > start
        && isWhitespaceCharacter(source[cursor - 1])
    )
        cursor--

    return cursor
}

const getLeadingWhitespaceEnd = (
    source: string,
    start: number,
    end: number,
): number => {
    let cursor = start

    while (
        cursor < end
        && isWhitespaceCharacter(source[cursor])
    )
        cursor++

    return cursor
}

const getLayoutSpan = (
    start: number,
    end: number,
    source: string,
    preserve = false,
): LayoutSpan => ({
    end,
    preserve,
    start,
    text: source.slice(
        start,
        end,
    ),
})

const reindentNodeText = (
    source: string,
    nodeRange: [number, number],
    indentation: string,
): string => {
    const originalIndentation = getLineIndentation(
        source,
        nodeRange[0],
    )
    const indentationDifference = indentation.length - originalIndentation.length
    const lines = source.slice(
        nodeRange[0],
        nodeRange[1],
    ).split('\n')

    for (let index = 1; index < lines.length; index++) {
        const line = lines[index]!

        if (indentationDifference > 0)
            lines[index] = `${' '.repeat(indentationDifference)}${line}`
        else
            lines[index] = line.slice(Math.min(
                -indentationDifference,
                line.length - line.trimStart().length,
            ))
    }

    return lines.join('\n')
}

const hasMultilineFunctionParameters = (
    node: AstNode,
    source: string,
): boolean => {
    if (!Array.isArray(node.params))
        return false

    const parameters = node.params.filter(isAstNode)
    const firstParameter = parameters[0]
    const lastParameter = parameters.at(-1)
    const firstParameterRange = getNodeRange(firstParameter)
    const lastParameterRange = getNodeRange(lastParameter)

    return Boolean(
        firstParameterRange
        && lastParameterRange
        && getLineStart(
            source,
            firstParameterRange[0],
        ) !== getLineStart(
            source,
            lastParameterRange[1] - 1,
        )
    )
}

const getFunctionParameterSpan = (
    node: AstNode,
    source: string,
): LayoutSpan | null => {
    const nodeRange = getNodeRange(node)
    const bodyRange = getNodeRange(node.body as AstNode)

    if (
        !nodeRange
        || !bodyRange
    )
        return null

    const signatureEnd = getTrailingWhitespaceStart(
        source,
        nodeRange[0],
        bodyRange[0],
    )

    return getLayoutSpan(
        nodeRange[0],
        signatureEnd,
        source,
        hasMultilineFunctionParameters(
            node,
            source,
        ),
    )
}

const getCallArgumentSpan = (
    node: AstNode,
    source: string,
): LayoutSpan | null => {
    const nodeRange = getNodeRange(node)

    if (!nodeRange)
        return null

    return getLayoutSpan(
        nodeRange[0],
        nodeRange[1],
        source,
    )
}

const isAstNode = (value: unknown): value is AstNode => Boolean(value && typeof value === 'object' && typeof (value as AstNode).type === 'string')

const isPreservedTypeNode = (
    node: AstNode,
    parent: AstNode | null,
    parentKey: string,
): boolean => node.type === 'TSTypeAnnotation'
    || node.type === 'TSTypeParameterDeclaration'
    || node.type === 'TSTypeParameterInstantiation'
    || (parent?.type === 'TSTypeAliasDeclaration' && parentKey === 'typeAnnotation')

const collectTypeScriptLayouts = (
    file: string,
    source: string,
): TypeScriptLayouts => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

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

    const visit = (
        node: AstNode,
        parent: AstNode | null = null,
        grandparent: AstNode | null = null,
        parentKey = '',
        insideCondition = false,
    ): void => {
        const nodeRange = getNodeRange(node)
        const body = node.body as AstNode | undefined
        const bodyRange = getNodeRange(body)

        if (
            !insideCondition
            && Array.isArray(node.params)
            && bodyRange
        ) {
            const span = getFunctionParameterSpan(
                node,
                source,
            )

            if (span)
                layouts.functionParameters.push(span)
        }

        if (
            !insideCondition
            && (
                node.type === 'CallExpression'
                || node.type === 'NewExpression'
            )
        ) {
            const span = getCallArgumentSpan(
                node,
                source,
            )

            if (span)
                layouts.callArguments.push(span)
        }

        if (
            !insideCondition
            && node.type === 'CallExpression'
            && (node.callee as AstNode | undefined)?.type === 'MemberExpression'
            && nodeRange
        ) {
            const isNestedChain = (
                parent?.type === 'MemberExpression'
                && parent.object === node
                && grandparent?.type === 'CallExpression'
                && grandparent.callee === parent
            )

            if (!isNestedChain)
                layouts.callChains.push(getLayoutSpan(
                    nodeRange[0],
                    nodeRange[1],
                    source,
                ))
        }

        if (
            !insideCondition
            && node.type === 'ObjectPattern'
            && nodeRange
        )
            layouts.objectBindings.push(getLayoutSpan(
                nodeRange[0],
                nodeRange[1],
                source,
            ))

        if (
            !insideCondition
            && node.type === 'ArrayExpression'
            && nodeRange
        )
            layouts.arrays.push(getLayoutSpan(
                nodeRange[0],
                nodeRange[1],
                source,
            ))

        if (
            !insideCondition
            && (
                node.type === 'BinaryExpression'
                || node.type === 'LogicalExpression'
            )
            && nodeRange
        )
            layouts.binaryExpressions.push(getLayoutSpan(
                nodeRange[0],
                nodeRange[1],
                source,
            ))

        if (
            !insideCondition
            && node.type === 'ConditionalExpression'
            && nodeRange
        ) {
            const parenthesized = parent?.type === 'ParenthesizedExpression'
            const expressionRange = parenthesized ? getNodeRange(parent) : nodeRange

            if (expressionRange)
                layouts.conditionalExpressions.push(getLayoutSpan(
                    expressionRange[0],
                    expressionRange[1],
                    source,
                    parenthesized,
                ))
        }

        if (
            !insideCondition
            && node.type === 'ObjectExpression'
            && nodeRange
        )
            layouts.objects.push(getLayoutSpan(
                nodeRange[0],
                nodeRange[1],
                source,
            ))

        if (
            !insideCondition
            && isPreservedTypeNode(
                node,
                parent,
                parentKey,
            )
            && nodeRange
            && parent?.type !== 'TSTypeAnnotation'
        ) {
            let start = nodeRange[0]

            while (
                start > 0
                && isWhitespaceCharacter(source[start - 1])
            )
                start--

            layouts.types.push(getLayoutSpan(
                start,
                nodeRange[1],
                source,
            ))
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue

            const childInsideCondition = (
                insideCondition
                || (
                    key === 'test'
                    && (
                        node.type === 'ConditionalExpression'
                        || node.type === 'DoWhileStatement'
                        || node.type === 'ForStatement'
                        || node.type === 'IfStatement'
                        || node.type === 'WhileStatement'
                    )
                )
            )

            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(
                        child,
                        node,
                        parent,
                        key,
                        childInsideCondition,
                    )
            } else if (isAstNode(value))
                visit(
                    value,
                    node,
                    parent,
                    key,
                    childInsideCondition,
                )
        }
    }

    visit(parseResult.program as AstNode)

    return layouts
}

const reindentLayoutText = (
    originalSource: string,
    original: LayoutSpan,
    formattedSource: string,
    target: LayoutSpan,
    layoutType: keyof TypeScriptLayouts,
): string => {
    const originalIndentation = getLineIndentation(
        originalSource,
        original.start,
    )
    const targetIndentation = getLineIndentation(
        formattedSource,
        target.start,
    )
    const indentationDifference = targetIndentation.length - originalIndentation.length

    const lines = original.text.split('\n')

    for (let index = 1; index < lines.length; index++) {
        let line = lines[index]!

        if (indentationDifference > 0)
            line = `${' '.repeat(indentationDifference)}${line}`
        else
            line = line.slice(Math.min(
                -indentationDifference,
                line.length - line.trimStart().length,
            ))

        const trimmed = line.trimStart()

        if (trimmed.length > 0) {
            const firstCharacter = trimmed[0]!
            const alignsWithLayout = (
                ')]}>'.includes(firstCharacter)
                || (
                    layoutType === 'types'
                    && '|&'.includes(firstCharacter)
                )
            )
            const minimumIndentation = targetIndentation.length + (alignsWithLayout ? 0 : 4)
            const indentation = line.length - trimmed.length

            if (indentation < minimumIndentation)
                line = `${' '.repeat(minimumIndentation)}${trimmed}`
        }

        lines[index] = line
    }

    return lines.join('\n')
}

const preserveExpandedTypeScriptLayouts = (
    file: string,
    source: string,
    formatted: string,
): string => {
    const originalLayouts = collectTypeScriptLayouts(
        file,
        source,
    )
    const formattedLayouts = collectTypeScriptLayouts(
        file,
        formatted,
    )
    const replacements: LayoutSpan[] = []

    for (const key of Object.keys(originalLayouts) as Array<keyof TypeScriptLayouts>) {
        const originalSpans = originalLayouts[key]
        const formattedSpans = formattedLayouts[key]

        if (originalSpans.length !== formattedSpans.length)
            throw new Error(`Oxfmt changed the ${key} syntax shape in ${file}`)

        for (let index = 0; index < originalSpans.length; index++) {
            const original = originalSpans[index]!

            const shouldPreserve = (
                key === 'types'
                || original.preserve
                || (
                    key !== 'functionParameters'
                    && original.text.includes('\n')
                )
            )

            if (!shouldPreserve)
                continue

            const target = formattedSpans[index]!
            replacements.push({
                start: target.start,
                end: target.end,
                text: reindentLayoutText(
                    source,
                    original,
                    formatted,
                    target,
                    key,
                ),
            })
        }
    }

    const nonOverlappingReplacements: LayoutSpan[] = []

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.end - right.start - (left.end - left.start) || left.start - right.start)) {
        const overlapsSelectedReplacement = nonOverlappingReplacements.some((candidate) =>
            replacement.start < candidate.end && replacement.end > candidate.start)

        if (!overlapsSelectedReplacement)
            nonOverlappingReplacements.push(replacement)
    }

    let output = formatted

    for (const replacement of nonOverlappingReplacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const getDelimitedListItems = (node: AstNode): AstNode[] | null => {
    if (Array.isArray(node.params))
        return node.params.filter(isAstNode)

    if (
        (
            node.type === 'CallExpression'
            || node.type === 'NewExpression'
        )
        && Array.isArray(node.arguments)
    )
        return node.arguments.filter(isAstNode)

    return null
}

const canonicalizeDelimitedListsOnce = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const nodeRange = getNodeRange(node)
        const items = getDelimitedListItems(node)

        if (
            nodeRange
            && items
            && items.length > 1
        ) {
            const itemRanges = items.map(getNodeRange)
            const firstRange = itemRanges[0]
            const lastRange = itemRanges.at(-1)

            if (
                firstRange
                && lastRange
                && itemRanges.every((range) => range != null)
            ) {
                const start = getTrailingWhitespaceStart(
                    source,
                    nodeRange[0],
                    firstRange[0],
                )
                const trailingCommaEnd = source[lastRange[1]] === ','
                    ? lastRange[1] + 1
                    : lastRange[1]
                const end = getLeadingWhitespaceEnd(
                    source,
                    trailingCommaEnd,
                    nodeRange[1],
                )
                const hasInterItemComment = comments.some((comment) =>
                    comment.start >= start
                    && comment.end <= end
                    && !itemRanges.some((range) => range != null && comment.start >= range[0] && comment.end <= range[1]))

                if (!hasInterItemComment) {
                    const indentation = getLineIndentation(
                        source,
                        nodeRange[0],
                    )
                    const itemIndentation = `${indentation}    `
                    const itemTexts = itemRanges.map((range) => reindentNodeText(
                        source,
                        range!,
                        itemIndentation,
                    ))
                    const replacement = `\n${itemIndentation}${itemTexts.join(`,\n${itemIndentation}`)},\n${indentation}`

                    if (source.slice(
                        start,
                        end,
                    ) !== replacement) {
                        replacements.push({
                            start,
                            end,
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
    const nonOverlappingReplacements: LayoutSpan[] = []

    for (const replacement of replacements.sort((
        left,
        right,
    ) => left.end - left.start - (right.end - right.start) || right.start - left.start)) {
        const overlapsSelectedReplacement = nonOverlappingReplacements.some((candidate) =>
            replacement.start < candidate.end && replacement.end > candidate.start)

        if (!overlapsSelectedReplacement)
            nonOverlappingReplacements.push(replacement)
    }

    let output = source

    for (const replacement of nonOverlappingReplacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const canonicalizeDelimitedLists = (
    file: string,
    source: string,
): string => {
    let output = source

    for (let pass = 0; pass < 20; pass++) {
        const formatted = canonicalizeDelimitedListsOnce(
            file,
            output,
        )

        if (formatted === output)
            return output

        output = formatted
    }

    throw new Error(`Could not stabilize function parameter and argument formatting in ${file}`)
}

const isHtmlTemplateTag = (tag: AstNode | undefined): boolean => tag?.type === 'Identifier' && tag.name === 'html'
    || tag?.type === 'MemberExpression'
    && tag.computed === false
    && isAstNode(tag.property)
    && tag.property.type === 'Identifier'
    && tag.property.name === 'html'

const collectHtmlTemplateQuasis = (
    file: string,
    source: string,
): LayoutSpan[] => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const layouts: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const tag = node.tag as AstNode | undefined
        const template = node.quasi as AstNode | undefined

        if (
            node.type === 'TaggedTemplateExpression'
            && isHtmlTemplateTag(tag)
            && template?.type === 'TemplateLiteral'
            && Array.isArray(template.quasis)
        ) {
            for (const quasi of template.quasis) {
                if (!isAstNode(quasi))
                    continue

                const quasiRange = getNodeRange(quasi)

                if (quasiRange)
                    layouts.push(getLayoutSpan(
                        quasiRange[0],
                        quasiRange[1],
                        source,
                    ))
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

    return layouts
}

const reindentHtmlTemplate = (
    source: string,
    sourceLayout: LayoutSpan,
    target: string,
    targetLayout: LayoutSpan,
): string => {
    const sourceIndentation = getLineIndentation(
        source,
        sourceLayout.start,
    )
    const targetIndentation = getLineIndentation(
        target,
        targetLayout.start,
    )
    const indentationDifference = targetIndentation.length - sourceIndentation.length
    const lines = sourceLayout.text.split('\n')

    for (let index = 1; index < lines.length; index++) {
        const line = lines[index]!

        if (indentationDifference > 0)
            lines[index] = `${' '.repeat(indentationDifference)}${line}`
        else
            lines[index] = line.slice(Math.min(
                -indentationDifference,
                line.length - line.trimStart().length,
            ))
    }

    return lines.join('\n')
}

const applyHtmlTemplateFormatting = (
    file: string,
    formatted: string,
    htmlFormatted: string,
): string => {
    const formattedLayouts = collectHtmlTemplateQuasis(
        file,
        formatted,
    )
    const htmlLayouts = collectHtmlTemplateQuasis(
        file,
        htmlFormatted,
    )

    if (formattedLayouts.length !== htmlLayouts.length)
        throw new Error(`Oxfmt changed the html template syntax shape in ${file}`)

    const replacements = formattedLayouts.map((
        target,
        index,
    ) => ({
        ...target,
        text: reindentHtmlTemplate(
            htmlFormatted,
            htmlLayouts[index]!,
            formatted,
            target,
        ),
    }))
    let output = formatted

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const collectHtmlTemplateContents = (
    file: string,
    source: string,
): HtmlTemplateContent[] => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const contents: HtmlTemplateContent[] = []
    const visit = (node: AstNode): void => {
        const tag = node.tag as AstNode | undefined
        const template = node.quasi as AstNode | undefined
        const templateRange = getNodeRange(template)

        if (
            node.type === 'TaggedTemplateExpression'
            && isHtmlTemplateTag(tag)
            && template?.type === 'TemplateLiteral'
            && templateRange
            && Array.isArray(template.quasis)
        ) {
            const quasis = template.quasis.filter(isAstNode)
            const rawRanges = quasis.map((quasi): [number, number] | null => {
                const quasiRange = getNodeRange(quasi)
                const value = quasi.value
                const raw = (
                    value
                    && typeof value === 'object'
                    && 'raw' in value
                )
                    ? value.raw
                    : null

                if (
                    !quasiRange
                    || typeof raw !== 'string'
                )
                    return null

                const start = quasiRange[0] + 1

                return [start, start + raw.length]
            })

            if (rawRanges.every((range) => range != null)) {
                const interpolationRanges: Array<[number, number]> = []

                for (let index = 0; index < rawRanges.length - 1; index++) interpolationRanges.push([rawRanges[index]![1], rawRanges[index + 1]![0]])

                contents.push({
                    start: templateRange[0] + 1,
                    end: templateRange[1] - 1,
                    interpolationRanges,
                    indentation: getLineIndentation(
                        source,
                        node.range?.[0] ?? templateRange[0],
                    ),
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

    return contents
}

const maskHtmlInterpolations = (
    source: string,
    content: HtmlTemplateContent,
): string => {
    const characters: string[] = []

    for (let offset = content.start; offset < content.end; offset++) characters.push(source[offset]!)

    for (const range of content.interpolationRanges) for (let offset = range[0]; offset < range[1]; offset++) characters[offset - content.start] = 'x'

    return characters.join('')
}

const getExpandedHtmlStartTag = (
    source: string,
    startTag: HtmlAttributeLocation,
    attributes: HtmlAttributeLocation[],
    indentation: string,
): string => {
    const start = startTag.startOffset
    const end = startTag.endOffset
    const firstAttribute = attributes[0]!
    const lastAttribute = attributes.at(-1)!
    const prefixEnd = getTrailingWhitespaceStart(
        source,
        start,
        firstAttribute.startOffset,
    )
    let closingOffset = end - 2

    while (
        closingOffset > lastAttribute.endOffset
        && isWhitespaceCharacter(source[closingOffset])
    )
        closingOffset--

    const closing = source[closingOffset] === '/' ? '/>' : '>'
    const attributeIndentation = `${indentation}    `
    const attributeText = attributes.map((attribute) =>
        `${attributeIndentation}${source.slice(
            attribute.startOffset,
            attribute.endOffset,
        ).trim()}`)
        .join('\n')

    return `${source.slice(
        start,
        prefixEnd,
    )}\n${attributeText}\n${indentation}${closing}`
}

const collectExpandedHtmlStartTags = (
    source: string,
    root: HtmlNode,
    baseIndentation: string,
    offset = 0,
): LayoutSpan[] => {
    const replacements: LayoutSpan[] = []
    const visit = (
        node: HtmlNode,
        depth: number,
    ): void => {
        const startTag = node.sourceCodeLocation?.startTag
        const attributes = Object.values(node.sourceCodeLocation?.attrs ?? {})
            .sort((
                left,
                right,
            ) => left.startOffset - right.startOffset)

        if (
            startTag
            && attributes.length > 1
        ) {
            const absoluteStart = offset + startTag.startOffset
            const lineStart = getLineStart(
                source,
                absoluteStart,
            )
            const linePrefix = source.slice(
                lineStart,
                absoluteStart,
            )
            const indentation = linePrefix.trim().length === 0
                ? linePrefix
                : `${baseIndentation}${' '.repeat((depth + 1) * 4)}`
            const relativeSource = source.slice(offset)
            const replacement = getExpandedHtmlStartTag(
                relativeSource,
                startTag,
                attributes,
                indentation,
            )
            const absoluteEnd = offset + startTag.endOffset

            if (source.slice(
                absoluteStart,
                absoluteEnd,
            ) !== replacement) {
                replacements.push({
                    start: absoluteStart,
                    end: absoluteEnd,
                    text: replacement,
                })
            }
        }

        for (const child of node.childNodes ?? []) visit(
            child,
            depth + 1,
        )

        if (node.content)
            visit(
                node.content,
                depth + 1,
            )
    }

    for (const child of root.childNodes ?? []) visit(
        child,
        0,
    )

    return replacements
}

const applyHtmlAttributeReplacements = (
    source: string,
    replacements: LayoutSpan[],
): string => {
    let output = source

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const canonicalizeEmbeddedHtmlAttributes = (
    file: string,
    source: string,
): string => {
    const replacements: LayoutSpan[] = []

    for (const content of collectHtmlTemplateContents(
        file,
        source,
    )) {
        const maskedContent = maskHtmlInterpolations(
            source,
            content,
        )
        const fragment = parseFragment(
            maskedContent,
            { sourceCodeLocationInfo: true },
        ) as HtmlNode
        replacements.push(...collectExpandedHtmlStartTags(
            source,
            fragment,
            content.indentation,
            content.start,
        ))
    }

    return applyHtmlAttributeReplacements(
        source,
        replacements,
    )
}

const canonicalizeStandaloneHtmlAttributes = (source: string): string => {
    const document = parse(
        source,
        { sourceCodeLocationInfo: true },
    ) as HtmlNode

    return applyHtmlAttributeReplacements(
        source,
        collectExpandedHtmlStartTags(
            source,
            document,
            '',
        ),
    )
}

const getAssignmentValue = (node: AstNode): AstNode | null => {
    if (
        node.type === 'AssignmentExpression'
        || node.type === 'AssignmentPattern'
    )
        return isAstNode(node.right) ? node.right : null

    if (
        node.type === 'PropertyDefinition'
        || node.type === 'VariableDeclarator'
    ) {
        if (isAstNode(node.value))
            return node.value

        return isAstNode(node.init) ? node.init : null
    }

    return null
}

const canonicalizeAssignmentBoundaries = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const nodeRange = getNodeRange(node)
        const value = getAssignmentValue(node)
        const valueRange = getNodeRange(value)

        if (
            nodeRange
            && valueRange
            && !hasCommentWithinRange(
                comments,
                [nodeRange[0], valueRange[0]],
            )
        ) {
            const whitespaceStart = getTrailingWhitespaceStart(
                source,
                nodeRange[0],
                valueRange[0],
            )
            const whitespace = source.slice(
                whitespaceStart,
                valueRange[0],
            )

            if (
                whitespace !== ' '
                && whitespace.trim().length === 0
            ) {
                replacements.push({
                    start: whitespaceStart,
                    end: valueRange[0],
                    text: ' ',
                })
            }
        }

        for (const [key, childValue] of Object.entries(node)) {
            if (key === 'range')
                continue

            if (Array.isArray(childValue)) {
                for (const child of childValue) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(childValue))
                visit(childValue)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const canonicalizeExpressionArrowBodies = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

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
            const bodyText = source.slice(
                bodyRange[0],
                bodyRange[1],
            )

            if (!bodyText.includes('\n')) {
                const whitespaceStart = getTrailingWhitespaceStart(
                    source,
                    nodeRange[0],
                    bodyRange[0],
                )
                const currentWhitespace = source.slice(
                    whitespaceStart,
                    bodyRange[0],
                )

                if (currentWhitespace.trim().length === 0) {
                    const arrowLineStart = getLineStart(
                        source,
                        whitespaceStart,
                    )
                    const singleLineLength = whitespaceStart + 1 + bodyText.length - arrowLineStart
                    const indentation = `${getLineIndentation(
                        source,
                        whitespaceStart,
                    )}    `
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

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const isNestedCallChain = (
    node: AstNode,
    parent: AstNode | null,
    grandparent: AstNode | null,
): boolean => parent?.type === 'MemberExpression'
    && parent.object === node
    && grandparent?.type === 'CallExpression'
    && grandparent.callee === parent

const getCallChain = (
    node: AstNode,
    source: string,
): CallChain | null => {
    const segments: CallChainSegment[] = []
    let current = node
    let iteratorCount = 0

    while (
        current.type === 'CallExpression'
        && isAstNode(current.callee)
        && current.callee.type === 'MemberExpression'
        && current.callee.computed === false
        && isAstNode(current.callee.object)
        && isAstNode(current.callee.property)
        && current.callee.property.type === 'Identifier'
        && typeof current.callee.property.name === 'string'
    ) {
        const currentRange = getNodeRange(current)
        const objectRange = getNodeRange(current.callee.object)

        if (
            !currentRange
            || !objectRange
        )
            return null

        const isIterator = iteratorMethodNames.has(current.callee.property.name)

        if (isIterator)
            iteratorCount++

        let boundaryEnd = objectRange[1]

        while (
            boundaryEnd < currentRange[1]
            && isWhitespaceCharacter(source[boundaryEnd])
        )
            boundaryEnd++

        segments.unshift({
            boundaryEnd,
            boundaryStart: objectRange[1],
            isIterator,
            leadingWhitespace: source.slice(
                objectRange[1],
                boundaryEnd,
            ),
            text: source.slice(
                boundaryEnd,
                currentRange[1],
            ),
        })
        current = current.callee.object
    }

    if (segments.length === 0)
        return null

    return {
        base: current,
        iteratorCount,
        segments,
    }
}

const getLongestIteratorLineLength = (
    chain: CallChain,
    source: string,
    nodeStart: number,
): number => {
    const baseRange = getNodeRange(chain.base)

    if (!baseRange)
        return 0

    const parts = [source.slice(
        baseRange[0],
        baseRange[1],
    )]
    const iteratorOffsets: number[] = []
    let offset = parts[0]!.length

    for (const segment of chain.segments) {
        const leadingWhitespace = segment.isIterator ? '' : segment.leadingWhitespace
        parts.push(leadingWhitespace)
        offset += leadingWhitespace.length

        if (segment.isIterator)
            iteratorOffsets.push(offset)

        parts.push(segment.text)
        offset += segment.text.length
    }

    const inlineChain = parts.join('')
    const nodeColumn = nodeStart - getLineStart(
        source,
        nodeStart,
    )
    let longestLineLength = 0

    for (const iteratorOffset of iteratorOffsets) {
        const lineStart = inlineChain.lastIndexOf(
            '\n',
            iteratorOffset - 1,
        ) + 1
        const nextLineBreak = inlineChain.indexOf(
            '\n',
            iteratorOffset,
        )
        const lineEnd = nextLineBreak < 0 ? inlineChain.length : nextLineBreak
        const lineLength = lineEnd - lineStart + (lineStart === 0 ? nodeColumn : 0)
        longestLineLength = Math.max(
            longestLineLength,
            lineLength,
        )
    }

    return longestLineLength
}

const canonicalizeIteratorChainsOnce = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const visit = (
        node: AstNode,
        parent: AstNode | null = null,
        grandparent: AstNode | null = null,
    ): void => {
        const nodeRange = getNodeRange(node)

        if (
            node.type === 'CallExpression'
            && nodeRange
            && !isNestedCallChain(
                node,
                parent,
                grandparent,
            )
        ) {
            const chain = getCallChain(
                node,
                source,
            )

            if (
                chain
                && chain.iteratorCount > 0
                && !hasCommentWithinRange(
                    comments,
                    nodeRange,
                )
            ) {
                const indentation = `${getLineIndentation(
                    source,
                    nodeRange[0],
                )}    `
                const longestIteratorLineLength = getLongestIteratorLineLength(
                    chain,
                    source,
                    nodeRange[0],
                )
                const shouldExpand = (
                    chain.iteratorCount > 2
                    || (
                        chain.iteratorCount === 1
                        && longestIteratorLineLength > maximumInlineIteratorChainLength
                    )
                )
                const boundaryWhitespace = shouldExpand ? `\n${indentation}` : ''

                for (const segment of chain.segments) {
                    if (
                        !segment.isIterator
                        || segment.leadingWhitespace === boundaryWhitespace
                    )
                        continue

                    replacements.push({
                        start: segment.boundaryStart,
                        end: segment.boundaryEnd,
                        text: boundaryWhitespace,
                    })
                }
            }
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === 'range')
                continue

            if (Array.isArray(value)) {
                for (const child of value) if (isAstNode(child))
                    visit(
                        child,
                        node,
                        parent,
                    )
            } else if (isAstNode(value))
                visit(
                    value,
                    node,
                    parent,
                )
        }
    }

    visit(parseResult.program as AstNode)
    let output = source

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const canonicalizeIteratorChains = (
    file: string,
    source: string,
): string => {
    let output = source

    for (let pass = 0; pass < 20; pass++) {
        const formatted = canonicalizeIteratorChainsOnce(
            file,
            output,
        )

        if (formatted === output)
            return output

        output = formatted
    }

    throw new Error(`Could not stabilize iterator chain formatting in ${file}`)
}

const canonicalizeHtmlTemplateBoundaries = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

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

            while (
                leadingWhitespaceEnd < contentEnd
                && isWhitespaceCharacter(source[leadingWhitespaceEnd])
            )
                leadingWhitespaceEnd++

            while (
                trailingWhitespaceStart > leadingWhitespaceEnd
                && isWhitespaceCharacter(source[trailingWhitespaceStart - 1])
            )
                trailingWhitespaceStart--

            const indentation = getLineIndentation(
                source,
                nodeRange[0],
            )
            const isMultiline = node.loc != null
                && node.loc.start.line !== node.loc.end.line
            const inlineLength = (node.loc?.start.column ?? 0) + nodeRange[1] - nodeRange[0]
            const shouldExpand = isMultiline
                || inlineLength > maximumInlineArrowFunctionLength
            const leadingWhitespace = shouldExpand ? `\n${indentation}    ` : ''
            const trailingWhitespace = shouldExpand ? `\n${indentation}` : ''

            if (leadingWhitespaceEnd === contentEnd) {
                const whitespace = shouldExpand ? `\n${indentation}` : ''

                if (source.slice(
                    contentStart,
                    contentEnd,
                ) !== whitespace) {
                    replacements.push({
                        start: contentStart,
                        end: contentEnd,
                        text: whitespace,
                    })
                }

                return
            }

            if (source.slice(
                contentStart,
                leadingWhitespaceEnd,
            ) !== leadingWhitespace) {
                replacements.push({
                    start: contentStart,
                    end: leadingWhitespaceEnd,
                    text: leadingWhitespace,
                })
            }

            if (source.slice(
                trailingWhitespaceStart,
                contentEnd,
            ) !== trailingWhitespace) {
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

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const getConditionalExpression = (node: AstNode | null | undefined): AstNode | null => {
    let current = node

    while (
        current?.type === 'ParenthesizedExpression'
        && isAstNode(current.expression)
    )
        current = current.expression

    return current?.type === 'ConditionalExpression' ? current : null
}

const hasNestedConditionalExpression = (node: AstNode): boolean => Boolean(
    getConditionalExpression(node.test as AstNode)
    || getConditionalExpression(node.consequent as AstNode)
    || getConditionalExpression(node.alternate as AstNode),
)

const getConditionalLeafText = (
    node: AstNode,
    source: string,
): string | null => {
    const range = getNodeRange(node)

    if (!range)
        return null

    const text = source.slice(
        range[0],
        range[1],
    ).trim()

    return text || null
}

const getCanonicalConditionalText = (
    node: AstNode,
    source: string,
    operatorIndentation: string,
): string | null => {
    const test = node.test as AstNode | undefined
    const consequent = node.consequent as AstNode | undefined
    const alternate = node.alternate as AstNode | undefined

    if (
        !test
        || !consequent
        || !alternate
    )
        return null

    const nestedTest = getConditionalExpression(test)
    const nestedConsequent = getConditionalExpression(consequent)
    const nestedAlternate = getConditionalExpression(alternate)
    const nestedOperatorIndentation = `${operatorIndentation}    `
    const testText = nestedTest
        ? getCanonicalConditionalText(
            nestedTest,
            source,
            nestedOperatorIndentation,
        )
        : getConditionalLeafText(
            test,
            source,
        )
    const consequentText = nestedConsequent
        ? getCanonicalConditionalText(
            nestedConsequent,
            source,
            nestedOperatorIndentation,
        )
        : getConditionalLeafText(
            consequent,
            source,
        )
    const alternateText = nestedAlternate
        ? getCanonicalConditionalText(
            nestedAlternate,
            source,
            nestedOperatorIndentation,
        )
        : getConditionalLeafText(
            alternate,
            source,
        )

    if (
        !testText
        || !consequentText
        || !alternateText
    )
        return null

    const canonicalTest = nestedTest
        ? `(\n${nestedOperatorIndentation}${testText}\n${operatorIndentation})`
        : testText

    return `${canonicalTest}\n${operatorIndentation}? ${consequentText}\n${operatorIndentation}: ${alternateText}`
}

const canonicalizeNestedConditionalExpressions = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const nodeRange = getNodeRange(node)

        if (
            node.type === 'ConditionalExpression'
            && nodeRange
            && hasNestedConditionalExpression(node)
            && !hasCommentWithinRange(
                comments,
                nodeRange,
            )
        ) {
            const indentation = `${getLineIndentation(
                source,
                nodeRange[0],
            )}    `
            const replacement = getCanonicalConditionalText(
                node,
                source,
                indentation,
            )

            if (!replacement)
                throw new Error(`Could not format the nested conditional expression in ${file}`)

            replacements.push({
                start: nodeRange[0],
                end: nodeRange[1],
                text: replacement,
            })

            return
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

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const countLogicalEvaluations = (node: AstNode): number => {
    if (
        node.type === 'ParenthesizedExpression'
        && isAstNode(node.expression)
    )
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

    while (
        current.type === 'ParenthesizedExpression'
        && isAstNode(current.expression)
    )
        current = current.expression

    return current
}

const getAstExpressionText = (
    node: AstNode,
    source: string,
): string | null => {
    if (
        node.type === 'ParenthesizedExpression'
        && isAstNode(node.expression)
    ) {
        const expression = getAstExpressionText(
            node.expression,
            source,
        )

        return expression == null ? null : `(${expression})`
    }

    if (
        node.type === 'LogicalExpression'
        && isAstNode(node.left)
        && isAstNode(node.right)
        && typeof node.operator === 'string'
    ) {
        const left = getAstExpressionText(
            node.left,
            source,
        )
        const right = getAstExpressionText(
            node.right,
            source,
        )

        return (
            left == null
            || right == null
        )
            ? null : `${left} ${node.operator} ${right}`
    }

    const range = getNodeRange(node)

    if (!range)
        return null

    const expression = source.slice(
        range[0],
        range[1],
    ).trim()

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

    if (
        !visit(logicalExpression)
        || operators.length === 0
    )
        return null

    return { operands, operators }
}

const getFormattedConditionText = (
    node: AstNode,
    source: string,
    indentation: string,
    includeParentheses: boolean,
): string | null => {
    const logicalExpression = unwrapParenthesizedExpression(node)

    if (logicalExpression.type !== 'LogicalExpression')
        return getAstExpressionText(
            node,
            source,
        )

    const conditionParts = getLogicalConditionParts(logicalExpression)

    if (!conditionParts)
        return null

    const operandIndentation = includeParentheses ? `${indentation}    ` : indentation
    const lines: string[] = []

    for (let index = 0; index < conditionParts.operands.length; index++) {
        const operandNode = conditionParts.operands[index]!
        const operand = unwrapParenthesizedExpression(operandNode).type === 'LogicalExpression'
            ? getFormattedConditionText(
                operandNode,
                source,
                operandIndentation,
                true,
            )
            : getAstExpressionText(
                operandNode,
                source,
            )

        if (!operand)
            return null

        const operator = index === 0 ? '' : `${conditionParts.operators[index - 1]} `
        lines.push(`${operandIndentation}${operator}${operand}`)
    }

    const condition = lines.join('\n')

    return includeParentheses
        ? `(\n${condition}\n${indentation})`
        : condition
}

const getMultilineAssignedLogicalExpressionText = (
    node: AstNode,
    source: string,
    indentation: string,
): string | null => getFormattedConditionText(
    node,
    source,
    indentation,
    true,
)

const getConditionContainerText = (
    keyword: string,
    node: AstNode,
    source: string,
    indentation: string,
): string | null => {
    if (countLogicalEvaluations(node) === 1) {
        const condition = getAstExpressionText(
            node,
            source,
        )

        return condition ? `${keyword} (${condition})` : null
    }

    const conditionIndentation = `${indentation}    `
    const condition = getFormattedConditionText(
        node,
        source,
        conditionIndentation,
        false,
    )

    return condition
        ? `${keyword} (\n${condition}\n${indentation})`
        : null
}

const hasCommentWithinRange = (
    comments: AstComment[],
    range: [number, number],
): boolean => comments.some((comment) => comment.start >= range[0] && comment.end <= range[1])

const canonicalizeAssignedLogicalExpressions = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const value = getAssignmentValue(node)
        const valueRange = getNodeRange(value)

        if (
            value
            && valueRange
            && unwrapParenthesizedExpression(value).type === 'LogicalExpression'
            && countLogicalEvaluations(value) > 2
            && !hasCommentWithinRange(
                comments,
                valueRange,
            )
        ) {
            const indentation = getLineIndentation(
                source,
                valueRange[0],
            )
            const replacement = getMultilineAssignedLogicalExpressionText(
                value,
                source,
                indentation,
            )

            if (!replacement)
                throw new Error(`Could not split the assigned logical expression in ${file}`)

            if (source.slice(
                valueRange[0],
                valueRange[1],
            ) !== replacement) {
                replacements.push({
                    start: valueRange[0],
                    end: valueRange[1],
                    text: replacement,
                })

                return
            }
        }

        for (const [key, childValue] of Object.entries(node)) {
            if (key === 'range')
                continue

            if (Array.isArray(childValue)) {
                for (const child of childValue) if (isAstNode(child))
                    visit(child)
            } else if (isAstNode(childValue))
                visit(childValue)
        }
    }

    visit(parseResult.program as AstNode)
    let output = source

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const getStatementList = (node: AstNode): AstNode[] | null => {
    if (
        node.type !== 'BlockStatement'
        && node.type !== 'Program'
        && node.type !== 'StaticBlock'
        && node.type !== 'TSModuleBlock'
    ) {
        if (
            node.type !== 'SwitchCase'
            || !Array.isArray(node.consequent)
        )
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
        if (!source.slice(
            gapStart,
            comment.start,
        ).includes('\n')) {
            gapStart = comment.end

            continue
        }

        if (source.slice(
            gapStart,
            comment.start,
        ).trim().length > 0)
            return null

        return [gapStart, comment.start]
    }

    if (source.slice(
        gapStart,
        nextStart,
    ).trim().length > 0)
        return null

    return [gapStart, nextStart]
}

const canonicalizeStatementSpacing = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = (parseResult.comments as AstComment[]).toSorted((
        left,
        right,
    ) => left.start - right.start)
    const replacements: LayoutSpan[] = []
    const visit = (node: AstNode): void => {
        const statements = getStatementList(node)

        if (statements) {
            for (let index = 1; index < statements.length; index++) {
                const previous = statements[index - 1]!
                const current = statements[index]!

                if (
                    !separatedBlockStatementTypes.has(previous.type)
                    && !separatedBlockStatementTypes.has(current.type)
                    && !separatedControlFlowStatementTypes.has(current.type)
                )
                    continue

                const previousRange = getNodeRange(previous)
                const currentRange = getNodeRange(current)

                if (
                    !previousRange
                    || !currentRange
                )
                    continue

                const gap = getStatementGap(
                    source,
                    comments,
                    previousRange[1],
                    currentRange[0],
                )

                if (!gap)
                    continue

                const replacement = `\n\n${getLineIndentation(
                    source,
                    gap[1],
                )}`

                if (source.slice(
                    gap[0],
                    gap[1],
                ) === replacement)
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

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const canonicalizeConditionStatements = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const comments = parseResult.comments as AstComment[]
    const replacements: LayoutSpan[] = []
    const addConditionedStatementHeader = (
        node: AstNode,
        test: AstNode,
        body: AstNode,
        keyword: string,
        compactBody: boolean,
    ): void => {
        const nodeRange = getNodeRange(node)
        const bodyRange = getNodeRange(body)

        if (
            !nodeRange
            || !bodyRange
            || hasCommentWithinRange(
                comments,
                [nodeRange[0], bodyRange[0]],
            )
        )
            return

        const indentation = getLineIndentation(
            source,
            nodeRange[0],
        )
        const header = getConditionContainerText(
            keyword,
            test,
            source,
            indentation,
        )

        if (!header)
            throw new Error(`Could not format the ${keyword} condition in ${file}`)

        const bodySeparator = compactBody ? `\n${indentation}    ` : ' '
        const replacement = `${header}${bodySeparator}`

        if (source.slice(
            nodeRange[0],
            bodyRange[0],
        ) === replacement)
            return

        replacements.push({
            start: nodeRange[0],
            end: bodyRange[0],
            text: replacement,
        })
    }

    const visit = (node: AstNode): void => {
        if (node.type === 'IfStatement') {
            const nodeRange = getNodeRange(node)
            const consequent = node.consequent as AstNode | undefined
            const alternate = node.alternate as AstNode | null | undefined
            const consequentRange = getNodeRange(consequent)
            const alternateRange = getNodeRange(alternate)
            const test = node.test as AstNode | undefined
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
                test
                && consequent
            )
                addConditionedStatementHeader(
                    node,
                    test,
                    consequent,
                    'if',
                    consequentIsCompact,
                )

            if (
                nodeRange
                && alternate
                && alternateRange
                && consequent
                && consequentRange
                && !hasCommentWithinRange(
                    comments,
                    [consequentRange[1], alternateRange[0]],
                )
                && (
                    consequentIsCompact
                    || alternateIsCompact
                )
            ) {
                const indentation = getLineIndentation(
                    source,
                    nodeRange[0],
                )
                const beforeElse = consequentIsCompact ? `\n${indentation}` : ' '
                const afterElse = alternateIsCompact ? `\n${indentation}    ` : ' '
                const replacement = `${beforeElse}else${afterElse}`

                if (source.slice(
                    consequentRange[1],
                    alternateRange[0],
                ) !== replacement) {
                    replacements.push({
                        start: consequentRange[1],
                        end: alternateRange[0],
                        text: replacement,
                    })
                }
            }
        } else if (node.type === 'WhileStatement') {
            const test = node.test as AstNode | undefined
            const body = node.body as AstNode | undefined

            if (
                test
                && body
            )
                addConditionedStatementHeader(
                    node,
                    test,
                    body,
                    'while',
                    body.type !== 'BlockStatement',
                )
        } else if (node.type === 'DoWhileStatement') {
            const nodeRange = getNodeRange(node)
            const test = node.test as AstNode | undefined
            const body = node.body as AstNode | undefined
            const bodyRange = getNodeRange(body)

            if (
                nodeRange
                && test
                && bodyRange
                && !hasCommentWithinRange(
                    comments,
                    [bodyRange[1], nodeRange[1]],
                )
            ) {
                const indentation = getLineIndentation(
                    source,
                    nodeRange[0],
                )
                const condition = getConditionContainerText(
                    'while',
                    test,
                    source,
                    indentation,
                )

                if (!condition)
                    throw new Error(`Could not format the do...while condition in ${file}`)

                const replacement = ` ${condition}`

                if (source.slice(
                    bodyRange[1],
                    nodeRange[1],
                ) !== replacement) {
                    replacements.push({
                        start: bodyRange[1],
                        end: nodeRange[1],
                        text: replacement,
                    })
                }
            }
        } else if (node.type === 'ForStatement') {
            const nodeRange = getNodeRange(node)
            const test = node.test as AstNode | null | undefined
            const body = node.body as AstNode | undefined
            const bodyRange = getNodeRange(body)

            if (
                nodeRange
                && test
                && countLogicalEvaluations(test) > 1
                && body
                && bodyRange
                && !hasCommentWithinRange(
                    comments,
                    [nodeRange[0], bodyRange[0]],
                )
            ) {
                const indentation = getLineIndentation(
                    source,
                    nodeRange[0],
                )
                const clauseIndentation = `${indentation}    `
                const condition = getFormattedConditionText(
                    test,
                    source,
                    clauseIndentation,
                    false,
                )
                const initializer = isAstNode(node.init) ? getAstExpressionText(
                    node.init,
                    source,
                ) : ''
                const update = isAstNode(node.update) ? getAstExpressionText(
                    node.update,
                    source,
                ) : ''

                if (
                    !condition
                    || initializer == null
                    || update == null
                )
                    throw new Error(`Could not format the for condition in ${file}`)

                const clauses = [
                    `for (`,
                    `${clauseIndentation}${initializer};`,
                    `${condition};`,
                ]

                if (update)
                    clauses.push(`${clauseIndentation}${update}`)

                clauses.push(`${indentation})${body.type === 'BlockStatement' ? ' ' : `\n${clauseIndentation}`}`)
                const replacement = clauses.join('\n')

                if (source.slice(
                    nodeRange[0],
                    bodyRange[0],
                ) !== replacement) {
                    replacements.push({
                        start: nodeRange[0],
                        end: bodyRange[0],
                        text: replacement,
                    })
                }
            }
        } else if (node.type === 'ConditionalExpression') {
            const test = node.test as AstNode | undefined
            const consequent = node.consequent as AstNode | undefined
            const testRange = getNodeRange(test)
            const consequentRange = getNodeRange(consequent)

            if (
                test
                && testRange
                && consequentRange
                && countLogicalEvaluations(test) > 1
                && !hasCommentWithinRange(
                    comments,
                    [testRange[0], consequentRange[0]],
                )
            ) {
                const indentation = getLineIndentation(
                    source,
                    testRange[0],
                )
                const condition = getFormattedConditionText(
                    test,
                    source,
                    indentation,
                    true,
                )

                if (!condition)
                    throw new Error(`Could not format the ternary condition in ${file}`)

                const conditionReplacement = `${condition}\n${indentation}    ? `

                if (source.slice(
                    testRange[0],
                    consequentRange[0],
                ) !== conditionReplacement) {
                    replacements.push({
                        start: testRange[0],
                        end: consequentRange[0],
                        text: conditionReplacement,
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
    const nonOverlappingReplacements: LayoutSpan[] = []

    for (const replacement of replacements.sort((
        left,
        right,
    ) => right.end - right.start - (left.end - left.start) || left.start - right.start)) {
        const overlapsSelectedReplacement = nonOverlappingReplacements.some((candidate) =>
            replacement.start < candidate.end && replacement.end > candidate.start)

        if (!overlapsSelectedReplacement)
            nonOverlappingReplacements.push(replacement)
    }

    let output = source

    for (const replacement of nonOverlappingReplacements.sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const getIndentedContainerChildren = (node: AstNode): AstNode[] | null => {
    if (node.type === 'Program')
        return Array.isArray(node.body) ? node.body.filter(isAstNode) : null

    if (
        node.type === 'BlockStatement'
        || node.type === 'ClassBody'
        || node.type === 'StaticBlock'
        || node.type === 'TSInterfaceBody'
        || node.type === 'TSModuleBlock'
    )
        return Array.isArray(node.body) ? node.body.filter(isAstNode) : null

    if (node.type === 'SwitchStatement')
        return Array.isArray(node.cases) ? node.cases.filter(isAstNode) : null

    if (node.type === 'SwitchCase')
        return Array.isArray(node.consequent) ? node.consequent.filter(isAstNode) : null

    if (
        node.type === 'ObjectExpression'
        || node.type === 'ObjectPattern'
    )
        return Array.isArray(node.properties) ? node.properties.filter(isAstNode) : null

    if (
        node.type === 'ArrayExpression'
        || node.type === 'ArrayPattern'
    )
        return Array.isArray(node.elements) ? node.elements.filter(isAstNode) : null

    if (node.type === 'TSTypeLiteral')
        return Array.isArray(node.members) ? node.members.filter(isAstNode) : null

    return null
}

const getIndentedContainerClosingOffset = (
    node: AstNode,
    source: string,
): number | null => {
    if (
        node.type === 'Program'
        || node.type === 'SwitchCase'
    )
        return null

    const nodeRange = getNodeRange(node)

    if (!nodeRange)
        return null

    let end = nodeRange[1]

    if (
        node.type === 'ObjectPattern'
        || node.type === 'ArrayPattern'
    ) {
        const typeAnnotationRange = getNodeRange(node.typeAnnotation as AstNode)

        if (typeAnnotationRange)
            end = typeAnnotationRange[0]
    }

    const closingOffset = getTrailingWhitespaceStart(
        source,
        nodeRange[0],
        end,
    ) - 1
    const expectedCharacter = (
        node.type === 'ArrayExpression'
        || node.type === 'ArrayPattern'
    )
        ? ']' : '}'

    return source[closingOffset] === expectedCharacter ? closingOffset : null
}

const canonicalizeContainerIndentationOnce = (
    file: string,
    source: string,
): string => {
    const parseResult = parseSync(
        file,
        source,
        {
            astType: 'ts',
            preserveParens: true,
            range: true,
        },
    )

    if (parseResult.errors.length > 0)
        throw new Error(`Oxc parser could not parse ${file}: ${JSON.stringify(parseResult.errors[0])}`)

    const replacementsByRange = new Map<
        string,
        LayoutSpan,
    >()
    const addIndentationReplacement = (
        offset: number,
        indentation: string,
        containerStart: number,
    ): void => {
        const lineStart = getLineStart(
            source,
            offset,
        )

        if (lineStart === getLineStart(
            source,
            containerStart,
        ))
            return

        const currentIndentation = source.slice(
            lineStart,
            offset,
        )

        if ([...currentIndentation].some((character) => character !== ' ' && character !== '\t'))
            return

        if (currentIndentation === indentation)
            return

        const key = `${lineStart}:${offset}`
        const existing = replacementsByRange.get(key)

        if (
            existing
            && existing.text !== indentation
        )
            throw new Error(`Conflicting indentation rules in ${file}`)

        replacementsByRange.set(
            key,
            {
                start: lineStart,
                end: offset,
                text: indentation,
            },
        )
    }

    const visit = (node: AstNode): void => {
        const nodeRange = getNodeRange(node)
        const children = getIndentedContainerChildren(node)

        if (
            nodeRange
            && children
        ) {
            const indentation = node.type === 'Program'
                ? ''
                : `${getLineIndentation(
                    source,
                    nodeRange[0],
                )}    `

            for (const child of children) {
                const childRange = getNodeRange(child)

                if (childRange)
                    addIndentationReplacement(
                        childRange[0],
                        indentation,
                        nodeRange[0],
                    )
            }

            const closingOffset = getIndentedContainerClosingOffset(
                node,
                source,
            )

            if (closingOffset != null)
                addIndentationReplacement(
                    closingOffset,
                    getLineIndentation(
                        source,
                        nodeRange[0],
                    ),
                    nodeRange[0],
                )
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

    for (const replacement of [...replacementsByRange.values()].sort((
        left,
        right,
    ) => right.start - left.start)) output = `${output.slice(
        0,
        replacement.start,
    )}${replacement.text}${output.slice(replacement.end)}`

    return output
}

const canonicalizeContainerIndentation = (
    file: string,
    source: string,
): string => {
    let output = source

    for (let pass = 0; pass < 20; pass++) {
        const formatted = canonicalizeContainerIndentationOnce(
            file,
            output,
        )

        if (formatted === output)
            return output

        output = formatted
    }

    throw new Error(`Could not stabilize container indentation in ${file}`)
}

const canonicalizeTypeScriptLayout = (
    file: string,
    source: string,
    htmlFormatted: string,
): string => {
    let output = source

    for (let pass = 0; pass < 20; pass++) {
        const indented = canonicalizeContainerIndentation(
            file,
            output,
        )
        const canonicalDelimitedLists = canonicalizeDelimitedLists(
            file,
            indented,
        )
        const canonicalConditionStatements = canonicalizeConditionStatements(
            file,
            canonicalDelimitedLists,
        )
        const canonicalAssignmentBoundaries = canonicalizeAssignmentBoundaries(
            file,
            canonicalConditionStatements,
        )
        const canonicalAssignedLogicalExpressions = canonicalizeAssignedLogicalExpressions(
            file,
            canonicalAssignmentBoundaries,
        )
        const canonicalArrowBodies = canonicalizeExpressionArrowBodies(
            file,
            canonicalAssignedLogicalExpressions,
        )
        const canonicalIteratorChains = canonicalizeIteratorChains(
            file,
            canonicalArrowBodies,
        )
        const canonicalConditionalExpressions = canonicalizeNestedConditionalExpressions(
            file,
            canonicalIteratorChains,
        )
        const formattedHtmlTemplates = applyHtmlTemplateFormatting(
            file,
            canonicalConditionalExpressions,
            htmlFormatted,
        )
        const canonicalHtmlAttributes = canonicalizeEmbeddedHtmlAttributes(
            file,
            formattedHtmlTemplates,
        )
        const canonicalHtmlTemplates = canonicalizeHtmlTemplateBoundaries(
            file,
            canonicalHtmlAttributes,
        )
        const canonicalStatementSpacing = canonicalizeStatementSpacing(
            file,
            canonicalHtmlTemplates,
        )
        const canonicalImports = canonicalizeImportLayout(
            canonicalStatementSpacing,
            true,
            file,
        ).output
        const formatted = canonicalizeContainerIndentation(
            file,
            canonicalImports,
        )

        if (formatted === output)
            return output

        output = formatted
    }

    throw new Error(`Could not stabilize TypeScript formatting in ${file}`)
}

const formatSource = async (
    file: string,
    source: string,
    config: FormatConfig,
): Promise<string> => {
    const result = await format(
        file,
        source,
        config,
    )

    if (result.errors.length > 0) {
        for (const error of result.errors) {
            err(`${file}: ${error.message}`)

            if (error.codeframe)
                err(error.codeframe)
        }

        throw new Error(`Oxfmt could not format ${file}`)
    }

    if (!file.endsWith('.ts'))
        return canonicalizeStandaloneHtmlAttributes(result.code)

    const htmlResult = await format(
        file,
        source,
        {
            ...config,
            printWidth: maximumInlineArrowFunctionLength,
        },
    )

    if (htmlResult.errors.length > 0)
        throw new Error(`Oxfmt could not format embedded HTML in ${file}`)

    const formattedConditionStatements = canonicalizeConditionStatements(
        file,
        result.code,
    )
    const preserved = preserveExpandedTypeScriptLayouts(
        file,
        source,
        formattedConditionStatements,
    )

    return canonicalizeTypeScriptLayout(
        file,
        preserved,
        htmlResult.code,
    )
}

const describeFirstFormattingDifference = (
    file: string,
    source: string,
    formatted: string,
): void => {
    let offset = 0

    while (
        offset < source.length
        && offset < formatted.length
        && source[offset] === formatted[offset]
    )
        offset++

    const line = source.slice(
        0,
        offset,
    ).split('\n').length
    const contextStart = Math.max(
        0,
        source.lastIndexOf(
            '\n',
            offset - 1,
        ) + 1,
    )
    const sourceContextEnd = source.indexOf(
        '\n',
        offset,
    )
    const formattedContextEnd = formatted.indexOf(
        '\n',
        offset,
    )
    err(`${file}:${line}: formatting differs`)
    err(`current: ${JSON.stringify(source.slice(
        contextStart,
        sourceContextEnd < 0 ? source.length : sourceContextEnd,
    ))}`)
    err(`expected: ${JSON.stringify(formatted.slice(
        contextStart,
        formattedContextEnd < 0 ? formatted.length : formattedContextEnd,
    ))}`)
}

const [mode, ...inputPaths] = process.argv.slice(2)

if (
    (
        mode !== 'check'
        && mode !== 'fix'
    )
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
    const source = await readFile(
        file,
        'utf8',
    )
    const formatted = await formatSource(
        file,
        source,
        formatConfig,
    )

    if (formatted === source)
        continue

    changedFileCount++

    if (mode === 'fix')
        await writeFile(
            file,
            formatted,
        )
    else
        describeFirstFormattingDifference(
            file,
            source,
            formatted,
        )
}

if (mode === 'fix') {
    if (changedFileCount > 0)
        log(`Formatted ${changedFileCount} TypeScript and HTML file(s).`)
} else if (changedFileCount > 0) {
    err(`Found ${changedFileCount} TypeScript and HTML formatting violation(s).`)
    process.exit(1)
}
