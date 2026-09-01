import process from 'process'
import chalk from 'chalk'
import {
    log,
    info,
    infoStr,
    warn,
    err,
} from '@lixpi/debug-tools'

import SubscriptionService from '../../services/subscription-service.ts'
import User from '../../models/user.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { USER_SUBSCRIPTION_SUBJECTS } = NATS_SUBJECTS

const subscriptionService = new SubscriptionService()

export const subscriptionSubjects = [
    // Subscription ------------------------------------------------------------------------------------------------
    {
        subject: USER_SUBSCRIPTION_SUBJECTS.GET_PAYMENT_METHOD_SETUP_INTENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [USER_SUBSCRIPTION_SUBJECTS.GET_PAYMENT_METHOD_SETUP_INTENT] },
            sub: { allow: [] },
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = data.user
            if (!user || Object.keys(user).length === 0) {
                return { error: 'No user found' }
            }

            const {
                userId,
                stripeCustomerId,
            } = user
        },
    },

    {
        subject: USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS] },
            sub: { allow: [] },
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = data.user
            if (!user || Object.keys(user).length === 0) {
                return { error: 'No user found' }
            }

            const {
                userId,
                stripeCustomerId,
            } = user

            infoStr([
                chalk.green('NATS -> '),
                chalk.green(USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS),
                ', ',
                chalk.grey('userId::'),
                userId,
            ])

            return await subscriptionService.getPaymentMethods({
                userId,
                stripeCustomerId,
                origin: USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS,
            })
        },
    },

    {
        subject: USER_SUBSCRIPTION_SUBJECTS.DELETE_USER_PAYMENT_METHOD,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [USER_SUBSCRIPTION_SUBJECTS.DELETE_USER_PAYMENT_METHOD] },
            sub: { allow: [] },
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = data.user
            if (!user || Object.keys(user).length === 0) {
                return { error: 'No user found' }
            }

            const {
                userId,
                stripeCustomerId,
            } = user
            const { paymentMethodId } = data

            return await subscriptionService.deletePaymentMethod({
                // userId,
                stripeCustomerId,
                paymentMethodId,
                origin: USER_SUBSCRIPTION_SUBJECTS.DELETE_CUSTOMER_PAYMENT_METHOD,
            })
        },
    },

    {
        subject: USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE] },
            sub: { allow: [] },
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = data.user
            if (!user || Object.keys(user).length === 0) {
                return { error: 'No user found' }
            }

            const {
                userId,
                stripeCustomerId,
            } = user
            const { amount } = data

            const amountInCents = parseInt(amount) * 100

            const topUpResponse = await subscriptionService.topUpUserBalance({
                userId,
                stripeCustomerId,
                amount: amountInCents,
                origin: USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE,
            })

            // TODO: this was empty, probably was never working
            return {}
        },
    },
    // END Subscription ---------------------------------------------------------------------------------------------------
]
