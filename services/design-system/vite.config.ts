import { createWebClientViteConfig } from '@lixpi/web-client-service-factory/vite'

export default createWebClientViteConfig({
    workspacePackages: [
        '@lixpi/canvas-components',
        '@lixpi/canvas-components-lixpi-specific',
        '@lixpi/canvas-engine',
        '@lixpi/capability-system',
        '@lixpi/constants',
        '@lixpi/prosemirror',
        '@lixpi/ui-kit',
        '@lixpi/ui-kit-gentelella',
        '@lixpi/ui-primitives',
    ],
})
