import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'

export const synchronizeGithubActions = (
    path: string,
    source: string,
    catalog: VersionCatalog,
): string =>
    source.split('\n').map((line, lineIndex) => {
        const declaration = line.match(/^(\s*uses:\s*)([^\s@]+)@(\S+)(\s*(?:#.*)?)$/)

        if (!declaration)
            return line

        const [, prefix, action, , suffix] = declaration

        if (
            action.startsWith('./')
            || action.startsWith('docker://')
        )
            return line

        const selectedVersion = catalog.data.githubActions[action]

        if (!selectedVersion)
            throw new Error(`Register GitHub Action ${action} used by ${path}:${lineIndex + 1}`)

        return `${prefix}${action}@${selectedVersion}${suffix}`
    }).join('\n')
