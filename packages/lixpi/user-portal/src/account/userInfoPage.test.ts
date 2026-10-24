import {
    LoadingStatus,
    type User,
} from '@lixpi/constants'
import { createUserStore } from '@lixpi/auth-client'
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { createUserInfoPage } from './userInfoPage.ts'

const userFixture: User = {
    userId: 'user-123',
    email: 'alex@example.com',
    name: 'Alex Rivera',
    givenName: 'Alex',
    familyName: 'Rivera',
    avatar: '',
    recentTags: [],
    organizations: ['organization-123'],
    createdAt: Date.UTC(2026, 0, 2),
    updatedAt: Date.UTC(2026, 0, 3),
}

describe('userInfoPage', () => {
    afterEach(() => void document.body.replaceChildren())

    it('renders loading, user, and error states from the shared store', () => {
        const store = createUserStore()
        const loading = {
            setVisible: vi.fn(),
            setErrorMessage: vi.fn(),
            destroy: vi.fn(),
        }
        const page = createUserInfoPage({
            store,
            loadingLayer: { acquire: () => loading },
        })
        document.body.append(page.el)

        expect(loading.setVisible).toHaveBeenLastCalledWith(true)

        store.setDataValues(userFixture)
        store.setMetaValues({ loadingStatus: LoadingStatus.success })

        expect(page.el.textContent).toContain('Alex Rivera')
        expect(loading.setVisible).toHaveBeenLastCalledWith(false)
        expect(page.el.textContent).toContain('alex@example.com')
        expect(page.el.textContent).not.toContain('organization-123')
        expect(page.el.textContent).not.toContain('user-123')
        expect(page.el.querySelector('details')).toBeNull()

        store.setMetaValues({ loadingStatus: LoadingStatus.error })

        expect(page.el.textContent).toContain('User information could not be loaded')
        expect(loading.setVisible).toHaveBeenLastCalledWith(false)
        page.destroy()
        expect(loading.destroy).toHaveBeenCalledOnce()
    })
})
