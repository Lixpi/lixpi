import {
    type RepositoryFiles,
} from '../shared/repository-files.ts'
import {
    type ToolVersions,
    type VersionCatalogData,
} from '../shared/version-catalog.ts'
import {
    type ResolvedDependencyRelease,
} from './latest-release-resolver.ts'

const templateReferencePattern = /^\{\{([^{}|]+)\}\}$/

const setReferenceValue = (
    data: VersionCatalogData,
    reference: string,
    version: string,
): void => {
    const keys = reference.split('.')
    const propertyName = keys.pop()
    let parent: unknown = data

    if (!propertyName)
        throw new Error(`Invalid writable catalog reference: ${reference}`)

    for (const key of keys) {
        if (
            !parent
            || typeof parent !== 'object'
            || !Object.hasOwn(parent, key)
        )
            throw new Error(`Unknown writable catalog reference: ${reference}`)

        parent = (parent as Record<string, unknown>)[key]
    }

    if (
        !parent
        || typeof parent !== 'object'
        || typeof (parent as Record<string, unknown>)[propertyName] !== 'string'
    )
        throw new Error(`Catalog reference is not a writable version: ${reference}`)

    const record = parent as Record<string, unknown>
    record[propertyName] = version
}

const setNpmPackageVersion = (
    data: VersionCatalogData,
    name: string,
    version: string,
): void => {
    const configuredValue = data.typescript.npmPackages[name]

    if (typeof configuredValue !== 'string')
        throw new Error(`Unknown npm package: ${name}`)

    const reference = configuredValue.match(templateReferencePattern)?.[1]

    if (reference)
        setReferenceValue(
            data,
            reference,
            version,
        )
    else
        data.typescript.npmPackages[name] = version
}

export const applyReleaseToCatalog = (
    data: VersionCatalogData,
    release: ResolvedDependencyRelease,
): void => {
    const {
        group,
        name,
        latestVersion,
    } = release

    if (group === 'npmPackages') {
        setNpmPackageVersion(
            data,
            name,
            latestVersion,
        )

        return
    }

    if (group === 'goModules') {
        data.go.modules[name] = latestVersion

        return
    }

    if (group === 'packageManagers') {
        if (name !== 'pnpm')
            throw new Error(`Unknown package manager: ${name}`)

        data.typescript.pnpm = latestVersion

        return
    }

    if (group === 'runtimes') {
        if (name === 'node')
            data.typescript.node = latestVersion
        else if (name === 'go')
            data.go.go = latestVersion
        else
            throw new Error(`Unknown runtime: ${name}`)

        return
    }

    if (group === 'tools') {
        if (!Object.hasOwn(data.tools, name))
            throw new Error(`Unknown tool: ${name}`)

        data.tools[name as keyof ToolVersions] = latestVersion

        return
    }

    if (group === 'goTools') {
        if (!Object.hasOwn(data.go.tools, name))
            throw new Error(`Unknown Go tool: ${name}`)

        data.go.tools[name as keyof typeof data.go.tools] = latestVersion

        return
    }

    if (group === 'containerImages') {
        data.containerImages[name] = latestVersion

        return
    }

    data.githubActions[name] = latestVersion
}

export const writeVersionCatalogs = (
    files: RepositoryFiles,
    data: VersionCatalogData,
): void => {
    files.writeRegistryJson('versions/typescript.json', data.typescript)
    files.writeRegistryJson('versions/go.json', data.go)
    files.writeRegistryJson('versions/tools.json', data.tools)
    files.writeRegistryJson('versions/container-images.json', data.containerImages)
    files.writeRegistryJson('versions/github-actions.json', data.githubActions)
}
