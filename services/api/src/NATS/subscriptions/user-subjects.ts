import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'
import {
    type NatsSubjectSubscription,
} from '@lixpi/nats-service'
import { getNatsSubjectPath } from '@lixpi/constants'

import User from '../../models/user.ts'

export const userSubjects: NatsSubjectSubscription[] = createNatsSubscriptions(
    'user',
    {
        [getNatsSubjectPath(subjects => subjects.USER_SUBJECTS.GET_USER)]: async (data, msg) => {
            const userId = data.user.userId

            if (!userId) {
                // err('Error: `userId` must be provided when fetching user!')
                throw new Error('`userId` must be provided when fetching user!')
            }

            return await User.get(userId)
        }
    },
)
