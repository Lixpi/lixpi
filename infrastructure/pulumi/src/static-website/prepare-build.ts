import {
    cpSync,
    existsSync,
    mkdirSync,
    rmSync,
} from 'node:fs'
import {
    join,
    resolve,
} from 'node:path'
import { info } from '@lixpi/debug-tools'

class StaticWebsiteBuild {
    private readonly source = process.env.WEBSITE_SOURCE_DIRECTORY
    private readonly lixpiSource = process.env.LIXPI_SOURCE_DIRECTORY
    private readonly destination = '/usr/src/website'

    prepare(): void {
        if (
            !this.source
            || !this.lixpiSource
        )
            throw new Error('WEBSITE_SOURCE_DIRECTORY and LIXPI_SOURCE_DIRECTORY are required')

        if (resolve(this.source) === this.destination)
            throw new Error('The website source must be separate from the isolated build directory')

        const files = [
            'package.json',
            'pnpm-lock.yaml',
            'pnpm-workspace.yaml',
            'index.html',
            'vite.config.ts',
            'tsconfig.json',
            'vitest.config.ts',
        ]
        const directories = [
            'src',
            'public',
        ]
        const packages = [
            'ui-kit',
            'ui-primitives',
            'web-client-service-factory',
            'test-utils',
        ]

        for (const file of [...files, ...directories]) {
            if (!existsSync(
                join(this.source, file),
            ))
                throw new Error(`Missing website build input: ${file}`)
        }

        for (const name of packages) {
            if (!existsSync(
                join(
                    this.lixpiSource,
                    'packages',
                    'lixpi',
                    name,
                    'package.json',
                ),
            ))
                throw new Error(`Missing shared website package: ${name}`)
        }

        mkdirSync(this.destination, { recursive: true })

        for (const file of files)
            cpSync(
                join(this.source, file),
                join(this.destination, file),
            )

        for (const directory of directories) {
            const target = join(this.destination, directory)
            rmSync(
                target,
                {
                    recursive: true,
                    force: true,
                },
            )
            cpSync(
                join(this.source, directory),
                target,
                { recursive: true },
            )
        }

        for (const name of packages) {
            const target = join(
                this.destination,
                '.lixpi',
                'packages',
                name,
            )
            rmSync(
                target,
                {
                    recursive: true,
                    force: true,
                },
            )
            cpSync(
                join(
                    this.lixpiSource,
                    'packages',
                    'lixpi',
                    name,
                ),
                target,
                {
                    recursive: true,
                    filter: source => !source.split('/').includes('node_modules'),
                },
            )
        }

        info('Website build', 'Prepared source and shared packages in the isolated build directory')
    }
}

new StaticWebsiteBuild().prepare()
