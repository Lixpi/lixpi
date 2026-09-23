import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { envLiteral } from './repository/environment-file.ts'

const workspacePath = '/workspace'
const repositoryConfigPath = '/usr/src/config-utils/repository'
const envLixpiTemplatePath = path.join(
    repositoryConfigPath,
    'templates',
    'env.lixpi.template',
)
const envLixpiPath = path.join(workspacePath, 'env.lixpi')
const setupPath = path.join(repositoryConfigPath, 'setup-env.ts')

const requireRegularFile = (filename: string): void => {
    let file: fs.Stats

    try {
        file = fs.lstatSync(filename)
    } catch {
        throw new Error(`Required configuration runner file is missing: ${filename}`)
    }

    if (!file.isFile())
        throw new Error(`Configuration runner path must be a regular file: ${filename}`)
}

const renderTemplate = (template: string): string => {
    const rendered = template.replaceAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/gu, (_placeholder, name: string) => envLiteral(process.env[name]!))

    const unresolved = rendered.match(/\{\{[^{}]+\}\}/u)

    if (unresolved)
        throw new Error(`Unresolved env.lixpi template placeholder: ${unresolved[0]}`)

    return rendered.endsWith('\n') ? rendered : `${rendered}\n`
}

const writeEnvLixpi = (): void => {
    requireRegularFile(envLixpiTemplatePath)

    if (fs.existsSync(envLixpiPath)) {
        const file = fs.lstatSync(envLixpiPath)

        if (!file.isFile())
            throw new Error(`${envLixpiPath} must be a regular file`)
    }

    const content = renderTemplate(
        fs.readFileSync(envLixpiTemplatePath, 'utf8'),
    )
    fs.writeFileSync(
        envLixpiPath,
        content,
        { mode: 0o600 },
    )
    fs.chmodSync(envLixpiPath, 0o600)
}

const main = (): void => {
    writeEnvLixpi()
    requireRegularFile(setupPath)

    const setup = spawnSync(
        process.execPath,
        [
            '--experimental-transform-types',
            setupPath,
            ...process.argv.slice(2),
        ],
        { stdio: 'inherit' },
    )

    if (setup.error)
        throw setup.error

    process.exit(setup.status ?? 1)
}

try {
    main()
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    process.stderr.write(`Configuration setup failed: ${message}\n`)
    process.exit(1)
}
