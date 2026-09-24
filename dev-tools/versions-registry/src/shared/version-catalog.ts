import {
    type RepositoryFiles,
} from './repository-files.ts'

export type TypeScriptVersions = {
    node: string
    pnpm: string
    npmPackages: Record<string, string>
    workspacePackages: Record<string, string>
}

export type GoVersions = {
    go: string
    modules: Record<string, string>
    tools: Record<string, string>
}

export type ToolVersions = Record<string, string>

export type VersionCatalogData = {
    typescript: TypeScriptVersions
    go: GoVersions
    tools: ToolVersions
    containerImages: Record<string, string>
    githubActions: Record<string, string>
}

type DockerBuildArguments = {
    containerImages: Record<string, string>
    typescript: Record<string, string>
    go: Record<string, string>
    tools: Record<string, string>
}

export class VersionCatalog {
    readonly data: VersionCatalogData
    private readonly dockerBuildArguments: Record<string, string> = {}

    constructor(
        files: RepositoryFiles,
        data?: VersionCatalogData,
    ) {
        this.data = data ?? {
            typescript: files.readRegistryJson<TypeScriptVersions>('versions/typescript.json'),
            go: files.readRegistryJson<GoVersions>('versions/go.json'),
            tools: files.readRegistryJson<ToolVersions>('versions/tools.json'),
            containerImages: files.readRegistryJson<Record<string, string>>('versions/container-images.json'),
            githubActions: files.readRegistryJson<Record<string, string>>('versions/github-actions.json'),
        }
        const argumentGroups = files.readRegistryJson<DockerBuildArguments>('consumers/docker-build-arguments.json')

        this.registerDockerBuildArguments(
            'containerImages',
            argumentGroups.containerImages,
            repository => this.containerImageReference(repository),
        )
        this.registerDockerBuildArguments(
            'typescript',
            argumentGroups.typescript,
            reference => this.resolveReference(`typescript.${reference}`),
        )
        this.registerDockerBuildArguments(
            'go',
            argumentGroups.go,
            reference => this.resolveReference(`go.${reference}`),
        )
        this.registerDockerBuildArguments(
            'tools',
            argumentGroups.tools,
            reference => this.resolveReference(`tools.${reference}`),
        )
    }

    private registerDockerBuildArguments(
        groupName: string,
        argumentReferences: Record<string, string>,
        resolveValue: (reference: string) => string,
    ): void {
        for (const [argumentName, reference] of Object.entries(argumentReferences)) {
            if (Object.hasOwn(this.dockerBuildArguments, argumentName))
                throw new Error(`Docker build argument ${argumentName} is repeated in ${groupName}`)

            this.dockerBuildArguments[argumentName] = resolveValue(reference)
        }
    }

    resolveReference(
        reference: string,
        ancestors: string[] = [],
    ): string {
        if (ancestors.includes(reference))
            throw new Error(`Circular version reference: ${[...ancestors, reference].join(' -> ')}`)

        const [path, transform] = reference.split('|')
        let value: unknown = this.data

        for (const key of path.split('.')) {
            if (
                !value
                || typeof value !== 'object'
                || !Object.hasOwn(value, key)
            )
                throw new Error(`Unknown version reference: ${reference}`)

            value = (value as Record<string, unknown>)[key]
        }

        if (
            typeof value !== 'string'
            || !value
            || /[\r\n]/.test(value)
        )
            throw new Error(`Version reference must resolve to one nonempty line: ${reference}`)

        const resolved = this.resolveTemplate(value, [...ancestors, reference])

        if (transform === 'major')
            return resolved.split('.')[0]

        if (transform)
            throw new Error(`Unknown version transform: ${transform}`)

        return resolved
    }

    resolveTemplate(
        template: string,
        ancestors: string[] = [],
    ): string {
        return template.replace(/\{\{([^{}]+)\}\}/g, (_match, reference: string) => this.resolveReference(reference, ancestors))
    }

    npmPackageVersion(name: string): string | undefined {
        const selected = this.data.typescript.npmPackages[name]

        return selected ? this.resolveTemplate(selected) : undefined
    }

    workspacePackageVersion(name: string): string | undefined {
        return this.data.typescript.workspacePackages[name]
    }

    dockerBuildArgumentValues(): Record<string, string> {
        return { ...this.dockerBuildArguments }
    }

    containerImageReference(repository: string): string {
        const tagTemplate = this.data.containerImages[repository]

        if (
            !tagTemplate
            || /[\r\n]/.test(tagTemplate)
        )
            throw new Error(`Register container image repository ${repository}`)

        return `${repository}:${this.resolveTemplate(tagTemplate)}`
    }

    resolvedContainerImages(): Record<string, string> {
        return Object.fromEntries(
            Object.keys(this.data.containerImages).map(
                repository => [
                    repository,
                    this.containerImageReference(repository),
                ],
            ),
        )
    }
}
