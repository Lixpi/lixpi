import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    createRouterService,
    type WebClientRouterService,
} from '@lixpi/web-client-service-factory'
import { createUserStore } from '@lixpi/auth-client'

import { createLayout } from './layout.ts'

let router: WebClientRouterService
const destroyUserInfo = vi.fn()
const routes = [{
    path: '/',
    createView: () => {
        const el = document.createElement('section')
        el.dataset.view = 'user-info'

        return {
            destroy: destroyUserInfo,
            el,
        }
    },
}]

beforeEach(() => {
    document.body.replaceChildren()
    destroyUserInfo.mockClear()
    router = createRouterService({ routes })
})

describe('user portal layout', () => {
    it('mounts and destroys route views through the injected router', () => {
        const layout = createLayout({
            workspaceUrl: 'http://localhost:3001',
            context: {
                loadingLayer: { acquire: vi.fn() },
                router,
                userStore: createUserStore(),
                getToken: vi.fn(),
                createSessionHandoffUrl: destination => `${destination}/?auth=continue&auth_account=prepared`,
                nats: {
                    request: vi.fn(),
                    subscribe: vi.fn(),
                    onReconnect: vi.fn(),
                } as never,
            },
            routes,
            navigationGroups: [{
                label: 'Account',
                items: [{
                    label: 'User information',
                    path: '/',
                }],
            }],
        })
        document.body.append(layout.el)

        router.navigateTo('/', { shouldFetchData: false })

        expect(layout.el.querySelector('[data-view="user-info"]')).not.toBeNull()
        expect(layout.el.querySelector('a[href="http://localhost:3001/?auth=continue&auth_account=prepared"]')?.textContent).toBe('Back to workspace')

        layout.destroy()
        router.destroy()
        expect(destroyUserInfo).toHaveBeenCalledOnce()
    })
})
