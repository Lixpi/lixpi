'use strict'

import type { NatsSubjectSubscription } from '@lixpi/nats-service'
import { NATS_SUBJECTS } from '@lixpi/constants'
const { USER_SUBJECTS } = NATS_SUBJECTS

import User from '../../models/user.ts'

export const userSubjects: NatsSubjectSubscription[] = [
    {
        subject: USER_SUBJECTS.GET_USER,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [USER_SUBJECTS.GET_USER] },
            sub: { allow: [] },
        },
        handler: async (data, msg) => {
            const userId = data.user.userId

            if (!userId) {
                // err('Error: `userId` must be provided when fetching user!')
                throw new Error('`userId` must be provided when fetching user!')
            }

            return await User.get(userId)
        },
    },
]
