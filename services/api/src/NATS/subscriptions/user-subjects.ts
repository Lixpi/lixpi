import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'
import {
    type NatsSubjectSubscription,
} from '@lixpi/nats-service'
import { getNatsSubjectPath } from '@lixpi/constants'
import { parseAccountPreferences } from '../../services/account-preferences.ts'

import User from '../../models/user.ts'

export const userSubjects: NatsSubjectSubscription[] = createNatsSubscriptions(
    'user',
    {
        [getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.GET_USER)]: async data => {
            const userId = data.user.userId

            if (!userId) {
                // err('Error: `userId` must be provided when fetching user!')
                throw new Error('`userId` must be provided when fetching user!')
            }

            return await User.get(userId)
        },
        [getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.UPDATE_PREFERENCES)]: async data =>
            await User.updatePreferences(
                data.user.userId,
                parseAccountPreferences(data.preferences),
            ),
    },
)
