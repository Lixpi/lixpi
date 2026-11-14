import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    LoadingStatus,
    NATS_SUBJECTS,
} from '@lixpi/constants'

import { createUserStore } from '../stores/userStore.ts'
import { createUserService } from './userService.ts'

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => void (consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)))

afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
})

describe('current user service', () => {
    it('loads the user with the current access token', async () => {
        const store = createUserStore()
        const user = {
            userId: 'user-1',
            email: 'user@example.com',
            name: 'User One',
        }
        const request = vi.fn(async () => user)
        const service = createUserService({
            getToken: async () => 'access-token',
            requestClient: { request },
            store,
        })

        await service.getUser()

        expect(request).toHaveBeenCalledWith(
            NATS_SUBJECTS.USER_SUBJECTS.GET_USER,
            { token: 'access-token' },
        )
        expect(store.getData('userId')).toBe('user-1')
        expect(store.getMeta('loadingStatus')).toBe(LoadingStatus.success)
    })

    it('moves the store to the error state when the request fails', async () => {
        const store = createUserStore()
        const service = createUserService({
            getToken: async () => 'access-token',
            requestClient: {
                request: vi.fn(async () => {
                    throw new Error('request failed')
                }),
            },
            store,
        })

        await expect(service.getUser()).rejects.toThrow('request failed')

        expect(store.getMeta('loadingStatus')).toBe(LoadingStatus.error)
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to load user:',
            expect.any(Error),
        )
    })

    it('ignores a refresh that overlaps a newer settings write or store reset', async () => {
        const store = createUserStore()
        store.setDataValues({ userId: 'user-1' })
        const reply = Promise.withResolvers<unknown>()
        const service = createUserService({
            getToken: async () => 'token',
            store,
            requestClient: {
                request: async subject => subject === NATS_SUBJECTS.USER_SUBJECTS.GET_USER
                    ? await reply.promise
                    : { appearance: 'one-dark-pro-mariana' },
            },
        })
        const refreshing = service.refreshUser()
        await service.updatePreferences({ appearance: 'one-dark-pro-mariana' })
        reply.resolve({
            userId: 'user-1',
            preferences: { appearance: 'lixpi-light' },
        })
        await refreshing

        expect(store.getData('preferences')).toEqual({ appearance: 'one-dark-pro-mariana' })

        const afterLogout = service.refreshUser()
        store.resetStore()
        await afterLogout

        expect(store.getData('userId')).toBe('')
        expect(store.getData('preferences')).toBeUndefined()
    })

    it('discards a user reply received after session rejection', async () => {
        const store = createUserStore()
        let active = true
        const reply = Promise.withResolvers<unknown>()
        const entered = Promise.withResolvers<void>()
        const service = createUserService({
            getToken: async () => 'token',
            isSessionActive: () => active,
            store,
            requestClient: { request: async () => { entered.resolve()

            return await reply.promise } },
        })
        const running = service.getUser()
        await entered.promise
        active = false
        reply.resolve({
            userId: 'user',
            email: 'private@example.com',
        })
        await expect(running).rejects.toThrow('ACCOUNT_ADMISSION_DENIED')
        expect(store.getData('userId')).toBe('')
    })
})
