import {
    type DependencyCoordinate,
} from './dependency-selector.ts'
import {
    type ReleaseClient,
} from './release-client.ts'
import {
    type GithubReleaseSource,
} from './release-notes.ts'

export type ReleaseNotesSource =
    | {
        kind: 'nodeChangelog'
    }
    | {
        kind: 'github'
        github: GithubReleaseSource
    }
    | {
        kind: 'unavailable'
        sourceUrl?: string
        message: string
    }

const githubRepository = (url: string): string | undefined => {
    const normalized = url
        .replace(/^git\+/, '')
        .replace(/^github:/, 'https://github.com/')
    const match = normalized.match(/github\.com[/:]([^/]+)\/([^/#]+)/)

    if (!match)
        return undefined

    return `${match[1]}/${match[2].replace(/\.git$/, '')}`
}

const githubSourceForGoModule = (moduleName: string): GithubReleaseSource | undefined => {
    const parts = moduleName.split('/')

    if (
        parts[0] !== 'github.com'
        || parts.length < 3
    )
        return undefined

    const subpath = parts.slice(3)

    if (/^v\d+$/.test(subpath.at(-1) ?? ''))
        subpath.pop()

    return {
        repository: `${parts[1]}/${parts[2]}`,
        tagPrefixes: [subpath.length ? `${subpath.join('/')}/` : ''],
    }
}

const unique = (values: string[]): string[] => [...new Set(values)]

export class ReleaseNotesSourceResolver {
    private readonly client: ReleaseClient

    constructor(client: ReleaseClient) {
        this.client = client
    }

    async resolve(coordinate: DependencyCoordinate): Promise<ReleaseNotesSource> {
        const {
            group,
            name,
        } = coordinate

        if (group === 'npmPackages')
            return this.npmPackage(name)

        if (group === 'goModules') {
            const source = githubSourceForGoModule(name)

            return source
                ? {
                    kind: 'github',
                    github: source,
                }
                : {
                    kind: 'unavailable',
                    sourceUrl: `https://pkg.go.dev/${name}`,
                    message: `The Go module path ${name} does not identify a GitHub repository with machine-readable release notes.`,
                }
        }

        if (group === 'packageManagers')
            return this.github('pnpm/pnpm')

        if (group === 'runtimes')
            return name === 'node'
                ? { kind: 'nodeChangelog' }
                : this.github('golang/go', ['go'])

        if (group === 'tools') {
            const repositories = {
                fnm: 'Schniz/fnm',
                nex: 'synadia-io/nex',
                pulumi: 'pulumi/pulumi',
            } as const
            const repository = repositories[name as keyof typeof repositories]

            return repository
                ? this.github(repository)
                : this.unavailable(`No release-note source is registered for tool ${name}.`)
        }

        if (group === 'goTools') {
            const repositories = {
                gopls: 'golang/tools',
                dlv: 'go-delve/delve',
                'golangci-lint': 'golangci/golangci-lint',
            } as const
            const repository = repositories[name as keyof typeof repositories]

            return repository
                ? this.github(repository, name === 'gopls' ? ['gopls/'] : [''])
                : this.unavailable(`No release-note source is registered for Go tool ${name}.`)
        }

        if (group === 'containerImages')
            return this.containerImage(name)

        return this.github(name)
    }

    private github(
        repository: string,
        tagPrefixes: string[] = [''],
    ): ReleaseNotesSource {
        return {
            kind: 'github',
            github: {
                repository,
                tagPrefixes,
            },
        }
    }

    private unavailable(
        message: string,
        sourceUrl?: string,
    ): ReleaseNotesSource {
        return {
            kind: 'unavailable',
            sourceUrl,
            message,
        }
    }

    private async npmPackage(name: string): Promise<ReleaseNotesSource> {
        const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
        const data = await this.client.fetchJson(registryUrl)

        if (
            !data
            || typeof data !== 'object'
        )
            throw new Error(`Expected npm release metadata for ${name}`)

        const repositoryField = (data as Record<string, unknown>).repository
        let repositoryUrl: string | undefined
        let repositoryDirectory: string | undefined

        if (typeof repositoryField === 'string')
            repositoryUrl = repositoryField
        else if (
            repositoryField
            && typeof repositoryField === 'object'
        ) {
            const repositoryRecord = repositoryField as Record<string, unknown>

            if (typeof repositoryRecord.url === 'string')
                repositoryUrl = repositoryRecord.url

            if (typeof repositoryRecord.directory === 'string')
                repositoryDirectory = repositoryRecord.directory
        }

        const repository = repositoryUrl ? githubRepository(repositoryUrl) : undefined

        if (!repository)
            return this.unavailable(
                `The npm package ${name} does not publish a GitHub repository that can provide release notes.`,
                `https://www.npmjs.com/package/${name}`,
            )

        const unscopedName = name.split('/').at(-1) ?? name

        return this.github(
            repository,
            unique([
                `${name}@`,
                `${unscopedName}@`,
                ...(repositoryDirectory ? [] : ['']),
            ]),
        )
    }

    private containerImage(repository: string): ReleaseNotesSource {
        const repositories: Record<string, string> = {
            'public.ecr.aws/primaassicurazioni/localauth0': 'primait/localauth0',
            'aaronshaf/dynamodb-admin': 'aaronshaf/dynamodb-admin',
            'natsio/nats-box': 'nats-io/nats-box',
        }
        const github = repositories[repository]

        if (github)
            return this.github(github)

        return this.unavailable(
            `The container repository ${repository} does not publish machine-readable release notes for each tag.`,
            `https://hub.docker.com/r/${repository}/tags`,
        )
    }
}
