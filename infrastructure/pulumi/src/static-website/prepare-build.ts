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
            {
                directory: 'canvas-engine',
                manifest: 'package.json',
            },
            {
                directory: 'canvas-components',
                manifest: 'package.json',
            },
            {
                directory: 'capability-system',
                manifest: 'package.json',
            },
            {
                directory: 'prosemirror',
                manifest: 'package.json',
            },
            {
                directory: 'constants',
                manifest: 'ts/package.json',
            },
            {
                directory: 'debug-tools',
                manifest: 'ts/package.json',
            },
            {
                directory: 'ui-kit',
                manifest: 'package.json',
            },
            {
                directory: 'themes',
                manifest: 'package.json',
            },
            {
                directory: 'ui-primitives',
                manifest: 'package.json',
            },
            {
                directory: 'web-client-service-factory',
                manifest: 'package.json',
            },
            {
                directory: 'test-utils',
                manifest: 'package.json',
            },
        ]

        for (const file of [...files, ...directories]) {
            if (!existsSync(
                join(this.source, file),
            ))
                throw new Error(`Missing website build input: ${file}`)
        }

        for (const {
            directory,
            manifest,
        } of packages) {
            if (!existsSync(
                join(
                    this.lixpiSource,
                    'packages',
                    'lixpi',
                    directory,
                    manifest,
                ),
            ))
                throw new Error(`Missing shared website package: ${directory}`)
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

        for (const { directory } of packages) {
            const target = join(
                this.destination,
                '.lixpi',
                'packages',
                directory,
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
                    directory,
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
