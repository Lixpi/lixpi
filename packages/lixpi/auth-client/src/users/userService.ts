import {
    LoadingStatus,
    NATS_SUBJECTS,
    type User,
} from '@lixpi/constants'

import {
    type UserStateStore,
} from '../stores/userStore.ts'

export type UserRequestClient = {
    request: (
        subject: string,
        payload: Record<string, unknown>,
    ) => Promise<unknown>
}

export type UserServiceConfig = {
    getToken: () => Promise<string | false>
    requestClient: UserRequestClient
    store: UserStateStore
    isSessionActive?: () => boolean
}

export type WebClientUserService = {
    getUser: () => Promise<void>
}

class UserService implements WebClientUserService {
    constructor(private readonly config: UserServiceConfig) {}

    async getUser(): Promise<void> {
        this.config.store.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const token = await this.config.getToken()

            if (
                !token
                || this.config.isSessionActive?.() === false
            )
                throw new Error('ACCOUNT_ADMISSION_DENIED')

            const user = (await this.config.requestClient.request(
                NATS_SUBJECTS.USER_SUBJECTS.GET_USER,
                {
                    token,
                },
            )) as Partial<User>

            if (this.config.isSessionActive?.() === false)
                throw new Error('ACCOUNT_ADMISSION_DENIED')

            if (
                !user
                || typeof user.userId !== 'string'
                || !user.userId
                || 'error' in user
            )
                throw new Error('CURRENT_USER_UNAVAILABLE')

            this.config.store.setDataValues(user)
            this.config.store.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            console.error('Failed to load user:', error)
            this.config.store.resetStore()
            this.config.store.setMetaValues({ loadingStatus: LoadingStatus.error })

            throw error
        }
    }
}

export const createUserService = (config: UserServiceConfig): WebClientUserService => new UserService(config)
