import { getNatsSubjectPath } from '@lixpi/constants'
import { createNatsSubscriptions } from '../create-nats-subscriptions.ts'

import {
    type NatsSubjectSubscription,
} from '@lixpi/nats-service'

import Organization from '../../models/organization.ts'

// Service-only: no browser permission template accompanies this responder.
// The global JWT middleware derives userId from the forwarded access token.
export const organizationMembershipSubjects: NatsSubjectSubscription[] = createNatsSubscriptions(
    'organization-membership',
    {
        [getNatsSubjectPath(subjects => subjects.ORGANIZATION_SUBJECTS.GET_MEMBERSHIP)]: async data => {
            const organizationId = data?.organizationId
            const userId = data?.user?.userId

            if (
                typeof organizationId !== 'string'
                || !organizationId.trim()
                || typeof userId !== 'string'
                || !userId
            )
                throw new Error('INVALID_MEMBERSHIP_REQUEST')

            return Organization.getSelfMembership({
                organizationId,
                userId,
            })
        }
    },
)
