import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'
import {
    type AvailableDependencies,
    type DependencyCoordinate,
} from './dependency-selector.ts'
import {
    type ReleaseClient,
} from './release-client.ts'

export type ResolvedDependencyRelease = DependencyCoordinate & {
    currentVersion: string
    latestVersion: string
}

const stringField = (
    data: unknown,
    fieldName: string,
): string => {
    if (
        !data
        || typeof data !== 'object'
    )
        throw new Error(`Expected release metadata with ${fieldName}`)

    const value = (data as Record<string, unknown>)[fieldName]

    if (typeof value !== 'string')
        throw new Error(`Expected string release field ${fieldName}`)

    return value
}

const escapedGoModuleName = (name: string): string => name.replace(/[A-Z]/g, letter => `!${letter.toLowerCase()}`)

const githubReleaseVersion = (data: unknown): string => stringField(data, 'tag_name')

const stripVersionPrefix = (version: string): string => version.replace(/^v/, '')

type SemanticVersionTag = {
    name: string
    major: number
    minor: number
    patch: number
}

const semanticVersionTag = (name: string): SemanticVersionTag | undefined => {
    const match = name.match(/^v?(\d+)\.(\d+)\.(\d+)$/)

    if (!match)
        return undefined

    return {
        name,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    }
}

const compareSemanticVersionTags = (
    left: SemanticVersionTag,
    right: SemanticVersionTag,
): number => right.major - left.major
    || right.minor - left.minor
    || right.patch - left.patch

export class LatestReleaseResolver {
    private readonly catalog: VersionCatalog
    private readonly releases: ReleaseClient

    constructor(
        catalog: VersionCatalog,
        releases: ReleaseClient,
    ) {
        this.catalog = catalog
        this.releases = releases
    }

    availableDependencies(): AvailableDependencies {
        const data = this.catalog.data

        return {
            npmPackages: Object.keys(data.typescript.npmPackages),
            goModules: Object.keys(data.go.modules),
            packageManagers: ['pnpm'],
            runtimes: [
                'node',
                'go',
            ],
            tools: Object.keys(data.tools),
            goTools: Object.keys(data.go.tools),
            containerImages: Object.entries(data.containerImages).flatMap(([repository, tag]) => tag.includes('{{') ? [] : [repository]),
            githubActions: Object.keys(data.githubActions),
        }
    }

    currentVersion(coordinate: DependencyCoordinate): string {
        const {
            group,
            name,
        } = coordinate
        const data = this.catalog.data

        if (group === 'npmPackages') {
            const version = this.catalog.npmPackageVersion(name)

            if (!version)
                throw new Error(`Unknown npm package: ${name}`)

            return version
        }

        if (group === 'goModules')
            return data.go.modules[name]

        if (group === 'packageManagers')
            return data.typescript.pnpm

        if (group === 'runtimes')
            return name === 'node' ? data.typescript.node : data.go.go

        if (group === 'tools')
            return data.tools[name as keyof typeof data.tools]

        if (group === 'goTools')
            return data.go.tools[name as keyof typeof data.go.tools]

        if (group === 'containerImages')
            return data.containerImages[name]

        return data.githubActions[name]
    }

    async resolve(coordinate: DependencyCoordinate): Promise<ResolvedDependencyRelease> {
        const latestVersion = await this.latestVersion(coordinate)

        return {
            ...coordinate,
            currentVersion: this.currentVersion(coordinate),
            latestVersion,
        }
    }

    private async latestVersion(coordinate: DependencyCoordinate): Promise<string> {
        const {
            group,
            name,
        } = coordinate

        if (group === 'npmPackages')
            return this.npmPackage(name)

        if (group === 'goModules')
            return this.goModule(name)

        if (group === 'packageManagers')
            return this.pnpm()

        if (group === 'runtimes')
            return name === 'node' ? this.node() : this.go()

        if (group === 'tools')
            return this.tool(name)

        if (group === 'goTools')
            return this.goTool(name)

        if (group === 'containerImages')
            return this.containerImage(name)

        return this.githubAction(name)
    }

    private npmPackage(name: string): Promise<string> {
        return this.releases.releaseVersion(
            'npmPackages',
            name,
            `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
            data => stringField(data, 'version'),
        )
    }

    private goModule(name: string): Promise<string> {
        return this.releases.releaseVersion(
            'goModules',
            name,
            `https://proxy.golang.org/${escapedGoModuleName(name)}/@latest`,
            data => stringField(data, 'Version'),
        )
    }

    private pnpm(): Promise<string> {
        return this.releases.releaseVersion(
            'packageManagers',
            'pnpm',
            'https://registry.npmjs.org/pnpm/latest',
            data => stringField(data, 'version'),
        )
    }

    private async node(): Promise<string> {
        const url = 'https://nodejs.org/dist/index.json'
        const data = await this.releases.fetchJson(url)

        if (!Array.isArray(data))
            throw new Error(`Expected Node.js release list from ${url}`)

        const version = data.map(release => stringField(release, 'version')).find(candidate => /^v\d+\.\d+\.\d+$/.test(candidate))

        if (!version)
            throw new Error(`No stable Node.js release in ${url}`)

        const normalizedVersion = version.slice(1)
        this.releases.recordRelease(
            'runtimes',
            'node',
            normalizedVersion,
            url,
        )

        return normalizedVersion
    }

