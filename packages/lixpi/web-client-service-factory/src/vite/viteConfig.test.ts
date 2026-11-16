// @vitest-environment node

import {
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createServer } from 'vite'

import { createWebClientViteConfig } from './viteConfig.ts'

const source = `
export const applicationIsReady = true

if (import.meta.env.VITE_CLIENT_PERFORMANCE_DEBUG === 'true') {
    void import('./reporter.ts')
    performance.mark('test:client-performance')
}
`

// =============================================================================
// CLIENT PERFORMANCE GATE
// =============================================================================

describe('Vite client performance gate', () => {
    afterEach(() => void vi.unstubAllEnvs())

    it.each([
        {
            flag: 'false',
            included: false,
        },
        {
            flag: 'true',
            included: true,
        },
    ])('includes diagnostic code in served modules when the flag is $flag', async ({
        flag,
        included,
    }) => {
        vi.stubEnv(
            'VITE_CLIENT_PERFORMANCE_DEBUG',
            flag,
        )
        const root = await mkdtemp(path.join(
            tmpdir(),
            'lixpi-client-performance-',
        ))

        try {
            await Promise.all([
                writeFile(
                    path.join(
                        root,
                        'main.ts',
                    ),
                    source,
                ),
                writeFile(
                    path.join(
                        root,
                        'reporter.ts',
                    ),
                    'export const reporter = true',
                ),
            ])
            const server = await createServer(createWebClientViteConfig({
                overrides: {
                    root,
                    configFile: false,
                    optimizeDeps: { noDiscovery: true },
                    server: {
                        middlewareMode: true,
                        watch: null,
                        ws: false,
                    },
                },
            }))

            try {
                const result = await server.transformRequest('/main.ts')
                const code = result?.code ?? ''

                expect(code).toContain('applicationIsReady')
                expect(code.includes('/reporter.ts')).toBe(included)
                expect(code.includes('test:client-performance')).toBe(included)
            } finally {
                await server.close()
            }
        } finally {
            await rm(
                root,
                {
                    recursive: true,
                    force: true,
                },
            )
        }
    })
})
