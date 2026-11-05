import * as fs from 'node:fs'
import * as path from 'node:path'

// Regular files, or links to them, named `.env.*` in the directory.
export const listEnvironmentFiles = (directory: string): string[] =>
    fs.readdirSync(directory).filter(name => name.startsWith('.env.')).filter(
        name => fs.statSync(
            path.join(directory, name),
            { throwIfNoEntry: false },
        )?.isFile(),
    )
        .sort()
