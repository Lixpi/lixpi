import {
    LoadingStatus,
    NATS_SUBJECTS,
    type AccountPreferences,
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
    refreshUser: () => Promise<void>
    updatePreferences: (preferences: AccountPreferences) => Promise<void>
}

class UserService implements WebClientUserService {
    constructor(private readonly config: UserServiceConfig) {}

    async getUser(): Promise<void> {
        this.config.store.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            this.config.store.setDataValues(await this.readUser())
            this.config.store.setMetaValues({ loadingStatus: LoadingStatus.success })
        } catch (error) {
            console.error('Failed to load user:', error)
            this.config.store.resetStore()
            this.config.store.setMetaValues({ loadingStatus: LoadingStatus.error })

            throw error
        }
    }

    async refreshUser(): Promise<void> {
        const previous = this.config.store.getData()

        if (!previous.userId)
            return

        const user = await this.readUser()

        if (
            user.userId === previous.userId
            && this.config.store.getData() === previous
        )
            this.config.store.setDataValues(user)
    }

    async updatePreferences(preferences: AccountPreferences): Promise<void> {
        const userId = this.config.store.getData('userId')

        if (!userId)
            throw new Error('CURRENT_USER_UNAVAILABLE')

        const saved = await this.request(NATS_SUBJECTS.USER_SUBJECTS.UPDATE_PREFERENCES, { preferences })

        if (
            !saved
            || typeof saved !== 'object'
            || 'error' in saved
            || this.config.store.getData('userId') !== userId
        )
            throw new Error('ACCOUNT_PREFERENCES_UPDATE_FAILED')

        this.config.store.setDataValues({
            preferences: {
                ...this.config.store.getData('preferences'),
                ...saved,
            },
        })
    }

    private async readUser(): Promise<Partial<User>> {
        const user = (await this.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER)) as Partial<User>

        if (
            !user
            || typeof user.userId !== 'string'
            || !user.userId
            || 'error' in user
        )
            throw new Error('CURRENT_USER_UNAVAILABLE')

        return user
    }

    private async request(
        subject: string,
        payload: Record<string, unknown> = {},
    ): Promise<unknown> {
        const token = await this.config.getToken()

        if (
            !token
            || this.config.isSessionActive?.() === false
        )
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        const response = await this.config.requestClient.request(
            subject,
            {
                ...payload,
                token,
            },
        )

        if (this.config.isSessionActive?.() === false)
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        return response
    }
}

export const createUserService = (config: UserServiceConfig): WebClientUserService => new UserService(config)
