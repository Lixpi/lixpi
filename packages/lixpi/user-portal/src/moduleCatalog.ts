import {
    USER_PORTAL_MODULE_API_VERSION,
    type UserPortalModule,
    type UserPortalModuleContext,
    type UserPortalNavigationGroup,
    type UserPortalRouteDefinition,
} from './types.ts'

// The composition is fixed before the router or any module lifecycle starts.
export class UserPortalModuleCatalog {
    readonly routes: UserPortalRouteDefinition[]
    readonly navigationGroups: UserPortalNavigationGroup[]

    private readonly modules: UserPortalModule[]
    private readonly initialized: UserPortalModule[] = []

    constructor(modules: UserPortalModule[]) {
        const moduleIds = new Set<string>()
        const paths = new Set<string>()
        this.modules = [...modules]
        this.routes = []
        this.navigationGroups = []

        for (const module of this.modules) {
            if (
                !/^[a-z][a-z0-9-]*$/.test(module.id)
                || moduleIds.has(module.id)
            )
                throw new Error(`Invalid or duplicate portal module: ${module.id}`)

            if (module.apiVersion !== USER_PORTAL_MODULE_API_VERSION)
                throw new Error(`Unsupported portal module API: ${module.id}`)

            moduleIds.add(module.id)
            const modulePaths = new Set<string>()

            for (const route of module.routes) {
                if (
                    !route.path.startsWith('/')
                    || route.path.includes('?')
                    || route.path.includes('#')
                )
                    throw new Error(`Invalid portal route: ${route.path}`)

                const normalizedPath = route.path.split('/').filter(Boolean).join('/')

                if (paths.has(normalizedPath))
                    throw new Error(`Duplicate portal route: ${route.path}`)

                paths.add(normalizedPath)
                modulePaths.add(route.path)
                this.routes.push({ ...route })
            }

            for (const group of module.navigationGroups) {
                for (const item of group.items) {
                    if (!modulePaths.has(item.path))
                        throw new Error(`Navigation route is not registered by module ${module.id}: ${item.path}`)
                }

                this.navigationGroups.push({
                    label: group.label,
                    items: group.items.map(item => ({ ...item })),
                })
            }
        }
    }

    async initialize(context: UserPortalModuleContext): Promise<void> {
        for (const module of this.modules) {
            // Include a partially initialized module in teardown if its hook throws.
            this.initialized.push(module)
            await module.initialize?.(context)
        }
    }

    async destroy(): Promise<void> {
        const errors: unknown[] = []

        while (this.initialized.length > 0) {
            try {
                await this.initialized.pop()!.destroy?.()
            } catch (error) {
                errors.push(error)
            }
        }

        if (errors.length > 0)
            throw new AggregateError(errors, 'Portal module cleanup failed')
    }
}
