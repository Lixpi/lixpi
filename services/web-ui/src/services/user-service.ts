'use strict'

import { NATS_SUBJECTS, LoadingStatus } from '@lixpi/constants'

const { USER_SUBJECTS } = NATS_SUBJECTS

import AuthService from '$src/services/auth-service.ts'

import { servicesStore } from '$src/stores/servicesStore.ts'
import { userStore } from '$src/stores/userStore.ts'

export default class UserService {
    constructor() {}

    public async getUser(): Promise<void> {
        userStore.setMetaValues({ loadingStatus: LoadingStatus.loading })

        try {
            const user: any = await servicesStore.getData('nats')!.request(USER_SUBJECTS.GET_USER, {
                token: await AuthService.getTokenSilently()
            })

            userStore.setDataValues(user)
            userStore.setMetaValues({ loadingStatus: LoadingStatus.success })

        } catch (error) {
            console.error('Failed to load user:', error)
            userStore.setMetaValues({ loadingStatus: LoadingStatus.error })
        }

    }
}
