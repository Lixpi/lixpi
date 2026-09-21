import { RepositoryFiles } from '../shared/repository-files.ts'
import { VersionCatalog } from '../shared/version-catalog.ts'
import {
    planRepositorySynchronization,
    writeRepositoryChanges,
} from './repository-synchronizer.ts'

type Command = 'check' | 'sync'

const run = (command: Command): void => {
    const files = new RepositoryFiles()
    const catalog = new VersionCatalog(files)
    const changes = planRepositorySynchronization(files, catalog)

    if (command === 'check') {
        if (changes.size)
            throw new Error(`Generated version declarations are stale:\n${[...changes.keys()].map(path => `  ${path}`).join('\n')}`)

        process.stdout.write('Version declarations match the registry.\n')

        return
    }

    writeRepositoryChanges(files, changes)
    process.stdout.write(`Synchronized ${changes.size} native files.\n`)
}

try {
    const command = process.argv[2]

    if (
        command !== 'check'
        && command !== 'sync'
    )
        throw new Error('Usage: command.ts <check|sync>')

    run(command)
} catch (error) {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
}