    private go(): Promise<string> {
        return this.releases.releaseVersion(
            'runtimes',
            'go',
            'https://go.dev/dl/?mode=json',
            data => {
                if (!Array.isArray(data))
                    throw new Error('Expected Go release list')

                const stableRelease = data.find(
                    release => release
                        && typeof release === 'object'
                        && (release as Record<string, unknown>).stable === true,
                )

                return stringField(stableRelease, 'version')
            },
            version => version.replace(/^go/, ''),
        )
    }

    private tool(name: string): Promise<string> {
        if (name === 'fnm')
            return this.githubTool(name, 'Schniz/fnm')

        if (name === 'nex')
            return this.githubTool(name, 'synadia-io/nex')

        if (name === 'pulumi')
            return this.releases.releaseVersion(
                'tools',
                name,
                'https://registry.npmjs.org/%40pulumi%2Fpulumi/latest',
                data => stringField(data, 'version'),
            )

        throw new Error(`No latest-release resolver for tool ${name}`)
    }

    private githubTool(
        name: string,
        repository: string,
    ): Promise<string> {
        return this.releases.releaseVersion(
            'tools',
            name,
            `https://api.github.com/repos/${repository}/releases/latest`,
            githubReleaseVersion,
            stripVersionPrefix,
        )
    }

    private goTool(name: string): Promise<string> {
        if (name === 'gopls')
            return this.releases.releaseVersion(
                'goTools',
                name,
                'https://proxy.golang.org/golang.org/x/tools/gopls/@latest',
                data => stringField(data, 'Version'),
            )

        const repositories: Record<string, string> = {
            dlv: 'go-delve/delve',
            'golangci-lint': 'golangci/golangci-lint',
        }
        const repository = repositories[name]

        if (!repository)
            throw new Error(`No latest-release resolver for Go tool ${name}`)

        return this.releases.releaseVersion(
            'goTools',
            name,
            `https://api.github.com/repos/${repository}/releases/latest`,
            githubReleaseVersion,
        )
    }

    private async containerImage(repository: string): Promise<string> {
        if (repository === 'alpine')
            return this.alpine()

        if (repository === 'public.ecr.aws/primaassicurazioni/localauth0') {
            return this.releases.releaseVersion(
                'containerImages',
                repository,
                'https://api.github.com/repos/primait/localauth0/releases/latest',
                githubReleaseVersion,
                stripVersionPrefix,
            )
        }

        return this.dockerHubImage(repository)
    }

    private async alpine(): Promise<string> {
        const url = 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/latest-releases.yaml'
        const data = await this.releases.fetchText(url)
        const version = data.match(/version:\s*(\d+\.\d+\.\d+)/)?.[1]

        if (!version)
            throw new Error(`No stable Alpine release in ${url}`)

        this.releases.recordRelease(
            'containerImages',
            'alpine',
            version,
            url,
        )

        return version
    }

    private async dockerHubImage(repository: string): Promise<string> {
        const sourceUrl = `https://hub.docker.com/v2/repositories/${repository}/tags?page_size=100`
        let nextUrl: string | undefined = sourceUrl
        const tags: SemanticVersionTag[] = []
        let pageCount = 0

        while (nextUrl) {
            pageCount++

            if (pageCount > 100)
                throw new Error(`Docker Hub tag pagination exceeded 100 pages for ${repository}`)

            const data = await this.releases.fetchJson(nextUrl)

            if (
                !data
                || typeof data !== 'object'
            )
                throw new Error(`Expected Docker Hub tag metadata for ${repository}`)

            const record = data as Record<string, unknown>

            if (!Array.isArray(record.results))
                throw new Error(`Expected Docker Hub tag results for ${repository}`)

            for (const result of record.results) {
                if (
                    !result
                    || typeof result !== 'object'
                )
                    continue

                const name = (result as Record<string, unknown>).name
                const tag = typeof name === 'string' ? semanticVersionTag(name) : undefined

                if (tag)
                    tags.push(tag)
            }

            if (
                record.next !== null
                && record.next !== undefined
                && typeof record.next !== 'string'
            )
                throw new Error(`Expected Docker Hub next-page URL for ${repository}`)

            nextUrl = typeof record.next === 'string' ? record.next : undefined
        }

        const latest = tags.sort(compareSemanticVersionTags)[0]

        if (!latest)
            throw new Error(`No stable semantic-version tag for ${repository}`)

        this.releases.recordRelease(
            'containerImages',
            repository,
            latest.name,
            sourceUrl,
        )

        return latest.name
    }

    private githubAction(name: string): Promise<string> {
        return this.releases.releaseVersion(
            'githubActions',
            name,
            `https://api.github.com/repos/${name}/releases/latest`,
            githubReleaseVersion,
        )
    }
}
