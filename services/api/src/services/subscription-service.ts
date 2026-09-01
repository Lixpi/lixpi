import chalk from 'chalk'
import {
    log,
    info,
    infoStr,
    warn,
    err,
} from '@lixpi/debug-tools'

import {
    NATS_SUBJECTS,
    AuthenticationStatus,
} from '@lixpi/constants'

import User from '../models/user.ts'

const logStats = ({ operation, userId, origin }) => {
    const logOrigin = `Subscription -> ${operation}`
    infoStr([
        chalk.white(logOrigin),
        ' (User: ',
        userId,
        '), origin: ',
        origin,
    ])
}

class SubscriptionService {
    constructor() {}

    async checkUserBalance({ userId }) {
        const user = await User.get(userId)

        if (!user) return AuthenticationStatus.userNotFound
        if (!user.hasActiveSubscription) return AuthenticationStatus.noActiveSubscription // On every request verify that user has active subscription

        return AuthenticationStatus.success
    }

    async getPaymentMethods({ userId, stripeCustomerId, origin = 'undefined' }) {
        console.log('//TODO put it back!!!! getPaymentMethods')
        // return customerPaymentMethods
    }

    async deletePaymentMethod({ userId, stripeCustomerId, paymentMethodId, origin = 'undefined' }) {
        console.log('//TODO put it back!!!! getPaymentMethods deletePaymentMethod')

        // logStats({ operation: 'deletePaymentMethod', userId, origin: 'SubscriptionService' })

        // return deletePaymentMethodResponse
    }

    async topUpUserBalance({ userId, stripeCustomerId, amount, origin = 'undefined' }) {
        console.log('//TODO put it back!!!! getPaymentMethods topUpUserBalance')
    }
}

export default SubscriptionService
