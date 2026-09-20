import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'

const dependencyFieldNames = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'overrides',
    'resolutions',
] as const

const unmanagedDependencyPrefixes = [
    'workspace:',
    'file:',
    'link:',
]

export const synchronizePackageJson = (
    path: string,
    source: string,
    catalog: VersionCatalog,
): string => {
    const manifest = JSON.parse(source) as Record<string, unknown>

    for (const fieldName of dependencyFieldNames) {
        const dependencies = manifest[fieldName]

        if (dependencies === undefined)
            continue

        if (
            !dependencies
            || typeof dependencies !== 'object'
            || Array.isArray(dependencies)
        )
            throw new Error(`Unsupported dependency collection: ${path}#${fieldName}`)

        const dependencyVersions = dependencies as Record<string, unknown>

        for (const [name, currentVersion] of Object.entries(dependencyVersions)) {
            if (typeof currentVersion !== 'string')
                throw new Error(`Unsupported dependency declaration: ${path}#${fieldName}.${name}`)

            if (unmanagedDependencyPrefixes.some(prefix => currentVersion.startsWith(prefix)))
                continue

            const selectedVersion = catalog.npmPackageVersion(name)
                ?? catalog.workspacePackageVersion(name)

            if (!selectedVersion)
                throw new Error(`Register ${name} before synchronizing ${path}#${fieldName}`)

            dependencyVersions[name] = selectedVersion
        }
    }

    if (typeof manifest.version === 'string') {
        const packageName = manifest.name

        if (typeof packageName !== 'string')
            throw new Error(`A versioned package needs a name: ${path}`)

        const selectedVersion = catalog.workspacePackageVersion(packageName)

        if (!selectedVersion)
            throw new Error(`Register workspace package ${packageName} before synchronizing ${path}`)

        manifest.version = selectedVersion
    }

    if (typeof manifest.packageManager === 'string') {
        if (!manifest.packageManager.startsWith('pnpm@'))
            throw new Error(`Register the package manager used by ${path}`)

        manifest.packageManager = `pnpm@${catalog.data.typescript.pnpm}`
    }

    const indentation = source.match(/\n([\t ]+)"/)?.[1] ?? '    '

    return `${JSON.stringify(
        manifest,
        null,
        indentation,
    )}\n`
}
