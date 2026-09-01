import {
    readFile,
    readdir,
    rename,
    stat,
    writeFile,
} from 'node:fs/promises'
import {
    dirname,
    extname,
    resolve,
} from 'node:path'
import {
    err,
    log,
} from '@lixpi/debug-tools'

const repositoryDirectory = '/usr/src/repository'
const ignoredDirectoryNames = new Set([
    'coverage',
    'dist',
    'node_modules',
    'packages-vendor',
])
const javaScriptExtensions = new Set([
    '.cjs',
    '.js',
    '.mjs',
])
const prohibitedExtensions = new Set([
    '.jsx',
    '.tsx',
])
const testFilePattern = /(?:\.(?:spec|test)\.ts$|\/(?:__tests__|mocks|test|tests|testUtils)\/)/
const moduleSpecifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g

type SourceFiles = {
    importers: string[]
    javaScriptFiles: string[]
    prohibitedFiles: string[]
}

const collectSourceFiles = async (inputPaths: string[]): Promise<SourceFiles> => {
    const importers: string[] = []
    const javaScriptFiles: string[] = []
    const prohibitedFiles: string[] = []

    const visit = async (path: string): Promise<void> => {
        const entry = await stat(path)
        if (entry.isFile()) {
            const extension = extname(path)
            if (prohibitedExtensions.has(extension))
                prohibitedFiles.push(path)
            else if (javaScriptExtensions.has(extension)) {
                javaScriptFiles.push(path)
                importers.push(path)
            } else if (extension === '.ts' && !testFilePattern.test(path))
                importers.push(path)
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
        importers: importers.sort(),
        javaScriptFiles: javaScriptFiles.sort(),
        prohibitedFiles: prohibitedFiles.sort(),
    }
}

const getTypeScriptPath = (path: string): string => `${path.slice(0, -extname(path).length)}.ts`

const resolveModuleSpecifier = (importer: string, specifier: string): string | null => {
    if (specifier.startsWith('./') || specifier.startsWith('../'))
        return resolve(dirname(importer), specifier)
    if (specifier.startsWith('$src/'))
        return resolve(repositoryDirectory, 'services/web-ui/src', specifier.slice('$src/'.length))
    return null
}

const updateModuleSpecifiers = async (importer: string, renamedFiles: Map<string, string>): Promise<boolean> => {
    const source = await readFile(importer, 'utf8')
    const output = source.replace(moduleSpecifierPattern, (match, quote: string, specifier: string) => {
        const resolvedSpecifier = resolveModuleSpecifier(importer, specifier)
        if (!resolvedSpecifier)
            return match
        const target = renamedFiles.get(resolvedSpecifier)
        if (!target)
            return match
        return match.replace(`${quote}${specifier}${quote}`, `${quote}${specifier.slice(0, -extname(specifier).length)}.ts${quote}`)
    })

    if (output === source)
        return false
    await writeFile(importer, output)
    return true
}

const [mode, ...inputPaths] = process.argv.slice(2)
if (
    mode !== 'check'
    && mode !== 'fix'
    || inputPaths.length === 0
) {
    err('Usage: source-extension-runner.ts {check|fix} <path...>')
    process.exit(1)
}

const {
    importers,
    javaScriptFiles,
    prohibitedFiles,
} = await collectSourceFiles(inputPaths)

if (prohibitedFiles.length > 0) {
    for (const file of prohibitedFiles) err(`${file}: JSX source files are prohibited; use a .ts module and the repository DOM APIs`)
    process.exit(1)
}

if (mode === 'check') {
    if (javaScriptFiles.length === 0)
        process.exit(0)
    for (const file of javaScriptFiles) err(`${file}: JavaScript source files are prohibited; use a .ts extension`)
    process.exit(1)
}

const renamedFiles = new Map(javaScriptFiles.map((file) => [file, getTypeScriptPath(file)]))
for (const target of renamedFiles.values()) {
    try {
        await stat(target)
        err(`${target}: cannot migrate JavaScript source because the TypeScript target already exists`)
        process.exit(1)
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
            throw error
    }
}

for (const [source, target] of renamedFiles) await rename(source, target)

let updatedImporterCount = 0
for (const originalImporter of importers) {
    const importer = renamedFiles.get(originalImporter) ?? originalImporter
    if (await updateModuleSpecifiers(importer, renamedFiles))
        updatedImporterCount++
}

if (renamedFiles.size > 0)
    log(`Migrated ${renamedFiles.size} JavaScript source file(s) to TypeScript and updated ${updatedImporterCount} importer(s).`)
