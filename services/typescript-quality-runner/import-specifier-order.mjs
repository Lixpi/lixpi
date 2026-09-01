import {
    readFile,
    readdir,
    stat,
    writeFile,
} from 'node:fs/promises'
import {
    resolve,
} from 'node:path'

const ignoredDirectoryNames = new Set(['coverage', 'dist', 'node_modules', 'packages-vendor'])
const multilineImportPattern = /^(import(?:\s+[\w$]+,)?\s*)\{\r?\n([\s\S]*?)(^\}\s+from\s+['"][^'"]+['"][^\n]*$)/gm
const inlineImportPattern = /^(import(?:\s+[\w$]+,)?\s*)\{\s*([^{}\n]+?)\s*\}(\s+from\s+['"][^'"]+['"][^\n]*$)/gm
const specifierPattern = /^\s*(type\s+)?(?:[\w$]+|['"][^'"]+['"])(?:\s+as\s+[\w$]+)?\s*,?\s*(?:\/\/.*)?$/

async function collectTypeScriptFiles(inputPaths) {
    const files = []
    const prohibitedFiles = []

    async function visit(path) {
        const entry = await stat(path)
        if (entry.isFile()) {
            if (path.endsWith('.tsx') || path.endsWith('.jsx')) prohibitedFiles.push(path)
            else if (path.endsWith('.ts')) files.push(path)
            return
        }
        if (!entry.isDirectory()) return

        const entries = await readdir(path, { withFileTypes: true })
        for (const child of entries) {
            if (child.isDirectory() && ignoredDirectoryNames.has(child.name)) continue
            await visit(resolve(path, child.name))
        }
    }

    for (const inputPath of inputPaths) await visit(resolve(inputPath))
    return {
        files: files.sort(),
        prohibitedFiles: prohibitedFiles.sort(),
    }
}

function parseMultilineSpecifierEntries(body) {
    const lines = body.split('\n')
    const entries = []
    let pendingLines = []

    for (const line of lines) {
        const specifier = line.match(specifierPattern)
        if (!specifier) {
            pendingLines.push(line)
            continue
        }

        entries.push({
            isType: Boolean(specifier[1]),
            lines: [...pendingLines, line],
            text: line.trim().replace(/,$/, ''),
        })
        pendingLines = []
    }

    return { entries, trailingLines: pendingLines }
}

function applyReplacements(source, replacements) {
    if (replacements.length === 0) return source

    let output = ''
    let cursor = 0
    for (const replacement of replacements) {
        output += source.slice(cursor, replacement.start)
        output += replacement.value
        cursor = replacement.end
    }
    return output + source.slice(cursor)
}

function canonicalizeMultilineImports(source, fix) {
    const violations = []
    const replacements = []

    for (const match of source.matchAll(multilineImportPattern)) {
        const [fullMatch, header, body, closing] = match
        const { entries, trailingLines } = parseMultilineSpecifierEntries(body)
        if (entries.length === 0) continue

        const values = entries.filter(entry => !entry.isType)
        const types = entries.filter(entry => entry.isType)
        let canonical = fullMatch

        if (
            entries.length === 1
            && values.length === 1
            && values[0].lines.length === 1
            && trailingLines.every(line => line.length === 0)
        ) {
            canonical = `${header}{ ${values[0].text} ${closing}`
        } else {
            const orderedEntries = [...values, ...types]
            const orderedBody = [
                ...orderedEntries.flatMap(entry => entry.lines),
                ...trailingLines,
            ].join('\n')
            canonical = `${header}{\n${orderedBody}${closing}`
        }

        if (canonical === fullMatch) continue
        violations.push(source.slice(0, match.index).split('\n').length)
        if (fix) {
            replacements.push({
                end: match.index + fullMatch.length,
                start: match.index,
                value: canonical,
            })
        }
    }

    return {
        output: fix ? applyReplacements(source, replacements) : source,
        violations,
    }
}

function canonicalizeInlineImports(source, fix) {
    const violations = []
    const replacements = []

    for (const match of source.matchAll(inlineImportPattern)) {
        const [fullMatch, header, body, suffix] = match
        const specifiers = body.split(',').map(specifier => specifier.trim()).filter(Boolean)
        if (specifiers.length === 0) continue

        const values = specifiers.filter(specifier => !specifier.startsWith('type '))
        const types = specifiers.filter(specifier => specifier.startsWith('type '))
        const orderedSpecifiers = [...values, ...types]
        const canonical = specifiers.length === 1 && values.length === 1
            ? `${header}{ ${values[0]} }${suffix}`
            : `${header}{\n${orderedSpecifiers.map(specifier => `    ${specifier},`).join('\n')}\n}${suffix}`

        if (canonical === fullMatch) continue
        violations.push(source.slice(0, match.index).split('\n').length)
        if (fix) {
            replacements.push({
                end: match.index + fullMatch.length,
                start: match.index,
                value: canonical,
            })
        }
    }

    return {
        output: fix ? applyReplacements(source, replacements) : source,
        violations,
    }
}

function processSource(source, fix) {
    const multilineResult = canonicalizeMultilineImports(source, fix)
    const inlineResult = canonicalizeInlineImports(multilineResult.output, fix)
    return {
        output: inlineResult.output,
        violations: [...multilineResult.violations, ...inlineResult.violations],
    }
}

const [mode, ...inputPaths] = process.argv.slice(2)
if ((mode !== 'check' && mode !== 'fix') || inputPaths.length === 0) {
    console.error('Usage: import-specifier-order.mjs {check|fix} <path...>')
    process.exit(1)
}

const { files, prohibitedFiles } = await collectTypeScriptFiles(inputPaths)
if (prohibitedFiles.length > 0) {
    for (const file of prohibitedFiles) console.error(`${file}: JSX source files are prohibited; use a .ts module and the repository DOM APIs`)
    process.exit(1)
}

let violationCount = 0
let fixedFileCount = 0

for (const file of files) {
    const source = await readFile(file, 'utf8')
    const { output, violations } = processSource(source, mode === 'fix')
    violationCount += violations.length

    if (mode === 'fix' && output !== source) {
        await writeFile(file, output)
        fixedFileCount++
        continue
    }

    if (mode === 'check') {
        for (const line of violations) {
            console.error(`${file}:${line}: named imports must use the repository value/type layout`)
        }
    }
}

if (mode === 'fix') {
    if (fixedFileCount > 0) console.log(`Fixed named import layout in ${fixedFileCount} files.`)
    process.exit(0)
}

if (violationCount > 0) {
    console.error(`Found ${violationCount} named import layout violation(s).`)
    process.exit(1)
}
