import { createWebClientViteConfig } from '@lixpi/web-client-service-factory/vite'

export default createWebClientViteConfig({
    workspacePackages: [
        '@lixpi/canvas-engine',
        '@lixpi/canvas-components',
        '@lixpi/capability-system',
        '@lixpi/constants',
        '@lixpi/debug-tools',
        '@lixpi/prosemirror',
        '@lixpi/prosemirror-themes',
        '@lixpi/themes',
        '@lixpi/ui-kit',
        '@lixpi/ui-primitives',
    ],
    overrides: {
        server: {
            port: 3003,
            allowedHosts: ['lixpi-documentation'],
            watch: {
                interval: 300,
                binaryInterval: 600,
            },
        },
        build: {
            target: 'esnext',
        },
    },
})
