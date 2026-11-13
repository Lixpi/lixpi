import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
    defineConfig,
    mergeConfig,
    type Plugin,
    type UserConfig,
} from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'

import { CLIENT_PERFORMANCE_EVENT } from '../application/clientPerformanceReport.ts'

export type WebClientViteConfig = {
    overrides?: UserConfig
    sourceRoot?: string
    workspacePackages?: string[]
}

// The environment flag that turns development client profiling on, for both
// the page and this log.
export const CLIENT_PERFORMANCE_DEBUG_VARIABLE = 'VITE_CLIENT_PERFORMANCE_DEBUG'

// Writes the performance entries a development page reports over the dev
// server's own socket to the server log, where they can be read without
// opening the page's developer tools. Only the dev server includes it, and
// only while client profiling is on.
const clientPerformanceLog = (): Plugin => ({
    name: 'lixpi-client-performance-log',
    apply: 'serve',
    configureServer(server) {
        server.ws.on(
            CLIENT_PERFORMANCE_EVENT,
            (entries: unknown) => void server.config.logger.info(`[client-performance] ${JSON.stringify(entries)}`),
        )
    },
})

export const createWebClientViteConfig = (config: WebClientViteConfig = {}) => {
    const sourceRoot = config.sourceRoot ?? './src'

    const baseConfig = defineConfig({
        plugins: process.env[CLIENT_PERFORMANCE_DEBUG_VARIABLE] === 'true' ? [clientPerformanceLog()] : [],
        server: {
            host: true,
            strictPort: true,
            port: 5173,
            watch: {
                usePolling: true,
                interval: 3000,
                binaryInterval: 6000,
            },
        },
        optimizeDeps: {
            entries: [
                'index.html',
            ],
            exclude: [
                '@lixpi/web-client-service-factory',
                ...(config.workspacePackages ?? []),
            ],
        },
        resolve: {
            alias: {
                $src: path.resolve(sourceRoot),
            },
            conditions: ['browser'],
        },
        css: {
            preprocessorOptions: {
                scss: {
                    importers: [{
                        findFileUrl(url: string) {
                            if (!url.startsWith('$src/'))
                                return null

                            return pathToFileURL(
                                path.resolve(
                                    sourceRoot,
                                    url.slice(5),
                                ),
                            )
                        },
                    }],
                },
            },
        },
    })

    return config.overrides
        ? mergeConfig(baseConfig, config.overrides)
        : baseConfig
}

export type WebClientVitestConfig = {
    include?: string[]
    sourceRoot?: string
}

export const createWebClientVitestConfig = (config: WebClientVitestConfig = {}) => {
    const sourceRoot = config.sourceRoot ?? './src'

    return defineVitestConfig({
        test: {
            environment: 'happy-dom',
            globals: true,
            include: config.include ?? ['src/**/*.test.ts'],
            alias: {
                $src: path.resolve(sourceRoot),
            },
        },
        resolve: {
            alias: {
                $src: path.resolve(sourceRoot),
            },
        },
    })
}
