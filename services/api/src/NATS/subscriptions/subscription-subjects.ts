'use strict'

import process from 'process'
import chalk from 'chalk'

import LambdaService from '@lixpi/lambda-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import SubscriptionService from '../../services/subscription-service.ts'
import User from '../../models/user.ts'

import { NATS_SUBJECTS } from '@lixpi/constants'

const { USER_SUBSCRIPTION_SUBJECTS } = NATS_SUBJECTS

// const sqsService = new SQSService()
const lambdaService = new LambdaService({
    region: process.env.AWS_REGION,
    ssoProfile: process.env.AWS_PROFILE
})
const subscriptionService = new SubscriptionService()

export const subscriptionSubjects = [
    // Subscription ------------------------------------------------------------------------------------------------
    {
        subject: USER_SUBSCRIPTION_SUBJECTS.GET_PAYMENT_METHOD_SETUP_INTENT,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.GET_PAYMENT_METHOD_SETUP_INTENT ] },
            sub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.GET_PAYMENT_METHOD_SETUP_INTENT ] }
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = socket?.user
            if (!user || Object.keys(user).length === 0) {
                ack && ack('No user found')
                return
            }

            // const userId = socket?.user?.userId
            const {
                userId,
                stripeCustomerId
            } = user

            console.log('//TODO: put it back !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! return await lambdaService.invokeFunction({')
            // return await lambdaService.invokeFunction({
            //     functionName: ssmParams.StripeBillingHandlerLambda,
            //     payload: {
            //         target: 'get-payment-method-setup-intent-secret',
            //         userId,
            //         stripeCustomerId
            //     },
            //     origin: USER_SUBSCRIPTION_SUBJECTS.GET_PAYMENT_METHOD_SETUP_INTENT
            // })
        }
    },

    {
        subject: USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS ] },
            sub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS ] }
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = socket?.user
            if (!user || Object.keys(user).length === 0) {
                ack && ack('No user found')
                return
            }

            const {
                userId,
                stripeCustomerId
            } = user

            infoStr([
                chalk.green('Socket.IO -> '),
                chalk.green(USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS),
                ', ',
                chalk.grey('userId::'),
                userId
            ])

            return await subscriptionService.getPaymentMethods({
                userId,
                stripeCustomerId,
                origin: USER_SUBSCRIPTION_SUBJECTS.GET_USER_PAYMENT_METHODS
            })
        }
    },

    {
        subject: USER_SUBSCRIPTION_SUBJECTS.DELETE_USER_PAYMENT_METHOD,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.DELETE_USER_PAYMENT_METHOD ] },
            sub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.DELETE_USER_PAYMENT_METHOD ] }
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = socket?.user
            if (!user || Object.keys(user).length === 0) {
                ack && ack('No user found')
                return
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
                origin: USER_SUBSCRIPTION_SUBJECTS.DELETE_CUSTOMER_PAYMENT_METHOD
            })
        }
    },

    {
        subject: USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE,
        type: 'reply',
        payloadType: 'json',
        permissions: {
            pub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE ] },
            sub: { allow: [ USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE ] }
        },
        handler: async (data, msg) => {
            // If user set and its not an empty object
            const user = socket?.user
            if (!user || Object.keys(user).length === 0) {
                ack && ack('No user found')
                return
            }

            // const userId = socket?.user?.userId
            const {
                userId,
                stripeCustomerId
            } = user
            const { amount } = data

            const amountInCents = parseInt(amount) * 100


            // Instead of invoking the lambda directly, use topUpUserBalance from the SubscriptionService
            const topUpResponse = await subscriptionService.topUpUserBalance({
                userId,
                stripeCustomerId,
                amount: amountInCents,
                origin: USER_SUBSCRIPTION_SUBJECTS.TOP_UP_USER_BALANCE
            })


            // TODO: this was empty, probably was never working
            return {}
        }
    }

    // END Subscription ---------------------------------------------------------------------------------------------------
]
