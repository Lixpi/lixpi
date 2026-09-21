import {
    existsSync,
    readFileSync,
    readdirSync,
    realpathSync,
    writeFileSync,
} from 'node:fs'
import {
    dirname,
    isAbsolute,
    relative,
    resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

const ignoredDirectoryNames = new Set([
    '.agents',
    '.cache',
    '.claude',
    '.codex',
    '.cursor',
    '.git',
    '.next',
    '.pnpm-store',
    '.venv',
    '__fixtures__',
    'build',
    'dist',
    'fixtures',
    'node_modules',
    'target',
    'testdata',
    'venv',
    'versions-registry',
])

export class RepositoryFiles {
    readonly registryRoot = resolve(
        dirname(
            fileURLToPath(import.meta.url),
        ),
        '../..',
    )
    readonly repositoryRoot = resolve(this.registryRoot, '../..')

    private absoluteFrom(
        root: string,
        path: string,
    ): string {
        const absolute = resolve(root, path)

        if (
            isAbsolute(path)
            || relative(root, absolute).startsWith('..')
        )
            throw new Error(`Path is outside its allowed root: ${path}`)

        if (
            existsSync(absolute)
            && realpathSync(absolute) !== absolute
        )
            throw new Error(`Version registry paths must not be symlinks: ${path}`)

        return absolute
    }

    repositoryPath(path: string): string {
        return this.absoluteFrom(this.repositoryRoot, path)
    }

    registryPath(path: string): string {
        return this.absoluteFrom(this.registryRoot, path)
    }

    readRepositoryFile(path: string): string {
        return readFileSync(
            this.repositoryPath(path),
            'utf8',
        )
    }

    readRegistryJson<T>(path: string): T {
        return JSON.parse(
            readFileSync(
                this.registryPath(path),
                'utf8',
            ),
        ) as T
    }

    writeRepositoryFile(
        path: string,
        source: string,
    ): void {
        writeFileSync(
            this.repositoryPath(path),
            source,
        )
    }

    writeRegistryJson(
        path: string,
        value: unknown,
    ): void {
        writeFileSync(
            this.registryPath(path),
            `${JSON.stringify(
                value,
                null,
                4,
            )}\n`,
        )
    }

    discoverNativeConsumerPaths(directory = '.'): string[] {
        const paths: string[] = []

        for (const entry of readdirSync(
            this.repositoryPath(directory),
            { withFileTypes: true },
        )) {
            if (ignoredDirectoryNames.has(entry.name))
                continue

            const path = directory === '.' ? entry.name : `${directory}/${entry.name}`

            if (entry.isDirectory())
                paths.push(...this.discoverNativeConsumerPaths(path))
            else if (
                entry.isFile()
                && this.isNativeConsumer(path)
            )
                paths.push(path)
        }

        return paths
    }

    private isNativeConsumer(path: string): boolean {
        return /(?:^|\/)(?:package\.json|go\.mod|[^/]*[Dd]ockerfile[^/]*)$/.test(path)
            || /^docker-compose[^/]*\.ya?ml$/.test(path)
            || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
    }
}
