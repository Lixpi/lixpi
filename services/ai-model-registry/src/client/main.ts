// Boot order: mount the shell, then start the router, which resolves the
// address bar to a route and loads whatever that route needs.

import RouterService from '$src/services/router-service.ts'

import {
    mountApp,
    type AppInstance,
} from '$src/app.ts'

const initializeApplication = async (): Promise<AppInstance | null> => {
    try {
        const target = document.getElementById('app')

        if (!target)
            throw new Error('Application mount target #app not found')

        const app = mountApp(target)
        await RouterService.init()

        return app
    } catch (error) {
        console.error('Application failed to start', error)

        return null
    }
}

void initializeApplication()
