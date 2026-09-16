import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { UserPortalModuleCatalog } from './moduleCatalog.ts'
import {
    USER_PORTAL_MODULE_API_VERSION,
    type UserPortalModule,
    type UserPortalModuleContext,
} from './types.ts'

const moduleWith = (
    id: string,
    path: string,
    overrides: Partial<UserPortalModule> = {},
): UserPortalModule => ({
    id,
    apiVersion: USER_PORTAL_MODULE_API_VERSION,
    navigationGroups: [{
        label: id,
        items: [{
            label: id,
            path,
        }],
    }],
    routes: [{
        path,
        createView: vi.fn(),
    }],
    ...overrides,
})

describe('UserPortalModuleCatalog', () => {
    it('rejects duplicate module IDs and normalized route paths', () => {
        expect(() => new UserPortalModuleCatalog([
            moduleWith('account', '/'),
            moduleWith('account', '/profile'),
        ])).toThrow('Invalid or duplicate portal module: account')

        expect(() => new UserPortalModuleCatalog([
            moduleWith('account', '/profile'),
            moduleWith('settings', '//profile/'),
        ])).toThrow('Duplicate portal route: //profile/')
    })

    it('rejects unsupported API versions and navigation outside the module routes', () => {
        expect(() => new UserPortalModuleCatalog([
            moduleWith('account', '/', { apiVersion: 2 as 1 }),
        ])).toThrow('Unsupported portal module API: account')

        expect(() => new UserPortalModuleCatalog([
            moduleWith('account', '/', {
                navigationGroups: [{
                    label: 'Account',
                    items: [{
                        label: 'Missing',
                        path: '/missing',
                    }],
                }],
            }),
        ])).toThrow('Navigation route is not registered by module account: /missing')
    })

    it('initializes in composition order and destroys initialized modules in reverse order', async () => {
        const calls: string[] = []
        const catalog = new UserPortalModuleCatalog([
            moduleWith('account', '/', {
                initialize: async () => void calls.push('init-account'),
                destroy: async () => void calls.push('destroy-account'),
            }),
            moduleWith('settings', '/settings', {
                initialize: async () => void calls.push('init-settings'),
                destroy: async () => void calls.push('destroy-settings'),
            }),
        ])

        await catalog.initialize({} as UserPortalModuleContext)
        await catalog.destroy()

        expect(calls).toEqual([
            'init-account',
            'init-settings',
            'destroy-settings',
            'destroy-account',
        ])
    })

    it('cleans a partially initialized module and continues cleanup after an error', async () => {
        const calls: string[] = []
        const catalog = new UserPortalModuleCatalog([
            moduleWith('account', '/', {
                initialize: async () => void calls.push('init-account'),
                destroy: async () => void calls.push('destroy-account'),
            }),
            moduleWith('settings', '/settings', {
                initialize: async () => {
                    calls.push('init-settings')

                    throw new Error('init failed')
                },
                destroy: async () => {
                    calls.push('destroy-settings')

                    throw new Error('cleanup failed')
                },
            }),
        ])

        await expect(catalog.initialize({} as UserPortalModuleContext)).rejects.toThrow('init failed')
        await expect(catalog.destroy()).rejects.toThrow('Portal module cleanup failed')
        expect(calls).toEqual([
            'init-account',
            'init-settings',
            'destroy-settings',
            'destroy-account',
        ])
    })
})
