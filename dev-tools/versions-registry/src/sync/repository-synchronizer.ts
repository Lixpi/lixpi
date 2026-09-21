import {
    type RepositoryFiles,
} from '../shared/repository-files.ts'
import {
    type VersionCatalog,
} from '../shared/version-catalog.ts'
import { synchronizeDockerCompose } from './docker-compose-synchronizer.ts'
import { synchronizeDockerfile } from './dockerfile-synchronizer.ts'
import { synchronizeGithubActions } from './github-actions-synchronizer.ts'
import { synchronizeGoModule } from './go-module-synchronizer.ts'
import { synchronizePackageJson } from './package-json-synchronizer.ts'

const synchronizeFile = (
    path: string,
    source: string,
    catalog: VersionCatalog,
): string => {
    if (path.endsWith('package.json'))
        return synchronizePackageJson(
            path,
            source,
            catalog,
        )

    if (path.endsWith('go.mod'))
        return synchronizeGoModule(
            path,
            source,
            catalog,
        )

    if (/(?:^|\/)[^/]*[Dd]ockerfile[^/]*$/.test(path))
        return synchronizeDockerfile(
            path,
            source,
            catalog,
        )

    if (/^docker-compose[^/]*\.ya?ml$/.test(path))
        return synchronizeDockerCompose(
            path,
            source,
            catalog,
        )

    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path))
        return synchronizeGithubActions(
            path,
            source,
            catalog,
        )

    throw new Error(`No version synchronizer handles ${path}`)
}

export const planRepositorySynchronization = (
    files: RepositoryFiles,
    catalog: VersionCatalog,
): Map<string, string> => {
    const changes = new Map<string, string>()

    for (const path of files.discoverNativeConsumerPaths()) {
        const source = files.readRepositoryFile(path)
        const synchronized = synchronizeFile(
            path,
            source,
            catalog,
        )

        if (synchronized !== source)
            changes.set(path, synchronized)
    }

    return changes
}

export const writeRepositoryChanges = (
    files: RepositoryFiles,
    changes: Map<string, string>,
): void => {
    for (const [path, source] of changes)
        files.writeRepositoryFile(path, source)
}
