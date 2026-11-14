import { createUserStore } from '@lixpi/auth-client'
import {
    LoadingStatus,
    NATS_SUBJECTS,
} from '@lixpi/constants'
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import { createAccountPreferencesPage } from './accountPreferencesPage.ts'
import {
    type UserPortalModuleContext,
} from '../types.ts'

const renderPreferences = (request: ReturnType<typeof vi.fn>) => {
    const userStore = createUserStore()
    userStore.setDataValues({ userId: 'user-1' })
    userStore.setMetaValues({ loadingStatus: LoadingStatus.success })
    const page = createAccountPreferencesPage({
        userStore,
        getToken: async () => 'access-token',
        nats: { request } as unknown as UserPortalModuleContext['nats'],
    })
    const [appearance, contextMode, midRunPolicy] = page.el.querySelectorAll('select')
    const [appearanceForm, agentForm] = page.el.querySelectorAll('form')

    return {
        page,
        userStore,
        appearance,
        contextMode,
        midRunPolicy,
        appearanceForm,
        agentForm,
    }
}

describe('account preferences page', () => {
    it('saves appearance and agent behavior independently to the account', async () => {
        const request = vi.fn(async (_subject, payload) => payload.preferences)
        const {
            page,
            userStore,
            appearance,
            contextMode,
            midRunPolicy,
            appearanceForm,
            agentForm,
        } = renderPreferences(request)

        try {
            appearance.value = 'one-dark-pro-mariana'
            appearance.dispatchEvent(new Event('change', { bubbles: true }))
            appearanceForm.dispatchEvent(new Event('submit', { cancelable: true }))

            await vi.waitFor(() => expect(userStore.getData('preferences')).toEqual({
                appearance: 'one-dark-pro-mariana',
            }))

            contextMode.value = 'mixed'
            midRunPolicy.value = 'queue'
            midRunPolicy.dispatchEvent(new Event('change', { bubbles: true }))
            agentForm.dispatchEvent(new Event('submit', { cancelable: true }))

            await vi.waitFor(() => expect(userStore.getData('preferences')).toEqual({
                appearance: 'one-dark-pro-mariana',
                agent: {
                    contextMode: 'mixed',
                    midRunPolicy: 'queue',
                },
            }))
            expect(request).toHaveBeenNthCalledWith(
                1,
                NATS_SUBJECTS.USER_SUBJECTS.UPDATE_PREFERENCES,
                {
                    token: 'access-token',
                    preferences: { appearance: 'one-dark-pro-mariana' },
                },
            )
            expect(request).toHaveBeenNthCalledWith(
                2,
                NATS_SUBJECTS.USER_SUBJECTS.UPDATE_PREFERENCES,
                {
                    token: 'access-token',
                    preferences: { agent: {
                        contextMode: 'mixed',
                        midRunPolicy: 'queue',
                    } },
                },
            )
        } finally {
            page.destroy()
        }
    })

    it('keeps an unsaved selection available for retry when the server rejects the write', async () => {
        const request = vi.fn(async () => ({ error: 'ACCOUNT_ADMISSION_UNAVAILABLE' }))
        const {
            page,
            userStore,
            appearance,
            appearanceForm,
        } = renderPreferences(request)

        try {
            appearance.value = 'system'
            appearance.dispatchEvent(new Event('change', { bubbles: true }))
            appearanceForm.dispatchEvent(new Event('submit', { cancelable: true }))

            await vi.waitFor(() => expect(page.el.textContent).toContain('Could not save. Try again.'))
            expect(appearance.value).toBe('system')
            expect(appearanceForm.querySelector('button')?.disabled).toBe(false)
            expect(userStore.getData('preferences')).toBeUndefined()
        } finally {
            page.destroy()
        }
    })
})
