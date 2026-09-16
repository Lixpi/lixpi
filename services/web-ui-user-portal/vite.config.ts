import { createWebClientViteConfig } from '@lixpi/web-client-service-factory/vite'

export default createWebClientViteConfig({
    workspacePackages: [
        '@lixpi/constants',
        '@lixpi/user-portal',
        '@lixpi/nats-service',
        '@lixpi/ui-kit-gentelella',
        '@lixpi/ui-primitives',
    ],
})
